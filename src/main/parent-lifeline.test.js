'use strict';

// Coverage for the parent-lifeline contract used by dsh-cli-runner.mjs: a
// closed stdin means the Electron parent is gone, and the host must take
// down its whole detached process group instead of lingering as an orphan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnTreeOptions, killProcessTree } = require('../shared/process-tree');

const LIFELINE_URL = pathToFileURL(path.join(__dirname, 'parent-lifeline.mjs')).href;
const PROCESS_TREE_PATH = path.join(__dirname, '..', 'shared', 'process-tree.js');

const posixOnly = { skip: process.platform === 'win32' ? 'POSIX process-group semantics' : false };

function fakeStdin() {
  const stdin = new EventEmitter();
  stdin.resume = () => { stdin.resumed = true; };
  return stdin;
}

for (const event of ['end', 'close', 'error']) {
  test(`watchParentLifeline calls onParentGone once on stdin '${event}'`, async () => {
    const { watchParentLifeline } = await import(LIFELINE_URL);
    const stdin = fakeStdin();
    const reasons = [];
    watchParentLifeline({ stdin, onParentGone: (reason) => reasons.push(reason) });
    assert.equal(stdin.resumed, true, 'stdin must be resumed so EOF is observed');
    stdin.emit(event);
    // Any later lifecycle event must not fire the callback a second time.
    for (const other of ['end', 'close', 'error']) stdin.emit(other);
    assert.deepEqual(reasons, [`stdin-${event}`]);
  });
}

// The fixture mirrors dsh-cli-runner.mjs: install the lifeline, survive the
// group SIGTERM so the scheduled SIGKILL fallback lands, then host a
// SIGTERM-ignoring grandchild and stay resident. It prints
// `<own pid>:<grandchild pid>` only after the grandchild's signal handler is
// armed, so the SIGKILL path — not a startup race — is what removes it.
const FIXTURE_SOURCE = `import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { watchParentLifeline } from ${JSON.stringify(LIFELINE_URL)};
const require = createRequire(import.meta.url);
const { signalProcessTree } = require(${JSON.stringify(PROCESS_TREE_PATH)});
watchParentLifeline({
  onParentGone: () => {
    process.on('SIGTERM', () => {});
    signalProcessTree(process.pid, { signal: 'SIGTERM' });
    setTimeout(() => { signalProcessTree(process.pid, { signal: 'SIGKILL' }); }, Number(process.env.LIFELINE_SIGKILL_MS || 5000)).unref();
  },
});
const leaf = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('r'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
leaf.stdout.once('data', () => {
  process.stdout.write(process.pid + ':' + leaf.pid + '\\n');
});
setInterval(() => {}, 1000);
`;

// Middle parent: holds the fixture's stdin pipe open the same way the
// desktop does, then waits to be SIGKILLed so the pipe dies with it.
const MIDDLE_SOURCE = `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, [process.argv[2]], {
  stdio: ['pipe', 'inherit', 'inherit'],
  detached: true,
});
child.stdin.on('error', () => {});
setInterval(() => {}, 1000);
`;

function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // A zombie still answers signal 0; only a live state counts as alive.
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 1).trim().charAt(0) !== 'Z';
  } catch {
    return true; // no /proc on this POSIX flavour — signal 0 is the best answer
  }
}

function readPidLine(child) {
  return new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += chunk;
      const match = /^(\d+):(\d+)/.exec(text);
      if (match) resolve({ self: Number(match[1]), leaf: Number(match[2]) });
    });
    child.once('exit', () => reject(new Error('child exited before printing its pid line')));
  });
}

function waitExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child did not exit in time')), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function waitDead(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (alive(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(`pid ${pid} still alive after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('closing the parent stdin stops the host and its SIGTERM-ignoring tree', posixOnly, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeline-fixture-'));
  const fixtureFile = path.join(dir, 'fixture.mjs');
  fs.writeFileSync(fixtureFile, FIXTURE_SOURCE);
  const fixture = spawn(process.execPath, [fixtureFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LIFELINE_SIGKILL_MS: '300' },
    ...spawnTreeOptions(),
  });
  fixture.stdin.on('error', () => {});
  let pids = null;
  t.after(async () => {
    await killProcessTree(fixture.pid).catch(() => { /* The test awaits the original promise; this observer prevents an early unhandled rejection. */ });
    if (pids) await killProcessTree(pids.leaf, { graceMs: 200 }).catch(() => { /* The test awaits the original promise; this observer prevents an early unhandled rejection. */ });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  pids = await readPidLine(fixture);
  assert.equal(alive(pids.self), true);
  assert.equal(alive(pids.leaf), true);

  fixture.stdin.end();
  await waitExit(fixture);
  assert.equal(fixture.signalCode, 'SIGKILL', 'the SIGKILL fallback must remove a host that outlived SIGTERM');
  await waitDead(pids.leaf);
});

test('a SIGKILLed middle parent still lets the host observe stdin close', posixOnly, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeline-middle-'));
  const fixtureFile = path.join(dir, 'fixture.mjs');
  const middleFile = path.join(dir, 'middle.cjs');
  fs.writeFileSync(fixtureFile, FIXTURE_SOURCE);
  fs.writeFileSync(middleFile, MIDDLE_SOURCE);
  const middle = spawn(process.execPath, [middleFile, fixtureFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LIFELINE_SIGKILL_MS: '300' },
  });
  let pids = null;
  t.after(async () => {
    await killProcessTree(middle.pid).catch(() => { /* The test awaits the original promise; this observer prevents an early unhandled rejection. */ });
    if (pids) {
      await killProcessTree(pids.self, { graceMs: 200 }).catch(() => { /* The test awaits the original promise; this observer prevents an early unhandled rejection. */ });
      await killProcessTree(pids.leaf, { graceMs: 200 }).catch(() => { /* The test awaits the original promise; this observer prevents an early unhandled rejection. */ });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  pids = await readPidLine(middle);
  assert.equal(alive(pids.self), true);
  assert.equal(alive(pids.leaf), true);

  middle.kill('SIGKILL');
  await waitExit(middle);
  await waitDead(pids.self);
  await waitDead(pids.leaf);
});
