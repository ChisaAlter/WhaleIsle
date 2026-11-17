'use strict';

// Model-based property test (fast-check commands) over the update-center
// state machine: random check/download/cancel/install/route-switch sequences
// with injected network and filesystem faults. The simplified reference model
// is the legal phase-transition graph plus the job invariants below; every
// step re-checks them against the real service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const fc = require('fast-check');

const { createUpdateCenter } = require('./service');
const { sanitizeDownloadFilename } = require('../download-path');
const { fuzzAssert } = require('../../../scripts/lib/fuzz.cjs');

const NUM_RUNS = 30;
const ROUTES = [{ id: 'cnb', label: 'CNB' }, { id: 'github', label: 'GitHub' }];
const PHASES = new Set(['idle', 'checking', 'downloading', 'verifying', 'installing',
  'current', 'available', 'paused', 'ready', 'error']);
const BUSY = new Set(['checking', 'downloading', 'verifying', 'installing']);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sha = (bytes) => crypto.createHash('sha512').update(bytes).digest('hex');

// Phases where a leftover `.part` payload is legitimate resume state. Anything
// else — in particular `available` after a cancel, `ready` after the rename,
// `current`, `idle` — means the job leaked bytes on disk.
const PART_ALLOWED = new Set(['checking', 'downloading', 'verifying', 'paused', 'error']);

// Reference state machine: every emitted phase transition must be an edge in
// this graph (self-loops and the first emitted view are exempt).
const ALLOWED_TRANSITIONS = {
  idle: ['checking'],
  checking: ['error', 'current', 'available', 'paused', 'ready', 'downloading'],
  current: ['checking'],
  available: ['checking', 'downloading'],
  paused: ['downloading', 'available', 'checking', 'idle'],
  ready: ['verifying', 'available', 'checking', 'downloading'],
  // downloading -> ready is the already-on-disk shortcut in runFull: a final
  // installer that verifies goes straight to ready without a verifying emit.
  downloading: ['verifying', 'paused', 'available', 'error', 'ready'],
  verifying: ['ready', 'error', 'paused', 'available', 'installing', 'downloading'],
  installing: ['ready', 'error'],
  error: ['checking', 'available', 'downloading', 'idle'],
};

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function release(version, extra = {}) {
  return {
    version, tag: `v${version}`, notes: `notes ${version}`, publishedAt: '2026-10-29',
    assetName: `Whale-Isle-Setup-${version}.exe`, assetUrl: `https://example.test/${version}.exe`,
    assetSize: 1000, checksumUrl: 'https://example.test/SHA512SUMS.txt',
    blockmapUrl: 'https://example.test/a.blockmap', updaterMetadataUrl: 'https://example.test/latest.yml',
    ...extra,
  };
}

const RELEASE_POOL = [
  release('0.3.13'),
  release('0.3.14'),
  release('0.3.12'),
  release('0.3.15', { assetUrl: '' }),
  release('0.3.16', { checksumUrl: '' }),
  null,
];

/** fs that fails the `index`-th call to `op` with `code`; records the fired fault. */
function faultyFs(plan) {
  if (!plan) return { impl: fs, fired: null };
  const state = { count: 0, fired: null };
  const impl = Object.create(fs);
  impl[plan.op] = (...args) => {
    state.count += 1;
    if (state.count === plan.index) {
      state.fired = { op: plan.op, index: plan.index, code: plan.code, args: args.map(String) };
      const error = new Error(`${plan.code}: injected fs fault on ${plan.op}`);
      error.code = plan.code;
      throw error;
    }
    return fs[plan.op](...args);
  };
  return { impl, fired: state };
}

