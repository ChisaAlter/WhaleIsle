'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { replaceDirJournaled, commitStagedDir, recoverImportTransactions, reconcileImportTransactionsSync, overlayDir } = require('./import-transaction');

// 所有 mkdtemp 目录统一登记，套件结束后无论成败一并回收（#478）。
const tempDirs = [];
test.after(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function makeRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-txn-')));
  tempDirs.push(root);
  return {
    root,
    src: path.join(root, 'src'),
    dest: path.join(root, 'dest'),
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('replaceDirJournaled commits a staged tree over an existing destination', async () => {
  const t = makeRoot();
  fs.mkdirSync(path.join(t.src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(t.src, 'keep.txt'), 'new');
  fs.writeFileSync(path.join(t.src, 'sub', 'n.txt'), 'x');
  fs.mkdirSync(t.dest, { recursive: true });
  fs.writeFileSync(path.join(t.dest, 'old.txt'), 'old');
  const r = await replaceDirJournaled(t.src, t.dest, { opId: 't1' });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(t.dest, 'keep.txt'), 'utf8'), 'new');
  assert.equal(fs.existsSync(path.join(t.dest, 'old.txt')), false);
  assert.equal(fs.existsSync(path.join(t.dest, 'sub', 'n.txt')), true);
  // No journal, tmp, or bak remains after commit.
  const siblings = fs.readdirSync(t.root);
  assert.equal(siblings.filter((n) => n.includes('.import-')).length, 0);
  t.cleanup();
});

test('replaceDirJournaled refuses overlapping source/dest', async () => {
  const t = makeRoot();
  fs.mkdirSync(t.src, { recursive: true });
  const r = await replaceDirJournaled(t.src, t.src);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'source-dest-overlap');
  t.cleanup();
});

test('replaceDirJournaled leaves an intact copy on rename failure', async () => {
  const t = makeRoot();
  fs.mkdirSync(t.src, { recursive: true });
  fs.writeFileSync(path.join(t.src, 'keep.txt'), 'new');
  fs.mkdirSync(t.dest, { recursive: true });
  fs.writeFileSync(path.join(t.dest, 'keep.txt'), 'old');
  const origRename = fs.promises.rename;
  let injected = false;
  fs.promises.rename = async (a, b) => {
    if (!injected) { injected = true; throw new Error('inject'); }
    return origRename.call(fs.promises, a, b);
  };
  const r = await replaceDirJournaled(t.src, t.dest, { opId: 't2' });
  fs.promises.rename = origRename;
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(t.dest, 'keep.txt'), 'utf8'), 'old');
  t.cleanup();
});

test('recoverImportTransactions drops a staged tmp and clears the journal', async () => {
  const t = makeRoot();
  const opId = 'rec1';
  const tmp = `${t.dest}.import-tmp-${opId}`;
  const txn = `${t.dest}.import-txn-${opId}`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'x.txt'), 'staged');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId, dest: t.dest, tmp, bak: `${t.dest}.import-bak-${opId}`, state: 'staged',
  }));
  const r = await recoverImportTransactions(t.dest, {
    allowedOpIds: new Set([opId]), allowedTxnDests: { [opId]: t.dest },
  });
  assert.equal(r.recovered.length, 1);
  assert.equal(r.pending.length, 0);
  assert.equal(fs.existsSync(tmp), false);
  assert.equal(fs.existsSync(txn), false);
  t.cleanup();
});

test('recoverImportTransactions finishes a replacing-state commit', async () => {
  const t = makeRoot();
  const opId = 'rec2';
  const tmp = `${t.dest}.import-tmp-${opId}`;
  const bak = `${t.dest}.import-bak-${opId}`;
  const txn = `${t.dest}.import-txn-${opId}`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'keep.txt'), 'new');
  fs.mkdirSync(bak, { recursive: true });
  fs.writeFileSync(path.join(bak, 'keep.txt'), 'old');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId, dest: t.dest, tmp, bak, state: 'replacing',
  }));
  const r = await recoverImportTransactions(t.dest, {
    allowedOpIds: new Set([opId]), allowedTxnDests: { [opId]: t.dest },
  });
  assert.equal(r.recovered.length, 1);
  assert.equal(fs.readFileSync(path.join(t.dest, 'keep.txt'), 'utf8'), 'new');
  assert.equal(fs.existsSync(bak), false);
  t.cleanup();
});

test('recoverImportTransactions preserves unjournaled staging dirs', async () => {
  const t = makeRoot();
  const legacy = `${t.dest}.import-tmp`;
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'x.txt'), 'legacy');
  const r = await recoverImportTransactions(t.dest);
  assert.equal(r.pending.length > 0, true);
  assert.equal(fs.existsSync(legacy), true);
  t.cleanup();
});

