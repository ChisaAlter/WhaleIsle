'use strict';

// Launcher-surface IPC shared by the full desktop package (src/main/ipc.js)
// and the slim launcher package (src/main-launcher/ipc.js). Same channels,
// same payloads, one implementation: the `handle` wrapper keeps role
// authorization fail-closed and every handler is a thin delegate into the
// injected launcher service — no orchestration lives here.

const { ipcMain, nativeTheme } = require('electron');
const { IPC_ROLES, assertIpcSender } = require('./ipc-authorization');
const { loadConfig, publicConfig, credentialStorageMode } = require('./config');
const { resolveNodeBin, resolveDshBin, sourceHarnessStatus } = require('./dsh');
const { listThemes, resolveTheme } = require('../shared/themes');
const { currentVersion, REPO_URL, RELEASES_PAGE } = require('./update');
const { tryGetDesktopDshHome } = require('../shared/dsh-home');

const ALL_SURFACES = [IPC_ROLES.BOOT, IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER];
const LAUNCHER_ONLY = [IPC_ROLES.LAUNCHER];
const UPDATE_SURFACES = [IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER];

function configLocale(config = loadConfig()) {
  return config.locale === 'en' ? 'en' : 'zh';
}

// Binary/source detection runs sync filesystem probes and, on machines
// without a bundled or standard-path Node, `where.exe`/`which` subprocesses.
// Neither nodeBin nor dshBin is renderer-writable, so the detection result
// cannot change at runtime; memoize it instead of re-probing on every
// get-config / launcher-status / save-config response.
let detectedShellInfoCache = null;
let detectedShellInfoKey = '';

function detectedShellInfo(config) {
  const key = `${config.nodeBin || ''}${config.dshBin || ''}`;
  if (detectedShellInfoCache && detectedShellInfoKey === key) {
    return detectedShellInfoCache;
  }
  const source = sourceHarnessStatus();
  detectedShellInfoKey = key;
  detectedShellInfoCache = {
    nodeDetected: resolveNodeBin(config),
    dshDetected: source.present
      ? (source.built ? `源码 ${source.root}` : `源码未构建 ${source.root}`)
      : resolveDshBin(config),
    themes: listThemes(),
    appVersion: currentVersion(),
    repoUrl: REPO_URL,
    releasesUrl: RELEASES_PAGE,
    dshHome: tryGetDesktopDshHome(),
    // About/diagnostics: whether credentials.json is protected by the OS
    // keychain (safeStorage) or sits in the documented plaintext fallback.
    credentialStorage: credentialStorageMode(),
  };
  return detectedShellInfoCache;
}

function configPayload(config) {
  return {
    ...publicConfig(config),
    locale: configLocale(config),
    theme: config.theme || 'midnight',
    // themeTokens stay live: the harness writes its own settings.yaml when the
    // user changes the UI theme, so this must re-read per call.
    themeTokens: resolveTheme(config, {
      systemDark: Boolean(nativeTheme && nativeTheme.shouldUseDarkColors),
    }),
    ...detectedShellInfo(config),
  };
}

/**
 * Register every channel the launcher renderer can invoke.
 * `recordBootRestart`/`harness`/`dsh` only matter for non-launcher roles on
 * shared-surface channels; the slim package passes stubs and only ever sees
 * launcher-role senders.
 */
