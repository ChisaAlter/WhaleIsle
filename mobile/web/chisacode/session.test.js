import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentRows,
  buildClientRelayUrl,
  currentClientId,
  deviceNameFromUa,
  formatCustomIceServersText,
  loadCustomIceServers,
  normalizeOfferUrl,
  pairFromOfferUrl,
  parseCustomIceServersText,
  reconnectSticky,
  resolveEffectiveIceServers,
  rotateClientId,
  saveCustomIceServers,
  savedComputerRows,
} from './session.js';
import * as bundleApi from './daemon-client.bundle.js';

if (!globalThis.localStorage) {
  const bag = new Map();
  globalThis.localStorage = {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => { bag.set(key, String(value)); },
    removeItem: (key) => { bag.delete(key); },
  };
}

// DEF-REPAIR-INTAB: after 「断开这台设备」 the relay still holds the old
// clientId registration; re-pairing with the same id stalls with no error.
// Logout must mint a fresh clientId for the next pairing.
test('rotateClientId discards the persisted mobile clientId so the next pairing gets a new one', () => {
  const first = currentClientId();
  assert.match(first, /^mob_[0-9a-f]{16}$/);
  assert.equal(currentClientId(), first);
  const rotated = rotateClientId();
  assert.equal(rotated, first);
  const second = currentClientId();
  assert.match(second, /^mob_[0-9a-f]{16}$/);
  assert.notEqual(second, first);
  assert.equal(localStorage.getItem('dsh-chisacode-client-id'), second);
});

