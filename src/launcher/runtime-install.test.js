'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const releaseSource = require('./release-source');
const runtimeInstall = require('./runtime-install');
const installDetect = require('./install-detect');
const update = require('../main/update');

// Release summaries read the host platform; each asset fixture pins its target
// and restores the real host before the next test.
function useReleasePlatform(t, platform, arch = process.arch) {
  const previousPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const previousArch = Object.getOwnPropertyDescriptor(process, 'arch');
  Object.defineProperty(process, 'platform', { ...previousPlatform, value: platform });
  Object.defineProperty(process, 'arch', { ...previousArch, value: arch });
  t.after(() => {
    Object.defineProperty(process, 'platform', previousPlatform);
    Object.defineProperty(process, 'arch', previousArch);
  });
}

// --- release-source routes --------------------------------------------------

test('normalizeRoute accepts known ids only', () => {
  assert.equal(releaseSource.normalizeRoute('github'), 'github');
  assert.equal(releaseSource.normalizeRoute('Gitee'), 'gitee');
  assert.equal(releaseSource.normalizeRoute(''), '');
  assert.equal(releaseSource.normalizeRoute('gitlab'), '');
  assert.equal(releaseSource.normalizeRoute(undefined), '');
});

test('listRoutes exposes both mirrors; both verified after anonymous parity evidence', () => {
  const routes = releaseSource.listRoutes();
  const github = routes.find((row) => row.id === 'github');
  const gitee = routes.find((row) => row.id === 'gitee');
  assert.equal(github.verified, true);
  assert.equal(gitee.verified, true);
  assert.match(gitee.page, /gitee\.com/);
});

test('latestFor(github) normalizes a release snapshot against installedVersion', async (t) => {
  useReleasePlatform(t, 'win32');
  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /api\.github\.com/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/x/releases/v9.9.9',
        body: 'notes',
        assets: [
          { name: 'Deepseek-Harness-Desktop-Setup-9.9.9.exe', browser_download_url: 'https://github.com/dl/setup.exe' },
          { name: 'SHA512SUMS.txt', browser_download_url: 'https://github.com/dl/sums.txt' },
        ],
      }),
    };
  };
  try {
    const check = await releaseSource.latestFor('github', { installedVersion: '1.0.0' });
    assert.equal(check.status, 'available');
    assert.equal(check.latest, '9.9.9');
    assert.equal(check.assetUrl, 'https://github.com/dl/setup.exe');
    assert.equal(check.checksumUrl, 'https://github.com/dl/sums.txt');
    assert.equal(check.route, 'github');
    const current = await releaseSource.latestFor('github', { installedVersion: '9.9.9' });
    assert.equal(current.status, 'current');
  } finally {
    global.fetch = previousFetch;
  }
});

test('latestFor(gitee) only touches gitee hosts and normalizes download_url assets', async (t) => {
  useReleasePlatform(t, 'win32');
  const previousFetch = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    const target = String(url);
    seen.push(target);
    assert.match(target, /gitee\.com/, 'gitee route must not query github');
    assert.equal(new URL(target).searchParams.get('direction'), 'desc');
    // Gitee's /latest returns prereleases, so the route reads the list and
    // skips draft/prerelease rows — the mock serves a newer prerelease first
    // plus the expected stable row to pin that behavior.
    return {
      ok: true,
      status: 200,
      json: async () => ([
        { tag_name: 'v9.9.9-beta', prerelease: true, assets: [] },
        { tag_name: 'v1.0.0', prerelease: false, assets: [] },
        {
          tag_name: 'v2.0.0',
          name: 'v2.0.0',
          body: '',
          assets: [
            { name: 'Deepseek-Harness-Desktop-Setup-2.0.0.exe', download_url: 'https://gitee.com/ayase/x/releases/download/v2.0.0/setup.exe' },
          ],
        },
      ]),
    };
  };
  try {
    const check = await releaseSource.latestFor('gitee', { installedVersion: '1.0.0' });
    assert.equal(check.status, 'available');
    assert.equal(check.route, 'gitee');
    assert.equal(check.assetUrl, 'https://gitee.com/ayase/x/releases/download/v2.0.0/setup.exe');
    assert.ok(seen.every((url) => url.includes('gitee.com')));
  } finally {
    global.fetch = previousFetch;
  }
});

