'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const {
  platformAssetName,
  resolveMagpieConfigDir,
  assertNoPortableMarkers,
  setBinaryReadOnly,
  setDirWritable,
} = require('./platform');

test('platformAssetName maps all supported official magpie-cli platforms', () => {
  assert.equal(platformAssetName('win32', 'x64'), 'magpie-cli-windows-amd64.exe');
  assert.equal(platformAssetName('win32', 'arm64'), 'magpie-cli-windows-arm64.exe');
  assert.equal(platformAssetName('darwin', 'arm64'), 'magpie-cli-darwin-arm64');
  assert.equal(platformAssetName('darwin', 'x64'), 'magpie-cli-darwin-amd64');
  assert.equal(platformAssetName('linux', 'x64'), 'magpie-cli-linux-amd64');
  assert.equal(platformAssetName('linux', 'arm64'), 'magpie-cli-linux-arm64');
  assert.equal(platformAssetName('freebsd', 'x64'), '');
});

test('resolveMagpieConfigDir honors absolute XDG_CONFIG_HOME and falls back to home .config/magpie', () => {
  const absXdg = path.resolve(path.sep, 'custom-xdg-config');
  assert.equal(resolveMagpieConfigDir({ XDG_CONFIG_HOME: absXdg }, '/home/tester'), path.join(absXdg, 'magpie'));
  assert.equal(resolveMagpieConfigDir({ XDG_CONFIG_HOME: 'relative/xdg' }, '/home/tester'), path.join('/home/tester', '.config', 'magpie'));
  assert.equal(resolveMagpieConfigDir({}, '/home/tester'), path.join('/home/tester', '.config', 'magpie'));
});

test('assertNoPortableMarkers rejects data/ and .portable markers inside version directory', async () => {
  await withOwnedTempDir('magpie-portable-', async (dir) => {
    assertNoPortableMarkers(dir);
    fs.writeFileSync(path.join(dir, '.portable'), '');
    assert.throws(() => assertNoPortableMarkers(dir), /便携模式标记 \.portable/);
    fs.rmSync(path.join(dir, '.portable'));
    fs.mkdirSync(path.join(dir, 'data'));
    assert.throws(() => assertNoPortableMarkers(dir), /便携模式标记 data/);
  });
});

test('setBinaryReadOnly and setDirWritable toggle write permissions cleanly', async () => {
  await withOwnedTempDir('magpie-chmod-', async (dir) => {
    const bin = path.join(dir, 'magpie-cli.exe');
    fs.writeFileSync(bin, 'binary');
    setBinaryReadOnly(dir, bin, process.platform);
    const roMode = fs.statSync(bin).mode;
    assert.equal(roMode & 0o200, 0);
    setDirWritable(dir);
    assert.notEqual(fs.statSync(bin).mode & 0o200, 0);
  });
});
