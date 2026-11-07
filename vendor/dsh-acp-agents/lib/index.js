import path from 'node:path';
import {
  ACP_PROVIDER_PREFIX,
  BUILTIN_AGENT_PRESETS,
  DEFAULT_REASONING_EFFORTS,
  agentIdFromProvider,
  isAcpProvider,
  loadAgentsConfig,
  normalizeAgentRecord,
  normalizeEnvRecord,
  providerIdForAgent,
  resolveCommandBinary,
  resolveProfilesBaseDir,
  resolveStoreFile,
  sanitizeId,
  saveAgentsConfig,
} from './presets.js';
import {
  AcpClientConnection,
  AcpTurnExecution,
  testAcpAgentConfig,
} from './acp-driver.js';
import {
  AgentAuthManager,
  openExternalUrl,
} from './auth-manager.js';

export const name = 'dsh-acp-agents';
export const inject = ['llm', 'connection', 'webServer'];

function safeGetService(ctx, serviceName) {
  if (!ctx) return undefined;
  try {
    if (typeof ctx.get === 'function') {
      const val = ctx.get(serviceName);
      if (val !== undefined) return val;
    }
    return ctx[serviceName];
  } catch {
    return undefined;
  }
}

const MAX_RPC_BODY_BYTES = 2 * 1024 * 1024;

async function readBoundedJson(req, maxBytes) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    const error = new Error('payload too large');
    error.status = 413;
    req.destroy();
    throw error;
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.byteLength;
    if (received > maxBytes) {
      const error = new Error('payload too large');
      error.status = 413;
      req.destroy();
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('body is not JSON');
    error.status = 400;
    throw error;
  }
}

/**
 * Extract the latest user turn's prompt blocks from `GenerateOptions.messages`.
 */
export function extractLatestUserPromptBlocks(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ type: 'text', text: '' }];
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== 'user') continue;
    const blocks = [];
    if (typeof msg.content === 'string') {
      if (msg.content.trim()) blocks.push({ type: 'text', text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          blocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'file' && block.attachment) {
          const fileName = block.attachment.name || block.attachment.path || 'attached-file';
          blocks.push({ type: 'text', text: `[Attached file: ${fileName}]` });
        } else if (block.type === 'image' && block.attachment) {
          const imgName = block.attachment.name || 'attached-image';
          blocks.push({ type: 'text', text: `[Attached image: ${imgName}]` });
        }
      }
    }
    if (blocks.length > 0) {
      return blocks;
    }
  }
  return [{ type: 'text', text: 'Continue.' }];
}

