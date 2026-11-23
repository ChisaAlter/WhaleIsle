/**
 * Tidy-Up output parser and disk applicators (legacy draft mode & structured Ops mode)
 * for Bot Memory Service.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  applyTidyUpOps,
  isTidyUpLineCountAllowed,
  parseTidyUpOpsResponse,
} from '../../src/shared/bot-tidy-up.js';
import { sha256Hex, writeAtomicFile } from './fs-home.js';
import {
  BotMemoryError,
  MEMORY_MAX_LOADED_LINES,
  appendArchiveLines,
  collectFactEntries,
  isoDate,
  joinLines,
  normalizeFactKey,
  parseMemoryLine,
  readMemoryRaw,
  splitLines,
  writeMemoryRaw,
} from './memory-helpers.js';

export const TIDY_MAX_DELETE_RATIO = 0.2;
export const TIDY_MAX_ARCHIVE_LINES = 20;

const TOPIC_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Parse `BEGIN MEMORY.md` / `BEGIN memory/<topic>.md` / `BEGIN REPLACED` tidy-up blocks.
 * @param {string} rawOutput
 */
export function parseTidyUpOutput(rawOutput) {
  const lines = String(rawOutput ?? '').replace(/\r\n/gu, '\n').split('\n');
  /** @type {string | null} */
  let proposedMemory = null;
  /** @type {Record<string, string>} */
  const topicFiles = {};
  /** @type {string[]} */
  let replacedLines = [];

  /** @type {{ kind: string, target: string, buf: string[] } | null} */
  let active = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!active) {
      if (trimmed === 'BEGIN MEMORY.md') {
        active = { kind: 'memory', target: 'MEMORY.md', buf: [] };
      } else if (trimmed === 'BEGIN REPLACED') {
        active = { kind: 'replaced', target: 'REPLACED', buf: [] };
      } else if (trimmed.startsWith('BEGIN memory/') && trimmed.endsWith('.md')) {
        const topic = trimmed.slice('BEGIN memory/'.length, -'.md'.length);
        active = { kind: 'topic', target: topic, buf: [] };
      }
      continue;
    }
    const expectedEnd = active.kind === 'topic'
      ? `END memory/${active.target}.md`
      : `END ${active.target}`;
    if (trimmed === expectedEnd) {
      if (active.kind === 'memory') proposedMemory = joinLines(active.buf);
      else if (active.kind === 'topic') topicFiles[active.target] = joinLines(active.buf);
      else if (active.kind === 'replaced') replacedLines = active.buf.filter((l) => l.trim() !== '');
      active = null;
      continue;
    }
    active.buf.push(line);
  }
  return { proposedMemory, topicFiles, replacedLines };
}

/**
 * @param {string} memoryDir
 * @param {Array<[string, string]>} topicEntries
 * @param {Map<string, string>} beforeKeyMap
 */
function validateTidyTopics(memoryDir, topicEntries, beforeKeyMap) {
  for (const [topicName, content] of topicEntries) {
    if (!TOPIC_NAME_RE.test(topicName) || topicName === 'archive') {
      throw new BotMemoryError('invalid_topic_name', `Invalid tidy-up topic name: ${topicName}`);
    }
    const existingPath = path.join(memoryDir, `${topicName}.md`);
    const existingKeys = fs.existsSync(existingPath)
      ? new Set(collectFactEntries(splitLines(fs.readFileSync(existingPath, 'utf8'))).map((f) => f.key))
      : new Set();
    for (const fact of collectFactEntries(splitLines(String(content ?? '')))) {
      if (!beforeKeyMap.has(fact.key) && !existingKeys.has(fact.key)) {
        throw new BotMemoryError(
          'fabricated_topic_line',
          `Topic memory/${topicName}.md contains a fact not present in MEMORY.md`,
          { topic: topicName, line: fact.raw },
        );
      }
    }
  }
}

/**
 * @param {Array<{ key: string, raw: string }>} removedFacts
 * @param {string[]} replacedLines
 */
