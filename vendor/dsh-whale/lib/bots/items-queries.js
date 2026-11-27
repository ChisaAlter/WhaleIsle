/**
 * Read/query operations and `needsYouCounts` computation for Bot Work Items.
 * Composed into `createItemsStore` in `items-store.js`.
 */
import {
  CLOSED_ITEM_STATUSES,
  ITEM_LIMITS,
  ITEM_STATUSES,
  OPEN_ITEM_STATUSES,
  formatEventId,
  mapEventRow,
  mapItemRow,
  parseEventId,
  parseItemCursor,
  parseLinkFilter,
  staleThresholdMs,
  validateStatus,
} from './items-validation.js';

function emptyStatusCounts() {
  return {
    planned: 0,
    working: 0,
    needs_you: 0,
    done: 0,
    canceled: 0,
  };
}

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

/**
 * Append an array-or-single equality filter on `column`.
 * Returns `true` when an explicit empty array short-circuits the query.
 * @param {string[]} clauses
 * @param {Array<string | number>} params
 * @param {unknown} listVal
 * @param {unknown} singleVal
 * @param {string} column
 */
function appendScopedIdFilter(clauses, params, listVal, singleVal, column) {
  if (Array.isArray(listVal)) {
    if (listVal.length === 0) return true;
    clauses.push(`${column} IN (SELECT value FROM json_each(?))`);
    params.push(JSON.stringify(listVal.map(String)));
    return false;
  }
  if (singleVal) {
    clauses.push(`${column} = ?`);
    params.push(String(singleVal));
  }
  return false;
}

/**
 * Resolve link filter specification from query filters.
 * @param {any} filters
 */
function resolveLinkFilterSpec(filters) {
  if (filters.link !== undefined && filters.link !== null && filters.link !== '') {
    return parseLinkFilter(filters.link);
  }
  if (filters.linkKind && filters.linkRef) {
    return { kind: String(filters.linkKind), ref: String(filters.linkRef), altPrRef: null };
  }
  return null;
}

/**
 * @param {string[]} clauses
 * @param {Array<string | number>} params
 * @param {any} linkSpec
 */
function appendLinkFilter(clauses, params, linkSpec) {
  if (!linkSpec) return;
  if (linkSpec.altPrRef) {
    clauses.push(
      "EXISTS (SELECT 1 FROM bot_item_links l WHERE l.item_uid = i.uid AND ((l.kind = 'url' AND l.ref = ?) OR (l.kind = 'pr' AND l.ref = ?)))",
    );
    params.push(linkSpec.ref, linkSpec.altPrRef);
  } else if (linkSpec.kind) {
    clauses.push(
      'EXISTS (SELECT 1 FROM bot_item_links l WHERE l.item_uid = i.uid AND l.kind = ? AND l.ref = ?)',
    );
    params.push(linkSpec.kind, linkSpec.ref);
  } else {
    clauses.push(
      'EXISTS (SELECT 1 FROM bot_item_links l WHERE l.item_uid = i.uid AND l.ref = ?)',
    );
    params.push(linkSpec.ref);
  }
}

/** @param {any} filters */
function resolveStatusList(filters) {
  if (filters.closedOnly === true) return CLOSED_ITEM_STATUSES;
  if (filters.openOnly === true) return OPEN_ITEM_STATUSES;
  if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
    return filters.statuses.map(validateStatus);
  }
  return null;
}

/**
 * Build base scope WHERE clause (bot/chat/uid/link) and full query WHERE clause
 * (adding status and pagination cursor).
 * Returns `emptyMatch: true` when an explicit array filter (`botIds`/`chatIds`/`uids`) is empty.
 * @param {any} filters
 */
