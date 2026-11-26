'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { withOwnedTempDir } = require('../../shared/fs-safe');
const { createMagpieService } = require('./service');
const { stageMagpieBinary } = require('./runtime');
const { platformAssetName } = require('./platform');
const { renameWithRetrySync } = require('../../shared/fs-safe');
const { windowsProcessStartTime } = require('../../shared/process-tree');
const migrate = require('./migrate');

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
        return new Response('boot', {
          status: livePids.size > 0 ? 200 : 503,
          headers: { 'content-type': 'application/javascript' },
        });
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
    assert.equal(spawned[0].opts.cwd, root);
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

    // Uninstall cleanly stops and deletes read-only versions/ dir
    const uninstalled = await svc.uninstall({ removeData: true });
    assert.equal(uninstalled.ok, true);
    assert.equal(fs.existsSync(path.join(root, 'versions')), false);
    assert.equal(fs.existsSync(path.join(root, 'installed.json')), false);
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
        if (s.endsWith('/boot.js')) return new Response('boot', { status: livePids.size > 0 ? 200 : 503, headers: { 'content-type': 'application/javascript' } });
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
        if (s === 'http://127.0.0.1:3430/boot.js') return new Response('ok', { status: 200, headers: { 'content-type': 'application/javascript' } });
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

test('assertIdleBeforeStop fails closed when concurrency probe fails, and rollback resyncs DSH', async () => {
  await withOwnedTempDir('magpie-svc-failclosed-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const root = path.join(desktopStateDir, 'components', 'magpie');
    const dshHome = path.join(sandbox, 'dsh');
    const configDir = path.join(sandbox, 'config-magpie');
    const asset = platformAssetName('win32', 'x64');
    const v1Bytes = Buffer.from('magpie-0.1.4708');
    const v2Bytes = Buffer.from('magpie-0.1.4709-broken');
    let upstreamVersion = '0.1.4708';
    const livePids = new Map();
    let probeShouldFail = false;
    let pickPortNum = 3440;
    const syncedAddrs = [];

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
      pickPort: async () => ++pickPortNum,
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
        if (s.endsWith('/boot.js')) return new Response('boot', { status: livePids.size > 0 ? 200 : 503, headers: { 'content-type': 'application/javascript' } });
        if (s.endsWith('/api/window/quit?now=1')) { livePids.clear(); return new Response('ok', { status: 200 }); }
        return new Response('', { status: 404 });
      },
      fetchJson: async (url) => {
        const s = String(url);
        if (s === 'http://127.0.0.1:3425/') {
          const entry = [...livePids.entries()][0];
          if (!entry) throw new Error('offline');
          return { name: 'magpie', version: entry[1], pid: entry[0] };
        }
        if (s === 'http://127.0.0.1:3425/v1/magpie/concurrency') {
          if (probeShouldFail) throw new Error('ETIMEDOUT');
          return { requests: 0, waiting: 0, tools: 0 };
        }
        if (s === 'http://127.0.0.1:3425/v1/models') {
          syncedAddrs.push(s);
          return { data: [{ id: 'm1', api: 'openai-completions' }] };
        }
        throw new Error(`unexpected ${s}`);
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
    const syncCountBefore = syncedAddrs.length;

    // 1. Fail-closed stop when concurrency probe times out / errors
    probeShouldFail = true;
    const stopBlocked = await svc.stop();
    assert.equal(stopBlocked.ok, false);
    assert.match(stopBlocked.message, /无法确认 Magpie 并发状态/);
    assert.equal(livePids.size, 1);

    // 2. Rollback after failed update re-syncs DSH
    probeShouldFail = false;
    upstreamVersion = '0.1.4709';
    const updFailed = await svc.update();
    assert.equal(updFailed.ok, false);
    assert.match(updFailed.message, /已恢复原版本/);
    assert.ok(syncedAddrs.length > syncCountBefore, 'rollback restart must resync DSH');

    // 3. Uninstall with removeData preserves unrecognized user files in configDir
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'custom-user.txt'), 'keep');
    const uninst = await svc.uninstall({ removeData: true });
    assert.equal(uninst.ok, true);
    assert.equal(fs.readFileSync(path.join(configDir, 'custom-user.txt'), 'utf8'), 'keep');
  });
});

