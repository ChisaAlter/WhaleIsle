'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createWhaleBridgeService, validateManifest } = require('./whalebridge');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whalebridge-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const devPackage = path.join(root, 'package');
  fs.mkdirSync(devPackage);
  const payload = Buffer.from('native fixture');
  const manifest = { id: 'whalebridge', version: '1.0.0', license: 'MIT License', platforms: { 'win32-x64': {
    asset: 'WhaleBridge-win32-x64.exe', size: payload.length, sha256: createHash('sha256').update(payload).digest('hex'),
  } } };
  function publish(version) {
    manifest.version = version;
    fs.writeFileSync(path.join(devPackage, 'WhaleBridge-component.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(devPackage, 'WhaleBridge-win32-x64.exe'), payload);
  }
  publish('1.0.0');
  const live = new Set(); let nextPid = 9000, active = false, failVersion = '', killed = [];
  const deps = { root: path.join(root, 'component'), dshHome: path.join(root, 'dsh'), devPackage,
    platform: 'win32', arch: 'x64', readyTimeoutMs: 200,
    isPidAlive: pid => live.has(pid) || pid === process.pid,
    killPid: pid => { killed.push(pid); return live.delete(pid); },
    spawn: file => {
      const child = new EventEmitter(); child.pid = ++nextPid; child.exitCode = null; child.unref = () => {};
      const version = path.basename(path.dirname(file));
      if (version === failVersion) { child.exitCode = 1; return child; }
      live.add(child.pid);
      fs.mkdirSync(path.join(deps.root, 'data'), { recursive: true });
      fs.writeFileSync(path.join(deps.root, 'data', 'state.json'), JSON.stringify({ id: 'whalebridge', ready: true, pid: child.pid, version, url: 'http://127.0.0.1:2222/?k=' + 'a'.repeat(32) }));
      return child;
    },
    fetchJson: async (url, options) => {
      assert.equal(options.headers.Cookie, 'magpie_web_2222=' + 'a'.repeat(32));
      const state = JSON.parse(fs.readFileSync(path.join(deps.root, 'data', 'state.json')));
      if (url.endsWith('/maintenance') && active && JSON.parse(options.body).on) throw new Error('DSH 有正在生成的回复');
      return url.endsWith('/status') ? { models: 0, pid: state.pid, version: state.version } : { active: 0 };
    },
    execFileSync: () => {},
  };
  return { deps, service: createWhaleBridgeService(deps), publish, manifest, live, killed,
    setActive: value => { active = value; }, fail: version => { failVersion = version; } };
}

test('manifest refuses substituted asset, invalid version, digest and missing license', () => {
  const good = { id: 'whalebridge', version: '1.0.0', license: 'MIT License', platforms: { 'win32-x64': { asset: 'WhaleBridge-win32-x64.exe', size: 10, sha256: 'a'.repeat(64) } } };
  assert.equal(validateManifest(good), good);
  for (const value of [ { ...good, version: '../x' }, { ...good, license: '' }, { ...good, platforms: { 'win32-x64': { ...good.platforms['win32-x64'], asset: '../payload.exe' } } } ]) assert.throws(() => validateManifest(value));
});

test('remote catalog works with GitHub API rate-limited and keeps assets on the selected route', async t => {
  const f = fixture(t);
  const Module = require('node:module');
  const load = Module._load;
  t.mock.method(Module, '_load', function (id, ...args) {
    if (id === 'electron') return { app: {}, shell: {} };
    return Reflect.apply(load, this, [id, ...args]);
  });
  const { ROUTES } = require('./release-source');
  let route;
  const configPath = require.resolve('../main/config');
  const previousConfig = require.cache[configPath];
  // The native-component workflow runs without desktop/Electron dependencies.
  require.cache[configPath] = { exports: { loadConfig: () => ({ downloadRoute: route }) } };
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
  });
  const requests = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push(url);
    if (new URL(url).hostname === 'api.github.com') {
      return Response.json({ message: 'API rate limit exceeded for 39.144.70.82.' }, { status: 403 });
    }
    const selected = route === 'gitee' ? 'cnb' : route;
    const base = selected === 'github' ? 'https://github.com/ChisaAlter/WhaleBridge' : ROUTES[selected].apiBase;
    const manifestUrl = selected === 'github'
      ? `${base}/releases/latest/download/WhaleBridge-component.json`
      : `${base}/releases/download/whalebridge-v1.0.0/WhaleBridge-component.json`;
    if (url === manifestUrl) return Response.json(f.manifest);
    assert.equal(url, `${base}/releases?page_size=100`);
    const accept = new Headers(options.headers).get('Accept');
    if (selected === 'cnb' && accept !== 'application/vnd.cnb.api+json') {
      return new Response('<!DOCTYPE html><html>CNB releases</html>', { headers: { 'Content-Type': 'text/html' } });
    }
    if (selected === 'github') assert.notEqual(accept, 'application/vnd.cnb.api+json');
    return Response.json([{ tag_name: 'whalebridge-v1.0.0', assets: [
      { name: 'WhaleBridge-component.json', browser_download_url: manifestUrl },
      { name: 'WhaleBridge-win32-x64.exe', size: f.manifest.platforms['win32-x64'].size,
        browser_download_url: `${base}/releases/download/whalebridge-v1.0.0/WhaleBridge-win32-x64.exe` },
    ] }]);
  });
  for (route of ['cnb', 'gitee', 'github']) {
    requests.length = 0;
    const service = createWhaleBridgeService({ ...f.deps, devPackage: '', fetchJson: undefined });
    const row = await service.refreshCatalog();
    assert.equal(row.message, '');
    assert.equal(row.latest, '1.0.0');
    const selected = route === 'gitee' ? 'cnb' : route;
    const catalog = JSON.parse(fs.readFileSync(path.join(f.deps.root, 'catalog.json')));
    assert.equal(catalog.route, selected);
    const base = selected === 'github' ? 'https://github.com/ChisaAlter/WhaleBridge' : ROUTES[selected].apiBase;
    assert.equal(catalog.url, `${base}/releases/download/whalebridge-v1.0.0/WhaleBridge-win32-x64.exe`);
    assert.equal(requests.length, selected === 'github' ? 1 : 2);
    assert.ok(requests.every(url => new URL(url).hostname !== 'api.github.com'));
  }
});

