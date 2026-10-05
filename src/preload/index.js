const { contextBridge, ipcRenderer, webUtils } = require('electron');

const SHELL_ROLES = new Set(['boot', 'harness', 'launcher', 'pet', 'pet-live2d']);

function shellRole(argv = process.argv) {
  const prefix = '--dshd-shell-role=';
  const value = argv.find((item) => typeof item === 'string' && item.startsWith(prefix));
  const role = value ? value.slice(prefix.length) : '';
  return SHELL_ROLES.has(role) ? role : null;
}

// The remote feature switch lives in src/main/config.js
// (REMOTE_FEATURE_ENABLED) and reaches this sandboxed preload through the
// `additionalArguments` of the owning window/view. When off (or when the
// argument is missing) the four remote methods are omitted so
// ui-settings-remote does not register the sidebar icon.
function remoteFeatureEnabled(argv = process.argv) {
  const prefix = '--dshd-remote-feature=';
  const value = argv.find((item) => typeof item === 'string' && item.startsWith(prefix));
  return value ? value.slice(prefix.length) === '1' : false;
}

function invoke(renderer, channel) {
  return (...args) => renderer.invoke(channel, ...args);
}

function send(renderer, channel) {
  return (...args) => renderer.send(channel, ...args);
}

function subscribe(renderer, channel) {
  return (handler) => {
    const listener = (_event, payload) => handler(payload);
    renderer.on(channel, listener);
    return () => renderer.removeListener(channel, listener);
  };
}

function windowApi(renderer) {
  return {
    windowAction: send(renderer, 'shell:window'),
    getWindowState: invoke(renderer, 'shell:window-state'),
    onWindowState: subscribe(renderer, 'shell:window-state'),
    onTheme: subscribe(renderer, 'shell:theme'),
  };
}

function configApi(renderer) {
  return {
    getConfig: invoke(renderer, 'shell:get-config'),
    saveConfig: invoke(renderer, 'shell:save-config'),
  };
}

function bootApi(renderer) {
  return {
    ...windowApi(renderer),
    getConfig: invoke(renderer, 'shell:get-config'),
    getState: invoke(renderer, 'shell:get-state'),
    restart: invoke(renderer, 'shell:restart'),
    cancelRestart: invoke(renderer, 'shell:cancel-restart'),
    saveBootLog: invoke(renderer, 'shell:save-boot-log'),
    openLauncher: invoke(renderer, 'shell:open-launcher'),
    onState: subscribe(renderer, 'shell:state'),
    onLog: subscribe(renderer, 'shell:log'),
    onPluginBoot: subscribe(renderer, 'shell:plugin-boot'),
  };
}

