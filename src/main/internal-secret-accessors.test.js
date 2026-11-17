'use strict';

// 议题 #427：就地访问器副本的契约测试。
// 以复制、tarball、bundle 等方式重定位的插件无法引用 vendor/dsh-shared，
// 因此各自带一份同契约的就地访问器。本测试验证所有副本读取同一个
// globalThis[Symbol.for('whaleisle.internalSecrets')] Map，且失败语义一致
// （fail closed，不回退到 process.env）。

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

// 就地访问器副本（挂载方式使其无法引用 vendor/dsh-shared 的插件）与
// canonical 的清单。新增副本时加到这里。
const ESM_ACCESSORS = [
  'vendor/dsh-shared/lib/internal-secret.mjs',
  'vendor/dsh-project/lib/internal-secret.mjs',
  'vendor/dsh-with-chatgpt/lib/internal-secret.mjs',
  'dsh-acp/lib/internal-secret.mjs',
];
// canonical 用静态 require，保持它在依赖图里可见（knip 据此判断导出被使用）。
const { internalSecret: canonicalInternalSecret, INTERNAL_SECRETS_KEY: canonicalKey } = require('../shared/secret.js');
const CJS_ACCESSORS = [
  'src/host/install-dsh-plugin-client.js',
];

async function loadAccessors() {
  const accessors = [];
  for (const rel of ESM_ACCESSORS) {
    const mod = await import(pathToFileURL(path.join(ROOT, rel)).href);
    accessors.push({ name: rel, internalSecret: mod.internalSecret, key: mod.INTERNAL_SECRETS_KEY });
  }
  accessors.push({ name: 'src/shared/secret.js', internalSecret: canonicalInternalSecret, key: canonicalKey });
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
      // 即使 env 里有值，没有 store 时也返回空串（不回退到 process.env）。
      process.env[SENTINEL_NAME] = SENTINEL_ENV_VALUE;
      delete globalThis[STORE_KEY];
      for (const { name, internalSecret } of accessors) {
        assert.equal(internalSecret(SENTINEL_NAME), '', `${name} must not fall back to process.env`);
        assert.equal(internalSecret('definitely-missing'), '', `${name} must return '' for missing names`);
      }
      // store 不是 Map 时同样返回空串。
      globalThis[STORE_KEY] = 'not-a-map';
      for (const { name, internalSecret } of accessors) {
        assert.equal(internalSecret(SENTINEL_NAME), '', `${name} must return '' when the store is not a Map`);
      }
      // 放入同一个 store 后，所有副本返回相同的值。
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
