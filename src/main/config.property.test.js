'use strict';

// Model-based property test for config read/migrate/save: random legacy
// config shapes, plaintext/encrypted/garbage credentials.json, corrupt
// settings, concurrent saves. Invariants: migration is idempotent, user
// fields survive, credentials never reach the public projection, and
// credentials.json stays mode 0600.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-prop-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: {
      isPackaged: false,
      getPath() { return userData; },
    },
  },
};

const { isDeepStrictEqual } = require('node:util');
const {
  loadConfig,
  saveConfig,
  publicConfig,
  configPath,
  credentialsPath,
  setSafeStorageForTests,
} = require('./config');
const { fuzzAssert } = require('../../scripts/lib/fuzz.cjs');

const NUM_RUNS = 20;
const CONFIG_FILE = configPath();
const CREDS_FILE = credentialsPath();
const CRED_KEYS = ['apiKey', 'baseUrl', 'githubToken', 'remoteToken', 'remoteRelayToken', 'remoteDevices'];
const SECRET_VALUES = ['sk-secret-alpha', 'ghp_secret_beta', 'tok_remote_gamma', 'relay-secret-delta'];

function fakeSafeStorage(available) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decryptString: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('not encrypted by this fake');
      return text.slice(4);
    },
  };
}

// loadConfig re-normalizes on every call; a few fields are time-derived
// (lastTick defaults to Date.now()), so comparisons canonicalize them.
function canonicalize(config) {
  const copy = JSON.parse(JSON.stringify(config));
  for (const pet of [copy.pet, copy.live2dPet]) {
    if (pet && pet.stats && Number.isFinite(pet.stats.lastTick)) pet.stats.lastTick = 0;
  }
  return copy;
}

const credSplit = (config) => {
  const creds = {};
  const pub = {};
  for (const [key, value] of Object.entries(canonicalize(config))) {
    if (CRED_KEYS.includes(key)) creds[key] = value;
    else pub[key] = value;
  }
  return { creds, pub };
};

function diskSnapshot() {
  const read = (file) => {
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
  };
  return { config: read(CONFIG_FILE), creds: read(CREDS_FILE) };
}

function credsFileMode() {
  try {
    return fs.statSync(CREDS_FILE).mode & 0o777;
  } catch {
    return null;
  }
}

/**
 * Every invariant that must hold after every command, whatever the sequence:
 * public projection leaks nothing, credentials.json stays 0600, config.json
 * parses and — once a save has run — carries no credential keys.
 */
function checkInvariants(model, label) {
  const loaded = loadConfig();
  const projection = publicConfig(loaded);
  const rendered = JSON.stringify(projection);
  for (const secret of model.secrets) {
    assert.ok(!rendered.includes(secret), `${label}: publicConfig leaked ${secret}`);
  }
  assert.ok(projection.apiKey === '' || projection.apiKey === '********',
    `${label}: apiKey projection ${projection.apiKey}`);
  assert.ok(projection.githubToken === '' || projection.githubToken === '********',
    `${label}: githubToken projection ${projection.githubToken}`);
  assert.equal(projection.remoteToken, '', `${label}: remoteToken leaked`);
  assert.equal(projection.remoteRelayToken, '', `${label}: remoteRelayToken leaked`);
  assert.deepEqual(projection.remoteDevices, [], `${label}: remoteDevices leaked`);
  // User fields seeded into config.json survive every read/save/migration.
  for (const [key, value] of Object.entries(model.userFields)) {
    assert.equal(JSON.stringify(loaded[key]), JSON.stringify(value), `${label}: user field ${key} lost`);
  }
  const rawConfig = diskSnapshot().config;
  const parsedConfig = rawConfig === null ? null : JSON.parse(rawConfig);
  if (parsedConfig !== null && model.savedOnce) {
    for (const key of CRED_KEYS) {
      assert.ok(!Object.prototype.hasOwnProperty.call(parsedConfig, key),
        `${label}: config.json still carries ${key} after a save`);
    }
  }
  if (process.platform !== 'win32' && credsFileMode() !== null) {
    assert.equal(credsFileMode(), 0o600, `${label}: credentials.json mode drifted`);
  }
  return loaded;
}

