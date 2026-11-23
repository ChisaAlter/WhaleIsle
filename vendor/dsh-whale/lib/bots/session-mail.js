/**
 * Serialized Work Item owed-mail formatter and drainer for `session-runtime.js`.
 * Routes owed item updates with priority:
 * `askedInConversation` -> item's associated chat -> Bot Home Chat fallback.
 */

const freshSignal = () => new AbortController().signal;

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
 *   itemsStore: any,
 *   botsStore: any,
 *   controllerOf: () => any,
 *   openHomeChat: (botId: string) => Promise<{ sessionId: string | null }>,
 *   buildControllerUnavailableRefusal: (action: string) => any,
 * }} deps
 */
export function createOwedMailDrainer(deps) {
  const { itemsStore, botsStore, controllerOf, openHomeChat, buildControllerUnavailableRefusal } = deps;
  /** @type {Set<number>} */
  const deliveredFirstEventIds = new Set();
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

  /** @param {any} group @param {{ store: any, bStore: any, controller: any, canPrompt: boolean }} ctx */
  async function deliverSingleGroup(group, { store, bStore, controller, canPrompt }) {
    const firstEventId = group.eventIds?.[0];
    if (firstEventId === undefined || firstEventId === null) {
      return { status: 'skipped', marked: 0, detail: null };
    }
    const bot = bStore?.getBot?.(group.ownerBotId);
    if (!bot || bot.paused) {
      return { status: 'skipped', marked: 0, detail: null };
    }

    if (deliveredFirstEventIds.has(firstEventId)) {
      const marked = store.markMailSent(group.eventIds);
      return { status: marked > 0 ? 'delivered' : 'skipped', marked, detail: null };
    }

    const { sessionId, route } = await resolveMailTargetSession(group, bot, bStore);
    if (!sessionId) {
      return { status: 'skipped', marked: 0, detail: null };
    }

    const requestId = `bot-item-mail-${firstEventId}`;
    const mailText = formatOwedMailPrompt(group, store);
    try {
      if (canPrompt) {
        await controller.prompt({
          requestId,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: mailText }],
        }, freshSignal());
      } else {
        await controller.runTurnForTest(sessionId, mailText);
      }
      deliveredFirstEventIds.add(firstEventId);
      const marked = store.markMailSent(group.eventIds);
      return {
        status: 'delivered',
        marked,
        detail: {
          action: group.action,
          firstEventId,
          requestId,
          botId: bot.id,
          sessionId,
          route,
          itemUids: group.itemUids,
          eventIds: group.eventIds,
        },
      };
    } catch {
      return { status: 'skipped', marked: 0, detail: null };
    }
  }

  /** @param {any} store @param {any} bStore @param {any} controller @param {boolean} canPrompt */
  async function drainOwedMailGroups(store, bStore, controller, canPrompt) {
    let afterAction = 0;
    let deliveredGroups = 0;
    let deliveredEvents = 0;
    let skippedGroups = 0;
    /** @type {any[]} */
    const details = [];

    for (let guard = 0; guard < 100; guard += 1) {
      const groups = store.owedMail(afterAction);
      if (!Array.isArray(groups) || groups.length === 0) break;
      let progressed = false;
      for (const group of groups) {
        const nextCursor = Number(group.action) || 0;
        if (nextCursor > afterAction) afterAction = nextCursor;
        const outcome = await deliverSingleGroup(group, { store, bStore, controller, canPrompt });
        if (outcome.status === 'delivered') {
          deliveredGroups += 1;
          deliveredEvents += outcome.marked;
          progressed = true;
          if (outcome.detail) details.push(outcome.detail);
        } else {
          skippedGroups += 1;
        }
      }
      if (!progressed && groups.length < 50) break;
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
    const canPrompt = typeof controller?.prompt === 'function';
    const canTestTurn = typeof controller?.runTurnForTest === 'function';
    if (!controller || (!canPrompt && !canTestTurn)) {
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
    return drainOwedMailGroups(store, bStore, controller, canPrompt);
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
    deliveredFirstEventIds.clear();
  }

  return { deliverOwedMail, reset };
}