test('Gitee version list and direct tag lookup hide incomplete prerelease mirrors', async (t) => {
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async (url) => ({ ok: true, status: 200, json: async () => {
    if (String(url).includes('/tags/')) return { tag_name: 'v2.0.0', prerelease: true, assets: [] };
    assert.equal(new URL(url).searchParams.get('direction'), 'desc');
    return [{ tag_name: 'v2.0.0', prerelease: true, assets: [] }, { tag_name: 'v1.0.0', prerelease: false, assets: [] }];
  } });
  assert.equal((await releaseSource.listFor('gitee')).releases.length, 1);
  assert.equal(await releaseSource.releaseFor('gitee', 'v2.0.0'), null);
});

test('listFor rows attach delta info only for the installed→to pair', async (t) => {
  useReleasePlatform(t, 'win32');
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ([
      {
        tag_name: 'v2.0.0',
        name: 'v2.0.0',
        published_at: '2026-09-19T06:00:27Z',
        assets: [
          { name: 'Deepseek-Harness-Desktop-Setup-2.0.0.exe', browser_download_url: 'https://github.com/dl/setup.exe', size: 100 },
          { name: 'Whale-Isle-delta-1.0.0-2.0.0.zip', browser_download_url: 'https://github.com/dl/delta.zip', size: 12 },
          { name: 'Whale-Isle-delta-9.9.9-2.0.0.zip', browser_download_url: 'https://github.com/dl/other.zip', size: 34 },
        ],
      },
      {
        tag_name: 'v1.5.0',
        name: 'v1.5.0',
        assets: [
          { name: 'Deepseek-Harness-Desktop-Setup-1.5.0.exe', browser_download_url: 'https://github.com/dl/setup-1.5.exe' },
        ],
      },
    ]),
  });
  try {
    const list = await releaseSource.listFor('github', { installedVersion: '1.0.0' });
    assert.equal(list.status, 'ok');
    assert.equal(list.releases.length, 2);
    assert.deepEqual(list.releases[0].delta, {
      name: 'Whale-Isle-delta-1.0.0-2.0.0.zip',
      from: '1.0.0',
      to: '2.0.0',
      size: 12,
    });
    assert.equal(list.releases[1].delta, null);
    // Row meta fields feeding the prototype's "date · full-package size" line.
    assert.equal(list.releases[0].publishedAt, '2026-09-19T06:00:27Z');
    assert.equal(list.releases[0].assetSize, 100);
  } finally {
    global.fetch = previousFetch;
  }
});

test('macOS release routes select the matching DMG from mixed-platform assets', async (t) => {
  useReleasePlatform(t, 'darwin', 'arm64');
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  const assets = ['Setup.exe', 'Whale-Isle-mac-x64.dmg', 'Whale-Isle-mac-arm64.dmg']
    .map((name) => ({ name, download_url: `https://example.test/${name}`, size: name.endsWith('arm64.dmg') ? 200 : 100 }));
  const release = { tag_name: 'v2.0.0', assets };
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).includes('/latest') ? release : [release],
  });
  const latest = await releaseSource.latestFor('github', { installedVersion: '1.0.0' });
  assert.equal(latest.status, 'available');
  assert.equal(latest.assetName, 'Whale-Isle-mac-arm64.dmg');
  assert.equal(latest.assetUrl, 'https://example.test/Whale-Isle-mac-arm64.dmg');
  const list = await releaseSource.listFor('gitee', { installedVersion: '1.0.0' });
  assert.equal(list.releases[0].assetName, latest.assetName);
  assert.equal(list.releases[0].assetUrl, latest.assetUrl);
  assert.equal(list.releases[0].assetSize, 200);
});

