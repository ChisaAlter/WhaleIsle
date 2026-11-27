'use strict';

const { app, dialog } = require('electron');
const { loadConfig, saveConfig } = require('./config');
const { hideOnClose } = require('./close-behavior');
const {
  getMainWindow,
  sendToLauncher,
  closeLauncherWindow,
  getHarnessWebContents,
} = require('./window');
const {
  shouldCloseLauncherAfterDesktopStart,
  writeLastDesktopStart,
  recordLastDesktopStart,
  kernelLogTail,
} = require('./launcher-gate');
const { readImportJournal, journalIsBlocked } = require('./data-import');
const importGuard = require('./import-guard');
const { createReloadWithCleanup } = require('./desktop-reload');
const { createTaskProtection, installTaskProtection } = require('./task-protection');
const { createTaskControlPeer } = require('./task-control-peer');
const { showClosingOverlay } = require('./closing-overlay');
const { getLive2dPet } = require('./desktop-live2d');
const { destroyTray } = require('./tray');
const { stopDesktopInstallControl } = require('./desktop-install-control');
const { invalidateWorkspaceAuthorities } = require('./workspace-authority');
const { flushBootLogs } = require('../shared/launcher-bridges');

/**
 * Desktop lifecycle phase extracted from index.js (#439 P3-4): the task-
 * protection coordinator and slim-launcher peer, desktop start/restart/reload
 * with their maintenance/import guards, resource teardown, and the quit
 * handlers (before-quit → protected drain → closing overlay → six-way
 * shutdown → native quit; window-all-closed → quit funnel). Behavior
 * unchanged; mutable flags live on the shared shell state.
 *
 * @param {object} deps
 * @param {import('./app-shell-state').ShellState} deps.state
 * @param {import('./dsh').DshManager} deps.dsh
 * @param {import('./harness-controller').HarnessController} deps.harness
 * @param {() => void} deps.quitApp — the shared quit funnel
 * @param {(options?: Record<string, any>) => Promise<any>} deps.openLauncher
 * @param {(operation: string, inspection: Record<string, any>) => Promise<boolean>} deps.confirmTaskStop
 */
