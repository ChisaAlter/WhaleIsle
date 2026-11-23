/**
 * Lightweight zero-dependency 5-field Cron + RRule + timezone next-run calculator.
 *
 * Supported formats:
 * - Standard 5-field Cron: `minute hour dayOfMonth month dayOfWeek`
 *   - Supports wildcards, step syntax (every N), ranges `a-b`, `a-b/step`, comma lists,
 *     month/weekday names, and standard macros (`@hourly`, `@daily`, `@midnight`, `@weekly`, `@monthly`, `@yearly`).
 * - RRule (optional `RRULE:` prefix):
 *   - `FREQ=MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY`
 *   - `INTERVAL=<int>` (default 1)
 *   - `BYDAY=MO,TU,WE,TH,FR,SA,SU`
 *   - `BYHOUR=0..23` (comma-separated)
 *   - `BYMINUTE=0..59` (comma-separated)
 *   - `UNTIL=<ISO or YYYYMMDDTHHMMSSZ>`
 */

const MINUTE_MS = 60_000;
const MAX_SEARCH_YEARS = 5;
const MAX_STEP_ITERATIONS = 60_000;

/** @type {Readonly<Record<string, string>>} */
const CRON_MACROS = Object.freeze({
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
});

/** @type {Readonly<Record<string, number>>} */
const MONTH_NAMES = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
});

/** @type {Readonly<Record<string, number>>} */
const DOW_NAMES = Object.freeze({
  sun: 0, su: 0,
  mon: 1, mo: 1,
  tue: 2, tu: 2,
  wed: 3, we: 3,
  thu: 4, th: 4,
  fri: 5, fr: 5,
  sat: 6, sa: 6,
});

const VALID_RRULE_FREQS = new Set(['MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']);

/** @type {Map<string, Intl.DateTimeFormat>} */
const dtfCache = new Map();

/** @param {string | null | undefined} timezone */
function resolveTimeZone(timezone) {
  const tz = typeof timezone === 'string' ? timezone.trim() : '';
  if (!tz) return 'UTC';
  if (!dtfCache.has(tz)) {
    // Validates the IANA timezone name via Intl.
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    dtfCache.set(tz, fmt);
  }
  return tz;
}

/**
 * Extract calendar parts for `epochMs` in `timezone`.
 * @param {number} epochMs
 * @param {string} timezone
 */
function getZonedParts(epochMs, timezone) {
  const tz = resolveTimeZone(timezone);
  if (tz === 'UTC') {
    const d = new Date(epochMs);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      dow: d.getUTCDay(),
    };
  }
  const fmt = dtfCache.get(tz);
  if (!fmt) {
    throw new Error(`Timezone formatter missing for ${tz}`);
  }
  const parts = fmt.formatToParts(new Date(epochMs));
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let dow = 0;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'weekday') dow = DOW_NAMES[part.value.toLowerCase().slice(0, 3)] ?? 0;
  }
  return { year, month, day, hour, minute, dow };
}

/** @param {string} token @param {Record<string, number> | null} names */
function parseFieldAtom(token, names) {
  const clean = token.trim().toLowerCase();
  if (names && Object.prototype.hasOwnProperty.call(names, clean)) {
    return names[clean];
  }
  if (!/^\d+$/u.test(clean)) return NaN;
  return Number(clean);
}

/** @param {string} rangePart @param {string | undefined} stepPart @param {number} min @param {number} max @param {any} opts */
function resolveCronRange(rangePart, stepPart, min, max, opts) {
  if (rangePart === '*') return { start: min, end: max };
  const names = opts.names ?? null;
  const dashIdx = rangePart.indexOf('-');
  if (dashIdx !== -1) {
    return {
      start: parseFieldAtom(rangePart.slice(0, dashIdx), names),
      end: parseFieldAtom(rangePart.slice(dashIdx + 1), names),
    };
  }
  const atom = parseFieldAtom(rangePart, names);
  return { start: atom, end: stepPart === undefined ? atom : max };
}

/**
 * Parse one Cron field into a sorted Set of allowed integers.
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @param {{ names?: Record<string, number> | null, wrapSevenToZero?: boolean }} [opts]
 */
