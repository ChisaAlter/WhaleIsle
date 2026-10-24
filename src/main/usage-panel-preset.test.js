'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  USAGE_PANEL_BEGIN,
  USAGE_PANEL_END,
  USAGE_PANEL_ALIASES,
  withoutUsagePanelAliases,
  ensureDesktopUsagePanel,
  ensureUsagePanelPlugin,
} = require('./usage-panel-preset');

function writeSource(dir) {
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'dsh-usage-panel',
    version: '0.2.0',
    type: 'module',
    main: 'lib/index.js',
    exports: { '.': './lib/index.js', './client': './lib/client.js' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', inject: [] },
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const name = "dsh-usage-panel"\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: usage-stats',
    "      name: 'dsh-usage-panel'",
    '',
  ].join('\n'), 'utf8');
  return dir;
}

test('ensureUsagePanelPlugin links the bundled package and writes a desktop overlay', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const result = await ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel');
    const linked = path.join(profileDir, 'node_modules', 'dsh-usage-panel');
    assert.equal(fs.existsSync(path.join(linked, 'package.json')), true);
    // The link is a junction to the runtime: the panel's files are read from
    // the source, and the profile keeps no second copy of the bundle.
    assert.equal(fs.realpathSync(linked), fs.realpathSync(source));
    assert.equal(fs.existsSync(path.join(linked, 'lib', 'client.js')), true);
    assert.equal(fs.existsSync(path.join(dest, 'lib')), false);
    // The insert lives in the overlay; cordis.patch.yml stays user-owned
    // (never created by the desktop).
    assert.equal(result.overlayFile, path.join(dest, 'desktop-usage-panel.patch.yml'));
    const overlay = fs.readFileSync(result.overlayFile, 'utf8');
    assert.ok(overlay.includes('id: usage-stats'));
    assert.match(overlay, /name: ['"]dsh-usage-panel['"]/);
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin is the desktop built-in module and strips its aliases from a disable list', () => {
  // The deprecated alias delegates to the built-in module (wrapper, not a
  // bare reference — mirrors ensureDshImPlugin → ensureDesktopDshIm).
  assert.equal(typeof ensureUsagePanelPlugin, 'function');
  assert.equal(typeof ensureDesktopUsagePanel, 'function');
  assert.deepEqual(USAGE_PANEL_ALIASES, ['dsh-usage-panel']);
  assert.deepEqual(withoutUsagePanelAliases(['dsh-usage-panel', 'other-plugin', 'dsh-im']), ['other-plugin', 'dsh-im']);
  assert.deepEqual(withoutUsagePanelAliases([]), []);
});

test('ensureUsagePanelPlugin migrates the legacy managed block out of the user patch', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
      '- id: message-edit',
      '  disabled: true',
      '',
      USAGE_PANEL_BEGIN,
      '- insert:',
      '    - id: usage-stats',
      '      name: "dsh-usage-panel"',
      USAGE_PANEL_END,
      '',
    ].join('\n'), 'utf8');
    const result = await ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(patch.includes(USAGE_PANEL_BEGIN), false);
    assert.equal(patch.includes('id: usage-stats'), false);
    assert.ok(patch.includes('- id: message-edit'));
    assert.ok(fs.readFileSync(result.overlayFile, 'utf8').includes('id: usage-stats'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin serves runtime edits through the link on later starts', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const first = await ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    const firstOverlay = fs.readFileSync(first.overlayFile, 'utf8');
    fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'export const name = "updated"\n', 'utf8');
    const again = await ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(again.ok, true);
    assert.equal(again.added, false);
    const dest = path.join(profileDir, 'node_modules', 'dsh-usage-panel', 'lib', 'index.js');
    assert.equal(fs.readFileSync(dest, 'utf8'), 'export const name = "updated"\n');
    // Idempotent overlay: unchanged content is not rewritten differently.
    assert.equal(fs.readFileSync(again.overlayFile, 'utf8'), firstOverlay);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin does not re-create the profile link on later starts', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const srcFile = path.join(source, 'lib', 'client.js');
    const old = new Date(Date.now() - 86_400_000);
    fs.utimesSync(srcFile, old, old);
    await ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    const linked = path.join(profileDir, 'node_modules', 'dsh-usage-panel');
    const firstStat = fs.lstatSync(linked);
    // A second start must not unlink/relink an already-correct junction:
    // a re-link would move the link's ctime and briefly leave a window where
    // the package name does not resolve.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    const secondStat = fs.lstatSync(linked);
    assert.equal(secondStat.ctimeMs, firstStat.ctimeMs, 'unchanged link is not rewritten');
    assert.equal(fs.realpathSync(linked), fs.realpathSync(source));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureDesktopUsagePanel links the runtime instead of copying the bundle', () => {
  // The old copy path was fs.cpSync (4–11 s of blocked main thread), then an
  // incremental async copy whose steady state was still a ~6k-file stat walk
  // measured at ~1.1 s per start. Neither may come back.
  const source = fs.readFileSync(path.join(__dirname, 'usage-panel-preset.js'), 'utf8');
  assert.doesNotMatch(source, /\bcpSync\(/);
  assert.doesNotMatch(source, /fsp\.cp\(/);
  assert.match(source, /function linkToTarget\(/);
  assert.match(source, /linkIntoProfileModules\(sourceDir, profileDir\)/);
});

test('ensureDesktopUsagePanel always writes the overlay regardless of profile bundle state', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    // Even with a profile bundle entry, the built-in module always writes its
    // overlay — stripDroppedPlugins runs before ensureDesktopUsagePanel and
    // removes the bundle entry, so no double-mount can occur.
    fs.writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify({
      dependencies: { 'dsh-usage-panel': '0.2.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', 'dsh-usage-panel'] } },
    }, null, 2)}\n`, 'utf8');
    const result = await ensureDesktopUsagePanel({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    assert.ok(result.overlayFile);
    assert.ok(fs.readFileSync(result.overlayFile, 'utf8').includes('id: usage-stats'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin fails closed when the bundled package is missing', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-missing-'));
  try {
    const result = await ensureUsagePanelPlugin({
      sourceDir: source,
      profileDir: path.join(home, 'profiles', 'web'),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin copies bundled node_modules with the package', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const pkgFile = path.join(source, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dependencies = { zod: '4.4.3' };
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    fs.mkdirSync(path.join(source, 'node_modules', 'zod'), { recursive: true });
    fs.writeFileSync(path.join(source, 'node_modules', 'zod', 'package.json'), '{"name":"zod"}\n', 'utf8');
    const profileDir = path.join(home, 'profiles', 'web');
    const result = await ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    // Dependencies resolve through the link into the runtime tree, so the
    // profile needs no copy of node_modules either.
    const dest = path.join(profileDir, 'node_modules', 'dsh-usage-panel', 'node_modules', 'zod', 'package.json');
    assert.equal(fs.existsSync(dest), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin fails closed and strips the insert when zod is missing', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const pkgFile = path.join(source, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dependencies = { zod: '4.4.3' };
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
      USAGE_PANEL_BEGIN,
      '- insert:',
      '    - id: usage-stats',
      '      name: "dsh-usage-panel"',
      USAGE_PANEL_END,
      '',
    ].join('\n'), 'utf8');
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel', 'lib');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'index.js'), 'export const name = "kept"\n', 'utf8');
    const result = await ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source:node_modules:zod/);
    const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(patch.includes(USAGE_PANEL_BEGIN), false);
    assert.equal(patch.includes('id: usage-stats'), false);
    assert.equal(fs.readFileSync(path.join(dest, 'index.js'), 'utf8'), 'export const name = "kept"\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin fails closed when a dependency export file is missing', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const pkgFile = path.join(source, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dependencies = { zod: '4.4.3' };
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    const zodDir = path.join(source, 'node_modules', 'zod');
    fs.mkdirSync(zodDir, { recursive: true });
    fs.writeFileSync(path.join(zodDir, 'package.json'), `${JSON.stringify({
      name: 'zod',
      exports: { '.': { import: './index.js', require: './index.cjs' } },
    })}\n`, 'utf8');
    fs.writeFileSync(path.join(zodDir, 'index.js'), 'export default {}\n', 'utf8');
    const profileDir = path.join(home, 'profiles', 'web');
    const result = await ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /index\.cjs/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('repo vendors the restyled dsh-usage-panel snapshot', () => {
  const root = path.join(__dirname, '..', '..', 'vendor', 'dsh-usage-panel');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-usage-panel');
  assert.equal(pkg.version, '0.2.0');
  assert.equal(fs.existsSync(path.join(root, 'LICENSE')), true);
  assert.equal(fs.existsSync(path.join(root, 'VENDOR.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'lib', 'client.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'lib', 'index.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'cordis.patch.yml')), true);
  assert.ok(pkg.dependencies && pkg.dependencies.zod);
  const vendor = fs.readFileSync(path.join(root, 'VENDOR.md'), 'utf8');
  assert.match(vendor, /12ac109bc6213bdbca539e3199e7338fcac020ed/);
  const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
  assert.match(client, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/);
  assert.match(client, /missingPrimitives/);
  assert.doesNotMatch(client, /#4f8cff|#8b5cf6|#eef2f7|#22c55e/);
  assert.doesNotMatch(client, /data-ds-dark-theme/);
  assert.match(client, /Usage & costs/);
});

test('gitignore does not ignore usage-panel zod entry files', () => {
  const { spawnSync } = require('node:child_process');
  const root = path.join(__dirname, '..', '..');
  for (const file of ['index.js', 'index.cjs']) {
    const result = spawnSync(
      'git',
      ['check-ignore', '-q', `vendor/dsh-usage-panel/node_modules/zod/${file}`],
      { cwd: root, windowsHide: true },
    );
    assert.equal(result.status, 1, `${file} must not match the repo node_modules/ ignore`);
  }
});

test('usage-panel extraResources is nested under vendor so electron-builder keeps node_modules', () => {
  const extra = require('../../package.json').build.extraResources;
  const usage = extra.find((entry) => (
    entry
    && entry.from === 'vendor'
    && entry.to === 'vendor'
    && Array.isArray(entry.filter)
    && entry.filter.includes('dsh-usage-panel/**')
  ));
  assert.ok(usage, 'usage-panel extraResources must copy from vendor with filter dsh-usage-panel/**');
  assert.equal(extra.some((entry) => entry && entry.from === 'vendor/dsh-usage-panel'), false);
});

/** Pre-link profile bundle: a real directory that really is dsh-usage-panel. */
function writeManagedCopy(destDir) {
  fs.mkdirSync(path.join(destDir, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(destDir, 'package.json'),
    `${JSON.stringify({ name: 'dsh-usage-panel', version: '0.1.0', main: './lib/index.js' })}\n`,
  );
  fs.writeFileSync(path.join(destDir, 'lib', 'index.js'), 'module.exports = {}\n');
}

test('a stale managed copy is quarantined as a recoverable backup, not deleted', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel');
    writeManagedCopy(dest);
    const marker = path.join(dest, 'lib', 'index.js');

    const result = await ensureDesktopUsagePanel({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    // The old bundle is still on disk, byte-for-byte, under a sibling name.
    assert.equal(fs.existsSync(path.join(result.quarantinedCopy, 'lib', 'index.js')), true);
    assert.match(result.quarantinedCopy, /\.managed-backup-/);
    assert.equal(path.dirname(result.quarantinedCopy), path.dirname(dest), 'backup stays on the same volume');
    assert.equal(marker.includes('.managed-backup-'), false);
    // The live directory is now only the overlay.
    assert.equal(fs.existsSync(path.join(dest, 'lib')), false);
    assert.equal(fs.existsSync(path.join(dest, 'desktop-usage-panel.patch.yml')), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('unknown user content at the overlay path is never deleted', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel');
    fs.mkdirSync(dest, { recursive: true });
    // Not our package: a user's own directory that happens to sit at the path.
    fs.writeFileSync(path.join(dest, 'package.json'), '{"name":"someone-elses-plugin"}\n');
    fs.writeFileSync(path.join(dest, 'keep-me.txt'), 'precious\n');

    const result = await ensureDesktopUsagePanel({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /refusing to replace unknown content/);
    assert.equal(fs.readFileSync(path.join(dest, 'keep-me.txt'), 'utf8'), 'precious\n');
    assert.equal(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'), '{"name":"someone-elses-plugin"}\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('a dangling profile link is replaced without leaving the profile unresolved', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  const staleSource = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-stale-'));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const linked = path.join(profileDir, 'node_modules', 'dsh-usage-panel');
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    fs.symlinkSync(staleSource, linked, process.platform === 'win32' ? 'junction' : 'dir');
    fs.rmSync(staleSource, { recursive: true, force: true });

    const result = await ensureDesktopUsagePanel({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    assert.equal(fs.realpathSync(linked), fs.realpathSync(source));
    assert.equal(fs.existsSync(path.join(linked, 'package.json')), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(staleSource, { recursive: true, force: true });
  }
});

test('a failed link restores the quarantined copy and the previous start state', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel');
    writeManagedCopy(dest);
    // The managed destination copy is quarantined first, then the link step
    // fails because unknown user content occupies the node_modules slot.
    const linked = path.join(profileDir, 'node_modules', 'dsh-usage-panel');
    fs.mkdirSync(linked, { recursive: true });
    fs.writeFileSync(path.join(linked, 'package.json'), '{"name":"not-ours"}\n');

    await assert.rejects(
      () => ensureDesktopUsagePanel({ sourceDir: source, profileDir }),
      /refusing to replace unknown content/,
    );
    // Previous state fully restored: the quarantined bundle is back in place.
    assert.equal(fs.existsSync(path.join(dest, 'package.json')), true);
    assert.equal(fs.readFileSync(path.join(dest, 'package.json'), 'utf8').includes('dsh-usage-panel'), true);
    assert.equal(fs.existsSync(path.join(dest, 'lib', 'index.js')), true);
    assert.equal(fs.readFileSync(path.join(linked, 'package.json'), 'utf8'), '{"name":"not-ours"}\n');
    // No half-written overlay (or quarantine directory) survived the rollback.
    assert.equal(fs.existsSync(path.join(dest, 'desktop-usage-panel.patch.yml')), false);
    assert.deepEqual(
      fs.readdirSync(path.dirname(dest)).filter((name) => name.includes('.managed-backup-')),
      [],
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('profile dirs containing spaces still link, quarantine, and overlay', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh home with spaces '));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage panel src ')));
  try {
    const profileDir = path.join(home, 'profiles', 'web profile');
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel');
    writeManagedCopy(dest);

    const result = await ensureDesktopUsagePanel({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.match(result.quarantinedCopy, /\.managed-backup-/);
    assert.equal(fs.realpathSync(path.join(profileDir, 'node_modules', 'dsh-usage-panel')), fs.realpathSync(source));
    assert.ok(fs.readFileSync(result.overlayFile, 'utf8').includes('id: usage-stats'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});
