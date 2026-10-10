const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
  createPreviewController,
  DISCOVER_PORTS,
  discoverLocalServers,
  isAllowedPreviewUrl,
  previewRequestFilter,
  registerPreviewIpc,
} = require('./preview.js');
const { createPreviewSessionCache } = require('./preview-session.js');
const { createWorkspacePreviewController } = require('./preview-workspace.js');
const {
  FILE_PREVIEW_STATE_CHANNEL,
  createFilePreviewWindowController,
} = require('./preview-file-window.js');
const { createWorkspaceAuthority } = require('./workspace-authority.js');
const { scratchWorkspacePath } = require('./workspace-authority.js');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home.js');
const {
  PREVIEW_PIP_FRAME_CHANNEL,
  PREVIEW_PIP_FRAME_INTERVAL_MS,
  fitPictureInPictureContentSize,
} = require('./preview-pip-protocol.js');

const leftoverPrimaryCss = `--${['t', '3'].join('')}-primary`;

function fakePartitionSession() {
  return {
    storageClears: [],
    cacheClears: 0,
    getUserAgent() {
      return 'Mozilla/5.0';
    },
    setUserAgent() {},
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    clearStorageData(options) {
      this.storageClears.push(options);
      return Promise.resolve();
    },
    clearCache() {
      this.cacheClears += 1;
      return Promise.resolve();
    },
  };
}

