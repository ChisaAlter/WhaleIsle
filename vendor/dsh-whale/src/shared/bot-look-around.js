// Look around: scheduled read-only sweep presets, weekday checks, next-run calculation,
// suggestion normalization, 3/14/30-day deduplication windows, and credential link checks.

import { containsSecretLike } from './bot-memory-lines.js';

export const LOOK_AROUND_AGENTS = Object.freeze(['claude', 'codex', 'deepseek-harness']);

export const LOOK_AROUND_EVERY_CHOICES = Object.freeze([
  'every-4h',
  'every-2h',
  'twice-daily',
  'mornings',
]);

/** Local hours each preset looks at; nothing runs overnight. */
export const LOOK_AROUND_EVERY = Object.freeze({
  'every-4h': Object.freeze([8, 12, 16, 20]),
  'every-2h': Object.freeze([8, 10, 12, 14, 16, 18, 20]),
  'twice-daily': Object.freeze([8, 13]),
  mornings: Object.freeze([8]),
});

export const LOOK_AROUND_EVERY_LABELS = Object.freeze({
  'every-4h': 'Every 4 hours, 8 AM to 8 PM',
  'every-2h': 'Every 2 hours, 8 AM to 8 PM',
  'twice-daily': 'Twice a day, 8 AM and 1 PM',
  mornings: 'Each morning at 8 AM',
});

export const LOOK_AROUND_FOCUS_MAX_LENGTH = 500;

export const LOOK_AROUND_DEFAULTS = Object.freeze({
  on: true,
  every: 'every-4h',
  weekdaysOnly: true,
  focus: '',
});

export const SUGGESTION_LIMITS = Object.freeze({
  title: 80,
  why: 400,
  ask: 2000,
  perRun: 5,
  shown: 3,
  maxStoredSuggestions: 200,
  maxStoredRuns: 50,
});

export const SUGGESTION_SOURCES = Object.freeze(['slack', 'linear', 'github']);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Orca deduplication retention windows for Look around suggestions (3 / 14 / 30 days). */
export const LOOK_AROUND_DEDUPE_WINDOWS_MS = Object.freeze({
  open: 3 * DAY_MS,
  started: 14 * DAY_MS,
  dismissed: 30 * DAY_MS,
});

const CREDENTIAL_PARAM =
  /token|secret|passw|api[_-]?key|access[_-]?key|signature|^sig$|auth|credential|session/i;

export function lookAroundSupported(agent) {
  return typeof agent === 'string' && LOOK_AROUND_AGENTS.includes(agent);
}

export function botLookAround(bot) {
  return bot?.lookAround ?? { ...LOOK_AROUND_DEFAULTS };
}

export function patchLookAround(setting, patch, now = Date.now()) {
  const current = setting ?? LOOK_AROUND_DEFAULTS;
  const on = patch?.on ?? current.on;
  const since = on && !current.on ? now : current.since;
  const every = LOOK_AROUND_EVERY_CHOICES.includes(patch?.every) ? patch.every : current.every;
  const focus = typeof patch?.focus === 'string'
    ? patch.focus.slice(0, LOOK_AROUND_FOCUS_MAX_LENGTH)
    : current.focus;
  return {
    on,
    every,
    weekdaysOnly: patch?.weekdaysOnly ?? current.weekdaysOnly,
    focus,
    ...(since !== undefined ? { since } : {}),
  };
}

export function lookAroundSchedule(setting) {
  const hours = LOOK_AROUND_EVERY[setting?.every] ?? LOOK_AROUND_EVERY['every-4h'];
  return `0 ${hours.join(',')} * * ${setting?.weekdaysOnly ? '1-5' : '*'}`;
}

export function lookAroundIntervalMs(every) {
  const [first, second] = LOOK_AROUND_EVERY[every] ?? LOOK_AROUND_EVERY['every-4h'];
  const gap = first !== undefined && second !== undefined ? second - first : 24;
  return gap * 60 * 60 * 1000;
}

/** True for Monday..Friday in local wall clock time. */
export function isWeekday(timestamp) {
  const day = (timestamp instanceof Date ? timestamp : new Date(timestamp)).getDay();
  return day >= 1 && day <= 5;
}

/**
 * Computes the next scheduled Look around epoch timestamp strictly after `now`,
 * or `null` when Look around is disabled.
 */