function makeReal(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-uc-prop-'));
  const updatesDir = path.join(dir, 'updates');
  const payload = crypto.randomBytes(1000);
  const garbage = crypto.randomBytes(1000);
  const fault = faultyFs(setup.fsFault);
  const control = {
    release: RELEASE_POOL[setup.releaseIndex % RELEASE_POOL.length],
    plan: setup.deltaPlan === 'full'
      ? { ok: false, reason: 'unsupported' }
      : { ok: true, downloadBytes: 210 },
    deltaResult: setup.deltaResult === 'fail' ? { ok: false, reason: 'missing-base-release' } : null,
    failRoutes: new Set(setup.failRoutes),
    stallAt: setup.downloadMode === 'stall' ? setup.downloadAt : null,
    failAt: setup.downloadMode === 'fail' ? setup.downloadAt : null,
    garbage: setup.downloadMode === 'garbage',
    installResult: setup.installResult,
  };
  const config = { route: 'cnb', explicit: setup.routeExplicit, autoDownload: setup.autoDownload };
  const calls = { install: [], resolve: [] };
  const jobs = { active: 0, max: 0 };
  const verified = new Map(); // file -> last verifyFile outcome ('ok' | 'fail')
  const real = {
    dir, updatesDir, payload, control, calls, jobs, verified,
    deltaInstaller: '',
    transitions: [],
    lastPhase: null,
  };
  const deps = {
    userDataDir: dir,
    currentVersion: () => '0.3.12',
    routes: ROUTES,
    getRoute: () => config.route,
    isRouteExplicit: () => config.explicit,
    saveRoute: (route) => { config.route = route; config.explicit = true; },
    getAutoDownload: () => config.autoDownload,
    saveAutoDownload: (value) => { config.autoDownload = value; },
    resolveRelease: async (route, tag) => {
      calls.resolve.push([route, tag]);
      if (control.failRoutes.has(route)) {
        throw Object.assign(new Error('请求超时'), { code: 'ETIMEDOUT' });
      }
      return control.release;
    },
    planDelta: async () => control.plan,
    readChecksum: async () => sha(payload),
    downloadFile: async (url, dest, onProgress, options) => {
      calls.download = (calls.download || 0) + 1;
      jobs.active += 1;
      jobs.max = Math.max(jobs.max, jobs.active);
      try {
        const state = options.resumeState;
        const bytes = control.garbage ? garbage : payload;
        let offset = state.offset || 0;
        if (offset === 0) fs.writeFileSync(dest, Buffer.alloc(0));
        state.total = bytes.length;
        while (offset < bytes.length) {
          if (options.signal.aborted) throw Object.assign(new Error('下载已取消'), { name: 'AbortError' });
          if (control.stallAt !== null && offset >= control.stallAt) { await tick(); continue; }
          const end = Math.min(bytes.length, offset + 100);
          fs.appendFileSync(dest, bytes.subarray(offset, end));
          offset = end;
          state.offset = offset;
          onProgress({ phase: 'download', received: offset, total: bytes.length, bytesPerSecond: 100 });
          if (control.failAt !== null && offset >= control.failAt) {
            throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
          }
          await tick();
        }
      } finally {
        jobs.active -= 1;
      }
    },
    verifyFile: async (file, expected) => {
      let ok = false;
      try {
        ok = fs.statSync(file).size > 0 && sha(fs.readFileSync(file)) === expected;
      } catch {
        ok = false;
      }
      verified.set(file, ok ? 'ok' : 'fail');
      if (!ok) throw Object.assign(new Error('sha512 mismatch'), { code: 'ERR_UPDATER_CHECKSUM_MISMATCH' });
    },
    downloadDelta: async (target, onProgress, options = {}) => {
      jobs.active += 1;
      jobs.max = Math.max(jobs.max, jobs.active);
      try {
        if (options.signal?.aborted) throw Object.assign(new Error('下载已取消'), { name: 'AbortError' });
        if (control.deltaResult) return control.deltaResult;
        onProgress({ phase: 'download', received: 210, total: 210, bytesPerSecond: 50 });
        const installer = path.join(dir, `pending-installer-${target.version}.exe`);
        fs.writeFileSync(installer, payload);
        real.deltaInstaller = installer;
        return { ok: true, installer };
      } finally {
        jobs.active -= 1;
      }
    },
    install: async (target, file, options) => {
      jobs.active += 1;
      jobs.max = Math.max(jobs.max, jobs.active);
      try {
        calls.install.push({ version: target.version, file, args: options.installerArgs });
        return control.installResult;
      } finally {
        jobs.active -= 1;
      }
    },
    compareVersions,
    platform: 'win32',
    fs: fault.impl,
    timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} },
    log: () => {},
  };
  const center = createUpdateCenter(deps);
  center.subscribe((view) => {
    if (real.lastPhase !== null && view.phase !== real.lastPhase) {
      real.transitions.push([real.lastPhase, view.phase]);
    }
    real.lastPhase = view.phase;
  });
  real.center = center;
  real.fault = fault;
  return real;
}

