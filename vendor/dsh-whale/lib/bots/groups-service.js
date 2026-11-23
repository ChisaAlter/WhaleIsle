/**
 * Multi-Bot Group Chat runtime service.
 * Combines `groups-store.js` (6 SQLite tables) with Orca's shared mention parser,
 * target resolver, and <=24KB `<quoted_room_history>` builder from `src/shared/bot-groups.js`.
 *
 * Enhancements:
 * - Per-group serialized operation queue eliminating send/update/stop/handoff races
 * - Startup crash recovery (`resumePending`) + dead `Starting…` turn cleanup
 * - Real in-flight turn cancellation in `stop()` via `sessionRuntime.cancelSession`
 * - Anti-injection `<quoted_room_history>` group turn prompt with Home-history isolation
 * - Bot-to-bot `@Name` mention handoffs (ignoring fenced/inline code & blockquotes,
 *   idempotent `handoff:<opId>:<botId>`, mention-centered excerpt window, handoff metadata)
 */
import crypto from 'node:crypto';
import {
  BOT_GROUP_MEMBER_SESSION_PREFIX,
  buildQuotedRoomHistory,
  isQuietResult,
  resolveGroupTargets,
  stripQuietMarker,
  suggestGroupName,
} from '../../src/shared/index.js';
import { isStoppedAt } from './groups-store.js';
import { BOT_OWNER_GROUP_MEMBER } from './session-runtime.js';
import {
  DEAD_TURN_STATUSES,
  HANDOFF_EXCERPT_AFTER,
  HANDOFF_EXCERPT_BEFORE,
  HANDOFF_EXCERPT_LIMIT,
  buildGroupTurnPrompt,
  buildHandoffTurnAndPlan,
  createGroupOpQueue,
  enrichGroupRecord,
  excerptAroundMention,
  extractHandoffMentions,
  markTurnStopped,
  maskGroupHandoffProse,
  memberSessionKey,
  normalizeGroupTurnOutcome,
  parsePendingContext,
  shouldDiscardPending,
  sweepDeadTurnsInMessages,
  toSharedGroupShape,
  updateMessageTurn,
} from './groups-handoff.js';

export {
  HANDOFF_EXCERPT_AFTER,
  HANDOFF_EXCERPT_BEFORE,
  HANDOFF_EXCERPT_LIMIT,
  buildGroupTurnPrompt,
  excerptAroundMention,
  extractHandoffMentions,
  maskGroupHandoffProse,
};

/**
 * Create the multi-bot groups runtime service.
 * @param {{
 *   botsStore: any,
 *   groupsStore: any,
 *   sessionRuntime: any,
 *   eventBus: any,
 * }} deps
 */
