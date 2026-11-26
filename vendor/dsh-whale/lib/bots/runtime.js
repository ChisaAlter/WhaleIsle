/**
 * Top-level Bots Runtime assembly (`createBotsRuntime`).
 * Wires SQLite stores, legacy Whale read-only migration, FTS5 memory service,
 * Tool WAL, Worktree runner, Per-Bot MCP manager, Budget service, Mail reconciler,
 * IM Outbound bridge, event bus, session runtime, Look Around, Tidy-up, Groups,
 * Automations, Connectors, Share/Import, Legacy compat, safe desktop bridges,
 * and the `/dsh-bots` HTTP router.
 */
import fs from 'node:fs';
import path from 'node:path';
import { botsDbPath, openBotsDatabase } from './db.js';
import { createItemsStore } from './items-store.js';
import { createGroupsStore } from './groups-store.js';
import { createWorkStore } from './work-store.js';
import { botMetaDir, botsRootDir } from './fs-home.js';
import { createMemoryService } from './memory-service.js';
import { migrateLegacyWhaleIfNeeded } from './legacy-migration.js';
import { createBotsEventBus } from './event-bus.js';
import { createSessionRuntime } from './session-runtime.js';
import { createBotsService } from './service.js';
import { createLookAroundService } from './look-around-service.js';
import { createTidyUpService } from './tidy-up-service.js';
import { createGroupsService } from './groups-service.js';
import { createAutomationsService } from './automations-service.js';
import { createConnectorsService } from './connectors-service.js';
import { createShareImportService } from './share-import-service.js';
import { createLegacyCompat } from './legacy-compat.js';
import { createToolWalManager } from './tool-wal.js';
import { createWorktreeRunner } from './worktree-runner.js';
import { createMcpManager } from './mcp-manager.js';
import { createBudgetService } from './budget-service.js';
import { createMailReconciler } from './mail-reconciler.js';
import { createBotsHttpHandler } from './rpc-router.js';
import { installBotPromptAndTurnHooks } from './prompt-engine.js';
import { setActiveBotsRuntime } from './bot-tools-registry.js';
import { botPresetDefinition, botWorkerPresetDefinition } from '../preset.js';
import { bindImNeedsYouActionHandler, resolveRawImOutboundBridge } from './im-needs-you.js';

const SKILL_RECORDER_SYMBOL = Symbol.for('whaleisle.desktop.skill-recorder');
const PET_VOICE_BRIDGE_SYMBOL = Symbol.for('whaleisle.desktop.pet-voice');

/**
 * Create a lazy IM outbound bridge facade that dynamically resolves
 * `dsh-im`'s registered bridge via `Symbol.for('whaleisle.dsh-im.bot-outbound-bridge')`
 * (or `ctx`/`options`), adapting `deliverReply` for `sendText`/`deliver` consumers.
 * @param {{ explicitBridge?: any, ctx?: any }} params
 */
function createLazyImOutboundBridge({ explicitBridge = null, ctx = null }) {
  const resolveRaw = () => resolveRawImOutboundBridge({ explicitBridge, ctx });

  /** @param {any} raw */
  const adaptSend = (raw) => {
    if (!raw || typeof raw !== 'object') return undefined;
    if (typeof raw.sendText === 'function') return (/** @type {any} */ payload) => raw.sendText(payload);
    if (typeof raw.deliver === 'function') return (/** @type {any} */ payload) => raw.deliver(payload);
    if (typeof raw.deliverReply === 'function') {
      return (/** @type {any} */ payload) => raw.deliverReply({
        botId: payload?.botId,
        channel: payload?.channel,
        accountId: payload?.accountId,
        targetId: payload?.targetId ?? payload?.chatId ?? payload?.sessionId ?? '',
        text: payload?.text,
        card: payload?.card,
        replyTo: payload?.replyTo ?? payload?.replyToMessageId,
        signal: payload?.signal,
      });
    }
    return undefined;
  };

  return {
    get current() { return resolveRaw(); },
    get sendText() { return adaptSend(resolveRaw()); },
    get deliver() { return adaptSend(resolveRaw()); },
    get deliverReply() {
      const raw = resolveRaw();
      return typeof raw?.deliverReply === 'function' ? raw.deliverReply.bind(raw) : undefined;
    },
    get sendNeedsYouCard() {
      const raw = resolveRaw();
      return typeof raw?.sendNeedsYouCard === 'function' ? raw.sendNeedsYouCard.bind(raw) : undefined;
    },
  };
}

