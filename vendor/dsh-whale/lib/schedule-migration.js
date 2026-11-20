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
  const title = prompt.slice(0, 80);
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
  const createdIds = [];
  for (const row of loaded.rows) {
    const req = mapLegacyScheduleToNative(row, sessionId, now, tz);
    if (!req) continue;
    const created = await scheduleSvc.create(req, sessionId, AbortSignal.timeout(15_000));
    if (created?.id) createdIds.push(created.id);
  }
  const finalBackup = renameLegacyBackup(dir, legacyFile, path.join(dir, MIGRATED_FILENAME));
  return {
    migrated: createdIds.length,
    totalLegacyRows: loaded.rows.length,
    createdIds,
    backupFile: finalBackup,
    skipped: false,
  };
}
