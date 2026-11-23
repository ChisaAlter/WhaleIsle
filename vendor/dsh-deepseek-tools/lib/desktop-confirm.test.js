import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { afterEach, describe, test } from 'node:test';
import { INTERNAL_SECRETS_KEY, storeInternalSecrets } from '../../dsh-shared/lib/internal-secret.mjs';
import {
  CHANNEL_ERROR_TEXT,
  CHANNEL_UNAVAILABLE_TEXT,
  DECLINED_TEXT,
  confirmFailureMessage,
  confirmModelAction,
  showDesktopSecret,
} from './desktop-confirm.js';

let savedEnv;
function stashEnv() {
  savedEnv ??= {
    url: process.env.DSH_DESKTOP_INSTALL_URL,
    store: globalThis[INTERNAL_SECRETS_KEY],
  };
}

function setControlEnv(url, token) {
  stashEnv();
  if (url === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
  else process.env.DSH_DESKTOP_INSTALL_URL = url;
  storeInternalSecrets(token === undefined ? [] : [['DSH_DESKTOP_INSTALL_TOKEN', token]]);
}

let activeServer = null;
async function startMockServer(handler) {
  const server = createServer(handler);
  activeServer = server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

let hooksRegistered = false;
function ensureStubs() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  const schemaStub = `data:text/javascript,${encodeURIComponent(`
    const node = new Proxy(function () {}, {
      get(_t, key) { return () => node; },
      apply() { return node; },
    });
    export default { object: () => node, string: () => node, boolean: () => node, union: () => node };
  `)}`;
  const toolFactoryName = ['define', 'Tool'].join('');
  const toolsStub = `data:text/javascript,${encodeURIComponent(`
    export function ${toolFactoryName}(definition) { return definition; }
  `)}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@deepseek-ai/schemastery') return { url: schemaStub, shortCircuit: true };
      if (specifier === '@deepseek-ai/dsh-tools') return { url: toolsStub, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}

afterEach(async () => {
  if (activeServer) {
    await new Promise((resolve) => activeServer.close(resolve));
    activeServer = null;
  }
  if (savedEnv) {
    if (savedEnv.url === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
    else process.env.DSH_DESKTOP_INSTALL_URL = savedEnv.url;
    globalThis[INTERNAL_SECRETS_KEY] = savedEnv.store;
    savedEnv = undefined;
  }
});

describe('desktop-confirm diagnostics and fail-closed contract', () => {
  const sampleRequest = {
    tool: 'deepseek_tts',
    action: 'request',
    effect: 'external',
    summary: 'sum',
    details: 'det',
  };

  test('returns channel-unavailable when control URL or token is missing', async () => {
    setControlEnv(undefined, 'tok');
    const missingUrl = await confirmModelAction(sampleRequest);
    assert.equal(missingUrl.ok, false);
    assert.equal(missingUrl.reason, 'channel-unavailable');
    assert.equal(missingUrl.error, CHANNEL_UNAVAILABLE_TEXT);
    assert.doesNotMatch(confirmFailureMessage(missingUrl), /用户拒绝/);

    setControlEnv('http://127.0.0.1:1', undefined);
    const missingToken = await showDesktopSecret({ title: 't', label: 'l', secret: 's', hint: 'h' });
    assert.equal(missingToken.ok, false);
    assert.equal(missingToken.reason, 'channel-unavailable');
  });

  test('returns channel-error on network unreachable error', async () => {
    const server = createServer((_req, res) => { res.end(); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));

    setControlEnv(`http://127.0.0.1:${port}`, 'tok');
    const result = await confirmModelAction(sampleRequest);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'channel-error');
    const message = confirmFailureMessage(result);
    assert.match(message, new RegExp(CHANNEL_ERROR_TEXT));
    assert.doesNotMatch(message, /用户拒绝/);
  });

  test('fails closed with channel-error on non-2xx HTTP status even when body says ok:true', async () => {
    const url = await startMockServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, error: 'internal error' }));
    });
    setControlEnv(url, 'tok');
    const result = await confirmModelAction(sampleRequest);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'channel-error');
    assert.equal(result.status, 500);
    assert.match(result.error, /HTTP 500/);
    assert.doesNotMatch(confirmFailureMessage(result), /用户拒绝/);
  });

  test('returns channel-error on invalid JSON or non-object payload', async () => {
    const htmlUrl = await startMockServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>oops</html>');
    });
    setControlEnv(htmlUrl, 'tok');
    const badJson = await confirmModelAction(sampleRequest);
    assert.equal(badJson.ok, false);
    assert.equal(badJson.reason, 'channel-error');
    assert.match(badJson.error, /无效 JSON/);

    await new Promise((resolve) => activeServer.close(resolve));
    activeServer = null;

    const arrayUrl = await startMockServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[]');
    });
    setControlEnv(arrayUrl, 'tok');
    const arrayReply = await confirmModelAction(sampleRequest);
    assert.equal(arrayReply.ok, false);
    assert.equal(arrayReply.reason, 'channel-error');
  });

  test('distinguishes explicit declined:true from uncategorized ok:false failures', async () => {
    const declineUrl = await startMockServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, declined: true, error: '用户拒绝了这次操作' }));
    });
    setControlEnv(declineUrl, 'tok');
    const declined = await confirmModelAction(sampleRequest);
    assert.equal(declined.ok, false);
    assert.equal(declined.reason, 'declined');
    assert.equal(declined.declined, true);
    assert.equal(confirmFailureMessage(declined), DECLINED_TEXT);

    await new Promise((resolve) => activeServer.close(resolve));
    activeServer = null;

    const unavailUrl = await startMockServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'secret display is unavailable' }));
    });
    setControlEnv(unavailUrl, 'tok');
    const nonDeclined = await showDesktopSecret({ title: 't', label: 'l', secret: 's', hint: 'h' });
    assert.equal(nonDeclined.ok, false);
    assert.equal(nonDeclined.reason, 'channel-error');
    assert.equal(nonDeclined.error, 'secret display is unavailable');
    assert.doesNotMatch(confirmFailureMessage(nonDeclined), /用户拒绝/);
  });

  test('passes { ok: true } cleanly when channel returns 200 ok:true', async () => {
    const okUrl = await startMockServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    setControlEnv(okUrl, 'tok');
    const approved = await confirmModelAction(sampleRequest);
    assert.equal(approved.ok, true);
  });

  test('dsh-deepseek-tools refuses side-effecting fetch and preserves accurate error messages', async () => {
    ensureStubs();
    const { apply } = await import('./index.js');
    const tools = new Map();
    const ctx = {
      effect() {},
      on() {},
      settings: { configure() {} },
      credentials: { resolve: async () => 'sk-test' },
      attachments: {},
      tools: {
        register(tool) {
          tools.set(tool.name, tool);
          return () => tools.delete(tool.name);
        },
      },
    };
    apply(ctx, {
      baseURL: { get: () => 'https://api.example.invalid' },
      apiKeyEnv: { get: () => 'DEEPSEEK_API_KEY' },
      tts: { get: () => true },
      asr: { get: () => false },
      ocr: { get: () => false },
      voice: { get: () => 'stella' },
      filterMarkdown: { get: () => true },
    });

    const originalFetch = globalThis.fetch;
    const hitUrls = [];
    globalThis.fetch = async (url, init) => {
      hitUrls.push(String(url));
      return originalFetch(url, init);
    };
    try {
      setControlEnv(undefined, undefined);
      await assert.rejects(
        tools.get('deepseek_tts').execute({ text: '测试' }, { signal: new AbortController().signal }),
        (err) => err instanceof Error && err.message.includes('桌面确认通道不可用') && !err.message.includes('用户拒绝'),
      );
      assert.equal(hitUrls.length, 0);

      const errUrl = await startMockServer((_req, res) => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'bad gateway' }));
      });
      setControlEnv(errUrl, 'tok');
      await assert.rejects(
        tools.get('deepseek_tts').execute({ text: '测试' }, { signal: new AbortController().signal }),
        (err) => err instanceof Error && err.message.includes('HTTP 502') && !err.message.includes('用户拒绝'),
      );
      assert.equal(hitUrls.length, 1);
      assert.ok(hitUrls[0].startsWith(errUrl));

      await new Promise((resolve) => activeServer.close(resolve));
      activeServer = null;

      const declineUrl = await startMockServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, declined: true, error: 'declined' }));
      });
      setControlEnv(declineUrl, 'tok');
      await assert.rejects(
        tools.get('deepseek_tts').execute({ text: '测试' }, { signal: new AbortController().signal }),
        (err) => err instanceof Error && err.message === DECLINED_TEXT,
      );
      assert.equal(hitUrls.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
