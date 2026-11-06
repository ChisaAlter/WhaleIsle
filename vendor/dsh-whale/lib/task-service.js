/** Persistent read-only task admission, lifecycle and destination-bound delivery. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { TaskStore, copy, parseTask, resultText, stableId, taskDomain, taskLimits } from './task-store.js';
import { captureInputs } from './task-inputs.js';
import { startTaskWorker, taskWorkerPreset } from './task-worker.js';

export class WhaleTasks {
  constructor(ctx, store, { home, scope, startWorker = startTaskWorker, now = Date.now }) {
    this.ctx = ctx; this.store = store; this.home = home; this.scope = scope;
    this.startWorker = startWorker; this.now = now; this.active = null; this.closed = false;
    this.holds = new Set(); this.channels = new Map(); this.delivering = new Set(); this.timers = new Set(); this.workerAgents = new Map(); this.deliveryRuns = new Set();
    this.available = true;
    this.controls = new WeakMap(); this.controlEpochs = new Map(); this.ownerEpochs = new Map(); this.blockedOwners = new Set();
  }
  isSelf(agent) { return agent?.id === this.scope.get().sessionId; }
  list() { return this.store.list().sort((a, b) => b.createdAt - a.createdAt); }
  view(task) {
    const value = copy(task);
    value.inputs = value.inputs.map(({ text, path: _path, ...rest }) => rest);
    value.origin = { eventId: task.origin.eventId, kind: task.origin.kind };
    if (value.error && /[A-Za-z]:[\\/]|\/(?:Users|home|tmp)\//u.test(value.error)) value.error = '资料或执行环境不可用，请在桌面检查原始任务。';
    for (const effect of value.effects) if (effect.error && /[A-Za-z]:[\\/]|\/(?:Users|home|tmp)\//u.test(effect.error)) effect.error = '投递失败，请在桌面检查任务。';
    return value;
  }
  inspect() { return this.list().filter(task => ['queued', 'running', 'stopping', 'needs_user'].includes(task.state))
    .map(task => ({ kind: 'whale-task', id: task.id, detail: task.state })); }
  channelKey(route) { return `${route.channel}:${route.botId}`; }
  registerChannel(key, adapter) {
    if (this.channels.has(key)) throw new Error('渠道任务适配器已登记。');
    this.channels.set(key, adapter);
    void this.deliverAll().catch(error => this.warn(error));
    return () => { if (this.channels.get(key) === adapter) this.channels.delete(key); };
  }
  warn(error) { this.ctx.logger?.warn?.(`whale tasks: ${error.message}`); }
  async setOwner(botId, actor) {
    const key = `feishu:${botId}`;
    const epoch = (this.ownerEpochs.get(key) ?? 0) + 1;
    this.ownerEpochs.set(key, epoch); this.blockedOwners.add(key);
    await this.store.serial(() => this.store.owners.put(key, { channel: 'feishu', botId, actor }));
    if (this.ownerEpochs.get(key) === epoch) this.blockedOwners.delete(key);
  }
  async revokeOwner(botId) {
    const key = `feishu:${botId}`;
    // Close admission before durable deletion; an already dispatched request is in flight.
    this.ownerEpochs.set(key, (this.ownerEpochs.get(key) ?? 0) + 1); this.blockedOwners.add(key);
    await this.store.serial(() => this.store.owners.delete(key));
  }
  assertImRoute(route, epoch) {
    const key = route && this.channelKey(route);
    if (!route || this.closed || !this.available || this.blockedOwners.has(key)
      || this.scope.get().imDefault !== true || this.store.owners.get(key)?.actor !== route.actor
      || (epoch !== undefined && epoch !== (this.ownerEpochs.get(key) ?? 0))) throw Object.assign(new Error('原 IM 任务授权已撤销。'), { knownUnsent: true });
  }
  assertImTask(task, epoch) {
    if (task.origin.route?.actor !== task.origin.actor) throw Object.assign(new Error('原 IM 任务来源不匹配。'), { knownUnsent: true });
    this.assertImRoute(task.origin.route, epoch);
  }
  assertCurrent(id, generation) {
    const task = this.store.get(id);
    if (!this.available) throw new Error(this.error || '后台任务服务不可用。');
    if (this.closed || this.holds.has(id) || task.hold || task.generation !== generation || task.state !== 'running') throw new Error('任务不再获准执行。');
    if (task.origin.route) this.assertImTask(task);
    return task;
  }
  async recover() {
    for (const original of this.list()) {
      let persistedEnd;
      if (original.state === 'running' && !original.hold && original.execution?.report && this.ctx.get?.('sessionQuery')) {
        let observation;
        try {
          observation = await this.ctx.get('sessionQuery').observeSession(original.execution.sessionId);
          persistedEnd = observation.events.findLast(event => event.type === 'turn/end');
        } catch (error) { this.warn(error); }
        finally { observation?.[Symbol.dispose]?.(); }
      }
      await this.store.change(original.id, task => {
        if (task.hold || task.state === 'stopping') { task.state = 'cancelled'; task.hold = true; }
        else if (persistedEnd?.data?.reason?.kind === 'completed' && !task.execution.terminal) {
          task.execution.terminal = { seq: persistedEnd.seq, kind: 'completed' };
          this.finishResult(task);
        } else if (['running', 'queued'].includes(task.state)) { task.state = 'interrupted'; task.error = '应用已重启；请明确继续，未自动重新运行。'; }
        for (const effect of task.effects) if (effect.state === 'sending') { effect.state = 'unknown'; effect.error = '发送时中断，未自动重发。'; }
        return task;
      });
    }
  }
  currentHuman(exec) {
    if (!this.isSelf(exec.agent)) throw new Error('只有鲸鱼娘常驻会话可管理任务。');
    const events = exec.agent.session.snapshotEvents();
    const start = events.findLast(event => event.type === 'turn/start');
    const message = events.findLast(event => event.type === 'user/message' && event.seq > (start?.seq ?? -1)
      && (event.data.source.kind === 'user' || event.data.source.kind === 'dsh-im:inbound'));
    if (!start || !message || events.some(event => event.type === 'turn/end' && event.seq > message.seq)) throw new Error('程序事件或已结束回合不能授权个人任务。');
    return message;
  }
  actorFor(exec) {
    const message = this.currentHuman(exec);
    const source = message.data.source;
    if (source.kind === 'dsh-im:inbound') {
      const origin = this.store.origins.get(source.eventId);
      if (!origin || origin.kind !== 'im' || origin.sessionId !== exec.agent.id || origin.messageId !== message.data.id || origin.rpcId !== source.rpcId) throw new Error('IM 来源不匹配。');
      return origin.actor;
    }
    if (source.rpcId && /^(im|feishu|weixin|wecom|qq|slack|telegram|discord|whatsapp|dingtalk|office|whale-pulse)-/u.test(source.rpcId)) throw new Error('这个 IM 入口没有后台任务身份。');
    return 'desktop-owner';
  }
  controlSource(exec, id, action) {
    this.authorizeTask(id, exec, action);
    const message = this.currentHuman(exec);
    const source = { actor: this.actorFor(exec), messageId: message.data.id, eventId: message.data.source.eventId ?? stableId('control', exec.agent.id, message.data.id) };
    return this.grantControl(id, action, source, () => {
      this.authorizeTask(id, exec, action);
      if (this.currentHuman(exec).data.id !== source.messageId) throw new Error('任务控制来源已过期。');
    });
  }
  authorizeTask(id, exec, action = 'status') {
    const actor = this.actorFor(exec); const task = this.store.get(id);
    if (actor !== 'desktop-owner' && actor !== task.origin.actor) throw new Error('不能管理其他用户的任务。');
    const message = this.currentHuman(exec);
    const text = message.data.content.filter(block => block.type === 'text').map(block => block.text).join(' ').trim();
    let intent;
    if (/^\/task(?:\s|$)/u.test(text)) {
      let command; try { command = JSON.parse(text.slice(5)); } catch { throw new Error('任务控制指令无效。'); }
      if (command.taskId === id && Object.keys(command).every(key => ['action', 'taskId'].includes(key))) intent = command.action;
    } else {
      const natural = /^(?:请\s*)?(停止|取消|继续|恢复|查询|查看|stop|cancel|resume|status)\s*(?:任务\s*)?(\S+?)\s*[。.!！]?$/iu.exec(text);
      if (natural?.[2] === id) intent = /^(停止|取消|stop|cancel)$/iu.test(natural[1]) ? 'stop'
        : /^(继续|恢复|resume)$/iu.test(natural[1]) ? 'resume' : 'status';
    }
    if (!['status', 'stop', 'resume'].includes(action) || intent !== action) throw new Error('请在新消息中明确任务编号和对应的 status/stop/resume 指令。');
    if (message.data.source.kind === 'dsh-im:inbound') {
      const origin = this.store.origins.get(message.data.source.eventId);
      if (origin.text !== text || !task.origin.route || ['channel', 'botId', 'incarnation', 'chatId'].some(key => origin.route?.[key] !== task.origin.route[key])) throw new Error('只能由原授权会话管理任务。');
      this.assertImTask(task);
    }
    return task;
  }
  /** Only trusted ingress/RPC handlers mint an action- and revision-bound capability. */
  grantControl(id, action, source, validate = () => {}) {
    const task = this.store.get(id);
    validate();
    if (!['status', 'stop', 'resume'].includes(action) || !source.eventId || !source.messageId
      || (source.actor !== 'desktop-owner' && source.actor !== task.origin.actor)) throw new Error('任务控制来源无效。');
    const prior = task.controlSources.find(row => row.eventId === source.eventId);
    if (prior && (prior.action !== action || prior.messageId !== source.messageId || prior.actor !== source.actor)) throw new Error('任务控制事件不能更换动作或来源。');
    const token = Object.freeze({ ...source });
    this.controls.set(token, { id, action, revision: task.revision, generation: task.generation, epoch: this.controlEpochs.get(id) ?? 0, validate });
    return token;
  }
  assertControl(id, action, source) {
    const grant = source && this.controls.get(source); const task = this.store.get(id);
    if (!grant || grant.id !== id || grant.action !== action || grant.revision !== task.revision || grant.generation !== task.generation || grant.epoch !== (this.controlEpochs.get(id) ?? 0)) throw new Error('任务控制授权不匹配或已过期。');
    grant.validate();
    return task;
  }
  desktopControl(id, action) {
    return this.grantControl(id, action, { actor: 'desktop-owner', eventId: `desktop-${action}-${crypto.randomUUID()}`, messageId: `desktop-action-${crypto.randomUUID()}` });
  }
  async originFor(exec) {
    if (!this.isSelf(exec.agent)) throw new Error('只有鲸鱼娘常驻会话可管理个人任务。');
    const events = exec.agent.session.snapshotEvents();
    const start = events.findLast(e => e.type === 'turn/start');
    const messages = events.filter(e => e.type === 'user/message' && e.seq > (start?.seq ?? -1));
    const message = messages.findLast(e => /^\/task(?:\s|$)/u.test(e.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()));
    if (!message) throw new Error('本轮没有明确的 /task 委托。');
    const source = message.data.source;
    const stored = source.eventId && this.store.origins.get(source.eventId);
    if (stored) {
      if (stored.messageId !== message.data.id || stored.sessionId !== exec.agent.id || stored.rpcId !== source.rpcId) throw new Error('IM 委托来源不匹配。');
      return copy(stored);
    }
    if (source.kind !== 'user' || (source.rpcId && /^(im|feishu|weixin|wecom|qq|slack|telegram|discord|whatsapp|dingtalk|office|whale-pulse)-/u.test(source.rpcId))) throw new Error('这条消息没有可信的人类任务来源；请从主窗、桌宠或已绑定任务渠道提交。');
    parseTask(message.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
    const text = message.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const origin = { eventId: stableId('desktop', exec.agent.id, message.data.id), sessionId: exec.agent.id,
      messageId: message.data.id, rpcId: source.rpcId ?? '', actor: 'desktop-owner', kind: 'desktop', text, files: [] };
    await this.store.origins.put(origin.eventId, origin);
    return origin;
  }
  async accept(origin) {
    const registered = this.store.origins.get(origin.eventId);
    if (!registered || registered.messageId !== origin.messageId || registered.actor !== origin.actor || registered.text !== origin.text) throw new Error('委托未通过可信入口保存。');
    const command = parseTask(origin.text);
    return this.store.serial(async () => {
      const id = stableId('task', origin.eventId);
      const existing = this.store.tasks.get(id);
      if (existing) return this.view(existing);
      if (!this.available) throw new Error(this.error || '后台任务服务不可用。');
      if (this.closed || this.active || this.list().some(task => ['queued', 'running', 'stopping'].includes(task.state))) throw new Error('已有后台整理任务，请等其结束或先停止。');
      if (this.store.tasks.size >= taskLimits.maxTasks) throw new Error('任务记录已达上限，请先导出或整理记录。');
      if (origin.kind === 'im') {
        const owner = this.store.owners.get(this.channelKey(origin.route));
        if (!owner || owner.actor !== origin.actor) throw new Error('该 IM 用户尚未由桌面主人授予后台任务权限。');
        const adapter = this.channels.get(this.channelKey(origin.route));
        if (!adapter || await adapter.status(origin.route) !== 'ready') throw new Error('原渠道当前不能接收后台结果。');
      }
      const admission = this.ctx.get?.('desktopTaskAdmission');
      if (admission && !admission.check()) throw new Error('桌面正在停止或维护，未接纳任务。');
      const inputs = await captureInputs(command.files, { allowedFiles: origin.kind === 'im' ? origin.files : undefined,
        forbiddenRoot: origin.kind === 'desktop' ? this.home : undefined });
      const catalog = await this.ctx.sessionController.modelCatalog();
      const selected = this.scope.get();
      const model = selected.modelProvider && selected.modelModel
        ? { provider: selected.modelProvider, model: selected.modelModel } : catalog.default;
      if (!model?.provider || !model?.model) throw new Error('没有可用模型。');
      if (this.closed || (admission && !admission.check())) throw new Error('桌面任务准入已关闭。');
      const now = this.now();
      const task = { id, revision: 1, generation: 1, origin: copy(origin), goal: command.goal, criteria: command.criteria,
        inputs, model: { provider: model.provider, model: model.model }, state: 'queued', hold: false,
        createdAt: now, updatedAt: now, error: '', effects: [] };
      await this.store.put(task);
      return this.view(task);
    });
  }
  schedule(id) {
    setImmediate(() => { if (!this.closed) void this.run(id).catch(error => this.warn(error)); });
  }
  async run(id) {
    if (this.active || this.closed || !this.available) return;
    const entry = { id, generation: 0, worker: null, done: null, cancelled: false, shutdown: false };
    this.active = entry;
    entry.done = this.execute(entry).finally(() => { if (this.active === entry) this.active = null; });
    return entry.done;
  }
  async execute(entry) {
    let task;
    let timer;
    try {
      task = this.store.get(entry.id);
      if (task.state !== 'queued' || task.hold || this.holds.has(task.id)) return;
      const now = this.now();
      task = await this.store.change(task.id, value => { value.state = 'running'; value.updatedAt = now;
        value.execution = { id: `${value.id}-r${value.revision}`, sessionId: `${value.id}-worker-r${value.revision}`,
          promptId: `${value.id}-prompt-r${value.revision}`, generation: value.generation,
          startedAt: now, deadlineAt: now + taskLimits.deadlineMs, requests: 0, readBytes: 0, readIds: [] }; return value; });
      entry.generation = task.generation;
      const cwd = path.join(this.home, 'data', 'whale-task-workspaces', task.id);
      await fs.mkdir(cwd, { recursive: true });
      const policy = {
        cwd, bindAgent: agent => this.workerAgents.set(agent.id, { agent, generation: entry.generation, taskId: task.id }),
        assertCurrent: () => this.assertCurrent(task.id, entry.generation),
        validate: async () => {
          const current = this.assertCurrent(task.id, entry.generation);
          if (current.origin.route) {
            const adapter = this.channels.get(this.channelKey(current.origin.route));
            if (!adapter || await adapter.status(current.origin.route) !== 'ready') throw new Error('原 IM 渠道不可用或授权已撤销，任务暂停执行。');
            this.assertCurrent(task.id, entry.generation);
          }
        },
        request: () => this.store.change(task.id, value => { this.assertCurrent(task.id, entry.generation);
          if (value.execution.requests >= taskLimits.maxRequests) throw new Error('任务模型请求达到上限。'); value.execution.requests++; return value; }),
        read: (inputId, bytes) => this.store.change(task.id, value => { this.assertCurrent(task.id, entry.generation);
          if (value.execution.readBytes + bytes > taskLimits.maxReadBytes) throw new Error('资料读取量达到上限。');
          value.execution.readBytes += bytes; if (inputId && bytes > 0 && !value.execution.readIds.includes(inputId)) value.execution.readIds.push(inputId); return value; }),
        report: args => this.store.change(task.id, value => { this.assertCurrent(task.id, entry.generation);
          if (value.execution.report) throw new Error('本次执行已提交报告。');
          if (!args.evidence.every(ref => value.inputs.some(input => input.id === ref) && value.execution.readIds.includes(ref))) throw new Error('报告引用了未获准或未读取的资料。');
          value.execution.report = args; return value; }),
      };
      this.assertCurrent(task.id, entry.generation);
      entry.worker = this.startWorker(this.ctx, task, policy);
      if (entry.cancelled) entry.worker.cancel();
      timer = setTimeout(() => { void this.stop(task.id, 'deadline').catch(error => this.warn(error)); }, taskLimits.deadlineMs);
      const terminal = await entry.worker.done;
      await this.store.change(task.id, value => {
        if (value.hold || this.holds.has(task.id) || value.generation !== entry.generation) { value.state = entry.shutdown && !value.hold ? 'interrupted' : 'cancelled'; return value; }
        value.execution.terminal = terminal;
        const report = value.execution.report;
        if (!report || terminal.kind !== 'completed') {
          value.state = 'failed'; value.error = report ? `执行结束：${terminal.kind}` : '执行结束但没有有效资料报告。';
          this.failureResult(value);
        } else {
          this.finishResult(value);
        }
        value.updatedAt = this.now(); return value;
      });
    } catch (error) {
      if (task) await this.store.change(task.id, value => { value.state = entry.shutdown && !value.hold ? 'interrupted' : value.hold || this.holds.has(task.id) ? 'cancelled' : 'failed'; value.error = error.message;
        if (value.state === 'failed') this.failureResult(value); return value; });
      else throw error;
    } finally {
      clearTimeout(timer);
      if (task) { this.workerAgents.delete(task.execution?.sessionId); await this.deliver(task.id); }
    }
  }
  failureResult(value) {
    value.result = { id: `${value.execution?.id ?? value.id}-failure`, summary: '后台资料整理未完成，请在任务面板查看并决定是否继续。',
      evidence: [], coveredCriteria: [], unmet: ['没有完成证据；详细错误请在桌面任务状态查看'], outcome: 'failed' };
    this.resultEffects(value);
  }
  resultEffects(value) {
    const content = resultText(value);
    value.effects = ['session', ...(value.origin.route ? ['im'] : [])].map(target => ({
      id: stableId('effect', value.id, value.revision, target), target, state: 'pending', attempts: 0, nextAt: 0, content }));
  }
  finishResult(value) {
    const report = value.execution.report;
    const missing = value.inputs.filter(input => !value.execution.readIds.includes(input.id) || !report.evidence.includes(input.id));
    const unmet = [...report.unmet, ...missing.map(input => `缺少资料 ${input.name} 的读取与引用`),
      ...value.criteria.filter(criterion => !report.coveredCriteria.includes(criterion)).map(criterion => `未确认完成条件：${criterion}`)];
    value.state = report.outcome === 'completed' && !unmet.length && report.summary.trim()
      ? 'completed' : report.outcome === 'needs_user' ? 'needs_user' : 'failed';
    value.result = { ...report, unmet, id: `${value.execution.id}-result` };
    this.resultEffects(value);
  }
  async stop(id, reason = 'user', source) {
    const old = source ? this.assertControl(id, 'stop', source) : this.store.get(id);
    if (source && old.controlSources.some(row => row.eventId === source.eventId && row.action === 'stop')) return this.view(old);
    this.controlEpochs.set(id, (this.controlEpochs.get(id) ?? 0) + 1);
    this.holds.add(id);
    const active = this.active?.id === id ? this.active : null;
    if (active) { active.cancelled = true; active.worker?.cancel(); }
    await this.store.change(id, value => { value.hold = true; value.revision++; value.generation++;
      if (source) value.controlSources = [...value.controlSources, { action: 'stop', eventId: source.eventId, messageId: source.messageId, actor: source.actor, at: this.now() }].slice(-30);
      value.state = active || this.delivering.has(id) ? 'stopping' : 'cancelled'; value.error = reason === 'deadline' ? '任务达到时限，已停止。' : '用户已停止。';
      for (const effect of value.effects) if (['pending', 'sending'].includes(effect.state)) effect.state = effect.state === 'sending' ? 'unknown' : 'cancelled';
      return value; });
    if (active) await active.done;
    if (this.delivering.has(id)) await Promise.allSettled([...this.deliveryRuns]);
    await this.store.change(id, value => ({ ...value, state: 'cancelled' }));
    return this.view(this.store.get(old.id));
  }
  async resume(id, origin) {
    return this.store.serial(async () => {
      if (this.closed || !this.available) throw new Error('后台任务服务不可用。');
      const task = this.assertControl(id, 'resume', origin);
      const epoch = task.origin.route ? (this.ownerEpochs.get(this.channelKey(task.origin.route)) ?? 0) : undefined;
      if (origin.eventId && task.controlSources.some(row => row.eventId === origin.eventId && row.action === 'resume')) return this.view(task);
      if (this.delivering.has(id)) throw new Error('任务投递尚未结束，请等待停止完成。');
      if (this.active || this.list().some(value => ['queued', 'running', 'stopping'].includes(value.state))) throw new Error('已有运行中的任务。');
      if (task.origin.route) {
        const owner = this.store.owners.get(this.channelKey(task.origin.route));
        const adapter = this.channels.get(this.channelKey(task.origin.route));
        this.assertImTask(task, epoch);
        if (owner?.actor !== task.origin.actor || !adapter || await adapter.status(task.origin.route) !== 'ready') throw new Error('原任务 IM 授权或路线不可用。');
        this.assertImTask(this.store.get(id), epoch);
      }
      this.assertControl(id, 'resume', origin);
      if (origin.actor !== task.origin.actor && origin.actor !== 'desktop-owner') throw new Error('不能继续其他用户的任务。');
      if (!['interrupted', 'needs_user', 'failed', 'cancelled', 'unknown'].includes(task.state)) throw new Error('此状态不能继续。');
      if (task.history.length >= 10) throw new Error('任务已达十次继续上限，请重新明确委托。');
      await this.store.change(id, value => {
        this.assertControl(id, 'resume', origin);
        if (value.origin.route) this.assertImTask(value, epoch);
        if (value.revision !== task.revision || value.generation !== task.generation) throw new Error('任务控制来源已过期。');
        return { ...value,
          controlSources: [...value.controlSources, { action: 'resume', eventId: origin.eventId, messageId: origin.messageId, actor: origin.actor, at: this.now() }].slice(-30),
          history: [...value.history, { revision: value.revision, generation: value.generation,
          state: value.state, ...(value.execution ? { execution: value.execution } : {}), ...(value.result ? { result: value.result } : {}), effects: value.effects }],
          revision: value.revision + 1, generation: value.generation + 1,
          hold: false, state: 'queued', error: '', execution: undefined, result: undefined, effects: [] };
      });
      const resumed = this.store.get(id);
      if (resumed.revision !== task.revision + 1 || resumed.hold || this.controls.get(origin).epoch !== (this.controlEpochs.get(id) ?? 0)) return this.view(resumed);
      this.holds.delete(id);
      this.schedule(id); return this.view(resumed);
    });
  }
  deliveryAdmission(id, effect, snapshot, adapter, epoch) {
    const task = this.store.get(id); const current = task.effects.find(row => row.id === effect.id);
    if (this.closed || !this.available || this.holds.has(id) || task.hold || task.revision !== snapshot.revision || task.generation !== snapshot.generation
      || !current || current.state !== 'sending' || current.content !== effect.content || current.target !== effect.target) throw Object.assign(new Error('任务投递已失效。'), { knownUnsent: true });
    if (effect.target === 'im') {
      this.assertImTask(task, epoch);
      if (this.channels.get(this.channelKey(task.origin.route)) !== adapter || JSON.stringify(task.origin.route) !== JSON.stringify(snapshot.origin.route)) throw Object.assign(new Error('原任务投递路线已变化。'), { knownUnsent: true });
    }
  }
  async deliverAll() { for (const task of this.list()) await this.deliver(task.id); }
  deliver(id) {
    const pending = this.deliverTask(id); this.deliveryRuns.add(pending);
    pending.finally(() => this.deliveryRuns.delete(pending)).catch(() => {});
    return pending;
  }
  async deliverTask(id) {
    if (this.closed || !this.available || this.delivering.has(id)) return;
    this.delivering.add(id);
    try {
      for (const initial of this.store.get(id).effects) {
        let task = this.store.get(id);
        const effect = task.effects.find(row => row.id === initial.id);
        if (task.hold || this.holds.has(id) || effect.state !== 'pending' || effect.nextAt > this.now()) continue;
        const route = task.origin.route;
        let adapter;
        const snapshot = task; const epoch = route ? (this.ownerEpochs.get(this.channelKey(route)) ?? 0) : undefined;
        if (effect.target === 'im') {
          try { this.assertImTask(task, epoch); } catch (error) { await this.failEffect(id, effect.id, error.message); continue; }
          adapter = this.channels.get(this.channelKey(route));
          const status = adapter ? await adapter.status(route) : 'offline';
          task = this.store.get(id);
          if (this.holds.has(id) || task.hold || task.revision !== snapshot.revision || task.generation !== snapshot.generation) continue;
          try { this.assertImTask(task, epoch); } catch (error) { await this.failEffect(id, effect.id, error.message); continue; }
          if (adapter && this.channels.get(this.channelKey(route)) !== adapter) { await this.failEffect(id, effect.id, '原渠道适配器已更换。'); continue; }
          if (status === 'revoked' || status === 'expired') { await this.failEffect(id, effect.id, '原渠道授权已失效。'); continue; }
          if (status !== 'ready') {
            await this.store.change(id, value => { const row = value.effects.find(row => row.id === effect.id); row.error = '原渠道暂时离线，保留待送。'; row.nextAt = this.now() + 15000; return value; });
            this.retryLater(id); continue;
          }
        }
        await this.store.change(id, value => { const row = value.effects.find(row => row.id === effect.id);
          if (!value.hold && !this.holds.has(id) && row.state === 'pending') { row.state = 'sending'; row.attempts++; } return value; });
        try {
          task = this.store.get(id);
          if (this.closed || task.hold || this.holds.has(id) || task.effects.find(row => row.id === effect.id)?.state !== 'sending') continue;
          let receipt;
          const admit = () => this.deliveryAdmission(id, effect, snapshot, adapter, epoch);
          admit();
          if (effect.target === 'im') receipt = await adapter.send(route, effect.id, effect.content, admit);
          else receipt = await this.sessionNotice(task, effect);
          if (this.holds.has(id) || this.store.get(id).generation !== task.generation) {
            await this.store.change(id, value => { const row = value.effects.find(row => row.id === effect.id);
              row.receipt = { providerMessageIds: receipt.providerMessageIds ?? [], outcome: receipt.outcome, read: 'unknown' }; return value; });
            continue;
          }
          await this.store.change(id, value => { const row = value.effects.find(row => row.id === effect.id);
            row.state = receipt.outcome === 'sent' ? 'sent' : receipt.outcome === 'failed' ? 'failed' : 'unknown';
            row.receipt = { providerMessageIds: receipt.providerMessageIds ?? [], outcome: row.state, read: 'unknown' }; return value; });
        } catch (error) {
          await this.store.change(id, value => { const row = value.effects.find(row => row.id === effect.id);
            if (value.hold || this.holds.has(id) || value.generation !== task.generation) return value;
            row.state = error.knownUnsent === true && error.retryable === true && row.attempts < taskLimits.maxDeliveryAttempts ? 'pending' : error.knownUnsent === true ? 'failed' : 'unknown';
            row.error = error.message; row.nextAt = this.now() + row.attempts * 5000; return value; });
          this.retryLater(id);
        }
      }
    } finally { this.delivering.delete(id); }
  }
  retryLater(id) { if (this.closed) return; const timer = setTimeout(() => { this.timers.delete(timer); void this.deliver(id).catch(error => this.warn(error)); }, 15000); timer.unref?.(); this.timers.add(timer); }
  failEffect(id, effectId, error) { return this.store.change(id, value => { const row = value.effects.find(row => row.id === effectId); row.state = 'failed'; row.error = error; return value; }); }
  async sessionNotice(task, effect) {
    const id = this.scope.get().sessionId;
    const resolved = await this.ctx.sessionController.resolveAgent(id);
    if ('error' in resolved) throw resolved.error;
    const agent = resolved.agent;
    if (this.closed || this.holds.has(task.id) || this.store.get(task.id).hold) throw Object.assign(new Error('任务已停止投递。'), { knownUnsent: true });
    if (!agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source?.effectId === effect.id)) {
      agent.session.append('user/message', Object.freeze({ ...createUserMessage({ source: { kind: 'dsh-whale:result', form: 'notice', summary: `资料整理 ${task.state}`, effectId: effect.id },
        content: [{ type: 'text', text: effect.content }] }), id: effect.id }), { surfaceOp: 'append' });
    }
    if (!await this.ctx.sessions.flush(agent.session)) throw new Error('主会话没有确认持久化。');
    return { outcome: 'sent', providerMessageIds: [effect.id] };
  }
  async recordInbound(origin, displayText) {
    const stored = this.store.origins.get(origin.eventId);
    if (stored && (stored.actor !== origin.actor || stored.messageId !== origin.messageId
      || stored.route?.chatId !== origin.route?.chatId)) throw new Error('重复事件来源发生变化。');
    if (!stored) await this.store.origins.put(origin.eventId, origin);
    const resolved = await this.ctx.sessionController.resolveAgent(origin.sessionId);
    if ('error' in resolved) throw resolved.error;
    const agent = resolved.agent;
    if (!agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.id === origin.messageId)) {
      agent.session.append('user/message', Object.freeze({ ...createUserMessage({
        source: { kind: origin.kind === 'im' ? 'dsh-im:inbound' : 'dsh-whale:desktop-task', form: 'notice', summary: origin.kind === 'im' ? 'IM 用户提交后台资料整理' : '桌面用户提交后台资料整理', rpcId: origin.rpcId, eventId: origin.eventId },
        content: [{ type: 'text', text: displayText }] }), id: origin.messageId }), { surfaceOp: 'append' });
    }
    if (!await this.ctx.sessions.flush(agent.session)) throw new Error('IM 委托未确认持久化。');
  }
  close() { return this.closing ??= this.dispose(); }
  async dispose() {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await this.store.chain;
    for (const task of this.list().filter(task => task.state === 'queued')) await this.store.change(task.id, value => ({ ...value, state: 'interrupted', error: '应用已停止，等待用户继续。' }));
    if (this.active) { const entry = this.active; entry.shutdown = true; this.holds.add(entry.id); entry.cancelled = true; entry.worker?.cancel(); await entry.done;
      await this.store.change(entry.id, value => value.hold ? value : { ...value, state: 'interrupted', error: '应用已停止，等待用户继续。' }); }
    await Promise.allSettled([...this.deliveryRuns]);
    await this.store.close();
  }
}

