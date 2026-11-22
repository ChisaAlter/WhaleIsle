/**
 * Orchestration, Worker binding, Automations, and Access Requests SQLite store.
 * Manages 7 tables in `bots.db`:
 * - `bot_work`
 * - `bot_requests`
 * - `bot_conversation_acts_for`
 * - `bot_run_resends`
 * - `bot_request_outcomes`
 * - `bot_automations`
 * - `bot_access_requests`
 */
import crypto from 'node:crypto';
import { withTransaction } from './db.js';

export const WORK_CLOSE_REASONS = Object.freeze([
  'task_gone',
  'workspace_gone',
  'thread_gone',
  'owner_reset',
  'superseded',
  'bot_gone',
  'start_failed',
]);

export const REQUEST_PURPOSES = Object.freeze(['status', 'handoff', 'question']);
export const DEFAULT_MAX_REQUEST_DEPTH = 6;
export const ACCESS_DECISIONS = Object.freeze(['granted', 'declined']);

export class BotWorkError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [data]
   */
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'BotWorkError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** @param {any} row */
function mapWorkRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    source: row.source,
    externalId: row.external_id,
    generation: row.generation,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    host: row.host,
    askedInApp: Boolean(row.asked_in_app),
    current: Boolean(row.current),
    createdAt: row.created_at,
    closedAt: row.closed_at ?? null,
    closeReason: row.close_reason ?? null,
  };
}

/** @param {any} row */
function mapRequestRow(row) {
  if (!row) return null;
  return {
    messageId: row.message_id,
    rootKey: row.root_key,
    fromBotId: row.from_bot_id ?? null,
    toBotId: row.to_bot_id,
    purpose: row.purpose,
    depth: row.depth,
    record: JSON.parse(row.record),
    createdAt: row.created_at,
    sendKey: row.send_key ?? null,
  };
}

