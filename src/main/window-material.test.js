'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const acrylicPath = require.resolve('./window-acrylic');
require.cache[acrylicPath] = { id: acrylicPath, filename: acrylicPath, loaded: true, exports: {
  prepareWindowAcrylic: () => true,
  setWindowAcrylic: (win, visible) => win.updateAcrylic?.(visible) ?? false,
} };

const {
  WINDOW_MATERIAL_ARGUMENT,
  ACRYLIC_MINIMUM_WINDOWS_BUILD,
  windowsAcrylicSupported,
  isValidWindowMaterial,
  hasAcrylicMaterial,
  rememberChromeColor,
  applyWindowMaterial,
  resetWindowMaterial,
} = require('./window-material');
const { IPC_ROLES } = require('./ipc-authorization');

function stubModule(id, exports) {
  const filename = require.resolve(id);
  const previous = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return { filename, previous };
}

function fakeWindow({ isDestroyed = false } = {}) {
  const calls = [];
  const win = {
    isDestroyed: () => isDestroyed,
    setBackgroundMaterial(material) { calls.push(['setBackgroundMaterial', material]); },
    setBackgroundColor(color) { calls.push(['setBackgroundColor', color]); },
    updateAcrylic(visible) { calls.push(['updateAcrylic', visible]); return true; },
  };
  return { win, calls };
}

function loadChromeHarness({
  supported = true,
  mainWindow = null,
  launcherWindow = null,
  harnessWc = null,
  harnessOrigin = 'http://127.0.0.1:41234',
} = {}) {
  const ipcListeners = new Map();
  const ipcHandlers = new Map();
  const chromePath = require.resolve('./chrome');
  const windowMaterialPath = require.resolve('./window-material');
  const authPath = require.resolve('./ipc-authorization');
  const restoreEntries = [
    stubModule('electron', {
      BrowserWindow: { getAllWindows: () => [], fromWebContents: (wc) => wc?.owner ?? null },
      ipcMain: {
        on(channel, listener) { ipcListeners.set(channel, listener); },
        handle(channel, handler) { ipcHandlers.set(channel, handler); },
      },
      nativeTheme: { shouldUseDarkColors: false, on() {}, off() {} },
      screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1707, height: 920 } }) },
    }),
    stubModule('./config', { loadConfig: () => ({}) }),
    stubModule('./window', {
      getMainWindow: () => mainWindow,
      getLauncherWindow: () => launcherWindow,
      getHarnessWebContents: () => harnessWc,
      getHarnessOrigin: () => harnessOrigin,
    }),
  ];
  const previousChrome = require.cache[chromePath];
  const previousAuth = require.cache[authPath];
  const previousMaterial = require.cache[windowMaterialPath];
  delete require.cache[chromePath];
  delete require.cache[authPath];
  delete require.cache[windowMaterialPath];
  const realMaterial = require('./window-material');
  require.cache[windowMaterialPath].exports = {
    ...realMaterial,
    windowsAcrylicSupported: () => supported,
  };
  const chrome = require('./chrome');
  return {
    chrome,
    ipcListeners,
    ipcHandlers,
    restore() {
      delete require.cache[chromePath];
      delete require.cache[authPath];
      delete require.cache[windowMaterialPath];
      if (previousChrome) require.cache[chromePath] = previousChrome;
      if (previousAuth) require.cache[authPath] = previousAuth;
      if (previousMaterial) require.cache[windowMaterialPath] = previousMaterial;
      for (const { filename, previous } of restoreEntries) {
        if (previous) require.cache[filename] = previous;
        else delete require.cache[filename];
      }
    },
  };
}

test('windowsAcrylicSupported requires win32 and Windows 11 22H2+ build 22621', () => {
  assert.equal(ACRYLIC_MINIMUM_WINDOWS_BUILD, 22621);
  assert.equal(windowsAcrylicSupported('win32', '10.0.22621'), true);
  assert.equal(windowsAcrylicSupported('win32', '10.0.26200'), true);
  assert.equal(windowsAcrylicSupported('win32', '10.0.22000'), false);
  assert.equal(windowsAcrylicSupported('win32', '10.0.19045'), false);
  assert.equal(windowsAcrylicSupported('win32', '10.0.'), false);
  assert.equal(windowsAcrylicSupported('win32', '10.0.22621abc'), false);
  assert.equal(windowsAcrylicSupported('win32', ''), false);
  assert.equal(windowsAcrylicSupported('darwin', '24.0.0'), false);
  assert.equal(windowsAcrylicSupported('linux', '6.8.0'), false);
});

