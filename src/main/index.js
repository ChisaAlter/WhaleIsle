const { app, clipboard, dialog, ipcMain, session, shell, nativeTheme, systemPreferences } = require('electron');
const { PRODUCT_NAME, LEGACY_DESKTOP_USER_DATA, preserveUserDataPath } = require('../shared/product-identity');
preserveUserDataPath(app, LEGACY_DESKTOP_USER_DATA);
const fs = require('fs');
const { loadConfig, saveConfig, REMOTE_FEATURE_ENABLED, parkRemoteSnapshot, publicConfig, normalizeRendererConfigPatch, normalizeRemotePatch, readConfigSnapshot, configRevision } = require('./config');
const { setDesktopDshHome, desktopDshHomeFromUserData, sanitizePackagedDshHomeEnv } = require('../shared/dsh-home');
const { DshManager, ensureOwnedPort } = require('./dsh');
const { HarnessController } = require('./harness-controller');
const { stripDroppedPlugins, healDanglingBundles, ensureDesktopInstallPlugin, applyDisabledBundles, listInstalledPlugins } = require('./plugins');
const { removeDshMarketPreset } = require('./dshmarket-preset');
const { ensureUsagePanelPlugin } = require('./usage-panel-preset');
const { ensureSessionSearchOverlay } = require('./session-search-overlay');
const { ensureDshImPlugin } = require('./dsh-im-desktop');
const { ensureDshbotPlugin } = require('./dshbot-desktop');
const { ensureDesktopDshProject } = require('./dsh-project-desktop');
const { createProjectEnvironment } = require('./project-environment');
const { ensureDesktopTaskControl } = require('./task-control-overlay');
const { ensureDesktopPlatformSession } = require('./platform-session-overlay');
const { fetchPlatformSession } = require('./platform-session');
const { DesktopPlatformView, PLATFORM_IPC, platformBounds } = require('./platform-view');
const { createTaskProtection, installTaskProtection, getTaskProtection } = require('./task-protection');
const { createTaskControlPeer } = require('./task-control-peer');
const { ensureDesktopDshWhale } = require('./dsh-whale-desktop');
const { ensureDesktopDshRemote } = require('./dsh-remote-desktop');
const { ensureDesktopMarket } = require('./dsh-market-desktop');
const { ensureDesktopOfficeRuntime } = require('./office-runtime');
const { removeLegacyDshbotPreset } = require('./legacy-dshbot-preset');
const { migrateLegacyNotificationShortcut } = require('./legacy-notification-shortcut');
const { ensureWorkspace } = require('./workspace-rpc');
const { registerIpc } = require('./ipc');
const { safeStorage } = require('electron');
const { DshdRemote, resolveDesktopChisaCodeHome } = require('./dshd-remote');
const { invokeDesktopShell } = require('./remote-shell');
const git = require('./git');
const { listDir } = require('./workspace-fs');
const { buildMenu } = require('./menu');
const { createTray, invokeTrayAction, refreshTrayMenu } = require('./tray');
const { DESKTOP_PET_FEATURE, configureDesktopPet, getDesktopPet } = require('./desktop-pet');
const { LIVE2D_PET_FEATURE, configureLive2dPet, getLive2dPet } = require('./desktop-live2d');
const { checkUpdate, updateDownloadMethods, setGithubTokenProvider, setUpdateStateSink, currentVersion } = require('./update');
const { plainReleaseNotes } = require('../shared/release-notes');
const { createUpdatesState } = require('./updates-state');
const { BrowserGuests, installBrowserGuests } = require('./browser-guests');
const { connectWelcome } = require('./welcome-backend');
const { resolveDesktopStartupLocale } = require('./desktop-locale');
const { recoverInterruptedImport, readImportJournal, journalIsBlocked } = require('./data-import');
const { isLauncherPackage } = require('../launcher/product');
const runtimeInstall = require('../launcher/runtime-install');
const installDetect = require('../launcher/install-detect');
const {
  shouldCloseLauncherAfterDesktopStart,
  writeLastDesktopStart,
  recordLastDesktopStart,
  kernelLogTail,
  runColdStartGate: runLauncherColdStartGate,
  createParkedUpdateDrainer,
  presentUpdateAsk,
} = require('./launcher-gate');
const {
  startDesktopInstallControl,
  stopDesktopInstallControl,
  desktopInstallReady,
} = require('./desktop-install-control');
const { installPlugin, installMarketplacePlugin, uninstallPlugin } = require('./marketplace-install');
const { listMarketplace } = require('./marketplace-catalog');
const { recordMarketplaceOperation } = require('./marketplace-state');
const {
  applyRendererConfigPatch,
  disablePlugins,
  dshKernelState,
  enablePlugin,
  pluginRemoveGuardError,
  configureProfileOps,
} = require('./profile-ops');
const importGuard = require('./import-guard');
const { createReloadWithCleanup } = require('./desktop-reload');
const { downloadSavePath } = require('./download-path');
const {
  createMainWindow,
  getMainWindow,
  showBoot,
  showHarness,
  onHarnessOriginChange,
  getHarnessOrigin,
  sendToBoot,
  isBootLoaded,
  getHarnessWebContents,
  getHarnessView,
  isHarnessLoaded,
  dismissMainWindow,
  showLauncher,
  prepareLauncher,
  getLauncherWindow,
  sendToLauncher,
  closeLauncherWindow,
  showMain,
  openHarnessSettings,
  setRecoveryConfirm,
} = require('./window');
const { watchSystemTheme, currentTheme, applyAppTheme } = require('./chrome');
const { showClosingOverlay } = require('./closing-overlay');
const { installShortcutService, getShortcutService } = require('./shortcuts');
const { hideOnClose } = require('./close-behavior');
const { TrayHideNotice } = require('./background-notice');
const { systemNotificationsSupported } = require('./system-notifications');
const { installMediaPermissions } = require('./media-permissions');
const { attachRendererConsoleTail, RendererConsoleTail, writeCrashReport, pruneCrashReports, desktopErrorState } = require('./crash-report');
const { UpdateJournal } = require('./update-journal');
const { UpdateOverlays } = require('./update-overlay');
const { ShellConfirmDialog } = require('./update-dialog');
const { UpdateAttention } = require('./update-attention');
const { rendererFile } = require('./paths');
const { pathToFileURL } = require('node:url');
const { qaFlag, qaRemoteMode: readRemoteMode } = require('./qa-gate');
const { devToolsShortcutAllowed, attachDevToolsShortcut } = require('./devtools-shortcut');

/** Packaged-gated QA flag (see qa-gate.js). */
function qaEnv(name) {
  return qaFlag(name, { isPackaged: app.isPackaged });
}

function qaRemoteMode() {
  return readRemoteMode({ isPackaged: app.isPackaged });
}