test('buildClientRelayUrl always passes role=client and useTls===true only', () => {
  const calls = [];
  const api = {
    buildRelayWebSocketUrl(params) {
      calls.push(params);
      const proto = params.useTls ? 'wss' : 'ws';
      return `${proto}://${params.endpoint}/ws?role=${params.role}&serverId=${params.serverId}`;
    },
  };

  const clear = buildClientRelayUrl(api, {
    endpoint: '125.124.85.212:8411',
    useTls: false,
    serverId: 'srv_1',
  });
  assert.equal(calls[0].role, 'client');
  assert.equal(calls[0].useTls, false);
  assert.match(clear, /^ws:\/\//);
  assert.match(clear, /role=client/);

  const tls = buildClientRelayUrl(api, {
    endpoint: 'relay.example.com:443',
    useTls: true,
    serverId: 'srv_2',
  });
  assert.equal(calls[1].role, 'client');
  assert.equal(calls[1].useTls, true);
  assert.match(tls, /^wss:\/\//);
});

test('buildClientRelayUrl treats truthy-but-not-true useTls as false', () => {
  const calls = [];
  const api = {
    buildRelayWebSocketUrl(params) {
      calls.push(params);
      return 'ws://x';
    },
  };
  buildClientRelayUrl(api, { endpoint: 'h:1', useTls: 'yes', serverId: 's' });
  assert.equal(calls[0].useTls, false);
  assert.equal(calls[0].role, 'client');
});

test('reconnectSticky uses role=client and stored useTls', async () => {
  const SECRET_KEY = 'dsh-chisacode-device-secrets';
  localStorage.setItem(SECRET_KEY, JSON.stringify({
    srv_test: {
      deviceId: 'dev_1',
      deviceSecret: 'x'.repeat(64),
      relayEndpoint: '125.124.85.212:8411',
      daemonPublicKeyB64: 'abc',
      useTls: false,
      savedAt: 1,
    },
  }));

  const calls = [];
  class MockDaemonClient {
    constructor(opts) {
      assert.equal(opts.reconnect.enabled, false);
      this.opts = opts;
    }

    setReconnectEnabled(enabled) { assert.equal(enabled, true); }
    async connect() {}
    getLastServerInfoMessage() { return { hostname: '  WHALE-DESKTOP  ' }; }
  }
  const api = {
    buildRelayWebSocketUrl(params) {
      calls.push(params);
      return 'ws://test/ws';
    },
    DaemonClient: MockDaemonClient,
  };

  const reconnected = await reconnectSticky(api, 'srv_test');

  assert.equal(calls[0].role, 'client');
  assert.equal(calls[0].useTls, false);
  assert.equal(calls[0].serverId, 'srv_test');
  assert.equal(reconnected.computerName, 'WHALE-DESKTOP');
  const saved = JSON.parse(localStorage.getItem(SECRET_KEY));
  assert.equal(saved.srv_test.computerName, 'WHALE-DESKTOP');
  assert.equal(saved.srv_test.savedAt, 1);
});

test('computer-name persistence is best-effort after a successful reconnect', async () => {
  const previousStorage = globalThis.localStorage;
  const record = {
    deviceId: 'dev_quota',
    deviceSecret: 'secret_quota',
    relayEndpoint: 'relay.example:8411',
    daemonPublicKeyB64: 'pk_quota',
    savedAt: 7,
  };
  let closeCount = 0;
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ srv_quota: record }),
    setItem: () => { throw new Error('quota'); },
  };
  try {
    const reconnected = await reconnectSticky({
      buildRelayWebSocketUrl: () => 'ws://relay.example:8411/ws',
      DaemonClient: class {
        async connect() {}
        async close() { closeCount += 1; }
        setReconnectEnabled() {}
        getLastServerInfoMessage() { return { hostname: 'Whale Desktop' }; }
      },
    }, 'srv_quota');
    assert.equal(reconnected.computerName, 'Whale Desktop');
    assert.equal(closeCount, 0);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('expired offers fail before opening a transport and do not discard saved credentials', async () => {
  const before = localStorage.getItem('dsh-chisacode-device-secrets');
  let opened = false;
  await assert.rejects(pairFromOfferUrl({
    parseConnectionOfferFromUrl: () => ({
      serverId: 'srv_expired', relay: { endpoint: 'relay:8411' },
      authBootstrap: { pairingToken: 'expired', expiresAtMs: Date.now() - 1 },
    }),
    createRelayDeviceId: () => 'dev_test',
    buildRelayWebSocketUrl: () => 'ws://relay:8411',
    DaemonClient: class {
      connect() { opened = true; return Promise.resolve(); }
      setReconnectEnabled() {}
    },
  }, 'http://example/#offer=test'), /配对码已过期/);
  assert.equal(opened, false);
  assert.equal(localStorage.getItem('dsh-chisacode-device-secrets'), before);
});

test('superseded sticky attempts close their transport and reject promptly', async () => {
  localStorage.setItem('dsh-chisacode-device-secrets', JSON.stringify({
    srv_cancel: { deviceId: 'dev_cancel', deviceSecret: 'secret', daemonPublicKeyB64: 'key', relayEndpoint: 'relay:8411' },
  }));
  const controller = new AbortController();
  let closed = 0;
  const pending = reconnectSticky({
    buildRelayWebSocketUrl: () => 'ws://relay:8411',
    DaemonClient: class {
      connect() { return new Promise(() => {}); }
      async close() { closed += 1; }
      setReconnectEnabled() {}
    },
  }, 'srv_cancel', { signal: controller.signal });
  controller.abort(new Error('superseded'));
  await assert.rejects(Promise.race([
    pending,
    new Promise((_, reject) => setTimeout(() => reject(new Error('attempt did not cancel')), 100)),
  ]), /superseded/);
  assert.equal(closed, 1);
});

test('pairFromOfferUrl uses offer v2 bootstrap auth and persists the issued device secret', async () => {
  localStorage.setItem('dsh-chisacode-device-secrets', JSON.stringify({
    srv_pair: {
      deviceId: 'dev_revoked_0000',
      deviceSecret: 'x'.repeat(64),
      daemonPublicKeyB64: 'old-key',
      relayEndpoint: 'old.example:443',
      useTls: true,
    },
  }));
  const relayCalls = [];
  let clientOptions;
  let initialAuth;
  let serverHostname = '  Whale   Workstation  ';
  class MockDaemonClient {
    constructor(options) {
      assert.equal(options.reconnect.enabled, false);
      clientOptions = options;
      initialAuth = { ...options.relayDeviceAuth };
    }

    setReconnectEnabled(enabled) { assert.equal(enabled, true); }
    async connect() {
      clientOptions.onRelayDeviceAuthResult({
        ok: true,
        deviceId: clientOptions.relayDeviceAuth.deviceId,
        deviceSecret: 's'.repeat(64),
      });
    }

    getLastServerInfoMessage() { return { hostname: serverHostname }; }
  }
  const offer = {
    v: 2,
    serverId: 'srv_pair',
    daemonPublicKeyB64: 'daemon-key',
    authBootstrap: { pairingToken: 'one-time-token' },
    relay: { endpoint: '125.124.85.212:8411', useTls: false },
  };
  const api = {
    parseConnectionOfferFromUrl(value) {
      assert.match(value, /#offer=/);
      return offer;
    },
    createRelayDeviceId: () => 'dev_pair_1234',
    buildRelayWebSocketUrl(params) {
      relayCalls.push(params);
      return 'ws://125.124.85.212:8411/ws?role=client';
    },
    DaemonClient: MockDaemonClient,
  };

  // Node's own navigator.userAgent would classify as 设备; stub a real phone
  // UA so the pairing payload assertion pins the derived device name.
  const realNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    },
  });
  let paired;
  try {
    paired = await pairFromOfferUrl(api, 'http://192.168.1.8:3180/#offer=encoded');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: realNavigator });
  }

  assert.equal(paired.serverId, 'srv_pair');
  assert.equal(paired.computerName, 'Whale Workstation');
  assert.deepEqual(initialAuth, {
    version: 1,
    serverId: 'srv_pair',
    deviceId: 'dev_revoked_0000',
    pairingToken: 'one-time-token',
    deviceName: 'iPhone · iOS 18.2',
  });
  assert.equal(clientOptions.relayDeviceAuth.pairingToken, undefined);
  assert.equal(clientOptions.relayDeviceAuth.deviceSecret, 's'.repeat(64));
  assert.equal(relayCalls[0].role, 'client');
  const saved = JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets'));
  assert.equal(saved.srv_pair.deviceId, 'dev_revoked_0000');
  assert.equal(saved.srv_pair.deviceSecret, 's'.repeat(64));
  assert.equal(saved.srv_pair.computerName, 'Whale Workstation');
  const savedAt = saved.srv_pair.savedAt;
  serverHostname = 'Whale Laptop';
  assert.equal(paired.refreshComputerName(), 'Whale Laptop');
  const renamed = JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets'));
  assert.equal(renamed.srv_pair.computerName, 'Whale Laptop');
  assert.equal(renamed.srv_pair.savedAt, savedAt);
});

