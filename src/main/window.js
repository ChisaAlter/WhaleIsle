const { app, BrowserView, BrowserWindow, shell, nativeImage, screen } = require('electron');
const { attachRendererConsoleTail, RendererConsoleTail, writeCrashReport, desktopErrorState } = require('./crash-report');
const { rendererFile, assetFile, preloadFile } = require('./paths');
const { applyWindowsAppDetails } = require('./window-app-details');
const { REMOTE_FEATURE_ENABLED } = require('./config');
const { shellWindowChrome, attachIntegratedChrome, hideNativeMenu, prepareHarnessChrome, syncHarnessChrome, currentTheme, markWindowTransparent, paintBackground } = require('./chrome');
const { normalizeSettingsSection, buildSettingsSectionScript } = require('./settings-jump');
const {
  isLoopbackHttpUrl,
  isSameOriginLoopbackUrl,
  isLocalAppNavigationUrl,
  isLauncherNavigationUrl,
  isHttpOrHttpsUrl,
  rewriteLoopbackLoadUrl,
  shouldAllowPrivilegedNavigate,
  shouldAllowPrivilegedRedirect,
} = require('./local-url');

const { applyHarnessCookieToSession, launchTokenFromUrl, loadUrlAfterRedeem } = require('./harness-browser-auth');

const PLUGIN_BOOT_TIMEOUT_MS = 90_000;

// A dead frameless renderer can leave no usable controls. Offer
// reload-or-quit so a crash never strands the user. The dialog is anchored
// to no window so it stays visible even when the surface is hidden in tray.
// Renderer error-level console lines retained across windows for crash files.
const rendererConsoleTail = new RendererConsoleTail();

/** app.getPath('logs') resolves only after ready; reports defer without it. */
function crashLogDir() {
  try {
    const { app } = require('electron');
    return require('node:path').join(app.getPath('logs'), 'crash');
  } catch {
    return null;
  }
}

/** Persist the diagnostic, then keep only its last lines in the dialog. */
async function writeRendererReport(why, contents) {
  const dir = crashLogDir();
  if (!dir) return undefined;
  const { app } = require('electron');
  return writeCrashReport(dir, {
    source: 'renderer',
    phase: 'running',
    error: desktopErrorState(new Error(why)),
    rendererConsole: rendererConsoleTail.snapshot(),
    app: {
      name: 'Whale Isle',
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron || '',
      node: process.versions.node || '',
      locale: app.getLocale(),
    },
    time: new Date(),
  });
}

const RECOVERY_DETAIL_TAIL_LINES = 8;
const RECOVERY_DETAIL_BUDGET = 1200;

// The composition root injects its productized confirmDialog so the crash
// recovery prompt renders in-window when the crashed window is still visible;
// without it the native messagebox is the honest fallback.
let recoveryConfirm = null;

function setRecoveryConfirm(fn) {
  recoveryConfirm = typeof fn === 'function' ? fn : null;
}

