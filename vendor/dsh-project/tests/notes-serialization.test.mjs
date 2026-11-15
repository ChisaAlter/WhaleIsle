import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectService } from './harness-runtime.mjs';

// notes.md is rewritten by temp file + rename; two rewrites racing onto the same
// file fail with EPERM on Windows, so rewrites of one Project must not overlap.
test('notes rewrites of one Project run one at a time and later calls still run after a failure', async () => {
  const events = [];
  let active = 0, overlap = false, calls = 0;
  const host = {
    notesWrites: new Map(),
    async writeNotes(id) {
      const call = ++calls;
      active += 1; if (active > 1) overlap = true;
      events.push(`start ${id}#${call}`);
      await new Promise(resolve => setTimeout(resolve, 10));
      events.push(`end ${id}#${call}`);
      active -= 1;
      if (call === 1) throw new Error('first write failed');
    },
  };
  const notes = id => ProjectService.prototype.notes.call(host, id);
  const results = await Promise.allSettled([notes('p'), notes('p'), notes('p')]);
  assert.equal(overlap, false);
  assert.deepEqual(events, ['start p#1', 'end p#1', 'start p#2', 'end p#2', 'start p#3', 'end p#3']);
  assert.equal(results[0].status, 'rejected');
  assert.deepEqual(results.slice(1).map(result => result.status), ['fulfilled', 'fulfilled']);
  assert.equal(host.notesWrites.size, 0);
});

test('notes rewrites of different Projects are not serialized against each other', async () => {
  let active = 0, peak = 0;
  const host = {
    notesWrites: new Map(),
    async writeNotes() { active += 1; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 10)); active -= 1; },
  };
  const notes = id => ProjectService.prototype.notes.call(host, id);
  await Promise.all([notes('a'), notes('b')]);
  assert.equal(peak, 2);
});
