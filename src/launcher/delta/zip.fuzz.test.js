'use strict';

// Property-based fuzz for the delta lane's own ZIP container (zip.js) and
// the apply-time write containment (apply.js). Every property runs a fixed
// seed budget; fast-check prints the seed + counterexample path on failure.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const fc = require('fast-check');

const zip = require('./zip');
const manifest = require('./manifest');
const { applyDeltaFile, DeltaApplyError } = require('./apply');
const { withOwnedTempDir } = require('../../shared/fs-safe');

const NUM_RUNS = 60;

// Entry names a hostile or malformed archive may carry: traversal, absolute
// paths, drive letters, backslashes, duplicates and unicode — all legal UTF-8.
const entryNameArb = fc.oneof(
  fc.string({
    unit: fc.constantFrom(
      'a', 'b', 'C', '0', '1', '.', '/', '\\', '_', '-', ' ', ':', '$', '~',
      '..', '../', '/x/', 'C:\\', '\t', '中', 'é', '🐳',
    ),
    minLength: 1, maxLength: 24,
  }),
  fc.constantFrom(
    '../escape', '../../etc/passwd', '/absolute', 'C:\\win\\system32',
    'a\\b\\c', 'd:/drive', 'name with space', '..', '.', 'x/y/../../z',
    'con', 'nul.txt', 'normal/deep/path.bin', 'payloads/p0',
  ),
);
const entryDataArb = fc.uint8Array({ minLength: 0, maxLength: 256 }).map((a) => Buffer.from(a));
const zipEntriesArb = fc.array(
  fc.record({ name: entryNameArb, data: entryDataArb }),
  { minLength: 0, maxLength: 6 },
);

function listFiles(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else out.set(path.relative(root, full), manifest.sha256Hex(fs.readFileSync(full)));
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// writeZip/readZip/readEntry: any name/data set that parses must round-trip
// byte-identical payloads (crc + size gates are the integrity contract).
// ---------------------------------------------------------------------------
test('zip round-trip: every written entry parses back byte-identical', async () => {
  await fc.assert(fc.asyncProperty(zipEntriesArb, async (entries) => {
    await withOwnedTempDir('dshd-fuzz-zip-', async (dir) => {
      const file = path.join(dir, 'a.zip');
      zip.writeZip(file, entries);
      const parsed = zip.readZip(file);
      assert.equal(parsed.length, entries.length);
      for (let i = 0; i < entries.length; i += 1) {
        assert.equal(parsed[i].name, entries[i].name);
        assert.deepEqual(zip.readEntry(file, parsed[i]), entries[i].data);
      }
    });
  }), { numRuns: NUM_RUNS });
});

// ---------------------------------------------------------------------------
// Corruption: a byte flip, truncation or forged EOCD fields must never make
// readEntry return data that was not a written payload — errors are fine.
// ---------------------------------------------------------------------------
const mutationArb = fc.record({
  kind: fc.constantFrom('flip', 'truncate', 'eocd'),
  at: fc.nat(),
  byte: fc.integer({ min: 1, max: 255 }),
});

function mutateZipBytes(orig, mutation) {
  const buf = Buffer.from(orig);
  if (buf.length === 0) return buf;
  if (mutation.kind === 'truncate') {
    return buf.subarray(0, mutation.at % (buf.length + 1));
  }
  if (mutation.kind === 'eocd') {
    // Forge EOCD count/offset/size within file bounds (no multi-GB alloc).
    const eocd = buf.length - 22;
    if (eocd < 0) return buf;
    const field = mutation.at % 3;
    if (field === 0) buf.writeUInt16LE(mutation.byte * 17, eocd + 8);
    if (field === 1) buf.writeUInt32LE(mutation.at % buf.length, eocd + 16);
    if (field === 2) buf.writeUInt32LE(mutation.at % buf.length, eocd + 12);
    return buf;
  }
  const at = mutation.at % (buf.length - 22 > 0 ? buf.length - 22 : buf.length);
  buf[at] ^= mutation.byte;
  return buf;
}

test('zip corruption never yields silent wrong payload data', async () => {
  await fc.assert(fc.asyncProperty(zipEntriesArb, mutationArb, async (entries, mutation) => {
    await withOwnedTempDir('dshd-fuzz-zip-', async (dir) => {
      const file = path.join(dir, 'a.zip');
      zip.writeZip(file, entries);
      const mutated = mutateZipBytes(fs.readFileSync(file), mutation);
      fs.writeFileSync(file, mutated);
      let parsed;
      try {
        parsed = zip.readZip(file);
      } catch (error) {
        assert.ok(error instanceof Error);
        return;
      }
      const payloads = entries.map((row) => row.data.toString('hex'));
      for (const entry of parsed) {
        try {
          const data = zip.readEntry(file, entry);
          // A returned buffer must be crc-verified bytes of a real payload.
          assert.ok(payloads.includes(data.toString('hex')),
            `entry ${JSON.stringify(entry.name)} returned unverified data`);
        } catch (error) {
          assert.ok(error instanceof Error);
        }
      }
    });
  }), { numRuns: NUM_RUNS });
});

// ---------------------------------------------------------------------------
// extractEntryTo: forged central-directory fields (crc, sizes, method, a
// deflate payload that outgrows its declared size) must reject and never
// leave bytes at the destination.
// ---------------------------------------------------------------------------
const forgeryArb = fc.record({
  field: fc.constantFrom('crc32', 'size', 'method', 'compressedSize', 'localOffset'),
  value: fc.integer({ min: 0, max: 0xff }),
});

test('extractEntryTo rejects forged entry descriptors without partial writes', async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.record({ name: entryNameArb, data: entryDataArb }), { minLength: 1, maxLength: 4 }),
    forgeryArb,
    async (entries, forge) => {
      await withOwnedTempDir('dshd-fuzz-zip-', async (dir) => {
        const file = path.join(dir, 'a.zip');
        zip.writeZip(file, entries);
        const parsed = zip.readZip(file);
        const victim = parsed[0];
        const forged = { ...victim };
        // Every forged field must differ from the honest value.
        if (forge.field === 'method') forged.method = 0x63;
        if (forge.field === 'crc32') forged.crc32 = (victim.crc32 ^ (forge.value || 0x5a5a)) >>> 0;
        if (forge.field === 'size') forged.size = victim.size + 1 + forge.value;
        if (forge.field === 'compressedSize') forged.compressedSize = victim.compressedSize + 1 + forge.value;
        if (forge.field === 'localOffset') forged.localOffset = victim.localOffset + 1 + forge.value;
        const dest = path.join(dir, 'out', 'staged');
        await assert.rejects(() => zip.extractEntryTo(file, forged, dest), Error);
        assert.equal(fs.existsSync(dest), false, 'partial output left behind');
      });
    },
  ), { numRuns: NUM_RUNS });
});