function collectTidyArchive(removedFacts, replacedLines) {
  /** @type {Map<string, string>} */
  const archiveMap = new Map();
  for (const f of removedFacts) archiveMap.set(f.key, f.raw);
  for (const rawLine of replacedLines ?? []) {
    const p = parseMemoryLine(rawLine);
    const key = p.isFact && p.key ? p.key : normalizeFactKey(rawLine);
    if (key && !archiveMap.has(key)) archiveMap.set(key, rawLine);
  }
  if (archiveMap.size > TIDY_MAX_ARCHIVE_LINES) {
    throw new BotMemoryError(
      'archive_limit_exceeded',
      `Tidy-up archives ${archiveMap.size} lines (limit ${TIDY_MAX_ARCHIVE_LINES})`,
    );
  }
  return [...archiveMap.values()];
}

/**
 * @param {string} homeDir
 * @param {string} memoryDir
 * @param {string[]} nextLines
 * @param {Array<[string, string]>} topicEntries
 * @param {string[]} archiveLines
 * @param {number} at
 */
function writeTidyOutputs(homeDir, memoryDir, nextLines, topicEntries, archiveLines, at) {
  fs.mkdirSync(memoryDir, { recursive: true });
  appendArchiveLines(memoryDir, archiveLines, at);
  /** @type {string[]} */
  const topicsWritten = [];
  for (const [topicName, content] of topicEntries) {
    writeAtomicFile(path.join(memoryDir, `${topicName}.md`), joinLines(splitLines(String(content ?? ''))));
    topicsWritten.push(topicName);
  }
  writeMemoryRaw(homeDir, joinLines(nextLines));
  return topicsWritten;
}

/**
 * Detects concurrent edits on disk during draft tidy-up; returns externally added facts
 * that should be preserved, or throws `concurrent_modification` on conflicting edits.
 * @param {string} currentDiskText
 * @param {string} beforeSignature
 * @param {Array<{ key: string, raw: string }>} beforeFacts
 * @param {Map<string, string>} beforeKeyMap
 */
function collectExternalAddedFacts(currentDiskText, beforeSignature, beforeFacts, beforeKeyMap) {
  if (sha256Hex(currentDiskText) === beforeSignature) {
    return [];
  }
  const diskFacts = collectFactEntries(splitLines(currentDiskText));
  const diskKeyMap = new Map(diskFacts.map((f) => [f.key, f.raw]));
  for (const bf of beforeFacts) {
    if (!diskKeyMap.has(bf.key) || diskKeyMap.get(bf.key) !== bf.raw) {
      throw new BotMemoryError('concurrent_modification', 'MEMORY.md changed while tidy-up was running');
    }
  }
  const externalAddedFacts = diskFacts.filter((df) => !beforeKeyMap.has(df.key));
  if (externalAddedFacts.length === 0) {
    throw new BotMemoryError('concurrent_modification', 'MEMORY.md changed while tidy-up was running');
  }
  return externalAddedFacts;
}

/**
 * Merge externally added facts into `nextLines` without duplicating existing keys.
 * @param {string[]} nextLines
 * @param {Set<string>} nextKeySet
 * @param {Array<{ key: string, raw: string }>} externalAddedFacts
 */
function mergeExternalAddedLines(nextLines, nextKeySet, externalAddedFacts) {
  const finalLines = [...nextLines];
  /** @type {string[]} */
  const preservedExternalAdded = [];
  for (const ext of externalAddedFacts) {
    if (!nextKeySet.has(ext.key)) {
      finalLines.push(ext.raw);
      nextKeySet.add(ext.key);
      preservedExternalAdded.push(ext.raw);
    }
  }
  return { finalLines, preservedExternalAdded };
}

/**
 * Apply legacy draft-mode (`BEGIN MEMORY.md`) Tidy-up output onto disk.
 * @param {{
 *   botId: string,
 *   homeDir: string,
 *   beforeSnapshot: { text: string, signature: string },
 *   rawOutput?: string | null,
 *   proposedMemory?: string | null,
 *   topicFiles?: Record<string, string> | null,
 *   replacedLines?: string[] | null,
 *   at: number,
 *   appendHistory: (botId: string, draft: any, at: number) => { id: string },
 * }} params
 */
