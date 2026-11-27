'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DshdRemote, VENDOR_ROOT, loadServerApi } = require('./dshd-remote');
const { withOwnedTempDir } = require('../shared/fs-safe');
const { prerequisiteSkip, requirePrerequisite } = require('../../scripts/lib/test-prerequisites.cjs');

const VENDOR_BUILD = {
  ok: fs.existsSync(path.join(VENDOR_ROOT, 'packages', 'server', 'dist', 'server', 'server', 'relay-device-credential-store.js')),
  reason: 'chisacode server dist missing (run node scripts/prepare-dshd-remote.mjs --force)',
};

function createFakeChild() {
  const writes = [];
  const child = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = {
    write(line) {
      writes.push(String(line));
      return true;
    },
  };
  return { child, writes };
}

test('8-process concurrent contender verifyDeviceProof never clobbers 50 main-process revokeDevice writes', { skip: prerequisiteSkip(VENDOR_BUILD) }, async (t) => {
  requirePrerequisite(t, VENDOR_BUILD);
  await withOwnedTempDir('whale-revoke-race-', async (home) => {
    const api = await loadServerApi();
    const storeModule = path.join(VENDOR_ROOT, 'packages', 'server', 'dist', 'server', 'server', 'relay-device-credential-store.js');
    const authModule = path.join(VENDOR_ROOT, 'packages', 'server', 'dist', 'server', 'server', 'relay-device-auth.js');
    const contenderPath = path.join(__dirname, 'test-fixtures', 'relay-store-contender.mjs');

    const setup = new api.RelayDeviceCredentialStore(home);
    const deviceB = setup.issueDevice('Active Device B', 'dev_active_B');
    const targetIds = Array.from({ length: 50 }, (_, idx) => `dev_target_${String(idx + 1).padStart(2, '0')}`);
    for (const id of targetIds) {
      setup.issueDevice(`Target ${id}`, id);
    }

    const children = [];
    t.after(async () => {
      await Promise.all(children.map(({ child, done }) => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch { /* exited */ }
        }
        return done;
      }));
    });

    for (let w = 0; w < 8; w += 1) {
      const child = spawn(
        process.execPath,
        [contenderPath, pathToFileURL(storeModule).href, pathToFileURL(authModule).href, home, deviceB.deviceId, deviceB.deviceSecret, String(w), '15'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const done = new Promise((resolve) => {
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.once('exit', (code) => resolve({ code, stderr }));
      });
      children.push({ child, done });
    }

    const revoker = new api.RelayDeviceCredentialStore(home);
    for (const id of targetIds) {
      assert.equal(revoker.revokeDevice(id), true);
    }

    const outcomes = await Promise.all(children.map((item) => item.done));
    for (const outcome of outcomes) {
      assert.equal(outcome.code, 0, `contender failed: ${outcome.stderr}`);
    }

    const finalStore = new api.RelayDeviceCredentialStore(home);
    const lost = targetIds.filter((id) => !finalStore.getDevice(id)?.revokedAt);
    assert.deepEqual(lost, [], `lost revocations: ${lost.length}/50`);
    const reloadedB = finalStore.getDevice(deviceB.deviceId);
    assert.ok(reloadedB && reloadedB.recentChallengeHashes.length <= 32);
    assert.equal(reloadedB.revokedAt, null);
  });
});

test('unbindDevice keeps sync behavior and unbindDeviceWithAck tracks store-first order and all terminal states', async () => {
  await withOwnedTempDir('whale-unbind-ack-', async (home) => {
    let persisted = [];
    const logs = [];
    const fakeStore = {
      listDevices: () => [],
      revokeDevice(id) { persisted.push(id); return true; },
    };
    const remote = new DshdRemote({ getHomeDir: () => home, revokeAckTimeoutMs: 50, log: (m) => logs.push(m) });
    remote.serverApi = { RelayDeviceCredentialStore: function FakeStore() { return fakeStore; } };

    // 1. Offline daemon returns ok:true, daemon-offline
    const offline = await remote.unbindDeviceWithAck('dev_off');
    assert.deepEqual(offline.revokeResult, { ok: true, state: 'daemon-offline' });
    assert.deepEqual(persisted, ['dev_off']);

    // 2. Pending daemon receives both sync unbindDevice and async ACK
    const { child, writes } = createFakeChild();
    const pendingHandle = { child, stopping: false, readyResolve() {}, readyReject() {} };
    remote.pendingDaemon = pendingHandle;

    const syncSnap = remote.unbindDevice('dev_sync_pending');
    assert.equal(typeof syncSnap.available, 'boolean');
    assert.equal(writes[0], 'revoke-device dev_sync_pending\n');

    // Verify store persisted BEFORE stdin write inside unbindDeviceWithAck
    persisted = [];
    const origRevoke = fakeStore.revokeDevice;
    fakeStore.revokeDevice = (id) => {
      assert.equal(writes.length, 1, 'store.revokeDevice must run before writing revoke-device line');
      return origRevoke(id);
    };
    const ackPromise = remote.unbindDeviceWithAck('dev_ack_1');
    fakeStore.revokeDevice = origRevoke;
    const sentLine = writes[1].trim();
    assert.match(sentLine, /^revoke-device dev_ack_1 [0-9a-f-]+$/);
    const requestId = sentLine.split(/\s+/)[2];
    remote.handleDaemonLogLine(pendingHandle, JSON.stringify({
      msg: 'dshd_daemon_device_revoked',
      requestId,
      deviceId: 'dev_ack_1',
      disconnected: 2,
    }));
    const confirmed = await ackPromise;
    assert.deepEqual(confirmed.revokeResult, { ok: true, state: 'confirmed', disconnected: 2 });

    // 3. Timeout settles cleanly
    const timedOut = await remote.unbindDeviceWithAck('dev_timeout');
    assert.deepEqual(timedOut.revokeResult, { ok: false, state: 'timeout' });

    // 4. pendingDaemon exit before ACK settles daemon-exited immediately
    const exitAckPromise = remote.unbindDeviceWithAck('dev_exit');
    remote.handleDaemonExit(pendingHandle, 1, null);
    const exited = await exitAckPromise;
    assert.deepEqual(exited.revokeResult, { ok: false, state: 'daemon-exited' });

    // 5. Missing store / BUSY store -> store-failed with zero stdin writes
    const writesBeforeBusy = writes.length;
    remote.daemon = { child, stopping: false, readyResolve() {}, readyReject() {} };
    remote.serverApi = {};
    const missingStoreRes = await remote.unbindDeviceWithAck('dev_no_store');
    assert.deepEqual(missingStoreRes.revokeResult, { ok: false, state: 'store-failed' });
    assert.equal(writes.length, writesBeforeBusy);
    remote.unbindDevice('dev_no_store_sync');
    assert.equal(writes.length, writesBeforeBusy);

    remote.serverApi = { RelayDeviceCredentialStore: function FakeStore() { return fakeStore; } };
    fakeStore.revokeDevice = () => {
      const err = new Error('busy');
      err.code = 'RELAY_DEVICE_STORE_BUSY';
      throw err;
    };
    const busyRes = await remote.unbindDeviceWithAck('dev_busy');
    assert.deepEqual(busyRes.revokeResult, { ok: false, state: 'store-failed' });
    assert.equal(writes.length, writesBeforeBusy);
    assert.ok(logs.some((line) => line.includes('吊销设备落盘失败')));
  });
});