test('releaseFor returns null on 404 and an error shape on failure', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  try {
    assert.equal(await releaseSource.releaseFor('github', 'v0.0.0'), null);
  } finally {
    global.fetch = previousFetch;
  }
  global.fetch = async () => { throw new Error('offline'); };
  try {
    const check = await releaseSource.latestFor('github', {});
    assert.equal(check.status, 'error');
    assert.match(check.message, /offline/);
  } finally {
    global.fetch = previousFetch;
  }
});

// --- install-detect target ---------------------------------------------------

test('getInstalledAppInfo with an explicit target never claims the running process', () => {
  const calls = [];
  const info = installDetect.getInstalledAppInfo({
    isPackaged: true,
    platform: 'win32',
    target: { appId: 'com.example.launcher', productName: 'DSHD-Launcher' },
    existsSync: () => false,
    execFileSync: (...args) => {
      calls.push(args);
      throw new Error('missing');
    },
  });
  assert.equal(info.registeredInstall, false);
  // The target's version/path come only from the registry — a missing record
  // means unknown, not the running launcher's own version/dir.
  assert.equal(info.version, '');
  assert.equal(info.installPath, '');
  // Registry probes must key off the target appId, not the desktop identity.
  assert.ok(calls.some((args) => String(args[1]?.join(' ')).includes('com.example.launcher')));
});

test('probeDesktopProcess matches the target image name', () => {
  const seen = [];
  const found = installDetect.probeDesktopProcess({
    platform: 'win32',
    target: { appId: 'x', productName: 'MyApp' },
    execFileSync: (bin, args) => {
      seen.push([bin, ...args].join(' '));
      return '"MyApp.exe","1234","Console","1","100 K"';
    },
  });
  assert.equal(found, true);
  assert.ok(seen[0].includes('MyApp.exe'));
});

// --- runtime-install orchestration -------------------------------------------

function fakeUpdate({ installFromAsset }) {
  return { installFromAsset };
}

function fakeSource({ latest, byTag } = {}) {
  return {
    ROUTES: releaseSource.ROUTES,
    normalizeRoute: releaseSource.normalizeRoute,
    latestFor: async () => latest ?? {
      status: 'available',
      latest: '2.0.0',
      tag: 'v2.0.0',
      assetUrl: 'https://example.test/setup.exe',
      assetName: 'Setup.exe',
      checksumUrl: 'https://example.test/sums.txt',
    },
    releaseFor: async () => byTag ?? null,
    listFor: async () => ({ status: 'ok', releases: [] }),
  };
}

function installerChild() {
  const child = new EventEmitter();
  child.unref = () => {};
  return child;
}

test('installRuntime resolves through the route, installs, and adopts the new registration', async () => {
  const progress = [];
  const seen = {};
  let polls = 0;
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    loadConfig: () => ({ downloadRoute: 'github' }),
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async (info, onProgress, options) => {
        seen.info = info;
        seen.options = options;
        options.onInstallerLaunch(installerChild());
        return { ...info, launched: true, installer: 'C:\\tmp\\Setup.exe' };
      },
    }),
    installedInfo: () => {
      polls += 1;
      // First call is the pre-install baseline; polls afterwards see the
      // settled registration.
      if (polls === 1) {
        return { registeredInstall: false, installPath: '', version: '' };
      }
      return { registeredInstall: true, installPath: 'C:\\Apps\\DSHD', version: '2.0.0' };
    },
    existsSync: () => true,
    statSync: () => ({ mtimeMs: 1 }),
    pollMs: 10,
    waitMs: 5000,
  };
  const result = await runtimeInstall.installRuntime({ route: 'github' }, (p) => progress.push(p), deps);
  assert.equal(result.status, 'installed');
  assert.equal(result.installed.version, '2.0.0');
  // Slim package must not quit itself to let an installer replace it.
  assert.equal(seen.options.quitAfterInstall, false);
  assert.equal(typeof seen.options.signal?.aborted, 'boolean');
  assert.ok(progress.some((p) => p.phase === 'resolve'));
});

