import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zh, en } from '../client-src/locale.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function placeholdersOf(text) {
  return [...String(text).matchAll(/\{([a-zA-Z0-9_.-]+)\}/g)].map((m) => m[1]).sort();
}

test('client/client.js matches client-src/ via tools/build-client.mjs --check', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'tools', 'build-client.mjs'), '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
});

test('client-src/locale.js zh and en key sets and placeholders stay 100% aligned', () => {
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.ok(zhKeys.length > 0, 'locale dictionary must not be empty');
  assert.deepEqual(zhKeys, enKeys, 'zh and en locale keys must match exactly');
  for (const key of zhKeys) {
    assert.equal(typeof zh[key], 'string', `zh["${key}"] must be a string`);
    assert.equal(typeof en[key], 'string', `en["${key}"] must be a string`);
    assert.ok(zh[key].trim().length > 0, `zh["${key}"] must be non-empty`);
    assert.ok(en[key].trim().length > 0, `en["${key}"] must be non-empty`);
    assert.deepEqual(
      placeholdersOf(zh[key]),
      placeholdersOf(en[key]),
      `Placeholders mismatch for locale key "${key}"`,
    );
  }
});
