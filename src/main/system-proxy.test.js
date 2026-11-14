const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { once } = require('node:events');
const Module = require('node:module');
const {
  agentFor, systemFetch, parseProxyRule, withNetworkCode, TunnelAgent,
  parseUpdateProxy, normalizeUpdateProxy, setUpdateProxy, hasUpdateProxy,
} = require('./system-proxy');

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return server.address().port;
}

test('parseProxyRule keeps only a leading plain HTTP proxy', () => {
  assert.deepEqual(parseProxyRule('PROXY 127.0.0.1:10808'), { host: '127.0.0.1', port: 10808 });
  assert.deepEqual(parseProxyRule('PROXY proxy.lan:8080; DIRECT'), { host: 'proxy.lan', port: 8080 });
  assert.deepEqual(parseProxyRule('PROXY [::1]:7890'), { host: '::1', port: 7890 });
  assert.equal(parseProxyRule('DIRECT'), null);
  assert.equal(parseProxyRule('SOCKS5 127.0.0.1:1080'), null);
  assert.equal(parseProxyRule('DIRECT; PROXY 127.0.0.1:8080'), null);
  assert.equal(parseProxyRule(''), null);
});

test('Chromium net errors gain the Node codes the retry policy understands', () => {
  assert.equal(withNetworkCode(new Error('net::ERR_CONNECTION_RESET')).code, 'ECONNRESET');
  assert.equal(withNetworkCode(new Error('net::ERR_CONNECTION_TIMED_OUT')).code, 'ETIMEDOUT');
  assert.equal(withNetworkCode(new Error('net::ERR_PROXY_CONNECTION_FAILED')).code, 'ECONNREFUSED');
  assert.equal(withNetworkCode(new Error('net::ERR_CERT_DATE_INVALID')).code, 'ERR_CERT_DATE_INVALID');
  assert.equal(withNetworkCode(Object.assign(new Error('net::ERR_TIMED_OUT'), { code: 'KEEP' })).code, 'KEEP');
  assert.equal(withNetworkCode(new Error('plain')).code, undefined);
});

test('outside a ready Electron app requests stay direct on global fetch', async (t) => {
  assert.equal(await agentFor('https://github.com/x'), null);
  t.mock.method(global, 'fetch', async (url) => ({ ok: true, url }));
  assert.equal((await systemFetch('https://example.test/a')).url, 'https://example.test/a');
});

