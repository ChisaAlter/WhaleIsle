'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  LEVELS,
  levelFor,
  nextLevelAt,
  levelName,
  usageTokens,
  usageSampleOf,
  tokensInLog,
  scanSessionTokens,
  scanUsage,
  readMagpieUsage,
  magpieUsageFile,
  inheritedCut,
  ACCOUNTING_VERSION,
  normalizeGrowthState,
  createGrowthTracker,
  createScanWorker,
  dayKey,
} = require('./pet-growth');

// ── levels ──

test('levelFor maps cumulative points onto the ten thresholds', () => {
  assert.equal(LEVELS.length, 10);
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(99_999_999), 1);
  assert.equal(levelFor(100_000_000), 2);          // 1亿 → 小鲸
  assert.equal(levelFor(299_999_999), 2);
  assert.equal(levelFor(300_000_000), 3);          // 3亿 → 干饭鲸
  assert.equal(levelFor(599_999_999), 3);
  assert.equal(levelFor(600_000_000), 4);          // 6亿 → 鲸鱼娘
  assert.equal(levelFor(1_199_999_999), 4);
  assert.equal(levelFor(1_200_000_000), 5);        // 12亿 → 大肥鱼
  assert.equal(levelFor(2_199_999_999), 5);
  assert.equal(levelFor(2_200_000_000), 6);        // 22亿 → 干饭大王
  assert.equal(levelFor(3_999_999_999), 6);
  assert.equal(levelFor(4_000_000_000), 7);        // 40亿 → 米饭女帝
  assert.equal(levelFor(7_000_000_000), 8);        // 70亿 → 鲸吞四海
  assert.equal(levelFor(12_000_000_000), 9);       // 120亿 → 星海饭皇
  assert.equal(levelFor(20_000_000_000), 10);      // 200亿 → 干饭真神
  assert.equal(levelFor(9e10), 10);
});

test('nextLevelAt / levelName stay in sync and cap at the final level', () => {
  assert.equal(nextLevelAt(0), 100_000_000);
  assert.equal(nextLevelAt(300_000_000), 600_000_000);
  assert.equal(nextLevelAt(20_000_000_000), null);
  assert.equal(levelName(0), '幼鲸');
  assert.equal(levelName(1_200_000_000), '大肥鱼');
  assert.equal(levelName(20_000_000_000), '干饭真神');
});

// ── usage extraction ──

test('usageTokens counts uncached input + output only', () => {
  assert.equal(usageTokens(undefined), 0);
  assert.equal(usageTokens('nope'), 0);
  assert.equal(usageTokens({}), 0);
  assert.equal(usageTokens({
    inputTokens: 10, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 5,
  }), 15);
  assert.equal(usageTokens({ outputTokens: 7 }), 7);
  // Cache reads are re-read context, not spend: Magpie bills them separately
  // and its headline "tokens" is in + out.
  assert.equal(usageTokens({ cacheReadTokens: 9_000_000, cacheWriteTokens: 5_000 }), 0);
  assert.equal(usageTokens({ inputTokens: 4, cacheReadTokens: 999_999, outputTokens: 6 }), 10);
});

test('usageSampleOf reads settlements, usage chunks and compaction only', () => {
  const usage = { inputTokens: 4, outputTokens: 6 };
  assert.deepEqual(
    usageSampleOf({ type: 'assistant/message', data: { turn: 1, step: 2, usage } }),
    { turn: 1, step: 2, usage },
  );
  assert.equal(
    usageSampleOf({ type: 'assistant/message', data: { turn: 1, step: 2 } }),
    undefined,
  );
  assert.deepEqual(
    usageSampleOf({
      type: 'assistant/attempt',
      data: { turn: 3, step: 0, chunk: { type: 'usage', usage } },
    }),
    { turn: 3, step: 0, usage },
  );
  // A stream array resolves to its last usage chunk.
  const older = { inputTokens: 1 };
  assert.deepEqual(
    usageSampleOf({
      type: 'assistant/chunk',
      data: {
        turn: 5, step: 1,
        stream: [
          { type: 'usage', usage: older },
          { type: 'text' },
          { type: 'usage', usage },
        ],
      },
    }),
    { turn: 5, step: 1, usage },
  );
  assert.deepEqual(
    usageSampleOf({ type: 'compaction/summary', seq: 9, data: { usage } }),
    { turn: -1, step: 9, usage },
  );
  // Content-bearing events never leak a sample.
  assert.equal(usageSampleOf({ type: 'user/message', data: { turn: 1 } }), undefined);
  assert.equal(usageSampleOf({ type: 'tool/result', data: {} }), undefined);
  assert.equal(usageSampleOf({}), undefined);
});

// ── log folding ──

