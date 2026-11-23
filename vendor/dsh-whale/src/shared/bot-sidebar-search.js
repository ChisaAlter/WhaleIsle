// Dual-dimension sidebar search: Unicode accent/case folding, phrase & unordered
// word-prefix matching, name prioritized over SOUL.md purpose, and 24-char snippet truncation.

const PRINTABLE_ASCII = /^[ -~]*$/;
const COMBINING_MARK = /\p{M}/u;
const COMBINING_MARKS = /\p{M}/gu;
const WORD = /[\p{L}\p{N}]+/gu;
const WHITESPACE = /\s+/u;
const SNIPPET_LEAD = 24;

function foldCluster(cluster) {
  return cluster.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().replace(/ς/g, 'σ');
}

/** Folds case and accents per grapheme cluster while tracking original UTF-16 offsets. */
export function foldBotSearchText(text) {
  const safe = typeof text === 'string' ? text : '';
  if (PRINTABLE_ASCII.test(safe)) {
    return { folded: safe.toLowerCase(), starts: null, ends: null };
  }
  let folded = '';
  const starts = [];
  const ends = [];
  let index = 0;
  while (index < safe.length) {
    const codePoint = safe.codePointAt(index);
    let end = index + (codePoint > 0xffff ? 2 : 1);
    while (end < safe.length) {
      const next = safe.codePointAt(end);
      if (!COMBINING_MARK.test(String.fromCodePoint(next))) {
        break;
      }
      end += next > 0xffff ? 2 : 1;
    }
    const chunk = foldCluster(safe.slice(index, end));
    for (let unit = 0; unit < chunk.length; unit += 1) {
      starts.push(index);
      ends.push(end);
    }
    folded += chunk;
    index = end;
  }
  return { folded, starts, ends };
}

function sourceRange(text, start, end) {
  if (!text.starts || !text.ends) {
    return { start, end };
  }
  return { start: text.starts[start], end: text.ends[end - 1] };
}

export function parseBotSearchQuery(query) {
  const phrase = foldBotSearchText(String(query ?? '').trim()).folded;
  if (!phrase) {
    return null;
  }
  return { phrase, tokens: phrase.split(WHITESPACE).filter(Boolean) };
}

function indexSearchText(text) {
  const folded = foldBotSearchText(text);
  const wordStarts = [...folded.folded.matchAll(WORD)].map((match) => match.index);
  return { ...folded, wordStarts };
}

export function mergeBotSearchRanges(ranges) {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function matchIndexed(indexed, query) {
  const at = indexed.folded.indexOf(query.phrase);
  if (at !== -1) {
    return [sourceRange(indexed, at, at + query.phrase.length)];
  }
  if (query.tokens.length < 2) {
    return null;
  }
  const ranges = [];
  for (const token of query.tokens) {
    const start = indexed.wordStarts.find((wordStart) => indexed.folded.startsWith(token, wordStart));
    if (start === undefined) {
      return null;
    }
    ranges.push(sourceRange(indexed, start, start + token.length));
  }
  return mergeBotSearchRanges(ranges);
}

export function matchBotSearchText(text, query) {
  const parsed = parseBotSearchQuery(query);
  return parsed ? matchIndexed(indexSearchText(text), parsed) : null;
}

export function splitBotSearchText(text, ranges) {
  const parts = [];
  let cursor = 0;
  for (const { start, end } of mergeBotSearchRanges(ranges ?? [])) {
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), marked: false });
    }
    parts.push({ text: text.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), marked: false });
  }
  return parts;
}

/** Cuts purpose text to begin ~24 characters before its first match, prefixing `…`. */
export function botPurposeSnippet(text, ranges) {
  const first = ranges?.[0];
  if (!first || first.start <= SNIPPET_LEAD) {
    return { text, ranges: [...(ranges ?? [])] };
  }
  const from = first.start - SNIPPET_LEAD;
  const space = text.indexOf(' ', from);
  let cut = space !== -1 && space < first.start ? space + 1 : from;
  if (/[\udc00-\udfff]/.test(text[cut] ?? '')) {
    cut += 1;
  }
  const shift = cut - 1;
  return {
    text: `…${text.slice(cut)}`,
    ranges: ranges.map(({ start, end }) => ({ start: start - shift, end: end - shift })),
  };
}

