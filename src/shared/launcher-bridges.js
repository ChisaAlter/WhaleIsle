'use strict';

/**
 * Dependency-inversion bridge between `src/main` and `src/launcher`.
 * Main-process modules (`dsh.js`, `app-lifecycle.js`) invoke these hooks
 * without requiring `../launcher/*`; the launcher composition boundary
 * (`src/main/ipc.js`) registers the live implementations at startup.
 */

/** @type {(() => Promise<unknown>) | null} */
let ensureMagpieRuntimeImpl = null;
/** @type {(() => Promise<unknown>) | null} */
let flushBootLogsImpl = null;

/**
 * @param {{
 *   ensureMagpieRuntime?: (() => Promise<unknown>) | null,
 *   flushBootLogs?: (() => Promise<unknown>) | null,
 * }} [bridges]
 */
function registerLauncherBridges(bridges = {}) {
  if (Object.prototype.hasOwnProperty.call(bridges, 'ensureMagpieRuntime')) {
    ensureMagpieRuntimeImpl = typeof bridges.ensureMagpieRuntime === 'function'
      ? bridges.ensureMagpieRuntime
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(bridges, 'flushBootLogs')) {
    flushBootLogsImpl = typeof bridges.flushBootLogs === 'function'
      ? bridges.flushBootLogs
      : null;
  }
}

async function ensureMagpieRuntime() {
  if (!ensureMagpieRuntimeImpl) return undefined;
  return ensureMagpieRuntimeImpl();
}

async function flushBootLogs() {
  if (!flushBootLogsImpl) return [];
  return flushBootLogsImpl();
}

module.exports = {
  registerLauncherBridges,
  ensureMagpieRuntime,
  flushBootLogs,
};
