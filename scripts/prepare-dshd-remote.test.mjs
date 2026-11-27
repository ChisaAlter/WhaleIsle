import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withOwnedTempDir } from '../src/shared/fs-safe.js';
import { stageAndPromoteRuntime, pruneSqlitePrebuilds } from './prepare-dshd-remote.mjs';

test('stageAndPromoteRuntime cleans staging on failure without publishing an unverified runtime', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-dshd-remote-stage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'desktop-runtime');

  await assert.rejects(
    () => stageAndPromoteRuntime(destination, async (stagingRoot) => {
      fs.writeFileSync(path.join(stagingRoot, 'partial.txt'), 'unverified');
      throw new Error('probe failed');
    }),
    /probe failed/,
  );

  assert.equal(fs.existsSync(destination), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('stageAndPromoteRuntime preserves existing verified runtime on failure and replaces atomically on success', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-dshd-remote-promote-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'desktop-runtime');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'version.txt'), 'v1');

  await assert.rejects(
    () => stageAndPromoteRuntime(destination, async (stagingRoot) => {
      fs.writeFileSync(path.join(stagingRoot, 'version.txt'), 'v2-broken');
      throw new Error('abi probe failed');
    }),
    /abi probe failed/,
  );
  assert.equal(fs.readFileSync(path.join(destination, 'version.txt'), 'utf8'), 'v1');
  assert.deepEqual(fs.readdirSync(dir), ['desktop-runtime']);

  await stageAndPromoteRuntime(destination, async (stagingRoot) => {
    fs.writeFileSync(path.join(stagingRoot, 'version.txt'), 'v2-ok');
  });
  assert.equal(fs.readFileSync(path.join(destination, 'version.txt'), 'utf8'), 'v2-ok');
  assert.deepEqual(fs.readdirSync(dir), ['desktop-runtime']);
});

test('failed runtime promotion restores the old runtime or retains its backup if restoration also fails', async () => {
  await withOwnedTempDir('whale-dshd-runtime-recovery-', async (dir) => {
    const destination = path.join(dir, 'desktop-runtime');
    const readVersion = (root) => fs.readFileSync(path.join(root, 'version.txt'), 'utf8');
    const build = (root) => fs.writeFileSync(path.join(root, 'version.txt'), 'v2');
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, 'version.txt'), 'v1');
    const rename = fs.renameSync;
    const promotionError = new Error('could not promote staging');
    const restorationError = new Error('could not move backup back');
    let rejectRestore = false;
    const mock = test.mock.method(fs, 'renameSync', (from, to) => {
      if (to === destination && path.basename(from).includes('.staging-')) throw promotionError;
      if (to === destination && rejectRestore) throw restorationError;
      rename(from, to);
    });
    let backup = '';
    try {
      await assert.rejects(stageAndPromoteRuntime(destination, build), (error) => error === promotionError);
      assert.equal(readVersion(destination), 'v1');
      assert.deepEqual(fs.readdirSync(dir), ['desktop-runtime']);

      rejectRestore = true;
      await assert.rejects(stageAndPromoteRuntime(destination, build), (error) => {
        const [backupName] = fs.readdirSync(dir);
        assert.match(backupName, /^desktop-runtime\.old-/);
        backup = path.join(dir, backupName);
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [promotionError, restorationError]);
        assert.ok(error.message.includes(backup));
        return true;
      });
      assert.equal(fs.existsSync(destination), false);
      assert.equal(readVersion(backup), 'v1');
    } finally {
      mock.mock.restore();
    }

    await stageAndPromoteRuntime(destination, build);
    assert.equal(readVersion(destination), 'v2');
    assert.equal(readVersion(backup), 'v1');
    assert.deepEqual(fs.readdirSync(dir), ['desktop-runtime', path.basename(backup)]);
  });
});

test('pruneSqlitePrebuilds keeps only the target platform prebuild and strips C++ build artifacts', async () => {
  await withOwnedTempDir('whale-sqlite-prebuild-', async (dir) => {
    const sqlitePkg = path.join(dir, 'better-sqlite3');
    for (const rel of [
      path.join('prebuilds', 'win32-x64.node'),
      path.join('prebuilds', 'darwin-arm64.node'),
      path.join('deps', 'sqlite3.c'),
      path.join('src', 'better_sqlite3.cpp'),
      'binding.gyp',
      path.join('build', 'Release', 'better_sqlite3.node'),
    ]) {
      const targetFile = path.join(sqlitePkg, rel);
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.writeFileSync(targetFile, 'stub');
    }

    pruneSqlitePrebuilds(sqlitePkg, 'win32-x64');

    assert.equal(fs.existsSync(path.join(sqlitePkg, 'prebuilds', 'win32-x64.node')), true);
    assert.equal(fs.existsSync(path.join(sqlitePkg, 'prebuilds', 'darwin-arm64.node')), false);
    for (const removed of ['deps', 'src', 'binding.gyp', 'build']) {
      assert.equal(fs.existsSync(path.join(sqlitePkg, removed)), false);
    }
    assert.throws(
      () => pruneSqlitePrebuilds(sqlitePkg, 'linux-arm64'),
      /better-sqlite3 prebuild is missing for linux-arm64/,
    );
  });
});
