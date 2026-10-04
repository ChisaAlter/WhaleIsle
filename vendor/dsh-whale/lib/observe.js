/**
 * Whale pulse — the host-side observer behind her orchestration tools.
 *
 * - events: a ring buffer of notable `session/event` frames across every
 *   session (read back by whale_recent_events)
 * - watches: "tell me when session X's turn ends" — each watched session's
 *   turn/end wakes her once (or every time, when once:false) via a real
 *   queued prompt into her own session (whale_watch)
 * - schedules: file-backed once / interval / daily timers that wake her
 *   the same way (whale_schedule)
 *
 * Waking means a user-role prompt in her session — she reacts with her
 * full toolset rather than a canned side-channel reply. Her own session's
 * events never fire watches; that would be her reacting to herself.
 * Watches and schedules persist under the whale home so a Harness restart
 * keeps them.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { eventText, trimTo } from './shared.js';

const EVENT_BUFFER_MAX = 150;
const WATCH_MAX = 20;
const SCHEDULE_MAX = 40;
const TICK_MS = 30_000;
const SNIPPET_MAX = 160;
const WAKE_TEXT_MAX = 2000;

const WATCHES_FILE = 'watches.json';
const SCHEDULES_FILE = 'schedules.json';

const state = {
  home: '',
  events: [],
  watches: null,
  schedules: null,
  getSelfId: null,
  wake: null,
  logger: null,
  timer: null,
  delivering: new Set(),
};

function file(name) {
  return state.home ? path.join(state.home, name) : '';
}

function readJson(name, fallback) {
  const target = file(name);
  if (!target || !fs.existsSync(target)) return fallback;
  try {
    const value = JSON.parse(fs.readFileSync(target, 'utf8'));
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const target = file(name);
  if (!target) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, target);
}

function ensureLoaded() {
  if (state.watches === null) state.watches = readJson(WATCHES_FILE, []);
  if (state.schedules === null) state.schedules = readJson(SCHEDULES_FILE, []);
}

function warn(line) {
  try { state.logger?.warn?.(line); } catch { /* logger best-effort */ }
}

function selfSessionId() {
  try {
    return String(state.getSelfId?.() ?? '').trim();
  } catch {
    return '';
  }
}

/** One-line description of a session event worth remembering. */
export function describeEvent(event) {
  const data = event?.data ?? {};
  switch (event?.type) {
    case 'user/message': {
      const source = data.source ?? {};
      const who = !source.kind || source.kind === 'user'
        ? '用户'
        : source.kind === 'plugin'
          ? `${source.plugin || 'plugin'} 代投`
          : String(source.kind);
      const text = trimTo(eventText(event).trim(), SNIPPET_MAX);
      return text ? `${who}: ${text}` : `${who} 发了一条非文本消息`;
    }
    case 'assistant/message': {
      const text = trimTo(eventText(event).trim(), SNIPPET_MAX);
      return text ? `回复: ${text}` : '';
    }
    case 'tool/call':
      return `调用工具 ${String(data.name ?? '?')}`;
    case 'turn/start':
      return `回合 #${data.turn ?? '?'} 开始`;
    case 'turn/end': {
      const reason = data.reason ?? {};
      const kind = String(reason.kind ?? 'unknown');
      const detail = trimTo(String(
        reason.error?.message ?? data.error?.message ?? reason.reason?.kind ?? '',
      ), 120);
      return `回合 #${data.turn ?? '?'} 结束（${kind}${detail ? `：${detail}` : ''}）`;
    }
    default:
      return '';
  }
}

function recordEvent(sessionId, event) {
  const detail = describeEvent(event);
  if (!detail) return;
  state.events.push({
    at: Number(event?.time) || Date.now(),
    sessionId,
    type: String(event.type),
    detail,
  });
  if (state.events.length > EVENT_BUFFER_MAX) {
    state.events.splice(0, state.events.length - EVENT_BUFFER_MAX);
  }
}

/** Newest-first slice of the event buffer for whale_recent_events. */
export function recentEvents({ sessionId = '', limit = 30 } = {}) {
  ensureLoaded();
  const wanted = String(sessionId).trim();
  const rows = wanted
    ? state.events.filter((row) => row.sessionId === wanted)
    : state.events;
  return rows.slice(-Math.max(1, Math.min(EVENT_BUFFER_MAX, limit))).reverse();
}

// ── watches ────────────────────────────────────────────────────

export function listWatches() {
  ensureLoaded();
  return state.watches.map((w) => ({ ...w }));
}

