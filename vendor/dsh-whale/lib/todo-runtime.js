/**
 * Runtime helpers extracted from `todo-service.js` to keep each module focused
 * and well below complexity / max-lines budgets:
 * - Readonly-brief worker execution & settlement
 * - Session-event projection (approval/question/deliverables/turn-end)
 * - Crash recovery & non-destructive legacy whale_tasks migration
 */
import { eventText } from './shared.js';
import { isBusyCard, isTerminalCard, projectLegacyTaskToCard } from './task-card-schema.js';
import {
  RECURSIVE_DENY_TOOLS,
  deliverStructuredReceipt,
  drainSessionJobs,
  executeReadonlyBriefRun,
} from './task-session-runner.js';

/** @param {any[]} events */
export function lastAssistantText(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type === 'assistant/message' && eventText(ev).trim().length > 0) {
      return eventText(ev).trim().slice(0, 6000);
    }
  }
  return '';
}

/** @param {any[]} existing @param {any[]} incoming */
export function mergeDeliverables(existing, incoming) {
  const map = new Map();
  for (const item of existing ?? []) {
    map.set(`${item.sessionId}:${item.seq}:${item.index}:${item.path}`, item);
  }
  for (const item of incoming ?? []) {
    map.set(`${item.sessionId}:${item.seq}:${item.index}:${item.path}`, item);
  }
  return [...map.values()].slice(-50);
}

/** @param {string[]} list @param {string} kind @param {boolean} present */
export function updatePendingInput(list, kind, present) {
  const next = new Set(Array.isArray(list) ? list : []);
  if (present) next.add(kind);
  else next.delete(kind);
  return [...next];
}

/** @param {any} card @param {string} runId @param {Record<string, any>} patch */
export function patchRun(card, runId, patch) {
  if (!runId || !Array.isArray(card.runs) || !card.runs.length) return card.runs ?? [];
  return card.runs.map((run) => (run.runId === runId ? { ...run, ...patch } : run));
}

/** @param {any} input */
export function normalizeCardOrigin(input) {
  if (!input?.origin || typeof input.origin !== 'object') {
    return { kind: 'desktop', actor: 'desktop-owner', eventId: '' };
  }
  const allowedFiles = Array.isArray(input.origin.allowedFiles)
    ? input.origin.allowedFiles.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 20)
    : undefined;
  return {
    kind: input.origin.kind === 'im' ? 'im' : 'desktop',
    actor: String(input.origin.actor ?? 'desktop-owner'),
    eventId: String(input.origin.eventId ?? ''),
    ...(input.origin.route ? { route: input.origin.route } : {}),
    ...(allowedFiles?.length ? { allowedFiles } : {}),
  };
}

/**
 * Validate `dependsOn` references exist, contain no self-reference, and form no cycles.
 * @param {any} cardsTable
 * @param {string} id
 * @param {unknown} deps
 */
export function validateCardDependsOn(cardsTable, id, deps) {
  if (!Array.isArray(deps)) return [];
  const unique = [...new Set(deps.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
  if (unique.length > 20) throw new Error('前置依赖最多 20 项。');
  for (const depId of unique) {
    if (depId === id) throw new Error('任务不能依赖自身。');
    if (!cardsTable.get(depId)) throw new Error(`前置依赖任务不存在：${depId}`);
  }
  const visited = new Set();
  const stack = [...unique];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === id) throw new Error('前置依赖不能形成循环。');
    if (visited.has(cur)) continue;
    visited.add(cur);
    const row = cardsTable.get(cur);
    for (const nextDep of row?.dependsOn ?? []) stack.push(nextDep);
  }
  return unique;
}

function readLiveSessionSeq(ctx, sessionId) {
  const live = (ctx?.get?.('agents') ?? ctx?.agents)?.get?.(sessionId);
  const session = live?.session;
  if (!session) return null;
  if (Number.isInteger(session.seq) && session.seq >= 0) return session.seq;
  if (typeof session.snapshotEvents !== 'function') return null;
  const events = session.snapshotEvents();
  const last = events.at(-1);
  return Number.isInteger(last?.seq) ? last.seq + 1 : events.length;
}

