// Overnight memory Tidy-up response block parser, structured Ops mode,
// safety guardrails (with >200-line deadlock fix), and plan applicator.
// Zero Node/DOM hard dependencies; safe in main process and browser ESM.

import {
  MEMORY_LOAD_LIMIT,
  applyBotMemoryChange,
  botMemoryDate,
  botMemoryFactKeys,
  botMemoryLineKey,
  containsSecretLike,
  countBotMemoryLines,
  diffMemoryLines,
  isLessonMemoryLine,
  isOwnerDecisionLine,
  isStandingOwnerRule,
  mergeBotMemoryChanges,
  parseBotMemoryFacts,
  redactSecretLike,
  scanBotMemoryLines,
} from './bot-memory-lines.js';

export const TIDY_UP_EVERY_CHOICES = Object.freeze(['night', 'week']);

export const TIDY_UP_EVERY_LABELS = Object.freeze({
  night: 'Each night after 3 AM',
  week: 'Once a week, after 3 AM',
});

/** Local hours during which overnight tidy-up runs. */
export const TIDY_UP_HOURS = Object.freeze({ from: 3, until: 8 });

export const TIDY_UP_LIMITS = Object.freeze({
  maxIndexLines: MEMORY_LOAD_LIMIT,
  maxFiledLines: 20,
  maxAddedMargin: 6,
  maxRemovedRatio: 0.2,
  minRetainedBaseline: 60,
});

export const TIDY_UP_RETIRE_REASONS = Object.freeze([
  'stale',
  'done',
  'wrong',
  'not-a-lesson',
]);

export const TIDY_UP_ERRORS = Object.freeze({
  asleep: 'The computer was asleep.',
  unreadChats: "The last tidy-up couldn't read its chats, so it didn't run.",
  noDraft: "The last tidy-up didn't reply with a new MEMORY.md.",
  badTopic: "The last tidy-up named a topic file that can't be written, so nothing changed.",
  tooLong: "The last tidy-up's MEMORY.md was over 200 lines, so nothing changed.",
  tooManyRemoved: 'The last tidy-up took out too many lines at once, so nothing changed.',
  tooManyAdded: 'The last tidy-up added too many new lines at once, so nothing changed.',
  notCopied: "The last tidy-up filed a line MEMORY.md doesn't have; new facts go in MEMORY.md, so nothing changed.",
  tooManyFiled: 'The last tidy-up filed more than 20 lines at once, so nothing changed.',
  changed: 'MEMORY.md changed during the last tidy-up, so nothing changed.',
  notApplied: "The last tidy-up's changes couldn't be saved, so nothing changed.",
});

export const TIDY_UP_NOTE_PRESENTATION = 'tidy-up';
export const TIDY_UP_NOTE_COPY = Object.freeze({
  tidied: 'Tidied memory · {{count}} changes',
});

const TOPIC_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LINE_REF_RE = /^L(\d+)#([0-9a-f]{4})$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- Pure-JS SHA-256 (for 4-hex line refs without Node `crypto` dependency) ----

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** @param {string} str */
function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if ((code & 0xfc00) === 0xd800 && i + 1 < str.length && (str.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      i += 1;
      code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

/**
 * @param {unknown} text
 * @param {number} [hexLen]
 */
function sha256HexPrefix(text, hexLen = 4) {
  const bytes = utf8Bytes(String(text ?? ''));
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const msg = new Uint8Array(paddedLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25))
        ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14))
        ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15))
        ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13))
        ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  const hex = [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
  return hex.slice(0, hexLen);
}

/**
 * Checks whether a candidate line count satisfies the 200-line cap.
 * Fixes the >200-line deadlock: when `beforeLines` is already over `maxLines`,
 * any strict net reduction (`afterLines < beforeLines`) is accepted so multi-round
 * slimming can bring MEMORY.md back under 200 lines.
 * @param {number} beforeLines
 * @param {number} afterLines
 * @param {number} [maxLines]
 */
export function isTidyUpLineCountAllowed(beforeLines, afterLines, maxLines = TIDY_UP_LIMITS.maxIndexLines) {
  if (afterLines <= maxLines) {
    return true;
  }
  return beforeLines > maxLines && afterLines < beforeLines;
}

