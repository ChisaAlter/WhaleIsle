'use strict';

// Model-based property test for applyDeltaFile: random target trees, random
// manifests, and a single injected filesystem failure (rename/mkdir/unlink/
// rmdir/rm/write-stream firing on its Nth call with EPERM/ENOSPC/EIO/EACCES/
// EBUSY). The simplified reference model applies the manifest in memory; the
// invariant after every apply is all-or-nothing — either the model tree or a
// byte-identical rollback — plus no staging residue.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');

const zip = require('./zip');
const manifest = require('./manifest');
const { applyDeltaFile, DeltaApplyError } = require('./apply');
const { fuzzAssert } = require('../../../scripts/lib/fuzz.cjs');

const NUM_RUNS = 40;
const STAGING_PREFIX = '.dshd-delta-';
const KNOWN_CODES = new Set(['artifact-sha512-mismatch', 'bad-zip', 'manifest-invalid',
  'manifest-target-mismatch', 'base-mismatch', 'payload-missing', 'payload-mismatch',
  'apply-failed', 'target-missing']);

/** File map of a directory tree: rel path -> sha256 hex. Directories ignored. */
function treeHashes(root) {
  const out = new Map();
  const walk = (dir, prefix) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (name.startsWith(STAGING_PREFIX)) continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full, `${prefix}${name}/`);
      else out.set(`${prefix}${name}`, manifest.sha256Hex(fs.readFileSync(full)));
    }
  };
  walk(root, '');
  return out;
}

function stagingLeft(root) {
  try {
    return fs.readdirSync(root).filter((name) => name.startsWith(STAGING_PREFIX));
  } catch {
    return [];
  }
}

/**
 * Single-shot fs fault: the `index`-th call to `op` throws `code`.
 * `fired` records the fault once it lands.
 */
function faultyFs(plan) {
  const state = { count: 0, fired: null };
  if (!plan) return { impl: fs, state };
  const impl = Object.create(fs);
  impl[plan.op] = (...args) => {
    state.count += 1;
    if (state.count === plan.index && !state.fired) {
      const error = new Error(`${plan.code}: injected fault on ${plan.op}`);
      error.code = plan.code;
      state.fired = { op: plan.op, index: plan.index, code: plan.code, args: args.map((a) => String(a)) };
      throw error;
    }
    return fs[plan.op](...args);
  };
  return { impl, state };
}

/**
 * Reference model: evaluate `doc.files` against `tree` (Map rel -> hex).
 * Returns { ok:true, tree } — ops applied — or { ok:false, code:'base-mismatch' }
 * — the preflight all-or-nothing rejection.
 */
function evaluate(tree, dirs, doc) {
  const next = new Map(tree);
  for (const row of doc.files) {
    // A directory parked at a file path fails base hashing exactly like a
    // foreign file — preflight rejects before anything mutates.
    if (dirs.has(row.path)) return { ok: false, code: 'base-mismatch' };
    const actual = next.get(row.path);
    if (row.op === 'add') {
      if (actual !== undefined && actual !== row.sha256) return { ok: false, code: 'base-mismatch' };
      next.set(row.path, row.sha256);
      continue;
    }
    if (row.op === 'delete') {
      if (actual === undefined) continue; // no-op delete
      if (actual !== row.baseSha256) return { ok: false, code: 'base-mismatch' };
      next.delete(row.path);
      continue;
    }
    // patch
    if (actual === undefined) return { ok: false, code: 'base-mismatch' };
    if (actual === row.sha256) continue; // already at target — re-apply is a no-op
    if (actual !== row.baseSha256) return { ok: false, code: 'base-mismatch' };
    next.set(row.path, row.sha256);
  }
  return { ok: true, tree: next };
}