test('download checksum failure never marks a component installed or starts it', async t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.deps.devPackage, 'WhaleBridge-win32-x64.exe'), 'bad');
  const result = await f.service.install();
  assert.equal(result.ok, false); assert.match(result.message, /SHA256/);
  assert.equal(f.service.installed(), null); assert.equal(f.live.size, 0);
});

test('active DSH request prevents stop, update and uninstall without killing the gateway', async t => {
  const f = fixture(t); assert.equal((await f.service.install()).ok, true);
  const pid = f.service.state().pid; f.setActive(true); f.publish('1.0.1');
  for (const operation of [() => f.service.stop(), () => f.service.update(), () => f.service.uninstall()]) {
    assert.equal((await operation()).ok, false); assert.equal(f.service.state().pid, pid);
  }
  assert.equal(f.killed.length, 0); assert.equal(f.service.installed().version, '1.0.0');
});

test('failed updated process restores the previous native version and keeps provider data', async t => {
  const f = fixture(t); assert.equal((await f.service.install()).ok, true);
  const file = path.join(f.deps.root, 'data', 'providers.json'); fs.writeFileSync(file, '{"secret":"kept"}');
  f.publish('1.0.1'); f.fail('1.0.1');
  const result = await f.service.update(); assert.equal(result.ok, false); assert.match(result.message, /已恢复原版本/);
  assert.equal(f.service.installed().version, '1.0.0'); assert.equal(f.service.state().version, '1.0.0');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"secret":"kept"}');
});

test('taskkill child error is accepted only when the gateway actually exited', async t => {
  const f = fixture(t);
  const exited = createWhaleBridgeService({ ...f.deps, killPid: pid => { f.live.delete(pid); return false; } });
  assert.equal((await exited.install()).ok, true);
  assert.equal((await exited.stop()).ok, true);
  assert.equal(exited.state(), null);
  const retained = createWhaleBridgeService({ ...f.deps, killPid: () => false });
  assert.equal((await retained.start()).ok, true);
  const result = await retained.stop();
  assert.equal(result.ok, false); assert.match(result.message, /无法停止/);
  assert.ok(retained.state());
});

test('update, rollback and reinstall retain settings; lower catalog never deletes rollback payload', async t => {
  const f = fixture(t); await f.service.install();
  const file = path.join(f.deps.root, 'data', 'providers.json'); fs.writeFileSync(file, 'kept');
  f.publish('1.0.1'); assert.equal((await f.service.update()).ok, true);
  f.publish('1.0.0'); assert.equal((await f.service.update()).ok, false);
  assert.ok(fs.existsSync(path.join(f.deps.root, 'versions', '1.0.0', 'WhaleBridge-win32-x64.exe')));
  assert.equal((await f.service.rollback()).ok, true); assert.equal(f.service.installed().version, '1.0.0');
  assert.equal((await f.service.uninstall()).ok, true); assert.equal(fs.readFileSync(file, 'utf8'), 'kept');
  assert.equal((await f.service.install()).ok, true); assert.equal(fs.readFileSync(file, 'utf8'), 'kept');
  assert.equal((await f.service.uninstall({ removeData: true })).ok, true); assert.equal(fs.existsSync(file), false);
});

