'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createHash } = require('node:crypto');
const { downloadFile, downloadReleaseAsset, setGithubTokenProvider } = require('./update');

function fixture(t, respond) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-resume-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  t.mock.method(https, 'get', (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    requests.push({ url, headers: options.headers });
    setImmediate(() => {
      const response = new PassThrough();
      response.statusCode = 200;
      response.headers = {};
      respond(response, requests.length, options.headers, url);
      callback(response);
      response.emit('ready');
    });
    return request;
  });
  return { dest: path.join(dir, 'Setup.exe'), requests };
}
const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
const hash = data => createHash('sha512').update(data).digest('hex');
const options = { resume: true, retryDelayMs: 1, timeoutMs: 5000 };
function broken(response, content = bytes) {
  response.headers = { 'content-length': String(content.length), etag: '"installer-v1"' };
  response.once('ready', () => {
    response.write(content.subarray(0, 10));
    setImmediate(() => response.destroy(Object.assign(new Error('reset'), { code: 'ECONNRESET' })));
  });
}
function suffix(response, headers, overrides = {}) {
  const offset = Number(/^bytes=(\d+)-$/.exec(headers.Range)?.[1]);
  assert.ok(offset > 0 && offset < bytes.length);
  response.statusCode = 206;
  response.headers = { 'content-length': String(bytes.length - offset),
    'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}`, etag: '"installer-v1"', ...overrides };
  response.once('ready', () => response.end(bytes.subarray(offset)));
}

test('checksum-backed retries resume written bytes and verify the entire reconstructed file', async t => {
  const f = fixture(t, (response, attempt, headers) => {
    if (attempt === 1) broken(response);
    else suffix(response, headers);
  });
  const info = { assetName: 'Setup.exe', assetUrl: 'https://example.test/Setup.exe', checksumUrl: 'https://example.test/sums' };
  t.mock.method(global, 'fetch', async () => ({ ok: true, text: async () => `${hash(bytes)}  Setup.exe` }));
  const progress = [];
  // Exercise real release entry, which alone enables resume after checksum resolution.
  await downloadReleaseAsset(info, f.dest, p => progress.push(p));
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].headers.Range, undefined);
  assert.equal(f.requests[1].headers.Range, 'bytes=10-');
  assert.equal(f.requests[1].headers['If-Range'], '"installer-v1"');
  assert.deepEqual(fs.readFileSync(f.dest), bytes);
  assert.ok(progress.some(p => p.resumed && p.received === bytes.length));
  assert.ok(progress.some(p => p.phase === 'verify'));
  assert.equal(fs.existsSync(`${f.dest}.part`), false);
});

test('weak ETag uses Last-Modified consistently for If-Range and resumed validation', async t => {
  const modified = 'Tue, 27 Oct 2026 00:00:00 GMT';
  const f = fixture(t, (response, attempt, headers) => {
    if (attempt === 1) {
      broken(response);
      response.headers.etag = 'W/"weak"';
      response.headers['last-modified'] = modified;
    } else {
      assert.equal(headers['If-Range'], modified);
      suffix(response, headers, { etag: 'W/"weak"', 'last-modified': modified });
    }
  });
  await downloadFile('https://example.test/Setup.exe', f.dest, null, options);
  assert.deepEqual(fs.readFileSync(f.dest), bytes);
});

test('three attempts keep the original If-Range when an intermediate 206 omits its validator', async t => {
  for (const changed of [false, true]) {
    await t.test(`changed=${changed}`, async st => {
      const f = fixture(st, (response, attempt, headers) => {
        if (attempt === 1) { broken(response); return; }
        assert.equal(headers['If-Range'], '"installer-v1"');
        if (attempt === 2) {
          assert.equal(headers.Range, 'bytes=10-');
          response.statusCode = 206;
          response.headers = { 'content-length': String(bytes.length - 10),
            'content-range': `bytes 10-${bytes.length - 1}/${bytes.length}` };
          response.once('ready', () => {
            response.write(bytes.subarray(10, 20));
            setImmediate(() => response.destroy(Object.assign(new Error('reset'), { code: 'ECONNRESET' })));
          });
        } else {
          assert.equal(headers.Range, 'bytes=20-');
          suffix(response, headers, { etag: changed ? '"installer-v2"' : '"installer-v1"' });
        }
      });
      const pending = downloadFile('https://example.test/Setup.exe', f.dest, null, options);
      if (changed) {
        await assert.rejects(pending, { code: 'ERR_UPDATER_INVALID_RANGE' });
        assert.equal(fs.existsSync(f.dest), false);
      } else {
        await pending;
        assert.deepEqual(fs.readFileSync(f.dest), bytes);
      }
      assert.equal(f.requests.length, 3);
    });
  }
});

