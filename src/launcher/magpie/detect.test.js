'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const {
  detectMagpieState,
  hasSharedUserConfig,
  probeConcurrency,
  probeGateway,
  probeHttpReachable,
  resolveGatewayCandidates,
  toLoopbackHostPort,
} = require('./detect');

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

test('probeConcurrency normalizes active request/waiting/tool counters and fails closed on invalid payloads', async () => {
  const res = await probeConcurrency('127.0.0.1:3425', {
    fetchJson: async () => ({ requests: 2, waiting: 1, tools: 0 }),
  });
  assert.deepEqual(res, { requests: 2, waiting: 1, tools: 0 });
  const unreachable = await probeConcurrency('127.0.0.1:3425', {
    fetchJson: async () => { throw new Error('offline'); },
  });
  assert.equal(unreachable, null);
  for (const invalid of [[], {}, { requests: '2', waiting: 0, tools: 0 }, { requests: -1, waiting: 0, tools: 0 }, { requests: 0, waiting: NaN, tools: 0 }]) {
    assert.equal(
      await probeConcurrency('127.0.0.1:3425', { fetchJson: async () => invalid }),
      null,
    );
  }
});

test('toLoopbackHostPort enforces loopback whitelist and rejects non-loopback/userinfo/path', async () => {
  assert.equal(toLoopbackHostPort('127.0.0.1:3425'), '127.0.0.1:3425');
  assert.equal(toLoopbackHostPort('localhost:4000'), 'localhost:4000');
  assert.equal(toLoopbackHostPort('[::1]:3425'), '[::1]:3425');
  assert.equal(toLoopbackHostPort('::1'), '[::1]:3425');
  assert.equal(toLoopbackHostPort('::'), '127.0.0.1:3425');
  assert.equal(toLoopbackHostPort(':3425'), '127.0.0.1:3425');
  assert.equal(toLoopbackHostPort('0.0.0.0:3425'), '127.0.0.1:3425');

  for (const bad of ['evil.example:3425', '192.168.1.2:3425', 'user@127.0.0.1:3425', '127.0.0.1:3425/steal']) {
    assert.throws(() => toLoopbackHostPort(bad), /非回环|非法/);
  }
  let fetched = 0;
  const gw = await probeGateway('evil.example:3425', {
    fetchJson: async () => { fetched += 1; return { name: 'magpie' }; },
  });
  assert.equal(gw, null);
  assert.equal(fetched, 0);
});

test('hasSharedUserConfig recognizes non-ephemeral files and probeHttpReachable enforces JS content-type on /boot.js', async () => {
  await withOwnedTempDir('magpie-shared-cfg-', async (configDir) => {
    fs.writeFileSync(path.join(configDir, 'gateway.json'), '{}');
    fs.writeFileSync(path.join(configDir, 'service.lock'), '');
    assert.equal(hasSharedUserConfig(configDir), false);
    fs.writeFileSync(path.join(configDir, 'plugin-auth.json'), '{}');
    assert.equal(hasSharedUserConfig(configDir), true);
  });
  assert.equal(await probeHttpReachable('http://127.0.0.1:3430/boot.js', {
    fetchImpl: async () => new Response('not found', { status: 404 }),
  }), false);
  assert.equal(await probeHttpReachable('http://127.0.0.1:3430/boot.js', {
    fetchImpl: async () => new Response('<html>spa</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  }), false);
  assert.equal(await probeHttpReachable('http://127.0.0.1:3430/boot.js', {
    fetchImpl: async () => new Response('unauthorized', { status: 401, headers: { 'content-type': 'application/javascript' } }),
  }), false);
  assert.equal(await probeHttpReachable('http://127.0.0.1:3430/boot.js', {
    fetchImpl: async () => new Response('boot', { status: 200, headers: { 'content-type': 'application/javascript; charset=utf-8' } }),
  }), true);
});

test('detectMagpieState falls back across gateway candidates, requires matching PID, and filters draining gateways', async () => {
  await withOwnedTempDir('magpie-detect-edge-', async (configDir) => {
    // 1. Stale gateway.json with dead PID is skipped and probe falls back through settings.json -> 3425
    fs.writeFileSync(path.join(configDir, 'gateway.json'), JSON.stringify({ addr: '127.0.0.1:19999', pid: 77777 }));
    fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ port: 4100 }));
    const cands = resolveGatewayCandidates(configDir, { isPidAlive: (pid) => pid !== 77777 });
    assert.deepEqual(cands.map((c) => c.addr), ['127.0.0.1:4100', '127.0.0.1:3425']);

    // Even if gateway.json has live/unknown pid on dead port, multi-candidate probe falls back to 3425
    fs.writeFileSync(path.join(configDir, 'gateway.json'), JSON.stringify({ addr: '127.0.0.1:19999' }));
    const probedFallback = await detectMagpieState({
      configDir,
      fetchJson: async (url) => {
        if (url === 'http://127.0.0.1:3425/') return { name: 'magpie', version: '0.1.4800', pid: 8888 };
        throw new Error('ECONNREFUSED');
      },
      probeReachable: async () => false,
    });
    assert.equal(probedFallback.running, true);
    assert.equal(probedFallback.gateway.addr, '127.0.0.1:3425');
    assert.equal(probedFallback.ownership, 'external-ui-companion');

    // 2. Gateway response without pid must NOT be claimed by liveManaged
    const noPidGateway = await detectMagpieState({
      configDir,
      managedState: { pid: 4321, webUrl: 'http://127.0.0.1:3431/?k=mkey', port: 3431, key: 'mkey' },
      isPidAlive: (pid) => pid === 4321,
      fetchJson: async (url) => {
        if (url === 'http://127.0.0.1:3425/') return { name: 'magpie', version: '0.1.4800' };
        throw new Error('ECONNREFUSED');
      },
      probeReachable: async (url) => url === 'http://127.0.0.1:3431/boot.js',
    });
    assert.equal(noPidGateway.ownership, 'external-ui-companion');

    // 3. Draining gateway is ignored as non-reusable
    const draining = await detectMagpieState({
      configDir,
      fetchJson: async (url) => {
        if (url === 'http://127.0.0.1:3425/') return { name: 'magpie', version: '0.1.4800', pid: 8888, draining: true };
        throw new Error('ECONNREFUSED');
      },
      probeReachable: async () => false,
    });
    assert.equal(draining.running, false);
    assert.equal(draining.gateway, null);
  });
});
