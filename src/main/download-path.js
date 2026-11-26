const fs = require('node:fs');
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

/** @param {string} candidate */
function defaultPathTaken(candidate) {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch (error) {
    return (/** @type {any} */ (error))?.code !== 'ENOENT';
  }
}

/** @param {string} file */
function normalizeReservedKey(file) {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * @param {string} candidate
 * @param {Set<string> | null} reservedSet
 * @param {(candidate: string) => boolean} isTaken
 */
function isTargetTaken(candidate, reservedSet, isTaken) {
  if (reservedSet && reservedSet.has(normalizeReservedKey(candidate))) {
    return true;
  }
  return isTaken(candidate);
}

/** @param {string} filename */
function splitDownloadStemAndExt(filename) {
  const ext = path.extname(filename);
  if (!ext || ext === filename) {
    return { stem: filename, ext: '' };
  }
  return { stem: filename.slice(0, -ext.length), ext };
}

/**
 * @param {string} stem
 * @param {string} ext
 * @param {string} suffix
 */
function numberedDownloadFilename(stem, ext, suffix) {
  const suffixChars = Array.from(suffix);
  const extChars = Array.from(ext);
  const maxStemChars = Math.max(1, MAX_DOWNLOAD_NAME_CHARS - suffixChars.length - extChars.length);
  const clippedStem = Array.from(stem).slice(0, maxStemChars).join('').replace(/[. ]+$/g, '') || 'file';
  return sanitizeDownloadFilename(`${clippedStem}${suffix}${ext}`);
}

/**
 * @param {string} downloadsDir
 * @param {string} filename
 * @param {{ reserved?: Iterable<string>, isTaken?: (candidate: string) => boolean }} [options]
 * @returns {string}
 */
function downloadSavePath(downloadsDir, filename, options = {}) {
  if (typeof downloadsDir !== 'string' || !downloadsDir.trim()) {
    throw new TypeError('Downloads directory is required');
  }
  const root = path.resolve(downloadsDir);
  const sanitized = sanitizeDownloadFilename(filename);
  const target = path.resolve(root, sanitized);
  if (path.dirname(target) !== root) {
    throw new Error('Download path escaped the downloads directory');
  }
  const reservedSet = options.reserved
    ? new Set(Array.from(options.reserved, (entry) => normalizeReservedKey(entry)))
    : null;
  const isTaken = typeof options.isTaken === 'function' ? options.isTaken : defaultPathTaken;
  if (!isTargetTaken(target, reservedSet, isTaken)) {
    return target;
  }
  const { stem, ext } = splitDownloadStemAndExt(sanitized);
  for (let index = 1; index <= 10_000; index += 1) {
    const candidateName = numberedDownloadFilename(stem, ext, ` (${index})`);
    const candidate = path.resolve(root, candidateName);
    if (path.dirname(candidate) === root && !isTargetTaken(candidate, reservedSet, isTaken)) {
      return candidate;
    }
  }
  const fallbackName = numberedDownloadFilename(stem, ext, ` (${Date.now()}-${Math.random().toString(36).slice(2, 6)})`);
  const fallback = path.resolve(root, fallbackName);
  if (path.dirname(fallback) !== root) {
    throw new Error('Download path escaped the downloads directory');
  }
  return fallback;
}

/**
 * Create a `will-download` listener that reserves unique paths in `Downloads`
 * so concurrent or repeated downloads never silently overwrite existing files.
 * @param {{ getPath: (name: 'downloads') => string }} electronApp
 * @returns {(event: unknown, item: any) => void}
 */
function createDownloadCollisionHandler(electronApp) {
  /** @type {Set<string>} */
  const activeDownloadPaths = new Set();
  return (_event, item) => {
    const dest = downloadSavePath(electronApp.getPath('downloads'), item.getFilename(), {
      reserved: activeDownloadPaths,
    });
    activeDownloadPaths.add(dest);
    if (typeof item.once === 'function') {
      item.once('done', () => { activeDownloadPaths.delete(dest); });
    }
    try {
      item.setSavePath(dest);
    } catch (error) {
      activeDownloadPaths.delete(dest);
      throw error;
    }
    if (typeof item.once !== 'function') {
      activeDownloadPaths.delete(dest);
    }
  };
}

module.exports = {
  DEFAULT_DOWNLOAD_NAME,
  MAX_DOWNLOAD_NAME_CHARS,
  WINDOWS_DEVICE_NAME,
  sanitizeDownloadFilename,
  downloadSavePath,
  createDownloadCollisionHandler,
};
