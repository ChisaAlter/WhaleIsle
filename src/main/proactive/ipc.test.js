'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProactiveIpc } = require('./ipc');

test('dispatches task and Inbox operations through one boundary', async () => {
  const calls = [];
  const runtime = {
    createTask: input => { calls.push(['createTask', input]); return { id: 'task-1' }; },
    listInbox: () => [{ id: 'task-1' }],
    listExecutionTrace: input => { calls.push(['listExecutionTrace', input]); return [{ taskId: 'task-1', action: 'task.created' }]; },
  };
  const scheduler = { list: () => [] };
  const ipc = createProactiveIpc({ runtime, scheduler });
  assert.deepEqual(await ipc.dispatch('task/create', { title: 'Review' }), { id: 'task-1' });
  assert.deepEqual(await ipc.dispatch('inbox/list'), [{ id: 'task-1' }]);
  assert.deepEqual(await ipc.dispatch('trace/list', { taskId: 'task-1', limit: 10 }), [{ taskId: 'task-1', action: 'task.created' }]);
  assert.deepEqual(calls, [
    ['createTask', { title: 'Review' }],
    ['listExecutionTrace', { taskId: 'task-1', limit: 10 }],
  ]);
});

test('rejects unknown actions with a stable error code', async () => {
  const ipc = createProactiveIpc({ runtime: {}, scheduler: {} });
  await assert.rejects(() => ipc.dispatch('nope'), error => error.code === 'proactive/unknown-action');
});
