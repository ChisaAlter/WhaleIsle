'use strict';

// Slim launcher package entry. This process never loads the harness/vendor
// runtime: the desktop app is a separately installed product this launcher
// downloads, installs, updates, starts, and probes. Only the launcher window
// and the launcher IPC surface exist here.

const { app, dialog, Notification } = require('electron');
// Select the discrete GPU before Chromium initializes any rendering contexts.
app.commandLine.appendSwitch('force_high_performance_gpu');
const { systemNotificationsSupported } = require('../main/system-notifications');
const { LAUNCHER_NAME, LEGACY_LAUNCHER_USER_DATA, preserveUserDataPath } = require('../shared/product-identity');
preserveUserDataPath(app, LEGACY_LAUNCHER_USER_DATA);
app.setName(LAUNCHER_NAME);

const fs = require('fs');
const path = require('path');

// Packaged GUI processes have no console: fatal failures must leave a trace.
let trace = () => {};
try {
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'main.log');
  const write = (line) => {
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } catch {}
  };
  trace = write;
  let fatalReported = false;
  process.on('uncaughtException', (error) => {
    write(`uncaughtException: ${error && error.stack ? error.stack : error}`);
    // A log-only handler would leave a window-less zombie: fail visible.
    if (fatalReported) {
      app.exit(1);
      return;
    }
    fatalReported = true;
    try {
      dialog.showErrorBox('启动器发生错误', String(error && error.message ? error.message : error));
    } catch {}
    app.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    write(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
  });
} catch {}
const { getLauncherWindow, prepareLauncher, showLauncher, sendToLauncher } = require('../main/window');
const { watchSystemTheme } = require('../main/chrome');
const { loadConfig, saveConfig } = require('../main/config');
const { hideOnClose } = require('../main/close-behavior');
const ipcComponents = require('../main/ipc-components');
const { createLauncherTray } = require('./tray');
const { desktopStateDir } = require('../launcher/product');
const {
  setDesktopDshHome,
  sanitizePackagedDshHomeEnv,
} = require('../shared/dsh-home');
const { recoverInterruptedImport } = require('../main/data-import');
const runtimeInstall = require('../launcher/runtime-install');
const {
  runColdStartGate,
  createParkedUpdateDrainer,
  presentUpdateAsk,
} = require('../main/launcher-gate');
const { registerSlimIpc } = require('./ipc');
const { createLauncherConfirm } = require('../launcher/launcher-confirm');

let quitting = false;
let tray = null;

// Launcher-owned confirmations (update ask, unverified installer) render as
// the renderer's app-confirm card via this bridge; a null answer falls back
// to the native messagebox so a dead window can never silently authorize.
const launcherConfirm = createLauncherConfirm({ getWindow: getLauncherWindow });

function quitApp() {
  quitting = true;
  app.quit();
}

// Close hides to the tray (A5): supervised components keep running while the
// window is hidden, and before-quit is still what tears them down on a real
// quit. If the tray could not be created we must not strand a windowless
// process — fall through to the default close.
function supervisedComponentsLabel() {
  try {
    const snap = ipcComponents.contributeStatus()?.components;
    const running = Array.isArray(snap) ? snap.filter((c) => c.state === 'running').length : 0;
    return running > 0 ? `组件运行中：${running} 个` : '无组件运行';
  } catch {
    return undefined;
  }
}

function bindLauncherClose(win) {
  win.on('close', (event) => {
    if (quitting || !tray || !hideOnClose(loadConfig(), quitting)) {
      return;
    }
    event.preventDefault();
    win.hide();
    // First hide only: explain where the window went. Persisted under the
    // launcher config; written via saveConfig (not the renderer whitelist).
    try {
      if (!loadConfig().trayHintShown && systemNotificationsSupported(Notification)) {
        new Notification({
          title: '已最小化到托盘',
          body: '双击托盘图标可重新打开启动器；从托盘菜单可完全退出。',
        }).show();
        saveConfig({ trayHintShown: true });
      }
    } catch (error) {
      trace(`tray hint failed: ${error && error.message ? error.message : error}`);
    }
  });
}