function writeTree(root, treeContents) {
  for (const [rel, content] of treeContents) {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function assertTrees(actual, expected, label) {
  const a = [...actual.entries()].sort();
  const e = [...expected.entries()].sort();
  assert.deepEqual(a, e, label);
}

const SAFE_PATHS = ['a.txt', 'b.bin', 'lib/c.dll', 'lib/sub/d.js', 'deep/e/f/g.dat', 'unicode-中.txt', 'sp ace/x.log'];
const CONTENT_POOL = ['', 'x', 'old-bytes', 'new-bytes-longer', '中文字节', 'line1\nline2\n', 'A'.repeat(300)];

function buildScenario(setup) {
  const doc = { format: manifest.FORMAT, product: 'Test', fromVersion: '1.0.0', toVersion: '2.0.0', files: [] };
  const treeContents = new Map(); // rel -> content string
  const payloads = [];
  setup.rows.forEach((row, index) => {
    const rel = row.path;
    const content = CONTENT_POOL[row.contentIndex % CONTENT_POOL.length];
    switch (row.op) {
      case 'add': {
        const mode = row.mode % 4;
        const data = CONTENT_POOL[row.payloadIndex % CONTENT_POOL.length];
        if (mode === 1) treeContents.set(rel, data); // already at target → skip
        else if (mode === 2) treeContents.set(rel, content); // foreign content → base-mismatch
        doc.files.push({ path: rel, op: 'add', sha256: manifest.sha256Hex(Buffer.from(data)), size: Buffer.byteLength(data), payload: `payload/${index}` });
        payloads.push({ name: `payload/${index}`, data: Buffer.from(data) });
        break;
      }
      case 'patch': {
        const data = CONTENT_POOL[row.payloadIndex % CONTENT_POOL.length];
        const mode = row.mode % 4;
        if (mode === 0) treeContents.set(rel, content); // normal base
        else if (mode === 1) treeContents.set(rel, data); // already applied → skip
        else if (mode === 2) treeContents.set(rel, 'drifted-base'); // drifted → base-mismatch
        // mode 3: path absent → base-mismatch
        const base = treeContents.get(rel);
        doc.files.push({
          path: rel, op: 'patch',
          baseSha256: manifest.sha256Hex(Buffer.from(base === undefined ? '' : base)),
          sha256: manifest.sha256Hex(Buffer.from(data)),
          size: Buffer.byteLength(data), payload: `payload/${index}`,
        });
        payloads.push({ name: `payload/${index}`, data: Buffer.from(data) });
        break;
      }
      default: { // delete
        const mode = row.mode % 3;
        if (mode === 0) treeContents.set(rel, content); // present → delete
        else if (mode === 1) treeContents.set(rel, 'drifted-base'); // drifted → base-mismatch
        // mode 2: absent → no-op delete
        const base = treeContents.get(rel);
        doc.files.push({
          path: rel, op: 'delete',
          baseSha256: manifest.sha256Hex(Buffer.from(base === undefined ? 'x' : base)),
        });
        break;
      }
    }
  });
  return { doc, treeContents, payloads };
}

class ApplyCommand {
  constructor(plan, beforeApplyMode) {
    this.plan = plan;
    this.beforeApplyMode = beforeApplyMode; // 'admit' | 'refuse' | 'none'
  }
  check() { return true; }
  async run(model) {
    const before = new Map(model.tree);
    const expected = evaluate(model.tree, model.dirs, model.doc);
    const fault = faultyFs(this.plan);
    const options = {};
    if (this.beforeApplyMode !== 'none') {
      options.beforeApply = async () => (this.beforeApplyMode === 'admit' ? { ok: true } : { ok: false, cancelled: true, error: 'peer-cancelled' });
    }
    let result = null;
    let thrown = null;
    try {
      result = await applyDeltaFile(model.zipFile, model.targetDir, options, { fs: fault.impl });
    } catch (error) {
      thrown = error;
    }
    const actual = treeHashes(model.targetDir);
    const label = `${this} (fired=${fault.state.fired ? `${fault.state.fired.op}#${fault.state.fired.index}` : 'no'})`;
    if (this.beforeApplyMode === 'refuse' && expected.ok) {
      // Protected-shutdown refusal: the tree is untouched, no error.
      assert.equal(result && result.ok, false, label);
      // A refusal must leave the pre-apply tree byte-identical.
      assertTrees(actual, before, `${label}: refusal must preserve the tree`);
      return;
    }
    if (thrown === null) {
      assert.equal(result.ok, true, label);
      assertTrees(actual, expected.tree, `${label}: applied tree does not match the model`);
      assert.ok(expected.ok, `${label}: apply succeeded but the model expected ${expected.code}`);
      model.tree = expected.tree;
      model.appliedOnce = true;
    } else {
      assert.ok(thrown instanceof DeltaApplyError, `${label}: non-DeltaApplyError ${thrown}`);
      assert.ok(KNOWN_CODES.has(thrown.code), `${label}: unexpected code ${thrown.code}`);
      if (!fault.state.fired) {
        assert.equal(thrown.code, expected.ok ? thrown.code : 'base-mismatch', label);
      }
      // All-or-nothing: a failed apply must leave the pre-apply tree exactly.
      assertTrees(actual, before, `${label}: failed apply left a hybrid tree (${thrown.code})`);
    }
    const leftover = stagingLeft(model.targetDir);
    const cleanupFault = fault.state.fired && (fault.state.fired.op === 'rmSync' || fault.state.fired.op === 'rmdirSync');
    if (!cleanupFault) {
      assert.deepEqual(leftover, [], `${label}: staging residue ${leftover.join(',')}`);
    }
  }
  toString() {
    const plan = this.plan ? `${this.plan.op}#${this.plan.index}:${this.plan.code}` : 'clean';
    return `apply(${plan},beforeApply=${this.beforeApplyMode})`;
  }
}

class TamperCommand {
  constructor(pathIndex, contentIndex, mode) {
    this.pathIndex = pathIndex;
    this.contentIndex = contentIndex;
    this.mode = mode; // 0 write, 1 delete, 2 mkdir
  }
  check() { return true; }
  async run(model) {
    const rel = SAFE_PATHS[this.pathIndex % SAFE_PATHS.length];
    const full = path.join(model.targetDir, ...rel.split('/'));
    if (this.mode === 0) {
      const content = CONTENT_POOL[this.contentIndex % CONTENT_POOL.length];
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      model.tree.set(rel, manifest.sha256Hex(Buffer.from(content)));
      model.dirs.delete(rel);
    } else if (this.mode === 1) {
      if (fs.existsSync(full)) {
        fs.rmSync(full, { recursive: true, force: true });
        model.tree.delete(rel);
        model.dirs.delete(rel);
      }
    } else {
      // Replace whatever is there with a directory.
      if (fs.existsSync(full) && !fs.statSync(full).isDirectory()) fs.rmSync(full, { force: true });
      fs.mkdirSync(full, { recursive: true });
      model.tree.delete(rel);
      model.dirs.add(rel);
    }
  }
  toString() { return `tamper(${SAFE_PATHS[this.pathIndex % SAFE_PATHS.length]},mode=${this.mode})`; }
}

const faultPlanArb = fc.option(fc.record({
  op: fc.constantFrom('renameSync', 'mkdirSync', 'unlinkSync', 'rmdirSync', 'rmSync', 'createWriteStream'),
  index: fc.integer({ min: 1, max: 14 }),
  code: fc.constantFrom('EPERM', 'ENOSPC', 'EIO', 'EACCES', 'EBUSY'),
}), { nil: null });

const rowArb = fc.record({
  path: fc.constantFrom(...SAFE_PATHS.slice(0, 6)),
  op: fc.constantFrom('add', 'patch', 'delete'),
  mode: fc.integer({ min: 0, max: 5 }),
  contentIndex: fc.integer({ min: 0, max: CONTENT_POOL.length - 1 }),
  payloadIndex: fc.integer({ min: 0, max: CONTENT_POOL.length - 1 }),
});

const setupArb = fc.record({
  rows: fc.array(rowArb, { minLength: 0, maxLength: 6 }).map((rows) => {
    const seen = new Set();
    return rows.filter((row) => {
      if (seen.has(row.path)) return false;
      seen.add(row.path);
      return true;
    });
  }),
});

const applyCommandArbs = [
  fc.tuple(faultPlanArb, fc.constantFrom('admit', 'refuse', 'none', 'admit'))
    .map(([plan, mode]) => new ApplyCommand(plan, mode)),
  fc.tuple(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: CONTENT_POOL.length - 1 }), fc.integer({ min: 0, max: 2 }))
    .map(([p, c, m]) => new TamperCommand(p, c, m)),
];

