/**
 * Chat lifecycle deletion, worker stop/cancel resolution, and chat/activity
 * view projections for `session-runtime.js`.
 */
import crypto from 'node:crypto';
import { orderBotChats } from '../../src/shared/index.js';
import { isClosedStatus } from './items-validation.js';

const freshSignal = () => new AbortController().signal;
const LEGACY_WORKER_MATCH_BEFORE_MS = 5_000;
const LEGACY_WORKER_MATCH_AFTER_MS = 60_000;

/** @param {any} bot @param {(b: any) => string} homeDirFor @param {Record<string, any>} options @param {number} now @param {{ ownerChat: string, defaultPreset: string }} defaults */
export function buildSideChatSpec(bot, homeDirFor, options, now, { ownerChat, defaultPreset }) {
  const sessionId = options.sessionId || `bot-chat-${bot.id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
  const title = String(options.title ?? '').trim() || `${bot.name} · 支线聊天`;
  return {
    sessionId,
    title,
    ensureInput: {
      sessionId,
      cwd: options.cwd || homeDirFor(bot),
      title,
      owner: options.owner || ownerChat,
      preset: options.preset ?? defaultPreset,
      launch: options.launch ?? bot.launch,
      permissionMode: options.permissionMode ?? bot.permissionMode,
      botId: bot.id,
    },
    chatRecord: {
      sessionId,
      botId: bot.id,
      kind: options.kind || 'side',
      origin: options.origin || 'side',
      title,
      externalSource: options.externalSource ?? null,
      externalId: options.externalId ?? null,
      ...(options.groupId ? { groupId: options.groupId } : {}),
      ...(options.dispatchId ? { dispatchId: options.dispatchId } : {}),
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.workId ? { workId: options.workId } : {}),
      ...(options.parentSessionId ? { parentSessionId: options.parentSessionId } : {}),
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** @param {string} state */
export function liveKindFromDot(state) {
  if (state === 'permission' || state === 'blocked' || state === 'waiting') return 'needs-you';
  if (state === 'working' || state === 'monitoring') return 'replying';
  return 'idle';
}

/** @param {any} chat @param {any} work @param {string} sid @param {any} matchedChat */
function chatMatchesStopTarget(chat, work, sid, matchedChat) {
  if (chat.kind !== 'worker') return false;
  if (sid && chat.sessionId === sid) return true;
  if (matchedChat && chat.sessionId === matchedChat.sessionId) return true;
  if (!work) return false;
  return chat.dispatchId === work.dispatchId
    || chat.workId === work.id
    || chat.taskId === work.taskId
    || chat.sessionId === work.taskId
    || chat.sessionId === work.dispatchId;
}

/**
 * Create chat/work management and view projection helpers bound to a session runtime.
 * @param {{
 *   botsStore: any,
 *   workStore: any,
 *   eventBus: any,
 *   liveBySession: Map<string, { state: string, updatedAt: number, preview: string | null, lastBotId: string | null }>,
 *   startingSessions: Set<string>,
 *   inFlightTurns: Map<string, Set<{ abort: () => void }>>,
 *   controllerOf: () => any,
 *   requireBot: (botId: string) => any,
 *   cancelSession: (sessionId: string) => Promise<any>,
 *   getAutomations?: (botId: string) => any[],
 *   getLookAroundUpNext?: (botId: string) => any[],
 * }} deps
 */
export function createSessionWorkOps(deps) {
  const {
    botsStore, workStore, eventBus, liveBySession, startingSessions,
    inFlightTurns, controllerOf, requireBot, cancelSession,
  } = deps;

  /** @param {string} botId @param {string} wid @param {string} sid */
  function resolveWorkForStop(botId, wid, sid) {
    const direct = wid ? (workStore.getWorkById(wid) ?? workStore.getWorkByDispatch(wid)) : null;
    if (direct && direct.botId === botId) return { work: direct, matchedChat: null };

    const lookupSid = sid || wid;
    const chat = lookupSid ? botsStore.getChat(lookupSid) : null;
    const ownedChat = chat && chat.botId === botId ? chat : null;
    if (ownedChat) {
      const fromChat = (ownedChat.workId ? workStore.getWorkById(ownedChat.workId) : null)
        ?? (ownedChat.dispatchId ? workStore.getWorkByDispatch(ownedChat.dispatchId) : null);
      if (fromChat && fromChat.botId === botId) return { work: fromChat, matchedChat: ownedChat };
    }

    const allWork = workStore.listWork({ botId, limit: 200 });
    const matched = allWork.find((/** @type {any} */ w) => (
      w.taskId === wid
      || (lookupSid && (w.taskId === lookupSid || w.dispatchId === lookupSid || w.id === lookupSid))
      || (ownedChat?.taskId && w.taskId === ownedChat.taskId)
    )) ?? null;
    return { work: matched, matchedChat: ownedChat };
  }

  /** @param {string} botId @param {any} work @param {string} sid @param {any} matchedChat @param {number} now */
  async function cancelMatchedWorkerSessions(botId, work, sid, matchedChat, now) {
    /** @type {string[]} */
    const cancelledSessionIds = [];
    /** @type {Set<string>} */
    const seenSessions = new Set();

    const chats = botsStore.listChats(botId, { includeClosed: true });
    for (const chat of chats) {
      if (!chatMatchesStopTarget(chat, work, sid, matchedChat)) continue;
      seenSessions.add(chat.sessionId);
      await cancelSession(chat.sessionId);
      cancelledSessionIds.push(chat.sessionId);
      if (!chat.closedAt) botsStore.closeChat(chat.sessionId, now);
    }

    for (const extraSid of [sid, work?.taskId].filter(Boolean)) {
      if (!seenSessions.has(extraSid) && inFlightTurns.has(extraSid)) {
        await cancelSession(extraSid);
        cancelledSessionIds.push(extraSid);
      }
    }
    return cancelledSessionIds;
  }

  /** @param {string} botId @param {string} workId @param {{ sessionId?: string | null }} [options] */
  async function stopWork(botId, workId, options = {}) {
    const bot = requireBot(botId);
    const wid = String(workId ?? '').trim();
    const sid = String(options?.sessionId ?? '').trim();
    if (!wid && !sid) {
      throw Object.assign(new Error('workId or sessionId is required'), { code: 'invalid_argument' });
    }
    const { work, matchedChat } = resolveWorkForStop(bot.id, wid, sid);
    if (!work && (!matchedChat || matchedChat.kind !== 'worker')) {
      throw Object.assign(new Error(`Work not found: ${wid || sid}`), { code: 'not_found' });
    }

    const now = Date.now();
    const cancelledSessionIds = await cancelMatchedWorkerSessions(bot.id, work, sid, matchedChat, now);
    const closedWork = !work
      ? null
      : (work.closedAt ? work : (workStore.closeWork(work.id, { reason: 'owner_reset', now }) ?? workStore.getWorkById(work.id) ?? work));

    eventBus.emit({ botIds: [bot.id], kinds: ['workers', 'chats', 'status'] });
    return {
      ok: true,
      stopped: true,
      botId: bot.id,
      workId: work?.id ?? null,
      dispatchId: work?.dispatchId ?? null,
      cancelledSessionIds,
      work: closedWork,
    };
  }

  /** @param {string} botId @param {string} sessionId */
  async function deleteChat(botId, sessionId) {
    const bot = requireBot(botId);
    const sid = String(sessionId ?? '').trim();
    if (!sid) {
      throw Object.assign(new Error('sessionId is required'), { code: 'invalid_argument' });
    }
    if (bot.chatSessionId && bot.chatSessionId === sid) {
      throw Object.assign(
        new Error('Cannot delete the active Home Chat. Reset Home Chat first if you want a fresh conversation.'),
        { code: 'cannot_delete_home_chat' },
      );
    }
    const chat = botsStore.getChat(sid);
    if (!chat || chat.botId !== bot.id) {
      throw Object.assign(new Error(`Chat not found: ${sid}`), { code: 'not_found' });
    }

    const now = Date.now();
    await cancelSession(sid);

    const chatWorkers = workStore.listChatWorkersByBot(bot.id, { chatIds: [sid], openOnly: true }).get(sid) ?? [];
    for (const w of chatWorkers) {
      await stopWork(bot.id, w.id).catch(() => null);
    }
    const ownWorkRef = chat.workId ?? chat.dispatchId ?? null;
    if (ownWorkRef) {
      await stopWork(bot.id, ownWorkRef, { sessionId: sid }).catch(() => null);
    }

    liveBySession.delete(sid);
    startingSessions.delete(sid);
    try { workStore.deleteActsFor?.(sid); } catch { /* Best-effort acts_for cleanup. */ }

    const controller = controllerOf();
    if (typeof controller?.delete === 'function') {
      await controller.delete({ sessionId: sid }, freshSignal()).catch(() => null);
    } else if (typeof controller?.close === 'function') {
      await controller.close({ sessionId: sid }, freshSignal()).catch(() => null);
    }

    botsStore.deleteChat(sid);
    eventBus.emit({ botIds: [bot.id], kinds: ['chats', 'workers', 'status'] });
    return { ok: true, deleted: true, botId: bot.id, sessionId: sid, deletedAt: now };
  }

  /** @param {any} w @param {any[]} legacyPool @param {Map<string, any>} matchedWorkByChatSessionId */
  function matchLegacyWorkerChat(w, legacyPool, matchedWorkByChatSessionId) {
    const wCreated = Number(w.createdAt ?? 0);
    if (!wCreated) return null;
    let bestChat = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of legacyPool) {
      if (matchedWorkByChatSessionId.has(c.sessionId)) continue;
      const delta = wCreated - Number(c.createdAt ?? 0);
      if (delta < -LEGACY_WORKER_MATCH_BEFORE_MS || delta > LEGACY_WORKER_MATCH_AFTER_MS) continue;
      const dist = Math.abs(delta);
      if (dist < bestDist) {
        bestDist = dist;
        bestChat = c;
      }
    }
    return bestChat;
  }

  /** @param {any[]} chatRows @param {any[]} allWorkers */
  function linkWorkersAndChats(chatRows, allWorkers) {
    /** @type {Map<string, any>} */
    const matchedChatByWorkId = new Map();
    /** @type {Map<string, any>} */
    const matchedWorkByChatSessionId = new Map();
    /** @type {Set<string>} */
    const openNonHomeChatIds = new Set();
    /** @type {Map<string, any>} */
    const chatByRef = new Map();
    const workerChats = [];

    for (const chat of chatRows) {
      if (!chat.closedAt && chat.origin !== 'home') openNonHomeChatIds.add(chat.sessionId);
      if (chat.kind !== 'worker') continue;
      workerChats.push(chat);
      for (const ref of [chat.workId, chat.dispatchId, chat.taskId]) {
        if (ref) chatByRef.set(String(ref), chat);
      }
    }

    /** @type {any[]} */
    const unmatchedWorks = [];
    for (const w of allWorkers) {
      const explicit = chatByRef.get(String(w.id)) ?? chatByRef.get(String(w.dispatchId)) ?? chatByRef.get(String(w.taskId));
      if (explicit && !matchedWorkByChatSessionId.has(explicit.sessionId)) {
        matchedChatByWorkId.set(w.id, explicit);
        matchedWorkByChatSessionId.set(explicit.sessionId, w);
      } else {
        unmatchedWorks.push(w);
      }
    }

    const legacyPool = workerChats.filter(
      (c) => !matchedWorkByChatSessionId.has(c.sessionId) && !c.workId && !c.dispatchId && !c.taskId,
    );
    for (const w of unmatchedWorks) {
      const bestChat = matchLegacyWorkerChat(w, legacyPool, matchedWorkByChatSessionId);
      if (bestChat) {
        matchedChatByWorkId.set(w.id, bestChat);
        matchedWorkByChatSessionId.set(bestChat.sessionId, w);
      }
    }

    return { matchedChatByWorkId, matchedWorkByChatSessionId, openNonHomeChatIds };
  }

  /** @param {any} w @param {any} linkedChat */
  function projectWorker(w, linkedChat) {
    const base = {
      id: w.id,
      dispatchId: w.dispatchId,
      taskId: w.taskId,
      ...(linkedChat?.sessionId ? { sessionId: linkedChat.sessionId } : {}),
      ...(linkedChat?.title ? { title: linkedChat.title } : {}),
    };
    if (!w.closedAt) return { ...base, state: 'running', createdAt: w.createdAt };
    return { ...base, state: w.closeReason === 'start_failed' ? 'failed' : 'done', closedAt: w.closedAt };
  }

  /** @param {any[]} workers @param {ReturnType<typeof linkWorkersAndChats> | null} linkCtx */
  function partitionChatWorkers(workers, linkCtx) {
    const running = [];
    const finished = [];
    for (const w of workers) {
      const linkedChat = linkCtx?.matchedChatByWorkId?.get(w.id) ?? null;
      if (linkedChat && linkCtx?.openNonHomeChatIds?.has(linkedChat.sessionId)) continue;
      if (!w.closedAt) {
        running.push(projectWorker(w, linkedChat));
      } else if (linkedChat?.sessionId || linkedChat?.title) {
        finished.push(projectWorker(w, linkedChat));
      }
    }
    return { running, finished };
  }

  /** @param {any} chat @param {any} linkedWork */
  function linkedWorkMeta(chat, linkedWork) {
    if (!linkedWork) return {};
    return {
      workId: chat.workId ?? linkedWork.id,
      dispatchId: chat.dispatchId ?? linkedWork.dispatchId,
      taskId: chat.taskId ?? linkedWork.taskId,
      workState: linkedWork.closedAt ? (linkedWork.closeReason === 'start_failed' ? 'failed' : 'done') : 'running',
    };
  }

  /** @param {any} chat @param {any} live */
  function isChatUnread(chat, live) {
    return Boolean(live?.updatedAt && (!chat.seenAt || live.updatedAt > chat.seenAt));
  }

  /** @param {any} chat @param {any} live @param {any} linkedWork */
  function resolveChatDotState(chat, live, linkedWork) {
    const raw = live?.state ?? 'idle';
    const base = (raw === 'failed' || raw === 'interrupted') && !isChatUnread(chat, live) ? 'idle' : raw;
    return base === 'idle' && linkedWork && !linkedWork.closedAt ? 'working' : base;
  }

  /** @param {any} chat @param {any} bot @param {any[] | null} [preloadedWorkers] @param {ReturnType<typeof linkWorkersAndChats> | null} [linkCtx] */
  function decorateChatRow(chat, bot, preloadedWorkers = null, linkCtx = null) {
    const live = liveBySession.get(chat.sessionId);
    const linkedWork = linkCtx?.matchedWorkByChatSessionId?.get(chat.sessionId) ?? null;
    const dotState = resolveChatDotState(chat, live, linkedWork);
    const workers = Array.isArray(preloadedWorkers)
      ? preloadedWorkers
      : (workStore.listChatWorkersByBot(bot.id, { chatIds: [chat.sessionId] }).get(chat.sessionId) ?? []);
    const { running, finished } = partitionChatWorkers(workers, linkCtx);
    return {
      ...chat,
      id: chat.sessionId,
      isHome: bot.chatSessionId === chat.sessionId,
      closed: Boolean(chat.closedAt),
      dotState,
      live: liveKindFromDot(dotState),
      preview: live?.preview ?? chat.preview ?? null,
      lastActiveAt: Math.max(chat.updatedAt ?? 0, live?.updatedAt ?? 0),
      unread: isChatUnread(chat, live),
      ...linkedWorkMeta(chat, linkedWork),
      running,
      runningTotal: running.length,
      finished,
    };
  }

  /** @param {string} botId @param {{ includeClosed?: boolean, preloadedWorkersByChat?: Map<string, any[]> | null }} [opts] */
  function listChats(botId, { includeClosed = true, preloadedWorkersByChat = null } = {}) {
    const bot = requireBot(botId);
    const rows = botsStore.listChats(bot.id, { includeClosed });
    if (rows.length === 0) return [];
    const workersByChat = preloadedWorkersByChat instanceof Map
      ? preloadedWorkersByChat
      : workStore.listChatWorkersByBot(bot.id, { chatIds: rows.map((/** @type {any} */ r) => r.sessionId) });
    const flatWorkers = [...workersByChat.values()].flat();
    const linkCtx = linkWorkersAndChats(rows, flatWorkers);
    return orderBotChats(rows.map((/** @type {any} */ row) => decorateChatRow(row, bot, workersByChat.get(row.sessionId) ?? [], linkCtx)));
  }

  /** @param {{ botId?: string | null, query?: string, limit?: number }} [opts] */
  function searchChats({ botId = null, query = '', limit = 50 } = {}) {
    const needle = String(query ?? '').trim().toLowerCase();
    const bots = botId ? [requireBot(botId)] : botsStore.listBots();
    const workersByBot = workStore.listChatWorkersByBots(bots.map((/** @type {any} */ b) => b.id));
    const matches = [];
    for (const bot of bots) {
      const preloaded = workersByBot.get(bot.id) ?? new Map();
      for (const chat of listChats(bot.id, { includeClosed: true, preloadedWorkersByChat: preloaded })) {
        const hay = `${chat.title ?? ''} ${chat.preview ?? ''} ${bot.name}`.toLowerCase();
        if (!needle || hay.includes(needle)) {
          matches.push({ ...chat, botName: bot.name });
        }
      }
    }
    return matches.sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, Math.min(200, Math.max(1, limit)));
  }

  /** @param {string} sid @param {number} now */
  const seenAtFor = (sid, now) => Math.max(now, liveBySession.get(sid)?.updatedAt ?? 0);

  /** @param {string | null | undefined} sessionId @param {string | null} [botId] */
  function markSeen(sessionId, botId = null) {
    const now = Date.now();
    const sid = String(sessionId ?? '').trim();
    const bid = String(botId ?? '').trim();
    if (!sid && bid) {
      let seenAt = now;
      for (const c of botsStore.listChats(bid, { includeClosed: false })) {
        const chatSeenAt = seenAtFor(c.sessionId, now);
        seenAt = Math.max(seenAt, chatSeenAt);
        botsStore.markChatSeen(c.sessionId, chatSeenAt);
      }
      eventBus.emit({ botIds: [bid], kinds: ['chats', 'status'] });
      return { ok: true, botId: bid, seenAt };
    }
    const seenAt = seenAtFor(sid, now);
    const chat = botsStore.getChat(sid);
    botsStore.markChatSeen(sid, seenAt);
    const targetBotId = chat?.botId || bid;
    if (targetBotId) eventBus.emit({ botIds: [targetBotId], kinds: ['chats', 'status'] });
    return { ok: true, sessionId: sid, seenAt };
  }

  /** @param {string} sessionId */
  function markUnseen(sessionId) {
    const chat = botsStore.getChat(sessionId);
    if (chat) {
      botsStore.upsertChat({ ...chat, seenAt: null, updatedAt: Date.now() });
      const live = liveBySession.get(sessionId);
      liveBySession.set(sessionId, {
        state: live?.state ?? 'idle',
        updatedAt: Date.now(),
        preview: live?.preview ?? null,
        lastBotId: chat.botId,
      });
      eventBus.emit({ botIds: [chat.botId], kinds: ['chats', 'status'] });
    }
    return { ok: true, sessionId };
  }

  /** @param {string} botId */
  function buildChatTree(botId) {
    const bot = requireBot(botId);
    const chats = listChats(bot.id, { includeClosed: true });
    return { botId: bot.id, homeSessionId: bot.chatSessionId ?? null, chats };
  }

  /** @param {string} botId */
  function buildActivity(botId) {
    const bot = requireBot(botId);
    const allWork = workStore.listWork({ botId: bot.id, limit: 100 });
    const workers = allWork.filter((/** @type {any} */ w) => !w.closedAt);
    const completed = allWork.filter((/** @type {any} */ w) => Boolean(w.closedAt)).slice(0, 20);
    const automations = typeof deps.getAutomations === 'function'
      ? deps.getAutomations(bot.id)
      : workStore.listAutomations({ botId: bot.id });
    const waits = automations.filter((/** @type {any} */ a) => a.once && a.enabled);
    const regularAutomations = automations.filter((/** @type {any} */ a) => !a.once);
    const upNext = typeof deps.getLookAroundUpNext === 'function' ? deps.getLookAroundUpNext(bot.id) : [];
    const inProgress = listChats(bot.id, { includeClosed: false }).filter((/** @type {any} */ c) => c.live !== 'idle');
    return { workers, inProgress, completed, automations: regularAutomations, waits, upNext };
  }

  return {
    deleteChat, stopWork, listChats, searchChats, markSeen, markUnseen, buildChatTree, buildActivity,
  };
}

/** @type {Promise<((input: any) => any) | null> | null} */
let cachedCreateUserMessage = null;
const DSH_LLM_MODULE = '@deepseek-ai/dsh-llm';
function loadCreateUserMessage() {
  if (!cachedCreateUserMessage) {
    cachedCreateUserMessage = import(DSH_LLM_MODULE)
      .then((mod) => (typeof mod?.createUserMessage === 'function' ? mod.createUserMessage : null))
      .catch(() => null);
  }
  return cachedCreateUserMessage;
}

/** @param {string} text @param {Record<string, any>} source */
export async function buildInternalUserMessage(text, source) {
  const createUserMessage = await loadCreateUserMessage();
  const content = [{ type: 'text', text }];
  if (createUserMessage) {
    return Object.freeze({ ...createUserMessage({ source, content }) });
  }
  return { id: crypto.randomUUID(), ts: Date.now(), role: 'user', source, content };
}

/** @param {any} ctx @param {any} controller @param {string} sessionId */
export async function resolveLiveAgent(ctx, controller, sessionId) {
  const directAgent = ctx?.get?.('agents')?.get?.(sessionId);
  if (directAgent && typeof directAgent.followup === 'function') return directAgent;
  if (typeof controller?.resolveAgent === 'function') {
    const resolved = await controller.resolveAgent(sessionId).catch(() => {
      /* Best-effort agent lookup for internal dispatch. */
      return null;
    });
    const candidate = resolved && !resolved.error ? resolved.agent : null;
    if (candidate && typeof candidate.followup === 'function') return candidate;
  }
  return null;
}

/** @param {any} msg */
function extractMessageText(msg) {
  const content = msg?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block && block.type === 'text' ? String(block.text ?? '') : ''))
    .join('\n');
}

/** @param {any} msg @param {Array<{ uid: string, number?: number }>} targets */
function isPendingItemMailMessage(msg, targets) {
  const source = msg?.source;
  if (!source || typeof source !== 'object') return false;
  if (source.kind === 'dsh-bots:mail') {
    const msgUids = new Set();
    if (typeof source.itemUid === 'string' && source.itemUid) msgUids.add(source.itemUid);
    if (Array.isArray(source.itemUids)) {
      for (const uid of source.itemUids) {
        if (typeof uid === 'string' && uid) msgUids.add(uid);
      }
    }
    if (msgUids.size > 0) return targets.some((t) => msgUids.has(t.uid));
  } else if (typeof source.rpcId !== 'string' || !source.rpcId.startsWith('bot-item-mail-')) {
    return false;
  }
  const text = extractMessageText(msg);
  if (!text) return false;
  return targets.some((t) => {
    if (t.uid && text.includes(t.uid)) return true;
    return Number.isInteger(t.number) && new RegExp(`#${t.number}(?!\\d)`).test(text);
  });
}

