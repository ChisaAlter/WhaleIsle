'use strict';

const WebSocket = require('ws');
const { rpc } = require('../workspace-rpc');
const { isSameOriginLoopbackUrl } = require('../local-url');
const { constantTimeEqual } = require('../../shared/secret');

const MAX_ICON_BYTES = 64 * 1024;
const MAX_COMMAND_CHARS = 4000;
const MAX_PLAN_SUMMARY_CHARS = 600;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10000];
const DEFAULT_RECONCILE_DELAY_MS = 200;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i;

/**
 * @typedef {import('./state').ApprovalAction} ApprovalAction
 * @typedef {import('./state').LocalizedText} LocalizedText
 * @typedef {import('./state').PendingApprovalItem} PendingApprovalItem
 *
 * @typedef {
 *   | { kind: 'tool-approval', eventId: string }
 *   | { kind: 'permission-approval', eventId: string, questionId: string, approveOption: string, rejectOption: string, alwaysOption: string | null }
 *   | { kind: 'plan-review', eventId: string, questionId: string, approveOption: string }
 * } WireSettlementRecipe
 *
 * @typedef {{ item: PendingApprovalItem, recipe: WireSettlementRecipe }} NormalizedApproval
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {string} */
function nonEmptyString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {unknown} raw @param {string} origin @returns {string | undefined} */
function sanitizeIconUrl(raw, origin) {
  const trimmed = nonEmptyString(raw);
  if (!trimmed) return undefined;
  const dataMatch = DATA_IMAGE_RE.exec(trimmed);
  if (dataMatch) {
    const base64 = dataMatch[2].replace(/\s+/g, '');
    const decodedBytes = Buffer.from(base64, 'base64').length;
    if (decodedBytes === 0 || decodedBytes > MAX_ICON_BYTES) return undefined;
    return `data:image/${dataMatch[1].toLowerCase()};base64,${base64}`;
  }
  return origin && isSameOriginLoopbackUrl(trimmed, origin) ? trimmed : undefined;
}

/** @param {string} fallback @param {unknown} byLocale @returns {LocalizedText} */
function makeLocalizedText(fallback, byLocale) {
  /** @type {Record<string, string>} */
  const clean = {};
  let hasEntries = false;
  if (isRecord(byLocale)) {
    for (const [key, val] of Object.entries(byLocale)) {
      const text = nonEmptyString(val);
      if (text) {
        clean[key] = text;
        hasEntries = true;
      }
    }
  }
  const safeFallback = nonEmptyString(fallback) || clean.en || Object.values(clean)[0] || '';
  return hasEntries ? { fallback: safeFallback, byLocale: clean } : { fallback: safeFallback };
}

/** @param {string} fallback @param {unknown} byLocale @returns {LocalizedText | null} */
function optionalLocalizedText(fallback, byLocale) {
  return nonEmptyString(fallback) || isRecord(byLocale) ? makeLocalizedText(fallback, byLocale) : null;
}

/** @param {string} text @param {number} limit @returns {string} */
function truncateText(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/** @param {string} toolName @param {unknown} rawArgs @returns {string | null} */
function extractCommandPreview(toolName, rawArgs) {
  if (rawArgs === undefined || rawArgs === null) return null;
  let parsed = rawArgs;
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (!trimmed) return null;
    try { parsed = JSON.parse(trimmed); } catch { return truncateText(trimmed, MAX_COMMAND_CHARS); }
  }
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    return trimmed ? truncateText(trimmed, MAX_COMMAND_CHARS) : null;
  }
  if (!isRecord(parsed)) return null;

  const keys = toolName === 'terminal_send'
    ? ['text', 'input', 'command', 'cmd']
    : ['command', 'cmd', 'script', 'text', 'path', 'file_path', 'url'];
  for (const key of keys) {
    const value = nonEmptyString(parsed[key]);
    if (value) return truncateText(value, MAX_COMMAND_CHARS);
  }
  if (Object.keys(parsed).length === 0) return null;
  try { return truncateText(JSON.stringify(parsed, null, 2), MAX_COMMAND_CHARS); } catch { return null; }
}

