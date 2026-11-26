'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registerLauncherBridges,
  ensureMagpieRuntime,
  flushBootLogs,
} = require('./launcher-bridges');

test('launcher-bridges falls back cleanly when unregistered and dispatches once registered', async () => {
  registerLauncherBridges({ ensureMagpieRuntime: null, flushBootLogs: null });
  assert.equal(await ensureMagpieRuntime(), undefined);
  assert.deepEqual(await flushBootLogs(), []);

  let magpieCalls = 0;
  let flushCalls = 0;
  registerLauncherBridges({
    ensureMagpieRuntime: async () => { magpieCalls++; return 'ready'; },
    flushBootLogs: async () => { flushCalls++; return ['flushed']; },
  });
  assert.equal(await ensureMagpieRuntime(), 'ready');
  assert.deepEqual(await flushBootLogs(), ['flushed']);
  assert.equal(magpieCalls, 1);
  assert.equal(flushCalls, 1);

  registerLauncherBridges({ ensureMagpieRuntime: null, flushBootLogs: null });
  assert.equal(await ensureMagpieRuntime(), undefined);
  assert.deepEqual(await flushBootLogs(), []);
});
