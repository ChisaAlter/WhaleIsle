import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { productionClosure, prunePluginDevDependencies, runtimeFileExclusion,
  pruneRuntimeFiles, pruneOfficeRuntime, officePayloadDigest } = require('./production-runtime');
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

function writeFile(root, relative, content = 'data') {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('a license carried only in README survives alongside ordinary license and skill files', t => {
  const { root, write } = fixture(t);
  write('plugin', { name: 'data-uri-to-buffer' });
  writeFile(root, 'README.md', '# data-uri-to-buffer\nLicense\n(The MIT License)\nCopyright (c) 2014 Nathan Rajlich\nPermission is hereby granted, free of charge, to any person obtaining a copy.');
  writeFile(root, 'README.en.md', '# usage instructions');
  writeFile(root, 'THIRD_PARTY_NOTICES.md', 'license text');
  writeFile(root, 'agent-presets/editing/SKILL.md', '# shipped instruction');
  const files = collectFiles(root, path.join(root, 'dest')).map(item => path.relative(root, item.src).replaceAll('\\', '/'));
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('THIRD_PARTY_NOTICES.md'));
  assert.ok(files.includes('agent-presets/editing/SKILL.md'));
  assert.ok(!files.includes('README.en.md'));
});

test('staged package cleanup removes development trees and remote metadata while retaining runtime subpaths', t => {
  const { root, write } = fixture(t);
  write('plugin');
  const packages = [
    ['@xmanrui/dsh-im', ['assets/logo.png', 'src/channel.ts', 'plugin-src/index.ts', 'scripts/build.mjs', 'channel.test.mjs', '.tmp-lock-validation.log']],
    ['dsh-usage-panel', ['assets/sample.png', 'src/index.ts', 'tests/check.js', 'docs/readme.txt', 'scripts/build.mjs', '.tmp/client.cjs']],
    ['@chisacode/protocol', ['dist/messages.d.ts', 'dist/messages.d.mts', 'dist/messages.js.map']],
    ['zod', ['src/v4/index.ts']],
    ['@mixmark-io/domino', ['test/index.js', '.yarn/plugins/plugin-version.cjs', 'yarn.lock']],
    ['@deepseek-ai/dsh-web-frontend', ['public/whale-isle-head.png']],
  ];
  for (const [name, excluded] of packages) {
    const dir = write(name);
    writeFile(dir, 'lib/index.js', 'module.exports = 42');
    writeFile(dir, 'LICENSE', 'license');
    for (const relative of excluded) writeFile(dir, relative);
  }
  const zod = path.join(root, 'node_modules', 'zod');
  writeFile(zod, 'v4/package.json', '{"type":"commonjs"}');
  writeFile(zod, 'v4/index.js', 'module.exports = 4');
  const koffi = write('koffi');
  writeFile(koffi, 'src/koffi/index.cjs', 'module.exports = 7');
  pruneRuntimeFiles(root, { platform: 'win32', arch: 'x64' });
  for (const [name, excluded] of packages) {
    const dir = path.join(root, 'node_modules', name);
    assert.equal(require(path.join(dir, 'lib/index.js')), 42, name);
    assert.ok(fs.existsSync(path.join(dir, 'LICENSE')), name);
    for (const relative of excluded) assert.equal(fs.existsSync(path.join(dir, relative)), false, `${name}/${relative}`);
  }
  assert.equal(require(path.join(zod, 'v4/index.js')), 4);
  assert.equal(require(path.join(koffi, 'src/koffi/index.cjs')), 7);
});

test('native cleanup retains active ConPTY files and notices but removes duplicate and other target binaries', t => {
  const { root, write } = fixture(t);
  write('plugin', { name: 'node-pty' });
  const retained = ['LICENSE', 'third_party/LICENSE', 'prebuilds/win32-x64/conpty.node',
    'prebuilds/win32-x64/conpty_console_list.node', 'prebuilds/win32-x64/conpty/conpty.dll',
    'prebuilds/win32-x64/conpty/OpenConsole.exe'];
  const excluded = ['third_party/conpty/1.25/win10-x64/conpty.dll', 'third_party/conpty/1.25/win10-x64/OpenConsole.exe',
    'prebuilds/win32-x64/conpty.pdb', 'prebuilds/win32-arm64/conpty.node', 'prebuilds/darwin-arm64/pty.node'];
  for (const relative of [...retained, ...excluded]) writeFile(root, relative);
  pruneRuntimeFiles(root, { platform: 'win32', arch: 'x64' });
  for (const relative of retained) assert.ok(fs.existsSync(path.join(root, relative)), relative);
  for (const relative of excluded) assert.equal(fs.existsSync(path.join(root, relative)), false, relative);
});

