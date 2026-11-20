/** Personal task cards. Runs use ordinary, isolated sessions, never the resident assistant. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { eventText } from './shared.js';
import { ensureSafeTaskDir, resolvedTaskRootDir, validateTaskCwd } from './task-paths.js';

const text = z.string().max(6000);
export const todoSchema = z.object({
  id: z.string(), title: z.string().trim().min(1).max(200), description: text,
  criteria: text, cwd: z.string().max(2000), state: z.enum(['pending', 'starting', 'running', 'stopping', 'review', 'completed', 'cancelled', 'failed', 'interrupted']),
  pinned: z.boolean(), archived: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
  sessionId: z.string(), error: text, summary: text, generation: z.number().int().nonnegative(),
});
export const todoDomain = { name: 'whale_todos', version: 1, tables: { cards: { valueSchema: todoSchema } } };
const busy = (card) => ['starting', 'running', 'stopping'].includes(card.state);
const terminal = (card) => ['review', 'completed', 'cancelled', 'failed', 'interrupted'].includes(card.state);
const WATCHED_EVENTS = new Set(['assistant/message', 'turn/end', 'turn/start']);
const START_RPC_TIMEOUT_MS = 30_000;

/** @param {any} card */
function taskPromptText(card) {
  return `请执行这项用户明确交给你的任务。\n任务：${card.title}\n说明：${card.description || '无补充说明'}\n完成条件：${card.criteria || '给出可检查的结果，说明未完成项。'}\n结束时汇报成果、验证与未完成项；不要把回合结束当成任务已经验收。`;
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

/** @param {any[]} events */
function lastAssistantText(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type === 'assistant/message' && eventText(ev).trim().length > 0) {
      return eventText(ev).trim().slice(0, 6000);
    }
  }
  return '';
}

