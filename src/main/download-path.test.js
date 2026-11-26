const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  DEFAULT_DOWNLOAD_NAME,
  MAX_DOWNLOAD_NAME_CHARS,
  sanitizeDownloadFilename,
  downloadSavePath,
} = require('./download-path');

test('sanitizeDownloadFilename strips path components from both separator styles', () => {
  assert.equal(sanitizeDownloadFilename('../../outside.txt'), 'outside.txt');
  assert.equal(sanitizeDownloadFilename('..\\..\\outside.txt'), 'outside.txt');
});

test('sanitizeDownloadFilename removes unsafe characters and device names', () => {
  assert.equal(sanitizeDownloadFilename('report\0\r\n:2026?.txt'), 'report____2026_.txt');
  assert.equal(sanitizeDownloadFilename('CON.txt'), '_CON.txt');
  assert.equal(sanitizeDownloadFilename('CONIN$.txt'), '_CONIN$.txt');
  assert.equal(sanitizeDownloadFilename('COM\u00b9.txt'), '_COM\u00b9.txt');
  assert.equal(sanitizeDownloadFilename('...   '), DEFAULT_DOWNLOAD_NAME);
});

test('sanitizeDownloadFilename bounds long names', () => {
  assert.equal(Array.from(sanitizeDownloadFilename('a'.repeat(500))).length, MAX_DOWNLOAD_NAME_CHARS);
});

test('downloadSavePath always resolves immediately inside downloads', () => {
  const root = path.resolve('C:\\Downloads');
  const target = downloadSavePath(root, '..\\..\\payload.exe');
  assert.equal(path.dirname(target), root);
  assert.equal(path.basename(target), 'payload.exe');
});

test('downloadSavePath deduplicates disk and concurrent reserved paths', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-path-'));
  try {
    fs.writeFileSync(path.join(root, 'report.pdf'), 'one');
    fs.writeFileSync(path.join(root, 'report (1).pdf'), 'two');
    const reserved = new Set([path.join(root, 'REPORT (2).pdf')]);
    const next = downloadSavePath(root, 'report.pdf', { reserved });
    const expected = process.platform === 'win32' ? 'report (3).pdf' : 'report (2).pdf';
    assert.equal(path.basename(next), expected);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createDownloadCollisionHandler reserves unique paths and releases on done or error', () => {
  const { EventEmitter } = require('node:events');
  const fs = require('node:fs');
  const os = require('node:os');
  const { createDownloadCollisionHandler } = require('./download-path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-handler-'));
  try {
    const sess = new EventEmitter();
    sess.on('will-download', createDownloadCollisionHandler({ getPath: () => root }));
    const makeItem = (name, failSet = false) => {
      const item = new EventEmitter();
      item.saved = '';
      item.getFilename = () => name;
      item.setSavePath = (dest) => {
        if (failSet) throw new Error('disk full');
        item.saved = dest;
      };
      return item;
    };
    const first = makeItem('archive.zip');
    const second = makeItem('archive.zip');
    sess.emit('will-download', {}, first);
    sess.emit('will-download', {}, second);
    assert.equal(path.basename(first.saved), 'archive.zip');
    assert.equal(path.basename(second.saved), 'archive (1).zip');

    first.emit('done');
    const third = makeItem('archive.zip');
    sess.emit('will-download', {}, third);
    assert.equal(path.basename(third.saved), 'archive.zip');

    const failed = makeItem('temp.bin', true);
    assert.throws(() => sess.emit('will-download', {}, failed), /disk full/);
    const afterFail = makeItem('temp.bin');
    sess.emit('will-download', {}, afterFail);
    assert.equal(path.basename(afterFail.saved), 'temp.bin');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