function attachRendererRecovery(contents, label) {
  if (!contents || contents.__dshdRecoveryAttached) {
    return;
  }
  contents.__dshdRecoveryAttached = true;
  attachRendererConsoleTail(contents, rendererConsoleTail);
  let recovering = false;
  const recover = async (why) => {
    if (recovering || contents.isDestroyed()) {
      return;
    }
    recovering = true;
    try {
      const { dialog, app, BrowserWindow } = require('electron');
      const reportPath = await writeRendererReport(why, contents);
      const reportLine = reportPath ? `\n诊断已写入 ${reportPath}` : '';
      const tail = String(why).split(/\r\n|[\n\r\u2028\u2029]/u).slice(-RECOVERY_DETAIL_TAIL_LINES).join('\n');
      const budget = RECOVERY_DETAIL_BUDGET - reportLine.length;
      const shortened = tail.slice(-budget).replace(/^[\uDC00-\uDFFF]/u, '');
      const options = {
        type: 'error',
        title: '界面异常',
        message: `${label}界面发生异常`,
        detail: `${shortened === why ? String(why) : `（已截断）\n${shortened}`}${reportLine}\n\n可重新加载界面；若反复出现请退出后从启动器重新启动。`,
        buttons: ['重新加载', '退出应用'],
        defaultId: 0,
        cancelId: 0,
        dangerIds: [1],
        noLink: true,
      };
      // The harness surface is a WebContentsView (not a BrowserWindow-owned
      // webContents), so map it back to the main window explicitly.
      const owner = contents === (harnessView && harnessView.webContents)
        ? mainWindow
        : BrowserWindow.fromWebContents(contents);
      const anchor = owner && !owner.isDestroyed() && owner.isVisible() ? owner : null;
      const choice = await (recoveryConfirm
        ? recoveryConfirm(anchor, options)
        : dialog.showMessageBox(anchor || undefined, options)
      ).catch(() => ({ response: 0 }));
      if (choice.response === 0 && !contents.isDestroyed()) {
        contents.reloadIgnoringCache();
      } else if (choice.response === 1) {
        app.quit();
      }
    } finally {
      recovering = false;
    }
  };
  contents.on('render-process-gone', (_event, details) => {
    const reason = details && details.reason;
    if (reason === 'clean-exit' || reason === 'killed') {
      return;
    }
    void recover(reason || '渲染进程退出');
  });
  contents.on('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
    if (isMainFrame === false || code === -3) {
      return;
    }
    void recover(`页面加载失败（${desc || code}）`);
  });
  contents.on('unresponsive', () => {
    void recover('界面无响应');
  });
}

const PLUGIN_BOOT_PROBE = `(() => {
  const boot = document.querySelector('[data-dshd-boot-status]');
  const status = boot ? boot.getAttribute('data-dshd-boot-status') : null;
  const hasApp = Boolean(document.querySelector('[data-dsh-settings-trigger], [class*="frame"]'));
  return {
    ready: boot ? Number(boot.getAttribute('data-dshd-boot-ready')) || 0 : 0,
    total: boot ? Number(boot.getAttribute('data-dshd-boot-total')) || 0 : 0,
    pending: !hasApp,
    failed: status === 'failed',
    hasApp,
    error: boot ? String(boot.getAttribute('data-dshd-boot-error') || '') : '',
  };
})()`;

let mainWindow = null;
let harnessView = null;
let harnessRevealed = false;
let harnessOrigin = '';
let harnessOriginListener = null;
let pluginBootWatch = null;
let pendingMarketplaceJump = false;
let launcherWindow = null;

function desktopPet() {
  return require('./desktop-pet').getDesktopPet();
}

function pluginBootCancelled(message = 'Web UI 插件加载已取消') {
  const error = new Error(message);
  error.code = 'HARNESS_OPERATION_CANCELLED';
  return error;
}

function cancelPluginBootWatch() {
  pluginBootWatch?.cancel();
}

function iconImage() {
  if (process.platform === 'win32') {
    const ico = nativeImage.createFromPath(assetFile('icon.ico'));
    if (!ico.isEmpty()) return ico;
  }
  const png = nativeImage.createFromPath(assetFile('icon.png'));
  if (!png.isEmpty()) {
    return process.platform === 'win32' ? png.resize({ width: 48, height: 48 }) : png;
  }
  const svg = nativeImage.createFromPath(assetFile('icon.svg'));
  return svg.isEmpty() ? undefined : svg;
}

