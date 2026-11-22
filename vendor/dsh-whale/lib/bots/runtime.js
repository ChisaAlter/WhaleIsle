/**
 * Top-level Bots Runtime assembly (`createBotsRuntime`).
 * Wires SQLite stores, legacy Whale read-only migration, memory service,
 * event bus, session runtime, Look Around, Tidy-up, Groups, Automations,
 * Connectors, Share/Import, Legacy compat, and the `/dsh-bots` HTTP router.
 */
import fs from 'node:fs';
import { botsDbPath, openBotsDatabase } from './db.js';
import { createItemsStore } from './items-store.js';
import { createGroupsStore } from './groups-store.js';
import { createWorkStore } from './work-store.js';
import { botMetaDir } from './fs-home.js';
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
 *   getController?: () => any,
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

  runtime.close = () => {
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

