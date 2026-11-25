import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { internalSecret, INTERNAL_SECRETS_KEY } from '../lib/internal-secret.mjs';
import { controlConfig, confirmModelAction, showDesktopSecret, DECLINED_TEXT } from '../lib/desktop-confirm.js';
import { buildDelegateConfirmRequest, formatConfirmPromptSection } from '../lib/delegation.js';

function withControl(url, token, fn) {
  const prevUrl = process.env.DSH_DESKTOP_INSTALL_URL;
  const prevEnvToken = process.env.DSH_DESKTOP_INSTALL_TOKEN;
  const prevStore = globalThis[INTERNAL_SECRETS_KEY];
  if (url === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
  else process.env.DSH_DESKTOP_INSTALL_URL = url;
  delete process.env.DSH_DESKTOP_INSTALL_TOKEN;
  if (token === undefined) delete globalThis[INTERNAL_SECRETS_KEY];
  else globalThis[INTERNAL_SECRETS_KEY] = Object.freeze({ get: (name) => (name === 'DSH_DESKTOP_INSTALL_TOKEN' ? token : undefined) });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevUrl === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
      else process.env.DSH_DESKTOP_INSTALL_URL = prevUrl;
      if (prevEnvToken === undefined) delete process.env.DSH_DESKTOP_INSTALL_TOKEN;
      else process.env.DSH_DESKTOP_INSTALL_TOKEN = prevEnvToken;
      if (prevStore === undefined) delete globalThis[INTERNAL_SECRETS_KEY];
      else globalThis[INTERNAL_SECRETS_KEY] = prevStore;
    });
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('internalSecret never falls back to process.env and fails closed when absent', async () => {
  const prevEnv = process.env.DSH_DESKTOP_INSTALL_TOKEN;
  const prevStore = globalThis[INTERNAL_SECRETS_KEY];
  try {
    delete globalThis[INTERNAL_SECRETS_KEY];
    process.env.DSH_DESKTOP_INSTALL_TOKEN = 'leaked-in-env';
    assert.equal(internalSecret('DSH_DESKTOP_INSTALL_TOKEN'), '');
    globalThis[INTERNAL_SECRETS_KEY] = Object.freeze({ get: (name) => (name === 'DSH_DESKTOP_INSTALL_TOKEN' ? 'real-in-memory' : undefined) });
    assert.equal(internalSecret('DSH_DESKTOP_INSTALL_TOKEN'), 'real-in-memory');
    assert.equal(internalSecret('OTHER_SECRET'), '');
  } finally {
    if (prevEnv === undefined) delete process.env.DSH_DESKTOP_INSTALL_TOKEN;
    else process.env.DSH_DESKTOP_INSTALL_TOKEN = prevEnv;
    if (prevStore === undefined) delete globalThis[INTERNAL_SECRETS_KEY];
    else globalThis[INTERNAL_SECRETS_KEY] = prevStore;
  }
});

test('controlConfig strictly enforces loopback http URLs without credentials, query, or hash', async () => {
  await withControl(undefined, 'tok', () => assert.equal(controlConfig(), null));
  await withControl('http://127.0.0.1:8080', undefined, () => assert.equal(controlConfig(), null));
  for (const bad of [
    'https://127.0.0.1:8080',
    'http://example.com:8080',
    'http://192.168.1.10:8080',
    'http://user:pass@127.0.0.1:8080',
    'http://127.0.0.1:8080?x=1',
    'http://127.0.0.1:8080#frag',
    'not a url',
  ]) {
    await withControl(bad, 'tok', () => assert.equal(controlConfig(), null, `must reject ${bad}`));
  }
  await withControl('http://127.0.0.1:8080/', 'tok', () => {
    assert.deepEqual(controlConfig(), { url: 'http://127.0.0.1:8080', token: 'tok' });
  });
  await withControl('http://localhost:8080', 'tok', () => {
    assert.deepEqual(controlConfig(), { url: 'http://localhost:8080', token: 'tok' });
  });
});

