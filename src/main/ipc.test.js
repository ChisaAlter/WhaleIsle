const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { IPC_ROLES } = require('./ipc-authorization');
const launcherGate = require('./launcher-gate');
const pluginForensics = require('./plugin-forensics');

const ipcPath = require.resolve('./ipc');
// profile-ops is ipc.js's delegate for plugin/config mutations: it is NOT
// stubbed, so it must reload per loadIpc call or it would keep the first
// test's stubbed './config' closures forever.
const profileOpsPath = require.resolve('./profile-ops');
// Same for the launcher service: it binds the same stubbed leaf modules, so
// it must reload with ipc.js or it keeps the first call's stubs.
const launcherServicePath = require.resolve('../launcher/launcher-service');
// Same for the shared launcher-channel table: it binds the same stubbed leaf
// modules and must reload with ipc.js.
const ipcLauncherPath = require.resolve('./ipc-launcher');

function harnessEvent(progress = []) {
  return {
    role: IPC_ROLES.HARNESS,
    sender: {
      isDestroyed: () => false,
      send(channel, payload) {
        progress.push({ channel, payload });
      },
    },
  };
}

function leftoverMarketplaceEvent() {
  return {
    role: 'marketplace',
    sender: {
      isDestroyed: () => true,
      send() {},
    },
  };
}

function bootEvent() {
  return {
    role: IPC_ROLES.BOOT,
    sender: {
      isDestroyed: () => false,
      send() {},
    },
  };
}

function launcherEvent(progress) {
  return {
    role: IPC_ROLES.LAUNCHER,
    sender: {
      isDestroyed: () => false,
      send(channel, payload) {
        if (progress) progress.push({ channel, payload });
      },
    },
  };
}

function stubModule(id, exports) {
  const filename = require.resolve(id);
  const previous = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
  return { filename, previous };
}

function gitStubs() {
  return {
    gitBranchList() {},
    gitCommit() {},
    gitCreateBranch() {},
    gitCreateChangeRequest() {},
    gitDiff() {},
    gitDiscard() {},
    gitFetchForStatus() {},
    gitInit() {},
    gitPublishRepository() {},
    gitPull() {},
    gitPush() {},
    gitReadPullRequest() {},
    gitStage() {},
    gitStatus() {},
    gitStatusEntries() {},
    gitSwitchBranch() {},
    gitUnstage() {},
    openWorkspacePath() {},
  };
}

