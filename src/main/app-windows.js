'use strict';

const { app } = require('electron');
const { loadConfig } = require('./config');
const { hideOnClose } = require('./close-behavior');
const {
  createMainWindow,
  getMainWindow,
  getLauncherWindow,
  showLauncher,
  showMain,
} = require('./window');
const { TrayHideNotice } = require('./background-notice');
const { systemNotificationsSupported } = require('./system-notifications');

/**
 * Main/launcher window lifecycle wiring extracted from index.js (#439 P3-4):
 * close handlers (tray hide vs protected quit), the first-hide notification,
 * launcher presentation, and foreground selection. Behavior is unchanged;
 * mutable entry state arrives through `state` and cross-phase collaborators
 * through explicit deps.
 *
 * @param {object} deps
 * @param {import('./app-shell-state').ShellState} deps.state
 * @param {() => void} deps.quitApp — the shared quit funnel
 * @param {() => boolean} deps.isDesktopKernelRunning — live kernel probe
 * @param {{ drain: (options?: object) => unknown }} deps.drainParkedUpdateCheck
 *   — consumes a parked late update check while the launcher is on screen
 */
function createAppWindows({ state, quitApp, isDesktopKernelRunning, drainParkedUpdateCheck }) {
  const mainCloseBound = new WeakSet();
  const launcherCloseBound = new WeakSet();

  const trayHideNotice = new TrayHideNotice({
    markerPath: require('node:path').join(app.getPath('userData'), 'tray-hide-acknowledged'),
    notify: () => {
      const { Notification } = require('electron');
      if (!systemNotificationsSupported(Notification)) return;
      new Notification({
        title: '已最小化到托盘',
        body: '点击托盘图标可重新打开窗口，托盘菜单可完全退出。关闭行为见「设置 → 通用 → 关闭窗口时」。',
      }).show();
    },
  });

  /**
   * @param {any} win
   */
  function bindMainClose(win) {
    if (!win || mainCloseBound.has(win)) {
      return win;
    }
    mainCloseBound.add(win);
    win.on('close', (/** @type {any} */ event) => {
      if (state.quitting) {
        // Keep windows alive until cleanup authorizes the final native close.
        if (!state.nativeQuitReady) event.preventDefault();
        return;
      }
      if (hideOnClose(loadConfig(), state.quitting)) {
        event.preventDefault();
        // First hide gets one transient toast naming the tray destination and
        // the setting; later hides are fully silent.
        trayHideNotice.close(() => {
          if (!win.isDestroyed()) win.hide();
        });
        return;
      }
      event.preventDefault();
      quitApp();
    });
    return win;
  }

  function createMainWindowWithClose() {
    return bindMainClose(createMainWindow({ activate: !state.backgroundStartup }));
  }

  /**
   * @param {any} win
   */
  function bindLauncherClose(win) {
    if (!win || launcherCloseBound.has(win)) {
      return win;
    }
    launcherCloseBound.add(win);
    // A late check can also settle while the launcher is already on screen.
    win.on('show', () => {
      state.launcherWindowHandle = win;
      void drainParkedUpdateCheck.drain({ generation: win });
    });
    win.on('closed', () => {
      if (state.launcherWindowHandle === win) state.launcherWindowHandle = null;
    });
    win.on('close', (/** @type {any} */ event) => {
      if (state.quitting) {
        if (!state.nativeQuitReady) event.preventDefault();
        return;
      }
      if (getMainWindow()) {
        return;
      }
      event.preventDefault();
      quitApp();
    });
    return win;
  }

  /**
   * @param {Record<string, any>} [options]
   */
  async function openLauncher(options = {}) {
    const win = await showLauncher(options);
    bindLauncherClose(win);
    state.launcherWindowHandle = win;
    // Visible launcher: this is the moment a parked late update check may be
    // presented, pinned to the window the user is actually looking at.
    void drainParkedUpdateCheck.drain({ generation: win });
    return win;
  }

  function showForeground() {
    const win = getMainWindow();
    if (win && isDesktopKernelRunning()) {
      showMain();
      return;
    }
    void openLauncher();
  }

  return {
    bindMainClose,
    createMainWindowWithClose,
    bindLauncherClose,
    openLauncher,
    showForeground,
  };
}

module.exports = { createAppWindows };
