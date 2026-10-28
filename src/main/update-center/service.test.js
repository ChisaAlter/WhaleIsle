'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createUpdateCenter } = require('./service');

const ROUTES = [{ id: 'cnb', label: 'CNB' }, { id: 'github', label: 'GitHub' }];
const sha = (bytes) => crypto.createHash('sha512').update(bytes).digest('hex');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function release(version, extra = {}) {
  return {
    version, tag: `v${version}`, notes: `notes ${version}`, publishedAt: '2026-10-29',
    assetName: `Whale-Isle-Setup-${version}.exe`, assetUrl: `https://example.test/${version}.exe`,
    assetSize: 1000, checksumUrl: 'https://example.test/SHA512SUMS.txt',
    blockmapUrl: 'https://example.test/a.blockmap', updaterMetadataUrl: 'https://example.test/latest.yml',
    ...extra,
  };
}

function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-update-center-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const payload = crypto.randomBytes(1000);
  const calls = { install: [], download: [], delta: 0, resolve: [] };
  const config = { route: 'cnb', explicit: false, autoDownload: true };
  const control = { stallAt: null, deltaResult: null, failRoutes: new Set(), installResult: { launched: true } };
  const logs = [];
  const deps = {
    userDataDir: dir,
    currentVersion: () => '0.3.12',
    routes: ROUTES,
    getRoute: () => config.route,
    isRouteExplicit: () => config.explicit,
    saveRoute: (route) => { config.route = route; config.explicit = true; },
    getAutoDownload: () => config.autoDownload,
    saveAutoDownload: (value) => { config.autoDownload = value; },
    resolveRelease: async (route, tag) => {
      calls.resolve.push([route, tag]);
      if (control.failRoutes.has(route)) throw Object.assign(new Error('GitHub 请求超时（10s）'), { code: 'ETIMEDOUT' });
      return control.release === undefined ? release('0.3.13') : control.release;
    },
    planDelta: async () => control.plan || { ok: true, downloadBytes: 210 },
    readChecksum: async () => sha(payload),
    // Writes the payload from the persisted offset; stalls (until aborted) at stallAt.
    downloadFile: async (url, dest, onProgress, options) => {
      calls.download.push({ url, offset: options.resumeState.offset });
      const state = options.resumeState;
      let offset = state.offset || 0;
      if (offset === 0) fs.writeFileSync(dest, Buffer.alloc(0));
      state.total = payload.length;
      while (offset < payload.length) {
        if (options.signal.aborted) throw Object.assign(new Error('下载已取消'), { name: 'AbortError' });
        if (control.stallAt !== null && offset >= control.stallAt) { await tick(); continue; }
        const end = Math.min(payload.length, offset + 100);
        fs.appendFileSync(dest, payload.subarray(offset, end));
        offset = end;
        state.offset = offset;
        onProgress({ phase: 'download', received: offset, total: payload.length, bytesPerSecond: 100 });
        await tick();
      }
    },
    verifyFile: async (file, expected) => {
      if (sha(fs.readFileSync(file)) !== expected) throw Object.assign(new Error('安装包校验失败（sha512 不匹配）'), { code: 'ERR_UPDATER_CHECKSUM_MISMATCH' });
    },
    downloadDelta: async (target, onProgress) => {
      calls.delta += 1;
      if (control.deltaResult) return control.deltaResult;
      onProgress({ phase: 'download', received: 210, total: 210, bytesPerSecond: 50 });
      const installer = path.join(dir, 'pending-installer.exe');
      fs.writeFileSync(installer, payload);
      return { ok: true, installer };
    },
    install: async (target, file, options) => { calls.install.push({ version: target.version, file, options }); return control.installResult; },
    compareVersions,
    platform: 'win32',
    timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} },
    log: (line) => logs.push(line),
    ...overrides,
  };
  const make = () => createUpdateCenter(deps);
  return { dir, payload, calls, config, control, logs, deps, make };
}

