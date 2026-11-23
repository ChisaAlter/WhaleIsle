/**
 * Pure row mappers, input parsers, and graph guards for `work-store.js`.
 */
import crypto from 'node:crypto';

/** @type {readonly string[]} */
export const WORK_CLOSE_REASONS = Object.freeze([
  'task_gone',
  'workspace_gone',
  'thread_gone',
  'owner_reset',
  'superseded',
  'bot_gone',
  'start_failed',
]);

/** @type {readonly string[]} */
export const REQUEST_PURPOSES = Object.freeze(['status', 'handoff', 'question']);
export const DEFAULT_MAX_REQUEST_DEPTH = 6;
/** @type {readonly string[]} */
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
export function mapWorkRow(row) {
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
export function mapRequestRow(row) {
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
export function mapAutomationRow(row) {
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
export function mapAccessRow(row) {
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
export function validateCloseReason(reason) {
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
export function wouldCreateCycle(edges, fromBotId, toBotId) {
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
    if (!node) continue;
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
export function trimStr(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {any} input */
export function parseStartWorkInput(input) {
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
export function parseRequestInput(input) {
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
export function normalizeAutomationInput(input, existing, now) {
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
export function parseAccessRequestInput(input) {
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
