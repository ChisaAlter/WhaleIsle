const assert = require('node:assert/strict');
const test = require('node:test');

function load(stored) {
  const electronPath = require.resolve('electron');
  const themesPath = require.resolve('../shared/themes');
  const modulePath = require.resolve('./render-mode');
  const originals = [electronPath, themesPath, modulePath].map(file => require.cache[file]);
  const sent = [];
  const read = { count: 0 };
  require.cache[electronPath] = { exports: { webContents: { getAllWebContents: () => [
    { isDestroyed: () => false, send: (...args) => sent.push(args) },
    { isDestroyed: () => true, send: () => { throw new Error('destroyed window'); } },
  ] } } };
  require.cache[themesPath] = { exports: { readHarnessThemeSettingsLive() { read.count++; return { minimalMode: stored }; } } };
  delete require.cache[modulePath];
  const mode = require('./render-mode');
  [electronPath, themesPath, modulePath].forEach((file, index) => {
    if (originals[index]) require.cache[file] = originals[index]; else delete require.cache[file];
  });
  return { mode, sent, read };
}

test('reads the active profile once and broadcasts only mode changes', () => {
  const { mode, sent, read } = load(true);
  assert.equal(mode.getMinimalMode(), true);
  assert.equal(mode.getMinimalMode(), true);
  assert.equal(read.count, 1);
  assert.equal(mode.claimMinimalSuggestion(), false);
  mode.setMinimalMode(false);
  mode.setMinimalMode(false);
  assert.deepEqual(sent, [['shell:render-mode', false]]);
  assert.throws(() => mode.setMinimalMode('false'), /boolean/);
});

test('only one window can claim a recommendation per desktop launch', () => {
  const { mode } = load(false);
  assert.equal(mode.claimMinimalSuggestion(), true);
  assert.equal(mode.claimMinimalSuggestion(), false);
});
