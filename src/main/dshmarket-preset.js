'use strict';

const fs = require('fs');
const path = require('path');
const { webProfileDir, stripBlockFromFile } = require('./plugins');

const DSHMARKET_PACKAGE = 'dshmarket';
const DSHMARKET_BEGIN = '# --- dshd-gui-dshmarket ---';
const DSHMARKET_END = '# --- end dshd-gui-dshmarket ---';

/**
 * Whether `node_modules/dshmarket` is the desktop preset symlink (ours) rather
 * than a real install. pnpm installs also use symlinks, so only a link that
 * resolves to the desktop-plugins copy counts.
 * @param {string} linked
 * @param {string} destDir
 * @returns {boolean}
 */
function isDesktopPresetLink(linked, destDir) {
  try {
    if (!fs.lstatSync(linked).isSymbolicLink()) {
      return false;
    }
    const target = path.resolve(path.dirname(linked), fs.readlinkSync(linked));
    return target === path.resolve(destDir);
  } catch {
    return false;
  }
}

/**
 * The marketplace is desktop-owned now (settings section `market` from
 * `@deepseek-ai/dsh-client-ui-settings-market` + the main-process curated
 * catalog/install engine). Older builds preset-installed the third-party
 * `dshmarket` plugin; this removes that residue so the Loader never mounts
 * a second market: the managed cordis.patch.yml insert, the
 * `desktop-plugins/dshmarket` copy, and the preset symlink. A real
 * `node_modules/dshmarket` directory, manifest dependencies, and profile
 * bundles written by `dsh plugin add` are user data and stay on disk —
 * `DROPPED` keeps them out of the mounted composition instead.
 * @param {{ profileDir?: string }} [options]
 */
function removeDshMarketPreset(options = {}) {
  const profileDir = options.profileDir || webProfileDir();
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  const stripped = stripBlockFromFile(patchFile, DSHMARKET_BEGIN, DSHMARKET_END);
  const destDir = path.join(profileDir, 'desktop-plugins', DSHMARKET_PACKAGE);
  const linked = path.join(profileDir, 'node_modules', DSHMARKET_PACKAGE);
  let removedLink = false;
  if (isDesktopPresetLink(linked, destDir)) {
    try {
      fs.unlinkSync(linked);
      removedLink = true;
    } catch {
      // A stuck link is reported through `changed: false`; start continues.
    }
  }
  let removedCopy = false;
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
    removedCopy = true;
  }
  return {
    ok: true,
    stripped,
    removedCopy,
    removedLink,
    changed: stripped || removedCopy || removedLink,
  };
}

module.exports = {
  DSHMARKET_BEGIN,
  DSHMARKET_END,
  removeDshMarketPreset,
};
