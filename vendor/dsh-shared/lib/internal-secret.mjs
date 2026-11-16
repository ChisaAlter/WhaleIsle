// 进程内密钥访问器（议题 #427）——零依赖、零布局探测：只读写
// globalThis[Symbol.for('whaleisle.internalSecrets')] 上的只读 Map。
// canonical 实现在 <repo>/src/shared/secret.js（internalSecret /
// storeInternalSecrets / collectInternalSecrets），两侧契约同名同形。
// 凡可能被 esbuild 等打包器内联的宿主插件源码（vendor/dsh-im
// src/channels/shared/semantic/desktop-confirm.mjs）只能 import 本文件：
// secret.mjs 门面里的 import.meta 布局探测被内联后会指向 bundle 位置而
// 失效；本文件内联后仍是对同一 globalThis 键的访问，行为不变。
// vendor 插件一律经本文件取令牌——不回退 process.env。

export const INTERNAL_SECRETS_KEY = Symbol.for('whaleisle.internalSecrets');

/**
 * 读取一枚进程内密钥；没有存储或没有该名时返回空串，读方 fail closed。
 * @param {string} name - 密钥名（沿用原环境变量名）
 * @returns {string}
 */
export function internalSecret(name) {
  const store = globalThis[INTERNAL_SECRETS_KEY];
  const value = store instanceof Map ? store.get(name) : undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * 用给定 entries 整体替换进程内密钥存储（冻结 Map）。宿主进程内由
 * src/shared/secret.js 的 collectInternalSecrets 安装；测试用它注入与还原。
 * @param {Iterable<[string, string]>} entries
 * @returns {Map<string, string>} 已安装的冻结 Map
 */
export function storeInternalSecrets(entries) {
  const map = new Map();
  if (entries) {
    for (const [name, value] of entries) {
      map.set(String(name), value == null ? '' : String(value));
    }
  }
  globalThis[INTERNAL_SECRETS_KEY] = Object.freeze(map);
  return globalThis[INTERNAL_SECRETS_KEY];
}