test('overlayDir respects overwrite=false for conflicting files', async () => {
  const t = makeRoot();
  fs.mkdirSync(t.src, { recursive: true });
  fs.writeFileSync(path.join(t.src, 'a.txt'), 'src-a');
  fs.writeFileSync(path.join(t.src, 'b.txt'), 'src-b');
  fs.mkdirSync(t.dest, { recursive: true });
  fs.writeFileSync(path.join(t.dest, 'a.txt'), 'dest-a');
  await overlayDir(t.src, t.dest, { overwrite: false });
  assert.equal(fs.readFileSync(path.join(t.dest, 'a.txt'), 'utf8'), 'dest-a');
  assert.equal(fs.readFileSync(path.join(t.dest, 'b.txt'), 'utf8'), 'src-b');
  t.cleanup();
});

test('commitStagedDir publishes a pre-built staging tree', async () => {
  const t = makeRoot();
  const staging = `${t.dest}.import-tmp-commit1`;
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'staged.txt'), 's');
  const r = await commitStagedDir(staging, t.dest, { opId: 'commit1' });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(t.dest, 'staged.txt'), 'utf8'), 's');
  assert.equal(fs.existsSync(staging), false);
  t.cleanup();
});

test('reconcileImportTransactionsSync refuses a journal pointing outside the tree', () => {
  const t = makeRoot();
  const foreign = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-foreign-')));
  tempDirs.push(foreign);
  fs.writeFileSync(path.join(foreign, 'sentinel.txt'), 'keep-me');
  const destDir = path.join(t.root, 'skills');
  fs.mkdirSync(destDir, { recursive: true });
  const txn = path.join(destDir, 'sub.import-txn-evil');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId: 'evil', dest: foreign,
    tmp: `${foreign}.import-tmp-evil`, bak: `${foreign}.import-bak-evil`, state: 'staged',
  }));
  // Register the op so the ownership gate passes and the foreign-dest
  // trust-boundary check is what actually rejects it.
  const out = reconcileImportTransactionsSync(t.root, {
    allowedOpIds: new Set(['evil']), allowedTxnDests: { evil: foreign },
  });
  assert.equal(out.pending.length, 1);
  assert.equal(out.pending[0].reason, 'untrusted-journal');
  assert.equal(fs.readFileSync(path.join(foreign, 'sentinel.txt'), 'utf8'), 'keep-me');
  assert.equal(fs.existsSync(txn), true);
  fs.rmSync(foreign, { recursive: true, force: true });
  t.cleanup();
});

test('reconcileImportTransactionsSync refuses opId that mismatches the filename', () => {
  const t = makeRoot();
  const tmp = path.join(t.root, 'sub.import-tmp-a1');
  fs.mkdirSync(tmp, { recursive: true });
  const txn = path.join(t.root, 'sub.import-txn-a1');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId: 'OTHER', dest: path.join(t.root, 'sub'),
    tmp, bak: `${path.join(t.root, 'sub')}.import-bak-a1`, state: 'staged',
  }));
  // Authorize the journal's declared ID (OTHER) bound to its dest so the
  // binding check passes and the filename-mismatch is what is actually
  // exercised — without ownership the record now fails closed as
  // unregistered before the filename check is ever reached.
  const out = reconcileImportTransactionsSync(t.root, {
    allowedOpIds: new Set(['OTHER']), allowedTxnDests: { OTHER: path.join(t.root, 'sub') },
  });
  assert.equal(out.pending.length, 1);
  assert.equal(out.pending[0].reason, 'untrusted-journal');
  assert.equal(fs.existsSync(tmp), true);
  t.cleanup();
});

test('reconcileImportTransactionsSync sweeps txn journals inside .agent-presets', () => {
  const t = makeRoot();
  const presetDir = path.join(t.root, '.agent-presets', 'p9');
  const tmp = `${presetDir}.import-tmp-pp`;
  const txn = `${presetDir}.import-txn-pp`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'f.txt'), 'staged');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId: 'pp', dest: presetDir, tmp, bak: `${presetDir}.import-bak-pp`, state: 'staged',
  }));
  const out = reconcileImportTransactionsSync(t.root, {
    allowedOpIds: new Set(['pp']), allowedTxnDests: { pp: presetDir },
  });
  assert.equal(out.recovered.includes('pp'), true);
  assert.equal(fs.existsSync(tmp), false);
  assert.equal(fs.existsSync(txn), false);
  t.cleanup();
});

