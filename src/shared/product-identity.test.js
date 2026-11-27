'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PRODUCT_NAME,
  LAUNCHER_NAME,
  LEGACY_PRODUCT_NAMES,
  LEGACY_LAUNCHER_NAMES,
  LEGACY_DESKTOP_USER_DATA,
  LEGACY_LAUNCHER_USER_DATA,
  preserveUserDataPath,
} = require('./product-identity');

test('public identity uses unspaced WhaleIsle while retaining legacy install names', () => {
  assert.equal(PRODUCT_NAME, 'WhaleIsle');
  assert.equal(LAUNCHER_NAME, 'WhaleIsle Launcher');
  assert.deepEqual(LEGACY_PRODUCT_NAMES, ['Whale Isle', 'Deepseek-Harness-Desktop']);
  assert.deepEqual(LEGACY_LAUNCHER_NAMES, ['Whale Isle Launcher', 'Deepseek-Harness-Launcher']);
});

test('public rename retains both existing Electron data directories', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-isle-identity-'));
  try {
    const setPaths = [];
    const app = {
      getPath: (key) => key === 'appData' ? appData : path.join(appData, PRODUCT_NAME),
      setPath: (key, value) => setPaths.push([key, value]),
    };
    const desktop = preserveUserDataPath(app, LEGACY_DESKTOP_USER_DATA, []);
    const launcher = preserveUserDataPath(app, LEGACY_LAUNCHER_USER_DATA, []);
    assert.equal(desktop, path.join(appData, 'Deepseek-Harness-Desktop'));
    assert.equal(launcher, path.join(appData, 'Deepseek-Harness-Launcher'));
    assert.deepEqual(setPaths, [['userData', desktop], ['userData', launcher]]);
    assert.ok(fs.statSync(desktop).isDirectory());
    assert.ok(fs.statSync(launcher).isDirectory());
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('explicit user-data-dir keeps the caller-selected path', () => {
  const app = {
    getPath: () => 'C:\\custom\\WhaleIsle',
    setPath: () => assert.fail('explicit path must not be overridden'),
  };
  assert.equal(preserveUserDataPath(app, LEGACY_DESKTOP_USER_DATA, ['--user-data-dir=C:\\custom\\WhaleIsle']), 'C:\\custom\\WhaleIsle');
});