test('confirmModelAction and showDesktopSecret fail closed on decline, HTTP error, redirect, invalid JSON, network error, and abort', async () => {
  // Missing channel fails closed
  await withControl(undefined, undefined, async () => {
    assert.deepEqual(await confirmModelAction({ tool: 'acp_delegate' }), { ok: false });
    assert.deepEqual(await showDesktopSecret({ title: 'T', secret: 'S' }), { ok: false });
  });

  let mode = 'allow';
  let lastRequest = null;
  let holdResponse = null;
  const srv = await startServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      lastRequest = {
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      };
      if (mode === 'allow') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      } else if (mode === 'decline') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":false}');
      } else if (mode === 'http401') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      } else if (mode === 'http500') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      } else if (mode === 'redirect') {
        res.writeHead(302, { location: 'http://127.0.0.1:1/steal' });
        res.end();
      } else if (mode === 'badjson') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('not json');
      } else if (mode === 'hang') {
        holdResponse = res;
      }
    });
  });

  try {
    await withControl(srv.url, 'secret-token', async () => {
      mode = 'allow';
      assert.deepEqual(await confirmModelAction({ tool: 'acp_delegate', action: 'delegate', summary: 'S', details: 'D' }), { ok: true });
      assert.equal(lastRequest.url, '/desktop/confirm');
      assert.equal(lastRequest.auth, 'Bearer secret-token');

      assert.deepEqual(await showDesktopSecret({ title: 'Key', label: 'API', secret: 'val', hint: 'save' }), { ok: true });
      assert.equal(lastRequest.url, '/desktop/show-secret');
      assert.equal(lastRequest.body.secret, 'val');

      for (const failMode of ['decline', 'http401', 'http500', 'redirect', 'badjson']) {
        mode = failMode;
        assert.deepEqual(
          await confirmModelAction({ tool: 'acp_delegate' }),
          { ok: false },
          `mode=${failMode} must fail closed`,
        );
      }

      // AbortSignal cancels an in-flight confirmation immediately
      mode = 'hang';
      const ac = new AbortController();
      const started = Date.now();
      setTimeout(() => ac.abort(new Error('turn cancelled')), 40);
      const aborted = await confirmModelAction({ tool: 'acp_delegate' }, { signal: ac.signal });
      assert.deepEqual(aborted, { ok: false });
      assert.ok(Date.now() - started < 3000, 'external AbortSignal must abort confirmation promptly');
      holdResponse?.destroy();
    });

    // Unreachable port fails closed
    await srv.close();
    await withControl(srv.url, 'secret-token', async () => {
      assert.deepEqual(await confirmModelAction({ tool: 'acp_delegate' }), { ok: false });
    });
  } finally {
    holdResponse?.destroy();
    await srv.close().catch(() => {});
  }
  assert.ok(DECLINED_TEXT.length > 0);
});

test('buildDelegateConfirmRequest surfaces effective parameters and marks >2000 char prompt truncation explicitly', () => {
  const shortReq = buildDelegateConfirmRequest(
    { agent: 'codex', prompt: 'Inspect repo', model: 'gpt-5', isolation: 'worktree', runtime_mode: 'read-only', interaction_mode: 'plan' },
    { resolvedCwd: '/workspace/proj', effectiveModel: 'gpt-5' },
  );
  assert.equal(shortReq.tool, 'acp_delegate');
  assert.match(shortReq.details, /\/workspace\/proj/);
  assert.match(shortReq.details, /gpt-5/);
  assert.match(shortReq.details, /worktree/);
  assert.match(shortReq.details, /read-only/);
  assert.match(shortReq.details, /plan/);
  assert.doesNotMatch(shortReq.details, /截断/);

  const longPrompt = `${'A'.repeat(2100)}HIDDEN_TAIL_INSTRUCTION`;
  const formatted = formatConfirmPromptSection(longPrompt);
  assert.match(formatted, /已省略|前 2000 字符/);
  assert.match(formatted, /HIDDEN_TAIL_INSTRUCTION/);
});
