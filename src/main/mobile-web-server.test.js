'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');

const { createMobileWebServer, isAllowedUpgradeOrigin } = require('./mobile-web-server');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

function createFakeUpstreamWsServer(t) {
  const upstreamConnections = new Set();
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/lan-ws' });
  wss.on('connection', (ws) => {
    upstreamConnections.add(ws);
    ws.on('close', () => upstreamConnections.delete(ws));
    ws.on('message', (data, isBinary) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: isBinary });
    });
  });
  t.after(() => new Promise((resolve) => wss.close(() => resolve())));
  return new Promise((resolve) => {
    wss.once('listening', () => {
      const addr = wss.address();
      resolve({ wss, upstreamConnections, url: `ws://127.0.0.1:${addr.port}/lan-ws` });
    });
  });
}

function openWs(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws._closedPromise = new Promise((res) => {
      ws.once('close', (code, reason) => res({ code, reason: reason ? reason.toString('utf8') : '' }));
    });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => {
      const err = new Error(`unexpected-response:${res.statusCode}`);
      err.statusCode = res.statusCode;
      res.resume();
      reject(err);
    });
    ws.once('error', reject);
  });
}

function waitClose(ws, timeoutMs = 4000) {
  if (ws._closedPromise) {
    return Promise.race([
      ws._closedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for ws close')), timeoutMs)),
    ]);
  }
  return Promise.resolve({ code: 1000, reason: '' });
}

test('malformed LAN URLs and Host headers return 400 without interrupting later requests', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-mweb-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'index.html'), '<html>still running</html>');
  const server = createMobileWebServer({ root });
  t.after(() => close(server));
  const port = await listen(server);
  const request = (pathname, headers = {}) => new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.setTimeout(2_000, () => req.destroy(new Error('request did not finish')));
  });
  for (const pathname of ['/%', '/%E0%A4%A', '/%FF.js']) {
    assert.equal(await request(pathname), 400);
  }
  assert.equal(await request('/', { Host: '%' }), 400);
  assert.equal(await request('/'), 200);
});

test('mobile-web-server sets universally-safe security headers, no CSP (relay WS must stay open)', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-mweb-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');

  const server = createMobileWebServer({ root });
  t.after(() => close(server));
  const port = await listen(server);

  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  // Deliberately NO content-security-policy: the SPA connects a WebSocket to a
  // different relay host, and a same-origin connect-src would break pairing.
  assert.equal(res.headers.get('content-security-policy'), null);
  await close(server);
});

