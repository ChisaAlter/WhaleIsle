import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #478：证明 run-tests.mjs 的门禁确实生效——泄漏夹具触发非零退出并列出
// 残留项，干净夹具正常通过；能回收时 runner 的专属目录都会被回收，
// 回收失败则报告路径并让运行失败。
const RUNNER = fileURLToPath(new URL('./run-tests.mjs', import.meta.url));
const LEAK_FIXTURE = fileURLToPath(new URL('./fixtures/leak-fixture.mjs', import.meta.url));
const CLEAN_FIXTURE = fileURLToPath(new URL('./fixtures/clean-fixture.mjs', import.meta.url));
const UNREADABLE_FIXTURE = fileURLToPath(new URL('./fixtures/unreadable-fixture.mjs', import.meta.url));
const SLEEP_FIXTURE = fileURLToPath(new URL('./fixtures/sleep-fixture.mjs', import.meta.url));

// runner 的专属目录前缀（withOwnedTempDir('wt-', ...)）。
const OWNED_PREFIX = 'wt-';

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function runRunner(args, env = process.env) {
  return spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', timeout: 120_000, env });
}

/**
 * @param {string} output
 * @returns {string} 夹具打印的 runner 专属目录（RUNNER_TMPDIR=JSON 行，
 *   JSON 编码让带空格/换行的路径也能完整取回）
 */
function ownedDirFrom(output) {
  const match = /^RUNNER_TMPDIR=([^\r\n]+)/m.exec(output);
  assert.ok(match?.[1], '夹具必须打印注入的 TMPDIR：\n' + output.slice(-800));
  return JSON.parse(match[1]);
}

/**
 * @param {string} output
 * @returns {string | null} 夹具打印的 NARB_NATIVE_CACHE_DIR（JSON 编码）
 */
function narbCacheDirFrom(output) {
  const match = /^NARB_NATIVE_CACHE_DIR=([^\r\n]+)/m.exec(output);
  assert.ok(match?.[1], '夹具必须打印 NARB_NATIVE_CACHE_DIR：\n' + output.slice(-800));
  return JSON.parse(match[1]);
}

/**
 * @param {string} output
 * @returns {string | null} 从累积输出里取 RUNNER_TMPDIR，还没打印则 null
 */
function ownedDirFromPartial(output) {
  const found = /^RUNNER_TMPDIR=([^\r\n]+)/m.exec(output)?.[1];
  if (!found) return null;
  try {
    return JSON.parse(found);
  } catch {
    // 输出按块到达，可能只收到半行 JSON；下一轮轮询再取完整行。
    return null;
  }
}

const TMP_ROOT = fs.realpathSync(os.tmpdir());

/**
 * 本测试的兜底清理只准动 runner 的专属目录：realpath 必须落在系统
 * os.tmpdir() 之内且目录名以 wt- 开头，否则视为不属于本测试、返回 null
 * 让调用方不要删（#478）。
 * @param {string} dir
 * @returns {string | null} 可安全删除的 realpath，或 null
 */
function reclaimableOwnedDir(dir) {
  let real = '';
  try {
    real = fs.realpathSync(dir);
  } catch {
    return null;
  }
  const relative = path.relative(TMP_ROOT, real);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!path.basename(real).startsWith(OWNED_PREFIX)) return null;
  return real;
}

/**
 * @param {() => boolean} check
 * @param {number} timeoutMs
 * @param {string} message
 */
