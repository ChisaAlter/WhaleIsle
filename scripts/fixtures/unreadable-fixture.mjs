import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

// run-tests.mjs 的残留扫描夹具（#478）：先写一项内容再把 runner 的专属
// 目录改成不可读（仅 POSIX 非 root 有效），listResidue 必须把读不到的
// 路径列为残留而不是当成空目录放行。
// 只由 scripts/run-tests.test.mjs 通过 `node --test <本文件>` 显式运行。
test('leaves the runner tmp dir unreadable', () => {
  const owned = process.env.TMPDIR;
  if (!owned) throw new Error('TMPDIR missing');
  fs.writeFileSync(path.join(owned, 'unreadable-marker.txt'), 'x');
  fs.chmodSync(owned, 0o000);
});

console.log(`RUNNER_TMPDIR=${JSON.stringify(process.env.TMPDIR ?? '')}`);