export function botTidyUp(bot) {
  const since = bot?.tidyUp?.since;
  return {
    on: bot?.tidyUp?.on ?? true,
    every: bot?.tidyUp?.every ?? 'night',
    ...(since !== undefined ? { since } : {}),
  };
}

export function patchTidyUp(current, patch, now = Date.now()) {
  const on = patch?.on ?? current.on;
  const since = on && !current.on ? now : current.since;
  return {
    on,
    every: patch?.every ?? current.every,
    ...(since !== undefined ? { since } : {}),
  };
}

export function tidyUpChangeCount(summary) {
  if (!summary) {
    return 0;
  }
  const filedCount = (summary.filed ?? []).reduce((sum, entry) => sum + (entry.count ?? 0), 0);
  return (
    (summary.learned?.length ?? 0)
    + (summary.replaced?.length ?? 0)
    + filedCount
    + (summary.moved ?? 0)
    + (summary.merged ?? 0)
    + (summary.retired ?? 0)
  );
}

export function tidyUpNoteText(note) {
  return TIDY_UP_NOTE_COPY.tidied.replace('{{count}}', String(note.changes));
}

export function tidyUpNoteBody(note) {
  return {
    kind: 'status',
    text: tidyUpNoteText(note),
    presentation: TIDY_UP_NOTE_PRESENTATION,
    tidyUp: note,
  };
}

export function tidyUpNoteOf(body) {
  if (!body || typeof body !== 'object' || !('tidyUp' in body)) {
    return null;
  }
  const value = body.tidyUp;
  if (!value || typeof value !== 'object') {
    return null;
  }
  return typeof value.botId === 'string' && typeof value.changes === 'number'
    ? { botId: value.botId, changes: value.changes }
    : null;
}

/** Returns local timestamp of the start of the most recent 3 AM window at or before `now`. */
export function tidyUpWindowStart(now = Date.now()) {
  const start = new Date(now);
  start.setHours(TIDY_UP_HOURS.from, 0, 0, 0);
  if (start.getTime() > now) {
    start.setDate(start.getDate() - 1);
    start.setHours(TIDY_UP_HOURS.from, 0, 0, 0);
  }
  return start.getTime();
}

/** True when a scheduled tidy-up run is due for the current night/week window. */
export function isTidyUpDue(state, now = Date.now(), every = 'night', since = 0) {
  const windowStart = tidyUpWindowStart(now);
  const windowEnd = new Date(windowStart);
  windowEnd.setHours(TIDY_UP_HOURS.until, 0, 0, 0);
  const inWindow = now < windowEnd.getTime();
  const runs = state?.runs ?? [];
  const ranInWindow = runs.some((run) => run.startedAt >= windowStart && run.asleep !== true && !run.usageLimited);
  if (ranInWindow || (state?.checkedAt ?? 0) >= windowStart) {
    return false;
  }
  if (!inWindow && since > windowStart) {
    return false;
  }
  if (every === 'night') {
    return true;
  }
  return (state?.through ?? 0) < windowStart - 6 * DAY_MS;
}

function lineKeySet(lines) {
  return new Set(lines.flatMap((line) => {
    const key = botMemoryLineKey(line);
    return key === null ? [] : [key];
  }));
}

/**
 * Parses a Tidy-up model reply containing:
 * - `BEGIN MEMORY.md` ... `END MEMORY.md`
 * - `BEGIN memory/<topic>.md` ... `END memory/<topic>.md`
 * - `BEGIN REPLACED` ... `END REPLACED`
 */
export function parseTidyUpResponse(reply) {
  if (typeof reply !== 'string' || !reply) {
    return null;
  }
  const blocks = new Map();
  let current = null;
  for (const raw of reply.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (current && trimmed === `END ${current.name}`) {
      blocks.set(current.name, current.lines);
      current = null;
    } else if (current) {
      current.lines.push(raw);
    } else if (trimmed.startsWith('BEGIN ')) {
      current = { name: trimmed.slice(6).trim(), lines: [] };
    }
  }
  const indexLines = blocks.get('MEMORY.md');
  if (!indexLines) {
    return null;
  }
  const cleanLines = (lines) => lines.map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
  const topics = new Map();
  for (const [name, lines] of blocks) {
    const match = /^memory\/(.+)\.md$/.exec(name);
    if (match?.[1] !== undefined) {
      topics.set(match[1], cleanLines(lines));
    }
  }
  return {
    index: `${indexLines.join('\n').trimEnd()}\n`,
    topics,
    replaced: cleanLines(blocks.get('REPLACED') ?? []),
  };
}

