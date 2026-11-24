'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { createWorkspaceAuthority } = require('./workspace-authority');
const {
  FILE_PREVIEW_STATE_CHANNEL,
  previewFileKind,
  createFilePreviewWindowController,
} = require('./preview-file-window.js');

const REAL_PREVIEW_HTML = path.join(__dirname, '..', 'renderer', 'file-preview.html');
const REAL_PREVIEW_URL = pathToFileURL(REAL_PREVIEW_HTML).href;

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
}

function fakeWindow() {
  const calls = [];
  const listeners = new Map();
  let destroyed = false;
  let onClosed = null;
  const webContents = {
    setWindowOpenHandler(handler) { calls.push(['window-open-handler', handler({})]); },
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return {
    calls,
    webContents,
    isDestroyed: () => destroyed,
    setMenuBarVisibility(value) { calls.push(['menu', value]); },
    setAlwaysOnTop(value, level) { calls.push(['top', value, level]); },
    setTitle(value) { calls.push(['title', value]); },
    setBackgroundColor(value) { calls.push(['background', value]); },
    once(event, handler) { if (event === 'closed') onClosed = handler; },
    async loadFile(value) { calls.push(['load', value]); },
    showInactive() { calls.push(['showInactive']); },
    close() {
      destroyed = true;
      calls.push(['close']);
      onClosed?.();
    },
  };
}

test('previewFileKind separates browser-native media and text fallback', () => {
  assert.equal(previewFileKind('image.PNG'), 'image');
  assert.equal(previewFileKind('clip.webm'), 'video');
  assert.equal(previewFileKind('sound.mp3'), 'audio');
  assert.equal(previewFileKind('doc.pdf'), 'pdf');
  assert.equal(previewFileKind('index.html'), 'html');
  assert.equal(previewFileKind('src/main.ts'), 'text');
});

test('file preview opens one always-on-top window and exposes state only to its top-level renderer', async () => {
  const ipcMain = fakeIpcMain();
  const windows = [];
  const reads = [];
  const controller = createFilePreviewWindowController({
    ipcMain,
    workspacePreview: {
      async fileUrl(input) {
        return { ok: true, url: `http://127.0.0.1:9/token/${input.relativePath}` };
      },
    },
    async readFile(cwd, relativePath) {
      reads.push([cwd, relativePath]);
      return { ok: true, text: 'const value = 1;', truncated: true };
    },
    createWindow(options) {
      const win = fakeWindow();
      win.options = options;
      windows.push(win);
      return win;
    },
    getTheme: () => ({ scheme: 'dark' }),
    getLocale: () => 'en',
    preloadPath: 'preview-preload.js',
    htmlPath: REAL_PREVIEW_HTML,
    platform: 'win32',
  });

  assert.deepEqual(await controller.open({ cwd: 'C:/repo', relativePath: 'src/main.ts' }), { ok: true });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].options.alwaysOnTop, true);
  assert.equal(windows[0].options.skipTaskbar, true);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.deepEqual(reads, [['C:/repo', 'src/main.ts']]);
  assert.ok(windows[0].calls.some(call => call[0] === 'showInactive'));

  const stateHandler = ipcMain.handlers.get(FILE_PREVIEW_STATE_CHANNEL);
  const topFrame = { url: REAL_PREVIEW_URL };
  windows[0].webContents.mainFrame = topFrame;
  assert.deepEqual(await stateHandler({
    sender: windows[0].webContents,
    senderFrame: topFrame,
  }), {
    kind: 'text',
    name: 'main.ts',
    relativePath: 'src/main.ts',
    url: 'http://127.0.0.1:9/token/src/main.ts',
    text: 'const value = 1;',
    truncated: true,
    message: null,
    locale: 'en',
    scheme: 'dark',
  });
  assert.throws(
    () => stateHandler({ sender: {}, senderFrame: topFrame }),
    { code: 'ERR_DSH_IPC_SENDER' },
  );
  assert.throws(
    () => stateHandler({
      sender: windows[0].webContents,
      senderFrame: { url: REAL_PREVIEW_URL },
    }),
    { code: 'ERR_DSH_IPC_SENDER' },
  );
  // Spoofed/navigated frame URL must be rejected even on the mainFrame reference.
  const evilFrame = { url: 'https://evil.example/file-preview.html' };
  windows[0].webContents.mainFrame = evilFrame;
  assert.throws(
    () => stateHandler({ sender: windows[0].webContents, senderFrame: evilFrame }),
    { code: 'ERR_DSH_IPC_SENDER' },
  );
  windows[0].webContents.mainFrame = topFrame;

  const navEvent = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  windows[0].webContents.emit('will-navigate', navEvent, 'https://evil.example/');
  assert.equal(navEvent.defaultPrevented, true);
  const redirEvent = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  windows[0].webContents.emit('will-redirect', redirEvent, 'file:///C:/Windows/win.ini');
  assert.equal(redirEvent.defaultPrevented, true);
  const okNav = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  windows[0].webContents.emit('will-navigate', okNav, REAL_PREVIEW_URL);
  assert.equal(okNav.defaultPrevented, false);
  const subFrameNav = { isMainFrame: false, url: 'http://127.0.0.1:9/token/doc.pdf', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  windows[0].webContents.emit('will-frame-navigate', subFrameNav);
  assert.equal(subFrameNav.defaultPrevented, false);

  await controller.open({ cwd: 'C:/repo', relativePath: 'image.png' });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].calls.filter(call => call[0] === 'load').length, 2);
  assert.equal((await stateHandler({
    sender: windows[0].webContents,
    senderFrame: topFrame,
  })).kind, 'image');
  await controller.close();
  assert.ok(windows[0].calls.some(call => call[0] === 'close'));
});

