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

// Sources are labels used for routing and filtering, not user content. Keep
// the trace projection bounded to a small, non-sensitive identifier set.
function safeSource(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z0-9._:-]+$/i.test(value)) return 'custom';
  return value;
}

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
    // Durable source projections are rebuilt from task.created and
    // source.synced events on every restart. A source item can therefore be
    // discovered repeatedly without creating another Inbox task.
    this.sourceItems = new Map();
    this.sourceState = new Map();
    for (const event of this.events) this.#apply(event);
  }

  createTask(input = {}) {
    const autonomy = Number(input.autonomy ?? 1);
    if (!AUTONOMY_LEVELS.has(autonomy)) throw new RangeError('autonomy must be an integer from 1 to 5');
    const idempotencyKey = input.idempotencyKey ?? null;
    if (idempotencyKey) {
      const existing = [...this.tasks.values()].find(task => task.idempotencyKey === idempotencyKey);
      if (existing) return clone(existing);
    }
    const source = String(input.source ?? 'manual');
    const sourceItemId = input.sourceItemId === undefined || input.sourceItemId === null
      ? null : String(input.sourceItemId);
    if (sourceItemId) {
      const existingTaskId = this.sourceItems.get(this.#sourceKey(source, sourceItemId));
      if (existingTaskId && this.tasks.has(existingTaskId)) return clone(this.tasks.get(existingTaskId));
    }
    const task = {
      id: input.id ?? this.idFactory(),
      title: String(input.title ?? 'Untitled task'),
      description: String(input.description ?? ''),
      autonomy,
      state: 'discovered',
      source,
      createdAt: this.now(),
      updatedAt: this.now(),
      approvalId: null,
      idempotencyKey,
    };
    if (sourceItemId) task.sourceItemId = sourceItemId;
    if (input.sourceUrl !== undefined) task.sourceUrl = input.sourceUrl;
    if (input.kind !== undefined) task.kind = input.kind;
    if (Array.isArray(input.labels)) task.labels = [...input.labels];
    if (input.updatedAt !== undefined) task.sourceUpdatedAt = input.updatedAt;
    this.#emit({ type: 'task.created', task });
    this.#emit({ type: 'inbox.upserted', item: {
      id: task.id, taskId: task.id, title: task.title, source: task.source,
      autonomy: task.autonomy, state: task.state, createdAt: task.createdAt,
      ...(task.sourceItemId ? { sourceItemId: task.sourceItemId } : {}),
      ...(task.sourceUrl !== undefined ? { sourceUrl: task.sourceUrl } : {}),
      ...(task.kind !== undefined ? { kind: task.kind } : {}),
      ...(task.labels ? { labels: [...task.labels] } : {}),
      ...(task.sourceUpdatedAt !== undefined ? { updatedAt: task.sourceUpdatedAt } : {}),
    } });
    return clone(task);
  }

  /**
   * Project read-only source candidates into Inbox. The source item key is
   * scoped by source so two providers may legitimately use the same ID.
   */
  ingestSourceItems(items, { source = 'unknown', autonomy = 1, cursor = null } = {}) {
    if (!Array.isArray(items)) throw new TypeError('source items must be an array');
    const normalizedSource = String(source || 'unknown');
    const created = [];
    let duplicates = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object') throw new TypeError('source item must be an object');
      const sourceItemId = item.sourceItemId ?? item.id;
      if (sourceItemId === undefined || sourceItemId === null || String(sourceItemId) === '') {
        throw new TypeError('source item needs an id');
      }
      const key = this.#sourceKey(normalizedSource, sourceItemId);
      if (this.sourceItems.has(key)) {
        duplicates += 1;
        continue;
      }
      const task = this.createTask({
        ...item,
        source: normalizedSource,
        sourceItemId,
        autonomy,
        idempotencyKey: item.idempotencyKey ?? `${normalizedSource}:${String(sourceItemId)}`,
      });
      created.push(task);
    }
    const sync = {
      type: 'source.synced',
      source: normalizedSource,
      cursor: cursor === null || cursor === undefined ? null : String(cursor),
      discovered: items.length,
      created: created.length,
      duplicates,
    };
    this.#emit(sync);
    return {
      source: normalizedSource,
      cursor: sync.cursor,
      discovered: items.length,
      duplicates,
      created: clone(created),
    };
  }

  transition(taskId, state, { actor = 'system', reason = '', idempotencyKey = null, evidence = [] } = {}) {
    if (!STATES.has(state)) throw new RangeError(`Unknown task state: ${state}`);
    const task = this.#task(taskId);
    if (TERMINAL_STATES.has(task.state)) throw new Error(`Task is already ${task.state}`);
    if (idempotencyKey && this.events.some(event => event.type === 'task.transitioned' && event.idempotencyKey === idempotencyKey)) {
      return clone(this.#task(taskId));
    }
    this.#emit({
      type: 'task.transitioned', taskId, state, fromState: task.state, source: task.source,
      actor, reason, evidence: clone(evidence), idempotencyKey,
    });
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
  listSourceState() {
    return clone(Object.fromEntries([...this.sourceState.entries()].map(([source, state]) => [source, state])));
  }
  listEvents() { return clone(this.events); }

  /**
   * Return a bounded, queryable view of task execution events.
   *
   * This deliberately does not expose event payloads. Titles, descriptions,
   * approval targets, notes and evidence can contain personal or secret data;
   * the trace only carries routing labels and lifecycle state changes.
   */
  listExecutionTrace({ taskId = null, source = null, since = null, until = null, limit = 100 } = {}) {
    const normalizedTaskId = taskId == null ? null : String(taskId);
    const normalizedSource = source == null ? null : safeSource(String(source));
    const max = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 200)) : 100;
    const traces = this.#executionTrace().filter((event) => {
      if (normalizedTaskId !== null && event.taskId !== normalizedTaskId) return false;
      if (normalizedSource !== null && event.source !== normalizedSource) return false;
      if (since != null && event.at < String(since)) return false;
      if (until != null && event.at > String(until)) return false;
      return true;
    });
    return clone(traces.slice(-max));
  }

  #task(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Unknown task');
    return task;
  }

  #sourceKey(source, sourceItemId) {
    return `${String(source)}:${String(sourceItemId)}`;
  }

  #emit(event) {
    const enriched = { ...event, eventId: this.idFactory(), at: this.now(), sequence: this.events.length + 1 };
    this.store.append(enriched);
    this.events.push(enriched);
    this.#apply(enriched);
  }

  #apply(event) {
    if (event.type === 'task.created') {
      this.tasks.set(event.task.id, clone(event.task));
      if (event.task.sourceItemId) {
        this.sourceItems.set(this.#sourceKey(event.task.source, event.task.sourceItemId), event.task.id);
      }
    }
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
    if (event.type === 'source.synced') this.sourceState.set(event.source, {
      cursor: event.cursor,
      at: event.at,
      discovered: event.discovered,
      created: event.created,
      duplicates: event.duplicates,
    });
  }

  #executionTrace() {
    const stateByTask = new Map();
    const sourceByTask = new Map();
    const traces = [];
    for (const event of this.events) {
      let taskId = null;
      let source = null;
      let state = null;
      let fromState = null;
      let toState = null;
      let action = null;

      if (event.type === 'task.created' && event.task?.id) {
        taskId = String(event.task.id);
        source = safeSource(event.task.source);
        state = event.task.state;
        toState = state;
        sourceByTask.set(taskId, source);
        stateByTask.set(taskId, state);
        action = 'task.created';
      } else if (event.type === 'task.transitioned' && event.taskId) {
        taskId = String(event.taskId);
        source = sourceByTask.get(taskId) || safeSource(event.source);
        fromState = event.fromState ?? stateByTask.get(taskId) ?? null;
        toState = event.state;
        state = toState;
        stateByTask.set(taskId, toState);
        action = 'task.transitioned';
      } else if (event.type === 'approval.requested' && event.approval?.taskId) {
        taskId = String(event.approval.taskId);
        source = sourceByTask.get(taskId) || 'custom';
        state = stateByTask.get(taskId) ?? null;
        fromState = state;
        toState = state;
        action = 'approval.requested';
      } else if (event.type === 'approval.decided' && event.approvalId) {
        const approval = this.outbox.get(event.approvalId);
        if (approval?.taskId) {
          taskId = String(approval.taskId);
          source = sourceByTask.get(taskId) || 'custom';
          state = stateByTask.get(taskId) ?? null;
          fromState = state;
          toState = state;
          action = 'approval.decided';
        }
      }

      if (!action || !taskId) continue;
      traces.push({ eventId: event.eventId, taskId, at: event.at, source, action, state, fromState, toState });
    }
    return traces;
  }
}

module.exports = { AUTONOMY_LEVELS, JsonEventStore, STATES, TaskRuntime };
