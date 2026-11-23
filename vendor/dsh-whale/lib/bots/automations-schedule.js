/**
 * Pure RRULE, Cron, IANA timezone scheduling, and automation spec helpers
 * for `automations-service.js`.
 */
import crypto from 'node:crypto';

const MAX_SCAN_DAYS = 366 * 4 + 2;

const RRULE_FREQS = new Set(['MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']);
const RRULE_ALLOWED_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYHOUR', 'BYMINUTE', 'BYMONTHDAY', 'WKST']);
/** @type {Readonly<Record<string, number>>} */
const RRULE_DAY_MAP = Object.freeze({
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
});
/** @type {Readonly<Record<string, number>>} */
const CRON_DAY_ALIASES = Object.freeze({
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
});
/** @type {Readonly<Record<string, number>>} */
const WEEKDAY_SHORT_TO_DOW = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
});

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatterCache = new Map();

/** @param {string} message */
export function invalidArg(message) {
  return Object.assign(new Error(message), { code: 'invalid_argument' });
}

/** @param {string} timeZone */
function getFormatter(timeZone) {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** @param {string | null | undefined} timezone */
export function validateTimezone(timezone) {
  if (timezone === null || timezone === undefined || timezone === '') return null;
  const tz = String(timezone).trim();
  if (!tz) return null;
  try {
    getFormatter(tz);
  } catch {
    throw invalidArg(`Invalid timezone: ${tz}`);
  }
  return tz;
}

/** @param {number} epochMs @param {string | null} timeZone */
function getWallParts(epochMs, timeZone) {
  if (!timeZone) {
    const d = new Date(epochMs);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      dow: d.getDay(),
      hour: d.getHours(),
      minute: d.getMinutes(),
    };
  }
  const parts = getFormatter(timeZone).formatToParts(new Date(epochMs));
  let year = 0;
  let month = 1;
  let day = 1;
  let dow = 0;
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
    else if (p.type === 'weekday') dow = WEEKDAY_SHORT_TO_DOW[p.value] ?? 0;
    else if (p.type === 'hour') hour = Number(p.value) === 24 ? 0 : Number(p.value);
    else if (p.type === 'minute') minute = Number(p.value);
  }
  return { year, month, day, dow, hour, minute };
}