export function sidebarEntryNameOf(entry) {
  if (entry.kind === 'group') {
    return entry.group?.name ?? entry.name ?? '';
  }
  return entry.bot?.name ?? entry.name ?? '';
}

export function sidebarEntryIdOf(entry) {
  return entry.id ?? entry.bot?.id ?? entry.group?.id ?? '';
}

export function isSidebarEntryPausedBot(entry) {
  if (entry.kind === 'group') {
    return false;
  }
  return (entry.bot?.paused ?? entry.paused) === true;
}

function buildPurposeMatch(item, parsed, currentPurposeOf) {
  const purposeText = item.entry.kind === 'group' ? null : (currentPurposeOf(item.entry) ?? null);
  if (purposeText !== (item.purpose?.text ?? null)) {
    item.purpose = purposeText ? { text: purposeText, indexed: indexSearchText(purposeText) } : null;
  }
  const purposeRanges = item.purpose ? matchIndexed(item.purpose.indexed, parsed) : null;
  if (!item.purpose || !purposeRanges) {
    return null;
  }
  const snippet = botPurposeSnippet(item.purpose.text, purposeRanges);
  return {
    entry: item.entry,
    matchedBy: 'purpose',
    nameRanges: [],
    nameSegments: [{ text: item.nameText, marked: false }],
    purpose: {
      text: item.purpose.text,
      ranges: purposeRanges,
      snippetText: snippet.text,
      snippetRanges: snippet.ranges,
      segments: splitBotSearchText(snippet.text, snippet.ranges),
    },
  };
}

export function createBotSidebarSearchIndex({ shown, all = shown, purposeOf = () => null }) {
  const indexed = shown.map((entry) => ({
    entry,
    nameText: sidebarEntryNameOf(entry),
    name: indexSearchText(sidebarEntryNameOf(entry)),
    purpose: null,
  }));
  const shownIds = new Set(shown.map(sidebarEntryIdOf));
  const hiddenPaused = all
    .filter((entry) => isSidebarEntryPausedBot(entry) && !shownIds.has(sidebarEntryIdOf(entry)))
    .map((entry) => indexSearchText(sidebarEntryNameOf(entry)));

  return (query, currentPurposeOf = purposeOf) => {
    const parsed = parseBotSearchQuery(query);
    if (!parsed) {
      return { matches: [], hiddenPausedMatches: 0 };
    }
    const byName = [];
    const byPurpose = [];
    for (const item of indexed) {
      const nameRanges = matchIndexed(item.name, parsed);
      if (nameRanges) {
        byName.push({
          entry: item.entry,
          matchedBy: 'name',
          nameRanges,
          nameSegments: splitBotSearchText(item.nameText, nameRanges),
          purpose: null,
        });
        continue;
      }
      const purposeMatch = buildPurposeMatch(item, parsed, currentPurposeOf);
      if (purposeMatch) {
        byPurpose.push(purposeMatch);
      }
    }
    return {
      matches: [...byName, ...byPurpose],
      hiddenPausedMatches: hiddenPaused.filter((name) => matchIndexed(name, parsed) !== null).length,
    };
  };
}

/** One-shot dual-dimension search over sidebar entries or raw bots. */
export function searchBots(entries, query, options = {}) {
  const shown = Array.isArray(entries) ? entries : [];
  const all = Array.isArray(options.all) ? options.all : shown;
  const purposeOf = options.purposeOf
    ?? ((entry) => entry.purpose ?? entry.description ?? entry.bot?.description ?? null);
  return createBotSidebarSearchIndex({ shown, all, purposeOf })(query);
}
