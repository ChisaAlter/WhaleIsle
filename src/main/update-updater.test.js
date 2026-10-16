'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { HttpExecutor } = require('builder-util-runtime');
const {
  downloadLatestViaUpdater: installLatestViaUpdater, makeDifferentialTracker,
  cachedInstallerPath, differentialAvailability, strictNsisUpdaterClass, prepareDifferentialBase,
} = require('./update-updater');

const expectedCheck = {
  tag: 'v9.9.9', latest: '9.9.9', assetName: 'Setup.exe',
  assetUrl: 'https://example.test/Setup.exe', checksumUrl: 'https://example.test/SHA512SUMS.txt',
  blockmapUrl: 'https://example.test/Setup.exe.blockmap', updaterMetadataUrl: 'https://example.test/latest.yml',
};

function packagedDeps(fake, extra = {}) {
  return { isPackaged: true, platform: 'win32', autoUpdater: fake, prepareDifferentialBase: async () => ({ ok: true }), ...extra };
}

class FakeCancellationToken {
  constructor() {
    this.cancelled = false;
    this._waiters = [];
  }
  cancel() {
    this.cancelled = true;
    const waiters = this._waiters.splice(0);
    for (const reject of waiters) {
      reject(new Error('cancelled'));
    }
  }
  whenCancelled() {
    return new Promise((_resolve, reject) => this._waiters.push(reject));
  }
}

function fakeAutoUpdater(overrides = {}) {
  const updater = new EventEmitter();
  updater.calls = { checkForUpdates: 0, downloadUpdate: 0, quitAndInstall: [] };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.getOrCreateDownloadHelper = async () => ({ cacheDir: 'C:/configured-updater-cache' });
  updater.checkForUpdates = async () => {
    updater.calls.checkForUpdates += 1;
    if (overrides.failCheck) {
      throw new Error('check failed');
    }
    if (overrides.noUpdate) {
      return { updateInfo: null };
    }
    const info = { version: overrides.version || '9.9.9' };
    updater.updateInfoAndProvider = { info, provider: { resolveFiles: () => [{
      url: new URL(`https://example.test/${overrides.assetName || 'Setup.exe'}`), info: { url: overrides.assetName || 'Setup.exe' },
    }] } };
    return { updateInfo: info };
  };
  updater.downloadUpdate = async (token = new FakeCancellationToken()) => {
    updater.calls.downloadUpdate += 1;
    updater.calls.token = token;
    if (overrides.logLine && updater.logger) {
      updater.logger.info(overrides.logLine);
    }
    if (overrides.failDownload) {
      throw new Error('download failed');
    }
    if (overrides.hang) {
      await token.whenCancelled().catch((error) => {
        updater.calls.downloadCancelled = true;
        throw error;
      });
      return;
    }
    for (const percent of overrides.progress || [42]) {
      updater.emit('download-progress', { percent, transferred: percent, total: 100 });
    }
    return overrides.downloaded || ['C:/updates/installer.exe'];
  };
  updater.quitAndInstall = (...args) => {
    updater.calls.quitAndInstall.push(args);
  };
  return updater;
}

function collectProgress() {
  const events = [];
  return { events, onProgress: (payload) => events.push(payload) };
}

test('updater path refuses non-packaged runs before touching autoUpdater', async () => {
  const fake = fakeAutoUpdater();
  const result = await installLatestViaUpdater({}, null, { isPackaged: false, autoUpdater: fake });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-packaged');
  assert.match(result.message, /源码/);
  assert.equal(fake.calls.checkForUpdates, 0);
});

