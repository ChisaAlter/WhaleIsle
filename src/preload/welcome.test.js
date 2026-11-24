'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const WELCOME_LOCALE = { id: 'zh-CN', messages: { welcomeTitle: '鲸屿' } };

function fakeRenderer(bootstrap) {
  return {
    sendSync: () => bootstrap,
    invoke: () => Promise.resolve(),
    on: () => {},
    removeListener: () => {},
  };
}

function loadPreload(renderer = fakeRenderer(WELCOME_LOCALE), {
  isMainFrame = true,
  href = 'file:///app/src/renderer/welcome.html',
  protocol = 'file:',
} = {}) {
  const electronPath = require.resolve('electron');
  const preloadPath = require.resolve('./welcome');
  const cachedElectron = require.cache[electronPath];
  const cachedPreload = require.cache[preloadPath];
  const prevMainFrame = Object.getOwnPropertyDescriptor(process, 'isMainFrame');
  const prevLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  let exposed = null;

  Object.defineProperty(process, 'isMainFrame', { configurable: true, value: isMainFrame });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href, protocol } });
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      contextBridge: {
        exposeInMainWorld(name, api) { exposed = { name, api }; },
      },
      ipcRenderer: renderer,
    },
  };
  delete require.cache[preloadPath];

  try {
    require('./welcome');
    return { exposed };
  } finally {
    if (prevMainFrame) Object.defineProperty(process, 'isMainFrame', prevMainFrame);
    else delete process.isMainFrame;
    if (prevLocation) Object.defineProperty(globalThis, 'location', prevLocation);
    else delete globalThis.location;
    if (cachedElectron) require.cache[electronPath] = cachedElectron;
    else delete require.cache[electronPath];
    if (cachedPreload) require.cache[preloadPath] = cachedPreload;
    else delete require.cache[preloadPath];
  }
}

test('welcome preload is self-contained so the window can run sandboxed', () => {
  const source = fs.readFileSync(path.join(__dirname, 'welcome.js'), 'utf8');
  assert.doesNotMatch(source, /require\(\s*['"]\.{1,2}[\\/]/);
});

test('welcome preload pulls the locale table over the sync bootstrap channel', () => {
  const channels = [];
  const renderer = {
    ...fakeRenderer(WELCOME_LOCALE),
    sendSync: (channel) => { channels.push(channel); return { id: 'en', messages: { welcomeTitle: 'T' } }; },
  };
  const { exposed } = loadPreload(renderer);
  assert.equal(exposed?.name, 'dshWelcome');
  assert.deepEqual(channels, ['dsh-welcome:locale']);
  assert.equal(exposed.api.id, 'en');
  assert.deepEqual(exposed.api.messages, { welcomeTitle: 'T' });
});

test('welcome preload keeps the save/skip/start IPC actions unchanged', async () => {
  const calls = [];
  const renderer = {
    ...fakeRenderer(WELCOME_LOCALE),
    invoke: async (...args) => { calls.push(args); return { ok: true }; },
  };
  const { exposed } = loadPreload(renderer);
  const api = exposed.api;
  await api.saveApiKey('sk-test');
  await api.skip();
  await api.startSignIn();
  assert.deepEqual(calls, [
    ['dsh-welcome:save-api-key', 'sk-test'],
    ['dsh-welcome:skip'],
    ['dsh-welcome:start'],
  ]);
  await api.cancelSignIn('a1');
  await api.copySignInLink('a1');
  await api.takeNotice();
  assert.deepEqual(calls.slice(3), [
    ['dsh-welcome:cancel', 'a1'],
    ['dsh-welcome:copy-link', 'a1'],
    ['dsh-welcome:take-notice'],
  ]);
});

test('welcome preload subscribes and disposes account-state pushes', () => {
  const registrations = [];
  const removals = [];
  const renderer = {
    ...fakeRenderer(WELCOME_LOCALE),
    on: (channel, listener) => { registrations.push([channel, listener]); },
    removeListener: (channel, listener) => { removals.push([channel, listener]); },
  };
  const { exposed } = loadPreload(renderer);
  const seen = [];
  const dispose = exposed.api.onAccountState((state) => seen.push(state));
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0], 'dsh-welcome:state');
  registrations[0][1](null, { status: 'signed-out' });
  assert.deepEqual(seen, [{ status: 'signed-out' }]);
  dispose();
  assert.deepEqual(removals, registrations);
});

test('welcome preload fails closed when the bootstrap returns no locale', () => {
  for (const value of [undefined, null, 'en', ['en'], { id: 1, messages: {} }, { id: 'en' }, { id: 'en', messages: null }]) {
    assert.throws(() => loadPreload(fakeRenderer(value)), /missing window locale/);
  }
});

test('welcome window options keep the renderer sandboxed without a bundled preload', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main/welcome-window.js'), 'utf8');
  assert.match(source, /sandbox:\s*true/);
  assert.doesNotMatch(source, /sandbox:\s*false/);
});

test('welcome preload refuses subframes and non-welcome file URLs', () => {
  assert.equal(loadPreload(fakeRenderer(WELCOME_LOCALE), { isMainFrame: false }).exposed, null);
  assert.equal(loadPreload(fakeRenderer(WELCOME_LOCALE), { href: 'https://evil.example/welcome.html', protocol: 'https:' }).exposed, null);
  assert.equal(loadPreload(fakeRenderer(WELCOME_LOCALE), { href: 'file:///app/src/renderer/other.html', protocol: 'file:' }).exposed, null);
});
