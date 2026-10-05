'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { harnessHasGhosttyAssets } = require('../shared/ghostty-assets');
const { materializeRuntimeLinksAsync, removeRuntimeLinksAsync } = require('../shared/runtime-links');
const { checkInstallSpace } = require('./install-space');
const { randomUUID } = require('node:crypto');
const { hashRuntimeArchive, readRuntimeArchiveIdentity } = require('../shared/harness-runtime-identity');

function looseHarnessRoot() {
  return path.join(process.resourcesPath, 'vendor', 'deepseek-harness');
}

function harnessArchivePath() {
  return path.join(process.resourcesPath, 'vendor', 'deepseek-harness.tar');
}

const fsp = fs.promises;

/** Suffix marker for a retired extract awaiting background deletion. */
const STALE_SUFFIX = '.stale-';
const EXTRACT_SUFFIX = '.extract-';
const activeStaging = new Set();
const extractions = new Map();

/** Background deletions still running; tests drain them via settleBackgroundWork. */
const backgroundWork = new Set();

function trackBackground(promise) {
  backgroundWork.add(promise);
  promise.finally(() => backgroundWork.delete(promise)).catch(() => {});
  return promise;
}

async function settleBackgroundWork() {
  while (backgroundWork.size) {
    await Promise.allSettled([...backgroundWork]);
  }
}

function extractedHarnessRoot() {
  return path.join(app.getPath('userData'), 'runtime', app.getVersion());
}

function staleExtractPath(dest) {
  return `${dest}${STALE_SUFFIX}${Date.now().toString(36)}-${process.pid}`;
}

/**
 * Retire a stale extract without stalling the Electron UI thread. `fs.rmSync`
 * on a ~57k-file runtime held the main thread 16–46 s on a warm NVMe box and
 * Windows flagged the window 未响应 (WER `AppHangTransient`). A rename is
 * O(1); the recursive delete then runs on the libuv threadpool while tar
 * extracts the fresh tree. If the rename is refused (a file still locked),
 * fall back to an awaited async rm — slower, but still off the UI thread.
 * @param {string} dest
 * @param {(line: string) => void} log
 * @returns {Promise<string|null>} retired path, or null when removed in place.
 */
async function retireStaleExtract(dest, log = () => {}) {
  const stale = staleExtractPath(dest);
  try {
    await fsp.rename(dest, stale);
  } catch {
    await fsp.rm(dest, { recursive: true, force: true });
    return null;
  }
  trackBackground(fsp.rm(stale, { recursive: true, force: true }).catch((error) => {
    log(`清理旧运行时失败（下次启动重试）：${error.message}`);
  }));
  return stale;
}

/**
 * Delete retired extracts a previous run did not finish removing (quit
 * mid-delete). Runs in the background; never blocks a start.
 * @param {string} runtimeRoot userData/runtime
 * @param {(line: string) => void} log
 * @returns {Promise<string[]>} retired paths that were scheduled for removal.
 */
