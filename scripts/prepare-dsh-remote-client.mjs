#!/usr/bin/env node
/** Build the vendored dsh-remote client bundle when its source changes. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(root, 'vendor', 'dsh-remote');
const clientSource = path.join(packageRoot, 'plugin-src', 'client');
const output = path.join(packageRoot, 'lib', 'client.js');
export function newestMtime(directory) {
  if (!fs.existsSync(directory)) return 0;
  let newest = fs.statSync(directory).mtimeMs;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}

export function shouldBuildDshRemoteClient({ force = false, sourceMtime, outputMtime }) {
  return force || !outputMtime || sourceMtime > outputMtime + 500;
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' ' + args.join(' ') + ' failed in ' + cwd + ' (status ' + (result.status ?? 'unknown') + ')');
  }
}

export function prepareDshRemoteClient({ force = process.argv.includes('--force') } = {}) {
  if (!fs.existsSync(path.join(packageRoot, 'package.json'))) {
    throw new Error('vendor/dsh-remote/package.json is missing');
  }
  if (!fs.existsSync(path.join(clientSource, 'index.js'))) {
    throw new Error('vendor/dsh-remote/plugin-src/client/index.js is missing');
  }
  const sourceMtime = newestMtime(clientSource);
  const outputMtime = fs.existsSync(output) ? fs.statSync(output).mtimeMs : 0;
  if (!shouldBuildDshRemoteClient({ force, sourceMtime, outputMtime })) {
    const current = fs.readFileSync(output, 'utf8');
    if (current.includes('id: "dsh-remote"') || current.includes('id:"dsh-remote"')) {
      console.log('[dsh-remote] client bundle is current');
      return { built: false, output };
    }
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['run', 'build'], packageRoot);
  if (!fs.existsSync(output)) throw new Error('[dsh-remote] client build did not write lib/client.js');
  const built = fs.readFileSync(output, 'utf8');
  if (!built.includes('id: "dsh-remote"') && !built.includes('id:"dsh-remote"')) {
    throw new Error('[dsh-remote] generated client bundle has the wrong ModuleLoader id');
  }
  return { built: true, output };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    prepareDshRemoteClient();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
