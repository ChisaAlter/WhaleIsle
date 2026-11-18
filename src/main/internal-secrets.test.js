'use strict';

// 议题 #427 验收：真实进程链。桌面侧 spawn 真实的 dsh-cli-runner.mjs，经
// stdin 控制通道下发三枚内部令牌；runner 在 import CLI（即加载插件）前
// 收齐进进程内存储。桩 CLI 在 runner 进程内核对令牌、枚举 process.env、
// 并再 spawn 一个后代跑 env —— 断言令牌名字与值不出现在任何环境面；
// Linux 上再断言 runner 的 /proc/<pid>/environ 不含令牌值。

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  passSecretToChild,
  INTERNAL_SECRETS_END,
  INTERNAL_SECRETS_ENV,
} = require('../shared/secret');

const RUNNER = path.join(__dirname, 'dsh-cli-runner.mjs');
const SHARED_SECRET = path.join(__dirname, '..', 'shared', 'secret.js');
const TOKENS = {
  DSH_DESKTOP_INSTALL_TOKEN: 'install-token-4a51',
  DSHD_TASK_CONTROL_TOKEN: 'task-control-token-9b22',
  DSHD_PLATFORM_TOKEN: 'platform-token-77cc',
};

// 桩 CLI 在 runner 同进程执行：核对进程内存储、枚举自身环境、再派生一个
// 子进程读取其完整环境（证明后代默认继承不到令牌），把结果 JSON 落盘。
const STUB_CLI = `import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(process.env.STUB_BASE);
const { internalSecret } = require(process.env.SHARED_SECRET);

export async function runCli() {
  const names = ${JSON.stringify(Object.keys(TOKENS))};
  const secrets = Object.fromEntries(names.map((name) => [name, internalSecret(name)]));
  const ownEnv = names.filter((name) => name in process.env);
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { encoding: 'utf8' });
  const childEnv = JSON.parse(child.stdout || '{}');
  const childLeak = names.filter((name) => name in childEnv);
  const values = Object.values(${JSON.stringify(TOKENS)});
  const childValueLeak = Object.values(childEnv).filter((value) => values.includes(String(value)));
  writeFileSync(process.env.RESULT_PATH, JSON.stringify({ secrets, ownEnv, childLeak, childValueLeak }));
  process.exit(0);
}
`;

function makeStubDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-internal-secrets-'));
  const cli = path.join(dir, 'stub-cli.mjs');
  const pnpm = path.join(dir, 'stub-pnpm.mjs');
  const result = path.join(dir, 'result.json');
  fs.writeFileSync(cli, STUB_CLI, 'utf8');
  fs.writeFileSync(pnpm, 'export {}\n', 'utf8');
  return { dir, cli, pnpm, result };
}

function runRunner({ cli, pnpm, result, secrets, declareChannel }) {
  const env = {
    PATH: process.env.PATH,
    STUB_BASE: `file://${cli}`,
    SHARED_SECRET,
    RESULT_PATH: result,
  };
  // 继承被门禁隔离的临时目录变量，runner 进程不得在系统 tmp 下留痕（#478）。
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (declareChannel) env[INTERNAL_SECRETS_ENV] = '1';
  const child = spawn(process.execPath, [RUNNER, cli, pnpm, 'web', '--port', '0'], {
    stdio: ['pipe', 'ignore', 'pipe'],
    env,
  });
  child.stdin.on('error', () => {});
  // 初始环境在 exec 时已固定：spawn 后即可读，与 runner 后续读写无竞态。
  const procEnviron = process.platform === 'linux'
    ? fs.readFileSync(`/proc/${child.pid}/environ`, 'utf8')
    : null;
  if (secrets) {
    for (const [name, value] of Object.entries(secrets)) {
      passSecretToChild(child, name, value);
    }
    child.stdin.write(`${INTERNAL_SECRETS_END}\n`);
  }
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr, procEnviron }));
  });
}

describe('internal secrets channel', { concurrency: false }, () => {
  test('web host receives tokens over stdin; env and descendants stay clean', async () => {
    const { dir, cli, pnpm, result } = makeStubDir();
    try {
      const { code, stderr, procEnviron } = await runRunner({
        cli, pnpm, result, secrets: TOKENS, declareChannel: true,
      });
      assert.equal(code, 0, stderr);
      const report = JSON.parse(fs.readFileSync(result, 'utf8'));
      assert.deepEqual(report.secrets, TOKENS);
      assert.deepEqual(report.ownEnv, []);
      assert.deepEqual(report.childLeak, []);
      assert.deepEqual(report.childValueLeak, []);
      if (procEnviron !== null) {
        for (const value of Object.values(TOKENS)) {
          assert.ok(!procEnviron.includes(value), `/proc environ leaked ${value}`);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('web host without the declaration flag never reads stdin secrets', async () => {
    const { dir, cli, pnpm, result } = makeStubDir();
    try {
      const { code, stderr } = await runRunner({ cli, pnpm, result, secrets: null, declareChannel: false });
      assert.equal(code, 0, stderr);
      const report = JSON.parse(fs.readFileSync(result, 'utf8'));
      assert.deepEqual(report.secrets, { DSH_DESKTOP_INSTALL_TOKEN: '', DSHD_TASK_CONTROL_TOKEN: '', DSHD_PLATFORM_TOKEN: '' });
      assert.deepEqual(report.childLeak, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
