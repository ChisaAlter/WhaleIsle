/**
 * Unified managed task engine (TaskCard -> Attempt/Run -> Session).
 * Runs workspace tasks in isolated ordinary sessions (never in subagent/catalog
 * and never the resident assistant) and readonly-brief tasks in restricted
 * `whale-task-reader` workers.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  beginDesktopAdmission,
  createSerialQueue,
} from '../../dsh-shared/lib/managed-task-runtime.mjs';
import { ensureSafeTaskDir, resolvedTaskRootDir, validateTaskCwd, within } from './task-paths.js';
import {
  todoSchema,
  todoDomain,
  isBusyCard,
  isTerminalCard,
  needsUserAttention,
  resolveCardCwd,
} from './task-card-schema.js';
import {
  bindTaskDelegatedApproval,
  createWorkspaceTaskSession,
  drainSessionJobs,
} from './task-session-runner.js';
import {
  applyCardSessionEvent,
  closeWhaleTodosService,
  importLegacyTasksIntoTodos,
  installTodoRecursiveGuard,
  launchReadonlyBriefTask,
  normalizeCardOrigin,
  patchRun,
  readCurrentSessionSeq,
  recoverManagedCard,
  runAutoAdvance,
  stopManagedCard,
  validateCardDependsOn,
} from './todo-runtime.js';

export { todoSchema, todoDomain };

const WATCHED_EVENTS = new Set([
  'assistant/message',
  'turn/start',
  'turn/end',
  'tool/call',
  'approval/asked',
  'approval/decided',
  'user-questions/asked',
  'user-questions/answered',
  'deliverables/presented',
]);
const START_RPC_TIMEOUT_MS = 30_000;

/** @param {any} card */
function taskPromptText(card) {
  return [
    '请执行这项用户明确交给你的任务。',
    `任务：${card.title}`,
    `说明：${card.description || '无补充说明'}`,
    `完成条件：${card.criteria || '给出可检查的结果，说明未完成项。'}`,
    '结束时汇报成果、验证与未完成项；如有面向用户的产出文件，用 present 交付；不要把回合结束当成任务已经验收。',
  ].join('\n');
}

/** @param {any} settings */
function modelFromSettings(settings) {
  if (!settings?.modelProvider || !settings?.modelModel) return null;
  return {
    provider: settings.modelProvider,
    model: settings.modelModel,
    ...(settings.modelReasoningEffort ? { reasoningEffort: settings.modelReasoningEffort } : {}),
  };
}

export class WhaleTodos {
  constructor(ctx, domain, { home, scope, startReadonlyWorker } = {}) {
    this.ctx = ctx;
    this.domain = domain;
    this.cards = domain.table('cards');
    this.home = home;
    this.scope = scope;
    this.startReadonlyWorker = startReadonlyWorker;
    this.serialQueue = createSerialQueue();
    this.closed = false;
    this.available = true;
    this.stops = new Map();
    this.starts = new Map();
    this.readonlyWorkers = new Map();
    this.delegationDisposers = new Map();
    this.directHandles = new Map();
    this.listeners = new Set();
    this.localAutoAdvance = null;
    this.autoAdvanceInFlight = null;
    this.closeController = new AbortController();
    this.activeBySession = new Map();
    for (const [, card] of this.cards.entries()) {
      if (isBusyCard(card) && card.sessionId) this.activeBySession.set(card.sessionId, card.id);
    }
  }

  get chain() {
    return this.serialQueue.tail;
  }