function stray(real) {
  const out = { parts: [], tmps: [] };
  for (const dir of [real.dir, real.updatesDir]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (name.endsWith('.part')) out.parts.push(name);
      if (name.endsWith('.tmp')) out.tmps.push(name);
    }
  }
  return out;
}

function readyFileExists(real) {
  const snap = real.center.snapshot();
  const targetAsset = snap.target
    ? sanitizeDownloadFilename(`Whale-Isle-Setup-${snap.target.version}.exe`)
    : '';
  const candidates = [
    targetAsset && path.join(real.updatesDir, targetAsset),
    real.deltaInstaller,
  ].filter(Boolean);
  return candidates.some((file) => {
    try { return fs.statSync(file).size > 0; } catch { return false; }
  });
}

async function settle(real, maxTicks = 400) {
  for (let i = 0; i < maxTicks; i += 1) {
    if (!BUSY.has(real.center.snapshot().phase)) return real.center.snapshot();
    await tick();
  }
  return real.center.snapshot();
}

function assertInvariants(real, action) {
  const snap = real.center.snapshot();
  assert.ok(PHASES.has(snap.phase), `${action}: unknown phase ${snap.phase}`);
  assert.ok(real.jobs.max <= 1, `${action}: concurrent update jobs observed`);
  assert.ok(real.jobs.active <= 1, `${action}: two live update jobs`);
  if (snap.phase === 'error') {
    assert.ok(snap.error && typeof snap.error.message === 'string', `${action}: error phase without error`);
  }
  if (snap.userPaused) {
    assert.equal(snap.phase, 'paused', `${action}: userPaused outside paused phase`);
  }
  for (const [from, to] of real.transitions) {
    const allowed = ALLOWED_TRANSITIONS[from] || [];
    assert.ok(allowed.includes(to), `${action}: illegal transition ${from} -> ${to}`);
  }
  const files = stray(real);
  if (!BUSY.has(snap.phase)) {
    for (const file of files.parts) {
      assert.ok(PART_ALLOWED.has(snap.phase), `${action}: leftover ${file} in phase ${snap.phase}`);
    }
    assert.deepEqual(files.tmps, [], `${action}: leftover atomic-write temp in ${snap.phase}`);
  } else {
    for (const file of files.parts) {
      assert.ok(PART_ALLOWED.has(snap.phase), `${action}: leftover ${file} in phase ${snap.phase}`);
    }
  }
  if (snap.phase === 'ready') {
    assert.ok(readyFileExists(real), `${action}: ready phase without a verified installer on disk`);
  }
  for (const call of real.calls.install.slice(real.checkedInstalls || 0)) {
    assert.equal(real.verified.get(call.file), 'ok',
      `${action}: install launched for ${call.file} that never passed verification`);
  }
  real.checkedInstalls = real.calls.install.length;
}

async function invoke(real, action, arg) {
  const view = await real.center.command(action, arg).catch((error) => ({ thrown: error.message }));
  real.lastView = view;
  await settle(real);
  assertInvariants(real, action);
}

async function finish(real) {
  real.control.stallAt = null;
  real.control.failAt = null;
  for (let i = 0; i < 2000 && BUSY.has(real.center.snapshot().phase); i += 1) await tick();
  await real.center.stop();
  assertInvariants(real, 'finish');
  fs.rmSync(real.dir, { recursive: true, force: true });
}

class UCCommand {
  constructor(action, arg) { this.action = action; this.arg = arg; }
  check() { return true; }
  async run(model, real) { await invoke(real, this.action, this.arg); }
  toString() { return this.arg === undefined ? this.action : `${this.action}(${JSON.stringify(this.arg)})`; }
}

class MutCommand {
  constructor(kind, arg) { this.kind = kind; this.arg = arg; }
  check() { return true; }
  async run(model, real) {
    switch (this.kind) {
      case 'flap':
        if (real.control.failRoutes.has(this.arg)) real.control.failRoutes.delete(this.arg);
        else real.control.failRoutes.add(this.arg);
        break;
      case 'release':
        real.control.release = RELEASE_POOL[this.arg % RELEASE_POOL.length];
        break;
      case 'installResult':
        real.control.installResult = this.arg;
        break;
      case 'tamper': {
        // A scanner/indexer rewriting the verified installer between ready and
        // install must be caught by the install-time re-verify.
        const snap = real.center.snapshot();
        if (snap.target) {
          const final = path.join(real.updatesDir,
            sanitizeDownloadFilename(`Whale-Isle-Setup-${snap.target.version}.exe`));
          try { fs.writeFileSync(final, 'tampered-by-indexer'); } catch { /* no file yet */ }
          if (real.deltaInstaller) {
            try { fs.writeFileSync(real.deltaInstaller, 'tampered-by-indexer'); } catch { /* gone */ }
          }
        }
        break;
      }
      default:
        throw new Error(`unknown mutation ${this.kind}`);
    }
    await settle(real);
    assertInvariants(real, `mutate:${this.kind}`);
  }
  toString() { return `mutate:${this.kind}(${JSON.stringify(this.arg)})`; }
}