export function createGroupsService(deps) {
  const { botsStore, groupsStore, sessionRuntime, eventBus } = deps;

  const enqueueGroupOp = createGroupOpQueue();
  /** @type {Map<string, { operationId: string, groupId: string, botId: string, sessionId: string, messageId: string, rootSequence: number }>} */
  const activeTurns = new Map();

  /** @param {any} group */
  const enrichGroup = (group) => enrichGroupRecord(group, botsStore);

  function list() {
    return groupsStore.listGroups().map(enrichGroup);
  }

  function create(params = {}) {
    const botIds = Array.isArray(params.botIds) ? params.botIds : [];
    const memberBots = botIds.map((/** @type {string} */ id) => botsStore.getBot(id)).filter(Boolean);
    if (memberBots.length < 2) {
      throw Object.assign(new Error('A group requires at least 2 existing bots'), { code: 'invalid_argument' });
    }
    const name = String(params.name ?? '').trim()
      || suggestGroupName(memberBots.map((/** @type {any} */ b) => b.name))
      || 'Bot Group';
    const created = groupsStore.createGroup({
      id: params.id,
      name,
      botIds: memberBots.map((/** @type {any} */ b) => b.id),
      replyMode: params.replyMode,
      avatar: params.avatar ?? null,
      avatarColor: params.avatarColor ?? null,
    });
    eventBus.emit({ kinds: ['groups'] });
    return enrichGroup(created);
  }

  function update(params = {}) {
    const id = String(params.groupId ?? params.id ?? '').trim();
    if (!id) throw Object.assign(new Error('groupId is required'), { code: 'invalid_argument' });
    return enqueueGroupOp(id, () => {
      const patch = {};
      for (const key of ['name', 'botIds', 'replyMode', 'avatar', 'avatarColor']) {
        if (params[key] !== undefined) patch[key] = params[key];
      }
      const updated = groupsStore.updateGroup(id, patch, {
        expectedRevision: params.expectedRevision ?? params.revision,
        frozenItemsByBot: params.frozenItemsByBot,
      });
      eventBus.emit({ kinds: ['groups'] });
      return enrichGroup(updated);
    });
  }

  function remove(params = {}) {
    const id = typeof params === 'string' ? params : String(params?.groupId ?? params?.id ?? '');
    if (!id) return Promise.resolve({ deleted: false });
    return enqueueGroupOp(id, async () => {
      await cancelActiveTurnsForGroup(id, null);
      const deleted = groupsStore.deleteGroup(id);
      if (deleted) eventBus.emit({ kinds: ['groups'] });
      return { deleted };
    });
  }

  function reorder(orderedIds) {
    const listRes = groupsStore.reorderGroups(orderedIds).map(enrichGroup);
    eventBus.emit({ kinds: ['groups'] });
    return listRes;
  }

  /**
   * Sweep stale `Starting…` / `running` turns that have neither a pending row
   * nor an active in-process turn (orphaned after a crash/restart).
   * @param {string} groupId
   * @param {string} [threadId]
   */
  function cleanupDeadTurnsInThread(groupId, threadId = '') {
    const pendingOps = new Set(groupsStore.listPending(groupId).map((/** @type {any} */ p) => p.operationId));
    const page = groupsStore.readMessages(groupId, { threadId, limit: 80 });
    const cleaned = sweepDeadTurnsInMessages(groupsStore, page.messages, activeTurns, pendingOps);
    if (cleaned > 0) eventBus.emit({ kinds: ['groups'] });
    return cleaned;
  }

  function read(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    const group = groupsStore.getGroup(groupId);
    if (!group) throw Object.assign(new Error(`Group not found: ${groupId}`), { code: 'not_found' });
    const threadId = params.threadId ?? '';
    cleanupDeadTurnsInThread(groupId, threadId);
    const page = groupsStore.readMessages(groupId, {
      threadId,
      beforeSequence: params.beforeSequence ?? null,
      afterSequence: params.afterSequence ?? null,
      limit: params.limit ?? 40,
    });
    return { group: enrichGroup(group), ...page };
  }

  function newThread(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    if (!groupId) throw Object.assign(new Error('groupId is required'), { code: 'invalid_argument' });
    return enqueueGroupOp(groupId, () => {
      const res = groupsStore.createThread(groupId, {
        threadId: params.threadId,
        title: params.title ?? null,
      });
      eventBus.emit({ kinds: ['groups'] });
      return { group: enrichGroup(res.group), thread: res.thread };
    });
  }

  async function ensureMemberSession(group, bot, threadId) {
    const key = memberSessionKey(bot.id, threadId);
    let sessionId = group.memberSessionIds?.[key];
    if (!sessionId) {
      sessionId = `${BOT_GROUP_MEMBER_SESSION_PREFIX}${crypto.randomUUID()}`;
      const started = await sessionRuntime.startSideChat(bot.id, {
        sessionId,
        title: `${group.name} · ${bot.name}`,
        kind: 'group-member',
        origin: 'group',
        owner: BOT_OWNER_GROUP_MEMBER,
      });
      sessionId = started.sessionId;
      groupsStore.updateGroup(group.id, {
        memberSessionIds: { [key]: sessionId },
      });
    }
    return sessionId;
  }

  /** @param {string} groupId @param {string} threadId @param {string} messageId */
  function findMessageById(groupId, threadId, messageId) {
    const page = groupsStore.readMessages(groupId, { threadId, limit: 200 });
    return page.messages.find((/** @type {any} */ m) => m.id === messageId) ?? null;
  }

  /**
   * Cancel active in-flight `runSingleTurn` sessions for a group (optionally scoped to one bot).
   * @param {string} groupId
   * @param {string | null} botId
   */
  async function cancelActiveTurnsForGroup(groupId, botId) {
    /** @type {Set<string>} */
    const sessionsToCancel = new Set();
    /** @type {Array<{ operationId: string, messageId: string }>} */
    const matchingTurns = [];

    for (const active of activeTurns.values()) {
      if (active.groupId !== groupId) continue;
      if (botId && active.botId !== botId) continue;
      if (active.sessionId) sessionsToCancel.add(active.sessionId);
      matchingTurns.push({ operationId: active.operationId, messageId: active.messageId });
    }

    for (const item of matchingTurns) {
      markTurnStopped(groupsStore, item.messageId, item.operationId, { onlyIfDead: true });
    }

    /** @type {string[]} */
    const cancelledSessionIds = [];
    const cancelFn = typeof sessionRuntime.cancelSession === 'function'
      ? (/** @type {string} */ sid) => sessionRuntime.cancelSession(sid)
      : (typeof sessionRuntime.cancel === 'function' ? (/** @type {string} */ sid) => sessionRuntime.cancel(sid) : null);

    if (cancelFn) {
      for (const sid of sessionsToCancel) {
        try {
          await cancelFn(sid);
          cancelledSessionIds.push(sid);
        } catch {
          // Best-effort cancellation; stop watermark still protects state.
        }
      }
    }
    return cancelledSessionIds;
  }

  /**
   * Schedule idempotent `@Name` mention handoffs triggered by a member bot's reply.
   * @param {{
   *   groupId: string,
   *   threadId: string,
   *   ownerMessage: any,
   *   senderBot: any,
   *   sourceOperationId: string,
   *   cleanReply: string,
   * }} args
   * @returns {Promise<any[]>}
   */
  async function scheduleMentionHandoffs({
    groupId,
    threadId,
    ownerMessage,
    senderBot,
    sourceOperationId,
    cleanReply,
  }) {
    const groupSnapshot = groupsStore.getGroup(groupId);
    if (!groupSnapshot) return [];
    const memberBots = (groupSnapshot.botIds ?? [])
      .map((/** @type {string} */ id) => botsStore.getBot(id))
      .filter(Boolean);
    const mentioned = extractHandoffMentions(cleanReply, memberBots, senderBot.id);
    if (mentioned.length === 0) return [];

    const rootRequestId = ownerMessage.rootRequestId || ownerMessage.id;
    const rootSequence = ownerMessage.sequence;

    const plans = await enqueueGroupOp(groupId, async () => {
      const latestGroup = groupsStore.getGroup(groupId);
      if (!latestGroup) return [];
      const currentMsg = findMessageById(groupId, threadId, ownerMessage.id) ?? ownerMessage;
      const existingTurns = Array.isArray(currentMsg.turns) ? currentMsg.turns : [];
      const existingOpIds = new Set(existingTurns.map((/** @type {any} */ t) => t.operationId));
      const alreadyTargetedBotIds = new Set(existingTurns.map((/** @type {any} */ t) => t.botId));

      const historyNow = groupsStore.readMessages(groupId, { threadId, limit: 40 }).messages;
      /** @type {any[]} */
      const nextPlans = [];
      /** @type {any[]} */
      const newTurnsMeta = [];

      for (const hit of mentioned) {
        const targetBotId = hit.botId;
        if (!(latestGroup.botIds ?? []).includes(targetBotId)) continue;
        const targetBot = botsStore.getBot(targetBotId);
        if (!targetBot || targetBot.paused) continue;
        if (isStoppedAt(latestGroup, targetBotId, rootSequence)) continue;

        const handoffOpId = `handoff:${sourceOperationId}:${targetBotId}`;
        if (existingOpIds.has(handoffOpId)) continue;
        if (alreadyTargetedBotIds.has(targetBotId)) continue;

        const sessionId = await ensureMemberSession(groupsStore.getGroup(groupId), targetBot, threadId);
        const excerpt = excerptAroundMention(cleanReply, hit.start, hit.end);
        const quotedHistory = buildQuotedRoomHistory(historyNow, null, { botId: targetBot.id, sessionId });
        const built = buildHandoffTurnAndPlan({
          senderBot,
          targetBot,
          sourceOperationId,
          handoffOpId,
          sessionId,
          rootRequestId,
          rootSequence,
          excerpt,
          quotedHistory,
        });

        existingOpIds.add(handoffOpId);
        alreadyTargetedBotIds.add(targetBotId);
        newTurnsMeta.push(built.turnMeta);
        nextPlans.push(built.plan);
      }

      if (newTurnsMeta.length > 0) {
        groupsStore.updateMessage(ownerMessage.id, (/** @type {any} */ msg) => ({
          ...msg,
          rootRequestId,
          turns: [...(msg.turns ?? []), ...newTurnsMeta],
        }));
        for (const plan of nextPlans) {
          groupsStore.enqueuePending(plan.operationId, groupId, {
            messageId: ownerMessage.id,
            rootRequestId,
            rootSequence,
            botId: plan.bot.id,
            sessionId: plan.sessionId,
            threadId,
            quotedHistory: plan.quotedHistory,
            triggerText: plan.triggerText,
            authorName: plan.authorName,
            handoff: plan.handoff,
          });
        }
        eventBus.emit({ kinds: ['groups'] });
      }
      return nextPlans;
    });

    if (plans.length === 0) return [];
    const latestMessage = findMessageById(groupId, threadId, ownerMessage.id) ?? ownerMessage;
    /** @type {Promise<any>[]} */
    const jobs = plans.map((plan) => driveMemberReply({
      groupId,
      threadId,
      ownerMessage: latestMessage,
      bot: plan.bot,
      sessionId: plan.sessionId,
      operationId: plan.operationId,
      quotedHistory: plan.quotedHistory,
      triggerText: plan.triggerText,
      authorName: plan.authorName,
      handoff: plan.handoff,
    }).catch(() => null));
    return Promise.all(jobs);
  }

  /**
   * Mark a member turn stopped and broadcast groups refresh.
   * @param {string} messageId
   * @param {string} operationId
   * @param {string} botId
   */
  function finishStoppedMemberTurn(messageId, operationId, botId) {
    markTurnStopped(groupsStore, messageId, operationId);
    eventBus.emit({ kinds: ['groups'] });
    return { botId, stopped: true };
  }

  /**
   * Execute a single session turn while tracking activeTurns and pending cleanup.
   * @param {{ operationId: string, groupId: string, botId: string, sessionId: string, ownerMessage: any, prompt: string }} ctx
   */
  async function executeTrackedGroupTurn({ operationId, groupId, botId, sessionId, ownerMessage, prompt }) {
    activeTurns.set(operationId, {
      operationId,
      groupId,
      botId,
      sessionId,
      messageId: ownerMessage.id,
      rootSequence: ownerMessage.sequence,
    });
    try {
      return await sessionRuntime.runSingleTurn(sessionId, prompt, { timeoutMs: 120_000 });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), reply: '' };
    } finally {
      activeTurns.delete(operationId);
      groupsStore.deletePending(operationId);
    }
  }

  /**
   * @param {{
   *   groupId: string,
   *   threadId: string,
   *   ownerMessage: any,
   *   bot: any,
   *   sessionId: string,
   *   operationId: string,
   *   quotedHistory: string,
   *   triggerText?: string | null,
   *   authorName?: string | null,
   *   handoff?: any,
   * }} args
   * @returns {Promise<any>}
   */
  async function driveMemberReply({
    groupId,
    threadId,
    ownerMessage,
    bot,
    sessionId,
    operationId,
    quotedHistory,
    triggerText = null,
    authorName = null,
    handoff = null,
  }) {
    const groupNow = groupsStore.getGroup(groupId);
    if (!groupNow || isStoppedAt(groupNow, bot.id, ownerMessage.sequence)) {
      groupsStore.deletePending(operationId);
      return finishStoppedMemberTurn(ownerMessage.id, operationId, bot.id);
    }

    const teammateNames = (groupNow.botIds ?? [])
      .filter((/** @type {string} */ id) => id !== bot.id)
      .map((/** @type {string} */ id) => botsStore.getBot(id)?.name)
      .filter(Boolean);

    const prompt = buildGroupTurnPrompt({
      groupName: groupNow.name ?? groupId,
      botName: bot.name,
      teammateNames,
      quotedHistory,
      authorName: authorName ?? ownerMessage.authorName ?? 'Owner',
      messageText: triggerText ?? ownerMessage.text ?? '',
      handoff,
    });

    const turn = await executeTrackedGroupTurn({
      operationId,
      groupId,
      botId: bot.id,
      sessionId,
      ownerMessage,
      prompt,
    });

    const latestGroup = groupsStore.getGroup(groupId);
    if (!latestGroup || isStoppedAt(latestGroup, bot.id, ownerMessage.sequence)) {
      return finishStoppedMemberTurn(ownerMessage.id, operationId, bot.id);
    }

    const outcome = normalizeGroupTurnOutcome(turn);
    updateMessageTurn(groupsStore, ownerMessage.id, operationId, (t) => ({
      ...t,
      status: outcome.status,
      reply: outcome.reply,
      error: outcome.error,
      finishedAt: Date.now(),
    }));
    if (outcome.status === 'done' && outcome.cleanReply) {
      groupsStore.updateSidebarLatest(groupId, {
        authorName: bot.name,
        text: outcome.cleanReply,
        at: Date.now(),
        sequence: ownerMessage.sequence,
        tie: 1,
      });
    }
    eventBus.emit({ kinds: ['groups'] });

    const handoffs = outcome.status === 'done' && outcome.cleanReply
      ? await scheduleMentionHandoffs({
        groupId,
        threadId,
        ownerMessage,
        senderBot: bot,
        sourceOperationId: operationId,
        cleanReply: outcome.cleanReply,
      })
      : [];

    return { botId: bot.id, status: outcome.status, reply: outcome.cleanReply, handoffs };
  }

  /** @param {Record<string, any>} [params] */
  async function send(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    const threadId = String(params.threadId ?? '').trim();
    const text = String(params.text ?? '').trim();
    const images = Array.isArray(params.images) ? params.images.slice(0, 20) : [];
    if (!text && images.length === 0) {
      throw Object.assign(new Error('Message text or images are required'), { code: 'invalid_argument' });
    }

    const prepared = await enqueueGroupOp(groupId, async () => {
      const group = groupsStore.getGroup(groupId);
      if (!group) throw Object.assign(new Error(`Group not found: ${groupId}`), { code: 'not_found' });

      const allBots = botsStore.listBots();
      const sharedShape = toSharedGroupShape(group, threadId);
      const targetBotIds = resolveGroupTargets(text, sharedShape, allBots);
      const activeTargets = targetBotIds
        .map((/** @type {string} */ id) => botsStore.getBot(id))
        .filter((/** @type {any} */ bot) => bot && !bot.paused);

      const historyBefore = groupsStore.readMessages(groupId, { threadId, limit: 40 }).messages;
      const msgId = params.messageId || crypto.randomUUID();
      const rootRequestId = params.rootRequestId || msgId;
      const turnsMeta = [];
      const dispatchPlans = [];
      for (const bot of activeTargets) {
        const sessionId = await ensureMemberSession(groupsStore.getGroup(groupId), bot, threadId);
        const opId = `gop-${crypto.randomUUID()}`;
        const quotedHistory = buildQuotedRoomHistory(historyBefore, null, { botId: bot.id, sessionId });
        turnsMeta.push({
          operationId: opId,
          botId: bot.id,
          botName: bot.name,
          sessionId,
          status: 'running',
          reply: null,
          rootRequestId,
        });
        dispatchPlans.push({ bot, sessionId, operationId: opId, quotedHistory });
      }

      const appended = groupsStore.appendMessage(groupId, {
        id: msgId,
        rootRequestId,
        threadId,
        author: { kind: 'owner' },
        authorName: String(params.authorName ?? '你'),
        text,
        images,
        targetBotIds: activeTargets.map((b) => b.id),
        turns: turnsMeta,
      }, { operationId: dispatchPlans[0]?.operationId ?? null });

      if (appended.deduplicated) {
        return { appended, dispatchPlans: [], targetBotIds: activeTargets.map((b) => b.id), deduplicated: true };
      }

      for (const plan of dispatchPlans) {
        groupsStore.enqueuePending(plan.operationId, groupId, {
          messageId: appended.message.id,
          rootRequestId,
          rootSequence: appended.message.sequence,
          botId: plan.bot.id,
          sessionId: plan.sessionId,
          threadId,
          quotedHistory: plan.quotedHistory,
          triggerText: text,
          authorName: appended.message.authorName,
        });
      }
      eventBus.emit({ kinds: ['groups'] });
      return { appended, dispatchPlans, targetBotIds: activeTargets.map((b) => b.id), deduplicated: false };
    });

    if (prepared.deduplicated) {
      return { message: prepared.appended.message, deduplicated: true, targetBotIds: prepared.targetBotIds };
    }

    const jobs = prepared.dispatchPlans.map((plan) => driveMemberReply({
      groupId,
      threadId,
      ownerMessage: prepared.appended.message,
      bot: plan.bot,
      sessionId: plan.sessionId,
      operationId: plan.operationId,
      quotedHistory: plan.quotedHistory,
    }).catch(() => null));

    if (params.waitForReplies === true) {
      await Promise.all(jobs);
      const refreshed = findMessageById(groupId, threadId, prepared.appended.message.id) ?? prepared.appended.message;
      return { message: refreshed, deduplicated: false, targetBotIds: prepared.targetBotIds };
    }
    return { message: prepared.appended.message, deduplicated: false, targetBotIds: prepared.targetBotIds };
  }

  /**
   * Deliver an automation summary into a group room as a bot post.
   * @param {{ groupId: string, threadId?: string, botId: string, automation: any, text: string }} params
   */
  async function postAutomationResult({ groupId, threadId = '', botId, automation, text }) {
    const cleanGroupId = String(groupId ?? '').trim();
    const bot = botsStore.getBot(botId);
    if (!cleanGroupId || !bot) return null;
    return enqueueGroupOp(cleanGroupId, () => {
      const group = groupsStore.getGroup(cleanGroupId);
      if (!group) return null;
      const appended = groupsStore.appendMessage(cleanGroupId, {
        id: crypto.randomUUID(),
        threadId: String(threadId ?? ''),
        author: { kind: 'bot', id: bot.id, name: bot.name },
        authorBotId: bot.id,
        authorName: bot.name,
        text: String(text ?? ''),
        automation: { id: automation?.id ?? null, name: automation?.name ?? 'Automation' },
        turns: [],
      });
      eventBus.emit({ kinds: ['groups'] });
      return appended;
    });
  }

  /**
   * Run an automation directly inside a member bot's group-room session.
   * @param {{ groupId: string, threadId?: string, botId: string, automation: any, prompt: string }} params
   */
  async function runAutomationInGroup({ groupId, threadId = '', botId, automation, prompt }) {
    const cleanGroupId = String(groupId ?? '').trim();
    const bot = botsStore.getBot(botId);
    if (!cleanGroupId || !bot) {
      throw Object.assign(new Error('Invalid group or bot for automation'), { code: 'invalid_argument' });
    }
    const sessionId = await enqueueGroupOp(cleanGroupId, async () => {
      const group = groupsStore.getGroup(cleanGroupId);
      if (!group) throw Object.assign(new Error(`Group not found: ${cleanGroupId}`), { code: 'not_found' });
      return ensureMemberSession(group, bot, String(threadId ?? ''));
    });
    const turn = await sessionRuntime.runSingleTurn(sessionId, prompt, { timeoutMs: 120_000 });
    const rawReply = String(turn?.reply ?? '').trim();
    const quiet = Boolean(turn?.ok) && isQuietResult(rawReply);
    const cleanReply = quiet ? stripQuietMarker(rawReply).trim() : rawReply;
    if (turn?.ok && !quiet && cleanReply) {
      await postAutomationResult({ groupId: cleanGroupId, threadId, botId: bot.id, automation, text: cleanReply });
    }
    return { ...turn, sessionId };
  }

  /**
   * Locate the owner message backing a pending delivery record.
   * @param {string} groupId
   * @param {string} threadId
   * @param {any} pending
   */
  function findPendingOwnerMessage(groupId, threadId, pending) {
    const ctx = pending.context ?? {};
    const direct = ctx.messageId
      ? findMessageById(groupId, threadId, ctx.messageId)
      : groupsStore.getMessageByOperation(pending.operationId);
    if (direct) return direct;
    const page = groupsStore.readMessages(groupId, { threadId, limit: 80 });
    return page.messages.find((/** @type {any} */ m) => (
      (m.turns ?? []).some((/** @type {any} */ t) => t.operationId === pending.operationId)
    )) ?? null;
  }

  /**
   * Sweep dead turns across all threads of one group.
   * @param {any} group
   * @param {Set<string>} pendingIds
   */
  function sweepGroupDeadTurns(group, pendingIds) {
    const threads = Array.isArray(group.threads) && group.threads.length > 0
      ? group.threads.map((/** @type {any} */ t) => t.id ?? '')
      : [''];
    let cleaned = 0;
    for (const tid of threads) {
      const page = groupsStore.readMessages(group.id, { threadId: tid, limit: 80 });
      cleaned += sweepDeadTurnsInMessages(groupsStore, page.messages, activeTurns, pendingIds);
    }
    return cleaned;
  }

  /**
   * Validate and launch one pending delivery item, or discard it if stale/stopped.
   * @param {any} group
   * @param {any} pending
   */
  async function resumeOnePending(group, pending) {
    const parsed = parsePendingContext(pending);
    const bot = parsed.botId ? botsStore.getBot(parsed.botId) : null;
    const latestGroup = groupsStore.getGroup(group.id);
    const ownerMessage = findPendingOwnerMessage(group.id, parsed.threadId, pending);
    const seq = parsed.rootSequence ?? (ownerMessage?.sequence ?? 0);
    const turnEntry = ownerMessage?.turns?.find((/** @type {any} */ t) => t.operationId === pending.operationId) ?? null;

    if (shouldDiscardPending({ latestGroup, ownerMessage, bot, seq, turnEntry, isStoppedAt })) {
      groupsStore.deletePending(pending.operationId);
      if (ownerMessage && turnEntry && DEAD_TURN_STATUSES.has(turnEntry.status)) {
        markTurnStopped(groupsStore, ownerMessage.id, pending.operationId);
      }
      return { kind: 'discarded' };
    }
    if (activeTurns.has(pending.operationId)) return { kind: 'active' };

    const sessionId = parsed.sessionId
      || await enqueueGroupOp(group.id, () => ensureMemberSession(groupsStore.getGroup(group.id), bot, parsed.threadId));
    const quotedHistory = parsed.quotedHistory
      ?? buildQuotedRoomHistory(groupsStore.readMessages(group.id, { threadId: parsed.threadId, limit: 40 }).messages, null, { botId: bot.id, sessionId });

    const job = driveMemberReply({
      groupId: group.id,
      threadId: parsed.threadId,
      ownerMessage,
      bot,
      sessionId,
      operationId: pending.operationId,
      quotedHistory,
      triggerText: parsed.triggerText,
      authorName: parsed.authorName,
      handoff: parsed.handoff,
    }).catch(() => null);
    return { kind: 'resumed', operationId: pending.operationId, job };
  }

  /**
   * Recover interrupted `bot_group_pending` deliveries on startup and clear dead
   * `Starting…` turns orphaned from a previous crash.
   * @param {{ waitForReplies?: boolean }} [options]
   */
  async function resumePending({ waitForReplies = false } = {}) {
    const groups = groupsStore.listGroups();
    /** @type {Promise<any>[]} */
    const jobs = [];
    /** @type {string[]} */
    const resumedOperations = [];
    let cleanedDeadCount = 0;
    let discardedCount = 0;

    for (const group of groups) {
      const pendingList = groupsStore.listPending(group.id);
      const pendingIds = new Set(pendingList.map((/** @type {any} */ p) => p.operationId));
      cleanedDeadCount += sweepGroupDeadTurns(group, pendingIds);

      for (const pending of pendingList) {
        const res = await resumeOnePending(group, pending);
        if (res.kind === 'discarded') {
          discardedCount += 1;
        } else if (res.kind === 'resumed' && res.operationId && res.job) {
          resumedOperations.push(res.operationId);
          jobs.push(res.job);
        }
      }
    }

    if (cleanedDeadCount > 0 || discardedCount > 0 || resumedOperations.length > 0) {
      eventBus.emit({ kinds: ['groups'] });
    }
    if (waitForReplies && jobs.length > 0) {
      await Promise.all(jobs);
    }

    return {
      resumedCount: resumedOperations.length,
      cleanedDeadCount,
      discardedCount,
      operations: resumedOperations,
    };
  }

  function stop(params = {}) {
    const rawParams = typeof params === 'string' ? { groupId: params } : (params ?? {});
    const groupId = String(rawParams.groupId ?? rawParams.id ?? '').trim();
    if (!groupId) throw Object.assign(new Error('groupId is required'), { code: 'invalid_argument' });
    const botId = rawParams.botId ? String(rawParams.botId).trim() : null;
    const threadId = rawParams.threadId ?? '';

    return enqueueGroupOp(groupId, async () => {
      const latestMsgs = groupsStore.readMessages(groupId, { threadId, limit: 1 }).messages;
      const seq = Number.isInteger(rawParams.sequence) ? rawParams.sequence : (latestMsgs.at(-1)?.sequence ?? 0);
      const updated = groupsStore.setStoppedThrough(groupId, { botId, sequence: seq });
      if (botId) {
        groupsStore.clearPendingForBot(groupId, botId);
      } else {
        for (const p of groupsStore.listPending(groupId)) groupsStore.deletePending(p.operationId);
      }
      const cancelledSessionIds = await cancelActiveTurnsForGroup(groupId, botId);
      eventBus.emit({ kinds: ['groups'] });
      return { ok: true, group: enrichGroup(updated), stoppedThrough: seq, cancelledSessionIds };
    });
  }

  return {
    list,
    create,
    update,
    delete: remove,
    reorder,
    read,
    newThread,
    send,
    stop,
    resumePending,
    postAutomationResult,
    runAutomationInGroup,
  };
}
