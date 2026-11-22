/**
 * Bot Memory Service (`MEMORY.md`, `memory/<topic>.md`, `memory/archive.md`,
 * and `_meta/bot-memory-history/<encodedBotId>.json`).
 *
 * Ports Orca's memory guardrails:
 * - 200-line prompt window with truncation notice
 * - Turn-end tamper protection (auto-reinsert lines deleted without `forgetFact`, logged as `kept`)
 * - External source auto-tagging (` · from: <source>`) + anti-spoofing sanitization
 * - 90-day / 1000-entry history with secret redaction (`undoable: false` when redacted)
 * - Supersede-aware `undoChange`
 * - Strict `applyTidyUpResult` verification & `memory/archive.md` archival
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex, writeAtomicFile } from './fs-home.js';

export const MEMORY_MAX_LOADED_LINES = 200;
export const MEMORY_SOURCE_SEPARATOR = ' · from: ';
export const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const HISTORY_MAX_ENTRIES = 1000;
export const TIDY_MAX_DELETE_RATIO = 0.2;
export const TIDY_MAX_ARCHIVE_LINES = 20;

const FACT_LINE_RE = /^(\s*[-*]\s+)(.*)$/u;
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})(?:\s*[:–—-]\s*|\s+)(.*)$/u;
const SPOOFED_SOURCE_RE = /\s*·\s*from\s*:/giu;
const TOPIC_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const SECRET_PATTERNS = [
  /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu,
  /\bAIza[0-9A-Za-z_-]{20,}\b/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu,
  /\b(api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\s*[:=]\s*(['"]?)[^\s'"]{6,}\2/giu,
];

export class BotMemoryError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [data]
   */
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'BotMemoryError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** @param {number} ts */
function isoDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** @param {string} text */
export function normalizeFactKey(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** @param {string} text */
export function sanitizeFactBody(text) {
  return String(text ?? '')
    .replace(/\r?\n/gu, ' ')
    .replace(SPOOFED_SOURCE_RE, ' - from:')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** @param {string} sourceLabel */
function sanitizeSourceLabel(sourceLabel) {
  return String(sourceLabel ?? '')
    .replace(/\r?\n/gu, ' ')
    .replace(SPOOFED_SOURCE_RE, ' - from:')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240);
}

/**
 * Parse a single line of `MEMORY.md`.
 * @param {string} line
 */
export function parseMemoryLine(line) {
  const raw = String(line ?? '');
  const bulletMatch = FACT_LINE_RE.exec(raw);
  if (!bulletMatch) {
    return { isFact: false, raw, bullet: '', date: null, body: raw, source: null, key: '' };
  }
  const bullet = bulletMatch[1];
  let rest = bulletMatch[2].trim();
  let source = null;
  const sepIdx = rest.lastIndexOf(MEMORY_SOURCE_SEPARATOR);
  if (sepIdx !== -1) {
    source = rest.slice(sepIdx + MEMORY_SOURCE_SEPARATOR.length).trim() || null;
    rest = rest.slice(0, sepIdx).trim();
  }
  let date = null;
  const dateMatch = DATE_PREFIX_RE.exec(rest);
  if (dateMatch) {
    date = dateMatch[1];
    rest = dateMatch[2].trim();
  }
  return {
    isFact: true,
    raw,
    bullet,
    date,
    body: rest,
    source,
    key: normalizeFactKey(rest),
  };
}

/** @param {{ bullet?: string, date?: string | null, body: string, source?: string | null }} parts */
export function formatFactLine({ bullet = '- ', date = null, body, source = null }) {
  const safeBody = sanitizeFactBody(body);
  const datePart = date ? `${date} ` : '';
  const sourcePart = source ? `${MEMORY_SOURCE_SEPARATOR}${sanitizeSourceLabel(source)}` : '';
  return `${bullet}${datePart}${safeBody}${sourcePart}`;
}

/**
 * Scan and redact credential-like strings from text.
 * @param {string} text
 */
export function redactSecrets(text) {
  let out = String(text ?? '');
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const replaced = out.replace(pattern, (match, keyName) => {
      redacted = true;
      return keyName ? `${keyName}=[REDACTED]` : '[REDACTED]';
    });
    out = replaced;
  }
  return { text: out, redacted };
}