test('installRuntime maps a mid-download abort to a cancelled result', async () => {
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async (_info, _onProgress, options) => {
        const error = update.cancelledError();
        options.signal.dispatchEvent(new Event('abort'));
        throw error;
      },
    }),
    installedInfo: () => ({ registeredInstall: false }),
  };
  const result = await runtimeInstall.installRuntime({}, null, deps);
  assert.equal(result.cancelled, true);
  assert.equal(result.status, 'cancelled');
});

test('installRuntime passes through a declined unverified install', async () => {
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async (info) => ({ ...info, launched: false, declined: true, unverified: true }),
    }),
    installedInfo: () => ({ registeredInstall: false }),
  };
  const result = await runtimeInstall.installRuntime({}, null, deps);
  assert.equal(result.ok, false);
  assert.equal(result.declined, true);
});

test('installRuntime refuses a second concurrent install', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async () => {
        await gate;
        return { launched: true, installer: 'x' };
      },
    }),
    installedInfo: () => ({ registeredInstall: false }),
    pollMs: 10,
    waitMs: 60,
  };
  const first = runtimeInstall.installRuntime({}, null, deps);
  const second = await runtimeInstall.installRuntime({}, null, deps);
  assert.equal(second.error, 'install-in-progress');
  release();
  const firstResult = await first;
  assert.equal(firstResult.status, 'waiting');
});

test('installRuntime reports waiting when the registration never settles', async () => {
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    releaseSource: fakeSource(),
    update: fakeUpdate({
      installFromAsset: async (info, _onProgress, options) => {
        options.onInstallerLaunch(installerChild());
        return { ...info, launched: true, installer: 'x' };
      },
    }),
    installedInfo: () => ({ registeredInstall: false }),
    existsSync: () => false,
    pollMs: 10,
    waitMs: 60,
  };
  const result = await runtimeInstall.installRuntime({}, null, deps);
  assert.equal(result.status, 'waiting');
});

// --- checkDesktopUpdate --------------------------------------------------------

test('checkDesktopUpdate clamps available→none when no runtime is installed', async () => {
  const deps = {
    loadConfig: () => ({ downloadRoute: 'github' }),
    releaseSource: fakeSource(),
    installedInfo: () => ({ registeredInstall: false, version: '' }),
  };
  const missing = await runtimeInstall.checkDesktopUpdate({}, deps);
  assert.equal(missing.status, 'none');
  assert.equal(missing.latest, '2.0.0');

  const installedDeps = {
    ...deps,
    installedInfo: () => ({ registeredInstall: true, version: '1.0.0', installPath: 'C:\\Apps\\DSHD' }),
  };
  const present = await runtimeInstall.checkDesktopUpdate({}, installedDeps);
  assert.equal(present.status, 'available');
});

// --- downloadFile abort -------------------------------------------------------

