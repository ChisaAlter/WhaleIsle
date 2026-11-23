'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTaskControlPeer, PEER_FILENAME } = require('./task-control-peer');

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-peer-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('task control peer writes peer file on start and removes it on stop', async (t) => {
  const stateDir = makeTempDir(t);
  const peer = createTaskControlPeer({
    stateDir: () => stateDir,
    onPeerStop: async () => ({ ok: true }),
    onPeerInstall: async () => ({ ok: true }),
  });
  const started = await peer.start();
  assert.equal(started.ok, true);
  const peerFile = path.join(stateDir, PEER_FILENAME);
  assert.equal(fs.existsSync(peerFile), true);
  const parsed = JSON.parse(fs.readFileSync(peerFile, 'utf8'));
  assert.equal(parsed.generation, peer.generation);
  assert.equal(parsed.url, peer.url);

  const res = await fetch(`${peer.url}/peer/status`, {
    headers: { authorization: `Bearer ${peer.token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  await peer.stop();
  assert.equal(fs.existsSync(peerFile), false);
});

test('stop() racing with async writePeerFile never leaves a stale peer file on disk', async (t) => {
  const stateDir = makeTempDir(t);
  const peerFile = path.join(stateDir, PEER_FILENAME);
  const origMkdir = fs.promises.mkdir;
  let releaseWrite;
  let writeStarted;
  const writeStartedPromise = new Promise((resolve) => { writeStarted = resolve; });
  t.after(() => { fs.promises.mkdir = origMkdir; });
  fs.promises.mkdir = async (...args) => {
    if (args[0] === stateDir) {
      writeStarted();
      await new Promise((resolve) => { releaseWrite = resolve; });
    }
    return origMkdir.apply(fs.promises, args);
  };

  const peer = createTaskControlPeer({
    stateDir: () => stateDir,
    onPeerStop: async () => ({ ok: true }),
    onPeerInstall: async () => ({ ok: true }),
  });
  const startPromise = peer.start();
  await writeStartedPromise;
  const stopPromise = peer.stop();
  releaseWrite();
  const [startResult] = await Promise.all([startPromise, stopPromise]);
  assert.equal(startResult.ok, false);
  assert.equal(startResult.error, 'stopped');
  assert.equal(fs.existsSync(peerFile), false);
});
