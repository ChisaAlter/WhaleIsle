'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const {
  DshdRemote,
  buildDaemonChildEnv,
  desktopDshVendorDir,
  dshVendorDirForChild,
  ensureDshAcpShim,
  loadServerApi,
  publicDevicesFromStore,
  readDefaults,
  relayStatusFromLogRecord,
  relayUseTls,
  resolveDesktopChisaCodeHome,
  DSH_VENDOR_PACKAGES,
  VENDOR_ROOT,
} = require('./dshd-remote');

// dist/ 是构建产物（vendor 内嵌 .gitignore 挡住了提交），fresh clone / CI 没有。
// 打包机通过 build:server-deps 产出后随 extraResources 发货；这里只在有产物时验证。
const VENDOR_BUILT = fs.existsSync(path.join(
  VENDOR_ROOT,
  'node_modules',
  '@chisacode',
  'server',
  'dist',
  'server',
  'server',
  'exports.js',
));
const VENDOR_BUILD_HINT = 'vendored server dist 缺失（npm run prepare:dshd-remote 会构建）';

test('vendor tree includes full daemon sources and AGPL shipping docs', () => {
  assert.ok(fs.existsSync(path.join(VENDOR_ROOT, 'packages', 'server', 'src', 'server', 'exports.ts')));
  assert.ok(fs.existsSync(path.join(VENDOR_ROOT, 'packages', 'relay', 'src', 'cloudflare-adapter.ts')));
  assert.ok(fs.existsSync(path.join(VENDOR_ROOT, 'WORKER-CHECKLIST.md')));
  assert.ok(fs.existsSync(path.join(VENDOR_ROOT, 'AGPL-SHIPPING.md')));
  const { DEFAULT_RELAY_ENDPOINT } = require('../shared/lan');
  assert.equal(DEFAULT_RELAY_ENDPOINT, 'ayase.cn:443');
  const wrangler = fs.readFileSync(path.join(VENDOR_ROOT, 'packages', 'relay', 'wrangler.toml'), 'utf8');
  assert.doesNotMatch(wrangler, /10ed39a1dbf316e30abd0c409bed40d6/);
  assert.doesNotMatch(wrangler, /chisacode\.sh/);
});

test('desktop start and packaging prepare and ship the trimmed DSHD remote runtime', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(VENDOR_ROOT, '..', '..', 'package.json'), 'utf8'));
  const prepareScript = fs.readFileSync(
    path.join(VENDOR_ROOT, '..', '..', 'scripts', 'prepare-dshd-remote.mjs'),
    'utf8',
  );
  assert.match(manifest.scripts.start, /prestart-ensure/);
  assert.match(manifest.scripts.pack, /prepare-dshd-remote\.mjs --force --runtime/);
  assert.match(prepareScript, /--install-links/);
  assert.match(prepareScript, /--omit=optional/);
  assert.match(prepareScript, /'better-sqlite3': sqliteVersion/);
  assert.match(prepareScript, /runtimeBudgetBytes = 96 \* 1024 \* 1024/);
  assert.match(prepareScript, /function pruneNodePtyRuntime/);
  assert.match(prepareScript, /daemon start\/stop probe passed/);
  assert.doesNotMatch(prepareScript, /'@chisacode\/client': 'file:/);
  assert.match(prepareScript, /@electron['"], 'rebuild'/);
  assert.match(prepareScript, /'--only', 'better-sqlite3'/);
  assert.doesNotMatch(prepareScript, /'--which-module', 'better-sqlite3'/);
  assert.match(prepareScript, /ELECTRON_RUN_AS_NODE: '1'/);
  assert.match(prepareScript, /Electron better-sqlite3 ABI probe passed/);
  const resources = manifest.build.extraResources;
  assert.ok(resources.some((entry) => (
    entry.from === 'vendor/chisacode-remote'
    && entry.to === 'vendor/dshd-remote'
    && !entry.filter.some((pattern) => pattern.startsWith('packages/'))
  )));
  assert.ok(resources.some((entry) => (
    entry.from === 'vendor/chisacode-remote/.tmp/desktop-runtime/node_modules'
    && entry.to === 'vendor/dshd-remote/node_modules'
  )));
});

test('built vendor tree includes daemon dist packages (not a hello slice)', { skip: VENDOR_BUILT ? false : VENDOR_BUILD_HINT }, () => {
  assert.ok(fs.existsSync(path.join(VENDOR_ROOT, 'packages', 'server', 'dist', 'server', 'server', 'exports.js')));
  assert.ok(fs.existsSync(path.join(VENDOR_ROOT, 'packages', 'client', 'dist', 'index.js')));
  assert.ok(fs.existsSync(path.join(VENDOR_ROOT, 'packages', 'protocol', 'dist', 'connection-offer.js')));
});

test('defaults bake in desktop Away relay from lan.js constants (packaged path)', () => {
  const defaults = readDefaults();
  assert.equal(defaults.relayEndpoint, 'ayase.cn:443');
  assert.equal(defaults.appBaseUrl, '');
  assert.equal(defaults.relayUseTls, true);
  const { DEFAULT_RELAY_ENDPOINT, DEFAULT_RELAY_USE_TLS } = require('../shared/lan');
  assert.equal(defaults.relayEndpoint, DEFAULT_RELAY_ENDPOINT);
  assert.equal(defaults.relayUseTls, DEFAULT_RELAY_USE_TLS);
});

test('pairingAppBaseUrl in LAN mode is :3180 never the relay host', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const remote = new DshdRemote({
    getConfig: () => ({ remoteEnabled: false, remoteMode: 'lan', remoteBindAddress: '127.0.0.1' }),
    getHomeDir: () => home,
  });
  const base = remote.pairingAppBaseUrl();
  assert.match(base, /^http:\/\/.+:3180$/);
  assert.doesNotMatch(base, /ayase\.cn/);
  assert.equal(base, 'http://127.0.0.1:3180');
});

