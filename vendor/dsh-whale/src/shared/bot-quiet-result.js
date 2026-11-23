// NO_REPLY quiet result protocol: regex matching, streaming anti-flicker holdback,
// final turn stripping, and addressed-turn word extraction (`addressedBotWords`).

/** A bot's final message ending with this has nothing worth reporting, so nobody is told. */
export const BOT_QUIET_MARKER = 'NO_REPLY';

// Matches NO_REPLY as the message's final word, even dressed with markdown punctuation
// (`NO_REPLY`, **NO_REPLY**, NO_REPLY., **NO_REPLY!**). Words that merely contain it
// (e.g. XNO_REPLY) do not match.
const QUIET_ENDING = new RegExp(`(?:^|\\s)[\`*_]*${BOT_QUIET_MARKER}[\`*_.!]*\\s*$`);
const TRAILING_BACKTICK_MARKER = new RegExp(`\`+${BOT_QUIET_MARKER}\`+[.!]*\\s*$`);
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;
const MARKER_DRESSING = /^[`*_]*/;
const MARKER_TRAILING_DRESSING = /^[`*_.!]*$/;

/** True when a settled message ends with the quiet marker. */
export function isQuietResult(message) {
  return typeof message === 'string' && QUIET_ENDING.test(message);
}

/** Alias matching original function name. */
export const isQuietBotResult = isQuietResult;

/** Strips the trailing quiet marker and trailing whitespace from a message. */
export function stripQuietMarker(message) {
  if (typeof message !== 'string') {
    return '';
  }
  return message.replace(QUIET_ENDING, '').trimEnd();
}

/** Alias matching original function name. */
export const quietBotResultText = stripQuietMarker;

/**
 * Extracts real words from a bot reply to an addressed turn (direct chat / @mention):
 * - Iteratively strips trailing `NO_REPLY` markers (handling multiple stacked markers).
 * - Protects inline backtick references on the same line (e.g. ``Use `NO_REPLY` ``)
 *   so prose mentioning the token is never mutilated.
 * - Returns `null` if nothing containing letters, digits, or CJK characters remains
 *   after stripping (e.g. `NO_REPLY`, `> NO_REPLY`, `- NO_REPLY`).
 * @param {unknown} message
 */
export function addressedBotWords(message) {
  if (typeof message !== 'string') {
    return null;
  }
  let current = message.trimEnd();
  while (QUIET_ENDING.test(current)) {
    const match = QUIET_ENDING.exec(current);
    if (!match) break;
    const matchText = match[0];
    // Protect inline code reference like "End with `NO_REPLY`." when preceded by words on the same line
    if (TRAILING_BACKTICK_MARKER.test(matchText.trim())) {
      const leadingWsLen = matchText.length - matchText.trimStart().length;
      const beforeToken = current.slice(0, match.index + leadingWsLen);
      const lastNewline = beforeToken.lastIndexOf('\n');
      const sameLineBefore = beforeToken.slice(lastNewline + 1);
      if (HAS_WORD_CHAR.test(sameLineBefore)) {
        break;
      }
    }
    const next = current.slice(0, match.index).trimEnd();
    if (next === current) break;
    current = next;
  }
  const trimmed = current.trim();
  if (!trimmed || !HAS_WORD_CHAR.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Holds back a trailing word that is, or may still grow into, `NO_REPLY`
 * (for example `NO_R`, `` `NO_REP ``, `**NO_REPLY*`) so streaming UI never flickers.
 */
export function withoutGrowingMarker(words) {
  if (typeof words !== 'string') {
    return '';
  }
  const trimmed = words.trimEnd();
  const wordStart = Math.max(
    trimmed.lastIndexOf(' '),
    trimmed.lastIndexOf('\n'),
    trimmed.lastIndexOf('\t'),
  ) + 1;
  const word = trimmed.slice(wordStart);
  const bare = word.replace(MARKER_DRESSING, '');
  const growing = bare.length > 0 && (
    BOT_QUIET_MARKER.startsWith(bare)
    || (bare.startsWith(BOT_QUIET_MARKER)
      && MARKER_TRAILING_DRESSING.test(bare.slice(BOT_QUIET_MARKER.length)))
  );
  return growing ? trimmed.slice(0, wordStart).trimEnd() : words;
}

/**
 * Computes how a bot answer should be displayed and whether it is silent.
 * A bot chat answer never draws its marker; only a settled non-automation,
 * non-acting turn that said nothing else yields `nothingToReport: true`.
 */
export function quietBotAnswer(words, row = {}) {
  const safeWords = typeof words === 'string' ? words : '';
  if (!row.botAnswer) {
    return { quiet: false, words: safeWords, nothingToReport: false };
  }
  if (row.streaming) {
    return {
      quiet: false,
      words: withoutGrowingMarker(safeWords),
      nothingToReport: false,
    };
  }
  if (!isQuietResult(safeWords)) {
    return { quiet: false, words: safeWords, nothingToReport: false };
  }
  const text = stripQuietMarker(safeWords);
  return {
    quiet: true,
    words: text,
    nothingToReport: !text && !row.inAutomationTurn && !row.inActingTurn,
  };
}

function isTextBlock(block) {
  return Boolean(block) && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string';
}

/** Applies `quietBotAnswer` to block-structured chat messages (marker ends the last text block). */
export function quietBotAnswerBlocks(blocks, row = {}) {
  if (!Array.isArray(blocks)) {
    return { blocks: [], nothingToReport: false };
  }
  let lastIndex = -1;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (isTextBlock(blocks[i])) {
      lastIndex = i;
      break;
    }
  }
  if (lastIndex === -1) {
    return { blocks, nothingToReport: false };
  }
  const block = blocks[lastIndex];
  const answer = quietBotAnswer(block.text, row);
  if (answer.words === block.text) {
    return { blocks, nothingToReport: false };
  }
  const shown = blocks.flatMap((entry, index) => {
    if (index !== lastIndex) {
      return [entry];
    }
    return answer.words ? [{ ...entry, text: answer.words }] : [];
  });
  const hasOtherText = shown.some((entry) => isTextBlock(entry) && entry.text.trim().length > 0);
  return {
    blocks: shown,
    nothingToReport: answer.nothingToReport && !hasOtherText,
  };
}
