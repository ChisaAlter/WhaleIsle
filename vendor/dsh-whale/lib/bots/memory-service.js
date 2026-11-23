/**
 * Bot Memory Service (`MEMORY.md`, `memory/<topic>.md`, `memory/YYYY-MM-DD.md`,
 * `memory/archive.md`, `memory/journal/YYYY-MM.md`, `_meta/team-memory/<groupId>.md`,
 * FTS5 index, and `_meta/bot-memory-history/<encodedBotId>.json`).
 *
 * Combines Memory 2.0 guardrails (200-line prompt window, fence-aware parsing,
 * turn-end tamper restore, 14-day Re-add Guard, provenance tagging, secret
 * redaction, supersede-aware undo, zero-LLM monthly journal + 24h backfill,
 * pre-tidy status migration, and Ops/Draft tidy-up) with SQLite FTS5
 * incremental indexing (BM25 x time decay), daily logs, pre-compaction flush,
 * and team shared memory.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  containsSecretLike,
  isLessonMemoryLine,
  isOwnerDecisionLine,
  isStandingOwnerRule,
  scanBotMemoryLines,
} from '../../src/shared/bot-memory-lines.js';
import {
  appendDailyMemory,
  dailyMemoryRelPath,
  readDailyMemory,
  readTeamMemory as readTeamMemoryFile,
  sha256Hex,
  writeAtomicFile,
  writeTeamMemory as writeTeamMemoryFile,
} from './fs-home.js';
import { createMemoryFtsAccess, syncDocumentToFts } from './memory-fts.js';
import {
  BotMemoryError,
  MEMORY_MAX_LOADED_LINES,
  MEMORY_SOURCE_SEPARATOR,
  appendArchiveLines,
  collectFactEntries,
  formatFactLine,
  isoDate,
  joinLines,
  normalizeFactKey,
  parseMemoryLine,
  readMemoryForPrompt,
  readMemoryRaw,
  redactSecrets,
  sanitizeFactBody,
  sanitizeSourceLabel,
  splitLines,
  writeMemoryRaw,
} from './memory-helpers.js';
import {
  JOURNAL_CAS_MAX_RETRIES,
  appendJournalEntry,
  backfillJournal24h,
  formatJournalItemLine,
} from './memory-journal.js';
import {
  READD_GUARD_WINDOW_MS,
  READD_OWNER_OVERLAP_THRESHOLD,
  READD_SIMILARITY_THRESHOLD,
  countStatusSignals,
  evaluateReaddGuard,
  memoryTextSimilarity,
  ownerMessageOverlap,
  readRecentArchivedFacts,
} from './memory-readd.js';
import {
  TIDY_MAX_ARCHIVE_LINES,
  TIDY_MAX_DELETE_RATIO,
  executeTidyUpDraft,
  executeTidyUpOps,
  parseTidyUpOutput,
} from './memory-tidy.js';

export const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const HISTORY_MAX_ENTRIES = 1000;

export {
  BotMemoryError,
  JOURNAL_CAS_MAX_RETRIES,
  MEMORY_MAX_LOADED_LINES,
  MEMORY_SOURCE_SEPARATOR,
  READD_GUARD_WINDOW_MS,
  READD_OWNER_OVERLAP_THRESHOLD,
  READD_SIMILARITY_THRESHOLD,
  TIDY_MAX_ARCHIVE_LINES,
  TIDY_MAX_DELETE_RATIO,
  appendJournalEntry,
  backfillJournal24h,
  countStatusSignals,
  formatFactLine,
  formatJournalItemLine,
  memoryTextSimilarity,
  normalizeFactKey,
  ownerMessageOverlap,
  parseMemoryLine,
  parseTidyUpOutput,
  readMemoryForPrompt,
  readRecentArchivedFacts,
  redactSecrets,
  sanitizeFactBody,
};

/**
 * @param {string[]} working
 * @param {string[]} beforeLines
 * @param {number} origIdx
 * @param {string} rawLine
 */
function insertRestoredLine(working, beforeLines, origIdx, rawLine) {
  for (let i = origIdx - 1; i >= 0; i -= 1) {
    const pos = working.indexOf(beforeLines[i]);
    if (pos !== -1) {
      working.splice(pos + 1, 0, rawLine);
      return;
    }
  }
  working.splice(Math.min(origIdx, working.length), 0, rawLine);
}

