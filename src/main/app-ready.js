'use strict';

const { app, ipcMain, session, shell, nativeTheme, systemPreferences } = require('electron');
const fs = require('fs');
const { setDesktopDshHome, desktopDshHomeFromUserData, sanitizePackagedDshHomeEnv } = require('../shared/dsh-home');
const { detectGpuTier } = require('./gpu-tier');
const {
  getMainWindow,
  getLauncherWindow,
  getHarnessWebContents,
  getHarnessView,
  getHarnessOrigin,
  onHarnessOriginChange,
  onMainWindowChange,
  isHarnessLoaded,
  sendToLauncher,
  showMain,
  openHarnessSettings,
  openHarnessSession,
  prepareLauncher,
  setRenderHintsSource,
} = require('./window');
const { migrateLegacyNotificationShortcut } = require('./legacy-notification-shortcut');
const { loadConfig, saveConfig, publicConfig } = require('./config');
const {
  DESKTOP_PET_FEATURE,
  configureDesktopPet,
  getDesktopPet,
} = require('./desktop-pet');
const {
  LIVE2D_PET_FEATURE,
  configureLive2dPet,
  getLive2dPet,
} = require('./desktop-live2d');
const { watchSystemTheme, currentTheme, applyAppTheme } = require('./chrome');
const {
  applyRendererConfigPatch,
  disablePlugins,
  dshKernelState,
  enablePlugin,
  pluginRemoveGuardError,
  configureProfileOps,
} = require('./profile-ops');
const { readImportJournal, journalIsBlocked } = require('./data-import');
const {
  setGithubTokenProvider,
  setUpdateRouteProvider,
  setUpdateStateSink,
  checkUpdate,
  currentVersion,
} = require('./update');
const {
  startDesktopInstallControl,
  stopDesktopInstallControl,
  desktopInstallReady,
} = require('./desktop-install-control');
const { isLauncherPackage } = require('../launcher/product');

const YIELD_BUDGET_MS = 8;
let lastYieldAt = Date.now();
const yieldTurn = () => {
  if (Date.now() - lastYieldAt < YIELD_BUDGET_MS) return Promise.resolve();
  return new Promise((resolve) => setTimeout(() => { lastYieldAt = Date.now(); resolve(undefined); }, 0));
};
const listInstalledPlugins = () => require('./plugins').listInstalledPlugins();
/** @param {any} spec @param {any} options */
const installPlugin = (spec, options) => require('./marketplace-install').installPlugin(spec, options);
/** @param {any} id @param {any} options */
const installMarketplacePlugin = (id, options) => require('./marketplace-install').installMarketplacePlugin(id, options);
/** @param {any} name @param {any} options */
const uninstallPlugin = (name, options) => require('./marketplace-install').uninstallPlugin(name, options);
/** @param {any} options */
const listMarketplace = (options) => require('./marketplace-catalog').listMarketplace(options);
/** @param {any} kind @param {any} target @param {any} run */
const recordMarketplaceOperation = (kind, target, run) => require('./marketplace-state').recordMarketplaceOperation(kind, target, run);

/**
 * @param {import('./app-shell-state').ShellState} state
 * @param {import('./dsh').DshManager} dsh
 */
function installApprovalMonitor(state, dsh) {
  const { createApprovalMonitor } = require('./approval-monitor');
  const { getBaseTrayIcon, setTrayBadge } = require('./tray');
  const monitor = createApprovalMonitor({
    getMainWindow,
    openHarnessSession,
    loadConfig,
    getBaseTrayIcon,
    setTrayBadge,
    getSessionCookie: () => dsh.sessionCookie || '',
    log: (line) => dsh.log(line, 'app'),
  });
  state.approvalMonitor = monitor;
  monitor.start();
  onHarnessOriginChange((/** @type {string} */ origin) => {
    monitor.setHarnessOrigin(origin, dsh.sessionCookie || '');
  });
  onMainWindowChange((/** @type {any} */ win) => {
    monitor.attachMainWindow(win);
  });
  const existingOrigin = getHarnessOrigin();
  if (existingOrigin) {
    monitor.setHarnessOrigin(existingOrigin, dsh.sessionCookie || '');
  }
}

