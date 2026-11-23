'use strict';

const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { atomicWriteFileSync, safeRemoveSync } = require('../../shared/fs-safe');
const { spawnTreeOptions } = require('../../shared/process-tree');
const {
  DEFAULT_WEB_PORT,
  MAX_BINARY_BYTES,
  assertNoPortableMarkers,
  setBinaryReadOnly,
  setDirWritable,
} = require('./platform');
const { probeGateway, resolveGatewayCandidate } = require('./detect');
const { ensureDshWebProfileExists } = require('./dsh-sync');

const LOG_MAX_BYTES = 1024 * 1024;
const delay = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} file */
function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}

/** @param {string} file @param {any} value */
function writeJsonSafe(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/** @param {number} port */
function isLoopbackPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function pickWebPort(preferred = DEFAULT_WEB_PORT) {
  if (await isLoopbackPortFree(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const chosen = typeof addr === 'object' && addr ? addr.port : preferred + 1;
      srv.close(() => resolve(chosen));
    });
  });
}

/** @param {string} logFile @param {number} from */
function logTail(logFile, from) {
  try {
    const data = fs.readFileSync(logFile);
    const lines = data.subarray(Math.max(from, data.length - 4096)).toString('utf8')
      .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.slice(-3).join(' / ');
  } catch {
    return '';
  }
}

/**
 * @param {string} url
 * @param {(url: string, init?: RequestInit) => Promise<Response>} fetchImpl
 */
async function waitHttpReady(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(1500) });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

/** @param {string} file */
async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * @param {string} dshHome
 * @param {string} webKey
 * @returns {NodeJS.ProcessEnv}
 */
function buildMagpieSpawnEnv(dshHome, webKey) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, MAGPIE_WEB_KEY: webKey };
  if (dshHome) env.DSH_HOME = dshHome;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MAGPIE_ADDR;
  delete env.MAGPIE_WEB_RUNKEY;
  return /** @type {NodeJS.ProcessEnv} */ (env);
}

/**
 * Poll local Magpie Web + Gateway endpoints until both are ready or throw on exit/timeout.
 * @param {any} child
 * @param {any} ctx
 */
async function waitForMagpieReady(child, ctx) {
  const { configDir, version, expectGateway, deps, managedStateFile, companionStateFile, logFile, logStart, webPort, webKey, webUrl } = ctx;
  const deadline = Date.now() + (deps.readyTimeoutMs || 30_000);
  const bootUrl = `http://127.0.0.1:${webPort}/boot.js`;
  const fetchImpl = deps.fetchImpl || fetch;
  let failure = /** @type {Error | null} */ (null);
  child.once('error', (/** @type {Error} */ error) => { failure = error; });
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (child.exitCode !== null) {
      const tail = logTail(logFile, logStart);
      throw new Error(`Magpie 启动退出（${child.exitCode}）${tail ? `：${tail}` : ''}`);
    }
    if (await waitHttpReady(bootUrl, fetchImpl)) {
      if (!expectGateway) {
        const record = { pid: child.pid, version, webPort, webKey, webUrl };
        writeJsonSafe(companionStateFile, record);
        return record;
      }
      const candidate = resolveGatewayCandidate(configDir).addr;
      const gw = await probeGateway(candidate, { fetchJson: deps.fetchJson, fetchImpl: deps.fetchImpl });
      if (gw) {
        const record = { pid: child.pid, version, webPort, webKey, webUrl, gatewayAddr: gw.addr };
        writeJsonSafe(managedStateFile, record);
        return record;
      }
    }
    await delay(100);
  }
  const tail = logTail(logFile, logStart);
  throw new Error(`Magpie 启动超时${tail ? `：${tail}` : ''}`);
}

/**
 * Spawn official `magpie web --addr 127.0.0.1:<port> --no-open`.
 * Note: deliberately omits `--gateway` so upstream Web UI keeps its Agents tab active,
 * and never creates `.portable`/`data/` markers inside `versionDir`.
 * @param {any} ctx
 * @returns {Promise<{ pid: number | undefined, version: string, webPort: number, webKey: string, webUrl: string, gatewayAddr?: string }>}
 */
async function spawnMagpieWeb(ctx) {
  const { root, dshHome, assetName, platform, version, expectGateway, progress, alive, kill, run, emit, logFile } = ctx;
  const versionDir = path.join(root, 'versions', version);
  const bin = path.join(versionDir, assetName);
  assertNoPortableMarkers(versionDir);
  if (!fs.existsSync(bin)) throw new Error(`Magpie 程序不存在（${version}），请重新安装`);
  ensureDshWebProfileExists(dshHome);

  const webPort = await ctx.selectPort(DEFAULT_WEB_PORT);
  const webKey = randomBytes(16).toString('hex');
  const webUrl = `http://127.0.0.1:${webPort}/?k=${webKey}`;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  let size = 0;
  try { size = fs.statSync(logFile).size; } catch { /* first log */ }
  const logStart = size > LOG_MAX_BYTES ? 0 : size;
  const logFd = fs.openSync(logFile, size > LOG_MAX_BYTES ? 'w' : 'a');

  emit(progress, 'spawn', 75);
  let child;
  try {
    child = run(bin, ['web', '--addr', `127.0.0.1:${webPort}`, '--no-open'], {
      cwd: root,
      env: buildMagpieSpawnEnv(dshHome, webKey),
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      ...(expectGateway ? { detached: true } : {}),
      ...spawnTreeOptions(platform),
    });
  } finally {
    fs.closeSync(logFd);
  }
  if (expectGateway) child.unref?.();

  try {
    return await waitForMagpieReady(child, { ...ctx, logStart, webPort, webKey, webUrl });
  } catch (error) {
    if (child.pid && alive(child.pid)) kill(child.pid, { force: true });
    throw error;
  }
}