test('LAN listener, snapshot, and pairing URL all respect the selected bind scope', async (t) => {
  const calls = [];
  t.mock.method(http.Server.prototype, 'listen', function listen(port, bind) {
    calls.push({ port, bind });
    t.mock.method(this, 'address', () => ({ port, address: bind }));
    queueMicrotask(() => this.emit('listening'));
    return this;
  });
  for (const bind of ['127.0.0.1', '192.0.2.10', '0.0.0.0']) {
    const remote = new DshdRemote({ getConfig: () => ({ remoteMode: 'lan', remoteBindAddress: bind }) });
    await remote.ensureMobileWebServer();
    assert.deepEqual(calls.at(-1), { port: 3180, bind });
    assert.equal(remote.snapshot().bindAddress, bind);
    const url = new URL(remote.pairingAppBaseUrl());
    if (bind !== '0.0.0.0') assert.equal(url.hostname, bind);
    else assert.notEqual(url.hostname, '0.0.0.0');
    remote.pairing = { url: `${url.href}#offer=test` };
    assert.equal(remote.snapshot().urls[0].address, url.hostname);
  }
});

test('pairingAppBaseUrl defaults to the server landing page without a saved mode', () => {
  const remote = new DshdRemote({ getConfig: () => ({}), getHomeDir: () => os.tmpdir() });
  const { DEFAULT_PUBLIC_APP_BASE_URL } = require('../shared/lan');
  assert.equal(remote.pairingAppBaseUrl(), DEFAULT_PUBLIC_APP_BASE_URL);
});

test('pairingAppBaseUrl in away mode is the public SPA path not LAN or :8411', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const remote = new DshdRemote({
    getConfig: () => ({ remoteEnabled: true, remoteMode: 'relay' }),
    getHomeDir: () => home,
  });
  const { DEFAULT_PUBLIC_APP_BASE_URL } = require('../shared/lan');
  assert.equal(remote.pairingAppBaseUrl(), DEFAULT_PUBLIC_APP_BASE_URL);
  assert.doesNotMatch(remote.pairingAppBaseUrl(), /:3180|:8411|192\.168\.|10\./);
});

test('runtimeConfigKey changes when remoteMode or public app base changes', () => {
  const remote = new DshdRemote({ getConfig: () => ({}), getHomeDir: () => os.tmpdir() });
  const lan = remote.runtimeConfigKey({ remoteMode: 'lan', remoteRelayEndpoint: 'ayase.cn:443' });
  const away = remote.runtimeConfigKey({ remoteMode: 'relay', remoteRelayEndpoint: 'ayase.cn:443' });
  assert.notEqual(lan, away);
});

test('relayStatusFromLogRecord flips on relay_control_connected / relay_error', () => {
  assert.deepEqual(
    relayStatusFromLogRecord({ level: 30, msg: 'relay_control_connected', connectionId: 1 }),
    { connected: true, lastError: '' },
  );
  // pino serializes err objects into { message, stack, ... }.
  assert.deepEqual(
    relayStatusFromLogRecord({ level: 40, msg: 'relay_error', err: { message: 'Unexpected server response: 401' } }),
    { connected: false, lastError: 'Unexpected server response: 401' },
  );
  assert.deepEqual(
    relayStatusFromLogRecord({ level: 30, msg: 'relay_control_disconnected' }),
    { connected: false, lastError: 'relay_control_disconnected' },
  );
  const http503 = relayStatusFromLogRecord({
    level: 40,
    msg: 'relay_error',
    err: { message: 'Unexpected server response: 503' },
  });
  assert.deepEqual(http503, { connected: false, lastError: 'Unexpected server response: 503' });
  assert.deepEqual(
    relayStatusFromLogRecord({ level: 40, msg: 'relay_control_disconnected', reason: '' }, http503),
    { connected: false, lastError: 'Unexpected server response: 503' },
  );
  assert.equal(relayStatusFromLogRecord({ msg: 'request_completed' }), null);
  assert.equal(relayStatusFromLogRecord(null), null);
  assert.equal(relayStatusFromLogRecord('relay_error'), null);
});

test('public device snapshots follow upstream lastUsedAt and do not retain revoked rows', () => {
  const store = {
    listDevices() {
      return [
        {
          deviceId: 'dev_phone_1234',
          label: 'Trent phone',
          createdAt: '2026-08-01T00:00:00.000Z',
          lastUsedAt: '2026-08-27T07:00:00.000Z',
          revokedAt: null,
        },
        {
          deviceId: 'dev_old_9999',
          createdAt: '2026-07-01T00:00:00.000Z',
          lastUsedAt: null,
          revokedAt: '2026-08-01T00:00:00.000Z',
        },
      ];
    },
  };
  assert.deepEqual(publicDevicesFromStore(store), [{
    id: 'dev_phone_1234',
    name: 'Trent phone',
    createdAt: '2026-08-01T00:00:00.000Z',
    boundAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-27T07:00:00.000Z',
    shortId: '1234',
  }]);
});

test('renameDevice writes through the re-opened device store and stays a no-op without one', () => {
  const renamed = [];
  const store = {
    listDevices() {
      return [{
        deviceId: 'dev_phone_1234',
        label: 'Pixel 8',
        createdAt: '2026-08-01T00:00:00.000Z',
        lastUsedAt: '2026-08-27T07:00:00.000Z',
        revokedAt: null,
      }];
    },
    renameDevice(id, label) {
      renamed.push([id, label]);
    },
  };
  const remote = new DshdRemote({
    getConfig: () => ({ remoteEnabled: true }),
    getHomeDir: () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-')),
  });
  remote.serverApi = { RelayDeviceCredentialStore: class { constructor() { return store; } } };
  const snap = remote.renameDevice('dev_phone_1234', 'Pixel 9');
  assert.deepEqual(renamed, [['dev_phone_1234', 'Pixel 9']]);
  assert.equal(snap.devices[0].name, 'Pixel 8');

  // Missing id or a daemon API without the store method must not throw.
  assert.doesNotThrow(() => remote.renameDevice('', 'Pixel 9'));
  remote.serverApi = {};
  assert.doesNotThrow(() => remote.renameDevice('dev_phone_1234', 'Pixel 9'));
});