test('isValidWindowMaterial accepts only acrylic and none', () => {
  assert.equal(isValidWindowMaterial('acrylic'), true);
  assert.equal(isValidWindowMaterial('none'), true);
  assert.equal(isValidWindowMaterial('mica'), false);
  assert.equal(isValidWindowMaterial(''), false);
  assert.equal(isValidWindowMaterial(null), false);
  assert.equal(isValidWindowMaterial(123), false);
});

test('initial none leaves the transparent compositor surface untouched', () => {
  const { win, calls } = fakeWindow();
  assert.equal(applyWindowMaterial(win, 'none', { transparent: true }), true);
  assert.deepEqual(calls, []);
});

test('transparent shells use only the rounded composition visual', () => {
  const { win, calls } = fakeWindow();
  assert.equal(applyWindowMaterial(win, 'acrylic', { transparent: true, restoreColor: '#ffffff' }), true);
  assert.equal(hasAcrylicMaterial(win), true);
  assert.deepEqual(calls, [['updateAcrylic', true]]);

  assert.equal(applyWindowMaterial(win, 'none', { transparent: true, restoreColor: '#ffffff' }), true);
  assert.equal(hasAcrylicMaterial(win), false);
  assert.deepEqual(calls, [
    ['updateAcrylic', true],
    ['updateAcrylic', false],
  ]);
  applyWindowMaterial(win, 'none', { transparent: true });
  assert.equal(calls.length, 2);
});

test('a transparent window without a composition target never falls back to rectangular material', () => {
  const { win, calls } = fakeWindow();
  delete win.updateAcrylic;
  assert.equal(applyWindowMaterial(win, 'acrylic', { transparent: true }), false);
  assert.equal(hasAcrylicMaterial(win), false);
  assert.deepEqual(calls, []);
});

test('applyWindowMaterial clears opaque windows to transparent and restores cached chrome fill', () => {
  const { win, calls } = fakeWindow();
  rememberChromeColor(win, '#123456');
  rememberChromeColor(win, '#00000000');

  assert.equal(applyWindowMaterial(win, 'acrylic', { transparent: false, restoreColor: '#ffffff' }), true);
  assert.equal(hasAcrylicMaterial(win), true);
  assert.equal(applyWindowMaterial(win, 'none', { transparent: false, restoreColor: '#ffffff' }), true);
  assert.equal(hasAcrylicMaterial(win), false);
  assert.deepEqual(calls, [
    ['setBackgroundMaterial', 'acrylic'],
    ['setBackgroundColor', '#00000000'],
    ['setBackgroundMaterial', 'none'],
    ['setBackgroundColor', '#123456'],
  ]);

  const { win: fallbackWin, calls: fallbackCalls } = fakeWindow();
  applyWindowMaterial(fallbackWin, 'acrylic', { transparent: false });
  applyWindowMaterial(fallbackWin, 'none', { transparent: false, restoreColor: '#f9fafb' });
  assert.deepEqual(fallbackCalls, [
    ['setBackgroundMaterial', 'acrylic'],
    ['setBackgroundColor', '#00000000'],
    ['setBackgroundMaterial', 'none'],
    ['setBackgroundColor', '#f9fafb'],
  ]);
});

test('applyWindowMaterial and resetWindowMaterial reject invalid windows/materials cleanly', () => {
  const { win: destroyed, calls } = fakeWindow({ isDestroyed: true });
  assert.equal(applyWindowMaterial(destroyed, 'acrylic'), false);
  assert.equal(applyWindowMaterial(null, 'acrylic'), false);
  assert.equal(applyWindowMaterial({}, 'acrylic'), false);

  const { win: fresh, calls: freshCalls } = fakeWindow();
  assert.equal(applyWindowMaterial(fresh, 'mica'), false);
  assert.equal(resetWindowMaterial(fresh), false);
  assert.deepEqual(calls, []);
  assert.deepEqual(freshCalls, []);

  applyWindowMaterial(fresh, 'acrylic', { transparent: true });
  assert.equal(resetWindowMaterial(fresh, { transparent: true }), true);
  assert.equal(resetWindowMaterial(fresh, { transparent: true }), false);
  assert.deepEqual(freshCalls, [
    ['updateAcrylic', true],
    ['updateAcrylic', false],
  ]);
});

