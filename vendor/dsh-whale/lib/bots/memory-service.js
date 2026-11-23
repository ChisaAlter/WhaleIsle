/**
 * Bot Memory Service (`MEMORY.md`, `memory/<topic>.md`, `memory/YYYY-MM-DD.md`,
 * `memory/archive.md`, `_meta/team-memory/<groupId>.md`, FTS5 index, and
 * `_meta/bot-memory-history/<encodedBotId>.json`).
 *
 * Preserves 200-line `MEMORY.md` plaintext sovereignty, tamper restoration,
 * anti-spoofing source tagging, secret redaction, undo history, and strict
 * tidy-up verification while adding SQLite FTS5 incremental indexing (BM25 ×
 * time decay), daily logs, pre-compaction flush, and team shared memory.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withTransaction } from './db.js';
import {
  appendDailyMemory, dailyMemoryRelPath, readDailyMemory,
  readTeamMemory as readTeamMemoryFile, sha256Hex, writeAtomicFile,
  writeTeamMemory as writeTeamMemoryFile,
} from './fs-home.js';

export const MEMORY_MAX_LOADED_LINES = 200;
export const MEMORY_SOURCE_SEPARATOR = ' · from: ';
export const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const HISTORY_MAX_ENTRIES = 1000;
export const TIDY_MAX_DELETE_RATIO = 0.2;
export const TIDY_MAX_ARCHIVE_LINES = 20;

const FACT_LINE_RE = /^(\s*[-*]\s+)(.*)$/u;
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})(?:\s*[:–—-]\s*|\s+)(.*)$/u;
const DAILY_FILE_DATE_RE = /^memory\/(\d{4}-\d{2}-\d{2})\.md$/u;
const SPOOFED_SOURCE_RE = /\s*·\s*from\s*:/giu;
const TOPIC_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DAY_MS = 24 * 60 * 60 * 1000;
const DECAY_HALF_LIFE_DAYS = 60;

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
  /** @param {string} code @param {string} message @param {Record<string, any>} [data] */
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'BotMemoryError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** @param {number} ts */
const isoDate = (ts) => new Date(ts).toISOString().slice(0, 10);

/** @param {string} text */
export const normalizeFactKey = (text) => String(text ?? '').replace(/\s+/gu, ' ').trim().toLowerCase();

/** @param {string} text */
export const sanitizeFactBody = (text) => String(text ?? '')
  .replace(/\r?\n/gu, ' ').replace(SPOOFED_SOURCE_RE, ' - from:').replace(/\s+/gu, ' ').trim();

/** @param {string} sourceLabel */
const sanitizeSourceLabel = (sourceLabel) => sanitizeFactBody(sourceLabel).slice(0, 240);

/** @param {string} line */
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
  return { isFact: true, raw, bullet, date, body: rest, source, key: normalizeFactKey(rest) };
}

/** @param {{ bullet?: string, date?: string | null, body: string, source?: string | null }} parts */
export function formatFactLine({ bullet = '- ', date = null, body, source = null }) {
  const safeBody = sanitizeFactBody(body);
  const datePart = date ? `${date} ` : '';
  const sourcePart = source ? `${MEMORY_SOURCE_SEPARATOR}${sanitizeSourceLabel(source)}` : '';
  return `${bullet}${datePart}${safeBody}${sourcePart}`;
}

/** @param {string} text */
export function redactSecrets(text) {
  let out = String(text ?? '');
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (_match, keyName) => {
      redacted = true;
      return keyName ? `${keyName}=[REDACTED]` : '[REDACTED]';
    });
  }
  return { text: out, redacted };
}

/** @param {string} text */
function splitLines(text) {
  const normalized = String(text ?? '').replace(/\r\n/gu, '\n');
  if (!normalized) return [];
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return trimmed === '' ? [] : trimmed.split('\n');
}

/** @param {string[]} lines */
const joinLines = (lines) => (lines.length === 0 ? '' : `${lines.join('\n')}\n`);

