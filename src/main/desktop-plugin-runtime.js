'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { ensureDirectoryLink, linkInfo } = require('./desktop-plugin-link');
const { missingDeclaredEntries } = require('./plugin-runtime-files');

const EXTRA_ANCHOR_BUNDLES = Object.freeze(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
const COPY_SKIP_AGE_MS = 2000;
const ASYNC_COPY_CONCURRENCY = 16;

/**
 * Run async tasks with bounded concurrency so cold plugin staging stays off
 * the Electron main thread without opening unbounded file descriptors.
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} worker
 */
async function mapConcurrent(items, limit, worker) {
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  };
  const count = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: count }, run));
}

/**
 * @param {fs.Stats} source
 * @param {fs.Stats} destination
 */
function runtimeFileUnchanged(source, destination) {
  return source.size === destination.size
    && Math.abs(source.mtimeMs - destination.mtimeMs) < 1
    && (Date.now() - source.mtimeMs) > COPY_SKIP_AGE_MS;
}

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
    const nameSet = new Set(names);
    // Drop entries the current source no longer ships so stale modules cannot be imported after an upgrade.
    for (const name of fs.readdirSync(target)) {
      if (!nameSet.has(name)) fs.rmSync(path.join(target, name), { recursive: true, force: true });
    }
    for (const name of names) copyRuntime(path.join(source, name), path.join(target, name), label);
  } else {
    if (destination && !destination.isFile()) {
      throw new Error(`${label} runtime file contains a directory: ${target}`);
    }
    if (destination && runtimeFileUnchanged(info, destination)) {
      return;
    }
    fs.copyFileSync(source, target);
    try {
      fs.utimesSync(target, info.atimeMs / 1000, info.mtimeMs / 1000);
    } catch {
      // Preserving mtime only accelerates subsequent startups.
    }
  }
}

/**
 * Async equivalent of `copyRuntime`: validates symlinks/directories identically
 * while running file stat/copy/utimes off the Electron main thread.
 * @param {string} source
 * @param {string} target
 * @param {string} [label]
 */