function fakeAttach() {
  const navigations = [];
  const redirects = [];
  const loads = [];
  const destroyed = [];
  const views = [];

  function attach({ id, url, bounds, partition, extraHeaders }) {
    const listeners = new Map();
    const requestListeners = [];
    let zoomFactor = 1;
    const session = fakePartitionSession();
    const guestDebugger = {
      attached: false,
      attachCalls: [],
      commands: [],
      isAttached() {
        return this.attached;
      },
      attach(protocol) {
        this.attachCalls.push(protocol);
        this.attached = true;
      },
      sendCommand(method, params) {
        this.commands.push({ method, params });
        return Promise.resolve();
      },
    };
    const ipcListeners = new Map();
    const webContents = {
      history: [],
      index: -1,
      recordedEvents: [],
      session,
      debugger: guestDebugger,
      stopped: false,
      focused: false,
      destroyed: false,
      title: '',
      sent: [],
      captureRects: [],
      jpegQualities: [],
      ipc: {
        on(channel, listener) {
          const list = ipcListeners.get(channel) ?? [];
          list.push(listener);
          ipcListeners.set(channel, list);
        },
        removeListener(channel, listener) {
          const list = ipcListeners.get(channel) ?? [];
          ipcListeners.set(channel, list.filter((item) => item !== listener));
        },
        emit(channel, ...args) {
          for (const listener of ipcListeners.get(channel) ?? []) listener({}, ...args);
        },
      },
      send(channel, ...args) {
        this.sent.push([channel, ...args]);
      },
      focus() {
        this.focused = true;
      },
      isFocused() {
        return this.focused === true;
      },
      isDestroyed() {
        return this.destroyed === true;
      },
      getTitle() {
        return this.title;
      },
      on(event, listener) {
        this.recordedEvents.push(event);
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
      },
      once(event, listener) {
        const wrap = (...args) => {
          this.off(event, wrap);
          listener(...args);
        };
        this.on(event, wrap);
      },
      off(event, listener) {
        const list = listeners.get(event) ?? [];
        listeners.set(event, list.filter((item) => item !== listener));
      },
      emit(event, ...args) {
        for (const listener of listeners.get(event) ?? []) listener(...args);
      },
      loadURL(next, options) {
        loads.push({ id, url: next, options: options ?? null });
        view.url = next;
        if (this.index < 0) {
          this.history = [next];
          this.index = 0;
        } else {
          this.history = this.history.slice(0, this.index + 1);
          this.history.push(next);
          this.index = this.history.length - 1;
        }
        for (const listener of listeners.get('did-navigate') ?? []) listener();
        for (const listener of listeners.get('did-navigate-in-page') ?? []) listener();
      },
      getURL() {
        return this.history[this.index] ?? view.url;
      },
      canGoBack() {
        return this.index > 0;
      },
      canGoForward() {
        return this.index < this.history.length - 1;
      },
      goBack() {
        if (this.index > 0) this.index -= 1;
        view.url = this.history[this.index];
        for (const listener of listeners.get('did-navigate') ?? []) listener();
        for (const listener of listeners.get('did-navigate-in-page') ?? []) listener();
      },
      goForward() {
        if (this.index < this.history.length - 1) this.index += 1;
        view.url = this.history[this.index];
        for (const listener of listeners.get('did-navigate') ?? []) listener();
        for (const listener of listeners.get('did-navigate-in-page') ?? []) listener();
      },
      reload() {
        loads.push({ id, url: this.getURL(), options: { reload: true } });
      },
      reloadIgnoringCache() {
        loads.push({ id, url: this.getURL(), options: { reloadIgnoringCache: true } });
      },
      stop() {
        this.stopped = true;
      },
      setZoomFactor(next) {
        zoomFactor = next;
      },
      getZoomFactor() {
        return zoomFactor;
      },
      capturePage(rect) {
        this.captureRects.push(rect);
        const width = rect && rect.width ? rect.width : 100;
        const height = rect && rect.height ? rect.height : 80;
        return {
          toPNG: () => Buffer.from('png'),
          toJPEG: (quality) => {
            webContents.jpegQualities.push(quality);
            return Buffer.from('jpeg');
          },
          toDataURL: () => `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
          getSize: () => ({ width, height }),
        };
      },
      executed: [],
      executeJavaScript(code) {
        this.executed.push(code);
        if (typeof this.executeJavaScriptImpl === 'function') {
          return Promise.resolve(this.executeJavaScriptImpl(code));
        }
        return Promise.resolve(undefined);
      },
      isLoading() {
        return false;
      },
      openDevTools(options) {
        view.devTools = options ?? true;
      },
    };
    const view = {
      id,
      url,
      bounds: bounds ?? null,
      visible: true,
      partition,
      extraHeaders: extraHeaders ?? null,
      session,
      webContents,
      setBounds(next) {
        view.bounds = next;
      },
      setVisible(visible) {
        view.visible = visible;
      },
      webRequest: {
        onBeforeRequest(_filter, listener) {
          requestListeners.push(listener);
        },
      },
      destroy() {
        destroyed.push(id);
      },
      emit(event, ...args) {
        webContents.emit(event, ...args);
      },
      emitBeforeInput(input) {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        webContents.emit('before-input-event', event, input);
        return event;
      },
      emitRequest(next, resourceType = 'mainFrame') {
        let decision = { cancel: false };
        for (const listener of requestListeners) {
          listener({ url: next, resourceType }, (result) => { decision = result; });
        }
        return decision;
      },
      emitNavigate(next) {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const listener of listeners.get('will-navigate') ?? []) listener(event, next);
        navigations.push({ url: next, prevented: event.defaultPrevented });
        return event;
      },
      emitRedirect(next) {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const listener of listeners.get('will-redirect') ?? []) listener(event, next);
        redirects.push({ url: next, prevented: event.defaultPrevented });
        return event;
      },
    };
    views.push(view);
    return view;
  }

  return { attach, navigations, redirects, loads, destroyed, views };
}

function fakePipWindow() {
  const listeners = new Map();
  let destroyed = false;
  let contentSize = [480, 320];
  const sent = [];
  const window = {
    options: null,
    loadURLs: [],
    showInactiveCalls: 0,
    aspectRatioCalls: [],
    contentSizeCalls: [],
    alwaysOnTopCalls: [],
    closed: false,
    sent,
    webContents: {
      send(channel, payload) {
        sent.push([channel, payload]);
      },
    },
    loadURL(url) {
      window.loadURLs.push(url);
      return Promise.resolve();
    },
    showInactive() {
      window.showInactiveCalls += 1;
    },
    setAlwaysOnTop(...args) {
      window.alwaysOnTopCalls.push(args);
    },
    setVisibleOnAllWorkspaces() {},
    setAspectRatio(ratio) {
      window.aspectRatioCalls.push(ratio);
    },
    setContentSize(width, height, animate) {
      window.contentSizeCalls.push([width, height, animate]);
      contentSize = [width, height];
    },
    getContentSize() {
      return contentSize.slice();
    },
    isDestroyed() {
      return destroyed;
    },
    once(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    close() {
      if (destroyed) return;
      destroyed = true;
      window.closed = true;
      for (const listener of listeners.get('closed') ?? []) listener();
    },
    destroy() {
      window.close();
    },
  };
  return window;
}

function createPipFactory() {
  const created = [];
  function createPipWindow(options) {
    const win = fakePipWindow();
    win.options = options;
    created.push(win);
    return win;
  }
  return { createPipWindow, created };
}

function stubWideCapture(webContents) {
  webContents.capturePage = function capturePage(rect) {
    this.captureRects.push(rect);
    return {
      toPNG: () => Buffer.from('png'),
      toJPEG: (quality) => {
        this.jpegQualities.push(quality);
        return Buffer.from('jpeg-frame');
      },
      getSize: () => ({ width: 1280, height: 720 }),
    };
  };
}

test('isAllowedPreviewUrl accepts http://127.0.0.1 with any port', () => {
  assert.equal(isAllowedPreviewUrl('http://127.0.0.1:3000'), true);
  assert.equal(isAllowedPreviewUrl('http://127.0.0.1'), true);
  assert.equal(isAllowedPreviewUrl('http://127.0.0.1:8080/app'), true);
});

test('isAllowedPreviewUrl accepts IPv6 loopback with WHATWG brackets', () => {
  assert.equal(isAllowedPreviewUrl('http://[::1]:3000'), true);
  assert.equal(isAllowedPreviewUrl('http://[::1]/app'), true);
});

test('isAllowedPreviewUrl accepts any http(s) document URL', () => {
  assert.equal(isAllowedPreviewUrl('https://example.com'), true);
  assert.equal(isAllowedPreviewUrl('http://evil.example'), true);
  assert.equal(isAllowedPreviewUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedPreviewUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedPreviewUrl('ftp://example.com'), false);
});

test('isAllowedPreviewUrl accepts 0.0.0.0 and previewOpen rewrites it to 127.0.0.1', async () => {
  assert.equal(isAllowedPreviewUrl('http://0.0.0.0:5173/'), true);
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const result = await preview.open({ url: 'http://0.0.0.0:5173/app' });
  assert.equal(result.ok, true);
  assert.equal(result.url, 'http://127.0.0.1:5173/app');
  assert.deepEqual(fake.loads, [{ id: result.id, url: 'http://127.0.0.1:5173/app', options: null }]);
});

test('previewRequestFilter allows http(s) frames and remote subresources', () => {
  assert.deepEqual(previewRequestFilter({ url: 'https://example.com/', resourceType: 'mainFrame' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'https://example.com/embed', resourceType: 'subFrame' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'https://cdn.example/font.woff2', resourceType: 'font' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'https://cdn.example/app.js', resourceType: 'script' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'http://127.0.0.1:4173/app', resourceType: 'mainFrame' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'http://[::1]:3000/', resourceType: 'mainFrame' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'file:///etc/passwd', resourceType: 'mainFrame' }), { cancel: true });
  // Missing resourceType is treated as a document navigation.
  assert.deepEqual(previewRequestFilter({ url: 'https://example.com/page' }), { cancel: false });
  assert.deepEqual(previewRequestFilter({ url: 'file:///etc/passwd' }), { cancel: true });
});

test('previewOpen succeeds for http://127.0.0.1 and attaches an isolated view', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const result = await preview.open({ url: 'http://127.0.0.1:4173', bounds: { x: 10, y: 20, width: 400, height: 300 } });
  assert.equal(result.ok, true);
  assert.equal(typeof result.id, 'string');
  assert.equal(result.url, 'http://127.0.0.1:4173');
  assert.equal(fake.views.length, 1);
  assert.match(fake.views[0].partition, /^persist:dshd-preview-[0-9a-f]{20}$/);
  assert.equal(fake.views[0].extraHeaders, null);
  assert.deepEqual(fake.loads, [{ id: result.id, url: 'http://127.0.0.1:4173', options: null }]);
});

test('previewOpen rejects a file: URL and does not attach a view', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const result = await preview.open({ url: 'file:///etc/passwd' });
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Preview only opens http(s) URLs.');
  assert.equal(fake.views.length, 0);
  assert.equal(fake.loads.length, 0);
});

test('previewOpen hashes the persist partition from scope', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'https://example.com', scope: '/tmp/proj' });
  assert.equal(opened.ok, true);
  assert.equal(opened.url, new URL('https://example.com').href);
  assert.match(fake.views[0].partition, /^persist:dshd-preview-[0-9a-f]{20}$/);
  const empty = await preview.open({ url: 'https://example.com', scope: '' });
  assert.equal(empty.ok, true);
  assert.match(fake.views[1].partition, /^persist:dshd-preview-[0-9a-f]{20}$/);
  assert.notEqual(fake.views[0].partition, fake.views[1].partition);
});

test('onBeforeRequest allows http(s) iframes and CDN fonts and cancels file: documents', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  assert.equal(opened.ok, true);
  const view = fake.views[0];
  assert.deepEqual(view.emitRequest('https://example.com/iframe', 'subFrame'), { cancel: false });
  assert.deepEqual(view.emitRequest('http://127.0.0.1:3000/next', 'mainFrame'), { cancel: false });
  assert.deepEqual(view.emitRequest('https://fonts.googleapis.com/css', 'stylesheet'), { cancel: false });
  assert.deepEqual(view.emitRequest('file:///etc/passwd', 'mainFrame'), { cancel: true });
});

test('will-navigate allows http(s) and prevents file:', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  assert.equal(opened.ok, true);
  const view = fake.views[0];
  const navigate = view.emitNavigate('https://example.com/steal');
  const redirect = view.emitRedirect('https://evil.example/key');
  assert.equal(navigate.defaultPrevented, false);
  assert.equal(redirect.defaultPrevented, false);
  const local = view.emitNavigate('http://127.0.0.1:3000/next');
  assert.equal(local.defaultPrevented, false);
  const fileNav = view.emitNavigate('file:///etc/passwd');
  const fileRedirect = view.emitRedirect('file:///etc/passwd');
  assert.equal(fileNav.defaultPrevented, true);
  assert.equal(fileRedirect.defaultPrevented, true);
});

test('previewNavigate loads a public http(s) URL', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const allowed = await preview.navigate(opened.id, 'https://example.com');
  assert.equal(allowed.ok, true);
  assert.equal(fake.loads.at(-1).url, new URL('https://example.com').href);
  const denied = await preview.navigate(opened.id, 'file:///etc/passwd');
  assert.equal(denied.ok, false);
  const loopback = await preview.navigate(opened.id, 'http://127.0.0.1:3001');
  assert.equal(loopback.ok, true);
  assert.equal(fake.loads.at(-1).url, 'http://127.0.0.1:3001');
});

test('back, forward, reload, and state follow the guest history', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  await preview.navigate(opened.id, 'http://127.0.0.1:3000/app');
  const back = await preview.back(opened.id);
  assert.equal(back.ok, true);
  assert.equal(back.url, 'http://127.0.0.1:3000');
  assert.equal(back.canGoBack, false);
  assert.equal(back.canGoForward, true);
  const forward = await preview.forward(opened.id);
  assert.equal(forward.url, 'http://127.0.0.1:3000/app');
  const reloaded = await preview.reload(opened.id);
  assert.equal(reloaded.ok, true);
  const state = await preview.state(opened.id);
  assert.equal(state.url, 'http://127.0.0.1:3000/app');
  const tools = await preview.openDevTools(opened.id);
  assert.equal(tools.ok, true);
  assert.deepEqual(fake.views[0].devTools, { mode: 'detach' });
});

test('guest did-navigate reports the live URL to onState', async () => {
  const seen = [];
  const fake = fakeAttach();
  const preview = createPreviewController({
    attach: fake.attach,
    onState: (state) => { seen.push(state.url); },
  });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  assert.equal(seen.at(-1), 'http://127.0.0.1:3000');
  await preview.navigate(opened.id, 'http://127.0.0.1:3000/app');
  assert.equal(seen.at(-1), 'http://127.0.0.1:3000/app');
  await preview.back(opened.id);
  assert.equal(seen.at(-1), 'http://127.0.0.1:3000');
});

test('discoverLocalServers reports the loopback ports the probe accepts', async () => {
  const found = await discoverLocalServers(async (port) => port === 5173 || port === 3000);
  assert.deepEqual(found, [
    { url: 'http://127.0.0.1:3000', port: 3000 },
    { url: 'http://127.0.0.1:5173', port: 5173 },
  ]);
});

test('discoverLocalServers includes port 5175 from the common dev table', async () => {
  const found = await discoverLocalServers(async (port) => port === 5175);
  assert.deepEqual(found, [{ url: 'http://127.0.0.1:5175', port: 5175 }]);
});

test('DISCOVER_PORTS includes 9000', () => {
  assert.equal(DISCOVER_PORTS.includes(9000), true);
});

test('closeAll destroys every live view', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const first = await preview.open({ url: 'http://127.0.0.1:3000' });
  const second = await preview.open({ url: 'http://127.0.0.1:3001' });
  assert.equal(fake.views.length, 2);
  await preview.closeAll();
  assert.deepEqual(fake.destroyed.sort(), [first.id, second.id].sort());
  assert.equal(fake.views.length, 2); // destroy() marks the fake, the table is what cleared
  await assert.rejects(() => preview.navigate(first.id, 'http://127.0.0.1:3000'), /unknown preview id/);
});

test('workspace-file IPC serves a no-workspace session file through the production scratch authority', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-home-'));
  const boot = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-boot-'));
  const configPath = require.resolve('./config');
  const previousConfig = require.cache[configPath];
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  setDesktopDshHome(home);
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { loadConfig: () => ({ workspace: boot }) },
  };
  const live = registerPreviewIpc(ipcMain, { closeAll: async () => {} }, { authorize() {} });
  t.after(async () => {
    await live.closeAll();
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    clearDesktopDshHome();
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(boot, { recursive: true, force: true });
  });

  const scratch = scratchWorkspacePath(home);
  await fs.mkdir(scratch, { recursive: true });
  await fs.writeFile(path.join(scratch, 'pelican-bike.html'), '<h1>scratch</h1>');

  const opened = await handlers.get('shell:preview-workspace-file')(
    { sender: { id: 1 } },
    { cwd: scratch, relativePath: 'pelican-bike.html' },
  );
  assert.equal(opened.ok, true);
  assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/pelican-bike\.html$/);
  const served = await fetch(opened.url);
  assert.equal(served.status, 200);
  assert.equal(await served.text(), '<h1>scratch</h1>');
});

test('registerPreviewIpc exposes workspace-file and closeAll closes that server', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let closed = 0;
  let fileWindowClosed = 0;
  const fileWindowCalls = [];
  const workspacePreview = {
    fileUrl(input) {
      return { ok: true, url: `http://127.0.0.1:9/token/${input.relativePath}` };
    },
    close() {
      closed += 1;
    },
  };
  const live = registerPreviewIpc(ipcMain, {
    async closeAll() {},
  }, {
    authorize() {},
    workspacePreview,
    filePreviewWindow: {
      open(input) { fileWindowCalls.push(input); return { ok: true }; },
      close() { fileWindowClosed += 1; },
    },
  });
  assert.deepEqual(
    await handlers.get('shell:preview-workspace-file')(
      { sender: { id: 1 } },
      { cwd: '/tmp', relativePath: 'index.html' },
    ),
    { ok: true, url: 'http://127.0.0.1:9/token/index.html' },
  );
  assert.deepEqual(
    await handlers.get('shell:preview-open-file-window')(
      { sender: { id: 1 } },
      { cwd: '/tmp', relativePath: 'image.png' },
    ),
    { ok: true },
  );
  assert.deepEqual(fileWindowCalls, [{ cwd: '/tmp', relativePath: 'image.png' }]);
  await live.closeAll();
  assert.equal(fileWindowClosed, 1);
  assert.equal(closed, 1);
});

test('floating-window IPC normalizes an absolute scratch file through the real preview stack', async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-ipc-workspace-'));
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-ipc-scratch-'));
  const note = path.join(scratch, 'note.txt');
  await fs.writeFile(note, 'scratch text\n');
  const authority = createWorkspaceAuthority({ workspace, extraWorkspaces: [scratch] });
  const handlers = new Map();
  const previewHandlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
      previewHandlers.set(channel, handler);
    },
  };
  const windows = [];
  const live = createPreviewController({ attach: fakeAttach().attach });
  registerPreviewIpc(ipcMain, live, {
    authorize() {},
    workspaceAuthority: authority,
    createFilePreviewWindow() {
      let destroyed = false;
      let onClosed = null;
      const calls = [];
      const webContents = {
        mainFrame: null,
        setWindowOpenHandler() {},
      };
      webContents.mainFrame = webContents;
      const win = {
        calls,
        webContents,
        isDestroyed: () => destroyed,
        setMenuBarVisibility() {},
        setAlwaysOnTop() {},
        setTitle(value) { calls.push(['title', value]); },
        setBackgroundColor() {},
        once(event, handler) {
          if (event === 'closed') onClosed = handler;
        },
        async loadFile(value) { calls.push(['load', value]); },
        showInactive() { calls.push(['showInactive']); },
        close() {
          if (destroyed) return;
          destroyed = true;
          calls.push(['close']);
          onClosed?.();
        },
      };
      windows.push(win);
      return win;
    },
    getTheme: () => ({ scheme: 'light' }),
    getLocale: () => 'en',
    filePreviewPreloadPath: 'preview-preload.js',
    filePreviewHtmlPath: 'preview.html',
  });
  t.after(async () => {
    await live.closeAll();
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(scratch, { recursive: true, force: true });
  });

  const sender = { id: 1, isDestroyed: () => false };
  assert.deepEqual(
    await handlers.get('shell:preview-open-file-window')({ sender }, { absolutePath: note }),
    { ok: true },
  );
  assert.equal(windows.length, 1);
  const state = await previewHandlers.get(FILE_PREVIEW_STATE_CHANNEL)({
    sender: windows[0].webContents,
    senderFrame: windows[0].webContents.mainFrame,
  });
  assert.equal(state.name, 'note.txt');
  assert.equal(state.text, 'scratch text\n');
  assert.match(state.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/note\.txt$/);
});

