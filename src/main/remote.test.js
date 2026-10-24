// Known flake (observed 2026-09-16): one failure under full-suite
// concurrency, clean standalone and in a later full run. All listeners
// bind port 0 — not a port collision; mechanism undetermined (suspect
// resource contention with the real-daemon E2E in this file).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateToken } = require('../shared/remote-auth');
const { pairingUrl, normalizeRelayOrigin, reachableAddresses } = require('../shared/lan');
const { encodeOffer, decodeOffer, offerFromHash } = require('../shared/offer');
const {
  RemoteGateway,
  createDisabledRemote,
  rewriteProxyHeaders,
  shouldGzipProxy,
  normalizeBindAddress,
  localConnectHost,
} = require('./remote');
const { RelayClient } = require('./relay-client');
const { RelayServer } = require('../relay/server');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function request(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  const body = await response.text();
  return { status: response.status, body, headers: response.headers };
}

function insecureRelay(hostToken) {
  return new RelayServer({ hostToken, allowInsecureHttp: true });
}

function insecureRelayClient(hostToken, options = {}) {
  return new RelayClient({
    ...options,
    allowInsecureHttp: true,
    getHostToken: () => hostToken,
  });
}

test('disabled remote stub does not listen or create an HTTP server', () => {
  const original = http.createServer;
  let created = 0;
  http.createServer = (...args) => {
    created += 1;
    return original.apply(http, args);
  };
  try {
    const remote = createDisabledRemote();
    const synced = remote.sync();
    const snap = remote.snapshot();
    assert.notEqual(snap.listening, true);
    assert.equal(snap.available, false);
    assert.equal(snap.enabled, false);
    assert.deepEqual(synced, snap);
    assert.equal(created, 0);
    remote.stop();
    assert.equal(created, 0);
    assert.deepEqual(remote.sync(), snap);
    remote.stop();
    assert.deepEqual(remote.snapshot(), {
      available: false,
      enabled: false,
      listening: false,
    });
  } finally {
    http.createServer = original;
  }
});

test('live gateway snapshot marks the remote face available', () => {
  const gateway = new RemoteGateway({
    getConfig: () => ({ remoteEnabled: false }),
  });
  const snap = gateway.snapshot();
  assert.equal(snap.available, true);
  assert.equal(snap.enabled, false);
  assert.equal(snap.listening, false);
});

test('main process constructs the ChisaCode remote face instead of the disabled stub', () => {
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  // 产品配对面 = ChisaCode v2 daemon；HTTP RemoteGateway 已从主进程接线退役。
  assert.match(index, /new DshdRemote/);
  assert.doesNotMatch(index, /new RemoteGateway/);
  assert.doesNotMatch(index, /createDisabledRemote/);
  assert.match(index, /getTarget:/);
});

test('relay close destroys upgraded clients and completes pending responses', async () => {
  const relay = insecureRelay('host-token-1234567890');
  const host = { destroyed: false, destroy() { this.destroyed = true; } };
  const client = { destroyed: false, destroy() { this.destroyed = true; } };
  const response = {
    headersSent: false,
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status;
      this.headersSent = true;
    },
    end(body) {
      this.body = body;
    },
  };
  relay.host = host;
  relay.pending.set(1, { res: response });
  relay.upgrades.set(2, client);

  await relay.close();

  assert.equal(host.destroyed, true);
  assert.equal(client.destroyed, true);
  assert.equal(response.status, 502);
  assert.equal(response.body, 'desktop disconnected');
  assert.equal(relay.pending.size, 0);
  assert.equal(relay.upgrades.size, 0);
});

test('shouldGzipProxy gzips script and html when the client asks for gzip', () => {
  assert.equal(shouldGzipProxy({ 'accept-encoding': 'gzip, deflate' }, 'text/javascript; charset=utf-8'), true);
  assert.equal(shouldGzipProxy({ 'accept-encoding': 'gzip' }, 'text/html; charset=utf-8'), true);
  assert.equal(shouldGzipProxy({ 'accept-encoding': 'identity' }, 'text/javascript'), false);
  assert.equal(shouldGzipProxy({ 'accept-encoding': 'gzip' }, 'application/json'), false);
  assert.equal(shouldGzipProxy({ 'accept-encoding': 'gzip' }, 'text/plain'), false);
  assert.equal(shouldGzipProxy({ 'accept-encoding': 'gzip', 'content-encoding': 'br' }, 'text/javascript'), false);
});

test('rewriteProxyHeaders forces loopback Host and Origin', () => {
  const headers = rewriteProxyHeaders({
    host: '192.168.1.8:3180',
    origin: 'http://192.168.1.8:3180',
    referer: 'http://192.168.1.8:3180/chat',
    'sec-fetch-site': 'cross-site',
    connection: 'keep-alive',
  }, { port: 3080 });
  assert.equal(headers.host, '127.0.0.1:3080');
  assert.equal(headers.origin, 'http://127.0.0.1:3080');
  assert.equal(headers.referer, 'http://127.0.0.1:3080/chat');
  assert.equal(headers['sec-fetch-site'], undefined);
  assert.equal(headers.connection, undefined);
});