async function sweepStaleExtracts(runtimeRoot, log = () => {}) {
  let entries = [];
  try {
    entries = await fsp.readdir(runtimeRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const stale = entries
    .filter((entry) => entry.isDirectory() && (entry.name.includes(STALE_SUFFIX) || entry.name.includes(EXTRACT_SUFFIX)))
    .map((entry) => path.join(runtimeRoot, entry.name))
    .filter((dir) => !activeStaging.has(dir));
  for (const dir of stale) {
    trackBackground(fsp.rm(dir, { recursive: true, force: true }).catch((error) => {
      log(`清理旧运行时残留失败：${error.message}`);
    }));
  }
  return stale;
}

/**
 * True when the tree can boot the CLI/web UI and serve Ghostty terminal assets.
 * @param {string} root
 * @returns {boolean}
 */
function hasBuiltHarness(root) {
  return fs.existsSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'))
    && fs.existsSync(path.join(root, 'apps', 'web', 'dist', 'index.html'))
    && harnessHasGhosttyAssets(root);
}

function packagedPinPath() {
  return path.join(process.resourcesPath, 'vendor', 'harness-upstream.json');
}

function readPackagedPin() {
  const file = packagedPinPath();
  if (!fs.existsSync(file)) {
    throw new Error('安装包缺少 vendor/harness-upstream.json');
  }
  const pin = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!pin || typeof pin.sha !== 'string' || !pin.sha || typeof pin.npm !== 'string' || !pin.npm) {
    throw new Error('安装包 harness-upstream.json 无效');
  }
  return pin;
}

function runtimeStampPath(dest) {
  return path.join(dest, '.dshd-runtime.json');
}

function readRuntimeStamp(dest) {
  const file = runtimeStampPath(dest);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeRuntimeStamp(dest, identity) {
  fs.writeFileSync(runtimeStampPath(dest), `${JSON.stringify(identity)}\n`);
}

function packagedRuntimeIdentity(pin, archiveBytes, archiveSha256) {
  return {
    sha: pin.sha,
    npm: pin.npm,
    archiveBytes,
    archiveSha256,
  };
}

async function readPackagedRuntimeIdentity(pin, archive, signal) {
  const archiveBytes = (await fsp.stat(archive)).size;
  const manifest = await readRuntimeArchiveIdentity(archive);
  if (manifest && manifest.archiveBytes !== archiveBytes) {
    throw new Error('运行时归档大小与摘要不一致，请重新下载安装包');
  }
  // Modern builds carry a tiny build-time digest. Legacy layouts stream the
  // archive; their old stamps lack the digest and refresh once before reuse.
  const archiveSha256 = manifest?.archiveSha256 ?? await hashRuntimeArchive(archive, { signal });
  return { identity: packagedRuntimeIdentity(pin, archiveBytes, archiveSha256), needsVerification: Boolean(manifest) };
}

/**
 * Same desktop version reuses userData/runtime/<version>. Overlay installs must
 * not keep a previous Harness tree just because bin.js and Ghostty exist.
 * @param {string} dest
 * @param {{ sha: string, npm: string, archiveBytes: number, archiveSha256: string }} identity
 * @returns {boolean}
 */
function canReuseExtractedHarness(dest, identity) {
  if (!identity || typeof identity.sha !== 'string' || typeof identity.npm !== 'string') {
    return false;
  }
  if (!Number.isFinite(identity.archiveBytes)) {
    return false;
  }
  if (typeof identity.archiveSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(identity.archiveSha256)) {
    return false;
  }
  if (!hasBuiltHarness(dest)) {
    return false;
  }
  const stamp = readRuntimeStamp(dest);
  if (!stamp) {
    return false;
  }
  return stamp.sha === identity.sha
    && stamp.npm === identity.npm
    && stamp.archiveBytes === identity.archiveBytes
    && stamp.archiveSha256 === identity.archiveSha256;
}

function packagedHarnessRoot() {
  const loose = looseHarnessRoot();
  if (hasBuiltHarness(loose)) return loose;
  const extracted = extractedHarnessRoot();
  if (hasBuiltHarness(extracted)) {
    return extracted;
  }
  return extracted;
}

function tarCommand(platform = process.platform) {
  if (platform !== 'win32') {
    return 'tar';
  }
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const systemTar = path.join(windowsRoot, 'System32', 'tar.exe');
  return fs.existsSync(systemTar) ? systemTar : 'tar';
}

function extractionCancelled() {
  return Object.assign(new Error('已取消运行时准备'), { code: 'DSH_CANCELLED' });
}

function runTar(args, { signal, log = () => {}, spawn: spawnChild = spawn,
  timeoutMs = 15 * 60_000, heartbeatMs = 5000 } = {}) {
  if (signal?.aborted) return Promise.reject(extractionCancelled());
  return new Promise((resolve, reject) => {
    const child = spawnChild(tarCommand(), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let failure;
    const started = Date.now();
    const stop = (error) => {
      if (failure) return;
      failure = error;
      // tar has no children. Wait for close before removing its output tree.
      child.kill('SIGKILL');
    };
    const onAbort = () => stop(extractionCancelled());
    const deadline = setTimeout(() => stop(Object.assign(new Error('运行时解压超时。请检查磁盘空间和系统安全软件提示，再重试；现有运行时已保留。'), { code: 'ETIMEDOUT' })), timeoutMs);
    const heartbeat = setInterval(() => log(`正在解压运行时，已用时 ${Math.floor((Date.now() - started) / 1000)} 秒；大量文件在慢速磁盘上可能需要数分钟…`), heartbeatMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8192);
    });
    child.on('error', (error) => { failure = failure || error; });
    child.on('close', (code) => {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      signal?.removeEventListener('abort', onAbort);
      if (failure) { reject(failure); return; }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `tar 退出码 ${code}`));
    });
  });
}