function buildListWhereClauses(filters) {
  /** @type {string[]} */
  const baseClauses = [];
  /** @type {Array<string | number>} */
  const baseParams = [];

  if (appendScopedIdFilter(baseClauses, baseParams, filters.botIds, filters.ownerBotId ?? filters.botId, 'i.owner_bot_id')) {
    return { emptyMatch: true };
  }
  if (appendScopedIdFilter(baseClauses, baseParams, filters.chatIds, filters.chatId, 'i.chat_id')) {
    return { emptyMatch: true };
  }
  if (appendScopedIdFilter(baseClauses, baseParams, filters.uids, null, 'i.uid')) {
    return { emptyMatch: true };
  }

  appendLinkFilter(baseClauses, baseParams, resolveLinkFilterSpec(filters));

  const fullClauses = [...baseClauses];
  /** @type {Array<string | number>} */
  const fullParams = [...baseParams];

  const statuses = resolveStatusList(filters);
  if (statuses && statuses.length > 0) {
    fullClauses.push(`i.status IN (${statuses.map(() => '?').join(',')})`);
    fullParams.push(...statuses);
  }

  const rawCursor = filters.closedOnly === true
    ? (filters.closedCursor ?? filters.cursor)
    : (filters.cursor ?? filters.closedCursor);
  const cursor = parseItemCursor(rawCursor);
  if (cursor) {
    fullClauses.push('(i.last_activity_at < ? OR (i.last_activity_at = ? AND i.number < ?))');
    fullParams.push(cursor.lastActivityAt, cursor.lastActivityAt, cursor.number);
  }

  return {
    emptyMatch: false,
    baseWhereSql: baseClauses.length ? `WHERE ${baseClauses.join(' AND ')}` : '',
    baseParams,
    whereSql: fullClauses.length ? `WHERE ${fullClauses.join(' AND ')}` : '',
    params: fullParams,
  };
}

/** @param {any[]} rows */
function groupLinksForView(rows) {
  /** @type {Map<string, any[]>} */
  const linksByUid = new Map();
  /** @type {Map<string, string[]>} */
  const dispatchesByUid = new Map();
  for (const row of rows) {
    const uid = String(row.item_uid);
    const addedEvent = row.added_event == null ? null : Number(row.added_event);
    const listForItem = linksByUid.get(uid) ?? [];
    listForItem.push({
      kind: row.kind,
      ref: row.ref,
      addedEvent: row.added_event,
      addedEventId: formatEventId(addedEvent),
    });
    linksByUid.set(uid, listForItem);
    if (row.kind === 'dispatch') {
      const dispatches = dispatchesByUid.get(uid) ?? [];
      dispatches.push(String(row.ref));
      dispatchesByUid.set(uid, dispatches);
    }
  }
  return { linksByUid, dispatchesByUid };
}

