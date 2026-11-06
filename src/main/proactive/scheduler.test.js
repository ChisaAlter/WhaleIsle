'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonEventStore } = require('./task-runtime');
const { TaskScheduler } = require('./scheduler');

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-scheduler-'));
  const store = new JsonEventStore(path.join(directory, 'events.ndjson'));
  return { store, scheduler: new TaskScheduler({ store, now: () => '2026-11-05T00:00:00Z', idFactory: (() => { let i = 0; return () => `schedule-${i++}`; })() }) };
}

test('fires one-shot jobs once and restores them from events', () => {
  const { store, scheduler } = setup();
  scheduler.schedule('task-1', { at: '2026-11-04T23:59:00Z' });
  assert.equal(scheduler.poll('2026-11-05T00:00:00Z').length, 1);
  assert.equal(scheduler.poll('2026-11-05T00:01:00Z').length, 0);
  const restored = new TaskScheduler({ store, now: () => '2026-11-05T00:00:00Z', idFactory: () => 'restored-id' });
  assert.equal(restored.list()[0].status, 'fired');
});

test('reschedules recurring jobs and can cancel them', () => {
  const { scheduler } = setup();
  const job = scheduler.schedule('task-2', { at: '2026-11-05T00:00:00Z', intervalMs: 60_000 });
  assert.equal(scheduler.poll('2026-11-05T00:00:00Z')[0].id, job.id);
  assert.equal(scheduler.list()[0].at, '2026-11-05T00:01:00.000Z');
  scheduler.cancel(job.id);
  assert.equal(scheduler.list()[0].status, 'cancelled');
});
