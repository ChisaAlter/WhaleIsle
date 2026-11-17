'use strict';

const fs = require('fs');
const path = require('path');

const PRODUCT_NAME = 'Whale Isle';
const LAUNCHER_NAME = 'Whale Isle Launcher';
const LEGACY_PRODUCT_NAME = 'Deepseek-Harness-Desktop';
const LEGACY_DESKTOP_USER_DATA = LEGACY_PRODUCT_NAME;
const LEGACY_LAUNCHER_USER_DATA = 'Deepseek-Harness-Launcher';

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
  PRODUCT_NAME,
  LAUNCHER_NAME,
  LEGACY_PRODUCT_NAME,
  LEGACY_DESKTOP_USER_DATA,
  LEGACY_LAUNCHER_USER_DATA,
  preserveUserDataPath,
};
