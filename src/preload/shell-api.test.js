const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function fakeRenderer() {
  return {
    invoke: () => Promise.resolve(),
    send: () => {},
    on: () => {},
    removeListener: () => {},
  };
}

function loadPreload(argv = ['electron'], electronExtras = {}) {
  const electronPath = require.resolve('electron');
  const preloadPath = require.resolve('./index');
  const cachedElectron = require.cache[electronPath];
  const cachedPreload = require.cache[preloadPath];
  const previousArgv = process.argv.slice();
  let exposed = null;
  const exposures = {};

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      contextBridge: {
        exposeInMainWorld(name, api) {
          exposed = { name, api };
          exposures[name] = api;
        },
      },
      ipcRenderer: fakeRenderer(),
      ...electronExtras,
    },
  };
  process.argv.splice(0, process.argv.length, ...argv);
  delete require.cache[preloadPath];

  try {
    return { exports: require('./index'), exposed, exposures };
  } finally {
    process.argv.splice(0, process.argv.length, ...previousArgv);
    if (cachedElectron) require.cache[electronPath] = cachedElectron;
    else delete require.cache[electronPath];
    if (cachedPreload) require.cache[preloadPath] = cachedPreload;
    else delete require.cache[preloadPath];
  }
}

function withMainFrame(t, value) {
  const previous = Object.getOwnPropertyDescriptor(process, 'isMainFrame');
  Object.defineProperty(process, 'isMainFrame', { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(process, 'isMainFrame', previous);
    else delete process.isMainFrame;
  });
}

const { buildShellApi, shellRole, remoteFeatureEnabled } = loadPreload().exports;

test('shellRole accepts only explicit desktop roles', () => {
  assert.equal(shellRole(['electron', '--dshd-shell-role=boot']), 'boot');
  assert.equal(shellRole(['electron', '--dshd-shell-role=harness']), 'harness');
  assert.equal(shellRole(['electron', '--dshd-shell-role=launcher']), 'launcher');
  assert.equal(shellRole(['electron', '--dshd-shell-role=pet']), 'pet');
  assert.equal(shellRole(['electron', '--dshd-shell-role=marketplace']), null);
  assert.equal(shellRole(['electron', '--dshd-shell-role=admin']), null);
  assert.equal(shellRole(['electron']), null);
});

