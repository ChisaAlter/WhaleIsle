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
  await shell.openExternal(url);
  return true;
}

module.exports = { openExternalHttp };
