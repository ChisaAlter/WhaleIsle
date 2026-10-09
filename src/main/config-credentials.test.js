const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-creds-test-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: {
      isPackaged: false,
      getPath(name) {
        if (name === 'userData') return userData;
        if (name === 'documents') return userData;
        return userData;
      },
    },
  },
};

const {
  loadConfig,
  saveConfig,
  credentialsPath,
  setSafeStorageForTests,
} = require('./config');

/** Reversible fake: 'enc:' prefix stands in for OS-keychain ciphertext. */
function fakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decryptString: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith('enc:')) {
        throw new Error('not encrypted by this fake');
      }
      return text.slice(4);
    },
  };
}

function resetDisk() {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });
}

test.afterEach(() => {
  setSafeStorageForTests(undefined);
});

test.after(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

test('credentials round-trip through the safeStorage envelope, never plaintext on disk', () => {
  resetDisk();
  setSafeStorageForTests(fakeSafeStorage());
  saveConfig({ apiKey: 'sk-secret-123', githubToken: 'ghp_secret', workspace: userData });

  const onDisk = fs.readFileSync(credentialsPath(), 'utf8');
  assert.doesNotMatch(onDisk, /sk-secret-123/);
  assert.doesNotMatch(onDisk, /ghp_secret/);
  const parsed = JSON.parse(onDisk);
  assert.equal(parsed.version, 'safeStorage-v1');
  assert.equal(typeof parsed.payload, 'string');

  const config = loadConfig();
  assert.equal(config.apiKey, 'sk-secret-123');
  assert.equal(config.githubToken, 'ghp_secret');
});

test('legacy plaintext credentials.json is read and migrated to the envelope once', () => {
  resetDisk();
  fs.writeFileSync(credentialsPath(), JSON.stringify({
    apiKey: 'legacy-key',
    baseUrl: '',
    githubToken: 'legacy-token',
    remoteToken: '',
    remoteRelayToken: '',
    remoteDevices: [],
  }), 'utf8');
  setSafeStorageForTests(fakeSafeStorage());

  const config = loadConfig();
  assert.equal(config.apiKey, 'legacy-key');
  assert.equal(config.githubToken, 'legacy-token');

  const migrated = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
  assert.equal(migrated.version, 'safeStorage-v1');
  assert.doesNotMatch(migrated.payload, /legacy-key/);
  // Migrated file keeps decrypting.
  assert.equal(loadConfig().apiKey, 'legacy-key');
});

test('without an available keychain, credentials stay plaintext and readable', () => {
  resetDisk();
  setSafeStorageForTests(fakeSafeStorage({ available: false }));
  saveConfig({ apiKey: 'plain-key', workspace: userData });

  const raw = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
  assert.equal(raw.version, undefined);
  assert.equal(raw.apiKey, 'plain-key');
  assert.equal(loadConfig().apiKey, 'plain-key');
});

test('an undecryptable envelope fails closed to empty credentials, not a crash', () => {
  resetDisk();
  fs.writeFileSync(credentialsPath(), JSON.stringify({
    version: 'safeStorage-v1',
    payload: Buffer.from('garbage', 'utf8').toString('base64'),
  }), 'utf8');
  setSafeStorageForTests(fakeSafeStorage());

  const config = loadConfig();
  assert.equal(config.apiKey, '');
  assert.equal(config.githubToken, '');
});

test('an envelope with no keychain available fails closed instead of leaking payload', () => {
  resetDisk();
  setSafeStorageForTests(fakeSafeStorage());
  saveConfig({ apiKey: 'sk-later-locked', workspace: userData });
  setSafeStorageForTests(fakeSafeStorage({ available: false }));

  const config = loadConfig();
  assert.equal(config.apiKey, '');
});

test('ordinary and unchanged settings preserve credential bytes and avoid redundant disk writes', () => {
  resetDisk();
  const storage = fakeSafeStorage();
  let encryptions = 0;
  const encrypt = storage.encryptString;
  storage.encryptString = (value) => { encryptions += 1; return encrypt(value); };
  setSafeStorageForTests(storage);
  saveConfig({ apiKey: 'retained-key', workspace: userData, closeToTray: true });
  const credentialBytes = fs.readFileSync(credentialsPath(), 'utf8');
  saveConfig({ closeToTray: false });
  assert.equal(encryptions, 1);
  assert.equal(fs.readFileSync(credentialsPath(), 'utf8'), credentialBytes);
  assert.equal(loadConfig().apiKey, 'retained-key');

  const writes = [];
  const write = fs.writeFileSync;
  fs.writeFileSync = (file, ...args) => { writes.push(String(file)); return write(file, ...args); };
  try {
    saveConfig({ closeToTray: false });
    assert.deepEqual(writes, []);
  } finally {
    fs.writeFileSync = write;
  }
  saveConfig({ apiKey: 'updated-key' });
  assert.equal(encryptions, 2);
  assert.equal(loadConfig().apiKey, 'updated-key');
});

test('selective saves still observe external config and credential changes', () => {
  resetDisk();
  setSafeStorageForTests(fakeSafeStorage({ available: false }));
  saveConfig({ apiKey: 'original-key', workspace: userData, closeToTray: true });
  const configFile = path.join(userData, 'config.json');
  const publicLayer = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  fs.writeFileSync(configFile, JSON.stringify({ ...publicLayer, closeToTray: false }));
  const credentialLayer = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
  fs.writeFileSync(credentialsPath(), JSON.stringify({ ...credentialLayer, apiKey: 'external-key' }));
  saveConfig({ locale: 'en' });
  assert.equal(loadConfig().closeToTray, false);
  assert.equal(loadConfig().locale, 'en');
  assert.equal(loadConfig().apiKey, 'external-key');
});