function harnessApi(renderer, remoteFeature) {
  return {
    ...windowApi(renderer),
    ...configApi(renderer),
    openExternal: invoke(renderer, 'shell:open-external'),
    openSettings: invoke(renderer, 'shell:open-settings'),
    // Live2D pet settings section writes — normalize + persist + push to
    // the live pet window through the pet manager.
    saveLive2dPetSettings: invoke(renderer, 'shell:live2d-pet-settings'),
    openLauncher: invoke(renderer, 'shell:open-launcher'),
    retryFullPlugins: invoke(renderer, 'shell:retry-full-plugins'),
    checkUpdate: invoke(renderer, 'shell:check-update'),
    installUpdate: invoke(renderer, 'shell:install-update'),
    onUpdateProgress: subscribe(renderer, 'shell:update-progress'),
    reportChrome: send(renderer, 'shell:chrome-metrics'),
    listMarketplace: invoke(renderer, 'shell:list-marketplace'),
    refreshMarketplace: invoke(renderer, 'shell:refresh-marketplace'),
    listWallpaperCatalog: invoke(renderer, 'shell:list-wallpaper-catalog'),
    downloadWallpaper: invoke(renderer, 'shell:download-wallpaper'),
    listInstalledPlugins: invoke(renderer, 'shell:list-installed-plugins'),
    checkMarketplaceUpdates: invoke(renderer, 'shell:check-marketplace-updates'),
    getMarketplaceState: invoke(renderer, 'shell:marketplace-state'),
    getMarketplaceDetails: invoke(renderer, 'shell:marketplace-details'),
    setMarketplaceFavorite: invoke(renderer, 'shell:marketplace-favorite'),
    updateMarketplacePlugins: invoke(renderer, 'shell:update-marketplace-plugins'),
    installPlugin: invoke(renderer, 'shell:install-plugin'),
    installMarketplacePlugin: invoke(renderer, 'shell:install-marketplace-plugin'),
    updateMarketplacePlugin: invoke(renderer, 'shell:update-marketplace-plugin'),
    uninstallPlugin: invoke(renderer, 'shell:uninstall-plugin'),
    openMarketplace: invoke(renderer, 'shell:open-marketplace'),
    onPluginProgress: subscribe(renderer, 'shell:plugin-progress'),
    gitStatus: invoke(renderer, 'shell:git-status'),
    gitFetchForStatus: invoke(renderer, 'shell:git-fetch-status'),
    gitReadPullRequest: invoke(renderer, 'shell:git-pull-request'),
    gitInit: invoke(renderer, 'shell:git-init'),
  gitDiff: invoke(renderer, 'shell:git-diff'),
  gitCheckLargeFiles: invoke(renderer, 'shell:git-check-large-files'),
    gitCommit: invoke(renderer, 'shell:git-commit'),
    gitPush: invoke(renderer, 'shell:git-push'),
    gitPull: invoke(renderer, 'shell:git-pull'),
    onGitProgress: subscribe(renderer, 'shell:git-progress'),
    onGitWorkspacesChanged: subscribe(renderer, 'shell:git-workspaces-changed'),
    gitCreateChangeRequest: invoke(renderer, 'shell:git-create-change-request'),
    gitPublishRepository: invoke(renderer, 'shell:git-publish'),
    openWorkspacePath: invoke(renderer, 'shell:open-workspace-path'),
    listDir: invoke(renderer, 'shell:list-dir'),
    readFile: invoke(renderer, 'shell:read-file'),
    readFileMedia: invoke(renderer, 'shell:read-file-media'),
    writeFile: invoke(renderer, 'shell:write-file'),
    listEditors: invoke(renderer, 'shell:list-editors'),
    openInEditor: invoke(renderer, 'shell:open-in-editor'),
    showItemInFolder: invoke(renderer, 'shell:show-item-in-folder'),
    openDshHome: invoke(renderer, 'shell:open-dsh-home'),
    openWithSystemDefault: invoke(renderer, 'shell:open-with-default'),
    gitStage: invoke(renderer, 'shell:git-stage'),
    gitUnstage: invoke(renderer, 'shell:git-unstage'),
    gitDiscard: invoke(renderer, 'shell:git-discard'),
    gitStatusEntries: invoke(renderer, 'shell:git-status-entries'),
    gitBranchList: invoke(renderer, 'shell:git-branch-list'),
    gitSwitchBranch: invoke(renderer, 'shell:git-switch-branch'),
    gitCreateBranch: invoke(renderer, 'shell:git-create-branch'),
    ptyCreate: invoke(renderer, 'shell:pty-create'),
    ptyWrite: invoke(renderer, 'shell:pty-write'),
    ptyAck: invoke(renderer, 'shell:pty-ack'),
    ptyResize: invoke(renderer, 'shell:pty-resize'),
    ptyKill: invoke(renderer, 'shell:pty-kill'),
    onPtyData: subscribe(renderer, 'shell:pty-data'),
    onPtyExit: subscribe(renderer, 'shell:pty-exit'),
    previewOpen: invoke(renderer, 'shell:preview-open'),
    previewWorkspaceFile: invoke(renderer, 'shell:preview-workspace-file'),
    previewOpenFileWindow: invoke(renderer, 'shell:preview-open-file-window'),
    previewNavigate: invoke(renderer, 'shell:preview-navigate'),
    previewBack: invoke(renderer, 'shell:preview-back'),
    previewForward: invoke(renderer, 'shell:preview-forward'),
    previewReload: invoke(renderer, 'shell:preview-reload'),
    previewHardReload: invoke(renderer, 'shell:preview-hard-reload'),
    previewStop: invoke(renderer, 'shell:preview-stop'),
    previewZoomIn: invoke(renderer, 'shell:preview-zoom-in'),
    previewZoomOut: invoke(renderer, 'shell:preview-zoom-out'),
    previewResetZoom: invoke(renderer, 'shell:preview-zoom-reset'),
    previewSetColorScheme: invoke(renderer, 'shell:preview-color-scheme'),
    previewClearCookies: invoke(renderer, 'shell:preview-clear-cookies'),
    previewClearCache: invoke(renderer, 'shell:preview-clear-cache'),
    previewCaptureScreenshot: invoke(renderer, 'shell:preview-capture-screenshot'),
    previewPickElement: invoke(renderer, 'shell:preview-pick-element'),
    previewCancelPick: invoke(renderer, 'shell:preview-cancel-pick'),
    previewSetAnnotationTheme: invoke(renderer, 'shell:preview-annotation-theme'),
    previewOpenPictureInPicture: invoke(renderer, 'shell:preview-open-pip'),
    previewClosePictureInPicture: invoke(renderer, 'shell:preview-close-pip'),
    previewStartRecording: invoke(renderer, 'shell:preview-start-recording'),
    previewStopRecording: invoke(renderer, 'shell:preview-stop-recording'),
    onPreviewRecordingFrame: subscribe(renderer, 'shell:preview-recording-frame'),
    previewSaveRecording: invoke(renderer, 'shell:preview-save-recording'),
    previewRevealArtifact: invoke(renderer, 'shell:preview-reveal-artifact'),
    previewCopyArtifactToClipboard: invoke(renderer, 'shell:preview-copy-artifact'),
    previewState: invoke(renderer, 'shell:preview-state'),
    previewOpenDevTools: invoke(renderer, 'shell:preview-devtools'),
    previewDiscover: invoke(renderer, 'shell:preview-discover'),
    previewResize: invoke(renderer, 'shell:preview-resize'),
    previewHide: invoke(renderer, 'shell:preview-hide'),
    previewShow: invoke(renderer, 'shell:preview-show'),
    previewClose: invoke(renderer, 'shell:preview-close'),
    onPreviewStateChange: subscribe(renderer, 'shell:preview-state-change'),
    onOpenPreviewUrl: subscribe(renderer, 'shell:open-preview-url'),
    ...(remoteFeature ? {
      getRemote: invoke(renderer, 'shell:get-remote'),
      saveRemote: invoke(renderer, 'shell:save-remote'),
      rotateRemoteToken: invoke(renderer, 'shell:rotate-remote-token'),
      unbindRemoteDevice: invoke(renderer, 'shell:unbind-remote-device'),
      renameRemoteDevice: invoke(renderer, 'shell:rename-remote-device'),
    } : {}),
  };
}

