/**
 * Validation, error types, row mappers, and stale calculation helpers for Bot Work Items.
 * Mirrors Orca's `bot-item-schema.js`, `bot-item-ask.js`, and `bots-db-worker-entry.js`.
 */

export const ITEM_STATUSES = Object.freeze(['planned', 'working', 'needs_you', 'done', 'canceled']);
export const OPEN_ITEM_STATUSES = Object.freeze(['planned', 'working', 'needs_you']);
export const CLOSED_ITEM_STATUSES = Object.freeze(['done', 'canceled']);
export const ITEM_LINK_KINDS = Object.freeze(['dispatch', 'pr', 'url', 'file']);
export const CROSS_BOT_ATTACH_LINK_KINDS = Object.freeze(['dispatch', 'pr', 'url']);
export const ITEM_EVENT_KINDS = Object.freeze([
  'made', 'edited', 'status', 'commented', 'linked', 'snoozed', 'unsnoozed',
]);

export const ITEM_ERROR_CODES = Object.freeze([
  'invalid_argument',
  'not_found',
  'item_closed',
  'not_owner',
  'items_read_only',
  'items_unavailable',
  'item_changed',
  'question_closed',
]);

export const ITEM_LIMITS = Object.freeze({
  title: 200,
  description: 20000,
  doneMeans: 2000,
  text: 8000,
  note: 8000,
  links: 50,
  listPage: 50,
  listPageMax: 100,
  eventsPage: 50,
  maxQuestions: 5,
  maxOptions: 8,
  questionPrompt: 500,
  optionLabel: 150,
  optionDetail: 500,
  maxSnoozeMs: 316224e5, // 366 days
  defaultStaleDays: 5,
});

const VALID_STALE_DAYS = new Set([3, 5, 7, 14]);
const DAY_MS = 24 * 60 * 60 * 1000;

export class BotItemError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [data]
   */
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'BotItemError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** @param {string} status */
export function isClosedStatus(status) {
  return status === 'done' || status === 'canceled';
}

/** @param {number | null | undefined} id */
export function formatEventId(id) {
  if (id === null || id === undefined) return null;
  return `e${Number(id)}`;
}

/**
 * Parse an event id from `'e12'` or `12`.
 * @param {string | number | null | undefined} value
 * @returns {number | null}
 */
export function parseEventId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new BotItemError('invalid_argument', `Invalid event id: ${value}`);
    }
    return value;
  }
  const match = /^e?(\d+)$/i.exec(String(value).trim());
  if (!match) {
    throw new BotItemError('invalid_argument', `Invalid event id: ${value}`);
  }
  return Number(match[1]);
}

/**
 * Validate required trimmed string with max length.
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLen
 */