test('extractEntryTo rejects deflate payloads outgrowing the declared size', async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 4, max: 40 }),
    fc.integer({ min: 0, max: 3 }),
    async (rawLen, shrink) => {
      const raw = Buffer.alloc(rawLen, 0x61);
      const packed = zlib.deflateRawSync(raw);
      const declared = rawLen - shrink - 1;
      await withOwnedTempDir('dshd-fuzz-zip-', async (dir) => {
        const file = path.join(dir, 'a.zip');
        // Header written by hand: declared size is smaller than real output.
        const name = Buffer.from('bomb');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(zip.crc32(raw), 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(declared, 22);
        local.writeUInt16LE(name.length, 26);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(8, 10);
        cd.writeUInt32LE(zip.crc32(raw), 16);
        cd.writeUInt32LE(packed.length, 20);
        cd.writeUInt32LE(declared, 24);
        cd.writeUInt16LE(name.length, 28);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(1, 8);
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(46 + name.length, 12);
        eocd.writeUInt32LE(30 + name.length + packed.length, 16);
        fs.writeFileSync(file, Buffer.concat([local, name, packed, cd, name, eocd]));
        const entry = zip.readZip(file)[0];
        const dest = path.join(dir, 'staged');
        await assert.rejects(() => zip.extractEntryTo(file, entry, dest), Error);
        assert.equal(fs.existsSync(dest), false);
      });
    },
  ), { numRuns: NUM_RUNS });
});

// ---------------------------------------------------------------------------
// applyDeltaFile end-to-end: whatever manifest paths a generated archive
// declares, no byte ever lands outside targetDir and staging is reclaimed.
// ---------------------------------------------------------------------------
const manifestPathArb = fc.oneof(
  fc.constantFrom(
    'a.txt', 'sub/dir/b.js', '../escape', '../../x', '/abs', 'C:\\x',
    'a\\..\\b', '.', '..', 'a//b', 'a/./c', 'sub/../../up', 'ok/../stay',
    'a '.concat('b'.repeat(600)), 'ctrl\x01x', 'trailing/', '/lead',
  ),
  fc.array(fc.string({
    unit: fc.constantFrom('a', 'b', 'c', '.', '..', 'x-y', 'z_1'),
    minLength: 1, maxLength: 6,
  }), { minLength: 1, maxLength: 4 }).map((segs) => segs.join('/')),
);

