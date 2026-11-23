/**
 * SQLite schema DDL (v1 baseline + v2 Organic extensions) for WhaleIsle Bots.
 */

export const SCHEMA_V1_SQL = `
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

export const SCHEMA_V2_SQL = `
CREATE TABLE IF NOT EXISTS automation_claims (
  claim_id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  slot_at INTEGER NOT NULL,
  trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('schedule','manual','webhook','folder')),
  status TEXT NOT NULL CHECK(status IN ('claimed','running','completed','failed','interrupted','skipped_budget')),
  coalesced_count INTEGER NOT NULL DEFAULT 1,
  run_id TEXT,
  session_id TEXT,
  error TEXT,
  claimed_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(automation_id, slot_at)
);
CREATE INDEX IF NOT EXISTS idx_automation_claims_status ON automation_claims(status, claimed_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  signature_ts INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','dispatched','failed','rejected')),
  automation_id TEXT,
  payload_sha256 TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE(webhook_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON webhook_events(received_at);

CREATE TABLE IF NOT EXISTS memory_index_meta (
  entry_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('bot','team','project')),
  scope_id TEXT NOT NULL,
  bot_id TEXT,
  source_file TEXT NOT NULL,
  line_hash TEXT NOT NULL,
  fact_date TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_meta_scope ON memory_index_meta(scope, scope_id, updated_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  entry_id UNINDEXED,
  scope UNINDEXED,
  scope_id UNINDEXED,
  bot_id UNINDEXED,
  source_file UNINDEXED,
  fact_date UNINDEXED,
  body,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS tool_wal (
  wal_id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  action TEXT NOT NULL,
  idempotency_key TEXT,
  effect TEXT NOT NULL,
  args_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('intent','committed','failed','unknown')),
  result_summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_wal_idem
  ON tool_wal(bot_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tool_wal_status ON tool_wal(status, updated_at);

CREATE TABLE IF NOT EXISTS bot_budgets (
  bot_id TEXT PRIMARY KEY,
  daily_limit_usd REAL,
  daily_limit_tokens INTEGER,
  off_peak_only INTEGER NOT NULL DEFAULT 0,
  pause_on_exceed INTEGER NOT NULL DEFAULT 1,
  alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_usage_daily (
  day_utc TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  peak_cost_usd REAL NOT NULL DEFAULT 0,
  off_peak_cost_usd REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(day_utc, bot_id, source_kind)
);

CREATE TABLE IF NOT EXISTS crew_adoptions (
  session_id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  workspace_id TEXT,
  cwd TEXT,
  title TEXT,
  role TEXT NOT NULL DEFAULT 'crew',
  status TEXT NOT NULL CHECK(status IN ('active','released')) DEFAULT 'active',
  adopted_at INTEGER NOT NULL,
  released_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_crew_adoptions_bot ON crew_adoptions(bot_id, status);
`;
