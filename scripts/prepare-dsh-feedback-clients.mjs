/** Keep the shipped usage and Office clients aligned with their sources. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newestMtime } from './source-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const clients = [
  { name: 'dsh-usage-panel', inputs: ['src', 'scripts', 'package.json'], build: 'scripts/build.mjs' },
  {
    name: 'dsh-im',
    inputs: ['plugin-src/client', 'src/channels/office/protocol.mjs', 'src/channels/slack/manifest.mjs', 'package.json'],
    build: 'plugin-src/client/build.mjs',
  },
];

for (const client of clients) {
  const packageRoot = path.join(root, 'vendor', client.name);
  const output = path.join(packageRoot, 'lib', 'client.js');
  const sourceMtime = Math.max(...client.inputs.map(input => newestMtime(
    path.join(packageRoot, input), undefined, { includeDirMtime: true },
  )));
  const outputMtime = fs.existsSync(output) ? fs.statSync(output).mtimeMs : 0;
  if (!force && outputMtime > sourceMtime) {
    console.log(`[${client.name}] client bundle is current`);
    continue;
  }
  console.log(`[${client.name}] rebuilding client bundle`);
  const result = spawnSync(process.execPath, [path.join(packageRoot, client.build)], {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
