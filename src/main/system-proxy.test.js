const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { once } = require('node:events');
const Module = require('node:module');
const { agentFor, systemFetch, parseProxyRule, withNetworkCode, TunnelAgent } = require('./system-proxy');

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