async function applyScenario(entries, files, run) {
  await withOwnedTempDir('dshd-fuzz-apply-', async (parent) => {
    const target = path.join(parent, 'target');
    fs.mkdirSync(target, { recursive: true });
    // Sentinel the apply must never touch, plus base files for patch/delete.
    const sentinel = path.join(parent, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'KEEP');
    const before = listFiles(parent);
    const rows = files.map((file, index) => {
      const row = { path: file.path, op: file.op };
      if (file.op === 'add' || file.op === 'patch') {
        row.sha256 = manifest.sha256Hex(file.data);
        row.size = file.data.length;
        row.payload = `payloads/p${index}`;
        entries.push({ name: row.payload, data: file.data });
      }
      if (file.op === 'patch' || file.op === 'delete') {
        row.baseSha256 = manifest.sha256Hex(Buffer.from(`base-${index}`));
      }
      return row;
    });
    const doc = { format: manifest.FORMAT, product: 'app', fromVersion: '1', toVersion: '2', files: rows };
    // Base files only serve a manifest that can reach the apply stage, and
    // creating one can itself hit a file/dir collision (`x-y` plus `x-y/a`)
    // — so the doc is validated the same way applyDeltaFile will, and bases
    // are written only for manifests that pass.
    let docValid = true;
    try {
      manifest.validateManifest(JSON.stringify(doc));
    } catch (error) {
      assert.ok(error instanceof manifest.DeltaManifestError);
      docValid = false;
    }
    if (docValid) {
      files.forEach((file, index) => {
        if (file.op === 'patch' || file.op === 'delete') {
          const full = path.join(target, ...file.path.split('/'));
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, Buffer.from(`base-${index}`));
        }
      });
    }
    entries.unshift({ name: manifest.MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(doc)) });
    const zipFile = path.join(parent, 'delta.zip');
    zip.writeZip(zipFile, entries);
    let result;
    try {
      result = await applyDeltaFile(zipFile, target, {});
    } catch (error) {
      assert.ok(error instanceof Error);
      result = { threw: true, code: error instanceof DeltaApplyError ? error.code : undefined };
    }
    run(result, target, parent, before);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'KEEP');
    // No file outside targetDir may be created, modified or deleted.
    const after = listFiles(parent);
    for (const [rel, hash] of before) {
      if (rel === 'delta.zip' || rel.startsWith(`target${path.sep}`)) continue;
      assert.equal(after.get(rel), hash, `outside file changed: ${rel}`);
    }
    for (const rel of after.keys()) {
      if (rel === 'delta.zip' || rel.startsWith(`target${path.sep}`)) continue;
      assert.ok(before.has(rel), `file appeared outside targetDir: ${rel}`);
    }
    // Staging must never survive inside the target tree.
    for (const item of fs.readdirSync(target)) {
      assert.equal(item.startsWith('.dshd-delta-'), false, `staging left: ${item}`);
    }
  });
}

test('applyDeltaFile never writes outside targetDir on generated manifests', async () => {
  const fileArb = fc.record({
    path: manifestPathArb,
    op: fc.constantFrom('add', 'patch', 'delete'),
    data: entryDataArb,
  });
  await fc.assert(fc.asyncProperty(
    fc.array(fileArb, { minLength: 0, maxLength: 4 }),
    async (files) => {
      const entries = [];
      await applyScenario(entries, files, (result) => {
        // Either a clean apply or a typed refusal — never an opaque crash.
        if (result.threw === true) {
          assert.ok(result.code === undefined || typeof result.code === 'string');
        } else {
          assert.equal(result.ok, true);
        }
      });
    },
  ), { numRuns: NUM_RUNS });
});

test('applyDeltaFile with unsafe manifest paths is refused as manifest-invalid', async () => {
  const unsafe = fc.constantFrom('../x', '../../etc', '/abs', 'a\\b', 'C:\\y', 'a//b', '.', '..', 'bad\x02p');
  await fc.assert(fc.asyncProperty(
    fc.array(fc.record({ path: unsafe, op: fc.constantFrom('add', 'patch', 'delete'), data: entryDataArb }),
      { minLength: 1, maxLength: 3 }),
    async (files) => {
      const entries = [];
      await applyScenario(entries, files, (result) => {
        assert.equal(result.threw, true);
        assert.equal(result.code, 'manifest-invalid');
      });
    },
  ), { numRuns: NUM_RUNS });
});