function loadIpc(options = {}) {
  const restoreEntries = [];
  const handlers = new Map();
  const openedPaths = [];
  const listMarketplaceCalls = [];
  const listWallpaperCatalogCalls = [];
  const installMarketplaceCalls = [];
  const installPluginCalls = [];
  const uninstallCalls = [];
  const saveConfigCalls = [];
  const disabledBundleCalls = [];
  let startHarnessCalls = 0;
  const installResult = options.installResult || { ok: true };
  const startHarnessImpl = options.startHarness || (async () => {});

  function stub(id, exports) {
    restoreEntries.push(stubModule(id, exports));
  }

  stub('electron', {
    ipcMain: {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
    dialog: {
      showSaveDialog: options.showSaveDialog || (async () => ({ canceled: true })),
      showOpenDialog: options.showOpenDialog || (async () => ({ canceled: true, filePaths: [] })),
    },
    app: {
      setLoginItemSettings() {},
      getPath: options.getPath || ((name) => (name === 'downloads' ? '/tmp/downloads' : '/tmp')),
    },
    shell: {
      openExternal: async () => true,
      openPath: options.openPath || (async (target) => {
        openedPaths.push(target);
        return '';
      }),
    },
    nativeTheme: { shouldUseDarkColors: false },
  });
  stub('./config', {
    REMOTE_FEATURE_ENABLED: options.remoteFeatureEnabled ?? false,
    loadConfig: () => ({
      githubToken: 'secret-token',
      locale: 'zh',
      theme: 'midnight',
      workspace: '',
      ...(options.config || {}),
    }),
    saveConfig: (patch) => {
      saveConfigCalls.push(patch);
      return patch;
    },
    publicConfig: (config) => ({ theme: config.theme }),
    parkRemoteSnapshot: (snap) => ({
      ...(snap && typeof snap === 'object' ? snap : {}),
      available: false,
      enabled: false,
      listening: false,
      urls: [],
      token: '',
    }),
    normalizeRendererConfigPatch: (patch) => patch || {},
    normalizeLauncherConfigPatch: (patch) => patch || {},
    credentialStorageMode: options.credentialStorageMode || (() => 'encrypted'),
  });
  stub('./window', {
    getMainWindow: options.getMainWindow || (() => null),
    getHarnessWebContents: options.getHarnessWebContents || (() => null),
    getLauncherWindow: () => null,
    hideHarnessView: options.hideHarnessView || (() => {}),
    dismissMainWindow: options.dismissMainWindow || (() => false),
    openHarnessSettings() {},
    openMarketplace() {},
    openRemote() {},
  });
  stub('./dsh', {
    resolveNodeBin: () => 'node',
    resolveDshBin: () => 'dsh',
    sourceHarnessStatus: () => ({ present: false, built: false, root: '' }),
    ...(options.dshDeps || {}),
  });
  stub('../shared/themes', {
    listThemes: () => [],
    resolveTheme: () => ({}),
  });
  stub('./chrome', { applyAppTheme() {} });
  stub('./update', {
    checkUpdate() { return {}; },
    installUpdate: async () => ({}),
    listReleases: async () => ({ status: 'ok', releases: [], installed: { version: '0.0.0' } }),
    installRelease: async () => ({ status: 'error', message: 'no-installer', launched: false }),
    launchUninstaller: options.launchUninstaller || (() => ({ ok: true })),
    currentVersion: () => '0.0.0',
    REPO_URL: '',
    RELEASES_PAGE: '',
  });
  const runtimeInstallCalls = [];
  stub('../launcher/runtime-install', {
    installedInfo: () => ({ registeredInstall: false, version: '', installPath: '' }),
    invalidateInstalledCache() {},
    configuredRoute: () => '',
    checkDesktopUpdate: async () => ({ status: 'none' }),
    installRuntime: async (opts, onProgress) => {
      runtimeInstallCalls.push(opts);
      if (onProgress) onProgress({ phase: 'resolve', percent: 0 });
      return { ok: true, status: 'installed', installed: { version: '9.9.9' } };
    },
    cancelRuntimeInstall: () => ({ ok: true }),
    probeDesktopRunning: () => false,
    startExternalDesktop: () => ({ ok: true, external: true }),
    stopExternalDesktop: async () => ({ ok: true, stopped: false }),
    ...(options.runtimeInstall || {}),
  });
  const scanImportCalls = [];
  const runImportCalls = [];
  stub('./data-import', {
    scanImport: (opts) => {
      scanImportCalls.push(opts);
      return {
        ok: true, destEmpty: true, sourceHasData: false, sessions: [], plugins: [], skills: [], mcp: [], settings: [], presets: [],
      };
    },
    probeImportHold: () => ({ destEmpty: true, sourceHasData: false, hold: false }),
    runImport: options.runImport || (async (opts) => {
      runImportCalls.push(opts);
      return {
        ok: true, empty: true, sessions: [], skills: [], plugins: [], mcp: [], settings: [], credentials: [], presets: [],
      };
    }),
    // readImportJournal/journalIsBlocked must exist: the shared restart
    // admission boundary (recordBootRestart) calls them, and a missing export
    // would throw inside its try/catch and fail closed. Default to a clean
    // (no-journal) read; tests that exercise the blocked path can override.
    readImportJournal: options.readImportJournal || (() => null),
    journalIsBlocked: options.journalIsBlocked || ((j) => Boolean(j && (j.phase === 'blocked' || j.unreadable === true))),
  });
  stub('./plugin-forensics', {
    inspectPlugins: options.inspectPlugins || (() => ({ genericCause: null, suspects: [], plugins: [] })),
    isPresetPlugin: () => false,
  });
  stub('./plugins', {
    listInstalledPlugins: options.listInstalledPlugins || (() => ({ plugins: [], bundles: [] })),
    applyDisabledBundles: (names) => {
      disabledBundleCalls.push(names);
      return { ok: true, changed: false, bundles: [] };
    },
    setBundleEnabled: () => ({ ok: true, changed: false }),
    OFFICIAL_TEMPLATE_BUNDLES: new Set(['@deepseek-ai/dsh-base']),
  });
  const lastStartWrites = [];
  stub('./launcher-gate', {
    ...launcherGate,
    readLastDesktopStart: options.readLastDesktopStart || (() => ({ ok: true, at: '', error: '' })),
    recordLastDesktopStart: async (_dir, work) => {
      try {
        const value = await work();
        lastStartWrites.push({ ok: true });
        return value;
      } catch (error) {
        lastStartWrites.push({ ok: false, error: error && error.message ? error.message : String(error) });
        throw error;
      }
    },
  });
  stub('./marketplace-catalog', {
    listMarketplace: async (opts) => {
      listMarketplaceCalls.push(opts);
      return { ok: true, items: [] };
    },
  });
  stub('./marketplace-state', {
    listMarketplaceState: () => ({ ok: true, favorites: [], operations: [] }),
    setMarketplaceFavorite: (id, favorite) => ({ ok: true, favorites: favorite ? [id] : [], operations: [] }),
    recordMarketplaceOperation: async (_kind, _target, work) => work(() => {}),
    redactMarketLog: value => String(value || ''),
  });
  stub('./marketplace-details', { getMarketplaceDetails: async () => ({ ok: true, readme: '', requirements: [] }) });
  stub('./marketplace-updates', { checkMarketplaceUpdates: async () => ({ ok: true, updates: {} }) });
  stub('./wallpaper-catalog', {
    listWallpaperCatalog: async (query) => {
      listWallpaperCatalogCalls.push(query);
      return { items: [] };
    },
    downloadWallpaper: async () => ({}),
  });
  stub('./marketplace-install', {
    updateMarketplacePlugin: async () => options.updateResult || { ok: true },
    updateMarketplacePlugins: async () => options.batchResult || { ok: true, changed: true, results: [] },
    listInstalledPlugins: () => ({ plugins: [] }),
    installPlugin: async (spec, opts) => {
      installPluginCalls.push({ spec, options: opts });
      return { ok: true };
    },
    uninstallPlugin: async (name, opts) => {
      uninstallCalls.push({ name, options: opts });
      return options.uninstallResult || { ok: true };
    },
    installMarketplacePlugin: async (id, opts) => {
      installMarketplaceCalls.push({ id, options: opts });
      return installResult;
    },
    installImportPlugin: async () => ({ ok: true }),
  });
  stub('./git', { ...gitStubs(), ...(options.git || {}) });
  const workspaceWatch = { onChange: null, stopped: 0 };
  stub('./git-workspace-watch', {
    watchWorkspaceRegistrations: (onChange) => {
      workspaceWatch.onChange = onChange;
      return () => {
        workspaceWatch.stopped += 1;
      };
    },
  });
  stub('./preview', { registerPreviewIpc: () => ({}) });
  stub('./pty', { registerPtyIpc: () => ({}) });
  stub('./workspace-fs', {
    listDir() { return []; },
    readFile() { return ''; },
    readFileMedia() { return null; },
    writeFile() {},
  });
  stub('./ipc-authorization', {
    IPC_ROLES,
    assertIpcSender(event, roles) {
      const allowed = new Set(roles);
      if (!event?.role || !allowed.has(event.role)) {
        const error = new Error('Unauthorized IPC sender');
        error.code = 'ERR_DSH_IPC_SENDER';
        throw error;
      }
      return event.role;
    },
  });

  const previousIpc = require.cache[ipcPath];
  const previousProfileOps = require.cache[profileOpsPath];
  const previousLauncherService = require.cache[launcherServicePath];
  const previousIpcLauncher = require.cache[ipcLauncherPath];
  delete require.cache[ipcPath];
  delete require.cache[profileOpsPath];
  delete require.cache[launcherServicePath];
  delete require.cache[ipcLauncherPath];
  let startDesktopCalls = 0;
  const startDesktopArgs = [];
  const { registerIpc } = require('./ipc');
  registerIpc({
    dsh: options.dsh || { snapshot: () => ({}), logs: [] },
    harness: options.harness || null,
    startHarness: async () => {
      startHarnessCalls += 1;
      return startHarnessImpl();
    },
    startDesktop: async (opts) => {
      startDesktopCalls += 1;
      startDesktopArgs.push(opts || {});
      return options.startDesktop ? options.startDesktop(opts || {}) : { ok: true };
    },
    stopDesktopCleanup: options.stopDesktopCleanup,
    remote: options.remote === undefined ? null : options.remote,
    onOpenLauncher: options.onOpenLauncher,
    getLive2dPet: options.getLive2dPet,
  });

  async function invoke(channel, event, ...args) {
    const listener = handlers.get(channel);
    assert.equal(typeof listener, 'function', `missing ${channel}`);
    return listener(event, ...args);
  }

  function restore() {
    delete require.cache[ipcPath];
    delete require.cache[profileOpsPath];
    delete require.cache[launcherServicePath];
    delete require.cache[ipcLauncherPath];
    if (previousIpc) require.cache[ipcPath] = previousIpc;
    if (previousProfileOps) require.cache[profileOpsPath] = previousProfileOps;
    if (previousLauncherService) require.cache[launcherServicePath] = previousLauncherService;
    if (previousIpcLauncher) require.cache[ipcLauncherPath] = previousIpcLauncher;
    for (const { filename, previous } of restoreEntries) {
      if (previous) require.cache[filename] = previous;
      else delete require.cache[filename];
    }
  }

  return {
    handlers,
    invoke,
    restore,
    listMarketplaceCalls,
    listWallpaperCatalogCalls,
    installMarketplaceCalls,
    installPluginCalls,
    uninstallCalls,
    saveConfigCalls,
    disabledBundleCalls,
    openedPaths,
    startHarness() {
      return startHarnessCalls;
    },
    startDesktop() {
      return startDesktopCalls;
    },
    startDesktopArgs,
    scanImportCalls,
    runImportCalls,
    lastStartWrites,
    workspaceWatch,
    runtimeInstallCalls,
  };
}

test('shell:git-branch-list resolves the guard failure payload when the handler throws', async () => {
  const ipc = loadIpc({
    git: {
      gitBranchList: async () => {
        throw new Error('registry walk exploded');
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:git-branch-list', harnessEvent(), '/work');
    assert.deepEqual(result, { ok: false, message: 'registry walk exploded' });
  } finally {
    ipc.restore();
  }
});

test('batch marketplace IPC restarts exactly once after committed writes, even with partial failures', async () => {
  for (const ok of [true, false]) {
    const ipc = loadIpc({ batchResult: { ok, changed: true, results: [{ id: 'a', ok: true }, { id: 'b', ok }] } });
    try {
      const result = await ipc.invoke('shell:update-marketplace-plugins', harnessEvent(), ['a', 'b']);
      assert.equal(ipc.startHarness(), 1);
      assert.equal(result.ok, ok);
      assert.equal(result.harnessStarted, true);
    } finally { ipc.restore(); }
  }
});

test('batch marketplace IPC never restarts after rollback failure or no writes', async () => {
  for (const batchResult of [{ ok: false, changed: false }, { ok: false, changed: true, rollbackFailed: true }]) {
    const ipc = loadIpc({ batchResult });
    try {
      const result = await ipc.invoke('shell:update-marketplace-plugins', harnessEvent(), ['a']);
      assert.equal(result.ok, false);
      assert.equal(ipc.startHarness(), 0);
    } finally { ipc.restore(); }
  }
});

test('marketplace state, details, favorites and batch IPC are unavailable to boot and launcher renderers', async () => {
  const ipc = loadIpc();
  try {
    for (const channel of ['shell:marketplace-state', 'shell:marketplace-details', 'shell:marketplace-favorite', 'shell:update-marketplace-plugins']) {
      for (const event of [bootEvent(), launcherEvent()]) {
        await assert.rejects(() => ipc.invoke(channel, event, 'acme/demo'), error => error.code === 'ERR_DSH_IPC_SENDER');
      }
    }
  } finally { ipc.restore(); }
});

test('shell:git-status resolves null instead of rejecting when the handler throws', async () => {
  const ipc = loadIpc({
    git: {
      gitStatus: async () => {
        throw new Error('porcelain exploded');
      },
    },
  });
  try {
    assert.equal(await ipc.invoke('shell:git-status', harnessEvent(), '/work'), null);
  } finally {
    ipc.restore();
  }
});

test('a workspace registry change pushes shell:git-workspaces-changed to the harness', async () => {
  const sent = [];
  const ipc = loadIpc({
    getHarnessWebContents: () => ({
      isDestroyed: () => false,
      send(channel, payload) {
        sent.push({ channel, payload });
      },
    }),
  });
  try {
    assert.equal(typeof ipc.workspaceWatch.onChange, 'function');
    ipc.workspaceWatch.onChange();
    assert.deepEqual(sent, [{ channel: 'shell:git-workspaces-changed', payload: undefined }]);
  } finally {
    ipc.restore();
  }
});

test('a workspace registry change without a live harness webContents is a no-op', async () => {
  const destroyedSent = [];
  for (const getHarnessWebContents of [
    () => null,
    () => ({
      isDestroyed: () => true,
      send(channel) {
        destroyedSent.push(channel);
      },
    }),
  ]) {
    const ipc = loadIpc({ getHarnessWebContents });
    try {
      ipc.workspaceWatch.onChange();
    } finally {
      ipc.restore();
    }
  }
  assert.deepEqual(destroyedSent, []);
});

test('shell:list-marketplace forwards locale and refresh without a GitHub token', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke('shell:list-marketplace', harnessEvent(), {
      locale: 'en',
      refresh: true,
      token: 'renderer-token',
    });
    assert.equal(ipc.listMarketplaceCalls.length, 1);
    assert.deepEqual(ipc.listMarketplaceCalls[0], { locale: 'en', refresh: true });
  } finally {
    ipc.restore();
  }
});

test('shell:refresh-marketplace forwards locale without defaulting to zh', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke('shell:refresh-marketplace', harnessEvent());
    await ipc.invoke('shell:refresh-marketplace', harnessEvent(), { locale: 'en', token: 'renderer-token' });
    assert.deepEqual(ipc.listMarketplaceCalls, [
      { locale: undefined, refresh: true },
      { locale: 'en', refresh: true },
    ]);
  } finally {
    ipc.restore();
  }
});

test('marketplace catalog and plugin channels reject marketplace senders', async () => {
  const ipc = loadIpc();
  try {
    const sender = leftoverMarketplaceEvent();
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:list-marketplace', sender, {}), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:refresh-marketplace', sender), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:list-installed-plugins', sender), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:uninstall-plugin', sender, 'pkg'), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:install-marketplace-plugin', sender, 'owner/name'), unauthorized);
  } finally {
    ipc.restore();
  }
});

test('config surfaces reject leftover marketplace senders', async () => {
  const ipc = loadIpc();
  try {
    const sender = leftoverMarketplaceEvent();
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:get-config', sender), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:save-config', sender, { theme: 'midnight' }), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:open-external', sender, 'https://example.com'), unauthorized);
  } finally {
    ipc.restore();
  }
});

