import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACP_PROVIDER_PREFIX,
  agentIdFromProvider,
  isAcpProvider,
  loadAgentsConfig,
  providerIdForAgent,
  resolveProfilesBaseDir,
  resolveSessionStoreFile,
  resolveStoreFile,
  loadSessionStore,
  sanitizeId,
} from './presets.js';
import { AcpSessionConnection } from './acp-session.js';
import { AgentAuthManager } from './agent-auth.js';
import { initAgentRuntime, runtimeBundle, configureRuntimeHost } from './agent-runtime.js';
import { createWhaleIsleMcp } from './mcp-server.js';
import { registerDelegation } from './delegation.js';
import { createTaskStore } from './tasks.js';
import { appendPrivateLog, ensurePrivateDir, stageLog } from './store-file.js';
import { acpErrorMessage } from './errors.js';
import { executionProvider, approvalPolicyOf, acpRuntimePolicy, safeGetService } from './host-contract.js';
import { isAuxiliaryCall, extractLatestUserPromptBlocks, conversationPrompt, prepareConversationPrompt } from './prompt-context.js';
import {
  encodeConnKey,
  decodeConnKey,
  createCatalogManager,
} from './catalog-models.js';
import { createDelegationRunner } from './delegation-runner.js';
import { createLlmAdapter } from './llm-adapter.js';
import {
  createRpcHandler,
  createHttpHandler,
} from './rpc-handlers.js';

export { isAuxiliaryCall, extractLatestUserPromptBlocks, conversationPrompt, prepareConversationPrompt };

export const name = 'dsh-acp-agents';
export const inject = ['llm', 'connection', 'webServer'];

