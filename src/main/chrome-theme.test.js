'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const chromePath = require.resolve('./chrome');

function stubModule(id, exports) {
  const filename = require.resolve(id);
  const previous = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
  return { filename, previous };
}

function loadChrome({ mainWindow = null, launcherWindow = null } = {}) {
  const ipcListeners = new Map();
  const ipcHandlers = new Map();
  const restoreEntries = [
    stubModule('electron', {
      BrowserWindow: { getAllWindows: () => [], fromWebContents: (wc) => wc.owner },
      ipcMain: {
        on(channel, listener) { ipcListeners.set(channel, listener); },
        handle(channel, handler) { ipcHandlers.set(channel, handler); },
      },
      nativeTheme: { shouldUseDarkColors: false, on() {}, off() {} },
      screen: {
        getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1707, height: 920 } }),
      },
    }),
    stubModule('./config', { loadConfig: () => ({}) }),
    stubModule('./window', {
      getMainWindow: () => mainWindow,
      getLauncherWindow: () => launcherWindow,
      getHarnessWebContents: (win) => win?.harnessWc || null,
      getHarnessOrigin: () => 'http://127.0.0.1:3080',
    }),
  ];
  const previousChrome = require.cache[chromePath];
  delete require.cache[chromePath];
  const chrome = require('./chrome');
  return {
    chrome,
    ipcListeners,
    ipcHandlers,
    restore() {
      delete require.cache[chromePath];
      if (previousChrome) require.cache[chromePath] = previousChrome;
      for (const { filename, previous } of restoreEntries) {
        if (previous) require.cache[filename] = previous;
        else delete require.cache[filename];
      }
    },
  };
}

test('watchSystemTheme applies the theme on OS updates and unsubscribes cleanly', () => {
  const { chrome, restore } = loadChrome();
  try {
    const theme = new EventEmitter();
    let applied = 0;
    const unsubscribe = chrome.watchSystemTheme({ theme, apply: () => { applied += 1; } });
    theme.emit('updated');
    theme.emit('updated');
    assert.equal(applied, 2);
    unsubscribe();
    theme.emit('updated');
    assert.equal(applied, 2, 'listener must be removed after unsubscribe');
    assert.equal(theme.listenerCount('updated'), 0);
  } finally {
    restore();
  }
});

test('watchSystemTheme is a no-op without a usable nativeTheme', () => {
  const { chrome, restore } = loadChrome();
  try {
    assert.equal(typeof chrome.watchSystemTheme({ theme: null, apply: () => {} }), 'function');
    chrome.watchSystemTheme({ theme: null, apply: () => {} })();
  } finally {
    restore();
  }
});

test('isEffectivelyMaximized treats a work-area-covering transparent window as maximized', () => {
  const { chrome, restore } = loadChrome();
  try {
    const win = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 1707, height: 920 }),
    };
    assert.equal(chrome.isEffectivelyMaximized(win), false, 'native windows must not fake maximization from bounds');
    chrome.markWindowTransparent(win);
    assert.equal(chrome.isEffectivelyMaximized(win), true);
    win.getBounds = () => ({ x: 100, y: 20, width: 1440, height: 920 });
    assert.equal(chrome.isEffectivelyMaximized(win), false);
    win.isMaximized = () => true;
    assert.equal(chrome.isEffectivelyMaximized(win), true);
    win.isMinimized = () => true;
    assert.equal(chrome.isEffectivelyMaximized(win), false);
  } finally {
    restore();
  }
});

test('shell window policy cannot be overridden to disable native Windows transitions', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
  const { chrome, restore } = loadChrome();
  try {
    const options = chrome.shellWindowChrome({ transparent: true, thickFrame: false, roundedCorners: false, backgroundColor: '#00000000' });
    assert.equal(options.transparent, true, 'native motion must not replace the alpha silhouette');
    assert.equal(options.thickFrame, true);
    assert.equal(options.roundedCorners, false, 'OS mask must not cut down the 20px page radius');
    assert.equal(options.backgroundColor, '#00000000');
    assert.equal(chrome.windowChrome({ transparent: true }).transparent, true, 'pet/overlay transparency stays available');
  } finally {
    restore();
    Object.defineProperty(process, 'platform', platform);
  }
});

test('macOS shell windows retain their alpha silhouette and expose native traffic lights only for shell chrome', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
  const { chrome, restore } = loadChrome();
  try {
    const options = chrome.shellWindowChrome();
    assert.equal(options.frame, false);
    assert.equal(options.transparent, true);
    assert.equal(options.roundedCorners, true, 'AppKit titled style must remain available for native buttons');
    assert.equal(options.titleBarStyle, 'hidden');
    assert.deepEqual(options.trafficLightPosition, { x: 16, y: 18 });
    assert.equal(chrome.windowChrome().titleBarStyle, undefined, 'pet/overlay windows must not gain native buttons');
    assert.equal(chrome.windowChrome().trafficLightPosition, undefined);
    for (const role of [undefined, 'launcher']) {
      const win = chromeTestWindow();
      chrome.attachIntegratedChrome(win, { role });
      assert.deepEqual(win.buttonPosition, { x: 16, y: role === 'launcher' ? 9 : 18 });
      assert.equal(win.buttonVisibility, true);
    }
  } finally {
    restore();
    Object.defineProperty(process, 'platform', platform);
  }
});

