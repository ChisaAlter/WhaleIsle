/**
 * Harness session bridge, live dot-state tracker, chat tree, and activity
 * projector for WhaleIsle Bots.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import {
  BOT_CREATED_KICKOFF,
  BOT_PERMISSION_MODES,
  botTemplateKickoff,
  orderBotChats,
  resolveBotRowActivityLine,
  rollUpBotStatus,
  soulDescription,
} from '../../src/shared/index.js';
import {
  controllerFrom,
  eventText,
  sessionIdFromRow,
  sessionRowsFrom,
  trimTo,
} from '../shared.js';
import { botsRootDir, readSoul } from './fs-home.js';
import { resolveBotLaunchRoute } from './launch-route.js';
import { BOT_PRESET_ID } from './prompt-engine.js';

export const BOT_OWNER_HOME = 'dsh-bots:home';
export const BOT_OWNER_CHAT = 'dsh-bots:chat';
export const BOT_OWNER_GROUP_MEMBER = 'dsh-bots:group-member';
export const BOT_OWNER_WORK = 'dsh-bots:work';
export const BOT_OWNER_AUTOMATION = 'dsh-bots:automation';

const TURN_TIMEOUT_DEFAULT_MS = 120_000;
const freshSignal = () => new AbortController().signal;

/** @param {any} launch */
export function parseLaunchModel(launch) {
  return resolveBotLaunchRoute(launch, null);
}

/** @param {unknown} mode */
function normalizePermissionMode(mode) {
  if (typeof mode !== 'string') return null;
  const clean = mode.trim();
  return BOT_PERMISSION_MODES.includes(clean) ? clean : null;
}

/** @param {any} catalog */
function normalizeModelCatalog(catalog) {
  return (catalog?.groups ?? []).map((g) => ({
    id: String(g.id ?? ''),
    name: String(g.name ?? g.id ?? ''),
    models: (g.models ?? []).map((m) => ({
      id: String(m.id ?? ''),
      name: String(m.name ?? m.id ?? ''),
      efforts: (m.reasoning?.efforts ?? []).map((e) => ({
        id: String(e.id ?? ''),
        name: String(e.name ?? e.id ?? ''),
      })),
      defaultEffort: String(m.reasoning?.defaultEffort ?? ''),
    })),
  })).filter((g) => g.id && g.models.length > 0);
}

/** @param {any} event @param {{ state: string, preview: string | null }} prev */
function nextLiveStateFromEvent(event, prev) {
  const type = event?.type;
  if (type === 'turn/start' || type === 'approval/decided' || type === 'user-questions/answered') {
    return { state: 'working', preview: prev.preview };
  }
  if (type === 'approval/asked' || type === 'user-questions/asked') {
    return { state: 'permission', preview: prev.preview };
  }
  if (type === 'assistant/message') {
    const text = eventText(event).trim();
    return { state: prev.state, preview: text ? trimTo(text.replace(/\s+/gu, ' '), 180) : prev.preview };
  }
  if (type === 'turn/end') {
    const kind = event?.data?.reason?.kind;
    const state = kind === 'error' ? 'failed' : (kind === 'aborted' ? 'interrupted' : 'idle');
    return { state, preview: prev.preview };
  }
  return null;
}

/** @param {string} state */
function liveKindFromDot(state) {
  if (state === 'permission' || state === 'blocked' || state === 'waiting') return 'needs-you';
  if (state === 'working' || state === 'monitoring') return 'replying';
  return 'idle';
}

/** @param {any} ctrl @param {any} launch @param {boolean} fallbackDefault @param {boolean} strictRequire */
async function resolveRouteToApply(ctrl, launch, fallbackDefault, strictRequire) {
  const direct = resolveBotLaunchRoute(launch, null);
  if (direct || !fallbackDefault) return direct;
  const def = (await ctrl?.modelCatalog?.())?.default ?? null;
  const resolved = resolveBotLaunchRoute(launch, def);
  if (!resolved) {
    if (strictRequire) throw new Error('default-model-unavailable');
    return null;
  }
  return resolved;
}

const KICKOFF_STEPS = Object.freeze(['create', 'start', 'first-message', 'done']);

