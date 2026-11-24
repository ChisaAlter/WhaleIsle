'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { gzipSync } = require('node:zlib');
const { planDelta } = require('./index');

function blockmap(checksums, sizes) {
  return gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums, sizes }] }));
}

function fakeFetch(maps) {
  return async (url) => ({ ok: true, status: 200, arrayBuffer: async () => maps[url] });
}

test('planDelta counts only the blocks electron-updater would download', async () => {
  const maps = {
    'https://example.test/old.blockmap': blockmap(['a', 'b', 'c', 'd'], [100, 200, 300, 400]),
    'https://example.test/new.blockmap': blockmap(['a', 'x', 'c', 'y'], [100, 250, 300, 50]),
  };
  const result = await planDelta({ version: '9.9.9', blockmapUrl: 'https://example.test/new.blockmap' }, {
    updater: { differentialAvailability: async () => ({ ok: true, blockmapUrl: 'https://example.test/old.blockmap' }) },
    fetch: fakeFetch(maps),
  });
  assert.deepEqual(result, { ok: true, downloadBytes: 300 });
});

test('planDelta reports why a delta is unavailable instead of throwing', async () => {
  const result = await planDelta({ version: '9.9.9', blockmapUrl: 'x' }, {
    updater: { differentialAvailability: async () => ({ ok: false, reason: 'missing-base-release', message: 'no base' }) },
    fetch: async () => { throw new Error('must not fetch'); },
  });
  assert.deepEqual(result, { ok: false, reason: 'missing-base-release', message: 'no base' });
});

test('UpdateCenterWindow guards will-navigate/will-redirect and owns() validates mainFrame + page URL', () => {
  const { EventEmitter } = require('node:events');
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const { UpdateCenterWindow } = require('./ipc');
  const pageUrl = pathToFileURL(path.join(__dirname, '..', '..', 'renderer', 'update-center.html')).href;

  class FakeWin extends EventEmitter {
    constructor() {
      super();
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: `${pageUrl}?scheme=dark` },
      });
    }
    isDestroyed() { return false; }
    focus() {}
    destroy() {}
    loadURL() { return Promise.resolve(); }
  }

  const fakeWin = new FakeWin();
  const centerWin = new UpdateCenterWindow({
    overlays: { create: () => fakeWin },
    preload: 'preload.js',
    page: pageUrl,
    theme: () => ({ scheme: 'dark' }),
    isMaximized: () => false,
  });

  const parent = { isDestroyed: () => false };
  centerWin.open(parent);

  // Navigation guard rejects external / foreign file URLs and allows update-center.html
  for (const evName of ['will-navigate', 'will-redirect']) {
    let blocked = false;
    fakeWin.webContents.emit(evName, { preventDefault() { blocked = true; } }, 'https://evil.example/');
    assert.equal(blocked, true, `${evName} must block https`);
    let allowed = true;
    fakeWin.webContents.emit(evName, { preventDefault() { allowed = false; } }, `${pageUrl}?scheme=light`);
    assert.equal(allowed, true, `${evName} must allow update-center.html`);
  }

  assert.equal(centerWin.owns(fakeWin.webContents, fakeWin.webContents.mainFrame), true);
  assert.equal(centerWin.owns(fakeWin.webContents, { url: pageUrl }), false);
  fakeWin.webContents.mainFrame.url = 'https://evil.example/';
  assert.equal(centerWin.owns(fakeWin.webContents, fakeWin.webContents.mainFrame), false);
});
