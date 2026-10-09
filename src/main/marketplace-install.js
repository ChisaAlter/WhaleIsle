const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { app } = require('electron');
const { loadConfig } = require('./config');
const { resolveNodeBin, sourceHarnessStatus } = require('./dsh');
const { projectRoot, harnessRoot } = require('./paths');
const { childSpawnEnv } = require('../shared/child-spawn-env');
const { ensureDirectoryLink } = require('./desktop-plugin-link');
const { DROPPED, isDroppedPluginName, webProfileDir, PROFILE, listInstalledPlugins } = require('./plugins');
const { resolveCommitSha, getMarketplacePlugin } = require('./marketplace-catalog');
const { parseAllowBuilds } = require('./marketplace-allowbuilds');
const {
  isValidGithubSpec,
  isValidPackageName,
  isValidAllowBuild,
  normalizeAllowBuilds,
} = require('../host/install-dsh-plugin-client');
const {
  GITHUB_PATH_SPEC,
  parseGithubSpec,
  githubIdentity,
  isAllowedMarketplaceSpec,
} = require('./marketplace-spec');
const {
  resolveMarketplaceUpdate,
  marketplaceUpdateTarget,
  readMarketplaceCurrent,
  invalidateMarketplaceUpdates,
} = require('./marketplace-updates');

/**
 * The dsh CLI prints the pnpm-workspace.yaml remediation for every failed
 * git-hosted install, including network and checkout failures. Only an exact
 * allowBuilds key proves that pnpm actually blocked a prepare script.
 * @param {number | null} code
 * @param {string[]} allowBuilds
 * @returns {boolean}
 */
function isBuildApprovalFailure(code, allowBuilds) {
  return code !== 0 && Array.isArray(allowBuilds) && allowBuilds.length > 0;
}

