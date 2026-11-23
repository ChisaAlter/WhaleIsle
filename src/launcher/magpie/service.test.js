'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const { createMagpieService } = require('./service');
const { platformAssetName } = require('./platform');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function makeFakeSpawn({ failOnVersions = new Set(), onSpawn, onProcessRunningChange }) {
  let nextPid = 5000;
  return (bin, args, opts) => {
    const child = new EventEmitter();
    const version = path.basename(path.dirname(bin));
    const pid = ++nextPid;
    child.pid = pid;
    child.exitCode = null;
    child.unref = () => {};
    child.kill = () => {
      child.exitCode = 0;
      onProcessRunningChange?.(version, pid, false);
      return true;
    };
    onSpawn?.({ bin, args, opts, version, pid });
    if (failOnVersions.has(version)) {
      queueMicrotask(() => {
        child.exitCode = 1;
        child.emit('exit', 1);
      });
    } else {
      onProcessRunningChange?.(version, pid, true);
    }
    return child;
  };
}

test('createMagpieService handles install, start, concurrency guard, in-launcher update + rollback, and manual rollback', async () => {
  await withOwnedTempDir('magpie-svc-lifecycle-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const root = path.join(desktopStateDir, 'components', 'magpie');
    const dshHome = path.join(sandbox, 'dsh');
    const configDir = path.join(sandbox, 'config-magpie');
    const asset = platformAssetName('win32', 'x64');

    const v1Bytes = Buffer.from('magpie-cli-0.1.4708');
    const v2Bytes = Buffer.from('magpie-cli-0.1.4709');
    let upstreamVersion = '0.1.4708';
    const livePids = new Map(); // pid -> version
    let busyRequests = 0;
    const spawned = [];
    const quitRequests = [];

    const fetchImpl = async (url) => {
      const s = String(url);
      if (s === 'https://github.com/yetone/magpie/releases/latest') {
        return new Response('', {
          status: 302,
          headers: { location: `https://github.com/yetone/magpie/releases/tag/v${upstreamVersion}` },
        });
      }
      if (s.endsWith(`/v${upstreamVersion}/SHA256SUMS`)) {
        const buf = upstreamVersion === '0.1.4708' ? v1Bytes : v2Bytes;
        return new Response(`${sha256(buf)}  ${asset}\n`, { status: 200 });
      }
      if (s.endsWith('/boot.js')) {
        return new Response('boot', { status: livePids.size > 0 ? 200 : 503 });
      }
      if (s.endsWith('/api/window/quit?now=1')) {
        quitRequests.push(s);
        livePids.clear();
        return new Response('ok', { status: 200 });
      }
      return new Response('', { status: 404 });
    };

    const fetchJson = async (url) => {
      const s = String(url);
      if (s === 'http://127.0.0.1:3425/') {
        const entry = [...livePids.entries()][0];
        if (!entry) throw new Error('ECONNREFUSED');
        return { name: 'magpie', version: entry[1], pid: entry[0] };
      }
      if (s === 'http://127.0.0.1:3425/v1/magpie/concurrency') {
        return { requests: busyRequests, waiting: 0, tools: 0 };
      }
      if (s === 'http://127.0.0.1:3425/v1/models') {
        return { data: [{ id: 'gpt-5', api: 'openai-responses' }] };
      }
      throw new Error(`unexpected fetchJson ${s}`);
    };

    const downloadFile = async (url, dest) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const buf = String(url).includes('0.1.4709') ? v2Bytes : v1Bytes;
      fs.writeFileSync(dest, buf);
    };

    const svc = createMagpieService({
      desktopStateDir,
      root,
      dshHome,
      configDir,
      devPackage: '',
      platform: 'win32',
      arch: 'x64',
      isPidAlive: (pid) => livePids.has(pid),
      killPid: (pid) => livePids.delete(pid),
      killProcessTree: async (pid) => livePids.delete(pid),
      pickPort: async () => 3430,
      fetchImpl,
      fetchJson,
      downloadFile,
      readyTimeoutMs: 2000,
      exitTimeoutMs: 300,
      spawn: makeFakeSpawn({
        onSpawn: (info) => spawned.push(info),
        onProcessRunningChange: (ver, pid, up) => {
          if (up) livePids.set(pid, ver);
          else livePids.delete(pid);
        },
      }),
    });

    // Install v0.1.4708
    const installedRes = await svc.install();
    assert.equal(installedRes.ok, true);
    assert.equal(installedRes.component.installedVersion, '0.1.4708');
    assert.equal(installedRes.component.state, 'running');
    assert.equal(spawned[0].args.join(' '), 'web --addr 127.0.0.1:3430 --no-open');
    assert.equal(spawned[0].opts.env.DSH_HOME, dshHome);
    assert.equal(fs.statSync(path.join(root, 'versions', '0.1.4708', asset)).mode & 0o200, 0);

    // Concurrency guard blocks stop while active requests > 0
    busyRequests = 2;
    const blockedStop = await svc.stop();
    assert.equal(blockedStop.ok, false);
    assert.match(blockedStop.message, /正在处理请求/);
    busyRequests = 0;

    // Publish v0.1.4709 upstream -> refreshCatalog + in-launcher update
    upstreamVersion = '0.1.4709';
    const refreshed = await svc.refreshCatalog();
    assert.equal(refreshed.updateAvailable, true);
    assert.equal(refreshed.capabilities.canUpdate, true);

    const updated = await svc.update();
    assert.equal(updated.ok, true);
    assert.equal(updated.component.installedVersion, '0.1.4709');
    assert.equal(updated.component.previousVersion, '0.1.4708');
    assert.equal(updated.component.capabilities.canRollback, true);
    assert.ok(quitRequests.length >= 1);

    // Manual rollback back to v0.1.4708
    const rolledBack = await svc.rollback();
    assert.equal(rolledBack.ok, true);
    assert.equal(rolledBack.component.installedVersion, '0.1.4708');
    assert.equal(rolledBack.component.state, 'running');
  });
});

