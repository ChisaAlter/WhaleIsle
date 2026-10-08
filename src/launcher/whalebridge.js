'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { isPidAlive, killPid } = require('./components/lifecycle');
const { compareVersions } = require('./components/registry');

const ID = 'whalebridge';
const MANIFEST = 'WhaleBridge-component.json';
const ASSET = 'WhaleBridge-win32-x64.exe';
const TAG_PREFIX = 'whalebridge-v';

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
  let catalog = readJson(path.join(root, 'catalog.json'));
  let catalogError = '';
  let pending = false;
  const installed = () => readJson(installedFile);
  const binary = version => path.join(root, 'versions', version, ASSET);
  const emit = (fn, phase, percent, message = '') => fn?.({ id: ID, phase, percent, message });
  const env = () => {
    const value = { ...process.env, LAUNCHER_COMPONENT_ID: ID,
      LAUNCHER_COMPONENT_DATA_DIR: path.join(root, 'data'), WHALEBRIDGE_DSH_HOME: dshHome,
      MAGPIE_ADDR: '127.0.0.1:3427' };
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

  async function alerts(current = state()) {
    if (!current) return { sequence: 0, alerts: [] };
    const access = management(current);
    return fetchJson(`${access.origin}/api/subscriptions/alerts/claim`, {
      method: 'POST',
      headers: { Cookie: access.cookie },
    });
  }

  async function refreshCatalog() {
    catalogError = '';
    try {
      if (devPackage && fs.existsSync(path.join(devPackage, MANIFEST))) {
        catalog = { manifest: validateManifest(readJson(path.join(devPackage, MANIFEST))), local: devPackage, route: 'development' };
      } else {
        const source = require('./release-source');
        const saved = require('../main/config').loadConfig().downloadRoute;
        const route = source.normalizeRoute(saved) || 'github';
        const releases = await fetchJson(`${source.ROUTES[route].apiBase}/releases?${route === 'cnb' ? 'page_size' : 'per_page'}=100`);
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
      writeJson(path.join(root, 'catalog.json'), catalog);
    } catch (error) {
      catalogError = error.message;
    }
    return row();
  }

  function row() {
    const rec = installed(), live = state();
    const m = catalog?.manifest;
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
        const owner = readJson(lock);
        if (owner?.pid && alive(owner.pid)) return { ok: false, error: 'busy' };
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

  async function startRuntime(version, progress) {
    const current = state();
    if (current) {
      if (current.version !== version) throw new Error('鲸桥运行版本与安装记录不一致');
      await api('status', undefined, current);
      await unfreeze(current);
      return { ok: true };
    }
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.rmSync(stateFile, { force: true });
    emit(progress, 'spawn', 75);
    const log = fs.openSync(path.join(root, 'data', 'component.log'), 'a');
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
        if (child.exitCode !== null) throw new Error(`鲸桥启动退出（${child.exitCode}），详见组件日志`);
        const ready = state();
        if (ready?.pid === child.pid) {
          if (ready.version !== version) throw new Error('鲸桥程序版本与发布清单不一致');
          await api('status', undefined, ready);
          emit(progress, 'done', 100);
          return { ok: true };
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('鲸桥启动超时，详见组件日志');
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
    const current = state();
    if (current) { await api('status', undefined, current); await api('maintenance', { on: true }, current); }
    return current;
  }
  async function unfreeze(current) { if (current && alive(current.pid)) await api('maintenance', { on: false }, current); }
  function terminate(current) {
    // taskkill /T may fail on a console-host child after stopping the gateway.
    // The gateway's actual liveness decides whether termination succeeded.
    if (current && !kill(current.pid, { force: true }) && alive(current.pid)) throw new Error('无法停止鲸桥进程');
    fs.rmSync(stateFile, { force: true });
  }

  function install(progress) { return locked(async () => {
    if (installed()) throw new Error('鲸桥已安装');
    if ((deps.platform || process.platform) !== 'win32' || (deps.arch || process.arch) !== 'x64') throw new Error('鲸桥首版支持 Windows x64');
    const version = await stage(progress);
    writeJson(installedFile, { version, previous: null });
    await startRuntime(version, progress);
    return { ok: true, component: row() };
  }); }
  function start(progress) { return locked(async () => {
    const rec = installed(); if (!rec) throw new Error('请先安装鲸桥');
    await startRuntime(rec.version, progress);
    return { ok: true, url: state().url };
  }); }
  function stop(progress) { return locked(async () => {
    const current = await freeze();
    try { terminate(current); }
    catch (error) { await unfreeze(current); throw error; }
    emit(progress, 'done', 100);
    return { ok: true };
  }); }
  async function switchVersion(version, previous, progress) {
    const old = installed(), current = await freeze();
    try {
      terminate(current);
      writeJson(installedFile, { version, previous });
      await startRuntime(version, progress);
    } catch (error) {
      const live = state();
      if (live?.pid === current?.pid) {
        await unfreeze(current);
        throw error;
      }
      terminate(live);
      writeJson(installedFile, old);
      await startRuntime(old.version, progress);
      throw new Error(`更新未生效，已恢复原版本：${error.message}`);
    }
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
      terminate(current);
      // Keep the payload recoverable until the atomic DSH disconnect commits.
      fs.renameSync(versions, staged);
      moved = true;
      fs.unlinkSync(installedFile);
      (deps.execFileSync || execFileSync)(path.join(staged, rec.version, ASSET), ['whalebridge-disconnect'], { env: env(), windowsHide: true, timeout: 15_000, stdio: 'pipe' });
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
    const current = state();
    if (current) return api('status', undefined, current);
    const output = (deps.execFileSync || execFileSync)(binary(rec.version), ['whalebridge-status'], {
      env: env(), windowsHide: true, timeout: 15_000, encoding: 'utf8', stdio: 'pipe',
    });
    const info = JSON.parse(output);
    if (typeof info.defaultModel !== 'boolean') throw new Error('鲸桥配置状态无效');
    return info;
  }
  return { row, refreshCatalog, install, start, stop, update, rollback, uninstall, uninstallInfo, installed, state, api, alerts };
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