test('the tunnel CONNECTs to the target authority and starts TLS with its SNI', async (t) => {
  let hello;
  const target = net.createServer((socket) => socket.once('data', (chunk) => { hello = chunk; socket.destroy(); }));
  const targetPort = await listen(t, target);
  let requested;
  const proxy = http.createServer();
  proxy.on('connect', (request, client) => {
    requested = request.url;
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(client).pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  const proxyPort = await listen(t, proxy);

  const agent = new TunnelAgent({ host: '127.0.0.1', port: proxyPort });
  const request = https.get('https://release.example.test:8443/file', { agent });
  const [error] = await once(request, 'error');
  assert.ok(error);
  assert.equal(requested, 'release.example.test:8443');
  assert.equal(hello[0], 0x16, 'TLS handshake record');
  assert.ok(hello.includes(Buffer.from('release.example.test')), 'SNI names the target host');
});

test('proxy refusals surface as tunnel or auth errors', async (t) => {
  for (const [status, code] of [[502, 'ERR_PROXY_TUNNEL'], [407, 'ERR_PROXY_AUTH']]) {
    const proxy = http.createServer();
    proxy.on('connect', (_request, client) => client.end(`HTTP/1.1 ${status} No\r\n\r\n`));
    const port = await listen(t, proxy);
    const request = https.get('https://example.test/file', { agent: new TunnelAgent({ host: '127.0.0.1', port }) });
    const [error] = await once(request, 'error');
    assert.equal(error.code, code);
    assert.equal(error.proxyFailure, true);
  }
  const closed = net.createServer();
  const port = await listen(t, closed);
  closed.close();
  await once(closed, 'close');
  const request = https.get('https://example.test/file', { agent: new TunnelAgent({ host: '127.0.0.1', port }) });
  const [error] = await once(request, 'error');
  assert.equal(error.code, 'ECONNREFUSED');
  assert.equal(error.proxyFailure, true);
});

test('inside Electron, fetch follows net and drops to direct only when the proxy fails', async (t) => {
  let netError;
  const netCalls = [];
  const electron = { app: { isReady: () => true }, net: { fetch: async (url, init) => {
    netCalls.push(init);
    if (netError) throw new Error(netError);
    return { ok: true, via: 'net' };
  } } };
  const load = Module._load;
  t.mock.method(Module, '_load', function (id, ...args) {
    return id === 'electron' ? electron : load.call(this, id, ...args);
  });
  t.mock.method(global, 'fetch', async () => ({ ok: true, via: 'direct' }));

  assert.equal((await systemFetch('https://example.test/a', { headers: { A: '1' } })).via, 'net');
  assert.deepEqual(netCalls[0], { cache: 'no-store', headers: { A: '1' } });
  netError = 'net::ERR_PROXY_CONNECTION_FAILED';
  assert.equal((await systemFetch('https://example.test/a')).via, 'direct');
  netError = 'net::ERR_CONNECTION_RESET';
  await assert.rejects(systemFetch('https://example.test/a'), { code: 'ECONNRESET' });
  assert.equal(global.fetch.mock.callCount(), 1);
});

test('an update proxy must be a bare plain HTTP host and port', () => {
  assert.equal(normalizeUpdateProxy(''), '');
  assert.equal(normalizeUpdateProxy('  '), '');
  assert.equal(normalizeUpdateProxy('127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.equal(normalizeUpdateProxy('http://proxy.lan:8080'), 'http://proxy.lan:8080');
  assert.equal(normalizeUpdateProxy('http://proxy.lan:80'), 'http://proxy.lan:80');
  assert.equal(normalizeUpdateProxy('proxy.lan:080'), 'http://proxy.lan:80');
  assert.equal(normalizeUpdateProxy('[::1]:7890'), 'http://[::1]:7890');
  assert.deepEqual(parseUpdateProxy('[::1]:7890'), { host: '::1', port: 7890, url: 'http://[::1]:7890' });
  for (const bad of ['socks5://127.0.0.1:1080', 'https://proxy.lan:443', 'http://user:pass@proxy.lan:8080',
    '127.0.0.1', 'http://proxy.lan:0', 'http://proxy.lan:8080/path', 'http://proxy.lan:8080?x=1', '::::', 'http://']) {
    assert.throws(() => normalizeUpdateProxy(bad), /更新代理/, bad);
  }
});

test('an update proxy replaces the system decision and an invalid one changes nothing', async (t) => {
  t.after(() => setUpdateProxy(''));
  assert.equal(hasUpdateProxy(), false);
  await setUpdateProxy('127.0.0.1:7890');
  assert.equal(hasUpdateProxy(), true);
  const agent = await agentFor('https://github.com/x');
  assert.ok(agent instanceof TunnelAgent);
  assert.deepEqual({ host: agent.proxy.host, port: agent.proxy.port }, { host: '127.0.0.1', port: 7890 });
  assert.equal(await agentFor('http://plain.example.test/x'), null, 'only https goes through the tunnel');
  await assert.rejects(setUpdateProxy('socks5://127.0.0.1:1080'), /只支持普通 HTTP/);
  assert.equal(hasUpdateProxy(), true, 'the previous proxy stays in force');
  assert.equal((await agentFor('https://github.com/x')).proxy.port, 7890);
  await setUpdateProxy('');
  assert.equal(hasUpdateProxy(), false);
  assert.equal(await agentFor('https://github.com/x'), null);
});

test('inside Electron the update proxy is set on the updater session and its failures never go direct', async (t) => {
  t.after(() => setUpdateProxy(''));
  const proxyCalls = [];
  const fetchCalls = [];
  let netError;
  const updaterSession = {
    setProxy: async (config) => { proxyCalls.push(config); },
    fetch: async (url, init) => {
      fetchCalls.push([url, init]);
      if (netError) throw new Error(netError);
      return { ok: true, via: 'updater-session' };
    },
  };
  const electron = { app: { isReady: () => true }, net: { fetch: async () => ({ ok: true, via: 'default-net' }) } };
  const load = Module._load;
  t.mock.method(Module, '_load', function (id, ...args) {
    if (id === 'electron') return electron;
    if (id === 'electron-updater/out/electronHttpExecutor') return { getNetSession: () => updaterSession };
    return load.call(this, id, ...args);
  });
  t.mock.method(global, 'fetch', async () => ({ ok: true, via: 'direct' }));

  await setUpdateProxy('127.0.0.1:7890');
  assert.deepEqual(proxyCalls, [{ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890' }]);
  assert.equal((await systemFetch('https://example.test/a')).via, 'updater-session');
  assert.deepEqual(fetchCalls[0], ['https://example.test/a', { cache: 'no-store' }]);
  netError = 'net::ERR_PROXY_CONNECTION_FAILED';
  await assert.rejects(systemFetch('https://example.test/a'), (error) => {
    assert.equal(error.code, 'ERR_UPDATE_PROXY');
    assert.match(error.message, /无法通过更新代理 http:\/\/127\.0\.0\.1:7890 连接/);
    assert.doesNotMatch(error.message, /net::/);
    return true;
  });
  assert.equal(global.fetch.mock.callCount(), 0, 'a user-chosen proxy is not bypassed');
  netError = 'net::ERR_CONNECTION_RESET';
  await assert.rejects(systemFetch('https://example.test/a'), { code: 'ECONNRESET' }, 'non-proxy failures keep their own code');

  await setUpdateProxy('');
  assert.deepEqual(proxyCalls.at(-1), { mode: 'system' });
  netError = undefined;
  assert.equal((await systemFetch('https://example.test/a')).via, 'default-net');
});

test('a failed or concurrent proxy change leaves the saved choice and the updater session in agreement', async (t) => {
  t.after(() => setUpdateProxy(''));
  const applied = [];
  let failNext = false;
  let slowFirst = true;
  const updaterSession = { setProxy: async (config) => {
    if (failNext) { failNext = false; throw new Error('session refused'); }
    if (slowFirst) { slowFirst = false; await new Promise((resolve) => setTimeout(resolve, 20)); }
    applied.push(config.proxyRules || config.mode);
  } };
  const electron = { app: { isReady: () => true } };
  const load = Module._load;
  t.mock.method(Module, '_load', function (id, ...args) {
    if (id === 'electron') return electron;
    if (id === 'electron-updater/out/electronHttpExecutor') return { getNetSession: () => updaterSession };
    return load.call(this, id, ...args);
  });

  // The slow first change must not be overtaken by the second: last call wins on both sides.
  await Promise.all([setUpdateProxy('127.0.0.1:1111'), setUpdateProxy('127.0.0.1:2222')]);
  assert.deepEqual(applied, ['http://127.0.0.1:1111', 'http://127.0.0.1:2222']);
  assert.equal((await agentFor('https://github.com/x')).proxy.port, 2222);

  failNext = true;
  await assert.rejects(setUpdateProxy('127.0.0.1:3333'), /session refused/);
  assert.equal((await agentFor('https://github.com/x')).proxy.port, 2222, 'a refused session leaves the previous choice');
});