async function copyRuntimeAsync(source, target, label = 'Plugin') {
  const info = await fs.promises.lstat(source);
  if (info.isSymbolicLink()) throw new Error(`${label} runtime source is a link: ${source}`);
  let destination;
  try {
    destination = await fs.promises.lstat(target);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  if (destination?.isSymbolicLink()) throw new Error(`${label} runtime target was replaced: ${target}`);
  if (info.isDirectory()) {
    if (destination && !destination.isDirectory()) {
      throw new Error(`${label} runtime directory contains a file: ${target}`);
    }
    if (!destination) await fs.promises.mkdir(target);
    const [names, existingNames] = await Promise.all([
      fs.promises.readdir(source),
      destination ? fs.promises.readdir(target) : Promise.resolve([]),
    ]);
    const nameSet = new Set(names);
    const stale = existingNames.filter((name) => !nameSet.has(name));
    if (stale.length) {
      await mapConcurrent(stale, ASYNC_COPY_CONCURRENCY, (name) => (
        fs.promises.rm(path.join(target, name), { recursive: true, force: true })
      ));
    }
    await mapConcurrent(names, ASYNC_COPY_CONCURRENCY, (name) => (
      copyRuntimeAsync(path.join(source, name), path.join(target, name), label)
    ));
  } else {
    if (destination && !destination.isFile()) {
      throw new Error(`${label} runtime file contains a directory: ${target}`);
    }
    if (destination && runtimeFileUnchanged(info, destination)) {
      return;
    }
    await fs.promises.copyFile(source, target);
    try {
      await fs.promises.utimes(target, info.atimeMs / 1000, info.mtimeMs / 1000);
    } catch {
      // Preserving mtime only accelerates subsequent startups.
    }
  }
}

/**
 * Create a cached package-directory lookup over Node module search paths so
 * repeated package probes reuse `resolve.paths` and `readdirSync` membership.
 * @param {{ within?: string }} [options]
 */
function createPackageDirFinder(options = {}) {
  /** @type {Map<string, string[]>} */
  const anchorSearchPaths = new Map();
  /** @type {Map<string, Set<string> | null>} */
  const dirEntries = new Map();

  /** @param {string} dir @param {string} entry */
  const hasEntry = (dir, entry) => {
    let entries = dirEntries.get(dir);
    if (entries === undefined) {
      try { entries = new Set(fs.readdirSync(dir)); }
      catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error).code;
        entries = code === 'ENOENT' || code === 'ENOTDIR' ? new Set() : null;
      }
      dirEntries.set(dir, entries);
    }
    return entries === null || entries.has(entry);
  };

  /** @param {string} anchor */
  const searchPathsFor = (anchor) => {
    let cached = anchorSearchPaths.get(anchor);
    if (!cached) {
      try {
        cached = fs.existsSync(anchor)
          ? (createRequire(anchor).resolve.paths('package') || []).filter((modules) => (
            (!options.within || withinRoot(options.within, modules)) && fs.existsSync(modules)
          ))
          : [];
      } catch {
        cached = [];
      }
      anchorSearchPaths.set(anchor, cached);
    }
    return cached;
  };

  /** @param {string} anchor @param {string} name */
  return (anchor, name) => {
    const scoped = name[0] === '@';
    const slash = scoped ? name.indexOf('/') : -1;
    const scope = scoped && slash > 0 ? name.slice(0, slash) : '';
    const leaf = scoped && slash > 0 ? name.slice(slash + 1) : name;
    for (const modules of searchPathsFor(anchor)) {
      if (scoped && slash > 0) {
        if (!hasEntry(modules, scope) || !hasEntry(path.join(modules, scope), leaf)) continue;
      } else if (!hasEntry(modules, leaf)) {
        continue;
      }
      const dir = path.join(modules, name);
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    }
    return '';
  };
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
  const canonicalRoot = fs.realpathSync.native(path.resolve(harnessRoot));
  const cli = path.join(canonicalRoot, 'apps', 'cli', 'package.json');
  const rootPkg = path.join(canonicalRoot, 'package.json');
  /** @type {string[]} */
  const anchors = [];
  if (fs.existsSync(cli)) anchors.push(cli);
  if (fs.existsSync(rootPkg)) anchors.push(rootPkg);
  // Bound peer lookup strictly inside Harness so workspace node_modules
  // in development can never shadow packaged Harness dependencies.
  const findFromAnchor = createPackageDirFinder({ within: canonicalRoot });

  /** @param {string} name */
  const find = (name) => {
    for (const anchor of anchors) {
      const dir = findFromAnchor(anchor, name);
      if (dir) return fs.realpathSync.native(dir);
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
 * @param {string} sourceDir
 * @param {string} runtimeDir
 * @param {string[]} linkedEntries
 * @param {string} label
 */
function linkRuntimeEntries(sourceDir, runtimeDir, linkedEntries, label) {
  for (const name of linkedEntries) {
    const src = path.join(sourceDir, name);
    const dst = path.join(runtimeDir, name);
    if (fs.existsSync(src)) {
      const sourceReal = fs.realpathSync.native(src);
      if (!fs.statSync(sourceReal).isDirectory()) {
        throw new Error(`${label} runtime source is not a directory: ${src}`);
      }
      const segments = name.split(/[\\/]+/).filter(Boolean);
      let cursor = runtimeDir;
      for (const parent of segments.slice(0, -1)) {
        cursor = ownedDirectory(cursor, parent, label);
      }
      const existing = linkInfo(dst);
      if (existing && !existing.isSymbolicLink()) {
        fs.rmSync(dst, { recursive: true, force: true });
      }
      ensureDirectoryLink(sourceReal, dst);
    } else {
      const existing = linkInfo(dst);
      if (existing?.isSymbolicLink()) fs.unlinkSync(dst);
      else if (existing) fs.rmSync(dst, { recursive: true, force: true });
    }
  }
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
 *   linkedEntries?: string[],
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
  linkedEntries = [],
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
  linkRuntimeEntries(sourceDir, runtimeDir, linkedEntries, label);

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
 * Async variant of {@link stageDesktopPluginRuntime} used on the Electron
 * startup path so cold/warm runtime staging does not block the main thread.
 * @param {{
 *   packageName: string,
 *   sourceDir: string,
 *   profileDir: string,
 *   harnessRoot?: string,
 *   manifest: Record<string, any>,
 *   entries: string[],
 *   linkedEntries?: string[],
 *   label?: string,
 *   linkPeers?: boolean,
 * }} opts
 */
async function stageDesktopPluginRuntimeAsync({
  packageName,
  sourceDir,
  profileDir,
  harnessRoot,
  manifest,
  entries,
  linkedEntries = [],
  label = 'Plugin',
  linkPeers = true,
}) {
  const peerNames = Object.keys(manifest?.peerDependencies || {});
  const peers = linkPeers && peerNames.length
    ? resolveHarnessPeerDirectories(harnessRoot || require('./paths').harnessRoot(), manifest, { label })
    : new Map();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fs.promises.mkdir(profileDir, { recursive: true });
  const realProfileDir = fs.realpathSync.native(profileDir);
  const pluginsDir = ownedDirectory(realProfileDir, 'desktop-plugins', label);
  const owned = ownedDirectory(pluginsDir, packageName, label);
  const runtimeDir = ownedDirectory(owned, 'runtime', label);

  for (const name of entries) {
    const src = path.join(sourceDir, name);
    const dst = path.join(runtimeDir, name);
    if (fs.existsSync(src)) {
      const segments = name.split(/[\\/]+/).filter(Boolean);
      let cursor = runtimeDir;
      for (const parent of segments.slice(0, -1)) {
        cursor = ownedDirectory(cursor, parent, label);
      }
      await copyRuntimeAsync(src, dst, label);
    } else if (fs.existsSync(dst)) {
      await fs.promises.rm(dst, { recursive: true, force: true });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  linkRuntimeEntries(sourceDir, runtimeDir, linkedEntries, label);

  const modules = ownedDirectory(runtimeDir, 'node_modules', label);
  const sharedSrc = path.join(path.dirname(path.resolve(sourceDir)), 'dsh-shared');
  if (fs.existsSync(path.join(sharedSrc, 'lib'))) {
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
  createPackageDirFinder,
  resolveHarnessPeerDirectories,
  stageDesktopPluginRuntime,
  stageDesktopPluginRuntimeAsync,
  applyPreparedPluginOverlays,
};
