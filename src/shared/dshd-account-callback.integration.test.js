'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { createServer } = require('node:https');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { generateTlsMaterial } = require('../main/remote-tls.js');
const { forwardHostRpc } = require('./dshd-host-tunnel.js');

// A prepared checkout may be supplied for a local probe; CI uses its own built vendor artifacts.
const harnessRoot = path.resolve(process.env.DSH_ACCOUNT_INTEGRATION_ROOT || path.join(__dirname, '../../vendor/deepseek-harness'));
const VENDOR_RUNNABLE = [
  'packages/credentials/deepseek-account-platform/lib/index.js',
  'packages/credentials/credentials-local/lib/index.js',
  'packages/credentials/authorization/lib/index.js',
  'packages/credentials/credentials/lib/index.js',
  'packages/host/webserver/lib/index.js',
  'packages/credentials/deepseek-account-platform/node_modules',
].every(relative => existsSync(path.join(harnessRoot, relative)));
const VENDOR_HINT = 'Harness account dist/dependencies missing (prepare vendor artifacts before this integration check)';
// node --test isolates files in child processes; keep this file serial while its fixture owns the trusted dispatcher.
const options = { skip: VENDOR_RUNNABLE ? false : VENDOR_HINT, timeout: 30_000, concurrency: false };