/**
 * The `app.whenReady()` body extracted from index.js (#439 P3-4): legacy
 * shortcut migration, GPU/DSHD_HOME setup, pet and profile configuration, the
 * desktop install control channel, task-control peer, update center, IPC +
 * shortcut service + menu + tray registration, browser guests, embedded
 * Platform documents, media permissions, downloads, launcher preparation and
 * the cold-start gate. Every collaborator arrives explicitly so the entry
 * file only assembles. Behavior unchanged.
 *
 * @param {object} deps
 * @param {import('./app-shell-state').ShellState} deps.state
 * @param {import('./dsh').DshManager} deps.dsh
 * @param {import('./harness-controller').HarnessController} deps.harness
 * @param {any} deps.remote
 * @param {() => string} deps.crashLogDir
 * @param {(promise: any) => void} deps.ignoreFailure
 * @param {() => void} deps.quitApp
 * @param {any} deps.projectEnvironment
 * @param {(options?: Record<string, any>) => Promise<any>} deps.openLauncher
 * @param {(win: any) => any} deps.bindLauncherClose
 * @param {() => void} deps.showForeground
 * @param {(options?: Record<string, any>) => Promise<any>} deps.startDesktopFromLauncher
 * @param {(delegatedToken?: any, options?: Record<string, any>) => any} deps.restartWithCleanup
 * @param {() => any} deps.reloadWithCleanup
 * @param {() => Promise<void>} deps.cleanupDesktopResources
 * @param {() => Promise<any>} deps.pickWorkspace
 * @param {any} deps.taskProtection
 * @param {any} deps.taskControlPeer
 * @param {(parent?: any) => void} deps.openUpdateCenter
 * @param {() => Promise<any>} deps.openDesktopUpdate
 * @param {(options?: Record<string, any>) => Promise<any>} deps.runColdStartGate
 * @param {any} deps.updateCenterWindow
 * @param {any} deps.updateReadyAttention
 * @param {(request: Record<string, any>) => Promise<any>} deps.confirmModelAction
 * @param {(request: Record<string, any>) => Promise<{ ok: boolean }>} deps.showDesktopSecret
 * @param {() => Record<string, any>} deps.welcomeClientMetadata
 * @param {() => string|undefined} deps.getWelcomeLocaleId
 */
