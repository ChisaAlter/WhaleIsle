'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const RUNTIME_ARCHIVE_IDENTITY = 'deepseek-harness-runtime.json';
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * @typedef {object} RuntimeArchiveManifest
 * @property {number} version
 * @property {number} archiveBytes
 * @property {string} archiveSha256
 */

function cancelled() {
  return Object.assign(new Error('已取消运行时准备'), { code: 'DSH_CANCELLED' });
}

/**
 * Hash a runtime archive without loading it into memory or blocking Electron.
 * @param {string} archive
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string>}
 */
async function hashRuntimeArchive(archive, { signal } = {}) {
  if (signal?.aborted) throw cancelled();
  const digest = createHash('sha256');
  try {
    for await (const chunk of fs.createReadStream(archive, { highWaterMark: 1024 * 1024, signal })) {
      digest.update(chunk);
    }
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    throw error;
  }
  if (signal?.aborted) throw cancelled();
  return digest.digest('hex');
}

/**
 * Missing manifests are supported for archives built by older desktop versions.
 * @param {string} archive
 * @returns {Promise<RuntimeArchiveManifest | null>}
 */
async function readRuntimeArchiveIdentity(archive) {
  let contents;
  try { contents = await fs.promises.readFile(path.join(path.dirname(archive), RUNTIME_ARCHIVE_IDENTITY), 'utf8'); }
  catch (error) { if ((/** @type {NodeJS.ErrnoException} */ (error)).code === 'ENOENT') return null; throw error; }
  const manifest = JSON.parse(contents);
  if (!manifest || manifest.version !== 1 || !Number.isSafeInteger(manifest.archiveBytes)
      || manifest.archiveBytes < 0 || !SHA256.test(manifest.archiveSha256)) {
    throw new Error('运行时归档摘要无效，请重新下载安装包');
  }
  return manifest;
}

/**
 * Bind the completed packaged tar to its actual bytes, before shipping it.
 * @param {string} archive
 * @returns {Promise<RuntimeArchiveManifest>}
 */
async function writeRuntimeArchiveIdentity(archive) {
  const before = await fs.promises.stat(archive);
  const archiveSha256 = await hashRuntimeArchive(archive);
  const after = await fs.promises.stat(archive);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new Error('Runtime archive changed while recording its identity');
  }
  const manifest = { version: 1, archiveBytes: after.size, archiveSha256 };
  await fs.promises.writeFile(path.join(path.dirname(archive), RUNTIME_ARCHIVE_IDENTITY), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

module.exports = { RUNTIME_ARCHIVE_IDENTITY, hashRuntimeArchive, readRuntimeArchiveIdentity, writeRuntimeArchiveIdentity };