export function executeTidyUpDraft({
  botId,
  homeDir,
  beforeSnapshot,
  rawOutput = null,
  proposedMemory = null,
  topicFiles = null,
  replacedLines = null,
  at,
  appendHistory,
}) {
  if (!beforeSnapshot?.signature) {
    throw new BotMemoryError('invalid_argument', 'beforeSnapshot with signature is required');
  }

  const currentDiskText = readMemoryRaw(homeDir);
  const beforeLines = splitLines(beforeSnapshot.text);
  const beforeFacts = collectFactEntries(beforeLines);
  const beforeKeyMap = new Map(beforeFacts.map((f) => [f.key, f.raw]));
  const externalAddedFacts = collectExternalAddedFacts(
    currentDiskText,
    beforeSnapshot.signature,
    beforeFacts,
    beforeKeyMap,
  );

  const parsed = rawOutput
    ? parseTidyUpOutput(rawOutput)
    : { proposedMemory, topicFiles: topicFiles ?? {}, replacedLines: replacedLines ?? [] };
  if (typeof parsed.proposedMemory !== 'string') {
    throw new BotMemoryError('invalid_argument', 'Tidy-up result is missing MEMORY.md block');
  }

  const nextLines = splitLines(parsed.proposedMemory);
  if (!isTidyUpLineCountAllowed(beforeLines.length, nextLines.length, MEMORY_MAX_LOADED_LINES)) {
    throw new BotMemoryError('exceeds_max_lines', `Proposed MEMORY.md has ${nextLines.length} lines (limit ${MEMORY_MAX_LOADED_LINES})`);
  }

  const nextFacts = collectFactEntries(nextLines);
  const nextKeySet = new Set(nextFacts.map((f) => f.key));
  const memoryDir = path.join(homeDir, 'memory');
  const topicEntries = Object.entries(parsed.topicFiles ?? {});

  validateTidyTopics(memoryDir, topicEntries, beforeKeyMap);
  const removedFacts = beforeFacts.filter((f) => !nextKeySet.has(f.key));
  const addedFacts = nextFacts.filter((f) => !beforeKeyMap.has(f.key));
  if (beforeFacts.length > 0 && removedFacts.length / beforeFacts.length > TIDY_MAX_DELETE_RATIO) {
    throw new BotMemoryError('delete_ratio_exceeded', `Tidy-up removes ${removedFacts.length}/${beforeFacts.length} facts (limit ${TIDY_MAX_DELETE_RATIO * 100}%)`);
  }

  const { finalLines, preservedExternalAdded } = mergeExternalAddedLines(nextLines, nextKeySet, externalAddedFacts);
  const archiveLines = collectTidyArchive(removedFacts, parsed.replacedLines);
  const topicsWritten = writeTidyOutputs(homeDir, memoryDir, finalLines, topicEntries, archiveLines, at);
  const entry = appendHistory(botId, {
    kind: 'tidy-up',
    added: addedFacts.map((f) => f.raw),
    removed: removedFacts.map((f) => f.raw),
    topicsWritten,
    archivedCount: archiveLines.length,
    undoable: true,
  }, at);

  return {
    ok: true,
    mode: 'draft',
    changeId: entry.id,
    archivedCount: archiveLines.length,
    topicsWritten,
    added: addedFacts.map((f) => f.raw),
    removed: removedFacts.map((f) => f.raw),
    preservedExternalAdded,
  };
}

/**
 * Append demoted ops lines to `memory/<topic>.md` while deduplicating against existing keys.
 * @param {string} memoryDir
 * @param {Map<string, string[]>} topicsMap
 */
function writeOpsTopics(memoryDir, topicsMap) {
  /** @type {string[]} */
  const topicsWritten = [];
  for (const [topicName, newLines] of topicsMap.entries()) {
    const topicPath = path.join(memoryDir, `${topicName}.md`);
    const existing = fs.existsSync(topicPath) ? fs.readFileSync(topicPath, 'utf8') : `# ${topicName}\n`;
    const existingKeys = new Set(collectFactEntries(splitLines(existing)).map((f) => f.key));
    const toAppend = newLines.filter((line) => {
      const key = parseMemoryLine(line).key;
      return !key || !existingKeys.has(key);
    });
    if (toAppend.length > 0) {
      const sep = existing.endsWith('\n') ? '' : '\n';
      writeAtomicFile(topicPath, `${existing}${sep}${toAppend.join('\n')}\n`);
      topicsWritten.push(topicName);
    }
  }
  return topicsWritten;
}

