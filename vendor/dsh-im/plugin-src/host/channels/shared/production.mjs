import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { createTokenConnectionSupervisor } from './connection-supervisor.mjs';
import { createHarnessCommandExecutor } from '../../harness-command-executor.mjs';
import { createHarnessSessionExecutors } from '../../harness-session-coordinator.mjs';
import { createHarnessAuthTransport } from '../../harness-auth-transport.mjs';
import {
  BotWorkspaceStore,
  createBotWorkspaceScope,
  createWorkspaceAwareController,
  observeBotWorkspaceRemovals,
} from '../../../../src/channels/shared/bot-workspace-store.mjs';
import { listAgentPresetCatalog } from '../../../../src/channels/shared/agent-preset.mjs';
import {
  isSingleOwnerChannel,
  sharedSingleOwnerGate,
} from '../../../../src/channels/shared/single-owner-gate.mjs';

export function harnessOrigin(webServer, configured) {
  if (configured !== undefined) return new URL(configured);
  const port = webServer?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh-im token channel requires an initialized DSH webServer port');
  }
  return new URL(`http://127.0.0.1:${port}`);
}

export function pluginPaths(config, channel) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const root = resolve(config.dataDir ?? join(dshHome, 'integrations', `dsh-${channel}`));
  return {
    config: resolve(config.configPath ?? join(root, 'config.json')),
    bots: resolve(config.botsDir ?? join(root, 'bots')),
    workspaces: resolve(config.workspacesPath ?? join(root, 'workspaces.json')),
  };
}