export function addWatch({ sessionId, note = '', once = true }) {
  ensureLoaded();
  const id = String(sessionId ?? '').trim();
  if (!id) return { ok: false, error: 'missing-sessionId' };
  const existing = state.watches.find((w) => w.sessionId === id);
  if (existing) {
    existing.note = trimTo(note, 300);
    existing.once = once === true;
    writeJson(WATCHES_FILE, state.watches);
    return { ok: true, watch: { ...existing }, detail: 'updated' };
  }
  if (state.watches.length >= WATCH_MAX) return { ok: false, error: 'watch-list-full' };
  const watch = {
    id: `w-${crypto.randomUUID().slice(0, 8)}`,
    sessionId: id,
    note: trimTo(note, 300),
    once: once === true,
    createdAt: Date.now(),
  };
  state.watches.push(watch);
  writeJson(WATCHES_FILE, state.watches);
  return { ok: true, watch: { ...watch } };
}

export function removeWatch(sessionId) {
  ensureLoaded();
  const id = String(sessionId ?? '').trim();
  const before = state.watches.length;
  state.watches = state.watches.filter((w) => w.sessionId !== id && w.id !== id);
  if (state.watches.length === before) return { ok: false, error: 'watch-not-found' };
  writeJson(WATCHES_FILE, state.watches);
  return { ok: true };
}

function maybeFireWatches(sessionId, event) {
  if (event?.type !== 'turn/end' || !state.watches?.length) return;
  if (sessionId === selfSessionId()) return;
  const hit = state.watches.filter((w) => w.sessionId === sessionId);
  if (!hit.length) return;
  const detail = describeEvent(event);
  for (const watch of hit) {
    // Keep the report on disk until the assistant inbox has accepted it.
    watch.pending ??= [];
    if (!watch.once || !watch.pending.length) {
      watch.pending.push(`（观察回报）会话 ${sessionId} ${detail}${watch.note ? ` —— 你的备注：${watch.note}` : ''}`);
    }
  }
  writeJson(WATCHES_FILE, state.watches);
  void deliverWatches().catch((error) => warn(`dsh-whale pulse event delivery failed: ${error?.message ?? error}`));
}

// ── schedules ──────────────────────────────────────────────────

export function listSchedules() {
  ensureLoaded();
  return state.schedules.map((s) => ({ ...s }));
}

const DAILY_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function dailyNextRun(daily, from) {
  const [, h, m] = DAILY_RE.exec(daily);
  const next = new Date(from);
  next.setHours(Number(h), Number(m), 0, 0);
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  return next.getTime();
}

function nextRunAt(schedule, from) {
  if (schedule.kind === 'interval') return from + schedule.everyMinutes * 60_000;
  if (schedule.kind === 'daily') return dailyNextRun(schedule.daily, from);
  return 0;
}

export function addSchedule(input = {}) {
  ensureLoaded();
  const text = trimTo(String(input.text ?? '').trim(), 500);
  if (!text) return { ok: false, error: 'missing-text' };
  if (state.schedules.length >= SCHEDULE_MAX) {
    // Finished entries are history rows, not live timers — drop the oldest
    // before refusing a new schedule outright.
    const pruned = state.schedules.filter((s) => s.enabled !== false);
    if (pruned.length === state.schedules.length) return { ok: false, error: 'schedule-list-full' };
    state.schedules = pruned;
  }
  const now = Date.now();
  const schedule = {
    id: `sch-${crypto.randomUUID().slice(0, 8)}`,
    text,
    kind: '',
    nextRunAt: 0,
    runCount: 0,
    enabled: true,
    createdAt: now,
  };
  const inMinutes = Number(input.inMinutes);
  const everyMinutes = Number(input.everyMinutes);
  const daily = String(input.daily ?? '').trim();
  const maxRuns = Number(input.maxRuns);
  if (Number.isFinite(maxRuns) && maxRuns > 0) schedule.maxRuns = Math.floor(maxRuns);
  if (Number.isFinite(inMinutes) && inMinutes > 0) {
    schedule.kind = 'once';
    schedule.nextRunAt = now + Math.floor(inMinutes * 60_000);
  } else if (Number.isFinite(everyMinutes) && everyMinutes >= 1) {
    schedule.kind = 'interval';
    schedule.everyMinutes = Math.floor(everyMinutes);
    schedule.nextRunAt = now + schedule.everyMinutes * 60_000;
  } else if (DAILY_RE.test(daily)) {
    schedule.kind = 'daily';
    schedule.daily = daily;
    schedule.nextRunAt = dailyNextRun(daily, now);
  } else {
    return { ok: false, error: 'need inMinutes / everyMinutes / daily(HH:MM)' };
  }
  state.schedules.push(schedule);
  writeJson(SCHEDULES_FILE, state.schedules);
  return { ok: true, schedule: { ...schedule } };
}

