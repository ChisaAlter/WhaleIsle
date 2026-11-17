'use strict';

// Which product this process is: today's single Electron build is the full
// desktop app (launcher rides inside it); the slim launcher package is marked
// by `dshdPackage: 'launcher'` in its packaged package.json (electron-builder
// extraMetadata). `DSHD_LAUNCHER_PACKAGE=1` forces the slim behavior for dev
// verification before the slim packaging target exists.
const { DESKTOP_TARGET } = require('./install-detect');
const { LEGACY_DESKTOP_USER_DATA } = require('../shared/product-identity');

/** @type {boolean | undefined} */
let cachedFlavor;

function readPackageFlag() {
  try {
    // Resolves to the packaged app's package.json inside asar, where
    // electron-builder has already applied extraMetadata.
    const pkg = /** @type {any} */ (require('../../package.json'));
    return pkg && pkg.dshdPackage === 'launcher';
  } catch {
    return false;
  }
}

function isLauncherPackage() {
  if (cachedFlavor === undefined) {
    cachedFlavor = process.env.DSHD_LAUNCHER_PACKAGE === '1' || readPackageFlag();
  }
  return Boolean(cachedFlavor);
}

// Which product the launcher manages: the desktop identity for the slim
// package, self for the full package (undefined keeps install-detect defaults).
function runtimeTarget() {
  return isLauncherPackage() ? DESKTOP_TARGET : undefined;
}

// The slim launcher keeps its OWN userData and instance lock; both entry
// points pin their original paths after the public product rename. Shared
// desktop state is addressed explicitly rather than moving either directory.
/** @param {import('electron').App} app */
function desktopUserDataDir(app) {
  const path = require('path');
  return path.join(app.getPath('appData'), LEGACY_DESKTOP_USER_DATA);
}

// Where launcher-visible desktop state lives: last-desktop-start.json and
// the import journal are written/read against the runtime's home so both
// processes see one truth; the full package resolves to its own userData.
/** @param {import('electron').App} app */
function desktopStateDir(app) {
  return isLauncherPackage() ? desktopUserDataDir(app) : app.getPath('userData');
}

module.exports = {
  isLauncherPackage,
  runtimeTarget,
  desktopUserDataDir,
  desktopStateDir,
};