test('shell:live2d-pet-settings routes writes through the pet manager', async () => {
  let enabled = true;
  const calls = [];
  const pet = {
    isEnabled: () => enabled,
    setEnabled: (next) => { enabled = next === true; calls.push(['enabled', enabled]); },
    applySettings: (body) => { calls.push(['apply', body]); return { scale: 1.4 }; },
    getSettings: () => ({ scale: 1 }),
  };
  const ipc = loadIpc({ getLive2dPet: () => pet });
  try {
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(
      () => ipc.invoke('shell:live2d-pet-settings', leftoverMarketplaceEvent(), {}),
      unauthorized,
    );
    // enabled + patch in one write: the toggle lands first, then the patch.
    const res = await ipc.invoke('shell:live2d-pet-settings', harnessEvent(),
      { enabled: false, patch: { scale: 1.4 } });
    assert.deepEqual(calls[0], ['enabled', false]);
    assert.deepEqual(calls[1], ['apply', { enabled: false, patch: { scale: 1.4 } }]);
    assert.deepEqual(res, { ok: true, enabled: false, settings: { scale: 1.4 } });
    // No patch/reset → a read-only echo of the manager's settings.
    const echo = await ipc.invoke('shell:live2d-pet-settings', harnessEvent(), {});
    assert.deepEqual(echo, { ok: true, enabled: false, settings: { scale: 1 } });
    // A reset body goes through applySettings even alongside no patch.
    await ipc.invoke('shell:live2d-pet-settings', harnessEvent(), { reset: true });
    assert.deepEqual(calls.at(-1), ['apply', { reset: true }]);
  } finally {
    ipc.restore();
  }
});

test('shell:live2d-pet-settings reports unavailable without a pet manager', async () => {
  const ipc = loadIpc({ getLive2dPet: () => null });
  try {
    const res = await ipc.invoke('shell:live2d-pet-settings', harnessEvent(), { patch: { scale: 1.4 } });
    assert.deepEqual(res, { ok: false, reason: 'unavailable' });
  } finally {
    ipc.restore();
  }
});

test('shell:seed-install-draft is not registered', () => {
  const ipc = loadIpc();
  try {
    assert.equal(ipc.handlers.has('shell:seed-install-draft'), false);
  } finally {
    ipc.restore();
  }
});

test('shell:install-marketplace-plugin passes allowBuilds token and onProgress only', async () => {
  const ipc = loadIpc();
  try {
    const progress = [];
    const runPlugin = () => {};
    await ipc.invoke(
      'shell:install-marketplace-plugin',
      harnessEvent(progress),
      'owner/name',
      { allowBuilds: ['pkg'], runPlugin, token: 'renderer-token' },
    );
    assert.equal(ipc.installMarketplaceCalls.length, 1);
    assert.equal(ipc.installMarketplaceCalls[0].id, 'owner/name');
    const opts = ipc.installMarketplaceCalls[0].options;
    assert.deepEqual(Object.keys(opts).sort(), ['allowBuilds', 'onProgress', 'token']);
    assert.deepEqual(opts.allowBuilds, ['pkg']);
    assert.equal(opts.token, 'secret-token');
    assert.equal(typeof opts.onProgress, 'function');
    assert.equal(ipc.startHarness(), 1);
    opts.onProgress({ phase: 'start', line: 'installing' });
    assert.deepEqual(progress.at(-1), {
      channel: 'shell:plugin-progress',
      payload: { phase: 'start', line: 'installing' },
    });
  } finally {
    ipc.restore();
  }
});

test('shell:install-marketplace-plugin does not restart harness when install fails', async () => {
  const ipc = loadIpc({ installResult: { ok: false, error: '未收录该插件' } });
  try {
    const result = await ipc.invoke(
      'shell:install-marketplace-plugin',
      harnessEvent(),
      'missing/plugin',
      { allowBuilds: [], runPlugin: () => {} },
    );
    assert.equal(result.ok, false);
    assert.equal(ipc.startHarness(), 0);
  } finally {
    ipc.restore();
  }
});

test('shell:install-marketplace-plugin does not restart harness for needsAllowBuilds', async () => {
  const ipc = loadIpc({ installResult: { ok: false, needsAllowBuilds: true, allowBuilds: ['pkg'] } });
  try {
    const result = await ipc.invoke(
      'shell:install-marketplace-plugin',
      harnessEvent(),
      'owner/name',
    );
    assert.equal(result.ok, false);
    assert.equal(result.needsAllowBuilds, true);
    assert.equal(ipc.startHarness(), 0);
  } finally {
    ipc.restore();
  }
});

test('shell:install-marketplace-plugin keeps ok when startHarness throws', async () => {
  const ipc = loadIpc({
    installResult: { ok: true, spec: 'dsh-loop' },
    startHarness: async () => {
      throw new Error('spawn failed');
    },
  });
  try {
    const result = await ipc.invoke(
      'shell:install-marketplace-plugin',
      harnessEvent(),
      'owner/name',
    );
    assert.equal(result.ok, true);
    assert.equal(result.harnessStarted, false);
    assert.match(String(result.error), /web profile/);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});

test('shell:uninstall-plugin keeps ok when startHarness throws', async () => {
  const ipc = loadIpc({
    startHarness: async () => {
      throw new Error('spawn failed');
    },
  });
  try {
    const result = await ipc.invoke('shell:uninstall-plugin', harnessEvent(), 'pkg');
    assert.equal(result.ok, true);
    assert.equal(result.harnessStarted, false);
    assert.match(String(result.error), /移除/);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});

test('shell:install-plugin keeps ok when startHarness throws', async () => {
  const ipc = loadIpc({
    startHarness: async () => {
      throw new Error('spawn failed');
    },
  });
  try {
    const result = await ipc.invoke('shell:install-plugin', harnessEvent(), 'github:owner/repo');
    assert.equal(result.ok, true);
    assert.equal(result.harnessStarted, false);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});

test('shell:install-plugin does not spread renderer options onto the installer', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke(
      'shell:install-plugin',
      harnessEvent(),
      'github:acme/demo',
      { allowBuilds: ['demo'], runPlugin: () => {}, token: 'renderer-token' },
    );
    const opts = ipc.installPluginCalls[0].options;
    assert.deepEqual(Object.keys(opts).sort(), ['allowBuilds', 'onProgress', 'token']);
    assert.equal(opts.token, 'secret-token');
    assert.equal(opts.runPlugin, undefined);
  } finally {
    ipc.restore();
  }
});

test('shell:list-wallpaper-catalog forwards a kind query and coerces numbers', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke('shell:list-wallpaper-catalog', harnessEvent(), {
      kind: 'wallhaven',
      year: '2024',
      url: 'https://example.com/pack.json',
      q: 'lake',
      categories: '010',
      page: '2',
    });
    await ipc.invoke('shell:list-wallpaper-catalog', harnessEvent(), {
      kind: 'nsfw',
      includeBing: true,
      catalogs: ['https://example.com/a.json'],
    });
    assert.equal(ipc.listWallpaperCatalogCalls.length, 2);
    const [wallhaven, rejected] = ipc.listWallpaperCatalogCalls;
    assert.equal(wallhaven.kind, 'wallhaven');
    assert.equal(wallhaven.year, 2024);
    assert.equal(typeof wallhaven.year, 'number');
    assert.equal(wallhaven.page, 2);
    assert.equal(typeof wallhaven.page, 'number');
    assert.equal(wallhaven.url, 'https://example.com/pack.json');
    assert.equal(wallhaven.q, 'lake');
    assert.equal(wallhaven.categories, '010');
    assert.equal(rejected.kind, undefined);
    assert.equal(rejected.includeBing, undefined);
    assert.equal(rejected.catalogs, undefined);
  } finally {
    ipc.restore();
  }
});

test('shell:save-boot-log is boot-only and writes dsh.logs not a renderer path', async () => {
  const dest = path.join(os.tmpdir(), `dshd-boot-ipc-${Date.now()}.log`);
  const logs = Array.from({ length: 81 }, (_, index) => `[app] line ${index + 1}`);
  const ipc = loadIpc({
    dsh: {
      logs,
      snapshot: () => ({
        state: 'error',
        error: 'Harness 启动失败',
        failure: { phase: 'startup', message: 'tar failed', code: null, signal: null, occurredAt: '2026-08-20T00:00:00.000Z' },
      }),
    },
    showSaveDialog: async () => ({ canceled: false, filePath: dest }),
  });
  try {
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:save-boot-log', harnessEvent()), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:save-boot-log', leftoverMarketplaceEvent()), unauthorized);

    const result = await ipc.invoke('shell:save-boot-log', bootEvent(), 'C:\\evil\\from-renderer.log');
    assert.equal(result.ok, true);
    assert.equal(result.canceled, false);
    assert.equal(result.path, dest);
    const body = fs.readFileSync(dest, 'utf8');
    assert.match(body, /\[app\] line 1\n/);
    assert.match(body, /\[app\] line 81\n/);
    assert.doesNotMatch(body, /from-renderer|evil/);
  } finally {
    ipc.restore();
    fs.rmSync(dest, { force: true });
  }
});

test('shell:get-remote reports unavailable for the disabled remote stub even when the feature flag is on', async () => {
  const { createDisabledRemote } = require('./remote');
  let syncCalls = 0;
  const remote = createDisabledRemote();
  const wrapped = {
    ...remote,
    sync() {
      syncCalls += 1;
      return remote.sync();
    },
  };
  const ipc = loadIpc({ remote: wrapped, remoteFeatureEnabled: true });
  try {
    const snap = await ipc.invoke('shell:get-remote', harnessEvent());
    assert.deepEqual(snap, {
      available: false,
      enabled: false,
      listening: false,
    });
    const saved = await ipc.invoke('shell:save-remote', harnessEvent(), { remoteEnabled: true });
    assert.equal(saved.available, false);
    assert.equal(saved.enabled, false);
    assert.equal(saved.listening, false);
    assert.equal(syncCalls, 1);
  } finally {
    ipc.restore();
  }
});

test('shell:get-remote reports available for a live gateway snapshot', async () => {
  const remote = {
    snapshot() {
      return { enabled: false, listening: false };
    },
    async sync() {
      return this.snapshot();
    },
  };
  const ipc = loadIpc({ remote, remoteFeatureEnabled: true });
  try {
    const snap = await ipc.invoke('shell:get-remote', harnessEvent());
    assert.equal(snap.available, true);
    assert.equal(snap.enabled, false);
    assert.equal(snap.listening, false);
  } finally {
    ipc.restore();
  }
});

