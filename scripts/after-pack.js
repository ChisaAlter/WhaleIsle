const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const { pathToFileURL } = require('url');
const {
  missingDeclaredEntries,
  auditRuntimeClosure,
} = require('../src/main/plugin-runtime-files');
const { DESKTOP_PACKAGES } = require('../src/shared/harness-desktop-forks');
const { runSkipComposeContract } = require('./check-skip-compose-contract');
const { assembleRuntimeInstances } = require('./runtime-instance-graph');
const { selectHarnessRuntimeSources, prunePluginDevDependencies, runtimeFileExclusion,
  pruneRuntimeFiles, isLicenseDocumentation, pruneOfficeRuntime, officePayloadDigest } = require('./production-runtime');
const { RUNTIME_LINKS, removeRuntimeLinks } = require('../src/shared/runtime-links');
const { writeRuntimeArchiveIdentity } = require('../src/shared/harness-runtime-identity');
const {
  ensureGhosttyAssetsInHarness,
  harnessHasGhosttyAssets,
  missingGhosttyAssetPaths,
} = require('../src/shared/ghostty-assets');

const SKIP_DIRS = new Set([
  '.git',
  '.github',
  '.agents',
  '.artifacts',
  '.cache',
  '.sessions',
  '.storages',
  '.turbo',
  '.vite',
  '.vite-temp',
  '.worktrees',
  '__pycache__',
  'coverage',
  'docs',
  'examples',
  'python',
  'website',
  'worktrees',
]);

// 纯构建期工具，运行时不需要；按 pnpm 目录名（<name>@<version> 或 @scope+<name>@<version>）匹配
const DEV_ONLY_NAMES = new Set([
  'typescript',
  'tsx',
  'ts-node',
  'vite',
  'vitest',
  '@vitest',
  'eslint',
  '@eslint',
  '@typescript-eslint',
  'turbo',
  'rollup',
  'webpack',
  'jest',
  '@jest',
  'playwright',
  '@playwright',
  'storybook',
  '@storybook',
  'prettier',
  'knip',
  'oxlint',
  'typedoc',
  'eslint-plugin',
  'babel',
  '@babel',
  'swc',
  '@swc',
  'nx',
  'husky',
  'lint-staged',
]);
// These workspace packages are test helpers. All known consumers declare
// them only in devDependencies; do not ship their Vitest closures.
const DEV_ONLY_WORKSPACE_NAMES = new Set([
  '@deepseek-ai/dsh-client-test-runtime',
  '@deepseek-ai/dsh-session-snapshot',
]);

/**
 * Fail-closed completeness check used before reusing a packaged plugin tree.
 * Walks the complete production dependency closure at each package's real
 * resolution position, so depth is no longer a guess. The previous
 * depth-bounded walk could only prove a tree *broken*; this reports an
 * explicit incomplete marker when the node budget runs out, which keeps the
 * caller on the fail-closed side instead of reusing an unaudited tree.
 * @param {string} packageDir packaged plugin directory.
 * @param {{ maxPackages?: number }} [options]
 * @returns {string[]} missing runtime paths, empty when the tree is reusable.
 */
function missingPluginRuntimeClosure(packageDir, options = {}) {
  const manifestPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    return ['package.json'];
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return ['package.json'];
  }
  const audit = auditRuntimeClosure(packageDir, options);
  // `complete: false` means the walk gave up, not that the tree is healthy.
  // Surface it as a missing marker so every caller treats it as fail-closed.
  return audit.complete ? audit.missing : [...audit.missing, CLOSURE_INCOMPLETE_MARKER];
}

/** Marker returned when the closure audit could not finish within budget. */
const CLOSURE_INCOMPLETE_MARKER = '<closure-incomplete>';
/**
 * npm config keys a `npm run <script>` parent exports from the developer's
 * user-level `.npmrc`, which a project-scoped install cannot honour:
 * `allow-scripts` is rejected outright (npm 11 `EALLOWSCRIPTS`: it belongs in
 * the project's package.json or its own `.npmrc`, and these are vendored
 * third-party directories we must not write machine-specific config into),
 * while the other two are pnpm/Electron settings npm only warns about. Every
 * install below passes `--ignore-scripts`, so no install-script policy can
 * apply to it and dropping these cannot change what gets built.
 */
const INHERITED_NPM_CONFIG_TO_DROP = [
  'npm_config_allow_scripts',
  'npm_config_electron_skip_binary_download',
  'npm_config_trust_policy',
];

/**
 * The environment for a spawned npm: the caller's, minus the inherited keys
 * above. Deletion is case-insensitive because Windows environment blocks are.
 */
function spawnEnvWithoutInheritedNpmConfig(base) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (INHERITED_NPM_CONFIG_TO_DROP.includes(key.toLowerCase())) delete env[key];
  }
  return env;
}

function defaultNpmInstall(packageDir) {
  const nm = path.join(packageDir, 'node_modules');
  if (fs.existsSync(nm)) {
    fs.rmSync(nm, { recursive: true, force: true });
  }
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const lockFile = path.join(packageDir, 'package-lock.json');
  const args = fs.existsSync(lockFile)
    ? ['ci', '--omit=dev', '--omit=peer', '--ignore-scripts', '--no-fund', '--no-audit']
    : ['install', '--omit=dev', '--omit=peer', '--ignore-scripts', '--no-fund', '--no-audit'];
  const result = spawnSync(npmCmd, args, {
    cwd: packageDir,
    stdio: 'inherit',
    env: spawnEnvWithoutInheritedNpmConfig(process.env),
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${npmCmd} ${args.join(' ')} failed in ${packageDir} (status ${result.status})`);
  }
}

/**
 * extraResources from a plugin directory drops that directory's node_modules.
 * Copy vendor/<name>/node_modules into the packaged tree when a declared
 * dependency or its export file is still missing.
 */
function restoreVendoredPluginNodeModules(projectDir, resources, packageName) {
  const srcNm = path.join(projectDir, 'vendor', packageName, 'node_modules');
  const destPkg = path.join(resources, 'vendor', packageName);
  if (!fs.existsSync(path.join(destPkg, 'package.json'))) {
    return { restored: false, reason: 'missing-dest-package' };
  }
  if (!fs.existsSync(srcNm)) {
    return { restored: false, reason: 'missing-source-node-modules' };
  }
  const missing = missingPluginRuntimeClosure(destPkg);
  if (missing.length === 0) {
    return { restored: false, reason: 'already-present' };
  }
  fs.cpSync(srcNm, path.join(destPkg, 'node_modules'), { recursive: true, force: true, dereference: true });
  // The same closure check decides whether the copy actually repaired the
  // tree; a partial vendored node_modules must not read as a restore.
  const unresolved = missingPluginRuntimeClosure(destPkg);
  return { restored: true, missing, unresolved };
}

/**
 * Git-tracked plugin node_modules can omit export files (repo dist/ ignore).
 * Wipe and npm-install from package.json when the packaged tree is incomplete.
 * @param {string} packageDir
 * @param {{
 *   run?: (dir: string) => void,
 *   skipIfComplete?: boolean,
 *   verify?: (dir: string) => string[],
 * }} [options]
 *   `verify` supplies the completeness evidence; callers that must not reuse a
 *   half-repaired tree pass {@link missingPluginRuntimeClosure}.
 *   The same verifier runs again after the install: an installer that exits 0
 *   without repairing the tree must not be reported as success.
 * @returns {{ installed: boolean, reason: string, missing?: string[], unresolved?: string[] }}
 * @throws when a repair was attempted and the tree is still incomplete.
 */
function installPluginRuntimeDeps(packageDir, options = {}) {
  if (!fs.existsSync(path.join(packageDir, 'package.json'))) {
    return { installed: false, reason: 'missing-package' };
  }
  const verify = options.verify || missingPluginRuntimeClosure;
  const missing = verify(packageDir);
  if (options.skipIfComplete && missing.length === 0) {
    return { installed: false, reason: 'already-present' };
  }
  if (!options.skipIfComplete && options.verify && missing.length === 0) {
    // Explicitly verified as complete: reuse instead of deleting a healthy
    // node_modules and reinstalling it. A failed verification still falls
    // through to the controlled install path below.
    return { installed: false, reason: 'verified-complete' };
  }
  const run = options.run || defaultNpmInstall;
  run(packageDir);
  const unresolved = verify(packageDir);
  if (unresolved.length > 0) {
    throw new Error(
      `packaged ${path.basename(packageDir)} is still incomplete after install: ${unresolved.join(', ')}`,
    );
  }
  return { installed: true, reason: 'installed', missing };
}

function assertVendoredPluginRuntimeDeps(resources, packageName) {
  const destPkg = path.join(resources, 'vendor', packageName);
  // The final gate uses the same full closure evidence the reuse decision
  // uses; a shallow check here would bless what the install step just rejected.
  const missing = missingPluginRuntimeClosure(destPkg);
  if (missing.length) {
    throw new Error(`packaged ${packageName} is missing node_modules: ${missing.join(', ')}`);
  }
}

async function assertDshdRemoteRuntime(resources) {
  const root = path.join(resources, 'vendor', 'dshd-remote');
  const serverExport = path.join(root, 'node_modules', '@chisacode', 'server', 'dist', 'server', 'server', 'exports.js');
  const required = [
    serverExport,
    path.join(root, 'node_modules', '@chisacode', 'protocol', 'dist', 'connection-offer.js'),
    path.join(root, 'node_modules', '@chisacode', 'relay', 'dist', 'e2ee.js'),
    path.join(root, 'node_modules', 'pino', 'package.json'),
    path.join(root, 'node_modules', 'ws', 'package.json'),
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      `安装包缺少 DSHD 远程运行时：${missing.map((file) => path.relative(root, file)).join(', ')}`,
    );
  }
  const forbidden = [
    path.join(root, 'packages'),
    path.join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64'),
    path.join(root, 'node_modules', 'sherpa-onnx-win-x64'),
    path.join(root, 'node_modules', 'node-pty', 'prebuilds', 'win32-arm64'),
    path.join(root, 'node_modules', 'node-pty', 'third_party'),
    path.join(root, 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'conpty.pdb'),
  ].filter((file) => fs.existsSync(file));
  if (forbidden.length > 0) {
    throw new Error(
      `安装包混入非 DSHD 远程运行时：${forbidden.map((file) => path.relative(root, file)).join(', ')}`,
    );
  }
  const api = await import(pathToFileURL(serverExport).href);
  for (const name of [
    'createChisaCodeDaemon',
    'createRootLogger',
    'generateLocalPairingOffer',
    'RelayDeviceCredentialStore',
  ]) {
    if (typeof api[name] !== 'function') {
      throw new Error(`安装包 DSHD 远程 server 缺少导出：${name}`);
    }
  }
}

function longPath(target) {
  const abs = path.resolve(target);
  if (process.platform !== 'win32' || abs.length < 240) {
    return abs;
  }
  if (abs.startsWith('\\\\?\\')) {
    return abs;
  }
  if (abs.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${abs.slice(2)}`;
  }
  return `\\\\?\\${abs}`;
}

function isDevOnlyPnpmEntry(name) {
  // pnpm 条目名: typescript@5.6.3 | @types+node@22.5.0 | @eslint+eslintrc@3.1.0
  const parts = name.split('+');
  const scope = parts.length > 1 ? parts[0] : null; // 带 @ 前缀
  const base = parts[parts.length - 1].split('@')[0];
  if (scope && scope.startsWith('@types')) {
    return true;
  }
  if (DEV_ONLY_NAMES.has(base) || (scope && DEV_ONLY_NAMES.has(scope))) {
    return true;
  }
  return false;
}

function shouldSkip(src, root, expandNested = false, skipStore = false) {
  const rel = path.relative(root, src);
  if (!rel || rel.startsWith('..')) {
    return false;
  }
  const parts = rel.split(path.sep);
  let nodeModulesSeen = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (SKIP_DIRS.has(part)) {
      return true;
    }
    if (skipStore && part === '.pnpm') {
      // deploy 目录：顶层链接已解引用覆盖全部运行时包，.pnpm store 是硬链接重复，
      // 跳过可避免 10 倍展开（体积与内存）
      return true;
    }
    if (part === 'node_modules') {
      nodeModulesSeen += 1;
      if (nodeModulesSeen >= 3 && !expandNested) {
        // .pnpm 条目内的二级以上嵌套 node_modules：对完整 workspace 是冗余链接；
        // 对 deploy 目录（expandNested）是版本隔离依赖，必须保留
        return true;
      }
      if (i + 1 < parts.length && isDevOnlyPnpmEntry(parts[i + 1])) {
        return true; // node_modules 下的 dev-only 包
      }
    }
    if (
      nodeModulesSeen === 0
      && (part === 'src' || part === 'tests' || part === '__tests__')
      && /^(packages|apps)(\\|\/)/.test(parts.slice(0, i).join(path.sep))
    ) {
      // 只跳过 packages/ apps/ 下的源码与测试目录（node_modules 内的不动）
      return true;
    }
  }
  return false;
}