test('tokensInLog dedupes per (turn,step) with last-wins semantics', () => {
  const lines = [
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 100, cacheReadTokens: 40_000 } } }),
    // Retried attempt: later settlement replaces the earlier 100.
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 130, cacheReadTokens: 90_000, cacheWriteTokens: 2_000 } } }),
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 1, usage: { outputTokens: 40 } } }),
    JSON.stringify({ type: 'user/message', data: { turn: 0, text: 'secret' } }),
    'not json at all',
    '{broken json',
    '',
    JSON.stringify({ type: 'compaction/summary', seq: 2, data: { usage: { inputTokens: 10, outputTokens: 5 } } }),
  ].join('\n');
  assert.equal(tokensInLog(lines), 130 + 40 + 15);
});

// ── fork (seeded) prefix exclusion ──

function sessionHeader(extra = {}) {
  return {
    type: 'session', version: 4, id: 'session-child', createdAt: 1,
    cwd: 'C:/ws', isSeeded: false, delegationDepth: 0, ...extra,
  };
}

test('tokensInLog skips the inherited prefix of a seeded log', () => {
  const lines = [
    sessionHeader({ isSeeded: true, parentSession: 'session-parent' }),
    // Parent prefix: real spend, but already billed by the parent's own log.
    { seq: 0, type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 1000, cacheReadTokens: 5_000_000 } } },
    { seq: 1, type: 'assistant/message', data: { turn: 0, step: 1, usage: { inputTokens: 2000 } } },
    // The cut: the LAST marker carrying inherited:true.
    { seq: 2, type: 'session/end-seed', data: { inherited: true } },
    // Child-owned work restarts turn/step, so it reuses (0,0) — it must add,
    // not overwrite the prefix slot.
    { seq: 3, type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 50, outputTokens: 5 } } },
    { seq: 4, type: 'assistant/message', data: { turn: 0, step: 1, usage: { inputTokens: 70 } } },
  ].map((line) => JSON.stringify(line)).join('\n');
  assert.equal(tokensInLog(lines), 55 + 70);
  assert.equal(inheritedCut(lines), 2);
});

test('inheritedCut prefers the last inherited marker and ignores restore markers', () => {
  const lines = [
    sessionHeader({ isSeeded: true, parentSession: 'session-parent' }),
    { seq: 1, type: 'session/end-seed', data: { inherited: true } },
    { seq: 2, type: 'session/end-seed', data: {} }, // restore-time lifecycle marker
    { seq: 9, type: 'session/end-seed', data: { inherited: true } },
    { seq: 10, type: 'session/end-seed', data: {} },
  ].map((line) => JSON.stringify(line)).join('\n');
  assert.equal(inheritedCut(lines), 9);
  // Unseeded logs and headerless fixtures count everything.
  assert.equal(inheritedCut(JSON.stringify(sessionHeader())), 0);
  assert.equal(inheritedCut(JSON.stringify({ type: 'assistant/message', data: {} })), 0);
  // Legacy v1 physical headers carry the prefix length instead of the marker.
  assert.equal(inheritedCut(JSON.stringify(sessionHeader({ isSeeded: true, seedLength: 7 }))), 7);
});

test('scanSessionTokens counts a fork once and keeps child slots distinct', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-fork-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seeded = [
    sessionHeader({ isSeeded: true, parentSession: 'session-parent' }),
    { seq: 0, type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 1000 } } },
    { seq: 1, type: 'session/end-seed', data: { inherited: true } },
    { seq: 2, type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 300 } } },
  ];
  writeLog(root, 'child', 'session.v4.jsonl.zstd', seeded);
  // A migrated generation holds the same events: counted once, not twice.
  writeLog(root, 'child', 'session.v2.jsonl.zstd', seeded);
  const res = scanSessionTokens(root);
  assert.equal(res.total, 300, 'prefix 1000 stays with the parent; child slot counted once');
  assert.equal(res.sessions, 1);
});

test('tokensInLog on empty input returns zero', () => {
  assert.equal(tokensInLog(''), 0);
  assert.equal(tokensInLog('\n\n'), 0);
});

// ── filesystem scan ──

function writeLog(root, sessionId, name, events) {
  const dir = path.join(root, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, name), zlib.zstdCompressSync(Buffer.from(body, 'utf8')));
}

test('scanSessionTokens aggregates session*.jsonl.zstd across nested dirs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 50, outputTokens: 50 } } },
  ]);
  writeLog(root, 'b', 'session.v2.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { outputTokens: 30 } } },
  ]);
  // Unrelated files and corrupt archives are skipped, not fatal.
  writeLog(root, 'c', 'session.jsonl.zstd', []);
  fs.writeFileSync(path.join(root, 'b', 'session.extra.jsonl.zstd'),
    zlib.zstdCompressSync(Buffer.from('{"type":"assistant/message","data":{"usage":{"inputTokens":999}}}')));
  fs.writeFileSync(path.join(root, 'b', 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(root, 'b', 'session.jsonl.zstd'), Buffer.from([1, 2, 3]));
  // Real desktop sessions use versioned names (v2, v3…) and multi-frame
  // archives (one zstd frame per appended event batch).
  const dirD = path.join(root, 'd');
  fs.mkdirSync(dirD);
  const frameA = zlib.zstdCompressSync(Buffer.from(
    JSON.stringify({ type: 'session' }) + '\n'
    + JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 7 } } }) + '\n'));
  const frameB = zlib.zstdCompressSync(Buffer.from(
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 1, usage: { inputTokens: 8 } } }) + '\n'));
  fs.writeFileSync(path.join(dirD, 'session.v3.jsonl.zstd'), Buffer.concat([frameA, frameB]));
  const res = scanSessionTokens(root);
  assert.equal(res.total, 100 + 30 + 15);
  assert.equal(res.sessions, 4); // a + b/v2 + c (empty) + d/v3; corrupt b log skipped
});