/** Task failure leaves the established assistant usable and visibly reports unavailability. */
export async function mountWhaleTasks(ctx, options) {
  let service;
  let domain;
  // Deny restored task Sessions even while the durable catalog is opening or corrupt.
  const ownedSession = agent => agent?.session?.header?.agentPreset === 'whale-task-reader'
    || /^task-[a-f0-9]{32}-worker-r\d+$/u.test(agent?.id ?? '') || service?.list().some(task => task.execution?.sessionId === agent?.id);
  ctx.tools.guard(exec => {
    if (!ownedSession(exec.agent)) return;
    const task = service?.list().find(task => task.execution?.sessionId === exec.agent?.id);
    const bound = service?.workerAgents.get(exec.agent.id);
    if (!service?.available || !task || !bound || bound.agent !== exec.agent || bound.generation !== task.generation) return '此任务执行未由受限适配器启动；请在鲸鱼娘任务面板明确继续。';
    try { service.assertCurrent(task.id, bound.generation); } catch (error) { return error.message; }
    if (!['task_read_input', 'task_search_inputs', 'task_report'].includes(exec.name)) return '后台资料任务不允许这个工具。';
  });
  ctx.on('agent/pre-step', (input, next) => {
    if (!ownedSession(input.agent)) return next();
    const task = service?.list().find(task => task.execution?.sessionId === input.agent.id);
    const bound = service?.workerAgents.get(input.agent.id);
    if (!service?.available || !task || !bound || bound.agent !== input.agent || task.state !== 'running' || task.hold || service.holds.has(task.id)) return { kind: 'reject' };
    return next();
  });
  ctx.on('agent-preset/before-select', ({ agent }) => {
    if (ownedSession(agent)) throw new Error('后台任务不能切换预设。');
  });
  try {
    domain = await ctx.storageDomain.open(taskDomain);
    const store = new TaskStore(domain);
    service = new WhaleTasks(ctx, store, options);
    service.available = false;
    ctx.provide('whaleTasks', service);
    ctx.effect(() => async () => service.close());
    const unregister = await ctx.agentPresets.register(taskWorkerPreset);
    ctx.effect(() => unregister);
    const stopOwned = async sessionId => {
      if (sessionId === options.scope.get().sessionId) return Promise.all(service.inspect().map(task => service.stop(task.id)));
      const task = service.list().find(task => task.execution?.sessionId === sessionId);
      return task ? service.stop(task.id) : undefined;
    };
    ctx.on('session/before-cancel', ({ agent }) => stopOwned(agent.id));
    ctx.on('workspace/session-stop', ({ sessionId }) => stopOwned(sessionId));
    await service.recover();
    service.available = true;
    ctx.emit?.('whale-tasks/ready');
    await service.deliverAll();
  } catch (error) {
    if (!service) {
      await domain?.close();
      const unavailable = { available: false, error: error.message, list: () => [], inspect: () => [] };
      if (!ctx.get('whaleTasks')) ctx.provide('whaleTasks', unavailable);
    } else { service.available = false; service.error = error.message; }
    options.ctxError?.(error.message);
    ctx.logger?.warn?.(`鲸鱼娘后台任务不可用：${error.message}`);
  }
  return service;
}
