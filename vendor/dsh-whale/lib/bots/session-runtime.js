/**
 * Harness session bridge, live dot-state tracker, chat tree, and activity
 * projector for WhaleIsle Bots.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import {
  BOT_CREATED_KICKOFF,
  botTemplateKickoff,
  isBotCreatedKickoff,
  resolveBotRowActivityLine,
  rollUpBotStatus,
  soulDescription,
} from '../../src/shared/index.js';
import { isTaintingEvent } from '../call-origin.js';
import {
  controllerFrom,
  eventText,
  sessionIdFromRow,
  sessionRowsFrom,
  trimTo,
} from '../shared.js';
import { botsRootDir, readSoul } from './fs-home.js';
import { BOT_PRESET_ID } from './prompt-engine.js';
import { createOwedMailDrainer } from './session-mail.js';
import { createSessionWorkOps } from './session-work.js';

export const BOT_OWNER_HOME = 'dsh-bots:home';
export const BOT_OWNER_CHAT = 'dsh-bots:chat';
export const BOT_OWNER_GROUP_MEMBER = 'dsh-bots:group-member';
export const BOT_OWNER_WORK = 'dsh-bots:work';
export const BOT_OWNER_AUTOMATION = 'dsh-bots:automation';

const TURN_TIMEOUT_DEFAULT_MS = 120_000;
const freshSignal = () => new AbortController().signal;

const INTERNAL_RPC_PREFIXES = ['bot-kickoff-', 'bot-item-mail-', 'bot-turn-', 'bot-takeover-', 'whale-pulse-'];

/** @param {string} action */
export function buildControllerUnavailableRefusal(action = 'start-session') {
  return {
    code: 'session-controller-unavailable',
    reason: 'Harness session controller is unavailable or still starting. Wait for the desktop host to become ready and try again.',
    recoverable: true,
    action,
  };
}

/** @param {string} action */
function makeControllerUnavailableError(action) {
  const refusal = buildControllerUnavailableRefusal(action);
  return Object.assign(new Error(`${refusal.code}: ${refusal.reason}`), {
    code: refusal.code,
    refusal,
  });
}

/** @param {any} event @param {any} chat */
function isRealOwnerMessageEvent(event, chat) {
  if (!event || event.type !== 'user/message') return false;
  if (chat?.kind === 'look-around' || chat?.kind === 'worker' || chat?.kind === 'automation') return false;
  if (isTaintingEvent(event)) return false;
  const source = event.data?.source ?? {};
  const kind = String(source.kind ?? '');
  if (kind && kind !== 'user' && kind !== 'owner' && kind !== 'dsh-im:inbound') return false;
  const rpcId = String(source.rpcId ?? '');
  if (INTERNAL_RPC_PREFIXES.some((prefix) => rpcId.startsWith(prefix))) return false;
  const text = eventText(event);
  if (isBotCreatedKickoff(text)) return false;
  return true;
}

/** @param {any} launch */
export function parseLaunchModel(launch) {
  if (!launch || typeof launch !== 'object') return null;
  const rawModel = String(launch.model ?? '').trim();
  const optProvider = String(launch.options?.provider ?? '').trim();
  const reasoningEffort = String(launch.options?.reasoningEffort ?? launch.options?.effort ?? '').trim();
  let provider = optProvider;
  let model = rawModel;
  if (provider && model.startsWith(`${provider}/`)) {
    model = model.slice(provider.length + 1).trim();
  } else if (!provider && rawModel.includes('/')) {
    const slash = rawModel.indexOf('/');
    provider = rawModel.slice(0, slash).trim();
    model = rawModel.slice(slash + 1).trim();
  }
  if (!provider || !model) return null;
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
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

/** @param {any} ctrl @param {any} launch @param {boolean} fallbackDefault @param {boolean} strictRequire */
async function resolveRouteToApply(ctrl, launch, fallbackDefault, strictRequire) {
  const direct = parseLaunchModel(launch);
  if (direct || !fallbackDefault) return direct;
  const def = (await ctrl?.modelCatalog?.())?.default;
  if (!def?.provider || !def?.model) {
    if (strictRequire) throw new Error('default-model-unavailable');
    return null;
  }
  const effort = String(launch?.options?.reasoningEffort ?? launch?.options?.effort ?? '').trim();
  return { provider: def.provider, model: def.model, ...(effort ? { reasoningEffort: effort } : {}) };
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
 *   getLookAroundUpNext?: (botId: string) => any[],
 *   getAutomations?: (botId: string) => any[],
 *   onFirstOwnerChat?: (botId: string) => any,
 * }} deps
 */
