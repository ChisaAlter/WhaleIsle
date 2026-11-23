'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isHttpOrHttpsUrl, isLoopbackHttpUrl } = require('./local-url');

const TOPBAR_HEIGHT = 38;
const MAGPIE_PARTITION = 'persist:magpie';

/** @type {Electron.BrowserWindow | null} */
let activeWindow = null;
/** @type {Electron.WebContentsView | null} */
let activeView = null;
/** @type {string} */
let activeOrigin = '';
/** @type {any} */
let activeMeta = {};
/** @type {(() => void) | null} */
let activeOnClose = null;

/**
 * Append initial `theme=dark|light` to loopback Magpie Web URL without losing `?k=...`.
 * @param {string} rawUrl
 * @param {{ scheme?: string } | null | undefined} theme
 * @returns {string}
 */
function buildMagpieTargetUrl(rawUrl, theme) {
  const parsed = new URL(rawUrl);
  if (!isLoopbackHttpUrl(parsed.href)) {
    throw new Error('Magpie 只能打开本机管理界面');
  }
  if (theme?.scheme === 'dark' || theme?.scheme === 'light') {
    parsed.searchParams.set('theme', theme.scheme);
  }
  return parsed.href;
}

/**
 * Reuse existing Magpie shell window and reload its view if origin changed.
 * @param {any} state
 * @param {any} deps
 */
function reuseActiveWindow(state, deps) {
  state.activeMeta = deps.meta;
  if (typeof deps.onClose === 'function') state.activeOnClose = deps.onClose;
  if (!state.activeWindow.webContents.isDestroyed()) {
    state.activeWindow.webContents.send('magpie:shell-meta', state.activeMeta);
  }
  if (state.activeOrigin !== deps.origin && state.activeView) {
    try {
      state.activeWindow.contentView.removeChildView(state.activeView);
      state.activeView.webContents.close?.();
    } catch {
      // Ignore teardown errors when replacing the embedded view.
    }
    state.activeOrigin = deps.origin;
    state.activeView = deps.remount();
  }
  if (deps.activate !== false) {
    state.activeWindow.show();
    state.activeWindow.focus();
  } else {
    state.activeWindow.showInactive();
  }
  return state;
}

/**
 * Register authorized shell window control handlers on `win.webContents`.
 * @param {Electron.BrowserWindow} win
 * @param {string} shellUrl
 * @param {any} deps
 */
function attachShellIpc(win, shellUrl, deps) {
  const contents = win.webContents;
  const isOwnedSender = (/** @type {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} */ event) => (
    !win.isDestroyed() &&
    event.sender === contents &&
    event.senderFrame === contents.mainFrame &&
    String(event.senderFrame?.url || '').startsWith('file:')
  );
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, targetUrl) => {
    if (!String(targetUrl || '').startsWith(shellUrl)) event.preventDefault();
  });
  const isMaximized = () => deps.nativeMotion.isNativeWindowMaximized(win) ?? win.isMaximized();
  const windowState = () => ({ maximized: isMaximized(), minimizable: win.minimizable, maximizable: win.maximizable });

  contents.ipc.on('magpie:window', (event, action) => {
    if (!isOwnedSender(event)) return;
    if (action === 'close') { win.close(); return; }
    if (!['minimize', 'maximize'].includes(action)) return;
    setImmediate(() => {
      if (win.isDestroyed()) return;
      if (action === 'minimize' && win.minimizable) win.minimize();
      if (action === 'maximize' && win.maximizable && !deps.nativeMotion.toggleNativeMaximize(win)) {
        if (win.isMaximized()) win.unmaximize(); else win.maximize();
      }
    });
  });
  contents.ipc.handle('magpie:window-state', (event) => {
    if (!isOwnedSender(event)) throw new Error('Unauthorized Magpie shell sender');
    return windowState();
  });
  contents.ipc.handle('magpie:shell-meta', (event) => {
    if (!isOwnedSender(event)) throw new Error('Unauthorized Magpie shell sender');
    return deps.getMeta();
  });
  contents.ipc.on('magpie:reload', (event) => {
    const view = deps.getView();
    if (!isOwnedSender(event) || !view || view.webContents.isDestroyed()) return;
    view.webContents.reload();
  });
  contents.ipc.handle('magpie:open-external-update', async (event) => {
    if (!isOwnedSender(event)) throw new Error('Unauthorized Magpie shell sender');
    const url = deps.getMeta().externalUpdateUrl;
    return isHttpOrHttpsUrl(url) ? deps.openExternalHttp(url) : false;
  });

  /** @type {boolean | undefined} */
  let lastMaximized;
  const syncState = () => {
    if (win.isDestroyed() || isMaximized() === lastMaximized) return;
    lastMaximized = isMaximized();
    contents.send('magpie:window-state', windowState());
  };
  return { syncState };
}

/**
 * @param {{
 *   url: string,
 *   ownership?: string,
 *   version?: string,
 *   latestVersion?: string,
 *   externalUpdateUrl?: string,
 *   theme?: { scheme?: string },
 *   activate?: boolean,
 *   onClose?: (() => void) | null,
 * }} options
 */