test('shell:save-remote refuses credential and workspace fields', async () => {
  const remote = {
    snapshot() {
      return { enabled: true, listening: false };
    },
    async sync() {
      return this.snapshot();
    },
  };
  const ipc = loadIpc({ remote, remoteFeatureEnabled: true });
  try {
    await assert.rejects(
      () => ipc.invoke('shell:save-remote', harnessEvent(), {
        remoteEnabled: true,
        apiKey: 'sk-stolen',
        workspace: 'C:\\',
        githubToken: 'ghp_stolen',
      }),
      /not renderer-writable|must be/,
    );
    assert.equal(ipc.saveConfigCalls.length, 0);
    const saved = await ipc.invoke('shell:save-remote', harnessEvent(), {
      remoteEnabled: true,
      remoteMode: 'lan',
    });
    assert.equal(saved.enabled, true);
    assert.deepEqual(ipc.saveConfigCalls.at(-1), {
      remoteEnabled: true,
      remoteMode: 'lan',
    });
  } finally {
    ipc.restore();
  }
});

test('shell:get-remote stays unavailable when remote is null', async () => {
  const ipc = loadIpc({ remote: null, remoteFeatureEnabled: true });
  try {
    const snap = await ipc.invoke('shell:get-remote', harnessEvent());
    assert.deepEqual(snap, {
      available: false,
      enabled: false,
      listening: false,
    });
  } finally {
    ipc.restore();
  }
});

test('shell:get-config includes the bound desktop DSH home', async () => {
  const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
  const home = path.join(os.tmpdir(), 'dsh-home-config-view');
  setDesktopDshHome(home);
  const ipc = loadIpc();
  try {
    const config = await ipc.invoke('shell:get-config', harnessEvent());
    assert.equal(config.dshHome, path.resolve(home));
  } finally {
    ipc.restore();
    clearDesktopDshHome();
  }
});

test('shell:get-config exposes the credential storage mode for About diagnostics', async () => {
  const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
  setDesktopDshHome(path.join(os.tmpdir(), 'dsh-home-cred-view'));
  const encrypted = loadIpc();
  try {
    const config = await encrypted.invoke('shell:get-config', harnessEvent());
    assert.equal(config.credentialStorage, 'encrypted');
  } finally {
    encrypted.restore();
  }
  const plaintext = loadIpc({ credentialStorageMode: () => 'plaintext' });
  try {
    const config = await plaintext.invoke('shell:get-config', harnessEvent());
    assert.equal(config.credentialStorage, 'plaintext');
  } finally {
    plaintext.restore();
    clearDesktopDshHome();
  }
});

test('shell:open-dsh-home opens the bound home and ignores a renderer path', async () => {
  const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
  const home = path.join(os.tmpdir(), 'dsh-home-open-bound');
  setDesktopDshHome(home);
  const ipc = loadIpc();
  try {
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:open-dsh-home', bootEvent()), unauthorized);
    const result = await ipc.invoke('shell:open-dsh-home', harnessEvent(), 'C:\\evil\\from-renderer');
    assert.deepEqual(result, { ok: true, path: path.resolve(home) });
    assert.deepEqual(ipc.openedPaths, [path.resolve(home)]);
  } finally {
    ipc.restore();
    clearDesktopDshHome();
  }
});

test('shell:get-remote reports unavailable when the feature is parked', async () => {
  const remote = {
    snapshot() {
      return { available: true, enabled: true, listening: true, port: 3180, token: 'secret', urls: [{ pairingUrl: 'http://10.0.0.4:3180/#offer=x' }] };
    },
  };
  const ipc = loadIpc({ remote });
  try {
    const snap = await ipc.invoke('shell:get-remote', harnessEvent());
    assert.equal(snap.available, false);
    assert.equal(snap.enabled, false);
    assert.equal(snap.listening, false);
    assert.deepEqual(snap.urls, []);
    assert.equal(snap.token, '');
    const saved = await ipc.invoke('shell:save-remote', harnessEvent(), { remoteEnabled: true });
    assert.equal(saved.available, false);
    assert.equal(saved.enabled, false);
  } finally {
    ipc.restore();
  }
});

test('launcher-only import and release channels reject boot and harness senders', async () => {
  const ipc = loadIpc();
  try {
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:scan-import', bootEvent()), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:scan-import', harnessEvent()), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:run-import', bootEvent(), {}), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:install-release', harnessEvent(), 'v0.2.6'), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:install-runtime', harnessEvent(), {}), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:cancel-runtime-install', bootEvent()), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:disable-suspects-and-start', bootEvent(), ['user-pack']), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:disable-suspects-and-start', harnessEvent(), ['user-pack']), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:list-releases', leftoverMarketplaceEvent()), unauthorized);
  } finally {
    ipc.restore();
  }
});

test('launcher sender can scan-import and list-releases', async () => {
  const ipc = loadIpc();
  try {
    const scan = await ipc.invoke('shell:scan-import', launcherEvent());
    assert.equal(scan.ok, true);
    const releases = await ipc.invoke('shell:list-releases', launcherEvent());
    assert.equal(releases.status, 'ok');
    const start = await ipc.invoke('shell:start-desktop', launcherEvent());
    assert.equal(start.ok, true);
    assert.equal(ipc.startDesktop(), 1);
  } finally {
    ipc.restore();
  }
});

test('shell:install-runtime delegates to the service and forwards progress to the launcher sender', async () => {
  const ipc = loadIpc();
  const progress = [];
  try {
    const result = await ipc.invoke('shell:install-runtime', launcherEvent(progress), { route: 'github' });
    assert.equal(result.status, 'installed');
    assert.deepEqual(ipc.runtimeInstallCalls, [{ route: 'github' }]);
    assert.deepEqual(progress, [{ channel: 'shell:update-progress', payload: { phase: 'resolve', percent: 0 } }]);
    const cancel = await ipc.invoke('shell:cancel-runtime-install', launcherEvent());
    assert.equal(cancel.ok, true);
  } finally {
    ipc.restore();
  }
});

