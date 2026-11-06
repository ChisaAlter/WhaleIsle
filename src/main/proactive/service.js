'use strict';

const path = require('node:path');
const { JsonEventStore, TaskRuntime } = require('./task-runtime');
const { TaskScheduler } = require('./scheduler');
const { createProactiveIpc } = require('./ipc');

function createProactiveService({ userDataPath, now, idFactory } = {}) {
  if (!userDataPath) throw new TypeError('createProactiveService needs userDataPath');
  const store = new JsonEventStore(path.join(userDataPath, 'assistant', 'proactive-events.ndjson'));
  const runtime = new TaskRuntime({ store, now, idFactory });
  const scheduler = new TaskScheduler({ store, now, idFactory });
  const ipc = createProactiveIpc({ runtime, scheduler });
  return { store, runtime, scheduler, dispatch: ipc.dispatch };
}

module.exports = { createProactiveService };