async function readQuerySessionSeq(ctx, sessionId) {
  const querySvc = ctx?.get?.('sessionQuery');
  if (typeof querySvc?.observeSession !== 'function') return 0;
  let observation;
  try {
    observation = await querySvc.observeSession(sessionId, { projectionMode: 'none' });
    const last = observation?.events?.at?.(-1);
    if (Number.isInteger(last?.seq)) return last.seq + 1;
    if (Number.isInteger(observation?.cursor)) return observation.cursor + 1;
  } catch { /* Best-effort seq capture. */ }
  finally { observation?.[Symbol.dispose]?.(); }
  return 0;
}

/**
 * Capture the session's current next event seq before `continue()` sends a new
 * follow-up prompt so crash recovery never mistakes a previous run's `turn/end`
 * for the new run's completion.
 * @param {any} ctx
 * @param {string} sessionId
 */
export async function readCurrentSessionSeq(ctx, sessionId) {
  if (!sessionId) return 0;
  const liveSeq = readLiveSessionSeq(ctx, sessionId);
  if (liveSeq !== null) return liveSeq;
  return readQuerySessionSeq(ctx, sessionId);
}

function evaluateReadonlyOutcome(execution, inputs, terminal) {
  const report = execution.report;
  if (!report || terminal?.kind !== 'completed') {
    const nextState = terminal?.kind === 'aborted' ? 'cancelled' : 'failed';
    return {
      nextState,
      summary: '',
      errorMsg: nextState === 'failed' ? '只读资料整理未生成有效报告。' : '',
      evidence: [],
    };
  }
  const missing = inputs.filter((inp) => !execution.readIds.includes(inp.id) || !report.evidence.includes(inp.id));
  const unmet = [...(report.unmet ?? []), ...missing.map((inp) => `缺少资料 ${inp.name} 的读取与引用`)];
  const summary = String(report.summary ?? '').slice(0, 6000);
  const evidence = Array.isArray(report.evidence) ? report.evidence.map(String) : [];
  if (report.outcome === 'completed' && !unmet.length && summary.trim()) {
    return { nextState: 'review', summary, errorMsg: '', evidence };
  }
  if (report.outcome === 'needs_user') {
    return { nextState: 'waiting_input', summary, errorMsg: unmet.join('；').slice(0, 6000), evidence };
  }
  return {
    nextState: 'failed',
    summary,
    errorMsg: unmet.join('；').slice(0, 6000) || '资料报告缺少充分证据。',
    evidence,
  };
}

async function settleReadonlyDone(service, cardId, generation, worker, execution, inputs, terminal) {
  if (service.readonlyWorkers.get(cardId)?.worker === worker) {
    service.readonlyWorkers.delete(cardId);
  }
  const { nextState, summary, errorMsg, evidence } = evaluateReadonlyOutcome(execution, inputs, terminal);
  const settled = await service.serial(async () => {
    const current = service.cards.get(cardId);
    if (!current || current.generation !== generation || !isBusyCard(current)) return null;
    if (current.state === 'stopping') {
      return service.stops.has(cardId) ? null : service.put({ ...current, state: 'cancelled', phase: '', error: '' });
    }
    return service.put({
      ...current,
      state: nextState,
      phase: nextState === 'waiting_input' ? '等待补充信息' : '',
      pendingInput: nextState === 'waiting_input' ? ['question'] : [],
      summary: summary || current.summary,
      error: errorMsg,
      runs: patchRun(current, current.activeRunId, {
        state: nextState,
        endedAt: Date.now(),
        summary,
        error: errorMsg,
        evidence,
      }),
    });
  });
  if (settled && isTerminalCard(settled)) {
    await deliverStructuredReceipt(service.ctx, service.scope, settled, settled.runs.at(-1));
    void service.maybeAutoAdvance('readonly-settled');
  }
}

