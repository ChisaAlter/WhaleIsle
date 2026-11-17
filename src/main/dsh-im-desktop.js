'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { pathToFileURL } = require('url');
const { missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir, stripBlockFromFile } = require('./plugins');
const { atomicWriteFileSync } = require('../shared/fs-safe');

/** npm package name (also used for market/forensics aliases). */
const DSH_IM_PACKAGE = '@xmanrui/dsh-im';
/** Scoped path under profile node_modules / legacy desktop-plugins. */
const DSH_IM_DIR = path.join('@xmanrui', 'dsh-im');
/** Legacy managed-block markers earlier desktop versions wrote into the
 * user-owned cordis.patch.yml; ensure only strips them (migration). */
const DSH_IM_BEGIN = '# --- dshd-gui-dsh-im ---';
const DSH_IM_END = '# --- end dshd-gui-dsh-im ---';
/** Forensics / market / DROPPED aliases (dsh-im is desktop built-in: the
 * aliases are stripped from the disable list, never honored). */
const DSH_IM_ALIASES = [DSH_IM_PACKAGE, 'dsh-im', 'xmanrui-dsh-im'];
/** Loader insert id used by both the legacy managed block and the overlay. */
const DSH_IM_INSERT_ID = 'xmanrui-dsh-im';
const DSH_IM_OVERLAY_FILENAME = 'desktop-dsh-im.patch.yml';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), 'vendor', 'dsh-im');
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', 'dsh-im');
  }
}

/** @param {string} target */
function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} target */
function removeLinkOrDir(target) {
  if (!pathExists(target)) {
    return;
  }
  try {
    fs.readlinkSync(target);
    fs.unlinkSync(target);
    return;
  } catch {
    // Real directory or file, not a junction/symlink.
  }
  const st = fs.lstatSync(target);
  if (st.isSymbolicLink() || st.isFile()) {
    fs.unlinkSync(target);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * Remove a prior soft-preset copy under desktop-plugins so Loader cannot
 * prefer a stale incomplete tree over vendor/dsh-im.
 * @param {string} profileDir
 */
function removeLegacyDesktopCopy(profileDir) {
  removeLinkOrDir(path.join(profileDir, 'desktop-plugins', DSH_IM_DIR));
}

/**
 * Junction/symlink profile node_modules → vendor source so require() and
 * package-name resolution stay coherent with the file:// cordis insert.
 * @param {string} sourceDir
 * @param {string} profileDir
 */
function linkIntoProfileModules(sourceDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', DSH_IM_DIR);
  ensureDirectoryLink(sourceDir, linked);
}

/**
 * Wire first-party `@xmanrui/dsh-im` from vendor (or packaged resources):
 * a desktop-owned `--patch` overlay (`desktop-plugins/dsh-im/
 * desktop-dsh-im.patch.yml`) carries the package-name insert, and a profile
 * node_modules junction to vendor makes the name resolvable. The overlay
 * rides EVERY start (full and skip) — dsh-im is desktop built-in Remote
 * channels, not a user plugin, so the disable list never applies (config
 * normalization strips the aliases). The profile's `cordis.patch.yml` is
 * user-owned: this function only strips the managed block earlier desktop
 * versions wrote there and never writes one back; the strip and the overlay
 * write happen in the same call before every spawn so no start can compose
 * both copies (the CLI's `insert` does not dedupe by id).
 *
 * @param {{ sourceDir?: string, profileDir?: string }} [options]
 * @returns {{
 *   ok: boolean,
 *   added?: boolean,
 *   sourceDir?: string|null,
 *   href?: string,
 *   patchFile?: string,
 *   overlayFile?: string,
 *   patchChanged?: boolean,
 *   error?: string,
 * }}
 */
function ensureDesktopDshIm(options = {}) {
  const sourceDir = options.sourceDir || defaultSourceDir();
  if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
    return { ok: false, added: false, sourceDir: null, error: 'missing-source:package.json' };
  }
  const profileDir = options.profileDir || webProfileDir();
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  // Migration: earlier desktop versions upserted a managed block into the
  // user-owned cordis.patch.yml. Strip it on every start regardless of the
  // outcome below — a stale copy composed next to the overlay double-mounts.
  const patchChanged = stripBlockFromFile(patchFile, DSH_IM_BEGIN, DSH_IM_END);

  const missing = missingRuntimeFiles(sourceDir);
  if (missing.length) {
    // Broken vendor runtime is desktop damage — caller must fail the start
    // (skip cannot fix it); never pretend success with a stale mount.
    return {
      ok: false,
      added: false,
      sourceDir,
      error: `missing-source:node_modules:${missing.join(',')}`,
    };
  }

  removeLegacyDesktopCopy(profileDir);
  linkIntoProfileModules(sourceDir, profileDir);

  // Loader rejects directory file:// imports (ERR_UNSUPPORTED_DIR_IMPORT).
  // Resolve by package name via the junction into profile node_modules —
  // still first-party vendor, never a soft desktop-plugins copy.
  const destDir = path.join(profileDir, 'desktop-plugins', 'dsh-im');
  fs.mkdirSync(destDir, { recursive: true });
  const overlayFile = path.join(destDir, DSH_IM_OVERLAY_FILENAME);
  const overlayContents = [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: only the built-in dsh-im insert, never the profile user layer.',
    '# Regenerated on every start; do not edit.',
    '- insert:',
    `    - id: ${DSH_IM_INSERT_ID}`,
    `      name: ${JSON.stringify(DSH_IM_PACKAGE)}`,
    '',
  ].join('\n');
  const existed = fs.existsSync(overlayFile);
  const existing = existed ? fs.readFileSync(overlayFile, 'utf8') : '';
  if (existing !== overlayContents) {
    atomicWriteFileSync(overlayFile, overlayContents, { encoding: 'utf8' });
  }
  return {
    ok: true,
    added: !existed,
    sourceDir,
    href: pathToFileURL(sourceDir).href,
    patchFile,
    overlayFile,
    patchChanged,
  };
}

/**
 * @deprecated Use ensureDesktopDshIm — kept as alias for harness wiring.
 * @param {Parameters<typeof ensureDesktopDshIm>[0]} options
 */
function ensureDshImPlugin(options) {
  return ensureDesktopDshIm(options);
}

/** @param {unknown} list */
function withoutDshImAliases(list) {
  const blocked = new Set(DSH_IM_ALIASES);
  return (Array.isArray(list) ? list : []).filter((name) => !blocked.has(String(name || '').trim()));
}

module.exports = {
  DSH_IM_PACKAGE,
  DSH_IM_BEGIN,
  DSH_IM_END,
  DSH_IM_ALIASES,
  DSH_IM_INSERT_ID,
  DSH_IM_OVERLAY_FILENAME,
  withoutDshImAliases,
  ensureDesktopDshIm,
  ensureDshImPlugin,
};