/** @param {number} year @param {number} month @param {number} day @param {number} hour @param {number} minute @param {string | null} timeZone */
function wallClockToEpochMs(year, month, day, hour, minute, timeZone) {
  if (!timeZone) {
    const d = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (
      d.getFullYear() !== year
      || d.getMonth() + 1 !== month
      || d.getDate() !== day
      || d.getHours() !== hour
      || d.getMinutes() !== minute
    ) {
      return null;
    }
    return d.getTime();
  }
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetUtc;
  for (let i = 0; i < 3; i += 1) {
    const parts = getWallParts(guess, timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const diff = targetUtc - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  const verify = getWallParts(guess, timeZone);
  if (
    verify.year !== year
    || verify.month !== month
    || verify.day !== day
    || verify.hour !== hour
    || verify.minute !== minute
  ) {
    return null;
  }
  return guess;
}

/** @param {number} year @param {number} month */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** @param {number} year @param {number} month @param {number} day */
function dayIndexUtc(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** @param {number} year @param {number} month @param {number} day @param {number} wkst */
function weekIndexUtc(year, month, day, wkst) {
  const idx = dayIndexUtc(year, month, day);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const offset = (dow - wkst + 7) % 7;
  return Math.floor((idx - offset) / 7);
}

/** @param {number} idx */
function dateFromDayIndex(idx) {
  const d = new Date(idx * 86_400_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dow: d.getUTCDay(),
  };
}

/** @param {string} raw @param {number} min @param {number} max @param {string} fieldName @param {boolean} [allowZero] */
function parseIntList(raw, min, max, fieldName, allowZero = true) {
  const parts = raw.split(',');
  if (parts.length === 0 || parts.some((p) => !p.trim())) {
    throw invalidArg(`Invalid ${fieldName} list: "${raw}"`);
  }
  /** @type {Set<number>} */
  const values = new Set();
  for (const part of parts) {
    const token = part.trim();
    if (!/^-?\d+$/.test(token)) {
      throw invalidArg(`Invalid integer "${token}" in ${fieldName}`);
    }
    const num = Number(token);
    if (!Number.isInteger(num) || num < min || num > max || (!allowZero && num === 0)) {
      throw invalidArg(`Out-of-range value ${token} in ${fieldName} (allowed ${min}..${max})`);
    }
    values.add(num);
  }
  return [...values].sort((a, b) => a - b);
}

/** @param {string} raw */
function parseRruleKeyMap(raw) {
  const body = raw.replace(/^RRULE:/i, '').trim();
  const segments = body ? body.split(';').filter((s) => s.length > 0) : [];
  if (segments.length === 0) throw invalidArg('Empty RRULE expression');

  /** @type {Record<string, string>} */
  const map = {};
  for (const seg of segments) {
    const eqIdx = seg.indexOf('=');
    if (eqIdx <= 0 || eqIdx === seg.length - 1) {
      throw invalidArg(`Malformed RRULE segment: "${seg}"`);
    }
    const key = seg.slice(0, eqIdx).trim().toUpperCase();
    const val = seg.slice(eqIdx + 1).trim().toUpperCase();
    if (!RRULE_ALLOWED_KEYS.has(key)) throw invalidArg(`Unsupported RRULE field: "${key}"`);
    if (Object.prototype.hasOwnProperty.call(map, key)) throw invalidArg(`Duplicate RRULE field: "${key}"`);
    if (!val) throw invalidArg(`Empty value for RRULE field: "${key}"`);
    map[key] = val;
  }
  return map;
}

/** @param {string | undefined} rawInterval */
function parseRruleInterval(rawInterval) {
  if (rawInterval === undefined) return 1;
  if (!/^\d+$/.test(rawInterval)) throw invalidArg(`Invalid RRULE INTERVAL: "${rawInterval}"`);
  const interval = Number(rawInterval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 10_000) {
    throw invalidArg(`RRULE INTERVAL out of range: ${rawInterval}`);
  }
  return interval;
}

/** @param {string | undefined} rawByDay */
function parseRruleByDay(rawByDay) {
  if (rawByDay === undefined) return null;
  /** @type {Set<number>} */
  const dows = new Set();
  for (const tok of rawByDay.split(',')) {
    const clean = tok.trim();
    if (!Object.prototype.hasOwnProperty.call(RRULE_DAY_MAP, clean)) {
      throw invalidArg(`Invalid RRULE BYDAY value: "${clean}"`);
    }
    dows.add(RRULE_DAY_MAP[clean]);
  }
  return [...dows].sort((a, b) => a - b);
}

/** @param {string} raw */
function parseRruleExpression(raw) {
  const map = parseRruleKeyMap(raw);
  if (!map.FREQ || !RRULE_FREQS.has(map.FREQ)) {
    throw invalidArg(`Invalid or missing RRULE FREQ: "${map.FREQ ?? ''}"`);
  }
  let wkst = 1; // Monday default per RFC 5545
  if (map.WKST !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(RRULE_DAY_MAP, map.WKST)) {
      throw invalidArg(`Invalid RRULE WKST value: "${map.WKST}"`);
    }
    wkst = RRULE_DAY_MAP[map.WKST];
  }
  return {
    kind: 'rrule',
    freq: map.FREQ,
    interval: parseRruleInterval(map.INTERVAL),
    byDay: parseRruleByDay(map.BYDAY),
    byHour: map.BYHOUR !== undefined ? parseIntList(map.BYHOUR, 0, 23, 'BYHOUR') : null,
    byMinute: map.BYMINUTE !== undefined ? parseIntList(map.BYMINUTE, 0, 59, 'BYMINUTE') : null,
    byMonthDay: map.BYMONTHDAY !== undefined ? parseIntList(map.BYMONTHDAY, -31, 31, 'BYMONTHDAY', false) : null,
    wkst,
  };
}

/**
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @param {string} name
 * @param {Readonly<Record<string, number>> | null} [aliases]
 */
function parseCronField(field, min, max, name, aliases = null) {
  const trimmed = field.trim().toUpperCase();
  if (!trimmed) throw invalidArg(`Empty cron ${name} field`);
  const isWildcard = trimmed === '*';
  /** @type {Set<number>} */
  const result = new Set();

  /** @param {string} token */
  const resolveAtom = (token) => {
    if (aliases && Object.prototype.hasOwnProperty.call(aliases, token)) {
      return aliases[token];
    }
    if (!/^\d+$/.test(token)) {
      throw invalidArg(`Invalid cron ${name} value: "${token}"`);
    }
    let val = Number(token);
    if (name === 'dow' && val === 7) val = 0;
    if (!Number.isInteger(val) || val < min || val > max) {
      throw invalidArg(`Out-of-range cron ${name} value: "${token}"`);
    }
    return val;
  };

  for (const part of trimmed.split(',')) {
    if (!part) throw invalidArg(`Invalid cron ${name} list: "${field}"`);
    const slashParts = part.split('/');
    if (slashParts.length > 2) throw invalidArg(`Invalid cron ${name} step: "${part}"`);
    const rangeExpr = slashParts[0];
    let step = 1;
    if (slashParts.length === 2) {
      if (!/^\d+$/.test(slashParts[1])) throw invalidArg(`Invalid cron ${name} step: "${part}"`);
      step = Number(slashParts[1]);
      if (step < 1) throw invalidArg(`Cron ${name} step must be >= 1: "${part}"`);
    }

    let start = min;
    let end = max;
    if (rangeExpr === '*') {
      start = min;
      end = max;
    } else if (rangeExpr.includes('-')) {
      const bounds = rangeExpr.split('-');
      if (bounds.length !== 2) throw invalidArg(`Invalid cron ${name} range: "${part}"`);
      start = resolveAtom(bounds[0]);
      end = resolveAtom(bounds[1]);
      if (end < start) throw invalidArg(`Inverted cron ${name} range: "${part}"`);
    } else {
      start = resolveAtom(rangeExpr);
      end = slashParts.length === 2 ? max : start;
    }

    for (let v = start; v <= end; v += step) {
      result.add(name === 'dow' && v === 7 ? 0 : v);
    }
  }

  return {
    values: [...result].sort((a, b) => a - b),
    wildcard: isWildcard,
  };
}

/** @param {string} raw */
function parseCronExpression(raw) {
  const fields = raw.trim().split(/\s+/u);
  if (fields.length !== 5) {
    throw invalidArg(`Invalid schedule expression (expected RRULE or 5-field cron): "${raw}"`);
  }
  const minute = parseCronField(fields[0], 0, 59, 'minute');
  const hour = parseCronField(fields[1], 0, 23, 'hour');
  const dom = parseCronField(fields[2], 1, 31, 'dom');
  const month = parseCronField(fields[3], 1, 12, 'month');
  const dow = parseCronField(fields[4], 0, 7, 'dow', CRON_DAY_ALIASES);
  return {
    kind: 'cron',
    minutes: minute.values,
    hours: hour.values,
    doms: new Set(dom.values),
    domWildcard: dom.wildcard,
    months: new Set(month.values),
    dows: new Set(dow.values),
    dowWildcard: dow.wildcard,
  };
}

/**
 * Strictly parse either an RFC 5545 RRULE or a 5-field Cron expression.
 * Rejects unknown fields or invalid values rather than silently dropping them.
 * @param {string} expr
 */
export function parseScheduleExpression(expr) {
  if (typeof expr !== 'string' || !expr.trim()) {
    throw invalidArg('Schedule expression must be a non-empty string');
  }
  const trimmed = expr.trim();
  if (/^RRULE:/i.test(trimmed) || /(?:^|;)\s*FREQ\s*=/i.test(trimmed) || trimmed.includes('=')) {
    return parseRruleExpression(trimmed);
  }
  return parseCronExpression(trimmed);
}

/** @param {number} monthDaysCount @param {number[]} byMonthDay @param {number} day */
function matchesByMonthDay(monthDaysCount, byMonthDay, day) {
  for (const spec of byMonthDay) {
    const resolved = spec > 0 ? spec : monthDaysCount + 1 + spec;
    if (resolved === day) return true;
  }
  return false;
}

/**
 * @param {any} parsed
 * @param {number} now
 * @param {string | null} timeZone
 * @param {{ year: number, month: number, day: number, dow: number, hour: number, minute: number }} startWall
 * @param {number} startDayIdx
 */
function nextFromCronSchedule(parsed, now, timeZone, startWall, startDayIdx) {
  for (let offset = 0; offset < MAX_SCAN_DAYS; offset += 1) {
    const date = dateFromDayIndex(startDayIdx + offset);
    if (!parsed.months.has(date.month)) continue;
    const domMatch = parsed.doms.has(date.day);
    const dowMatch = parsed.dows.has(date.dow);
    const dayOk = (!parsed.domWildcard && !parsed.dowWildcard)
      ? (domMatch || dowMatch)
      : (domMatch && dowMatch);
    if (!dayOk) continue;

    for (const h of parsed.hours) {
      if (offset === 0 && h < startWall.hour) continue;
      for (const m of parsed.minutes) {
        if (offset === 0 && h === startWall.hour && m < startWall.minute) continue;
        const ts = wallClockToEpochMs(date.year, date.month, date.day, h, m, timeZone);
        if (ts !== null && ts > now) return ts;
      }
    }
  }
  return null;
}

/** @param {any} parsed @param {number} now @param {number} anchorMinUtc */
function nextFromMinutelyFastPath(parsed, now, anchorMinUtc) {
  const nowMin = Math.floor(now / 60_000);
  if (parsed.interval === 1) return (nowMin + 1) * 60_000;
  const diff = nowMin - anchorMinUtc;
  const steps = diff < 0 ? 0 : Math.floor(diff / parsed.interval) + 1;
  let candMin = anchorMinUtc + steps * parsed.interval;
  while (candMin * 60_000 <= now) candMin += parsed.interval;
  return candMin * 60_000;
}

/**
 * @param {any} parsed
 * @param {number} curDayIdx
 * @param {{ year: number, month: number, day: number, dow: number }} date
 * @param {{ year: number, month: number, day: number }} anchorWall
 * @param {number} anchorDayIdx
 * @param {number} anchorWeekIdx
 */
function matchesRruleDayInterval(parsed, curDayIdx, date, anchorWall, anchorDayIdx, anchorWeekIdx) {
  if (parsed.interval <= 1) return true;
  if (parsed.freq === 'DAILY') {
    const dayDiff = curDayIdx - anchorDayIdx;
    return dayDiff >= 0 && dayDiff % parsed.interval === 0;
  }
  if (parsed.freq === 'WEEKLY') {
    const weekDiff = weekIndexUtc(date.year, date.month, date.day, parsed.wkst) - anchorWeekIdx;
    return weekDiff >= 0 && weekDiff % parsed.interval === 0;
  }
  if (parsed.freq === 'MONTHLY') {
    const monthDiff = (date.year - anchorWall.year) * 12 + (date.month - anchorWall.month);
    return monthDiff >= 0 && monthDiff % parsed.interval === 0;
  }
  return true;
}

/** @param {any} parsed @param {number} ts @param {number} anchorHourUtc @param {number} anchorMinUtc */
function matchesRruleSubdayInterval(parsed, ts, anchorHourUtc, anchorMinUtc) {
  if (parsed.interval <= 1) return true;
  if (parsed.freq === 'HOURLY') {
    const hourDiff = Math.floor(ts / 3_600_000) - anchorHourUtc;
    return hourDiff >= 0 && hourDiff % parsed.interval === 0;
  }
  if (parsed.freq === 'MINUTELY') {
    const minDiff = Math.floor(ts / 60_000) - anchorMinUtc;
    return minDiff >= 0 && minDiff % parsed.interval === 0;
  }
  return true;
}

/**
 * @param {any} parsed
 * @param {{ year: number, month: number, day: number, dow: number }} date
 * @param {number} offset
 * @param {{ hour: number, minute: number }} startWall
 * @param {readonly number[]} candidateHours
 * @param {readonly number[]} candidateMinutes
 * @param {string | null} timeZone
 * @param {number} now
 * @param {number} anchorHourUtc
 * @param {number} anchorMinUtc
 */
function findMatchingTimeOnDay(
  parsed,
  date,
  offset,
  startWall,
  candidateHours,
  candidateMinutes,
  timeZone,
  now,
  anchorHourUtc,
  anchorMinUtc,
) {
  for (const h of candidateHours) {
    if (offset === 0 && h < startWall.hour) continue;
    for (const m of candidateMinutes) {
      if (offset === 0 && h === startWall.hour && m < startWall.minute) continue;
      const ts = wallClockToEpochMs(date.year, date.month, date.day, h, m, timeZone);
      if (ts === null || ts <= now) continue;
      if (!matchesRruleSubdayInterval(parsed, ts, anchorHourUtc, anchorMinUtc)) continue;
      return ts;
    }
  }
  return null;
}

const ALL_HOURS = Object.freeze(Array.from({ length: 24 }, (_, i) => i));
const ALL_MINUTES = Object.freeze(Array.from({ length: 60 }, (_, i) => i));

/** @param {any} parsed @param {{ year: number, month: number, day: number, dow: number, hour: number, minute: number }} anchorWall */
function resolveRruleCandidates(parsed, anchorWall) {
  return {
    candidateHours: parsed.byHour
      ?? (parsed.freq === 'MINUTELY' || parsed.freq === 'HOURLY' ? ALL_HOURS : [anchorWall.hour]),
    candidateMinutes: parsed.byMinute
      ?? (parsed.freq === 'MINUTELY' ? ALL_MINUTES : [anchorWall.minute]),
    effectiveByDay: parsed.byDay
      ?? (parsed.freq === 'WEEKLY' && !parsed.byMonthDay ? [anchorWall.dow] : null),
    effectiveByMonthDay: parsed.byMonthDay
      ?? (parsed.freq === 'MONTHLY' && !parsed.byDay ? [anchorWall.day] : null),
  };
}

/**
 * @param {any} parsed
 * @param {number} now
 * @param {string | null} timeZone
 * @param {{ year: number, month: number, day: number, dow: number, hour: number, minute: number }} startWall
 * @param {number} startDayIdx
 * @param {number} anchorAt
 */
function nextFromRruleSchedule(parsed, now, timeZone, startWall, startDayIdx, anchorAt) {
  const anchorWall = getWallParts(anchorAt, timeZone);
  const anchorDayIdx = dayIndexUtc(anchorWall.year, anchorWall.month, anchorWall.day);
  const anchorWeekIdx = weekIndexUtc(anchorWall.year, anchorWall.month, anchorWall.day, parsed.wkst);
  const anchorMinUtc = Math.floor(anchorAt / 60_000);
  const anchorHourUtc = Math.floor(anchorAt / 3_600_000);

  if (parsed.freq === 'MINUTELY' && !parsed.byDay && !parsed.byMonthDay && !parsed.byHour && !parsed.byMinute) {
    return nextFromMinutelyFastPath(parsed, now, anchorMinUtc);
  }

  const { candidateHours, candidateMinutes, effectiveByDay, effectiveByMonthDay } = resolveRruleCandidates(parsed, anchorWall);

  for (let offset = 0; offset < MAX_SCAN_DAYS; offset += 1) {
    const curDayIdx = startDayIdx + offset;
    const date = dateFromDayIndex(curDayIdx);
    if (!matchesRruleDayInterval(parsed, curDayIdx, date, anchorWall, anchorDayIdx, anchorWeekIdx)) continue;
    if (effectiveByDay && !effectiveByDay.includes(date.dow)) continue;
    if (effectiveByMonthDay && !matchesByMonthDay(daysInMonth(date.year, date.month), effectiveByMonthDay, date.day)) {
      continue;
    }
    const ts = findMatchingTimeOnDay(
      parsed, date, offset, startWall, candidateHours, candidateMinutes, timeZone, now, anchorHourUtc, anchorMinUtc,
    );
    if (ts !== null) return ts;
  }
  return null;
}

/** @param {any} parsed @param {number} now @param {string | null} timeZone @param {number} anchorAt */
function nextFromParsedSchedule(parsed, now, timeZone, anchorAt) {
  const startMs = Math.floor(now / 60_000) * 60_000 + 60_000;
  const startWall = getWallParts(startMs, timeZone);
  const startDayIdx = dayIndexUtc(startWall.year, startWall.month, startWall.day);
  if (parsed.kind === 'cron') {
    return nextFromCronSchedule(parsed, now, timeZone, startWall, startDayIdx);
  }
  return nextFromRruleSchedule(parsed, now, timeZone, startWall, startDayIdx, anchorAt);
}

/**
 * Compute next run timestamp from an automation spec (explicit `once.by`,
 * RFC 5545 RRULE, 5-field Cron, or `intervalMinutes`).
 * Strictly validates `schedule`/`rrule` and `timezone`.
 * @param {any} input
 * @param {number} [now]
 */
export function computeNextRunAt(input, now = Date.now()) {
  if (!input || typeof input !== 'object') return null;
  if (input.once && Number.isFinite(input.once.by)) {
    return input.once.by;
  }
  const rawExpr = input.schedule ?? input.rrule ?? null;
  const timezone = validateTimezone(input.timezone);
  if (typeof rawExpr === 'string' && rawExpr.trim()) {
    const parsed = parseScheduleExpression(rawExpr);
    const anchorAt = Number.isFinite(input.anchorAt)
      ? input.anchorAt
      : (Number.isFinite(input.lastRunAt)
        ? input.lastRunAt
        : (Number.isFinite(input.createdAt) ? input.createdAt : now));
    return nextFromParsedSchedule(parsed, now, timezone, anchorAt);
  }
  if (Number.isFinite(input.nextRunAt) && input.nextRunAt > now) {
    return input.nextRunAt;
  }
  if (Number.isFinite(input.intervalMinutes) && input.intervalMinutes > 0) {
    return now + Math.round(input.intervalMinutes) * 60_000;
  }
  return null;
}

/** @param {any} spec @param {number} now */
export function computeSafeNextRunAt(spec, now) {
  try {
    return computeNextRunAt(spec, now);
  } catch {
    return null;
  }
}

/** @param {any} params */
export function resolveGroupDestination(params) {
  if (params?.groupId && typeof params.groupId === 'string' && params.groupId.trim()) {
    return {
      groupId: params.groupId.trim(),
      threadId: typeof params.threadId === 'string' ? params.threadId.trim() : '',
    };
  }
  if (params?.resultsTo && typeof params.resultsTo === 'object' && params.resultsTo.kind === 'group') {
    const gid = String(params.resultsTo.groupId ?? '').trim();
    if (gid) {
      return {
        groupId: gid,
        threadId: typeof params.resultsTo.threadId === 'string' ? params.resultsTo.threadId.trim() : '',
      };
    }
  }
  return null;
}

/** @param {unknown} intervalMinutes */
export function validateIntervalMinutes(intervalMinutes) {
  if (intervalMinutes === undefined || intervalMinutes === null) return;
  if (typeof intervalMinutes !== 'number' || !Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    throw invalidArg('intervalMinutes must be a positive number');
  }
}

/** @param {any} params @param {string} botId @param {number} now */
export function normalizeAutomationCreate(params, botId, now) {
  const p = params ?? {};
  const prompt = String(p.prompt ?? '').trim();
  if (!prompt) throw invalidArg('Automation prompt is required');
  const rawSchedule = p.schedule ?? p.rrule;
  const schedule = typeof rawSchedule === 'string' ? rawSchedule.trim() || null : null;
  const timezone = validateTimezone(p.timezone);
  if (schedule) parseScheduleExpression(schedule);
  validateIntervalMinutes(p.intervalMinutes);

  const enabled = p.enabled !== false;
  const groupDest = resolveGroupDestination(p);
  const spec = {
    id: p.id || crypto.randomUUID(),
    botId,
    name: String(p.name ?? '').trim() || (p.once ? 'One-shot wait' : 'Scheduled task'),
    prompt,
    schedule,
    intervalMinutes: p.intervalMinutes ?? null,
    timezone,
    triggers: Array.isArray(p.triggers) ? p.triggers : [],
    once: p.once ?? null,
    runsIn: p.runsIn === 'new' ? 'new' : 'chat',
    resultsTo: p.resultsTo ?? 'chat',
    ...(groupDest ? { groupId: groupDest.groupId, threadId: groupDest.threadId } : {}),
    enabled,
    createdAt: now,
  };
  const nextRunAt = enabled
    ? (Number.isFinite(p.nextRunAt) ? p.nextRunAt : computeNextRunAt(spec, now))
    : null;
  return { ...spec, nextRunAt };
}

/** @param {any} turn */
export function isSharedTurnMerged(turn) {
  if (!turn || typeof turn !== 'object') return false;
  return (
    turn.merged === true
    || turn.answeredInTurn === true
    || turn.reason === 'merged'
    || turn.reason === 'answered_in_shared_turn'
  );
}

/** @param {any} turn */
export function isSharedTurnCompleted(turn) {
  if (!turn || typeof turn !== 'object') return false;
  return turn.ok === true || isSharedTurnMerged(turn);
}

/** @param {any} auto */
export function shouldAutoDeleteOnce(auto) {
  return Boolean(auto?.once) && (auto.once.deleteAfterRun === true || auto.once.autoDelete === true);
}
