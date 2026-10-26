const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');

function marketplaceRendererDir() {
  return path.join(__dirname, '../renderer/marketplace');
}

function hasMarketSectionScript(scripts) {
  return scripts.some((script) => script.includes('data-dsh-settings-trigger') && script.includes('const id = "market";'));
}

function loadWindowModule() {
  const electronPath = require.resolve('electron');
  const chromePath = require.resolve('./chrome.js');
  const pathsPath = require.resolve('./paths.js');
  const windowPath = require.resolve('./window.js');
  const cached = new Map([
    [electronPath, require.cache[electronPath]],
    [chromePath, require.cache[chromePath]],
    [pathsPath, require.cache[pathsPath]],
    [windowPath, require.cache[windowPath]],
  ]);

  const windows = [];

  class FakeWebContents extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.url = '';
      this.scripts = [];
      this.hasApp = false;
      this.settingsOpened = true;
    }

    isDestroyed() { return this.destroyed; }
    getURL() { return this.url; }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
    send() {}
    close() { this.destroyed = true; }

    loadURL(url) {
      this.url = url;
      return Promise.resolve();
    }

    executeJavaScript(script) {
      this.scripts.push(script);
      if (script.includes('data-dshd-boot-status')) {
        return Promise.resolve({
          pending: !this.hasApp,
          ready: this.hasApp ? 1 : 0,
          total: 1,
          failed: false,
          hasApp: Boolean(this.hasApp),
          error: '',
        });
      }
      if (script.includes('const id = "market";')) {
        return Promise.resolve(this.settingsOpened);
      }
      return Promise.resolve(true);
    }

    insertCSS(css) {
      this.injectedCss = (this.injectedCss || []).concat(css);
      return Promise.resolve(css);
    }

    removeInsertedCSS(key) {
      this.injectedCss = (this.injectedCss || []).filter(css => css !== key);
      return Promise.resolve();
    }
  }

  class FakeBrowserView {
    constructor(options) {
      this.webContents = new FakeWebContents();
      this.webContents.ownerOptions = options;
    }

    setBounds() {}
    setAutoResize() {}
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeWebContents();
      this.webContents.ownerOptions = options;
      this.views = [];
      this.loadedFiles = [];
      this.minimized = false;
      windows.push(this);
    }

    isDestroyed() { return false; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; }
    show() {}
    setAppDetails(details) { this.appDetails = details; }
    focus() {}
    setBackgroundColor() {}
    getContentBounds() { return { width: 1_440, height: 920 }; }
    getBrowserViews() { return this.views; }
    setTopBrowserView() {}

    addBrowserView(view) {
      if (!this.views.includes(view)) this.views.push(view);
    }

    removeBrowserView(view) {
      this.views = this.views.filter((candidate) => candidate !== view);
    }

    loadFile(file) {
      this.loadedFiles.push(file);
      this.webContents.url = `file:///${String(file).replaceAll('\\', '/')}`;
      return Promise.resolve();
    }
  }

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { isPackaged: false, getAppPath: () => 'C:/app' },
      BrowserView: FakeBrowserView,
      BrowserWindow: FakeBrowserWindow,
      shell: { openExternal() {} },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    },
  };
  require.cache[chromePath] = {
    id: chromePath,
    filename: chromePath,
    loaded: true,
    exports: {
      shellWindowChrome: (options) => ({ ...options, transparent: true, thickFrame: true, roundedCorners: false }),
      attachIntegratedChrome() {},
      hideNativeMenu() {},
      prepareHarnessChrome() {},
      syncHarnessChrome() {},
      currentTheme: () => ({ bg: '#ffffff' }),
      markWindowTransparent() {},
      paintBackground() {},
    },
  };
  require.cache[pathsPath] = {
    id: pathsPath,
    filename: pathsPath,
    loaded: true,
    exports: {
      rendererFile: (name) => `C:/app/${name}`,
      assetFile: (name) => `C:/app/${name}`,
      preloadFile: () => 'C:/app/preload.js',
    },
  };

  delete require.cache[windowPath];
  const windowMod = require('./window.js');

  return {
    windowMod,
    windows,
    restore() {
      for (const [modulePath, entry] of cached) {
        if (entry) require.cache[modulePath] = entry;
        else delete require.cache[modulePath];
      }
    },
  };
}

test('both shell factories retain native window policy after all constructor overrides', () => {
  const { windowMod, windows, restore } = loadWindowModule();
  try {
    windowMod.createMainWindow();
    windowMod.createLauncherWindow();
    assert.equal(windows.length, 2);
    for (const win of windows) {
      assert.equal(win.options.transparent, true);
      assert.equal(win.options.thickFrame, true);
      assert.equal(win.options.roundedCorners, false);
    }
  } finally { restore(); }
});

