'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { webProfileDir, stripBlockFromFile } = require('./plugins');

const DSHBOT_BEGIN = '# --- dshd-gui-dshbot ---';
const DSHBOT_END = '# --- end dshd-gui-dshbot ---';

/**
 * Detach retired Bots mounts without deleting plugin or user data.
 * Only the managed patch block, desktop overlay, and owned directory links
 * are removed. Real installs, presets, catalogs, memory, and Sessions remain.
 * @param {{ profileDir?: string, sourceDir?: string }} options
 * @returns {{ ok: boolean, changed: boolean, stripped: boolean, removedLink: boolean, removedOverlay: boolean }}
 */
function removeLegacyDshbotPreset(options = {}) {
  const profileDir = options.profileDir || webProfileDir();
  const stripped = stripBlockFromFile(path.join(profileDir, 'cordis.patch.yml'), DSHBOT_BEGIN, DSHBOT_END);
  const linked = path.join(profileDir, 'node_modules', 'dshbot');
  const ownedCopy = path.resolve(profileDir, 'desktop-plugins', 'dshbot');
  const resources = app?.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
  const sourceDir = options.sourceDir || path.join(resources, 'vendor', 'dshbot');
  const ownedTargets = [ownedCopy, path.resolve(sourceDir)];
  let removedLink = false;
  try {
    if (fs.lstatSync(linked).isSymbolicLink()
      && ownedTargets.includes(path.resolve(path.dirname(linked), fs.readlinkSync(linked)))) {
      fs.unlinkSync(linked);
      removedLink = true;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const overlay = path.join(ownedCopy, 'desktop-dshbot.patch.yml');
  let removedOverlay = false;
  try {
    fs.unlinkSync(overlay);
    removedOverlay = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { ok: true, changed: stripped || removedLink || removedOverlay, stripped, removedLink, removedOverlay };
}

module.exports = { DSHBOT_BEGIN, DSHBOT_END, removeLegacyDshbotPreset };