test('delta apply is all-or-nothing under injected filesystem faults', async () => {
  await fuzzAssert(fc.asyncProperty(
    setupArb,
    fc.commands(applyCommandArbs, { minCommands: 2, maxCommands: 8 }),
    async (setup, commands) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-delta-prop-'));
      try {
        const { doc, treeContents, payloads } = buildScenario(setup);
        const targetDir = path.join(dir, 'target');
        fs.mkdirSync(targetDir, { recursive: true });
        writeTree(targetDir, treeContents);
        const zipFile = path.join(dir, 'delta.zip');
        zip.writeZip(zipFile, [
          ...payloads,
          { name: manifest.MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(doc)) },
        ]);
        const model = {
          doc,
          zipFile,
          targetDir,
          tree: treeHashes(targetDir),
          dirs: new Set(),
        };
        await fc.asyncModelRun(() => ({ model, real: model.targetDir }), commands);
        return true;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  ), 'delta apply is all-or-nothing under injected filesystem faults', { numRuns: NUM_RUNS });
});

// Regression for #536: a synchronous createWriteStream throw inside
// extractEntryTo used to orphan the zip read stream — no 'error' listener, no
// close — so a later open/read failure escaped as an uncaughtException
// instead of surfacing as DeltaApplyError.
test('extractEntryTo closes the zip read stream when createWriteStream throws', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-delta-orphan-'));
  try {
    const targetDir = path.join(dir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });
    const payload = Buffer.from('deflatable-payload-'.repeat(32));
    const doc = {
      format: manifest.FORMAT, product: 'Test', fromVersion: '1.0.0', toVersion: '2.0.0',
      files: [{
        path: 'a.txt', op: 'add',
        sha256: manifest.sha256Hex(payload), size: payload.length,
        payload: 'payload/0',
      }],
    };
    const zipFile = path.join(dir, 'delta.zip');
    zip.writeZip(zipFile, [
      { name: 'payload/0', data: payload },
      { name: manifest.MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(doc)) },
    ]);
    const readStreams = [];
    const impl = Object.create(fs);
    impl.createReadStream = (...args) => {
      const stream = fs.createReadStream(...args);
      readStreams.push(stream);
      return stream;
    };
    impl.createWriteStream = () => {
      const error = new Error('EPERM: injected fault on createWriteStream');
      error.code = 'EPERM';
      throw error;
    };
    const escaped = [];
    const onUncaught = (error) => escaped.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      await assert.rejects(
        () => applyDeltaFile(zipFile, targetDir, {}, { fs: impl }),
        (error) => error instanceof DeltaApplyError && error.code === 'apply-failed',
      );
      assert.ok(readStreams.length > 0, 'expected the payload extract to open the zip');
      for (const stream of readStreams) {
        assert.equal(stream.destroyed, true, 'zip read stream leaked past the failed apply');
      }
      // Give the orphaned stream's async open/read a window to fire 'error':
      // pre-fix it escaped as an uncaughtException instead of DeltaApplyError.
      fs.rmSync(zipFile);
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.deepEqual(escaped, []);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
