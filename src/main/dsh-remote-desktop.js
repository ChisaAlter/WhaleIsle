'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { pathToFileURL } = require('url');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir, stripBlockFromFile } = require('./plugins');

/** npm package name (also the profile node_modules junction name). */
const DSH_REMOTE_PACKAGE = 'dsh-remote';
/** Loader insert id — matches the plugin's own cordis.patch.yml, so a
 * surviving stale managed row next to the overlay is caught as a
 * double-mount by the same id. */
const DSH_REMOTE_INSERT_ID = 'dsh-remote';
/** Forensics / disable-list aliases (dsh-remote is desktop built-in: the
 * aliases are stripped from the disable list, never honored). The package
 * name and insert id coincide upstream, so the list dedupes. */
const DSH_REMOTE_ALIASES = [...new Set([DSH_REMOTE_PACKAGE, DSH_REMOTE_INSERT_ID])];
const DSH_REMOTE_OVERLAY_FILENAME = 'desktop-dsh-remote.patch.yml';
/** Managed-block markers reserved for forward compatibility: no desktop
 * version ever wrote this block into the user-owned cordis.patch.yml, but
 * stripping it keeps the same contract as the other built-ins if one ever
 * appears (e.g. via a hand-edited copy of an old overlay). */
const DSH_REMOTE_BEGIN = '# --- dshd-gui-dsh-remote ---';
const DSH_REMOTE_END = '# --- end dshd-gui-dsh-remote ---';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), 'vendor', 'dsh-remote');
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', 'dsh-remote');
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
 * Remove any stale copy under desktop-plugins so Loader cannot prefer an
 * old tree over vendor/dsh-remote. The overlay file is rewritten below,
 * after the dir is reclaimed.
 * @param {string} profileDir
 */
function removeStaleDesktopCopy(profileDir) {
  removeLinkOrDir(path.join(profileDir, 'desktop-plugins', DSH_REMOTE_PACKAGE));
}

/**
 * Junction/symlink profile node_modules → vendor source so the package-name
 * insert resolves to the shipped copy. The desktop build always wins over a
 * same-named user install — the row is a built-in, not a user plugin.
 * @param {string} sourceDir
 * @param {string} profileDir
 */
function linkIntoProfileModules(sourceDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', DSH_REMOTE_PACKAGE);
  ensureDirectoryLink(sourceDir, linked);
}

/**
 * Wire first-party `dsh-remote` from vendor (or packaged resources): a
 * desktop-owned `--patch` overlay (`desktop-plugins/dsh-remote/
 * desktop-dsh-remote.patch.yml`) carries the package-name insert, and a
 * profile node_modules junction to vendor makes the name resolvable. The
 * overlay rides every start (full and skip) while `remoteWorkspaceEnabled`
 * is on —
 * dsh-remote is desktop built-in remote workspaces, not a user plugin, so
 * the disable list never applies (config normalization strips the aliases)
 * and `stripDroppedPlugins` clears same-named manifest/bundle rows. The
 * profile's `cordis.patch.yml` is user-owned: this function only strips a
 * managed block (none exists today; kept for forward compatibility) and
 * never writes one back; the strip and the overlay write happen in the same
 * call before every spawn so no start can compose both copies (the CLI's
 * `insert` does not dedupe by id).
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
function ensureDesktopDshRemote(options = {}) {
  const sourceDir = options.sourceDir || defaultSourceDir();
  const profileDir = options.profileDir || webProfileDir();
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  // Migration guard: strip a managed block if one ever lands in the
  // user-owned cordis.patch.yml — a stale copy composed next to the overlay
  // double-mounts the same insert id.
  const patchChanged = stripBlockFromFile(patchFile, DSH_REMOTE_BEGIN, DSH_REMOTE_END);

  if (options.enabled === false) {
    // Toggled off in 内置功能: drop the overlay so the next start composes no
    // dsh-remote row. The profile node_modules junction stays — harmless
    // without an insert — and the vendor copy is not validated while disabled.
    removeLinkOrDir(path.join(profileDir, 'desktop-plugins', 'dsh-remote', DSH_REMOTE_OVERLAY_FILENAME));
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

  const destDir = path.join(profileDir, 'desktop-plugins', 'dsh-remote');
  const overlayFile = path.join(destDir, DSH_REMOTE_OVERLAY_FILENAME);
  // Any stale copy shares this exact directory, so the removal below also
  // deletes a previous overlay — `existed` is only a first-run marker; the
  // overlay MUST be rewritten unconditionally after the dir is reclaimed.
  const existed = fs.existsSync(overlayFile);

  removeStaleDesktopCopy(profileDir);
  linkIntoProfileModules(sourceDir, profileDir);

  // Loader rejects directory file:// imports (ERR_UNSUPPORTED_DIR_IMPORT).
  // Resolve by package name via the junction into profile node_modules —
  // still first-party vendor, never a soft desktop-plugins copy.
  fs.mkdirSync(destDir, { recursive: true });
  const overlayContents = [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: only the built-in dsh-remote insert, never the profile user layer.',
    '# Regenerated on every start; do not edit.',
    '- insert:',
    `    - id: ${DSH_REMOTE_INSERT_ID}`,
    `      name: ${JSON.stringify(DSH_REMOTE_PACKAGE)}`,
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

/** @deprecated Use ensureDesktopDshRemote — kept as alias for harness wiring. */
function ensureDshRemotePlugin(options) {
  return ensureDesktopDshRemote(options);
}

function withoutDshRemoteAliases(list) {
  const blocked = new Set(DSH_REMOTE_ALIASES);
  return (Array.isArray(list) ? list : []).filter((name) => !blocked.has(String(name || '').trim()));
}

module.exports = {
  DSH_REMOTE_PACKAGE,
  DSH_REMOTE_ALIASES,
  DSH_REMOTE_INSERT_ID,
  DSH_REMOTE_OVERLAY_FILENAME,
  DSH_REMOTE_BEGIN,
  DSH_REMOTE_END,
  withoutDshRemoteAliases,
  ensureDesktopDshRemote,
  ensureDshRemotePlugin,
};
