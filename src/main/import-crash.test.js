'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const CRASH_CHILD = path.join(__dirname, 'test-fixtures', 'import-crash-child.js');
const RECOVER_CHILD = path.join(__dirname, 'test-fixtures', 'import-recover-child.js');

// 本文件所有 mkdtemp 目录统一登记，套件结束后无论成败一并回收（#478）。
const tempDirs = [];
test.after(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

/**
 * Run a fixture-owned child to settlement. One cleanup path: the timeout is
 * cleared on real exit, a genuine timeout kills only this fixture child and
 * fails explicitly, and bounded stderr is retained for diagnosis.
 */
function runChild(script, args) {
  return new Promise((resolve, reject) => {
    const child = fork(script, args, { silent: true });
    let out = '';
    let errOut = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* The timed-out test child may have exited before the kill. */ }
      // 等子进程真正退出再判定超时（上限 10s），保证回收夹具目录时
      // fixture 已停止写文件（#478）。
      const giveUp = setTimeout(() => resolve({ code: -1, out, errOut, timedOut: true }), 10_000);
      child.once('exit', () => { clearTimeout(giveUp); resolve({ code: -1, out, errOut, timedOut: true }); });
    }, 30000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errOut += d; if (errOut.length > 4000) errOut = errOut.slice(0, 4000); });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, errOut, timedOut: false });
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function makeHome() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-crash-')));
  tempDirs.push(root);
  const source = path.join(root, 'official');
  const dest = path.join(root, 'desktop');
  const userData = path.join(root, 'userData');
  fs.mkdirSync(path.join(source, 'sessions', 'proj', 'sess-a'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'proj', 'sess-a', 'session.jsonl'), 'SRC-BYTES');
  fs.mkdirSync(path.join(source, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(source, 'attachments', 'file.bin'), 'blob');
  fs.mkdirSync(userData, { recursive: true });
  return { root, source, dest, userData };
}

const SESS_REL = path.join('sessions', 'proj', 'sess-a', 'session.jsonl');
const SRC_BYTES = 'SRC-BYTES';
const OLD_BYTES = 'old-dest';

function readDestBytes(h) {
  const f = path.join(h.dest, SESS_REL);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
function readSourceBytes(h) {
  return fs.readFileSync(path.join(h.source, SESS_REL), 'utf8');
}
/** Owned transaction artifacts left by a swap: tmp/bak/txn siblings of dest. */
function txnArtifacts(h) {
  const parent = path.dirname(path.join(h.dest, SESS_REL));
  return fs.existsSync(parent)
    ? fs.readdirSync(parent).filter((n) => n.includes('.import-tmp-') || n.includes('.import-bak-') || n.includes('.import-txn-'))
    : [];
}
function topTxnIds(h) {
  const j = journalOf(h.userData);
  return j && Array.isArray(j.txnIds) ? j.txnIds : [];
}
function journalOf(userData) {
  const f = path.join(userData, 'import-journal.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

async function runCrashThenRecover(h, crashArgs) {
  const crash = await runChild(CRASH_CHILD, [h.source, h.dest, h.userData, ...crashArgs]);
  assert.equal(crash.code, 9, `import must hard-crash at the checkpoint (got ${crash.code}: ${crash.errOut || crash.out})`);
  // Inventory recorded before recovery: the importer registered its opIds
  // bound to destinations in the userData-owned top journal.
  const registeredIds = topTxnIds(h);
  const recover = await runChild(RECOVER_CHILD, [h.userData, h.dest]);
  assert.equal(recover.timedOut, false, 'recovery must not hang');
  assert.equal(recover.code, 0, `recovery must exit cleanly (got ${recover.code}: ${recover.errOut})`);
  const verdict = JSON.parse(recover.out);
  return { crash, registeredIds, verdict, recover };
}

/**
 * Shared assertions for a fully controlled, valid fixture: recovery must
 * reach a definite recovered state (not blocked), land the expected exact
 * bytes at dest, leave source and unowned data untouched, clear owned txn
 * artifacts, and be idempotent on a second run.
 */
async function assertRecovered(h, crashArgs, expectedBytes, label) {
  const { verdict, recover } = await runCrashThenRecover(h, crashArgs);
  assert.equal(verdict.journalPhase, 'recovered', `${label}: controlled fixture must recover, not block`);
  assert.equal(readDestBytes(h), expectedBytes, `${label}: exact destination bytes`);
  assert.equal(readSourceBytes(h), SRC_BYTES, `${label}: source never mutated`);
  assert.deepEqual(txnArtifacts(h), [], `${label}: owned txn artifacts cleared`);
  // Second recovery is a no-op, not a regression.
  const again = await runChild(RECOVER_CHILD, [h.userData, h.dest]);
  assert.equal(again.code, 0);
  assert.equal(readDestBytes(h), expectedBytes, `${label}: idempotent — second recovery keeps the same bytes`);
  fs.rmSync(h.root, { recursive: true, force: true });
}

// staged journal write (journal rename #1): staging never began replacing —
// recovery drops tmp and keeps the ORIGINAL dest bytes.
test('fresh-process: staged crash keeps original dest bytes and recovers cleanly', async () => {
  const h = makeHome();
  fs.mkdirSync(path.dirname(path.join(h.dest, SESS_REL)), { recursive: true });
  fs.writeFileSync(path.join(h.dest, SESS_REL), OLD_BYTES);
  await assertRecovered(h, ['0', '1'], OLD_BYTES, 'staged-crash');
});

// dest->bak rename (fs.promises.rename #1): replacing, dest absent, tmp+bak
// present — recovery finishes tmp->dest and drops bak => new source bytes.
test('fresh-process: dest->bak crash completes tmp->dest with new source bytes', async () => {
  const h = makeHome();
  fs.mkdirSync(path.dirname(path.join(h.dest, SESS_REL)), { recursive: true });
  fs.writeFileSync(path.join(h.dest, SESS_REL), OLD_BYTES);
  await assertRecovered(h, ['1'], SRC_BYTES, 'dest-to-bak-crash');
});

// tmp->dest rename (fs.promises.rename #2): replacing, dest=new content,
// bak still present — recovery drops bak => new source bytes stay.
test('fresh-process: tmp->dest crash keeps new content and drops backup', async () => {
  const h = makeHome();
  fs.mkdirSync(path.dirname(path.join(h.dest, SESS_REL)), { recursive: true });
  fs.writeFileSync(path.join(h.dest, SESS_REL), OLD_BYTES);
  await assertRecovered(h, ['2'], SRC_BYTES, 'tmp-to-dest-crash');
});

// committed journal write (journal rename #3): commit recorded but bak not
// yet cleaned — recovery drops bak => new source bytes stay.
test('fresh-process: committed crash before bak cleanup finalizes and is idempotent', async () => {
  const h = makeHome();
  fs.mkdirSync(path.dirname(path.join(h.dest, SESS_REL)), { recursive: true });
  fs.writeFileSync(path.join(h.dest, SESS_REL), OLD_BYTES);
  await assertRecovered(h, ['0', '3'], SRC_BYTES, 'committed-crash');
});
