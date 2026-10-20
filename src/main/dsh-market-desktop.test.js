'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DSH_MARKET_PACKAGE,
  DSH_MARKET_INSERT_ID,
  DSH_MARKET_OVERLAY_FILENAME,
  resolveMarketSourceDir,
  withoutMarketAliases,
  ensureDesktopMarket,
} = require('./dsh-market-desktop');

function makeSource(root) {
  const dir = path.join(root, 'source');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: DSH_MARKET_PACKAGE,
    version: '0.1.2-rc.1',
    type: 'module',
    main: './lib/index.js',
    exports: { '.': './lib/index.js', './client': './lib/client.js' },
  }, null, 2), 'utf8');
  return dir;
}

function overlayPath(profileDir) {
  return path.join(profileDir, 'desktop-plugins', 'dsh-market', DSH_MARKET_OVERLAY_FILENAME);
}

test('packaged runtime resolves the market package from flattened node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-market-runtime-'));
  try {
    const packagedDir = path.join(root, 'node_modules', ...DSH_MARKET_PACKAGE.split('/'));
    fs.mkdirSync(packagedDir, { recursive: true });
    fs.writeFileSync(path.join(packagedDir, 'package.json'), JSON.stringify({
      name: DSH_MARKET_PACKAGE,
      main: './lib/index.js',
    }), 'utf8');

    assert.equal(resolveMarketSourceDir(root), packagedDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packaged startup writes the market overlay before the runtime is extracted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-market-pre-extract-'));
  const paths = require('./paths');
  const originalHarnessRoot = paths.harnessRoot;
  try {
    paths.harnessRoot = () => path.join(root, 'runtime', '0.2.9');
    const profileDir = path.join(root, 'profile');

    const result = ensureDesktopMarket({ profileDir });

    assert.equal(result.ok, true);
    assert.equal(result.sourceDir, null);
    assert.equal(fs.existsSync(overlayPath(profileDir)), true);
  } finally {
    paths.harnessRoot = originalHarnessRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopMarket keeps the legacy settings market disabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-market-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');

    const result = ensureDesktopMarket({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    assert.equal(result.overlayFile, overlayPath(profileDir));

    const overlay = fs.readFileSync(result.overlayFile, 'utf8');
    assert.match(overlay, new RegExp(`id: ${DSH_MARKET_INSERT_ID}`));
    assert.match(overlay, /@deepseek-ai\/dsh-client-ui-settings-market/);
    assert.match(overlay, /disabled: true/);
    assert.doesNotMatch(overlay, /file:\/\//);

    // The user-owned cordis.patch.yml is never written by the market module.
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false);

    // Idempotent: a second ensure does not report added.
    const again = ensureDesktopMarket({ sourceDir: source, profileDir });
    assert.equal(again.ok, true);
    assert.equal(again.added, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopMarket regenerates the overlay when its content drifts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-market-drift-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    ensureDesktopMarket({ sourceDir: source, profileDir });
    // A stale managed overlay (e.g. an older id) is rewritten to the contract.
    fs.writeFileSync(overlayPath(profileDir), '- insert:\n    - id: old-market-id\n      name: "@deepseek-ai/dsh-client-ui-settings-market"\n', 'utf8');
    ensureDesktopMarket({ sourceDir: source, profileDir });
    const overlay = fs.readFileSync(overlayPath(profileDir), 'utf8');
    assert.match(overlay, new RegExp(`id: ${DSH_MARKET_INSERT_ID}`));
    assert.doesNotMatch(overlay, /old-market-id/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopMarket fails closed when the bundled package is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-market-miss-'));
  try {
    const profileDir = path.join(root, 'profile');
    const result = ensureDesktopMarket({
      sourceDir: path.join(root, 'missing'),
      profileDir,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('withoutMarketAliases strips the dropped dshmarket alias from the disable list', () => {
  assert.deepEqual(
    withoutMarketAliases(['dshmarket', 'user-plugin-a', '@deepseek-ai/dsh-client-ui-settings-market']),
    ['user-plugin-a', '@deepseek-ai/dsh-client-ui-settings-market'],
  );
  assert.deepEqual(withoutMarketAliases(undefined), []);
});