test('stageMagpieBinary retries transient rename failures and restores backup targetDir on swap failure', async () => {
  await withOwnedTempDir('magpie-stage-backup-', async (sandbox) => {
    const root = path.join(sandbox, 'magpie');
    const localDir = path.join(sandbox, 'pkg');
    fs.mkdirSync(localDir, { recursive: true });
    const asset = platformAssetName('win32', 'x64');
    const oldBytes = Buffer.from('old-magpie-binary');
    const newBytes = Buffer.from('new-magpie-binary');
    fs.writeFileSync(path.join(localDir, asset), newBytes);

    const targetDir = path.join(root, 'versions', '0.1.5000');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, asset), oldBytes);
    fs.writeFileSync(path.join(targetDir, 'marker.txt'), 'original');

    // 1. Transient EACCES during swap retries and succeeds, removing .backup-*
    let swapAttempts = 0;
    await stageMagpieBinary({
      root,
      platform: 'win32',
      emit: () => {},
      release: { id: 'magpie', version: '0.1.5000', asset, sha256: sha256(newBytes), localDir },
      renameSync: (from, to) => renameWithRetrySync(from, to, {
        platform: 'win32',
        sleep: () => {},
        rename: (a, b) => {
          if (b === targetDir) {
            swapAttempts += 1;
            if (swapAttempts === 1) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
          }
          fs.renameSync(a, b);
        },
      }),
    });
    assert.equal(swapAttempts, 2);
    assert.equal(fs.readFileSync(path.join(targetDir, asset)).toString(), 'new-magpie-binary');
    assert.equal(fs.existsSync(path.join(root, 'versions', `.backup-${process.pid}`)), false);

    // 2. Persistent swap failure rolls back original targetDir intact
    fs.writeFileSync(path.join(targetDir, 'keep-me.txt'), 'intact');
    await assert.rejects(
      () => stageMagpieBinary({
        root,
        platform: 'win32',
        emit: () => {},
        release: { id: 'magpie', version: '0.1.5000', asset, sha256: sha256(newBytes), localDir },
        renameSync: (from, to) => {
          if (to === targetDir && from.includes('.staging-')) {
            throw Object.assign(new Error('persistent EPERM'), { code: 'EPERM' });
          }
          fs.renameSync(from, to);
        },
      }),
      /persistent EPERM/,
    );
    assert.equal(fs.readFileSync(path.join(targetDir, 'keep-me.txt'), 'utf8'), 'intact');
    assert.equal(fs.existsSync(path.join(root, 'versions', `.backup-${process.pid}`)), false);
  });
});

