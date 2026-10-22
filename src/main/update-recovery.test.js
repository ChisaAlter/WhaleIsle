'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const crypto = require('node:crypto');
const { readAssetChecksum, downloadReleaseAsset, installFromAsset } = require('./update');

const digest = (bytes) => crypto.createHash('sha512').update(bytes).digest('hex');

async function checksumServer(t, respond) {
  const server = http.createServer(respond);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/SHA512SUMS.txt`;
}

test('checksum retries transient HTTP and a broken response body on the same URL', async (t) => {
  const urls = [];
  const url = await checksumServer(t, (req, res) => {
    urls.push(req.url);
    if (urls.length === 1) { res.writeHead(503); res.end(); }
    else if (urls.length === 2) {
      res.writeHead(200, { 'content-length': '1024' });
      res.write('broken');
      setImmediate(() => res.destroy());
    } else res.end(`${digest('valid')}  Setup.exe`);
  });
  const retries = [];
  assert.equal(await readAssetChecksum('Setup.exe', url, { retryDelayMs: 1, onRetry: p => retries.push(p) }), digest('valid'));
  assert.equal(urls.length, 3);
  assert.equal(new Set(urls).size, 1);
  assert.deepEqual(retries.map(p => p.attempt), [2, 3]);
});

test('checksum deadline covers a stalled body and reports a stable timeout code', async (t) => {
  const url = 'https://example.test/SHA512SUMS.txt';
  const controllers = [];
  const timeouts = [];
  const retries = [];
  let bodyReads = 0;
  // Drive each deadline after headers arrive, without spending the retry budget
  // on real networking or CI scheduling. Real HTTP retries are covered above.
  t.mock.method(Date, 'now', () => 0);
  t.mock.method(AbortSignal, 'timeout', ms => {
    timeouts.push(ms);
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  t.mock.method(global, 'fetch', async (requestedUrl, { signal }) => {
    assert.equal(requestedUrl, url);
    const controller = controllers.at(-1);
    assert.equal(signal, controller.signal);
    return { ok: true, text: () => new Promise((_resolve, reject) => {
      bodyReads++;
      assert.equal(signal.aborted, false, 'the body starts before the deadline');
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      queueMicrotask(() => controller.abort(new DOMException('The operation was aborted', 'AbortError')));
    }) };
  });
  await assert.rejects(readAssetChecksum('Setup.exe', url, {
    maxAttempts: 2, attemptTimeoutMs: 30, retryDelayMs: 0, onRetry: p => retries.push(p),
  }), { code: 'ETIMEDOUT' });
  assert.deepEqual(timeouts, [30, 30]);
  assert.equal(bodyReads, 2, 'both attempts reach and abort the stalled body');
  assert.notEqual(controllers[0].signal, controllers[1].signal);
  assert.ok(controllers.every(controller => controller.signal.aborted));
  assert.deepEqual(retries.map(p => p.attempt), [2]);
});

test('permanent checksum errors are not retried and never start the large transfer', async (t) => {
  let requests = 0;
  let missing = false;
  const url = await checksumServer(t, (_req, res) => {
    requests++;
    if (!missing) res.writeHead(404);
    res.end(`${digest('valid')}  Other.exe`);
  });
  let downloads = 0;
  t.mock.method(https, 'get', () => { downloads++; throw new Error('unexpected installer request'); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-preflight-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const info = { latest: '1.0.0', assetName: 'Setup.exe', assetUrl: 'https://example.test/Setup.exe', checksumUrl: url };
  await assert.rejects(installFromAsset(info, null, { userDataDir: dir }), { code: 'HTTP_ERROR_404' });
  assert.equal(requests, 1);
  missing = true;
  await assert.rejects(installFromAsset(info, null, { userDataDir: dir }), { code: 'ERR_UPDATER_CHECKSUM_ENTRY_MISSING' });
  assert.equal(requests, 2);
  assert.equal(downloads, 0);
});

test('checksum cancellation during backoff stops without a further request', async (t) => {
  const controller = new AbortController();
  let requests = 0;
  const url = await checksumServer(t, (_req, res) => { requests++; res.writeHead(503); res.end(); });
  await assert.rejects(readAssetChecksum('Setup.exe', url, {
    signal: controller.signal, onRetry: () => controller.abort(), retryDelayMs: 1,
  }), { name: 'AbortError', code: 'ERR_UPDATER_CANCELLED' });
  assert.equal(requests, 1);
});

function assetFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-asset-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('complete verified installer');
  let downloads = 0;
  let manifests = 0;
  const info = { tag: 'v1.0.0', latest: '1.0.0', route: 'cnb', assetName: 'Setup.exe',
    assetUrl: 'https://cnb.cool/releases/v1.0.0/Setup.exe', checksumUrl: 'https://cnb.cool/releases/v1.0.0/SHA512SUMS.txt' };
  t.mock.method(global, 'fetch', async url => {
    assert.equal(url, info.checksumUrl);
    manifests++;
    return { ok: true, text: async () => `${digest(bytes)}  Setup.exe` };
  });
  t.mock.method(https, 'get', (url, _options, respond) => {
    assert.equal(url, info.assetUrl);
    assert.equal(manifests > 0, true, 'checksum must precede any large transfer');
    downloads++;
    const request = new EventEmitter(); request.destroy = () => {};
    setImmediate(() => {
      const response = new PassThrough(); response.statusCode = 200;
      response.headers = { 'content-length': String(bytes.length) };
      respond(response); response.end(bytes);
    });
    return request;
  });
  return { dir, bytes, info, dest: path.join(dir, 'updates', 'Setup.exe'), downloads: () => downloads, manifests: () => manifests };
}

test('completed bytes survive verify cancellation and the next explicit attempt only revalidates', async (t) => {
  const f = assetFixture(t);
  const controller = new AbortController();
  await assert.rejects(downloadReleaseAsset(f.info, f.dest, p => {
    if (p.phase === 'verify') controller.abort();
  }, { signal: controller.signal }), { code: 'ERR_UPDATER_CANCELLED' });
  assert.deepEqual(fs.readFileSync(`${f.dest}.part`), f.bytes);
  assert.equal(fs.existsSync(f.dest), false, 'unverified bytes must not enter the installable cache');
  await downloadReleaseAsset(f.info, f.dest, null);
  assert.equal(f.downloads(), 1);
  assert.equal(f.manifests(), 2, 'a new operation must fetch its own current checksum');
  assert.deepEqual(fs.readFileSync(f.dest), f.bytes);
  assert.equal(fs.existsSync(`${f.dest}.part`), false);
});

test('recovery rejects damaged received bytes and pins one checksum for the entire new transfer', async (t) => {
  const f = assetFixture(t);
  fs.mkdirSync(path.dirname(f.dest));
  fs.writeFileSync(`${f.dest}.part`, 'truncated old attempt');
  await downloadReleaseAsset(f.info, f.dest);
  assert.deepEqual(fs.readFileSync(f.dest), f.bytes);
  assert.equal(f.downloads(), 1);
  assert.equal(f.manifests(), 1, 'post-transfer verification is local and cannot time out on another manifest fetch');
});

test('checksum service failure preserves completed candidates and existing verified cache', async (t) => {
  const f = assetFixture(t);
  fs.mkdirSync(path.dirname(f.dest));
  fs.writeFileSync(f.dest, f.bytes);
  fs.writeFileSync(`${f.dest}.part`, f.bytes);
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 404 }));
  await assert.rejects(downloadReleaseAsset(f.info, f.dest), { code: 'HTTP_ERROR_404' });
  assert.deepEqual(fs.readFileSync(f.dest), f.bytes);
  assert.deepEqual(fs.readFileSync(`${f.dest}.part`), f.bytes);
  assert.equal(f.downloads(), 0);
});

test('cancellation during a running local hash keeps its stable cancellation code', async (t) => {
  const { verifyFileChecksum } = require('./update');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-hash-cancel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'Setup.exe');
  fs.writeFileSync(file, Buffer.alloc(4 * 1024 * 1024, 'x'));
  const controller = new AbortController();
  const hashing = verifyFileChecksum(file, '0'.repeat(128), { signal: controller.signal });
  setImmediate(() => controller.abort());
  await assert.rejects(hashing, { name: 'AbortError', code: 'ERR_UPDATER_CANCELLED' });
  assert.equal(fs.statSync(file).size, 4 * 1024 * 1024);
});

test('a confirmed operation keeps its original asset after the caller changes the snapshot', async (t) => {
  const f = assetFixture(t);
  const original = { ...f.info };
  await downloadReleaseAsset(original, f.dest, p => {
    if (p.phase === 'resolve') original.assetUrl = 'https://github.com/changed/Setup.exe';
  });
  assert.deepEqual(fs.readFileSync(f.dest), f.bytes);
  assert.equal(f.downloads(), 1);
});
