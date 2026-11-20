'use strict';

/**
 * Independent transparent always-on-top approval popup BrowserWindow.
 * Never sets a parent window so minimizing or hiding the main window to tray
 * never hides pending approval cards.
 */

const path = require('node:path');
const { BrowserWindow, screen, powerMonitor } = require('electron');
const { markWindowTransparent } = require('../chrome');
const { rendererFile } = require('../paths');
const { isPackagedRendererFileUrl } = require('../local-url');

const CARD_WIDTH = 380;
const CARD_HEIGHT = 300;
const SHADOW_GUTTER = 12;
const EDGE_MARGIN = 16;
const WINDOW_WIDTH = CARD_WIDTH + SHADOW_GUTTER * 2;
const WINDOW_HEIGHT = CARD_HEIGHT + SHADOW_GUTTER * 2;

const APPROVAL_POPUP_IPC = Object.freeze({
  state: 'shell:approval-popup-state',
  decide: 'shell:approval-popup-decide',
  select: 'shell:approval-popup-select',
  openSession: 'shell:approval-popup-open-session',
  dismiss: 'shell:approval-popup-dismiss',
  changed: 'shell:approval-popup-changed',
});

/**
 * Anchor the visible 380x300 card 16px inside the primary display workArea
 * bottom-right while keeping a 12px transparent shadow gutter around it.
 * @param {{ x: number, y: number, width: number, height: number }} workArea
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function computePopupBounds(workArea) {
  const x = Math.max(
    workArea.x,
    Math.round(workArea.x + workArea.width - EDGE_MARGIN - CARD_WIDTH - SHADOW_GUTTER),
  );
  const y = Math.max(
    workArea.y,
    Math.round(workArea.y + workArea.height - EDGE_MARGIN - CARD_HEIGHT - SHADOW_GUTTER),
  );
  return { x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
}

/**
 * @param {object} [deps]
 * @param {typeof BrowserWindow} [deps.BrowserWindowImpl]
 * @param {typeof screen} [deps.screenImpl]
 * @param {typeof powerMonitor} [deps.powerMonitorImpl]
 * @param {(win: any) => void} [deps.markTransparent]
 * @param {string} [deps.preloadPath]
 * @param {string} [deps.htmlPath]
 * @param {string} [deps.platform]
 * @param {(message: string) => void} [deps.log]
 */