test('floating-window IPC rejects unauthorized senders before opening a window', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let opened = 0;
  registerPreviewIpc(ipcMain, { closeAll: async () => {} }, {
    authorize(event) {
      if (event.sender.id !== 1) {
        const error = new Error('Unauthorized IPC sender');
        error.code = 'ERR_DSH_IPC_SENDER';
        throw error;
      }
    },
    workspaceAuthority: createWorkspaceAuthority({ workspace: os.tmpdir() }),
    filePreviewWindow: {
      open() { opened += 1; return { ok: true }; },
      close() {},
    },
  });
  await assert.rejects(
    () => handlers.get('shell:preview-open-file-window')(
      { sender: { id: 2, isDestroyed: () => false } },
      { cwd: os.tmpdir(), relativePath: 'note.txt' },
    ),
    { code: 'ERR_DSH_IPC_SENDER' },
  );
  assert.equal(opened, 0);
});

test('floating-window IPC closes a delayed open when its sender was replaced', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let resolveOpen = null;
  let closed = 0;
  registerPreviewIpc(ipcMain, {
    state() { return { ok: true }; },
    closeAll: async () => {},
  }, {
    authorize() {},
    filePreviewWindow: {
      open() {
        return new Promise((resolve) => { resolveOpen = resolve; });
      },
      close() { closed += 1; },
    },
  });

  const first = { id: 1, isDestroyed: () => false };
  const second = { id: 2, isDestroyed: () => false };
  const pending = handlers.get('shell:preview-open-file-window')(
    { sender: first },
    { cwd: os.tmpdir(), relativePath: 'note.txt' },
  );
  await handlers.get('shell:preview-state')({ sender: second }, 'preview-1');
  resolveOpen({ ok: true });
  assert.deepEqual(await pending, { ok: false, message: 'Unauthorized IPC sender' });
  assert.equal(closed, 1);
});

test('registerPreviewIpc authorizes state-only requests before dispatch', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let authorized = 0;
  const controller = {
    state(id) { return { ok: true, id }; },
  };
  registerPreviewIpc(ipcMain, controller, {
    authorize(event) {
      assert.equal(event.sender.id, 9);
      authorized += 1;
    },
  });
  assert.deepEqual(
    await handlers.get('shell:preview-state')({ sender: { id: 9 } }, 'preview-1'),
    { ok: true, id: 'preview-1' },
  );
  assert.equal(authorized, 1);
});

/**
 * Build a fake IPC sender shaped like the subset of `WebContents` that
 * `registerPreviewIpc` binds to. `off` is required: the reaper must be able to
 * detach the listeners it installed on a host it abandons.
 */
function fakeHost(id) {
  const listeners = new Map();
  const sender = {
    id,
    isDestroyed: () => false,
    send() {},
    on(name, fn) { listeners.set(name, fn); },
    once(name, fn) { listeners.set(name, fn); },
    off(name) { listeners.delete(name); },
    fire(name) { listeners.get(name)?.(); },
    listenerNames: () => [...listeners.keys()],
  };
  return { sender, fire: (name) => sender.fire(name) };
}

async function settleTeardown() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

async function deferredStaleOpenScenario(closeFailure) {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const { attach } = fakeAttach();
  const live = createPreviewController({ attach });
  const originalOpen = live.open.bind(live);
  let settleStaleOpen = null;
  let deferNext = true;
  live.open = (input) => {
    if (!deferNext) return originalOpen(input);
    deferNext = false;
    return new Promise((resolve) => {
      settleStaleOpen = () => resolve(originalOpen(input));
    });
  };
  const closeIds = [];
  live.close = (id) => {
    closeIds.push(id);
    return closeFailure();
  };
  const failures = [];
  registerPreviewIpc(ipcMain, live, {
    authorize() {},
    onTeardownError(error) {
      failures.push(error);
    },
  });

  const replaced = fakeHost(1);
  const current = fakeHost(2);
  const staleOpen = handlers.get('shell:preview-open')(
    { sender: replaced.sender },
    { url: 'http://127.0.0.1:9/stale' },
  );
  const currentPreview = await handlers.get('shell:preview-open')(
    { sender: current.sender },
    { url: 'http://127.0.0.1:9/current' },
  );
  assert.equal(currentPreview.ok, true, 'the successor preview opens normally');

  settleStaleOpen();
  return { handlers, current, currentPreview, staleOpen, failures, closeIds };
}

test('preview host teardown closes only the resources the leaving host owned', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const { attach, destroyed } = fakeAttach();
  let fileClosed = 0;
  let workspaceClosed = 0;
  const live = createPreviewController({ attach });
  registerPreviewIpc(ipcMain, live, {
    authorize() {},
    filePreviewWindow: {
      async open() { return { ok: true }; },
      close() { fileClosed += 1; },
    },
    workspacePreview: {
      async fileUrl() { return { ok: true, url: 'http://127.0.0.1:9/token' }; },
      close() { workspaceClosed += 1; },
    },
  });

  const first = fakeHost(1);
  const opened = await handlers.get('shell:preview-open')(
    { sender: first.sender },
    { url: 'http://127.0.0.1:9/one' },
  );
  assert.equal(opened.ok, true);
  await handlers.get('shell:preview-open-file-window')(
    { sender: first.sender },
    { cwd: 'C:\\workspace', relativePath: 'notes.md' },
  );
  await handlers.get('shell:preview-workspace-file')(
    { sender: first.sender },
    { cwd: 'C:\\workspace', relativePath: 'pixel.png' },
  );
  assert.equal(fileClosed, 0, 'owning a window must not close it immediately');
  assert.equal(workspaceClosed, 0);

  first.fire('did-navigate');
  await settleTeardown();
  assert.deepEqual(destroyed, [opened.id], 'the leaving host loses exactly its own preview');
  assert.equal(fileClosed, 1);
  assert.equal(workspaceClosed, 1);

  // A host that never created anything must not trigger a sweep at all: the
  // resources it never owned are already closed or still in use.
  const idle = fakeHost(2);
  await handlers.get('shell:preview-close')({ sender: idle.sender }, 'not-a-preview');
  idle.fire('render-process-gone');
  await settleTeardown();
  assert.equal(fileClosed, 1, 'a resourceless host must not sweep unrelated windows');
  assert.equal(workspaceClosed, 1);
});

test('a replacement host keeps the preview it opens while the previous host is reaped', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const { attach, destroyed } = fakeAttach();
  const live = createPreviewController({ attach });
  registerPreviewIpc(ipcMain, live, { authorize() {} });

  const first = fakeHost(1);
  const second = fakeHost(2);
  const openedFirst = await handlers.get('shell:preview-open')(
    { sender: first.sender },
    { url: 'http://127.0.0.1:9/one' },
  );
  assert.equal(openedFirst.ok, true);

  // The leaving host is reaped and the successor opens its preview before the
  // deferred teardown microtask runs. A generation-blind sweep would destroy
  // the new preview while still reporting success to the new host.
  first.fire('did-navigate');
  const openedSecond = await handlers.get('shell:preview-open')(
    { sender: second.sender },
    { url: 'http://127.0.0.1:9/two' },
  );
  assert.equal(openedSecond.ok, true);
  await settleTeardown();

  assert.deepEqual(destroyed, [openedFirst.id], 'only the replaced host loses its view');
  const state = await handlers.get('shell:preview-state')(
    { sender: second.sender },
    openedSecond.id,
  );
  assert.equal(state.ok, true);
  assert.equal(state.url, 'http://127.0.0.1:9/two');
  const navigated = await handlers.get('shell:preview-navigate')(
    { sender: second.sender },
    openedSecond.id,
    'http://127.0.0.1:9/three',
  );
  assert.equal(navigated.ok, true, 'the successor preview must stay usable after cleanup');
});

test('a slow teardown from the replaced host leaves the successor preview usable', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const { attach, destroyed } = fakeAttach();
  const live = createPreviewController({ attach });
  const releases = [];
  const originalClose = live.close.bind(live);
  live.close = (id) => new Promise((resolve) => {
    releases.push(() => resolve(originalClose(id)));
  });
  registerPreviewIpc(ipcMain, live, { authorize() {} });

  const first = fakeHost(1);
  const second = fakeHost(2);
  const openedFirst = await handlers.get('shell:preview-open')(
    { sender: first.sender },
    { url: 'http://127.0.0.1:9/one' },
  );
  first.fire('did-navigate');
  const openedSecond = await handlers.get('shell:preview-open')(
    { sender: second.sender },
    { url: 'http://127.0.0.1:9/two' },
  );
  assert.equal(openedSecond.ok, true);
  assert.equal(releases.length, 1, 'the replaced host teardown must be in flight');

  // Cleanup has not settled yet; the successor already has to be usable.
  const during = await handlers.get('shell:preview-state')(
    { sender: second.sender },
    openedSecond.id,
  );
  assert.equal(during.ok, true);

  for (const release of releases.splice(0)) release();
  await settleTeardown();

  assert.deepEqual(destroyed, [openedFirst.id]);
  const navigated = await handlers.get('shell:preview-navigate')(
    { sender: second.sender },
    openedSecond.id,
    'http://127.0.0.1:9/three',
  );
  assert.equal(navigated.ok, true, 'a slow teardown must not reach the successor preview');
});

