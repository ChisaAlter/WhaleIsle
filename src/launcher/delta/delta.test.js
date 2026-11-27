'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const zlib = require('node:zlib');

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
  const bad = [
    '../x', 'a/../b', 'C:/win/x', 'C:\\win\\x', '/abs', 'a//b', '', '.', 'a\\b',
    // `:` inside any segment is a win32 drive/ADS anchor or an alias.
    'sub/a:', 'a/c:d/a', 'a/z:d/x',
    // Windows device names and trailing `.`/space alias or fail on apply.
    'con', 'nul.txt/x', 'a/com1/b', 'sub/lpt³/x', 'a./b', 'a /b', 'x.txt ',
  ];
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

test('validateManifest dedups paths under Windows case/normalization semantics', () => {
  const base = { format: manifest.FORMAT, fromVersion: '1', toVersion: '2' };
  const pairs = [
    ['a.txt', 'A.TXT'],
    ['Sub/F.js', 'sub/f.js'],
    ['café/x', 'café/x'], // NFC vs NFD spellings of the same name
  ];
  for (const [first, second] of pairs) {
    assert.throws(() => manifest.validateManifest({
      ...base,
      files: [
        { path: first, op: 'delete', baseSha256: 'd'.repeat(64) },
        { path: second, op: 'delete', baseSha256: 'd'.repeat(64) },
      ],
    }), /duplicate/, `${first} / ${second}`);
  }
  // Distinct names that merely share a prefix are not duplicates.
  const doc = manifest.validateManifest({
    ...base,
    files: [
      { path: 'a.txt', op: 'delete', baseSha256: 'd'.repeat(64) },
      { path: 'a.txt.bak', op: 'delete', baseSha256: 'd'.repeat(64) },
      { path: 'dir/a.txt', op: 'delete', baseSha256: 'd'.repeat(64) },
    ],
  });
  assert.equal(doc.files.length, 3);
});

test('validateManifest rejects a path that is an ancestor of another entry', () => {
  const base = { format: manifest.FORMAT, fromVersion: '1', toVersion: '2' };
  const patch = (p) => ({ path: p, op: 'patch', baseSha256: 'b'.repeat(64), sha256: 'c'.repeat(64), size: 1, payload: 'p/0' });
  const del = (p) => ({ path: p, op: 'delete', baseSha256: 'd'.repeat(64) });
  for (const [file, child] of [
    ['x-y', 'x-y/a'],   // the file is also used as a directory
    ['X-Y', 'x-y/a'],   // same collision under Windows case-insensitive names
    ['dir', 'dir/sub/f.js'],
  ]) {
    for (const files of [[patch(file), del(child)], [del(child), patch(file)]]) {
      assert.throws(() => manifest.validateManifest({ ...base, files }),
        /conflicting paths/, `${file} vs ${child}`);
    }
  }
  // Prefix lookalikes that are not path ancestors stay accepted.
  const doc = manifest.validateManifest({
    ...base,
    files: [
      { path: 'a.txt', op: 'delete', baseSha256: 'd'.repeat(64) },
      { path: 'a.txt.bak', op: 'delete', baseSha256: 'd'.repeat(64) },
      { path: 'dir/a', op: 'delete', baseSha256: 'd'.repeat(64) },
      { path: 'dir2/b', op: 'delete', baseSha256: 'd'.repeat(64) },
    ],
  });
  assert.equal(doc.files.length, 4);
});

test('deltaAssetName + parseDeltaAssetName round-trip', () => {
  const name = manifest.deltaAssetName('Whale Isle', '0.3.2', '0.3.3');
  assert.equal(name, 'Whale-Isle-delta-0.3.2-0.3.3.zip');
  assert.deepEqual(manifest.parseDeltaAssetName(name), { from: '0.3.2', to: '0.3.3' });
  assert.equal(manifest.parseDeltaAssetName('Whale-Isle-Setup-0.3.3.exe'), null);
  assert.deepEqual(manifest.parseDeltaAssetName('x-delta-v1.0-v2.0.zip'), { from: 'v1.0', to: 'v2.0' });
});

