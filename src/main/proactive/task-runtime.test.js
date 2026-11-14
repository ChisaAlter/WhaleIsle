'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonEventStore, TaskRuntime } = require('./task-runtime');

function createRuntime() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-proactive-'));
  const store = new JsonEventStore(path.join(directory, 'events.ndjson'));
  return { directory, store, runtime: new TaskRuntime({
    store,
    now: (() => { let i = 0; return () => `2026-11-05T00:00:0${i++}Z`; })(),
    idFactory: (() => { let i = 0; return () => `id-${i++}`; })(),
  }) };
}

test('creates a task and projects it into Inbox', () => {
  const { runtime } = createRuntime();
  const task = runtime.createTask({ title: 'Review GitHub issues', autonomy: 2, source: 'github' });
  assert.equal(task.state, 'discovered');
  assert.deepEqual(runtime.listInbox(), [{
    id: task.id, taskId: task.id, title: 'Review GitHub issues', source: 'github',
    autonomy: 2, state: 'discovered', createdAt: task.createdAt,
  }]);
});

test('approval pauses and resumes the exact task', () => {
  const { runtime } = createRuntime();
  const task = runtime.createTask({ title: 'Send report', autonomy: 4 });
  const approval = runtime.requestApproval(task.id, {
    action: 'Send report to the user',
    target: 'chatgpt',
    dataClass: 'regular',
    risk: 'medium',
  });
  assert.equal(runtime.getTask(task.id).state, 'waiting_approval');
  const decided = runtime.decideApproval(approval.id, 'approved');
  assert.equal(decided.status, 'approved');
  assert.equal(runtime.getTask(task.id).state, 'resumed');
  assert.equal(runtime.listOutbox()[0].decision, 'approved');
});

test('replays tasks, approvals and projections after restart', () => {
  const first = createRuntime();
  const task = first.runtime.createTask({ title: 'Persist me', autonomy: 3 });
  first.runtime.requestApproval(task.id, { action: 'Run bounded work' });
  const restarted = new TaskRuntime({ store: first.store, idFactory: () => 'restart-id', now: () => '2026-11-05T00:01:00Z' });
  assert.equal(restarted.getTask(task.id).state, 'waiting_approval');
  assert.equal(restarted.listInbox()[0].title, 'Persist me');
  assert.equal(restarted.listOutbox()[0].action, 'Run bounded work');
});

test('idempotency prevents duplicate transitions', () => {
  const { runtime } = createRuntime();
  const task = runtime.createTask({ title: 'One transition' });
  runtime.transition(task.id, 'queued', { idempotencyKey: 'transition-1' });
  runtime.transition(task.id, 'queued', { idempotencyKey: 'transition-1' });
  assert.equal(runtime.listEvents().filter(event => event.type === 'task.transitioned').length, 1);
});

test('durably deduplicates source items by sourceItemId and checkpoints cursor', () => {
  const first = createRuntime();
  const item = {
    sourceItemId: '42', id: 'github:42', title: 'Fix the sync', description: 'Read-only source item',
    source: 'github', sourceUrl: 'https://github.com/ChisaAlter/WhaleIsle/issues/42',
    kind: 'issue', labels: ['bug'], updatedAt: '2026-11-05T00:00:00Z',
  };

  const firstSync = first.runtime.ingestSourceItems([item], { source: 'github', autonomy: 1, cursor: item.updatedAt });
  const duplicateSync = first.runtime.ingestSourceItems([item], { source: 'github', autonomy: 1, cursor: item.updatedAt });
  assert.equal(firstSync.created.length, 1);
  assert.equal(duplicateSync.created.length, 0);
  assert.equal(duplicateSync.duplicates, 1);
  assert.equal(first.runtime.listInbox()[0].sourceItemId, '42');
  assert.equal(first.runtime.listSourceState().github.cursor, item.updatedAt);

  const restarted = new TaskRuntime({ store: first.store, idFactory: () => 'restart-id', now: () => '2026-11-05T00:01:00Z' });
  const replaySync = restarted.ingestSourceItems([item], {
    source: 'github', autonomy: 1, cursor: item.updatedAt,
  });
  assert.equal(replaySync.created.length, 0);
  assert.equal(restarted.listInbox().length, 1);
  assert.equal(restarted.listSourceState().github.cursor, item.updatedAt);
});

test('projects a safe execution trace that survives restart', () => {
  const first = createRuntime();
  const task = first.runtime.createTask({
    title: 'Private task title',
    description: 'private task description',
    source: 'github',
  });
  first.runtime.transition(task.id, 'queued', { actor: 'scheduler', reason: 'private reason' });
  first.runtime.requestApproval(task.id, {
    action: 'Send private report',
    target: 'private@example.com',
    dataClass: 'sensitive',
  });

  const trace = first.runtime.listExecutionTrace({ taskId: task.id });
  assert.deepEqual(trace.map(({ action, source, fromState, toState }) => ({ action, source, fromState, toState })), [
    { action: 'task.created', source: 'github', fromState: null, toState: 'discovered' },
    { action: 'task.transitioned', source: 'github', fromState: 'discovered', toState: 'queued' },
    { action: 'approval.requested', source: 'github', fromState: 'queued', toState: 'queued' },
    { action: 'task.transitioned', source: 'github', fromState: 'queued', toState: 'waiting_approval' },
  ]);
  assert.ok(trace.every(event => event.taskId === task.id && event.at && event.eventId));
  const serialized = JSON.stringify(trace);
  assert.doesNotMatch(serialized, /Private task title|private task description|private@example\.com|Send private report|private reason/);

  const restarted = new TaskRuntime({ store: first.store, idFactory: () => 'restart-id', now: () => '2026-11-05T00:01:00Z' });
  assert.deepEqual(restarted.listExecutionTrace({ taskId: task.id }), trace);
});