test('commitStagedDir rejects a staging dir that is the destination itself', async () => {
  const t = makeRoot();
  fs.mkdirSync(t.dest, { recursive: true });
  const r = await commitStagedDir(t.dest, t.dest, { opId: 'self1' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'source-dest-overlap');
  t.cleanup();
});

test('committed-state journal restores bak when dest vanished (never deletes the last copy)', async () => {
  // The `committed` branch used to delete `bak` unconditionally; if the
  // crash took the destination with it, that deleted the only copy.
  const t = makeRoot();
  const opId = 'cd1';
  const bak = `${t.dest}.import-bak-${opId}`;
  const txn = `${t.dest}.import-txn-${opId}`;
  fs.mkdirSync(bak, { recursive: true });
  fs.writeFileSync(path.join(bak, 'only-copy.txt'), 'survive');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId, dest: t.dest, tmp: `${t.dest}.import-tmp-${opId}`, bak, state: 'committed',
  }));
  const asyncOut = await recoverImportTransactions(t.dest, {
    allowedOpIds: new Set([opId]), allowedTxnDests: { [opId]: t.dest },
  });
  assert.equal(asyncOut.recovered.includes(opId), true);
  assert.equal(fs.readFileSync(path.join(t.dest, 'only-copy.txt'), 'utf8'), 'survive');
  t.cleanup();

  const s = makeRoot();
  const sBak = `${s.dest}.import-bak-${opId}`;
  const sTxn = `${s.dest}.import-txn-${opId}`;
  fs.mkdirSync(sBak, { recursive: true });
  fs.writeFileSync(path.join(sBak, 'only-copy.txt'), 'survive');
  fs.writeFileSync(sTxn, JSON.stringify({
    version: 1, opId, dest: s.dest, tmp: `${s.dest}.import-tmp-${opId}`, bak: sBak, state: 'committed',
  }));
  const syncOut = reconcileImportTransactionsSync(s.root, {
    allowedOpIds: new Set([opId]), allowedTxnDests: { [opId]: s.dest },
  });
  assert.equal(syncOut.recovered.includes(opId), true);
  assert.equal(fs.readFileSync(path.join(s.dest, 'only-copy.txt'), 'utf8'), 'survive');
  s.cleanup();
});

test('committed-state journal with dest present drops the backup safely', async () => {
  const t = makeRoot();
  const opId = 'cd2';
  const bak = `${t.dest}.import-bak-${opId}`;
  const txn = `${t.dest}.import-txn-${opId}`;
  fs.mkdirSync(t.dest, { recursive: true });
  fs.writeFileSync(path.join(t.dest, 'live.txt'), 'new');
  fs.mkdirSync(bak, { recursive: true });
  fs.writeFileSync(path.join(bak, 'stale.txt'), 'old');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId, dest: t.dest, tmp: `${t.dest}.import-tmp-${opId}`, bak, state: 'committed',
  }));
  const r = await recoverImportTransactions(t.dest, {
    allowedOpIds: new Set([opId]), allowedTxnDests: { [opId]: t.dest },
  });
  assert.equal(r.recovered.includes(opId), true);
  assert.equal(fs.existsSync(bak), false);
  assert.equal(fs.readFileSync(path.join(t.dest, 'live.txt'), 'utf8'), 'new');
  t.cleanup();
});

test('a journal file physically moved away from its dest parent is untrusted', () => {
  // Physical-path binding: an identical journal dropped under a different
  // directory (e.g. an imported payload file) must not authorize mutation
  // of the recorded tree.
  const t = makeRoot();
  const opId = 'mv1';
  const dest = path.join(t.root, 'real-dest');
  const tmp = `${dest}.import-tmp-${opId}`;
  fs.mkdirSync(dest, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'x.txt'), 'staged');
  // The canonical name, but placed in a sibling directory instead of the
  // dest's parent.
  const strayDir = path.join(t.root, 'stray');
  fs.mkdirSync(strayDir, { recursive: true });
  const strayTxn = path.join(strayDir, `real-dest.import-txn-${opId}`);
  fs.writeFileSync(strayTxn, JSON.stringify({
    version: 1, opId, dest, tmp, bak: `${dest}.import-bak-${opId}`, state: 'staged',
  }));
  // Register the op bound to its real dest so the trust-boundary (not the
  // inventory gate) is what rejects the physically-moved journal.
  const out = reconcileImportTransactionsSync(t.root, {
    allowedOpIds: new Set([opId]), allowedTxnDests: { [opId]: dest },
  });
  const pend = out.pending.find((p) => p.opId === opId);
  assert.ok(pend, 'stray journal must be reported pending');
  assert.equal(pend.reason, 'untrusted-journal');
  // The staging tree it claimed to own must be untouched.
  assert.equal(fs.existsSync(tmp), true);
  t.cleanup();
});