/** @param {any[]} rows */
function groupEventsForView(rows) {
  /** @type {Map<string, any>} */
  const questionByUid = new Map();
  /** @type {Map<string, any>} */
  const lastCommentByUid = new Map();
  for (const row of rows) {
    const uid = String(row.item_uid);
    const mapped = mapEventRow(row);
    if (row._role === 'question') {
      questionByUid.set(uid, mapped);
    } else if (row._role === 'comment') {
      lastCommentByUid.set(uid, mapped);
    }
  }
  return { questionByUid, lastCommentByUid };
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createItemQueries(db) {
  const selectByUid = db.prepare('SELECT * FROM bot_items WHERE uid = ?');
  const selectByNumber = db.prepare('SELECT * FROM bot_items WHERE number = ?');
  const selectLinksStmt = db.prepare(
    'SELECT kind, ref, added_event FROM bot_item_links WHERE item_uid = ? ORDER BY added_event ASC, kind ASC, ref ASC',
  );
  const selectLatestEventAll = db.prepare('SELECT COALESCE(MAX(last_event_id), 0) AS max_id FROM bot_items');
  const selectLatestEventByBot = db.prepare(
    'SELECT COALESCE(MAX(last_event_id), 0) AS max_id FROM bot_items WHERE owner_bot_id = ?',
  );
  const selectLatestEventByBots = db.prepare(
    'SELECT COALESCE(MAX(last_event_id), 0) AS max_id FROM bot_items WHERE owner_bot_id IN (SELECT value FROM json_each(?))',
  );
  const selectItemsByUidsStmt = db.prepare(`
    SELECT i.*
    FROM bot_items i
    JOIN json_each(?) u ON u.value = i.uid
    ORDER BY i.last_activity_at DESC, i.number DESC
  `);
  const selectLinksByUidsStmt = db.prepare(`
    SELECT l.item_uid, l.kind, l.ref, l.added_event
    FROM bot_item_links l
    JOIN json_each(?) u ON u.value = l.item_uid
    ORDER BY l.added_event ASC, l.kind ASC, l.ref ASC
  `);
  const selectDispatchLinksByUidsStmt = db.prepare(`
    SELECT l.item_uid, l.ref
    FROM bot_item_links l
    JOIN json_each(?) u ON u.value = l.item_uid
    WHERE l.kind = 'dispatch'
    ORDER BY l.added_event ASC
  `);
  const selectViewEventsByUidsStmt = db.prepare(`
    WITH target_uids(uid) AS (SELECT value FROM json_each(?)),
    latest_comments AS (
      SELECT e.id, e.item_uid, e.kind, e.actor, e.data, e.mail, e.action, e.created_at,
             ROW_NUMBER() OVER (PARTITION BY e.item_uid ORDER BY e.id DESC) AS rn
      FROM bot_item_events e
      JOIN target_uids t ON t.uid = e.item_uid
      WHERE e.kind = 'commented'
    ),
    question_events AS (
      SELECT e.id, e.item_uid, e.kind, e.actor, e.data, e.mail, e.action, e.created_at
      FROM bot_item_events e
      JOIN bot_items i ON i.question_event = e.id
      JOIN target_uids t ON t.uid = i.uid
    )
    SELECT id, item_uid, kind, actor, data, mail, action, created_at, 'comment' AS _role
    FROM latest_comments WHERE rn = 1
    UNION ALL
    SELECT id, item_uid, kind, actor, data, mail, action, created_at, 'question' AS _role
    FROM question_events
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
      addedEventId: formatEventId(row.added_event == null ? null : Number(row.added_event)),
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
    const normalized = uids.map(String);
    for (const uid of normalized) result[uid] = [];
    const rows = selectDispatchLinksByUidsStmt.all(JSON.stringify(normalized));
    for (const row of rows) {
      const uid = String(row.item_uid);
      if (result[uid]) result[uid].push(String(row.ref));
    }
    return result;
  }

  function list(filters = {}) {
    const built = buildListWhereClauses(filters ?? {});
    if (built.emptyMatch) {
      return { items: [], nextCursor: null, counts: emptyStatusCounts() };
    }
    const limit = Math.min(Math.max(1, Number(filters?.limit) || ITEM_LIMITS.listPage), ITEM_LIMITS.listPageMax);
    const rows = db.prepare(
      `SELECT i.* FROM bot_items i ${built.whereSql} ORDER BY i.last_activity_at DESC, i.number DESC LIMIT ?`,
    ).all(...(built.params ?? []), limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapItemRow);
    const tail = items[items.length - 1];
    const nextCursor = hasMore && tail ? { lastActivityAt: tail.lastActivityAt, number: tail.number } : null;

    const counts = emptyStatusCounts();
    const countRows = db.prepare(
      `SELECT i.status, COUNT(*) AS cnt FROM bot_items i ${built.baseWhereSql} GROUP BY i.status`,
    ).all(...(built.baseParams ?? []));
    for (const row of countRows) {
      const status = String(row.status);
      if (/** @type {readonly string[]} */ (ITEM_STATUSES).includes(status)) {
        /** @type {Record<string, number>} */ (counts)[status] = Number(row.cnt ?? 0);
      }
    }
    return { items, nextCursor, counts };
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

  /**
   * Resolve target items and reference timestamp for `viewRows`.
   * @param {string[] | Record<string, any>} uidsOrFilters
   * @param {{ now?: number }} options
   */
  function resolveViewItems(uidsOrFilters, options) {
    if (Array.isArray(uidsOrFilters)) {
      const now = options?.now ?? Date.now();
      const uids = [...new Set(uidsOrFilters.map(String).filter(Boolean))];
      const items = uids.length === 0 ? [] : selectItemsByUidsStmt.all(JSON.stringify(uids)).map(mapItemRow);
      return { items, now };
    }
    const filters = uidsOrFilters ?? {};
    const now = filters.now ?? options?.now ?? Date.now();
    const explicitClosedOrStatuses = filters.closedOnly === true
      || (Array.isArray(filters.statuses) && filters.statuses.length > 0);
    const openOnly = filters.openOnly !== undefined
      ? filters.openOnly
      : (explicitClosedOrStatuses ? false : !filters.includeClosed);
    const items = list({
      ...filters,
      openOnly,
      limit: filters.limit ?? ITEM_LIMITS.listPageMax,
    }).items;
    return { items, now };
  }

  /**
   * Batch-hydrate view rows using `json_each(?)` (0 N+1 queries).
   * Accepts either:
   * - `viewRows(uidsArray, { now })` — hydrates specific uids in 3 batched queries
   * - `viewRows({ ownerBotId, botId, botIds, chatId, chatIds, uids, includeClosed, closedOnly, closedCursor, cursor, statuses, openOnly, link, limit, now })`
   * @param {string[] | Record<string, any>} [uidsOrFilters]
   * @param {{ now?: number }} [options]
   */
  function viewRows(uidsOrFilters = {}, options = {}) {
    const { items, now } = resolveViewItems(uidsOrFilters, options);
    if (items.length === 0) return [];

    const uidsJson = JSON.stringify(items.map((item) => item.uid));
    const { linksByUid, dispatchesByUid } = groupLinksForView(selectLinksByUidsStmt.all(uidsJson));
    const { questionByUid, lastCommentByUid } = groupEventsForView(selectViewEventsByUidsStmt.all(uidsJson));

    return items.map((item) => ({
      ...item,
      links: linksByUid.get(item.uid) ?? [],
      activeDispatches: dispatchesByUid.get(item.uid) ?? [],
      question: item.questionEvent ? (questionByUid.get(item.uid) ?? null) : null,
      lastComment: lastCommentByUid.get(item.uid) ?? null,
      isSnoozed: item.snoozedUntil !== null && item.snoozedUntil > now,
    }));
  }

  /** @param {string | string[] | null} [ownerBotId] */
  function latestEventId(ownerBotId = null) {
    if (Array.isArray(ownerBotId)) {
      if (ownerBotId.length === 0) return 0;
      const row = selectLatestEventByBots.get(JSON.stringify(ownerBotId.map(String)));
      return Number(row?.max_id ?? 0);
    }
    const row = ownerBotId ? selectLatestEventByBot.get(String(ownerBotId)) : selectLatestEventAll.get();
    return Number(row?.max_id ?? 0);
  }

  function owedMail(afterAction = 0) {
    const actions = db.prepare(`
      SELECT DISTINCT e.action
      FROM bot_item_events e
      JOIN bot_items i ON i.uid = e.item_uid
      WHERE e.mail = 'owed'
        AND e.action > ?
        AND i.status NOT IN ('done', 'canceled')
      ORDER BY e.action ASC
      LIMIT 50
    `).all(Number(afterAction) || 0).map((r) => r.action);
    if (actions.length === 0) return [];
    const rows = db.prepare(`
      SELECT e.*, i.owner_bot_id, i.chat_id
      FROM bot_item_events e
      JOIN bot_items i ON i.uid = e.item_uid
      JOIN json_each(?) a ON a.value = e.action
      WHERE e.mail = 'owed'
        AND i.status NOT IN ('done', 'canceled')
      ORDER BY e.action ASC, e.id ASC
    `).all(JSON.stringify(actions));

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
