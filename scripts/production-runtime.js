'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
  for (const pkg of closure.values()) pruneRuntimeFiles(pkg.source, target, false);
  return removed;
}

/** Apply package-specific omissions only to a staged copy, including nested packages when requested. */
function pruneRuntimeFiles(root, target = {}, includeDependencies = true) {
  let removed = 0;
  function walk(dir, packageRoot, packageName) {
    const manifestFile = path.join(dir, 'package.json');
    if (fs.existsSync(manifestFile)) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (manifest.name) {
        packageRoot = dir; packageName = manifest.name;
        if (runtimeFileExclusion(packageName, '', target.platform, target.arch)) {
          fs.rmSync(dir, { recursive: true, force: true });
          removed += 1;
          return;
        }
      }
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!includeDependencies && entry.name === 'node_modules') continue;
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Runtime pruning requires a staged physical tree: ${file}`);
      if (runtimeFileExclusion(packageName, path.relative(packageRoot, file), target.platform, target.arch)) {
        fs.rmSync(file, { recursive: true, force: true });
        removed += 1;
      } else if (entry.isDirectory()) walk(file, packageRoot, packageName);
    }
  }
  walk(root, root, '');
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
  // ConPTY's active DLL/exe live next to conpty.node in prebuilds, not in this build-input copy.
  if (packageName === 'node-pty' && parts[0] === 'third_party' && /\.(?:exe|dll)$/i.test(file)) return true;
  if (packageName === '@mixmark-io/domino' && (['test', '.yarn'].includes(parts[0]) || file === 'yarn.lock')) return true;
  if (packageName === 'zod' && parts[0] === 'src') return true;
  if (packageName === '@deepseek-ai/dsh-web-frontend' && parts[0] === 'public') return true;
  if (packageName === '@xmanrui/dsh-im') {
    if (['assets', 'src', 'plugin-src', 'scripts', 'test', 'tests', '__tests__', '.tmp'].includes(parts[0])) return true;
    if (parts.length === 1 && (/\.test\.mjs$/.test(file) || file === '.tmp-lock-validation.log')) return true;
  }
  if (packageName === 'dsh-usage-panel' && ['src', 'tests', '__tests__', 'docs', 'assets', 'scripts', '.tmp'].includes(parts[0])) return true;
  const reflink = /^@reflink\/reflink-(.+)$/.exec(packageName || '');
  if (reflink && ['win32', 'darwin'].includes(platform)) {
    const current = `${platform}-${arch}${platform === 'win32' ? '-msvc' : ''}`;
    if (reflink[1] !== current) return true;
  }
  if (packageName === '@koromix/koffi-win32-x64' && relative.replaceAll('\\', '/') === 'win32_x64/koffi.lib') return true;
  return false;
}

/** A README can be the package's only copy of its license (data-uri-to-buffer is one). */
function isLicenseDocumentation(file) {
  const base = path.basename(file);
  if (/^(license|licence|notice|third[_-]party[_-]notices)(\.|$)/i.test(base)) return true;
  return /^readme(?:\.|$)/i.test(base) && /Copyright\s*(?:\(c\)|©)?\s*\d{4}|Permission is hereby granted|Redistribution and use in source and binary forms|Licensed under the Apache License/i.test(fs.readFileSync(file, 'utf8'));
}

/** Tests and bytecode are not needed by the locked Office APIs; public testing modules remain. */
function pruneOfficeRuntime(payload, target = {}) {
  const manifestFile = path.join(payload, 'runtime.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const python = path.join(payload, 'dependencies', 'python');
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Office pruning requires a staged physical tree: ${file}`);
      if (entry.isDirectory()) {
        if (['test', 'tests', 'benchmarks'].includes(entry.name)) fs.rmSync(file, { recursive: true, force: true });
        else {
          walk(file);
          if (entry.name === '__pycache__' && fs.readdirSync(file).length === 0) fs.rmdirSync(file);
        }
      } else if (entry.name.endsWith('.pyc')) {
        const source = entry.name.replace(/(?:\.cpython-\d+(?:\.opt-\d+)?)?\.pyc$/, '.py');
        const sourceDir = path.basename(dir) === '__pycache__' ? path.dirname(dir) : dir;
        if (fs.existsSync(path.join(sourceDir, source))) fs.unlinkSync(file);
      }
    }
  }
  walk(python);
  pruneRuntimeFiles(path.join(payload, 'dependencies', 'pnpm'), target);
  manifest.payloadDigest = officePayloadDigest(payload, manifest);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest.payloadDigest;
}

/** Bind the installed identity to actual staged bytes, not the original untrimmed input digest. */
function officePayloadDigest(payload, manifest) {
  const { payloadDigest, ...identity } = manifest;
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(identity));
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Office identity requires a staged physical tree: ${file}`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && path.relative(payload, file) !== 'runtime.json') {
        hash.update(`${path.relative(payload, file).replaceAll('\\', '/')}\0${fs.statSync(file).size}\0`);
        const descriptor = fs.openSync(file, 'r');
        try {
          let length;
          while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
        } finally { fs.closeSync(descriptor); }
        hash.update('\0');
      }
    }
  }
  walk(payload);
  return hash.digest('hex');
}

module.exports = { productionClosure, selectHarnessRuntimeSources, prunePluginDevDependencies, runtimeFileExclusion,
  pruneRuntimeFiles, isLicenseDocumentation, pruneOfficeRuntime, officePayloadDigest };
