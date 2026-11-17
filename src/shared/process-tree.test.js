'use strict';

// node:test coverage for the shared process-tree stop primitive. POSIX tests
// run real node children; the Windows branch is exercised through the
// injected `run` seam only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { spawnTreeOptions, killProcessTree } = require('./process-tree');

const posixOnly = { skip: process.platform === 'win32' ? 'POSIX process-group semantics' : false };

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A PID far above any real pid_max is guaranteed ESRCH on every platform.
const DEAD_PID = 2 ** 30;

// Parent prints the pid of its own child; the leaf keeps running past a
// group SIGTERM so only the escalated SIGKILL removes it.
const LEAF_SOURCE = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
const PARENT_SOURCE = [
  "const { spawn } = require('node:child_process');",
  `const leaf = spawn(process.execPath, ['-e', ${JSON.stringify(LEAF_SOURCE)}], { stdio: 'ignore' });`,
  "process.stdout.write(`${leaf.pid}\\n`);",
  'setInterval(() => {}, 1000);',
].join('\n');

function readPidLine(child) {
  return new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += chunk;
      const match = /^(\d+)/.exec(text);
      if (match) resolve(Number(match[1]));
    });
    child.once('exit', () => reject(new Error('parent exited before printing the leaf pid')));
  });
}

test('spawnTreeOptions only detaches on POSIX', () => {
  assert.deepEqual(spawnTreeOptions('win32'), {});
  assert.deepEqual(spawnTreeOptions('linux'), { detached: true });
  assert.deepEqual(spawnTreeOptions('darwin'), { detached: true });
  const expected = process.platform === 'win32' ? {} : { detached: true };
  assert.deepEqual(spawnTreeOptions(), expected);
});

test('killProcessTree stops a detached parent and its SIGTERM-ignoring grandchild', posixOnly, async (t) => {
  const parent = spawn(process.execPath, ['-e', PARENT_SOURCE], {
    stdio: ['ignore', 'pipe', 'ignore'],
    ...spawnTreeOptions(),
  });
  let leafPid = 0;
  t.after(async () => {
    await killProcessTree(parent.pid).catch(() => { /* The test awaits the original promise; this observer prevents an early unhandled rejection. */ });
    if (leafPid) {
      try { process.kill(leafPid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });
  leafPid = await readPidLine(parent);
  assert.equal(alive(parent.pid), true);
  assert.equal(alive(leafPid), true);

  const stopped = await killProcessTree(parent.pid, { graceMs: 200 });
  assert.equal(stopped, true);
  assert.equal(alive(parent.pid), false, 'group leader must be gone');
  assert.equal(alive(leafPid), false, 'a SIGTERM-ignoring descendant must fall to SIGKILL');
});

test('killProcessTree falls back to the single pid when the caller did not start a group', posixOnly, async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(async () => killProcessTree(child.pid).catch(() => { /* The test awaits the original promise; this observer prevents an early unhandled rejection. */ }));
  assert.equal(alive(child.pid), true);
  // No detached spawn: -child.pid is not a group → ESRCH → single-pid signal.
  const stopped = await killProcessTree(child.pid, { graceMs: 200 });
  assert.equal(stopped, true);
  assert.equal(alive(child.pid), false);
});

test('killProcessTree escalates to SIGKILL for a detached child that ignores SIGTERM', posixOnly, async (t) => {
  const child = spawn(process.execPath, ['-e', LEAF_SOURCE], {
    stdio: 'ignore',
    ...spawnTreeOptions(),
  });
  t.after(async () => killProcessTree(child.pid).catch(() => { /* The test awaits the original promise; this observer prevents an early unhandled rejection. */ }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const stopped = await killProcessTree(child.pid, { graceMs: 150 });
  assert.equal(stopped, true);
  assert.equal(alive(child.pid), false);
});

test('killProcessTree SIGKILLs the single pid when a non-group child ignores SIGTERM', posixOnly, async (t) => {
  const child = spawn(process.execPath, ['-e', LEAF_SOURCE], { stdio: 'ignore' });
  t.after(async () => killProcessTree(child.pid).catch(() => { /* The test awaits the original promise; this observer prevents an early unhandled rejection. */ }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  // No group leader: the escalation's group SIGKILL is ESRCH, so the
  // single-pid fallback must be what removes the child.
  const stopped = await killProcessTree(child.pid, { graceMs: 150 });
  assert.equal(stopped, true);
  assert.equal(alive(child.pid), false);
});

test('killProcessTree resolves true for a tree that is already gone', posixOnly, async () => {
  const stopped = await killProcessTree(DEAD_PID, { graceMs: 50 });
  assert.equal(stopped, true);
});

test('killProcessTree returns false for invalid pids without signaling', async () => {
  for (const pid of [0, -3, 1.5, 'x', null]) {
    assert.equal(await killProcessTree(pid), false);
  }
});

test('win32 runs taskkill /pid /T /F with the dsh timeout and confirms the exit', async () => {
  const calls = [];
  const run = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null, '');
  };
  const stopped = await killProcessTree(DEAD_PID, { platform: 'win32', run });
  assert.equal(stopped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'taskkill');
  assert.deepEqual(calls[0].args, ['/pid', String(DEAD_PID), '/T', '/F']);
  assert.equal(calls[0].options.timeout, 2500);
  assert.equal(calls[0].options.windowsHide, true);
});

test('win32 treats a failed taskkill as success when the process already exited', async () => {
  const run = (command, args, options, callback) => callback(new Error('taskkill: process not found'));
  const stopped = await killProcessTree(DEAD_PID, { platform: 'win32', run, graceMs: 50 });
  assert.equal(stopped, true);
});

test('win32 reports PROCESS_TREE_STOP_FAILED when taskkill fails on a live process', async () => {
  const run = (command, args, options, callback) => callback(new Error('taskkill denied'));
  await assert.rejects(
    killProcessTree(process.pid, { platform: 'win32', run, graceMs: 50 }),
    (error) => error.code === 'PROCESS_TREE_STOP_FAILED' && /未停止/.test(error.message),
  );
});

test('win32 reports PROCESS_TREE_STOP_FAILED when the tree outlives the grace window', async () => {
  const run = (command, args, options, callback) => callback(null, '');
  await assert.rejects(
    killProcessTree(process.pid, { platform: 'win32', run, graceMs: 100 }),
    (error) => error.code === 'PROCESS_TREE_STOP_FAILED',
  );
});
