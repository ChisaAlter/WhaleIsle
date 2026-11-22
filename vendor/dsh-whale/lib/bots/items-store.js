/**
 * Bot Work Items SQLite store (22 atomic operations + `needsYouCounts`).
 * Implements Orca's `bot-items.sqlite` state machine on top of `bots.db`.
 */
import crypto from 'node:crypto';
import { withTransaction } from './db.js';
import { createItemQueries } from './items-queries.js';
import {
  BotItemError,
  ITEM_LIMITS,
  ITEM_STATUSES,
  OPEN_ITEM_STATUSES,
  formatAskAsText,
  formatEventId,
  isClosedStatus,
  mapEventRow,
  mapItemRow,
  normalizeAttachmentList,
  normalizeOptionalText,
  parseEventId,
  requireString,
  shouldQueueMail,
  validateActor,
  validateAsk,
  validateLinks,
  validateSource,
  validateStatus,
} from './items-validation.js';

export {
  BotItemError,
  ITEM_LIMITS,
  ITEM_STATUSES,
  OPEN_ITEM_STATUSES,
  formatAskAsText,
  formatEventId,
  parseEventId,
  validateAsk,
};

/** @param {any} actor @param {any} item */
function assertCanBotWrite(actor, item) {
  if (actor.kind === 'bot' && actor.botId !== item.ownerBotId) {
    throw new BotItemError('not_owner', `Bot ${actor.botId} does not own item ${item.uid}`);
  }
}

/** @param {any} p @param {string} status */
function parseAddQuestionAndLinks(p, status) {
  const validLinks = p.links ? validateLinks(p.links) : [];
  const ask = p.ask ? validateAsk(p.ask) : null;
  if (ask && status !== 'needs_you') {
    throw new BotItemError('invalid_argument', 'ask requires status to be needs_you');
  }
  const commentText = p.comment
    ? normalizeOptionalText(p.comment, 'comment', ITEM_LIMITS.text)
    : (ask ? formatAskAsText(ask) : null);
  return { validLinks, ask, commentText };
}