test('isAllowedUpgradeOrigin and /ws upgrade permit same-port multi-NIC & localhost while rejecting foreign/wrong-port origins', async (t) => {
  const localAddresses = ['192.168.1.10', '10.0.0.5', '127.0.0.1', '::1', 'localhost'];
  assert.equal(isAllowedUpgradeOrigin(undefined, '10.0.0.5:3180', { port: 3180, localAddresses }), true);
  assert.equal(isAllowedUpgradeOrigin('http://192.168.1.10:3180', '10.0.0.5:3180', { port: 3180, localAddresses }), true);
  assert.equal(isAllowedUpgradeOrigin('http://localhost:3180', '192.168.1.10:3180', { port: 3180, localAddresses }), true);
  assert.equal(isAllowedUpgradeOrigin('http://[::1]:3180', '192.168.1.10:3180', { port: 3180, localAddresses }), true);
  assert.equal(isAllowedUpgradeOrigin('http://192.168.1.10:8080', '10.0.0.5:3180', { port: 3180, localAddresses }), false);
  assert.equal(isAllowedUpgradeOrigin('http://evil.example:3180', '10.0.0.5:3180', { port: 3180, localAddresses }), false);
  assert.equal(isAllowedUpgradeOrigin('http://192.168.1.99:3180', '10.0.0.5:3180', { port: 3180, localAddresses }), false);
  assert.equal(isAllowedUpgradeOrigin('file:///app/index.html', '10.0.0.5:3180', { port: 3180, localAddresses }), false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-mweb-orig-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = await createFakeUpstreamWsServer(t);
  const server = createMobileWebServer({
    root,
    lanWsTarget: upstream.url,
    listLocalAddresses: () => localAddresses,
  });
  t.after(() => close(server));
  const port = await listen(server);

  const okWs = await openWs(`ws://127.0.0.1:${port}/ws`, { Host: `10.0.0.5:${port}`, Origin: `http://192.168.1.10:${port}` });
  okWs.close();
  await waitClose(okWs);

  const okLocalhost = await openWs(`ws://127.0.0.1:${port}/ws`, { Host: `192.168.1.10:${port}`, Origin: `http://localhost:${port}` });
  okLocalhost.close();
  await waitClose(okLocalhost);

  await assert.rejects(
    () => openWs(`ws://127.0.0.1:${port}/ws`, { Host: `10.0.0.5:${port}`, Origin: `http://192.168.1.99:${port}` }),
    (err) => err.statusCode === 403,
  );
  await assert.rejects(
    () => openWs(`ws://127.0.0.1:${port}/ws`, { Host: `10.0.0.5:${port}`, Origin: 'http://evil.example:' + port }),
    (err) => err.statusCode === 403,
  );
  await assert.rejects(
    () => openWs(`ws://127.0.0.1:${port}/ws`, { Host: `10.0.0.5:${port}`, Origin: 'http://192.168.1.10:8080' }),
    (err) => err.statusCode === 403,
  );
});

test('/ws closes silent upgrades on first-frame timeout and enforces per-remote slot cap', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-mweb-slots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = await createFakeUpstreamWsServer(t);

  // Part 1: 16 silent sockets (spread across 4 remote keys) time out cleanly -> 17th succeeds
  const server1 = createMobileWebServer({
    root,
    lanWsTarget: upstream.url,
    firstFrameTimeoutMs: 70,
    idleTimeoutMs: 2000,
    resolveRemoteAddress: (req) => String(req.headers['x-test-remote'] || 'default'),
  });
  t.after(() => close(server1));
  const port1 = await listen(server1);

  const silentSockets = [];
  for (let i = 0; i < 16; i += 1) {
    silentSockets.push(await openWs(`ws://127.0.0.1:${port1}/ws`, { 'x-test-remote': `client-${Math.floor(i / 4)}` }));
  }
  const closes = await Promise.all(silentSockets.map((ws) => waitClose(ws)));
  assert.ok(closes.every((c) => c.code === 1008));

  const recovered = await openWs(`ws://127.0.0.1:${port1}/ws`, { 'x-test-remote': 'client-0' });
  recovered.send('ping');
  recovered.close();
  await waitClose(recovered);

  // Part 2: 5th concurrent bridge from same source -> 503 while distinct source succeeds
  const held = [];
  for (let i = 0; i < 4; i += 1) {
    const ws = await openWs(`ws://127.0.0.1:${port1}/ws`, { 'x-test-remote': 'hot-source' });
    ws.send('keepalive-first-frame');
    held.push(ws);
  }
  await assert.rejects(
    () => openWs(`ws://127.0.0.1:${port1}/ws`, { 'x-test-remote': 'hot-source' }),
    (err) => err.statusCode === 503,
  );
  const other = await openWs(`ws://127.0.0.1:${port1}/ws`, { 'x-test-remote': 'other-source' });
  other.close();
  await waitClose(other);
  for (const ws of held) {
    ws.close();
    await waitClose(ws);
  }
});

