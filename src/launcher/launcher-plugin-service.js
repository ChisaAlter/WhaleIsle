'use strict';

/**
 * Plugin forensics, disable/enable/remove and recovery operations extracted
 * from launcher-service.js so both modules stay below the 800-line ceiling
 * while launcher-service.js keeps direct ownership of Module._load seams.
 * @param {any} deps
 */
function createPluginConfigIO(deps) {
  const {
    app,
    loadConfig,
    saveConfig,
    isLauncherPackage,
    desktopUserDataDir,
    fs = require('fs'),
    path = require('path'),
  } = deps;

  function desktopConfigFile() {
    return path.join(desktopUserDataDir(app), 'config.json');
  }

  function loadPluginConfig(strict = false) {
    if (!isLauncherPackage()) {
      return loadConfig();
    }
    try {
      const config = JSON.parse(fs.readFileSync(desktopConfigFile(), 'utf8'));
      if (strict && (typeof config !== 'object' || config === null || Array.isArray(config))) {
        throw new Error('config-unreadable');
      }
      return config || {};
    } catch (error) {
      const err = /** @type {any} */ (error);
      if (strict && err?.code !== 'ENOENT') {
        const failure = /** @type {Error & { code?: string }} */ (new Error('config-unreadable'));
        failure.code = 'CONFIG_UNREADABLE';
        throw failure;
      }
      return {};
    }
  }

  /**
   * @param {any} patch
   * @param {boolean} [strict]
   */
  function savePluginConfig(patch, strict = false) {
    if (!isLauncherPackage()) {
      return saveConfig(patch);
    }
    const file = desktopConfigFile();
    const next = { ...loadPluginConfig(strict), ...patch };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return next;
  }

  return { desktopConfigFile, load: loadPluginConfig, save: savePluginConfig };
}

/**
 * Build the launcher's plugin forensics and recovery operations.
 * @param {any} deps
 */