function validateTopicBlocks(currentMemory, topics) {
  for (const topic of topics.keys()) {
    if (topic === 'archive' || !TOPIC_NAME_RE.test(topic)) {
      return { refused: TIDY_UP_ERRORS.badTopic, code: 'badTopic' };
    }
  }
  const existingByKey = new Map();
  for (const entry of scanBotMemoryLines(currentMemory).entries) {
    if (!entry.fact) continue;
    const key = botMemoryLineKey(entry.raw);
    if (key !== null && !existingByKey.has(key)) {
      existingByKey.set(key, entry.raw.trimEnd());
    }
  }
  const validatedTopics = new Map();
  let filedCount = 0;
  for (const [topic, lines] of topics) {
    const mapped = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (i === 0 && line.startsWith('# ')) {
        mapped.push(line);
        continue;
      }
      const key = botMemoryLineKey(line);
      const original = key !== null ? existingByKey.get(key) : undefined;
      if (original === undefined) {
        return { refused: TIDY_UP_ERRORS.notCopied, code: 'notCopied' };
      }
      mapped.push(original);
      filedCount += 1;
    }
    validatedTopics.set(topic, mapped);
  }
  if (filedCount > TIDY_UP_LIMITS.maxFiledLines) {
    return { refused: TIDY_UP_ERRORS.tooManyFiled, code: 'tooManyFiled' };
  }
  return { ok: true, topics: validatedTopics };
}

/**
 * Validates a parsed Tidy-up response against all safety guardrails:
 * 1. New `MEMORY.md` <= 200 lines (or strictly shorter when already > 200 lines).
 * 2. Valid topic filenames (never `archive`).
 * 3. Newly added lines containing secrets are stripped.
 * 4. Topic lines must already exist in `MEMORY.md` (no inventing topic facts).
 * 5. At most 20 lines filed to topics per run.
 * 6. Undated facts are never dropped automatically.
 * 7. Removed lines (excluding filed lines) <= `max(ceil(total / 5), total - 60)` (<= 20% guard).
 * 8. Added lines <= `removed + 6`.
 */
export function validateTidyUpPlan(currentMemory, parsed) {
  if (!parsed) {
    return { ok: false, refused: TIDY_UP_ERRORS.noDraft, code: 'noDraft' };
  }
  const beforeLines = countBotMemoryLines(currentMemory);
  const afterLines = countBotMemoryLines(parsed.index);
  if (!isTidyUpLineCountAllowed(beforeLines, afterLines)) {
    return { ok: false, refused: TIDY_UP_ERRORS.tooLong, code: 'tooLong' };
  }
  const topicCheck = validateTopicBlocks(currentMemory, parsed.topics);
  if (!topicCheck.ok) {
    return { ok: false, refused: topicCheck.refused, code: topicCheck.code };
  }

  // Strip newly added lines that contain secret-like tokens.
  const secretAdded = new Set(
    diffMemoryLines(currentMemory, parsed.index).added
      .map(({ line }) => line)
      .filter((line) => redactSecretLike(line) !== line),
  );
  const safeIndex = parsed.index.split('\n').filter((line) => !secretAdded.has(line)).join('\n');

  const rawDiff = diffMemoryLines(currentMemory, safeIndex);
  const undatedKeys = lineKeySet(
    parseBotMemoryFacts(currentMemory)
      .filter((fact) => fact.date === null)
      .map((fact) => `- ${fact.text}`),
  );
  const change = {
    added: rawDiff.added,
    removed: rawDiff.removed.filter(({ line }) => !undatedKeys.has(botMemoryLineKey(line) ?? '')),
  };

  const filedKeys = lineKeySet([...topicCheck.topics.values()].flat());
  const nonFiledRemoved = change.removed.filter(({ line }) => !filedKeys.has(botMemoryLineKey(line) ?? ''));
  const totalFacts = parseBotMemoryFacts(currentMemory).length;
  const maxRemovable = Math.max(
    Math.ceil(totalFacts * TIDY_UP_LIMITS.maxRemovedRatio),
    totalFacts - TIDY_UP_LIMITS.minRetainedBaseline,
  );
  if (nonFiledRemoved.length > maxRemovable) {
    return { ok: false, refused: TIDY_UP_ERRORS.tooManyRemoved, code: 'tooManyRemoved' };
  }
  if (change.added.length > change.removed.length + TIDY_UP_LIMITS.maxAddedMargin) {
    return { ok: false, refused: TIDY_UP_ERRORS.tooManyAdded, code: 'tooManyAdded' };
  }

  const kept = new Map();
  for (const entry of scanBotMemoryLines(safeIndex).entries) {
    if (!entry.fact) continue;
    const key = botMemoryLineKey(entry.raw);
    if (key !== null && !kept.has(key)) {
      kept.set(key, entry.raw);
    }
  }
  return {
    ok: true,
    plan: {
      change,
      kept,
      topics: topicCheck.topics,
      filed: filedKeys,
      replaced: lineKeySet(parsed.replaced),
    },
  };
}

