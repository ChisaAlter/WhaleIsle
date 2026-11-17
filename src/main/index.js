const { app, safeStorage } = require('electron');
app.commandLine.appendSwitch('force_high_performance_gpu');
// WebCodecs crash reports need JS call stacks in the crash dump.
app.commandLine.appendSwitch('enable-features', 'DocumentPolicyIncludeJSCallStacksInCrashReports');
const { PRODUCT_NAME, LEGACY_DESKTOP_USER_DATA, preserveUserDataPath } = require('../shared/product-identity');
preserveUserDataPath(app, LEGACY_DESKTOP_USER_DATA);
const { loadConfig, saveConfig, REMOTE_FEATURE_ENABLED, parkRemoteSnapshot, normalizeRemotePatch } = require('./config');
const { DshManager } = require('./dsh');
const { DshdRemote, resolveDesktopChisaCodeHome } = require('./dshd-remote');
const git = require('./git');
const { invokeTrayAction } = require('./tray');
const {
  onHarnessOriginChange,
  getHarnessOrigin,
  getHarnessWebContents,
  getMainWindow,
  showMain,
} = require('./window');
const { createMainFailureReporter } = require('./crash-report');
const { qaFlag, qaRemoteMode: readRemoteMode } = require('./qa-gate');
const { createProjectEnvironment } = require('./project-environment');
const { createProactiveService } = require('./proactive/service');
const { createGitHubApiSource } = require('./proactive/github-source');
const { createShellState } = require('./app-shell-state');
const { createShellDialogs } = require('./app-dialogs');
const { createAppWindows } = require('./app-windows');
const { createDesktopAccount } = require('./app-account');
const { createAppHarness } = require('./app-harness');
const { createAppLifecycle } = require('./app-lifecycle');
const { createUpdateFlow } = require('./app-updates');
const { registerAppEvents } = require('./app-events');
const { runAppReady } = require('./app-ready');

/**
 * Packaged-gated QA flag (see qa-gate.js).
 * @param {string} name
 */
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
installUncaughtBrokenPipeGuard({
  log: (message) => dsh.log(message, 'app'),
  // An uncaught error is never answered with a native error box: it lands in the
  // log and in a crash report file next to the renderer ones.
  report: createMainFailureReporter({
    directory: () => crashLogDir(),
    isReady: () => app.isReady(),
    describeApp: () => ({
      name: 'Whale Isle',
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron || '',
      node: process.versions.node || '',
      locale: app.isReady() ? app.getLocale() : '',
    }),
  }),
});
// Product remote = full ChisaCode daemon + offer v2 (not HTTP RemoteGateway).
const remote = new DshdRemote(/** @type {any} */ ({
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
  log: (/** @type {string} */ line) => dsh.log(line, 'app'),
  getHarnessOrigin,
  getSessionCookie: () => dsh.sessionCookie || '',
  git,
}));

