'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
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
  updater.setFeedURL = (feed) => { updater.feed = feed; };
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

test('updater feed follows the confirmed route', async () => {
  const github = fakeAutoUpdater();
  github.feed = 'previous';
  github.clientPromise = Promise.resolve('cnb client');
  await installLatestViaUpdater({ expectedCheck }, null, packagedDeps(github));
  assert.deepEqual(github.feed, { provider: 'generic', url: 'https://example.test/', useMultipleRangeRequest: false },
    'GitHub pins the confirmed asset directory instead of an obsolete packaged repository name');

  const cnb = fakeAutoUpdater();
  await installLatestViaUpdater({ expectedCheck: { ...expectedCheck, route: 'cnb',
    updaterMetadataUrl: 'https://cnb.cool/ayasealter/WhaleIsle/-/releases/download/v9.9.9/latest.yml' } }, null, packagedDeps(cnb));
  // CNB answers one range per request; a multi-range request gets only the first.
  assert.deepEqual(cnb.feed, {
    provider: 'generic',
    url: 'https://cnb.cool/ayasealter/WhaleIsle/-/releases/download/v9.9.9/',
    useMultipleRangeRequest: false,
  });
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

test('differential progress forwards finite transfer sizes and speed without inventing invalid metrics', async () => {
  const fake = fakeAutoUpdater();
  fake.downloadUpdate = async () => {
    fake.emit('download-progress', { percent: 33.2, transferred: 123, total: 456, bytesPerSecond: 78 });
    fake.emit('download-progress', { percent: 100, transferred: -1, total: NaN, bytesPerSecond: Infinity });
    return ['C:/installer.exe'];
  };
  const { events, onProgress } = collectProgress();
  assert.equal((await installLatestViaUpdater({ expectedCheck }, onProgress, packagedDeps(fake))).ok, true);
  assert.deepEqual(events, [
    { phase: 'download', percent: 33, differential: true, received: 123, total: 456, bytesPerSecond: 78 },
    { phase: 'download', percent: 99, differential: true },
  ]);
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

test('updater default wall-clock budget allows two hours of continuously progressing transfers', async () => {
  let budget;
  const fake = fakeAutoUpdater();
  const result = await installLatestViaUpdater({ expectedCheck }, null, packagedDeps(fake, {
    setTimeout: (_fn, ms) => { budget = ms; return 1; }, clearTimeout() {},
  }));
  assert.equal(result.ok, true);
  assert.equal(budget, 2 * 60 * 60_000);
});

function requestClock() {
  const pending = new Map();
  const delays = [];
  let next = 0;
  return { pending, delays,
    requestSetTimeout(fn, ms) { const id = ++next; delays.push(ms); pending.set(id, { fn, ms }); return id; },
    requestClearTimeout(id) { pending.delete(id); },
    expire(ms) {
      const item = [...pending].find(([, timer]) => timer.ms === ms);
      assert.ok(item, `expected an armed ${ms}ms timer`);
      pending.delete(item[0]); item[1].fn();
    },
  };
}

test('Electron-shaped requests enforce header and resettable body-idle budgets without socket events', async () => {
  for (const bodyStarted of [false, true]) {
    const fake = fakeAutoUpdater();
    const clock = requestClock();
    let start;
    const started = new Promise(resolve => { start = resolve; });
    let request, response, respond, observed = '';
    fake.httpExecutor = new HttpExecutor();
    fake.httpExecutor.createRequest = (_options, callback) => {
      respond = callback;
      request = new EventEmitter();
      request.end = () => { request.emit('close'); start(); };
      request.abort = () => { request.aborted = true; request.emit('abort'); };
      return request;
    };
    fake.downloadUpdate = () => new Promise((_resolve, reject) => {
      const req = fake.httpExecutor.createRequest({}, res => { res.on('data', data => { observed += data; }); });
      fake.httpExecutor.addErrorAndTimeoutHandlers(req, reject);
      req.end();
    });
    const pending = installLatestViaUpdater({ expectedCheck }, null, packagedDeps(fake, clock));
    await started;
    assert.deepEqual([...clock.pending.values()].map(v => v.ms), [20_000]);
    if (bodyStarted) {
      response = new PassThrough();
      response.statusCode = 200;
      respond(response);
      assert.deepEqual([...clock.pending.values()].map(v => v.ms), [45_000]);
      const before = [...clock.pending.keys()][0];
      response.write('slow data');
      assert.equal(observed, 'slow data', 'the watchdog must not consume the downloader bytes');
      assert.notEqual([...clock.pending.keys()][0], before, 'each nonempty data chunk resets the idle budget');
    }
    clock.expire(bodyStarted ? 45_000 : 20_000);
    const result = await pending;
    assert.equal(result.reason, 'ETIMEDOUT');
    assert.equal(request.aborted, true);
    if (response) assert.equal(response.destroyed, true);
    assert.equal(clock.pending.size, 0);
  }
});

test('request budgets clean up after response end, request error and cancellation', async () => {
  for (const terminal of ['end', 'error', 'cancel']) {
    const fake = fakeAutoUpdater(), clock = requestClock(), controller = new AbortController();
    let request, response, ready;
    const started = new Promise(resolve => { ready = resolve; });
    fake.httpExecutor = new HttpExecutor();
    fake.httpExecutor.createRequest = (_options, callback) => {
      request = new EventEmitter();
      request.abort = () => request.emit('abort');
      request.end = () => {
        response = new PassThrough(); response.statusCode = 200;
        callback(response); ready();
      };
      return request;
    };
    fake.downloadUpdate = () => new Promise((resolve, reject) => {
      const req = fake.httpExecutor.createRequest({}, res => {
        res.on('data', () => {}); res.once('end', () => resolve(['C:/installer.exe']));
      });
      fake.httpExecutor.addErrorAndTimeoutHandlers(req, reject); req.end();
    });
    const pending = installLatestViaUpdater({ expectedCheck, signal: controller.signal }, null, packagedDeps(fake, clock));
    await started;
    if (terminal === 'end') response.end();
    else if (terminal === 'error') request.emit('error', new Error('offline'));
    else controller.abort();
    const result = await pending;
    assert.equal(result.ok, terminal === 'end');
    assert.equal(clock.pending.size, 0, terminal);
  }
});

test('a request attempted after cancellation rejects asynchronously without a network request', async () => {
  const fake = fakeAutoUpdater(), controller = new AbortController();
  fake.httpExecutor = new HttpExecutor();
  let created = 0;
  fake.httpExecutor.createRequest = () => { created++; throw new Error('network must stay closed'); };
  fake.downloadUpdate = () => new Promise((_resolve, reject) => {
    controller.abort();
    queueMicrotask(() => {
      const request = fake.httpExecutor.createRequest({}, () => {});
      fake.httpExecutor.addErrorAndTimeoutHandlers(request, reject);
      request.end();
    });
  });
  assert.equal((await installLatestViaUpdater({ expectedCheck, signal: controller.signal }, null, packagedDeps(fake))).reason, 'cancelled');
  assert.equal(created, 0);
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
    assert.deepEqual(await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), { ok: true, blockmapUrl: 'https://example.test/base.blockmap' });
    assert.equal(fs.readFileSync(fixture.installer, 'utf8'), fixture.official);
    assert.equal(fs.existsSync(path.join(path.dirname(fixture.installer), 'current.blockmap')), false);
    assert.equal(fs.readFileSync(fixture.full, 'utf8'), fixture.official, 'retain the reusable full download');
    assert.deepEqual(await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), { ok: true, blockmapUrl: 'https://example.test/base.blockmap' });
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
  assert.deepEqual(await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), { ok: true, blockmapUrl: 'https://example.test/base.blockmap' });
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
  assert.deepEqual(await prepareDifferentialBase(fixture.updater, expectedCheck, fixture.deps), { ok: true, blockmapUrl: 'https://example.test/base.blockmap' },
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

async function realUpdaterFixture(t, { incompatibleBlockmap = false, stallRange = false, rangeStatus = 206,
  wrongContentRange = false, wrongContentLength = false, oversizedRange = false,
  oldAssetName = 'Whale-Isle-Setup-1.0.0.exe', fragmentedRanges = false } = {}) {
  const { NsisUpdater } = require('electron-updater');
  assert.equal(require('electron-updater/package.json').version, '6.8.10', 'protected seam is tested against the pinned library');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-strict-delta-'));
  const blockSize = fragmentedRanges ? 64 : 32 * 1024;
  const same = Buffer.alloc(blockSize, 'a');
  const blocks = fragmentedRanges ? 204 : 2;
  const oldBytes = Buffer.concat(Array.from({ length: blocks }, (_, i) => i % 2 ? Buffer.alloc(blockSize, 'b') : same));
  const newBytes = Buffer.concat(Array.from({ length: blocks }, (_, i) => i % 2 ? Buffer.alloc(blockSize, 'c') : same));
  const assetName = 'Whale-Isle-Setup-1.1.0.exe';
  const digest = crypto.createHash('sha512').update(newBytes).digest('base64');
  const blockmap = (buffer, version = '2') => ({ version, files: [{ name: 'file', offset: 0,
    sizes: Array(blocks).fill(blockSize), checksums: Array.from({ length: blocks }, (_, index) => crypto.createHash('sha256')
      .update(buffer.subarray(index * blockSize, (index + 1) * blockSize)).digest('hex')),
  }] });
  const requests = [];
  let markRange;
  const rangeStarted = new Promise(resolve => { markRange = resolve; });
  let rangeClosed;
  const closedRange = new Promise(resolve => { rangeClosed = resolve; });
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    requests.push({ pathname, range: req.headers.range });
    if (pathname === '/latest.yml') {
      res.end(`version: 1.1.0\nfiles:\n  - url: ${assetName}\n    sha512: ${digest}\n    size: ${newBytes.length}\n`);
    } else if (pathname === `/${assetName}.blockmap`) {
      res.end(zlib.gzipSync(JSON.stringify(blockmap(newBytes, incompatibleBlockmap ? '3' : '2'))));
    } else if (pathname === `/${oldAssetName}.blockmap`) {
      res.end(zlib.gzipSync(JSON.stringify(blockmap(oldBytes))));
    } else if (pathname === '/SHA512SUMS.txt') {
      res.end(`${crypto.createHash('sha512').update(newBytes).digest('hex')}  ${assetName}`);
    } else if (pathname === '/base-sums') {
      res.end(`${crypto.createHash('sha512').update(oldBytes).digest('hex')}  ${oldAssetName}`);
    } else if (pathname === `/${assetName}`) {
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      if (!range) { res.statusCode = 500; res.end('whole download forbidden'); return; }
      const start = Number(range[1]);
      const end = Number(range[2]);
      res.writeHead(rangeStatus, { 'content-range': `bytes ${wrongContentRange ? start + 1 : start}-${end}/${newBytes.length}`,
        'content-type': 'application/octet-stream', ...(wrongContentLength ? { 'content-length': end - start + 2 } : {}) });
      if (oversizedRange) {
        req.once('close', rangeClosed);
        res.end(Buffer.concat([newBytes.subarray(start, end + 1), Buffer.from('extra')]));
      } else if (stallRange) {
        req.once('close', rangeClosed);
        res.write(newBytes.subarray(start, start + 10));
        markRange();
      } else res.end(newBytes.subarray(start, end + 1));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
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
    // Electron emits no socket event, so only the host watchdog can time out.
    addTimeOutHandler() {}
    async download() { fullDownloads++; throw new Error('whole-file updater transfer forbidden'); }
  }
  updater.httpExecutor = new LocalHttpExecutor();
  updater.quitAndInstall = () => { throw new Error('no installer launch'); };
  const target = { tag: 'v1.1.0', latest: '1.1.0', assetName, assetUrl: `${baseUrl}${assetName}`,
    checksumUrl: `${baseUrl}SHA512SUMS.txt`, blockmapUrl: `${baseUrl}${assetName}.blockmap`, updaterMetadataUrl: `${baseUrl}latest.yml` };
  const deps = { isPackaged: true, platform: 'win32', autoUpdater: updater,
    resolveCurrentRelease: async () => ({ tag: 'v1.0.0', assetName: oldAssetName, assetSize: oldBytes.length,
      checksumUrl: `${baseUrl}base-sums`, blockmapUrl: `${baseUrl}${oldAssetName}.blockmap` }) };
  return { updater, target, cacheDir, requests, newBytes, oldBytes, deps, rangeStarted, closedRange,
    resumeRange: () => { stallRange = false; }, fullDownloads: () => fullDownloads };
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

test('pinned NSIS updater uses the verified old release blockmap across installer renames', async (t) => {
  const f = await realUpdaterFixture(t, { oldAssetName: 'Deepseek-Harness-Desktop-Setup-1.0.0.exe' });
  const result = await installLatestViaUpdater({ expectedCheck: f.target }, null, f.deps);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(fs.readFileSync(result.installer), f.newBytes);
  assert.ok(f.requests.some(req => req.pathname === '/Deepseek-Harness-Desktop-Setup-1.0.0.exe.blockmap'));
  assert.equal(f.requests.some(req => req.pathname === '/Whale-Isle-Setup-1.0.0.exe.blockmap'), false);
  assert.equal(f.fullDownloads(), 0);
});

test('pinned NSIS updater rejects ignored and mismatched ranges before piping a body', async (t) => {
  for (const options of [{ rangeStatus: 200 }, { wrongContentRange: true }, { wrongContentLength: true }, { oversizedRange: true }]) {
    const f = await realUpdaterFixture(t, { ...options, stallRange: true });
    const result = await installLatestViaUpdater({ expectedCheck: f.target }, null, f.deps);
    assert.equal(result.reason, 'ERR_UPDATER_INVALID_RANGE');
    await f.closedRange;
    assert.equal(f.updater.downloadPromise, null);
    assert.equal(f.fullDownloads(), 0);
    assert.deepEqual(fs.readFileSync(path.join(f.cacheDir, 'installer.exe')), f.oldBytes);
  }
});

test('pinned NSIS updater preserves idle timeout errors and cleans up the pending transfer', { timeout: 5000 }, async (t) => {
  const f = await realUpdaterFixture(t, { stallRange: true }), clock = requestClock();
  let received;
  const rangeReceived = new Promise(resolve => { received = resolve; });
  const executor = f.updater.httpExecutor, createRequest = executor.createRequest;
  executor.createRequest = function (options, callback) {
    return createRequest.call(this, options, response => {
      callback(response);
      if (options.headers?.range) response.once('data', received);
    });
  };
  const pending = installLatestViaUpdater({ expectedCheck: f.target }, null, { ...f.deps, ...clock });
  await rangeReceived;
  clock.expire(45_000);
  const result = await pending;
  assert.equal(result.reason, 'ETIMEDOUT');
  await f.closedRange;
  assert.equal(f.updater.downloadPromise, null);
  assert.equal(clock.pending.size, 0);
  assert.equal(f.fullDownloads(), 0);
});

test('pinned NSIS updater settles cancellation during its 100-range delay without late network requests', { timeout: 5000 }, async (t) => {
  const f = await realUpdaterFixture(t, { fragmentedRanges: true }), controller = new AbortController();
  let markGap;
  const gap = new Promise(resolve => { markGap = resolve; });
  const executor = f.updater.httpExecutor, createRequest = executor.createRequest;
  let completed = 0;
  executor.createRequest = function (options, callback) {
    return createRequest.call(this, options, response => {
      callback(response);
      if (options.headers?.range) response.once('end', () => {
        if (++completed === 100) { controller.abort(); markGap(); }
      });
    });
  };
  const pending = installLatestViaUpdater({ expectedCheck: f.target, signal: controller.signal }, null, f.deps);
  await gap;
  assert.equal((await pending).reason, 'cancelled');
  assert.equal(f.requests.filter(req => req.range).length, 100);
  assert.equal(f.updater.downloadPromise, null);
  assert.equal(f.fullDownloads(), 0);
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

test('cancelling a stalled real Range closes it before a same-instance explicit retry', { timeout: 5000 }, async (t) => {
  const f = await realUpdaterFixture(t, { stallRange: true });
  const controller = new AbortController();
  const first = installLatestViaUpdater({ expectedCheck: f.target, signal: controller.signal }, null, f.deps);
  await f.rangeStarted;
  controller.abort();
  const cancelled = await first;
  assert.equal(cancelled.reason, 'cancelled');
  await f.closedRange;
  assert.equal(f.updater.downloadPromise, null, 'old download cleanup must finish before returning');
  assert.deepEqual(fs.readFileSync(path.join(f.cacheDir, 'installer.exe')), f.oldBytes);
  f.resumeRange();
  const retried = await installLatestViaUpdater({ expectedCheck: f.target }, null, f.deps);
  assert.equal(retried.ok, true, retried.message);
  assert.deepEqual(fs.readFileSync(retried.installer), f.newBytes);
  assert.equal(f.requests.filter(req => req.pathname.endsWith('.exe')).length, 2);
  assert.equal(f.fullDownloads(), 0);
});

test('host rejects damaged same-process pending bytes and the next delta really downloads again', async (t) => {
  const f = await realUpdaterFixture(t);
  const { installFromAsset } = require('./update');
  let verifiedFile;
  let installGates = 0;
  // Delta and the NSIS install gate are Windows paths; pin the platform so the
  // macOS runner does not take the DMG branch.
  const options = { downloadMode: 'delta', updaterDeps: f.deps, quitAfterInstall: false, platform: 'win32',
    beforeInstall: ({ dest }) => { verifiedFile = dest; installGates++; return { ok: false, cancelled: true }; },
    spawn: () => { throw new Error('no installer launch'); } };
  await installFromAsset(f.target, null, options);
  assert.equal(installGates, 1);
  const damaged = Buffer.from(f.newBytes); damaged[0] ^= 1;
  fs.writeFileSync(verifiedFile, damaged);
  await assert.rejects(installFromAsset(f.target, null, options), { code: 'ERR_UPDATER_CHECKSUM_MISMATCH' });
  assert.equal(installGates, 1);
  assert.equal(fs.existsSync(verifiedFile), false);
  await installFromAsset(f.target, null, options);
  assert.equal(installGates, 2);
  assert.deepEqual(fs.readFileSync(verifiedFile), f.newBytes);
  assert.equal(f.requests.filter(req => req.pathname.endsWith('.exe')).length, 2);
  assert.equal(f.requests.filter(req => req.pathname === '/SHA512SUMS.txt').length, 3);
  assert.deepEqual(fs.readFileSync(path.join(f.cacheDir, 'installer.exe')), f.oldBytes);
});

test('Electron request close before its response is not a completed transfer', { timeout: 5000 }, async (t) => {
  const f = await realUpdaterFixture(t, { stallRange: true });
  const executor = f.updater.httpExecutor;
  const createRequest = executor.createRequest;
  // Electron net closes the writable request before receiving a response;
  // node:http normally emits close after the response, so model that order.
  executor.createRequest = function (...args) {
    const request = createRequest.apply(this, args);
    request.once('finish', () => request.emit('close'));
    return request;
  };
  const controller = new AbortController();
  const pending = installLatestViaUpdater({ expectedCheck: f.target, signal: controller.signal }, null, f.deps);
  await f.rangeStarted;
  controller.abort();
  assert.equal((await pending).reason, 'cancelled');
  await f.closedRange;
  assert.equal(f.updater.downloadPromise, null);
});

test('failed Range responses close even when the server never ends the error body', { timeout: 5000 }, async (t) => {
  const f = await realUpdaterFixture(t, { stallRange: true, rangeStatus: 503 });
  const result = await installLatestViaUpdater({ expectedCheck: f.target }, null, f.deps);
  assert.equal(result.reason, 'HTTP_ERROR_503');
  await f.closedRange;
  assert.equal(f.updater.downloadPromise, null);
  assert.equal(f.fullDownloads(), 0);
});

test('a real stopped Range budget reports timeout, cleans up, and permits retry', { timeout: 5000 }, async (t) => {
  const f = await realUpdaterFixture(t, { stallRange: true });
  let expire;
  const pending = installLatestViaUpdater({ expectedCheck: f.target }, null, { ...f.deps,
    setTimeout: fn => { expire = fn; return 1; }, clearTimeout() {} });
  await f.rangeStarted;
  expire();
  assert.equal((await pending).reason, 'timeout');
  await f.closedRange;
  assert.equal(f.updater.downloadPromise, null);
  f.resumeRange();
  assert.equal((await installLatestViaUpdater({ expectedCheck: f.target }, null, f.deps)).ok, true);
});

test('cancel ends a stalled manifest immediately and a mismatched provider cannot cross routes', async (t) => {
  const fake = fakeAutoUpdater();
  let releaseCheck;
  let checked;
  const started = new Promise(resolve => { checked = resolve; });
  fake.checkForUpdates = () => { checked(); return new Promise(resolve => { releaseCheck = resolve; }); };
  const controller = new AbortController();
  const first = installLatestViaUpdater({ expectedCheck, signal: controller.signal }, null, packagedDeps(fake));
  await started;
  controller.abort();
  assert.equal((await first).reason, 'cancelled');
  releaseCheck({ updateInfo: { version: '9.9.9' } });
  const other = fakeAutoUpdater();
  const result = await installLatestViaUpdater({ expectedCheck: { ...expectedCheck,
    route: 'cnb', assetUrl: 'https://cnb.cool/Setup.exe' } }, null, packagedDeps(other));
  assert.equal(result.reason, 'asset-changed', 'same version/name on another host is not the confirmed asset');
  assert.equal(other.calls.downloadUpdate, 0);
});
