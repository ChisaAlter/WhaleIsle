// 进程内密钥访问器（议题 #427）——就地副本：dsh-acp 以自包含目录随包复制
// （package.json extraResources → resources/dsh-acp/，再经
// src/main/dsh-acp-agents-desktop.js 链入 profile node_modules），相对路径
// 够不到 vendor/dsh-shared，故随 lib/ 一起复制本文件；契约与
// vendor/dsh-shared/lib/internal-secret.mjs（canonical：
// src/shared/secret.js 的 internalSecret）同名同形——只读写
// globalThis[Symbol.for('whaleisle.internalSecrets')] 上的只读密钥视图
// （带 get(name) 的对象；议题 #514 起不再暴露可变 Map），
// 不回退 process.env。
// src/main/internal-secret-accessors.test.js 的契约测试钉住各副本的同键同语义。

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
