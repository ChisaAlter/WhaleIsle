'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  ALLOWED_PREVIEW_PERMISSIONS,
  PREVIEW_PARTITION_PREFIX,
  configurePreviewSession,
  createPreviewSessionCache,
  isPreviewPermissionAllowed,
  isTrustedPreviewOrigin,
  previewGuestPreloadPath,
  previewGuestWebPreferences,
  previewPartitionForScope,
  stripPreviewUserAgent,
} = require('./preview-session.js');

const leftoverUaBrand = ['t', '3', 'code'].join('');
const BRIEF_UA = `Mozilla/5.0 Electron/43.0.0 ${leftoverUaBrand}/1.0 Safari`;

function fakeSession(ua = BRIEF_UA) {
  let userAgent = ua;
  const ses = {
    requestHandler: null,
    checkHandler: null,
    requestHandlerCount: 0,
    checkHandlerCount: 0,
    storageClears: [],
    cacheClears: 0,
    getUserAgent() {
      return userAgent;
    },
    setUserAgent(next) {
      userAgent = next;
    },
    setPermissionRequestHandler(fn) {
      this.requestHandlerCount += 1;
      this.requestHandler = fn;
    },
    setPermissionCheckHandler(fn) {
      this.checkHandlerCount += 1;
      this.checkHandler = fn;
    },
    clearStorageData(options) {
      this.storageClears.push(options);
      return Promise.resolve();
    },
    clearCache() {
      this.cacheClears += 1;
      return Promise.resolve();
    },
  };
  return ses;
}

function fakeContents(ses, url, isDestroyed = false) {
  return {
    session: ses,
    isDestroyed() {
      return isDestroyed;
    },
    getURL() {
      return url;
    },
  };
}

test('previewPartitionForScope uses persist:dshd-preview- plus 20 hex chars', () => {
  const partition = previewPartitionForScope('shared');
  assert.equal(partition.startsWith(PREVIEW_PARTITION_PREFIX), true);
  assert.equal(PREVIEW_PARTITION_PREFIX, 'persist:dshd-preview-');
  const digest = partition.slice(PREVIEW_PARTITION_PREFIX.length);
  assert.equal(digest.length, 20);
  assert.match(digest, /^[0-9a-f]{20}$/);
  const expected = crypto.createHash('sha256').update('shared', 'utf8').digest('hex').slice(0, 20);
  assert.equal(digest, expected);
});

test('previewPartitionForScope defaults to shared and differs by scope', () => {
  assert.equal(previewPartitionForScope(), previewPartitionForScope('shared'));
  assert.notEqual(previewPartitionForScope('shared'), previewPartitionForScope('/tmp/proj'));
});

test('stripPreviewUserAgent removes Electron and leftover migrated UA tokens', () => {
  const stripped = stripPreviewUserAgent(BRIEF_UA);
  assert.equal(stripped.includes('Electron/'), false);
  assert.equal(stripped.includes(`${leftoverUaBrand}/`), false);
  assert.equal(stripped, 'Mozilla/5.0 Safari');
});

const BINDING_TEST_ALLOWLIST = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'notifications',
  'geolocation',
]);

test('configurePreviewSession strips UA and denies every permission by default', () => {
  const ses = fakeSession();
  configurePreviewSession(ses);
  assert.equal(ses.getUserAgent().includes('Electron/'), false);
  assert.equal(ses.getUserAgent().includes(`${leftoverUaBrand}/`), false);

  const wc = fakeContents(ses, 'http://127.0.0.1:5173/');
  const granted = (name, details = { isMainFrame: true, requestingUrl: 'http://127.0.0.1:5173/' }) => {
    let result;
    ses.requestHandler(wc, name, (ok) => { result = ok; }, details);
    return result;
  };
  // Decide-by-default = deny. Even a loopback main frame gets nothing while the
  // allow-list is empty; the four legacy grants are gone deliberately.
  for (const name of [
    'clipboard-read',
    'clipboard-sanitized-write',
    'notifications',
    'geolocation',
    'clipboard-write',
    'local-fonts',
    'media',
    'unknown-permission',
  ]) {
    assert.equal(granted(name), false, `${name} must be denied by default`);
    assert.equal(
      ses.checkHandler(wc, name, 'http://127.0.0.1:5173/', { isMainFrame: true }),
      false,
      `${name} check must be denied by default`,
    );
  }
  assert.equal(ALLOWED_PREVIEW_PERMISSIONS.size, 0);
  assert.equal(ALLOWED_PREVIEW_PERMISSIONS.has('clipboard-read'), false);
  assert.equal(ALLOWED_PREVIEW_PERMISSIONS.has('local-fonts'), false);
});

test('AUD-02: public-origin and cross-origin-frame requests are denied', () => {
  const ses = fakeSession();
  configurePreviewSession(ses);

  const evilMain = fakeContents(ses, 'https://evil.example/');
  let result;
  ses.requestHandler(
    evilMain,
    'clipboard-read',
    (ok) => { result = ok; },
    { isMainFrame: true, requestingUrl: 'https://evil.example/' },
  );
  assert.equal(result, false, 'public main-frame clipboard-read must be denied');

  const evilFrame = fakeContents(ses, 'https://evil.example/frame');
  ses.requestHandler(
    evilFrame,
    'geolocation',
    (ok) => { result = ok; },
    { isMainFrame: false, requestingUrl: 'https://evil.example/frame' },
  );
  assert.equal(result, false, 'public iframe geolocation must be denied');

  const loopbackTop = fakeContents(ses, 'http://127.0.0.1:5173/app');
  ses.requestHandler(
    loopbackTop,
    'geolocation',
    (ok) => { result = ok; },
    { isMainFrame: false, requestingUrl: 'https://evil.example/frame' },
  );
  assert.equal(result, false, 'cross-origin frame under a loopback top must be denied');
});

