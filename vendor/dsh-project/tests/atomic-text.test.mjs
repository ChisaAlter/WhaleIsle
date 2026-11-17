import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicText } from '../lib/files.js';

// atomicText routes its final rename through the vendored renameWithRetry
// (Windows sharing-violation codes, bounded backoff); the helper contract
// itself is pinned against src/shared/fs-safe.js in fs-safe.test.js. These
// cases prove the write path uses it and never leaves a staged temp file.
const eperm = () => Object.assign(new Error('operation not permitted'), { code: 'EPERM' });

async function workspaceDir(t) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-project-atomic-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const strayTemps = async dir => (await fs.readdir(dir)).filter(name => name.endsWith('.tmp'));

test('atomicText completes after transient EPERM renames on win32', async (t) => {
  const dir = await workspaceDir(t);
  const target = join(dir, 'notes.md');
  let calls = 0;
  await atomicText(target, 'note body', {
    platform: 'win32',
    sleep: () => {},
    rename: async (from, to) => {
      calls += 1;
      if (calls <= 2) throw eperm();
      return fs.rename(from, to);
    },
  });
  assert.equal(calls, 3);
  assert.equal(await fs.readFile(target, 'utf8'), 'note body');
  assert.deepEqual(await strayTemps(dir), []);
});

test('atomicText rethrows the original error once the retry window is spent and removes the temp file', async (t) => {
  const dir = await workspaceDir(t);
  const target = join(dir, 'notes.md');
  await fs.writeFile(target, 'original');
  const denied = eperm();
  let calls = 0;
  await assert.rejects(
    atomicText(target, 'replacement', {
      platform: 'win32', sleep: () => {}, budgetMs: 40,
      rename: async () => { calls += 1; throw denied; },
    }),
    error => error === denied,
  );
  assert.ok(calls > 1, 'the bounded window retries before rethrowing');
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
  assert.deepEqual(await strayTemps(dir), []);
});

test('atomicText does not retry off win32 or on other error codes', async (t) => {
  const dir = await workspaceDir(t);
  for (const [platform, code] of [['linux', 'EPERM'], ['win32', 'EEXIST']]) {
    const target = join(dir, `notes-${platform}-${code}.md`);
    let calls = 0;
    await assert.rejects(
      atomicText(target, 'note body', {
        platform, sleep: () => {},
        rename: async () => { calls += 1; throw Object.assign(new Error(code), { code }); },
      }),
      { code },
    );
    assert.equal(calls, 1, `${platform} ${code} fails through immediately`);
  }
  assert.deepEqual(await strayTemps(dir), []);
});
