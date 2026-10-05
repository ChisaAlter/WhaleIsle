import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const project = fileURLToPath(new URL('..', import.meta.url));
const tar = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-install-harness-'));
  t.after(() => {
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'whale-install-harness-')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const stage = path.join(root, 'stage');
  const final = path.join(root, 'final');
  const resources = path.join(stage, 'resources');
  const finalResources = path.join(final, 'resources');
  const helper = path.join(resources, 'runtime', 'install-harness.cjs');
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  for (const [source, name] of [
    ['scripts/install-harness.cjs', 'install-harness.cjs'],
    ['src/shared/runtime-links.js', 'runtime-links.js'],
    ['src/shared/harness-runtime-identity.js', 'harness-runtime-identity.js'],
  ]) fs.copyFileSync(path.join(project, source), path.join(path.dirname(helper), name));
  const source = path.join(root, 'source');
  const write = (name, content) => {
    const file = path.join(source, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write('apps/cli/lib/bin.js', 'console.log("fixture CLI")');
  write('apps/web/dist/index.html', '<!doctype html><title>Fixture</title>');
  for (const name of ['a', 'b']) write(`packages/${name}/package.json`, JSON.stringify({ name, main: 'index.js' }));
  write('packages/a/index.js', 'exports.token = {}; exports.b = require("b");');
  write('packages/b/index.js', 'exports.a = require("a");');
  const links = [
    { path: 'node_modules/a', target: 'packages/a' },
    { path: 'node_modules/b', target: 'packages/b' },
    { path: 'packages/a/node_modules/b', target: 'packages/b' },
    { path: 'packages/b/node_modules/a', target: 'packages/a' },
  ];
  write('.dsh-runtime-links.json', JSON.stringify({ version: 1, links }));
  const archive = path.join(resources, 'vendor', 'deepseek-harness.tar');
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  execFileSync(tar, ['-cf', archive, '-C', source, '.'], { windowsHide: true });
  const bytes = fs.readFileSync(archive);
  const identity = path.join(path.dirname(archive), 'deepseek-harness-runtime.json');
  fs.writeFileSync(identity, JSON.stringify({ version: 1, archiveBytes: bytes.length,
    archiveSha256: createHash('sha256').update(bytes).digest('hex') }));
  const run = () => spawnSync(process.execPath, [helper, resources, finalResources],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  return { stage, final, resources, finalResources, archive, identity, links, run };
}

test('bundled install helper prepares final-location links and preserves cyclic module identity after promotion', t => {
  const { stage, final, resources, finalResources, archive, links, run } = fixture(t);
  const result = run();
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(archive), false);
  const runtime = path.join(resources, 'vendor', 'deepseek-harness');
  const installedRuntime = path.join(finalResources, 'vendor', 'deepseek-harness');
  for (const link of links) {
    const from = path.join(runtime, link.path);
    assert.ok(fs.lstatSync(from).isSymbolicLink());
    const target = path.resolve(path.dirname(from), fs.readlinkSync(from));
    assert.equal(path.toNamespacedPath(target), path.toNamespacedPath(path.join(installedRuntime, link.target)));
  }
  fs.renameSync(stage, final);
  const require = createRequire(path.join(installedRuntime, 'package.json'));
  const a = require('a');
  const b = require('b');
  assert.strictEqual(a.b, b);
  assert.strictEqual(b.a, a);
  assert.strictEqual(require(path.join(installedRuntime, 'packages/a')), a);
  assert.strictEqual(fs.realpathSync(path.join(installedRuntime, 'node_modules/a')),
    fs.realpathSync(path.join(installedRuntime, 'packages/a')));
});

test('archive hash mismatch fails before extraction and leaves the existing installation untouched', t => {
  const { resources, finalResources, archive, identity, run } = fixture(t);
  const oldFile = path.join(finalResources, 'vendor', 'deepseek-harness', 'old.txt');
  fs.mkdirSync(path.dirname(oldFile), { recursive: true });
  fs.writeFileSync(oldFile, 'old installed runtime');
  const manifest = JSON.parse(fs.readFileSync(identity, 'utf8'));
  manifest.archiveSha256 = '0'.repeat(64);
  fs.writeFileSync(identity, JSON.stringify(manifest));
  const result = run();
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Harness runtime archive verification failed/);
  assert.equal(fs.existsSync(path.join(resources, 'vendor', 'deepseek-harness')), false);
  assert.ok(fs.existsSync(archive));
  assert.equal(fs.readFileSync(oldFile, 'utf8'), 'old installed runtime');
});
