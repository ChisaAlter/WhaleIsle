'use strict';

// Real Electron net + pinned NSIS differential downloader; no app window or installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
if (process.env.NODE_PATH) require('node:module').Module._initPaths();
const electron = require('electron');

async function bounded(pending, label, ms = 2000) {
  let timer;
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: deadline ${ms}ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function until(predicate, label) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < end, label);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function launch() {
  // Windows environment keys are case insensitive; preserve only one spelling.
  const env = {}, seen = new Set();
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (['ELECTRON_RUN_AS_NODE', 'TEMP', 'TMP'].includes(upper) || seen.has(upper)) continue;
    seen.add(upper); env[key] = value;
  }
  const executable = process.env.ELECTRON_PATH || electron;
  assert.ok(fs.existsSync(executable), 'provide ELECTRON_PATH for an installed Electron');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-update-net-'));
  env.TEMP = env.TMP = path.join(dir, 'temp'); fs.mkdirSync(env.TEMP);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(executable, [__filename, `--qa-temp=${dir}`], { env, stdio: 'inherit', windowsHide: true });
      let expired = false;
      const timer = setTimeout(() => { expired = true; child.kill(); }, 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve(expired ? 124 : (code ?? 1)); });
    });
  } finally {
    // Chromium holds its userData directory until Electron exits on Windows.
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()), 'cleanup only this mkdtemp');
    assert.ok(path.basename(dir).startsWith('whale-update-net-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
async function runNative() {
  const { app } = electron;
  const dir = process.argv.find(arg => arg.startsWith('--qa-temp='))?.slice('--qa-temp='.length);
  assert.ok(dir && fs.existsSync(dir), 'launch this QA with node so the parent owns temporary cleanup');
  const sockets = new Set(), cases = [], violations = [];
  let server, active, failure;
  const forbid = what => { violations.push(what); throw new Error(`${what} forbidden`); };
  const hash = (bytes, encoding = 'hex') => createHash('sha512').update(bytes).digest(encoding);
  const half = 32 * 1024;
  const oldBytes = Buffer.concat([Buffer.alloc(half, 'a'), Buffer.alloc(half, 'b')]);
  const newBytes = Buffer.concat([Buffer.alloc(half, 'a'), Buffer.alloc(half, 'c')]);
  const oldHash = hash(oldBytes), newHash = hash(newBytes);
  const asset = 'Whale-Isle-Setup-1.1.0.exe', oldAsset = 'Deepseek-Harness-Desktop-Setup-1.0.0.exe';
  const blockmap = bytes => gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0,
    sizes: [half, half], checksums: [0, 1].map(i => createHash('sha256').update(bytes.subarray(i * half, (i + 1) * half)).digest('hex')),
  }] }));
  const maps = { [asset + '.blockmap']: blockmap(newBytes), [oldAsset + '.blockmap']: blockmap(oldBytes) };
  let versions;
  try {
    const userData = path.join(dir, 'electron');
    fs.mkdirSync(userData); app.setPath('userData', userData);
    app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
    await bounded((async () => {
      await app.whenReady();
      const { NsisUpdater } = require('electron-updater');
      const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
      const { downloadLatestViaUpdater, strictNsisUpdaterClass } = require('../src/main/update-updater');
      versions = { electron: process.versions.electron, node: process.versions.node,
        electronUpdater: require('electron-updater/package.json').version };
      assert.equal(versions.electronUpdater, '6.8.9', 'QA targets the pinned updater');
      server = http.createServer((req, res) => {
        try {
          const file = new URL(req.url, 'http://127.0.0.1').pathname.slice(1), f = active;
          const record = { file, range: req.headers.range, socketClosed: false, res, bytes: 0 };
          f.requests.push(record);
          const stalled = () => { f.stalled = record; req.socket.once('close', () => { record.socketClosed = true; }); };
          if (file === 'full-sums') { res.end(`${newHash}  ${asset}`); }
          else if (file === 'full.exe') {
            const offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range || '')?.[1] || 0);
            if (!offset) {
              res.writeHead(200, { 'content-length': newBytes.length, etag: '"full-v1"' });
              res.write(newBytes.subarray(0, half));
              setTimeout(() => res.destroy(), 30);
            } else {
              assert.equal(offset, half); assert.equal(req.headers['if-range'], '"full-v1"');
              res.writeHead(206, { 'content-length': newBytes.length - offset,
                'content-range': `bytes ${offset}-${newBytes.length - 1}/${newBytes.length}`, etag: '"full-v1"' });
              res.end(newBytes.subarray(offset));
            }
          } else if (file === 'latest.yml') {
            if (f.mode === 'metadata' || f.mode === 'headers') { stalled(); return; } // No headers at all.
            res.end(`version: 1.1.0\nfiles:\n  - url: ${asset}\n    sha512: ${hash(newBytes, 'base64')}\n    size: ${newBytes.length}\n`);
          } else if (maps[file]) res.end(maps[file]);
          else if (file === 'base-sums') res.end(`${oldHash}  ${oldAsset}`);
          else if (file === asset) {
            assert.equal(req.method, 'GET');
            const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
            if (!range) forbid('whole installer GET');
            assert.equal(req.headers.range, `bytes=${half}-${newBytes.length - 1}`);
            const status = f.mode === 'error' ? 503 : f.mode === 'ignored-range' ? 200 : 206;
            res.writeHead(status, { 'content-type': 'application/octet-stream',
              'content-range': f.mode === 'wrong-range' ? `bytes 0-${half - 1}/${newBytes.length}`
                : `bytes ${range[1]}-${range[2]}/${newBytes.length}`,
              'content-length': f.mode === 'ignored-range' ? newBytes.length : half });
            if (f.mode === 'ok') res.end(newBytes.subarray(half));
            else if (f.mode === 'slow') {
              let sent = half;
              const timer = setInterval(() => {
                const end = Math.min(sent + half / 4, newBytes.length);
                res.write(newBytes.subarray(sent, end)); sent = end;
                if (sent === newBytes.length) { clearInterval(timer); res.end(); }
              }, 120);
              res.once('close', () => clearInterval(timer));
            }
            else { record.bytes = 10; res.write(newBytes.subarray(half, half + 10)); res.flushHeaders(); stalled(); }
          } else forbid(`unexpected route ${file}`);
        } catch (error) { violations.push(error.message); res.destroy(); }
      });
      server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const base = `http://127.0.0.1:${server.address().port}/`;
      async function fixture(name, mode) {
        const home = path.join(dir, name), cache = path.join(home, 'cache'), config = path.join(home, 'app-update.yml');
        fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(path.join(cache, 'installer.exe'), oldBytes);
        fs.writeFileSync(config, `provider: generic\nurl: ${base}\nuseMultipleRangeRequest: false\nupdaterCacheDirName: cache\n`);
        const adapter = { version: '1.0.0', name: 'NetworkQA', isPackaged: true, baseCachePath: home, userDataPath: home,
          appUpdateConfigPath: config, whenReady: async () => {}, onQuit: () => forbid('adapter.onQuit'), quit: () => forbid('adapter.quit') };
        const updater = new (strictNsisUpdaterClass(NsisUpdater))(null, adapter);
        updater.logger = null;
        updater.quitAndInstall = updater.install = updater.doInstall = () => forbid('installation');
        const options = updater.createProviderRuntimeOptions.bind(updater);
        updater.createProviderRuntimeOptions = () => ({ ...options(), platform: 'win32' });
        const executor = updater.httpExecutor = new ElectronHttpExecutor(), wire = [];
        executor.download = async () => forbid('whole-file executor.download');
        const createRequest = executor.createRequest;
        executor.createRequest = function (opts, callback) {
          const event = { range: opts.headers?.range, response: false, bytes: 0, earlyClose: false }; wire.push(event);
          const request = createRequest.call(this, opts, response => {
            event.response = true; event.status = response.statusCode;
            response.on('data', chunk => { event.bytes += chunk.length; });
            callback(response);
          });
          request.once('close', () => { event.earlyClose = !event.response; });
          return request;
        };
        const target = { tag: 'v1.1.0', assetName: asset, assetUrl: base + asset, checksumUrl: base + 'SHA512SUMS.txt',
          blockmapUrl: base + asset + '.blockmap', updaterMetadataUrl: base + 'latest.yml' };
        const deps = { isPackaged: true, platform: 'win32', autoUpdater: updater,
          resolveCurrentRelease: async () => ({ tag: 'v1.0.0', assetName: oldAsset, assetSize: oldBytes.length,
            checksumUrl: base + 'base-sums', blockmapUrl: base + oldAsset + '.blockmap' }) };
        const helper = await updater.getOrCreateDownloadHelper();
        assert.equal(helper.cacheDir, cache);
        active = { name, mode, requests: [], wire, updater, helper, cache,
          run: (signal, timeoutMs = 8000, watchdog = false) => downloadLatestViaUpdater({ expectedCheck: target, signal, timeoutMs }, null,
            watchdog ? { ...deps, requestSetTimeout: (fn, ms) => setTimeout(fn, ms === 45000 || ms === 20000 ? 250 : ms),
              requestClearTimeout: clearTimeout } : deps) };
        return active;
      }
      const ranges = f => f.requests.filter(r => r.file === asset);
      function invariant(f) {
        assert.deepEqual(violations, []);
        assert.equal(electron.BrowserWindow.getAllWindows().length, 0, 'no GUI windows');
        assert.equal(f.updater.downloadPromise, null, `${f.name}: download cleanup`);
        assert.equal(hash(fs.readFileSync(path.join(f.cache, 'installer.exe'))), oldHash, 'installed base unchanged');
        for (const home of [f.cache, f.helper.cacheDirForPendingUpdate]) {
          assert.equal(fs.existsSync(path.join(home, 'current.blockmap')), false, 'no premature map promotion');
        }
      }
      async function retry(f) {
        const before = ranges(f).length; f.mode = 'ok';
        const result = await bounded(f.run(), `${f.name}: same-instance retry`);
        assert.equal(result.ok, true, result.message); assert.equal(result.differential, true);
        assert.equal(result.version, '1.1.0'); assert.equal(result.downloadPercent, 50);
        assert.ok(path.resolve(result.installer).startsWith(f.cache + path.sep), 'installer stays in QA cache');
        assert.equal(hash(fs.readFileSync(result.installer)), newHash, 'reconstructed SHA512');
        assert.equal(ranges(f).length, before + 1, 'retry really transferred one Range');
        assert.ok(f.requests.some(r => r.file === oldAsset + '.blockmap'), 'old release map fetched');
        invariant(f);
      }
      for (const [name, mode] of [['range-cancel-retry', 'range'], ['metadata-cancel-retry', 'metadata'],
        ['range-503-unfinished-body', 'error'], ['budget-timeout-retry', 'timeout']]) {
        const f = await fixture(name, mode), controller = new AbortController();
        const pending = f.run(controller.signal, mode === 'timeout' ? 1000 : 8000);
        await until(() => f.stalled && (mode === 'metadata' || f.wire.some(w => w.range && w.response
          && (mode === 'error' ? w.status === 503 : w.bytes === 10))), `${name}: stall must occur`);
        assert.equal(f.stalled.res.writableEnded, false, 'server has not ended the stalled response');
        if (mode === 'metadata') { assert.equal(f.stalled.res.headersSent, false); assert.equal(ranges(f).length, 0); }
        else { assert.equal(f.stalled.bytes, 10); assert.equal(f.stalled.res.headersSent, true); }
        const earlyClose = f.wire.some(w => w.range && w.earlyClose);
        if (mode === 'range') assert.ok(earlyClose, 'real Electron close precedes response');
        if (mode === 'range' || mode === 'metadata') {
          assert.equal(f.stalled.socketClosed, false, 'connection is still stalled before user cancellation');
          assert.equal(f.updater[mode === 'range' ? 'downloadPromise' : 'checkForUpdatesPromise'] != null, true);
        }
        const start = Date.now();
        if (mode === 'range' || mode === 'metadata') controller.abort();
        const result = await bounded(pending, `${name}: operation must settle`);
        const reason = mode === 'error' ? 'HTTP_ERROR_503' : mode === 'timeout' ? 'timeout' : 'cancelled';
        assert.equal(result.ok, false); assert.equal(result.reason, reason, result.message);
        await until(() => f.stalled.socketClosed, `${name}: actual server socket must close`);
        assert.equal(f.updater.checkForUpdatesPromise, null, 'metadata cleanup'); invariant(f);
        const settledMs = Date.now() - start;
        if (mode !== 'error') await retry(f);
        cases.push({ name, result: 'passed', reason, settledMs, ranges: ranges(f).length, socketClosed: f.stalled.socketClosed,
          ...(mode === 'range' ? { closeBeforeResponse: earlyClose } : {}) });
      }
      for (const mode of ['ignored-range', 'wrong-range', 'idle', 'headers']) {
        const f = await fixture(mode, mode);
        const timedOut = mode === 'idle' || mode === 'headers';
        const pending = f.run(undefined, 8000, timedOut);
        const result = await bounded(pending, mode);
        assert.equal(result.ok, false);
        assert.equal(result.reason, timedOut ? 'ETIMEDOUT' : 'ERR_UPDATER_INVALID_RANGE', result.message);
        await until(() => f.stalled?.socketClosed, `${mode}: rejected socket closes`);
        assert.equal(ranges(f).length, mode === 'headers' ? 0 : 1, 'no automatic full transfer or retry');
        invariant(f);
        await retry(f);
        cases.push({ name: mode, result: 'passed', reason: result.reason, socketClosed: true });
      }
      const slow = await fixture('continuously-progressing', 'slow');
      const slowStart = Date.now();
      const slowResult = await bounded(slow.run(undefined, 8000, true), 'continuous progress');
      assert.equal(slowResult.ok, true, slowResult.message);
      assert.ok(Date.now() - slowStart > 250, 'transfer outlives a single idle window');
      assert.equal(hash(fs.readFileSync(slowResult.installer)), newHash);
      invariant(slow);
      cases.push({ name: 'continuously-progressing', result: 'passed', idleWindowMs: 250 });
      // The complete-file release path uses Node HTTPS in production. Map only
      // the localhost fixture's URL protocol to exercise real HTTP resets and
      // file writes with the unchanged production downloader.
      const https = require('node:https'), originalGet = https.get;
      const update = require('../src/main/update');
      active = { requests: [], mode: 'full' };
      const fullDest = path.join(dir, 'full', asset);
      const fullProgress = [];
      https.get = (url, options, callback) => {
        assert.ok(url.startsWith(base));
        return http.get(url, options, callback);
      };
      try {
        await update.downloadReleaseAsset({ assetName: asset, assetUrl: base + 'full.exe', checksumUrl: base + 'full-sums' },
          fullDest, p => fullProgress.push(p));
      } finally { https.get = originalGet; }
      assert.equal(hash(fs.readFileSync(fullDest)), newHash);
      const fullRequests = active.requests.filter(r => r.file === 'full.exe');
      assert.equal(fullRequests.length, 2);
      assert.deepEqual(fullRequests.map(r => r.range), [undefined, `bytes=${half}-`]);
      assert.ok(fullProgress.some(p => p.resumed && p.received === newBytes.length));
      cases.push({ name: 'full-reset-resume-sha512', result: 'passed', transferred: half + half, assetSize: newBytes.length });
    })(), 'whole runtime QA', 20000);
  } catch (error) { failure = error; }
  finally {
    try {
      for (const socket of sockets) socket.destroy();
      if (server?.listening) await bounded(new Promise(resolve => server.close(resolve)), 'server cleanup');
    } catch (error) { failure ||= error; }
    const result = { versions, cases, noInstallation: violations.length === 0 };
    if (failure) { result.failure = failure.message; result.violations = violations; console.error(JSON.stringify(result)); }
    else console.log(JSON.stringify(result));
    app.exit(failure ? 1 : 0);
  }
}
(typeof electron === 'string' ? launch() : runNative()).catch(error => {
  console.error(JSON.stringify({ failure: error.message }));
  if (typeof electron === 'string') process.exitCode = 1; else electron.app.exit(1);
});
