'use strict';

/**
 * Native welcome window and its presentation-only renderer. Ported from
 * upstream welcome-window.ts. The unbundled preload stays self-contained —
 * it fetches the window-owned locale table over a sync bootstrap channel —
 * so this window runs sandboxed like every other surface (static file://
 * document, CSP 'none' default, no navigation, no window.open).
 */

const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');
const { rendererFile } = require('./paths');
const { createRegisterIpc } = require('./ipc-register');

const IPC = {
  locale: 'dsh-welcome:locale',
  saveApiKey: 'dsh-welcome:save-api-key',
  skip: 'dsh-welcome:skip',
  start: 'dsh-welcome:start',
  cancel: 'dsh-welcome:cancel',
  copyLink: 'dsh-welcome:copy-link',
  state: 'dsh-welcome:state',
  takeNotice: 'dsh-welcome:take-notice',
};

function welcomeWindowOptions() {
  return {
    width: 600,
    height: 700,
    useContentSize: true,
    center: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: false,
    title: '鲸屿',
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'welcome.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };
}

let disposeActiveHandlers;

/**
 * Open the process's sole welcome window with desktop-owned operations.
 * @param {object} locale - { id, messages } from desktop-locale.
 * @param {object} operations - { takeNotice, startSignIn, cancelSignIn, copySignInLink, saveApiKey, skip }.
 */
async function openWelcomeWindow(locale, operations) {
  const window = new BrowserWindow(welcomeWindowOptions());
  disposeActiveHandlers?.();
  let active = true;
  const disposeHandlers = () => {
    if (!active) return;
    active = false;
    for (const channel of [IPC.takeNotice, IPC.saveApiKey, IPC.skip, IPC.start, IPC.cancel, IPC.copyLink]) {
      ipcMain.removeHandler(channel);
    }
    ipcMain.removeAllListeners(IPC.locale);
    disposeActiveHandlers = undefined;
  };
  disposeActiveHandlers = disposeHandlers;
  const assertSender = (event) => {
    if (!active || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('dshd welcome: rejected action from an unowned frame');
    }
  };
  const register = createRegisterIpc(ipcMain);
  register({
    channel: IPC.locale,
    authorize: assertSender,
    handler: (event) => {
      event.returnValue = { id: locale.id, messages: locale.messages };
    },
  });
  register({ channel: IPC.takeNotice, authorize: assertSender, handler: async () => operations.takeNotice() });
  register({
    channel: IPC.saveApiKey,
    authorize: assertSender,
    handler: async (_event, value) => {
      if (typeof value !== 'string' || !/^[\x21-\x7e]+$/.test(value)) return { ok: false };
      return operations.saveApiKey(value);
    },
  });
  register({ channel: IPC.skip, authorize: assertSender, handler: async () => { await operations.skip(); } });
  register({ channel: IPC.start, authorize: assertSender, handler: async () => operations.startSignIn() });
  register({
    channel: IPC.cancel,
    authorize: assertSender,
    handler: async (_event, id) => {
      if (typeof id !== 'string') throw new Error('dshd welcome: invalid attempt');
      return operations.cancelSignIn(id);
    },
  });
  register({
    channel: IPC.copyLink,
    authorize: assertSender,
    handler: async (_event, id) => {
      if (typeof id !== 'string') throw new Error('dshd welcome: invalid attempt');
      return operations.copySignInLink(id);
    },
  });
  window.once('closed', disposeHandlers);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => { event.preventDefault(); });
  try {
    await window.loadFile(rendererFile('welcome.html'));
  } catch (error) {
    disposeHandlers();
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
  if (active && !window.isDestroyed()) window.show();
  return window;
}

module.exports = { openWelcomeWindow, WELCOME_IPC: IPC };