function parseCronField(field, min, max, opts = {}) {
  const raw = String(field ?? '').trim();
  if (!raw) throw new Error('Empty cron field');
  const maxBound = opts.wrapSevenToZero ? 7 : max;
  /** @type {Set<number>} */
  const values = new Set();

  for (const segment of raw.split(',')) {
    const part = segment.trim();
    if (!part) throw new Error(`Invalid cron segment in "${raw}"`);
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined) throw new Error(`Invalid cron step in "${part}"`);
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step "${stepPart}" in "${part}"`);
    }
    const { start, end } = resolveCronRange(rangePart, stepPart, min, max, opts);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > maxBound || start > end) {
      throw new Error(`Cron value out of range [${min}..${max}] in "${part}"`);
    }
    for (let v = start; v <= end; v += step) {
      values.add(opts.wrapSevenToZero && v === 7 ? 0 : v);
    }
  }
  return { values, isWildcard: raw === '*' };
}

/**
 * Parse a standard 5-field Cron string (or macro like `@daily`).
 * @param {string} expr
 */
export function parseCronExpression(expr) {
  const trimmed = String(expr ?? '').trim();
  if (!trimmed) throw new Error('Cron expression cannot be empty');
  const expanded = CRON_MACROS[trimmed.toLowerCase()] ?? trimmed;
  const fields = expanded.split(/\s+/u);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${fields.length}: "${trimmed}"`);
  }
  const minute = parseCronField(fields[0], 0, 59);
  const hour = parseCronField(fields[1], 0, 23);
  const dom = parseCronField(fields[2], 1, 31);
  const month = parseCronField(fields[3], 1, 12, { names: MONTH_NAMES });
  const dow = parseCronField(fields[4], 0, 6, { names: DOW_NAMES, wrapSevenToZero: true });
  return {
    kind: 'cron',
    raw: trimmed,
    minute: minute.values,
    hour: hour.values,
    dom: dom.values,
    month: month.values,
    dow: dow.values,
    domWildcard: dom.isWildcard,
    dowWildcard: dow.isWildcard,
  };
}

/** @param {string} raw @param {number} min @param {number} max */
function parseIntList(raw, min, max) {
  /** @type {Set<number>} */
  const set = new Set();
  for (const item of String(raw ?? '').split(',')) {
    const n = Number(item.trim());
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`RRule integer out of range [${min}..${max}]: "${item}"`);
    }
    set.add(n);
  }
  return set;
}

/** @param {string} raw */
function parseRRuleByDay(raw) {
  /** @type {Set<number>} */
  const set = new Set();
  for (const item of String(raw ?? '').split(',')) {
    const clean = item.trim().replace(/^[+-]?\d+/u, '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(DOW_NAMES, clean)) {
      throw new Error(`Invalid RRule BYDAY token: "${item}"`);
    }
    set.add(DOW_NAMES[clean]);
  }
  return set;
}

/** @param {string} raw */
function parseRRuleUntil(raw) {
  const clean = String(raw ?? '').trim();
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(clean);
  if (compact) {
    return Date.UTC(
      Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]),
      Number(compact[4]), Number(compact[5]), Number(compact[6]),
    );
  }
  const parsed = Date.parse(clean);
  if (Number.isNaN(parsed)) throw new Error(`Invalid RRule UNTIL value: "${clean}"`);
  return parsed;
}

/**
 * Parse an RRule expression (`FREQ=...;INTERVAL=...;BYDAY=...;BYHOUR=...;BYMINUTE=...`).
 * @param {string} expr
 */
export function parseRRuleExpression(expr) {
  const trimmed = String(expr ?? '').trim();
  const body = trimmed.replace(/^RRULE:/iu, '').trim();
  if (!body) throw new Error('RRule expression cannot be empty');

  /** @type {Record<string, string>} */
  const kv = {};
  for (const part of body.split(';')) {
    const clean = part.trim();
    if (!clean) continue;
    const eq = clean.indexOf('=');
    if (eq <= 0) throw new Error(`Invalid RRule segment: "${clean}"`);
    kv[clean.slice(0, eq).trim().toUpperCase()] = clean.slice(eq + 1).trim();
  }
  const freq = String(kv.FREQ ?? '').toUpperCase();
  if (!VALID_RRULE_FREQS.has(freq)) {
    throw new Error(`Unsupported RRule FREQ: "${kv.FREQ ?? ''}"`);
  }
  const interval = kv.INTERVAL !== undefined ? Number(kv.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error(`Invalid RRule INTERVAL: "${kv.INTERVAL}"`);
  }
  return {
    kind: 'rrule',
    raw: trimmed,
    freq,
    interval,
    byDay: kv.BYDAY ? parseRRuleByDay(kv.BYDAY) : null,
    byHour: kv.BYHOUR ? parseIntList(kv.BYHOUR, 0, 23) : null,
    byMinute: kv.BYMINUTE ? parseIntList(kv.BYMINUTE, 0, 59) : null,
    untilMs: kv.UNTIL ? parseRRuleUntil(kv.UNTIL) : null,
  };
}

/**
 * Auto-detect and parse either an RRule or 5-field Cron schedule string.
 * @param {string} expr
 */
export function parseScheduleExpression(expr) {
  const trimmed = String(expr ?? '').trim();
  if (!trimmed) throw new Error('Schedule expression cannot be empty');
  if (/^RRULE:/iu.test(trimmed) || /(?:^|;)FREQ=/iu.test(trimmed)) {
    return parseRRuleExpression(trimmed);
  }
  return parseCronExpression(trimmed);
}