/** @param {string} line @returns {string} */
function stripMarkdownLine(line) {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]+/g, '')
    .trim();
}

/** @param {string} detail @returns {{ title: string, summary: string | null }} */
function extractPlanPreview(detail) {
  if (typeof detail !== 'string' || detail.trim() === '') return { title: '', summary: null };
  const lines = detail.split(/\r?\n/).map(stripMarkdownLine).filter(Boolean);
  if (lines.length === 0) return { title: '', summary: null };
  const [first, ...rest] = lines;
  return {
    title: first,
    summary: rest.length > 0 ? truncateText(rest.join('\n'), MAX_PLAN_SUMMARY_CHARS) : null,
  };
}

/** @param {unknown} raw @returns {{ requester: { sessionId: string, label: string } | null, call: Record<string, any> | null }} */
function extractRequester(raw) {
  if (!isRecord(raw)) return { requester: null, call: null };
  const call = isRecord(raw.call) ? raw.call : null;
  const sessionId = nonEmptyString(raw.sessionId);
  if (!sessionId) return { requester: null, call };
  return { requester: { sessionId, label: nonEmptyString(raw.label) || sessionId }, call };
}

/** @param {unknown} raw @param {string} origin @returns {{ name: string, icon?: string } | null} */
function extractSubject(raw, origin) {
  if (!isRecord(raw)) return null;
  const name = nonEmptyString(raw.name);
  if (!name) return null;
  const icon = sanitizeIconUrl(raw.icon, origin);
  return icon ? { name, icon } : { name };
}

/** @param {Record<string, any>} frame @param {{ connectionEpoch: number, now: number }} ctx @returns {NormalizedApproval} */
function normalizeToolApproval(frame, ctx) {
  const req = isRecord(frame.request) ? frame.request : {};
  const eventId = String(frame.eventId);
  const { requester, call } = extractRequester(req.requester);
  const effectiveTool = nonEmptyString(req.toolName) || nonEmptyString(call?.name);
  const callId = req.callId !== undefined && req.callId !== null ? String(req.callId) : null;
  const title = makeLocalizedText(
    effectiveTool || 'Tool approval',
    effectiveTool ? undefined : { zh: '工具执行审批', en: 'Tool approval' },
  );
  /** @type {PendingApprovalItem} */
  const item = {
    eventId,
    kind: 'tool-approval',
    sessionId: String(frame.agentId),
    sessionTitle: null,
    title,
    description: optionalLocalizedText(typeof req.reason === 'string' ? req.reason : '', req.displayReason),
    toolName: effectiveTool || null,
    callId,
    commandPreview: call ? extractCommandPreview(effectiveTool, call.arguments) : null,
    planSummary: null,
    subject: null,
    requester,
    approveLabel: null,
    capabilities: { allowOnce: true, allowAlways: false, reject: true, requestChanges: false },
    receivedAt: ctx.now,
    connectionEpoch: ctx.connectionEpoch,
  };
  return { item, recipe: { kind: 'tool-approval', eventId } };
}

/**
 * @param {Record<string, any>} frame
 * @param {Record<string, any>} question
 * @param {Record<string, any>} intent
 * @param {{ origin: string, connectionEpoch: number, now: number }} ctx
 * @returns {NormalizedApproval | null}
 */
