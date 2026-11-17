'use strict';

const { app } = require('electron');
const { DshManager, ensureOwnedPort } = require('./dsh');
const { HarnessController } = require('./harness-controller');
const { loadConfig, saveConfig, readConfigSnapshot, configRevision } = require('./config');
const { stripDroppedPlugins, healDanglingBundles, ensureDesktopInstallPlugin, applyDisabledBundles } = require('./plugins');
const { removeDshMarketPreset } = require('./dshmarket-preset');
const { ensureUsagePanelPlugin } = require('./usage-panel-preset');
const { ensureSessionSearchOverlay } = require('./session-search-overlay');
const { ensureDshImPlugin } = require('./dsh-im-desktop');
const { ensureDesktopDshProject, projectAvailable } = require('./dsh-project-desktop');
const { ensureDesktopTaskControl } = require('./task-control-overlay');
const { ensureDesktopPlatformSession } = require('./platform-session-overlay');
const { ensureDesktopAcpAgents } = require('./dsh-acp-agents-desktop');
const { ensureDesktopDshWhale } = require('./dsh-whale-desktop');
const { ensureDesktopDshRemote } = require('./dsh-remote-desktop');
const { ensureDesktopDshPad } = require('./dsh-pad-desktop');
const { ensureDesktopDeepSeekTools } = require('./deepseek-tools-desktop');
const { ensureDesktopMarket } = require('./dsh-market-desktop');
const { ensureDesktopOfficeRuntime } = require('./office-runtime');
const { removeLegacyDshbotPreset } = require('./legacy-dshbot-preset');
const { ensureWorkspace } = require('./workspace-rpc');
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
      return showHarness(url, { cookie: dsh.sessionCookie, activate: !state.backgroundStartup, ...extra });
    },
    sendToBoot,
    isBootLoaded,
    getHarnessWebContents,
    resolveLaunchTarget,
    readConfigSnapshot,
    currentConfigRevision: configRevision,
    stripDroppedPlugins,
    ensureDesktopInstallPlugin,
    removeDshMarketPreset,
    ensureUsagePanelPlugin,
    ensureSessionSearchOverlay,
    ensureDshImPlugin,
    ensureDshProjectPlugin: ensureDesktopDshProject,
    projectAvailable,
    ensureTaskControlPlugin: ensureDesktopTaskControl,
    ensureDesktopPlatformSession,
    ensureDesktopAcpAgents,
    ensureDshWhalePlugin: ensureDesktopDshWhale,
    ensureDshRemotePlugin: ensureDesktopDshRemote,
    ensureDshPadPlugin: ensureDesktopDshPad,
    ensureDeepSeekToolsPlugin: ensureDesktopDeepSeekTools,
    ensureDesktopMarket,
    ensureDesktopOfficeRuntime: async () => ensureDesktopOfficeRuntime(),
    removeLegacyDshbotPreset,
    applyDisabledBundles,
    healDanglingBundles,
    saveConfig,
    appVersion: app.getVersion(),
    ensureWorkspace: (/** @type {any} */ url, /** @type {any} */ workspace, /** @type {any} */ fetchImpl, /** @type {any} */ options) => (
      ensureWorkspace(url, workspace, fetchImpl, { cookie: dsh.sessionCookie, ...options })
    ),
  });
}

module.exports = { createAppHarness };