test('/ws disconnects slow backpressured client without interrupting healthy sibling', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-mweb-bp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstreamSockets = [];
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/lan-ws' });
  wss.on('connection', (ws) => {
    ws._closedPromise = new Promise((res) => {
      ws.once('close', (code, reason) => res({ code, reason: reason ? reason.toString('utf8') : '' }));
    });
    upstreamSockets.push(ws);
  });
  t.after(() => {
    for (const c of wss.clients) { try { c.terminate(); } catch { /* ignore */ } }
    return new Promise((resolve) => wss.close(() => resolve()));
  });
  await new Promise((resolve) => wss.once('listening', resolve));
  const upstreamUrl = `ws://127.0.0.1:${wss.address().port}/lan-ws`;

  const server = createMobileWebServer({
    root,
    lanWsTarget: upstreamUrl,
    bridgeHighWatermarkBytes: 16 * 1024,
    maxTotalBridgeBufferedBytes: 64 * 1024 * 1024,
    firstFrameTimeoutMs: 5000,
    idleTimeoutMs: 5000,
  });
  t.after(() => close(server));
  const port = await listen(server);

  const slowClient = await openWs(`ws://127.0.0.1:${port}/ws`);
  const fastClient = await openWs(`ws://127.0.0.1:${port}/ws`);
  t.after(() => {
    try { slowClient.terminate(); } catch { /* ignore */ }
    try { fastClient.terminate(); } catch { /* ignore */ }
  });
  slowClient.send('hi-slow');
  fastClient.send('hi-fast');
  await new Promise((r) => setTimeout(r, 40));

  const fastReceived = [];
  fastClient.on('message', (d) => fastReceived.push(d.length));

  // Pause slowClient underlying TCP socket so server-side clientWs.bufferedAmount saturates loopback buffer and crosses 16 KiB.
  // Watch slowUp (unpaused) for server teardown, then resume slowClient so TCP EOF/close completes cleanly.
  const [slowUp, fastUp] = upstreamSockets;
  const slowUpClosePromise = waitClose(slowUp, 5000);
  slowClient._socket.pause();
  const chunk = Buffer.alloc(256 * 1024, 0x41);
  for (let i = 0; i < 40; i += 1) {
    if (slowUp.readyState === WebSocket.CLOSED) break;
    if (slowUp.readyState === WebSocket.OPEN) slowUp.send(chunk);
    if (fastUp.readyState === WebSocket.OPEN) fastUp.send(Buffer.from('ok'));
    await new Promise((r) => setTimeout(r, 15));
  }
  const slowUpClosed = await slowUpClosePromise;
  assert.equal(slowUpClosed.code, 1008);
  slowClient._socket.resume();
  slowClient.terminate();
  assert.ok(fastReceived.length >= 1, 'healthy sibling must keep receiving frames');
  fastClient.close();
  await waitClose(fastClient);
});

test('/ws global memory budget evicts heaviest queued bridge and drains pool cleanly', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-mweb-budget-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/lan-ws' });
  t.after(() => {
    for (const c of wss.clients) { try { c.terminate(); } catch { /* ignore */ } }
    return new Promise((resolve) => wss.close(() => resolve()));
  });
  await new Promise((resolve) => wss.once('listening', resolve));
  const upstreamUrl = `ws://127.0.0.1:${wss.address().port}/lan-ws`;

  const upstreamSockets = [];
  wss.on('connection', (ws) => {
    ws._closedPromise = new Promise((res) => {
      ws.once('close', (code, reason) => res({ code, reason: reason ? reason.toString('utf8') : '' }));
    });
    upstreamSockets.push(ws);
  });

  const server = createMobileWebServer({
    root,
    lanWsTarget: upstreamUrl,
    bridgeHighWatermarkBytes: 32 * 1024 * 1024,
    maxTotalBridgeBufferedBytes: 64 * 1024,
    firstFrameTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    maxBridgesPerRemoteAddress: 8,
  });
  t.after(() => close(server));
  const port = await listen(server);

  const big = await openWs(`ws://127.0.0.1:${port}/ws`);
  const med = await openWs(`ws://127.0.0.1:${port}/ws`);
  const small = await openWs(`ws://127.0.0.1:${port}/ws`);
  t.after(() => {
    for (const ws of [big, med, small]) { try { ws.terminate(); } catch { /* ignore */ } }
  });
  big.send('1');
  med.send('2');
  small.send('3');
  await new Promise((r) => setTimeout(r, 40));

  const [bigUp, medUp, smallUp] = upstreamSockets;
  const bigUpClose = waitClose(bigUp, 5000);
  big._socket.pause();
  med._socket.pause();
  medUp.send(Buffer.alloc(32 * 1024, 1));
  for (let i = 0; i < 40; i += 1) {
    if (bigUp.readyState === WebSocket.CLOSED) break;
    if (bigUp.readyState === WebSocket.OPEN) bigUp.send(Buffer.alloc(256 * 1024, 2));
    await new Promise((r) => setTimeout(r, 15));
  }
  const evicted = await bigUpClose;
  assert.equal(evicted.code, 1008);
  assert.match(evicted.reason, /Bridge memory budget exceeded/);
  big._socket.resume();
  med._socket.resume();
  assert.equal(small.readyState, WebSocket.OPEN);

  smallUp.send('still-alive');
  med.terminate();
  small.close();
  await Promise.all([waitClose(med), waitClose(small)]);

  // Pool has drained back to zero
  const next = await openWs(`ws://127.0.0.1:${port}/ws`);
  next.close();
  await waitClose(next);
});
