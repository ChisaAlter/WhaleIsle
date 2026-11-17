'use strict';

// Property-based fuzz for the delta manifest path gate (isSafeRelPath), the
// manifest schema (validateManifest) and the delta asset name round-trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fc = require('fast-check');

const manifest = require('./manifest');
const { WINDOWS_DEVICE_NAME } = require('../../main/download-path');
const { fuzzAssert } = require('../../../scripts/lib/fuzz.cjs');

const NUM_RUNS = 200;

const relPathArb = fc.oneof(
  fc.string({
    unit: fc.constantFrom(
      'a', 'B', '1', '.', '/', '\\', '_', '-', ' ', ':', '..', 'sub/',
      'con', 'a.', 'b ', '中', '\x00', '\x1f', '/',
    ),
    minLength: 0, maxLength: 40,
  }),
  fc.constantFrom(
    'a.txt', 'sub/dir/f.js', '../x', 'a/../b', '/abs', 'a\\b', 'C:\\x',
    'd:/x', '.', '..', 'a//b', 'a/./c', 'x/', '/x', 'x'.repeat(512), 'x'.repeat(513),
    'a..b/c', '.../x', 'a/b/c', ' a', 'a ', 'sub/a:', 'a/c:d/a', 'a/z:d/x',
    'con', 'nul.txt', 'a/com1/b', 'lpt9/x', 'com¹', 'a./b',
  ),
);

function resolvesInside(root, rel) {
  const full = path.resolve(root, ...rel.split('/'));
  const win = path.win32.resolve('C:\\install', ...rel.split('/'));
  return (full === root || full.startsWith(root + path.sep))
    && (win === 'C:\\install' || win.startsWith('C:\\install\\'));
}

test('isSafeRelPath: accepted paths resolve inside the target on posix and win32', () => {
  fuzzAssert(fc.property(relPathArb, (rel) => {
    if (!manifest.isSafeRelPath(rel)) return true;
    assert.ok(resolvesInside(path.sep === '/' ? '/install' : 'C:\\install', rel), rel);
    assert.equal(rel.includes('\\'), false, rel);
    assert.equal(rel.includes(':'), false, rel);
    assert.equal(/[\0-\x1f]/.test(rel), false, rel);
    assert.equal(rel.length <= 512, true, rel);
    for (const seg of rel.split('/')) {
      assert.ok(seg !== '' && seg !== '.' && seg !== '..', rel);
      assert.equal(/[. ]$/.test(seg), false, rel);
      assert.equal(WINDOWS_DEVICE_NAME.test(seg), false, rel);
    }
    return true;
  }), 'isSafeRelPath: accepted paths resolve inside the target on posix and win32', { numRuns: NUM_RUNS });
});

test('isSafeRelPath: explicit hazards are always refused', () => {
  const withTraversal = fc.array(
    fc.string({ unit: fc.constantFrom('a', 'b', 'x-y'), minLength: 1, maxLength: 5 }),
    { minLength: 0, maxLength: 3 },
  ).chain((segs) => fc.constantFrom(
    '..', '.', '', 'a\\b', 'a:b', 'x:', 'con', 'nul.txt', 'a.', 'a ',
  ).map((bad) => {
    const all = segs.slice();
    all.splice(Math.floor(segs.length / 2), 0, bad);
    return all.join('/');
  }));
  fuzzAssert(fc.property(withTraversal, (rel) => {
    assert.equal(manifest.isSafeRelPath(rel), false, rel);
  }), 'isSafeRelPath: explicit hazards are always refused', { numRuns: NUM_RUNS });
});

// `:` inside a path segment is a win32 drive-relative anchor: `sub/a:`
// resolves to `a:\…\sub` (another drive, escaping the target), `a/z:d/x` to
// `z:\…\a\d\x`, `a/c:d/x` aliases `a/d/x`. The gate refuses every such path.
test('isSafeRelPath refuses `:` segments, device names and trailing dot/space', () => {
  const refused = [
    'sub/a:', 'a/c:d/a', 'a/z:d/x', 'x:y', 'a:b/c',
    'con', 'CON', 'nul.txt', 'a/com1/b', 'sub/lpt³/x', 'conin$/x', 'com¹/x',
    'a./b', 'a /b', 'x.', 'x ', 'a.../b',
  ];
  for (const rel of refused) {
    assert.equal(manifest.isSafeRelPath(rel), false, rel);
  }
  const accepted = ['a/b/c', 'a..b/c', 'a.txt', 'sub/dir/f.js', ' a', 'a-b_c.txt', 'content.js'];
  for (const rel of accepted) {
    assert.equal(manifest.isSafeRelPath(rel), true, rel);
  }
});