export class WhaleTodos {
  constructor(ctx, domain, { home, scope }) {
    this.ctx = ctx; this.domain = domain; this.cards = domain.table('cards');
    this.home = home; this.scope = scope; this.chain = Promise.resolve(); this.closed = false;
    this.available = true; this.stops = new Map(); this.starts = new Map();
    this.closeController = new AbortController();
    this.activeBySession = new Map();
    for (const [, card] of this.cards.entries()) {
      if (busy(card) && card.sessionId) this.activeBySession.set(card.sessionId, card.id);
    }
  }
  serial(fn) {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => { /* The original operation is returned; a failed write must not poison the next queued write. */ });
    return next;
  }
  list() { return [...this.cards.entries()].map(([, card]) => structuredClone(card)); }
  get(id) { const card = this.cards.get(id); if (!card) throw new Error('找不到任务卡。'); return structuredClone(card); }
  /** @param {AbortSignal | null | undefined} [extraSignal] */
  rpcSignal(extraSignal) {
    const signals = [this.closeController.signal, AbortSignal.timeout(START_RPC_TIMEOUT_MS)];
    if (extraSignal) signals.push(extraSignal);
    return typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0];
  }
  /**
   * @param {any} previous
   * @param {any} next
   */
  syncIndex(previous, next) {
    if (previous?.sessionId && (previous.sessionId !== next?.sessionId || !next || !busy(next))) {
      if (this.activeBySession.get(previous.sessionId) === previous.id) {
        this.activeBySession.delete(previous.sessionId);
      }
    }
    if (next && busy(next) && next.sessionId) {
      this.activeBySession.set(next.sessionId, next.id);
    }
  }
  async put(card) {
    const previous = this.cards.get(card.id);
    const next = todoSchema.parse({ ...card, updatedAt: Date.now() });
    await this.cards.put(next.id, next);
    this.syncIndex(previous, next);
    return next;
  }
  /** @param {unknown} raw */
  resolveCwd(raw) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    const candidate = trimmed || resolvedTaskRootDir(this.scope?.get?.(), this.home);
    return validateTaskCwd(candidate, { dshHome: this.home, requireExisting: false });
  }
  async create(input) {
    return this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      const now = Date.now();
      const cwd = this.resolveCwd(input?.cwd);
      return this.put({
        id: `todo-${crypto.randomUUID()}`, title: input.title, description: input.description ?? '',
        criteria: input.criteria ?? '', cwd, state: 'pending', pinned: false, archived: false,
        createdAt: now, updatedAt: now, sessionId: '', error: '', summary: '', generation: 0,
      });
    });
  }
  async update(id, patch) {
    return this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      const card = this.get(id);
      const editable = ['title', 'description', 'criteria', 'cwd'].some((key) => Object.hasOwn(patch, key));
      if (editable && card.state !== 'pending') throw new Error('请先重新打开任务，再编辑。');
      if (Object.hasOwn(patch, 'archived') && patch.archived && !terminal(card)) throw new Error('请先完成或取消任务，再归档。');
      /** @type {Record<string, any>} */
      const fields = {};
      for (const key of ['title', 'description', 'criteria', 'cwd', 'pinned', 'archived']) {
        if (Object.hasOwn(patch, key)) fields[key] = patch[key];
      }
      if (Object.hasOwn(fields, 'cwd')) {
        fields.cwd = validateTaskCwd(fields.cwd, { dshHome: this.home, requireExisting: false });
      }
      return this.put({ ...card, ...fields });
    });
  }
  async transition(id, action) {
    return this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      const card = this.get(id);
      if (busy(card)) throw new Error('任务仍在执行，请先停止并等待结束。');
      if (action === 'complete') return this.put({ ...card, state: 'completed', error: '' });
      if (action === 'reopen') return this.put({ ...card, state: 'pending', archived: false, error: '' });
      if (action === 'cancel') return this.put({ ...card, state: 'cancelled', error: '' });
      if (action === 'delete') {
        await this.cards.delete(id);
        this.syncIndex(card, null);
        return { deleted: true };
      }
      throw new Error('未知任务操作。');
    });
  }
  /**
   * @param {any} controller
   * @param {string} selfId
   * @param {AbortSignal} signal
   */
  async readResidentModel(controller, selfId, signal) {
    if (!selfId || typeof controller.projections !== 'function') return null;
    try {
      const projection = await controller.projections({ sessionId: selfId }, signal);
      const model = projection?.values?.modelSelection;
      return model?.next ?? model?.lastUsed ?? null;
    } catch {
      return null;
    }
  }
  /**
   * @param {any} controller
   * @param {AbortSignal} signal
   */
  async resolveStartModel(controller, signal) {
    const settings = this.scope?.get?.() ?? {};
    const picked = (await this.readResidentModel(controller, settings.sessionId, signal)) ?? modelFromSettings(settings);
    if (picked?.provider && picked?.model) return picked;
    const fallback = (await controller.modelCatalog?.())?.default;
    if (!fallback?.provider || !fallback?.model) {
      throw new Error('没有可用模型，请先在设置或主对话中选择模型。');
    }
    return fallback;
  }
  /** @param {string} cwd */
  prepareStartCwd(cwd) {
    const validated = validateTaskCwd(cwd, { dshHome: this.home, requireExisting: false });
    const defaultRoot = resolvedTaskRootDir(this.scope?.get?.(), this.home);
    if (this.home && fs.existsSync(this.home) && validated === defaultRoot) {
      ensureSafeTaskDir(validated, { dshHome: this.home });
    }
    return validated;
  }
  async start(id) {
    const admitted = await this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      const card = this.get(id);
      if (card.state !== 'pending' || card.archived) throw new Error('只能开始未执行的任务。');
      const resolvedCwd = this.prepareStartCwd(card.cwd);
      return this.put({ ...card, cwd: resolvedCwd, state: 'starting', sessionId: '', generation: card.generation + 1, error: '', summary: '' });
    });
    const controller = this.ctx.sessionController;
    const abort = new AbortController();
    const signal = this.rpcSignal(abort.signal);
    const run = this.launchCard(admitted, controller, signal);
    this.starts.set(id, { promise: run, abort });
    try {
      return await run;
    } finally {
      if (this.starts.get(id)?.promise === run) this.starts.delete(id);
    }
  }
  /**
   * @param {any} admitted
   * @param {any} controller
   * @param {AbortSignal} signal
   */
  async launchCard(admitted, controller, signal) {
    const generation = admitted.generation;
    let createdSessionId = '';
    try {
      const selected = await this.resolveStartModel(controller, signal);
      this.assertStartingAlive(admitted.id, generation, signal);
      const sessionId = `session-whale-todo-${crypto.randomUUID()}`;
      await controller.create({
        sessionId, cwd: admitted.cwd, agentPreset: 'standard',
        presentation: { owner: 'dsh-whale:todo', title: admitted.title },
      });
      createdSessionId = sessionId;
      /** @type {any} */
      const attached = await this.serial(async () => {
        const current = this.get(admitted.id);
        if (this.closed || signal.aborted || current.generation !== generation || current.state !== 'starting') {
          return null;
        }
        return this.put({ ...current, sessionId });
      });
      if (!attached) {
        await this.cancelSessionBestEffort(sessionId);
        return this.get(admitted.id);
      }
      await controller.selectModel({ sessionId, ...selected, saveAsDefault: false });
      this.assertStartingAlive(admitted.id, generation, signal);
      await controller.prompt({
        sessionId,
        requestId: `whale-todo-${admitted.id}-${generation}`,
        mode: 'queue',
        content: [{ type: 'text', text: taskPromptText(attached) }],
      }, signal);
      return this.serial(async () => {
        const current = this.get(admitted.id);
        return current.generation === generation && current.state === 'starting'
          ? this.put({ ...current, state: 'running' })
          : current;
      });
    } catch (/** @type {any} */ error) {
      if (createdSessionId && (this.closed || signal.aborted)) {
        await this.cancelSessionBestEffort(createdSessionId);
      }
      await this.serial(async () => {
        const current = this.cards.get(admitted.id);
        if (!current || current.generation !== generation || current.state !== 'starting') return;
        await this.put({ ...current, state: 'failed', error: String(error?.message ?? error).slice(0, 6000) });
      });
      throw error;
    }
  }
  /**
   * @param {string} id
   * @param {number} generation
   * @param {AbortSignal} signal
   */
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
      const resolved = await this.ctx.sessionController?.resolveAgent?.(sessionId);
      if (resolved && !resolved.error && resolved.agent) {
        resolved.agent.cancel({ kind: 'user' }, { keepInbox: false });
        await resolved.agent.whenIdle?.();
      }
    } catch { /* Best-effort cleanup of an aborted start session. */ }
  }
  async stop(id) {
    if (this.stops.has(id)) return this.stops.get(id);
    const operation = (async () => {
      const card = await this.serial(async () => {
        if (this.closed) throw new Error('任务服务已停止。');
        const value = this.get(id);
        if (!busy(value)) return this.put({ ...value, state: 'cancelled', error: '' });
        return this.put({ ...value, state: 'stopping' });
      });
      if (card.state !== 'stopping') return card;
      const inFlight = this.starts.get(id);
      if (inFlight) {
        inFlight.abort.abort(new Error('用户已停止任务。'));
        await inFlight.promise.catch(() => { /* Stopping absorbs the aborted launch rejection. */ });
      }
      const latest = this.get(id);
      if (!latest.sessionId) {
        return this.serial(async () => this.put({ ...this.get(id), state: 'cancelled', error: '' }));
      }
      try {
        const resolved = await this.ctx.sessionController.resolveAgent(latest.sessionId);
        if (resolved.error) throw resolved.error;
        const agent = resolved.agent;
        // Isolated task session: no resident assistant or sibling worker is cancelled.
        agent.cancel({ kind: 'user' }, { keepInbox: false });
        await agent.whenIdle();
        return this.serial(async () => this.put({ ...this.get(id), state: 'cancelled', error: '' }));
      } catch (error) {
        // A failed stop is not evidence that execution ended. Keep admission
        // closed until a terminal event or a successful stop confirms it.
        await this.serial(async () => {
          const current = this.get(id);
          if (busy(current)) {
            await this.put({
              ...current,
              state: 'stopping',
              error: `停止未确认，请重试或检查关联对话：${error.message}`.slice(0, 6000),
            });
          }
        });
        throw error;
      }
    })();
    this.stops.set(id, operation);
    try { return await operation; } finally { this.stops.delete(id); }
  }
  /** @param {string} sessionId */
  hasSubagentWork(sessionId) {
    const agent = this.ctx.get?.('agents')?.get?.(sessionId) ?? this.ctx.agents?.get?.(sessionId);
    if (!agent) return false;
    return this.ctx.get?.('subagents')?.hasTreeWork?.(agent) === true;
  }
  /**
   * @param {string} cardId
   * @param {any} current
   * @param {any} event
   */
  async applyTurnEnd(cardId, current, event) {
    const kind = event.data?.reason?.kind;
    if (kind === 'completed' && current.state !== 'stopping' && this.hasSubagentWork(current.sessionId)) {
      return;
    }
    const nextState = current.state === 'stopping'
      ? (this.stops.has(cardId) ? 'stopping' : 'cancelled')
      : kind === 'aborted' ? 'cancelled' : kind === 'completed' ? 'review' : 'failed';
    const nextError = nextState === 'failed'
      ? String(event.data?.reason?.error?.message ?? `执行结束：${kind}`).slice(0, 6000)
      : '';
    await this.put({ ...current, state: nextState, error: nextError });
  }
  event(session, event) {
    if (this.closed || !WATCHED_EVENTS.has(event?.type)) return;
    const cardId = this.activeBySession.get(session?.id);
    if (!cardId) return;
    return this.serial(async () => {
      if (this.closed) return;
      const current = this.cards.get(cardId);
      if (!current || !busy(current) || current.sessionId !== session.id) return;
      if (event.type === 'assistant/message') {
        const summary = eventText(event).trim();
        if (summary) await this.put({ ...current, summary: summary.slice(0, 6000) });
      } else if (event.type === 'turn/start' && current.state === 'starting') {
        await this.put({ ...current, state: 'running' });
      } else if (event.type === 'turn/end') {
        await this.applyTurnEnd(cardId, current, event);
      }
    });
  }
  /** @param {any} card */
  async recoverOneCard(card) {
    const wasStopping = card.state === 'stopping';
    let state = wasStopping ? 'cancelled' : 'interrupted';
    let summary = card.summary;
    let error = wasStopping ? '' : '应用曾中断；检查关联对话后重新打开任务，不会自动重发。';
    const querySvc = card.sessionId ? this.ctx.get?.('sessionQuery') : null;
    if (querySvc) {
      let observation;
      try {
        observation = await querySvc.observeSession(card.sessionId);
        const events = observation.events;
        const observedSummary = lastAssistantText(events);
        if (observedSummary) summary = observedSummary;
        if (!wasStopping) {
          const end = events.findLast((value) => value.type === 'turn/end');
          const start = events.findLast((value) => value.type === 'turn/start');
          if (end && (!start || end.seq > start.seq)) {
            state = end.data.reason?.kind === 'completed' ? 'review' : end.data.reason?.kind === 'aborted' ? 'cancelled' : 'failed';
            error = state === 'failed' ? '执行未完成，请查看关联对话。' : '';
          }
        }
      } catch (failure) {
        if (!wasStopping) error = `恢复读取失败：${failure.message}`.slice(0, 6000);
      } finally {
        observation?.[Symbol.dispose]?.();
      }
    }
    await this.put({ ...card, state, summary, error });
  }
  async recover() {
    // No re-submission on boot. Preserve stopping -> cancelled semantics and never blank summary.
    for (const card of this.list().filter(busy)) {
      await this.recoverOneCard(card);
    }
  }
  async close() {
    this.closed = true;
    this.closeController.abort(new Error('任务服务已停止。'));
    await Promise.allSettled([...this.starts.values()].map((entry) => entry.promise));
    await this.chain;
    await Promise.allSettled([...this.stops.values()]);
    try {
      const results = await Promise.allSettled(this.list().filter(busy).map(async (card) => {
        const wasStopping = card.state === 'stopping';
        if (card.sessionId) {
          const resolved = await this.ctx.sessionController.resolveAgent(card.sessionId);
          if (resolved.error) throw resolved.error;
          resolved.agent.cancel({ kind: 'user' }, { keepInbox: false });
          await resolved.agent.whenIdle();
        }
        const current = this.get(card.id);
        const cancelled = wasStopping || current.state === 'stopping';
        await this.put({
          ...current,
          state: cancelled ? 'cancelled' : 'interrupted',
          error: cancelled ? '' : '应用已停止，检查关联对话后可重新打开任务。',
        });
      }));
      const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
      if (failures.length) throw new AggregateError(failures, '任务停止未全部确认');
    } finally {
      await this.domain.close();
    }
  }
}

export async function mountWhaleTodos(ctx, options) {
  let domain, service;
  try {
    domain = await ctx.storageDomain.open(todoDomain);
    service = new WhaleTodos(ctx, domain, options);
    await service.recover();
  } catch (error) {
    await domain?.close();
    const unavailable = { available: false, error: `任务卡读取失败：${error.message}` };
    ctx.provide('whaleTodos', unavailable);
    ctx.logger?.warn?.(unavailable.error);
    return unavailable;
  }
  ctx.provide('whaleTodos', service);
  ctx.on('session/event', (session, event) => {
    void service.event(session, event)?.catch((error) => ctx.logger?.warn?.(`whale todos: ${error.message}`));
  }, { global: true });
  ctx.effect(() => () => service.close());
  return service;
}