test('rewriteProxyHeaders strips cookie and authorization so device tokens stay off loopback', () => {
  const headers = rewriteProxyHeaders({
    host: '192.168.1.8:3180',
    cookie: 'dsh_remote=device-secret',
    authorization: 'Bearer device-secret',
  }, { port: 3080 });
  assert.equal(headers.host, '127.0.0.1:3080');
  assert.equal(headers.cookie, undefined);
  assert.equal(headers.authorization, undefined);
});

test('pairingUrl puts the token in the hash offer, not the query', () => {
  const url = pairingUrl('10.0.0.4', 3180, 'abc');
  assert.equal(url.startsWith('http://10.0.0.4:3180/'), true);
  assert.equal(url.includes('?token='), false);
  const offer = offerFromHash(new URL(url).hash);
  assert.equal(offer.token, 'abc');
  assert.equal(offer.mode, 'lan');
});

test('pairingUrl for relay uses the relay origin and keeps the secret in the hash', () => {
  const url = pairingUrl('10.0.0.4', 3180, 'abc', { mode: 'relay', relay: 'https://relay.example:8787/path' });
  assert.equal(url.startsWith('https://relay.example:8787/#offer='), true);
  const offer = offerFromHash(new URL(url).hash);
  assert.equal(offer.mode, 'relay');
  assert.equal(offer.relay, 'https://relay.example:8787');
  assert.equal(offer.token, 'abc');
});

test('offer encode/decode round-trips and rejects junk', () => {
  const encoded = encodeOffer({ v: 1, token: 'secret', mode: 'lan' });
  assert.equal(decodeOffer(encoded).token, 'secret');
  assert.equal(decodeOffer('@@@'), null);
  assert.equal(decodeOffer(encodeOffer({ v: 2, token: 'x' })), null);
  assert.equal(normalizeRelayOrigin('ftp://nope'), '');
  assert.equal(normalizeRelayOrigin('http://relay.example'), '');
  assert.equal(normalizeRelayOrigin('https://ayase.cn'), 'https://ayase.cn');
  assert.equal(normalizeRelayOrigin('https://ayase.cn/path'), 'https://ayase.cn');
  assert.equal(normalizeRelayOrigin('http://125.124.85.212:8411'), '');
  assert.equal(normalizeRelayOrigin('https://relay.example'), 'https://relay.example');
  assert.equal(normalizeRelayOrigin('not a url'), '');
});

test('gateway refuses to start without a token', async () => {
  const gateway = new RemoteGateway();
  await assert.rejects(() => gateway.start({ port: 0, token: '', target: { port: 1 } }), /令牌/);
});

test('gateway sync stops an active listener when Harness is no longer ready', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  let target = { port: upstreamPort };
  const gateway = new RemoteGateway({
    getTarget: () => target,
    getConfig: () => ({
      remoteEnabled: true,
      remoteToken: token,
      remoteMode: 'lan',
    }),
  });
  try {
    await gateway.start({ port: 0, token, target });
    assert.equal(gateway.snapshot().listening, true);

    target = null;
    await gateway.sync();
    assert.equal(gateway.snapshot().listening, false);
    assert.equal(gateway.snapshot().target, null);
  } finally {
    await gateway.stop();
    await close(upstream);
  }
});

test('gateway proxies an authorized request and rewrites Host', async () => {
  let seenHost = '';
  const upstream = http.createServer((req, res) => {
    seenHost = req.headers.host;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok-from-dsh');
  });
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const gateway = new RemoteGateway();
  await gateway.start({
    port: 0,
    token,
    target: { port: upstreamPort },
  });
  const port = gateway.port || gateway.server.address().port;
  gateway.port = port;

  const denied = await request(port, '/api/ping');
  assert.equal(denied.status, 401);
  assert.match(denied.body, /#offer=/);

  const allowed = await request(port, '/api/ping', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body, 'ok-from-dsh');
  assert.equal(seenHost, `127.0.0.1:${upstreamPort}`);

  const leaked = await request(port, `/?token=${token}`, { redirect: 'manual' });
  assert.equal(leaked.status, 401);
  assert.equal(String(leaked.headers.get('set-cookie') || ''), '');

  const snap = gateway.snapshot();
  assert.equal(snap.mode, 'lan');
  assert.equal('qrSvg' in (snap.urls[0] || {}), false);

  await gateway.stop();
  await close(upstream);
});

test('self-host relay forwards an authorized request to the local gateway', async () => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('via-relay');
  });
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const hostToken = generateToken();
  const gateway = new RemoteGateway();
  await gateway.start({
    port: 0,
    token,
    target: { port: upstreamPort },
  });
  const gatewayPort = gateway.port || gateway.server.address().port;
  gateway.port = gatewayPort;

  const relay = insecureRelay(hostToken);
  const relayPort = await relay.listen(0, '127.0.0.1');
  const client = insecureRelayClient(hostToken, {
    getLocal: () => ({ port: gatewayPort }),
  });
  await client.connect(`http://127.0.0.1:${relayPort}`, hostToken);
  assert.equal(client.connected, true);

  const denied = await request(relayPort, '/api/ping');
  assert.equal(denied.status, 401);

  const allowed = await request(relayPort, '/api/ping', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body, 'via-relay');

  await client.disconnect();
  await relay.close();
  await gateway.stop();
  await close(upstream);
});