function realOf(target) {
  try {
    return fs.realpathSync(path.resolve(target));
  } catch {
    return path.resolve(target);
  }
}

/** Runtime skill files under shipped agent presets are Markdown (`SKILL.md`). */
function isShippedPresetMarkdown(src, root, base) {
  if (!/\.md$/i.test(base)) {
    return false;
  }
  const rel = path.relative(path.resolve(root), path.resolve(src)).split(path.sep);
  return rel.includes('agent-presets');
}

/**
 * 收集需要复制的文件：
 * - 递归 + 回溯维护祖先链（防符号链接环），复用同一个 Set，避免 O(n²) 内存
 * - 复制时由 fs.copyFile 解引用链接（复制目标内容）
 * - flat: 拍平模式——.pnpm store 条目提升到 node_modules/<pkg>（短路径，避免 NSIS
 *   长路径失败），全部内容保留（不丢包）
 */
function collectFiles(root, destRoot, expandNested = false, flat = false, omitRootDirs = null, target = {}) {
  const files = [];
  const manifestFile = path.join(root, 'package.json');
  const packageName = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).name : '';
  const ancestors = new Set();
  const visitedDirectories = new Set();
  const topNodeModules = path.join(path.resolve(destRoot), 'node_modules');

  function walk(src, dest) {
    if (runtimeFileExclusion(packageName, path.relative(root, src), target.platform, target.arch)) return;
    if (omitRootDirs && omitRootDirs.has(path.relative(root, src).split(path.sep)[0])) {
      return;
    }
    if (shouldSkip(src, root, expandNested)) {
      return;
    }
    if (flat && src.endsWith(`${path.sep}node_modules`) && dest !== topNodeModules) {
      // 任意 node_modules 目录（根 / .pnpm 条目 / 包内嵌套）都提升到顶层，
      // 避免超长路径触发 NSIS 260 字符限制
      dest = topNodeModules;
    }
    let lstat;
    try {
      lstat = fs.lstatSync(src);
    } catch {
      return;
    }

    if (lstat.isSymbolicLink() || lstat.isDirectory()) {
      const real = realOf(src);
      if (ancestors.has(real)) {
        return; // 环
      }
      const visitKey = `${real}\0${path.resolve(dest)}`;
      if (visitedDirectories.has(visitKey)) {
        return;
      }
      visitedDirectories.add(visitKey);
      let realStat;
      try {
        realStat = fs.statSync(real);
      } catch {
        return;
      }
      if (realStat.isFile()) {
        files.push({ src: real, dest });
        return;
      }
      ancestors.add(real);
      let names;
      try {
        names = fs.readdirSync(src);
      } catch {
        ancestors.delete(real);
        return;
      }
      for (const name of names) {
        walk(path.join(src, name), path.join(dest, name));
      }
      ancestors.delete(real);
      return;
    }

    if (lstat.isFile()) {
      const base = path.basename(src);
      if (/\.(map|tsbuildinfo|md|d\.ts)$/i.test(base) && !isShippedPresetMarkdown(src, root, base)
          && !isLicenseDocumentation(src)) {
        return;
      }
      if (/^(changelog|changes|authors|contributing)(\.|$)/i.test(base)) {
        return;
      }
      files.push({ src, dest });
    }
  }

  walk(path.resolve(root), path.resolve(destRoot));
  return files;
}

// Flattening can encounter both a workspace symlink and an older published
// package with the same name. Replace the entire package before calculating
// nested version isolation, so the manifest and all runtime files agree.
async function overlayWorkspaceRuntimePackages(harnessSrc, harnessDest) {
  const roots = [];
  const packagesDir = path.join(harnessSrc, 'packages');
  if (fs.existsSync(packagesDir)) {
    for (const group of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!group.isDirectory()) { continue; }
      const groupDir = path.join(packagesDir, group.name);
      roots.push(groupDir);
      for (const pkg of fs.readdirSync(groupDir, { withFileTypes: true })) {
        if (pkg.isDirectory()) { roots.push(path.join(groupDir, pkg.name)); }
      }
    }
  }
  const appsDir = path.join(harnessSrc, 'apps');
  if (fs.existsSync(appsDir)) {
    for (const app of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (app.isDirectory()) { roots.push(path.join(appsDir, app.name)); }
    }
  }
  const vendorDir = path.join(harnessSrc, 'vendor');
  if (fs.existsSync(vendorDir)) {
    for (const pkg of fs.readdirSync(vendorDir, { withFileTypes: true })) {
      if (pkg.isDirectory()) { roots.push(path.join(vendorDir, pkg.name)); }
    }
  }
  let files = 0;
  let packages = 0;
  const sources = [];
  for (const source of roots) {
    const manifestFile = path.join(source, 'package.json');
    if (!fs.existsSync(manifestFile)) { continue; }
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    for (const name of runtimeDependencyEntries(manifest).keys()) {
      if (DEV_ONLY_WORKSPACE_NAMES.has(name)) {
        throw new Error(`测试专用包被运行时依赖引用: ${manifest.name} → ${name}`);
      }
    }
  }
  for (const source of roots) {
    const manifestFile = path.join(source, 'package.json');
    const lib = path.join(source, 'lib');
    if (!fs.existsSync(manifestFile)) { continue; }
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (!manifest.name) { continue; }
    const target = path.join(harnessDest, 'node_modules', ...manifest.name.split('/'));
    const nodeModules = path.resolve(harnessDest, 'node_modules');
    const resolvedTarget = path.resolve(target);
    if (!resolvedTarget.startsWith(nodeModules + path.sep)) {
      throw new Error(`工作区包目标越界: ${resolvedTarget}`);
    }
    if (DEV_ONLY_WORKSPACE_NAMES.has(manifest.name)) {
      fs.rmSync(longPath(resolvedTarget), { recursive: true, force: true });
      const mirror = path.resolve(harnessDest, path.relative(harnessSrc, source));
      if (!mirror.startsWith(path.resolve(harnessDest) + path.sep)) {
        throw new Error(`测试专用包目标越界: ${mirror}`);
      }
      fs.rmSync(longPath(mirror), { recursive: true, force: true });
      continue;
    }
    if (!fs.existsSync(path.join(target, 'package.json'))) { continue; }
    if (!fs.existsSync(lib)) {
      throw new Error(`工作区运行时包缺少编译产物: ${source}`);
    }
    const packageFiles = collectFiles(source, target, false, false,
      new Set(['node_modules', 'src', 'tests', '__tests__']));
    fs.rmSync(longPath(resolvedTarget), { recursive: true, force: true });
    await copyFiles(packageFiles, 32);
    files += packageFiles.length;
    packages += 1;
    sources.push({ name: manifest.name, source, target, manifest });
  }
  return { packages, files, sources };
}

/** 拍平后多个真实目录会映射到同一 dest（collectFiles 只按 src 去重）。并发写同一文件会互相截断，留下「合法内容 + 尾部碎片」的损坏文件 —— 按 dest 取唯一胜出者。pnpm store 路径（.pnpm/**）输给顶层 hoisted 副本；同为顶层则先来者赢。 */
function pickCopyWinners(files) {
  const winners = new Map();
  const isStorePath = (file) => file.split(path.sep).includes('.pnpm');
  for (const item of files) {
    const key = path.resolve(item.dest);
    const prev = winners.get(key);
    if (!prev || (isStorePath(prev.src) && !isStorePath(item.src))) {
      winners.set(key, item);
    }
  }
  return [...winners.values()];
}