async function waitForHarness(showHarness) {
  const status = await showHarness('http://127.0.0.1:3080/');
  await Promise.resolve();
  await Promise.resolve();
  return status;
}

test('desktop no longer ships a standalone marketplace renderer', () => {
  assert.equal(fs.existsSync(marketplaceRendererDir()), false);
});

test('window module does not export a marketplace BrowserWindow', () => {
  const loaded = loadWindowModule();
  try {
    const { windowMod } = loaded;
    assert.equal(typeof windowMod.openMarketplace, 'function');
    assert.equal(windowMod.openMarketplaceWindow, undefined);
    assert.equal(windowMod.closeMarketplaceWindow, undefined);
    assert.equal(windowMod.getMarketplaceWebContents, undefined);
  } finally {
    loaded.restore();
  }
});

test('openMarketplace shows the main window only when Harness is not ready', async () => {
  const loaded = loadWindowModule();
  try {
    const { windowMod, windows } = loaded;
    await windowMod.showBoot();
    const result = windowMod.openMarketplace();
    assert.equal(windows.length, 1);
    assert.equal(result, windows[0]);
    assert.deepEqual(windows[0].loadedFiles, ['C:/app/boot.html']);
    assert.equal(hasMarketSectionScript(windows[0].webContents.scripts), false);
  } finally {
    loaded.restore();
  }
});

test('openMarketplace does not create a window when the main window is missing', () => {
  const loaded = loadWindowModule();
  try {
    const { windowMod, windows } = loaded;
    assert.equal(windowMod.openMarketplace(), null);
    assert.equal(windows.length, 0);
  } finally {
    loaded.restore();
  }
});

test('openMarketplace jumps to the Settings market when Harness is ready', async () => {
  const loaded = loadWindowModule();
  try {
    const { windowMod, windows } = loaded;
    const harnessReady = waitForHarness(windowMod.showHarness);
    await new Promise((resolve) => setImmediate(resolve));
    const harness = windowMod.getHarnessWebContents();
    harness.hasApp = true;
    await harnessReady;
    await windowMod.openMarketplace();
    assert.equal(windows.length, 1);
    assert.equal(hasMarketSectionScript(harness.scripts), true);
  } finally {
    loaded.restore();
  }
});

test('openMarketplace keeps a pending jump until Harness is revealed', async () => {
  const loaded = loadWindowModule();
  try {
    const { windowMod, windows } = loaded;
    await windowMod.showBoot();
    windowMod.openMarketplace();
    assert.equal(windows.length, 1);
    assert.equal(hasMarketSectionScript(windows[0].webContents.scripts), false);

    const harnessReady = waitForHarness(windowMod.showHarness);
    await new Promise((resolve) => setImmediate(resolve));
    const harness = windowMod.getHarnessWebContents();
    harness.hasApp = true;
    await harnessReady;

    assert.equal(windows.length, 1);
    assert.equal(hasMarketSectionScript(harness.scripts), true);
    assert.equal(windows[0].loadedFiles.includes('C:/app/marketplace/index.html'), false);
  } finally {
    loaded.restore();
  }
});

test('openMarketplace does not open a second window when the settings jump fails', async () => {
  const loaded = loadWindowModule();
  try {
    const { windowMod, windows } = loaded;
    const harnessReady = waitForHarness(windowMod.showHarness);
    await new Promise((resolve) => setImmediate(resolve));
    const harness = windowMod.getHarnessWebContents();
    harness.hasApp = true;
    harness.settingsOpened = false;
    await harnessReady;
    const jumped = await windowMod.openMarketplace();
    assert.equal(windows.length, 1);
    assert.equal(jumped, false);
    assert.equal(windows[0].loadedFiles.includes('C:/app/marketplace/index.html'), false);
  } finally {
    loaded.restore();
  }
});

test('revealing Harness does not jump to marketplace unless a jump is pending', async () => {
  const loaded = loadWindowModule();
  try {
    const { windowMod } = loaded;
    const harnessReady = waitForHarness(windowMod.showHarness);
    await new Promise((resolve) => setImmediate(resolve));
    const harness = windowMod.getHarnessWebContents();
    harness.hasApp = true;
    await harnessReady;
    assert.equal(hasMarketSectionScript(harness.scripts), false);
  } finally {
    loaded.restore();
  }
});
