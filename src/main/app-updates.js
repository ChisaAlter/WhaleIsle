'use strict';

const { app } = require('electron');
const { pathToFileURL } = require('node:url');
const { loadConfig } = require('./config');
const { checkUpdate, updateDownloadMethods, currentVersion } = require('./update');
const { plainReleaseNotes, releaseNotesTabs } = require('../shared/release-notes');
const { isLauncherPackage } = require('../launcher/product');
const runtimeInstall = require('../launcher/runtime-install');
const {
  runColdStartGate: runLauncherColdStartGate,
  createParkedUpdateDrainer,
  presentUpdateAsk,
} = require('./launcher-gate');
const { recoverInterruptedImport, readImportJournal, journalIsBlocked } = require('./data-import');
const { UpdateAttention } = require('./update-attention');
const { UpdateCenterWindow } = require('./update-center/ipc');
const { currentTheme } = require('./chrome');
const { rendererFile } = require('./paths');
const { getMainWindow, getLauncherWindow, sendToLauncher } = require('./window');

/**
 * Update-facing startup phase extracted from index.js (#439 P3-4): the update
 * attention/notification backend, the shell-anchored update center window,
 * ask options, the slim-package cold-start gate wiring, the parked late
 * update check drainer, and the desktop `dshDesktop.updates.open()` entry.
 * Behavior unchanged; mutable entry state and cross-phase collaborators
 * arrive as explicit deps.
 *
 * @param {object} deps
 * @param {import('./app-shell-state').ShellState} deps.state
 * @param {{ log: (line: string, level?: string) => void }} deps.dsh
 * @param {import('./update-overlay').UpdateOverlays} deps.shellOverlays
 * @param {() => import('./update-dialog').ShellConfirmDialog} deps.shellConfirm
 * @param {(parent: any, options: Record<string, any>) => Promise<any>} deps.confirmDialog
 * @param {(options?: Record<string, any>) => Promise<any>} deps.openLauncher
 * @param {() => void} deps.showForeground
 * @param {(options?: Record<string, any>) => Promise<any>} deps.startDesktopFromLauncher
 */
function createUpdateFlow({
  state,
  dsh,
  shellOverlays,
  shellConfirm,
  confirmDialog,
  openLauncher,
  showForeground,
  startDesktopFromLauncher,
}) {
  const updateAttention = new UpdateAttention({
    title: '发现新版本',
    body: '新版本可用，回到窗口查看更新说明。',
  });

  /**
   * @param {any} win
   */
  function returnToUpdateConfirmation(win) {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    shellConfirm().focus();
  }

  const updateReadyAttention = new UpdateAttention({
    title: '新版本已准备好',
    body: '新版本已在后台下载完成，点击安装并重启。',
  });
  const updateCenterWindow = new UpdateCenterWindow({
    overlays: shellOverlays,
    preload: require('node:path').join(__dirname, '..', 'preload', 'update-center.js'),
    page: pathToFileURL(rendererFile('update-center.html')).href,
    theme: () => currentTheme(),
    isMaximized: (win) => require('./chrome').isEffectivelyMaximized(win),
  });

  const MAX_OPEN_UPDATE_CENTER_ATTEMPTS = 20;

  /**
   * Open the update center over `parent`, or the first visible shell window.
   * @param {any} [parent]
   * @param {number} [attempts]
   */
  function openUpdateCenter(parent, attempts = 0) {
    if (state.quitting || state.stoppingForQuit) return;
    const target = [parent, getMainWindow(), getLauncherWindow()]
      .find((win) => win && !win.isDestroyed() && win.isVisible());
    if (!target) {
      if (attempts >= MAX_OPEN_UPDATE_CENTER_ATTEMPTS) return;
      showForeground();
      const timer = setTimeout(() => openUpdateCenter(undefined, attempts + 1), 300);
      timer.unref?.();
      return;
    }
    updateCenterWindow.open(target);
  }

  // Keep the full release notes in the update dialog's reading region.
  /**
   * @param {Record<string, any>} check
   */
  function updateAskDetail(check) {
    return plainReleaseNotes(check?.notes) || '该版本未提供更新说明。';
  }

  /**
   * @param {Record<string, any>} check
   */
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
      detail: updateAskDetail(check), detailTabs: releaseNotesTabs(check?.notes), downloadMethods, noLink: true,
    };
  }

  // Slim-package cold start talks to the managed runtime: route-aware checks,
  // installs that keep the launcher alive, and external process start.
  /**
   * @param {any} onProgress
   * @param {Record<string, any>} check
   */
  function gateInstallUpdate(onProgress, check) {
    return state.desktopResources.launcher.installUpdate(onProgress, {
      confirmUnverified: confirmUnverifiedColdStart,
      expectedCheck: check,
      downloadMode: check?.downloadMode,
    });
  }

  /**
   * Cold-start twin of the ipc.js unverified-install confirmation.
   * @param {any} info
   * @param {any} [parent]
   */
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

  /**
   * @param {Record<string, any>} [options]
   */
  function runColdStartGate(options = {}) {
    const userDataDir = app.getPath('userData');
    const launcherPackage = isLauncherPackage();
    return runLauncherColdStartGate({
      config: loadConfig(),
      userDataDir,
      isPackaged: app.isPackaged,
      // The update center checks and downloads in the background; the cold
      // start never waits for or asks about updates in the desktop package.
      checkUpdate: launcherPackage
        ? () => runtimeInstall.checkDesktopUpdate()
        : async () => ({ status: 'none' }),
      installUpdate: gateInstallUpdate,
      confirmUpdate: async (/** @type {any} */ check) => {
        const win = getLauncherWindow();
        if (win && !win.isDestroyed() && !win.isFocused()) {
          updateAttention.ready(String(check.latest || check.version || 'update'), win, shellConfirm().window,
            () => returnToUpdateConfirmation(win));
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
      log: /** @type {any} */ ((/** @type {any} */ line, /** @type {any} */ level) => dsh.log(line, level)),
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
    isQuitting: () => state.quitting || state.stoppingForQuit,
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
      confirmUpdate: async (/** @type {any} */ pending) => {
        const win = getLauncherWindow();
        if (win && !win.isDestroyed() && !win.isFocused()) {
          updateAttention.ready(String(pending.latest || pending.version || 'update'), win, shellConfirm().window,
            () => returnToUpdateConfirmation(win));
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
        if (state.quitting || state.stoppingForQuit) return false;
        const win = getLauncherWindow();
        return Boolean(win && win.isVisible() && (generation === undefined || generation === win));
      },
    }),
  });

  /**
   * `dshDesktop.updates.open()`: the update center over the main window. The
   * slim launcher package keeps the legacy check→confirm→install flow.
   */
  async function openDesktopUpdate() {
    if (state.updateCenter) {
      openUpdateCenter(getMainWindow());
      return;
    }
    const win = getMainWindow();
    const info = await checkUpdate();
    if (info.status === 'available') {
      const ask = await confirmDialog(win, await updateAskOptions(info));
      if (ask.response !== 0) return;
      const result = await state.desktopResources.launcher.installUpdate(() => {}, {
        confirmUnverified: (/** @type {any} */ unverified) => confirmUnverifiedColdStart(unverified, win),
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

  return {
    updateAttention,
    updateReadyAttention,
    updateCenterWindow,
    openUpdateCenter,
    updateAskOptions,
    gateInstallUpdate,
    confirmUnverifiedColdStart,
    runColdStartGate,
    drainParkedUpdateCheck,
    openDesktopUpdate,
  };
}

module.exports = { createUpdateFlow };
