/**
 * One-shot safe migration from legacy `$DSH_HOME/data/whale/schedules.json`
 * into the native `@deepseek-ai/dsh-schedule` Host service.
 * Preserves the original file as `schedules.json.migrated` — never deletes
 * user history, and leaves `schedules.json` untouched if native schedule is
 * unavailable or any migration call fails transiently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { whaleHomeDir } from './preset.js';

const SCHEDULES_FILENAME = 'schedules.json';
const MIGRATED_FILENAME = 'schedules.json.migrated';
const DAILY_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Map a legacy whale schedule row into a native `ScheduleCreateRequest`.
 * Returns `null` for disabled or already-expired one-shot entries.
 * @param {any} row
 * @param {string} sessionId
 * @param {number} now
 * @param {string} timeZone
 */
export function mapLegacyScheduleToNative(row, sessionId, now = Date.now(), timeZone = localTimeZone()) {
  if (!row || row.enabled === false) return null;
  const prompt = String(row.text ?? '').trim();
  if (!prompt) return null;
  const title = prompt.slice(0, 80).trim();
  if (!title) return null;
  const target = { kind: 'session', sessionId };

  if (row.kind === 'once') {
    const nextRunAt = Number(row.nextRunAt) || 0;
    if (nextRunAt <= now) return null;
    return {
      title,
      prompt,
      timing: { kind: 'at', at: new Date(nextRunAt).toISOString() },
      target,
    };
  }
  if (row.kind === 'interval') {
    const minutes = Math.max(1, Math.floor(Number(row.everyMinutes) || 1));
    return {
      title,
      prompt,
      timing: { kind: 'every', every_seconds: minutes * 60 },
      target,
    };
  }
  if (row.kind === 'daily') {
    const match = DAILY_RE.exec(String(row.daily ?? '').trim());
    if (!match) return null;
    const hh = match[1].padStart(2, '0');
    const mm = match[2].padStart(2, '0');
    return {
      title,
      prompt,
      timing: { kind: 'daily', daily: { time: `${hh}:${mm}:00`, time_zone: timeZone } },
      target,
    };
  }
  return null;
}

function readLegacyScheduleRows(legacyFile, logger) {
  try {
    const parsed = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    return { ok: true, rows: Array.isArray(parsed) ? parsed : [] };
  } catch (/** @type {any} */ error) {
    logger?.warn?.(`dsh-whale schedule migration skipped (corrupt JSON): ${error?.message ?? error}`);
    return { ok: false, rows: [] };
  }
}

function renameLegacyBackup(dir, legacyFile, backupFile) {
  const finalBackup = fs.existsSync(backupFile)
    ? path.join(dir, `${MIGRATED_FILENAME}.${Date.now()}`)
    : backupFile;
  fs.renameSync(legacyFile, finalBackup);
  return finalBackup;
}

const PERMANENT_ROW_ERRORS = new Set([
  'not_future',
  'invalid_prompt',
  'invalid_rule',
  'invalid_selector',
  'invalid_time_zone',
  'time_out_of_range',
  'frequency_too_high',
]);

function rowDedupKey(kind, title, prompt) {
  return `${String(kind ?? '')}\0${String(title ?? '').trim()}\0${String(prompt ?? '').trim()}`;
}

async function existingSessionScheduleKeys(scheduleSvc, sessionId) {
  const keys = new Set();
  if (typeof scheduleSvc?.list !== 'function') return keys;
  try {
    const listed = await scheduleSvc.list({ active: true, limit: 500 });
    for (const item of listed?.items ?? []) {
      if (item?.target?.kind === 'session' && item.target.sessionId === sessionId) {
        keys.add(rowDedupKey(item.kind, item.title, item.prompt));
      }
    }
  } catch {
    // Best-effort dedupe only; never block migration if list is unavailable.
  }
  return keys;
}

async function createWithTzFallback(scheduleSvc, req, sessionId) {
  try {
    return await scheduleSvc.create(req, sessionId, AbortSignal.timeout(15_000));
  } catch (/** @type {any} */ error) {
    if (error?.code === 'invalid_time_zone' && req?.timing?.kind === 'daily' && req.timing.daily?.time_zone !== 'UTC') {
      const utcReq = { ...req, timing: { kind: 'daily', daily: { ...req.timing.daily, time_zone: 'UTC' } } };
      return await scheduleSvc.create(utcReq, sessionId, AbortSignal.timeout(15_000));
    }
    throw error;
  }
}

