'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { installDelta, pickDeltaAsset } = require('./install');
const { buildDelta } = require('./build');
const { applyDeltaFile, DeltaApplyError } = require('./apply');
const manifest = require('./manifest');
const ipcDelta = require('../../main/ipc-delta');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-delta-ipc-'));
}

const RELEASE = {
  tag_name: 'v2.0.0',
  name: 'v2.0.0',
  assets: [
    { name: 'Whale-Isle-Setup-2.0.0.exe', browser_download_url: 'https://x.test/setup.exe' },
    { name: 'Whale-Isle-delta-1.0.0-2.0.0.zip', browser_download_url: 'https://x.test/delta.zip' },
    { name: 'SHA512SUMS.txt', browser_download_url: 'https://x.test/sums.txt' },
  ],
};

function baseDeps(overrides = {}) {
  return {
    isLauncherPackage: () => true,
    installedInfo: async () => ({ registeredInstall: true, installPath: 'C:\\Apps\\DSHD', version: '1.0.0' }),
    beforeApply: async () => ({ ok: true }),
    route: 'github',
    fetchRelease: async () => RELEASE,
    update: {
      downloadFile: async (_url, dest, onProgress) => {
        if (typeof onProgress === 'function') {
          onProgress({ phase: 'download', percent: 42 });
        }
        fs.writeFileSync(dest, 'zip-bytes');
        return dest;
      },
      verifyAssetChecksum: async () => {},
    },
    applyFile: async () => ({ ok: true, applied: { added: 1, patched: 2, deleted: 1, skipped: 0 } }),
    fullInstall: async () => ({ ok: true, launched: true }),
    deltaDir: path.join(os.tmpdir(), 'dshd-delta-cache-test'),
    ...overrides,
  };
}

// --- installDelta orchestration -----------------------------------------------

test('installDelta applies a matching verified delta and reports mode:delta', async () => {
  const progress = [];
  let fullCalls = 0;
  const deps = baseDeps({ fullInstall: async () => { fullCalls += 1; return { ok: true }; } });
  const result = await installDelta('v2.0.0', (p) => progress.push(p), deps);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'delta');
  assert.equal(result.from, '1.0.0');
  assert.equal(result.to, '2.0.0');
  assert.equal(fullCalls, 0);
  assert.ok(progress.some((p) => p.phase === 'download' && p.differential === true));
});

test('installDelta reports a missing delta without a full download or stopping the desktop', async () => {
  let fullTag = null;
  let stopped = 0;
  const release = { ...RELEASE, assets: RELEASE.assets.filter((a) => !a.name.includes('-delta-')) };
  const deps = baseDeps({
    fetchRelease: async () => release,
    fullInstall: async (tag) => { fullTag = tag; return { launched: true }; },
    beforeApply: async () => { stopped++; return { ok: true }; },
  });
  const result = await installDelta('v2.0.0', null, deps);
  assert.deepEqual(result, { ok: false, mode: 'delta', error: 'delta-asset-missing' });
  assert.equal(fullTag, null);
  assert.equal(stopped, 0);
});

test('installDelta reports a drifted base without switching to the full installer', async () => {
  const calls = [];
  const deps = baseDeps({
    applyFile: async () => { throw new DeltaApplyError('base-mismatch', 'drifted', 'x.dll'); },
    fullInstall: async (tag, onProgress) => { calls.push('full'); return { ok: true, status: 'installed' }; },
  });
  const result = await installDelta('v2.0.0', null, deps);
  assert.deepEqual(result, { ok: false, mode: 'delta', error: 'base-mismatch' });
  assert.deepEqual(calls, []);
});

test('installDelta reports missing checksums before stopping the desktop or downloading', async () => {
  let stopped = 0;
  let downloaded = 0;
  const release = { ...RELEASE, assets: RELEASE.assets.filter((a) => a.name !== 'SHA512SUMS.txt') };
  const deps = baseDeps({ fetchRelease: async () => release,
    beforeApply: async () => { stopped++; return { ok: true }; },
    update: { downloadFile: async () => { downloaded++; } },
  });
  const result = await installDelta('v2.0.0', null, deps);
  assert.deepEqual(result, { ok: false, mode: 'delta', error: 'delta-unverified' });
  assert.equal(stopped, 0);
  assert.equal(downloaded, 0);
});

test('installDelta refuses the full package (cannot patch a running self)', async () => {
  let fetched = false;
  const deps = baseDeps({
    isLauncherPackage: () => false,
    fetchRelease: async () => { fetched = true; return RELEASE; },
  });
  const result = await installDelta('v2.0.0', null, deps);
  assert.equal(result.mode, 'delta');
  assert.equal(result.error, 'unsupported-package');
  assert.equal(fetched, false);
});

