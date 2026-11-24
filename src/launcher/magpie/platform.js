'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAGPIE_ID = 'magpie';
const DEFAULT_GATEWAY_PORT = 3425;
const DEFAULT_WEB_PORT = 3430;
const MAX_BINARY_BYTES = 200 * 1024 * 1024;

/** @type {Record<string, string>} */
const PLATFORM_ASSETS = Object.freeze({
  'win32-x64': 'magpie-cli-windows-amd64.exe',
  'win32-arm64': 'magpie-cli-windows-arm64.exe',
  'darwin-arm64': 'magpie-cli-darwin-arm64',
  'darwin-x64': 'magpie-cli-darwin-amd64',
  'linux-x64': 'magpie-cli-linux-amd64',
  'linux-arm64': 'magpie-cli-linux-arm64',
});

/**
 * @param {string} [platform]
 * @param {string} [arch]
 * @returns {string}
 */
function platformAssetName(platform = process.platform, arch = process.arch) {
  return PLATFORM_ASSETS[`${platform}-${arch}`] || '';
}

/**
 * Resolve Magpie's configuration directory, matching upstream internal/appdir/appdir.go.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [homeDir]
 * @returns {string}
 */
function resolveMagpieConfigDir(env = process.env, homeDir = os.homedir()) {
  const xdg = typeof env?.XDG_CONFIG_HOME === 'string' ? env.XDG_CONFIG_HOME.trim() : '';
  if (xdg && path.isAbsolute(xdg)) {
    return path.join(xdg, 'magpie');
  }
  return path.join(homeDir, '.config', 'magpie');
}

/**
 * Ensure the managed binary directory never carries portable-mode markers
 * (`data/` or `.portable`), which would make upstream `appdir.Portable()`
 * ignore `~/.config/magpie`.
 * @param {string} versionDir
 */
function assertNoPortableMarkers(versionDir) {
  for (const marker of ['data', '.portable']) {
    if (fs.existsSync(path.join(versionDir, marker))) {
      throw new Error(`托管 Magpie 目录存在便携模式标记 ${marker}，已拒绝运行以免隔离配置`);
    }
  }
}

/**
 * Mark the managed Magpie binary (and version dir on POSIX) read-only so
 * upstream's built-in updater reports `stuck: "not-writable"` without mutating
 * the user's shared `settings.json`.
 * @param {string} versionDir
 * @param {string} binaryPath
 * @param {string} [platform]
 */
function setBinaryReadOnly(versionDir, binaryPath, platform = process.platform) {
  try {
    fs.chmodSync(binaryPath, platform === 'win32' ? 0o444 : 0o555);
    if (platform !== 'win32') {
      fs.chmodSync(versionDir, 0o555);
    }
  } catch {
    // Best effort on filesystems that do not support permission bits.
  }
}

/**
 * Restore write bits recursively before replacing or deleting a version dir.
 * @param {string} dir
 */
function setDirWritable(dir) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) return;
  try {
    fs.chmodSync(dir, 0o755);
  } catch {
    // Ignore permission errors on exotic filesystems; removal will report real failure.
  }
  if (!st.isDirectory()) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      setDirWritable(full);
    } else {
      try {
        fs.chmodSync(full, 0o755);
      } catch {
        // Ignore permission errors before rm/rename.
      }
    }
  }
}

module.exports = {
  MAGPIE_ID,
  DEFAULT_GATEWAY_PORT,
  DEFAULT_WEB_PORT,
  MAX_BINARY_BYTES,
  PLATFORM_ASSETS,
  platformAssetName,
  resolveMagpieConfigDir,
  assertNoPortableMarkers,
  setBinaryReadOnly,
  setDirWritable,
};
