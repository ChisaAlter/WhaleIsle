'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  DSH_IM_PACKAGE,
  DSH_IM_BEGIN,
  DSH_IM_END,
  DSH_IM_INSERT_ID,
  DSH_IM_OVERLAY_FILENAME,
  dshImImplicated,
  ensureDesktopDshIm,
} = require('./dsh-im-desktop');

function makeSource(root) {
  const dir = path.join(root, 'source');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: DSH_IM_PACKAGE,
    version: '3.0.1',
    main: './lib/index.js',
    exports: { '.': './lib/index.js', './client': './lib/client.js' },
    dependencies: {},
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const name = "@xmanrui/dsh-im"\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), 'export function apply() {}\n', 'utf8');
  return dir;
}

function overlayPath(profileDir) {
  return path.join(profileDir, 'desktop-plugins', 'dsh-im', DSH_IM_OVERLAY_FILENAME);
}

test('ensureDesktopDshIm writes the desktop overlay and junctions node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-im-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    // Legacy soft-preset residue must be removed.
    const legacy = path.join(profileDir, 'desktop-plugins', '@xmanrui', 'dsh-im');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'package.json'), '{"name":"stale"}\n', 'utf8');

    const result = ensureDesktopDshIm({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    assert.equal(result.href, pathToFileURL(source).href);
    assert.equal(result.overlayFile, overlayPath(profileDir));
    assert.equal(fs.existsSync(legacy), false);

    const linked = path.join(profileDir, 'node_modules', '@xmanrui', 'dsh-im');
    assert.equal(fs.existsSync(path.join(linked, 'package.json')), true);
    assert.equal(
      fs.readFileSync(path.join(linked, 'lib', 'index.js'), 'utf8'),
      'export const name = "@xmanrui/dsh-im"\n',
    );

    const overlay = fs.readFileSync(result.overlayFile, 'utf8');
    assert.match(overlay, new RegExp(`id: ${DSH_IM_INSERT_ID}`));
    assert.match(overlay, /@xmanrui\/dsh-im/);
    assert.doesNotMatch(overlay, /file:\/\//);

    // The user-owned cordis.patch.yml is never written.
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false);

    const again = ensureDesktopDshIm({ sourceDir: source, profileDir });
    assert.equal(again.ok, true);
    assert.equal(again.added, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshIm migrates the legacy managed block out of cordis.patch.yml', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-im-mig-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    fs.writeFileSync(patchFile, [
      '- insert:',
      '    - id: user-canary-row',
      '      name: "user-canary-row"',
      DSH_IM_BEGIN,
      '- insert:',
      `    - id: ${DSH_IM_INSERT_ID}`,
      `      name: ${JSON.stringify(DSH_IM_PACKAGE)}`,
      DSH_IM_END,
      '',
    ].join('\n'), 'utf8');

    const result = ensureDesktopDshIm({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.patchChanged, true);
    const patch = fs.readFileSync(patchFile, 'utf8');
    assert.doesNotMatch(patch, new RegExp(DSH_IM_BEGIN));
    assert.doesNotMatch(patch, new RegExp(DSH_IM_INSERT_ID));
    assert.match(patch, /user-canary-row/);
    assert.equal(fs.existsSync(result.overlayFile), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshIm normalizes a comments-only cordis.patch.yml back to []', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-im-norm-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    fs.writeFileSync(patchFile, [
      '# user comment header',
      DSH_IM_BEGIN,
      '- insert:',
      `    - id: ${DSH_IM_INSERT_ID}`,
      `      name: ${JSON.stringify(DSH_IM_PACKAGE)}`,
      DSH_IM_END,
      '',
    ].join('\n'), 'utf8');

    const result = ensureDesktopDshIm({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    const patch = fs.readFileSync(patchFile, 'utf8');
    assert.doesNotMatch(patch, new RegExp(DSH_IM_BEGIN));
    assert.match(patch, /\[\]\s*$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshIm fails closed when the bundled package is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-im-miss-'));
  try {
    const profileDir = path.join(root, 'profile');
    const result = ensureDesktopDshIm({
      sourceDir: path.join(root, 'missing'),
      profileDir,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshIm fails closed on incomplete node_modules (start must fail)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-im-deps-'));
  try {
    const source = path.join(root, 'source');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
      name: DSH_IM_PACKAGE,
      version: '3.0.1',
      main: './lib/index.js',
      dependencies: { 'missing-dep-xyz': '1.0.0' },
    }), 'utf8');
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const result = ensureDesktopDshIm({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source:node_modules/);
    // No overlay is produced on failure (the controller fails the start and
    // never passes a stale overlay path).
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshIm ignores the disable list (desktop built-in)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-im-on-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    const result = ensureDesktopDshIm({
      sourceDir: source,
      profileDir,
      disabledPlugins: [DSH_IM_PACKAGE, 'dsh-im'],
    });
    assert.equal(result.ok, true);
    assert.equal(result.disabled, undefined);
    assert.equal(fs.existsSync(overlayPath(profileDir)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshIm enabled:false drops the overlay and keeps the junction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-im-off-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    const first = ensureDesktopDshIm({ sourceDir: source, profileDir });
    assert.equal(first.ok, true);
    const linked = path.join(profileDir, 'node_modules', '@xmanrui', 'dsh-im');
    assert.equal(fs.existsSync(overlayPath(profileDir)), true);

    const off = ensureDesktopDshIm({ sourceDir: source, profileDir, enabled: false });
    assert.equal(off.ok, true);
    assert.equal(off.disabled, true);
    assert.equal(off.overlayFile, undefined);
    // The overlay file is gone so no start can compose it; the existing
    // junction and user data are preserved.
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
    assert.equal(fs.existsSync(linked), true);

    const again = ensureDesktopDshIm({ sourceDir: source, profileDir });
    assert.equal(again.ok, true);
    assert.equal(fs.existsSync(overlayPath(profileDir)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshIm enabled:false strips the managed block without vendor checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-im-off-mig-'));
  try {
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    fs.writeFileSync(patchFile, [
      '- insert:',
      '    - id: user-canary-row',
      '      name: "user-canary-row"',
      DSH_IM_BEGIN,
      '- insert:',
      `    - id: ${DSH_IM_INSERT_ID}`,
      `      name: ${JSON.stringify(DSH_IM_PACKAGE)}`,
      DSH_IM_END,
      '',
    ].join('\n'), 'utf8');
    // The vendor tree is absent entirely; disabling must not fail on it and
    // must create neither junction nor overlay.
    const result = ensureDesktopDshIm({
      sourceDir: path.join(root, 'missing'),
      profileDir,
      enabled: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.disabled, true);
    assert.equal(result.patchChanged, true);
    const patch = fs.readFileSync(patchFile, 'utf8');
    assert.doesNotMatch(patch, new RegExp(DSH_IM_BEGIN));
    assert.match(patch, /user-canary-row/);
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
    assert.equal(fs.existsSync(path.join(profileDir, 'node_modules', '@xmanrui', 'dsh-im')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dshImImplicated matches dsh-im names and paths in failure evidence', () => {
  assert.equal(dshImImplicated('failed to apply loader entry xmanrui-dsh-im (@xmanrui/dsh-im)'), true);
  assert.equal(dshImImplicated(
    'web boot: 1 entry did not activate\nxmanrui-dsh-im: import failed (see console for the import error)',
  ), true);
  assert.equal(dshImImplicated(
    "err_module_not_found: Cannot find module 'file:///profile/desktop-plugins/dsh-im/desktop-dsh-im.patch.yml'",
  ), true);
  assert.equal(dshImImplicated("cannot find package 'some-user-plugin'"), false);
  assert.equal(dshImImplicated(''), false);
  assert.equal(dshImImplicated(undefined), false);
});