function seedConfigFile(stored) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  if (stored === null) {
    fs.writeFileSync(CONFIG_FILE, '{ this is not json');
    return;
  }
  if (stored === 'nonobject') {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify([1, 2, 3]));
    return;
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(stored, null, 2));
}

function seedCredsFile(mode, creds) {
  fs.mkdirSync(path.dirname(CREDS_FILE), { recursive: true });
  switch (mode) {
    case 'absent':
      try { fs.rmSync(CREDS_FILE); } catch { /* absent */ }
      return;
    case 'garbage':
      fs.writeFileSync(CREDS_FILE, 'not json at all', { mode: 0o600 });
      return;
    case 'nonobject':
      fs.writeFileSync(CREDS_FILE, '"just a string"', { mode: 0o600 });
      return;
    case 'envelope': {
      const payload = fakeSafeStorage(true).encryptString(JSON.stringify(creds)).toString('base64');
      fs.writeFileSync(CREDS_FILE, JSON.stringify({ version: 'safeStorage-v1', payload }), { mode: 0o600 });
      return;
    }
    default: // plain
      fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
  }
}

class SeedCommand {
  constructor(spec) { this.spec = spec; }
  check() { return true; }
  async run(model) {
    const spec = this.spec;
    const stored = spec.stored === 'corrupt' ? null : spec.stored === 'nonobject' ? 'nonobject' : spec.stored;
    const userFields = stored && typeof stored === 'object'
      ? Object.fromEntries(Object.entries(stored).filter(([key]) => key.startsWith('custom')))
      : {};
    const seededCreds = spec.credsMode === 'plain' || spec.credsMode === 'envelope'
      ? spec.creds : null;
    seedConfigFile(stored);
    seedCredsFile(spec.credsMode, spec.creds || {});
    model.userFields = userFields;
    model.savedOnce = false;
    model.credsUnreadable = spec.credsMode === 'garbage'
      || (spec.credsMode === 'envelope' && !model.encryptionAvailable);
    const loaded = checkInvariants(model, this.toString());
    if (!model.credsUnreadable) {
      for (const key of ['apiKey', 'githubToken', 'remoteToken']) {
        const want = seededCreds && typeof seededCreds[key] === 'string'
          ? seededCreds[key]
          : (stored && typeof stored === 'object' && typeof stored[key] === 'string' ? stored[key] : '');
        assert.equal(loaded[key], want, `${this}: ${key} did not migrate`);
      }
      if (seededCreds && Array.isArray(seededCreds.remoteDevices)) {
        assert.deepEqual(loaded.remoteDevices, seededCreds.remoteDevices, `${this}: remoteDevices lost`);
      }
    }
  }
  toString() { return `seed(stored=${this.spec.stored === null ? 'corrupt' : 'obj'},creds=${this.spec.credsMode})`; }
}

class SaveCommand {
  constructor(patch) { this.patch = patch; }
  check() { return true; }
  async run(model) {
    const touchesCreds = CRED_KEYS.some((key) => Object.prototype.hasOwnProperty.call(this.patch, key));
    let thrown = null;
    let merged = null;
    try {
      merged = saveConfig(this.patch);
    } catch (error) {
      thrown = error;
    }
    if (model.credsUnreadable && touchesCreds) {
      assert.ok(thrown !== null, `${this}: cred-touching save must refuse an unreadable store`);
      checkInvariants(model, this.toString());
      return;
    }
    assert.equal(thrown, null, `${this}: ${thrown && thrown.message}`);
    for (const secret of SECRET_VALUES) {
      if (Object.values(this.patch).includes(secret)) model.secrets.add(secret);
    }
    model.savedOnce = true;
    const loaded = checkInvariants(model, this.toString());
    assert.deepEqual(canonicalize(loaded), canonicalize(merged),
      `${this}: reload after save differs from merged result`);
    const snap = diskSnapshot();
    assert.ok(snap.config !== null, `${this}: save must leave a config.json`);
  }
  toString() { return `save(${JSON.stringify(this.patch)})`; }
}

