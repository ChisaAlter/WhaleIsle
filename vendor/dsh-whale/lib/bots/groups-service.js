/**
 * Multi-Bot Group Chat runtime service.
 * Combines `groups-store.js` (6 SQLite tables) with Orca's shared mention parser,
 * target resolver, and <=24KB `<quoted_room_history>` builder from `src/shared/bot-groups.js`.
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

/** @param {any} group @param {string} [threadId] */
function memberSessionKey(botId, threadId) {
  return threadId ? `${botId}:${threadId}` : botId;
}

/** @param {any} group @param {string} [threadId] */
function toSharedGroupShape(group, threadId = '') {
  const sessions = group.memberSessionIds ?? {};
  const members = (group.botIds ?? []).map((botId) => ({
    botId,
    sessionId: sessions[memberSessionKey(botId, threadId)] ?? sessions[botId] ?? null,
  }));
  return { ...group, members };
}

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

  function enrichGroup(group) {
    if (!group) return null;
    const members = (group.botIds ?? []).map((botId) => {
      const bot = botsStore.getBot(botId);
      return {
        botId,
        name: bot?.name ?? botId,
        avatar: bot?.avatar ?? null,
        avatarColor: bot?.avatarColor ?? null,
        paused: Boolean(bot?.paused),
        sessionId: group.memberSessionIds?.[botId] ?? null,
      };
    });
    return { ...group, members };
  }

  function list() {
    return groupsStore.listGroups().map(enrichGroup);
  }

  function create(params = {}) {
    const botIds = Array.isArray(params.botIds) ? params.botIds : [];
    const memberBots = botIds.map((id) => botsStore.getBot(id)).filter(Boolean);
    if (memberBots.length < 2) {
      throw Object.assign(new Error('A group requires at least 2 existing bots'), { code: 'invalid_argument' });
    }
    const name = String(params.name ?? '').trim()
      || suggestGroupName(memberBots.map((b) => b.name))
      || 'Bot Group';
    const created = groupsStore.createGroup({
      id: params.id,
      name,
      botIds: memberBots.map((b) => b.id),
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
  }

  function remove(params = {}) {
    const id = typeof params === 'string' ? params : String(params?.groupId ?? params?.id ?? '');
    const deleted = groupsStore.deleteGroup(id);
    if (deleted) eventBus.emit({ kinds: ['groups'] });
    return { deleted };
  }

  function reorder(orderedIds) {
    const listRes = groupsStore.reorderGroups(orderedIds).map(enrichGroup);
    eventBus.emit({ kinds: ['groups'] });
    return listRes;
  }

  function read(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    const group = groupsStore.getGroup(groupId);
    if (!group) throw Object.assign(new Error(`Group not found: ${groupId}`), { code: 'not_found' });
    const page = groupsStore.readMessages(groupId, {
      threadId: params.threadId ?? '',
      beforeSequence: params.beforeSequence ?? null,
      afterSequence: params.afterSequence ?? null,
      limit: params.limit ?? 40,
    });
    return { group: enrichGroup(group), ...page };
  }

  function newThread(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    const res = groupsStore.createThread(groupId, {
      threadId: params.threadId,
      title: params.title ?? null,
    });
    eventBus.emit({ kinds: ['groups'] });
    return { group: enrichGroup(res.group), thread: res.thread };
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

  async function driveMemberReply({ groupId, threadId, ownerMessage, bot, sessionId, operationId, quotedHistory }) {
    const prompt = [
      `[WhaleIsle: Group "${groupsStore.getGroup(groupId)?.name ?? groupId}" message]`,
      quotedHistory,
      '',
      `${ownerMessage.authorName || 'Owner'}: ${ownerMessage.text}`,
    ].join('\n');

    const turn = await sessionRuntime.runSingleTurn(sessionId, prompt, { timeoutMs: 120_000 });
    groupsStore.deletePending(operationId);

    const latestGroup = groupsStore.getGroup(groupId);
    if (!latestGroup || isStoppedAt(latestGroup, bot.id, ownerMessage.sequence)) {
      groupsStore.updateMessage(ownerMessage.id, (msg) => ({
        ...msg,
        turns: (msg.turns ?? []).map((t) => (
          t.operationId === operationId ? { ...t, status: 'stopped' } : t
        )),
      }));
      eventBus.emit({ kinds: ['groups'] });
      return { botId: bot.id, stopped: true };
    }

    const rawReply = String(turn.reply ?? '').trim();
    const quiet = isQuietResult(rawReply);
    const cleanReply = quiet ? stripQuietMarker(rawReply).trim() : rawReply;
    const status = turn.ok ? (cleanReply ? 'done' : 'quiet') : 'error';

    groupsStore.updateMessage(ownerMessage.id, (msg) => ({
      ...msg,
      turns: (msg.turns ?? []).map((t) => (
        t.operationId === operationId
          ? { ...t, status, reply: cleanReply, error: turn.ok ? null : (turn.error || 'failed'), finishedAt: Date.now() }
          : t
      )),
    }));
    if (cleanReply) {
      groupsStore.updateSidebarLatest(groupId, {
        authorName: bot.name,
        text: cleanReply,
        at: Date.now(),
        sequence: ownerMessage.sequence,
        tie: 1,
      });
    }
    eventBus.emit({ kinds: ['groups'] });
    return { botId: bot.id, status, reply: cleanReply };
  }

  async function send(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    const threadId = String(params.threadId ?? '').trim();
    const text = String(params.text ?? '').trim();
    const images = Array.isArray(params.images) ? params.images.slice(0, 20) : [];
    if (!text && images.length === 0) {
      throw Object.assign(new Error('Message text or images are required'), { code: 'invalid_argument' });
    }
    const group = groupsStore.getGroup(groupId);
    if (!group) throw Object.assign(new Error(`Group not found: ${groupId}`), { code: 'not_found' });

    const allBots = botsStore.listBots();
    const sharedShape = toSharedGroupShape(group, threadId);
    const targetBotIds = resolveGroupTargets(text, sharedShape, allBots);
    const activeTargets = targetBotIds
      .map((id) => botsStore.getBot(id))
      .filter((bot) => bot && !bot.paused);

    const historyBefore = groupsStore.readMessages(groupId, { threadId, limit: 40 }).messages;
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
      });
      dispatchPlans.push({ bot, sessionId, operationId: opId, quotedHistory });
    }

    const appended = groupsStore.appendMessage(groupId, {
      id: params.messageId || crypto.randomUUID(),
      threadId,
      author: { kind: 'owner' },
      authorName: String(params.authorName ?? '你'),
      text,
      images,
      targetBotIds: activeTargets.map((b) => b.id),
      turns: turnsMeta,
    }, { operationId: dispatchPlans[0]?.operationId ?? null });

    if (appended.deduplicated) {
      return { message: appended.message, deduplicated: true, targetBotIds: activeTargets.map((b) => b.id) };
    }

    for (const plan of dispatchPlans) {
      groupsStore.enqueuePending(plan.operationId, groupId, {
        botId: plan.bot.id,
        threadId,
        quotedHistory: plan.quotedHistory,
      });
    }
    eventBus.emit({ kinds: ['groups'] });

    const jobs = dispatchPlans.map((plan) => driveMemberReply({
      groupId,
      threadId,
      ownerMessage: appended.message,
      bot: plan.bot,
      sessionId: plan.sessionId,
      operationId: plan.operationId,
      quotedHistory: plan.quotedHistory,
    }).catch(() => null));

    if (params.waitForReplies === true) {
      await Promise.all(jobs);
      const refreshed = groupsStore.readMessages(groupId, { threadId, limit: 40 }).messages
        .find((m) => m.id === appended.message.id) ?? appended.message;
      return { message: refreshed, deduplicated: false, targetBotIds: activeTargets.map((b) => b.id) };
    }
    return { message: appended.message, deduplicated: false, targetBotIds: activeTargets.map((b) => b.id) };
  }

  function stop(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    const botId = params.botId ? String(params.botId).trim() : null;
    const latestMsgs = groupsStore.readMessages(groupId, { threadId: params.threadId ?? '', limit: 1 }).messages;
    const seq = Number.isInteger(params.sequence) ? params.sequence : (latestMsgs.at(-1)?.sequence ?? 0);
    const updated = groupsStore.setStoppedThrough(groupId, { botId, sequence: seq });
    if (botId) {
      groupsStore.clearPendingForBot(groupId, botId);
    } else {
      for (const p of groupsStore.listPending(groupId)) groupsStore.deletePending(p.operationId);
    }
    eventBus.emit({ kinds: ['groups'] });
    return { ok: true, group: enrichGroup(updated), stoppedThrough: seq };
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
  };
}