test('updater path refuses non-Windows packaged runs before probing manifests', async () => {
  const fake = fakeAutoUpdater();
  const result = await installLatestViaUpdater({}, null, {
    isPackaged: true,
    platform: 'darwin',
    autoUpdater: fake, prepareDifferentialBase: async () => ({ ok: true }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-windows');
  assert.equal(fake.calls.checkForUpdates, 0, 'macOS must not fetch latest-mac.yml we never publish');
});

test('updater path reports no-update when latest.yml resolves nothing', async () => {
  const fake = fakeAutoUpdater({ noUpdate: true });
  const result = await installLatestViaUpdater({ expectedCheck }, null, packagedDeps(fake));
  assert.deepEqual(result, { ok: false, reason: 'no-update-in-manifest' });
  assert.equal(fake.calls.downloadUpdate, 0);
  assert.equal(fake.listenerCount('download-progress'), 0, 'listeners must be cleaned up');
});

test('updater path returns a downloaded installer and reports the real differential share without installing', async () => {
  const fake = fakeAutoUpdater({
    version: '0.3.3',
    logLine: 'Full: 636.65 MB, To download: 44.59 MB (7%)',
    progress: [12, 48],
  });
  const { events, onProgress } = collectProgress();
  const result = await installLatestViaUpdater({ timeoutMs: 60_000, expectedCheck: { ...expectedCheck, tag: 'v0.3.3', latest: '0.3.3' } }, onProgress, {
    isPackaged: true, platform: 'win32',
    autoUpdater: fake, prepareDifferentialBase: async () => ({ ok: true }),
    existsSync: () => true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.installer, 'C:/updates/installer.exe');
  assert.equal(result.launched, undefined);
  assert.equal(result.version, '0.3.3');
  assert.equal(result.differential, true);
  assert.equal(result.downloadPercent, 7);
  assert.deepEqual(fake.calls.quitAndInstall, [], 'installation is owned by the observed spawn commit');
  assert.equal(fake.autoDownload, false, 'manual download only');
  assert.deepEqual(events.map((e) => [e.phase, e.percent]), [['download', 12], ['download', 48]]);
  assert.equal(events[0].differential, true, 'downloader report marks differential before first tick');
  assert.equal(fake.listenerCount('download-progress'), 0);
  assert.equal(fake.listenerCount('error'), 0);
});

test('incremental selection without an installer cache never probes or downloads', async () => {
  const fake = fakeAutoUpdater();
  const { events, onProgress } = collectProgress();
  const result = await installLatestViaUpdater({ expectedCheck }, onProgress, {
    isPackaged: true, platform: 'win32',
    autoUpdater: fake,
    prepareDifferentialBase: async () => ({ ok: false, reason: 'missing-cached-installer' }),
    existsSync: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-cached-installer');
  assert.equal(events.length, 0);
  assert.equal(fake.calls.checkForUpdates, 0);
  assert.equal(fake.calls.downloadUpdate, 0);
});

test('reuse of a pending installer does not invent differential savings', async () => {
  const fake = fakeAutoUpdater({ logLine: undefined, progress: [] });
  const { events, onProgress } = collectProgress();
  const result = await installLatestViaUpdater({ expectedCheck }, onProgress, {
    isPackaged: true, platform: 'win32',
    autoUpdater: fake, prepareDifferentialBase: async () => ({ ok: true }),
    existsSync: () => true,
  });
  assert.equal(events.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.differential, false);
  assert.equal(result.downloadPercent, null, 'zero transfer carries no guessed savings');
});

test('updater path propagates download failures and stops the incremental action', async () => {
  const fake = fakeAutoUpdater({ failDownload: true });
  const result = await installLatestViaUpdater({ expectedCheck }, null, packagedDeps(fake));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'updater-error');
  assert.match(result.message, /download failed/);
  assert.match(result.message, /下载已停止/);
  assert.equal(fake.calls.quitAndInstall.length, 0, 'no install after a failed download');
  assert.equal(fake.listenerCount('download-progress'), 0);
});

test('updater path check failure is updater-error and never reaches download', async () => {
  const fake = fakeAutoUpdater({ failCheck: true });
  const result = await installLatestViaUpdater({ expectedCheck }, null, packagedDeps(fake));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'updater-error');
  assert.equal(fake.calls.downloadUpdate, 0);
});

test('updater path enforces the wall-clock timeout via cancellation token', async () => {
  const overrides = { hang: true };
  const fake = fakeAutoUpdater(overrides);
  const timer = { fn: null };
  const result = await installLatestViaUpdater({ timeoutMs: 1234, expectedCheck }, null, {
    isPackaged: true, platform: 'win32',
    autoUpdater: fake, prepareDifferentialBase: async () => ({ ok: true }),
    existsSync: () => true,
    CancellationToken: FakeCancellationToken,
    setTimeout: (fn) => { timer.fn = fn; setImmediate(fn); return 1; },
    clearTimeout: () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
  assert.match(result.message, /下载超时/);
  assert.equal(fake.calls.token.cancelled, true, 'timeout must cancel the download token');
  assert.equal(fake.calls.downloadCancelled, true, 'the explicit download token must stop the pending download');
  assert.equal(fake.listenerCount('download-progress'), 0);
  assert.equal(fake.listenerCount('error'), 0);
  const spentToken = fake.calls.token;
  overrides.hang = false;
  const retry = await installLatestViaUpdater({ expectedCheck }, null,
    packagedDeps(fake, { CancellationToken: FakeCancellationToken }));
  assert.equal(retry.ok, true);
  assert.notEqual(fake.calls.token, spentToken, 'a retry must have its own cancellation token');
  assert.equal(fake.calls.token.cancelled, false);
});

test('differential tracker only trusts the downloader report line', () => {
  const tracker = makeDifferentialTracker();
  tracker.log('Download block maps (old: "a", new: "b")');
  assert.equal(tracker.differential, false);
  tracker.log('Full: 636.65 MB, To download: 44.59 MB (7%)');
  assert.equal(tracker.differential, true);
  assert.equal(tracker.downloadPercent, 7);
  assert.equal(tracker.finish().differential, true);
});

test('cache eligibility uses the updater helper directory and never a guessed product name', async () => {
  const fake = fakeAutoUpdater();
  const resolved = await cachedInstallerPath(fake);
  assert.equal(resolved, path.join('C:/configured-updater-cache', 'installer.exe'));
  fake.getOrCreateDownloadHelper = async () => { throw new Error('bad configuration'); };
  const result = await differentialAvailability(expectedCheck, packagedDeps(fake, { prepareDifferentialBase }));
  assert.equal(result.reason, 'updater-config-unavailable');
  assert.match(result.message, /bad configuration/);
});

async function baseFixture(t, { cached = 'wrong private build', source = 'official installed version' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-delta-base-'));
  const cacheDir = path.join(dir, 'actual-configured-cache');
  const pendingDir = path.join(cacheDir, 'pending');
  const userDataPath = path.join(dir, 'profile');
  const assetName = 'Whale-Isle-Setup-1.0.0.exe';
  fs.mkdirSync(pendingDir, { recursive: true });
  fs.mkdirSync(path.join(userDataPath, 'updates'), { recursive: true });
  const installer = path.join(cacheDir, 'installer.exe');
  const full = path.join(userDataPath, 'updates', assetName);
  if (cached !== null) fs.writeFileSync(installer, cached);
  if (source !== null) fs.writeFileSync(full, source);
  const official = 'official installed version';
  const checksum = crypto.createHash('sha512').update(official).digest('hex');
  let requests = 0;
  const server = http.createServer((_req, res) => { requests++; res.end(`${checksum}  ${assetName}`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const updater = { app: { version: '1.0.0', userDataPath },
    getOrCreateDownloadHelper: async () => ({ cacheDir, cacheDirForPendingUpdate: pendingDir,
      getUpdateInfoFile: () => path.join(pendingDir, 'update-info.json') }) };
  let releaseLookups = 0;
  const deps = { resolveCurrentRelease: async (_route, tag) => {
    releaseLookups++;
    assert.equal(tag, 'v1.0.0');
    return { tag, assetName, assetSize: Buffer.byteLength(official),
      checksumUrl: `http://127.0.0.1:${server.address().port}/sums`, blockmapUrl: 'https://example.test/base.blockmap' };
  } };
  return { updater, deps, installer, full, official, pendingDir, assetName,
    requests: () => requests, releaseLookups: () => releaseLookups };
}

test('a missing or stale NSIS base is recovered from the verified full installer of the running version', async (t) => {
  for (const cached of [null, 'wrong private build']) {
    const fixture = await baseFixture(t, { cached });
    fs.writeFileSync(path.join(fixture.pendingDir, 'update-info.json'), 'broken unused pending metadata');
    fs.writeFileSync(path.join(path.dirname(fixture.installer), 'current.blockmap'), 'unrelated old map');
    assert.deepEqual(await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), { ok: true });
    assert.equal(fs.readFileSync(fixture.installer, 'utf8'), fixture.official);
    assert.equal(fs.existsSync(path.join(path.dirname(fixture.installer), 'current.blockmap')), false);
    assert.equal(fs.readFileSync(fixture.full, 'utf8'), fixture.official, 'retain the reusable full download');
    assert.deepEqual(await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), { ok: true });
    assert.equal(fixture.releaseLookups(), 1, 'unchanged verified bytes reuse the result');
    assert.equal(fixture.requests(), 1);
  }
});

test('a verified reconstructed installer in the pinned pending cache also repairs the running version base', async (t) => {
  const fixture = await baseFixture(t, { cached: null, source: null });
  assert.equal((await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps)).reason, 'missing-cached-installer');
  const pending = path.join(fixture.pendingDir, fixture.assetName);
  fs.writeFileSync(pending, fixture.official);
  fs.writeFileSync(path.join(fixture.pendingDir, 'update-info.json'), JSON.stringify({ fileName: fixture.assetName }));
  assert.deepEqual(await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), { ok: true });
  assert.equal(fs.readFileSync(fixture.installer, 'utf8'), fixture.official);
  assert.equal(fs.readFileSync(pending, 'utf8'), fixture.official);
});

test('a pending future-version installer can never replace the running-version base', async (t) => {
  const fixture = await baseFixture(t, { cached: null, source: null });
  fs.writeFileSync(path.join(fixture.pendingDir, 'Whale-Isle-Setup-1.1.0.exe'), fixture.official);
  fs.writeFileSync(path.join(fixture.pendingDir, 'update-info.json'), JSON.stringify({ fileName: 'Whale-Isle-Setup-1.1.0.exe' }));
  assert.equal((await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps)).reason, 'missing-cached-installer');
  assert.equal(fs.existsSync(fixture.installer), false);
});

test('a same-size unofficial base is rejected by SHA512 and cannot become delta-eligible', async (t) => {
  const fixture = await baseFixture(t, { cached: 'official installed versioN', source: null });
  const result = await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'base-installer-mismatch');
  assert.match(result.message, /不一致/);
  assert.equal(fs.readFileSync(fixture.installer, 'utf8'), 'official installed versioN');
  assert.deepEqual(await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), result);
  assert.equal(fixture.requests(), 1, 'unchanged rejected bytes do not repeat the manifest fetch or scan');
  fs.writeFileSync(fixture.full, fixture.official);
  assert.deepEqual(await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), { ok: true },
    'a newly available full installer invalidates the failed preparation');
});

test('an unverified full installer never overwrites the base and filesystem failures retain their real reason', async (t) => {
  const fixture = await baseFixture(t, { cached: 'old', source: 'official installed versioN' });
  assert.equal((await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps)).reason, 'base-installer-mismatch');
  assert.equal(fs.readFileSync(fixture.installer, 'utf8'), 'old');
  const fake = fakeAutoUpdater();
  fake.getOrCreateDownloadHelper = async () => { throw Object.assign(new Error('cache access denied'), { code: 'EACCES' }); };
  const denied = await differentialAvailability(expectedCheck, packagedDeps(fake, { prepareDifferentialBase }));
  assert.equal(denied.reason, 'EACCES');
  assert.match(denied.message, /cache access denied/);
});

test('base preparation uses the existing checking indicator once and memoized choices do not flicker', async (t) => {
  const fixture = await baseFixture(t, { cached: null });
  const { updateDownloadMethods, setUpdateStateSink } = require('./update');
  const states = [];
  setUpdateStateSink(state => states.push(state));
  t.after(() => setUpdateStateSink(null));
  const deps = { ...fixture.deps, isPackaged: true, platform: 'win32', autoUpdater: fixture.updater };
  assert.equal((await updateDownloadMethods(expectedCheck, deps))[0].disabledReason, undefined);
  assert.deepEqual(states.map(state => state.phase), ['checking', 'available']);
  await updateDownloadMethods(expectedCheck, deps);
  assert.equal(states.length, 2);
});

test('a base replaced during its SHA512 scan is not memoized as verified', async (t) => {
  const fixture = await baseFixture(t, { cached: 'official installed version', source: null });
  const update = require('./update');
  const hash = update.sha512HexOfFile;
  const mocked = t.mock.method(update, 'sha512HexOfFile', async (...args) => {
    const result = await hash(...args);
    fs.writeFileSync(fixture.installer, 'official installed versioN');
    return result;
  });
  await assert.rejects(prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), /缓存已变化/);
  mocked.mock.restore();
  assert.equal((await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps)).reason, 'base-installer-mismatch');
});

