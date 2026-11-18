'use strict';

/**
 * Shared sandbox decision for tests that launch a real Electron binary.
 *
 * Chromium's Linux sandbox needs the SUID-root `chrome-sandbox` helper next to
 * the Electron executable. Unpacked dev trees often ship it without the setuid
 * bit (and unprivileged user namespaces may be unavailable), so tests disable
 * the sandbox through the supported `ELECTRON_DISABLE_SANDBOX=1` knob. Product
 * launch paths never go through this helper.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} electronBinary - absolute path of the Electron executable
 * @param {(file: string) => fs.Stats} [statSync] - injected for tests
 * @returns {boolean} true when the SUID helper can actually sandbox Chromium
 */
function chromeSandboxUsable(electronBinary, { statSync = fs.statSync } = {}) {
  const helper = path.join(path.dirname(electronBinary), 'chrome-sandbox');
  let stat;
  try {
    stat = statSync(helper);
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
  // Root-owned plus setuid plus rwxr-xr-x, the mode Chromium checks for.
  return stat.uid === 0 && (stat.mode & 0o4755) === 0o4755;
}

/**
 * @param {string} electronBinary - absolute path of the Electron executable
 * @param {object} [deps] - injected for tests
 * @param {string} [deps.platform]
 * @param {() => number} [deps.getuid]
 * @param {(file: string) => fs.Stats} [deps.statSync]
 * @returns {boolean} true when the test child must run with the sandbox off
 */
function shouldDisableElectronSandbox(electronBinary, {
  platform = process.platform,
  getuid = typeof process.getuid === 'function' ? () => process.getuid() : undefined,
  statSync = fs.statSync,
} = {}) {
  if (platform !== 'linux') return false;
  // Chromium refuses the sandbox when the test itself runs as root.
  if (getuid && getuid() === 0) return true;
  return !chromeSandboxUsable(electronBinary, { statSync });
}

/**
 * @param {string} electronBinary - absolute path of the Electron executable
 * @param {NodeJS.ProcessEnv} [baseEnv] - caller env, not mutated
 * @param {object} [deps] - forwarded to shouldDisableElectronSandbox
 * @returns {NodeJS.ProcessEnv} env with ELECTRON_DISABLE_SANDBOX when needed
 */
function electronTestEnv(electronBinary, baseEnv = process.env, deps) {
  const env = { ...baseEnv };
  if (shouldDisableElectronSandbox(electronBinary, deps)) {
    env.ELECTRON_DISABLE_SANDBOX = '1';
  }
  // Electron 内嵌的 Node 默认把 node-compile-cache 写进 TMPDIR，残留会触发
  // run-tests 的临时目录门禁；测试子进程不需要它（#478）。
  env.NODE_DISABLE_COMPILE_CACHE = '1';
  return env;
}

/**
 * 终止测试子进程并等它真正退出：SIGTERM 后最多等 waitMs，仍未退出就升级
 * SIGKILL 再最多等 killWaitMs。超时路径里调用方随后才 reject 并回收
 * 临时目录，保证渲染进程已释放 profile 文件（#478）。
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [waitMs]
 * @param {number} [killWaitMs]
 * @returns {Promise<boolean>} true 表示等来了 exit，false 表示两轮等待都耗尽
 */
function terminateChild(child, waitMs = 10_000, killWaitMs = 5_000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    /** @type {NodeJS.Timeout | undefined} */
    let killTimer;
    const giveUp = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 已退出的子进程 kill 抛错属正常竞态。 */ }
      killTimer = setTimeout(() => resolve(false), killWaitMs);
    }, waitMs);
    child.once('exit', () => {
      clearTimeout(giveUp);
      clearTimeout(killTimer);
      resolve(true);
    });
    try { child.kill(); } catch { /* 已退出的子进程 kill 抛错属正常竞态。 */ }
  });
}

module.exports = {
  chromeSandboxUsable,
  shouldDisableElectronSandbox,
  electronTestEnv,
  terminateChild,
};