function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('timed out'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

test('relay without a desktop host tells the phone to wait', async () => {
  const relay = insecureRelay(generateToken());
  const relayPort = await relay.listen(0, '127.0.0.1');
  const denied = await request(relayPort, '/');
  assert.equal(denied.status, 503);
  assert.match(denied.body, /桌面还没连上中继/);
  await relay.close();
});

test('switching from relay to lan cancels an in-flight relay handshake', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const hostToken = generateToken();
  const blackhole = net.createServer();
  const relayPort = await listen(blackhole);
  const stored = {
    remoteEnabled: true,
    remoteToken: token,
    remoteMode: 'relay',
    remoteRelayUrl: `http://127.0.0.1:${relayPort}`,
    remoteRelayToken: hostToken,
  };
  const gateway = new RemoteGateway({
    getTarget: () => ({ port: upstreamPort }),
    getConfig: () => ({ ...stored }),
    saveConfig: (patch) => {
      Object.assign(stored, patch);
      return stored;
    },
    relayOptions: { allowInsecureHttp: true },
  });
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  stored.remotePort = gateway.port;
  const connecting = gateway.sync();
  await waitFor(() => Boolean(gateway.relay && gateway.relay.socket));
  stored.remoteMode = 'lan';
  await gateway.sync();
  assert.equal(gateway.snapshot().mode, 'lan');
  assert.equal(gateway.snapshot().error, '');
  assert.equal(gateway.snapshot().relayError, '');
  assert.equal(gateway.relay.socket, null);
  assert.equal(gateway.relay.shouldRun, false);
  await gateway.stop();
  await connecting.catch(() => {});
  await close(blackhole);
  await close(upstream);
});

test('LAN mode never connects relay and relay mode disconnects when switched back', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const hostToken = generateToken();
  const relay = insecureRelay(hostToken);
  const relayPort = await relay.listen(0, '127.0.0.1');
  const stored = {
    remoteEnabled: true,
    remoteToken: token,
    remoteMode: 'lan',
    remoteRelayUrl: `http://127.0.0.1:${relayPort}`,
    remoteRelayToken: hostToken,
  };
  const gateway = new RemoteGateway({
    getTarget: () => ({ port: upstreamPort }),
    getConfig: () => ({ ...stored }),
    saveConfig: (patch) => {
      Object.assign(stored, patch);
      return stored;
    },
    relayOptions: { allowInsecureHttp: true },
  });
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  stored.remotePort = gateway.port;
  await gateway.sync();
  assert.equal(gateway.relay.connected, false);
  assert.equal(gateway.snapshot().listening, true);
  stored.remoteMode = 'relay';
  await gateway.sync();
  assert.equal(gateway.relay.connected, true);
  assert.equal(gateway.snapshot().listening, true);
  stored.remoteMode = 'lan';
  await gateway.sync();
  assert.equal(gateway.relay.connected, false);
  stored.remoteEnabled = false;
  await gateway.sync();
  assert.equal(gateway.relay.connected, false);
  assert.equal(gateway.snapshot().listening, false);
  await gateway.stop();
  await relay.close();
  await close(upstream);
});

test('relay client sync keeps an in-flight socket to the same origin', async () => {
  const blackhole = net.createServer();
  const relayPort = await listen(blackhole);
  const hostToken = generateToken();
  const client = insecureRelayClient(hostToken, { handshakeTimeoutMs: 5000 });
  const connecting = client.sync(`http://127.0.0.1:${relayPort}`, hostToken);
  await waitFor(() => Boolean(client.socket));
  const socket = client.socket;
  await client.sync(`http://127.0.0.1:${relayPort}`, hostToken);
  assert.equal(client.socket, socket);
  await client.disconnect();
  await connecting.catch(() => {});
  await close(blackhole);
});

