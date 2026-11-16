import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  chromeSandboxUsable,
  shouldDisableElectronSandbox,
  electronTestEnv,
} = require('./electron-sandbox.cjs');

const binary = path.join(path.dirname(fileURLToPath(import.meta.url)), 'electron');

const statOf = (uid, mode) => ({ uid, mode });
const enoent = () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; };

test('chromeSandboxUsable requires a root-owned setuid helper', () => {
  assert.equal(chromeSandboxUsable(binary, { statSync: () => statOf(0, 0o104755) }), true);
  assert.equal(chromeSandboxUsable(binary, { statSync: () => statOf(1000, 0o104755) }), false);
  assert.equal(chromeSandboxUsable(binary, { statSync: () => statOf(0, 0o100755) }), false);
  assert.equal(chromeSandboxUsable(binary, { statSync: enoent }), false);
  assert.throws(() => chromeSandboxUsable(binary, { statSync: () => { throw new Error('EACCES'); } }), /EACCES/);
});

test('shouldDisableElectronSandbox only decides on Linux', () => {
  const deps = { platform: 'win32', getuid: () => 0, statSync: () => statOf(1000, 0o100755) };
  assert.equal(shouldDisableElectronSandbox(binary, deps), false);
  const darwin = { platform: 'darwin', getuid: () => 1000, statSync: enoent };
  assert.equal(shouldDisableElectronSandbox(binary, darwin), false);
});

test('root tests and missing SUID helper disable the sandbox', () => {
  assert.equal(shouldDisableElectronSandbox(binary, {
    platform: 'linux', getuid: () => 0, statSync: () => statOf(0, 0o104755),
  }), true);
  assert.equal(shouldDisableElectronSandbox(binary, {
    platform: 'linux', getuid: () => 1000, statSync: enoent,
  }), true);
  assert.equal(shouldDisableElectronSandbox(binary, {
    platform: 'linux', getuid: () => 1000, statSync: () => statOf(0, 0o104755),
  }), false);
  // No getuid (non-POSIX API): the helper check alone decides.
  assert.equal(shouldDisableElectronSandbox(binary, {
    platform: 'linux', getuid: undefined, statSync: () => statOf(0, 0o104755),
  }), false);
});

test('electronTestEnv adds ELECTRON_DISABLE_SANDBOX without mutating the caller env', () => {
  const base = { KEEP: 'me' };
  const env = electronTestEnv(binary, base, {
    platform: 'linux', getuid: () => 1000, statSync: enoent,
  });
  assert.equal(env.ELECTRON_DISABLE_SANDBOX, '1');
  assert.equal(env.KEEP, 'me');
  assert.equal('ELECTRON_DISABLE_SANDBOX' in base, false);
  const kept = electronTestEnv(binary, {}, {
    platform: 'linux', getuid: () => 1000, statSync: () => statOf(0, 0o104755),
  });
  assert.equal('ELECTRON_DISABLE_SANDBOX' in kept, false);
});
