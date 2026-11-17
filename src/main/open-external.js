'use strict';

const { isHttpOrHttpsUrl } = require('./local-url');

/**
 * Open `url` in the system browser only when it is an http(s) address.
 * Anything else (file:, custom schemes, non-strings) is refused so a
 * renderer-supplied URL can never reach the OS opener; returns whether the
 * page was actually handed to the shell.
 * @param {unknown} url
 * @returns {Promise<boolean>}
 */
async function openExternalHttp(url) {
  if (!isHttpOrHttpsUrl(url)) return false;
  const { shell } = require('electron');
  await shell.openExternal(/** @type {string} */ (url));
  return true;
}

/**
 * Non-http(s) targets the desktop deliberately hands to the OS, matched by
 * exact string only — currently the Windows「设置 → 应用」deep link used when
 * no packaged uninstaller exists. Anything not listed here is refused.
 */
const FIXED_EXTERNAL_TARGETS = new Set(['ms-settings:appsfeatures']);

/**
 * Open `url` in the OS handler only when it exactly matches a fixed,
 * code-reviewed non-http(s) target. Returns whether it was handed to the
 * shell.
 * @param {unknown} url
 * @returns {Promise<boolean>}
 */
async function openExternalFixedTarget(url) {
  if (typeof url !== 'string' || !FIXED_EXTERNAL_TARGETS.has(url)) return false;
  const { shell } = require('electron');
  await shell.openExternal(url);
  return true;
}

module.exports = { openExternalHttp, openExternalFixedTarget };
