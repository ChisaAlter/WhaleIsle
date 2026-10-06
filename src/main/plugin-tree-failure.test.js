'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPluginTreeFailure } = require('./plugin-tree-failure');

test('isPluginTreeFailure matches composition diagnostics', () => {
  assert.equal(isPluginTreeFailure('plugin tree failed to load'), true);
  assert.equal(isPluginTreeFailure('cannot resolve profile bundle "ghost"'), true);
  assert.equal(isPluginTreeFailure('failed to apply loader entry tools'), true);
  assert.equal(isPluginTreeFailure('entries did not activate'), true);
  assert.equal(isPluginTreeFailure('client-modules: ClientPackageCompositionError'), true);
  assert.equal(isPluginTreeFailure('client-modules: composition failed'), true);
  assert.equal(isPluginTreeFailure('client-modules: 1 client package(s) failed to compose:'), true);
  assert.equal(isPluginTreeFailure('client-modules: 组合失败'), true);
  assert.equal(isPluginTreeFailure('client-modules: 组成失败'), false);
  assert.equal(isPluginTreeFailure('client-modules: bundle route'), false);
  assert.equal(isPluginTreeFailure('listen EADDRINUSE: address already in use'), false);
  assert.equal(isPluginTreeFailure(''), false);
});

test('isPluginTreeFailure matches Node ESM plugin-resolution failures', () => {
  assert.equal(
    isPluginTreeFailure(
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-client-ui-settings-market' "
      + 'imported from C:\\Users\\a\\AppData\\Roaming\\Deepseek-Harness-Desktop\\dsh-home\\profiles\\web\\',
    ),
    true,
  );
  assert.equal(
    isPluginTreeFailure("Cannot find module 'file:///C:/dsh-home/profiles/web/desktop-plugins/x/index.mjs' imported from C:/dsh-home/profiles/web/"),
    true,
  );
  // Bare "cannot find module" without an importer is app code, not the Loader.
  assert.equal(isPluginTreeFailure("Cannot find module './missing.json'"), false);
});

test('isPluginTreeFailure recognizes the screenshot web boot audit in singular and plural form', () => {
  assert.equal(isPluginTreeFailure([
    'Web UI failed to load: web boot: 1 entry did not activate',
    'dsh-tavern: import failed (see console for the import error)',
    'dsh-tavern',
  ].join('\n')), true);
  assert.equal(isPluginTreeFailure('web boot: 2 entries did not activate\none: failed\ntwo: disposed'), true);
  assert.equal(isPluginTreeFailure('dsh-tavern: import failed (see console for the import error)'), false);
  assert.equal(isPluginTreeFailure('plugin-status: failed'), false);
  assert.equal(isPluginTreeFailure('listen EACCES: permission denied 127.0.0.1:3080'), false);
});
