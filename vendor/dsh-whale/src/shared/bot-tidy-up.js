// Overnight memory Tidy-up response block parser, safety guardrails, and plan applicator.

import {
  MEMORY_LOAD_LIMIT,
  applyBotMemoryChange,
  botMemoryFactKeys,
  botMemoryLineKey,
  countBotMemoryLines,
  diffMemoryLines,
  mergeBotMemoryChanges,
  parseBotMemoryFacts,
  redactSecretLike,
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
const DAY_MS = 24 * 60 * 60 * 1000;

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
  for (const raw of currentMemory.split(/\r?\n/)) {
    const key = botMemoryLineKey(raw);
    if (key !== null && !existingByKey.has(key)) {
      existingByKey.set(key, raw.trimEnd());
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
 * Validates a parsed Tidy-up response against all Orca safety guardrails:
 * 1. New `MEMORY.md` <= 200 lines.
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
  if (countBotMemoryLines(parsed.index) > TIDY_UP_LIMITS.maxIndexLines) {
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
  for (const line of safeIndex.split('\n')) {
    const key = botMemoryLineKey(line);
    if (key !== null && !kept.has(key)) {
      kept.set(key, line);
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
  for (const raw of latestMemory.split(/\r?\n/)) {
    const key = botMemoryLineKey(raw);
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!anchors.has(key)) {
        anchors.set(key, previous);
      }
    }
    previous = raw.trim() === '' ? previous : raw;
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
 * edits, deduplicating duplicate kept facts, enforcing the 200-line cap, and producing
 * `memory/archive.md` lines (`· moved YYYY-MM-DD` or `~~fact~~ · replaced YYYY-MM-DD`).
 */
export function applyTidyUpPlan(latestMemory, plan, today) {
  const latestKeys = botMemoryFactKeys(latestMemory);
  if (plan.change.removed.some(({ line }) => !latestKeys.has(botMemoryLineKey(line) ?? ''))) {
    return { ok: false, refused: TIDY_UP_ERRORS.changed, code: 'changed' };
  }
  const deduped = collectDuplicateFacts(latestMemory, plan);
  const mergedChange = mergeBotMemoryChanges(plan.change, { added: deduped, removed: deduped });
  const nextIndex = applyBotMemoryChange(latestMemory, mergedChange);
  if (countBotMemoryLines(nextIndex) > TIDY_UP_LIMITS.maxIndexLines) {
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