function whichAll(command) {
  try {
    const bin = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(bin, [command], { encoding: 'utf8' });
    return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    // where/which exited non-zero; the command is absent from PATH.
    return [];
  }
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolvePnpmEntry() {
  return firstExisting([
    path.join(process.resourcesPath || '', 'pnpm', 'bin', 'pnpm.mjs'),
    path.join(projectRoot(), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    path.join(harnessRoot(), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
  ]);
}

function resolvePnpmBin() {
  const fromPath = whichAll(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')[0]
    || whichAll('pnpm')[0];
  if (fromPath && fs.existsSync(fromPath)) {
    return fromPath;
  }
  return null;
}

function shimDir() {
  return path.join(app.getPath('userData'), 'bin');
}

function ensurePnpmShim(nodeBin) {
  const entry = resolvePnpmEntry();
  if (!entry || !nodeBin) {
    return resolvePnpmBin() ? path.dirname(resolvePnpmBin()) : null;
  }
  const dir = shimDir();
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    const cmd = path.join(dir, 'pnpm.cmd');
    fs.writeFileSync(cmd, `@echo off\r\n"${nodeBin}" "${entry}" %*\r\n`, 'utf8');
  } else {
    const sh = path.join(dir, 'pnpm');
    fs.writeFileSync(sh, `#!/bin/sh\nexec "${nodeBin}" "${entry}" "$@"\n`, { encoding: 'utf8', mode: 0o755 });
  }
  return dir;
}

function pluginEnv(nodeBin) {
  const extras = [];
  const shim = ensurePnpmShim(nodeBin);
  if (shim) {
    extras.push(shim);
  }
  if (nodeBin) {
    extras.push(path.dirname(nodeBin));
  }
  if (process.env.APPDATA) {
    extras.push(path.join(process.env.APPDATA, 'npm'));
  }
  const env = childSpawnEnv(loadConfig(), { extras });
  env.CI = env.CI || '1';
  return env;
}

function workspaceYamlPath() {
  return path.join(webProfileDir(), 'pnpm-workspace.yaml');
}

function allowBuildsInWorkspace(keys) {
  const normalized = normalizeAllowBuilds(keys);
  if (!normalized) {
    throw new Error('allowBuilds contains an invalid package key');
  }
  const file = workspaceYamlPath();
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!/allowBuilds\s*:/m.test(text)) {
    text = `${text.replace(/\s+$/, '')}${text ? '\n' : ''}allowBuilds:\n`;
  }
  for (const key of normalized) {
    const quoted = JSON.stringify(key);
    const pattern = new RegExp(`^\\s*${quoted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'm');
    if (pattern.test(text)) {
      continue;
    }
    text = text.replace(/allowBuilds\s*:\s*\n?/, `allowBuilds:\n  ${quoted}: true\n`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

function resolveCli() {
  const config = loadConfig();
  const nodeBin = resolveNodeBin(config);
  const source = sourceHarnessStatus();
  const binJs = path.join(harnessRoot(), 'apps', 'cli', 'lib', 'bin.js');
  if (!nodeBin) {
    return { ok: false, error: '未找到 Node.js。请安装 Node.js 22.19+ 或 24+。' };
  }
  if (!fs.existsSync(binJs) && !source.bin) {
    return { ok: false, error: '未找到 dsh CLI。请先运行 npm run setup:harness。' };
  }
  const cli = fs.existsSync(binJs) ? binJs : source.bin;
  if (!cli || !fs.existsSync(cli)) {
    return { ok: false, error: 'dsh CLI 未构建。请先运行 npm run setup:harness。' };
  }
  if (!resolvePnpmEntry() && !resolvePnpmBin()) {
    return { ok: false, error: '未找到 pnpm。安装包应已内置；开发时请在本机安装 pnpm。' };
  }
  return { ok: true, nodeBin, cli };
}

function runPlugin(args, onProgress) {
  const resolved = resolveCli();
  if (!resolved.ok) {
    return Promise.resolve({ ok: false, code: 127, log: resolved.error, needsAllowBuilds: false, allowBuilds: [] });
  }
  const env = pluginEnv(resolved.nodeBin);
  return new Promise((resolve) => {
    const child = spawn(resolved.nodeBin, [resolved.cli, 'plugin', '--profile', PROFILE, ...args], {
      cwd: os.homedir(),
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const append = (chunk) => {
      const text = chunk.toString('utf8');
      log += text;
      if (typeof onProgress === 'function') {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) {
            onProgress({ phase: 'log', line });
          }
        }
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (error) => {
      resolve({
        ok: false,
        code: 127,
        log: `${log}\n${error.message}`.trim(),
        needsAllowBuilds: false,
        allowBuilds: [],
      });
    });
    child.on('exit', (code) => {
      const allowBuilds = parseAllowBuilds(log);
      const needsAllowBuilds = isBuildApprovalFailure(code, allowBuilds);
      resolve({
        ok: code === 0,
        code: code ?? 1,
        log: log.trim(),
        needsAllowBuilds,
        allowBuilds,
      });
    });
  });
}

const BUSY_ERROR = '已有插件正在安装或卸载，请稍后再试';

let pluginLock = false;

function pluginCommand(options) {
  return typeof options.runPlugin === 'function' ? options.runPlugin : runPlugin;
}

async function withPluginLock(work) {
  if (pluginLock) {
    return { ok: false, error: BUSY_ERROR };
  }
  pluginLock = true;
  try {
    return await work();
  } finally {
    pluginLock = false;
  }
}

/**
 * Whether an install spec resolves to a dropped plugin family: a dropped npm
 * name (scope renames included), or a github spec whose repo — or `#path:`
 * tail directory — carries a dropped basename. Segment-exact matching only;
 * `github:x/dsh-im-bridge` is a different package and stays installable.
 * @param {string} spec
 * @returns {boolean}
 */
function isDroppedInstallSpec(spec) {
  const value = String(spec || '').trim();
  if (!value) {
    return false;
  }
  if (isValidPackageName(value) && isDroppedPluginName(value)) {
    return true;
  }
  const identity = githubIdentity(value);
  if (!identity) {
    return false;
  }
  const [repoPart, pathPart] = identity.split('#path:/');
  const repo = repoPart.split('/')[1] || '';
  const tail = pathPart ? pathPart.split('/').filter(Boolean).pop() || '' : '';
  return isDroppedPluginName(repo) || (tail !== '' && isDroppedPluginName(tail));
}

function isDroppedInstall(plugin, spec) {
  const repo = String(plugin.id || '').split('/')[1] || '';
  return DROPPED.includes(plugin.id)
    || isDroppedPluginName(plugin.packageName)
    || isDroppedPluginName(repo)
    || isDroppedInstallSpec(spec);
}

function packageInstallDir(packageName) {
  return path.join(webProfileDir(), 'node_modules', packageName);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Missing files and invalid JSON are unread, not fatal.
    return null;
  }
}

function resolveExportFile(pkg, dir, key) {
  const exp = pkg.exports;
  if (typeof exp === 'string') {
    return key === '.' ? path.resolve(dir, exp) : null;
  }
  if (!exp || typeof exp !== 'object') {
    return null;
  }
  const entry = exp[key];
  if (typeof entry === 'string') {
    return path.resolve(dir, entry);
  }
  if (entry && typeof entry === 'object') {
    const rel = entry.default || entry.import || entry.require;
    return typeof rel === 'string' ? path.resolve(dir, rel) : null;
  }
  return null;
}

function isExistingFile(file) {
  try {
    return Boolean(file) && fs.statSync(file).isFile();
  } catch {
    // Absent paths are not loadable entries.
    return false;
  }
}

function hasLoadableEntry(packageName) {
  const dir = packageInstallDir(packageName);
  const pkg = readJsonFile(path.join(dir, 'package.json'));
  if (!pkg || typeof pkg !== 'object') {
    return false;
  }
  const patch = pkg.dsh?.bundle?.patch;
  if (typeof patch === 'string' && patch && isExistingFile(path.resolve(dir, patch))) {
    return true;
  }
  const client = pkg.dsh?.client;
  if (typeof client === 'string' && isExistingFile(path.resolve(dir, client))) {
    return true;
  }
  if (client && typeof client === 'object' && isExistingFile(resolveExportFile(pkg, dir, './client'))) {
    return true;
  }
  if (typeof pkg.main === 'string' && isExistingFile(path.resolve(dir, pkg.main))) {
    return true;
  }
  return isExistingFile(resolveExportFile(pkg, dir, '.'));
}

/**
 * Whether the installed package manifest carries the name/version pair the
 * request-time plugin inventory reports. A mounted package whose manifest
 * lacks either throws during request preparation and fails every official
 * DeepSeek request, so install treats it as unusable.
 */
function hasInventoryIdentity(packageName) {
  const pkg = readJsonFile(path.join(packageInstallDir(packageName), 'package.json'));
  return Boolean(pkg) && typeof pkg.name === 'string' && pkg.name !== ''
    && typeof pkg.version === 'string' && pkg.version !== '';
}

function pluginNames(installed) {
  return (installed?.plugins || []).map((row) => row.name).filter(Boolean);
}

function listNodeModuleNames() {
  const root = path.join(webProfileDir(), 'node_modules');
  const names = [];
  if (!fs.existsSync(root)) {
    return names;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    // Unreadable node_modules is treated as empty.
    return names;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin' || entry.name === '.pnpm') {
      continue;
    }
    if (entry.name.startsWith('@')) {
      let nested = [];
      try {
        nested = fs.readdirSync(path.join(root, entry.name), { withFileTypes: true });
      } catch {
        // Unreadable scope directory is skipped.
        continue;
      }
      for (const child of nested) {
        if (child.isDirectory()) {
          names.push(`${entry.name}/${child.name}`);
        }
      }
      continue;
    }
    names.push(entry.name);
  }
  return names;
}

function specMatchesInstall(installedSpec, installSpec) {
  const left = githubIdentity(installedSpec);
  const right = githubIdentity(installSpec);
  return Boolean(left && right && left === right);
}

function resolveInstalledNames(spec, before, after, beforeModules, afterModules) {
  const previous = new Set([...pluginNames(before), ...beforeModules]);
  const next = [...new Set([...pluginNames(after), ...afterModules])];
  const added = next.filter((name) => !previous.has(name));
  // An overwrite can also add another dependency. Always validate the requested
  // package, even when another newly discovered package is itself loadable.
  const registry = parseImportRegistrySpec(spec);
  const requested = isValidPackageName(spec) ? [spec] : registry ? [registry.name]
    : (after.plugins || []).filter(row => specMatchesInstall(row.spec, spec)).map(row => row.name);
  return [...new Set([...requested, ...added])];
}

function parsePatchInsertedIds(text) {
  // Loader ids nested under an insert: key. Not a YAML parser; indented id: lines only.
  const ids = [];
  let insertIndent = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (/^\s*-?\s*insert:\s*$/u.test(line)) {
      insertIndent = indent;
      continue;
    }
    const id = /^\s*-?\s*id:\s*['"]?([^'"\s]+)/.exec(line);
    if (!id) {
      if (insertIndent !== null && indent <= insertIndent && !/^\s*-?\s*(id|name|config):/u.test(line)) {
        insertIndent = null;
      }
      continue;
    }
    if (insertIndent !== null && indent > insertIndent) {
      if (!ids.includes(id[1])) {
        ids.push(id[1]);
      }
    } else {
      insertIndent = null;
    }
  }
  return ids;
}

function bundlePatchInsertedIds(packageName) {
  const dir = packageInstallDir(packageName);
  const pkg = readJsonFile(path.join(dir, 'package.json'));
  const declared = pkg?.dsh?.bundle?.patch;
  if (typeof declared !== 'string' || !declared) {
    return [];
  }
  const file = path.resolve(dir, declared);
  if (!isExistingFile(file)) {
    return [];
  }
  try {
    return parsePatchInsertedIds(fs.readFileSync(file, 'utf8'));
  } catch {
    // Unreadable patch files contribute no loader ids.
    return [];
  }
}

function conflictingEntryIds(packageName, installedNames) {
  const mine = bundlePatchInsertedIds(packageName);
  if (mine.length === 0) {
    return [];
  }
  const hits = [];
  for (const owner of installedNames) {
    if (owner === packageName) {
      continue;
    }
    const theirs = new Set(bundlePatchInsertedIds(owner));
    for (const id of mine) {
      if (theirs.has(id) && !hits.some((hit) => hit.id === id)) {
        hits.push({ id, owner });
      }
    }
  }
  return hits;
}

function gitAllowBuildsKey(name, spec) {
  const pathMatch = GITHUB_PATH_SPEC.exec(spec);
  if (pathMatch) {
    return `${name}@git+https://github.com/${pathMatch[1]}/${pathMatch[2]}.git`;
  }
  const parsed = parseGithubSpec(spec);
  if (!parsed) {
    return null;
  }
  return `${name}@git+https://github.com/${parsed.owner}/${parsed.repo}.git`;
}

function withGitAllowBuilds(result, spec) {
  if (!result?.needsAllowBuilds) {
    return result;
  }
  const allowBuilds = [...(result.allowBuilds || [])];
  for (const name of allowBuilds.slice()) {
    const key = gitAllowBuildsKey(name, spec);
    if (key && isValidAllowBuild(key) && !allowBuilds.includes(key)) {
      allowBuilds.push(key);
    }
  }
  return { ...result, allowBuilds };
}

function loadableInstallFailure(added, error) {
  return {
    ok: false,
    spec: added.spec,
    error: error || '该包不是可加载的 dsh 插件',
    needsAllowBuilds: false,
    allowBuilds: [],
    log: added.log || '',
  };
}

/**
 * Validate what a successful `plugin add` produced: every resolved package
 * must be loadable and carry the name/version the request-time plugin
 * inventory reports. A missing manifest pair throws during request
 * preparation and fails every official DeepSeek request, so the install is
 * refused. The caller restores the complete pre-add snapshot on failure.
 * @param {object} added - `addPluginSpec` success result.
 * @param {object} before - `listInstalledPlugins()` snapshot from before add.
 * @param {string[]} beforeModules - `listNodeModuleNames()` snapshot.
 * @returns {{ names: string[], failure: object | null }}
 */
function validateAddedPlugins(added, before, beforeModules) {
  const names = resolveInstalledNames(
    added.spec,
    before,
    added.installed,
    beforeModules,
    listNodeModuleNames(),
  );
  // A successful add with no discoverable package is still a failed install.
  if (names.length === 0 || !names.every(hasLoadableEntry)) {
    return { names: [], failure: loadableInstallFailure(added) };
  }
  const unidentifiable = names.find((name) => !hasInventoryIdentity(name));
  if (unidentifiable !== undefined) {
    return {
      names: [],
      failure: loadableInstallFailure(added, `插件包 ${unidentifiable} 缺少 name 或 version 声明`),
    };
  }
  return { names, failure: null };
}

function installPathStat(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Preserve actual bytes, including the pnpm virtual store and transitive deps.
// A manifest-only rollback followed by `install` can fail offline or resolve a
// different version. Links inside node_modules retain their original targets;
// copying does not traverse desktop overlays or external link: dependencies.
async function captureInstallSnapshot() {
  const profile = webProfileDir();
  fs.mkdirSync(profile, { recursive: true });
  const entries = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'node_modules'].map(name => {
    const file = path.join(profile, name);
    const stat = installPathStat(file);
    if (stat && (stat.isSymbolicLink() || (name === 'node_modules' ? !stat.isDirectory() : !stat.isFile()))) {
      throw new Error(`无法安全备份 ${name}：需要普通文件或目录`);
    }
    return { name, file, existed: Boolean(stat) };
  });
  const dir = fs.mkdtempSync(path.join(profile, '.install-rollback-'));
  try {
    for (const entry of entries) {
      if (entry.existed) {
        await fs.promises.cp(entry.file, path.join(dir, entry.name), {
          recursive: true, verbatimSymlinks: true,
          filter: (source, target) => {
            if (process.platform === 'win32' && fs.lstatSync(source).isSymbolicLink()
              && fs.statSync(source).isDirectory()) {
              // fs.cp recreates junctions as directory symlinks, which need
              // elevated privileges on Windows. Keep directory links as
              // junctions and never copy the external target's contents.
              ensureDirectoryLink(source, target);
              return false;
            }
            return true;
          },
        });
      }
    }
    return { dir, entries };
  } catch (error) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function discardInstallSnapshot(snapshot, result) {
  try {
    await fs.promises.rm(snapshot.dir, { recursive: true, force: true });
  } catch (error) {
    // Cleanup failure must not turn a committed install into another rollback.
    result.log = [result.log, `安装快照清理失败，保留于 ${snapshot.dir}：${error.message}`].filter(Boolean).join('\n');
  }
  return result;
}

async function rollbackInstall(snapshot, failure) {
  const errors = [];
  for (const entry of snapshot.entries) {
    try {
      // Quarantine the replacement before publishing the saved installation.
      // Never run `remove <name>`: that name may have been installed before add.
      if (installPathStat(entry.file)) {
        fs.renameSync(entry.file, path.join(snapshot.dir, `failed-${entry.name}`));
      }
      if (entry.existed) fs.renameSync(path.join(snapshot.dir, entry.name), entry.file);
    } catch (error) {
      errors.push(`${entry.name}: ${error.message}`);
    }
  }
  invalidateMarketplaceUpdates();
  const rollbackError = errors.length ? `${errors.join('；')}；回滚备份保留于 ${snapshot.dir}` : undefined;
  const result = {
    ...failure,
    ok: false,
    rolledBack: !rollbackError,
    rollbackError,
    error: `${failure.error || '安装失败'}${rollbackError ? `；自动回滚失败：${rollbackError}` : '；已恢复安装前状态'}`,
    // Do not offer a retry/approval while the profile needs manual recovery.
    ...(rollbackError ? { needsAllowBuilds: false, allowBuilds: [] } : {}),
  };
  return rollbackError ? result : discardInstallSnapshot(snapshot, result);
}

/** Snapshot before any CLI/workspace mutation; commit only after validation. */
async function addAndValidate(spec, options, checkConflicts = false) {
  const before = listInstalledPlugins();
  const beforeModules = listNodeModuleNames();
  let snapshot;
  try {
    snapshot = await captureInstallSnapshot();
  } catch (error) {
    return { failure: { ok: false, spec, error: `无法创建安装回滚点，未执行安装：${error.message}` } };
  }
  let added;
  let failure;
  try {
    added = await addPluginSpec(spec, options);
    if (!added.ok) {
      failure = added;
    } else {
      const checked = validateAddedPlugins(added, before, beforeModules);
      failure = checked.failure;
      if (!failure && checkConflicts) {
        const clashes = checked.names.flatMap(name => conflictingEntryIds(name, pluginNames(before)));
        if (clashes.length) failure = loadableInstallFailure(added, `插件会与已装包冲突（loader id: ${clashes[0].id}）`);
      }
    }
  } catch (error) {
    failure = { ok: false, spec, error: `安装异常：${error.message}`, log: added?.log || '' };
  }
  if (failure) return { failure: await rollbackInstall(snapshot, failure) };
  return { added: await discardInstallSnapshot(snapshot, added), failure: null };
}

async function pinInstallSpec(spec, token) {
  if (!token) {
    return spec;
  }
  const parsed = parseGithubSpec(spec);
  if (!parsed) {
    return spec;
  }
  if (parsed.ref && /^[0-9a-f]{7,40}$/i.test(parsed.ref)) {
    return spec;
  }
  const sha = await resolveCommitSha(parsed.owner, parsed.repo, parsed.ref || 'HEAD', token);
  return sha ? `github:${parsed.owner}/${parsed.repo}#${sha}` : spec;
}

function failedInstall(result, pinned) {
  const log = String(result.log || '');
  const failure = /ERR_PNPM_UNEXPECTED_(?:STORE|VIRTUAL_STORE)|ERR_PNPM_MODULES_BREAKING_CHANGE/.test(log)
    ? '依赖目录与当前 pnpm 版本不兼容；请保留日志后修复 profile，未自动删除依赖'
    : /ERR_PNPM_NO_MATCHING_VERSION|ERR_PNPM_NO_MATCHING_VERSION_INSIDE_WORKSPACE/.test(log)
      ? '目标包版本不可用或被发布时间保护限制；未绕过保护，请稍后重试'
      : /ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed/i.test(log)
        ? '下载失败：请检查网络、代理及仓库访问权限后重试'
        : '安装失败';
  return {
    ...result,
    spec: pinned,
    error: result.needsAllowBuilds ? '需要允许该插件在本机执行构建脚本' : failure,
  };
}

async function addPluginSpec(spec, options) {
  const allowBuilds = normalizeAllowBuilds(options.allowBuilds);
  if (!allowBuilds) {
    return { ok: false, error: 'allowBuilds 包含非法包名' };
  }
  if (typeof options.onProgress === 'function') {
    const verb = options.progressVerb || '正在安装';
    options.onProgress({ phase: 'start', line: `${verb} ${spec}` });
  }
  const pinned = await pinInstallSpec(spec, options.token);
  if (allowBuilds.length) {
    allowBuildsInWorkspace(allowBuilds);
  }
  const result = await pluginCommand(options)(['add', pinned], options.onProgress);
  if (result.ok) {
    return { ...result, spec: pinned, installed: listInstalledPlugins() };
  }
  return failedInstall(withGitAllowBuilds(result, pinned), pinned);
}

async function installPlugin(spec, options = {}) {
  const name = String(spec || '').trim();
  if (!name) {
    return { ok: false, error: '缺少安装规格' };
  }
  return withPluginLock(async () => {
    if (!isValidGithubSpec(name)) {
      return { ok: false, error: '仅支持 github:owner/repo[#ref] 安装规格' };
    }
    if (isDroppedInstallSpec(name)) {
      return { ok: false, error: '该插件已退役，不再提供安装' };
    }
    const { added, failure } = await addAndValidate(name, options);
    return failure || added;
  });
}

/** Launcher-import registry spec: `name@1.2.3` / `name@^1.2.3` / `name@~1.2.3`. */
const IMPORT_REGISTRY_VERSION = /^[\^~]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Split a launcher-import registry spec into `{ name, version }`.
 * Scoped names keep their leading `@`; the version separator is the last `@`.
 * @param {string} spec
 * @returns {{ name: string, version: string } | null}
 */
function parseImportRegistrySpec(spec) {
  const value = String(spec || '').trim();
  const at = value.lastIndexOf('@');
  if (at <= 0) {
    return null;
  }
  const name = value.slice(0, at);
  const version = value.slice(at + 1);
  if (!isValidPackageName(name) || !IMPORT_REGISTRY_VERSION.test(version)) {
    return null;
  }
  return { name, version };
}

/**
 * Launcher-import install channel: reinstall a plugin from the user's own
 * official profile manifest. Accepts the marketplace `github:` specs plus
 * pinned registry `name@<semver>` specs. This channel is main-process only
 * (LAUNCHER IPC); the renderer/tool `installPlugin` channel stays github-only.
 * @param {string} spec - `github:owner/repo[#ref]` or `name@<semver>`.
 * @param {{ allowBuilds?: string[], token?: string, onProgress?: Function, runPlugin?: Function }} [options]
 * @returns {Promise<{ ok: boolean, error?: string, spec?: string, log?: string }>}
 */
async function installImportPlugin(spec, options = {}) {
  const value = String(spec || '').trim();
  if (!value) {
    return { ok: false, error: '缺少安装规格' };
  }
  const registry = isValidGithubSpec(value) ? null : parseImportRegistrySpec(value);
  if (!isValidGithubSpec(value) && !registry) {
    return { ok: false, error: '仅支持 github:owner/repo[#ref] 或 name@版本 安装规格' };
  }
  return withPluginLock(async () => {
    const dropped = registry
      ? isDroppedPluginName(registry.name)
      : isDroppedInstallSpec(value);
    if (dropped) {
      return { ok: false, error: '该插件已退役，不再提供安装' };
    }
    const { added, failure } = await addAndValidate(value, options);
    return failure || added;
  });
}

async function uninstallPlugin(packageName, options = {}) {
  const name = String(packageName || '').trim();
  if (!name) {
    return { ok: false, error: '缺少包名' };
  }
  return withPluginLock(async () => {
    if (!isValidPackageName(name)) {
      return { ok: false, error: '包名格式非法' };
    }
    if (typeof options.onProgress === 'function') {
      options.onProgress({ phase: 'start', line: `正在卸载 ${name}` });
    }
    const result = await pluginCommand(options)(['remove', name], options.onProgress);
    if (result.ok) {
      invalidateMarketplaceUpdates();
      return { ...result, installed: listInstalledPlugins() };
    }
    return { ...result, error: '卸载失败' };
  });
}

/**
 * Install a curated marketplace plugin by catalog id.
 * The CLI only receives that row's installSpec after marketplace validation.
 * @param {string} id - registry `owner/name` id.
 * @param {{ allowBuilds?: string[], token?: string, onProgress?: Function }} [options]
 * @returns {Promise<{ ok: boolean, error?: string, spec?: string, needsAllowBuilds?: boolean, allowBuilds?: string[], log?: string, installed?: object }>}
 */
async function installMarketplacePlugin(id, options = {}) {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, error: '缺少插件 id' };
  }
  return withPluginLock(async () => {
    const plugin = getMarketplacePlugin(id.trim());
    if (!plugin) {
      return { ok: false, error: '未收录该插件' };
    }
    if (plugin.deprecated === true) {
      return { ok: false, error: '该插件已弃用，不再提供安装' };
    }
    const spec = plugin.installSpec;
    if (typeof spec !== 'string' || !spec || !isAllowedMarketplaceSpec(spec, plugin)) {
      return { ok: false, error: '安装规格不受支持' };
    }
    if (isDroppedInstall(plugin, spec)) {
      return { ok: false, error: '该插件已退役，不再提供安装' };
    }
    const { added, failure } = await addAndValidate(spec, options, true);
    if (failure !== null) {
      return failure;
    }
    invalidateMarketplaceUpdates();
    return added;
  });
}

function captureProfileFile(name) {
  const file = path.join(webProfileDir(), name);
  const existed = fs.existsSync(file);
  return {
    file,
    existed,
    contents: existed ? fs.readFileSync(file) : null,
  };
}

function captureUpdateSnapshot() {
  return [
    captureProfileFile('package.json'),
    captureProfileFile('pnpm-lock.yaml'),
    captureProfileFile('pnpm-workspace.yaml'),
  ];
}

function restoreUpdateSnapshot(snapshot) {
  for (const entry of snapshot) {
    if (!entry.existed) {
      if (fs.existsSync(entry.file)) fs.unlinkSync(entry.file);
      continue;
    }
    fs.mkdirSync(path.dirname(entry.file), { recursive: true });
    const tmp = `${entry.file}.update-rollback.tmp`;
    fs.writeFileSync(tmp, entry.contents);
    fs.renameSync(tmp, entry.file);
  }
}

async function rollbackMarketplaceUpdate(snapshot, options) {
  if (typeof options.onProgress === 'function') {
    options.onProgress({ phase: 'rollback', line: '更新失败，正在恢复原版本' });
  }
  try {
    restoreUpdateSnapshot(snapshot);
  } catch (error) {
    return { ok: false, error: `无法恢复 profile 快照：${error.message}` };
  }
  let restored;
  try {
    restored = await pluginCommand(options)(['install'], options.onProgress);
  } catch (error) {
    restored = { ok: false, log: error.message };
  }
  invalidateMarketplaceUpdates();
  return restored.ok
    ? { ok: true, log: restored.log || '' }
    : { ok: false, error: 'profile 快照已恢复，但重新安装原版本失败', log: restored.log || '' };
}

async function failedMarketplaceUpdate(result, snapshot, options, error) {
  const rollback = await rollbackMarketplaceUpdate(snapshot, options);
  const suffix = rollback.ok ? '；已恢复原版本' : `；自动回滚失败：${rollback.error}`;
  return {
    ...result,
    ok: false,
    error: `${error}${suffix}`,
    rolledBack: rollback.ok,
    rollbackError: rollback.ok ? undefined : rollback.error,
    log: [result?.log, rollback.log].filter(Boolean).join('\n'),
  };
}

/** Update one installed curated plugin to the checked version or commit. */
async function updateMarketplacePlugin(id, options = {}) {
  return withPluginLock(() => updateMarketplacePluginLocked(id, options));
}

async function updateMarketplacePluginLocked(id, options = {}) {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, error: '缺少插件 id' };
  }
  {
    const resolved = await resolveMarketplaceUpdate(id.trim(), {
      token: options.token,
      fetchImpl: options.fetchImpl,
    });
    const plugin = resolved.plugin;
    const status = resolved.status;
    if (!plugin) return { ok: false, error: '未收录该插件' };
    if (plugin.deprecated === true) return { ok: false, error: '该插件已弃用，不再提供更新' };
    if (isDroppedInstall(plugin, plugin.installSpec)) return { ok: false, error: '该插件已退役，不再提供更新' };
    if (!status) return { ok: false, error: '该插件尚未安装或安装来源无法匹配' };
    if (status.checkFailed) return { ok: false, error: '无法检查远端版本，请稍后重试' };
    if (!status.updateAvailable) return { ok: false, error: '未发现可用更新' };
    if (!isValidPackageName(status.packageName)) return { ok: false, error: '已安装包名格式非法' };
    const target = marketplaceUpdateTarget(plugin, status);
    if (!target) return { ok: false, error: '无法解析更新目标' };

    let snapshot;
    try {
      snapshot = captureUpdateSnapshot();
    } catch (error) {
      return { ok: false, error: `无法创建更新回滚点：${error.message}` };
    }
    const before = listInstalledPlugins();
    let added;
    try {
      added = await addPluginSpec(target, { ...options, progressVerb: '正在更新' });
    } catch (error) {
      return failedMarketplaceUpdate({ log: error.message }, snapshot, options, '更新异常');
    }
    if (!added.ok) {
      return failedMarketplaceUpdate(added, snapshot, options, added.error || '更新失败');
    }
    const current = readMarketplaceCurrent(plugin, status);
    const expected = String(status.latest || '').toLowerCase();
    if (!current || String(current).toLowerCase() !== expected) {
      return failedMarketplaceUpdate(added, snapshot, options, '更新命令完成，但版本或提交没有变化');
    }
    if (!hasLoadableEntry(status.packageName)) {
      return failedMarketplaceUpdate(added, snapshot, options, '更新后的插件缺少可加载入口');
    }
    if (!hasInventoryIdentity(status.packageName)) {
      return failedMarketplaceUpdate(added, snapshot, options, '更新后的插件缺少 name 或 version 声明');
    }
    const clashes = conflictingEntryIds(status.packageName, pluginNames(before));
    if (clashes.length > 0) {
      return failedMarketplaceUpdate(
        added,
        snapshot,
        options,
        `更新后的插件会与已装包冲突（loader id: ${clashes[0].id}）`,
      );
    }
    invalidateMarketplaceUpdates();
    return {
      ...added,
      updated: true,
      update: { ...status, current, updateAvailable: false },
      installed: listInstalledPlugins(),
    };
  }
}

