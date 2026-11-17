'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** @param {string} target */
function linkInfo(target) {
  try { return fs.lstatSync(target); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; return null; }
}

/**
 * @param {string} source
 * @param {string} target
 */
function directoryLinkMatches(source, target) {
  if (!linkInfo(target)?.isSymbolicLink()) return false;
  try {
    const actual = fs.statSync(target, { bigint: true });
    const expected = fs.statSync(source, { bigint: true });
    // Compare directory identities, not case-sensitive spellings on Windows.
    return actual.isDirectory() && expected.isDirectory()
      && ((actual.ino > 0 && actual.ino === expected.ino && actual.dev === expected.dev)
        || fs.realpathSync(target) === fs.realpathSync(source));
  } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; return false; }
}

/**
 * @param {string} source
 * @param {string} target
 * @returns {boolean} whether a new link was created.
 */
function ensureDirectoryLink(source, target) {
  const sourceReal = fs.realpathSync(source);
  if (!fs.statSync(sourceReal).isDirectory()) throw new Error(`Plugin source is not a directory: ${source}`);
  if (directoryLinkMatches(sourceReal, target)) return false;
  const info = linkInfo(target);
  if (info) {
    if (!info.isSymbolicLink()) throw new Error(`refusing to replace unknown content at ${target}`);
    // Unlink the junction itself, never traverse or remove its target tree.
    try { fs.unlinkSync(target); } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.symlinkSync(sourceReal, target, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    // Another initializer may have filled the slot after our absence check.
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST' || !directoryLinkMatches(sourceReal, target)) throw error;
    return false;
  }
  return true;
}

module.exports = { linkInfo, directoryLinkMatches, ensureDirectoryLink };
