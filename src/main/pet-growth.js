'use strict';

// Token-feeding + growth model for the live2d pet. Pure-ish: the scanner
// reads dsh-home session logs (zstd-framed JSONL) and the tracker folds
// cumulative usage into persistent growth state kept in config.live2dPet.
// No vendor code is touched and no message content is read — only the
// numeric usage buckets on usage-bearing events.

const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const path = require('node:path');
const zlib = require('node:zlib');
const { Worker } = require('node:worker_threads');

// Accounting generation of `live2dPet.growth`. Version 2 counts uncached
// input + output only and prefers Magpie's usage log; a state written under
// version 1 is reset on its first refresh (see needsAccountingMigration).
const ACCOUNTING_VERSION = 2;

// 1 fed token = 1 growth point. Thresholds are cumulative points.
// Growth ladder — each tier carries a theme color used across the status
// card (level badge, growth bar fill, feed button) so the player feels the
// progression visually, not just by name. Ten tiers, ~1.7× per step:
// the first promotion costs 1亿 and maxing out takes ~200亿 — a lifetime
// ladder, not a weekend one. Hue marches cool→warm→gold as she grows from
// a tiny calf to the god of the compute sea.
const LEVELS = [
  { at: 0,            name: '幼鲸',     color: '#7fb3e8' }, // pale blue — baby
  { at: 100_000_000,  name: '小鲸',     color: '#4a90d9' }, // ocean blue — 1亿
  { at: 300_000_000,  name: '干饭鲸',   color: '#3aa8c1' }, // teal — 3亿
  { at: 600_000_000,  name: '鲸鱼娘',   color: '#5b8def' }, // indigo — 6亿
  { at: 1_200_000_000, name: '大肥鱼',  color: '#9b6dd9' }, // violet — 12亿
  { at: 2_200_000_000, name: '干饭大王', color: '#e85d75' }, // crimson — 22亿
  { at: 4_000_000_000, name: '米饭女帝', color: '#f0785a' }, // vermilion — 40亿
  { at: 7_000_000_000, name: '鲸吞四海', color: '#f09a4a' }, // amber — 70亿
  { at: 12_000_000_000, name: '星海饭皇', color: '#f5c04d' }, // gold — 120亿
  { at: 20_000_000_000, name: '干饭真神', color: '#ffe98a' }, // bright gold — 200亿
];

function levelFor(points) {
  let level = 1;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (points >= LEVELS[i].at) {
      level = i + 1;
    }
  }
  return level;
}

function nextLevelAt(points) {
  const lv = levelFor(points);
  return lv < LEVELS.length ? LEVELS[lv].at : null;
}

function levelName(points) {
  return LEVELS[levelFor(points) - 1].name;
}

// Usage that counts as food: uncached input + output. Cache reads and writes
// are metered separately by the provider (and by Magpie) — they are re-read
// context, not fresh work, and adding them multiplied the pet's total over the
// real spend. Reasoning is already inside output (same convention as the
// usage panel), so it is not added twice.
function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') {
    return 0;
  }
  return (usage.inputTokens || 0)
    + (usage.outputTokens || 0);
}

// Pull a usage sample out of one session-log event. Mirrors the panel's
// usageSampleOf: assistant settlements carry data.usage, stream attempts
// carry the last 'usage' chunk.
function usageSampleOf(event) {
  const data = event?.data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  if (event.type === 'assistant/message') {
    return data.usage !== undefined
      ? { turn: data.turn, step: data.step, usage: data.usage }
      : undefined;
  }
  if (event.type === 'assistant/attempt' || event.type === 'assistant/chunk') {
    const chunk = data.chunk && data.chunk.type === 'usage' ? data.chunk
      : Array.isArray(data.stream) ? [...data.stream].reverse().find((c) => c?.type === 'usage')
        : undefined;
    return chunk && chunk.usage !== undefined
      ? { turn: data.turn, step: data.step, usage: chunk.usage }
      : undefined;
  }
  if (event.type === 'compaction/summary' && data.usage !== undefined) {
    // Compaction usage is billed separately — still real spend, so she can
    // eat it, keyed to its own slot so it never collides with a step.
    return { turn: -1, step: event.seq ?? 0, usage: data.usage };
  }
  return undefined;
}