/** @param {string[]} entries */
function redactList(entries) {
  let anyRedacted = false;
  const sanitized = (entries ?? []).map((item) => {
    const res = redactSecrets(item);
    if (res.redacted) anyRedacted = true;
    return res.text;
  });
  return { sanitized, anyRedacted };
}

/** @param {any} entry */
function extractEntryFactKeys(entry) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const line of [...(entry.added ?? []), ...(entry.removed ?? []), ...(entry.kept ?? [])]) {
    const parsed = parseMemoryLine(line);
    if (parsed.isFact && parsed.key) keys.add(parsed.key);
  }
  return keys;
}

/**
 * Restore facts removed without `forgetFact` back into `workingLines`.
 * @param {string[]} workingLines
 * @param {string[]} beforeLines
 * @param {Array<{ key: string, raw: string, index: number }>} beforeFacts
 * @param {Set<string>} afterKeySet
 * @param {Set<string>} forgottenSet
 */
function restoreDeletedFacts(workingLines, beforeLines, beforeFacts, afterKeySet, forgottenSet) {
  /** @type {string[]} */
  const kept = [];
  for (const fact of beforeFacts) {
    if (afterKeySet.has(fact.key) || forgottenSet.has(fact.key)) continue;
    insertRestoredLine(workingLines, beforeLines, fact.index, fact.raw);
    afterKeySet.add(fact.key);
    kept.push(fact.raw);
  }
  return kept;
}

/**
 * Normalize & provenance-tag newly added facts in `workingLines`.
 * @param {string[]} workingLines
 * @param {Set<string>} beforeKeySet
 * @param {string | null} safeSource
 * @param {number} at
 */
function collectAndTagAddedFacts(workingLines, beforeKeySet, safeSource, at) {
  /** @type {Array<{ index: number, line: string, body: string }>} */
  const candidateAdded = [];
  const scannedWorking = scanBotMemoryLines(workingLines.join('\n'));
  for (const entry of scannedWorking.entries) {
    if (!entry.fact) continue;
    const key = normalizeFactKey(entry.fact.text);
    if (!key || beforeKeySet.has(key)) continue;
    const bodyRaw = entry.fact.source ? `${entry.fact.text} - from: ${entry.fact.source}` : entry.fact.text;
    const cleanLine = formatFactLine({
      bullet: entry.fact.prefix,
      date: entry.fact.date ?? isoDate(at),
      body: bodyRaw,
      source: safeSource,
    });
    workingLines[entry.line] = cleanLine;
    candidateAdded.push({ index: entry.line, line: cleanLine, body: entry.fact.text });
  }
  return candidateAdded;
}

/** @param {string[]} beforeLines @param {string[]} workingLines @param {string[]} forgottenKeys */
function restoreRemovedFacts(beforeLines, workingLines, forgottenKeys) {
  const beforeFacts = collectFactEntries(beforeLines);
  const beforeKeySet = new Set(beforeFacts.map((f) => f.key));
  const afterKeySet = new Set(collectFactEntries(workingLines).map((f) => f.key));
  const forgottenSet = new Set((forgottenKeys ?? []).map(normalizeFactKey));
  const kept = [];
  for (const fact of beforeFacts) {
    if (afterKeySet.has(fact.key) || forgottenSet.has(fact.key)) continue;
    insertRestoredLine(workingLines, beforeLines, fact.index, fact.raw);
    afterKeySet.add(fact.key);
    kept.push(fact.raw);
  }
  return { kept, beforeKeySet };
}

/** @param {string[]} workingLines @param {Set<string>} beforeKeySet @param {string | null} safeSource @param {number} at */
function tagAddedFacts(workingLines, beforeKeySet, safeSource, at) {
  const added = [];
  for (let i = 0; i < workingLines.length; i += 1) {
    const parsed = parseMemoryLine(workingLines[i]);
    if (!parsed.isFact || !parsed.key || beforeKeySet.has(parsed.key)) continue;
    const bodyRaw = parsed.source ? `${parsed.body} - from: ${parsed.source}` : parsed.body;
    const cleanLine = formatFactLine({ bullet: parsed.bullet, date: parsed.date ?? isoDate(at), body: bodyRaw, source: safeSource });
    workingLines[i] = cleanLine;
    added.push(cleanLine);
  }
  return added;
}

/**
 * Create a memory service bound to `_meta` root and optional SQLite `db` for FTS5.
 * @param {{ metaRoot: string, db?: any, now?: () => number }} options
 */
