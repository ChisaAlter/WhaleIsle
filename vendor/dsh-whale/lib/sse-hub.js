/**
 * Real-time SSE hub for Big Fish Workbench (`/dsh-whale/events`).
 * Eliminates 3s polling in `WhaleTodosView`, projects authoritative Host
 * `rootTurn` / `pendingInput` state, and supports full snapshot reconciliation
 * after any disconnect/reconnect (never treating SSE close as task termination).
 */
import { isBusyCard, needsUserAttention } from './task-card-schema.js';

const HEARTBEAT_MS = 20_000;
const RELEVANT_SESSION_EVENTS = new Set([
  'turn/start',
  'turn/end',
  'tool/call',
  'approval/asked',
  'approval/decided',
  'user-questions/asked',
  'user-questions/answered',
  'deliverables/presented',
]);

function readRootTurn(ctx, session) {
  const projections = ctx?.get?.('sessionProjections');
  if (typeof projections?.stateOf !== 'function' || !session) return null;
  try {
    const tb = projections.stateOf(session, 'turnBoundary');
    if (!tb) return null;
    return {
      open: tb.openTurnStartSeq !== null && tb.openTurnStartSeq !== undefined,
      turn: tb.lastTurn ?? null,
      stepSeq: tb.lastStepStartSeq ?? null,
    };
  } catch {
    return null;
  }
}

function gatewayEventKind(eventName) {
  if (eventName === 'approval/request') return 'approval';
  if (eventName === 'user-questions/request') return 'question';
  return 'other';
}

function collectGatewayPendingInputs(ctx, sid, pending) {
  const gateway = ctx?.get?.('typertGateway');
  if (!sid || typeof gateway?.getPendingRemoteEvents !== 'function') return;
  try {
    for (const entry of gateway.getPendingRemoteEvents() ?? []) {
      if (String(entry?.agentId ?? '') === sid) pending.add(gatewayEventKind(entry?.event));
    }
  } catch { /* Optional gateway inspection. */ }
}

function readLivePendingInputs(ctx, session, sessionId = '') {
  const pending = new Set();
  if (session) {
    for (const [serviceName, kind] of [['approval', 'approval'], ['userQuestions', 'question']]) {
      const svc = ctx?.get?.(serviceName);
      if (typeof svc?.pending !== 'function') continue;
      try {
        const rows = svc.pending(session);
        if (Array.isArray(rows) && rows.length > 0) pending.add(kind);
      } catch { /* Optional service inspection. */ }
    }
  }
  collectGatewayPendingInputs(ctx, String(session?.id ?? sessionId ?? ''), pending);
  return [...pending];
}

/**
 * Inspect authoritative live status (`running`, `rootTurn`, `pendingInput`)
 * for a single session from Host services without mutating or hydrating it.
 * @param {any} ctx
 * @param {string} sessionId
 */
export function readAuthoritativeSessionState(ctx, sessionId) {
  if (!sessionId) return { active: false, running: false, rootTurn: null, pendingInput: [] };
  const agentsSvc = ctx?.get?.('agents') ?? ctx?.agents;
  const agent = agentsSvc?.get?.(sessionId);
  if (!agent) {
    const gatewayPending = readLivePendingInputs(ctx, null, sessionId);
    return { active: false, running: false, rootTurn: null, pendingInput: gatewayPending };
  }
  const rootTurn = readRootTurn(ctx, agent.session);
  const pendingInput = readLivePendingInputs(ctx, agent.session, sessionId);
  return {
    active: true,
    running: agent.status === 'running' || rootTurn?.open === true,
    rootTurn,
    pendingInput,
  };
}

function projectCardLiveState(ctx, card, { residentSessionId = '', delegated = false } = {}) {
  if (!card.sessionId || !isBusyCard(card)) return card;
  const live = readAuthoritativeSessionState(ctx, card.sessionId);
  const mergedPending = [...new Set([...(card.pendingInput ?? []), ...live.pendingInput])];
  let projectedState = card.state;
  if (card.state !== 'stopping') {
    if (mergedPending.includes('approval')) projectedState = 'waiting_approval';
    else if (mergedPending.includes('question')) projectedState = 'waiting_input';
  }
  const delegatedApproval = Boolean(delegated && residentSessionId);
  const actionSessionId = projectedState === 'waiting_approval' && delegatedApproval
    ? residentSessionId
    : card.sessionId;
  return {
    ...card,
    state: projectedState,
    pendingInput: mergedPending,
    rootTurn: live.rootTurn,
    delegatedApproval,
    actionSessionId,
  };
}

function collectNeedsYouEntries(settings, residentSessionId, resident, cards) {
  const needsYou = [];
  const hasDelegatedCardApproval = cards.some(
    (card) => card.state === 'waiting_approval' && card.delegatedApproval && card.actionSessionId === residentSessionId,
  );
  const residentOwnPending = hasDelegatedCardApproval
    ? resident.pendingInput.filter((kind) => kind !== 'approval')
    : resident.pendingInput;
  if (residentOwnPending.length > 0 && residentSessionId) {
    const waitingApproval = residentOwnPending.includes('approval');
    needsYou.push({
      kind: 'resident',
      cardId: '',
      title: String(settings.name || '鲸鱼娘'),
      sessionId: residentSessionId,
      actionSessionId: residentSessionId,
      state: waitingApproval ? 'waiting_approval' : 'waiting_input',
      pendingInput: residentOwnPending,
      phase: waitingApproval ? '主对话等待审批' : '主对话等待回答',
    });
  }
  for (const card of cards) {
    if (!needsUserAttention(card)) continue;
    needsYou.push({
      kind: 'card',
      cardId: card.id,
      title: card.title,
      sessionId: card.sessionId,
      actionSessionId: card.actionSessionId || card.sessionId,
      delegatedApproval: Boolean(card.delegatedApproval),
      state: card.state,
      pendingInput: card.pendingInput ?? [],
      phase: card.phase || (card.state === 'waiting_approval' ? '等待审批' : '等待回答'),
    });
  }
  return needsYou;
}