/** 并发复制（fs.copyFile 总是解引用链接，复制目标内容；EBUSY 重试以对抗杀软扫描） */
async function copyFiles(files, limit = 32) {
  const items = pickCopyWinners(files);
  const dropped = files.length - items.length;
  if (dropped > 0) {
    console.log(`（按目标路径去重：丢弃 ${dropped} 个重复来源）`);
  }
  let idx = 0;
  let retried = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const item = items[idx];
      idx += 1;
      fs.mkdirSync(longPath(path.dirname(item.dest)), { recursive: true });
      for (let attempt = 0; ; attempt += 1) {
        try {
          await fs.promises.copyFile(longPath(item.src), longPath(item.dest));
          break;
        } catch (error) {
          if (error.code === 'EBUSY' && attempt < 3) {
            retried += 1;
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            continue;
          }
          throw error;
        }
      }
    }
  });
  await Promise.all(workers);
  if (retried) {
    console.log(`（EBUSY 重试 ${retried} 次）`);
  }
  return items.length;
}

function deployCliEntries(deployDir) {
  return fs.readdirSync(deployDir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'vendor');
}

function packageJsonVersion(pkgDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '';
  } catch {
    return '';
  }
}

function destForPackageName(root, name) {
  return path.join(root, ...String(name).split('/'));
}

function listNodeModulesPackages(nodeModulesDir) {
  const packages = [];
  if (!fs.existsSync(nodeModulesDir)) {
    return packages;
  }
  let entries;
  try {
    entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return packages;
  }
  for (const entry of entries) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith('.')) {
      continue;
    }
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entry.name);
      let scoped;
      try {
        scoped = fs.readdirSync(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of scoped) {
        if (!child.isDirectory() && !child.isSymbolicLink()) {
          continue;
        }
        const pkgDir = path.join(scopeDir, child.name);
        if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
          packages.push({ name: `${entry.name}/${child.name}`, dir: pkgDir });
        }
      }
      continue;
    }
    const pkgDir = path.join(nodeModulesDir, entry.name);
    if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
      packages.push({ name: entry.name, dir: pkgDir });
    }
  }
  return packages;
}

function hostPackageFromPnpmEntry(entryName) {
  const parts = entryName.split('+');
  const scope = parts.length > 1 ? parts[0] : null;
  const bare = (parts.length > 1 ? parts[1] : parts[0]).split('@')[0].split('_')[0];
  return { scope, bare, name: scope ? `${scope}/${bare}` : bare };
}

/**
 * Flatten `.pnpm` store entries to top-level node_modules, then nest siblings
 * whose version differs from the already-copied top-level package under the
 * host package (so MCP SDK keeps ajv@8 when the tree also has ajv@6).
 * @param {string} storeDir - deploy `node_modules/.pnpm`
 * @param {string} nmDest - packaged `node_modules`
 * @returns {{ src: string, dest: string }[]}
 */
function collectPnpmFlattenFiles(storeDir, nmDest, workspaceNames = new Set()) {
  const flattened = [];
  const seen = new Set();
  const flattenPkg = (pkgDir, destDir) => {
    if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
      return;
    }
    if (DEV_ONLY_WORKSPACE_NAMES.has(JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).name)) {
      return;
    }
    if (seen.has(destDir) || fs.existsSync(path.join(destDir, 'package.json'))) {
      return;
    }
    seen.add(destDir);
    const files = collectFiles(pkgDir, destDir, false, false);
    for (const f of files) {
      flattened.push(f);
    }
  };
  if (!fs.existsSync(storeDir)) {
    return flattened;
  }
  for (const entry of fs.readdirSync(storeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryNm = path.join(storeDir, entry.name, 'node_modules');
    if (!fs.existsSync(entryNm)) {
      continue;
    }
    const host = hostPackageFromPnpmEntry(entry.name);
    flattenPkg(
      destForPackageName(entryNm, host.name),
      destForPackageName(nmDest, host.name),
    );
  }
  const sharedDir = path.join(storeDir, 'node_modules');
  if (fs.existsSync(sharedDir)) {
    for (const n of fs.readdirSync(sharedDir, { withFileTypes: true })) {
      if (!n.isDirectory() && !n.isSymbolicLink()) {
        continue;
      }
      const sharedPkg = path.join(sharedDir, n.name);
      if (n.name.startsWith('@')) {
        for (const s of fs.readdirSync(sharedPkg, { withFileTypes: true })) {
          if (s.isDirectory() || s.isSymbolicLink()) {
            flattenPkg(path.join(sharedPkg, s.name), path.join(nmDest, n.name, s.name));
          }
        }
      } else {
        flattenPkg(sharedPkg, path.join(nmDest, n.name));
      }
    }
  }
  const seenNested = new Set();
  for (const entry of fs.readdirSync(storeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') {
      continue;
    }
    const entryNm = path.join(storeDir, entry.name, 'node_modules');
    if (!fs.existsSync(entryNm)) {
      continue;
    }
    const host = hostPackageFromPnpmEntry(entry.name);
    // A store entry for an older published workspace package is not the
    // dependency graph of the package that replaced it in the release tree.
    if (workspaceNames.has(host.name) || DEV_ONLY_WORKSPACE_NAMES.has(host.name)) {
      continue;
    }
    const hostDest = destForPackageName(nmDest, host.name);
    for (const sibling of listNodeModulesPackages(entryNm)) {
      if (sibling.name === host.name) {
        continue;
      }
      const topVersion = packageJsonVersion(destForPackageName(nmDest, sibling.name));
      const siblingVersion = packageJsonVersion(sibling.dir);
      if (!topVersion || !siblingVersion || topVersion === siblingVersion) {
        continue;
      }
      const nestedDest = path.join(hostDest, 'node_modules', ...sibling.name.split('/'));
      if (seenNested.has(nestedDest) || fs.existsSync(path.join(nestedDest, 'package.json'))) {
        continue;
      }
      seenNested.add(nestedDest);
      const files = collectFiles(sibling.dir, nestedDest, false, false);
      for (const f of files) {
        flattened.push(f);
      }
    }
  }
  return flattened;
}

function isNestedIsolationDest(nmDest, dest) {
  const rel = path.relative(nmDest, dest).split(path.sep);
  const nmIdx = rel.indexOf('node_modules');
  return nmIdx > 0;
}

