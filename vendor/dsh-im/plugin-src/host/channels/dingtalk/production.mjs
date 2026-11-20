import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { DingtalkConfigStore } from '../../../../src/channels/dingtalk/config-store.mjs';
import { DingtalkDeviceAuth } from '../../../../src/channels/dingtalk/device-auth.mjs';
import { DingtalkController } from '../../../../src/channels/dingtalk/dingtalk-controller.mjs';
import { DingtalkRuntime } from '../../../../src/channels/dingtalk/dingtalk-runtime.mjs';
import { HarnessClient } from '../../../../src/channels/dingtalk/harness-client.mjs';
import { DingtalkStateStore } from '../../../../src/channels/dingtalk/state-store.mjs';
import {
  BotWorkspaceStore,
  createBotWorkspaceScope,
  createWorkspaceAwareController,
  observeBotWorkspaceRemovals,
} from '../../../../src/channels/shared/bot-workspace-store.mjs';
import { listAgentPresetCatalog } from '../../../../src/channels/shared/agent-preset.mjs';
import { sharedSingleOwnerGate } from '../../../../src/channels/shared/single-owner-gate.mjs';
import { createConnectionSupervisor } from './connection-supervisor.mjs';
import { createHarnessCommandExecutor } from '../../harness-command-executor.mjs';
import { createHarnessSessionExecutors } from '../../harness-session-coordinator.mjs';
import { createHarnessAuthTransport } from '../../harness-auth-transport.mjs';

function harnessOrigin(webServer, configured) {
  if (configured !== undefined) return new URL(configured);
  const port = webServer?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh-dingtalk requires an initialized DSH webServer port');
  }
  return new URL(`http://127.0.0.1:${port}`);
}

function pluginPaths(config) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const root = resolve(config.dataDir ?? join(dshHome, 'integrations', 'dsh-dingtalk'));
  return {
    root,
    config: resolve(config.configPath ?? join(root, 'config.json')),
    bots: resolve(config.botsDir ?? join(root, 'bots')),
    workspaces: resolve(config.workspacesPath ?? join(root, 'workspaces.json')),
  };
}

export async function createProductionController(ctx, config = {}, internals = {}) {
  if (!ctx?.credentials) throw new TypeError('dsh-dingtalk requires ctx.credentials');
  if (!ctx?.webServer) throw new TypeError('dsh-dingtalk requires ctx.webServer');

  const ConfigStore = internals.ConfigStore ?? DingtalkConfigStore;
  const DeviceAuth = internals.DeviceAuth ?? DingtalkDeviceAuth;
  const StateStore = internals.StateStore ?? DingtalkStateStore;
  const Harness = internals.HarnessClient ?? HarnessClient;
  const Controller = internals.Controller ?? DingtalkController;
  const Runtime = internals.Runtime ?? DingtalkRuntime;
  const createSupervisor = internals.createConnectionSupervisor ?? createConnectionSupervisor;
  const logger = typeof ctx.logger === 'function'
    ? ctx.logger('dsh-dingtalk')
    : (ctx.logger ?? console);
  const agentPresetCatalog = () => listAgentPresetCatalog(ctx);
  const paths = pluginPaths(config);
  const singleOwnerGate = internals.singleOwnerGate
    ?? config.singleOwnerGate
    ?? await sharedSingleOwnerGate(config.dshHome);
  const configStore = await new ConfigStore(paths.config).load();
  const defaultWorkspace = resolve(config.workspace ?? process.cwd());
  const WorkspaceStore = internals.WorkspaceStore ?? BotWorkspaceStore;
  const workspaces = internals.workspaces
    ?? await new WorkspaceStore(paths.workspaces, { defaultWorkspace }).load();
  const canListConfiguredBots = typeof configStore.list === 'function';
  const configuredBots = canListConfiguredBots ? configStore.list() : [];
  if (canListConfiguredBots) {
    await workspaces.reconcile(configuredBots.map((bot) => bot.botId));
  }
  await Promise.all(configuredBots.map((bot) => workspaces.ensure(bot.botId, {
    defaultAgentPreset: config.agentPreset,
  })));
  const observedConfigStore = typeof configStore.remove === 'function'
    ? observeBotWorkspaceRemovals(configStore, { workspaces })
    : configStore;
  const deviceAuth = internals.deviceAuth ?? new DeviceAuth({
    baseUrl: config.registrationBaseUrl,
  });
  const stateStores = new Map();

  const statePath = (botId) => resolve(paths.bots, botId, 'state.json');
  const stateFor = async (botId) => {
    let state = stateStores.get(botId);
    if (!state) {
      state = await new StateStore(statePath(botId)).load();
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
  const harness = new Harness({
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
  const coreController = new Controller({
    deviceAuth,
    credentials: ctx.credentials,
    configStore: observedConfigStore,
    logger,
    createRuntime: async ({ botId, config: botConfig, clientSecret }) => {
      const state = await stateFor(botId);
      await workspaces.ensure(botId, { defaultAgentPreset: config.agentPreset });
      const accessGate = singleOwnerGate && botId
        ? singleOwnerGate.createBotGate({
            channel: 'dingtalk',
            botId,
            getBotConfig: () => configStore.get?.(botId) ?? botConfig,
            getPreset: () => workspaces.agentPresetFor?.(botId) ?? null,
            home: config.dshHome,
          })
        : null;
      const workspaceScope = createBotWorkspaceScope(harness, {
        botId, workspaces, state, agentPresetCatalog, accessGate,
      });
      return new Runtime({
        config: botConfig,
        clientSecret,
        harness: workspaceScope.harness,
        state: workspaceScope.state,
        replyTimeoutMs: config.replyTimeoutMs ?? 600_000,
        maxMessageChars: config.maxMessageChars ?? 4_000,
        connectTimeoutMs: config.connectTimeoutMs ?? 15_000,
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
    channel: 'dingtalk',
    listBotConfigs: () => (typeof configStore.list === 'function' ? configStore.list() : []),
  });
  const supervisor = createSupervisor({
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