test('update rolls back to previous healthy version when newly staged version exits immediately on boot', async () => {
  await withOwnedTempDir('magpie-svc-autorollback-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const root = path.join(desktopStateDir, 'components', 'magpie');
    const dshHome = path.join(sandbox, 'dsh');
    const configDir = path.join(sandbox, 'config-magpie');
    const asset = platformAssetName('win32', 'x64');

    const v1Bytes = Buffer.from('magpie-0.1.4708');
    const v2Bytes = Buffer.from('magpie-0.1.4709-broken');
    let upstreamVersion = '0.1.4708';
    const livePids = new Map();

    const svc = createMagpieService({
      desktopStateDir,
      root,
      dshHome,
      configDir,
      devPackage: '',
      platform: 'win32',
      arch: 'x64',
      isPidAlive: (pid) => livePids.has(pid),
      killPid: (pid) => livePids.delete(pid),
      killProcessTree: async (pid) => livePids.delete(pid),
      pickPort: async () => 3432,
      readyTimeoutMs: 1000,
      exitTimeoutMs: 200,
      fetchImpl: async (url) => {
        const s = String(url);
        if (s.endsWith('/releases/latest')) {
          return new Response('', { status: 302, headers: { location: `https://github.com/yetone/magpie/releases/tag/v${upstreamVersion}` } });
        }
        if (s.endsWith(`/v${upstreamVersion}/SHA256SUMS`)) {
          const buf = upstreamVersion === '0.1.4708' ? v1Bytes : v2Bytes;
          return new Response(`${sha256(buf)}  ${asset}\n`, { status: 200 });
        }
        if (s.endsWith('/boot.js')) return new Response('boot', { status: livePids.size > 0 ? 200 : 503 });
        if (s.endsWith('/api/window/quit?now=1')) { livePids.clear(); return new Response('ok', { status: 200 }); }
        return new Response('', { status: 404 });
      },
      fetchJson: async (url) => {
        if (String(url).endsWith('/')) {
          const entry = [...livePids.entries()][0];
          if (!entry) throw new Error('offline');
          return { name: 'magpie', version: entry[1], pid: entry[0] };
        }
        if (String(url).endsWith('/concurrency')) return { requests: 0, waiting: 0, tools: 0 };
        return { data: [] };
      },
      downloadFile: async (url, dest) => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, String(url).includes('0.1.4709') ? v2Bytes : v1Bytes);
      },
      spawn: makeFakeSpawn({
        failOnVersions: new Set(['0.1.4709']),
        onProcessRunningChange: (ver, pid, up) => {
          if (up) livePids.set(pid, ver);
          else livePids.delete(pid);
        },
      }),
    });

    assert.equal((await svc.install()).ok, true);
    upstreamVersion = '0.1.4709';
    const failedUpdate = await svc.update();
    assert.equal(failedUpdate.ok, false);
    assert.match(failedUpdate.message, /已恢复原版本/);
    assert.equal(svc.installed().version, '0.1.4708');
    assert.equal(svc.row().state, 'running');
  });
});

test('external Magpie ownership blocks destructive lifecycle actions and returns official release URL on update', async () => {
  await withOwnedTempDir('magpie-svc-external-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const root = path.join(desktopStateDir, 'components', 'magpie');
    const configDir = path.join(sandbox, 'config-magpie');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ port: 3425 }));
    fs.writeFileSync(path.join(configDir, 'web-page.json'), JSON.stringify({ port: 3430, key: 'extk' }));
    const asset = platformAssetName('win32', 'x64');

    const svc = createMagpieService({
      desktopStateDir,
      root,
      dshHome: '',
      configDir,
      devPackage: '',
      platform: 'win32',
      arch: 'x64',
      fetchImpl: async (url) => {
        const s = String(url);
        if (s.endsWith('/releases/latest')) {
          return new Response('', { status: 302, headers: { location: 'https://github.com/yetone/magpie/releases/tag/v0.1.4710' } });
        }
        if (s.endsWith('/v0.1.4710/SHA256SUMS')) {
          return new Response(`${'e'.repeat(64)}  ${asset}\n`, { status: 200 });
        }
        if (s === 'http://127.0.0.1:3430/boot.js') return new Response('ok', { status: 200 });
        return new Response('', { status: 404 });
      },
      fetchJson: async (url) => {
        if (String(url) === 'http://127.0.0.1:3425/') return { name: 'magpie', version: '0.1.4708', pid: 8888 };
        throw new Error('unexpected');
      },
    });

    const row = await svc.refreshCatalog();
    assert.equal(row.ownership, 'external');
    assert.equal(row.updateAvailable, true);
    assert.equal(row.capabilities.canStop, false);
    assert.equal(row.capabilities.canUninstall, false);
    assert.equal(row.capabilities.canUpdate, false);
    assert.equal(row.capabilities.externalUpdateUrl, 'https://github.com/yetone/magpie/releases/tag/v0.1.4710');

    const updateRes = await svc.update();
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.externalUrl, 'https://github.com/yetone/magpie/releases/tag/v0.1.4710');

    const stopRes = await svc.stop();
    assert.equal(stopRes.ok, false);
    assert.match(stopRes.message, /外部 Magpie/);

    const uninstallRes = await svc.uninstall();
    assert.equal(uninstallRes.ok, false);
    assert.match(uninstallRes.message, /外部 Magpie/);
  });
});