/**
 * Create safe desktop bridge methods (`recordSkillDraft`, `voiceState`, `voiceToggle`)
 * that gracefully degrade to `capture_unavailable` / `voice_unavailable` in headless
 * or hardware-absent environments.
 * @param {{ ctx?: any, options?: any }} params
 */
function createDesktopCapabilityBridges({ ctx = null, options = {} }) {
  async function recordSkillDraft(params = {}) {
    const provider = options.recordSkillDraft
      ?? ctx?.get?.('desktopSkillRecorder')
      ?? /** @type {Record<symbol, any>} */ (globalThis)[SKILL_RECORDER_SYMBOL]
      ?? null;
    const fn = typeof provider === 'function'
      ? provider
      : (typeof provider?.recordSkillDraft === 'function' ? provider.recordSkillDraft.bind(provider) : null);
    if (!fn) {
      return {
        ok: false,
        reason: 'capture_unavailable',
        message: 'Desktop screen capture is unavailable in this environment.',
      };
    }
    try {
      const res = await fn(params ?? {});
      if (res && typeof res === 'object') return res;
      return { ok: false, reason: 'capture_unavailable', message: 'Empty skill recording draft response.' };
    } catch (error) {
      const err = /** @type {any} */ (error);
      return {
        ok: false,
        reason: String(err?.code || 'capture_unavailable'),
        message: String(err?.message ?? err),
      };
    }
  }

  function resolveVoiceBridge() {
    return options.voiceBridge
      ?? ctx?.get?.('petVoiceBridge')
      ?? /** @type {Record<symbol, any>} */ (globalThis)[PET_VOICE_BRIDGE_SYMBOL]
      ?? null;
  }

  function voiceUnavailable(message = 'Desktop pet voice is unavailable in this environment.') {
    return {
      ok: false,
      available: false,
      enabled: false,
      state: 'unavailable',
      reason: 'voice_unavailable',
      message,
    };
  }

  async function voiceState() {
    const bridge = resolveVoiceBridge();
    const fn = typeof bridge?.getVoiceState === 'function'
      ? bridge.getVoiceState.bind(bridge)
      : (typeof bridge?.getState === 'function' ? bridge.getState.bind(bridge) : null);
    if (!fn) return voiceUnavailable();
    try {
      const raw = await fn();
      if (!raw || typeof raw !== 'object') return voiceUnavailable();
      const available = raw.available !== false && raw.reason !== 'voice_unavailable';
      return {
        ok: available,
        available,
        enabled: Boolean(raw.enabled),
        state: available ? (raw.state ?? 'idle') : 'unavailable',
        ...(!available ? { reason: raw.reason ?? 'voice_unavailable' } : {}),
        ...raw,
      };
    } catch (error) {
      const err = /** @type {any} */ (error);
      return voiceUnavailable(String(err?.message ?? err));
    }
  }

  /** @param {boolean} enabled */
  async function voiceToggle(enabled) {
    const bridge = resolveVoiceBridge();
    const fn = typeof bridge?.toggleVoice === 'function'
      ? bridge.toggleVoice.bind(bridge)
      : (typeof bridge?.toggle === 'function' ? bridge.toggle.bind(bridge) : null);
    if (!fn) return voiceUnavailable();
    try {
      const raw = await fn(Boolean(enabled));
      if (!raw || typeof raw !== 'object') return voiceUnavailable();
      if (raw.ok === false || raw.reason === 'voice_unavailable' || raw.available === false) {
        return {
          ...voiceUnavailable(raw.message),
          ...raw,
          ok: false,
          available: false,
          reason: raw.reason ?? 'voice_unavailable',
        };
      }
      return {
        ok: true,
        available: true,
        enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : Boolean(enabled),
        state: raw.state ?? (enabled ? 'listening' : 'idle'),
        ...raw,
      };
    } catch (error) {
      const err = /** @type {any} */ (error);
      return voiceUnavailable(String(err?.message ?? err));
    }
  }

  return { recordSkillDraft, voiceState, voiceToggle };
}