function attachWindowsAppDetails(win) {
  if (process.platform !== 'win32') return;
  applyWindowsAppDetails(win, {
    launcher: require('../launcher/product').isLauncherPackage(),
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    appPath: app.getAppPath(),
    iconPath: assetFile('icon.ico'),
  });
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    ...shellWindowChrome({
      width: 1440,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      show: false,
      icon: iconImage(),
    }),
    webPreferences: {
      preload: preloadFile(),
      additionalArguments: ['--dshd-shell-role=boot'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  attachWindowsAppDetails(mainWindow);
  markWindowTransparent(mainWindow);
  attachIntegratedChrome(mainWindow);
  mainWindow.once('ready-to-show', () => {
    hideNativeMenu(mainWindow);
    mainWindow.show();
  });
  mainWindow.on('closed', () => {
    hideHarnessView(mainWindow);
    mainWindow = null;
  });

  attachPrivilegedNavigationGuards(mainWindow.webContents, {
    allowUrl: isLocalAppNavigationUrl,
    openDeniedExternal: true,
  });
  attachRendererRecovery(mainWindow.webContents, '桌面端');

  return mainWindow;
}

/**
 * Pin a privileged BrowserWindow/BrowserView to an allowlist; denied
 * navigations optionally open http(s) in the system browser, and harness
 * contents may send denied loopback (not same-origin) to the preview surface.
 * @param {Electron.WebContents} contents
 * @param {{ allowUrl: (url: unknown) => boolean, openDeniedExternal?: boolean, openDeniedLoopback?: boolean }} options
 */
function attachPrivilegedNavigationGuards(contents, options) {
  const { allowUrl, openDeniedExternal = false, openDeniedLoopback = false } = options;

  function handleDeniedHttp(url) {
    if (openDeniedLoopback && isLoopbackHttpUrl(url)) {
      if (!allowUrl(url)) {
        const next = rewriteLoopbackLoadUrl(url);
        if (next && typeof contents.send === 'function') {
          contents.send('shell:open-preview-url', { url: next });
        }
      }
      return;
    }
    if (openDeniedExternal && isHttpOrHttpsUrl(url)) {
      shell.openExternal(url);
    }
  }

  contents.setWindowOpenHandler(({ url }) => {
    handleDeniedHttp(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    const current = contents.getURL();
    if (!shouldAllowPrivilegedNavigate({ nextUrl: url, currentUrl: current, allowUrl })) {
      event.preventDefault();
      handleDeniedHttp(url);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!shouldAllowPrivilegedRedirect({ nextUrl: url, allowUrl })) {
      event.preventDefault();
    }
  });
}

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function getHarnessView() {
  return harnessView && !harnessView.webContents.isDestroyed() ? harnessView : null;
}

function getHarnessWebContents(win) {
  if (!harnessView || harnessView.webContents.isDestroyed()) {
    return null;
  }
  const owner = getMainWindow();
  if (win && owner && win !== owner) {
    return null;
  }
  return harnessView.webContents;
}

function getHarnessOrigin() {
  return getHarnessWebContents() ? harnessOrigin : '';
}

function onHarnessOriginChange(listener) {
  harnessOriginListener = typeof listener === 'function' ? listener : null;
}

function notifyHarnessOrigin() {
  if (typeof harnessOriginListener === 'function') {
    try {
      harnessOriginListener(getHarnessOrigin());
    } catch {
      // Origin fans-out must not break BrowserView load.
    }
  }
}

function isHarnessNavigationUrl(url) {
  return Boolean(harnessOrigin && isSameOriginLoopbackUrl(url, harnessOrigin));
}

function harnessPageContents(win) {
  return getHarnessWebContents(win) || win?.webContents;
}

function sendPluginBoot(payload) {
  sendToBoot('shell:plugin-boot', payload);
}

function setBootHarnessCovered(win, covered) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    return;
  }
  const url = typeof win.webContents.getURL === 'function' ? win.webContents.getURL() : '';
  if (!isLocalAppNavigationUrl(url)) {
    return;
  }
  const flag = covered ? 'true' : 'false';
  // Clear the fade marker too: uncovering (runtime death → back to boot)
  // must not inherit the scene's faded-out opacity mid-transition.
  void win.webContents.executeJavaScript(
    `document.body && (document.body.toggleAttribute('data-harness-covered', ${flag}), document.body.removeAttribute('data-harness-fade'))`,
  ).catch(() => {
    // boot document may already be gone
  });
}

function hideHarnessView(win) {
  harnessRevealed = false;
  harnessOrigin = '';
  notifyHarnessOrigin();
  setBootHarnessCovered(win, false);
  cancelPluginBootWatch();
  desktopPet()?.hide(win);
  if (!harnessView) {
    return;
  }
  const view = harnessView;
  harnessView = null;
  try {
    win?.removeBrowserView(view);
  } catch {
    // already detached
  }
  if (!view.webContents.isDestroyed()) {
    view.webContents.close();
  }
}

function layoutHarnessView(win) {
  if (!harnessView || !win || win.isDestroyed() || !harnessRevealed) {
    return;
  }
  const bounds = win.getContentBounds();
  harnessView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  harnessView.setAutoResize({ width: true, height: true });
  desktopPet()?.layout(win);
}

// Slide two static pieces of boot away from its horizon. Only these image
// layers move; the live desktop never needs to repaint an animated clip.
const HARNESS_FADE_CSS = [
  'html[data-dshd-harness-fade] { opacity: 0 !important; transition: none !important; pointer-events: none !important; }',
  'html[data-dshd-harness-fade="ready"], html[data-dshd-harness-fade="in"] { opacity: 1 !important; }',
].join('\n');

const HARNESS_CURTAIN_PREPARE_SCRIPT = (snapshot, maximized) => `(async function () {
  const root = document.documentElement;
  if (!root) throw new Error('Desktop document is unavailable');
  root.toggleAttribute('data-window-maximized', ${JSON.stringify(maximized)});
  let curtains;
  let sea;
  {
    const image = new Image();
    image.src = ${JSON.stringify(snapshot)};
    await image.decode();
    image.alt = '';
    curtains = document.createElement('div');
    curtains.id = 'dshd-boot-curtains';
    curtains.setAttribute('aria-hidden', 'true');
    const sky = document.createElement('div');
    sky.className = 'dshd-boot-curtain dshd-boot-curtain-sky';
    sea = document.createElement('div');
    sea.className = 'dshd-boot-curtain dshd-boot-curtain-sea';
    sky.append(image);
    const seaImage = image.cloneNode();
    await seaImage.decode();
    sea.append(seaImage);
    curtains.append(sky, sea);
    document.body.append(curtains);
  }
  const painted = () => new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    // Hidden/minimized windows may not deliver rAF; do not stall startup.
    const timer = setTimeout(finish, 250);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
  // Upload and paint the static curtains before warming the live desktop.
  root.setAttribute('data-dshd-harness-fade', 'ready');
  await painted();
})()`;

const HARNESS_FADE_SCRIPT = `(async function () {
  const root = document.documentElement;
  const curtains = document.getElementById('dshd-boot-curtains');
  const sea = document.querySelector('.dshd-boot-curtain-sea');
  // Commit the non-animated hold before enabling the enter transition.
  if (sea) void getComputedStyle(sea).transform;
  root.setAttribute('data-dshd-harness-fade', 'in');
  // CSS transitions can start after the first compositor frame. Their native
  // completion tracks that start; a wall-clock deadline can cut motion short.
  await Promise.all(sea.getAnimations().map(animation => animation.finished.catch(() => {})));
  curtains?.remove();
})()`;

async function revealHarnessView(win) {
  if (!harnessView || !win || win.isDestroyed()) {
    return;
  }
  const view = harnessView;
  const generation = view._dshRevealGeneration = (view._dshRevealGeneration || 0) + 1;
  const current = () => harnessView === view && view._dshRevealGeneration === generation
    && !win.isDestroyed() && !view.webContents.isDestroyed();
  const mount = () => {
    harnessRevealed = true;
    if (!win.getBrowserViews().includes(view)) {
      win.addBrowserView(view);
    }
    layoutHarnessView(win);
    if (typeof win.setTopBrowserView === 'function') {
      win.setTopBrowserView(view);
    }
  };
  let cssKey;
  let curtainWindow;
  try {
    cssKey = await view.webContents.insertCSS(HARNESS_FADE_CSS);
    if (!current()) return;
    await view.webContents.executeJavaScript(
      `document.documentElement && document.documentElement.setAttribute('data-dshd-harness-fade','')`,
    );
    if (!current()) return;
    prepareHarnessChrome(win);
    await syncHarnessChrome(win, view.webContents);
    if (!current()) return;
    const reduced = await view.webContents.executeJavaScript(
      `matchMedia('(prefers-reduced-motion: reduce)').matches`,
    );
    if (!current()) return;
    const snapshot = reduced ? '' : (await win.webContents.capturePage()).toDataURL();
    if (!current()) return;
    mount();
    if (!reduced) {
      // Startup work in Harness cannot block this local renderer's frames.
      // It has no preload or desktop privileges.
      curtainWindow = new BrowserWindow({
        parent: win, show: false, frame: false, transparent: true,
        backgroundColor: '#00000000', hasShadow: false, skipTaskbar: true, focusable: false,
        webPreferences: {
          sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
        },
      });
      curtainWindow.setIgnoreMouseEvents(true);
      curtainWindow.setBounds(win.getContentBounds());
      await curtainWindow.loadFile(rendererFile('boot-reveal.html'));
      if (!current()) return;
      await curtainWindow.webContents.executeJavaScript(HARNESS_CURTAIN_PREPARE_SCRIPT(snapshot, win.isMaximized()));
      if (!current()) return;
      curtainWindow.showInactive();
    }
    // Warm the desktop while the static curtain still covers it.
    await view.webContents.executeJavaScript(`(async () => {
      document.documentElement.setAttribute('data-dshd-harness-fade', 'ready');
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 250);
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
      });
    })()`);
    if (!current()) return;
    if (curtainWindow) {
      // Wait for the whole curtain surface, including both images' raster
      // tiles. A partial readback leaves other tiles cold when motion starts.
      await curtainWindow.webContents.capturePage();
      if (!current()) return;
      await curtainWindow.webContents.executeJavaScript(HARNESS_FADE_SCRIPT);
    }
    if (!current()) return;
    await view.webContents.executeJavaScript(
      `document.getElementById('dshd-boot-curtains')?.remove(); document.documentElement && document.documentElement.removeAttribute('data-dshd-harness-fade')`,
    );
  } catch (error) {
    if (!current()) return;
    await syncHarnessChrome(win, view.webContents);
    if (!current()) return;
    mount();
    // Fallback must release the hold and attach the view, not just hide boot.
    let released = !cssKey;
    if (cssKey) {
      try { await view.webContents.removeInsertedCSS(cssKey); released = true; } catch {}
    }
    if (!current()) return;
    try {
      await view.webContents.executeJavaScript(
        `document.getElementById('dshd-boot-curtains')?.remove(); document.documentElement && document.documentElement.removeAttribute('data-dshd-harness-fade')`,
      );
      released = true;
    } catch {}
    if (!released) throw error;
  } finally {
    if (curtainWindow) {
      if (!curtainWindow.isDestroyed()) curtainWindow.destroy();
    }
    if (cssKey && !view.webContents.isDestroyed()) {
      await view.webContents.removeInsertedCSS(cssKey).catch(() => {});
    }
  }
  if (!current()) return;
  setBootHarnessCovered(win, true);
  desktopPet()?.show(win);
  consumePendingMarketplaceJump(win);
}

function watchPluginBoot(view, win) {
  const deadline = Date.now() + PLUGIN_BOOT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const watch = {
      timer: null,
      settled: false,
      cancel: null,
    };
    const finish = (callback, value) => {
      if (watch.settled) {
        return;
      }
      watch.settled = true;
      if (watch.timer) {
        clearTimeout(watch.timer);
        watch.timer = null;
      }
      if (pluginBootWatch === watch) {
        pluginBootWatch = null;
      }
      callback(value);
    };
    const isCurrent = () => pluginBootWatch === watch && !watch.settled;
    watch.cancel = () => finish(reject, pluginBootCancelled());
    cancelPluginBootWatch();
    pluginBootWatch = watch;

    const tick = async () => {
      watch.timer = null;
      if (!isCurrent()) {
        return;
      }
      if (!view || view.webContents.isDestroyed()) {
        finish(reject, pluginBootCancelled('Web UI 在插件加载期间已关闭'));
        return;
      }
      let status;
      try {
        status = await view.webContents.executeJavaScript(PLUGIN_BOOT_PROBE);
      } catch {
        status = { pending: true, ready: 0, total: 0, failed: false, hasApp: false, error: '' };
      }
      if (!isCurrent()) {
        return;
      }
      const settled = Boolean(status.hasApp);
      sendPluginBoot({
        ready: status.ready,
        total: status.total,
        pending: Boolean(status.pending) && !settled,
        failed: Boolean(status.failed),
        settled,
        error: status.error || '',
      });
      if (status.failed) {
        finish(reject, new Error(status.error || '插件加载失败'));
        return;
      }
      if (settled || Date.now() > deadline) {
        try {
          await revealHarnessView(win);
        } catch (error) {
          finish(reject, error);
          return;
        }
        if (!isCurrent()) return;
        finish(resolve, status);
        return;
      }
      watch.timer = setTimeout(tick, 150);
    };
    watch.timer = setTimeout(tick, 80);
  });
}