test('a pending open from the replaced host is closed instead of being adopted', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const { attach, destroyed } = fakeAttach();
  const live = createPreviewController({ attach });
  const originalOpen = live.open.bind(live);
  let settleStaleOpen = null;
  let deferNext = true;
  live.open = (input) => {
    if (!deferNext) return originalOpen(input);
    deferNext = false;
    return new Promise((resolve) => {
      settleStaleOpen = () => resolve(originalOpen(input));
    });
  };
  registerPreviewIpc(ipcMain, live, { authorize() {} });

  const first = fakeHost(1);
  const second = fakeHost(2);
  const staleOpen = handlers.get('shell:preview-open')(
    { sender: first.sender },
    { url: 'http://127.0.0.1:9/one' },
  );
  const openedSecond = await handlers.get('shell:preview-open')(
    { sender: second.sender },
    { url: 'http://127.0.0.1:9/two' },
  );
  assert.equal(openedSecond.ok, true);

  // The replaced host's in-flight open settles only after its successor owns
  // the window; it must be refused and closed, never adopted.
  settleStaleOpen();
  await assert.rejects(staleOpen, /Unauthorized IPC sender/);
  await settleTeardown();
  assert.equal(destroyed.length, 1, 'exactly the stale result is destroyed');
  assert.notEqual(destroyed[0], openedSecond.id, 'the successor preview must survive');

  const state = await handlers.get('shell:preview-state')(
    { sender: second.sender },
    openedSecond.id,
  );
  assert.equal(state.ok, true);
  assert.equal(state.url, 'http://127.0.0.1:9/two');
});

test('a rejecting stale-open close is reported and leaves the successor preview usable', async () => {
  const closeError = new Error('stale preview close rejected');
  const {
    handlers,
    current,
    currentPreview,
    staleOpen,
    failures,
    closeIds,
  } = await deferredStaleOpenScenario(() => Promise.reject(closeError));

  await assert.rejects(staleOpen, (error) => {
    assert.equal(error.message, 'Unauthorized IPC sender');
    assert.equal(error.code, 'ERR_DSH_IPC_SENDER');
    return true;
  });
  assert.equal(closeIds.length, 1, 'the stale result was closed exactly once');
  assert.notEqual(closeIds[0], currentPreview.id, 'the successor preview was not closed');
  assert.deepEqual(failures, [closeError], 'the rejected close reached onTeardownError');

  const state = await handlers.get('shell:preview-state')(
    { sender: current.sender },
    currentPreview.id,
  );
  assert.equal(state.ok, true);
  assert.equal(state.url, 'http://127.0.0.1:9/current');
  const navigated = await handlers.get('shell:preview-navigate')(
    { sender: current.sender },
    currentPreview.id,
    'http://127.0.0.1:9/current-next',
  );
  assert.equal(navigated.ok, true, 'the successor preview remains usable after the failed close');
});

test('a synchronously throwing stale-open close is reported and leaves the successor preview usable', async () => {
  const closeError = new Error('stale preview close threw');
  const {
    handlers,
    current,
    currentPreview,
    staleOpen,
    failures,
    closeIds,
  } = await deferredStaleOpenScenario(() => {
    throw closeError;
  });

  await assert.rejects(staleOpen, (error) => {
    assert.equal(error.message, 'Unauthorized IPC sender');
    assert.equal(error.code, 'ERR_DSH_IPC_SENDER');
    return true;
  });
  assert.equal(closeIds.length, 1, 'the stale result was closed exactly once');
  assert.notEqual(closeIds[0], currentPreview.id, 'the successor preview was not closed');
  assert.deepEqual(failures, [closeError], 'the synchronous throw reached onTeardownError');

  const state = await handlers.get('shell:preview-state')(
    { sender: current.sender },
    currentPreview.id,
  );
  assert.equal(state.ok, true);
  assert.equal(state.url, 'http://127.0.0.1:9/current');
  const navigated = await handlers.get('shell:preview-navigate')(
    { sender: current.sender },
    currentPreview.id,
    'http://127.0.0.1:9/current-next',
  );
  assert.equal(navigated.ok, true, 'the successor preview remains usable after the failed close');
});

test('overlapping delayed preview-open results cannot install a stale host listener', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const opens = [];
  const calls = [];
  const live = {
    state(id) { return { ok: true, id }; },
    close(id) { calls.push(['close', id]); },
    open(input) {
      let resolve;
      const promise = new Promise((next) => { resolve = next; });
      opens.push({ input, resolve });
      return promise;
    },
    closeAll: async () => {},
  };
  registerPreviewIpc(ipcMain, live, {
    authorize() {},
    workspacePreview: { fileUrl: () => ({ ok: true, url: 'http://127.0.0.1:9/token' }), close() {} },
    filePreviewWindow: { open: () => ({ ok: true }), close() {} },
  });
  function sender(id) {
    const listeners = [];
    return {
      id,
      isDestroyed: () => false,
      send() {},
      on(name) { listeners.push(name); },
      once(name) { listeners.push(name); },
      listenerNames: listeners,
    };
  }
  const oldHost = sender(10);
  const newHost = sender(11);
  const first = handlers.get('shell:preview-open')({ sender: oldHost }, { url: 'http://127.0.0.1:9/one' });
  oldHost.isDestroyed = () => true;
  const second = handlers.get('shell:preview-open')({ sender: newHost }, { url: 'http://127.0.0.1:9/two' });
  opens[0].resolve({ ok: true, id: 'pv-old' });
  opens[1].resolve({ ok: true, id: 'pv-new' });
  await assert.rejects(first, /Unauthorized IPC sender/);
  assert.deepEqual(await second, { ok: true, id: 'pv-new' });
  // The replacement host owns the late result; the orphaned preview is closed.
  assert.deepEqual(calls, [['close', 'pv-old']]);
  assert.equal(newHost.listenerNames.includes('did-navigate'), true);
  assert.equal(newHost.listenerNames.includes('render-process-gone'), true);
  assert.equal(newHost.listenerNames.includes('destroyed'), true);
  await handlers.get('shell:preview-state')({ sender: newHost }, 'pv-new');
});

test('a stale teardown never closes a shared preview singleton its successor claimed', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const { attach } = fakeAttach();
  const live = createPreviewController({ attach });
  // Model the real controllers instead of recording calls. Each keeps exactly
  // one window / one listening server, reuses it while alive, and nulls it in
  // close(). Crucially, `fileUrl()` awaits and then builds its URL from the
  // *current* port, exactly like preview-workspace.js, whose `close()` resets
  // the module-level `port` to 0. A stale teardown that fires inside that await
  // therefore hands the successor a dead `:0` URL — the observable symptom this
  // test discriminates. Without the await the ordering bug stays invisible.
  let currentWindow = null;
  let currentServer = null;
  let port = 0;
  let serverSeq = 0;
  registerPreviewIpc(ipcMain, live, {
    authorize() {},
    filePreviewWindow: {
      async open() {
        if (!currentWindow || currentWindow.closed) currentWindow = { closed: false };
        const claimed = currentWindow;
        await Promise.resolve();
        if (claimed.closed) return { ok: false, message: 'Preview request was replaced.' };
        return { ok: true };
      },
      close() {
        if (currentWindow) {
          currentWindow.closed = true;
          currentWindow = null;
        }
      },
    },
    workspacePreview: {
      async fileUrl() {
        if (!currentServer || currentServer.closed) {
          serverSeq += 1;
          currentServer = { id: serverSeq, closed: false };
          port = 9000 + serverSeq;
        }
        await Promise.resolve();
        return { ok: true, url: `http://127.0.0.1:${port}/token` };
      },
      close() {
        if (currentServer) {
          currentServer.closed = true;
          currentServer = null;
          port = 0;
        }
      },
    },
  });

  const first = fakeHost(1);
  const firstUrl = await handlers.get('shell:preview-workspace-file')(
    { sender: first.sender },
    { cwd: 'C:\\workspace', relativePath: 'pixel.png' },
  );
  assert.match(firstUrl.url, /:9\d{3}\/token$/, 'the first host gets a live server URL');

  // The successor's *first* call after the replacement is the shared-server
  // request. Its claim has to be registered before `fileUrl()` awaits, because
  // the replaced host's deferred teardown runs at that first suspension point.
  // A claim registered after the await arrives too late: the stale teardown
  // closes the server, and the successor is handed the `:0` port that `close()`
  // leaves behind.
  const second = fakeHost(2);
  first.fire('did-navigate');
  const secondUrl = await handlers.get('shell:preview-workspace-file')(
    { sender: second.sender },
    { cwd: 'C:\\workspace', relativePath: 'icon.png' },
  );
  await settleTeardown();

  assert.equal(secondUrl.ok, true, "the successor's workspace file must resolve");
  assert.notEqual(secondUrl.url, 'http://127.0.0.1:0/token', 'a stale teardown left the port at 0');
  assert.match(
    secondUrl.url,
    /:9\d{3}\/token$/,
    'the successor must receive a live port, never the :0 left by a stale teardown',
  );
  assert.equal(currentServer?.closed, false, "the successor's server must stay alive");
});

/**
 * Build the real workspace-preview + floating-window pair with only the native
 * window and workspace-authority boundaries faked. `authority` maps cwd to an
 * isolated temp directory; the real controller owns the HTTP server, so the
 * returned URL is a real loopback port serving real bytes.
 */