test('relay TLS follows the persisted endpoint transport setting', () => {
  assert.equal(relayUseTls({ remoteRelayUseTls: false }, '125.124.85.212:8411'), false);
  assert.equal(relayUseTls({ remoteRelayUseTls: true }, 'relay.example.com:443'), true);
  assert.equal(relayUseTls({}, 'ayase.cn:443'), true);
  assert.equal(relayUseTls({}, 'relay.example.com:443'), true);
  assert.equal(relayUseTls({}, 'relay.example.com:8411'), false);
});

test('refreshPairing passes LAN appBaseUrl and includeQr false', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const calls = [];
  const remote = new DshdRemote({
    getConfig: () => ({
      remoteEnabled: true,
      remoteMode: 'lan',
      remoteRelayEndpoint: 'ayase.cn:443',
      remoteRelayUseTls: true,
    }),
    getHomeDir: () => home,
  });
  remote.serverApi = {
    async generateLocalPairingOffer(args) {
      calls.push(args);
      return { relayEnabled: true, url: `${args.appBaseUrl}/#offer=x`, qr: null };
    },
  };
  await remote.refreshPairing();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includeQr, false);
  assert.match(calls[0].appBaseUrl, /:3180$/);
  assert.doesNotMatch(calls[0].appBaseUrl, /ayase\.cn/);
  assert.equal(calls[0].relayUseTls, true);
});

test('refreshPairing in away mode passes public SPA appBaseUrl', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const calls = [];
  const { DEFAULT_PUBLIC_APP_BASE_URL } = require('../shared/lan');
  const remote = new DshdRemote({
    getConfig: () => ({
      remoteEnabled: true,
      remoteMode: 'relay',
      remoteRelayEndpoint: 'ayase.cn:443',
      remoteRelayUseTls: true,
    }),
    getHomeDir: () => home,
  });
  remote.serverApi = {
    async generateLocalPairingOffer(args) {
      calls.push(args);
      return { relayEnabled: true, url: `${args.appBaseUrl}/#offer=x`, qr: null };
    },
  };
  await remote.refreshPairing();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].appBaseUrl, DEFAULT_PUBLIC_APP_BASE_URL);
  assert.doesNotMatch(calls[0].appBaseUrl, /:3180|:8411/);
});

test('ensurePairing mints when daemon up and url empty', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  let refreshCalls = 0;
  const remote = new DshdRemote({
    getConfig: () => ({ remoteEnabled: true }),
    getHomeDir: () => home,
  });
  remote.daemon = { child: { pid: 1 } };
  remote.pairing = { relayEnabled: false, url: null, qr: null };
  remote.refreshPairing = async () => {
    refreshCalls += 1;
    remote.pairing = { relayEnabled: true, url: 'http://10.0.0.4:3180/#offer=x', qr: null };
    remote.pairingEnsureBlocked = false;
    return remote.pairing;
  };
  const snap = await remote.ensurePairing();
  assert.equal(refreshCalls, 1);
  assert.equal(snap.urls[0].pairingUrl, 'http://10.0.0.4:3180/#offer=x');
});

test('ensurePairing no-ops when url present', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  let refreshCalls = 0;
  const remote = new DshdRemote({
    getConfig: () => ({ remoteEnabled: true }),
    getHomeDir: () => home,
  });
  remote.daemon = { child: { pid: 1 } };
  remote.pairing = { relayEnabled: true, url: 'http://10.0.0.4:3180/#offer=y', qr: null };
  remote.refreshPairing = async () => {
    refreshCalls += 1;
    return remote.pairing;
  };
  await remote.ensurePairing();
  assert.equal(refreshCalls, 0);
});

test('ensurePairing suppresses after failure until rotateToken clears it', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  let refreshCalls = 0;
  const remote = new DshdRemote({
    getConfig: () => ({ remoteEnabled: true }),
    getHomeDir: () => home,
  });
  remote.daemon = { child: { pid: 1 } };
  remote.pairing = { relayEnabled: false, url: null, qr: null };
  remote.refreshPairing = async () => {
    refreshCalls += 1;
    if (refreshCalls === 1) throw new Error('mint failed');
    remote.pairing = { relayEnabled: true, url: 'http://10.0.0.4:3180/#offer=z', qr: null };
    remote.pairingEnsureBlocked = false;
    return remote.pairing;
  };
  await remote.ensurePairing();
  assert.equal(refreshCalls, 1);
  assert.equal(remote.pairingEnsureBlocked, true);
  await remote.ensurePairing();
  assert.equal(refreshCalls, 1);
  await remote.rotateToken();
  assert.equal(refreshCalls, 2);
  assert.equal(remote.pairingEnsureBlocked, false);
  assert.ok(remote.snapshot().urls[0].pairingUrl.includes('#offer=z'));
});

test('ensurePairing unblocks after sync succeeds', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  let refreshCalls = 0;
  const remote = new DshdRemote({
    getConfig: () => ({ remoteEnabled: true }),
    getHomeDir: () => home,
  });
  remote.daemon = { child: { pid: 1 } };
  remote.runtimeKey = remote.runtimeConfigKey(remote.getConfig() || {});
  remote.pairing = { relayEnabled: false, url: null, qr: null };
  remote.refreshPairing = async () => {
    refreshCalls += 1;
    if (refreshCalls === 1) throw new Error('mint failed');
    remote.pairing = { relayEnabled: true, url: 'http://10.0.0.4:3180/#offer=sync', qr: null };
    remote.pairingEnsureBlocked = false;
    return remote.pairing;
  };
  await remote.ensurePairing();
  assert.equal(remote.pairingEnsureBlocked, true);
  await remote.sync();
  assert.equal(refreshCalls, 2);
  assert.equal(remote.pairingEnsureBlocked, false);
  assert.ok(remote.snapshot().urls[0].pairingUrl.includes('#offer=sync'));
});

