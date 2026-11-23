const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, dialog, app } = require('electron');
const {
  REMOTE_FEATURE_ENABLED,
  loadConfig,
  saveConfig,
  parkRemoteSnapshot,
} = require('./config');
const { normalizeRemotePatch } = require('./remote-patch');
const { getMainWindow, getLauncherWindow, getHarnessWebContents, openHarnessSettings, openMarketplace } = require('./window');
const { applyAppTheme } = require('./chrome');
const { currentVersion } = require('./update');
const { registerLauncherChannels, configPayload } = require('./ipc-launcher');
const ipcComponents = require('./ipc-components');
const ipcDelta = require('./ipc-delta');
const { getTaskProtection } = require('./task-protection');
const { applyRendererConfigPatch } = require('./profile-ops');
const importGuard = require('./import-guard');
const { readImportJournal, journalIsBlocked } = require('./data-import');
const { recordLastDesktopStart, kernelLogTail } = require('./launcher-gate');
const { createLauncherService } = require('../launcher/launcher-service');
const { withUpdateCenter } = require('./update-center/legacy');
const { createLauncherConfirm } = require('../launcher/launcher-confirm');
const { gitIpcNull, guardGitIpc } = require('./git-ipc-guard');
const { watchWorkspaceRegistrations } = require('./git-workspace-watch');
const { registerPreviewIpc } = require('./preview');
const { registerPtyIpc } = require('./pty');
const { IPC_ROLES, assertIpcSender } = require('./ipc-authorization');
const { registerIpc: registerChannel } = require('./ipc-register');

const HARNESS_ONLY = [IPC_ROLES.HARNESS];
// Boot page and harness may summon the launcher window; the launcher itself
// never needs to (it IS the launcher).
const OPEN_LAUNCHER_SURFACES = [IPC_ROLES.BOOT, IPC_ROLES.HARNESS];

