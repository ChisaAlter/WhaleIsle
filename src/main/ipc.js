const fs = require('node:fs');
const { ipcMain, dialog, app, shell } = require('electron');
const { formatBootLogDump, saveBootLog } = require('./boot-log-dump');
const {
  REMOTE_FEATURE_ENABLED,
  loadConfig,
  saveConfig,
  parkRemoteSnapshot,
} = require('./config');
const { normalizeRemotePatch } = require('./remote-patch');
const { getMainWindow, getLauncherWindow, getHarnessWebContents, openHarnessSettings, openMarketplace, openRemote } = require('./window');
const { applyAppTheme } = require('./chrome');
const { currentVersion } = require('./update');
const { registerLauncherChannels, configPayload } = require('./ipc-launcher');
const ipcComponents = require('./ipc-components');
const ipcDelta = require('./ipc-delta');
const { getTaskProtection } = require('./task-protection');
const { listMarketplace } = require('./marketplace-catalog');
const { checkMarketplaceUpdates } = require('./marketplace-updates');
const { getMarketplaceDetails } = require('./marketplace-details');
const { listMarketplaceState, setMarketplaceFavorite, recordMarketplaceOperation, redactMarketLog } = require('./marketplace-state');
const {
  listInstalledPlugins,
  installPlugin,
  installMarketplacePlugin,
  updateMarketplacePlugin,
  updateMarketplacePlugins,
  uninstallPlugin,
} = require('./marketplace-install');
const { applyRendererConfigPatch } = require('./profile-ops');
const importGuard = require('./import-guard');
const { readImportJournal, journalIsBlocked } = require('./data-import');
const { recordLastDesktopStart, kernelLogTail } = require('./launcher-gate');
const { createLauncherService } = require('../launcher/launcher-service');
const { createLauncherConfirm } = require('../launcher/launcher-confirm');
const { listWallpaperCatalog, downloadWallpaper } = require('./wallpaper-catalog');
const { gitBranchList, gitCheckLargeFiles, gitCommit, gitCreateBranch, gitCreateChangeRequest, gitDiff, gitDiscard, gitFetchForStatus, gitInit, gitPublishRepository, gitPull, gitPush, gitReadPullRequest, gitStage, gitStatus, gitStatusEntries, gitSwitchBranch, gitUnstage, openWorkspacePath } = require('./git');
const { gitIpcNull, guardGitIpc } = require('./git-ipc-guard');
const { watchWorkspaceRegistrations } = require('./git-workspace-watch');
const { registerPreviewIpc } = require('./preview');
const { registerPtyIpc } = require('./pty');
const { listDir, readFile, readFileMedia, writeFile } = require('./workspace-fs');
const { listAvailableEditors, openInEditor, revealInFolder, openWithSystemDefault } = require('./editors');
const { IPC_ROLES, assertIpcSender } = require('./ipc-authorization');
const { openDesktopDshHome } = require('./open-dsh-home');

const BOOT_ONLY = [IPC_ROLES.BOOT];
const HARNESS_ONLY = [IPC_ROLES.HARNESS];
const CONFIG_SURFACES = [IPC_ROLES.HARNESS];
const ALL_SURFACES = [IPC_ROLES.BOOT, IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER];
// Boot page and harness may summon the launcher window; the launcher itself
// never needs to (it IS the launcher).
const OPEN_LAUNCHER_SURFACES = [IPC_ROLES.BOOT, IPC_ROLES.HARNESS];

function sendPluginProgress(event, payload) {
  if (event?.sender && !event.sender.isDestroyed()) {
    event.sender.send('shell:plugin-progress', { ...payload, line: redactMarketLog(payload.line) });
  }
}

const HARNESS_DOWN_AFTER_ADD = '插件已写入 web profile，但 Harness 没有起来。请从现有入口重启，不要再安装一次。';
const HARNESS_DOWN_AFTER_UPDATE = '插件已更新，但 Harness 没有起来。请从现有入口重启，不要再次更新。';
const HARNESS_DOWN_AFTER_REMOVE = '插件已从 web profile 移除，但 Harness 没有起来。请从现有入口重启，不要再卸载一次。';
const WALLPAPER_CATALOG_KINDS = new Set(['bing', 'wallhaven', 'catalog']);

function finiteNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function wallpaperCatalogQuery(query = {}) {
  return {
    kind: WALLPAPER_CATALOG_KINDS.has(query.kind) ? query.kind : undefined,
    year: finiteNumber(query.year),
    url: typeof query.url === 'string' ? query.url : undefined,
    q: typeof query.q === 'string' ? query.q : undefined,
    categories: typeof query.categories === 'string' ? query.categories : undefined,
    page: finiteNumber(query.page),
  };
}

async function restartAfterProfileWrite(event, result, startHarness, downError, harness, clearPluginSkip = false) {
  if (result.ok !== true || typeof startHarness !== 'function') {
    return result;
  }
  sendPluginProgress(event, { phase: 'restart', line: '正在重启 Harness' });
  try {
    if (clearPluginSkip && harness && typeof harness.retryFullPlugins === 'function') {
      await harness.retryFullPlugins();
    } else {
      await startHarness();
    }
  } catch {
    // startHarness threw after the profile write committed. Return ok so the UI does not retry the write.
    return { ...result, ok: true, harnessStarted: false, error: downError };
  }
  return { ...result, harnessStarted: true };
}

function registerIpc({
  dsh, harness, startHarness, startDesktop, stopDesktopCleanup, remote, onOpenLauncher,
  getLive2dPet,
}) {
  const handle = (channel, roles, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      assertIpcSender(event, roles);
      return listener(event, ...args);
    });
  };
  const authorizeHarness = (event) => assertIpcSender(event, HARNESS_ONLY);
  // Launcher orchestration lives in the service; handlers below stay thin
  // authorization + renderer-transport delegates so the same service can sit
  // behind a different boundary later.
  // Launcher-surface confirmations render as the renderer's own app-confirm
  // card (the bridge mounts shell:app-confirm:response through extraChannels);
  // a null answer falls back to the native box inside the service.
  const launcherConfirm = createLauncherConfirm({ getWindow: getLauncherWindow });
  const launcher = createLauncherService({
    dsh,
    harness,
    startHarness,
    startDesktop,
    stopDesktopCleanup,
    configPayload,
    statusContributors: [ipcComponents.contributeStatus, ipcDelta.contributeStatus],
    askLauncherConfirm: launcherConfirm.ask,
  });

  handle('shell:get-state', BOOT_ONLY, () => (harness ? harness.snapshot() : dsh.snapshot()));

  handle('shell:save-config', CONFIG_SURFACES, async (_event, patch) => {
    // The desktop-control channel (dsh-whale tools) mutates config through
    // the same profile-ops implementation so both surfaces share the one
    // serialized align chain.
    const next = applyRendererConfigPatch(patch, {
      app,
      applyAppTheme,
      harness,
      startHarness,
      log: (line) => dsh.log(line, 'app'),
    });
    return configPayload(next);
  });

  handle('shell:open-external', CONFIG_SURFACES, async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Invalid URL');
    }
    await shell.openExternal(url);
    return true;
  });

  // Boot-page restarts are full desktop starts: record their outcome in
  // last-desktop-start.json so the next cold-start gate sees the truth.
  // Launcher-role paths go through startDesktop, which records it itself.
  // Both boot channels (shell:restart and the non-launcher
  // shell:retry-full-plugins) funnel through this same boundary, so the
  // shared maintenance admission and the persistent blocked-recovery verdict
  // live here — not split across two handler-only checks that can drift.
  //
  // Ownership, not just admission: a boot restart that passes the check but
  // does not acquire the slot leaves the destination tree unowned for the
  // duration of the async retry — a later import/install would then be
  // admitted and overlap the teardown. Acquire the token before the async
  // work and release it only when the operation fully settles (only the
  // boundary that acquired releases).
  const recordBootRestart = async () => {
    if (importGuard.isMaintenanceHeld()) {
      return { ok: false, error: 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind };
    }
    try {
      const pending = readImportJournal(app.getPath('userData'));
      if (journalIsBlocked(pending)) {
        return { ok: false, error: 'import-recovery-blocked', pendingTxns: pending?.pendingTxns || [] };
      }
    } catch {
      // An unreadable journal must fail closed — unknown transaction state
      // is not a safe restart boundary.
      return { ok: false, error: 'import-recovery-blocked' };
    }
    const acquired = importGuard.acquireMaintenance('boot-restart');
    if (!acquired) {
      // Admitted free a moment ago but lost the race — refuse rather than
      // run unowned or steal someone else's ownership.
      return { ok: false, error: 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind };
    }
    try {
      return await recordLastDesktopStart(
        app.getPath('userData'),
        // Delegate the token we just acquired into the nested restart so it
        // is recognized as the same operation (startHarness is wired to
        // restartWithCleanup), not refused as a foreign caller.
        () => (harness ? harness.retryFullPlugins() : startHarness(acquired)),
        () => kernelLogTail(dsh),
      );
    } finally {
      importGuard.releaseMaintenance(acquired);
    }
  };

  handle('shell:restart', BOOT_ONLY, async () => {
    // recordBootRestart is the shared admission boundary for every boot
    // restart channel — it refuses while maintenance is held or a blocked
    // import journal persists, and returns {ok:false} instead of a snapshot.
    const outcome = await recordBootRestart();
    if (outcome && outcome.ok === false) {
      return outcome;
    }
    return harness ? harness.snapshot() : dsh.snapshot();
  });

  handle('shell:cancel-restart', BOOT_ONLY, () => (
    harness ? harness.cancelRecovery() : dsh.snapshot()
  ));

  handle('shell:save-boot-log', BOOT_ONLY, async () => {
    const snapshot = harness ? harness.snapshot() : dsh.snapshot();
    const dump = formatBootLogDump({
      version: currentVersion(),
      savedAt: new Date().toISOString(),
      snapshot,
      logs: Array.isArray(dsh.logs) ? dsh.logs : [],
    });
    return saveBootLog({
      dialog,
      browserWindow: getMainWindow(),
      dump,
      writeFile: fs.promises.writeFile,
      defaultDirectory: app.getPath('downloads'),
    });
  });

  handle('shell:open-settings', HARNESS_ONLY, (_event, sectionId) => openHarnessSettings(sectionId));

  // 桌宠 settings writes: the settings page lives in this window (section
  // `pet`), and every change must route through the pet manager so it
  // normalizes, persists, and pushes to the live pet window at once —
  // `live2dPet` stays off the generic save-config whitelist for that reason.
  handle('shell:live2d-pet-settings', HARNESS_ONLY, (_event, payload) => {
    const pet = typeof getLive2dPet === 'function' ? getLive2dPet() : null;
    if (!pet) {
      return { ok: false, reason: 'unavailable' };
    }
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    if (typeof body.enabled === 'boolean' && body.enabled !== pet.isEnabled()) {
      pet.setEnabled(body.enabled);
    }
    const settings = body.reset === true || (body.patch && typeof body.patch === 'object')
      ? pet.applySettings(body)
      : pet.getSettings();
    return { ok: true, enabled: pet.isEnabled(), settings };
  });

  handle('shell:open-launcher', OPEN_LAUNCHER_SURFACES, async (event) => {
    if (typeof onOpenLauncher !== 'function') {
      return { ok: false, reason: 'unavailable' };
    }
    // The boot page bridges startup failures to the launcher home tab, where
    // the Recovery Board owns ALL plugin-level recovery (attribution,
    // per-plugin disable, skip). The boot page itself only keeps transient
    // actions (retry / cancel auto-restart / download log) and never grows
    // its own recovery copy.
    const role = assertIpcSender(event, OPEN_LAUNCHER_SURFACES);
    await onOpenLauncher(role === IPC_ROLES.BOOT ? { tab: 'home' } : {});
    return { ok: true };
  });

  handle('shell:open-dsh-home', HARNESS_ONLY, () => openDesktopDshHome());

  handle('shell:list-marketplace', HARNESS_ONLY, async (_event, options = {}) => {
    return listMarketplace({
      refresh: Boolean(options && options.refresh),
      locale: options?.locale,
    });
  });

  handle('shell:refresh-marketplace', HARNESS_ONLY, async (_event, options = {}) => {
    return listMarketplace({
      refresh: true,
      locale: options?.locale,
    });
  });

  handle('shell:list-wallpaper-catalog', HARNESS_ONLY, async (_event, query = {}) => (
    listWallpaperCatalog(wallpaperCatalogQuery(query))
  ));

  handle('shell:download-wallpaper', HARNESS_ONLY, async (_event, url) => {
    if (typeof url !== 'string') return { error: '壁纸地址无效' };
    return downloadWallpaper(url);
  });

  handle('shell:list-installed-plugins', HARNESS_ONLY, () => listInstalledPlugins());
  handle('shell:marketplace-state', HARNESS_ONLY, () => listMarketplaceState());
  handle('shell:marketplace-details', HARNESS_ONLY, (_event, id, options = {}) => getMarketplaceDetails(id, { force: options?.force === true }));
  handle('shell:marketplace-favorite', HARNESS_ONLY, (_event, id, favorite) => setMarketplaceFavorite(id, favorite));

  handle('shell:check-marketplace-updates', HARNESS_ONLY, (_event, options = {}) => {
    const config = loadConfig();
    return checkMarketplaceUpdates({
      force: Boolean(options?.force),
      refresh: Boolean(options?.refresh),
      token: config.githubToken,
    });
  });

  handle('shell:install-plugin', HARNESS_ONLY, async (event, spec, options = {}) => {
    const config = loadConfig();
    const result = await installPlugin(spec, {
      token: config.githubToken,
      allowBuilds: Array.isArray(options?.allowBuilds) ? options.allowBuilds : [],
      onProgress: (payload) => sendPluginProgress(event, payload),
    });
    return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_ADD);
  });

  handle('shell:install-marketplace-plugin', HARNESS_ONLY, async (event, id, options = {}) => {
    const config = loadConfig();
    return recordMarketplaceOperation('install', id, async record => {
      const result = await installMarketplacePlugin(id, {
        token: config.githubToken,
        allowBuilds: Array.isArray(options?.allowBuilds) ? options.allowBuilds : [],
        onProgress: payload => { record(payload); sendPluginProgress(event, payload); },
      });
      return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_ADD);
    });
  });

  handle('shell:update-marketplace-plugin', HARNESS_ONLY, async (event, id, options = {}) => {
    const config = loadConfig();
    return recordMarketplaceOperation('update', id, async record => {
      const result = await updateMarketplacePlugin(id, {
        token: config.githubToken,
        allowBuilds: Array.isArray(options?.allowBuilds) ? options.allowBuilds : [],
        onProgress: payload => { record(payload); sendPluginProgress(event, payload); },
      });
      return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_UPDATE);
    });
  });

  handle('shell:update-marketplace-plugins', HARNESS_ONLY, async (event, ids) => {
    const config = loadConfig();
    return recordMarketplaceOperation('batch', Array.isArray(ids) ? ids.join(', ') : '', async record => {
      const result = await updateMarketplacePlugins(ids, {
        token: config.githubToken,
        onProgress: payload => { record(payload); sendPluginProgress(event, payload); },
      });
      if (!result.changed || result.rollbackFailed) return result;
      const restarted = await restartAfterProfileWrite(event, { ok: true }, startHarness, HARNESS_DOWN_AFTER_UPDATE);
      return { ...result, harnessStarted: restarted.harnessStarted, error: restarted.harnessStarted === false ? restarted.error : result.error };
    });
  });

  handle('shell:uninstall-plugin', HARNESS_ONLY, async (event, name) => {
    return recordMarketplaceOperation('uninstall', name, async record => {
      const result = await uninstallPlugin(name, {
        onProgress: payload => { record(payload); sendPluginProgress(event, payload); },
      });
      return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_REMOVE, harness, true);
    });
  });

  handle('shell:open-marketplace', HARNESS_ONLY, () => openMarketplace());

  // Every shell:git-* listener is guarded: a thrown handler error resolves to
  // the channel's failure payload instead of rejecting the renderer invoke,
  // which would strand the titlebar progress toast in the loading state.
  // The webContents id owns the refresh read context: the three sibling reads
  // of one titlebar refresh share it, and no other window can pick it up.
  handle('shell:git-status', HARNESS_ONLY, guardGitIpc((event, cwd) => gitStatus(cwd, event.sender.id), gitIpcNull));
  handle('shell:git-fetch-status', HARNESS_ONLY, guardGitIpc((event, cwd) => gitFetchForStatus(cwd, event.sender.id), gitIpcNull));
  handle('shell:git-pull-request', HARNESS_ONLY, guardGitIpc((event, cwd) => gitReadPullRequest(cwd, event.sender.id)));
  handle('shell:git-init', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitInit(cwd)));
  handle('shell:git-diff', HARNESS_ONLY, guardGitIpc((_event, cwd, options) => gitDiff(cwd, options), gitIpcNull));
  // Read-only pre-commit size probe for the commit dialog. Same guard as the
  // other Git reads so a cwd outside the authorized roots cannot be scanned.
  handle('shell:git-check-large-files', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitCheckLargeFiles(cwd), gitIpcNull));
  const sendGitProgress = (event, actionId) => (progress) => {
    if (actionId == null || event.sender.isDestroyed()) return;
    event.sender.send('shell:git-progress', { actionId, ...progress });
  };
  handle('shell:git-commit', HARNESS_ONLY, guardGitIpc((event, cwd, message, filePaths, actionId, options) => (
    gitCommit(cwd, message, filePaths, sendGitProgress(event, actionId), options)
  )));
  handle('shell:git-push', HARNESS_ONLY, guardGitIpc((event, cwd, actionId) => gitPush(cwd, sendGitProgress(event, actionId))));
  handle('shell:git-pull', HARNESS_ONLY, guardGitIpc((event, cwd, actionId) => gitPull(cwd, sendGitProgress(event, actionId))));
  handle('shell:git-create-change-request', HARNESS_ONLY, guardGitIpc((event, cwd, input, actionId) => (
    gitCreateChangeRequest(cwd, input, sendGitProgress(event, actionId))
  )));
  handle('shell:git-publish', HARNESS_ONLY, guardGitIpc((event, cwd, input, actionId) => (
    gitPublishRepository(cwd, input, sendGitProgress(event, actionId))
  )));
  // Not a git channel, but ui-git consumes it as the same `{ ok, message }`
  // failure payload from the commit dialog's file rows.
  handle('shell:open-workspace-path', HARNESS_ONLY, guardGitIpc((_event, cwd, relativePath) => openWorkspacePath(cwd, relativePath)));
  handle('shell:list-dir', HARNESS_ONLY, (_event, cwd, relativePath) => listDir(cwd, relativePath));
  handle('shell:read-file', HARNESS_ONLY, (_event, cwd, relativePath) => readFile(cwd, relativePath));
  handle('shell:read-file-media', HARNESS_ONLY, (_event, cwd, relativePath) => readFileMedia(cwd, relativePath));
  handle('shell:write-file', HARNESS_ONLY, (_event, cwd, relativePath, text) => writeFile(cwd, relativePath, text));
  handle('shell:list-editors', HARNESS_ONLY, () => listAvailableEditors());
  handle('shell:open-in-editor', HARNESS_ONLY, (_event, input) => openInEditor(input));
  handle('shell:show-item-in-folder', HARNESS_ONLY, (_event, cwd, relativePath) => revealInFolder(cwd, relativePath));
  handle('shell:open-with-default', HARNESS_ONLY, (_event, cwd, relativePath) => (
    openWithSystemDefault({ cwd, relativePath })
  ));
  handle('shell:git-stage', HARNESS_ONLY, guardGitIpc((_event, cwd, relativePath) => gitStage(cwd, relativePath)));
  handle('shell:git-unstage', HARNESS_ONLY, guardGitIpc((_event, cwd, relativePath) => gitUnstage(cwd, relativePath)));
  handle('shell:git-discard', HARNESS_ONLY, guardGitIpc((_event, cwd, relativePath) => gitDiscard(cwd, relativePath)));
  handle('shell:git-status-entries', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitStatusEntries(cwd)));
  handle('shell:git-branch-list', HARNESS_ONLY, guardGitIpc((_event, cwd) => gitBranchList(cwd)));
  handle('shell:git-switch-branch', HARNESS_ONLY, guardGitIpc((_event, cwd, ref) => gitSwitchBranch(cwd, ref)));
  handle('shell:git-create-branch', HARNESS_ONLY, guardGitIpc((_event, cwd, name) => gitCreateBranch(cwd, name)));
  // The harness registers a newly opened workspace asynchronously, so the
  // titlebar's first git status read can race that write and come back
  // unauthorized. Push a signal when the registry changes so ui-git refreshes
  // as soon as the trust roots are live instead of waiting for window focus.
  const stopWorkspaceWatch = watchWorkspaceRegistrations(() => {
    const contents = getHarnessWebContents();
    if (contents && !contents.isDestroyed()) {
      contents.send('shell:git-workspaces-changed');
    }
  });
  const pty = registerPtyIpc(ipcMain, undefined, { authorize: authorizeHarness });
  const preview = registerPreviewIpc(ipcMain, undefined, { authorize: authorizeHarness });

  handle('shell:open-remote', HARNESS_ONLY, () => {
    if (!REMOTE_FEATURE_ENABLED) {
      throw new Error('Remote is disabled in this build');
    }
    return openRemote();
  });

  handle('shell:get-remote', HARNESS_ONLY, async () => {
    if (!REMOTE_FEATURE_ENABLED) {
      const parked = remote && typeof remote.snapshot === 'function'
        ? remote.snapshot()
        : { available: false, enabled: false, listening: false };
      return parkRemoteSnapshot(parked);
    }
    if (remote && typeof remote.ensurePairing === 'function') {
      await remote.ensurePairing();
    }
    const snapshot = remote && typeof remote.snapshot === 'function'
      ? remote.snapshot()
      : { available: false, enabled: false, listening: false };
    if (snapshot.available === false) {
      return { ...snapshot, available: false, enabled: false };
    }
    return {
      ...snapshot,
      available: true,
      enabled: Boolean(snapshot.enabled),
    };
  });

  handle('shell:save-remote', HARNESS_ONLY, async (_event, patch) => {
    if (!REMOTE_FEATURE_ENABLED) {
      saveConfig({ remoteEnabled: false, remoteMode: 'lan', remoteRelayUrl: '' });
      if (remote && typeof remote.sync === 'function') {
        await remote.sync();
      }
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    saveConfig(normalizeRemotePatch(patch || {}));
    if (remote && typeof remote.sync === 'function') {
      return remote.sync();
    }
    return remote ? remote.snapshot() : null;
  });

  handle('shell:rotate-remote-token', HARNESS_ONLY, async () => {
    if (!REMOTE_FEATURE_ENABLED) {
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    if (remote && typeof remote.rotateToken === 'function') {
      return remote.rotateToken();
    }
    return null;
  });

  handle('shell:unbind-remote-device', HARNESS_ONLY, async (_event, id) => {
    if (!REMOTE_FEATURE_ENABLED) {
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    if (remote && typeof remote.unbindDevice === 'function') {
      return remote.unbindDevice(id);
    }
    return remote ? remote.snapshot() : null;
  });

  handle('shell:rename-remote-device', HARNESS_ONLY, async (_event, id, name) => {
    if (!REMOTE_FEATURE_ENABLED) {
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    if (remote && typeof remote.renameDevice === 'function') {
      return remote.renameDevice(id, name);
    }
    return remote ? remote.snapshot() : null;
  });

  // Every launcher-renderer channel (status / config / import / releases /
  // runtime install / forensics / start-stop) registers through the shared
  // table so the slim launcher package binds the identical surface.
  registerLauncherChannels({
    launcher,
    dsh,
    harness,
    startDesktop,
    recordBootRestart,
    extraChannels: [ipcComponents, ipcDelta, launcherConfirm],
    // Component teardown rides the protection commit point so a cancelled
    // quit prompt never leaves supervised services dead.
    onQuitCommit: (fn) => getTaskProtection().onCommitCleanup(fn),
  });

  return { pty, preview, stopWorkspaceWatch, launcher };
}

module.exports = { registerIpc };