async function settleReadonlyFailure(service, cardId, generation, worker, err) {
  if (service.readonlyWorkers.get(cardId)?.worker === worker) {
    service.readonlyWorkers.delete(cardId);
  }
  const settled = await service.serial(async () => {
    const current = service.cards.get(cardId);
    if (!current || current.generation !== generation || !isBusyCard(current)) return null;
    const isStopping = current.state === 'stopping';
    const nextState = isStopping ? (service.stops.has(cardId) ? 'stopping' : 'cancelled') : 'failed';
    const msg = nextState === 'failed' ? String(err?.message ?? err).slice(0, 6000) : '';
    return service.put({
      ...current,
      state: nextState,
      phase: '',
      pendingInput: [],
      error: msg,
      runs: patchRun(current, current.activeRunId, { state: nextState, endedAt: Date.now(), error: msg }),
    });
  });
  if (settled && isTerminalCard(settled)) {
    await deliverStructuredReceipt(service.ctx, service.scope, settled, settled.runs.at(-1));
  }
}

export async function launchReadonlyBriefTask(service, admitted, controller, signal) {
  const generation = admitted.generation;
  const sessionId = `${admitted.id}-brief-r${generation}`;
  try {
    const selected = await service.resolveStartModel(controller, signal);
    service.assertStartingAlive(admitted.id, generation, signal);
    const runRecord = admitted.runs.at(-1);
    const activeCard = await service.serial(async () => {
      const current = service.get(admitted.id);
      if (current.generation !== generation || current.state !== 'starting') return null;
      return service.put({
        ...current,
        state: 'running',
        sessionId,
        phase: '正在受限只读分析资料…',
        runs: patchRun(current, current.activeRunId, { sessionId, state: 'running' }),
      });
    });
    if (!activeCard) return service.get(admitted.id);

    const assertCurrent = () => {
      const current = service.cards.get(admitted.id);
      if (service.closed || signal.aborted || !current || current.generation !== generation || !isBusyCard(current) || current.state === 'stopping') {
        throw new Error('任务不再获准执行。');
      }
    };

    const { worker, inputs, execution } = await executeReadonlyBriefRun({
      ctx: service.ctx,
      home: service.home,
      card: activeCard,
      run: { ...runRecord, sessionId },
      selectedModel: selected,
      startWorker: service.startReadonlyWorker,
      assertCurrent,
    });
    service.readonlyWorkers.set(admitted.id, { worker, generation });
    void worker.done
      .then((terminal) => settleReadonlyDone(service, admitted.id, generation, worker, execution, inputs, terminal))
      .catch((err) => settleReadonlyFailure(service, admitted.id, generation, worker, err));
    return service.get(admitted.id);
  } catch (/** @type {any} */ error) {
    await service.serial(async () => {
      const current = service.cards.get(admitted.id);
      if (!current || current.generation !== generation || !['starting', 'running'].includes(current.state)) return;
      const msg = String(error?.message ?? error).slice(0, 6000);
      await service.put({
        ...current,
        state: 'failed',
        phase: '',
        error: msg,
        runs: patchRun(current, current.activeRunId, { state: 'failed', endedAt: Date.now(), error: msg }),
      });
    });
    throw error;
  }
}

function extractDeliverablesFromEvent(sessionId, event) {
  const files = Array.isArray(event.data?.files) ? event.data.files : [];
  const seq = Number(event.seq) || 0;
  return files.map((file, index) => ({
    path: String(file?.path ?? ''),
    description: String(file?.description ?? '').slice(0, 500),
    seq,
    index,
    sessionId,
  })).filter((entry) => entry.path);
}

function buildPendingTransitionPatch(current, kind, asked, event) {
  const pendingInput = updatePendingInput(current.pendingInput, kind, asked);
  if (asked) {
    const toolName = kind === 'approval' ? String(event.data?.toolName ?? '').trim() : '';
    return {
      state: kind === 'approval' ? 'waiting_approval' : 'waiting_input',
      pendingInput,
      phase: kind === 'approval' ? (toolName ? `等待审批：${toolName}` : '等待审批') : '等待你的回答',
    };
  }
  const other = kind === 'approval' ? 'question' : 'approval';
  const nextState = pendingInput.includes(other)
    ? (other === 'approval' ? 'waiting_approval' : 'waiting_input')
    : 'running';
  const phase = nextState === 'waiting_approval'
    ? '等待审批'
    : nextState === 'waiting_input' ? '等待你的回答' : '执行中…';
  return { state: nextState, pendingInput, phase };
}