/** @param {any} params */
function parseAddParams(params) {
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
function validateSetArgs(params) {
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
  if (params.comment !== undefined && !hasStatus) {
    throw new BotItemError('invalid_argument', 'comment on set requires a status change');
  }
  return {
    hasStatus,
    status,
    ask: params.ask !== undefined ? validateAsk(params.ask) : undefined,
    reason: hasReason ? requireString(params.reason, 'reason', ITEM_LIMITS.note) : null,
    note: params.note !== undefined ? normalizeOptionalText(params.note, 'note', ITEM_LIMITS.note) : null,
    commentText: params.comment !== undefined ? normalizeOptionalText(params.comment, 'comment', ITEM_LIMITS.text) : null,
  };
}

/** @param {any} params @param {any} next */
function collectFieldEdits(params, next) {
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
function applyStatusAndQuestion(item, parsed, next, tx, actor, mail, now) {
  if (parsed.hasStatus && parsed.status !== item.status) {
    const statusData = { from: item.status, to: parsed.status };
    if (parsed.reason) statusData.reason = parsed.reason;
    if (parsed.note) statusData.note = parsed.note;
    tx.append('status', actor, statusData, mail, now);
    next.status = parsed.status;
    next.lastActivityAt = now;
    if (parsed.status !== 'needs_you') {
      next.questionEvent = null;
      next.snoozedUntil = null;
    }
    if (isClosedStatus(parsed.status)) {
      next.closedAt = now;
      next.closeNote = parsed.status === 'canceled' ? parsed.reason : parsed.note;
    } else {
      next.closedAt = null;
      next.closeNote = null;
    }
  }
  if (parsed.status === 'needs_you' && (parsed.commentText || parsed.ask)) {
    const text = parsed.commentText ?? formatAskAsText(parsed.ask);
    const qData = { text, ...(parsed.ask ? { ask: parsed.ask } : {}) };
    next.questionEvent = tx.append('commented', actor, qData, mail, now).id;
    next.lastActivityAt = now;
  } else if (parsed.commentText && parsed.hasStatus) {
    tx.append('commented', actor, { text: parsed.commentText }, mail, now);
    next.lastActivityAt = now;
  }
}

/** @param {any} db @param {string} uid */
function createTxContext(db, uid) {
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
function itemMutableState(item) {
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

/** @param {import('node:sqlite').DatabaseSync} db */
export function createItemsStore(db) {
  const queries = createItemQueries(db);

  const selectByUid = db.prepare('SELECT * FROM bot_items WHERE uid = ?');
  const selectNextNumber = db.prepare('SELECT coalesce(max(number), 0) + 1 AS next FROM bot_items');
  const countLinksStmt = db.prepare('SELECT count(*) AS cnt FROM bot_item_links WHERE item_uid = ?');
  const insertLinkStmt = db.prepare(
    'INSERT OR IGNORE INTO bot_item_links (item_uid, kind, ref, added_event) VALUES (?, ?, ?, ?)',
  );
  const selectEventById = db.prepare('SELECT * FROM bot_item_events WHERE id = ?');
  const selectLastStatusEvent = db.prepare(
    "SELECT * FROM bot_item_events WHERE item_uid = ? AND kind = 'status' ORDER BY id DESC LIMIT 1",
  );
  const selectRequestIdDup = db.prepare(
    "SELECT * FROM bot_item_events WHERE item_uid = ? AND kind = 'commented' AND json_extract(data, '$.requestId') = ? LIMIT 1",
  );
  const checkSnoozeConflictStmt = db.prepare(
    "SELECT 1 FROM bot_item_events WHERE item_uid = ? AND id > ? AND kind = 'status' AND json_extract(actor, '$.kind') != 'owner' LIMIT 1",
  );

  function requireItem(uid) {
    const item = mapItemRow(selectByUid.get(String(uid)));
    if (!item) throw new BotItemError('not_found', `Item not found: ${uid}`);
    return item;
  }

  function assertBotNotOwnerCanceled(item, actor) {
    if (actor.kind !== 'bot' || item.status !== 'canceled') return;
    const lastStatus = selectLastStatusEvent.get(item.uid);
    if (lastStatus && JSON.parse(lastStatus.actor)?.kind === 'owner') {
      throw new BotItemError(
        'item_closed',
        'This item was canceled by the owner. Comment to ask before reopening it.',
        { uid: item.uid, canceledBy: 'owner' },
      );
    }
  }

  function insertItemLinks(uid, validatedLinks, eventId) {
    const existingCount = Number(countLinksStmt.get(uid)?.cnt ?? 0);
    /** @type {{ kind: string, ref: string }[]} */
    const added = [];
    for (const entry of validatedLinks) {
      const info = insertLinkStmt.run(uid, entry.kind, entry.ref, eventId);
      if (Number(info.changes ?? 0) > 0) added.push(entry);
    }
    if (existingCount + added.length > ITEM_LIMITS.links) {
      throw new BotItemError('invalid_argument', `Item cannot exceed ${ITEM_LIMITS.links} links`);
    }
    return added;
  }

  function persistItemMeta(item, fields, tx, now) {
    const nextVersion = item.version + tx.versionDelta;
    const nextLastEvent = tx.lastEventId || item.lastEventId;
    const nextOthersLast = Math.max(item.othersLastEventId, tx.othersLastEventId);
    db.prepare(`
      UPDATE bot_items SET
        title = ?, description = ?, done_means = ?, status = ?,
        question_event = ?, close_note = ?, version = ?, last_event_id = ?,
        others_last_event_id = ?, snoozed_until = ?,
        last_activity_at = ?, updated_at = ?, closed_at = ?
      WHERE uid = ?
    `).run(
      fields.title, fields.description, fields.doneMeans, fields.status,
      fields.questionEvent, fields.closeNote, nextVersion, nextLastEvent,
      nextOthersLast, fields.snoozedUntil, fields.lastActivityAt ?? now, now, fields.closedAt, item.uid,
    );
  }

  function markMailSent(eventIds) {
    if (!Array.isArray(eventIds) || eventIds.length === 0) return 0;
    const ids = eventIds.map((v) => parseEventId(v)).filter((v) => v !== null);
    if (ids.length === 0) return 0;
    return withTransaction(db, () => {
      const stmt = db.prepare("UPDATE bot_item_events SET mail = 'sent' WHERE id = ? AND mail = 'owed'");
      let updated = 0;
      for (const id of ids) updated += Number(stmt.run(id).changes ?? 0);
      return updated;
    });
  }

  function add(params, actor, now = Date.now()) {
    const validActor = validateActor(actor);
    const p = parseAddParams(params);
    return withTransaction(db, () => {
      const number = Number(selectNextNumber.get()?.next ?? 1);
      const mail = shouldQueueMail({ chatId: p.chatId }, validActor) ? 'owed' : null;
      db.prepare(`
        INSERT INTO bot_items (
          uid, number, owner_bot_id, chat_id, source, made_by, title, description, done_means,
          status, question_event, close_note, version, last_event_id, last_activity_at,
          created_at, updated_at, closed_at, others_last_event_id, snoozed_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, ?, ?, ?, NULL, 0, NULL)
      `).run(
        p.uid, number, p.ownerBotId, p.chatId, JSON.stringify(p.source),
        p.madeBy ? JSON.stringify(p.madeBy) : null,
        p.title, p.description, p.doneMeans, p.status, now, now, now,
      );

      const tx = createTxContext(db, p.uid);
      const madeEv = tx.append('made', validActor, { title: p.title, status: p.status }, mail, now);
      let questionEvent = null;
      if (p.status === 'needs_you' && (p.commentText || p.ask)) {
        const qData = { text: p.commentText ?? formatAskAsText(p.ask), ...(p.ask ? { ask: p.ask } : {}) };
        questionEvent = tx.append('commented', validActor, qData, mail, now).id;
      }
      if (p.validLinks.length > 0) {
        const added = insertItemLinks(p.uid, p.validLinks, madeEv.id);
        if (added.length > 0) tx.append('linked', validActor, { links: added }, mail, now);
      }

      const draft = { uid: p.uid, version: 0, lastEventId: 0, othersLastEventId: 0 };
      persistItemMeta(draft, {
        title: p.title, description: p.description, doneMeans: p.doneMeans, status: p.status,
        questionEvent, closeNote: null, snoozedUntil: null, lastActivityAt: now, closedAt: null,
      }, tx, now);
      return { item: requireItem(p.uid), events: tx.events };
    });
  }

  function set(uid, params, actor, now = Date.now()) {
    const validActor = validateActor(actor);
    const parsed = validateSetArgs(params ?? {});
    return withTransaction(db, () => {
      const item = requireItem(uid);
      assertCanBotWrite(validActor, item);
      if (isClosedStatus(item.status) && !parsed.hasStatus) {
        throw new BotItemError('item_closed', `Item ${uid} is closed`);
      }
      if (parsed.hasStatus && parsed.status !== item.status) {
        assertBotNotOwnerCanceled(item, validActor);
      }
      const mail = shouldQueueMail(item, validActor) ? 'owed' : null;
      const tx = createTxContext(db, item.uid);
      const next = itemMutableState(item);
      const edits = collectFieldEdits(params ?? {}, next);
      if (Object.keys(edits).length > 0) {
        tx.append('edited', validActor, edits, mail, now);
        next.lastActivityAt = now;
      }
      applyStatusAndQuestion(item, parsed, next, tx, validActor, mail, now);
      if (tx.versionDelta > 0) persistItemMeta(item, next, tx, now);
      return { item: requireItem(item.uid), events: tx.events };
    });
  }

  function comment(uid, params, actor, now = Date.now()) {
    const validActor = validateActor(actor);
    const images = normalizeAttachmentList(params?.images, 'images', 20);
    const files = normalizeAttachmentList(params?.files, 'files', 10);
    const ask = params?.ask ? validateAsk(params.ask) : null;
    const text = normalizeOptionalText(params?.text, 'text', ITEM_LIMITS.text) ?? (ask ? formatAskAsText(ask) : null);
    if (!text && images.length === 0 && files.length === 0) {
      throw new BotItemError('invalid_argument', 'Comment requires text, ask, images, or files');
    }
    const requestId = params?.requestId ? requireString(params.requestId, 'requestId', 128) : null;

    return withTransaction(db, () => {
      const item = requireItem(uid);
      assertCanBotWrite(validActor, item);
      if (ask && item.status !== 'needs_you') {
        throw new BotItemError('invalid_argument', 'ask comment requires item status to be needs_you');
      }
      if (requestId) {
        const dup = selectRequestIdDup.get(item.uid, requestId);
        if (dup) return { item, event: mapEventRow(dup), deduplicated: true };
      }
      const mail = shouldQueueMail(item, validActor) ? 'owed' : null;
      const tx = createTxContext(db, item.uid);
      const data = {
        ...(text ? { text } : {}),
        ...(images.length ? { images } : {}),
        ...(files.length ? { files } : {}),
        ...(ask ? { ask } : {}),
        ...(requestId ? { requestId } : {}),
      };
      const ev = tx.append('commented', validActor, data, mail, now);
      const next = { ...itemMutableState(item), questionEvent: ask ? ev.id : item.questionEvent, lastActivityAt: now };
      persistItemMeta(item, next, tx, now);
      return { item: requireItem(item.uid), event: ev, deduplicated: false };
    });
  }

  function close(uid, params, actor, now = Date.now()) {
    const status = validateStatus(params?.status);
    if (!isClosedStatus(status)) {
      throw new BotItemError('invalid_argument', 'close status must be done or canceled');
    }
    const current = requireItem(uid);
    if (isClosedStatus(current.status)) {
      throw new BotItemError('item_closed', `Item ${uid} is already closed`);
    }
    return set(uid, { status, reason: params?.reason, note: params?.note }, actor, now);
  }

  function link(uid, linksInput, actor, now = Date.now()) {
    const validActor = validateActor(actor);
    const validLinks = validateLinks(linksInput);
    if (validLinks.length === 0) {
      throw new BotItemError('invalid_argument', 'At least one link is required');
    }
    return withTransaction(db, () => {
      const item = requireItem(uid);
      assertCanBotWrite(validActor, item);
      const mail = shouldQueueMail(item, validActor) ? 'owed' : null;
      const tx = createTxContext(db, item.uid);
      const added = insertItemLinks(item.uid, validLinks, item.lastEventId + 1);
      if (added.length === 0) return { item, added: [], event: null };
      const ev = tx.append('linked', validActor, { links: added }, mail, now);
      const updateLinkEv = db.prepare('UPDATE bot_item_links SET added_event = ? WHERE item_uid = ? AND kind = ? AND ref = ?');
      for (const entry of added) updateLinkEv.run(ev.id, item.uid, entry.kind, entry.ref);
      persistItemMeta(item, { ...itemMutableState(item), lastActivityAt: now }, tx, now);
      return { item: requireItem(item.uid), added, event: ev };
    });
  }

  function linkStartedWorker(uid, dispatchRef, chatId = null, now = Date.now()) {
    const ref = requireString(dispatchRef, 'dispatchRef', 512);
    const actor = { kind: 'orca', why: 'worker_started' };
    return withTransaction(db, () => {
      const item = requireItem(uid);
      const mail = chatId && chatId !== item.chatId ? 'owed' : null;
      const tx = createTxContext(db, item.uid);
      const added = insertItemLinks(item.uid, [{ kind: 'dispatch', ref }], item.lastEventId + 1);
      let linked = false;
      if (added.length > 0) {
        linked = true;
        const ev = tx.append('linked', actor, { links: added }, mail, now);
        db.prepare('UPDATE bot_item_links SET added_event = ? WHERE item_uid = ? AND kind = ? AND ref = ?')
          .run(ev.id, item.uid, 'dispatch', ref);
      }
      const next = itemMutableState(item);
      let statusChanged = false;
      if (item.status === 'planned' || item.status === 'needs_you') {
        statusChanged = true;
        next.status = 'working';
        next.questionEvent = null;
        next.snoozedUntil = null;
        tx.append('status', actor, { from: item.status, to: 'working', cause: 'worker_started' }, mail, now);
      }
      if (tx.versionDelta > 0) {
        next.lastActivityAt = now;
        persistItemMeta(item, next, tx, now);
      }
      return { item: requireItem(item.uid), linked, statusChanged, events: tx.events };
    });
  }

  function ownerComment(uid, params, actor = { kind: 'owner' }, now = Date.now()) {
    const validActor = validateActor(actor);
    if (validActor.kind !== 'owner') {
      throw new BotItemError('invalid_argument', 'ownerComment requires an owner actor');
    }
    const images = normalizeAttachmentList(params?.images, 'images', 20);
    const files = normalizeAttachmentList(params?.files, 'files', 10);
    const text = normalizeOptionalText(params?.text, 'text', ITEM_LIMITS.text);
    if (!text && images.length === 0 && files.length === 0) {
      throw new BotItemError('invalid_argument', 'Owner comment requires text, images, or files');
    }
    const requestId = params?.requestId ? requireString(params.requestId, 'requestId', 128) : null;

    return withTransaction(db, () => {
      const item = requireItem(uid);
      if (requestId) {
        const dup = selectRequestIdDup.get(item.uid, requestId);
        if (dup) {
          const ev = mapEventRow(dup);
          return { item, event: ev, events: [ev], deduplicated: true };
        }
      }
      let answersRef = null;
      if (item.status === 'needs_you' && item.questionEvent) {
        const qRow = selectEventById.get(item.questionEvent);
        if (qRow && JSON.parse(qRow.actor)?.kind === 'bot') answersRef = formatEventId(item.questionEvent);
      }
      const tx = createTxContext(db, item.uid);
      const commentData = {
        ...(text ? { text } : {}),
        ...(images.length ? { images } : {}),
        ...(files.length ? { files } : {}),
        ...(requestId ? { requestId } : {}),
        ...(answersRef ? { answers: answersRef } : {}),
      };
      const ev = tx.append('commented', validActor, commentData, 'owed', now);
      const next = { ...itemMutableState(item), lastActivityAt: now };
      if (answersRef) {
        next.status = 'working';
        next.questionEvent = null;
        next.snoozedUntil = null;
        tx.append('status', validActor, { from: 'needs_you', to: 'working', cause: 'answer' }, 'owed', now);
      } else if (next.snoozedUntil !== null) {
        const prevUntil = next.snoozedUntil;
        next.snoozedUntil = null;
        tx.append('unsnoozed', validActor, { previousUntil: prevUntil, cause: 'comment' }, 'owed', now);
      }
      persistItemMeta(item, next, tx, now);
      return { item: requireItem(item.uid), event: ev, events: tx.events, deduplicated: false };
    });
  }

  function ownerStatus(uidsInput, params, actor = { kind: 'owner' }, now = Date.now()) {
    const validActor = validateActor(actor);
    if (validActor.kind !== 'owner') {
      throw new BotItemError('invalid_argument', 'ownerStatus requires an owner actor');
    }
    const uids = Array.isArray(uidsInput) ? uidsInput : [uidsInput];
    if (uids.length === 0) throw new BotItemError('invalid_argument', 'At least one item uid is required');
    const status = validateStatus(params?.status);
    return withTransaction(db, () => {
      const updated = [];
      const skipped = [];
      for (const uid of uids) {
        const current = requireItem(uid);
        if (current.status === status) {
          skipped.push(current.uid);
          continue;
        }
        updated.push(set(current.uid, { status, reason: params?.reason, note: params?.note }, validActor, now).item);
      }
      return { updated, skipped };
    });
  }

  function ownerSnooze({ items: targets, until }, actor = { kind: 'owner' }, now = Date.now()) {
    const validActor = validateActor(actor);
    if (validActor.kind !== 'owner') throw new BotItemError('invalid_argument', 'ownerSnooze requires an owner actor');
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new BotItemError('invalid_argument', 'ownerSnooze requires a non-empty items array');
    }
    if (until !== null && (!Number.isInteger(until) || until <= now || until > now + ITEM_LIMITS.maxSnoozeMs)) {
      throw new BotItemError('invalid_argument', 'Snooze until must be between now and 366 days ahead');
    }
    return withTransaction(db, () => {
      const updatedItems = [];
      const allEvents = [];
      for (const target of targets) {
        const uid = typeof target === 'string' ? target : target?.uid;
        const item = requireItem(uid);
        if (isClosedStatus(item.status)) {
          throw new BotItemError('item_closed', `Cannot snooze closed item ${item.uid}`, { uid: item.uid });
        }
        const seenRef = typeof target === 'object' ? target.othersLastEventId : null;
        if (until !== null && seenRef !== undefined && seenRef !== null) {
          const seenId = parseEventId(seenRef);
          if (checkSnoozeConflictStmt.get(item.uid, seenId)) {
            throw new BotItemError('item_changed', `Item ${item.uid} status changed after ${formatEventId(seenId)}`, {
              uid: item.uid, othersLastEventId: item.othersLastEventId,
            });
          }
        }
        const tx = createTxContext(db, item.uid);
        if (until === null && item.snoozedUntil !== null) {
          tx.append('unsnoozed', validActor, { previousUntil: item.snoozedUntil }, 'owed', now);
        } else if (until !== null) {
          tx.append('snoozed', validActor, { until }, 'owed', now);
        }
        if (tx.versionDelta > 0) persistItemMeta(item, { ...itemMutableState(item), snoozedUntil: until }, tx, now);
        updatedItems.push(requireItem(item.uid));
        allEvents.push(...tx.events);
      }
      return { items: updatedItems, events: allEvents };
    });
  }

  return {
    ...queries,
    add,
    set,
    comment,
    close,
    link,
    linkStartedWorker,
    ownerComment,
    ownerStatus,
    ownerSnooze,
    markMailSent,
  };
}