export function requireString(value, field, maxLen) {
  if (typeof value !== 'string') {
    throw new BotItemError('invalid_argument', `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new BotItemError('invalid_argument', `${field} cannot be empty`);
  }
  if (trimmed.length > maxLen) {
    throw new BotItemError('invalid_argument', `${field} exceeds ${maxLen} characters`);
  }
  return trimmed;
}

/**
 * Validate optional nullable string (empty string normalizes to null).
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLen
 */
export function normalizeOptionalText(value, field, maxLen) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new BotItemError('invalid_argument', `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) {
    throw new BotItemError('invalid_argument', `${field} exceeds ${maxLen} characters`);
  }
  return trimmed;
}

/** @param {unknown} status */
export function validateStatus(status) {
  if (typeof status !== 'string' || !ITEM_STATUSES.includes(status)) {
    throw new BotItemError('invalid_argument', `Invalid item status: ${String(status)}`);
  }
  return status;
}

/** @param {any} actor */
export function validateActor(actor) {
  if (!actor || typeof actor !== 'object') {
    throw new BotItemError('invalid_argument', 'actor is required');
  }
  if (actor.kind === 'owner') {
    return actor.device ? { kind: 'owner', device: String(actor.device) } : { kind: 'owner' };
  }
  if (actor.kind === 'bot') {
    if (!actor.botId || !actor.chatId) {
      throw new BotItemError('invalid_argument', 'bot actor requires botId and chatId');
    }
    return { kind: 'bot', botId: String(actor.botId), chatId: String(actor.chatId) };
  }
  if (actor.kind === 'orca') {
    if (!actor.why) {
      throw new BotItemError('invalid_argument', 'orca actor requires why');
    }
    return { kind: 'orca', why: String(actor.why) };
  }
  throw new BotItemError('invalid_argument', `Invalid actor kind: ${String(actor.kind)}`);
}

/** @param {any} source */
export function validateSource(source) {
  const validKinds = ['home', 'chat', 'thread', 'automation'];
  if (!source || typeof source !== 'object' || !validKinds.includes(source.kind)) {
    throw new BotItemError('invalid_argument', 'source must include valid kind (home|chat|thread|automation)');
  }
  const title = source.title === null || source.title === undefined
    ? null
    : String(source.title).trim().slice(0, 200) || null;
  return { kind: source.kind, title };
}

/** @param {any} links */
export function validateLinks(links) {
  if (!Array.isArray(links)) {
    throw new BotItemError('invalid_argument', 'links must be an array');
  }
  /** @type {{ kind: string, ref: string }[]} */
  const out = [];
  const seen = new Set();
  for (const entry of links) {
    if (!entry || typeof entry !== 'object' || !ITEM_LINK_KINDS.includes(entry.kind)) {
      throw new BotItemError('invalid_argument', `Invalid link kind: ${String(entry?.kind)}`);
    }
    const ref = requireString(entry.ref, 'link.ref', 2000);
    const key = `${entry.kind}\0${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: entry.kind, ref });
  }
  if (out.length > ITEM_LIMITS.links) {
    throw new BotItemError('invalid_argument', `At most ${ITEM_LIMITS.links} links allowed`);
  }
  return out;
}

/** @param {any} option @param {Set<string>} seenLabels */
function validateAskOption(option, seenLabels) {
  if (!option || typeof option !== 'object') {
    throw new BotItemError('invalid_argument', 'Each ask option must be an object');
  }
  const label = requireString(option.label, 'ask option label', ITEM_LIMITS.optionLabel);
  const labelKey = label.toLowerCase();
  if (seenLabels.has(labelKey)) {
    throw new BotItemError('invalid_argument', `Duplicate option label: ${label}`);
  }
  seenLabels.add(labelKey);
  const detail = normalizeOptionalText(option.detail, 'ask option detail', ITEM_LIMITS.optionDetail);
  return detail ? { label, detail } : { label };
}

/** @param {any} q @param {Set<string>} seenPrompts */
function validateAskQuestion(q, seenPrompts) {
  if (!q || typeof q !== 'object') {
    throw new BotItemError('invalid_argument', 'Each ask question must be an object');
  }
  const prompt = requireString(q.prompt, 'ask question prompt', ITEM_LIMITS.questionPrompt);
  const promptKey = prompt.toLowerCase();
  if (seenPrompts.has(promptKey)) {
    throw new BotItemError('invalid_argument', `Duplicate ask question prompt: ${prompt}`);
  }
  seenPrompts.add(promptKey);
  if (!Array.isArray(q.options) || q.options.length === 0 || q.options.length > ITEM_LIMITS.maxOptions) {
    throw new BotItemError('invalid_argument', `Ask question must have 1..${ITEM_LIMITS.maxOptions} options`);
  }
  const seenLabels = new Set();
  const options = q.options.map((opt) => validateAskOption(opt, seenLabels));
  /** @type {Record<string, any>} */
  const normalized = { prompt, options };
  if (q.recommended !== undefined && q.recommended !== null) {
    if (!Number.isInteger(q.recommended) || q.recommended < 0 || q.recommended >= options.length) {
      throw new BotItemError('invalid_argument', 'recommended must be a valid option index');
    }
    normalized.recommended = q.recommended;
  }
  if (q.multi !== undefined) {
    if (typeof q.multi !== 'boolean') {
      throw new BotItemError('invalid_argument', 'multi must be a boolean');
    }
    if (q.multi) normalized.multi = true;
  }
  return normalized;
}

/**
 * Validate structured Needs-You `ask` payload.
 * @param {any} ask
 */
export function validateAsk(ask) {
  const rawQuestions = Array.isArray(ask) ? ask : ask?.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0 || rawQuestions.length > ITEM_LIMITS.maxQuestions) {
    throw new BotItemError('invalid_argument', `ask must include 1..${ITEM_LIMITS.maxQuestions} questions`);
  }
  const context = !Array.isArray(ask) && ask?.context !== undefined
    ? normalizeOptionalText(ask.context, 'ask.context', ITEM_LIMITS.text)
    : null;
  const seenPrompts = new Set();
  const questions = rawQuestions.map((q) => validateAskQuestion(q, seenPrompts));
  return context ? { context, questions } : { questions };
}

/**
 * Render readable fallback comment text from a validated `ask` payload.
 * @param {{ context?: string, questions: Array<{ prompt: string, options: Array<{ label: string, detail?: string }>, recommended?: number }> }} ask
 */
export function formatAskAsText(ask) {
  const lines = [];
  if (ask.context) {
    lines.push(ask.context, '');
  }
  for (const q of ask.questions) {
    lines.push(q.prompt);
    q.options.forEach((opt, idx) => {
      const rec = q.recommended === idx ? ' (recommended)' : '';
      const detail = opt.detail ? ` — ${opt.detail}` : '';
      lines.push(`- ${opt.label}${rec}${detail}`);
    });
  }
  return lines.join('\n').slice(0, ITEM_LIMITS.text);
}

/** @param {any} row */
export function mapItemRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    number: row.number,
    ownerBotId: row.owner_bot_id,
    chatId: row.chat_id,
    source: JSON.parse(row.source),
    madeBy: row.made_by ? JSON.parse(row.made_by) : null,
    title: row.title,
    description: row.description ?? null,
    doneMeans: row.done_means ?? null,
    status: row.status,
    questionEvent: row.question_event ?? null,
    questionEventId: formatEventId(row.question_event),
    closeNote: row.close_note ?? null,
    version: row.version,
    lastEventId: row.last_event_id,
    lastEventRef: formatEventId(row.last_event_id),
    othersLastEventId: row.others_last_event_id ?? 0,
    othersLastEventRef: formatEventId(row.others_last_event_id ?? 0),
    snoozedUntil: row.snoozed_until ?? null,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? null,
  };
}

/** @param {any} row */
export function mapEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: formatEventId(row.id),
    itemUid: row.item_uid,
    kind: row.kind,
    actor: JSON.parse(row.actor),
    data: JSON.parse(row.data),
    mail: row.mail ?? null,
    action: row.action,
    createdAt: row.created_at,
  };
}

/**
 * Determine whether a write should queue mail back to the item's owning chat.
 * @param {{ chatId: string, ownerBotId?: string }} item
 * @param {{ kind: string, botId?: string, chatId?: string }} actor
 */
export function shouldQueueMail(item, actor) {
  if (actor.kind === 'owner') return true;
  if (actor.kind === 'bot') {
    if (item.ownerBotId && actor.botId !== item.ownerBotId) return true;
    if (actor.chatId !== item.chatId) return true;
  }
  return false;
}

/**
 * Parse a pagination cursor from `{ lastActivityAt, number }`, `"<ts>:<num>"`, or JSON string.
 * @param {unknown} raw
 * @returns {{ lastActivityAt: number, number: number } | null}
 */
export function parseItemCursor(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') {
    const obj = /** @type {any} */ (raw);
    if (Number.isFinite(obj.lastActivityAt) && Number.isFinite(obj.number)) {
      return { lastActivityAt: Number(obj.lastActivityAt), number: Number(obj.number) };
    }
    throw new BotItemError('invalid_argument', 'Invalid item cursor object');
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const colon = /^(\d+):(\d+)$/.exec(trimmed);
    if (colon) {
      return { lastActivityAt: Number(colon[1]), number: Number(colon[2]) };
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && Number.isFinite(parsed.lastActivityAt) && Number.isFinite(parsed.number)) {
        return { lastActivityAt: Number(parsed.lastActivityAt), number: Number(parsed.number) };
      }
    } catch {
      // Fall through to error.
    }
  }
  throw new BotItemError('invalid_argument', `Invalid item cursor: ${String(raw)}`);
}

/**
 * Parse a `link` filter (object `{ kind, ref }` or string `kind:ref` / URL / ref).
 * @param {unknown} raw
 * @returns {{ kind: string | null, ref: string, altPrRef?: string | null } | null}
 */
export function parseLinkFilter(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') {
    const obj = /** @type {any} */ (raw);
    const kind = obj.kind ? String(obj.kind).trim() : null;
    if (kind && !ITEM_LINK_KINDS.includes(kind)) {
      throw new BotItemError('invalid_argument', `Invalid link kind: ${kind}`);
    }
    const ref = requireString(obj.ref, 'link.ref', 2000);
    return { kind, ref, altPrRef: null };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const prefixed = /^(dispatch|pr|url|file):(.+)$/i.exec(trimmed);
    if (prefixed && !/^https?:\/\//i.test(trimmed)) {
      return { kind: prefixed[1].toLowerCase(), ref: prefixed[2].trim(), altPrRef: null };
    }
    const ghPr = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(trimmed);
    if (ghPr) {
      return { kind: null, ref: trimmed, altPrRef: `${ghPr[1]}#${ghPr[2]}` };
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return { kind: 'url', ref: trimmed, altPrRef: null };
    }
    return { kind: null, ref: trimmed, altPrRef: null };
  }
  throw new BotItemError('invalid_argument', 'Invalid link filter');
}

/**
 * Compute stale threshold in ms for a bot's `itemsStale` setting and item status.
 * @param {number | 'never' | undefined} itemsStale
 * @param {string} status
 */
export function staleThresholdMs(itemsStale, status) {
  if (itemsStale === 'never') return null;
  const days = VALID_STALE_DAYS.has(itemsStale) ? itemsStale : ITEM_LIMITS.defaultStaleDays;
  const multiplier = status === 'planned' ? 3 : 1;
  return days * multiplier * DAY_MS;
}

/**
 * Normalize image/file attachments array on comments.
 * @param {unknown} list
 * @param {string} field
 * @param {number} maxCount
 */
export function normalizeAttachmentList(list, field, maxCount) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    throw new BotItemError('invalid_argument', `${field} must be an array`);
  }
  if (list.length > maxCount) {
    throw new BotItemError('invalid_argument', `${field} exceeds ${maxCount} items`);
  }
  return list;
}