/** @param {string} homeDir */
function readMemoryRaw(homeDir) {
  const file = path.join(homeDir, 'MEMORY.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @param {string} homeDir @param {string} content */
const writeMemoryRaw = (homeDir, content) => writeAtomicFile(path.join(homeDir, 'MEMORY.md'), content);

/** @param {string} homeDir @param {number} [maxLines] */
export function readMemoryForPrompt(homeDir, maxLines = MEMORY_MAX_LOADED_LINES) {
  const lines = splitLines(readMemoryRaw(homeDir));
  const totalLines = lines.length;
  if (totalLines <= maxLines) {
    return { text: joinLines(lines), totalLines, loadedLines: totalLines, truncatedLines: 0 };
  }
  const truncatedLines = totalLines - maxLines;
  const text = `${lines.slice(0, maxLines).join('\n')}\n(${truncatedLines} more lines in MEMORY.md not loaded)\n`;
  return { text, totalLines, loadedLines: maxLines, truncatedLines };
}

/**
 * Parse `BEGIN MEMORY.md` / `BEGIN memory/<topic>.md` / `BEGIN REPLACED` / `BEGIN PROPOSAL` blocks.
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
  /** @type {string[]} */
  const proposals = [];

  /** @type {{ kind: string, target: string, buf: string[] } | null} */
  let active = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!active) {
      if (trimmed === 'BEGIN MEMORY.md') active = { kind: 'memory', target: 'MEMORY.md', buf: [] };
      else if (trimmed === 'BEGIN REPLACED') active = { kind: 'replaced', target: 'REPLACED', buf: [] };
      else if (trimmed === 'BEGIN PROPOSAL') active = { kind: 'proposal', target: 'PROPOSAL', buf: [] };
      else if (trimmed.startsWith('BEGIN memory/') && trimmed.endsWith('.md')) {
        active = { kind: 'topic', target: trimmed.slice('BEGIN memory/'.length, -'.md'.length), buf: [] };
      }
      continue;
    }
    const expectedEnd = active.kind === 'topic' ? `END memory/${active.target}.md` : `END ${active.target}`;
    if (trimmed === expectedEnd) {
      if (active.kind === 'memory') proposedMemory = joinLines(active.buf);
      else if (active.kind === 'topic') topicFiles[active.target] = joinLines(active.buf);
      else if (active.kind === 'replaced') replacedLines = active.buf.filter((l) => l.trim() !== '');
      else if (active.kind === 'proposal') {
        const block = active.buf.join('\n').trim();
        if (block) proposals.push(block);
      }
      active = null;
      continue;
    }
    active.buf.push(line);
  }
  return { proposedMemory, topicFiles, replacedLines, proposals };
}

/** @param {string[]} lines */
const collectFactEntries = (lines) => lines
  .map((line, index) => ({ ...parseMemoryLine(line), index }))
  .filter((entry) => entry.isFact && entry.key);

/** @param {string[]} working @param {string[]} beforeLines @param {number} origIdx @param {string} rawLine */
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
    throw new BotMemoryError('archive_limit_exceeded', `Tidy-up archives ${archiveMap.size} lines (limit ${TIDY_MAX_ARCHIVE_LINES})`);
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

/** @param {string} content @param {{ scope: string, scopeId: string, sourceFile: string, defaultDate?: string | null }} opts */
function extractIndexableEntries(content, { scope, scopeId, sourceFile, defaultDate = null }) {
  const entries = [];
  const seen = new Set();
  for (const line of splitLines(content)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parsed = parseMemoryLine(line);
    const body = parsed.isFact ? parsed.body : trimmed;
    if (!body) continue;
    const lineHash = sha256Hex(`${parsed.date ?? defaultDate ?? ''}|${body}`);
    const entryId = `${scope}:${scopeId}:${sourceFile}:${lineHash.slice(0, 16)}`;
    if (seen.has(entryId)) continue;
    seen.add(entryId);
    entries.push({ entryId, lineHash, factDate: parsed.date ?? defaultDate, body });
  }
  return entries;
}

