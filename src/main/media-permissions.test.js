'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { installMediaPermissions, isHarnessOrigin } = require('./media-permissions');
const { systemNotificationsAllowed } = require('./system-notifications');

function fixture(primaryContents = {}, install = installMediaPermissions) {
  let checkHandler;
  let requestHandler;
  const ses = {
    setPermissionCheckHandler(fn) { checkHandler = fn; },
    setPermissionRequestHandler(fn) { requestHandler = fn; },
  };
  install(ses, () => primaryContents, {
    getMediaAccessStatus: () => 'granted',
    askForMediaAccess: async () => true,
  });
  return { checkHandler, requestHandler };
}

test('isHarnessOrigin accepts loopback http(s) only', () => {
  assert.equal(isHarnessOrigin('http://127.0.0.1:3080/'), true);
  assert.equal(isHarnessOrigin('http://localhost:3080/x'), true);
  assert.equal(isHarnessOrigin('https://example.com/'), false);
  assert.equal(isHarnessOrigin('dsh-app://app/'), false);
  assert.equal(isHarnessOrigin('not a url'), false);
});

test('media audio from the primary main frame is allowed; other media denied', async () => {
  const primary = { tag: 'primary' };
  const { checkHandler, requestHandler } = fixture(primary);

  assert.equal(checkHandler(primary, 'media', 'http://127.0.0.1:3080', { isMainFrame: true, mediaType: 'audio' }), true);
  assert.equal(checkHandler(primary, 'media', 'http://127.0.0.1:3080', { isMainFrame: true, mediaType: 'video' }), false);
  assert.equal(checkHandler({ tag: 'other' }, 'media', 'http://127.0.0.1:3080', { isMainFrame: true, mediaType: 'audio' }), false);
  assert.equal(checkHandler(primary, 'media', 'http://127.0.0.1:3080', { isMainFrame: false, mediaType: 'audio' }), false);
  assert.equal(checkHandler(primary, 'media', 'https://evil.example', { isMainFrame: true, mediaType: 'audio' }), false);

  let grant = await new Promise(resolve => requestHandler(primary, 'media', resolve,
    { isMainFrame: true, requestingUrl: 'http://127.0.0.1:3080', mediaTypes: ['audio'] }));
  assert.equal(grant, true);
  grant = await new Promise(resolve => requestHandler(primary, 'media', resolve,
    { isMainFrame: true, requestingUrl: 'http://127.0.0.1:3080', mediaTypes: ['audio', 'video'] }));
  assert.equal(grant, false);
});

test('clipboard read and write stay inside the primary harness main frame', async () => {
  const primary = { tag: 'primary' };
  const { checkHandler, requestHandler } = fixture(primary);
  const loopback = 'http://127.0.0.1:3080';

  for (const permission of ['clipboard-read', 'clipboard-sanitized-write']) {
    assert.equal(checkHandler(primary, permission, loopback, { isMainFrame: true }), true, permission);
    assert.equal(await new Promise(resolve => requestHandler(primary, permission, resolve,
      { isMainFrame: true, requestingUrl: loopback })), true, permission);

    // Generated frames run opaque origins; the host main frame performs the
    // clipboard action on their behalf.
    assert.equal(checkHandler(primary, permission, loopback, { isMainFrame: false }), false, permission);
    assert.equal(await new Promise(resolve => requestHandler(primary, permission, resolve,
      { isMainFrame: false, requestingUrl: loopback })), false, permission);
    assert.equal(checkHandler(primary, permission, 'null', { isMainFrame: false }), false, permission);

    assert.equal(checkHandler({ tag: 'other' }, permission, loopback, { isMainFrame: true }), false, permission);
    assert.equal(await new Promise(resolve => requestHandler({ tag: 'other' }, permission, resolve,
      { isMainFrame: true, requestingUrl: loopback })), false, permission);
    assert.equal(checkHandler(primary, permission, 'https://evil.example', { isMainFrame: true }), false, permission);
    assert.equal(await new Promise(resolve => requestHandler(primary, permission, resolve,
      { isMainFrame: true, requestingUrl: 'https://evil.example' })), false, permission);
    // Local file:// pages on defaultSession get no web permissions.
    assert.equal(checkHandler(primary, permission, 'file:///app/launcher.html', { isMainFrame: true }), false, permission);
  }
});