async function handleNonStoppingLiveEvent(service, current, event) {
  if (event.type === 'tool/call') {
    if (current.state === 'waiting_approval' || current.state === 'waiting_input') return;
    const name = String((event.data && event.data.name) || '').trim();
    if (name) await service.put({ ...current, phase: `调用工具 ${name}` });
    return;
  }
  if (event.type === 'approval/asked' || event.type === 'approval/decided') {
    await service.put({ ...current, ...buildPendingTransitionPatch(current, 'approval', event.type === 'approval/asked', event) });
    return;
  }
  if (event.type === 'user-questions/asked' || event.type === 'user-questions/answered') {
    await service.put({ ...current, ...buildPendingTransitionPatch(current, 'question', event.type === 'user-questions/asked', event) });
  }
}

export async function applyCardSessionEvent(service, cardId, session, event) {
  if (service.closed) return;
  const current = service.cards.get(cardId);
  if (!current || !isBusyCard(current) || current.sessionId !== session.id || current.legacyTaskId) return;

  if (event.type === 'assistant/message') {
    const summary = eventText(event).trim();
    if (summary) await service.put({ ...current, summary: summary.slice(0, 6000) });
    return;
  }
  if (event.type === 'turn/start' && (current.state === 'starting' || current.state === 'running')) {
    await service.put({ ...current, state: 'running', phase: '思考中…' });
    return;
  }
  if (event.type === 'deliverables/presented') {
    const incoming = extractDeliverablesFromEvent(session.id, event);
    if (!incoming.length) return;
    const deliverables = mergeDeliverables(current.deliverables, incoming);
    await service.put({ ...current, deliverables, runs: patchRun(current, current.activeRunId, { deliverables }) });
    return;
  }
  if (event.type === 'turn/end') {
    const settled = await service.applyTurnEnd(cardId, current, event);
    if (settled && isTerminalCard(settled)) {
      void deliverStructuredReceipt(service.ctx, service.scope, settled, settled.runs.at(-1))
        .catch((err) => service.ctx.logger?.warn?.(`whale todos receipt failed: ${err?.message ?? err}`));
      void service.maybeAutoAdvance('turn-end');
    }
    return;
  }
  if (current.state !== 'stopping') await handleNonStoppingLiveEvent(service, current, event);
}

function resolveRecoveredTurnOutcome(scopedEvents, baseSeq) {
  const end = scopedEvents.findLast((value) => value.type === 'turn/end');
  const start = scopedEvents.findLast((value) => value.type === 'turn/start');
  const validTurn = baseSeq > 0
    ? Boolean(end && start && end.seq > start.seq)
    : Boolean(end && (!start || end.seq > start.seq));
  if (!validTurn) return null;
  const kind = end.data?.reason?.kind;
  const state = kind === 'completed' ? 'review' : kind === 'aborted' ? 'cancelled' : 'failed';
  return { state, error: state === 'failed' ? '执行未完成，请查看关联对话。' : '' };
}

function inspectRecoveredEvents(card, events, wasStopping) {
  let state = wasStopping ? 'cancelled' : 'interrupted';
  let error = wasStopping ? '' : '应用曾中断；检查关联对话后重新打开任务，不会自动重发。';
  const activeRun = Array.isArray(card.runs) ? card.runs.find((r) => r.runId === card.activeRunId) : null;
  const baseSeq = Number(activeRun?.baseSeq) || 0;
  const scopedEvents = baseSeq > 0 ? events.filter((ev) => Number(ev?.seq ?? 0) >= baseSeq) : events;
  const summary = lastAssistantText(scopedEvents) || card.summary;
  const presented = scopedEvents
    .filter((ev) => ev?.type === 'deliverables/presented')
    .flatMap((ev) => extractDeliverablesFromEvent(card.sessionId, ev));
  const deliverables = presented.length ? mergeDeliverables(card.deliverables ?? [], presented) : (card.deliverables ?? []);
  if (!wasStopping) {
    const turn = resolveRecoveredTurnOutcome(scopedEvents, baseSeq);
    if (turn) ({ state, error } = turn);
  }
  return { state, summary, error, deliverables };
}

