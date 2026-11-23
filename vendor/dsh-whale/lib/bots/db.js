/**
 * Unified SQLite storage engine for WhaleIsle Bots (`$DSH_HOME/data/bots/bots.db`).
 * Built exclusively on Node 24's built-in `node:sqlite` (`DatabaseSync`).
 *
 * Hosts all bot domains in one WAL database with versioned migrations:
 * - Core registry, global settings, and chats (`bots`, `bot_global_settings`, `bot_chats`)
 * - Work items (`bot_items`, `bot_item_links`, `bot_item_events`)
 * - Bot groups (`bot_groups`, `bot_group_messages`, `bot_group_operations`,
 *   `bot_group_pending`, `bot_group_worker_operations`, `bot_group_sidebar`)
 * - Orchestration, automations & access (`bot_requests`, `bot_conversation_acts_for`,
 *   `bot_run_resends`, `bot_request_outcomes`, `bot_work`, `bot_automations`,
 *   `bot_access_requests`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_V1_SQL, SCHEMA_V2_SQL } from './db-schema.js';

export const BOTS_SCHEMA_VERSION = 2;

const DEFAULT_GLOBAL_CONFIG = Object.freeze({
  botsEnabled: true,
  hideBotCreatedWorkspaces: true,
  botSidebarView: null,
  petBotId: null,
});

const txDepthMap = new WeakMap();
const readOnlyDbMap = new WeakMap();

export class BotsDbReadOnlyError extends Error {
  /**
   * @param {string} [code]
   * @param {string} [message]
   * @param {Record<string, any>} [data]
   */
  constructor(
    code = 'db_read_only',
    message = 'Database schema is newer than this version of WhaleIsle and was opened read-only.',
    data = undefined,
  ) {
    super(message);
    this.name = 'BotsDbReadOnlyError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** @param {DatabaseSync} db */
export function isDatabaseReadOnly(db) {
  if (!db) return false;
  const cached = readOnlyDbMap.get(db);
  if (cached !== undefined) return cached.readOnly === true;
  try {
    const version = readUserVersion(db);
    if (version > BOTS_SCHEMA_VERSION) {
      readOnlyDbMap.set(db, { readOnly: true, schemaVersion: version });
      return true;
    }
  } catch {
    // Ignore pragma read errors on closed handles.
  }
  return false;
}

/**
 * Guard write operations when a database was opened read-only due to a newer schema version.
 * @param {DatabaseSync} db
 * @param {string} [code]
 */
export function assertDatabaseWritable(db, code = 'db_read_only') {
  if (!isDatabaseReadOnly(db)) return;
  const meta = readOnlyDbMap.get(db);
  throw new BotsDbReadOnlyError(
    code,
    `Database schema v${meta?.schemaVersion ?? 'unknown'} is newer than supported v${BOTS_SCHEMA_VERSION}; writes are disabled in read-only mode.`,
    { schemaVersion: meta?.schemaVersion ?? null, supportedVersion: BOTS_SCHEMA_VERSION },
  );
}

/** @param {string} dshHome */
export function botsDbPath(dshHome) {
  if (!dshHome) throw new Error('dshHome is required to resolve bots.db path');
  return path.join(dshHome, 'data', 'bots', 'bots.db');
}

const MIGRATIONS = [
  { version: 1, sql: SCHEMA_V1_SQL },
  { version: 2, sql: SCHEMA_V2_SQL },
];

/**
 * Run `fn` inside an atomic transaction (supports nested calls via savepoints).
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @param {{ readOnlyCode?: string }} [options]
 * @returns {T}
 */
export function withTransaction(db, fn, options = {}) {
  assertDatabaseWritable(db, options.readOnlyCode ?? 'db_read_only');
  const depth = txDepthMap.get(db) ?? 0;
  const savepoint = `sp_bots_${depth + 1}`;
  if (depth === 0) {
    db.exec('BEGIN IMMEDIATE');
  } else {
    db.exec(`SAVEPOINT ${savepoint}`);
  }
  txDepthMap.set(db, depth + 1);
  try {
    const result = fn();
    if (depth === 0) {
      db.exec('COMMIT');
    } else {
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
    return result;
  } catch (error) {
    rollbackQuietly(db, depth, savepoint);
    throw error;
  } finally {
    if (depth === 0) {
      txDepthMap.delete(db);
    } else {
      txDepthMap.set(db, depth);
    }
  }
}

/**
 * @param {DatabaseSync} db
 * @param {number} depth
 * @param {string} savepoint
 */
function rollbackQuietly(db, depth, savepoint) {
  try {
    if (depth === 0) {
      db.exec('ROLLBACK');
    } else {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
  } catch {
    // Rollback may fail if SQLite already aborted the transaction.
  }
}

/** @param {DatabaseSync} db */
function readUserVersion(db) {
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row?.user_version ?? 0);
}

/** @param {DatabaseSync} db */
function runMigrations(db) {
  const current = readUserVersion(db);
  if (current > BOTS_SCHEMA_VERSION) {
    readOnlyDbMap.set(db, { readOnly: true, schemaVersion: current });
    db.exec('PRAGMA query_only = ON');
    return { isReadOnly: true, schemaVersion: current };
  }
  const pending = MIGRATIONS.filter((migration) => migration.version > current);
  if (pending.length > 0) {
    withTransaction(db, () => {
      for (const migration of pending) {
        db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${migration.version}`);
      }
    });
  }
  const finalVersion = readUserVersion(db);
  readOnlyDbMap.set(db, { readOnly: false, schemaVersion: finalVersion });
  return { isReadOnly: false, schemaVersion: finalVersion };
}

/**
 * Open and migrate the bots SQLite database.
 * If the on-disk database has `user_version > BOTS_SCHEMA_VERSION`, degrades
 * cleanly to read-only mode (`isReadOnly: true`) without running migrations or
 * mutating the database file.
 * @param {string | { dbPath?: string, dshHome?: string }} pathOrOptions
 * @returns {{ db: DatabaseSync, dbPath: string, bots: ReturnType<typeof createBotsStore>, isReadOnly: boolean, schemaVersion: number, transaction: <T>(fn: () => T) => T, close: () => void }}
 */
export function openBotsDatabase(pathOrOptions) {
  const targetPath = typeof pathOrOptions === 'string'
    ? pathOrOptions
    : (pathOrOptions?.dbPath || botsDbPath(pathOrOptions?.dshHome ?? ''));
  if (!targetPath) throw new Error('openBotsDatabase requires a dbPath or dshHome');
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  /** @type {DatabaseSync | undefined} */
  let db;
  let isReadOnly = false;
  let schemaVersion = BOTS_SCHEMA_VERSION;

  try {
    if (targetPath !== ':memory:' && fs.existsSync(targetPath)) {
      const probe = new DatabaseSync(targetPath, { readOnly: true });
      let existingVersion = 0;
      try {
        existingVersion = readUserVersion(probe);
      } catch (err) {
        try { probe.close(); } catch { /* Best-effort close on probe failure. */ }
        throw err;
      }
      if (existingVersion > BOTS_SCHEMA_VERSION) {
        db = probe;
        isReadOnly = true;
        schemaVersion = existingVersion;
        db.exec('PRAGMA busy_timeout = 5000');
        db.exec('PRAGMA query_only = ON');
        readOnlyDbMap.set(db, { readOnly: true, schemaVersion: existingVersion });
      } else {
        probe.close();
        db = new DatabaseSync(targetPath);
      }
    } else {
      db = new DatabaseSync(targetPath);
    }

    if (!isReadOnly) {
      if (targetPath !== ':memory:') {
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA synchronous = NORMAL');
      }
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec('PRAGMA foreign_keys = ON');
      const migrated = runMigrations(db);
      isReadOnly = migrated.isReadOnly;
      schemaVersion = migrated.schemaVersion;
    }

    const conn = db;
    const bots = createBotsStore(conn);
    return {
      db: conn,
      dbPath: targetPath,
      bots,
      isReadOnly,
      schemaVersion,
      transaction(fn) {
        return withTransaction(conn, fn);
      },
      close() {
        txDepthMap.delete(conn);
        readOnlyDbMap.delete(conn);
        conn.close();
      },
    };
  } catch (error) {
    if (db) {
      txDepthMap.delete(db);
      readOnlyDbMap.delete(db);
      try { db.close(); } catch { /* Best-effort close on failed open. */ }
    }
    throw error;
  }
}

/**
 * Parse a JSON column safely.
 * @param {string | null | undefined} raw
 * @param {any} fallback
 */
function parseJson(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  return JSON.parse(raw);
}

/**
 * Sort bots following Orca's sidebar ordering:
 * bots without explicit `sidebarOrder` sit at top (newest `createdAt` first),
 * followed by ordered bots in ascending `sidebarOrder`.
 * @param {any} a
 * @param {any} b
 */
function compareBots(a, b) {
  const hasA = typeof a.sidebarOrder === 'number';
  const hasB = typeof b.sidebarOrder === 'number';
  if (hasA && hasB && a.sidebarOrder !== b.sidebarOrder) {
    return a.sidebarOrder - b.sidebarOrder;
  }
  if (hasA !== hasB) return hasA ? 1 : -1;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

/** @param {any} chat @param {any} existing @param {string} key @param {any} fallback */
function pickChatField(chat, existing, key, fallback = null) {
  if (chat[key] !== undefined) return chat[key];
  if (existing && existing[key] !== undefined) return existing[key];
  return fallback;
}

/** @param {any} chat @param {any} existing @param {number} now */
function normalizeChatInput(chat, existing, now) {
  if (!chat?.sessionId || !chat?.botId) {
    throw new Error('Chat record requires sessionId and botId');
  }
  const kind = pickChatField(chat, existing, 'kind', 'side');
  const rest = { ...chat };
  for (const key of [
    'sessionId', 'botId', 'kind', 'title', 'origin',
    'externalSource', 'externalId', 'closedAt', 'seenAt', 'createdAt', 'updatedAt',
  ]) {
    delete rest[key];
  }
  return {
    sessionId: chat.sessionId,
    botId: chat.botId,
    kind,
    title: pickChatField(chat, existing, 'title'),
    origin: pickChatField(chat, existing, 'origin', kind),
    externalSource: pickChatField(chat, existing, 'externalSource'),
    externalId: pickChatField(chat, existing, 'externalId'),
    closedAt: pickChatField(chat, existing, 'closedAt'),
    seenAt: pickChatField(chat, existing, 'seenAt'),
    createdAt: existing?.createdAt ?? (Number.isFinite(chat.createdAt) ? chat.createdAt : now),
    updatedAt: Number.isFinite(chat.updatedAt) ? chat.updatedAt : now,
    rest,
  };
}

/** @param {any} row */
function mapChatRow(row) {
  if (!row) return null;
  const extra = parseJson(row.record, {});
  return {
    ...extra,
    sessionId: row.session_id,
    botId: row.bot_id,
    kind: row.kind,
    title: row.title ?? null,
    origin: row.origin,
    externalSource: row.external_source ?? null,
    externalId: row.external_id ?? null,
    closedAt: row.closed_at ?? null,
    seenAt: row.seen_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Core CRUD store for `bots`, `bot_global_settings`, and `bot_chats`.
 * @param {DatabaseSync} db
 */
export function createBotsStore(db) {
  const selectBotById = db.prepare('SELECT record FROM bots WHERE id = ?');
  const selectBotByFolder = db.prepare('SELECT record FROM bots WHERE folder = ?');
  const selectBotByName = db.prepare('SELECT record FROM bots WHERE lower(name) = lower(?)');
  const selectAllBots = db.prepare('SELECT record FROM bots');
  const insertBotStmt = db.prepare(
    'INSERT INTO bots (id, folder, name, record, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const updateBotStmt = db.prepare(
    'UPDATE bots SET folder = ?, name = ?, record = ?, updated_at = ? WHERE id = ?',
  );
  const deleteBotStmt = db.prepare('DELETE FROM bots WHERE id = ?');

  const selectSettingStmt = db.prepare('SELECT value FROM bot_global_settings WHERE key = ?');
  const selectAllSettingsStmt = db.prepare('SELECT key, value FROM bot_global_settings');
  const upsertSettingStmt = db.prepare(`
    INSERT INTO bot_global_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const deleteSettingStmt = db.prepare('DELETE FROM bot_global_settings WHERE key = ?');

  const selectChatStmt = db.prepare('SELECT * FROM bot_chats WHERE session_id = ?');
  const selectChatsByBotStmt = db.prepare(
    'SELECT * FROM bot_chats WHERE bot_id = ? ORDER BY updated_at DESC, created_at DESC',
  );
  const selectOpenChatsByBotStmt = db.prepare(
    'SELECT * FROM bot_chats WHERE bot_id = ? AND closed_at IS NULL ORDER BY updated_at DESC, created_at DESC',
  );
  const selectExternalChatStmt = db.prepare(
    'SELECT * FROM bot_chats WHERE external_source = ? AND external_id = ? LIMIT 1',
  );
  const upsertChatStmt = db.prepare(`
    INSERT INTO bot_chats (
      session_id, bot_id, kind, title, origin, external_source, external_id,
      record, closed_at, seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      bot_id = excluded.bot_id,
      kind = excluded.kind,
      title = excluded.title,
      origin = excluded.origin,
      external_source = excluded.external_source,
      external_id = excluded.external_id,
      record = excluded.record,
      closed_at = excluded.closed_at,
      seen_at = excluded.seen_at,
      updated_at = excluded.updated_at
  `);
  const markChatSeenStmt = db.prepare(
    'UPDATE bot_chats SET seen_at = ?, updated_at = max(updated_at, ?) WHERE session_id = ?',
  );
  const closeChatStmt = db.prepare(
    'UPDATE bot_chats SET closed_at = ?, updated_at = ? WHERE session_id = ?',
  );
  const deleteChatStmt = db.prepare('DELETE FROM bot_chats WHERE session_id = ?');

  function getBot(id) {
    const row = selectBotById.get(String(id));
    return row ? parseJson(row.record, null) : null;
  }

  function getBotByFolder(folder) {
    const row = selectBotByFolder.get(String(folder));
    return row ? parseJson(row.record, null) : null;
  }

  function getBotByName(name) {
    const row = selectBotByName.get(String(name));
    return row ? parseJson(row.record, null) : null;
  }

  function listBots() {
    const rows = selectAllBots.all();
    return rows.map((row) => parseJson(row.record, null)).filter(Boolean).sort(compareBots);
  }

  function insertBot(bot, now = Date.now()) {
    assertDatabaseWritable(db, 'db_read_only');
    if (!bot?.id || !bot?.folder || !bot?.name) {
      throw new Error('Bot record requires id, folder, and name');
    }
    const createdAt = Number.isFinite(bot.createdAt) ? bot.createdAt : now;
    const updatedAt = Number.isFinite(bot.updatedAt) ? bot.updatedAt : createdAt;
    const normalized = { ...bot, createdAt, updatedAt };
    insertBotStmt.run(
      normalized.id,
      normalized.folder,
      normalized.name,
      JSON.stringify(normalized),
      createdAt,
      updatedAt,
    );
    return normalized;
  }

  function updateBot(id, patchOrUpdater, now = Date.now()) {
    return withTransaction(db, () => {
      const current = getBot(id);
      if (!current) return null;
      const nextRaw = typeof patchOrUpdater === 'function'
        ? patchOrUpdater(structuredClone(current))
        : { ...current, ...patchOrUpdater };
      const updatedAt = Number.isFinite(nextRaw?.updatedAt) && nextRaw.updatedAt !== current.updatedAt
        ? nextRaw.updatedAt
        : now;
      const next = { ...nextRaw, id: current.id, createdAt: current.createdAt, updatedAt };
      updateBotStmt.run(next.folder, next.name, JSON.stringify(next), updatedAt, current.id);
      return next;
    });
  }

  function deleteBot(id) {
    assertDatabaseWritable(db, 'db_read_only');
    const info = deleteBotStmt.run(String(id));
    return Number(info.changes ?? 0) > 0;
  }

  function getSetting(key, fallback = undefined) {
    const row = selectSettingStmt.get(String(key));
    return row ? parseJson(row.value, fallback) : fallback;
  }

  function setSetting(key, value, now = Date.now()) {
    assertDatabaseWritable(db, 'db_read_only');
    upsertSettingStmt.run(String(key), JSON.stringify(value), now);
    return value;
  }

  function deleteSetting(key) {
    assertDatabaseWritable(db, 'db_read_only');
    const info = deleteSettingStmt.run(String(key));
    return Number(info.changes ?? 0) > 0;
  }

  function getAllSettings() {
    /** @type {Record<string, any>} */
    const out = {};
    for (const row of selectAllSettingsStmt.all()) {
      out[row.key] = parseJson(row.value, null);
    }
    return out;
  }

  function getGlobalConfig() {
    const all = getAllSettings();
    return {
      botsEnabled: all.botsEnabled !== false,
      hideBotCreatedWorkspaces: all.hideBotCreatedWorkspaces !== false,
      botSidebarView: all.botSidebarView ?? DEFAULT_GLOBAL_CONFIG.botSidebarView,
      petBotId: all.petBotId ?? DEFAULT_GLOBAL_CONFIG.petBotId,
    };
  }

  function updateGlobalConfig(patch, now = Date.now()) {
    return withTransaction(db, () => {
      for (const key of Object.keys(DEFAULT_GLOBAL_CONFIG)) {
        if (Object.prototype.hasOwnProperty.call(patch ?? {}, key)) {
          setSetting(key, patch[key], now);
        }
      }
      return getGlobalConfig();
    });
  }

  function upsertChat(chat, now = Date.now()) {
    assertDatabaseWritable(db, 'db_read_only');
    const existing = chat?.sessionId ? mapChatRow(selectChatStmt.get(chat.sessionId)) : null;
    const norm = normalizeChatInput(chat, existing, now);
    upsertChatStmt.run(
      norm.sessionId, norm.botId, norm.kind, norm.title, norm.origin,
      norm.externalSource, norm.externalId, JSON.stringify(norm.rest),
      norm.closedAt, norm.seenAt, norm.createdAt, norm.updatedAt,
    );
    return mapChatRow(selectChatStmt.get(norm.sessionId));
  }

  function getChat(sessionId) {
    return mapChatRow(selectChatStmt.get(String(sessionId)));
  }

  function listChats(botId, { includeClosed = true } = {}) {
    const stmt = includeClosed ? selectChatsByBotStmt : selectOpenChatsByBotStmt;
    return stmt.all(String(botId)).map(mapChatRow);
  }

  function findExternalChat(source, externalId) {
    return mapChatRow(selectExternalChatStmt.get(String(source), String(externalId)));
  }

  function markChatSeen(sessionId, seenAt = Date.now()) {
    assertDatabaseWritable(db, 'db_read_only');
    const info = markChatSeenStmt.run(seenAt, seenAt, String(sessionId));
    return Number(info.changes ?? 0) > 0;
  }

  function closeChat(sessionId, closedAt = Date.now()) {
    assertDatabaseWritable(db, 'db_read_only');
    const info = closeChatStmt.run(closedAt, closedAt, String(sessionId));
    return Number(info.changes ?? 0) > 0;
  }

  function deleteChat(sessionId) {
    assertDatabaseWritable(db, 'db_read_only');
    const info = deleteChatStmt.run(String(sessionId));
    return Number(info.changes ?? 0) > 0;
  }

  return {
    get isReadOnly() { return isDatabaseReadOnly(db); },
    getBot,
    getBotByFolder,
    getBotByName,
    listBots,
    insertBot,
    updateBot,
    deleteBot,
    getSetting,
    setSetting,
    deleteSetting,
    getAllSettings,
    getGlobalConfig,
    updateGlobalConfig,
    upsertChat,
    getChat,
    listChats,
    findExternalChat,
    markChatSeen,
    closeChat,
    deleteChat,
  };
}