export function removeSchedule(id) {
  ensureLoaded();
  const wanted = String(id ?? '').trim();
  const before = state.schedules.length;
  state.schedules = state.schedules.filter((s) => s.id !== wanted);
  if (state.schedules.length === before) return { ok: false, error: 'schedule-not-found' };
  writeJson(SCHEDULES_FILE, state.schedules);
  return { ok: true };
}

async function wake(text) {
  const deliver = state.wake;
  if (typeof deliver !== 'function') throw new Error('assistant-unavailable');
  const result = await deliver(trimTo(text, WAKE_TEXT_MAX));
  if (result?.ok === false || result?.accepted === false) throw new Error(result.error || 'prompt-not-accepted');
}

async function deliverWatches() {
  for (const watch of state.watches.filter((w) => w.pending?.length)) {
    if (state.delivering.has(watch.id)) continue;
    state.delivering.add(watch.id);
    try {
      while (watch.pending?.length && state.watches.includes(watch)) {
        await wake(watch.pending[0]);
        watch.pending.shift();
        delete watch.lastError;
        if (watch.once) state.watches = state.watches.filter((w) => w !== watch);
        // Persist each receipt so a later delivery failure keeps only unsent reports.
        writeJson(WATCHES_FILE, state.watches);
      }
      if (!watch.pending?.length) delete watch.pending;
    } catch (error) {
      watch.lastError = String(error?.message ?? error);
      warn(`dsh-whale pulse wake failed: ${watch.lastError}`);
    } finally {
      state.delivering.delete(watch.id);
      writeJson(WATCHES_FILE, state.watches);
    }
  }
}

// Exported so tests can drive the scheduler without waiting on TICK_MS.
export async function tick(now = Date.now()) {
  ensureLoaded();
  await deliverWatches();
  const due = state.schedules.filter((s) => s.enabled !== false && Number(s.nextRunAt) > 0 && s.nextRunAt <= now);
  if (!due.length) return;
  for (const s of due) {
    if (state.delivering.has(s.id)) continue;
    state.delivering.add(s.id);
    try {
      await wake(`（定时任务 ${s.id} 到点）${s.text}`);
      s.runCount = (s.runCount || 0) + 1;
      delete s.lastError;
      if (s.kind === 'once') s.enabled = false;
      else s.nextRunAt = nextRunAt(s, now);
      if (Number.isInteger(s.maxRuns) && s.maxRuns > 0 && s.runCount >= s.maxRuns) s.enabled = false;
    } catch (error) {
      s.lastError = String(error?.message ?? error);
      warn(`dsh-whale pulse wake failed: ${s.lastError}`);
    } finally {
      state.delivering.delete(s.id);
      writeJson(SCHEDULES_FILE, state.schedules);
    }
  }
}

/**
 * Install the observer on the host context. `session/event` rides cordis's
 * global subscription so the buffer sees every session, not just hers.
 * The wake callback resolves her session and queues the prompt.
 */
export function startPulse(ctx, { home, getSelfId, wake: deliver, logger } = {}) {
  if (state.timer) clearInterval(state.timer);
  if (state.home !== String(home ?? '')) {
    state.watches = null;
    state.schedules = null;
    state.events = [];
  }
  state.home = String(home ?? '');
  state.getSelfId = typeof getSelfId === 'function' ? getSelfId : null;
  state.wake = typeof deliver === 'function' ? deliver : null;
  state.logger = logger ?? null;
  ensureLoaded();
  ctx.on('session/event', (session, event) => {
    try {
      const sessionId = String(session?.id ?? session ?? '');
      if (!sessionId) return;
      recordEvent(sessionId, event);
      maybeFireWatches(sessionId, event);
    } catch (error) {
      warn(`dsh-whale pulse event failed: ${error?.message ?? error}`);
    }
  }, { global: true });
  state.timer = setInterval(() => {
    void tick().catch((error) => {
      warn(`dsh-whale pulse tick failed: ${error?.message ?? error}`);
    });
  }, TICK_MS);
  state.timer.unref?.();
  ctx.effect?.(() => () => {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }, 'dsh-whale:pulse');
}