test('relay client reconnects after the host socket drops', async () => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('via-relay');
  });
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const hostToken = generateToken();
  const gateway = new RemoteGateway();
  await gateway.start({
    port: 0,
    token,
    target: { port: upstreamPort },
  });
  const gatewayPort = gateway.port || gateway.server.address().port;
  gateway.port = gatewayPort;

  const relay = insecureRelay(hostToken);
  const relayPort = await relay.listen(0, '127.0.0.1');
  const client = insecureRelayClient(hostToken, {
    getLocal: () => ({ port: gatewayPort }),
    retryMs: 50,
  });
  try {
    await client.connect(`http://127.0.0.1:${relayPort}`, hostToken);
    assert.equal(client.connected, true);

    client.socket.destroy();
    await waitFor(() => client.connected);

    const allowed = await request(relayPort, '/api/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body, 'via-relay');
  } finally {
    await client.disconnect();
    await relay.close();
    await gateway.stop();
    await close(upstream);
  }
});

function memoryConfig(initial = {}) {
  let stored = { ...initial };
  return {
    getConfig: () => stored,
    saveConfig: (patch) => {
      stored = { ...stored, ...patch };
      return stored;
    },
  };
}

function cookieFrom(response) {
  const header = String(response.headers.get('set-cookie') || '');
  const match = header.match(/dsh_remote=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

test('QR login mints a long-lived device cookie that survives unbinding of other devices', async () => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('paired');
  });
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const config = memoryConfig({ remoteToken: token, remoteDevices: [] });
  const gateway = new RemoteGateway(config);
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  const port = gateway.port || gateway.server.address().port;

  const login = await request(port, '/__remote__/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    },
    body: `token=${token}`,
    redirect: 'manual',
  });
  assert.equal(login.status, 302);
  const deviceToken = cookieFrom(login);
  assert.ok(deviceToken);
  assert.notEqual(deviceToken, token);
  assert.match(String(login.headers.get('set-cookie') || ''), /Max-Age=/);
  assert.equal(gateway.snapshot().devices.length, 1);
  assert.equal(gateway.snapshot().devices[0].name, 'iPhone');
  assert.equal('token' in gateway.snapshot().devices[0], false);

  const allowed = await request(port, '/api/ping', {
    headers: { cookie: `dsh_remote=${deviceToken}` },
  });
  assert.equal(allowed.status, 200);

  const again = await request(port, '/__remote__/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `dsh_remote=${deviceToken}`,
    },
    body: `token=${token}`,
    redirect: 'manual',
  });
  assert.equal(cookieFrom(again), deviceToken);
  assert.equal(gateway.snapshot().devices.length, 1);

  const id = gateway.snapshot().devices[0].id;
  assert.equal(gateway.unbindDevice('missing').devices.length, 1);
  gateway.unbindDevice(id);
  assert.equal(gateway.snapshot().devices.length, 0);
  const denied = await request(port, '/api/ping', {
    headers: { cookie: `dsh_remote=${deviceToken}` },
  });
  assert.equal(denied.status, 401);

  await gateway.stop();
  await close(upstream);
});

test('an HTML visit with the pairing cookie upgrades into a bound device', async () => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>ok</html>');
  });
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const config = memoryConfig({ remoteToken: token, remoteDevices: [] });
  const gateway = new RemoteGateway(config);
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  const port = gateway.port || gateway.server.address().port;

  const upgrade = await request(port, '/', {
    headers: {
      accept: 'text/html',
      cookie: `dsh_remote=${token}`,
      'user-agent': 'Mozilla/5.0 (Linux; Android 14)',
    },
    redirect: 'manual',
  });
  assert.equal(upgrade.status, 302);
  assert.equal(gateway.snapshot().devices.length, 1);
  assert.equal(gateway.snapshot().devices[0].name, 'Android');
  const deviceToken = cookieFrom(upgrade);
  assert.ok(deviceToken);
  assert.notEqual(deviceToken, token);

  await gateway.stop();
  await close(upstream);
});

