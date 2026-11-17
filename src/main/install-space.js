'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SPACE_RESERVE = 256 * 1024 * 1024;
const formatBytes = (bytes) => `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;

/** Check the actual destination volume, including a not-yet-created directory.
 * Unsupported filesystems are reported to the caller, never confused with zero.
 * This is an estimate/preflight; writes must still handle ENOSPC themselves. */
function checkInstallSpace(directory, bytes, { statfs = fs.statfsSync, reserve = SPACE_RESERVE } = {}) {
  if (!Number.isFinite(bytes) || bytes < 0) throw new TypeError('invalid installation size');
  let probe = path.resolve(directory);
  let stats;
  while (!stats) {
    try { stats = statfs(probe); } catch (error) {
      if (error.code === 'ENOENT' && path.dirname(probe) !== probe) {
        probe = path.dirname(probe);
        continue;
      }
      if (['ENOSYS', 'ENOTSUP', 'EINVAL'].includes(error.code)) return { checked: false };
      throw error;
    }
  }
  const available = Number(stats.bavail) * Number(stats.bsize);
  const required = Math.ceil(bytes + reserve);
  if (!Number.isFinite(available) || available < 0) return { checked: false };
  if (available < required) {
    throw Object.assign(new Error(`磁盘空间不足：${directory} 所在磁盘可用 ${formatBytes(available)}，本步骤预计需要 ${formatBytes(required)}（含预留空间）。请释放该磁盘空间后重试。`), { code: 'ENOSPC' });
  }
  return { checked: true, available, required };
}

module.exports = { checkInstallSpace };