export function createSessionRuntime(deps) {
  const { ctx, dshHome, botsStore, itemsStore, workStore, eventBus } = deps;
  const controllerOf = () => (typeof deps.getController === 'function' ? deps.getController() : controllerFrom(ctx));

  /** @type {Map<string, { state: string, updatedAt: number, preview: string | null, lastBotId: string | null }>} */
  const liveBySession = new Map();
  /** @type {Map<string, { status: 'pending' | 'running' | 'ready' | 'failed', step: 'create' | 'start' | 'first-message' | 'done', prompt: string, startedAt: number, updatedAt: number, error: string | null }>} */
  const kickoffLog = new Map();
  /** @type {Set<string>} */
  const startingSessions = new Set();
  /** @type {Map<string, Set<{ abort: () => void }>>} */
  const inFlightTurns = new Map();

  /** @param {string} botId @param {any} patch */
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

  /** @param {any} bot */
  function homeDirFor(bot) {
    return path.join(botsRootDir(dshHome), bot.folder);
  }

  /** @param {string} botId */
  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  /** @param {any} controller @param {string} sessionId @param {any} launch @param {any} [options] */
  async function applyLaunchModel(controller, sessionId, launch, options = {}) {
    const { strict = false, fallbackDefault = false, requireController = false } = options;
    const ctrl = controller ?? controllerOf();
    const route = await resolveRouteToApply(ctrl, launch, fallbackDefault, strict && requireController);
    if (!route) return false;
    if (typeof ctrl?.selectModel !== 'function') {
      if (strict && requireController) throw makeControllerUnavailableError('select-model');
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

  async function ensureControllerSession({ sessionId, cwd, title, owner, preset = BOT_PRESET_ID, launch = null }) {
    const controller = controllerOf();
    if (!controller || typeof controller.create !== 'function') {
      return {
        ok: false,
        sessionId,
        created: false,
        error: 'session-controller-unavailable',
        refusal: buildControllerUnavailableRefusal('ensure-session'),
      };
    }
    let existing = false;
    if (typeof controller.list === 'function') {
      const rows = sessionRowsFrom(await controller.list({}, freshSignal()));
      existing = rows.some((row) => sessionIdFromRow(row) === sessionId);
    }
    if (!existing) {
      startingSessions.add(sessionId);
      try {
        await controller.create({
          sessionId,
          cwd,
          agentPreset: preset,
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

  /** @param {string} botId @param {any} [options] */
  async function startSideChat(botId, options = {}) {
    const bot = requireBot(botId);
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
      launch: options.launch ?? bot.launch,
    });
    const chat = botsStore.upsertChat({
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
      return {
        ok: false,
        sessionId: opened.sessionId,
        queued: false,
        error: 'session-controller-unavailable',
        refusal: buildControllerUnavailableRefusal('kickoff'),
      };
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

  /** @param {string} sessionId @param {{ abort: () => void }} entry */
  function registerInFlight(sessionId, entry) {
    const key = String(sessionId);
    let set = inFlightTurns.get(key);
    if (!set) {
      set = new Set();
      inFlightTurns.set(key, set);
    }
    set.add(entry);
    return () => {
      const current = inFlightTurns.get(key);
      if (!current) return;
      current.delete(entry);
      if (current.size === 0) inFlightTurns.delete(key);
    };
  }

  /** @param {string} sessionId */
  async function cancelSession(sessionId) {
    const sid = String(sessionId ?? '').trim();
    if (!sid) return { ok: false, sessionId: '', cancelled: false };
    let cancelled = false;
    const entries = inFlightTurns.get(sid);
    if (entries && entries.size > 0) {
      for (const entry of [...entries]) {
        try {
          entry.abort();
          cancelled = true;
        } catch {
          // Best-effort abort.
        }
      }
      inFlightTurns.delete(sid);
    }

    const controller = controllerOf();
    const cancelMethod = typeof controller?.cancel === 'function'
      ? () => controller.cancel({ sessionId: sid }, freshSignal())
      : (typeof controller?.abort === 'function'
        ? () => controller.abort({ sessionId: sid }, freshSignal())
        : (typeof controller?.interrupt === 'function'
          ? () => controller.interrupt({ sessionId: sid }, freshSignal())
          : null));
    if (cancelMethod) {
      try {
        await cancelMethod();
        cancelled = true;
      } catch {
        // Best-effort underlying controller abort.
      }
    }

    const live = liveBySession.get(sid);
    if (live && (live.state === 'working' || live.state === 'permission' || live.state === 'monitoring')) {
      liveBySession.set(sid, { ...live, state: 'interrupted', updatedAt: Date.now() });
      if (live.lastBotId) {
        eventBus.emit({ botIds: [live.lastBotId], kinds: ['status', 'chats'] });
      }
    }
    return { ok: true, sessionId: sid, cancelled };
  }

  /** @param {string} sessionId @param {string} promptText @param {{ timeoutMs?: number }} [opts] */
  function runSingleTurn(sessionId, promptText, { timeoutMs = TURN_TIMEOUT_DEFAULT_MS } = {}) {
    const controller = controllerOf();
    if (!controller || (typeof controller.prompt !== 'function' && typeof controller.runTurnForTest !== 'function')) {
      return Promise.resolve({
        ok: false,
        error: 'session-controller-unavailable',
        refusal: buildControllerUnavailableRefusal('run-turn'),
        reply: '',
      });
    }
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
        Promise.resolve(controller.runTurnForTest(sessionId, promptText, ac.signal))
          .then((res) => finish(res))
          .catch((err) => finish({ ok: false, error: String(err?.message ?? err), reply: '' }));
      });
    }
    const requestId = `bot-turn-${crypto.randomUUID()}`;
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
      controller.prompt({ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: promptText }] }, ac.signal)
        .catch((/** @type {any} */ err) => finish({ ok: false, error: String(err?.message ?? err), reply: '' }));
    });
  }

  const mailDrainer = createOwedMailDrainer({
    itemsStore,
    botsStore,
    controllerOf,
    openHomeChat,
    buildControllerUnavailableRefusal,
  });

  /** @param {{ itemsStore?: any, botsStore?: any }} [opts] */
  function deliverOwedMail(opts = {}) {
    return mailDrainer.deliverOwedMail(opts);
  }

  function sendOwedMail() {
    return mailDrainer.deliverOwedMail({ itemsStore, botsStore });
  }

  const {
    deleteChat,
    stopWork,
    listChats,
    searchChats,
    markSeen,
    markUnseen,
    buildChatTree,
    buildActivity,
  } = createSessionWorkOps({
    botsStore,
    workStore,
    eventBus,
    liveBySession,
    startingSessions,
    inFlightTurns,
    controllerOf,
    requireBot,
    cancelSession,
    getAutomations: deps.getAutomations,
    getLookAroundUpNext: deps.getLookAroundUpNext,
  });

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

  function computeBotSummary(bot, { needsYouCount = 0, upNextCount = 0, waits = [], chats: preloadedChats = null } = {}) {
    const homePath = homeDirFor(bot);
    const soul = readSoul(homePath);
    const description = soulDescription(soul.text);
    const chats = Array.isArray(preloadedChats) ? preloadedChats : listChats(bot.id, { includeClosed: false });
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
      if (isRealOwnerMessageEvent(event, chat)) {
        try { deps.onFirstOwnerChat?.(chat.botId); } catch { /* Best-effort look-around arming. */ }
      }
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
    for (const entries of inFlightTurns.values()) {
      for (const entry of entries) {
        try { entry.abort(); } catch { /* Ignore abort error on close. */ }
      }
    }
    inFlightTurns.clear();
    mailDrainer.reset();
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
    cancelSession,
    deliverOwedMail,
    sendOwedMail,
    deleteChat,
    stopWork,
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
