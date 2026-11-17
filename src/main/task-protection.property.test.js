'use strict';

// Model-based property test (fast-check commands) for task protection:
//   A) the vendored Host lock/drain state machine
//      (vendor/dsh-task-control/lib/state.js) — admit/acquire/renew/release/
//      drain/expiry/stop sequences, including concurrent acquires;
//   B) the shell coordinator (src/main/task-protection.js) wired through
//      fetchImpl to that real state machine — random coordinate() calls with
//      pending Host work, dirty inspections, forced/terminal/parallel runs.
// Invariants: at most one lock holder, expired locks are reclaimed, a drain
// reports exactly the work it waited for, commits run at most once and only
// on proceeded decisions, and the Host lock is never leaked by a finished
// non-terminal operation.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fc = require('fast-check');

const { createTaskProtection, inspectionClean, CONTROL_PREFIX } = require('./task-protection');
const { fuzzAssert } = require('../../scripts/lib/fuzz.cjs');

const NUM_RUNS = 25;
const PLUGIN = path.join(__dirname, '..', '..', 'vendor', 'dsh-task-control', 'lib');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let stateMod = null;
test.before(async () => {
  stateMod = await import(pathToFileURL(path.join(PLUGIN, 'state.js')).href);
});

// ---------------------------------------------------------------------------
// Property A — Host lock/drain state machine.
// ---------------------------------------------------------------------------

class AdmitCommand {
  constructor(label) { this.label = label; }
  check() { return true; }
  async run(model) {
    const acceptedExpected = !model.stopping && !(model.holder && model.holder.expiresAt > Date.now());
    const result = stateMod.admit(model.state, this.label);
    assert.equal(result.accepted, acceptedExpected, `admit ${this.label}`);
    if (result.accepted) {
      model.pending.push(result);
    } else {
      assert.equal(result.code, model.stopping ? 'dshd/host-stopping' : stateMod.LOCKED_CODE);
    }
    checkStatus(model);
  }
  toString() { return `admit(${this.label})`; }
}

class FinishCommand {
  constructor(all) { this.all = all; }
  check(model) { return model.pending.length > 0; }
  async run(model) {
    const targets = this.all ? model.pending.splice(0) : model.pending.splice(0, 1);
    for (const item of targets) item.done();
    checkStatus(model);
  }
  toString() { return this.all ? 'finishAll' : 'finishOne'; }
}

class AcquireCommand {
  constructor(owner, ttlMs, drainMs) { this.owner = owner; this.ttlMs = ttlMs; this.drainMs = drainMs; }
  check(model) { return !(model.pending.length > 0 && !(this.drainMs > 0)); }
  async run(model) {
    pruneModel(model);
    const priorLockId = model.holder && model.holder.owner === this.owner ? model.holder.lockId : null;
    const otherHolder = model.holder && model.holder.owner !== this.owner;
    const result = await stateMod.acquireLock(model.state, {
      owner: this.owner, ttlMs: this.ttlMs, drainTimeoutMs: this.drainMs,
    });
    if (model.stopping) {
      assert.equal(result.ok, false);
      assert.equal(result.code, 'dshd/host-stopping');
    } else if (otherHolder) {
      assert.equal(result.ok, false);
      assert.equal(result.code, 'dshd/lock-held');
      assert.equal(result.owner, model.holder.owner);
    } else if (model.pending.length > 0) {
      // Sequential model: admitted work can only end via Finish commands, so a
      // finite drain always ends unresolved — timeout, or superseded when the
      // TTL lapses first.
      assert.equal(result.ok, false, `acquire ${this.owner}`);
      assert.ok(['dshd/drain-timeout', 'dshd/lock-superseded'].includes(result.code), result.code);
      model.holder = null;
    } else {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.owner, this.owner);
      assert.ok(result.expiresAt > Date.now(), `expiresAt ${result.expiresAt}`);
      if (priorLockId) assert.equal(result.lockId, priorLockId, 'same-owner re-acquire keeps the lock identity');
      model.holder = { owner: this.owner, lockId: result.lockId, expiresAt: result.expiresAt };
    }
    checkStatus(model);
  }
  toString() { return `acquire(${this.owner},ttl=${this.ttlMs},drain=${this.drainMs})`; }
}

