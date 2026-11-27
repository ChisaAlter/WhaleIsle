/**
 * Owed-mail consumer & startup reconciler for Bot Work Items.
 *
 * Reads pending `mail='owed'` event batches from `itemsStore.owedMail()`,
 * wakes the owning Bot session, and atomically calls `itemsStore.markMailSent(eventIds)`
 * only after delivery succeeds so restarts or concurrent triggers never double-wake.
 */

import { partitionGroupByOpenItems } from './session-mail.js';

/** @param {any} ev */
function summarizeEvent(ev) {
  const kind = String(ev?.kind ?? 'update');
  const actorKind = ev?.actor?.kind ?? 'owner';
  const data = ev?.data ?? {};
  if (kind === 'commented') {
    const text = String(data.text ?? '').trim();
    return text ? `[comment by ${actorKind}] ${text}` : `[comment by ${actorKind}] (attachment)`;
  }
  if (kind === 'status') {
    const note = data.reason || data.note || '';
    return `[status by ${actorKind}] ${data.from ?? '?'} -> ${data.to ?? '?'}${note ? ` (${note})` : ''}`;
  }
  if (kind === 'snoozed') {
    return `[snoozed by ${actorKind}] until ${data.until ? new Date(data.until).toISOString() : 'later'}`;
  }
  if (kind === 'unsnoozed') {
    return `[unsnoozed by ${actorKind}]`;
  }
  return `[${kind} by ${actorKind}]`;
}

/**
 * Build a concise wake prompt for one owed-mail batch.
 * @param {{ action: number, ownerBotId: string, chatId: string, itemUids: string[], eventIds: number[], events: any[] }} group
 * @param {any} [itemsStore]
 */
export function formatOwedMailPrompt(group, itemsStore = null) {
  const itemLines = (group.itemUids ?? []).map((uid) => {
    const item = itemsStore?.get?.(uid);
    return item ? `- #${item.number} (${uid}) "${item.title}" [${item.status}]` : `- ${uid}`;
  });
  const eventLines = (group.events ?? []).map((ev) => `- ${summarizeEvent(ev)}`);
  return [
    '[WhaleIsle: Work Item updates require your attention]',
    'Items:',
    ...itemLines,
    'Updates:',
    ...eventLines,
    'Review the updates and continue work or reply accordingly. End with NO_REPLY if no owner-facing response is needed.',
  ].join('\n');
}

/**
 * Create the owed-mail reconciler.
 * @param {{
 *   itemsStore: any,
 *   botsStore?: any,
 *   sessionRuntime: any,
 *   eventBus?: any,
 *   wakeBot?: (payload: { botId: string, chatId: string, group: any, prompt: string }) => Promise<{ ok?: boolean, error?: string } | void>,
 * }} deps
 */
export function createMailReconciler(deps) {
  const { itemsStore, botsStore = null, sessionRuntime, eventBus = null, wakeBot = null } = deps;
  if (!itemsStore) throw new Error('createMailReconciler requires itemsStore');

  /** @type {Promise<any> | null} */
  let inflight = null;

  /** @param {any} group */
  async function resolveTargetSessionId(group) {
    const explicit = String(group.chatId ?? '').trim();
    if (explicit && !explicit.startsWith('bot-budget:')) return explicit;
    if (typeof sessionRuntime?.openHomeChat === 'function') {
      const opened = await sessionRuntime.openHomeChat(group.ownerBotId);
      if (opened?.sessionId) return opened.sessionId;
    }
    return explicit || null;
  }

  /** @param {any} group */
  async function deliverGroup(group) {
    const openGroup = partitionGroupByOpenItems(group, itemsStore);
    if (!openGroup) {
      return { status: 'skipped', reason: 'item_closed', eventIds: [] };
    }
    const bot = botsStore?.getBot?.(openGroup.ownerBotId) ?? null;
    if (botsStore && !bot) {
      return { status: 'skipped', reason: 'bot_not_found', eventIds: [] };
    }
    if (bot?.paused) {
      return { status: 'skipped', reason: 'bot_paused', eventIds: [] };
    }

    const prompt = formatOwedMailPrompt(openGroup, itemsStore);
    if (typeof wakeBot === 'function') {
      const res = await wakeBot({
        botId: openGroup.ownerBotId,
        chatId: openGroup.chatId,
        group: openGroup,
        prompt,
      });
      if (res && res.ok === false) {
        return { status: 'failed', error: res.error || 'wake_failed' };
      }
      return { status: 'delivered', eventIds: openGroup.eventIds };
    }

    const sessionId = await resolveTargetSessionId(openGroup);
    if (!sessionId || typeof sessionRuntime?.runSingleTurn !== 'function') {
      return { status: 'failed', error: 'session_runtime_unavailable' };
    }
    const res = await sessionRuntime.runSingleTurn(sessionId, prompt, {
      botId: openGroup.ownerBotId,
      isBackground: true,
      sourceKind: 'dsh-bots:mail',
      source: {
        kind: 'dsh-bots:mail',
        form: 'notice',
        action: openGroup.action,
        itemUids: openGroup.itemUids,
        ...(openGroup.itemUids.length === 1 ? { itemUid: openGroup.itemUids[0] } : {}),
        eventIds: openGroup.eventIds,
      },
    });
    if (res && res.ok === false) {
      return { status: 'failed', error: res.error || 'turn_failed' };
    }
    return { status: 'delivered', eventIds: openGroup.eventIds };
  }

  async function runReconcile({ afterAction = 0 } = {}) {
    let cursor = Number(afterAction) || 0;
    let totalGroups = 0;
    let reconciledGroups = 0;
    let markedEvents = 0;
    let failedGroups = 0;
    let skippedGroups = 0;
    const errors = [];

    for (let guard = 0; guard < 100; guard += 1) {
      const groups = itemsStore.owedMail(cursor);
      if (!Array.isArray(groups) || groups.length === 0) break;
      totalGroups += groups.length;
      const seenActions = new Set();
      let maxAction = cursor;

      for (const group of groups) {
        const action = Number(group.action) || 0;
        seenActions.add(action);
        if (action > maxAction) maxAction = action;
        try {
          const outcome = await deliverGroup(group);
          if (outcome.status === 'skipped') {
            skippedGroups += 1;
            continue;
          }
          if (outcome.status !== 'delivered') {
            failedGroups += 1;
            errors.push({ action: group.action, botId: group.ownerBotId, error: outcome.error });
            continue;
          }
          const marked = itemsStore.markMailSent(outcome.eventIds ?? group.eventIds);
          markedEvents += marked;
          reconciledGroups += 1;
          eventBus?.emit({ botIds: [group.ownerBotId], kinds: ['items', 'chats'] });
        } catch (error) {
          failedGroups += 1;
          errors.push({ action: group.action, botId: group.ownerBotId, error: String(/** @type {any} */ (error)?.message ?? error) });
        }
      }

      if (maxAction <= cursor || seenActions.size < 50) break;
      cursor = maxAction;
    }

    return {
      ok: failedGroups === 0,
      totalGroups,
      reconciledGroups,
      markedEvents,
      failedGroups,
      skippedGroups,
      errors,
    };
  }

  function reconcileOwedMail(options = {}) {
    if (inflight) return inflight;
    inflight = runReconcile(options).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  if (typeof wakeBot === 'function' && typeof sessionRuntime?.registerCustomMailReconciler === 'function') {
    sessionRuntime.registerCustomMailReconciler(() => reconcileOwedMail());
  }

  return {
    reconcileOwedMail,
  };
}