async function confirmUnverified(info) {
  const message = `版本 ${info?.tag || info?.latest || ''} 未提供 SHA512SUMS.txt 校验清单，无法验证安装包完整性。仍要下载并安装吗？`;
  const bridged = await launcherConfirm.ask({
    title: '安装包无法校验',
    body: message,
    confirmText: '仍要安装',
    cancelText: '取消',
    danger: true,
  });
  if (bridged !== null) {
    return bridged;
  }
  const result = await dialog.showMessageBox(getLauncherWindow() || undefined, {
    type: 'warning',
    buttons: ['仍要安装', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: '安装包无法校验',
    message,
    noLink: true,
  });
  return result.response === 0;
}

async function confirmUpdateAsk(check) {
  const notes = typeof check?.notes === 'string' ? check.notes.trim() : '';
  const body = `是否更新到 ${check.latest || check.version || ''}？`
    + (notes ? `\n\n${notes.length > 600 ? `${notes.slice(0, 600)}…` : notes}` : '');
  const bridged = await launcherConfirm.ask({
    title: '发现新版本',
    body,
    confirmText: '更新',
    cancelText: '稍后',
  });
  if (bridged !== null) {
    return bridged;
  }
  const result = await dialog.showMessageBox(getLauncherWindow() || undefined, {
    type: 'question',
    buttons: ['更新', '稍后'],
    defaultId: 0,
    cancelId: 1,
    title: '发现新版本',
    message: `是否更新到 ${check.latest || check.version || ''}？`,
    detail: notes ? (notes.length > 600 ? `${notes.slice(0, 600)}…` : notes) : undefined,
    noLink: true,
  });
  return result.response === 0;
}

// The cold-start install path is the runtime install lane: the launcher
// stays alive, the installer runs elevated, and the registration settles by
// polling rather than by this process quitting.
function gateInstallUpdate(onProgress, check) {
  return runtimeInstall.installRuntime(
    check && check.tag ? { tag: check.tag } : {},
    onProgress,
    { confirmUnverified },
  );
}

function launcherVisible() {
  const win = getLauncherWindow();
  return Boolean(win && !win.isDestroyed() && win.isVisible());
}

async function openLauncher() {
  const win = await showLauncher();
  void drainParkedUpdateCheck.drain({ generation: win });
  return win;
}

const drainParkedUpdateCheck = createParkedUpdateDrainer({
  readConfig: () => loadConfig(),
  isVisible: launcherVisible,
  isQuitting: () => quitting,
  isCurrentGeneration: (generation) => (
    generation === undefined || (getLauncherWindow() === generation && launcherVisible())
  ),
  log: (message) => console.error(`[launcher] ${message}`),
  present: (check, { generation }) => presentUpdateAsk({
    config: loadConfig(),
    isPackaged: app.isPackaged,
    check,
    confirmUpdate: confirmUpdateAsk,
    installUpdate: gateInstallUpdate,
    openLauncher,
    sendToLauncher,
    alreadyVisible: true,
    shouldContinue: () => {
      if (quitting) return false;
      const win = getLauncherWindow();
      return Boolean(win && win.isVisible() && (generation === undefined || generation === win));
    },
  }),
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void openLauncher();
  });

  app.on('before-quit', () => {
    quitting = true;
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  app.whenReady().then(async () => {
    trace('whenReady');
    const homeEnv = sanitizePackagedDshHomeEnv({ isPackaged: app.isPackaged });
    if (homeEnv.dropped) {
      console.error(`[launcher] 忽略继承的 DSHD_HOME=${homeEnv.value}（packaged 下需要 DSHD_ALLOW_ENV_HOME=1）`);
    }
    // The launcher keeps its own userData (own config + own single-instance
    // lock); dsh-home, the plugin profiles and the import/last-start journal
    // are the runtime's state, so they point at the desktop home explicitly.
    const desktopDir = desktopStateDir(app);
    fs.mkdirSync(setDesktopDshHome(path.join(desktopDir, 'dsh-home')), { recursive: true });
    trace(`dsh-home=${path.join(desktopDir, 'dsh-home')}`);

    // Window chrome IPC binds inside attachIntegratedChrome on window create.
    watchSystemTheme({});
    registerSlimIpc({ launcherConfirm });
    trace('ipc-registered');

    const win = await prepareLauncher();
    trace('launcher-prepared');
    try {
      tray = createLauncherTray({
        onShow: () => void openLauncher(),
        onQuit: quitApp,
        toolTip: '鲸屿启动器',
        statusLabel: supervisedComponentsLabel,
      });
    } catch (error) {
      trace(`tray create failed: ${error && error.stack ? error.stack : error}`);
    }
    bindLauncherClose(win);
    // A visible launcher is the only surface allowed to consume a parked
    // late update check.
    win.on('show', () => {
      void drainParkedUpdateCheck.drain({ generation: win });
    });

    await runColdStartGate({
      config: loadConfig(),
      userDataDir: desktopDir,
      isPackaged: app.isPackaged,
      checkUpdate: () => runtimeInstall.checkDesktopUpdate(),
      confirmUpdate: confirmUpdateAsk,
      installUpdate: gateInstallUpdate,
      openLauncher,
      sendToLauncher,
      recoverInterruptedImport: () => recoverInterruptedImport({ userDataDir: desktopDir }),
      startDesktop: () => runtimeInstall.startExternalDesktop(),
      drainParkedUpdateCheck: () => drainParkedUpdateCheck.drain({ generation: getLauncherWindow() }),
      log: (line, level) => {
        trace(`gate:${line}`);
        (level === 'error' ? console.error : console.log)(`[launcher] ${line}`);
      },
    });
    trace('gate-done');
  }).catch((error) => {
    trace(`whenReady chain failed: ${error && error.stack ? error.stack : error}`);
    // Never strand a hidden window-less process: tell the user and exit.
    try {
      dialog.showErrorBox('启动器初始化失败', String(error && error.message ? error.message : error));
    } catch {}
    app.exit(1);
  });
}