const dsh = new DshManager();
// Broken-pipe hardening must precede anything that can write to stdio or run
// the in-process ChisaCode daemon (see docs/superpowers/plans/
// 2026-08-28-remote-epipe-hardening.md).
const { installStdioGuard, installUncaughtBrokenPipeGuard } = require('./stdio-guard');
installStdioGuard({ log: (message) => dsh.log(message, 'app') });
installUncaughtBrokenPipeGuard({ log: (message) => dsh.log(message, 'app') });
// Product remote = full ChisaCode daemon + offer v2 (not HTTP RemoteGateway).
const remote = new DshdRemote({
  getConfig: loadConfig,
  saveConfig,
  // Desktop-facing override is DSHD_CHISACODE_HOME (debug; packaged builds
  // need DSHD_ALLOW_ENV_HOME=1). CHISACODE_HOME itself only ever exists
  // inside the daemon child env bridge.
  getHomeDir: () => resolveDesktopChisaCodeHome({
    defaultDir: require('path').join(app.getPath('userData'), 'chisacode-home'),
    isPackaged: app.isPackaged,
  }),
  safeStorage,
  log: (line) => dsh.log(line, 'app'),
  getHarnessOrigin,
  getSessionCookie: () => dsh.sessionCookie || '',
  git,
  // Kept for any residual shell helpers that still expect a loopback target.
  getTarget: () => {
    if (dsh.state !== 'ready') {
      return null;
    }
    const port = Number(dsh.port);
    return port ? { host: '127.0.0.1', port } : null;
  },
  invokeShell: (name, payload) => invokeDesktopShell({
    name,
    payload,
    git,
    fs: { listDir },
    host: {
      openSettings: (sectionId) => openHarnessSettings(sectionId),
      getConfig: () => publicConfig(loadConfig()),
      saveConfig: (patch) => publicConfig(saveConfig(normalizeRendererConfigPatch(patch || {}))),
    },
  }),
});

onHarnessOriginChange((origin) => {
  if (remote && typeof remote.pushHarnessOrigin === 'function') {
    remote.pushHarnessOrigin(origin);
  }
});

async function probeRemoteSnapshot() {
  if (remote && typeof remote.sync === 'function') {
    await remote.sync();
  }
  const snap = remote && typeof remote.snapshot === 'function'
    ? remote.snapshot()
    : { available: false, enabled: false, listening: false };
  if (!REMOTE_FEATURE_ENABLED) {
    return parkRemoteSnapshot(snap);
  }
  return snap;
}

async function setRemoteFromQa(patch) {
  saveConfig(normalizeRemotePatch(patch || {}));
  if (remote && typeof remote.sync === 'function') {
    return remote.sync();
  }
  return remote && typeof remote.snapshot === 'function' ? remote.snapshot() : null;
}

let quitting = false;
let stoppingForQuit = false;
let quitInProgress = false;
// Shell-owned input block for the shortcut bridge: while the closing overlay
// owns the window, bound chords and menu dispatch must not run commands.
let closingOverlayActive = false;
let desktopResources = null;
let qaQuitIntercepted = false;
// Only the initial presentation is inactive; later user entries keep focus.
let backgroundStartup = process.argv.includes('--background');
/**
 * The launcher window a parked update ask belongs to. A stale ask (window
 * closed/recreated, app quitting, install already started) must never keep
 * going on a window the user can no longer see.
 */
let launcherWindowToken = null;

/**
 * Resolve the port from the start's config snapshot. The revision is handed
 * back so `performStartOnce` can prove the port still belongs to the config
 * the rest of the start read.
 */
async function resolveLaunchTarget(snapshot) {
  const config = snapshot ? snapshot.config : loadConfig();
  const host = config.host || '127.0.0.1';
  const wanted = Number(config.port) || 3080;
  dsh.log(`检测端口 ${host}:${wanted}`);
  const port = await ensureOwnedPort(host, wanted, (line) => dsh.log(line));
  return { port, configRevision: snapshot ? snapshot.revision : undefined };
}

const mainCloseBound = new WeakSet();
const launcherCloseBound = new WeakSet();

/** Fatal crash reports live with the app's own logs, outside the install dir. */
function crashLogDir() {
  return require('node:path').join(app.getPath('logs'), 'crash');
}

// Shell-modal confirmation layer (upstream update-dialog/update-overlay):
// the same transparent-child modal carries update asks, task-protection
// prompts, and unverified-install warnings instead of the native messagebox.
const shellOverlays = new UpdateOverlays();
let shellConfirmInstance;
function shellConfirm() {
  if (!shellConfirmInstance) {
    shellConfirmInstance = new ShellConfirmDialog(
      require('node:path').join(__dirname, '..', 'preload', 'update-dialog.js'),
      pathToFileURL(rendererFile('update-dialog.html')).href,
      shellOverlays,
    );
  }
  return shellConfirmInstance;
}
const updateAttention = new UpdateAttention({
  title: '鲸屿更新已就绪',
  body: '新版本已下载完成，回到窗口继续安装。',
});

/**
 * Productized confirmation: shell overlay modal when a window can host it,
 * native messagebox otherwise (no window yet, destroyed parent).
 */
async function confirmDialog(parent, options) {
  if (parent && !parent.isDestroyed()) {
    try {
      return await shellConfirm().show(parent, options);
    } catch (error) {
      console.warn('dshd dialog: shell confirm failed, native fallback', error);
    }
  }
  if (options.downloadMethods?.length > 0) {
    const methods = options.downloadMethods.filter((method) => !method.disabledReason);
    const result = await dialog.showMessageBox(parent || undefined, {
      ...options,
      buttons: [...methods.map((method) => method.label), '稍后'],
      defaultId: 0, cancelId: methods.length,
      detail: options.downloadMethods.map((method) => `${method.label}：${method.disabledReason || method.description}`).join('\n')
        + '\n\n' + options.detail,
    });
    return result.response < methods.length
      ? { response: 0, downloadMode: methods[result.response].id }
      : { response: options.cancelId };
  }
  return dialog.showMessageBox(parent || undefined, options);
}

// Renderer crash/unresponsive recovery prompts go through the same styled
// overlay when the crashed window is still on screen.
setRecoveryConfirm(confirmDialog);

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

