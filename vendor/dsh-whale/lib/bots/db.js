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

export const BOTS_SCHEMA_VERSION = 1;

const DEFAULT_GLOBAL_CONFIG = Object.freeze({
  botsEnabled: true,
  hideBotCreatedWorkspaces: true,
  botSidebarView: null,
  petBotId: null,
});

const txDepthMap = new WeakMap();

/** @param {string} dshHome */
export function botsDbPath(dshHome) {
  if (!dshHome) throw new Error('dshHome is required to resolve bots.db path');
  return path.join(dshHome, 'data', 'bots', 'bots.db');
}

const SCHEMA_V1_SQL = `
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  folder TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  record TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bots_name_nocase ON bots(lower(name));

CREATE TABLE IF NOT EXISTS bot_global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_chats (
  session_id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'side',
  title TEXT,
  origin TEXT NOT NULL DEFAULT 'side',
  external_source TEXT,
  external_id TEXT,
  record TEXT NOT NULL DEFAULT '{}',
  closed_at INTEGER,
  seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_chats_bot ON bot_chats(bot_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_chats_external
  ON bot_chats(external_source, external_id) WHERE external_source IS NOT NULL;

CREATE TABLE IF NOT EXISTS bot_items (
  uid TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  owner_bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  source TEXT NOT NULL,
  made_by TEXT,
  title TEXT NOT NULL,
  description TEXT,
  done_means TEXT,
  status TEXT NOT NULL CHECK(status IN ('planned', 'working', 'needs_you', 'done', 'canceled')),
  question_event INTEGER,
  close_note TEXT,
  version INTEGER NOT NULL,
  last_event_id INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  others_last_event_id INTEGER NOT NULL DEFAULT 0,
  snoozed_until INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bot_items_owner_open
  ON bot_items(owner_bot_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_items_needs_you
  ON bot_items(owner_bot_id, last_activity_at, snoozed_until) WHERE status = 'needs_you';

CREATE TABLE IF NOT EXISTS bot_item_links (
  item_uid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('dispatch', 'pr', 'url', 'file')),
  ref TEXT NOT NULL,
  added_event INTEGER NOT NULL,
  PRIMARY KEY (item_uid, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_bot_item_links_ref ON bot_item_links(kind, ref);

CREATE TABLE IF NOT EXISTS bot_item_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  data TEXT NOT NULL,
  mail TEXT CHECK(mail IN ('owed', 'sent')),
  action INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_item_events_mail_owed
  ON bot_item_events(action) WHERE mail = 'owed';
CREATE INDEX IF NOT EXISTS idx_bot_item_events_item ON bot_item_events(item_uid, id);

CREATE TABLE IF NOT EXISTS bot_groups (
  id TEXT PRIMARY KEY,
  record TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_group_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  group_id TEXT NOT NULL,
  record TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_group_messages_room
  ON bot_group_messages(group_id, sequence);
CREATE INDEX IF NOT EXISTS idx_bot_group_messages_thread
  ON bot_group_messages(group_id, coalesce(json_extract(record, '$.threadId'), ''), sequence);

CREATE TABLE IF NOT EXISTS bot_group_operations (
  operation_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_group_pending (
  operation_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  context TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_group_pending_group ON bot_group_pending(group_id);

CREATE TABLE IF NOT EXISTS bot_group_worker_operations (
  dispatch_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_group_worker_operation
  ON bot_group_worker_operations(operation_id);

CREATE TABLE IF NOT EXISTS bot_group_sidebar (
  group_id TEXT PRIMARY KEY,
  sidebar_order INTEGER,
  latest TEXT
);

CREATE TABLE IF NOT EXISTS bot_requests (
  message_id TEXT PRIMARY KEY,
  root_key TEXT NOT NULL,
  from_bot_id TEXT,
  to_bot_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('status', 'handoff', 'question')),
  depth INTEGER NOT NULL,
  record TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  send_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_bot_requests_root ON bot_requests(root_key);
CREATE INDEX IF NOT EXISTS idx_bot_requests_to ON bot_requests(to_bot_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_requests_send_key
  ON bot_requests(send_key) WHERE send_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS bot_conversation_acts_for (
  session_id TEXT PRIMARY KEY,
  acts_for TEXT NOT NULL,
  triggered_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_run_resends (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_request_outcomes (
  message_id TEXT PRIMARY KEY,
  outcome TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_work (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  dispatch_id TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT 'local',
  asked_in_app INTEGER NOT NULL DEFAULT 0,
  current INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  close_reason TEXT,
  UNIQUE (bot_id, source, external_id, generation)
);
CREATE UNIQUE INDEX IF NOT EXISTS bot_work_current_address
  ON bot_work(bot_id, source, external_id) WHERE closed_at IS NULL AND current = 1;
CREATE INDEX IF NOT EXISTS idx_bot_work_dispatch ON bot_work(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_bot_work_bot ON bot_work(bot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bot_automations (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  record TEXT NOT NULL,
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_automations_bot ON bot_automations(bot_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bot_access_requests (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  bot_id TEXT NOT NULL,
  source TEXT NOT NULL,
  workspace_id TEXT,
  requester_id TEXT NOT NULL,
  requester_name TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'granted', 'declined', 'expired')),
  payload TEXT NOT NULL DEFAULT '{}',
  decided_by TEXT,
  decided_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_access_bot ON bot_access_requests(bot_id, status, created_at DESC);
`;

const MIGRATIONS = [
  { version: 1, sql: SCHEMA_V1_SQL },
];

/**
 * Run `fn` inside an atomic transaction (supports nested calls via savepoints).
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function withTransaction(db, fn) {
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
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

/**
 * Open and migrate the bots SQLite database.
 * @param {string | { dbPath?: string, dshHome?: string }} pathOrOptions
 * @returns {{ db: DatabaseSync, dbPath: string, bots: ReturnType<typeof createBotsStore>, transaction: <T>(fn: () => T) => T, close: () => void }}
 */
export function openBotsDatabase(pathOrOptions) {
  const targetPath = typeof pathOrOptions === 'string'
    ? pathOrOptions
    : (pathOrOptions?.dbPath || botsDbPath(pathOrOptions?.dshHome ?? ''));
  if (!targetPath) throw new Error('openBotsDatabase requires a dbPath or dshHome');
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }
  const db = new DatabaseSync(targetPath);
  if (targetPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);

  const bots = createBotsStore(db);
  return {
    db,
    dbPath: targetPath,
    bots,
    transaction(fn) {
      return withTransaction(db, fn);
    },
    close() {
      txDepthMap.delete(db);
      db.close();
    },
  };
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
    const info = deleteBotStmt.run(String(id));
    return Number(info.changes ?? 0) > 0;
  }

  function getSetting(key, fallback = undefined) {
    const row = selectSettingStmt.get(String(key));
    return row ? parseJson(row.value, fallback) : fallback;
  }

  function setSetting(key, value, now = Date.now()) {
    upsertSettingStmt.run(String(key), JSON.stringify(value), now);
    return value;
  }

  function deleteSetting(key) {
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
    const info = markChatSeenStmt.run(seenAt, seenAt, String(sessionId));
    return Number(info.changes ?? 0) > 0;
  }

  function closeChat(sessionId, closedAt = Date.now()) {
    const info = closeChatStmt.run(closedAt, closedAt, String(sessionId));
    return Number(info.changes ?? 0) > 0;
  }

  function deleteChat(sessionId) {
    const info = deleteChatStmt.run(String(sessionId));
    return Number(info.changes ?? 0) > 0;
  }

  return {
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