async function realPreviewPair(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-real-'));
  const authority = createWorkspaceAuthority({ workspace: cwd });
  const workspacePreview = createWorkspacePreviewController({ authority });
  const fileWindows = [];
  const filePreviewHandlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      filePreviewHandlers.set(channel, handler);
    },
  };
  const filePreviewWindow = createFilePreviewWindowController({
    ipcMain,
    workspacePreview,
    createWindow() {
      const calls = [];
      let destroyed = false;
      let onClosed = null;
      const webContents = {
        setWindowOpenHandler() {},
      };
      webContents.mainFrame = webContents;
      const win = {
        calls,
        webContents,
        isDestroyed: () => destroyed,
        once(event, handler) {
          if (event === 'closed') onClosed = handler;
        },
        async loadFile(value) {
          calls.push(['load', value]);
        },
        showInactive() {
          calls.push(['showInactive']);
        },
        show() {
          calls.push(['show']);
        },
        close() {
          if (destroyed) return;
          destroyed = true;
          calls.push(['close']);
          onClosed?.();
        },
      };
      fileWindows.push(win);
      return win;
    },
    readFile: async () => ({ ok: true, text: 'hello' }),
    getTheme: () => ({ scheme: 'light' }),
    getLocale: () => 'en',
    preloadPath: 'preview-preload.js',
    htmlPath: 'preview.html',
    platform: 'win32',
  });
  t.after(async () => {
    await workspacePreview.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });
  return { cwd, workspacePreview, filePreviewWindow, fileWindows, filePreviewHandlers };
}

test('floating-window open keeps the workspace server alive across host replacement (D1)', async (t) => {
  const {
    cwd,
    workspacePreview,
    filePreviewWindow,
    fileWindows,
    filePreviewHandlers,
  } = await realPreviewPair(t);
  await fs.writeFile(path.join(cwd, 'note.html'), '<h1>host A</h1>');
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const live = createPreviewController({ attach: fakeAttach().attach });
  registerPreviewIpc(ipcMain, live, {
    authorize() {},
    workspacePreview,
    filePreviewWindow,
  });

  const first = fakeHost(1);
  const opened = await handlers.get('shell:preview-open-file-window')(
    { sender: first.sender },
    { cwd, relativePath: 'note.html' },
  );
  assert.deepEqual(opened, { ok: true });
  // Give host A an owned workspace server as well: the floating-window
  // entry point must transfer that ownership to host B before host A's
  // deferred teardown closes it.
  const firstServerUrl = await handlers.get('shell:preview-workspace-file')(
    { sender: first.sender },
    { cwd, relativePath: 'note.html' },
  );
  assert.equal(firstServerUrl.ok, true);
  const fileState = await filePreviewHandlers.get(FILE_PREVIEW_STATE_CHANNEL)({
    sender: fileWindows[0].webContents,
    senderFrame: fileWindows[0].webContents.mainFrame,
  });
  const firstUrl = fileState.url;
  assert.match(firstUrl, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/note\.html$/);

  const second = fakeHost(2);
  first.fire('did-navigate');
  const openedSecond = await handlers.get('shell:preview-open-file-window')(
    { sender: second.sender },
    { cwd, relativePath: 'note.html' },
  );
  assert.deepEqual(openedSecond, { ok: true });
  await settleTeardown();

  // D1: without the floating-window entry point also claiming
  // `workspace-preview`, host B does not take ownership and host A's teardown
  // closes the server that host B's window and URL still depend on.
  const secondState = await filePreviewHandlers.get(FILE_PREVIEW_STATE_CHANNEL)({
    sender: fileWindows[0].webContents,
    senderFrame: fileWindows[0].webContents.mainFrame,
  });
  assert.match(secondState.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/note\.html$/);
  const served = await fetch(secondState.url);
  assert.equal(served.status, 200);
  assert.equal(await served.text(), '<h1>host A</h1>');
});

test('floating-window-only host leaves no workspace server behind after teardown (D1)', async (t) => {
  const {
    cwd,
    workspacePreview,
    filePreviewWindow,
    fileWindows,
    filePreviewHandlers,
  } = await realPreviewPair(t);
  await fs.writeFile(path.join(cwd, 'only.html'), '<h1>only A</h1>');
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const live = createPreviewController({ attach: fakeAttach().attach });
  registerPreviewIpc(ipcMain, live, {
    authorize() {},
    workspacePreview,
    filePreviewWindow,
  });

  const first = fakeHost(1);
  const opened = await handlers.get('shell:preview-open-file-window')(
    { sender: first.sender },
    { cwd, relativePath: 'only.html' },
  );
  assert.deepEqual(opened, { ok: true });
  const fileState = await filePreviewHandlers.get(FILE_PREVIEW_STATE_CHANNEL)({
    sender: fileWindows[0].webContents,
    senderFrame: fileWindows[0].webContents.mainFrame,
  });
  const url = fileState.url;
  const served = await fetch(url);
  assert.equal(served.status, 200);
  assert.equal(await served.text(), '<h1>only A</h1>');

  // D1: the floating-window handler itself must register the
  // `workspace-preview` claim. A host whose only entry point is that handler
  // would otherwise exit without closing (orphaning) the server it started.
  first.fire('did-navigate');
  await settleTeardown();
  let refused = false;
  try {
    await fetch(url);
  } catch (error) {
    refused = error?.cause?.code === 'ECONNREFUSED';
  }
  assert.equal(refused, true, 'teardown must close the server the floating-window-only host started');
  assert.equal(fileWindows[0].isDestroyed(), true);
});

test('a successor claim made during teardown still prevents its singleton close (D2)', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const { attach } = fakeAttach();
  const live = createPreviewController({ attach });
  let workspaceClosed = 0;
  let windowClosed = 0;
  let markCloseEntered;
  let releaseClose;
  let successorClaim = null;
  const closeEntered = new Promise((resolve) => {
    markCloseEntered = resolve;
  });
  const closeBarrier = new Promise((resolve) => {
    releaseClose = resolve;
  });
  let successorClaimed = false;
  const second = fakeHost(2);
  const first = fakeHost(1);
  const originalClose = live.close.bind(live);
  live.close = async (id) => {
    markCloseEntered();
    // Claim synchronously from inside the first queued teardown close, while
    // the singleton closes are still queued behind it.
    successorClaim = handlers.get('shell:preview-open-file-window')(
      { sender: second.sender },
      { cwd: 'C:\\workspace', relativePath: 'two.html' },
    );
    await closeBarrier;
    return originalClose(id);
  };

  registerPreviewIpc(ipcMain, live, {
    authorize() {},
    workspacePreview: {
      async fileUrl() {
        return { ok: true, url: 'http://127.0.0.1:9/token' };
      },
      close() {
        workspaceClosed += 1;
      },
    },
    filePreviewWindow: {
      async open() {
        return { ok: true };
      },
      close() {
        windowClosed += 1;
      },
    },
  });

  await handlers.get('shell:preview-open')(
    { sender: first.sender },
    { url: 'http://127.0.0.1:9/one' },
  );
  await handlers.get('shell:preview-open-file-window')(
    { sender: first.sender },
    { cwd: 'C:\\workspace', relativePath: 'one.html' },
  );

  // D2: teardown selected generation A's singletons and queued the closes.
  // The first queued close synchronously gives generation B ownership before
  // pausing at the barrier. The singleton closes queued behind it then run
  // after the claim, so the pre-close re-validation must skip generation A's
  // stale closes.
  first.fire('did-navigate');
  await closeEntered;
  const successorResult = await successorClaim;
  assert.deepEqual(successorResult, { ok: true });
  successorClaimed = true;
  releaseClose();
  await settleTeardown();

  assert.equal(workspaceClosed, 0, 'the successor owns the server; the stale close must be skipped');
  assert.equal(windowClosed, 0, 'the successor also owns the floating window');
  assert.equal(successorClaimed, true, 'the successor claim happened while teardown was suspended');
});

test('a rejecting singleton close is reported without blocking the other owned closes (D2)', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const { attach, destroyed } = fakeAttach();
  const live = createPreviewController({ attach });
  const failures = [];
  let windowClosed = 0;
  let previewClosed = 0;
  const closeError = new Error('window close exploded');
  const originalClose = live.close.bind(live);
  live.close = async (id) => {
    previewClosed += 1;
    return originalClose(id);
  };

  registerPreviewIpc(ipcMain, live, {
    authorize() {},
    // D2's teardown fan-out funnels every rejected close here instead of
    // letting one failure abort the microtask before the other closes run.
    onTeardownError(error) {
      failures.push(error);
    },
    workspacePreview: {
      async fileUrl() {
        return { ok: true, url: 'http://127.0.0.1:9/token' };
      },
      close() {
        throw new Error('workspace close exploded');
      },
    },
    filePreviewWindow: {
      async open() {
        return { ok: true };
      },
      close() {
        windowClosed += 1;
        throw closeError;
      },
    },
  });

  const first = fakeHost(1);
  const opened = await handlers.get('shell:preview-open')(
    { sender: first.sender },
    { url: 'http://127.0.0.1:9/boom' },
  );
  await handlers.get('shell:preview-open-file-window')(
    { sender: first.sender },
    { cwd: 'C:\\workspace', relativePath: 'boom.html' },
  );
  first.fire('did-navigate');
  await settleTeardown();

  assert.deepEqual(
    failures.map((error) => error.message).sort(),
    ['window close exploded', 'workspace close exploded'].sort(),
    'every rejected close is reported through onTeardownError',
  );
  assert.equal(windowClosed, 1, 'the failing window close was attempted once');
  assert.equal(previewClosed, 1, 'the sibling preview close still ran');
  assert.deepEqual(destroyed, [opened.id]);
});

test('hardReload calls reloadIgnoringCache', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const result = await preview.hardReload(opened.id);
  assert.equal(result.ok, true);
  assert.deepEqual(fake.loads.at(-1).options, { reloadIgnoringCache: true });
});

test('zoomIn from 1.0 sets zoom factor 1.1', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const result = await preview.zoomIn(opened.id);
  assert.equal(fake.views[0].webContents.getZoomFactor(), 1.1);
  assert.equal(result.zoomFactor, 1.1);
});

test('setColorScheme dark sends Emulation.setEmulatedMedia', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  await preview.setColorScheme(opened.id, 'dark');
  const dbg = fake.views[0].webContents.debugger;
  assert.deepEqual(dbg.attachCalls, ['1.3']);
  assert.deepEqual(dbg.commands[0], {
    method: 'Emulation.setEmulatedMedia',
    params: {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    },
  });
});

test('clearCache and clearCookies sweep cached preview sessions', async () => {
  const ses = fakePartitionSession();
  const cache = createPreviewSessionCache(() => ses);
  cache.getSession('shared');
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach, sessionCache: cache });
  const cookies = await preview.clearCookies();
  const cacheResult = await preview.clearCache();
  assert.equal(cookies.ok, true);
  assert.equal(cacheResult.ok, true);
  assert.deepEqual(ses.storageClears, [{
    storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
  }]);
  assert.equal(ses.cacheClears, 1);
});

