/**
 * Serialized Work Item owed-mail formatter and drainer for `session-runtime.js`.
 * Routes owed item updates with priority:
 * `askedInConversation` -> item's associated chat -> Bot Home Chat fallback.
 */
import { isClosedStatus } from './items-validation.js';
import { buildInternalUserMessage, prunePendingItemMailFromInbox, resolveLiveAgent } from './session-work.js';

const freshSignal = () => new AbortController().signal;

/**
 * Partition events in `group` by open vs closed items, marking closed-item events `'sent'`.
 * @param {any[]} events
 * @param {number[]} eventIds
 * @param {string[]} itemUids
 * @param {Set<string>} closedUidSet
 * @param {any} store
 */
function partitionGroupEvents(events, eventIds, itemUids, closedUidSet, store) {
  /** @type {any[]} */
  const openEvents = [];
  /** @type {number[]} */
  const openEventIds = [];
  /** @type {number[]} */
  const closedEventIds = [];
  const singleUid = itemUids.length === 1 ? itemUids[0] : null;
  for (const ev of events) {
    const evUid = ev?.itemUid ?? singleUid;
    if (evUid && closedUidSet.has(evUid)) {
      if (ev?.id !== undefined) closedEventIds.push(ev.id);
    } else {
      openEvents.push(ev);
      if (ev?.id !== undefined) openEventIds.push(ev.id);
    }
  }
  if (closedEventIds.length > 0) store?.markMailSent?.(closedEventIds);
  const resolvedOpenIds = openEventIds.length > 0
    ? openEventIds
    : eventIds.filter((id) => !closedEventIds.includes(id));
  return { openEvents, openEventIds: resolvedOpenIds };
}

/**
 * Filter a mail group down to still-open items, immediately marking any closed-item
 * events `'sent'` so terminal items never stay `'owed'` or get delivered.
 * @param {any} group
 * @param {any} store
 */
export function partitionGroupByOpenItems(group, store) {
  const itemUids = Array.isArray(group?.itemUids) ? group.itemUids : [];
  const events = Array.isArray(group?.events) ? group.events : [];
  const eventIds = Array.isArray(group?.eventIds) ? group.eventIds : events.map((/** @type {any} */ e) => e.id);
  /** @type {any[]} */
  const openItems = [];
  /** @type {string[]} */
  const openItemUids = [];
  /** @type {Set<string>} */
  const closedUidSet = new Set();

  for (const uid of itemUids) {
    const item = store?.get?.(uid);
    if (!item || isClosedStatus(item.status)) closedUidSet.add(uid);
    else {
      openItemUids.push(uid);
      openItems.push(item);
    }
  }
  if (closedUidSet.size === 0) return { ...group, itemUids, events, eventIds, items: openItems };
  if (openItemUids.length === 0) {
    store?.markMailSent?.(eventIds);
    return null;
  }
  const { openEvents, openEventIds } = partitionGroupEvents(events, eventIds, itemUids, closedUidSet, store);
  if (openEvents.length === 0 && openEventIds.length === 0) return null;
  return { ...group, itemUids: openItemUids, items: openItems, events: openEvents, eventIds: openEventIds };
}

/** @param {any[]} items @param {string[]} itemUids */
function buildMailSummary(items, itemUids) {
  const first = Array.isArray(items) && items[0] ? items[0] : null;
  if (first) {
    const base = `#${first.number} ${first.title ?? ''}`.trim();
    return items.length > 1 ? `${base} (+${items.length - 1})`.slice(0, 140) : base.slice(0, 140);
  }
  return String(itemUids?.[0] ?? 'Work Item update').slice(0, 140);
}

/** @param {any} ev @param {string} actor */
function formatCommentEventLine(ev, actor) {
  const txt = String(ev.data?.text ?? '').trim();
  const filesCount = Array.isArray(ev.data?.files) ? ev.data.files.length : 0;
  const imagesCount = Array.isArray(ev.data?.images) ? ev.data.images.length : 0;
  const attach = [
    filesCount ? `${filesCount} file(s)` : '',
    imagesCount ? `${imagesCount} image(s)` : '',
  ].filter(Boolean).join(', ');
  return `- ${actor} commented${attach ? ` [${attach}]` : ''}: ${txt || '(attachment)'}`;
}

