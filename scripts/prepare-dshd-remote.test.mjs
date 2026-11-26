import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageAndPromoteRuntime } from './prepare-dshd-remote.mjs';

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