test('one session dir folds only its highest canonical generation', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 800 } } };
  writeLog(root, 'migrated', 'session.jsonl.zstd', [
    shared,
    { type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 200 } } },
    // Present only in the superseded generation: folding it would add 999.
    { type: 'assistant/message', data: { turn: 1, step: 4, usage: { inputTokens: 999 } } },
  ]);
  // The v2 copy re-states step 1 and adds a migrated-only step 3.
  writeLog(root, 'migrated', 'session.v2.jsonl.zstd', [
    shared,
    { type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 200 } } },
    { type: 'assistant/message', data: { turn: 1, step: 3, usage: { inputTokens: 100 } } },
  ]);
  // v0 keeps the plain name; a `.v0` artifact is not canonical.
  writeLog(root, 'plain', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 5 } } },
  ]);
  writeLog(root, 'plain', 'session.v0.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 9999 } } },
  ]);
  const res = scanSessionTokens(root);
  assert.equal(res.sessions, 2);
  assert.equal(res.total, 800 + 200 + 100 + 5, 'old generations and non-canonical names never count');
});

test('scanSessionTokens on a missing dir returns zeros', () => {
  const res = scanSessionTokens(path.join(os.tmpdir(), 'definitely-not-here-pet-growth'));
  assert.deepEqual(res, { total: 0, sessions: 0 });
});

test('scanSessionTokens cache replays unchanged files and tracks changes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = new Map();
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 100 } } },
  ]);
  let res = scanSessionTokens(root, cache);
  assert.equal(res.total, 100);
  assert.equal(cache.size, 1);
  // Unchanged file replays its folded usage without a re-decode.
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 100);
  assert.equal(cache.size, 1);
  // A new session directory decodes once and joins the cache.
  writeLog(root, 'b', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { inputTokens: 50 } } },
  ]);
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 150);
  assert.equal(cache.size, 2);
  // A generation rewrite supersedes the old file: the new generation decodes,
  // the stale generation's cache entry is evicted, and the total follows it.
  writeLog(root, 'a', 'session.v2.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 120 } } },
  ]);
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 170);
  assert.equal(cache.size, 2);
  // A deleted file is evicted and leaves the total.
  fs.rmSync(path.join(root, 'b'), { recursive: true });
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 120);
  assert.equal(cache.size, 1);
  // A torn write decodes as "nothing clean yet" and contributes zero; once the
  // tail heals the size key changes and the healed frames join the total.
  const good = zlib.zstdCompressSync(Buffer.from('{"type":"assistant/message","data":{"usage":{"inputTokens":7}}}\n'));
  fs.writeFileSync(path.join(root, 'a', 'session.v2.jsonl.zstd'), good.subarray(0, good.length - 2));
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 0);
  fs.writeFileSync(path.join(root, 'a', 'session.v2.jsonl.zstd'), good);
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 7);
});


// ── Magpie usage (preferred source) ──

function writeMagpie(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function localIso(dayOffset, hours, minutes) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

test('readMagpieUsage bills dsh rows as in + out and keeps cache separate', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-magpie-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'usage.jsonl');
  writeMagpie(file, [
    { route_id: 101, t: localIso(0, 9, 15), agent: 'dsh', provider: 'deepseek', model: 'v4', in: 1000, out: 200, cache_read: 900_000, cache_write: 5, session: 'session-a', status: 200 },
    { route_id: 102, t: localIso(0, 10, 5), agent: 'dsh', provider: 'deepseek', model: 'v4', in: 300, out: 30, cache_read: 10, session: 'session-b', status: 200 },
    // Yesterday's row: all-time only, never "今日".
    { route_id: 103, t: localIso(-1, 23, 30), agent: 'dsh', provider: 'deepseek', model: 'v4', in: 7000, out: 700, cache_read: 1_000_000, session: 'session-a', status: 200 },
    // Another agent's spend is not the harness's.
    { route_id: 104, t: localIso(0, 11, 0), agent: 'codex', provider: 'openai', model: 'gpt', in: 5_000_000, out: 5_000_000, session: 'codex-1', status: 200 },
    // Rejected call with no route: zero tokens, no credited sample.
    { t: localIso(0, 12, 0), agent: 'dsh', provider: '', model: 'gpt', in: 0, out: 0, session: 'session-a', status: 404 },
  ]);
  const usage = readMagpieUsage(file);
  assert.ok(usage);
  assert.equal(usage.total, 9230, 'all dsh in+out; cache and codex ignored');
  assert.equal(usage.todayUsed, 1530, 'only the local day, still in+out');
  assert.equal(usage.calls, 4);
  assert.equal(usage.sessions, 2);
  const keys = Object.keys(usage.sampleTotals);
  assert.equal(keys.length, 3, 'one credited sample per request route');
  assert.equal(Math.max(...Object.values(usage.sampleTotals)), 7700);
  assert.equal(Math.min(...Object.values(usage.sampleTotals)), 330);
  for (const key of keys) {
    assert.match(key, /^[a-f0-9]{64}$/);
  }
  // A route is credited once even when the file is read again.
  const again = readMagpieUsage(file);
  assert.deepEqual(again.sampleTotals, usage.sampleTotals);
  assert.deepEqual(again.total, usage.total);
  // Absent file → no Magpie answer (the caller falls back to logs).
  assert.equal(readMagpieUsage(path.join(root, 'nope.jsonl')), null);
  assert.equal(readMagpieUsage(''), null);
  // A file that only holds other agents' traffic does not cover this harness.
  const foreign = path.join(root, 'codex-only.jsonl');
  writeMagpie(foreign, [
    { route_id: 9, t: localIso(0, 9, 0), agent: 'codex', in: 10, out: 10, session: 'codex-1' },
  ]);
  assert.equal(readMagpieUsage(foreign), null);
});