test('paired HTML comes from the mobile SPA; /api still hits the host', async () => {
  const spaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-web-'));
  fs.writeFileSync(path.join(spaRoot, 'index.html'), '<html>手机远程</html>');
  fs.writeFileSync(path.join(spaRoot, 'app.js'), 'window.DSH_MOBILE=1');
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>Into the Unknown</html>');
  });
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const config = memoryConfig({ remoteToken: token, remoteDevices: [] });
  const gateway = new RemoteGateway({ ...config, mobileWebRoot: spaRoot });
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  const port = gateway.port || gateway.server.address().port;

  const page = await request(port, '/', { headers: { accept: 'text/html' } });
  assert.equal(page.status, 401);
  assert.match(page.body, /#offer=/);
  assert.doesNotMatch(page.body, /Into the Unknown/);
  assert.doesNotMatch(page.body, /手机远程/);

  const assetDenied = await request(port, '/app.js');
  assert.equal(assetDenied.status, 401);

  const login = await request(port, '/__remote__/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${token}`,
    redirect: 'manual',
  });
  const deviceToken = cookieFrom(login);
  const authed = await request(port, '/', {
    headers: { accept: 'text/html', cookie: `dsh_remote=${deviceToken}` },
  });
  assert.equal(authed.status, 200);
  assert.match(authed.body, /手机远程/);
  assert.doesNotMatch(authed.body, /Into the Unknown/);

  const asset = await request(port, '/app.js', {
    headers: { cookie: `dsh_remote=${deviceToken}` },
  });
  assert.equal(asset.status, 200);
  assert.equal(asset.body, 'window.DSH_MOBILE=1');

  const plugin = await request(port, '/plugins/ui-layout/client.js', {
    headers: { cookie: `dsh_remote=${deviceToken}` },
  });
  assert.equal(plugin.status, 404);

  const api = await request(port, '/api/session.list', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `dsh_remote=${deviceToken}`,
    },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'session.list', payload: {} }),
  });
  assert.equal(api.status, 200);
  assert.equal(api.body, '<html>Into the Unknown</html>');

  await gateway.stop();
  await close(upstream);
  fs.rmSync(spaRoot, { recursive: true, force: true });
});

test('JSON login mints a device token without an HTML body', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const config = memoryConfig({ remoteToken: token, remoteDevices: [] });
  const gateway = new RemoteGateway(config);
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  const port = gateway.port || gateway.server.address().port;

  const login = await request(port, '/__remote__/login', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'DshAndroid/1',
    },
    body: JSON.stringify({ token }),
  });
  assert.equal(login.status, 200);
  const json = JSON.parse(login.body);
  assert.equal(json.ok, true);
  assert.ok(json.deviceToken);
  assert.notEqual(json.deviceToken, token);
  assert.match(String(login.headers.get('set-cookie') || ''), /dsh_remote=/);

  const denied = await request(port, '/__remote__/login', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'nope' }),
  });
  assert.equal(denied.status, 401);
  assert.equal(JSON.parse(denied.body).error, '配对密钥无效');
  assert.doesNotMatch(denied.body, /<!DOCTYPE html>/i);

  await gateway.stop();
  await close(upstream);
});

test('proxied API does not forward device authorization to harness', async () => {
  let seenAuth = 'missing';
  let seenCookie = 'missing';
  const upstream = http.createServer((req, res) => {
    seenAuth = req.headers.authorization;
    seenCookie = req.headers.cookie;
    res.end('ok');
  });
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const gateway = new RemoteGateway();
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  const port = gateway.port || gateway.server.address().port;

  const allowed = await request(port, '/api/ping', {
    headers: {
      authorization: `Bearer ${token}`,
      cookie: `dsh_remote=${token}`,
    },
  });
  assert.equal(allowed.status, 200);
  assert.equal(seenAuth, undefined);
  assert.equal(seenCookie, undefined);

  await gateway.stop();
  await close(upstream);
});

test('shell whitelist requires login and rejects unknown names', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const seen = [];
  const gateway = new RemoteGateway({
    invokeShell: async (name, payload) => {
      seen.push({ name, payload });
      return { ok: true, result: { refName: 'main', isRepo: true } };
    },
  });
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  const port = gateway.port || gateway.server.address().port;

  const anon = await request(port, '/__remote__/shell/gitStatus', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd: '/ws' }),
  });
  assert.equal(anon.status, 401);

  const unknown = await request(port, '/__remote__/shell/writeFile', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cwd: '/ws', relativePath: 'x' }),
  });
  assert.equal(unknown.status, 404);

  const allowed = await request(port, '/__remote__/shell/gitStatus', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cwd: '/ws' }),
  });
  assert.equal(allowed.status, 200);
  assert.equal(JSON.parse(allowed.body).result.refName, 'main');
  assert.deepEqual(seen, [{ name: 'gitStatus', payload: { cwd: '/ws' } }]);

  await gateway.stop();
  await close(upstream);
});

// —— P0 回归：#offer= 首访自动登录全链路必须在「真实 mobile/web 树」上走通 ——
// 上一轮云端实机测试曾因 (a) 网关 serve 错分支的 SPA、(b) offer 编码错误被静默吞掉
// 而停在「等待配对」。本组测试把 encodeOffer → loginPage 内联脚本 → 表单登录 →
// parity SPA → SPA 侧 offer/login 模块整条链钉死在同一棵树上。

function decodeLikeLoginPageScript(encoded) {
  // 与 loginPage() 内联脚本逐行同构：base64url 归一化 + padding + UTF-8 JSON。
  let padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  return json && json.token ? String(json.token) : '';
}