function launcherApi(renderer) {
  return {
    ...windowApi(renderer),
    getConfig: invoke(renderer, 'shell:get-config'),
    saveLauncherConfig: invoke(renderer, 'shell:save-launcher-config'),
    launcherStatus: invoke(renderer, 'shell:launcher-status'),
    checkUpdate: invoke(renderer, 'shell:check-update'),
    installUpdate: invoke(renderer, 'shell:install-update'),
    onUpdateProgress: subscribe(renderer, 'shell:update-progress'),
    scanImport: invoke(renderer, 'shell:scan-import'),
    runImport: invoke(renderer, 'shell:run-import'),
    cancelImport: invoke(renderer, 'shell:cancel-import'),
    onImportProgress: subscribe(renderer, 'shell:import-progress'),
    pickImportSource: invoke(renderer, 'shell:pick-import-source'),
    pickSkillDir: invoke(renderer, 'shell:pick-skill-dir'),
    listReleases: invoke(renderer, 'shell:list-releases'),
    installRelease: invoke(renderer, 'shell:install-release'),
    pluginForensics: invoke(renderer, 'shell:plugin-forensics'),
    disablePlugin: invoke(renderer, 'shell:disable-plugin'),
    disablePlugins: invoke(renderer, 'shell:disable-plugins'),
    enablePlugin: invoke(renderer, 'shell:enable-plugin'),
    removePlugin: invoke(renderer, 'shell:remove-plugin'),
    startDesktop: invoke(renderer, 'shell:start-desktop'),
    stopDesktop: invoke(renderer, 'shell:stop-desktop'),
    uninstallApp: invoke(renderer, 'shell:uninstall-app'),
    installRuntime: invoke(renderer, 'shell:install-runtime'),
    cancelRuntimeInstall: invoke(renderer, 'shell:cancel-runtime-install'),
    installDelta: invoke(renderer, 'shell:install-delta'),
    componentsList: invoke(renderer, 'shell:components-list'),
    componentsInstall: invoke(renderer, 'shell:components-install'),
    componentsStart: invoke(renderer, 'shell:components-start'),
    componentsStop: invoke(renderer, 'shell:components-stop'),
    componentsUpdate: invoke(renderer, 'shell:components-update'),
    componentsRollback: invoke(renderer, 'shell:components-rollback'),
    componentsUninstall: invoke(renderer, 'shell:components-uninstall'),
    componentsUninstallInfo: invoke(renderer, 'shell:components-uninstall-info'),
    componentsOpen: invoke(renderer, 'shell:components-open'),
    onComponentsProgress: subscribe(renderer, 'shell:components-progress'),
    skipUserPlugins: invoke(renderer, 'shell:start-desktop-skipped'),
    retryFullPlugins: invoke(renderer, 'shell:retry-full-plugins'),
    onPluginProgress: subscribe(renderer, 'shell:plugin-progress'),
    onDesktopFailed: subscribe(renderer, 'shell:desktop-failed'),
    onDesktopReady: subscribe(renderer, 'shell:desktop-ready'),
    onShowTab: subscribe(renderer, 'shell:show-tab'),
    onLauncherHint: subscribe(renderer, 'shell:launcher-hint'),
    onAppConfirm: subscribe(renderer, 'shell:app-confirm'),
    respondAppConfirm: invoke(renderer, 'shell:app-confirm:response'),
  };
}