function createApprovalPopupController(deps = {}) {
  const BrowserWindowCtor = deps.BrowserWindowImpl || BrowserWindow;
  const screenApi = deps.screenImpl || screen;
  const powerApi = deps.powerMonitorImpl || powerMonitor;
  const markTransparent = deps.markTransparent || markWindowTransparent;
  const preloadPath = deps.preloadPath || path.join(__dirname, '..', '..', 'preload', 'approval-popup.js');
  const htmlPath = deps.htmlPath || rendererFile('approval-popup.html');
  const platform = deps.platform || process.platform;
  const log = typeof deps.log === 'function' ? deps.log : () => {};

  /** @type {any} */
  let win = null;
  let loaded = false;
  let desiredVisible = false;
  let disposed = false;
  /** @type {import('./state').PopupView | null} */
  let latestView = null;
  /** @type {{ x: number, y: number, width: number, height: number } | null} */
  let lastBounds = null;
  /** @type {(() => void) | null} */
  let unbindEnvironment = null;

  function currentWorkArea() {
    const display = screenApi?.getPrimaryDisplay?.();
    if (display?.workArea) return display.workArea;
    if (display?.workAreaSize) {
      return { x: 0, y: 0, width: display.workAreaSize.width, height: display.workAreaSize.height };
    }
    return { x: 0, y: 0, width: 1440, height: 900 };
  }

  /** @param {{ x: number, y: number, width: number, height: number }} bounds */
  function syncBounds(bounds) {
    if (!win || win.isDestroyed()) return;
    const same = lastBounds
      && lastBounds.x === bounds.x
      && lastBounds.y === bounds.y
      && lastBounds.width === bounds.width
      && lastBounds.height === bounds.height;
    if (win.isVisible() && same) return;
    win.setBounds(bounds, false);
    lastBounds = { ...bounds };
  }

  function applyBoundsAndPresent() {
    if (!win || win.isDestroyed() || !loaded || !desiredVisible) return;
    const bounds = computePopupBounds(currentWorkArea());
    syncBounds(bounds);
    pushView();
    if (!win.isVisible()) {
      win.showInactive();
      if (win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.invalidate?.();
      }
    }
  }

  function pushView() {
    if (!win || win.isDestroyed() || !loaded || !latestView) return;
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(APPROVAL_POPUP_IPC.changed, latestView);
    }
  }

  function detachEnvironmentListeners() {
    if (unbindEnvironment) {
      unbindEnvironment();
      unbindEnvironment = null;
    }
  }

  function bindEnvironmentListeners() {
    detachEnvironmentListeners();
    const reposition = () => {
      if (!win || win.isDestroyed()) return;
      if (desiredVisible && loaded) {
        syncBounds(computePopupBounds(currentWorkArea()));
      }
      if (win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.invalidate?.();
      }
    };
    screenApi?.on?.('display-metrics-changed', reposition);
    powerApi?.on?.('resume', reposition);
    powerApi?.on?.('unlock-screen', reposition);
    unbindEnvironment = () => {
      screenApi?.removeListener?.('display-metrics-changed', reposition);
      powerApi?.removeListener?.('resume', reposition);
      powerApi?.removeListener?.('unlock-screen', reposition);
    };
  }

  function ensureWindow() {
    if (disposed) return null;
    if (win && !win.isDestroyed()) return win;

    loaded = false;
    lastBounds = null;
    const bounds = computePopupBounds(currentWorkArea());
    const created = new BrowserWindowCtor({
      x: bounds.x,
      y: bounds.y,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      roundedCorners: false,
      hasShadow: false,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      show: false,
      ...(platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    win = created;
    markTransparent(created);
    created.setAlwaysOnTop?.(true, 'floating');
    if (platform === 'darwin') {
      created.setVisibleOnAllWorkspaces?.(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    }

    const wc = created.webContents;
    wc.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    wc.on?.('will-navigate', (/** @type {any} */ event, /** @type {string} */ url) => {
      if (!isPackagedRendererFileUrl(url, 'approval-popup.html', { resolvePath: () => htmlPath })) {
        event.preventDefault();
      }
    });
    wc.on?.('did-finish-load', () => {
      if (win !== created || created.isDestroyed()) return;
      loaded = true;
      if (desiredVisible) {
        applyBoundsAndPresent();
      } else {
        pushView();
      }
    });
    wc.on?.('render-process-gone', (_event, details) => {
      log(`[approval-monitor] popup renderer exited (${details?.reason || 'unknown'})`);
      if (win !== created) return;
      win = null;
      loaded = false;
      lastBounds = null;
      detachEnvironmentListeners();
      if (!created.isDestroyed()) created.destroy();
      if (desiredVisible && !disposed) {
        ensureWindow();
      }
    });
    created.on('closed', () => {
      if (win === created) {
        win = null;
        loaded = false;
        lastBounds = null;
        detachEnvironmentListeners();
      }
    });

    bindEnvironmentListeners();
    void created.loadFile(htmlPath).catch((/** @type {unknown} */ error) => {
      log(`[approval-monitor] popup loadFile failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return created;
  }

  /** @param {import('./state').PopupView} view */
  function sync(view) {
    latestView = view;
    desiredVisible = Boolean(view.visible);
    if (disposed) return;

    if (desiredVisible) {
      ensureWindow();
      if (loaded) applyBoundsAndPresent();
      return;
    }

    if (win && !win.isDestroyed()) {
      pushView();
      if (win.isVisible()) win.hide();
    }
  }

  function recreateIfVisible() {
    if (disposed) return;
    const current = win;
    win = null;
    loaded = false;
    lastBounds = null;
    detachEnvironmentListeners();
    if (current && !current.isDestroyed()) {
      current.destroy();
    }
    if (desiredVisible) {
      ensureWindow();
    }
  }

  /** @param {any} event @returns {boolean} */
  function ownsEvent(event) {
    if (!win || win.isDestroyed() || !event || event.sender !== win.webContents) return false;
    if (event.senderFrame && win.webContents.mainFrame && event.senderFrame !== win.webContents.mainFrame) {
      return false;
    }
    const url = event.senderFrame?.url || (typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');
    return isPackagedRendererFileUrl(url, 'approval-popup.html', { resolvePath: () => htmlPath });
  }

  function dispose() {
    disposed = true;
    desiredVisible = false;
    detachEnvironmentListeners();
    const current = win;
    win = null;
    loaded = false;
    lastBounds = null;
    if (current && !current.isDestroyed()) {
      current.destroy();
    }
  }

  return {
    sync,
    recreateIfVisible,
    ownsEvent,
    dispose,
    getWindow: () => (win && !win.isDestroyed() ? win : null),
  };
}

module.exports = {
  APPROVAL_POPUP_IPC,
  createApprovalPopupController,
};
