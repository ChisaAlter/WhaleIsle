'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-cache-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { isPackaged: false, getPath: () => userData } },
};
const { loadConfig, publicConfig, saveConfig, configPath } = require('./config');
const requestKey = 'a'.repeat(64);

function writeSettings(patch = {}) {
  const settings = {
    workspace: userData,
    closeToTray: true,
    live2dPet: { growth: { points: 4, food: { version: 1, available: 3, seen: { [requestKey]: 8 } } } },
    ...patch,
  };
  fs.writeFileSync(configPath(), JSON.stringify(settings));
  return settings;
}

test.after(() => fs.rmSync(userData, { recursive: true, force: true }));

test('unchanged settings reads reuse the validated pet ledger without reading its file again', () => {
  writeSettings();
  const first = loadConfig();
  const originalRead = fs.readFileSync;
  const reads = [];
  fs.readFileSync = (file, ...args) => { reads.push(String(file)); return originalRead(file, ...args); };
  try {
    const next = loadConfig();
    assert.notEqual(first, next);
    assert.equal(next.live2dPet, first.live2dPet);
    assert.equal(publicConfig(next).live2dPet, first.live2dPet);
    assert.equal(reads.includes(configPath()), false);
    assert.ok(reads.some(file => file.endsWith('credentials.json')));
    assert.equal(first.live2dPet.growth.food.seen[requestKey], 8);
  } finally {
    fs.readFileSync = originalRead;
  }
});

test('cached nested settings cannot be changed through a returned snapshot', () => {
  writeSettings();
  const config = loadConfig();
  config.closeToTray = false;
  assert.throws(() => { config.live2dPet.growth.food.seen[requestKey] = 0; }, TypeError);
  assert.throws(() => { publicConfig(config).disabledPlugins.push('plugin'); }, TypeError);
  assert.equal(loadConfig().closeToTray, true);
  assert.equal(loadConfig().live2dPet.growth.food.seen[requestKey], 8);
});

test('in-place edits of the same size and restored mtime invalidate the cached settings', () => {
  writeSettings({ locale: 'zh' });
  loadConfig();
  const before = fs.statSync(configPath());
  const text = fs.readFileSync(configPath(), 'utf8');
  fs.writeFileSync(configPath(), text.replace('"locale":"zh"', '"locale":"en"'));
  fs.utimesSync(configPath(), before.atime, before.mtime);
  assert.equal(loadConfig().locale, 'en');
});

test('external file replacement and a subsequent save preserve the current disk settings', () => {
  writeSettings({ locale: 'zh' });
  loadConfig();
  const replacement = path.join(userData, 'replacement.json');
  fs.writeFileSync(replacement, JSON.stringify({ locale: 'en', closeToTray: false, workspace: userData }));
  fs.renameSync(replacement, configPath());
  assert.equal(loadConfig().locale, 'en');
  saveConfig({ theme: 'midnight' });
  assert.equal(loadConfig().closeToTray, false);
  assert.equal(loadConfig().locale, 'en');
});

test('saves reread the settings even if their stat key has not changed', () => {
  writeSettings();
  loadConfig();
  const originalRead = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (file, ...args) => {
    if (String(file) === configPath()) reads += 1;
    return originalRead(file, ...args);
  };
  try {
    saveConfig({ closeToTray: false });
    assert.equal(reads, 1);
  } finally {
    fs.readFileSync = originalRead;
  }
  assert.equal(loadConfig().closeToTray, false);
});

test('missing, unreadable and corrupt files never reuse a previous good cache', () => {
  writeSettings({ closeToTray: false });
  loadConfig();
  fs.unlinkSync(configPath());
  assert.equal(loadConfig().closeToTray, true);
  fs.mkdirSync(configPath());
  assert.equal(loadConfig().closeToTray, true);
  assert.throws(() => saveConfig({ theme: 'midnight' }), /设置文件暂时无法读取/);
  fs.rmdirSync(configPath());
  writeSettings({ closeToTray: false });
  loadConfig();
  fs.writeFileSync(configPath(), '{broken');
  assert.equal(loadConfig().closeToTray, true);
  assert.ok(fs.readdirSync(userData).some(name => name.startsWith('config.json.corrupt-')));
  saveConfig({ theme: 'midnight' });
  assert.equal(loadConfig().theme, 'midnight');
});
