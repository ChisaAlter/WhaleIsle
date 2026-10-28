const { BrowserWindow, ipcMain, nativeTheme, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { resolveTheme, officialShellBackground, windowBackgroundForShell } = require('../shared/themes');
const { IPC_ROLES, assertIpcSender } = require('./ipc-authorization');
const { enableNativeWindowMotion, hasNativeWindowMotion, isNativeWindowMaximized, toggleNativeMaximize } = require('./native-window-motion');

const TITLEBAR_HEIGHT = 48;
const injectScript = fs.readFileSync(path.join(__dirname, 'harness-chrome-inject.js'), 'utf8');
let ipcBound = false;
const chromeRoles = new WeakMap();
const transparentWindows = new WeakSet();

function markWindowTransparent(win) {
  transparentWindows.add(win);
}

function chromeBackgroundFor(win, theme = currentTheme()) {
  if (transparentWindows.has(win)) {
    return '#00000000';
  }
  const role = chromeRoles.get(win);
  let url;
  try {
    url = win.webContents.getURL();
  } catch {
    // window already gone; role from WeakMap is still enough for the launcher
  }
  return windowBackgroundForShell(theme, { role, url });
}

function currentTheme() {
  return resolveTheme(loadConfig(), {
    systemDark: Boolean(nativeTheme && nativeTheme.shouldUseDarkColors),
  });
}

function windowChrome(overrides = {}) {
  const theme = currentTheme();
  return {
    frame: false,
    // Transparent windows paint their own silhouette — Windows 11's DWM
    // corner mask (~8px) would clip the larger page-drawn arc as a
    // stair-stepped edge. Opaque chrome windows keep the OS rounding.
    roundedCorners: !overrides.transparent,
    backgroundColor: theme.bg,
    autoHideMenuBar: true,
    ...overrides,
  };
}

// Feature: window-motion. Keep 20px alpha corners; attachIntegratedChrome
// restores the native animation styles before either shell window is shown.
function shellWindowChrome(overrides = {}) {
  return windowChrome({
    ...overrides,
    transparent: true,
    thickFrame: true,
    roundedCorners: false,
    backgroundColor: '#00000000',
    ...(process.platform === 'darwin' ? {
      // AppKit needs its titled style for standard buttons. Disabling native
      // corners makes Electron remove that style before creating the buttons.
      roundedCorners: true,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 18 },
    } : {}),
  });
}

function hideNativeMenu(win) {
  if (!win || win.isDestroyed()) {
    return;
  }
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);
}

function isHarnessUrl(url) {
  const { isLoopbackHttpUrl } = require('./local-url');
  return isLoopbackHttpUrl(url);
}

function paintBackground(win, color) {
  if (!win || win.isDestroyed() || !color || transparentWindows.has(win)) {
    return;
  }
  win.setBackgroundColor(color);
}

const WINDOW_ROLES = [IPC_ROLES.BOOT, IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER];

function authorizedRole(event, roles) {
  try {
    return assertIpcSender(event, roles);
  } catch {
    return null;
  }
}

function windowFromEvent(event, role) {
  if (role === IPC_ROLES.HARNESS) {
    const { getMainWindow } = require('./window');
    return getMainWindow();
  }
  return BrowserWindow.fromWebContents(event.sender);
}

/**
 * Geometry-backed maximize check. Transparent frameless windows maximize by
 * bounds on Windows — isMaximized() stays false and unmaximize/restore are
 * no-ops — so the effective state is "covers the display work area".
 * @param {Electron.BrowserWindow} win
 */
function isEffectivelyMaximized(win) {
  const nativeMaximized = isNativeWindowMaximized(win);
  if (typeof nativeMaximized === 'boolean') return nativeMaximized;
  if (!win || win.isDestroyed() || win.isMinimized()) {
    return false;
  }
  if (win.isMaximized()) {
    return true;
  }
  // An opaque native window can fill the work area without being maximized.
  if (!transparentWindows.has(win) || hasNativeWindowMotion(win)) return false;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  return coversWorkArea(bounds, area);
}

function coversWorkArea(bounds, area) {
  return Boolean(bounds) && bounds.x <= area.x && bounds.y <= area.y
    && bounds.width >= area.width && bounds.height >= area.height;
}

const DEFAULT_NORMAL_SIZE = { width: 1440, height: 920 };