  serial(fn) {
    return this.serialQueue.run(fn);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emitChange(kind, payload = {}) {
    const detail = { kind, at: Date.now(), ...payload };
    for (const listener of [...this.listeners]) {
      try { listener(detail); } catch { /* Listener isolation. */ }
    }
  }

  list() {
    return [...this.cards.entries()].map(([, card]) => structuredClone(card));
  }

  get(id) {
    const card = this.cards.get(id);
    if (!card) throw new Error('找不到任务卡。');
    return structuredClone(card);
  }

  autoAdvanceEnabled() {
    if (typeof this.localAutoAdvance === 'boolean') return this.localAutoAdvance;
    return this.scope?.get?.()?.autoAdvance === true;
  }

  async setAutoAdvance(enabled) {
    const nextValue = enabled === true;
    this.localAutoAdvance = nextValue;
    try {
      const before = this.scope?.get?.();
      if (before && typeof this.scope?.set === 'function') {
        await this.scope.set({ ...before, autoAdvance: nextValue }, before);
      }
    } catch { /* Scope may be read-only in minimal tests. */ }
    this.emitChange('auto-advance', { autoAdvance: nextValue });
    if (nextValue) void this.maybeAutoAdvance('toggle');
    return { autoAdvance: nextValue };
  }

  /** Host task-control inspection covering all active non-terminal states. */
  inspect() {
    return this.list()
      .filter((card) => isBusyCard(card))
      .map((card) => ({
        kind: 'whale-todo',
        id: card.id,
        sessionId: card.sessionId || '',
        mode: card.mode,
        detail: card.state,
      }));
  }

  snapshot() {
    const cards = this.list();
    const needsYou = cards
      .filter((card) => needsUserAttention(card))
      .map((card) => ({
        cardId: card.id,
        title: card.title,
        sessionId: card.sessionId,
        state: card.state,
        pendingInput: card.pendingInput,
        phase: card.phase,
      }));
    return {
      cards,
      autoAdvance: this.autoAdvanceEnabled(),
      needsYou,
      activeCount: cards.filter((card) => isBusyCard(card)).length,
    };
  }

  /** @param {AbortSignal | null | undefined} [extraSignal] */
  rpcSignal(extraSignal) {
    const signals = [this.closeController.signal, AbortSignal.timeout(START_RPC_TIMEOUT_MS)];
    if (extraSignal) signals.push(extraSignal);
    return typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0];
  }

  /** @param {any} previous @param {any} next */
  syncIndex(previous, next) {
    if (previous?.sessionId && (previous.sessionId !== next?.sessionId || !next || !isBusyCard(next))) {
      if (this.activeBySession.get(previous.sessionId) === previous.id) {
        this.activeBySession.delete(previous.sessionId);
      }
    }
    if (next && isBusyCard(next) && next.sessionId && !next.legacyTaskId) {
      this.activeBySession.set(next.sessionId, next.id);
    }
  }

  async put(card) {
    const previous = this.cards.get(card.id);
    const next = todoSchema.parse({ ...card, updatedAt: Date.now() });
    await this.cards.put(next.id, next);
    this.syncIndex(previous, next);
    this.emitChange('card', { card: structuredClone(next) });
    return next;
  }

  /** @param {string} id */
  disposeDelegation(id) {
    const dispose = this.delegationDisposers.get(id);
    if (dispose) {
      this.delegationDisposers.delete(id);
      try { dispose(); } catch { /* Best-effort cleanup. */ }
    }
  }

  /** @param {string} id @param {string} sessionId @param {number} generation */
  isDelegationValid(id, sessionId, generation) {
    if (this.closed) return false;
    const current = this.cards.get(id);
    return Boolean(
      current
      && isBusyCard(current)
      && current.state !== 'stopping'
      && current.sessionId === sessionId
      && current.generation === generation,
    );
  }

  /** @param {string} id @param {string[]} deps */
  validateDependsOn(id, deps) {
    return validateCardDependsOn(this.cards, id, deps);
  }

  /** @param {any} card */
  unmetDependencies(card) {
    const deps = Array.isArray(card?.dependsOn) ? card.dependsOn : [];
    const unmet = [];
    for (const depId of deps) {
      const dep = this.cards.get(depId);
      if (!dep || dep.state !== 'completed') {
        unmet.push(dep ? `${dep.title} (${dep.state})` : depId);
      }
    }
    return unmet;
  }

  assertAdmissionOpen() {
    const lease = beginDesktopAdmission(this.ctx, 'whale-todos-check', {
      lockedMessage: '桌面任务准入已锁定，暂不启动新任务。',
    });
    lease.release();
  }

