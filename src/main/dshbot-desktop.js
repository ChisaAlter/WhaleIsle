'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { pathToFileURL } = require('url');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir, stripBlockFromFile } = require('./plugins');
const { DSHBOT_BEGIN, DSHBOT_END } = require('./legacy-dshbot-preset');

/** npm package name (also the profile node_modules junction name). */
const DSHBOT_PACKAGE = 'dshbot';
/** Loader insert id — matches the plugin's own cordis.patch.yml and the
 * managed block earlier desktop versions upserted, so a surviving stale
 * block next to the overlay is caught as a double-mount by the same id. */
const DSHBOT_INSERT_ID = 'dsh-bot';
/** Forensics / disable-list aliases (dshbot is desktop built-in: the
 * aliases are stripped from the disable list, never honored). The insert
 * id is included so log-attributed `dsh-bot` rows also classify as built-in. */
const DSHBOT_ALIASES = [DSHBOT_PACKAGE, DSHBOT_INSERT_ID];
const DSHBOT_OVERLAY_FILENAME = 'desktop-dshbot.patch.yml';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), 'vendor', 'dshbot');
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', 'dshbot');
  }
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

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
 * Remove the retired preset's copy under desktop-plugins so Loader cannot
 * prefer a stale incomplete tree over vendor/dshbot. The overlay file is
 * rewritten below, after the dir is reclaimed.
 * @param {string} profileDir
 */
function removeLegacyDesktopCopy(profileDir) {
  removeLinkOrDir(path.join(profileDir, 'desktop-plugins', DSHBOT_PACKAGE));
}

/**
 * Junction/symlink profile node_modules → vendor source so the package-name
 * insert resolves to the shipped copy. The desktop build always wins over a
 * same-named user install — the row is a built-in, not a user plugin.
 * @param {string} sourceDir
 * @param {string} profileDir
 */
function linkIntoProfileModules(sourceDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', DSHBOT_PACKAGE);
  ensureDirectoryLink(sourceDir, linked);
}

/**
 * Wire first-party `dshbot` from vendor (or packaged resources): a
 * desktop-owned `--patch` overlay (`desktop-plugins/dshbot/
 * desktop-dshbot.patch.yml`) carries the package-name insert, and a profile
 * node_modules junction to vendor makes the name resolvable. The overlay
 * rides every start (full and skip) only while `dshbotEnabled` is true —
 * dshbot is desktop built-in Bots, not a user plugin, so the disable list
 * never applies (config normalization strips the aliases). The profile's
 * `cordis.patch.yml` is user-owned: this function only strips the managed
 * block earlier desktop versions wrote there and never writes one back; the
 * strip and the overlay write happen in the same call before every spawn so
 * no start can compose both copies (the CLI's `insert` does not dedupe by
 * id).
 *
 * @param {{ sourceDir?: string, profileDir?: string, enabled?: boolean }} [options]
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
function ensureDesktopDshbot(options = {}) {
  const sourceDir = options.sourceDir || defaultSourceDir();
  const profileDir = options.profileDir || webProfileDir();
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  // Migration: earlier desktop versions upserted a managed block into the
  // user-owned cordis.patch.yml. Strip it on every start regardless of the
  // outcome below — a stale copy composed next to the overlay double-mounts.
  const patchChanged = stripBlockFromFile(patchFile, DSHBOT_BEGIN, DSHBOT_END);

  if (options.enabled === false) {
    // Toggled off in 内置功能: drop the overlay so the next start composes no
    // dshbot row. The profile node_modules junction stays — harmless without
    // an insert — and the vendor copy is not validated while disabled.
    removeLinkOrDir(path.join(profileDir, 'desktop-plugins', 'dshbot', DSHBOT_OVERLAY_FILENAME));
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

  const destDir = path.join(profileDir, 'desktop-plugins', 'dshbot');
  const overlayFile = path.join(destDir, DSHBOT_OVERLAY_FILENAME);
  // The retired preset copy shares this exact directory, so the removal below
  // also deletes a previous overlay — `existed` is only a first-run marker;
  // the overlay MUST be rewritten unconditionally after the dir is reclaimed.
  const existed = fs.existsSync(overlayFile);

  removeLegacyDesktopCopy(profileDir);
  linkIntoProfileModules(sourceDir, profileDir);

  // Loader rejects directory file:// imports (ERR_UNSUPPORTED_DIR_IMPORT).
  // Resolve by package name via the junction into profile node_modules —
  // still first-party vendor, never a soft desktop-plugins copy.
  fs.mkdirSync(destDir, { recursive: true });
  const overlayContents = [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: only the built-in dshbot insert, never the profile user layer.',
    '# Regenerated on every start; do not edit.',
    '- insert:',
    `    - id: ${DSHBOT_INSERT_ID}`,
    `      name: ${JSON.stringify(DSHBOT_PACKAGE)}`,
    '',
  ].join('\n');
  const tmp = `${overlayFile}.tmp`;
  fs.writeFileSync(tmp, overlayContents, 'utf8');
  fs.renameSync(tmp, overlayFile);
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

/** @deprecated Use ensureDesktopDshbot — kept as alias for harness wiring. */
function ensureDshbotPlugin(options) {
  return ensureDesktopDshbot(options);
}

function withoutDshbotAliases(list) {
  const blocked = new Set(DSHBOT_ALIASES);
  return (Array.isArray(list) ? list : []).filter((name) => !blocked.has(String(name || '').trim()));
}

module.exports = {
  DSHBOT_PACKAGE,
  DSHBOT_ALIASES,
  DSHBOT_INSERT_ID,
  DSHBOT_OVERLAY_FILENAME,
  withoutDshbotAliases,
  ensureDesktopDshbot,
  ensureDshbotPlugin,
};
