/**
 * SQLite FTS5 indexing and BM25 x time-decay memory search for `memory-service.js`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { withTransaction } from './db.js';
import { sha256Hex } from './fs-home.js';
import { parseMemoryLine, splitLines } from './memory-helpers.js';

const DAILY_FILE_DATE_RE = /^memory\/(\d{4}-\d{2}-\d{2})\.md$/u;
const DAY_MS = 24 * 60 * 60 * 1000;
const DECAY_HALF_LIFE_DAYS = 60;

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
export function syncDocumentToFts(db, params) {
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

/** @param {{ db: any, metaRoot: string, readMemoryRaw: (homeDir: string) => string, readTeamMemoryFile: (metaRoot: string, groupId: string) => string, now: () => number }} deps */
export function createMemoryFtsAccess({ db, metaRoot, readMemoryRaw, readTeamMemoryFile, now }) {
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

  return { indexBotMemory, indexTeamMemory, indexProjectMemory, searchMemory };
}
