import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('plugin builds use a matching root esbuild host and binary despite a vendored older host', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-esbuild '));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const plugin = path.join(fixture, 'vendor', 'usage');
  const host = path.join(plugin, 'node_modules', 'esbuild');
  fs.mkdirSync(path.join(host, 'lib'), { recursive: true });
  const trackedHost = path.join(root, 'vendor', 'dsh-usage-panel', 'node_modules', 'esbuild');
  for (const file of ['package.json', 'lib/main.js']) {
    fs.copyFileSync(path.join(trackedHost, file), path.join(host, file));
  }
  const hostVersion = JSON.parse(fs.readFileSync(path.join(host, 'package.json'), 'utf8')).version;

  // This is the actual macOS resolution pattern: the plugin has an old JS
  // package, no local native package, and sees the newer ancestor binary.
  const platformPackage = `@esbuild/${process.platform}-${process.arch}`;
  const binaryVersion = require(`${platformPackage}/package.json`).version;
  assert.notEqual(hostVersion, binaryVersion, 'the fixture must exercise mismatched host and binary versions');
  const binary = process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild';
  const binaryTarget = path.join(fixture, 'node_modules', platformPackage, binary);
  fs.mkdirSync(path.dirname(binaryTarget), { recursive: true });
  fs.copyFileSync(require.resolve(`${platformPackage}/${binary}`), binaryTarget);
  fs.chmodSync(binaryTarget, 0o755);
  const entry = path.join(plugin, 'build.mjs');
  fs.writeFileSync(entry, `import { transformSync, version } from 'esbuild';
console.log(JSON.stringify({ version, code: transformSync('const answer: number = 42', { loader: 'ts' }).code }));
`);
  const env = { ...process.env };
  delete env.ESBUILD_BINARY_PATH;
  const run = args => spawnSync(process.execPath, [...args, entry], {
    cwd: plugin, env, encoding: 'utf8', shell: false, windowsHide: true,
  });
  const broken = run([]);
  assert.equal(broken.status, 1, `${broken.stdout}\n${broken.stderr}`);
  assert.ok(broken.stderr.includes(`Host version "${hostVersion}" does not match binary version "${binaryVersion}"`), broken.stderr);

  const fixed = run(['--import', pathToFileURL(path.join(root, 'scripts', 'plugin-build-esbuild.mjs')).href]);
  assert.equal(fixed.status, 0, `${fixed.error || ''}\n${fixed.stdout}\n${fixed.stderr}`);
  const output = JSON.parse(fixed.stdout.trim());
  assert.equal(output.version, require('esbuild/package.json').version);
  assert.match(output.code, /const answer = 42/);
});
