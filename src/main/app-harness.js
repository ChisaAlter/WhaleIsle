'use strict';

const { app } = require('electron');
const { DshManager, ensureOwnedPort } = require('./dsh');
const { HarnessController } = require('./harness-controller');
const { loadConfig, saveConfig, readConfigSnapshot, configRevision } = require('./config');
const {
  getMainWindow,
  showBoot,
  showHarness,
  sendToBoot,
  isBootLoaded,
  getHarnessWebContents,
} = require('./window');

/**
 * HarnessController assembly extracted from index.js (#439 P3-4): every plugin
 * preset, window bridge and config seam the controller needs, wired in the
 * same order. `resolveLaunchTarget` travels with the controller because it is
 * the launch's config/port resolver. Behavior unchanged.
 *
 * @param {object} deps
 * @param {import('./app-shell-state').ShellState} deps.state
 * @param {DshManager} deps.dsh
 * @param {any} deps.remote — DshdRemote instance (harness passes it through)
 * @param {() => any} deps.createMainWindow — creates the main window with its
 *   close handler already bound
 * @param {(targetUrl: string) => unknown} deps.initializeDesktopAccount —
 *   fire-and-forget account init; must never gate workspace entry
 * @returns {HarnessController}
 */
function createAppHarness({ state, dsh, remote, createMainWindow, initializeDesktopAccount }) {
  /**
   * Resolve the port from the start's config snapshot. The revision is handed
   * back so `performStartOnce` can prove the port still belongs to the config
   * the rest of the start read.
   * @param {any} snapshot
   */
  async function resolveLaunchTarget(snapshot) {
    const config = snapshot ? snapshot.config : loadConfig();
    const host = config.host || '127.0.0.1';
    const wanted = Number(config.port) || 3080;
    dsh.log(`检测端口 ${host}:${wanted}`);
    const port = await ensureOwnedPort(host, wanted, /** @type {any} */ ((/** @type {any} */ line) => dsh.log(line)));
    return { port, configRevision: snapshot ? snapshot.revision : undefined };
  }

  return new HarnessController({
    dsh,
    remote,
    loadConfig,
    createMainWindow,
    getMainWindow,
    showBoot: () => showBoot({ activate: !state.backgroundStartup }),
    showHarness: async (/** @type {string} */ url, /** @type {any} */ extra) => {
      // Account services must not delay or gate workspace entry.
      void initializeDesktopAccount(url);
      const shown = await showHarness(url, { cookie: dsh.sessionCookie, activate: !state.backgroundStartup, ...extra });
      state.starPrompt?.syncConfig();
      return shown;
    },
    sendToBoot,
    isBootLoaded,
    getHarnessWebContents,
    resolveLaunchTarget,
    readConfigSnapshot,
    currentConfigRevision: configRevision,
    stripDroppedPlugins: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./plugins')).stripDroppedPlugins(...args),
    ensureDesktopInstallPlugin: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./plugins')).ensureDesktopInstallPlugin(...args),
    removeDshMarketPreset: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./dshmarket-preset')).removeDshMarketPreset(...args),
    ensureUsagePanelPlugin: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./usage-panel-preset')).ensureUsagePanelPlugin(...args),
    ensureSessionSearchOverlay: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./session-search-overlay')).ensureSessionSearchOverlay(...args),
    ensureDshImPlugin: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./dsh-im-desktop')).ensureDshImPlugin(...args),
    ensureDshProjectPlugin: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./dsh-project-desktop')).ensureDesktopDshProject(...args),
    projectAvailable: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./dsh-project-desktop')).projectAvailable(...args),
    ensureTaskControlPlugin: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./task-control-overlay')).ensureDesktopTaskControl(...args),
    ensureDesktopPlatformSession: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./platform-session-overlay')).ensureDesktopPlatformSession(...args),
    ensureDesktopAcpAgents: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./dsh-acp-agents-desktop')).ensureDesktopAcpAgents(...args),
    ensureDshWhalePlugin: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./dsh-whale-desktop')).ensureDesktopDshWhaleAsync(...args),
    ensureDshRemotePlugin: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./dsh-remote-desktop')).ensureDesktopDshRemote(...args),
    ensureDshPadPlugin: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./dsh-pad-desktop')).ensureDesktopDshPad(...args),
    ensureDeepSeekToolsPlugin: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./deepseek-tools-desktop')).ensureDesktopDeepSeekTools(...args),
    ensureDesktopMarket: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./dsh-market-desktop')).ensureDesktopMarket(...args),
    ensureDesktopOfficeRuntime: async () => require('./office-runtime').ensureDesktopOfficeRuntime(),
    removeLegacyDshbotPreset: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./legacy-dshbot-preset')).removeLegacyDshbotPreset(...args),
    applyDisabledBundles: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./plugins')).applyDisabledBundles(...args),
    healDanglingBundles: (/** @type {any[]} */ ...args) => /** @type {any} */ (require('./plugins')).healDanglingBundles(...args),
    saveConfig,
    appVersion: app.getVersion(),
    ensureWorkspace: (/** @type {any} */ url, /** @type {any} */ workspace, /** @type {any} */ fetchImpl, /** @type {any} */ options) => (
      require('./workspace-rpc').ensureWorkspace(url, workspace, fetchImpl, { cookie: dsh.sessionCookie, ...options })
    ),
  });
}

module.exports = { createAppHarness };
