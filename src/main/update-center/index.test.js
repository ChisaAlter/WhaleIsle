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
