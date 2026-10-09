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
    });
    const { url, token } = await desktopInstallReady();
    const response = await postInstall(url, token, '{');
    assert.equal(response.status, 400);
  });

  test('/desktop/project authenticates and routes narrow Project actions without accepting malformed requests', async () => {
    const calls = [];
    startDesktopInstallControl({ installPlugin: async () => ({ ok: true }), startHarness: async () => {},
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
});
