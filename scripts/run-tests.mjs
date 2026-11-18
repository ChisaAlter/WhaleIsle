#!/usr/bin/env node
// `npm test` 的入口（议题 #478）：在本机原 os.tmpdir() 下为本次运行建一个
// 专属 tmp 目录，只把它通过 TMPDIR/TEMP/TMP 注入 `node --test` 子进程；
// 套件结束后目录必须为空——任何测试泄漏的 tmp 文件都会让这次运行失败
// 并逐项列出。回收只靠 withOwnedTempDir：它删不掉（或因归属校验保留）
// 时报告该路径并让运行失败，不再改权限、不再强删。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import fsSafe from '../src/shared/fs-safe.js';

const { withOwnedTempDir } = fsSafe;

// 子进程环境里要覆盖的 tmp 变量；Windows 上大小写变体（Tmp/temp）并存，
// 按大写名先全部剔除再写规范的三个键。
const TMP_ENV_NAMES = new Set(['TMPDIR', 'TEMP', 'TMP']);
const SETTLE_POLL_MS = 100;
const SETTLE_TIMEOUT_MS = 2_000;
const MAX_RESIDUE_REPORT = 50;
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Node 24 的 `node --test` 只对 SIGINT/SIGTERM 取消并等待工作进程，
 * 收到 SIGHUP 会直接退出而留下仍在运行的工作进程；转发时把 SIGHUP
 * 映射为 SIGTERM，runner 最终仍以原信号 SIGHUP 退出（#478）。
 * @param {NodeJS.Signals} signal
 * @returns {NodeJS.Signals}
 */
function forwardedChildSignal(signal) {
  return signal === 'SIGHUP' ? 'SIGTERM' : signal;
}

/**
 * @param {string} dir 已规范化的专属 tmp 目录
 * @returns {NodeJS.ProcessEnv} 只属于子进程的环境；runner 自身 process.env 不被修改
 */
function childTempEnv(dir) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    // NODE_TEST_CONTEXT 是 --test 进程内标记：runner 被另一个测试进程调用时
    // 不能让子进程以为自己还是测试子进程，否则 --test 不会真正跑套件。
    if (!TMP_ENV_NAMES.has(key.toUpperCase()) && key !== 'NODE_TEST_CONTEXT') env[key] = value;
  }
  env.TMPDIR = dir;
  env.TEMP = dir;
  env.TMP = dir;
  // Node 22+ 默认把 node-compile-cache 写进 TMPDIR，那不是测试泄漏而是
  // 运行时产物；关掉避免它被门禁误报（#478）。
  env.NODE_DISABLE_COMPILE_CACHE = '1';
  // node-addon-native-custom-loader 在 POSIX 上默认把原生模块缓存放在
  // os.tmpdir()/node-addon-native-custom-loader-<uid>/native-cache；若不固定，
  // 它会落进隔离 TMPDIR 被门禁误报。父进程未设时显式指向 runner 原始
  // os.tmpdir() 下的同路径（保持缓存开启且路径与不隔离时一致）。
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && !env.NARB_NATIVE_CACHE_DIR) {
    env.NARB_NATIVE_CACHE_DIR = path.join(
      os.tmpdir(),
      `node-addon-native-custom-loader-${process.getuid()}`,
      'native-cache',
    );
  }
  return env;
}

/**
 * 递归列出 root 下的残留项（相对路径），达到上限即停。
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function listResidue(root) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} rel */
  async function walk(rel) {
    if (found.length >= MAX_RESIDUE_REPORT) return;
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true });
    } catch (error) {
      // ENOENT：条目刚好被迟退出的孙进程删掉，按收敛处理；其余读失败
      // （EACCES 等）把该路径本身列为残留，防止门禁把它当成空目录放行。
      const code = /** @type {{ code?: unknown } | null | undefined} */ (error)?.code;
      if (code !== 'ENOENT') {
        found.push(`${rel || '.'} (unreadable: ${typeof code === 'string' ? code : String(error)})`);
      }
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= MAX_RESIDUE_REPORT) return;
      const child = rel ? path.join(rel, entry.name) : entry.name;
      found.push(child);
      if (entry.isDirectory()) await walk(child);
    }
  }
  await walk('');
  return found;
}

/**
 * 判断路径是否仍然存在；lstat 读不到且原因不是 ENOENT 时按"仍存在"
 * 处理——无法确认已回收的情况不能让门禁放行。
 * @param {string} target
 * @returns {boolean}
 */
function stillExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    const code = /** @type {{ code?: unknown } | null | undefined} */ (error)?.code;
    return code !== 'ENOENT';
  }
}

