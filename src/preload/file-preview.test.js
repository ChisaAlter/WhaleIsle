'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function loadFilePreviewPreload({ isMainFrame = true, href = 'file:///app/src/renderer/file-preview.html' } = {}) {
  const electronPath = require.resolve('electron');
  const preloadPath = require.resolve('./file-preview.js');
  const cachedElectron = require.cache[electronPath];
  const cachedPreload = require.cache[preloadPath];
  const prevMainFrame = Object.getOwnPropertyDescriptor(process, 'isMainFrame');
  const prevLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const listeners = new Map();
  let exposed = null;
  const ipcRenderer = {
    invoke: async channel => ({ channel }),
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    emit(channel, payload) { listeners.get(channel)?.({}, payload); },
  };
  Object.defineProperty(process, 'isMainFrame', { configurable: true, value: isMainFrame });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href } });
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      contextBridge: { exposeInMainWorld(name, api) { exposed = { name, api }; } },
      ipcRenderer,
    },
  };
  delete require.cache[preloadPath];
  try {
    require('./file-preview.js');
    return { exposed, ipcRenderer, listeners };
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

test('file preview preload exposes only state and theme methods', async () => {
  const { exposed, ipcRenderer, listeners } = loadFilePreviewPreload();
  assert.equal(exposed?.name, 'filePreview');
  assert.deepEqual(Object.keys(exposed.api).sort(), ['getState', 'onTheme']);
  assert.deepEqual(await exposed.api.getState(), { channel: 'shell:file-preview-state' });
  const themes = [];
  const dispose = exposed.api.onTheme(theme => themes.push(theme));
  ipcRenderer.emit('shell:theme', { scheme: 'dark' });
  assert.deepEqual(themes, [{ scheme: 'dark' }]);
  dispose();
  assert.equal(listeners.has('shell:theme'), false);
});

test('file preview preload refuses subframes and non-file-preview URLs', () => {
  assert.equal(loadFilePreviewPreload({ isMainFrame: false }).exposed, null);
  assert.equal(loadFilePreviewPreload({ href: 'https://evil.example/file-preview.html' }).exposed, null);
  assert.equal(loadFilePreviewPreload({ href: 'file:///app/src/renderer/other.html' }).exposed, null);
});