test('deviceNameFromUa mirrors the desktop device naming contract', () => {
  assert.equal(
    deviceNameFromUa('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    'iPhone · iOS 18.2',
  );
  assert.equal(deviceNameFromUa('Mozilla/5.0 (iPhone;)'), 'iPhone');
  assert.equal(
    deviceNameFromUa('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15'),
    'iPad · iOS 17.5',
  );
  assert.equal(
    deviceNameFromUa('Mozilla/5.0 (Linux; Android 15; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'),
    'Android 15 · Pixel 8 Pro',
  );
  // WebView shells expose wv/Mobile as the model token — not a real model.
  assert.equal(deviceNameFromUa('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36'), 'Android 14');
  assert.equal(deviceNameFromUa('Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36'), 'Android 13');
  assert.equal(deviceNameFromUa('Mozilla/5.0 (Linux; Android) AppleWebKit/537.36'), 'Android');
  assert.equal(
    deviceNameFromUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'),
    '电脑',
  );
  assert.equal(
    deviceNameFromUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15'),
    '电脑',
  );
  assert.equal(deviceNameFromUa('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'), '电脑');
  assert.equal(deviceNameFromUa('node'), '设备');
  assert.equal(deviceNameFromUa(''), '设备');
  assert.equal(deviceNameFromUa(undefined), '设备');
  // Protocol + store cap the label at 120 chars.
  assert.equal(deviceNameFromUa(`Android ${'9'.repeat(200)}`).length, 120);
});

test('pairing works without crypto.randomUUID (http://<lan-ip> is not a secure context)', async () => {
  // Real phone browsers open the pairing page over plain http on a LAN IP —
  // NOT a secure context, so `crypto.randomUUID` does not exist there. Only
  // `getRandomValues` is universally available. This locks the fallback.
  localStorage.removeItem('dsh-chisacode-client-id');
  localStorage.removeItem('dsh-chisacode-device-secrets');
  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
  });
  try {
    let clientOptions;
    class MockDaemonClient {
      constructor(options) {
        clientOptions = options;
      }

      setReconnectEnabled(enabled) { assert.equal(enabled, true); }
      async connect() {
        clientOptions.onRelayDeviceAuthResult({
          ok: true,
          deviceId: clientOptions.relayDeviceAuth.deviceId,
          deviceSecret: 's'.repeat(64),
        });
      }
    }
    const api = {
      parseConnectionOfferFromUrl: () => ({
        v: 2,
        serverId: 'srv_insecure',
        daemonPublicKeyB64: 'daemon-key',
        authBootstrap: { pairingToken: 'one-time-token' },
        relay: { endpoint: '125.124.85.212:8411', useTls: false },
      }),
      createRelayDeviceId: () => 'dev_insecure_1',
      buildRelayWebSocketUrl: () => 'ws://125.124.85.212:8411/ws?role=client',
      DaemonClient: MockDaemonClient,
    };

    const paired = await pairFromOfferUrl(api, 'http://192.168.1.8:3180/#offer=encoded');

    assert.equal(paired.serverId, 'srv_insecure');
    assert.match(clientOptions.clientId, /^mob_[0-9a-f]{16}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: realCrypto });
  }
});