function registerLauncherChannels({ launcher, dsh, harness, startDesktop, recordBootRestart, extraChannels = [], onQuitCommit }) {
  const handle = (channel, roles, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      assertIpcSender(event, roles);
      return listener(event, ...args);
    });
  };
  // Extension seam (frozen contract, refactor plan §5.0): lane modules each
  // export register(ctx) and mount their own channels through the same
  // authorized wrapper — never by re-opening ipcMain themselves.
  const laneCtx = {
    handle,
    launcher,
    LAUNCHER_ONLY,
    IPC_ROLES,
    onQuitCommit,
    send: (event, channel, payload) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send(channel, payload);
      }
    },
  };

  handle('shell:get-config', ALL_SURFACES, () => configPayload(loadConfig()));

  // Launcher-role retries go through the service (startDesktop recovery
  // launch records last-desktop-start itself); boot/harness senders take the
  // kernel path and record here.
  handle('shell:retry-full-plugins', ALL_SURFACES, async (event) => {
    const role = assertIpcSender(event, ALL_SURFACES);
    if (role === IPC_ROLES.LAUNCHER && typeof startDesktop === 'function') {
      return launcher.retryFullPlugins();
    }
    // The non-launcher boot path shares recordBootRestart's admission
    // boundary: a held maintenance slot or a blocked import journal refuses
    // with {ok:false} before any restart side effect.
    const outcome = await recordBootRestart();
    if (outcome && outcome.ok === false) {
      return outcome;
    }
    return harness ? harness.snapshot() : dsh.snapshot();
  });

  handle('shell:check-update', UPDATE_SURFACES, () => launcher.checkUpdate());

  handle('shell:install-update', UPDATE_SURFACES, async (event) => launcher.installUpdate((payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('shell:update-progress', payload);
    }
  }));

  handle('shell:launcher-status', LAUNCHER_ONLY, () => launcher.status());

  handle('shell:save-launcher-config', LAUNCHER_ONLY, (_event, patch) => launcher.saveLauncherConfig(patch));

  handle('shell:scan-import', LAUNCHER_ONLY, (_event, payload) => launcher.scanImport(payload));

  handle('shell:pick-import-source', LAUNCHER_ONLY, () => launcher.pickImportSource());

  handle('shell:pick-skill-dir', LAUNCHER_ONLY, () => launcher.pickSkillDir());

  handle('shell:run-import', LAUNCHER_ONLY, async (event, options = {}) => launcher.runImport(options, (payload) => {
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('shell:import-progress', payload);
    }
  }));

  handle('shell:cancel-import', LAUNCHER_ONLY, (_event, options = {}) => launcher.cancelImport(options));

  handle('shell:list-releases', LAUNCHER_ONLY, () => launcher.listReleases());

  handle('shell:install-release', LAUNCHER_ONLY, async (event, tag) => launcher.installRelease(tag, (payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('shell:update-progress', payload);
    }
  }));

  handle('shell:uninstall-app', LAUNCHER_ONLY, () => launcher.uninstallApp());

  handle('shell:install-runtime', LAUNCHER_ONLY, async (event, options = {}) => launcher.installRuntime(options, (payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('shell:update-progress', payload);
    }
  }));

  handle('shell:cancel-runtime-install', LAUNCHER_ONLY, () => launcher.cancelRuntimeInstall());

  handle('shell:stop-desktop', LAUNCHER_ONLY, () => launcher.stopDesktop());

  handle('shell:plugin-forensics', LAUNCHER_ONLY, () => launcher.pluginForensics());

  handle('shell:disable-plugins', LAUNCHER_ONLY, (_event, names) => launcher.disablePlugins(names));

  handle('shell:disable-suspects-and-start', LAUNCHER_ONLY, (_event, names) => launcher.disableSuspectsAndStart(names));

  handle('shell:disable-plugin', LAUNCHER_ONLY, (_event, name) => launcher.disablePlugin(name));

  handle('shell:enable-plugin', LAUNCHER_ONLY, (_event, name) => launcher.enablePlugin(name));

  handle('shell:remove-plugin', LAUNCHER_ONLY, async (event, name) => launcher.removePlugin(name, (payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('shell:plugin-progress', payload);
    }
  }));

  handle('shell:start-desktop', LAUNCHER_ONLY, () => launcher.startDesktop());

  handle('shell:start-desktop-skipped', LAUNCHER_ONLY, () => launcher.startDesktopSkipped());

  for (const mod of extraChannels) {
    if (mod && typeof mod.register === 'function') {
      mod.register(laneCtx);
    }
  }
}

module.exports = { registerLauncherChannels, configPayload };