function bindMainClose(win) {
  if (!win || mainCloseBound.has(win)) {
    return win;
  }
  mainCloseBound.add(win);
  win.on('close', (event) => {
    if (quitting) {
      // A protection prompt may be in flight — swallow the close instead of
      // destroying a window the user just cancelled quitting over.
      if (quitInProgress || !stoppingForQuit) event.preventDefault();
      return;
    }
    if (hideOnClose(loadConfig(), quitting)) {
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
  return bindMainClose(createMainWindow({ activate: !backgroundStartup }));
}

function bindLauncherClose(win) {
  if (!win || launcherCloseBound.has(win)) {
    return win;
  }
  launcherCloseBound.add(win);
  // A late check can also settle while the launcher is already on screen.
  win.on('show', () => {
    launcherWindowToken = win;
    void drainParkedUpdateCheck.drain({ generation: win });
  });
  win.on('closed', () => {
    if (launcherWindowToken === win) launcherWindowToken = null;
  });
  win.on('close', (event) => {
    if (quitting) {
      if (quitInProgress || !stoppingForQuit) event.preventDefault();
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

async function openLauncher(options = {}) {
  const win = await showLauncher(options);
  bindLauncherClose(win);
  launcherWindowToken = win;
  // Visible launcher: this is the moment a parked late update check may be
  // presented, pinned to the window the user is actually looking at.
  void drainParkedUpdateCheck.drain({ generation: win });
  return win;
}

function isDesktopKernelRunning() {
  const state = typeof dsh.state === 'string' ? dsh.state : dsh.snapshot()?.state;
  return state === 'ready' || state === 'starting';
}

// Desktop account integration is optional and never owns workspace entry.
let welcomeBackend;
let welcomeLocale;
let openedAttempt;
let previousAccountStatus;
let stopAccount;
let platformView;
let platformSessionRefresh;
let initializingDesktopAccount;

function platformLoginUrl(authorizeUrl) {
  const url = new URL(authorizeUrl);
  url.searchParams.set('theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  return url.href;
}

function welcomeClientMetadata() {
  return {
    version: currentVersion(),
    locale: welcomeLocale?.id ?? 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
}

function startAccountWatch() {
  stopAccount?.();
  if (welcomeBackend === undefined) return;
  stopAccount = welcomeBackend.account.watch((state) => {
    if (quitting) return;
    // Keep embedded Platform identity current without hiding the workspace.
    if (state.status !== previousAccountStatus) void platformSessionRefresh?.();
    const attempt = state.attempt;
    if (attempt?.phase === 'waiting-browser' && attempt.authorizeUrl !== undefined && openedAttempt !== attempt.id) {
      openedAttempt = attempt.id;
      void shell.openExternal(platformLoginUrl(attempt.authorizeUrl)).catch(() => undefined);
    }
    previousAccountStatus = state.status;
  }, () => {
    // The stream reconnects; transport failures never redirect the workspace.
  }, () => {
    if (!quitting) void platformSessionRefresh?.();
  });
}

async function initializeDesktopAccount(targetUrl) {
  if (quitting || welcomeBackend !== undefined) return;
  if (initializingDesktopAccount) return initializingDesktopAccount;
  initializingDesktopAccount = (async () => {
    try {
      welcomeBackend = await connectWelcome(new URL(targetUrl).origin, () => dsh.sessionCookie);
      if (quitting) return;
      startAccountWatch();
      const preference = await welcomeBackend.readLocalePreference();
      const languages = [];
      try { languages.push(app.getLocale()); } catch { /* pre-ready */ }
      welcomeLocale = resolveDesktopStartupLocale(preference, languages.length === 0 ? ['zh-CN'] : languages);
    } catch (error) {
      console.warn('dshd account: initialization failed', error);
    }
  })().finally(() => { initializingDesktopAccount = undefined; });
  return initializingDesktopAccount;
}

function showForeground() {
  const win = getMainWindow();
  if (win && isDesktopKernelRunning()) {
    showMain();
    return;
  }
  void openLauncher();
}

async function startDesktopFromLauncher(options = {}) {
  const windowOptions = { activate: options.activate !== false };
  const recoveryLaunch = options.recoveryLaunch === true || options.skipLaunch === true;
  // Persistent blocked-import admission boundary: a user clicking Start in
  // the launcher (or a menu/tray auto-start reaching this entry point) must
  // not boot the desktop over unresolved import transactions — the kernel
  // would write through a half-replaced destination tree. Hold at the
  // launcher with the import tab surfaced instead.
  try {
    const pending = readImportJournal(app.getPath('userData'));
    const blocked = journalIsBlocked(pending);
    if (blocked) {
      await openLauncher(windowOptions);
      sendToLauncher('shell:show-tab', { tab: 'import' });
      sendToLauncher('shell:desktop-failed', { error: 'import-recovery-blocked' });
      return { ok: false, error: 'import-recovery-blocked', pendingTxns: (pending && pending.pendingTxns) || [] };
    }
  } catch {
    // An unreadable journal must fail closed too — unknown transaction
    // state is not a safe boot boundary.
    await openLauncher(windowOptions);
    sendToLauncher('shell:show-tab', { tab: 'import' });
    sendToLauncher('shell:desktop-failed', { error: 'import-recovery-blocked' });
    return { ok: false, error: 'import-recovery-blocked' };
  }
  try {
    if (options.forceRestart) {
      // forceRestart replaces a running desktop: ride the same protected
      // commit as menu/tray restarts so active work prompts first.
      // `options.maintenanceToken` delegates the caller's slot ownership so
      // an already-admitted start/retry reaching this restart is recognized
      // as the same operation rather than refused as a foreign caller.
      const guarded = await restartWithCleanup(options.maintenanceToken, { fullPluginRetry: options.fullPluginRetry === true });
      if (guarded && guarded.proceeded === false) {
        return { ok: false, cancelled: guarded.code === 'cancelled', code: guarded.code || 'blocked' };
      }
    } else {
      // A standalone cold start owns its operation for the same reason the
      // restart boundary does: while the kernel boots (dest trees writable),
      // a competing import/install must be refused rather than overlap. The
      // non-forced path is not itself a restart, so it cannot ride
      // restartWithCleanup — acquire the shared slot here and release when
      // the whole start settles. If maintenance is already held by someone
      // else, this start must refuse.
      if (importGuard.isMaintenanceHeld() && !importGuard.holdsMaintenance(options.maintenanceToken)) {
        return { ok: false, error: 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind };
      }
      const ownsToken = !importGuard.isMaintenanceHeld();
      const acquired = ownsToken ? importGuard.acquireMaintenance('start') : null;
      try {
        await harness.start();
      } finally {
        if (acquired) importGuard.releaseMaintenance(acquired);
      }
    }
    const stickyAfter = typeof harness.shouldSkipUserPlugins === 'function'
      ? harness.shouldSkipUserPlugins()
      : false;
    writeLastDesktopStart(app.getPath('userData'), { ok: true });
    sendToLauncher('shell:desktop-ready', harness.snapshot());
    if (shouldCloseLauncherAfterDesktopStart({
      desktopReady: true,
      quitAfterStart: loadConfig().quitAfterStart,
      stickySkip: stickyAfter,
      recoveryLaunch,
      lastStartOk: true,
    })) {
      closeLauncherWindow();
    } else if (stickyAfter || recoveryLaunch) {
      if (stickyAfter) await openLauncher(windowOptions);
      sendToLauncher('shell:show-tab', { tab: 'home' });
    }
    return harness.snapshot();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    writeLastDesktopStart(app.getPath('userData'), { ok: false, error: message, logTail: kernelLogTail(dsh) });
    await openLauncher(windowOptions);
    sendToLauncher('shell:show-tab', { tab: 'home' });
    sendToLauncher('shell:desktop-failed', { error: message });
    return { ok: false, error: message };
  }
}

/** Cold-start twin of the ipc.js unverified-install confirmation. */
async function confirmUnverifiedColdStart(info, parent = getLauncherWindow()) {
  const result = await confirmDialog(parent, {
    type: 'warning',
    buttons: ['仍要安装', '取消'],
    defaultId: 1,
    cancelId: 1,
    dangerIds: [0],
    title: '安装包无法校验',
    message: `版本 ${info?.tag || info?.latest || ''} 未提供 SHA512SUMS.txt 校验清单，无法验证安装包完整性。仍要下载并安装吗？`,
    noLink: true,
  });
  return result.response === 0;
}

// Keep the full release notes in the update dialog's reading region.
function updateAskDetail(check) {
  return plainReleaseNotes(check?.notes) || '该版本未提供更新说明。';
}

async function updateAskOptions(check) {
  const downloadMethods = await updateDownloadMethods(check);
  if (isLauncherPackage()) {
    downloadMethods[0].disabledReason = '请在已安装的桌面程序中使用增量更新。';
  }
  return {
    type: 'question', buttons: ['下载并更新', '稍后'], defaultId: 0, cancelId: 1,
    title: '发现新版本', message: `更新到 v${check.latest || check.version || ''}`,
    kind: 'update',
    context: `当前版本 v${check.current || currentVersion()} → v${check.latest || check.version || ''}`,
    detail: updateAskDetail(check), downloadMethods, noLink: true,
  };
}

// Slim-package cold start talks to the managed runtime: route-aware checks,
// installs that keep the launcher alive, and external process start.
function gateInstallUpdate(onProgress, check) {
  return desktopResources.launcher.installUpdate(onProgress, {
    confirmUnverified: confirmUnverifiedColdStart,
    expectedCheck: check,
    downloadMode: check?.downloadMode,
  });
}

function runColdStartGate(options = {}) {
  const userDataDir = app.getPath('userData');
  const launcherPackage = isLauncherPackage();
  return runLauncherColdStartGate({
    config: loadConfig(),
    userDataDir,
    isPackaged: app.isPackaged,
    checkUpdate: launcherPackage
      ? () => runtimeInstall.checkDesktopUpdate()
      : checkUpdate,
    installUpdate: gateInstallUpdate,
    confirmUpdate: async (check) => {
      const win = getLauncherWindow();
      if (win && !win.isDestroyed() && !win.isFocused()) {
        updateAttention.ready(String(check.latest || check.version || 'update'), win, shellConfirm().window);
      }
      const result = await confirmDialog(win, await updateAskOptions(check));
      updateAttention.clear();
      if (result.response === 0) check.downloadMode = result.downloadMode;
      return result.response === 0;
    },
    openLauncher: () => openLauncher(options),
    sendToLauncher,
    recoverInterruptedImport: () => recoverInterruptedImport({ userDataDir }),
    readImportJournal,
    journalIsBlocked,
    startDesktop: launcherPackage
      ? () => runtimeInstall.startExternalDesktop()
      : () => startDesktopFromLauncher(options),
    drainParkedUpdateCheck: () => drainParkedUpdateCheck.drain({ generation: getLauncherWindow() }),
    log: (line, level) => dsh.log(line, level),
  });
}

const harness = new HarnessController({
  dsh,
  remote,
  loadConfig,
  createMainWindow: createMainWindowWithClose,
  getMainWindow,
  showBoot: () => showBoot({ activate: !backgroundStartup }),
  showHarness: async (url, extra) => {
    // Account services must not delay or gate workspace entry.
    void initializeDesktopAccount(url);
    return showHarness(url, { cookie: dsh.sessionCookie, activate: !backgroundStartup, ...extra });
  },
  sendToBoot,
  isBootLoaded,
  getHarnessWebContents,
  resolveLaunchTarget,
  readConfigSnapshot,
  currentConfigRevision: configRevision,
  stripDroppedPlugins,
  ensureDesktopInstallPlugin,
  removeDshMarketPreset,
  ensureUsagePanelPlugin,
  ensureSessionSearchOverlay,
  ensureDshImPlugin,
  ensureDshbotPlugin,
  ensureDshProjectPlugin: ensureDesktopDshProject,
  ensureTaskControlPlugin: ensureDesktopTaskControl,
  ensureDesktopPlatformSession,
  ensureDshWhalePlugin: ensureDesktopDshWhale,
  ensureDshRemotePlugin: ensureDesktopDshRemote,
  ensureDesktopMarket,
  ensureDesktopOfficeRuntime: async () => ensureDesktopOfficeRuntime(),
  removeLegacyDshbotPreset,
  applyDisabledBundles,
  healDanglingBundles,
  saveConfig,
  appVersion: app.getVersion(),
  ensureWorkspace: (url, workspace, fetchImpl, options) => (
    ensureWorkspace(url, workspace, fetchImpl, { cookie: dsh.sessionCookie, ...options })
  ),
});

// --- Task protection (quit/stop/restart/update) -----------------------------
// The coordinator inspects Host-side work through the dsh-task-control
// plugin's loopback route and prompts before any destructive side effect.
// See docs/features/task-protection.md.

const TASK_VERBS = {
  quit: '退出',
  restart: '重启',
  reload: '重新加载',
  stop: '停止桌面端',
  update: '安装更新',
  install: '安装运行时',
  delta: '增量更新',
};

function describeWorkItem(item) {
  switch (item && item.kind) {
    case 'agent':
      return `代理会话运行中（${item.id}）`;
    case 'job':
      return `后台任务运行中（${item.id}）`;
    case 'request':
      return `${item.count || 1} 个在途请求`;
    case 'socket':
      return `${item.count || 1} 条已建立的远程连接`;
    case 'schedule-task':
      return `定时提醒${item.due ? '已到期' : '待触发'}：${item.title || item.id}`;
    case 'bot-routine':
      return `机器人例程${item.detail === 'running' ? '运行中' : '待执行'}（${item.id}）`;
    case 'bot-inbox':
      return `机器人收件箱有 ${item.count || ''} 条待处理消息`;
    case 'pty':
      return `${item.count || 1} 个打开的终端会话`;
    default:
      return item && item.detail ? String(item.detail) : '有后台工作项';
  }
}

/**
 * `dshDesktop.updates.open()`: run the same check→confirm→install flow the
 * launcher gate owns, presented over the main window. Version confirmation
 * and task protection stay identical — only the host surface differs.
 */
async function openDesktopUpdate() {
  const win = getMainWindow();
  const info = await checkUpdate();
  if (info.status === 'available') {
    const ask = await confirmDialog(win, await updateAskOptions(info));
    if (ask.response !== 0) return;
    const result = await desktopResources.launcher.installUpdate(() => {}, {
      confirmUnverified: (unverified) => confirmUnverifiedColdStart(unverified, win),
      expectedCheck: info,
      downloadMode: ask.downloadMode,
    });
    if (result.launched || result.declined || (result.cancelled && result.code === 'cancelled')) return;
    await confirmDialog(win, {
      type: result.manualInstall || result.openedPage ? 'info' : 'error',
      buttons: ['知道了'],
      defaultId: 0,
      cancelId: 0,
      title: '安装更新',
      message: result.manualInstall ? '请完成安装映像中的更新步骤'
        : result.openedPage ? '此版本没有适用的安装包，已打开发布页面'
          : result.cancelled ? '更新前未能安全结束正在运行的工作'
          : '未能安装更新',
      detail: result.message || result.error || result.code || '',
      noLink: true,
    });
    return;
  }
  if (info.status === 'error') {
    await confirmDialog(win, {
      type: 'error',
      buttons: ['重试', '取消'],
      defaultId: 0,
      cancelId: 1,
      title: '检查更新失败',
      message: '无法连接更新服务，请稍后重试。',
      detail: String(info.message || '').slice(0, 600),
      noLink: true,
    }).then((r) => (r.response === 0 ? openDesktopUpdate() : undefined));
    return;
  }
  await confirmDialog(win, {
    type: 'info',
    buttons: ['知道了'],
    defaultId: 0,
    cancelId: 0,
    title: '检查更新',
    message: `当前已是最新版本 ${currentVersion()}`,
    noLink: true,
  });
}

// Anchor for productized confirmations: the first VISIBLE window — a hidden
// main window must not push prompts to the native fallback while the
// launcher is on screen.
function firstVisibleWindow() {
  return [getMainWindow(), getLauncherWindow()]
    .find((win) => win && !win.isDestroyed() && win.isVisible()) || null;
}

async function confirmTaskStop(operation, inspection) {
  const verb = TASK_VERBS[operation] || '继续';
  const parts = [];
  for (const item of inspection.activeWork || []) {
    parts.push(describeWorkItem(item));
  }
  for (const item of inspection.scheduledWork || []) {
    parts.push(describeWorkItem(item));
  }
  const unknownCoverage = Object.values(inspection.coverage || {})
    .some((value) => value !== 'ok' && value !== 'intentional-disabled');
  const detail = [
    parts.length > 0 ? `仍在运行：${[...new Set(parts)].join('；')}` : '后台任务状态无法完全确认',
    unknownCoverage ? '注意：部分后台服务状态未知' : '',
  ].filter(Boolean).join('\n');
  const options = {
    type: 'warning',
    // Order matches confirmUnverifiedColdStart / openDesktopUpdate: confirm
    // action at index 0 (primary), cancel at index 1 (secondary). Enter and
    // Esc both land on cancel — the risky verb requires an explicit click.
    buttons: [`仍然${verb}`, '取消'],
    defaultId: 1,
    cancelId: 1,
    dangerIds: [0],
    title: `${verb}前确认`,
    message: `${verb}将中断仍在运行的工作`,
    detail,
    noLink: true,
  };
  const result = await confirmDialog(firstVisibleWindow(), options);
  return result.response === 0;
}

const projectEnvironment = createProjectEnvironment({ getGithubToken: () => loadConfig().githubToken });
const taskProtection = createTaskProtection({
  getBaseUrl: () => (typeof dsh.baseUrl === 'string' ? dsh.baseUrl : ''),
  hostRunning: () => isDesktopKernelRunning() && dsh.webReady === true && Boolean(dsh.baseUrl),
  confirm: confirmTaskStop,
  shellWork: () => {
    const count = Number(desktopResources && desktopResources.pty && typeof desktopResources.pty.count === 'function'
      ? desktopResources.pty.count() : 0);
    return count > 0 ? [{ kind: 'pty', id: 'desktop-pty', count }] : [];
  },
  log: (message) => dsh.log(message, 'app'),
});
installTaskProtection(taskProtection);

// Slim-launcher handshake: the peer endpoint lets a separate launcher process
// ask this desktop to stop (task-protected) or to prepare for an install.
const taskControlPeer = createTaskControlPeer({
  stateDir: () => app.getPath('userData'),
  status: () => ({ kernel: typeof dsh.state === 'string' ? dsh.state : 'unknown', webReady: dsh.webReady === true }),
  onPeerStop: async () => {
    // "Stop the desktop" for an external launcher means this process exits —
    // the legacy path was taskkill, so the protected equivalent is a
    // terminal coordinate followed by the normal quit funnel. The launcher's
    // stop button is explicit consent: preConfirmed keeps the
    // inspect/acquire/drain sequencing but skips the confirm — prompting
    // again would double-prompt one click (and with every desktop window
    // hidden it fell back to a native box).
    const result = await taskProtection.coordinate('stop', { terminal: true, preConfirmed: true });
    if (!result.proceeded) {
      return { ok: false, code: result.code || 'cancelled' };
    }
    setTimeout(() => quitApp(), 250);
    return { ok: true, quit: true };
  },
  onPeerInstall: async () => {
    // Same explicit-consent rule as onPeerStop: the launcher's install/更新
    // click already authorized replacing the running desktop.
    const result = await taskProtection.coordinate('install', { terminal: true, preConfirmed: true });
    if (!result.proceeded) {
      return { ok: false, code: result.code || 'cancelled' };
    }
    // Flush the response before the process starts its protected quit.
    setTimeout(() => quitApp(), 250);
    return { ok: true, quit: true };
  },
});

async function pickWorkspace() {
  const win = getMainWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '选择工作区',
    defaultPath: loadConfig().workspace,
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  saveConfig({ workspace: result.filePaths[0] });
  await restartWithCleanup();
  return result.filePaths[0];
}

/**
 * Tear down desktop-bound child processes and views (PTY, BrowserView).
 * Returns a promise that settles only after the preview close has completed —
 * restart/reload/quit must not proceed while a BrowserView teardown is still
 * in flight, or a raced detach leaves a half-removed view behind.
 */
async function cleanupDesktopResources() {
  if (!desktopResources) {
    await require('../launcher/forensics-log').flushBootLogs();
    return;
  }
  try {
    desktopResources.pty.killAll();
  } catch (error) {
    dsh.log(`PTY 清理失败：${error.message}`, 'app');
  }
  await Promise.resolve(desktopResources.preview.closeAll()).catch((error) => {
    dsh.log(`预览清理失败：${error.message}`, 'app');
  });
  await require('../launcher/forensics-log').flushBootLogs();
}

/**
 * Restart goes through the task-protection funnel: active Host work prompts
 * before PTY/preview teardown. `recordLastDesktopStart` keeps running inside
 * the commit so a cancelled prompt does not leave a stale failure marker.
 *
 * `delegatedToken` implements owner-aware delegation: an internal call that
 * is part of the operation already owning the maintenance slot carries that
 * exact owner token down (e.g. the service's start/retry reaching a forced
 * restart). Only the live owner token passes — a bare kind string, a stale
 * token, or an unrelated caller still refuses.
 */
function restartWithCleanup(delegatedToken, options = {}) {
  // The shared maintenance slot admits only one mutating operation at a time.
  // An import, install, or start that already holds it owns the destination
  // trees — a restart must refuse rather than prompt and tear down under it,
  // unless this restart IS that same operation delegating to itself.
  if (importGuard.isMaintenanceHeld() && !importGuard.holdsMaintenance(delegatedToken)) {
    return Promise.resolve({
      proceeded: false,
      code: 'maintenance-in-progress',
      owner: importGuard.maintenanceOwner()?.kind,
    });
  }
  // A persistent blocked import journal must hold every restart boundary —
  // menu, tray, and nested starts — not only launcher Start. Unknown or
  // unreadable journal state fails closed the same way.
  try {
    const pending = readImportJournal(app.getPath('userData'));
    if (journalIsBlocked(pending)) {
      return Promise.resolve({ proceeded: false, code: 'import-recovery-blocked', pendingTxns: pending?.pendingTxns || [] });
    }
  } catch {
    return Promise.resolve({ proceeded: false, code: 'import-recovery-blocked' });
  }
  // Standalone invocation (menu/tray restart, or a start channel that did
  // not delegate a token): checking the slot is not enough — this boundary
  // must OWN the operation while it is pending, or a competitor admitted
  // between the check and the commit would overlap the teardown. An
  // explicitly delegated live owner token delegates instead of acquiring.
  const ownsToken = !importGuard.isMaintenanceHeld();
  const acquired = ownsToken ? importGuard.acquireMaintenance('restart') : null;
  const releaseAcquired = () => { if (acquired) importGuard.releaseMaintenance(acquired); };
  try {
    return taskProtection.coordinate('restart', {
      commit: async () => {
        await cleanupDesktopResources();
        return recordLastDesktopStart(app.getPath('userData'), () => harness.restart(options), () => kernelLogTail(dsh));
      },
    }).then((result) => (result.proceeded ? undefined : result))
      .finally(releaseAcquired);
  } catch (error) {
    releaseAcquired();
    throw error;
  }
}

const reloadWithCleanup = createReloadWithCleanup({
  getMainWindow,
  dsh,
  harness,
  taskProtection,
  importGuard,
  readImportJournal,
  journalIsBlocked,
  cleanupDesktopResources,
  getUserDataDir: () => app.getPath('userData'),
});
function quitApp() {
  if (quitInProgress) return;
  if (qaEnv('DSH_QA_SHELL') && process.env.DSH_QA_ALLOW_QUIT !== '1') {
    qaQuitIntercepted = true;
    console.log('[DSH_QA_SHELL] quit intercepted');
    return;
  }
  quitting = true;
  app.quit();
}

function ignoreFailure(promise) {
  Promise.resolve(promise).catch((error) => {
    dsh.log(error.message || String(error), 'error');
  });
}

/**
 * Turn a parked late update check into an ask, but only while the launcher is
 * genuinely on screen. `shell:launcher-status` runs from a pre-created hidden
 * window, so consuming the parked check there lost it before the user ever saw
 * it. The window-identity guard abandons an in-flight ask if that window goes
 * away (or the app is quitting / already installing).
 */
const drainParkedUpdateCheck = createParkedUpdateDrainer({
  readConfig: () => loadConfig(),
  isVisible: () => {
    const win = getLauncherWindow();
    return Boolean(win && !win.isDestroyed() && win.isVisible());
  },
  isQuitting: () => quitting || stoppingForQuit,
  isCurrentGeneration: (generation) => {
    if (generation === undefined) return true;
    const win = getLauncherWindow();
    return Boolean(win && win === generation && win.isVisible());
  },
  log: (message) => dsh.log(message, 'error'),
  present: (check, { generation }) => presentUpdateAsk({
    config: loadConfig(),
    isPackaged: app.isPackaged,
    check,
    confirmUpdate: async (pending) => {
      const win = getLauncherWindow();
      if (win && !win.isDestroyed() && !win.isFocused()) {
        updateAttention.ready(String(pending.latest || pending.version || 'update'), win, shellConfirm().window);
      }
      const result = await confirmDialog(win, await updateAskOptions(pending));
      updateAttention.clear();
      if (result.response === 0) pending.downloadMode = result.downloadMode;
      return result.response === 0;
    },
    installUpdate: gateInstallUpdate,
    openLauncher,
    sendToLauncher,
    alreadyVisible: true,
    // `presentUpdateAsk` re-checks this after its awaits.
    shouldContinue: () => {
      if (quitting || stoppingForQuit) return false;
      const win = getLauncherWindow();
      return Boolean(win && win.isVisible() && (generation === undefined || generation === win));
    },
  }),
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error(`${PRODUCT_NAME} is already running. Quit the installed app before npm start (same appId single-instance lock).`);
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes('--background')) return;
    showForeground();
  });

  // The pet overlay is a fullscreen transparent always-on-top window; a GPU
  // process crash can leave its layered surface compositing opaque-black over
  // the whole display (whale sprite still draws). Rebuild it on GPU death.
  app.on('gpu-process-crashed', () => {
    try { getLive2dPet()?.recreateWindow(); } catch {}
  });
  app.on('child-process-gone', (_event, details) => {
    if (details?.type === 'GPU') {
      try { getLive2dPet()?.recreateWindow(); } catch {}
    }
  });

  app.setName(PRODUCT_NAME);
  app.setAppUserModelId('ai.deepseek.harness.gui');

  // Window-scoped DevTools toggle (Ctrl+Shift+I / Cmd+Alt+I). Never an OS
  // global shortcut: that would hijack the chord in other applications and
  // opened DevTools unconditionally in packaged builds.
  app.on('web-contents-created', (_event, contents) => {
    attachDevToolsShortcut(contents, {
      allowed: () => devToolsShortcutAllowed({
        isPackaged: app.isPackaged,
        openDevTools: loadConfig().openDevTools === true,
      }),
      resolveTarget: () => {
        const win = getMainWindow() || getLauncherWindow();
        return getHarnessWebContents(win) || win?.webContents;
      },
    });
  });

  app.whenReady().then(async () => {
    const shortcutMigration = await migrateLegacyNotificationShortcut({
      isPackaged: app.isPackaged,
      launcher: require('../launcher/product').isLauncherPackage(),
      appDataDir: app.getPath('appData'),
      userDataDir: app.getPath('userData'),
      readShortcutLink: path => shell.readShortcutLink(path),
    });
    if (shortcutMigration.status === 'migrated' || shortcutMigration.status === 'failed') {
      dsh.log(`[legacy-notification-shortcut] ${shortcutMigration.status}`, 'app');
    }
    const homeEnv = sanitizePackagedDshHomeEnv({ isPackaged: app.isPackaged });
    if (homeEnv.dropped) {
      dsh.log(`忽略继承的 DSHD_HOME=${homeEnv.value}（packaged 下需要 DSHD_ALLOW_ENV_HOME=1）`, 'app');
    }
    const desktopHome = setDesktopDshHome(desktopDshHomeFromUserData(app.getPath('userData')));
    fs.mkdirSync(desktopHome, { recursive: true });

    const stopWhaleBridgeNotifications = require('./whalebridge-notifications').startWhaleBridgeNotifications();
    app.once('will-quit', stopWhaleBridgeNotifications);
    dsh.log(`Harness 家目录 ${desktopHome}`, 'app');
    const config = loadConfig();
    configureDesktopPet({ loadConfig, saveConfig, currentTheme });
    // Profile/config mutations must refuse BEFORE writing while a blocked
    // import journal persists — the same persistent verdict every other
    // write boundary honors, applied here because profile-ops owns no
    // userData path of its own.
    configureProfileOps({
      journalBlocked: () => {
        try {
          return journalIsBlocked(readImportJournal(app.getPath('userData')));
        } catch {
          // An unreadable journal fails closed — unknown state is not a
          // safe mutation boundary.
          return true;
        }
      },
    });
    if (LIVE2D_PET_FEATURE) {
      configureLive2dPet({
        loadConfig,
        saveConfig,
        sessionsDir: require('path').join(desktopHome, 'sessions'),
        getMainWindow,
        getHarnessOrigin,
        getSessionCookie: () => dsh.sessionCookie || '',
        // The pet card's jump button: raise the main window and open her
        // persistent conversation through the client-side hook.
        openWhaleAssistant: async () => {
          const win = showMain();
          const wc = getHarnessWebContents(win);
          if (!wc || !isHarnessLoaded(win)) {
            return { ok: false, reason: 'harness-not-ready' };
          }
          // null = hook absent (plugin not mounted/not ready); false = hook
          // ran but failed; true = session opened.
          const opened = await wc.executeJavaScript(
            'typeof window.__dshWhaleOpen === "function"'
              + ' ? window.__dshWhaleOpen().then(() => true, () => false)'
              + ' : Promise.resolve(null)',
          ).catch(() => null);
          if (opened === null) {
            return { ok: false, reason: 'hook-missing' };
          }
          if (opened !== true) {
            return { ok: false, reason: 'open-failed' };
          }
          win.focus();
          return { ok: true };
        },
        // The pet panel's ⚙ 设置 cell opens her section inside the main
        // window's Settings shell (section `pet`) — the pet overlay itself
        // carries no settings UI. openHarnessSettings resolves false when
        // the harness page is not up.
        openPetSettings: async () => ({ ok: (await openHarnessSettings('pet')) === true }),
        // Hide paths that bypass the tray (pet panel 隐藏, settings page)
        // still funnel through setEnabled — refresh rebuilds the checkbox
        // snapshot so the tray never shows a stale check.
        onEnabledChange: () => refreshTrayMenu(),
      });
      getLive2dPet()?.show();
    }
    fs.mkdirSync(config.workspace, { recursive: true });
    saveConfig({ workspace: config.workspace });
    app.setLoginItemSettings({ openAtLogin: Boolean(config.openAtLogin) });
    setGithubTokenProvider(() => loadConfig().githubToken);

    startDesktopInstallControl({
      installPlugin: (spec, options) => installPlugin(spec, {
        ...options,
        token: loadConfig().githubToken,
      }),
      startHarness: restartWithCleanup,
      // The /desktop/* half of the control channel: dsh-whale's management
      // tools reach the same profile-ops implementation as the IPC surface,
      // so config writes and plugin toggles share one serialized align
      // chain no matter which surface asked.
      desktop: {

        project: (payload) => projectEnvironment.dispatch(payload),

        htmlPreview: (input, signal) => require('./html-preview').captureHtmlPreview(input, signal),

        state: () => {
          const configNow = loadConfig();
          const listed = listInstalledPlugins();
          return {
            ok: true,
            version: currentVersion(),
            kernel: dshKernelState(dsh),
            plugins: (listed.plugins || []).map((row) => row.name),
            disabledPlugins: Array.isArray(configNow.disabledPlugins) ? configNow.disabledPlugins : [],
            config: publicConfig(configNow),
          };
        },
        listMarketplace: async (options = {}) => {
          const payload = await listMarketplace({
            refresh: options.refresh === true,
            locale: loadConfig().locale === 'en' ? 'en' : 'zh',
          });
          const q = String(options.q ?? '').trim().toLowerCase();
          if (!q || !Array.isArray(payload?.items)) return payload;
          return {
            ...payload,
            items: payload.items.filter((item) =>
              `${item.id} ${item.description} ${item.packageName} ${item.category}`
                .toLowerCase()
                .includes(q)),
          };
        },
        applyConfig: (patch) => {
          try {
            const next = applyRendererConfigPatch(patch, {
              app,
              applyAppTheme,
              harness,
              startHarness: restartWithCleanup,
              log: (line) => dsh.log(line, 'app'),
            });
            return { ok: true, config: publicConfig(next) };
          } catch (error) {
            return { ok: false, error: String(error?.message ?? error) };
          }
        },
        petSettings: () => {
          const pet = getLive2dPet();
          if (!pet) return { ok: false, error: 'whale settings are unavailable' };
          return { ok: true, settings: pet.getSettings(), enabled: Boolean(loadConfig().live2dPet?.enabled) };
        },
        applyPetSettings: (patch) => {
          const pet = getLive2dPet();
          if (!pet) return { ok: false, error: 'whale settings are unavailable' };
          const allowed = new Set([
            'scale', 'opacity', 'personality', 'activity', 'selfTalk', 'wander',
            'lockPosition', 'shiftToDrag', 'powerSave', 'clickSound', 'chatEnabled',
            'lookProvider', 'lookModel',
          ]);
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)
            || Object.keys(patch).some((key) => !allowed.has(key))) {
            return { ok: false, error: 'unknown or invalid whale setting' };
          }
          return { ok: true, settings: pet.applySettings({ patch }) };
        },
        installCatalog: (id, options = {}) => recordMarketplaceOperation('install', id, (record) => (
          installMarketplacePlugin(id, {
            allowBuilds: Array.isArray(options.allowBuilds) ? options.allowBuilds : [],
            token: loadConfig().githubToken,
            onProgress: record,
          })
        )),
        removePlugin: async (name) => {
          const guardError = pluginRemoveGuardError(name);
          if (guardError) {
            return { ok: false, error: guardError };
          }
          return recordMarketplaceOperation('uninstall', name, (record) => (
            uninstallPlugin(name, { onProgress: record })
          ));
        },
        disablePlugins: (names) => disablePlugins(names, { dsh, startHarness: restartWithCleanup }),
        enablePlugin: (name) => enablePlugin(name, { dsh, startHarness: restartWithCleanup }),
      },
    });
    try {
      await desktopInstallReady();
    } catch (error) {
      stopDesktopInstallControl();
      dsh.log(`桌面安装控制通道启动失败：${error.message || String(error)}`, 'error');
    }
    // Slim-launcher handshake endpoint: publishing the peer file lets a
    // launcher-driven install/stop run through task protection instead of
    // touching the process directly.
    taskControlPeer.start()
      .then((result) => {
        if (result.ok === false) {
          dsh.log(`任务保护握手端点启动失败：${result.error || 'unknown'}`, 'error');
        }
      })
      .catch((error) => {
        dsh.log(`任务保护握手端点启动失败：${error.message || String(error)}`, 'error');
      });

    desktopResources = registerIpc({
      dsh,
      harness,
      startHarness: restartWithCleanup,
      startDesktop: startDesktopFromLauncher,
      stopDesktopCleanup: cleanupDesktopResources,
      remote,
      getLive2dPet,
      onOpenLauncher: async (options = {}) => {
        await openLauncher();
        // Boot-page bridge: land on the home tab so the Recovery Board is
        // in view (same show-tab path the failed-start flow uses).
        if (options && options.tab) {
          sendToLauncher('shell:show-tab', { tab: options.tab });
        }
      },
    });
    installShortcutService({
      ipcMain,
      userData: app.getPath('userData'),
      platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      getView: () => getHarnessView() ?? undefined,
      getWindow: () => getMainWindow(),
      getOrigin: () => getHarnessOrigin(),
      overlayInput: (win) => ({ revision: 0, blocked: Boolean(win) && closingOverlayActive }),
      onMenuChanged: () => rebuildMenu(),
    });
    const existingView = getHarnessView();
    if (existingView) getShortcutService().attach(existingView);
    const rebuildMenu = () => buildMenu({
      onOpenWorkspace: () => ignoreFailure(pickWorkspace()),
      onOpenLauncher: () => ignoreFailure(openLauncher()),
      onRestart: () => ignoreFailure(restartWithCleanup()),
      onReload: () => ignoreFailure(reloadWithCleanup()),
      shortcuts: getShortcutService(),
    });
    rebuildMenu();
    createTray({
      onShow: showForeground,
      onOpenLauncher: () => ignoreFailure(openLauncher()),
      onRestart: () => ignoreFailure(restartWithCleanup()),
      onQuit: () => quitApp(),
      ...(DESKTOP_PET_FEATURE ? {
        petEnabled: () => getDesktopPet()?.isEnabled() === true,
        onPetToggle: (enabled) => {
          const pet = getDesktopPet();
          const win = getMainWindow();
          pet?.setEnabled(enabled, isHarnessLoaded(win) ? win : null);
        },
      } : LIVE2D_PET_FEATURE ? {
        petEnabled: () => getLive2dPet()?.isEnabled() === true,
        onPetToggle: (enabled) => {
          getLive2dPet()?.setEnabled(enabled);
        },
      } : {}),
    });

    watchSystemTheme();

    // In-app update indicator backend (upstream dshDesktop.updates): the Web
    // chip reads status() and open() joins the shell-owned check→confirm→
    // install flow — identical gates to the launcher ask.
    const updatesState = createUpdatesState({ onOpen: openDesktopUpdate });
    setUpdateStateSink((state) => {
      updatesState.publish(state);
      const wc = getHarnessWebContents(getMainWindow());
      if (wc) updatesState.broadcast([wc]);
    });

    // Sidebar browser guests (upstream webview model): lease-checked
    // will-attach-webview, per-workspace locked-down partitions, Host origin
    // unreachable from guests.
    installBrowserGuests(new BrowserGuests(() => getHarnessOrigin()), {
      ipcMain,
      getView: () => getHarnessView(),
      getOrigin: () => getHarnessOrigin(),
    });

    // Embedded Platform documents (usage/top-up): an isolated WebContentsView
    // child with account-scoped partitions and main-owned credential header
    // injection. Session snapshots arrive from the loopback publisher route.
    platformView = new DesktopPlatformView(
      require('node:path').join(__dirname, '..', 'preload', 'platform.js'),
      () => welcomeLocale?.id === 'zh-CN' ? 'zh_CN' : 'en_US',
      process.platform === 'win32' ? 'win32' : 'darwin',
      welcomeClientMetadata,
    );
    platformSessionRefresh = async () => {
      try {
        platformView?.setSession(await fetchPlatformSession(getHarnessOrigin()));
      } catch {
        // Loopback failures leave the last session; open() refetches.
      }
    };
    const assertProductDoc = (event) => {
      const view = getHarnessView();
      if (view === undefined || event.sender !== view.webContents
        || event.senderFrame !== view.webContents.mainFrame
        || !event.senderFrame.url.startsWith(getHarnessOrigin())) {
        throw new Error('dshd platform: rejected sender');
      }
      return getMainWindow();
    };
    ipcMain.on(PLATFORM_IPC.bootstrap, (event) => {
      try { event.returnValue = platformView.bootstrap(event); }
      catch { event.returnValue = null; }
    });
    ipcMain.handle(PLATFORM_IPC.open, async (event, page, bounds) => {
      const owner = assertProductDoc(event);
      if (page !== 'usage' && page !== 'top-up') throw new Error('dshd platform: invalid page');
      await platformSessionRefresh?.();
      return platformView.open(owner, page, platformBounds(bounds));
    });
    ipcMain.handle(PLATFORM_IPC.bounds, (event, bounds) => {
      assertProductDoc(event);
      platformView.setBounds(platformBounds(bounds));
    });
    ipcMain.handle(PLATFORM_IPC.close, (event) => {
      assertProductDoc(event);
      platformView.close();
    });

    // Microphone stays scoped to the owned harness main frame, audio only
    // (upstream microphone-permissions policy, adapted to the loopback origin).
    installMediaPermissions(session.defaultSession, () => {
      const view = getHarnessView();
      return view && !view.webContents.isDestroyed() ? view.webContents : undefined;
    }, systemPreferences);

    // html[data-ds-theme-source] → nativeTheme.themeSource, so native chrome
    // (dialogs, tray icon contrast) follows the app palette (upstream
    // preload-theme semantics; sender-gated to the harness view).
    ipcMain.on('shell:native-theme', (event, value) => {
      const view = getHarnessView();
      if (!view || view.webContents.isDestroyed() || event.sender !== view.webContents) return;
      if (value === 'light' || value === 'dark' || value === 'system') {
        nativeTheme.themeSource = value;
      }
    });

    void pruneCrashReports(crashLogDir()).catch((error) => console.warn('dshd: crash report prune failed', error));

    session.defaultSession.on('will-download', (event, item) => {
      const dest = downloadSavePath(app.getPath('downloads'), item.getFilename());
      item.setSavePath(dest);
    });

    const launcherWin = await prepareLauncher();
    bindLauncherClose(launcherWin);
    const startupOptions = { activate: !backgroundStartup };
    try {
      if (process.argv.includes('--dshd-from-launcher')) {
        // Spawned by the slim launcher package: its gate already decided — go
        // straight to the desktop start instead of opening a second gate.
        if (process.argv.includes('--skip-user-plugins')
          && harness && typeof harness.writePluginSkip === 'function') {
          harness.writePluginSkip(new Error('launcher-skip-user-plugins'));
        }
        await startDesktopFromLauncher(startupOptions);
        // The external launcher's gate ran in another process. Seed this
        // desktop's single update status stream without opening another gate.
        void checkUpdate();
      } else {
        await runColdStartGate(startupOptions);
      }
    } finally {
      backgroundStartup = false;
    }
    if (qaEnv('DSH_SMOKE')) {
      // QA / smoke orchestration lives in ./smoke and is only required inside
      // this gate: a production start never loads the QA drivers.
      const { createSmokeRunner } = require('./smoke');
      const smoke = createSmokeRunner({
        qaEnv,
        qaRemoteMode,
        dsh,
        harness,
        loadConfig,
        saveConfig,
        getHarnessWebContents,
        getWelcomeWebContents: () => require('electron').BrowserWindow.getAllWindows()
          .find(window => !window.isDestroyed() && /\/welcome\.html(?:[?#]|$)/.test(window.webContents.getURL()))?.webContents,
        showMain,
        invokeTrayAction,
        probeRemoteSnapshot,
        setRemoteFromQa,
        getDesktopResources: () => desktopResources,
        getQuitIntercepted: () => qaQuitIntercepted,
        resetQuitIntercepted: () => { qaQuitIntercepted = false; },
      });
      if (!getMainWindow()) {
        await startDesktopFromLauncher();
      }
      if (qaEnv('DSH_REMOTE_PHONE_HOST')) {
        void smoke.keepRemotePhoneHost();
      } else {
        void smoke.runSmoke(getMainWindow());
      }
    }
  });

  app.on('activate', () => {
    if (backgroundStartup) return;
    showForeground();
  });

  app.on('before-quit', (event) => {
    if (quitInProgress) {
      event.preventDefault();
      return;
    }
    quitting = true;
    if (stoppingForQuit) {
      return;
    }
    event.preventDefault();
    void finalizeQuit();
  });

  // Explicit quit is already consent: keep inspection/lock/drain, not a
  // second task-warning prompt. Failed shutdown still offers recovery.
  async function finalizeQuit() {
    if (quitInProgress) return;
    quitInProgress = true;
    try {
      while (true) {
        let result;
        let dismissClosing;
        try {
          result = await taskProtection.coordinate('quit', {
            terminal: true,
            preConfirmed: true,
            commit: async () => {
              stoppingForQuit = true;
              closingOverlayActive = true;
              const win = getMainWindow();
              // Keep the current page and its drafts until stopping succeeds.
              dismissClosing = await showClosingOverlay(win, loadConfig().locale,
                getHarnessWebContents(win) || win?.webContents).catch(() => undefined);
              let shutdownTimer;
              try {
                await Promise.race([
                  Promise.all([harness.shutdown(), cleanupDesktopResources(), getLive2dPet()?.dispose()]),
                  new Promise((_, reject) => {
                    shutdownTimer = setTimeout(() => {
                      const error = new Error('后台关停未在 30 秒内完成');
                      error.code = 'dshd/shutdown-timeout';
                      reject(error);
                    }, 30000);
                  }),
                ]);
              } finally {
                clearTimeout(shutdownTimer);
              }
              stopDesktopInstallControl();
              void taskControlPeer.stop();
              // Keep the current surface until the native window closes.
              // Detaching it here exposes the boot page for a final frame.
            },
          });
        } catch (error) {
          result = { proceeded: false, code: error.code || 'dshd/shutdown-failed',
            detail: error.message || String(error) };
        }
        if (result.proceeded) {
          quitInProgress = false;
          app.quit();
          return;
        }
        quitting = false;
        stoppingForQuit = false;
        closingOverlayActive = false;
        if (dismissClosing) void dismissClosing().catch(() => {});
        // The user already requested quit; a failed drain or an
        // unreachable runtime must not silently cancel the quit — offer a
        // last-resort force exit so the app can always be closed.
        if (result.code && result.code !== 'cancelled' && result.code !== 'busy') {
          const diagnostics = {
            code: result.code,
            detail: result.detail,
            pendingCount: result.pendingCount,
            pendingLabels: result.pendingLabels,
          };
          dsh.log(`退出失败：${JSON.stringify(diagnostics)}`, 'error');
          const choice = await confirmDialog(firstVisibleWindow(), {
            type: 'warning',
            title: '退出未完成',
            message: result.code === 'dshd/shutdown-failed' || result.code === 'dshd/shutdown-timeout'
              ? '后台服务未能完成关停' : '桌面运行时未响应退出请求',
            detail: '可重试退出，或强制退出（运行中的工作将直接中断）。取消可返回应用。',
            buttons: ['重试', '强制退出', '取消'],
            defaultId: 2,
            cancelId: 2,
            dangerIds: [1],
            noLink: true,
          }).catch(() => ({ response: 2 }));
          if (choice.response === 0) {
            quitting = true;
            continue;
          }
          if (choice.response === 1) {
            quitting = true;
            stoppingForQuit = true;
            let forceExitTimer;
            try {
              await Promise.race([
                (async () => {
                  stopDesktopInstallControl();
                  void taskControlPeer.stop();
                  // Start stopping the child even if a preview never closes.
                  const results = await Promise.allSettled([harness.shutdown(), cleanupDesktopResources(), getLive2dPet()?.dispose()]);
                  for (const result of results) {
                    if (result.status === 'rejected') {
                      dsh.log(`强制退出：后台关停失败：${result.reason?.message || String(result.reason)}`, 'error');
                    }
                  }
                })(),
                new Promise((resolve) => {
                  forceExitTimer = setTimeout(() => {
                    dsh.log('强制退出：关停等待超时', 'error');
                    resolve();
                  }, 5000);
                }),
              ]);
            } catch (error) {
              dsh.log(`强制退出：后台关停失败：${error.message || String(error)}`, 'error');
            } finally {
              clearTimeout(forceExitTimer);
            }
            app.exit(0);
            return;
          }
        }
        quitting = false;
        harness.cancelShutdown();
        return;
      }
    } finally {
      quitInProgress = false;
    }
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !hideOnClose(loadConfig())) {
      quitApp();
    }
  });
}