function resolveActiveDshAgent(ctx, options) {
  const agentsSvc = safeGetService(ctx, 'agents');
  if (!agentsSvc) return null;
  try {
    const initiator = agentsSvc.initiator?.();
    if (initiator) return initiator;
  } catch {
    // ignore
  }
  try {
    if (typeof agentsSvc.values === 'function') {
      const lastMsgId = Array.isArray(options?.messages)
        ? options.messages.findLast((m) => m && typeof m.id === 'string')?.id
        : null;
      for (const agent of agentsSvc.values()) {
        if (!lastMsgId) return agent;
        const events = agent?.session?.events?.() || [];
        if (events.some((ev) => ev?.data?.message?.id === lastMsgId || ev?.data?.id === lastMsgId)) {
          return agent;
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function createAcpAgentsManager(ctx, options = {}) {
  const storeFile = options.storeFile || resolveStoreFile();
  let agentList = loadAgentsConfig(storeFile);
  const discoveredModels = new Map();
  // Map<`${sessionId}::${agentId}`, AcpClientConnection>
  const sessionConnections = new Map();
  // Map<toolCallId, { entry, turn, dshAgent, conn }>
  const pendingToolExecutions = new Map();
  const authManager = new AgentAuthManager();
  let adapterHandle = null;

  function getAgentById(id) {
    const clean = sanitizeId(id);
    return agentList.find((a) => a.id === clean) || null;
  }

  function getAgentByProvider(providerId) {
    const id = agentIdFromProvider(providerId);
    return id ? getAgentById(id) : null;
  }

  /**
   * Returns all known models for an agent (configured + discovered), annotated with
   * `favorite` and `hidden`.
   */
  function getAllModelsForAgent(agent) {
    const base = Array.isArray(agent?.models) ? [...agent.models] : [];
    const extra = discoveredModels.get(agent?.id) || [];
    const favSet = new Set(Array.isArray(agent?.favoriteModels) ? agent.favoriteModels : []);
    const hiddenSet = new Set(Array.isArray(agent?.hiddenModels) ? agent.hiddenModels : []);
    const seen = new Set();
    const all = [];

    for (const item of [...base, ...extra]) {
      const id = String(item?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push({
        id,
        name: item.name || id,
        defaultEffort: item.defaultEffort || 'medium',
        favorite: favSet.has(id),
        hidden: hiddenSet.has(id),
        discovered: !base.some((b) => b.id === id),
      });
    }

    if (all.length === 0) {
      all.push({
        id: 'default',
        name: `${agent?.name || 'ACP'} Default`,
        defaultEffort: 'medium',
        favorite: false,
        hidden: false,
        discovered: false,
      });
    }

    // Sort favorites to the top while preserving relative order
    all.sort((a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return 0;
    });

    return all;
  }

  /**
   * Returns enabled (non-hidden) models exposed to the composer ModelSelect.
   */
  function getEffectiveModels(agent) {
    const all = getAllModelsForAgent(agent);
    const visible = all.filter((m) => !m.hidden);
    return visible.length > 0 ? visible : [all[0]];
  }

  const adapter = {
    providerInfo(provider) {
      const agent = getAgentByProvider(provider);
      return {
        id: provider,
        name: agent ? agent.name : provider,
      };
    },
    providerRetryPolicy(_provider) {
      return {
        maxRetries: 0,
        initialDelayMs: 500,
        maxDelayMs: 2_000,
        backoffFactor: 2,
      };
    },
    imageRequestPricing(_provider, _model) {
      return undefined;
    },
    imageRequestTarget(_provider, _model, image) {
      return {
        width: image.width,
        height: image.height,
        maxBytes: image.bytes,
      };
    },
    async listModels(provider) {
      const agent = getAgentByProvider(provider);
      if (!agent || !agent.enabled) return [];
      return getEffectiveModels(agent).map((m) => ({
        provider,
        id: m.id,
        name: m.name || m.id,
      }));
    },
    async resolveModel(provider, model, _signal) {
      const agent = getAgentByProvider(provider);
      const effective = agent ? getAllModelsForAgent(agent) : [];
      const matched = effective.find((m) => m.id === model);
      return {
        provider,
        id: model,
        name: matched?.name || model,
        context: {
          contextWindow: 200_000,
        },
        reasoning: {
          defaultEffort: matched?.defaultEffort || 'medium',
          efforts: DEFAULT_REASONING_EFFORTS,
        },
      };
    },
    async prepareCall(provider, model, signal) {
      return {
        model: await this.resolveModel(provider, model, signal),
        stream: (callOptions) => this.stream(callOptions),
      };
    },
    async *stream(callOptions) {
      const provider = callOptions.provider;
      const agentConfig = getAgentByProvider(provider);
      if (!agentConfig) {
        throw new Error(`External ACP agent for provider "${provider}" is not configured.`);
      }

      const dshAgent = resolveActiveDshAgent(ctx, callOptions);
      const dshSessionId = String(
        callOptions.sessionId || dshAgent?.session?.id || dshAgent?.id || 'default-session',
      );
      const cwd = dshAgent?.session?.header?.cwd || process.cwd();
      const connKey = `${dshSessionId}::${agentConfig.id}`;

      let conn = sessionConnections.get(connKey);
      if (!conn || conn.closed) {
        conn = new AcpClientConnection({
          ctx,
          agentConfig,
          cwd,
          onModelsDiscovered: (agentId, models) => {
            discoveredModels.set(agentId, models);
          },
        });
        sessionConnections.set(connKey, conn);
      } else {
        conn.agentConfig = agentConfig;
      }

      await conn.ensureReady(callOptions.signal);
      await conn.syncModelAndEffort(callOptions.model, callOptions.reasoningEffort, callOptions.signal);

      let turn = conn.activeTurn;
      if (!turn || (turn.promptDone && turn.queue.closed && turn.queue.items.length === 0)) {
        const promptBlocks = extractLatestUserPromptBlocks(callOptions.messages);
        turn = new AcpTurnExecution({
          connection: conn,
          agent: dshAgent,
          promptBlocks,
          signal: callOptions.signal,
        });
        conn.activeTurn = turn;
      }

      let openIndex = -1;
      let openType = null;
      let blockText = '';
      let nextIndex = 0;
      const closeBlock = function* () {
        if (openType === 'reasoning') {
          yield { type: 'block-end', index: openIndex, block: { type: 'reasoning', text: blockText } };
        } else if (openType === 'text') {
          yield { type: 'block-end', index: openIndex, block: { type: 'text', text: blockText } };
        }
        openType = null;
        openIndex = -1;
        blockText = '';
      };
      const finishChunk = function* (reason) {
        if (turn.usage) {
          yield { type: 'usage', usage: turn.usage };
        }
        yield { type: 'finish', reason };
      };

      while (true) {
        const { value: item, done } = await turn.queue.next(callOptions.signal);
        if (done || !item) {
          yield* closeBlock();
          yield* finishChunk({ kind: 'stop' });
          return;
        }

        if (item.type === 'thought') {
          if (openType !== 'reasoning') {
            yield* closeBlock();
            openIndex = nextIndex++;
            openType = 'reasoning';
            yield { type: 'block-start', index: openIndex, blockType: 'reasoning' };
          }
          blockText += item.text;
          yield { type: 'reasoning-delta', index: openIndex, text: item.text };
          continue;
        }

        if (item.type === 'text') {
          if (openType !== 'text') {
            yield* closeBlock();
            openIndex = nextIndex++;
            openType = 'text';
            yield { type: 'block-start', index: openIndex, blockType: 'text' };
          }
          blockText += item.text;
          yield { type: 'text-delta', index: openIndex, text: item.text };
          continue;
        }

        if (item.type === 'tool-call') {
          const entry = item.entry;
          yield* closeBlock();
          const callIndex = nextIndex++;
          const argsJson = JSON.stringify(entry.args || {});
          pendingToolExecutions.set(entry.toolCallId, {
            entry,
            turn,
            dshAgent,
            conn,
          });
          yield { type: 'block-start', index: callIndex, blockType: 'tool-call' };
          yield {
            type: 'tool-call-delta',
            index: callIndex,
            id: entry.toolCallId,
            name: entry.name,
            argumentsDelta: argsJson,
          };
          yield {
            type: 'block-end',
            index: callIndex,
            block: { type: 'tool-call', id: entry.toolCallId, name: entry.name, arguments: argsJson },
          };
          yield* finishChunk({ kind: 'tool-calls' });
          return;
        }

        if (item.type === 'prompt-error') {
          yield* closeBlock();
          throw item.error || new Error(`ACP agent "${agentConfig.name}" turn failed`);
        }

        if (item.type === 'prompt-done') {
          yield* closeBlock();
          yield* finishChunk({ kind: 'stop' });
          return;
        }
      }
    },
  };

  function syncAdapterRoutes() {
    if (!ctx.llm || typeof ctx.llm.registerAdapter !== 'function') return;
    const allProviders = agentList.filter((a) => a.enabled).map((a) => a.providerId);
    if (!adapterHandle) {
      if (allProviders.length > 0) {
        adapterHandle = ctx.llm.registerAdapter(allProviders, adapter);
      }
    } else {
      adapterHandle.replace(allProviders);
    }
  }

  async function closeAgentConnections(agentId) {
    const suffix = `::${agentId}`;
    const closing = [];
    for (const [key, conn] of sessionConnections.entries()) {
      if (key.endsWith(suffix)) {
        sessionConnections.delete(key);
        closing.push(conn.close().catch(() => {}));
      }
    }
    await Promise.all(closing);
  }

  async function closeAllConnections() {
    const closing = [];
    for (const [, conn] of sessionConnections.entries()) {
      closing.push(conn.close().catch(() => {}));
    }
    sessionConnections.clear();
    await Promise.all(closing);
  }

  async function buildCatalog({ refreshAccounts = false } = {}) {
    const activeByAgent = new Map();
    const activeSessions = [];
    for (const [key, conn] of sessionConnections.entries()) {
      if (conn.closed) continue;
      const [sessionId, agentId] = key.split('::');
      activeByAgent.set(agentId, (activeByAgent.get(agentId) || 0) + 1);
      activeSessions.push({
        sessionId,
        agentId,
        acpSessionId: conn.acpSessionId,
        cwd: conn.cwd,
        currentModel: conn.currentModel,
      });
    }

    const accountStatuses = await Promise.all(
      agentList.map((agent) =>
        authManager.getAgentAccountStatus(agent, { forceRefresh: refreshAccounts }).catch(() => null),
      ),
    );

    const agents = agentList.map((agent, idx) => {
      const binaryPath = resolveCommandBinary(agent.command, agent.env);
      const account = accountStatuses[idx] || null;
      const authFlow = authManager.getFlowState(agent.id);
      return {
        ...agent,
        models: getEffectiveModels(agent),
        allModels: getAllModelsForAgent(agent),
        configuredModels: agent.models,
        discoveredModels: discoveredModels.get(agent.id) || [],
        binaryFound: Boolean(binaryPath),
        binaryPath: binaryPath || null,
        version: account?.version || null,
        account,
        authFlow,
        activeSessionCount: activeByAgent.get(agent.id) || 0,
      };
    });

    return {
      agents,
      activeSessions,
      storeFile,
      profilesBaseDir: resolveProfilesBaseDir(storeFile),
    };
  }

  function recordDiscoveredModelsFromConfig(agentId, configOptions) {
    if (!Array.isArray(configOptions)) return;
    const found = [];
    for (const opt of configOptions) {
      if (opt?.type === 'select' && (opt.category === 'model' || opt.id === 'model')) {
        for (const item of opt.options || []) {
          if (Array.isArray(item?.options)) {
            for (const sub of item.options) {
              if (sub?.value) found.push({ id: String(sub.value), name: String(sub.name || sub.value) });
            }
          } else if (item?.value) {
            found.push({ id: String(item.value), name: String(item.name || item.value) });
          }
        }
      }
    }
    if (found.length > 0) {
      discoveredModels.set(agentId, found);
    }
  }

  async function handleRpc(endpoint, input = {}) {
    switch (endpoint) {
      case 'catalog': {
        return buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) });
      }
      case 'agent/toggle': {
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        const enabled = Boolean(input?.enabled);
        agentList = agentList.map((a) => (a.id === id ? { ...a, enabled } : a));
        agentList = saveAgentsConfig(agentList, storeFile);
        syncAdapterRoutes();
        if (!enabled) {
          await closeAgentConnections(id);
        } else if (!discoveredModels.has(id)) {
          const updatedTarget = getAgentById(id);
          if (updatedTarget) {
            void testAcpAgentConfig(ctx, updatedTarget, process.cwd())
              .then((probe) => {
                if (probe?.ok && Array.isArray(probe.configOptions)) {
                  recordDiscoveredModelsFromConfig(id, probe.configOptions);
                }
              })
              .catch(() => {});
          }
        }
        return buildCatalog();
      }
      case 'agent/save': {
        const raw = input?.agent || input;
        const id = sanitizeId(raw?.id || raw?.name);
        if (!id) throw new Error('Agent ID or name is required');
        const preset = BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null;
        const existing = getAgentById(id);
        const mergedInput = {
          ...(existing || preset || {}),
          ...raw,
          id,
        };
        if (raw?.driverKind === undefined) {
          delete mergedInput.driverKind;
        }
        const record = normalizeAgentRecord(mergedInput, preset);
        if (!record) throw new Error('Invalid agent configuration');
        const exists = agentList.some((a) => a.id === id);
        if (exists) {
          agentList = agentList.map((a) => (a.id === id ? record : a));
        } else {
          agentList = [...agentList, record];
        }
        agentList = saveAgentsConfig(agentList, storeFile);
        authManager.invalidate(id);
        syncAdapterRoutes();
        await closeAgentConnections(id);
        return buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) });
      }
      case 'agent/create-account': {
        const baseAgentId = String(input?.baseAgentId || 'claude-code').trim();
        const basePreset = BUILTIN_AGENT_PRESETS.find((p) => p.id === baseAgentId) || null;
        const label = String(input?.name || '').trim();
        let index = 2;
        while (getAgentById(`${baseAgentId}-${index}`)) {
          index += 1;
        }
        const id = sanitizeId(input?.id || `${baseAgentId}-${index}`);
        if (getAgentById(id)) {
          throw new Error(`Agent ID "${id}" already exists`);
        }
        const profilesBase = resolveProfilesBaseDir(storeFile);
        const profileDir = input?.profileDir
          ? String(input.profileDir).trim()
          : path.join(profilesBase, id);
        const name = label || `${basePreset?.name || baseAgentId} #${index}`;
        const record = normalizeAgentRecord(
          {
            ...(basePreset || {}),
            id,
            baseAgentId,
            builtin: false,
            name,
            profileDir,
            enabled: true,
            ...(input?.command ? { command: input.command } : {}),
            ...(input?.args ? { args: input.args } : {}),
            ...(input?.env ? { env: input.env } : {}),
          },
          null,
        );
        agentList = [...agentList, record];
        agentList = saveAgentsConfig(agentList, storeFile);
        syncAdapterRoutes();
        return {
          createdId: record.id,
          catalog: await buildCatalog({ refreshAccounts: true }),
        };
      }
      case 'agent/delete': {
        const id = sanitizeId(input?.id);
        if (!id) throw new Error('Agent ID is required');
        const preset = BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null;
        authManager.cancelLogin(id);
        authManager.invalidate(id);
        await closeAgentConnections(id);
        if (preset) {
          const resetRecord = normalizeAgentRecord(preset, preset);
          agentList = agentList.map((a) => (a.id === id ? resetRecord : a));
        } else {
          agentList = agentList.filter((a) => a.id !== id);
        }
        agentList = saveAgentsConfig(agentList, storeFile);
        syncAdapterRoutes();
        return buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) });
      }
      case 'agent/test': {
        const id = sanitizeId(input?.id);
        const target = input?.agent
          ? normalizeAgentRecord(input.agent, BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null)
          : getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        const probe = await testAcpAgentConfig(ctx, target, input?.cwd || process.cwd());
        if (probe.ok && Array.isArray(probe.configOptions)) {
          recordDiscoveredModelsFromConfig(target.id, probe.configOptions);
        }
        return {
          ...probe,
          catalog: await buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) }),
        };
      }
      case 'agent/login': {
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        const methodId = String(input?.methodId || target.authMethod || '');

        // If credentials (API keys / custom base URL) were provided, save them into agent.env
        if (input?.credentials && typeof input.credentials === 'object') {
          const nextEnv = normalizeEnvRecord({
            ...(target.env || {}),
            ...input.credentials,
          });
          // Remove empty keys
          for (const [k, v] of Object.entries(input.credentials)) {
            if (v === '' || v === null) delete nextEnv[k];
          }
          const updated = normalizeAgentRecord(
            { ...target, authMethod: methodId || target.authMethod, env: nextEnv },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          agentList = agentList.map((a) => (a.id === id ? updated : a));
          agentList = saveAgentsConfig(agentList, storeFile);
          authManager.invalidate(id);
          await closeAgentConnections(id);
          if (input?.onlySaveCredentials) {
            return {
              flow: null,
              catalog: await buildCatalog({ refreshAccounts: true }),
            };
          }
        } else if (methodId && methodId !== target.authMethod) {
          const updated = normalizeAgentRecord(
            { ...target, authMethod: methodId },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          agentList = agentList.map((a) => (a.id === id ? updated : a));
          agentList = saveAgentsConfig(agentList, storeFile);
        }

        const freshTarget = getAgentById(id);
        const flow = await authManager.startLogin(freshTarget, {
          methodId,
          forceNewToken: Boolean(input?.forceNewToken),
          autoOpenBrowser: input?.autoOpenBrowser !== false,
        });
        return {
          flow,
          catalog: await buildCatalog({ refreshAccounts: false }),
        };
      }
      case 'agent/login/cancel': {
        const id = sanitizeId(input?.id);
        authManager.cancelLogin(id);
        return buildCatalog({ refreshAccounts: false });
      }
      case 'agent/logout': {
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        await closeAgentConnections(id);
        // Also clear API key env vars if logging out from API key mode
        if (input?.clearApiKeys) {
          const cleanedEnv = { ...(target.env || {}) };
          for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEVIN_API_KEY']) {
            delete cleanedEnv[k];
          }
          const updated = normalizeAgentRecord(
            { ...target, env: cleanedEnv },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          agentList = agentList.map((a) => (a.id === id ? updated : a));
          agentList = saveAgentsConfig(agentList, storeFile);
        }
        await authManager.logoutAgent(getAgentById(id));
        return buildCatalog({ refreshAccounts: true });
      }
      case 'agent/open-url': {
        const url = String(input?.url || '').trim();
        openExternalUrl(url);
        return { opened: true };
      }
      case 'sessions/stop': {
        const agentId = input?.agentId ? sanitizeId(input.agentId) : null;
        const sessionId = input?.sessionId ? String(input.sessionId) : null;
        if (agentId && sessionId) {
          const key = `${sessionId}::${agentId}`;
          const conn = sessionConnections.get(key);
          if (conn) {
            sessionConnections.delete(key);
            await conn.close().catch(() => {});
          }
        } else if (agentId) {
          await closeAgentConnections(agentId);
        } else {
          await closeAllConnections();
        }
        return buildCatalog();
      }
      default:
        throw new Error(`Unknown dsh-acp-agents endpoint: ${String(endpoint)}`);
    }
  }

  async function executeTrackedToolCall(exec) {
    const tracked = pendingToolExecutions.get(exec.callId);
    if (!tracked) return null;
    const { entry, turn } = tracked;

    try {
      while (true) {
        if (exec.signal?.aborted) {
          if (entry.pendingPermission) {
            entry.pendingPermission.resolve('cancelled');
            entry.pendingPermission = null;
          }
          break;
        }

        if (entry.pendingPermission) {
          const perm = entry.pendingPermission;
          entry.pendingPermission = null;
          const approvalService = safeGetService(ctx, 'approval');
          const targetAgent = exec.agent ?? tracked.dshAgent;
          if (approvalService && typeof approvalService.request === 'function' && targetAgent) {
            const reason = perm.toolCall?.title || entry.title || `Allow ${tracked.conn?.agentConfig?.name || 'ACP Agent'} to run ${exec.name}?`;
            const decision = await approvalService.request({
              agent: targetAgent,
              toolName: exec.name,
              callId: exec.callId,
              reason,
              signal: exec.signal,
            });
            if (decision === 'allowed-once') {
              perm.resolve(true);
            } else if (decision === 'cancelled') {
              perm.resolve('cancelled');
            } else {
              perm.resolve(false);
            }
          } else {
            perm.resolve(true);
          }
          continue;
        }

        if (entry.status === 'completed' || entry.status === 'failed' || turn.promptDone) {
          break;
        }

        await new Promise((resolve) => {
          const done = () => {
            entry.onPermissionArrived = null;
            exec.signal?.removeEventListener('abort', done);
            resolve();
          };
          entry.onPermissionArrived = done;
          entry.waiters.push(done);
          exec.signal?.addEventListener('abort', done, { once: true });
        });
      }

      const isError = entry.status === 'failed';
      const outputText = entry.outputText || (isError ? 'Tool call failed' : 'Completed');
      const result = {
        content: [{ type: 'text', text: outputText }],
        value: { text: outputText },
        isError,
        ...(isError ? { error: { message: outputText } } : {}),
      };
      const toolsSvc = safeGetService(ctx, 'tools');
      if (typeof toolsSvc?.markCanonical === 'function' && exec?.token !== undefined) {
        toolsSvc.markCanonical(exec, result);
      } else if (toolsSvc?.canonicalResults instanceof WeakMap && exec?.token !== undefined) {
        toolsSvc.canonicalResults.set(result, exec.token);
      }
      return result;
    } finally {
      pendingToolExecutions.delete(exec.callId);
    }
  }

  return {
    adapter,
    syncAdapterRoutes,
    handleRpc,
    buildCatalog,
    pendingToolExecutions,
    executeTrackedToolCall,
    closeAllConnections,
  };
}

