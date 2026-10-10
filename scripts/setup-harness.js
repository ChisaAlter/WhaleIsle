const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readPin } = require('../src/shared/harness-upstream');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'vendor', 'deepseek-harness');
const pnpm = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');

function harnessEnv() {
  const bin = path.join(root, 'node_modules', '.bin');
  return {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
  };
}

function runGit(args, cwd) {
  console.log(`> git ${args.join(' ')}`);
  const result = spawnSync('git', args, {
    cwd,
    stdio: 'inherit',
    env: harnessEnv(),
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runNode(args, cwd) {
  console.log(`> node ${args.join(' ')}`);
  const result = spawnSync(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    env: harnessEnv(),
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!fs.existsSync(path.join(vendor, 'package.json'))) {
  const pin = readPin(root);
  fs.mkdirSync(path.dirname(vendor), { recursive: true });
  runGit(['clone', '--depth', '1', '--branch', pin.ref, pin.repo, vendor], root);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: vendor,
    encoding: 'utf8',
    shell: false,
  }).stdout.trim();
  if (head !== pin.sha) {
    console.error(`setup:harness HEAD ${head} != pin.sha ${pin.sha}`);
    process.exit(1);
  }
}

runNode([pnpm, 'install', '--frozen-lockfile'], vendor);
runNode([pnpm, 'run', 'build:official'], vendor);

// Root build:lib:client copies Ghostty wasm/font; still ensure lib/assets beside client.js.
const { ensureGhosttyAssetsInHarness, harnessHasGhosttyAssets, missingGhosttyAssetPaths } = require(
  '../src/shared/ghostty-assets',
);
const ghostty = ensureGhosttyAssetsInHarness(vendor);
if (!harnessHasGhosttyAssets(vendor)) {
  console.error(`setup:harness 缺少终端 Ghostty 资源：${missingGhosttyAssetPaths(vendor).join(', ')}`);
  console.error(ghostty.detail);
  process.exit(1);
}
console.log(`Ghostty assets: ${ghostty.detail}`);

const {
  installPluginRuntimeDeps,
  assertVendoredPluginRuntimeDeps,
  missingPluginRuntimeClosure,
} = require('./after-pack');
const usagePanel = path.join(root, 'vendor', 'dsh-usage-panel');
if (fs.existsSync(path.join(usagePanel, 'package.json'))) {
  installPluginRuntimeDeps(usagePanel, { skipIfComplete: true });
}
const dshIm = path.join(root, 'vendor', 'dsh-im');
if (fs.existsSync(path.join(dshIm, 'package.json'))) {
  // Never fully trust a half-broken tree, but do not delete a healthy one: the
  // deep closure check decides, and any missing entry still forces reinstall.
  installPluginRuntimeDeps(dshIm, {
    skipIfComplete: false,
    verify: missingPluginRuntimeClosure,
  });
  assertVendoredPluginRuntimeDeps(root, 'dsh-im');
}

console.log(`官方源码已就绪：${vendor}`);
