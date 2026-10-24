const { test } = require('node:test');
const assert = require('node:assert/strict');

const importGuard = require('./import-guard');
const { applyRendererConfigPatch } = require('./profile-ops');

function store(initial) {
  let config = { ...initial };
  return { io: { load: () => config, save: patch => { config = { ...config, ...patch }; return config; } }, read: () => config };
}

test('a cancelled toggle restart writes the toggle back and reports it to the Settings window', async () => {
  const config = store({ projectEnabled: true, dshbotEnabled: false }), logs = [];
  const saved = await applyRendererConfigPatch({ projectEnabled: false }, {
    harness: {}, configIO: config.io, waitForRestart: true, log: line => logs.push(line),
    startHarness: async () => ({ proceeded: false, code: 'cancelled' }),
  });
  assert.equal(saved.projectEnabled, true);
  assert.equal(saved.restartCancelled, true);
  assert.equal(config.read().projectEnabled, true, 'The config keeps matching the running Harness');
  assert.match(logs[0], /cancelled/);
  assert.equal(importGuard.isMaintenanceHeld(), false);
});

test('a completed toggle restart keeps the new value without asking again', async () => {
  const config = store({ dshbotEnabled: false });
  const restarts = [];
  const saved = await applyRendererConfigPatch({ dshbotEnabled: true }, {
    harness: {}, configIO: config.io, waitForRestart: true, startHarness: async (_token, options) => { restarts.push(options); },
  });
  assert.deepEqual(restarts, [{ preConfirmed: true }]);
  assert.equal(saved.dshbotEnabled, true);
  assert.equal(saved.restartCancelled, undefined);
  assert.equal(config.read().dshbotEnabled, true);
});

test('a restart that fails after teardown is not mistaken for a refusal', async () => {
  for (const startHarness of [async () => ({ ok: false, error: 'start failed' }), async () => { throw new Error('boom'); }]) {
    const config = store({ remoteWorkspaceEnabled: true });
    const saved = await applyRendererConfigPatch({ remoteWorkspaceEnabled: false }, { harness: {}, configIO: config.io, waitForRestart: true, startHarness });
    assert.equal(saved.remoteWorkspaceEnabled, false);
    assert.equal(config.read().remoteWorkspaceEnabled, false, 'The attempted start used the new value');
  }
});

test('callers that do not wait get the saved config first and a refused restart still writes the toggle back', async () => {
  const config = store({ whaleAssistantEnabled: false });
  let settle;
  const settled = new Promise(resolve => { settle = resolve; });
  const saved = applyRendererConfigPatch({ whaleAssistantEnabled: true }, {
    harness: {}, configIO: config.io,
    startHarness: async () => { setImmediate(settle); return { proceeded: false, code: 'maintenance-in-progress' }; },
  });
  assert.equal(saved.whaleAssistantEnabled, true, 'Returned synchronously before the restart');
  await settled;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(config.read().whaleAssistantEnabled, false);
  assert.equal(importGuard.isMaintenanceHeld(), false);
});

test('patches without a built-in plugin toggle neither restart nor wait', () => {
  const config = store({ closeToTray: true });
  const saved = applyRendererConfigPatch({ closeToTray: false }, {
    harness: {}, configIO: config.io, waitForRestart: true, startHarness: async () => { throw new Error('must not restart'); },
  });
  assert.equal(saved.closeToTray, false);
  assert.equal(importGuard.isMaintenanceHeld(), false);
});
