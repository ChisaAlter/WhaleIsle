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
  cachedInstallerPath, differentialAvailability, strictNsisUpdaterClass,
} = require('./update-updater');

const expectedCheck = {
  tag: 'v9.9.9', latest: '9.9.9', assetName: 'Setup.exe',
  assetUrl: 'https://example.test/Setup.exe', checksumUrl: 'https://example.test/SHA512SUMS.txt',
  blockmapUrl: 'https://example.test/Setup.exe.blockmap', updaterMetadataUrl: 'https://example.test/latest.yml',
};

function packagedDeps(fake, extra = {}) {
  return { isPackaged: true, platform: 'win32', autoUpdater: fake, existsSync: () => true, ...extra };
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
    autoUpdater: fake,
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
    autoUpdater: fake,
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
    autoUpdater: fake,
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
    autoUpdater: fake,
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
  const tracker = makeDifferentialTracker({ existsSync: () => true });
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
  const queried = [];
  const available = await differentialAvailability(expectedCheck, packagedDeps(fake, {
    existsSync: (file) => { queried.push(file); return file === resolved; },
  }));
  assert.equal(available.ok, true);
  assert.deepEqual(queried, [resolved]);
  fake.getOrCreateDownloadHelper = async () => { throw new Error('bad configuration'); };
  assert.equal((await differentialAvailability(expectedCheck, packagedDeps(fake))).reason, 'updater-config-unavailable');
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
  fs.writeFileSync(path.join(cacheDir, 'current.blockmap'), zlib.gzipSync(JSON.stringify(blockmap(oldBytes))));
  const adapter = { version: '1.0.0', name: 'DifferentDisplayName', isPackaged: true, baseCachePath: dir,
    userDataPath: dir, appUpdateConfigPath: configFile, whenReady: async () => {},
    onQuit: () => { throw new Error('auto install must be disabled'); }, quit: () => { throw new Error('no app quit'); } };
  const updater = new (strictNsisUpdaterClass(NsisUpdater))(null, adapter);
  let fullDownloads = 0;
  class LocalHttpExecutor extends HttpExecutor {
    createRequest(options, callback) { return http.request(options, callback); }
    async download() { fullDownloads++; throw new Error('whole-file updater transfer forbidden'); }
  }
  updater.httpExecutor = new LocalHttpExecutor();
  updater.quitAndInstall = () => { throw new Error('no installer launch'); };
  const target = { tag: 'v1.1.0', latest: '1.1.0', assetName, assetUrl: `${baseUrl}${assetName}`,
    checksumUrl: `${baseUrl}SHA512SUMS.txt`, blockmapUrl: `${baseUrl}${assetName}.blockmap`, updaterMetadataUrl: `${baseUrl}latest.yml` };
  return { updater, target, cacheDir, requests, newBytes, fullDownloads: () => fullDownloads };
}

test('pinned NSIS updater reconstructs verified bytes with only an actual HTTP range transfer', async (t) => {
  const fixture = await realUpdaterFixture(t);
  assert.equal(await cachedInstallerPath(fixture.updater), path.join(fixture.cacheDir, 'installer.exe'));
  const result = await installLatestViaUpdater({ expectedCheck: fixture.target }, null,
    { isPackaged: true, platform: 'win32', autoUpdater: fixture.updater });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(fs.readFileSync(result.installer), fixture.newBytes);
  assert.equal(result.differential, true);
  assert.equal(result.downloadPercent, 50);
  assert.equal(fixture.fullDownloads(), 0);
  assert.deepEqual(fixture.requests.filter((entry) => entry.pathname.endsWith('.exe')),
    [{ pathname: `/${fixture.target.assetName}`, range: 'bytes=32768-65535' }]);
});

test('pinned NSIS updater rejects its internal whole-download fallback on incompatible blockmaps', async (t) => {
  const fixture = await realUpdaterFixture(t, { incompatibleBlockmap: true });
  const result = await installLatestViaUpdater({ expectedCheck: fixture.target }, null,
    { isPackaged: true, platform: 'win32', autoUpdater: fixture.updater });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ERR_UPDATER_DIFFERENTIAL_FAILED');
  assert.match(result.message, /增量更新失败/);
  assert.equal(fixture.fullDownloads(), 0);
  assert.equal(fixture.requests.some((entry) => entry.pathname.endsWith('.exe')), false,
    'a failed differential plan cannot start a full installer request');
});