/** @param {any} actor */
function formatMailActor(actor) {
  if (actor?.kind === 'owner') return 'Owner';
  if (actor?.botId) return `Bot(${actor.botId})`;
  return actor?.kind ?? 'System';
}

/** @param {any} ev */
function formatSingleMailEventLine(ev) {
  const actor = formatMailActor(ev.actor);
  if (ev.kind === 'commented') return formatCommentEventLine(ev, actor);
  if (ev.kind === 'status') {
    const note = ev.data?.note || ev.data?.reason || '';
    return `- ${actor} changed status ${ev.data?.from ?? '?'} -> ${ev.data?.to ?? '?'}${note ? ` (${note})` : ''}`;
  }
  if (ev.kind === 'linked') {
    const refs = (ev.data?.links ?? []).map((/** @type {any} */ l) => `${l.kind}:${l.ref}`).join(', ');
    return `- ${actor} linked ${refs}`;
  }
  return `- ${actor} recorded ${ev.kind}`;
}

/** @param {any} group @param {any} store */
export function formatOwedMailPrompt(group, store) {
  const lines = ['[WhaleIsle: Work Item update]'];
  for (const uid of group.itemUids ?? []) {
    const item = store?.get?.(uid);
    const label = item ? `#${item.number} "${item.title}" (${item.status})` : uid;
    lines.push(`Item: ${label}`);
  }
  for (const ev of group.events ?? []) {
    lines.push(formatSingleMailEventLine(ev));
  }
  lines.push('Review the item update and continue or reply on the Work Item as needed.');
  return lines.join('\n');
}

/**
 * Create a serialized owed-mail drainer bound to a session runtime.
 * @param {{
 *   ctx?: any,
 *   itemsStore: any,
 *   botsStore: any,
 *   controllerOf: () => any,
 *   openHomeChat: (botId: string) => Promise<{ sessionId: string | null }>,
 *   buildControllerUnavailableRefusal: (action: string) => any,
 * }} deps
 */
