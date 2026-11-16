'use strict';

// Property-based fuzz for the delta manifest path gate (isSafeRelPath), the
// manifest schema (validateManifest) and the delta asset name round-trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fc = require('fast-check');

const manifest = require('./manifest');

const NUM_RUNS = 200;

const relPathArb = fc.oneof(
  // ':' stays out of this pool — colon segments are the tracked FINDING below.
  fc.string({
    unit: fc.constantFrom(
      'a', 'B', '1', '.', '/', '\\', '_', '-', ' ', '..', 'sub/',
      '中', '\x00', '\x1f', '/',
    ),
    minLength: 0, maxLength: 40,
  }),
  fc.constantFrom(
    'a.txt', 'sub/dir/f.js', '../x', 'a/../b', '/abs', 'a\\b', 'C:\\x',
    'd:/x', '.', '..', 'a//b', 'a/./c', 'x/', '/x', 'x'.repeat(512), 'x'.repeat(513),
    'a..b/c', '.../x', 'a/b/c', ' a', 'a ',
  ),
);

function resolvesInside(root, rel) {
  const full = path.resolve(root, ...rel.split('/'));
  const win = path.win32.resolve('C:\\install', ...rel.split('/'));
  return (full === root || full.startsWith(root + path.sep))
    && (win === 'C:\\install' || win.startsWith('C:\\install\\'));
}

test('isSafeRelPath: accepted paths resolve inside the target on posix and win32', () => {
  fc.assert(fc.property(relPathArb, (rel) => {
    if (!manifest.isSafeRelPath(rel)) return true;
    assert.ok(resolvesInside(path.sep === '/' ? '/install' : 'C:\\install', rel), rel);
    assert.equal(rel.includes('\\'), false, rel);
    assert.equal(/[\0-\x1f]/.test(rel), false, rel);
    assert.equal(rel.length <= 512, true, rel);
    for (const seg of rel.split('/')) {
      assert.ok(seg !== '' && seg !== '.' && seg !== '..', rel);
    }
    return true;
  }), { numRuns: NUM_RUNS });
});

test('isSafeRelPath: explicit hazards are always refused', () => {
  const withTraversal = fc.array(
    fc.string({ unit: fc.constantFrom('a', 'b', 'x-y'), minLength: 1, maxLength: 5 }),
    { minLength: 0, maxLength: 3 },
  ).chain((segs) => fc.constantFrom('..', '.', '', 'a\\b').map((bad) => {
    const all = segs.slice();
    all.splice(Math.floor(segs.length / 2), 0, bad);
    return all.join('/');
  }));
  fc.assert(fc.property(withTraversal, (rel) => {
    assert.equal(manifest.isSafeRelPath(rel), false, rel);
  }), { numRuns: NUM_RUNS });
});

// FINDING (see report): `:` inside a path segment is accepted although the
// win32 resolver treats it as a drive-relative anchor — `sub/a:` resolves
// to `a:\…\sub` (another drive, escaping the target), `a/z:d/x` to
// `z:\…\a\d\x`, `a/c:d/x` aliases to `a/d/x`. resolveTarget refuses the
// escape at apply time, but the manifest gate itself lets through paths
// that alias or fail later; ':' should join the rejected set.
test.todo('#493: isSafeRelPath must reject `:` inside path segments — minimal counterexamples: sub/a: (escapes to the A: drive on win32), a/c:d/a (accepted; aliases to a/d/a)');

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
  fc.assert(fc.property(docArb, (doc) => {
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
  }), { numRuns: NUM_RUNS });
});

// FINDING (see report): deltaAssetName interpolates the raw versions, but
// ASSET_RE cannot re-parse versions containing '-' — a prerelease such as
// `0.3.15-beta` produces an asset name that parseDeltaAssetName rejects, so
// pickDeltaAsset would never select it.
test.todo('#493: delta asset name round-trips for `-` versions — minimal counterexample: from="0-0" → parseDeltaAssetName(deltaAssetName("app","0-0","0")) === null');

test('delta asset name round-trips through parseDeltaAssetName', () => {
  const versionArb = fc.string({
    unit: fc.constantFrom('0', '1', '2', '9', '.', 'v', 'a', 'B', 'x'),
    minLength: 1, maxLength: 12,
  }).filter((v) => /^v?[0-9][0-9A-Za-z.]*$/.test(v));
  const productArb = fc.string({
    unit: fc.constantFrom('a', 'B', '0', ' ', '-', '_', '.', '/', '\\', '中'),
    maxLength: 10,
  });
  fc.assert(fc.property(productArb, versionArb, versionArb, (product, from, to) => {
    const name = manifest.deltaAssetName(product, from, to);
    const parsed = manifest.parseDeltaAssetName(name);
    assert.deepEqual(parsed, { from, to }, name);
    return true;
  }), { numRuns: NUM_RUNS });
});