// A seeded (forked) session log replays its parent's prefix byte-for-byte, so
// folding the whole file bills the parent's work again and, worse, the child's
// own (turn,step) slots collide with the prefix keys and overwrite them.
// The host exposes the exact prefix length as inheritedEventCount; in the log
// its durable equivalent is the LAST `session/end-seed` marker carrying
// `inherited: true`, whose seq is that cut (session.md § the end-seed
// boundary). Legacy v1 headers carry the length as `seedLength` instead.
// Returns 0 — count every event — for unseeded logs and for fixtures without a
// session header.
function inheritedCut(text) {
  const lines = text.split('\n');
  let header;
  for (const line of lines) {
    if (!line || line.charCodeAt(0) !== 123) {
      continue;
    }
    try {
      header = JSON.parse(line);
    } catch {
      header = undefined;
    }
    break;
  }
  if (!header || header.type !== 'session' || header.isSeeded !== true) {
    return 0;
  }
  let cut = Number.isSafeInteger(header.seedLength) && header.seedLength > 0
    ? header.seedLength : 0;
  for (const line of lines) {
    if (!line || line.indexOf('session/end-seed') === -1) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === 'session/end-seed' && event.data?.inherited === true
        && Number.isSafeInteger(event.seq) && event.seq > cut) {
      cut = event.seq;
    }
  }
  return cut;
}

// Fold one decoded log body into `lastWins`: last sample wins per
// (turn,step) — a retried attempt's later settlement replaces the earlier
// one, and a streamed usage chunk never outranks the final settlement.
// Events below the inherited cut belong to the parent session and are skipped
// before they can claim a key.
function foldLogInto(text, lastWins, cut = 0) {
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) !== 123) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (cut > 0 && typeof event.seq === 'number' && event.seq < cut) {
      continue;
    }
    const sample = usageSampleOf(event);
    if (sample === undefined) {
      continue;
    }
    lastWins.set(`${sample.turn}:${sample.step}`, usageTokens(sample.usage));
  }
}

function tokensInLog(text) {
  const lastWins = new Map();
  foldLogInto(text, lastWins, inheritedCut(text));
  let total = 0;
  for (const n of lastWins.values()) {
    total += n;
  }
  return total;
}

// Session logs are appended one zstd frame per event batch — a single-frame
// decode only sees the session header. Walk frame boundaries (magic +
// header + blocks + optional checksum) and decompress each frame.
function zstdFrameSize(buf, off) {
  let pos = off + 4; // caller already matched the magic
  if (pos >= buf.length) {
    return 0;
  }
  const fhd = buf[pos];
  pos += 1;
  const fcsFlag = fhd >> 6;
  const singleSeg = (fhd >> 5) & 1;
  const checksum = (fhd >> 2) & 1;
  if (!singleSeg) {
    pos += 1; // window descriptor
  }
  pos += [0, 1, 2, 4][fhd & 3]; // dictionary id
  pos += fcsFlag === 0 ? (singleSeg ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
  for (;;) {
    if (pos + 3 > buf.length) {
      return 0;
    }
    const bh = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16);
    pos += 3;
    const last = bh & 1;
    const type = (bh >> 1) & 3;
    // RLE blocks store a single byte; raw/compressed/treeless store `size`.
    pos += type === 1 ? 1 : (bh >> 3);
    if (last) {
      break;
    }
  }
  if (checksum) {
    pos += 4;
  }
  return pos <= buf.length ? pos - off : 0;
}

function zstdDecompressAll(buf) {
  const parts = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const magic = buf.readUInt32LE(off);
    if (magic === 0xFD2FB528) {
      const size = zstdFrameSize(buf, off);
      if (!size) {
        break;
      }
      parts.push(zlib.zstdDecompressSync(buf.subarray(off, off + size)));
      off += size;
    } else if ((magic & 0xFFFFFFF0) === 0x184D2A50) {
      off += 8 + buf.readUInt32LE(off + 4); // skippable frame
    } else {
      break; // trailing garbage — keep what decoded cleanly
    }
  }
  return Buffer.concat(parts);
}

