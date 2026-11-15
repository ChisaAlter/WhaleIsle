const test = require('node:test');
const assert = require('node:assert/strict');
const { killProcessTree } = require('./git-exec');

function fakeChild(pid) {
  const child = { killed: 0, kill: () => { child.killed += 1; } };
  if (pid !== undefined) child.pid = pid;
  return child;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('killProcessTree delegates the owned pid to the shared tree stop', async () => {
  const child = fakeChild(4242);
  const calls = [];
  killProcessTree(child, {
    platform: 'linux',
    stopTree: async (pid, options) => {
      calls.push({ pid, options });
      return true;
    },
  });
  await settle();
  assert.deepEqual(calls, [{ pid: 4242, options: { platform: 'linux' } }]);
  assert.equal(child.killed, 0, 'a confirmed tree stop needs no direct kill');
});

test('killProcessTree forwards the platform so Windows runs taskkill /T /F in the shared stop', async () => {
  const child = fakeChild(4242);
  const calls = [];
  killProcessTree(child, {
    platform: 'win32',
    stopTree: async (pid, options) => {
      calls.push({ pid, options });
      return true;
    },
  });
  await settle();
  assert.deepEqual(calls, [{ pid: 4242, options: { platform: 'win32' } }]);
  assert.equal(child.killed, 0);
});

test('killProcessTree falls back to child.kill when the tree stop fails', async () => {
  const child = fakeChild(4242);
  killProcessTree(child, {
    platform: 'linux',
    stopTree: async () => {
      const error = new Error('tree stop refused');
      error.code = 'PROCESS_TREE_STOP_FAILED';
      throw error;
    },
  });
  await settle();
  assert.equal(child.killed, 1, 'a refused tree stop must not leave the git child alive');
});

test('killProcessTree falls back to child.kill when the tree stop reports no stop', async () => {
  const child = fakeChild(4242);
  killProcessTree(child, { platform: 'linux', stopTree: async () => false });
  await settle();
  assert.equal(child.killed, 1);
});

test('killProcessTree falls back to child.kill when the tree stop throws synchronously', async () => {
  const child = fakeChild(4242);
  killProcessTree(child, {
    platform: 'linux',
    stopTree: () => { throw new Error('EPERM'); },
  });
  await settle();
  assert.equal(child.killed, 1);
});

test('killProcessTree without a pid uses child.kill', async () => {
  const child = fakeChild(undefined);
  killProcessTree(child, {
    platform: 'linux',
    stopTree: () => { throw new Error('must not stop without a pid'); },
  });
  await settle();
  assert.equal(child.killed, 1);
});
