'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { platformBounds, mergePlatformCookies, platformClientHeaders } = require('./platform-view');
const { fetchPlatformSession, platformToken } = require('./platform-session');
const { storeInternalSecrets, INTERNAL_SECRETS_KEY } = require('../shared/secret');

test('platformBounds validates finite nonnegative coordinates', () => {
  assert.deepEqual(platformBounds({ x: 1.6, y: 2.2, width: 100, height: 50 }), { x: 2, y: 2, width: 100, height: 50 });
  assert.throws(() => platformBounds(null), /Invalid Platform bounds/);
  assert.throws(() => platformBounds({ x: -1, y: 0, width: 1, height: 1 }), /Invalid Platform bounds/);
  assert.throws(() => platformBounds({ x: 0, y: 0, width: Number.NaN, height: 1 }), /Invalid Platform bounds/);
});

test('mergePlatformCookies dedupes by name, override wins', () => {
  assert.equal(mergePlatformCookies('a=1; b=2', 'b=9; c=3'), 'a=1; b=9; c=3');
  assert.equal(mergePlatformCookies('', 'x=1'), 'x=1');
});

test('platformClientHeaders marks win32 desktop identity', () => {
  const h = platformClientHeaders('win32', { version: '0.3.3', locale: 'zh-CN', timezoneOffsetSeconds: 28800 });
  assert.equal(h['x-client-platform'], 'desktop-win');
  assert.equal(h['x-client-version'], '0.3.3');
  assert.equal(h['x-client-locale'], 'zh_CN');
  assert.equal(h['x-client-timezone-offset'], '28800');
  const web = platformClientHeaders(null, { version: '0.3.3', locale: 'en-US', timezoneOffsetSeconds: 0 });
  assert.equal(web['x-client-platform'], 'web');
  assert.equal(web['x-client-locale'], 'en_US');
});

test('publisher route: token-gated session read', async () => {
  const { createPlatformHandler } = await import(pathToFileURL(path.join(
    __dirname, '..', '..', 'vendor', 'dsh-platform-session', 'lib', 'http.js')).href);
  const handler = createPlatformHandler({ token: 'tok', read: async () => ({ token: 't', origin: 'https://platform.deepseek.com' }) });
  const run = async (auth) => {
    const res = { statusCode: 0, writeHead(s, h) { this.statusCode = s; this.headers = h; }, body: null,
      end(p) { this.body = p; } };
    await handler({ method: 'GET', url: '/dshd-platform/session', headers: auth ? { authorization: `Bearer ${auth}` } : {} }, res);
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  assert.equal((await run('tok')).body.session.token, 't');
  assert.equal((await run('wrong')).status, 401);
  assert.equal((await run('')).status, 401);
});

test('fetchPlatformSession returns session or null', async () => {
  const session = { token: 't', origin: 'https://platform.deepseek.com' };
  const ok = await fetchPlatformSession('http://127.0.0.1:3080/', async (url, init) => ({
    ok: true,
    json: async () => ({ session }),
  }));
  assert.deepEqual(ok, session);
  const bad = await fetchPlatformSession('http://127.0.0.1:3080', async () => ({ ok: false }));
  assert.equal(bad, null);
});

test('publisher resolves the live account after late startup and service replacement', async (t) => {
  const { apply } = await import(pathToFileURL(path.join(
    __dirname, '..', '..', 'vendor', 'dsh-platform-session', 'lib', 'index.js')).href);
  // The plugin reads its Bearer token from the in-process store (#427), so
  // the test seeds it instead of env and restores the previous store after.
  const previousStore = globalThis[INTERNAL_SECRETS_KEY];
  storeInternalSecrets([['DSHD_PLATFORM_TOKEN', 'publisher-test']]);
  t.after(() => { globalThis[INTERNAL_SECRETS_KEY] = previousStore; });
  let handler;
  const services = new Map([['webServer', { register(route) { handler = route.handler; } }]]);
  apply({ get: name => services.get(name), on() {} });
  const read = async () => {
    let result;
    await handler({ method: 'GET', url: '/dshd-platform/session',
      headers: { authorization: 'Bearer publisher-test' } }, {
      writeHead(status) { assert.equal(status, 200); },
      end(body) { result = JSON.parse(body).session; },
    });
    return result;
  };
  assert.equal(await read(), null);
  const first = { token: 'first-test-token', origin: 'https://platform.deepseek.com' };
  services.set('deepseekAccount', { getPlatformSession: async () => first });
  assert.deepEqual(await read(), first, 'logged-in account must become available after route registration');
  const replacement = { ...first, token: 'replacement-test-token' };
  services.set('deepseekAccount', { getPlatformSession: async () => replacement });
  assert.deepEqual(await read(), replacement);
  services.delete('deepseekAccount');
  assert.equal(await read(), null, 'removed account must not retain credentials');
});