test('Electron builder applies target filters before packaging root node-pty and mobile maps', t => {
  const { root } = fixture(t);
  const build = require('../package.json').build;
  const { FileMatcher, getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher');
  for (const [platform, arch] of [['win', 'x64'], ['mac', 'arm64']]) {
    const expand = value => value.replaceAll('${arch}', arch);
    const matcher = getNodeModuleFileMatcher(root, root, expand, build[platform],
      { config: build, debugLogger: { isEnabled: false } });
    const filter = matcher.createFilter();
    const allowed = (relative, directory = false) => filter(path.join(root, relative), { isDirectory: () => directory });
    const target = platform === 'win' ? 'win32-x64' : 'darwin-arm64';
    const other = platform === 'win' ? 'darwin-arm64' : 'win32-x64';
    assert.ok(allowed('node_modules/node-pty/prebuilds', true));
    assert.ok(allowed(`node_modules/node-pty/prebuilds/${target}`, true));
    assert.ok(allowed(`node_modules/node-pty/prebuilds/${target}/conpty/conpty.dll`));
    assert.ok(allowed('node_modules/node-pty/third_party/LICENSE'));
    assert.equal(allowed(`node_modules/node-pty/prebuilds/${other}`, true), false);
    assert.equal(allowed(`node_modules/node-pty/prebuilds/${target}/conpty.pdb`), false);
    assert.equal(allowed('node_modules/node-pty/third_party/conpty/win10-x64/conpty.dll'), false);
  }
  const filter = new FileMatcher(root, root, value => value, build.files).createFilter();
  assert.ok(filter(path.join(root, 'mobile/web/chisacode/daemon-client.bundle.js'), { isDirectory: () => false }));
  assert.equal(filter(path.join(root, 'mobile/web/chisacode/daemon-client.bundle.js.map'), { isDirectory: () => false }), false);
});

test('Office trimming keeps Python APIs and source files, binds actual payload bytes, and leaves the source payload untouched', t => {
  const { root } = fixture(t);
  const source = path.join(root, 'source');
  const staged = path.join(root, 'staged');
  const python = 'dependencies/python/Lib/site-packages';
  const retained = [`${python}/numpy/testing/__init__.py`, `${python}/pandas/testing.py`,
    `${python}/pandas/_testing/__init__.py`, `${python}/pandas/__init__.py`,
    `${python}/numpy/__pycache__/no-source.cpython-312.pyc`, 'dependencies/python/LICENSE'];
  const excluded = [`${python}/numpy/tests/test_array.py`, `${python}/pandas/_testing/tests/test_helper.py`,
    `${python}/pandas/benchmarks/check.py`, `${python}/pandas/__pycache__/__init__.cpython-312.pyc`];
  for (const relative of [...retained, ...excluded]) writeFile(source, relative);
  writeFile(source, 'runtime.json', JSON.stringify({ platform: 'win32', arch: 'x64', pnpmVersion: '11.7.0', payloadDigest: 'original-input-digest' }));
  writeFile(source, 'dependencies/pnpm/package.json', '{"name":"pnpm","version":"11.7.0"}');
  writeFile(source, 'dependencies/pnpm/bin/pnpm.mjs', 'export const version = "11.7.0"');
  for (const target of ['win32-x64-msvc', 'win32-arm64-msvc', 'darwin-arm64']) {
    const pkg = `dependencies/pnpm/dist/node_modules/@reflink/reflink-${target}`;
    writeFile(source, `${pkg}/package.json`, JSON.stringify({ name: `@reflink/reflink-${target}` }));
    writeFile(source, `${pkg}/reflink.node`);
  }
  fs.cpSync(source, staged, { recursive: true });
  const digest = pruneOfficeRuntime(staged, { platform: 'win32', arch: 'x64' });
  const manifest = JSON.parse(fs.readFileSync(path.join(staged, 'runtime.json'), 'utf8'));
  assert.notEqual(digest, 'original-input-digest');
  assert.equal(manifest.payloadDigest, officePayloadDigest(staged, manifest));
  for (const relative of retained) assert.ok(fs.existsSync(path.join(staged, relative)), relative);
  for (const relative of excluded) {
    assert.equal(fs.existsSync(path.join(staged, relative)), false, relative);
    assert.ok(fs.existsSync(path.join(source, relative)), relative);
  }
  const reflinkRoot = path.join(staged, 'dependencies/pnpm/dist/node_modules/@reflink');
  assert.deepEqual(fs.readdirSync(reflinkRoot), ['reflink-win32-x64-msvc']);
  assert.equal(pruneOfficeRuntime(staged, { platform: 'win32', arch: 'x64' }), digest);
  writeFile(staged, `${python}/pandas/__init__.py`, 'date'); // Same length, different content.
  assert.notEqual(officePayloadDigest(staged, manifest), digest);
  assert.notEqual(officePayloadDigest(staged, { ...manifest, pnpmVersion: '11.8.0' }), digest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(source, 'runtime.json'), 'utf8')).payloadDigest, 'original-input-digest');
});
