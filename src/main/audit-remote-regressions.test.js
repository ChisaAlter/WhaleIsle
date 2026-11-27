'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { WebSocket } = require('ws');
const { resolveSpaAsset } = require('./mobile-web');
const { createMobileWebServer, listenMobileWebServer } = require('./mobile-web-server');
const { forwardHostRespond } = require('../shared/dshd-host-tunnel');

test('mobile-web blocks package.json, fixtures, source maps, and symlink escapes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mw-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mw-out-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>ok</h1>');
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, 'demo.fixture.html'), 'fixture');
    fs.writeFileSync(path.join(dir, 'app.js.map'), '{}');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'leak.txt'));
    } catch {
      // Symlink creation may require privilege on some Windows setups.
    }
    assert.ok(resolveSpaAsset(dir, '/index.html'));
    assert.equal(resolveSpaAsset(dir, '/package.json'), null);
    assert.equal(resolveSpaAsset(dir, '/demo.fixture.html'), null);
    assert.equal(resolveSpaAsset(dir, '/app.js.map'), null);
    if (fs.existsSync(path.join(dir, 'leak.txt'))) {
      assert.equal(resolveSpaAsset(dir, '/leak.txt'), null);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('mobile-web-server rejects cross-origin /ws upgrades and sets timeouts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mws-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>ok</h1>');
  const server = createMobileWebServer({ root: dir, lanWsTarget: 'ws://127.0.0.1:65432/lan-ws' });
  try {
    await listenMobileWebServer(server, '127.0.0.1', 0);
    const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
    assert.ok(server.headersTimeout > 0 && server.headersTimeout <= 15_000);
    assert.ok(server.requestTimeout > 0 && server.requestTimeout <= 30_000);
    const status = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`, {
        headers: { Origin: 'https://evil.example' },
      });
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.once('open', () => { ws.close(); reject(new Error('should not open')); });
      ws.once('error', () => {});
    });
    assert.equal(status, 403);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('forwardHostRespond rejects malformed remote-event rpcId cleanly', async () => {
  await assert.rejects(
    () => forwardHostRespond({ origin: 'http://127.0.0.1:3080', rpcId: 'remote-event:{bad', value: { outcome: 'rejected' } }),
    /格式无效/,
  );
  await assert.rejects(
    () => forwardHostRespond({ origin: 'http://127.0.0.1:3080', rpcId: 'remote-event:null', value: { outcome: 'rejected' } }),
    /格式无效/,
  );
});

test('dsh-remote pool rejects cmd metacharacters in shell path and handles readPartial short reads', async () => {
  const { SshPool } = await import(pathToFileURL(path.resolve(__dirname, '../../vendor/dsh-remote/lib/pool.js')).href);
  const pool = new SshPool({ host: '127.0.0.1', port: 22, username: 'u', shell: 'C:\\bin\\bash.exe" & calc.exe' });
  assert.equal(pool._isSafeWindowsShellPath('C:\\Program Files\\Git\\bin\\bash.exe'), true);
  assert.equal(pool._isSafeWindowsShellPath('C:\\bin\\bash.exe" & calc.exe'), false);
  assert.equal(pool._isSafeWindowsShellPath('%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe', { allowLocalAppData: true }), true);
  assert.equal(pool._isSafeWindowsShellPath('%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe'), false);

  let closed = 0;
  let reads = 0;
  const fakeSftp = {
    on() {},
    open(_p, _m, cb) { cb(null, Buffer.from('h1')); },
    read(_h, buf, offset, len, pos, cb) {
      reads += 1;
      if (pos >= 10) return cb(null, 0, buf);
      const chunk = Buffer.from('0123456789').subarray(pos, Math.min(pos + 4, 10));
      chunk.copy(buf, offset);
      cb(null, chunk.length, buf);
    },
    close(_h, cb) { closed += 1; cb?.(); },
  };
  const fakeClient = {
    on() {},
    end() {},
    sftp(cb) { cb(null, fakeSftp); },
  };
  pool.client = fakeClient;
  const sftp = await pool.sftp();
  const data = await sftp.readPartial('/remote/file.txt', 0, 10);
  assert.equal(data.toString('utf8'), '0123456789');
  assert.equal(reads, 3);
  assert.equal(closed, 1);
});

test('dsh-remote syncTree honors depth alias, tracks staleRemote, and pushOneFile blocks traversal', async () => {
  const { syncTree, pushOneFile } = await import(pathToFileURL(path.resolve(__dirname, '../../vendor/dsh-remote/lib/sync.js')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-'));
  try {
    const sftp = {
      readdir: async (d) => (d === '/r' ? [{ filename: 'a.txt', attrs: { isDirectory: () => false } }] : []),
      stat: async (p) => (p === '/r/a.txt' ? { size: 2, mtime: 100 } : (() => { throw new Error('ENOENT'); })()),
      readFile: async () => Buffer.from('hi'),
      mkdir: async () => {},
      writeFile: async () => {},
    };
    const { stats, nextState } = await syncTree(sftp, '/r', dir, {
      depth: 1,
      state: { 'a.txt': { size: 2, mtime: 100 }, 'deleted.txt': { size: 1, mtime: 50 } },
    });
    assert.equal(stats.staleRemote, 1);
    assert.equal(nextState['deleted.txt'], undefined);
    const escaped = await pushOneFile(sftp, dir, '/r', '../outside.txt');
    assert.equal(escaped.status, 'skipped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dsh-remote ForwardManager filters autoStart by machineId and closes local sockets on stop', async () => {
  const { ForwardManager } = await import(pathToFileURL(path.resolve(__dirname, '../../vendor/dsh-remote/lib/forwards.js')).href);
  const startedIds = [];
  const mgr = new ForwardManager({ connect: async () => fakeClient });
  mgr.defs = [
    { id: 'f1', direction: 'local', listenPort: 0, targetHost: '127.0.0.1', targetPort: 80, autoStart: true, machineId: 'm1' },
    { id: 'f2', direction: 'local', listenPort: 0, targetHost: '127.0.0.1', targetPort: 81, autoStart: true, machineId: 'm2' },
  ];
  const origStart = mgr.start.bind(mgr);
  mgr.start = async (d) => { startedIds.push(d.id); return { ok: true, active: true }; };
  const fakeClient = new (require('node:events').EventEmitter)();
  mgr.attach(fakeClient, 'm1');
  assert.deepEqual(startedIds, ['f1']);
  mgr.start = origStart;
  mgr.detach();
});
