'use strict';

// 议题 #427: 就地访问器副本の契約テスト。
// コピー / tarball / bundle 等で再配置されるプラグインは vendor/dsh-shared に
// 辿れないため、各プラグインが同契約の就地アクセス器を持つ。本テストは全副本が
// 同じ globalThis[Symbol.for('whaleisle.internalSecrets')] の Map を読み、
// 同じ fail closed セマンティクスを持つこと（＝ process.env 回退なし）を検証する。

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const STORE_KEY = Symbol.for('whaleisle.internalSecrets');
const SENTINEL_NAME = 'WHALEISLE_CONTRACT_TEST_TOKEN';
const SENTINEL_ENV_VALUE = 'env-value-must-not-be-read';
const SENTINEL_STORE_VALUE = 'store-value-7f31';

// 就地アクセス器副本（mount 方式により vendor/dsh-shared を参照できない
// プラグイン）と canonical の一覧。新しい副本を足したらここに追加する。
const ESM_ACCESSORS = [
  'vendor/dsh-shared/lib/internal-secret.mjs',
  'vendor/dsh-project/lib/internal-secret.mjs',
  'vendor/dsh-with-chatgpt/lib/internal-secret.mjs',
  'dsh-acp/lib/internal-secret.mjs',
];
const CJS_ACCESSORS = [
  'src/shared/secret.js',
  'src/host/install-dsh-plugin-client.js',
];

async function loadAccessors() {
  const accessors = [];
  for (const rel of ESM_ACCESSORS) {
    const mod = await import(pathToFileURL(path.join(ROOT, rel)).href);
    accessors.push({ name: rel, internalSecret: mod.internalSecret, key: mod.INTERNAL_SECRETS_KEY });
  }
  const req = createRequire(path.join(ROOT, 'src', 'shared', 'secret.js'));
  for (const rel of CJS_ACCESSORS) {
    const mod = req(path.join(ROOT, rel));
    accessors.push({ name: rel, internalSecret: mod.internalSecret, key: mod.INTERNAL_SECRETS_KEY });
  }
  return accessors;
}

describe('internal secret accessor copies', () => {
  test('all copies use the same globalThis store key', async () => {
    const accessors = await loadAccessors();
    assert.ok(accessors.length >= 5, 'accessor list is incomplete');
    for (const { name, internalSecret } of accessors) {
      assert.equal(typeof internalSecret, 'function', `${name} must export internalSecret`);
    }
    for (const { name, key } of accessors) {
      if (key !== undefined) {
        assert.equal(key, STORE_KEY, `${name} uses a different store key`);
      }
    }
  });

  test('all copies read the same store value and fail closed identically', async () => {
    const accessors = await loadAccessors();
    const priorStore = globalThis[STORE_KEY];
    const priorEnv = process.env[SENTINEL_NAME];
    try {
      // env に値があっても store がなければ空串（process.env 回退なし）。
      process.env[SENTINEL_NAME] = SENTINEL_ENV_VALUE;
      delete globalThis[STORE_KEY];
      for (const { name, internalSecret } of accessors) {
        assert.equal(internalSecret(SENTINEL_NAME), '', `${name} must not fall back to process.env`);
        assert.equal(internalSecret('definitely-missing'), '', `${name} must return '' for missing names`);
      }
      // store が Map でなくても空串。
      globalThis[STORE_KEY] = 'not-a-map';
      for (const { name, internalSecret } of accessors) {
        assert.equal(internalSecret(SENTINEL_NAME), '', `${name} must return '' when the store is not a Map`);
      }
      // 同一ストアを置けば全副本が同じ値を返す。
      globalThis[STORE_KEY] = Object.freeze(new Map([[SENTINEL_NAME, SENTINEL_STORE_VALUE]]));
      for (const { name, internalSecret } of accessors) {
        assert.equal(internalSecret(SENTINEL_NAME), SENTINEL_STORE_VALUE, `${name} must read the shared store`);
        assert.equal(internalSecret('definitely-missing'), '', `${name} must return '' for missing names`);
      }
    } finally {
      if (priorStore === undefined) delete globalThis[STORE_KEY];
      else globalThis[STORE_KEY] = priorStore;
      if (priorEnv === undefined) delete process.env[SENTINEL_NAME];
      else process.env[SENTINEL_NAME] = priorEnv;
    }
  });
});
