const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  isLoopbackHttpUrl,
  isHttpOrHttpsUrl,
  shouldAllowPrivilegedNavigate,
  shouldAllowPrivilegedRedirect,
} = require('./local-url.js');

/**
 * Minimal WebContents stand-in for attachPrivilegedNavigationGuards.
 * Electron is not loaded; the helper under test only uses EventEmitter APIs.
 */
function createFakeContents(currentUrl) {
  const contents = new EventEmitter();
  contents._url = currentUrl;
  contents._sent = [];
  contents.getURL = () => contents._url;
  contents.send = (channel, payload) => {
    contents._sent.push({ channel, payload });
  };
  contents.setWindowOpenHandler = (handler) => {
    contents._openHandler = handler;
  };
  return contents;
}

function loadWindowWithOpenExternal(opened) {
  const electronPath = require.resolve('electron');
  const previous = require.cache[electronPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      BrowserView: class {},
      BrowserWindow: class {},
      shell: { openExternal: (url) => { opened.push(url); } },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      app: { isPackaged: false, getAppPath: () => __dirname },
    },
  };
  delete require.cache[require.resolve('./window.js')];
  delete require.cache[require.resolve('./chrome.js')];
  delete require.cache[require.resolve('./paths.js')];
  const windowMod = require('./window.js');
  return {
    attachPrivilegedNavigationGuards: windowMod.attachPrivilegedNavigationGuards,
    restore() {
      if (previous) require.cache[electronPath] = previous;
      else delete require.cache[electronPath];
      delete require.cache[require.resolve('./window.js')];
    },
  };
}

test('attachPrivilegedNavigationGuards denies navigate/redirect and opens http(s) only', () => {
  const opened = [];
  const loaded = loadWindowWithOpenExternal(opened);
  try {
    const { attachPrivilegedNavigationGuards } = loaded;
    const contents = createFakeContents('http://127.0.0.1:3080/');
    attachPrivilegedNavigationGuards(contents, {
      allowUrl: isLoopbackHttpUrl,
      openDeniedExternal: true,
    });

    const navEvent = { preventDefault() { navEvent.prevented = true; }, prevented: false };
    contents.emit('will-navigate', navEvent, 'https://evil.example/');
    assert.equal(navEvent.prevented, true);
    assert.deepEqual(opened, ['https://evil.example/']);

    opened.length = 0;
    const redirectEvent = { preventDefault() { redirectEvent.prevented = true; }, prevented: false };
    contents.emit('will-redirect', redirectEvent, 'https://evil.example/r');
    assert.equal(redirectEvent.prevented, true);
    assert.deepEqual(opened, []);

    const fileNav = { preventDefault() { fileNav.prevented = true; }, prevented: false };
    contents.emit('will-navigate', fileNav, 'file:///C:/evil.html');
    assert.equal(fileNav.prevented, true);
    assert.deepEqual(opened, []);

    const allowNav = { preventDefault() { allowNav.prevented = true; }, prevented: false };
    contents.emit('will-navigate', allowNav, 'http://127.0.0.1:3080/app');
    assert.equal(allowNav.prevented, false);

    assert.equal(typeof contents._openHandler, 'function');
    assert.deepEqual(contents._openHandler({ url: 'https://docs.example/' }), { action: 'deny' });
    assert.ok(opened.includes('https://docs.example/'));
    opened.length = 0;
    contents._openHandler({ url: 'file:///C:/x' });
    assert.deepEqual(opened, []);
    opened.length = 0;
    contents._openHandler({ url: 'http://127.0.0.1:5173/' });
    assert.deepEqual(opened, ['http://127.0.0.1:5173/']);
    assert.deepEqual(contents._sent, []);
  } finally {
    loaded.restore();
  }
});

