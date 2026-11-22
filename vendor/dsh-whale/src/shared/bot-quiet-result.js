// NO_REPLY quiet result protocol: regex matching, streaming anti-flicker holdback,
// and final turn stripping.

/** A bot's final message ending with this has nothing worth reporting, so nobody is told. */
export const BOT_QUIET_MARKER = 'NO_REPLY';

// Matches NO_REPLY as the message's final word, even dressed with markdown punctuation
// (`NO_REPLY`, **NO_REPLY**, NO_REPLY., **NO_REPLY!**). Words that merely contain it
// (e.g. XNO_REPLY) do not match.
const QUIET_ENDING = new RegExp(`(?:^|\\s)[\`*_]*${BOT_QUIET_MARKER}[\`*_.!]*\\s*$`);
const MARKER_DRESSING = /^[`*_]*/;
const MARKER_TRAILING_DRESSING = /^[`*_.!]*$/;

/** True when a settled message ends with the quiet marker. */
export function isQuietResult(message) {
  return typeof message === 'string' && QUIET_ENDING.test(message);
}

/** Alias matching Orca's original function name. */
export const isQuietBotResult = isQuietResult;

/** Strips the trailing quiet marker and trailing whitespace from a message. */
export function stripQuietMarker(message) {
  if (typeof message !== 'string') {
    return '';
  }
  return message.replace(QUIET_ENDING, '').trimEnd();
}

/** Alias matching Orca's original function name. */
export const quietBotResultText = stripQuietMarker;

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
