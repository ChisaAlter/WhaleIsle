import crypto from 'node:crypto';
import { modelsFromConfigOptions } from './acp-session.js';
import { DELEGATION_PROVIDER } from './delegation.js';
import { resolveDelegationCwd } from './delegate-cwd.js';
import { TASK_ADMISSION } from './tasks.js';
import { createTaskCheckout, removeTaskCheckout } from './isolation.js';
import { acpErrorMessage, preparationError } from './errors.js';
import { safeGetService } from './host-contract.js';
import { encodeConnKey } from './catalog-models.js';

export function createDelegationRunner({
  ctx,
  tasks,
  sessionConnections,
  getAgentList,
  getAgentById,
  getEffectiveModels,
  currentSandbox,
  planActive,
  askOperation,
  assertCredentialsStable,
  createConnection,
  purgePendingToolsForConn,
  releaseConnMcpToken,
  appendAcpErrorLog,
}) {
  function validateDelegateChoices(args) {
    if (args.mode !== undefined && !['async', 'wait'].includes(args.mode)) throw new Error('mode must be async or wait.');
    if (args.timeout_ms !== undefined && (!Number.isInteger(args.timeout_ms) || args.timeout_ms < 0 || args.timeout_ms > 20000)) throw new Error('timeout_ms must be from 0 to 20000.');
    if (args.isolation !== undefined && !['shared', 'worktree'].includes(args.isolation)) throw new Error('isolation must be shared or worktree.');
    if (args.interaction_mode !== undefined && !['default', 'plan'].includes(args.interaction_mode)) throw new Error('interaction_mode must be default or plan.');
    if (args.runtime_mode !== undefined && !['inherit', 'read-only', 'approval-required'].includes(args.runtime_mode)) throw new Error('runtime_mode cannot raise the host permission policy.');
  }

  function validateDelegateOptions(args) {
    if (args.reasoning_effort !== undefined && (typeof args.reasoning_effort !== 'string' || !args.reasoning_effort)) throw new Error('reasoning_effort must be a non-empty advertised effort id.');
    if (args.options !== undefined) {
      if (!Array.isArray(args.options)) throw new Error('options must be an array of discovered id/value settings.');
      for (const setting of args.options) {
        if (!setting || typeof setting.id !== 'string' || !['string', 'boolean'].includes(typeof setting.value)) throw new Error('Each option requires a string id and a string or boolean value.');
      }
    }
    validateDelegateChoices(args);
    if (args.name !== undefined && (typeof args.name !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(args.name) || args.name === 'lead')) throw new Error('name must be 1-32 lower-case letters, digits or hyphens, start with a letter, and not be "lead".');
  }

  function validateDelegateRequest(args, parent, signal, subagents) {
    if (!parent) throw new Error('Agent delegation requires an active parent session.');
    const agent = getAgentList().find((item) => item.id === args.agent && item.enabled);
    if (!agent) throw new Error(`Agent "${args.agent}" is not enabled. Call acp_agents for available agents.`);
    if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new Error('A non-empty task prompt is required.');
    if (!subagents?.getProvider?.(DELEGATION_PROVIDER)) throw new Error('The host subagent service is not available.');
    signal?.throwIfAborted?.();
    const models = getEffectiveModels(agent);
    const model = args.model || models[0]?.id || 'default';
    if (!models.some((entry) => entry.id === model)) {
      throw new Error(`Unknown model "${model}" for ${agent.name}. Available model ids: ${models.map((entry) => entry.id).join(', ')}. Omit model to use ${models[0]?.id || 'default'}.`);
    }
    validateDelegateOptions(args);
    const cwd = resolveDelegationCwd(args, parent);
    return { agent, models, model, cwd };
  }

  function preflightDelegate(args, parent, subagents = safeGetService(ctx, 'subagents')) {
    const validated = validateDelegateRequest(args, parent, undefined, subagents);
    const existingTask = tasks.lookupIdempotent(parent.id, args.client_request_id, args);
    return {
      resolvedCwd: validated.cwd,
      effectiveModel: validated.model,
      existingTask,
    };
  }

  async function prepareDelegationConnection(args, parent, signal, agent, model, identity, connKey, setStage) {
    let createdWorktree = null;
    let conn = null;
    let onAbortPreparation = null;
    try {
      if (args.isolation === 'worktree') {
        setStage('worktree');
        if (identity.interactionMode === 'plan' || identity.runtimeMode === 'read-only' || currentSandbox(parent) === 'read-only') throw new Error('Worktree creation requires a writable host policy.');
        if (!(await askOperation(parent, signal, `Create an isolated checkout from committed HEAD for ${agent.name}?`))) throw new Error('Worktree creation was not approved.');
        createdWorktree = await createTaskCheckout(identity.cwd, identity.taskId, signal);
        Object.assign(identity, createdWorktree);
      }
      setStage('connection/authentication');
      await assertCredentialsStable(agent);
      conn = createConnection(agent, identity.cwd, identity.childId, parent, identity);
      sessionConnections.set(connKey, conn);
      onAbortPreparation = () => { void conn.close().catch(() => { /* The aborted preparation owns its failure; release the pending connection. */ }); };
      signal.addEventListener('abort', onAbortPreparation, { once: true });
      signal.throwIfAborted();
      await conn.ensureReady(signal);
      setStage('model');
      await conn.syncModelAndEffort(model, args.reasoning_effort, signal, args.reasoning_effort !== undefined);
      setStage('settings');
      for (const setting of identity.options) await conn.syncOption(setting.id, setting.value);
      await conn.syncRuntimeMode(identity.interactionMode, signal);
      signal.throwIfAborted();
      if (!getAgentById(agent.id)?.enabled) throw new Error('Agent was disabled while preparing the task.');
      return conn;
    } catch (error) {
      if (conn) error._failedConn = conn;
      if (createdWorktree && await removeTaskCheckout(createdWorktree.repositoryRoot, createdWorktree.cwd)) {
        delete identity.repositoryRoot;
        delete identity.baseCommit;
      }
      throw error;
    } finally {
      if (onAbortPreparation) signal.removeEventListener('abort', onAbortPreparation);
    }
  }

  async function handleFailedDelegationAttempt(error, { connKey, conn, task, parent, signal, stage, agent, identity, activated = false }) {
    sessionConnections.delete(connKey);
    purgePendingToolsForConn(conn);
    releaseConnMcpToken(conn);
    await conn?.close().catch((closeErr) => appendAcpErrorLog('delegation/close', closeErr, { connKey }));
    if (!activated && identity.repositoryRoot) {
      if (await removeTaskCheckout(identity.repositoryRoot, identity.cwd)) {
        delete identity.repositoryRoot;
        delete identity.baseCommit;
        if (task) {
          delete task.repositoryRoot;
          delete task.baseCommit;
        }
      }
    }
    if (task) {
      task.deliveryState = signal.aborted ? 'disposed' : 'acknowledged';
      const retainedNote = identity.repositoryRoot ? ` Retained checkout: ${identity.cwd}` : '';
      await tasks.finish(parent, task, {
        output: [],
        stopReason: signal.aborted ? 'aborted' : 'error',
        diagnostic: `${acpErrorMessage(error)}${retainedNote}`,
      });
      if (signal.aborted) throw signal.reason;
      throw error;
    }
    if (signal.aborted) throw signal.reason;
    const failure = preparationError(error, stage, agent, stage === 'model' ? modelsFromConfigOptions(conn?.configOptions).map((entry) => entry.id) : undefined);
    if (identity.repositoryRoot) failure.message += ` Retained checkout: ${identity.cwd}`;
    throw failure;
  }

  function buildDelegationIdentity(args, parent, { agent, models, model, cwd }, requestKey, requestArguments) {
    return {
      childId: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      agentId: agent.id,
      agentName: agent.name,
      model,
      modelName: models.find((entry) => entry.id === model)?.name || model,
      task: args.description || args.prompt,
      turn: parent.session?.snapshotEvents().findLast((event) => event.type === 'turn/start')?.data.turn ?? null,
      interactionMode: planActive(parent) ? 'plan' : args.interaction_mode || 'default',
      runtimeMode: args.runtime_mode || 'inherit',
      cwd: cwd || parent.session.header.cwd || process.cwd(),
      options: args.options || [],
      delivery: 'caller',
      requestKey,
      requestArguments,
    };
  }

  async function runDelegationAttempt(args, parent, signal, subagents, validated, requestKey, requestArguments) {
    const { agent, model } = validated;
    const identity = buildDelegationIdentity(args, parent, validated, requestKey, requestArguments);
    const { childId, taskId } = identity;
    let conn, task, stage = 'connection';
    let activated = false;
    const connKey = encodeConnKey(childId, agent.id);
    try {
      conn = await prepareDelegationConnection(args, parent, signal, agent, model, identity, connKey, (next) => { stage = next; });
      task = tasks.begin(parent, identity, { taskId });
      const maxDepth = subagents.resolveMaxDepth();
      const request = {
        parent,
        prompt: [{ type: 'text', text: args.prompt }],
        agentOptions: { provider: agent.providerId, model, ...(args.reasoning_effort ? { reasoningEffort: args.reasoning_effort } : {}) },
        ...(maxDepth === undefined ? {} : { maxDepth }),
      };
      const child = await subagents.startActivation({
        provider: DELEGATION_PROVIDER, childId,
        environment: { cwd: identity.cwd, admissionPolicy: TASK_ADMISSION },
        label: args.description || `Delegate to ${agent.name}`,
        ...(args.name ? { name: args.name } : {}),
        ...request, request, signal, delivery: 'caller',
      });
      activated = true;
      const receipt = tasks.attach(parent, task, child);
      const onAbort = () => { void tasks.cancel(parent, task.taskId).catch((error) => appendAcpErrorLog('delegation/cancel', error, {})); };
      signal.addEventListener('abort', onAbort, { once: true });
      receipt.result.finally(() => signal.removeEventListener('abort', onAbort)).catch(() => { /* The task receipt owns its failure; this observer only removes the abort listener. */ });
      if (signal.aborted) await tasks.cancel(parent, task.taskId);
      return receipt;
    } catch (error) {
      return handleFailedDelegationAttempt(error, { connKey, conn: conn || error?._failedConn, task, parent, signal, stage, agent, identity, activated });
    }
  }

  async function delegate(args, parent, signal, subagentsOrLegacy, maybeSubagents) {
    const subagents = (subagentsOrLegacy && typeof subagentsOrLegacy === 'object')
      ? subagentsOrLegacy
      : (maybeSubagents ?? safeGetService(ctx, 'subagents'));
    const validated = validateDelegateRequest(args, parent, signal, subagents);
    return tasks.once(parent, args.client_request_id, args, (requestKey, requestArguments) =>
      runDelegationAttempt(args, parent, signal, subagents, validated, requestKey, requestArguments));
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
    } finally { clearTimeout(timer); off?.(); signal.removeEventListener('abort', onAbort); changed.catch(() => { /* A completed or failed snapshot read must still observe its abandoned change waiter. */ }); }
  }

  return {
    validateDelegateRequest,
    preflightDelegate,
    prepareDelegationConnection,
    handleFailedDelegationAttempt,
    runDelegationAttempt,
    delegate,
    waitTask,
  };
}