/** @param {any} row */
function mapAutomationRow(row) {
  if (!row) return null;
  const extra = JSON.parse(row.record);
  return {
    ...extra,
    id: row.id,
    botId: row.bot_id,
    enabled: Boolean(row.enabled),
    nextRunAt: row.next_run_at ?? null,
    lastRunAt: row.last_run_at ?? null,
    lastStatus: row.last_status ?? null,
    lastError: row.last_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @param {any} row */
function mapAccessRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    botId: row.bot_id,
    source: row.source,
    workspaceId: row.workspace_id ?? null,
    requesterId: row.requester_id,
    requesterName: row.requester_name ?? null,
    status: row.status,
    payload: JSON.parse(row.payload),
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
  };
}

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
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** @param {unknown} value */
function trimStr(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {any} input */
function parseStartWorkInput(input) {
  const fields = {
    botId: trimStr(input?.botId),
    source: trimStr(input?.source),
    externalId: trimStr(input?.externalId),
    taskId: trimStr(input?.taskId),
    dispatchId: trimStr(input?.dispatchId),
  };
  if (Object.values(fields).some((v) => !v)) {
    throw new BotWorkError('invalid_argument', 'botId, source, externalId, taskId, and dispatchId are required');
  }
  return {
    ...fields,
    id: trimStr(input?.id) || crypto.randomUUID(),
    host: trimStr(input?.host) || 'local',
    askedInApp: input?.askedInApp ? 1 : 0,
  };
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
    rootKey,
    toBotId,
    fromBotId: trimStr(raw.fromBotId) || null,
    purpose,
    depth,
    maxDepth: Number.isInteger(raw.maxDepth) ? raw.maxDepth : DEFAULT_MAX_REQUEST_DEPTH,
    sendKey: trimStr(raw.sendKey) || null,
    messageId: trimStr(raw.messageId) || crypto.randomUUID(),
    record: raw.record ?? {},
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
    botId: String(input.botId),
    enabled: enabledFlag ? 1 : 0,
    nextRunAt: input.nextRunAt ?? existing?.nextRunAt ?? null,
    lastRunAt: input.lastRunAt ?? existing?.lastRunAt ?? null,
    lastStatus: input.lastStatus ?? existing?.lastStatus ?? null,
    lastError: input.lastError ?? existing?.lastError ?? null,
    createdAt: existing?.createdAt ?? (Number.isFinite(input.createdAt) ? input.createdAt : now),
    rest,
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
    id: trimStr(input?.id) || crypto.randomUUID(),
    token: trimStr(input?.token) || crypto.randomBytes(24).toString('hex'),
    botId,
    source,
    workspaceId: trimStr(input?.workspaceId) || null,
    requesterId,
    requesterName: trimStr(input?.requesterName) || null,
    expiresAt: Number.isFinite(input?.expiresAt) ? input.expiresAt : null,
    payload: input?.payload ?? {},
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createWorkStore(db) {
  // ---- bot_work ----

  const selectCurrentWorkStmt = db.prepare(
    'SELECT * FROM bot_work WHERE bot_id = ? AND source = ? AND external_id = ? AND closed_at IS NULL AND current = 1 LIMIT 1',
  );
  const selectMaxGenStmt = db.prepare(
    'SELECT coalesce(max(generation), 0) AS max_gen FROM bot_work WHERE bot_id = ? AND source = ? AND external_id = ?',
  );
  const selectWorkByIdStmt = db.prepare('SELECT * FROM bot_work WHERE id = ?');
  const selectWorkByDispatchStmt = db.prepare('SELECT * FROM bot_work WHERE dispatch_id = ? ORDER BY created_at DESC LIMIT 1');

  function startWork(input, now = Date.now()) {
    const p = parseStartWorkInput(input);
    return withTransaction(db, () => {
      db.prepare(`
        UPDATE bot_work
        SET current = 0, closed_at = coalesce(closed_at, ?), close_reason = coalesce(close_reason, 'superseded')
        WHERE bot_id = ? AND source = ? AND external_id = ? AND current = 1
      `).run(now, p.botId, p.source, p.externalId);

      const nextGen = Number(selectMaxGenStmt.get(p.botId, p.source, p.externalId)?.max_gen ?? 0) + 1;
      db.prepare(`
        INSERT INTO bot_work (
          id, bot_id, source, external_id, generation, task_id, dispatch_id,
          host, asked_in_app, current, created_at, closed_at, close_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL)
      `).run(p.id, p.botId, p.source, p.externalId, nextGen, p.taskId, p.dispatchId, p.host, p.askedInApp, now);

      return mapWorkRow(selectWorkByIdStmt.get(p.id));
    });
  }

  function getCurrentWork(botId, source, externalId) {
    return mapWorkRow(selectCurrentWorkStmt.get(String(botId), String(source), String(externalId)));
  }

  function getWorkById(id) {
    return mapWorkRow(selectWorkByIdStmt.get(String(id)));
  }

  function getWorkByDispatch(dispatchId) {
    return mapWorkRow(selectWorkByDispatchStmt.get(String(dispatchId)));
  }

  function listWork({ botId, source, openOnly = false, limit = 100 } = {}) {
    const clauses = [];
    const params = [];
    if (botId) {
      clauses.push('bot_id = ?');
      params.push(String(botId));
    }
    if (source) {
      clauses.push('source = ?');
      params.push(String(source));
    }
    if (openOnly) clauses.push('closed_at IS NULL');
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.min(Math.max(1, Number(limit) || 100), 500);
    return db.prepare(`SELECT * FROM bot_work ${whereSql} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, safeLimit)
      .map(mapWorkRow);
  }

  function forgetWork(botId, source, externalId, { reason = 'owner_reset', now = Date.now() } = {}) {
    const validReason = validateCloseReason(reason);
    return withTransaction(db, () => {
      const current = getCurrentWork(botId, source, externalId);
      if (current) {
        db.prepare(
          'UPDATE bot_work SET current = 0, closed_at = ?, close_reason = ? WHERE id = ?',
        ).run(now, validReason, current.id);
      }
      const maxGen = Number(selectMaxGenStmt.get(String(botId), String(source), String(externalId))?.max_gen ?? 0);
      return {
        forgotten: current ? mapWorkRow(selectWorkByIdStmt.get(current.id)) : null,
        nextGeneration: maxGen + 1,
      };
    });
  }

  function closeWork(id, { reason, now = Date.now() }) {
    const validReason = validateCloseReason(reason);
    const info = db.prepare(
      'UPDATE bot_work SET current = 0, closed_at = coalesce(closed_at, ?), close_reason = coalesce(close_reason, ?) WHERE id = ?',
    ).run(now, validReason, String(id));
    if (Number(info.changes ?? 0) === 0) return null;
    return mapWorkRow(selectWorkByIdStmt.get(String(id)));
  }

  function closeWorkByDispatch(dispatchId, { reason, now = Date.now() }) {
    const validReason = validateCloseReason(reason);
    const row = selectWorkByDispatchStmt.get(String(dispatchId));
    if (!row) return null;
    return closeWork(row.id, { reason: validReason, now });
  }

  // ---- bot_requests ----

  const selectReqByIdStmt = db.prepare('SELECT * FROM bot_requests WHERE message_id = ?');
  const selectReqBySendKeyStmt = db.prepare('SELECT * FROM bot_requests WHERE send_key = ?');
  const selectEdgesByRootStmt = db.prepare('SELECT from_bot_id, to_bot_id FROM bot_requests WHERE root_key = ?');

  function createRequest(input, now = Date.now()) {
    const p = parseRequestInput(input);
    return withTransaction(db, () => {
      if (p.sendKey) {
        const existing = selectReqBySendKeyStmt.get(p.sendKey);
        if (existing) return { request: mapRequestRow(existing), deduplicated: true };
      }
      if (p.depth > p.maxDepth) {
        throw new BotWorkError('depth_exceeded', `Request depth ${p.depth} exceeds max depth ${p.maxDepth}`, {
          depth: p.depth, maxDepth: p.maxDepth,
        });
      }
      const edges = selectEdgesByRootStmt.all(p.rootKey);
      if (wouldCreateCycle(edges, p.fromBotId, p.toBotId)) {
        throw new BotWorkError('loop_detected', `Cross-bot request cycle detected: ${p.fromBotId} -> ${p.toBotId}`, {
          rootKey: p.rootKey, fromBotId: p.fromBotId, toBotId: p.toBotId,
        });
      }
      db.prepare(`
        INSERT INTO bot_requests (message_id, root_key, from_bot_id, to_bot_id, purpose, depth, record, created_at, send_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p.messageId, p.rootKey, p.fromBotId, p.toBotId, p.purpose, p.depth,
        JSON.stringify(p.record), now, p.sendKey,
      );
      return { request: mapRequestRow(selectReqByIdStmt.get(p.messageId)), deduplicated: false };
    });
  }

  function getRequest(messageId) {
    return mapRequestRow(selectReqByIdStmt.get(String(messageId)));
  }

  function getRequestBySendKey(sendKey) {
    return mapRequestRow(selectReqBySendKeyStmt.get(String(sendKey)));
  }

  function listRequestsByRoot(rootKey) {
    return db.prepare('SELECT * FROM bot_requests WHERE root_key = ? ORDER BY created_at ASC')
      .all(String(rootKey))
      .map(mapRequestRow);
  }

  function listRequestsForBot(toBotId, { limit = 50 } = {}) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
    return db.prepare('SELECT * FROM bot_requests WHERE to_bot_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(String(toBotId), safeLimit)
      .map(mapRequestRow);
  }

  // ---- bot_conversation_acts_for ----

  function setActsFor(sessionId, actsFor, triggeredBy = null, now = Date.now()) {
    if (!sessionId || !Array.isArray(actsFor)) {
      throw new BotWorkError('invalid_argument', 'sessionId and actsFor array are required');
    }
    db.prepare(`
      INSERT INTO bot_conversation_acts_for (session_id, acts_for, triggered_by, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        acts_for = excluded.acts_for,
        triggered_by = excluded.triggered_by
    `).run(
      String(sessionId),
      JSON.stringify(actsFor),
      triggeredBy ? JSON.stringify(triggeredBy) : null,
      now,
    );
    return getActsFor(sessionId);
  }

  function getActsFor(sessionId) {
    const row = db.prepare('SELECT * FROM bot_conversation_acts_for WHERE session_id = ?')
      .get(String(sessionId));
    if (!row) return null;
    return {
      sessionId: row.session_id,
      actsFor: JSON.parse(row.acts_for),
      triggeredBy: row.triggered_by ? JSON.parse(row.triggered_by) : null,
      createdAt: row.created_at,
    };
  }

  function deleteActsFor(sessionId) {
    const info = db.prepare('DELETE FROM bot_conversation_acts_for WHERE session_id = ?')
      .run(String(sessionId));
    return Number(info.changes ?? 0) > 0;
  }

  // ---- bot_run_resends & bot_request_outcomes ----

  function recordRunResend(runId, sessionId, now = Date.now()) {
    if (!runId || !sessionId) {
      throw new BotWorkError('invalid_argument', 'runId and sessionId are required');
    }
    return withTransaction(db, () => {
      const existing = db.prepare('SELECT * FROM bot_run_resends WHERE run_id = ?').get(String(runId));
      if (existing) {
        return { recorded: false, runId: existing.run_id, sessionId: existing.session_id, createdAt: existing.created_at };
      }
      db.prepare('INSERT INTO bot_run_resends (run_id, session_id, created_at) VALUES (?, ?, ?)')
        .run(String(runId), String(sessionId), now);
      return { recorded: true, runId: String(runId), sessionId: String(sessionId), createdAt: now };
    });
  }

  function getRunResend(runId) {
    const row = db.prepare('SELECT * FROM bot_run_resends WHERE run_id = ?').get(String(runId));
    return row ? { runId: row.run_id, sessionId: row.session_id, createdAt: row.created_at } : null;
  }

  function setRequestOutcome(messageId, outcome, now = Date.now()) {
    if (!messageId || !outcome) {
      throw new BotWorkError('invalid_argument', 'messageId and outcome are required');
    }
    db.prepare(`
      INSERT INTO bot_request_outcomes (message_id, outcome, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET outcome = excluded.outcome, updated_at = excluded.updated_at
    `).run(String(messageId), String(outcome), now);
    return { messageId: String(messageId), outcome: String(outcome), updatedAt: now };
  }

  function getRequestOutcome(messageId) {
    const row = db.prepare('SELECT * FROM bot_request_outcomes WHERE message_id = ?').get(String(messageId));
    return row ? { messageId: row.message_id, outcome: row.outcome, updatedAt: row.updated_at } : null;
  }

  // ---- bot_automations ----

  const selectAutoByIdStmt = db.prepare('SELECT * FROM bot_automations WHERE id = ?');

  function upsertAutomation(input, now = Date.now()) {
    if (!input?.botId) {
      throw new BotWorkError('invalid_argument', 'automation requires botId');
    }
    const id = trimStr(input.id) || crypto.randomUUID();
    const existing = mapAutomationRow(selectAutoByIdStmt.get(id));
    const norm = normalizeAutomationInput(input, existing, now);

    db.prepare(`
      INSERT INTO bot_automations (
        id, bot_id, enabled, record, next_run_at, last_run_at, last_status, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        bot_id = excluded.bot_id,
        enabled = excluded.enabled,
        record = excluded.record,
        next_run_at = excluded.next_run_at,
        last_run_at = excluded.last_run_at,
        last_status = excluded.last_status,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(
      id, norm.botId, norm.enabled, JSON.stringify(norm.rest),
      norm.nextRunAt, norm.lastRunAt, norm.lastStatus, norm.lastError, norm.createdAt, now,
    );

    return mapAutomationRow(selectAutoByIdStmt.get(id));
  }

  function getAutomation(id) {
    return mapAutomationRow(selectAutoByIdStmt.get(String(id)));
  }

  function listAutomations({ botId = null, enabledOnly = false } = {}) {
    const clauses = [];
    const params = [];
    if (botId) {
      clauses.push('bot_id = ?');
      params.push(String(botId));
    }
    if (enabledOnly) clauses.push('enabled = 1');
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM bot_automations ${whereSql} ORDER BY updated_at DESC`)
      .all(...params)
      .map(mapAutomationRow);
  }

  function updateAutomationRunState(id, patch, now = Date.now()) {
    const current = getAutomation(id);
    if (!current) return null;
    return upsertAutomation({ ...current, ...patch, id: current.id }, now);
  }

  function deleteAutomation(id) {
    const info = db.prepare('DELETE FROM bot_automations WHERE id = ?').run(String(id));
    return Number(info.changes ?? 0) > 0;
  }

  // ---- bot_access_requests ----

  const selectAccessByIdStmt = db.prepare('SELECT * FROM bot_access_requests WHERE id = ?');
  const selectAccessByTokenStmt = db.prepare('SELECT * FROM bot_access_requests WHERE token = ?');

  function createAccessRequest(input, now = Date.now()) {
    const p = parseAccessRequestInput(input);
    db.prepare(`
      INSERT INTO bot_access_requests (
        id, token, bot_id, source, workspace_id, requester_id, requester_name,
        status, payload, decided_by, decided_at, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, ?)
    `).run(
      p.id, p.token, p.botId, p.source, p.workspaceId, p.requesterId, p.requesterName,
      JSON.stringify(p.payload), p.expiresAt, now,
    );
    return mapAccessRow(selectAccessByIdStmt.get(p.id));
  }

  function getAccessRequest(id) {
    return mapAccessRow(selectAccessByIdStmt.get(String(id)));
  }

  function getAccessRequestByToken(token) {
    return mapAccessRow(selectAccessByTokenStmt.get(String(token)));
  }

  function listAccessRequests({ botId = null, status = null } = {}) {
    const clauses = [];
    const params = [];
    if (botId) {
      clauses.push('bot_id = ?');
      params.push(String(botId));
    }
    if (status) {
      clauses.push('status = ?');
      params.push(String(status));
    }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM bot_access_requests ${whereSql} ORDER BY created_at DESC`)
      .all(...params)
      .map(mapAccessRow);
  }

  function decideAccessRequest(id, { decision, decidedBy = 'owner', now = Date.now() }) {
    if (!ACCESS_DECISIONS.includes(decision)) {
      throw new BotWorkError('invalid_argument', `decision must be granted or declined`);
    }
    return withTransaction(db, () => {
      const current = getAccessRequest(id);
      if (!current) throw new BotWorkError('not_found', `Access request not found: ${id}`);
      if (current.status !== 'pending') {
        throw new BotWorkError('already_decided', `Access request already ${current.status}`, { status: current.status });
      }
      if (current.expiresAt !== null && current.expiresAt <= now) {
        db.prepare("UPDATE bot_access_requests SET status = 'expired' WHERE id = ?").run(current.id);
        throw new BotWorkError('already_decided', 'Access request has expired', { status: 'expired' });
      }
      db.prepare('UPDATE bot_access_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
        .run(decision, String(decidedBy), now, current.id);
      return getAccessRequest(current.id);
    });
  }

  function redeemAccessToken(token, { decision, decidedBy = 'owner', now = Date.now() }) {
    const row = getAccessRequestByToken(token);
    if (!row) throw new BotWorkError('not_found', 'Access token not found');
    return decideAccessRequest(row.id, { decision, decidedBy, now });
  }

  return {
    startWork,
    getCurrentWork,
    getWorkById,
    getWorkByDispatch,
    listWork,
    forgetWork,
    closeWork,
    closeWorkByDispatch,
    createRequest,
    getRequest,
    getRequestBySendKey,
    listRequestsByRoot,
    listRequestsForBot,
    setActsFor,
    getActsFor,
    deleteActsFor,
    recordRunResend,
    getRunResend,
    setRequestOutcome,
    getRequestOutcome,
    upsertAutomation,
    getAutomation,
    listAutomations,
    updateAutomationRunState,
    deleteAutomation,
    createAccessRequest,
    getAccessRequest,
    getAccessRequestByToken,
    listAccessRequests,
    decideAccessRequest,
    redeemAccessToken,
  };
}