/**
 * Remove unconsumed queued item-mail notifications for `items` from `liveAgent.inbox.nextTurn`.
 * @param {any} liveAgent
 * @param {Array<{ uid: string, number?: number }>} items
 */
export function prunePendingItemMailFromInbox(liveAgent, items) {
  const nextTurn = liveAgent?.inbox?.nextTurn;
  const remove = liveAgent?.inbox?.remove;
  if (!Array.isArray(nextTurn) || nextTurn.length === 0 || typeof remove !== 'function') return 0;
  const targets = (Array.isArray(items) ? items : [items]).filter((item) => item && typeof item.uid === 'string' && item.uid);
  if (targets.length === 0) return 0;
  let removed = 0;
  for (const msg of [...nextTurn]) {
    if (!isPendingItemMailMessage(msg, targets)) continue;
    if (remove.call(liveAgent.inbox, msg.id)) removed += 1;
  }
  return removed;
}

/** @param {any} msg */
function isAnyItemMailMessage(msg) {
  const source = msg?.source;
  if (!source || typeof source !== 'object') return false;
  if (source.kind === 'dsh-bots:mail') return true;
  return typeof source.rpcId === 'string' && source.rpcId.startsWith('bot-item-mail-');
}

/** @param {any} msg */
function extractItemRefsFromMailMessage(msg) {
  /** @type {Set<string>} */
  const uids = new Set();
  /** @type {Set<number>} */
  const numbers = new Set();
  const source = msg?.source;
  if (source && typeof source === 'object') {
    if (typeof source.itemUid === 'string' && source.itemUid) uids.add(source.itemUid);
    if (Array.isArray(source.itemUids)) {
      for (const uid of source.itemUids) {
        if (typeof uid === 'string' && uid) uids.add(uid);
      }
    }
  }
  if (uids.size === 0) {
    const text = extractMessageText(msg);
    for (const match of text.matchAll(/(?:^|\n)(?:Item:|-)\s*#(\d+)\b(?:\s*\(([0-9a-f-]{8,})\))?/giu)) {
      const num = Number(match[1]);
      if (Number.isInteger(num) && num > 0) numbers.add(num);
      if (match[2]) uids.add(match[2]);
    }
  }
  return { uids: [...uids], numbers: [...numbers] };
}

/** @param {any} msg @param {any} itemsStore */
function resolveOpenItemKeyForMail(msg, itemsStore) {
  const refs = extractItemRefsFromMailMessage(msg);
  if (refs.uids.length === 0 && refs.numbers.length === 0) return { hasRefs: false, key: '' };
  const resolved = [
    ...refs.uids.map((uid) => itemsStore.get?.(uid) ?? null),
    ...refs.numbers.map((num) => itemsStore.byNumber?.(num) ?? null),
  ];
  const openUids = [...new Set(resolved.filter((item) => item && !isClosedStatus(item.status)).map((item) => String(item.uid)))].sort();
  return { hasRefs: true, key: openUids.join(',') };
}

/**
 * Remove stale item-mail messages (all referenced items closed/missing) and collapse duplicate
 * queued mail targeting the same open item set (keeping the newest) from a restored/live inbox.
 * @param {any} liveAgent
 * @param {any} itemsStore
 */
export function pruneStaleItemMailFromInbox(liveAgent, itemsStore) {
  const nextTurn = liveAgent?.inbox?.nextTurn;
  const remove = liveAgent?.inbox?.remove;
  if (!Array.isArray(nextTurn) || nextTurn.length === 0 || typeof remove !== 'function' || !itemsStore) return 0;

  /** @type {Array<{ msg: any, key: string }>} */
  const openEntries = [];
  let removed = 0;

  for (const msg of [...nextTurn]) {
    if (!isAnyItemMailMessage(msg)) continue;
    const { hasRefs, key } = resolveOpenItemKeyForMail(msg, itemsStore);
    if (!hasRefs) continue;
    if (!key) {
      if (remove.call(liveAgent.inbox, msg.id)) removed += 1;
      continue;
    }
    openEntries.push({ msg, key });
  }

  /** @type {Set<string>} */
  const keptKeys = new Set();
  for (let i = openEntries.length - 1; i >= 0; i -= 1) {
    const entry = openEntries[i];
    if (keptKeys.has(entry.key)) {
      if (remove.call(liveAgent.inbox, entry.msg.id)) removed += 1;
    } else {
      keptKeys.add(entry.key);
    }
  }
  return removed;
}

/**
 * Install an `agent/created` hook (and immediate live-agent sweep) that prunes persisted closed-item
 * and duplicate item-mail entries before restored agents release queued input.
 * @param {{ ctx: any, botsStore: any, itemsStore: any }} deps
 */
export function installStaleInboxMailPruner({ ctx, botsStore, itemsStore }) {
  /** @param {string} sid */
  const isBotSession = (sid) => Boolean(
    sid && (botsStore.getChat(sid) || botsStore.listBots().some((/** @type {any} */ bot) => bot.chatSessionId === sid)),
  );
  /** @param {any} agent */
  const pruneAgent = (agent) => {
    const sid = String(agent?.id ?? '');
    if (!isBotSession(sid)) return 0;
    try { return pruneStaleItemMailFromInbox(agent, itemsStore); } catch { return 0; }
  };
  const pruneAll = () => {
    const agentsMap = ctx?.get?.('agents');
    if (!agentsMap || typeof agentsMap.values !== 'function') return 0;
    let removed = 0;
    for (const agent of agentsMap.values()) removed += pruneAgent(agent);
    return removed;
  };
  const off = typeof ctx?.on === 'function'
    ? ctx.on('agent/created', (/** @type {any} */ payload) => { pruneAgent(payload?.agent ?? payload); }, { global: true })
    : null;
  pruneAll();
  return { pruneAll, dispose: () => { try { off?.(); } catch { /* Ignore cleanup error. */ } } };
}

/**
 * Remove stale unconsumed item-mail messages for a closed item from active agent inboxes.
 * @param {{ ctx: any, controller: any, botsStore: any, item: any }} params
 */
export async function pruneClosedItemInbox({ ctx, controller, botsStore, item }) {
  if (!item?.uid) return 0;
  const agentsMap = ctx?.get?.('agents');
  if (agentsMap && typeof agentsMap.values === 'function') {
    let removed = 0;
    for (const agent of agentsMap.values()) removed += prunePendingItemMailFromInbox(agent, [item]);
    return removed;
  }
  const bot = item.ownerBotId ? botsStore?.getBot?.(item.ownerBotId) : null;
  const sids = [...new Set([item.chatId, bot?.chatSessionId].filter(Boolean))];
  let removed = 0;
  for (const sid of sids) {
    const liveAgent = await resolveLiveAgent(ctx, controller, sid);
    if (liveAgent) removed += prunePendingItemMailFromInbox(liveAgent, [item]);
  }
  return removed;
}

/** @param {any} source @param {string | null} sourceKind @param {string} requestId */
export function resolveTurnSource(source, sourceKind, requestId) {
  const fromObj = typeof source?.kind === 'string' && source.kind.trim() ? source.kind.trim() : '';
  const fromOpt = typeof sourceKind === 'string' && sourceKind.trim() ? sourceKind.trim() : '';
  return {
    ...(source && typeof source === 'object' ? source : {}),
    kind: fromObj || fromOpt || 'dsh-bots:turn',
    rpcId: requestId,
  };
}

/** @param {any} params */
export function executeControllerTurn(params) {
  const { ctx, controller, sessionId, promptText, timeoutMs, requestId, effectiveSource, registerInFlight, eventText } = params;
  if (typeof controller.runTurnForTest === 'function') {
    const ac = new AbortController();
    return new Promise((resolve) => {
      let settled = false;
      /** @type {(() => void) | null} */
      let unregister = null;
      /** @param {any} result */
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try { unregister?.(); } catch { /* Best-effort unregister. */ }
        resolve(result);
      };
      unregister = registerInFlight(sessionId, {
        abort: () => {
          ac.abort();
          finish({ ok: false, error: 'aborted', reason: 'aborted', reply: '' });
        },
      });
      Promise.resolve(controller.runTurnForTest(sessionId, promptText, ac.signal, { source: effectiveSource }))
        .then((res) => finish(res))
        .catch((err) => finish({ ok: false, error: String(err?.message ?? err), reply: '' }));
    });
  }

  const ac = new AbortController();
  return new Promise((resolve) => {
    let mine = false;
    let settled = false;
    /** @type {string[]} */
    const texts = [];
    /** @type {(() => void) | null} */
    let off = null;
    /** @type {(() => void) | null} */
    let unregister = null;
    /** @param {any} result */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unregister?.(); } catch { /* Best-effort unregister. */ }
      try { off?.(); } catch { /* Best-effort dispose. */ }
      ac.abort();
      resolve(result);
    };
    unregister = registerInFlight(sessionId, {
      abort: () => finish({ ok: false, error: 'aborted', reason: 'aborted', reply: texts.join('\n').trim() }),
    });
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout', reply: texts.join('\n').trim() }), timeoutMs);
    off = typeof ctx?.on === 'function'
      ? ctx.on('session/event', (/** @type {any} */ session, /** @type {any} */ event) => {
        if (String(session?.id ?? session ?? '') !== String(sessionId)) return;
        const d = event?.data ?? {};
        if (!mine) {
          if (event?.type === 'user/message' && d.source?.rpcId === requestId) mine = true;
          return;
        }
        if (event?.type === 'assistant/message') {
          const t = eventText({ data: d }).trim();
          if (t) texts.push(t);
        } else if (event?.type === 'turn/end') {
          const kind = d.reason?.kind ?? 'completed';
          finish({ ok: kind === 'completed', reply: texts.join('\n').trim(), reason: kind });
        }
      }, { global: true })
      : null;
    if (!off) {
      finish({ ok: false, error: 'event-bus-unavailable', reply: '' });
      return;
    }
    const dispatchInternalTurn = async () => {
      const liveAgent = await resolveLiveAgent(ctx, controller, sessionId);
      if (settled || ac.signal.aborted) return;
      if (liveAgent) {
        const msg = await buildInternalUserMessage(promptText, effectiveSource);
        if (settled || ac.signal.aborted) return;
        await Promise.resolve(liveAgent.followup(msg));
        return;
      }
      if (typeof controller.resolveAgent === 'function') {
        finish({ ok: false, error: 'agent-unavailable-for-internal-turn', reply: '' });
        return;
      }
      await controller.prompt({
        requestId,
        sessionId,
        mode: 'queue',
        source: effectiveSource,
        content: [{ type: 'text', text: promptText }],
      }, ac.signal);
    };
    dispatchInternalTurn()
      .catch((/** @type {any} */ err) => finish({ ok: false, error: String(err?.message ?? err), reply: '' }));
  });
}
