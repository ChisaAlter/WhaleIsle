'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const { detectMagpieState, probeConcurrency } = require('./detect');

test('detectMagpieState covers external, external-ui-companion, managed-shared-config, and managed states', async () => {
  await withOwnedTempDir('magpie-detect-', async (configDir) => {
    // 1. Cold managed (no gateway, no shared config)
    const cold = await detectMagpieState({
      configDir,
      fetchJson: async () => { throw new Error('ECONNREFUSED'); },
      probeReachable: async () => false,
    });
    assert.equal(cold.ownership, 'managed');
    assert.equal(cold.running, false);
    assert.equal(cold.sharedConfig, false);

    // 2. Shared config present, gateway stopped -> managed-shared-config
    fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ port: 4100 }));
    const sharedStopped = await detectMagpieState({
      configDir,
      fetchJson: async () => { throw new Error('ECONNREFUSED'); },
      probeReachable: async () => false,
    });
    assert.equal(sharedStopped.ownership, 'managed-shared-config');
    assert.equal(sharedStopped.running, false);
    assert.equal(sharedStopped.sharedConfig, true);

    // 3. External gateway running + external Web UI reachable (not owned by managedState)
    fs.writeFileSync(path.join(configDir, 'web-page.json'), JSON.stringify({
      port: 3430,
      key: 'extkey',
    }));
    const externalFull = await detectMagpieState({
      configDir,
      fetchJson: async (url) => {
        if (url === 'http://127.0.0.1:4100/') return { name: 'magpie', version: '0.1.4708', pid: 9999 };
        throw new Error('unexpected');
      },
      probeReachable: async (url) => url === 'http://127.0.0.1:3430/boot.js',
    });
    assert.equal(externalFull.ownership, 'external');
    assert.equal(externalFull.running, true);
    assert.equal(externalFull.webUrl, 'http://127.0.0.1:3430/?k=extkey');

    // 4. External gateway running without Web UI -> external-ui-companion
    const externalGatewayOnly = await detectMagpieState({
      configDir,
      fetchJson: async () => ({ name: 'magpie', version: '0.1.4708', pid: 9999 }),
      probeReachable: async () => false,
    });
    assert.equal(externalGatewayOnly.ownership, 'external-ui-companion');
    assert.equal(externalGatewayOnly.running, true);

    // 5. Gateway PID matches live managedState -> managed-shared-config (or managed when managedOnly)
    const owned = await detectMagpieState({
      configDir,
      managedState: { pid: 4321, webUrl: 'http://127.0.0.1:3431/?k=mkey', port: 3431, key: 'mkey' },
      isPidAlive: (pid) => pid === 4321,
      fetchJson: async () => ({ name: 'magpie', version: '0.1.4708', pid: 4321 }),
      probeReachable: async (url) => url === 'http://127.0.0.1:3431/boot.js',
    });
    assert.equal(owned.ownership, 'managed-shared-config');
    assert.equal(owned.running, true);
    assert.equal(owned.webUrl, 'http://127.0.0.1:3431/?k=mkey');
  });
});

test('probeConcurrency normalizes active request/waiting/tool counters', async () => {
  const res = await probeConcurrency('127.0.0.1:3425', {
    fetchJson: async () => ({ requests: 2, waiting: 1, tools: 0 }),
  });
  assert.deepEqual(res, { requests: 2, waiting: 1, tools: 0 });
  const unreachable = await probeConcurrency('127.0.0.1:3425', {
    fetchJson: async () => { throw new Error('offline'); },
  });
  assert.equal(unreachable, null);
});