test('validateManifest: accepted docs only carry safe paths and valid ops', () => {
  const hexArb = fc.oneof(
    fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 64, maxLength: 64 }),
    fc.string({ unit: fc.constantFrom('0', '1', 'a', 'f', 'g', 'Z', '!'), maxLength: 70 }),
  );
  const fileArb = fc.record({
    path: relPathArb,
    op: fc.oneof(fc.constantFrom('add', 'patch', 'delete'), fc.string({ maxLength: 8 })),
    sha256: hexArb,
    baseSha256: hexArb,
    size: fc.oneof(fc.nat({ max: 1000 }), fc.integer({ min: -5, max: 0 }), fc.double()),
    payload: relPathArb,
  });
  const docArb = fc.record({
    format: fc.oneof(fc.constant(manifest.FORMAT), fc.string({ maxLength: 16 })),
    product: fc.string({ maxLength: 12 }),
    fromVersion: fc.string({ maxLength: 10 }),
    toVersion: fc.string({ maxLength: 10 }),
    files: fc.array(fileArb, { minLength: 0, maxLength: 6 }),
  });
  fuzzAssert(fc.property(docArb, (doc) => {
    let out;
    try {
      out = manifest.validateManifest(JSON.stringify(doc));
    } catch (error) {
      assert.ok(error instanceof Error);
      return true;
    }
    for (const row of out.files) {
      assert.equal(manifest.isSafeRelPath(row.path), true, row.path);
      assert.ok(row.op === 'add' || row.op === 'patch' || row.op === 'delete');
      if (row.op !== 'delete') {
        assert.match(row.sha256, /^[0-9a-f]{64}$/);
        assert.equal(manifest.isSafeRelPath(row.payload), true, row.payload);
      }
    }
    return true;
  }), 'validateManifest: accepted docs only carry safe paths and valid ops', { numRuns: NUM_RUNS });
});

// deltaAssetName sanitizes versions into the ASSET_RE alphabet, so a
// prerelease like `0.3.15-beta` produces a name parseDeltaAssetName accepts
// and pickDeltaAsset can select.
test('delta asset name round-trips for `-` versions', () => {
  assert.equal(manifest.deltaAssetName('app', '0-0', '0'), 'app-delta-0-0-0.zip');
  assert.deepEqual(manifest.parseDeltaAssetName('app-delta-0-0-0.zip'), { from: '0-0', to: '0' });
  for (const [from, to] of [
    ['1.0.0-rc.1', '2.0.0'],
    ['v0.3.5', '0.3.6-rc.1+candidate'],
    ['0.3.15-beta', '0.3.16'],
  ]) {
    assert.deepEqual(manifest.parseDeltaAssetName(manifest.deltaAssetName('app', from, to)),
      { from, to }, `${from} -> ${to}`);
  }
});

test('delta asset name round-trips through parseDeltaAssetName', () => {
  const versionArb = fc.string({
    unit: fc.constantFrom('0', '1', '2', '9', '.', 'v', 'a', 'B', 'x', '-', '+'),
    minLength: 1, maxLength: 12,
  }).filter((v) => /^v?[0-9][0-9A-Za-z.+-]*$/.test(v));
  // The from/to split lands on the last `-`: a `to` ending in a
  // `-<version-start>` suffix is inherently ambiguous in this naming scheme,
  // so the property keeps `to` free of that shape (real targets are
  // normalized cores like 0.3.6 anyway).
  const toArb = versionArb.filter((v) => !/-v?[0-9]/i.test(v));
  const productArb = fc.string({
    unit: fc.constantFrom('a', 'B', '0', ' ', '-', '_', '.', '/', '\\', '中'),
    maxLength: 10,
  });
  fuzzAssert(fc.property(productArb, versionArb, toArb, (product, from, to) => {
    const name = manifest.deltaAssetName(product, from, to);
    const parsed = manifest.parseDeltaAssetName(name);
    assert.deepEqual(parsed, { from, to }, name);
    return true;
  }), 'delta asset name round-trips through parseDeltaAssetName', { numRuns: NUM_RUNS });
});