/**
 * Boot the complete Bots runtime for a given `$DSH_HOME`.
 * @param {{
 *   ctx?: any,
 *   dshHome: string,
 *   userHomeDir?: string,
 *   allowLegacyMigration?: boolean,
 *   enableSchedulers?: boolean,
 *   enableFolderWatcher?: boolean,
 *   reconcileMailOnStart?: boolean,
 *   autoRecovery?: boolean,
 *   imService?: any,
 *   imSender?: any,
 *   getController?: () => any,
 *   imOutboundBridge?: any,
 *   probeMcpServer?: any,
 *   wakeBot?: any,
 *   recordSkillDraft?: any,
 *   voiceBridge?: any,
 *   onError?: (error: unknown, context?: Record<string, any>) => void,
 *   _skipImActionBinding?: boolean,
 *   getRecentOwnerMessages?: (bot: any, opts?: any) => Promise<any[]> | any[],
 *   runLookAroundSweep?: (bot: any, prompt: string) => Promise<{ ok: boolean, summary?: string }>,
 *   runTidyUpModel?: (bot: any, prompt: string) => Promise<string | null>,
 * }} options
 */
export function createBotsRuntime(options) {
  const { ctx = null, dshHome } = options;
  if (!dshHome) throw new Error('createBotsRuntime requires dshHome');

  let closed = false;
  /** @param {string} phase @param {unknown} error */
  const reportRuntimeError = (phase, error) => {
    if (typeof options.onError === 'function') {
      options.onError(error, { phase });
      return;
    }
    console.error(`[dsh-bots:runtime:${phase}]`, error instanceof Error ? error.message : String(error ?? 'unknown_error'));
  };

  const metaRoot = botMetaDir(dshHome);
  const dbHandle = openBotsDatabase({ dshHome });
  const { db, bots: botsStore } = dbHandle;
  const itemsStore = createItemsStore(db);
  const groupsStore = createGroupsStore(db);
  const workStore = createWorkStore(db);
  const memoryService = createMemoryService({ metaRoot, db });

  // Zero-LLM monthly journal hook: append closed Work Items to memory/journal/YYYY-MM.md
  itemsStore.onItemClosed((/** @type {any} */ item) => {
    const bot = botsStore.getBot(item?.ownerBotId);
    if (!bot) return;
    const homeDir = path.join(botsRootDir(dshHome), bot.folder);
    if (!fs.existsSync(homeDir)) return;
    const links = itemsStore.links(item.uid);
    memoryService.appendJournalEntry({
      homeDir,
      item: { ...item, links },
    });
  });

  const migration = migrateLegacyWhaleIfNeeded({
    dshHome,
    db,
    botsStore,
    allowMigration: options.allowLegacyMigration !== false,
  });

  const eventBus = createBotsEventBus({
    getNeedsYou: () => itemsStore.needsYouCounts(botsStore.listBots(), Date.now()),
  });

  const toolWal = createToolWalManager({ workStore });
  const toolWalRecovery = toolWal.recoverStaleIntents();
  const worktreeRunner = createWorktreeRunner({ metaRoot, workStore });
  const mcpManager = createMcpManager({ dshHome, botsStore, probeServer: options.probeMcpServer });
  const budgetService = createBudgetService({ workStore, botsStore, itemsStore, eventBus });
  const imOutboundBridge = createLazyImOutboundBridge({ explicitBridge: options.imOutboundBridge, ctx });
  const desktopBridges = createDesktopCapabilityBridges({ ctx, options });

  /** @type {any} */
  const runtime = {
    ctx,
    dshHome,
    dbHandle,
    db,
    botsStore,
    itemsStore,
    groupsStore,
    workStore,
    memoryService,
    eventBus,
    migration,
    toolWal,
    worktreeRunner,
    mcpManager,
    budgetService,
    imOutboundBridge,
    imService: options.imService ?? options.imSender ?? null,
    hadImService: Boolean(options.imService ?? options.imSender),
    hasCustomWakeBot: typeof options.wakeBot === 'function',
    startupRecovery: { toolWal: toolWalRecovery },
    onError: options.onError ?? null,
    isClosed: () => closed,
    recordSkillDraft: desktopBridges.recordSkillDraft,
    voiceState: desktopBridges.voiceState,
    voiceToggle: desktopBridges.voiceToggle,
  };

  runtime.sessionRuntime = createSessionRuntime({
    ctx,
    dshHome,
    botsStore,
    itemsStore,
    workStore,
    eventBus,
    budgetService,
    getController: options.getController,
    getLookAroundUpNext: (botId) => runtime.lookAroundService?.listUpNext(botId) ?? [],
    getAutomations: (botId) => runtime.automationsService?.list({ botId }) ?? [],
    onFirstOwnerChat: (botId) => runtime.lookAroundService?.markFirstOwnerChat?.(botId),
  });

  runtime.botsService = createBotsService({
    ctx,
    dshHome,
    db,
    botsStore,
    itemsStore,
    groupsStore,
    workStore,
    memoryService,
    sessionRuntime: runtime.sessionRuntime,
    eventBus,
    getLookAroundUpNextCount: (botId) => runtime.lookAroundService?.countOpenUpNext(botId) ?? 0,
    getLookAroundService: () => runtime.lookAroundService,
    getTidyUpService: () => runtime.tidyUpService,
    getAutomationsService: () => runtime.automationsService,
    getGroupsService: () => runtime.groupsService,
    getGroupsList: () => runtime.groupsService?.list() ?? [],
    onPetBotChanged: (bot) => { runtime.legacyCompat?.syncLegacySettingsProjection(bot); },
    onToolsChanged: (/** @type {string} */ botId) => mcpManager.syncBotMcps(botId),
  });

  runtime.legacyCompat = createLegacyCompat({
    dshHome,
    botsStore,
    botsService: runtime.botsService,
    sessionRuntime: runtime.sessionRuntime,
  });

  runtime.lookAroundService = createLookAroundService({
    dshHome,
    botsStore,
    sessionRuntime: runtime.sessionRuntime,
    eventBus,
    budgetService,
    onError: options.onError,
    runSweep: options.runLookAroundSweep,
    enableScheduler: options.enableSchedulers !== false,
  });

  runtime.tidyUpService = createTidyUpService({
    ctx,
    dshHome,
    botsStore,
    memoryService,
    sessionRuntime: runtime.sessionRuntime,
    eventBus,
    itemsStore,
    budgetService,
    enableScheduler: options.enableSchedulers !== false,
    runModel: options.runTidyUpModel,
    getRecentOwnerMessages: options.getRecentOwnerMessages,
  });

  runtime.groupsService = createGroupsService({
    botsStore,
    groupsStore,
    sessionRuntime: runtime.sessionRuntime,
    eventBus,
  });

  runtime.automationsService = createAutomationsService({
    botsStore,
    workStore,
    sessionRuntime: runtime.sessionRuntime,
    eventBus,
    itemsStore,
    imOutboundBridge,
    legacyCompat: runtime.legacyCompat,
    getGroupsService: () => runtime.groupsService,
    budgetGuard: (/** @type {{ botId: string, triggerKind: string, now: number }} */ { botId, triggerKind, now }) => budgetService.checkExecutionAllowed(botId, {
      isBackground: triggerKind !== 'manual',
      at: now,
    }),
    enableScheduler: options.enableSchedulers !== false,
    enableFolderWatcher: options.enableFolderWatcher !== false,
    onError: options.onError,
  });

  runtime.connectorsService = createConnectorsService({
    dshHome,
    botsStore,
    workStore,
    eventBus,
    onBotUpdated: (bot) => {
      if (botsStore.getGlobalConfig().petBotId === bot?.id || bot?.imDefault !== undefined) {
        runtime.legacyCompat?.syncLegacySettingsProjection(bot);
      }
    },
  });

  runtime.shareImportService = createShareImportService({
    dshHome,
    userHomeDir: options.userHomeDir,
    botsStore,
    workStore,
    botsService: runtime.botsService,
  });

  /** @type {Promise<any>} */
  let owedMailChain = Promise.resolve();
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  function serializeOwedMail(fn) {
    const run = owedMailChain.then(fn, fn);
    owedMailChain = run.catch(() => null);
    return run;
  }

  const rawMailReconciler = createMailReconciler({
    itemsStore,
    botsStore,
    sessionRuntime: runtime.sessionRuntime,
    eventBus,
    wakeBot: options.wakeBot,
  });
  runtime.mailReconciler = {
    reconcileOwedMail: (/** @type {any} */ opts) => serializeOwedMail(() => rawMailReconciler.reconcileOwedMail(opts)),
  };
  const rawSendOwedMail = runtime.sessionRuntime.sendOwedMail.bind(runtime.sessionRuntime);
  const rawDeliverOwedMail = runtime.sessionRuntime.deliverOwedMail.bind(runtime.sessionRuntime);
  runtime.sessionRuntime.sendOwedMail = () => serializeOwedMail(() => rawSendOwedMail());
  runtime.sessionRuntime.deliverOwedMail = (/** @type {any} */ opts) => serializeOwedMail(() => rawDeliverOwedMail(opts));

  runtime.http = createBotsHttpHandler(runtime);

  const disposeImActionBinding = options._skipImActionBinding === true
    ? () => {}
    : bindImNeedsYouActionHandler({
        ctx,
        explicitBridge: options.imOutboundBridge ?? null,
        getRuntime: () => runtime,
      });

  if (options.autoRecovery === false && options.reconcileMailOnStart !== false && typeof options.wakeBot === 'function' && itemsStore.owedMail().length > 0) {
    void Promise.resolve()
      .then(() => (closed ? null : runtime.mailReconciler.reconcileOwedMail()))
      .catch((error) => { reportRuntimeError('mail_reconciler_startup', error); });
  }

  /** @type {Promise<any>} */
  let recoveryChain = Promise.resolve();

  /**
   * Serial startup recovery:
   * 1. Drain owed Work Item mail
   * 2. Resume pending multi-bot group deliveries & sweep orphaned dead turns
   * 3. Backfill last 24h closed Work Items into each bot's monthly journal
   * 4. Start Tidy-Up scheduler when `options.enableSchedulers !== false`
   * @param {{ waitForReplies?: boolean }} [recoveryOptions]
   */
  runtime.startRecovery = (recoveryOptions = {}) => {
    const run = recoveryChain.then(async () => {
      if (closed) {
        return { ok: false, closed: true };
      }
      /** @type {any} */
      let mail = { ok: true, deliveredGroups: 0, deliveredEvents: 0, skippedGroups: 0, details: [] };
      /** @type {any} */
      let groups = { resumedCount: 0, cleanedDeadCount: 0, discardedCount: 0, operations: [] };
      const journal = { bots: 0, scanned: 0, appended: 0, skipped: 0 };

      if (!dbHandle.isReadOnly) {
        if (typeof options.wakeBot === 'function') {
          if (options.reconcileMailOnStart !== false) {
            const rec = await runtime.mailReconciler.reconcileOwedMail().catch((/** @type {any} */ err) => ({
              ok: false,
              error: String(err?.message ?? err),
              reconciledGroups: 0,
              markedEvents: 0,
              skippedGroups: 0,
            }));
            mail = {
              ok: rec.ok !== false,
              ...(rec.error ? { error: rec.error } : {}),
              deliveredGroups: rec.reconciledGroups ?? 0,
              deliveredEvents: rec.markedEvents ?? 0,
              skippedGroups: rec.skippedGroups ?? 0,
              details: [],
            };
          }
        } else {
          mail = await runtime.sessionRuntime.sendOwedMail().catch((/** @type {any} */ err) => ({
            ok: false,
            error: String(err?.message ?? err),
            deliveredGroups: 0,
            deliveredEvents: 0,
            skippedGroups: 0,
            details: [],
          }));
        }

        groups = await runtime.groupsService.resumePending({
          waitForReplies: recoveryOptions.waitForReplies === true,
        }).catch((/** @type {any} */ err) => ({
          resumedCount: 0,
          cleanedDeadCount: 0,
          discardedCount: 0,
          operations: [],
          error: String(err?.message ?? err),
        }));

        const allBots = botsStore.listBots();
        for (const bot of allBots) {
          const homeDir = path.join(botsRootDir(dshHome), bot.folder);
          if (!fs.existsSync(homeDir)) continue;
          const closedList = itemsStore.list({ ownerBotId: bot.id, closedOnly: true, limit: 200 }).items;
          const hydrated = closedList.filter(Boolean).map((/** @type {any} */ it) => ({ ...it, links: itemsStore.links(it.uid) }));
          const res = memoryService.backfillJournal24h({ homeDir, items: hydrated });
          journal.bots += 1;
          journal.scanned += res.scanned;
          journal.appended += res.appended;
          journal.skipped += res.skipped;
        }
      }

      let tidyUpSchedulerStarted = false;
      if (!closed && options.enableSchedulers !== false) {
        runtime.tidyUpService.startScheduler();
        tidyUpSchedulerStarted = true;
      }

      return { ok: true, mail, groups, journal, tidyUpSchedulerStarted };
    });
    recoveryChain = run.catch(() => null);
    return run;
  };

  if (options.autoRecovery !== false) {
    runtime.recoveryPromise = runtime.startRecovery().catch(() => null);
  }

  runtime.close = () => {
    if (closed) return;
    closed = true;
    try { disposeImActionBinding(); } catch { /* Best-effort IM action teardown. */ }
    runtime.tidyUpService.stopScheduler();
    runtime.automationsService.close();
    runtime.lookAroundService.close();
    runtime.tidyUpService.stopScheduler?.();
    runtime.tidyUpService.close();
    runtime.mcpManager.close();
    void Promise.resolve(runtime.worktreeRunner.cleanupAll()).catch((error) => {
      reportRuntimeError('worktree_cleanup', error);
    });
    runtime.sessionRuntime.close();
    runtime.eventBus.close();
    dbHandle.close();
  };

  return runtime;
}