test('magpieUsageFile honours MAGPIE_USAGE_FILE and otherwise uses the home path', () => {
  assert.equal(magpieUsageFile({ MAGPIE_USAGE_FILE: 'D:/magpie/usage.jsonl' }), 'D:/magpie/usage.jsonl');
  assert.equal(magpieUsageFile({ MAGPIE_USAGE_FILE: '   ' }), magpieUsageFile({}));
  assert.match(magpieUsageFile({}), /magpie[\\/]usage\.jsonl$/);
});

test('scanUsage prefers Magpie and falls back to session logs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionsDir = path.join(root, 'sessions');
  writeLog(sessionsDir, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500, cacheReadTokens: 80_000 } } },
  ]);
  const usageFile = path.join(root, 'magpie', 'usage.jsonl');
  writeMagpie(usageFile, [
    { route_id: 7, t: localIso(0, 8, 0), agent: 'dsh', in: 1200, out: 300, cache_read: 10, session: 'session-a' },
  ]);
  const fromMagpie = scanUsage({ sessionsDir, usageFile, includeSamples: true });
  assert.equal(fromMagpie.source, 'magpie');
  assert.equal(fromMagpie.total, 1500);
  assert.equal(fromMagpie.todayUsed, 1500);
  assert.equal(Object.keys(fromMagpie.sampleTotals).length, 1);
  const fromLogs = scanUsage({ sessionsDir, usageFile: '', includeSamples: true });
  assert.equal(fromLogs.source, undefined);
  assert.equal(fromLogs.total, 500);
  assert.equal(typeof fromLogs.sampleTotals, 'object');
  // A Magpie log without dsh rows is not a source for this harness.
  const foreign = path.join(root, 'magpie', 'codex.jsonl');
  writeMagpie(foreign, [
    { route_id: 8, t: localIso(0, 8, 0), agent: 'codex', in: 7000, out: 7000, session: 'codex-1' },
  ]);
  const uncovered = scanUsage({ sessionsDir, usageFile: foreign, includeSamples: true });
  assert.equal(uncovered.source, undefined);
  assert.equal(uncovered.total, 500);
});

// ── state normalization ──

test('normalizeGrowthState floors values and rejects negatives/NaN', () => {
  const base = { points: 0, tokensFed: 0, tokensSeen: 0, baseline: null, today: null };
  assert.deepEqual(normalizeGrowthState(undefined), base);
  assert.deepEqual(normalizeGrowthState(null), base);
  assert.deepEqual(normalizeGrowthState({ points: 12.9, tokensFed: -3, tokensSeen: 'x' }),
    { ...base, points: 12 });
  assert.deepEqual(normalizeGrowthState({ baseline: 1234.9 }),
    { ...base, baseline: 1234 });
  // Legacy (v1) accounting is preserved as "no marker" so the first refresh
  // still knows to migrate it; v2 round-trips through config normalization.
  assert.deepEqual(normalizeGrowthState({ accountingVersion: 1, points: 7 }), { ...base, points: 7 });
  assert.deepEqual(normalizeGrowthState({ accountingVersion: 9, points: 7 }), { ...base, points: 7 });
  assert.equal(normalizeGrowthState({ accountingVersion: ACCOUNTING_VERSION, points: 7 }).accountingVersion, 2);
});

