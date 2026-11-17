'use strict';

// Model-based property test for the relay device credential store that
// dshd-remote.js drives (vendored RelayDeviceCredentialStore): random
// issue/revoke/rename/secret/proof/token/reopen sequences against a real
// on-disk store. Invariants: a revoked device can never authenticate again,
// a challenge cannot replay, the public snapshot never carries secrets, and
// disk + snapshot + model always agree. When the vendored dist is missing the
// test gates off exactly like dshd-remote.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('url');
const fc = require('fast-check');

const { fuzzAssert } = require('../../scripts/lib/fuzz.cjs');
const { prerequisiteSkip } = require('../../scripts/lib/test-prerequisites.cjs');

const NUM_RUNS = 20;
const VENDOR_ROOT = path.join(__dirname, '..', '..', 'vendor', 'chisacode-remote');
const SERVER_DIR = path.join(
  VENDOR_ROOT, 'node_modules', '@chisacode', 'server', 'dist', 'server', 'server',
);
const VENDOR_BUILD = {
  ok: fs.existsSync(path.join(SERVER_DIR, 'relay-device-credential-store.js')),
  reason: 'vendored server dist 缺失（npm run prepare:dshd-remote 会构建）',
};

let Store = null;
let computeRelayDeviceAuthProof = null;

test.before(async () => {
  if (!VENDOR_BUILD.ok) return;
  const [storeApi, authApi] = await Promise.all([
    import(pathToFileURL(path.join(SERVER_DIR, 'relay-device-credential-store.js')).href),
    import(pathToFileURL(path.join(SERVER_DIR, 'relay-device-auth.js')).href),
  ]);
  Store = storeApi.RelayDeviceCredentialStore;
  computeRelayDeviceAuthProof = authApi.computeRelayDeviceAuthProof;
});

const ID_POOL = ['dev_aaaaaaaa', 'dev_bbbbbbbb', 'dev_cccccccc', 'dev_dddddddd'];
const LABELS = ['phone', 'laptop', 'Tablet 中文', '', 'x'.repeat(200), ' spaced '];

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-pairing-prop-'));
}

function storeFile(home) {
  return path.join(home, 'relay-devices.json');
}

function diskDevices(home) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(home), 'utf8'));
    return parsed && parsed.v === 1 && Array.isArray(parsed.devices) ? parsed.devices : null;
  } catch {
    return null; // missing or unparsable
  }
}

function fileMode(home) {
  try {
    return fs.statSync(storeFile(home)).mode & 0o777;
  } catch {
    return null;
  }
}

/**
 * Cross-checks the whole observable surface against the model:
 * snapshot (listDevices), disk file, and file permissions.
 */
function checkConsistency(model) {
  const listed = model.store.listDevices();
  const byId = new Map();
  for (const device of listed) {
    // The public snapshot never exposes a raw secret.
    assert.equal(Object.prototype.hasOwnProperty.call(device, 'secret'), false,
      `snapshot leaked a secret for ${device.deviceId}`);
    assert.ok(!byId.has(device.deviceId), `duplicate deviceId ${device.deviceId}`);
    byId.set(device.deviceId, device);
    const expected = model.devices.get(device.deviceId);
    assert.ok(expected !== undefined, `snapshot has unknown device ${device.deviceId}`);
    assert.equal(device.label, expected.label, `label drift on ${device.deviceId}`);
    assert.equal(device.revokedAt === null, !expected.revoked,
      `revocation drift on ${device.deviceId}`);
  }
  assert.equal(byId.size, model.devices.size,
    `snapshot size ${byId.size} != model ${model.devices.size}`);
  const onDisk = diskDevices(model.home);
  if (onDisk === null) {
    // An unreadable store file resets to empty — the model must be empty too.
    assert.equal(model.devices.size, 0, 'unreadable store file but model still tracks devices');
    return;
  }
  assert.equal(onDisk.length, model.devices.size, 'disk device count drift');
  for (const record of onDisk) {
    const expected = model.devices.get(record.deviceId);
    assert.ok(expected !== undefined, `disk has unknown device ${record.deviceId}`);
    assert.equal(record.secret, expected.secret, `secret drift on ${record.deviceId}`);
    assert.equal(record.revokedAt === null, !expected.revoked,
      `disk revocation drift on ${record.deviceId}`);
  }
  if (process.platform !== 'win32') {
    assert.equal(fileMode(model.home), 0o600, 'relay-devices.json must stay owner-only');
  }
}

