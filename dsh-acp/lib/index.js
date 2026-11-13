import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  resolveSessionStoreFile,
  resolveStoreFile,
  loadSessionStore,
  saveSessionStore,
  sanitizeId,
  saveAgentsConfig,
} from './presets.js';
import {
  AcpSessionConnection,
  AcpTurnExecution,
  modelsFromConfigOptions,
  modelOptionMetadata,
  probeAcpAgent,
} from './acp-session.js';
import {
  AgentAuthManager,
  openExternalUrl,
} from './agent-auth.js';
import { initAgentRuntime, runtimeBundle, configureRuntimeHost, agentRuntimeIdentity } from './agent-runtime.js';
import { createWhaleIsleMcp } from './mcp-server.js';
import { DELEGATION_PROVIDER, registerDelegation } from './delegation.js';
import { createTaskStore, TASK_ADMISSION } from './tasks.js';
import { createTaskCheckout } from './isolation.js';
import { acpErrorMessage, preparationError } from './errors.js';
import { executionProvider, approvalPolicyOf } from './host-contract.js';

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

// Temporary tracing (DSH_ACP_STAGE_LOG=<file>) — same env var acp-session.js uses.
function stageLogIndex(msg) {
  const file = process.env.DSH_ACP_STAGE_LOG;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

// Diagnostic: write full error stacks for ACP stream failures to a sidecar log.
// Temporary while chasing the undefined `.includes` crash report; keep the log
// small by truncating each entry.
function appendAcpErrorLog(tag, err, extra = {}) {
  try {
    const dir = path.dirname(resolveStoreFile());
    const file = path.join(dir, 'acp-error.log');
    const entry = [
      `[${new Date().toISOString()}] ${tag}`,
      `message: ${err?.message || String(err)}`,
      err?.stack ? `stack: ${String(err.stack).slice(0, 4000)}` : 'stack: (none)',
      `extra: ${JSON.stringify(extra).slice(0, 1000)}`,
      '---',
    ].join('\n');
    fs.appendFileSync(file, `${entry}\n`);
  } catch {
    // diagnostics must never break the turn
  }
}

// Read-class ACP tool-call kinds — the only kinds the 'auto-allow-read'
// permission policy may approve without asking; every other kind still
// requires a real approval answer (AC-018).
const READ_ONLY_TOOL_KINDS = new Set(['read', 'search', 'fetch', 'think']);

// Secret-shaped env vars (the same key test the renderer uses to pick
// password inputs): catalog payloads must never broadcast their values to
// the renderer, so they are masked. A mask coming back on save means
// "keep the stored secret" and is never persisted itself (AC-033).
const SECRET_ENV_KEY_RE = /KEY|TOKEN|SECRET|PASSWORD/i;
const ENV_SECRET_MASK = '__DSH_ACP_MASKED_SECRET__';

function maskEnvSecrets(env) {
  if (!env || typeof env !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = SECRET_ENV_KEY_RE.test(key) ? ENV_SECRET_MASK : value;
  }
  return out;
}

function restoreMaskedEnv(env, existing) {
  if (!env || typeof env !== 'object') return env;
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === ENV_SECRET_MASK) {
      const kept = existing?.[key];
      if (typeof kept === 'string' && kept !== ENV_SECRET_MASK) out[key] = kept;
      continue;
    }
    out[key] = value;
  }
  return out;
}

// sessionConnections keys are `${dshSessionId}::${agentId}`. agentId always
// comes from sanitizeId ([a-z0-9_-] — it can never contain ':'), so
// splitting at the LAST '::' is unambiguous even for session ids that
// themselves contain '::' (AC-038). The on-disk session-store key format is
// unchanged, so no migration is needed.
function encodeConnKey(sessionId, agentId) {
  return `${String(sessionId)}::${String(agentId)}`;
}

function decodeConnKey(key) {
  const text = String(key);
  const idx = text.lastIndexOf('::');
  if (idx === -1) return [text, ''];
  return [text.slice(0, idx), text.slice(idx + 2)];
}

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
 * Auxiliary LLM calls (session title, compaction, vision describe, and the
 * next-prompt predictor) must not become ACP conversation turns. They are
 * detected by an explicit `purpose` or by the predictor's tool-less
 * suggestion-prompt signature.
 */
export function isAuxiliaryCall(callOptions) {
  if (!callOptions || typeof callOptions !== 'object') return false;
  if (callOptions.purpose !== undefined) return true;
  const tools = callOptions.tools;
  if (!Array.isArray(tools) || tools.length !== 0) return false;
  const text = (callOptions.messages ?? [])
    .map((m) => {
      if (typeof m?.content === 'string') return m.content;
      if (Array.isArray(m?.content)) return m.content.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
      return '';
    })
    .join('\n');
  return text.includes('Conversation reference data')
    || text.includes("USER'S NEXT message")
    || text.includes('Predict one short message');
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
    // DSH injects non-user-authored user-role rows at the tail (model-change
    // markers, continuation predictions). Only an explicitly authored source
    // counts as the user's turn.
    const sourceKind = msg.source?.kind;
    if (sourceKind !== undefined && !['user', 'agent-message', 'subagent-settled'].includes(sourceKind)) continue;
    const blocks = [];
    if (typeof msg.content === 'string') {
      if (msg.content.trim()) blocks.push({ type: 'text', text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          blocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'file' && block.attachment) {
          blocks.push(block);
        } else if (block.type === 'image' && block.attachment) {
          blocks.push(block);
        }
      }
    }
    if (blocks.length > 0) {
      return blocks;
    }
  }
  return [{ type: 'text', text: 'Continue.' }];
}

/** Seed a newly selected agent with the visible conversation, then relay only missed turns. */
export function conversationPrompt(messages, connection) {
  const rows = Array.isArray(messages) ? messages : [];
  const previous = connection.promptCursor;
  const index = previous ? rows.findIndex((message) => message.id === previous) : -1;
  const relevant = index >= 0 ? rows.slice(index + 1) : connection.restoredSession && !connection.promptStarted ? [] : rows;
  const transcript = relevant.filter((message) => {
    if (message.role === 'assistant') return true;
    return message.role === 'user'
      && (message.source?.kind === undefined || ['user', 'agent-message', 'subagent-settled'].includes(message.source.kind));
  }).map((message) => {
    const text = typeof message.content === 'string' ? message.content : (message.content || [])
      .map((block) => {
        if (block?.type === 'text') return block.text;
        if ((block?.type === 'file' || block?.type === 'image') && block.attachment) {
          return `[Attached ${block.type}: ${block.attachment.name || block.attachment.path || 'attachment'}]`;
        }
        return '';
      }).filter(Boolean).join('\n');
    return text ? `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${text}` : '';
  }).filter(Boolean);
  const latest = extractLatestUserPromptBlocks(rows);
  connection.promptCursor = rows.findLast((message) => message.role === 'user'
    && (message.source?.kind === undefined || ['user', 'agent-message', 'subagent-settled'].includes(message.source.kind)))?.id;
  connection.promptStarted = true;
  const prompt = transcript.length > 1
    ? [{ type: 'text', text: 'Conversation context (earlier turns may have used another agent):\n\n' + transcript.join('\n\n') }]
    : latest;
  if (transcript.length > 1) for (const message of relevant) for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block.type === 'image' && block.attachment && !block.offloaded) prompt.push(block);
    if (block.type === 'file' && block.attachment) prompt.push(block);
  }
  return prompt;
}

