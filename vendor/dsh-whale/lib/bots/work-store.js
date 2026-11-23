/**
 * Orchestration, Worker binding, Automations, Claims, Webhooks, WAL, Budgets,
 * Crew Adoptions, and Access Requests SQLite store (`bots.db`).
 */
import crypto from 'node:crypto';
import { withTransaction } from './db.js';

export const WORK_CLOSE_REASONS = Object.freeze([
  'task_gone', 'workspace_gone', 'thread_gone', 'owner_reset',
  'superseded', 'bot_gone', 'start_failed',
]);
export const REQUEST_PURPOSES = Object.freeze(['status', 'handoff', 'question']);
export const DEFAULT_MAX_REQUEST_DEPTH = 6;
export const ACCESS_DECISIONS = Object.freeze(['granted', 'declined']);
export const CLAIM_TRIGGER_KINDS = Object.freeze(['schedule', 'manual', 'webhook', 'folder']);
export const CLAIM_STATUSES = Object.freeze([
  'claimed', 'running', 'completed', 'failed', 'interrupted', 'skipped_budget',
]);
export const WEBHOOK_EVENT_STATUSES = Object.freeze(['accepted', 'dispatched', 'failed', 'rejected']);
export const TOOL_WAL_STATUSES = Object.freeze(['intent', 'committed', 'failed', 'unknown']);
export const CREW_ADOPTION_STATUSES = Object.freeze(['active', 'released']);

const TERMINAL_CLAIM_STATUSES = new Set(['completed', 'failed', 'interrupted', 'skipped_budget']);

export class BotWorkError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, any>} [data] */
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'BotWorkError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** @param {unknown} value */
const trimStr = (value) => (typeof value === 'string' ? value.trim() : '');
/** @param {unknown} value @param {number} [fallback] */
const numOr = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
/** @param {unknown} value */
const nullableNum = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
/** @param {unknown} value @param {number} def @param {number} [max] */
const clampLimit = (value, def, max = 500) => Math.min(Math.max(1, Number(value) || def), max);

/**
 * Build a parameterized WHERE clause from `[sqlExpr, paramOrUndefined]` pairs.
 * @param {Array<[string, any]>} filters
 */