export function createOwedMailDrainer(deps) {
  const { ctx = null, itemsStore, botsStore, controllerOf, openHomeChat, buildControllerUnavailableRefusal } = deps;
  /** @type {Set<number>} */
  const deliveredEventIds = new Set();
  /** @type {Promise<any> | null} */
  let activeDrain = null;
  let drainQueued = false;

  /** @param {any} group @param {any} bot @param {any} bStore */
  async function resolveMailTargetSession(group, bot, bStore) {
    const askedCandidates = (group.events ?? [])
      .map((/** @type {any} */ ev) => (typeof ev?.data?.askedInConversation === 'string' ? ev.data.askedInConversation.trim() : ''))
      .filter(Boolean);
    const askedSessionId = askedCandidates.at(-1) || '';
    if (askedSessionId) {
      const askedChat = bStore.getChat?.(askedSessionId);
      if (!askedChat || !askedChat.closedAt) {
        return { sessionId: askedSessionId, route: 'askedInConversation' };
      }
    }

    const itemChatId = String(group.chatId ?? '').trim();
    if (itemChatId) {
      const itemChat = bStore.getChat?.(itemChatId);
      if ((itemChat && !itemChat.closedAt) || bot.chatSessionId === itemChatId) {
        return { sessionId: itemChatId, route: 'itemChat' };
      }
    }

    const home = await openHomeChat(bot.id);
    return { sessionId: home.sessionId, route: 'homeFallback' };
  }

  /** @param {Map<string, any>} buckets @param {any} openGroup @param {any} bot @param {{ sessionId: string, route: string }} target */
  function mergeGroupIntoBucket(buckets, openGroup, bot, target) {
    const key = `${bot.id}\0${target.sessionId}\0${openGroup.itemUids.join(',')}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        action: Number(openGroup.action) || 0,
        ownerBotId: bot.id,
        chatId: openGroup.chatId,
        sessionId: target.sessionId,
        route: target.route,
        itemUids: [...openGroup.itemUids],
        items: [...(openGroup.items ?? [])],
        events: [],
        eventIds: [],
        seenEventIds: new Set(),
      };
      buckets.set(key, bucket);
    }
    bucket.action = Math.max(bucket.action, Number(openGroup.action) || 0);
    bucket.route = target.route;
    for (const ev of openGroup.events ?? []) {
      if (ev?.id === undefined || bucket.seenEventIds.has(ev.id) || deliveredEventIds.has(ev.id)) continue;
      bucket.seenEventIds.add(ev.id);
      bucket.events.push(ev);
      bucket.eventIds.push(ev.id);
    }
  }

  /** @param {any} store @param {any} bStore */
  async function collectCoalescedBuckets(store, bStore) {
    let afterAction = 0;
    let skippedGroups = 0;
    let deliveredEvents = 0;
    /** @type {Map<string, any>} */
    const buckets = new Map();

    for (let guard = 0; guard < 100; guard += 1) {
      const groups = store.owedMail(afterAction);
      if (!Array.isArray(groups) || groups.length === 0) break;
      let maxAction = afterAction;
      for (const group of groups) {
        const nextCursor = Number(group.action) || 0;
        if (nextCursor > maxAction) maxAction = nextCursor;
        const openGroup = partitionGroupByOpenItems(group, store);
        if (!openGroup) {
          skippedGroups += 1;
          continue;
        }
        const bot = bStore?.getBot?.(openGroup.ownerBotId);
        if (!bot || bot.paused) {
          skippedGroups += 1;
          continue;
        }
        if (openGroup.eventIds.length > 0 && openGroup.eventIds.every((/** @type {number} */ id) => deliveredEventIds.has(id))) {
          deliveredEvents += store.markMailSent(openGroup.eventIds);
          continue;
        }
        const target = await resolveMailTargetSession(openGroup, bot, bStore);
        if (!target.sessionId) {
          skippedGroups += 1;
          continue;
        }
        mergeGroupIntoBucket(buckets, openGroup, bot, target);
      }
      if (maxAction <= afterAction || groups.length < 50) break;
      afterAction = maxAction;
    }

    return { buckets: [...buckets.values()], skippedGroups, preMarkedEvents: deliveredEvents };
  }

  /** @param {any} bucket @param {{ store: any, controller: any, canPrompt: boolean, canTestTurn: boolean }} runtimeDeps */
  async function deliverSingleBucket(bucket, { store, controller, canPrompt, canTestTurn }) {
    const openBucket = partitionGroupByOpenItems(bucket, store);
    if (!openBucket || openBucket.eventIds.length === 0) {
      return { status: 'skipped', marked: 0, detail: null };
    }
    openBucket.eventIds.sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    openBucket.events.sort((/** @type {any} */ a, /** @type {any} */ b) => (a.id ?? 0) - (b.id ?? 0));

    const firstEventId = openBucket.eventIds[0];
    const requestId = `bot-item-mail-${firstEventId}`;
    const mailText = formatOwedMailPrompt(openBucket, store);
    const summary = buildMailSummary(openBucket.items, openBucket.itemUids);

    try {
      const liveAgent = await resolveLiveAgent(ctx, controller, bucket.sessionId);
      if (liveAgent) {
        prunePendingItemMailFromInbox(liveAgent, openBucket.items);
        const mailSource = {
          kind: 'dsh-bots:mail',
          form: 'notice',
          summary,
          itemUids: openBucket.itemUids,
          ...(openBucket.itemUids.length === 1 ? { itemUid: openBucket.itemUids[0] } : {}),
          eventIds: openBucket.eventIds,
          rpcId: requestId,
        };
        const msg = await buildInternalUserMessage(mailText, mailSource);
        await Promise.resolve(liveAgent.followup(msg));
      } else if (typeof controller?.resolveAgent === 'function') {
        return { status: 'skipped', marked: 0, detail: null };
      } else if (canPrompt) {
        await controller.prompt({
          requestId,
          sessionId: bucket.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: mailText }],
        }, freshSignal());
      } else if (canTestTurn) {
        await controller.runTurnForTest(bucket.sessionId, mailText);
      } else {
        return { status: 'skipped', marked: 0, detail: null };
      }

      for (const id of openBucket.eventIds) deliveredEventIds.add(id);
      const marked = store.markMailSent(openBucket.eventIds);
      return {
        status: 'delivered',
        marked,
        detail: {
          action: bucket.action,
          firstEventId,
          requestId,
          botId: bucket.ownerBotId,
          sessionId: bucket.sessionId,
          route: bucket.route,
          itemUids: openBucket.itemUids,
          eventIds: openBucket.eventIds,
        },
      };
    } catch {
      return { status: 'skipped', marked: 0, detail: null };
    }
  }

  /** @param {any} store @param {any} bStore @param {any} controller @param {{ canPrompt: boolean, canTestTurn: boolean }} caps */
  async function drainOwedMailGroups(store, bStore, controller, { canPrompt, canTestTurn }) {
    const collected = await collectCoalescedBuckets(store, bStore);
    let deliveredGroups = 0;
    let deliveredEvents = collected.preMarkedEvents;
    let skippedGroups = collected.skippedGroups;
    /** @type {any[]} */
    const details = [];

    for (const bucket of collected.buckets) {
      const outcome = await deliverSingleBucket(bucket, { store, controller, canPrompt, canTestTurn });
      if (outcome.status === 'delivered') {
        deliveredGroups += 1;
        deliveredEvents += outcome.marked;
        if (outcome.detail) details.push(outcome.detail);
      } else {
        skippedGroups += 1;
      }
    }

    return { ok: true, deliveredGroups, deliveredEvents, skippedGroups, details };
  }

  /** @param {any} targetItemsStore @param {any} targetBotsStore */
  async function deliverOwedMailOnce(targetItemsStore, targetBotsStore) {
    const store = targetItemsStore ?? itemsStore;
    const bStore = targetBotsStore ?? botsStore;
    if (!store || typeof store.owedMail !== 'function' || store.isReadOnly) {
      return { ok: true, deliveredGroups: 0, deliveredEvents: 0, skippedGroups: 0, details: /** @type {any[]} */ ([]) };
    }
    const controller = controllerOf();
    const canResolveAgent = typeof controller?.resolveAgent === 'function' || Boolean(ctx?.get?.('agents'));
    const canPrompt = typeof controller?.prompt === 'function';
    const canTestTurn = typeof controller?.runTurnForTest === 'function';
    if ((!controller && !ctx?.get?.('agents')) || (!canResolveAgent && !canPrompt && !canTestTurn)) {
      return {
        ok: false,
        error: 'session-controller-unavailable',
        refusal: buildControllerUnavailableRefusal('deliver-owed-mail'),
        deliveredGroups: 0,
        deliveredEvents: 0,
        skippedGroups: 0,
        details: /** @type {any[]} */ ([]),
      };
    }
    return drainOwedMailGroups(store, bStore, controller, { canPrompt, canTestTurn });
  }

  /** @param {{ itemsStore?: any, botsStore?: any }} [opts] */
  async function deliverOwedMail({ itemsStore: targetItemsStore = null, botsStore: targetBotsStore = null } = {}) {
    if (activeDrain) {
      drainQueued = true;
      return activeDrain;
    }
    const run = (async () => {
      /** @type {any} */
      let aggregate = { ok: true, deliveredGroups: 0, deliveredEvents: 0, skippedGroups: 0, details: [] };
      do {
        drainQueued = false;
        const pass = await deliverOwedMailOnce(targetItemsStore, targetBotsStore);
        if (!pass.ok) {
          aggregate = { ...pass, details: [...aggregate.details, ...(pass.details ?? [])] };
          break;
        }
        aggregate.deliveredGroups += pass.deliveredGroups;
        aggregate.deliveredEvents += pass.deliveredEvents;
        aggregate.skippedGroups += pass.skippedGroups;
        aggregate.details.push(...(pass.details ?? []));
      } while (drainQueued);
      return aggregate;
    })();
    activeDrain = run;
    try {
      return await run;
    } finally {
      if (activeDrain === run) activeDrain = null;
    }
  }

  function reset() {
    deliveredEventIds.clear();
  }

  return { deliverOwedMail, reset };
}