function resolveActiveDshAgent(ctx, options) {
  const agentsSvc = safeGetService(ctx, 'agents');
  if (!agentsSvc) return null;
  try {
    // The registry resolves agents directly by session id.
    const byId = options?.sessionId ? agentsSvc.get?.(String(options.sessionId)) : null;
    if (byId) return byId;
  } catch {
    // ignore
  }
  try {
    // AsyncLocalStorage boundary set by the driving loop.
    const initiator = agentsSvc.currentInitiator?.() ?? agentsSvc.initiator?.();
    if (initiator) return initiator;
  } catch {
    // ignore
  }
  try {
    const list = typeof agentsSvc.list === 'function' ? agentsSvc.list()
      : typeof agentsSvc.values === 'function' ? [...agentsSvc.values()]
      : [];
    if (list.length > 0) {
      const lastMsgId = Array.isArray(options?.messages)
        ? options.messages.findLast((m) => m && typeof m.id === 'string')?.id
        : null;
      for (const agent of list) {
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
  const releaseRuntime = configureRuntimeHost(ctx);
  const storeFile = options.storeFile || resolveStoreFile();
  let agentList = loadAgentsConfig(storeFile);
  let sessionStore = loadSessionStore(storeFile);
  const discoveredModels = new Map();
  const liveModelIds = new Map();
  // Map<encodeConnKey(sessionId, agentId) = `${sessionId}::${agentId}`,
  // AcpSessionConnection> — see encodeConnKey/decodeConnKey (AC-038).
  const sessionConnections = new Map();
  // Map<toolCallId, { entry, turn, dshAgent, conn }>
  const pendingToolExecutions = new Map();
  const tasks = createTaskStore(ctx, storeFile);
  const authManager = new AgentAuthManager({
    ctx,
    stopSessions: stopCredentialSessions,
    onAuthChanged: (agentId, authenticated) => {
      if (authenticated) markAcpAuthed(agentId);
    },
  });
  const whaleisleMcp = createWhaleIsleMcp({
    ctx,
    listAgents: () => listDelegationAgents(),
    delegate: (args, parent, signal) => delegate(args, parent, signal, 'parent'),
    tasks,
    waitTask: (...args) => waitTask(...args),
    diag: (tag, extra) => {
      try {
        const file = path.join(path.dirname(resolveStoreFile()), 'acp-error.log');
        fs.appendFileSync(file, `[${new Date().toISOString()}] whaleisleMcp.${tag} ${JSON.stringify(extra)}\n`);
      } catch { /* diagnostics never break the turn */ }
    },
  });
  let adapterHandle = null;

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
    const owner = humanOwner(agent);
    const questions = safeGetService(ctx, 'userQuestions');
    if (!questions) throw new Error('The host user-question service is unavailable.');
    tasks.setInteraction(agent.id, { kind, question: question.question, ownerId: owner.id });
    agent.session.append('acp-interaction/asked', { id: question.id, kind, ownerId: owner.id, question: question.question }, { ignorable: true });
    try {
      const answer = await questions.ask({ agent: owner, questions: [question], signal });
      agent.session.append('acp-interaction/answered', { id: question.id, kind, answer }, { ignorable: true });
      return answer;
    } finally { tasks.setInteraction(agent.id, null); }
  }
  async function askOperation(agent, signal, question) {
    const owner = humanOwner(agent);
    const approval = safeGetService(ctx, 'approval');
    const policy = approvalPolicyOf(approval, owner.session);
    if (currentSandbox(agent) === 'danger-full-access' && policy === 'never') return true;
    if (policy === 'never') return false;
    const answer = await askHuman(agent, signal, { id: `acp-permission-${crypto.randomUUID()}`, question,
      header: 'Agent permission', options: [{ label: 'Allow once' }, { label: 'Deny' }], allowOther: false }, 'approval');
    return answer.answers?.[0]?.selected?.includes('Allow once') === true;
  }
  function runtimePolicyFor(connection) {
    const agent = connection.hostAgent;
    if (!agent) return null; // Standalone ACP connections retain their original policy contract.
    const task = connection.preparingTask || [...tasks.tasks.values()].findLast((item) => item.childId === agent.id);
    const mode = currentSandbox(agent);
    const readOnly = mode === 'read-only' || planActive(agent) || planActive(humanOwner(agent)) || task?.interactionMode === 'plan' || task?.runtimeMode === 'read-only';
    const hostPolicy = approvalPolicyOf(safeGetService(ctx, 'approval'), humanOwner(agent).session);
    const sandboxPolicy = { type: readOnly ? 'readOnly' : mode === 'danger-full-access' ? 'dangerFullAccess' : 'workspaceWrite', writableRoots: [connection.cwd] };
    const ask = !readOnly && (task?.runtimeMode === 'approval-required' || hostPolicy !== 'never');
    return { cwd: connection.cwd, runtimeMode: readOnly ? 'approval-required' : ask ? 'approval-required' : 'full-access',
      approvalPolicy: ask ? 'on-request' : 'never', sandboxPolicy };
  }

  async function attachmentPrompt(blocks, connection, signal) {
    const result = [];
    for (const block of blocks) {
      if (block.type === 'file') {
        const attachments = safeGetService(ctx, 'attachments');
        const filePath = attachments?.fileHostPath(block.attachment);
        if (!filePath) throw new Error(`Cannot resolve attached file "${block.attachment.name}" to a readable host path.`);
        result.push({ type: 'resource_link', uri: pathToFileURL(filePath).href, name: block.attachment.name, title: block.attachment.name });
        continue;
      }
      if (block.type !== 'image') { result.push(block); continue; }
      if (!connection.supportsImages) throw new Error(`ACP agent "${connection.agentConfig.name}" did not negotiate image prompt support.`);
      const attachments = safeGetService(ctx, 'attachments');
      if (!attachments) throw new Error('The host attachment service is unavailable.');
      const image = await attachments.readImage(block.attachment, signal);
      result.push({ type: 'image', data: Buffer.from(image.data).toString('base64'), mimeType: image.ref.mediaType });
    }
    return result;
  }

  function listDelegationAgents() {
    return agentList.filter((agent) => agent.enabled).map((agent) => ({
      id: agent.id,
      name: agent.name,
      provider: agent.providerId,
      models: getEffectiveModels(agent).map((model) => ({ id: model.id, name: model.name || model.id, efforts: model.efforts || [], options: model.options || [] })),
      runtimeModes: ['inherit', 'read-only', 'approval-required'], interactionModes: ['default', 'plan'], isolation: ['shared', 'worktree'],
    }));
  }

  async function delegate(args, parent, signal, delivery, subagents = safeGetService(ctx, 'subagents')) {
    if (!parent) throw new Error('Agent delegation requires an active parent session.');
    const agent = agentList.find((item) => item.id === args.agent && item.enabled);
    if (!agent) throw new Error(`Agent "${args.agent}" is not enabled. Call acp_agents for available agents.`);
    if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new Error('A non-empty task prompt is required.');
    if (!subagents?.getProvider?.(DELEGATION_PROVIDER)) throw new Error('The host subagent service is not available.');
    signal.throwIfAborted();
    const model = args.model || getEffectiveModels(agent)[0]?.id || 'default';
    const models = getEffectiveModels(agent);
    if (!models.some((entry) => entry.id === model)) {
      throw new Error(`Unknown model "${model}" for ${agent.name}. Available model ids: ${models.map((entry) => entry.id).join(', ')}. Omit model to use ${models[0]?.id || 'default'}.`);
    }
    if (args.reasoning_effort !== undefined && (typeof args.reasoning_effort !== 'string' || !args.reasoning_effort)) throw new Error('reasoning_effort must be a non-empty advertised effort id.');
    if (args.options !== undefined) {
      if (!Array.isArray(args.options)) throw new Error('options must be an array of discovered id/value settings.');
      for (const setting of args.options) {
        if (!setting || typeof setting.id !== 'string' || !['string', 'boolean'].includes(typeof setting.value)) throw new Error('Each option requires a string id and a string or boolean value.');
      }
    }
    if (args.mode !== undefined && !['async', 'wait'].includes(args.mode)) throw new Error('mode must be async or wait.');
    if (args.timeout_ms !== undefined && (!Number.isInteger(args.timeout_ms) || args.timeout_ms < 0 || args.timeout_ms > 20000)) throw new Error('timeout_ms must be from 0 to 20000.');
    if (args.isolation !== undefined && !['shared', 'worktree'].includes(args.isolation)) throw new Error('isolation must be shared or worktree.');
    if (args.interaction_mode !== undefined && !['default', 'plan'].includes(args.interaction_mode)) throw new Error('interaction_mode must be default or plan.');
    if (args.runtime_mode !== undefined && !['inherit', 'read-only', 'approval-required'].includes(args.runtime_mode)) throw new Error('runtime_mode cannot raise the host permission policy.');
    return tasks.once(parent, args.client_request_id, args, async (requestKey, requestArguments) => {
      const childId = crypto.randomUUID(), taskId = crypto.randomUUID();
      const identity = { childId, agentId: agent.id, agentName: agent.name,
        model, modelName: models.find((entry) => entry.id === model)?.name || model, task: args.description || args.prompt,
        turn: parent.session?.snapshotEvents().findLast((event) => event.type === 'turn/start')?.data.turn ?? null,
        interactionMode: planActive(parent) ? 'plan' : args.interaction_mode || 'default', runtimeMode: args.runtime_mode || 'inherit',
        cwd: parent.session.header.cwd || process.cwd(), options: args.options || [], delivery: 'caller', requestKey, requestArguments };
      let conn, task, onAbortPreparation, stage = 'connection';
      const connKey = encodeConnKey(childId, agent.id);
      try {
        if (args.isolation === 'worktree') {
          stage = 'worktree';
          if (identity.interactionMode === 'plan' || identity.runtimeMode === 'read-only' || currentSandbox(parent) === 'read-only') throw new Error('Worktree creation requires a writable host policy.');
          if (!(await askOperation(parent, signal, `Create an isolated checkout from committed HEAD for ${agent.name}?`))) throw new Error('Worktree creation was not approved.');
          Object.assign(identity, await createTaskCheckout(identity.cwd, taskId, signal));
        }
        // Prepare the actual child connection, not a throwaway model probe.
        // No host child, prompt, task row or acceptance receipt exists yet.
        stage = 'connection/authentication';
        await assertCredentialsStable(agent);
        conn = createConnection(agent, identity.cwd, childId, parent, identity);
        sessionConnections.set(connKey, conn);
        onAbortPreparation = () => { void conn.close().catch(() => {}); };
        signal.addEventListener('abort', onAbortPreparation, { once: true });
        signal.throwIfAborted();
        await conn.ensureReady(signal);
        stage = 'model';
        await conn.syncModelAndEffort(model, args.reasoning_effort, signal, args.reasoning_effort !== undefined);
        stage = 'settings';
        for (const setting of identity.options) await conn.syncOption(setting.id, setting.value);
        await conn.syncRuntimeMode(identity.interactionMode, signal);
        signal.throwIfAborted();
        if (!getAgentById(agent.id)?.enabled) throw new Error('Agent was disabled while preparing the task.');
        signal.removeEventListener('abort', onAbortPreparation);
        task = tasks.begin(parent, identity, { taskId });
        const maxDepth = subagents.resolveMaxDepth();
        const request = { parent, prompt: [{ type: 'text', text: args.prompt }],
          agentOptions: { provider: agent.providerId, model, ...(args.reasoning_effort ? { reasoningEffort: args.reasoning_effort } : {}) },
          ...(maxDepth === undefined ? {} : { maxDepth }) };
        const child = await subagents.startActivation({
          provider: DELEGATION_PROVIDER, childId,
          environment: { cwd: identity.cwd, admissionPolicy: TASK_ADMISSION },
          label: args.description || `Delegate to ${agent.name}`,
          // Host 0.2.2 flattens the 0.2.1 activation request. Supply the same
          // request in both positions; never retry a possibly admitted task.
          ...request, request,
          signal, delivery: 'caller',
        });
        const receipt = tasks.attach(parent, task, child);
        const onAbort = () => { void tasks.cancel(parent, task.taskId).catch((error) => appendAcpErrorLog('delegation/cancel', error, {})); };
        signal.addEventListener('abort', onAbort, { once: true });
        receipt.result.finally(() => signal.removeEventListener('abort', onAbort)).catch(() => {});
        if (signal.aborted) await tasks.cancel(parent, task.taskId);
        return receipt;
      } catch (error) {
        sessionConnections.delete(connKey);
        releaseConnMcpToken(conn);
        await conn?.close();
        if (task) {
            task.deliveryState = signal.aborted ? 'disposed' : 'acknowledged';
            await tasks.finish(parent, task, { output: [], stopReason: signal.aborted ? 'aborted' : 'error', diagnostic: acpErrorMessage(error) });
            if (signal.aborted) throw signal.reason;
          throw error;
        }
          if (signal.aborted) throw signal.reason;
        const failure = preparationError(error, stage, agent, stage === 'model' ? modelsFromConfigOptions(conn?.configOptions).map(model => model.id) : undefined);
        if (identity.repositoryRoot) failure.message += ` Retained checkout: ${identity.cwd}`;
        throw failure;
      } finally {
        if (onAbortPreparation) signal.removeEventListener('abort', onAbortPreparation);
      }
    });
  }

  async function waitTask(parent, id, waitMs, signal) {
    if (!waitMs) return tasks.snapshot(parent, id, true);
    let timer, off, onAbort;
    const changed = new Promise((resolve, reject) => {
      off = ctx.on('session/event', (session, event) => { if (session.id === parent.id && event.type === 'acp-delegation/end' && event.data.taskId === id) resolve(); });
      timer = setTimeout(resolve, waitMs);
      onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      signal.throwIfAborted();
      const initial = await tasks.snapshot(parent, id);
      if (initial.status !== 'running') return tasks.snapshot(parent, id, true);
      await changed; return tasks.snapshot(parent, id, true);
    } finally { clearTimeout(timer); off?.(); signal.removeEventListener('abort', onAbort); changed.catch(() => {}); }
  }

  const MCP_BRIDGE_PATH = fileURLToPath(new URL('./vendor/mcp-bridge.cjs', import.meta.url));

  // Opt-in (config `autoDeliverWrites`): in directories outside any git
  // repository the workspace-changes recorder sees nothing, so files written
  // through the fs/write_text_file bridge are declared as deliveries at the
  // end of the turn instead. Git trees stay covered by the real recorder.
  const autoDeliverWrites = options.autoDeliverWrites === true;
  const gitRepoCache = new Map();

  function insideGitRepo(cwd) {
    let inside = gitRepoCache.get(cwd);
    if (inside === undefined) {
      try {
        const res = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
          cwd, encoding: 'utf8', timeout: 8000, windowsHide: true,
        });
        inside = res.status === 0 && String(res.stdout || '').trim() === 'true';
      } catch {
        inside = false;
      }
      gitRepoCache.set(cwd, inside);
    }
    return inside;
  }

  async function autoDeliver(conn, dshSession) {
    try {
      const written = conn?.writtenPaths;
      if (!autoDeliverWrites || !written?.size) return;
      if (!dshSession || typeof dshSession.append !== 'function') return;
      if (insideGitRepo(conn.cwd)) {
        written.clear();
        return;
      }
      const fsSvc = safeGetService(ctx, 'fs');
      const projections = safeGetService(ctx, 'sessionProjections');
      if (!fsSvc || !projections) return;
      const boundary = projections.stateOf(dshSession, 'turnBoundary');
      const turn = boundary?.lastTurn;
      if (turn == null) return;
      const alreadyPresented = whaleisleMcp.sessionFor(conn.mcpToken)?.presented;
      const files = [];
      for (const filePath of [...written]) {
        try {
          const target = await fsSvc.resolve(filePath, { cwd: conn.cwd });
          const info = await fsSvc.stat(target);
          if (info === undefined || info.type !== 'file') continue;
          const canonical = fsSvc.processPath(target);
          if (alreadyPresented?.has(canonical)) continue;
          files.push({ path: canonical });
        } catch {
          // A path that no longer resolves is simply not delivered.
        }
      }
      written.clear();
      if (files.length === 0) return;
      dshSession.append('deliverables/presented', {
        turn,
        callId: `whaleisle-auto-${crypto.randomBytes(6).toString('hex')}`,
        files,
      });
    } catch (err) {
      appendAcpErrorLog('autoDeliver', err, { cwd: conn?.cwd });
    }
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
        if (conn.wiring?.isAntigravity) liveModelIds.set(agentId, new Set(models.map(model => model.id)));
        mergeDiscoveredModels(agentId, models);
      },
      resumeSessionId: preparingTask ? null : sessionStore[connKey]?.sessionId || null,
      requestApproval: requestAcpApproval,
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
      target.followup({ id: `acp-wake-${crypto.randomUUID()}`, role: 'user',
        content: [{ type: 'text', text: `${agentConfig.name}: native background output is ready.` }],
        source: { kind: 'acp-background', form: 'notice', summary: 'Native ACP background output is ready.', agentId: agentConfig.id } });
    };
    conn.hostAgent = hostAgent;
    conn.preparingTask = preparingTask;
    conn.restoredSession = !preparingTask && Boolean(sessionStore[connKey]?.sessionId);
    conn.promptCursor = preparingTask ? undefined : sessionStore[connKey]?.promptCursor;
    return conn;
  }

  function ownConnection(agent) {
    if (!agent?.session.header.parentSession) return;
    for (const [key, conn] of sessionConnections) {
      if (decodeConnKey(key)[0] !== agent.id || conn.ownerBound) continue;
      conn.ownerBound = true;
      agent.ctx.effect(function* () {
        yield async () => {
          if (sessionConnections.get(key) === conn) sessionConnections.delete(key);
          releaseConnMcpToken(conn);
          await conn.close();
        };
      });
    }
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
    const live = [...sessionConnections.values()].find((connection) => !connection.closed && connection.capabilitiesKnown && connection.agentConfig.id === agent.id);

    for (const item of [...base, ...extra]) {
      const id = String(item?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push({
        ...item,
        ...extra.find((model) => model.id === id),
        ...(live ? { inputModalities: live.supportsImages ? ['text', 'image'] : ['text'] } : {}),
        ...(live?.currentModel === id && live.activeTurn?.contextUsage?.maxTokens ? { context: { contextWindow: live.activeTurn.contextUsage.maxTokens } } : {}),
        id,
        name: item.name || id,
        favorite: favSet.has(id),
        hidden: hiddenSet.has(id),
        discovered: item.discovered === true || !base.some((b) => b.id === id),
        available: !liveModelIds.has(agent.id) || liveModelIds.get(agent.id).has(id),
      });
    }

    if (all.length === 0) {
      all.push({
        id: 'default',
        name: `${agent?.name || 'ACP'} Default`,
        favorite: false,
        hidden: false,
        discovered: false,
        available: !liveModelIds.has(agent?.id) || liveModelIds.get(agent.id).has('default'),
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
   * Hiding every model yields an empty list — the user asked for none.
   */
  function getEffectiveModels(agent) {
    return getAllModelsForAgent(agent).filter((m) => !m.hidden && m.available !== false);
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
      // ResolvedRetryPolicy shape required by llm-retry: an empty
      // retryableCodes set short-circuits before any retry attempt — an
      // external agent turn must never be replayed implicitly.
      return {
        mode: 'normal',
        maxRetries: 0,
        retryableCodes: [],
        initialDelayMs: 500,
        maxDelayMs: 2_000,
        jitterRatio: 0,
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
        // The composer picker renders `m.favorite`; without it the star
        // state saved in favoriteModels never surfaces in the picker.
        favorite: m.favorite === true,
        ...(m.inputModalities ? { inputModalities: m.inputModalities } : {}),
        ...(m.efforts?.length ? { reasoning: { efforts: m.efforts } } : {}),
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
        // Stateful ACP sessions own their context. Host-side summarization
        // cannot replace the external agent's native conversation state.
        contextManagement: 'provider',
        ...(matched?.inputModalities ? { inputModalities: matched.inputModalities } : {}),
        ...(matched?.context ? { context: matched.context } : {}),
        ...(matched?.efforts?.length ? { reasoning: {
          efforts: matched.efforts,
        } } : {}),
      };
    },
    async prepareCall(provider, model, signal) {
      return {
        model: await this.resolveModel(provider, model, signal),
        stream: (callOptions) => this.stream(callOptions),
      };
    },
    async *stream(callOptions) {
      let nextIndex = 0;
      try {
        for await (const chunk of this._streamImpl(callOptions)) {
          if (typeof chunk.index === 'number') nextIndex = Math.max(nextIndex, chunk.index + 1);
          yield chunk;
        }
      } catch (err) {
        appendAcpErrorLog('adapter.stream', err, {
          provider: callOptions?.provider,
          model: callOptions?.model,
          sessionId: callOptions?.sessionId,
          data: err?.data,
        });
        if (callOptions.signal?.aborted || err.name === 'AbortError') throw err;
        // Like the native one-shot providers, retain a useful failure result
        // before settlement. Cold continuations use the host's result delivery.
        const failure = { message: acpErrorMessage(err), code: 'ACP_EXECUTION_FAILED' };
        yield { type: 'block-start', index: nextIndex, blockType: 'text' };
        yield { type: 'text-delta', index: nextIndex, text: failure.message };
        yield { type: 'block-end', index: nextIndex, block: { type: 'text', text: failure.message } };
        yield { type: 'finish', reason: { kind: 'error', failure } };
      }
    },
    async *_streamImpl(callOptions) {
      if (isAuxiliaryCall(callOptions)) {
        // Title generation, compaction, vision describe and the next-prompt
        // predictor are not conversational turns — never spawn the agent.
        yield { type: 'finish', reason: 'stop' };
        return;
      }
      const provider = callOptions.provider;
      const agentConfig = getAgentByProvider(provider);
      if (!agentConfig) {
        throw new Error(`External ACP agent for provider "${provider}" is not configured.`);
      }
      if (!agentConfig.enabled) throw new Error(`Agent "${agentConfig.name}" is disabled.`);

      const dshAgent = resolveActiveDshAgent(ctx, callOptions);
      const rawSessionId =
        callOptions.sessionId || dshAgent?.session?.id || dshAgent?.id || null;
      // Without a resolvable session id, a shared 'default-session' key would
      // silently merge every unidentifiable dsh session into one ACP session.
      // Each such call gets an isolated ephemeral connection instead — never
      // resumed from the store and disposed when the turn ends (AC-040).
      const sessionResolved = rawSessionId !== null && String(rawSessionId) !== '';
      const dshSessionId = sessionResolved
        ? String(rawSessionId)
        : `ephemeral-${crypto.randomUUID()}`;
      const cwd = dshAgent?.session?.header?.cwd || process.cwd();
      const connKey = encodeConnKey(dshSessionId, agentConfig.id);

      let conn = sessionConnections.get(connKey);
      if (conn && conn.closed) {
        sessionConnections.delete(connKey);
        // A conn that died without close() can still hold a live MCP token —
        // release it here instead of leaking the whaleisleMcp session
        // entry (AC-046).
        releaseConnMcpToken(conn);
        await conn.close();
        conn = null;
      }
      if (!conn) {
        conn = createConnection(agentConfig, cwd, dshSessionId, dshAgent);
        sessionConnections.set(connKey, conn);
      } else {
        conn.agentConfig = agentConfig;
      }

      try {
        conn.hostAgent = dshAgent;
        conn.preparingTask = undefined;
        await assertCredentialsStable(agentConfig);
        ownConnection(dshAgent);
        await conn.ensureReady(callOptions.signal);
        if (!conn.promptStarted && conn.restoredSession && conn.acpSessionId !== conn.resumeSessionId) {
          conn.restoredSession = false;
          conn.promptCursor = undefined;
        }
        if (conn.acpAuthenticated) markAcpAuthed(agentConfig.id);
        // Rebind the live dsh session for whaleisle_present; restored
        // connections may have issued the token before the agent resolved.
        if (conn.mcpToken && dshAgent?.session) {
          whaleisleMcp.bindSession(conn.mcpToken, dshAgent.session, callOptions.signal, provider);
        }
        const persistSessionId = (id) => {
          if (id && sessionResolved && sessionStore[connKey]?.sessionId !== id) {
            sessionStore[connKey] = { ...sessionStore[connKey], sessionId: id, cwd: conn.cwd, updatedAt: Date.now(), promptCursor: conn.promptCursor };
            saveSessionStore(sessionStore, storeFile);
          }
        };
        persistSessionId(conn.acpSessionId);
        await conn.syncModelAndEffort(callOptions.model, callOptions.reasoningEffort, callOptions.signal);
        const currentTask = [...tasks.tasks.values()].findLast((item) => item.childId === dshSessionId);
        for (const setting of currentTask?.options || sessionStore[connKey]?.modelOptions?.[callOptions.model] || []) await conn.syncOption(setting.id, setting.value);

        let turn = conn.pendingBackgroundTurns.shift() || conn.activeTurn;
        if (turn?.background) {
          turn.attached = true;
          conn.backgroundWakePending = false;
          turn.attachSignal(callOptions.signal);
        }
        // A stopped host turn can leave queued ACP text/errors behind while
        // tools/execute is being cancelled. A later user turn must not drain
        // that old queue and fail with the previous turn's AbortError.
        if (turn?.signal?.aborted) turn = null;
        const startForegroundTurn = async () => {
          let promptBlocks = await attachmentPrompt(conversationPrompt(callOptions.messages, conn), conn, callOptions.signal);
          const task = [...tasks.tasks.values()].findLast((item) => item.childId === dshSessionId);
          const interactionMode = planActive(dshAgent) || planActive(humanOwner(dshAgent)) || task?.interactionMode === 'plan' ? 'plan' : 'default';
          await conn.syncRuntimeMode(interactionMode, callOptions.signal);
          const instructions = interactionMode === 'plan'
            ? 'Plan mode: investigate with read-only actions. Do not edit files, run modifying commands, or start implementation. Return a decision-complete plan.'
            : 'Default mode: carry out the authorized request. Ask the user only when a missing decision materially changes the result.';
          if (!String(promptBlocks[0]?.text || '').trimStart().startsWith('/')) promptBlocks = [{ type: 'text', text: `${instructions}\nConfigured-agent tools: use acp_agents once before selecting a configured agent. Use acp_delegate for cross-agent or background work; prefer native children for same-provider, same-settings work completed in this turn. Use a stable client_request_id for retries. Follow next and end your turn; do not poll. Final task results are delivered automatically; do not send_message a second final report. Send earlier messages only for actionable coordination. Use acp_cancel to cancel a task and interrupt_agent only to pause it. As a child, do not delegate again unless the task explicitly authorizes it.` }, ...promptBlocks];
          if (sessionResolved && sessionStore[connKey]?.promptCursor !== conn.promptCursor) {
            sessionStore[connKey] = { ...sessionStore[connKey], promptCursor: conn.promptCursor };
            saveSessionStore(sessionStore, storeFile);
          }
          const nextTurn = new AcpTurnExecution({
            connection: conn,
            promptBlocks,
            signal: callOptions.signal,
            hostAgent: dshAgent,
          });
          conn.activeTurn = nextTurn;
          nextTurn.attached = true;
          conn.workQuarantined = false;
          nextTurn.beginPrompt();
          return nextTurn;
        };
        if (!turn || (turn.promptDone && turn.queue.closed && turn.queue.items.length === 0)) {
          turn = await startForegroundTurn();
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
          stageLogIndex('yield-finish ' + JSON.stringify(reason));
          yield { type: 'finish', reason };
        };

        while (true) {
          const { value: item, done } = await turn.queue.next(callOptions.signal);
          if (done || !item) {
            yield* closeBlock();
            await autoDeliver(conn, dshAgent?.session);
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
            const argsJson = JSON.stringify({
              ...(entry.args && typeof entry.args === 'object' ? entry.args : {}),
              _title: entry.title || entry.name,
              _kind: entry.kind || 'other',
            });
            stageLogIndex('yield-tool-call id=' + entry.toolCallId + ' name=' + entry.name);
            const hostCallId = entry.hostCallId ??= `acp-${turn.turnKey}-${crypto.randomUUID()}`;
            pendingToolExecutions.set(hostCallId, {
              entry,
              turn,
              dshAgent,
              conn,
            });
            yield { type: 'block-start', index: callIndex, blockType: 'tool-call' };
            yield {
              type: 'tool-call-delta',
              index: callIndex,
              id: hostCallId,
              name: entry.name,
              argumentsDelta: argsJson,
            };
            yield {
              type: 'block-end',
              index: callIndex,
              block: { type: 'tool-call', id: hostCallId, name: entry.name, arguments: argsJson },
            };
            yield* finishChunk({ kind: 'tool-calls' });
            return;
          }

          if (item.type === 'prompt-error') {
            yield* closeBlock();
            throw item.error || new Error(`ACP agent "${agentConfig.name}" turn failed`);
          }

          if (item.type === 'prompt-done') {
            if (conn.claudeResumeSessionId) {
              persistSessionId(conn.claudeResumeSessionId);
            }
            yield* closeBlock();
            if (turn.background) {
              const next = conn.pendingBackgroundTurns.shift() || (conn.activeTurn !== turn && conn.activeTurn?.background ? conn.activeTurn : null);
              if (next) { turn = next; turn.attached = true; turn.attachSignal(callOptions.signal); continue; }
            }
            const latestUser = (callOptions.messages || []).findLast((message) => message.role === 'user' && (message.source?.kind === undefined || ['user', 'agent-message', 'subagent-settled'].includes(message.source.kind)));
            if (turn.background && latestUser?.id && latestUser.id !== conn.promptCursor && item.stopReason !== 'cancelled') {
              turn = await startForegroundTurn();
              continue;
            }
            if (item.stopReason === 'cancelled') {
              const error = new Error('ACP provider cancelled the turn.'); error.name = 'AbortError'; throw error;
            }
            yield* finishChunk(item.stopReason === 'max_tokens' ? { kind: 'max-tokens' } : { kind: 'stop' });
            return;
          }
        }
      } finally {
        // Ephemeral connections are scoped to this call: dispose on every
        // exit (finish, error, abort) so an unresolvable session can never
        // leak a live agent process or MCP token (AC-040/AC-046).
        if (!sessionResolved) {
          sessionConnections.delete(connKey);
          releaseConnMcpToken(conn);
          void conn.close().catch(() => {});
        }
      }
    },
  };

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
        adapterHandle = ctx.llm.registerAdapter(allProviders, adapter);
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

  // A connection's MCP bearer token outlives conn.close() whenever the conn
  // died without running close() (a failed ensureReady marks it closed
  // directly). Revoke explicitly — revokeToken is idempotent (AC-046).
  function releaseConnMcpToken(conn) {
    const token = conn?.mcpToken;
    if (conn) conn.mcpToken = null;
    if (token) whaleisleMcp.revokeToken(token);
  }

  async function closeAgentConnections(agentId) {
    liveModelIds.delete(agentId);
    const closing = [];
    for (const [key, conn] of sessionConnections.entries()) {
      if (decodeConnKey(key)[1] === agentId) {
        sessionConnections.delete(key);
        releaseConnMcpToken(conn);
        closing.push(conn.close().catch(() => {}));
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
      releaseConnMcpToken(conn);
      closing.push(conn.close().catch(() => {}));
    }
    sessionConnections.clear();
    await Promise.all(closing);
  }

  async function buildCatalog({ refreshAccounts = false } = {}) {
    const activeByAgent = new Map();
    const commandsByAgent = new Map();
    const activeSessions = [];
    for (const [key, conn] of sessionConnections.entries()) {
      if (conn.closed) continue;
      const [sessionId, agentId] = decodeConnKey(key);
      activeByAgent.set(agentId, (activeByAgent.get(agentId) || 0) + 1);
      if (
        !commandsByAgent.has(agentId)
        && Array.isArray(conn.availableCommands)
        && conn.availableCommands.length > 0
      ) {
        commandsByAgent.set(agentId, conn.availableCommands);
      }
      activeSessions.push({
        sessionId,
        agentId,
        acpSessionId: conn.acpSessionId,
        cwd: conn.cwd,
        currentModel: conn.currentModel,
        currentModeId: conn.currentModeId,
        availableModes: conn.availableModes,
        availableCommands: conn.availableCommands,
        contextUsage: conn.activeTurn?.contextUsage || null,
      });
    }

    const accountStatuses = await Promise.all(
      agentList.map((agent) =>
        authManager.getAgentAccountStatus(agent, { forceRefresh: refreshAccounts }).catch(() => null),
      ),
    );

    const agents = agentList.map((agent, idx) => {
      const binaryPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
      const account = accountStatuses[idx] || null;
      const authFlow = authManager.getFlowState(agent.id);
      return {
        ...agent,
        // Never broadcast stored secrets to the renderer — secret-shaped env
        // values are masked; a mask coming back on save keeps the stored
        // value (see restoreMaskedEnv, AC-033).
        env: maskEnvSecrets(agent.env),
        models: getEffectiveModels(agent),
        allModels: getAllModelsForAgent(agent),
        configuredModels: agent.models,
        discoveredModels: discoveredModels.get(agent.id) || [],
        binaryFound: Boolean(binaryPath) || agent.registrySource === 'registry',
        binaryPath: binaryPath || null,
        version: account?.version || null,
        account,
        authFlow,
        // Surface the live session's slash commands at the agent level so the
        // client can render them without joining activeSessions (AC-043).
        availableCommands: commandsByAgent.get(agent.id) || [],
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

  /**
   * Everything a probe learned about models, in one deduped list. The registry
   * probe normalizes models into `probe.models` (its `configOptions` are
   * ProviderOptionDescriptors with model choices deliberately stripped); the
   * live-session probe returns raw session configOptions that
   * `modelsFromConfigOptions` reads instead.
   */
  function extractModelsFromProbe(probe) {
    const found = [];
    const seen = new Set();
    const push = (id, name, metadata = {}) => {
      const clean = String(id || '').trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      found.push({ ...metadata, id: clean, name: String(name || clean) });
    };
    const descriptors = probe?.configOptionsFormat === 'descriptors';
    const metadata = descriptors ? modelOptionMetadata(probe.configOptions) : {};
    for (const m of probe?.models || []) {
      push(m?.id ?? m?.modelId ?? m?.value, m?.name ?? m?.label, { ...metadata, ...m });
    }
    for (const m of descriptors ? [] : modelsFromConfigOptions(probe?.configOptions)) {
      push(m.id, m.name, m);
    }
    return found;
  }

  /**
   * Discovered models merge into the persisted agent record (flagged
   * `discovered`) so they survive restarts and hidden/favorite ids never
   * dangle across sessions. The runtime map mirrors the latest snapshot for
   * the live catalog view.
   */
  function mergeDiscoveredModels(agentId, found) {
    if (!Array.isArray(found) || found.length === 0) return 0;
    if (JSON.stringify(discoveredModels.get(agentId)) === JSON.stringify(found)) return 0;
    discoveredModels.set(agentId, found);
    const agent = agentList.find((a) => a.id === agentId);
    const existing = Array.isArray(agent?.models) ? agent.models : [];
    const known = new Set(existing.map((m) => String(m?.id || '')));
    const additions = [];
    for (const item of found) {
      const id = String(item?.id || '').trim();
      if (!id || known.has(id)) continue;
      known.add(id);
      additions.push({
        id,
        name: String(item.name || id),
        discovered: true,
      });
    }
    if (!agent) return 0;
    const enriched = existing.map((model) => {
      const metadata = found.find((item) => item.id === model.id);
      return metadata ? { ...model, ...metadata } : model;
    });
    for (const model of additions) Object.assign(model, found.find((item) => item.id === model.id));
    const nextAgents = agentList.map((a) =>
      a.id === agentId ? { ...a, models: [...enriched, ...additions] } : a,
    );
    // Mutate in-memory state only after the write succeeds (AC-030).
    agentList = saveAgentsConfig(nextAgents, storeFile);
    syncAdapterRoutes();
    return additions.length;
  }

  // Records that an ACP `authenticate` succeeded for this agent. Probes
  // (model sync, enable toggle) are only allowed to run silent auth once one
  // interactive login has completed — otherwise session/new always fails for
  // auth-required agents and discovery can never recover.
  function markAcpAuthed(agentId) {
    const agent = agentList.find((a) => a.id === agentId);
    if (!agent) return;
    // Persist the runtime's confirmed-auth marker too — account status reads authState,
    // not acpAuthedAt, so without this the UI reports "未登录" forever and
    // re-prompts sign-in after every successful session authenticate.
    authManager?.markAuthenticated?.(agent);
    if (agent.acpAuthedAt) return;
    const updated = normalizeAgentRecord(
      { ...agent, acpAuthedAt: Date.now() },
      BUILTIN_AGENT_PRESETS.find((p) => p.id === agentId) || null,
    );
    const nextAgents = agentList.map((a) => (a.id === agentId ? updated : a));
    agentList = saveAgentsConfig(nextAgents, storeFile);
  }

  async function handleRpc(endpoint, input = {}) {
    switch (endpoint) {
      case 'delegation-status': {
        const task = tasks.tasks.get(input.runId);
        if (task) {
          if (task.parentId !== input.parentSessionId || task.childId !== input.childId) throw new Error('Delegation does not belong to this conversation.');
          const parentAgent = safeGetService(ctx, 'agents')?.get(task.parentId);
          if (parentAgent) return tasks.snapshot(parentAgent, task.taskId);
          return { ...task, requestKey: undefined, requestArguments: undefined };
        }
        const query = safeGetService(ctx, 'sessionQuery');
        const parent = await query.observeSession(input.parentSessionId);
        let start;
        try {
          start = parent.events.find((event) => event.type === 'acp-delegation/start' && event.data.runId === input.runId && event.data.childId === input.childId);
          if (!start) throw new Error('Delegation does not belong to this conversation.');
          const recorded = parent.events.find((event) => event.type === 'acp-delegation/end' && event.data.runId === input.runId);
          if (recorded) return recorded.data;
        } finally { parent[Symbol.dispose](); }
        // Earlier plugin versions could lose the result observer. The child
        // log remains authoritative; recovering its state does not restart it.
        const child = await query.observeSession(input.childId);
        try {
          const end = child.events.find((event) => event.type === 'turn/end' && event.time >= start.data.startedAt);
          if (!end) return null;
          const kind = end.data.reason.kind;
          return {
            endedAt: end.time,
            stopReason: kind === 'completed' ? 'completed' : ['aborted', 'interrupted'].includes(kind) ? 'aborted' : 'error',
            ...(end.data.reason.error?.message ? { diagnostic: end.data.reason.error.message } : {}),
          };
        } finally { child[Symbol.dispose](); }
      }
      case 'catalog': {
        return buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) });
      }
      case 'session/options': {
        const sessionId = String(input?.sessionId || '');
        const agent = getAgentById(input?.agentId);
        const model = agent && getAllModelsForAgent(agent).find((item) => item.id === input?.model);
        if (!sessionId || !agent || !model) throw new Error('A conversation, configured agent and known model are required.');
        const key = encodeConnKey(sessionId, agent.id);
        const descriptors = model.options || [];
        const selections = sessionStore[key]?.modelOptions?.[model.id] || [];
        if (input.option !== undefined) {
          const option = descriptors.find((item) => item.id === input.option.id);
          if (!option || /mode|permission|approval|sandbox/i.test(`${option.id} ${option.category || ''}`)) throw new Error('This setting is not an editable model option.');
          const value = input.option.value;
          const valid = option.type === 'boolean' ? typeof value === 'boolean' : option.type === 'select' && option.options.some((choice) => choice.id === value);
          if (!valid) throw new Error('The selected value was not advertised by this agent.');
          const updated = [...selections.filter((item) => item.id !== option.id), { id: option.id, value }];
          sessionStore[key] = { ...sessionStore[key], modelOptions: { ...sessionStore[key]?.modelOptions, [model.id]: updated } };
          saveSessionStore(sessionStore, storeFile);
          return { selections: updated };
        }
        return { selections };
      }
      case 'agent/auth-action': {
        const agent = getAgentById(input?.id);
        if (!agent) throw new Error('Unknown ACP agent.');
        await initAgentRuntime();
        return runtimeBundle().registryAuthAction.get(`dsh-${agent.id}`);
      }
      case 'agent/auth-action/accept': {
        const agent = getAgentById(input?.id);
        if (!agent) throw new Error('Unknown ACP agent.');
        await initAgentRuntime();
        const actions = runtimeBundle().registryAuthAction;
        const action = await actions.get(`dsh-${agent.id}`);
        if (!action || action.elicitationId !== input.elicitationId) throw new Error('This authorization request has expired.');
        if (!openExternalUrl(action.url)) throw new Error('The authorization URL could not be opened.');
        return { accepted: await actions.accept(`dsh-${agent.id}`, action.elicitationId) };
      }
      case 'agent/registry-search': {
        // Mirrors ACP runtime Settings → Providers → Add provider → "Show more":
        // list every installable agent from the official ACP registry.
        await initAgentRuntime();
        const { catalog } = runtimeBundle();
        const query = String(input?.query || '').trim();
        const limit = Math.max(1, Math.min(200, Number(input?.limit) || 100));
        const res = await catalog.search({ query, limit });
        const agents = (Array.isArray(res?.agents) ? res.agents : [])
          .map((a) => ({
            id: String(a?.id || ''),
            name: String(a?.name || a?.id || ''),
            description: String(a?.description || ''),
            version: String(a?.version || ''),
            icon: a?.icon ?? null,
          }))
          .filter((a) => a.id);
        return { agents };
      }
      case 'agent/toggle': {
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        const enabled = Boolean(input?.enabled);
        const nextAgents = agentList.map((a) => (a.id === id ? { ...a, enabled } : a));
        agentList = saveAgentsConfig(nextAgents, storeFile);
        syncAdapterRoutes();
        if (!enabled) {
          await closeAgentConnections(id);
        } else if (!discoveredModels.has(id)) {
          const updatedTarget = getAgentById(id);
          if (updatedTarget) {
            void probeAcpAgent(ctx, updatedTarget, process.cwd())
              .then((probe) => {
                if (probe?.ok) {
                  mergeDiscoveredModels(id, extractModelsFromProbe(probe));
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
        // Catalog payloads mask secret env values; a mask round-tripping
        // back means "keep the stored secret" — never persist it (AC-033).
        if (raw?.env !== undefined) {
          mergedInput.env = restoreMaskedEnv(raw.env, existing?.env);
        }
        const record = normalizeAgentRecord(mergedInput, preset);
        if (!record) throw new Error('Invalid agent configuration');
        const exists = agentList.some((a) => a.id === id);
        const nextAgents = exists
          ? agentList.map((a) => (a.id === id ? record : a))
          : [...agentList, record];
        // Mutate in-memory state only after the write succeeds (AC-030).
        agentList = saveAgentsConfig(nextAgents, storeFile);
        // Only tear down live sessions when connection- or auth-relevant
        // fields actually changed; cosmetic saves (model lists, favorites,
        // visibility, display text) must not kill running agent processes.
        const connChanged = !existing || agentRuntimeIdentity(existing) !== agentRuntimeIdentity(record);
        if (connChanged) {
          await authManager.invalidate(id);
          await closeAgentConnections(id);
        }
        syncAdapterRoutes();
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
            ...(input?.env ? { env: restoreMaskedEnv(input.env, null) } : {}),
          },
          null,
        );
        agentList = saveAgentsConfig([...agentList, record], storeFile);
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
        await authManager.cancelLogin(id);
        await authManager.invalidate(id);
        await closeAgentConnections(id);
        const nextAgents = preset
          ? agentList.map((a) => (a.id === id ? normalizeAgentRecord(preset, preset) : a))
          : agentList.filter((a) => a.id !== id);
        agentList = saveAgentsConfig(nextAgents, storeFile);
        syncAdapterRoutes();
        return buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) });
      }
      case 'agent/test': {
        const id = sanitizeId(input?.id);
        const target = input?.agent
          ? normalizeAgentRecord(
              {
                ...input.agent,
                // Renderer-supplied env may carry masked secrets — restore
                // them against the stored record before probing (AC-033).
                ...(input.agent.env !== undefined
                  ? { env: restoreMaskedEnv(input.agent.env, getAgentById(id)?.env) }
                  : {}),
              },
              BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
            )
          : getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        // Explicit user action: Antigravity may boot its managed runtime once
        // (liveSession) — the model list exists only on a live session.
        const probe = await probeAcpAgent(ctx, target, input?.cwd || process.cwd(), {
          liveSession: true,
        });
        let modelsFound = null;
        let modelsAdded = null;
        if (probe.ok) {
          const found = extractModelsFromProbe(probe);
          modelsFound = found.length;
          modelsAdded = mergeDiscoveredModels(target.id, found);
          if (probe.acpAuthenticated) markAcpAuthed(target.id);
        }
        return {
          ...probe,
          modelsFound,
          modelsAdded,
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
          // Credential fields round-trip through the masked catalog — a mask
          // keeps the stored secret, never the mask itself (AC-033).
          const submitted = restoreMaskedEnv(input.credentials, target.env);
          await stopCredentialSessions(target);
          const nextEnv = normalizeEnvRecord({
            ...(target.env || {}),
            ...submitted,
          });
          // Remove empty keys
          for (const [k, v] of Object.entries(submitted)) {
            if (v === '' || v === null) delete nextEnv[k];
          }
          const updated = normalizeAgentRecord(
            { ...target, authMethod: methodId || target.authMethod, acpAuthMethodId: methodId || target.acpAuthMethodId, env: nextEnv },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          const nextAgents = agentList.map((a) => (a.id === id ? updated : a));
          agentList = saveAgentsConfig(nextAgents, storeFile);
          await authManager.invalidate(id);
          await closeAgentConnections(id);
          if (input?.onlySaveCredentials) {
            return {
              flow: null,
              catalog: await buildCatalog({ refreshAccounts: true }),
            };
          }
        } else if (methodId && (methodId !== target.authMethod || methodId !== target.acpAuthMethodId)) {
          const updated = normalizeAgentRecord(
            { ...target, authMethod: methodId, acpAuthMethodId: methodId },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          const nextAgents = agentList.map((a) => (a.id === id ? updated : a));
          agentList = saveAgentsConfig(nextAgents, storeFile);
        }

        const freshTarget = getAgentById(id);
        // "使用新凭据重新登录" must not reuse a cached flow/token — drop the
        // cached entry (in-flight flow + fingerprint + status cache) so
        // startLogin builds a genuinely fresh flow. The flag is forwarded as
        // well for the auth manager's own handling (AC-006).
        if (input?.forceNewToken) {
          await authManager.cancelLogin(id);
          await authManager.invalidate(id);
        }
        const flow = await authManager.startLogin(freshTarget, {
          methodId,
          forceNewToken: Boolean(input?.forceNewToken),
        });
        return {
          flow,
          catalog: await buildCatalog({ refreshAccounts: false }),
        };
      }
      case 'agent/login/cancel': {
        const id = sanitizeId(input?.id);
        await authManager.cancelLogin(id);
        return buildCatalog({ refreshAccounts: false });
      }
      case 'agent/login/respond': {
        const id = sanitizeId(input?.id);
        const sent = await authManager.respondToInteraction(id, input?.response);
        return { sent, catalog: await buildCatalog({ refreshAccounts: false }) };
      }
      case 'agent/login/complete': {
        const id = sanitizeId(input?.id);
        const sent = await authManager.completeLogin(id, input?.callbackUrl);
        return { sent, catalog: await buildCatalog({ refreshAccounts: false }) };
      }
      case 'agent/login/reauth': {
        // Clears stale CLI credentials then restarts the OAuth flow — the
        // one-click path out of "already logged in" early exits. Env-configured
        // API keys are intentionally preserved (logoutAgent only runs the CLI).
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        await closeAgentConnections(id);
        await authManager.logoutAgent(target);
        // The credentials were just destroyed: the persisted ACP-auth marker
        // is stale until the new login completes (same fix as AC-014), and a
        // cached flow/token must not be reused — drop the cached entry so
        // startLogin creates a genuinely fresh flow.
        if (target.acpAuthedAt != null) {
          const updated = normalizeAgentRecord(
            { ...target, acpAuthedAt: null },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          const nextAgents = agentList.map((a) => (a.id === id ? updated : a));
          agentList = saveAgentsConfig(nextAgents, storeFile);
        }
        await authManager.invalidate(id);
        const flow = await authManager.startLogin(getAgentById(id), {
          methodId: String(input?.methodId || target.authMethod || ''),
          forceNewToken: input?.forceNewToken !== false,
        });
        return {
          flow,
          catalog: await buildCatalog({ refreshAccounts: false }),
        };
      }
      case 'agent/logout': {
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        let logoutWarning;
        try {
          await authManager.logoutAgent(target);
        } catch (error) {
          if (!input?.clearApiKeys) throw error;
          // Removing locally configured credentials does not depend on the
          // provider implementing logout. Keep its failure visible, however.
          logoutWarning = error?.message || String(error);
        }
        if (input?.clearApiKeys) await closeAgentConnections(id);
        let env = target.env;
        // Also clear API key env vars if logging out from API key mode.
        // Credential-shaped rows are identified by name, not a fixed vendor
        // list — custom KEY/TOKEN/SECRET entries are credentials too
        // (AC-031). Same key test the renderer uses for password inputs.
        if (input?.clearApiKeys) {
          env = {};
          for (const [k, v] of Object.entries(target.env || {})) {
            if (!SECRET_ENV_KEY_RE.test(k)) env[k] = v;
          }
        }
        // Logout must also clear the persisted ACP-auth marker — otherwise
        // the UI shows "未登录" and "ACP 会话已认证" at once, and silent-auth
        // probes may re-fire (AC-014). authManager.logoutAgent clears the
        // ACP runtime-side authState marker; invalidate clears the 60s status cache so
        // the refreshed catalog reports the post-logout state immediately.
        if (input?.clearApiKeys || target.acpAuthedAt != null) {
          const updated = normalizeAgentRecord(
            { ...target, env, acpAuthedAt: logoutWarning ? target.acpAuthedAt : null },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          const nextAgents = agentList.map((a) => (a.id === id ? updated : a));
          agentList = saveAgentsConfig(nextAgents, storeFile);
        }
        await authManager.invalidate(id);
        const catalog = await buildCatalog({ refreshAccounts: true });
        return { ...catalog, ...(logoutWarning ? { logoutWarning } : {}) };
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
          const key = encodeConnKey(sessionId, agentId);
          const conn = sessionConnections.get(key);
          if (conn) {
            sessionConnections.delete(key);
            releaseConnMcpToken(conn);
            await conn.close().catch(() => {});
          }
          delete sessionStore[key];
        } else if (agentId) {
          await closeAgentConnections(agentId);
          for (const key of Object.keys(sessionStore)) {
            if (decodeConnKey(key)[1] === agentId) delete sessionStore[key];
          }
        } else {
          await closeAllConnections();
          sessionStore = {};
        }
        saveSessionStore(sessionStore, storeFile);
        return buildCatalog();
      }
      default:
        throw new Error(`Unknown dsh-acp-agents endpoint: ${String(endpoint)}`);
    }
  }

  async function requestAcpApproval({ entry, turn, connection }, perm) {
    const targetAgent = turn.hostAgent;
    const policy = connection.agentConfig?.permissionPolicy;
    turn.signal?.throwIfAborted();
    const hostFullAccess = targetAgent?.session
      && safeGetService(ctx, 'sandboxPolicy')?.resolve?.({ session: targetAgent.session })?.mode === 'danger-full-access'
      && safeGetService(ctx, 'approval')
      && approvalPolicyOf(safeGetService(ctx, 'approval'), targetAgent.session) === 'never';
    const runtimePolicy = runtimePolicyFor(connection);
    const disposition = runtimePolicy && runtimeBundle().providers.AcpClientPolicy.acpPermissionDisposition(runtimePolicy, { toolCall: { ...perm.toolCall, kind: entry.kind } });
    if (disposition === 'deny') return false;
    if (disposition === 'allow') return true;
    if (hostFullAccess && runtimePolicy?.sandboxPolicy.type !== 'readOnly') return true;
    if (targetAgent.session.header.parentSession) return askOperation(targetAgent, turn.signal,
      `${connection.agentConfig.name}: ${perm.toolCall?.title || entry.title || entry.name}\n${JSON.stringify(entry.args || {})}`);
    const approvalService = safeGetService(ctx, 'approval');
    if (!approvalService?.request || !targetAgent) return false;
    const decision = await approvalService.request({
      agent: targetAgent, toolName: entry.name, callId: entry.toolCallId,
      reason: perm.toolCall?.title || entry.title || `Allow ${connection.agentConfig?.name || 'ACP Agent'} to run ${entry.name}?`,
      signal: turn.signal,
    });
    return decision === 'allowed-once' ? true : decision === 'cancelled' ? 'cancelled' : false;
  }

  async function executeTrackedToolCall(exec) {
    const tracked = trackedExecution(exec);
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

        if (entry.status === 'completed' || entry.status === 'failed' || turn.promptDone) {
          break;
        }

        await new Promise((resolve) => {
          const done = () => {
            entry.onPermissionArrived = null;
            const index = entry.waiters.indexOf(done);
            if (index >= 0) entry.waiters.splice(index, 1);
            exec.signal?.removeEventListener('abort', done);
            resolve();
          };
          entry.onPermissionArrived = done;
          entry.waiters.push(done);
          exec.signal?.addEventListener('abort', done, { once: true });
        });
      }

      const isError = entry.status === 'failed' || exec.signal?.aborted === true;
      const outputText = entry.outputText || (exec.signal?.aborted ? 'Tool call cancelled' : isError ? 'Tool call failed' : 'Completed');
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
      if (pendingToolExecutions.get(exec.callId) === tracked) pendingToolExecutions.delete(exec.callId);
    }
  }

  function trackedExecution(exec) {
    const tracked = pendingToolExecutions.get(exec?.callId);
    if (!tracked || (tracked.dshAgent && tracked.dshAgent.id !== exec?.agent?.id)) return undefined;
    if (exec?.name && exec.name !== tracked.entry.name) return undefined;
    return tracked;
  }

  async function dispose() {
    await closeAllConnections();
    await authManager.dispose();
    pendingToolExecutions.clear();
    await releaseRuntime();
  }

  return {
    adapter,
    syncAdapterRoutes,
    disposeAdapterRoutes,
    whaleisleMcp,
    handleRpc,
    buildCatalog,
    pendingToolExecutions,
    executeTrackedToolCall,
    trackedExecution,
    dispose,
    closeAllConnections,
    ownConnection,
    listDelegationAgents,
    delegate,
    tasks,
    waitTask,
  };
}

export function apply(ctx, config = {}) {
  const manager = createAcpAgentsManager(ctx, config);
  ctx.on('agent/created', ({ agent }) => manager.ownConnection(agent), { global: true });
  ctx.inject(['subagents', 'tools'], (scope) => { manager.tasks.install(scope); registerDelegation(scope, manager); });
  // Surface vendored-runtime problems at startup rather than first turn —
  // deferred a tick so the ~250ms vendor parse does not sit inside the cordis
  // startup sequence where it would delay other plugins' route registration.
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void initAgentRuntime().catch((err) => {
        appendAcpErrorLog('initAgentRuntime', err, {});
      });
    }, 0);
    timer.unref?.();
    return () => clearTimeout(timer);
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
  const toolsSvc = safeGetService(ctx, 'tools');
  if (toolsSvc && typeof toolsSvc.register === 'function') {
    for (const name of acpToolNames) {
      try {
        ctx.effect(() => toolsSvc.register({
          name,
          description: 'External ACP agent step (bridged; not executed locally).',
          parameters: { type: 'object', additionalProperties: true },
          output: {
            schema: { type: 'object' },
            render: (_args, value) => [
              { type: 'text', text: String(value?.text ?? '') },
            ],
          },
          presentCall: (args) => {
            const title = String(args?._title || name);
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
              return { card: 'terminal', title: String(args?._title || name), output: text };
            }
            return {
              card: 'generic',
              title: String(args?._title || name),
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
        appendAcpErrorLog('tools/register', err, { name });
      }
    }
  }

  if (typeof ctx.on === 'function') {
    ctx.on('tools/pre-execute', async (exec, next) => {
      stageLogIndex('tools/pre-execute callId=' + exec?.callId + ' name=' + exec?.name + ' tracked=' + manager.pendingToolExecutions.has(exec?.callId));
      if (manager.trackedExecution(exec)) {
        return { kind: 'allow' };
      }
      return next();
    }, { prepend: true });

    ctx.on('tools/execute', async (exec, next) => {
      stageLogIndex('tools/execute callId=' + exec?.callId + ' tracked=' + manager.pendingToolExecutions.has(exec?.callId));
      if (manager.trackedExecution(exec)) {
        try {
          const result = await manager.executeTrackedToolCall(exec);
          if (result) return result;
        } catch (err) {
          appendAcpErrorLog('tools/execute', err, { callId: exec?.callId, name: exec?.name });
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
      async handler(req, res) {
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
        const endpoint = pathname.startsWith('/dsh-acp-agents/')
          ? pathname.slice('/dsh-acp-agents/'.length)
          : '';
        // The mcp endpoint authenticates with its own per-session bearer
        // token (agents bridge stdio over HTTP and carry no browser session),
        // so the connection layer's cookie check must not gate it.
        const rejection = endpoint === 'mcp' ? undefined : ctx.connection?.requestRejection?.(req);
        if (rejection !== undefined) {
          res.writeHead(rejection);
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
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
        if (endpoint === 'mcp') {
          const auth = String(req.headers['authorization'] || '');
          const session = auth.startsWith('Bearer ') ? manager.whaleisleMcp.sessionFor(auth.slice(7)) : null;
          if (!session) {
            res.writeHead(401);
            res.end('unauthorized');
            return;
          }
          const out = await manager.whaleisleMcp.dispatch(body, session);
          res.writeHead(out.status, { 'content-type': 'application/json' });
          res.end(out.body === undefined ? '' : JSON.stringify(out.body));
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