/** @param {string} text */
function splitLines(text) {
  const normalized = String(text ?? '').replace(/\r\n/gu, '\n');
  if (!normalized) return [];
  const trimmedTrailing = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return trimmedTrailing === '' ? [] : trimmedTrailing.split('\n');
}

/** @param {string[]} lines */
function joinLines(lines) {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** @param {string} homeDir */
function readMemoryRaw(homeDir) {
  const file = path.join(homeDir, 'MEMORY.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @param {string} homeDir @param {string} content */
function writeMemoryRaw(homeDir, content) {
  writeAtomicFile(path.join(homeDir, 'MEMORY.md'), content);
}

/**
 * Load `MEMORY.md` for prompt injection with 200-line truncation notice.
 * @param {string} homeDir
 * @param {number} [maxLines]
 */
export function readMemoryForPrompt(homeDir, maxLines = MEMORY_MAX_LOADED_LINES) {
  const raw = readMemoryRaw(homeDir);
  const lines = splitLines(raw);
  const totalLines = lines.length;
  if (totalLines <= maxLines) {
    return { text: joinLines(lines), totalLines, loadedLines: totalLines, truncatedLines: 0 };
  }
  const truncatedLines = totalLines - maxLines;
  const loaded = lines.slice(0, maxLines);
  const text = `${loaded.join('\n')}\n(${truncatedLines} more lines in MEMORY.md not loaded)\n`;
  return { text, totalLines, loadedLines: maxLines, truncatedLines };
}

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

/** @param {string[]} lines */
function collectFactEntries(lines) {
  return lines
    .map((line, index) => ({ ...parseMemoryLine(line), index }))
    .filter((entry) => entry.isFact && entry.key);
}

/** @param {string[]} working @param {string[]} beforeLines @param {number} origIdx @param {string} rawLine */
function insertRestoredLine(working, beforeLines, origIdx, rawLine) {
  for (let i = origIdx - 1; i >= 0; i -= 1) {
    const anchor = beforeLines[i];
    const pos = working.indexOf(anchor);
    if (pos !== -1) {
      working.splice(pos + 1, 0, rawLine);
      return;
    }
  }
  const pos = Math.min(origIdx, working.length);
  working.splice(pos, 0, rawLine);
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
  const keys = new Set();
  for (const line of [...(entry.added ?? []), ...(entry.removed ?? []), ...(entry.kept ?? [])]) {
    const parsed = parseMemoryLine(line);
    if (parsed.isFact && parsed.key) keys.add(parsed.key);
  }
  return keys;
}

/** @param {string} memoryDir @param {Array<[string, string]>} topicEntries @param {Map<string, string>} beforeKeyMap */
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

/** @param {Array<{ key: string, raw: string }>} removedFacts @param {string[]} replacedLines */
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

/** @param {string} homeDir @param {string} memoryDir @param {string[]} nextLines @param {Array<[string, string]>} topicEntries @param {string[]} archiveLines @param {number} at */
function writeTidyOutputs(homeDir, memoryDir, nextLines, topicEntries, archiveLines, at) {
  fs.mkdirSync(memoryDir, { recursive: true });
  if (archiveLines.length > 0) {
    const archivePath = path.join(memoryDir, 'archive.md');
    const existing = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '# Memory Archive\n';
    const sep = existing.endsWith('\n') ? '\n' : '\n\n';
    writeAtomicFile(archivePath, `${existing}${sep}## ${isoDate(at)}\n${archiveLines.join('\n')}\n`);
  }
  const topicsWritten = [];
  for (const [topicName, content] of topicEntries) {
    writeAtomicFile(path.join(memoryDir, `${topicName}.md`), joinLines(splitLines(String(content ?? ''))));
    topicsWritten.push(topicName);
  }
  writeMemoryRaw(homeDir, joinLines(nextLines));
  return topicsWritten;
}

/**
 * Create a memory service bound to `_meta` root.
 * @param {{ metaRoot: string, now?: () => number }} options
 */
export function createMemoryService({ metaRoot, now = () => Date.now() }) {
  if (!metaRoot) throw new BotMemoryError('invalid_argument', 'metaRoot is required');

  function historyFilePath(botId) {
    const seg = encodeURIComponent(String(botId ?? '').trim());
    if (!seg) throw new BotMemoryError('invalid_argument', 'botId is required');
    return path.join(metaRoot, 'bot-memory-history', `${seg}.json`);
  }

  function loadHistory(botId, at = now()) {
    const file = historyFilePath(botId);
    if (!fs.existsSync(file)) return [];
    let entries;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
    const cutoff = at - HISTORY_RETENTION_MS;
    const pruned = entries.filter((e) => Number(e?.at ?? 0) >= cutoff);
    return pruned.slice(-HISTORY_MAX_ENTRIES);
  }

  function saveHistory(botId, entries, at = now()) {
    const cutoff = at - HISTORY_RETENTION_MS;
    const pruned = entries.filter((e) => Number(e?.at ?? 0) >= cutoff).slice(-HISTORY_MAX_ENTRIES);
    writeAtomicFile(historyFilePath(botId), `${JSON.stringify(pruned, null, 2)}\n`);
    return pruned;
  }

  function appendHistory(botId, draft, at = now()) {
    const addedRes = redactList(draft.added);
    const removedRes = redactList(draft.removed);
    const keptRes = redactList(draft.kept);
    const redacted = addedRes.anyRedacted || removedRes.anyRedacted || keptRes.anyRedacted;
    const undoable = redacted ? false : Boolean(draft.undoable);
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
      undoable,
    };
    const list = loadHistory(botId, at);
    list.push(entry);
    saveHistory(botId, list, at);
    return entry;
  }

  function snapshotMemory(homeDir, at = now()) {
    const text = readMemoryRaw(homeDir);
    return {
      text,
      signature: sha256Hex(text),
      lines: splitLines(text),
      at,
    };
  }

  function reconcileTurnMemory({ botId, homeDir, beforeText, sourceLabel = null, forgottenKeys = [], at = now() }) {
    const afterText = readMemoryRaw(homeDir);
    const beforeLines = splitLines(beforeText);
    const workingLines = splitLines(afterText);
    const beforeFacts = collectFactEntries(beforeLines);
    const beforeKeySet = new Set(beforeFacts.map((f) => f.key));
    const afterKeySet = new Set(collectFactEntries(workingLines).map((f) => f.key));
    const forgottenSet = new Set((forgottenKeys ?? []).map(normalizeFactKey));

    /** @type {string[]} */
    const kept = [];
    for (const fact of beforeFacts) {
      if (afterKeySet.has(fact.key) || forgottenSet.has(fact.key)) continue;
      insertRestoredLine(workingLines, beforeLines, fact.index, fact.raw);
      afterKeySet.add(fact.key);
      kept.push(fact.raw);
    }

    /** @type {string[]} */
    const added = [];
    const safeSource = sourceLabel ? sanitizeSourceLabel(sourceLabel) : null;
    for (let i = 0; i < workingLines.length; i += 1) {
      const parsed = parseMemoryLine(workingLines[i]);
      if (!parsed.isFact || !parsed.key || beforeKeySet.has(parsed.key)) continue;
      const bodyRaw = parsed.source ? `${parsed.body} - from: ${parsed.source}` : parsed.body;
      const cleanLine = formatFactLine({
        bullet: parsed.bullet,
        date: parsed.date ?? isoDate(at),
        body: bodyRaw,
        source: safeSource,
      });
      workingLines[i] = cleanLine;
      added.push(cleanLine);
    }

    const finalText = joinLines(workingLines);
    const changedOnDisk = finalText !== afterText;
    if (changedOnDisk) writeMemoryRaw(homeDir, finalText);

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
    return {
      text: finalText,
      kept,
      added,
      changed: changedOnDisk || added.length > 0 || kept.length > 0,
      historyIds,
    };
  }

  function forgetFact({ botId, homeDir, fact, actor = 'bot', at = now() }) {
    const queryRaw = String(fact ?? '').trim();
    if (!queryRaw) throw new BotMemoryError('invalid_argument', 'fact cannot be empty');
    const queryParsed = parseMemoryLine(queryRaw.startsWith('-') || queryRaw.startsWith('*') ? queryRaw : `- ${queryRaw}`);
    const targetKey = queryParsed.key || normalizeFactKey(queryRaw);

    const lines = splitLines(readMemoryRaw(homeDir));
    const removed = [];
    const remaining = [];
    const forgottenKeys = [];

    for (const line of lines) {
      const parsed = parseMemoryLine(line);
      const isMatch = parsed.isFact && (
        line.trim() === queryRaw
        || parsed.key === targetKey
        || normalizeFactKey(parsed.body) === normalizeFactKey(queryRaw)
      );
      if (isMatch) {
        removed.push(line);
        forgottenKeys.push(parsed.key);
      } else {
        remaining.push(line);
      }
    }

    if (removed.length === 0) {
      return { removed: [], forgottenKeys: [], changeId: null };
    }
    writeMemoryRaw(homeDir, joinLines(remaining));
    const entry = appendHistory(botId, { kind: 'forget', actor, removed, undoable: true }, at);
    return { removed, forgottenKeys, changeId: entry.id };
  }

  function addFact({ botId, homeDir, text, date = null, sourceLabel = null, actor = 'owner', at = now() }) {
    const body = sanitizeFactBody(text);
    if (!body) throw new BotMemoryError('invalid_argument', 'Fact text cannot be empty');
    const lines = splitLines(readMemoryRaw(homeDir));
    const line = formatFactLine({
      bullet: '- ',
      date: date ?? isoDate(at),
      body,
      source: sourceLabel,
    });
    lines.push(line);
    writeMemoryRaw(homeDir, joinLines(lines));
    const entry = appendHistory(botId, { kind: 'add', actor, added: [line], sourceLabel, undoable: true }, at);
    return { line, changeId: entry.id };
  }

  function editFact({ botId, homeDir, match, nextText, date = null, actor = 'owner', at = now() }) {
    const body = sanitizeFactBody(nextText);
    if (!body) throw new BotMemoryError('invalid_argument', 'nextText cannot be empty');
    const matchKey = normalizeFactKey(parseMemoryLine(`- ${String(match ?? '').trim()}`).body);
    const lines = splitLines(readMemoryRaw(homeDir));
    const idx = lines.findIndex((line) => {
      const parsed = parseMemoryLine(line);
      return parsed.isFact && (line.trim() === String(match ?? '').trim() || parsed.key === matchKey);
    });
    if (idx === -1) throw new BotMemoryError('not_found', `Fact not found: ${match}`);

    const oldLine = lines[idx];
    const oldParsed = parseMemoryLine(oldLine);
    const newLine = formatFactLine({
      bullet: oldParsed.bullet || '- ',
      date: date ?? oldParsed.date ?? isoDate(at),
      body,
      source: oldParsed.source,
    });
    lines[idx] = newLine;
    writeMemoryRaw(homeDir, joinLines(lines));
    const entry = appendHistory(botId, {
      kind: 'edit',
      actor,
      removed: [oldLine],
      added: [newLine],
      undoable: true,
    }, at);
    return { oldLine, newLine, changeId: entry.id };
  }

  function listHistory(botId, { limit = 100, at = now() } = {}) {
    const entries = loadHistory(botId, at);
    return entries.slice(-Math.max(1, Number(limit) || 100)).reverse();
  }

  function undoChange({ botId, homeDir, changeId, at = now() }) {
    const history = loadHistory(botId, at);
    const targetIdx = history.findIndex((e) => e.id === changeId);
    if (targetIdx === -1) throw new BotMemoryError('not_found', `History change not found: ${changeId}`);
    const target = history[targetIdx];
    if (!target.undoable) {
      throw new BotMemoryError('not_undoable', `Change ${changeId} cannot be undone (redacted or non-undoable)`);
    }
    const alreadyUndone = history.slice(targetIdx + 1).some((e) => e.kind === 'undo' && e.of === changeId);
    if (alreadyUndone) {
      throw new BotMemoryError('already_undone', `Change ${changeId} was already undone`);
    }

    const supersededKeys = new Set();
    for (const newer of history.slice(targetIdx + 1)) {
      for (const key of extractEntryFactKeys(newer)) supersededKeys.add(key);
    }

    const lines = splitLines(readMemoryRaw(homeDir));
    const skippedKeys = [];
    const revertedAdded = [];
    const revertedRemoved = [];

    for (const addedLine of target.added ?? []) {
      const parsed = parseMemoryLine(addedLine);
      if (parsed.key && supersededKeys.has(parsed.key)) {
        skippedKeys.push(parsed.key);
        continue;
      }
      const pos = lines.findIndex((l) => l === addedLine || (parsed.key && parseMemoryLine(l).key === parsed.key));
      if (pos !== -1) {
        lines.splice(pos, 1);
        revertedAdded.push(addedLine);
      }
    }

    const existingKeys = new Set(collectFactEntries(lines).map((f) => f.key));
    for (const removedLine of target.removed ?? []) {
      const parsed = parseMemoryLine(removedLine);
      if (parsed.key && supersededKeys.has(parsed.key)) {
        skippedKeys.push(parsed.key);
        continue;
      }
      if (!parsed.key || !existingKeys.has(parsed.key)) {
        lines.push(removedLine);
        if (parsed.key) existingKeys.add(parsed.key);
        revertedRemoved.push(removedLine);
      }
    }

    writeMemoryRaw(homeDir, joinLines(lines));
    const undoEntry = appendHistory(botId, {
      kind: 'undo',
      of: changeId,
      added: revertedRemoved,
      removed: revertedAdded,
      undoable: false,
    }, at);
    return {
      ok: true,
      changeId: undoEntry.id,
      revertedAdded,
      revertedRemoved,
      skippedKeys: [...new Set(skippedKeys)],
    };
  }

  function applyTidyUpResult(params) {
    const { botId, homeDir, beforeSnapshot, rawOutput = null, proposedMemory = null, topicFiles = null, replacedLines = null, at = now() } = params;
    if (!beforeSnapshot?.signature) {
      throw new BotMemoryError('invalid_argument', 'beforeSnapshot with signature is required');
    }
    if (sha256Hex(readMemoryRaw(homeDir)) !== beforeSnapshot.signature) {
      throw new BotMemoryError('concurrent_modification', 'MEMORY.md changed while tidy-up was running');
    }
    const parsed = rawOutput
      ? parseTidyUpOutput(rawOutput)
      : { proposedMemory, topicFiles: topicFiles ?? {}, replacedLines: replacedLines ?? [] };
    if (typeof parsed.proposedMemory !== 'string') {
      throw new BotMemoryError('invalid_argument', 'Tidy-up result is missing MEMORY.md block');
    }

    const nextLines = splitLines(parsed.proposedMemory);
    if (nextLines.length > MEMORY_MAX_LOADED_LINES) {
      throw new BotMemoryError('exceeds_max_lines', `Proposed MEMORY.md has ${nextLines.length} lines (limit ${MEMORY_MAX_LOADED_LINES})`);
    }

    const beforeFacts = collectFactEntries(splitLines(beforeSnapshot.text));
    const beforeKeyMap = new Map(beforeFacts.map((f) => [f.key, f.raw]));
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

    const archiveLines = collectTidyArchive(removedFacts, parsed.replacedLines);
    const topicsWritten = writeTidyOutputs(homeDir, memoryDir, nextLines, topicEntries, archiveLines, at);
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
      changeId: entry.id,
      archivedCount: archiveLines.length,
      topicsWritten,
      added: addedFacts.map((f) => f.raw),
      removed: removedFacts.map((f) => f.raw),
    };
  }

  return {
    snapshotMemory,
    readMemoryForPrompt,
    reconcileTurnMemory,
    forgetFact,
    addFact,
    editFact,
    listHistory,
    undoChange,
    applyTidyUpResult,
  };
}
