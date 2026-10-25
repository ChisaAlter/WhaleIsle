import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startQaServer, qaServerUrl, qaServerOptions, normalizePrefix } from './server.mjs';

async function serverFor(t, options) {
  const server = await startQaServer(options);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

test('legacy numeric port 0 returns a real dynamic address and root SPA', async (t) => {
  const server = await serverFor(t, 0);
  assert.ok(server.address().port > 0);
  const url = qaServerUrl(server);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(await response.text(), await readFile(new URL('../../mobile/web/index.html', import.meta.url), 'utf8'));
});

test('prefix serves assets and fake bundle with MIME, keeps root unavailable', async (t) => {
  const server = await serverFor(t, { port: 0, prefix: '/dshd/' });
  const base = qaServerUrl(server);
  assert.ok(base.endsWith('/dshd/'));
  for (const [path, mime] of [['', 'text/html'], ['app.js?v=qa', 'text/javascript'], ['app.css', 'text/css'], ['tokens.css', 'text/css'], ['assets/whale-head.png', 'image/png']]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').startsWith(mime));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const bundle = await fetch(`${base}chisacode/daemon-client.bundle.js?v=qa`);
  assert.match(bundle.headers.get('content-type'), /^text\/javascript/);
  assert.equal(await bundle.text(), await readFile(new URL('./fake-daemon-client.mjs', import.meta.url), 'utf8'));
  assert.equal((await fetch(new URL('/', base))).status, 404);
  assert.equal((await fetch(new URL('/dshdx/app.js', base))).status, 404);
  assert.equal((await fetch(`${base}missing.js`)).status, 404);
  const redirect = await fetch(`${base.slice(0, -1)}?qa=1`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/dshd/?qa=1');
});

test('occupied port rejects instead of hanging and two port-0 callers coexist', async (t) => {
  const first = await serverFor(t, 0);
  const second = await serverFor(t, { port: 0 });
  assert.notEqual(first.address().port, second.address().port);
  await assert.rejects(startQaServer(first.address().port), { code: 'EADDRINUSE' });
});

test('encoded traversal and Windows separators cannot escape web root', async (t) => {
  const server = await serverFor(t, { port: 0, prefix: '/dshd' });
  for (const path of ['/dshd/..%2f..%2fpackage.json', '/dshd/..%5c..%5cpackage.json', '/dshd/%00app.js']) {
    const status = await new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port: server.address().port, path }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      }).on('error', reject).end();
    });
    assert.equal(status, 403, path);
  }
});

test('CLI accepts zero and prefix while preserving defaults', () => {
  assert.deepEqual(qaServerOptions([]), { port: 3180, prefix: '/', screenshots: undefined });
  assert.deepEqual(qaServerOptions(['--port', '0', '--prefix', '/dshd', '--screenshots', 'shots']), { port: 0, prefix: '/dshd/', screenshots: 'shots' });
  for (const port of ['-1', 'NaN', '65536', '1.5', '']) assert.throws(() => qaServerOptions(['--port', port]));
  for (const prefix of ['//evil', '/a/../', '/a?x', '/%2f', 'dshd']) assert.throws(() => normalizePrefix(prefix));
});

test('standalone server CLI prints its dynamic prefixed URL without opening a browser', { timeout: 10000 }, async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url)), '--port', '0', '--prefix', '/dshd/'], { windowsHide: true });
  t.after(() => new Promise((resolve) => { child.once('close', resolve); child.kill(); }));
  const url = await new Promise((resolve, reject) => {
    let text = '';
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`server exited: ${code}`)));
    child.stdout.on('data', (chunk) => {
      text += chunk;
      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)\/dshd\//);
      if (match && Number(match[1]) > 0) resolve(match[0]);
    });
  });
  assert.equal((await fetch(url)).status, 200);
});
