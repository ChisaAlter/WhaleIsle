/**
 * Owed-mail consumer & startup reconciler for Bot Work Items.
 *
 * Reads pending `mail='owed'` event batches from `itemsStore.owedMail()`,
 * wakes the owning Bot session, and atomically calls `itemsStore.markMailSent(eventIds)`
 * only after delivery succeeds so restarts or concurrent triggers never double-wake.
 */

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
    const bot = botsStore?.getBot?.(group.ownerBotId) ?? null;
    if (botsStore && !bot) {
      return { status: 'skipped', reason: 'bot_not_found' };
    }
    if (bot?.paused) {
      return { status: 'skipped', reason: 'bot_paused' };
    }

    const prompt = formatOwedMailPrompt(group, itemsStore);
    if (typeof wakeBot === 'function') {
      const res = await wakeBot({
        botId: group.ownerBotId,
        chatId: group.chatId,
        group,
        prompt,
      });
      if (res && res.ok === false) {
        return { status: 'failed', error: res.error || 'wake_failed' };
      }
      return { status: 'delivered' };
    }

    const sessionId = await resolveTargetSessionId(group);
    if (!sessionId || typeof sessionRuntime?.runSingleTurn !== 'function') {
      return { status: 'failed', error: 'session_runtime_unavailable' };
    }
    const res = await sessionRuntime.runSingleTurn(sessionId, prompt, {
      botId: group.ownerBotId,
      isBackground: true,
    });
    if (res && res.ok === false) {
      return { status: 'failed', error: res.error || 'turn_failed' };
    }
    return { status: 'delivered' };
  }

  async function runReconcile({ afterAction = 0 } = {}) {
    const groups = itemsStore.owedMail(afterAction);
    let reconciledGroups = 0;
    let markedEvents = 0;
    let failedGroups = 0;
    let skippedGroups = 0;
    const errors = [];

    for (const group of groups) {
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
        const marked = itemsStore.markMailSent(group.eventIds);
        markedEvents += marked;
        reconciledGroups += 1;
        eventBus?.emit({ botIds: [group.ownerBotId], kinds: ['items', 'chats'] });
      } catch (error) {
        failedGroups += 1;
        errors.push({ action: group.action, botId: group.ownerBotId, error: String(/** @type {any} */ (error)?.message ?? error) });
      }
    }

    return {
      ok: failedGroups === 0,
      totalGroups: groups.length,
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

  return {
    reconcileOwedMail,
  };
}