test('legacy RemoteGateway offer fixture remains contained while the production SPA stays v2', async (t) => {
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let rpcId = '';
      try { rpcId = JSON.parse(raw || '{}').rpcId || ''; } catch { /* keep empty */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { name: 'DESKTOP-E2E', cwd: '/repo' } },
      }));
    });
  });
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const config = memoryConfig({ remoteToken: token, remoteDevices: [] });
  // 不注入 mobileWebRoot：必须落在仓库内真实的 mobile/web 树上。
  const gateway = new RemoteGateway(config);
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  const port = gateway.port;
  // 断言失败也必须放掉监听端口，否则整个 node --test 进程永不退出（CI 15 分钟超时）。
  t.after(async () => {
    await gateway.stop();
    upstream.closeAllConnections();
    await close(upstream);
  });

  // 1. 未认证首访（浏览器打开二维码 URL；hash 不上行）→ 401 legacy 登录页。
  const first = await request(port, '/', { headers: { accept: 'text/html' } });
  assert.equal(first.status, 401);
  assert.match(first.body, /login-error/);
  assert.match(first.body, /配对链接无效/);
  assert.match(first.body, /配对密钥无效/);
  assert.match(first.body, /无法连接桌面端/);

  // 2. 桌面二维码 payload 与登录页内联脚本解码互通（base64url / token 字段）。
  const url = pairingUrl('192.168.1.2', port, token, { mode: 'lan' });
  const encoded = new URL(url).hash.match(/offer=([^&]+)/)[1];
  assert.equal(decodeLikeLoginPageScript(encoded), token);

  // 3. 内联脚本同款表单登录 → 302 + 设备 cookie。
  const login = await request(port, '/__remote__/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(decodeLikeLoginPageScript(encoded))}`,
    redirect: 'manual',
  });
  assert.equal(login.status, 302);
  const deviceToken = cookieFrom(login);
  assert.ok(deviceToken);

  // 4. 认证后的 / 是 parity SPA（扫码/权限屏在 index.html 里），不是 v1。
  const spa = await request(port, '/', {
    headers: { accept: 'text/html', cookie: `dsh_remote=${deviceToken}` },
  });
  assert.equal(spa.status, 200);
  assert.match(spa.body, /screen-scan/);
  assert.match(spa.body, /screen-permission/);
  assert.match(spa.body, /等待连接/);

  // 5. Product app.js uses the ChisaCode v2 session path, not the legacy HTTP login helpers
  // exercised below for containment coverage.
  const appJs = await request(port, '/app.js', {
    headers: { cookie: `dsh_remote=${deviceToken}` },
  });
  assert.equal(appJs.status, 200);
  assert.match(appJs.body, /\.\/pair\/scan\.js/);
  assert.match(appJs.body, /settings-hub/);
  assert.match(appJs.body, /hasOfferFragment/);
  assert.match(appJs.body, /配对链接无效/);
  assert.match(appJs.body, /\.\/chisacode\/session\.js/);
  assert.match(appJs.body, /daemon-client\.bundle\.js/);
  assert.doesNotMatch(appJs.body, /\.\/host\/(?:offer|login)\.js/);

  // 6. Retained v1 modules still cover the legacy RemoteGateway fixture only.
  const { pathToFileURL } = require('url');
  const webHost = (name) => pathToFileURL(path.join(__dirname, '..', '..', 'mobile', 'web', 'host', name)).href;
  const { offerFromHash: spaOfferFromHash, hashHasOffer } = await import(webHost('offer.js'));
  const { loginWithOffer } = await import(webHost('login.js'));
  const offer = spaOfferFromHash(new URL(url).hash);
  assert.equal(offer.token, token);
  assert.equal(offer.mode, 'lan');
  let spaCookie = '';
  await loginWithOffer({
    origin: `http://127.0.0.1:${port}`,
    offer,
    fetchImpl: async (target, init) => {
      const response = await fetch(target, { ...init, redirect: 'manual' });
      const header = String(response.headers.get('set-cookie') || '');
      const match = header.match(/dsh_remote=([^;]+)/);
      if (match) spaCookie = decodeURIComponent(match[1]);
      return response;
    },
  });
  assert.ok(spaCookie);
  const proxied = await request(port, '/api/host.describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `dsh_remote=${spaCookie}` },
    body: JSON.stringify({ type: 'client-request', rpcId: 'e2e-1', method: 'host.describe', payload: {} }),
  });
  assert.equal(proxied.status, 200);
  assert.equal(JSON.parse(proxied.body).result.value.name, 'DESKTOP-E2E');

  // 7. 无效 offer 不是「无 offer」：SPA 模块必须能区分，boot 才能报错而非静默。
  assert.equal(spaOfferFromHash('#offer=%%%broken%%%'), null);
  assert.equal(hashHasOffer('#offer=%%%broken%%%'), true);
  assert.equal(hashHasOffer('#'), false);
});

// —— M-4 深化：绑定地址可配置 + LAN 自签 TLS ——

