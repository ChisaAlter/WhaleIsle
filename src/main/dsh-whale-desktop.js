'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { pathToFileURL } = require('url');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir, stripBlockFromFile } = require('./plugins');
const { atomicWriteFileSync } = require('../shared/fs-safe');

/** npm package name (also the profile node_modules junction name). */
const DSH_WHALE_PACKAGE = 'dsh-whale';
/** Loader insert id — matches the plugin's own cordis.patch.yml so a
 * surviving stale managed block next to the overlay is caught as a
 * double-mount by the same id. */
const DSH_WHALE_INSERT_ID = 'dsh-whale';
/** Forensics / disable-list aliases (dsh-whale is desktop built-in: the
 * aliases are stripped from the disable list, never honored). */
const DSH_WHALE_ALIASES = [DSH_WHALE_PACKAGE, 'dshwhale'];
/** Legacy managed-block markers, in case a desktop build ever upserts one. */
const DSH_WHALE_BEGIN = '# --- dshd-gui-dsh-whale ---';
const DSH_WHALE_END = '# --- end dshd-gui-dsh-whale ---';
const DSH_WHALE_OVERLAY_FILENAME = 'desktop-dsh-whale.patch.yml';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), 'vendor', 'dsh-whale');
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', 'dsh-whale');
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
 * Remove a prior copy under desktop-plugins so Loader cannot prefer a stale
 * incomplete tree over vendor/dsh-whale. The overlay file is rewritten
 * below, after the dir is reclaimed.
 * @param {string} profileDir
 */
function removeLegacyDesktopCopy(profileDir) {
  removeLinkOrDir(path.join(profileDir, 'desktop-plugins', DSH_WHALE_PACKAGE));
}

/**
 * Junction/symlink profile node_modules → vendor source so the package-name
 * insert resolves to the shipped copy. The desktop build always wins over a
 * same-named user install — the row is a built-in, not a user plugin.
 * @param {string} sourceDir
 * @param {string} profileDir
 */
function linkIntoProfileModules(sourceDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', DSH_WHALE_PACKAGE);
  ensureDirectoryLink(sourceDir, linked);
}

/**
 * Wire first-party `dsh-whale` from vendor (or packaged resources): a
 * desktop-owned `--patch` overlay (`desktop-plugins/dsh-whale/
 * desktop-dsh-whale.patch.yml`) carries the package-name insert, and a
 * profile node_modules junction to vendor makes the name resolvable. The
 * overlay rides every start (full and skip) only while
 * `whaleAssistantEnabled` is true — dsh-whale is desktop built-in, not a
 * user plugin, so the disable list never applies (config normalization
 * strips the aliases). The profile's `cordis.patch.yml` is user-owned: this
 * function only strips any managed block and never writes one back; the
 * strip and the overlay write happen in the same call before every spawn so
 * no start can compose both copies (the CLI's `insert` does not dedupe by
 * id).
 *
 * @param {{ sourceDir?: string, profileDir?: string, enabled?: boolean }} [options]
 * @returns {{
 *   ok: boolean,
 *   added?: boolean,
 *   disabled?: boolean,
 *   sourceDir?: string|null,
 *   href?: string,
 *   patchFile?: string,
 *   overlayFile?: string,
 *   patchChanged?: boolean,
 *   error?: string,
 * }}
 */
function ensureDesktopDshWhale(options = {}) {
  const sourceDir = options.sourceDir || defaultSourceDir();
  const profileDir = options.profileDir || webProfileDir();
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  const patchChanged = stripBlockFromFile(patchFile, DSH_WHALE_BEGIN, DSH_WHALE_END);

  if (options.enabled === false) {
    // Toggled off: drop the overlay so the next start composes no
    // dsh-whale row. The profile node_modules junction stays — harmless
    // without an insert — and the vendor copy is not validated while
    // disabled.
    removeLinkOrDir(path.join(profileDir, 'desktop-plugins', DSH_WHALE_PACKAGE, DSH_WHALE_OVERLAY_FILENAME));
    return { ok: true, added: false, disabled: true, sourceDir, patchFile, patchChanged };
  }

  const pkgFile = path.join(sourceDir, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    return { ok: false, added: false, sourceDir: null, error: 'missing-source:package.json' };
  }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  } catch {
    // An unreadable manifest cannot declare entries; reported below.
  }
  const missingEntries = manifest ? missingDeclaredEntries(sourceDir, manifest) : ['package.json'];
  const missingDeps = missingRuntimeFiles(sourceDir);
  if (missingEntries.length || missingDeps.length) {
    // Broken vendor runtime is desktop damage — caller must fail the start
    // (skip cannot fix it); never pretend success with a stale mount.
    return {
      ok: false,
      added: false,
      sourceDir,
      error: `missing-source:${[...missingEntries, ...missingDeps].join(',')}`,
    };
  }

  const destDir = path.join(profileDir, 'desktop-plugins', 'dsh-whale');
  const overlayFile = path.join(destDir, DSH_WHALE_OVERLAY_FILENAME);
  const existed = fs.existsSync(overlayFile);

  removeLegacyDesktopCopy(profileDir);
  linkIntoProfileModules(sourceDir, profileDir);

  fs.mkdirSync(destDir, { recursive: true });
  const overlayContents = [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: only the built-in dsh-whale insert, never the profile user layer.',
    '# Regenerated on every start; do not edit.',
    '- insert:',
    `    - id: ${DSH_WHALE_INSERT_ID}`,
    `      name: ${JSON.stringify(DSH_WHALE_PACKAGE)}`,
    '',
  ].join('\n');
  atomicWriteFileSync(overlayFile, overlayContents, { encoding: 'utf8' });
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

/** @param {unknown} list */
function withoutDshWhaleAliases(list) {
  const blocked = new Set(DSH_WHALE_ALIASES);
  return (Array.isArray(list) ? list : []).filter((name) => !blocked.has(String(name || '').trim()));
}

module.exports = {
  DSH_WHALE_PACKAGE,
  DSH_WHALE_INSERT_ID,
  DSH_WHALE_BEGIN,
  DSH_WHALE_END,
  DSH_WHALE_ALIASES,
  DSH_WHALE_OVERLAY_FILENAME,
  withoutDshWhaleAliases,
  ensureDesktopDshWhale,
};