test('async and sync reconcilers reach the same verdict on identical trees', async () => {
  const build = (base) => {
    const t = { dest: path.join(base, 'dest'), root: base };
    const opId = 'same1';
    const tmp = `${t.dest}.import-tmp-${opId}`;
    const txn = `${t.dest}.import-txn-${opId}`;
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'x');
    fs.writeFileSync(txn, JSON.stringify({
      version: 1, opId, dest: t.dest, tmp, bak: `${t.dest}.import-bak-${opId}`, state: 'staged',
    }));
    return t;
  };
  const a = makeRoot(); build(a.root);
  const s = makeRoot(); build(s.root);
  const aDest = path.join(a.root, 'dest');
  const sDest = path.join(s.root, 'dest');
  const asyncOut = await recoverImportTransactions(aDest, {
    allowedOpIds: new Set(['same1']), allowedTxnDests: { same1: aDest },
  });
  const syncOut = reconcileImportTransactionsSync(s.root, {
    allowedOpIds: new Set(['same1']), allowedTxnDests: { same1: sDest },
  });
  assert.deepEqual(asyncOut.recovered, syncOut.recovered);
  assert.deepEqual(asyncOut.pending, syncOut.pending);
  a.cleanup(); s.cleanup();
});

test('an explicit empty op inventory authorizes NO transactions (zero-trust)', async () => {
  // Regression for R2: an empty allowedOpIds set is not permissive — every
  // journal is unregistered, so recovery preserves rather than executes.
  const t = makeRoot();
  fs.mkdirSync(t.dest, { recursive: true });
  const opId = 'op-x';
  const tmp = `${t.dest}.import-tmp-${opId}`;
  const txn = `${t.dest}.import-txn-${opId}`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'f'), 'staged');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId, dest: t.dest, tmp, bak: `${t.dest}.import-bak-${opId}`, state: 'staged',
  }));
  const out = reconcileImportTransactionsSync(t.root, { allowedOpIds: new Set() });
  assert.equal(out.recovered.length, 0, 'empty inventory must reconcile nothing');
  assert.ok(out.pending.some((p) => p.reason === 'unregistered-journal'), 'unregistered must be pending');
  assert.equal(fs.existsSync(tmp), true, 'unowned staging is preserved, not deleted');
  t.cleanup();
});

test('a payload-dropped txn journal is not executed under an explicit inventory', async () => {
  // A transaction-like file inside imported content, absent from the
  // importer's registered opIds, must be preserved not followed.
  const t = makeRoot();
  fs.mkdirSync(t.dest, { recursive: true });
  const opId = 'foreign-op';
  const tmp = `${t.dest}.import-tmp-${opId}`;
  const txn = `${t.dest}.import-txn-${opId}`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'payload'), 'foreign');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId, dest: t.dest, tmp, bak: `${t.dest}.import-bak-${opId}`, state: 'staged',
  }));
  // Inventory knows only a DIFFERENT op — this one is unregistered.
  const out = reconcileImportTransactionsSync(t.root, { allowedOpIds: new Set(['other-op']) });
  assert.equal(out.recovered.length, 0);
  assert.ok(out.pending.some((p) => p.reason === 'unregistered-journal'));
  assert.equal(fs.existsSync(tmp), true, 'foreign staging preserved');
  assert.equal(fs.existsSync(txn), true, 'foreign journal preserved');
  t.cleanup();
});

test('replaceDirJournaled refuses to write through a junctioned destination parent', async (ctx) => {
  // Write-time filesystem boundary: if the destination's parent dir is a
  // junction/symlink into another tree, the staged copy and renames would
  // escape the intended home — refuse before any write.
  const t = makeRoot();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-out-')));
  tempDirs.push(outside);
  fs.mkdirSync(path.join(outside, 'real'), { recursive: true });
  // Place a junction at <root>/linkparent pointing to the outside tree.
  const linkParent = path.join(t.root, 'linkparent');
  try {
    fs.symlinkSync(outside, linkParent, 'junction');
  } catch (error) {
    // Environment cannot create junctions — record an explicit skip so an
    // unsupported host is not mis-reported as a verified pass.
    t.cleanup(); fs.rmSync(outside, { recursive: true, force: true });
    ctx.skip(`junction creation unsupported: ${error && error.code ? error.code : 'link'}`);
    return;
  }
  fs.mkdirSync(t.src, { recursive: true });
  fs.writeFileSync(path.join(t.src, 'f'), 'x');
  const dest = path.join(linkParent, 'dest');
  const result = await replaceDirJournaled(t.src, dest);
  assert.equal(result.ok, false, 'a junctioned dest parent must be refused');
  assert.equal(fs.existsSync(path.join(outside, 'dest')), false, 'nothing escaped into the linked tree');
  t.cleanup(); fs.rmSync(outside, { recursive: true, force: true });
});