export function apply(ctx, config = {}) {
  const manager = createAcpAgentsManager(ctx, config);
  manager.syncAdapterRoutes();

  if (typeof ctx.on === 'function') {
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (manager.pendingToolExecutions.has(exec?.callId)) {
        return { kind: 'allow' };
      }
      return next();
    }, { prepend: true });

    ctx.on('tools/execute', async (exec, next) => {
      if (manager.pendingToolExecutions.has(exec?.callId)) {
        const result = await manager.executeTrackedToolCall(exec);
        if (result) return result;
      }
      return next();
    }, { prepend: true });
  }

  ctx.effect(() => {
    const unregister = ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-acp-agents',
      async handler(req, res) {
        const rejection = ctx.connection?.requestRejection?.(req);
        if (rejection !== undefined) {
          res.writeHead(rejection);
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
        const endpoint = pathname.startsWith('/dsh-acp-agents/')
          ? pathname.slice('/dsh-acp-agents/'.length)
          : '';
        const badEndpoint =
          !endpoint
          || endpoint
            .split('/')
            .some((seg) => !seg || seg === '.' || seg === '..' || !/^[A-Za-z0-9_$.-]+$/.test(seg));
        if (req.method !== 'POST' || badEndpoint) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const contentType = String(req.headers['content-type'] ?? '')
          .split(';', 1)[0]
          .trim()
          .toLowerCase();
        if (contentType !== 'application/json') {
          res.writeHead(415);
          res.end('content type must be application/json');
          return;
        }
        const reply = (status, body) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        const fail = (rpcId, message) =>
          reply(200, {
            type: 'server-response',
            rpcId: typeof rpcId === 'string' ? rpcId : 'invalid',
            result: { ok: false, error: { code: 'dsh-acp-agents/rejected', message, details: {} } },
          });
        let body;
        try {
          body = await readBoundedJson(req, MAX_RPC_BODY_BYTES);
        } catch (error) {
          res.writeHead(error?.status ?? 400);
          res.end(error?.message ?? 'bad request body');
          return;
        }
        if (
          !body
          || typeof body !== 'object'
          || Array.isArray(body)
          || body.type !== 'client-request'
          || typeof body.rpcId !== 'string'
          || body.method !== endpoint
        ) {
          fail(body?.rpcId, `invalid client-request message for ${JSON.stringify(endpoint)}`);
          return;
        }
        try {
          const value = await manager.handleRpc(endpoint, body.payload ?? body.input ?? {});
          reply(200, {
            type: 'server-response',
            rpcId: body.rpcId,
            result: { ok: true, value },
          });
        } catch (error) {
          fail(body.rpcId, error instanceof Error ? error.message : String(error));
        }
      },
    });
    return () => {
      unregister?.();
      void manager.closeAllConnections();
    };
  });
}

export default {
  name,
  inject,
  apply,
  ACP_PROVIDER_PREFIX,
  isAcpProvider,
  providerIdForAgent,
  agentIdFromProvider,
};