export function createAcpAgentsManager(ctx, options = {}) {
  const releaseRuntime = configureRuntimeHost(ctx);
  const storeFile = options.storeFile || resolveStoreFile();
  const errorLogFile = path.join(path.dirname(storeFile), 'acp-error.log');
  const ownedStoreFiles = [
    storeFile,
    resolveSessionStoreFile(storeFile),
    path.join(path.dirname(storeFile), 'acp-tasks.json'),
  ];

  function appendAcpErrorLog(tag, err, extra = {}) {
    try {
      const entry = [
        `[${new Date().toISOString()}] ${tag}`,
        `message: ${err?.message || String(err)}`,
        err?.stack ? `stack: ${String(err.stack).slice(0, 4000)}` : 'stack: (none)',
        `extra: ${JSON.stringify(extra).slice(0, 1000)}`,
        '---',
      ].join('\n');
      appendPrivateLog(errorLogFile, `${entry}\n`);
    } catch {
      // diagnostics must never break the turn
    }
  }

  let agentList = loadAgentsConfig(storeFile);
  let sessionStore = loadSessionStore(storeFile);
  const getAgentList = () => agentList;
  const setAgentList = (next) => { agentList = next; };
  const getSessionStore = () => sessionStore;
  const setSessionStore = (next) => { sessionStore = next; };

  // Default per-agent profiles hold agent credentials.
  if (fs.existsSync(resolveProfilesBaseDir(storeFile))) ensurePrivateDir(resolveProfilesBaseDir(storeFile));

  const discoveredModels = new Map();
  const liveModelIds = new Map();
  // Map<encodeConnKey(sessionId, agentId) = `${sessionId}::${agentId}`,
  // AcpSessionConnection> — see encodeConnKey/decodeConnKey (AC-038).
  const sessionConnections = new Map();
  // Map<toolCallId, { entry, turn, dshAgent, conn }>
  const pendingToolExecutions = new Map();
  const tasks = createTaskStore(ctx, storeFile);
  const MCP_BRIDGE_PATH = fileURLToPath(new URL('./vendor/mcp-bridge.cjs', import.meta.url));
  const autoDeliverWrites = options.autoDeliverWrites === true;
  let adapterHandle = null;

  const authManager = new AgentAuthManager({
    ctx,
    stopSessions: stopCredentialSessions,
    onAuthChanged: (agentId, authenticated) => {
      if (authenticated) catalogManager.markAcpAuthed(agentId);
    },
  });

  const whaleisleMcp = createWhaleIsleMcp({
    ctx,
    listAgents: () => catalogManager.listDelegationAgents(),
    delegate: (args, parent, signal) => delegationRunner.delegate(args, parent, signal),
    preflightDelegate: (args, parent, subagents) => delegationRunner.preflightDelegate(args, parent, subagents),
    tasks,
    waitTask: (...args) => delegationRunner.waitTask(...args),
    diag: (tag, extra) => {
      appendPrivateLog(errorLogFile, `[${new Date().toISOString()}] whaleisleMcp.${tag} ${JSON.stringify(extra)}\n`);
    },
  });

  function purgePendingToolsForConn(conn) {
    if (!conn) return;
    for (const [id, tracked] of pendingToolExecutions) {
      if (tracked.conn === conn) pendingToolExecutions.delete(id);
    }
  }

  function purgePendingToolsForTurn(turn) {
    if (!turn) return;
    for (const [id, tracked] of pendingToolExecutions) {
      if (tracked.turn === turn) pendingToolExecutions.delete(id);
    }
  }

  function currentSandbox(agent) {
    return safeGetService(ctx, 'sandboxPolicy')?.resolve({ session: agent.session })?.mode || 'workspace-write';
  }

  function humanOwner(agent) {
    let owner = agent;
    const seen = new Set();
    while (owner?.session?.header?.parentSession && !seen.has(owner.id)) {
      seen.add(owner.id);
      const parent = safeGetService(ctx, 'agents')?.get(owner.session.header.parentSession);
      if (!parent) break;
      owner = parent;
    }
    return owner;
  }

  function planActive(agent) {
    return agent?.session?.snapshotEvents?.().findLast((event) => event.type === 'plan/mode')?.data.active === true;
  }

  async function askHuman(agent, signal, question, kind = 'question') {
    if (!agent?.session) throw new Error('Interactive user input requires a live host session.');
    const owner = humanOwner(agent);
    const questions = safeGetService(ctx, 'userQuestions');
    if (!questions) throw new Error('The host user-question service is unavailable.');
    tasks.setInteraction(agent.id, { kind, question: question.question, ownerId: owner.id });
    agent.session.append('acp-interaction/asked', { id: question.id, kind, ownerId: owner.id, question: question.question }, { ignorable: true });
    try {
      const answer = await questions.ask({ agent: owner, questions: [question], signal });
      agent.session.append('acp-interaction/answered', { id: question.id, kind, answer }, { ignorable: true });
      return answer;
    } catch (error) {
      agent.session.append('acp-interaction/failed', { id: question.id, kind, diagnostic: acpErrorMessage(error) }, { ignorable: true });
      throw error;
    } finally {
      if (agent?.id) tasks.setInteraction(agent.id, null);
    }
  }

  async function askOperation(agent, signal, question) {
    const owner = humanOwner(agent);
    const approval = safeGetService(ctx, 'approval');
    const policy = approvalPolicyOf(approval, owner.session);
    if (currentSandbox(agent) === 'danger-full-access' && policy === 'never') return true;
    if (policy === 'never') return false;
    const answer = await askHuman(agent, signal, {
      id: `acp-permission-${crypto.randomUUID()}`,
      question,
      header: 'Agent permission',
      options: [{ label: 'Allow once' }, { label: 'Deny' }],
      allowOther: false,
    }, 'approval');
    return answer.answers?.[0]?.selected?.includes('Allow once') === true;
  }

  function runtimePolicyFor(connection) {
    const agent = connection.hostAgent;
    if (!agent) return null; // Standalone ACP connections retain their original policy contract.
    const task = connection.preparingTask || [...tasks.tasks.values()].findLast((item) => item.childId === agent.id);
    const mode = currentSandbox(agent);
    const readOnly = mode === 'read-only' || planActive(agent) || planActive(humanOwner(agent)) || task?.interactionMode === 'plan' || task?.runtimeMode === 'read-only';
    const hostPolicy = approvalPolicyOf(safeGetService(ctx, 'approval'), humanOwner(agent).session);
    const ask = !readOnly && (task?.runtimeMode === 'approval-required' || hostPolicy !== 'never');
    return acpRuntimePolicy({ cwd: connection.cwd, readOnly, sandboxMode: mode, ask });
  }

  /**
   * ACP capability injection: every external agent session gets one
   * WhaleIsle-owned MCP server carried by the vendored stdio bridge
   * (DSH_ACP_MCP_* env, Bearer token scoped to the connection).
   */
  function buildMcpInjection(conn) {
    let origin;
    try {
      origin = ctx.webServer?.getOrigin?.();
    } catch {
      origin = null;
    }
    if (!origin) return null;
    const endpoint = `${origin}/dsh-acp-agents/mcp`;
    const token = whaleisleMcp.issueToken({
      cwd: conn.cwd,
      agentName: conn.agentConfig?.name,
      dshSession: conn.dshSession,
    });
    const injection = runtimeBundle().acpMcpInjection({
      endpoint,
      authorization: `Bearer ${token}`,
      // Forward slashes: Node's Windows spawn drops backslashes from command
      // paths (ENOENT on e.g. "C:\软件\...\node.exe"), and the agent spawning
      // this bridge is itself a Node-family process.
      bridgeCommand: process.execPath.replace(/\\/g, '/'),
      bridgeEntrypoint: MCP_BRIDGE_PATH.replace(/\\/g, '/'),
    });
    return {
      servers: injection.servers,
      acpServers: injection.acpServers,
      processEnvironment: injection.processEnvironment,
      endpoint,
      authorization: `Bearer ${token}`,
      token,
      release() {
        whaleisleMcp.revokeToken(token);
      },
    };
  }

  function getAgentById(id) {
    const clean = sanitizeId(id);
    return agentList.find((a) => a.id === clean) || null;
  }

  function getAgentByProvider(providerId) {
    const id = agentIdFromProvider(providerId);
    return id ? getAgentById(id) : null;
  }

  function createConnection(agentConfig, cwd, sessionId, hostAgent, preparingTask) {
    const connKey = encodeConnKey(sessionId, agentConfig.id);
    const mcpInjection = buildMcpInjection({ cwd, agentConfig, dshSession: preparingTask ? undefined : hostAgent?.session });
    const conn = new AcpSessionConnection({
      ctx, agentConfig, cwd, mcpInjection,
      onModelsDiscovered: (agentId, models) => {
        if (conn.wiring?.isAntigravity) liveModelIds.set(agentId, new Set(models.map((model) => model.id)));
        catalogManager.mergeDiscoveredModels(agentId, models);
      },
      resumeSessionId: preparingTask ? null : sessionStore[connKey]?.sessionId || null,
      requestApproval: (...args) => llmAdapter.requestAcpApproval(...args),
      requestUserInput: ({ turn }, question) => askHuman(turn.hostAgent, turn.signal, {
        id: question.id, question: question.question, header: question.header,
        options: question.options.map((option) => ({ label: option.label, description: option.description })),
        multiSelect: question.multiSelect, allowOther: question.allowCustomAnswer,
      }),
      getRuntimePolicy: runtimePolicyFor,
    });
    conn.onBackgroundWork = () => {
      const target = conn.hostAgent;
      if (conn.backgroundWakePending || !target?.followup) return;
      // Model selection is agent-scoped and does not rewrite creation options.
      // The latest assembled request is the route that owns native work.
      const provider = executionProvider(target);
      if (provider && provider !== agentConfig.providerId) return;
      conn.backgroundWakePending = true;
      target.followup({
        id: `acp-wake-${crypto.randomUUID()}`,
        role: 'user',
        content: [{ type: 'text', text: `${agentConfig.name}: native background output is ready.` }],
        source: { kind: 'acp-background', form: 'notice', summary: 'Native ACP background output is ready.', agentId: agentConfig.id },
      });
    };
    conn.onActivity = (activity) => tasks.activity(conn.hostAgent?.id, activity);
    conn.onTurnFailed = (turn) => purgePendingToolsForTurn(turn);
    conn.hostAgent = hostAgent;
    conn.preparingTask = preparingTask;
    conn.restoredSession = !preparingTask && Boolean(sessionStore[connKey]?.sessionId);
    conn.promptCursor = preparingTask ? undefined : sessionStore[connKey]?.promptCursor;
    return conn;
  }

  // A connection's MCP bearer token outlives conn.close() whenever the conn
  // died without running close() (a failed ensureReady marks it closed
  // directly). Revoke explicitly — revokeToken is idempotent (AC-046).
  function releaseConnMcpToken(conn) {
    const token = conn?.mcpToken;
    if (conn) conn.mcpToken = null;
    if (token) whaleisleMcp.revokeToken(token);
  }

  async function closeTrackedConnection(key, conn) {
    if (sessionConnections.get(key) === conn) sessionConnections.delete(key);
    purgePendingToolsForConn(conn);
    releaseConnMcpToken(conn);
    await conn.close();
  }

  function releaseAgentConnections(agent) {
    if (!agent?.id) return Promise.resolve();
    const closing = [...sessionConnections]
      .filter(([key]) => decodeConnKey(key)[0] === agent.id)
      .map(([key, conn]) => closeTrackedConnection(key, conn).catch(() => { /* Continue closing after an already disconnected connection. */ }));
    return Promise.all(closing);
  }

  function ownConnection(agent) {
    if (!agent || typeof agent.ctx?.effect !== 'function') return;
    for (const [key, conn] of sessionConnections) {
      if (decodeConnKey(key)[0] !== agent.id || conn.ownerBound) continue;
      conn.ownerBound = true;
      agent.ctx.effect(function* () { yield () => closeTrackedConnection(key, conn); });
    }
  }

  async function closeAgentConnections(agentId) {
    liveModelIds.delete(agentId);
    const closing = [];
    for (const [key, conn] of sessionConnections.entries()) {
      if (decodeConnKey(key)[1] === agentId) {
        sessionConnections.delete(key);
        releaseConnMcpToken(conn);
        closing.push(conn.close().catch(() => { /* Continue closing the other connections after one is already disconnected. */ }));
      }
    }
    await Promise.all(closing);
    for (const [id, tracked] of pendingToolExecutions) {
      if (tracked.conn?.agentConfig?.id === agentId) pendingToolExecutions.delete(id);
    }
  }

  function credentialBindingFor(agent) {
    return authManager.credentialBindingFor(agent);
  }

  async function stopCredentialSessions(agent, binding) {
    const key = binding ? `${binding.owner}:${binding.key}` : credentialBindingFor(agent);
    for (const other of agentList) {
      if (other.id !== agent.id && credentialBindingFor(other) !== key) continue;
      await closeAgentConnections(other.id);
      authManager.clearAccountStatus(other.id);
      if (other.id !== agent.id) await authManager.invalidate(other.id);
    }
  }

  async function assertCredentialsStable(agent) {
    await authManager.assertCredentialsStable(agent, agentList);
  }

  async function closeAllConnections() {
    const closing = [];
    for (const [, conn] of sessionConnections.entries()) {
      purgePendingToolsForConn(conn);
      releaseConnMcpToken(conn);
      closing.push(conn.close().catch(() => { /* Continue closing the other connections after one is already disconnected. */ }));
    }
    sessionConnections.clear();
    await Promise.all(closing);
  }

  function syncAdapterRoutes() {
    if (!ctx.llm || typeof ctx.llm.registerAdapter !== 'function') {
      appendAcpErrorLog('syncAdapterRoutes', new Error('ctx.llm unavailable'), {
        providers: agentList.filter((a) => a.enabled).map((a) => a.providerId),
      });
      return;
    }
    const allProviders = agentList.filter((a) => a.enabled).map((a) => a.providerId);
    if (adapterHandle) {
      try {
        adapterHandle.replace(allProviders);
        return;
      } catch (error) {
        // A released registration (e.g. the llm service fiber was reloaded)
        // cannot replace routes; fall through and register a fresh handle.
        appendAcpErrorLog('syncAdapterRoutes', error, { allProviders, phase: 'replace' });
        adapterHandle = null;
      }
    }
    if (allProviders.length > 0) {
      try {
        adapterHandle = ctx.llm.registerAdapter(allProviders, llmAdapter.adapter);
      } catch (error) {
        appendAcpErrorLog('syncAdapterRoutes', error, { allProviders, phase: 'register' });
        throw error;
      }
    }
  }

  function disposeAdapterRoutes() {
    const handle = adapterHandle;
    adapterHandle = null;
    try {
      handle?.();
    } catch (error) {
      appendAcpErrorLog('disposeAdapterRoutes', error, {});
    }
  }

  const catalogManager = createCatalogManager({
    storeFile,
    ownedStoreFiles,
    discoveredModels,
    liveModelIds,
    sessionConnections,
    authManager,
    getAgentList,
    setAgentList,
    syncAdapterRoutes,
    appendAcpErrorLog,
  });

  const llmAdapter = createLlmAdapter({
    ctx,
    storeFile,
    autoDeliverWrites,
    sessionConnections,
    pendingToolExecutions,
    tasks,
    whaleisleMcp,
    getSessionStore,
    getAgentByProvider,
    getAllModelsForAgent: catalogManager.getAllModelsForAgent,
    getEffectiveModels: catalogManager.getEffectiveModels,
    createConnection,
    ownConnection,
    assertCredentialsStable,
    markAcpAuthed: catalogManager.markAcpAuthed,
    purgePendingToolsForConn,
    releaseConnMcpToken,
    humanOwner,
    planActive,
    askOperation,
    runtimePolicyFor,
    appendAcpErrorLog,
  });

  const delegationRunner = createDelegationRunner({
    ctx,
    tasks,
    sessionConnections,
    getAgentList,
    getAgentById,
    getEffectiveModels: catalogManager.getEffectiveModels,
    currentSandbox,
    planActive,
    askOperation,
    assertCredentialsStable,
    createConnection,
    purgePendingToolsForConn,
    releaseConnMcpToken,
    appendAcpErrorLog,
  });

  const rpcHandler = createRpcHandler({
    ctx,
    storeFile,
    tasks,
    authManager,
    discoveredModels,
    sessionConnections,
    getAgentList,
    setAgentList,
    getSessionStore,
    setSessionStore,
    getAgentById,
    getAllModelsForAgent: catalogManager.getAllModelsForAgent,
    buildCatalog: catalogManager.buildCatalog,
    mergeDiscoveredModels: catalogManager.mergeDiscoveredModels,
    markAcpAuthed: catalogManager.markAcpAuthed,
    syncAdapterRoutes,
    closeAgentConnections,
    closeAllConnections,
    stopCredentialSessions,
    purgePendingToolsForConn,
    releaseConnMcpToken,
  });

  async function dispose() {
    await closeAllConnections();
    await authManager.dispose();
    pendingToolExecutions.clear();
    await releaseRuntime();
  }

  return {
    adapter: llmAdapter.adapter,
    syncAdapterRoutes,
    disposeAdapterRoutes,
    whaleisleMcp,
    handleRpc: rpcHandler.handleRpc,
    buildCatalog: catalogManager.buildCatalog,
    pendingToolExecutions,
    executeTrackedToolCall: llmAdapter.executeTrackedToolCall,
    trackedExecution: llmAdapter.trackedExecution,
    dispose,
    closeAllConnections,
    ownConnection,
    releaseAgentConnections,
    listDelegationAgents: catalogManager.listDelegationAgents,
    preflightDelegate: delegationRunner.preflightDelegate,
    delegate: delegationRunner.delegate,
    tasks,
    waitTask: delegationRunner.waitTask,
    appendAcpErrorLog,
  };
}