export async function recoverManagedCard(service, card) {
  const wasStopping = card.state === 'stopping';
  let recovered = {
    state: wasStopping ? 'cancelled' : 'interrupted',
    summary: card.summary,
    error: wasStopping ? '' : '应用曾中断；检查关联对话后重新打开任务，不会自动重发。',
    deliverables: card.deliverables ?? [],
  };
  const querySvc = card.sessionId ? service.ctx.get?.('sessionQuery') : null;
  if (querySvc) {
    let observation;
    try {
      observation = await querySvc.observeSession(card.sessionId);
      recovered = inspectRecoveredEvents(card, observation.events, wasStopping);
    } catch (/** @type {any} */ failure) {
      if (!wasStopping) recovered.error = `恢复读取失败：${failure.message}`.slice(0, 6000);
    } finally {
      observation?.[Symbol.dispose]?.();
    }
  }
  await service.put({
    ...card,
    state: recovered.state,
    phase: recovered.state === 'review' ? '待验收' : '',
    pendingInput: [],
    summary: recovered.summary,
    deliverables: recovered.deliverables,
    error: recovered.error,
    runs: patchRun(card, card.activeRunId, {
      state: recovered.state,
      endedAt: Date.now(),
      summary: recovered.summary,
      error: recovered.error,
      deliverables: recovered.deliverables,
    }),
  });
}

export async function importLegacyTasksIntoTodos(service) {
  if (service.closed) return 0;
  const legacySvc = service.ctx?.get?.('whaleTasks');
  const legacyList = legacySvc?.available && typeof legacySvc.list === 'function' ? legacySvc.list() : [];
  if (!legacyList.length) return 0;
  let synced = 0;
  for (const legacy of legacyList) {
    if (!legacy?.id) continue;
    try {
      const projected = projectLegacyTaskToCard(legacy, { home: service.home, settings: service.scope?.get?.() });
      await service.serial(async () => {
        if (service.closed) return;
        const existing = service.cards.get(projected.id);
        if (!existing) {
          await service.put(projected);
          synced += 1;
          return;
        }
        const changed = existing.state !== projected.state
          || existing.summary !== projected.summary
          || existing.error !== projected.error
          || existing.sessionId !== projected.sessionId
          || existing.generation !== projected.generation
          || existing.effects.length !== projected.effects.length;
        if (!changed) return;
        await service.put({
          ...projected,
          pinned: existing.pinned,
          archived: existing.archived,
        });
        synced += 1;
      });
    } catch (error) {
      service.ctx.logger?.warn?.(`whale todos legacy import skipped (${legacy.id}): ${error?.message ?? error}`);
    }
  }
  return synced;
}

async function markCardCancelled(service, id) {
  return service.serial(async () => {
    const cur = service.get(id);
    return service.put({
      ...cur,
      state: 'cancelled',
      phase: '',
      pendingInput: [],
      error: '',
      runs: patchRun(cur, cur.activeRunId, { state: 'cancelled', endedAt: Date.now(), error: '' }),
    });
  });
}

export async function stopManagedCard(service, id) {
  const card = await service.serial(async () => {
    if (service.closed) throw new Error('任务服务已停止。');
    const value = service.get(id);
    if (!isBusyCard(value)) {
      return service.put({ ...value, state: 'cancelled', phase: '', pendingInput: [], error: '' });
    }
    return service.put({ ...value, state: 'stopping', phase: '正在停止…', pendingInput: [] });
  });
  if (card.state !== 'stopping') return card;

  service.disposeDelegation(id);
  const inFlight = service.starts.get(id);
  if (inFlight) {
    inFlight.abort.abort(new Error('用户已停止任务。'));
    await inFlight.promise.catch(() => { /* Absorbed by explicit stop. */ });
  }
  const ro = service.readonlyWorkers.get(id);
  if (ro) {
    ro.worker.cancel();
    await ro.worker.done.catch(() => { /* Worker abort rejection is expected during explicit stop. */ });
    service.readonlyWorkers.delete(id);
    return markCardCancelled(service, id);
  }
  const latest = service.get(id);
  if (!latest.sessionId) return markCardCancelled(service, id);
  try {
    await drainSessionJobs(service.ctx, latest.sessionId);
    const resolved = await service.ctx.sessionController.resolveAgent(latest.sessionId);
    if (resolved.error) throw resolved.error;
    resolved.agent.cancel({ kind: 'user' }, { keepInbox: false });
    await resolved.agent.whenIdle();
    await drainSessionJobs(service.ctx, latest.sessionId);
    return markCardCancelled(service, id);
  } catch (/** @type {any} */ error) {
    await service.serial(async () => {
      const current = service.get(id);
      if (isBusyCard(current)) {
        await service.put({
          ...current,
          state: 'stopping',
          phase: '停止未确认',
          error: `停止未确认，请重试或检查关联对话：${error.message}`.slice(0, 6000),
        });
      }
    });
    throw error;
  }
}

