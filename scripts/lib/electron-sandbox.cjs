'use strict';

/**
 * Shared sandbox decision for tests that launch a real Electron binary.
 *
 * Chromium's Linux sandbox needs the SUID-root `chrome-sandbox` helper next to
 * the Electron executable. Unpacked dev trees often ship it without the setuid
 * bit (and unprivileged user namespaces may be unavailable), so tests disable
 * the sandbox through the supported `ELECTRON_DISABLE_SANDBOX=1` knob. Product
 * launch paths never go through this helper.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} electronBinary - absolute path of the Electron executable
 * @param {(file: string) => fs.Stats} [statSync] - injected for tests
 * @returns {boolean} true when the SUID helper can actually sandbox Chromium
 */
function chromeSandboxUsable(electronBinary, { statSync = fs.statSync } = {}) {
  const helper = path.join(path.dirname(electronBinary), 'chrome-sandbox');
  let stat;
  try {
    stat = statSync(helper);
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
  // Root-owned plus setuid plus rwxr-xr-x, the mode Chromium checks for.
  return stat.uid === 0 && (stat.mode & 0o4755) === 0o4755;
}

/**
 * @param {string} electronBinary - absolute path of the Electron executable
 * @param {object} [deps] - injected for tests
 * @param {string} [deps.platform]
 * @param {() => number} [deps.getuid]
 * @param {(file: string) => fs.Stats} [deps.statSync]
 * @returns {boolean} true when the test child must run with the sandbox off
 */
function shouldDisableElectronSandbox(electronBinary, {
  platform = process.platform,
  getuid = typeof process.getuid === 'function' ? () => process.getuid() : undefined,
  statSync = fs.statSync,
} = {}) {
  if (platform !== 'linux') return false;
  // Chromium refuses the sandbox when the test itself runs as root.
  if (getuid && getuid() === 0) return true;
  return !chromeSandboxUsable(electronBinary, { statSync });
}

/**
 * @param {string} electronBinary - absolute path of the Electron executable
 * @param {NodeJS.ProcessEnv} [baseEnv] - caller env, not mutated
 * @param {object} [deps] - forwarded to shouldDisableElectronSandbox
 * @returns {NodeJS.ProcessEnv} env with ELECTRON_DISABLE_SANDBOX when needed
 */
function electronTestEnv(electronBinary, baseEnv = process.env, deps) {
  const env = { ...baseEnv };
  if (shouldDisableElectronSandbox(electronBinary, deps)) {
    env.ELECTRON_DISABLE_SANDBOX = '1';
  }
  return env;
}

module.exports = {
  chromeSandboxUsable,
  shouldDisableElectronSandbox,
  electronTestEnv,
};
