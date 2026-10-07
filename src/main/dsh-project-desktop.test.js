'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ensureDesktopDshProject, projectPeerDirectories } = require('./dsh-project-desktop');

function fixture(t, peers = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-project-mount-'));
  t.after(() => {
    assert.ok(path.resolve(folder).startsWith(path.join(os.tmpdir(), 'whale-project-mount-')));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const sourceDir = path.join(folder, 'vendor', 'dsh-project'), profileDir = path.join(folder, 'web');
  fs.mkdirSync(path.join(sourceDir, 'lib'), { recursive: true }); fs.mkdirSync(profileDir);
  fs.writeFileSync(path.join(sourceDir, 'package.json'), JSON.stringify({ name: 'dsh-project', type: 'module', main: 'lib/index.js', peerDependencies: peers }));
  fs.writeFileSync(path.join(sourceDir, 'lib', 'index.js'), 'export const project = true;\n');
  return { folder, sourceDir, profileDir };
}

test('optional Project mount preserves user Team settings and data across disable and recovery', async t => {
  const { sourceDir, profileDir } = fixture(t);
  const userPatch = '# user-owned\n- id: custom\n  disabled: true\n- id: agent-team\n  disabled: true\n';
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), userPatch);
  const first = await ensureDesktopDshProject({ sourceDir, profileDir });
  assert.equal(first.ok, true);
  assert.equal(fs.realpathSync(path.join(profileDir, 'node_modules', 'dsh-project')), fs.realpathSync(first.runtimeDir));
  assert.equal(fs.existsSync(path.join(sourceDir, 'node_modules')), false);
  assert.equal((fs.readFileSync(first.overlayFile, 'utf8').match(/name: "dsh-project"/g) || []).length, 1);
  assert.doesNotMatch(fs.readFileSync(first.overlayFile, 'utf8'), /agent-team|disabled: false/);
  const data = path.join(profileDir, 'projects', 'existing'); fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'notes.md'), 'user material');
  for (const option of [{ enabled: false }, { skipUserPlugins: true }]) {
    await ensureDesktopDshProject({ sourceDir, profileDir });
    const omitted = await ensureDesktopDshProject({ sourceDir, profileDir, ...option });
    assert.equal(omitted.disabled, true);
    assert.equal(fs.existsSync(first.overlayFile), false);
    assert.equal(fs.readFileSync(path.join(data, 'notes.md'), 'utf8'), 'user material');
    assert.equal(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'), userPatch);
  }
  const recovered = await ensureDesktopDshProject({ sourceDir, profileDir });
  assert.equal(recovered.runtimeDir, first.runtimeDir);
  assert.equal(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'), userPatch);
});

test('private profile runtime resolves peers from real CLI and isolated bundle dependency positions', async t => {
  const { folder, sourceDir, profileDir } = fixture(t, { '@deepseek-ai/dsh-storage-domain': '*', zod: '*' });
  const harnessRoot = path.join(folder, 'harness'), cli = path.join(harnessRoot, 'apps', 'cli');
  const packageAt = (dir, name, body = 'export const identity = {};') => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(dir, 'index.js'), body);
  };
  packageAt(cli, '@deepseek-ai/dsh');
  const base = path.join(cli, 'node_modules', '@deepseek-ai', 'dsh-base'); packageAt(base, '@deepseek-ai/dsh-base');
  const storage = path.join(base, 'node_modules', '@deepseek-ai', 'dsh-storage-domain'); packageAt(storage, '@deepseek-ai/dsh-storage-domain');
  const zod = path.join(storage, 'node_modules', 'zod'); packageAt(zod, 'zod');
  fs.writeFileSync(path.join(sourceDir, 'lib', 'index.js'), "export { identity as storage } from '@deepseek-ai/dsh-storage-domain'; export { identity as schema } from 'zod';");
  const mounted = await ensureDesktopDshProject({ sourceDir, profileDir, harnessRoot });
  const loaded = await import(pathToFileURL(path.join(mounted.runtimeDir, 'lib', 'index.js')).href);
  assert.equal(loaded.storage, (await import(pathToFileURL(path.join(storage, 'index.js')).href)).identity);
  assert.equal(loaded.schema, (await import(pathToFileURL(path.join(zod, 'index.js')).href)).identity);
  assert.equal(fs.existsSync(path.join(sourceDir, 'node_modules')), false);
  assert.throws(() => projectPeerDirectories(harnessRoot, { peerDependencies: { missing: '*' } }), /peers unavailable/);
});

test('packaged flat Harness anchors also mount peers into a writable profile without copying Core', async t => {
  const { folder, sourceDir, profileDir } = fixture(t, { '@deepseek-ai/schemastery': '*', zod: '*' });
  const harnessRoot = path.join(folder, 'resources', 'vendor', 'deepseek-harness');
  fs.mkdirSync(path.join(harnessRoot, 'apps', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(harnessRoot, 'apps', 'cli', 'package.json'), '{}');
  for (const name of ['@deepseek-ai/schemastery', 'zod']) {
    const peer = path.join(harnessRoot, 'node_modules', name); fs.mkdirSync(peer, { recursive: true });
    fs.writeFileSync(path.join(peer, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(peer, 'index.js'), 'export const identity = {};');
  }
  fs.writeFileSync(path.join(sourceDir, 'lib', 'index.js'), "export { identity } from '@deepseek-ai/schemastery';");
  const mounted = await ensureDesktopDshProject({ sourceDir, profileDir, harnessRoot });
  const loaded = await import(pathToFileURL(path.join(mounted.runtimeDir, 'lib', 'index.js')).href);
  const original = path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'schemastery', 'index.js');
  assert.equal(loaded.identity, (await import(pathToFileURL(original).href)).identity);
  assert.equal(fs.lstatSync(path.join(mounted.runtimeDir, 'node_modules', 'zod')).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(sourceDir, 'node_modules')), false);
});

test('mount refuses unknown package data and linked runtime files without modifying their targets', async t => {
  const { folder, sourceDir, profileDir } = fixture(t);
  const first = await ensureDesktopDshProject({ sourceDir, profileDir });
  const external = path.join(folder, 'user.txt'); fs.writeFileSync(external, 'preserve');
  const file = path.join(first.runtimeDir, 'lib', 'index.js'); fs.unlinkSync(file);
  if (process.platform === 'win32') {
    const escaped = path.join(first.runtimeDir, 'lib'); fs.rmdirSync(escaped);
    const outside = path.join(folder, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'index.js'), 'preserve');
    fs.symlinkSync(outside, escaped, 'junction');
    await assert.rejects(ensureDesktopDshProject({ sourceDir, profileDir }), /target was replaced/);
    assert.equal(fs.readFileSync(path.join(outside, 'index.js'), 'utf8'), 'preserve');
    fs.unlinkSync(escaped);
  } else {
    fs.symlinkSync(external, file);
    await assert.rejects(ensureDesktopDshProject({ sourceDir, profileDir }), /target was replaced/);
    fs.unlinkSync(file);
  }
  assert.equal(fs.readFileSync(external, 'utf8'), 'preserve');
  fs.unlinkSync(path.join(profileDir, 'node_modules', 'dsh-project'));
  const unknown = path.join(profileDir, 'node_modules', 'dsh-project'); fs.mkdirSync(unknown);
  fs.writeFileSync(path.join(unknown, 'sentinel'), 'keep');
  await assert.rejects(ensureDesktopDshProject({ sourceDir, profileDir }), /unknown content/);
  assert.equal(fs.readFileSync(path.join(unknown, 'sentinel'), 'utf8'), 'keep');
});