/**
 * The rect a fake-maximized window should restore to. `_dshNormalBounds` is
 * tracked from real geometry, but it can be missing or itself cover the work
 * area (e.g. a small display where the normal size already fills it) — in
 * that case restoring must still land on a real windowed rect, centered at
 * the default size, or the maximize button is a silent no-op.
 */
function restorableNormalBounds(win) {
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const normal = win._dshNormalBounds;
  if (normal && !coversWorkArea(normal, area)) {
    return normal;
  }
  const width = Math.min(DEFAULT_NORMAL_SIZE.width, area.width);
  const height = Math.min(DEFAULT_NORMAL_SIZE.height, area.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) {
    return;
  }
  const payload = {
    maximized: isEffectivelyMaximized(win),
    fullscreen: win.isFullScreen(),
    minimizable: win.minimizable,
    maximizable: win.maximizable,
    // The Harness view keeps backgroundThrottling off (minimize blank-flash),
    // so its page cannot see that the window left the screen.
    visible: win.isVisible() && !win.isMinimized(),
  };
  if (!win.webContents.isDestroyed()) {
    win.webContents.send('shell:window-state', payload);
  }
  try {
    const { getHarnessWebContents } = require('./window');
    const harnessWc = getHarnessWebContents(win);
    if (harnessWc && !harnessWc.isDestroyed()) {
      harnessWc.send('shell:window-state', payload);
    }
  } catch {
    // window module is still loading
  }
}

function bindChromeIpc() {
  if (ipcBound) {
    return;
  }
  ipcBound = true;

  ipcMain.on('shell:window', (event, action) => {
    const role = authorizedRole(event, WINDOW_ROLES);
    if (!role) return;
    const win = windowFromEvent(event, role);
    if (!win || win.isDestroyed()) {
      return;
    }
    if (action === 'minimize' && win.minimizable) {
      // After a caption-classified mousedown, Windows ignores minimize/maximize
      // in the same turn; run on the next tick.
      setImmediate(() => {
        if (!win.isDestroyed() && win.minimizable) {
          win.minimize();
        }
      });
    } else if (action === 'maximize' && win.maximizable) {
      setImmediate(() => {
        if (win.isDestroyed() || !win.maximizable) {
          return;
        }
        if (toggleNativeMaximize(win)) return;
        if (win.isMaximized()) {
          win.unmaximize();
        } else if (isEffectivelyMaximized(win)) {
          // Fake-maximized transparent window: native unmaximize is a no-op,
          // snap back to a real windowed rect (tracked normal bounds, or a
          // centered default when the tracked rect itself fills the work area).
          win.setBounds(restorableNormalBounds(win));
        } else {
          win._dshNormalBounds = win.getBounds();
          win.maximize();
        }
      });
    } else if (action === 'close') {
      win.close();
    }
  });

  ipcMain.handle('shell:window-state', (event) => {
    const role = assertIpcSender(event, WINDOW_ROLES);
    const win = windowFromEvent(event, role);
    if (!win || win.isDestroyed()) {
      return { maximized: false, fullscreen: false, minimizable: true, maximizable: true };
    }
    return {
      maximized: isEffectivelyMaximized(win),
      fullscreen: win.isFullScreen(),
      minimizable: win.minimizable,
      maximizable: win.maximizable,
    };
  });

  ipcMain.on('shell:chrome-metrics', (event, metrics) => {
    const role = authorizedRole(event, [IPC_ROLES.HARNESS]);
    if (!role) return;
    const win = windowFromEvent(event, role);
    if (win && metrics?.bg) {
      paintBackground(win, metrics.bg);
    }
  });
}

// Transient rejections happen when the eval races a navigation frame swap —
// without a retry the window keeps the page but loses controls and the
// rounded silhouette until the next navigation event happens to land.
const CHROME_INJECT_RETRY_MS = [250, 700, 1500, 3000];
// Overlapping callers (nav events, focus/show re-asserts) must not stack
// retry loops — one in-flight loop per WebContents already re-gates on the
// current URL each attempt, so a second caller adds nothing.
const injectInflight = new WeakSet();