test('clearCookies succeeds when the session cache is empty', async () => {
  const cache = createPreviewSessionCache(() => {
    throw new Error('should not mint a session');
  });
  const preview = createPreviewController({
    attach: fakeAttach().attach,
    sessionCache: cache,
  });
  const cookies = await preview.clearCookies();
  const cacheResult = await preview.clearCache();
  assert.equal(cookies.ok, true);
  assert.equal(cacheResult.ok, true);
});

test('did-fail-load reports unreachable onState', async () => {
  const seen = [];
  const fake = fakeAttach();
  const preview = createPreviewController({
    attach: fake.attach,
    onState: (state) => { seen.push(state); },
  });
  await preview.open({ url: 'http://127.0.0.1:3000' });
  fake.views[0].emit('did-fail-load');
  assert.equal(seen.at(-1).unreachable, true);
});

test('Cmd+R before-input-event prevents default and reloads', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  await preview.open({ url: 'http://127.0.0.1:3000' });
  const event = fake.views[0].emitBeforeInput({ control: true, key: 'r' });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(fake.loads.at(-1).options, { reload: true });
});

test('stop, screenshot, title, and loading bind on the fake guest', async () => {
  const seen = [];
  const fake = fakeAttach();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-shot-bind-'));
  const preview = createPreviewController({
    attach: fake.attach,
    onState: (state) => { seen.push(state); },
    userDataPath: dir,
  });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const view = fake.views[0];
  for (const name of [
    'did-fail-load',
    'did-start-loading',
    'did-stop-loading',
    'page-title-updated',
    'before-input-event',
  ]) {
    assert.equal(view.webContents.recordedEvents.includes(name), true, name);
  }
  await preview.stop(opened.id);
  assert.equal(view.webContents.stopped, true);
  const shot = await preview.captureScreenshot(opened.id);
  assert.equal(shot.ok, true);
  assert.equal(shot.pngBase64, Buffer.from('png').toString('base64'));
  view.emit('page-title-updated', {}, 'Docs');
  assert.equal(seen.at(-1).title, 'Docs');
  view.emit('did-start-loading');
  assert.equal(seen.at(-1).loading, true);
  assert.equal(seen.at(-1).unreachable, false);
  view.emit('did-fail-load');
  view.emit('did-stop-loading');
  assert.equal(seen.at(-1).loading, false);
  assert.equal(seen.at(-1).unreachable, true);
});

test('captureScreenshot writes a png under preview-recordings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-shot-'));
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach, userDataPath: dir });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const shot = await preview.captureScreenshot(opened.id);
  assert.equal(shot.ok, true);
  assert.equal(shot.mimeType, 'image/png');
  assert.equal(typeof shot.path, 'string');
  assert.equal(typeof shot.sizeBytes, 'number');
  const recDir = path.join(dir, 'preview-recordings');
  const files = await fs.readdir(recDir);
  const pngs = files.filter((name) => name.startsWith('browser-screenshot-') && name.endsWith('.png'));
  assert.equal(pngs.length, 1);
  assert.equal(path.basename(shot.path), pngs[0]);
  const written = await fs.readFile(path.join(recDir, pngs[0]));
  assert.deepEqual(written, Buffer.from('png'));
});

test('captureScreenshot unknown id returns ok false', async () => {
  const preview = createPreviewController({
    attach: fakeAttach().attach,
    userDataPath: os.tmpdir(),
  });
  const shot = await preview.captureScreenshot('missing');
  assert.equal(shot.ok, false);
  assert.ok(shot.message);
});

test('registerPreviewIpc authorizes guest control channels', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let authorized = 0;
  const calls = [];
  const controller = {
    hardReload(id) { calls.push(['hardReload', id]); return { ok: true, id }; },
    stop(id) { calls.push(['stop', id]); return { ok: true, id }; },
    zoomIn(id) { calls.push(['zoomIn', id]); return { ok: true, id, zoomFactor: 1.1 }; },
    zoomOut(id) { calls.push(['zoomOut', id]); return { ok: true, id, zoomFactor: 0.9 }; },
    resetZoom(id) { calls.push(['resetZoom', id]); return { ok: true, id, zoomFactor: 1 }; },
    setColorScheme(id, scheme) { calls.push(['setColorScheme', id, scheme]); return { ok: true, id }; },
    clearCookies() { calls.push(['clearCookies']); return { ok: true }; },
    clearCache() { calls.push(['clearCache']); return { ok: true }; },
    captureScreenshot(id) { calls.push(['captureScreenshot', id]); return { ok: true, pngBase64: 'x' }; },
    pickElement(id) { calls.push(['pickElement', id]); return { ok: true }; },
    cancelPickElement(id) { calls.push(['cancelPickElement', id]); return { ok: true }; },
    setAnnotationTheme(id, theme) { calls.push(['setAnnotationTheme', id, theme]); return { ok: true }; },
    openPictureInPicture(id) { calls.push(['openPictureInPicture', id]); return { ok: true }; },
    closePictureInPicture() { calls.push(['closePictureInPicture']); return { ok: true }; },
    startRecording(id) { calls.push(['startRecording', id]); return { ok: true }; },
    stopRecording(id) { calls.push(['stopRecording', id]); return { ok: true }; },
    saveRecording(id, payload) { calls.push(['saveRecording', id, payload]); return { ok: true }; },
    revealArtifact(artifactPath) { calls.push(['revealArtifact', artifactPath]); return { ok: true }; },
    copyArtifactToClipboard(artifactPath) { calls.push(['copyArtifactToClipboard', artifactPath]); return { ok: true }; },
  };
  registerPreviewIpc(ipcMain, controller, {
    authorize() { authorized += 1; },
  });
  const event = { sender: { id: 4 } };
  assert.equal(typeof handlers.get('shell:preview-hard-reload'), 'function');
  assert.equal(typeof handlers.get('shell:preview-stop'), 'function');
  assert.equal(typeof handlers.get('shell:preview-zoom-in'), 'function');
  assert.equal(typeof handlers.get('shell:preview-zoom-out'), 'function');
  assert.equal(typeof handlers.get('shell:preview-zoom-reset'), 'function');
  assert.equal(typeof handlers.get('shell:preview-color-scheme'), 'function');
  assert.equal(typeof handlers.get('shell:preview-clear-cookies'), 'function');
  assert.equal(typeof handlers.get('shell:preview-clear-cache'), 'function');
  assert.equal(typeof handlers.get('shell:preview-capture-screenshot'), 'function');
  assert.equal(typeof handlers.get('shell:preview-pick-element'), 'function');
  assert.equal(typeof handlers.get('shell:preview-cancel-pick'), 'function');
  assert.equal(typeof handlers.get('shell:preview-annotation-theme'), 'function');
  assert.equal(typeof handlers.get('shell:preview-open-pip'), 'function');
  assert.equal(typeof handlers.get('shell:preview-close-pip'), 'function');
  assert.equal(typeof handlers.get('shell:preview-start-recording'), 'function');
  assert.equal(typeof handlers.get('shell:preview-stop-recording'), 'function');
  assert.equal(typeof handlers.get('shell:preview-save-recording'), 'function');
  assert.equal(typeof handlers.get('shell:preview-reveal-artifact'), 'function');
  assert.equal(typeof handlers.get('shell:preview-copy-artifact'), 'function');
  // The high-privilege automation chain (evaluate / CDP input) was removed
  // with no consumer; the channels must stay unregistered.
  for (const channel of [...handlers.keys()]) {
    assert.ok(!channel.startsWith('shell:preview-automation-'), `${channel} must not exist`);
  }
  await handlers.get('shell:preview-hard-reload')(event, 'pv-1');
  await handlers.get('shell:preview-stop')(event, 'pv-1');
  await handlers.get('shell:preview-zoom-in')(event, 'pv-1');
  await handlers.get('shell:preview-zoom-out')(event, 'pv-1');
  await handlers.get('shell:preview-zoom-reset')(event, 'pv-1');
  await handlers.get('shell:preview-color-scheme')(event, 'pv-1', 'dark');
  await handlers.get('shell:preview-clear-cookies')(event);
  await handlers.get('shell:preview-clear-cache')(event);
  await handlers.get('shell:preview-capture-screenshot')(event, 'pv-1');
  await handlers.get('shell:preview-pick-element')(event, 'pv-1');
  await handlers.get('shell:preview-cancel-pick')(event, 'pv-1');
  await handlers.get('shell:preview-annotation-theme')(event, 'pv-1', { primary: 'rgb(1, 2, 3)' });
  await handlers.get('shell:preview-open-pip')(event, 'pv-1');
  await handlers.get('shell:preview-close-pip')(event);
  const savePayload = { mimeType: 'video/webm', data: new ArrayBuffer(0) };
  await handlers.get('shell:preview-start-recording')(event, 'pv-1');
  await handlers.get('shell:preview-stop-recording')(event, 'pv-1');
  await handlers.get('shell:preview-save-recording')(event, 'pv-1', savePayload);
  await handlers.get('shell:preview-reveal-artifact')(event, '/abs/rec.webm');
  await handlers.get('shell:preview-copy-artifact')(event, '/abs/shot.png');
  assert.equal(authorized, 19);
  assert.deepEqual(calls, [
    ['hardReload', 'pv-1'],
    ['stop', 'pv-1'],
    ['zoomIn', 'pv-1'],
    ['zoomOut', 'pv-1'],
    ['resetZoom', 'pv-1'],
    ['setColorScheme', 'pv-1', 'dark'],
    ['clearCookies'],
    ['clearCache'],
    ['captureScreenshot', 'pv-1'],
    ['pickElement', 'pv-1'],
    ['cancelPickElement', 'pv-1'],
    ['setAnnotationTheme', 'pv-1', { primary: 'rgb(1, 2, 3)' }],
    ['openPictureInPicture', 'pv-1'],
    ['closePictureInPicture'],
    ['startRecording', 'pv-1'],
    ['stopRecording', 'pv-1'],
    ['saveRecording', 'pv-1', savePayload],
    ['revealArtifact', '/abs/rec.webm'],
    ['copyArtifactToClipboard', '/abs/shot.png'],
  ]);
});

function samplePickedElement() {
  return {
    pageUrl: 'http://127.0.0.1:3000/',
    pageTitle: 'App',
    tagName: 'button',
    selector: '#save',
    htmlPreview: '<button id="save">Save</button>',
    componentName: null,
    source: null,
    stack: [],
    styles: '',
    pickedAt: '2026-08-19T00:00:00.000Z',
  };
}