/**
 * @param {{ text: string, signature: string } | null | undefined} beforeSnapshot
 * @param {Array<Record<string, any>> | null} ops
 * @param {string | null} rawOutput
 */
function resolveOpsInput(beforeSnapshot, ops, rawOutput) {
  if (!beforeSnapshot?.signature) {
    throw new BotMemoryError('invalid_argument', 'beforeSnapshot with signature is required');
  }
  const parsedOps = Array.isArray(ops) ? ops : parseTidyUpOpsResponse(rawOutput ?? '');
  if (!parsedOps) {
    throw new BotMemoryError('invalid_argument', 'Tidy-up result is not a valid Ops array');
  }
  return parsedOps;
}

/**
 * @param {string} homeDir
 * @param {string} botId
 * @param {string} appliedIndex
 * @param {string[]} removedLines
 * @param {string[]} topicsWritten
 * @param {number} archivedCount
 * @param {number} at
 * @param {(botId: string, draft: any, at: number) => { id: string }} appendHistory
 */
function commitOpsMemoryAndHistory(homeDir, botId, appliedIndex, removedLines, topicsWritten, archivedCount, at, appendHistory) {
  if (removedLines.length === 0) return null;
  const finalText = appliedIndex.endsWith('\n') || appliedIndex === '' ? appliedIndex : `${appliedIndex}\n`;
  writeMemoryRaw(homeDir, finalText);
  return appendHistory(botId, {
    kind: 'tidy-up',
    added: [],
    removed: removedLines,
    topicsWritten,
    archivedCount,
    undoable: true,
  }, at).id;
}

/**
 * Apply structured Ops-mode Tidy-up output (`merge` / `retire` / `demote`) onto live `MEMORY.md`.
 * @param {{
 *   botId: string,
 *   homeDir: string,
 *   beforeSnapshot: { text: string, signature: string },
 *   rawOutput?: string | null,
 *   ops?: Array<Record<string, any>> | null,
 *   at: number,
 *   appendHistory: (botId: string, draft: any, at: number) => { id: string },
 * }} params
 */
export function executeTidyUpOps({
  botId,
  homeDir,
  beforeSnapshot,
  rawOutput = null,
  ops = null,
  at,
  appendHistory,
}) {
  const parsedOps = resolveOpsInput(beforeSnapshot, ops, rawOutput);
  const latestMemory = readMemoryRaw(homeDir);
  const applied = applyTidyUpOps(beforeSnapshot.text, parsedOps, {
    latestMemory,
    today: isoDate(at),
  });
  if (!applied.ok) {
    throw new BotMemoryError(applied.code ?? 'tidy_up_failed', applied.refused ?? 'Tidy-up ops refused');
  }

  const archiveLines = applied.archiveLines ?? [];
  const topicsMap = applied.topics ?? new Map();
  const appliedIndex = applied.index ?? '';
  const removedLines = (applied.change?.removed ?? []).map((r) => r.line);

  const memoryDir = path.join(homeDir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  appendArchiveLines(memoryDir, archiveLines, at);
  const topicsWritten = writeOpsTopics(memoryDir, topicsMap);
  const changeId = commitOpsMemoryAndHistory(
    homeDir,
    botId,
    appliedIndex,
    removedLines,
    topicsWritten,
    archiveLines.length,
    at,
    appendHistory,
  );

  return {
    ok: true,
    mode: 'ops',
    changeId,
    archivedCount: archiveLines.length,
    topicsWritten,
    added: [],
    removed: removedLines,
    salvage: applied.salvage,
    appliedOps: applied.appliedOps,
    skippedOps: applied.skippedOps,
    stats: applied.stats,
  };
}
