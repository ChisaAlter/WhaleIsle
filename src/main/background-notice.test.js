'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { TrayHideNotice } = require('./background-notice');

// 本文件所有 mkdtemp 目录统一登记，套件结束后无论成败一并回收（#478）。
const tempDirs = [];
test.after(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-tray-'));
  tempDirs.push(dir);
  return dir;
}

function fixture() {
  const dir = tempDir();
  let notified = 0;
  const notice = new TrayHideNotice({
    markerPath: path.join(dir, 'ack'),
    notify: () => { notified += 1; },
  });
  return { dir, notice, getNotified: () => notified };
}

test('first close hides and toasts once; later closes hide silently', () => {
  const f = fixture();
  let hides = 0;
  f.notice.close(() => { hides += 1; });
  assert.equal(hides, 1); // hide is never blocked on a prompt
  assert.equal(f.getNotified(), 1);
  assert.ok(fs.existsSync(path.join(f.dir, 'ack')));

  f.notice.close(() => { hides += 1; });
  assert.equal(hides, 2);
  assert.equal(f.getNotified(), 1);
});

test('a pre-existing marker suppresses the toast entirely', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'ack'), '');
  let notified = 0;
  const notice = new TrayHideNotice({
    markerPath: path.join(dir, 'ack'),
    notify: () => { notified += 1; },
  });
  let hides = 0;
  notice.close(() => { hides += 1; });
  assert.equal(hides, 1);
  assert.equal(notified, 0);
});

test('a failing toast still leaves the hide and the marker in place', () => {
  const dir = tempDir();
  const notice = new TrayHideNotice({
    markerPath: path.join(dir, 'ack'),
    notify: () => { throw new Error('toast backend down'); },
  });
  let hides = 0;
  notice.close(() => { hides += 1; });
  assert.equal(hides, 1);
  assert.ok(fs.existsSync(path.join(dir, 'ack')));
});

test('dispose suppresses the hide', () => {
  const f = fixture();
  let hides = 0;
  f.notice.dispose();
  f.notice.close(() => { hides += 1; });
  assert.equal(hides, 0);
  assert.equal(f.getNotified(), 0);
});