export function apply(ctx, config = {}) {
  const manager = createAcpAgentsManager(ctx, config);
  ctx.on('agent/created', ({ agent }) => manager.ownConnection(agent), { global: true });
  ctx.on('agent/disposed', ({ agent }) => manager.releaseAgentConnections(agent), { global: true });
  ctx.inject(['subagents', 'tools'], (scope) => { manager.tasks.install(scope); registerDelegation(scope, manager); });
  // Surface vendored-runtime problems after boot settles rather than mid-boot
  // or first turn — parsing the ~3.7MB vendor bundle on setTimeout(0) lands
  // inside Cordis's async plugin-import turns and delays web readiness.
  ctx.effect(() => {
    let timer = null;
    let disposed = false;
    const schedule = (delayMs) => {
      if (disposed || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (disposed) return;
        void initAgentRuntime().catch((err) => {
          manager.appendAcpErrorLog('initAgentRuntime', err, {});
        });
      }, delayMs);
      timer.unref?.();
    };
    const appReady = typeof ctx.get === 'function' ? ctx.get('appReady') : undefined;
    let unsubscribe = null;
    if (typeof appReady?.onReady === 'function') {
      unsubscribe = appReady.onReady(() => schedule(1500));
    } else {
      schedule(0);
    }
    return () => {
      disposed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
  });

  // The adapter registration is an effect owned by this plugin's fiber: on
  // reload the routes are released, so a re-apply never collides with a stale
  // registration left in the llm registry.
  ctx.effect(() => {
    manager.syncAdapterRoutes();
    return () => manager.disposeAdapterRoutes();
  });

  // The host validates every yielded tool-call name against
  // [A-Za-z0-9_-]{1,64} and dispatches it through its own tool pipeline. ACP
  // tool calls carry free-text titles, so acp-session maps each call onto these
  // registered names; `tools/execute` then bridges the call back to the
  // tracked ACP-side outcome instead of running anything locally.
  const acpToolNames = [
    'acp_read', 'acp_edit', 'acp_delete', 'acp_move', 'acp_search',
    'acp_execute', 'acp_think', 'acp_fetch', 'acp_switch_mode', 'acp_tool',
  ];
  ctx.inject(['tools'], (scope) => {
    const toolsSvc = safeGetService(scope, 'tools');
    if (!toolsSvc || typeof toolsSvc.register !== 'function') return;
    for (const toolName of acpToolNames) {
      try {
        scope.effect(() => toolsSvc.register({
          name: toolName,
          description: 'External ACP agent step (bridged; not executed locally).',
          parameters: { type: 'object', additionalProperties: true },
          output: {
            schema: { type: 'object' },
            render: (_args, value) => [
              { type: 'text', text: String(value?.text ?? '') },
            ],
          },
          presentCall: (args) => {
            const title = String(args?._title || toolName);
            const kind = String(args?._kind || 'other');
            const command = args?.CommandLine;
            if (kind === 'execute' && typeof command === 'string' && command) {
              return {
                card: 'terminal',
                title: command,
                ...(typeof args?.Cwd === 'string' ? { cwd: args.Cwd } : {}),
              };
            }
            return {
              card: 'generic',
              title,
              kind: ['read', 'edit', 'delete', 'move', 'search', 'execute', 'fetch'].includes(kind) ? kind : 'other',
            };
          },
          presentResult: (args, result) => {
            const kind = String(args?._kind || 'other');
            if (kind === 'execute') {
              const text = (result?.content || [])
                .map((b) => (b?.type === 'text' ? b.text : ''))
                .join('') || String(result?.content ?? '');
              return { card: 'terminal', title: String(args?._title || toolName), output: text };
            }
            return {
              card: 'generic',
              title: String(args?._title || toolName),
              ...(result?.isError ? { isError: true } : {}),
            };
          },
          execute: async (args, exec) => {
            const tracked = manager.trackedExecution(exec);
            if (tracked) {
              const result = await manager.executeTrackedToolCall(exec);
              return result?.value ?? { text: '' };
            }
            return { text: 'external agent step' };
          },
        }));
      } catch (err) {
        manager.appendAcpErrorLog('tools/register', err, { name: toolName });
      }
    }
  });

  if (typeof ctx.on === 'function') {
    ctx.on('tools/pre-execute', async (exec, next) => {
      stageLog('tools/pre-execute callId=' + exec?.callId + ' name=' + exec?.name + ' tracked=' + manager.pendingToolExecutions.has(exec?.callId));
      if (manager.trackedExecution(exec)) {
        return { kind: 'allow' };
      }
      return next();
    }, { prepend: true });

    ctx.on('tools/execute', async (exec, next) => {
      stageLog('tools/execute callId=' + exec?.callId + ' name=' + exec?.name + ' tracked=' + manager.pendingToolExecutions.has(exec?.callId));
      if (manager.trackedExecution(exec)) {
        try {
          const result = await manager.executeTrackedToolCall(exec);
          if (result) return result;
        } catch (err) {
          manager.appendAcpErrorLog('tools/execute', err, { callId: exec?.callId, name: exec?.name });
          throw err;
        }
      }
      return next();
    }, { prepend: true });
  }

  ctx.effect(() => {
    const unregister = ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-acp-agents',
      handler: createHttpHandler(ctx, manager),
    });
    return async () => {
      unregister?.();
      await manager.dispose();
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