test('deltaAssetName round-trips prerelease and build versions', () => {
  assert.equal(manifest.deltaAssetName('app', '0-0', '0'), 'app-delta-0-0-0.zip');
  assert.deepEqual(manifest.parseDeltaAssetName('app-delta-0-0-0.zip'), { from: '0-0', to: '0' });
  for (const [from, to] of [
    ['1.0.0-rc.1', '2.0.0'],
    ['v0.3.5', '0.3.6-rc.1+candidate'],
    ['0.3.15-beta', '0.3.16'],
  ]) {
    const name = manifest.deltaAssetName('Whale-Isle', from, to);
    assert.deepEqual(manifest.parseDeltaAssetName(name), { from, to }, name);
  }
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

test('applyDeltaFile rejects a manifest using one path as both file and directory', async () => {
  const dir = tmpdir();
  const doc = {
    format: manifest.FORMAT,
    fromVersion: '1',
    toVersion: '2',
    files: [
      { path: 'X-Y', op: 'patch', baseSha256: 'b'.repeat(64), sha256: 'c'.repeat(64), size: 1, payload: 'payload/0' },
      { path: 'x-y/a', op: 'delete', baseSha256: 'd'.repeat(64) },
    ],
  };
  zip.writeZip(path.join(dir, 'conflict.zip'), [
    { name: 'payload/0', data: Buffer.from('x') },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(doc)) },
  ]);
  const target = path.join(dir, 'target');
  fs.mkdirSync(target, { recursive: true });
  await assert.rejects(
    () => applyDeltaFile(path.join(dir, 'conflict.zip'), target, {}),
    (error) => error instanceof DeltaApplyError && error.code === 'manifest-invalid',
  );
  assert.deepEqual(fs.readdirSync(target), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyDeltaFile reports a directory at a file base as base-mismatch, not raw EISDIR', async () => {
  const dir = tmpdir();
  const target = path.join(dir, 'target');
  fs.mkdirSync(path.join(target, 'x-y'), { recursive: true });
  const doc = {
    format: manifest.FORMAT,
    fromVersion: '1',
    toVersion: '2',
    files: [
      { path: 'x-y', op: 'patch', baseSha256: 'b'.repeat(64), sha256: 'c'.repeat(64), size: 1, payload: 'payload/0' },
    ],
  };
  zip.writeZip(path.join(dir, 'd.zip'), [
    { name: 'payload/0', data: Buffer.from('x') },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(doc)) },
  ]);
  await assert.rejects(
    () => applyDeltaFile(path.join(dir, 'd.zip'), target, {}),
    (error) => error instanceof DeltaApplyError && error.code === 'base-mismatch',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyDeltaFile wraps a file/dir collision mid-apply as apply-failed and rolls back', async () => {
  const dir = tmpdir();
  const target = path.join(dir, 'target');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'd'), 'installed-file');
  const data = Buffer.from('new-bytes');
  const doc = {
    format: manifest.FORMAT,
    fromVersion: '1',
    toVersion: '2',
    files: [
      { path: 'd/e', op: 'add', sha256: manifest.sha256Hex(data), size: data.length, payload: 'payload/0' },
    ],
  };
  zip.writeZip(path.join(dir, 'd.zip'), [
    { name: 'payload/0', data },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(doc)) },
  ]);
  await assert.rejects(
    () => applyDeltaFile(path.join(dir, 'd.zip'), target, {}),
    (error) => error instanceof DeltaApplyError && error.code === 'apply-failed',
  );
  // Rollback leaves the pre-apply tree and reclaims staging.
  assert.equal(fs.readFileSync(path.join(target, 'd'), 'utf8'), 'installed-file');
  assert.equal(fs.readdirSync(target).filter((n) => n.startsWith('.dshd-delta-')).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- extractEntryTo stream lifecycle (issue #536) ------------------------------

/** Collect uncaughtExceptions while `run` executes; returns what escaped. */
async function captureUncaught(run) {
  const escaped = [];
  const onUncaught = (error) => escaped.push(error);
  process.on('uncaughtException', onUncaught);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 25));
  } finally {
    process.off('uncaughtException', onUncaught);
  }
  return escaped;
}