function petApi(renderer) {
  return {
    getState: invoke(renderer, 'shell:pet-state'),
    commitDrag: invoke(renderer, 'shell:pet-drag-commit'),
    openMenu: invoke(renderer, 'shell:pet-menu'),
    onState: subscribe(renderer, 'shell:pet-state'),
    onTheme: subscribe(renderer, 'shell:theme'),
  };
}

function live2dPetApi(renderer) {
  return {
    setInteractive: invoke(renderer, 'shell:live2d-interactive'),
    dragStart: invoke(renderer, 'shell:live2d-drag-start'),
    dragMove: invoke(renderer, 'shell:live2d-drag-move'),
    dragCommit: invoke(renderer, 'shell:live2d-drag-commit'),
    relocate: invoke(renderer, 'shell:live2d-relocate'),
    hidePet: invoke(renderer, 'shell:live2d-hide'),
    getGrowth: invoke(renderer, 'shell:live2d-growth'),
    feedTokens: invoke(renderer, 'shell:live2d-feed'),
    care: invoke(renderer, 'shell:live2d-care'),
    onMove: subscribe(renderer, 'shell:live2d-move'),
    onLayout: subscribe(renderer, 'shell:live2d-layout'),
    onCursor: subscribe(renderer, 'shell:live2d-cursor'),
    onGrowth: subscribe(renderer, 'shell:live2d-growth'),
    getSettings: invoke(renderer, 'shell:live2d-settings-get'),
    onSettings: subscribe(renderer, 'shell:live2d-settings'),
    // 「⚙ 设置」格 navigates to the pet section of the main window's
    // Settings shell — the pet overlay has no settings UI of its own.
    openSettings: invoke(renderer, 'shell:live2d-open-settings'),
    reportRoam: invoke(renderer, 'shell:live2d-roam'),
    fileEat: invoke(renderer, 'shell:live2d-file-eat'),
    // Later-round surface (handlers land with the DSH-link work); callers
    // are optional-chained and must tolerate rejection while unimplemented.
    chat: invoke(renderer, 'shell:live2d-chat'),
    chatFocus: invoke(renderer, 'shell:live2d-chat-focus'),
    chatState: invoke(renderer, 'shell:live2d-chat-state'),
    chatSelectModel: invoke(renderer, 'shell:live2d-chat-select-model'),
    openWhale: invoke(renderer, 'shell:live2d-open-whale'),
    lookScreen: invoke(renderer, 'shell:live2d-look'),
    respondApproval: invoke(renderer, 'shell:live2d-respond'),
    onDsh: subscribe(renderer, 'shell:live2d-dsh'),
    onAlert: subscribe(renderer, 'shell:live2d-alert'),
  };
}

function buildShellApi(role, renderer, remoteFeature = remoteFeatureEnabled()) {
  if (role === 'boot') return bootApi(renderer);
  if (role === 'harness') return harnessApi(renderer, remoteFeature);
  if (role === 'launcher') return launcherApi(renderer);
  if (role === 'pet') return petApi(renderer);
  if (role === 'pet-live2d') return live2dPetApi(renderer);
  return null;
}

const role = shellRole();
const isMainFrame = process.isMainFrame !== false;
const api = isMainFrame ? buildShellApi(role, ipcRenderer) : null;