/** Hold the shared mutation lock across the whole batch, without intermediate restarts. */
async function updateMarketplacePlugins(ids, options = {}) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100
      || ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 300)) {
    return { ok: false, error: '批量更新需要 1 到 100 个有效目录 id' };
  }
  return withPluginLock(async () => {
    const results = [];
    for (const id of [...new Set(ids.map(value => value.trim()))]) {
      options.onProgress?.({ phase: 'start', line: `更新 ${results.length + 1}/${ids.length}: ${id}` });
      const result = await updateMarketplacePluginLocked(id, options);
      results.push({ id, ...result });
      // A damaged profile must be repaired before any further mutation or restart.
      if (result.rolledBack === false) break;
    }
    const changed = results.some(result => result.ok);
    const rollbackFailed = results.some(result => result.rolledBack === false);
    return {
      ok: results.every(result => result.ok),
      changed,
      rollbackFailed,
      results,
      error: results.every(result => result.ok) ? undefined : '部分插件更新失败，请查看操作记录；构建授权需逐项确认',
    };
  });
}

module.exports = {
  listInstalledPlugins,
  parseAllowBuilds,
  allowBuildsInWorkspace,
  installPlugin,
  installImportPlugin,
  parseImportRegistrySpec,
  isDroppedInstallSpec,
  uninstallPlugin,
  installMarketplacePlugin,
  updateMarketplacePlugin,
  updateMarketplacePlugins,
  resolveCli,
  runPlugin,
  isBuildApprovalFailure,
};