function createLauncherPluginService(deps) {
  const {
    app,
    dsh,
    harness,
    startHarness,
    startDesktop,
    runtimeInstall,
    marketInstall,
    listProfilePlugins,
    OFFICIAL_TEMPLATE_BUNDLES,
    disablePlugins,
    enablePlugin,
    inspectPlugins,
    isPresetPlugin,
    isPluginTreeFailure,
    readLastDesktopStart,
    loadConfig,
    forensicsLog,
    isLauncherPackage,
    desktopStateDir,
    importGuard,
    startupRecoveryGuidance,
    pluginConfigIO,
    blockedStartError,
    acquireMaintenanceSlot,
    releaseMaintenanceSlot,
    stopKernelIfRunning,
    desktopSnapshot,
    setImportSlotKind,
    clearImportSlotKind,
  } = deps;

  /**
   * @param {string} stateDir
   * @param {any} lastStart
   * @param {any} recovery
   */
  async function resolveForensicsLogs(stateDir, lastStart, recovery) {
    const currentLogs = typeof dsh?.currentStartLogs === 'function' ? dsh.currentStartLogs() : [];
    const failedLogs = currentLogs.length ? currentLogs : (lastStart.logTail || []);
    const logs = recovery.skipUserPlugins
      ? (recovery.logTail || []).concat(lastStart.ok === false ? failedLogs : [])
      : (lastStart.ok === false ? failedLogs : currentLogs);
    if (isLauncherPackage() && lastStart.ok === null && !recovery.skipUserPlugins) {
      logs.push(...await forensicsLog.readBootLogTailAsync(forensicsLog.bootLogPath(stateDir)));
    }
    return logs;
  }

  /** @param {any} [snapshot] */
  async function collectForensics(snapshot = {}) {
    const listed = listProfilePlugins();
    const config = snapshot.config || pluginConfigIO.load();
    const stateDir = desktopStateDir(app);
    const lastStart = snapshot.lastStart || readLastDesktopStart(stateDir);
    const rawRecovery = harness?.pluginRecovery;
    const recovery = rawRecovery && typeof rawRecovery === 'object'
      ? { ...rawRecovery }
      : (config.pluginRecovery || {});
    // Historical logs remain available for export, but must never authorize
    // disabling a plugin. Sticky recovery retains the failed full attempt,
    // not the subsequent skip boot or an earlier unrelated failure.
    const logs = await resolveForensicsLogs(stateDir, lastStart, recovery);
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
      projectEnabled: config.projectEnabled !== false,
    });
  }

  /**
   * @param {any} name
   * @param {any} [onProgress]
   */
  async function removePlugin(name, onProgress) {
    const blocked = blockedStartError();
    if (blocked) {
      return blocked;
    }
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
        return { ok: false, error: 'desktop-only' };
      }
      const kernelStopped = await stopKernelIfRunning();
      const result = await marketInstall.uninstallPlugin(raw, { onProgress, delegatedToken: guard });
      if (result && result.ok !== false) {
        const disabled = (pluginConfigIO.load().disabledPlugins || []).filter((/** @type {any} */ item) => item !== raw);
        pluginConfigIO.save({ disabledPlugins: disabled });
      }
      return { ...result, kernelStopped, forensics: await collectForensics() };
    } finally {
      releaseMaintenanceSlot(guard);
    }
  }

  /**
   * @param {any} fs
   * @param {string} configFile
   */
  function readDesktopConfigJson(fs, configFile) {
    try {
      const raw = fs.readFileSync(configFile, 'utf8');
      const config = JSON.parse(raw);
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        return { ok: false, error: 'config-unreadable' };
      }
      return { ok: true, config };
    } catch (error) {
      const err = /** @type {any} */ (error);
      if (err && err.code === 'ENOENT') {
        return { ok: true, config: {} };
      }
      return { ok: false, error: 'config-unreadable' };
    }
  }

  /**
   * Slim "restore full plugins": clear only `pluginRecovery` in the desktop's
   * config.json, persist atomically, verify, then launch once.
   */
  async function retryFullPluginsSlim() {
    setImportSlotKind('retry', '');
    try {
      const fs = require('fs');
      const path = require('path');
      const configFile = pluginConfigIO.desktopConfigFile();
      const stopped = await runtimeInstall.stopExternalDesktop();
      if (stopped && stopped.ok === false) {
        return { ok: false, error: stopped.error || 'stop-failed' };
      }
      const parsed = readDesktopConfigJson(fs, configFile);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      const next = {
        ...parsed.config,
        pluginRecovery: { skipUserPlugins: false, reason: '', at: '', appVersion: '' },
      };
      try {
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        const tmp = `${configFile}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        fs.renameSync(tmp, configFile);
      } catch (error) {
        const err = /** @type {any} */ (error);
        return { ok: false, error: err?.message || 'config-write-failed' };
      }
      const verified = readDesktopConfigJson(fs, configFile);
      if (!verified.ok || verified.config?.pluginRecovery?.skipUserPlugins === true) {
        return { ok: false, error: 'verify-failed' };
      }
      return await runtimeInstall.startExternalDesktop();
    } finally {
      clearImportSlotKind('retry');
    }
  }

  /** @param {any} names */
  async function disablePluginList(names) {
    if (importGuard.isMaintenanceHeld()) {
      return { ok: false, error: 'import-in-progress' };
    }
    const result = await disablePlugins(names, { dsh, startHarness, configIO: pluginConfigIO });
    return result.ok === true ? { ...result, forensics: await collectForensics() } : result;
  }

  /** @param {any} names */
  async function disableSuspectsAndStart(names) {
    const blocked = blockedStartError();
    if (blocked) {
      return blocked;
    }
    if (importGuard.isMaintenanceHeld()) {
      return { ok: false, error: 'operation-in-progress' };
    }
    const forensics = await collectForensics();
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
          load: () => pluginConfigIO.load(true),
          save: (/** @type {any} */ patch) => pluginConfigIO.save(patch, true),
        } : pluginConfigIO,
        startWhenIdle: true,
        startHarness: async (/** @type {any} */ ownerToken) => {
          if (isLauncherPackage()) {
            return retryFullPluginsSlim();
          }
          return startDesktop({ forceRestart: true, fullPluginRetry: true, recoveryLaunch: true, maintenanceToken: ownerToken });
        },
      });
      return result.ok === true ? { ...result, forensics: await collectForensics() } : result;
    } catch (error) {
      const err = /** @type {any} */ (error);
      if (err?.code === 'CONFIG_UNREADABLE') {
        return { ok: false, error: 'config-unreadable' };
      }
      throw error;
    }
  }

  /** @param {any} name */
  async function disableSinglePlugin(name) {
    if (importGuard.isMaintenanceHeld()) {
      return { ok: false, error: 'import-in-progress' };
    }
    const raw = String(name || '').trim();
    if (!raw) {
      return { ok: false, error: 'missing-name' };
    }
    const result = await disablePlugins([raw], { dsh, startHarness, configIO: pluginConfigIO });
    return result.ok === true ? { ...result, forensics: await collectForensics() } : result;
  }

  /** @param {any} name */
  async function enableSinglePlugin(name) {
    if (importGuard.isMaintenanceHeld()) {
      return { ok: false, error: 'import-in-progress' };
    }
    const raw = String(name || '').trim();
    if (!raw) {
      return { ok: false, error: 'missing-name' };
    }
    const result = await enablePlugin(raw, { dsh, startHarness, configIO: pluginConfigIO });
    return { ...result, forensics: await collectForensics() };
  }

  function retryFullPlugins() {
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
      releaseMaintenanceSlot(guard);
      throw error;
    }
  }

  return {
    collectForensics,
    removePlugin,
    disablePlugins: disablePluginList,
    disableSuspectsAndStart,
    disablePlugin: disableSinglePlugin,
    enablePlugin: enableSinglePlugin,
    retryFullPlugins,
  };
}

module.exports = { createPluginConfigIO, createLauncherPluginService };