test('launcher skip-user-plugins writes recovery and force-restarts desktop', async () => {
  const writes = [];
  const ipc = loadIpc({
    harness: {
      writePluginSkip(error) {
        writes.push(error && error.message ? error.message : String(error));
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:start-desktop-skipped', launcherEvent());
    assert.equal(result.ok, true);
    assert.deepEqual(writes, ['launcher-skip-user-plugins']);
    assert.equal(ipc.startDesktop(), 1);
    assert.equal(ipc.startDesktopArgs[0].forceRestart, true);
    assert.equal(ipc.startDesktopArgs[0].maintenanceToken?.kind, 'start');
  } finally {
    ipc.restore();
  }
});

test('launcher start-desktop delegates the full retry without clearing sticky skip', async () => {
  const importGuard = require('./import-guard');
  let cleared = 0;
  const ipc = loadIpc({
    harness: {
      appVersion: '1.2.3',
      pluginRecovery: {
        skipUserPlugins: true,
        reason: 'launcher-skip-user-plugins',
        at: '2026-01-01T00:00:00.000Z',
        appVersion: '1.2.3',
      },
      clearPluginRecovery() {
        cleared += 1;
        this.pluginRecovery = {
          skipUserPlugins: false,
          reason: '',
          at: '',
          appVersion: '',
        };
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:start-desktop', launcherEvent());
    assert.equal(result.ok, true);
    assert.equal(cleared, 0, 'only the admitted protected restart may clear sticky');
    assert.equal(ipc.startDesktop(), 1);
    assert.equal(ipc.startDesktopArgs[0].forceRestart, true);
    assert.equal(ipc.startDesktopArgs[0].fullPluginRetry, true);
    assert.equal(ipc.startDesktopArgs[0].maintenanceToken?.kind, 'start');
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally {
    ipc.restore();
  }
});

test('launcher start-desktop does not force-restart without sticky skip', async () => {
  const ipc = loadIpc({
    harness: {
      appVersion: '1.2.3',
      pluginRecovery: {
        skipUserPlugins: false,
        reason: '',
        at: '',
        appVersion: '',
      },
      clearPluginRecovery() {},
    },
  });
  try {
    await ipc.invoke('shell:start-desktop', launcherEvent());
    assert.equal(ipc.startDesktop(), 1);
    // startOp delegates its acquired 'start' token down for owner-aware
    // nested-restart delegation.
    assert.equal(ipc.startDesktopArgs[0].maintenanceToken?.kind, 'start');
    assert.equal(ipc.startDesktopArgs[0].fullPluginRetry, undefined);
  } finally {
    ipc.restore();
  }
});

test('launcher retry-full-plugins delegates sticky clearing to the protected recovery launch', async () => {
  const importGuard = require('./import-guard');
  let cleared = 0;
  const ipc = loadIpc({
    harness: {
      clearPluginRecovery() {
        cleared += 1;
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:retry-full-plugins', launcherEvent());
    assert.equal(result.ok, true);
    assert.equal(cleared, 0, 'the launcher must not clear sticky before task protection');
    assert.equal(ipc.startDesktop(), 1);
    // The call delegates the acquired maintenance token down so the nested
    // forced restart is recognized as the same owner (owner-aware
    // delegation), not refused as a foreign caller.
    assert.equal(ipc.startDesktopArgs[0].recoveryLaunch, true);
    assert.equal(ipc.startDesktopArgs[0].forceRestart, true);
    assert.equal(ipc.startDesktopArgs[0].fullPluginRetry, true);
    assert.equal(ipc.startDesktopArgs[0].maintenanceToken?.kind, 'retry');
    assert.equal(ipc.startHarness(), 0);
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally {
    ipc.restore();
  }
});

test('boot retry-full-plugins still uses harness retryFullPlugins and records the start outcome', async () => {
  let retried = 0;
  const ipc = loadIpc({
    harness: {
      retryFullPlugins: async () => {
        retried += 1;
        return { state: 'ready' };
      },
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    await ipc.invoke('shell:retry-full-plugins', bootEvent());
    assert.equal(retried, 1);
    assert.equal(ipc.startDesktop(), 0);
    assert.deepEqual(ipc.lastStartWrites, [{ ok: true }]);
  } finally {
    ipc.restore();
  }
});

test('launcher retry-full-plugins leaves last-start recording to startDesktop', async () => {
  const ipc = loadIpc({ harness: { clearPluginRecovery() {} } });
  try {
    await ipc.invoke('shell:retry-full-plugins', launcherEvent());
    assert.equal(ipc.startDesktop(), 1);
    assert.deepEqual(ipc.lastStartWrites, [], 'startDesktop writes the marker itself');
  } finally {
    ipc.restore();
  }
});

test('boot shell:restart writes last-desktop-start ok:true on success', async () => {
  const ipc = loadIpc({
    harness: {
      retryFullPlugins: async () => ({ state: 'ready' }),
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    const snapshot = await ipc.invoke('shell:restart', bootEvent());
    assert.equal(snapshot.state, 'ready');
    assert.deepEqual(ipc.lastStartWrites, [{ ok: true }]);
  } finally {
    ipc.restore();
  }
});

test('boot shell:restart writes last-desktop-start ok:false and rethrows on failure', async () => {
  const ipc = loadIpc({
    harness: {
      retryFullPlugins: async () => {
        throw new Error('plugin tree exploded');
      },
      snapshot: () => ({ state: 'error' }),
    },
  });
  try {
    await assert.rejects(() => ipc.invoke('shell:restart', bootEvent()), /plugin tree exploded/);
    assert.deepEqual(ipc.lastStartWrites, [{ ok: false, error: 'plugin tree exploded' }]);
  } finally {
    ipc.restore();
  }
});

function userPluginFailure(names = ['user-pack']) {
  return {
    genericCause: null,
    desktopRuntimeDamage: false,
    pluginTreeFailure: true,
    suspects: names.map((name) => ({ name })),
    plugins: names.map((name) => ({ name, bundle: true, suspect: true })),
  };
}

function recoveryHarness(state, skipUserPlugins = false) {
  return {
    pluginRecovery: { skipUserPlugins, reason: skipUserPlugins ? 'user-pack: import failed (see console for the import error)' : '' },
    cleared: 0,
    snapshot() { return { state, pluginRecovery: this.pluginRecovery }; },
    clearPluginRecovery() {
      this.cleared += 1;
      this.pluginRecovery = { skipUserPlugins: false, reason: '' };
    },
  };
}

test('disable-suspects-and-start checks the fresh complete set and excludes protected or unrelated plugins', async () => {
  let forensics = userPluginFailure();
  const harness = recoveryHarness('error');
  const ipc = loadIpc({
    harness,
    inspectPlugins: () => forensics,
    readLastDesktopStart: () => ({ ok: false, error: 'user-pack failed' }),
  });
  try {
    const changed = [
      { names: [], forensics: userPluginFailure() },
      { names: [null], forensics: userPluginFailure() },
      { names: ['unrelated-pack'], forensics: userPluginFailure() },
      { names: ['user-pack', 'unrelated-pack'], forensics: userPluginFailure() },
      { names: ['user-pack'], forensics: userPluginFailure(['user-pack', 'new-failure']) },
      ...['disabled', 'orphan', 'inBox', 'preset', 'officialTemplate'].map((flag) => ({
        names: ['user-pack'],
        forensics: { ...userPluginFailure(), plugins: [{ name: 'user-pack', suspect: true, [flag]: true }] },
      })),
    ];
    for (const row of changed) {
      forensics = row.forensics;
      const result = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), row.names);
      assert.equal(result.ok, false);
      assert.equal(result.error, 'suspects-changed');
      assert.deepEqual(result.forensics, forensics);
    }
    assert.equal(ipc.disabledBundleCalls.length, 0);
    assert.equal(ipc.saveConfigCalls.length, 0);
    assert.equal(ipc.startDesktop(), 0);
    assert.equal(harness.cleared, 0);
  } finally {
    ipc.restore();
  }
});

test('disable-suspects-and-start rejects old log suspects after a healthy full start', async () => {
  const ipc = loadIpc({
    harness: recoveryHarness('ready'),
    inspectPlugins: () => userPluginFailure(),
    readLastDesktopStart: () => ({ ok: true, error: '' }),
    dsh: { state: 'ready', logs: ['user-pack: import failed (see console for the import error)'] },
  });
  try {
    const result = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
    assert.equal(result.error, 'suspects-changed');
    assert.equal(ipc.disabledBundleCalls.length, 0);
    assert.equal(ipc.saveConfigCalls.length, 0);
    assert.equal(ipc.startDesktop(), 0);
  } finally {
    ipc.restore();
  }
});

test('plugin recovery attribution ignores historical failures and retains the current failed attempt', async () => {
  const audit = (name) => `web boot: 1 entry did not activate\n${name}: import failed (see console for the import error)`;
  const current = audit('user-pack');
  const history = ['listen EADDRINUSE', 'heap out of memory', audit('healthy-now')];
  const installed = () => ({ plugins: [{ name: 'user-pack' }, { name: 'healthy-now' }], bundles: ['user-pack', 'healthy-now'] });
  for (const scenario of ['failed-full', 'sticky-ready', 'cold-failure-record']) {
    const harness = recoveryHarness(scenario === 'sticky-ready' ? 'ready' : 'error', scenario === 'sticky-ready');
    if (scenario === 'sticky-ready') {
      harness.pluginRecovery = { skipUserPlugins: true, reason: 'process exited', logTail: [current] };
    }
    const ipc = loadIpc({
      harness,
      inspectPlugins: pluginForensics.inspectPlugins,
      listInstalledPlugins: installed,
      dsh: {
        logs: history.concat(scenario === 'cold-failure-record' ? ['launcher peer listening'] : [current]),
        currentStartLogs: () => scenario === 'cold-failure-record' ? [] : (scenario === 'sticky-ready' ? ['skip boot ready'] : [current]),
      },
      readLastDesktopStart: () => ({ ok: scenario !== 'sticky-ready' ? false : true, error: 'process exited', logTail: [current] }),
    });
    try {
      const forensics = await ipc.invoke('shell:plugin-forensics', launcherEvent());
      assert.equal(forensics.genericCause, null, scenario);
      assert.deepEqual(forensics.suspects, [{ name: 'user-pack' }], scenario);
      const stale = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack', 'healthy-now']);
      assert.equal(stale.error, 'suspects-changed');
      assert.equal(ipc.disabledBundleCalls.length, 0);
      const currentResult = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
      assert.equal(currentResult.ok, true, scenario);
      assert.deepEqual(ipc.saveConfigCalls[0].disabledPlugins, ['user-pack']);
      assert.equal(ipc.startDesktop(), 1);
    } finally {
      ipc.restore();
    }
  }
});

test('disable-suspects-and-start does not blame plugins for generic failures or desktop damage', async () => {
  for (const verdict of [{ genericCause: 'oom' }, { genericCause: 'port-excluded' }, { desktopRuntimeDamage: true }]) {
    const ipc = loadIpc({
      harness: recoveryHarness('error'),
      inspectPlugins: () => ({ ...userPluginFailure(), ...verdict }),
      readLastDesktopStart: () => ({ ok: false, error: 'startup failed' }),
    });
    try {
      const result = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
      assert.equal(result.error, 'suspects-changed');
      assert.equal(ipc.disabledBundleCalls.length, 0);
      assert.equal(ipc.saveConfigCalls.length, 0);
      assert.equal(ipc.startDesktop(), 0);
    } finally {
      ipc.restore();
    }
  }
});

test('disable-suspects-and-start writes once and starts once from idle, error, or sticky ready', async () => {
  const importGuard = require('./import-guard');
  for (const state of ['idle', 'error', 'ready']) {
    const harness = recoveryHarness(state, state === 'ready');
    let ipc;
    ipc = loadIpc({
      harness,
      config: { disabledPlugins: ['keep-disabled'] },
      dsh: { state, logs: [], snapshot: () => ({ state }) },
      inspectPlugins: ({ recovery }) => ({ ...userPluginFailure(), recovery }),
      readLastDesktopStart: () => ({ ok: state === 'ready', error: 'user-pack failed' }),
      startDesktop: async (options) => {
        assert.equal(importGuard.holdsMaintenance(options.maintenanceToken), true);
        assert.equal(options.maintenanceToken.kind, 'plugin-disable');
        assert.equal(options.fullPluginRetry, true);
        assert.equal(harness.cleared, 0, 'the service must wait for the protected restart to be admitted');
        assert.equal(harness.pluginRecovery.skipUserPlugins, state === 'ready');
        assert.deepEqual(ipc.saveConfigCalls, [{ disabledPlugins: ['keep-disabled', 'user-pack'] }]);
        harness.clearPluginRecovery();
        return { ok: true, state: 'ready' };
      },
    });
    try {
      const result = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack', 'user-pack']);
      assert.equal(result.ok, true);
      assert.equal(result.harnessRestarted, true);
      assert.equal(result.forensics.recovery.skipUserPlugins, false);
      assert.equal(harness.cleared, 1);
      assert.equal(ipc.startDesktop(), 1);
      assert.equal(ipc.startHarness(), 0);
      assert.equal(ipc.startDesktopArgs[0].forceRestart, true);
      assert.equal(ipc.startDesktopArgs[0].fullPluginRetry, true);
      assert.equal(ipc.startDesktopArgs[0].recoveryLaunch, true);
      assert.deepEqual(ipc.disabledBundleCalls, [['keep-disabled', 'user-pack']]);
      assert.equal(importGuard.isMaintenanceHeld(), false);
    } finally {
      ipc.restore();
    }
  }
});

test('disable-suspects-and-start keeps the write and truthful partial failure on a refused start', async () => {
  const importGuard = require('./import-guard');
  for (const refusal of [{ ok: false, error: 'new web boot failure' }, { ok: false, code: 'cancelled' }, { proceeded: false, code: 'task-protection-busy' }]) {
    const harness = recoveryHarness('ready', true);
    const originalRecovery = {
      skipUserPlugins: true,
      reason: 'Web UI load failed: web boot: 1 entry did not activate\nuser-pack: import failed (see console for the import error)',
      logTail: ['web boot: 1 entry did not activate', 'user-pack: import failed (see console for the import error)'],
      at: '2026-10-06T10:00:00.000Z',
      appVersion: '1.2.3',
    };
    harness.pluginRecovery = structuredClone(originalRecovery);
    const ipc = loadIpc({
      harness,
      inspectPlugins: pluginForensics.inspectPlugins,
      listInstalledPlugins: () => ({ plugins: [{ name: 'user-pack' }], bundles: ['user-pack'] }),
      readLastDesktopStart: () => ({ ok: true, error: '', at: 'skip-start-completed' }),
      dsh: { state: 'ready', logs: [], currentStartLogs: () => ['skip boot is healthy'] },
      startDesktop: async ({ fullPluginRetry, maintenanceToken }) => {
        assert.equal(fullPluginRetry, true);
        assert.equal(importGuard.holdsMaintenance(maintenanceToken), true);
        assert.equal(maintenanceToken.kind, 'plugin-disable');
        assert.deepEqual(harness.pluginRecovery, originalRecovery, 'a refused protected restart must not touch the running skip marker');
        return refusal;
      },
    });
    try {
      const result = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
      assert.equal(result.ok, true, 'the disable already committed');
      assert.equal(result.harnessRestarted, false);
      assert.equal(result.error, refusal.error || refusal.code);
      assert.deepEqual(ipc.saveConfigCalls, [{ disabledPlugins: ['user-pack'] }]);
      assert.deepEqual(ipc.disabledBundleCalls, [['user-pack']]);
      assert.equal(harness.cleared, 0);
      assert.deepEqual(harness.pluginRecovery, originalRecovery);
      assert.equal(result.forensics.recovery.skipUserPlugins, true);
      assert.equal(result.forensics.recovery.reason, originalRecovery.reason);
      assert.deepEqual(result.forensics.suspects, [{ name: 'user-pack' }]);
      assert.ok(result.forensics.evidence.some((row) => row.name === 'user-pack' && row.line.includes('import failed')));
      assert.deepEqual(harness.pluginRecovery.logTail, originalRecovery.logTail);
      assert.equal(ipc.startDesktop(), 1, 'do not retry the start after a refusal');
      assert.equal(ipc.startHarness(), 0);
      assert.equal(importGuard.isMaintenanceHeld(), false);
    } finally {
      ipc.restore();
    }
  }
});

test('disable-suspects-and-start retains the maintenance owner through a deferred start', async () => {
  const importGuard = require('./import-guard');
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const ipc = loadIpc({
    harness: recoveryHarness('error'),
    inspectPlugins: () => userPluginFailure(),
    readLastDesktopStart: () => ({ ok: false, error: 'user-pack failed' }),
    startDesktop: async ({ maintenanceToken }) => {
      assert.equal(importGuard.holdsMaintenance(maintenanceToken), true);
      entered();
      await gate;
      return { ok: true };
    },
  });
  let pending;
  try {
    pending = ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
    await Promise.race([started, pending.then(() => assert.fail('start callback was not reached'))]);
    assert.equal(importGuard.isMaintenanceHeld(), true);
    assert.equal(importGuard.acquireMaintenance('import'), null);
    const duplicate = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
    assert.equal(duplicate.error, 'operation-in-progress');
    const start = await ipc.invoke('shell:start-desktop', launcherEvent());
    assert.equal(start.error, 'operation-in-progress');
    release();
    const result = await pending;
    assert.equal(result.harnessRestarted, true);
    assert.equal(ipc.startDesktop(), 1);
    assert.equal(ipc.saveConfigCalls.length, 1);
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally {
    release();
    if (pending) await pending.catch(() => {});
    ipc.restore();
  }
});

test('disable-suspects-and-start refuses a blocked import before the profile write', async () => {
  const ipc = loadIpc({
    harness: recoveryHarness('error'),
    inspectPlugins: () => userPluginFailure(),
    readLastDesktopStart: () => ({ ok: false, error: 'user-pack failed' }),
    readImportJournal: () => ({ phase: 'blocked', pendingTxns: ['unresolved-op'] }),
  });
  try {
    const result = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
    assert.equal(result.error, 'import-recovery-blocked');
    assert.equal(ipc.disabledBundleCalls.length, 0);
    assert.equal(ipc.saveConfigCalls.length, 0);
    assert.equal(ipc.startDesktop(), 0);
  } finally {
    ipc.restore();
  }
});

test('slim disable-suspects-and-start preserves runtime settings and spawns once under the same owner', async () => {
  const importGuard = require('./import-guard');
  const { LEGACY_DESKTOP_USER_DATA } = require('../shared/product-identity');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-recovery-'));
  const runtimeDir = path.join(root, LEGACY_DESKTOP_USER_DATA);
  const configFile = path.join(runtimeDir, 'config.json');
  fs.mkdirSync(runtimeDir);
  fs.writeFileSync(configFile, JSON.stringify({
    disabledPlugins: ['keep-disabled'],
    pluginRecovery: { skipUserPlugins: true, reason: 'user-pack failed' },
    workspace: 'keep-workspace',
  }));
  const previousFlavor = process.env.DSHD_LAUNCHER_PACKAGE;
  process.env.DSHD_LAUNCHER_PACKAGE = '1';
  const productPath = require.resolve('../launcher/product');
  const previousProduct = require.cache[productPath];
  delete require.cache[productPath];
  const calls = [];
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const ipc = loadIpc({
    getPath: () => root,
    inspectPlugins: ({ recovery }) => ({ ...userPluginFailure(), recovery }),
    readLastDesktopStart: () => ({ ok: false, error: 'user-pack failed' }),
    runtimeInstall: {
      stopExternalDesktop: async () => { calls.push('stop'); return { ok: true }; },
      startExternalDesktop: async () => {
        calls.push('start');
        assert.equal(importGuard.maintenanceOwner().kind, 'plugin-disable');
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        assert.deepEqual(config.disabledPlugins, ['keep-disabled', 'user-pack']);
        assert.equal(config.pluginRecovery.skipUserPlugins, false);
        assert.equal(config.workspace, 'keep-workspace');
        entered();
        await gate;
        return { ok: true, external: true };
      },
    },
  });
  let pending;
  try {
    pending = ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
    await Promise.race([started, pending.then(() => assert.fail('external start callback was not reached'))]);
    assert.equal(importGuard.acquireMaintenance('import'), null);
    release();
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, true);
    assert.deepEqual(calls, ['stop', 'start']);
    assert.equal(ipc.startDesktop(), 0);
    assert.equal(ipc.startHarness(), 0);
    assert.equal(ipc.saveConfigCalls.length, 0, 'do not write the slim launcher config');
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally {
    release();
    if (pending) await pending.catch(() => {});
    ipc.restore();
    if (previousFlavor === undefined) delete process.env.DSHD_LAUNCHER_PACKAGE;
    else process.env.DSHD_LAUNCHER_PACKAGE = previousFlavor;
    delete require.cache[productPath];
    if (previousProduct) require.cache[productPath] = previousProduct;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('slim disable-suspects-and-start refuses unreadable runtime config without changing profile or config', async () => {
  const importGuard = require('./import-guard');
  const { LEGACY_DESKTOP_USER_DATA } = require('../shared/product-identity');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-invalid-config-'));
  const runtimeDir = path.join(root, LEGACY_DESKTOP_USER_DATA);
  const configFile = path.join(runtimeDir, 'config.json');
  fs.mkdirSync(runtimeDir);
  const previousFlavor = process.env.DSHD_LAUNCHER_PACKAGE;
  process.env.DSHD_LAUNCHER_PACKAGE = '1';
  const productPath = require.resolve('../launcher/product');
  const previousProduct = require.cache[productPath];
  delete require.cache[productPath];
  const calls = [];
  let ipc;
  try {
    ipc = loadIpc({
      getPath: () => root,
      inspectPlugins: () => userPluginFailure(),
      readLastDesktopStart: () => ({ ok: false, error: 'user-pack failed' }),
      runtimeInstall: {
        stopExternalDesktop: async () => { calls.push('stop'); return { ok: true }; },
        startExternalDesktop: async () => { calls.push('start'); return { ok: true, external: true }; },
      },
    });
    for (const raw of ['{"workspace":"keep-workspace",invalid', 'null', '[]', '42']) {
      fs.writeFileSync(configFile, raw);
      const result = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
      assert.equal(result.ok, false);
      assert.equal(result.error, 'config-unreadable');
      assert.equal(fs.readFileSync(configFile, 'utf8'), raw, 'preserve the original bytes');
      assert.equal(fs.existsSync(`${configFile}.tmp`), false);
      assert.equal(importGuard.isMaintenanceHeld(), false);
    }
    fs.rmSync(configFile);
    fs.mkdirSync(configFile);
    const unreadable = await ipc.invoke('shell:disable-suspects-and-start', launcherEvent(), ['user-pack']);
    assert.equal(unreadable.error, 'config-unreadable');
    assert.equal(fs.statSync(configFile).isDirectory(), true);
    assert.equal(ipc.disabledBundleCalls.length, 0, 'do not change the profile before the strict read');
    assert.equal(ipc.saveConfigCalls.length, 0);
    assert.deepEqual(calls, [], 'do not stop or spawn the runtime');
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally {
    if (ipc) ipc.restore();
    if (previousFlavor === undefined) delete process.env.DSHD_LAUNCHER_PACKAGE;
    else process.env.DSHD_LAUNCHER_PACKAGE = previousFlavor;
    delete require.cache[productPath];
    if (previousProduct) require.cache[productPath] = previousProduct;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('disable-plugins batch writes once and restarts harness once', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    const result = await ipc.invoke('shell:disable-plugins', launcherEvent(), ['a-pack', 'b-pack']);
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, true);
    assert.equal(ipc.startHarness(), 1);
    assert.deepEqual(ipc.saveConfigCalls[0].disabledPlugins.sort(), ['a-pack', 'b-pack']);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin restarts harness when kernel is ready without startDesktop', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
      stop: async () => {},
    },
  });
  try {
    const result = await ipc.invoke('shell:disable-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, true);
    assert.equal(ipc.startHarness(), 1);
    assert.equal(ipc.startDesktop(), 0);
    assert.ok(result.forensics);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin rejects desktop built-in dsh-im aliases without writing config', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    for (const alias of ['@xmanrui/dsh-im', 'dsh-im', 'xmanrui-dsh-im']) {
      const result = await ipc.invoke('shell:disable-plugin', launcherEvent(), alias);
      assert.equal(result.ok, false);
      assert.equal(result.error, 'desktop-builtin');
    }
    const batch = await ipc.invoke('shell:disable-plugins', launcherEvent(), ['user-pack', 'dsh-im']);
    assert.equal(batch.ok, false);
    assert.equal(batch.error, 'desktop-builtin');
    assert.equal(batch.name, 'dsh-im');
    assert.equal(ipc.saveConfigCalls.length, 0);
    assert.equal(ipc.startHarness(), 0);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin rejects the desktop built-in usage-panel without writing config', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    const single = await ipc.invoke('shell:disable-plugin', launcherEvent(), 'dsh-usage-panel');
    assert.equal(single.ok, false);
    assert.equal(single.error, 'desktop-builtin');
    const batch = await ipc.invoke('shell:disable-plugins', launcherEvent(), ['user-pack', 'dsh-usage-panel']);
    assert.equal(batch.ok, false);
    assert.equal(batch.error, 'desktop-builtin');
    assert.equal(batch.name, 'dsh-usage-panel');
    assert.equal(ipc.saveConfigCalls.length, 0);
    assert.equal(ipc.startHarness(), 0);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin skips harness restart when kernel is idle', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'idle',
      logs: [],
      snapshot: () => ({ state: 'idle' }),
    },
  });
  try {
    const result = await ipc.invoke('shell:disable-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, false);
    assert.equal(ipc.startHarness(), 0);
    assert.equal(ipc.startDesktop(), 0);
  } finally {
    ipc.restore();
  }
});

test('disable-plugin keeps ok when harness restart fails after disk write', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
    },
    startHarness: async () => {
      throw new Error('restart failed');
    },
  });
  try {
    const result = await ipc.invoke('shell:disable-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, false);
    assert.match(result.error, /没有重新起来/);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});

test('remove-plugin drops the disabled entry only after a successful uninstall', async () => {
  const ipc = loadIpc({
    config: { disabledPlugins: ['user-pack', 'other-pack'] },
    dsh: {
      state: 'idle',
      logs: [],
      snapshot: () => ({ state: 'idle' }),
    },
  });
  try {
    const result = await ipc.invoke('shell:remove-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, true);
    const writes = ipc.saveConfigCalls.filter((patch) => Array.isArray(patch.disabledPlugins));
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].disabledPlugins, ['other-pack']);
  } finally {
    ipc.restore();
  }
});

test('remove-plugin keeps the disabled entry when uninstall fails', async () => {
  const ipc = loadIpc({
    config: { disabledPlugins: ['user-pack'] },
    uninstallResult: { ok: false, error: 'io-error' },
    dsh: {
      state: 'idle',
      logs: [],
      snapshot: () => ({ state: 'idle' }),
    },
  });
  try {
    const result = await ipc.invoke('shell:remove-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'io-error');
    // A crashed-plugin disable must survive a failed uninstall — writing
    // disabledPlugins here would silently re-enable it on the next start.
    assert.equal(
      ipc.saveConfigCalls.filter((patch) => patch.disabledPlugins !== undefined).length,
      0,
    );
  } finally {
    ipc.restore();
  }
});

test('remove-plugin in the slim package refuses with desktop-only', async () => {
  process.env.DSHD_LAUNCHER_PACKAGE = '1';
  const productPath = require.resolve('../launcher/product');
  const previousProduct = require.cache[productPath];
  delete require.cache[productPath];
  const ipc = loadIpc({
    dsh: {
      state: 'idle',
      logs: [],
      snapshot: () => ({ state: 'idle' }),
    },
  });
  try {
    const result = await ipc.invoke('shell:remove-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'desktop-only');
    // The vendored `dsh plugin` CLI does not exist in the slim package — the
    // op must refuse before touching the runtime config or spawning.
    assert.equal(ipc.uninstallCalls.length, 0);
    assert.equal(
      ipc.saveConfigCalls.filter((patch) => patch.disabledPlugins !== undefined).length,
      0,
    );
  } finally {
    ipc.restore();
    delete process.env.DSHD_LAUNCHER_PACKAGE;
    delete require.cache[productPath];
    if (previousProduct) require.cache[productPath] = previousProduct;
  }
});

test('enable-plugin restarts harness when kernel is starting', async () => {
  const ipc = loadIpc({
    dsh: {
      state: 'starting',
      logs: [],
      snapshot: () => ({ state: 'starting' }),
    },
  });
  try {
    const result = await ipc.invoke('shell:enable-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, true);
    assert.equal(result.harnessRestarted, true);
    assert.equal(ipc.startHarness(), 1);
    assert.equal(ipc.startDesktop(), 0);
  } finally {
    ipc.restore();
  }
});

test('run-import reports kernelStopped only when a running kernel was stopped', async () => {
  let stopCalls = 0;
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
      stop: async () => {
        stopCalls += 1;
      },
    },
  });
  try {
    const running = await ipc.invoke('shell:run-import', launcherEvent(), { selectedRels: ['proj/sess-a'] });
    assert.equal(running.kernelStopped, true);
    assert.equal(stopCalls, 1);
  } finally {
    ipc.restore();
  }

  const idle = loadIpc({
    dsh: {
      state: 'idle',
      logs: [],
      snapshot: () => ({ state: 'idle' }),
      stop: async () => {
        stopCalls += 1;
      },
    },
  });
  try {
    const result = await idle.invoke('shell:run-import', launcherEvent(), { selectedRels: ['proj/sess-a'] });
    assert.equal(result.kernelStopped, false);
    assert.equal(stopCalls, 1);
  } finally {
    idle.restore();
  }
});

test('run-import with empty selection is a no-write no-stop operation', async () => {
  let stopCalls = 0;
  const ipc = loadIpc({
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
      stop: async () => { stopCalls += 1; },
    },
  });
  try {
    const result = await ipc.invoke('shell:run-import', launcherEvent(), {});
    assert.equal(result.ok, true);
    assert.equal(result.empty, true);
    assert.equal(stopCalls, 0);
  } finally {
    ipc.restore();
  }
});

test('launcher scan-import and run-import forward extra skill dirs and selections', async () => {
  const ipc = loadIpc();
  try {
    await ipc.invoke('shell:scan-import', launcherEvent(), {
      sourceHome: 'C:\\official-home',
      extraSkillDirs: ['C:\\skills-extra'],
    });
    assert.equal(ipc.scanImportCalls.length, 1);
    assert.equal(ipc.scanImportCalls[0].sourceHome, 'C:\\official-home');
    assert.deepEqual(ipc.scanImportCalls[0].extraSkillDirs, ['C:\\skills-extra']);

    const payload = {
      sourceHome: 'C:\\official-home',
      extraSkillDirs: ['C:\\skills-extra'],
      overwrite: true,
      importAttachments: true,
      selectedRels: ['proj/sess-a'],
      selectedSkillIds: ['home:alpha'],
      selectedPluginNames: ['good-plugin'],
      selectedMcpIds: ['wiki'],
      selectedSettingIds: ['llm-deepseek', 'agents-md'],
      selectedPresetIds: ['research'],
    };
    const result = await ipc.invoke('shell:run-import', launcherEvent(), payload);
    assert.equal(result.empty, true);
    assert.equal(ipc.runImportCalls.length, 1);
    const opts = ipc.runImportCalls[0];
    assert.equal(opts.sourceHome, payload.sourceHome);
    assert.deepEqual(opts.extraSkillDirs, payload.extraSkillDirs);
    assert.equal(opts.overwrite, true);
    assert.equal(opts.importAttachments, true);
    assert.deepEqual(opts.selectedRels, payload.selectedRels);
    assert.deepEqual(opts.selectedSkillIds, payload.selectedSkillIds);
    assert.deepEqual(opts.selectedPluginNames, payload.selectedPluginNames);
    assert.deepEqual(opts.selectedMcpIds, payload.selectedMcpIds);
    assert.deepEqual(opts.selectedSettingIds, payload.selectedSettingIds);
    assert.deepEqual(opts.selectedPresetIds, payload.selectedPresetIds);
    assert.equal(typeof opts.installPlugin, 'function');
  } finally {
    ipc.restore();
  }
});

test('launcher stop-desktop stops kernel, cancels recovery, and dismisses main window', async () => {
  let stopped = 0;
  let stopDesktopCalls = 0;
  let cleaned = 0;
  let dismissed = 0;
  const dsh = {
    state: 'ready',
    stop: async () => {
      stopped += 1;
      dsh.state = 'idle';
    },
    snapshot: () => ({ state: dsh.state }),
    logs: [],
  };
  const ipc = loadIpc({
    dsh,
    harness: {
      async stopDesktop() {
        stopDesktopCalls += 1;
        await dsh.stop();
        return dsh.snapshot();
      },
    },
    stopDesktopCleanup: () => {
      cleaned += 1;
    },
    dismissMainWindow: () => {
      dismissed += 1;
      return true;
    },
  });
  try {
    const result = await ipc.invoke('shell:stop-desktop', launcherEvent());
    assert.equal(result.ok, true);
    assert.equal(result.stopped, true);
    assert.equal(stopped, 1);
    assert.equal(stopDesktopCalls, 1);
    assert.equal(cleaned, 1);
    assert.equal(dismissed, 1);
  } finally {
    ipc.restore();
  }
});

test('launcher stop-desktop is a no-op when kernel is not running', async () => {
  let stopped = 0;
  let stopDesktopCalls = 0;
  const ipc = loadIpc({
    dsh: {
      state: 'idle',
      stop: async () => {
        stopped += 1;
      },
      snapshot: () => ({ state: 'idle' }),
      logs: [],
    },
    harness: {
      async stopDesktop() {
        stopDesktopCalls += 1;
      },
    },
  });
  try {
    const result = await ipc.invoke('shell:stop-desktop', launcherEvent());
    assert.equal(result.ok, true);
    assert.equal(result.stopped, false);
    assert.equal(stopped, 0);
    assert.equal(stopDesktopCalls, 1);
  } finally {
    ipc.restore();
  }
});

test('launcher uninstall-app returns launchUninstaller result', async () => {
  const ipc = loadIpc({
    launchUninstaller: () => ({ ok: false, error: 'uninstaller-not-found' }),
  });
  try {
    const result = await ipc.invoke('shell:uninstall-app', launcherEvent());
    assert.equal(result.ok, false);
    assert.equal(result.error, 'uninstaller-not-found');
  } finally {
    ipc.restore();
  }
});

test('launcher-only stop-desktop rejects boot and harness senders', async () => {
  const ipc = loadIpc();
  try {
    const unauthorized = (error) => error.code === 'ERR_DSH_IPC_SENDER';
    await assert.rejects(() => ipc.invoke('shell:stop-desktop', bootEvent()), unauthorized);
    await assert.rejects(() => ipc.invoke('shell:stop-desktop', harnessEvent()), unauthorized);
  } finally {
    ipc.restore();
  }
});

test('open-launcher serves harness and boot (boot lands on home tab), rejects launcher sender', async () => {
  const calls = [];
  const ipc = loadIpc({
    onOpenLauncher: async (options) => {
      calls.push(options);
    },
  });
  try {
    const result = await ipc.invoke('shell:open-launcher', harnessEvent());
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [{}]);
    // Boot-page bridge: startup failures route to the launcher home tab so
    // the Recovery Board (the ONLY plugin-level recovery surface) is in view.
    const bridged = await ipc.invoke('shell:open-launcher', bootEvent());
    assert.equal(bridged.ok, true);
    assert.deepEqual(calls, [{}, { tab: 'home' }]);
    await assert.rejects(
      () => ipc.invoke('shell:open-launcher', launcherEvent()),
      (error) => error.code === 'ERR_DSH_IPC_SENDER',
    );
    assert.equal(calls.length, 2);
  } finally {
    ipc.restore();
  }
});

test('shell:get-config runs binary/source detection once per registration', async () => {
  let nodeCalls = 0;
  let dshCalls = 0;
  let sourceCalls = 0;
  const ipc = loadIpc({
    dshDeps: {
      resolveNodeBin: () => { nodeCalls += 1; return 'node'; },
      resolveDshBin: () => { dshCalls += 1; return 'dsh'; },
      sourceHarnessStatus: () => { sourceCalls += 1; return { present: false, built: false, root: '' }; },
    },
  });
  try {
    await ipc.invoke('shell:get-config', harnessEvent());
    await ipc.invoke('shell:get-config', harnessEvent());
    await ipc.invoke('shell:launcher-status', launcherEvent());
    assert.equal(nodeCalls, 1);
    assert.equal(dshCalls, 1);
    assert.equal(sourceCalls, 1);
  } finally {
    ipc.restore();
  }
});

test('shell:run-import forwards onProgress as shell:import-progress events', async () => {
  const progress = [];
  const ipc = loadIpc({
    runImport: async (opts) => {
      opts.onProgress({ phase: 'sessions', done: 1, total: 2, rel: 'a/b' });
      opts.onProgress({ phase: 'done', done: 1, total: 1 });
      return { ok: true, empty: false, sessions: [], skills: [], plugins: [], mcp: [], settings: [], credentials: [], presets: [] };
    },
  });
  try {
    await ipc.invoke('shell:run-import', launcherEvent(progress), { selectedRels: ['a/b'] });
    const events = progress.filter((row) => row.channel === 'shell:import-progress').map((row) => row.payload);
    assert.deepEqual(events, [
      { phase: 'sessions', done: 1, total: 2, rel: 'a/b' },
      { phase: 'done', done: 1, total: 1 },
    ]);
  } finally {
    ipc.restore();
  }
});

test('shell:cancel-import aborts the in-flight import signal', async () => {
  let capturedSignal = null;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ipc = loadIpc({
    runImport: async (opts) => {
      capturedSignal = opts.signal;
      await gate;
      return { ok: false, cancelled: capturedSignal.aborted, sessions: [], skills: [], plugins: [], mcp: [], settings: [], credentials: [], presets: [] };
    },
  });
  try {
    const running = ipc.invoke('shell:run-import', launcherEvent(), { selectedRels: ['a/b'] });
    for (let i = 0; i < 10 && !capturedSignal; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(capturedSignal, 'runImport must receive an AbortSignal');
    const cancel = await ipc.invoke('shell:cancel-import', launcherEvent());
    assert.equal(cancel.ok, true);
    assert.equal(capturedSignal.aborted, true);
    release();
    const result = await running;
    assert.equal(result.cancelled, true);
  } finally {
    release();
    ipc.restore();
  }
});

test('shell:run-import rejects a concurrent request and releases the task after failure', async () => {
  let entered = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ipc = loadIpc({
    runImport: async () => {
      entered += 1;
      if (entered === 1) {
        await gate;
        throw new Error('first import failed');
      }
      return { ok: true, empty: true };
    },
  });
  try {
    const first = ipc.invoke('shell:run-import', launcherEvent(), {});
    await new Promise((resolve) => setImmediate(resolve));
    const second = await ipc.invoke('shell:run-import', launcherEvent(), {});
    assert.deepEqual(second, { ok: false, error: 'import-in-progress' });
    assert.equal(entered, 1);
    release();
    await assert.rejects(first, /first import failed/);
    const retry = await ipc.invoke('shell:run-import', launcherEvent(), {});
    assert.equal(retry.ok, true);
    assert.equal(entered, 2);
  } finally {
    release();
    ipc.restore();
  }
});

test('shell:cancel-import with no import running resolves without aborting', async () => {
  const ipc = loadIpc();
  try {
    const cancel = await ipc.invoke('shell:cancel-import', launcherEvent());
    assert.equal(cancel.ok, false);
    await assert.rejects(
      () => ipc.invoke('shell:cancel-import', harnessEvent()),
      (error) => error.code === 'ERR_DSH_IPC_SENDER',
    );
  } finally {
    ipc.restore();
  }
});

test('boot restart owns the maintenance slot while pending — competitors are refused', async () => {
  // The first-admitted boot restart must keep its ownership for the whole
  // pending operation, not just pass a one-shot check. While its retry is
  // still in flight, a competing operation that checks the slot must see it
  // held (reverse-order exclusion).
  const importGuard = require('./import-guard');
  let releaseRetry;
  const ipc = loadIpc({
    harness: {
      retryFullPlugins: () => new Promise((resolve) => { releaseRetry = () => resolve({ state: 'ready' }); }),
      snapshot: () => ({ state: 'ready' }),
    },
  });
  try {
    const pending = ipc.invoke('shell:restart', bootEvent());
    // Yield so the handler reaches its acquire + awaits the deferred retry.
    await new Promise((r) => setImmediate(r));
    assert.equal(importGuard.isMaintenanceHeld(), true, 'boot restart must hold the slot while pending');
    // A competing standalone operation is refused, not admitted over it.
    const competitor = importGuard.acquireMaintenance('import');
    assert.equal(competitor, null, 'a competitor cannot acquire while the restart is pending');
    releaseRetry();
    const snapshot = await pending;
    assert.equal(snapshot.state, 'ready');
    assert.equal(importGuard.isMaintenanceHeld(), false, 'the slot releases when the restart settles');
    assert.deepEqual(ipc.lastStartWrites, [{ ok: true }]);
  } finally {
    ipc.restore();
  }
});

test('boot restart under maintenance refuses and acquires nothing', async () => {
  const importGuard = require('./import-guard');
  const foreign = importGuard.acquireMaintenance('import');
  const ipc = loadIpc({
    harness: { retryFullPlugins: async () => ({ state: 'ready' }), snapshot: () => ({ state: 'ready' }) },
  });
  try {
    const outcome = await ipc.invoke('shell:restart', bootEvent());
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, 'maintenance-in-progress');
    // The refused path neither ran the retry nor wrote a start marker.
    assert.deepEqual(ipc.lastStartWrites, []);
    // Ownership still belongs to the original holder.
    assert.equal(importGuard.holdsMaintenance(foreign), true);
  } finally {
    importGuard.releaseMaintenance(foreign);
    ipc.restore();
  }
});

test('remove-plugin refuses before any side effect while the import journal is blocked', async () => {
  // A blocked/unreadable import journal must refuse plugin removal BEFORE
  // the kernel stops, the uninstall runs, or the config mutates — acquiring
  // the slot alone is not equivalent to honoring the persistent verdict.
  let stopped = 0;
  const ipc = loadIpc({
    config: { disabledPlugins: ['user-pack'] },
    dsh: {
      state: 'ready',
      logs: [],
      snapshot: () => ({ state: 'ready' }),
      stop: async () => { stopped += 1; },
    },
    readImportJournal: () => ({ phase: 'blocked', destHome: '/x', pendingTxns: ['op-1'] }),
  });
  try {
    const result = await ipc.invoke('shell:remove-plugin', launcherEvent(), 'user-pack');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'import-recovery-blocked');
    // Zero side effects: no kernel stop, no uninstall, no config save.
    assert.equal(stopped, 0, 'kernel must not be stopped');
    assert.equal(ipc.uninstallCalls.length, 0, 'uninstall must not run');
    assert.equal(ipc.saveConfigCalls.length, 0, 'no config write');
  } finally {
    ipc.restore();
  }
});
