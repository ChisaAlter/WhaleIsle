/**
 * Read/query operations and `needsYouCounts` computation for Bot Work Items.
 * Composed into `createItemsStore` in `items-store.js`.
 */
import {
  ITEM_LIMITS,
  OPEN_ITEM_STATUSES,
  formatEventId,
  mapEventRow,
  mapItemRow,
  parseEventId,
  staleThresholdMs,
  validateStatus,
} from './items-validation.js';

/**
 * Evaluate one open item row for `needsYouCounts`.
 * @param {any} row
 * @param {{ botMap: Map<string, any>, activeSet: Set<string> | null, dispatchByUid: Record<string, string[]>, now: number }} ctx
 * @param {{ counts: Record<string, number>, staleCounts: Record<string, number>, considerWake: (ts: number) => void }} acc
 */
function accumulateOpenItem(row, ctx, acc) {
  const botId = row.owner_bot_id;
  if (acc.counts[botId] === undefined) acc.counts[botId] = 0;
  if (acc.staleCounts[botId] === undefined) acc.staleCounts[botId] = 0;

  if (row.status === 'needs_you') {
    if (row.snoozed_until === null || row.snoozed_until <= ctx.now) {
      acc.counts[botId] += 1;
    } else {
      acc.considerWake(row.snoozed_until);
    }
  }

  const threshold = staleThresholdMs(ctx.botMap.get(botId)?.itemsStale, row.status);
  if (threshold === null) return;
  if (row.status === 'working' && ctx.activeSet) {
    const refs = ctx.dispatchByUid[row.uid] ?? [];
    if (refs.some((ref) => ctx.activeSet.has(ref))) return;
  }
  const staleAt = row.last_activity_at + threshold;
  if (staleAt <= ctx.now) {
    acc.staleCounts[botId] += 1;
  } else {
    acc.considerWake(staleAt);
  }
}

