// Work Items domain: 5 statuses, field limits, Ask structured questions validation,
// Snooze presets/slots, Stale clock (with 3x planned factor), and link helpers.

export const BOT_ITEM_STATUSES = Object.freeze(['planned', 'working', 'needs_you', 'done', 'canceled']);
export const BOT_ITEM_OPEN_STATUSES = Object.freeze(['planned', 'working', 'needs_you']);

export const BOT_ITEM_ERROR_CODES = Object.freeze([
  'not_found',
  'item_closed',
  'not_owner',
  'items_read_only',
  'items_unavailable',
  'item_changed',
  'question_closed',
]);

export const BOT_ITEM_WRITE_METHOD_NAMES = Object.freeze([
  'bots.items.add',
  'bots.items.set',
  'bots.items.comment',
  'bots.items.done',
  'bots.items.cancel',
  'bots.items.link',
]);

export const BOT_ITEM_LIMITS = Object.freeze({
  title: 200,
  description: 20_000,
  doneMeans: 2_000,
  text: 8_000,
  links: 50,
  listPage: 50,
  listPageMax: 100,
  eventsPage: 50,
});

export const BOT_ITEM_LINK_KINDS = Object.freeze(['dispatch', 'pr', 'url', 'file']);

export const BOT_ITEM_EVENT_KINDS = Object.freeze([
  'made',
  'edited',
  'status',
  'commented',
  'linked',
  'snoozed',
  'unsnoozed',
]);

export const BOT_ITEM_COMMENT_FILE_MAX_COUNT = 10;

export const BOT_ITEM_STALE_DAY_CHOICES = Object.freeze([3, 5, 7, 14]);
export const BOT_ITEM_DEFAULT_STALE_DAYS = 5;
export const BOT_ITEM_PLANNED_STALE_FACTOR = 3;

export const BOT_ITEM_ASK_LIMITS = Object.freeze({
  questions: 5,
  options: 8,
  prompt: 500,
  label: 150,
  detail: 500,
});

export const BOT_ITEM_SNOOZE_MAX_MS = 366 * 24 * 60 * 60_000;
export const BOT_ITEM_SNOOZE_SLOT_MINUTES = 15;
export const BOT_ITEM_SNOOZE_DEFAULT_MINUTES = 9 * 60;

const DAY_MS = 24 * 60 * 60_000;
const MORNING_HOUR = 9;
const EVENING_HOUR = 18;
const LATER_CUTOFF_HOUR = 17;
const LATER_HOURS = 3;

export function isValidBotItemStatus(status) {
  return typeof status === 'string' && BOT_ITEM_STATUSES.includes(status);
}

export function isOpenBotItemStatus(status) {
  return typeof status === 'string' && BOT_ITEM_OPEN_STATUSES.includes(status);
}

export function isLiveBotItemWorker(state) {
  return state === 'working' || state === 'unknown';
}

export function isBotItemLive(item) {
  return (item?.links ?? []).some((link) => link.kind === 'dispatch' && isLiveBotItemWorker(link.state));
}

export function botItemLinksOnePerChain(links) {
  const chains = new Set();
  return (links ?? []).filter((link) => {
    if (link.kind !== 'dispatch') {
      return true;
    }
    const chain = link.latest ?? link.ref;
    if (chains.has(chain)) {
      return false;
    }
    chains.add(chain);
    return true;
  });
}

/** Validates Work Item title, description, doneMeans, status, and link list. */
export function validateBotItemFields(fields, { partial = false } = {}) {
  if (!fields || typeof fields !== 'object') {
    return { ok: false, code: 'invalid', reason: 'Item fields object is required.' };
  }
  const titleError = validateTitleField(fields.title, partial);
  if (titleError) {
    return titleError;
  }
  if (fields.description !== undefined && fields.description !== null) {
    if (typeof fields.description !== 'string' || fields.description.length > BOT_ITEM_LIMITS.description) {
      return { ok: false, code: 'description_too_long', reason: `Description must be at most ${BOT_ITEM_LIMITS.description} characters.` };
    }
  }
  if (fields.doneMeans !== undefined && fields.doneMeans !== null) {
    if (typeof fields.doneMeans !== 'string' || fields.doneMeans.length > BOT_ITEM_LIMITS.doneMeans) {
      return { ok: false, code: 'done_means_too_long', reason: `Done means must be at most ${BOT_ITEM_LIMITS.doneMeans} characters.` };
    }
  }
  if (fields.status !== undefined && !isValidBotItemStatus(fields.status)) {
    return { ok: false, code: 'invalid_status', reason: 'Invalid item status.' };
  }
  if (fields.links !== undefined) {
    const linksError = validateBotItemLinks(fields.links);
    if (!linksError.ok) {
      return linksError;
    }
  }
  return { ok: true };
}