test('sandbox preload entry is self-contained and exposes the selected role', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.doesNotMatch(source, /require\(\s*['"]\.{1,2}[\\/]/);

  const { exposed } = loadPreload(['electron', '--dshd-shell-role=boot']);
  assert.equal(exposed?.name, 'shell');
  assert.equal(typeof exposed?.api.getState, 'function');
  assert.equal(exposed?.api.writeFile, undefined);
});

test('boot preload exposes recovery but no workspace mutation', () => {
  const api = buildShellApi('boot', fakeRenderer());
  assert.equal(typeof api.restart, 'function');
  assert.equal(typeof api.getState, 'function');
  assert.equal(typeof api.saveBootLog, 'function');
  // The launcher bridge: boot failures jump to the Recovery Board.
  assert.equal(typeof api.openLauncher, 'function');
  assert.equal(api.writeFile, undefined);
  assert.equal(api.installPlugin, undefined);
  assert.equal(api.saveConfig, undefined);
  assert.equal(api.openDshHome, undefined);
});

test('marketplace preload role is not exposed', () => {
  assert.equal(buildShellApi('marketplace', fakeRenderer()), null);

  const { exposed } = loadPreload(['electron', '--dshd-shell-role=marketplace']);
  assert.equal(exposed, null);
});

test('pet preload exposes only state, drag, menu, and theme controls', () => {
  const api = buildShellApi('pet', fakeRenderer());
  assert.equal(typeof api.getState, 'function');
  assert.equal(typeof api.commitDrag, 'function');
  assert.equal(typeof api.openMenu, 'function');
  assert.equal(typeof api.onState, 'function');
  assert.equal(typeof api.onTheme, 'function');
  assert.equal(api.writeFile, undefined);
  assert.equal(api.saveConfig, undefined);
  assert.equal(api.openLauncher, undefined);
  assert.equal(Object.keys(api).sort().join(','), 'commitDrag,getState,onState,onTheme,openMenu');
});

test('harness preload keeps work loops and remote controls', () => {
  const api = buildShellApi('harness', fakeRenderer(), true);
  assert.equal(typeof api.writeFile, 'function');
  assert.equal(typeof api.listEditors, 'function');
  assert.equal(typeof api.openInEditor, 'function');
  assert.equal(typeof api.showItemInFolder, 'function');
  assert.equal(typeof api.openDshHome, 'function');
  assert.equal(typeof api.openLauncher, 'function');
  assert.equal(typeof api.openWithSystemDefault, 'function');
  assert.equal(typeof api.ptyCreate, 'function');
  assert.equal(typeof api.previewOpen, 'function');
  assert.equal(typeof api.previewWorkspaceFile, 'function');
  assert.equal(typeof api.previewOpenFileWindow, 'function');
  assert.equal(typeof api.onOpenPreviewUrl, 'function');
  assert.equal(typeof api.gitCommit, 'function');
  assert.equal(typeof api.listWallpaperCatalog, 'function');
  assert.equal(typeof api.downloadWallpaper, 'function');
  assert.equal(typeof api.previewHardReload, 'function');
  assert.equal(typeof api.previewStop, 'function');
  assert.equal(typeof api.previewZoomIn, 'function');
  assert.equal(typeof api.previewZoomOut, 'function');
  assert.equal(typeof api.previewResetZoom, 'function');
  assert.equal(typeof api.previewSetColorScheme, 'function');
  assert.equal(typeof api.previewClearCookies, 'function');
  assert.equal(typeof api.previewClearCache, 'function');
  assert.equal(typeof api.previewCaptureScreenshot, 'function');
  assert.equal(typeof api.previewPickElement, 'function');
  assert.equal(typeof api.previewCancelPick, 'function');
  assert.equal(typeof api.previewSetAnnotationTheme, 'function');
  assert.equal(typeof api.previewOpenPictureInPicture, 'function');
  assert.equal(typeof api.previewClosePictureInPicture, 'function');
  assert.equal(typeof api.previewStartRecording, 'function');
  assert.equal(typeof api.previewStopRecording, 'function');
  assert.equal(typeof api.onPreviewRecordingFrame, 'function');
  assert.equal(typeof api.previewSaveRecording, 'function');
  assert.equal(typeof api.previewRevealArtifact, 'function');
  assert.equal(typeof api.previewCopyArtifactToClipboard, 'function');
  // The preview-automation chain was deleted; no role may expose it.
  for (const key of Object.keys(api)) {
    assert.ok(!key.startsWith('previewAutomation'), `${key} must not be exposed`);
  }
  assert.equal(typeof api.getRemote, 'function');
  assert.equal(typeof api.saveRemote, 'function');
  assert.equal(typeof api.rotateRemoteToken, 'function');
  assert.equal(typeof api.unbindRemoteDevice, 'function');
  assert.equal(typeof api.renameRemoteDevice, 'function');
  assert.equal(api.saveBootLog, undefined);
});

test('boot preload omits guest preview IPC', () => {
  const api = buildShellApi('boot', fakeRenderer());
  assert.equal(api.listEditors, undefined);
  assert.equal(api.openInEditor, undefined);
  assert.equal(api.showItemInFolder, undefined);
  assert.equal(api.openWithSystemDefault, undefined);
  assert.equal(api.previewOpen, undefined);
  assert.equal(api.previewHardReload, undefined);
  assert.equal(api.previewStop, undefined);
  assert.equal(api.previewZoomIn, undefined);
  assert.equal(api.previewZoomOut, undefined);
  assert.equal(api.previewResetZoom, undefined);
  assert.equal(api.previewSetColorScheme, undefined);
  assert.equal(api.previewClearCookies, undefined);
  assert.equal(api.previewClearCache, undefined);
  assert.equal(api.previewCaptureScreenshot, undefined);
  assert.equal(api.previewPickElement, undefined);
  assert.equal(api.previewCancelPick, undefined);
  assert.equal(api.previewSetAnnotationTheme, undefined);
  assert.equal(api.previewOpenPictureInPicture, undefined);
  assert.equal(api.previewClosePictureInPicture, undefined);
  assert.equal(api.previewStartRecording, undefined);
  assert.equal(api.previewStopRecording, undefined);
  assert.equal(api.onPreviewRecordingFrame, undefined);
  assert.equal(api.previewSaveRecording, undefined);
  assert.equal(api.previewRevealArtifact, undefined);
  assert.equal(api.previewCopyArtifactToClipboard, undefined);
  assert.equal(api.previewAutomationStatus, undefined);
});

test('remote flag reaches the preload via additionalArguments, not a copy', () => {
  // No hardcoded copy of REMOTE_FEATURE_ENABLED in the preload anymore.
  const preloadSrc = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.doesNotMatch(preloadSrc, /const REMOTE_FEATURE_ENABLED = (true|false);/);

  // Main passes the config.js flag into the harness view argv.
  const windowSrc = fs.readFileSync(path.join(__dirname, '../main/window.js'), 'utf8');
  assert.match(windowSrc, /--dshd-remote-feature=\$\{REMOTE_FEATURE_ENABLED \? '1' : '0'\}/);

  assert.equal(remoteFeatureEnabled(['electron', '--dshd-remote-feature=1']), true);
  assert.equal(remoteFeatureEnabled(['electron', '--dshd-remote-feature=0']), false);
  // Missing argument fails closed: remote methods stay hidden.
  assert.equal(remoteFeatureEnabled(['electron']), false);
});

test('harness preload omits remote controls when the feature flag is off', () => {
  for (const api of [
    buildShellApi('harness', fakeRenderer(), false),
    loadPreload(['electron', '--dshd-shell-role=harness']).exposed?.api,
  ]) {
    assert.ok(api);
    assert.equal(api.getRemote, undefined);
    assert.equal(api.saveRemote, undefined);
    assert.equal(api.rotateRemoteToken, undefined);
    assert.equal(api.unbindRemoteDevice, undefined);
    assert.equal(api.renameRemoteDevice, undefined);
    assert.equal(typeof api.writeFile, 'function');
  }
  const enabled = loadPreload(['electron', '--dshd-shell-role=harness', '--dshd-remote-feature=1']).exposed?.api;
  assert.equal(typeof enabled?.getRemote, 'function');
});

test('harness preload exposes installMarketplacePlugin and omits seed install draft', () => {
  const api = buildShellApi('harness', fakeRenderer());
  assert.equal(typeof api.installMarketplacePlugin, 'function');
  assert.equal(typeof api.checkMarketplaceUpdates, 'function');
  assert.equal(typeof api.updateMarketplacePlugin, 'function');
  assert.equal(typeof api.updateMarketplacePlugins, 'function');
  assert.equal(typeof api.getMarketplaceState, 'function');
  assert.equal(typeof api.getMarketplaceDetails, 'function');
  assert.equal(typeof api.setMarketplaceFavorite, 'function');
  assert.equal(typeof api.installPlugin, 'function');
  assert.equal(api.seedInstallDraft, undefined);
  assert.equal(api.onSeedInstallDraft, undefined);
});

test('launcher preload exposes import, releases, and forensics', () => {
  const api = buildShellApi('launcher', fakeRenderer());
  assert.equal(typeof api.scanImport, 'function');
  assert.equal(typeof api.runImport, 'function');
  assert.equal(typeof api.cancelImport, 'function');
  assert.equal(typeof api.onImportProgress, 'function');
  assert.equal(typeof api.pickImportSource, 'function');
  assert.equal(typeof api.pickSkillDir, 'function');
  assert.equal(typeof api.listReleases, 'function');
  assert.equal(typeof api.installRelease, 'function');
  assert.equal(typeof api.pluginForensics, 'function');
  assert.equal(typeof api.startDesktop, 'function');
  assert.equal(typeof api.skipUserPlugins, 'function');
  assert.equal(typeof api.retryFullPlugins, 'function');
  assert.equal(api.writeFile, undefined);
  assert.equal(api.installPlugin, undefined);
});

test('boot preload cannot import data or install a release', () => {
  const api = buildShellApi('boot', fakeRenderer());
  assert.equal(api.scanImport, undefined);
  assert.equal(api.runImport, undefined);
  assert.equal(api.cancelImport, undefined);
  assert.equal(api.onImportProgress, undefined);
  assert.equal(api.installRelease, undefined);
  assert.equal(api.pluginForensics, undefined);
});

test('harness preload exposes __DSH_HOST_PATHS__ pathFor with safe fallback', () => {
  const { exposures } = loadPreload(
    ['electron', '--dshd-shell-role=harness'],
    { webUtils: { getPathForFile: (f) => (f && f._ok ? '/abs/' + f.name : '') } },
  );
  const bridge = exposures.__DSH_HOST_PATHS__;
  assert.equal(typeof bridge?.pathFor, 'function');
  assert.equal(bridge.pathFor({ name: 'a.ts', _ok: true }), '/abs/a.ts');
  assert.equal(bridge.pathFor(null), '');
});

test('non-harness roles do not expose __DSH_HOST_PATHS__', () => {
  const { exposures } = loadPreload(
    ['electron', '--dshd-shell-role=boot'],
    { webUtils: { getPathForFile: () => '/x' } },
  );
  assert.equal(exposures.__DSH_HOST_PATHS__, undefined);
});

test('harness preload exposes upstream dshDesktop.updates/browser and dshPlatform bridges', () => {
  const { exposures } = loadPreload(
    ['electron', '--dshd-shell-role=harness'],
    { webUtils: { getPathForFile: () => '' } },
  );
  const updates = exposures.dshDesktop?.updates;
  assert.equal(exposures.dshDesktop?.onboarding, false);
  assert.equal(typeof updates?.status, 'function');
  assert.equal(typeof updates?.open, 'function');
  assert.equal(typeof updates?.subscribe, 'function');
  const browser = exposures.dshDesktop?.browser;
  assert.equal(typeof browser?.acquire, 'function');
  assert.equal(typeof browser?.release, 'function');
  assert.equal(typeof browser?.onOpenRequested, 'function');
  const platform = exposures.dshPlatform;
  assert.equal(typeof platform?.open, 'function');
  assert.equal(typeof platform?.setBounds, 'function');
  assert.equal(typeof platform?.close, 'function');
});

test('harness main-frame preload exposes only WhaleBridge status and open through narrow channels', async (t) => {
  withMainFrame(t, true);
  const calls = [];
  const renderer = {
    ...fakeRenderer(),
    invoke: async (channel, ...args) => {
      calls.push({ channel, args });
      return channel === 'shell:whalebridge-status' ? { installed: true } : { ok: true };
    },
  };
  const { exposures } = loadPreload(
    ['electron', '--dshd-shell-role=harness'],
    { ipcRenderer: renderer },
  );
  const bridge = exposures.dshDesktop?.whaleBridge;
  assert.ok(bridge);
  assert.deepEqual(Object.keys(bridge).sort(), ['open', 'status']);
  assert.deepEqual(await bridge.status(), { installed: true });
  assert.deepEqual(await bridge.open(), { ok: true });
  assert.deepEqual(calls, [
    { channel: 'shell:whalebridge-status', args: [] },
    { channel: 'shell:whalebridge-open', args: [] },
  ]);
  for (const action of ['componentsList', 'componentsInstall', 'componentsStart', 'componentsStop',
    'componentsUpdate', 'componentsRollback', 'componentsUninstall', 'componentsOpen']) {
    assert.equal(exposures.shell[action], undefined, `${action} must remain launcher-only`);
  }
});

test('non-harness roles do not expose the WhaleBridge bridge', (t) => {
  withMainFrame(t, true);
  for (const role of ['boot', 'launcher', 'pet', 'pet-live2d', 'admin']) {
    const { exposures } = loadPreload(['electron', `--dshd-shell-role=${role}`]);
    assert.equal(exposures.dshDesktop?.whaleBridge, undefined, `unexpected WhaleBridge bridge for ${role}`);
  }
});

test('harness subframes do not expose the WhaleBridge bridge or shell privileges', (t) => {
  withMainFrame(t, false);
  const { exposures } = loadPreload(['electron', '--dshd-shell-role=harness']);
  assert.equal(exposures.dshDesktop, undefined);
  assert.equal(exposures.shell, undefined);
});

test('non-harness roles do not expose updates/browser/platform bridges', () => {
  const { exposures } = loadPreload(
    ['electron', '--dshd-shell-role=boot'],
    { webUtils: { getPathForFile: () => '' } },
  );
  assert.equal(exposures.dshDesktop?.updates, undefined);
  assert.equal(exposures.dshDesktop?.browser, undefined);
  assert.equal(exposures.dshPlatform, undefined);
});
