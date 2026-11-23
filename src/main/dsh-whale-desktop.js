'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveHarnessPeerDirectories,
  stageDesktopPluginRuntime,
  stageDesktopPluginRuntimeAsync,
} = require('./desktop-plugin-runtime');
const { pathToFileURL } = require('url');
const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir, stripBlockFromFile } = require('./plugins');
const { atomicWriteFileIfChanged, atomicWriteFileIfChangedSync } = require('../shared/fs-safe');

/** npm package name (also the profile node_modules junction name). */
const DSH_WHALE_PACKAGE = 'dsh-whale';
const DSH_WHALE_ENTRIES = ['package.json', 'lib', 'src/shared', 'cordis.patch.yml', 'README.md'];
const DSH_WHALE_LINKED_ENTRIES = ['client', 'assets', 'presets', 'stickers'];
const DSH_WHALE_KEEP_ENTRIES = new Set(['runtime', 'dsh-shared', 'desktop-dsh-whale.patch.yml']);
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

function defaultHarnessRoot() {
  try {
    return require('./paths').harnessRoot();
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness');
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
 * Remove stale top-level files left by legacy desktop-plugins copies while
 * keeping the profile-staged `runtime/`, `dsh-shared/` link, and overlay file.
 * @param {string} destDir
 */
function removeLegacyDesktopArtifacts(destDir) {
  let info;
  try { info = fs.lstatSync(destDir); } catch { return; }
  if (info.isSymbolicLink()) {
    fs.unlinkSync(destDir);
    return;
  }
  if (!info.isDirectory()) return;
  for (const name of fs.readdirSync(destDir)) {
    if (!DSH_WHALE_KEEP_ENTRIES.has(name)) {
      removeLinkOrDir(path.join(destDir, name));
    }
  }
}

/**
 * @param {string} harnessRoot
 * @param {{ peerDependencies?: Record<string, string> }} manifest
 */
function whalePeerDirectories(harnessRoot, manifest) {
  return resolveHarnessPeerDirectories(harnessRoot, manifest, { label: 'Whale' });
}

/** @param {string | undefined | null} root */
function canonicalHarnessRoot(root) {
  if (!root) return null;
  try { return fs.realpathSync.native(path.resolve(root)); }
  catch { return path.resolve(root); }
}

function whaleOverlayContents() {
  return [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: only the built-in dsh-whale insert, never the profile user layer.',
    '# Regenerated on every start; do not edit.',
    '- insert:',
    `    - id: ${DSH_WHALE_INSERT_ID}`,
    `      name: ${JSON.stringify(DSH_WHALE_PACKAGE)}`,
    '',
  ].join('\n');
}

/**
 * Shared validation and staging inputs for sync and async `dsh-whale` setup.
 * @param {{ sourceDir?: string, profileDir?: string, harnessRoot?: string, enabled?: boolean }} [options]
 * @returns {{ done: true, result: any } | {
 *   done: false,
 *   sourceDir: string,
 *   profileDir: string,
 *   patchFile: string,
 *   patchChanged: boolean,
 *   manifest: Record<string, any>,
 *   destDir: string,
 *   overlayFile: string,
 *   existed: boolean,
 *   resolvedHarness: string,
 *   harnessReady: boolean,
 *   peersHarnessRoot: string|null,
 * }}
 */
function prepareWhaleInstall(options = {}) {
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
    return { done: true, result: { ok: true, added: false, disabled: true, sourceDir, patchFile, patchChanged } };
  }

  const pkgFile = path.join(sourceDir, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    return { done: true, result: { ok: false, added: false, sourceDir: null, error: 'missing-source:package.json' } };
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
      done: true,
      result: {
        ok: false,
        added: false,
        sourceDir,
        error: `missing-source:${[...missingEntries, ...missingDeps].join(',')}`,
      },
    };
  }

  const destDir = path.join(profileDir, 'desktop-plugins', DSH_WHALE_PACKAGE);
  const overlayFile = path.join(destDir, DSH_WHALE_OVERLAY_FILENAME);
  const existed = fs.existsSync(overlayFile);

  const explicitHarness = options.harnessRoot;
  const resolvedHarness = explicitHarness || defaultHarnessRoot();
  const harnessReady = Boolean(
    explicitHarness
    || (resolvedHarness
      && (fs.existsSync(path.join(resolvedHarness, 'apps', 'cli', 'package.json'))
        || fs.existsSync(path.join(resolvedHarness, 'package.json')))),
  );

  removeLegacyDesktopArtifacts(destDir);
  return {
    done: false,
    sourceDir,
    profileDir,
    patchFile,
    patchChanged,
    manifest,
    destDir,
    overlayFile,
    existed,
    resolvedHarness,
    harnessReady,
    peersHarnessRoot: harnessReady ? canonicalHarnessRoot(resolvedHarness) : null,
  };
}

/**
 * @param {any} prep
 * @param {string} runtimeDir
 */