function compareDotVersions(a, b) {
  const pa = String(a || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = String(b || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const delta = (pa[i] || 0) - (pb[i] || 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function commanderSupportsNamedEsm(pkgDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const major = Number.parseInt(String(pkg.version || '').split('.')[0], 10);
    if (Number.isInteger(major) && major >= 12) {
      return true;
    }
    if (pkg.type === 'module') {
      return true;
    }
    const exported = pkg.exports && (pkg.exports['.'] || pkg.exports);
    return Boolean(exported && typeof exported === 'object' && exported.import);
  } catch {
    return false;
  }
}

function findPnpmStoreCommanders(storeDir) {
  const found = [];
  const seen = new Set();
  if (!fs.existsSync(storeDir)) {
    return found;
  }
  let entries;
  try {
    entries = fs.readdirSync(storeDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pkgDir = path.join(storeDir, entry.name, 'node_modules', 'commander');
    const key = path.resolve(pkgDir);
    if (seen.has(key) || !fs.existsSync(path.join(pkgDir, 'package.json'))) {
      continue;
    }
    seen.add(key);
    found.push({ pkgDir, version: packageJsonVersion(pkgDir) });
  }
  return found;
}

/**
 * apps/cli 声明的 commander 版本范围。全量复制时 harnessSrc 是 workspace
 * 根（范围在 apps/cli/package.json），deploy 目录本身即 CLI 包根（范围在
 * deployDir/package.json）。两处都没有声明时返回空串，不做版本门控。
 */
function cliCommanderDeclaredRange(harnessSrc) {
  for (const manifest of [
    path.join(harnessSrc, 'apps', 'cli', 'package.json'),
    path.join(harnessSrc, 'package.json'),
  ]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      const range = (pkg.dependencies && pkg.dependencies.commander)
        || (pkg.devDependencies && pkg.devDependencies.commander);
      if (typeof range === 'string' && range.trim()) {
        return range.trim();
      }
    } catch {
      // 下一个候选位置
    }
  }
  return '';
}

/**
 * apps/cli/lib/bin.js is ESM (`import { Command } from "commander"`).
 * Flatten first-wins can hoist a CJS commander (major < 12) to top-level
 * node_modules, which Node then refuses as a named export. Prefer the
 * highest ESM-capable commander still in the source .pnpm store.
 * 顶层可 ESM 还不够：拍平胜者可能是满足 ESM 但低于 CLI 声明范围的旧版
 * （alpha.2 的 helpCommand 需要 ^15）。apps/cli 在 node_modules 树外，
 * 版本隔离嵌套到不了它——按 Node 解析规则在 apps/cli/node_modules 下
 * 补声明版本，顶层保持原样不影响其他消费者。
 */
async function repairFlattenedCommanderEsm(harnessSrc, harnessDest) {
  const storeDir = path.join(harnessSrc, 'node_modules', '.pnpm');
  const destDir = path.join(harnessDest, 'node_modules', 'commander');
  let copied = 0;
  if (!commanderSupportsNamedEsm(destDir)) {
    const candidates = findPnpmStoreCommanders(storeDir)
      .filter((row) => commanderSupportsNamedEsm(row.pkgDir))
      .sort((a, b) => compareDotVersions(b.version, a.version));
    if (candidates.length === 0) {
      throw new Error(
        '安装包的 commander 不支持 CLI 的 ESM named import（拍平后顶层是 CJS，且 .pnpm store 没有 commander@12+）',
      );
    }
    fs.rmSync(longPath(destDir), { recursive: true, force: true });
    copied += await copyFiles(collectFiles(candidates[0].pkgDir, destDir, false, false), 32);
  }
  const declaredRange = cliCommanderDeclaredRange(harnessSrc);
  if (!declaredRange) {
    return copied;
  }
  const cliRoot = path.join(harnessDest, 'apps', 'cli');
  const resolved = resolvePackageFrom(cliRoot, 'commander', harnessDest);
  if (resolved && semver.satisfies(packageJsonVersion(resolved), declaredRange, { includePrerelease: true })) {
    return copied;
  }
  const candidates = findPnpmStoreCommanders(storeDir)
    .filter((row) => semver.satisfies(row.version, declaredRange, { includePrerelease: true }))
    .sort((a, b) => compareDotVersions(b.version, a.version));
  if (candidates.length === 0) {
    throw new Error(
      `安装包的 commander 不满足 apps/cli 声明 ${declaredRange}（解析到 ${resolved ? packageJsonVersion(resolved) : 'missing'}，.pnpm store 无匹配版本）`,
    );
  }
  const cliNest = path.join(cliRoot, 'node_modules', 'commander');
  fs.rmSync(longPath(cliNest), { recursive: true, force: true });
  copied += await copyFiles(collectFiles(candidates[0].pkgDir, cliNest, false, false), 32);
  return copied;
}

async function repairFlattenedVersionIsolation(harnessSrc, harnessDest, workspaceSources = []) {
  harnessSrc = realOf(harnessSrc);
  harnessDest = realOf(harnessDest);
  workspaceSources = workspaceSources.map(item => ({ ...item, source: realOf(item.source), target: realOf(item.target) }));
  const storeDir = path.join(harnessSrc, 'node_modules', '.pnpm');
  const nmDest = path.join(harnessDest, 'node_modules');
  if (!fs.existsSync(nmDest)) {
    return 0;
  }
  const workspaceNames = new Set(workspaceSources.map((item) => item.name));
  const workspaceByName = new Map(workspaceSources.map((item) => [item.name, item.source]));
  for (const item of workspaceSources) {
    const declared = new Set([
      ...Object.keys(item.manifest.dependencies || {}),
      ...Object.keys(item.manifest.optionalDependencies || {}),
      ...Object.keys(item.manifest.peerDependencies || {}),
    ]);
    for (const name of declared) {
      const sourceDep = resolvePackageFrom(item.source, name, harnessSrc);
      if (!sourceDep) {
        if (Object.hasOwn(item.manifest.dependencies || {}, name)) {
          throw new Error(`工作区必需依赖缺失: ${item.name} → ${name}`);
        }
        continue;
      }
    }
  }
  const flattened = collectPnpmFlattenFiles(storeDir, nmDest, workspaceNames);
  const nested = flattened.filter((item) => isNestedIsolationDest(nmDest, item.dest));
  if (nested.length) {
    console.log(`补全拍平缺失的版本隔离嵌套: ${nested.length} 个文件`);
  }
  let copied = await copyFiles(nested, 32);
  const graphCache = new Map();
  const fileCache = new Map();
  const graphActive = new Set();
  const packageKey = (source, target) => `${realOf(source)}\0${path.resolve(target)}`;
  const fileMatches = (source, target) => {
    const key = packageKey(source, target);
    if (!fileCache.has(key)) {
      fileCache.set(key, samePublishedPackageFiles(source, target, harnessSrc));
    }
    return fileCache.get(key);
  };
  const invalidateAfterCopy = (changed) => {
    const pathOf = (key) => key.slice(key.indexOf('\0') + 1);
    for (const key of fileCache.keys()) {
      const target = pathOf(key);
      if (target === changed || target.startsWith(changed + path.sep)) { fileCache.delete(key); }
    }
    graphCache.clear();
  };
  const graphMatches = (source, target) => {
    if (!target) { return false; }
    const key = packageKey(source, target);
    if (graphCache.has(key)) { return graphCache.get(key); }
    if (graphActive.has(key)) { return true; } // same cycle, checked on unwind
    if (!fileMatches(source, target)) { return false; }
    graphActive.add(key);
    let matches = true;
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    for (const [name, kind] of runtimeDependencyEntries(manifest)) {
      const sourceDep = resolvePackageFrom(source, name, harnessSrc);
      if (!sourceDep) {
        if (kind === 'required') { matches = false; break; }
        continue;
      }
      const targetDep = resolvePackageFrom(target, name, harnessDest);
      if (!targetDep || !graphMatches(realOf(sourceDep), targetDep)) {
        matches = false;
        break;
      }
    }
    graphActive.delete(key);
    graphCache.set(key, matches);
    return matches;
  };
  const visited = new Set();
  // A published package can have several consumers, but a second source
  // instance (including a peer variant with identical files) needs its own
  // module location. Remember which source claimed each flattened location.
  const targetSource = new Map(workspaceSources.map((item) => [path.resolve(item.target), realOf(item.source)]));
  // Demand table: dep name -> resolved source instance -> workspace consumer
  // dirs. When several workspace packages resolve the same instance and the
  // flattened root already serves a different version, per-owner nested copies
  // would split one source into multiple module instances — the shared copy
  // must instead land at the consumers' common-ancestor node_modules.
  const depDemand = new Map();
  for (const item of workspaceSources) {
    for (const name of runtimeDependencyEntries(item.manifest).keys()) {
      const sourceDep = resolvePackageFrom(item.source, name, harnessSrc);
      if (!sourceDep) { continue; }
      const desired = realOf(sourceDep);
      let bySource = depDemand.get(name);
      if (!bySource) { bySource = new Map(); depDemand.set(name, bySource); }
      let owners = bySource.get(desired);
      if (!owners) { owners = new Set(); bySource.set(desired, owners); }
      owners.add(path.resolve(item.target));
    }
  }
  const invalidateVisitedAfterCopy = (changed) => {
    for (const key of visited) {
      const target = key.slice(key.indexOf('\0') + 1);
      if (target === changed || target.startsWith(changed + path.sep)) { visited.delete(key); }
    }
    for (const target of targetSource.keys()) {
      if (target === changed || target.startsWith(changed + path.sep)) { targetSource.delete(target); }
    }
  };
  const ensureDependencies = async (source, target, depth = 0) => {
    if (depth > 32) { throw new Error(`工作区依赖隔离未收敛: ${source}`); }
    const key = `${realOf(source)}\0${path.resolve(target)}`;
    if (visited.has(key)) { return; }
    visited.add(key);
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    for (const [name, kind] of runtimeDependencyEntries(manifest)) {
      const sourceDep = resolvePackageFrom(source, name, harnessSrc);
      if (!sourceDep) {
        if (kind === 'required') { throw new Error(`工作区必需依赖缺失: ${manifest.name} → ${name}`); }
        continue;
      }
      const desired = realOf(sourceDep);
      const workspaceSource = workspaceByName.get(name);
      if (workspaceSource && realOf(workspaceSource) === desired) {
        // This exact workspace instance has its own root in workspaceSources.
        // Keep one shared module instance; its dependencies are repaired there.
        continue;
      }
      const candidate = resolvePackageFrom(target, name, harnessDest);
      const candidatePath = candidate && path.resolve(candidate);
      if (candidatePath && (!targetSource.has(candidatePath) || targetSource.get(candidatePath) === desired)
          && graphMatches(desired, candidate)) {
        targetSource.set(candidatePath, desired);
        continue;
      }
      const dependencyOwner = kind === 'peer' ? peerOwnerOf(target) : target;
      if (kind === 'peer' && dependencyOwner === harnessDest) {
        throw new Error(`顶层 peer 依赖冲突: ${manifest.name} → ${name}`);
      }
      let nestedDest = destForPackageName(path.join(dependencyOwner, 'node_modules'), name);
      const demand = depDemand.get(name) && depDemand.get(name).get(desired);
      if (demand && demand.size > 1) {
        const common = commonAncestorDir([...demand]);
        if (common) {
          const commonDir = path.resolve(common);
          const sharedBase = path.basename(commonDir) === 'node_modules' ? commonDir : path.join(commonDir, 'node_modules');
          const sharedDest = destForPackageName(sharedBase, name);
          const resolvedShared = path.resolve(sharedDest);
          const insideHarness = resolvedShared.startsWith(path.resolve(harnessDest) + path.sep);
          const ancestorOfOwner = path.resolve(dependencyOwner).startsWith(commonDir + path.sep);
          const occupied = targetSource.get(resolvedShared)
            || (fs.existsSync(path.join(resolvedShared, 'package.json')) ? 'occupied' : null);
          // A shared scope-level copy may shadow same-name demands wanting a
          // different source — those consumers self-heal on the next pass by
          // nesting their own version, which the convergence check verifies.
          if (insideHarness && ancestorOfOwner && !occupied) {
            nestedDest = sharedDest;
          }
        }
      }
      const resolvedNested = path.resolve(nestedDest);
      if (!resolvedNested.startsWith(path.resolve(harnessDest) + path.sep)) {
        throw new Error(`工作区依赖目标越界: ${resolvedNested}`);
      }
      const omit = runtimeOmitRootDirs(desired, harnessSrc);
      const packageFiles = collectFiles(desired, nestedDest, false, false, omit);
      fs.rmSync(longPath(resolvedNested), { recursive: true, force: true });
      copied += await copyFiles(packageFiles, 32);
      invalidateAfterCopy(resolvedNested);
      invalidateVisitedAfterCopy(resolvedNested);
      targetSource.set(resolvedNested, desired);
      await ensureDependencies(desired, nestedDest, depth + 1);
    }
  };
  // Consolidation cascades: collapsing one shared instance re-maps resolvers
  // and orphans another generation of nested copies, so a deep graph (the
  // AWS/OTel trees) needs more than a couple of passes to settle. The bound
  // stays finite — every pass either copies or deletes at least one package.
  const MAX_REPAIR_PASSES = 12;
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
    const before = copied;
    visited.clear();
    for (const item of workspaceSources) {
      await ensureDependencies(item.source, item.target);
    }
    graphCache.clear();
    const invalid = workspaceSources.find((item) => !graphMatches(item.source, item.target));
    if (!invalid) {
      const sourceTargets = new Map();
      const targetSources = new Map();
      const checked = new Set();
      const checkIdentity = (source, target) => {
        const sourceKey = realOf(source);
        const targetKey = path.resolve(target);
        const name = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).name;
        if (!sourceTargets.has(sourceKey)) { sourceTargets.set(sourceKey, new Set()); }
        sourceTargets.get(sourceKey).add(targetKey);
        const previousSource = targetSources.get(targetKey);
        if (previousSource && previousSource !== sourceKey) {
          // Identical bytes can still own independent module state.
          throw new Error(`工作区依赖实例被合并: ${name} at ${targetKey} (${previousSource} / ${sourceKey})`);
        }
        targetSources.set(targetKey, sourceKey);
        const key = `${sourceKey}\0${targetKey}`;
        if (checked.has(key)) { return; }
        checked.add(key);
        const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
        for (const name of runtimeDependencyEntries(manifest).keys()) {
          const sourceDep = resolvePackageFrom(source, name, harnessSrc);
          if (!sourceDep) { continue; }
          const targetDep = resolvePackageFrom(target, name, harnessDest);
          if (targetDep) { checkIdentity(sourceDep, targetDep); }
        }
      };
      for (const item of workspaceSources) { checkIdentity(item.source, item.target); }
      let identityTreeChanged = false;
      for (const [source, targets] of sourceTargets) {
        if (targets.size < 2) { continue; }
        const name = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).name;
        // Flatten first-wins can leave orphan copies (e.g. a root slot nobody
        // resolves once consumers nested their own). Prune them before
        // judging a real split.
        const alive = new Set(targets);
        const resolvers = new Set();
        for (const target of targets) {
          const found = findResolvers(harnessDest, name, target);
          if (found.length === 0) {
            console.log(`拍平孤儿副本清理: ${name} <- ${target}`);
            fs.rmSync(longPath(target), { recursive: true, force: true });
            invalidateAfterCopy(target);
            invalidateVisitedAfterCopy(target);
            identityTreeChanged = true;
            alive.delete(target);
            continue;
          }
          for (const dir of found) { resolvers.add(dir); }
        }
        if (alive.size < 2) { continue; }
        // One shared source instance duplicated under multiple consumers:
        // collapse to a single copy at the resolvers' common-ancestor
        // node_modules so all of them still resolve the same module (pnpm's
        // shared-instance semantics), then re-verify on the next pass.
        const common = commonAncestorDir([...resolvers]);
        const sharedBase = common && path.basename(common) === 'node_modules'
          ? common
          : common && path.join(common, 'node_modules');
        const sharedDest = sharedBase
          ? path.resolve(destForPackageName(sharedBase, name))
          : null;
        const harnessRoot = path.resolve(harnessDest);
        // An already-occupied ancestor slot serves the collapse only when it
        // holds this same source's bytes — a different package there would
        // shadow these resolvers with the wrong module.
        const occupiedByOther = sharedDest !== null
          && fs.existsSync(path.join(sharedDest, 'package.json'))
          && !samePublishedPackageFiles(source, sharedDest, harnessSrc);
        // A surviving copy of `name` between a resolver and the shared slot
        // shadows the collapse (the resolver would land on a different
        // source's bytes) — in that case the nested copy must stay.
        const shadowed = sharedDest !== null && [...resolvers].some((dir) => {
          const stop = path.dirname(sharedBase);
          let probe = path.resolve(dir);
          while (probe !== stop && probe !== path.dirname(probe)) {
            const candidate = path.resolve(destForPackageName(path.join(probe, 'node_modules'), name));
            if (candidate !== sharedDest
                && !alive.has(candidate)
                && fs.existsSync(path.join(candidate, 'package.json'))) {
              return true;
            }
            probe = path.dirname(probe);
          }
          return false;
        });
        // Moving the package also re-maps ITS dependency resolutions: nested
        // copies often exist precisely because ancestor slots serve a
        // different source, so the shared copy must still satisfy its own
        // dep graph at the new location before we collapse.
        const depsStillMatch = sharedDest !== null && graphMatches(source, sharedDest);
        const collapsible = sharedDest !== null
          && sharedDest.startsWith(harnessRoot + path.sep)
          && !occupiedByOther
          && !shadowed
          && depsStillMatch
          && [...resolvers].every((dir) => {
            const resolvedDir = path.resolve(dir);
            const commonDir = path.resolve(common);
            // A resolver may itself be the common ancestor (its own
            // node_modules hosts the shared copy) — equality is containment.
            return resolvedDir === commonDir || resolvedDir.startsWith(commonDir + path.sep);
          });
        if (!collapsible) {
          const detail = `common=${common} sharedDest=${sharedDest} occupiedByOther=${occupiedByOther} shadowed=${shadowed} depsMatch=${depsStillMatch} resolvers=${resolvers.size}`;
          throw new Error(`工作区依赖实例被拆分: ${name} (${[...alive].join(' / ')}) ${detail}`);
        }
        console.log(`拍平共享实例收拢: ${name} ×${alive.size} -> ${sharedDest}`);
        if (!fs.existsSync(path.join(sharedDest, 'package.json'))) {
          const omit = runtimeOmitRootDirs(source, harnessSrc);
          copied += await copyFiles(collectFiles(source, sharedDest, false, false, omit), 32);
        }
        alive.delete(sharedDest);
        for (const target of alive) {
          fs.rmSync(longPath(target), { recursive: true, force: true });
          invalidateAfterCopy(target);
          invalidateVisitedAfterCopy(target);
        }
        // Every former resolver must land exactly on the shared copy — an
        // interposed same-name copy between a resolver and the ancestor
        // would shadow it, in which case the split stands.
        for (const dir of resolvers) {
          const resolved = resolvePackageFrom(dir, name, harnessDest);
          if (!resolved || path.resolve(resolved) !== sharedDest) {
            throw new Error(`工作区依赖实例被拆分: ${name} (${[...alive].join(' / ')})`);
          }
        }
        targetSource.set(sharedDest, source);
        identityTreeChanged = true;
      }
      if (!identityTreeChanged) {
        return copied;
      }
    }
    if (!invalid && pass < MAX_REPAIR_PASSES - 1) {
      // Deletion-only repairs also change resolution. Re-verify before return,
      // even when this pass copied no files.
      continue;
    }
    if (copied === before || pass === MAX_REPAIR_PASSES - 1) {
      throw new Error(`工作区运行时依赖图不一致: ${invalid ? invalid.name : '合并/拆分后未收敛'}`);
    }
  }
  throw new Error('工作区运行时依赖隔离未收敛');
}