test('openDeniedLoopback sends cross-port loopback to that contents, not openExternal', () => {
  const opened = [];
  const loaded = loadWindowWithOpenExternal(opened);
  try {
    const { attachPrivilegedNavigationGuards } = loaded;
    const { isSameOriginLoopbackUrl } = require('./local-url.js');
    const harnessOrigin = 'http://127.0.0.1:3080/';
    const allowUrl = (url) => isSameOriginLoopbackUrl(url, harnessOrigin);
    const contents = createFakeContents(harnessOrigin);
    attachPrivilegedNavigationGuards(contents, {
      allowUrl,
      openDeniedExternal: true,
      openDeniedLoopback: true,
    });

    assert.deepEqual(contents._openHandler({ url: 'http://127.0.0.1:5173/app' }), { action: 'deny' });
    assert.deepEqual(contents._sent, [{
      channel: 'shell:open-preview-url',
      payload: { url: 'http://127.0.0.1:5173/app' },
    }]);
    assert.deepEqual(opened, []);

    contents._sent.length = 0;
    contents._openHandler({ url: 'http://0.0.0.0:4173/' });
    assert.deepEqual(contents._sent, [{
      channel: 'shell:open-preview-url',
      payload: { url: 'http://127.0.0.1:4173/' },
    }]);

    contents._sent.length = 0;
    contents._openHandler({ url: 'http://127.0.0.1:3080/chat' });
    assert.deepEqual(contents._sent, []);
    assert.deepEqual(opened, []);

    contents._openHandler({ url: 'https://docs.example/' });
    assert.deepEqual(opened, ['https://docs.example/']);
    assert.deepEqual(contents._sent, []);

    opened.length = 0;
    contents._openHandler({ url: 'file:///C:/x' });
    assert.deepEqual(opened, []);
    assert.deepEqual(contents._sent, []);

    contents._sent.length = 0;
    const navEvent = { preventDefault() { navEvent.prevented = true; }, prevented: false };
    contents.emit('will-navigate', navEvent, 'http://127.0.0.1:5173/');
    assert.equal(navEvent.prevented, true);
    assert.deepEqual(contents._sent, [{
      channel: 'shell:open-preview-url',
      payload: { url: 'http://127.0.0.1:5173/' },
    }]);
    assert.deepEqual(opened, []);

    contents._sent.length = 0;
    const remoteNav = { preventDefault() { remoteNav.prevented = true; }, prevented: false };
    contents.emit('will-navigate', remoteNav, 'https://evil.example/');
    assert.equal(remoteNav.prevented, true);
    assert.deepEqual(opened, ['https://evil.example/']);
    assert.deepEqual(contents._sent, []);

    opened.length = 0;
    contents._sent.length = 0;
    const redirectEvent = { preventDefault() { redirectEvent.prevented = true; }, prevented: false };
    contents.emit('will-redirect', redirectEvent, 'http://127.0.0.1:5173/r');
    assert.equal(redirectEvent.prevented, true);
    assert.deepEqual(opened, []);
    assert.deepEqual(contents._sent, []);

    const allowNav = { preventDefault() { allowNav.prevented = true; }, prevented: false };
    contents.emit('will-navigate', allowNav, 'http://127.0.0.1:3080/app');
    assert.equal(allowNav.prevented, false);
    assert.deepEqual(contents._sent, []);
  } finally {
    loaded.restore();
  }
});

test('showHarness load policy rejects non-loopback and rewrites 0.0.0.0', () => {
  const { rewriteLoopbackLoadUrl } = require('./local-url.js');
  assert.equal(rewriteLoopbackLoadUrl('https://evil.example/'), null);
  assert.equal(rewriteLoopbackLoadUrl('http://0.0.0.0:3080/'), 'http://127.0.0.1:3080/');
  assert.equal(
    shouldAllowPrivilegedNavigate({
      nextUrl: 'http://127.0.0.1:3080/',
      currentUrl: 'file://boot',
      allowUrl: isLoopbackHttpUrl,
    }),
    true,
  );
  assert.equal(
    shouldAllowPrivilegedRedirect({
      nextUrl: 'https://evil.example/',
      allowUrl: isLoopbackHttpUrl,
    }),
    false,
  );
  assert.equal(isHttpOrHttpsUrl('javascript:alert(1)'), false);
});

test('visual reply frame cannot navigate after changing its window name', () => {
  const opened = [];
  const loaded = loadWindowWithOpenExternal(opened);
  try {
    const contents = createFakeContents('http://127.0.0.1:3080/');
    loaded.attachPrivilegedNavigationGuards(contents, { allowUrl: isLoopbackHttpUrl, openDeniedExternal: true });
    const frame = { name: 'whale-visual-reply', frameTreeNodeId: 71 };
    contents.emit('frame-created', {}, { frame });
    frame.name = 'changed';
    const navigate = (target, url) => {
      const event = { frame: target, url, isMainFrame: false, prevented: false, preventDefault() { this.prevented = true; } };
      contents.emit('will-frame-navigate', event);
      return event.prevented;
    };
    assert.equal(navigate(frame, 'about:srcdoc'), false);
    assert.equal(navigate(frame, 'https://external.example/'), true);
    assert.equal(navigate(frame, 'http://127.0.0.1:3080/private'), true);
    assert.equal(navigate(frame, 'file:///C:/private'), true);
    assert.equal(navigate(frame, 'data:text/html,new-document'), true);
    assert.equal(navigate({ name: 'other', frameTreeNodeId: 72 }, 'https://external.example/'), false);
    assert.deepEqual(opened, []);
  } finally {
    loaded.restore();
  }
});