function sampleAnnotation() {
  return {
    id: 'annotation_1',
    pageUrl: 'http://127.0.0.1:3000/',
    pageTitle: 'App',
    comment: 'nudge',
    elements: [{
      id: 'element_1',
      element: samplePickedElement(),
      rect: { x: 10.2, y: 20.8, width: 40.2, height: 12.1 },
    }],
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot: null,
    createdAt: '2026-08-19T00:00:00.000Z',
  };
}

test('pickElement sends dshd-preview-start-pick with a theme', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  const pending = preview.pickElement(opened.id);
  await Promise.resolve();
  const start = wc.sent.find((entry) => entry[0] === 'dshd-preview-start-pick');
  assert.ok(start, 'start-pick was sent');
  assert.equal(typeof start[1], 'object');
  assert.equal(typeof start[1].primary, 'string');
  assert.equal(JSON.stringify(start).includes(leftoverPrimaryCss), false);
  wc.ipc.emit('dshd-preview-element-picked', null);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.message, 'cancelled');
});

test('completing a pick captures the crop, returns annotation and screenshot, then sends captured', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  const pending = preview.pickElement(opened.id);
  await Promise.resolve();
  wc.ipc.emit(
    'dshd-preview-element-picked',
    sampleAnnotation(),
    { x: 10.2, y: 20.8, width: 40.2, height: 12.1 },
    'attach',
  );
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.annotation.comment, 'nudge');
  assert.equal(result.screenshot.dataUrl.startsWith('data:image/png;base64,'), true);
  assert.deepEqual(wc.captureRects.at(-1), { x: 10, y: 20, width: 41, height: 13 });
  assert.ok(wc.sent.some((entry) => entry[0] === 'dshd-preview-annotation-captured'));
});

test('cancelPickElement sends dshd-preview-cancel-pick', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  await preview.cancelPickElement(opened.id);
  assert.ok(wc.sent.some((entry) => entry[0] === 'dshd-preview-cancel-pick'));
});

test('setAnnotationTheme sends the theme object to that guest only without leftover primary CSS', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const first = await preview.open({ url: 'http://127.0.0.1:3000' });
  const second = await preview.open({ url: 'http://127.0.0.1:5173' });
  const theme = { primary: 'rgb(1, 2, 3)', background: 'white' };
  await preview.setAnnotationTheme(first.id, theme);
  const firstSent = fake.views[0].webContents.sent.find((entry) => entry[0] === 'dshd-preview-annotation-theme');
  assert.deepEqual(firstSent[1], theme);
  assert.equal(JSON.stringify(firstSent).includes(leftoverPrimaryCss), false);
  assert.equal(
    fake.views[1].webContents.sent.some((entry) => entry[0] === 'dshd-preview-annotation-theme'),
    false,
  );
  const pending = preview.pickElement(first.id);
  await Promise.resolve();
  const start = fake.views[0].webContents.sent.find((entry) => entry[0] === 'dshd-preview-start-pick');
  assert.equal(start[1].primary, 'rgb(1, 2, 3)');
  fake.views[0].webContents.ipc.emit('dshd-preview-element-picked', null);
  await pending;
  void second;
});

test('non-positive crop rects capture the full page', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  const pending = preview.pickElement(opened.id);
  await Promise.resolve();
  wc.ipc.emit('dshd-preview-element-picked', sampleAnnotation(), { x: 0, y: 0, width: 0, height: 10 }, 'attach');
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(wc.captureRects.at(-1), undefined);
});

test('pickElement returns unknown preview id without throwing', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const result = await preview.pickElement('missing');
  assert.equal(result.ok, false);
  assert.match(result.message, /unknown preview id/);
});

test('fitPictureInPictureContentSize matches the 16/9 and 9/16 fixtures', () => {
  assert.deepEqual(fitPictureInPictureContentSize([480, 320], 16 / 9), [523, 294]);
  assert.deepEqual(fitPictureInPictureContentSize([480, 320], 9 / 16), [294, 523]);
});

test('native preview attachment preserves capture through menu hide, PiP, and sidebar restoration', async (t) => {
  const fake = fakeAttach();
  const children = new Set();
  let frontView;
  const win = {
    contentView: { addChildView: (view) => { children.add(view); frontView = view; },
      removeChildView: (view) => children.delete(view) },
    addBrowserView: (view) => children.add(view),
    removeBrowserView: (view) => children.delete(view),
  };
  let nativeView;
  class NativeView {
    constructor() {
      Object.assign(this, fake.attach({ id: 'native-preview' }));
      nativeView = this;
      this.setVisible = (visible) => { this.visible = visible; };
      this.setBounds = (bounds) => { this.bounds = bounds; };
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.close = () => { this.webContents.destroyed = true; };
      stubWideCapture(this.webContents);
      const capture = this.webContents.capturePage.bind(this.webContents);
      this.webContents.capturePage = (...args) => {
        if (!children.has(this)) throw new Error('display surface unavailable after detach');
        return capture(...args);
      };
    }
  }
  // Exercise the production default attachment, which injected fakeAttach tests
  // previously bypassed. Model the observed loss of capture when it detaches.
  const source = await fs.readFile(path.join(__dirname, 'preview.js'), 'utf8');
  const loaded = { exports: {} };
  vm.runInNewContext(source, {
    module: loaded, __dirname, Buffer, process, setInterval, clearInterval,
    require(id) {
      if (id === 'electron') return { WebContentsView: NativeView, BrowserView: NativeView };
      if (id === './window') return { getMainWindow: () => win };
      if (id === './preview-session') return { ...require(id),
        previewSessionForPartition: () => ({ webRequest: { onBeforeRequest() {} } }) };
      return require(id);
    },
  });
  const pip = createPipFactory();
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-native-attachment-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  const preview = loaded.exports.createPreviewController({ createPipWindow: pip.createPipWindow, userDataPath });
  const bounds = { x: 10, y: 20, width: 539, height: 750 };
  const opened = await preview.open({ url: 'http://127.0.0.1:3000', bounds });
  try {
    await preview.hide(opened.id); // More menu hides the native overlay first.
    assert.equal(nativeView.visible, false);
    assert.equal(children.has(nativeView), true);
    assert.equal(nativeView.bounds, bounds, 'hiding must preserve the actual viewport');
    assert.equal((await preview.captureScreenshot(opened.id)).ok, true);
    await preview.openPictureInPicture(opened.id);
    assert.equal(nativeView.visible, false);
    assert.ok(pip.created[0].sent.some(([channel, frame]) =>
      channel === PREVIEW_PIP_FRAME_CHANNEL && frame.width === 1280 && frame.data.length > 0),
    'the hidden attached guest must deliver a real captured frame');
    await preview.closePictureInPicture();
    frontView = {}; // The main Harness can be brought forward while PiP is open.
    await preview.show(opened.id, bounds);
    assert.equal(nativeView.visible, true);
    assert.equal(frontView, nativeView, 'restoration brings the native preview above the Harness');
    assert.equal(children.size, 1, 'sidebar restoration reuses the same guest');
  } finally {
    await preview.closeAll();
  }
  assert.equal(children.size, 0, 'only final preview close releases the attachment');
  assert.equal(nativeView.webContents.destroyed, true);
});

test('openPictureInPicture creates an isolated alwaysOnTop window and hides the guest', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const view = fake.views[0];
  stubWideCapture(view.webContents);
  const result = await preview.openPictureInPicture(opened.id);
  try {
    assert.equal(result.ok, true);
    assert.equal(pip.created.length, 1);
    const win = pip.created[0];
    assert.equal(win.options.alwaysOnTop, true);
    assert.equal(win.options.skipTaskbar, true);
    assert.equal(win.options.show, false);
    assert.equal(win.options.width, 480);
    assert.equal(win.options.height, 320);
    assert.equal(win.options.minWidth, 240);
    assert.equal(win.options.minHeight, 160);
    assert.equal(win.options.autoHideMenuBar, true);
    assert.equal(win.options.fullscreenable, false);
    assert.equal(win.options.maximizable, false);
    assert.equal(win.options.minimizable, false);
    assert.equal(win.options.resizable, true);
    assert.equal(win.options.backgroundColor, '#111111');
    assert.equal(win.options.title, 'Browser preview');
    assert.equal(win.options.webPreferences.contextIsolation, true);
    assert.equal(win.options.webPreferences.sandbox, true);
    assert.equal(win.options.webPreferences.nodeIntegration, false);
    assert.equal(win.options.webPreferences.backgroundThrottling, false);
    assert.equal(path.basename(win.options.webPreferences.preload), 'preview-pip-preload.js');
    assert.equal(view.visible, false);
    assert.equal(win.showInactiveCalls, 1);
    assert.match(win.loadURLs[0], /^data:text\/html;charset=utf-8,/);
    assert.deepEqual(win.alwaysOnTopCalls, [[true, process.platform === 'darwin' ? 'floating' : 'normal']]);
    assert.deepEqual(win.aspectRatioCalls, [0, 1280 / 720]);
    assert.deepEqual(win.contentSizeCalls, [[523, 294, false]]);
    assert.equal(view.webContents.jpegQualities.at(-1), 80);
    assert.equal(win.sent.length, 1);
    assert.equal(win.sent[0][0], PREVIEW_PIP_FRAME_CHANNEL);
    assert.equal(win.sent[0][1].data, Buffer.from('jpeg-frame').toString('base64'));
    assert.equal(win.sent[0][1].width, 1280);
    assert.equal(win.sent[0][1].height, 720);
    assert.equal(win.sent[0][1].id, opened.id);
  } finally {
    await preview.closePictureInPicture();
  }
});

test('openPictureInPicture titles the window from a nonempty guest title', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  fake.views[0].webContents.title = 'Docs';
  stubWideCapture(fake.views[0].webContents);
  const result = await preview.openPictureInPicture(opened.id);
  try {
    assert.equal(result.ok, true);
    assert.equal(pip.created[0].options.title, '预览 · Docs');
  } finally {
    await preview.closePictureInPicture();
  }
});

test('closePictureInPicture destroys the window so show can restore the guest', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  assert.equal(fake.views[0].visible, false);
  const closed = await preview.closePictureInPicture();
  assert.equal(closed.ok, true);
  assert.equal(pip.created[0].closed, true);
  await preview.show(opened.id);
  assert.equal(fake.views[0].visible, true);
});

test('openPictureInPicture returns unknown preview id without throwing', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const result = await preview.openPictureInPicture('missing');
  assert.equal(result.ok, false);
  assert.match(result.message, /unknown preview id/);
  assert.equal(pip.created.length, 0);
});