function validateTitleField(title, partial) {
  if (title === undefined) {
    return partial ? null : { ok: false, code: 'missing_title', reason: 'Title is required.' };
  }
  if (typeof title !== 'string' || title.trim().length === 0) {
    return { ok: false, code: 'missing_title', reason: 'Title is required.' };
  }
  if (title.trim().length > BOT_ITEM_LIMITS.title) {
    return { ok: false, code: 'title_too_long', reason: `Title must be at most ${BOT_ITEM_LIMITS.title} characters.` };
  }
  return null;
}

export function validateBotItemLink(link) {
  if (!link || typeof link !== 'object') {
    return { ok: false, code: 'invalid_link', reason: 'Link object is required.' };
  }
  if (!BOT_ITEM_LINK_KINDS.includes(link.kind)) {
    return { ok: false, code: 'invalid_link_kind', reason: `Link kind must be one of ${BOT_ITEM_LINK_KINDS.join(', ')}.` };
  }
  if (typeof link.ref !== 'string' || link.ref.trim().length === 0) {
    return { ok: false, code: 'invalid_link_ref', reason: 'Link ref is required.' };
  }
  return { ok: true, link: { kind: link.kind, ref: link.ref.trim() } };
}

export function validateBotItemLinks(links) {
  if (!Array.isArray(links)) {
    return { ok: false, code: 'invalid_links', reason: 'Links must be an array.' };
  }
  if (links.length > BOT_ITEM_LIMITS.links) {
    return { ok: false, code: 'too_many_links', reason: `An item can hold at most ${BOT_ITEM_LIMITS.links} links.` };
  }
  for (const link of links) {
    const checked = validateBotItemLink(link);
    if (!checked.ok) {
      return checked;
    }
  }
  return { ok: true };
}

// ---- Ask structured questions validation & formatting ----

function validateSingleOption(option) {
  if (!option || typeof option !== 'object') {
    return { ok: false, reason: 'An option must be an object.' };
  }
  const label = typeof option.label === 'string' ? option.label.trim() : '';
  if (!label || label.length > BOT_ITEM_ASK_LIMITS.label) {
    return { ok: false, reason: `An option label must be 1..${BOT_ITEM_ASK_LIMITS.label} characters.` };
  }
  const detail = option.detail === undefined ? undefined : String(option.detail).trim();
  if (detail !== undefined && detail.length > BOT_ITEM_ASK_LIMITS.detail) {
    return { ok: false, reason: `An option detail must be at most ${BOT_ITEM_ASK_LIMITS.detail} characters.` };
  }
  return { ok: true, option: { label, ...(detail ? { detail } : {}) } };
}

function validateSingleQuestion(question) {
  if (!question || typeof question !== 'object') {
    return { ok: false, reason: 'A decision must be an object.' };
  }
  const prompt = typeof question.prompt === 'string' ? question.prompt.trim() : '';
  if (!prompt || prompt.length > BOT_ITEM_ASK_LIMITS.prompt) {
    return { ok: false, reason: `A decision question must be 1..${BOT_ITEM_ASK_LIMITS.prompt} characters.` };
  }
  if (!Array.isArray(question.options) || question.options.length > BOT_ITEM_ASK_LIMITS.options) {
    return { ok: false, reason: `A decision takes up to ${BOT_ITEM_ASK_LIMITS.options} options.` };
  }
  const options = [];
  const labels = new Set();
  for (const rawOption of question.options) {
    const checked = validateSingleOption(rawOption);
    if (!checked.ok) {
      return checked;
    }
    if (labels.has(checked.option.label)) {
      return { ok: false, reason: 'Each option of a decision needs its own label.' };
    }
    labels.add(checked.option.label);
    options.push(checked.option);
  }
  if (question.recommended !== undefined) {
    if (
      !Number.isInteger(question.recommended)
      || question.recommended < 0
      || question.recommended >= options.length
    ) {
      return { ok: false, reason: 'The recommended option is not one of its options.' };
    }
  }
  return {
    ok: true,
    question: {
      prompt,
      options,
      ...(question.recommended !== undefined ? { recommended: question.recommended } : {}),
      ...(typeof question.multi === 'boolean' ? { multi: question.multi } : {}),
    },
  };
}

