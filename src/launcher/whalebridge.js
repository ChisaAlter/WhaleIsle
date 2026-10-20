'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { isPidAlive, killPid } = require('./components/lifecycle');
const { compareVersions } = require('./components/registry');

const ID = 'whalebridge';
const MANIFEST = 'WhaleBridge-component.json';
const ASSET = 'WhaleBridge-win32-x64.exe';
const TAG_PREFIX = 'whalebridge-v';
// The component owns its GitHub releases. CNB keeps the existing shared
// distribution mirror, including releases used by already-installed clients.
const GITHUB_RELEASES = 'https://github.com/ChisaAlter/WhaleBridge/releases';
// The DSH channel stores this address, so the gateway keeps one fixed port.
const GATEWAY = '127.0.0.1:3427';
const LOG_MAX_BYTES = 1024 * 1024;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function defaultPaths() {
  const { app } = require('electron');
  const { desktopStateDir } = require('./product');
  const { tryGetDesktopDshHome, desktopDshHomeFromUserData } = require('../shared/dsh-home');
  const desktop = desktopStateDir(app);
  return {
    root: path.join(desktop, 'components', ID),
    dshHome: tryGetDesktopDshHome() || desktopDshHomeFromUserData(desktop),
    devPackage: app.isPackaged ? '' : path.resolve(__dirname, '../../.tmp/whalebridge-package'),
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function validateManifest(m) {
  const p = m?.platforms?.['win32-x64'];
  if (m?.id !== ID || !/^\d+\.\d+\.\d+$/.test(m.version) || p?.asset !== ASSET
    || !/^[a-f0-9]{64}$/.test(p.sha256) || !Number.isSafeInteger(p.size) || p.size <= 0 || p.size > 200 * 1024 * 1024
    || typeof m.license !== 'string' || !m.license.includes('MIT License')) throw new Error('鲸桥发布清单无效');
  return m;
}
async function jsonRequest(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`);
  return response.json();
}

function createWhaleBridgeService(deps = {}) {
  const locations = deps.root ? deps : defaultPaths();
  const { root, dshHome, devPackage = '' } = locations;
  const installedFile = path.join(root, 'installed.json');
  const stateFile = path.join(root, 'data', 'state.json');
  const fetchJson = deps.fetchJson || jsonRequest;
  const alive = deps.isPidAlive || isPidAlive;
  const run = deps.spawn || spawn;
  const kill = deps.killPid || killPid;
  const platform = deps.platform || process.platform, arch = deps.arch || process.arch;
  const supported = platform === 'win32' && arch === 'x64';
  const runTool = deps.execFile || (deps.execFileSync
    ? async (...args) => deps.execFileSync(...args)
    : async (...args) => (await promisify(execFile)(...args)).stdout);
  const logFile = path.join(root, 'data', 'component.log');
  let catalog = readJson(path.join(root, 'catalog.json'));
  let catalogError = '';
  let pending = false;
  const installed = () => readJson(installedFile);
  const binary = version => path.join(root, 'versions', version, ASSET);
  const emit = (fn, phase, percent, message = '') => fn?.({ id: ID, phase, percent, message });
  const env = () => {
    const value = { ...process.env, LAUNCHER_COMPONENT_ID: ID,
      LAUNCHER_COMPONENT_DATA_DIR: path.join(root, 'data'), WHALEBRIDGE_DSH_HOME: dshHome,
      MAGPIE_ADDR: GATEWAY };
    delete value.ELECTRON_RUN_AS_NODE;
    delete value.MAGPIE_WEB_KEY;
    delete value.MAGPIE_WEB_RUNKEY;
    return value;
  };

  function state() {
    const current = readJson(stateFile);
    return current?.id === ID && current.ready === true && Number.isInteger(current.pid) && alive(current.pid) ? current : null;
  }
  function management(current) {
    const address = new URL(current.url);
    if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port || !/^[a-f0-9]{32}$/.test(address.searchParams.get('k') || '')) {
      throw new Error('鲸桥管理地址无效');
    }
    return { origin: address.origin, cookie: `magpie_web_${address.port}=${address.searchParams.get('k')}` };
  }
  async function api(route, body, current = state()) {
    if (!current) throw new Error('鲸桥未运行');
    const access = management(current);
    const result = await fetchJson(`${access.origin}/api/whalebridge/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: access.cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (route === 'status' && (result.pid !== current.pid || result.version !== current.version)) throw new Error('鲸桥进程信息不一致');
    return result;
  }

  // A forced exit (crash, Windows shutdown) leaves state.json behind, and the
  // recorded PID can later belong to another process. The fixed gateway port
  // names the PID really serving it; only a connection failure or another
  // answer proves the record stale. A slow answer is not proof.
  async function stale(current) {
    try {
      const identity = await fetchJson(`http://${GATEWAY}/whalebridge/identity`, {});
      return identity?.pid !== current.pid;
    } catch (error) {
      return error?.name !== 'TimeoutError' && error?.name !== 'AbortError';
    }
  }
  async function liveState() {
    const current = state();
    if (!current) return null;
    try {
      await api('status', undefined, current);
      return current;
    } catch (error) {
      if (!await stale(current)) throw error;
      fs.rmSync(stateFile, { force: true });
      return null;
    }
  }
  async function reconcile() {
    try { await liveState(); } catch { /* the row keeps reporting the running record */ }
  }

  async function alerts(current = state()) {
    if (!current) return { sequence: 0, alerts: [] };
    const access = management(current);
    return fetchJson(`${access.origin}/api/subscriptions/alerts/claim`, {
      method: 'POST',
      headers: { Cookie: access.cookie, 'Content-Type': 'application/json' },
    });
  }

  async function refreshCatalog() {
    catalogError = '';
    if (!supported) return row();
    try {
      if (devPackage && fs.existsSync(path.join(devPackage, MANIFEST))) {
        catalog = { manifest: validateManifest(readJson(path.join(devPackage, MANIFEST))), local: devPackage, route: 'development' };
      } else {
        const source = require('./release-source');
        const saved = require('../main/config').loadConfig().downloadRoute;
        const route = source.normalizeRoute(saved) || 'github';
        if (route === 'github') {
          // Public release attachments do not consume the shared IP's REST API
          // quota. Pin the executable to the validated manifest's version so a
          // newer release appearing during installation cannot mix versions.
          const manifest = validateManifest(await fetchJson(`${GITHUB_RELEASES}/latest/download/${MANIFEST}`));
          catalog = { manifest, url: `${GITHUB_RELEASES}/download/${TAG_PREFIX}${manifest.version}/${ASSET}`, route };
        } else {
          const releases = await fetchJson(`${source.ROUTES[route].apiBase}/releases?page_size=100`,
            { headers: { Accept: 'application/vnd.cnb.api+json' } });
          const release = (Array.isArray(releases) ? releases : []).filter(r => !r.draft && !r.prerelease && r.tag_name?.startsWith(TAG_PREFIX))
            .sort((a, b) => compareVersions(b.tag_name.slice(TAG_PREFIX.length), a.tag_name.slice(TAG_PREFIX.length)))[0];
          if (!release) throw new Error('鲸桥组件尚未发布到当前线路');
          const assets = release.assets || [];
          const manifestAsset = assets.find(a => a.name === MANIFEST);
          const exeAsset = assets.find(a => a.name === ASSET);
          if (!manifestAsset || !exeAsset) throw new Error('鲸桥发布缺少组件文件');
          const manifest = validateManifest(await fetchJson(manifestAsset.browser_download_url || manifestAsset.download_url));
          if (release.tag_name !== TAG_PREFIX + manifest.version || exeAsset.size !== manifest.platforms['win32-x64'].size) throw new Error('鲸桥清单与发布资产不一致');
          catalog = { manifest, url: exeAsset.browser_download_url || exeAsset.download_url, route };
        }
      }
      writeJson(path.join(root, 'catalog.json'), catalog);
    } catch (error) {
      catalogError = error.message;
    }
    return row();
  }

  function row() {
    const rec = installed(), live = state();
    const m = catalog?.manifest;
    if (!rec && !supported) {
      return {
        id: ID, name: '鲸桥', description: '将 API 供应商和订阅账号接入鲸屿，统一管理模型、请求路由与用量。',
        version: '', installedVersion: '', latest: '', previousVersion: '', state: 'unsupported',
        source: 'official', kind: 'service', pid: null, url: '', updateAvailable: false,
        message: '鲸桥目前只提供 Windows x64 版本。', configurable: false,
      };
    }
    return {
      id: ID, name: '鲸桥', description: '将 API 供应商和订阅账号接入鲸屿，统一管理模型、请求路由与用量。',
      version: m?.version || rec?.version || '1.0.0', installedVersion: rec?.version || '',
      latest: m?.version || '', previousVersion: rec?.previous || '',
      state: rec ? (live ? 'running' : 'stopped') : 'available',
      source: 'official', kind: 'service', pid: live?.pid || null,
      url: live ? management(live).origin : '',
      updateAvailable: Boolean(rec && m && compareVersions(m.version, rec.version) > 0),
      message: catalogError || '', configurable: Boolean(rec),
    };
  }

  async function locked(fn) {
    if (pending) return { ok: false, error: 'busy' };
    pending = true;
    let held = false;
    const lock = path.join(root, 'operation.lock');
    try {
      fs.mkdirSync(root, { recursive: true });
      if (fs.existsSync(lock)) {
        let owner = null;
        try { owner = readJson(lock); } catch { /* a holder that died before writing its PID */ }
        if (owner?.pid && alive(owner.pid)) return { ok: false, error: 'busy' };
        // An unreadable record may still be in the middle of being written.
        if (!owner?.pid && Date.now() - fs.statSync(lock).mtimeMs < 10_000) return { ok: false, error: 'busy' };
        fs.unlinkSync(lock);
      }
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
      held = true;
      return await fn();
    } catch (error) {
      return { ok: false, error: error.code === 'EEXIST' ? 'busy' : 'whalebridge-failed', message: error.message };
    } finally {
      if (held) fs.unlinkSync(lock);
      pending = false;
    }
  }

  // The component's own error line, so a failed start names its cause.
  function logTail(from) {
    try {
      const data = fs.readFileSync(logFile);
      const lines = data.subarray(Math.max(from, data.length - 4096)).toString('utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      return lines.slice(-3).join(' / ');
    } catch { return ''; }
  }
  function startFailure(summary, from) {
    const tail = logTail(from);
    return new Error(tail ? `${summary}：${tail}` : `${summary}，详见组件日志：${logFile}`);
  }

  async function startRuntime(version, progress) {
    const current = await liveState();
    if (current) {
      if (current.version !== version) throw new Error('鲸桥运行版本与安装记录不一致');
      await unfreeze(current);
      return { ok: true };
    }
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.rmSync(stateFile, { force: true });
    emit(progress, 'spawn', 75);
    let size = 0;
    try { size = fs.statSync(logFile).size; } catch { /* first start */ }
    const log = fs.openSync(logFile, size > LOG_MAX_BYTES ? 'w' : 'a');
    const logStart = size > LOG_MAX_BYTES ? 0 : size;
    let child;
    try { child = run(binary(version), ['whalebridge'], { cwd: path.dirname(binary(version)), env: env(), stdio: ['ignore', log, log], detached: true, windowsHide: true }); }
    finally { fs.closeSync(log); }
    let failure;
    child.once('error', e => { failure = e; });
    child.unref();
    const deadline = Date.now() + (deps.readyTimeoutMs || 30_000);
    try {
      while (Date.now() < deadline) {
        if (failure) throw failure;
        if (child.exitCode !== null) throw startFailure(`鲸桥启动退出（${child.exitCode}）`, logStart);
        const ready = state();
        if (ready?.pid === child.pid) {
          if (ready.version !== version) throw new Error('鲸桥程序版本与发布清单不一致');
          await api('status', undefined, ready);
          emit(progress, 'done', 100);
          return { ok: true };
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw startFailure('鲸桥启动超时', logStart);
    } catch (error) {
      if (child.pid && alive(child.pid)) kill(child.pid, { force: true });
      fs.rmSync(stateFile, { force: true });
      throw error;
    }
  }

  async function stage(progress) {
    await refreshCatalog();
    if (catalogError) throw new Error(catalogError);
    const m = validateManifest(catalog?.manifest), spec = m.platforms['win32-x64'];
    const target = path.join(root, 'versions', m.version);
    if (installed() && compareVersions(m.version, installed().version) <= 0) throw new Error('没有较新版本');
    const staging = path.join(root, 'versions', `.staging-${process.pid}`);
    fs.mkdirSync(staging, { recursive: true });
    const file = path.join(staging, ASSET);
    try {
      emit(progress, 'download', 10);
      if (catalog.local) fs.copyFileSync(path.join(catalog.local, ASSET), file);
      else await require('../main/update').downloadFile(catalog.url, file, p => emit(progress, 'download', Math.round((p.percent || 0) * .55)));
      emit(progress, 'verify', 60);
      const data = fs.readFileSync(file);
      if (data.length !== spec.size || createHash('sha256').update(data).digest('hex') !== spec.sha256) throw new Error('鲸桥文件大小或 SHA256 校验失败');
      writeJson(path.join(staging, MANIFEST), m);
      fs.writeFileSync(path.join(staging, 'LICENSE'), m.license);
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
      fs.renameSync(staging, target);
      return m.version;
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }

  async function freeze() {
    const current = await liveState();
    if (current) await api('maintenance', { on: true }, current);
    return current;
  }
  async function unfreeze(current) { if (current && alive(current.pid)) await api('maintenance', { on: false }, current); }
  async function terminate(current) {
    // taskkill /T may fail on a console-host child after stopping the gateway.
    // The gateway's actual liveness decides whether termination succeeded.
    if (current && !kill(current.pid, { force: true }) && alive(current.pid)) throw new Error('无法停止鲸桥进程');
    // taskkill returns before Windows has released the image; files of this
    // version are moved or reused only after the process is really gone.
    const deadline = Date.now() + (deps.exitTimeoutMs ?? 5000);
    while (current && alive(current.pid)) {
      if (Date.now() >= deadline) throw new Error('鲸桥进程未能退出');
      await delay(100);
    }
    fs.rmSync(stateFile, { force: true });
  }
  // Keep the active version and the one rollback target.
  function prune(keep) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, 'versions')); } catch { return; }
    for (const name of entries) {
      if (name.startsWith('.') || keep.includes(name)) continue;
      try { fs.rmSync(path.join(root, 'versions', name), { recursive: true, force: true }); } catch { /* retried on the next switch */ }
    }
  }
  async function rename(from, to) {
    for (let attempt = 1; ; attempt++) {
      try { return fs.renameSync(from, to); } catch (error) {
        if (attempt >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        await delay(200 * attempt);
      }
    }
  }

  function install(progress) { return locked(async () => {
    if (installed()) throw new Error('鲸桥已安装');
    if (!supported) throw new Error('鲸桥目前只提供 Windows x64 版本');
    const version = await stage(progress);
    writeJson(installedFile, { version, previous: null });
    try { await startRuntime(version, progress); }
    catch (error) { throw new Error(`鲸桥已安装，但启动失败：${error.message}`); }
    return { ok: true, component: row() };
  }); }
  function start(progress) { return locked(async () => {
    const rec = installed(); if (!rec) throw new Error('请先安装鲸桥');
    await startRuntime(rec.version, progress);
    return { ok: true, url: state().url };
  }); }
  function stop(progress) { return locked(async () => {
    const current = await freeze();
    try { await terminate(current); }
    catch (error) { await unfreeze(current); throw error; }
    emit(progress, 'done', 100);
    return { ok: true };
  }); }
  async function switchVersion(version, previous, progress) {
    const old = installed(), current = await freeze();
    try {
      await terminate(current);
      writeJson(installedFile, { version, previous });
      await startRuntime(version, progress);
    } catch (error) {
      const live = state();
      if (live?.pid === current?.pid) {
        await unfreeze(current);
        throw error;
      }
      await terminate(live);
      writeJson(installedFile, old);
      await startRuntime(old.version, progress);
      throw new Error(`更新未生效，已恢复原版本：${error.message}`);
    }
    prune([version, previous]);
    return { ok: true, component: row() };
  }
  function update(progress) { return locked(async () => {
    const rec = installed(); if (!rec) throw new Error('请先安装鲸桥');
    // Download and verify before stopping the healthy version.
    const version = await stage(progress);
    if (compareVersions(version, rec.version) <= 0) throw new Error('没有较新版本');
    return switchVersion(version, rec.version, progress);
  }); }
  function rollback(progress) { return locked(async () => {
    const rec = installed(); if (!rec?.previous) throw new Error('没有可回滚版本');
    return switchVersion(rec.previous, rec.version, progress);
  }); }
  function uninstall(options = {}, progress) { return locked(async () => {
    const rec = installed(); if (!rec) throw new Error('鲸桥未安装');
    const current = await freeze();
    const versions = path.join(root, 'versions');
    const staged = path.join(root, `.uninstall-${process.pid}`);
    let moved = false;
    try {
      await terminate(current);
      // Keep the payload recoverable until the atomic DSH disconnect commits.
      await rename(versions, staged);
      moved = true;
      fs.unlinkSync(installedFile);
      await runTool(path.join(staged, rec.version, ASSET), ['whalebridge-disconnect'], { env: env(), windowsHide: true, timeout: 15_000 });
    } catch (error) {
      if (moved) fs.renameSync(staged, versions);
      writeJson(installedFile, rec);
      if (current) await startRuntime(rec.version);
      throw error;
    }
    let message = '';
    try {
      await fs.promises.rm(staged, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      if (options.removeData === true) fs.rmSync(path.join(root, 'data'), { recursive: true, force: true });
    } catch (error) {
      message = `鲸桥已卸载并断开 DSH，但文件清理失败：${error.message}`;
    }
    emit(progress, 'done', 100, message);
    return { ok: true, ...(message ? { message } : {}) };
  }); }
  async function uninstallInfo() {
    const rec = installed();
    if (!rec) return { defaultModel: false };
    const current = await liveState();
    if (current) return api('status', undefined, current);
    const output = await runTool(binary(rec.version), ['whalebridge-status'], {
      env: env(), windowsHide: true, timeout: 15_000, encoding: 'utf8',
    });
    const info = JSON.parse(output);
    if (typeof info.defaultModel !== 'boolean') throw new Error('鲸桥配置状态无效');
    return info;
  }
  return { row, refreshCatalog, reconcile, install, start, stop, update, rollback, uninstall, uninstallInfo, installed, state, api, alerts };
}

let singleton;
function whaleBridgeService() { return singleton ||= createWhaleBridgeService(); }
async function ensureWhaleBridgeRuntime() {
  const svc = whaleBridgeService();
  if (!svc.installed()) return;
  const result = await svc.start();
  if (!result.ok) throw new Error(result.message || '鲸桥启动失败');
}
module.exports = { ID, createWhaleBridgeService, whaleBridgeService, ensureWhaleBridgeRuntime, validateManifest };