  async create(input) {
    return this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      const now = Date.now();
      const id = `todo-${crypto.randomUUID()}`;
      const mode = input?.mode === 'readonly-brief' ? 'readonly-brief' : 'workspace-task';
      const title = String(input?.title ?? '');
      const cwd = resolveCardCwd({ rawCwd: input?.cwd, title, id, mode, settings: this.scope?.get?.(), home: this.home });
      const dependsOn = this.validateDependsOn(id, input?.dependsOn ?? []);
      const files = Array.isArray(input?.files)
        ? input.files.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 20)
        : [];
      return this.put({
        id,
        title,
        description: input?.description ?? '',
        criteria: input?.criteria ?? '',
        mode,
        cwd,
        dependsOn,
        files,
        state: 'pending',
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
        sessionId: '',
        activeRunId: '',
        phase: '',
        pendingInput: [],
        deliverables: [],
        runs: [],
        origin: normalizeCardOrigin(input),
        effects: [],
        legacyTaskId: '',
        error: '',
        summary: '',
        generation: 0,
      });
    });
  }

  async update(id, patch) {
    return this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      const card = this.get(id);
      const editableKeys = ['title', 'description', 'criteria', 'cwd', 'mode', 'dependsOn', 'files'];
      const editable = editableKeys.some((key) => Object.hasOwn(patch, key));
      if (editable && card.state !== 'pending') throw new Error('请先重新打开任务，再编辑。');
      if (Object.hasOwn(patch, 'archived') && patch.archived && !isTerminalCard(card)) {
        throw new Error('请先完成或取消任务，再归档。');
      }
      /** @type {Record<string, any>} */
      const fields = {};
      for (const key of [...editableKeys, 'pinned', 'archived']) {
        if (Object.hasOwn(patch, key)) fields[key] = patch[key];
      }
      if (Object.hasOwn(fields, 'cwd')) {
        fields.cwd = validateTaskCwd(fields.cwd, { dshHome: this.home, requireExisting: false });
      }
      if (Object.hasOwn(fields, 'dependsOn')) {
        fields.dependsOn = this.validateDependsOn(id, fields.dependsOn);
      }
      if (Object.hasOwn(fields, 'files')) {
        fields.files = Array.isArray(fields.files)
          ? fields.files.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 20)
          : [];
      }
      return this.put({ ...card, ...fields });
    });
  }

  async transition(id, action) {
    const result = await this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      const card = this.get(id);
      if (isBusyCard(card)) throw new Error('任务仍在执行，请先停止并等待结束。');
      if (action === 'complete') {
        return this.put({ ...card, state: 'completed', phase: '', pendingInput: [], error: '' });
      }
      if (action === 'reopen') {
        return this.put({ ...card, state: 'pending', archived: false, phase: '', pendingInput: [], error: '' });
      }
      if (action === 'cancel') {
        return this.put({ ...card, state: 'cancelled', phase: '', pendingInput: [], error: '' });
      }
      if (action === 'delete') {
        await this.cards.delete(id);
        this.syncIndex(card, null);
        this.emitChange('deleted', { id });
        return { deleted: true };
      }
      throw new Error('未知任务操作。');
    });
    if (action === 'complete') void this.maybeAutoAdvance('complete');
    return result;
  }

  /** @param {any} controller @param {string} selfId @param {AbortSignal} signal */
  async readResidentModel(controller, selfId, signal) {
    if (!selfId || typeof controller?.projections !== 'function') return null;
    try {
      const projection = await controller.projections({ sessionId: selfId }, signal);
      const model = projection?.values?.modelSelection;
      return model?.next ?? model?.lastUsed ?? null;
    } catch {
      return null;
    }
  }

  /** @param {any} controller @param {AbortSignal} signal */
  async resolveStartModel(controller, signal) {
    const settings = this.scope?.get?.() ?? {};
    const picked = (await this.readResidentModel(controller, settings.sessionId, signal)) ?? modelFromSettings(settings);
    if (picked?.provider && picked?.model) return picked;
    const fallback = (await controller?.modelCatalog?.())?.default;
    if (!fallback?.provider || !fallback?.model) {
      throw new Error('没有可用模型，请先在设置或主对话中选择模型。');
    }
    return fallback;
  }

  /** @param {string} cwd */
  prepareStartCwd(cwd) {
    const validated = validateTaskCwd(cwd, { dshHome: this.home, requireExisting: false });
    const defaultRoot = resolvedTaskRootDir(this.scope?.get?.(), this.home);
    const resolvedValidated = path.resolve(validated);
    const resolvedDefault = path.resolve(defaultRoot);
    if (this.home && fs.existsSync(this.home) && within(resolvedDefault, resolvedValidated)) {
      ensureSafeTaskDir(validated, { dshHome: this.home });
    }
    return validated;
  }

  async start(id, { onlyWhenIdle = false } = {}) {
    const admitted = await this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      this.assertAdmissionOpen();
      if (onlyWhenIdle && this.list().some((item) => isBusyCard(item))) return null;
      const card = this.get(id);
      if (card.state !== 'pending' || card.archived) {
        if (onlyWhenIdle) return null;
        throw new Error('只能开始未执行的任务。');
      }
      const unmet = this.unmetDependencies(card);
      if (unmet.length) {
        if (onlyWhenIdle) return null;
        throw new Error(`前置依赖尚未完成：${unmet.join('、')}`);
      }
      const resolvedCwd = this.prepareStartCwd(card.cwd);
      const generation = card.generation + 1;
      const attempt = (card.runs?.length ?? 0) + 1;
      const runId = `run-${generation}-${attempt}`;
      const run = {
        runId,
        attempt,
        sessionId: '',
        mode: card.mode,
        baseSeq: 0,
        startedAt: Date.now(),
        endedAt: 0,
        state: 'starting',
        summary: '',
        error: '',
        deliverables: [],
        evidence: [],
      };
      return this.put({
        ...card,
        cwd: resolvedCwd,
        state: 'starting',
        sessionId: '',
        activeRunId: runId,
        phase: '正在准备执行环境…',
        pendingInput: [],
        runs: [...(card.runs ?? []).slice(-49), run],
        generation,
        error: '',
        summary: '',
      });
    });
    if (!admitted) return null;

    const controller = this.ctx.sessionController;
    const abort = new AbortController();
    const signal = this.rpcSignal(abort.signal);
    const runPromise = admitted.mode === 'readonly-brief'
      ? this.launchReadonlyBrief(admitted, controller, signal)
      : this.launchWorkspaceCard(admitted, controller, signal);
    this.starts.set(id, { promise: runPromise, abort });
    try {
      return await runPromise;
    } finally {
      if (this.starts.get(id)?.promise === runPromise) this.starts.delete(id);
    }
  }

  /**
   * Continue an existing task card in `review` (or `interrupted`/`failed`) on
   * the exact same `sessionId` so the worker retains full prior context.
   * @param {string} id
   * @param {string} feedback
   */
  async continue(id, feedback) {
    const text = String(feedback ?? '').trim();
    if (!text) throw new Error('请输入追问或修订意见。');
    const admitted = await this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      this.assertAdmissionOpen();
      const card = this.get(id);
      if (card.mode !== 'workspace-task') throw new Error('仅工作区任务卡支持在原会话中追问修订。');
      if (!['review', 'interrupted', 'failed'].includes(card.state)) {
        throw new Error('仅待验收、已中断或失败的任务卡支持继续追问。');
      }
      if (!card.sessionId) throw new Error('该任务卡尚无关联会话，请先开始执行。');
      const baseSeq = await readCurrentSessionSeq(this.ctx, card.sessionId);
      const generation = card.generation + 1;
      const attempt = (card.runs?.length ?? 0) + 1;
      const runId = `run-${generation}-${attempt}`;
      const run = {
        runId,
        attempt,
        sessionId: card.sessionId,
        mode: card.mode,
        baseSeq,
        startedAt: Date.now(),
        endedAt: 0,
        state: 'starting',
        summary: '',
        error: '',
        deliverables: [],
        evidence: [],
      };
      return this.put({
        ...card,
        state: 'starting',
        activeRunId: runId,
        phase: '正在续接原会话…',
        pendingInput: [],
        runs: [...(card.runs ?? []).slice(-49), run],
        generation,
        error: '',
      });
    });

    const controller = this.ctx.sessionController;
    const abort = new AbortController();
    const signal = this.rpcSignal(abort.signal);
    const generation = admitted.generation;
    const runPromise = (async () => {
      try {
        this.assertStartingAlive(admitted.id, generation, signal);
        const ownerId = String(this.scope?.get?.()?.sessionId ?? '').trim();
        let liveAgent = (this.ctx.get?.('agents') ?? this.ctx.agents)?.get?.(admitted.sessionId);
        if (!liveAgent && typeof controller?.resolveAgent === 'function') {
          const resolved = await controller.resolveAgent(admitted.sessionId);
          if (resolved?.error) throw resolved.error;
          liveAgent = resolved?.agent ?? null;
        }
        if (liveAgent && ownerId) {
          this.disposeDelegation(admitted.id);
          const dispose = await bindTaskDelegatedApproval({
            ctx: this.ctx,
            agent: liveAgent,
            ownerSessionId: ownerId,
            label: admitted.title,
            validate: () => this.isDelegationValid(admitted.id, admitted.sessionId, generation),
          });
          if (dispose) this.delegationDisposers.set(admitted.id, dispose);
        }
        this.assertStartingAlive(admitted.id, generation, signal);
        await controller.prompt({
          sessionId: admitted.sessionId,
          requestId: `whale-todo-cont-${admitted.id}-${generation}`,
          mode: 'queue',
          content: [{ type: 'text', text: `请基于此前会话上下文继续修订：\n${text}\n完成后汇报变更与验证结果。` }],
        }, signal);
        return await this.serial(async () => {
          const current = this.get(admitted.id);
          if (current.generation !== generation || current.state !== 'starting') return current;
          return this.put({
            ...current,
            state: 'running',
            phase: '继续执行中…',
            runs: patchRun(current, current.activeRunId, { state: 'running' }),
          });
        });
      } catch (/** @type {any} */ error) {
        this.disposeDelegation(admitted.id);
        await this.serial(async () => {
          const current = this.cards.get(admitted.id);
          if (!current || current.generation !== generation || current.state !== 'starting') return;
          const msg = String(error?.message ?? error).slice(0, 6000);
          await this.put({
            ...current,
            state: 'failed',
            phase: '',
            error: msg,
            runs: patchRun(current, current.activeRunId, { state: 'failed', endedAt: Date.now(), error: msg }),
          });
        });
        throw error;
      }
    })();
    this.starts.set(id, { promise: runPromise, abort });
    try {
      return await runPromise;
    } finally {
      if (this.starts.get(id)?.promise === runPromise) this.starts.delete(id);
    }
  }

  /** @param {any} admitted @param {any} controller @param {AbortSignal} signal */
  async launchWorkspaceCard(admitted, controller, signal) {
    const generation = admitted.generation;
    let createdSessionId = '';
    try {
      const selected = await this.resolveStartModel(controller, signal);
      this.assertStartingAlive(admitted.id, generation, signal);
      const sessionId = `session-whale-todo-${crypto.randomUUID()}`;
      const ownerId = String(this.scope?.get?.()?.sessionId ?? '').trim();
      const created = await createWorkspaceTaskSession({
        ctx: this.ctx,
        controller,
        sessionId,
        card: admitted,
        selectedModel: selected,
        ownerSessionId: ownerId,
        signal,
      });
      createdSessionId = sessionId;
      if (created.directHandle) this.directHandles.set(sessionId, created.directHandle);

      const attached = await this.serial(async () => {
        const current = this.get(admitted.id);
        if (this.closed || signal.aborted || current.generation !== generation || current.state !== 'starting') {
          return null;
        }
        return this.put({
          ...current,
          sessionId,
          runs: patchRun(current, current.activeRunId, { sessionId }),
        });
      });
      if (!attached) {
        await this.cancelSessionBestEffort(sessionId);
        return this.get(admitted.id);
      }

      if (created.agent && ownerId) {
        this.disposeDelegation(admitted.id);
        const dispose = await bindTaskDelegatedApproval({
          ctx: this.ctx,
          agent: created.agent,
          ownerSessionId: ownerId,
          label: attached.title,
          validate: () => this.isDelegationValid(admitted.id, sessionId, generation),
        });
        if (dispose) this.delegationDisposers.set(admitted.id, dispose);
      }

      this.assertStartingAlive(admitted.id, generation, signal);
      await controller.prompt({
        sessionId,
        requestId: `whale-todo-${admitted.id}-${generation}`,
        mode: 'queue',
        content: [{ type: 'text', text: taskPromptText(attached) }],
      }, signal);

      return await this.serial(async () => {
        const current = this.get(admitted.id);
        if (current.generation !== generation || current.state !== 'starting') return current;
        return this.put({
          ...current,
          state: 'running',
          phase: '执行中…',
          runs: patchRun(current, current.activeRunId, { state: 'running' }),
        });
      });
    } catch (/** @type {any} */ error) {
      this.disposeDelegation(admitted.id);
      if (createdSessionId && (this.closed || signal.aborted)) {
        await this.cancelSessionBestEffort(createdSessionId);
      }
      await this.serial(async () => {
        const current = this.cards.get(admitted.id);
        if (!current || current.generation !== generation || current.state !== 'starting') return;
        const msg = String(error?.message ?? error).slice(0, 6000);
        await this.put({
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

  /** @param {any} admitted @param {any} controller @param {AbortSignal} signal */
  launchReadonlyBrief(admitted, controller, signal) {
    return launchReadonlyBriefTask(this, admitted, controller, signal);
  }

  /** @param {string} id @param {number} generation @param {AbortSignal} signal */
  assertStartingAlive(id, generation, signal) {
    if (this.closed || signal.aborted) throw new Error('任务启动已取消。');
    const current = this.cards.get(id);
    if (!current || current.generation !== generation || current.state !== 'starting') {
      throw new Error('任务状态已变更，取消启动。');
    }
  }

  /** @param {string} sessionId */
  async cancelSessionBestEffort(sessionId) {
    try {
      await drainSessionJobs(this.ctx, sessionId);
      const resolved = await this.ctx.sessionController?.resolveAgent?.(sessionId);
      if (resolved && !resolved.error && resolved.agent) {
        resolved.agent.cancel({ kind: 'user' }, { keepInbox: false });
        await resolved.agent.whenIdle?.();
      }
    } catch { /* Best-effort cleanup of an aborted start session. */ }
  }

  async stop(id) {
    if (this.stops.has(id)) return this.stops.get(id);
    const operation = stopManagedCard(this, id);
    this.stops.set(id, operation);
    try { return await operation; } finally { this.stops.delete(id); }
  }

  /** @param {string} sessionId */
  hasSubagentWork(sessionId) {
    const agent = this.ctx.get?.('agents')?.get?.(sessionId) ?? this.ctx.agents?.get?.(sessionId);
    if (!agent) return false;
    return this.ctx.get?.('subagents')?.hasTreeWork?.(agent) === true;
  }

  /** @param {string} cardId @param {any} current @param {any} event */
  async applyTurnEnd(cardId, current, event) {
    const kind = event.data?.reason?.kind;
    if (kind === 'completed' && current.state !== 'stopping' && this.hasSubagentWork(current.sessionId)) {
      return null;
    }
    const nextState = current.state === 'stopping'
      ? (this.stops.has(cardId) ? 'stopping' : 'cancelled')
      : kind === 'aborted' ? 'cancelled' : kind === 'completed' ? 'review' : 'failed';
    const nextError = nextState === 'failed'
      ? String(event.data?.reason?.error?.message ?? `执行结束：${kind}`).slice(0, 6000)
      : '';
    if (nextState !== 'stopping') this.disposeDelegation(cardId);
    const updated = await this.put({
      ...current,
      state: nextState,
      phase: nextState === 'review' ? '待验收' : '',
      pendingInput: [],
      error: nextError,
      runs: patchRun(current, current.activeRunId, {
        state: nextState,
        endedAt: nextState === 'stopping' ? 0 : Date.now(),
        summary: current.summary,
        error: nextError,
        deliverables: current.deliverables,
      }),
    });
    return updated;
  }

  event(session, event) {
    if (this.closed || !WATCHED_EVENTS.has(event?.type)) return;
    const cardId = this.activeBySession.get(session?.id);
    if (!cardId) return;
    return this.serial(() => applyCardSessionEvent(this, cardId, session, event));
  }

  /**
   * Optional Auto-advance: when enabled and no card is currently active,
   * automatically start the oldest unblocked `pending` card (all `dependsOn`
   * are `completed`). Finished cards still stop in `review` for human confirmation.
   */
  maybeAutoAdvance() {
    return runAutoAdvance(this);
  }

  /** Non-destructively mirror legacy `whale_tasks` records into unified cards on startup. */
  importLegacyWhaleTasks() {
    return importLegacyTasksIntoTodos(this);
  }

  /** @param {any} card */
  recoverOneCard(card) {
    return recoverManagedCard(this, card);
  }

  async recover() {
    for (const card of this.list().filter((item) => isBusyCard(item) && !item.legacyTaskId)) {
      await this.recoverOneCard(card);
    }
  }

  close() {
    return closeWhaleTodosService(this);
  }
}

export async function mountWhaleTodos(ctx, options) {
  let domain;
  let service;
  try {
    domain = await ctx.storageDomain.open(todoDomain);
    service = new WhaleTodos(ctx, domain, options);
    await service.recover();
    await service.importLegacyWhaleTasks();
  } catch (/** @type {any} */ error) {
    await domain?.close();
    const unavailable = { available: false, error: `任务卡读取失败：${error.message}`, list: () => [], inspect: () => [] };
    ctx.provide('whaleTodos', unavailable);
    ctx.logger?.warn?.(unavailable.error);
    return unavailable;
  }
  ctx.provide('whaleTodos', service);
  ctx.on('session/event', (session, event) => {
    void service.event(session, event)?.catch((error) => ctx.logger?.warn?.(`whale todos: ${error.message}`));
  }, { global: true });
  const syncLegacy = () => {
    void service.importLegacyWhaleTasks().catch((error) => ctx.logger?.warn?.(`whale todos legacy import: ${error.message}`));
  };
  ctx.on('whale-tasks/ready', syncLegacy);
  ctx.on('whale-tasks/updated', syncLegacy);
  installTodoRecursiveGuard(ctx, service);
  ctx.effect(() => () => service.close());
  return service;
}