test('normalizeGrowthState keeps the ledger source and rejects malformed ledgers', () => {
  const digest = (n) => String(n).repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, 'a');
  const ledger = { version: 1, source: 'magpie', available: 12, seen: { [digest(1)]: 34 } };
  assert.deepEqual(normalizeGrowthState({ food: ledger }).food,
    { version: 1, source: 'magpie', available: 12, seen: { [digest(1)]: 34 } });
  // A pre-marker ledger reports an empty source so a switch can be detected.
  assert.equal(normalizeGrowthState({ food: { ...ledger, source: undefined } }).food.source, '');
  assert.equal(normalizeGrowthState({ food: { ...ledger, seen: { short: 1 } } }).food, undefined);
  assert.equal(normalizeGrowthState({ food: { ...ledger, available: -1 } }).food, undefined);
});

// ── tracker ──

function trackerWith(root, initial, scanTokens, usageFile = '') {
  let stored = initial;
  const writes = [];
  const scanCache = new Map();
  const tracker = createGrowthTracker({
    sessionsDir: root,
    getGrowth: () => stored,
    saveGrowth: (next) => { writes.push(next); stored = next; },
    // Bookkeeping tests inject the in-process scan so no worker spawns;
    // the default worker path has its own coverage below.
    scanTokens: scanTokens || ((dir) => scanSessionTokens(dir, scanCache)),
    // Never read this machine's real Magpie log from a fixture test.
    usageFile,
  });
  return { tracker, writes, read: () => stored };
}

test('refresh folds cumulative scan totals into state monotonically', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 700 } } },
  ]);
  const { tracker, read } = trackerWith(root, undefined);
  let g = await tracker.refresh();
  assert.equal(g.tokensSeen, 700);
  assert.equal(g.points, 0);
  // Rescanning the same corpus is a no-op — no double counting.
  g = await tracker.refresh();
  assert.equal(g.tokensSeen, 700);
  assert.equal(read().tokensSeen, 700);
  // Corpus growth lifts the ceiling.
  writeLog(root, 'b', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { inputTokens: 300 } } },
  ]);
  g = await tracker.refresh();
  assert.equal(g.tokensSeen, 1000);
});

test('refresh keeps the fed credit when the corpus shrank', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500 } } },
  ]);
  const { tracker } = trackerWith(root, {
    accountingVersion: ACCOUNTING_VERSION, points: 400, tokensFed: 400, tokensSeen: 0,
  });
  await tracker.refresh();
  // Delete the corpus → feedable can never go negative.
  fs.rmSync(path.join(root, 'a'), { recursive: true });
  const g = await tracker.refresh();
  assert.equal(g.tokensSeen, 0);
  assert.equal(g.tokensFed, 400); // credit kept — a restored corpus can't re-feed
  assert.equal(g.points, 400); // earned growth is never revoked
  assert.equal(tracker.feedable(g), 0);
  // Restore the corpus → only the truly-new 100 is feedable.
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500 } } },
  ]);
  const back = await tracker.refresh();
  assert.equal(back.tokensSeen, 500);
  assert.equal(tracker.feedable(back), 100);
});

test('feed consumes feedable tokens idempotently and detects level-ups', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 250_000_000 } } },
  ]);
  const { tracker } = trackerWith(root, {
    accountingVersion: ACCOUNTING_VERSION, points: 0, tokensFed: 0, tokensSeen: 0, baseline: 0,
  });
  await tracker.refresh();
  // One meal fills at most the current level — 2.5亿 feedable caps at the
  // 小鲸 threshold (1亿), leaving 1.5亿 for the next feeding.
  const res = tracker.feed();
  assert.equal(res.fed, 100_000_000);
  assert.equal(res.points, 100_000_000);
  assert.equal(res.level, 2);
  assert.equal(res.levelName, '小鲸');
  assert.equal(res.leveledUp, true);
  assert.equal(res.feedable, 150_000_000);
  assert.equal(res.nextFeed, 150_000_000);
  const again = tracker.feed();
  assert.equal(again.fed, 150_000_000);
  assert.equal(again.points, 250_000_000);
  assert.equal(again.level, 2); // still short of 干饭鲸 at 3亿
  assert.equal(again.leveledUp, false);
  assert.equal(tracker.feed().fed, 0); // bowl empty
});

test('feed(amount) clamps to what is actually feedable', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 100 } } },
  ]);
  const { tracker, read } = trackerWith(root, { accountingVersion: ACCOUNTING_VERSION, baseline: 0 });
  await tracker.refresh();
  const res = tracker.feed(5000);
  assert.equal(res.fed, 100);
  assert.equal(read().tokensFed, 100);
  assert.equal(tracker.feed(0).fed, 0);
  assert.equal(tracker.feed(-5).fed, 0);
});

test('a mid-level feed reports progress without a level-up', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500 } } },
  ]);
  const { tracker } = trackerWith(root, {
    accountingVersion: ACCOUNTING_VERSION, points: 100, tokensFed: 0, tokensSeen: 0, baseline: 0,
  });
  await tracker.refresh();
  const res = tracker.feed();
  assert.equal(res.fed, 500);
  assert.equal(res.level, 1);
  assert.equal(res.leveledUp, false);
  assert.equal(res.nextAt, 100_000_000);
});

