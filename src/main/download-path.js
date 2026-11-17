const path = require('path');

const DEFAULT_DOWNLOAD_NAME = 'download';
const MAX_DOWNLOAD_NAME_CHARS = 180;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i;

/**
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeDownloadFilename(value) {
  const leaf = path.posix.basename(String(value || '').replace(/\\/g, '/'));
  let name = leaf
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!name || name === '.' || name === '..') {
    name = DEFAULT_DOWNLOAD_NAME;
  }
  if (WINDOWS_DEVICE_NAME.test(name)) {
    name = `_${name}`;
  }
  const chars = Array.from(name);
  if (chars.length > MAX_DOWNLOAD_NAME_CHARS) {
    name = chars.slice(0, MAX_DOWNLOAD_NAME_CHARS).join('').replace(/[. ]+$/g, '') || DEFAULT_DOWNLOAD_NAME;
  }
  return name;
}

/**
 * @param {string} downloadsDir
 * @param {string} filename
 * @returns {string}
 */
function downloadSavePath(downloadsDir, filename) {
  if (typeof downloadsDir !== 'string' || !downloadsDir.trim()) {
    throw new TypeError('Downloads directory is required');
  }
  const root = path.resolve(downloadsDir);
  const target = path.resolve(root, sanitizeDownloadFilename(filename));
  if (path.dirname(target) !== root) {
    throw new Error('Download path escaped the downloads directory');
  }
  return target;
}

module.exports = {
  DEFAULT_DOWNLOAD_NAME,
  MAX_DOWNLOAD_NAME_CHARS,
  WINDOWS_DEVICE_NAME,
  sanitizeDownloadFilename,
  downloadSavePath,
};