test('operation.lock reclaims PID-reused stale lock via atomic rename, isolates stage from concurrent refreshCatalog error, and orders inspect generations', async () => {
  await withOwnedTempDir('magpie-lock-race-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const root = path.join(desktopStateDir, 'components', 'magpie');
    const dshHome = path.join(sandbox, 'dsh');
    const configDir = path.join(sandbox, 'config-magpie');
    const asset = platformAssetName('win32', 'x64');
    const v1Bytes = Buffer.from('magpie-lock-v1');
    fs.mkdirSync(root, { recursive: true });

    // Stale lock using our own live PID but a mismatched startTime -> must be reclaimed (anti-PID-reuse)
    const lockFile = path.join(root, 'operation.lock');
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      startTime: '1999-01-01T00:00:00.0000000Z',
      createdAt: '1999-01-01T00:00:00.000Z',
    }));

    let releaseFirstInspect;
    let inspectCall = 0;
    let firstFetchCall = true;
    const livePids = new Map();

    const svc = createMagpieService({
      desktopStateDir,
      root,
      dshHome,
      configDir,
      devPackage: '',
      platform: 'win32',
      arch: 'x64',
      isPidAlive: (pid) => pid === process.pid || livePids.has(pid),
      killPid: (pid) => livePids.delete(pid),
      killProcessTree: async (pid) => livePids.delete(pid),
      pickPort: async () => 3435,
      readyTimeoutMs: 1500,
      exitTimeoutMs: 200,
      fetchImpl: async (url) => {
        const s = String(url);
        if (s.endsWith('/releases/latest')) {
          if (firstFetchCall) {
            firstFetchCall = false;
            return new Response('', { status: 302, headers: { location: 'https://github.com/yetone/magpie/releases/tag/v0.1.4800' } });
          }
          throw new Error('concurrent catalog refresh offline');
        }
        if (s.endsWith('/v0.1.4800/SHA256SUMS')) {
          return new Response(`${sha256(v1Bytes)}  ${asset}\n`, { status: 200 });
        }
        if (s.endsWith('/boot.js')) {
          return new Response('boot', { status: livePids.size > 0 ? 200 : 503, headers: { 'content-type': 'application/javascript' } });
        }
        if (s.endsWith('/api/window/quit?now=1')) {
          livePids.clear();
          return new Response('ok', { status: 200 });
        }
        return new Response('', { status: 404 });
      },
      fetchJson: async (url) => {
        const s = String(url);
        if (s === 'http://127.0.0.1:3425/') {
          const entry = [...livePids.entries()][0];
          if (!entry) throw new Error('offline');
          return { name: 'magpie', version: entry[1], pid: entry[0] };
        }
        if (s.endsWith('/concurrency')) return { requests: 0, waiting: 0, tools: 0 };
        if (s.endsWith('/v1/models')) return { data: [] };
        throw new Error(`unexpected ${s}`);
      },
      downloadFile: async (_url, dest) => {
        // Trigger a failing concurrent refreshCatalog while download is in progress
        await svc.refreshCatalog();
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, v1Bytes);
      },
      spawn: makeFakeSpawn({
        onProcessRunningChange: (ver, pid, up) => {
          if (up) livePids.set(pid, ver);
          else livePids.delete(pid);
        },
      }),
    });

    // When lock is reclaimed on Windows, it checks windowsProcessStartTime(process.pid) != 1999-...
    if (process.platform === 'win32') {
      assert.ok(windowsProcessStartTime(process.pid));
      const res = await svc.install();
      assert.equal(res.ok, true, `reclaimed stale lock and ignored concurrent catalog failure: ${res.message}`);
    } else {
      fs.unlinkSync(lockFile);
      const res = await svc.install();
      assert.equal(res.ok, true);
    }
    assert.equal(fs.existsSync(lockFile), false);

    // Generation guard in inspect(): older slow inspect must not overwrite newer inspect result
    let gwVersion = '0.1.4800';
    const svcGen = createMagpieService({
      desktopStateDir,
      root,
      dshHome,
      configDir,
      devPackage: '',
      platform: 'win32',
      arch: 'x64',
      fetchImpl: async () => new Response('', { status: 404 }),
      fetchJson: async (url) => {
        if (String(url) === 'http://127.0.0.1:3425/') {
          inspectCall += 1;
          if (inspectCall === 1) {
            await new Promise((resolve) => { releaseFirstInspect = resolve; });
            return { name: 'magpie', version: '0.1.0001', pid: 9991 };
          }
          return { name: 'magpie', version: gwVersion, pid: 9992 };
        }
        throw new Error('offline');
      },
    });
    const slowInspect = svcGen.inspect();
    await new Promise((resolve) => setTimeout(resolve, 20));
    gwVersion = '0.1.9999';
    await svcGen.inspect();
    releaseFirstInspect();
    await slowInspect;
    assert.equal(svcGen.row().installedVersion, '0.1.9999');

    await svc.uninstall({ removeData: true });
  });
});