test('a server returning 200 to resumed Range truncates before writing a fresh complete body', async t => {
  const f = fixture(t, (response, attempt, headers) => {
    if (attempt === 1) broken(response);
    else {
      assert.equal(headers.Range, 'bytes=10-');
      response.headers = { 'content-length': String(bytes.length), etag: '"installer-v2"' };
      response.once('ready', () => response.end(bytes));
    }
  });
  await downloadFile('https://example.test/Setup.exe', f.dest, null, options);
  assert.deepEqual(fs.readFileSync(f.dest), bytes);
});

test('resume Range and If-Range survive redirects without forwarding GitHub credentials', async t => {
  const f = fixture(t, (response, attempt, headers, url) => {
    if (url.includes('github.com/')) {
      response.statusCode = 302;
      response.headers = { location: 'https://cdn.example.test/signed' };
      response.once('ready', () => response.end());
    } else if (attempt === 2) broken(response);
    else suffix(response, headers);
  });
  setGithubTokenProvider(() => 'test-token');
  t.after(() => setGithubTokenProvider(null));
  await downloadFile('https://github.com/releases/Setup.exe', f.dest, null, options);
  assert.equal(f.requests.length, 4);
  assert.equal(f.requests[2].headers.Range, 'bytes=10-');
  assert.equal(f.requests[3].headers.Range, 'bytes=10-');
  assert.equal(f.requests[2].headers.Authorization, 'Bearer test-token');
  assert.equal(f.requests[3].headers.Authorization, undefined);
  assert.deepEqual(fs.readFileSync(f.dest), bytes);
});

for (const [name, override] of [
  ['wrong start', { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` }],
  ['changed total', { 'content-range': `bytes 10-${bytes.length}/${bytes.length + 1}` }],
  ['wrong end', { 'content-range': `bytes 10-${bytes.length - 2}/${bytes.length}` }],
  ['wrong length', { 'content-length': String(bytes.length) }],
  ['changed validator', { etag: '"changed"' }],
]) {
  test(`rejects ${name} in a resumed 206 before appending and removes partial`, async t => {
    const f = fixture(t, (response, attempt, headers) => {
      if (attempt === 1) broken(response);
      else suffix(response, headers, override);
    });
    await assert.rejects(downloadFile('https://example.test/Setup.exe', f.dest, null, options),
      { code: 'ERR_UPDATER_INVALID_RANGE' });
    assert.equal(f.requests.length, 2, 'invalid Range must not be retried');
    assert.equal(fs.existsSync(f.dest), false);
  });
}

test('unknown-length or unverified transfers retry from zero', async t => {
  for (const resume of [true, false]) {
    await t.test(`resume=${resume}`, async st => {
      const f = fixture(st, (response, attempt, headers) => {
        assert.equal(headers.Range, undefined);
        if (attempt === 1) {
          broken(response);
          if (resume) delete response.headers['content-length'];
        } else response.once('ready', () => response.end(bytes));
      });
      await downloadFile('https://example.test/Setup.exe', f.dest, null, { ...options, resume });
      assert.deepEqual(fs.readFileSync(f.dest), bytes);
    });
  }
});

test('final disconnect and cancellation during retry remove retained partials', async t => {
  for (const cancel of [true, false]) {
    await t.test(`cancel=${cancel}`, async st => {
      const controller = new AbortController();
      const f = fixture(st, response => broken(response));
      await assert.rejects(downloadFile('https://example.test/Setup.exe', f.dest,
        p => { if (cancel && p.retrying) controller.abort(); },
        { ...options, maxAttempts: 2, signal: controller.signal }), cancel ? { name: 'AbortError' } : /下载连接中断/);
      assert.equal(f.requests.length, cancel ? 1 : 2);
      assert.equal(fs.existsSync(f.dest), false);
    });
  }
});

test('matching Range metadata cannot bypass final SHA512 verification', async t => {
  const f = fixture(t, (response, attempt, headers) => {
    if (attempt === 1) broken(response);
    else {
      const offset = Number(headers.Range.match(/\d+/)[0]);
      response.statusCode = 206;
      response.headers = { 'content-length': String(bytes.length - offset),
        'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` };
      response.once('ready', () => response.end(Buffer.alloc(bytes.length - offset, 'x')));
    }
  });
  t.mock.method(global, 'fetch', async () => ({ ok: true, text: async () => `${hash(bytes)}  Setup.exe` }));
  await assert.rejects(downloadReleaseAsset({ assetName: 'Setup.exe', assetUrl: 'https://example.test/Setup.exe',
    checksumUrl: 'https://example.test/sums' }, f.dest), { code: 'ERR_UPDATER_CHECKSUM_MISMATCH' });
  assert.equal(fs.existsSync(f.dest), false);
  assert.equal(fs.existsSync(`${f.dest}.part`), false);
});