test('binary text fallback opens an explicit unsupported state', async () => {
  const ipcMain = fakeIpcMain();
  const win = fakeWindow();
  const controller = createFilePreviewWindowController({
    ipcMain,
    workspacePreview: { fileUrl: async () => ({ ok: true, url: 'http://127.0.0.1:9/token/data.bin' }) },
    readFile: async () => ({ ok: true, binary: true }),
    createWindow: () => win,
    getTheme: () => ({ scheme: 'light' }),
    getLocale: () => 'en',
    preloadPath: 'preview-preload.js',
    htmlPath: REAL_PREVIEW_HTML,
  });
  await controller.open({ cwd: '/repo', relativePath: 'data.bin' });
  win.webContents.mainFrame = { url: REAL_PREVIEW_URL };
  const state = await ipcMain.handlers.get(FILE_PREVIEW_STATE_CHANNEL)({
    sender: win.webContents,
    senderFrame: win.webContents.mainFrame,
  });
  assert.equal(state.kind, 'unsupported');
  assert.match(state.message, /binary file/);
});

test('file preview reuses one window across files and replaces it after close', async () => {
  const ipcMain = fakeIpcMain();
  const windows = [];
  const controller = createFilePreviewWindowController({
    ipcMain,
    workspacePreview: {
      async fileUrl(input) {
        return { ok: true, url: `http://127.0.0.1:9/token/${input.relativePath}` };
      },
    },
    readFile: async () => ({ ok: true, text: 'text' }),
    createWindow() {
      const win = fakeWindow();
      windows.push(win);
      return win;
    },
    getTheme: () => ({ scheme: 'light' }),
    getLocale: () => 'en',
    preloadPath: 'preview-preload.js',
    htmlPath: 'preview.html',
  });

  await controller.open({ cwd: '/repo', relativePath: 'one.html' });
  await controller.open({ cwd: '/repo', relativePath: 'two.txt' });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].calls.filter(call => call[0] === 'load').length, 2);
  await controller.close();
  assert.equal(windows[0].isDestroyed(), true);
  await controller.open({ cwd: '/repo', relativePath: 'three.txt' });
  assert.equal(windows.length, 2);
});

test('file preview normalizes an absolute target and reads scratch text', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-window-'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-window-scratch-'));
  try {
    const absolute = path.join(root, 'note.txt');
    fs.writeFileSync(absolute, 'hello\n');
    const authority = createWorkspaceAuthority({ workspace: root, extraWorkspaces: [scratch] });
    const ipcMain = fakeIpcMain();
    const windows = [];
    const reads = [];
    const urls = [];
    const controller = createFilePreviewWindowController({
      ipcMain,
      authority,
      workspacePreview: {
        async fileUrl(input) {
          urls.push(input);
          return { ok: true, url: `http://127.0.0.1:9/token/${input.relativePath}` };
        },
      },
      async readFile(cwd, relativePath) {
        reads.push([cwd, relativePath]);
        return { ok: true, text: 'hello\n' };
      },
      createWindow() {
        const win = fakeWindow();
        windows.push(win);
        return win;
      },
      getTheme: () => ({ scheme: 'light' }),
      getLocale: () => 'en',
      preloadPath: 'preview-preload.js',
      htmlPath: 'preview.html',
    });

    // Absolute targets are rebased onto the most specific authorized root.
    await controller.open({ absolutePath: absolute });
    assert.deepEqual(urls[0], { ok: true, cwd: fs.realpathSync.native(root), relativePath: 'note.txt' });

    const scratchFile = path.join(scratch, 'scratch.txt');
    fs.writeFileSync(scratchFile, 'scratch\n');
    await controller.open({ absolutePath: scratchFile });
    assert.deepEqual(urls[1], { ok: true, cwd: fs.realpathSync.native(scratch), relativePath: 'scratch.txt' });
    assert.deepEqual(reads, [
      [fs.realpathSync.native(root), 'note.txt'],
      [fs.realpathSync.native(scratch), 'scratch.txt'],
    ]);
    assert.equal(windows.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