// ---------------------------------------------------------------------------
// Daemon child-process management (fake runner scripts, real spawns)
// ---------------------------------------------------------------------------

/**
 * Write a fake runner script (same stdout/stdin protocol as
 * dshd-daemon-runner.mjs) into a tmp dir and return its path.
 * @param {string} body - script body appended after the launch-file preamble
 */
function writeFakeRunner(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runner-'));
  const file = path.join(dir, 'fake-runner.mjs');
  fs.writeFileSync(file, [
    "import fs from 'node:fs';",
    'const launch = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'const emit = (record) => process.stdout.write(JSON.stringify(record) + "\\n");',
    "process.stdin.setEncoding('utf8');",
    "let stdinBuf = '';",
    'const onStop = () => {',
    '  emit({ msg: "dshd_daemon_stopped", reason: "stop" });',
    '  process.exit(0);',
    '};',
    "process.stdin.on('data', (chunk) => {",
    '  stdinBuf += chunk;',
    "  if (stdinBuf.includes('stop\\n') && !process.env.FAKE_IGNORE_STOP) onStop();",
    '});',
    "process.stdin.on('end', () => process.exit(0));",
    'process.stdin.resume();',
    body,
  ].join('\n'));
  return file;
}

const READY_RUNNER_BODY = [
  'fs.appendFileSync(launch.daemonConfig.chisacodeHome + "/runner-spawns.log", launch.daemonConfig.relayEndpoint + "\\n");',
  'fs.writeFileSync(launch.daemonConfig.chisacodeHome + "/runner-env.json", JSON.stringify({',
  '  CHISACODE_HOME: process.env.CHISACODE_HOME || null,',
  '  CHISACODE_DSH_VENDOR_DIR: process.env.CHISACODE_DSH_VENDOR_DIR || null,',
  '  ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || null,',
  '}));',
  'emit({ msg: "dshd_daemon_ready", listen: launch.daemonConfig.listen });',
].join('\n');

function fakeRemote({ home, runnerBody = READY_RUNNER_BODY, config, options = {} }) {
  let current = config || {
    remoteEnabled: true,
    remoteRelayEndpoint: 'ayase.cn:443',
    remoteRelayUseTls: true,
  };
  const remote = new DshdRemote({
    getConfig: () => current,
    getHomeDir: () => home,
    runnerPath: writeFakeRunner(runnerBody),
    readyTimeoutMs: 10_000,
    stopTimeoutMs: 1_000,
    ...options,
  });
  remote.ensureMobileWebServer = async () => {};
  remote.stopMobileWebServer = async () => {};
  remote.serverApi = {
    DSH_VENDOR_PACKAGES: [],
    async generateLocalPairingOffer(args) {
      return { relayEnabled: true, url: `${args.appBaseUrl}/#offer=x`, qr: null };
    },
  };
  return {
    remote,
    setConfig(next) { current = next; },
    getConfig() { return current; },
  };
}

test('startDaemon spawns the runner child and restarts it when relay config changes', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const f = fakeRemote({ home });

  await f.remote.startDaemon();
  assert.equal(f.remote.snapshot().listening, true);
  const firstPid = f.remote.daemon.child.pid;
  const launch1 = JSON.parse(fs.readFileSync(path.join(home, 'daemon-launch.json'), 'utf8'));
  assert.equal(launch1.daemonConfig.relayEndpoint, 'ayase.cn:443');
  assert.equal(launch1.daemonConfig.relayUseTls, true);
  // No credentials may ever land in the launch file.
  assert.doesNotMatch(JSON.stringify(launch1), /apiKey|DEEPSEEK/);

  f.setConfig({
    ...f.getConfig(),
    remoteRelayEndpoint: 'relay.example.com:443',
    remoteRelayUseTls: true,
  });
  await f.remote.startDaemon();
  assert.notEqual(f.remote.daemon.child.pid, firstPid);
  const launch2 = JSON.parse(fs.readFileSync(path.join(home, 'daemon-launch.json'), 'utf8'));
  assert.equal(launch2.daemonConfig.relayEndpoint, 'relay.example.com:443');
  assert.equal(launch2.daemonConfig.relayUseTls, true);
  assert.equal(
    fs.readFileSync(path.join(home, 'runner-spawns.log'), 'utf8').trim().split('\n').length,
    2,
  );

  await f.remote.stopDaemon();
  assert.equal(f.remote.snapshot().listening, false);
  // Env bridge is child-scoped: the main process env never grows CHISACODE_*.
  const childEnv = JSON.parse(fs.readFileSync(path.join(home, 'runner-env.json'), 'utf8'));
  assert.equal(childEnv.CHISACODE_HOME, home);
  assert.equal(childEnv.ELECTRON_RUN_AS_NODE, '1');
});

test('the port control changes the real loopback daemon endpoint and restarts its child', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-port-'));
  const f = fakeRemote({ home, config: { remoteEnabled: true, remotePort: 7788 } });
  t.after(async () => {
    await f.remote.stopDaemon();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(path.dirname(f.remote.runnerPath), { recursive: true, force: true });
  });
  await f.remote.startDaemon();
  const firstPid = f.remote.daemon.child.pid;
  const launch = () => JSON.parse(fs.readFileSync(path.join(home, 'daemon-launch.json'), 'utf8'));
  assert.equal(launch().daemonConfig.listen, '127.0.0.1:7788');
  assert.equal(f.remote.snapshot().port, 7788);
  f.setConfig({ ...f.getConfig(), remotePort: 8899 });
  await f.remote.sync();
  assert.notEqual(f.remote.daemon.child.pid, firstPid);
  assert.equal(launch().daemonConfig.listen, '127.0.0.1:8899');
  assert.equal(f.remote.snapshot().port, 8899);
});