function buildWhere(filters) {
  const clauses = [];
  const params = [];
  for (const [clause, val] of filters) {
    if (val === null || val === undefined || val === false) continue;
    clauses.push(clause);
    if (val !== true) params.push(val);
  }
  return { whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * Normalize access decisions, mapping legacy `'denied'` -> `'declined'`.
 * @param {unknown} decision
 */
export function normalizeAccessDecision(decision) {
  const raw = trimStr(decision).toLowerCase();
  return raw === 'denied' ? 'declined' : raw;
}

/** @param {any} row */
const mapWorkRow = (row) => (row ? {
  id: row.id, botId: row.bot_id, source: row.source, externalId: row.external_id,
  generation: row.generation, taskId: row.task_id, dispatchId: row.dispatch_id,
  host: row.host, askedInApp: Boolean(row.asked_in_app), current: Boolean(row.current),
  createdAt: row.created_at, closedAt: row.closed_at ?? null, closeReason: row.close_reason ?? null,
} : null);

/** @param {any} row */
const mapRequestRow = (row) => (row ? {
  messageId: row.message_id, rootKey: row.root_key, fromBotId: row.from_bot_id ?? null,
  toBotId: row.to_bot_id, purpose: row.purpose, depth: row.depth,
  record: JSON.parse(row.record), createdAt: row.created_at, sendKey: row.send_key ?? null,
} : null);

/** @param {any} row */
const mapAutomationRow = (row) => (row ? {
  ...JSON.parse(row.record), id: row.id, botId: row.bot_id, enabled: Boolean(row.enabled),
  nextRunAt: row.next_run_at ?? null, lastRunAt: row.last_run_at ?? null,
  lastStatus: row.last_status ?? null, lastError: row.last_error ?? null,
  createdAt: row.created_at, updatedAt: row.updated_at,
} : null);

/** @param {any} row */
const mapAccessRow = (row) => (row ? {
  id: row.id, token: row.token, botId: row.bot_id, source: row.source,
  workspaceId: row.workspace_id ?? null, requesterId: row.requester_id,
  requesterName: row.requester_name ?? null, status: row.status, payload: JSON.parse(row.payload),
  decidedBy: row.decided_by ?? null, decidedAt: row.decided_at ?? null,
  expiresAt: row.expires_at ?? null, createdAt: row.created_at,
} : null);

/** @param {any} row */
const mapClaimRow = (row) => (row ? {
  claimId: row.claim_id, automationId: row.automation_id, botId: row.bot_id,
  slotAt: row.slot_at, triggerKind: row.trigger_kind, status: row.status,
  coalescedCount: row.coalesced_count, runId: row.run_id ?? null,
  sessionId: row.session_id ?? null, error: row.error ?? null,
  claimedAt: row.claimed_at, finishedAt: row.finished_at ?? null,
} : null);

/** @param {any} row */
const mapWebhookEventRow = (row) => (row ? {
  id: row.id, botId: row.bot_id, webhookId: row.webhook_id, eventId: row.event_id,
  signatureTs: row.signature_ts, status: row.status, automationId: row.automation_id ?? null,
  payloadSha256: row.payload_sha256, receivedAt: row.received_at,
} : null);

/** @param {any} row */
const mapToolWalRow = (row) => (row ? {
  walId: row.wal_id, botId: row.bot_id, sessionId: row.session_id,
  toolName: row.tool_name, action: row.action, idempotencyKey: row.idempotency_key ?? null,
  effect: row.effect, argsDigest: row.args_digest, status: row.status,
  resultSummary: row.result_summary ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
} : null);

/** @param {any} row */
const mapBudgetRow = (row) => (row ? {
  botId: row.bot_id, dailyLimitUsd: row.daily_limit_usd ?? null,
  dailyLimitTokens: row.daily_limit_tokens ?? null, offPeakOnly: Boolean(row.off_peak_only),
  pauseOnExceed: Boolean(row.pause_on_exceed), alertThresholdPct: row.alert_threshold_pct,
  updatedAt: row.updated_at,
} : null);

/** @param {any} row */
const mapUsageDailyRow = (row) => (row ? {
  dayUtc: row.day_utc, botId: row.bot_id, sourceKind: row.source_kind,
  inputTokens: row.input_tokens, cacheReadTokens: row.cache_read_tokens,
  cacheWriteTokens: row.cache_write_tokens, outputTokens: row.output_tokens,
  costUsd: row.cost_usd, peakCostUsd: row.peak_cost_usd,
  offPeakCostUsd: row.off_peak_cost_usd, updatedAt: row.updated_at,
} : null);

/** @param {any} row */
const mapCrewAdoptionRow = (row) => (row ? {
  sessionId: row.session_id, botId: row.bot_id, workspaceId: row.workspace_id ?? null,
  cwd: row.cwd ?? null, title: row.title ?? null, role: row.role,
  status: row.status, adoptedAt: row.adopted_at, releasedAt: row.released_at ?? null,
} : null);

/** @param {string} reason */
function validateCloseReason(reason) {
  if (!WORK_CLOSE_REASONS.includes(reason)) {
    throw new BotWorkError('invalid_argument', `Invalid close_reason: ${String(reason)}`);
  }
  return reason;
}

/**
 * Detect whether adding edge `fromBotId -> toBotId` creates a cycle in `edges`.
 * @param {Array<{ from_bot_id: string | null, to_bot_id: string }>} edges
 * @param {string | null} fromBotId
 * @param {string} toBotId
 */
function wouldCreateCycle(edges, fromBotId, toBotId) {
  if (!fromBotId) return false;
  if (fromBotId === toBotId) return true;
  /** @type {Map<string, string[]>} */
  const adj = new Map();
  for (const edge of edges) {
    if (!edge.from_bot_id) continue;
    const list = adj.get(edge.from_bot_id) ?? [];
    list.push(edge.to_bot_id);
    adj.set(edge.from_bot_id, list);
  }
  const visited = new Set([toBotId]);
  const queue = [toBotId];
  while (queue.length > 0) {
    const node = queue.shift();
    for (const next of adj.get(node) ?? []) {
      if (next === fromBotId) return true;
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return false;
}

/** @param {any} input */
function parseStartWorkInput(input) {
  const fields = {
    botId: trimStr(input?.botId), source: trimStr(input?.source),
    externalId: trimStr(input?.externalId), taskId: trimStr(input?.taskId), dispatchId: trimStr(input?.dispatchId),
  };
  if (Object.values(fields).some((v) => !v)) {
    throw new BotWorkError('invalid_argument', 'botId, source, externalId, taskId, and dispatchId are required');
  }
  return { ...fields, id: trimStr(input?.id) || crypto.randomUUID(), host: trimStr(input?.host) || 'local', askedInApp: input?.askedInApp ? 1 : 0 };
}

/** @param {any} input */
function parseRequestInput(input) {
  const raw = input ?? {};
  const rootKey = trimStr(raw.rootKey);
  const toBotId = trimStr(raw.toBotId);
  const purpose = trimStr(raw.purpose);
  if (!rootKey || !toBotId || !REQUEST_PURPOSES.includes(purpose)) {
    throw new BotWorkError('invalid_argument', 'rootKey, toBotId, and valid purpose (status|handoff|question) are required');
  }
  const depth = Number(raw.depth ?? 0);
  if (!Number.isInteger(depth) || depth < 0) {
    throw new BotWorkError('invalid_argument', 'depth must be a non-negative integer');
  }
  return {
    rootKey, toBotId, fromBotId: trimStr(raw.fromBotId) || null, purpose, depth,
    maxDepth: Number.isInteger(raw.maxDepth) ? raw.maxDepth : DEFAULT_MAX_REQUEST_DEPTH,
    sendKey: trimStr(raw.sendKey) || null, messageId: trimStr(raw.messageId) || crypto.randomUUID(), record: raw.record ?? {},
  };
}

/** @param {any} input @param {any} existing @param {number} now */
function normalizeAutomationInput(input, existing, now) {
  const rest = { ...input };
  for (const key of ['id', 'botId', 'enabled', 'nextRunAt', 'lastRunAt', 'lastStatus', 'lastError', 'createdAt', 'updatedAt']) {
    delete rest[key];
  }
  const enabledFlag = input.enabled !== undefined ? Boolean(input.enabled) : (existing?.enabled !== false);
  return {
    botId: String(input.botId), enabled: enabledFlag ? 1 : 0,
    nextRunAt: input.nextRunAt ?? existing?.nextRunAt ?? null, lastRunAt: input.lastRunAt ?? existing?.lastRunAt ?? null,
    lastStatus: input.lastStatus ?? existing?.lastStatus ?? null, lastError: input.lastError ?? existing?.lastError ?? null,
    createdAt: existing?.createdAt ?? (Number.isFinite(input.createdAt) ? input.createdAt : now), rest,
  };
}

/** @param {any} input */
function parseAccessRequestInput(input) {
  const botId = trimStr(input?.botId);
  const source = trimStr(input?.source);
  const requesterId = trimStr(input?.requesterId);
  if (!botId || !source || !requesterId) {
    throw new BotWorkError('invalid_argument', 'botId, source, and requesterId are required');
  }
  return {
    id: trimStr(input?.id) || crypto.randomUUID(), token: trimStr(input?.token) || crypto.randomBytes(24).toString('hex'),
    botId, source, workspaceId: trimStr(input?.workspaceId) || null, requesterId,
    requesterName: trimStr(input?.requesterName) || null,
    expiresAt: Number.isFinite(input?.expiresAt) ? input.expiresAt : null, payload: input?.payload ?? {},
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createClaimsAccess(db) {
  const byId = db.prepare('SELECT * FROM automation_claims WHERE claim_id = ?');
  const bySlot = db.prepare('SELECT * FROM automation_claims WHERE automation_id = ? AND slot_at = ?');

  function claimAutomationSlot(/** @type {any} */ input, now = Date.now()) {
    const automationId = trimStr(input?.automationId);
    const botId = trimStr(input?.botId);
    const slotAt = Number(input?.slotAt);
    const triggerKind = trimStr(input?.triggerKind || 'schedule');
    if (!automationId || !botId || !Number.isFinite(slotAt) || !CLAIM_TRIGGER_KINDS.includes(triggerKind)) {
      throw new BotWorkError('invalid_argument', 'automationId, botId, finite slotAt, and valid triggerKind are required');
    }
    const claimId = trimStr(input?.claimId) || crypto.randomUUID();
    const coalesced = Math.max(1, Math.floor(numOr(input?.coalescedCount, 1)));
    return withTransaction(db, () => {
      const existing = bySlot.get(automationId, Math.trunc(slotAt));
      if (existing) return { claimed: false, claim: mapClaimRow(existing) };
      db.prepare(
        `INSERT INTO automation_claims (claim_id, automation_id, bot_id, slot_at, trigger_kind, status, coalesced_count, run_id, session_id, error, claimed_at, finished_at)
         VALUES (?, ?, ?, ?, ?, 'claimed', ?, ?, ?, NULL, ?, NULL)`,
      ).run(claimId, automationId, botId, Math.trunc(slotAt), triggerKind, coalesced,
        trimStr(input?.runId) || null, trimStr(input?.sessionId) || null, now);
      return { claimed: true, claim: mapClaimRow(byId.get(claimId)) };
    });
  }

  function updateAutomationClaim(/** @type {any} */ claimId, patch = /** @type {any} */ ({}), now = Date.now()) {
    const cur = mapClaimRow(byId.get(String(claimId)));
    if (!cur) return null;
    const status = patch.status !== undefined ? trimStr(patch.status) : cur.status;
    if (!CLAIM_STATUSES.includes(status)) throw new BotWorkError('invalid_argument', `Invalid claim status: ${String(patch.status)}`);
    const finishedAt = patch.finishedAt !== undefined
      ? patch.finishedAt
      : (TERMINAL_CLAIM_STATUSES.has(status) ? (cur.finishedAt ?? now) : cur.finishedAt);
    db.prepare(
      'UPDATE automation_claims SET status = ?, coalesced_count = ?, run_id = ?, session_id = ?, error = ?, finished_at = ? WHERE claim_id = ?',
    ).run(
      status, Math.max(1, Math.floor(numOr(patch.coalescedCount, cur.coalescedCount))),
      patch.runId !== undefined ? (trimStr(patch.runId) || null) : cur.runId,
      patch.sessionId !== undefined ? (trimStr(patch.sessionId) || null) : cur.sessionId,
      patch.error !== undefined ? (patch.error === null ? null : String(patch.error)) : cur.error,
      finishedAt, cur.claimId,
    );
    return mapClaimRow(byId.get(cur.claimId));
  }

  function listAutomationClaims({ automationId = null, botId = null, status = null, limit = 100 } = {}) {
    const { whereSql, params } = buildWhere([
      ['automation_id = ?', automationId ? String(automationId) : null],
      ['bot_id = ?', botId ? String(botId) : null],
      ['status = ?', status ? String(status) : null],
    ]);
    return db.prepare(`SELECT * FROM automation_claims ${whereSql} ORDER BY claimed_at DESC LIMIT ?`)
      .all(...params, clampLimit(limit, 100)).map(mapClaimRow);
  }

  function markInterruptedAutomationClaims(now = Date.now()) {
    return withTransaction(db, () => {
      const claimIds = db.prepare("SELECT claim_id FROM automation_claims WHERE status IN ('claimed','running')")
        .all().map((r) => String(r.claim_id));
      if (claimIds.length > 0) {
        db.prepare(
          "UPDATE automation_claims SET status = 'interrupted', error = coalesce(error, 'process_restarted'), finished_at = coalesce(finished_at, ?) WHERE status IN ('claimed','running')",
        ).run(now);
      }
      return { count: claimIds.length, claimIds };
    });
  }

  return {
    claimAutomationSlot,
    getAutomationClaim: (/** @type {any} */ claimId) => mapClaimRow(byId.get(String(claimId))),
    updateAutomationClaim, listAutomationClaims, markInterruptedAutomationClaims,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createWebhookEventsAccess(db) {
  const byId = db.prepare('SELECT * FROM webhook_events WHERE id = ?');
  const byPair = db.prepare('SELECT * FROM webhook_events WHERE webhook_id = ? AND event_id = ?');

  function recordWebhookEvent(/** @type {any} */ input, now = Date.now()) {
    const botId = trimStr(input?.botId);
    const webhookId = trimStr(input?.webhookId);
    const eventId = trimStr(input?.eventId);
    const payloadSha256 = trimStr(input?.payloadSha256);
    const status = trimStr(input?.status || 'accepted');
    const signatureTs = Number(input?.signatureTs);
    if (!botId || !webhookId || !eventId || !payloadSha256 || !Number.isFinite(signatureTs) || !WEBHOOK_EVENT_STATUSES.includes(status)) {
      throw new BotWorkError('invalid_argument', 'Invalid webhook_events record input');
    }
    const id = trimStr(input?.id) || crypto.randomUUID();
    return withTransaction(db, () => {
      const existing = byPair.get(webhookId, eventId);
      if (existing) return { duplicate: true, event: mapWebhookEventRow(existing) };
      db.prepare(
        'INSERT INTO webhook_events (id, bot_id, webhook_id, event_id, signature_ts, status, automation_id, payload_sha256, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, botId, webhookId, eventId, Math.trunc(signatureTs), status, trimStr(input?.automationId) || null, payloadSha256, now);
      return { duplicate: false, event: mapWebhookEventRow(byId.get(id)) };
    });
  }

  function updateWebhookEventStatus(/** @type {any} */ id, /** @type {any} */ status, /** @type {{ automationId?: any }} */ { automationId } = {}) {
    const cleanStatus = trimStr(status);
    if (!WEBHOOK_EVENT_STATUSES.includes(cleanStatus)) {
      throw new BotWorkError('invalid_argument', `Invalid webhook event status: ${String(status)}`);
    }
    const info = automationId !== undefined
      ? db.prepare('UPDATE webhook_events SET status = ?, automation_id = ? WHERE id = ?').run(cleanStatus, trimStr(automationId) || null, String(id))
      : db.prepare('UPDATE webhook_events SET status = ? WHERE id = ?').run(cleanStatus, String(id));
    return Number(info.changes ?? 0) === 0 ? null : mapWebhookEventRow(byId.get(String(id)));
  }

  function listWebhookEvents({ botId = null, webhookId = null, limit = 100 } = {}) {
    const { whereSql, params } = buildWhere([
      ['bot_id = ?', botId ? String(botId) : null],
      ['webhook_id = ?', webhookId ? String(webhookId) : null],
    ]);
    return db.prepare(`SELECT * FROM webhook_events ${whereSql} ORDER BY received_at DESC LIMIT ?`)
      .all(...params, clampLimit(limit, 100)).map(mapWebhookEventRow);
  }

  function pruneWebhookEvents(olderThanMs = 86_400_000, now = Date.now()) {
    const cutoff = now - Math.max(0, numOr(olderThanMs, 86_400_000));
    return Number(db.prepare('DELETE FROM webhook_events WHERE received_at < ?').run(cutoff).changes ?? 0);
  }

  return {
    recordWebhookEvent, getWebhookEvent: (/** @type {any} */ id) => mapWebhookEventRow(byId.get(String(id))),
    updateWebhookEventStatus, listWebhookEvents, pruneWebhookEvents,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createToolWalAccess(db) {
  const byId = db.prepare('SELECT * FROM tool_wal WHERE wal_id = ?');
  const byIdem = db.prepare('SELECT * FROM tool_wal WHERE bot_id = ? AND idempotency_key = ?');

  function appendToolWalIntent(/** @type {any} */ input, now = Date.now()) {
    const botId = trimStr(input?.botId);
    const sessionId = trimStr(input?.sessionId);
    const toolName = trimStr(input?.toolName);
    const action = trimStr(input?.action);
    const effect = trimStr(input?.effect);
    const argsDigest = trimStr(input?.argsDigest);
    if (!botId || !sessionId || !toolName || !action || !effect || !argsDigest) {
      throw new BotWorkError('invalid_argument', 'botId, sessionId, toolName, action, effect, and argsDigest are required');
    }
    const walId = trimStr(input?.walId) || crypto.randomUUID();
    const idempotencyKey = trimStr(input?.idempotencyKey) || null;
    return withTransaction(db, () => {
      if (idempotencyKey) {
        const existing = byIdem.get(botId, idempotencyKey);
        if (existing) return { deduplicated: true, entry: mapToolWalRow(existing) };
      }
      db.prepare(
        `INSERT INTO tool_wal (wal_id, bot_id, session_id, tool_name, action, idempotency_key, effect, args_digest, status, result_summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'intent', NULL, ?, ?)`,
      ).run(walId, botId, sessionId, toolName, action, idempotencyKey, effect, argsDigest, now, now);
      return { deduplicated: false, entry: mapToolWalRow(byId.get(walId)) };
    });
  }

  function resolveToolWal(/** @type {any} */ walId, /** @type {{ status: any, resultSummary?: any }} */ { status, resultSummary = null }, now = Date.now()) {
    const cleanStatus = trimStr(status);
    if (!TOOL_WAL_STATUSES.includes(cleanStatus) || cleanStatus === 'intent') {
      throw new BotWorkError('invalid_argument', 'tool_wal resolve status must be committed, failed, or unknown');
    }
    const info = db.prepare('UPDATE tool_wal SET status = ?, result_summary = ?, updated_at = ? WHERE wal_id = ?')
      .run(cleanStatus, resultSummary === null ? null : String(resultSummary), now, String(walId));
    return Number(info.changes ?? 0) === 0 ? null : mapToolWalRow(byId.get(String(walId)));
  }

  function listToolWal({ botId = null, sessionId = null, status = null, limit = 100 } = {}) {
    const { whereSql, params } = buildWhere([
      ['bot_id = ?', botId ? String(botId) : null],
      ['session_id = ?', sessionId ? String(sessionId) : null],
      ['status = ?', status ? String(status) : null],
    ]);
    return db.prepare(`SELECT * FROM tool_wal ${whereSql} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params, clampLimit(limit, 100)).map(mapToolWalRow);
  }

  function markStaleToolWalUnknown(now = Date.now()) {
    return withTransaction(db, () => {
      const walIds = db.prepare("SELECT wal_id FROM tool_wal WHERE status = 'intent'").all().map((r) => String(r.wal_id));
      if (walIds.length > 0) db.prepare("UPDATE tool_wal SET status = 'unknown', updated_at = ? WHERE status = 'intent'").run(now);
      return { count: walIds.length, walIds };
    });
  }

  return {
    appendToolWalIntent, resolveToolWal,
    getToolWal: (/** @type {any} */ walId) => mapToolWalRow(byId.get(String(walId))),
    getToolWalByIdempotencyKey: (/** @type {any} */ botId, /** @type {any} */ key) => mapToolWalRow(byIdem.get(String(botId), String(key))),
    listToolWal, markStaleToolWalUnknown,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createBudgetAccess(db) {
  const selectBudget = db.prepare('SELECT * FROM bot_budgets WHERE bot_id = ?');
  const selectUsage = db.prepare('SELECT * FROM bot_usage_daily WHERE day_utc = ? AND bot_id = ? AND source_kind = ?');

  function setBotBudget(/** @type {any} */ botId, patch = /** @type {any} */ ({}), now = Date.now()) {
    const id = trimStr(botId);
    if (!id) throw new BotWorkError('invalid_argument', 'botId is required');
    const cur = mapBudgetRow(selectBudget.get(id));
    const usd = patch.dailyLimitUsd !== undefined ? nullableNum(patch.dailyLimitUsd) : (cur?.dailyLimitUsd ?? null);
    const tokRaw = patch.dailyLimitTokens !== undefined ? nullableNum(patch.dailyLimitTokens) : (cur?.dailyLimitTokens ?? null);
    const tokens = tokRaw === null ? null : Math.max(0, Math.trunc(tokRaw));
    const offPeakOnly = (patch.offPeakOnly !== undefined ? Boolean(patch.offPeakOnly) : Boolean(cur?.offPeakOnly)) ? 1 : 0;
    const pauseOnExceed = (patch.pauseOnExceed !== undefined ? Boolean(patch.pauseOnExceed) : (cur?.pauseOnExceed !== false)) ? 1 : 0;
    const alertPct = Math.min(100, Math.max(1, Math.trunc(numOr(patch.alertThresholdPct, cur?.alertThresholdPct ?? 80))));
    db.prepare(
      `INSERT INTO bot_budgets (bot_id, daily_limit_usd, daily_limit_tokens, off_peak_only, pause_on_exceed, alert_threshold_pct, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(bot_id) DO UPDATE SET daily_limit_usd = excluded.daily_limit_usd, daily_limit_tokens = excluded.daily_limit_tokens,
         off_peak_only = excluded.off_peak_only, pause_on_exceed = excluded.pause_on_exceed, alert_threshold_pct = excluded.alert_threshold_pct, updated_at = excluded.updated_at`,
    ).run(id, usd, tokens, offPeakOnly, pauseOnExceed, alertPct, now);
    return mapBudgetRow(selectBudget.get(id));
  }

  function upsertBotUsageDaily(/** @type {any} */ input, now = Date.now()) {
    const dayUtc = trimStr(input?.dayUtc);
    const botId = trimStr(input?.botId);
    const sourceKind = trimStr(input?.sourceKind || 'bot_chats');
    if (!dayUtc || !botId || !sourceKind) throw new BotWorkError('invalid_argument', 'dayUtc, botId, and sourceKind are required');
    const add = input?.mode === 'add';
    const cols = ['input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens', 'cost_usd', 'peak_cost_usd', 'off_peak_cost_usd'];
    const setSql = `${cols.map((c) => `${c} = ${add ? `${c} + ` : ''}excluded.${c}`).join(', ')}, updated_at = excluded.updated_at`;
    db.prepare(
      `INSERT INTO bot_usage_daily (day_utc, bot_id, source_kind, ${cols.join(', ')}, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(day_utc, bot_id, source_kind) DO UPDATE SET ${setSql}`,
    ).run(
      dayUtc, botId, sourceKind,
      Math.max(0, Math.trunc(numOr(input.inputTokens))), Math.max(0, Math.trunc(numOr(input.cacheReadTokens))),
      Math.max(0, Math.trunc(numOr(input.cacheWriteTokens))), Math.max(0, Math.trunc(numOr(input.outputTokens))),
      Math.max(0, numOr(input.costUsd)), Math.max(0, numOr(input.peakCostUsd)), Math.max(0, numOr(input.offPeakCostUsd)), now,
    );
    return mapUsageDailyRow(selectUsage.get(dayUtc, botId, sourceKind));
  }

  function listBotUsageDaily({ botId = null, dayUtc = null, fromDayUtc = null, toDayUtc = null } = {}) {
    const { whereSql, params } = buildWhere([
      ['bot_id = ?', botId ? String(botId) : null],
      ['day_utc = ?', dayUtc ? String(dayUtc) : null],
      ['day_utc >= ?', fromDayUtc ? String(fromDayUtc) : null],
      ['day_utc <= ?', toDayUtc ? String(toDayUtc) : null],
    ]);
    return db.prepare(`SELECT * FROM bot_usage_daily ${whereSql} ORDER BY day_utc DESC, bot_id ASC`).all(...params).map(mapUsageDailyRow);
  }

  function sumBotUsageForDay(/** @type {any} */ botId, /** @type {any} */ dayUtc) {
    const row = db.prepare(
      `SELECT coalesce(sum(input_tokens), 0) AS in_tok, coalesce(sum(cache_read_tokens), 0) AS c_read,
              coalesce(sum(cache_write_tokens), 0) AS c_write, coalesce(sum(output_tokens), 0) AS out_tok,
              coalesce(sum(cost_usd), 0) AS cost, coalesce(sum(peak_cost_usd), 0) AS peak,
              coalesce(sum(off_peak_cost_usd), 0) AS off_peak
       FROM bot_usage_daily WHERE bot_id = ? AND day_utc = ?`,
    ).get(String(botId), String(dayUtc));
    const inputTokens = Number(row?.in_tok ?? 0);
    const cacheReadTokens = Number(row?.c_read ?? 0);
    const cacheWriteTokens = Number(row?.c_write ?? 0);
    const outputTokens = Number(row?.out_tok ?? 0);
    return {
      dayUtc: String(dayUtc), botId: String(botId), inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
      totalTokens: inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
      costUsd: Number(row?.cost ?? 0), peakCostUsd: Number(row?.peak ?? 0), offPeakCostUsd: Number(row?.off_peak ?? 0),
    };
  }

  return {
    getBotBudget: (/** @type {any} */ botId) => mapBudgetRow(selectBudget.get(String(botId))),
    setBotBudget,
    deleteBotBudget: (/** @type {any} */ botId) => Number(db.prepare('DELETE FROM bot_budgets WHERE bot_id = ?').run(String(botId)).changes ?? 0) > 0,
    listBotBudgets: () => db.prepare('SELECT * FROM bot_budgets ORDER BY bot_id ASC').all().map(mapBudgetRow),
    upsertBotUsageDaily, listBotUsageDaily, sumBotUsageForDay,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createCrewAdoptionAccess(db) {
  const bySession = db.prepare('SELECT * FROM crew_adoptions WHERE session_id = ?');

  function adoptCrewSession(/** @type {any} */ input, now = Date.now()) {
    const sessionId = trimStr(input?.sessionId);
    const botId = trimStr(input?.botId);
    if (!sessionId || !botId) throw new BotWorkError('invalid_argument', 'sessionId and botId are required');
    db.prepare(
      `INSERT INTO crew_adoptions (session_id, bot_id, workspace_id, cwd, title, role, status, adopted_at, released_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL)
       ON CONFLICT(session_id) DO UPDATE SET bot_id = excluded.bot_id, workspace_id = excluded.workspace_id,
         cwd = excluded.cwd, title = excluded.title, role = excluded.role, status = 'active', adopted_at = excluded.adopted_at, released_at = NULL`,
    ).run(sessionId, botId, trimStr(input?.workspaceId) || null, trimStr(input?.cwd) || null,
      trimStr(input?.title) || null, trimStr(input?.role) || 'crew', now);
    return mapCrewAdoptionRow(bySession.get(sessionId));
  }

  function releaseCrewSession(/** @type {any} */ sessionId, now = Date.now()) {
    const info = db.prepare("UPDATE crew_adoptions SET status = 'released', released_at = ? WHERE session_id = ?").run(now, String(sessionId));
    return Number(info.changes ?? 0) === 0 ? null : mapCrewAdoptionRow(bySession.get(String(sessionId)));
  }

  function listCrewAdoptions({ botId = null, status = 'active' } = {}) {
    const { whereSql, params } = buildWhere([
      ['bot_id = ?', botId ? String(botId) : null],
      ['status = ?', status && status !== 'all' ? String(status) : null],
    ]);
    return db.prepare(`SELECT * FROM crew_adoptions ${whereSql} ORDER BY adopted_at DESC`).all(...params).map(mapCrewAdoptionRow);
  }

  return {
    adoptCrewSession, releaseCrewSession,
    getCrewAdoption: (/** @type {any} */ sessionId) => mapCrewAdoptionRow(bySession.get(String(sessionId))),
    listCrewAdoptions,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createCoreWorkAccess(db) {
  const selectCur = db.prepare('SELECT * FROM bot_work WHERE bot_id = ? AND source = ? AND external_id = ? AND closed_at IS NULL AND current = 1 LIMIT 1');
  const selectMaxGen = db.prepare('SELECT coalesce(max(generation), 0) AS max_gen FROM bot_work WHERE bot_id = ? AND source = ? AND external_id = ?');
  const selectById = db.prepare('SELECT * FROM bot_work WHERE id = ?');
  const selectByDisp = db.prepare('SELECT * FROM bot_work WHERE dispatch_id = ? ORDER BY created_at DESC LIMIT 1');

  function startWork(input, now = Date.now()) {
    const p = parseStartWorkInput(input);
    return withTransaction(db, () => {
      db.prepare("UPDATE bot_work SET current = 0, closed_at = coalesce(closed_at, ?), close_reason = coalesce(close_reason, 'superseded') WHERE bot_id = ? AND source = ? AND external_id = ? AND current = 1")
        .run(now, p.botId, p.source, p.externalId);
      const nextGen = Number(selectMaxGen.get(p.botId, p.source, p.externalId)?.max_gen ?? 0) + 1;
      db.prepare('INSERT INTO bot_work (id, bot_id, source, external_id, generation, task_id, dispatch_id, host, asked_in_app, current, created_at, closed_at, close_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL)')
        .run(p.id, p.botId, p.source, p.externalId, nextGen, p.taskId, p.dispatchId, p.host, p.askedInApp, now);
      return mapWorkRow(selectById.get(p.id));
    });
  }

  function listWork({ botId, source, openOnly = false, limit = 100 } = {}) {
    const { whereSql, params } = buildWhere([
      ['bot_id = ?', botId ? String(botId) : null],
      ['source = ?', source ? String(source) : null],
      ['closed_at IS NULL', openOnly ? true : null],
    ]);
    return db.prepare(`SELECT * FROM bot_work ${whereSql} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, clampLimit(limit, 100)).map(mapWorkRow);
  }

  function forgetWork(botId, source, externalId, { reason = 'owner_reset', now = Date.now() } = {}) {
    const validReason = validateCloseReason(reason);
    return withTransaction(db, () => {
      const current = mapWorkRow(selectCur.get(String(botId), String(source), String(externalId)));
      if (current) db.prepare('UPDATE bot_work SET current = 0, closed_at = ?, close_reason = ? WHERE id = ?').run(now, validReason, current.id);
      const maxGen = Number(selectMaxGen.get(String(botId), String(source), String(externalId))?.max_gen ?? 0);
      return { forgotten: current ? mapWorkRow(selectById.get(current.id)) : null, nextGeneration: maxGen + 1 };
    });
  }

  function closeWork(id, { reason, now = Date.now() }) {
    const validReason = validateCloseReason(reason);
    const info = db.prepare('UPDATE bot_work SET current = 0, closed_at = coalesce(closed_at, ?), close_reason = coalesce(close_reason, ?) WHERE id = ?')
      .run(now, validReason, String(id));
    return Number(info.changes ?? 0) === 0 ? null : mapWorkRow(selectById.get(String(id)));
  }

  return {
    startWork,
    getCurrentWork: (botId, source, externalId) => mapWorkRow(selectCur.get(String(botId), String(source), String(externalId))),
    getWorkById: (id) => mapWorkRow(selectById.get(String(id))),
    getWorkByDispatch: (dispatchId) => mapWorkRow(selectByDisp.get(String(dispatchId))),
    listWork, forgetWork, closeWork,
    closeWorkByDispatch: (dispatchId, { reason, now = Date.now() }) => {
      const validReason = validateCloseReason(reason);
      const row = selectByDisp.get(String(dispatchId));
      return row ? closeWork(row.id, { reason: validReason, now }) : null;
    },
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createRequestsAccess(db) {
  const byId = db.prepare('SELECT * FROM bot_requests WHERE message_id = ?');
  const byKey = db.prepare('SELECT * FROM bot_requests WHERE send_key = ?');
  const edgesByRoot = db.prepare('SELECT from_bot_id, to_bot_id FROM bot_requests WHERE root_key = ?');

  function createRequest(input, now = Date.now()) {
    const p = parseRequestInput(input);
    return withTransaction(db, () => {
      if (p.sendKey) {
        const existing = byKey.get(p.sendKey);
        if (existing) return { request: mapRequestRow(existing), deduplicated: true };
      }
      if (p.depth > p.maxDepth) {
        throw new BotWorkError('depth_exceeded', `Request depth ${p.depth} exceeds max depth ${p.maxDepth}`, { depth: p.depth, maxDepth: p.maxDepth });
      }
      if (wouldCreateCycle(edgesByRoot.all(p.rootKey), p.fromBotId, p.toBotId)) {
        throw new BotWorkError('loop_detected', `Cross-bot request cycle detected: ${p.fromBotId} -> ${p.toBotId}`, {
          rootKey: p.rootKey, fromBotId: p.fromBotId, toBotId: p.toBotId,
        });
      }
      db.prepare('INSERT INTO bot_requests (message_id, root_key, from_bot_id, to_bot_id, purpose, depth, record, created_at, send_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(p.messageId, p.rootKey, p.fromBotId, p.toBotId, p.purpose, p.depth, JSON.stringify(p.record), now, p.sendKey);
      return { request: mapRequestRow(byId.get(p.messageId)), deduplicated: false };
    });
  }

  function getActsFor(sessionId) {
    const row = db.prepare('SELECT * FROM bot_conversation_acts_for WHERE session_id = ?').get(String(sessionId));
    return row ? { sessionId: row.session_id, actsFor: JSON.parse(row.acts_for), triggeredBy: row.triggered_by ? JSON.parse(row.triggered_by) : null, createdAt: row.created_at } : null;
  }

  function setActsFor(sessionId, actsFor, triggeredBy = null, now = Date.now()) {
    if (!sessionId || !Array.isArray(actsFor)) throw new BotWorkError('invalid_argument', 'sessionId and actsFor array are required');
    db.prepare('INSERT INTO bot_conversation_acts_for (session_id, acts_for, triggered_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET acts_for = excluded.acts_for, triggered_by = excluded.triggered_by')
      .run(String(sessionId), JSON.stringify(actsFor), triggeredBy ? JSON.stringify(triggeredBy) : null, now);
    return getActsFor(sessionId);
  }

  function recordRunResend(runId, sessionId, now = Date.now()) {
    if (!runId || !sessionId) throw new BotWorkError('invalid_argument', 'runId and sessionId are required');
    return withTransaction(db, () => {
      const existing = db.prepare('SELECT * FROM bot_run_resends WHERE run_id = ?').get(String(runId));
      if (existing) return { recorded: false, runId: existing.run_id, sessionId: existing.session_id, createdAt: existing.created_at };
      db.prepare('INSERT INTO bot_run_resends (run_id, session_id, created_at) VALUES (?, ?, ?)').run(String(runId), String(sessionId), now);
      return { recorded: true, runId: String(runId), sessionId: String(sessionId), createdAt: now };
    });
  }

  function setRequestOutcome(messageId, outcome, now = Date.now()) {
    if (!messageId || !outcome) throw new BotWorkError('invalid_argument', 'messageId and outcome are required');
    db.prepare('INSERT INTO bot_request_outcomes (message_id, outcome, updated_at) VALUES (?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET outcome = excluded.outcome, updated_at = excluded.updated_at')
      .run(String(messageId), String(outcome), now);
    return { messageId: String(messageId), outcome: String(outcome), updatedAt: now };
  }

  return {
    createRequest,
    getRequest: (messageId) => mapRequestRow(byId.get(String(messageId))),
    getRequestBySendKey: (sendKey) => mapRequestRow(byKey.get(String(sendKey))),
    listRequestsByRoot: (rootKey) => db.prepare('SELECT * FROM bot_requests WHERE root_key = ? ORDER BY created_at ASC').all(String(rootKey)).map(mapRequestRow),
    listRequestsForBot: (toBotId, { limit = 50 } = {}) => db.prepare('SELECT * FROM bot_requests WHERE to_bot_id = ? ORDER BY created_at DESC LIMIT ?').all(String(toBotId), clampLimit(limit, 50, 200)).map(mapRequestRow),
    setActsFor, getActsFor,
    deleteActsFor: (sessionId) => Number(db.prepare('DELETE FROM bot_conversation_acts_for WHERE session_id = ?').run(String(sessionId)).changes ?? 0) > 0,
    recordRunResend,
    getRunResend: (runId) => {
      const row = db.prepare('SELECT * FROM bot_run_resends WHERE run_id = ?').get(String(runId));
      return row ? { runId: row.run_id, sessionId: row.session_id, createdAt: row.created_at } : null;
    },
    setRequestOutcome,
    getRequestOutcome: (messageId) => {
      const row = db.prepare('SELECT * FROM bot_request_outcomes WHERE message_id = ?').get(String(messageId));
      return row ? { messageId: row.message_id, outcome: row.outcome, updatedAt: row.updated_at } : null;
    },
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createAutomationsAndAccess(db) {
  const autoById = db.prepare('SELECT * FROM bot_automations WHERE id = ?');
  const accessById = db.prepare('SELECT * FROM bot_access_requests WHERE id = ?');
  const accessByToken = db.prepare('SELECT * FROM bot_access_requests WHERE token = ?');

  function upsertAutomation(input, now = Date.now()) {
    if (!input?.botId) throw new BotWorkError('invalid_argument', 'automation requires botId');
    const id = trimStr(input.id) || crypto.randomUUID();
    const norm = normalizeAutomationInput(input, mapAutomationRow(autoById.get(id)), now);
    db.prepare(
      `INSERT INTO bot_automations (id, bot_id, enabled, record, next_run_at, last_run_at, last_status, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET bot_id = excluded.bot_id, enabled = excluded.enabled, record = excluded.record,
         next_run_at = excluded.next_run_at, last_run_at = excluded.last_run_at, last_status = excluded.last_status, last_error = excluded.last_error, updated_at = excluded.updated_at`,
    ).run(id, norm.botId, norm.enabled, JSON.stringify(norm.rest), norm.nextRunAt, norm.lastRunAt, norm.lastStatus, norm.lastError, norm.createdAt, now);
    return mapAutomationRow(autoById.get(id));
  }

  function listAutomations({ botId = null, enabledOnly = false } = {}) {
    const { whereSql, params } = buildWhere([
      ['bot_id = ?', botId ? String(botId) : null],
      ['enabled = 1', enabledOnly ? true : null],
    ]);
    return db.prepare(`SELECT * FROM bot_automations ${whereSql} ORDER BY updated_at DESC`).all(...params).map(mapAutomationRow);
  }

  function createAccessRequest(input, now = Date.now()) {
    const p = parseAccessRequestInput(input);
    db.prepare(
      "INSERT INTO bot_access_requests (id, token, bot_id, source, workspace_id, requester_id, requester_name, status, payload, decided_by, decided_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, ?)",
    ).run(p.id, p.token, p.botId, p.source, p.workspaceId, p.requesterId, p.requesterName, JSON.stringify(p.payload), p.expiresAt, now);
    return mapAccessRow(accessById.get(p.id));
  }

  function listAccessRequests({ botId = null, status = null } = {}) {
    const { whereSql, params } = buildWhere([
      ['bot_id = ?', botId ? String(botId) : null],
      ['status = ?', status ? String(status) : null],
    ]);
    return db.prepare(`SELECT * FROM bot_access_requests ${whereSql} ORDER BY created_at DESC`).all(...params).map(mapAccessRow);
  }

  function decideAccessRequest(id, { decision, decidedBy = 'owner', now = Date.now() }) {
    const normalized = normalizeAccessDecision(decision);
    if (!ACCESS_DECISIONS.includes(normalized)) throw new BotWorkError('invalid_argument', 'decision must be granted or declined');
    return withTransaction(db, () => {
      const current = mapAccessRow(accessById.get(String(id)));
      if (!current) throw new BotWorkError('not_found', `Access request not found: ${id}`);
      if (current.status !== 'pending') throw new BotWorkError('already_decided', `Access request already ${current.status}`, { status: current.status });
      if (current.expiresAt !== null && current.expiresAt <= now) {
        db.prepare("UPDATE bot_access_requests SET status = 'expired' WHERE id = ?").run(current.id);
        throw new BotWorkError('already_decided', 'Access request has expired', { status: 'expired' });
      }
      db.prepare('UPDATE bot_access_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
        .run(normalized, String(decidedBy), now, current.id);
      return mapAccessRow(accessById.get(current.id));
    });
  }

  function redeemAccessToken(token, { decision, decidedBy = 'owner', now = Date.now() }) {
    const row = mapAccessRow(accessByToken.get(String(token)));
    if (!row) throw new BotWorkError('not_found', 'Access token not found');
    return decideAccessRequest(row.id, { decision, decidedBy, now });
  }

  return {
    upsertAutomation, getAutomation: (id) => mapAutomationRow(autoById.get(String(id))), listAutomations,
    updateAutomationRunState: (id, patch, now = Date.now()) => {
      const current = mapAutomationRow(autoById.get(String(id)));
      return current ? upsertAutomation({ ...current, ...patch, id: current.id }, now) : null;
    },
    deleteAutomation: (id) => Number(db.prepare('DELETE FROM bot_automations WHERE id = ?').run(String(id)).changes ?? 0) > 0,
    createAccessRequest, getAccessRequest: (id) => mapAccessRow(accessById.get(String(id))),
    getAccessRequestByToken: (token) => mapAccessRow(accessByToken.get(String(token))),
    listAccessRequests, decideAccessRequest, redeemAccessToken,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createWorkStore(db) {
  return {
    ...createCoreWorkAccess(db), ...createRequestsAccess(db), ...createAutomationsAndAccess(db),
    ...createClaimsAccess(db), ...createWebhookEventsAccess(db), ...createToolWalAccess(db),
    ...createBudgetAccess(db), ...createCrewAdoptionAccess(db),
  };
}
