'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DESKTOP_PACKAGES } = require('../src/shared/harness-desktop-forks');
const { RUNTIME_LINKS } = require('../src/shared/runtime-links');

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

const PACKAGE_EXCLUDED_TOP_DIRS = new Map([
  ['@mixmark-io/domino', new Set(['test', '.yarn'])],
  ['zod', new Set(['src'])],
  ['@deepseek-ai/dsh-web-frontend', new Set(['public'])],
  ['@xmanrui/dsh-im', new Set(['assets', 'src', 'plugin-src', 'scripts', 'test', 'tests', '__tests__', '.tmp'])],
  ['dsh-usage-panel', new Set(['src', 'tests', 'tests-dist', '__tests__', 'docs', 'assets', 'scripts', '.tmp'])],
  ['dsh-remote', new Set(['plugin-src', 'tests'])],
  ['ssh2', new Set(['test'])],
]);

/** Official desktop omissions: build metadata and explicitly identified non-target native files. */
function runtimeFileExclusion(packageName, relative, platform = process.platform, arch = process.arch) {
  const parts = relative.split(/[\\/]/);
  const file = parts.at(-1);
  if (parts.some(part => ['.bin', '.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json'].includes(part))) return true;
  if (/\.(?:[cm]?[jt]s|css)\.map$/.test(file) || /\.d\.[cm]?ts$/.test(file) || /\.tsbuildinfo$/.test(file)) return true;
  if (PACKAGE_EXCLUDED_TOP_DIRS.get(packageName)?.has(parts[0])) return true;
  if (packageName === 'node-pty' && parts[0] === 'prebuilds') {
    return parts.length > 1 && (parts[1] !== `${platform}-${arch}` || file.endsWith('.pdb'));
  }
  // ConPTY's active DLL/exe live next to conpty.node in prebuilds, not in this build-input copy.
  if (packageName === 'node-pty' && parts[0] === 'third_party' && /\.(?:exe|dll)$/i.test(file)) return true;
  if (packageName === '@mixmark-io/domino' && file === 'yarn.lock') return true;
  if (packageName === '@xmanrui/dsh-im' && parts.length === 1 && (/\.test\.mjs$/.test(file) || file === '.tmp-lock-validation.log')) return true;
  if (packageName === 'dsh-remote' && /\.test\.[cm]?[jt]sx?$/.test(file)) return true;
  const reflink = /^@reflink\/reflink-(.+)$/.exec(packageName || '');
  if (reflink && ['win32', 'darwin'].includes(platform)) {
    const current = `${platform}-${arch}${platform === 'win32' ? '-msvc' : ''}`;
    if (reflink[1] !== current) return true;
  }
  if (packageName === '@deepseek-ai/libreoffice-kit-wasm' && platform === 'win32' && arch === 'x64') return true;
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

/**
 * @param {string} harnessDest
 * @param {string} kitDir
 * @param {string} nm
 * @param {boolean} forbidWasm
 * @param {(from: string, name: string, root: string) => string | null} resolvePackageFrom
 */
function assertNoWasmAndValidLinks(harnessDest, kitDir, nm, forbidWasm, resolvePackageFrom) {
  const linksFile = path.join(harnessDest, RUNTIME_LINKS);
  if (fs.existsSync(linksFile)) {
    const manifest = JSON.parse(fs.readFileSync(linksFile, 'utf8'));
    for (const entry of (Array.isArray(manifest?.links) ? manifest.links : [])) {
      if (forbidWasm && typeof entry.path === 'string' && entry.path.endsWith('/@deepseek-ai/libreoffice-kit-wasm')) {
        throw new Error(`RUNTIME_LINKS 包含已排除的 libreoffice-kit-wasm 链接：${entry.path}`);
      }
      if (typeof entry.target === 'string' && !fs.existsSync(path.join(harnessDest, entry.target))) {
        throw new Error(`RUNTIME_LINKS 存在悬空目标：${entry.target}`);
      }
    }
  }
  if (!forbidWasm) return;
  const resolvedWasm = resolvePackageFrom(kitDir, '@deepseek-ai/libreoffice-kit-wasm', harnessDest);
  if (resolvedWasm) throw new Error(`安装包仍可解析到已排除的 libreoffice-kit-wasm：${resolvedWasm}`);
  const directWasm = path.join(nm, 'libreoffice-kit-wasm');
  if (fs.existsSync(directWasm)) throw new Error(`安装包残留已排除的 libreoffice-kit-wasm：${directWasm}`);
  const instancesDir = path.join(harnessDest, 'node_modules', '.dsh-instances');
  if (!fs.existsSync(instancesDir)) return;
  for (const dirEntry of fs.readdirSync(instancesDir, { withFileTypes: true })) {
    if (!dirEntry.isDirectory()) continue;
    const manifestPath = path.join(instancesDir, dirEntry.name, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    if (JSON.parse(fs.readFileSync(manifestPath, 'utf8'))?.name === '@deepseek-ai/libreoffice-kit-wasm') {
      throw new Error(`安装包 .dsh-instances 残留已排除的 libreoffice-kit-wasm：${manifestPath}`);
    }
  }
}

/**
 * @param {string} engineDir
 * @param {string} kitVersion
 * @param {string} targetSlug
 */
function assertEngineManifestAndFiles(engineDir, kitVersion, targetSlug) {
  const engineManifest = JSON.parse(fs.readFileSync(path.join(engineDir, 'package.json'), 'utf8'));
  const prebuilds = JSON.parse(fs.readFileSync(path.join(engineDir, 'prebuilds.json'), 'utf8'));
  if (engineManifest.version !== kitVersion || prebuilds.version !== kitVersion || prebuilds.status !== 'built'
    || prebuilds.platform !== targetSlug || prebuilds.engine?.kind !== 'native'
    || typeof prebuilds.engine.executable !== 'string' || typeof prebuilds.engine.programDirectory !== 'string') {
    throw new Error(`Office 引擎与 kit 不一致：kit@${kitVersion} engine@${engineManifest.version} prebuilds=${prebuilds.platform}/${prebuilds.status}`);
  }
  for (const relative of [prebuilds.engine.executable, prebuilds.engine.programDirectory]) {
    const file = path.join(engineDir, relative);
    if (!fs.existsSync(file)) throw new Error(`Office 引擎资源缺失：${file}`);
  }
}

/**
 * @param {string} harnessDest
 * @param {string} nm
 * @param {string} kitDir
 * @param {string} engineDir
 * @param {string} enginePkgName
 * @param {{ countResolvers: (root: string, pkgName: string, targetDir: string) => number; longPath: (p: string) => string }} helpers
 */
function pruneStaleOfficeSiblings(harnessDest, nm, kitDir, engineDir, enginePkgName, helpers) {
  if (fs.existsSync(path.join(harnessDest, RUNTIME_LINKS))) return;
  for (const sibling of ['libreoffice-kit', enginePkgName]) {
    const stale = path.join(nm, sibling);
    if (path.resolve(stale) === path.resolve(kitDir) || path.resolve(stale) === path.resolve(engineDir)) continue;
    const manifestFile = path.join(stale, 'package.json');
    if (!fs.existsSync(manifestFile)) continue;
    const staleVersion = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).version;
    if (helpers.countResolvers(harnessDest, `@deepseek-ai/${sibling}`, stale) > 0) continue;
    console.log(`Office 孤儿副本清理: @deepseek-ai/${sibling}@${staleVersion}（零解析者，实际解析到 ${path.resolve(stale) === path.resolve(engineDir) ? engineDir : kitDir}）`);
    fs.rmSync(helpers.longPath(stale), { recursive: true, force: true });
  }
}

/**
 * @param {string} harnessDest
 * @param {{ platform?: string; arch?: string }} target
 * @param {{ forbidWasm?: boolean }} options
 * @param {{ resolvePackageFrom: (from: string, name: string, root: string) => string | null; countResolvers: (root: string, pkgName: string, targetDir: string) => number; longPath: (p: string) => string }} helpers
 */
function verifyLibreOfficeKitClosure(harnessDest, target, options, helpers) {
  const platform = target.platform || process.platform;
  const arch = target.arch || process.arch;
  const targetSlug = `${platform}-${arch}`;
  const forbidWasm = options.forbidWasm ?? (platform === 'win32' && arch === 'x64');
  const nm = path.join(harnessDest, 'node_modules', '@deepseek-ai');
  const providerDir = path.join(nm, 'dsh-office-kit');
  const kitDir = helpers.resolvePackageFrom(providerDir, '@deepseek-ai/libreoffice-kit', harnessDest);
  const enginePkgName = `libreoffice-kit-${targetSlug}`;
  const engineDir = kitDir ? helpers.resolvePackageFrom(kitDir, `@deepseek-ai/${enginePkgName}`, harnessDest) : null;
  if (!kitDir || !engineDir) {
    throw new Error(`安装包的 LibreOffice Kit 闭包不完整：dsh-office-kit 无法解析 kit/engine（kit=${kitDir || 'unresolved'} engine=${engineDir || 'unresolved'}）`);
  }
  const missingClosure = [
    path.join(providerDir, 'package.json'), path.join(nm, 'dsh-tool-office', 'package.json'),
    path.join(nm, 'dsh-skill-office', 'package.json'), path.join(nm, 'dsh-tool-workspace-dependencies', 'package.json'),
    path.join(kitDir, 'lib', 'cli.js'), path.join(engineDir, 'prebuilds.json'),
  ].filter(file => !fs.existsSync(file));
  if (missingClosure.length > 0) throw new Error(`安装包的 LibreOffice Kit 闭包不完整：${missingClosure.join(', ')}`);
  const kitVersion = JSON.parse(fs.readFileSync(path.join(kitDir, 'package.json'), 'utf8')).version;
  pruneStaleOfficeSiblings(harnessDest, nm, kitDir, engineDir, enginePkgName, helpers);
  assertEngineManifestAndFiles(engineDir, kitVersion, targetSlug);
  assertNoWasmAndValidLinks(harnessDest, kitDir, nm, forbidWasm, helpers.resolvePackageFrom);
  return { kitVersion, engineDir };
}

module.exports = { productionClosure, selectHarnessRuntimeSources, prunePluginDevDependencies, runtimeFileExclusion,
  pruneRuntimeFiles, isLicenseDocumentation, pruneOfficeRuntime, officePayloadDigest, verifyLibreOfficeKitClosure };
