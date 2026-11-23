const { app, BrowserView, BrowserWindow, nativeImage, screen } = require('electron');
const { allowHangCallStacks, attachRendererRecovery } = require('./window-renderer-recovery');
const { rendererFile, assetFile, preloadFile } = require('./paths');
const { applyWindowsAppDetails } = require('./window-app-details');
const { REMOTE_FEATURE_ENABLED } = require('./config');
const { shellWindowChrome, attachIntegratedChrome, hideNativeMenu, prepareHarnessChrome, syncHarnessChrome, currentTheme, markWindowTransparent, paintBackground, resetWindowMaterial } = require('./chrome');
const { normalizeSettingsSection, buildSettingsSectionScript } = require('./settings-jump');
const { buildMarketplaceScript } = require('./marketplace-jump');
const { createListenerSet, createSessionJumpQueue } = require('./session-jump');
const {
  isLoopbackHttpUrl,
  isSameOriginLoopbackUrl,
  isLocalAppNavigationUrl,
  isLauncherNavigationUrl,
  rewriteLoopbackLoadUrl,
  shouldAllowPrivilegedNavigate,
  shouldAllowPrivilegedRedirect,
} = require('./local-url');
const { openExternalHttp } = require('./open-external');
const { WINDOW_MATERIAL_ARGUMENT, windowsAcrylicSupported } = require('./window-material');
const { prepareWindowAcrylic } = require('./window-acrylic');
const { applyHarnessCookieToSession, launchTokenFromUrl, loadUrlAfterRedeem } = require('./harness-browser-auth');
const { createForegroundPolicy } = require('./foreground');
// Render hints (src/main/gpu-tier.js), resolved once after ready. The Harness
// view waits briefly for them because its preload reads them from argv.
const RENDER_HINTS_WAIT_MS = 3000;
let renderHints = { lowPowerGpu: false };
let renderHintsReady = Promise.resolve();

function setRenderHintsSource(source) {
  renderHintsReady = Promise.resolve(source).then((tier) => {
    renderHints = { lowPowerGpu: tier?.lowPower === true };
  }, () => {});
}

