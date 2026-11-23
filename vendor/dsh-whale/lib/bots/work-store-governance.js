/**
 * Governance SQLite store accessors (`automation_claims`, `webhook_events`,
 * `tool_wal`, `bot_budgets`, `bot_usage_daily`, `crew_adoptions`) and shared query helpers.
 */
import crypto from 'node:crypto';
import { assertDatabaseWritable, withTransaction } from './db.js';
import { BotWorkError, trimStr } from './work-store-helpers.js';

export const CLAIM_TRIGGER_KINDS = Object.freeze(['schedule', 'manual', 'webhook', 'folder']);
export const CLAIM_STATUSES = Object.freeze([
  'claimed', 'running', 'completed', 'failed', 'interrupted', 'skipped_budget',
]);
export const WEBHOOK_EVENT_STATUSES = Object.freeze(['accepted', 'dispatched', 'failed', 'rejected']);
export const TOOL_WAL_STATUSES = Object.freeze(['intent', 'committed', 'failed', 'unknown']);
export const CREW_ADOPTION_STATUSES = Object.freeze(['active', 'released']);

const TERMINAL_CLAIM_STATUSES = new Set(['completed', 'failed', 'interrupted', 'skipped_budget']);

/** @param {unknown} value @param {number} [fallback] */
export const numOr = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** @param {unknown} value */
export const nullableNum = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** @param {unknown} value @param {number} def @param {number} [max] */
export const clampLimit = (value, def, max = 500) => Math.min(Math.max(1, Number(value) || def), max);

/**
 * Build a parameterized WHERE clause from `[sqlExpr, paramOrUndefined]` pairs.
 * @param {Array<[string, any]>} filters
 */
export function buildWhere(filters) {
  const clauses = [];
  const params = [];
  for (const [clause, val] of filters) {
    if (val === null || val === undefined || val === false) continue;
    clauses.push(clause);
    if (val !== true) params.push(val);
  }
  return { whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

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

/** @param {import('node:sqlite').DatabaseSync} db */
export function createClaimsAccess(db) {
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
    assertDatabaseWritable(db, 'db_read_only');
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
export function createWebhookEventsAccess(db) {
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
    assertDatabaseWritable(db, 'db_read_only');
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
    assertDatabaseWritable(db, 'db_read_only');
    const cutoff = now - Math.max(0, numOr(olderThanMs, 86_400_000));
    return Number(db.prepare('DELETE FROM webhook_events WHERE received_at < ?').run(cutoff).changes ?? 0);
  }

  return {
    recordWebhookEvent, getWebhookEvent: (/** @type {any} */ id) => mapWebhookEventRow(byId.get(String(id))),
    updateWebhookEventStatus, listWebhookEvents, pruneWebhookEvents,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createToolWalAccess(db) {
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
    assertDatabaseWritable(db, 'db_read_only');
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
export function createBudgetAccess(db) {
  const selectBudget = db.prepare('SELECT * FROM bot_budgets WHERE bot_id = ?');
  const selectUsage = db.prepare('SELECT * FROM bot_usage_daily WHERE day_utc = ? AND bot_id = ? AND source_kind = ?');

  function setBotBudget(/** @type {any} */ botId, patch = /** @type {any} */ ({}), now = Date.now()) {
    assertDatabaseWritable(db, 'db_read_only');
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
    assertDatabaseWritable(db, 'db_read_only');
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
    deleteBotBudget: (/** @type {any} */ botId) => {
      assertDatabaseWritable(db, 'db_read_only');
      return Number(db.prepare('DELETE FROM bot_budgets WHERE bot_id = ?').run(String(botId)).changes ?? 0) > 0;
    },
    listBotBudgets: () => db.prepare('SELECT * FROM bot_budgets ORDER BY bot_id ASC').all().map(mapBudgetRow),
    upsertBotUsageDaily, listBotUsageDaily, sumBotUsageForDay,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createCrewAdoptionAccess(db) {
  const bySession = db.prepare('SELECT * FROM crew_adoptions WHERE session_id = ?');

  function adoptCrewSession(/** @type {any} */ input, now = Date.now()) {
    assertDatabaseWritable(db, 'db_read_only');
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
    assertDatabaseWritable(db, 'db_read_only');
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
