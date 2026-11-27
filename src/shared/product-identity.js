'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP_ID = 'ai.deepseek.harness.gui';
const LAUNCHER_APP_ID = 'ai.deepseek.harness.launcher';
const NSIS_UNINSTALL_UUID_NAMESPACE = Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex');
const PRODUCT_NAME = 'WhaleIsle';
const LAUNCHER_NAME = 'WhaleIsle Launcher';
const LEGACY_PRODUCT_NAME = 'Deepseek-Harness-Desktop';
const LEGACY_PRODUCT_NAMES = Object.freeze(['Whale Isle', LEGACY_PRODUCT_NAME]);
const LEGACY_LAUNCHER_NAMES = Object.freeze(['Whale Isle Launcher', 'Deepseek-Harness-Launcher']);
const LEGACY_DESKTOP_USER_DATA = LEGACY_PRODUCT_NAME;
const LEGACY_LAUNCHER_USER_DATA = 'Deepseek-Harness-Launcher';

/** @param {string} productName */
function productNames(productName) {
  if (productName === PRODUCT_NAME) return [PRODUCT_NAME, ...LEGACY_PRODUCT_NAMES];
  if (productName === LAUNCHER_NAME) return [LAUNCHER_NAME, ...LEGACY_LAUNCHER_NAMES];
  return [productName];
}

/** @param {string} appId */
function nsisUninstallRegistryId(appId) {
  const digest = crypto.createHash('sha1')
    .update(NSIS_UNINSTALL_UUID_NAMESPACE)
    .update(Buffer.from(String(appId), 'utf8'))
    .digest()
    .subarray(0, 16);
  const bytes = Buffer.from(digest);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** @param {string} value */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} text
 * @param {string} name
 */
function matchesProductNameBoundary(text, name) {
  if (!text || !name) return false;
  return new RegExp(`(?:^|[\\\\/"\\s])${escapeRegExp(name)}(?:$|[\\\\/"\\s.])`, 'i').test(text);
}

/**
 * @param {{ key?: string, displayName: string, uninstallCommand: string, installPath: string }} parsed
 * @param {{ appId: string, productName: string }} target
 */
function isExcludedSiblingEntry(parsed, target) {
  const keyLower = String(parsed.key || '').toLowerCase();
  if (target.productName === PRODUCT_NAME) {
    const launcherUuid = nsisUninstallRegistryId(LAUNCHER_APP_ID).toLowerCase();
    if (keyLower.endsWith(`\\${launcherUuid}`) || keyLower.endsWith(`\\${LAUNCHER_APP_ID}`)) {
      return true;
    }
    return [LAUNCHER_NAME, ...LEGACY_LAUNCHER_NAMES].some((launcherName) => (
      matchesProductNameBoundary(parsed.displayName, launcherName)
      || matchesProductNameBoundary(parsed.uninstallCommand, launcherName)
      || matchesProductNameBoundary(parsed.installPath, launcherName)
    ));
  }
  if (target.productName === LAUNCHER_NAME) {
    const desktopUuid = nsisUninstallRegistryId(APP_ID).toLowerCase();
    if (keyLower.endsWith(`\\${desktopUuid}`) || keyLower.endsWith(`\\${APP_ID}`)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {{ key?: string, displayName: string, uninstallCommand: string, installPath: string } | null} parsed
 * @param {string} name
 * @param {{ appId: string, productName: string }} target
 */
function matchesProductEntry(parsed, name, target) {
  if (!parsed || isExcludedSiblingEntry(parsed, target)) return false;
  return matchesProductNameBoundary(parsed.displayName, name)
    || matchesProductNameBoundary(parsed.uninstallCommand, name)
    || matchesProductNameBoundary(parsed.installPath, name);
}

// A display-name change must not move settings, sessions, or the instance lock.
/**
 * @param {{ getPath(name: string): string, setPath(name: string, path: string): void }} app
 * @param {string} directoryName
 * @param {string[]} [argv]
 * @returns {string}
 */
function preserveUserDataPath(app, directoryName, argv = process.argv) {
  if (argv.some((arg) => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='))) {
    return app.getPath('userData');
  }
  const userData = path.join(app.getPath('appData'), directoryName);
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  return userData;
}

module.exports = {
  APP_ID,
  PRODUCT_NAME,
  LAUNCHER_NAME,
  LEGACY_PRODUCT_NAMES,
  LEGACY_LAUNCHER_NAMES,
  LEGACY_DESKTOP_USER_DATA,
  LEGACY_LAUNCHER_USER_DATA,
  productNames,
  nsisUninstallRegistryId,
  matchesProductEntry,
  preserveUserDataPath,
};
