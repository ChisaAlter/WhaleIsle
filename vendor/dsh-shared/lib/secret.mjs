// ESM 门面：vendor 与 dsh-acp 的 ESM 插件不能 import asar 内的 CJS 模块，
// 统一经这里把 src/shared/secret.js 的基础件 re-export 出去。
// 只有两种布局，不再探测第三个候选（Harness 插件跑在纯 Node 里，读不了
// app.asar）：
//   开发仓库 vendor/dsh-shared/lib      -> <repo>/src/shared/secret.js
//   打包产物 resources/vendor/dsh-shared/lib
//            -> resources/app.asar.unpacked/src/shared/secret.js
//   （src/shared/secret.js 在 asarUnpack 里，纯 node 子进程也可读）
// 用 existsSync 选路径而不是 try/catch require：require 抛出的真实错误
// （语法错误、内部依赖失败）必须原样爆出，不能当成"下一个布局"吞掉。
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.join(here, '..', '..', '..', 'src', 'shared', 'secret.js'),
  path.join(here, '..', '..', '..', 'app.asar.unpacked', 'src', 'shared', 'secret.js'),
];

const target = candidates.find((candidate) => existsSync(candidate));
if (!target) {
  throw new Error(
    `dsh-shared: 无法定位 src/shared/secret.js，已检查：\n  ${candidates.join('\n  ')}`,
  );
}
const secret = createRequire(import.meta.url)(target);

export const { constantTimeEqual, readBodyLimited, passSecretToChild } = secret;