/** Validates a Needs you Ask payload (1..5 unique questions, <=8 unique options each, recommended, multi). */
export function validateBotItemAsk(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Ask payload must be an object.' };
  }
  let context;
  if (raw.context !== undefined) {
    if (typeof raw.context !== 'string' || raw.context.trim().length > BOT_ITEM_LIMITS.text) {
      return { ok: false, reason: `Ask context must be at most ${BOT_ITEM_LIMITS.text} characters.` };
    }
    context = raw.context.trim();
  }
  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > BOT_ITEM_ASK_LIMITS.questions) {
    return { ok: false, reason: `An ask takes 1 to ${BOT_ITEM_ASK_LIMITS.questions} decisions.` };
  }
  const questions = [];
  const prompts = new Set();
  for (const rawQuestion of raw.questions) {
    const checked = validateSingleQuestion(rawQuestion);
    if (!checked.ok) {
      return checked;
    }
    if (prompts.has(checked.question.prompt)) {
      return { ok: false, reason: 'Each decision needs its own question.' };
    }
    prompts.add(checked.question.prompt);
    questions.push(checked.question);
  }
  return {
    ok: true,
    data: {
      ...(context ? { context } : {}),
      questions,
    },
  };
}

export function botItemAskOf(data) {
  const checked = validateBotItemAsk(data?.ask);
  return checked.ok ? checked.data : null;
}

export function botItemQuestionLine(text) {
  const first = String(text ?? '').split('\n').find((line) => line.trim().length > 0) ?? '';
  return first
    .trim()
    .replace(/^(#{1,6}|>|[-*+]|\d+[.)])\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

export function botItemAskText(ask) {
  const decisions = ask.questions.map((question, index) => {
    const head = ask.questions.length > 1 ? `${index + 1}. ${question.prompt}` : question.prompt;
    const options = question.options.map((option, at) => {
      const recommended = question.recommended === at ? ' (recommended)' : '';
      const detail = option.detail ? `: ${option.detail}` : '';
      return `   - ${option.label}${recommended}${detail}`;
    });
    return [head, ...options].join('\n');
  });
  return [ask.context?.trim(), ...decisions].filter(Boolean).join('\n\n');
}

export function botItemQuestionShape(data) {
  const ask = botItemAskOf(data);
  if (!ask) {
    return { body: typeof data?.text === 'string' ? data.text : '', decisions: [] };
  }
  return {
    body: ask.context ?? '',
    decisions: ask.questions.map((question) => ({
      question: question.prompt,
      multi: question.multi === true,
      replies: question.options.map((option, index) => ({
        label: option.label,
        ...(option.detail ? { detail: option.detail } : {}),
        recommended: question.recommended === index,
      })),
    })),
  };
}

export function botItemQuickReplyText(shape, decision, reply) {
  return shape.decisions.length > 1
    ? `${botItemQuestionLine(decision.question)} → ${reply.label}`
    : reply.label;
}

export function botItemPickedReplies(shape, reply) {
  const text = typeof reply?.text === 'string' ? reply.text.trim() : '';
  const recorded = Array.isArray(reply?.decisions) ? reply.decisions : null;
  const lines = shape.decisions.length > 1 ? text.split('\n').map((line) => line.trim()) : [text];
  return shape.decisions.map((decision, index) => {
    const picks = recorded?.[index]?.picks;
    if (Array.isArray(picks)) {
      return decision.replies.filter((_, at) => picks.includes(at));
    }
    return decision.replies.filter((option) => lines.includes(botItemQuickReplyText(shape, decision, option)));
  });
}

export function botItemQuestionView(eventId, data) {
  const shape = botItemQuestionShape(data);
  return {
    eventId,
    text: typeof data?.text === 'string' ? data.text : '',
    gist: botItemQuestionLine(shape.body),
    ...(shape.decisions.length > 0 ? { decisions: shape.decisions } : {}),
  };
}

// ---- Formatting & PR/Event refs ----

export function botItemCommentImages(data) {
  if (!Array.isArray(data?.images)) {
    return [];
  }
  return data.images.flatMap((image) => (
    image && typeof image === 'object'
    && typeof image.path === 'string'
    && typeof image.name === 'string'
    && typeof image.bytes === 'number'
      ? [{ path: image.path, name: image.name, bytes: image.bytes }]
      : []
  ));
}

export function formatBotItemNumber(number) {
  return `#${number}`;
}

export function botItemEventId(id) {
  return `e${id}`;
}

export function parseBotItemEventId(value) {
  const match = /^e?(\d+)$/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) : null;
}

export function parseBotItemPrRef(value) {
  const match = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(String(value ?? '').trim());
  return match ? { repo: match[1], number: Number(match[2]) } : null;
}

export function botItemPrUrl(ref) {
  const parsed = parseBotItemPrRef(ref);
  return parsed ? `https://github.com/${parsed.repo}/pull/${parsed.number}` : null;
}

export function botItemPrRefOfUrl(url) {
  const match = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(String(url ?? '').trim());
  return match ? `${match[1]}#${match[2]}` : null;
}

// ---- Snooze presets & slots ----

function atLocalHour(day, hour) {
  const time = new Date(day);
  time.setHours(hour, 0, 0, 0);
  return time.getTime();
}

export function botItemSnoozePresets(now = Date.now()) {
  const today = new Date(now);
  const later = today.getHours() < LATER_CUTOFF_HOUR
    ? { id: 'later', at: atLocalHour(today, EVENING_HOUR) }
    : {
      id: 'later',
      at: atLocalHour(today, today.getHours() + LATER_HOURS + (today.getMinutes() > 0 ? 1 : 0)),
      inHours: LATER_HOURS,
    };
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const monday = new Date(today);
  monday.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
  return [
    later,
    { id: 'tomorrow', at: atLocalHour(tomorrow, MORNING_HOUR) },
    { id: 'monday', at: atLocalHour(monday, MORNING_HOUR) },
  ];
}

export function botItemSnoozePickerPresets(now = Date.now()) {
  const week = new Date(now);
  week.setDate(week.getDate() + 7);
  const inAWeek = atLocalHour(week, MORNING_HOUR);
  return [
    ...botItemSnoozePresets(now).filter((preset) => preset.at !== inAWeek),
    { id: 'week', at: inAWeek },
  ];
}

export function botItemSnoozeAt(day, minutes) {
  const d = day instanceof Date ? day : new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes).getTime();
}

export function botItemSnoozeSlots(day, now = Date.now()) {
  const slots = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += BOT_ITEM_SNOOZE_SLOT_MINUTES) {
    const until = botItemSnoozeAt(day, minutes);
    const wall = new Date(until);
    if (
      until > now
      && until <= now + BOT_ITEM_SNOOZE_MAX_MS
      && wall.getHours() * 60 + wall.getMinutes() === minutes
    ) {
      slots.push(minutes);
    }
  }
  return slots;
}

