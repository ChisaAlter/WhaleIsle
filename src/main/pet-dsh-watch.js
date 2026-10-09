'use strict';

// DSH link watcher — tails session logs incrementally and turns raw frame
// types into a small set of already-gated speech events for the pet.
//
// What it reads (and ONLY what it reads): event type + seq + time +
// structural fields (turn/step ids, usage buckets, reason.kind). Message
// content, tool arguments, and command text are never extracted — the pet
// reacts to "you are working / you finished / something failed", never to
// what the work is about.
//
// Cursors persist under config.live2dPet.dsh:
//   files      {path: byteOffset}   — append-only tail offsets
//   openTurns  {sessKey: turn}      — sessions whose latest turn hasn't closed
//   dayTokens  {day, used}          — today's observed usage for milestones
//   activeSince/lastActiveAt        — continuous-activity window (rest nudge)
//   lastSeenAt                      — last observed activity (久别问候)
//   milestoneMarks                  — today's fired milestone thresholds
//   lastRestReminder/lastGreetDay   — reminder dedup watermarks

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { usageSampleOf, usageTokens, dayKey, zstdFrameSize } = require('./pet-growth');
const { normalizeDshState } = require('./pet-settings');

// Event categories the renderer maps onto dialogue categories.
const EV_WORKING = 'dshWorking';
const EV_DONE = 'dshDone';
const EV_ERROR = 'dshError';
const EV_MILESTONE = 'dshMilestone';
const EV_REST = 'dshRest';
const EV_MISS = 'dshMiss';
// Plugin → pet one-way bridge: the dsh-whale assistant appends
// {kind, text} lines to data/whale/pet-outbox.jsonl; only `text` is
// surfaced as a bubble line (dshWhale category), capped at 512 chars.
const EV_WHALE = 'dshWhale';

// Report gates (ported from the reference report_gates, tuned down): work
// chatter would swamp every other line without thinning, so routine events
// are sampled while alerts always land.
const REPORT_GATES = {
  [EV_WORKING]: 0.5,
  [EV_DONE]: 0.9,
  [EV_ERROR]: 1,
  [EV_MILESTONE]: 1,
  [EV_REST]: 1,
  [EV_MISS]: 1,
  [EV_WHALE]: 1,
};

// Day-token milestones — how much the harness burned TODAY (not the growth
// ladder, which is lifetime feed stock).
const MILESTONES = [100000, 500000, 1000000, 5000000, 10000000];

const ACTIVE_WINDOW_MS = 60000;    // an event keeps her "active" for 60s
const IDLE_STALE_MS = 90000;       // no open turn + quiet 90s → idle
const REST_FIRST_MS = 45 * 60000;  // first rest nudge after 45min continuous
const REST_EVERY_MS = 60 * 60000;  // then at most hourly
const MISS_AFTER_MS = 3 * 86400000; // 3 days silent → 久别 greeting
const DAY_IDLE_BREAK_MS = 10 * 60000; // >10min quiet resets "continuous"
const MAX_FRAME_BACKLOG = 8 * 1024 * 1024; // skip absurd appended slices

const ZSTD_MAGIC = 0xFD2FB528;
const SKIPPABLE_MAGIC = 0x184D2A50;
// Decode every COMPLETE zstd frame in `slice`; returns {lines, consumed}.
// A torn tail frame (mid-write) is simply not consumed — the next poll
// re-reads it once the writer flushes. `frameSizeOf` is injectable in
// tests; production walks real frame boundaries.
function decodeAppended(slice, frameSizeOf = zstdFrameSize) {
  const lines = [];
  let off = 0;
  while (off + 4 <= slice.length) {
    const magic = slice.readUInt32LE(off);
    if (magic === ZSTD_MAGIC) {
      const size = frameSizeOf(slice, off);
      if (!size) {
        break; // incomplete trailing frame — stop, keep offset
      }
      let part;
      try {
        part = zlib.zstdDecompressSync(slice.subarray(off, off + size));
      } catch {
        break;
      }
      for (const line of part.toString('utf8').split('\n')) {
        if (line && line.charCodeAt(0) === 123) {
          lines.push(line);
        }
      }
      off += size;
    } else if ((magic & 0xFFFFFFF0) === SKIPPABLE_MAGIC) {
      off += 8 + slice.readUInt32LE(off + 4); // skippable frame
    } else {
      break;
    }
  }
  return { lines, consumed: off };
}

// Sticker outbox lines carry `path` (absolute image file the whale_sticker
// tool just picked). Read it here and ship the bytes as a data URL so the
// renderer can paint the picture inside her bubble — the pet page runs on
// the pet:// scheme and cannot reach arbitrary disk paths itself.
const STICKER_IMAGE_MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};
const STICKER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

