'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DESKTOP_PACKAGES } = require('../src/shared/harness-desktop-forks');

/** Follow installed production edges, including present optional and peer dependencies. */
function productionClosure(roots, resolvePackage, dependencyEntries) {
  const packages = new Map();
  function visit(dir) {
    dir = fs.realpathSync(dir);
    if (packages.has(dir)) return;
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    packages.set(dir, { name: manifest.name, source: dir, manifest });
    for (const [name, kind] of dependencyEntries(manifest)) {
      const dependency = resolvePackage(dir, name);
      if (dependency) visit(dependency);
      else if (kind === 'required') throw new Error(`Missing runtime dependency: ${manifest.name} -> ${name}`);
    }
  }
  for (const root of roots) visit(root);
  return packages;
}

/** Match the official CLI production closure, plus our explicitly mounted desktop packages. */
function selectHarnessRuntimeSources(harnessRoot, resolvePackage, dependencyEntries) {
  harnessRoot = fs.realpathSync(harnessRoot);
  const roots = [path.join(harnessRoot, 'apps', 'cli'),
    ...DESKTOP_PACKAGES.map(pkg => path.join(harnessRoot, pkg.dir))];
  const closure = productionClosure(roots, (from, name) => resolvePackage(from, name, harnessRoot), dependencyEntries);
  return [...closure.values()].filter(pkg => {
    const relative = path.relative(harnessRoot, pkg.source).split(path.sep);
    return ['apps', 'packages', 'vendor', 'native'].includes(relative[0]) && !relative.includes('node_modules');
  });
}

/** Prune only package slots in the staged tree; package subpaths (e.g. zod/v4) are assets. */
function prunePluginDevDependencies(root, resolvePackage, dependencyEntries, target = {}) {
  root = fs.realpathSync(root);
  const closure = productionClosure([root], (from, name) => resolvePackage(from, name, root), dependencyEntries);
  let removed = 0;
  function prune(nodeModules) {
    if (!fs.existsSync(nodeModules)) return;
    const relative = path.relative(root, fs.realpathSync(nodeModules));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Plugin dependency tree escapes staging: ${nodeModules}`);
    for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const location = path.join(nodeModules, entry.name);
      if (entry.name.startsWith('@')) {
        for (const child of fs.readdirSync(location)) prunePackage(path.join(location, child));
      } else if (!entry.name.startsWith('.')) prunePackage(location);
    }
  }
  function prunePackage(dir) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) return;
    const real = fs.realpathSync(dir);
    const relative = path.relative(root, real);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Plugin package escapes staging: ${dir}`);
    if (!closure.has(real)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } else prune(path.join(dir, 'node_modules'));
  }
  prune(path.join(root, 'node_modules'));
  // Prune diagnostic/build files from retained packages without assuming arbitrary assets are unused.
  for (const pkg of closure.values()) pruneFiles(pkg.source, pkg.source, pkg.name);
  function pruneFiles(packageRoot, dir, name) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const file = path.join(dir, entry.name);
      if (runtimeFileExclusion(name, path.relative(packageRoot, file), target.platform, target.arch)) {
        fs.rmSync(file, { recursive: true, force: true });
      } else if (entry.isDirectory()) pruneFiles(packageRoot, file, name);
    }
  }
  return removed;
}

/** Official desktop omissions: build metadata and explicitly identified non-target native files. */
function runtimeFileExclusion(packageName, relative, platform = process.platform, arch = process.arch) {
  const parts = relative.split(/[\\/]/);
  const file = parts.at(-1);
  if (parts.some(part => ['.bin', '.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json'].includes(part))) return true;
  if (/\.(?:[cm]?[jt]s|css)\.map$/.test(file) || /\.d\.[cm]?ts$/.test(file) || /\.tsbuildinfo$/.test(file)) return true;
  if (packageName === 'node-pty' && parts[0] === 'prebuilds') {
    return parts.length > 1 && (parts[1] !== `${platform}-${arch}` || file.endsWith('.pdb'));
  }
  if (packageName === '@mixmark-io/domino' && parts[0] === 'test') return true;
  if (packageName === '@koromix/koffi-win32-x64' && relative.replaceAll('\\', '/') === 'win32_x64/koffi.lib') return true;
  return false;
}

module.exports = { productionClosure, selectHarnessRuntimeSources, prunePluginDevDependencies, runtimeFileExclusion };