test('normalizeOfferUrl accepts full and pasted offer fragments without decoding as v1', () => {
  const current = 'http://192.168.1.8:3180/';
  assert.equal(
    normalizeOfferUrl('#offer=v2-payload', current),
    'http://192.168.1.8:3180/#offer=v2-payload',
  );
  assert.equal(
    normalizeOfferUrl('offer=v2-payload', current),
    'http://192.168.1.8:3180/#offer=v2-payload',
  );
  assert.equal(normalizeOfferUrl('https://example.com/no-offer', current), '');
});

test('savedComputerRows lists complete sticky records most-recent first', () => {
  const complete = {
    deviceId: 'dev_a',
    deviceSecret: 'sec_a',
    daemonPublicKeyB64: 'pk_a',
    relayEndpoint: '192.168.1.8:8411',
  };
  assert.deepEqual(savedComputerRows({
    srv_old: { ...complete, computerName: 'srv_old', savedAt: 100 },
    srv_new: { ...complete, computerName: '  Whale   Studio  ', relayEndpoint: 'relay.lan:8411', savedAt: 200 },
    // Incomplete records cannot reconnect — they must not render as choices.
    srv_broken: { deviceId: 'dev_b', savedAt: 300 },
  }), [
    { serverId: 'srv_new', computerName: 'Whale Studio', relayEndpoint: 'relay.lan:8411', savedAt: 200 },
    { serverId: 'srv_old', computerName: '我的电脑', relayEndpoint: '192.168.1.8:8411', savedAt: 100 },
  ]);
  assert.deepEqual(savedComputerRows({}), []);
  assert.deepEqual(savedComputerRows(undefined), []);
});

test('savedComputerRows never exposes protocol server ids as computer names', () => {
  const complete = {
    deviceId: 'dev_a',
    deviceSecret: 'sec_a',
    daemonPublicKeyB64: 'pk_a',
    relayEndpoint: '192.168.1.8:8411',
  };
  const rows = savedComputerRows({
    srv_missing: { ...complete, savedAt: 3 },
    srv_prefix: { ...complete, computerName: 'srv_mwTybX8qgBZk', savedAt: 2 },
    srv_equal: { ...complete, computerName: 'srv_equal', savedAt: 1 },
  });
  assert.deepEqual(rows.map((row) => row.computerName), ['我的电脑', '我的电脑', '我的电脑']);
  assert.equal(rows.some((row) => /^srv_/i.test(row.computerName)), false);
});

test('agentRows maps the upstream directory payload into the mobile session list', () => {
  assert.deepEqual(agentRows({
    entries: [{
      agent: {
        id: 'agent-1',
        title: 'Remote audit',
        status: 'running',
        cwd: '/workspace',
      },
    }],
  }), [{
    sessionId: 'agent-1',
    title: 'Remote audit',
    projections: { values: { title: 'Remote audit' } },
    running: true,
    cwd: '/workspace',
    chisacodeAgent: {
      id: 'agent-1',
      title: 'Remote audit',
      status: 'running',
      cwd: '/workspace',
    },
  }]);
});