function outboxImageOf(ev) {
  if (ev?.kind !== 'sticker' || typeof ev.path !== 'string') {
    return '';
  }
  const file = ev.path;
  const mime = STICKER_IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) {
    return '';
  }
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > STICKER_IMAGE_MAX_BYTES) {
      return '';
    }
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return '';
  }
}

// Plain-jsonl variant of decodeAppended for the pet outbox: consumes only
// newline-terminated lines; a torn trailing line keeps its offset so the
// next poll re-reads it once the writer finishes.
function decodeAppendedPlain(slice) {
  const text = slice.toString('utf8');
  const lastBreak = text.lastIndexOf('\n');
  if (lastBreak === -1) {
    return { lines: [], consumed: 0 };
  }
  const body = text.slice(0, lastBreak);
  const lines = [];
  for (const line of body.split('\n')) {
    if (line && line.charCodeAt(0) === 123) {
      lines.push(line);
    }
  }
  return { lines, consumed: Buffer.byteLength(body) + 1 };
}

// List session-log files: sessionsDir/<workspace>/<session>/…*.jsonl.zstd.
// Depth-capped so a stray deep tree can't stall the poll.
function listSessionFiles(sessionsDir, fsImpl) {
  const out = [];
  const stack = [{ dir: sessionsDir, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = fsImpl.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 3) {
          stack.push({ dir: p, depth: depth + 1 });
        }
      } else if (/\.jsonl\.zstd$/.test(e.name)) {
        out.push(p);
      }
    }
  }
  return out;
}