class ConcurrentSaveCommand {
  constructor(patchA, patchB) { this.patchA = patchA; this.patchB = patchB; }
  check() { return true; }
  async run(model) {
    const before = loadConfig();
    const { creds: credsBefore, pub: pubBefore } = credSplit(before);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => saveConfig(this.patchA)),
      Promise.resolve().then(() => saveConfig(this.patchB)),
    ]);
    const merged = results
      .map((entry) => (entry.status === 'fulfilled' ? entry.value : null))
      .filter(Boolean);
    const touchesCreds = (patch) => CRED_KEYS.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
    if (model.credsUnreadable && (touchesCreds(this.patchA) || touchesCreds(this.patchB))) {
      // Any save carrying credential keys must refuse while the store is
      // unreadable; pure-public saves still go through.
      const [a, b] = results;
      if (touchesCreds(this.patchA)) assert.equal(a.status, 'rejected', `${this}: cred-touching save must refuse`);
      if (touchesCreds(this.patchB)) assert.equal(b.status, 'rejected', `${this}: cred-touching save must refuse`);
    }
    assert.ok(merged.length >= 1 || (model.credsUnreadable && touchesCreds(this.patchA) && touchesCreds(this.patchB)),
      `${this}: every save rejected`);
    for (const value of Object.values(this.patchA).concat(Object.values(this.patchB))) {
      if (SECRET_VALUES.includes(value)) model.secrets.add(value);
    }
    if (merged.length >= 1) model.savedOnce = true;
    const loaded = checkInvariants(model, this.toString());
    const { creds: credsNow, pub: pubNow } = credSplit(loaded);
    // Atomic writes: each file is a complete result of one writer (or the
    // pre-race state when a writer skipped an identical file) — never torn.
    const pubCandidates = merged.map(credSplit).map((p) => p.pub).concat([pubBefore]);
    const credCandidates = merged.map(credSplit).map((p) => p.creds).concat([credsBefore]);
    assert.ok(pubCandidates.some((cand) => isDeepStrictEqual(cand, pubNow)),
      `${this}: config.json mixes writes from different saves`);
    assert.ok(credCandidates.some((cand) => isDeepStrictEqual(cand, credsNow)),
      `${this}: credentials.json mixes writes from different saves`);
  }
  toString() { return `concurrentSave(${JSON.stringify(this.patchA)}|${JSON.stringify(this.patchB)})`; }
}

class CorruptCommand {
  constructor(target) { this.target = target; }
  check() { return true; }
  async run(model) {
    if (this.target === 'config') {
      fs.writeFileSync(CONFIG_FILE, '{ broken json');
      model.userFields = {};
      const loaded = checkInvariants(model, this.toString());
      // A corrupt settings file must not crash the load; the fields come back
      // as defaults (the file is moved aside for recovery).
      assert.ok(typeof loaded === 'object' && loaded !== null);
      assert.ok(!fs.existsSync(CONFIG_FILE) || fs.readdirSync(userData).some((name) => name.startsWith('config.json.corrupt-')),
        `${this}: corrupt config.json must be set aside`);
    } else {
      fs.writeFileSync(CREDS_FILE, '{ not credentials', { mode: 0o600 });
      model.credsUnreadable = true;
      checkInvariants(model, this.toString());
    }
  }
  toString() { return `corrupt(${this.target})`; }
}

class EncryptionFlipCommand {
  constructor(available) { this.available = available; }
  check() { return true; }
  async run(model) {
    setSafeStorageForTests(fakeSafeStorage(this.available));
    model.encryptionAvailable = this.available;
    const raw = diskSnapshot().creds;
    let parseFailed = false;
    let isEnvelope = false;
    try {
      const parsed = raw === null ? null : JSON.parse(raw);
      isEnvelope = Boolean(parsed && parsed.version === 'safeStorage-v1');
    } catch {
      parseFailed = raw !== null;
    }
    model.credsUnreadable = parseFailed || (isEnvelope && !this.available);
    checkInvariants(model, this.toString());
  }
  toString() { return `encryption(${this.available})`; }
}

