'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { desktopCliArgs, resolvePnpmEntry } = require('./pnpm-runtime');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'vendor', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js');

function execute(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, log }));
  });
}

test('plain Node CLI runner is shipped outside the Electron archive', () => {
  const pkg = require('../../package.json');
  assert.ok(pkg.build.asarUnpack.includes('src/main/dsh-cli-runner.mjs'));
});

test('built dsh installs and removes an offline bundle from paths with Chinese and spaces', { timeout: 120000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pnpm-中文 路径-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runtime = path.join(dir, '软件 Whale Isle');
  fs.mkdirSync(runtime);
  const node = path.join(runtime, path.basename(process.execPath));
  fs.copyFileSync(process.execPath, node);
  if (process.platform !== 'win32') fs.chmodSync(node, 0o755);
  const realPnpm = path.join(ROOT, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
  const pnpm = path.join(runtime, 'pnpm.mjs');
  fs.writeFileSync(pnpm, `await import(${JSON.stringify(pathToFileURL(realPnpm).href)})\n`);
  const bundle = path.join(dir, '测试插件 bundle');
  fs.mkdirSync(bundle);
  const name = 'desktop-pnpm-path-probe';
  fs.writeFileSync(path.join(bundle, 'package.json'), JSON.stringify({
    name, version: '1.0.0', type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }));
  fs.writeFileSync(path.join(bundle, 'cordis.patch.yml'), '[]\n');
  const home = path.join(dir, '隔离 home');
  const profile = path.join(home, 'profiles', 'web');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dsh: { profile: { bundles: [] } },
  }));
  const env = { ...process.env, DSH_HOME: home, CI: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  // A broken pnpm on PATH must never be called by the installation-owned CLI.
  const badPnpm = path.join(runtime, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  fs.writeFileSync(badPnpm, process.platform === 'win32' ? '@exit /b 97\r\n' : '#!/bin/sh\nexit 97\n', { mode: 0o755 });
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${runtime}${path.delimiter}${path.dirname(node)}${path.delimiter}${env[pathKey] || ''}`;
  const argsFor = args => {
    const [runner, cli] = desktopCliArgs(CLI, []);
    return [runner, cli, pnpm, 'plugin', '--profile', 'web', ...args];
  };
  const addArgs = argsFor(['add', `file:${bundle}`, '--offline', '--ignore-scripts']);
  const underCodePage936 = async argv => {
    if (process.platform !== 'win32') return execute(node, argv, { env, cwd: dir });
    const probeEnv = { ...env, DSHD_PROBE_NODE: node };
    const tokens = argv.map((value, index) => {
      probeEnv[`DSHD_PROBE_ARG_${index}`] = value;
      return `"%DSHD_PROBE_ARG_${index}%"`;
    });
    return execute(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c',
      `"chcp 936 >nul & "%DSHD_PROBE_NODE%" ${tokens.join(' ')}"`], {
      env: probeEnv, cwd: dir, windowsVerbatimArguments: true,
    });
  };
  const added = await underCodePage936(addArgs);
  assert.equal(added.code, 0, added.log);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'node_modules', name, 'package.json'))).version, '1.0.0');
  const manifest = JSON.parse(fs.readFileSync(path.join(profile, 'package.json')));
  assert.ok(manifest.dsh.profile.bundles.includes(name), 'successful CLI install selects the bundle');
  const removed = await underCodePage936(argsFor(['remove', name, '--offline', '--ignore-scripts']));
  assert.equal(removed.code, 0, removed.log);
  assert.equal(fs.existsSync(path.join(profile, 'node_modules', name)), false);
  assert.ok(resolvePnpmEntry());
});