function createDshWatch({
  sessionsDir,
  outboxFile,
  usageFile,
  getDsh,
  saveDsh,
  onEvent,
  onState,
  isPetVisible = () => true,
  now = () => Date.now(),
  rng = Math.random,
  fsImpl = fs,
  frameSizeOf,
}) {
  // Frame-size walker injected for tests; undefined → pet-growth's default.

  let running = false;
  let lastPollAt = 0;
  let lastState = '';
  let lastUsageJson = '';
  let runtimeDsh = null;
  // Per-session lastWins usage slots: {sessKey: Map<'t:s', tokens>}.
  // In-memory only — a restart may re-count one in-flight turn's usage,
  // which the milestone dedup marks absorb.
  const usageSeen = new Map();

  function read() {
    const d = getDsh?.();
    return d && typeof d === 'object' ? d : {};
  }

  function write(next) {
    saveDsh?.(next);
  }

  function emit(type, extra) {
    const gate = REPORT_GATES[type];
    if (gate !== undefined && rng() >= gate) {
      return false;
    }
    onEvent?.({ type, ...(extra || {}) });
    return true;
  }

  // Session identity for dedup maps: path relative to sessionsDir, so the
  // same log keeps its slots across offset reads.
  function sessKeyOf(file) {
    const rel = path.relative(sessionsDir, path.dirname(file));
    return rel || path.dirname(file);
  }

  function feedEvent(dsh, ev, sessKey, t) {
    const type = ev && ev.type;
    const data = ev && typeof ev.data === 'object' ? ev.data : {};
    const wasActive = Object.keys(dsh.openTurns).length > 0
      || (dsh.lastActiveAt && t - dsh.lastActiveAt < ACTIVE_WINDOW_MS);

    if (type === 'turn/start') {
      dsh.openTurns[sessKey] = Number.isFinite(data.turn) ? data.turn : 1;
      if (!wasActive) {
        emit(EV_WORKING);
      }
      dsh.lastActiveAt = t;
    } else if (type === 'turn/end') {
      delete dsh.openTurns[sessKey];
      const kind = data.reason && data.reason.kind;
      if (kind === 'completed') {
        emit(EV_DONE);
      } else {
        emit(EV_ERROR, { reason: typeof kind === 'string' ? kind : 'unknown' });
      }
      dsh.lastActiveAt = t;
    } else if (type === 'user/message' || type === 'tool/call'
        || type === 'step/start' || type === 'assistant/chunk') {
      // Any live traffic counts as activity; a user message arriving while
      // no turn is open also means the agent is about to work.
      if (!wasActive && type === 'user/message') {
        emit(EV_WORKING);
      }
      dsh.lastActiveAt = t;
    }

    const sample = usageSampleOf(ev);
    if (sample !== undefined) {
      let slots = usageSeen.get(sessKey);
      if (!slots) {
        slots = new Map();
        usageSeen.set(sessKey, slots);
      }
      const slotKey = `${sample.turn}:${sample.step}`;
      const tokens = usageTokens(sample.usage);
      const prev = slots.get(slotKey) || 0;
      if (tokens > prev) {
        slots.set(slotKey, tokens);
        const today = dayKey(t);
        if (dsh.dayTokens.day !== today) {
          dsh.dayTokens = { day: today, used: 0 };
          dsh.milestoneMarks = [];
        }
        dsh.dayTokens.used += tokens - prev;
        for (const mark of MILESTONES) {
          if (dsh.dayTokens.used >= mark && !dsh.milestoneMarks.includes(mark)) {
            dsh.milestoneMarks.push(mark);
            emit(EV_MILESTONE, { tokens: mark });
          }
        }
      }
    }
    dsh.lastSeenAt = t;
  }

  function poll() {
    const t = now();
    const persistedDsh = read();
    const dsh = { ...(runtimeDsh || persistedDsh) };
    dsh.files = { ...(dsh.files || {}) };
    dsh.openTurns = { ...(dsh.openTurns || {}) };
    dsh.dayTokens = dsh.dayTokens && typeof dsh.dayTokens === 'object'
      ? { ...dsh.dayTokens } : { day: '', used: 0 };
    dsh.milestoneMarks = Array.isArray(dsh.milestoneMarks) ? [...dsh.milestoneMarks] : [];

    const today = dayKey(t);
    if (dsh.day !== today) {
      // Day rollover: reset the daily meters; the greeting fires on the
      // first observed activity below, not on the bare date flip.
      dsh.day = today;
      dsh.activeMsToday = 0;
      dsh.dayTokens = { day: today, used: 0 };
      dsh.milestoneMarks = [];
      dsh.activeSince = 0;
    }

    const files = sessionsDir ? listSessionFiles(sessionsDir, fsImpl) : [];
    if (outboxFile) {
      // Only a live outbox keeps its cursor — a deleted file must drop out
      // of `live` below so its offset doesn't pin a future recreate.
      try {
        fsImpl.statSync(outboxFile);
        files.push(outboxFile);
      } catch {
        // Absent outbox — nothing to read this poll.
      }
    }
    const live = new Set(files);
    for (const key of Object.keys(dsh.files)) {
      if (!live.has(key)) {
        delete dsh.files[key]; // log deleted/rotated away — drop its cursor
      }
    }
    // A session dir that vanished mid-turn must drop its open turn. Build the
    // live session-key set once: scanning every live file per open turn was
    // O(openTurns × files) of path work on the main thread every poll.
    if (Object.keys(dsh.openTurns).length) {
      const liveKeys = new Set();
      for (const f of live) {
        liveKeys.add(sessKeyOf(f));
      }
      for (const sessKey of Object.keys(dsh.openTurns)) {
        if (!liveKeys.has(sessKey)) {
          delete dsh.openTurns[sessKey]; // session dir vanished mid-turn
        }
      }
    }

    const hadActivityBefore = dsh.lastActiveAt || 0;
    const lastSeenBefore = dsh.lastSeenAt || 0; // feedEvent overwrites it
    for (const file of files) {
      if (file === outboxFile && !isPetVisible()) continue;
      let stat;
      try {
        stat = fsImpl.statSync(file);
      } catch {
        continue;
      }
      let offset = dsh.files[file] || 0;
      if (stat.size < offset) {
        offset = 0; // truncated/rotated in place — rescan from the top
      }
      if (stat.size <= offset) {
        continue;
      }
      const sliceLen = Math.min(stat.size - offset, MAX_FRAME_BACKLOG);
      const slice = Buffer.alloc(sliceLen);
      let fh;
      try {
        fh = fsImpl.openSync(file, 'r');
        fsImpl.readSync(fh, slice, 0, sliceLen, offset);
      } catch {
        continue;
      } finally {
        if (fh !== undefined) {
          try { fsImpl.closeSync(fh); } catch { /* best effort */ }
        }
      }
      const isOutbox = outboxFile && file === outboxFile;
      const { lines, consumed } = isOutbox
        ? decodeAppendedPlain(slice)
        : decodeAppended(slice, frameSizeOf);
      if (!consumed) {
        continue; // only a torn tail frame/line so far
      }
      dsh.files[file] = offset + consumed;
      const sessKey = isOutbox ? '' : sessKeyOf(file);
      for (const line of lines) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (isOutbox) {
          // One-way bridge: `text` becomes the bubble line; `kind` rides
          // along so the renderer can pin whale_notify messages until the
          // user dismisses them (whale_pet_say stays transient).
          const text = typeof ev?.text === 'string' ? ev.text.slice(0, 512) : '';
          if (text) {
            const kind = typeof ev?.kind === 'string' ? ev.kind.slice(0, 32) : '';
            emit(EV_WHALE, { summary: text, kind, image: outboxImageOf(ev) });
            dsh.lastSeenAt = t;
          }
          continue;
        }
        feedEvent(dsh, ev, sessKey, t);
      }
    }

    // Continuous-activity window → rest nudge. activeSince plants when work
    // starts; a >10min quiet gap with NO open turn breaks "continuous" so a
    // lunch pause resets the 45-minute clock — but an open turn is activity
    // in itself (a long-running command writes nothing yet is still work).
    const hasOpenTurn = Object.keys(dsh.openTurns).length > 0;
    const quietMs = dsh.lastActiveAt ? t - dsh.lastActiveAt : Infinity;
    const activeNow = hasOpenTurn || quietMs < ACTIVE_WINDOW_MS;
    if (!hasOpenTurn && quietMs > DAY_IDLE_BREAK_MS && dsh.activeSince) {
      dsh.activeSince = 0;
    }
    if (activeNow) {
      if (!dsh.activeSince) {
        dsh.activeSince = t;
      }
      const elapsed = lastPollAt ? Math.min(t - lastPollAt, 30000) : 0;
      if (dsh.day === today) {
        dsh.activeMsToday = (dsh.activeMsToday || 0) + Math.max(0, elapsed);
      }
      const span = t - dsh.activeSince;
      if (span >= REST_FIRST_MS && t - (dsh.lastRestReminder || 0) >= REST_EVERY_MS) {
        dsh.lastRestReminder = t;
        emit(EV_REST, { min: Math.round(span / 60000) });
      }
      if (dsh.lastGreetDay !== today) {
        dsh.lastGreetDay = today;
        if (lastSeenBefore && t - lastSeenBefore >= MISS_AFTER_MS) {
          emit(EV_MISS, { days: Math.floor((t - lastSeenBefore) / 86400000) });
        } else {
          emit('greet');
        }
      }
    }
    lastPollAt = t;

    const state = activeNow ? 'working' : 'idle';
    if (state !== lastState) {
      lastState = state;
      onState?.(state);
    }
    runtimeDsh = dsh;
    // Keep the active-time clock in memory between writes. Log cursors and
    // reminders are committed immediately; elapsed time alone is checkpointed
    // once a minute instead of rewriting config and credentials every 2s.
    const persistedProjection = normalizeDshState(persistedDsh);
    const runtimeProjection = normalizeDshState(dsh);
    const withoutActiveTime = (value) => JSON.stringify({ ...value, activeMsToday: 0 });
    if (withoutActiveTime(runtimeProjection) !== withoutActiveTime(persistedProjection)
        || runtimeProjection.activeMsToday - persistedProjection.activeMsToday >= 60000) {
      write(dsh);
    }
    // Daily-usage snapshot for the whale assistant's whale_usage_today
    // tool — written only when the counters move (this poll runs every 2s).
    if (usageFile) {
      const snapshotPayload = {
        day: dsh.day,
        used: dsh.dayTokens?.used || 0,
        milestones: dsh.milestoneMarks,
        activeMsToday: Math.floor((dsh.activeMsToday || 0) / 60000) * 60000,
        state,
      };
      const snapshot = JSON.stringify(snapshotPayload);
      if (snapshot !== lastUsageJson) {
        try {
          fsImpl.mkdirSync(path.dirname(usageFile), { recursive: true });
          const tmp = `${usageFile}.tmp`;
          fsImpl.writeFileSync(tmp, JSON.stringify({ ...snapshotPayload, at: t }) + '\n', 'utf8');
          fsImpl.renameSync(tmp, usageFile);
          lastUsageJson = snapshot;
        } catch {
          // Best-effort mirror — the authoritative state lives in dsh.*.
        }
      }
    }
  }

  function start(intervalMs = 2000) {
    if (running) {
      return;
    }
    running = true;
    const timer = setInterval(() => {
      try {
        poll();
      } catch {
        // A poisoned log must never take the pet down — skip this tick.
      }
    }, intervalMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    return () => {
      running = false;
      clearInterval(timer);
      if (runtimeDsh && JSON.stringify(normalizeDshState(runtimeDsh))
          !== JSON.stringify(normalizeDshState(read()))) {
        try { write(runtimeDsh); } catch {
          // A failed checkpoint must not prevent the pet window from closing.
        }
      }
      runtimeDsh = null;
      lastPollAt = 0;
      lastState = '';
      lastUsageJson = '';
    };
  }

  return { poll, start };
}

module.exports = {
  REPORT_GATES,
  MILESTONES,
  decodeAppended,
  decodeAppendedPlain,
  listSessionFiles,
  createDshWatch,
};