test('installDelta refuses a missing base and preserves task-protection refusal before applying', async () => {
  const missing = await installDelta('v2.0.0', null, baseDeps({
    installedInfo: async () => ({ registeredInstall: false, installPath: '' }),
  }));
  assert.equal(missing.error, 'no-installed-base');
  // A desktop that refuses to exit must not fall back into the full-install
  // lane — its handshake would re-prompt for the same decision.
  const busy = await installDelta('v2.0.0', null, baseDeps({
    beforeApply: async () => ({ ok: false, error: 'desktop-still-running' }),
    applyFile: async (_file, _target, options) => options.beforeApply(),
  }));
  assert.equal(busy.mode, 'delta');
  assert.equal(busy.ok, false);
  assert.equal(busy.error, 'desktop-still-running');
  const cancelled = await installDelta('v2.0.0', null, baseDeps({
    beforeApply: async () => ({ ok: false, cancelled: true, error: 'peer-cancelled' }),
    applyFile: async (_file, _target, options) => options.beforeApply(),
  }));
  assert.equal(cancelled.mode, 'delta');
  assert.equal(cancelled.cancelled, true);
});

test('installDelta reports a missing release without invoking a full install', async () => {
  let fullCalls = 0;
  const deps = baseDeps({
    fetchRelease: async () => null,
    fullInstall: async () => { fullCalls++; return { ok: true }; },
  });
  const result = await installDelta('v9.9.9', null, deps);
  assert.equal(result.mode, 'delta');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'release-not-found');
  assert.equal(fullCalls, 0);
});

