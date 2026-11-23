/**
 * Top-level Bots Runtime assembly (`createBotsRuntime`).
 * Wires SQLite stores, legacy Whale read-only migration, memory service,
 * event bus, session runtime, Look Around, Tidy-up, Groups, Automations,
 * Connectors, Share/Import, Legacy compat, and the `/dsh-bots` HTTP router.
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
import { createBotsHttpHandler } from './rpc-router.js';
import { installBotPromptAndTurnHooks } from './prompt-engine.js';
import { setActiveBotsRuntime } from './bot-tools-registry.js';
import { botPresetDefinition } from '../preset.js';

/**
 * Boot the complete Bots runtime for a given `$DSH_HOME`.
 * @param {{
 *   ctx?: any,
 *   dshHome: string,
 *   userHomeDir?: string,
 *   enableSchedulers?: boolean,
 *   allowLegacyMigration?: boolean,
 *   autoRecovery?: boolean,
 *   imService?: any,
 *   imSender?: any,
 *   getController?: () => any,
 *   getRecentOwnerMessages?: (bot: any, opts?: any) => Promise<any[]> | any[],
 *   runLookAroundSweep?: (bot: any, prompt: string) => Promise<{ ok: boolean, summary?: string }>,
 *   runTidyUpModel?: (bot: any, prompt: string) => Promise<string | null>,
 * }} options
 */
export function createBotsRuntime(options) {
  const { ctx = null, dshHome } = options;
  if (!dshHome) throw new Error('createBotsRuntime requires dshHome');

  const dbHandle = openBotsDatabase({ dshHome });
  const { db, bots: botsStore } = dbHandle;
  const itemsStore = createItemsStore(db);
  const groupsStore = createGroupsStore(db);
  const workStore = createWorkStore(db);
  const memoryService = createMemoryService({ metaRoot: botMetaDir(dshHome) });

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
    imService: options.imService ?? options.imSender ?? null,
  };

  runtime.sessionRuntime = createSessionRuntime({
    ctx,
    dshHome,
    botsStore,
    itemsStore,
    workStore,
    eventBus,
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
  });

  runtime.lookAroundService = createLookAroundService({
    dshHome,
    botsStore,
    sessionRuntime: runtime.sessionRuntime,
    eventBus,
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
    runModel: options.runTidyUpModel,
    getRecentOwnerMessages: options.getRecentOwnerMessages,
    enableScheduler: false,
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
    getGroupsService: () => runtime.groupsService,
    enableScheduler: options.enableSchedulers !== false,
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

  runtime.legacyCompat = createLegacyCompat({
    dshHome,
    botsStore,
    botsService: runtime.botsService,
    sessionRuntime: runtime.sessionRuntime,
  });

  runtime.http = createBotsHttpHandler(runtime);

  let closed = false;
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
        mail = await runtime.sessionRuntime.sendOwedMail().catch((/** @type {any} */ err) => ({
          ok: false,
          error: String(err?.message ?? err),
          deliveredGroups: 0,
          deliveredEvents: 0,
          skippedGroups: 0,
          details: [],
        }));

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
    closed = true;
    runtime.tidyUpService.stopScheduler();
    runtime.automationsService.close();
    runtime.lookAroundService.close();
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
 * @param {{ home: string }} options
 */
export function mountBotsIntoHost(ctx, { home, allowLegacyMigration = true }) {
  if (!home) return null;
  let instance = null;
  let disposed = false;
  const dbFile = botsDbPath(home);

  const ensureRuntime = () => {
    if (disposed) return null;
    if (!instance) {
      instance = createBotsRuntime({ ctx, dshHome: home, allowLegacyMigration });
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

  const disposeAll = () => {
    disposed = true;
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
    async handler(req, res) {
      const rt = ensureRuntime();
      if (!rt) {
        res.writeHead(503);
        res.end('bots runtime unavailable');
        return;
      }
      await rt.http.handler(req, res);
    },
  }), 'dsh-bots:http');

  ctx.inject?.(['agentPresets'], (host) => host.effect(async () => (
    host.agentPresets.register(botPresetDefinition(home))
  )));

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