async function syncHarnessChrome(win, webContents = win.webContents) {
  if (!webContents || injectInflight.has(webContents)) {
    return;
  }
  injectInflight.add(webContents);
  try {
    for (let attempt = 0; ; attempt += 1) {
      if (win.isDestroyed() || webContents.isDestroyed() || !isHarnessUrl(webContents.getURL())) {
        return;
      }
      try {
        const sample = await webContents.executeJavaScript(injectScript);
        if (sample?.bg) {
          paintBackground(win, sample.bg);
        }
        return;
      } catch {
        const delay = CHROME_INJECT_RETRY_MS[attempt];
        if (delay === undefined) {
          paintBackground(win, '#ffffff');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  } finally {
    injectInflight.delete(webContents);
  }
}

function prepareHarnessChrome(win) {
  paintBackground(win, '#ffffff');
}

function applyAppTheme() {
  const theme = currentTheme();
  const { getHarnessWebContents } = require('./window');
  require('./desktop-pet').getDesktopPet()?.setTheme(theme);
  for (const win of BrowserWindow.getAllWindows()) {
    const harnessWc = getHarnessWebContents(win);
    if (harnessWc && isHarnessUrl(harnessWc.getURL())) {
      syncHarnessChrome(win, harnessWc);
    } else if (isHarnessUrl(win.webContents.getURL())) {
      syncHarnessChrome(win);
    } else {
      paintBackground(win, chromeBackgroundFor(win, theme));
      win.webContents.send('shell:theme', theme);
    }
    sendWindowState(win);
  }
  return theme;
}

/**
 * Repaint every window when the OS light/dark preference flips so themes
 * that follow the system table stay current without a restart.
 * Injectable for tests; returns an unsubscribe.
 */
function watchSystemTheme({ theme = nativeTheme, apply = applyAppTheme } = {}) {
  if (!theme || typeof theme.on !== 'function') {
    return () => {};
  }
  const listener = () => apply();
  theme.on('updated', listener);
  return () => {
    if (typeof theme.off === 'function') {
      theme.off('updated', listener);
    } else if (typeof theme.removeListener === 'function') {
      theme.removeListener('updated', listener);
    }
  };
}

function attachIntegratedChrome(win, options = {}) {
  enableNativeWindowMotion(win);
  if (process.platform === 'darwin') {
    win.setWindowButtonPosition({ x: 16, y: options.role === 'launcher' ? 9 : 18 });
    win.setWindowButtonVisibility(true);
  }
  if (options.role) {
    chromeRoles.set(win, options.role);
  }
  bindChromeIpc();
  hideNativeMenu(win);
  paintBackground(win, chromeBackgroundFor(win));

  const apply = () => {
    if (win.isDestroyed()) {
      return;
    }
    hideNativeMenu(win);
    sendWindowState(win);
    if (isHarnessUrl(win.webContents.getURL())) {
      prepareHarnessChrome(win);
      syncHarnessChrome(win);
      return;
    }
    paintBackground(win, chromeBackgroundFor(win));
  };

  // Fake-maximized transparent windows never flip isMaximized(), so the
  // effective state is tracked from geometry: push on every transition and
  // keep the last normal rect for the restore path in 'shell:window'.
  win._dshNormalBounds = win.getBounds();
  let lastMaximized = null;
  const syncMaximizedState = () => {
    const maximized = isEffectivelyMaximized(win);
    if (maximized !== lastMaximized) {
      lastMaximized = maximized;
      sendWindowState(win);
    }
    if (!maximized) {
      win._dshNormalBounds = win.getBounds();
    }
  };
  win.on('resize', syncMaximizedState);
  win.on('moved', syncMaximizedState);
  win.on('maximize', () => sendWindowState(win));
  win.on('unmaximize', () => sendWindowState(win));
  win.on('enter-full-screen', () => sendWindowState(win));
  win.on('leave-full-screen', () => sendWindowState(win));
  for (const event of ['minimize', 'restore', 'hide', 'show']) win.on(event, () => sendWindowState(win));
  win.webContents.on('did-finish-load', apply);
  win.webContents.on('dom-ready', apply);
  win.webContents.on('did-navigate-in-page', apply);
}

module.exports = {
  TITLEBAR_HEIGHT,
  windowChrome,
  shellWindowChrome,
  hideNativeMenu,
  attachIntegratedChrome,
  applyAppTheme,
  watchSystemTheme,
  prepareHarnessChrome,
  syncHarnessChrome,
  isEffectivelyMaximized,
  restorableNormalBounds,
  currentTheme,
  isHarnessUrl,
  markWindowTransparent,
  paintBackground,
  officialShellBackground,
};