async function migrateOneLegacyRow(scheduleSvc, row, { sessionId, now, tz, seenKeys, logger }) {
  const req = mapLegacyScheduleToNative(row, sessionId, now, tz);
  if (!req) return { kind: 'skip' };
  const key = rowDedupKey(req.timing.kind, req.title, req.prompt);
  if (seenKeys.has(key)) return { kind: 'skip' };
  try {
    const created = await createWithTzFallback(scheduleSvc, req, sessionId);
    seenKeys.add(key);
    return { kind: 'created', id: created?.id ?? '' };
  } catch (/** @type {any} */ error) {
    if (!PERMANENT_ROW_ERRORS.has(String(error?.code ?? ''))) throw error;
    logger?.warn?.(`dsh-whale schedule migration skipped invalid row (${error.code}): ${error?.message ?? error}`);
    return { kind: 'invalid' };
  }
}

/**
 * Migrate active entries from `schedules.json` into native `ctx.schedule`
 * targeting the resident whale-girl session (never any active subagent or
 * task session!), then rename `schedules.json` -> `schedules.json.migrated`.
 *
 * @param {any} ctx
 * @param {{ home: string, sessionId: string, now?: number, timeZone?: string, logger?: any }} opts
 */
export async function migrateLegacySchedules(ctx, { home, sessionId, now = Date.now(), timeZone, logger } = {}) {
  if (!home || !sessionId) return { migrated: 0, skipped: true, reason: 'missing-home-or-session' };
  const dir = whaleHomeDir(home);
  const legacyFile = path.join(dir, SCHEDULES_FILENAME);
  if (!fs.existsSync(legacyFile)) return { migrated: 0, skipped: true, reason: 'no-legacy-file' };
  const scheduleSvc = ctx?.get?.('schedule') ?? ctx?.schedule;
  if (typeof scheduleSvc?.create !== 'function') {
    return { migrated: 0, skipped: true, reason: 'native-schedule-unavailable' };
  }
  const loaded = readLegacyScheduleRows(legacyFile, logger);
  if (!loaded.ok) return { migrated: 0, skipped: true, reason: 'corrupt-json' };

  const tz = timeZone || localTimeZone();
  const seenKeys = await existingSessionScheduleKeys(scheduleSvc, sessionId);
  const createdIds = [];
  let skippedInvalid = 0;
  for (const row of loaded.rows) {
    const outcome = await migrateOneLegacyRow(scheduleSvc, row, { sessionId, now, tz, seenKeys, logger });
    if (outcome.kind === 'created' && outcome.id) createdIds.push(outcome.id);
    else if (outcome.kind === 'invalid') skippedInvalid += 1;
  }
  const finalBackup = renameLegacyBackup(dir, legacyFile, path.join(dir, MIGRATED_FILENAME));
  return {
    migrated: createdIds.length,
    totalLegacyRows: loaded.rows.length,
    createdIds,
    skippedInvalid,
    backupFile: finalBackup,
    skipped: false,
  };
}

/**
 * Create a deduplicated migration runner and also subscribe to `['schedule',
 * 'agentPresets', 'sessionController']` so async `ScheduleService` activation
 * never causes legacy `schedules.json` migration to be skipped.
 */
export function installLegacyScheduleMigration(ctx, scope, home, ensureAssistantSession) {
  let inflight = null;
  const runOnce = (targetCtx, sessionId) => {
    if (!home || !sessionId) return Promise.resolve();
    if (inflight) return inflight;
    inflight = migrateLegacySchedules(targetCtx, { home, sessionId, logger: ctx.logger })
      .catch((error) => {
        ctx.logger?.warn?.(`dsh-whale legacy schedule migration failed: ${error?.message ?? error}`);
        return { skipped: true, reason: 'error' };
      })
      .then((res) => {
        if (res?.skipped && (res.reason === 'native-schedule-unavailable' || res.reason === 'error')) {
          inflight = null;
        }
        return res;
      });
    return inflight;
  };
  if (home) {
    ctx.inject?.(['schedule', 'agentPresets', 'sessionController'], (schedHost) => schedHost.effect(async () => {
      const ensured = await ensureAssistantSession(ctx, scope, schedHost.sessionController).catch(() => null);
      if (ensured?.ok) await runOnce(schedHost, ensured.sessionId);
    }));
  }
  return runOnce;
}