export function botItemSnoozeSlotOn(day, minutes, now = Date.now()) {
  const slots = botItemSnoozeSlots(day, now);
  return slots.find((slot) => slot >= minutes) ?? slots.at(-1) ?? null;
}

export function botItemSnoozeDayRange(now = Date.now()) {
  const first = new Date(now);
  first.setHours(0, 0, 0, 0);
  if (botItemSnoozeSlots(first, now).length === 0) {
    first.setDate(first.getDate() + 1);
  }
  const last = new Date(now + BOT_ITEM_SNOOZE_MAX_MS);
  last.setHours(0, 0, 0, 0);
  return { first, last };
}

export function botItemSnoozeTimeFormat(until, now = Date.now()) {
  const time = { hour: 'numeric', minute: '2-digit' };
  const day = new Date(until);
  const today = new Date(now);
  if (day.toDateString() === today.toDateString()) {
    return time;
  }
  return until - now < 6 * DAY_MS
    ? { weekday: 'short', ...time }
    : { month: 'short', day: 'numeric', ...time };
}

export function botItemSnoozePresetName(preset, t) {
  switch (preset.id) {
    case 'later':
      return preset.inHours
        ? t('bots.items.snooze.inHours', 'In {{count}} hours', { count: preset.inHours })
        : t('bots.items.snooze.later', 'Later today');
    case 'tomorrow':
      return t('bots.items.snooze.tomorrow', 'Tomorrow');
    case 'monday':
      return t('bots.items.snooze.monday', 'Monday');
    case 'week':
      return t('bots.items.snooze.week', 'In a week');
    default:
      return '';
  }
}

// ---- Stale & snoozed state derivation ----

export function botItemNeedsYouStaleAt(activityAt, staleDays = BOT_ITEM_DEFAULT_STALE_DAYS) {
  return activityAt + staleDays * DAY_MS;
}

export function isBotItemSnoozed(item, now = Date.now()) {
  return isOpenBotItemStatus(item?.status) && item.snoozedUntil !== null && item.snoozedUntil > now;
}

export function botItemActivityAt(item, now = Date.now()) {
  return item.snoozedUntil !== null && item.snoozedUntil <= now
    ? Math.max(item.lastActivityAt, item.snoozedUntil)
    : item.lastActivityAt;
}

/**
 * Computes whether an item is stale:
 * - `staleDays === null` or `'never'` or snoozed or closed -> false
 * - `needs_you` -> idle >= `staleDays` days
 * - `working` -> idle >= `staleDays` days and no live linked worker dispatch
 * - `planned` -> idle >= `staleDays * 3` days
 */
export function isBotItemStale(item, staleDays = BOT_ITEM_DEFAULT_STALE_DAYS, now = Date.now()) {
  if (staleDays === null || staleDays === 'never' || isBotItemSnoozed(item, now)) {
    return false;
  }
  const idle = now - botItemActivityAt(item, now);
  if (item.status === 'needs_you') {
    return idle >= staleDays * DAY_MS;
  }
  if (item.status === 'working') {
    return idle >= staleDays * DAY_MS && !isBotItemLive(item);
  }
  if (item.status === 'planned') {
    return idle >= staleDays * BOT_ITEM_PLANNED_STALE_FACTOR * DAY_MS;
  }
  return false;
}
