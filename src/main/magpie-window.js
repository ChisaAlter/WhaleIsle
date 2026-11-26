'use strict';

const path = require('node:path');
const { isHttpOrHttpsUrl, isLoopbackHttpUrl, isPackagedRendererFileUrl } = require('./local-url');

const TOPBAR_HEIGHT = 38;
const MAGPIE_PARTITION = 'persist:magpie';

/** @type {Electron.BrowserWindow | null} */
let activeWindow = null;
/** @type {Electron.WebContentsView | null} */
let activeView = null;
/** @type {string} */
let activeTargetUrl = '';
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
 * Keep the embedded WebContentsView inside the 1px outer shell hairline and
 * 20px transparent corner radius when windowed on Windows/Linux, expanding to
 * full edge-to-edge bounds when maximized, fullscreen, or on macOS.
 * @param {Electron.BrowserWindow} win
 * @param {Electron.WebContentsView} view
 * @param {any} nativeMotion
 */
function applyViewBounds(win, view, nativeMotion) {
  if (!win || win.isDestroyed() || !view) return;
  const [w, h] = win.getContentSize();
  const maximized = Boolean(nativeMotion?.isNativeWindowMaximized(win) ?? win.isMaximized?.());
  const fullscreen = Boolean(win.isFullScreen?.());
  if (maximized || fullscreen || process.platform === 'darwin') {
    view.setBounds({ x: 0, y: TOPBAR_HEIGHT, width: Math.max(0, w), height: Math.max(0, h - TOPBAR_HEIGHT) });
    view.setBorderRadius?.(0);
    return;
  }
  view.setBounds({
    x: 1,
    y: TOPBAR_HEIGHT,
    width: Math.max(0, w - 2),
    height: Math.max(0, h - TOPBAR_HEIGHT - 1),
  });
  view.setBorderRadius?.(19);
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
  if (state.activeTargetUrl !== deps.targetUrl && state.activeView) {
    try {
      state.activeWindow.contentView.removeChildView(state.activeView);
      state.activeView.webContents.close?.();
    } catch {
      // Ignore teardown errors when replacing the embedded view.
    }
    state.activeTargetUrl = deps.targetUrl;
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
 * @param {any} deps
 */
function attachShellIpc(win, deps) {
  const contents = win.webContents;
  const isOwnedSender = (/** @type {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} */ event) => (
    !win.isDestroyed() &&
    event.sender === contents &&
    event.senderFrame === contents.mainFrame &&
    isPackagedRendererFileUrl(event.senderFrame?.url, 'magpie-shell.html')
  );
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guardShellNavigation = (/** @type {Electron.Event} */ event, /** @type {string} */ targetUrl) => {
    if (!isPackagedRendererFileUrl(targetUrl, 'magpie-shell.html')) event.preventDefault();
  };
  contents.on('will-navigate', guardShellNavigation);
  contents.on('will-redirect', guardShellNavigation);
  contents.on('will-frame-navigate', (/** @type {any} */ event) => {
    if (!isPackagedRendererFileUrl(event?.url, 'magpie-shell.html')) event?.preventDefault?.();
  });
  const isMaximized = () => Boolean(deps.nativeMotion.isNativeWindowMaximized(win) ?? win.isMaximized?.());
  const isFullScreen = () => Boolean(win.isFullScreen?.());
  const windowState = () => ({
    maximized: isMaximized(),
    fullscreen: isFullScreen(),
    minimizable: win.minimizable,
    maximizable: win.maximizable,
  });

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
    const targetUrl = deps.getTargetUrl?.();
    if (targetUrl) {
      let nextUrl = targetUrl;
      try {
        const currentRaw = typeof view.webContents.getURL === 'function' ? view.webContents.getURL() : '';
        if (currentRaw) {
          const cur = new URL(currentRaw);
          const tgt = new URL(targetUrl);
          if (cur.origin === tgt.origin) {
            for (const [k, v] of tgt.searchParams.entries()) {
              cur.searchParams.set(k, v);
            }
            nextUrl = cur.href;
          }
        }
      } catch {
        nextUrl = targetUrl;
      }
      void view.webContents.loadURL(nextUrl);
      return;
    }
    view.webContents.reload?.();
  });
  contents.ipc.handle('magpie:open-external-update', async (event) => {
    if (!isOwnedSender(event)) throw new Error('Unauthorized Magpie shell sender');
    const url = deps.getMeta().externalUpdateUrl;
    return isHttpOrHttpsUrl(url) ? deps.openExternalHttp(url) : false;
  });

  let lastStateKey = '';
  const syncState = () => {
    if (win.isDestroyed()) return;
    const nextKey = `${isMaximized()}:${isFullScreen()}`;
    if (nextKey === lastStateKey) return;
    lastStateKey = nextKey;
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
      { activeWindow, activeView, activeTargetUrl, activeMeta, activeOnClose },
      {
        meta,
        targetUrl,
        activate: options.activate,
        onClose: options.onClose,
        remount: () => {
          const view = mountMagpieView(/** @type {Electron.BrowserWindow} */ (activeWindow), targetUrl, origin, WebContentsView, session, openExternalHttp);
          applyViewBounds(/** @type {Electron.BrowserWindow} */ (activeWindow), view, nativeMotion);
          return view;
        },
      },
    );
    activeView = updated.activeView;
    activeTargetUrl = updated.activeTargetUrl;
    activeMeta = updated.activeMeta;
    activeOnClose = updated.activeOnClose;
    return;
  }

  activeMeta = meta;
  activeTargetUrl = targetUrl;
  activeOnClose = typeof options.onClose === 'function' ? options.onClose : null;

  const chromeOptions = chrome.shellWindowChrome({
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
  chrome.markWindowTransparent?.(win);
  nativeMotion.enableNativeWindowMotion(win);
  if (process.platform === 'darwin') {
    win.setWindowButtonPosition?.({ x: 16, y: 11 });
    win.setWindowButtonVisibility?.(true);
  }

  const { syncState } = attachShellIpc(win, {
    nativeMotion,
    openExternalHttp,
    getMeta: () => activeMeta,
    getView: () => activeView,
    getTargetUrl: () => activeTargetUrl,
  });
  const syncBounds = () => {
    applyViewBounds(win, /** @type {Electron.WebContentsView} */ (activeView), nativeMotion);
  };
  for (const event of ['maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen', 'resize']) {
    win.on(/** @type {any} */ (event), () => {
      syncState();
      syncBounds();
    });
  }

  activeView = mountMagpieView(win, targetUrl, origin, WebContentsView, session, openExternalHttp);
  syncBounds();

  win.once('ready-to-show', () => (options.activate !== false ? win.show() : win.showInactive()));
  win.once('closed', () => {
    const onClose = activeOnClose;
    if (activeWindow === win) {
      activeWindow = null;
      activeView = null;
      activeTargetUrl = '';
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
  const isAllowedFrameUrl = (/** @type {string} */ target) => {
    if (!target) return false;
    if (target === 'about:blank' || target === 'about:srcdoc') return true;
    try {
      return new URL(target).origin === origin;
    } catch {
      return false;
    }
  };
  contents.on('will-navigate', (/** @type {Electron.Event} */ event, /** @type {string} */ target) => {
    try {
      if (new URL(target).origin !== origin) {
        event.preventDefault();
        if (isHttpOrHttpsUrl(target)) void openExternalHttp(target);
      }
    } catch {
      event.preventDefault();
    }
  });
  contents.on('will-redirect', (/** @type {Electron.Event} */ event, /** @type {string} */ target) => {
    try {
      if (new URL(target).origin !== origin) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });
  contents.on('will-frame-navigate', (/** @type {any} */ event) => {
    if (!isAllowedFrameUrl(event?.url)) {
      event?.preventDefault?.();
    }
  });
  void contents.loadURL(targetUrl);
  return view;
}

/**
 * Push an updated theme to the currently open Magpie shell window.
 * @param {{ scheme?: string } | null | undefined} theme
 * @returns {boolean}
 */
function syncMagpieTheme(theme) {
  if (!theme || typeof theme !== 'object') return false;
  activeMeta = { ...activeMeta, theme };
  if (activeTargetUrl && (theme.scheme === 'dark' || theme.scheme === 'light')) {
    try {
      activeTargetUrl = buildMagpieTargetUrl(activeTargetUrl, theme);
    } catch {
      // Keep activeTargetUrl untouched if it is malformed.
    }
  }
  if (!activeWindow || activeWindow.isDestroyed() || activeWindow.webContents.isDestroyed()) {
    return false;
  }
  activeWindow.webContents.send('magpie:shell-meta', activeMeta);
  return true;
}

function closeMagpieWindow() {
  const win = activeWindow;
  activeWindow = null;
  activeView = null;
  activeTargetUrl = '';
  activeOnClose = null;
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
}

module.exports = {
  TOPBAR_HEIGHT,
  MAGPIE_PARTITION,
  buildMagpieTargetUrl,
  openMagpieWindow,
  syncMagpieTheme,
  closeMagpieWindow,
};
