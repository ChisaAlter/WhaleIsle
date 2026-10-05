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