onHarnessOriginChange((/** @type {any} */ origin) => {
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

/**
 * @param {any} patch
 */
async function setRemoteFromQa(patch) {
  saveConfig(normalizeRemotePatch(patch || {}));
  if (remote && typeof remote.sync === 'function') {
    return remote.sync();
  }
  return remote && typeof remote.snapshot === 'function' ? remote.snapshot() : null;
}

const state = createShellState();

function quitApp() {
  if (state.quitInProgress) return;
  if (qaEnv('DSH_QA_SHELL') && process.env.DSH_QA_ALLOW_QUIT !== '1') {
    state.qaQuitIntercepted = true;
    console.log('[DSH_QA_SHELL] quit intercepted');
    return;
  }
  state.quitting = true;
  app.quit();
}

/**
 * @param {any} promise
 */
function ignoreFailure(promise) {
  Promise.resolve(promise).catch((error) => {
    dsh.log(error.message || String(error), 'error');
  });
}

/** Fatal crash reports live with the app's own logs, outside the install dir. */
function crashLogDir() {
  return require('node:path').join(app.getPath('logs'), 'crash');
}

const dialogs = createShellDialogs();
const account = createDesktopAccount({ state, dsh });
const windows = createAppWindows({
  state,
  quitApp,
  isDesktopKernelRunning: () => lifecycle.isDesktopKernelRunning(),
  drainParkedUpdateCheck: { drain: (options) => updates.drainParkedUpdateCheck.drain(options) },
});
const harness = createAppHarness({
  state,
  dsh,
  remote,
  createMainWindow: windows.createMainWindowWithClose,
  initializeDesktopAccount: account.initializeDesktopAccount,
});
const lifecycle = createAppLifecycle({
  state,
  dsh,
  harness,
  quitApp,
  openLauncher: windows.openLauncher,
  confirmTaskStop: dialogs.confirmTaskStop,
});
const updates = createUpdateFlow({
  state,
  dsh,
  shellOverlays: dialogs.shellOverlays,
  shellConfirm: dialogs.shellConfirm,
  confirmDialog: dialogs.confirmDialog,
  openLauncher: windows.openLauncher,
  showForeground: windows.showForeground,
  startDesktopFromLauncher: lifecycle.startDesktopFromLauncher,
});
const projectEnvironment = createProjectEnvironment({ getGithubToken: () => loadConfig().githubToken });
const proactiveService = createProactiveService(/** @type {any} */ ({
  userDataPath: app.getPath('userData'),
  githubSource: /** @type {any} */ (createGitHubApiSource(/** @type {any} */ ({
    repository: process.env.WHALEISLE_GITHUB_REPOSITORY || 'ChisaAlter/WhaleIsle',
    tokenProvider: () => loadConfig().githubToken,
  }))),
}));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error(`${PRODUCT_NAME} is already running. Quit the installed app before npm start (same appId single-instance lock).`);
  app.quit();
} else {
  registerAppEvents({ state, showForeground: windows.showForeground, log: message => dsh.log(message, 'app') });

  app.setName(PRODUCT_NAME);
  app.setAppUserModelId('ai.deepseek.harness.gui');

  app.whenReady().then(async () => {
    await runAppReady({
      state,
      dsh,
      harness,
      remote,
      crashLogDir,
      ignoreFailure,
      quitApp,
      projectEnvironment,
      proactiveService,
      openLauncher: windows.openLauncher,
      bindLauncherClose: windows.bindLauncherClose,
      showForeground: windows.showForeground,
      startDesktopFromLauncher: lifecycle.startDesktopFromLauncher,
      restartWithCleanup: lifecycle.restartWithCleanup,
      reloadWithCleanup: lifecycle.reloadWithCleanup,
      cleanupDesktopResources: lifecycle.cleanupDesktopResources,
      pickWorkspace: lifecycle.pickWorkspace,
      taskProtection: lifecycle.taskProtection,
      taskControlPeer: lifecycle.taskControlPeer,
      openUpdateCenter: updates.openUpdateCenter,
      openDesktopUpdate: updates.openDesktopUpdate,
      runColdStartGate: updates.runColdStartGate,
      updateCenterWindow: updates.updateCenterWindow,
      updateReadyAttention: updates.updateReadyAttention,
      confirmModelAction: dialogs.confirmModelAction,
      showDesktopSecret: dialogs.showDesktopSecret,
      welcomeClientMetadata: account.welcomeClientMetadata,
      getWelcomeLocaleId: account.getWelcomeLocaleId,
    });
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
        getDesktopResources: () => state.desktopResources,
        getQuitIntercepted: () => state.qaQuitIntercepted,
        resetQuitIntercepted: () => { state.qaQuitIntercepted = false; },
      });
      if (!getMainWindow()) {
        await lifecycle.startDesktopFromLauncher();
      }
      if (qaEnv('DSH_REMOTE_PHONE_HOST')) {
        void smoke.keepRemotePhoneHost();
      } else {
        void smoke.runSmoke(getMainWindow());
      }
    }
  });

  lifecycle.registerQuitHandlers();
}