test('downloadFile aborts an in-flight request on signal and removes the partial', async () => {
  const previousGet = https.get;
  let destroyed = false;
  https.get = (_target, _options, _onResponse) => {
    const request = new EventEmitter();
    request.destroy = () => { destroyed = true; };
    return request;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rt-dl-'));
  const dest = path.join(dir, 'setup.exe');
  const controller = new AbortController();
  try {
    const pending = update.downloadFile('https://example.test/setup.exe', dest, null, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.equal(destroyed, true);
    assert.equal(fs.existsSync(dest), false);
  } finally {
    https.get = previousGet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('same-version install with an advanced stamp but a FAILED installer does not report success', async () => {
  // Regression for R4: an already-registered same-version request whose exe
  // stamp advanced while the installer child reported a spawn error must
  // NOT settle as installed — a timestamp only proves a file changed, not
  // that the installation completed.
  let polls = 0;
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    loadConfig: () => ({ downloadRoute: 'github' }),
    releaseSource: fakeSource({
      latest: { status: 'available', latest: '2.0.0', tag: 'v2.0.0', assetUrl: 'https://example.test/setup.exe', assetName: 'Setup.exe' },
    }),
    update: fakeUpdate({
      installFromAsset: async (info, onProgress, options) => {
        const child = installerChild();
        options.onInstallerLaunch(child);
        // Installer fails immediately (spawn error / nonzero exit).
        setImmediate(() => child.emit('error', new Error('spawn-fail')));
        return { ...info, launched: true };
      },
    }),
    installedInfo: () => {
      polls += 1;
      if (polls === 1) {
        // Baseline: version already installed and registered.
        return { registeredInstall: true, installPath: 'C:\\Apps\\DSHD', version: '2.0.0' };
      }
      // Same version, but the exe stamp advanced (file was touched).
      return { registeredInstall: true, installPath: 'C:\\Apps\\DSHD', version: '2.0.0' };
    },
    existsSync: () => true,
    statSync: () => ({ mtimeMs: polls === 1 ? 1 : 9999 }),
    pollMs: 5,
    waitMs: 60,
  };
  const result = await runtimeInstall.installRuntime({ route: 'github' }, null, deps);
  assert.notEqual(result.status, 'installed', 'a failed installer must not be promoted by a touched timestamp');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.match(result.message, /spawn-fail/);
});

test('same-version repair exits promptly as unconfirmed, never installed', async () => {
  const result = await runtimeInstall.waitForInstall(null,
    { registeredInstall: true, version: '2.0.0' }, null, null, {
      waitMs: 80, pollMs: 5,
      installedInfo: () => ({ registeredInstall: true, installPath: 'C:\\Apps\\DSHD', version: '2.0.0' }),
      existsSync: () => true,
    }, '2.0.0', { fired: true, code: 0, failed: false });
  assert.equal(result, 'unconfirmed');
});

test('installer failure wins over even a newly observed target registration', async () => {
  const result = await runtimeInstall.waitForInstall(null,
    { registeredInstall: false, version: '' }, null, null, {
      waitMs: 80, pollMs: 5,
      installedInfo: () => ({ registeredInstall: true, installPath: 'C:\\Apps\\DSHD', version: '2.0.0' }),
      existsSync: () => true,
    }, '2.0.0', { fired: true, code: 2, failed: true });
  assert.equal(result, 'installer-failed');
});

test('an empty/unbound target version is refused before installFromAsset runs', async () => {
  // Regression for R4: when the release info carries no usable version/tag,
  // the target cannot be bound — installation must never be attempted.
  let installCalls = 0;
  const deps = {
    isLauncherPackage: () => true,
    isPackaged: true,
    loadConfig: () => ({ downloadRoute: 'github' }),
    releaseSource: fakeSource({
      // Deliberately no tag and no version-bearing field that normalizes.
      latest: { status: 'available', latest: '', tag: '', assetUrl: 'https://example.test/setup.exe', assetName: 'Setup.exe' },
    }),
    update: fakeUpdate({
      installFromAsset: async () => {
        installCalls += 1;
        return { launched: true };
      },
    }),
    installedInfo: () => ({ registeredInstall: false, installPath: '', version: '' }),
    existsSync: () => true,
    statSync: () => ({ mtimeMs: 1 }),
    pollMs: 5,
    waitMs: 50,
  };
  const result = await runtimeInstall.installRuntime({ route: 'github' }, null, deps);
  assert.equal(installCalls, 0, 'an unbound target must never reach the installer');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unbound-target-version');
});

test('downloadFile rejects upfront when the signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rt-dl0-'));
  const dest = path.join(dir, 'setup.exe');
  try {
    await assert.rejects(
      () => update.downloadFile('https://example.test/setup.exe', dest, null, { signal: controller.signal }),
      (error) => error.name === 'AbortError',
    );
    assert.equal(fs.existsSync(dest), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- startExternalDesktop alive grace ----------------------------------------

const DESKTOP = { appId: 'ai.deepseek.harness', productName: 'DSHD-Runtime' };

function startDeps({ probes, spawnImpl } = {}) {
  const calls = { probes: 0 };
  return {
    deps: {
      isLauncherPackage: () => true,
      target: DESKTOP,
      platform: 'win32',
      installedInfo: () => ({
        registeredInstall: true,
        installPath: 'C:\\Apps\\DSHD',
        version: '2.0.0',
      }),
      existsSync: () => true,
      spawn: spawnImpl || (() => installerChild()),
      execFileSync: () => {
        calls.probes += 1;
        const sequence = probes || [];
        const alive = sequence.length ? sequence[Math.min(calls.probes - 1, sequence.length - 1)] : true;
        return alive ? '"DSHD-Runtime.exe","100","Console","1","50 K"' : 'INFO: No tasks';
      },
      aliveMs: 400,
      pollMs: 10,
    },
    calls,
  };
}

test('startExternalDesktop reports ok only when the runtime is still alive after grace', async () => {
  const { deps } = startDeps({ probes: [true] });
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, true);
  assert.equal(result.external, true);
});

test('startExternalDesktop fails fast when the runtime exits inside the grace window', async () => {
  const { deps } = startDeps({ probes: [true, false] });
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'runtime-exited');
});

test('startExternalDesktop fails when the runtime never enters the process table', async () => {
  const { deps } = startDeps({ probes: [false] });
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'runtime-never-started');
});

test('startExternalDesktop fails when nothing is installed, without spawning', async () => {
  let spawned = false;
  const { deps } = startDeps({});
  deps.installedInfo = () => ({ registeredInstall: false, installPath: '' });
  deps.spawn = () => { spawned = true; return installerChild(); };
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'runtime-not-installed');
  assert.equal(spawned, false);
});

test('startExternalDesktop reports a rejected spawn instead of throwing', async () => {
  const { deps } = startDeps({
    spawnImpl: () => {
      const child = installerChild();
      setImmediate(() => child.emit('error', new Error('ENOENT')));
      return child;
    },
  });
  const result = await runtimeInstall.startExternalDesktop([], deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ENOENT');
});

// --- external boot forensics log --------------------------------------------

function streamedChild() {
  const child = installerChild();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('startExternalDesktop pipes child stdio into the bounded boot log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rt-bootlog-'));
  try {
    const seen = {};
    const { deps } = startDeps({
      probes: [true],
      spawnImpl: (exe, args, options) => {
        seen.options = options;
        const child = streamedChild();
        setImmediate(() => child.stderr.emit(
          'data',
          Buffer.from('failed to apply loader entry app (@evil/plugin)\n'),
        ));
        return child;
      },
    });
    deps.stateDir = () => dir;
    const result = await runtimeInstall.startExternalDesktop([], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(seen.options.stdio, ['ignore', 'pipe', 'pipe']);
    const text = fs.readFileSync(path.join(dir, 'logs', 'last-external-boot.log'), 'utf8');
    assert.match(text, /failed to apply loader entry app \(@evil\/plugin\)/);
    assert.match(text, /spawning external runtime:/);
    assert.match(text, /launcher verdict: launched/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('startExternalDesktop writes the crash evidence and exit verdict to the boot log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rt-crashlog-'));
  try {
    const { deps } = startDeps({
      probes: [true, false],
      spawnImpl: () => {
        const child = streamedChild();
        setImmediate(() => {
          child.stderr.emit(
            'data',
            Buffer.from("Cannot find package '@evil/plugin' imported from C:\\profiles\\web\n"),
          );
          child.emit('exit', 1, null);
        });
        return child;
      },
    });
    deps.stateDir = () => dir;
    const result = await runtimeInstall.startExternalDesktop([], deps);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'runtime-exited');
    const text = fs.readFileSync(path.join(dir, 'logs', 'last-external-boot.log'), 'utf8');
    assert.match(text, /Cannot find package '@evil\/plugin'/);
    assert.match(text, /external runtime exited code 1/);
    assert.match(text, /launcher verdict: runtime-exited/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('startExternalDesktop records a spawn-failed verdict in the boot log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rt-spawnlog-'));
  try {
    const { deps } = startDeps({
      spawnImpl: () => {
        const child = streamedChild();
        setImmediate(() => child.emit('error', new Error('ENOENT')));
        return child;
      },
    });
    deps.stateDir = () => dir;
    const result = await runtimeInstall.startExternalDesktop([], deps);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'ENOENT');
    const text = fs.readFileSync(path.join(dir, 'logs', 'last-external-boot.log'), 'utf8');
    assert.match(text, /launcher verdict: spawn failed \(ENOENT\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
