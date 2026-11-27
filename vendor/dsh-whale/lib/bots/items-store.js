/**
 * Bot Work Items SQLite store (22 atomic operations + `needsYouCounts`).
 * Implements Orca's `bot-items.sqlite` state machine on top of `bots.db`.
 */
import { isDatabaseReadOnly, withTransaction } from './db.js';
import { createItemQueries } from './items-queries.js';
import {
  applyStatusAndQuestion,
  assertBotItemAttach,
  assertCanBotComment,
  assertCanBotWrite,
  collectFieldEdits,
  createTxContext,
  endSnooze,
  itemMutableState,
  parseAddParams,
  parseOwnerCommentParams,
  validateSetArgs,
} from './items-helpers.js';
import {
  BotItemError,
  CROSS_BOT_ATTACH_LINK_KINDS,
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
  validateStatus,
} from './items-validation.js';

export {
  BotItemError,
  CROSS_BOT_ATTACH_LINK_KINDS,
  ITEM_LIMITS,
  ITEM_STATUSES,
  OPEN_ITEM_STATUSES,
  assertBotItemAttach,
  formatAskAsText,
  formatEventId,
  parseEventId,
  validateAsk,
};

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ onItemClosed?: (item: any, event: any) => void }} [options]
 */
export function createItemsStore(db, options = {}) {
  const queries = createItemQueries(db);
  /** @type {Set<(item: any, event: any) => void>} */
  const closeListeners = new Set();
  if (typeof options?.onItemClosed === 'function') {
    closeListeners.add(options.onItemClosed);
  }

  function assertWritable() {
    if (isDatabaseReadOnly(db)) {
      throw new BotItemError(
        'items_read_only',
        'Work items store is in read-only mode because the database schema is newer than this client.',
      );
    }
  }

  /** @param {any} item @param {any} event */
  function notifyItemClosed(item, event) {
    if (!item || !event || closeListeners.size === 0) return;
    for (const listener of [...closeListeners]) {
      try {
        listener(item, event);
      } catch {
        // Best-effort post-commit hook (e.g. memory journal) must not break item close.
      }
    }
  }

  /** @param {(item: any, event: any) => void} fn */
  function onItemClosed(fn) {
    if (typeof fn !== 'function') return () => {};
    closeListeners.add(fn);
    return () => { closeListeners.delete(fn); };
  }

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
  const selectRecentOwnerCommentsStmt = db.prepare(
    "SELECT * FROM bot_item_events WHERE item_uid = ? AND kind = 'commented' AND json_extract(actor, '$.kind') = 'owner' AND created_at >= ? AND created_at <= ? ORDER BY id DESC LIMIT 10",
  );
  const selectAnsweredQuestionDupStmt = db.prepare(
    "SELECT * FROM bot_item_events WHERE item_uid = ? AND kind = 'commented' AND json_extract(actor, '$.kind') = 'owner' AND json_extract(data, '$.answers') = ? ORDER BY id DESC LIMIT 1",
  );
  const markItemOwedMailSentStmt = db.prepare(
    "UPDATE bot_item_events SET mail = 'sent' WHERE item_uid = ? AND mail = 'owed'",
  );
  const OWNER_COMMENT_DEDUP_WINDOW_MS = 60_000;
  const checkSnoozeConflictStmt = db.prepare(
    "SELECT 1 FROM bot_item_events WHERE item_uid = ? AND id > ? AND kind = 'status' AND json_extract(actor, '$.kind') != 'owner' LIMIT 1",
  );
  const selectWorkOwnerByDispatch = db.prepare(
    'SELECT bot_id FROM bot_work WHERE dispatch_id = ? ORDER BY created_at DESC LIMIT 1',
  );

  /** @param {string} dispatchRef */
  function lookupDispatchOwner(dispatchRef) {
    try {
      const row = selectWorkOwnerByDispatch.get(String(dispatchRef));
      return row?.bot_id ?? null;
    } catch {
      return null;
    }
  }

  /** @param {string} uid */
  function requireItem(uid) {
    const item = mapItemRow(selectByUid.get(String(uid)));
    if (!item) throw new BotItemError('not_found', `Item not found: ${uid}`);
    return item;
  }

  /** @param {any} item @param {any} actor */
  function assertBotNotOwnerCanceled(item, actor) {
    if (actor.kind !== 'bot' || item.status !== 'canceled') return;
    const lastStatus = selectLastStatusEvent.get(item.uid);
    if (lastStatus && JSON.parse(String(lastStatus.actor))?.kind === 'owner') {
      throw new BotItemError(
        'item_closed',
        'This item was canceled by the owner. Comment to ask before reopening it.',
        { uid: item.uid, canceledBy: 'owner' },
      );
    }
  }

  /** @param {string} uid @param {Array<{ kind: string, ref: string }>} validatedLinks @param {number} eventId */
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

  /** @param {any} item @param {any} fields @param {any} tx @param {number} now */
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
    assertWritable();
    if (!Array.isArray(eventIds) || eventIds.length === 0) return 0;
    const ids = eventIds.map((v) => parseEventId(v)).filter((v) => v !== null);
    if (ids.length === 0) return 0;
    return withTransaction(db, () => {
      const stmt = db.prepare("UPDATE bot_item_events SET mail = 'sent' WHERE id = ? AND mail = 'owed'");
      let updated = 0;
      for (const id of ids) updated += Number(stmt.run(id).changes ?? 0);
      return updated;
    }, { readOnlyCode: 'items_read_only' });
  }

  /** @param {any} params @param {any} actor @param {number} [now] */
  function add(params, actor, now = Date.now()) {
    assertWritable();
    const validActor = validateActor(actor);
    const p = parseAddParams(params);
    return withTransaction(db, () => {
      const number = Number(selectNextNumber.get()?.next ?? 1);
      const mail = shouldQueueMail({ chatId: p.chatId, ownerBotId: p.ownerBotId }, validActor) ? 'owed' : null;
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
      if (p.status === 'needs_you' && (p.commentText || p.ask || p.images.length > 0 || p.files.length > 0)) {
        const text = p.commentText ?? (p.ask ? formatAskAsText(/** @type {any} */ (p.ask)) : null);
        const qData = {
          ...(text ? { text } : {}),
          ...(p.ask ? { ask: p.ask } : {}),
          ...(p.images.length ? { images: p.images } : {}),
          ...(p.files.length ? { files: p.files } : {}),
        };
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
    }, { readOnlyCode: 'items_read_only' });
  }

  /** @param {string} uid @param {any} params @param {any} validActor @param {number} now */
  function setInternal(uid, params, validActor, now) {
    const parsed = validateSetArgs(params ?? {});
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
    const closeEvent = applyStatusAndQuestion(item, parsed, next, tx, validActor, mail, now);
    if (tx.versionDelta > 0) persistItemMeta(item, next, tx, now);
    if (isClosedStatus(next.status)) {
      markItemOwedMailSentStmt.run(item.uid);
      for (const ev of tx.events) {
        if (ev.mail === 'owed') ev.mail = 'sent';
      }
    }
    return { item: requireItem(item.uid), events: tx.events, closeEvent };
  }

  /** @param {string} uid @param {any} params @param {any} actor @param {number} [now] */
  function set(uid, params, actor, now = Date.now()) {
    assertWritable();
    const validActor = validateActor(actor);
    const res = withTransaction(
      db,
      () => setInternal(uid, params, validActor, now),
      { readOnlyCode: 'items_read_only' },
    );
    if (res.closeEvent) notifyItemClosed(res.item, res.closeEvent);
    return { item: res.item, events: res.events };
  }

  /** @param {string} uid @param {any} params @param {any} actor @param {number} [now] */
  function comment(uid, params, actor, now = Date.now()) {
    assertWritable();
    const validActor = validateActor(actor);
    const images = normalizeAttachmentList(params?.images, 'images', 20);
    const files = normalizeAttachmentList(params?.files, 'files', 10);
    const ask = params?.ask ? validateAsk(params.ask) : null;
    const text = normalizeOptionalText(params?.text, 'text', ITEM_LIMITS.text) ?? (ask ? formatAskAsText(/** @type {any} */ (ask)) : null);
    if (!text && images.length === 0 && files.length === 0) {
      throw new BotItemError('invalid_argument', 'Comment requires text, ask, images, or files');
    }
    const requestId = params?.requestId ? requireString(params.requestId, 'requestId', 128) : null;

    return withTransaction(db, () => {
      const item = requireItem(uid);
      assertCanBotComment(validActor, item, { hasAsk: Boolean(ask) });
      if (ask && item.status !== 'needs_you') {
        throw new BotItemError('invalid_argument', 'ask comment requires item status to be needs_you');
      }
      if (requestId) {
        const dup = selectRequestIdDup.get(item.uid, requestId);
        if (dup) return { item, event: mapEventRow(dup), deduplicated: true };
      }
      const mail = !isClosedStatus(item.status) && shouldQueueMail(item, validActor) ? 'owed' : null;
      const tx = createTxContext(db, item.uid);
      const next = { ...itemMutableState(item), lastActivityAt: now };
      if (ask) {
        endSnooze(next, tx, validActor, now, 'new_question');
      }
      const data = {
        ...(text ? { text } : {}),
        ...(images.length ? { images } : {}),
        ...(files.length ? { files } : {}),
        ...(ask ? { ask } : {}),
        ...(requestId ? { requestId } : {}),
      };
      const ev = tx.append('commented', validActor, data, mail, now);
      if (ask) next.questionEvent = ev.id;
      persistItemMeta(item, next, tx, now);
      return { item: requireItem(item.uid), event: ev, deduplicated: false };
    }, { readOnlyCode: 'items_read_only' });
  }

  /** @param {string} uid @param {any} params @param {any} actor @param {number} [now] */
  function close(uid, params, actor, now = Date.now()) {
    assertWritable();
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

  /**
   * @param {string} uid
   * @param {any} linksInput
   * @param {any} actor
   * @param {number} [now]
   * @param {{ isDispatchOwnedBy?: (dispatchRef: string, botId: string) => boolean }} [linkOptions]
   */
  function link(uid, linksInput, actor, now = Date.now(), linkOptions = {}) {
    assertWritable();
    const validActor = validateActor(actor);
    const validLinks = validateLinks(linksInput);
    if (validLinks.length === 0) {
      throw new BotItemError('invalid_argument', 'At least one link is required');
    }
    /** @type {(dispatchRef: string, botId: string) => boolean} */
    const isDispatchOwnedBy = typeof linkOptions?.isDispatchOwnedBy === 'function'
      ? linkOptions.isDispatchOwnedBy
      : (dispatchRef, botId) => lookupDispatchOwner(dispatchRef) === botId;

    return withTransaction(db, () => {
      const item = requireItem(uid);
      assertBotItemAttach(validActor, item, validLinks, { isDispatchOwnedBy });
      const mail = !isClosedStatus(item.status) && shouldQueueMail(item, validActor) ? 'owed' : null;
      const tx = createTxContext(db, item.uid);
      const added = insertItemLinks(item.uid, validLinks, item.lastEventId + 1);
      if (added.length === 0) return { item, added: [], event: null };
      const ev = tx.append('linked', validActor, { links: added }, mail, now);
      const updateLinkEv = db.prepare('UPDATE bot_item_links SET added_event = ? WHERE item_uid = ? AND kind = ? AND ref = ?');
      for (const entry of added) updateLinkEv.run(ev.id, item.uid, entry.kind, entry.ref);
      persistItemMeta(item, { ...itemMutableState(item), lastActivityAt: now }, tx, now);
      return { item: requireItem(item.uid), added, event: ev };
    }, { readOnlyCode: 'items_read_only' });
  }

  /**
   * @param {string} uid
   * @param {string} dispatchRef
   * @param {string | Record<string, any> | null} [chatIdOrOptions]
   * @param {number} [nowArg]
   * @param {Record<string, any>} [extraOptions]
   */
  function linkStartedWorker(uid, dispatchRef, chatIdOrOptions = null, nowArg = Date.now(), extraOptions = {}) {
    assertWritable();
    const ref = requireString(dispatchRef, 'dispatchRef', 512);
    /** @type {Record<string, any>} */
    const opts = (chatIdOrOptions && typeof chatIdOrOptions === 'object')
      ? chatIdOrOptions
      : { chatId: chatIdOrOptions, ...(extraOptions ?? {}) };
    const chatId = opts.chatId ?? null;
    const now = Number.isFinite(opts.now) ? opts.now : nowArg;
    const actor = { kind: 'orca', why: 'worker_started' };

    return withTransaction(db, () => {
      const item = requireItem(uid);
      if (isClosedStatus(item.status)) {
        throw new BotItemError(
          'item_closed',
          `Cannot link started worker to closed item ${item.uid}`,
          { uid: item.uid, dispatchRef: ref },
        );
      }
      const resolvedStarterBotId = opts.botId
        ? String(opts.botId)
        : (lookupDispatchOwner(ref) ?? item.ownerBotId);
      const isOwnerBot = resolvedStarterBotId === item.ownerBotId;
      const mail = (!isOwnerBot || (chatId && chatId !== item.chatId)) ? 'owed' : null;
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
      if (isOwnerBot && (item.status === 'planned' || item.status === 'needs_you')) {
        statusChanged = true;
        next.status = 'working';
        next.questionEvent = null;
        endSnooze(next, tx, actor, now, 'worker_started');
        tx.append('status', actor, { from: item.status, to: 'working', cause: 'worker_started' }, mail, now);
      }
      if (tx.versionDelta > 0) {
        next.lastActivityAt = now;
        persistItemMeta(item, next, tx, now);
      }
      return { item: requireItem(item.uid), linked, statusChanged, events: tx.events };
    }, { readOnlyCode: 'items_read_only' });
  }

  /** @param {any} rowData @param {any} parsed */
  function matchesOwnerCommentPayload(rowData, parsed) {
    if ((rowData?.text ?? null) !== (parsed.text ?? null)) return false;
    if (Boolean(rowData?.plain) !== parsed.plain) return false;
    if ((rowData?.askedInConversation ?? null) !== (parsed.askedInConversation ?? null)) return false;
    if (JSON.stringify(rowData?.images ?? []) !== JSON.stringify(parsed.images)) return false;
    return JSON.stringify(rowData?.files ?? []) === JSON.stringify(parsed.files);
  }

  /** @param {any} rowData @param {any} item @param {any} parsed */
  function matchesDedupQuestionContext(rowData, item, parsed) {
    if (parsed.expectedQuestionId !== null) {
      return rowData?.answers === formatEventId(parsed.expectedQuestionId);
    }
    if (parsed.plain) return Boolean(rowData?.plain);
    if (item.status === 'needs_you' && item.questionEvent) {
      return rowData?.answers === formatEventId(item.questionEvent);
    }
    return true;
  }

  /** @param {any} item @param {any} parsed @param {number} now */
  function findDuplicateOwnerComment(item, parsed, now) {
    if (parsed.requestId) {
      const dup = selectRequestIdDup.get(item.uid, parsed.requestId);
      if (dup) return mapEventRow(dup);
    }
    const supersededByNewQuestion = item.status === 'needs_you'
      && item.questionEvent !== null
      && item.questionEvent !== parsed.expectedQuestionId;
    if (parsed.expectedQuestionId !== null && !supersededByNewQuestion && item.status !== 'needs_you') {
      const dupAns = selectAnsweredQuestionDupStmt.get(item.uid, formatEventId(parsed.expectedQuestionId));
      if (dupAns) {
        const data = JSON.parse(String(dupAns.data));
        if (matchesOwnerCommentPayload(data, parsed) || (now - Number(dupAns.created_at) <= OWNER_COMMENT_DEDUP_WINDOW_MS)) {
          return mapEventRow(dupAns);
        }
      }
    }
    const recentRows = selectRecentOwnerCommentsStmt.all(item.uid, now - OWNER_COMMENT_DEDUP_WINDOW_MS, now);
    for (const row of recentRows) {
      const data = JSON.parse(String(row.data));
      if (!matchesOwnerCommentPayload(data, parsed)) continue;
      if (matchesDedupQuestionContext(data, item, parsed)) return mapEventRow(row);
    }
    return null;
  }

  /** @param {any} item @param {{ plain: boolean, expectedQuestionId: number | null }} parsed */
  function resolveOwnerAnswerRef(item, parsed) {
    if (parsed.plain) return null;
    if (parsed.expectedQuestionId !== null) {
      if (item.status !== 'needs_you' || item.questionEvent !== parsed.expectedQuestionId) {
        throw new BotItemError(
          'item_changed',
          `Item ${item.uid} question has changed or is no longer open`,
          {
            uid: item.uid,
            expectedQuestionEventId: formatEventId(parsed.expectedQuestionId),
            currentQuestionEventId: item.questionEventId,
            status: item.status,
          },
        );
      }
      return formatEventId(item.questionEvent);
    }
    if (item.status === 'needs_you' && item.questionEvent) {
      const qRow = selectEventById.get(item.questionEvent);
      const qActorKind = qRow ? JSON.parse(String(qRow.actor))?.kind : null;
      if (qActorKind && qActorKind !== 'owner') {
        return formatEventId(item.questionEvent);
      }
    }
    return null;
  }

  /** @param {string} uid @param {any} params @param {any} [actor] @param {number} [now] */
  function ownerComment(uid, params, actor = { kind: 'owner' }, now = Date.now()) {
    assertWritable();
    const validActor = validateActor(actor);
    if (validActor.kind !== 'owner') {
      throw new BotItemError('invalid_argument', 'ownerComment requires an owner actor');
    }
    const parsed = parseOwnerCommentParams(params);

    return withTransaction(db, () => {
      const item = requireItem(uid);
      const dupEvent = findDuplicateOwnerComment(item, parsed, now);
      if (dupEvent) {
        return { item, event: dupEvent, events: [dupEvent], deduplicated: true };
      }
      const answersRef = resolveOwnerAnswerRef(item, parsed);
      const mail = isClosedStatus(item.status) ? null : 'owed';
      const tx = createTxContext(db, item.uid);
      const commentData = {
        ...(parsed.text ? { text: parsed.text } : {}),
        ...(parsed.images.length ? { images: parsed.images } : {}),
        ...(parsed.files.length ? { files: parsed.files } : {}),
        ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
        ...(answersRef ? { answers: answersRef } : {}),
        ...(parsed.plain ? { plain: true } : {}),
        ...(parsed.askedInConversation ? { askedInConversation: parsed.askedInConversation } : {}),
      };
      const ev = tx.append('commented', validActor, commentData, mail, now);
      const next = { ...itemMutableState(item), lastActivityAt: now };
      if (answersRef) {
        next.status = 'working';
        next.questionEvent = null;
        endSnooze(next, tx, validActor, now, 'answer');
        tx.append('status', validActor, { from: 'needs_you', to: 'working', cause: 'answer' }, mail, now);
      } else {
        endSnooze(next, tx, validActor, now, 'comment');
      }
      persistItemMeta(item, next, tx, now);
      return { item: requireItem(item.uid), event: ev, events: tx.events, deduplicated: false };
    }, { readOnlyCode: 'items_read_only' });
  }

  /** @param {string | string[]} uidsInput @param {any} params @param {any} [actor] @param {number} [now] */
  function ownerStatus(uidsInput, params, actor = { kind: 'owner' }, now = Date.now()) {
    assertWritable();
    const validActor = validateActor(actor);
    if (validActor.kind !== 'owner') {
      throw new BotItemError('invalid_argument', 'ownerStatus requires an owner actor');
    }
    const uids = Array.isArray(uidsInput) ? uidsInput : [uidsInput];
    if (uids.length === 0) throw new BotItemError('invalid_argument', 'At least one item uid is required');
    const status = validateStatus(params?.status);
    /** @type {Array<{ item: any, event: any }>} */
    const closedNotifications = [];
    const result = withTransaction(db, () => {
      const updated = [];
      const skipped = [];
      for (const uid of uids) {
        const current = requireItem(uid);
        if (current.status === status) {
          skipped.push(current.uid);
          continue;
        }
        const res = setInternal(
          current.uid,
          { status, reason: params?.reason, note: params?.note },
          validActor,
          now,
        );
        updated.push(res.item);
        if (res.closeEvent) {
          closedNotifications.push({ item: res.item, event: res.closeEvent });
        }
      }
      return { updated, skipped };
    }, { readOnlyCode: 'items_read_only' });

    for (const entry of closedNotifications) {
      notifyItemClosed(entry.item, entry.event);
    }
    return result;
  }

  function ownerSnooze({ items: targets, until }, actor = { kind: 'owner' }, now = Date.now()) {
    assertWritable();
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
          const unsnoozeData = {
            previousUntil: item.snoozedUntil,
            ...(item.snoozedUntil > now ? { early: true } : {}),
          };
          tx.append('unsnoozed', validActor, unsnoozeData, null, now);
        } else if (until !== null) {
          tx.append('snoozed', validActor, { until }, null, now);
        }
        if (tx.versionDelta > 0) persistItemMeta(item, { ...itemMutableState(item), snoozedUntil: until }, tx, now);
        updatedItems.push(requireItem(item.uid));
        allEvents.push(...tx.events);
      }
      return { items: updatedItems, events: allEvents };
    }, { readOnlyCode: 'items_read_only' });
  }

  return {
    ...queries,
    get isReadOnly() { return isDatabaseReadOnly(db); },
    onItemClosed,
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
