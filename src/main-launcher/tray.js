'use strict';

// Slim-launcher tray. The desktop package owns src/main/tray*.js with its
// harness/restart/pet rows; the launcher process only needs reopen + quit —
// component supervision is what the tray keeps alive while the window hides.
// `statusLabel` may be a string or a function evaluated on every right-click
// so the menu shows the live supervised-component count instead of a stale
// snapshot taken at tray creation.

const { Tray, Menu, nativeImage } = require('electron');

/**
 * @param {{
 *   onShow: () => void,
 *   onQuit: () => void,
 *   statusLabel?: string | (() => string | undefined),
 * }} options
 */
function launcherTrayTemplate({ onShow, onQuit, statusLabel }) {
  const items = /** @type {import('electron').MenuItemConstructorOptions[]} */ ([]);
  const label = typeof statusLabel === 'function' ? statusLabel() : statusLabel;
  if (label) {
    items.push({ label, enabled: false }, { type: 'separator' });
  }
  items.push(
    { label: '显示窗口', click: () => onShow() },
    { type: 'separator' },
    { label: '退出', click: () => onQuit() },
  );
  return items;
}

/**
 * @param {{
 *   onShow: () => void,
 *   onQuit: () => void,
 *   toolTip?: string,
 *   statusLabel?: string | (() => string | undefined),
 * }} options
 */
function createLauncherTray({ onShow, onQuit, toolTip, statusLabel }) {
  // Lazy: window.js pulls the chrome/navigation graph; requiring it at module
  // top would make the pure template un-unit-testable under plain node.
  const { iconImage } = require('../main/window');
  const { assetFile } = require('../main/paths');
  let image = iconImage();
  if (!image || image.isEmpty()) {
    image = nativeImage.createFromPath(assetFile('icon.svg'));
  }
  if (process.platform === 'win32' && image && !image.isEmpty()) {
    image = image.resize({ width: 24, height: 24 });
  }
  const tray = new Tray(image && !image.isEmpty() ? image : nativeImage.createEmpty());
  tray.setToolTip(toolTip || 'WhaleIsle Launcher');
  const buildMenu = () => Menu.buildFromTemplate(launcherTrayTemplate({ onShow, onQuit, statusLabel }));
  if (typeof statusLabel === 'function') {
    // Dynamic menu: rebuild at right-click so the status line is fresh.
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  } else {
    tray.setContextMenu(buildMenu());
  }
  tray.on('click', () => onShow());
  return tray;
}

module.exports = { createLauncherTray, launcherTrayTemplate };