/** @param {any} entry */
function formatKickoffView(entry) {
  if (!entry) return undefined;
  return {
    status: entry.status,
    step: entry.step,
    steps: KICKOFF_STEPS,
    ...(entry.error ? { error: entry.error } : {}),
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Create the Harness session runtime for Bots.
 * @param {{
 *   ctx: any,
 *   dshHome: string,
 *   botsStore: any,
 *   itemsStore: any,
 *   workStore: any,
 *   eventBus: any,
 *   getController?: () => any,
 *   budgetService?: any,
 *   getBudgetService?: () => any,
 *   getLookAroundUpNext?: (botId: string) => any[],
 *   getAutomations?: (botId: string) => any[],
 * }} deps
 */
export function createSessionRuntime(deps) {
  const { ctx, dshHome, botsStore, itemsStore, workStore, eventBus } = deps;
  const controllerOf = () => (typeof deps.getController === 'function' ? deps.getController() : controllerFrom(ctx));
  const budgetOf = () => (typeof deps.getBudgetService === 'function' ? deps.getBudgetService() : (deps.budgetService ?? null));

  /** @param {string} botId @param {{ isBackground?: boolean }} [opts] */
  function checkBudgetGate(botId, { isBackground = false } = {}) {
    if (!botId) return { allowed: true };
    const svc = budgetOf();
    if (!svc || typeof svc.checkExecutionAllowed !== 'function') return { allowed: true };
    return svc.checkExecutionAllowed(botId, { isBackground });
  }

  /** @type {Map<string, { state: string, updatedAt: number, preview: string | null, lastBotId: string | null }>} */
  const liveBySession = new Map();
  /** @type {Map<string, { status: 'pending' | 'running' | 'ready' | 'failed', step: 'create' | 'start' | 'first-message' | 'done', prompt: string, startedAt: number, updatedAt: number, error: string | null }>} */
  const kickoffLog = new Map();
  /** @type {Set<string>} */
  const startingSessions = new Set();

  function setKickoffState(botId, patch) {
    const now = Date.now();
    const prev = kickoffLog.get(botId);
    const next = {
      status: patch.status ?? prev?.status ?? 'pending',
      step: patch.step ?? prev?.step ?? 'create',
      prompt: patch.prompt ?? prev?.prompt ?? '',
      startedAt: prev?.startedAt ?? now,
      updatedAt: now,
      error: patch.error !== undefined ? patch.error : (prev?.error ?? null),
    };
    kickoffLog.set(botId, next);
    eventBus.emit({ botIds: [botId], kinds: ['bot', 'status'] });
    return next;
  }

  function homeDirFor(bot) {
    return path.join(botsRootDir(dshHome), bot.folder);
  }

  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  async function applyLaunchModel(controller, sessionId, launch, options = {}) {
    const { strict = false, fallbackDefault = false, requireController = false } = options;
    const ctrl = controller ?? controllerOf();
    const route = await resolveRouteToApply(ctrl, launch, fallbackDefault, strict && requireController);
    if (!route) return false;
    if (typeof ctrl?.selectModel !== 'function') {
      if (strict && requireController) throw new Error('session-controller-unavailable');
      return false;
    }
    if (strict) {
      await ctrl.selectModel({ sessionId, ...route, saveAsDefault: false }, freshSignal());
      return true;
    }
    try {
      await ctrl.selectModel({ sessionId, ...route, saveAsDefault: false }, freshSignal());
      return true;
    } catch {
      return false;
    }
  }

  async function ensureControllerSession({
    sessionId,
    cwd,
    title,
    owner,
    preset = BOT_PRESET_ID,
    launch = null,
    permissionMode = null,
    botId = null,
    isBackground = false,
    checkBudget = false,
  }) {
    if (checkBudget && botId) {
      const gate = checkBudgetGate(botId, { isBackground });
      if (!gate.allowed) {
        return {
          ok: false,
          sessionId,
          created: false,
          blocked: true,
          code: gate.reason,
          deferUntilMs: gate.deferUntilMs ?? null,
          error: gate.reason,
        };
      }
    }
    const controller = controllerOf();
    if (!controller || typeof controller.create !== 'function') {
      return { ok: false, sessionId, created: false, error: 'session-controller-unavailable' };
    }
    let existing = false;
    if (typeof controller.list === 'function') {
      const rows = sessionRowsFrom(await controller.list({}, freshSignal()));
      existing = rows.some((row) => sessionIdFromRow(row) === sessionId);
    }
    const validPerm = normalizePermissionMode(permissionMode);
    if (!existing) {
      startingSessions.add(sessionId);
      try {
        await controller.create({
          sessionId,
          cwd,
          agentPreset: preset,
          ...(validPerm ? { permissionMode: validPerm } : {}),
          presentation: { owner, title },
        }, freshSignal());
      } finally {
        startingSessions.delete(sessionId);
      }
      await applyLaunchModel(controller, sessionId, launch);
      return { ok: true, sessionId, created: true };
    }
    if (typeof controller.setPresentation === 'function') {
      await controller.setPresentation({ sessionId, presentation: { owner, title } }, freshSignal()).catch(() => null);
    }
    return { ok: true, sessionId, created: false };
  }

  async function openHomeChat(botId, { createIfMissing = true } = {}) {
    const bot = requireBot(botId);
    const existingId = String(bot.chatSessionId ?? '').trim();
    if (!existingId && !createIfMissing) {
      return { ok: false, botId: bot.id, sessionId: null };
    }
    const sessionId = existingId || `bot-home-${bot.id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
    const ensured = await ensureControllerSession({
      sessionId,
      cwd: homeDirFor(bot),
      title: bot.name,
      owner: BOT_OWNER_HOME,
      launch: bot.launch,
      permissionMode: bot.permissionMode,
      botId: bot.id,
    });
    const now = Date.now();
    botsStore.upsertChat({
      sessionId,
      botId: bot.id,
      kind: 'home',
      origin: 'home',
      title: 'Home Chat',
      createdAt: now,
      updatedAt: now,
    }, now);
    if (bot.chatSessionId !== sessionId) {
      botsStore.updateBot(bot.id, { chatSessionId: sessionId }, now);
    }
    eventBus.emit({ botIds: [bot.id], kinds: ['chats', 'bot'] });
    return { ok: true, botId: bot.id, sessionId, created: ensured.created };
  }

  async function resetHomeChat(botId) {
    const bot = requireBot(botId);
    const previousSessionId = bot.chatSessionId || null;
    const now = Date.now();
    if (previousSessionId) {
      botsStore.closeChat(previousSessionId, now);
    }
    const nextSessionId = `bot-home-${bot.id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
    await ensureControllerSession({
      sessionId: nextSessionId,
      cwd: homeDirFor(bot),
      title: bot.name,
      owner: BOT_OWNER_HOME,
      launch: bot.launch,
      permissionMode: bot.permissionMode,
      botId: bot.id,
    });
    botsStore.upsertChat({
      sessionId: nextSessionId,
      botId: bot.id,
      kind: 'home',
      origin: 'home',
      title: 'Home Chat',
      createdAt: now,
      updatedAt: now,
    }, now);
    botsStore.updateBot(bot.id, { chatSessionId: nextSessionId }, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['chats', 'bot'] });
    return { ok: true, botId: bot.id, sessionId: nextSessionId, previousSessionId };
  }

  /** @param {string} botId @param {Record<string, any>} [options] */
  async function startSideChat(botId, options = {}) {
    const bot = requireBot(botId);
    const isBackground = options.isBackground === true || options.owner === BOT_OWNER_AUTOMATION;
    const gate = checkBudgetGate(bot.id, { isBackground });
    if (!gate.allowed) {
      return {
        ok: false,
        botId: bot.id,
        sessionId: null,
        blocked: true,
        code: gate.reason,
        deferUntilMs: gate.deferUntilMs ?? null,
        error: gate.reason,
      };
    }
    const now = Date.now();
    const sessionId = options.sessionId || `bot-chat-${bot.id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
    const title = String(options.title ?? '').trim() || `${bot.name} · 支线聊天`;
    const owner = options.owner || BOT_OWNER_CHAT;
    const cwd = options.cwd || homeDirFor(bot);
    await ensureControllerSession({
      sessionId,
      cwd,
      title,
      owner,
      preset: options.preset ?? BOT_PRESET_ID,
      launch: options.launch ?? bot.launch,
      permissionMode: options.permissionMode ?? bot.permissionMode,
      botId: bot.id,
    });
    const chat = botsStore.upsertChat({
      sessionId,
      botId: bot.id,
      kind: options.kind || 'side',
      origin: options.origin || 'side',
      title,
      externalSource: options.externalSource ?? null,
      externalId: options.externalId ?? null,
      createdAt: now,
      updatedAt: now,
    }, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['chats'] });
    return { ok: true, botId: bot.id, sessionId, chat };
  }

  async function sendKickoff(bot, { template = null, note = null } = {}) {
    const prompt = template
      ? botTemplateKickoff(template)
      : (note ? `${BOT_CREATED_KICKOFF} ${note}` : BOT_CREATED_KICKOFF);
    setKickoffState(bot.id, { status: 'running', step: 'start', prompt, error: null });
    const opened = await openHomeChat(bot.id);
    const controller = controllerOf();
    if (!controller || typeof controller.prompt !== 'function') {
      setKickoffState(bot.id, { status: 'ready', step: 'done', prompt, error: null });
      return { ok: false, sessionId: opened.sessionId, queued: false };
    }
    setKickoffState(bot.id, { status: 'running', step: 'first-message', prompt, error: null });
    try {
      await controller.prompt({
        requestId: `bot-kickoff-${crypto.randomUUID()}`,
        sessionId: opened.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
      }, freshSignal());
      return { ok: true, sessionId: opened.sessionId, queued: true };
    } catch (error) {
      const msg = String(error?.message ?? error);
      setKickoffState(bot.id, { status: 'failed', step: 'first-message', prompt, error: msg });
      return { ok: false, sessionId: opened.sessionId, error: msg };
    }
  }

  async function retryKickoff(botId) {
    const bot = requireBot(botId);
    const prev = kickoffLog.get(bot.id);
    return sendKickoff(bot, prev?.prompt ? { note: prev.prompt.replace(BOT_CREATED_KICKOFF, '').trim() } : {});
  }

  async function takeOverWorkspace(botId, { cwd, title = null, chat = 'home', prompt = null }) {
    const bot = requireBot(botId);
    if (!cwd || typeof cwd !== 'string') {
      throw Object.assign(new Error('cwd is required for takeOver'), { code: 'invalid_argument' });
    }
    const now = Date.now();
    const handed = Array.isArray(bot.handedPairedWorkspaces) ? [...bot.handedPairedWorkspaces] : [];
    const entry = { environmentId: 'local', worktreeId: path.resolve(cwd), at: now };
    const filtered = handed.filter((h) => h.worktreeId !== entry.worktreeId).slice(-49);
    filtered.push(entry);
    botsStore.updateBot(bot.id, { handedPairedWorkspaces: filtered }, now);

    const target = chat === 'new'
      ? await startSideChat(bot.id, { title: title || path.basename(cwd), cwd: entry.worktreeId })
      : await openHomeChat(bot.id);
    const text = prompt || `已将工作区 \`${entry.worktreeId}\` 移交给你负责。请先了解当前仓库状态并回报。`;
    const controller = controllerOf();
    if (typeof controller?.prompt === 'function') {
      await controller.prompt({
        requestId: `bot-takeover-${crypto.randomUUID()}`,
        sessionId: target.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      }, freshSignal()).catch(() => null);
    }
    eventBus.emit({ botIds: [bot.id], kinds: ['bot', 'chats', 'workers'] });
    return { ok: true, botId: bot.id, sessionId: target.sessionId, cwd: entry.worktreeId };
  }

  function runSingleTurn(sessionId, promptText, { timeoutMs = TURN_TIMEOUT_DEFAULT_MS, botId = null, isBackground = false } = {}) {
    const resolvedBotId = botId || botsStore.getChat(String(sessionId))?.botId || null;
    if (resolvedBotId) {
      const gate = checkBudgetGate(resolvedBotId, { isBackground });
      if (!gate.allowed) {
        return Promise.resolve({
          ok: false,
          blocked: true,
          code: gate.reason,
          deferUntilMs: gate.deferUntilMs ?? null,
          error: gate.reason,
          reply: '',
        });
      }
    }
    const controller = controllerOf();
    if (!controller || typeof controller.prompt !== 'function') {
      return Promise.resolve({ ok: false, error: 'session-controller-unavailable', reply: '' });
    }
    if (typeof controller.runTurnForTest === 'function') {
      return Promise.resolve(controller.runTurnForTest(sessionId, promptText));
    }
    const requestId = `bot-turn-${crypto.randomUUID()}`;
    const ac = new AbortController();
    return new Promise((resolve) => {
      let mine = false;
      const texts = [];
      let off = null;
      const finish = (result) => {
        clearTimeout(timer);
        try { off?.(); } catch { /* Best-effort dispose. */ }
        ac.abort();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'timeout', reply: texts.join('\n').trim() }), timeoutMs);
      off = typeof ctx?.on === 'function'
        ? ctx.on('session/event', (session, event) => {
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
      controller.prompt({ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: promptText }] }, ac.signal)
        .catch((err) => finish({ ok: false, error: String(err?.message ?? err), reply: '' }));
    });
  }

  function decorateChatRow(chat, bot) {
    const live = liveBySession.get(chat.sessionId);
    const dotState = live?.state ?? 'idle';
    const lastActiveAt = Math.max(chat.updatedAt ?? 0, live?.updatedAt ?? 0);
    const unread = Boolean(live?.updatedAt && (!chat.seenAt || live.updatedAt > chat.seenAt));
    const workers = workStore.listWork({ botId: bot.id, limit: 50 })
      .filter((w) => w.externalId === chat.sessionId);
    const running = workers.filter((w) => !w.closedAt).map((w) => ({
      id: w.id, dispatchId: w.dispatchId, taskId: w.taskId, state: 'running', createdAt: w.createdAt,
    }));
    const finished = workers.filter((w) => Boolean(w.closedAt)).map((w) => ({
      id: w.id, dispatchId: w.dispatchId, taskId: w.taskId, state: w.closeReason === 'start_failed' ? 'failed' : 'done',
      closedAt: w.closedAt,
    }));
    return {
      ...chat,
      id: chat.sessionId,
      isHome: bot.chatSessionId === chat.sessionId,
      closed: Boolean(chat.closedAt),
      dotState,
      live: liveKindFromDot(dotState),
      preview: live?.preview ?? chat.preview ?? null,
      lastActiveAt,
      unread,
      running,
      runningTotal: running.length,
      finished,
    };
  }

  function listChats(botId, { includeClosed = true } = {}) {
    const bot = requireBot(botId);
    const rows = botsStore.listChats(bot.id, { includeClosed });
    return orderBotChats(rows.map((row) => decorateChatRow(row, bot)));
  }

  function searchChats({ botId = null, query = '', limit = 50 } = {}) {
    const needle = String(query ?? '').trim().toLowerCase();
    const bots = botId ? [requireBot(botId)] : botsStore.listBots();
    const matches = [];
    for (const bot of bots) {
      for (const chat of listChats(bot.id, { includeClosed: true })) {
        const hay = `${chat.title ?? ''} ${chat.preview ?? ''} ${bot.name}`.toLowerCase();
        if (!needle || hay.includes(needle)) {
          matches.push({ ...chat, botName: bot.name });
        }
      }
    }
    return matches.sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, Math.min(200, Math.max(1, limit)));
  }

  function markSeen(sessionId) {
    const now = Date.now();
    const chat = botsStore.getChat(sessionId);
    botsStore.markChatSeen(sessionId, now);
    if (chat?.botId) eventBus.emit({ botIds: [chat.botId], kinds: ['chats', 'status'] });
    return { ok: true, sessionId, seenAt: now };
  }

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

  function buildChatTree(botId) {
    const bot = requireBot(botId);
    const chats = listChats(bot.id, { includeClosed: true });
    return { botId: bot.id, homeSessionId: bot.chatSessionId ?? null, chats };
  }

  function buildActivity(botId) {
    const bot = requireBot(botId);
    const allWork = workStore.listWork({ botId: bot.id, limit: 100 });
    const workers = allWork.filter((w) => !w.closedAt);
    const completed = allWork.filter((w) => Boolean(w.closedAt)).slice(0, 20);
    const automations = typeof deps.getAutomations === 'function'
      ? deps.getAutomations(bot.id)
      : workStore.listAutomations({ botId: bot.id });
    const waits = automations.filter((a) => a.once && a.enabled);
    const regularAutomations = automations.filter((a) => !a.once);
    const upNext = typeof deps.getLookAroundUpNext === 'function' ? deps.getLookAroundUpNext(bot.id) : [];
    const inProgress = listChats(bot.id, { includeClosed: false }).filter((c) => c.live !== 'idle');
    return { workers, inProgress, completed, automations: regularAutomations, waits, upNext };
  }

  async function listModels() {
    const controller = controllerOf();
    if (typeof controller?.modelCatalog !== 'function') return { default: null, groups: [] };
    try {
      const catalog = await controller.modelCatalog();
      return { default: catalog?.default ?? null, groups: normalizeModelCatalog(catalog) };
    } catch {
      return { default: null, groups: [] };
    }
  }

  function computeBotSummary(bot, { needsYouCount = 0, upNextCount = 0, waits = [] } = {}) {
    const homePath = homeDirFor(bot);
    const soul = readSoul(homePath);
    const description = soulDescription(soul.text);
    const chats = listChats(bot.id, { includeClosed: false });
    const homeChat = chats.find((c) => c.isHome) ?? null;
    const rows = chats.map((c) => ({
      sessionId: c.sessionId,
      paneKey: c.sessionId,
      state: c.dotState,
      updatedAt: c.lastActiveAt,
      statusText: c.preview,
      needsYou: c.live === 'needs-you',
      live: c.live === 'replying',
    }));
    const sideChats = chats.filter((c) => !c.isHome).map((c) => ({ paneKey: c.sessionId, title: c.title }));
    const activityLine = resolveBotRowActivityLine({
      paused: Boolean(bot.paused),
      chatSessionId: bot.chatSessionId,
      rows,
      chats: sideChats,
      itemsNeedingYou: needsYouCount,
      startingSessionIds: startingSessions,
      waits,
      description,
    });
    const ownDot = homeChat?.dotState ?? 'idle';
    const otherDots = chats.filter((c) => !c.isHome).map((c) => c.dotState);
    const dotState = needsYouCount > 0 ? 'permission' : rollUpBotStatus(ownDot, otherDots);
    const unread = chats.some((c) => c.unread);
    const lastActiveAt = Math.max(bot.updatedAt ?? 0, ...chats.map((c) => c.lastActiveAt ?? 0));
    const kickoffEntry = kickoffLog.get(bot.id);
    const kickoff = bot.firstRun === true && kickoffEntry
      ? formatKickoffView(kickoffEntry)
      : (kickoffEntry ? formatKickoffView({ ...kickoffEntry, status: 'ready', step: 'done', error: null }) : undefined);
    return {
      ...bot,
      homePath,
      description,
      activityLine,
      dotState,
      unread,
      needsYouCount,
      upNextCount,
      lastActiveAt,
      ...(kickoff ? { kickoff } : {}),
    };
  }

  function settleKickoffOnTurnEnd(botId, sid, event) {
    const entry = kickoffLog.get(botId);
    if (!entry || entry.status !== 'running') return;
    const bot = botsStore.getBot(botId);
    if (!bot || bot.chatSessionId !== sid) return;
    const kind = event?.data?.reason?.kind;
    if (kind === 'error') {
      const msg = String(event?.data?.reason?.message ?? 'First message failed');
      setKickoffState(botId, { status: 'failed', step: 'first-message', error: msg });
    } else {
      setKickoffState(botId, { status: 'ready', step: 'done', error: null });
    }
  }

  const offEvents = typeof ctx?.on === 'function'
    ? ctx.on('session/event', (session, event) => {
      const sid = String(session?.id ?? session ?? '');
      const chat = sid ? botsStore.getChat(sid) : null;
      if (!chat?.botId) return;
      const now = Date.now();
      const prev = liveBySession.get(sid) ?? { state: 'idle', updatedAt: now, preview: null, lastBotId: chat.botId };
      const delta = nextLiveStateFromEvent(event, prev);
      if (!delta) return;
      liveBySession.set(sid, { ...delta, updatedAt: now, lastBotId: chat.botId });
      if (event?.type === 'turn/end') settleKickoffOnTurnEnd(chat.botId, sid, event);
      eventBus.emit({ botIds: [chat.botId], kinds: ['status', 'chats'] });
    }, { global: true })
    : null;

  function close() {
    try { offEvents?.(); } catch { /* Ignore cleanup error. */ }
    liveBySession.clear();
    startingSessions.clear();
  }

  return {
    homeDirFor,
    openHomeChat,
    resetHomeChat,
    startSideChat,
    sendKickoff,
    retryKickoff,
    takeOverWorkspace,
    runSingleTurn,
    applyLaunchModel,
    listChats,
    searchChats,
    markSeen,
    markUnseen,
    buildChatTree,
    buildActivity,
    listModels,
    computeBotSummary,
    close,
  };
}