test('first scan plants the watermark — backlog is never food', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 12000 } } },
  ]);
  const { tracker } = trackerWith(root, { points: 0, tokensFed: 0, tokensSeen: 0 });
  const g = await tracker.refresh();
  assert.equal(g.baseline, 12000);
  assert.equal(tracker.feedable(g), 0);
  assert.equal(tracker.feed().fed, 0);
  // Tokens burned AFTER the watermark are real food.
  writeLog(root, 'b', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 3000 } } },
  ]);
  const g2 = await tracker.refresh();
  assert.equal(g2.tokensSeen, 15000);
  assert.equal(tracker.feedable(g2), 3000);
  assert.equal(tracker.feed().fed, 3000);
});

test('accounting v2 migration keeps points and retires the stale fed debt', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500 } } },
  ]);
  // Backlog-era state: she already ate 400 of the 500-token corpus.
  const { tracker } = trackerWith(root, { points: 400, tokensFed: 400, tokensSeen: 0 });
  const g = await tracker.refresh();
  assert.equal(g.accountingVersion, ACCOUNTING_VERSION);
  assert.equal(g.tokensSeen, 500);
  assert.equal(g.baseline, 500); // the corrected total is the new watermark
  assert.equal(g.tokensFed, 0); // the old debt counter is retired
  assert.equal(g.points, 400); // earned growth is never revoked
  assert.equal(tracker.feedable(g), 0);
  // Her old fed credit does NOT bill against tokens burned post-upgrade.
  writeLog(root, 'b', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 200 } } },
  ]);
  const g2 = await tracker.refresh();
  assert.equal(tracker.feedable(g2), 200);
});

test('migration from the 1.85B cache-inflated state cannot dead-lock the bowl', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const todayKey = dayKey();
  const sampleTotals = {
    ['a'.repeat(64)]: 22_258_958,
    ['b'.repeat(64)]: 200_995_458,
  };
  let scan = {
    total: 223_254_416,
    sessions: 47_042,
    todayUsed: 22_258_958,
    source: 'magpie',
    sampleTotals,
  };
  // The shipped state: tokensSeen counted cache reads and fork prefixes, the
  // food ledger came from the old (turn,step) keys and tokensFed was far above
  // the corrected corpus.
  const { tracker, read } = trackerWith(root, {
    points: 0,
    tokensFed: 0,
    tokensSeen: 1_853_886_990,
    baseline: 1_791_939_076,
    today: { day: '2026-10-19', used: 61_947_914 },
    food: { version: 1, available: 61_947_914, seen: { ['c'.repeat(64)]: 61_947_914 } },
  }, () => scan);
  const g = await tracker.refresh();
  assert.equal(g.accountingVersion, ACCOUNTING_VERSION);
  assert.equal(g.tokensSeen, 223_254_416);
  assert.equal(g.baseline, 223_254_416, 'baseline follows the corrected total');
  assert.equal(g.tokensFed, 0);
  assert.equal(g.points, 0);
  assert.deepEqual(g.today, { day: todayKey, used: 22_258_958 });
  assert.deepEqual(g.food, { version: 1, source: 'magpie', available: 0, seen: sampleTotals });
  assert.equal(tracker.feedable(g), 0, 'history is not retroactive food');
  assert.equal(tracker.feed().fed, 0);
  // Rescanning the same Magpie corpus credits nothing twice.
  assert.equal(tracker.feedable(await tracker.refresh()), 0);
  assert.equal(read().tokensSeen, 223_254_416);
  // Consumer spend written after the migration is edible again.
  scan = {
    ...scan,
    total: 223_254_416 + 5000,
    todayUsed: 22_258_958 + 5000,
    sampleTotals: { ...sampleTotals, ['d'.repeat(64)]: 5000 },
  };
  const after = await tracker.refresh();
  assert.equal(tracker.feedable(after), 5000);
  assert.equal(tracker.feed().points, 5000);
  // The stale day is gone; the old day's 61.9M never leaks into "今日".
  assert.equal(tracker.snapshot().todayUsed, 22_258_958 + 5000);
});

test('migration preserves the earned level of a progressed pet', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-level-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { tracker, read } = trackerWith(root, {
    points: 350_576_917,
    tokensFed: 46_861_950,
    tokensSeen: 1_853_886_990,
    baseline: 1_791_939_076,
    food: { version: 1, available: 61_947_914, seen: { ['e'.repeat(64)]: 61_947_914 } },
  }, () => ({ total: 223_254_416, sessions: 47_042, todayUsed: 0, source: 'magpie', sampleTotals: {} }));
  const g = await tracker.refresh();
  assert.equal(g.points, 350_576_917);
  assert.equal(read().accountingVersion, ACCOUNTING_VERSION);
  const snap = tracker.snapshot();
  assert.equal(snap.level, levelFor(350_576_917));
  assert.equal(snap.level, 3); // 3亿 → 干饭鲸
  assert.equal(snap.levelName, '干饭鲸');
  assert.equal(snap.todayUsed, 0);
});