function ensureHarnessView(win) {
  if (harnessView && !harnessView.webContents.isDestroyed()) {
    return harnessView;
  }
  hideHarnessView(win);
  harnessView = new BrowserView({
    webPreferences: {
      preload: preloadFile(),
      // The remote flag travels to the sandboxed preload via argv; the
      // preload must not (and cannot) require src/main/config.js itself.
      additionalArguments: [
        '--dshd-shell-role=harness',
        `--dshd-remote-feature=${REMOTE_FEATURE_ENABLED ? '1' : '0'}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Transparent view background so the harness page's rounded corners
      // (injected by harness-chrome-inject) reveal the window's transparent
      // corners instead of an opaque rectangle.
      backgroundColor: '#00000000',
      // Hidden pages get their compositor surface suspended; on restore the
      // window's own layer presents first and the view's next frame lags a
      // beat — the minimize blank-flash. Keep the view producing frames.
      backgroundThrottling: false,
      // Sidebar browser guests: <webview> attaches only through the
      // BrowserGuests lease checks (will-attach-webview), never free-form.
      webviewTag: true,
    },
  });
  win.addBrowserView(harnessView);
  harnessView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  try {
    require('./shortcuts').getShortcutService()?.attach(harnessView);
  } catch {
    // The shortcut service installs during app ready; a view created earlier
    // simply runs without the bridge until the next view creation.
  }
  try {
    require('./browser-guests').getBrowserGuests()?.bind(
      harnessView.webContents,
      win,
      (guest, name) => require('./shortcuts').getShortcutService()?.attachGuest(guest, name),
    );
  } catch {
    // Guest binding installs during app ready; a view created earlier simply
    // runs without webview guests until the next view creation.
  }
  attachPrivilegedNavigationGuards(harnessView.webContents, {
    allowUrl: isHarnessNavigationUrl,
    openDeniedExternal: true,
    openDeniedLoopback: true,
  });
  attachRendererRecovery(harnessView.webContents, '桌面端主');
  const applyChrome = () => {
    if (!harnessRevealed || !harnessView || harnessView.webContents.isDestroyed()) {
      return;
    }
    prepareHarnessChrome(win);
    syncHarnessChrome(win, harnessView.webContents);
  };
  harnessView.webContents.on('did-finish-load', applyChrome);
  harnessView.webContents.on('dom-ready', applyChrome);
  harnessView.webContents.on('did-navigate', applyChrome);
  harnessView.webContents.on('did-navigate-in-page', applyChrome);
  if (!win._dshHarnessResizeBound) {
    win._dshHarnessResizeBound = true;
    const relayout = () => layoutHarnessView(win);
    win.on('resize', relayout);
    win.on('maximize', relayout);
    win.on('unmaximize', relayout);
    // A cross-monitor drag finishes its DIP/DPI transition only when the move
    // completes; the last 'resize' can still read stale bounds, and a pure
    // scale-factor swap reports no size delta at all.
    win.on('moved', relayout);
    win.on('restore', relayout);
    // The reveal/nav inject can still be lost to a frame swap mid-eval or a
    // page DOM rebuild between navigations; re-assert it (throttled) when the
    // user returns to the window instead of staying chromeless.
    let lastChromeAssert = 0;
    const reassertChrome = () => {
      if (!harnessRevealed || !harnessView || harnessView.webContents.isDestroyed()) {
        return;
      }
      const now = Date.now();
      if (now - lastChromeAssert < 800) {
        return;
      }
      lastChromeAssert = now;
      syncHarnessChrome(win, harnessView.webContents);
    };
    win.on('focus', reassertChrome);
    win.on('show', reassertChrome);
    const relayoutOnMetricsChange = () => {
      if (!win.isDestroyed()) {
        relayout();
        // A display/session reconfiguration can leave a transparent
        // window's layered surface compositing opaque-black; invalidate
        // forces a repaint so an alive renderer's content returns.
        try { win.webContents.invalidate(); } catch {}
        try { harnessView?.webContents.invalidate(); } catch {}
      }
    };
    if (screen && typeof screen.on === 'function') {
      screen.on('display-metrics-changed', relayoutOnMetricsChange);
      win.once('closed', () => {
        screen.removeListener('display-metrics-changed', relayoutOnMetricsChange);
      });
    }
    const { powerMonitor } = require('electron');
    if (powerMonitor && typeof powerMonitor.on === 'function') {
      for (const eventName of ['resume', 'unlock-screen']) {
        powerMonitor.on(eventName, relayoutOnMetricsChange);
        win.once('closed', () => {
          powerMonitor.removeListener(eventName, relayoutOnMetricsChange);
        });
      }
    }
  }
  return harnessView;
}

function showBoot() {
  const win = createMainWindow();
  hideHarnessView(win);
  paintBackground(win, currentTheme().bg);
  if (isBootLoaded(win)) {
    return Promise.resolve();
  }
  return win.loadFile(rendererFile('boot.html'));
}

function showHarness(baseUrl, options = {}) {
  const loadUrl = rewriteLoopbackLoadUrl(baseUrl);
  if (!loadUrl) {
    return Promise.reject(new Error('Harness URL must be a loopback http(s) address'));
  }
  const cookie = typeof options.cookie === 'string' ? options.cookie : '';
  const viewUrl = cookie && launchTokenFromUrl(loadUrl) ? loadUrlAfterRedeem(loadUrl) : loadUrl;
  const win = createMainWindow();
  hideHarnessView(win);
  const bootReady = isBootLoaded(win)
    ? Promise.resolve()
    : win.loadFile(rendererFile('boot.html'));
  return bootReady.then(async () => {
    const view = ensureHarnessView(win);
    harnessOrigin = new URL(viewUrl).origin;
    notifyHarnessOrigin();
    if (cookie) {
      await applyHarnessCookieToSession(view.webContents.session, harnessOrigin, cookie);
    }
    sendPluginBoot({
      ready: 0,
      total: 0,
      pending: true,
      failed: false,
      settled: false,
      error: '',
    });
    return view.webContents.loadURL(viewUrl).then(() => watchPluginBoot(view, win));
  });
}

function showMain() {
  const win = getMainWindow();
  if (!win) {
    return null;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
  return win;
}

/** Tear down the desktop shell window after the kernel stops (launcher stays open). */
function dismissMainWindow() {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    return false;
  }
  hideHarnessView(win);
  win.destroy();
  return true;
}

function isHarnessLoaded(win) {
  if (!harnessRevealed) {
    return false;
  }
  const wc = getHarnessWebContents(win);
  return Boolean(wc && isHarnessNavigationUrl(wc.getURL() || ''));
}

function isBootLoaded(win) {
  const url = win?.webContents.getURL() || '';
  return isLocalAppNavigationUrl(url);
}

function openHarnessSettings(sectionId) {
  const requested = normalizeSettingsSection(sectionId);
  if (!requested.ok) {
    return Promise.resolve(false);
  }
  const win = showMain();
  if (!win || !isHarnessLoaded(win)) {
    return Promise.resolve(false);
  }
  return harnessPageContents(win)
    .executeJavaScript(buildSettingsSectionScript(requested.section))
    .catch(() => {
      // executeJavaScript rejected (destroyed view or thrown page script).
      return false;
    });
}

function jumpToMarketplaceTab() {
  return openHarnessSettings('market');
}

function consumePendingMarketplaceJump(win) {
  if (!pendingMarketplaceJump) {
    return;
  }
  if (!win || !isHarnessLoaded(win)) {
    return;
  }
  void jumpToMarketplaceTab().then((ok) => {
    if (ok) {
      pendingMarketplaceJump = false;
    }
  });
}

function openMarketplace() {
  const win = showMain();
  if (!win || !isHarnessLoaded(win)) {
    pendingMarketplaceJump = true;
    return win || null;
  }
  return jumpToMarketplaceTab();
}

// IPC seam: imported by ipc.js and mocked by ipc.test.js as a named export.
// Deliberately a thin wrapper over showMain() so the remote entry stays a
// stable dependency-injection point — do NOT inline (it is not a Middle Man).
function openRemote() {
  return showMain();
}

function sendToBoot(channel, payload) {
  const win = getMainWindow();
  if (!win) {
    return;
  }
  const url = win.webContents.getURL();
  if (isLocalAppNavigationUrl(url)) {
    win.webContents.send(channel, payload);
  }
}

function getLauncherWindow() {
  return launcherWindow && !launcherWindow.isDestroyed() ? launcherWindow : null;
}

function isLauncherLoaded(win) {
  const url = win?.webContents.getURL() || '';
  return isLauncherNavigationUrl(url);
}

function createLauncherWindow() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    return launcherWindow;
  }
  launcherWindow = new BrowserWindow({
    ...shellWindowChrome({
      width: 1060,
      height: 660,
      minWidth: 860,
      minHeight: 560,
      show: false,
      icon: iconImage(),
    }),
    webPreferences: {
      preload: preloadFile(),
      additionalArguments: ['--dshd-shell-role=launcher'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  attachWindowsAppDetails(launcherWindow);
  markWindowTransparent(launcherWindow);
  attachIntegratedChrome(launcherWindow, { role: 'launcher' });
  launcherWindow.once('ready-to-show', () => {
    hideNativeMenu(launcherWindow);
  });
  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });
  attachPrivilegedNavigationGuards(launcherWindow.webContents, {
    allowUrl: isLauncherNavigationUrl,
    openDeniedExternal: true,
  });
  attachRendererRecovery(launcherWindow.webContents, '启动器');
  return launcherWindow;
}

function showLauncher() {
  const win = createLauncherWindow();
  const ready = isLauncherLoaded(win)
    ? Promise.resolve()
    : win.loadFile(rendererFile('launcher.html'));
  return ready.then(() => {
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    return win;
  });
}

/** Create or reuse the launcher window without showing it (cold start / IPC). */
function prepareLauncher() {
  const win = createLauncherWindow();
  if (isLauncherLoaded(win)) {
    return Promise.resolve(win);
  }
  return win.loadFile(rendererFile('launcher.html')).then(() => win);
}

function sendToLauncher(channel, payload) {
  const win = getLauncherWindow();
  if (!win) {
    return;
  }
  const url = win.webContents.getURL();
  if (isLauncherNavigationUrl(url)) {
    win.webContents.send(channel, payload);
  }
}

function closeLauncherWindow() {
  const win = getLauncherWindow();
  if (!win) {
    return;
  }
  win.close();
}

module.exports = {
  createMainWindow,
  setRecoveryConfirm,
  getMainWindow,
  getHarnessView,
  getHarnessWebContents,
  getHarnessOrigin,
  onHarnessOriginChange,
  isHarnessNavigationUrl,
  hideHarnessView,
  dismissMainWindow,
  showBoot,
  showHarness,
  showMain,
  openHarnessSettings,
  openMarketplace,
  openRemote,
  sendToBoot,
  createLauncherWindow,
  getLauncherWindow,
  showLauncher,
  prepareLauncher,
  sendToLauncher,
  closeLauncherWindow,
  setBootHarnessCovered,
  isBootLoaded,
  isHarnessLoaded,
  iconImage,
  attachPrivilegedNavigationGuards,
};