test('a state record left by a forced exit is dropped when its PID now belongs to another process', async t => {
  const f = fixture(t); assert.equal((await f.service.install()).ok, true);
  const { pid } = f.service.state();
  f.live.delete(pid); f.live.add(4242);
  const stateFile = path.join(f.deps.root, 'data', 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile)), pid: 4242 }));
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const identities = [];
  const service = createWhaleBridgeService({ ...f.deps, fetchJson: async (url, options) => {
    if (url.endsWith('/whalebridge/identity')) { identities.push(url); throw refused; }
    const current = JSON.parse(fs.readFileSync(stateFile));
    if (current.pid === 4242) throw refused;
    return f.deps.fetchJson(url, options);
  } });
  assert.equal(service.row().state, 'running');
  await service.reconcile();
  assert.equal(service.row().state, 'stopped');
  assert.deepEqual(identities, ['http://127.0.0.1:3427/whalebridge/identity']);
  assert.equal(f.live.has(4242), true, 'the unrelated process is never killed');
  fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(f.deps.root, 'installed.json'))), id: 'whalebridge', ready: true, pid: 4242, url: 'http://127.0.0.1:2222/?k=' + 'a'.repeat(32) }));
  assert.equal((await service.start()).ok, true);
  assert.notEqual(service.state().pid, 4242);
  assert.equal((await service.uninstall()).ok, true);
  assert.equal(f.killed.includes(4242), false);
});

test('a slow gateway is not mistaken for a stale record', async t => {
  const f = fixture(t); assert.equal((await f.service.install()).ok, true);
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const service = createWhaleBridgeService({ ...f.deps, fetchJson: async () => { throw timeout; } });
  const result = await service.stop();
  assert.equal(result.ok, false);
  assert.ok(service.state(), 'the running record stays');
  assert.equal(f.killed.length, 0);
});

test('a failed start reports the component error line instead of only pointing at the log', async t => {
  const f = fixture(t);
  const logFile = path.join(f.deps.root, 'data', 'component.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, 'an earlier run\n');
  const service = createWhaleBridgeService({ ...f.deps, spawn: () => {
    fs.appendFileSync(logFile, '鲸桥网关端口不可用: listen tcp 127.0.0.1:3427: bind: address already in use\n');
    const child = new EventEmitter(); child.pid = 7001; child.exitCode = 1; child.unref = () => {};
    return child;
  } });
  const result = await service.install();
  assert.equal(result.ok, false);
  assert.equal(result.message, '鲸桥已安装，但启动失败：鲸桥启动退出（1）：鲸桥网关端口不可用: listen tcp 127.0.0.1:3427: bind: address already in use');
  assert.equal(service.installed().version, '1.0.0');
  assert.equal(service.row().state, 'stopped');
  assert.doesNotMatch(result.message, /an earlier run/);
  assert.equal((await f.service.start()).ok, true);
});

test('the component log restarts once it outgrows its limit', async t => {
  const f = fixture(t);
  const logFile = path.join(f.deps.root, 'data', 'component.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, Buffer.alloc(1024 * 1024 + 1, 'x'));
  assert.equal((await f.service.install()).ok, true);
  assert.equal(fs.statSync(logFile).size, 0);
});

test('an empty operation lock from a crashed launcher is recovered once it is old', async t => {
  const f = fixture(t);
  const lock = path.join(f.deps.root, 'operation.lock');
  fs.mkdirSync(f.deps.root, { recursive: true });
  fs.writeFileSync(lock, '');
  assert.deepEqual(await f.service.install(), { ok: false, error: 'busy' });
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal((await f.service.install()).ok, true);
  assert.equal(fs.existsSync(lock), false);
});

test('a switch keeps only the active version and its rollback target', async t => {
  const f = fixture(t); assert.equal((await f.service.install()).ok, true);
  for (const version of ['1.0.1', '1.0.2', '1.0.3']) { f.publish(version); assert.equal((await f.service.update()).ok, true); }
  assert.deepEqual(fs.readdirSync(path.join(f.deps.root, 'versions')).sort(), ['1.0.2', '1.0.3']);
  assert.equal((await f.service.rollback()).ok, true);
  assert.deepEqual(fs.readdirSync(path.join(f.deps.root, 'versions')).sort(), ['1.0.2', '1.0.3']);
});

test('files are moved only after the killed process has really exited', async t => {
  const f = fixture(t); assert.equal((await f.service.install()).ok, true);
  const { pid } = f.service.state();
  let checks = 0;
  const lingering = createWhaleBridgeService({ ...f.deps,
    killPid: () => true,
    isPidAlive: value => value === process.pid || (value === pid && ++checks < 4),
  });
  assert.equal((await lingering.uninstall()).ok, true);
  assert.ok(checks >= 4);
  assert.equal((await f.service.install()).ok, true);
  const stuck = createWhaleBridgeService({ ...f.deps, killPid: () => true, exitTimeoutMs: 150 });
  const result = await stuck.uninstall();
  assert.equal(result.ok, false); assert.match(result.message, /未能退出/);
  assert.equal(stuck.installed().version, '1.0.0');
});

test('non-Windows hosts show WhaleBridge as unsupported without fetching a catalog', async t => {
  const f = fixture(t);
  let fetched = false;
  const service = createWhaleBridgeService({ ...f.deps, platform: 'darwin', arch: 'arm64', devPackage: '', fetchJson: async () => { fetched = true; } });
  const row = await service.refreshCatalog();
  assert.equal(row.state, 'unsupported'); assert.match(row.message, /Windows x64/);
  assert.equal(fetched, false);
  assert.match((await service.install()).message, /Windows x64/);
});
