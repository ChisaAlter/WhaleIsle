'use strict';

// Slim launcher package IPC assembly. This process owns no harness/vendor
// stack — the desktop runtime is a separately installed product — so only
// the launcher surface registers here; boot/harness roles are unreachable by
// construction (no such webContents can exist).
const { createLauncherService } = require('../launcher/launcher-service');
const { registerLauncherChannels, configPayload } = require('../main/ipc-launcher');
const ipcComponents = require('../main/ipc-components');
const ipcDelta = require('../main/ipc-delta');
const runtimeInstall = require('../launcher/runtime-install');

/** @param {{launcherConfirm?: {ask?: unknown, register?: (ctx: any) => void}}} [options] */
function registerSlimIpc({ launcherConfirm } = {}) {
  // No in-process kernel: status/forensics read the shared product home, and
  // desktop start/stop delegate to the managed runtime process. A stub dsh
  // keeps collectForensics honest (empty log tail, never "running").
  const dsh = {
    logs: [],
    snapshot: () => ({ state: 'external' }),
    log: (/** @type {string} */ line) => console.log(line),
  };
  const startExternal = () => runtimeInstall.startExternalDesktop();
  const launcher = createLauncherService({
    dsh,
    harness: null,
    // Plugin align after disable/enable is a runtime-side reload; without a
    // control channel the written profile applies on the runtime's next start.
    startHarness: async () => ({ ok: true }),
    startDesktop: startExternal,
    stopDesktopCleanup: () => {},
    configPayload,
    statusContributors: [ipcComponents.contributeStatus, ipcDelta.contributeStatus],
    askLauncherConfirm: launcherConfirm ? launcherConfirm.ask : undefined,
  });
  registerLauncherChannels({
    launcher,
    dsh,
    harness: null,
    startDesktop: startExternal,
    recordBootRestart: async () => {},
    extraChannels: [ipcComponents, ipcDelta, ...(launcherConfirm ? [launcherConfirm] : [])],
  });
}

module.exports = { registerSlimIpc };
