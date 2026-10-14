import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BridgeClient } from '../lib/bridge-client.js';
import { Workspace } from '../bridge/dist/workspace/manager.js';
import { readRuntimeState, findLiveBridge } from '../bridge/dist/bridge/runtime.js';
import { stopBridge } from '../bridge/dist/process/daemon.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('workspace queue rejects cancelled waiting work promptly without blocking another workspace', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chatgpt-queue-'));
  const firstWorkspace = path.join(root, 'first');
  const secondWorkspace = path.join(root, 'second');
  fs.mkdirSync(firstWorkspace);
  fs.mkdirSync(secondWorkspace);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const client = new BridgeClient({ stateDir: path.join(root, 'state') });
  const started = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  client.runProcess = async ([command], workspace, signal) => {
    signal?.throwIfAborted();
    started.push(command);
    if (command === 'setup') await gate;
    return workspace;
  };

  const first = client.run(['setup'], firstWorkspace);
  await Promise.resolve();
  const controller = new AbortController();
  const cancelled = client.run(['record'], firstWorkspace, controller.signal);
  const independent = client.run(['status'], secondWorkspace);
  controller.abort(new Error('cancel waiting record'));
  await assert.rejects(cancelled, /cancel waiting record/);
  assert.equal(await independent, fs.realpathSync.native(secondWorkspace));
  assert.deepEqual(started, ['setup', 'status']);
  release();
  await first;
  await client.run(['pair'], firstWorkspace);
  assert.deepEqual(started, ['setup', 'status', 'pair']);
  await Promise.resolve();
  assert.equal(client.pending.size, 0);
});

test('cancelling a spawned setup retains workspace ownership until its persistent startup settles', { timeout: 20_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chatgpt-startup-cancel-'));
  const workspace = path.join(root, 'workspace');
  const stateDir = path.join(root, 'state');
  const markers = path.join(root, 'spawned');
  const ready = path.join(root, 'release');
  const loader = path.join(root, 'startup-gate.mjs');
  fs.mkdirSync(workspace);
  fs.mkdirSync(markers);
  fs.writeFileSync(loader, `import fs from 'node:fs';
if (process.argv.includes('serve')) {
  fs.writeFileSync(${JSON.stringify(markers)} + '/' + process.pid, 'spawned');
  while (!fs.existsSync(${JSON.stringify(ready)})) await new Promise(resolve => setTimeout(resolve, 10));
}
`);
  const previousOptions = process.env.NODE_OPTIONS;
  const previousState = process.env.D2C_STATE_DIR;
  process.env.NODE_OPTIONS = `${previousOptions ?? ''} --import="${pathToFileURL(loader).href}"`;
  process.env.D2C_STATE_DIR = stateDir;
  const client = new BridgeClient({ stateDir });
  const controller = new AbortController();
  const first = client.run(['setup', '--no-tunnel'], workspace, controller.signal);
  let settled = false;
  const firstResult = first.then(() => { settled = true; }, error => { settled = true; assert.match(error.message, /cancel started setup/); });
  let second;
  try {
    const deadline = Date.now() + 10_000;
    while (fs.readdirSync(markers).length === 0 && Date.now() < deadline) await pause(10);
    assert.equal(fs.readdirSync(markers).length, 1, 'The original setup must have spawned its daemon.');
    assert.equal(readRuntimeState(new Workspace(workspace).id), null, 'The handoff is still pending.');
    controller.abort(new Error('cancel started setup'));
    second = client.run(['setup', '--no-tunnel'], workspace);
    await pause(80);
    assert.equal(settled, false, 'Active cancellation must await setup quiescence.');
    assert.equal(fs.readdirSync(markers).length, 1, 'Queued setup must not spawn another daemon.');
    fs.writeFileSync(ready, 'release');
    await firstResult;
    const connected = await second;
    assert.equal(connected.ok, true);
    assert.equal(fs.readdirSync(markers).length, 1);
    assert.ok(await findLiveBridge(new Workspace(workspace).id));
  } finally {
    fs.writeFileSync(ready, 'release');
    await firstResult;
    if (second) await second;
    await stopBridge(workspace);
    const deadline = Date.now() + 5000;
    while (readRuntimeState(new Workspace(workspace).id) && Date.now() < deadline) await pause(50);
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previousOptions;
    if (previousState === undefined) delete process.env.D2C_STATE_DIR; else process.env.D2C_STATE_DIR = previousState;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
