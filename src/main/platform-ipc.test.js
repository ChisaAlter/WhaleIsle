'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerPlatformIpc } = require('./platform-ipc');
const { PLATFORM_IPC } = require('./platform-view');

test('registerPlatformIpc rejects null harnessView, empty/mismatched origins, and subframe native-theme requests', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, fn) { handlers.set(`invoke:${channel}`, fn); },
    on(channel, fn) { handlers.set(`on:${channel}`, fn); },
  };
  let currentView = null;
  let currentOrigin = '';
  const nativeTheme = { themeSource: 'system' };
  const mainFrame = { url: 'http://127.0.0.1:3080/chat' };
  const subFrame = { url: 'http://127.0.0.1:3080/embed' };
  const webContents = { mainFrame, isDestroyed: () => false };
  const mainWindow = { id: 1 };
  let opened = 0;

  registerPlatformIpc({
    ipcMain,
    platformView: {
      bootstrap: () => ({}),
      open: () => { opened += 1; return { ok: true }; },
      setBounds: () => {},
      close: () => {},
    },
    refreshSession: () => {},
    getHarnessView: () => currentView,
    getHarnessOrigin: () => currentOrigin,
    getMainWindow: () => mainWindow,
    nativeTheme,
  });

  const openHandler = handlers.get(`invoke:${PLATFORM_IPC.open}`);
  const themeHandler = handlers.get('on:shell:native-theme');

  const bounds = { x: 0, y: 0, width: 400, height: 300 };

  // Null getHarnessView() must reject cleanly without TypeError.
  await assert.rejects(() => openHandler({ sender: webContents, senderFrame: mainFrame }, 'usage', bounds), /rejected sender/);
  themeHandler({ sender: webContents, senderFrame: mainFrame }, 'dark');
  assert.equal(nativeTheme.themeSource, 'system');

  // Empty origin and port-prefix collision (:30801 vs :3080) must be rejected.
  currentView = { webContents };
  await assert.rejects(() => openHandler({ sender: webContents, senderFrame: mainFrame }, 'usage', bounds), /rejected sender/);
  themeHandler({ sender: webContents, senderFrame: mainFrame }, 'dark');
  assert.equal(nativeTheme.themeSource, 'system');

  currentOrigin = 'http://127.0.0.1:30801';
  await assert.rejects(() => openHandler({ sender: webContents, senderFrame: mainFrame }, 'usage', bounds), /rejected sender/);
  themeHandler({ sender: webContents, senderFrame: mainFrame }, 'dark');
  assert.equal(nativeTheme.themeSource, 'system');

  // Subframe must be ignored for shell:native-theme even on matching origin.
  currentOrigin = 'http://127.0.0.1:3080';
  themeHandler({ sender: webContents, senderFrame: subFrame }, 'dark');
  assert.equal(nativeTheme.themeSource, 'system');

  // Authorized mainFrame with exact origin succeeds.
  await openHandler({ sender: webContents, senderFrame: mainFrame }, 'usage', bounds);
  assert.equal(opened, 1);
  themeHandler({ sender: webContents, senderFrame: mainFrame }, 'dark');
  assert.equal(nativeTheme.themeSource, 'dark');
});