export function nextLookAroundAt(setting, now = Date.now()) {
  const cfg = setting ?? LOOK_AROUND_DEFAULTS;
  if (!cfg.on) {
    return null;
  }
  const hours = LOOK_AROUND_EVERY[cfg.every] ?? LOOK_AROUND_EVERY['every-4h'];
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const candidateDay = new Date(base);
    candidateDay.setDate(base.getDate() + dayOffset);
    if (cfg.weekdaysOnly && !isWeekday(candidateDay)) {
      continue;
    }
    for (const hour of hours) {
      const slot = new Date(candidateDay);
      slot.setHours(hour, 0, 0, 0);
      if (slot.getTime() > now) {
        return slot.getTime();
      }
    }
  }
  return null;
}

function startOfLocalDay(timestamp) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function lookedDay(at, now = Date.now()) {
  const day = startOfLocalDay(at);
  const today = startOfLocalDay(now);
  if (day === today) {
    return 'today';
  }
  return day === startOfLocalDay(today - 1) ? 'yesterday' : 'earlier';
}

/**
 * Normalizes a suggestion link for deduplication: lowercase host (no `www.`), no query/hash,
 * and truncated to canonical GitHub PR/issue or Linear issue path.
 */
export function normalizeSuggestionLink(link) {
  if (typeof link !== 'string' || !link.trim()) {
    return null;
  }
  try {
    const url = new URL(link.trim());
    const parts = url.pathname.toLowerCase().split('/').filter(Boolean);
    const github = parts.findIndex((part) => part === 'pull' || part === 'issues');
    const linear = parts.indexOf('issue');
    let kept = parts;
    if (github !== -1 && /^\d+$/.test(parts[github + 1] ?? '')) {
      kept = parts.slice(0, github + 2);
    } else if (linear !== -1 && parts[linear + 1]) {
      kept = parts.slice(0, linear + 2);
    }
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}/${kept.join('/')}`;
  } catch (err) {
    return err instanceof TypeError ? null : null;
  }
}

export function suggestionTitleKey(title) {
  return String(title ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function suggestionKey(suggestion) {
  const normalized = suggestion?.link ? normalizeSuggestionLink(suggestion.link) : null;
  return normalized ? `link:${normalized}` : `title:${suggestionTitleKey(suggestion?.title ?? '')}`;
}

export function suggestionSource(link) {
  if (typeof link !== 'string' || !link.trim()) {
    return undefined;
  }
  try {
    const host = new URL(link.trim()).hostname.toLowerCase();
    if (host === 'slack.com' || host.endsWith('.slack.com')) {
      return 'slack';
    }
    if (host === 'linear.app' || host.endsWith('.linear.app')) {
      return 'linear';
    }
    return host === 'github.com' || host.endsWith('.github.com') ? 'github' : undefined;
  } catch (err) {
    return err instanceof TypeError ? undefined : undefined;
  }
}

export function suggestionLinkLabel(link) {
  try {
    const url = new URL(link);
    const parts = url.pathname.split('/').filter(Boolean);
    const source = suggestionSource(link);
    const isGithubNumber = /^(pull|issues)$/.test(parts[2] ?? '') && /^\d+$/.test(parts[3] ?? '');
    if (source === 'github' && parts[1]) {
      return isGithubNumber ? `${parts[1]}#${parts[3]}` : parts[1];
    }
    const linearIssue = parts.indexOf('issue');
    if (source === 'linear' && linearIssue !== -1 && parts[linearIssue + 1]) {
      return parts[linearIssue + 1];
    }
    return url.hostname.replace(/^www\./, '');
  } catch (err) {
    return err instanceof TypeError ? String(link ?? '') : String(link ?? '');
  }
}

