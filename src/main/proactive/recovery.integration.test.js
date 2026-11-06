'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProactiveService } = require('./service');

function createUserDataPath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-proactive-recovery-'));
}

function createIds(prefix = 'id') {
  let next = 0;
  return () => `${prefix}-${next++}`;
}

test('recovers a truncated final event and resumes after restart', async () => {
  const userDataPath = createUserDataPath();
  const first = createProactiveService({
    userDataPath,
    now: () => '2026-11-05T00:00:00.000Z',
    idFactory: createIds('first'),
  });
  const task = await first.dispatch('task/create', { title: 'Recover me', autonomy: 2 });
  const eventPath = path.join(userDataPath, 'assistant', 'proactive-events.ndjson');

  // Simulate a process dying while appending the final JSON record.
  fs.appendFileSync(eventPath, '{"type":"task.transitioned"');

  const restarted = createProactiveService({
    userDataPath,
    now: () => '2026-11-05T00:01:00.000Z',
    idFactory: createIds('restart'),
  });
  assert.equal(restarted.runtime.getTask(task.id).state, 'discovered');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(eventPath, 'utf8').trim().split('\n').at(-1)));
  const transitioned = await restarted.dispatch('task/transition', {
    taskId: task.id,
    state: 'queued',
    idempotencyKey: 'recover-transition',
  });
  assert.equal(transitioned.state, 'queued');
});

test('duplicate task dispatch is idempotent across a restart', async () => {
  const userDataPath = createUserDataPath();
  const first = createProactiveService({
    userDataPath,
    now: () => '2026-11-05T00:00:00.000Z',
    idFactory: createIds('first'),
  });
  const input = {
    title: 'Only once',
    autonomy: 3,
    idempotencyKey: 'dispatch-once',
  };
  const task = await first.dispatch('task/create', input);
  const duplicate = await first.dispatch('task/create', input);
  assert.deepEqual(duplicate, task);

  const restarted = createProactiveService({
    userDataPath,
    now: () => '2026-11-05T00:01:00.000Z',
    idFactory: createIds('restart'),
  });
  const replay = await restarted.dispatch('task/create', input);
  assert.deepEqual(replay, task);
  assert.equal(restarted.runtime.listEvents().filter(event => event.type === 'task.created').length, 1);
  assert.equal(restarted.runtime.listInbox().length, 1);
});

test('approval can continue after the client disconnects and service restarts', async () => {
  const userDataPath = createUserDataPath();
  const first = createProactiveService({
    userDataPath,
    now: () => '2026-11-05T00:00:00.000Z',
    idFactory: createIds('first'),
  });
  const task = await first.dispatch('task/create', { title: 'Continue after reconnect', autonomy: 4 });
  const approval = await first.dispatch('approval/request', {
    taskId: task.id,
    action: 'Publish report',
    target: 'chatgpt',
    dataClass: 'regular',
    risk: 'medium',
  });
  assert.equal(first.runtime.getTask(task.id).state, 'waiting_approval');

  // The client and its in-memory service disappear; only the event log remains.
  const reconnected = createProactiveService({
    userDataPath,
    now: () => '2026-11-05T00:01:00.000Z',
    idFactory: createIds('reconnect'),
  });
  const decision = await reconnected.dispatch('approval/decide', {
    approvalId: approval.id,
    decision: 'approved',
  });
  assert.equal(decision.status, 'approved');
  assert.equal(decision.decision, 'approved');
  assert.equal(reconnected.runtime.getTask(task.id).state, 'resumed');
});

test('unknown IPC actions fail closed without mutating durable state', async () => {
  const userDataPath = createUserDataPath();
  const service = createProactiveService({
    userDataPath,
    now: () => '2026-11-05T00:00:00.000Z',
    idFactory: createIds('first'),
  });
  const task = await service.dispatch('task/create', { title: 'Reject unknown action' });
  const before = service.runtime.listEvents();
  await assert.rejects(
    () => service.dispatch('task/does-not-exist', { taskId: task.id }),
    error => error.code === 'proactive/unknown-action',
  );
  assert.deepEqual(service.runtime.listEvents(), before);
  assert.equal(service.runtime.getTask(task.id).state, 'discovered');
});