function assembleCanonicalRuntime(harnessSrc, harnessDest, sources, target = {}) {
  return assembleRuntimeInstances(harnessSrc, harnessDest, sources, {
    resolvePackageFrom, runtimeDependencyEntries,
    collectFiles: (...args) => collectFiles(...args, target), copyFiles,
    runtimeOmitRootDirs,
    samePublishedPackageFiles: (...args) => samePublishedPackageFiles(...args, target),
    devOnlyNames: DEV_ONLY_WORKSPACE_NAMES,
  });
}

function assertNoDevOnlyPackages(harnessDest) {
  const pending = [harnessDest];
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) { continue; }
      const child = path.join(dir, entry.name);
      if (entry.name === 'node_modules') {
        for (const name of DEV_ONLY_WORKSPACE_NAMES) {
          const pkg = destForPackageName(child, name);
          if (fs.existsSync(path.join(pkg, 'package.json'))) {
            throw new Error(`测试专用包仍在发布树中: ${pkg}`);
          }
        }
      }
      pending.push(child);
    }
  }
}

function runtimeDependencyEntries(manifest) {
  const entries = new Map();
  for (const name of Object.keys(manifest.dependencies || {})) { entries.set(name, 'required'); }
  for (const name of Object.keys(manifest.optionalDependencies || {})) { entries.set(name, 'optional'); }
  for (const name of Object.keys(manifest.peerDependencies || {})) {
    if (!entries.has(name)) { entries.set(name, 'peer'); }
  }
  return entries;
}

function peerOwnerOf(packageDir) {
  let current = path.dirname(packageDir);
  while (path.basename(current) !== 'node_modules' && path.dirname(current) !== current) {
    current = path.dirname(current);
  }
  return path.basename(current) === 'node_modules' ? path.dirname(current) : packageDir;
}

function runtimeOmitRootDirs(source, harnessSrc) {
  const rel = path.relative(harnessSrc, source).split(path.sep);
  if (rel[0] === 'packages' || rel[0] === 'apps' || rel[0] === 'vendor') {
    return new Set(['node_modules', 'src', 'tests', '__tests__']);
  }
  return new Set(['node_modules']);
}

function samePublishedPackageFiles(source, target, harnessSrc, buildTarget = {}) {
  if (!fs.existsSync(path.join(target, 'package.json'))) { return false; }
  const omit = runtimeOmitRootDirs(source, harnessSrc);
  const sourceFiles = collectFiles(source, source, false, false, omit, buildTarget);
  const targetFiles = collectFiles(target, target, false, false, omit, buildTarget);
  if (sourceFiles.length !== targetFiles.length) { return false; }
  const targetByRel = new Map(targetFiles.map((item) => [path.relative(target, item.src), item.src]));
  for (const item of sourceFiles) {
    const match = targetByRel.get(path.relative(source, item.src));
    if (!match) { return false; }
    if (fs.statSync(item.src).size !== fs.statSync(match).size
        || !fs.readFileSync(item.src).equals(fs.readFileSync(match))) { return false; }
  }
  return true;
}

/**
 * Count packages under harnessDest whose `package.json` declares `name` and
 * whose Node-style resolution lands exactly on `targetDir`. Used to decide
 * whether a flattened copy is a live resolution target or dead weight the
 * first-wins pass left behind.
 */
function findResolvers(harnessDest, name, targetDir) {
  const wanted = path.resolve(targetDir);
  const resolvers = [];
  const stack = [path.join(harnessDest, 'node_modules')];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (seen.has(dir)) { continue; }
    seen.add(dir);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) { continue; }
      const child = path.join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name.startsWith('@')) {
        stack.push(child);
        continue;
      }
      stack.push(path.join(child, 'node_modules'));
      const manifestPath = path.join(child, 'package.json');
      if (!fs.existsSync(manifestPath)) { continue; }
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { continue; }
      const deps = {
        ...(manifest.dependencies || {}),
        ...(manifest.optionalDependencies || {}),
        ...(manifest.peerDependencies || {}),
      };
      if (!Object.hasOwn(deps, name)) { continue; }
      const resolved = resolvePackageFrom(child, name, harnessDest);
      if (resolved && path.resolve(resolved) === wanted) { resolvers.push(child); }
    }
  }
  return resolvers;
}

function countResolvers(harnessDest, name, targetDir) {
  return findResolvers(harnessDest, name, targetDir).length;
}

function commonAncestorDir(dirs) {
  const parts = dirs.map((dir) => path.resolve(dir).split(path.sep));
  const first = parts[0];
  let depth = 0;
  while (depth < first.length && parts.every((segs) => segs.length > depth && segs[depth] === first[depth])) {
    depth += 1;
  }
  return depth > 0 ? first.slice(0, depth).join(path.sep) || path.sep : null;
}