class ConcurrentAcquireCommand {
  constructor(owners, drainMs) { this.owners = owners; this.drainMs = drainMs; }
  check(model) { return !(model.pending.length > 0 && !(this.drainMs > 0)); }
  async run(model) {
    pruneModel(model);
    const priorHolder = model.holder;
    const results = await Promise.all(this.owners.map((owner) => stateMod.acquireLock(model.state, {
      owner, ttlMs: 60000, drainTimeoutMs: this.drainMs,
    })));
    const winners = results.filter((result) => result.ok === true);
    assert.ok(winners.length <= 1, `two lock holders: ${JSON.stringify(results)}`);
    if (model.stopping) {
      assert.ok(results.every((result) => result.code === 'dshd/host-stopping'));
    } else if (winners.length === 1) {
      const winner = winners[0];
      for (const result of results) {
        if (result === winner) continue;
        assert.equal(result.ok, false);
        assert.ok(['dshd/lock-held', 'dshd/drain-timeout', 'dshd/lock-superseded'].includes(result.code), result.code);
      }
      if (model.pending.length === 0) {
        model.holder = { owner: winner.owner, lockId: winner.lockId, expiresAt: winner.expiresAt };
      } else {
        model.holder = null;
      }
    } else if (priorHolder) {
      model.holder = priorHolder.expiresAt > Date.now() ? priorHolder : null;
    } else {
      model.holder = null;
    }
    checkStatus(model);
  }
  toString() { return `acquireConcurrent(${this.owners.join('|')})`; }
}

class DrainAcquireCommand {
  constructor(owner, workCount) { this.owner = owner; this.workCount = workCount; }
  check(model) { return !model.stopping && !model.holder; }
  async run(model) {
    while (model.pending.length < this.workCount) {
      const item = stateMod.admit(model.state, `work-${model.pending.length}`);
      assert.equal(item.accepted, true);
      model.pending.push(item);
    }
    const drained = model.pending.length;
    const attempt = stateMod.acquireLock(model.state, {
      owner: this.owner, ttlMs: 60000, drainTimeoutMs: 5000,
    });
    await tick();
    // While the drain is open, new admissions are refused with the lock code.
    const refused = stateMod.admit(model.state, 'late-work');
    assert.equal(refused.accepted, false);
    assert.equal(refused.code, stateMod.LOCKED_CODE);
    for (const item of model.pending.splice(0)) item.done();
    const result = await attempt;
    assert.equal(result.ok, true, JSON.stringify(result));
    // The drain reports exactly the set it waited for — nothing dropped.
    assert.equal(result.drainedPending, drained);
    model.holder = { owner: this.owner, lockId: result.lockId, expiresAt: result.expiresAt };
    checkStatus(model);
  }
  toString() { return `drainAcquire(${this.owner},${this.workCount})`; }
}

class ReleaseCommand {
  constructor(mode) { this.mode = mode; }
  check() { return true; }
  async run(model) {
    pruneModel(model);
    const holder = model.holder;
    const request = this.mode === 'matching' && holder
      ? { lockId: holder.lockId, owner: holder.owner }
      : this.mode === 'wrongOwner' && holder
        ? { lockId: holder.lockId, owner: 'someone-else' }
        : { lockId: 'no-such-lock', owner: 'nobody' };
    const result = stateMod.releaseLock(model.state, request);
    if (holder && this.mode === 'matching') {
      assert.deepEqual(result, { ok: true, released: true });
      model.holder = null;
    } else if (holder) {
      // A live lock refuses foreign release attempts; only its owner+id opens it.
      assert.equal(result.ok, false);
      assert.equal(result.code, 'dshd/lock-mismatch');
    } else {
      assert.deepEqual(result, { ok: true, released: false });
    }
    checkStatus(model);
  }
  toString() { return `release(${this.mode})`; }
}

