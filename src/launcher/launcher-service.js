const { app, dialog } = require('electron');
const { getLauncherWindow, getMainWindow, dismissMainWindow } = require('../main/window');
const update = require('../main/update');
const dataImport = require('../main/data-import');
const marketInstall = require('../main/marketplace-install');
const { listInstalledPlugins: listProfilePlugins, OFFICIAL_TEMPLATE_BUNDLES } = require('../main/plugins');
const { kernelIsRunning, disablePlugins, enablePlugin } = require('../main/profile-ops');
const { getTaskProtection } = require('../main/task-protection');
const { inspectPlugins, isPresetPlugin } = require('../main/plugin-forensics');
const { isPluginTreeFailure } = require('../main/plugin-tree-failure');
const { readLastDesktopStart, stickySkipActive, peekParkedUpdateCheck } = require('../main/launcher-gate');
const { loadConfig, saveConfig, normalizeLauncherConfigPatch } = require('../main/config');
const releaseSource = require('./release-source');
const runtimeInstall = require('./runtime-install');
const deltaInstall = require('./delta/install');
const forensicsLog = require('./forensics-log');
const { isLauncherPackage, runtimeTarget, desktopStateDir, desktopUserDataDir } = require('./product');
const importGuard = require('../main/import-guard');
const { startupRecoveryGuidance } = require('../shared/launcher-recovery');

// In the slim package this process's config.json is the LAUNCHER's own file —
// desktop-owned keys (disabledPlugins, pluginRecovery) live in the runtime's
// userData. Plain JSON merge there: the desktop normalizes on its own boot.
function desktopConfigFile() {
  const path = require('path');
  return path.join(desktopUserDataDir(app), 'config.json');
}

function loadPluginConfig(strict = false) {
  if (!isLauncherPackage()) {
    return loadConfig();
  }
  try {
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync(desktopConfigFile(), 'utf8'));
    if (strict && (typeof config !== 'object' || config === null || Array.isArray(config))) {
      throw new Error('config-unreadable');
    }
    return config || {};
  } catch (error) {
    if (strict && error.code !== 'ENOENT') {
      const failure = new Error('config-unreadable');
      failure.code = 'CONFIG_UNREADABLE';
      throw failure;
    }
    return {};
  }
}