function collectDuplicateFacts(latestMemory, plan) {
  const removedKeys = lineKeySet(plan.change.removed.map(({ line }) => line));
  const counts = new Map();
  const anchors = new Map();
  let previous = null;
  for (const entry of scanBotMemoryLines(latestMemory).entries) {
    const key = entry.fact ? botMemoryLineKey(entry.raw) : null;
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!anchors.has(key)) {
        anchors.set(key, previous);
      }
    }
    previous = entry.raw.trim() === '' ? previous : entry.raw;
  }
  const deduped = [];
  for (const [key, count] of counts) {
    const line = plan.kept.get(key);
    if (count > 1 && line !== undefined && !removedKeys.has(key)) {
      deduped.push({ line, after: anchors.get(key) ?? null });
    }
  }
  return deduped;
}

function buildArchiveOutput(plan, today) {
  const archiveLines = [];
  const replacedTexts = [];
  let movedCount = 0;
  for (const { line } of plan.change.removed) {
    const key = botMemoryLineKey(line);
    if (key === null || plan.filed.has(key)) {
      continue;
    }
    if (plan.replaced.has(key)) {
      const [parsedFact] = parseBotMemoryFacts(line);
      const datePrefix = parsedFact?.date ? `${parsedFact.date} ` : '';
      const text = parsedFact?.text ?? line.trim();
      replacedTexts.push(text);
      archiveLines.push(`- ${datePrefix}~~${text}~~ · replaced ${today}`);
    } else {
      movedCount += 1;
      archiveLines.push(`${line.trimEnd()} · moved ${today}`);
    }
  }
  return { archiveLines, replacedTexts, movedCount };
}

/**
 * Applies a validated Tidy-up plan onto the latest `MEMORY.md` on disk, detecting concurrent
 * edits to removed lines, preserving concurrent additions, deduplicating kept facts,
 * enforcing the 200-line cap (allowing strict net reduction when already >200 lines),
 * and producing `memory/archive.md` lines.
 */
export function applyTidyUpPlan(latestMemory, plan, today) {
  const latestKeys = botMemoryFactKeys(latestMemory);
  if (plan.change.removed.some(({ line }) => !latestKeys.has(botMemoryLineKey(line) ?? ''))) {
    return { ok: false, refused: TIDY_UP_ERRORS.changed, code: 'changed' };
  }
  const deduped = collectDuplicateFacts(latestMemory, plan);
  const mergedChange = mergeBotMemoryChanges(plan.change, { added: deduped, removed: deduped });
  const nextIndex = applyBotMemoryChange(latestMemory, mergedChange);
  if (!isTidyUpLineCountAllowed(countBotMemoryLines(latestMemory), countBotMemoryLines(nextIndex))) {
    return { ok: false, refused: TIDY_UP_ERRORS.tooLong, code: 'tooLong' };
  }
  const { archiveLines, replacedTexts, movedCount } = buildArchiveOutput(plan, today);
  return {
    ok: true,
    index: nextIndex,
    change: mergedChange,
    topics: plan.topics,
    archiveLines,
    stats: {
      learned: plan.change.added.map(({ line }) => line),
      replaced: replacedTexts,
      filed: [...plan.topics.entries()].map(([topic, lines]) => ({
        topic,
        count: lines.filter((line) => !line.startsWith('# ')).length,
      })),
      moved: movedCount,
      merged: deduped.length,
    },
  };
}

