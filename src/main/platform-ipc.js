'use strict';

// Embedded-Platform and native-theme IPC registration, extracted from the
// main bootstrap so every channel mount is reachable by the IPC contract
// test with an injected ipcMain (#436). Registration only — the Platform
// view and its session refresh stay owned by index.js.

const { PLATFORM_IPC, platformBounds } = require('./platform-view');
const { createRegisterIpc } = require('./ipc-register');

function matchesOrigin(/** @type {unknown} */ frameUrl, /** @type {unknown} */ expectedOrigin) {
  if (typeof expectedOrigin !== 'string' || expectedOrigin.trim() === '') return false;
  if (typeof frameUrl !== 'string' || frameUrl.trim() === '') return false;
  try {
    const actual = new URL(frameUrl).origin;
    const expected = new URL(expectedOrigin).origin;
    return actual !== 'null' && actual === expected;
  } catch {
    return false;
  }
}

/**
 * @param {{ ipcMain: any, platformView: any, refreshSession: () => any,
 *   getHarnessView: () => any, getHarnessOrigin: () => string,
 *   getMainWindow: () => any, nativeTheme: any }} deps
 */
function registerPlatformIpc({ ipcMain, platformView, refreshSession, getHarnessView, getHarnessOrigin, getMainWindow, nativeTheme }) {
  const assertProductDoc = (event) => {
    const view = getHarnessView();
    if (!view || !view.webContents || view.webContents.isDestroyed?.()
      || event.sender !== view.webContents
      || event.senderFrame !== view.webContents.mainFrame
      || !matchesOrigin(event.senderFrame?.url, getHarnessOrigin())) {
      throw new Error('dshd platform: rejected sender');
    }
    return getMainWindow();
  };
  const registerChannel = createRegisterIpc(ipcMain);
  registerChannel({
    channel: PLATFORM_IPC.bootstrap,
    // bootstrap() owns the sender contract internally (it resolves
    // event.returnValue); authorization must not run twice.
    authorize: () => {},
    handler: (event) => {
      try { event.returnValue = platformView.bootstrap(event); }
      catch { event.returnValue = null; }
    },
  });
  registerChannel({
    channel: PLATFORM_IPC.open,
    authorize: assertProductDoc,
    handler: async (_event, owner, page, bounds) => {
      if (page !== 'usage' && page !== 'top-up') throw new Error('dshd platform: invalid page');
      await refreshSession?.();
      return platformView.open(owner, page, platformBounds(bounds));
    },
  });
  registerChannel({
    channel: PLATFORM_IPC.bounds,
    authorize: assertProductDoc,
    handler: (_event, bounds) => { platformView.setBounds(platformBounds(bounds)); },
  });
  registerChannel({
    channel: PLATFORM_IPC.close,
    authorize: assertProductDoc,
    handler: () => { platformView.close(); },
  });

  // html[data-ds-theme-source] → nativeTheme.themeSource, so native chrome
  // (dialogs, tray icon contrast) follows the app palette (upstream
  // preload-theme semantics; sender-gated to the harness view).
  registerChannel({
    channel: 'shell:native-theme',
    // Silent-ignore contract: an unauthorized sender is dropped without a
    // rejection or warning path.
    authorize: (event) => {
      const view = getHarnessView();
      return Boolean(
        view
        && view.webContents
        && !view.webContents.isDestroyed()
        && event.sender === view.webContents
        && event.senderFrame === view.webContents.mainFrame
        && matchesOrigin(event.senderFrame?.url, getHarnessOrigin()),
      );
    },
    handler: (_event, owned, value) => {
      if (!owned) return;
      if (value === 'light' || value === 'dark' || value === 'system') {
        nativeTheme.themeSource = value;
      }
    },
  });
}

module.exports = { registerPlatformIpc };