test('installDelta downloads and verifies before protected shutdown, then applies the selected target', async () => {
  const events = [];
  const result = await installDelta('v2.0.0', null, baseDeps({
    update: {
      downloadFile: async (_url, dest) => { events.push('download'); fs.writeFileSync(dest, 'zip-bytes'); },
      verifyAssetChecksum: async () => { events.push('checksum'); },
    },
    beforeApply: async () => { events.push('stop'); return { ok: true }; },
    applyFile: async (_file, _target, options) => {
      assert.equal(options.expectedProduct, 'Whale-Isle');
      assert.equal(options.expectedFromVersion, '1.0.0');
      assert.equal(options.expectedToVersion, '2.0.0');
      await options.beforeApply();
      events.push('apply');
      return { ok: true, applied: {} };
    },
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(events, ['download', 'checksum', 'stop', 'apply']);
});

test('installDelta leaves the desktop running after download and SHA512 verification failures', async () => {
  for (const failedPhase of ['download', 'checksum']) {
    let stopped = 0;
    let fullCalls = 0;
    const result = await installDelta('v2.0.0', null, baseDeps({
      update: {
        downloadFile: async (_url, dest) => {
          if (failedPhase === 'download') throw new Error('download-failed');
          fs.writeFileSync(dest, 'unverified-bytes');
        },
        verifyAssetChecksum: async () => { throw new Error('checksum-failed'); },
      },
      beforeApply: async () => { stopped++; return { ok: true }; },
      applyFile: async () => { assert.fail('unverified delta must not be applied'); },
      fullInstall: async () => { fullCalls++; },
    }));
    assert.deepEqual(result, { ok: false, mode: 'delta', error: `${failedPhase}-failed` });
    assert.equal(stopped, 0);
    assert.equal(fullCalls, 0);
  }
});

test('pickDeltaAsset matches only the installed→target version pair', () => {
  assert.equal(pickDeltaAsset(RELEASE.assets, '1.0.0', '2.0.0').name, 'Whale-Isle-delta-1.0.0-2.0.0.zip');
  assert.equal(pickDeltaAsset(RELEASE.assets, '1.0.1', '2.0.0'), null);
  assert.equal(pickDeltaAsset(RELEASE.assets, 'v1.0.0', 'v2.0.0').name, 'Whale-Isle-delta-1.0.0-2.0.0.zip');
  assert.equal(pickDeltaAsset([], '1.0.0', '2.0.0'), null);
});

// --- real end-to-end through installDelta (build + download + apply) ----------

test('installDelta end-to-end: a product name with spaces validates before protected shutdown and real apply', async () => {
  const dir = tmpdir();
  const fromDir = path.join(dir, 'from');
  const toDir = path.join(dir, 'to');
  const installDir = path.join(dir, 'installed');
  fs.mkdirSync(fromDir, { recursive: true });
  fs.mkdirSync(toDir, { recursive: true });
  fs.writeFileSync(path.join(fromDir, 'a.txt'), 'old-a');
  fs.writeFileSync(path.join(fromDir, 'b.txt'), 'old-b');
  fs.writeFileSync(path.join(toDir, 'a.txt'), 'new-a');
  fs.writeFileSync(path.join(toDir, 'c.txt'), 'new-c');
  fs.cpSync(fromDir, installDir, { recursive: true });
  const zipPath = path.join(dir, 'wire.zip');
  const built = await buildDelta({ fromDir, toDir, outFile: zipPath, product: 'Whale Isle', fromVersion: '1.0.0', toVersion: '2.0.0' });
  const wireBytes = fs.readFileSync(zipPath);
  const events = [];
  assert.equal(built.manifest.product, 'Whale Isle');

  const deps = baseDeps({
    installedInfo: async () => ({ registeredInstall: true, installPath: installDir, version: '1.0.0' }),
    update: {
      downloadFile: async (_url, dest) => { events.push('download'); fs.writeFileSync(dest, wireBytes); return dest; },
      verifyAssetChecksum: async (dest) => { assert.equal(await manifest.sha512File(dest), built.sha512); events.push('checksum'); },
    },
    beforeApply: async () => {
      assert.deepEqual(events, ['download', 'checksum']);
      assert.equal(fs.readFileSync(path.join(installDir, 'a.txt'), 'utf8'), 'old-a');
      assert.equal(fs.existsSync(path.join(installDir, 'c.txt')), false);
      assert.equal(fs.readdirSync(installDir).some(name => name.startsWith('.dshd-delta-')), false);
      events.push('stop');
      return { ok: true };
    },
    applyFile: applyDeltaFile,
    deltaDir: path.join(dir, 'cache'),
    fullInstall: async () => ({ ok: false, error: 'should-not-run' }),
  });
  const result = await installDelta('v2.0.0', null, deps);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'delta');
  assert.deepEqual(events, ['download', 'checksum', 'stop']);
  assert.equal(fs.readFileSync(path.join(installDir, 'a.txt'), 'utf8'), 'new-a');
  assert.equal(fs.readFileSync(path.join(installDir, 'c.txt'), 'utf8'), 'new-c');
  assert.equal(fs.existsSync(path.join(installDir, 'b.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- ipc-delta contract -------------------------------------------------------

function fakeCtx(install = async () => ({ ok: true, mode: 'delta' })) {
  const calls = { handled: null, sent: [] };
  const ctx = {
    LAUNCHER_ONLY: ['launcher'],
    handle: (channel, roles, listener) => { calls.handled = { channel, roles, listener }; },
    send: (event, channel, payload) => { calls.sent.push({ channel, payload }); },
    launcher: { installDelta: install, installRelease: async () => { assert.fail('delta IPC must not invoke full install'); } },
  };
  return { ctx, calls };
}

test('register mounts shell:install-delta on LAUNCHER_ONLY and forwards progress', async () => {
  const seen = [];
  const { ctx, calls } = fakeCtx(async (tag, onProgress) => {
      seen.push(tag);
      onProgress({ phase: 'download', percent: 5 });
      return { ok: true, mode: 'delta' };
  });
  try {
    ipcDelta.register(ctx);
    assert.equal(calls.handled.channel, 'shell:install-delta');
    assert.equal(calls.handled.roles, ctx.LAUNCHER_ONLY);
    const result = await calls.handled.listener({}, 'v2.0.0');
    assert.deepEqual(result, { ok: true, mode: 'delta' });
    assert.deepEqual(seen, ['v2.0.0']);
    assert.equal(calls.sent[0].channel, 'shell:update-progress');
    assert.equal(calls.sent[0].payload.delta, true);
    assert.equal(calls.sent[0].payload.percent, 5);
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
});

test('register delegates delta errors unchanged through the guarded service', async () => {
  const { ctx, calls } = fakeCtx(async (tag, onProgress) => installDelta(tag, onProgress, baseDeps({
    fetchRelease: async () => null,
  })));
  try {
    ipcDelta.register(ctx);
    const result = await calls.handled.listener({}, 'v9.9.9');
    assert.deepEqual(result, { ok: false, mode: 'delta', error: 'release-not-found' });
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
});

test('register maps a thrown service error to {ok:false, mode:delta}', async () => {
  const { ctx, calls } = fakeCtx(async () => { throw new Error('kaboom'); });
  try {
    ipcDelta.register(ctx);
    const result = await calls.handled.listener({}, 'v1');
    assert.deepEqual(result, { ok: false, mode: 'delta', error: 'kaboom' });
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
});

test('contributeStatus lists cached delta artifacts and lastError', async () => {
  const dir = tmpdir();
  const artifact = path.join(dir, 'Whale-Isle-delta-0.3.2-0.3.3.zip');
  fs.writeFileSync(artifact, 'zipbytes');
  fs.writeFileSync(`${artifact}.json`, JSON.stringify({ tag: 'v0.3.3' }));
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'x');
  ipcDelta.setDeltaDeps({ deltaDir: dir });
  try {
    const status = ipcDelta.contributeStatus();
    assert.deepEqual(status, {
      deltas: { available: [{ tag: 'v0.3.3', from: '0.3.2', size: Buffer.byteLength('zipbytes') }] },
    });
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('contributeStatus returns null when nothing is cached and no error', () => {
  const dir = tmpdir();
  ipcDelta.setDeltaDeps({ deltaDir: dir });
  try {
    assert.equal(ipcDelta.contributeStatus(), null);
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('contributeStatus surfaces lastError after a failed install', async () => {
  const { ctx, calls } = fakeCtx(async () => ({ ok: false, mode: 'delta', error: 'boom' }));
  const dir = tmpdir();
  ipcDelta.setDeltaDeps({
    deltaDir: dir,
  });
  try {
    ipcDelta.register(ctx);
    await calls.handled.listener({}, 'v1');
    const status = ipcDelta.contributeStatus();
    assert.equal(status.deltas.lastError, 'boom');
    assert.deepEqual(status.deltas.available, []);
  } finally {
    ipcDelta.setDeltaDeps(null);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