// Decode one generation file into its per-(turn,step) usage map. The fork cut
// is per file: each generation carries its own header and inherited marker.
function unpackLog(text) {
  const usageMap = new Map();
  foldLogInto(text, usageMap, inheritedCut(text));
  return usageMap;
}

// Canonical storage names one session's log generation: generation 0 is
// `session.jsonl.zstd`, a format migration leaves `session.v<N>.jsonl.zstd`
// behind as the new authoritative copy (same grammar as the usage panel's
// session-repair locator: no leading zeros, v0 keeps the plain name).
const CANONICAL_LOG_NAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl\.zstd$/;

function logGeneration(name) {
  const match = CANONICAL_LOG_NAME.exec(name);
  if (!match) {
    return -1;
  }
  return match[1] === undefined ? 0 : Number(match[1]);
}

// Cumulative tokens across every session under `sessionsDir`
// (<workspace>/<session-id>/session*.jsonl.zstd). Exactly one generation per
// session directory counts — the highest canonical one. Older generations are
// earlier copies of the SAME events, so folding them would replay (turn,step)
// keys the newest copy already settles (and can overwrite child-owned slots).
// Unreadable or empty files count as zero — the bowl never breaks on a
// half-written log.
//
// `cache` (optional) is a Map<filePath, {size, mtimeMs, usage:Map}> owned by
// the caller across scans: a file whose size+mtime are unchanged replays its
// folded usage map without re-reading or re-decompressing — the steady-state
// 60s rescan costs one stat per log instead of a full corpus decode. Entries
// for superseded or deleted generations are evicted.
// includeSamples adds hashed settlement identities for durable food accounting;
// the ordinary total-only scanner interface remains available to other callers.
function scanSessionTokens(sessionsDir, cache, includeSamples = false) {
  const fileCache = cache instanceof Map ? cache : null;
  const seen = fileCache ? new Set() : null;
  let total = 0;
  let sessions = 0;
  const sampleTotals = {};
  const stack = [sessionsDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    let chosen = '';
    let chosenGeneration = -1;
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      const generation = logGeneration(ent.name);
      if (generation > chosenGeneration) {
        chosen = ent.name;
        chosenGeneration = generation;
      }
    }
    if (!chosen) {
      continue;
    }
    const p = path.join(dir, chosen);
    let lastWins = null;
    if (fileCache) {
      let st = null;
      try {
        st = fs.statSync(p);
      } catch {
        continue; // vanished between readdir and stat
      }
      seen.add(p);
      const hit = fileCache.get(p);
      if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
        lastWins = hit.usage;
      } else {
        let text;
        try {
          text = zstdDecompressAll(fs.readFileSync(p)).toString('utf8');
        } catch {
          continue;
        }
        lastWins = unpackLog(text);
        fileCache.set(p, { size: st.size, mtimeMs: st.mtimeMs, usage: lastWins });
      }
    } else {
      let text;
      try {
        text = zstdDecompressAll(fs.readFileSync(p)).toString('utf8');
      } catch {
        continue;
      }
      lastWins = unpackLog(text);
    }
    sessions += 1;
    for (const [key, n] of lastWins) {
      total += n;
      if (includeSamples) {
        // Session identity remains stable when its workspace is moved.
        const id = createHash('sha256')
          .update(JSON.stringify([path.basename(dir), key])).digest('hex');
        sampleTotals[id] = n;
      }
    }
  }
  if (fileCache) {
    for (const key of fileCache.keys()) {
      if (!seen.has(key)) {
        fileCache.delete(key);
      }
    }
  }
  return { total, sessions, ...(includeSamples ? { sampleTotals } : {}) };
}