test('overlayDir aborts on an inspection error instead of deleting destination-only data', async () => {
  const t = makeRoot();
  // A staged DIRECTORY holds a conflicting source file AND a destination-
  // only file. With overwrite=true, an inspection failure on that staged
  // directory must NOT read as "confirmed symlink" — that would rm the
  // whole directory (including dest-only data) and publish an incomplete
  // merge, reintroducing F1's destination-only deletion.
  fs.mkdirSync(path.join(t.dest, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(t.dest, 'sub', 'conflict.txt'), 'dest-version');
  fs.writeFileSync(path.join(t.dest, 'sub', 'dest-only.txt'), 'must-survive');
  fs.mkdirSync(path.join(t.src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(t.src, 'sub', 'conflict.txt'), 'src-version');
  fs.writeFileSync(path.join(t.src, 'sub', 'new.txt'), 'new');
  const original = fs.lstatSync;
  const stagedDir = path.join(t.dest, 'sub');
  fs.lstatSync = (p) => {
    if (p === stagedDir) {
      const err = new Error('EACCES simulated inspection failure');
      err.code = 'EACCES';
      throw err;
    }
    return original(p);
  };
  try {
    await assert.rejects(() => overlayDir(t.src, t.dest, { overwrite: true }), /overlay-inspection-failed|EACCES/);
  } finally {
    fs.lstatSync = original;
  }
  // The live destination is untouched — exact bytes, not just existence:
  // the rm/commit branches never ran, so destination-only data and the
  // original conflict bytes both survive the aborted merge.
  assert.equal(fs.readFileSync(path.join(t.dest, 'sub', 'dest-only.txt'), 'utf8'), 'must-survive');
  assert.equal(fs.readFileSync(path.join(t.dest, 'sub', 'conflict.txt'), 'utf8'), 'dest-version');
  t.cleanup();
});

test('a bare reconciler call with no ownership context reports but never mutates', async () => {
  // Omitting ownership context must fail CLOSED: a correctly named,
  // internally consistent sidecar is reported as preserved/unowned, and no
  // rename or delete happens on its contents alone.
  const t = makeRoot();
  const opId = 'bare1';
  const tmp = `${t.dest}.import-tmp-${opId}`;
  const txn = `${t.dest}.import-txn-${opId}`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'x.txt'), 'staged');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId, dest: t.dest, tmp, bak: `${t.dest}.import-bak-${opId}`, state: 'staged',
  }));
  const asyncOut = await recoverImportTransactions(t.dest);
  assert.equal(asyncOut.recovered.length, 0, 'no context authorizes no mutation');
  assert.equal(asyncOut.pending.length > 0, true, 'unowned record reported pending');
  assert.equal(fs.existsSync(tmp), true, 'staging preserved, not deleted');
  assert.equal(fs.existsSync(txn), true, 'journal preserved, not consumed');
  // The same fixture under explicit registered ownership reconciles cleanly.
  const bound = await recoverImportTransactions(t.dest, {
    allowedOpIds: new Set([opId]), allowedTxnDests: { [opId]: t.dest },
  });
  assert.equal(bound.recovered.includes(opId), true, 'explicit ownership executes');
  t.cleanup();
});

test('sync reconciler with no ownership context also fails closed', () => {
  const t = makeRoot();
  const opId = 'bare2';
  const destDir = path.join(t.root, 'skills');
  const tmp = `${destDir}.import-tmp-${opId}`;
  const txn = `${destDir}.import-txn-${opId}`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'x.txt'), 'staged');
  fs.writeFileSync(txn, JSON.stringify({
    version: 1, opId, dest: destDir, tmp, bak: `${destDir}.import-bak-${opId}`, state: 'staged',
  }));
  const out = reconcileImportTransactionsSync(t.root);
  assert.equal(out.recovered.length, 0);
  assert.equal(out.pending.length > 0, true);
  assert.equal(fs.existsSync(tmp), true);
  assert.equal(fs.existsSync(txn), true);
  t.cleanup();
});
