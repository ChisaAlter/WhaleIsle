'use strict';

const os = require('node:os');
const { setWindowAcrylic } = require('./window-acrylic');

/** @typedef {'acrylic' | 'none'} WindowMaterial */

/**
 * @typedef {Object} WindowMaterialOptions
 * @property {boolean} [transparent]
 * @property {string} [restoreColor]
 */

/**
 * @typedef {Object} MaterialWindowLike
 * @property {() => boolean} [isDestroyed]
 * @property {(material: 'auto' | 'none' | 'mica' | 'acrylic' | 'tabbed') => void} [setBackgroundMaterial]
 * @property {(backgroundColor: string) => void} [setBackgroundColor]
 */

/** `additionalArguments` flag that advertises native acrylic support to the harness preload. */
const WINDOW_MATERIAL_ARGUMENT = '--dshd-window-material=acrylic';

/** First Windows build whose frame honors `setBackgroundMaterial('acrylic')` (Windows 11 22H2). */
const ACRYLIC_MINIMUM_WINDOWS_BUILD = 22621;

/** @type {WeakSet<object>} */
const acrylicWindows = new WeakSet();

/** @type {WeakMap<object, string>} */
const restoreColors = new WeakMap();

/**
 * Whether `value` is a CSS color string accepted for window background restoration.
 * Rejects fully transparent `#0000` / `#00000000` so an acrylic clear never overwrites
 * the last opaque chrome palette.
 * @param {unknown} value
 * @returns {value is string}
 */
function isValidChromeColor(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!/^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu.test(trimmed)) {
    return false;
  }
  return !/^#(?:0{4}|0{8})$/iu.test(trimmed);
}

/**
 * Whether this host can render Windows 11 22H2+ native acrylic behind a frame.
 * @param {NodeJS.Platform} [platform]
 * @param {string} [osRelease]
 * @returns {boolean}
 */
function windowsAcrylicSupported(platform = process.platform, osRelease = os.release()) {
  if (platform !== 'win32' || typeof osRelease !== 'string') {
    return false;
  }
  const buildText = osRelease.split('.')[2] ?? '';
  if (!/^\d+$/.test(buildText)) {
    return false;
  }
  const build = Number(buildText);
  return Number.isInteger(build) && build >= ACRYLIC_MINIMUM_WINDOWS_BUILD;
}

/**
 * Validate a material value sent by the harness preload.
 * @param {unknown} material
 * @returns {material is WindowMaterial}
 */
function isValidWindowMaterial(material) {
  return material === 'acrylic' || material === 'none';
}

/**
 * Whether `win` currently has the native acrylic material active.
 * @param {object | null | undefined} win
 * @returns {boolean}
 */
function hasAcrylicMaterial(win) {
  return Boolean(win && acrylicWindows.has(win));
}

/**
 * Cache the latest opaque chrome fill reported for `win` so turning acrylic
 * off on a non-transparent host window restores the document's palette.
 * @param {object | null | undefined} win
 * @param {unknown} color
 */
function rememberChromeColor(win, color) {
  if (win && isValidChromeColor(color)) {
    restoreColors.set(win, color.trim());
  }
}

/**
 * The transparent shell uses a clipped compositor visual, not Electron's
 * rectangular HWND material. In particular, even setting Electron's 'none'
 * would replace the shell's alpha surface with a default fill.
 * @param {MaterialWindowLike | null | undefined} win
 * @param {unknown} material
 * @param {WindowMaterialOptions} [options]
 * @returns {boolean}
 */
function applyWindowMaterial(win, material, options = {}) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
    return false;
  }
  if (!isValidWindowMaterial(material)) return false;
  const enabled = material === 'acrylic';
  if (enabled === acrylicWindows.has(win)) return true;
  if (options.transparent) {
    if (!setWindowAcrylic(/** @type {Electron.BrowserWindow} */ (win), enabled)) return false;
  } else {
    if (typeof win.setBackgroundMaterial !== 'function') return false;
    win.setBackgroundMaterial(material);
    if (typeof win.setBackgroundColor === 'function') {
      const color = enabled ? '#00000000' : restoreColors.get(win)
        || (isValidChromeColor(options.restoreColor) ? options.restoreColor.trim() : '');
      if (color) win.setBackgroundColor(color);
    }
  }
  if (enabled) acrylicWindows.add(win);
  else acrylicWindows.delete(win);
  return true;
}

/**
 * Reset `win` back to `'none'` only if this module had enabled acrylic on it.
 * Used when the harness view detaches back to the boot document or closes.
 * @param {MaterialWindowLike | null | undefined} win
 * @param {WindowMaterialOptions} [options]
 * @returns {boolean}
 */
function resetWindowMaterial(win, options = {}) {
  if (!hasAcrylicMaterial(win)) {
    return false;
  }
  return applyWindowMaterial(win, 'none', options);
}

module.exports = {
  WINDOW_MATERIAL_ARGUMENT,
  ACRYLIC_MINIMUM_WINDOWS_BUILD,
  windowsAcrylicSupported,
  isValidWindowMaterial,
  hasAcrylicMaterial,
  rememberChromeColor,
  applyWindowMaterial,
  resetWindowMaterial,
};