test('pairFromOfferUrl and reconnectSticky support LAN-only offers without relay and persist lanEndpoints + iceServers', async () => {
  localStorage.removeItem('dsh-chisacode-device-secrets');
  localStorage.removeItem('dsh-chisacode-ice-servers');

  const lanOnlyOffer = {
    v: 2,
    serverId: 'srv_lan_only',
    daemonPublicKeyB64: 'pk_lan_only',
    authBootstrap: {
      version: 1,
      pairingToken: 'tok_lan_1234567890abcdef',
      expiresAtMs: Date.now() + 600_000,
    },
    lan: { endpoints: ['192.168.1.55:3180'], useTls: false },
    iceServers: [{ urls: 'turn:turn.example:3478?transport=tcp', username: 'u', credential: 'p' }],
  };
  const encoded = Buffer.from(JSON.stringify(lanOnlyOffer), 'utf8').toString('base64url');
  const offerUrl = `http://192.168.1.55:3180/#offer=${encoded}`;

  // Verify bundled parser accepts LAN-only offer v2 (without relay)
  const parsedByBundle = bundleApi.parseConnectionOfferFromUrl(offerUrl);
  assert.equal(parsedByBundle.serverId, 'srv_lan_only');
  assert.equal(parsedByBundle.relay, undefined);
  assert.deepEqual(parsedByBundle.lan.endpoints, ['192.168.1.55:3180']);

  let pairClientOpts;
  const modeUpdates = [];
  class MockDaemonClient {
    constructor(opts) {
      pairClientOpts = opts;
    }

    setReconnectEnabled() {}
    getTransportMode() { return 'lan'; }
    async connect() {
      pairClientOpts.onTransportModeChange?.('lan');
      pairClientOpts.onRelayDeviceAuthResult?.({
        ok: true,
        deviceId: pairClientOpts.relayDeviceAuth.deviceId,
        deviceSecret: 'z'.repeat(64),
      });
    }

    getLastServerInfoMessage() { return { hostname: 'Office-PC' }; }
  }

  const paired = await pairFromOfferUrl(
    {
      parseConnectionOfferFromUrl: bundleApi.parseConnectionOfferFromUrl,
      createRelayDeviceId: () => 'dev_lan_1',
      buildRelayWebSocketUrl: () => { throw new Error('must not build relay URL for LAN-only offer'); },
      DaemonClient: MockDaemonClient,
    },
    offerUrl,
    { onTransportModeChange: (mode) => modeUpdates.push(mode) },
  );

  assert.equal(pairClientOpts.url, '');
  assert.deepEqual(pairClientOpts.lanEndpoints, ['192.168.1.55:3180']);
  assert.equal(pairClientOpts.lanUseTls, false);
  assert.equal(paired.transportMode, 'lan');
  assert.equal(paired.getTransportMode(), 'lan');
  assert.deepEqual(modeUpdates, ['lan']);

  const saved = JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets'));
  assert.deepEqual(saved.srv_lan_only.lanEndpoints, ['192.168.1.55:3180']);
  assert.equal(saved.srv_lan_only.iceServers.length, 1);

  const rows = savedComputerRows(saved);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].serverId, 'srv_lan_only');
  assert.equal(rows[0].relayEndpoint, '192.168.1.55:3180');

  let reconnectOpts;
  const reconnected = await reconnectSticky(
    {
      buildRelayWebSocketUrl: () => { throw new Error('must not build relay URL'); },
      DaemonClient: class {
        constructor(opts) { reconnectOpts = opts; }
        setReconnectEnabled() {}
        getTransportMode() { return 'lan'; }
        async connect() {}
        getLastServerInfoMessage() { return { hostname: 'Office-PC' }; }
      },
    },
    'srv_lan_only',
  );
  assert.equal(reconnectOpts.url, '');
  assert.deepEqual(reconnectOpts.lanEndpoints, ['192.168.1.55:3180']);
  assert.equal(reconnected.transportMode, 'lan');
});

test('custom STUN/TURN servers persist in localStorage and merge with offer iceServers', () => {
  localStorage.removeItem('dsh-chisacode-ice-servers');
  assert.deepEqual(loadCustomIceServers(), []);
  assert.equal(resolveEffectiveIceServers(undefined), undefined);

  const parsed = parseCustomIceServersText([
    'stun:stun.example.org:3478',
    'turn:turn.example.org:3478?transport=tcp | alice | secret123',
  ].join('\n'));
  assert.deepEqual(parsed, [
    { urls: 'stun:stun.example.org:3478' },
    { urls: 'turn:turn.example.org:3478?transport=tcp', username: 'alice', credential: 'secret123' },
  ]);

  saveCustomIceServers(parsed);
  assert.deepEqual(loadCustomIceServers(), parsed);
  assert.match(formatCustomIceServersText(loadCustomIceServers()), /alice \| secret123/);

  const merged = resolveEffectiveIceServers([{ urls: 'turn:offer.example:3478', username: 'o', credential: 'k' }]);
  assert.ok(merged.some((s) => s.urls === 'turn:offer.example:3478'));
  assert.ok(merged.some((s) => s.urls === 'turn:turn.example.org:3478?transport=tcp'));
  assert.ok(merged.some((s) => s.urls === 'stun:stun.cloudflare.com:3478'));

  assert.throws(() => parseCustomIceServersText('https://not-ice.example'), /无效的 STUN\/TURN 地址/);
  saveCustomIceServers([]);
  assert.deepEqual(loadCustomIceServers(), []);
});

