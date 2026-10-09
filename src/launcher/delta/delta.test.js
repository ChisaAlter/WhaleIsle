'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zip = require('./zip');
const manifest = require('./manifest');
const { buildDelta, scanTree } = require('./build');
const { applyDeltaFile, DeltaApplyError } = require('./apply');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-delta-'));
}

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

async function treeHashes(root) {
  const tree = await scanTree(root);
  return Object.fromEntries([...tree.entries()].map(([rel, row]) => [rel, row.sha256]));
}

// --- zip container -----------------------------------------------------------

test('crc32 matches the standard check vector', () => {
  assert.equal(zip.crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(zip.crc32(Buffer.alloc(0)), 0);
});

test('writeZip/readZip round-trips store and deflate entries with crc checks', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'a.zip');
  const big = Buffer.alloc(200_000, 65); // compressible → deflate path
  const raw = Buffer.from('short-uncompressible-ish');
  zip.writeZip(file, [
    { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'payload/0', data: big },
    { name: 'payload/1', file: (() => { const p = path.join(dir, 'src.bin'); fs.writeFileSync(p, raw); return p; })() },
  ]);
  const entries = zip.readZip(file);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, 'manifest.json');
  assert.equal(entries[1].method, zip.METHOD_DEFLATE);
  assert.equal(entries[2].method, zip.METHOD_STORE);
  assert.deepEqual(zip.readEntry(file, entries[0]).toString(), '{"a":1}');
  assert.deepEqual(zip.readEntry(file, entries[1]), big);
  assert.deepEqual(zip.readEntry(file, entries[2]), raw);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readZip rejects a non-zip file', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'nope.zip');
  fs.writeFileSync(file, 'definitely not zip');
  assert.throws(() => zip.readZip(file), /end-of-central-directory/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readEntry throws on corrupted payload crc', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'b.zip');
  zip.writeZip(file, [{ name: 'x.bin', data: Buffer.from('hello world') }]);
  const entries = zip.readZip(file);
  // Flip a byte inside the stored payload region.
  const fd = fs.openSync(file, 'r+');
  const head = Buffer.alloc(30);
  fs.readSync(fd, head, 0, 30, entries[0].localOffset);
  const dataAt = entries[0].localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  fs.writeSync(fd, Buffer.from([0xff]), 0, 1, dataAt);
  fs.closeSync(fd);
  assert.throws(() => zip.readEntry(file, entries[0]), /crc32 mismatch/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- manifest ----------------------------------------------------------------

test('validateManifest accepts a well-formed document', () => {
  const doc = manifest.validateManifest({
    format: manifest.FORMAT,
    product: 'Whale-Isle',
    fromVersion: '0.3.2',
    toVersion: '0.3.3',
    files: [
      { path: 'a/b.txt', op: 'add', sha256: 'a'.repeat(64), size: 3, payload: 'payload/0' },
      { path: 'c.txt', op: 'patch', baseSha256: 'b'.repeat(64), sha256: 'c'.repeat(64), size: 5, payload: 'payload/1' },
      { path: 'd.txt', op: 'delete', baseSha256: 'd'.repeat(64) },
    ],
  });
  assert.equal(doc.files.length, 3);
  assert.equal(doc.files[1].baseSha256, 'b'.repeat(64));
});

test('validateManifest rejects traversal and absolute paths', () => {
  const bad = ['../x', 'a/../b', 'C:/win/x', 'C:\\win\\x', '/abs', 'a//b', '', '.', 'a\\b'];
  for (const p of bad) {
    assert.throws(
      () => manifest.validateManifest({
        format: manifest.FORMAT,
        fromVersion: '1',
        toVersion: '2',
        files: [{ path: p, op: 'delete', baseSha256: 'd'.repeat(64) }],
      }),
      /unsafe|escapes|invalid/i,
      `path should be rejected: ${JSON.stringify(p)}`,
    );
  }
});

test('validateManifest rejects bad ops, missing hashes, and duplicate paths', () => {
  const base = { format: manifest.FORMAT, fromVersion: '1', toVersion: '2' };
  assert.throws(() => manifest.validateManifest({ ...base, files: [{ path: 'a', op: 'move' }] }), /add\|patch\|delete/);
  assert.throws(() => manifest.validateManifest({ ...base, files: [{ path: 'a', op: 'patch', sha256: 'a'.repeat(64), size: 1, payload: 'p/0' }] }), /baseSha256/);
  assert.throws(() => manifest.validateManifest({
    ...base,
    files: [
      { path: 'a', op: 'delete', baseSha256: 'd'.repeat(64) },
      { path: 'a', op: 'delete', baseSha256: 'd'.repeat(64) },
    ],
  }), /duplicate/);
});

test('deltaAssetName + parseDeltaAssetName round-trip', () => {
  const name = manifest.deltaAssetName('Whale Isle', '0.3.2', '0.3.3');
  assert.equal(name, 'Whale-Isle-delta-0.3.2-0.3.3.zip');
  assert.deepEqual(manifest.parseDeltaAssetName(name), { from: '0.3.2', to: '0.3.3' });
  assert.equal(manifest.parseDeltaAssetName('Whale-Isle-Setup-0.3.3.exe'), null);
  assert.deepEqual(manifest.parseDeltaAssetName('x-delta-v1.0-v2.0.zip'), { from: 'v1.0', to: 'v2.0' });
});

// --- build + apply round-trip -------------------------------------------------

const FROM_TREE = {
  'app.exe': 'old-exe-bytes',
  'lib/keep.dll': 'same-dll',
  'lib/change.dll': 'old-dll-content',
  'lib/old-only.dat': 'remove me',
  'res/deep/dir/gone.txt': 'nested delete',
};

const TO_TREE = {
  'app.exe': 'new-exe-bytes-longer',
  'lib/keep.dll': 'same-dll',
  'lib/change.dll': 'new-dll-content',
  'lib/new-only.dat': 'brand new',
};

test('buildDelta emits add/patch/delete ops and applyDeltaFile reproduces the to-tree', async () => {
  const dir = tmpdir();
  const fromDir = path.join(dir, 'from');
  const toDir = path.join(dir, 'to');
  const target = path.join(dir, 'target');
  writeTree(fromDir, FROM_TREE);
  writeTree(toDir, TO_TREE);
  fs.cpSync(fromDir, target, { recursive: true });

  const out = path.join(dir, 'delta.zip');
  const built = await buildDelta({
    fromDir, toDir, outFile: out, product: 'Test', fromVersion: '1.0.0', toVersion: '2.0.0',
  });
  const ops = Object.fromEntries(built.manifest.files.map((f) => [f.path, f.op]));
  assert.equal(ops['app.exe'], 'patch');
  assert.equal(ops['lib/change.dll'], 'patch');
  assert.equal(ops['lib/new-only.dat'], 'add');
  assert.equal(ops['lib/old-only.dat'], 'delete');
  assert.equal(ops['res/deep/dir/gone.txt'], 'delete');
  assert.equal(ops['lib/keep.dll'], undefined);
  assert.equal(built.stats.unchanged, 1);
  assert.equal(/^[0-9a-f]{128}$/.test(built.sha512), true);

  const progress = [];
  const result = await applyDeltaFile(out, target, {
    expectedSha512: built.sha512, expectedProduct: 'Test',
    expectedFromVersion: 'v1.0.0', expectedToVersion: 'v2.0.0',
    onProgress: (p) => progress.push(p),
  });
  assert.equal(result.ok, true);
  assert.equal(result.toVersion, '2.0.0');
  assert.deepEqual(await treeHashes(target), await treeHashes(toDir));
  // Deleted parents prune; staging is gone.
  assert.equal(fs.existsSync(path.join(target, 'res')), false);
  assert.equal(fs.readdirSync(target).filter((n) => n.startsWith('.dshd-delta-')).length, 0);
  assert.ok(progress.some((p) => p.phase === 'apply'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyDeltaFile refuses a different product or version without modifying the installed tree', async () => {
  const dir = tmpdir();
  const fromDir = path.join(dir, 'from');
  const toDir = path.join(dir, 'to');
  const target = path.join(dir, 'target');
  writeTree(fromDir, FROM_TREE);
  writeTree(toDir, TO_TREE);
  fs.cpSync(fromDir, target, { recursive: true });
  const before = await treeHashes(target);
  const out = path.join(dir, 'delta.zip');
  const built = await buildDelta({
    fromDir, toDir, outFile: out, product: 'Whale-Isle', fromVersion: '1.0.0', toVersion: '2.0.0',
  });
  let stopped = 0;
  try {
    for (const incorrect of [
      { expectedProduct: 'Another-Product' },
      { expectedFromVersion: '1.0.1' },
      { expectedToVersion: '2.0.1' },
    ]) {
      await assert.rejects(() => applyDeltaFile(out, target, {
        expectedSha512: built.sha512,
        expectedProduct: 'Whale-Isle', expectedFromVersion: '1.0.0', expectedToVersion: '2.0.0',
        beforeApply: async () => { stopped++; return { ok: true }; },
        ...incorrect,
      }), error => error.code === 'manifest-target-mismatch');
      assert.deepEqual(await treeHashes(target), before);
      assert.equal(stopped, 0, 'wrong product/version must not request desktop shutdown');
      assert.equal(fs.readdirSync(target).some(name => name.startsWith('.dshd-delta-')), false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyDeltaFile fails closed on base drift without stopping the desktop or modifying the tree', async () => {
  const dir = tmpdir();
  const fromDir = path.join(dir, 'from');
  const toDir = path.join(dir, 'to');
  const target = path.join(dir, 'target');
  writeTree(fromDir, FROM_TREE);
  writeTree(toDir, TO_TREE);
  fs.cpSync(fromDir, target, { recursive: true });
  const before = await treeHashes(target);
  fs.writeFileSync(path.join(target, 'lib', 'change.dll'), 'user-modified');

  const out = path.join(dir, 'delta.zip');
  await buildDelta({ fromDir, toDir, outFile: out });
  let stopped = 0;
  await assert.rejects(
    () => applyDeltaFile(out, target, { beforeApply: async () => { stopped++; return { ok: true }; } }),
    (error) => error instanceof DeltaApplyError && error.code === 'base-mismatch',
  );
  assert.equal(stopped, 0);
  const after = await treeHashes(target);
  assert.equal(after['lib/change.dll'], manifest.sha256Hex(Buffer.from('user-modified')));
  delete before['lib/change.dll'];
  delete after['lib/change.dll'];
  assert.deepEqual(after, before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyDeltaFile preserves protected shutdown refusal before creating staging or changing target files', async () => {
  const dir = tmpdir();
  const fromDir = path.join(dir, 'from');
  const toDir = path.join(dir, 'to');
  const target = path.join(dir, 'target');
  writeTree(fromDir, FROM_TREE);
  writeTree(toDir, TO_TREE);
  fs.cpSync(fromDir, target, { recursive: true });
  const before = await treeHashes(target);
  const out = path.join(dir, 'delta.zip');
  await buildDelta({ fromDir, toDir, outFile: out });
  const refusal = { ok: false, cancelled: true, error: 'peer-cancelled' };
  try {
    const result = await applyDeltaFile(out, target, { beforeApply: async () => refusal });
    assert.equal(result, refusal);
    assert.deepEqual(await treeHashes(target), before);
    assert.equal(fs.readdirSync(target).some(name => name.startsWith('.dshd-delta-')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyDeltaFile rejects artifact sha512 mismatch before reading the manifest', async () => {
  const dir = tmpdir();
  const fromDir = path.join(dir, 'from');
  const toDir = path.join(dir, 'to');
  const target = path.join(dir, 'target');
  writeTree(fromDir, FROM_TREE);
  writeTree(toDir, TO_TREE);
  fs.cpSync(fromDir, target, { recursive: true });
  const out = path.join(dir, 'delta.zip');
  await buildDelta({ fromDir, toDir, outFile: out });
  await assert.rejects(
    () => applyDeltaFile(out, target, { expectedSha512: '0'.repeat(128) }),
    (error) => error.code === 'artifact-sha512-mismatch',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyDeltaFile rejects an add that collides with foreign content', async () => {
  const dir = tmpdir();
  const fromDir = path.join(dir, 'from');
  const toDir = path.join(dir, 'to');
  const target = path.join(dir, 'target');
  writeTree(fromDir, FROM_TREE);
  writeTree(toDir, TO_TREE);
  fs.cpSync(fromDir, target, { recursive: true });
  fs.writeFileSync(path.join(target, 'lib', 'new-only.dat'), 'foreign');
  const out = path.join(dir, 'delta.zip');
  await buildDelta({ fromDir, toDir, outFile: out });
  await assert.rejects(
    () => applyDeltaFile(out, target, {}),
    (error) => error.code === 'base-mismatch',
  );
  assert.equal(fs.readFileSync(path.join(target, 'lib', 'new-only.dat'), 'utf8'), 'foreign');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyDeltaFile is idempotent for already-add targets and no-op deletes', async () => {
  const dir = tmpdir();
  const fromDir = path.join(dir, 'from');
  const toDir = path.join(dir, 'to');
  writeTree(fromDir, FROM_TREE);
  writeTree(toDir, TO_TREE);
  const out = path.join(dir, 'delta.zip');
  await buildDelta({ fromDir, toDir, outFile: out });
  // Apply twice: second run sees adds already correct and deletes absent.
  fs.cpSync(fromDir, path.join(dir, 'target'), { recursive: true });
  await applyDeltaFile(out, path.join(dir, 'target'), {});
  const again = await applyDeltaFile(out, path.join(dir, 'target'), {});
  assert.equal(again.ok, true);
  assert.ok(again.applied.skipped > 0);
  assert.deepEqual(await treeHashes(path.join(dir, 'target')), await treeHashes(toDir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyDeltaFile rejects a manifest with a hostile path', async () => {
  const dir = tmpdir();
  const evil = path.join(dir, 'evil.zip');
  const doc = {
    format: manifest.FORMAT,
    fromVersion: '1',
    toVersion: '2',
    files: [{ path: '../escape.txt', op: 'add', sha256: 'a'.repeat(64), size: 1, payload: 'payload/0' }],
  };
  zip.writeZip(evil, [
    { name: 'payload/0', data: Buffer.from('x') },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(doc)) },
  ]);
  const target = path.join(dir, 'target');
  fs.mkdirSync(target, { recursive: true });
  await assert.rejects(
    () => applyDeltaFile(evil, target, {}),
    (error) => error.code === 'manifest-invalid',
  );
  assert.equal(fs.existsSync(path.join(dir, 'escape.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
