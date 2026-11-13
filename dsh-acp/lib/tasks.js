/** Durable task receipts around the host's managed, continuable child sessions. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { listDirectChildren } from './host-contract.js';

export const TASK_ADMISSION = 'configured-agent-task';
const terminal = (task) => Boolean(task?.endedAt);
const text = (output = []) => output.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
const statusOf = (reason) => reason === 'completed' ? 'completed' : reason === 'aborted' ? 'cancelled' : 'failed';
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;

export function createTaskStore(ctx, storeFile) {
  const service = (name) => typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];
  const file = path.join(path.dirname(storeFile), 'acp-tasks.json');
  const tasks = new Map(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).tasks.map((task) => [task.taskId, task]) : []);
  const receipts = new Map();
  const active = new Map();
  const settling = new Map();
  const recovering = new Map();
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, tasks: [...tasks.values()] }), 'utf8');
    fs.renameSync(`${file}.tmp`, file);
  };
  const append = (parent, kind, task) => {
    const { requestKey, requestArguments, ...presentation } = task;
    parent.session.append(`acp-delegation/${kind}`, JSON.parse(JSON.stringify({ ...presentation, runId: task.taskId, preview: text(task.output).slice(0, 1200) })), { ignorable: true });
  };
  const latest = (parentId, childId) => [...tasks.values()].findLast((task) => task.parentId === parentId && task.childId === childId);
  const get = (parentId, id) => {
    const task = tasks.get(id) || latest(parentId, id);
    if (!task || task.parentId !== parentId) throw new Error('Task access requires its direct parent conversation.');
    return task;
  };
  const observe = async (id) => {
    const lease = await service('sessionQuery').observeSession(id);
    try { return { events: [...lease.events], header: lease.header }; }
    finally { lease[Symbol.dispose](); }
  };
  const flush = async () => { if (ctx.get?.('sessionPersistence')) await service('sessionPersistence').flush(); };
  function delivered(parent, task) {
    return parent.session.snapshotEvents().some((event) =>
      (event.type === 'user/message' && (event.data.id === task.deliveryMessageId
        || (task.hostRunId && event.data.source?.kind === 'subagent-settled' && event.data.source.runId === task.hostRunId)))
      || (event.type === 'agent/inbox/spliced' && event.data.inserted?.some((message) => message.id === task.deliveryMessageId)));
  }
  async function offer(parent, task) {
    if (!terminal(task) || task.deliveryState === 'disposed' || task.deliveryState === 'acknowledged') return;
    if (task.deliveryState === 'delivered' || delivered(parent, task)) {
      task.deliveryState = 'delivered'; save(); return;
    }
    const message = {
      id: task.deliveryMessageId,
      role: 'user',
      content: [{ type: 'text', text: `${task.agentName} (${task.modelName || task.model}) task ${task.taskId}: ${statusOf(task.stopReason)}.${task.repositoryRoot ? `\nRetained checkout: ${task.cwd}` : ''}\n${text(task.output)}${task.diagnostic ? `\n${task.diagnostic}` : ''}` }],
      source: { kind: 'subagent-settled', form: 'notice', senderSessionId: task.childId, runId: task.hostRunId || task.taskId, summary: `Configured agent task ${statusOf(task.stopReason)}.` },
    };
    // The inbox is durable. A crash before the index update is reconciled by
    // message identity, not by replaying the child's prompt or model request.
    if (parent.status === 'idle') parent.followup(message); else parent.steer(message);
    await flush();
    task.deliveryState = 'delivered'; save();
  }
  function finish(parent, task, outcome) {
    if (settling.has(task.taskId)) return settling.get(task.taskId);
    const operation = settle(parent, task, outcome);
    settling.set(task.taskId, operation);
    operation.finally(() => settling.delete(task.taskId)).catch(() => {});
    return operation;
  }
  async function settle(parent, task, outcome) {
    if (terminal(task)) return task;
    let diagnostic = outcome.diagnostic;
    if (outcome.stopReason !== 'completed' && !diagnostic) {
      try {
        const { events } = await observe(task.childId);
        diagnostic = events.findLast((event) => event.type === 'turn/end')?.data.reason?.error?.message;
      } catch (error) {
        diagnostic = `${task.agentName} stopped: ${outcome.stopReason}. Could not read failure details: ${error.message}`;
      }
      diagnostic ||= `${task.agentName} stopped: ${outcome.stopReason}.`;
    }
    Object.assign(task, outcome, { endedAt: Date.now(), status: statusOf(outcome.stopReason), ...(diagnostic ? { diagnostic } : {}) });
    save(); append(parent, 'end', task); await flush();
    if (task.delivery === 'caller') await offer(parent, task);
    else if (delivered(parent, task)) { task.deliveryState = 'delivered'; save(); }
    return task;
  }
  function begin(parent, identity, extra = {}) {
    const taskId = extra.taskId || crypto.randomUUID();
    const task = { ...identity, ...extra, parentId: parent.id, taskId, runId: taskId,
      startedAt: Date.now(), startSeq: service('agents')?.get(identity.childId)?.session.seq ?? 0, status: 'running', deliveryState: 'pending', deliveryMessageId: `acp-result-${taskId}`, output: [] };
    tasks.set(taskId, task); save(); append(parent, 'start', task); return task;
  }
  async function once(parent, requestId, args, start) {
    if (requestId !== undefined && (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256)) throw new Error('client_request_id must contain 1 to 256 characters.');
    const key = requestId === undefined ? undefined : `${parent.id}\0${requestId}`;
    const fingerprint = JSON.stringify(canonical(args));
    const prior = key && [...tasks.values()].find((task) => task.requestKey === key);
    if (prior) {
      if (prior.requestArguments !== fingerprint) throw new Error('client_request_id was already used for different task arguments.');
      if (receipts.has(key)) return receipts.get(key).operation;
      return { childId: prior.childId, taskId: prior.taskId, result: Promise.resolve(prior), dispose: () => cancel(parent, prior.taskId), recovered: true };
    }
    const pending = key && receipts.get(key);
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw new Error('client_request_id was already used for different task arguments.');
      return pending.operation;
    }
    // Reserve identity before invoking preparation, including synchronous failures.
    const operation = Promise.resolve().then(() => start(key, fingerprint));
    if (key) {
      const receipt = { fingerprint, operation };
      receipts.set(key, receipt);
      operation.catch(() => { if (receipts.get(key) === receipt) receipts.delete(key); });
    }
    return operation;
  }
  function attach(parent, task, child) {
    active.set(task.childId, child);
    const result = child.result.catch((error) => ({ output: [], stopReason: 'error', diagnostic: error.message })).then((outcome) => finish(parent, task, outcome));
    result.finally(() => { if (active.get(task.childId) === child) active.delete(task.childId); }).catch((error) => ctx.logger.warn('Configured task settlement failed: %s', error.message));
    return { ...child, taskId: task.taskId, result };
  }
  async function snapshot(parent, id, acknowledge = false) {
    const task = get(parent.id, id);
    const { events } = terminal(task) ? { events: [] } : await observe(task.childId);
    const own = events.filter((event) => event.seq >= task.startSeq);
    const start = own.findLast((event) => event.type === 'turn/start');
    const tail = own.filter((event) => event.seq > (start?.seq ?? -1));
    const end = tail.findLast((event) => event.type === 'turn/end');
    const inbox = { 'next-turn': [], 'next-step': [] };
    for (const event of events) if (event.type === 'agent/inbox/spliced') {
      const splice = event.data;
      inbox[splice.target]?.splice(splice.start, splice.removedCount || 0, ...(splice.inserted || []));
    }
    let children = [];
    const child = service('agents').get(task.childId);
    if (child && ctx.get?.('subagents')) children = await listDirectChildren(service('subagents'), child.id);
    const pendingChildren = children.some((item) => service('agents').get(item.id)?.status !== undefined);
    const pendingInput = inbox['next-turn'].length + inbox['next-step'].length > 0;
    const running = !terminal(task);
    const pending = task.pendingInteraction || null;
    const value = { ...task, subagentId: task.childId, status: running ? 'running' : task.status,
      workState: !running ? 'result_available' : pending ? `waiting_for_${pending.kind}` : pendingChildren ? 'waiting_for_children' : pendingInput && !start ? 'queued' : 'working',
      output: running ? (tail.findLast((event) => event.type === 'assistant/message')?.data.message.content || []).filter((part) => part.type === 'text') : task.output,
      ...(end && running ? { latestTurnStatus: end.data.reason.kind } : {}), pendingInteraction: pending };
    if (acknowledge && terminal(task) && task.deliveryState !== 'disposed') { task.deliveryState = 'acknowledged'; save(); }
    // Internal idempotency data is never exposed to the model/UI.
    delete value.requestKey; delete value.requestArguments;
    return value;
  }
  async function cancel(parent, id) {
    const task = get(parent.id, id);
    task.deliveryState = 'disposed'; save();
    if (terminal(task)) return snapshot(parent, task.taskId);
    const child = service('agents').get(task.childId);
    child?.cancel({ kind: 'parent' }); // Clear pending input, unlike interrupt.
    const activation = active.get(task.childId);
    if (activation) await activation.dispose();
    else await service('subagents').drainChildren(parent, [task.childId]);
    for (const message of [...parent.inbox.nextTurn, ...parent.inbox.nextStep]) {
      if (message.source?.kind === 'subagent-settled' && message.source.runId === task.hostRunId) parent.inbox.remove(message.id);
    }
    if (!terminal(task)) await finish(parent, task, { output: [], stopReason: 'aborted', diagnostic: 'Task cancelled by its parent.' });
    return snapshot(parent, task.taskId);
  }
  async function recover(parent) {
    if (recovering.has(parent.id)) return recovering.get(parent.id);
    const operation = (async () => {
      for (const task of tasks.values()) {
        if (task.parentId !== parent.id || active.has(task.childId)) continue;
        if (!terminal(task) && !service('agents').get(task.childId)) {
          const { events } = await observe(task.childId).catch(() => ({ events: [] }));
          const end = events.findLast((event) => event.type === 'turn/end' && event.seq >= task.startSeq);
          const reason = end?.data.reason;
          const output = events.findLast((event) => event.type === 'assistant/message' && event.seq >= task.startSeq)?.data.message.content || [];
          await finish(parent, task, { output: output.filter((part) => part.type === 'text'),
            stopReason: reason?.kind === 'completed' ? 'completed' : ['interrupted', 'aborted'].includes(reason?.kind) ? 'aborted' : 'error',
            diagnostic: reason?.error?.message || (!end ? 'Host restarted before this task settled. Send an explicit follow-up to resume; its prompt was not replayed.' : undefined) });
        }
        if (terminal(task) && ['pending', 'delivered'].includes(task.deliveryState) && !delivered(parent, task)) {
          task.deliveryState = 'pending'; save(); await offer(parent, task);
        }
      }
    })().finally(() => recovering.delete(parent.id));
    recovering.set(parent.id, operation); return operation;
  }
  function install(scope) {
    scope.effect(() => scope.subagents.registerContinuationPolicy(TASK_ADMISSION, async ({ parent, childId, reason }) => {
      const task = latest(parent.id, childId);
      if (reason === 'settlement' && task?.deliveryState === 'disposed') {
        // The host retains refused notices in the inbox without waking. Remove
        // only this disposed task's notice when it is inserted below.
        throw new Error('Cancelled task delivery is disposed.');
      }
    }));
    scope.on('subagent/start', (info) => {
      if (info.provider !== 'configured-acp') return;
      const child = service('agents').get(info.id);
      const parent = child && service('agents').get(child.session.header.parentSession);
      if (!parent) return;
      let task = latest(parent.id, info.id);
      if (task?.hostRunId === info.runId) return;
      if (!task || terminal(task)) task = begin(parent, { ...task, childId: info.id }, { delivery: 'host', requestKey: undefined, requestArguments: undefined, endedAt: undefined, stopReason: undefined, diagnostic: undefined, pendingInteraction: undefined,
        task: text(child.inbox.nextStep.at(-1)?.content || child.inbox.nextTurn.at(-1)?.content) || task?.task });
      task.hostRunId = info.runId; save();
    }, { global: true });
    scope.on('subagent/end', (info) => {
      const task = [...tasks.values()].findLast((item) => item.hostRunId === info.runId);
      if (!task || task.delivery !== 'host' || terminal(task)) return;
      const parent = service('agents').get(task.parentId);
      if (parent) void finish(parent, task, { stopReason: info.stopReason, output: info.lastAssistantMessage || [] }).catch((error) => ctx.logger.warn(error.message));
    }, { global: true });
    scope.on('agent/created', async ({ agent }) => {
      if (tasks.size && [...tasks.values()].some((task) => task.parentId === agent.id)) await recover(agent);
    }, { global: true });
    scope.on('session/event', (session, event) => {
      if (event.type !== 'agent/inbox/spliced') return;
      const parent = service('agents').get(session.id);
      if (!parent) return;
      for (const message of event.data.inserted || []) {
        if (message.source?.kind !== 'subagent-settled') continue;
        const task = [...tasks.values()].find((item) => item.parentId === parent.id && item.hostRunId === message.source.runId);
        if (task?.deliveryState === 'disposed') parent.inbox.remove(message.id);
      }
    }, { global: true });
  }
  return { begin, attach, once, snapshot, cancel, recover, get, latest, install, save, finish, tasks,
    setInteraction(childId, interaction) {
      const task = [...tasks.values()].findLast((item) => item.childId === childId && !terminal(item));
      if (task) { task.pendingInteraction = interaction; save(); const parent = service('agents').get(task.parentId); if (parent) append(parent, 'state', task); }
    },
    async followup(parent, childId, message, signal) {
      const previous = latest(parent.id, childId);
      let task = previous;
      if (previous && terminal(previous)) task = begin(parent, { childId, agentId: previous.agentId, agentName: previous.agentName, model: previous.model, modelName: previous.modelName, task: message, cwd: previous.cwd, options: previous.options, interactionMode: previous.interactionMode, runtimeMode: previous.runtimeMode }, { delivery: 'host' });
      try { return await service('subagents').sendMessage(parent, childId, [{ type: 'text', text: message }], { signal }); }
      catch (error) { if (task !== previous) await finish(parent, task, { output: [], stopReason: 'error', diagnostic: error.message }); throw error; }
    },
  };
}