async function settle(center, phases) {
  for (let i = 0; i < 2000; i++) {
    if (phases.includes(center.snapshot().phase)) return center.snapshot();
    await tick();
  }
  throw new Error(`stuck in ${center.snapshot().phase}`);
}

test('a worthwhile delta is used, shows only its download size, and installs with updater arguments', async (t) => {
  const f = fixture(t);
  const center = f.make();
  center.start();
  const views = [];
  center.subscribe((view) => views.push(view));
  await center.command('check');
  const ready = await settle(center, ['ready', 'error']);
  assert.equal(ready.phase, 'ready');
  assert.deepEqual(ready.plan, { method: 'delta', downloadBytes: 210, fullBytes: 1000 });
  assert.equal(f.calls.delta, 1);
  assert.equal(f.calls.download.length, 0);
  assert.ok(views.some((view) => view.phase === 'downloading' && view.progress?.received === 210));
  await center.command('install');
  assert.deepEqual(f.calls.install[0].options.installerArgs, ['--updated', '/S', '--force-run']);
});

test('a delta that saves too little is not offered; the full installer is planned', async (t) => {
  const f = fixture(t);
  f.control.plan = { ok: true, downloadBytes: 900 };
  f.config.autoDownload = false;
  const center = f.make();
  center.start();
  const view = await center.command('check');
  assert.equal(view.phase, 'available');
  assert.deepEqual(view.plan, { method: 'full', downloadBytes: 1000, fullBytes: 1000 });
});

test('a failed delta continues with the full installer without asking', async (t) => {
  const f = fixture(t);
  f.control.deltaResult = { ok: false, reason: 'missing-base-release', message: '缺少增量基底' };
  const center = f.make();
  center.start();
  await center.command('check');
  const view = await settle(center, ['ready', 'error']);
  assert.equal(view.phase, 'ready');
  assert.equal(view.plan.method, 'full');
  assert.equal(f.calls.download.length, 1);
  assert.ok(f.logs.some((line) => line.includes('delta failed')));
});

test('a paused full download resumes from the bytes on disk, also after a restart', async (t) => {
  const f = fixture(t);
  f.control.plan = { ok: false, reason: 'no-base' };
  f.control.stallAt = 400;
  const first = f.make();
  first.start();
  await first.command('check');
  for (let i = 0; i < 200 && (first.snapshot().progress?.received || 0) < 400; i++) await tick();
  const paused = await first.command('pause');
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.userPaused, true);
  assert.equal(fs.statSync(path.join(f.dir, 'updates', 'Whale-Isle-Setup-0.3.13.exe.part')).size, 400);
  // A new process restores the paused job; a background check leaves it paused.
  const second = f.make();
  second.start();
  assert.equal(second.snapshot().phase, 'paused');
  assert.equal(second.snapshot().progress.received, 400);
  await second.command('check');
  assert.equal(second.snapshot().phase, 'paused');
  f.control.stallAt = null;
  await second.command('resume');
  const ready = await settle(second, ['ready', 'error']);
  assert.equal(ready.phase, 'ready');
  assert.deepEqual(f.calls.download.map((call) => call.offset), [0, 400]);
  assert.ok(fs.readFileSync(path.join(f.dir, 'updates', 'Whale-Isle-Setup-0.3.13.exe')).equals(f.payload));
});

test('cancel discards the partial download', async (t) => {
  const f = fixture(t);
  f.control.plan = { ok: false };
  f.control.stallAt = 300;
  const center = f.make();
  center.start();
  await center.command('check');
  for (let i = 0; i < 200 && (center.snapshot().progress?.received || 0) < 300; i++) await tick();
  const view = await center.command('cancel');
  assert.equal(view.phase, 'available');
  assert.equal(fs.existsSync(path.join(f.dir, 'updates', 'Whale-Isle-Setup-0.3.13.exe.part')), false);
});