/** @param {any} db @param {{ scope: string, scopeId: string, botId: string | null, sourceFile: string, content: string, defaultDate?: string | null, at: number }} params */
function syncDocumentToFts(db, params) {
  if (!db) return { inserted: 0, deleted: 0, total: 0 };
  const { scope, scopeId, botId, sourceFile, content, defaultDate = null, at } = params;
  const desired = extractIndexableEntries(content, { scope, scopeId, sourceFile, defaultDate });
  const desiredMap = new Map(desired.map((e) => [e.entryId, e]));

  return withTransaction(db, () => {
    const existingRows = db.prepare(
      'SELECT entry_id, line_hash FROM memory_index_meta WHERE scope = ? AND scope_id = ? AND source_file = ?',
    ).all(scope, scopeId, sourceFile);
    const existingMap = new Map(existingRows.map((/** @type {any} */ r) => [String(r.entry_id), String(r.line_hash)]));

    const delMeta = db.prepare('DELETE FROM memory_index_meta WHERE entry_id = ?');
    const delFts = db.prepare('DELETE FROM memory_fts WHERE entry_id = ?');
    const insMeta = db.prepare(
      'INSERT INTO memory_index_meta (entry_id, scope, scope_id, bot_id, source_file, line_hash, fact_date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insFts = db.prepare(
      'INSERT INTO memory_fts (entry_id, scope, scope_id, bot_id, source_file, fact_date, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );

    let deleted = 0;
    let inserted = 0;
    for (const [entryId, oldHash] of existingMap.entries()) {
      const next = desiredMap.get(entryId);
      if (!next || next.lineHash !== oldHash) {
        delMeta.run(entryId);
        delFts.run(entryId);
        deleted += 1;
      }
    }
    for (const item of desired) {
      if (existingMap.get(item.entryId) === item.lineHash) continue;
      insMeta.run(item.entryId, scope, scopeId, botId, sourceFile, item.lineHash, item.factDate, at);
      insFts.run(item.entryId, scope, scopeId, botId, sourceFile, item.factDate, item.body);
      inserted += 1;
    }
    return { inserted, deleted, total: desired.length };
  });
}

/** @param {string} query */
function tokenizeQuery(query) {
  return String(query ?? '')
    .replace(/["*^():+-]/gu, ' ')
    .split(/\s+/u)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** @param {string} factDate @param {number} updatedAt @param {number} at */
function computeTimeDecay(factDate, updatedAt, at) {
  let refMs = updatedAt;
  if (typeof factDate === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(factDate)) {
    const parsed = Date.parse(`${factDate}T00:00:00Z`);
    if (Number.isFinite(parsed)) refMs = parsed;
  }
  const ageDays = Math.max(0, (at - refMs) / DAY_MS);
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
}

/** @param {{ botId?: string | null, scope?: string | null, groupId?: string | null, projectId?: string | null }} filters */
function buildSearchScopeWhere({ botId = null, scope = null, groupId = null, projectId = null }) {
  const s = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
  if (s === 'bot') {
    return botId ? { sql: "m.scope = 'bot' AND m.scope_id = ?", params: [String(botId)] } : { sql: "m.scope = 'bot'", params: [] };
  }
  if (s === 'team') {
    return groupId ? { sql: "m.scope = 'team' AND m.scope_id = ?", params: [String(groupId)] } : { sql: "m.scope = 'team'", params: [] };
  }
  if (s === 'project') {
    return projectId ? { sql: "m.scope = 'project' AND m.scope_id = ?", params: [String(projectId)] } : { sql: "m.scope = 'project'", params: [] };
  }
  const branches = [];
  const params = [];
  if (botId) { branches.push("(m.scope = 'bot' AND m.scope_id = ?)"); params.push(String(botId)); }
  if (groupId) { branches.push("(m.scope = 'team' AND m.scope_id = ?)"); params.push(String(groupId)); }
  if (projectId) { branches.push("(m.scope = 'project' AND m.scope_id = ?)"); params.push(String(projectId)); }
  if (branches.length === 0) return { sql: '1 = 1', params: [] };
  return { sql: `(${branches.join(' OR ')})`, params };
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

/** @param {any} db @param {string[]} tokens @param {{ sql: string, params: any[] }} scopeWhere @param {number} safeLimit */
function queryMemoryFtsRows(db, tokens, scopeWhere, safeLimit) {
  const matchExpr = tokens.map((t) => `"${t}"*`).join(' ');
  const selectCols = 'm.entry_id, m.scope, m.scope_id, m.bot_id, m.source_file, m.fact_date, m.updated_at, f.body';
  try {
    const ftsRows = db.prepare(
      `SELECT ${selectCols}, bm25(memory_fts) AS rank FROM memory_fts f JOIN memory_index_meta m ON m.entry_id = f.entry_id WHERE memory_fts MATCH ? AND ${scopeWhere.sql} LIMIT ?`,
    ).all(matchExpr, ...scopeWhere.params, safeLimit * 4);
    if (ftsRows.length > 0) return ftsRows;
  } catch {
    // Fall through to bounded LIKE search on syntax mismatch.
  }
  const likeClauses = tokens.map(() => 'f.body LIKE ?').join(' AND ');
  const likeParams = tokens.map((t) => `%${t}%`);
  return db.prepare(
    `SELECT ${selectCols}, -1.0 AS rank FROM memory_fts f JOIN memory_index_meta m ON m.entry_id = f.entry_id WHERE ${likeClauses} AND ${scopeWhere.sql} LIMIT ?`,
  ).all(...likeParams, ...scopeWhere.params, safeLimit * 4);
}

/**
 * Create a memory service bound to `_meta` root and optional SQLite `db` for FTS5.
 * @param {{ metaRoot: string, db?: any, now?: () => number }} options
 */
export function createMemoryService({ metaRoot, db = null, now = () => Date.now() }) {
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
    return entries.filter((e) => Number(e?.at ?? 0) >= cutoff).slice(-HISTORY_MAX_ENTRIES);
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

  /** @param {{ botId: string, homeDir: string, at?: number }} args */
  function indexBotMemory({ botId, homeDir, at = now() }) {
    if (!db || !botId || !homeDir) return { inserted: 0, deleted: 0, total: 0, files: 0 };
    const id = String(botId);
    const acc = { inserted: 0, deleted: 0, total: 0, files: 0 };
    const addRes = (/** @type {any} */ res) => { acc.inserted += res.inserted; acc.deleted += res.deleted; acc.total += res.total; acc.files += 1; };
    addRes(syncDocumentToFts(db, { scope: 'bot', scopeId: id, botId: id, sourceFile: 'MEMORY.md', content: readMemoryRaw(homeDir), at }));
    const memDir = path.join(homeDir, 'memory');
    if (fs.existsSync(memDir)) {
      for (const name of fs.readdirSync(memDir).sort()) {
        if (!name.endsWith('.md') || name === 'archive.md') continue;
        const rel = `memory/${name}`;
        const dateMatch = DAILY_FILE_DATE_RE.exec(rel);
        addRes(syncDocumentToFts(db, {
          scope: 'bot', scopeId: id, botId: id, sourceFile: rel,
          content: fs.readFileSync(path.join(memDir, name), 'utf8'),
          defaultDate: dateMatch ? dateMatch[1] : null, at,
        }));
      }
    }
    return acc;
  }

  /** @param {{ groupId: string, content?: string | null, at?: number }} args */
  function indexTeamMemory({ groupId, content = null, at = now() }) {
    if (!db || !groupId) return { inserted: 0, deleted: 0, total: 0 };
    const text = typeof content === 'string' ? content : readTeamMemoryFile(metaRoot, groupId);
    return syncDocumentToFts(db, {
      scope: 'team', scopeId: String(groupId), botId: null, sourceFile: `team-memory/${groupId}.md`, content: text, at,
    });
  }

  /** @param {{ projectId: string, projectDir?: string | null, content?: string | null, sourceFile?: string, at?: number }} args */
  function indexProjectMemory({ projectId, projectDir = null, content = null, sourceFile = 'PROJECT_MEMORY.md', at = now() }) {
    if (!db || !projectId) return { inserted: 0, deleted: 0, total: 0 };
    let text = typeof content === 'string' ? content : '';
    if (!text && projectDir) {
      const candidate = path.join(projectDir, sourceFile);
      if (fs.existsSync(candidate)) text = fs.readFileSync(candidate, 'utf8');
    }
    return syncDocumentToFts(db, { scope: 'project', scopeId: String(projectId), botId: null, sourceFile, content: text, at });
  }

  /** @param {{ botId?: string | null, query?: string, scope?: string | null, groupId?: string | null, projectId?: string | null, limit?: number, at?: number }} [args] */
  function searchMemory({ botId = null, query = '', scope = null, groupId = null, projectId = null, limit = 20, at = now() } = {}) {
    if (!db) return [];
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0) return [];
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const scopeWhere = buildSearchScopeWhere({ botId, scope, groupId, projectId });
    return queryMemoryFtsRows(db, tokens, scopeWhere, safeLimit)
      .map((/** @type {any} */ r) => {
        const bm25 = Math.max(0.1, -Number(r.rank || 0));
        const decay = computeTimeDecay(r.fact_date, Number(r.updated_at ?? at), at);
        return {
          entryId: r.entry_id, scope: r.scope, scopeId: r.scope_id, botId: r.bot_id ?? null,
          sourceFile: r.source_file, factDate: r.fact_date ?? null, body: r.body,
          updatedAt: Number(r.updated_at ?? 0),
          bm25: Number(bm25.toFixed(6)), decay: Number(decay.toFixed(6)), score: Number((bm25 * decay).toFixed(6)),
        };
      })
      .sort((/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score)
      .slice(0, safeLimit);
  }

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

  function snapshotMemory(homeDir, at = now()) {
    const text = readMemoryRaw(homeDir);
    return { text, signature: sha256Hex(text), lines: splitLines(text), at };
  }

  function reconcileTurnMemory({ botId, homeDir, beforeText, sourceLabel = null, forgottenKeys = [], at = now() }) {
    const afterText = readMemoryRaw(homeDir);
    const beforeLines = splitLines(beforeText);
    const workingLines = splitLines(afterText);
    const { kept, beforeKeySet } = restoreRemovedFacts(beforeLines, workingLines, forgottenKeys);
    const safeSource = sourceLabel ? sanitizeSourceLabel(sourceLabel) : null;
    const added = tagAddedFacts(workingLines, beforeKeySet, safeSource, at);

    const finalText = joinLines(workingLines);
    const changedOnDisk = finalText !== afterText;
    if (changedOnDisk) writeMemoryRaw(homeDir, finalText);

    const historyIds = [];
    if (kept.length > 0) historyIds.push(appendHistory(botId, { kind: 'kept', kept, undoable: false }, at).id);
    if (added.length > 0) historyIds.push(appendHistory(botId, { kind: 'chat', added, sourceLabel: safeSource, undoable: true }, at).id);
    const changed = changedOnDisk || added.length > 0 || kept.length > 0;
    if (changed && db) indexBotMemory({ botId, homeDir, at });
    return { text: finalText, kept, added, changed, historyIds };
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
        line.trim() === queryRaw || parsed.key === targetKey || normalizeFactKey(parsed.body) === normalizeFactKey(queryRaw)
      );
      if (isMatch) { removed.push(line); forgottenKeys.push(parsed.key); }
      else remaining.push(line);
    }
    if (removed.length === 0) return { removed: [], forgottenKeys: [], changeId: null };
    writeMemoryRaw(homeDir, joinLines(remaining));
    const entry = appendHistory(botId, { kind: 'forget', actor, removed, undoable: true }, at);
    if (db) indexBotMemory({ botId, homeDir, at });
    return { removed, forgottenKeys, changeId: entry.id };
  }

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
    const newLine = formatFactLine({ bullet: oldParsed.bullet || '- ', date: date ?? oldParsed.date ?? isoDate(at), body, source: oldParsed.source });
    lines[idx] = newLine;
    writeMemoryRaw(homeDir, joinLines(lines));
    const entry = appendHistory(botId, { kind: 'edit', actor, removed: [oldLine], added: [newLine], undoable: true }, at);
    if (db) indexBotMemory({ botId, homeDir, at });
    return { oldLine, newLine, changeId: entry.id };
  }

  function listHistory(botId, { limit = 100, at = now() } = {}) {
    return loadHistory(botId, at).slice(-Math.max(1, Number(limit) || 100)).reverse();
  }

  function undoChange({ botId, homeDir, changeId, at = now() }) {
    const history = loadHistory(botId, at);
    const targetIdx = history.findIndex((e) => e.id === changeId);
    if (targetIdx === -1) throw new BotMemoryError('not_found', `History change not found: ${changeId}`);
    const target = history[targetIdx];
    if (!target.undoable) throw new BotMemoryError('not_undoable', `Change ${changeId} cannot be undone (redacted or non-undoable)`);
    if (history.slice(targetIdx + 1).some((e) => e.kind === 'undo' && e.of === changeId)) {
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

  function applyTidyUpResult(params) {
    const { botId, homeDir, beforeSnapshot, rawOutput = null, proposedMemory = null, topicFiles = null, replacedLines = null, at = now() } = params;
    if (!beforeSnapshot?.signature) throw new BotMemoryError('invalid_argument', 'beforeSnapshot with signature is required');
    if (sha256Hex(readMemoryRaw(homeDir)) !== beforeSnapshot.signature) {
      throw new BotMemoryError('concurrent_modification', 'MEMORY.md changed while tidy-up was running');
    }
    const parsed = rawOutput
      ? parseTidyUpOutput(rawOutput)
      : { proposedMemory, topicFiles: topicFiles ?? {}, replacedLines: replacedLines ?? [], proposals: [] };
    if (typeof parsed.proposedMemory !== 'string') throw new BotMemoryError('invalid_argument', 'Tidy-up result is missing MEMORY.md block');

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
      kind: 'tidy-up', added: addedFacts.map((f) => f.raw), removed: removedFacts.map((f) => f.raw),
      topicsWritten, archivedCount: archiveLines.length, undoable: true,
    }, at);
    if (db) indexBotMemory({ botId, homeDir, at });
    return {
      ok: true, changeId: entry.id, archivedCount: archiveLines.length, topicsWritten,
      added: addedFacts.map((f) => f.raw), removed: removedFacts.map((f) => f.raw), proposals: parsed.proposals ?? [],
    };
  }

  return {
    snapshotMemory, readMemoryForPrompt, reconcileTurnMemory,
    forgetFact, addFact, editFact, listHistory, undoChange, applyTidyUpResult,
    indexBotMemory, indexTeamMemory, indexProjectMemory, searchMemory,
    appendDailyLog, readDailyLog, flushBeforeCompaction, readTeamMemory, writeTeamMemory,
  };
}
