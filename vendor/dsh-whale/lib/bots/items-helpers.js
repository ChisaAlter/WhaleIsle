/**
 * Pure state-transition, permission, and payload helpers for `items-store.js`.
 */
import crypto from 'node:crypto';
import {
  BotItemError,
  CROSS_BOT_ATTACH_LINK_KINDS,
  ITEM_LIMITS,
  formatAskAsText,
  formatEventId,
  isClosedStatus,
  normalizeAttachmentList,
  normalizeOptionalText,
  parseEventId,
  requireString,
  validateAsk,
  validateLinks,
  validateSource,
  validateStatus,
} from './items-validation.js';

/** @param {any} actor @param {any} item */
export function assertCanBotWrite(actor, item) {
  if (actor.kind === 'bot' && actor.botId !== item.ownerBotId) {
    throw new BotItemError('not_owner', `Bot ${actor.botId} does not own item ${item.uid}`);
  }
}

/** @param {any} actor @param {any} item @param {{ hasAsk?: boolean }} [opts] */
export function assertCanBotComment(actor, item, { hasAsk = false } = {}) {
  if (actor.kind !== 'bot') return;
  if (actor.botId === item.ownerBotId) return;
  if (!hasAsk && item.madeBy?.botId && item.madeBy.botId === actor.botId) return;
  throw new BotItemError('not_owner', `Bot ${actor.botId} cannot comment on item ${item.uid}`);
}

/**
 * Validate whether `actor` may attach `links` to `item`.
 * - Owner / system / item's owning bot: allowed.
 * - Any other bot: allowed only on OPEN items, for `dispatch` (started by that bot), `pr`, or `url`.
 * @param {any} actor
 * @param {any} item
 * @param {Array<{ kind: string, ref: string }>} links
 * @param {{ isDispatchOwnedBy?: (dispatchRef: string, botId: string) => boolean }} [options]
 */
export function assertBotItemAttach(actor, item, links, options = {}) {
  if (actor.kind !== 'bot' || actor.botId === item.ownerBotId) return;
  if (isClosedStatus(item.status)) {
    throw new BotItemError('item_closed', `Cannot attach links to closed item ${item.uid}`, { uid: item.uid });
  }
  /** @type {readonly string[]} */
  const allowedCrossBotKinds = CROSS_BOT_ATTACH_LINK_KINDS;
  for (const entry of links) {
    if (!allowedCrossBotKinds.includes(entry.kind)) {
      throw new BotItemError(
        'not_owner',
        `Bot ${actor.botId} cannot attach ${entry.kind} links to item ${item.uid} owned by ${item.ownerBotId}`,
        { uid: item.uid, kind: entry.kind },
      );
    }
    if (entry.kind === 'dispatch') {
      const owned = typeof options.isDispatchOwnedBy === 'function'
        ? Boolean(options.isDispatchOwnedBy(entry.ref, actor.botId))
        : false;
      if (!owned) {
        throw new BotItemError(
          'not_owner',
          `Bot ${actor.botId} can only attach dispatches it started (ref: ${entry.ref})`,
          { uid: item.uid, dispatchRef: entry.ref },
        );
      }
    }
  }
}

/**
 * Clear an active snooze on `next`. Records an `unsnoozed` event with `{ early: true }`
 * only when the snooze is ended before its scheduled expiration (`prevUntil > now`).
 * @param {any} next
 * @param {any} tx
 * @param {any} actor
 * @param {number} now
 * @param {string | null} [cause]
 */
export function endSnooze(next, tx, actor, now, cause = null) {
  if (next.snoozedUntil === null || next.snoozedUntil === undefined) return false;
  const prevUntil = next.snoozedUntil;
  next.snoozedUntil = null;
  if (prevUntil > now) {
    tx.append(
      'unsnoozed',
      actor,
      { previousUntil: prevUntil, early: true, ...(cause ? { cause } : {}) },
      null,
      now,
    );
    return true;
  }
  return false;
}

/** @param {any} p @param {string} status */
export function parseAddQuestionAndLinks(p, status) {
  const validLinks = p.links ? validateLinks(p.links) : [];
  const ask = p.ask ? validateAsk(p.ask) : null;
  if (ask && status !== 'needs_you') {
    throw new BotItemError('invalid_argument', 'ask requires status to be needs_you');
  }
  const images = normalizeAttachmentList(p.images, 'images', 20);
  const files = normalizeAttachmentList(p.files, 'files', 10);
  const commentText = p.comment
    ? normalizeOptionalText(p.comment, 'comment', ITEM_LIMITS.text)
    : (ask ? formatAskAsText(/** @type {any} */ (ask)) : null);
  return { validLinks, ask, commentText, images, files };
}