class RenewCommand {
  constructor(mode, ttlMs) { this.mode = mode; this.ttlMs = ttlMs; }
  check(model) { return model.holder !== null; }
  async run(model) {
    const holder = model.holder;
    const request = this.mode === 'matching'
      ? { lockId: holder.lockId, owner: holder.owner, ttlMs: this.ttlMs }
      : { lockId: 'bogus', owner: holder.owner, ttlMs: this.ttlMs };
    const result = stateMod.renewLock(model.state, request);
    if (this.mode === 'matching') {
      assert.equal(result.ok, true);
      assert.ok(Math.abs(result.expiresAt - (Date.now() + this.ttlMs)) < 1000,
        `renew sets expiresAt ≈ now+ttl: got ${result.expiresAt}`);
      holder.expiresAt = result.expiresAt;
    } else {
      assert.equal(result.ok, false);
      assert.equal(result.code, 'dshd/lock-mismatch');
    }
    checkStatus(model);
  }
  toString() { return `renew(${this.mode})`; }
}

class SleepCommand {
  constructor(ms) { this.ms = ms; }
  check() { return true; }
  async run(model) {
    await sleep(this.ms);
    pruneModel(model);
    checkStatus(model);
  }
  toString() { return `sleep(${this.ms})`; }
}

class StopCommand {
  check() { return true; }
  async run(model) {
    model.state.stopping = true;
    model.stopping = true;
    const refused = stateMod.admit(model.state, 'post-stop');
    assert.equal(refused.accepted, false);
    assert.equal(refused.code, 'dshd/host-stopping');
    checkStatus(model);
  }
  toString() { return 'stop'; }
}

function pruneModel(model) {
  if (model.holder && model.holder.expiresAt <= Date.now()) model.holder = null;
}

function checkStatus(model) {
  pruneModel(model);
  const status = stateMod.lockStatus(model.state);
  assert.equal(status.pendingCount, model.pending.length,
    `pendingCount ${status.pendingCount} != model ${model.pending.length}`);
  if (model.holder) {
    assert.ok(status.lock !== null, 'model holds a lock the Host forgot');
    assert.equal(status.lock.owner, model.holder.owner);
    assert.equal(status.lock.lockId, model.holder.lockId);
    assert.ok(status.locked);
  } else {
    assert.equal(status.lock, null, `unexpected live lock ${JSON.stringify(status.lock)}`);
  }
}

const ownerArb = fc.constantFrom('desktop-quit', 'desktop-update', 'desktop-stop', 'watcher');
const hostCommandArbs = [
  fc.constantFrom('work-a', 'work-b', 'long-request').map((label) => new AdmitCommand(label)),
  fc.boolean().map((all) => new FinishCommand(all)),
  fc.tuple(ownerArb, fc.constantFrom(40, 120, 60000), fc.constantFrom(5, 25, 60))
    .map(([owner, ttl, drain]) => new AcquireCommand(owner, ttl, drain)),
  fc.tuple(fc.shuffledSubarray(['a', 'b', 'c'], { minLength: 2, maxLength: 3 }), fc.constantFrom(5, 30))
    .map(([owners, drain]) => new ConcurrentAcquireCommand(owners, drain)),
  fc.tuple(ownerArb, fc.integer({ min: 1, max: 3 })).map(([owner, n]) => new DrainAcquireCommand(owner, n)),
  fc.constantFrom('matching', 'wrongOwner', 'unknown').map((mode) => new ReleaseCommand(mode)),
  fc.tuple(fc.constantFrom('matching', 'wrong'), fc.constantFrom(50, 60000))
    .map(([mode, ttl]) => new RenewCommand(mode, ttl)),
  fc.integer({ min: 5, max: 150 }).map((ms) => new SleepCommand(ms)),
  fc.constant(null).map(() => new StopCommand()),
];

