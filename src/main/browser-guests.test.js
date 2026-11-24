'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BrowserGuests } = require('./browser-guests');

function fixture(host = 'http://127.0.0.1:3080/') {
  const created = [];
  const configured = [];
  const guests = new BrowserGuests(() => host, (partition) => {
    const ses = { partition };
    created.push(ses);
    return ses;
  });
  guests.configureSession = (ses) => configured.push(ses);
  return { guests, configured, created };
}

test('acquire issues a lease and one locked partition per workspace', () => {
  const { guests, configured } = fixture();
  const owner = { tag: 'owner' };
  const a = guests.acquire(owner, 'ws-1');
  const b = guests.acquire(owner, 'ws-1');
  assert.match(a.partition, /^dsh-sidebar-browser-/u);
  assert.equal(a.partition, b.partition);
  assert.notEqual(a.lease, b.lease);
  assert.equal(configured.length, 1); // session configured once per partition
  const other = guests.acquire(owner, 'ws-2');
  assert.notEqual(other.partition, a.partition);
  assert.equal(configured.length, 2);
});

test('acquire rejects bad workspace identities', () => {
  const { guests } = fixture();
  assert.throws(() => guests.acquire({}, ''), /storage identity/);
  assert.throws(() => guests.acquire({}, 'x'.repeat(4097)), /storage identity/);
  assert.throws(() => guests.acquire({}, 42), /storage identity/);
});

test("release refuses another document's lease", async () => {
  const { guests } = fixture();
  const owner = { tag: 'owner' };
  const other = { tag: 'other' };
  const { lease } = guests.acquire(owner, 'ws-1');
  await assert.rejects(() => guests.release(other, lease), /another document/);
  await guests.release(owner, lease); // idempotent
  await guests.release(owner, lease);
});

test('navigation allowlist blocks the Host origin, creds, and non-http', () => {
  const { guests } = fixture();
  assert.equal(guests.allowedNavigation('https://example.com/'), true);
  assert.equal(guests.allowedNavigation('http://127.0.0.1:3080/'), false); // Host
  assert.equal(guests.allowedNavigation('http://localhost:3080/x'), false); // Host alias
  assert.equal(guests.allowedNavigation('http://127.0.0.1:9999/'), true); // different port
  assert.equal(guests.allowedNavigation('https://user:pass@example.com/'), false);
  assert.equal(guests.allowedNavigation('file:///etc/passwd'), false);
  assert.equal(guests.allowedNavigation('javascript:alert(1)'), false);
  assert.equal(guests.allowedNavigation('not a url'), false);
});

test('installBrowserGuests handles null view, empty origin, and port-prefix collisions safely', async () => {
  const { installBrowserGuests } = require('./browser-guests');
  const handlers = new Map();
  const ipcMain = { handle(ch, fn) { handlers.set(ch, fn); } };
  const mainFrame = { url: 'http://127.0.0.1:30801/' };
  const webContents = { mainFrame, isDestroyed: () => false };
  let currentView = null;
  let currentOrigin = '';
  installBrowserGuests(fixture().guests, {
    ipcMain,
    getView: () => currentView,
    getOrigin: () => currentOrigin,
  });
  const acquire = handlers.get('shell:browser-acquire');
  assert.throws(() => acquire({ sender: webContents, senderFrame: mainFrame }, 'ws-1'), /rejected sender/);
  currentView = { webContents };
  assert.throws(() => acquire({ sender: webContents, senderFrame: mainFrame }, 'ws-1'), /rejected sender/);
  currentOrigin = 'http://127.0.0.1:3080';
  assert.throws(() => acquire({ sender: webContents, senderFrame: mainFrame }, 'ws-1'), /rejected sender/);
  mainFrame.url = 'http://127.0.0.1:3080/chat';
  assert.ok(acquire({ sender: webContents, senderFrame: mainFrame }, 'ws-1').lease);
});
