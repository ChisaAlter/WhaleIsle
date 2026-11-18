import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// run-tests.mjs 的门禁夹具：这个文件只由 scripts/run-tests.test.mjs 通过
// `node --test <本文件>` 显式运行，故意在 tmp 里留下一个目录。
test('leaves a temporary directory behind', () => {
  // eslint-disable-next-line no-restricted-syntax -- 夹具的职责就是泄漏，检测器必须抓到它。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-fixture-'));
  fs.writeFileSync(path.join(dir, 'marker.txt'), 'leak');
});

console.log(`RUNNER_TMPDIR=${JSON.stringify(process.env.TMPDIR ?? '')}`);