export async function closeWhaleTodosService(service) {
  service.closed = true;
  service.closeController.abort(new Error('任务服务已停止。'));
  for (const id of [...service.delegationDisposers.keys()]) service.disposeDelegation(id);
  for (const ro of service.readonlyWorkers.values()) {
    try { ro.worker.cancel(); } catch { /* Best-effort cancel. */ }
  }
  await Promise.allSettled([...service.starts.values()].map((entry) => entry.promise));
  await service.chain;
  await Promise.allSettled([...service.stops.values()]);
  try {
    const results = await Promise.allSettled(service.list().filter((item) => isBusyCard(item)).map(async (card) => {
      const wasStopping = card.state === 'stopping';
      if (card.sessionId && card.mode === 'workspace-task') {
        await drainSessionJobs(service.ctx, card.sessionId);
        const resolved = await service.ctx.sessionController.resolveAgent(card.sessionId);
        if (resolved.error) throw resolved.error;
        resolved.agent.cancel({ kind: 'user' }, { keepInbox: false });
        await resolved.agent.whenIdle();
      }
      const current = service.get(card.id);
      const cancelled = wasStopping || current.state === 'stopping';
      await service.put({
        ...current,
        state: cancelled ? 'cancelled' : 'interrupted',
        phase: '',
        pendingInput: [],
        error: cancelled ? '' : '应用已停止，检查关联对话后可重新打开任务。',
      });
    }));
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, '任务停止未全部确认');
  } finally {
    for (const handle of service.directHandles.values()) {
      try { await handle?.dispose?.(); } catch { /* Ignore dispose errors on shutdown. */ }
    }
    service.directHandles.clear();
    await service.domain.close();
  }
}

export async function runAutoAdvance(service) {
  if (service.closed || !service.autoAdvanceEnabled()) return null;
  if (service.autoAdvanceInFlight) return service.autoAdvanceInFlight;
  const run = (async () => {
    try { service.assertAdmissionOpen(); } catch { return null; }
    const next = await service.serial(() => {
      if (service.closed || !service.autoAdvanceEnabled()) return null;
      const cards = service.list();
      if (cards.some((card) => isBusyCard(card))) return null;
      return cards
        .filter((card) => card.state === 'pending' && !card.archived && service.unmetDependencies(card).length === 0)
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.createdAt - b.createdAt)[0] ?? null;
    });
    if (!next) return null;
    try {
      return await service.start(next.id, { onlyWhenIdle: true });
    } catch (error) {
      service.ctx.logger?.warn?.(`whale todos auto-advance failed for ${next.id}: ${error?.message ?? error}`);
      return null;
    }
  })();
  service.autoAdvanceInFlight = run;
  try { return await run; } finally { if (service.autoAdvanceInFlight === run) service.autoAdvanceInFlight = null; }
}

export function installTodoRecursiveGuard(ctx, service) {
  if (typeof ctx.tools?.guard !== 'function') return;
  ctx.tools.guard((exec) => {
    const sid = exec?.agent?.id;
    if (!sid) return;
    const isTaskSession = service.activeBySession.has(sid)
      || /^session-whale-todo-/u.test(sid)
      || service.list().some((card) => card.sessionId === sid);
    if (isTaskSession && RECURSIVE_DENY_TOOLS.has(exec.name)) {
      return '受管任务子会话默认禁止递归派发新任务或子代理；请直接完成当前任务并汇报。';
    }
  });
}