async function ensurePackagedHarness(log = () => {}, options = {}) {
  if (!app.isPackaged) return null;
  const dest = extractedHarnessRoot();
  while (extractions.has(dest)) await extractions.get(dest).catch(() => {});
  const work = preparePackagedHarness(log, options);
  extractions.set(dest, work);
  try { return await work; } finally {
    if (extractions.get(dest) === work) extractions.delete(dest);
  }
}

async function recoverRuntimeReplacement(dest, log) {
  const previous = `${dest}.previous`;
  if (!fs.existsSync(previous)) return;
  // A crash between renames or before the completion stamp must retain the
  // rollback tree. It never enters the generic stale-directory sweep.
  if (hasBuiltHarness(dest) && readRuntimeStamp(dest)) {
    await retireStaleExtract(previous, log);
    return;
  }
  if (fs.existsSync(dest)) await retireStaleExtract(dest, log);
  await fsp.rename(previous, dest);
  log('已恢复上次中断替换前的运行时，正在重新检查安装包。');
}

async function prepareRuntimeLinks(root, { signal, log, remove = false }) {
  let completed = 0;
  let total = 0;
  const started = Date.now();
  const label = remove ? '正在清理临时运行时链接' : '正在检查并恢复运行时链接';
  const heartbeat = setInterval(() => {
    log(`${label}：${completed}/${total}，已用时 ${Math.floor((Date.now() - started) / 1000)} 秒…`);
  }, 5000);
  try {
    const operation = remove ? removeRuntimeLinksAsync : materializeRuntimeLinksAsync;
    await operation(root, { signal, onProgress: (done, count) => { completed = done; total = count; } });
  } finally { clearInterval(heartbeat); }
}