test('shell:window-material IPC accepts only validated harness loopback senders on supported Windows', () => {
  const harnessOrigin = 'http://127.0.0.1:41234';
  const harnessWc = {
    isDestroyed: () => false,
    mainFrame: { url: `${harnessOrigin}/app` },
    getURL: () => `${harnessOrigin}/app`,
    send() {},
  };
  const { win, calls } = fakeWindow();
  win.webContents = {
    isDestroyed: () => false,
    mainFrame: { url: pathToFileURL(path.join(__dirname, '../renderer/boot.html')).href },
    getURL: () => pathToFileURL(path.join(__dirname, '../renderer/boot.html')).href,
    send() {},
  };
  const { chrome, ipcListeners, restore } = loadChromeHarness({
    supported: true,
    mainWindow: win,
    harnessWc,
    harnessOrigin,
  });
  try {
    chrome.markWindowTransparent(win);
    chrome.bindChromeIpc();
    const listener = ipcListeners.get('shell:window-material');
    assert.equal(typeof listener, 'function');

    listener({ sender: harnessWc, senderFrame: harnessWc.mainFrame }, 'none');
    listener({ sender: harnessWc, senderFrame: harnessWc.mainFrame }, 'acrylic');
    listener({ sender: harnessWc, senderFrame: harnessWc.mainFrame }, 'none');
    // Spoofed boot / wrong frame / cross-origin / invalid payload must be ignored.
    listener({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, 'acrylic');
    listener({ sender: harnessWc, senderFrame: { url: 'http://127.0.0.1:41234/sub' } }, 'acrylic');
    listener({ sender: harnessWc, senderFrame: { url: 'http://127.0.0.1:9999/app' } }, 'acrylic');
    listener({ sender: harnessWc, senderFrame: harnessWc.mainFrame }, 'mica');
    listener({ sender: harnessWc, senderFrame: harnessWc.mainFrame }, 42);

    assert.deepEqual(calls, [
      ['updateAcrylic', true],
      ['updateAcrylic', false],
    ]);
  } finally {
    restore();
  }
});

test('shell:window-material rejects toggles when windowsAcrylicSupported is false', () => {
  const harnessOrigin = 'http://127.0.0.1:41234';
  const harnessWc = {
    isDestroyed: () => false,
    mainFrame: { url: `${harnessOrigin}/app` },
    getURL: () => `${harnessOrigin}/app`,
  };
  const { win, calls } = fakeWindow();
  const { chrome, ipcListeners, restore } = loadChromeHarness({
    supported: false,
    mainWindow: win,
    harnessWc,
    harnessOrigin,
  });
  try {
    chrome.markWindowTransparent(win);
    chrome.bindChromeIpc();
    const listener = ipcListeners.get('shell:window-material');
    listener({ sender: harnessWc, senderFrame: harnessWc.mainFrame }, 'acrylic');
    assert.deepEqual(calls, []);
  } finally {
    restore();
  }
});

test('chrome paintBackground skips opaque fills while acrylic is active and restores on off or reset', () => {
  const harnessOrigin = 'http://127.0.0.1:41234';
  const harnessWc = {
    isDestroyed: () => false,
    mainFrame: { url: `${harnessOrigin}/app` },
    getURL: () => `${harnessOrigin}/app`,
  };
  const { win, calls } = fakeWindow();
  win.webContents = { isDestroyed: () => false, getURL: () => 'about:blank' };
  const { chrome, ipcListeners, restore } = loadChromeHarness({
    supported: true,
    mainWindow: win,
    harnessWc,
    harnessOrigin,
  });
  try {
    chrome.bindChromeIpc();
    chrome.paintBackground(win, '#222429');
    const listener = ipcListeners.get('shell:window-material');
    listener({ sender: harnessWc, senderFrame: harnessWc.mainFrame }, 'acrylic');
    chrome.paintBackground(win, '#191b1f');
    assert.equal(chrome.resetWindowMaterial(win), true);
    assert.equal(chrome.resetWindowMaterial(win), false);
    assert.deepEqual(calls, [
      ['setBackgroundColor', '#222429'],
      ['setBackgroundMaterial', 'acrylic'],
      ['setBackgroundColor', '#00000000'],
      ['setBackgroundMaterial', 'none'],
      ['setBackgroundColor', '#191b1f'],
    ]);
  } finally {
    restore();
  }
});

test('window showHarness passes acrylic argument iff supported and hideHarnessView resets material', async () => {
  for (const supported of [true, false]) {
    const windowPath = require.resolve('./window');
    const materialPath = require.resolve('./window-material');
    const electronPath = require.resolve('electron');
    const chromePath = require.resolve('./chrome');
    const pathsPath = require.resolve('./paths');
    const shortcutsPath = require.resolve('./shortcuts');
    const guestsPath = require.resolve('./browser-guests');
    const authPath = require.resolve('./ipc-authorization');
    const restoreList = [
      [electronPath, require.cache[electronPath]],
      [chromePath, require.cache[chromePath]],
      [pathsPath, require.cache[pathsPath]],
      [shortcutsPath, require.cache[shortcutsPath]],
      [guestsPath, require.cache[guestsPath]],
      [authPath, require.cache[authPath]],
      [materialPath, require.cache[materialPath]],
      [windowPath, require.cache[windowPath]],
    ];
    let createdViewOptions = null;
    const resetCalls = [];
    class FakeWebContents extends EventEmitter {
      constructor() {
        super();
        this.session = {
          setPermissionRequestHandler() {},
          on() {},
          webRequest: { onHeadersReceived() {} },
        };
        this.destroyed = false;
        this.url = '';
      }
      isDestroyed() { return this.destroyed; }
      getURL() { return this.url; }
      setWindowOpenHandler() {}
      setZoomFactor() {}
      send() {}
      loadURL(url) { this.url = url; return Promise.resolve(); }
      executeJavaScript() {
        return Promise.resolve({ pending: false, ready: 1, total: 1, failed: false, hasApp: true, error: '' });
      }
      close() { this.destroyed = true; }
    }
    class FakeBrowserView {
      constructor(options) { createdViewOptions = options; this.webContents = new FakeWebContents(); }
      setBounds() {}
      setAutoResize() {}
    }
    class FakeBrowserWindow extends EventEmitter {
      constructor() {
        super();
        this.webContents = new FakeWebContents();
        this.views = [];
      }
      isDestroyed() { return false; }
      isMinimized() { return false; }
      isVisible() { return true; }
      show() {}
      focus() {}
      setAppDetails() {}
      setBackgroundColor() {}
      getContentBounds() { return { width: 1280, height: 800 }; }
      getBrowserViews() { return this.views; }
      addBrowserView(view) { if (!this.views.includes(view)) this.views.push(view); }
      removeBrowserView(view) { this.views = this.views.filter((v) => v !== view); }
      setTopBrowserView() {}
      loadFile(file) {
        this.webContents.url = pathToFileURL(file).href;
        return Promise.resolve();
      }
    }
    try {
      require.cache[electronPath] = {
        id: electronPath,
        filename: electronPath,
        loaded: true,
        exports: {
          app: { isPackaged: false, getAppPath: () => 'C:/app' },
          BrowserView: FakeBrowserView,
          BrowserWindow: FakeBrowserWindow,
          nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
          screen: {},
        },
      };
      require.cache[chromePath] = {
        id: chromePath,
        filename: chromePath,
        loaded: true,
        exports: {
          shellWindowChrome: (o) => o,
          attachIntegratedChrome() {},
          hideNativeMenu() {},
          prepareHarnessChrome() {},
          syncHarnessChrome() {},
          currentTheme: () => ({ bg: '#ffffff' }),
          markWindowTransparent() {},
          paintBackground() {},
          resetWindowMaterial(win) { resetCalls.push(win); return true; },
        },
      };
      require.cache[pathsPath] = {
        id: pathsPath,
        filename: pathsPath,
        loaded: true,
        exports: {
          rendererFile: (f) => path.join(__dirname, '..', 'renderer', f),
          assetFile: (f) => path.join(__dirname, '..', '..', 'assets', f),
          preloadFile: () => path.join(__dirname, '..', 'preload', 'index.js'),
        },
      };
      require.cache[shortcutsPath] = { id: shortcutsPath, filename: shortcutsPath, loaded: true, exports: { getShortcutService: () => null } };
      require.cache[guestsPath] = { id: guestsPath, filename: guestsPath, loaded: true, exports: { getBrowserGuests: () => null } };
      require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { registerPrivilegedSurfaces() {}, IPC_ROLES } };
      delete require.cache[materialPath];
      const realMaterial = require('./window-material');
      require.cache[materialPath].exports = { ...realMaterial, windowsAcrylicSupported: () => supported };
      delete require.cache[windowPath];
      const winMod = require('./window');
      await winMod.showHarness('http://127.0.0.1:41234/app');
      assert.equal(
        createdViewOptions.webPreferences.additionalArguments.includes(WINDOW_MATERIAL_ARGUMENT),
        supported,
      );
      const owner = winMod.getMainWindow();
      winMod.hideHarnessView(owner);
      assert.equal(resetCalls.includes(owner), true);
    } finally {
      for (const [id, entry] of restoreList) {
        if (entry) require.cache[id] = entry;
        else delete require.cache[id];
      }
    }
  }
});
