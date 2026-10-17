'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  DSH_WHALE_PACKAGE,
  DSH_WHALE_ALIASES,
  DSH_WHALE_INSERT_ID,
  DSH_WHALE_OVERLAY_FILENAME,
  DSH_WHALE_BEGIN,
  DSH_WHALE_END,
  withoutDshWhaleAliases,
  ensureDesktopDshWhale,
} = require('./dsh-whale-desktop');

function makeSource(root) {
  const dir = path.join(root, 'source');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'client'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'presets', 'whale-girl'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: DSH_WHALE_PACKAGE,
    version: '0.1.0',
    type: 'module',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './tools': './lib/tools.js',
      './client': './client/client.js',
      './cordis.patch.yml': './cordis.patch.yml',
    },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const name = "dsh-whale"\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'tools.js'), 'export const name = "dsh-whale-tools"\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'client', 'client.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(
    path.join(dir, 'cordis.patch.yml'),
    `- insert:\n    - id: ${DSH_WHALE_INSERT_ID}\n      name: "dsh-whale"\n`,
    'utf8',
  );
  return dir;
}

function overlayPath(profileDir) {
  return path.join(profileDir, 'desktop-plugins', 'dsh-whale', DSH_WHALE_OVERLAY_FILENAME);
}

test('ensureDesktopDshWhale writes the desktop overlay and junctions node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-whale-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    // A stale desktop-plugins copy must be reclaimed before the overlay is
    // written — the Loader must never prefer it over vendor/dsh-whale.
    const legacyCopy = path.join(profileDir, 'desktop-plugins', 'dsh-whale');
    fs.mkdirSync(legacyCopy, { recursive: true });
    fs.writeFileSync(path.join(legacyCopy, 'package.json'), '{"name":"stale"}\n', 'utf8');
    fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
    fs.symlinkSync(legacyCopy, path.join(profileDir, 'node_modules', 'dsh-whale'), 'junction');

    const result = ensureDesktopDshWhale({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    assert.equal(result.href, pathToFileURL(source).href);
    assert.equal(result.overlayFile, overlayPath(profileDir));

    const linked = path.join(profileDir, 'node_modules', 'dsh-whale');
    assert.equal(fs.existsSync(path.join(linked, 'package.json')), true);
    assert.equal(
      fs.readFileSync(path.join(linked, 'lib', 'index.js'), 'utf8'),
      'export const name = "dsh-whale"\n',
    );
    // The junction resolves to vendor, never to the stale desktop-plugins copy.
    assert.equal(fs.realpathSync(linked), fs.realpathSync(source));
    // The desktop-plugins dir holds only the overlay now.
    assert.deepEqual(fs.readdirSync(legacyCopy), [DSH_WHALE_OVERLAY_FILENAME]);

    const overlay = fs.readFileSync(result.overlayFile, 'utf8');
    assert.match(overlay, new RegExp(`id: ${DSH_WHALE_INSERT_ID}`));
    assert.match(overlay, /name: "dsh-whale"/);
    assert.doesNotMatch(overlay, /file:\/\//);

    // The user-owned cordis.patch.yml is never written.
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false);

    const again = ensureDesktopDshWhale({ sourceDir: source, profileDir });
    assert.equal(again.ok, true);
    assert.equal(again.added, false);
    // Idempotent: the shared overlay dir is reclaimed before each rewrite,
    // so a second run must still leave the overlay on disk.
    assert.equal(fs.existsSync(again.overlayFile), true);
    assert.match(fs.readFileSync(again.overlayFile, 'utf8'), new RegExp(`id: ${DSH_WHALE_INSERT_ID}`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshWhale migrates a legacy managed block out of cordis.patch.yml', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-whale-mig-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    fs.writeFileSync(patchFile, [
      '- insert:',
      '    - id: user-canary-row',
      '      name: "user-canary-row"',
      DSH_WHALE_BEGIN,
      '- insert:',
      `    - id: ${DSH_WHALE_INSERT_ID}`,
      `      name: ${JSON.stringify(DSH_WHALE_PACKAGE)}`,
      DSH_WHALE_END,
      '',
    ].join('\n'), 'utf8');

    const result = ensureDesktopDshWhale({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.patchChanged, true);
    const patch = fs.readFileSync(patchFile, 'utf8');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(patch, new RegExp(esc(DSH_WHALE_BEGIN)));
    assert.doesNotMatch(patch, new RegExp(DSH_WHALE_INSERT_ID));
    assert.match(patch, /user-canary-row/);
    assert.equal(fs.existsSync(result.overlayFile), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshWhale with enabled:false drops the overlay and skips vendor checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-whale-off-'));
  try {
    const profileDir = path.join(root, 'profile');
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    fs.mkdirSync(profileDir, { recursive: true });
    // A stale managed block must still be stripped while disabled.
    fs.writeFileSync(patchFile, [
      '- insert:',
      '    - id: user-canary-row',
      '      name: "user-canary-row"',
      DSH_WHALE_BEGIN,
      '- insert:',
      `    - id: ${DSH_WHALE_INSERT_ID}`,
      `      name: ${JSON.stringify(DSH_WHALE_PACKAGE)}`,
      DSH_WHALE_END,
      '',
    ].join('\n'), 'utf8');
    // A previously written overlay must be removed.
    const overlay = overlayPath(profileDir);
    fs.mkdirSync(path.dirname(overlay), { recursive: true });
    fs.writeFileSync(overlay, '- insert:\n    - id: dsh-whale\n      name: "dsh-whale"\n', 'utf8');

    // No vendor source at all — disabled ensure must not fail on it.
    const result = ensureDesktopDshWhale({
      sourceDir: path.join(root, 'missing'),
      profileDir,
      enabled: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.added, false);
    assert.equal(result.disabled, true);
    assert.equal(result.overlayFile, undefined);
    assert.equal(result.patchChanged, true);
    assert.equal(fs.existsSync(overlay), false);
    const patch = fs.readFileSync(patchFile, 'utf8');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(patch, new RegExp(esc(DSH_WHALE_BEGIN)));
    assert.match(patch, /user-canary-row/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshWhale fails closed when the bundled package is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-whale-miss-'));
  try {
    const profileDir = path.join(root, 'profile');
    const result = ensureDesktopDshWhale({
      sourceDir: path.join(root, 'missing'),
      profileDir,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshWhale fails closed on missing declared entries (start must fail)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-whale-entries-'));
  try {
    const source = path.join(root, 'source');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
      name: DSH_WHALE_PACKAGE,
      version: '0.1.0',
      type: 'module',
      main: './lib/index.js',
      exports: { '.': './lib/index.js', './client': './client/client.js' },
    }), 'utf8');
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const result = ensureDesktopDshWhale({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
    // No overlay is produced on failure — the controller fails the start and
    // never passes a stale overlay path.
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshWhale fails closed on missing runtime dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-whale-deps-'));
  try {
    const source = path.join(root, 'source');
    fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'export {};\n', 'utf8');
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
      name: DSH_WHALE_PACKAGE,
      version: '0.1.0',
      type: 'module',
      main: './lib/index.js',
      exports: { '.': './lib/index.js' },
      dependencies: { 'definitely-not-installed-dshd-test': '^1.0.0' },
    }), 'utf8');
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const result = ensureDesktopDshWhale({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /definitely-not-installed-dshd-test/);
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('vendored dsh-whale package passes its own runtime integrity gate', () => {
  // The real vendor tree must satisfy the same checks ensure runs — this
  // catches a vendored-dependency hole before a packaged build does.
  const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
  const dir = path.join(__dirname, '..', '..', 'vendor', 'dsh-whale');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(missingDeclaredEntries(dir, manifest), []);
  assert.deepEqual(missingRuntimeFiles(dir), []);
});

test('assistant presentation title is the configured name without an emoji prefix', async () => {
  const module = await import(pathToFileURL(path.join(
    __dirname, '..', '..', 'vendor', 'dsh-whale', 'lib', 'index.js',
  )).href);
  assert.equal(typeof module.whaleDisplayName, 'function');
  assert.equal(module.whaleDisplayName({ name: '吃白饭的' }), '吃白饭的');
  assert.equal(module.whaleDisplayName({ name: '' }), '鲸鱼娘');
});

test('vendored dsh-whale peers satisfy the vendored runtime compatibility gate', async () => {
  // The Loader disables a row whose @deepseek-ai/dsh-* peers reject the
  // running runtime — exact pins stale after an upstream merge silently
  // unmount the plugin (no route, no client bundle). Evaluate the shipped
  // manifest through app-boot's real gate so the check travels with the pin.
  const appBoot = pathToFileURL(path.join(
    __dirname, '..', '..', 'vendor', 'deepseek-harness', 'packages', 'boot', 'app-boot', 'lib', 'index.js',
  )).href;
  const { evaluatePluginCompatibility, getDshRuntimeVersion } = await import(appBoot);
  const dir = path.join(__dirname, '..', '..', 'vendor', 'dsh-whale');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(evaluatePluginCompatibility(manifest, {}, getDshRuntimeVersion()), undefined);
  for (const version of ['0.1.5-rc.2', '0.1.7', '0.2.1-alpha.1', '0.2.1-alpha.3', '0.2.1-rc.2']) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version);
  }
  for (const version of ['0.2.1-alpha.2', '0.2.1-alpha.4', '0.2.1-rc.3', '0.2.1']) {
    const issue = evaluatePluginCompatibility(manifest, {}, version);
    assert.ok(issue, `${version} is outside the verified runtime range`);
    assert.equal(issue.exempted, false);
    assert.deepEqual(Object.keys(issue.requirements), Object.keys(manifest.peerDependencies).filter(
      (name) => name.startsWith('@deepseek-ai/dsh-'),
    ));
  }
});

test('gitignore does not ignore vendored dsh-whale runtime dependencies', () => {
  const { spawnSync } = require('node:child_process');
  const root = path.join(__dirname, '..', '..');
  for (const file of [
    'vendor/dsh-whale/node_modules/@deepseek-ai/schemastery/package.json',
    'vendor/dsh-whale/node_modules/@deepseek-ai/dsh-tools/package.json',
    'vendor/dsh-whale/node_modules/@deepseek-ai/dsh-llm/package.json',
  ]) {
    const result = spawnSync('git', ['check-ignore', '-q', file], { cwd: root, windowsHide: true });
    assert.equal(result.status, 1, `${file} must not match the repo node_modules/ ignore`);
  }
});

test('dsh-whale aliases strip from the disable list (desktop built-in)', () => {
  assert.deepEqual(DSH_WHALE_ALIASES, ['dsh-whale', 'dshwhale']);
  assert.deepEqual(
    withoutDshWhaleAliases(['dsh-whale', 'dshwhale', 'other-plugin', 'dshbot']),
    ['other-plugin', 'dshbot'],
  );
  assert.deepEqual(withoutDshWhaleAliases([]), []);
  assert.deepEqual(withoutDshWhaleAliases(undefined), []);
});
