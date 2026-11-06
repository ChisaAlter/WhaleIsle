'use strict';

const path = require('node:path');
const { JsonEventStore, TaskRuntime } = require('./task-runtime');
const { TaskScheduler } = require('./scheduler');
const { createProactiveIpc } = require('./ipc');

function createProactiveService({ userDataPath, now, idFactory, githubSource = null } = {}) {
  if (!userDataPath) throw new TypeError('createProactiveService needs userDataPath');
  const store = new JsonEventStore(path.join(userDataPath, 'assistant', 'proactive-events.ndjson'));
  const runtime = new TaskRuntime({ store, now, idFactory });
  const scheduler = new TaskScheduler({ store, now, idFactory });
  const syncGitHub = async ({ since, cursor, autonomy = 1 } = {}) => {
    if (!githubSource || typeof githubSource.discover !== 'function') {
      throw Object.assign(new Error('GitHub source unavailable'), { code: 'proactive/source-unavailable' });
    }
    const previous = runtime.listSourceState().github;
    const requestedSince = cursor === undefined ? since : cursor;
    const effectiveSince = requestedSince === undefined ? previous?.cursor ?? null : requestedSince;
    const items = await githubSource.discover({ since: effectiveSince });
    // Cursors are monotonic. A manual full sync with an older `since` value
    // must not move the durable checkpoint backwards.
    const cursorSeed = [previous?.cursor, effectiveSince]
      .filter(value => value !== null && value !== undefined && String(value).trim())
      .map(String)
      .sort()
      .at(-1) ?? null;
    const nextCursor = items.reduce((latest, item) => {
      const updatedAt = item?.updatedAt;
      if (!updatedAt) return latest;
      return !latest || String(updatedAt) > String(latest) ? updatedAt : latest;
    }, cursorSeed);
    return runtime.ingestSourceItems(items, { source: 'github', autonomy, cursor: nextCursor });
  };
  const ipc = createProactiveIpc({ runtime, scheduler, sources: { github: { sync: syncGitHub } } });
  return { store, runtime, scheduler, dispatch: ipc.dispatch };
}

module.exports = { createProactiveService };