test('OpenUI frames retain their navigation veto across names and viewer updates', () => {
  const opened = [];
  const loaded = loadWindowWithOpenExternal(opened);
  try {
    const contents = createFakeContents('http://127.0.0.1:3080/');
    loaded.attachPrivilegedNavigationGuards(contents, { allowUrl: isLoopbackHttpUrl, openDeniedExternal: true });
    const navigate = (frame, url) => {
      const event = { frame, url, isMainFrame: false, prevented: false, preventDefault() { this.prevented = true; } };
      contents.emit('will-frame-navigate', event);
      return event.prevented;
    };
    const first = { name: 'whale-ui:message-1', frameTreeNodeId: 81 };
    contents.emit('frame-created', {}, { frame: first });
    first.name = 'renamed';
    const next = { name: '', frameTreeNodeId: 82 };
    contents.emit('frame-created', {}, { frame: next });
    next.name = 'whale-openui:message-2';
    assert.equal(navigate(next, 'about:srcdoc'), false);
    next.name = 'renamed-too';

    for (const frame of [first, next]) {
      assert.equal(navigate(frame, 'about:srcdoc'), false);
      for (const url of ['https://external.example/', 'http://127.0.0.1:3080/private',
        'file:///C:/private', 'data:text/html,new-document', 'about:blank']) {
        assert.equal(navigate(frame, url), true, `${frame.frameTreeNodeId}: ${url}`);
      }
    }
    assert.equal(navigate({ name: 'ordinary', frameTreeNodeId: 83 }, 'https://external.example/'), false);
    assert.deepEqual(opened, []);
  } finally {
    loaded.restore();
  }
});

test('window launcher and boot helpers guard destroyed windows and webContents', async () => {
  const electronPath = require.resolve('electron');
  const prevElectron = require.cache[electronPath];
  const chromePath = require.resolve('./chrome');
  const prevChrome = require.cache[chromePath];
  const detailsPath = require.resolve('./window-app-details');
  const prevDetails = require.cache[detailsPath];
  const recPath = require.resolve('./window-renderer-recovery');
  const prevRec = require.cache[recPath];
  const winPath = require.resolve('./window.js');
  const prevWin = require.cache[winPath];

  let urlThrows = false;
  let lastCreated = null;
  class FakeBrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        destroyed: false,
        isDestroyed: () => this.webContents.destroyed,
        isLoading: () => false,
        setWindowOpenHandler() {},
        getURL: () => {
          if (urlThrows) throw new Error('Object has been destroyed');
          return 'file:///C:/app/src/renderer/launcher.html';
        },
        send() { throw new Error('send should not run when destroyed'); },
      });
      lastCreated = this;
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    loadFile() { return Promise.resolve(); }
    show() {}
    showInactive() {}
    focus() {}
  }

  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      BrowserView: class {},
      BrowserWindow: FakeBrowserWindow,
      shell: { openExternal() {} },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      app: { isPackaged: false, getAppPath: () => __dirname },
    },
  };
  require.cache[chromePath] = {
    id: chromePath, filename: chromePath, loaded: true,
    exports: {
      shellWindowChrome: (o) => o,
      attachIntegratedChrome() {},
      hideNativeMenu() {},
      prepareHarnessChrome() {},
      syncHarnessChrome() {},
      currentTheme: () => ({}),
      markWindowTransparent() {},
      paintBackground() {},
      resetWindowMaterial() {},
    },
  };
  require.cache[detailsPath] = { id: detailsPath, filename: detailsPath, loaded: true, exports: { applyWindowsAppDetails() {} } };
  require.cache[recPath] = { id: recPath, filename: recPath, loaded: true, exports: { attachRendererRecovery() {} } };
  delete require.cache[winPath];
  try {
    const winMod = require('./window.js');
    const launcher = winMod.createLauncherWindow();
    assert.equal(launcher, lastCreated);

    urlThrows = true;
    await winMod.showLauncher({ activate: false });

    launcher.webContents.destroyed = true;
    winMod.sendToLauncher('test:ch', {});

    launcher.destroyed = true;
    winMod.sendToLauncher('test:ch', {});
    winMod.sendToBoot('test:ch', {});
    await winMod.showLauncher({ activate: false });
  } finally {
    if (prevElectron) require.cache[electronPath] = prevElectron;
    else delete require.cache[electronPath];
    if (prevChrome) require.cache[chromePath] = prevChrome;
    else delete require.cache[chromePath];
    if (prevDetails) require.cache[detailsPath] = prevDetails;
    else delete require.cache[detailsPath];
    if (prevRec) require.cache[recPath] = prevRec;
    else delete require.cache[recPath];
    if (prevWin) require.cache[winPath] = prevWin;
    else delete require.cache[winPath];
  }
});
