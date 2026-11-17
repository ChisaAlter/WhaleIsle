const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  atomicWriteFile,
  atomicWriteFileSync,
  safeRemove,
  safeRemoveSync,
  withOwnedTempDir,
  createUniqueDir,
} = require('./fs-safe');

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-safe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function strayTemps(dir) {
  return fs.readdirSync(dir).filter(name => /\.\d+\.[0-9a-f]{16}\.tmp$/.test(name));
}

test('atomicWriteFileSync writes the target and leaves no temp files', (t) => {
  const dir = workspace(t);
  const file = path.join(dir, 'value.txt');
  atomicWriteFileSync(file, 'hello', { encoding: 'utf8' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'hello');
  assert.deepEqual(strayTemps(dir), []);
});

test('atomicWriteFile writes the target asynchronously', async (t) => {
  const dir = workspace(t);
  const file = path.join(dir, 'value.txt');
  await atomicWriteFile(file, Buffer.from('bytes'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'bytes');
  assert.deepEqual(strayTemps(dir), []);
});

test('atomicWriteFileSync keeps the target content when the rename fails', (t) => {
  const dir = workspace(t);
  const file = path.join(dir, 'value.txt');
  fs.writeFileSync(file, 'original');
  let tmpName;
  t.mock.method(fs, 'renameSync', (from, to) => {
    tmpName = from;
    throw new Error('EIO rename');
  });
  assert.throws(() => atomicWriteFileSync(file, 'replacement'), /EIO rename/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  // The temp name carries the pid and is cleaned up after the failure.
  assert.match(path.basename(tmpName), new RegExp(`\\.${process.pid}\\.`));
  assert.deepEqual(strayTemps(dir), []);
});

test('atomicWriteFile keeps the target content when the rename fails', async (t) => {
  const dir = workspace(t);
  const file = path.join(dir, 'value.txt');
  fs.writeFileSync(file, 'original');
  t.mock.method(fs.promises, 'rename', () => Promise.reject(new Error('EIO rename')));
  await assert.rejects(atomicWriteFile(file, 'replacement'), /EIO rename/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.deepEqual(strayTemps(dir), []);
});

test('atomicWriteFileSync removes the temp file when the write itself fails', (t) => {
  const dir = workspace(t);
  const file = path.join(dir, 'value.txt');
  t.mock.method(fs, 'writeFileSync', () => { throw new Error('ENOSPC'); });
  assert.throws(() => atomicWriteFileSync(file, 'data'), /ENOSPC/);
  assert.deepEqual(strayTemps(dir), []);
  assert.equal(fs.existsSync(file), false);
});

test('atomicWriteFileSync preserves existing permission bits', { skip: process.platform === 'win32' }, (t) => {
  const dir = workspace(t);
  const file = path.join(dir, 'value.txt');
  fs.writeFileSync(file, 'original', { mode: 0o640 });
  atomicWriteFileSync(file, 'replacement');
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});

test('atomicWriteFileSync honors an explicit mode for a new file', { skip: process.platform === 'win32' }, (t) => {
  const dir = workspace(t);
  const file = path.join(dir, 'value.txt');
  atomicWriteFileSync(file, 'private', { mode: 0o600 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('safeRemove removes a directory tree', async (t) => {
  const dir = workspace(t);
  const nested = path.join(dir, 'nested', 'deep');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'f'), 'x');
  const result = await safeRemove(path.join(dir, 'nested'));
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(dir, 'nested')), false);
});

test('safeRemove does not throw and reports failure', async (t) => {
  const dir = workspace(t);
  const target = path.join(dir, 'busy');
  fs.writeFileSync(target, 'x');
  const logged = [];
  const mocked = t.mock.method(fs.promises, 'rm', () => Promise.reject(Object.assign(new Error('EBUSY'), { code: 'EBUSY' })));
  const result = await safeRemove(target, { log: (t2, error) => logged.push([t2, error.code]) });
  mocked.mock.restore();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EBUSY');
  assert.deepEqual(logged, [[target, 'EBUSY']]);
  assert.equal(fs.existsSync(target), true);
});

test('safeRemoveSync does not throw and reports failure', (t) => {
  const dir = workspace(t);
  const target = path.join(dir, 'busy');
  fs.writeFileSync(target, 'x');
  const mocked = t.mock.method(fs, 'rmSync', () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); });
  const result = safeRemoveSync(target);
  mocked.mock.restore();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EBUSY');
});

test('withOwnedTempDir removes the directory after fn returns', async (t) => {
  workspace(t);
  let leaked;
  const result = await withOwnedTempDir('fs-safe-', (dir) => {
    leaked = dir;
    assert.ok(dir.startsWith(os.tmpdir()));
    fs.writeFileSync(path.join(dir, 'inside'), 'x');
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(fs.existsSync(leaked), false);
});

test('withOwnedTempDir removes the directory when fn throws', async (t) => {
  workspace(t);
  let leaked;
  await assert.rejects(
    withOwnedTempDir('fs-safe-', (dir) => {
      leaked = dir;
      fs.writeFileSync(path.join(dir, 'inside'), 'x');
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(fs.existsSync(leaked), false);
});

test('withOwnedTempDir accepts removal options for late-releasing consumers', async (t) => {
  let leaked;
  await withOwnedTempDir('fs-safe-', (dir) => { leaked = dir; }, { rmOptions: { maxRetries: 2, retryDelay: 1 } });
  assert.equal(fs.existsSync(leaked), false);
});

test('createUniqueDir makes a prefixed directory under the chosen parent', (t) => {
  const parent = workspace(t);
  const dir = createUniqueDir(parent, 'fs-safe-unique-');
  assert.equal(path.dirname(dir), parent);
  assert.ok(path.basename(dir).startsWith('fs-safe-unique-'));
  assert.ok(fs.statSync(dir).isDirectory());
});

test('withOwnedTempDir refuses to delete a path replaced by an outside link', async (t) => {
  const dir = workspace(t);
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel'), 'keep');
  await withOwnedTempDir('fs-safe-', (leased) => {
    fs.rmSync(leased, { recursive: true, force: true });
    fs.symlinkSync(outside, leased, process.platform === 'win32' ? 'junction' : 'dir');
  });
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'keep');
});