test('daemon child relay log lines drive snapshot relay state across the process boundary', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const relayBody = [
    'emit({ msg: "dshd_daemon_ready", listen: launch.daemonConfig.listen });',
    'setTimeout(() => emit({ level: 30, msg: "relay_control_connected" }), 30);',
    'setTimeout(() => emit({ level: 40, msg: "relay_error", err: { message: "Unexpected server response: 401" } }), 60);',
    'setTimeout(() => emit({ level: 40, msg: "relay_control_disconnected" }), 90);',
  ].join('\n');
  const f = fakeRemote({ home, runnerBody: relayBody });
  const states = [];
  f.remote.on('listening', (snap) => states.push({ connected: snap.relayConnected, err: snap.relayError }));

  await f.remote.startDaemon();
  await new Promise((resolve) => { setTimeout(resolve, 400); });
  assert.ok(states.some((s) => s.connected === true));
  const last = states[states.length - 1];
  assert.equal(last.connected, false);
  assert.match(last.err, /401/);
  assert.doesNotMatch(last.err, /relay_control_disconnected/);
  await f.remote.stopDaemon();
});

test('daemon child crash is visible (snapshot.error) and never resolves to listening', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const crashBody = [
    'emit({ msg: "dshd_daemon_ready", listen: launch.daemonConfig.listen });',
    'setTimeout(() => process.exit(7), 50);',
  ].join('\n');
  const logs = [];
  const f = fakeRemote({ home, runnerBody: crashBody, options: { log: (line) => logs.push(line) } });

  await f.remote.startDaemon();
  assert.equal(f.remote.snapshot().listening, true);
  await new Promise((resolve) => { setTimeout(resolve, 500); });
  const snap = f.remote.snapshot();
  assert.equal(snap.listening, false);
  assert.match(snap.error, /异常退出/);
  assert.match(snap.error, /code 7/);
  assert.deepEqual(snap.urls, []);
  assert.ok(logs.some((line) => /异常退出/.test(line)));
});

test('daemon start failure surfaces the child error and stderr tail', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const failBody = [
    'process.stderr.write("boom-detail\\n");',
    'setTimeout(() => { emit({ msg: "dshd_daemon_start_failed", error: "EADDRINUSE :6767" }); process.exit(1); }, 20);',
  ].join('\n');
  const f = fakeRemote({ home, runnerBody: failBody });
  await assert.rejects(f.remote.startDaemon(), /EADDRINUSE :6767/);
  const snap = f.remote.snapshot();
  assert.equal(snap.listening, false);
  assert.match(snap.error, /EADDRINUSE/);
});

test('a stale saved bind address fails the pairing page listen with an actionable error', async () => {
  const remote = new DshdRemote({
    getConfig: () => ({ remoteBindAddress: '192.0.2.1' }),
    getHomeDir: () => os.tmpdir(),
  });
  // 192.0.2.1 (TEST-NET-1) is never a local address → deterministic EADDRNOTAVAIL,
  // same failure shape as a WSL/vEthernet address surviving a subnet rebuild.
  await assert.rejects(remote.ensureMobileWebServer(), /监听地址 192\.0\.2\.1 已失效.*监听范围/);
  assert.equal(remote.mobileWebServer, null);
});

test('a spawn failure (missing executable) rejects fast instead of stalling on a ghost child', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const f = fakeRemote({
    home,
    options: { execPath: path.join(home, 'no-such-node'), readyTimeoutMs: 5_000 },
  });
  const started = Date.now();
  await assert.rejects(f.remote.startDaemon(), /无法启动|ENOENT/);
  assert.ok(Date.now() - started < 4_000, 'spawn 失败不得等待 ready/stop 超时');
  assert.equal(f.remote.snapshot().listening, false);
});

test('a failure after the child is ready (pairing) terminates the child instead of leaking it', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const f = fakeRemote({ home });
  f.remote.serverApi = {
    DSH_VENDOR_PACKAGES: [],
    async generateLocalPairingOffer() { throw new Error('offer-boom'); },
  };
  await assert.rejects(f.remote.startDaemon(), /offer-boom/);
  assert.equal(f.remote.daemon, null);
  assert.equal(f.remote.snapshot().listening, false);
  // The spawned child must be gone (stdin stop or kill), not orphaned.
  const spawns = fs.readFileSync(path.join(home, 'runner-spawns.log'), 'utf8').trim().split('\n');
  assert.equal(spawns.length, 1);
});

test('stopDaemon force-kills a child that ignores the stdin stop line', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const stubborn = [
    'emit({ msg: "dshd_daemon_ready", listen: launch.daemonConfig.listen });',
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const f = fakeRemote({ home, runnerBody: stubborn, options: { stopTimeoutMs: 200 } });
  process.env.FAKE_IGNORE_STOP = '1';
  try {
    await f.remote.startDaemon();
    const child = f.remote.daemon.child;
    await f.remote.stopDaemon();
    assert.equal(f.remote.snapshot().listening, false);
    assert.ok(child.exitCode !== null || child.signalCode);
  } finally {
    delete process.env.FAKE_IGNORE_STOP;
  }
});