function normalizePermissionApproval(frame, question, intent, ctx) {
  const questionId = nonEmptyString(question.id);
  const approveOption = typeof intent.approve === 'string' ? intent.approve : '';
  const rejectOption = typeof intent.reject === 'string' ? intent.reject : '';
  if (!questionId || !approveOption || !rejectOption) return null;

  const alwaysOption = typeof intent.always === 'string' && intent.always.length > 0 ? intent.always : null;
  const display = isRecord(intent.display) ? intent.display : null;
  const eventId = String(frame.eventId);
  /** @type {PendingApprovalItem} */
  const item = {
    eventId,
    kind: 'permission-approval',
    sessionId: String(frame.agentId),
    sessionTitle: null,
    title: makeLocalizedText(typeof question.question === 'string' ? question.question : '', display?.question),
    description: optionalLocalizedText(typeof question.detail === 'string' ? question.detail : '', display?.detail),
    toolName: null,
    callId: null,
    commandPreview: null,
    planSummary: null,
    subject: extractSubject(intent.subject, ctx.origin),
    requester: null,
    approveLabel: isRecord(display?.approve) ? makeLocalizedText(approveOption, display.approve) : null,
    capabilities: { allowOnce: true, allowAlways: Boolean(alwaysOption), reject: true, requestChanges: false },
    receivedAt: ctx.now,
    connectionEpoch: ctx.connectionEpoch,
  };
  return {
    item,
    recipe: { kind: 'permission-approval', eventId, questionId, approveOption, rejectOption, alwaysOption },
  };
}

/**
 * @param {Record<string, any>} frame
 * @param {Record<string, any>} question
 * @param {Record<string, any>} intent
 * @param {{ connectionEpoch: number, now: number }} ctx
 * @returns {NormalizedApproval | null}
 */
function normalizePlanReview(frame, question, intent, ctx) {
  const questionId = nonEmptyString(question.id);
  const approveOption = typeof intent.approve === 'string' ? intent.approve : '';
  if (!questionId || !approveOption) return null;
  if (Array.isArray(question.options)) {
    if (question.options.length > 2) return null;
    if (!question.options.some((opt) => isRecord(opt) && opt.label === approveOption)) return null;
  }

  const preview = extractPlanPreview(typeof question.detail === 'string' ? question.detail : '');
  const titleText = preview.title || nonEmptyString(question.question);
  const eventId = String(frame.eventId);
  /** @type {PendingApprovalItem} */
  const item = {
    eventId,
    kind: 'plan-review',
    sessionId: String(frame.agentId),
    sessionTitle: null,
    title: makeLocalizedText(titleText, titleText ? undefined : { zh: '执行计划待审阅', en: 'Plan review' }),
    description: null,
    toolName: null,
    callId: intent.callId !== undefined && intent.callId !== null ? String(intent.callId) : null,
    commandPreview: null,
    planSummary: preview.summary,
    subject: null,
    requester: null,
    approveLabel: null,
    capabilities: { allowOnce: true, allowAlways: false, reject: false, requestChanges: true },
    receivedAt: ctx.now,
    connectionEpoch: ctx.connectionEpoch,
  };
  return { item, recipe: { kind: 'plan-review', eventId, questionId, approveOption } };
}

/**
 * @param {Record<string, any>} frame
 * @param {{ origin: string, connectionEpoch: number, now: number }} ctx
 * @returns {NormalizedApproval | null}
 */
function normalizeUserQuestion(frame, ctx) {
  const req = isRecord(frame.request) ? frame.request : null;
  if (!req || !Array.isArray(req.questions) || req.questions.length !== 1) return null;
  const question = req.questions[0];
  if (!isRecord(question) || question.multiSelect === true) return null;
  const intent = isRecord(question.intent) ? question.intent : null;
  if (!intent) return null;
  if (intent.kind === 'approval') return normalizePermissionApproval(frame, question, intent, ctx);
  if (intent.kind === 'plan-review') return normalizePlanReview(frame, question, intent, ctx);
  return null;
}

/**
 * @param {unknown} frame
 * @param {{ origin?: string, connectionEpoch?: number, now?: number }} [ctx]
 * @returns {NormalizedApproval | null}
 */
function normalizeWaterfallFrame(frame, ctx = {}) {
  if (!isRecord(frame) || frame.type !== 'waterfall') return null;
  if (!nonEmptyString(frame.eventId) || !nonEmptyString(frame.agentId)) return null;
  const fullCtx = {
    origin: typeof ctx.origin === 'string' ? ctx.origin : '',
    connectionEpoch: typeof ctx.connectionEpoch === 'number' ? ctx.connectionEpoch : 0,
    now: typeof ctx.now === 'number' ? ctx.now : Date.now(),
  };
  if (frame.event === 'approval/request') return normalizeToolApproval(frame, fullCtx);
  if (frame.event === 'user-questions/request') return normalizeUserQuestion(frame, fullCtx);
  return null;
}