// ---- Structured Ops Mode (`L<n>#<4hex>`, merge / retire / demote) ----

/**
 * Computes the deterministic `L<1-based-line>#<4hex>` reference for a line.
 * @param {number} lineNumber 1-based line number
 * @param {string} rawLine
 */
export function memoryLineRef(lineNumber, rawLine) {
  const hash = sha256HexPrefix(String(rawLine ?? '').trimEnd(), 4);
  return `L${lineNumber}#${hash}`;
}

/**
 * Numbers every line of `MEMORY.md` with `L<n>#<4hex>` references for structured Ops mode.
 * @param {string} text
 */
export function numberMemoryLinesForOps(text) {
  const scanned = scanBotMemoryLines(text);
  const entries = [];
  const byRef = new Map();
  const formatted = [];

  for (const entry of scanned.entries) {
    const lineNumber = entry.line + 1;
    const rawTrimmed = entry.raw.trimEnd();
    const hash = sha256HexPrefix(rawTrimmed, 4);
    const ref = `L${lineNumber}#${hash}`;
    const item = {
      ref,
      lineNumber,
      lineIndex: entry.line,
      hash,
      raw: entry.raw,
      inFence: entry.inFence,
      fact: entry.fact,
    };
    entries.push(item);
    byRef.set(ref.toLowerCase(), item);
    formatted.push(`${ref} | ${entry.raw}`);
  }

  return {
    numbered: formatted.join('\n'),
    entries,
    byRef,
    eol: scanned.eol,
  };
}

/**
 * Extracts a structured Ops array from a model reply:
 * supports raw JSON array, `{ ops: [...] }`, fenced `json` code block, or `BEGIN OPS ... END OPS`.
 * Returns `null` if the reply is not a structured Ops payload (e.g. legacy `BEGIN MEMORY.md` draft).
 * @param {string} reply
 */
