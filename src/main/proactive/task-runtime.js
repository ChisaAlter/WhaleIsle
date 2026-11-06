'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STATES = new Set([
  'discovered', 'triaged', 'queued', 'planning', 'running',
  'waiting_input', 'waiting_approval', 'resumed', 'verifying',
  'delivered', 'failed', 'cancelled',
]);

const TERMINAL_STATES = new Set(['delivered', 'failed', 'cancelled']);
const AUTONOMY_LEVELS = new Set([1, 2, 3, 4, 5]);

class JsonEventStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    try {
      return fs.readFileSync(this.filePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  append(event) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(event) + '\n';
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, line, { encoding: 'utf8', flag: 'wx' });
    try {
      fs.appendFileSync(this.filePath, line, { encoding: 'utf8' });
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
    return event;
  }
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

class TaskRuntime {
  constructor({ store, now = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
    if (!store || typeof store.read !== 'function' || typeof store.append !== 'function') {
      throw new TypeError('TaskRuntime needs an event store');
    }
    this.store = store;
    this.now = now;
    this.idFactory = idFactory;
    this.events = store.read();
    this.tasks = new Map();
    this.inbox = new Map();
    this.outbox = new Map();
    for (const event of this.events) this.#apply(event);
  }

  createTask(input = {}) {
    const autonomy = Number(input.autonomy ?? 1);
    if (!AUTONOMY_LEVELS.has(autonomy)) throw new RangeError('autonomy must be an integer from 1 to 5');
    const task = {
      id: input.id ?? this.idFactory(),
      title: String(input.title ?? 'Untitled task'),
      description: String(input.description ?? ''),
      autonomy,
      state: 'discovered',
      source: input.source ?? 'manual',
      createdAt: this.now(),
      updatedAt: this.now(),
      approvalId: null,
      idempotencyKey: input.idempotencyKey ?? null,
    };
    this.#emit({ type: 'task.created', task });
    this.#emit({ type: 'inbox.upserted', item: {
      id: task.id, taskId: task.id, title: task.title, source: task.source,
      autonomy: task.autonomy, state: task.state, createdAt: task.createdAt,
    } });
    return clone(task);
  }

  transition(taskId, state, { actor = 'system', reason = '', idempotencyKey = null, evidence = [] } = {}) {
    if (!STATES.has(state)) throw new RangeError(`Unknown task state: ${state}`);
    const task = this.#task(taskId);
    if (TERMINAL_STATES.has(task.state)) throw new Error(`Task is already ${task.state}`);
    if (idempotencyKey && this.events.some(event => event.type === 'task.transitioned' && event.idempotencyKey === idempotencyKey)) {
      return clone(this.#task(taskId));
    }
    this.#emit({ type: 'task.transitioned', taskId, state, actor, reason, evidence: clone(evidence), idempotencyKey });
    return clone(this.#task(taskId));
  }

  requestApproval(taskId, input = {}) {
    const task = this.#task(taskId);
    if (TERMINAL_STATES.has(task.state)) throw new Error('Cannot approve a terminal task');
    const approval = {
      id: input.id ?? this.idFactory(),
      taskId,
      action: String(input.action ?? 'Continue task'),
      target: input.target ?? null,
      dataClass: input.dataClass ?? 'non-sensitive',
      risk: input.risk ?? 'low',
      status: 'pending',
      createdAt: this.now(),
      decidedAt: null,
      decidedBy: null,
      decision: null,
    };
    this.#emit({ type: 'approval.requested', approval });
    this.transition(taskId, 'waiting_approval', { actor: 'policy', reason: 'Human approval required' });
    this.#emit({ type: 'outbox.upserted', item: {
      id: approval.id, taskId, action: approval.action, target: approval.target,
      dataClass: approval.dataClass, risk: approval.risk, status: approval.status,
      createdAt: approval.createdAt,
    } });
    return clone(approval);
  }

  decideApproval(approvalId, decision, { actor = 'user', note = '' } = {}) {
    if (!['approved', 'rejected'].includes(decision)) throw new RangeError('decision must be approved or rejected');
    const approval = this.outbox.get(approvalId);
    if (!approval) throw new Error('Unknown approval');
    if (approval.status !== 'pending') return clone(approval);
    this.#emit({ type: 'approval.decided', approvalId, decision, actor, note });
    this.#emit({ type: 'outbox.updated', approvalId, status: decision, decidedAt: this.now(), decidedBy: actor });
    this.transition(approval.taskId, decision === 'approved' ? 'resumed' : 'failed', {
      actor, reason: decision === 'approved' ? 'Approval granted' : 'Approval rejected',
    });
    return clone(this.outbox.get(approvalId));
  }

  getTask(taskId) { return clone(this.#task(taskId)); }
  listInbox() { return clone([...this.inbox.values()]); }
  listOutbox() { return clone([...this.outbox.values()]); }
  listEvents() { return clone(this.events); }

  #task(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Unknown task');
    return task;
  }

  #emit(event) {
    const enriched = { ...event, eventId: this.idFactory(), at: this.now(), sequence: this.events.length + 1 };
    this.store.append(enriched);
    this.events.push(enriched);
    this.#apply(enriched);
  }

  #apply(event) {
    if (event.type === 'task.created') this.tasks.set(event.task.id, clone(event.task));
    if (event.type === 'task.transitioned') {
      const task = this.tasks.get(event.taskId);
      if (task) Object.assign(task, { state: event.state, updatedAt: event.at, lastReason: event.reason, lastEvidence: clone(event.evidence) });
    }
    if (event.type === 'inbox.upserted') this.inbox.set(event.item.id, clone(event.item));
    if (event.type === 'approval.requested') this.outbox.set(event.approval.id, clone(event.approval));
    if (event.type === 'outbox.upserted') this.outbox.set(event.item.id, clone({ ...this.outbox.get(event.item.id), ...event.item }));
    if (event.type === 'outbox.updated') {
      const item = this.outbox.get(event.approvalId);
      if (item) Object.assign(item, { status: event.status, decidedAt: event.decidedAt, decidedBy: event.decidedBy });
    }
    if (event.type === 'approval.decided') {
      const item = this.outbox.get(event.approvalId);
      if (item) item.decision = event.decision;
    }
  }
}

module.exports = { AUTONOMY_LEVELS, JsonEventStore, STATES, TaskRuntime };