/** @param {WireSettlementRecipe} recipe @param {ApprovalAction} action @returns {Record<string, unknown>} */
function buildSettlementOutcome(recipe, action) {
  if (recipe.kind === 'tool-approval') {
    if (action === 'allow-once') return { kind: 'result', value: 'allowed-once' };
    if (action === 'reject') return { kind: 'result', value: 'rejected' };
    throw new Error(`Unsupported action ${action} for tool-approval`);
  }
  if (recipe.kind === 'permission-approval') {
    if (action === 'allow-once') {
      return { kind: 'result', value: { answers: [{ id: recipe.questionId, selected: [recipe.approveOption] }] } };
    }
    if (action === 'allow-always' && recipe.alwaysOption) {
      return { kind: 'result', value: { answers: [{ id: recipe.questionId, selected: [recipe.alwaysOption] }] } };
    }
    if (action === 'reject') {
      return { kind: 'result', value: { answers: [{ id: recipe.questionId, selected: [recipe.rejectOption] }] } };
    }
    throw new Error(`Unsupported action ${action} for permission-approval`);
  }
  if (recipe.kind === 'plan-review') {
    if (action === 'allow-once') {
      return { kind: 'result', value: { answers: [{ id: recipe.questionId, selected: [recipe.approveOption] }] } };
    }
    if (action === 'request-changes') {
      return {
        kind: 'rejected',
        error: { name: 'UserQuestionError', code: 'ASK_CANCELLED', message: 'the user cancelled ask_user_question' },
      };
    }
    throw new Error(`Unsupported action ${action} for plan-review`);
  }
  throw new Error('Unknown settlement recipe kind');
}

/** @param {unknown} values @returns {string | null} */
function extractTitleFromProjectionValues(values) {
  if (!isRecord(values)) return null;
  const meta = isRecord(values.sessionListMetadata) ? values.sessionListMetadata : null;
  const pres = meta && isRecord(meta.presentation) ? meta.presentation : null;
  for (const candidate of [pres?.title, values.title, meta?.title]) {
    const text = nonEmptyString(candidate);
    if (text) return text;
  }
  return null;
}

/** @param {unknown} changes @returns {string | null} */
function extractTitleFromProjectionChanges(changes) {
  if (!Array.isArray(changes)) return null;
  for (const entry of changes) {
    if (!isRecord(entry)) continue;
    if (entry.key === 'title') {
      const text = nonEmptyString(entry.val);
      if (text) return text;
    }
    if (entry.key === 'sessionListMetadata' && isRecord(entry.val)) {
      const pres = isRecord(entry.val.presentation) ? entry.val.presentation : null;
      const text = nonEmptyString(pres?.title ?? entry.val.title);
      if (text) return text;
    }
  }
  return null;
}

/** @param {unknown} page @param {string} callId @param {string} toolName @returns {string | null} */
function findCommandInSessionEvents(page, callId, toolName) {
  if (!isRecord(page) || !Array.isArray(page.records)) return null;
  for (let i = page.records.length - 1; i >= 0; i -= 1) {
    const record = page.records[i];
    const event = isRecord(record) && isRecord(record.event) ? record.event : null;
    if (!event || event.type !== 'tool/call' || !isRecord(event.data)) continue;
    if (String(event.data.callId) !== callId) continue;
    return extractCommandPreview(nonEmptyString(event.data.name) || toolName, event.data.arguments);
  }
  return null;
}

