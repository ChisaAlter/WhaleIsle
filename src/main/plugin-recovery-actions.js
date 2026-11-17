'use strict';

/**
 * @param {{ harness?: { retryFullPlugins: () => unknown } | null,
 *           startHarness: () => unknown,
 *           saveConfig: (patch: { pluginRecovery: unknown }) => void,
 *           emptyPluginRecovery: () => unknown,
 *           cleanup?: () => void }} deps
 */
async function retryFullPluginsFromIpc({
  harness,
  startHarness,
  saveConfig,
  emptyPluginRecovery,
  cleanup,
}) {
  if (harness) {
    if (typeof cleanup === 'function') cleanup();
    return harness.retryFullPlugins();
  }
  saveConfig({ pluginRecovery: emptyPluginRecovery() });
  await startHarness();
  return undefined;
}

/**
 * @param {{ ok: boolean, stopped: boolean,
 *           retryFull: () => unknown,
 *           startHarness: () => unknown }} deps
 */
async function restartAfterPluginUninstall({
  ok,
  stopped,
  retryFull,
  startHarness,
}) {
  if (ok) return retryFull();
  if (stopped) return startHarness();
  return undefined;
}

module.exports = {
  retryFullPluginsFromIpc,
  restartAfterPluginUninstall,
};
