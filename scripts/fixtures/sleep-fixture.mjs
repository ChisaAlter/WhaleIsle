import test from 'node:test';

// run-tests.mjs 的信号路径夹具（#478）：打印注入的 TMPDIR 后长时间停留，
// 让外层测试有机会给 runner 发取消信号。
// 只由 scripts/run-tests.test.mjs 通过 `node --test <本文件>` 显式运行。
test('stays alive while the runner is signalled', async () => {
  await new Promise((resolve) => setTimeout(resolve, 120_000));
});

console.log(`RUNNER_TMPDIR=${JSON.stringify(process.env.TMPDIR ?? '')}`);
console.log(`WORKER_PID=${process.pid}`);