function renderHintsSettled() {
  let timer;
  return Promise.race([
    renderHintsReady,
    new Promise((resolve) => { timer = setTimeout(resolve, RENDER_HINTS_WAIT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

let foregroundPolicy = null;
function foreground() {
  foregroundPolicy ||= createForegroundPolicy({ app, BrowserWindow });
  return foregroundPolicy;
}

const PLUGIN_BOOT_TIMEOUT_MS = 90_000;

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
/** @type {any} */
let prewarmedHarnessView = null;
/** @type {any} */
let prewarmTimer = null;
let prewarmGen = 0;
let harnessRevealed = false;
let harnessOrigin = '';
const harnessOriginListeners = createListenerSet();
const mainWindowListeners = createListenerSet();
const sessionJump = createSessionJumpQueue();
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

function createMainWindow({ activate = true } = {}) {
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
      additionalArguments: ['--dshd-shell-role=boot', ...(require('./render-mode').getMinimalMode() ? ['--dshd-minimal=1'] : [])],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  attachWindowsAppDetails(mainWindow);
  markWindowTransparent(mainWindow);
  attachIntegratedChrome(mainWindow);
  // Created before the window exists so focus already lost to another app
  // (during a long first start) is known when it becomes ready.
  const presenter = foreground();
  mainWindow.once('ready-to-show', () => {
    hideNativeMenu(mainWindow);
    presenter.present(mainWindow, activate);
  });
  mainWindow.on('closed', () => {
    hideHarnessView(mainWindow);
    mainWindow = null;
    mainWindowListeners.emit(null);
  });

  attachPrivilegedNavigationGuards(mainWindow.webContents, {
    allowUrl: isLocalAppNavigationUrl,
    openDeniedExternal: true,
  });
  attachRendererRecovery(mainWindow.webContents, '桌面端');
  mainWindowListeners.emit(mainWindow);

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
  // Generated documents may run scripts, but must keep their original CSP.
  // Remember the frame identity before its scripts can change window.name.
  const generatedFrames = new Set();
  const isGeneratedFrame = (frame) => frame?.name === 'whale-visual-reply'
    || (typeof frame?.name === 'string' && (frame.name.startsWith('whale-openui:') || frame.name.startsWith('whale-ui:')));
  contents.on('frame-created', (_event, { frame }) => {
    if (isGeneratedFrame(frame)) generatedFrames.add(frame.frameTreeNodeId);
  });
  contents.on('will-frame-navigate', event => {
    const frame = event.frame;
    if (isGeneratedFrame(frame)) generatedFrames.add(frame.frameTreeNodeId);
    if (!event.isMainFrame && frame
      && generatedFrames.has(frame.frameTreeNodeId)
      && event.url !== 'about:srcdoc') {
      event.preventDefault();
    }
  });

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
    if (openDeniedExternal) {
      void openExternalHttp(url);
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

const getMainWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
const getHarnessView = () => (harnessView && !harnessView.webContents.isDestroyed() ? harnessView : null);
function getHarnessWebContents(win) {
  if (!harnessView || harnessView.webContents.isDestroyed()) return null;
  const owner = getMainWindow();
  return win && owner && win !== owner ? null : harnessView.webContents;
}
const getHarnessOrigin = () => (getHarnessWebContents() ? harnessOrigin : '');
const onHarnessOriginChange = (listener) => harnessOriginListeners.add(listener);
/** @param {(win: Electron.BrowserWindow | null) => void} listener */
const onMainWindowChange = (listener) => mainWindowListeners.add(listener);
const notifyHarnessOrigin = () => harnessOriginListeners.emit(getHarnessOrigin());
const isHarnessNavigationUrl = (url) => Boolean(harnessOrigin && isSameOriginLoopbackUrl(url, harnessOrigin));
const harnessPageContents = (win) => getHarnessWebContents(win) || win?.webContents;
const sendPluginBoot = (payload) => sendToBoot('shell:plugin-boot', payload);

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

function disposePrewarmedHarnessView() {
  prewarmGen += 1;
  if (prewarmTimer) { clearTimeout(prewarmTimer); prewarmTimer = null; }
  const view = prewarmedHarnessView;
  prewarmedHarnessView = null;
  if (view && !view.webContents.isDestroyed()) view.webContents.close();
}

function hideHarnessView(win, { keepPrewarmed = false } = {}) {
  if (!keepPrewarmed) disposePrewarmedHarnessView();
  harnessRevealed = false;
  harnessOrigin = '';
  notifyHarnessOrigin();
  setBootHarnessCovered(win, false);
  resetWindowMaterial?.(win);
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
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

function layoutHarnessView(win) {
  if (!harnessView || !win || win.isDestroyed() || !harnessRevealed) {
    return;
  }
  const bounds = win.getContentBounds();
  // Native resize already relays the final content bounds here. BrowserView
  // auto-resize would apply the same size delta again after this listener.
  harnessView.setAutoResize({ width: false, height: false });
  harnessView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
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

/** @param {any} image */
const encodeBootSnapshot = (image) => (typeof image.toJPEG === 'function'
  ? `data:image/jpeg;base64,${image.toJPEG(92).toString('base64')}` : image.toDataURL());

/** @param {any} win */
function createBootCurtain(win) {
  const curtain = new BrowserWindow({
    parent: win, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, skipTaskbar: true, focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  curtain.setIgnoreMouseEvents(true);
  curtain.setBounds(win.getContentBounds());
  const ready = curtain.loadFile(rendererFile('boot-reveal.html'));
  ready.catch(() => { /* Handled when awaited or discarded if reveal cancels early. */ });
  return { curtain, ready };
}

/** @param {any} curtain @param {any} win @param {string} snapshot @param {boolean} maximized @param {() => boolean} current */
async function presentBootCurtain(curtain, win, snapshot, maximized, current) {
  if (!curtain) return true;
  await curtain.ready;
  if (!current() || curtain.curtain.isDestroyed()) return false;
  await curtain.curtain.webContents.executeJavaScript(HARNESS_CURTAIN_PREPARE_SCRIPT(snapshot, maximized));
  if (!current() || curtain.curtain.isDestroyed()) return false;
  curtain.curtain.setBounds(win.getContentBounds());
  curtain.curtain.showInactive();
  return true;
}

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
    // The cross-fade captures and composites two full-window layers; a
    // low-power GPU shows the view directly.
    const reduced = require('./render-mode').getMinimalMode() || renderHints.lowPowerGpu || await view.webContents.executeJavaScript(
      `matchMedia('(prefers-reduced-motion: reduce)').matches`,
    );
    if (!current()) return;
    const curtain = reduced ? null : createBootCurtain(win);
    curtainWindow = curtain?.curtain;
    const snapshot = reduced ? '' : encodeBootSnapshot(await win.webContents.capturePage());
    if (!current()) return;
    mount();
    if (!await presentBootCurtain(curtain, win, snapshot, win.isMaximized(), current)) return;
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
      try { await view.webContents.removeInsertedCSS(cssKey); released = true; } catch { /* Try removing the document curtain below when CSS removal fails. */ }
    }
    if (!current()) return;
    try {
      await view.webContents.executeJavaScript(
        `document.getElementById('dshd-boot-curtains')?.remove(); document.documentElement && document.documentElement.removeAttribute('data-dshd-harness-fade')`,
      );
      released = true;
    } catch { /* The original reveal error is rethrown below unless another release path succeeded. */ }
    if (!released) throw error;
  } finally {
    if (curtainWindow) {
      if (!curtainWindow.isDestroyed()) curtainWindow.destroy();
    }
    if (cssKey && !view.webContents.isDestroyed()) {
      await view.webContents.removeInsertedCSS(cssKey).catch(() => { /* The reveal result is already determined; CSS removal may race a destroyed renderer. */ });
    }
  }
  if (!current()) return;
  setBootHarnessCovered(win, true);
  desktopPet()?.show(win);
  consumePendingMarketplaceJump(win);
  consumePendingSessionJump(win);
}

function watchPluginBoot(view, win) {
  const deadline = Date.now() + PLUGIN_BOOT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const watch = { timer: null, settled: false, cancel: null };
    const finish = (callback, value) => {
      if (watch.settled) return;
      watch.settled = true;
      if (watch.timer) { clearTimeout(watch.timer); watch.timer = null; }
      if (pluginBootWatch === watch) pluginBootWatch = null;
      callback(value);
    };
    const isCurrent = () => pluginBootWatch === watch && !watch.settled;
    watch.cancel = () => finish(reject, pluginBootCancelled());
    cancelPluginBootWatch();
    pluginBootWatch = watch;

    const tick = async () => {
      watch.timer = null;
      if (!isCurrent()) return;
      if (!view || view.webContents.isDestroyed()) {
        finish(reject, pluginBootCancelled('Web UI 在插件加载期间已关闭'));
        return;
      }
      let status;
      try { status = await view.webContents.executeJavaScript(PLUGIN_BOOT_PROBE); }
      catch { status = { pending: true, ready: 0, total: 0, failed: false, hasApp: false, error: '' }; }
      if (!isCurrent()) return;
      const settled = Boolean(status.hasApp);
      const timedOut = !settled && !status.failed && Date.now() > deadline;
      const error = status.error || (timedOut ? 'Web UI 插件加载超时，应用界面未就绪' : '');
      sendPluginBoot({
        ready: status.ready,
        total: status.total,
        pending: Boolean(status.pending) && !settled && !timedOut,
        failed: Boolean(status.failed) || timedOut,
        settled,
        error,
      });
      if (status.failed || timedOut) {
        finish(reject, new Error(error || '插件加载失败'));
        return;
      }
      if (settled) {
        try {
          await revealHarnessView(win);
        } catch (revealError) {
          // Reject the boot waiter so the boot page stays visible and shows retry on reveal failure.
          finish(reject, revealError);
          return;
        }
        if (!isCurrent()) return;
        finish(resolve, status);
        return;
      }
      watch.timer = setTimeout(tick, 16);
    };
    watch.timer = setTimeout(tick, 20);
  });
}

/** @param {any} win */
function createHarnessBrowserView(win) {
  return new BrowserView({
    webPreferences: {
      preload: preloadFile(),
      // The remote flag travels to the sandboxed preload via argv; the
      // preload must not (and cannot) require src/main/config.js itself.
      additionalArguments: [
        '--dshd-shell-role=harness',
        `--dshd-remote-feature=${REMOTE_FEATURE_ENABLED ? '1' : '0'}`,
        ...(renderHints.lowPowerGpu ? ['--dshd-low-power-gpu=1'] : []),
        ...(windowsAcrylicSupported() && prepareWindowAcrylic(win) ? [WINDOW_MATERIAL_ARGUMENT] : []),
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
}

/** @param {any} win */
function scheduleHarnessPrewarm(win) {
  disposePrewarmedHarnessView();
  const gen = prewarmGen;
  prewarmTimer = setTimeout(() => {
    prewarmTimer = null;
    void renderHintsSettled().then(() => {
      if (gen !== prewarmGen || !win || win.isDestroyed() || getHarnessView() || prewarmedHarnessView || !isBootLoaded(win)) return;
      /** @type {any} */
      const view = createHarnessBrowserView(win);
      view._dshOwnerWin = win;
      prewarmedHarnessView = view;
    });
  }, 0);
  prewarmTimer.unref?.();
}

function ensureHarnessView(win) {
  if (harnessView && !harnessView.webContents.isDestroyed()) return harnessView;
  hideHarnessView(win, { keepPrewarmed: true });
  const reusable = prewarmedHarnessView && prewarmedHarnessView._dshOwnerWin === win
    && !prewarmedHarnessView.webContents.isDestroyed();
  if (reusable) {
    harnessView = prewarmedHarnessView;
    prewarmedHarnessView = null;
    prewarmGen += 1;
    if (prewarmTimer) { clearTimeout(prewarmTimer); prewarmTimer = null; }
  } else {
    disposePrewarmedHarnessView();
    harnessView = createHarnessBrowserView(win);
  }
  win.addBrowserView(harnessView);
  harnessView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  allowHangCallStacks(harnessView.webContents.session);
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
        try { win.webContents.invalidate(); } catch { /* A display change can race a closed main renderer. */ }
        try { harnessView?.webContents.invalidate(); } catch { /* A display change can race a closed Harness renderer. */ }
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
      const resumeRendering = () => {
        if (harnessView && !harnessView.webContents.isDestroyed()) {
          harnessView.webContents.send('shell:render-resume');
        }
        relayoutOnMetricsChange();
      };
      for (const eventName of ['resume', 'unlock-screen']) {
        powerMonitor.on(eventName, resumeRendering);
        win.once('closed', () => {
          powerMonitor.removeListener(eventName, resumeRendering);
        });
      }
    }
  }
  return harnessView;
}

function showBoot(options = {}) {
  const win = createMainWindow(options);
  hideHarnessView(win);
  paintBackground(win, currentTheme().bg);
  const loaded = isBootLoaded(win) ? Promise.resolve() : win.loadFile(rendererFile('boot.html'));
  return loaded.then(() => {
    if (!win.isDestroyed() && !getHarnessView() && isBootLoaded(win)) scheduleHarnessPrewarm(win);
  });
}

function showHarness(baseUrl, options = {}) {
  const loadUrl = rewriteLoopbackLoadUrl(baseUrl);
  if (!loadUrl) return Promise.reject(new Error('Harness URL must be a loopback http(s) address'));
  const cookie = typeof options.cookie === 'string' ? options.cookie : '';
  const viewUrl = cookie && launchTokenFromUrl(loadUrl) ? loadUrlAfterRedeem(loadUrl) : loadUrl;
  const win = createMainWindow(options);
  hideHarnessView(win, { keepPrewarmed: true });
  const bootReady = isBootLoaded(win) ? Promise.resolve() : win.loadFile(rendererFile('boot.html'));
  return bootReady.then(async () => {
    await renderHintsSettled();
    const view = ensureHarnessView(win);
    harnessOrigin = new URL(viewUrl).origin;
    notifyHarnessOrigin();
    if (cookie) await applyHarnessCookieToSession(view.webContents.session, harnessOrigin, cookie);
    sendPluginBoot({ ready: 0, total: 0, pending: true, failed: false, settled: false, error: '' });
    return view.webContents.loadURL(viewUrl).then(() => watchPluginBoot(view, win));
  });
}

function showMain({ activate = true } = {}) {
  const win = getMainWindow();
  if (!win) {
    return null;
  }
  if (activate) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    win.showInactive();
  }
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
  const win = getMainWindow();
  if (!win || !isHarnessLoaded(win)) return Promise.resolve(false);
  return harnessPageContents(win).executeJavaScript(buildMarketplaceScript()).catch(() => false);
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

/** @param {any} win */
function consumePendingSessionJump(win) {
  sessionJump.consume(win, isHarnessLoaded, getHarnessWebContents);
}

/** @param {string} sessionId */
function openHarnessSession(sessionId) {
  return sessionJump.request(showMain({ activate: true }), isHarnessLoaded, getHarnessWebContents, sessionId);
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

function showLauncher({ activate = true } = {}) {
  const win = createLauncherWindow();
  const ready = isLauncherLoaded(win) && !win._dshLauncherLoad
    ? Promise.resolve()
    : (win._dshLauncherLoad ||= Promise.resolve(win.loadFile(rendererFile('launcher.html'))).then(() => {
      win._dshLauncherLoad = null;
      if (win.isDestroyed()) {
        win._dshPendingMessages = [];
        return;
      }
      while (Array.isArray(win._dshPendingMessages) && win._dshPendingMessages.length && !win.isDestroyed()) {
        const queued = win._dshPendingMessages;
        win._dshPendingMessages = [];
        for (const item of queued) {
          if (win.isDestroyed()) break;
          win.webContents.send(item.channel, item.payload);
        }
      }
    }, (error) => {
      win._dshLauncherLoad = null;
      throw error;
    }));
  return ready.then(() => {
    if (win.isDestroyed()) return win;
    if (activate) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    else win.showInactive();
    return win;
  });
}

/** Create or reuse the launcher window without showing it (cold start / IPC). */
function prepareLauncher() { return Promise.resolve(createLauncherWindow()); }

function sendToLauncher(channel, payload) {
  const win = getLauncherWindow();
  if (!win || win.isDestroyed()) return;
  if (!win._dshLauncherLoad && isLauncherNavigationUrl(win.webContents.getURL())) {
    win.webContents.send(channel, payload); return;
  }
  const queued = (win._dshPendingMessages ||= []);
  if (channel === 'shell:show-tab' || channel === 'shell:update-progress'
    || channel === 'shell:desktop-ready' || channel === 'shell:desktop-failed') {
    const existing = queued.findIndex((/** @type {any} */ item) => item.channel === channel);
    if (existing !== -1) queued.splice(existing, 1);
  }
  if (queued.length >= 32) queued.shift();
  queued.push({ channel, payload });
}

function closeLauncherWindow() {
  const win = getLauncherWindow();
  if (!win) {
    return;
  }
  win.close();
}

module.exports = {
  setRenderHintsSource, createMainWindow, getMainWindow, getHarnessView, getHarnessWebContents,
  getHarnessOrigin, onHarnessOriginChange, onMainWindowChange, isHarnessNavigationUrl, hideHarnessView,
  dismissMainWindow, showBoot, showHarness, showMain, openHarnessSettings, openMarketplace, openHarnessSession,
  sendToBoot, createLauncherWindow, getLauncherWindow, showLauncher, prepareLauncher, sendToLauncher,
  closeLauncherWindow, setBootHarnessCovered, isBootLoaded, isHarnessLoaded, iconImage, attachPrivilegedNavigationGuards,
};