test('stop before the real child ready line cancels startup and leaves no owned process', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-ready-stop-'));
  const marker = path.join(home, 'runner-pid');
  const f = fakeRemote({ home, runnerBody: [
    'fs.writeFileSync(launch.daemonConfig.chisacodeHome + "/runner-pid", String(process.pid));',
    "process.stdin.removeAllListeners('data');",
    "process.stdin.on('data', (chunk) => {",
    "  if (!chunk.includes('stop\\n')) return;",
    '  emit({ msg: "dshd_daemon_ready", listen: launch.daemonConfig.listen });',
    '  setImmediate(() => process.exit(0));',
    '});',
  ].join('\n') });
  t.after(async () => {
    await f.remote.stopDaemon();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(path.dirname(f.remote.runnerPath), { recursive: true, force: true });
  });
  const listening = [];
  f.remote.on('listening', (snapshot) => listening.push(snapshot.listening));
  const startup = f.remote.startDaemon();
  const outcome = startup.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
  const deadline = Date.now() + f.remote.readyTimeoutMs;
  while (!fs.existsSync(marker) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(fs.existsSync(marker), 'the owned runner must actually start before stop');
  const pid = Number(fs.readFileSync(marker, 'utf8'));
  await f.remote.stopDaemon();
  const result = await outcome;
  assert.equal(result.ok, false, 'the late ready line must not complete cancelled startup');
  assert.equal(result.error.code, 'DSHD_REMOTE_CANCELLED');
  assert.equal(f.remote.daemon, null);
  assert.equal(f.remote.snapshot().listening, false);
  assert.deepEqual(f.remote.snapshot().urls, []);
  assert.ok(!listening.includes(true), 'cancelled startup must never publish listening');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('a refused daemon kill retains the real handle and stop retry observes its exit', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-stop-refused-'));
  const f = fakeRemote({ home, options: {
    stopTimeoutMs: 20,
    execFile: (command, args, options, callback) => callback(new Error('owned tree kill refused')),
  }, runnerBody: [
    "process.stdin.removeAllListeners('data');",
    'emit({ msg: "dshd_daemon_ready", listen: launch.daemonConfig.listen });',
    'setInterval(() => {}, 1000);',
  ].join('\n') });
  let child;
  let originalKill;
  t.after(async () => {
    if (child && originalKill) child.kill = originalKill;
    f.remote.execFile = execFile;
    await f.remote.stopDaemon();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(path.dirname(f.remote.runnerPath), { recursive: true, force: true });
  });
  await f.remote.startDaemon();
  const handle = f.remote.daemon;
  child = handle.child;
  originalKill = child.kill;
  child.kill = () => false;
  await assert.rejects(f.remote.stopDaemon(), /远程守护进程未停止/);
  assert.equal(f.remote.daemon, handle);
  assert.match(f.remote.snapshot().error, /未停止/);
  assert.equal(process.kill(child.pid, 0), true);
  child.kill = originalKill;
  f.remote.execFile = execFile;
  await f.remote.stopDaemon();
  assert.equal(f.remote.daemon, null);
  assert.equal(f.remote.snapshot().listening, false);
  assert.equal(f.remote.snapshot().error, '');
  assert.ok(child.exitCode !== null || child.signalCode);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});

test('Windows daemon timeout keeps refused Node and Electron owned trees tracked until retry', { skip: process.platform !== 'win32' }, async (t) => {
  for (const [runtime, execPath] of [['Node', process.execPath], ['Electron RUN_AS_NODE', require('electron')]]) {
    await t.test(runtime, async (t) => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-owned-tree-'));
      let child;
      let descendantPid;
      let allowTaskkill = false;
      const commands = [];
      const run = (command, args, options, callback) => {
        commands.push(command);
        if (allowTaskkill) execFile(command, args, options, callback);
        else {
          const error = new Error('tree stop denied');
          error.code = 1;
          callback(error, '');
        }
      };
      const f = fakeRemote({ home, options: { stopTimeoutMs: 20, execPath, execFile: run }, runnerBody: [
        "process.stdin.removeAllListeners('data');",
        "const { spawn } = await import('node:child_process');",
        "const leaf = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
        'fs.writeFileSync(launch.daemonConfig.chisacodeHome + "/owned-descendant.pid", String(leaf.pid));',
        'emit({ msg: "dshd_daemon_ready", listen: launch.daemonConfig.listen });',
        'setInterval(() => {}, 1000);',
      ].join('\n') });
      t.after(async () => {
        allowTaskkill = true;
        await f.remote.stopDaemon();
        if (descendantPid) {
          let live = false;
          try { live = process.kill(descendantPid, 0); } catch { /* already gone */ }
          if (live) await new Promise((resolve) => execFile('taskkill', ['/pid', String(descendantPid), '/T', '/F'], { windowsHide: true }, resolve));
        }
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(path.dirname(f.remote.runnerPath), { recursive: true, force: true });
      });
      await f.remote.startDaemon();
      const handle = f.remote.daemon;
      child = handle.child;
      descendantPid = Number(fs.readFileSync(path.join(home, 'owned-descendant.pid'), 'utf8'));
      await assert.rejects(f.remote.stopDaemon(), /未停止.*tree stop denied/);
      assert.deepEqual(commands, ['taskkill']);
      assert.equal(f.remote.daemon, handle);
      assert.equal(process.kill(child.pid, 0), true);
      assert.equal(process.kill(descendantPid, 0), true, 'a denied tree stop must not silently kill only the root');
      allowTaskkill = true;
      await f.remote.stopDaemon();
      assert.equal(f.remote.daemon, null);
      assert.equal(f.remote.snapshot().listening, false);
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
    });
  }
});

test('stop invalidates pending API preparation without waiting or allowing a late spawn', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-api-stop-'));
  const f = fakeRemote({ home });
  const api = f.remote.serverApi;
  let releaseApi;
  const preparing = new Promise((resolve) => { releaseApi = resolve; });
  f.remote.ensureApi = () => preparing;
  t.after(async () => {
    releaseApi(api);
    await f.remote.stopDaemon();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(path.dirname(f.remote.runnerPath), { recursive: true, force: true });
  });
  const startup = f.remote.startDaemon();
  const cancelled = assert.rejects(startup, { code: 'DSHD_REMOTE_CANCELLED' });
  await f.remote.stopDaemon();
  releaseApi(api);
  await cancelled;
  assert.equal(f.remote.daemon, null);
  assert.equal(f.remote.snapshot().listening, false);
  assert.equal(fs.existsSync(path.join(home, 'runner-spawns.log')), false);
});

test('DshdRemote never uses lan.pairingUrl for product QR', async () => {
  const lan = require('../shared/lan');
  const original = lan.pairingUrl;
  let called = false;
  lan.pairingUrl = (...args) => {
    called = true;
    return original(...args);
  };
  try {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
    const remote = new DshdRemote({
      getConfig: () => ({ remoteEnabled: true, remoteRelayEndpoint: 'ayase.cn:443', remoteRelayUseTls: true }),
      getHomeDir: () => home,
    });
    remote.serverApi = {
      async generateLocalPairingOffer() {
        return { relayEnabled: true, url: 'http://192.168.1.1:3180/#offer=x', qr: null };
      },
    };
    await remote.refreshPairing();
    assert.equal(called, false);
  } finally {
    lan.pairingUrl = original;
  }
});