test('AUD-02: even with an entry allow-listed, grants stay bound to session and webContents', () => {
  const ses = fakeSession();
  configurePreviewSession(ses);
  const trusted = fakeContents(ses, 'http://localhost:3000/');
  assert.equal(isPreviewPermissionAllowed(
    ses,
    trusted,
    'notifications',
    'http://localhost:3000/',
    { isMainFrame: true },
    BINDING_TEST_ALLOWLIST,
  ), true);

  // Fail closed when the requester is opaque, ownerless, or already destroyed.
  for (const [label, contents, origin] of [
    ['missing session', { getURL: () => 'http://localhost:3000/' }, 'http://localhost:3000/'],
    ['opaque frame origin', trusted, 'data:text/html,<h1>x</h1>'],
    ['malformed frame origin', trusted, 'not a url'],
    ['destroyed contents', fakeContents(ses, 'http://localhost:3000/', true), 'http://localhost:3000/'],
  ]) {
    assert.equal(isPreviewPermissionAllowed(
      ses,
      contents,
      'notifications',
      origin,
      { isMainFrame: true },
      BINDING_TEST_ALLOWLIST,
    ), false, `${label} must be denied`);
  }

  // Without an explicit allow-list entry the binding logic still denies.
  assert.equal(isPreviewPermissionAllowed(ses, trusted, 'notifications', 'http://localhost:3000/', {
    isMainFrame: true,
  }), false);

  const foreignSession = fakeSession();
  assert.equal(isPreviewPermissionAllowed(
    ses,
    fakeContents(foreignSession, 'http://localhost:3000/'),
    'notifications',
    'http://localhost:3000/',
    { isMainFrame: true },
    BINDING_TEST_ALLOWLIST,
  ), false, 'webContents from another session must be denied');

  for (const foreign of [
    undefined,
    null,
    {},
    fakeContents(ses, 'file:///etc/passwd'),
    fakeContents(ses, 'data:text/html,<h1>x</h1>'),
    fakeContents(ses, ''),
  ]) {
    assert.equal(isPreviewPermissionAllowed(
      ses,
      foreign,
      'clipboard-read',
      '',
      { isMainFrame: true },
      BINDING_TEST_ALLOWLIST,
    ), false);
  }
  assert.equal(isTrustedPreviewOrigin(null), false);
  assert.equal(isTrustedPreviewOrigin(new URL('http://[::1]:3000/')), true);
  assert.equal(isTrustedPreviewOrigin(new URL('https://evil.example/')), false);
});

test('AUD-02: same-origin loopback frames only pass with an allow-list entry', () => {
  const ses = fakeSession();
  configurePreviewSession(ses);
  const top = fakeContents(ses, 'http://127.0.0.1:5173/app');
  assert.equal(isPreviewPermissionAllowed(
    ses,
    top,
    'clipboard-read',
    'http://127.0.0.1:5173/embed',
    { isMainFrame: false },
    BINDING_TEST_ALLOWLIST,
  ), true);
  assert.equal(isPreviewPermissionAllowed(
    ses,
    top,
    'clipboard-read',
    'http://127.0.0.1:5173/embed',
    { isMainFrame: false },
  ), false, 'same-origin is necessary but not sufficient without an entry');
});

test('createPreviewSessionCache configures each partition once', () => {
  const minted = [];
  const cache = createPreviewSessionCache((partition) => {
    const ses = fakeSession();
    minted.push(partition);
    return ses;
  });
  const first = cache.getSession('shared');
  const second = cache.getSession('shared');
  assert.equal(first, second);
  assert.equal(minted.length, 1);
  assert.equal(first.requestHandlerCount, 1);
  assert.equal(first.checkHandlerCount, 1);
  const other = cache.getSession('/tmp/proj');
  assert.notEqual(other, first);
  assert.equal(minted.length, 2);
  assert.equal(other.requestHandlerCount, 1);
});

test('session cache lists sessions and sweeps cookies and cache', async () => {
  const minted = [];
  const cache = createPreviewSessionCache((partition) => {
    const ses = fakeSession();
    minted.push(partition);
    return ses;
  });
  const first = cache.getSession('shared');
  const second = cache.getSession('/tmp/proj');
  assert.equal(cache.listSessions().length, 2);
  assert.equal(cache.listSessions().includes(first), true);
  assert.equal(cache.listSessions().includes(second), true);
  await cache.clearCookies();
  await cache.clearCache();
  for (const ses of cache.listSessions()) {
    assert.deepEqual(ses.storageClears, [{
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
    }]);
    assert.equal(ses.cacheClears, 1);
  }
  const empty = createPreviewSessionCache(() => {
    throw new Error('empty cache must not mint');
  });
  await empty.clearCookies();
  await empty.clearCache();
  assert.deepEqual(empty.listSessions(), []);
});

test('previewGuestWebPreferences pin sandbox, isolation, and disable nodeIntegration', () => {
  const ses = fakeSession();
  const prefs = previewGuestWebPreferences({ session: ses });
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.session, ses);
  assert.equal(prefs.preload, previewGuestPreloadPath());
  assert.match(prefs.preload, /preview-guest-preload\.bundle\.js$/);
});
