'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { randomUUID } = require('crypto');

const MAX_HISTORY = 30;
const MAX_LOG = 16000;
const active = new Map();

function stateFile() {
  return path.join(app.getPath('userData'), 'marketplace-state.json');
}

/** Remove common credential forms before logs cross IPC or enter durable storage. */
function redactMarketLog(value) {
  return String(value || '')
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|key|api_key|access_token|auth|password)=)[^\s&#]+/gi, '$1[redacted]')
    .replace(/((?:authorization|password|githubToken|api[_-]?key|_authToken|access_token)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g, '[redacted]');
}

function readState() {
  try {
    const file = stateFile();
    if (fs.statSync(file).size > 1024 * 1024) return { favorites: [], operations: [] };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      favorites: Array.isArray(data.favorites) ? data.favorites.filter(id => typeof id === 'string').slice(0, 2000) : [],
      operations: Array.isArray(data.operations) ? data.operations.filter(row => row
        && typeof row.id === 'string' && typeof row.target === 'string'
        && ['install', 'update', 'uninstall', 'batch'].includes(row.kind)
        && ['running', 'succeeded', 'failed', 'interrupted'].includes(row.status)
        && Number.isFinite(row.startedAt) && row.startedAt > 0 && row.startedAt < 8640000000000000)
        .slice(0, MAX_HISTORY).map(row => ({ ...row,
          target: redactMarketLog(row.target).slice(0, 1000),
          log: redactMarketLog(row.log).slice(-MAX_LOG),
          error: redactMarketLog(row.error).slice(0, 2000),
        })) : [],
    };
  } catch {
    // Missing or corrupt optional UI state must not prevent opening the marketplace.
    return { favorites: [], operations: [] };
  }
}

function writeState(state) {
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), 'utf8');
  fs.renameSync(`${file}.tmp`, file);
}

function listMarketplaceState() {
  const state = readState();
  return {
    ok: true,
    ...state,
    operations: state.operations.map(row => ({
      ...(active.get(row.id) || row),
      status: row.status === 'running' && !active.has(row.id) ? 'interrupted' : row.status,
    })),
  };
}

function setMarketplaceFavorite(id, favorite) {
  if (typeof id !== 'string' || !id || id.length > 300 || typeof favorite !== 'boolean') {
    throw new Error('无效的收藏参数');
  }
  const state = readState();
  const ids = new Set(state.favorites);
  if (favorite) ids.add(id);
  else ids.delete(id);
  if (ids.size > 2000) throw new Error('收藏数量超过上限');
  state.favorites = [...ids];
  writeState(state);
  return listMarketplaceState();
}

/** Persist before mutation/restart so a renderer reload cannot erase the outcome. */
async function recordMarketplaceOperation(kind, target, work) {
  const row = { id: randomUUID(), kind, target: redactMarketLog(target).slice(0, 1000), startedAt: Date.now(), status: 'running', log: '' };
  active.set(row.id, row);
  const save = () => {
    const state = readState();
    state.operations = [row, ...state.operations.filter(item => item.id !== row.id)].slice(0, MAX_HISTORY);
    writeState(state);
  };
  try {
    save();
    const result = await work(payload => {
      row.log = `${row.log}${redactMarketLog(payload.line)}\n`.slice(-MAX_LOG);
    });
    const restartUnconfirmed = result.ok === true && result.harnessStarted !== true && result.harnessStarted !== false;
    row.status = result.ok === true && result.harnessStarted === true ? 'succeeded'
      : restartUnconfirmed ? 'interrupted' : 'failed';
    row.error = redactMarketLog(result.error || (restartUnconfirmed
      ? '插件操作已返回，但 Harness 重启结果尚未确认。请检查运行状态后再操作。' : '')).slice(0, 2000);
    row.log = [row.log, redactMarketLog(result.log), ...(result.results || []).map(item => (
      `${item.id}: ${item.ok ? 'OK' : redactMarketLog(item.error)}\n${redactMarketLog(item.log)}`
    ))].filter(Boolean).join('\n').slice(-MAX_LOG);
    row.finishedAt = Date.now();
    try {
      save();
    } catch (historyError) {
      // Preserve the actual profile/runtime result while reporting the separate storage failure.
      const outcome = result.ok !== true ? '插件操作未完成'
        : result.harnessStarted === true ? '插件操作及 Harness 重启已完成'
          : result.harnessStarted === false ? '插件操作已完成，但 Harness 未重新启动'
            : '插件操作已返回，Harness 重启结果尚未确认';
      const storageError = redactMarketLog(historyError.message || String(historyError)).slice(0, 2000);
      return { ...result, historyWarning: `${outcome}；操作记录保存失败：${storageError}` };
    }
    return result;
  } catch (error) {
    row.status = 'failed';
    row.error = redactMarketLog(error.message);
    row.finishedAt = Date.now();
    let historyWarning;
    try {
      save();
    } catch (historyError) {
      const storageError = redactMarketLog(historyError.message || String(historyError)).slice(0, 2000);
      historyWarning = `插件操作失败；操作记录保存失败：${storageError}`;
    }
    return { ok: false, error: row.error, ...(historyWarning ? { historyWarning } : {}) };
  } finally {
    active.delete(row.id);
  }
}

module.exports = { listMarketplaceState, setMarketplaceFavorite, recordMarketplaceOperation, redactMarketLog };