function createAppLifecycle({ state, dsh, harness, quitApp, openLauncher, confirmTaskStop }) {
  function isDesktopKernelRunning() {
    const kernelState = typeof dsh.state === 'string' ? dsh.state : dsh.snapshot()?.state;
    return kernelState === 'ready' || kernelState === 'starting';
  }

  // --- Task protection (quit/stop/restart/update) -----------------------------
  // The coordinator inspects Host-side work through the dsh-task-control
  // plugin's loopback route and prompts before any destructive side effect.
  // See docs/features/task-protection.md.
  const taskProtection = createTaskProtection({
    getBaseUrl: () => (typeof dsh.baseUrl === 'string' ? dsh.baseUrl : ''),
    hostRunning: () => isDesktopKernelRunning() && dsh.webReady === true && Boolean(dsh.baseUrl),
    confirm: confirmTaskStop,
    shellWork: () => {
      const count = Number(state.desktopResources && state.desktopResources.pty && typeof state.desktopResources.pty.count === 'function'
        ? state.desktopResources.pty.count() : 0);
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
      // Like quit, an explicit stop proceeds after a short drain even with work
      // still running.
      const result = await taskProtection.coordinate('stop', /** @type {Record<string, any>} */ ({
        terminal: true, preConfirmed: true, force: true, drainTimeoutMs: 10_000,
      }));
      if (!result.proceeded) {
        return { ok: false, code: result.code || 'cancelled' };
      }
      setTimeout(() => quitApp(), 250);
      return { ok: true, quit: true };
    },
    onPeerInstall: async () => {
      // Same explicit-consent rule as onPeerStop: the launcher's install/更新
      // click already authorized replacing the running desktop.
      const result = await taskProtection.coordinate('install', /** @type {Record<string, any>} */ ({
        terminal: true, preConfirmed: true, force: true, drainTimeoutMs: 10_000,
      }));
      if (!result.proceeded) {
        return { ok: false, code: result.code || 'cancelled' };
      }
      // Flush the response before the process starts its protected quit.
      setTimeout(() => quitApp(), 250);
      return { ok: true, quit: true };
    },
  });

  /**
   * @param {Record<string, any>} [options]
   */
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
      writeLastDesktopStart(app.getPath('userData'), { ok: true, skipped: harness.skippedBuiltins });
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
      const thrown = /** @type {any} */ (error);
      const message = thrown && thrown.message ? thrown.message : String(thrown);
      writeLastDesktopStart(app.getPath('userData'), { ok: false, error: message, logTail: kernelLogTail(dsh) });
      await openLauncher(windowOptions);
      sendToLauncher('shell:show-tab', { tab: 'home' });
      sendToLauncher('shell:desktop-failed', { error: message });
      return { ok: false, error: message };
    }
  }

  async function pickWorkspace() {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(/** @type {any} */ (win || undefined), {
      title: '选择工作区',
      defaultPath: loadConfig().workspace,
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const chosen = result.filePaths[0];
    const outcome = await restartWithCleanup(undefined, {
      beforeStart: () => {
        saveConfig({ workspace: chosen });
        invalidateWorkspaceAuthorities?.();
      },
    });
    return outcome && outcome.proceeded === false ? null : chosen;
  }

  /**
   * Tear down desktop-bound child processes and views (PTY, BrowserView).
   * Returns a promise that settles only after the preview close has completed —
   * restart/reload/quit must not proceed while a BrowserView teardown is still
   * in flight, or a raced detach leaves a half-removed view behind.
   * @param {{ stopWatchers?: boolean }} [options]
   */
  async function cleanupDesktopResources(options = {}) {
    if (!state.desktopResources) {
      await flushBootLogs();
      return;
    }
    if (options.stopWatchers || state.stoppingForQuit) {
      try {
        state.desktopResources.stopWorkspaceWatch?.();
      } catch (error) {
        dsh.log(`工作区监听清理失败：${/** @type {any} */ (error).message}`, 'app');
      }
    }
    try {
      await state.desktopResources.pty.killAll();
    } catch (error) {
      dsh.log(`PTY 清理失败：${/** @type {any} */ (error).message}`, 'app');
    }
    await Promise.resolve(state.desktopResources.preview.closeAll()).catch((error) => {
      dsh.log(`预览清理失败：${/** @type {any} */ (error).message}`, 'app');
    });
    await flushBootLogs();
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
   * @param {any} [delegatedToken]
   * @param {Record<string, any>} [rest]
   */
  function restartWithCleanup(delegatedToken, { preConfirmed = false, fullPluginRetry = false, beforeStart, ...options } = {}) {
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
      return taskProtection.coordinate('restart', /** @type {Record<string, any>} */ ({
        preConfirmed,
        commit: async () => {
          if (typeof beforeStart === 'function') await beforeStart();
          invalidateWorkspaceAuthorities?.();
          await cleanupDesktopResources();
          return recordLastDesktopStart(
            app.getPath('userData'),
            () => (fullPluginRetry && typeof harness.retryFullPlugins === 'function' ? harness.retryFullPlugins() : harness.restart(options)),
            () => kernelLogTail(dsh), () => harness.skippedBuiltins);
        },
      })).then((result) => (result.proceeded ? undefined : result))
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

  /**
   * Quit handlers: before-quit starts the protected drain, the commit shows
   * the closing overlay then runs the six-way shutdown, and
   * window-all-closed funnels through quitApp unless the app hides to tray.
   */
  function registerQuitHandlers() {
    app.on('before-quit', (event) => {
      if (state.nativeQuitReady) return;
      if (state.quitInProgress) {
        event.preventDefault();
        return;
      }
      state.quitting = true;
      event.preventDefault();
      void finalizeQuit();
    });

    // Explicit quit is already consent, including when the runtime cannot
    // drain or shut down. Keep cleanup bounded without asking the user again.
    async function finalizeQuit() {
      if (state.quitInProgress) return;
      state.quitInProgress = true;
      /** @type {Promise<unknown>|undefined} */
      let shutdownPromise;
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let shutdownTimer;
      const shutdownForQuit = () => {
        if (!shutdownPromise) {
          state.stoppingForQuit = true;
          shutdownPromise = Promise.allSettled([
            Promise.resolve().then(() => harness.shutdown()),
            Promise.resolve().then(() => cleanupDesktopResources({ stopWatchers: true })),
            Promise.resolve().then(() => state.updateCenter?.stop?.()),
            Promise.resolve().then(() => getLive2dPet()?.dispose()),
            Promise.resolve().then(() => state.approvalMonitor?.dispose()),
            Promise.resolve().then(() => stopDesktopInstallControl()),
            Promise.resolve().then(() => taskControlPeer.stop()),
            Promise.resolve().then(() => taskProtection.cleanupAfterQuit()),
            Promise.resolve().then(() => { if (typeof destroyTray === 'function') destroyTray(); }),
          ]).then((results) => {
            /** @type {any} */
            let failure;
            for (const result of results) {
              if (result.status === 'rejected') {
                failure ||= result.reason;
                dsh.log(`退出：资源关停失败：${result.reason?.message || String(result.reason)}`, 'error');
              }
            }
            if (failure) throw failure;
          });
        }
        return shutdownPromise;
      };
      const runQuitCoordinate = () => taskProtection.coordinate('quit', /** @type {Record<string, any>} */ ({
        terminal: true,
        preConfirmed: true,
        // Quit gives no feedback until the drain ends; a 30 s wait read as
        // an ignored click. Work still running is cleaned up either way.
        drainTimeoutMs: 3000,
        commit: async () => {
          state.stoppingForQuit = true;
          state.closingOverlayActive = true;
          const win = getMainWindow();
          await showClosingOverlay(win, loadConfig().locale,
            getHarnessWebContents(win) || win?.webContents).catch(() => undefined);
          await shutdownForQuit();
          // Keep the current surface until the native window closes.
        },
      }));
      try {
        /** @type {any} */
        let result;
        try {
          const coordinateWithTimeout = async () => {
            clearTimeout(shutdownTimer);
            return Promise.race([
              runQuitCoordinate(),
              new Promise(/** @type {(resolve: (value: any) => void, reject: (reason?: any) => void) => void} */ ((_, reject) => {
                shutdownTimer = setTimeout(() => {
                  /** @type {Error & { code?: string }} */
                  const error = new Error('后台关停未在 30 秒内完成');
                  error.code = 'dshd/shutdown-timeout';
                  reject(error);
                }, 30000);
              })),
            ]);
          };
          result = await coordinateWithTimeout();
          if (!result.proceeded && result.code === 'busy' && result.local === true) {
            const idle = await taskProtection.cancelAndWait?.(5000);
            if (idle !== false) {
              result = await coordinateWithTimeout();
            }
          }
        } catch (error) {
          result = { proceeded: false, code: /** @type {any} */ (error).code || 'dshd/shutdown-failed',
            detail: /** @type {any} */ (error).message || String(error) };
        } finally {
          clearTimeout(shutdownTimer);
        }
        if (result.proceeded) {
          // app.quit() can be cancelled by close/beforeunload or stall waiting
          // for a renderer. Keep the original attempt latched until the process
          // actually quits, with a deadline after resources have stopped.
          state.nativeQuitReady = true;
          const nativeQuitTimer = setTimeout(() => {
            dsh.log('退出：窗口关闭等待超时，结束桌面进程', 'error');
            if (typeof destroyTray === 'function') destroyTray();
            app.exit(0);
          }, 5000);
          app.once('quit', () => clearTimeout(nativeQuitTimer));
          app.quit();
          return;
        }
        dsh.log(`退出：自动完成关停：${JSON.stringify({
          code: result.code, detail: result.detail,
          pendingCount: result.pendingCount, pendingLabels: result.pendingLabels,
        })}`, 'error');
        /** @type {ReturnType<typeof setTimeout>|undefined} */
        let finalTimer;
        try {
          await Promise.race([
            shutdownForQuit().catch(() => { /* Final quit must continue after the shutdown path has reported its failure. */ }),
            /** @type {Promise<void>} */ (new Promise((resolve) => {
              finalTimer = setTimeout(() => {
                dsh.log('退出：资源清理等待超时，结束桌面进程', 'error');
                resolve();
              }, 5000);
            })),
          ]);
        } finally {
          clearTimeout(finalTimer);
        }
        if (typeof destroyTray === 'function') destroyTray();
        app.exit(0);
      } finally {
        if (!state.nativeQuitReady) state.quitInProgress = false;
      }
    }

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin' && !hideOnClose(loadConfig())) {
        quitApp();
      }
    });
  }

  return {
    isDesktopKernelRunning,
    taskProtection,
    taskControlPeer,
    startDesktopFromLauncher,
    pickWorkspace,
    cleanupDesktopResources,
    restartWithCleanup,
    reloadWithCleanup,
    registerQuitHandlers,
  };
}

module.exports = { createAppLifecycle };
