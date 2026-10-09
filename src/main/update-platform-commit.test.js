'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { installFromAsset, pickInstaller, setUpdateStateSink } = require('./update');
const { createTaskProtection } = require('./task-protection');

function verifiedFixture(t, assetName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-update-commit-'));
  fs.mkdirSync(path.join(dir, 'updates'));
  const file = path.join(dir, 'updates', assetName);
  fs.writeFileSync(file, 'verified fixture');
  const digest = crypto.createHash('sha512').update('verified fixture').digest('hex');
  const previous = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => `${digest}  ${assetName}` });
  t.after(() => { global.fetch = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, file, info: { latest: '9.9.9', assetName, assetUrl: 'https://example.test/installer', checksumUrl: 'https://example.test/sums' } };
}

test('updater download success followed by spawn failure releases protection and rechecks work on retry', async (t) => {
  const { file, info } = verifiedFixture(t, 'Setup.exe');
  const calls = [];
  const states = [];
  setUpdateStateSink((state) => states.push(state));
  t.after(() => setUpdateStateSink(null));
  const protection = createTaskProtection({ hostRunning: () => true, getBaseUrl: () => 'http://127.0.0.1:9',
    fetchImpl: async (url) => {
      const op = url.split('/').at(-1); calls.push(op);
      return { ok: true, json: async () => op === 'inspect'
        ? { ok: true, activeWork: [], scheduledWork: [], coverage: { agents: 'ok' } }
        : { ok: true, lockId: 'qa-lock', owner: 'qa' } };
    } });
  const updater = new EventEmitter();
  info.blockmapUrl = 'https://example.test/Setup.exe.blockmap';
  info.updaterMetadataUrl = 'https://example.test/latest.yml';
  updater.getOrCreateDownloadHelper = async () => ({ cacheDir: path.dirname(file) });
  updater.checkForUpdates = async () => {
    const updateInfo = { version: '9.9.9' };
    updater.updateInfoAndProvider = { info: updateInfo, provider: { resolveFiles: () => [{
      url: new URL('https://example.test/Setup.exe'), info: { url: 'Setup.exe' },
    }] } };
    return { updateInfo };
  };
  updater.downloadUpdate = async () => [file];
  updater.quitAndInstall = () => { throw new Error('unobservable installer must not be used'); };
  let launches = 0;
  const options = { downloadMode: 'delta', platform: 'win32', quitAfterInstall: true, taskProtection: protection,
    updaterDeps: { isPackaged: true, platform: 'win32', autoUpdater: updater, existsSync: () => true },
    spawn: () => { launches++; const child = new EventEmitter(); child.unref = () => {};
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn denied'), { code: 'EACCES' }))); return child; } };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(installFromAsset(info, null, options), { code: 'EACCES' });
    assert.equal(protection.isCommitted(), false);
  }
  assert.equal(launches, 2, 'failed install must not attempt another launch within one click');
  assert.equal(states.at(-1).phase, 'error');
  assert.equal(states.at(-1).failedOperation, 'install');
  assert.deepEqual(calls, ['inspect', 'acquire', 'inspect', 'release', 'inspect', 'acquire', 'inspect', 'release']);
});

test('macOS picks only a compatible DMG even when a Windows Setup comes first', () => {
  const assets = ['Setup.exe', 'Whale-Isle-mac-x64.dmg', 'Whale-Isle-mac-arm64.dmg']
    .map((name) => ({ name, browser_download_url: `https://example.test/${name}` }));
  assert.equal(pickInstaller(assets, { platform: 'darwin', arch: 'arm64' }).name, assets[2].name);
  assert.equal(pickInstaller(assets, { platform: 'darwin', arch: 'x64' }).name, assets[1].name);
  assert.equal(pickInstaller(assets.slice(0, 2), { platform: 'darwin', arch: 'arm64' }), null);
  assert.equal(pickInstaller(assets, { platform: 'linux', arch: 'x64' }), null);
  assert.equal(pickInstaller(assets, { platform: 'win32', arch: 'x64' }).name, 'Setup.exe');
});

test('verified macOS DMG opens for manual installation and keeps task protection uncommitted', async (t) => {
  const { dir, file, info } = verifiedFixture(t, 'Whale-Isle-mac-arm64.dmg');
  const protection = createTaskProtection({ hostRunning: () => false });
  let opened;
  const states = [];
  setUpdateStateSink((state) => states.push(state));
  t.after(() => setUpdateStateSink(null));
  const result = await installFromAsset(info, null, { platform: 'darwin', userDataDir: dir, taskProtection: protection,
    openPath: async (dest) => { opened = dest; return ''; }, spawn: () => { throw new Error('DMG must not spawn'); } });
  assert.equal(opened, file);
  assert.equal(result.manualInstall, true);
  assert.equal(result.launched, false);
  assert.equal(protection.isCommitted(), false);
  assert.equal(states.at(-1).phase, 'available', 'manual installation leaves the update entry actionable');
});

test('macOS reports openPath failure instead of claiming an installer was opened', async (t) => {
  const { dir, info } = verifiedFixture(t, 'Whale-Isle-mac-arm64.dmg');
  await assert.rejects(installFromAsset(info, null, { platform: 'darwin', userDataDir: dir,
    openPath: async () => 'permission denied' }), /permission denied/);
});
