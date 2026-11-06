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