class IdempotentCommand {
  check() { return true; }
  async run(model) {
    if (model.credsUnreadable) {
      // A loaded config always carries credential keys, so saving it while the
      // credential store is unreadable must refuse rather than clobber.
      assert.throws(() => saveConfig(loadConfig()));
      checkInvariants(model, this.toString());
      return;
    }
    saveConfig(loadConfig());
    const first = diskSnapshot();
    saveConfig(loadConfig());
    const second = diskSnapshot();
    assert.equal(first.config, second.config, `${this}: repeated save rewrote config.json`);
    assert.equal(first.creds, second.creds, `${this}: repeated save rewrote credentials.json`);
    model.savedOnce = true;
    checkInvariants(model, this.toString());
  }
  toString() { return 'idempotent'; }
}

const customFieldsArb = fc.dictionary(
  fc.constantFrom('customAlpha', 'customBeta', 'customGamma', 'customNested'),
  fc.oneof(fc.string({ maxLength: 12 }), fc.integer(), fc.boolean(),
    fc.record({ inner: fc.string({ maxLength: 8 }) })),
  { maxKeys: 3 },
);

const legacyStoredArb = fc.oneof(
  fc.record({
    locale: fc.constantFrom('en', 'zh', 'fr', '', 42),
    closeToTray: fc.boolean(),
    workspace: fc.string({ maxLength: 20 }),
    apiKey: fc.constantFrom('', 'sk-legacy-plain', 'sk-secret-alpha'),
    githubToken: fc.constantFrom('', 'ghp_legacy', 'ghp_secret_beta'),
  }).chain((base) => customFieldsArb.map((extra) => ({ ...base, ...extra }))),
  fc.constant('corrupt'),
  fc.constant('nonobject'),
);

const credsArb = fc.record({
  apiKey: fc.constantFrom('sk-secret-alpha', 'plain-key', ''),
  githubToken: fc.constantFrom('ghp_secret_beta', ''),
  remoteToken: fc.constantFrom('tok_remote_gamma', ''),
  remoteRelayToken: fc.constantFrom('relay-secret-delta', ''),
  remoteDevices: fc.constantFrom([], [{ id: 'dev_1', name: 'phone' }]),
});

const savePatchArb = fc.record({
  closeToTray: fc.boolean(),
  locale: fc.constantFrom('en', 'zh', 'fr'),
  remoteEnabled: fc.boolean(),
  apiKey: fc.constantFrom('sk-secret-alpha', '', '********', 'sk-new'),
  githubToken: fc.constantFrom('ghp_secret_beta', '', '********'),
  remoteToken: fc.constantFrom('tok_remote_gamma', ''),
}, { requiredKeys: [] });

const configCommandArbs = [
  fc.tuple(legacyStoredArb, fc.constantFrom('absent', 'plain', 'envelope', 'garbage', 'nonobject'), credsArb)
    .map(([stored, credsMode, creds]) => new SeedCommand({ stored, credsMode, creds })),
  savePatchArb.map((patch) => new SaveCommand(patch)),
  fc.tuple(savePatchArb, savePatchArb).map(([a, b]) => new ConcurrentSaveCommand(a, b)),
  fc.constantFrom('config', 'credentials').map((target) => new CorruptCommand(target)),
  fc.boolean().map((available) => new EncryptionFlipCommand(available)),
  fc.constant(null).map(() => new IdempotentCommand()),
];

test('config read/migrate/save survives random legacy shapes, corruption and concurrent saves', async (t) => {
  t.after(() => {
    setSafeStorageForTests(undefined);
    fs.rmSync(userData, { recursive: true, force: true });
  });
  await fuzzAssert(fc.asyncProperty(
    fc.boolean(),
    fc.commands(configCommandArbs, { minCommands: 3, maxCommands: 18 }),
    async (encryptionAvailable, commands) => {
      fs.rmSync(userData, { recursive: true, force: true });
      fs.mkdirSync(userData, { recursive: true });
      setSafeStorageForTests(fakeSafeStorage(encryptionAvailable));
      const model = {
        userFields: {},
        secrets: new Set(),
        savedOnce: false,
        credsUnreadable: false,
        encryptionAvailable,
      };
      await fc.asyncModelRun(() => ({ model, real: model }), commands);
      checkInvariants(model, 'teardown');
      return true;
    },
  ), 'config migration keeps credentials out of the public projection and stays idempotent', { numRuns: NUM_RUNS });
});
