const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

function resolveMobileWebRoot() {
  return path.join(__dirname, '..', '..', 'mobile', 'web');
}

/**
 * @param {string} root
 * @param {string} urlPath
 * @returns {string | null}
 */
function safeJoin(root, urlPath) {
  // resolveSpaAsset already decoded the URL once; filenames may contain `%`.
  const decoded = String(urlPath || '/');
  if (decoded.includes('\0')) {
    return null;
  }
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, decoded.replace(/^\/+/, ''));
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    return null;
  }
  if (/\.test\.js$/i.test(resolved)) {
    return null;
  }
  return resolved;
}

/** @param {string} file */
function contentTypeFor(file) {
  return MIME[/** @type {keyof typeof MIME} */ (path.extname(file).toLowerCase())] || 'application/octet-stream';
}

/**
 * @param {string | null | undefined} file
 * @returns {string | null}
 */
function existingFile(file) {
  try {
    return file && fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} root
 * @param {string} urlPath
 * @returns {{ file: string, type: string } | null}
 */
function resolveSpaAsset(root, urlPath) {
  const pathname = decodeURIComponent(String(urlPath || '/').split('?')[0] || '/');
  const last = pathname.split('/').filter(Boolean).pop() || '';
  const hasExt = /\.[a-z0-9]+$/i.test(last);
  if (hasExt) {
    const file = existingFile(safeJoin(root, pathname));
    return file ? { file, type: contentTypeFor(file) } : null;
  }
  const index = existingFile(safeJoin(root, '/index.html'));
  return index ? { file: index, type: contentTypeFor(index) } : null;
}

module.exports = {
  resolveMobileWebRoot,
  resolveSpaAsset,
};