test('a same-source scan credits only newly observed requests', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-rescan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let scan = {
    total: 1000,
    sessions: 2,
    source: 'magpie',
    todayUsed: 1000,
    sampleTotals: { ['1'.repeat(64)]: 300, ['2'.repeat(64)]: 700 },
  };
  const { tracker } = trackerWith(root, {
    accountingVersion: ACCOUNTING_VERSION,
    points: 0, tokensFed: 0, tokensSeen: 0, baseline: 0,
  }, () => scan);
  await tracker.refresh();
  assert.equal(tracker.feedable(), 1000);
  await tracker.refresh();
  assert.equal(tracker.feedable(), 1000, 'unchanged corpus is not credited twice');
  scan = { ...scan, total: 1200, sampleTotals: { ...scan.sampleTotals, ['3'.repeat(64)]: 200 } };
  await tracker.refresh();
  assert.equal(tracker.feedable(), 1200, 'only the new request is credited');
  // A source flip rebases the observed keys without minting that source's
  // whole history as food.
  scan = { total: 9000, sessions: 1, source: 'sessions', sampleTotals: { ['4'.repeat(64)]: 9000 } };
  await tracker.refresh();
  assert.equal(tracker.feedable(), 1200);
});

test('config normalization round-trips the v2 marker and ledger source', () => {
  const state = {
    accountingVersion: ACCOUNTING_VERSION,
    points: 12,
    tokensFed: 0,
    tokensSeen: 40,
    baseline: 40,
    today: { day: '2026-10-21', used: 7 },
    food: { version: 1, source: 'magpie', available: 0, seen: { ['f'.repeat(64)]: 40 } },
  };
  const normalized = normalizeGrowthState(state);
  assert.deepEqual(normalized, state);
  assert.deepEqual(normalizeGrowthState(normalized), normalized, 'idempotent through config writes');
});

test('deleted logs do not starve new usage or refeed restored settlements', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-deleted-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = [{ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 1000 } } }];
  writeLog(root, 'old', 'session.jsonl.zstd', old);
  let stored = { points: 400, tokensFed: 400, tokensSeen: 1000, baseline: 600, today: null };
  const make = () => createGrowthTracker({
    sessionsDir: root,
    getGrowth: () => stored,
    saveGrowth: next => { stored = next; },
    usageFile: '',
  });
  let tracker = make();
  t.after(() => tracker.close());
  await tracker.refresh();
  fs.rmSync(path.join(root, 'old'), { recursive: true, force: true });
  await tracker.refresh();
  const fresh = [{ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 50 } } }];
  writeLog(root, 'new', 'session.jsonl.zstd', fresh);
  assert.equal(tracker.feedable(await tracker.refresh()), 50, 'new consumption is usable immediately despite historical fed credit');
  assert.equal(tracker.feed().fed, 50);
  assert.equal(stored.points, 450);
  assert.equal(stored.tokensFed, 50, 'the pre-migration fed counter was retired');
  assert.equal(stored.accountingVersion, ACCOUNTING_VERSION);
  await tracker.close();
  tracker = make();
  writeLog(root, 'old', 'session.jsonl.zstd', old);
  assert.equal(tracker.feedable(await tracker.refresh()), 0, 'restoring old logs after a restart must not mint food');
  assert.equal(tracker.snapshot().todayUsed, 50, 'restoration is not new consumption');
  fresh.push({ type: 'assistant/message', data: { turn: 1, step: 0, usage: { inputTokens: 20 } } });
  writeLog(root, 'new', 'session.jsonl.zstd', fresh);
  assert.equal(tracker.feedable(await tracker.refresh()), 20);
});

test('issue 120 legacy food debt migrates without resetting growth or minting backlog', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-legacy-debt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'old', 'session.jsonl.zstd', [{ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 719295480 } } }]);
  let stored = { points: 350576917, tokensFed: 46861950, tokensSeen: 719295480, baseline: 712422075, today: null };
  const tracker = createGrowthTracker({
    sessionsDir: root,
    getGrowth: () => stored,
    saveGrowth: next => { stored = next; },
    usageFile: '',
  });
  t.after(() => tracker.close());
  assert.equal(tracker.feedable(await tracker.refresh()), 0);
  assert.equal(stored.points, 350576917);
  assert.equal(stored.tokensFed, 0, 'legacy fed debt retired by the v2 migration');
  writeLog(root, 'new', 'session.jsonl.zstd', [{ type: 'assistant/message', data: { turn: 0, step: 0, usage: { outputTokens: 25 } } }]);
  assert.equal(tracker.feedable(await tracker.refresh()), 25);
  const result = tracker.feed();
  assert.equal(result.fed, 25);
  assert.equal(result.points, 350576942);
});

// ── off-thread scan (regression: 60s rescan used to decode whole logs on
// the Electron main thread — every changed session log froze all windows) ──

