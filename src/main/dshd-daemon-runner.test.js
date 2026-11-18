'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DshdRemote, RUNNER_PATH, VENDOR_ROOT } = require('./dshd-remote');
const { prerequisiteSkip, requirePrerequisite } = require('../../scripts/lib/test-prerequisites.cjs');
const { localImportClosure } = require('../../scripts/lib/import-closure.cjs');

// 本文件所有 mkdtemp 目录统一登记，套件结束后无论成败一并回收（#478）。
const tempDirs = [];
test.after(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const VENDOR_RUNNABLE = fs.existsSync(path.join(VENDOR_ROOT, 'node_modules', '@chisacode', 'server', 'dist', 'server', 'server', 'exports.js'))
  && fs.existsSync(path.join(VENDOR_ROOT, 'node_modules'));
const VENDOR_HINT = 'dshd remote dist/依赖缺失（scripts/prepare-dshd-remote.mjs 会构建）';
const VENDOR = { ok: VENDOR_RUNNABLE, reason: VENDOR_HINT };

/**
 * Stub server export implementing the two faces the runner consumes
 * (createRootLogger + createChisaCodeDaemon), controllable via env.
 */
function writeStubServerExport() {
  const dir = tempDir('dsh-stub-api-');
  const file = path.join(dir, 'exports.mjs');
  fs.writeFileSync(file, [
    'export function createRootLogger() {',
    '  const logger = { info() {}, warn() {}, error() {}, child() { return logger; } };',
    '  return logger;',
    '}',
    'export async function createChisaCodeDaemon(config) {',
    '  return {',
    '    async start() {',
    "      if (process.env.STUB_FAIL === '1') throw new Error('boom-start');",
    '    },',
    '    async stop() {',
    "      process.stdout.write(JSON.stringify({ msg: 'stub_daemon_stop_called' }) + '\\n');",
    '    },',
    '  };',
    '}',
    '',
  ].join('\n'));
  return file;
}

function writeLaunchFile(overrides = {}) {
  const home = tempDir('dsh-runner-home-');
  const launchFile = path.join(home, 'daemon-launch.json');
  fs.writeFileSync(launchFile, JSON.stringify({
    serverExport: writeStubServerExport(),
    daemonConfig: { listen: '127.0.0.1:16799', chisacodeHome: home },
    ...overrides,
  }));
  return launchFile;
}

function spawnRunner(t, launchFile, env = {}) {
  const child = spawn(process.execPath, [RUNNER_PATH, launchFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const lines = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try { lines.push(JSON.parse(line)); } catch { lines.push({ raw: line }); }
      }
      idx = buffer.indexOf('\n');
    }
  });
  const exit = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null }));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch { /* 已退出属正常竞态。 */ }
      await exit;
    }
  });
  const waitFor = (msg, timeoutMs = 10_000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const hit = lines.find((record) => record.msg === msg);
      if (hit) { resolve(hit); return; }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for ${msg}; got ${JSON.stringify(lines)}`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
  return { child, lines, exit, waitFor };
}

test('runner boots the daemon, reports ready, and stops gracefully on stdin stop', async (t) => {
  const r = spawnRunner(t, writeLaunchFile());
  const ready = await r.waitFor('dshd_daemon_ready');
  assert.equal(ready.listen, '127.0.0.1:16799');
  r.child.stdin.write('stop\n');
  await r.waitFor('stub_daemon_stop_called');
  await r.waitFor('dshd_daemon_stopped');
  const { code } = await r.exit;
  assert.equal(code, 0);
});

test('runner self-stops when its stdin closes (dead parent leaves no orphan)', async (t) => {
  const r = spawnRunner(t, writeLaunchFile());
  await r.waitFor('dshd_daemon_ready');
  r.child.stdin.end();
  await r.waitFor('stub_daemon_stop_called');
  const { code } = await r.exit;
  assert.equal(code, 0);
});

test('runner reports startup failure on stdout and exits 1', async (t) => {
  const r = spawnRunner(t, writeLaunchFile(), { STUB_FAIL: '1' });
  const failed = await r.waitFor('dshd_daemon_start_failed');
  assert.match(String(failed.error), /boom-start/);
  const { code } = await r.exit;
  assert.equal(code, 1);
});

test('runner fails loud on an unreadable launch file', async (t) => {
  const r = spawnRunner(t, path.join(os.tmpdir(), 'nope', 'missing-launch.json'));
  const failed = await r.waitFor('dshd_daemon_start_failed');
  assert.match(String(failed.error), /launch file unreadable/);
  const { code } = await r.exit;
  assert.equal(code, 1);
});

test(
  'runner stops gracefully on SIGTERM (posix)',
  { skip: process.platform === 'win32' ? 'Windows 无 SIGTERM 语义（stdin 通道即优雅路径）' : false },
  async (t) => {
    const r = spawnRunner(t, writeLaunchFile());
    await r.waitFor('dshd_daemon_ready');
    r.child.kill('SIGTERM');
    await r.waitFor('stub_daemon_stop_called');
    const { code } = await r.exit;
    assert.equal(code, 0);
  },
);

test('spawnRunner cleanup terminates an unstopped child so failed tests do not hang', async (t) => {
  let r;
  await t.test('leaves daemon runner open without writing stop', async (st) => {
    r = spawnRunner(st, writeLaunchFile());
    await r.waitFor('dshd_daemon_ready');
  });
  assert.ok(r.child.exitCode !== null || r.child.signalCode !== null);
});

// ---------------------------------------------------------------------------
// Real vendored daemon through the full DshdRemote face (dist-gated)
// ---------------------------------------------------------------------------

test(
  'DshdRemote runs the real vendored daemon in a child process end to end',
  { skip: prerequisiteSkip(VENDOR), timeout: 120_000 },
  async (t) => {
    requirePrerequisite(t, VENDOR);
    const home = tempDir('dsh-cc-real-');
    const port = 17000 + Math.floor(Math.random() * 20000);
    const config = {
      remoteEnabled: true,
      // Closed loopback port: relay connect fails fast and stays local, but the
      // daemon itself must still come up (relay errors are non-fatal).
      remoteRelayEndpoint: '127.0.0.1:9',
      remoteRelayUseTls: false,
      remotePort: port,
    };
    const remote = new DshdRemote({
      getConfig: () => config,
      getHomeDir: () => home,
      readyTimeoutMs: 90_000,
    });
    remote.ensureMobileWebServer = async () => {};
    remote.stopMobileWebServer = async () => {};

    await remote.startDaemon();
    try {
      const snap = remote.snapshot();
      assert.equal(snap.listening, true);
      // Pairing offer is generated in the main process against the same
      // file-backed home (upstream `daemon pair` shape).
      assert.match(String(snap.urls[0] && snap.urls[0].pairingUrl), /#/);
      // The daemon child actually serves HTTP on the configured port.
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
      assert.ok(res.status > 0);
      const child = remote.daemon.child;
      await remote.stopDaemon();
      assert.ok(child.exitCode !== null || child.signalCode);
      assert.equal(remote.snapshot().listening, false);
    } finally {
      if (remote.daemon) {
        await remote.stopDaemon();
      }
    }
  },
);

test('asarUnpack ships the whole daemon runner import chain (plain node cannot read app.asar)', () => {
  // Regression: the runner was unpacked but `./dshd-daemon-hooks.mjs` stayed
  // inside app.asar, so the packaged daemon died with ERR_MODULE_NOT_FOUND
  // and Settings → Remote only ever showed "远程暂时不可用".
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const unpacked = new Set(pkg.build.asarUnpack);
  const reachable = localImportClosure(path.join(__dirname, '..', '..'), RUNNER_PATH);
  assert.ok(reachable.includes('src/main/dshd-daemon-hooks.mjs'));
  for (const rel of reachable) {
    assert.ok(unpacked.has(rel), `${rel} is imported by the daemon runner but missing from build.asarUnpack`);
  }
});
