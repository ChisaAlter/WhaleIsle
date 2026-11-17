// Opt-in LIVE acceptance for the vendored dsh-remote feature (feature card
// `remote-workspace`, Manual/QA gate). Boots the real vendored CLI with the
// desktop overlay on a throwaway $DSH_HOME, redeems the launch token once, then
// drives a real SSH round-trip. Remote writes are confined to a unique
// run-owned fixture root under the authenticated remote home.
//
// Usage (env-gated — exits 0 with a NOT RUN note when unset):
//   DSHR_TEST_HOST=1.2.3.4 DSHR_TEST_USER=root DSHR_TEST_KEY=C:\path\to\key node scripts/verify-remote-workspace-live.cjs
// Required-live usage (missing config exits 2):
//   DSHR_TEST_HOST=1.2.3.4 DSHR_TEST_USER=root DSHR_TEST_KEY=C:\path\to\key node scripts/verify-remote-workspace-live.cjs --require-live
// Optional: DSHR_TEST_PORT=22 DSHR_TEST_PASSWORD=… DSHR_TEST_LS_PATH=/root
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createUniqueDir } = require('../src/shared/fs-safe.js');

const {
  assertInsideRoot,
  createRunId,
  errorMessage,
  establishLiveSession,
  joinRemotePath,
  makeRemoteFixturePaths,
  notRunMessage,
  requestJson,
  reservePort,
  resolveLiveConfig,
  stopChild,
  waitForUrl,
  withDeadline,
} = require('./lib/remote-workspace-live-guard.cjs');

// The vendored plugin answers 405 to a GET on every mutating route. Only the
// read-only routes (/status, /ls, /audit, /resolve-mirror) are GET, so the
// method is looked up per route instead of being inferred from the body.
// See vendor/dsh-remote/lib/index.js:1786 (/status, GET),
// :2081-2085 (/machines, GET|POST), :2259 (/current, POST), :2388 (/home,
// POST), :1969 (/mirror, POST), :2201 (/test-connect, POST) and
// vendor/dsh-remote/lib/routes-fs.js:148 (/fs, POST), :120 (/write, POST).
// `/read` accepts GET|POST but reads `path` from the body only for POST
// (routes-fs.js:77-89), so it must be POST here.
const API_METHODS = Object.freeze({
  '/dsh-remote/current': 'POST',
  '/dsh-remote/fs': 'POST',
  '/dsh-remote/home': 'POST',
  '/dsh-remote/machines': 'POST',
  '/dsh-remote/mirror': 'POST',
  '/dsh-remote/read': 'POST',
  '/dsh-remote/test-connect': 'POST',
  '/dsh-remote/write': 'POST',
});

function apiMethodFor(route) {
  return API_METHODS[String(route).split('?')[0]] || 'GET';
}

function createRuntime(overrides = {}) {
  return {
    resolveConfig: resolveLiveConfig,
    // 目录由 removeHome 回调在 finally 中 rmSync 回收
    makeHome: () => createUniqueDir(os.tmpdir(), 'dshr-live-home-'),
    removeHome: (home) => fs.rmSync(home, { recursive: true, force: true }),
    reservePort,
    spawnChild: spawn,
    waitForUrl,
    establishSession: establishLiveSession,
    request: requestJson,
    stopChild,
    ensureRemote: (options) => {
      const { ensureDesktopDshRemote } = require(path.join(__dirname, '..', 'src/main/dsh-remote-desktop'));
      return ensureDesktopDshRemote(options);
    },
    probeReady: (url, options) => {
      const { probeHarnessReady } = require(path.join(__dirname, '..', 'src/main/harness-browser-auth.js'));
      return probeHarnessReady(url, options);
    },
    error: console.error,
    log: console.log,
    exitCode: (code) => { process.exitCode = code; },
    ...overrides,
  };
}