test('extractEntryTo closes the zip stream when createWriteStream throws synchronously', async () => {
  const dir = tmpdir();
  try {
    const zipFile = path.join(dir, 'd.zip');
    zip.writeZip(zipFile, [{ name: 'payload/0', data: Buffer.from('payload-bytes') }]);
    const entry = zip.readZip(zipFile)[0];
    const sources = [];
    const impl = Object.create(fs);
    // A source whose deferred read fails — like a zip deleted under the
    // stream — must not escape as an uncaughtException when the synchronous
    // createWriteStream throw leaves it mid-open.
    impl.createReadStream = () => {
      const stream = new Readable({
        read() {
          this.destroy(Object.assign(new Error('EIO: injected read fault'), { code: 'EIO' }));
        },
      });
      sources.push(stream);
      return stream;
    };
    impl.createWriteStream = () => {
      const error = new Error('EPERM: injected fault on createWriteStream');
      error.code = 'EPERM';
      throw error;
    };
    const dest = path.join(dir, 'out');
    const escaped = await captureUncaught(async () => {
      await assert.rejects(() => zip.extractEntryTo(zipFile, entry, dest, { fs: impl }), /EPERM/);
    });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].destroyed, true, 'zip read stream leaked past the failed extract');
    assert.deepEqual(escaped, []);
    assert.equal(fs.existsSync(dest), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extractEntryTo surfaces a mid-read zip stream error and destroys the chain', async () => {
  const dir = tmpdir();
  try {
    for (const raw of [crypto.randomBytes(512), Buffer.alloc(2048, 0x61)]) {
      const zipFile = path.join(dir, `d-${raw[0] === 0x61 ? 'deflate' : 'store'}.zip`);
      zip.writeZip(zipFile, [{ name: 'payload/0', data: raw }]);
      const entry = zip.readZip(zipFile)[0];
      const sources = [];
      const impl = Object.create(fs);
      impl.createReadStream = () => {
        // Feed a valid prefix of the entry bytes, then fail — for deflate the
        // source 'error' must reach the pipeline instead of escaping.
        const prefix = entry.method === zip.METHOD_DEFLATE
          ? zlib.deflateRawSync(raw).subarray(0, 6)
          : raw.subarray(0, 16);
        const stream = new Readable({
          read() {
            this.push(prefix);
            this.destroy(Object.assign(new Error('EIO: injected mid-read fault'), { code: 'EIO' }));
          },
        });
        sources.push(stream);
        return stream;
      };
      const dest = path.join(dir, `out-${entry.method}`);
      const escaped = await captureUncaught(async () => {
        await assert.rejects(() => zip.extractEntryTo(zipFile, entry, dest, { fs: impl }), /EIO/);
      });
      assert.equal(sources.length, 1, `method=${entry.method}`);
      assert.equal(sources[0].destroyed, true, `method=${entry.method}`);
      assert.deepEqual(escaped, [], `method=${entry.method}`);
      assert.equal(fs.existsSync(dest), false, `method=${entry.method}: partial output left behind`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- ZIP bounds, inflate cap, space check, journal & recovery ----------------

test('readZip rejects out-of-bounds cdSize/cdOffset and truncated central records', () => {
  const dir = tmpdir();
  try {
    const file = path.join(dir, 'oob.zip');
    zip.writeZip(file, [{ name: 'a.txt', data: Buffer.from('hello') }]);
    const buf = fs.readFileSync(file);
    const eocdAt = buf.length - 22;
    const forged = Buffer.from(buf);
    forged.writeUInt32LE(0x7fffffff, eocdAt + 12); // cdSize far past file end
    fs.writeFileSync(file, forged);
    assert.throws(() => zip.readZip(file), /central directory bounds/);

    // Truncated central directory entry (valid bounds, cut off mid-entry)
    const trunc = Buffer.from(buf);
    trunc.writeUInt32LE(20, eocdAt + 12);
    fs.writeFileSync(file, trunc);
    assert.throws(() => zip.readZip(file), /truncated/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readEntry enforces maxOutputLength on inflateRawSync', () => {
  const dir = tmpdir();
  try {
    const file = path.join(dir, 'bomb.zip');
    const big = Buffer.alloc(64 * 1024, 0x41);
    zip.writeZip(file, [{ name: 'manifest.json', data: big }]);
    const entry = zip.readZip(file)[0];
    assert.throws(() => zip.readEntry(file, entry, { maxOutputLength: 1024 }), /exceeds max output length/);
    // Even if header lies about entry.size, inflateRawSync itself stops at maxOutputLength.
    const lied = { ...entry, size: 512 };
    assert.throws(() => zip.readEntry(file, lied, { maxOutputLength: 1024 }), /ERR_BUFFER_TOO_LARGE|buffer|length|output/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extractEntryTo aborts mid-stream when decoded bytes exceed declared entry.size', async () => {
  const dir = tmpdir();
  try {
    const file = path.join(dir, 'overrun.zip');
    const raw = Buffer.alloc(128 * 1024, 0x62);
    zip.writeZip(file, [{ name: 'payload/0', data: raw }]);
    const entry = { ...zip.readZip(file)[0], size: 1024 };
    const dest = path.join(dir, 'out.bin');
    await assert.rejects(() => zip.extractEntryTo(file, entry, dest), /exceeds declared size/);
    assert.equal(fs.existsSync(dest), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyDeltaFile runs checkInstallSpace before beforeApply and rejects ENOSPC', async () => {
  const dir = tmpdir();
  try {
    const fromDir = path.join(dir, 'from');
    const toDir = path.join(dir, 'to');
    const target = path.join(dir, 'target');
    writeTree(fromDir, FROM_TREE);
    writeTree(toDir, TO_TREE);
    fs.cpSync(fromDir, target, { recursive: true });
    const out = path.join(dir, 'delta.zip');
    await buildDelta({ fromDir, toDir, outFile: out });
    let beforeApplyCalled = 0;
    let checkedBytes = -1;
    await assert.rejects(
      () => applyDeltaFile(out, target, {
        beforeApply: async () => { beforeApplyCalled += 1; return { ok: true }; },
      }, {
        checkInstallSpace: (_dir, bytes) => {
          checkedBytes = bytes;
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        },
      }),
      (error) => error instanceof DeltaApplyError && error.code === 'apply-failed' && error.detail === 'ENOSPC',
    );
    assert.ok(checkedBytes > 0);
    assert.equal(beforeApplyCalled, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recoverPendingDeltas restores an interrupted mid-commit transaction so applyDeltaFile can succeed cleanly', async () => {
  const { recoverPendingDeltas } = require('./apply');
  const dir = tmpdir();
  try {
    const fromDir = path.join(dir, 'from');
    const toDir = path.join(dir, 'to');
    const target = path.join(dir, 'target');
    writeTree(fromDir, FROM_TREE);
    writeTree(toDir, TO_TREE);
    fs.cpSync(fromDir, target, { recursive: true });
    const out = path.join(dir, 'delta.zip');
    await buildDelta({ fromDir, toDir, outFile: out });

    // Simulate a crash mid-commit: app.exe moved to backup, new app.exe not yet placed,
    // and lib/change.dll already replaced with new content.
    const stagingDir = path.join(target, '.dshd-delta-9999-crash');
    fs.mkdirSync(path.join(stagingDir, 'old'), { recursive: true });
    fs.mkdirSync(path.join(stagingDir, 'new'), { recursive: true });
    const appTarget = path.join(target, 'app.exe');
    const appBackup = path.join(stagingDir, 'old', '0');
    fs.renameSync(appTarget, appBackup);

    const changeTarget = path.join(target, 'lib', 'change.dll');
    const changeBackup = path.join(stagingDir, 'old', '1');
    fs.copyFileSync(changeTarget, changeBackup);
    fs.writeFileSync(changeTarget, 'new-dll-content');

    fs.writeFileSync(path.join(stagingDir, 'journal.json'), JSON.stringify({
      version: 1,
      phase: 'committing',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      ops: [
        { path: 'app.exe', op: 'patch', target: appTarget, backup: appBackup, staged: path.join(stagingDir, 'new', '0') },
        { path: 'lib/change.dll', op: 'patch', target: changeTarget, backup: changeBackup, staged: path.join(stagingDir, 'new', '1') },
      ],
    }));

    // Re-running applyDeltaFile recovers the broken tree first instead of failing with base file missing.
    const result = await applyDeltaFile(out, target, {});
    assert.equal(result.ok, true);
    assert.deepEqual(await treeHashes(target), await treeHashes(toDir));
    assert.equal(recoverPendingDeltas(target).recovered, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyDeltaFile preserves staging backups and flags rollbackIncomplete when rollback rename fails', async () => {
  const dir = tmpdir();
  try {
    const fromDir = path.join(dir, 'from');
    const toDir = path.join(dir, 'to');
    const target = path.join(dir, 'target');
    writeTree(fromDir, FROM_TREE);
    writeTree(toDir, TO_TREE);
    fs.cpSync(fromDir, target, { recursive: true });
    const out = path.join(dir, 'delta.zip');
    await buildDelta({ fromDir, toDir, outFile: out });

    const impl = Object.create(fs);
    let commitRenames = 0;
    impl.renameSync = (from, to) => {
      if (String(from).endsWith('.tmp') && String(to).endsWith('journal.json')) {
        return fs.renameSync(from, to);
      }
      if (String(to).includes('rolledback') || String(from).includes(`${path.sep}old${path.sep}`)) {
        throw Object.assign(new Error('EACCES: locked'), { code: 'EACCES' });
      }
      commitRenames += 1;
      // Fail on the 3rd non-journal rename so op[0] has already backed up & placed.
      if (commitRenames === 3) {
        throw Object.assign(new Error('EIO: disk failure'), { code: 'EIO' });
      }
      return fs.renameSync(from, to);
    };

    await assert.rejects(
      () => applyDeltaFile(out, target, {}, { fs: impl, sleep: () => {} }),
      (error) => error instanceof DeltaApplyError && error.code === 'apply-failed' && error.rollbackIncomplete === true,
    );
    const leftover = fs.readdirSync(target).filter((n) => n.startsWith('.dshd-delta-'));
    assert.equal(leftover.length, 1);
    assert.equal(fs.existsSync(path.join(target, leftover[0], 'old', '0')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDelta and applyDeltaFile refuse deltas that delete a renamed top-level executable', async () => {
  const dir = tmpdir();
  try {
    const fromDir = path.join(dir, 'from');
    const toDir = path.join(dir, 'to');
    const target = path.join(dir, 'target');
    writeTree(fromDir, { 'Whale Isle.exe': 'MZ-0.3.16', 'resources/app.asar': 'asar-old' });
    writeTree(toDir, { 'WhaleIsle.exe': 'MZ-0.3.17', 'resources/app.asar': 'asar-new' });
    fs.cpSync(fromDir, target, { recursive: true });

    const out = path.join(dir, 'rename-delta.zip');
    await assert.rejects(
      () => buildDelta({ fromDir, toDir, outFile: out, product: 'Whale-Isle', fromVersion: '0.3.16', toVersion: '0.3.17' }),
      (error) => error.code === 'executable-renamed',
    );

    const forced = await buildDelta({
      fromDir, toDir, outFile: out, product: 'Whale-Isle', fromVersion: '0.3.16', toVersion: '0.3.17', allowExecutableRename: true,
    });
    let stopped = 0;
    await assert.rejects(
      () => applyDeltaFile(out, target, {
        expectedSha512: forced.sha512,
        expectedProduct: 'Whale-Isle',
        expectedFromVersion: '0.3.16',
        expectedToVersion: '0.3.17',
        beforeApply: async () => { stopped += 1; return { ok: true }; },
      }),
      (error) => error instanceof DeltaApplyError && error.code === 'executable-renamed',
    );
    assert.equal(stopped, 0);
    assert.equal(fs.existsSync(path.join(target, 'Whale Isle.exe')), true);
    assert.equal(fs.existsSync(path.join(target, 'WhaleIsle.exe')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