test('normalizeBindAddress accepts wildcard and IPv4 only; localConnectHost maps to a reachable host', () => {
  assert.equal(normalizeBindAddress('0.0.0.0'), '0.0.0.0');
  assert.equal(normalizeBindAddress('127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeBindAddress('192.168.1.20'), '192.168.1.20');
  assert.equal(normalizeBindAddress(''), '0.0.0.0');
  assert.equal(normalizeBindAddress('::'), '0.0.0.0');
  assert.equal(normalizeBindAddress('999.1.1.1'), '0.0.0.0');
  assert.equal(normalizeBindAddress('evil; rm -rf'), '0.0.0.0');
  assert.equal(localConnectHost('0.0.0.0'), '127.0.0.1');
  assert.equal(localConnectHost('127.0.0.1'), '127.0.0.1');
  assert.equal(localConnectHost('192.168.1.20'), '192.168.1.20');
});

test('reachableAddresses narrows advertised addresses to the bind scope', () => {
  const lanAddresses = ['192.168.1.20', '10.0.0.4'];
  assert.deepEqual(reachableAddresses('0.0.0.0', lanAddresses), lanAddresses);
  assert.deepEqual(reachableAddresses('127.0.0.1', lanAddresses), ['127.0.0.1']);
  assert.deepEqual(reachableAddresses('10.0.0.4', lanAddresses), ['10.0.0.4']);
  // A configured NIC that disappeared still advertises itself (URL is honest
  // about what the listener is bound to) instead of widening to everything.
  assert.deepEqual(reachableAddresses('172.16.0.9', lanAddresses), ['172.16.0.9']);
});

test('a loopback bind listens on 127.0.0.1 only and narrows the advertised urls', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const gateway = new RemoteGateway({
    getConfig: () => ({
      remoteEnabled: true,
      remoteToken: token,
      remoteMode: 'lan',
      remoteBindAddress: '127.0.0.1',
    }),
  });
  try {
    await gateway.start({
      port: 0,
      token,
      target: { port: upstreamPort },
      bindAddress: '127.0.0.1',
    });
    assert.equal(gateway.server.address().address, '127.0.0.1');
    const snap = gateway.snapshot();
    assert.equal(snap.bindAddress, '127.0.0.1');
    assert.deepEqual(snap.urls.map((row) => row.address), ['127.0.0.1']);
    assert.equal(snap.urls[0].url.startsWith('http://127.0.0.1:'), true);
    const allowed = await request(gateway.port, '/api/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(allowed.status, 200);
  } finally {
    await gateway.stop();
    await close(upstream);
  }
});

test('sync restarts the listener when the bind address or TLS switch changes', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const stored = {
    remoteEnabled: true,
    remoteToken: token,
    remoteMode: 'lan',
    remoteBindAddress: '0.0.0.0',
    remoteLanTls: false,
  };
  const gateway = new RemoteGateway({
    getTarget: () => ({ port: upstreamPort }),
    getConfig: () => ({ ...stored }),
    saveConfig: (patch) => Object.assign(stored, patch),
  });
  try {
    await gateway.start({ port: 0, token, target: { port: upstreamPort } });
    stored.remotePort = gateway.port;
    await gateway.sync();
    const firstServer = gateway.server;
    assert.equal(gateway.bindAddress, '0.0.0.0');

    stored.remoteBindAddress = '127.0.0.1';
    await gateway.sync();
    assert.notEqual(gateway.server, firstServer);
    assert.equal(gateway.server.address().address, '127.0.0.1');
    assert.equal(gateway.tlsActive, false);

    const narrowed = gateway.server;
    stored.remoteLanTls = true;
    await gateway.sync();
    assert.notEqual(gateway.server, narrowed);
    assert.equal(gateway.tlsActive, true);
    assert.match(gateway.tlsFingerprint, /^[0-9a-f]{64}$/);
  } finally {
    await gateway.stop();
    await close(upstream);
  }
});

function httpsRequest(port, path, options = {}) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const request = https.request({
      host: '127.0.0.1',
      port,
      path,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,
    }, (response) => {
      const peer = response.socket.getPeerCertificate();
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        body,
        fingerprint: require('crypto').createHash('sha256').update(peer.raw).digest('hex'),
      }));
    });
    request.on('error', reject);
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

test('LAN TLS serves https, pins the advertised fingerprint, and puts fp into the offer', async () => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('tls-proxied');
  });
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const config = memoryConfig({
    remoteEnabled: true,
    remoteToken: token,
    remoteMode: 'lan',
    remoteLanTls: true,
    remoteDevices: [],
  });
  const gateway = new RemoteGateway(config);
  try {
    await gateway.start({ port: 0, token, target: { port: upstreamPort }, tls: true });
    const snap = gateway.snapshot();
    assert.equal(snap.lanTls, true);
    assert.match(snap.tlsFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(snap.urls.every((row) => row.url.startsWith('https://')), true);
    assert.equal(snap.urls.every((row) => row.pairingUrl.startsWith('https://')), true);
    const offer = offerFromHash(new URL(snap.urls[0].pairingUrl).hash);
    assert.equal(offer.token, token);
    assert.equal(offer.fp, snap.tlsFingerprint);

    const denied = await httpsRequest(gateway.port, '/api/ping');
    assert.equal(denied.status, 401);
    const allowed = await httpsRequest(gateway.port, '/api/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body, 'tls-proxied');
    assert.equal(allowed.fingerprint, snap.tlsFingerprint);
  } finally {
    await gateway.stop();
    await close(upstream);
  }
});