function createOkLogger(log) {
  return (name, condition, extra = '') => {
    log(`${condition ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!condition) throw new Error(`check failed: ${name}`);
  };
}

function requireCleanupSuccess(result, label) {
  if (!result || result.status !== 200 || !result.json || result.json.ok !== true) {
    const status = result && result.status;
    const detail = result && (result.text || (result.json ? JSON.stringify(result.json) : ''));
    throw new Error(`${label} failed: HTTP ${status}${detail ? ' ' + detail : ''}`.trim());
  }
  return result;
}

function requireRemoteDeselected(afterDeselect, remoteAfterDeselect) {
  if (afterDeselect.status !== 200 || !afterDeselect.json
      || afterDeselect.json.host || afterDeselect.json.connected === true) {
    throw new Error('remote stayed active after deselect: '
      + `HTTP ${afterDeselect.status} ${afterDeselect.text || ''}`.trim());
  }
  if (remoteAfterDeselect.status === 200) {
    throw new Error('a remote operation was still accepted after deselect — '
      + `HTTP ${remoteAfterDeselect.status}`);
  }
}

function writeProfile(profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2));
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '[]\n');
  fs.writeFileSync(path.join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n');
}

function makeFixture(config, runId, home) {
  const paths = makeRemoteFixturePaths(home, runId);
  const requested = String(config.mirrorPath || '');
  const fixture = {
    ...paths,
    // A mirror must point at a directory that exists: `dirName` is what the
    // run creates, and `/mirror` is handed that exact path.
    mirrorTarget: paths.dirName,
    createdPaths: [],
    cleanupNeeded: false,
  };
  if (!requested) return fixture;
  assertInsideRoot(paths.root, requested, 'DSHR_TEST_MIRROR_PATH');
  // An explicit override is still created by this run, so the same
  // create-then-mirror contract holds.
  return { ...fixture, dirName: requested, mirrorName: requested, mirrorTarget: requested };
}

async function runLive(options = {}) {
  const runtime = createRuntime(options.runtime);
  const config = runtime.config || runtime.resolveConfig(options.env || process.env, options.argv || process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const runId = createRunId('dshr-live');
  const home = runtime.makeHome();
  const profileDir = path.join(home, 'profiles', 'web');
  let child = null;
  let apiSession = null;
  let fixture = null;
  let machineId = null;
  let primaryError = null;
  let cleanupError = null;
  let removeHomeSkippedReason = null;
  const teardownOrder = [];

  const runDeadline = new AbortController();
  const runTimer = setTimeout(
    () => runDeadline.abort(new Error(`live run exceeded ${config.timeouts.runMs}ms`)),
    config.timeouts.runMs,
  );
  runTimer.unref?.();

  const api = (route, body, requestOptions = {}) => {
    if (!apiSession) throw new Error('API session is not ready');
    return runtime.request(apiSession.base, apiSession.cookie, apiMethodFor(route), route, body, {
      requestMs: config.timeouts.requestMs,
      bodyMs: config.timeouts.bodyMs,
      signal: runDeadline.signal,
      ...requestOptions,
    });
  };

  // Cleanup must never re-enter the run's deadline: it owns its own budget and
  // keeps the original failure as the primary result.
  const cleanupRequest = async (route, body) => {
    if (!apiSession) throw new Error('API session is not ready for cleanup');
    const method = apiMethodFor(route);
    return withDeadline(undefined, config.timeouts.cleanupMs, (signal) => runtime.request(
      apiSession.base,
      apiSession.cookie,
      method,
      route,
      body,
      {
        requestMs: config.timeouts.cleanupMs,
        bodyMs: config.timeouts.cleanupMs,
        signal,
      },
    ));
  };

  try {
    writeProfile(profileDir);
    const ensured = await runtime.ensureRemote({ profileDir, enabled: true });
    runtime.log('[live] ensure:', JSON.stringify({ ok: ensured.ok, added: ensured.added }));
    if (!ensured.ok) throw new Error('ensure failed: ' + ensured.error);

    const port = await runtime.reservePort('127.0.0.1');
    runtime.log(`[live] local port: ${port}`);
    const binJs = path.join(root, 'vendor', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js');
    child = runtime.spawnChild(process.execPath, [binJs, 'web', '--patch', ensured.overlayFile,
      '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
      env: { ...process.env, DSH_HOME: home, DSH_HARNESS_ROOT: path.join(root, 'vendor', 'deepseek-harness') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (data) => runtime.error('[harness:err] ' + data));

    const url = await runtime.waitForUrl(child, {
      timeoutMs: config.timeouts.runMs,
      signal: runDeadline.signal,
    });
    const session = await runtime.establishSession(url, {
      probe: runtime.probeReady,
      timeoutMs: config.timeouts.requestMs,
      signal: runDeadline.signal,
    });
    apiSession = { base: new URL(url).origin, cookie: session.cookie };
    runtime.log('[live] web up:', apiSession.base);

    const ok = createOkLogger(runtime.log);

    const add = await api('/dsh-remote/machines', {
      action: 'add', name: 'live-accept', host: config.host, port: config.port, username: config.user,
      privateKeyPath: config.key, password: config.password,
    });
    machineId = add.json && (add.json.id || (add.json.machine && add.json.machine.id));
    ok('machines.add', add.status === 200 && !!machineId, 'id=' + machineId);
    if (!machineId) throw new Error('no machine id: ' + JSON.stringify(add.json));

    const test = await api('/dsh-remote/test-connect', { machineId });
    ok('test-connect(machineId)', test.status === 200 && test.json && test.json.ok === true,
      `latencyMs=${test.json && test.json.latencyMs} platform=${test.json && test.json.platform}`);
    ok('current.set', (await api('/dsh-remote/current', { id: machineId })).status === 200);

    const homeResult = await api('/dsh-remote/home');
    ok('home', homeResult.status === 200 && homeResult.json && homeResult.json.ok === true && !!homeResult.json.home,
      JSON.stringify(homeResult.json));
    fixture = makeFixture(config, runId, homeResult.json.home);

    const status0 = await api('/dsh-remote/status');
    ok('status.connected', status0.json && status0.json.connected === true,
      `host=${status0.json && status0.json.host} platform=${status0.json && status0.json.platform}`);

    const ls = await api('/dsh-remote/ls?path=' + encodeURIComponent(config.lsPath));
    const items = ls.json && ls.json.items;
    ok(`ls ${config.lsPath}`, ls.status === 200 && Array.isArray(items), `items=${items ? items.length : 'n/a'}`);

    const mkdirFixture = await api('/dsh-remote/fs', { op: 'mkdir', path: fixture.root });
    ok('fixture.mkdir (owner root)', mkdirFixture.status === 200 && mkdirFixture.json && mkdirFixture.json.ok === true);
    fixture.cleanupNeeded = mkdirFixture.status === 200 && mkdirFixture.json && mkdirFixture.json.ok === true;
    if (fixture.cleanupNeeded) fixture.createdPaths.push(fixture.root);

    const write1 = await api('/dsh-remote/write', { path: fixture.fileName, content: 'dsh-remote live acceptance\n' });
    const mtime = write1.json && write1.json.mtime;
    ok('write owned fixture file', write1.status === 200 && write1.json && write1.json.ok === true, `mtime=${mtime}`);

    const read = await api('/dsh-remote/read', { path: fixture.fileName });
    ok('read back', read.status === 200 && read.json && String(read.json.content || '').includes('acceptance'));

    const conflict = await api('/dsh-remote/write', {
      path: fixture.fileName,
      content: 'x',
      expectedMtime: (mtime || 0) - 100,
    });
    ok('write conflict → 409', conflict.status === 409, `status=${conflict.status}`);

    const write2 = await api('/dsh-remote/write', { path: fixture.fileName, content: 'v2\n', expectedMtime: mtime });
    ok('write correct mtime', write2.status === 200 && write2.json && write2.json.ok === true);

    const mkdir = await api('/dsh-remote/fs', { op: 'mkdir', path: fixture.dirName });
    ok('fs.mkdir owned fixture dir', mkdir.status === 200 && mkdir.json && mkdir.json.ok === true);
    if (mkdir.status === 200 && mkdir.json && mkdir.json.ok === true) fixture.createdPaths.push(fixture.dirName);

    // `/mirror` resolves its target through `isRemoteDir()` and answers 400 for
    // a missing directory, so the run proves both halves of that contract.
    const missingMirror = await api('/dsh-remote/mirror', { path: joinRemotePath(fixture.root, 'does-not-exist') });
    ok('mirror rejects a missing directory → 400', missingMirror.status === 400,
      `status=${missingMirror.status}`);

    const mirror = await api('/dsh-remote/mirror', { path: fixture.mirrorTarget });
    const localMirror = mirror.json && mirror.json.localMirror;
    ok('mirror owned fixture dir', mirror.status === 200 && !!localMirror, String(localMirror));
    if (localMirror) {
      ok('mirror meta file', fs.existsSync(path.join(localMirror, '.dsh-remote-meta.json')));
      const resolved = await api('/dsh-remote/resolve-mirror?local=' + encodeURIComponent(localMirror));
      ok('resolve-mirror', resolved.status === 200 && resolved.json && resolved.json.remotePath === fixture.mirrorTarget,
        JSON.stringify(resolved.json).slice(0, 160));
    }

    const audit = await api('/dsh-remote/audit');
    const lines = audit.json && audit.json.lines;
    ok('audit recorded', audit.status === 200 && Array.isArray(lines) && lines.length > 0,
      `lines=${Array.isArray(lines) ? lines.length : 'n/a'}`);

    // Deselecting and deleting the machine happen in the teardown, after the
    // remote fixture is gone: `/current { id: '' }` clears config.host, so any
    // remote call after it is refused by design.
  } catch (error) {
    primaryError = error;
    runtime.error('[live] fatal:', error);
  } finally {
    clearTimeout(runTimer);

    // Teardown order is part of the contract:
    //   1. remote fixture cleanup (needs the active machine),
    //   2. deselect + delete the machine,
    //   3. stop the harness child,
    //   4. remove the local temp HOME.
    // Step 2 clears config.host, so nothing after it may touch the remote.
    let childStopped = false;
    let stopChildError = null;
    try {
      if (fixture && fixture.cleanupNeeded && apiSession) {
        const result = await cleanupRequest('/dsh-remote/fs', { op: 'remove', path: fixture.root });
        requireCleanupSuccess(result, 'remote fixture cleanup');
        fixture.cleanupNeeded = false;
        runtime.log(`[live] remote cleanup: removed ${fixture.root}`);
        teardownOrder.push('remote-fixture-cleanup');
      }
    } catch (error) {
      cleanupError = error;
      runtime.error('[live] cleanup:', errorMessage(error));
    }

    try {
      if (apiSession && (machineId || fixture)) {
        if (machineId) {
          const deselected = await cleanupRequest('/dsh-remote/current', { id: '' });
          requireCleanupSuccess(deselected, 'machine deselect');
          teardownOrder.push('machine-deselect');
          // Proves the deselect took effect. `clearActiveMachine()` blanks
          // config.host and unbinds the pool (vendor/dsh-remote/lib/index.js:406),
          // so /status reports no host and an actual remote operation is
          // refused. `/ls` is read-only, so a plugin that wrongly kept the
          // binding cannot leave anything behind on the host.
          const afterDeselect = await cleanupRequest('/dsh-remote/status');
          const remoteAfterDeselect = await cleanupRequest(
            '/dsh-remote/ls?path=' + encodeURIComponent(fixture ? fixture.root : '/'),
          );
          requireRemoteDeselected(afterDeselect, remoteAfterDeselect);
          teardownOrder.push('post-deselect-remote-op');
          const deleted = await cleanupRequest('/dsh-remote/machines', { action: 'delete', id: machineId });
          requireCleanupSuccess(deleted, 'machine delete');
          teardownOrder.push('machine-delete');
        }
      }
    } catch (error) {
      cleanupError ||= error;
      runtime.error('[live] machine cleanup:', errorMessage(error));
    }

    try {
      await runtime.stopChild(child, { timeoutMs: config.timeouts.childExitMs });
      childStopped = true;
      teardownOrder.push('stopChild');
    } catch (error) {
      stopChildError = error;
      cleanupError ||= error;
      runtime.error('[live] child cleanup:', errorMessage(error));
    }

    if (!childStopped) {
      // The harness may still hold the temp HOME open (open session files,
      // running tools). Keeping the directory is harmless and preserves the
      // evidence; deleting it under a live child would be the real damage.
      removeHomeSkippedReason = `harness child did not stop (${errorMessage(stopChildError)})`;
      runtime.error(`[live] temp HOME preserved: ${home}`);
    } else {
      try {
        runtime.removeHome(home);
        teardownOrder.push('removeHome');
      } catch (error) {
        cleanupError ||= error;
        runtime.error('[live] temp HOME cleanup:', errorMessage(error));
      }
    }
  }

  if (primaryError) {
    if (cleanupError) runtime.error('[live] cleanup also failed:', errorMessage(cleanupError));
    if (removeHomeSkippedReason) runtime.error(`[live] temp HOME not removed: ${removeHomeSkippedReason} (${home})`);
    runtime.exitCode(1);
    return {
      ok: false, error: primaryError, cleanupError, home, homePreserved: !!removeHomeSkippedReason, teardownOrder,
    };
  }
  if (cleanupError) {
    runtime.error('[live] cleanup failed after acceptance:', errorMessage(cleanupError));
    if (removeHomeSkippedReason) runtime.error(`[live] temp HOME not removed: ${removeHomeSkippedReason} (${home})`);
    runtime.exitCode(1);
    return {
      ok: false, error: null, cleanupError, home, homePreserved: !!removeHomeSkippedReason, teardownOrder,
    };
  }
  runtime.exitCode(0);
  return {
    ok: true,
    error: null,
    cleanupError: null,
    home,
    homePreserved: false,
    fixture: fixture ? { root: fixture.root, mirrorTarget: fixture.mirrorTarget } : null,
    teardownOrder,
  };
}

function main(env = process.env, argv = process.argv.slice(2), options = {}) {
  const runtime = createRuntime(options.runtime);
  const config = runtime.resolveConfig(env, argv);
  if (config.missing.length) {
    const message = notRunMessage(config);
    if (config.requireLive) {
      runtime.error(message);
      runtime.exitCode(2);
      return Promise.resolve(2);
    }
    runtime.log(message);
    runtime.exitCode(0);
    return Promise.resolve(0);
  }
  return runLive({
    ...options,
    env,
    argv,
    runtime: { ...runtime, config },
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[live] fatal:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  API_METHODS,
  apiMethodFor,
  createRuntime,
  main,
  makeFixture,
  runLive,
};