// Local calendar day key — "今日" means the user's own midnight boundary,
// not UTC.
function dayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    + `-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Magpie usage (preferred source) ──
//
// The local Magpie gateway writes one JSON row per completed model call to
// ~/.config/magpie/usage.jsonl: `in` / `out` are its headline "tokens", while
// `cache_read` / `cache_write` are separate stats that never join that number.
// Rows for other agents (codex, …) are not the harness's spend. When this file
// exists it is the accounting source of truth: it already bills a forked
// subagent's work once, per request.
const MAGPIE_AGENT = 'dsh';
const MAGPIE_USAGE_DEFAULT = path.join(os.homedir(), '.config', 'magpie', 'usage.jsonl');

function magpieUsageFile(env = process.env) {
  const override = env?.MAGPIE_USAGE_FILE;
  return typeof override === 'string' && override.trim() ? override : MAGPIE_USAGE_DEFAULT;
}

// Stable identity for one credited request. `route_id` is unique per routed
// call; rejected calls (no route) fall back to their written identity.
function magpieRequestId(row) {
  const id = row.route_id ?? row.request_id ?? row.rid ?? row.response_id;
  if (id !== undefined && id !== null && id !== '') {
    return `route:${String(id)}`;
  }
  if (typeof row.t === 'string' && row.t) {
    return `row:${row.t}|${row.session ?? ''}|${row.status ?? ''}|${row.model ?? ''}`;
  }
  return null;
}

// One credited sample per request: the ledger never has to guess which part of
// a cumulative total it already ate, and two calls with the same size cannot
// cancel each other out.
function sampleKey(scope, id) {
  return createHash('sha256').update(JSON.stringify([scope, id])).digest('hex');
}

function tokenCount(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Aggregate the gateway log. Returns null when the file is absent or
// unreadable so callers fall back to the session-log scan.
function readMagpieUsage(file, { now = Date.now() } = {}) {
  if (!file) {
    return null;
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const day = dayKey(now);
  let total = 0;
  let todayUsed = 0;
  let calls = 0;
  const sessions = new Set();
  const sampleTotals = {};
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) !== 123) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.agent !== MAGPIE_AGENT) {
      continue;
    }
    const amount = tokenCount(row.in) + tokenCount(row.out);
    calls += 1;
    total += amount;
    if (typeof row.session === 'string' && row.session) {
      sessions.add(row.session);
    }
    const at = typeof row.t === 'string' ? Date.parse(row.t) : NaN;
    if (Number.isFinite(at) && dayKey(at) === day) {
      todayUsed += amount;
    }
    const id = amount > 0 ? magpieRequestId(row) : null;
    if (id) {
      sampleTotals[sampleKey('magpie', id)] = amount;
    }
  }
  // A log with no dsh rows (another tool's gateway traffic, or a file Magpie
  // has just created) says nothing about this harness — let the session logs
  // answer instead of reporting zero.
  if (calls === 0) {
    return null;
  }
  return { total, todayUsed, calls, sessions: sessions.size, sampleTotals };
}

// The scan interface shared by the tracker and its worker: Magpie first (the
// gateway's own billing), session logs second. A Magpie answer carries the
// absolute `todayUsed` and its `source`; the log fallback keeps `today`
// incremental because it has no per-event clock in the fold.
function scanUsage({ sessionsDir, usageFile, cache, includeSamples = false } = {}) {
  const magpie = readMagpieUsage(usageFile);
  if (magpie) {
    return {
      total: magpie.total,
      sessions: magpie.sessions,
      ...(includeSamples ? { sampleTotals: magpie.sampleTotals } : {}),
      todayUsed: magpie.todayUsed,
      source: 'magpie',
    };
  }
  return scanSessionTokens(sessionsDir, cache, includeSamples);
}

// Validate and copy the versioned food ledger in one pass. It is the largest
// object in the config (one key per observed request), so repeated norms must
// not walk it four times.
function normalizeLedger(ledger) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return null;
  }
  if (ledger.version !== 1 || !Number.isFinite(ledger.available) || ledger.available < 0) {
    return null;
  }
  if (!ledger.seen || typeof ledger.seen !== 'object' || Array.isArray(ledger.seen)) {
    return null;
  }
  const seen = {};
  for (const [key, amount] of Object.entries(ledger.seen)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !Number.isFinite(amount) || amount < 0) {
      return null;
    }
    seen[key] = Math.floor(amount);
  }
  return {
    version: 1,
    // Which accounting source the observed keys belong to; '' when the ledger
    // predates the marker.
    source: typeof ledger.source === 'string' ? ledger.source : '',
    available: Math.floor(ledger.available),
    seen,
  };
}

function normalizeGrowthState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const todaySrc = source.today && typeof source.today === 'object' ? source.today : null;
  const food = normalizeLedger(source.food);
  return {
    // Present only after the v2 migration; absence marks legacy accounting and
    // is preserved as absent so config normalization cannot fake a migration.
    ...(source.accountingVersion === ACCOUNTING_VERSION
      ? { accountingVersion: ACCOUNTING_VERSION } : {}),
    points: num(source.points),
    tokensFed: num(source.tokensFed),
    tokensSeen: num(source.tokensSeen),
    // null = watermark not yet planted (first refresh sets it).
    baseline: Number.isFinite(source.baseline) && source.baseline >= 0
      ? Math.floor(source.baseline) : null,
    // {day, used} — tokens burned on the current local day. null until the
    // first refresh plants it (the historical corpus is NOT today's burn).
    today: todaySrc && typeof todaySrc.day === 'string' && todaySrc.day
      ? { day: todaySrc.day, used: num(todaySrc.used) } : null,
    ...(food ? { food } : {}),
  };
}

// Plain-node worker threads cannot read inside app.asar; the scan worker
// entry and this module ship via asarUnpack, same convention as
// dshd-daemon-runner.
function unpackedPath(file) {
  return file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

// Main-thread handle to pet-growth-scan-worker.js. The worker owns the
// per-file decode cache; requests are serialized by the worker's message
// loop. A crashed worker is respawned on the next scan; close() is terminal.
function createScanWorker({ workerFile } = {}) {
  const file = workerFile || unpackedPath(path.join(__dirname, 'pet-growth-scan-worker.js'));
  let worker = null;
  let closed = false;
  let seq = 0;
  const pending = new Map();

  function drop(err) {
    for (const p of pending.values()) {
      p.reject(err);
    }
    pending.clear();
    worker = null;
  }

  function ensure() {
    if (worker) {
      return worker;
    }
    const w = new Worker(file);
    // Idle worker must not keep the app alive; dispose() terminates it.
    w.unref?.();
    w.on('message', (msg) => {
      const p = pending.get(msg && msg.id);
      if (!p) {
        return;
      }
      pending.delete(msg.id);
      if (msg.ok) {
        p.resolve({
          total: msg.total,
          sessions: msg.sessions,
          ...(msg.sampleTotals ? { sampleTotals: msg.sampleTotals } : {}),
          // Optional extras: present only when Magpie's usage log answered.
          ...(Number.isFinite(msg.todayUsed) ? { todayUsed: msg.todayUsed } : {}),
          ...(msg.source === 'magpie' ? { source: 'magpie' } : {}),
        });
      } else {
        p.reject(new Error(msg.error || 'session scan failed'));
      }
    });
    w.on('error', (err) => drop(err));
    w.on('exit', (code) => {
      if (code === 0) {
        worker = null;
      } else {
        drop(new Error(`pet scan worker exited with code ${code}`));
      }
    });
    worker = w;
    return w;
  }

  return {
    // `usageFile` is Magpie's usage log; '' forces the session-log fallback.
    scan(sessionsDir, usageFile) {
      if (closed) {
        return Promise.reject(new Error('pet scan worker closed'));
      }
      return new Promise((resolve, reject) => {
        let w;
        try {
          w = ensure();
        } catch (err) {
          reject(err);
          return;
        }
        const id = ++seq;
        pending.set(id, { resolve, reject });
        try {
          w.postMessage({
            type: 'scan', id, sessionsDir: sessionsDir || '', usageFile: usageFile || '',
          });
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      });
    },
    async close() {
      closed = true;
      const w = worker;
      drop(new Error('pet scan worker closed'));
      if (w) {
        try {
          await w.terminate();
        } catch {}
      }
    },
  };
}

// A version-1 state recorded totals with the cache-inclusive, prefix-doubling
// scan and may hold a food debt (tokensFed) larger than the corrected corpus —
// that state can never become feedable again. A state that never recorded any
// accounting (fresh install, or a bare pre-planted baseline) has nothing stale
// to reset, so the normal first-scan watermark planting applies to it.
function needsAccountingMigration(g) {
  if (g.accountingVersion === ACCOUNTING_VERSION) {
    return false;
  }
  return g.tokensSeen > 0 || g.tokensFed > 0 || g.points > 0 || Boolean(g.food);
}

// Lifetime feeding and current log totals have different units. Versioned
// food accounting retains an available balance and observed settlement maxima;
// removing/restoring logs cannot revoke earned food or credit it twice.
// baseline remains for migration of old state, never as a lifetime food debt.
//
// `scanTokens` (optional) injects the corpus scan — sync or Promise of
// {total, sessions}. Production default is the worker-backed scanner so the
// Electron main thread never pays the decode; tests inject the in-process
// scan for determinism. `usageFile` names Magpie's usage log ('' disables the
// preferred source).
function createGrowthTracker({ sessionsDir, getGrowth, saveGrowth, scanTokens, usageFile }) {
  const scanner = scanTokens
    ? { scan: (dir) => scanTokens(dir) }
    : createScanWorker();
  const magpieFile = usageFile === undefined ? magpieUsageFile() : usageFile;
  function read() {
    return normalizeGrowthState(getGrowth?.());
  }

  function write(next) {
    saveGrowth?.(normalizeGrowthState(next));
  }

  // refresh() is async now that the scan lives off-thread; concurrent
  // callers (60s tick vs feed/status IPCs) share one in-flight scan instead
  // of queueing duplicate corpus reads.
  let inFlight = null;
  function refresh() {
    if (!inFlight) {
      inFlight = (async () => {
        const scan = await scanner.scan(sessionsDir, magpieFile);
        const total = Number.isFinite(scan?.total) && scan.total > 0 ? Math.floor(scan.total) : 0;
        const sampleTotals = scan?.sampleTotals && typeof scan.sampleTotals === 'object'
          ? scan.sampleTotals : null;
        // A Magpie scan knows the exact local-day figure; the log fallback is
        // incremental (no clock in the fold), so it keeps the running counter.
        const source = scan?.source === 'magpie' ? 'magpie' : 'sessions';
        const absoluteToday = Number.isFinite(scan?.todayUsed)
          ? Math.max(0, Math.floor(scan.todayUsed)) : null;
        const g = read();
        const day = dayKey();
        let next;
        let dirty;
        if (needsAccountingMigration(g)) {
          // Keep earned growth, drop every stale counter and the old ledger:
          // the new total becomes the watermark, so nothing already spent is
          // retroactively edible and the old tokensFed debt cannot lock the bowl.
          next = {
            ...g,
            accountingVersion: ACCOUNTING_VERSION,
            tokensSeen: total,
            baseline: total,
            tokensFed: 0,
            today: { day, used: absoluteToday ?? 0 },
          };
          if (sampleTotals) {
            next.food = { version: 1, source, available: 0, seen: { ...sampleTotals } };
          } else {
            delete next.food;
          }
          dirty = true;
        } else {
          // First scan plants the watermark at corpus-minus-eaten so already-fed
          // credit survives the upgrade; later the watermark only follows the
          // corpus DOWN (logs deleted → that ceiling is gone for good).
          const baseline = g.baseline === null
            ? Math.max(0, total - g.tokensFed)
            : Math.min(g.baseline, total);
          let delta = Math.max(0, total - g.tokensSeen);
          let food = g.food;
          let foodChanged = false;
          if (sampleTotals) {
            if (!food) {
              // Seed historical buckets without retroactive food. Preserve only
              // the legacy balance; neither growth nor lifetime feeding resets.
              food = { version: 1, source, available: Math.max(0, total - baseline - g.tokensFed), seen: { ...sampleTotals } };
              foodChanged = true;
            } else if (food.source && food.source !== source) {
              // The accounting source flipped (Magpie appeared or went away).
              // The observed keys belong to the other source, so rebase them
              // without minting that source's whole history as food.
              food = { version: 1, source, available: food.available, seen: { ...sampleTotals } };
              delta = 0;
              foodChanged = true;
            } else {
              const seen = { ...food.seen };
              delta = 0;
              for (const [key, amount] of Object.entries(sampleTotals)) {
                const previous = seen[key] || 0;
                delta += Math.max(0, amount - previous);
                seen[key] = Math.max(previous, amount);
              }
              food = { version: 1, source, available: food.available + delta, seen };
              foodChanged = delta > 0 || !g.food.source;
            }
          }
          const today = absoluteToday !== null
            ? { day, used: absoluteToday }
            : g.baseline === null
              ? { day, used: 0 }
              : { day, used: (g.today && g.today.day === day ? g.today.used : 0) + delta };
          next = { ...g, accountingVersion: ACCOUNTING_VERSION, tokensSeen: total, baseline, today, ...(food ? { food } : {}) };
          dirty = next.tokensSeen !== g.tokensSeen
            || next.baseline !== g.baseline
            || next.accountingVersion !== g.accountingVersion
            || !g.today
            || next.today.used !== g.today.used
            || next.today.day !== g.today.day
            || (food ? !g.food || foodChanged : Boolean(g.food));
        }
        if (dirty) {
          write(next);
        }
        return next;
      })().finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  function close() {
    return scanner.close?.();
  }

  function feedable(state) {
    const g = state || read();
    if (g.food) return g.food.available;
    const pool = g.baseline === null ? 0 : Math.max(0, g.tokensSeen - g.baseline);
    return Math.max(0, pool - g.tokensFed);
  }

  // How much she can eat in one meal: a small whale can't swallow a whole
  // backlog at once, so a single feed fills at most the current level —
  // each 投喂 is one level-up celebration, not an instant max-out.
  function mealSize(g) {
    const next = nextLevelAt(g.points);
    return next === null ? Infinity : Math.max(0, next - g.points);
  }

  function snapshot(state) {
    const g = state || read();
    const can = feedable(g);
    const lv = levelFor(g.points);
    const next = nextLevelAt(g.points);
    return {
      points: g.points,
      level: lv,
      levelName: LEVELS[lv - 1].name,
      levelColor: LEVELS[lv - 1].color,
      nextAt: next,
      nextName: next === null ? null : LEVELS[lv].name,
      nextColor: next === null ? null : LEVELS[lv].color,
      // Full ladder for the renderer's tier-dot bar — no main-process
      // require in the pet renderer (it's a standalone script).
      levels: LEVELS.map((l) => ({ at: l.at, name: l.name })),
      tokensFed: g.tokensFed,
      tokensSeen: g.tokensSeen,
      feedable: can,
      nextFeed: Math.min(can, mealSize(g)),
      // Tokens burned on the current local day — the live "how much did
      // the harness actually consume today" meter on the status card.
      todayUsed: g.today && g.today.day === dayKey() ? g.today.used : 0,
    };
  }

  // Feed `amount` tokens (default: a full meal). Returns the post-feed
  // snapshot plus {fed, leveledUp}.
  function feed(amount) {
    const before = read();
    const available = feedable(before);
    const fed = Math.max(0, Math.min(
      Number.isFinite(amount) ? Math.floor(amount) : available,
      available,
      mealSize(before),
    ));
    const was = levelFor(before.points);
    const next = {
      ...before,
      points: before.points + fed,
      tokensFed: before.tokensFed + fed,
      tokensSeen: before.tokensSeen,
      ...(before.food ? { food: { ...before.food, available: before.food.available - fed } } : {}),
    };
    write(next);
    const snap = snapshot(next);
    return { ...snap, fed, leveledUp: snap.level > was };
  }

  return { refresh, feedable, snapshot, feed, close };
}

module.exports = {
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
  zstdDecompressAll,
  zstdFrameSize,
};
