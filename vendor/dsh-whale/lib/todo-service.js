/** Personal task cards. Runs use ordinary, isolated sessions, never the resident assistant. */
import crypto from 'node:crypto';
import { z } from 'zod';
import { eventText } from './shared.js';
import { whaleHomeDir } from './preset.js';

const text = z.string().max(6000);
export const todoSchema = z.object({
  id: z.string(), title: z.string().trim().min(1).max(200), description: text,
  criteria: text, cwd: z.string().max(2000), state: z.enum(['pending', 'starting', 'running', 'stopping', 'review', 'completed', 'cancelled', 'failed', 'interrupted']),
  pinned: z.boolean(), archived: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
  sessionId: z.string(), error: text, summary: text, generation: z.number().int().nonnegative(),
});
export const todoDomain = { name: 'whale_todos', version: 1, tables: { cards: { valueSchema: todoSchema } } };
const busy = card => ['starting', 'running', 'stopping'].includes(card.state);
const terminal = card => ['review', 'completed', 'cancelled', 'failed', 'interrupted'].includes(card.state);

export class WhaleTodos {
  constructor(ctx, domain, { home, scope }) {
    this.ctx = ctx; this.domain = domain; this.cards = domain.table('cards');
    this.home = home; this.scope = scope; this.chain = Promise.resolve(); this.closed = false;
    this.available = true; this.stops = new Map();
  }
  serial(fn) { const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next; }
  list() { return [...this.cards.entries()].map(([, card]) => structuredClone(card)); }
  get(id) { const card = this.cards.get(id); if (!card) throw new Error('找不到任务卡。'); return structuredClone(card); }
  async put(card) { const next = todoSchema.parse({ ...card, updatedAt: Date.now() }); await this.cards.put(next.id, next); return next; }
  async create(input) {
    return this.serial(async () => {
      const now = Date.now();
      return this.put({ id: `todo-${crypto.randomUUID()}`, title: input.title, description: input.description ?? '',
        criteria: input.criteria ?? '', cwd: input.cwd?.trim() || whaleHomeDir(this.home), state: 'pending', pinned: false, archived: false,
        createdAt: now, updatedAt: now, sessionId: '', error: '', summary: '', generation: 0 });
    });
  }
  async update(id, patch) {
    return this.serial(async () => {
      const card = this.get(id);
      const editable = ['title', 'description', 'criteria', 'cwd'].some(key => Object.hasOwn(patch, key));
      if (editable && card.state !== 'pending') throw new Error('请先重新打开任务，再编辑。');
      if (Object.hasOwn(patch, 'archived') && patch.archived && !terminal(card)) throw new Error('请先完成或取消任务，再归档。');
      const fields = {};
      for (const key of ['title', 'description', 'criteria', 'cwd', 'pinned', 'archived']) if (Object.hasOwn(patch, key)) fields[key] = patch[key];
      return this.put({ ...card, ...fields });
    });
  }
  async transition(id, action) {
    return this.serial(async () => {
      const card = this.get(id);
      if (busy(card)) throw new Error('任务仍在执行，请先停止并等待结束。');
      if (action === 'complete') return this.put({ ...card, state: 'completed', error: '' });
      if (action === 'reopen') return this.put({ ...card, state: 'pending', archived: false, error: '' });
      if (action === 'cancel') return this.put({ ...card, state: 'cancelled' });
      if (action === 'delete') { await this.cards.delete(id); return { deleted: true }; }
      throw new Error('未知任务操作。');
    });
  }
  async start(id) {
    // Admission is serialized, but a running model must never hold the mutation queue.
    return this.serial(async () => {
      if (this.closed) throw new Error('任务服务已停止。');
      let card = this.get(id);
      if (card.state !== 'pending' || card.archived) throw new Error('只能开始未执行的任务。');
      const sessionId = `session-whale-todo-${crypto.randomUUID()}`;
      card = await this.put({ ...card, state: 'starting', sessionId, generation: card.generation + 1, error: '', summary: '' });
      try {
        const controller = this.ctx.sessionController;
        await controller.create({ sessionId, cwd: card.cwd, agentPreset: 'standard',
          presentation: { owner: 'dsh-whale:todo', title: card.title } });
        const selfId = this.scope.get().sessionId;
        const projection = selfId ? await controller.projections({ sessionId: selfId }, new AbortController().signal) : null;
        const model = projection?.values?.modelSelection;
        const selected = model?.next ?? model?.lastUsed ?? (await controller.modelCatalog()).default;
        await controller.selectModel({ sessionId, ...selected, saveAsDefault: false });
        await controller.prompt({ sessionId, requestId: `whale-todo-${id}-${card.generation}`, mode: 'queue', content: [{ type: 'text', text:
          `请执行这项用户明确交给你的任务。\n任务：${card.title}\n说明：${card.description || '无补充说明'}\n完成条件：${card.criteria || '给出可检查的结果，说明未完成项。'}\n结束时汇报成果、验证与未完成项；不要把回合结束当成任务已经验收。` }] }, new AbortController().signal);
        // Events may already have reached the durable queue before prompt acknowledgement.
        const current = this.get(id);
        return current.state === 'starting' ? this.put({ ...current, state: 'running' }) : current;
      } catch (error) {
        const current = this.get(id);
        await this.put({ ...current, state: 'failed', error: String(error.message ?? error).slice(0, 6000) });
        throw error;
      }
    });
  }
  async stop(id) {
    if (this.stops.has(id)) return this.stops.get(id);
    const operation = (async () => {
      const card = await this.serial(async () => {
        const value = this.get(id);
        if (!busy(value)) return this.put({ ...value, state: 'cancelled' });
        return this.put({ ...value, state: 'stopping' });
      });
      if (card.state !== 'stopping') return card;
      try {
        const resolved = await this.ctx.sessionController.resolveAgent(card.sessionId);
        if (resolved.error) throw resolved.error;
        const agent = resolved.agent;
        // Isolated task session: no resident assistant or sibling worker is cancelled.
        agent.cancel({ kind: 'user' }, { keepInbox: false });
        await agent.whenIdle();
        return this.serial(async () => this.put({ ...this.get(id), state: 'cancelled' }));
      } catch (error) {
        // A failed stop is not evidence that execution ended. Keep admission
        // closed until a terminal event or a successful stop confirms it.
        await this.serial(async () => {
          const current = this.get(id);
          if (busy(current)) await this.put({ ...current, state: 'stopping', error: `停止未确认，请重试或检查关联对话：${error.message}`.slice(0, 6000) });
        });
        throw error;
      }
    })();
    this.stops.set(id, operation);
    try { return await operation; } finally { this.stops.delete(id); }
  }
  event(session, event) {
    if (this.closed) return;
    const card = this.list().find(value => value.sessionId === session.id && busy(value));
    if (!card || !['assistant/message', 'turn/end', 'turn/start'].includes(event.type)) return;
    return this.serial(async () => {
      const current = this.get(card.id);
      if (!busy(current)) return;
      if (event.type === 'assistant/message') {
        const summary = eventText(event).trim();
        if (summary) await this.put({ ...current, summary: summary.slice(0, 6000) });
      } else if (event.type === 'turn/start' && current.state === 'starting') {
        await this.put({ ...current, state: 'running' });
      } else if (event.type === 'turn/end') {
        const kind = event.data.reason?.kind;
        await this.put({ ...current,
          state: current.state === 'stopping' ? (this.stops.has(card.id) ? 'stopping' : 'cancelled') : kind === 'aborted' ? 'cancelled' : kind === 'completed' ? 'review' : 'failed',
          error: kind === 'completed' || kind === 'aborted' ? '' : String(event.data.reason?.error?.message ?? `执行结束：${kind}`).slice(0, 6000) });
      }
    });
  }
  async recover() {
    // No re-submission on boot. A completed durable turn can still be shown for review.
    for (const card of this.list().filter(busy)) {
      let state = 'interrupted', summary = card.summary;
      let error = '应用曾中断；检查关联对话后重新打开任务，不会自动重发。';
      if (card.sessionId && this.ctx.get?.('sessionQuery')) {
        let observation;
        try {
          observation = await this.ctx.get('sessionQuery').observeSession(card.sessionId);
          const events = observation.events;
          const end = events.findLast(value => value.type === 'turn/end');
          const start = events.findLast(value => value.type === 'turn/start');
          if (end && (!start || end.seq > start.seq)) {
            state = end.data.reason?.kind === 'completed' ? 'review' : end.data.reason?.kind === 'aborted' ? 'cancelled' : 'failed';
            summary = eventText(events.findLast(value => value.type === 'assistant/message') ?? {}).slice(0, 6000);
            error = state === 'failed' ? '执行未完成，请查看关联对话。' : '';
          }
        } catch (failure) { error = `恢复读取失败：${failure.message}`.slice(0, 6000); }
        finally { observation?.[Symbol.dispose]?.(); }
      }
      await this.put({ ...card, state, summary, error });
    }
  }
  async close() {
    this.closed = true; await this.chain; await Promise.allSettled([...this.stops.values()]);
    try {
      const results = await Promise.allSettled(this.list().filter(busy).map(async card => {
        const resolved = await this.ctx.sessionController.resolveAgent(card.sessionId);
        if (resolved.error) throw resolved.error;
        resolved.agent.cancel({ kind: 'user' }, { keepInbox: false });
        await resolved.agent.whenIdle();
        await this.put({ ...this.get(card.id), state: 'interrupted', error: '应用已停止，检查关联对话后可重新打开任务。' });
      }));
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, '任务停止未全部确认');
    } finally { await this.domain.close(); }
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
  ctx.on('session/event', (session, event) => { void service.event(session, event)?.catch(error => ctx.logger?.warn?.(`whale todos: ${error.message}`)); }, { global: true });
  ctx.effect(() => () => service.close());
  return service;
}