test('rollback validates payload before stopping, switchManagedVersion stops unreachable-gateway managed PID, and stop fails closed via managed.gatewayAddr', async (t) => {
  await withOwnedTempDir('magpie-svc-guards-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const root = path.join(desktopStateDir, 'components', 'magpie');
    const dshHome = path.join(sandbox, 'dsh');
    const configDir = path.join(sandbox, 'config-magpie');
    const asset = platformAssetName('win32', 'x64');
    const v1Bytes = Buffer.from('magpie-v1');
    const v2Bytes = Buffer.from('magpie-v2');
    let upstreamVersion = '0.1.4708';
    const livePids = new Map();
    let gatewayReachable = true;
    let concurrencyShouldFail = false;
    const quitCalls = [];

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
      pickPort: async () => 3436,
      readyTimeoutMs: 1500,
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
        if (s.endsWith('/boot.js')) return new Response('boot', { status: livePids.size > 0 ? 200 : 503, headers: { 'content-type': 'application/javascript' } });
        if (s.endsWith('/api/window/quit?now=1')) {
          quitCalls.push(s);
          livePids.clear();
          return new Response('ok', { status: 200 });
        }
        return new Response('', { status: 404 });
      },
      fetchJson: async (url) => {
        const s = String(url);
        if (s === 'http://127.0.0.1:3425/') {
          if (!gatewayReachable) throw new Error('ECONNREFUSED');
          const entry = [...livePids.entries()][0];
          if (!entry) throw new Error('offline');
          return { name: 'magpie', version: entry[1], pid: entry[0] };
        }
        if (s.endsWith('/concurrency')) {
          if (concurrencyShouldFail) throw new Error('ETIMEDOUT');
          return { requests: 0, waiting: 0, tools: 0 };
        }
        if (s.endsWith('/v1/models')) return { data: [] };
        throw new Error(`unexpected ${s}`);
      },
      downloadFile: async (url, dest) => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, String(url).includes('0.1.4709') ? v2Bytes : v1Bytes);
      },
      spawn: makeFakeSpawn({
        onProcessRunningChange: (ver, pid, up) => {
          if (up) livePids.set(pid, ver);
          else livePids.delete(pid);
        },
      }),
    });

    assert.equal((await svc.install()).ok, true);
    upstreamVersion = '0.1.4709';
    assert.equal((await svc.update()).ok, true);

    // 1. Gateway unreachable while managed PID is alive: stop() must fall back to managed.gatewayAddr & fail closed
    gatewayReachable = false;
    concurrencyShouldFail = true;
    const blocked = await svc.stop();
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /无法确认 Magpie 并发状态/);
    assert.equal(livePids.size, 1);

    // 2. When concurrency is idle while gateway / is unreachable, update/rollback still stops live managed PID
    concurrencyShouldFail = false;
    gatewayReachable = true;
    // Remove previous binary to test pre-stop payload check on rollback
    const prevBin = path.join(root, 'versions', '0.1.4708', asset);
    fs.chmodSync(prevBin, 0o644);
    fs.unlinkSync(prevBin);
    const quitBeforeMissing = quitCalls.length;
    const missingRollback = await svc.rollback();
    assert.equal(missingRollback.ok, false);
    assert.match(missingRollback.message, /文件缺失/);
    assert.equal(quitCalls.length, quitBeforeMissing, 'missing rollback payload must fail before stopping process');

    // 3. Uninstall preserves installed.json if versions removal throws EBUSY
    const realRmSync = fs.rmSync.bind(fs);
    t.mock.method(fs, 'rmSync', (target, opts) => {
      if (String(target) === path.join(root, 'versions')) {
        throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      }
      return realRmSync(target, opts);
    });
    const failedUninstall = await svc.uninstall();
    assert.equal(failedUninstall.ok, false);
    assert.ok(svc.installed(), 'installed.json must survive failed versions dir removal');
  });
});

test('install stops newly spawned process on syncDshAndRemap failure, stopCompanion serializes with locked ops, and legacy reconcile runs non-blocking', async (t) => {
  await withOwnedTempDir('magpie-svc-sync-fail-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const root = path.join(desktopStateDir, 'components', 'magpie');
    const dshHome = path.join(sandbox, 'dsh');
    const configDir = path.join(sandbox, 'config-magpie');
    const asset = platformAssetName('win32', 'x64');
    const v1Bytes = Buffer.from('magpie-sync-fail');
    const livePids = new Map();
    let modelsFail = true;
    const reconcileCalls = [];

    t.mock.method(migrate, 'reconcileLegacyWhaleBridgeDir', async (arg) => {
      reconcileCalls.push(arg);
      throw new Error('non-blocking reconcile error');
    });

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
      pickPort: async () => 3437,
      readyTimeoutMs: 1500,
      exitTimeoutMs: 200,
      fetchImpl: async (url) => {
        const s = String(url);
        if (s.endsWith('/releases/latest')) {
          return new Response('', { status: 302, headers: { location: 'https://github.com/yetone/magpie/releases/tag/v0.1.4708' } });
        }
        if (s.endsWith('/v0.1.4708/SHA256SUMS')) {
          return new Response(`${sha256(v1Bytes)}  ${asset}\n`, { status: 200 });
        }
        if (s.endsWith('/boot.js')) return new Response('boot', { status: livePids.size > 0 ? 200 : 503, headers: { 'content-type': 'application/javascript' } });
        if (s.endsWith('/api/window/quit?now=1')) { livePids.clear(); return new Response('ok', { status: 200 }); }
        return new Response('', { status: 404 });
      },
      fetchJson: async (url) => {
        const s = String(url);
        if (s === 'http://127.0.0.1:3425/') {
          const entry = [...livePids.entries()][0];
          if (!entry) throw new Error('offline');
          return { name: 'magpie', version: entry[1], pid: entry[0] };
        }
        if (s.endsWith('/concurrency')) return { requests: 0, waiting: 0, tools: 0 };
        if (s.endsWith('/v1/models')) {
          if (modelsFail) throw new Error('HTTP 500');
          return { data: [{ id: 'm1', api: 'openai-completions' }] };
        }
        throw new Error(`unexpected ${s}`);
      },
      downloadFile: async (_url, dest) => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, v1Bytes);
      },
      spawn: makeFakeSpawn({
        onProcessRunningChange: (ver, pid, up) => {
          if (up) livePids.set(pid, ver);
          else livePids.delete(pid);
        },
      }),
    });

    await svc.refreshCatalog();
    assert.equal(reconcileCalls.length, 1);

    const failInstall = await svc.install();
    assert.equal(failInstall.ok, false);
    assert.match(failInstall.message, /渠道同步失败/);
    assert.equal(livePids.size, 0, 'newly spawned managed process must be stopped when DSH sync fails');
    assert.equal(svc.row().state, 'stopped');

    // Start succeeds once /v1/models recovers and triggers non-blocking reconcile tail call
    modelsFail = false;
    const okStart = await svc.start();
    assert.equal(okStart.ok, true);
    assert.equal(reconcileCalls.length, 2);

    // stopCompanion waits behind an active locked op instead of returning busy
    fs.writeFileSync(path.join(root, 'companion-state.json'), JSON.stringify({
      pid: 7777, version: '0.1.4708', webPort: 3437, webKey: 'k', webUrl: 'http://127.0.0.1:3437/?k=k',
    }));
    livePids.set(7777, '0.1.4708');
    const stopAll = svc.stop();
    const stopComp = svc.stopCompanion();
    assert.equal((await stopAll).ok, true);
    assert.equal((await stopComp).ok, true);
    assert.equal(livePids.has(7777), false);
  });
});