/** @param {any} filters */
function buildListWhereClause(filters) {
  const clauses = [];
  const params = [];
  if (filters.ownerBotId) {
    clauses.push('i.owner_bot_id = ?');
    params.push(String(filters.ownerBotId));
  }
  if (filters.chatId) {
    clauses.push('i.chat_id = ?');
    params.push(String(filters.chatId));
  }
  const statuses = filters.openOnly ? OPEN_ITEM_STATUSES : filters.statuses;
  if (Array.isArray(statuses) && statuses.length > 0) {
    const valid = statuses.map(validateStatus);
    clauses.push(`i.status IN (${valid.map(() => '?').join(',')})`);
    params.push(...valid);
  }
  if (filters.linkKind && filters.linkRef) {
    clauses.push('EXISTS (SELECT 1 FROM bot_item_links l WHERE l.item_uid = i.uid AND l.kind = ? AND l.ref = ?)');
    params.push(String(filters.linkKind), String(filters.linkRef));
  }
  if (filters.cursor && Number.isFinite(filters.cursor.lastActivityAt) && Number.isFinite(filters.cursor.number)) {
    clauses.push('(i.last_activity_at < ? OR (i.last_activity_at = ? AND i.number < ?))');
    params.push(filters.cursor.lastActivityAt, filters.cursor.lastActivityAt, filters.cursor.number);
  }
  return { whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createItemQueries(db) {
  const selectByUid = db.prepare('SELECT * FROM bot_items WHERE uid = ?');
  const selectByNumber = db.prepare('SELECT * FROM bot_items WHERE number = ?');
  const selectLinksStmt = db.prepare(
    'SELECT kind, ref, added_event FROM bot_item_links WHERE item_uid = ? ORDER BY added_event ASC, kind ASC, ref ASC',
  );
  const selectEventById = db.prepare('SELECT * FROM bot_item_events WHERE id = ?');
  const selectLatestComment = db.prepare(
    "SELECT * FROM bot_item_events WHERE item_uid = ? AND kind = 'commented' ORDER BY id DESC LIMIT 1",
  );
  const selectLatestEventAll = db.prepare('SELECT coalesce(max(id), 0) AS max_id FROM bot_item_events');
  const selectLatestEventByBot = db.prepare(`
    SELECT coalesce(max(e.id), 0) AS max_id
    FROM bot_item_events e
    JOIN bot_items i ON i.uid = e.item_uid
    WHERE i.owner_bot_id = ?
  `);

  function get(uid) {
    return mapItemRow(selectByUid.get(String(uid)));
  }

  function byNumber(num) {
    return mapItemRow(selectByNumber.get(Number(num)));
  }

  function links(uid) {
    return selectLinksStmt.all(String(uid)).map((row) => ({
      kind: row.kind,
      ref: row.ref,
      addedEvent: row.added_event,
      addedEventId: formatEventId(row.added_event),
    }));
  }

  function events(uid, { after = 0, limit = ITEM_LIMITS.eventsPage } = {}) {
    const afterId = parseEventId(after) ?? 0;
    const safeLimit = Math.min(Math.max(1, Number(limit) || ITEM_LIMITS.eventsPage), ITEM_LIMITS.listPageMax);
    const rows = db.prepare(
      'SELECT * FROM bot_item_events WHERE item_uid = ? AND id > ? ORDER BY id ASC LIMIT ?',
    ).all(String(uid), afterId, safeLimit + 1);
    return { events: rows.slice(0, safeLimit).map(mapEventRow), hasMore: rows.length > safeLimit };
  }

  function eventsBefore(uid, { before, limit = ITEM_LIMITS.eventsPage } = {}) {
    const beforeId = parseEventId(before);
    const safeLimit = Math.min(Math.max(1, Number(limit) || ITEM_LIMITS.eventsPage), ITEM_LIMITS.listPageMax);
    const rows = beforeId === null
      ? db.prepare('SELECT * FROM bot_item_events WHERE item_uid = ? ORDER BY id DESC LIMIT ?')
        .all(String(uid), safeLimit + 1)
      : db.prepare('SELECT * FROM bot_item_events WHERE item_uid = ? AND id < ? ORDER BY id DESC LIMIT ?')
        .all(String(uid), beforeId, safeLimit + 1);
    return { events: rows.slice(0, safeLimit).reverse().map(mapEventRow), hasMore: rows.length > safeLimit };
  }

  function linksTo(kind, ref) {
    return db.prepare(`
      SELECT i.* FROM bot_items i
      JOIN bot_item_links l ON l.item_uid = i.uid
      WHERE l.kind = ? AND l.ref = ?
      ORDER BY i.last_activity_at DESC, i.number DESC
    `).all(String(kind), String(ref)).map(mapItemRow);
  }

  function linkedDispatchRefs(uids) {
    /** @type {Record<string, string[]>} */
    const result = {};
    if (!Array.isArray(uids) || uids.length === 0) return result;
    for (const uid of uids) result[String(uid)] = [];
    const placeholders = uids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT item_uid, ref FROM bot_item_links WHERE kind = 'dispatch' AND item_uid IN (${placeholders}) ORDER BY added_event ASC`,
    ).all(...uids.map(String));
    for (const row of rows) result[row.item_uid].push(row.ref);
    return result;
  }

  function list(filters = {}) {
    const { whereSql, params } = buildListWhereClause(filters);
    const limit = Math.min(Math.max(1, Number(filters.limit) || ITEM_LIMITS.listPage), ITEM_LIMITS.listPageMax);
    const rows = db.prepare(
      `SELECT i.* FROM bot_items i ${whereSql} ORDER BY i.last_activity_at DESC, i.number DESC LIMIT ?`,
    ).all(...params, limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapItemRow);
    const tail = items[items.length - 1];
    const nextCursor = hasMore && tail ? { lastActivityAt: tail.lastActivityAt, number: tail.number } : null;
    return { items, nextCursor };
  }

  function needsYou({ ownerBotId, now = Date.now(), includeSnoozed = false } = {}) {
    const clauses = ["status = 'needs_you'"];
    const params = [];
    if (ownerBotId) {
      clauses.push('owner_bot_id = ?');
      params.push(String(ownerBotId));
    }
    if (!includeSnoozed) {
      clauses.push('(snoozed_until IS NULL OR snoozed_until <= ?)');
      params.push(now);
    }
    return db.prepare(
      `SELECT * FROM bot_items WHERE ${clauses.join(' AND ')} ORDER BY last_activity_at ASC, number ASC`,
    ).all(...params).map(mapItemRow);
  }

  function viewRows({ ownerBotId, includeClosed = false, now = Date.now() } = {}) {
    const { items } = list({ ownerBotId, openOnly: !includeClosed, limit: ITEM_LIMITS.listPageMax });
    const dispatches = linkedDispatchRefs(items.map((item) => item.uid));
    return items.map((item) => ({
      ...item,
      links: links(item.uid),
      activeDispatches: dispatches[item.uid] ?? [],
      question: item.questionEvent ? mapEventRow(selectEventById.get(item.questionEvent)) : null,
      lastComment: mapEventRow(selectLatestComment.get(item.uid)),
      isSnoozed: item.snoozedUntil !== null && item.snoozedUntil > now,
    }));
  }

  function latestEventId(ownerBotId = null) {
    const row = ownerBotId ? selectLatestEventByBot.get(String(ownerBotId)) : selectLatestEventAll.get();
    return Number(row?.max_id ?? 0);
  }

  function owedMail(afterAction = 0) {
    const actions = db.prepare(
      "SELECT DISTINCT action FROM bot_item_events WHERE mail = 'owed' AND action > ? ORDER BY action ASC LIMIT 50",
    ).all(Number(afterAction) || 0).map((r) => r.action);
    if (actions.length === 0) return [];
    const placeholders = actions.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT e.*, i.owner_bot_id, i.chat_id
      FROM bot_item_events e
      JOIN bot_items i ON i.uid = e.item_uid
      WHERE e.mail = 'owed' AND e.action IN (${placeholders})
      ORDER BY e.action ASC, e.id ASC
    `).all(...actions);

    /** @type {Map<string, any>} */
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.action}\0${row.owner_bot_id}\0${row.chat_id}`;
      let group = groups.get(key);
      if (!group) {
        group = { action: row.action, ownerBotId: row.owner_bot_id, chatId: row.chat_id, itemUids: [], eventIds: [], events: [] };
        groups.set(key, group);
      }
      if (!group.itemUids.includes(row.item_uid)) group.itemUids.push(row.item_uid);
      group.eventIds.push(row.id);
      group.events.push(mapEventRow(row));
    }
    return [...groups.values()];
  }

  function needsYouCounts(bots = [], now = Date.now(), { activeDispatchRefs = null } = {}) {
    /** @type {Record<string, number>} */
    const counts = {};
    /** @type {Record<string, number>} */
    const staleCounts = {};
    /** @type {Map<string, any>} */
    const botMap = new Map();
    for (const bot of bots) {
      if (!bot?.id) continue;
      botMap.set(bot.id, bot);
      counts[bot.id] = 0;
      staleCounts[bot.id] = 0;
    }

    const openRows = db.prepare(
      "SELECT uid, owner_bot_id, status, last_activity_at, snoozed_until FROM bot_items WHERE status IN ('planned', 'working', 'needs_you')",
    ).all();
    const activeSet = activeDispatchRefs instanceof Set
      ? activeDispatchRefs
      : (Array.isArray(activeDispatchRefs) ? new Set(activeDispatchRefs) : null);
    const dispatchByUid = activeSet && activeSet.size > 0
      ? linkedDispatchRefs(openRows.filter((r) => r.status === 'working').map((r) => r.uid))
      : {};

    /** @type {number | null} */
    let nextWakeAt = null;
    const considerWake = (ts) => {
      if (ts > now && (nextWakeAt === null || ts < nextWakeAt)) nextWakeAt = ts;
    };

    const ctx = { botMap, activeSet, dispatchByUid, now };
    const acc = { counts, staleCounts, considerWake };
    for (const row of openRows) accumulateOpenItem(row, ctx, acc);

    return {
      counts,
      staleCounts,
      at: now,
      staleInMs: nextWakeAt === null ? null : nextWakeAt - now,
    };
  }

  return {
    get,
    byNumber,
    links,
    events,
    eventsBefore,
    linksTo,
    linkedDispatchRefs,
    list,
    needsYou,
    viewRows,
    latestEventId,
    owedMail,
    needsYouCounts,
  };
}