async function pollUntil(check, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('runner fails and lists residue when a test leaks a temp dir', () => {
  const result = runRunner([LEAK_FIXTURE]);
  assert.equal(result.status, 1, '泄漏夹具必须让 runner 以确定的非零码退出');
  assert.equal(result.signal, null);
  const output = result.stderr + result.stdout;
  assert.match(output, /leak-fixture-/);
  assert.match(output, /残留/);
  assert.equal(fs.existsSync(ownedDirFrom(output)), false, '判定残留后专属目录仍须回收');
});

test('runner exits zero when the suite leaves nothing behind', () => {
  const result = runRunner([CLEAN_FIXTURE]);
  assert.equal(result.status, 0, (result.stderr + result.stdout).slice(-800));
  assert.equal(fs.existsSync(ownedDirFrom(result.stdout)), false, '干净套件同样回收专属目录');
});

test(
  'runner sets NARB_NATIVE_CACHE_DIR under original os.tmpdir() when unset and preserves parent value when set',
  { skip: (process.platform === 'win32' || typeof process.getuid !== 'function') && '仅 POSIX 有 uid 且不使用 LOCALAPPDATA' },
  () => {
    const uid = process.getuid?.();
    assert.equal(typeof uid, 'number');
    const baseEnv = { ...process.env };
    delete baseEnv.NARB_NATIVE_CACHE_DIR;
    const defaultResult = runRunner([CLEAN_FIXTURE], baseEnv);
    assert.equal(defaultResult.status, 0, (defaultResult.stderr + defaultResult.stdout).slice(-800));
    const expectedDefault = path.join(
      os.tmpdir(),
      `node-addon-native-custom-loader-${uid}`,
      'native-cache',
    );
    assert.equal(narbCacheDirFrom(defaultResult.stdout), expectedDefault);
    assert.equal(fs.existsSync(ownedDirFrom(defaultResult.stdout)), false, '专属目录仍须回收');

    const customDir = path.join(os.tmpdir(), 'custom-narb-cache-for-test');
    const presetResult = runRunner([CLEAN_FIXTURE], { ...baseEnv, NARB_NATIVE_CACHE_DIR: customDir });
    assert.equal(presetResult.status, 0, (presetResult.stderr + presetResult.stdout).slice(-800));
    assert.equal(narbCacheDirFrom(presetResult.stdout), customDir);
    assert.equal(fs.existsSync(ownedDirFrom(presetResult.stdout)), false, '专属目录仍须回收');
  },
);

const CHMOD_RESPECTED = process.platform !== 'win32'
  && (typeof process.getuid !== 'function' || process.getuid() !== 0);

test(
  'runner reports unreadable residue and an unreclaimed dir instead of force-deleting',
  { skip: !CHMOD_RESPECTED && 'chmod 000 只对 POSIX 非 root 生效' },
  () => {
    const result = runRunner([UNREADABLE_FIXTURE]);
    const output = result.stderr + result.stdout;
    const ownedDir = ownedDirFrom(output);
    try {
      assert.equal(result.status, 1, '读不到的残留路径必须让运行失败');
      assert.equal(result.signal, null);
      assert.match(output, /unreadable: EACCES/);
      assert.match(output, /残留/);
      // 回收只靠 withOwnedTempDir：删不掉时报告路径并失败，不改权限不强删。
      assert.match(output, /未能回收/);
      assert.equal(fs.existsSync(ownedDir), true, '回收失败时专属目录应仍在原处');
    } finally {
      // runner 明确不再代为回收，这里按守卫路径收尾，避免本测试自身泄漏。
      const safe = reclaimableOwnedDir(ownedDir);
      if (safe) {
        try {
          fs.chmodSync(safe, 0o700);
        } catch { /* 目录可能已恢复权限或权限修复失败。 */ }
        fs.rmSync(safe, { recursive: true, force: true });
      }
    }
  },
);

/**
 * @param {string} output
 * @returns {number | null} 从累积输出里取 WORKER_PID，还没打印则 null
 */
function workerPidFromPartial(output) {
  const found = /^WORKER_PID=(\d+)/m.exec(output)?.[1];
  return found ? Number(found) : null;
}

/**
 * @param {NodeJS.Signals} signal
 */
async function assertSignalStopsWorkerAndReclaimsDir(signal) {
  const child = spawn(process.execPath, [RUNNER, SLEEP_FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  let ownedDir = '';
  let workerPid = 0;
  try {
    // 等夹具打印 TMPDIR 与 WORKER_PID 再发信号，保证工作进程已进入运行期。
    await pollUntil(
      () => {
        ownedDir = ownedDirFromPartial(output) ?? ownedDir;
        workerPid = workerPidFromPartial(output) ?? workerPid;
        return ownedDir !== '' && workerPid > 0;
      },
      30_000,
      'fixture did not print TMPDIR and WORKER_PID\n' + output,
    );
    child.kill(signal);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let exitTimer;
    const exited = await Promise.race([
      new Promise((resolve) => child.once('exit', (code, sig) => resolve({ code, signal: sig }))),
      new Promise((_, reject) => {
        exitTimer = setTimeout(() => reject(new Error(`runner did not exit after ${signal}\n` + output)), 20_000);
      }),
    ]).finally(() => clearTimeout(exitTimer));
    assert.equal(exited.code, null);
    assert.equal(exited.signal, signal);
    assert.equal(fs.existsSync(ownedDir), false, '信号终止后专属目录仍须回收');
    assert.throws(() => process.kill(workerPid, 0), { code: 'ESRCH' }, '信号终止后测试工作进程不能残留');
  } finally {
    try {
      child.kill('SIGKILL');
    } catch { /* 已退出属正常竞态。 */ }
    if (workerPid > 0) {
      try {
        process.kill(workerPid, 'SIGKILL');
      } catch { /* 已退出属正常竞态。 */ }
    }
    // 断言失败时 runner 的专属目录可能仍在，按守卫路径代为回收。
    const safe = ownedDir ? reclaimableOwnedDir(ownedDir) : null;
    if (safe) fs.rmSync(safe, { recursive: true, force: true });
  }
}

test(
  'runner forwards SIGTERM, exits by the same signal and still reclaims its dir',
  { skip: process.platform === 'win32' && 'Windows 无法捕获外部 SIGTERM' },
  () => assertSignalStopsWorkerAndReclaimsDir('SIGTERM'),
);

test(
  'runner terminates test workers on SIGHUP, exits by SIGHUP and reclaims its dir',
  { skip: process.platform === 'win32' && 'Windows 无法捕获外部 SIGHUP' },
  () => assertSignalStopsWorkerAndReclaimsDir('SIGHUP'),
);