/**
 * Mount the full Bots runtime into a Harness plugin `ctx` LAZILY so `bots.db`
 * is never opened or locked on disk until `/dsh-bots/*`, a `bot_*` tool, a
 * `dsh-bot` session, or an already-persisted `bots.db` is actually accessed.
 * On first open, `migrateLegacyWhaleIfNeeded` runs automatically.
 * @param {any} ctx
 * @param {{ home: string, allowLegacyMigration?: boolean }} options
 */
export function mountBotsIntoHost(ctx, { home, allowLegacyMigration = true }) {
  if (!home) return null;
  let instance = null;
  let disposed = false;
  const dbFile = botsDbPath(home);

  const ensureRuntime = () => {
    if (disposed) return null;
    if (!instance) {
      instance = createBotsRuntime({
        ctx,
        dshHome: home,
        allowLegacyMigration,
        _skipImActionBinding: true,
      });
    }
    return instance;
  };

  const getRuntimeIfReady = (hint = null) => {
    if (disposed) return null;
    if (instance) return instance;
    if (hint?.forceForBotPreset === true || fs.existsSync(dbFile)) {
      return ensureRuntime();
    }
    return null;
  };

  setActiveBotsRuntime(() => ensureRuntime());
  const disposePrompt = installBotPromptAndTurnHooks(ctx, (hint) => getRuntimeIfReady(hint));
  const disposeImActionBinding = bindImNeedsYouActionHandler({ ctx, getRuntime: () => ensureRuntime() });

  const disposeAll = () => {
    disposed = true;
    try { disposeImActionBinding?.(); } catch { /* Best-effort IM action teardown. */ }
    try { disposePrompt?.(); } catch { /* Best-effort prompt hook teardown. */ }
    setActiveBotsRuntime(null);
    if (instance) {
      const target = instance;
      instance = null;
      target.close();
    }
  };

  ctx.effect?.(() => disposeAll, 'dsh-bots:runtime');

  ctx.effect?.(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-bots',
    /** @param {any} request */
    auth: (request) => {
      const pathname = request?.url?.pathname ?? '';
      if (pathname.startsWith('/dsh-bots/webhooks/') || pathname.startsWith('/dsh-bots/assets/mascots/')) {
        return 'anonymous';
      }
      return 'required';
    },
    /** @param {any} req @param {any} res @param {any} [peer] */
    async handler(req, res, peer) {
      const rt = ensureRuntime();
      if (!rt) {
        res.writeHead(503);
        res.end('bots runtime unavailable');
        return;
      }
      await rt.http.handler(req, res, peer);
    },
  }), 'dsh-bots:http');

  ctx.inject?.(['agentPresets'], (host) => host.effect(async () => {
    const disposeBot = await host.agentPresets.register(botPresetDefinition(home));
    const disposeWorker = await host.agentPresets.register(botWorkerPresetDefinition(home));
    return () => {
      try { disposeWorker?.(); } catch { /* Best-effort worker preset teardown. */ }
      try { disposeBot?.(); } catch { /* Best-effort bot preset teardown. */ }
    };
  }));

  return {
    ensureRuntime,
    getRuntimeIfReady,
    close: disposeAll,
    get instance() { return instance; },
  };
}

/**
 * Delegate compatible `/dsh-whale/*` endpoints to the bound `petBotId` bot
 * when the Bots runtime is active (or `bots.db` already exists on disk);
 * returns `undefined` to fall through cleanly to legacy `scope`.
 * @param {any} botsRuntime
 * @param {string} endpoint
 * @param {any} input
 */
export async function delegateLegacyWhaleEndpoint(botsRuntime, endpoint, input) {
  const rt = typeof botsRuntime?.getRuntimeIfReady === 'function'
    ? botsRuntime.getRuntimeIfReady()
    : botsRuntime;
  const compat = rt?.legacyCompat;
  if (!compat || !compat.resolvePetBot()) return undefined;
  if (endpoint === 'assistant/ensure') return compat.ensurePetSession();
  if (endpoint === 'settings/get') return compat.getLegacySettings();
  if (endpoint === 'settings/update') return compat.updateLegacySettings(input);
  return undefined;
}
