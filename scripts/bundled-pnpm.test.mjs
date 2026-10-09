import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { copyBundledPnpm } = require('./after-pack');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('installed and packaged pnpm run the locked CLI and host build scripts offline', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-pnpm '));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.pnpm;
  const env = { ...process.env, COREPACK_ENABLE_NETWORK: '0',
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
  const run = (entry, args) => {
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd: temp, env, encoding: 'utf8', shell: false, windowsHide: true,
    });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const sourceEntry = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
  assert.equal(run(sourceEntry, ['--version']), version);
  const resources = path.join(temp, 'resources');
  const packaged = copyBundledPnpm(root, resources, { platform: process.platform, arch: process.arch });
  const packagedEntry = path.join(packaged, 'bin', 'pnpm.mjs');
  assert.equal(run(packagedEntry, ['--version']), version);
  assert.ok(fs.existsSync(path.join(packaged, 'native-binary.mjs')));
  assert.ok(fs.existsSync(path.join(packaged, 'THIRD-PARTY-NOTICES.md')));
  assert.match(fs.readFileSync(path.join(packaged, 'LICENSE'), 'utf8'), /Permission is hereby granted/);
  assert.ok(fs.existsSync(path.join(packaged, 'dist', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')));
  assert.equal(fs.existsSync(path.join(packaged, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(packaged, 'pnpm.exe')), false);
  const consumer = path.join(temp, 'host build consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true,
    scripts: { 'build:official': 'node probe.cjs' } }));
  fs.writeFileSync(path.join(consumer, 'probe.cjs'), 'console.log("host-build-consumer-ok")');
  for (const entry of [sourceEntry, packagedEntry]) {
    assert.match(run(entry, ['--dir', consumer, 'run', 'build:official']), /host-build-consumer-ok/);
  }
});

test('marketplace uses its generated shim with source and packaged pnpm without a system pnpm', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-market-pnpm '));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const resources = path.join(temp, 'resources');
  copyBundledPnpm(root, resources, { platform: process.platform, arch: process.arch });
  const harness = path.join(temp, 'harness');
  const cli = path.join(harness, 'apps', 'cli', 'lib', 'bin.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  // The real public marketplace path must supply pnpm to the spawned CLI.
  fs.writeFileSync(cli, `const { spawnSync } = require('child_process');
const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--version'],
  { shell: process.platform === 'win32', encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status ?? 1);`);
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  Object.assign(baseEnv, { PATH: path.dirname(process.execPath), COREPACK_ENABLE_NETWORK: '0', DSHD_HOME: temp });
  const { setDesktopDshHome, clearDesktopDshHome } = require('../src/shared/dsh-home');
  setDesktopDshHome(temp);
  t.after(clearDesktopDshHome);
  const { childSpawnEnv } = require('../src/shared/child-spawn-env');
  const source = fs.readFileSync(path.join(root, 'src', 'main', 'marketplace-install.js'), 'utf8');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.pnpm;
  for (const packaged of [false, true]) {
    const userData = path.join(temp, packaged ? 'packaged user' : 'source user');
    const dependencies = {
      electron: { app: { getPath: () => userData } },
      './config': { loadConfig: () => ({}) },
      './dsh': { resolveNodeBin: () => process.execPath, sourceHarnessStatus: () => ({}) },
      './paths': { projectRoot: () => packaged ? temp : root, harnessRoot: () => harness },
      './plugins': { PROFILE: 'web' },
      './marketplace-allowbuilds': require('../src/main/marketplace-allowbuilds'),
      '../shared/child-spawn-env': { childSpawnEnv: (config, options) => childSpawnEnv(config, { ...options, baseEnv }) },
    };
    const module = { exports: {} };
    vm.runInNewContext(source, { module, process: { platform: process.platform, env: baseEnv,
      resourcesPath: packaged ? resources : path.join(temp, 'empty resources') },
      require: name => ['fs', 'os', 'path', 'child_process'].includes(name) ? require(name) : dependencies[name] || {},
    }, { filename: 'marketplace-install.js' });
    const result = await module.exports.runPlugin(['add', 'fixture']);
    assert.equal(result.ok, true, result.log);
    assert.match(result.log, new RegExp(version.replaceAll('.', '\\.')));
    const shim = path.join(userData, 'bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
    assert.match(fs.readFileSync(shim, 'utf8'), /pnpm\.mjs/);
  }
});

test('packaging refuses a native executable from a different pnpm version', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-pnpm-version-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'node_modules', 'pnpm');
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(source, 'bin', 'pnpm.mjs'), '');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'pnpm', version: '12.3.4' }));
  const native = path.join(temp, 'node_modules', '@pnpm', 'exe.win32-x64');
  fs.mkdirSync(native, { recursive: true });
  fs.writeFileSync(path.join(native, 'package.json'), JSON.stringify({ version: '12.3.3' }));
  assert.throws(() => copyBundledPnpm(temp, path.join(temp, 'resources'), { platform: 'win32', arch: 'x64' }),
    /pnpm 原生运行时版本不一致/);
});