export function parseTidyUpOpsResponse(reply) {
  if (typeof reply !== 'string' || !reply.trim()) {
    return null;
  }
  const trimmed = reply.trim();
  // Do not misinterpret legacy draft responses as ops
  if (/^BEGIN\s+MEMORY\.md\b/m.test(trimmed) && !/^BEGIN\s+OPS\b/m.test(trimmed)) {
    return null;
  }

  const candidates = [];
  const beginOps = /BEGIN\s+OPS\s*\r?\n([\s\S]*?)\r?\nEND\s+OPS/i.exec(trimmed);
  if (beginOps) {
    candidates.push(beginOps[1].trim());
  }
  const fencedJson = /```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/i.exec(trimmed);
  if (fencedJson) {
    candidates.push(fencedJson[1].trim());
  }
  candidates.push(trimmed);

  for (const raw of candidates) {
    if (!raw || (raw[0] !== '[' && raw[0] !== '{')) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.ops)) {
        return parsed.ops;
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

/**
 * @param {unknown} ref
 * @param {Map<string, any>} byRef
 */
function resolveRef(ref, byRef) {
  if (typeof ref !== 'string') return null;
  const clean = ref.trim();
  if (!LINE_REF_RE.test(clean)) return null;
  return byRef.get(clean.toLowerCase()) ?? null;
}

/** @param {string} raw */
function isSecretProtectedLine(raw) {
  return containsSecretLike(raw) || redactSecretLike(raw) !== raw;
}

/**
 * @param {any} entry
 * @param {{ allowUndated?: boolean, allowStandingRules?: boolean }} [options]
 */
function checkLineProtection(entry, options = {}) {
  if (!entry || !entry.fact) {
    return { protected: true, reason: 'not_a_fact' };
  }
  if (isSecretProtectedLine(entry.raw)) {
    return { protected: true, reason: 'secret_protected' };
  }
  if (!options.allowUndated && entry.fact.date === null) {
    return { protected: true, reason: 'undated_protected' };
  }
  if (!options.allowStandingRules && isStandingOwnerRule(entry.fact)) {
    return { protected: true, reason: 'owner_rule_protected' };
  }
  return { protected: false, reason: null };
}

/**
 * @param {any} entry
 * @param {string} reason
 */
function isSalvageCandidate(entry, reason) {
  if (!entry?.fact) return false;
  if (isSecretProtectedLine(entry.raw)) return false;
  return (
    isLessonMemoryLine(entry.fact)
    || isOwnerDecisionLine(entry.fact)
    || isStandingOwnerRule(entry.fact)
    || reason === 'not-a-lesson'
  );
}

/**
 * Validates and applies structured Tidy-Up Ops (`merge`, `retire`, `demote`) against
 * `currentMemory` (with optional `latestMemory` for concurrent external additions).
 *
 * Guarantees:
 * - Each bad/mismatched/protected op is skipped individually without failing valid ops.
 * - Protects standing owner rules, undated rules, and secret-like lines.
 * - Never invents new lines; preserves salvage candidates.
 * - Enforces <= 20 filed lines, <= 20% removal budget, and >200-line net-reduction rule.
 *
 * @param {string} currentMemory
 * @param {Array<Record<string, any>>} ops
 * @param {{ latestMemory?: string, today?: string, allowProtectedRetire?: boolean }} [options]
 */
export function applyTidyUpOps(currentMemory, ops, options = {}) {
  if (!Array.isArray(ops)) {
    return { ok: false, refused: TIDY_UP_ERRORS.noDraft, code: 'noDraft' };
  }
  const latestMemory = typeof options.latestMemory === 'string' ? options.latestMemory : currentMemory;
  const today = options.today ?? botMemoryDate(new Date());
  const numbered = numberMemoryLinesForOps(currentMemory);
  const { entries, byRef } = numbered;

  // Map live lines in latestMemory by trimmed content & fact key so concurrent additions survive
  const latestScanned = scanBotMemoryLines(latestMemory);
  const latestFactLines = new Set(
    latestScanned.entries.filter((e) => e.fact).map((e) => e.raw.trimEnd()),
  );
  const totalFacts = entries.filter((e) => e.fact).length;
  const maxRemovable = Math.max(
    Math.ceil(totalFacts * TIDY_UP_LIMITS.maxRemovedRatio),
    totalFacts - TIDY_UP_LIMITS.minRetainedBaseline,
  );

  const removedRefs = new Set();
  const removedLineSet = new Set();
  const topics = new Map();
  const archiveLines = [];
  const salvage = [];
  const appliedOps = [];
  const skippedOps = [];
  const replacedTexts = [];
  let filedCount = 0;
  let nonFiledRemovedCount = 0;
  let mergedCount = 0;
  let retiredCount = 0;

  /** @param {{ raw: string }} entry */
  const isStillLive = (entry) => latestFactLines.has(entry.raw.trimEnd());

  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (!op || typeof op !== 'object') {
      skippedOps.push({ index, op: null, reason: 'invalid_op' });
      continue;
    }
    const kind = String(op.op ?? op.type ?? '').trim().toLowerCase();

    if (kind === 'merge') {
      const keepRef = op.keep ?? op.into;
      const dropList = Array.isArray(op.drop)
        ? op.drop
        : (Array.isArray(op.lines) ? op.lines : (typeof op.drop === 'string' ? [op.drop] : []));
      const keepEntry = resolveRef(keepRef, byRef);
      if (!keepEntry || !keepEntry.fact || removedRefs.has(keepEntry.ref) || !isStillLive(keepEntry)) {
        skippedOps.push({ index, op, reason: 'bad_keep_ref', ref: keepRef });
        continue;
      }
      if (isSecretProtectedLine(keepEntry.raw)) {
        skippedOps.push({ index, op, reason: 'secret_protected', ref: keepRef });
        continue;
      }
      if (dropList.length === 0) {
        skippedOps.push({ index, op, reason: 'empty_drop' });
        continue;
      }
      const keepIsRule = isStandingOwnerRule(keepEntry.fact);
      const dropped = [];
      for (const dRef of dropList) {
        const dropEntry = resolveRef(dRef, byRef);
        if (!dropEntry || !dropEntry.fact) {
          skippedOps.push({ index, op, reason: 'bad_ref', ref: dRef });
          continue;
        }
        if (dropEntry.ref === keepEntry.ref || removedRefs.has(dropEntry.ref)) {
          skippedOps.push({ index, op, reason: 'duplicate_or_self_ref', ref: dRef });
          continue;
        }
        if (!isStillLive(dropEntry)) {
          skippedOps.push({ index, op, reason: 'line_changed_on_disk', ref: dRef });
          continue;
        }
        const prot = checkLineProtection(dropEntry, {
          allowUndated: false,
          allowStandingRules: keepIsRule || Boolean(options.allowProtectedRetire),
        });
        if (prot.protected) {
          skippedOps.push({ index, op, reason: prot.reason, ref: dRef });
          continue;
        }
        if (nonFiledRemovedCount + 1 > maxRemovable) {
          skippedOps.push({ index, op, reason: 'removal_limit_reached', ref: dRef });
          continue;
        }
        removedRefs.add(dropEntry.ref);
        removedLineSet.add(dropEntry.raw.trimEnd());
        nonFiledRemovedCount += 1;
        mergedCount += 1;
        dropped.push(dropEntry.ref);
        archiveLines.push(`${dropEntry.raw.trimEnd()} · merged ${today}`);
      }
      if (dropped.length > 0) {
        appliedOps.push({ op: 'merge', keep: keepEntry.ref, drop: dropped });
      }
      continue;
    }

    if (kind === 'retire') {
      const reason = String(op.reason ?? '').trim().toLowerCase();
      if (!TIDY_UP_RETIRE_REASONS.includes(reason)) {
        skippedOps.push({ index, op, reason: 'invalid_retire_reason' });
        continue;
      }
      const refs = Array.isArray(op.lines)
        ? op.lines
        : (typeof op.line === 'string' ? [op.line] : []);
      if (refs.length === 0) {
        skippedOps.push({ index, op, reason: 'missing_line_ref' });
        continue;
      }
      const retiredRefs = [];
      for (const ref of refs) {
        const entry = resolveRef(ref, byRef);
        if (!entry || !entry.fact) {
          skippedOps.push({ index, op, reason: 'bad_ref', ref });
          continue;
        }
        if (removedRefs.has(entry.ref)) {
          skippedOps.push({ index, op, reason: 'already_handled', ref });
          continue;
        }
        if (!isStillLive(entry)) {
          skippedOps.push({ index, op, reason: 'line_changed_on_disk', ref });
          continue;
        }
        const prot = checkLineProtection(entry, {
          allowUndated: false,
          allowStandingRules: Boolean(options.allowProtectedRetire),
        });
        if (prot.protected) {
          skippedOps.push({ index, op, reason: prot.reason, ref });
          if (prot.reason === 'owner_rule_protected' && !isSecretProtectedLine(entry.raw)) {
            salvage.push({
              ref: entry.ref,
              line: entry.raw.trimEnd(),
              reason,
              kind: entry.fact.kind ?? 'rule',
              protected: true,
            });
          }
          continue;
        }
        if (nonFiledRemovedCount + 1 > maxRemovable) {
          skippedOps.push({ index, op, reason: 'removal_limit_reached', ref });
          continue;
        }
        removedRefs.add(entry.ref);
        removedLineSet.add(entry.raw.trimEnd());
        nonFiledRemovedCount += 1;
        retiredCount += 1;
        retiredRefs.push(entry.ref);

        if (isSalvageCandidate(entry, reason)) {
          salvage.push({
            ref: entry.ref,
            line: entry.raw.trimEnd(),
            reason,
            kind: entry.fact.kind ?? 'lesson',
            protected: false,
          });
        }
        if (reason === 'wrong') {
          const datePrefix = entry.fact.date ? `${entry.fact.date} ` : '';
          replacedTexts.push(entry.fact.text);
          archiveLines.push(`- ${datePrefix}~~${entry.fact.text}~~ · replaced ${today}`);
        } else {
          archiveLines.push(`${entry.raw.trimEnd()} · moved ${today}`);
        }
      }
      if (retiredRefs.length > 0) {
        appliedOps.push({ op: 'retire', lines: retiredRefs, reason });
      }
      continue;
    }

    if (kind === 'demote') {
      const topic = String(op.topic ?? '').trim();
      if (!topic || topic === 'archive' || !TOPIC_NAME_RE.test(topic)) {
        skippedOps.push({ index, op, reason: 'bad_topic' });
        continue;
      }
      const targetEntries = [];
      if (Array.isArray(op.lines)) {
        for (const ref of op.lines) {
          const entry = resolveRef(ref, byRef);
          if (!entry) {
            skippedOps.push({ index, op, reason: 'bad_ref', ref });
          } else {
            targetEntries.push(entry);
          }
        }
      } else if (typeof op.line === 'string') {
        const entry = resolveRef(op.line, byRef);
        if (!entry) {
          skippedOps.push({ index, op, reason: 'bad_ref', ref: op.line });
        } else {
          targetEntries.push(entry);
        }
      }
      if (op.range) {
        const fromRef = Array.isArray(op.range) ? op.range[0] : op.range.from;
        const toRef = Array.isArray(op.range) ? op.range[1] : op.range.to;
        const fromEntry = resolveRef(fromRef, byRef);
        const toEntry = resolveRef(toRef, byRef);
        if (!fromEntry || !toEntry || fromEntry.lineIndex > toEntry.lineIndex) {
          skippedOps.push({ index, op, reason: 'bad_range' });
          continue;
        }
        for (let i = fromEntry.lineIndex; i <= toEntry.lineIndex; i += 1) {
          if (entries[i]?.fact) {
            targetEntries.push(entries[i]);
          }
        }
      }
      if (targetEntries.length === 0) {
        skippedOps.push({ index, op, reason: 'empty_demote_targets' });
        continue;
      }
      const demotedRefs = [];
      for (const entry of targetEntries) {
        if (!entry.fact) {
          skippedOps.push({ index, op, reason: 'not_a_fact', ref: entry.ref });
          continue;
        }
        if (removedRefs.has(entry.ref)) {
          skippedOps.push({ index, op, reason: 'already_handled', ref: entry.ref });
          continue;
        }
        if (!isStillLive(entry)) {
          skippedOps.push({ index, op, reason: 'line_changed_on_disk', ref: entry.ref });
          continue;
        }
        const prot = checkLineProtection(entry, {
          allowUndated: false,
          allowStandingRules: Boolean(options.allowProtectedRetire),
        });
        if (prot.protected) {
          skippedOps.push({ index, op, reason: prot.reason, ref: entry.ref });
          continue;
        }
        if (filedCount + 1 > TIDY_UP_LIMITS.maxFiledLines) {
          skippedOps.push({ index, op, reason: 'filed_limit_reached', ref: entry.ref });
          continue;
        }
        removedRefs.add(entry.ref);
        removedLineSet.add(entry.raw.trimEnd());
        filedCount += 1;
        demotedRefs.push(entry.ref);
        const list = topics.get(topic) ?? [];
        list.push(entry.raw.trimEnd());
        topics.set(topic, list);
      }
      if (demotedRefs.length > 0) {
        appliedOps.push({ op: 'demote', lines: demotedRefs, topic });
      }
      continue;
    }

    skippedOps.push({ index, op, reason: 'unknown_op' });
  }

  // Apply accepted removals onto latestMemory (concurrent additions remain untouched)
  const keptLines = [];
  const removedChangeRows = [];
  let prevAnchor = null;
  for (const entry of latestScanned.entries) {
    const trimmed = entry.raw.trimEnd();
    if (entry.fact && removedLineSet.has(trimmed)) {
      removedLineSet.delete(trimmed);
      removedChangeRows.push({ line: entry.raw, after: prevAnchor });
      continue;
    }
    keptLines.push(entry.raw);
    if (entry.raw.trim() !== '') {
      prevAnchor = entry.raw;
    }
  }
  const nextIndex = keptLines.join(latestScanned.eol);
  const beforeCount = countBotMemoryLines(latestMemory);
  const afterCount = countBotMemoryLines(nextIndex);
  if (appliedOps.length > 0 && !isTidyUpLineCountAllowed(beforeCount, afterCount)) {
    return { ok: false, refused: TIDY_UP_ERRORS.tooLong, code: 'tooLong' };
  }

  return {
    ok: true,
    mode: 'ops',
    index: nextIndex,
    change: { added: [], removed: removedChangeRows },
    topics,
    archiveLines,
    salvage,
    appliedOps,
    skippedOps,
    stats: {
      learned: [],
      replaced: replacedTexts,
      filed: [...topics.entries()].map(([topic, lines]) => ({
        topic,
        count: lines.length,
      })),
      moved: retiredCount - replacedTexts.length,
      merged: mergedCount,
      retired: retiredCount,
    },
  };
}

export const validateAndApplyTidyUpOps = applyTidyUpOps;
