// MEMORY.md line-level parsing, provenance tagging, anti-forgery sanitization,
// unauthorized-delete restoration, and secret redaction for 90-day undo history.

/** Lines of MEMORY.md a session loads at start; the rest stays on disk. */
export const MEMORY_LOAD_LIMIT = 200;
export const BOT_MEMORY_INDEX_LINE_CAP = MEMORY_LOAD_LIMIT;
export const BOT_MEMORY_SOURCE_SEPARATOR = ' · from: ';
export const BOT_MEMORY_HISTORY_DAYS = 90;
export const BOT_MEMORY_HISTORY_MAX_ROWS = 1000;

const FACT_LINE = /^(\s*[-*]\s+)(.*)$/;
const DATED_TEXT = /^(\d{4}-\d{2}-\d{2})(?:\s*[:\u2013\u2014-]\s*|\s+)(.*)$/;

const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];
const CREDENTIAL_URL_PATTERN = /\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@(?=[^/\s]+)/g;
const SECRET_KEY =
  '(?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|secret|password|account[_-]?key)';
const SECRET_KEY_END = '(?:\\\\?["\'])?\\s*[:=]';
const BEFORE_NEXT_SECRET = `(?![\\s,;&{]{0,8}\\\\?["']?\\b${SECRET_KEY}${SECRET_KEY_END})`;
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(${SECRET_KEY})${SECRET_KEY_END}\\s*(?:\\\\"(?:${BEFORE_NEXT_SECRET}(?:\\\\[^"]|[^"\\\\\\r\\n]))*\\\\"|"(?:${BEFORE_NEXT_SECRET}(?:\\\\.|[^"\\\\\\r\\n]))*"|"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^&\\s,;]+)`,
  'gi',
);

function splitLines(text) {
  const safe = typeof text === 'string' ? text : '';
  return { lines: safe.split(/\r?\n/), eol: safe.includes('\r\n') ? '\r\n' : '\n' };
}

function oneLine(fact) {
  return String(fact ?? '').replace(/\s+/g, ' ').trim();
}

function factKey(text) {
  return oneLine(text);
}

function factLine(prefix, date, text, source = null) {
  const datePart = date ? `${date} ` : '';
  const sourcePart = source ? `${BOT_MEMORY_SOURCE_SEPARATOR}${source}` : '';
  return `${prefix}${datePart}${text}${sourcePart}`;
}

function factParts(raw) {
  const listed = FACT_LINE.exec(raw);
  const body = listed?.[2]?.trim();
  if (!listed || !body) {
    return null;
  }
  const dated = DATED_TEXT.exec(body);
  const text = dated ? dated[2].trim() : body;
  const at = text.lastIndexOf(BOT_MEMORY_SOURCE_SEPARATOR);
  return {
    prefix: listed[1],
    date: dated?.[1] ?? null,
    text: at > 0 ? text.slice(0, at).trim() : text,
    source: at > 0 ? text.slice(at + BOT_MEMORY_SOURCE_SEPARATOR.length).trim() || null : null,
  };
}

function rawFactKey(raw) {
  const fact = factParts(raw);
  return fact ? factKey(fact.text) : null;
}

/**
 * Strips any forged trailing ` · from: ...` provenance marker and defuses embedded
 * `· from:` lookalikes so untrusted text cannot impersonate host provenance marks.
 */
export function stripForgedFromSuffix(text) {
  if (typeof text !== 'string') {
    return '';
  }
  const at = text.lastIndexOf(BOT_MEMORY_SOURCE_SEPARATOR);
  const body = at > 0 ? text.slice(0, at) : text;
  const [first = '', ...rest] = body.split('·');
  const parts = [first];
  for (const piece of rest) {
    if (piece.trimStart().slice(0, 5).toLowerCase() === 'from:') {
      parts[parts.length - 1] = parts.at(-1)?.trimEnd() ?? '';
      parts.push(` - ${piece.trimStart()}`);
    } else {
      parts.push(`·${piece}`);
    }
  }
  return oneLine(parts.join(''));
}

/** The lines of MEMORY.md a session loads, and how many past the cap remain on disk. */
export function loadedBotMemoryLines(text, cap = MEMORY_LOAD_LIMIT) {
  const trimmed = String(text ?? '').trimEnd();
  if (trimmed === '') {
    return { lines: [], omitted: 0 };
  }
  const lines = trimmed.split(/\r?\n/);
  return { lines: lines.slice(0, cap), omitted: Math.max(0, lines.length - cap) };
}

/** Counted exactly as the session loader counts them. */
export function countBotMemoryLines(text) {
  const trimmed = String(text ?? '').trimEnd();
  return trimmed === '' ? 0 : trimmed.split(/\r?\n/).length;
}

/** Parses every list-item fact line with 0-based line number, date, text, and source. */
export function parseBotMemoryFacts(text) {
  const facts = [];
  splitLines(text).lines.forEach((raw, line) => {
    const fact = factParts(raw);
    if (fact) {
      facts.push({ line, date: fact.date, text: fact.text, source: fact.source });
    }
  });
  return facts;
}

/**
 * Applies host provenance marks (` · from: <label>`) to new fact lines introduced in `after`
 * compared to `before`. Existing facts keep their prior mark; forged ` · from:` claims are defused.
 */
export function tagBotMemoryChanges(before, after, label = null) {
  const earlier = new Map();
  const known = new Map();
  for (const line of splitLines(before).lines) {
    earlier.set(line, (earlier.get(line) ?? 0) + 1);
    const fact = factParts(line);
    if (fact && !known.has(factKey(fact.text))) {
      known.set(factKey(fact.text), fact.source);
    }
  }
  const { lines, eol } = splitLines(after);
  return lines
    .map((raw) => {
      const seen = earlier.get(raw) ?? 0;
      earlier.set(raw, seen - 1);
      const fact = seen > 0 ? null : factParts(raw);
      const cleanText = fact ? stripForgedFromSuffix(fact.text) : '';
      if (!fact || !cleanText) {
        return raw;
      }
      const kept = known.get(factKey(fact.text));
      return factLine(fact.prefix, fact.date, cleanText, kept === undefined ? label : kept);
    })
    .join(eol);
}

/** Computes added and removed fact lines with their preceding anchor line. */
export function diffMemoryLines(before, after) {
  const only = (from, other) => {
    const keys = new Set(splitLines(other).lines.map(rawFactKey));
    const lines = [];
    let previous = null;
    for (const raw of splitLines(from).lines) {
      const key = rawFactKey(raw);
      if (key !== null && !keys.has(key)) {
        lines.push({ line: raw, after: previous });
      }
      previous = raw.trim() === '' ? previous : raw;
    }
    return lines;
  };
  return { added: only(after, before), removed: only(before, after) };
}

export const botMemoryChange = diffMemoryLines;

export function isEmptyBotMemoryChange(change) {
  return !change || (change.added.length === 0 && change.removed.length === 0);
}

export function botMemoryFactKeys(text) {
  return new Set(splitLines(text).lines.flatMap((raw) => {
    const key = rawFactKey(raw);
    return key === null ? [] : [key];
  }));
}

export function botMemoryLineKey(entry) {
  return rawFactKey(typeof entry === 'string' ? entry : entry?.line ?? '');
}

export function mergeBotMemoryChanges(a, b) {
  const unique = (lines) => {
    const seen = new Set();
    return lines.filter((line) => {
      const key = rawFactKey(line.line);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  };
  return {
    added: unique([...a.added, ...b.added]),
    removed: unique([...a.removed, ...b.removed]),
  };
}

export function onlyBotMemoryFactsChanged(before, after) {
  const nonFacts = (text) =>
    splitLines(text).lines.flatMap((raw) => (raw.trim() !== '' && rawFactKey(raw) === null ? [raw.trim()] : []));
  const a = nonFacts(before);
  const b = nonFacts(after);
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** Applies a fact diff (`removed` then `added` after anchor lines) to `text`. */
export function applyBotMemoryChange(text, change) {
  const gone = new Set((change?.removed ?? []).map(({ line }) => rawFactKey(line)));
  const { lines, eol } = splitLines(text);
  const kept = lines.filter((raw) => {
    const key = rawFactKey(raw);
    return key === null || !gone.has(key);
  });
  const present = new Set(kept.map(rawFactKey));
  for (const { line, after } of change?.added ?? []) {
    const key = rawFactKey(line);
    if (key === null || present.has(key)) {
      continue;
    }
    present.add(key);
    const anchor = after === null ? -1 : kept.lastIndexOf(after);
    const end = findLastNonBlankIndex(kept) + 1;
    kept.splice(after === null || anchor !== -1 ? anchor + 1 : end, 0, line);
  }
  return kept.join(eol);
}

function findLastNonBlankIndex(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() !== '') {
      return i;
    }
  }
  return -1;
}

/** Removes matching fact line(s) given either fact words, full line, or parsed fact object. */
export function applyMemoryForget(text, fact) {
  if (fact && typeof fact === 'object' && typeof fact.line === 'number') {
    const found = findBotMemoryFact(text, fact);
    if (!found) {
      return { text, dropped: 0 };
    }
    const next = applyMemoryEdit(text, found, '');
    return { text: next, dropped: 1 };
  }
  const clean = String(fact ?? '').trim().replace(/^[-*]\s+/, '');
  const wanted = factParts(`- ${clean}`);
  const key = wanted ? factKey(wanted.text) : '';
  const { lines, eol } = splitLines(text);
  const kept = lines.filter((raw) => {
    const parts = factParts(raw);
    return key === '' || !parts || factKey(parts.text) !== key;
  });
  return { text: kept.join(eol), dropped: lines.length - kept.length };
}

export const dropBotMemoryFact = applyMemoryForget;

export function findBotMemoryFact(text, fact) {
  const facts = parseBotMemoryFacts(text);
  const same = (entry) => entry.text === fact.text && entry.date === fact.date;
  return facts.find((entry) => same(entry) && entry.line === fact.line) ?? facts.find(same) ?? null;
}

/** Edits a single fact keeping its bullet, date, and source; empty `nextText` removes the line. */
export function applyMemoryEdit(text, fact, nextText) {
  const { lines, eol } = splitLines(text);
  const target = typeof fact === 'string'
    ? parseBotMemoryFacts(text).find((entry) => factKey(entry.text) === factKey(fact))
    : findBotMemoryFact(text, fact) ?? fact;
  if (!target || typeof target.line !== 'number' || target.line < 0 || target.line >= lines.length) {
    return text;
  }
  const next = stripForgedFromSuffix(nextText);
  if (next === '') {
    lines.splice(target.line, 1);
  } else {
    const prefix = FACT_LINE.exec(lines[target.line] ?? '')?.[1] ?? '- ';
    lines[target.line] = factLine(prefix, target.date ?? null, next, target.source ?? null);
  }
  return lines.join(eol);
}

export const editBotMemoryFact = applyMemoryEdit;

export function forgetBotMemoryFact(text, fact) {
  return applyMemoryEdit(text, fact, '');
}

/** Inserts a new fact newest-first (above the first existing fact, or at the end). */
export function applyMemoryAdd(text, fact, date = botMemoryDate(new Date()), source = null) {
  const next = stripForgedFromSuffix(fact);
  if (next === '') {
    return text;
  }
  const { lines, eol } = splitLines(text);
  const line = factLine('- ', date, next, source);
  const first = parseBotMemoryFacts(text)[0];
  if (first) {
    lines.splice(first.line, 0, line);
    return lines.join(eol);
  }
  const body = String(text ?? '').trimEnd();
  return `${body}${body === '' ? '' : `${eol}${eol}`}${line}${eol}`;
}

export const addBotMemoryFact = applyMemoryAdd;

/** Local calendar date as `YYYY-MM-DD`. */
export function botMemoryDate(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const pad = (value) => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses `"Slack, Dana <https://…>"` into `{ text, url }`. */
export function botMemorySourceLink(source) {
  const safe = String(source ?? '');
  const linked = /^(.*?)\s*<(https:\/\/[^\s<>]+)>$/.exec(safe);
  return linked ? { text: linked[1], url: linked[2] } : { text: safe, url: null };
}

/**
 * Orca turn-end tamper protection: restores any fact lines removed from `before` -> `after`
 * without going through `forget`, applies external source tagging to genuinely added lines,
 * and returns `{ text, kept, restoredCount }`.
 */
export function restoreUnauthorizedDeletes(before, after, sourceLabel = null) {
  const removed = diffMemoryLines(before, after).removed;
  const restored = removed.length > 0
    ? applyBotMemoryChange(after, { added: removed, removed: [] })
    : after;
  const hasAdded = diffMemoryLines(before, restored).added.length > 0;
  const tagged = tagBotMemoryChanges(before, restored, hasAdded ? sourceLabel : null);
  const kept = diffMemoryLines(after, restored);
  return {
    text: tagged,
    kept,
    restoredCount: kept.added.length,
  };
}

/** True when `value` contains token/key shapes or embedded URL credentials. */
export function containsSecretLike(value) {
  if (typeof value !== 'string' || !value) {
    return false;
  }
  return [...SECRET_PATTERNS, CREDENTIAL_URL_PATTERN].some(
    (pattern) => new RegExp(pattern.source, pattern.flags.replace('g', '')).test(value),
  );
}

/** Redacts tokens, keys, credentialed URLs, and `password=`-style assignments. */
export function redactSecretLike(value) {
  if (typeof value !== 'string') {
    return '';
  }
  let redacted = value.replace(CREDENTIAL_URL_PATTERN, '[redacted-credential]@');
  redacted = redacted.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key) => `${key}=[redacted]`);
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[redacted-secret]');
  }
  return redacted;
}

/**
 * Redacts any secret-like tokens from a memory history entry before persisting.
 * Sets `undoable: false` whenever redaction modified any line, so Undo never writes placeholders.
 */
export function redactSecretsInMemory(by, change) {
  const redactRow = ({ line, after }) => ({
    line: redactSecretLike(line),
    after: after === null ? null : redactSecretLike(after),
  });
  const safeChange = {
    added: (change?.added ?? []).map(redactRow),
    removed: (change?.removed ?? []).map(redactRow),
  };
  const safeBy = by?.kind === 'chat' && typeof by.source === 'string'
    ? { ...by, source: redactSecretLike(by.source) }
    : by;
  const undoable = JSON.stringify(safeChange) === JSON.stringify({
    added: change?.added ?? [],
    removed: change?.removed ?? [],
  });
  return { by: safeBy, change: safeChange, undoable };
}