async function runAppReady({
  state,
  dsh,
  harness,
  remote,
  crashLogDir,
  ignoreFailure,
  quitApp,
  projectEnvironment,
  openLauncher,
  bindLauncherClose,
  showForeground,
  startDesktopFromLauncher,
  restartWithCleanup,
  reloadWithCleanup,
  cleanupDesktopResources,
  pickWorkspace,
  taskProtection,
  taskControlPeer,
  openUpdateCenter,
  openDesktopUpdate,
  runColdStartGate,
  updateCenterWindow,
  updateReadyAttention,
  confirmModelAction,
  showDesktopSecret,
  welcomeClientMetadata,
  getWelcomeLocaleId,
}) {
  const shortcutMigration = await migrateLegacyNotificationShortcut(/** @type {Record<string, any>} */ ({
    isPackaged: app.isPackaged,
    launcher: require('../launcher/product').isLauncherPackage(),
    appDataDir: app.getPath('appData'),
    userDataDir: app.getPath('userData'),
    readShortcutLink: (/** @type {string} */ path) => shell.readShortcutLink(path),
  }));
  if (shortcutMigration.status === 'migrated' || shortcutMigration.status === 'failed') {
    dsh.log(`[legacy-notification-shortcut] ${shortcutMigration.status}`, 'app');
  }
  lastYieldAt = Date.now();
  const homeEnv = sanitizePackagedDshHomeEnv({ isPackaged: app.isPackaged });
  setRenderHintsSource(detectGpuTier(app).then((tier) => {
    dsh.log(`显卡：${tier.device || '未知'}（${tier.reason}）${tier.lowPower ? '，默认关闭重渲染特效' : ''}`, 'app');
    return tier;
  }));
  if (homeEnv.dropped) {
    dsh.log(`忽略继承的 DSHD_HOME=${homeEnv.value}（packaged 下需要 DSHD_ALLOW_ENV_HOME=1）`, 'app');
  }
  const desktopHome = setDesktopDshHome(desktopDshHomeFromUserData(app.getPath('userData')));
  fs.mkdirSync(desktopHome, { recursive: true });

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
      onEnabledChange: () => require('./tray').refreshTrayMenu(),
    });
    getLive2dPet()?.show();
  }
  await yieldTurn();
  fs.mkdirSync(config.workspace, { recursive: true });
  saveConfig({ workspace: config.workspace });
  app.setLoginItemSettings({ openAtLogin: Boolean(config.openAtLogin) });
  setGithubTokenProvider(() => loadConfig().githubToken);
  setUpdateRouteProvider(() => loadConfig().downloadRoute);

  startDesktopInstallControl({
    installPlugin: (/** @type {any} */ spec, /** @type {Record<string, any>} */ options) => installPlugin(spec, {
      ...options,
      token: loadConfig().githubToken,
    }),
    startHarness: restartWithCleanup,
    confirmModelAction,
    showSecret: showDesktopSecret,
    // The /desktop/* half of the control channel: dsh-whale's management
    // tools reach the same profile-ops implementation as the IPC surface,
    // so config writes and plugin toggles share one serialized align
    // chain no matter which surface asked.
    desktop: {
      project: (/** @type {any} */ payload) => projectEnvironment.dispatch(payload),
      htmlPreview: (/** @type {any} */ input, /** @type {any} */ signal) => require('./html-preview').captureHtmlPreview(input, signal),
      state: () => {
        const configNow = loadConfig();
        const listed = listInstalledPlugins();
        return {
          ok: true,
          version: currentVersion(),
          kernel: dshKernelState(dsh),
          plugins: (listed.plugins || []).map((/** @type {any} */ row) => row.name),
          disabledPlugins: Array.isArray(configNow.disabledPlugins) ? configNow.disabledPlugins : [],
          config: publicConfig(configNow),
        };
      },
      listMarketplace: async (/** @type {Record<string, any>} */ options = {}) => {
        const payload = await listMarketplace({
          refresh: options.refresh === true,
          locale: loadConfig().locale === 'en' ? 'en' : 'zh',
        });
        const q = String(options.q ?? '').trim().toLowerCase();
        if (!q || !Array.isArray(payload?.items)) return payload;
        return {
          ...payload,
          items: payload.items.filter((/** @type {any} */ item) =>
            `${item.id} ${item.description} ${item.packageName} ${item.category}`
              .toLowerCase()
              .includes(q)),
        };
      },
      applyConfig: (/** @type {any} */ patch) => {
        try {
          const next = applyRendererConfigPatch(patch, /** @type {Record<string, any>} */ ({
            app,
            applyAppTheme,
            harness,
            startHarness: restartWithCleanup,
            log: (/** @type {string} */ line) => dsh.log(line, 'app'),
            onConfigChanged: (/** @type {Record<string, any>} */ updated) => state.approvalMonitor?.syncConfig(updated),
          }));
          return { ok: true, config: publicConfig(next) };
        } catch (error) {
          return { ok: false, error: String(/** @type {any} */ (error)?.message ?? error) };
        }
      },
      petSettings: () => {
        const pet = getLive2dPet();
        if (!pet) return { ok: false, error: 'whale settings are unavailable' };
        return { ok: true, settings: pet.getSettings(), enabled: Boolean(loadConfig().live2dPet?.enabled) };
      },
      applyPetSettings: (/** @type {any} */ patch) => {
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
      installCatalog: (/** @type {any} */ id, /** @type {Record<string, any>} */ options = {}) => recordMarketplaceOperation('install', id, (/** @type {any} */ record) => (
        installMarketplacePlugin(id, {
          allowBuilds: Array.isArray(options.allowBuilds) ? options.allowBuilds : [],
          token: loadConfig().githubToken,
          onProgress: record,
        })
      )),
      removePlugin: async (/** @type {any} */ name) => {
        const guardError = pluginRemoveGuardError(name);
        if (guardError) {
          return { ok: false, error: guardError };
        }
        return recordMarketplaceOperation('uninstall', name, (/** @type {any} */ record) => (
          uninstallPlugin(name, { onProgress: record })
        ));
      },
      disablePlugins: (/** @type {any} */ names) => disablePlugins(names, /** @type {any} */ ({ dsh, startHarness: restartWithCleanup })),
      enablePlugin: (/** @type {any} */ name) => enablePlugin(name, /** @type {any} */ ({ dsh, startHarness: restartWithCleanup })),
    },
  });
  try {
    await desktopInstallReady();
  } catch (error) {
    stopDesktopInstallControl();
    dsh.log(`桌面安装控制通道启动失败：${/** @type {any} */ (error).message || String(error)}`, 'error');
  }
  lastYieldAt = Date.now();
  // Slim-launcher handshake endpoint: publishing the peer file lets a
  // launcher-driven install/stop run through task protection instead of
  // touching the process directly.
  taskControlPeer.start()
    .then((/** @type {any} */ result) => {
      if (result.ok === false) {
        dsh.log(`任务保护握手端点启动失败：${result.error || 'unknown'}`, 'error');
      }
    })
    .catch((/** @type {any} */ error) => {
      dsh.log(`任务保护握手端点启动失败：${error.message || String(error)}`, 'error');
    });

  await yieldTurn();
  if (!isLauncherPackage()) {
    const { createDesktopUpdateCenter } = require('./update-center');
    state.updateCenter = createDesktopUpdateCenter(/** @type {any} */ ({
      app, loadConfig, saveConfig, taskProtection, log: (/** @type {string} */ line) => dsh.log(line, 'app'),
    }));
  }
  await yieldTurn();
  const { registerIpc } = require('./ipc');
  state.desktopResources = registerIpc(/** @type {any} */ ({
    updateCenter: state.updateCenter,
    openUpdateCenter,
    dsh,
    harness,
    startHarness: restartWithCleanup,
    reloadPage: reloadWithCleanup,
    startDesktop: startDesktopFromLauncher,
    stopDesktopCleanup: cleanupDesktopResources,
    remote,
    getLive2dPet,
    onConfigChanged: (/** @type {Record<string, any>} */ updated) => state.approvalMonitor?.syncConfig(updated),
    onOpenLauncher: async (/** @type {Record<string, any>} */ options = {}) => {
      await openLauncher();
      // Boot-page bridge: land on the home tab so the Recovery Board is
      // in view (same show-tab path the failed-start flow uses).
      if (options && options.tab) {
        sendToLauncher('shell:show-tab', { tab: options.tab });
      }
    },
  }));
  await yieldTurn();
  const { installShortcutService, getShortcutService } = require('./shortcuts');
  installShortcutService({
    ipcMain,
    userData: app.getPath('userData'),
    platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    getView: () => getHarnessView() ?? undefined,
    getWindow: () => getMainWindow(),
    getOrigin: () => getHarnessOrigin(),
    overlayInput: (/** @type {any} */ win) => ({ revision: 0, blocked: Boolean(win) && state.closingOverlayActive }),
    onMenuChanged: () => rebuildMenu(),
  });
  const existingView = getHarnessView();
  if (existingView) getShortcutService().attach(existingView);
  const { buildMenu } = require('./menu');
  const rebuildMenu = () => buildMenu({
    onOpenWorkspace: () => ignoreFailure(pickWorkspace()),
    onOpenLauncher: () => ignoreFailure(openLauncher()),
    onRestart: () => ignoreFailure(restartWithCleanup()),
    onReload: () => ignoreFailure(reloadWithCleanup()),
    shortcuts: getShortcutService(),
  });
  rebuildMenu();
  await yieldTurn();
  const { createTray, refreshTrayMenu } = require('./tray');
  createTray(/** @type {any} */ ({
    onShow: showForeground,
    onOpenLauncher: () => ignoreFailure(openLauncher()),
    ...(state.updateCenter ? {
      updateLabel: () => {
        const view = state.updateCenter.snapshot();
        return view.phase === 'ready' && view.target ? `安装 v${view.target.version} 并重启…` : '检查更新…';
      },
      onUpdate: () => openUpdateCenter(),
    } : {}),
    onRestart: () => ignoreFailure(restartWithCleanup()),
    onQuit: () => quitApp(),
    ...(DESKTOP_PET_FEATURE ? {
      petEnabled: () => getDesktopPet()?.isEnabled() === true,
      onPetToggle: (/** @type {boolean} */ enabled) => {
        const pet = getDesktopPet();
        const win = getMainWindow();
        pet?.setEnabled(enabled, isHarnessLoaded(win) ? win : null);
      },
    } : LIVE2D_PET_FEATURE ? {
      petEnabled: () => getLive2dPet()?.isEnabled() === true,
      onPetToggle: (/** @type {boolean} */ enabled) => {
        getLive2dPet()?.setEnabled(enabled);
      },
    } : {}),
  }));

  installApprovalMonitor(state, dsh);
  watchSystemTheme();
  await yieldTurn();

  // In-app update indicator backend (upstream dshDesktop.updates): the Web
  // chip reads status() and open() joins the shell-owned check→confirm→
  // install flow — identical gates to the launcher ask.
  const { createUpdatesState } = require('./updates-state');
  const updatesState = createUpdatesState({ onOpen: openDesktopUpdate });
  if (state.updateCenter) {
    let lastPhase = '';
    const { registerUpdateCenterIpc } = require('./update-center/ipc');
    const { ipcSenderRole } = require('./ipc-authorization');
    registerUpdateCenterIpc({
      ipcMain,
      center: state.updateCenter,
      centerWindow: updateCenterWindow,
      releaseNotes: require('../shared/release-notes'),
      authorize: (/** @type {any} */ event) => ipcSenderRole(event),
      parentFor: (/** @type {any} */ role) => (role === 'launcher' ? getLauncherWindow() : getMainWindow()) || getLauncherWindow(),
      surfaces: () => [getLauncherWindow()?.webContents, getHarnessWebContents(getMainWindow())],
      onPresentation: (/** @type {any} */ presentation) => {
        updatesState.present(presentation);
        const wc = getHarnessWebContents(getMainWindow());
        if (wc) updatesState.broadcast([wc]);
        const phase = state.updateCenter.snapshot().phase;
        if (phase !== lastPhase) {
          refreshTrayMenu();
          // A finished background download is announced once; an open
          // update center already shows it.
          const anchor = getMainWindow() || getLauncherWindow();
          if (phase === 'ready' && lastPhase && !updateCenterWindow.webContents && anchor && !anchor.isDestroyed()) {
            updateReadyAttention.ready(String(presentation.version || 'update'), anchor, null, () => openUpdateCenter());
          }
          lastPhase = phase;
        }
      },
    });
    state.updateCenter.start();
  } else {
    setUpdateStateSink((/** @type {any} */ updateState) => {
      updatesState.publish(updateState);
      const wc = getHarnessWebContents(getMainWindow());
      if (wc) updatesState.broadcast([wc]);
    });
  }
  await yieldTurn();

  // Sidebar browser guests (upstream webview model): lease-checked
  // will-attach-webview, per-workspace locked-down partitions, Host origin
  // unreachable from guests.
  const { BrowserGuests, installBrowserGuests } = require('./browser-guests');
  installBrowserGuests(new BrowserGuests(() => getHarnessOrigin()), {
    ipcMain,
    getView: () => getHarnessView(),
    getOrigin: () => getHarnessOrigin(),
  });

  // Embedded Platform documents (usage/top-up): an isolated WebContentsView
  // child with account-scoped partitions and main-owned credential header
  // injection. Session snapshots arrive from the loopback publisher route.
  const { DesktopPlatformView } = require('./platform-view');
  const { fetchPlatformSession } = require('./platform-session');
  const { registerPlatformIpc } = require('./platform-ipc');
  state.platformView = new DesktopPlatformView(
    require('node:path').join(__dirname, '..', 'preload', 'platform.js'),
    () => getWelcomeLocaleId() === 'zh-CN' ? 'zh_CN' : 'en_US',
    process.platform === 'win32' ? 'win32' : 'darwin',
    welcomeClientMetadata,
  );
  state.platformSessionRefresh = async () => {
    try {
      state.platformView?.setSession(await fetchPlatformSession(getHarnessOrigin()));
    } catch {
      // Loopback failures leave the last session; open() refetches.
    }
  };
  registerPlatformIpc({
    ipcMain,
    platformView: state.platformView,
    refreshSession: () => state.platformSessionRefresh?.(),
    getHarnessView,
    getHarnessOrigin,
    getMainWindow,
    nativeTheme,
  });

  // Microphone stays scoped to the owned harness main frame, audio only
  // (upstream microphone-permissions policy, adapted to the loopback origin).
  const { installMediaPermissions } = require('./media-permissions');
  installMediaPermissions(session.defaultSession, () => {
    const view = getHarnessView();
    return view && !view.webContents.isDestroyed() ? view.webContents : undefined;
  }, systemPreferences);

  const { pruneCrashReports } = require('./crash-report');
  void pruneCrashReports(crashLogDir()).catch((error) => console.warn('dshd: crash report prune failed', error));

  const { createDownloadCollisionHandler } = require('./download-path');
  session.defaultSession.on('will-download', createDownloadCollisionHandler(app));

  await yieldTurn();
  const launcherWin = await prepareLauncher();
  bindLauncherClose(launcherWin);
  const startupOptions = { activate: !state.backgroundStartup };
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
      if (!state.updateCenter) void checkUpdate();
    } else {
      await runColdStartGate(startupOptions);
    }
  } finally {
    state.backgroundStartup = false;
  }
}

module.exports = { runAppReady };
