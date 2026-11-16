#!/usr/bin/env node
/**
 * `npm run setup`: one command to a working local development environment.
 *
 * Reuses the existing entry points in order: engines check → npm ci →
 * setup:harness → prepare-whale-ui → the ChatGPT bundle the compatibility
 * test imports. Ready steps skip fast, so the command is safe to re-run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assertNodeVersion } from './lib/node-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { harnessHasGhosttyAssets } = require('../src/shared/ghostty-assets.js');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const harness = path.join(root, 'vendor', 'deepseek-harness');
const chatgpt = path.join(root, 'vendor', 'dsh-with-chatgpt');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * The vendored lefthook postinstall (`lefthook install -f`) would write hooks
 * into the developer's outer repository. It only stands down when CI is
 * truthy and LEFTHOOK is unset, so every install child below inherits that
 * exact environment.
 */
const childEnv = { ...process.env, CI: 'true' };
delete childEnv.LEFTHOOK;

function run(command, args, cwd = root) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd, env: childEnv, stdio: 'inherit', shell: false, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

/** npm records the tree it wrote in node_modules/.package-lock.json. */
function rootDepsCurrent() {
  const hiddenPath = path.join(root, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(hiddenPath)) return false;
  const wanted = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages ?? {};
  let installed;
  try {
    installed = JSON.parse(fs.readFileSync(hiddenPath, 'utf8')).packages ?? {};
  } catch {
    return false;
  }
  for (const [key, meta] of Object.entries(wanted)) {
    if (key === '' || meta.link === true) continue;
    const have = installed[key];
    if (have === undefined) {
      // Platform-skipped optional entries are absent from the hidden lock.
      if (meta.optional === true || meta.devOptional === true) continue;
      return false;
    }
    if (have.version !== meta.version) return false;
  }
  return true;
}

function electronDistBinary() {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  if (process.platform === 'win32') return path.join(dist, 'electron.exe');
  if (process.platform === 'darwin') {
    return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }
  return path.join(dist, 'electron');
}

function harnessReady() {
  return fs.existsSync(path.join(harness, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'))
    && fs.existsSync(path.join(harness, '.dsh-build', 'client-build-environment.json'))
    && fs.existsSync(path.join(root, 'src', 'main', 'preview-guest-preload.bundle.js'))
    && fs.existsSync(path.join(root, 'vendor', 'dsh-usage-panel', 'node_modules'))
    && fs.existsSync(path.join(root, 'vendor', 'dsh-im', 'node_modules'))
    && harnessHasGhosttyAssets(harness);
}

function chatgptBundleReady() {
  return fs.existsSync(path.join(chatgpt, 'node_modules'))
    && fs.existsSync(path.join(chatgpt, 'bridge', 'dist', 'workspace', 'manager.js'));
}

assertNodeVersion(process.versions.node, manifest.engines?.node);
console.log(`[setup] Node v${process.versions.node} 满足 engines ${manifest.engines.node}`);

if (rootDepsCurrent()) {
  console.log('[setup] 根目录 node_modules 与 package-lock.json 一致，跳过 npm ci');
} else {
  run(npm, ['ci']);
}
if (!fs.existsSync(electronDistBinary())) {
  run(process.execPath, [path.join('node_modules', 'electron', 'install.js')]);
}

if (harnessReady()) {
  console.log('[setup] Harness 依赖与官方客户端构建已就绪，跳过 setup:harness');
} else {
  run(process.execPath, [path.join('scripts', 'setup-harness.js')]);
}

// prepare-whale-ui installs the whale-ui dependencies and self-skips a fresh
// build; typecheck:whale-ui only needs the dependency half.
run(process.execPath, [path.join('scripts', 'prepare-whale-ui.mjs')]);

// The vendored daemon dist feeds the dshd-remote behavior tests (strict
// WHALE_REQUIRE_TEST_PREREQS mode included); the script self-skips once the
// vendored workspace deps and packages/*/dist are fresh.
run(process.execPath, [path.join('scripts', 'prepare-dshd-remote.mjs')]);

// dsh-plugin-compatibility.test.js imports vendor/dsh-with-chatgpt/lib, which
// reaches bridge/dist and the bundle's own node_modules.
if (chatgptBundleReady()) {
  console.log('[setup] ChatGPT 插件桥接已构建，跳过 prepare:dsh-with-chatgpt-bundle');
} else {
  run(process.execPath, [path.join('scripts', 'prepare-dsh-with-chatgpt-bundle.mjs')]);
}

console.log('[setup] 开发环境就绪');
