'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { missingDeclaredEntries } = require('./plugin-runtime-files');

const EXTRA_ANCHOR_BUNDLES = Object.freeze(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);

/**
 * @param {string} root
 * @param {string} candidate
 */
function withinRoot(root, candidate) {
  const rel = path.relative(root, path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * @param {string} parent
 * @param {string} name
 * @param {string} [label]
 */
function ownedDirectory(parent, name, label = 'Plugin') {
  const target = path.join(parent, name);
  let info;
  try {
    info = fs.lstatSync(target);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  if (info && (info.isSymbolicLink() || !info.isDirectory())) {
    throw new Error(`${label} runtime directory was replaced: ${target}`);
  }
  if (!info) fs.mkdirSync(target);
  return target;
}

/**
 * @param {string} source
 * @param {string} target
 * @param {string} [label]
 */
function copyRuntime(source, target, label = 'Plugin') {
  const info = fs.lstatSync(source);
  if (info.isSymbolicLink()) throw new Error(`${label} runtime source is a link: ${source}`);
  let destination;
  try {
    destination = fs.lstatSync(target);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  if (destination?.isSymbolicLink()) throw new Error(`${label} runtime target was replaced: ${target}`);
  if (info.isDirectory()) {
    if (destination && !destination.isDirectory()) {
      throw new Error(`${label} runtime directory contains a file: ${target}`);
    }
    if (!destination) fs.mkdirSync(target);
    const names = fs.readdirSync(source);
    // Drop entries the current source no longer ships so stale modules cannot be imported after an upgrade.
    for (const name of fs.readdirSync(target)) {
      if (!names.includes(name)) fs.rmSync(path.join(target, name), { recursive: true, force: true });
    }
    for (const name of names) copyRuntime(path.join(source, name), path.join(target, name), label);
  } else {
    if (destination && !destination.isFile()) {
      throw new Error(`${label} runtime file contains a directory: ${target}`);
    }
    fs.copyFileSync(source, target);
  }
}

/**
 * Resolve every declared peerDependency strictly inside `harnessRoot` using the
 * same CLI and bundle package positions that compose Harness at runtime.
 * @param {string} harnessRoot
 * @param {{ peerDependencies?: Record<string, string> }} manifest
 * @param {{ label?: string }} [options]
 * @returns {Map<string, string>}
 */
function resolveHarnessPeerDirectories(harnessRoot, manifest, { label = 'Plugin' } = {}) {
  if (!harnessRoot || !fs.existsSync(harnessRoot)) {
    throw new Error(`${label} peers unavailable: missing Harness root.`);
  }
  const canonicalRoot = fs.realpathSync(path.resolve(harnessRoot));
  const cli = path.join(canonicalRoot, 'apps', 'cli', 'package.json');
  const rootPkg = path.join(canonicalRoot, 'package.json');
  /** @type {string[]} */
  const anchors = [];
  if (fs.existsSync(cli)) anchors.push(cli);
  if (fs.existsSync(rootPkg)) anchors.push(rootPkg);

  /** @param {string} name */
  const find = (name) => {
    for (const anchor of anchors) {
      if (!fs.existsSync(anchor)) continue;
      for (const modules of createRequire(anchor).resolve.paths(name) || []) {
        // Bound peer lookup strictly inside Harness so workspace node_modules
        // in development can never shadow packaged Harness dependencies.
        if (!withinRoot(canonicalRoot, modules)) continue;
        const dir = path.join(modules, name);
        if (fs.existsSync(path.join(dir, 'package.json'))) return fs.realpathSync(dir);
      }
    }
    return null;
  };

  for (const bundle of EXTRA_ANCHOR_BUNDLES) {
    const dir = find(bundle);
    if (dir) anchors.push(path.join(dir, 'package.json'));
  }

  const directories = new Map();
  const remaining = new Set(Object.keys(manifest?.peerDependencies || {}));
  while (remaining.size) {
    let found = false;
    for (const name of [...remaining]) {
      const dir = find(name);
      if (!dir) continue;
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const missing = missingDeclaredEntries(dir, pkg).filter((entry) => !entry.endsWith('.ts'));
      if (missing.length) {
        throw new Error(`${label} peer ${name} has missing runtime entries: ${missing.join(',')}`);
      }
      directories.set(name, dir);
      anchors.push(path.join(dir, 'package.json'));
      remaining.delete(name);
      found = true;
    }
    if (!found) throw new Error(`${label} peers unavailable: ${[...remaining].join(',')}`);
  }
  return directories;
}

/**
 * Copy a first-party vendor plugin into a profile-owned writable runtime
 * directory, wire Harness peers into its `node_modules`, link sibling
 * `dsh-shared`, and expose `<profileDir>/node_modules/<packageName>`.
 * @param {{
 *   packageName: string,
 *   sourceDir: string,
 *   profileDir: string,
 *   harnessRoot?: string,
 *   manifest: Record<string, any>,
 *   entries: string[],
 *   label?: string,
 *   linkPeers?: boolean,
 * }} opts
 */
function stageDesktopPluginRuntime({
  packageName,
  sourceDir,
  profileDir,
  harnessRoot,
  manifest,
  entries,
  label = 'Plugin',
  linkPeers = true,
}) {
  const peerNames = Object.keys(manifest?.peerDependencies || {});
  const peers = linkPeers && peerNames.length
    ? resolveHarnessPeerDirectories(harnessRoot || require('./paths').harnessRoot(), manifest, { label })
    : new Map();
  fs.mkdirSync(profileDir, { recursive: true });
  const pluginsDir = ownedDirectory(fs.realpathSync.native(profileDir), 'desktop-plugins', label);
  const owned = ownedDirectory(pluginsDir, packageName, label);
  const runtimeDir = ownedDirectory(owned, 'runtime', label);

  // Installed resources may be read-only. Copy shipped entries into the
  // profile runtime and remove any obsolete entries when upgrading.
  for (const name of entries) {
    const src = path.join(sourceDir, name);
    const dst = path.join(runtimeDir, name);
    if (fs.existsSync(src)) {
      const segments = name.split(/[\\/]+/).filter(Boolean);
      let cursor = runtimeDir;
      for (const parent of segments.slice(0, -1)) {
        cursor = ownedDirectory(cursor, parent, label);
      }
      copyRuntime(src, dst, label);
    } else if (fs.existsSync(dst)) {
      fs.rmSync(dst, { recursive: true, force: true });
    }
  }

  const modules = ownedDirectory(runtimeDir, 'node_modules', label);
  const sharedSrc = path.join(path.dirname(path.resolve(sourceDir)), 'dsh-shared');
  if (fs.existsSync(path.join(sharedSrc, 'lib'))) {
    // Plugins import sibling ../../dsh-shared/lib/*.mjs relative to runtime/lib/*.
    ensureDirectoryLink(sharedSrc, path.join(owned, 'dsh-shared'));
    ensureDirectoryLink(sharedSrc, path.join(modules, 'dsh-shared'));
  }

  for (const [name, dir] of peers) {
    const parts = name.split('/');
    const parent = parts.length === 2 ? ownedDirectory(modules, parts[0], label) : modules;
    ensureDirectoryLink(dir, path.join(parent, parts.at(-1)));
  }

  ensureDirectoryLink(runtimeDir, path.join(profileDir, 'node_modules', packageName));
  return { owned, runtimeDir, peers };
}

/**
 * Run optional start-time desktop plugin preparers (`prepareProjectPlugin`,
 * `prepareWhalePlugin`) against `harnessRoot` and append any returned
 * `overlayFile` entries to `options.patchFiles` without duplicates.
 * @param {Record<string, any>} options
 * @param {{ harnessRoot: string | undefined, isCurrent: () => boolean, cancelledError: () => Error }} context
 * @returns {Promise<Record<string, any>>}
 */
async function applyPreparedPluginOverlays(options, { harnessRoot, isCurrent, cancelledError }) {
  let next = options;
  for (const key of ['prepareProjectPlugin', 'prepareWhalePlugin']) {
    const prepare = next?.[key];
    if (typeof prepare !== 'function') continue;
    const result = await prepare({ harnessRoot });
    if (!isCurrent()) throw cancelledError();
    const overlayFile = result?.overlayFile;
    if (overlayFile && !(next.patchFiles || []).includes(overlayFile)) {
      next = { ...next, patchFiles: [...(next.patchFiles || []), overlayFile] };
    }
  }
  return next;
}

module.exports = {
  resolveHarnessPeerDirectories,
  stageDesktopPluginRuntime,
  applyPreparedPluginOverlays,
};