/** @param {any} params */
export function parseAddParams(params) {
  const p = params ?? {};
  const status = p.status ? validateStatus(p.status) : 'planned';
  if (isClosedStatus(status)) {
    throw new BotItemError('invalid_argument', 'Cannot create an item directly in a closed status');
  }
  const extra = parseAddQuestionAndLinks(p, status);
  return {
    uid: p.uid ? requireString(p.uid, 'uid', 128) : crypto.randomUUID(),
    ownerBotId: requireString(p.ownerBotId, 'ownerBotId', 128),
    chatId: requireString(p.chatId, 'chatId', 256),
    source: validateSource(p.source),
    title: requireString(p.title, 'title', ITEM_LIMITS.title),
    description: normalizeOptionalText(p.description, 'description', ITEM_LIMITS.description),
    doneMeans: normalizeOptionalText(p.doneMeans, 'doneMeans', ITEM_LIMITS.doneMeans),
    status,
    ...extra,
    madeBy: p.madeBy ?? null,
  };
}

/** @param {any} params */
export function validateSetArgs(params) {
  const hasStatus = params.status !== undefined;
  const status = hasStatus ? validateStatus(params.status) : undefined;
  const hasReason = params.reason !== undefined && params.reason !== null && String(params.reason).trim() !== '';
  if (status === 'canceled' && !hasReason) {
    throw new BotItemError('invalid_argument', 'Canceling an item requires a non-empty reason');
  }
  if (hasReason && status !== 'canceled') {
    throw new BotItemError('invalid_argument', 'reason can only be set when status is canceled');
  }
  if (params.ask !== undefined && status !== 'needs_you') {
    throw new BotItemError('invalid_argument', 'ask can only be provided when setting status to needs_you');
  }
  const images = normalizeAttachmentList(params.images, 'images', 20);
  const files = normalizeAttachmentList(params.files, 'files', 10);
  if (params.comment !== undefined && !hasStatus) {
    throw new BotItemError('invalid_argument', 'comment on set requires a status change');
  }
  if ((images.length > 0 || files.length > 0) && !hasStatus) {
    throw new BotItemError('invalid_argument', 'files/images on set require a status change');
  }
  return {
    hasStatus,
    status,
    ask: params.ask !== undefined ? validateAsk(params.ask) : undefined,
    reason: hasReason ? requireString(params.reason, 'reason', ITEM_LIMITS.note) : null,
    note: params.note !== undefined ? normalizeOptionalText(params.note, 'note', ITEM_LIMITS.note) : null,
    commentText: params.comment !== undefined ? normalizeOptionalText(params.comment, 'comment', ITEM_LIMITS.text) : null,
    images,
    files,
  };
}

/** @param {any} params @param {any} next */
export function collectFieldEdits(params, next) {
  /** @type {Record<string, any>} */
  const edits = {};
  if (params.title !== undefined) {
    const t = requireString(params.title, 'title', ITEM_LIMITS.title);
    if (t !== next.title) { edits.title = t; next.title = t; }
  }
  if (params.description !== undefined) {
    const d = normalizeOptionalText(params.description, 'description', ITEM_LIMITS.description);
    if (d !== next.description) { edits.description = d; next.description = d; }
  }
  if (params.doneMeans !== undefined) {
    const dm = normalizeOptionalText(params.doneMeans, 'doneMeans', ITEM_LIMITS.doneMeans);
    if (dm !== next.doneMeans) { edits.doneMeans = dm; next.doneMeans = dm; }
  }
  return edits;
}

/** @param {any} item @param {any} parsed @param {any} next @param {any} tx @param {any} actor @param {string|null} mail @param {number} now */
function applyStatusTransition(item, parsed, next, tx, actor, mail, now) {
  if (!parsed.hasStatus || parsed.status === item.status) return null;
  /** @type {Record<string, any>} */
  const statusData = { from: item.status, to: parsed.status };
  if (parsed.reason) statusData.reason = parsed.reason;
  if (parsed.note) statusData.note = parsed.note;
  const statusEv = tx.append('status', actor, statusData, mail, now);
  next.status = parsed.status;
  next.lastActivityAt = now;
  if (parsed.status !== 'needs_you') {
    next.questionEvent = null;
    endSnooze(next, tx, actor, now, isClosedStatus(parsed.status) ? 'closed' : 'status');
  }
  if (isClosedStatus(parsed.status)) {
    next.closedAt = now;
    next.closeNote = parsed.status === 'canceled' ? parsed.reason : parsed.note;
    return isClosedStatus(item.status) ? null : statusEv;
  }
  next.closedAt = null;
  next.closeNote = null;
  return null;
}