/** @param {string} origin @returns {string} */
function muxUrlForOrigin(origin) {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/remote.mux';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * @param {object} [options]
 * @param {(info: { clientId: string, connectionEpoch: number }) => void} [options.onReady]
 * @param {(activeEpoch: number) => void} [options.onReconcileEpoch]
 * @param {(item: PendingApprovalItem) => void} [options.onApprovalUpsert]
 * @param {(eventId: string) => void} [options.onApprovalCancel]
 * @param {(eventId: string, commandPreview: string) => void} [options.onCommandPreview]
 * @param {(titles: Record<string, string>, meta: { replace: boolean }) => void} [options.onSessionTitles]
 * @param {(message: string) => void} [options.log]
 * @param {typeof WebSocket} [options.WebSocketImpl]
 * @param {typeof rpc} [options.rpcImpl]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.reconcileDelayMs]
 * @param {() => number} [options.nowImpl]
 */
function createApprovalWireClient(options = {}) {
  const WebSocketCtor = options.WebSocketImpl || WebSocket;
  const rpcImpl = options.rpcImpl || rpc;
  const baseFetch = options.fetchImpl || fetch;
  const reconcileDelayMs = options.reconcileDelayMs ?? DEFAULT_RECONCILE_DELAY_MS;
  const nowImpl = options.nowImpl || Date.now;
  const log = typeof options.log === 'function' ? options.log : () => {};

  /** @type {Map<string, WireSettlementRecipe & { connectionEpoch: number }>} */
  const recipes = new Map();
  /** @type {Map<string, AbortController>} */
  const enrichments = new Map();
  /** @type {Set<string>} */
  const knownSessionTitles = new Set();
  /** @type {Set<string>} */
  const inflightTitleFetches = new Set();

  let generation = 0;
  let connectionEpoch = 0;
  let reconnectAttempt = 0;
  let disposed = false;
  let activeOrigin = '';
  let activeCookie = '';
  let clientId = '';
  /** @type {WebSocket | null} */
  let socket = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconcileTimer = null;
  let streamSeq = 0;

  /** @param {string} eventId */
  function abortEnrichment(eventId) {
    const controller = enrichments.get(eventId);
    if (!controller) return;
    enrichments.delete(eventId);
    controller.abort();
  }

  function clearTimers() {
    if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (reconcileTimer !== null) { clearTimeout(reconcileTimer); reconcileTimer = null; }
  }

  function closeSocket() {
    const current = socket;
    socket = null;
    clientId = '';
    if (!current) return;
    try { current.terminate ? current.terminate() : current.close(); } catch { return; }
  }

  /** @param {string} origin @param {string} method @param {Record<string, unknown>} args @param {AbortSignal} [signal] */
  function callRpc(origin, method, args, signal) {
    /** @type {{ cookie?: string, signal?: AbortSignal }} */
    const rpcOptions = {};
    if (activeCookie) rpcOptions.cookie = activeCookie;
    if (signal) rpcOptions.signal = signal;
    return rpcImpl(origin, method, args, baseFetch, rpcOptions);
  }

  /** @param {PendingApprovalItem} item @param {number} gen */
  async function enrichToolCommand(item, gen) {
    if (!item.callId || !activeOrigin) return;
    abortEnrichment(item.eventId);
    const controller = new AbortController();
    enrichments.set(item.eventId, controller);
    try {
      const page = await callRpc(
        activeOrigin,
        'session/events',
        { request: { address: { kind: 'session', sessionId: item.sessionId }, maxMessages: 20 } },
        controller.signal,
      );
      if (gen !== generation || controller.signal.aborted || !recipes.has(item.eventId)) return;
      const preview = findCommandInSessionEvents(page, item.callId, item.toolName || '');
      if (preview) options.onCommandPreview?.(item.eventId, preview);
    } catch {
      return;
    } finally {
      if (enrichments.get(item.eventId) === controller) enrichments.delete(item.eventId);
    }
  }

  /** @param {string} sessionId @param {number} gen */
  async function fetchSessionTitle(sessionId, gen = generation) {
    if (!sessionId || !activeOrigin || knownSessionTitles.has(sessionId) || inflightTitleFetches.has(sessionId)) return;
    inflightTitleFetches.add(sessionId);
    try {
      const proj = await callRpc(activeOrigin, 'session/projections', { request: { sessionId } });
      if (gen !== generation || !isRecord(proj)) return;
      const title = extractTitleFromProjectionValues(proj.values);
      if (title) {
        knownSessionTitles.add(sessionId);
        options.onSessionTitles?.({ [sessionId]: title }, { replace: false });
      }
    } catch {
      return;
    } finally {
      inflightTitleFetches.delete(sessionId);
    }
  }

  /** @param {Record<string, any>} value @param {number} gen */
  function handleEventsItem(value, gen) {
    if (value.type === 'ready' && typeof value.clientId === 'string') {
      clientId = value.clientId;
      connectionEpoch += 1;
      const activeEpoch = connectionEpoch;
      options.onReady?.({ clientId, connectionEpoch: activeEpoch });
      if (reconcileTimer !== null) clearTimeout(reconcileTimer);
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null;
        if (gen !== generation || disposed) return;
        for (const [id, recipe] of recipes.entries()) {
          if (recipe.connectionEpoch < activeEpoch) {
            recipes.delete(id);
            abortEnrichment(id);
          }
        }
        options.onReconcileEpoch?.(activeEpoch);
      }, reconcileDelayMs);
      reconcileTimer.unref?.();
      return;
    }
    if (value.type === 'waterfall') {
      const normalized = normalizeWaterfallFrame(value, { origin: activeOrigin, connectionEpoch, now: nowImpl() });
      // Non-approval user-questions stay silent — never reply `{ kind: 'next' }`.
      if (!normalized) return;
      const { item, recipe } = normalized;
      recipes.set(item.eventId, { ...recipe, connectionEpoch });
      options.onApprovalUpsert?.(item);
      if (item.kind === 'tool-approval' && !item.commandPreview && item.callId) void enrichToolCommand(item, gen);
      if (!knownSessionTitles.has(item.sessionId)) void fetchSessionTitle(item.sessionId, gen);
      return;
    }
    if (value.type === 'cancel' && typeof value.eventId === 'string') {
      recipes.delete(value.eventId);
      abortEnrichment(value.eventId);
      options.onApprovalCancel?.(value.eventId);
    }
  }

  /** @param {Record<string, any>} value */
  function handleControlItem(value) {
    if (value.type === 'baseline' && isRecord(value.value) && isRecord(value.value.projections)) {
      /** @type {Record<string, string>} */
      const titles = {};
      knownSessionTitles.clear();
      for (const [sessionId, proj] of Object.entries(value.value.projections)) {
        const title = isRecord(proj) ? extractTitleFromProjectionValues(proj.values) : null;
        if (title) {
          titles[sessionId] = title;
          knownSessionTitles.add(sessionId);
        }
      }
      options.onSessionTitles?.(titles, { replace: true });
      return;
    }
    if (value.type === 'projection' && typeof value.sessionId === 'string') {
      const title = extractTitleFromProjectionChanges(value.changes);
      if (title) {
        knownSessionTitles.add(value.sessionId);
        options.onSessionTitles?.({ [value.sessionId]: title }, { replace: false });
      }
    }
  }

  /** @param {number} gen */
  function scheduleReconnect(gen) {
    if (disposed || gen !== generation || !activeOrigin || reconnectTimer !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!disposed && gen === generation && activeOrigin) openSocket(gen);
    }, delay);
    reconnectTimer.unref?.();
  }

  /** @param {number} gen */
  function openSocket(gen) {
    closeSocket();
    if (disposed || gen !== generation || !activeOrigin) return;
    /** @type {Record<string, string>} */
    const headers = { origin: activeOrigin };
    if (activeCookie) headers.cookie = activeCookie;

    let ws;
    try {
      ws = new WebSocketCtor(muxUrlForOrigin(activeOrigin), { headers });
    } catch (error) {
      log(`[approval-monitor] mux connect failed: ${error instanceof Error ? error.message : String(error)}`);
      scheduleReconnect(gen);
      return;
    }
    socket = ws;
    const eventsStreamId = `approval-events-${++streamSeq}`;
    const controlStreamId = `approval-control-${++streamSeq}`;

    ws.on('open', () => {
      if (gen !== generation || socket !== ws) return;
      reconnectAttempt = 0;
      try {
        ws.send(JSON.stringify({ type: 'open', streamId: eventsStreamId, endpoint: '$events', payload: { args: {} } }));
        ws.send(JSON.stringify({ type: 'open', streamId: controlStreamId, endpoint: 'session/control', payload: { args: {} } }));
      } catch (error) {
        log(`[approval-monitor] mux open frame failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    ws.on('message', (raw) => {
      if (gen !== generation || socket !== ws) return;
      let parsed;
      try { parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')); } catch { return; }
      if (!isRecord(parsed) || parsed.type !== 'item' || !isRecord(parsed.value)) return;
      if (parsed.streamId === eventsStreamId) handleEventsItem(parsed.value, gen);
      else if (parsed.streamId === controlStreamId) handleControlItem(parsed.value);
    });

    ws.on('error', (error) => {
      if (gen !== generation || socket !== ws) return;
      log(`[approval-monitor] mux error: ${error instanceof Error ? error.message : String(error)}`);
    });

    ws.on('close', () => {
      if (gen !== generation || socket !== ws) return;
      socket = null;
      clientId = '';
      if (reconcileTimer !== null) { clearTimeout(reconcileTimer); reconcileTimer = null; }
      scheduleReconnect(gen);
    });
  }

  function resetConnectionState() {
    clearTimers();
    for (const controller of enrichments.values()) controller.abort();
    enrichments.clear();
    closeSocket();
    recipes.clear();
    knownSessionTitles.clear();
    inflightTitleFetches.clear();
    reconnectAttempt = 0;
  }

  /** @param {string} origin @param {string} [cookie] */
  function connect(origin, cookie = '') {
    if (disposed) return;
    const nextOrigin = nonEmptyString(origin);
    const nextCookie = typeof cookie === 'string' ? cookie : '';
    if (!nextOrigin) { disconnect(); return; }
    if (nextOrigin === activeOrigin && constantTimeEqual(nextCookie, activeCookie) && socket) return;
    generation += 1;
    resetConnectionState();
    activeOrigin = nextOrigin;
    activeCookie = nextCookie;
    openSocket(generation);
  }

  function disconnect() {
    generation += 1;
    resetConnectionState();
    activeOrigin = '';
    activeCookie = '';
  }

  function dispose() {
    disposed = true;
    disconnect();
  }

  const SETTLE_TIMEOUT_MS = typeof options.settleTimeoutMs === 'number' ? options.settleTimeoutMs : 15_000;

  /** @param {string} eventId @param {ApprovalAction} action */
  async function settle(eventId, action) {
    const recipe = recipes.get(eventId);
    if (!recipe) throw new Error('Approval request is no longer pending');
    if (!activeOrigin || !clientId) throw new Error('Approval stream is not connected');
    const outcome = buildSettlementOutcome(recipe, action);
    const controller = new AbortController();
    let timer = null;
    try {
      // Gateway parseRemoteEventResultPayload accepts strictly these three keys.
      await Promise.race([
        callRpc(activeOrigin, '$events/result', { clientId, eventId, outcome }, controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const timeoutError = Object.assign(
              new Error(`Approval settle timed out after ${SETTLE_TIMEOUT_MS}ms`),
              { code: 'ETIMEDOUT' },
            );
            controller.abort(timeoutError);
            reject(timeoutError);
          }, SETTLE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    recipes.delete(eventId);
    abortEnrichment(eventId);
    return { ok: true };
  }

  return {
    connect,
    disconnect,
    dispose,
    settle,
    fetchSessionTitle: (/** @type {string} */ sessionId) => fetchSessionTitle(sessionId, generation),
    getClientId: () => clientId,
    hasRecipe: (/** @type {string} */ eventId) => recipes.has(eventId),
  };
}

module.exports = {
  sanitizeIconUrl,
  normalizeWaterfallFrame,
  buildSettlementOutcome,
  createApprovalWireClient,
};
