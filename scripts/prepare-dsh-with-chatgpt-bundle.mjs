#!/usr/bin/env node
/** Build the optional ChatGPT bundle from this checkout for separate distribution. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleRoot = path.join(root, 'vendor', 'dsh-with-chatgpt');
// Keep the bundle's independent install on the Harness-pinned pnpm rather
// than migrating it with the desktop's independently versioned manager.
const pnpm = path.join(root, 'vendor', 'deepseek-harness', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
const outputDirectory = path.join(root, 'dist', 'plugins');
const env = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
};

function runPnpm(args) {
  const result = spawnSync(process.execPath, [pnpm, ...args], {
    cwd: bundleRoot,
    env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`[dsh-with-chatgpt] pnpm ${args[0]} failed (status ${result.status ?? 'unknown'})`);
  }
}

try {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'package.json'), 'utf8'));
  if (!fs.existsSync(pnpm)) throw new Error('[dsh-with-chatgpt] Install the vendored Harness dependencies first');
  // Build only the outer bundle, whose independent lockfile records this
  // directory as importer "."; bridge/package.json is packed, not installed.
  runPnpm([
    'install', '--frozen-lockfile', '--ignore-workspace', '--ignore-scripts',
  ]);
  // The bundle's prepack compiles bridge/src before pnpm writes the tarball.
  runPnpm(['pack', '--pack-destination', outputDirectory]);
  const output = path.join(outputDirectory, `${manifest.name}-${manifest.version}.tgz`);
  if (!fs.existsSync(output)) throw new Error(`[dsh-with-chatgpt] Tarball was not written: ${output}`);
  console.log(`[dsh-with-chatgpt] Optional bundle: ${output}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