function resolvePackageFrom(fromDir, packageName, stopDir) {
  // Mirror Node resolution (preserve-symlinks off): a symlinked importer
  // resolves deps through its realpath, so a `.pnpm/<pkg>@v/node_modules/`
  // sibling store must win over the literal-path ancestors. Walking the
  // unresolved path would mistake a consumer's hoisted sibling (e.g.
  // `apps/desktop/node_modules/semver`) for the dependency the real
  // consumer actually sees (`.pnpm/semver@<other>`).
  let current = realOf(fromDir);
  const stop = realOf(stopDir);
  const segments = String(packageName).split('/');
  while (true) {
    const candidate = path.join(current, 'node_modules', ...segments);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    if (current === stop) {
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function assertMcpSdkAjv(harnessDest) {
  const sdkDir = path.join(harnessDest, 'node_modules', '@modelcontextprotocol', 'sdk');
  if (!fs.existsSync(path.join(sdkDir, 'package.json'))) {
    throw new Error('安装包缺少 @modelcontextprotocol/sdk');
  }
  const ajvDir = resolvePackageFrom(sdkDir, 'ajv', harnessDest);
  const version = ajvDir ? packageJsonVersion(ajvDir) : '';
  const major = Number.parseInt(String(version).split('.')[0], 10);
  if (!Number.isInteger(major) || major < 8) {
    throw new Error(
      `拍平丢掉了 SDK 嵌套 ajv@8（MCP SDK 解析到 ajv@${version || 'missing'}）`,
    );
  }
}

/**
 * 用精简 deploy 目录组装 resources/vendor/deepseek-harness：
 *   apps/cli     <- deploy 根内容（lib/ config/ package.json，不含 node_modules）
 *   apps/web/dist<- vendor 源码构建产物
 *   node_modules <- deploy/node_modules（扁平依赖，完整展开以保留版本隔离嵌套）
 *   vendor       <- deploy/vendor（本地 cordis 插件包源）
 * 该结构已被验证可完整启动 dsh web（scripts/patch-deploy.js 迭代补齐）。
 */
async function assembleFromDeploy(projectDir, deployDir, harnessDest) {
  const vendorSrc = path.join(projectDir, 'vendor', 'deepseek-harness');
  // 1) apps/cli <- deploy 根内容（排除 node_modules 与 vendor，它们单独复制）
  const cliDest = path.join(harnessDest, 'apps', 'cli');
  let total = 0;
  for (const n of deployCliEntries(deployDir)) {
    const files = collectFiles(path.join(deployDir, n.name), path.join(cliDest, n.name), true);
    total += await copyFiles(files, 32);
  }
  // 2) node_modules：
  //    a) 顶层条目逐个收集（链接解引用后以真实路径为根）
  //    b) 拍平 .pnpm store：每个条目的包内容复制到顶层（目标已存在则跳过），
  //       使顶层覆盖全部运行时包，同时避免硬链接重复展开
  const nmSrc = path.join(deployDir, 'node_modules');
  const nmDest = path.join(harnessDest, 'node_modules');
  for (const n of fs.readdirSync(nmSrc, { withFileTypes: true })) {
    if (n.name === '.pnpm') {
      continue;
    }
    const s = path.join(nmSrc, n.name);
    const d = path.join(nmDest, n.name);
    const root = n.isSymbolicLink() ? realOf(s) : s;
    const files = collectFiles(root, d, false, false);
    total += await copyFiles(files, 32);
  }
  const storeDir = path.join(nmSrc, '.pnpm');
  if (fs.existsSync(storeDir)) {
    const flattened = collectPnpmFlattenFiles(storeDir, nmDest);
    console.log(`拍平 .pnpm store: ${flattened.length} 个文件`);
    total += await copyFiles(flattened, 32);
  }
  total += await repairFlattenedCommanderEsm(deployDir, harnessDest);
  const jobs = [
    [path.join(deployDir, 'vendor'), path.join(harnessDest, 'vendor')],
    [path.join(vendorSrc, 'apps', 'web', 'dist'), path.join(harnessDest, 'apps', 'web', 'dist')],
  ];
  for (const [src, dest] of jobs) {
    if (!fs.existsSync(src)) {
      throw new Error(`精简目录缺少 ${src}`);
    }
    const files = collectFiles(src, dest, false, false);
    total += await copyFiles(files, 32);
  }
  return total;
}

function resolveResourcesDir(context) {
  if (context?.packager && typeof context.packager.getResourcesDir === 'function') {
    return context.packager.getResourcesDir(context.appOutDir);
  }
  if (context?.electronPlatformName === 'darwin') {
    const product = context.packager?.appInfo?.productFilename || 'Whale Isle';
    return path.join(context.appOutDir, `${product}.app`, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

const NODE_DIST_MIRROR = process.env.DSH_NODE_DIST_MIRROR || 'https://nodejs.org/dist';

/** 官方独立 Node 只链系统库；Homebrew/源码装的瘦二进制会列出 libnode 与 homebrew、/opt/*、/usr/local/* 前缀依赖 —— 打进安装包后目标机没有这些前缀库就 SIGABRT。 */
function nodeBinaryHasExternalDylibs(listing) {
  return /libnode|\/opt\/|homebrew|\/usr\/local\//i.test(listing);
}

function probeNodeDylibListing(binPath) {
  const tool = process.platform === 'darwin' ? 'otool' : 'ldd';
  const args = process.platform === 'darwin' ? ['-L', binPath] : [binPath];
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 15000 });
  return result.status === 0 ? result.stdout : null;
}

function bundledNodePinnedVersion(projectDir) {
  try {
    const pinned = fs.readFileSync(path.join(projectDir, '.nvmrc'), 'utf8').trim();
    const match = /^v?(\d+\.\d+\.\d+)/.exec(pinned);
    return match ? match[1] : process.versions.node;
  } catch {
    return process.versions.node;
  }
}

function downloadSelfContainedNode(cacheDir, version) {
  const tuple = `node-v${version}-${process.platform}-${process.arch}`;
  const bin = path.join(cacheDir, tuple, 'bin', 'node');
  if (fs.existsSync(bin)) {
    return bin;
  }
  const stage = path.join(cacheDir, `.tmp-${process.pid}`);
  fs.rmSync(stage, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(stage, tuple, 'bin'), { recursive: true });
    const archive = path.join(stage, `${tuple}.tar.gz`);
    const url = `${NODE_DIST_MIRROR}/v${version}/${tuple}.tar.gz`;
    console.log(`本机 node 非自包含（瘦二进制），下载官方构建 ${url}`);
    execFileSync('curl', ['-fsSL', '--retry', '3', url, '-o', archive], { stdio: 'inherit' });
    execFileSync('tar', ['-xzf', archive, '-C', stage, `${tuple}/bin/node`], { stdio: 'inherit' });
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.renameSync(path.join(stage, tuple, 'bin', 'node'), bin);
    fs.chmodSync(bin, 0o755);
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    const actual = (probe.stdout || '').trim();
    if (probe.status !== 0 || actual !== `v${version}`) {
      throw new Error(`官方 Node 构建自检失败：期望 v${version}，实际 ${actual || probe.stderr || '无法运行'}`);
    }
    return bin;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function bundledPosixNode(projectDir) {
  const envBinary = process.env.NODE_BINARY;
  if (envBinary) {
    if (!fs.existsSync(envBinary)) {
      throw new Error(`NODE_BINARY 不存在：${envBinary}`);
    }
    return envBinary;
  }
  if (!/electron/i.test(process.execPath)) {
    const listing = probeNodeDylibListing(process.execPath);
    if (listing !== null && !nodeBinaryHasExternalDylibs(listing)) {
      return process.execPath;
    }
  }
  const version = bundledNodePinnedVersion(projectDir);
  return downloadSelfContainedNode(
    path.join(projectDir, 'node_modules', '.cache', 'dshd-node-dist'),
    version,
  );
}

function copyBundledNode(destDir, projectDir = process.cwd()) {
  // Both the Harness host and Office use the locked standalone Windows Node.
  const shared = path.join(destDir, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe');
  if (process.platform === 'win32' && fs.existsSync(shared)) return shared;
  let src;
  if (process.platform === 'win32') {
    src = [
      process.env.NODE_BINARY,
      process.execPath,
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
    ].find((candidate) => candidate && fs.existsSync(candidate) && !/electron/i.test(candidate));
  } else {
    src = bundledPosixNode(projectDir);
  }
  if (!src) {
    throw new Error('打包时未找到 Node.js 可执行文件，安装包将无法启动官方 Web UI');
  }
  const dest = path.join(destDir, process.platform === 'win32' ? 'node.exe' : 'node');
  fs.copyFileSync(src, dest);
  if (process.platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
  return dest;
}

function copyBundledPnpm(projectDir, destDir, target = {}) {
  const src = path.join(projectDir, 'node_modules', 'pnpm');
  if (!fs.existsSync(path.join(src, 'bin', 'pnpm.cjs'))) {
    throw new Error('打包时未找到 pnpm，请先 npm install');
  }
  const dest = path.join(destDir, 'pnpm');
  fs.mkdirSync(dest, { recursive: true });
  // Match the published pnpm package: artifacts/exe duplicates the CLI bundle.
  for (const name of ['package.json', 'bin', 'dist', 'LICENSE']) {
    const source = path.join(src, name);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(dest, name), { recursive: true, dereference: true });
  }
  pruneRuntimeFiles(dest, target);
  return dest;
}

function resolveDeployDir(deployEnv) {
  if (!deployEnv || deployEnv === 'off') {
    return null;
  }
  return path.resolve(deployEnv);
}

function nodePtyPrebuildRelative(platform = process.platform, arch = process.arch) {
  const folder = `${platform}-${arch}`;
  if (platform === 'win32') {
    return path.join('prebuilds', folder, 'conpty.node');
  }
  return path.join('prebuilds', folder, 'pty.node');
}

function resolveNodePtyRoot(harnessDest) {
  const direct = path.join(harnessDest, 'node_modules', 'node-pty');
  if (fs.existsSync(path.join(direct, 'package.json'))) {
    return direct;
  }
  throw new Error('安装包缺少 node-pty');
}

function assertHarnessVersions(harnessDest, pin) {
  if (!pin || typeof pin.npm !== 'string' || pin.npm.trim() === '') {
    throw new Error('assertHarnessRuntime requires pin.npm');
  }
  const rootPkg = JSON.parse(fs.readFileSync(path.join(harnessDest, 'package.json'), 'utf8'));
  const cliPkg = JSON.parse(fs.readFileSync(path.join(harnessDest, 'apps', 'cli', 'package.json'), 'utf8'));
  if (rootPkg.version !== pin.npm || cliPkg.version !== pin.npm) {
    throw new Error(
      `安装包 Harness 版本 ${rootPkg.version}/${cliPkg.version} 与 pin.npm ${pin.npm} 不一致`,
    );
  }
}

function assertNodePtyPrebuild(harnessDest, platform = process.platform, arch = process.arch) {
  const relative = nodePtyPrebuildRelative(platform, arch);
  const native = path.join(resolveNodePtyRoot(harnessDest), relative);
  if (!fs.existsSync(native)) {
    throw new Error(`安装包缺少 node-pty prebuild：${relative}`);
  }
}

/**
 * Every registered desktop fork package must ship resolvable in the packaged
 * runtime with its declared runtime entries on disk. The shipped web
 * composition mounts these rows unconditionally (skip-user-plugins included),
 * so a runtime missing one dies on every start with an ESM
 * `ERR_MODULE_NOT_FOUND … imported from …profiles/web/` that no recovery
 * path can fix — a stale deploy dir must fail the build here instead.
 * @param {string} harnessDest
 */
function assertDesktopForkRuntime(harnessDest) {
  const problems = [];
  for (const pkg of DESKTOP_PACKAGES) {
    const dir = path.join(harnessDest, 'node_modules', ...pkg.name.split('/'));
    const manifestFile = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestFile)) {
      problems.push(pkg.name);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch {
      problems.push(`${pkg.name}/package.json`);
      continue;
    }
    for (const rel of missingDeclaredEntries(dir, manifest)) {
      problems.push(`${pkg.name}/${rel}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`安装包缺少桌面组件包运行时：${problems.join(', ')}`);
  }
}

/** 并发拷贝曾把多个来源写进同一 dest，留下「合法 JSON + 尾部碎片」的损坏 manifest；解析全部 package.json 让该类损坏在打包期 fail-fast。 */
function assertNodeModulesManifests(harnessDest) {
  const nmRoot = path.join(harnessDest, 'node_modules');
  const broken = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'package.json') {
        try {
          JSON.parse(fs.readFileSync(full, 'utf8'));
        } catch {
          broken.push(path.relative(nmRoot, full));
        }
      }
    }
  };
  if (fs.existsSync(nmRoot)) {
    walk(nmRoot);
  }
  if (broken.length > 0) {
    const listed = broken.slice(0, 20).join(', ');
    const suffix = broken.length > 20 ? ` 等 ${broken.length} 个` : '';
    throw new Error(`安装包 node_modules 存在损坏的 package.json：${listed}${suffix}`);
  }
}

function assertHarnessRuntime(harnessDest, pin, platform = process.platform, arch = process.arch) {
  const requiredFiles = [
    path.join('apps', 'cli', 'lib', 'bin.js'),
    path.join('apps', 'web', 'dist', 'index.html'),
    path.join('node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-modules', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-message-edit', 'lib', 'client.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-mcp-servers-file', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-host-mcp-servers', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-host-skill-inventory', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-mcp', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-mcp', 'lib', 'client.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-skills', 'lib', 'index.js'),
    path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-skills', 'lib', 'client.js'),
    path.join('node_modules', 'koffi', 'src', 'koffi', 'index.js'),
  ];
  const missing = requiredFiles.filter((relative) => !fs.existsSync(path.join(harnessDest, relative)));
  if (missing.length > 0) {
    throw new Error(`安装包缺少 Harness 运行时产物：${missing.join(', ')}`);
  }
  assertDesktopForkRuntime(harnessDest);

  // Root client tsdown does not run copy-ghostty-assets; fill lib/assets before the gate.
  ensureGhosttyAssetsInHarness(harnessDest);
  if (!harnessHasGhosttyAssets(harnessDest)) {
    throw new Error(
      `安装包缺少终端 Ghostty 资源（dirname(client.js)/assets）：${missingGhosttyAssetPaths(harnessDest).join(', ')}`,
    );
  }

  const chat = fs.readFileSync(
    path.join(harnessDest, 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'),
    'utf8',
  );
  const messageEdit = fs.readFileSync(
    path.join(harnessDest, 'node_modules', '@deepseek-ai', 'dsh-client-ui-message-edit', 'lib', 'client.js'),
    'utf8',
  );
  const sessionCtl = fs.readFileSync(
    path.join(harnessDest, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js'),
    'utf8',
  );
  if (!chat.includes('conversation.chat.user-actions')) {
    throw new Error('安装包的 Chat UI 缺少用户消息 action slot');
  }
  if (!messageEdit.includes('conversation.chat.user-actions')) {
    throw new Error('安装包缺少消息编辑用户 action');
  }
  if (!sessionCtl.includes('beforeSeq') || !/fork/i.test(sessionCtl)) {
    throw new Error('安装包的 session Remote 缺少 fork beforeSeq');
  }
  assertHarnessVersions(harnessDest, pin);
  assertNodePtyPrebuild(harnessDest, platform, arch);
  assertMcpSdkAjv(harnessDest);
  assertNodeModulesManifests(harnessDest);
}

/**
 * Directory size in bytes for the evidence ledger log lines.
 * @param {string} root
 * @returns {number}
 */
function directorySize(root) {
  let bytes = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) { bytes += directorySize(full); }
    else if (entry.isFile()) { bytes += fs.statSync(full).size; }
  }
  return bytes;
}

/**
 * P3 Office closure: the packaged build must ship the locked win-x64 payload
 * (resources/runtime/primary-runtime), the skill assets
 * (resources/runtime/office-skills), and the complete LibreOffice Kit
 * closure inside the flattened Harness runtime — including the native engine
 * declared for win32-x64. WASM fallback is not a win32-x64 deliverable, so a
 * missing engine fails the build instead of degrading silently.
 * @param {string} resources - packaged resources directory
 * @param {string} harnessDest - assembled (pre-tar) harness runtime
 */
function assertOfficeRuntime(resources, harnessDest) {
  const payload = path.join(resources, 'runtime', 'primary-runtime');
  const manifestFile = path.join(payload, 'runtime.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error(
      `安装包缺少 Office 运行时清单 ${manifestFile}——请先运行 npm run prepare:office-runtime`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.platform !== 'win32' || manifest.arch !== 'x64' || typeof manifest.payloadDigest !== 'string') {
    throw new Error(`Office 运行时清单无效：platform=${manifest.platform} arch=${manifest.arch}（需要 win32/x64 + payloadDigest）`);
  }
  if (manifest.payloadDigest !== officePayloadDigest(payload, manifest)) {
    throw new Error('Office 运行时内容与裁剪后的载荷摘要不一致');
  }
  const requiredPayload = [
    path.join(payload, 'dependencies', 'node', 'bin', 'node.exe'),
    path.join(payload, 'dependencies', 'python', 'python.exe'),
    path.join(payload, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
    path.join(payload, 'dependencies', 'python', 'Lib', 'site-packages'),
  ];
  const skills = path.join(resources, 'runtime', 'office-skills');
  const requiredSkills = [
    path.join(skills, 'scripts', 'check_office.py'),
    ...['office-docx', 'office-pptx', 'office-xlsx'].map((dir) => path.join(skills, dir, 'SKILL.md')),
  ];
  const missingPayload = [...requiredPayload, ...requiredSkills]
    .filter((file) => !fs.existsSync(file));
  if (missingPayload.length > 0) {
    throw new Error(`安装包的 Office 运行时不完整：${missingPayload.join(', ')}`);
  }

  const nm = path.join(harnessDest, 'node_modules', '@deepseek-ai');
  // Resolve the kit the way the runtime does — from the skill package's own
  // dir — because flattening may nest it below the top-level slot (which can
  // even hold an unreachable stale store copy of another version).
  const skillDir = path.join(nm, 'dsh-skill-office');
  const kitDir = resolvePackageFrom(skillDir, '@deepseek-ai/libreoffice-kit', harnessDest);
  const engineDir = kitDir
    && resolvePackageFrom(kitDir, '@deepseek-ai/libreoffice-kit-win32-x64', harnessDest);
  const requiredClosure = [
    path.join(nm, 'dsh-office-to-pdf', 'package.json'),
    path.join(skillDir, 'package.json'),
    path.join(nm, 'dsh-tool-workspace-dependencies', 'package.json'),
    ...(kitDir ? [path.join(kitDir, 'lib', 'cli.js')] : []),
    ...(engineDir
      ? [path.join(engineDir, 'bin', 'libreoffice-kit.exe'), path.join(engineDir, 'prebuilds.json')]
      : []),
  ];
  if (!kitDir || !engineDir) {
    throw new Error(
      `安装包的 LibreOffice Kit 闭包不完整：dsh-skill-office 无法解析 kit/engine`
      + `（kit=${kitDir || 'unresolved'} engine=${engineDir || 'unresolved'}）`,
    );
  }
  const missingClosure = requiredClosure.filter((file) => !fs.existsSync(file));
  if (missingClosure.length > 0) {
    throw new Error(`安装包的 LibreOffice Kit 闭包不完整：${missingClosure.join(', ')}`);
  }
  const kitVersion = JSON.parse(fs.readFileSync(path.join(kitDir, 'package.json'), 'utf8')).version;
  // The pnpm store can hold an orphaned kit copy (installed under an older
  // lockfile) which flattening hoists to the top-level slot — dead weight that
  // would wrongly serve any consumer resolving from a shallow position.
  for (const sibling of ['libreoffice-kit', 'libreoffice-kit-win32-x64']) {
    if (fs.existsSync(path.join(harnessDest, RUNTIME_LINKS))) break;
    const stale = path.join(nm, sibling);
    if (path.resolve(stale) === path.resolve(kitDir) || path.resolve(stale) === path.resolve(engineDir || '')) { continue; }
    const manifestFile = path.join(stale, 'package.json');
    if (!fs.existsSync(manifestFile)) { continue; }
    const staleVersion = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).version;
    if (countResolvers(harnessDest, `@deepseek-ai/${sibling}`, stale) > 0) { continue; }
    console.log(`Office 孤儿副本清理: @deepseek-ai/${sibling}@${staleVersion}（零解析者，实际解析到 ${path.resolve(stale) === path.resolve(engineDir) ? engineDir : kitDir}）`);
    fs.rmSync(longPath(stale), { recursive: true, force: true });
  }
  const engineManifest = JSON.parse(fs.readFileSync(path.join(engineDir, 'package.json'), 'utf8'));
  const prebuilds = JSON.parse(fs.readFileSync(path.join(engineDir, 'prebuilds.json'), 'utf8'));
  if (engineManifest.version !== kitVersion
    || prebuilds.version !== kitVersion
    || prebuilds.status !== 'built'
    || prebuilds.platform !== 'win32-x64') {
    throw new Error(`Office 引擎与 kit 不一致：kit@${kitVersion} engine@${engineManifest.version} prebuilds=${prebuilds.platform}/${prebuilds.status}`);
  }
  console.log(
    `Office 闭包校验通过：kit@${kitVersion} + win32-x64 引擎`
    + `（engine ${(directorySize(engineDir) / 1048576).toFixed(1)} MB，`
    + `payload ${(directorySize(payload) / 1048576).toFixed(1)} MB，`
    + `digest ${manifest.payloadDigest}）`,
  );
}

module.exports = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const resources = resolveResourcesDir(context);
  const target = { platform: context.electronPlatformName || process.platform,
    arch: typeof context.arch === 'number' ? require('builder-util').Arch[context.arch] : context.arch || process.arch };
  restoreVendoredPluginNodeModules(projectDir, resources, 'dsh-usage-panel');
  installPluginRuntimeDeps(path.join(resources, 'vendor', 'dsh-usage-panel'), { skipIfComplete: true });
  assertVendoredPluginRuntimeDeps(resources, 'dsh-usage-panel');
  restoreVendoredPluginNodeModules(projectDir, resources, 'dsh-im');
  // Reuse the tree only when a deep closure check proves it complete. The
  // shallow `skipIfComplete` predicate must not decide this: it can leave a
  // half-broken tree that silently drops Settings → Remote → Channels, which is
  // why the previous revision deleted and reinstalled unconditionally.
  installPluginRuntimeDeps(path.join(resources, 'vendor', 'dsh-im'), {
    skipIfComplete: false,
    verify: missingPluginRuntimeClosure,
  });
  assertVendoredPluginRuntimeDeps(resources, 'dsh-im');
  restoreVendoredPluginNodeModules(projectDir, resources, 'dshbot');
  installPluginRuntimeDeps(path.join(resources, 'vendor', 'dshbot'), { skipIfComplete: true });
  assertVendoredPluginRuntimeDeps(resources, 'dshbot');
  restoreVendoredPluginNodeModules(projectDir, resources, 'dsh-whale');
  installPluginRuntimeDeps(path.join(resources, 'vendor', 'dsh-whale'), { skipIfComplete: true });
  assertVendoredPluginRuntimeDeps(resources, 'dsh-whale');
  restoreVendoredPluginNodeModules(projectDir, resources, 'dsh-remote');
  installPluginRuntimeDeps(path.join(resources, 'vendor', 'dsh-remote'), { skipIfComplete: true });
  assertVendoredPluginRuntimeDeps(resources, 'dsh-remote');
  // dsh-task-control is dependency-free (node:* + relative imports only);
  // the closure assert still proves the packaged copy ships its lib/.
  assertVendoredPluginRuntimeDeps(resources, 'dsh-task-control');
  assertVendoredPluginRuntimeDeps(resources, 'dsh-platform-session');
  for (const name of ['dsh-usage-panel', 'dsh-im', 'dshbot', 'dsh-whale', 'dsh-remote']) {
    const root = path.join(resources, 'vendor', name);
    const removed = prunePluginDevDependencies(root, resolvePackageFrom, runtimeDependencyEntries, target);
    assertVendoredPluginRuntimeDeps(resources, name);
    console.log(`${name}: removed ${removed} non-production dependency packages`);
  }
  pruneRuntimeFiles(path.join(resources, 'vendor', 'dshd-remote'), target);
  await assertDshdRemoteRuntime(resources);
  const harnessDest = path.join(resources, 'vendor', 'deepseek-harness');
  const started = Date.now();

  const harnessSrc = path.join(projectDir, 'vendor', 'deepseek-harness');
  const sources = selectHarnessRuntimeSources(harnessSrc, resolvePackageFrom, runtimeDependencyEntries);
  console.log(`装配 CLI 与桌面扩展的生产依赖闭包：${sources.length} 个工作区包`);
  fs.mkdirSync(harnessDest, { recursive: true });
  let copied = await copyFiles(['package.json', 'LICENSE'].filter(name => fs.existsSync(path.join(harnessSrc, name)))
    .map(name => ({ src: path.join(harnessSrc, name), dest: path.join(harnessDest, name) })), 32);
  copied += await assembleCanonicalRuntime(harnessSrc, harnessDest, sources, target);
  // The web frontend is a prebuilt asset tree, not an additional dependency root.
  copied += await copyFiles(collectFiles(path.join(harnessSrc, 'apps', 'web', 'dist'),
    path.join(harnessDest, 'apps', 'web', 'dist')), 32);

  assertNoDevOnlyPackages(harnessDest);

  const nodeDest = copyBundledNode(resources, projectDir);
  const pnpmDest = copyBundledPnpm(projectDir, resources, target);
  const pin = JSON.parse(fs.readFileSync(path.join(projectDir, 'vendor', 'harness-upstream.json'), 'utf8'));
  fs.mkdirSync(path.join(resources, 'vendor'), { recursive: true });
  fs.writeFileSync(
    path.join(resources, 'vendor', 'harness-upstream.json'),
    `${JSON.stringify(pin, null, 2)}\n`,
  );
  assertHarnessRuntime(harnessDest, pin, target.platform, target.arch);
  assertVendoredPluginRuntimeDeps(resources, 'dsh-project');
  require('../src/main/dsh-project-desktop').projectPeerDirectories(harnessDest,
    JSON.parse(fs.readFileSync(path.join(resources, 'vendor', 'dsh-project', 'package.json'), 'utf8')));
  // Office payload + kit closure is a win-x64 deliverable only (see the
  // feature card's limitations); other targets ship without Office and the
  // desktop overlay stays unwritten because the bundled payload is absent.
  if (context.electronPlatformName === 'win32') {
    pruneOfficeRuntime(path.join(resources, 'runtime', 'primary-runtime'), target);
    assertOfficeRuntime(resources, harnessDest);
  }
  // Skip compose contract against the REAL packaged CLI: unit tests mock
  // dsh.start, so this dist-path gate is the only automated place where the
  // shipped runtime proves `--skip-user-plugins` drops the user layer while
  // the desktop-owned overlays mount install + usage + dsh-im + market +
  // dshbot on every start and session-search only on full starts.
  console.log('校验 skip compose 契约（真实 CLI dump-config，skip + full 双轮）…');
  await runSkipComposeContract(harnessDest, { log: (line) => console.log(line) });

  const archive = path.join(resources, 'vendor', 'deepseek-harness.tar');
  removeRuntimeLinks(harnessDest);
  console.log('打包运行时为单个 tar，减少 NSIS 解压文件数…');
  execFileSync('tar', ['-cf', path.basename(archive), '-C', path.basename(harnessDest), '.'], {
    cwd: path.dirname(harnessDest),
    stdio: 'inherit',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (!fs.existsSync(archive) || fs.statSync(archive).size < 1024) {
    throw new Error('运行时 tar 生成失败');
  }
  await writeRuntimeArchiveIdentity(archive);
  fs.rmSync(longPath(harnessDest), { recursive: true, force: true });

  if (context.electronPlatformName === 'win32') {
    const installerRuntime = path.join(resources, 'runtime');
    fs.mkdirSync(installerRuntime, { recursive: true });
    for (const [source, name] of [
      ['scripts/install-harness.cjs', 'install-harness.cjs'],
      ['src/shared/runtime-links.js', 'runtime-links.js'],
      ['src/shared/harness-runtime-identity.js', 'harness-runtime-identity.js'],
    ]) fs.copyFileSync(path.join(projectDir, source), path.join(installerRuntime, name));
  }

  console.log(`已复制 ${copied} 个文件，写入 ${nodeDest} 与 ${pnpmDest}`);
  console.log(`运行时归档 ${((fs.statSync(archive).size / 1048576).toFixed(1))} MB`);
  console.log(`afterPack 完成 ${((Date.now() - started) / 1000).toFixed(1)}s`);
};

module.exports.collectFiles = collectFiles;
module.exports.overlayWorkspaceRuntimePackages = overlayWorkspaceRuntimePackages;
module.exports.collectPnpmFlattenFiles = collectPnpmFlattenFiles;
module.exports.repairFlattenedVersionIsolation = repairFlattenedVersionIsolation;
module.exports.assembleCanonicalRuntime = assembleCanonicalRuntime;
module.exports.assertNoDevOnlyPackages = assertNoDevOnlyPackages;
module.exports.repairFlattenedCommanderEsm = repairFlattenedCommanderEsm;
module.exports.copyFiles = copyFiles;
module.exports.pickCopyWinners = pickCopyWinners;
module.exports.copyBundledNode = copyBundledNode;
module.exports.nodeBinaryHasExternalDylibs = nodeBinaryHasExternalDylibs;
module.exports.assertNodeModulesManifests = assertNodeModulesManifests;
module.exports.deployCliEntries = deployCliEntries;
module.exports.resolveDeployDir = resolveDeployDir;
module.exports.resolveResourcesDir = resolveResourcesDir;
module.exports.assertDesktopForkRuntime = assertDesktopForkRuntime;
module.exports.assertHarnessRuntime = assertHarnessRuntime;
module.exports.assertOfficeRuntime = assertOfficeRuntime;
module.exports.assertHarnessVersions = assertHarnessVersions;
module.exports.assertNodePtyPrebuild = assertNodePtyPrebuild;
module.exports.assertVendoredPluginRuntimeDeps = assertVendoredPluginRuntimeDeps;
module.exports.assertDshdRemoteRuntime = assertDshdRemoteRuntime;
module.exports.installPluginRuntimeDeps = installPluginRuntimeDeps;
module.exports.missingPluginRuntimeClosure = missingPluginRuntimeClosure;
module.exports.CLOSURE_INCOMPLETE_MARKER = CLOSURE_INCOMPLETE_MARKER;
module.exports.nodePtyPrebuildRelative = nodePtyPrebuildRelative;
module.exports.restoreVendoredPluginNodeModules = restoreVendoredPluginNodeModules;
module.exports.ensureGhosttyAssetsInHarness = ensureGhosttyAssetsInHarness;