test('fullscreen is granted to primary harness frames only; embedded pages opt in via allow attributes', async () => {
  const primary = { tag: 'primary' };
  const { checkHandler, requestHandler } = fixture(primary);

  // The Whale UI YouTube embed is an https subframe inside the harness view.
  assert.equal(checkHandler(primary, 'fullscreen', 'https://www.youtube-nocookie.com', { isMainFrame: false }), true);
  assert.equal(await new Promise(resolve => requestHandler(primary, 'fullscreen', resolve,
    { isMainFrame: false, requestingUrl: 'https://www.youtube-nocookie.com/embed/x' })), true);
  assert.equal(checkHandler({ tag: 'other' }, 'fullscreen', 'https://evil.example', { isMainFrame: true }), false);
  assert.equal(await new Promise(resolve => requestHandler({ tag: 'other' }, 'fullscreen', resolve,
    { isMainFrame: true, requestingUrl: 'https://evil.example' })), false);
});

test('every unlisted permission is denied in both handlers', async () => {
  const primary = { tag: 'primary' };
  const { checkHandler, requestHandler } = fixture(primary);
  const details = { isMainFrame: true, requestingUrl: 'http://127.0.0.1:3080' };

  for (const permission of [
    'geolocation', 'geolocation-approximate', 'openExternal', 'hid', 'serial', 'usb',
    'midi', 'midiSysex', 'nfc', 'sensors', 'pointerLock', 'keyboardLock', 'idle-detection',
    'window-management', 'display-capture', 'mediaKeySystem', 'speaker-selection',
    'fileSystem', 'local-fonts', 'persistent-storage', 'storage-access',
    'top-level-storage-access', 'deprecated-sync-clipboard-read', 'local-network',
    'local-network-access', 'loopback-network', 'screen-wake-lock', 'system-wake-lock',
    'automatic-fullscreen', 'background-fetch', 'background-sync',
    'periodic-background-sync', 'captured-surface-control', 'payment-handler',
    'web-app-installation', 'web-printing', 'smart-card', 'hand-tracking', 'ar', 'vr',
    'unknown',
  ]) {
    assert.equal(checkHandler(primary, permission, 'http://127.0.0.1:3080', details), false, permission);
    assert.equal(await new Promise(resolve => requestHandler(primary, permission, resolve, details)), false, permission);
  }
});

for (const environment of [
  { platform: 'win32', defaultApp: true },
  { platform: 'win32', defaultApp: false },
  { platform: 'linux', defaultApp: true },
  { platform: 'darwin', defaultApp: true },
]) {
  test(`${environment.platform} ${environment.defaultApp ? 'source' : 'package'} notification permission checks and requests agree`, async () => {
    const permissionModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'media-permissions.js'), 'utf8'), {
      module: permissionModule, process: environment, URL,
      require: () => ({ systemNotificationsAllowed: () => systemNotificationsAllowed(environment) }),
    });
    const primary = {};
    const { checkHandler, requestHandler } = fixture(primary, permissionModule.exports.installMediaPermissions);
    const expected = systemNotificationsAllowed(environment);
    const loopback = 'http://127.0.0.1:3080';
    assert.equal(checkHandler(primary, 'notifications', loopback, { isMainFrame: true }), expected);
    assert.equal(await new Promise(resolve => requestHandler(primary, 'notifications', resolve,
      { isMainFrame: true, requestingUrl: loopback })), expected);
    // The system-notification gate never rescues a foreign requester.
    assert.equal(checkHandler(primary, 'notifications', 'https://evil.example', { isMainFrame: true }), false);
    assert.equal(await new Promise(resolve => requestHandler(primary, 'notifications', resolve,
      { isMainFrame: true, requestingUrl: 'https://evil.example' })), false);
    assert.equal(checkHandler(primary, 'clipboard-read', loopback, { isMainFrame: true }), true);
    assert.equal(await new Promise(resolve => requestHandler(primary, 'clipboard-read', resolve,
      { isMainFrame: true, requestingUrl: loopback })), true);
    assert.equal(checkHandler(primary, 'geolocation', loopback, { isMainFrame: true }), false);
    assert.equal(await new Promise(resolve => requestHandler(primary, 'geolocation', resolve,
      { isMainFrame: true, requestingUrl: loopback })), false);
    assert.equal(checkHandler(primary, 'media', loopback, { isMainFrame: true, mediaType: 'audio' }), true);
    assert.equal(await new Promise(resolve => requestHandler(primary, 'media', resolve,
      { isMainFrame: true, requestingUrl: loopback, mediaTypes: ['audio', 'video'] })), false);
  });
}