// Desktop shortcut bridge (upstream ctx.shortcuts contract): the trusted
// product main frame is marked for runtime detection, and a deliberately
// narrow dshDesktop facade — keyboard + shortcuts only, never the full
// official product API (browser/updates) — routes through the shell channels.
if (role === 'harness' && isMainFrame) {
  const markPlatform = () => {
    if (typeof document === 'undefined' || document.documentElement === null) return;
    document.documentElement.dataset.platform = process.platform;
    document.documentElement.dataset.shortcutPolicy = 'native-first';
  };
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.documentElement === null) {
    window.addEventListener('DOMContentLoaded', markPlatform, { once: true });
  } else {
    markPlatform();
  }
  contextBridge.exposeInMainWorld('dshDesktop', {
    protocolVersion: 1,
    onboarding: false,
    keyboard: {
      closeWindow: invoke(ipcRenderer, 'shell:shortcuts-close-window'),
      subscribe: subscribe(ipcRenderer, 'shell:shortcuts-input'),
    },
    shortcuts: {
      get: (definitions) => ipcRenderer.invoke(
        'shell:shortcuts-get', definitions,
        (() => { try { return window.localStorage.getItem('dsh.keybindings.v1'); } catch { return null; } })(),
      ),
      edit: invoke(ipcRenderer, 'shell:shortcuts-edit'),
      recording: invoke(ipcRenderer, 'shell:shortcuts-recording'),
      subscribe: subscribe(ipcRenderer, 'shell:shortcuts-changed'),
    },
    // Upstream DesktopUpdateBridge contract: status/notify only — open()
    // joins the shell-owned update flow (check → confirm → install), never
    // selects artifacts or skips confirmation.
    updates: {
      status: invoke(ipcRenderer, 'shell:updates-status'),
      open: invoke(ipcRenderer, 'shell:updates-open'),
      subscribe: subscribe(ipcRenderer, 'shell:updates-changed'),
    },
    // Upstream DesktopBrowserBridge: lease-scoped webview guests, one open-
    // requested subscription per lease. Partitions are main-owned.
    browser: (() => {
      const openListeners = new Map();
      ipcRenderer.on('shell:browser-open-requested', (_event, request) => {
        if (typeof request !== 'object' || request === null
          || typeof request.lease !== 'string' || typeof request.url !== 'string') return;
        const callbacks = openListeners.get(request.lease);
        if (callbacks === undefined) return;
        for (const callback of [...callbacks]) {
          try { callback(request.url); } catch (error) { console.error('browser link handler failed', error); }
        }
      });
      return {
        acquire: invoke(ipcRenderer, 'shell:browser-acquire'),
        release: invoke(ipcRenderer, 'shell:browser-release'),
        onOpenRequested: (lease, listener) => {
          let callbacks = openListeners.get(lease);
          if (callbacks === undefined) {
            callbacks = new Set();
            openListeners.set(lease, callbacks);
          }
          callbacks.add(listener);
          return () => {
            callbacks.delete(listener);
            if (callbacks.size === 0 && openListeners.get(lease) === callbacks) openListeners.delete(lease);
          };
        },
      };
    })(),
  });

  // Upstream PlatformBridge (globalThis.dshPlatform): non-secret commands to
  // the main-owned embedded document; credentials never cross this bridge.
  contextBridge.exposeInMainWorld('dshPlatform', {
    open: (page, bounds) => ipcRenderer.invoke('dsh-platform:open', page, bounds),
    setBounds: (bounds) => ipcRenderer.invoke('dsh-platform:bounds', bounds),
    close: () => ipcRenderer.invoke('dsh-platform:close'),
  });
  // Host-path bridge (upstream __DSH_HOST_PATHS__ contract): lets dropped files
  // in the composer resolve to real filesystem paths so ui-conversation emits
  // @path references instead of uploading bytes. Images stay uploads upstream.
  contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', {
    pathFor: (file) => {
      try { return webUtils.getPathForFile(file); } catch { return ''; }
    },
  });
  // Native-theme bridge (upstream preload-theme semantics): the Web UI writes
  // html[data-ds-theme-source]; mirroring it to nativeTheme lets shell chrome
  // (dialogs, tray icon contrast) follow the app palette. The main process
  // only accepts this channel from the harness view.
  try {
    let sentTheme;
    const sendTheme = () => {
      const value = document.documentElement.getAttribute('data-ds-theme-source');
      if (value === null || value === sentTheme) return;
      sentTheme = value;
      ipcRenderer.send('shell:native-theme', value);
    };
    const observeTheme = () => {
      new MutationObserver(sendTheme).observe(document.documentElement, { attributeFilter: ['data-ds-theme-source'] });
      sendTheme();
    };
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', observeTheme, { once: true });
    } else {
      observeTheme();
    }
  } catch {
    // Theme mirroring is cosmetic; a missing document root is not a failure.
  }
}

if (api) {
  contextBridge.exposeInMainWorld('shell', api);
}

if (typeof module !== 'undefined') {
  module.exports = { buildShellApi, shellRole, remoteFeatureEnabled };
}