export async function createTokenProductionController(ctx, config, internals, definitions) {
  const {
    channel, ConfigStore, StateStore, HarnessClient, Controller, Runtime, runtimeOptions,
  } = definitions;
  if (!ctx?.credentials) throw new TypeError(`dsh-im ${channel} requires ctx.credentials`);
  if (!ctx?.webServer) throw new TypeError(`dsh-im ${channel} requires ctx.webServer`);

  const ResolvedConfigStore = internals.ConfigStore ?? ConfigStore;
  const ResolvedStateStore = internals.StateStore ?? StateStore;
  const ResolvedHarness = internals.HarnessClient ?? HarnessClient;
  const ResolvedController = internals.Controller ?? Controller;
  const ResolvedRuntime = internals.Runtime ?? Runtime;
  const channelRuntimeOptions = typeof runtimeOptions === 'function' ? runtimeOptions(config) : {};
  if (!channelRuntimeOptions || typeof channelRuntimeOptions !== 'object'
    || Array.isArray(channelRuntimeOptions)) {
    throw new TypeError(`dsh-im ${channel} runtimeOptions must return an object`);
  }
  const createSupervisor = internals.createConnectionSupervisor ?? createTokenConnectionSupervisor;
  const logger = typeof ctx.logger === 'function'
    ? ctx.logger(`dsh-im:${channel}`) : (ctx.logger ?? console);
  const agentPresetCatalog = () => listAgentPresetCatalog(ctx);
  const paths = pluginPaths(config, channel);
  const singleOwnerGate = isSingleOwnerChannel(channel)
    ? (internals.singleOwnerGate ?? config.singleOwnerGate ?? await sharedSingleOwnerGate(config.dshHome))
    : null;
  const configStore = await new ResolvedConfigStore(paths.config).load();
  const defaultWorkspace = resolve(config.workspace ?? process.cwd());
  const WorkspaceStore = internals.WorkspaceStore ?? BotWorkspaceStore;
  const workspaces = internals.workspaces
    ?? await new WorkspaceStore(paths.workspaces, { defaultWorkspace }).load();
  const configuredBots = configStore.list();
  await workspaces.reconcile(configuredBots.map((bot) => bot.botId));
  await Promise.all(configuredBots.map((bot) => workspaces.ensure(bot.botId, {
    defaultAgentPreset: config.agentPreset,
  })));
  const observedConfigStore = typeof configStore.remove === 'function'
    ? observeBotWorkspaceRemovals(configStore, { workspaces })
    : configStore;
  const stateStores = new Map();
  const statePath = (botId) => resolve(paths.bots, botId, 'state.json');
  const stateFor = async (botId) => {
    let state = stateStores.get(botId);
    if (!state) {
      state = await new ResolvedStateStore(statePath(botId)).load();
      stateStores.set(botId, state);
    }
    return state;
  };
  const commandExecutor = createHarnessCommandExecutor(ctx, internals.commandExecutor);
  const { controlExecutor, sessionMaintenanceExecutor, fileIngressExecutor } = createHarnessSessionExecutors(ctx, {
    controlExecutor: internals.controlExecutor,
    sessionMaintenanceExecutor: internals.sessionMaintenanceExecutor,
    fileIngressExecutor: internals.fileIngressExecutor,
  });
  const baseUrl = harnessOrigin(ctx.webServer, config.harnessBaseUrl);
  const harness = new ResolvedHarness({
    baseUrl,
    ...createHarnessAuthTransport(ctx, baseUrl),
    workspace: defaultWorkspace,
    autostart: false,
    dshBin: config.dshBin ?? 'dsh',
    ...(commandExecutor ? { commandExecutor } : {}),
    ...(controlExecutor ? { controlExecutor } : {}),
    ...(sessionMaintenanceExecutor ? { sessionMaintenanceExecutor } : {}),
    ...(fileIngressExecutor ? { fileIngressExecutor } : {}),
  });
  const coreController = new ResolvedController({
    credentials: ctx.credentials,
    configStore: observedConfigStore,
    logger,
    ...(internals.inspectToken ? { inspectToken: internals.inspectToken } : {}),
    createRuntime: async ({ botId, config: botConfig, token }) => {
      const state = await stateFor(botId);
      await workspaces.ensure(botId, { defaultAgentPreset: config.agentPreset });
      const accessGate = singleOwnerGate && botId
        ? singleOwnerGate.createBotGate({
            channel,
            botId,
            getBotConfig: () => configStore.get?.(botId) ?? botConfig,
            getPreset: () => workspaces.agentPresetFor?.(botId) ?? null,
            home: config.dshHome,
          })
        : null;
      const workspaceScope = createBotWorkspaceScope(harness, {
        botId, workspaces, state, agentPresetCatalog, accessGate,
      });
      return new ResolvedRuntime({
        ...channelRuntimeOptions,
        config: botConfig,
        token,
        harness: workspaceScope.harness,
        state: workspaceScope.state,
        replyTimeoutMs: config.replyTimeoutMs ?? 600_000,
        connectTimeoutMs: config.connectTimeoutMs ?? 20_000,
        logger: {
          error: (...args) => logger.error?.(`[${botId}]`, ...args),
          warn: (...args) => logger.warn?.(`[${botId}]`, ...args),
          info: (...args) => logger.info?.(`[${botId}]`, ...args),
          debug: (...args) => logger.debug?.(`[${botId}]`, ...args),
        },
      });
    },
    deleteState: async ({ botId }) => {
      const state = stateStores.get(botId);
      stateStores.delete(botId);
      if (state && typeof state.remove === 'function') {
        await state.remove();
      } else {
        try {
          await unlink(statePath(botId));
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
    },
  });
  const controller = createWorkspaceAwareController(coreController, {
    workspaces,
    stateFor,
    agentPresetCatalog,
    singleOwnerGate,
    channel,
    listBotConfigs: () => (typeof configStore.list === 'function' ? configStore.list() : []),
  });
  const supervisor = createSupervisor({
    channel,
    controller,
    harness,
    logger,
    retryDelaysMs: config.retryDelaysMs,
    healthyIntervalMs: config.healthyIntervalMs,
  }).start();
  return {
    controller,
    ready: supervisor.ready,
    async close() {
      await supervisor.close();
      await controller.close();
      harness.stopManagedProcess();
    },
  };
}