async function preparePackagedHarness(log = () => {}, { signal } = {}) {
  if (!app.isPackaged) {
    return null;
  }
  if (signal?.aborted) throw extractionCancelled();
  // Windows NSIS prepares the immutable runtime and its links before promoting the application.
  // Prefer it to an older same-version userData extract, without writing to either tree.
  const installed = looseHarnessRoot();
  if (hasBuiltHarness(installed)) return installed;
  const dest = extractedHarnessRoot();
  const archive = harnessArchivePath();
  const loose = looseHarnessRoot();
  await recoverRuntimeReplacement(dest, log);
  // Listing is cheap and must finish before any rename below so the sweep
  // and retireStaleExtract never race on the same directory.
  await sweepStaleExtracts(path.dirname(dest), log).catch(() => []);
  if (signal?.aborted) throw extractionCancelled();
  const archiveExists = fs.existsSync(archive);
  // readPackagedPin throws on a missing/invalid pin before anything on disk
  // is deleted; a broken install must not destroy a usable runtime.
  const packaged = archiveExists
    ? await readPackagedRuntimeIdentity(readPackagedPin(), archive, signal)
    : null;
  const identity = packaged?.identity;
  let linksReady = true;
  try { await prepareRuntimeLinks(dest, { signal, log }); } catch (error) {
    if (signal?.aborted || error.code === 'DSH_CANCELLED') throw extractionCancelled();
    linksReady = false;
    log(`运行时链接需要重建：${error.message}`);
  }
  if (identity && linksReady && canReuseExtractedHarness(dest, identity)) {
    return dest;
  }
  if (!archiveExists) {
    // Degraded install (archive stripped or corrupted away). Never delete a
    // runtime we cannot re-create: reuse what still boots and warn.
    if (hasBuiltHarness(loose)) {
      return loose;
    }
    if (hasBuiltHarness(dest)) {
      log('安装包缺少运行时归档 deepseek-harness.tar，降级复用已解压的运行时。建议重新安装。');
      return dest;
    }
    throw new Error('安装包缺少运行时归档 deepseek-harness.tar');
  }
  if (hasBuiltHarness(loose)) {
    return loose;
  }
  // Uncompressed tar size + filesystem overhead + reserve; the existing
  // runtime stays in place until a replacement has been validated.
  const space = checkInstallSpace(path.dirname(dest), identity.archiveBytes * 1.15);
  if (!space.checked) log('无法预先读取运行时磁盘空间；解压失败时请检查目标磁盘可用空间。');
  if (packaged.needsVerification) {
    log('正在校验安装包运行时归档…');
    if (await hashRuntimeArchive(archive, { signal }) !== identity.archiveSha256) {
      throw new Error('运行时归档校验失败，请重新下载安装包');
    }
  }
  log(`正在准备运行时到 ${dest}（首次或更新后需要解压）…`);
  const staging = `${dest}${EXTRACT_SUFFIX}${randomUUID()}`;
  activeStaging.add(staging);
  try {
    await fsp.mkdir(staging, { recursive: true });
    await runTar(['-xf', archive, '-C', staging], { signal, log });
    if (signal?.aborted) throw extractionCancelled();
    log('解压完成，正在恢复运行时链接并校验文件…');
    await prepareRuntimeLinks(staging, { signal, log });
    if (!hasBuiltHarness(staging)) throw new Error('运行时解压不完整，请重新下载安装包');
    // Windows junctions contain absolute paths: validate in staging, remove,
    // then recreate at the final location before stamping the runtime.
    await prepareRuntimeLinks(staging, { signal, log, remove: true });
    if (signal?.aborted) throw extractionCancelled();
    // Commit is non-cancellable, including final link recovery. Do not delete the old
    // runtime before the new directory is in place; roll back a failed rename.
    let retired;
    if (fs.existsSync(dest)) {
      retired = `${dest}.previous`;
      await fsp.rename(dest, retired);
    }
    let promoted = false;
    try {
      await fsp.rename(staging, dest);
      promoted = true;
      await prepareRuntimeLinks(dest, { log });
      writeRuntimeStamp(dest, identity);
    } catch (error) {
      if (promoted) await fsp.rename(dest, staging);
      if (retired) await fsp.rename(retired, dest);
      throw error;
    }
    if (retired) await retireStaleExtract(retired, log).catch((error) => log(`清理旧运行时失败：${error.message}`));
    log(`运行时已解压到 ${dest}`);
    return dest;
  } finally {
    activeStaging.delete(staging);
    trackBackground(fsp.rm(staging, { recursive: true, force: true }).catch((error) => log(`清理未完成的运行时失败：${error.message}`)));
  }
}

module.exports = {
  harnessArchivePath,
  extractedHarnessRoot,
  packagedHarnessRoot,
  ensurePackagedHarness,
  hasBuiltHarness,
  canReuseExtractedHarness,
  packagedRuntimeIdentity,
  writeRuntimeStamp,
  tarCommand,
  runTar,
  recoverRuntimeReplacement,
  retireStaleExtract,
  sweepStaleExtracts,
  settleBackgroundWork,
  STALE_SUFFIX,
};