test('relay mode never wraps the local server in TLS even when remoteLanTls is on', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const hostToken = generateToken();
  const relay = insecureRelay(hostToken);
  const relayPort = await relay.listen(0, '127.0.0.1');
  const stored = {
    remoteEnabled: true,
    remoteToken: token,
    remoteMode: 'relay',
    remoteLanTls: true,
    remoteRelayUrl: `http://127.0.0.1:${relayPort}`,
    remoteRelayToken: hostToken,
  };
  const gateway = new RemoteGateway({
    getTarget: () => ({ port: upstreamPort }),
    getConfig: () => ({ ...stored }),
    saveConfig: (patch) => Object.assign(stored, patch),
    relayOptions: { allowInsecureHttp: true },
  });
  try {
    await gateway.start({ port: 0, token, target: { port: upstreamPort } });
    stored.remotePort = gateway.port;
    await gateway.sync();
    assert.equal(gateway.tlsActive, false);
    assert.equal(gateway.snapshot().lanTls, false);
    assert.equal(gateway.relay.connected, true);
    const viaRelay = await request(relayPort, '/api/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(viaRelay.status, 200);
  } finally {
    await gateway.stop();
    await relay.close();
    await close(upstream);
  }
});

test('offer with a TLS fingerprint round-trips and stays optional', () => {
  const withFp = decodeOffer(encodeOffer({ v: 1, token: 'secret', mode: 'lan', fp: 'ab'.repeat(32) }));
  assert.equal(withFp.fp, 'ab'.repeat(32));
  const withoutFp = decodeOffer(encodeOffer({ v: 1, token: 'secret', mode: 'lan' }));
  assert.equal(withoutFp.fp, '');
  const url = pairingUrl('10.0.0.4', 3180, 'abc', { tls: true, fp: 'cd'.repeat(32) });
  assert.equal(url.startsWith('https://10.0.0.4:3180/#offer='), true);
  assert.equal(offerFromHash(new URL(url).hash).fp, 'cd'.repeat(32));
  // Plaintext pairing URLs never carry a fingerprint.
  const plain = pairingUrl('10.0.0.4', 3180, 'abc', { fp: 'cd'.repeat(32) });
  assert.equal(plain.startsWith('http://'), true);
  assert.equal(offerFromHash(new URL(plain).hash).fp, '');
});

test('login page auto-login rejection re-serves the form with the error line intact', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const config = memoryConfig({ remoteToken: token, remoteDevices: [] });
  const gateway = new RemoteGateway(config);
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  const port = gateway.port;

  const denied = await request(port, '/__remote__/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'token=wrong-token',
    redirect: 'manual',
  });
  assert.equal(denied.status, 401);
  assert.match(denied.body, /login-error/);
  assert.match(denied.body, /访问令牌/);

  await gateway.stop();
  await close(upstream);
});

test('relay answers a host upgrade with a malformed cookie instead of crashing', async () => {
  const relay = insecureRelay(generateToken() + generateToken());
  const port = await relay.listen(0, '127.0.0.1');
  try {
    const reply = await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write(
        'GET /__dsh__/host HTTP/1.1\r\nHost: relay\r\nConnection: Upgrade\r\nUpgrade: dsh-relay\r\nCookie: dsh_remote=%E0%A4%A\r\n\r\n',
      ));
      socket.once('data', (data) => { resolve(data.toString().split('\r\n')[0]); socket.destroy(); });
      socket.once('error', reject);
    });
    assert.equal(reply, 'HTTP/1.1 401 Unauthorized');
  } finally {
    await relay.close();
  }
});

test('gateway answers a malformed cookie with 401 instead of an uncaught error', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const gateway = new RemoteGateway({
    getTarget: () => ({ port: upstreamPort }),
    getConfig: () => ({ remoteEnabled: true, remoteToken: token, remoteMode: 'lan' }),
  });
  try {
    await gateway.start({ port: 0, token, target: { port: upstreamPort }, bindAddress: '127.0.0.1' });
    const reply = await request(gateway.server.address().port, '/api/x', { headers: { cookie: 'dsh_remote=%E0%A4%A' } });
    assert.equal(reply.status, 401);
  } finally {
    await gateway.stop();
    await close(upstream);
  }
});
