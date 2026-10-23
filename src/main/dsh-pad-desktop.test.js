'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureDesktopDshPad, DSH_PAD_RUNTIME_ALIAS } = require('./dsh-pad-desktop');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-pad-mount-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'whale-pad-mount-')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const sourceDir = path.join(root, 'vendor', 'dsh-pad');
  const profileDir = path.join(root, 'home', 'profiles', 'web');
  fs.mkdirSync(path.join(sourceDir, 'lib'), { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'package.json'), JSON.stringify({ name: 'dsh-pad', type: 'module',
    exports: { '.': './lib/index.js', './client': './lib/client.js' } }));
  fs.writeFileSync(path.join(sourceDir, 'lib', 'index.js'), 'export function apply() {}\n');
  fs.writeFileSync(path.join(sourceDir, 'lib', 'client.js'), 'export function apply() {}\n');
  fs.writeFileSync(path.join(sourceDir, 'cordis.patch.yml'), '- insert:\n    - id: dsh-pad\n      name: dsh-pad\n');
  return { root, sourceDir, profileDir };
}

test('pad mount is persistent, uses the shipped runtime, and preserves user patch and panel data', t => {
  const { root, sourceDir, profileDir } = fixture(t);
  const userPatch = '# user preferences\n- id: custom\n  disabled: true\n';
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), userPatch);
  const data = path.join(root, 'home', 'dsh-pad', 'panels.json');
  fs.mkdirSync(path.dirname(data), { recursive: true });
  fs.writeFileSync(data, '{"panels":[{"id":"existing"}]}');
  const first = ensureDesktopDshPad({ sourceDir, profileDir });
  assert.equal(first.ok, true);
  assert.equal(first.added, true);
  assert.equal(fs.realpathSync(path.join(profileDir, 'node_modules', DSH_PAD_RUNTIME_ALIAS)), fs.realpathSync(sourceDir));
  assert.equal(fs.existsSync(path.join(sourceDir, 'node_modules')), false);
  const overlay = fs.readFileSync(first.overlayFile, 'utf8');
  assert.equal(overlay.split('- id: dsh-pad').length - 1, 1);
  assert.ok(overlay.includes(JSON.stringify(require('node:url').pathToFileURL(path.join(sourceDir, 'lib', 'index.js')).href)));
  assert.match(overlay, /updateCheck: false/);
  assert.doesNotMatch(overlay, /autoApprove/);
  const before = fs.statSync(first.overlayFile).mtimeMs;
  assert.equal(ensureDesktopDshPad({ sourceDir, profileDir }).added, false);
  assert.equal(fs.statSync(first.overlayFile).mtimeMs, before);
  assert.equal(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'), userPatch);
  assert.equal(fs.readFileSync(data, 'utf8'), '{"panels":[{"id":"existing"}]}');
});

test('missing host or client bundles and invalid package identity prevent default mount', t => {
  for (const name of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
    const { sourceDir, profileDir } = fixture(t);
    fs.unlinkSync(path.join(sourceDir, name));
    const result = ensureDesktopDshPad({ sourceDir, profileDir });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes(name));
    assert.equal(fs.existsSync(path.join(profileDir, 'desktop-plugins')), false);
  }
  const { sourceDir, profileDir } = fixture(t);
  fs.writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"unrelated"}');
  assert.match(ensureDesktopDshPad({ sourceDir, profileDir }).error, /package.json:name/);
});

test('existing user bundle and custom configuration are untouched while recovery uses a separate runtime', t => {
  const { root, sourceDir, profileDir } = fixture(t);
  const profileFile = path.join(profileDir, 'package.json');
  const profile = JSON.stringify({ dependencies: { 'dsh-pad': 'link:/user/pad' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-pad'] } } });
  const patch = '- id: dsh-pad\n  config:\n    dataFile: /user/custom-panels.json\n    agentRefresh: false\n    minIntervalSec: 30\n';
  fs.writeFileSync(profileFile, profile);
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), patch);
  const target = path.join(profileDir, 'node_modules', 'dsh-pad');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'sentinel.txt'), 'user installation');
  const normal = ensureDesktopDshPad({ sourceDir, profileDir });
  assert.equal(normal.userProvided, true);
  assert.equal(normal.overlayFile, undefined);
  const recovery = ensureDesktopDshPad({ sourceDir, profileDir, skipUserPlugins: true });
  assert.equal(recovery.ok, true);
  assert.ok(recovery.overlayFile);
  assert.equal(fs.readFileSync(profileFile, 'utf8'), profile);
  assert.equal(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'), patch);
  assert.equal(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 'user installation');
  const localSource = path.join(root, 'local-source'); fs.mkdirSync(localSource);
  fs.unlinkSync(path.join(target, 'sentinel.txt')); fs.rmdirSync(target);
  fs.symlinkSync(localSource, target, process.platform === 'win32' ? 'junction' : 'dir');
  ensureDesktopDshPad({ sourceDir, profileDir, skipUserPlugins: true });
  assert.equal(fs.realpathSync(target), fs.realpathSync(localSource));
});

test('explicit user disable prevents re-enabling the default pad', t => {
  const { sourceDir, profileDir } = fixture(t);
  assert.equal(ensureDesktopDshPad({ sourceDir, profileDir, disabledPlugins: ['dsh-pad'] }).disabled, true);
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ dependencies: { 'dsh-pad': '1.0.0' }, dsh: { profile: { bundles: [] } } }));
  assert.equal(ensureDesktopDshPad({ sourceDir, profileDir }).disabled, true);
  assert.equal(fs.existsSync(path.join(profileDir, 'desktop-plugins')), false);
});

test('vendored pad runtime and license are included in desktop resources', () => {
  const root = path.join(__dirname, '..', '..');
  const sourceDir = path.join(root, 'vendor', 'dsh-pad');
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.3.1');
  assert.ok(manifest.peerDependencies['@deepseek-ai/dsh-tools']);
  assert.ok(manifest.peerDependencies['@deepseek-ai/dsh-llm']);
  assert.equal(fs.existsSync(path.join(sourceDir, 'LICENSE')), true);
  const { assertVendoredPluginRuntimeDeps } = require('../../scripts/after-pack');
  assert.doesNotThrow(() => assertVendoredPluginRuntimeDeps(root, 'dsh-pad'));
  const desktop = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(desktop.build.extraResources.find(resource => resource.from === 'vendor').filter.includes('dsh-pad/**'));
});