test('cancel during preparation never commits a replacement base or starts the updater download', async (t) => {
  const fixture = await baseFixture(t);
  const fake = fakeAutoUpdater();
  fake.app = fixture.updater.app;
  fake.getOrCreateDownloadHelper = fixture.updater.getOrCreateDownloadHelper;
  const controller = new AbortController();
  const copyFile = fs.promises.copyFile;
  t.mock.method(fs.promises, 'copyFile', async (...args) => {
    await copyFile(...args);
    controller.abort();
  });
  const result = await installLatestViaUpdater({ expectedCheck, signal: controller.signal }, null,
    { ...fixture.deps, isPackaged: true, platform: 'win32', autoUpdater: fake });
  assert.equal(result.reason, 'cancelled');
  assert.equal(fs.readFileSync(fixture.installer, 'utf8'), 'wrong private build');
  assert.equal(fs.readdirSync(path.dirname(fixture.installer)).some(name => name.includes('preparing-')), false);
  assert.equal(fake.calls.checkForUpdates, 0);
  assert.equal(fake.calls.downloadUpdate, 0);
});

test('the existing total download budget includes a stalled base-release lookup', async () => {
  const fake = fakeAutoUpdater();
  fake.app = { version: '1.0.0' };
  let aborted = false;
  const result = await installLatestViaUpdater({ expectedCheck, timeoutMs: 1234 }, null, {
    isPackaged: true, platform: 'win32', autoUpdater: fake,
    resolveCurrentRelease: (_route, _tag, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
    }),
    setTimeout: (fn) => { setImmediate(fn); return 1; }, clearTimeout: () => {},
  });
  assert.equal(result.reason, 'timeout');
  assert.equal(aborted, true);
  assert.equal(fake.calls.checkForUpdates, 0);
  assert.equal(fake.calls.downloadUpdate, 0);
});

