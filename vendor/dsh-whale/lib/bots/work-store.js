/**
 * Orchestration, Worker binding, Automations, Claims, Webhooks, WAL, Budgets,
 * Crew Adoptions, and Access Requests SQLite store (`bots.db`).
 */
import crypto from 'node:crypto';
import { assertDatabaseWritable, isDatabaseReadOnly, withTransaction } from './db.js';
import {
  ACCESS_DECISIONS,
  BotWorkError,
  DEFAULT_MAX_REQUEST_DEPTH,
  REQUEST_PURPOSES,
  WORK_CLOSE_REASONS,
  mapAccessRow,
  mapAutomationRow,
  mapRequestRow,
  mapWorkRow,
  normalizeAutomationInput,
  parseAccessRequestInput,
  parseRequestInput,
  parseStartWorkInput,
  trimStr,
  validateCloseReason,
  wouldCreateCycle,
} from './work-store-helpers.js';

import {
  CLAIM_STATUSES,
  CLAIM_TRIGGER_KINDS,
  CREW_ADOPTION_STATUSES,
  TOOL_WAL_STATUSES,
  WEBHOOK_EVENT_STATUSES,
  buildWhere,
  clampLimit,
  createBudgetAccess,
  createClaimsAccess,
  createCrewAdoptionAccess,
  createToolWalAccess,
  createWebhookEventsAccess,
} from './work-store-governance.js';

export {
  ACCESS_DECISIONS,
  BotWorkError,
  CLAIM_STATUSES,
  CLAIM_TRIGGER_KINDS,
  CREW_ADOPTION_STATUSES,
  DEFAULT_MAX_REQUEST_DEPTH,
  REQUEST_PURPOSES,
  TOOL_WAL_STATUSES,
  WEBHOOK_EVENT_STATUSES,
  WORK_CLOSE_REASONS,
};

/**
 * Normalize access decisions, mapping legacy `'denied'` -> `'declined'`.
 * @param {unknown} decision
 */
export function normalizeAccessDecision(decision) {
  const raw = trimStr(decision).toLowerCase();
  return raw === 'denied' ? 'declined' : raw;
}