function openMagpieWindow(options) {
  const { BrowserWindow, WebContentsView, session } = require('electron');
  const { openExternalHttp } = require('./open-external');
  const { assetFile, rendererFile } = require('./paths');
  const chrome = require('./chrome');
  const nativeMotion = require('./native-window-motion');

  const theme = options.theme || chrome.currentTheme?.() || { scheme: 'light' };
  const targetUrl = buildMagpieTargetUrl(options.url, theme);
  const origin = new URL(targetUrl).origin;
  const meta = {
    ownership: options.ownership || 'managed',
    version: options.version || '',
    latestVersion: options.latestVersion || '',
    externalUpdateUrl: options.externalUpdateUrl || '',
    theme,
  };

  if (activeWindow && !activeWindow.isDestroyed()) {
    const updated = reuseActiveWindow(
      { activeWindow, activeView, activeOrigin, activeMeta, activeOnClose },
      {
        meta,
        origin,
        activate: options.activate,
        onClose: options.onClose,
        remount: () => mountMagpieView(/** @type {Electron.BrowserWindow} */ (activeWindow), targetUrl, origin, WebContentsView, session, openExternalHttp),
      },
    );
    activeView = updated.activeView;
    activeOrigin = updated.activeOrigin;
    activeMeta = updated.activeMeta;
    activeOnClose = updated.activeOnClose;
    return;
  }

  activeMeta = meta;
  activeOrigin = origin;
  activeOnClose = typeof options.onClose === 'function' ? options.onClose : null;

  const chromeOptions = chrome.windowChrome({
    title: 'Magpie',
    width: 1120,
    height: 780,
    minWidth: 420,
    minHeight: 540,
    icon: assetFile('icon.ico'),
    show: false,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 11 },
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'magpie-shell.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const win = new BrowserWindow(chromeOptions);
  activeWindow = win;
  nativeMotion.enableNativeWindowMotion(win);
  if (process.platform === 'darwin') {
    win.setWindowButtonPosition?.({ x: 16, y: 11 });
    win.setWindowButtonVisibility?.(true);
  }

  const { syncState } = attachShellIpc(win, pathToFileURL(rendererFile('magpie-shell.html')).href, {
    nativeMotion,
    openExternalHttp,
    getMeta: () => activeMeta,
    getView: () => activeView,
  });
  const syncBounds = () => {
    if (win.isDestroyed() || !activeView) return;
    const [w, h] = win.getContentSize();
    activeView.setBounds({ x: 0, y: TOPBAR_HEIGHT, width: Math.max(0, w), height: Math.max(0, h - TOPBAR_HEIGHT) });
  };
  win.on('maximize', syncState);
  win.on('unmaximize', syncState);
  win.on('resize', () => {
    syncState();
    syncBounds();
  });

  activeView = mountMagpieView(win, targetUrl, origin, WebContentsView, session, openExternalHttp);
  syncBounds();

  win.once('ready-to-show', () => (options.activate !== false ? win.show() : win.showInactive()));
  win.once('closed', () => {
    const onClose = activeOnClose;
    if (activeWindow === win) {
      activeWindow = null;
      activeView = null;
      activeOrigin = '';
      activeOnClose = null;
    }
    try {
      onClose?.();
    } catch {
      // Closing callback errors must not surface after window disposal.
    }
  });

  void win.loadFile(rendererFile('magpie-shell.html'));
}

/**
 * Mount zero-injection `WebContentsView` for official `magpie web`.
 * @param {Electron.BrowserWindow} win
 * @param {string} targetUrl
 * @param {string} origin
 * @param {typeof Electron.WebContentsView} WebContentsView
 * @param {typeof Electron.session} session
 * @param {(url: string) => Promise<boolean>} openExternalHttp
 */
function mountMagpieView(win, targetUrl, origin, WebContentsView, session, openExternalHttp) {
  const viewSession = session.fromPartition(MAGPIE_PARTITION);
  viewSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
  viewSession.setPermissionCheckHandler(() => false);

  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: MAGPIE_PARTITION,
    },
  });
  const [w, h] = win.getContentSize();
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: TOPBAR_HEIGHT, width: Math.max(0, w), height: Math.max(0, h - TOPBAR_HEIGHT) });

  const contents = view.webContents;
  contents.setWindowOpenHandler(({ url: target }) => {
    if (isHttpOrHttpsUrl(target)) {
      void openExternalHttp(target);
    }
    return { action: 'deny' };
  });
  const guardNavigation = (/** @type {Electron.Event} */ event, /** @type {string} */ target) => {
    try {
      if (new URL(target).origin !== origin) {
        event.preventDefault();
        if (isHttpOrHttpsUrl(target)) void openExternalHttp(target);
      }
    } catch {
      event.preventDefault();
    }
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);
  void contents.loadURL(targetUrl);
  return view;
}

function closeMagpieWindow() {
  if (activeWindow && !activeWindow.isDestroyed()) {
    activeWindow.destroy();
  }
  activeWindow = null;
  activeView = null;
  activeOrigin = '';
  activeOnClose = null;
}

module.exports = {
  TOPBAR_HEIGHT,
  MAGPIE_PARTITION,
  buildMagpieTargetUrl,
  openMagpieWindow,
  closeMagpieWindow,
};