export function createMemoryService({ metaRoot, db = null, now = () => Date.now() }) {
  if (!metaRoot) throw new BotMemoryError('invalid_argument', 'metaRoot is required');

  /** @param {string} botId */
  function historyFilePath(botId) {
    const seg = encodeURIComponent(String(botId ?? '').trim());
    if (!seg) throw new BotMemoryError('invalid_argument', 'botId is required');
    return path.join(metaRoot, 'bot-memory-history', `${seg}.json`);
  }

  /** @param {string} botId @param {number} [at] */
  function loadHistory(botId, at = now()) {
    const file = historyFilePath(botId);
    if (!fs.existsSync(file)) return [];
    /** @type {any[]} */
    let entries;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
    const cutoff = at - HISTORY_RETENTION_MS;
    return entries.filter((e) => Number(e?.at ?? 0) >= cutoff).slice(-HISTORY_MAX_ENTRIES);
  }

  /** @param {string} botId @param {any[]} entries @param {number} [at] */
  function saveHistory(botId, entries, at = now()) {
    const cutoff = at - HISTORY_RETENTION_MS;
    const pruned = entries.filter((e) => Number(e?.at ?? 0) >= cutoff).slice(-HISTORY_MAX_ENTRIES);
    writeAtomicFile(historyFilePath(botId), `${JSON.stringify(pruned, null, 2)}\n`);
    return pruned;
  }

  /** @param {string} botId @param {any} draft @param {number} [at] */
  function appendHistory(botId, draft, at = now()) {
    const addedRes = redactList(draft.added);
    const removedRes = redactList(draft.removed);
    const keptRes = redactList(draft.kept);
    const redacted = addedRes.anyRedacted || removedRes.anyRedacted || keptRes.anyRedacted;
    const entry = {
      id: crypto.randomUUID(),
      kind: draft.kind,
      at,
      ...(draft.actor ? { actor: draft.actor } : {}),
      ...(draft.of ? { of: draft.of } : {}),
      ...(draft.sourceLabel ? { sourceLabel: draft.sourceLabel } : {}),
      ...(addedRes.sanitized.length ? { added: addedRes.sanitized } : {}),
      ...(removedRes.sanitized.length ? { removed: removedRes.sanitized } : {}),
      ...(keptRes.sanitized.length ? { kept: keptRes.sanitized } : {}),
      ...(draft.topicsWritten ? { topicsWritten: draft.topicsWritten } : {}),
      ...(draft.archivedCount !== undefined ? { archivedCount: draft.archivedCount } : {}),
      redacted,
      undoable: redacted ? false : Boolean(draft.undoable),
    };
    const list = loadHistory(botId, at);
    list.push(entry);
    saveHistory(botId, list, at);
    return entry;
  }

  const { indexBotMemory, indexTeamMemory, indexProjectMemory, searchMemory } = createMemoryFtsAccess({
    db, metaRoot, readMemoryRaw, readTeamMemoryFile, now,
  });

  /** @param {{ botId?: string, homeDir: string, text: string, date?: string | null, sourceLabel?: string | null, at?: number }} args */
  function appendDailyLog({ botId, homeDir, text, date = null, sourceLabel = null, at = now() }) {
    const body = sanitizeFactBody(text);
    if (!body) throw new BotMemoryError('invalid_argument', 'Daily log text cannot be empty');
    const dateStr = typeof date === 'string' && date.trim() ? date.trim() : isoDate(at);
    const line = formatFactLine({ bullet: '- ', date: dateStr, body, source: sourceLabel });
    const res = appendDailyMemory(homeDir, line, { date: dateStr, botId });
    const relPath = dailyMemoryRelPath(dateStr);
    if (db && botId) {
      syncDocumentToFts(db, {
        scope: 'bot', scopeId: String(botId), botId: String(botId), sourceFile: relPath,
        content: readDailyMemory(homeDir, dateStr), defaultDate: dateStr, at,
      });
    }
    return { path: res.path, relPath, line: res.line, date: dateStr };
  }

  /** @param {{ homeDir: string, date?: string | null, at?: number }} args */
  function readDailyLog({ homeDir, date = null, at = now() }) {
    const dateStr = typeof date === 'string' && date.trim() ? date.trim() : isoDate(at);
    const content = readDailyMemory(homeDir, dateStr);
    return { date: dateStr, relPath: dailyMemoryRelPath(dateStr), content, lines: splitLines(content) };
  }

  /** @param {{ botId?: string, homeDir: string, facts?: string[], summary?: string, date?: string | null, sourceLabel?: string | null, at?: number }} args */
  function flushBeforeCompaction({ botId, homeDir, facts = [], summary = '', date = null, sourceLabel = 'compaction-flush', at = now() }) {
    const dateStr = typeof date === 'string' && date.trim() ? date.trim() : isoDate(at);
    const existing = readDailyLog({ homeDir, date: dateStr, at });
    const existingKeys = new Set(collectFactEntries(existing.lines).map((f) => f.key));
    const candidates = [
      ...(Array.isArray(facts) ? facts : []),
      ...(typeof summary === 'string' && summary.trim() ? [summary.trim()] : []),
    ];
    const writtenLines = [];
    for (const raw of candidates) {
      const cleaned = redactSecrets(sanitizeFactBody(raw)).text;
      const key = normalizeFactKey(cleaned);
      if (!key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      const res = appendDailyLog({ botId, homeDir, text: cleaned, date: dateStr, sourceLabel, at });
      writtenLines.push(res.line);
    }
    return { ok: true, date: dateStr, relPath: dailyMemoryRelPath(dateStr), flushedCount: writtenLines.length, lines: writtenLines };
  }

  /** @param {string} groupId */
  function readTeamMemory(groupId) {
    const content = readTeamMemoryFile(metaRoot, groupId);
    return { groupId: String(groupId), content, lines: splitLines(content) };
  }

  /** @param {string} groupId @param {string} content @param {{ at?: number }} [opts] */
  function writeTeamMemory(groupId, content, { at = now() } = {}) {
    const res = writeTeamMemoryFile(metaRoot, groupId, content);
    const indexed = indexTeamMemory({ groupId, content, at });
    return { groupId: String(groupId), path: res.path, bytes: res.bytes, indexed };
  }

  /** @param {string} homeDir @param {number} [at] */
  function snapshotMemory(homeDir, at = now()) {
    const text = readMemoryRaw(homeDir);
    return { text, signature: sha256Hex(text), lines: splitLines(text), at };
  }

  /**
   * 14-day Re-add Guard wrapper using the service clock.
   * @param {{ homeDir: string, candidateLines: Array<any>, ownerMessageText?: string, at?: number }} params
   */
  function checkReaddGuard({ homeDir, candidateLines, ownerMessageText = '', at = now() }) {
    return evaluateReaddGuard({ homeDir, candidateLines, ownerMessageText, at });
  }

  /**
   * Apply 14-day Re-add Guard against `candidateAdded`, dropping ghost re-adds from `workingLines`.
   * @param {string} homeDir
   * @param {string[]} workingLines
   * @param {Array<{ index: number, line: string, body: string }>} candidateAdded
   * @param {string} ownerMessageText
   * @param {boolean} enableReaddGuard
   * @param {number} at
   */
  function filterReaddGuardedLines(homeDir, workingLines, candidateAdded, ownerMessageText, enableReaddGuard, at) {
    if (!enableReaddGuard || candidateAdded.length === 0) {
      return { added: candidateAdded.map((c) => c.line), keptOut: /** @type {string[]} */ ([]) };
    }
    const guard = checkReaddGuard({ homeDir, candidateLines: candidateAdded, ownerMessageText, at });
    if (guard.keptOut.length === 0) {
      return { added: candidateAdded.map((c) => c.line), keptOut: /** @type {string[]} */ ([]) };
    }
    const dropIndices = new Set(guard.keptOut.map((k) => k.index));
    const filtered = workingLines.filter((_, idx) => !dropIndices.has(idx));
    workingLines.length = 0;
    workingLines.push(...filtered);
    const keptOut = guard.keptOut.map((k) => String(k.archiveEntry));
    appendArchiveLines(path.join(homeDir, 'memory'), keptOut, at);
    return {
      added: guard.allowed.map((a) => String(a.line)),
      keptOut,
    };
  }

  /**
   * @param {{
   *   botId: string,
   *   homeDir: string,
   *   beforeText: string,
   *   sourceLabel?: string | null,
   *   forgottenKeys?: string[],
   *   ownerMessageText?: string,
   *   enableReaddGuard?: boolean,
   *   at?: number,
   * }} params
   */
  function reconcileTurnMemory({
    botId,
    homeDir,
    beforeText,
    sourceLabel = null,
    forgottenKeys = [],
    ownerMessageText = '',
    enableReaddGuard = true,
    at = now(),
  }) {
    const afterText = readMemoryRaw(homeDir);
    const beforeLines = splitLines(beforeText);
    const workingLines = splitLines(afterText);
    const beforeFacts = collectFactEntries(beforeLines);
    const beforeKeySet = new Set(beforeFacts.map((f) => f.key));
    const afterKeySet = new Set(collectFactEntries(workingLines).map((f) => f.key));
    const forgottenSet = new Set((forgottenKeys ?? []).map(normalizeFactKey));

    const kept = restoreDeletedFacts(workingLines, beforeLines, beforeFacts, afterKeySet, forgottenSet);
    const safeSource = sourceLabel ? sanitizeSourceLabel(sourceLabel) : null;
    const candidateAdded = collectAndTagAddedFacts(workingLines, beforeKeySet, safeSource, at);
    const { added, keptOut } = filterReaddGuardedLines(
      homeDir,
      workingLines,
      candidateAdded,
      ownerMessageText,
      enableReaddGuard,
      at,
    );

    const finalText = joinLines(workingLines);
    const changedOnDisk = finalText !== afterText;
    if (changedOnDisk) writeMemoryRaw(homeDir, finalText);

    /** @type {string[]} */
    const historyIds = [];
    if (kept.length > 0) {
      historyIds.push(appendHistory(botId, { kind: 'kept', kept, undoable: false }, at).id);
    }
    if (added.length > 0) {
      historyIds.push(appendHistory(botId, {
        kind: 'chat',
        added,
        sourceLabel: safeSource,
        undoable: true,
      }, at).id);
    }
    const changed = changedOnDisk || added.length > 0 || kept.length > 0 || keptOut.length > 0;
    if (changed && db) indexBotMemory({ botId, homeDir, at });
    return {
      text: finalText,
      kept,
      added,
      keptOut,
      changed,
      historyIds,
    };
  }

  /**
   * @param {{ botId: string, homeDir: string, fact: string, actor?: string, at?: number }} params
   */
  function forgetFact({ botId, homeDir, fact, actor = 'bot', at = now() }) {
    const queryRaw = String(fact ?? '').trim();
    if (!queryRaw) throw new BotMemoryError('invalid_argument', 'fact cannot be empty');
    const queryParsed = parseMemoryLine(queryRaw.startsWith('-') || queryRaw.startsWith('*') ? queryRaw : `- ${queryRaw}`);
    const targetKey = queryParsed.key || normalizeFactKey(queryRaw);

    const rawText = readMemoryRaw(homeDir);
    const scanned = scanBotMemoryLines(rawText);
    /** @type {string[]} */
    const removed = [];
    /** @type {string[]} */
    const remaining = [];
    /** @type {string[]} */
    const forgottenKeys = [];
    for (const entry of scanned.entries) {
      const line = entry.raw;
      if (entry.fact) {
        const key = normalizeFactKey(entry.fact.text);
        const isMatch = (
          line.trim() === queryRaw
          || key === targetKey
          || normalizeFactKey(entry.fact.text) === normalizeFactKey(queryRaw)
        );
        if (isMatch) {
          removed.push(line);
          forgottenKeys.push(key);
          continue;
        }
      }
      remaining.push(line);
    }
    while (remaining.length > 0 && remaining.at(-1) === '' && rawText.endsWith('\n')) {
      remaining.pop();
      break;
    }

    if (removed.length === 0) {
      return { removed: [], forgottenKeys: [], changeId: null };
    }
    writeMemoryRaw(homeDir, joinLines(remaining));
    const entry = appendHistory(botId, { kind: 'forget', actor, removed, undoable: true }, at);
    if (db) indexBotMemory({ botId, homeDir, at });
    return { removed, forgottenKeys, changeId: entry.id };
  }

  /**
   * @param {{ botId: string, homeDir: string, text: string, date?: string | null, sourceLabel?: string | null, actor?: string, at?: number }} params
   */
  function addFact({ botId, homeDir, text, date = null, sourceLabel = null, actor = 'owner', at = now() }) {
    const body = sanitizeFactBody(text);
    if (!body) throw new BotMemoryError('invalid_argument', 'Fact text cannot be empty');
    const lines = splitLines(readMemoryRaw(homeDir));
    const line = formatFactLine({ bullet: '- ', date: date ?? isoDate(at), body, source: sourceLabel });
    lines.push(line);
    writeMemoryRaw(homeDir, joinLines(lines));
    const entry = appendHistory(botId, { kind: 'add', actor, added: [line], sourceLabel, undoable: true }, at);
    if (db) indexBotMemory({ botId, homeDir, at });
    return { line, changeId: entry.id };
  }

  /**
   * @param {{ botId: string, homeDir: string, match: string, nextText: string, date?: string | null, actor?: string, at?: number }} params
   */
  function editFact({ botId, homeDir, match, nextText, date = null, actor = 'owner', at = now() }) {
    const body = sanitizeFactBody(nextText);
    if (!body) throw new BotMemoryError('invalid_argument', 'nextText cannot be empty');
    const matchKey = normalizeFactKey(parseMemoryLine(`- ${String(match ?? '').trim()}`).body);
    const lines = splitLines(readMemoryRaw(homeDir));
    const facts = collectFactEntries(lines);
    const found = facts.find((f) => f.raw.trim() === String(match ?? '').trim() || f.key === matchKey);
    if (!found) throw new BotMemoryError('not_found', `Fact not found: ${match}`);

    const idx = found.index;
    const oldLine = lines[idx];
    const newLine = formatFactLine({
      bullet: found.bullet,
      date: date ?? found.date ?? isoDate(at),
      body,
      source: found.source,
    });
    lines[idx] = newLine;
    writeMemoryRaw(homeDir, joinLines(lines));
    const entry = appendHistory(botId, { kind: 'edit', actor, removed: [oldLine], added: [newLine], undoable: true }, at);
    if (db) indexBotMemory({ botId, homeDir, at });
    return { oldLine, newLine, changeId: entry.id };
  }

  /**
   * @param {string} botId
   * @param {{ limit?: number, at?: number }} [opts]
   */
  function listHistory(botId, { limit = 100, at = now() } = {}) {
    return loadHistory(botId, at).slice(-Math.max(1, Number(limit) || 100)).reverse();
  }

  /**
   * @param {{ botId: string, homeDir: string, changeId: string, at?: number }} params
   */
  function undoChange({ botId, homeDir, changeId, at = now() }) {
    const history = loadHistory(botId, at);
    const targetIdx = history.findIndex((e) => e.id === changeId);
    if (targetIdx === -1) throw new BotMemoryError('not_found', `History change not found: ${changeId}`);
    const target = history[targetIdx];
    if (!target.undoable) throw new BotMemoryError('not_undoable', `Change ${changeId} cannot be undone (redacted or non-undoable)`);
    if (history.slice(targetIdx + 1).some((e) => e.kind === 'undo' && e.of === changeId)) {
      throw new BotMemoryError('already_undone', `Change ${changeId} was already undone`);
    }

    /** @type {Set<string>} */
    const supersededKeys = new Set();
    for (const newer of history.slice(targetIdx + 1)) {
      for (const key of extractEntryFactKeys(newer)) supersededKeys.add(key);
    }
    const lines = splitLines(readMemoryRaw(homeDir));
    /** @type {string[]} */
    const skippedKeys = [];
    /** @type {string[]} */
    const revertedAdded = [];
    /** @type {string[]} */
    const revertedRemoved = [];
    for (const addedLine of target.added ?? []) {
      const parsed = parseMemoryLine(addedLine);
      if (parsed.key && supersededKeys.has(parsed.key)) { skippedKeys.push(parsed.key); continue; }
      const pos = lines.findIndex((l) => l === addedLine || (parsed.key && parseMemoryLine(l).key === parsed.key));
      if (pos !== -1) { lines.splice(pos, 1); revertedAdded.push(addedLine); }
    }
    const existingKeys = new Set(collectFactEntries(lines).map((f) => f.key));
    for (const removedLine of target.removed ?? []) {
      const parsed = parseMemoryLine(removedLine);
      if (parsed.key && supersededKeys.has(parsed.key)) { skippedKeys.push(parsed.key); continue; }
      if (!parsed.key || !existingKeys.has(parsed.key)) {
        lines.push(removedLine);
        if (parsed.key) existingKeys.add(parsed.key);
        revertedRemoved.push(removedLine);
      }
    }
    writeMemoryRaw(homeDir, joinLines(lines));
    const undoEntry = appendHistory(botId, { kind: 'undo', of: changeId, added: revertedRemoved, removed: revertedAdded, undoable: false }, at);
    if (db) indexBotMemory({ botId, homeDir, at });
    return { ok: true, changeId: undoEntry.id, revertedAdded, revertedRemoved, skippedKeys: [...new Set(skippedKeys)] };
  }

  /**
   * Zero-LLM pre-tidy migration: moves ephemeral status lines (>=2 status signals such as
   * PR/SHA/dispatch/round/pending and NOT standing owner rules or undated rules) from
   * `MEMORY.md` into `memory/journal/YYYY-MM.md`, keeping salvage candidates.
   * @param {{ botId: string, homeDir: string, at?: number }} params
   */
  function migrateStatusLinesToJournal({ botId, homeDir, at = now() }) {
    const raw = readMemoryRaw(homeDir);
    const lines = splitLines(raw);
    if (lines.length === 0) {
      return { migrated: [], salvage: [], remainingCount: 0, changeId: null };
    }
    const facts = collectFactEntries(lines);
    /** @type {Set<number>} */
    const migrateIndices = new Set();
    /** @type {string[]} */
    const migrated = [];
    /** @type {Array<{ line: string, date: string, kind: string }>} */
    const salvage = [];

    for (const fact of facts) {
      if (fact.date === null) continue;
      if (containsSecretLike(fact.raw)) continue;
      if (isStandingOwnerRule(fact)) continue;
      if (countStatusSignals(fact.body) < 2) continue;

      migrateIndices.add(fact.index);
      migrated.push(fact.raw);
      appendJournalEntry({
        homeDir,
        line: fact.raw,
        dedupeKey: normalizeFactKey(fact.body),
        date: fact.date,
        at,
      });
      if (isLessonMemoryLine(fact) || isOwnerDecisionLine(fact)) {
        salvage.push({ line: fact.raw, date: fact.date, kind: fact.kind ?? 'lesson' });
      }
    }

    if (migrated.length === 0) {
      return { migrated: [], salvage: [], remainingCount: lines.length, changeId: null };
    }

    const remaining = lines.filter((_, idx) => !migrateIndices.has(idx));
    writeMemoryRaw(homeDir, joinLines(remaining));
    const entry = appendHistory(botId, {
      kind: 'journal-migrate',
      removed: migrated,
      undoable: true,
    }, at);
    if (db) indexBotMemory({ botId, homeDir, at });
    return {
      migrated,
      salvage,
      remainingCount: remaining.length,
      changeId: entry.id,
    };
  }

  /**
   * Apply legacy draft-mode (`BEGIN MEMORY.md`) Tidy-up output.
   * @param {{
   *   botId: string,
   *   homeDir: string,
   *   beforeSnapshot: { text: string, signature: string },
   *   rawOutput?: string | null,
   *   proposedMemory?: string | null,
   *   topicFiles?: Record<string, string> | null,
   *   replacedLines?: string[] | null,
   *   at?: number,
   * }} params
   */
  function applyTidyUpResult(params) {
    const at = params.at ?? now();
    const res = executeTidyUpDraft({
      ...params,
      at,
      appendHistory,
    });
    if (db) indexBotMemory({ botId: params.botId, homeDir: params.homeDir, at });
    return res;
  }

  /**
   * Apply structured Ops-mode Tidy-up output (`merge` / `retire` / `demote`) onto live `MEMORY.md`.
   * @param {{
   *   botId: string,
   *   homeDir: string,
   *   beforeSnapshot: { text: string, signature: string },
   *   rawOutput?: string | null,
   *   ops?: Array<Record<string, any>> | null,
   *   at?: number,
   * }} params
   */
  function applyTidyUpOpsResult(params) {
    const at = params.at ?? now();
    const res = executeTidyUpOps({
      ...params,
      at,
      appendHistory,
    });
    if (db) indexBotMemory({ botId: params.botId, homeDir: params.homeDir, at });
    return res;
  }

  return {
    snapshotMemory,
    readMemoryForPrompt,
    reconcileTurnMemory,
    checkReaddGuard,
    forgetFact,
    addFact,
    editFact,
    listHistory,
    undoChange,
    appendJournalEntry,
    backfillJournal24h,
    migrateStatusLinesToJournal,
    applyTidyUpResult,
    applyTidyUpOpsResult,
    indexBotMemory,
    indexTeamMemory,
    indexProjectMemory,
    searchMemory,
    appendDailyLog,
    readDailyLog,
    flushBeforeCompaction,
    readTeamMemory,
    writeTeamMemory,
  };
}