test('re-pairing same serverId clears stale lanEndpoints, lanUseTls, iceServers, and relayEndpoint', async () => {
  localStorage.removeItem('dsh-chisacode-device-secrets');
  localStorage.removeItem('dsh-chisacode-ice-servers');

  const pairWith = async (offer) => {
    let clientOpts;
    class MockDaemonClient {
      constructor(opts) { clientOpts = opts; }
      setReconnectEnabled() {}
      async connect() {
        clientOpts.onRelayDeviceAuthResult?.({
          ok: true,
          deviceId: clientOpts.relayDeviceAuth.deviceId,
          deviceSecret: 's'.repeat(64),
        });
      }
      getLastServerInfoMessage() { return { hostname: 'Studio-PC' }; }
    }
    await pairFromOfferUrl({
      parseConnectionOfferFromUrl: () => offer,
      createRelayDeviceId: () => 'dev_repair_1',
      buildRelayWebSocketUrl: ({ endpoint, useTls, serverId }) =>
        `${useTls ? 'wss' : 'ws'}://${endpoint}/ws?serverId=${serverId}`,
      DaemonClient: MockDaemonClient,
    }, 'http://example.invalid/#offer=encoded');
  };

  // 1. Initial pairing includes LAN endpoints + custom ICE + relay.
  await pairWith({
    v: 2,
    serverId: 'srv_repair',
    daemonPublicKeyB64: 'pk_repair',
    authBootstrap: { pairingToken: 'tok_1' },
    relay: { endpoint: 'old.relay:443', useTls: true },
    lan: { endpoints: ['192.168.1.55:3180'], useTls: true },
    iceServers: [{ urls: 'turn:old.turn:3478', username: 'u', credential: 'p' }],
  });

  // 2. Re-pair the same serverId using a relay-only offer without LAN or ICE servers.
  await pairWith({
    v: 2,
    serverId: 'srv_repair',
    daemonPublicKeyB64: 'pk_repair',
    authBootstrap: { pairingToken: 'tok_2' },
    relay: { endpoint: 'ayase.cn:443', useTls: true },
  });

  const savedAfterRelayRepair = JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets'));
  assert.equal(savedAfterRelayRepair.srv_repair.relayEndpoint, 'ayase.cn:443');
  assert.equal(savedAfterRelayRepair.srv_repair.useTls, true);
  assert.equal('lanEndpoints' in savedAfterRelayRepair.srv_repair, false);
  assert.equal('lanUseTls' in savedAfterRelayRepair.srv_repair, false);
  assert.equal('iceServers' in savedAfterRelayRepair.srv_repair, false);

  let reconnectOpts;
  await reconnectSticky({
    buildRelayWebSocketUrl: () => 'wss://ayase.cn:443/ws',
    DaemonClient: class {
      constructor(opts) { reconnectOpts = opts; }
      setReconnectEnabled() {}
      async connect() {}
      getLastServerInfoMessage() { return { hostname: 'Studio-PC' }; }
    },
  }, 'srv_repair');
  assert.equal(reconnectOpts.lanEndpoints, undefined);
  assert.equal(reconnectOpts.lanUseTls, undefined);
  assert.equal(reconnectOpts.iceServers, undefined);

  // 3. Re-pair the same serverId using a LAN-only offer -> clears stale relayEndpoint/useTls.
  await pairWith({
    v: 2,
    serverId: 'srv_repair',
    daemonPublicKeyB64: 'pk_repair',
    authBootstrap: { pairingToken: 'tok_3' },
    lan: { endpoints: ['10.0.0.5:3180'], useTls: false },
  });

  const savedAfterLanRepair = JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets'));
  assert.equal(savedAfterLanRepair.srv_repair.relayEndpoint, '');
  assert.equal(savedAfterLanRepair.srv_repair.useTls, false);
  assert.deepEqual(savedAfterLanRepair.srv_repair.lanEndpoints, ['10.0.0.5:3180']);
  assert.equal(savedAfterLanRepair.srv_repair.lanUseTls, false);
});