test('openPictureInPicture is idempotent for an undestroyed window', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  try {
    assert.equal((await preview.openPictureInPicture(opened.id)).ok, true);
    assert.equal((await preview.openPictureInPicture(opened.id)).ok, true);
    assert.equal(pip.created.length, 1);
    assert.equal(pip.created[0].showInactiveCalls, 2);
  } finally {
    await preview.closePictureInPicture();
  }
});

test('closing the PiP window from chrome publishes pictureInPicture false', async () => {
  const seen = [];
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({
    attach: fake.attach,
    createPipWindow: pip.createPipWindow,
    onState: (state) => { seen.push(state); },
  });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  pip.created[0].close();
  const last = seen.at(-1);
  assert.equal(pip.created[0].closed, true);
  assert.equal(last.ok, true);
  assert.equal(last.id, opened.id);
  assert.equal(last.pictureInPicture, false);
});

test('openPictureInPicture replaces a destroyed leftover window', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  try {
    await preview.openPictureInPicture(opened.id);
    pip.created[0].close();
    await preview.openPictureInPicture(opened.id);
    assert.equal(pip.created.length, 2);
    assert.equal(pip.created[1].showInactiveCalls, 1);
  } finally {
    await preview.closePictureInPicture();
  }
});

test('closeAll closes a live picture-in-picture window', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  await preview.closeAll();
  assert.equal(pip.created[0].closed, true);
});

test('preview close of the owning guest closes picture-in-picture', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  await preview.close(opened.id);
  assert.equal(pip.created[0].closed, true);
});

test('startRecording sends JPEG frames on shell:preview-recording-frame', async () => {
  const fake = fakeAttach();
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const sent = [];
  const event = {
    sender: {
      isDestroyed() { return false; },
      send(channel, payload) { sent.push([channel, payload]); },
    },
  };
  registerPreviewIpc(ipcMain, undefined, { authorize() {}, attach: fake.attach });
  const opened = await handlers.get('shell:preview-open')(event, { url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  const result = await handlers.get('shell:preview-start-recording')(event, opened.id);
  try {
    assert.equal(result.ok, true);
    assert.ok(sent.some((entry) => entry[0] === 'shell:preview-recording-frame'));
    const frame = sent.find((entry) => entry[0] === 'shell:preview-recording-frame')[1];
    assert.equal(frame.id, opened.id);
    assert.equal(frame.data, Buffer.from('jpeg-frame').toString('base64'));
    assert.equal(frame.width, 1280);
    assert.equal(frame.height, 720);
    assert.equal(fake.views[0].webContents.jpegQualities.at(-1), 80);
  } finally {
    await handlers.get('shell:preview-stop-recording')(event, opened.id);
    await handlers.get('shell:preview-close')(event, opened.id);
  }
});

test('stopRecording while PiP is open does not stop pip frames', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  stubWideCapture(fake.views[0].webContents);
  await preview.openPictureInPicture(opened.id);
  await preview.startRecording(opened.id);
  const afterStart = pip.created[0].sent.length;
  await preview.stopRecording(opened.id);
  await new Promise((resolve) => setTimeout(resolve, PREVIEW_PIP_FRAME_INTERVAL_MS + 40));
  try {
    assert.ok(pip.created[0].sent.length > afterStart);
    assert.equal(pip.created[0].sent.at(-1)[0], PREVIEW_PIP_FRAME_CHANNEL);
  } finally {
    await preview.closePictureInPicture();
  }
});

test('startRecording while PiP is open does not create a second capture interval', async () => {
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const view = fake.views[0];
  stubWideCapture(view.webContents);
  await preview.openPictureInPicture(opened.id);
  const afterPip = view.webContents.captureRects.length;
  await preview.startRecording(opened.id);
  assert.equal(view.webContents.captureRects.length, afterPip);
  await new Promise((resolve) => setTimeout(resolve, PREVIEW_PIP_FRAME_INTERVAL_MS + 40));
  try {
    assert.equal(view.webContents.captureRects.length, afterPip + 1);
  } finally {
    await preview.stopRecording(opened.id);
    await preview.closePictureInPicture();
  }
});

test('slow shared PiP captures stay single-flight and release after success or failure', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  stubWideCapture(wc);
  const captureImage = wc.capturePage.bind(wc);
  await preview.openPictureInPicture(opened.id);
  await preview.startRecording(opened.id);
  let calls = 0;
  let complete;
  let fail;
  wc.capturePage = () => {
    calls += 1;
    return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  };
  const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
  try {
    t.mock.timers.tick(PREVIEW_PIP_FRAME_INTERVAL_MS * 4);
    assert.equal(calls, 1);
    const before = pip.created[0].sent.length;
    complete(captureImage());
    await flush();
    assert.equal(pip.created[0].sent.length, before + 1);
    assert.equal(wc.jpegQualities.at(-1), 80);
    t.mock.timers.tick(PREVIEW_PIP_FRAME_INTERVAL_MS);
    assert.equal(calls, 2);
    fail(new Error('capture temporarily unavailable'));
    await flush();
    t.mock.timers.tick(PREVIEW_PIP_FRAME_INTERVAL_MS);
    assert.equal(calls, 3);
    complete(captureImage());
    await flush();
  } finally {
    await preview.stopRecording(opened.id);
    await preview.closePictureInPicture();
    await preview.close(opened.id);
  }
});

test('closing and reopening PiP waits for its old in-flight capture', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const fake = fakeAttach();
  const pip = createPipFactory();
  const preview = createPreviewController({ attach: fake.attach, createPipWindow: pip.createPipWindow });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const wc = fake.views[0].webContents;
  stubWideCapture(wc);
  const captureImage = wc.capturePage.bind(wc);
  await preview.openPictureInPicture(opened.id);
  const releases = [];
  wc.capturePage = () => new Promise((resolve) => releases.push(resolve));
  t.mock.timers.tick(PREVIEW_PIP_FRAME_INTERVAL_MS);
  assert.equal(releases.length, 1);
  await preview.closePictureInPicture();
  const reopening = preview.openPictureInPicture(opened.id);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(releases.length, 1, 'new consumer does not overlap the old native capture');
  const before = pip.created[1].sent.length;
  releases[0](captureImage());
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(releases.length, 2);
  assert.equal(pip.created[1].sent.length, before, 'the old generation does not publish into the new PiP');
  releases[1](captureImage());
  await reopening;
  assert.equal(pip.created[1].sent.length, before + 1);
  await preview.closePictureInPicture();
  await preview.close(opened.id);
});

test('saveRecording writes under preview-recordings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-rec-'));
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach, userDataPath: dir });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const webm = await preview.saveRecording(opened.id, {
    mimeType: 'video/webm',
    data: Buffer.from('webm-bytes'),
  });
  assert.equal(webm.ok, true);
  const recDir = path.join(dir, 'preview-recordings');
  const files = await fs.readdir(recDir);
  assert.equal(files.filter((name) => name.endsWith('.webm')).length, 1);
  const written = await fs.readFile(path.join(recDir, files.find((name) => name.endsWith('.webm'))));
  assert.equal(written.toString(), 'webm-bytes');
  const mp4 = await preview.saveRecording(opened.id, {
    mimeType: 'video/mp4',
    data: Buffer.from('mp4-bytes'),
  });
  assert.equal(mp4.ok, true);
  const after = await fs.readdir(recDir);
  assert.equal(after.filter((name) => name.endsWith('.mp4')).length, 1);
});

test('saveRecording rejects a payload over the 512 MiB cap without writing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-rec-cap-'));
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach, userDataPath: dir });
  const opened = await preview.open({ url: 'http://127.0.0.1:3000' });
  const result = await preview.saveRecording(opened.id, {
    mimeType: 'video/webm',
    data: Buffer.alloc(512 * 1024 * 1024 + 1),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /512 MiB/);
  const entries = await fs.readdir(dir);
  assert.ok(!entries.includes('preview-recordings'));
});

test('revealArtifact only opens files under preview-recordings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-reveal-'));
  const recDir = path.join(dir, 'preview-recordings');
  await fs.mkdir(recDir);
  const inside = path.join(recDir, 'rec.webm');
  await fs.writeFile(inside, 'webm');
  const outside = path.join(dir, 'secret.png');
  await fs.writeFile(outside, 'png');
  const shown = [];
  const preview = createPreviewController({
    userDataPath: dir,
    showItemInFolder(artifactPath) { shown.push(artifactPath); },
  });
  const ok = await preview.revealArtifact(inside);
  assert.equal(ok.ok, true);
  assert.equal(shown.length, 1);
  assert.equal(path.basename(shown[0]), 'rec.webm');
  const denied = await preview.revealArtifact(outside);
  assert.equal(denied.ok, false);
  assert.deepEqual(shown, [shown[0]]);
});

test('copyArtifactToClipboard only reads images under preview-recordings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-preview-copy-'));
  const recDir = path.join(dir, 'preview-recordings');
  await fs.mkdir(recDir);
  const inside = path.join(recDir, 'shot.png');
  const empty = path.join(recDir, 'empty.png');
  const outside = path.join(dir, 'escape.png');
  await fs.writeFile(inside, 'png');
  await fs.writeFile(empty, 'png');
  await fs.writeFile(outside, 'png');
  const written = [];
  const preview = createPreviewController({
    userDataPath: dir,
    nativeImage: {
      createFromPath(artifactPath) {
        return {
          path: artifactPath,
          isEmpty() { return path.basename(artifactPath) === 'empty.png'; },
        };
      },
    },
    clipboard: {
      writeImage(image) { written.push(image); },
    },
  });
  const ok = await preview.copyArtifactToClipboard(inside);
  assert.equal(ok.ok, true);
  assert.equal(written.length, 1);
  const blank = await preview.copyArtifactToClipboard(empty);
  assert.equal(blank.ok, false);
  assert.ok(blank.message);
  assert.equal(written.length, 1);
  const denied = await preview.copyArtifactToClipboard(outside);
  assert.equal(denied.ok, false);
  assert.equal(written.length, 1);
});

test('unknown preview id fails startRecording without throwing', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const start = await preview.startRecording('missing');
  assert.equal(start.ok, false);
  assert.equal(start.message, 'unknown preview id');
});

test('the preview controller exposes no automation surface', async () => {
  const fake = fakeAttach();
  const preview = createPreviewController({ attach: fake.attach });
  const automationMethods = Object.keys(preview).filter((name) => name.startsWith('automation'));
  assert.deepEqual(automationMethods, []);
});