/**
 * Gracefully ask the Magpie web host to quit via `/api/window/quit?now=1` before
 * escalating to `killTree`.
 * @param {any} stateRecord
 * @param {string} stateFilePath
 * @param {{ fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>, alive: (pid: number) => boolean, killTree: (pid: number, opts?: any) => Promise<boolean>, exitTimeoutMs?: number }} ctx
 */
async function quitWebProcess(stateRecord, stateFilePath, ctx) {
  if (!stateRecord?.pid || !ctx.alive(stateRecord.pid)) {
    safeRemoveSync(stateFilePath);
    return;
  }
  const doFetch = ctx.fetchImpl || fetch;
  if (stateRecord.webPort && stateRecord.webKey) {
    try {
      await doFetch(`http://127.0.0.1:${stateRecord.webPort}/api/window/quit?now=1`, {
        method: 'POST',
        headers: { Cookie: `magpie_web_${stateRecord.webPort}=${stateRecord.webKey}` },
        signal: AbortSignal.timeout(2500),
      });
    } catch {
      // Fallback to process termination below if HTTP quit did not answer.
    }
  }
  const deadline = Date.now() + (ctx.exitTimeoutMs ?? 5000);
  while (ctx.alive(stateRecord.pid) && Date.now() < deadline) {
    await delay(100);
  }
  if (ctx.alive(stateRecord.pid)) {
    await ctx.killTree(stateRecord.pid, { graceMs: 1500 });
  }
  safeRemoveSync(stateFilePath);
}

/**
 * Clear read-only attributes and remove a managed directory with Windows handle retries.
 * @param {string} target
 */
function removeDirWithRetry(target) {
  if (!fs.existsSync(target)) return;
  setDirWritable(target);
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
}

/**
 * Download and verify a Magpie binary into `versions/<version>`.
 * @param {{
 *   root: string,
 *   release: any,
 *   platform: NodeJS.Platform,
 *   progress?: Function,
 *   emit: (fn: Function | undefined, phase: string, percent: number, message?: string) => void,
 *   downloadFile?: (url: string, dest: string, onProgress?: (p: any) => void) => Promise<void>,
 * }} ctx
 */
async function stageMagpieBinary(ctx) {
  const { root, release: rel, platform, progress, emit, downloadFile } = ctx;
  const targetDir = path.join(root, 'versions', rel.version);
  const stagingDir = path.join(root, 'versions', `.staging-${process.pid}`);
  removeDirWithRetry(stagingDir);
  fs.mkdirSync(stagingDir, { recursive: true });
  const stagedBin = path.join(stagingDir, rel.asset);
  try {
    emit(progress, 'download', 10);
    if (rel.localDir) {
      fs.copyFileSync(path.join(rel.localDir, rel.asset), stagedBin);
    } else {
      const download = downloadFile || ((/** @type {string} */ u, /** @type {string} */ d, /** @type {any} */ cb) => require('../../main/update').downloadFile(u, d, cb));
      await download(rel.url, stagedBin, (/** @type {any} */ p) => emit(progress, 'download', Math.round((p?.percent || 0) * 0.55)));
    }
    emit(progress, 'verify', 60);
    const stat = fs.statSync(stagedBin);
    if (stat.size <= 0 || stat.size > MAX_BINARY_BYTES) {
      throw new Error(`Magpie 文件大小异常：${stat.size}`);
    }
    if (await sha256File(stagedBin) !== rel.sha256) {
      throw new Error('Magpie 文件 SHA256 校验失败');
    }
    if (platform !== 'win32') fs.chmodSync(stagedBin, 0o755);
    writeJsonSafe(path.join(stagingDir, 'manifest.json'), rel);
    setBinaryReadOnly(stagingDir, stagedBin, platform);
    removeDirWithRetry(targetDir);
    fs.renameSync(stagingDir, targetDir);
    return rel.version;
  } finally {
    try {
      removeDirWithRetry(stagingDir);
    } catch {
      // Staging cleanup is best-effort if the original error already occurred.
    }
  }
}

/** @param {string} root @param {string[]} keep */
function pruneVersions(root, keep) {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, 'versions'));
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.') || keep.includes(name)) continue;
    try {
      removeDirWithRetry(path.join(root, 'versions', name));
    } catch {
      // Old unreferenced version dirs are retried on the next update or uninstall.
    }
  }
}

module.exports = {
  readJsonSafe,
  writeJsonSafe,
  pickWebPort,
  removeDirWithRetry,
  spawnMagpieWeb,
  quitWebProcess,
  stageMagpieBinary,
  pruneVersions,
};
