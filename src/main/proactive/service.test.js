'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProactiveService } = require('./service');

test('creates one durable service rooted in user data', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-service-'));
  const service = createProactiveService({ userDataPath, now: () => '2026-11-05T00:00:00Z', idFactory: (() => { let i = 0; return () => `id-${i++}`; })() });
  const task = await service.dispatch('task/create', { title: 'Persist through restart', autonomy: 2 });
  assert.equal(task.title, 'Persist through restart');
  assert.ok(fs.existsSync(path.join(userDataPath, 'assistant', 'proactive-events.ndjson')));
  const restarted = createProactiveService({ userDataPath, now: () => '2026-11-05T00:01:00Z', idFactory: () => 'restart-id' });
  assert.equal(restarted.runtime.getTask(task.id).title, 'Persist through restart');
});

test('syncs GitHub items into durable Inbox and preserves the cursor', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-service-source-'));
  const calls = [];
  const githubSource = {
    discover: async options => {
      calls.push(options);
      return [{
        id: 'github:9', title: 'Review PR', description: 'Read only', source: 'github',
        sourceUrl: 'https://github.com/ChisaAlter/WhaleIsle/pull/9', kind: 'pull_request',
        labels: [], updatedAt: '2026-11-05T00:00:00Z',
      }];
    },
  };
  const service = createProactiveService({
    userDataPath,
    githubSource,
    now: () => '2026-11-05T00:00:00Z',
    idFactory: (() => { let i = 0; return () => `id-${i++}`; })(),
  });

  const first = await service.dispatch('source/github/sync', { autonomy: 1 });
  const second = await service.dispatch('source/github/sync', { autonomy: 1 });
  assert.equal(first.created.length, 1);
  assert.equal(second.created.length, 0);
  assert.equal(second.duplicates, 1);
  assert.equal((await service.dispatch('inbox/list')).length, 1);
  assert.equal((await service.dispatch('source/state')).github.cursor, '2026-11-05T00:00:00Z');
  assert.deepEqual(calls, [{ since: null }, { since: '2026-11-05T00:00:00Z' }]);

  const restarted = createProactiveService({ userDataPath, githubSource, now: () => '2026-11-05T00:01:00Z' });
  assert.equal((await restarted.dispatch('source/github/sync')).created.length, 0);
  assert.equal((await restarted.dispatch('inbox/list')).length, 1);
});