test('the scan worker reports the same totals as scanSessionTokens', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 50, outputTokens: 50 } } },
  ]);
  writeLog(root, 'b', 'session.v2.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { outputTokens: 30 } } },
  ]);
  const worker = createScanWorker();
  t.after(() => worker.close());
  const expected = scanSessionTokens(root, undefined, true);
  assert.deepEqual(await worker.scan(root), expected);
  // The unchanged-file cache lives inside the worker across scans.
  assert.deepEqual(await worker.scan(root), expected);
  // A grown file re-decodes and re-totals.
  writeLog(root, 'b', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 2, step: 0, usage: { inputTokens: 5 } } },
  ]);
  assert.deepEqual(await worker.scan(root), scanSessionTokens(root, undefined, true));
});

test('a closed scan worker rejects instead of hanging', async (t) => {
  const worker = createScanWorker();
  await worker.close();
  await assert.rejects(worker.scan(os.tmpdir()), /closed/);
  // close() is idempotent and safe on an already-dead worker.
  await worker.close();
});

test('the scan worker prefers Magpie and falls back when the log disappears', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-worker-magpie-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500, cacheReadTokens: 70_000 } } },
  ]);
  const usageFile = path.join(root, 'magpie', 'usage.jsonl');
  writeMagpie(usageFile, [
    { route_id: 5, t: localIso(0, 9, 0), agent: 'dsh', in: 1200, out: 300, cache_read: 70_000, session: 'session-a' },
  ]);
  const worker = createScanWorker();
  t.after(() => worker.close());
  const res = await worker.scan(root, usageFile);
  assert.equal(res.total, 1500);
  assert.equal(res.source, 'magpie');
  assert.equal(res.todayUsed, 1500);
  assert.equal(Object.keys(res.sampleTotals).length, 1);
  fs.rmSync(usageFile);
  const fallback = await worker.scan(root, usageFile);
  assert.equal(fallback.total, 500);
  assert.equal(fallback.source, undefined);
  assert.deepEqual(fallback, scanSessionTokens(root, undefined, true));
});

test('refresh runs the corpus scan off the main thread', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 42 } } },
  ]);
  let stored;
  const tracker = createGrowthTracker({
    sessionsDir: root,
    getGrowth: () => stored,
    saveGrowth: (next) => { stored = next; },
    usageFile: '',
  });
  t.after(() => tracker.close());
  // A synchronous main-thread scan starves the event loop for the whole
  // decode — this pump can only tick while the main thread is free. One
  // worker round-trip always crosses at least one loop turn, so >0 proves
  // the scan did not block here.
  let pumped = 0;
  let done = false;
  const pump = (async () => {
    while (!done) {
      await new Promise((resolve) => setImmediate(resolve));
      pumped += 1;
    }
  })();
  const g = await tracker.refresh();
  done = true;
  await pump;
  assert.equal(g.tokensSeen, 42);
  assert.ok(pumped > 0, 'main thread stayed responsive while the log decoded');
});

test('concurrent refreshes share one scan', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const scanTokens = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { total: 7, sessions: 1 };
  };
  const { tracker } = trackerWith(root, { baseline: 0 }, scanTokens);
  const [a, b] = await Promise.all([tracker.refresh(), tracker.refresh()]);
  assert.equal(calls, 1, 'overlapping refresh calls coalesce');
  assert.equal(a.tokensSeen, 7);
  assert.equal(b.tokensSeen, 7);
});

test('a failed scan rejects refresh and the tracker recovers', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let fail = true;
  const scanTokens = async () => {
    if (fail) {
      throw new Error('disk gone');
    }
    return { total: 3, sessions: 1 };
  };
  const { tracker, read } = trackerWith(root, { baseline: 0 }, scanTokens);
  await assert.rejects(tracker.refresh(), /disk gone/);
  assert.equal(read()?.tokensSeen ?? 0, 0, 'a failed scan writes no state');
  fail = false;
  const g = await tracker.refresh();
  assert.equal(g.tokensSeen, 3);
});

test('asarUnpack ships the whole scan worker import chain', () => {
  // The worker thread reads its entry through real fs — anything left inside
  // app.asar makes the packaged scan die silently and growth goes stale.
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const unpacked = new Set(pkg.build.asarUnpack);
  const root = path.join(__dirname, '..', '..');
  const seen = new Set();
  const queue = [path.join(__dirname, 'pet-growth-scan-worker.js')];
  while (queue.length) {
    let file = queue.pop();
    if (!fs.existsSync(file) && fs.existsSync(`${file}.js`)) {
      file = `${file}.js`; // require('./pet-growth') resolves the extension
    }
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (seen.has(rel) || !fs.existsSync(file)) {
      continue;
    }
    seen.add(rel);
    for (const match of fs.readFileSync(file, 'utf8')
      .matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      queue.push(path.resolve(path.dirname(file), match[1]));
    }
  }
  assert.ok(seen.has('src/main/pet-growth.js'));
  for (const rel of seen) {
    assert.ok(unpacked.has(rel), `${rel} is imported by the pet scan worker but missing from build.asarUnpack`);
  }
});