test('host lock state machine keeps a single holder, reclaims expiry and never drops drained work', async () => {
  await fuzzAssert(fc.asyncProperty(
    fc.commands(hostCommandArbs, { maxCommands: 26 }),
    async (commands) => {
      const model = { state: stateMod.createControlState(), pending: [], holder: null, stopping: false };
      try {
        await fc.asyncModelRun(() => ({ model, real: model.state }), commands);
      } finally {
        for (const item of model.pending.splice(0)) item.done();
      }
      checkStatus(model);
      return true;
    },
  ), 'host lock state machine keeps a single holder, reclaims expiry and never drops drained work', { numRuns: NUM_RUNS });
});

// ---------------------------------------------------------------------------
// Property B — shell coordinator over the real Host lock.
// ---------------------------------------------------------------------------

function makeCoordinatorFixture() {
  const state = stateMod.createControlState();
  const model = {
    state,
    committed: false,
    terminalOwner: null,
    terminalExpiresAt: 0,
    hostUp: true,
    confirmAnswer: true,
    commits: [],
    confirms: 0,
    fetchOps: [],
    pendingCleanups: 0,
    cleanupsRun: 0,
    work: [],
  };
  const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async (url, init) => {
    const op = String(url).slice(String(url).indexOf(CONTROL_PREFIX) + CONTROL_PREFIX.length + 1);
    const body = JSON.parse(init.body || '{}');
    model.fetchOps.push(op);
    if (!model.hostUp) throw new Error('fetch failed');
    if (op === 'inspect') {
      return jsonResponse({
        ok: true,
        hostGeneration: state.hostGeneration,
        activeWork: model.work.map((w) => ({ kind: w.kind, id: w.id })),
        scheduledWork: [],
        coverage: { agents: 'ok', jobs: 'ok', schedule: 'ok' },
      });
    }
    if (op === 'acquire') return jsonResponse(await stateMod.acquireLock(state, body));
    if (op === 'release') return jsonResponse(stateMod.releaseLock(state, body));
    if (op === 'renew') return jsonResponse(stateMod.renewLock(state, body));
    return jsonResponse({ ok: false, code: 'dshd/unknown-op' });
  };
  const protection = createTaskProtection({
    getBaseUrl: () => 'http://127.0.0.1:9',
    hostRunning: () => model.hostUp,
    confirm: async () => { model.confirms += 1; return model.confirmAnswer; },
    fetchImpl,
    acquireTtlMs: 80,
    drainTimeoutMs: 15,
    log: () => {},
  });
  protection.onCommitCleanup(() => { model.cleanupsRun += 1; });
  model.pendingCleanups = 1;
  return { model, protection };
}

function hostLockConsistent(model, action) {
  const status = stateMod.lockStatus(model.state);
  if (status.lock === null) return;
  // The only lock allowed to outlive a finished command is the terminal one —
  // the owner that latched `committed` (or one whose TTL already lapsed).
  if (model.terminalOwner && status.lock.owner === model.terminalOwner) return;
  assert.fail(`${action}: Host lock leaked to ${status.lock.owner} (terminal: ${model.terminalOwner || 'none'})`);
}