class IssueDeviceCommand {
  constructor(idIndex, labelIndex, usePreferred) {
    this.idIndex = idIndex; this.labelIndex = labelIndex; this.usePreferred = usePreferred;
  }
  check() { return true; }
  async run(model) {
    const id = this.usePreferred ? ID_POOL[this.idIndex % ID_POOL.length] : undefined;
    const label = LABELS[this.labelIndex % LABELS.length];
    const existing = id ? model.devices.get(id) : undefined;
    let thrown = null;
    let issued = null;
    try {
      issued = model.store.issueDevice(label, id);
    } catch (error) {
      thrown = error;
    }
    if (existing && !existing.revoked) {
      // Re-issuing a live id is a conflict, never a silent overwrite.
      assert.ok(thrown && /already registered/.test(thrown.message), `issue ${id}`);
      checkConsistency(model);
      return;
    }
    assert.equal(thrown, null, `issue ${id}: ${thrown && thrown.message}`);
    model.devices.set(issued.deviceId, {
      secret: issued.deviceSecret,
      revoked: false,
      label: label.trim().slice(0, 120) || undefined,
    });
    checkConsistency(model);
  }
  toString() { return `issue(${this.usePreferred ? ID_POOL[this.idIndex % ID_POOL.length] : 'new'})`; }
}

class RevokeDeviceCommand {
  constructor(idIndex) { this.idIndex = idIndex; }
  check() { return true; }
  async run(model) {
    const candidates = ID_POOL.concat([...model.devices.keys()], [`ghost_${this.idIndex}`]);
    const deviceId = candidates[this.idIndex % candidates.length];
    const existed = model.devices.has(deviceId);
    const result = model.store.revokeDevice(deviceId);
    assert.equal(result, existed, `revoke ${deviceId}`);
    if (!existed) {
      checkConsistency(model);
      return;
    }
    const record = model.devices.get(deviceId);
    record.revoked = true;
    // A revoked device must never authenticate again — check both paths now.
    assert.equal(model.store.verifyDeviceSecret(deviceId, record.secret), false,
      `revoked ${deviceId} still accepts its secret`);
    const challenge = `chal-${crypto.randomBytes(8).toString('hex')}`;
    const proof = computeRelayDeviceAuthProof(record.secret, {
      deviceId, challenge, serverId: 'srv-test',
      daemonPublicKeyB64: Buffer.from('daemon-key').toString('base64'),
      clientPublicKeyB64: Buffer.from('client-key').toString('base64'),
    });
    assert.equal(model.store.verifyDeviceProof({
      deviceId, proof, challenge, serverId: 'srv-test',
      daemonPublicKeyB64: Buffer.from('daemon-key').toString('base64'),
      clientPublicKeyB64: Buffer.from('client-key').toString('base64'),
    }), false, `revoked ${deviceId} still accepts a proof`);
    checkConsistency(model);
  }
  toString() { return `revoke(#${this.idIndex})`; }
}

class RenameDeviceCommand {
  constructor(idIndex, labelIndex) { this.idIndex = idIndex; this.labelIndex = labelIndex; }
  check() { return true; }
  async run(model) {
    const id = ID_POOL[this.idIndex % ID_POOL.length];
    const label = LABELS[this.labelIndex % LABELS.length];
    const record = model.devices.get(id);
    const result = model.store.renameDevice(id, label);
    assert.equal(result, Boolean(record && !record.revoked), `rename ${id}`);
    if (record && !record.revoked) {
      const next = label.trim().slice(0, 120);
      if (next) record.label = next;
    }
    checkConsistency(model);
  }
  toString() { return `rename(${ID_POOL[this.idIndex % ID_POOL.length]})`; }
}

class ReopenStoreCommand {
  check() { return true; }
  async run(model) {
    model.store = new Store(model.home);
    checkConsistency(model);
  }
  toString() { return 'reopen'; }
}

class CorruptStoreCommand {
  check() { return true; }
  async run(model) {
    fs.writeFileSync(storeFile(model.home), '{ not json', { mode: 0o600 });
    model.store = new Store(model.home);
    model.devices.clear();
    checkConsistency(model);
  }
  toString() { return 'corruptStore'; }
}

class VerifySecretCommand {
  constructor(idIndex, mode) { this.idIndex = idIndex; this.mode = mode; }
  check() { return true; }
  async run(model) {
    const id = ID_POOL[this.idIndex % ID_POOL.length];
    const record = model.devices.get(id);
    const secret = this.mode === 'wrong' || !record ? 'wrong-secret-padding-1234567890' : record.secret;
    const result = model.store.verifyDeviceSecret(id, secret);
    assert.equal(result, Boolean(record && !record.revoked && this.mode !== 'wrong'),
      `verifySecret ${id} mode=${this.mode}`);
    checkConsistency(model);
  }
  toString() { return `verifySecret(${ID_POOL[this.idIndex % ID_POOL.length]},${this.mode})`; }
}