class BurstCommand {
  constructor(pairs) { this.pairs = pairs; }
  check() { return true; }
  async run(model, real) {
    // Re-entrant / concurrent dispatch: both commands race through the same
    // service; at most one job may run and the phases must stay legal.
    await Promise.all(this.pairs.map(([action, arg]) => real.center.command(action, arg)
      .catch((error) => ({ thrown: error.message }))));
    await settle(real);
    assertInvariants(real, `burst:${this.pairs.map((p) => p[0]).join('+')}`);
  }
  toString() { return `burst:${JSON.stringify(this.pairs)}`; }
}

const actionArb = (action, argArb = fc.constant(undefined)) =>
  argArb.map((arg) => new UCCommand(action, arg));

const routeArb = fc.constantFrom('cnb', 'github');
const burstActions = [
  ['check'], ['download'], ['downloadFull'], ['pause'], ['resume'], ['cancel'], ['install'],
];

const commandArbs = [
  actionArb('check'),
  actionArb('download'),
  actionArb('downloadFull'),
  actionArb('pause'),
  actionArb('resume'),
  actionArb('cancel'),
  actionArb('install'),
  actionArb('installVersion', fc.constantFrom('v0.3.10', '0.3.14', '', 'v9.9.9')),
  actionArb('setRoute', routeArb),
  actionArb('setAutoDownload', fc.boolean()),
  routeArb.map((route) => new MutCommand('flap', route)),
  fc.integer({ min: 0, max: RELEASE_POOL.length + 1 }).map((i) => new MutCommand('release', i)),
  fc.constantFrom({ launched: true }, { launched: false, code: 'spawn-denied' }, { manualInstall: true, message: 'run it yourself' })
    .map((result) => new MutCommand('installResult', result)),
  fc.constant(undefined).map(() => new MutCommand('tamper')),
  fc.array(fc.constantFrom(...burstActions), { minLength: 2, maxLength: 3 })
    .map((pairs) => new BurstCommand(pairs.map(([action]) => [action, undefined]))),
];

const setupArb = fc.record({
  autoDownload: fc.boolean(),
  routeExplicit: fc.boolean(),
  deltaPlan: fc.constantFrom('delta', 'full'),
  deltaResult: fc.constantFrom('ok', 'fail'),
  downloadMode: fc.constantFrom('ok', 'stall', 'fail', 'garbage'),
  downloadAt: fc.integer({ min: 100, max: 900 }),
  installResult: fc.constantFrom({ launched: true }, { launched: false, code: 'spawn-denied' }, { manualInstall: true }),
  releaseIndex: fc.integer({ min: 0, max: 20 }),
  failRoutes: fc.subarray(['cnb', 'github']),
  fsFault: fc.option(fc.record({
    op: fc.constantFrom('mkdirSync', 'renameSync', 'statSync', 'readFileSync'),
    index: fc.integer({ min: 1, max: 30 }),
    code: fc.constantFrom('EPERM', 'ENOSPC', 'EIO', 'EBUSY'),
  }), { nil: null }),
});

test('update center survives random command sequences with faults (state machine + residue invariants)', async () => {
  await fuzzAssert(fc.asyncProperty(
    setupArb,
    fc.commands(commandArbs, { maxCommands: 22 }),
    async (setup, commands) => {
      const real = makeReal(setup);
      try {
        real.center.start();
        await fc.asyncModelRun(() => ({ model: {}, real }), commands);
        await finish(real);
      } finally {
        real.control.stallAt = null;
        real.control.failAt = null;
        for (let i = 0; i < 2000 && real.jobs.active > 0; i += 1) await tick();
        fs.rmSync(real.dir, { recursive: true, force: true });
      }
      return true;
    },
  ), 'update center survives random command sequences with faults (state machine + residue invariants)', { numRuns: NUM_RUNS });
});