test('minimize, hide and restore publish window visibility to boot and harness', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
  const win = chromeTestWindow();
  const viewStates = [];
  win.harnessWc = { isDestroyed: () => false, send: (channel, state) => viewStates.push({ channel, state }) };
  const { chrome, restore } = loadChrome({ mainWindow: win });
  try {
    chrome.attachIntegratedChrome(win);
    win.minimized = true;
    win.emit('minimize');
    assert.equal(win.states.at(-1).state.visible, false);
    assert.equal(viewStates.at(-1).state.visible, false);
    win.minimized = false;
    win.emit('restore');
    assert.equal(viewStates.at(-1).state.visible, true);
    win.visible = false;
    win.emit('hide');
    assert.equal(viewStates.at(-1).state.visible, false);
    win.visible = true;
    win.emit('show');
    assert.equal(viewStates.at(-1).state.visible, true);
  } finally {
    restore();
    Object.defineProperty(process, 'platform', platform);
  }
});

test('macOS native fullscreen transitions publish the current state to boot and harness', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
  const win = chromeTestWindow();
  const viewStates = [];
  win.harnessWc = { isDestroyed: () => false, send: (channel, state) => viewStates.push({ channel, state }) };
  const { chrome, ipcHandlers, restore } = loadChrome({ mainWindow: win });
  try {
    chrome.attachIntegratedChrome(win);
    const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
    assert.equal(ipcHandlers.get('shell:window-state')(event).fullscreen, false);
    win.fullscreen = true;
    win.emit('enter-full-screen');
    assert.equal(win.states.at(-1).state.fullscreen, true);
    assert.equal(viewStates.at(-1).state.fullscreen, true);
    assert.equal(ipcHandlers.get('shell:window-state')(event).fullscreen, true);
    win.fullscreen = false;
    win.emit('leave-full-screen');
    assert.equal(win.states.at(-1).state.fullscreen, false);
    assert.equal(viewStates.at(-1).state.fullscreen, false);
  } finally {
    restore();
    Object.defineProperty(process, 'platform', platform);
  }
});

function chromeTestWindow() {
  const win = new EventEmitter();
  const wc = new EventEmitter();
  const url = pathToFileURL(path.join(__dirname, '../renderer/boot.html')).href;
  wc.mainFrame = { url };
  wc.getURL = () => url;
  wc.isDestroyed = () => false;
  win.states = [];
  wc.send = (channel, state) => win.states.push({ channel, state });
  wc.owner = win;
  win.webContents = wc;
  win.isDestroyed = () => false;
  win.minimized = false;
  win.visible = true;
  win.isMinimized = () => win.minimized;
  win.isVisible = () => win.visible;
  win.isMaximized = () => false;
  win.fullscreen = false;
  win.isFullScreen = () => win.fullscreen;
  win.getBounds = () => ({ x: 80, y: 60, width: 1440, height: 920 });
  win.setAutoHideMenuBar = () => {};
  win.setMenuBarVisibility = () => {};
  win.setBackgroundColor = () => {};
  win.setWindowButtonPosition = (position) => { win.buttonPosition = position; };
  win.setWindowButtonVisibility = (visible) => { win.buttonVisibility = visible; };
  win.minimizable = true;
  win.maximizable = true;
  return win;
}

test('restorableNormalBounds falls back to a centered default when the tracked rect fills the work area', () => {
  const { chrome, restore } = loadChrome();
  try {
    // A window whose tracked normal bounds already cover the work area (e.g.
    // a small display) must still restore to a real windowed rect, or the
    // maximize button becomes a silent no-op.
    const win = {
      _dshNormalBounds: { x: 0, y: 0, width: 1707, height: 920 },
      getBounds: () => ({ x: 0, y: 0, width: 1707, height: 920 }),
    };
    const restored = chrome.restorableNormalBounds(win);
    assert.equal(restored.width, 1440);
    assert.equal(restored.height, 920);
    assert.equal(restored.x, Math.round((1707 - 1440) / 2));
    assert.equal(restored.y, 0);
    // A tracked rect that does not cover the work area is used as-is.
    win._dshNormalBounds = { x: 40, y: 30, width: 1200, height: 700 };
    assert.deepEqual(chrome.restorableNormalBounds(win), win._dshNormalBounds);
    // No tracked rect at all falls back to the same centered default.
    delete win._dshNormalBounds;
    assert.equal(chrome.restorableNormalBounds(win).width, 1440);
  } finally {
    restore();
  }
});

test('syncHarnessChrome retries the inject after a transient eval rejection', async () => {
  const { chrome, restore } = loadChrome();
  try {
    let calls = 0;
    const win = { isDestroyed: () => false, setBackgroundColor() {} };
    const wc = {
      isDestroyed: () => false,
      getURL: () => 'http://127.0.0.1:3080/',
      executeJavaScript: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('main frame was swapped'))
          : Promise.resolve({ bg: '#112233' });
      },
    };
    await chrome.syncHarnessChrome(win, wc);
    assert.equal(calls, 2, 'one transient rejection must trigger a retry');
  } finally {
    restore();
  }
});

test('syncHarnessChrome stops retrying once the view leaves the harness origin', async () => {
  const { chrome, restore } = loadChrome();
  try {
    let calls = 0;
    const win = { isDestroyed: () => false, setBackgroundColor() {} };
    const wc = {
      isDestroyed: () => false,
      getURL: () => (calls === 0 ? 'http://127.0.0.1:3080/' : 'chrome-error://dead/'),
      executeJavaScript: () => {
        calls += 1;
        return Promise.reject(new Error('frame gone'));
      },
    };
    await chrome.syncHarnessChrome(win, wc);
    assert.equal(calls, 1, 'a non-harness retry target must abort the retry loop');
  } finally {
    restore();
  }
});
