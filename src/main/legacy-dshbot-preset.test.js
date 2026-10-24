'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DSHBOT_BEGIN, DSHBOT_END, removeLegacyDshbotPreset } = require('./legacy-dshbot-preset');
const { applyDisabledBundles, setBundleEnabled } = require('./plugins');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-legacy-detach-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profileDir = path.join(root, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  return { root, profileDir };
}

test('fresh profiles need no dshbot source and repeated cleanup is a no-op', t => {
  const { profileDir } = fixture(t);
  assert.equal(removeLegacyDshbotPreset({ profileDir }).changed, false);
  assert.equal(removeLegacyDshbotPreset({ profileDir }).changed, false);
  assert.equal(fs.existsSync(path.join(profileDir, 'node_modules')), false);
});

test('legacy cleanup detaches only the managed block and link, preserving code and data', t => {
  const { root, profileDir } = fixture(t);
  const copy = path.join(profileDir, 'desktop-plugins', 'dshbot');
  const linked = path.join(profileDir, 'node_modules', 'dshbot');
  fs.mkdirSync(copy, { recursive: true });
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.writeFileSync(path.join(copy, 'package.json'), '{"name":"dshbot"}');
  fs.symlinkSync(copy, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const patch = path.join(profileDir, 'cordis.patch.yml');
  fs.writeFileSync(patch, `${DSHBOT_BEGIN}\n- insert:\n    - id: dsh-bot\n      name: dshbot\n${DSHBOT_END}\n`);
  const preset = path.join(root, '.agent-presets', 'dshbot-room');
  fs.mkdirSync(preset, { recursive: true });
  fs.writeFileSync(path.join(preset, 'notes.txt'), 'user customization');
  fs.writeFileSync(path.join(root, 'settings.yaml'), 'dshbot: {items: [kept]}');
  const result = removeLegacyDshbotPreset({ profileDir });
  assert.equal(result.stripped, true);
  assert.equal(result.removedLink, true);
  assert.equal(fs.existsSync(linked), false);
  assert.equal(fs.readFileSync(patch, 'utf8').trim(), '[]');
  assert.equal(fs.existsSync(path.join(copy, 'package.json')), true);
  assert.equal(fs.readFileSync(path.join(preset, 'notes.txt'), 'utf8'), 'user customization');
  assert.equal(fs.readFileSync(path.join(root, 'settings.yaml'), 'utf8'), 'dshbot: {items: [kept]}');
  assert.equal(removeLegacyDshbotPreset({ profileDir }).changed, false);
});

for (const kind of ['directory', 'pnpm-link']) {
  test(`cleanup preserves a user-installed ${kind} and its manifest`, t => {
    const { profileDir } = fixture(t);
    const installed = path.join(profileDir, 'node_modules', 'dshbot');
    const target = kind === 'directory' ? installed : path.join(profileDir, 'node_modules', '.pnpm', 'dshbot', 'node_modules', 'dshbot');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), '{"name":"dshbot","version":"9.9.9"}');
    if (kind === 'pnpm-link') fs.symlinkSync(target, installed, process.platform === 'win32' ? 'junction' : 'dir');
    const manifestPath = path.join(profileDir, 'package.json');
    const manifest = JSON.stringify({ dependencies: { dshbot: 'github:owner/dshbot' }, dsh: { profile: { bundles: ['dshbot', 'other-plugin'] } } });
    fs.writeFileSync(manifestPath, manifest);
    assert.equal(removeLegacyDshbotPreset({ profileDir }).changed, false);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifest);
    assert.equal(fs.realpathSync(installed), fs.realpathSync(target));
    applyDisabledBundles(['dshbot'], { manifestPath });
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath)).dsh.profile.bundles, ['other-plugin']);
    assert.equal(fs.existsSync(path.join(installed, 'package.json')), true);
    assert.equal(setBundleEnabled('dshbot', true, { manifestPath }).ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath)).dsh.profile.bundles, ['other-plugin', 'dshbot']);
  });
}

test('retired Bots implementation and mount are absent from the desktop', () => {
  const root = path.join(__dirname, '..', '..');
  for (const file of ['vendor/dshbot', 'src/main/dshbot-desktop.js', 'src/main/dshbot-preset.js', 'scripts/export-dshbot-standalone.mjs', '.github/workflows/publish-dshbot.yml']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
  const source = fs.readFileSync(path.join(__dirname, 'harness-controller.js'), 'utf8');
  assert.doesNotMatch(source, /ensureDshbotPlugin/);
});

for (const targetExists of [true, false]) {
  test(`cleanup removes a bundled Bots link and overlay when the target is ${targetExists ? 'present' : 'gone'}`, t => {
    const { root, profileDir } = fixture(t);
    const sourceDir = path.join(root, 'resources', 'vendor', 'dshbot');
    const overlay = path.join(profileDir, 'desktop-plugins', 'dshbot', 'desktop-dshbot.patch.yml');
    const linked = path.join(profileDir, 'node_modules', 'dshbot');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    fs.mkdirSync(path.dirname(overlay), { recursive: true });
    fs.writeFileSync(overlay, '- insert:\n    - id: dsh-bot\n      name: dshbot\n');
    fs.writeFileSync(path.join(root, 'dshbot-catalog.json'), '{"items":[{"id":"kept"}]}');
    fs.mkdirSync(path.join(root, 'dshbot-memory'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dshbot-memory', 'kept.md'), 'memory');
    fs.symlinkSync(sourceDir, linked, process.platform === 'win32' ? 'junction' : 'dir');
    if (!targetExists) fs.rmdirSync(sourceDir);
    const result = removeLegacyDshbotPreset({ profileDir, sourceDir });
    assert.equal(result.removedLink, true);
    assert.equal(result.removedOverlay, true);
    assert.equal(fs.existsSync(overlay), false);
    assert.throws(() => fs.lstatSync(linked), { code: 'ENOENT' });
    assert.equal(fs.readFileSync(path.join(root, 'dshbot-catalog.json'), 'utf8'), '{"items":[{"id":"kept"}]}');
    assert.equal(fs.readFileSync(path.join(root, 'dshbot-memory', 'kept.md'), 'utf8'), 'memory');
    assert.equal(removeLegacyDshbotPreset({ profileDir, sourceDir }).changed, false);
  });
}