test('loadServerApi exposes the narrow pairing/device-store slice only', { skip: VENDOR_BUILT ? false : VENDOR_BUILD_HINT }, async () => {
  const api = await loadServerApi();
  assert.equal(typeof api.generateLocalPairingOffer, 'function');
  assert.equal(typeof api.RelayDeviceCredentialStore, 'function');
  assert.ok(Array.isArray(api.DSH_VENDOR_PACKAGES));
  assert.equal(api.DSH_VENDOR_PACKAGES.length, 12);
  // The daemon barrel must not be pulled into the main process — importing
  // exports.js loads tens of thousands of ESM modules synchronously on the
  // calling thread (observed: 未响应 on the installed app's remote toggle).
  assert.equal(api.createChisaCodeDaemon, undefined);
  assert.equal(api.createRootLogger, undefined);
});

test('daemon runner export ships the full barrel the child needs', { skip: VENDOR_BUILT ? false : VENDOR_BUILD_HINT }, async () => {
  const { pathToFileURL } = require('url');
  const barrelPath = path.join(
    VENDOR_ROOT, 'node_modules', '@chisacode', 'server', 'dist', 'server', 'server', 'exports.js',
  );
  const barrel = await import(pathToFileURL(barrelPath).href);
  assert.equal(typeof barrel.createChisaCodeDaemon, 'function');
  assert.equal(typeof barrel.createRootLogger, 'function');
  assert.equal(typeof barrel.generateLocalPairingOffer, 'function');
});

test('DSH_VENDOR_PACKAGES mirror matches the vendored provider list', () => {
  const source = fs.readFileSync(path.join(
    VENDOR_ROOT, 'packages', 'server', 'src', 'server', 'agent', 'providers', 'dsh-agent.ts',
  ), 'utf8');
  const match = source.match(/export const DSH_VENDOR_PACKAGES = \[([^\]]+)\]/);
  assert.ok(match, 'upstream DSH_VENDOR_PACKAGES literal not found — update the mirror');
  const upstream = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  assert.deepEqual([...DSH_VENDOR_PACKAGES], upstream);
});

test('loadServerApi fails loud with the vendor-build hint when dist is absent', { skip: VENDOR_BUILT ? 'dist 已构建，缺失路径不可达' : false }, async () => {
  await assert.rejects(loadServerApi(), /dshd remote runtime missing/);
});