function sendPluginProgress(event, payload) {
  if (event?.sender && !event.sender.isDestroyed()) {
    const { redactMarketLog } = require('./marketplace-state');
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
  dsh, harness, startHarness, reloadPage, startDesktop, stopDesktopCleanup, remote, onOpenLauncher,
  getLive2dPet, updateCenter = null, openUpdateCenter = () => {},
  onConfigChanged = /** @type {((next: Record<string, any>, patch?: Record<string, any>) => void) | undefined} */ (undefined),
}) {
  // Every channel mounts through the shared wrapper: the IPC contract
  // authorizes the sender roles and normalizes the argument list before the
  // handler runs.
  const handle = (channel, listener) => {
    registerChannel({ channel, handler: listener });
  };
  const renderMode = require('./render-mode');
  handle('shell:get-render-mode', () => renderMode.getMinimalMode());
  handle('shell:set-render-mode', (_event, minimal) => {
    const result = renderMode.setMinimalMode(minimal);
    onConfigChanged?.(loadConfig(), { minimalMode: minimal });
    return result;
  });
  handle('shell:claim-minimal-suggestion', () => renderMode.claimMinimalSuggestion());
  const authorizeHarness = (event) => assertIpcSender(event, HARNESS_ONLY);
  let pendingWorkspaceDirectoryDialog = null;
  // Launcher orchestration lives in the service; handlers below stay thin
  // authorization + renderer-transport delegates so the same service can sit
  // behind a different boundary later.
  // Launcher-surface confirmations render as the renderer's own app-confirm
  // card (the bridge mounts shell:app-confirm:response through extraChannels);
  // a null answer falls back to the native box inside the service.
  const launcherConfirm = createLauncherConfirm({ getWindow: getLauncherWindow });
  const launcherService = createLauncherService({
    dsh,
    harness,
    startHarness,
    startDesktop,
    stopDesktopCleanup,
    configPayload,
    statusContributors: [ipcComponents.contributeStatus, ipcDelta.contributeStatus],
    askLauncherConfirm: launcherConfirm.ask,
  });
  // Desktop package: check/download/install belong to the update center.
  const launcher = updateCenter
    ? withUpdateCenter(launcherService, updateCenter, () => openUpdateCenter(getLauncherWindow()))
    : launcherService;

  handle('shell:get-state', () => (harness ? harness.snapshot() : dsh.snapshot()));

  handle('shell:save-config', async (_event, patch) => {
    // The desktop-control channel (dsh-whale tools) mutates config through
    // the same profile-ops implementation so both surfaces share the one
    // serialized align chain.
    const next = await applyRendererConfigPatch(patch, {
      app,
      applyAppTheme,
      harness,
      startHarness,
      log: (line) => dsh.log(line, 'app'),
      waitForRestart: true,
      onConfigChanged,
    });
    return next.restartCancelled ? { ...configPayload(next), restartCancelled: true } : configPayload(next);
  });

  handle('shell:open-external', async (_event, url) => {
    if (!await require('./open-external').openExternalHttp(url)) {
      throw new Error('Invalid URL');
    }
    return true;
  });

  handle('shell:openui-viewer', () => require('./openui').openuiViewer());
  handle('shell:openui-api', (_event, input) => require('./openui').openuiApi(input));
  handle('shell:openui-bundle', (_event, input) => require('./openui').openuiBundle(input));

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
        () => harness?.skippedBuiltins || [],
      );
    } finally {
      importGuard.releaseMaintenance(acquired);
    }
  };

  handle('shell:restart', async () => {
    // recordBootRestart is the shared admission boundary for every boot
    // restart channel — it refuses while maintenance is held or a blocked
    // import journal persists, and returns {ok:false} instead of a snapshot.
    const outcome = await recordBootRestart();
    if (outcome && outcome.ok === false) {
      return outcome;
    }
    return harness ? harness.snapshot() : dsh.snapshot();
  });

  handle('shell:cancel-restart', () => (
    harness ? harness.cancelRecovery() : dsh.snapshot()
  ));

  handle('shell:save-boot-log', async () => {
    const { formatBootLogDump, saveBootLog } = require('./boot-log-dump');
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

  handle('shell:pick-workspace-directory', (_event, options = {}) => {
    if (options === null || typeof options !== 'object'
      || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)) {
      throw new Error('Workspace directory options must be a plain object');
    }
    if (options.title !== undefined && typeof options.title !== 'string') {
      throw new Error('Workspace directory title must be a string');
    }
    if (options.defaultPath !== undefined && (typeof options.defaultPath !== 'string'
      || options.defaultPath.includes('\0') || !path.isAbsolute(options.defaultPath))) {
      throw new Error('Workspace directory defaultPath must be an absolute path without NUL');
    }

    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Workspace directory picker requires a live main window');
    }
    if (pendingWorkspaceDirectoryDialog?.window === mainWindow) {
      // A replacement flow must not adopt a result requested by an older flow.
      return pendingWorkspaceDirectoryDialog.promise.then(() => null);
    }
    const dialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: options.defaultPath ?? (loadConfig().workspace || app.getPath('home')),
      ...(options.title === undefined ? {} : { title: options.title }),
    };
    // The BrowserWindow owns the native dialog; the authorized caller lives in
    // its Harness BrowserView. Only the initiating request receives its selection.
    const pending = { window: mainWindow, promise: null };
    pending.promise = Promise.resolve().then(async () => {
      if (mainWindow.isDestroyed()) return null;
      try {
        const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
        return mainWindow.isDestroyed() || result.canceled ? null : (result.filePaths[0] || null);
      } catch (error) {
        if (mainWindow.isDestroyed()) return null;
        throw error;
      }
    }).finally(() => {
      if (pendingWorkspaceDirectoryDialog === pending) pendingWorkspaceDirectoryDialog = null;
    });
    pendingWorkspaceDirectoryDialog = pending;
    return pending.promise;
  });

  handle('shell:open-settings', (_event, sectionId) => openHarnessSettings(sectionId));
  handle('shell:reload-page', () => reloadPage());

  // 桌宠 settings writes: the settings page lives in this window (section
  // `pet`), and every change must route through the pet manager so it
  // normalizes, persists, and pushes to the live pet window at once —
  // `live2dPet` stays off the generic save-config whitelist for that reason.
  handle('shell:live2d-pet-settings', (_event, payload) => {
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

  handle('shell:open-launcher', async (event) => {
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

  handle('shell:open-dsh-home', () => require('./open-dsh-home').openDesktopDshHome());

  handle('shell:list-marketplace', async (_event, options = {}) => {
    return require('./marketplace-catalog').listMarketplace({
      refresh: Boolean(options && options.refresh),
      locale: options?.locale,
    });
  });

  handle('shell:refresh-marketplace', async (_event, options = {}) => {
    return require('./marketplace-catalog').listMarketplace({
      refresh: true,
      locale: options?.locale,
    });
  });

  handle('shell:list-wallpaper-catalog', async (_event, query = {}) => (
    require('./wallpaper-catalog').listWallpaperCatalog(wallpaperCatalogQuery(query))
  ));

  handle('shell:download-wallpaper', async (_event, url) => {
    if (typeof url !== 'string') return { error: '壁纸地址无效' };
    return require('./wallpaper-catalog').downloadWallpaper(url);
  });

  handle('shell:list-installed-plugins', () => require('./marketplace-install').listInstalledPlugins());
  handle('shell:marketplace-state', () => require('./marketplace-state').listMarketplaceState());
  handle('shell:marketplace-details', (_event, id, options = {}) => require('./marketplace-details').getMarketplaceDetails(id, { force: options?.force === true }));
  handle('shell:marketplace-favorite', (_event, id, favorite) => require('./marketplace-state').setMarketplaceFavorite(id, favorite));

  handle('shell:check-marketplace-updates', (_event, options = {}) => {
    const config = loadConfig();
    return require('./marketplace-updates').checkMarketplaceUpdates({
      force: Boolean(options?.force),
      refresh: Boolean(options?.refresh),
      token: config.githubToken,
    });
  });

  handle('shell:install-plugin', async (event, spec, options = {}) => {
    const config = loadConfig();
    const result = await require('./marketplace-install').installPlugin(spec, {
      token: config.githubToken,
      allowBuilds: Array.isArray(options?.allowBuilds) ? options.allowBuilds : [],
      onProgress: (payload) => sendPluginProgress(event, payload),
    });
    return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_ADD);
  });

  handle('shell:install-marketplace-plugin', async (event, id, options = {}) => {
    const config = loadConfig();
    const { recordMarketplaceOperation } = require('./marketplace-state');
    const { installMarketplacePlugin } = require('./marketplace-install');
    return recordMarketplaceOperation('install', id, async record => {
      const result = await installMarketplacePlugin(id, {
        token: config.githubToken,
        allowBuilds: Array.isArray(options?.allowBuilds) ? options.allowBuilds : [],
        onProgress: payload => { record(payload); sendPluginProgress(event, payload); },
      });
      return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_ADD);
    });
  });

  handle('shell:update-marketplace-plugin', async (event, id, options = {}) => {
    const config = loadConfig();
    const { recordMarketplaceOperation } = require('./marketplace-state');
    const { updateMarketplacePlugin } = require('./marketplace-install');
    return recordMarketplaceOperation('update', id, async record => {
      const result = await updateMarketplacePlugin(id, {
        token: config.githubToken,
        allowBuilds: Array.isArray(options?.allowBuilds) ? options.allowBuilds : [],
        onProgress: payload => { record(payload); sendPluginProgress(event, payload); },
      });
      return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_UPDATE);
    });
  });

  handle('shell:update-marketplace-plugins', async (event, ids) => {
    const config = loadConfig();
    const { recordMarketplaceOperation } = require('./marketplace-state');
    const { updateMarketplacePlugins } = require('./marketplace-install');
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

  handle('shell:uninstall-plugin', async (event, name) => {
    const { recordMarketplaceOperation } = require('./marketplace-state');
    const { uninstallPlugin } = require('./marketplace-install');
    return recordMarketplaceOperation('uninstall', name, async record => {
      const result = await uninstallPlugin(name, {
        onProgress: payload => { record(payload); sendPluginProgress(event, payload); },
      });
      return restartAfterProfileWrite(event, result, startHarness, HARNESS_DOWN_AFTER_REMOVE, harness, true);
    });
  });

  handle('shell:open-marketplace', () => openMarketplace());

  // Every shell:git-* listener is guarded: a thrown handler error resolves to
  // the channel's failure payload instead of rejecting the renderer invoke,
  // which would strand the titlebar progress toast in the loading state.
  // The webContents id owns the refresh read context: the three sibling reads
  // of one titlebar refresh share it, and no other window can pick it up.
  const git = () => require('./git');
  handle('shell:git-status', guardGitIpc((event, cwd) => git().gitStatus(cwd, event.sender.id), gitIpcNull));
  handle('shell:git-fetch-status', guardGitIpc((event, cwd) => git().gitFetchForStatus(cwd, event.sender.id), gitIpcNull));
  handle('shell:git-pull-request', guardGitIpc((event, cwd) => git().gitReadPullRequest(cwd, event.sender.id)));
  handle('shell:git-init', guardGitIpc((_event, cwd) => git().gitInit(cwd)));
  handle('shell:git-diff', guardGitIpc((_event, cwd, options) => git().gitDiff(cwd, options), gitIpcNull));
  // Read-only pre-commit size probe for the commit dialog. Same guard as the
  // other Git reads so a cwd outside the authorized roots cannot be scanned.
  handle('shell:git-check-large-files', guardGitIpc((_event, cwd) => git().gitCheckLargeFiles(cwd), gitIpcNull));
  const sendGitProgress = (event, actionId) => (progress) => {
    if (actionId == null || event.sender.isDestroyed()) return;
    event.sender.send('shell:git-progress', { actionId, ...progress });
  };
  handle('shell:git-commit', guardGitIpc((event, cwd, message, filePaths, actionId, options) => (
    git().gitCommit(cwd, message, filePaths, sendGitProgress(event, actionId), options)
  )));
  handle('shell:git-push', guardGitIpc((event, cwd, actionId) => git().gitPush(cwd, sendGitProgress(event, actionId))));
  handle('shell:git-pull', guardGitIpc((event, cwd, actionId) => git().gitPull(cwd, sendGitProgress(event, actionId))));
  handle('shell:git-create-change-request', guardGitIpc((event, cwd, input, actionId) => (
    git().gitCreateChangeRequest(cwd, input, sendGitProgress(event, actionId))
  )));
  handle('shell:git-publish', guardGitIpc((event, cwd, input, actionId) => (
    git().gitPublishRepository(cwd, input, sendGitProgress(event, actionId))
  )));
  // Not a git channel, but ui-git consumes it as the same `{ ok, message }`
  // failure payload from the commit dialog's file rows.
  handle('shell:open-workspace-path', guardGitIpc((_event, cwd, relativePath) => git().openWorkspacePath(cwd, relativePath)));
  handle('shell:list-dir', (_event, cwd, relativePath) => require('./workspace-fs').listDir(cwd, relativePath));
  handle('shell:read-file', (_event, cwd, relativePath) => require('./workspace-fs').readFile(cwd, relativePath));
  handle('shell:read-file-media', (_event, cwd, relativePath) => require('./workspace-fs').readFileMedia(cwd, relativePath));
  handle('shell:write-file', (_event, cwd, relativePath, text) => require('./workspace-fs').writeFile(cwd, relativePath, text));
  handle('shell:list-editors', () => require('./editors').listAvailableEditors());
  handle('shell:open-in-editor', (_event, input) => require('./editors').openInEditor(input));
  handle('shell:show-item-in-folder', (_event, cwd, relativePath) => require('./editors').revealInFolder(cwd, relativePath));
  handle('shell:open-with-default', (_event, cwd, relativePath) => (
    require('./editors').openWithSystemDefault({ cwd, relativePath })
  ));
  handle('shell:git-stage', guardGitIpc((_event, cwd, relativePath) => git().gitStage(cwd, relativePath)));
  handle('shell:git-stage-patch', guardGitIpc((/** @type {unknown} */ _event, /** @type {unknown} */ cwd, /** @type {unknown} */ patchText) => git().gitStagePatch(cwd, patchText)));
  handle('shell:git-unstage', guardGitIpc((_event, cwd, relativePath) => git().gitUnstage(cwd, relativePath)));
  handle('shell:git-unstage-patch', guardGitIpc((/** @type {unknown} */ _event, /** @type {unknown} */ cwd, /** @type {unknown} */ patchText) => git().gitUnstagePatch(cwd, patchText)));
  handle('shell:git-discard', guardGitIpc((_event, cwd, relativePath) => git().gitDiscard(cwd, relativePath)));
  handle('shell:git-status-entries', guardGitIpc((_event, cwd) => git().gitStatusEntries(cwd)));
  handle('shell:git-branch-list', guardGitIpc((_event, cwd) => git().gitBranchList(cwd)));
  handle('shell:git-switch-branch', guardGitIpc((_event, cwd, ref) => git().gitSwitchBranch(cwd, ref)));
  handle('shell:git-create-branch', guardGitIpc((_event, cwd, name) => git().gitCreateBranch(cwd, name)));
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

  handle('shell:get-remote', async () => {
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

  handle('shell:save-remote', async (_event, patch) => {
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

  handle('shell:rotate-remote-token', async () => {
    if (!REMOTE_FEATURE_ENABLED) {
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    if (remote && typeof remote.rotateToken === 'function') {
      return remote.rotateToken();
    }
    return null;
  });

  handle('shell:revoke-remote-pairing-link', async () => {
    if (!REMOTE_FEATURE_ENABLED) {
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    if (remote && typeof remote.revokePairingLink === 'function') {
      return remote.revokePairingLink();
    }
    return null;
  });

  handle('shell:unbind-remote-device', async (_event, id) => {
    if (!REMOTE_FEATURE_ENABLED) {
      return parkRemoteSnapshot(remote && typeof remote.snapshot === 'function' ? remote.snapshot() : {});
    }
    if (remote && typeof remote.unbindDevice === 'function') {
      return remote.unbindDevice(id);
    }
    return remote ? remote.snapshot() : null;
  });

  handle('shell:rename-remote-device', async (_event, id, name) => {
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