/**
 * Build the authoritative Big Fish workbench snapshot: unified task cards,
 * auto-advance setting, resident session live status, and unified `needsYou`
 * badge list across both the resident session and all managed task cards.
 * @param {any} ctx
 * @param {any} scope
 */
export function buildWorkbenchSnapshot(ctx, scope) {
  const settings = scope?.get?.() ?? {};
  const residentSessionId = String(settings.sessionId ?? '').trim();
  const todos = ctx?.get?.('whaleTodos');
  const rawCards = todos?.available && typeof todos.list === 'function' ? todos.list() : [];
  const cards = rawCards.map((card) => projectCardLiveState(ctx, card, {
    residentSessionId,
    delegated: Boolean(todos?.delegationDisposers?.has?.(card.id)),
  }));
  const resident = readAuthoritativeSessionState(ctx, residentSessionId);
  const needsYou = collectNeedsYouEntries(settings, residentSessionId, resident, cards);
  return {
    at: Date.now(),
    available: Boolean(todos?.available),
    autoAdvance: todos?.available && typeof todos.autoAdvanceEnabled === 'function'
      ? todos.autoAdvanceEnabled()
      : settings.autoAdvance === true,
    residentSessionId,
    resident,
    cards,
    needsYou,
    activeCount: cards.filter((card) => isBusyCard(card)).length,
  };
}

/**
 * Create an SSE hub bound to a whale host context and settings scope.
 * @param {any} ctx
 * @param {any} scope
 */
export function createWhaleSseHub(ctx, scope) {
  /** @type {Set<any>} */
  const clients = new Set();
  let seq = 0;
  let unsubTodos = null;
  let boundTodoService = null;

  function formatFrame(eventName, data) {
    seq += 1;
    return `id: ${seq}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function broadcast(eventName, payload) {
    if (clients.size === 0) return;
    const frame = formatFrame(eventName, payload);
    for (const res of [...clients]) {
      try {
        if (res.writableEnded || res.destroyed) {
          clients.delete(res);
          continue;
        }
        res.write(frame);
      } catch {
        clients.delete(res);
      }
    }
  }

  function pushSnapshot(reason = 'update') {
    if (clients.size === 0) return;
    const snap = buildWorkbenchSnapshot(ctx, scope);
    broadcast('snapshot', { ...snap, reason });
  }

  function attachTodoSubscription() {
    const todos = ctx?.get?.('whaleTodos');
    if (todos === boundTodoService) return;
    try { unsubTodos?.(); } catch { /* Ignore. */ }
    unsubTodos = null;
    boundTodoService = todos;
    if (todos && typeof todos.subscribe === 'function') {
      unsubTodos = todos.subscribe((change) => {
        pushSnapshot(change?.kind || 'todo-change');
      });
    }
  }

  const offService = typeof ctx?.on === 'function'
    ? ctx.on('internal/service', (serviceName) => {
        if (serviceName === 'whaleTodos') {
          attachTodoSubscription();
          pushSnapshot('service-ready');
        }
      })
    : null;

  const offSession = typeof ctx?.on === 'function'
    ? ctx.on('session/event', (session, event) => {
        if (clients.size === 0 || !RELEVANT_SESSION_EVENTS.has(event?.type)) return;
        const sid = String(session?.id ?? '');
        const residentId = String(scope?.get?.()?.sessionId ?? '');
        const todos = ctx?.get?.('whaleTodos');
        if (sid === residentId || todos?.activeBySession?.has?.(sid)) {
          pushSnapshot(`session:${event.type}`);
        }
      }, { global: true })
    : null;

  const heartbeat = setInterval(() => {
    for (const res of [...clients]) {
      try {
        if (res.writableEnded || res.destroyed) clients.delete(res);
        else res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clients.delete(res);
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  function handleStream(req, res) {
    attachTodoSubscription();
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders?.();
    clients.add(res);
    try {
      const snap = buildWorkbenchSnapshot(ctx, scope);
      res.write(formatFrame('snapshot', { ...snap, reason: 'connect' }));
    } catch {
      clients.delete(res);
      res.end();
      return;
    }
    const cleanup = () => { clients.delete(res); };
    req.on?.('close', cleanup);
    res.on?.('close', cleanup);
  }

  function close() {
    clearInterval(heartbeat);
    try { unsubTodos?.(); } catch { /* Ignore. */ }
    try { offService?.(); } catch { /* Ignore. */ }
    try { offSession?.(); } catch { /* Ignore. */ }
    for (const res of [...clients]) {
      try { res.end(); } catch { /* Ignore. */ }
    }
    clients.clear();
  }

  return { handleStream, pushSnapshot, close, clientCount: () => clients.size };
}
