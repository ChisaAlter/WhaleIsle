import test from 'node:test';
import assert from 'node:assert/strict';

// run-tests.mjs 的对照夹具（#478）：不碰 tmp，runner 必须按零残留放行。
// 顺带打印注入的 TMPDIR，供外层断言 runner 的专属目录已被回收。
test('leaves nothing behind', () => {
  assert.equal(1 + 1, 2);
});

console.log(`RUNNER_TMPDIR=${JSON.stringify(process.env.TMPDIR ?? '')}`);
console.log(`NARB_NATIVE_CACHE_DIR=${JSON.stringify(process.env.NARB_NATIVE_CACHE_DIR ?? null)}`);