/** @param {any} cron @param {ReturnType<typeof getZonedParts>} parts */
function matchesCron(cron, parts) {
  if (!cron.month.has(parts.month)) return false;
  if (!cron.hour.has(parts.hour)) return false;
  if (!cron.minute.has(parts.minute)) return false;
  const domMatch = cron.dom.has(parts.day);
  const dowMatch = cron.dow.has(parts.dow);
  if (!cron.domWildcard && !cron.dowWildcard) return domMatch || dowMatch;
  if (!cron.domWildcard) return domMatch;
  if (!cron.dowWildcard) return dowMatch;
  return true;
}

/** @param {ReturnType<typeof getZonedParts>} parts */
function calendarDayNumber(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

/** @param {ReturnType<typeof getZonedParts>} a @param {ReturnType<typeof getZonedParts>} b */
function weekDiffFromSunday(a, b) {
  const dayA = calendarDayNumber(a) - a.dow;
  const dayB = calendarDayNumber(b) - b.dow;
  return Math.floor((dayA - dayB) / 7);
}

/** @param {any} rule @param {ReturnType<typeof getZonedParts>} parts @param {ReturnType<typeof getZonedParts>} anchor @param {number} candidateMs @param {number} anchorMs */
function matchesRRuleInterval(rule, parts, anchor, candidateMs, anchorMs) {
  if (rule.interval <= 1) return true;
  if (rule.freq === 'MINUTELY') {
    const diffMin = Math.floor((candidateMs - anchorMs) / MINUTE_MS);
    return diffMin >= 0 && diffMin % rule.interval === 0;
  }
  if (rule.freq === 'HOURLY') {
    const diffHr = Math.floor((candidateMs - anchorMs) / 3_600_000);
    return diffHr >= 0 && diffHr % rule.interval === 0;
  }
  if (rule.freq === 'DAILY') {
    const diffDays = calendarDayNumber(parts) - calendarDayNumber(anchor);
    return diffDays >= 0 && diffDays % rule.interval === 0;
  }
  if (rule.freq === 'WEEKLY') {
    const diffWeeks = weekDiffFromSunday(parts, anchor);
    return diffWeeks >= 0 && diffWeeks % rule.interval === 0;
  }
  if (rule.freq === 'MONTHLY') {
    const diffMonths = (parts.year - anchor.year) * 12 + (parts.month - anchor.month);
    return diffMonths >= 0 && diffMonths % rule.interval === 0;
  }
  return true;
}

/** @param {any} rule @param {ReturnType<typeof getZonedParts>} parts @param {ReturnType<typeof getZonedParts>} anchor */
function matchesRRuleDefaults(rule, parts, anchor) {
  if (!rule.byMinute && rule.freq !== 'MINUTELY' && parts.minute !== anchor.minute) return false;
  const needsHourAnchor = rule.freq === 'DAILY' || rule.freq === 'WEEKLY' || rule.freq === 'MONTHLY';
  if (!rule.byHour && needsHourAnchor && parts.hour !== anchor.hour) return false;
  if (!rule.byDay && rule.freq === 'WEEKLY' && parts.dow !== anchor.dow) return false;
  if (!rule.byDay && rule.freq === 'MONTHLY' && parts.day !== anchor.day) return false;
  return true;
}

/** @param {any} rule @param {ReturnType<typeof getZonedParts>} parts @param {ReturnType<typeof getZonedParts>} anchor @param {number} candidateMs @param {number} anchorMs */
function matchesRRule(rule, parts, anchor, candidateMs, anchorMs) {
  if (rule.byDay && !rule.byDay.has(parts.dow)) return false;
  if (rule.byHour && !rule.byHour.has(parts.hour)) return false;
  if (rule.byMinute && !rule.byMinute.has(parts.minute)) return false;
  if (!matchesRRuleDefaults(rule, parts, anchor)) return false;
  return matchesRRuleInterval(rule, parts, anchor, candidateMs, anchorMs);
}

/** @param {any} parsed @param {ReturnType<typeof getZonedParts>} parts */
function computeSkipMinutes(parsed, parts) {
  if (parsed.kind === 'cron') {
    if (!parsed.month.has(parts.month)) return Math.max(60, (24 - parts.hour) * 60 - parts.minute);
    const dayAllowed = (!parsed.domWildcard && !parsed.dowWildcard)
      ? (parsed.dom.has(parts.day) || parsed.dow.has(parts.dow))
      : ((!parsed.domWildcard ? parsed.dom.has(parts.day) : true) && (!parsed.dowWildcard ? parsed.dow.has(parts.dow) : true));
    if (!dayAllowed) return Math.max(60, (24 - parts.hour) * 60 - parts.minute);
    if (!parsed.hour.has(parts.hour)) return Math.max(1, 60 - parts.minute);
    return 1;
  }
  if (parsed.byDay && !parsed.byDay.has(parts.dow)) {
    return Math.max(60, (24 - parts.hour) * 60 - parts.minute);
  }
  if (parsed.byHour && !parsed.byHour.has(parts.hour)) {
    return Math.max(1, 60 - parts.minute);
  }
  return 1;
}

/**
 * Compute the next trigger epoch ms strictly after `afterMs` for a Cron or RRule schedule.
 * @param {string | ReturnType<typeof parseScheduleExpression>} schedule
 * @param {{ afterMs?: number, timezone?: string | null, anchorMs?: number }} [options]
 * @returns {number | null}
 */
export function computeNextScheduleAt(schedule, options = {}) {
  /** @type {any} */
  const parsed = typeof schedule === 'string' ? parseScheduleExpression(schedule) : schedule;
  if (!parsed) return null;
  const afterMs = typeof options.afterMs === 'number' && Number.isFinite(options.afterMs) ? options.afterMs : Date.now();
  const timezone = resolveTimeZone(options.timezone);
  const anchorBase = typeof options.anchorMs === 'number' && Number.isFinite(options.anchorMs) ? options.anchorMs : afterMs;
  const anchorMs = Math.floor(anchorBase / MINUTE_MS) * MINUTE_MS;
  const anchorParts = getZonedParts(anchorMs, timezone);

  let cursorMs = (Math.floor(afterMs / MINUTE_MS) + 1) * MINUTE_MS;
  const maxMs = afterMs + MAX_SEARCH_YEARS * 366 * 86_400_000;
  const untilMs = parsed.kind === 'rrule' && typeof parsed.untilMs === 'number' && Number.isFinite(parsed.untilMs)
    ? parsed.untilMs
    : maxMs;
  const limitMs = Math.min(maxMs, untilMs);

  for (let i = 0; i < MAX_STEP_ITERATIONS && cursorMs <= limitMs; i += 1) {
    const parts = getZonedParts(cursorMs, timezone);
    const matched = parsed.kind === 'cron'
      ? matchesCron(parsed, parts)
      : matchesRRule(parsed, parts, anchorParts, cursorMs, anchorMs);
    if (matched) return cursorMs;

    const skip = computeSkipMinutes(parsed, parts);
    // Use smaller step near potential DST transitions so we never leap past a local midnight/hour.
    const safeSkip = timezone !== 'UTC' && skip > 60 ? 60 : skip;
    cursorMs += safeSkip * MINUTE_MS;
  }
  return null;
}

/**
 * Coalesce missed due slots between `dueAt` and `nowMs` into the single latest due slot,
 * reporting `coalescedCount` and computing the next future run timestamp after `nowMs`.
 * @param {{
 *   schedule?: string | null,
 *   intervalMinutes?: number | null,
 *   timezone?: string | null,
 *   dueAt: number,
 *   nowMs: number,
 *   anchorMs?: number,
 *   once?: any,
 *   maxScan?: number,
 * }} params
 */
export function collectDueScheduleSlots(params) {
  const { dueAt, nowMs, schedule, intervalMinutes, timezone, anchorMs, once, maxScan = 500 } = params;
  if (!Number.isFinite(dueAt) || dueAt > nowMs) {
    return { slotAt: null, coalescedCount: 0, nextRunAt: Number.isFinite(dueAt) ? dueAt : null };
  }
  if (once) {
    return { slotAt: Math.trunc(dueAt), coalescedCount: 1, nextRunAt: null };
  }

  let latestSlot = Math.trunc(dueAt);
  let count = 1;

  if (schedule && typeof schedule === 'string' && schedule.trim()) {
    const parsed = parseScheduleExpression(schedule);
    let next = computeNextScheduleAt(parsed, { afterMs: latestSlot, timezone, anchorMs });
    while (next !== null && next <= nowMs && count < maxScan) {
      latestSlot = next;
      count += 1;
      next = computeNextScheduleAt(parsed, { afterMs: latestSlot, timezone, anchorMs });
    }
    const futureNext = next !== null && next > nowMs
      ? next
      : computeNextScheduleAt(parsed, { afterMs: nowMs, timezone, anchorMs });
    return { slotAt: latestSlot, coalescedCount: count, nextRunAt: futureNext };
  }

  if (typeof intervalMinutes === 'number' && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    const stepMs = Math.round(intervalMinutes) * MINUTE_MS;
    const extra = Math.floor((nowMs - latestSlot) / stepMs);
    if (extra > 0) {
      latestSlot += extra * stepMs;
      count += extra;
    }
    return { slotAt: latestSlot, coalescedCount: count, nextRunAt: latestSlot + stepMs };
  }

  return { slotAt: latestSlot, coalescedCount: 1, nextRunAt: null };
}