test('up to date clears the job and removes old installers', async (t) => {
  const f = fixture(t);
  f.control.release = release('0.3.12');
  const updates = path.join(f.dir, 'updates');
  fs.mkdirSync(updates, { recursive: true });
  for (const name of ['Whale-Isle-Setup-0.3.8.exe', 'Whale-Isle-Setup-0.3.11.exe', 'x.exe.part', 'keep.txt']) {
    fs.writeFileSync(path.join(updates, name), 'x');
  }
  const center = f.make();
  center.start();
  const view = await center.command('check');
  assert.equal(view.phase, 'current');
  assert.deepEqual(fs.readdirSync(updates), ['keep.txt']);
});

test('an unreachable default route falls back once; a picked route reports and suggests the other', async (t) => {
  const f = fixture(t);
  f.config.autoDownload = false;
  f.control.failRoutes.add('cnb');
  const center = f.make();
  center.start();
  const view = await center.command('check');
  assert.equal(view.phase, 'available');
  assert.equal(view.target.route, 'github');
  f.config.explicit = true;
  const failed = await center.command('check');
  assert.equal(failed.phase, 'error');
  assert.equal(failed.error.network, true);
  assert.equal(failed.error.suggestRoute, 'github');
});

test('switching the route re-checks on the new route and keeps downloaded bytes', async (t) => {
  const f = fixture(t);
  f.control.plan = { ok: false };
  f.control.stallAt = 500;
  const center = f.make();
  center.start();
  await center.command('check');
  for (let i = 0; i < 200 && (center.snapshot().progress?.received || 0) < 500; i++) await tick();
  f.control.stallAt = null;
  await center.command('setRoute', 'github');
  const ready = await settle(center, ['ready', 'error']);
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.route, 'github');
  assert.equal(f.calls.download.at(-1).offset, 500);
});

test('with auto download off a found update waits for the user', async (t) => {
  const f = fixture(t);
  f.config.autoDownload = false;
  const center = f.make();
  center.start();
  const view = await center.command('check');
  assert.equal(view.phase, 'available');
  assert.equal(f.calls.delta + f.calls.download.length, 0);
  await center.command('setAutoDownload', true);
  assert.equal((await settle(center, ['ready', 'error'])).phase, 'ready');
});

test('a corrupted ready installer is discarded at install time instead of launched', async (t) => {
  const f = fixture(t);
  f.control.plan = { ok: false };
  const center = f.make();
  center.start();
  await center.command('check');
  await settle(center, ['ready', 'error']);
  fs.writeFileSync(path.join(f.dir, 'updates', 'Whale-Isle-Setup-0.3.13.exe'), 'tampered');
  const view = await center.command('install');
  assert.equal(view.phase, 'error');
  assert.equal(f.calls.install.length, 0);
});

test('installing a listed version downloads the full installer and launches it', async (t) => {
  const f = fixture(t);
  f.config.autoDownload = false;
  f.control.release = release('0.3.10');
  const center = f.make();
  center.start();
  await center.command('installVersion', 'v0.3.10');
  await settle(center, ['installing', 'error']);
  for (let i = 0; i < 50 && f.calls.install.length === 0; i++) await tick();
  assert.deepEqual(f.calls.resolve.at(-1), ['cnb', 'v0.3.10']);
  assert.equal(f.calls.install[0].version, '0.3.10');
  assert.deepEqual(f.calls.install[0].options.installerArgs, []);
});

test('a network failure during a background download keeps the bytes for a resume', async (t) => {
  const f = fixture(t);
  f.control.plan = { ok: false };
  let calls = 0;
  f.deps.downloadFile = async (url, dest, onProgress, options) => {
    calls += 1;
    options.resumeState.total = 1000;
    fs.writeFileSync(dest, f.payload.subarray(0, 600));
    options.resumeState.offset = 600;
    throw Object.assign(new Error('下载连接中断：socket hang up'), { code: 'ECONNRESET', retryable: true });
  };
  const center = f.make();
  center.start();
  await center.command('check');
  const view = await settle(center, ['error']);
  assert.equal(view.error.operation, 'download');
  assert.equal(view.error.canResume, true);
  assert.equal(view.error.suggestRoute, 'github');
  assert.equal(calls, 1);
});