/** @param {any} parsed @param {any} next @param {any} tx @param {any} actor @param {string|null} mail @param {number} now */
function applySetCommentOrQuestion(parsed, next, tx, actor, mail, now) {
  const hasAttachments = parsed.images.length > 0 || parsed.files.length > 0;
  const hasPayload = Boolean(parsed.commentText || parsed.ask || hasAttachments);
  if (parsed.status === 'needs_you' && hasPayload) {
    endSnooze(next, tx, actor, now, 'new_question');
    const text = parsed.commentText ?? (parsed.ask ? formatAskAsText(/** @type {any} */ (parsed.ask)) : null);
    const qData = {
      ...(text ? { text } : {}),
      ...(parsed.ask ? { ask: parsed.ask } : {}),
      ...(parsed.images.length ? { images: parsed.images } : {}),
      ...(parsed.files.length ? { files: parsed.files } : {}),
    };
    next.questionEvent = tx.append('commented', actor, qData, mail, now).id;
    next.lastActivityAt = now;
    return;
  }
  if (parsed.hasStatus && (parsed.commentText || hasAttachments)) {
    const cData = {
      ...(parsed.commentText ? { text: parsed.commentText } : {}),
      ...(parsed.images.length ? { images: parsed.images } : {}),
      ...(parsed.files.length ? { files: parsed.files } : {}),
    };
    tx.append('commented', actor, cData, mail, now);
    next.lastActivityAt = now;
  }
}

/** @param {any} item @param {any} parsed @param {any} next @param {any} tx @param {any} actor @param {string|null} mail @param {number} now */
export function applyStatusAndQuestion(item, parsed, next, tx, actor, mail, now) {
  const closeEvent = applyStatusTransition(item, parsed, next, tx, actor, mail, now);
  applySetCommentOrQuestion(parsed, next, tx, actor, mail, now);
  return closeEvent;
}

/** @param {any} params */
function parseOptionalQuestionRef(params) {
  const rawRef = params?.questionEventId ?? params?.answers;
  if (rawRef === undefined || rawRef === null) return null;
  return parseEventId(rawRef);
}

/** @param {any} params */
export function parseOwnerCommentParams(params) {
  const images = normalizeAttachmentList(params?.images, 'images', 20);
  const files = normalizeAttachmentList(params?.files, 'files', 10);
  const text = normalizeOptionalText(params?.text, 'text', ITEM_LIMITS.text);
  if (!text && images.length === 0 && files.length === 0) {
    throw new BotItemError('invalid_argument', 'Owner comment requires text, images, or files');
  }
  const requestId = params?.requestId ? requireString(params.requestId, 'requestId', 128) : null;
  const plain = params?.plain === true;
  const expectedQuestionId = parseOptionalQuestionRef(params);
  const askedInConversation = params?.askedInConversation !== undefined && params?.askedInConversation !== null
    ? normalizeOptionalText(params.askedInConversation, 'askedInConversation', 256)
    : null;
  return { images, files, text, requestId, plain, expectedQuestionId, askedInConversation };
}

/** @param {any} db @param {string} uid */
export function createTxContext(db, uid) {
  let actionId = 0;
  let versionDelta = 0;
  let lastEventId = 0;
  let othersLastEventId = 0;
  /** @type {any[]} */
  const events = [];

  const insertEventStmt = db.prepare(`
    INSERT INTO bot_item_events (item_uid, kind, actor, data, mail, action, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const setActionStmt = db.prepare('UPDATE bot_item_events SET action = ? WHERE id = ?');

  return {
    events,
    get versionDelta() { return versionDelta; },
    get lastEventId() { return lastEventId; },
    get othersLastEventId() { return othersLastEventId; },
    /**
     * @param {string} kind
     * @param {any} actor
     * @param {any} data
     * @param {string | null} mail
     * @param {number} now
     */
    append(kind, actor, data, mail, now) {
      const info = insertEventStmt.run(uid, kind, JSON.stringify(actor), JSON.stringify(data), mail, actionId, now);
      const id = Number(info.lastInsertRowid);
      if (actionId === 0) {
        actionId = id;
        setActionStmt.run(id, id);
      }
      versionDelta += 1;
      lastEventId = id;
      if (actor.kind !== 'owner') othersLastEventId = id;
      const ev = { id, eventId: formatEventId(id), itemUid: uid, kind, actor, data, mail, action: actionId, createdAt: now };
      events.push(ev);
      return ev;
    },
  };
}

/** @param {any} item */
export function itemMutableState(item) {
  return {
    title: item.title,
    description: item.description,
    doneMeans: item.doneMeans,
    status: item.status,
    questionEvent: item.questionEvent,
    closeNote: item.closeNote,
    snoozedUntil: item.snoozedUntil,
    closedAt: item.closedAt,
    lastActivityAt: item.lastActivityAt,
  };
}
