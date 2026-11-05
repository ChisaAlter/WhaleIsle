'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonEventStore, TaskRuntime } = require('./task-runtime');

function runtime() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-proactive-'));
  const store = new JsonEventStore(path.join(directory, 'events.ndjson'));
  return { directory, store, runtime: new TaskRuntime({
    store,
    now: (() => { let i = 0; return () => `2026-11-05T00:00:0${i++}Z`; })(),
    idFactory: (() => { let i = 0; return () => `id-${i++}`; })(),
  }) };
}

test('creates a task and projects it into Inbox', () => {
  const { runtime } = runtime();
  const task = runtime.createTask({ title: 'Review GitHub issues', autonomy: 2, source: 'github' });
  assert.equal(task.state, 'discovered');
  assert.deepEqual(runtime.listInbox(), [{
    id: task.id, taskId: task.id, title: 'Review GitHub issues', source: 'github',
    autonomy: 2, state: 'discovered', createdAt: task.createdAt,
  }]);
});

test('approval pauses and resumes the exact task', () => {
  const { runtime } = runtime();
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
  const first = runtime();
  const task = first.runtime.createTask({ title: 'Persist me', autonomy: 3 });
  first.runtime.requestApproval(task.id, { action: 'Run bounded work' });
  const restarted = new TaskRuntime({ store: first.store, idFactory: () => 'restart-id', now: () => '2026-11-05T00:01:00Z' });
  assert.equal(restarted.getTask(task.id).state, 'waiting_approval');
  assert.equal(restarted.listInbox()[0].title, 'Persist me');
  assert.equal(restarted.listOutbox()[0].action, 'Run bounded work');
});

test('idempotency prevents duplicate transitions', () => {
  const { runtime } = runtime();
  const task = runtime.createTask({ title: 'One transition' });
  runtime.transition(task.id, 'queued', { idempotencyKey: 'transition-1' });
  runtime.transition(task.id, 'queued', { idempotencyKey: 'transition-1' });
  assert.equal(runtime.listEvents().filter(event => event.type === 'task.transitioned').length, 1);
});
