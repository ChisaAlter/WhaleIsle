'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {
  startDesktopInstallControl,
  stopDesktopInstallControl,
  desktopInstallReady,
  desktopInstallEnv,
} = require('./desktop-install-control');
const { DshManager } = require('./dsh');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');

async function postInstall(url, token, body) {
  return fetch(new URL('/install', url), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body,
  });
}

describe('desktop install control', { concurrency: false }, () => {
  afterEach(() => {
    stopDesktopInstallControl();
    clearDesktopDshHome();
  });

  test('a successful install responds before Harness restart is scheduled', async () => {
    const order = [];
    startDesktopInstallControl({
      confirmModelAction: async () => true,
      installPlugin: async (spec, options) => {
        order.push(`install:${spec}:${(options.allowBuilds || []).join(',')}`);
        return { ok: true, spec: `${spec}#sha`, log: 'added' };
      },
      startHarness: async () => {
        order.push('restart');
      },
      restartDelayMs: 40,
    });
    const { url, token } = await desktopInstallReady();
    const response = await postInstall(url, token, JSON.stringify({ spec: 'github:owner/repo' }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.spec, 'github:owner/repo#sha');
    assert.deepEqual(order, ['install:github:owner/repo:']);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.deepEqual(order, ['install:github:owner/repo:', 'restart']);
  });

  test('needsAllowBuilds returns 200 and does not restart', async () => {
    let restarted = 0;
    startDesktopInstallControl({
      confirmModelAction: async () => true,
      installPlugin: async () => ({
        ok: false,
        needsAllowBuilds: true,
        allowBuilds: ['github.com/owner/repo'],
        spec: 'github:owner/repo',
        error: '需要允许该插件在本机执行构建脚本',
      }),
      startHarness: async () => {
        restarted += 1;
      },
      restartDelayMs: 20,
    });
    const { url, token } = await desktopInstallReady();
    const response = await postInstall(url, token, JSON.stringify({ spec: 'github:owner/repo' }));
    const body = await response.json();
    assert.equal(body.needsAllowBuilds, true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(restarted, 0);
  });

  test('rejects a non-github spec with 400 and never installs', async () => {
    let installs = 0;
    startDesktopInstallControl({
      installPlugin: async () => {
        installs += 1;
        return { ok: true };
      },
      startHarness: async () => {},
      confirmModelAction: async () => true,
    });
    const { url, token } = await desktopInstallReady();
    const response = await postInstall(url, token, JSON.stringify({ spec: 'npm:left-pad' }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.match(body.error, /github:owner\/repo/);
    assert.equal(installs, 0);
  });

  test('rejects a missing bearer token', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
    });
    const { url } = await desktopInstallReady();
    const response = await fetch(new URL('/install', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec: 'github:owner/repo' }),
    });
    assert.equal(response.status, 401);
  });

  test('rejects invalid allowBuilds with 400 and never installs', async () => {
    let installs = 0;
    startDesktopInstallControl({
      installPlugin: async () => {
        installs += 1;
        return { ok: true };
      },
      startHarness: async () => {},
      confirmModelAction: async () => true,
    });
    const { url, token } = await desktopInstallReady();
    const response = await postInstall(url, token, JSON.stringify({
      spec: 'github:owner/repo',
      allowBuilds: ['good-package\nmalicious: true'],
    }));
    assert.equal(response.status, 400);
    assert.equal(installs, 0);
  });

  test('rejects invalid JSON with 400', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
    });
    const { url, token } = await desktopInstallReady();
    const response = await postInstall(url, token, '{');
    assert.equal(response.status, 400);
  });

  test('/desktop/project authenticates and routes narrow Project actions without accepting malformed requests', async () => {
    const calls = [];
    startDesktopInstallControl({ installPlugin: async () => ({ ok: true }), startHarness: async () => {},
      confirmModelAction: async () => true,
      desktop: { project: async payload => { calls.push(payload); return { ok: true, canonicalPath: 'bound-directory' }; } } });
    const { url, token } = await desktopInstallReady(), endpoint = new URL('/desktop/project', url);
    assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 401);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const payload = { action: 'canonicalize', workingDirectory: 'chosen-directory' };
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(response.status, 200); assert.equal((await response.json()).canonicalPath, 'bound-directory');
    assert.deepEqual(calls, [payload]);
    for (const body of ['[1]', 'invalid']) assert.equal((await fetch(endpoint, { method: 'POST', headers, body })).status, 400);
    assert.deepEqual(calls, [payload]);
  });

  test('/desktop/state returns the desktop ops payload', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
      desktop: {
        state: async () => ({
          ok: true,
          version: '1.2.3',
          kernel: 'ready',
          plugins: ['a-pack'],
          disabledPlugins: [],
          config: { theme: 'midnight' },
        }),
      },
    });
    const { url, token } = await desktopInstallReady();
    const response = await fetch(new URL('/desktop/state', url), {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.kernel, 'ready');
    assert.deepEqual(body.plugins, ['a-pack']);
  });

  test('/desktop/* routes also require the bearer token', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
      desktop: { state: async () => ({ ok: true }) },
    });
    const { url } = await desktopInstallReady();
    const response = await fetch(new URL('/desktop/state', url));
    assert.equal(response.status, 401);
  });

  test('/desktop/config passes the patch through to applyConfig', async () => {
    const seen = [];
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
      desktop: {
        applyConfig: async (patch) => {
          seen.push(patch);
          return { ok: true, config: { theme: 'ocean' } };
        },
      },
    });
    const { url, token } = await desktopInstallReady();
    const response = await fetch(new URL('/desktop/config', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ patch: { theme: 'ocean' } }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(seen, [{ theme: 'ocean' }]);
  });

  test('/desktop/pet-settings reads and writes through desktop ops with authentication', async () => {
    const seen = [];
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
      desktop: {
        petSettings: () => ({ ok: true, settings: { personality: 'natural' } }),
        applyPetSettings: (patch) => {
          seen.push(patch);
          return { ok: true, settings: { personality: 'genki' } };
        },
      },
    });
    const { url, token } = await desktopInstallReady();
    const endpoint = new URL('/desktop/pet-settings', url);
    assert.equal((await fetch(endpoint)).status, 401);
    const read = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await read.json()).settings.personality, 'natural');
    const update = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { personality: 'genki' } }),
    });
    assert.equal((await update.json()).settings.personality, 'genki');
    assert.deepEqual(seen, [{ personality: 'genki' }]);
  });

  test('/desktop/plugin install by catalog id routes to installCatalog and restarts', async () => {
    const order = [];
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => { order.push('restart'); },
      restartDelayMs: 40,
      confirmModelAction: async () => true,
      desktop: {
        installCatalog: async (id, options) => {
          order.push(`catalog:${id}:${(options.allowBuilds || []).join(',')}`);
          return { ok: true, spec: 'github:owner/repo#sha' };
        },
      },
    });
    const { url, token } = await desktopInstallReady();
    const response = await fetch(new URL('/desktop/plugin', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'install', id: 'owner/repo' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.restarting, true);
    assert.deepEqual(order, ['catalog:owner/repo:']);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.deepEqual(order, ['catalog:owner/repo:', 'restart']);
  });

  test('/desktop/plugin remove/enable/disable call through the desktop ops', async () => {
    const calls = [];
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
      restartDelayMs: 5000,
      desktop: {
        removePlugin: async (name) => {
          calls.push(`remove:${name}`);
          return { ok: true };
        },
        disablePlugins: async (names) => {
          calls.push(`disable:${names.join('+')}`);
          return { ok: true, harnessRestarted: true };
        },
        enablePlugin: async (name) => {
          calls.push(`enable:${name}`);
          return { ok: true, harnessRestarted: true };
        },
      },
    });
    const { url, token } = await desktopInstallReady();
    const post = (payload) => fetch(new URL('/desktop/plugin', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    const removed = await post({ action: 'remove', name: 'a-pack' });
    assert.equal(removed.ok, true);
    const disabled = await post({ action: 'disable', name: 'a-pack' });
    assert.equal(disabled.ok, true);
    assert.equal(disabled.harnessRestarted, true);
    const enabled = await post({ action: 'enable', name: 'a-pack' });
    assert.equal(enabled.ok, true);
    assert.deepEqual(calls, ['remove:a-pack', 'disable:a-pack', 'enable:a-pack']);
  });

  test('/desktop/plugin rejects unknown actions and missing names with 400', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
      desktop: { removePlugin: async () => ({ ok: true }) },
    });
    const { url, token } = await desktopInstallReady();
    const post = (payload) => fetch(new URL('/desktop/plugin', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    assert.equal((await post({ action: 'explode' })).status, 400);
    assert.equal((await post({ action: 'remove' })).status, 400);
    assert.equal((await post({ action: 'install' })).status, 400);
  });

  test('unknown /desktop/* path answers 404', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
      desktop: { state: async () => ({ ok: true }) },
    });
    const { url, token } = await desktopInstallReady();
    const response = await fetch(new URL('/desktop/nope', url), {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 404);
  });

  test('spawnEnv receives the loopback URL and token', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => true,
    });
    await desktopInstallReady();
    const injected = desktopInstallEnv();
    assert.match(injected.DSH_DESKTOP_INSTALL_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(injected.DSH_DESKTOP_INSTALL_TOKEN.length, 64);
    setDesktopDshHome(os.tmpdir());
    const env = new DshManager({ loadConfig: () => ({}) }).spawnEnv({}, null);
    assert.equal(env.DSH_DESKTOP_INSTALL_URL, injected.DSH_DESKTOP_INSTALL_URL);
    assert.equal(env.DSH_DESKTOP_INSTALL_TOKEN, injected.DSH_DESKTOP_INSTALL_TOKEN);
    assert.equal(env.DSH_HOME, path.resolve(os.tmpdir()));
  });

  test('a declined confirmation executes nothing and answers declined:true', async () => {
    const calls = [];
    let restarted = 0;
    startDesktopInstallControl({
      installPlugin: async () => {
        calls.push('installPlugin');
        return { ok: true };
      },
      startHarness: async () => {
        restarted += 1;
      },
      restartDelayMs: 20,
      confirmModelAction: async () => false,
      desktop: {
        installCatalog: async () => {
          calls.push('installCatalog');
          return { ok: true };
        },
        removePlugin: async () => {
          calls.push('removePlugin');
          return { ok: true };
        },
        disablePlugins: async () => {
          calls.push('disablePlugins');
          return { ok: true };
        },
        enablePlugin: async () => {
          calls.push('enablePlugin');
          return { ok: true };
        },
      },
    });
    const { url, token } = await desktopInstallReady();
    const post = (pathname, payload) => fetch(new URL(pathname, url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    const install = await post('/install', { spec: 'github:owner/repo' });
    assert.equal(install.ok, false);
    assert.equal(install.declined, true);
    assert.equal(install.needsAllowBuilds, false);
    assert.deepEqual(install.allowBuilds, []);
    assert.equal(install.spec, 'github:owner/repo');
    assert.equal(install.log, '');
    for (const payload of [
      { action: 'install', id: 'owner/repo' },
      { action: 'install', spec: 'github:owner/repo' },
      { action: 'remove', name: 'a-pack' },
      { action: 'disable', names: ['a-pack', 'b-pack'] },
      { action: 'enable', name: 'a-pack' },
    ]) {
      const body = await post('/desktop/plugin', payload);
      assert.equal(body.ok, false, JSON.stringify(payload));
      assert.equal(body.declined, true, JSON.stringify(payload));
    }
    assert.deepEqual(calls, []);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(restarted, 0);
  });

  test('a missing confirmModelAction fails closed', async () => {
    const calls = [];
    startDesktopInstallControl({
      installPlugin: async () => {
        calls.push('installPlugin');
        return { ok: true };
      },
      startHarness: async () => {},
      desktop: {
        removePlugin: async () => {
          calls.push('removePlugin');
          return { ok: true };
        },
      },
    });
    const { url, token } = await desktopInstallReady();
    const post = (pathname, payload) => fetch(new URL(pathname, url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    assert.equal((await post('/install', { spec: 'github:owner/repo' })).declined, true);
    assert.equal((await post('/desktop/plugin', { action: 'remove', name: 'a-pack' })).declined, true);
    assert.deepEqual(calls, []);
  });

  test('a throwing confirmModelAction fails closed and reports the reason', async () => {
    let installs = 0;
    startDesktopInstallControl({
      installPlugin: async () => {
        installs += 1;
        return { ok: true };
      },
      startHarness: async () => {},
      confirmModelAction: async () => {
        throw new Error('dialog exploded');
      },
    });
    const { url, token } = await desktopInstallReady();
    const response = await postInstall(url, token, JSON.stringify({ spec: 'github:owner/repo' }));
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.declined, true);
    assert.match(body.error, /dialog exploded/);
    assert.equal(installs, 0);
  });

  test('confirm requests carry the action, target and allowBuilds', async () => {
    const seen = [];
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: false, error: 'nope' }),
      startHarness: async () => {},
      restartDelayMs: 5000,
      confirmModelAction: async (request) => {
        seen.push(request);
        return true;
      },
      desktop: {
        installCatalog: async () => ({ ok: false, error: 'nope' }),
        removePlugin: async () => ({ ok: false }),
        disablePlugins: async () => ({ ok: true }),
        enablePlugin: async () => ({ ok: true }),
      },
    });
    const { url, token } = await desktopInstallReady();
    const post = (pathname, payload) => fetch(new URL(pathname, url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    await post('/install', { spec: 'github:owner/repo#v1', allowBuilds: ['pkg-a'] });
    await post('/desktop/plugin', { action: 'install', id: 'catalog-id' });
    await post('/desktop/plugin', { action: 'remove', name: 'a-pack' });
    await post('/desktop/plugin', { action: 'disable', names: ['a-pack', 'b-pack'] });
    await post('/desktop/plugin', { action: 'disable', name: 'a-pack' });
    await post('/desktop/plugin', { action: 'enable', name: 'a-pack' });
    assert.deepEqual(seen, [
      { action: 'install', target: 'github:owner/repo#v1', allowBuilds: ['pkg-a'] },
      { action: 'install', target: 'catalog-id', allowBuilds: [] },
      { action: 'remove', target: 'a-pack', allowBuilds: [] },
      { action: 'disable', target: ['a-pack', 'b-pack'], allowBuilds: [] },
      { action: 'disable', target: 'a-pack', allowBuilds: [] },
      { action: 'enable', target: 'a-pack', allowBuilds: [] },
    ]);
  });

  test('invalid requests answer 400 without ever asking for confirmation', async () => {
    let confirms = 0;
    let installs = 0;
    startDesktopInstallControl({
      installPlugin: async () => {
        installs += 1;
        return { ok: true };
      },
      startHarness: async () => {},
      confirmModelAction: async () => {
        confirms += 1;
        return true;
      },
      desktop: { installCatalog: async () => ({ ok: true }) },
    });
    const { url, token } = await desktopInstallReady();
    const response = await postInstall(url, token, JSON.stringify({ spec: 'npm:left-pad' }));
    assert.equal(response.status, 400);
    const pluginResponse = await fetch(new URL('/desktop/plugin', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'install', spec: 'npm:left-pad' }),
    });
    assert.equal(pluginResponse.status, 400);
    assert.equal(confirms, 0);
    assert.equal(installs, 0);
  });

  test('concurrent requests serialize the confirmation prompt', async () => {
    const calls = [];
    let releaseFirst;
    startDesktopInstallControl({
      installPlugin: async (spec) => ({ ok: false, spec }),
      startHarness: async () => {},
      confirmModelAction: (request) => {
        calls.push(request.target);
        if (calls.length === 1) {
          return new Promise((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve(true);
      },
    });
    const { url, token } = await desktopInstallReady();
    const first = postInstall(url, token, JSON.stringify({ spec: 'github:owner/one' }));
    const second = postInstall(url, token, JSON.stringify({ spec: 'github:owner/two' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls.length, 1);
    releaseFirst(true);
    await Promise.all([first, second]);
    assert.equal(calls.length, 2);
    assert.deepEqual([...calls].sort(), ['github:owner/one', 'github:owner/two']);
  });
  test('an approval that arrives after the caller disconnected executes nothing', async () => {
    let approve;
    let asked;
    const askedOnce = new Promise((resolve) => { asked = resolve; });
    let installs = 0;
    let restarts = 0;
    startDesktopInstallControl({
      installPlugin: async () => { installs += 1; return { ok: true, spec: 'x', log: '' }; },
      startHarness: async () => { restarts += 1; },
      restartDelayMs: 0,
      confirmModelAction: () => new Promise((resolve) => { approve = resolve; asked(); }),
    });
    const { url, token } = await desktopInstallReady();
    const controller = new AbortController();
    const pending = fetch(new URL('/install', url), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ spec: 'github:owner/late' }),
      signal: controller.signal,
    }).catch((error) => error);
    await askedOnce;
    controller.abort();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 50));
    approve(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(installs, 0);
    assert.equal(restarts, 0);
  });

  test('/desktop/confirm relays allow and decline to the model tool', async () => {
    const seen = [];
    let allow = true;
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async (request) => {
        seen.push(request);
        return allow;
      },
    });
    const { url, token } = await desktopInstallReady();
    const post = (payload) => fetch(new URL('/desktop/confirm', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    assert.equal((await post({ tool: 'x' })).status, 400);
    assert.equal((await post({ effect: 'code' })).status, 400);
    const allowed = await (await post({
      tool: 'whale_delete_session',
      action: 'delete',
      effect: 'destructive',
      summary: '删除会话',
      details: 'session-1',
    })).json();
    assert.equal(allowed.ok, true);
    allow = false;
    const declined = await (await post({
      tool: 'whale_delete_session',
      action: 'delete',
      effect: 'destructive',
      summary: '删除会话',
      details: 'session-2',
    })).json();
    assert.equal(declined.ok, false);
    assert.equal(declined.declined, true);
    assert.deepEqual(seen, [
      {
        tool: 'whale_delete_session',
        action: 'delete',
        effect: 'destructive',
        summary: '删除会话',
        details: 'session-1',
      },
      {
        tool: 'whale_delete_session',
        action: 'delete',
        effect: 'destructive',
        summary: '删除会话',
        details: 'session-2',
      },
    ]);
  });

  test('/desktop/confirm fails closed when the confirmer is missing or throws', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
    });
    const { url, token } = await desktopInstallReady();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const body = JSON.stringify({ tool: 't', effect: 'code' });
    const missing = await (await fetch(new URL('/desktop/confirm', url), { method: 'POST', headers, body })).json();
    assert.equal(missing.ok, false);
    assert.equal(missing.declined, true);
    stopDesktopInstallControl();
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => { throw new Error('dialog exploded'); },
    });
    const next = await desktopInstallReady();
    const thrown = await (await fetch(new URL('/desktop/confirm', next.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${next.token}`, 'content-type': 'application/json' },
      body,
    })).json();
    assert.equal(thrown.ok, false);
    assert.equal(thrown.declined, true);
    assert.match(thrown.error, /dialog exploded/);
  });

  test('/desktop/confirm decides the effect level from the registry, not the request', async () => {
    const seen = [];
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async (request) => {
        seen.push(request);
        return 'always';
      },
    });
    const { url, token } = await desktopInstallReady();
    const post = (payload) => fetch(new URL('/desktop/confirm', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    // Self-reported 'external' on a code-level tool: the registry wins, and
    // code never remembers an 'always' answer, so every call asks again.
    for (let i = 0; i < 2; i += 1) {
      const body = await post({ tool: 'acp_delegate', action: 'delegate', effect: 'external', summary: '委派' });
      assert.equal(body.ok, true);
    }
    assert.equal(seen.length, 2);
    assert.equal(seen[0].effect, 'code');
    // Same for a destructive tool self-reporting a lighter level.
    for (let i = 0; i < 2; i += 1) {
      const body = await post({ tool: 'whale_delete_session', action: 'delete', effect: 'local', summary: '删除' });
      assert.equal(body.ok, true);
    }
    assert.equal(seen.length, 4);
    assert.equal(seen[2].effect, 'destructive');
    // A tool the registry does not know is handled as code.
    for (let i = 0; i < 2; i += 1) {
      const body = await post({ tool: 'unlisted_tool', action: 'go', effect: 'local', summary: 'x' });
      assert.equal(body.ok, true);
    }
    assert.equal(seen.length, 6);
    assert.equal(seen[4].effect, 'code');
    assert.equal(seen[5].effect, 'code');
  });

  test('/desktop/confirm remembers a run-scoped always per tool and action', async () => {
    const seen = [];
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async (request) => {
        seen.push(request);
        return 'always';
      },
    });
    const { url, token } = await desktopInstallReady();
    const post = (payload) => fetch(new URL('/desktop/confirm', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    const steer = { tool: 'whale_update_queue', action: 'steer', effect: 'external', summary: '并入排队消息' };
    assert.equal((await post(steer)).ok, true);
    // The remembered grant auto-allows the identical tool+action.
    assert.equal((await post(steer)).ok, true);
    assert.equal(seen.length, 1);
    // A different action on the same tool still asks.
    assert.equal((await post({ tool: 'whale_update_queue', action: 'edit', effect: 'external', summary: '改写' })).ok, true);
    assert.equal(seen.length, 2);
    // A different tool still asks.
    assert.equal((await post({ tool: 'whale_send_to_session', action: 'send', effect: 'external', summary: '代发' })).ok, true);
    assert.equal(seen.length, 3);
  });

  test('/desktop/confirm does not remember a one-time allow', async () => {
    let calls = 0;
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => {
        calls += 1;
        return 'once';
      },
    });
    const { url, token } = await desktopInstallReady();
    const post = (payload) => fetch(new URL('/desktop/confirm', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    const payload = { tool: 'whale_update_queue', action: 'steer', effect: 'external', summary: '并入排队消息' };
    assert.equal((await post(payload)).ok, true);
    assert.equal((await post(payload)).ok, true);
    assert.equal(calls, 2);
  });

  test('/desktop/confirm fails closed on an invalid confirmer result', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: async () => 'sure',
    });
    const { url, token } = await desktopInstallReady();
    const body = await (await fetch(new URL('/desktop/confirm', url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tool: 'whale_update_queue', action: 'steer', effect: 'external' }),
    })).json();
    assert.equal(body.ok, false);
    assert.equal(body.declined, true);
  });

  test('a restarted control server does not inherit remembered approvals', async () => {
    let calls = 0;
    const confirmer = async () => {
      calls += 1;
      return 'always';
    };
    const ops = {
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      confirmModelAction: confirmer,
    };
    const payload = { tool: 'whale_update_queue', action: 'steer', effect: 'external', summary: '并入排队消息' };
    const post = (base, token) => fetch(new URL('/desktop/confirm', base), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    startDesktopInstallControl(ops);
    const first = await desktopInstallReady();
    assert.equal((await post(first.url, first.token)).ok, true);
    assert.equal((await post(first.url, first.token)).ok, true);
    assert.equal(calls, 1);
    // A fresh server instance simulates an app restart: the run-scoped grant
    // is gone and the same action asks again.
    stopDesktopInstallControl();
    startDesktopInstallControl(ops);
    const second = await desktopInstallReady();
    assert.equal((await post(second.url, second.token)).ok, true);
    assert.equal(calls, 2);
  });

  test('/desktop/confirm requests serialize behind an in-flight confirmation', async () => {
    const calls = [];
    let releaseFirst;
    startDesktopInstallControl({
      installPlugin: async (spec) => ({ ok: false, spec }),
      startHarness: async () => {},
      confirmModelAction: (request) => {
        calls.push(request.effect ? `action:${request.tool}` : `plugin:${request.target}`);
        if (calls.length === 1) {
          return new Promise((resolve) => { releaseFirst = resolve; });
        }
        return Promise.resolve(true);
      },
    });
    const { url, token } = await desktopInstallReady();
    const first = postInstall(url, token, JSON.stringify({ spec: 'github:owner/one' }));
    const second = fetch(new URL('/desktop/confirm', url), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'acp_delegate', effect: 'code', summary: '委派' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls.length, 1);
    releaseFirst(true);
    await Promise.all([first, second]);
    assert.deepEqual(calls, ['plugin:github:owner/one', 'action:acp_delegate']);
  });

  test('/desktop/show-secret displays the secret through the desktop op', async () => {
    const shown = [];
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
      showSecret: async (request) => {
        shown.push(request);
        return { ok: true };
      },
    });
    const { url, token } = await desktopInstallReady();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const endpoint = new URL('/desktop/show-secret', url);
    assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ label: '配对码' }) })).status, 400);
    const result = await (await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'ChatGPT 配对码', label: '配对码', secret: 'ABCD-EFGH', hint: '在 ChatGPT 中输入' }),
    })).json();
    assert.equal(result.ok, true);
    assert.deepEqual(shown, [
      { title: 'ChatGPT 配对码', label: '配对码', secret: 'ABCD-EFGH', hint: '在 ChatGPT 中输入' },
    ]);
  });

  test('/desktop/show-secret fails closed when no display op is injected', async () => {
    startDesktopInstallControl({
      installPlugin: async () => ({ ok: true }),
      startHarness: async () => {},
    });
    const { url, token } = await desktopInstallReady();
    const result = await (await fetch(new URL('/desktop/show-secret', url), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ secret: 'ABCD-EFGH' }),
    })).json();
    assert.equal(result.ok, false);
  });
});
