import test from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedError, callShell } from './remote-shell.js';

function fakeResponse({ status = 200, body = { ok: true, result: {} } } = {}) {
  return {
    status,
    async json() {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

// 对应 GitQuickShellTest.kt remoteShellPostsWhitelistNameWithBearer（Web 走 cookie 通道）。
test('callShell posts whitelisted name with cookies and unwraps result', async () => {
  const calls = [];
  const result = await callShell({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return fakeResponse({ body: { ok: true, result: { refName: 'main', isRepo: true } } });
    },
    origin: 'http://192.168.1.23:3180',
    name: 'gitStatus',
    payload: { cwd: '/ws' },
  });
  assert.equal(result.refName, 'main');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://192.168.1.23:3180/__remote__/shell/gitStatus');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { cwd: '/ws' });
});

// 对应 GitQuickShellTest.kt remoteShellRejectsUnknownName。
test('callShell rejects names outside the whitelist without touching fetch', async () => {
  let fetched = false;
  await assert.rejects(
    callShell({ fetchImpl: async () => { fetched = true; }, origin: 'http://h', name: 'writeFile' }),
    /not found/,
  );
  assert.equal(fetched, false);
});

test('callShell throws UnauthorizedError on 401/403', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      callShell({ fetchImpl: async () => fakeResponse({ status }), origin: 'http://h', name: 'gitStatus' }),
      (error) => error instanceof UnauthorizedError && error.unauthorized === true,
    );
  }
});

test('callShell normalizes 404, ok:false and non-JSON bodies into errors', async () => {
  await assert.rejects(
    callShell({ fetchImpl: async () => fakeResponse({ status: 404 }), origin: 'http://h', name: 'gitStatus' }),
    /not found/,
  );
  await assert.rejects(
    callShell({
      fetchImpl: async () => fakeResponse({ body: { ok: false, error: '工作区不可用' } }),
      origin: 'http://h',
      name: 'gitStatus',
    }),
    /工作区不可用/,
  );
  await assert.rejects(
    callShell({
      fetchImpl: async () => fakeResponse({ status: 500, body: new Error('bad json') }),
      origin: 'http://h',
      name: 'gitStatus',
    }),
    /HTTP 500/,
  );
});

test('callShell falls back to {ok:true} when result is missing', async () => {
  const result = await callShell({
    fetchImpl: async () => fakeResponse({ body: { ok: true } }),
    origin: 'http://h',
    name: 'openSettings',
  });
  assert.deepEqual(result, { ok: true });
});