class VerifyProofCommand {
  constructor(idIndex, mode) { this.idIndex = idIndex; this.mode = mode; }
  check() { return true; }
  async run(model) {
    const id = ID_POOL[this.idIndex % ID_POOL.length];
    const record = model.devices.get(id);
    const challenge = `chal-${crypto.randomBytes(8).toString('hex')}`;
    const base = {
      deviceId: id,
      challenge,
      serverId: 'srv-test',
      daemonPublicKeyB64: Buffer.from('daemon-key').toString('base64'),
      clientPublicKeyB64: Buffer.from('client-key').toString('base64'),
    };
    if (this.mode === 'good' && record) {
      const proof = computeRelayDeviceAuthProof(record.secret, { ...base, challenge });
      const result = model.store.verifyDeviceProof({ ...base, proof });
      assert.equal(result, !record.revoked, `proof ${id} revoked=${record.revoked}`);
      if (result) {
        // The same challenge can never be presented twice — replay protection.
        const again = model.store.verifyDeviceProof({ ...base, proof });
        assert.equal(again, false, `challenge replay accepted for ${id}`);
      }
    } else {
      const secret = record ? record.secret : 'no-such-secret-00000000000000000';
      const tampered = computeRelayDeviceAuthProof(
        this.mode === 'wrongSecret' ? 'attacker-secret-000000000000000' : secret,
        { ...base, challenge },
      );
      const result = model.store.verifyDeviceProof({ ...base, proof: this.mode === 'wrongProof' ? 'bogus' : tampered });
      assert.equal(result, false, `bad proof accepted for ${id} mode=${this.mode}`);
    }
    checkConsistency(model);
  }
  toString() { return `verifyProof(${ID_POOL[this.idIndex % ID_POOL.length]},${this.mode})`; }
}

class PairingTokenCommand {
  constructor(ttlMs) { this.ttlMs = ttlMs; }
  check() { return true; }
  async run(model) {
    const { token, expiresAtMs } = model.store.issuePairingToken(this.ttlMs);
    const live = expiresAtMs > Date.now();
    assert.equal(model.store.isPairingTokenActive(token), live);
    const first = model.store.consumePairingToken(token);
    assert.equal(first, live, `consume token ttl=${this.ttlMs}`);
    // A consumed (or expired) token never validates twice.
    assert.equal(model.store.consumePairingToken(token), false, 'token consumed twice');
    assert.equal(model.store.isPairingTokenActive(token), false);
    checkConsistency(model);
  }
  toString() { return `pairingToken(${this.ttlMs})`; }
}

const pairingCommandArbs = [
  fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: LABELS.length - 1 }), fc.boolean())
    .map(([a, b, c]) => new IssueDeviceCommand(a, b, c)),
  fc.integer({ min: 0, max: ID_POOL.length - 1 }).map((n) => new RevokeDeviceCommand(n)),
  fc.tuple(fc.integer({ min: 0, max: ID_POOL.length - 1 }), fc.integer({ min: 0, max: LABELS.length - 1 }))
    .map(([a, b]) => new RenameDeviceCommand(a, b)),
  fc.constant(null).map(() => new ReopenStoreCommand()),
  fc.constant(null).map(() => new CorruptStoreCommand()),
  fc.tuple(fc.integer({ min: 0, max: ID_POOL.length - 1 }), fc.constantFrom('good', 'wrong'))
    .map(([a, b]) => new VerifySecretCommand(a, b)),
  fc.tuple(fc.integer({ min: 0, max: ID_POOL.length - 1 }), fc.constantFrom('good', 'wrongSecret', 'wrongProof'))
    .map(([a, b]) => new VerifyProofCommand(a, b)),
  fc.constantFrom(-1, 60_000).map((ttl) => new PairingTokenCommand(ttl)),
];

test('relay device credential store: revoked devices never re-authenticate and snapshot always matches disk',
  { skip: prerequisiteSkip(VENDOR_BUILD) }, async () => {
    await fuzzAssert(fc.asyncProperty(
      fc.commands(pairingCommandArbs, { minCommands: 3, maxCommands: 18 }),
      async (commands) => {
        const home = freshHome();
        try {
          const model = { home, store: new Store(home), devices: new Map() };
          await fc.asyncModelRun(() => ({ model, real: model.store }), commands);
          checkConsistency(model);
          return true;
        } finally {
          fs.rmSync(home, { recursive: true, force: true });
        }
      },
    ), 'relay device credential store keeps snapshot, disk and revocation invariants', { numRuns: NUM_RUNS });
  });