function fakeHarnessRoot(builtPackages, unbuiltPackages = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-harness-'));
  for (const pkg of builtPackages) {
    fs.mkdirSync(path.join(root, 'node_modules', '@deepseek-ai', pkg, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js'), '');
  }
  for (const pkg of unbuiltPackages) {
    fs.mkdirSync(path.join(root, 'node_modules', '@deepseek-ai', pkg), { recursive: true });
  }
  return root;
}

test('desktopDshVendorDir requires every package to be present and built', () => {
  const packages = ['dsh-llm-deepseek', 'dsh-tool-fs'];
  const complete = fakeHarnessRoot(packages);
  assert.equal(
    desktopDshVendorDir({ root: complete, packages }),
    path.join(complete, 'node_modules', '@deepseek-ai'),
  );
  // Present but unbuilt (no lib/index.js) must not qualify — the managed
  // cordis.yml points plugin URLs at lib/index.js.
  const unbuilt = fakeHarnessRoot(['dsh-llm-deepseek'], ['dsh-tool-fs']);
  assert.equal(desktopDshVendorDir({ root: unbuilt, packages }), null);
  const missing = fakeHarnessRoot(['dsh-llm-deepseek']);
  assert.equal(desktopDshVendorDir({ root: missing, packages }), null);
  assert.equal(desktopDshVendorDir({ root: complete, packages: [] }), null);
  assert.equal(desktopDshVendorDir({ root: complete }), null);
});

test('dshVendorDirForChild precedence: DSHD_ > inherited CHISACODE_ > bundled > null', () => {
  const packages = ['dsh-llm-deepseek'];
  const complete = fakeHarnessRoot(packages);
  const api = { DSH_VENDOR_PACKAGES: packages };
  const bundled = path.join(complete, 'node_modules', '@deepseek-ai');

  // Desktop-facing name wins over everything.
  assert.equal(
    dshVendorDirForChild(api, { DSHD_DSH_VENDOR_DIR: '/desktop/choice', CHISACODE_DSH_VENDOR_DIR: '/upstream' }, { root: complete }),
    '/desktop/choice',
  );
  // Upstream-compat name wins over the bundled harness.
  assert.equal(
    dshVendorDirForChild(api, { CHISACODE_DSH_VENDOR_DIR: '/upstream' }, { root: complete }),
    '/upstream',
  );
  // Complete bundle becomes the override → the child never probes `npm root -g`.
  assert.equal(dshVendorDirForChild(api, {}, { root: complete }), bundled);
  // Incomplete bundle keeps the (stdio-hardened) npm-global fallback.
  assert.equal(dshVendorDirForChild(api, {}, { root: fakeHarnessRoot([]) }), null);
});

test('resolveDesktopChisaCodeHome honors DSHD_CHISACODE_HOME in dev; packaged needs the allow switch', () => {
  const defaultDir = '/data/chisacode-home';
  assert.equal(resolveDesktopChisaCodeHome({ defaultDir, env: {} }), defaultDir);
  assert.equal(
    resolveDesktopChisaCodeHome({ defaultDir, env: { DSHD_CHISACODE_HOME: '/debug/home' }, isPackaged: false }),
    '/debug/home',
  );
  // Packaged builds drop the inherited override (same law as DSHD_HOME).
  assert.equal(
    resolveDesktopChisaCodeHome({ defaultDir, env: { DSHD_CHISACODE_HOME: '/debug/home' }, isPackaged: true }),
    defaultDir,
  );
  assert.equal(
    resolveDesktopChisaCodeHome({
      defaultDir,
      env: { DSHD_CHISACODE_HOME: '/debug/home', DSHD_ALLOW_ENV_HOME: '1' },
      isPackaged: true,
    }),
    '/debug/home',
  );
  assert.equal(resolveDesktopChisaCodeHome({ defaultDir, env: { DSHD_CHISACODE_HOME: '   ' } }), defaultDir);
});

test('buildDaemonChildEnv bridges CHISACODE_* into the child only and applies the official-DeepSeek credential law', () => {
  const env = buildDaemonChildEnv({
    baseEnv: { PATH: '/usr/bin', HOME: '/home/u' },
    home: '/data/chisacode-home',
    vendorDir: '/bundle/@deepseek-ai',
    shimDir: '/data/chisacode-home/bin',
    config: { apiKey: 'sk-test', baseUrl: '' },
  });
  assert.equal(env.CHISACODE_HOME, '/data/chisacode-home');
  assert.equal(env.CHISACODE_DSH_VENDOR_DIR, '/bundle/@deepseek-ai');
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.PATH, `/data/chisacode-home/bin${path.delimiter}/usr/bin`);
  assert.equal(env.DEEPSEEK_API_KEY, 'sk-test');
  // Third-party gateway: credentials must not alias onto DEEPSEEK_*.
  const thirdParty = buildDaemonChildEnv({
    baseEnv: {},
    home: '/data/chisacode-home',
    vendorDir: null,
    shimDir: null,
    config: { apiKey: 'sk-test', baseUrl: 'https://ayase.example.com/v1' },
  });
  assert.equal(thirdParty.DEEPSEEK_API_KEY, undefined);
  assert.equal(thirdParty.CHISACODE_DSH_VENDOR_DIR, undefined);
  assert.equal(thirdParty.PATH, undefined);
  // Windows-style Path key is reused, not duplicated.
  const win = buildDaemonChildEnv({
    baseEnv: { Path: 'C:\\Windows' },
    home: 'C:\\home',
    vendorDir: null,
    shimDir: 'C:\\home\\bin',
    config: {},
  });
  assert.equal(win.Path, `C:\\home\\bin${path.delimiter}C:\\Windows`);
  assert.equal(win.PATH, undefined);
  const bridged = buildDaemonChildEnv({
    baseEnv: {},
    home: '/data/chisacode-home',
    vendorDir: null,
    shimDir: null,
    config: {},
    harnessOrigin: 'http://127.0.0.1:3080',
    gitTunnelUrl: 'http://127.0.0.1:9',
    gitTunnelToken: 'tok',
  });
  assert.equal(bridged.DSHD_HARNESS_ORIGIN, 'http://127.0.0.1:3080');
  assert.equal(bridged.DSHD_GIT_TUNNEL_URL, 'http://127.0.0.1:9');
  assert.equal(bridged.DSHD_GIT_TUNNEL_TOKEN, 'tok');
  assert.equal(bridged.DSH_HOME, undefined);
});

test('ensureDshAcpShim materializes PATH shims only when the bundled ACP entry is built', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-harness-'));
  assert.equal(ensureDshAcpShim({ home, harnessRoot: emptyRoot, execPath: '/usr/bin/node' }), null);
  assert.equal(fs.existsSync(path.join(home, 'bin')), false);

  const builtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-harness-'));
  const entryDir = path.join(builtRoot, 'packages', 'examples', 'acp-demo', 'lib');
  fs.mkdirSync(entryDir, { recursive: true });
  const entry = path.join(entryDir, 'bin.js');
  fs.writeFileSync(entry, '');
  const binDir = ensureDshAcpShim({ home, harnessRoot: builtRoot, execPath: '/opt/My App/electron' });
  assert.equal(binDir, path.join(home, 'bin'));
  const sh = fs.readFileSync(path.join(binDir, 'dsh-acp-demo'), 'utf8');
  assert.match(sh, /ELECTRON_RUN_AS_NODE=1/);
  assert.ok(sh.includes(`exec "/opt/My App/electron" "${entry}" "$@"`));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(binDir, 'dsh-acp-demo')).mode & 0o755, 0o755);
  }
  const cmd = fs.readFileSync(path.join(binDir, 'dsh-acp-demo.cmd'), 'utf8');
  assert.match(cmd, /set ELECTRON_RUN_AS_NODE=1/);
  assert.ok(cmd.includes(`"/opt/My App/electron" "${entry}" %*`));
});

test('quit cancels a configuration restart or leftover-handle cleanup waiting on the same stop', async () => {
  for (const kind of ['configuration', 'leftover']) {
    const remote = new DshdRemote({ getConfig: () => ({ remoteRelayEndpoint: 'new.example:443' }) });
    if (kind === 'configuration') {
      remote.daemon = { stopping: false };
      remote.runtimeKey = 'old';
    } else remote.pendingDaemon = {};
    let finishStop;
    remote.stopDaemonResources = () => new Promise(resolve => { finishStop = resolve; });
    let starts = 0;
    remote.ensureApi = async () => { starts++; throw new Error('must not start after quit'); };
    const restart = remote.startDaemon();
    const cancelled = assert.rejects(restart, { code: 'DSHD_REMOTE_CANCELLED' });
    await new Promise(setImmediate);
    const quit = remote.stopDaemon();
    finishStop();
    await Promise.all([quit, cancelled]);
    assert.equal(starts, 0, kind);
  }
});

test('DshdRemote snapshot is chisacode-v2 and has no host-token wall', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cc-'));
  let config = { remoteEnabled: false, remoteMode: 'lan', remoteRelayEndpoint: 'relay.example.com:443' };
  const remote = new DshdRemote({
    getConfig: () => config,
    saveConfig: (patch) => { config = { ...config, ...patch }; return config; },
    getHomeDir: () => home,
  });
  const snap = remote.snapshot();
  assert.equal(snap.protocol, 'chisacode-v2');
  assert.equal(snap.relayConfigured, true);
  assert.equal(snap.relayTokenSet, true);
  assert.equal(snap.enabled, false);
});