function buildWhaleResult(prep, runtimeDir) {
  return {
    ok: true,
    added: !prep.existed,
    sourceDir: prep.sourceDir,
    runtimeDir,
    href: pathToFileURL(runtimeDir).href,
    patchFile: prep.patchFile,
    overlayFile: prep.overlayFile,
    patchChanged: prep.patchChanged,
    peersHarnessRoot: prep.peersHarnessRoot,
  };
}

/**
 * Wire first-party `dsh-whale` from vendor (or packaged resources): stage a
 * profile-owned runtime copy with linked Harness peers + sibling `dsh-shared`,
 * a profile `node_modules/dsh-whale` junction pointing to that runtime, and a
 * desktop-owned `--patch` overlay (`desktop-plugins/dsh-whale/
 * desktop-dsh-whale.patch.yml`) carrying the package-name insert.
 *
 * @param {{ sourceDir?: string, profileDir?: string, harnessRoot?: string, enabled?: boolean }} [options]
 * @returns {{
 *   ok: boolean,
 *   added?: boolean,
 *   disabled?: boolean,
 *   sourceDir?: string|null,
 *   runtimeDir?: string,
 *   href?: string,
 *   patchFile?: string,
 *   overlayFile?: string,
 *   patchChanged?: boolean,
 *   peersHarnessRoot?: string|null,
 *   error?: string,
 * }}
 */
function ensureDesktopDshWhale(options = {}) {
  const prep = prepareWhaleInstall(options);
  if (prep.done) return prep.result;
  const { runtimeDir } = stageDesktopPluginRuntime({
    packageName: DSH_WHALE_PACKAGE,
    sourceDir: prep.sourceDir,
    profileDir: prep.profileDir,
    harnessRoot: prep.resolvedHarness,
    manifest: prep.manifest,
    entries: DSH_WHALE_ENTRIES,
    linkedEntries: DSH_WHALE_LINKED_ENTRIES,
    label: 'Whale',
    linkPeers: prep.harnessReady,
  });

  fs.mkdirSync(prep.destDir, { recursive: true });
  atomicWriteFileIfChangedSync(prep.overlayFile, whaleOverlayContents(), { encoding: 'utf8' });
  return buildWhaleResult(prep, runtimeDir);
}

/**
 * Async variant of {@link ensureDesktopDshWhale} that stages the runtime files
 * off the Electron main thread during startup.
 * @param {{ sourceDir?: string, profileDir?: string, harnessRoot?: string, enabled?: boolean }} [options]
 */
async function ensureDesktopDshWhaleAsync(options = {}) {
  const prep = prepareWhaleInstall(options);
  if (prep.done) return prep.result;
  const { runtimeDir } = await stageDesktopPluginRuntimeAsync({
    packageName: DSH_WHALE_PACKAGE,
    sourceDir: prep.sourceDir,
    profileDir: prep.profileDir,
    harnessRoot: prep.resolvedHarness,
    manifest: prep.manifest,
    entries: DSH_WHALE_ENTRIES,
    linkedEntries: DSH_WHALE_LINKED_ENTRIES,
    label: 'Whale',
    linkPeers: prep.harnessReady,
  });

  await fs.promises.mkdir(prep.destDir, { recursive: true });
  await atomicWriteFileIfChanged(prep.overlayFile, whaleOverlayContents(), { encoding: 'utf8' });
  return buildWhaleResult(prep, runtimeDir);
}

/** @param {unknown} list */
function withoutDshWhaleAliases(list) {
  const blocked = new Set(DSH_WHALE_ALIASES);
  return (Array.isArray(list) ? list : []).filter((name) => !blocked.has(String(name || '').trim()));
}

/**
 * Verify packaged `resources/vendor/dsh-whale` ships its client bundle, assets
 * (when present in source), and resolves every peer inside `harnessDest`.
 * @param {{ resources: string, projectDir: string, harnessDest: string }} opts
 */
function assertPackagedDshWhale({ resources, projectDir, harnessDest }) {
  const packagedWhale = path.join(resources, 'vendor', DSH_WHALE_PACKAGE);
  if (!fs.existsSync(path.join(packagedWhale, 'client', 'client.js'))) {
    throw new Error('packaged dsh-whale is missing client/client.js');
  }
  if (fs.existsSync(path.join(projectDir, 'vendor', DSH_WHALE_PACKAGE, 'assets'))
    && !fs.existsSync(path.join(packagedWhale, 'assets'))) {
    throw new Error('packaged dsh-whale is missing assets/');
  }
  resolveHarnessPeerDirectories(
    harnessDest,
    JSON.parse(fs.readFileSync(path.join(packagedWhale, 'package.json'), 'utf8')),
    { label: 'Whale' },
  );
}

module.exports = {
  DSH_WHALE_PACKAGE,
  DSH_WHALE_INSERT_ID,
  DSH_WHALE_BEGIN,
  DSH_WHALE_END,
  DSH_WHALE_ALIASES,
  DSH_WHALE_OVERLAY_FILENAME,
  whalePeerDirectories,
  withoutDshWhaleAliases,
  ensureDesktopDshWhale,
  ensureDesktopDshWhaleAsync,
  assertPackagedDshWhale,
};
