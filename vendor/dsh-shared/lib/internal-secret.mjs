// 进程内密钥访问器（议题 #427）——零依赖、零布局探测：只读写
// globalThis[Symbol.for('whaleisle.internalSecrets')] 上的只读密钥视图
// （带 get(name) 的对象；议题 #514 起不再暴露可变 Map）。
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
  const value = store && typeof store.get === 'function' ? store.get(name) : undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * 用给定 entries 整体替换进程内密钥存储。宿主进程内由
 * src/shared/secret.js 的 collectInternalSecrets 安装；测试用它注入与还原。
 * 装上的是真只读视图：条目在闭包私有的 Map 里，对外只有不可枚举、不可写
 * 的 get(name)——Object.freeze(Map) 挡不住 set/delete（议题 #514）。
 * @param {Iterable<[string, string]>} entries
 * @returns {{ get(name: string): string | undefined }} 已安装的只读密钥视图
 */
export function storeInternalSecrets(entries) {
  const map = new Map();
  if (entries) {
    for (const [name, value] of entries) {
      map.set(String(name), value == null ? '' : String(value));
    }
  }
  const store = Object.freeze(
    Object.defineProperty(Object.create(null), 'get', { value: (name) => map.get(name) }),
  );
  globalThis[INTERNAL_SECRETS_KEY] = store;
  return store;
}