class CoordinateCommand {
  constructor(spec) { this.spec = spec; }
  check() { return true; }
  async run(model, real) {
    const { protection } = real;
    const spec = this.spec;
    const wasCommitted = model.committed;
    const dirty = model.work.some((w) => w.kind !== 'request') && model.hostUp;
    const opsBefore = model.fetchOps.length;
    const commitsBefore = model.commits.length;
    let thrown = null;
    let result = null;
    try {
      result = await protection.coordinate(spec.op, {
        terminal: spec.terminal,
        preConfirmed: spec.preConfirmed,
        force: spec.force,
        hostLock: spec.hostLock,
        drainTimeoutMs: spec.drainMs,
        commit: async () => {
          model.commits.push(spec.op);
          if (spec.commitThrow) throw new Error('commit-boom');
        },
      });
    } catch (error) {
      thrown = error;
    }
    const fetchDelta = model.fetchOps.slice(opsBefore);
    if (wasCommitted) {
      if (spec.commitThrow) {
        assert.ok(thrown && /commit-boom/.test(thrown.message), `op ${spec.op}`);
      } else {
        assert.equal(result.proceeded, true, JSON.stringify(result));
      }
      assert.equal(model.commits.length, commitsBefore + 1);
      assert.deepEqual(fetchDelta, [], `committed op ${spec.op} must not re-inspect`);
      return;
    }
    if (spec.commitThrow && result === null) {
      assert.ok(thrown && /commit-boom/.test(thrown.message), `op ${spec.op}`);
      // A failed commit gives the Host lock back and does not latch terminal.
      assert.equal(protection.isCommitted(), model.committed);
      const status = stateMod.lockStatus(model.state);
      if (status.lock !== null) {
        assert.equal(status.lock.owner, model.terminalOwner, `failed commit leaked lock to ${status.lock.owner}`);
      }
      return;
    }
    assert.equal(thrown, null, `coordinate threw unexpectedly: ${thrown && thrown.message}`);
    const hostWork = model.work.length;
    const acquireBlocked = model.hostUp && spec.hostLock !== false && hostWork > 0;
    if (dirty && !spec.preConfirmed && !model.confirmAnswer) {
      assert.equal(result.proceeded, false);
      assert.equal(result.code, 'cancelled');
      assert.equal(model.commits.length, commitsBefore);
      assert.ok(!fetchDelta.includes('acquire'), 'a user-cancelled op must never take the Host lock');
      hostLockConsistent(model, spec.op);
      return;
    }
    if (acquireBlocked && !spec.force) {
      assert.equal(result.proceeded, false, JSON.stringify(result));
      assert.equal(model.commits.length, commitsBefore);
      hostLockConsistent(model, spec.op);
      return;
    }
    assert.equal(result.proceeded, true, JSON.stringify(result));
    assert.equal(model.commits.length, commitsBefore + 1);
    if (model.hostUp) assert.equal(fetchDelta[0], 'inspect', `op ${spec.op} must inspect first`);
    if (acquireBlocked) assert.ok(result.forced && result.forced.code, 'forced result carries the acquire failure');
    if (spec.terminal) {
      model.committed = true;
      model.terminalOwner = `desktop-${spec.op}`;
      const status = stateMod.lockStatus(model.state);
      model.terminalExpiresAt = status.lock ? status.lock.expiresAt : 0;
      assert.equal(protection.isCommitted(), true);
    }
    hostLockConsistent(model, spec.op);
  }
  toString() { return `coordinate(${JSON.stringify(this.spec)})`; }
}

class BurstCoordinateCommand {
  constructor(opA, opB) { this.opA = opA; this.opB = opB; }
  check() { return true; }
  async run(model, real) {
    const { protection } = real;
    const specOf = (op) => ({ commit: async () => { model.commits.push(op); } });
    const commitsBefore = model.commits.length;
    const [a, b] = await Promise.all([
      protection.coordinate(this.opA, specOf(this.opA)),
      protection.coordinate(this.opB, specOf(this.opB)),
    ]);
    if (model.committed) {
      assert.equal(a.proceeded, true);
      assert.equal(b.proceeded, true);
      assert.equal(model.commits.length, commitsBefore + 2);
      return;
    }
    // The first call latches `coordinating` before its first await; the second
    // always sees busy. Exactly one may proceed.
    assert.equal(b.proceeded, false);
    assert.equal(b.code, 'busy');
    const dirty = model.work.some((w) => w.kind !== 'request');
    const hostWork = model.work.length;
    const aBlocked = model.hostUp && hostWork > 0;
    if (dirty && !model.confirmAnswer) {
      assert.equal(a.proceeded, false);
      assert.equal(a.code, 'cancelled');
    } else if (aBlocked) {
      assert.equal(a.proceeded, false, JSON.stringify(a));
    } else {
      assert.equal(a.proceeded, true, JSON.stringify(a));
    }
    hostLockConsistent(model, 'burst');
  }
  toString() { return `burstCoordinate(${this.opA}+${this.opB})`; }
}