test('cancel while joining availability prevents even the manifest check', async () => {
  const fake = fakeAutoUpdater();
  const controller = new AbortController();
  const result = await installLatestViaUpdater({ expectedCheck, signal: controller.signal }, null, packagedDeps(fake, {
    prepareDifferentialBase: async () => { controller.abort(); return { ok: true }; },
  }));
  assert.equal(result.reason, 'cancelled');
  assert.equal(fake.calls.checkForUpdates, 0);
  assert.equal(fake.calls.downloadUpdate, 0);
});

test('manifest target changes stop before any installer download, including prerelease identity', async () => {
  for (const [overrides, target, reason] of [
    [{ version: '9.9.10' }, expectedCheck, 'release-changed'],
    [{ assetName: 'Other.exe' }, expectedCheck, 'asset-changed'],
    [{ version: '9.9.9-beta.2' }, { ...expectedCheck, tag: 'v9.9.9-beta.1' }, 'release-changed'],
  ]) {
    const fake = fakeAutoUpdater(overrides);
    const result = await installLatestViaUpdater({ expectedCheck: target }, null, packagedDeps(fake));
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(fake.calls.downloadUpdate, 0);
  }
});

async function realUpdaterFixture(t, { incompatibleBlockmap = false } = {}) {
  const { NsisUpdater } = require('electron-updater');
  assert.equal(require('electron-updater/package.json').version, '6.8.9', 'protected seam is tested against the pinned library');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-strict-delta-'));
  const blockSize = 32 * 1024;
  const same = Buffer.alloc(blockSize, 'a');
  const oldBytes = Buffer.concat([same, Buffer.alloc(blockSize, 'b')]);
  const newBytes = Buffer.concat([same, Buffer.alloc(blockSize, 'c')]);
  const assetName = 'Whale-Isle-Setup-1.1.0.exe';
  const oldAssetName = 'Whale-Isle-Setup-1.0.0.exe';
  const digest = crypto.createHash('sha512').update(newBytes).digest('base64');
  const blockmap = (buffer, version = '2') => ({ version, files: [{ name: 'file', offset: 0,
    sizes: [blockSize, blockSize], checksums: [0, 1].map((index) => crypto.createHash('sha256')
      .update(buffer.subarray(index * blockSize, (index + 1) * blockSize)).digest('hex')),
  }] });
  const requests = [];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    requests.push({ pathname, range: req.headers.range });
    if (pathname === '/latest.yml') {
      res.end(`version: 1.1.0\nfiles:\n  - url: ${assetName}\n    sha512: ${digest}\n    size: ${newBytes.length}\n`);
    } else if (pathname === `/${assetName}.blockmap`) {
      res.end(zlib.gzipSync(JSON.stringify(blockmap(newBytes, incompatibleBlockmap ? '3' : '2'))));
    } else if (pathname === `/${oldAssetName}.blockmap`) {
      res.end(zlib.gzipSync(JSON.stringify(blockmap(oldBytes))));
    } else if (pathname === '/base-sums') {
      res.end(`${crypto.createHash('sha512').update(oldBytes).digest('hex')}  ${oldAssetName}`);
    } else if (pathname === `/${assetName}`) {
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      if (!range) { res.statusCode = 500; res.end('whole download forbidden'); return; }
      const start = Number(range[1]);
      const end = Number(range[2]);
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${newBytes.length}` });
      res.end(newBytes.subarray(start, end + 1));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const configFile = path.join(dir, 'app-update.yml');
  fs.writeFileSync(configFile, `provider: generic\nurl: ${baseUrl}\nuseMultipleRangeRequest: false\nupdaterCacheDirName: configured-cache\n`);
  const cacheDir = path.join(dir, 'configured-cache');
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(path.join(cacheDir, 'installer.exe'), oldBytes);
  fs.writeFileSync(path.join(cacheDir, 'current.blockmap'), zlib.gzipSync(JSON.stringify(blockmap(newBytes))));
  const adapter = { version: '1.0.0', name: 'DifferentDisplayName', isPackaged: true, baseCachePath: dir,
    userDataPath: dir, appUpdateConfigPath: configFile, whenReady: async () => {},
    onQuit: () => { throw new Error('auto install must be disabled'); }, quit: () => { throw new Error('no app quit'); } };
  const updater = new (strictNsisUpdaterClass(NsisUpdater))(null, adapter);
  // This fixture exercises Windows NSIS transfers even when the test host is macOS.
  const providerRuntimeOptions = updater.createProviderRuntimeOptions.bind(updater);
  t.mock.method(updater, 'createProviderRuntimeOptions', () => ({
    ...providerRuntimeOptions(), platform: 'win32',
  }));
  let fullDownloads = 0;
  class LocalHttpExecutor extends HttpExecutor {
    createRequest(options, callback) { return http.request(options, callback); }
    async download() { fullDownloads++; throw new Error('whole-file updater transfer forbidden'); }
  }
  updater.httpExecutor = new LocalHttpExecutor();
  updater.quitAndInstall = () => { throw new Error('no installer launch'); };
  const target = { tag: 'v1.1.0', latest: '1.1.0', assetName, assetUrl: `${baseUrl}${assetName}`,
    checksumUrl: `${baseUrl}SHA512SUMS.txt`, blockmapUrl: `${baseUrl}${assetName}.blockmap`, updaterMetadataUrl: `${baseUrl}latest.yml` };
  const deps = { isPackaged: true, platform: 'win32', autoUpdater: updater,
    resolveCurrentRelease: async () => ({ tag: 'v1.0.0', assetName: oldAssetName, assetSize: oldBytes.length,
      checksumUrl: `${baseUrl}base-sums`, blockmapUrl: `${baseUrl}${oldAssetName}.blockmap` }) };
  return { updater, target, cacheDir, requests, newBytes, oldBytes, deps, fullDownloads: () => fullDownloads };
}

test('pinned NSIS updater reconstructs verified bytes with only an actual HTTP range transfer', async (t) => {
  const fixture = await realUpdaterFixture(t);
  assert.equal(await cachedInstallerPath(fixture.updater), path.join(fixture.cacheDir, 'installer.exe'));
  const result = await installLatestViaUpdater({ expectedCheck: fixture.target }, null,
    fixture.deps);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(fs.readFileSync(result.installer), fixture.newBytes);
  assert.equal(result.differential, true);
  assert.equal(result.downloadPercent, 50);
  assert.equal(fixture.fullDownloads(), 0);
  assert.deepEqual(fs.readFileSync(path.join(fixture.cacheDir, 'installer.exe')), fixture.oldBytes,
    'downloading must not replace the base before successful installation');
  assert.equal(fs.existsSync(path.join(fixture.cacheDir, 'current.blockmap')), false,
    'the new map must not be promoted over the still-installed base');
  assert.ok(fixture.requests.some(entry => entry.pathname.endsWith('1.0.0.exe.blockmap')));
  assert.deepEqual(fixture.requests.filter((entry) => entry.pathname.endsWith('.exe')),
    [{ pathname: `/${fixture.target.assetName}`, range: 'bytes=32768-65535' }]);
  const helper = await fixture.updater.getOrCreateDownloadHelper();
  fs.writeFileSync(path.join(helper.cacheDirForPendingUpdate, 'current.blockmap'), 'historical pending new map');
  fs.writeFileSync(path.join(fixture.cacheDir, 'current.blockmap'), 'historical prematurely promoted new map');
  const reused = await installLatestViaUpdater({ expectedCheck: fixture.target }, null, fixture.deps);
  assert.equal(reused.ok, true, reused.message);
  assert.equal(reused.differential, false, 'verified pending reuse makes no invented range transfer');
  assert.equal(fixture.requests.filter(entry => entry.pathname.endsWith('.exe')).length, 1);
  assert.equal(fs.existsSync(path.join(fixture.cacheDir, 'current.blockmap')), false,
    'a cached pending hit also cannot promote a map over the installed base');
  assert.deepEqual(fs.readFileSync(path.join(fixture.cacheDir, 'installer.exe')), fixture.oldBytes);
});

test('pinned NSIS updater rejects its internal whole-download fallback on incompatible blockmaps', async (t) => {
  const fixture = await realUpdaterFixture(t, { incompatibleBlockmap: true });
  const result = await installLatestViaUpdater({ expectedCheck: fixture.target }, null,
    fixture.deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ERR_UPDATER_DIFFERENTIAL_FAILED');
  assert.match(result.message, /增量更新失败/);
  assert.equal(fixture.fullDownloads(), 0);
  assert.equal(fixture.requests.some((entry) => entry.pathname.endsWith('.exe')), false,
    'a failed differential plan cannot start a full installer request');
});