async function fixture(t, attemptTimeoutMs = 5_000) {
  const load = (relative) => import(pathToFileURL(path.join(harnessRoot, relative)).href);
  const resolver = createRequire(path.join(harnessRoot, 'packages/credentials/deepseek-account-platform/package.json'));
  const [cordis, accountModule, credentialsModule, authorizationModule, webModule, keys] = await Promise.all([
    import(pathToFileURL(resolver.resolve('@deepseek-ai/cordis')).href),
    load('packages/credentials/deepseek-account-platform/lib/index.js'),
    load('packages/credentials/credentials-local/lib/index.js'),
    load('packages/credentials/authorization/lib/index.js'),
    load('packages/host/webserver/lib/index.js'),
    load('packages/credentials/credentials/lib/index.js'),
  ]);
  const { Agent, getGlobalDispatcher, setGlobalDispatcher } = resolver('undici');
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-native-callback-integration-'));
  const material = generateTlsMaterial();
  const previousDispatcher = getGlobalDispatcher();
  const dispatcher = new Agent({ connect: { ca: material.cert } });
  setGlobalDispatcher(dispatcher);
  const requests = [];
  const serverErrors = [];
  let initialization;
  let refuseExchange = false;
  const token = `dsh_mock_bridge_${randomUUID()}`;
  let origin;
  const server = createServer({ key: material.key, cert: material.cert }, (req, res) => {
    void (async () => {
      let text = '';
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text || '{}');
      const method = req.url.split('/').pop();
      requests.push({ method, body });
      assert.equal(req.method, 'POST');
      let value;
      if (method === 'auth_init') {
        assert.equal(body.code_challenge_method, 'S256');
        assert.match(body.code_challenge, /^[A-Za-z0-9_-]{43}$/);
        assert.match(body.state, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(body.code_verifier, undefined);
        assert.equal(body.login_source, 'web');
        initialization = body;
        value = { authorize_url: `${origin}/dsh/authorize?authorize_id=bridge-test`, authorize_id: 'bridge-test', expires_in: 600 };
      } else if (method === 'auth_exchange' || method === 'auth_cancel') {
        assert.ok(initialization);
        const derived = createHash('sha256').update(body.code_verifier).digest('base64url');
        assert.equal(derived, initialization.code_challenge);
        if (method === 'auth_exchange') {
          assert.equal(body.redirect_uri, initialization.redirect_uri);
          assert.equal(body.code, 'test-authorization-code');
          assert.match(body.device_id, /^[0-9a-f-]{36}$/);
          if (refuseExchange) {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 0, data: { biz_code: 17, biz_data: null } }));
            return;
          }
          value = { token, authorized_url: `${origin}/dsh/authorized?result=bridge-test`, user: null };
        } else value = null;
      } else throw new Error('Unexpected temporary platform route');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: value } }));
    })().catch(error => { serverErrors.push(error); res.writeHead(500).end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${server.address().port}`;
  const ctx = new cordis.Context();
  const fibers = [];
  t.after(async () => {
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    setGlobalDispatcher(previousDispatcher);
    await dispatcher.close();
    assert.equal(home.startsWith(path.join(tmpdir(), 'dsh-native-callback-integration-')), true);
    await rm(home, { recursive: true, force: true });
    assert.deepEqual(serverErrors, []);
  });
  async function plugin(type, config) { const fiber = ctx.plugin(type, config); fibers.push(fiber); await fiber; }
  await plugin(webModule.default, { host: '127.0.0.1', port: 0 });
  await plugin(credentialsModule.LocalCredentialProvider, { path: path.join(home, 'credentials.yaml'), watch: false });
  await plugin(authorizationModule.default);
  await plugin(accountModule.PlatformAccount, { platformOrigin: origin, attemptTimeoutMs, requestTimeoutMs: 3_000, logoutRetryDelayMs: 1 });
  const account = ctx.deepseekAccount;
  const key = keys.credentialKey('deepseek-account-platform', 'default');
  const callbackOrigin = ctx.webServer.getOrigin();
  async function wait(phase) {
    const limit = AbortSignal.timeout(4_000);
    for await (const view of account.watch(limit)) if (view.attempt?.phase === phase) return view;
    throw new Error(`Missing account phase ${phase}`);
  }
  return {
    account, ctx, key, home, requests, token, origin, wait,
    initialization: () => initialization,
    refuseExchange: () => { refuseExchange = true; },
    async start() {
      await account.startSignIn({ version: '0.3.11', locale: 'en', timezoneOffsetSeconds: 0 }, callbackOrigin, 'web');
      return wait('waiting-browser');
    },
    complete(state = initialization.state) {
      return forwardHostRpc({ origin: callbackOrigin, method: 'account.completeSignIn',
        payload: { args: { code: 'test-authorization-code', state } }, signal: AbortSignal.timeout(4_000) });
    },
  };
}

test('native virtual callback rejects wrong state then commits the real provider grant before reporting its 302', options, async t => {
  const f = await fixture(t);
  await f.start();
  const wrong = await f.complete('wrong-state');
  assert.equal(wrong.ok, false);
  assert.equal(await f.ctx.credentials.readRecord(f.key), undefined);
  assert.equal(f.requests.filter(r => r.method === 'auth_exchange').length, 0);
  assert.equal((await f.account.getState()).attempt.phase, 'waiting-browser');
  const result = await f.complete();
  assert.equal(result.ok, true);
  assert.equal(result.value.completed, true);
  const completion = new URL(result.value.completionUrl);
  assert.equal(completion.origin, f.origin);
  assert.equal(completion.pathname, '/dsh/authorized');
  assert.equal(completion.searchParams.get('login_source'), 'web');
  assert.equal((await f.account.getState()).status, 'credential-stored');
  const stored = await f.ctx.credentials.readRecord(f.key);
  assert.equal(stored.kind, 'grant');
  assert.equal(stored.payload.token, f.token);
  assert.equal(stored.payload.issuer, f.origin);
  assert.equal((await readFile(path.join(f.home, 'credentials.yaml'), 'utf8')).includes(f.token), true);
  assert.equal(f.requests.filter(r => r.method === 'auth_exchange').length, 1);
  assert.equal(JSON.stringify(result).includes(f.token), false);
  const duplicate = await f.complete();
  assert.equal(duplicate.ok, false);
  assert.equal(f.requests.filter(r => r.method === 'auth_exchange').length, 1);
});

test('native virtual callback cannot authorize after the actual provider attempt is cancelled', options, async t => {
  const f = await fixture(t);
  const waiting = await f.start();
  const cancelled = await f.account.cancelSignIn(waiting.attempt.id);
  assert.equal(cancelled.attempt.phase, 'cancelled');
  assert.equal((await f.complete()).ok, false);
  assert.equal(await f.ctx.credentials.readRecord(f.key), undefined);
  assert.equal(f.requests.filter(r => r.method === 'auth_exchange').length, 0);
});

test('native virtual callback cannot authorize after the actual provider deadline expires', options, async t => {
  const f = await fixture(t, 400);
  await f.start();
  await f.wait('expired');
  assert.equal((await f.complete()).ok, false);
  assert.equal(await f.ctx.credentials.readRecord(f.key), undefined);
  assert.equal(f.requests.filter(r => r.method === 'auth_exchange').length, 0);
});

test('platform exchange refusal travels through the real callback and cannot persist a grant', options, async t => {
  const f = await fixture(t);
  await f.start();
  f.refuseExchange();
  const response = await f.complete();
  assert.equal(response.ok, false);
  assert.equal((await f.account.getState()).status, 'signed-out');
  assert.equal((await f.account.getState()).attempt.phase, 'failed');
  assert.equal(await f.ctx.credentials.readRecord(f.key), undefined);
  assert.equal(f.requests.filter(r => r.method === 'auth_exchange').length, 1);
});
