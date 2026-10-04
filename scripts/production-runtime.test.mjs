import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { productionClosure, prunePluginDevDependencies, runtimeFileExclusion } = require('./production-runtime');
const { collectFiles } = require('./after-pack');
const entries = pkg => new Map([
  ...Object.keys(pkg.dependencies || {}).map(name => [name, 'required']),
  ...Object.keys(pkg.optionalDependencies || {}).map(name => [name, 'optional']),
  ...Object.keys(pkg.peerDependencies || {}).map(name => [name, 'peer']),
]);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-production-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, manifest = {}) => {
    const dir = name === 'plugin' ? root : path.join(root, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, ...manifest }));
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1');
    return dir;
  };
  const resolve = (_from, name) => {
    const dir = path.join(root, 'node_modules', name);
    return fs.existsSync(path.join(dir, 'package.json')) ? dir : null;
  };
  return { root, write, resolve };
}

test('production pruning retains peers, optional/native dependencies and nested package subpaths', t => {
  const { root, write, resolve } = fixture(t);
  write('plugin', { dependencies: { zod: '*', sharp: '*' }, peerDependencies: { react: '*' },
    optionalDependencies: { optional: '*', absent: '*' }, devDependencies: { typescript: '*' } });
  const zod = write('zod');
  fs.mkdirSync(path.join(zod, 'v4'));
  fs.writeFileSync(path.join(zod, 'v4', 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(zod, 'v4', 'index.js'), 'export default 4');
  write('sharp', { optionalDependencies: { '@img/sharp-win32-x64': '*' } });
  write('@img/sharp-win32-x64');
  write('react'); write('optional'); write('typescript');
  assert.equal(prunePluginDevDependencies(root, resolve, entries), 1);
  assert.ok(fs.existsSync(path.join(root, 'node_modules/@img/sharp-win32-x64/index.js')));
  assert.ok(fs.existsSync(path.join(zod, 'v4/index.js')));
  assert.equal(productionClosure([root], resolve, entries).size, 6);
  assert.equal(fs.existsSync(path.join(root, 'node_modules/typescript')), false);
});

test('a missing production dependency blocks assembly', t => {
  const { root, write, resolve } = fixture(t);
  write('plugin', { dependencies: { missing: '*' } });
  assert.throws(() => productionClosure([root], resolve, entries), /plugin -> missing/);
});

test('file policy uses the Electron target and retains license and unknown runtime assets', t => {
  const { root, write } = fixture(t);
  write('plugin');
  for (const name of ['LICENSE.md', 'NOTICE', 'index.js.map', 'index.d.mts', 'runtime.wasm']) fs.writeFileSync(path.join(root, name), 'data');
  const files = collectFiles(root, path.join(root, 'dest')).map(item => path.basename(item.src));
  assert.ok(files.includes('LICENSE.md') && files.includes('NOTICE') && files.includes('runtime.wasm'));
  assert.ok(!files.includes('index.js.map') && !files.includes('index.d.mts'));
  assert.equal(runtimeFileExclusion('node-pty', 'prebuilds/darwin-arm64/pty.node', 'darwin', 'arm64'), false);
  assert.equal(runtimeFileExclusion('node-pty', 'prebuilds/darwin-x64/pty.node', 'darwin', 'arm64'), true);
});

test('native prebuild parent remains traversable while other platforms are omitted', t => {
  const { root, write } = fixture(t);
  write('plugin', { name: 'node-pty' });
  for (const target of ['win32-x64', 'darwin-arm64']) {
    const dir = path.join(root, 'prebuilds', target);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'conpty.node'), 'native');
  }
  const files = collectFiles(root, path.join(root, 'dest'), false, false, null,
    { platform: 'win32', arch: 'x64' }).map(item => path.relative(root, item.src).replaceAll('\\', '/'));
  assert.ok(files.includes('prebuilds/win32-x64/conpty.node'));
  assert.ok(!files.some(file => file.includes('darwin-arm64')));
});