/**
 * @param {string[]} globs 传给 `node --test` 的位置参数（glob / 文件路径）
 * @returns {Promise<{code: number | null, signal: NodeJS.Signals | null, residue: string[], interrupted: NodeJS.Signals | null, leftover: boolean, ownedPath: string | null}>}
 */
async function runSuite(globs) {
  // 取消信号的转发处理器覆盖整个运行期——包括子进程退出后的收敛轮询和
  // 专属目录回收。期间收到信号只记录并转发（有监听就不会触发默认终止），
  // 等 withOwnedTempDir 完成回收后由调用方按原信号结束进程（#478）。
  /** @type {NodeJS.Signals | null} */
  let interrupted = null;
  /** @type {import('node:child_process').ChildProcess | null} */
  let running = null;
  const forward = (/** @type {NodeJS.Signals} */ signal) => {
    interrupted ??= signal;
    if (running) {
      try {
        running.kill(forwardedChildSignal(signal));
      } catch { /* 子进程已退出时 kill 抛错属正常竞态。 */ }
    }
  };
  for (const signal of FORWARDED_SIGNALS) process.on(signal, forward);
  /** @type {string | null} */
  let ownedPath = null;
  /** @type {{ code: number | null, signal: NodeJS.Signals | null, residue: string[] } | null} */
  let suiteResult = null;
  try {
    suiteResult = await withOwnedTempDir('wt-', async (dir) => {
      ownedPath = dir;
      // mkdtemp 已落在 os.tmpdir() 下；规范化为真实路径（macOS /var → /private/var），
      // 保证子进程写入的路径与残留检查看的是同一棵目录。
      const owned = fs.realpathSync.native(dir);
      const child = spawn(process.execPath, ['--test', ...globs], {
        env: childTempEnv(owned),
        stdio: 'inherit',
        shell: false,
      });
      running = child;
      // 信号若落在注册处理器与 spawn 完成之间，子进程也要立刻收到。
      if (interrupted) {
        try {
          child.kill(forwardedChildSignal(interrupted));
        } catch { /* 竞态可忽略，exit/error 事件会结束等待。 */ }
      }
      /** @type {{code: number | null, signal: NodeJS.Signals | null}} */
      const outcome = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      running = null;
      // 套件刚退出时孙进程（Electron/守护子进程）可能还在做收尾删除，
      // 短暂轮询收敛后再判定残留。
      let residue = await listResidue(owned);
      const deadline = Date.now() + SETTLE_TIMEOUT_MS;
      while (residue.length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
        residue = await listResidue(owned);
      }
      if (residue.length > 0) {
        const suffix = residue.length >= MAX_RESIDUE_REPORT ? '+' : '';
        console.error(`\n测试在临时目录留下 ${residue.length}${suffix} 项残留（相对 ${owned}）：`);
        for (const item of residue) console.error(`  ${item}`);
      }
      return { ...outcome, residue };
    }, { rmOptions: { maxRetries: 5, retryDelay: 100 } });
  } finally {
    for (const signal of FORWARDED_SIGNALS) process.off(signal, forward);
  }
  // 走到这里说明 withOwnedTempDir 已完全返回（含回收）且信号处理器已
  // 撤除：此刻才读 interrupted，回收期间收到的信号同样计入；抛错路径
  // 不会到达此处，suiteResult 一定有值。
  const result = /** @type {{ code: number | null, signal: NodeJS.Signals | null, residue: string[] }} */ (suiteResult);
  // 专属目录仍存在 = withOwnedTempDir 删不掉或被归属校验保留，交给调用
  // 方报告路径并按失败处理；这里不再改权限、不再强删（#478）。
  const leftover = ownedPath !== null && stillExists(ownedPath);
  return { ...result, interrupted, leftover, ownedPath };
}

async function main() {
  const globs = process.argv.slice(2);
  if (globs.length === 0) {
    console.error('用法：node scripts/run-tests.mjs <测试 glob> [...]');
    process.exitCode = 2;
    return;
  }
  const { code, signal, residue, interrupted, leftover, ownedPath } = await runSuite(globs);
  if (leftover) {
    console.error(`\n测试运行的专属临时目录未能回收：${ownedPath}`);
  }
  const exitSignal = interrupted ?? signal;
  if (exitSignal) {
    // 以同样的信号结束自身，外层（CI/外壳）看到与子进程一致的终止方式；
    // 此时专属目录的回收已经收尾（删不掉的也已按 leftover 报告）。
    try {
      process.kill(process.pid, exitSignal);
      return;
    } catch { /* 落到退出码分支 */ }
  }
  process.exitCode = code ?? 1;
  if (process.exitCode === 0 && (residue.length > 0 || leftover)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
