'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function loadWithMocks(t, { openExternalCalls = [] } = {}) {
  const originalLoad = Module._load;
  const createdWindows = [];
  const createdViews = [];
  const partitions = new Map();

  class FakeWebContents extends EventEmitter {
    constructor(url = '') {
      super();
      this.mainFrame = { url };
      this.loadedUrls = [];
      this.loadedFiles = [];
      this.sent = [];
      this.openHandler = null;
      this.destroyed = false;
      this.ipc = new EventEmitter();
      this.ipcHandlers = new Map();
      this.ipc.handle = (channel, fn) => {
        this.ipcHandlers.set(channel, fn);
      };
    }
    isDestroyed() { return this.destroyed; }
    setWindowOpenHandler(fn) { this.openHandler = fn; }
    loadURL(url) { this.loadedUrls.push(url); return Promise.resolve(); }
    loadFile(file) { this.loadedFiles.push(file); this.mainFrame.url = pathToFileURL(file).href; return Promise.resolve(); }
    send(channel, payload) { this.sent.push([channel, payload]); }
    close() { this.destroyed = true; }
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeWebContents();
      this.minimizable = true;
      this.maximizable = true;
      this.destroyed = false;
      this.shown = false;
      this.focused = false;
      this.children = [];
      this.contentView = {
        addChildView: (view) => this.children.push(view),
        removeChildView: (view) => {
          const i = this.children.indexOf(view);
          if (i >= 0) this.children.splice(i, 1);
        },
      };
      createdWindows.push(this);
    }
    getContentSize() { return [1120, 780]; }
    isDestroyed() { return this.destroyed; }
    isMaximized() { return false; }
    loadFile(file) { return this.webContents.loadFile(file); }
    show() { this.shown = true; }
    showInactive() { this.shown = true; }
    focus() { this.focused = true; }
    close() { this.destroyed = true; this.emit('closed'); }
    destroy() { this.destroyed = true; this.emit('closed'); }
    minimize() {}
    maximize() {}
    unmaximize() {}
  }

  class FakeWebContentsView {
    constructor(options) {
      this.options = options;
      this.webContents = new FakeWebContents();
      this.bounds = null;
      createdViews.push(this);
    }
    setBounds(b) { this.bounds = b; }
  }

  const electronMock = {
    BrowserWindow: FakeBrowserWindow,
    WebContentsView: FakeWebContentsView,
    session: {
      fromPartition(name) {
        if (!partitions.has(name)) {
          partitions.set(name, {
            requestHandler: null,
            checkHandler: null,
            setPermissionRequestHandler(fn) { this.requestHandler = fn; },
            setPermissionCheckHandler(fn) { this.checkHandler = fn; },
          });
        }
        return partitions.get(name);
      },
    },
  };

  const openExternalMock = {
    openExternalHttp: async (url) => { openExternalCalls.push(url); return true; },
  };
  const chromeMock = {
    windowChrome: (opts) => opts,
    currentTheme: () => ({ scheme: 'dark' }),
  };
  const nativeMotionMock = {
    enableNativeWindowMotion: () => {},
    isNativeWindowMaximized: () => false,
    minimizeNativeWindow: () => true,
    toggleNativeWindowMaximize: () => true,
  };

  const windowPath = require.resolve('./magpie-window');
  delete require.cache[windowPath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    if (request === './open-external') return openExternalMock;
    if (request === './chrome') return chromeMock;
    if (request === './native-window-motion') return nativeMotionMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    delete require.cache[windowPath];
  });

  const mod = require('./magpie-window');
  return { mod, createdWindows, createdViews, partitions };
}

test('buildMagpieTargetUrl enforces loopback URL and injects initial theme without losing token', () => {
  const winMod = require('./magpie-window');
  assert.throws(() => winMod.buildMagpieTargetUrl('https://evil.example.com/?k=1', { scheme: 'dark' }), /只能打开本机管理界面/);
  assert.equal(
    winMod.buildMagpieTargetUrl('http://127.0.0.1:3430/?k=secret', { scheme: 'dark' }),
    'http://127.0.0.1:3430/?k=secret&theme=dark',
  );
  assert.equal(
    winMod.buildMagpieTargetUrl('http://[::1]:3430/?k=secret', { scheme: 'light' }),
    'http://[::1]:3430/?k=secret&theme=light',
  );
});

test('openMagpieWindow mounts zero-injection sandboxed WebContentsView and guards shell/external navigation', (t) => {
  const openExternalCalls = [];
  const { mod, createdWindows, createdViews, partitions } = loadWithMocks(t, { openExternalCalls });

  mod.openMagpieWindow({
    url: 'http://127.0.0.1:3430/?k=abc',
    ownership: 'managed',
    version: '0.1.4708',
    latestVersion: '0.1.4709',
    theme: { scheme: 'dark' },
  });

  assert.equal(createdWindows.length, 1);
  assert.equal(createdViews.length, 1);
  const win = createdWindows[0];
  const view = createdViews[0];

  // Outer shell loads preload + magpie-shell.html, denies popups and remote navigation
  assert.equal(path.basename(win.options.webPreferences.preload), 'magpie-shell.js');
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.webContents.openHandler({ url: 'https://example.com' }).action, 'deny');

  let navPrevented = false;
  win.webContents.emit('will-navigate', { preventDefault() { navPrevented = true; } }, 'https://evil.test/');
  assert.equal(navPrevented, true);

  // Embedded view has NO preload and strict persist:magpie permission denials
  assert.equal(view.options.webPreferences.preload, undefined);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.equal(view.options.webPreferences.partition, 'persist:magpie');
  assert.deepEqual(view.bounds, { x: 0, y: mod.TOPBAR_HEIGHT, width: 1120, height: 780 - mod.TOPBAR_HEIGHT });
  assert.deepEqual(view.webContents.loadedUrls, ['http://127.0.0.1:3430/?k=abc&theme=dark']);

  const part = partitions.get('persist:magpie');
  let granted = true;
  part.requestHandler(null, 'notifications', (val) => { granted = val; });
  assert.equal(granted, false);
  assert.equal(part.checkHandler(), false);

  // External HTTP links inside Magpie UI (OAuth / release links) are handed off to openExternalHttp
  const openRes = view.webContents.openHandler({ url: 'https://github.com/yetone/magpie/releases/tag/v0.1.4709' });
  assert.equal(openRes.action, 'deny');
  assert.deepEqual(openExternalCalls, ['https://github.com/yetone/magpie/releases/tag/v0.1.4709']);

  let viewNavPrevented = false;
  view.webContents.emit('will-navigate', { preventDefault() { viewNavPrevented = true; } }, 'https://oauth.example.com/auth');
  assert.equal(viewNavPrevented, true);
  assert.equal(openExternalCalls.length, 2);

  // Shell IPC rejects non-file sender frames and returns active meta when owned
  const foreignEvent = { sender: win.webContents, senderFrame: { url: 'http://127.0.0.1:3430/' } };
  const ownedEvent = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const handler = win.webContents.ipcHandlers.get('magpie:shell-meta');
  assert.throws(() => handler(foreignEvent), /Unauthorized Magpie shell sender/);
  const meta = handler(ownedEvent);
  assert.equal(meta.version, '0.1.4708');
  assert.equal(meta.ownership, 'managed');

  mod.closeMagpieWindow();
});
