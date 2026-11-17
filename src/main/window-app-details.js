'use strict';

const { PRODUCT_NAME, LAUNCHER_NAME } = require('../shared/product-identity');

// These are the installed identities; changing a window's branding must not
// change its taskbar group or the installer's application identity.
const DESKTOP_APP_ID = 'ai.deepseek.harness.gui';
const LAUNCHER_APP_ID = 'ai.deepseek.harness.launcher';

/**
 * Quote one Windows CreateProcess argument, including trailing backslashes.
 * @param {unknown} value
 * @returns {string}
 */
function quoteWindowsArgument(value) {
  return `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

/**
 * Declare the Shell icon and relaunch identity independently of WM_GETICON.
 * Only the executable and source application path are durable launch inputs;
 * process.argv may contain private authentication, session or QA arguments.
 * @param {{ launcher?: boolean, isPackaged: boolean, execPath: string,
 *           appPath: string, iconPath: string }} options
 */
function windowsAppDetails({ launcher = false, isPackaged, execPath, appPath, iconPath }) {
  const command = [execPath];
  if (!isPackaged) command.push(appPath);
  return {
    appId: launcher ? LAUNCHER_APP_ID : DESKTOP_APP_ID,
    // Windows Shell cannot open an ICO inside app.asar. The packaged EXE
    // embeds this same artwork; source runs have a real ICO on disk.
    appIconPath: isPackaged ? execPath : iconPath,
    appIconIndex: 0,
    relaunchCommand: command.map(quoteWindowsArgument).join(' '),
    relaunchDisplayName: launcher ? LAUNCHER_NAME : PRODUCT_NAME,
  };
}

/**
 * @param {Electron.BrowserWindow} win
 * @param {Parameters<typeof windowsAppDetails>[0]} options
 */
function applyWindowsAppDetails(win, options) {
  const { appId, ...relaunch } = windowsAppDetails(options);
  // Setting the ID refreshes the taskbar. Electron writes it first within a
  // single call, so submit the relaunch properties before triggering refresh.
  win.setAppDetails(relaunch);
  win.setAppDetails({ appId });
}

module.exports = { windowsAppDetails, applyWindowsAppDetails };