function savePluginConfig(patch, strict = false) {
  if (!isLauncherPackage()) {
    return saveConfig(patch);
  }
  const fs = require('fs');
  const path = require('path');
  const file = desktopConfigFile();
  const next = { ...loadPluginConfig(strict), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

const pluginConfigIO = { load: loadPluginConfig, save: savePluginConfig };

function configLocale(config = loadConfig()) {
  return config.locale === 'en' ? 'en' : 'zh';
}

/**
 * The launcher's application service: every launcher-surface operation the
 * renderer can reach (status, desktop start/stop, releases, updates, import,
 * plugin forensics) lives here so ipc.js stays a thin authorization+transport
 * layer. `deps` carries the runtime handles only the composition root has —
 * the harness controller, its start/stop entry points, and the shared
 * configPayload builder (also used by the harness get-config surface).
 */
function createLauncherService(deps) {
  const {
    dsh,
    harness,
    startHarness,
    startDesktop,
    stopDesktopCleanup,
    configPayload,
    statusContributors = [],
    taskProtection,
  } = deps;
  const protection = taskProtection || getTaskProtection();

  function collectForensics() {
    const listed = listProfilePlugins();
    const config = loadPluginConfig();
    const stateDir = desktopStateDir(app);
    const lastStart = readLastDesktopStart(stateDir);
    const recovery = harness?.pluginRecovery && typeof harness.pluginRecovery === 'object'
      ? harness.pluginRecovery
      : (config.pluginRecovery || {});
    // Historical logs remain available for export, but must never authorize
    // disabling a plugin. Sticky recovery retains the failed full attempt,
    // not the subsequent skip boot or an earlier unrelated failure.
    const currentLogs = typeof dsh?.currentStartLogs === 'function' ? dsh.currentStartLogs() : [];
    const failedLogs = currentLogs.length ? currentLogs : (lastStart.logTail || []);
    const logs = recovery.skipUserPlugins
      ? (recovery.logTail || []).concat(lastStart.ok === false ? failedLogs : [])
      : (lastStart.ok === false ? failedLogs : currentLogs);
    if (isLauncherPackage() && lastStart.ok === null && !recovery.skipUserPlugins) {
      logs.push(...forensicsLog.readBootLogTail(forensicsLog.bootLogPath(stateDir)));
    }
    const lastStartError = lastStart.ok === false ? lastStart.error : '';
    const recoveryReason = typeof recovery.reason === 'string' ? recovery.reason : '';
    const corpus = [logs.join('\n'), lastStartError, recoveryReason].filter(Boolean).join('\n');
    return inspectPlugins({
      logs,
      lastStartError,
      pluginTreeFailure: isPluginTreeFailure(corpus),
      recovery,
      plugins: listed.plugins || [],
      bundles: listed.bundles || [],
      disabledPlugins: config.disabledPlugins,
    });
  }

  async function stopKernelIfRunning() {
    if (!dsh || typeof dsh.stop !== 'function') {
      return false;
    }
    if (!kernelIsRunning(dsh)) {
      return false;
    }
    await dsh.stop();
    return true;
  }

  // Releases without SHA512SUMS.txt must never install silently: the user
  // explicitly accepts the unverified download or nothing is fetched. The
  // prompt renders inside the launcher window (app-confirm card) whenever the
  // confirm bridge is wired; the native box is only the dead-window fallback.
  async function confirmUnverifiedInstall(info) {
    const en = configLocale() === 'en';
    const title = en ? 'Unverified installer' : '安装包无法校验';
    const message = en
      ? `Release ${info?.tag || info?.latest || ''} has no SHA512SUMS.txt manifest, so the installer cannot be verified. Install anyway?`
      : `版本 ${info?.tag || info?.latest || ''} 未提供 SHA512SUMS.txt 校验清单，无法验证安装包完整性。仍要下载并安装吗？`;
    if (typeof deps.askLauncherConfirm === 'function') {
      const bridged = await deps.askLauncherConfirm({
        title,
        body: message,
        confirmText: en ? 'Install anyway' : '仍要安装',
        cancelText: en ? 'Cancel' : '取消',
        danger: true,
      });
      if (bridged !== null && bridged !== undefined) {
        return bridged;
      }
    }
    const win = getLauncherWindow() || getMainWindow() || undefined;
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: en ? ['Install anyway', 'Cancel'] : ['仍要安装', '取消'],
      defaultId: 1,
      cancelId: 1,
      title,
      message,
      noLink: true,
    });
    return result.response === 0;
  }

  let importAbort = null;
  // What kind of operation holds the single-operation slot, so a cancel
  // request can never abort work it did not start (e.g. a slim retry must
  // not be cancellable through the import cancel path).
  let importAbortKind = '';
  // The opId the running import identified itself with; `cancelImport`
  // validates a caller-supplied opId against it so a stale handle can never
  // abort a newer operation.
  let currentImportOpId = '';
  // The maintenance-guard token held for the current operation, if this
  // service acquired one. start/install/retry/import all reserve the same
  // shared slot (importGuard) so no two mutating operations overlap in
  // either arrival order — not merely an import-vs-import check.
  let heldGuardToken = null;

  /**
   * Reserve the shared maintenance slot for `kind`. Returns the token, or
   * null when another operation (of ANY kind, in either arrival order)
   * already owns it.
   */
  function acquireMaintenanceSlot(kind, meta = {}) {
    const token = importGuard.acquireMaintenance(kind, meta);
    if (token) {
      heldGuardToken = token;
    }
    return token;
  }

  /** Release the slot only if this service still owns the token. */
  function releaseMaintenanceSlot(token) {
    importGuard.releaseMaintenance(token);
    if (heldGuardToken === token) {
      heldGuardToken = null;
    }
  }

  /** Run the cleanup helper and await it when it returns a promise. */
  async function runDesktopCleanup() {
    if (typeof stopDesktopCleanup === 'function') {
      await stopDesktopCleanup();
    }
  }

  /**
   * Admission boundary for every operation that starts or mutates the
   * desktop runtime: a persistent `blocked` import journal must hold even a
   * user clicking Start — importing left destination trees unresolved and
   * booting over them risks writing through a half-replaced directory.
   */
  function blockedStartError() {
    if (typeof dataImport.readImportJournal !== 'function') {
      return null;
    }
    try {
      const journal = dataImport.readImportJournal(desktopStateDir(app));
      if (dataImport.journalIsBlocked(journal)) {
        return { ok: false, error: 'import-recovery-blocked', pendingTxns: journal.pendingTxns || [] };
      }
    } catch {
      // Unreadable journal state must not quietly allow a start either.
      return { ok: false, error: 'import-recovery-blocked' };
    }
    return null;
  }

  function importIsCancelledSignal(signal) {
    return Boolean(signal && signal.aborted === true);
  }

  // Autonomous plugin recovery must use the same persistent import verdict
  // as explicit Start. The controller itself owns the shared maintenance slot.
  harness?.setRecoveryAdmissionCheck?.(blockedStartError);

  async function runImportTask(options = {}, onProgress) {
    const guard = acquireMaintenanceSlot('import', { opId: options.opId });
    if (!guard) {
      return { ok: false, error: 'import-in-progress' };
    }
    const hasSelection = [
      'selectedRels', 'selectedSkillIds', 'selectedPluginNames',
      'selectedMcpIds', 'selectedSettingIds', 'selectedPresetIds',
    ].some((key) => Array.isArray(options[key]) && options[key].length > 0)
      || options.importAttachments === true;
    const controller = new AbortController();
    importAbort = controller;
    importAbortKind = 'import';
    currentImportOpId = typeof options.opId === 'string' && options.opId ? options.opId : '';
    try {
    if (!hasSelection) {
      // Empty selection is a no-write operation: claim the slot so concurrent
      // requests still serialize, but skip the protected stop boundary —
      // nothing is about to be copied.
      const sourceHome = typeof options.sourceHome === 'string' ? options.sourceHome : undefined;
      const extraSkillDirs = Array.isArray(options.extraSkillDirs)
        ? options.extraSkillDirs.filter((row) => typeof row === 'string')
        : [];
      const result = await dataImport.runImport({
        sourceHome, extraSkillDirs, userDataDir: desktopStateDir(app),
        opId: typeof options.opId === 'string' ? options.opId : undefined,
        signal: controller.signal, onProgress,
      });
      return {
        ...result,
        kernelStopped: false,
        hold: dataImport.probeImportHold({ sourceHome, extraSkillDirs }).hold,
      };
    }
    // Slim cannot establish cross-process quiescence: the desktop runtime is
    // a separate process this launcher cannot drain. Fail closed before any
    // destination or journal write; scanning stays available.
    if (isLauncherPackage()) {
      return { ok: false, error: 'slim-import-unsupported', capability: 'import' };
    }
    const pendingRecovery = typeof dataImport.readImportJournal === 'function'
      ? dataImport.readImportJournal(desktopStateDir(app))
      : null;
    if (pendingRecovery && dataImport.journalIsBlocked(pendingRecovery)) {
      return { ok: false, error: 'import-recovery-blocked', pendingTxns: pendingRecovery.pendingTxns || [] };
    }
    // A committed shutdown must not be re-entered for import — the process
    // is already on the way down; importing now would race the teardown.
    if (typeof protection.isCommitted === 'function' && protection.isCommitted()) {
      return { ok: false, error: 'shutdown-committed' };
    }
    if (importIsCancelledSignal(controller.signal)) {
      return { ok: false, cancelled: true, error: 'cancelled' };
    }
      // Run the whole stop-and-import sequence inside a nonterminal
      // coordinated commit so the task-protection coordinator holds the
      // exclusion boundary for the duration of the import.
      let kernelStopped = false;
      let result = null;
      const coordinated = await protection.coordinate('stop', {
        // Import is not the explicit-consent Stop button: it goes through the
        // normal protected decision (inspect active work, acquire, drain,
        // re-inspect, then prompt). The preConfirmed exemption stays with the
        // stop action only.
        commit: async () => {
          if (importIsCancelledSignal(controller.signal)) {
            throw new Error('import-cancelled-before-stop');
          }
          // Controller-level quiescence — not a bare kernel stop. This cancels
          // recovery timers, invalidates pending start/restart operations,
          // drains queued restarts, and runs desktop resource cleanup so no
          // managed work can fire while the import copies.
          await runDesktopCleanup();
          if (harness && typeof harness.stopDesktop === 'function') {
            kernelStopped = kernelIsRunning(dsh) || Boolean(harness.snapshot?.().state === 'ready');
            await harness.stopDesktop();
          } else {
            kernelStopped = await stopKernelIfRunning();
          }
          const sourceHome = typeof options.sourceHome === 'string' ? options.sourceHome : undefined;
          const extraSkillDirs = Array.isArray(options.extraSkillDirs)
            ? options.extraSkillDirs.filter((row) => typeof row === 'string')
            : [];
          const overwrite = options.overwrite === true;
          const userDataDir = desktopStateDir(app);
          result = await dataImport.runImport({
            sourceHome,
            extraSkillDirs,
            overwrite,
            userDataDir,
            selectedRels: Array.isArray(options.selectedRels) ? options.selectedRels : [],
            selectedSkillIds: Array.isArray(options.selectedSkillIds) ? options.selectedSkillIds : [],
            selectedPluginNames: Array.isArray(options.selectedPluginNames) ? options.selectedPluginNames : [],
            selectedMcpIds: Array.isArray(options.selectedMcpIds) ? options.selectedMcpIds : [],
            selectedSettingIds: Array.isArray(options.selectedSettingIds) ? options.selectedSettingIds : [],
            selectedPresetIds: Array.isArray(options.selectedPresetIds) ? options.selectedPresetIds : [],
            importAttachments: options.importAttachments === true,
            opId: typeof options.opId === 'string' ? options.opId : undefined,
            signal: controller.signal,
            onProgress,
            installPlugin: (spec) => (isLauncherPackage()
              ? { ok: false, error: 'desktop-only', name: spec }
              : marketInstall.installImportPlugin(spec, { token: loadConfig().githubToken })),
          });
        },
      });
      if (!coordinated.proceeded) {
        return { ok: false, error: coordinated.code || 'protection-busy' };
      }
      return {
        ...result,
        kernelStopped,
        hold: dataImport.probeImportHold({
          sourceHome: typeof options.sourceHome === 'string' ? options.sourceHome : undefined,
          extraSkillDirs: Array.isArray(options.extraSkillDirs) ? options.extraSkillDirs.filter((row) => typeof row === 'string') : [],
        }).hold,
      };
    } finally {
      releaseMaintenanceSlot(guard);
      if (importAbort === controller) {
        importAbort = null;
        importAbortKind = '';
        currentImportOpId = '';
      }
    }
  }

  // --- Managed-runtime (slim launcher) layer -------------------------------
  //
  // In the full package the launcher manages itself: installRelease/update
  // keep their self-update semantics (quit after launch). In the slim package
  // the same IPC ops retarget to the desktop product — the launcher survives
  // the installer and adopts the new registration instead of quitting. The
  // heavy lifting lives in runtime-install.js so the cold-start gate in
  // index.js can share it.

  function installedInfo(options) {
    return runtimeInstall.installedInfo(options);
  }

  function configuredRoute() {
    return runtimeInstall.configuredRoute();
  }

  function desktopSnapshot() {
    if (isLauncherPackage()) {
      const running = runtimeInstall.probeDesktopRunning();
      return { state: running ? 'running-external' : 'idle', external: true };
    }
    return harness ? harness.snapshot() : dsh.snapshot();
  }

  function installRuntimeOp(options = {}, onProgress) {
    // Installing a runtime writes the same destination trees an import
    // protects; the two operations must never overlap.
    const blocked = blockedStartError();
    if (blocked) {
      return Promise.resolve({ ok: false, status: 'error', error: blocked.error, message: '存在未恢复的导入事务，已阻止安装', pendingTxns: blocked.pendingTxns });
    }
    const guard = acquireMaintenanceSlot('install');
    if (!guard) {
      return Promise.resolve({ ok: false, error: 'operation-in-progress', status: 'error', message: '已有其他任务进行中' });
    }
    return Promise.resolve()
      .then(() => runtimeInstall.installRuntime(options, onProgress, {
        confirmUnverified: options.confirmUnverified || confirmUnverifiedInstall,
      }))
      .finally(() => releaseMaintenanceSlot(guard));
  }

  async function installUpdateOp(onProgress, options = {}) {
    const downloadMode = options.downloadMode === undefined ? 'full' : options.downloadMode;
    if (downloadMode !== 'full' && downloadMode !== 'delta') {
      return { status: 'error', launched: false, message: '更新方式无效，请重新选择增量更新或完全下载。' };
    }
    if (isLauncherPackage()) {
      if (downloadMode === 'delta') {
        return { status: 'error', launched: false, message: '启动器管理的桌面安装暂不支持此增量方式，请选择完全下载。' };
      }
      return installRuntimeOp({
        tag: options.expectedCheck?.tag, downloadMode: 'full',
        confirmUnverified: options.confirmUnverified,
      }, onProgress);
    }
    if (importGuard.isMaintenanceHeld()) {
      return { status: 'error', launched: false, ok: false, error: 'operation-in-progress', message: '已有其他任务进行中' };
    }
    const blocked = blockedStartError();
    if (blocked) {
      return { status: 'error', launched: false, ok: false, error: blocked.error, message: '存在未恢复的导入事务，已阻止更新', pendingTxns: blocked.pendingTxns };
    }
    const guard = acquireMaintenanceSlot('install');
    if (!guard) {
      return { status: 'error', launched: false, ok: false, error: 'operation-in-progress', message: '已有其他任务进行中' };
    }
    try {
      return await update.installUpdate(onProgress, {
        // These options come from a main-owned confirmation. The renderer IPC
        // invokes this method with progress only, never renderer-picked assets.
        expectedCheck: options.expectedCheck,
        downloadMode,
        confirmUnverified: options.confirmUnverified || confirmUnverifiedInstall,
        taskProtection: protection,
      });
    } catch (error) {
      return {
        status: 'error',
        current: update.currentVersion(),
        repoUrl: update.REPO_URL,
        releasesUrl: update.RELEASES_PAGE,
        htmlUrl: update.RELEASES_PAGE,
        latest: options.expectedCheck?.latest || options.expectedCheck?.version || '',
        assetName: options.expectedCheck?.assetName || '',
        assetUrl: options.expectedCheck?.assetUrl || '',
        launched: false,
        message: error.message || String(error),
      };
    } finally {
      releaseMaintenanceSlot(guard);
    }
  }

  async function installReleaseOp(tag, onProgress) {
    // Same admission rule as installRuntime: never run a release install
    // while the import slot is held or a blocked journal is unresolved.
    const blocked = blockedStartError();
    if (blocked) {
      return { status: 'error', launched: false, ok: false, error: blocked.error, message: '存在未恢复的导入事务，已阻止安装', pendingTxns: blocked.pendingTxns };
    }
    if (isLauncherPackage()) {
      // installRuntimeOp acquires + releases the shared slot itself.
      return installRuntimeOp({ tag }, onProgress);
    }
    const guard = acquireMaintenanceSlot('install');
    if (!guard) {
      return { status: 'error', launched: false, ok: false, error: 'operation-in-progress', message: '已有其他任务进行中' };
    }
    try {
      return await update.installRelease(tag, onProgress, {
        confirmUnverified: confirmUnverifiedInstall,
        taskProtection: protection,
      });
    } catch (error) {
      return { status: 'error', launched: false, message: error.message || String(error) };
    } finally {
      releaseMaintenanceSlot(guard);
    }
  }

  async function installDeltaOp(tag, onProgress) {
    const blocked = blockedStartError();
    if (blocked) {
      return { ...blocked, mode: 'delta' };
    }
    const guard = acquireMaintenanceSlot('install');
    if (!guard) {
      return { ok: false, mode: 'delta', error: 'operation-in-progress' };
    }
    try {
      return await deltaInstall.installDelta(tag, onProgress, {
        beforeApply: async () => {
          if (!runtimeInstall.probeDesktopRunning()) {
            return { ok: true };
          }
          // Download and checksum verification have completed. The desktop
          // peer now protects its tasks and grants shutdown before patching.
          const stopped = await runtimeInstall.stopExternalDesktop();
          if (stopped?.ok === false) {
            return stopped;
          }
          return runtimeInstall.probeDesktopRunning()
            ? { ok: false, error: 'runtime-busy' }
            : { ok: true };
        },
      });
    } finally {
      releaseMaintenanceSlot(guard);
    }
  }

  function startOp() {
    const blocked = blockedStartError();
    if (blocked) {
      return Promise.resolve(blocked);
    }
    const guard = acquireMaintenanceSlot('start');
    if (!guard) {
      return Promise.resolve({ ok: false, error: 'operation-in-progress' });
    }
    try {
    if (isLauncherPackage()) {
      return Promise.resolve()
        .then(() => runtimeInstall.startExternalDesktop())
        .finally(() => releaseMaintenanceSlot(guard));
    }
    const wasSticky = stickySkipActive(harness);
    if (!wasSticky && harness && typeof harness.clearPluginRecovery === 'function') {
      harness.clearPluginRecovery();
    }
    const start = typeof startDesktop === 'function' ? startDesktop : startHarness;
    // A full retry clears sticky only after the protected restart is admitted.
    if (wasSticky) {
      return Promise.resolve()
        .then(() => start({ forceRestart: true, fullPluginRetry: true, maintenanceToken: guard }))
        .finally(() => releaseMaintenanceSlot(guard));
    }
    return Promise.resolve()
      .then(() => start({ maintenanceToken: guard }))
      .finally(() => releaseMaintenanceSlot(guard));
    } catch (error) {
      // A synchronous throw before the guarded promise is built must release
      // the slot — otherwise a sticky-flag or clear failure holds it forever.
      releaseMaintenanceSlot(guard);
      throw error;
    }
  }

  function startSkippedOp() {
    const blocked = blockedStartError();
    if (blocked) {
      return Promise.resolve(blocked);
    }
    const guard = acquireMaintenanceSlot('start');
    if (!guard) {
      return Promise.resolve({ ok: false, error: 'operation-in-progress' });
    }
    try {
    if (isLauncherPackage()) {
      // Cross-process plugin skip is not plumbed yet; forward the flag for
      // future desktop-side honoring and start anyway.
      return Promise.resolve()
        .then(() => runtimeInstall.startExternalDesktop(['--skip-user-plugins']))
        .finally(() => releaseMaintenanceSlot(guard));
    }
    if (harness && typeof harness.writePluginSkip === 'function') {
      harness.writePluginSkip(new Error('launcher-skip-user-plugins'));
    }
    const start = typeof startDesktop === 'function' ? startDesktop : startHarness;
    // Must force restart: plain start() no-ops when already ready / joins an
    // in-flight boot that captured skipUserPlugins=false before this click.
    return Promise.resolve()
      .then(() => start({ forceRestart: true, maintenanceToken: guard }))
      .finally(() => releaseMaintenanceSlot(guard));
    } catch (error) {
      releaseMaintenanceSlot(guard);
      throw error;
    }
  }

  async function stopOp() {
    if (isLauncherPackage()) {
      // The managed desktop is another process: ask its peer endpoint to run
      // task protection; a desktop without the handshake gets a graceful
      // close, never a force kill.
      return runtimeInstall.stopExternalDesktop();
    }
    const wasRunning = kernelIsRunning(dsh);
    const result = await protection.coordinate('stop', {
      // The stop button is explicit consent — inspect/acquire/drain still run,
      // but no second confirmation may stand between the click and the stop.
      preConfirmed: true,
      commit: async () => {
        await runDesktopCleanup();
        if (harness && typeof harness.stopDesktop === 'function') {
          await harness.stopDesktop();
        } else {
          await stopKernelIfRunning();
        }
        dismissMainWindow();
      },
    });
    if (!result.proceeded) {
      return { ok: false, cancelled: result.code === 'cancelled', error: result.code || 'stopped' };
    }
    return {
      ok: true,
      stopped: wasRunning ? kernelIsRunning(dsh) === false : false,
    };
  }

  async function removePluginOp(name, onProgress) {
    // Persistent recovery admission BEFORE any removal side effect: a
    // blocked/unreadable import journal must refuse the uninstall before the
    // kernel stops or the config mutates — acquiring the slot alone is not
    // equivalent to honoring the persistent verdict.
    const blocked = blockedStartError();
    if (blocked) {
      return blocked;
    }
    // Removal is a mutating operation: it must ACQUIRE the shared slot, not
    // merely check it. An uninstall admitted first then overlapping a later
    // import is exactly the one-way-exclusion gap the slot exists to close.
    const guard = acquireMaintenanceSlot('plugin-remove');
    if (!guard) {
      return { ok: false, error: 'maintenance-in-progress' };
    }
    try {
    const raw = String(name || '').trim();
    if (!raw) {
      return { ok: false, error: 'missing-name' };
    }
    if (isPresetPlugin(raw) || OFFICIAL_TEMPLATE_BUNDLES.has(raw)) {
      return { ok: false, error: 'preset' };
    }
    if (isLauncherPackage()) {
      // The slim package ships no vendored `dsh plugin` toolchain — removal
      // lives in the installed desktop app; never pretend to uninstall.
      return { ok: false, error: 'desktop-only' };
    }
    const kernelStopped = await stopKernelIfRunning();
    const result = await marketInstall.uninstallPlugin(raw, { onProgress });
    // Only drop the disabledPlugins entry once the package is really gone —
    // otherwise a failed uninstall would silently re-enable a disabled plugin.
    // Slim mode must write the desktop runtime's config, not the launcher's.
    if (result && result.ok !== false) {
      const disabled = (pluginConfigIO.load().disabledPlugins || []).filter((item) => item !== raw);
      pluginConfigIO.save({ disabledPlugins: disabled });
    }
    return { ...result, kernelStopped, forensics: collectForensics() };
    } finally {
      releaseMaintenanceSlot(guard);
    }
  }

  return {
    status() {
      const lastStart = readLastDesktopStart(desktopStateDir(app));
      const forensics = collectForensics();
      // Peek only: this poll also runs from the pre-created *hidden* launcher,
      // and the previous drain-on-status lost a late result before the user
      // ever saw the window. The main process drains it when the window is
      // really visible (`openLauncher` / window `show`), which is also where
      // the ask's generation and quit guards live.
      return {
        config: configPayload(loadConfig()),
        desktop: desktopSnapshot(),
        lastStart,
        recovery: forensics.recovery,
        forensicsSummary: forensics.summary,
        forensics,
        version: update.currentVersion(),
        pendingUpdateCheck: peekParkedUpdateCheck(),
        // Managed-runtime surface: which desktop install exists, which mirror
        // feeds it, and whether this process is the slim launcher package.
        installed: installedInfo(),
        downloadRoute: configuredRoute(),
        routes: releaseSource.listRoutes(),
        launcherPackage: isLauncherPackage(),
        // Lane-owned status keys (frozen contract §5.1): each contributor
        // returns an object of extra keys merged under the shared payload.
        ...statusContributors.reduce((acc, contribute) => {
          try {
            return Object.assign(acc, contribute() || {});
          } catch {
            return acc;
          }
        }, {}),
      };
    },

    saveLauncherConfig(patch) {
      // The launcher config write mutates the same destination the import
      // journal protects; a held maintenance slot means another operation
      // owns the trees, so refuse rather than race a write through it.
      if (importGuard.isMaintenanceHeld()) {
        return { ok: false, error: 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind };
      }
      const next = saveConfig(normalizeLauncherConfigPatch(patch || {}));
      return configPayload(next);
    },

    async checkUpdate() {
      if (isLauncherPackage()) {
        // The launcher's "check for updates" is about the managed runtime:
        // nothing installed → nothing to update (the install card is the
        // surface), so the snapshot clamps 'available' to 'none'.
        return runtimeInstall.checkDesktopUpdate();
      }
      return update.checkUpdate();
    },

    installUpdate: installUpdateOp,

    async listReleases() {
      if (isLauncherPackage()) {
        const route = configuredRoute() || 'github';
        const result = await releaseSource.listFor(route, {
          installedVersion: installedInfo().version,
        });
        return { ...result, installed: installedInfo() };
      }
      return update.listReleases();
    },

    installRelease: installReleaseOp,

    installDelta: installDeltaOp,

    installRuntime: installRuntimeOp,

    cancelRuntimeInstall: runtimeInstall.cancelRuntimeInstall,

    uninstallApp() {
      return update.launchUninstaller({ target: runtimeTarget() });
    },

    scanImport(payload) {
      if (typeof payload === 'string') {
        return dataImport.scanImport({ sourceHome: payload });
      }
      const options = payload && typeof payload === 'object' ? payload : {};
      return dataImport.scanImport({
        sourceHome: typeof options.sourceHome === 'string' ? options.sourceHome : undefined,
        extraSkillDirs: Array.isArray(options.extraSkillDirs) ? options.extraSkillDirs : [],
      });
    },

    async pickImportSource() {
      const win = getLauncherWindow();
      const result = await dialog.showOpenDialog(win || undefined, {
        title: configLocale() === 'en' ? 'Choose official home' : '选择官方数据目录',
        defaultPath: require('node:os').homedir(),
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) {
        return null;
      }
      return result.filePaths[0];
    },

    async pickSkillDir() {
      const win = getLauncherWindow();
      const result = await dialog.showOpenDialog(win || undefined, {
        title: configLocale() === 'en' ? 'Choose a skill folder' : '选择技能目录',
        defaultPath: require('node:os').homedir(),
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) {
        return null;
      }
      return result.filePaths[0];
    },

    runImport: runImportTask,

    cancelImport(options = {}) {
      if (!importAbort) {
        return { ok: false };
      }
      // Only the import that is actually running may be cancelled. A
      // retry-owned slot must not be abortable through this path, and a
      // caller that names a different opId is not this op's owner. A caller
      // that names NO opId at all is also refused when the running import
      // identified itself — an unscoped cancel may not kill a scoped op.
      if (importAbortKind !== 'import') {
        return { ok: false, error: 'not-an-import-operation' };
      }
      const requested = typeof options === 'string' ? options : options?.opId;
      if (currentImportOpId && requested !== currentImportOpId) {
        return { ok: false, error: 'not-current-operation' };
      }
      importAbort.abort();
      return { ok: true };
    },

    stopDesktop: stopOp,

    pluginForensics: collectForensics,

    async disablePlugins(names) {
      if (importGuard.isMaintenanceHeld()) {
        return { ok: false, error: 'import-in-progress' };
      }
      const result = await disablePlugins(names, { dsh, startHarness, configIO: pluginConfigIO });
      return result.ok === true ? { ...result, forensics: collectForensics() } : result;
    },

    async disableSuspectsAndStart(names) {
      const blocked = blockedStartError();
      if (blocked) {
        return blocked;
      }
      if (importGuard.isMaintenanceHeld()) {
        return { ok: false, error: 'operation-in-progress' };
      }
      const forensics = collectForensics();
      const guidance = startupRecoveryGuidance({
        forensics,
        desktop: desktopSnapshot(),
        lastStart: readLastDesktopStart(desktopStateDir(app)),
        recovery: forensics.recovery,
      });
      const suspects = guidance?.kind === 'disable' ? guidance.names : [];
      const requested = Array.isArray(names) && names.every((name) => typeof name === 'string' && name.trim())
        ? [...new Set(names.map((name) => name.trim()))]
        : [];
      if (!requested.length || requested.length !== suspects.length
        || requested.some((name) => !suspects.includes(name))) {
        return { ok: false, error: 'suspects-changed', forensics };
      }
      try {
        const result = await disablePlugins(requested, {
          dsh,
          configIO: isLauncherPackage() ? {
            load: () => loadPluginConfig(true),
            save: (patch) => savePluginConfig(patch, true),
          } : pluginConfigIO,
          startWhenIdle: true,
          startHarness: async (ownerToken) => {
            if (isLauncherPackage()) {
              return retryFullPluginsSlim();
            }
            return startDesktop({ forceRestart: true, fullPluginRetry: true, recoveryLaunch: true, maintenanceToken: ownerToken });
          },
        });
        return result.ok === true ? { ...result, forensics: collectForensics() } : result;
      } catch (error) {
        if (error.code === 'CONFIG_UNREADABLE') {
          return { ok: false, error: 'config-unreadable' };
        }
        throw error;
      }
    },

    async disablePlugin(name) {
      if (importGuard.isMaintenanceHeld()) {
        return { ok: false, error: 'import-in-progress' };
      }
      const raw = String(name || '').trim();
      if (!raw) {
        return { ok: false, error: 'missing-name' };
      }
      const result = await disablePlugins([raw], { dsh, startHarness, configIO: pluginConfigIO });
      return result.ok === true ? { ...result, forensics: collectForensics() } : result;
    },

    async enablePlugin(name) {
      if (importGuard.isMaintenanceHeld()) {
        return { ok: false, error: 'import-in-progress' };
      }
      const raw = String(name || '').trim();
      if (!raw) {
        return { ok: false, error: 'missing-name' };
      }
      const result = await enablePlugin(raw, { dsh, startHarness, configIO: pluginConfigIO });
      return { ...result, forensics: collectForensics() };
    },

    removePlugin: removePluginOp,

    startDesktop: startOp,

    startDesktopSkipped: startSkippedOp,

    retryFullPlugins() {
      const blocked = blockedStartError();
      if (blocked) {
        return Promise.resolve(blocked);
      }
      const guard = acquireMaintenanceSlot('retry');
      if (!guard) {
        return Promise.resolve({ ok: false, error: 'operation-in-progress' });
      }
      try {
      if (isLauncherPackage()) {
        return Promise.resolve()
          .then(() => retryFullPluginsSlim())
          .finally(() => releaseMaintenanceSlot(guard));
      }
      return Promise.resolve()
        .then(() => startDesktop({ recoveryLaunch: true, forceRestart: true, fullPluginRetry: true, maintenanceToken: guard }))
        .finally(() => releaseMaintenanceSlot(guard));
      } catch (error) {
        // Release the owner if delegation throws before returning a promise.
        releaseMaintenanceSlot(guard);
        throw error;
      }
    },
  };

  /**
   * Slim "restore full plugins": the sticky skip flag lives in the
   * DESKTOP's config.json (not this launcher's). Stop the managed desktop,
   * clear only `pluginRecovery` in that file (preserving `disabledPlugins`
   * and unrelated keys), persist atomically, then launch once. A failure at
   * any step must leave the config untouched and not spawn.
   */
  async function retryFullPluginsSlim() {
    // Single maintenance owner: stop → config rewrite → launch must serialize
    // against a concurrent retry, a Start, or an in-flight import. Reuse the
    // shared maintenance slot — the outer `retryFullPlugins` already holds
    // it, so this body must not re-acquire. `importAbortKind` only marks the
    // slot's kind so cancelImport can refuse to abort non-import work.
    importAbortKind = 'retry';
    currentImportOpId = '';
    try {
    const fs = require('fs');
    const path = require('path');
    const configFile = desktopConfigFile();
    const stopped = await runtimeInstall.stopExternalDesktop();
    if (stopped && stopped.ok === false) {
      return { ok: false, error: stopped.error || 'stop-failed' };
    }
    let config;
    try {
      const raw = fs.readFileSync(configFile, 'utf8');
      config = JSON.parse(raw);
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        return { ok: false, error: 'config-unreadable' };
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        config = {};
      } else {
        return { ok: false, error: 'config-unreadable' };
      }
    }
    const next = {
      ...config,
      pluginRecovery: { skipUserPlugins: false, reason: '', at: '', appVersion: '' },
    };
    try {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      const tmp = `${configFile}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, configFile);
    } catch (error) {
      return { ok: false, error: error.message || 'config-write-failed' };
    }
    // Verify the persisted state before launching.
    try {
      const verify = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (verify.pluginRecovery && verify.pluginRecovery.skipUserPlugins === true) {
        return { ok: false, error: 'verify-failed' };
      }
    } catch {
      return { ok: false, error: 'verify-failed' };
    }
    // `await` keeps the single-op slot held until the spawn settles; a bare
    // `return` inside try/finally releases it while startup is still in
    // flight and a following op could interleave with the boot.
    return await runtimeInstall.startExternalDesktop();
    } finally {
      if (importAbortKind === 'retry') {
        importAbortKind = '';
        currentImportOpId = '';
      }
    }
  }
}

module.exports = { createLauncherService };