/** True when `link` carries a secret-shaped token, username/password, or credential param. */
export function linkCarriesCredential(link) {
  if (typeof link !== 'string' || !link.trim()) {
    return false;
  }
  if (containsSecretLike(link)) {
    return true;
  }
  try {
    const url = new URL(link);
    const names = [
      ...url.searchParams.keys(),
      ...new URLSearchParams(url.hash.replace(/^#/, '')).keys(),
    ];
    return (
      url.username !== ''
      || url.password !== ''
      || names.some((name) => CREDENTIAL_PARAM.test(name))
    );
  } catch (err) {
    return Boolean(err);
  }
}

/** Validates and normalizes a raw suggestion payload before recording. */
export function normalizeSuggestion(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, code: 'invalid', reason: 'Suggestion object is required.' };
  }
  const title = String(input.title ?? '').replace(/\s+/g, ' ').trim();
  const why = String(input.why ?? '').replace(/\s+/g, ' ').trim();
  const ask = String(input.ask ?? '').trim();
  const link = typeof input.link === 'string' && input.link.trim() ? input.link.trim() : undefined;
  if (!title || title.length > SUGGESTION_LIMITS.title) {
    return { ok: false, code: 'invalid_title', reason: `Title must be 1..${SUGGESTION_LIMITS.title} characters.` };
  }
  if (!why || why.length > SUGGESTION_LIMITS.why) {
    return { ok: false, code: 'invalid_why', reason: `Why must be 1..${SUGGESTION_LIMITS.why} characters.` };
  }
  if (!ask || ask.length > SUGGESTION_LIMITS.ask) {
    return { ok: false, code: 'invalid_ask', reason: `Ask must be 1..${SUGGESTION_LIMITS.ask} characters.` };
  }
  if (containsSecretLike(`${title}\n${why}\n${ask}`) || (link !== undefined && linkCarriesCredential(link))) {
    return { ok: false, code: 'secret', reason: 'The request looks like it contains a credential. Leave secrets out of suggestions.' };
  }
  const source = suggestionSource(link);
  return {
    ok: true,
    suggestion: {
      title,
      why,
      ask,
      ...(link ? { link } : {}),
      ...(source ? { source } : {}),
    },
  };
}

/** Expires open suggestions older than 3d, resolved older than 30d, and dismissals older than 30d. */
export function pruneLookAroundState(state, now = Date.now()) {
  const suggestions = (state?.suggestions ?? [])
    .map((entry) => (
      entry.status === 'open' && now - entry.createdAt > LOOK_AROUND_DEDUPE_WINDOWS_MS.open
        ? { ...entry, status: 'replaced', resolvedAt: now }
        : entry
    ))
    .filter((entry) => (
      entry.status === 'open'
      || now - (entry.resolvedAt ?? entry.createdAt) <= LOOK_AROUND_DEDUPE_WINDOWS_MS.dismissed
    ))
    .slice(-SUGGESTION_LIMITS.maxStoredSuggestions);

  const dismissals = (state?.dismissals ?? []).filter(
    (entry) => now - entry.at <= LOOK_AROUND_DEDUPE_WINDOWS_MS.dismissed,
  );
  return { ...(state ?? { runs: [] }), suggestions, dismissals };
}

/**
 * Checks whether a candidate suggestion should be suppressed due to an active dedupe window:
 * - already open (< 3d) or repeated in the same run
 * - recently started (< 14d)
 * - recently dismissed (< 30d)
 */
export function checkSuggestionDedupe(state, candidate, now = Date.now(), runSessionId = null) {
  const key = suggestionKey(candidate);
  const suggestions = state?.suggestions ?? [];
  const dismissals = state?.dismissals ?? [];

  if (runSessionId) {
    const inRun = suggestions.filter((entry) => entry.runSessionId === runSessionId);
    if (inRun.some((entry) => suggestionKey(entry) === key)) {
      return { duplicate: true, reason: 'repeated' };
    }
    if (inRun.length >= SUGGESTION_LIMITS.perRun) {
      return { duplicate: true, reason: 'full' };
    }
  }
  const dismissalMatch = dismissals.some((entry) => {
    const dKey = entry.key ?? suggestionKey({ title: entry.title });
    return dKey === key && now - entry.at <= LOOK_AROUND_DEDUPE_WINDOWS_MS.dismissed;
  });
  if (dismissalMatch) {
    return { duplicate: true, reason: 'dismissed' };
  }
  const startedMatch = suggestions.some(
    (entry) => entry.status === 'started'
      && suggestionKey(entry) === key
      && now - (entry.resolvedAt ?? entry.createdAt) <= LOOK_AROUND_DEDUPE_WINDOWS_MS.started,
  );
  if (startedMatch) {
    return { duplicate: true, reason: 'started' };
  }
  const openMatch = suggestions.find(
    (entry) => entry.status === 'open'
      && suggestionKey(entry) === key
      && now - entry.createdAt <= LOOK_AROUND_DEDUPE_WINDOWS_MS.open,
  );
  if (openMatch) {
    return { duplicate: true, reason: 'open', existing: openMatch };
  }
  return { duplicate: false, key };
}