test('waitForMagpieReady aborts immediately on child signalCode or foreign gw.pid', async () => {
  await withOwnedTempDir('magpie-ready-signal-', async (sandbox) => {
    const desktopStateDir = path.join(sandbox, 'state');
    const root = path.join(desktopStateDir, 'components', 'magpie');
    const dshHome = path.join(sandbox, 'dsh');
    const configDir = path.join(sandbox, 'config-magpie');
    const asset = platformAssetName('win32', 'x64');
    const v1Bytes = Buffer.from('magpie-signal-test');

    let spawnMode = 'signal';
    let spawnedOnce = false;
    const svc = createMagpieService({
      desktopStateDir,
      root,
      dshHome,
      configDir,
      devPackage: '',
      platform: 'win32',
      arch: 'x64',
      isPidAlive: () => false,
      killPid: () => true,
      killProcessTree: async () => true,
      pickPort: async () => 3438,
      readyTimeoutMs: 5000,
      fetchImpl: async (url) => {
        const s = String(url);
        if (s.endsWith('/releases/latest')) {
          return new Response('', { status: 302, headers: { location: 'https://github.com/yetone/magpie/releases/tag/v0.1.4708' } });
        }
        if (s.endsWith('/v0.1.4708/SHA256SUMS')) {
          return new Response(`${sha256(v1Bytes)}  ${asset}\n`, { status: 200 });
        }
        if (s.endsWith('/boot.js')) return new Response('boot', { status: spawnedOnce ? 200 : 503, headers: { 'content-type': 'application/javascript' } });
        return new Response('', { status: 404 });
      },
      fetchJson: async (url) => {
        if (String(url) === 'http://127.0.0.1:3425/') {
          if (!spawnedOnce) throw new Error('offline');
          return { name: 'magpie', version: '0.1.4708', pid: 99999 };
        }
        return { data: [] };
      },
      downloadFile: async (_url, dest) => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, v1Bytes);
      },
      spawn: () => {
        spawnedOnce = true;
        const child = new EventEmitter();
        child.pid = 6001;
        child.exitCode = null;
        child.signalCode = null;
        child.unref = () => {};
        child.kill = () => true;
        if (spawnMode === 'signal') {
          queueMicrotask(() => {
            child.signalCode = 'SIGKILL';
            child.emit('exit', null, 'SIGKILL');
          });
        }
        return child;
      },
    });

    const t0 = Date.now();
    const sigRes = await svc.install();
    assert.equal(sigRes.ok, false);
    assert.match(sigRes.message, /SIGKILL/);
    assert.ok(Date.now() - t0 < 1500, 'signal exit must abort immediately without waiting for readyTimeoutMs');

    spawnMode = 'foreign-pid';
    spawnedOnce = false;
    const foreignRes = await svc.start();
    assert.equal(foreignRes.ok, false);
    assert.match(foreignRes.message, /已被其他进程.*99999/);
  });
});