class SpawnWorkCommand {
  constructor(kind) { this.kind = kind; }
  check() { return true; }
  async run(model) {
    const item = stateMod.admit(model.state, this.kind);
    if (item.accepted) {
      model.work.push({ id: `w${model.work.length}`, kind: this.kind, done: item.done });
    } else {
      // Refused only while the terminal lock still lives.
      assert.ok(model.terminalOwner && item.code === stateMod.LOCKED_CODE,
        `admit refused without a live terminal lock: ${item.code}`);
    }
    hostLockConsistent(model, 'spawnWork');
  }
  toString() { return `spawnWork(${this.kind})`; }
}

class FinishWorkCommand {
  check(model) { return model.work.length > 0; }
  async run(model) {
    for (const item of model.work.splice(0)) item.done();
  }
  toString() { return 'finishWork'; }
}

class FlipCommand {
  constructor(kind, value) { this.kind = kind; this.value = value; }
  check() { return true; }
  async run(model, real) {
    if (this.kind === 'hostUp') model.hostUp = this.value;
    else if (this.kind === 'confirm') model.confirmAnswer = this.value;
    else if (this.kind === 'cleanup') {
      const before = model.cleanupsRun;
      await real.protection.cleanupAfterQuit();
      // Registered cleanups splice out on the first run; later calls are no-ops.
      assert.equal(model.cleanupsRun, before + (before < model.pendingCleanups ? 1 : 0));
    } else if (this.kind === 'sleep') {
      await sleep(this.value);
    }
    hostLockConsistent(model, `flip:${this.kind}`);
  }
  toString() { return `flip(${this.kind},${JSON.stringify(this.value)})`; }
}

const opArb = fc.constantFrom('quit', 'stop', 'update', 'restart', 'reload', 'install', 'delta');
const coordinateArb = fc.record({
  op: opArb,
  terminal: fc.boolean(),
  preConfirmed: fc.boolean(),
  force: fc.boolean(),
  hostLock: fc.constantFrom(true, false),
  commitThrow: fc.boolean(),
  drainMs: fc.constantFrom(5, 15, 60),
}).map((spec) => new CoordinateCommand(spec));

const coordinatorCommandArbs = [
  coordinateArb,
  fc.tuple(opArb, opArb).map(([a, b]) => new BurstCoordinateCommand(a, b)),
  fc.constantFrom('request', 'agent').map((kind) => new SpawnWorkCommand(kind)),
  fc.constant(null).map(() => new FinishWorkCommand()),
  fc.tuple(fc.constant('hostUp'), fc.boolean()).map(([k, v]) => new FlipCommand(k, v)),
  fc.tuple(fc.constant('confirm'), fc.boolean()).map(([k, v]) => new FlipCommand(k, v)),
  fc.constant(null).map(() => new FlipCommand('cleanup')),
  fc.tuple(fc.constant('sleep'), fc.integer({ min: 20, max: 120 })).map(([k, v]) => new FlipCommand(k, v)),
];

test('coordinator serializes protected operations, honours drain/confirm gates and never leaks the Host lock', async () => {
  await fuzzAssert(fc.asyncProperty(
    fc.commands(coordinatorCommandArbs, { maxCommands: 24 }),
    async (commands) => {
      const fixture = makeCoordinatorFixture();
      const model = fixture.model;
      try {
        await fc.asyncModelRun(() => ({ model, real: fixture }), commands);
      } finally {
        for (const item of model.work.splice(0)) item.done();
      }
      hostLockConsistent(model, 'teardown');
      return true;
    },
  ), 'coordinator serializes protected operations, honours drain/confirm gates and never leaks the Host lock', { numRuns: NUM_RUNS });
});

// inspectionClean is the model the coordinator's dirty-gate reads; pin it once
// so the model above stays honest.
test('inspectionClean matches the modeled clean/dirty classification', () => {
  assert.equal(inspectionClean({ ok: true, activeWork: [], scheduledWork: [], coverage: { a: 'ok' } }), true);
  assert.equal(inspectionClean({ ok: true, activeWork: [{ kind: 'request', id: 'p' }], scheduledWork: [], coverage: {} }), true);
  assert.equal(inspectionClean({ ok: true, activeWork: [{ kind: 'agent', id: 'a' }], scheduledWork: [], coverage: {} }), false);
});