/** @param {import('node:sqlite').DatabaseSync} db */
function createCoreWorkAccess(db) {
  const selectCurrentWorkStmt = db.prepare(
    'SELECT * FROM bot_work WHERE bot_id = ? AND source = ? AND external_id = ? AND closed_at IS NULL AND current = 1 LIMIT 1',
  );
  const selectMaxGenStmt = db.prepare(
    'SELECT coalesce(max(generation), 0) AS max_gen FROM bot_work WHERE bot_id = ? AND source = ? AND external_id = ?',
  );
  const selectWorkByIdStmt = db.prepare('SELECT * FROM bot_work WHERE id = ?');
  const selectWorkByAddressGenStmt = db.prepare(
    'SELECT * FROM bot_work WHERE bot_id = ? AND source = ? AND external_id = ? AND generation = ? LIMIT 1',
  );
  const selectWorkByDispatchStmt = db.prepare('SELECT * FROM bot_work WHERE dispatch_id = ? ORDER BY created_at DESC LIMIT 1');
  const insertWorkIgnoreStmt = db.prepare(`
    INSERT INTO bot_work (
      id, bot_id, source, external_id, generation, task_id, dispatch_id,
      host, asked_in_app, current, created_at, closed_at, close_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL)
    ON CONFLICT DO NOTHING
  `);

  /**
   * Idempotently bind a work row (`INSERT ... ON CONFLICT DO NOTHING`).
   * If a conflicting `id`, `(botId, source, externalId, generation)`, or open `current = 1`
   * row already exists for the address, returns `{ work: existing, inserted: false }` without error.
   * @param {any} input
   * @param {number} [now]
   */
  function bindWork(input, now = Date.now()) {
    const p = parseStartWorkInput(input);
    const explicitGen = input?.generation;
    if (explicitGen !== undefined && explicitGen !== null && (!Number.isInteger(explicitGen) || explicitGen <= 0)) {
      throw new BotWorkError('invalid_argument', 'generation must be a positive integer');
    }
    return withTransaction(db, () => {
      const targetGen = explicitGen ?? (Number(selectMaxGenStmt.get(p.botId, p.source, p.externalId)?.max_gen ?? 0) + 1);
      const info = insertWorkIgnoreStmt.run(
        p.id, p.botId, p.source, p.externalId, targetGen, p.taskId, p.dispatchId, p.host, p.askedInApp, now,
      );
      if (Number(info.changes ?? 0) > 0) {
        return { work: mapWorkRow(selectWorkByIdStmt.get(p.id)), inserted: true };
      }
      const existing = selectWorkByIdStmt.get(p.id)
        ?? selectWorkByAddressGenStmt.get(p.botId, p.source, p.externalId, targetGen)
        ?? selectCurrentWorkStmt.get(p.botId, p.source, p.externalId);
      return { work: mapWorkRow(existing), inserted: false };
    });
  }

  /**
   * Start (or supersede the sticky slot of) a work row for `(botId, source, externalId)`.
   * Demotes any previous `current = 1` row to `current = 0` WITHOUT forcibly closing it,
   * preserving active PR / Work Item tracking on historical rows.
   * @param {any} input
   * @param {number} [now]
   */
  function startWork(input, now = Date.now()) {
    const p = parseStartWorkInput(input);
    return withTransaction(db, () => {
      db.prepare(`
        UPDATE bot_work
        SET current = 0
        WHERE bot_id = ? AND source = ? AND external_id = ? AND current = 1
      `).run(p.botId, p.source, p.externalId);

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

  /**
   * Replace the current work row for an address while keeping the old row open (`current = 0`).
   * Supports both:
   * - `replaceWork(input, now)`
   * - `replaceWork({ id, generation }, input, now)` (with optimistic generation CAS on the replaced row)
   * @param {any} inputOrRef
   * @param {any} [maybeInputOrNow]
   * @param {number} [maybeNow]
   */
  function replaceWork(inputOrRef, maybeInputOrNow = Date.now(), maybeNow = Date.now()) {
    const isRefForm = maybeInputOrNow && typeof maybeInputOrNow === 'object';
    if (!isRefForm) {
      return startWork(inputOrRef, typeof maybeInputOrNow === 'number' ? maybeInputOrNow : Date.now());
    }
    const ref = inputOrRef ?? {};
    const input = maybeInputOrNow;
    const now = Number.isFinite(maybeNow) ? maybeNow : Date.now();
    const p = parseStartWorkInput(input);
    return withTransaction(db, () => {
      if (ref.id !== undefined && ref.generation !== undefined) {
        const demoted = db.prepare(`
          UPDATE bot_work
          SET current = 0
          WHERE id = ? AND generation = ? AND closed_at IS NULL AND current = 1
        `).run(String(ref.id), Number(ref.generation));
        if (Number(demoted.changes ?? 0) === 0) return null;
      } else {
        db.prepare(`
          UPDATE bot_work
          SET current = 0
          WHERE bot_id = ? AND source = ? AND external_id = ? AND current = 1
        `).run(p.botId, p.source, p.externalId);
      }
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
    const { whereSql, params } = buildWhere([
      ['bot_id = ?', botId ? String(botId) : null],
      ['source = ?', source ? String(source) : null],
      ['closed_at IS NULL', openOnly ? true : null],
    ]);
    return db.prepare(`SELECT * FROM bot_work ${whereSql} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, clampLimit(limit, 100)).map(mapWorkRow);
  }

  /**
   * Batch-fetch all workers for a bot grouped by `externalId` (chat `sessionId`) in a single query.
   * Eliminates `decorateChatRow` N+1 lookups when listing chats for a bot.
   * @param {string} botId
   * @param {{ chatIds?: string[] | null, openOnly?: boolean, limit?: number }} [options]
   * @returns {Map<string, ReturnType<typeof mapWorkRow>[]>}
   */
  function listChatWorkersByBot(botId, { chatIds = null, openOnly = false, limit = 500 } = {}) {
    /** @type {Map<string, any[]>} */
    const byChat = new Map();
    if (!botId) return byChat;
    if (Array.isArray(chatIds) && chatIds.length === 0) return byChat;

    const clauses = ['bot_id = ?'];
    const params = [String(botId)];
    if (Array.isArray(chatIds)) {
      clauses.push('external_id IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(chatIds.map(String)));
    }
    if (openOnly) clauses.push('closed_at IS NULL');
    const safeLimit = Math.min(Math.max(1, Number(limit) || 500), 2000);
    const rows = db.prepare(
      `SELECT * FROM bot_work WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    ).all(...params, safeLimit);

    for (const row of rows) {
      const mapped = mapWorkRow(row);
      if (!mapped) continue;
      const list = byChat.get(mapped.externalId) ?? [];
      list.push(mapped);
      byChat.set(mapped.externalId, list);
    }
    return byChat;
  }

  /**
   * Batch-fetch workers across multiple bots grouped as `Map<botId, Map<externalId, WorkRow[]>>`
   * in a single SQLite query using `json_each(?)`.
   * @param {string[]} botIds
   * @param {{ openOnly?: boolean, limit?: number }} [options]
   * @returns {Map<string, Map<string, ReturnType<typeof mapWorkRow>[]>>}
   */
  function listChatWorkersByBots(botIds, { openOnly = false, limit = 2000 } = {}) {
    /** @type {Map<string, Map<string, any[]>>} */
    const byBot = new Map();
    if (!Array.isArray(botIds) || botIds.length === 0) return byBot;
    const uniqueIds = [...new Set(botIds.map(String).filter(Boolean))];
    if (uniqueIds.length === 0) return byBot;
    for (const id of uniqueIds) byBot.set(id, new Map());

    const clauses = ['bot_id IN (SELECT value FROM json_each(?))'];
    const params = [JSON.stringify(uniqueIds)];
    if (openOnly) clauses.push('closed_at IS NULL');
    const safeLimit = Math.min(Math.max(1, Number(limit) || 2000), 5000);
    const rows = db.prepare(
      `SELECT * FROM bot_work WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    ).all(...params, safeLimit);

    for (const row of rows) {
      const mapped = mapWorkRow(row);
      if (!mapped) continue;
      let chatMap = byBot.get(mapped.botId);
      if (!chatMap) {
        chatMap = new Map();
        byBot.set(mapped.botId, chatMap);
      }
      const list = chatMap.get(mapped.externalId) ?? [];
      list.push(mapped);
      chatMap.set(mapped.externalId, list);
    }
    return byBot;
  }

  function forgetWork(botId, source, externalId, { reason = 'owner_reset', now = Date.now() } = {}) {
    const validReason = validateCloseReason(reason);
    return withTransaction(db, () => {
      const current = getCurrentWork(botId, source, externalId);
      if (current) {
        db.prepare(
          'UPDATE bot_work SET current = 0, closed_at = ?, close_reason = ? WHERE id = ? AND generation = ? AND closed_at IS NULL',
        ).run(now, validReason, current.id, current.generation);
      }
      const maxGen = Number(selectMaxGenStmt.get(String(botId), String(source), String(externalId))?.max_gen ?? 0);
      return {
        forgotten: current ? mapWorkRow(selectWorkByIdStmt.get(current.id)) : null,
        nextGeneration: maxGen + 1,
      };
    });
  }

  /**
   * Close a work row. When `generation` is provided, enforces optimistic CAS
   * (`WHERE id = ? AND generation = ? AND closed_at IS NULL`) and returns `null` on mismatch.
   * Remains backward-compatible when `generation` is omitted.
   * @param {string} id
   * @param {{ reason: string, generation?: number, now?: number }} options
   */
  function closeWork(id, { reason, generation = undefined, now = Date.now() }) {
    assertDatabaseWritable(db, 'db_read_only');
    const validReason = validateCloseReason(reason);
    let info;
    if (generation !== undefined && generation !== null) {
      if (!Number.isInteger(generation) || generation <= 0) {
        throw new BotWorkError('invalid_argument', 'generation must be a positive integer');
      }
      info = db.prepare(
        'UPDATE bot_work SET current = 0, closed_at = ?, close_reason = ? WHERE id = ? AND generation = ? AND closed_at IS NULL',
      ).run(now, validReason, String(id), generation);
    } else {
      info = db.prepare(
        'UPDATE bot_work SET current = 0, closed_at = coalesce(closed_at, ?), close_reason = coalesce(close_reason, ?) WHERE id = ? AND closed_at IS NULL',
      ).run(now, validReason, String(id));
    }
    if (Number(info.changes ?? 0) === 0) return null;
    return mapWorkRow(selectWorkByIdStmt.get(String(id)));
  }

  function closeWorkByDispatch(dispatchId, { reason, generation = undefined, now = Date.now() }) {
    assertDatabaseWritable(db, 'db_read_only');
    const validReason = validateCloseReason(reason);
    const row = selectWorkByDispatchStmt.get(String(dispatchId));
    if (!row) return null;
    return closeWork(String(row.id), { reason: validReason, generation, now });
  }

  return {
    bindWork,
    bind: bindWork,
    startWork,
    replaceWork,
    replace: replaceWork,
    getCurrentWork,
    getWorkById,
    getWorkByDispatch,
    listWork,
    listChatWorkersByBot,
    listChatWorkersByBots,
    forgetWork,
    closeWork,
    closeWorkByDispatch,
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
    assertDatabaseWritable(db, 'db_read_only');
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

  function deleteActsFor(sessionId) {
    assertDatabaseWritable(db, 'db_read_only');
    const info = db.prepare('DELETE FROM bot_conversation_acts_for WHERE session_id = ?')
      .run(String(sessionId));
    return Number(info.changes ?? 0) > 0;
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
    assertDatabaseWritable(db, 'db_read_only');
    if (!messageId || !outcome) {
      throw new BotWorkError('invalid_argument', 'messageId and outcome are required');
    }
    db.prepare(`
      INSERT INTO bot_request_outcomes (message_id, outcome, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET outcome = excluded.outcome, updated_at = excluded.updated_at
    `).run(String(messageId), String(outcome), now);
    return { messageId: String(messageId), outcome: String(outcome), updatedAt: now };
  }

  return {
    createRequest,
    getRequest: (messageId) => mapRequestRow(byId.get(String(messageId))),
    getRequestBySendKey: (sendKey) => mapRequestRow(byKey.get(String(sendKey))),
    listRequestsByRoot: (rootKey) => db.prepare('SELECT * FROM bot_requests WHERE root_key = ? ORDER BY created_at ASC').all(String(rootKey)).map(mapRequestRow),
    listRequestsForBot: (toBotId, { limit = 50 } = {}) => db.prepare('SELECT * FROM bot_requests WHERE to_bot_id = ? ORDER BY created_at DESC LIMIT ?').all(String(toBotId), clampLimit(limit, 50, 200)).map(mapRequestRow),
    setActsFor, getActsFor, deleteActsFor,
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
    assertDatabaseWritable(db, 'db_read_only');
    if (!input?.botId) {
      throw new BotWorkError('invalid_argument', 'automation requires botId');
    }
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

  function getAutomation(id) {
    return mapAutomationRow(autoById.get(String(id)));
  }

  function listAutomations({ botId = null, enabledOnly = false } = {}) {
    const { whereSql, params } = buildWhere([
      ['bot_id = ?', botId ? String(botId) : null],
      ['enabled = 1', enabledOnly ? true : null],
    ]);
    return db.prepare(`SELECT * FROM bot_automations ${whereSql} ORDER BY updated_at DESC`).all(...params).map(mapAutomationRow);
  }

  function updateAutomationRunState(id, patch, now = Date.now()) {
    const current = getAutomation(id);
    if (!current) return null;
    return upsertAutomation({ ...current, ...patch, id: current.id }, now);
  }

  function deleteAutomation(id) {
    assertDatabaseWritable(db, 'db_read_only');
    const info = db.prepare('DELETE FROM bot_automations WHERE id = ?').run(String(id));
    return Number(info.changes ?? 0) > 0;
  }
  function createAccessRequest(input, now = Date.now()) {
    assertDatabaseWritable(db, 'db_read_only');
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
    upsertAutomation,
    getAutomation,
    listAutomations,
    updateAutomationRunState,
    deleteAutomation,
    createAccessRequest,
    getAccessRequest: (id) => mapAccessRow(accessById.get(String(id))),
    getAccessRequestByToken: (token) => mapAccessRow(accessByToken.get(String(token))),
    listAccessRequests,
    decideAccessRequest,
    redeemAccessToken,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createWorkStore(db) {
  return {
    get isReadOnly() { return isDatabaseReadOnly(db); },
    withTransaction: (/** @type {() => any} */ fn) => withTransaction(db, fn),
    ...createCoreWorkAccess(db),
    ...createRequestsAccess(db),
    ...createAutomationsAndAccess(db),
    ...createClaimsAccess(db),
    ...createWebhookEventsAccess(db),
    ...createToolWalAccess(db),
    ...createBudgetAccess(db),
    ...createCrewAdoptionAccess(db),
  };
}
