'use strict';

// Launcher-surface IPC shared by the full desktop package (src/main/ipc.js)
// and the slim launcher package (src/main-launcher/ipc.js). Same channels,
// same payloads, one implementation: the `handle` wrapper keeps role
// authorization fail-closed and every handler is a thin delegate into the
// injected launcher service — no orchestration lives here.

const { nativeTheme } = require('electron');
const { IPC_ROLES, assertIpcSender } = require('./ipc-authorization');
const { registerIpc } = require('./ipc-register');
const { loadConfig, publicConfig, credentialStorageMode } = require('./config');
const { resolveNodeBin, resolveDshBin, sourceHarnessStatus } = require('./dsh');
const { listThemes, resolveTheme } = require('../shared/themes');
const { currentVersion, REPO_URL, RELEASES_PAGE } = require('./update');
const { tryGetDesktopDshHome } = require('../shared/dsh-home');

const RETRY_SURFACES = [IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER];

function configLocale(config = loadConfig()) {
  return config.locale === 'en' ? 'en' : 'zh';
}

// Binary/source detection runs sync filesystem probes and, on machines
// without a bundled or standard-path Node, `where.exe`/`which` subprocesses.
// Neither nodeBin nor dshBin is renderer-writable, so the detection result
// cannot change at runtime; memoize it instead of re-probing on every
// get-config / launcher-status / save-config response.
/** @type {any} */
let detectedShellInfoCache = null;
let detectedShellInfoKey = '';

/** @param {any} config */
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

/** @param {any} config */
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
 * @param {{
 *   launcher: any,
 *   dsh: any,
 *   harness: any,
 *   startDesktop?: () => Promise<any>,
 *   recordBootRestart: () => Promise<any>,
 *   extraChannels?: Array<{register?: (ctx: any) => void} | null | undefined>,
 *   onQuitCommit?: (reason: string) => any,
 * }} options
 */
function registerLauncherChannels({ launcher, dsh, harness, startDesktop, recordBootRestart, extraChannels = [], onQuitCommit }) {
  // Shared wrapper: kind/roles/validate resolve from the IPC contract —
  // lane modules mount through the same bound handle, never ipcMain directly.
  /** @type {(channel: string, listener: (event: any, ...args: any[]) => any) => void} */
  const handle = (channel, listener) => {
    registerIpc({ channel, handler: listener });
  };
  // Extension seam (frozen contract, refactor plan §5.0): lane modules each
  // export register(ctx) and mount their own channels through the same
  // authorized wrapper — never by re-opening ipcMain themselves.
  const laneCtx = {
    handle,
    launcher,
    onQuitCommit,
    send: (/** @type {any} */ event, /** @type {string} */ channel, /** @type {any} */ payload) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send(channel, payload);
      }
    },
  };

  handle('shell:get-config', () => configPayload(loadConfig()));

  // Launcher-role retries go through the service (startDesktop recovery
  // launch records last-desktop-start itself); harness senders take the
  // kernel path and record here. Boot senders are refused upstream by the
  // contract roles — the boot page restarts through shell:restart instead.
  handle('shell:retry-full-plugins', async (/** @type {any} */ event) => {
    const role = assertIpcSender(event, RETRY_SURFACES);
    if (role === IPC_ROLES.LAUNCHER && typeof startDesktop === 'function') {
      return launcher.retryFullPlugins();
    }
    // The harness path shares recordBootRestart's admission boundary: a
    // held maintenance slot or a blocked import journal refuses with
    // {ok:false} before any restart side effect.
    const outcome = await recordBootRestart();
    if (outcome && outcome.ok === false) {
      return outcome;
    }
    return harness ? harness.snapshot() : dsh.snapshot();
  });

  handle('shell:check-update', () => launcher.checkUpdate());

  handle('shell:install-update', async (/** @type {any} */ event) => launcher.installUpdate((/** @type {any} */ payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('shell:update-progress', payload);
    }
  }));

  handle('shell:launcher-status', () => launcher.status());

  handle('shell:save-launcher-config', (/** @type {any} */ _event, /** @type {any} */ patch) => launcher.saveLauncherConfig(patch));

  handle('shell:scan-import', (/** @type {any} */ _event, /** @type {any} */ payload) => launcher.scanImport(payload));

  handle('shell:pick-import-source', () => launcher.pickImportSource());

  handle('shell:pick-skill-dir', () => launcher.pickSkillDir());

  handle('shell:run-import', async (/** @type {any} */ event, /** @type {any} */ options = {}) => launcher.runImport(options, (/** @type {any} */ payload) => {
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('shell:import-progress', payload);
    }
  }));

  handle('shell:cancel-import', (/** @type {any} */ _event, /** @type {any} */ options = {}) => launcher.cancelImport(options));

  handle('shell:list-releases', () => launcher.listReleases());

  handle('shell:install-release', async (/** @type {any} */ event, /** @type {any} */ tag) => launcher.installRelease(tag, (/** @type {any} */ payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('shell:update-progress', payload);
    }
  }));

  handle('shell:uninstall-app', () => launcher.uninstallApp());

  handle('shell:install-runtime', async (/** @type {any} */ event, /** @type {any} */ options = {}) => launcher.installRuntime(options, (/** @type {any} */ payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('shell:update-progress', payload);
    }
  }));

  handle('shell:cancel-runtime-install', () => launcher.cancelRuntimeInstall());

  handle('shell:stop-desktop', () => launcher.stopDesktop());

  handle('shell:plugin-forensics', () => launcher.pluginForensics());

  handle('shell:disable-plugins', (/** @type {any} */ _event, /** @type {any} */ names) => launcher.disablePlugins(names));

  handle('shell:disable-suspects-and-start', (/** @type {any} */ _event, /** @type {any} */ names) => launcher.disableSuspectsAndStart(names));

  handle('shell:disable-plugin', (/** @type {any} */ _event, /** @type {any} */ name) => launcher.disablePlugin(name));

  handle('shell:enable-plugin', (/** @type {any} */ _event, /** @type {any} */ name) => launcher.enablePlugin(name));

  handle('shell:remove-plugin', async (/** @type {any} */ event, /** @type {any} */ name) => launcher.removePlugin(name, (/** @type {any} */ payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('shell:plugin-progress', payload);
    }
  }));

  handle('shell:start-desktop', () => launcher.startDesktop());

  handle('shell:start-desktop-skipped', () => launcher.startDesktopSkipped());

  for (const mod of extraChannels) {
    if (mod && typeof mod.register === 'function') {
      mod.register(laneCtx);
    }
  }
}

module.exports = { registerLauncherChannels, configPayload };
