// Deterministic assembly of the packaged DSHD daemon runtime. The previous
// flow wrote a synthetic package.json under vendor/chisacode-remote/.tmp and
// ran `npm install` with no lockfile, so transitive dependencies floated to
// whatever the registry served at build time. Instead the vendored workspace
// is already installed from its own package-lock.json (`npm ci` earlier in
// prepare-dshd-remote.mjs); this module resolves the production closure over
// that pinned tree. Workspace members are packed like npm's `--install-links`
// file: install; registry packages are copied preserving the node_modules
// nesting npm chose, which keeps version-conflict placements correct.
import fs from 'node:fs';
import path from 'node:path';

export function readManifest(packageDir) {
  return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
}

// Walk `fromDir` and its ancestors looking for node_modules/<name>, stopping
// after `boundary` itself. Mirrors the naive upward walk node's resolution
// performs; candidates that never exist in npm layouts are harmless misses.
export function resolveInstalledPackage(fromDir, name, boundary) {
  const segments = name.split('/');
  const stop = path.dirname(boundary);
  let dir = fromDir;
  while (dir !== stop) {
    const candidate = path.join(dir, 'node_modules', ...segments);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// `npm install --omit=dev --omit=optional` semantics: regular dependencies
// plus peer dependencies npm auto-installs (peerDependenciesMeta.optional
// entries such as ws's bufferutil are never fetched). optionalDependencies
// stay excluded; packages like better-sqlite3 are forced roots instead.
function runtimeDependencies(manifest) {
  const declared = { ...(manifest.dependencies ?? {}) };
  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    if (manifest.peerDependenciesMeta?.[peer]?.optional || peer in declared) continue;
    declared[peer] = manifest.peerDependencies[peer];
  }
  return declared;
}

/**
 * Plan the production dependency closure for the packaged daemon.
 * @param {string} workspaceRoot vendored workspace root containing packages/ and node_modules/
 * @param {string[]} seeds directory names under packages/ to pack (e.g. ['server'])
 * @param {string[]} forcedDependencies extra top-level deps to include despite --omit=optional
 * @returns {{ workspacePackages: {name: string, dir: string}[], copies: {target: string, source: string}[] }}
 *   copies' target is relative to the runtime node_modules using forward slashes.
 */
export function planRuntimeClosure({ workspaceRoot, seeds, forcedDependencies = [] }) {
  const packagesDir = path.join(workspaceRoot, 'packages');
  const packagesReal = fs.realpathSync(packagesDir);
  const nodeModules = path.join(workspaceRoot, 'node_modules');
  const workspacePackages = new Map();
  const copies = new Map();
  const visited = new Set();

  function isWorkspaceMember(realDir) {
    return path.dirname(realDir) === packagesReal;
  }

  function runtimeTarget(resolved) {
    const underModules = path.relative(nodeModules, resolved);
    if (underModules && !underModules.startsWith('..') && !path.isAbsolute(underModules)) {
      return underModules.split(path.sep).join('/');
    }
    const underPackages = path.relative(packagesDir, resolved);
    if (underPackages && !underPackages.startsWith('..') && !path.isAbsolute(underPackages)) {
      const segments = underPackages.split(path.sep);
      const owner = readManifest(path.join(packagesDir, segments[0]));
      return [owner.name, ...segments.slice(1)].join('/');
    }
    throw new Error(`[dshd-remote] cannot map installed package into runtime: ${resolved}`);
  }

  function addPackage(resolved) {
    const real = fs.realpathSync(resolved);
    if (isWorkspaceMember(real)) {
      workspacePackages.set(readManifest(real).name, real);
      visit(real);
      return;
    }
    copies.set(runtimeTarget(resolved), resolved);
    visit(resolved);
  }

  function visit(packageDir) {
    if (visited.has(packageDir)) return;
    visited.add(packageDir);
    const manifest = readManifest(packageDir);
    for (const name of Object.keys(runtimeDependencies(manifest)).sort()) {
      const resolved = resolveInstalledPackage(packageDir, name, workspaceRoot);
      if (!resolved) {
        throw new Error(`[dshd-remote] ${path.relative(workspaceRoot, packageDir)} declares ${name} but it is not installed under ${nodeModules}`);
      }
      addPackage(resolved);
    }
  }

  for (const seed of seeds) {
    const dir = fs.realpathSync(path.join(packagesDir, seed));
    workspacePackages.set(readManifest(dir).name, dir);
    visit(dir);
  }
  for (const name of forcedDependencies) {
    const resolved = resolveInstalledPackage(workspaceRoot, name, workspaceRoot);
    if (!resolved) {
      throw new Error(`[dshd-remote] forced runtime dependency ${name} is not installed under ${nodeModules}`);
    }
    addPackage(resolved);
  }
  return {
    workspacePackages: [...workspacePackages].map(([name, dir]) => ({ name, dir })),
    copies: [...copies].map(([target, source]) => ({ target, source })).sort((a, b) => a.target.localeCompare(b.target)),
  };
}

export function materializeRuntimeCopies(copies, runtimeNodeModules) {
  for (const { source, target } of copies) {
    const dest = path.join(runtimeNodeModules, ...target.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(source, dest, { recursive: true, dereference: true });
  }
}
