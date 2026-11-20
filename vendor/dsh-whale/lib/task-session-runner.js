/**
 * Isolated session launching, delegated approval routing, Harness job draining,
 * readonly-brief worker execution, and persist-first structured receipt delivery
 * for unified Whale managed task cards.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { captureInputs } from './task-inputs.js';
import { taskLimits } from './task-store.js';
import { startTaskWorker } from './task-worker.js';
import { formatStructuredReceipt } from './task-card-schema.js';

export const RECURSIVE_DENY_TOOLS = new Set([
  'subagent',
  'subagent_fork',
  'spawn',
  'acp_delegate',
  'whale_todo_create',
  'whale_todo_start',
  'whale_todo_continue',
  'whale_new_session',
]);

/**
 * Best-effort dynamic import of `installModelSelection` from `@deepseek-ai/dsh-agent`
 * so direct `ctx.agents.create` sessions carry identical model-selection support
 * without making standalone unit tests depend on host-only peer modules.
 * @param {any} agentCtx
 */
async function tryInstallModelSelection(agentCtx) {
  try {
    const mod = await import('@deepseek-ai/dsh-agent');
    if (typeof mod?.installModelSelection === 'function') {
      mod.installModelSelection(agentCtx);
    }
  } catch {
    /* Optional peer in standalone unit tests. */
  }
}

async function resolveStandardPresetId(presetsSvc) {
  if (typeof presetsSvc?.resolve !== 'function') return 'standard';
  try {
    return (await presetsSvc.resolve('standard'))?.id || 'standard';
  } catch {
    return 'standard';
  }
}

async function resolveOwnerAgent(ctx, ownerSessionId) {
  const agentsSvc = ctx?.get?.('agents') ?? ctx?.agents;
  const live = agentsSvc?.get?.(ownerSessionId);
  if (live) return live;
  if (typeof ctx?.sessionController?.resolveAgent !== 'function') return null;
  const resolved = await ctx.sessionController.resolveAgent(ownerSessionId).catch(() => null);
  return resolved && !resolved.error ? resolved.agent : null;
}

/**
 * Create a clean, isolated workspace-task session (never forked, never in
 * `subagent/catalog`). When `ctx.agents.create` and `ctx.agentPresets.mount`
 * exist, sets `meta.parentSession = ownerSessionId` (without `origin: 'subagent'`)
 * so native Harness delegated approval can route prompts into whale-girl's
 * main conversation while keeping the session independently openable/resumable.
 *
 * @param {{
 *   ctx: any,
 *   controller: any,
 *   sessionId: string,
 *   card: any,
 *   selectedModel: { provider: string, model: string, reasoningEffort?: string },
 *   ownerSessionId: string,
 *   signal?: AbortSignal,
 * }} opts
 */
function applyRecursiveToolRestriction(agentCtx, agent) {
  if (!agentCtx || !agentCtx.tools || typeof agentCtx.tools.restrict !== 'function') return;
  let deny = [...RECURSIVE_DENY_TOOLS];
  if (typeof agentCtx.tools.view === 'function') {
    const view = agentCtx.tools.view(agent);
    const restrictable = view && view.restrictableNames instanceof Set ? view.restrictableNames : null;
    if (restrictable) deny = deny.filter((name) => restrictable.has(name));
  }
  if (deny.length > 0) agentCtx.tools.restrict({ deny });
}

function buildDirectAgentSetup(presetsSvc, resolvedPreset, card) {
  return async (agentCtx, agent) => {
    await tryInstallModelSelection(agentCtx);
    await presetsSvc.mount(agentCtx, resolvedPreset);
    applyRecursiveToolRestriction(agentCtx, agent);
    agent.session.append('session/presentation', { owner: 'dsh-whale:todo', title: card.title });
    agent.session.append('approval/policy', { policy: 'never', source: 'delegation' });
  };
}

function directSessionServices(ctx, controller, ownerSessionId) {
  const agentsSvc = (ctx && typeof ctx.get === 'function' ? ctx.get('agents') : null) || (ctx && ctx.agents) || null;
  const presetsSvc = (ctx && typeof ctx.get === 'function' ? ctx.get('agentPresets') : null) || (ctx && ctx.agentPresets) || null;
  const canUseDirect = Boolean(
    ownerSessionId
    && agentsSvc && typeof agentsSvc.create === 'function'
    && presetsSvc && typeof presetsSvc.mount === 'function'
    && controller && typeof controller.create === 'function',
  );
  return { agentsSvc, presetsSvc, canUseDirect };
}

export async function createWorkspaceTaskSession({
  ctx,
  controller,
  sessionId,
  card,
  selectedModel,
  ownerSessionId,
  signal,
}) {
  const { agentsSvc, presetsSvc, canUseDirect } = directSessionServices(ctx, controller, ownerSessionId);
  if (!canUseDirect) {
    await controller.create({
      sessionId,
      cwd: card.cwd,
      agentPreset: 'standard',
      presentation: { owner: 'dsh-whale:todo', title: card.title },
    });
    await controller.selectModel({ sessionId, ...selectedModel, saveAsDefault: false });
    const live = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(sessionId) : null;
    return { agent: live || null, directHandle: null, usedDirectAgents: false };
  }

  const resolvedPreset = await resolveStandardPresetId(presetsSvc);
  const agentOptions = {
    provider: selectedModel.provider,
    model: selectedModel.model,
    ...(selectedModel.reasoningEffort ? { reasoningEffort: selectedModel.reasoningEffort } : {}),
  };
  const handle = await agentsSvc.create({
    sessionId,
    agentOptions,
    meta: { cwd: card.cwd, agentPreset: resolvedPreset, parentSession: ownerSessionId },
    signal,
    setup: buildDirectAgentSetup(presetsSvc, resolvedPreset, card),
  });
  const agent = (handle && handle.agent) || (typeof agentsSvc.get === 'function' ? agentsSvc.get(sessionId) : null) || null;
  if (typeof controller.selectModel === 'function') {
    await controller.selectModel({ sessionId, ...selectedModel, saveAsDefault: false });
  }
  return { agent, directHandle: handle, usedDirectAgents: true };
}

function ensureDelegationPolicy(approval, agent) {
  if (typeof approval.policyRecord !== 'function') return;
  if (approval.policyRecord(agent.session)?.source === 'delegation') return;
  agent.session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
}

function resolveApprovalService(ctx) {
  if (!ctx) return null;
  return (typeof ctx.get === 'function' ? ctx.get('approval') : null) || ctx.approval || null;
}

export async function bindTaskDelegatedApproval({ ctx, agent, ownerSessionId, label, validate }) {
  if (!agent || !ownerSessionId) return null;
  const approval = resolveApprovalService(ctx);
  if (!approval || typeof approval.bindDelegatedRequester !== 'function') return null;

  const owner = await resolveOwnerAgent(ctx, ownerSessionId);
  const parentId = agent.session && agent.session.header ? agent.session.header.parentSession : '';
  if (!owner || parentId !== owner.id) return null;

  try {
    ensureDelegationPolicy(approval, agent);
    if (typeof approval.enableDelegatedRequests === 'function') approval.enableDelegatedRequests(agent, owner);
    return approval.bindDelegatedRequester(agent, {
      owner,
      label: String(label || '受管任务').slice(0, 120),
      validate,
    });
  } catch (error) {
    ctx?.logger?.warn?.(`whale todos delegated approval bind skipped: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Drain all Harness background `jobs` owned by a task session during `stop()`.
 * @param {any} ctx
 * @param {string} sessionId
 * @param {number} [waitMs]
 */
export async function drainSessionJobs(ctx, sessionId, waitMs = 5_000) {
  if (!sessionId) return { killed: 0 };
  const jobs = ctx?.get?.('jobs') ?? ctx?.jobs;
  if (typeof jobs?.list !== 'function') return { killed: 0 };
  let rows = [];
  try {
    rows = jobs.list(sessionId) ?? [];
  } catch {
    return { killed: 0 };
  }
  const active = rows.filter((job) => job && (job.status === 'running' || job.status === 'stopping'));
  let killed = 0;
  for (const job of active) {
    const jobId = job.id ?? job.spec?.id;
    if (!jobId) continue;
    try {
      if (typeof jobs.kill === 'function') {
        await jobs.kill(jobId, sessionId, 'whale-todo-stopped');
        killed += 1;
      }
      if (typeof jobs.wait === 'function') {
        await jobs.wait(jobId, waitMs, sessionId).catch(() => { /* Wait timeout on an already-killed job is non-fatal during stop drain. */ });
      }
    } catch {
      /* Continue draining remaining jobs for this session. */
    }
  }
  return { killed };
}

/**
 * Persist-first structured receipt delivery: called ONLY AFTER card state and
 * run records have been durably persisted in `whale_todos`. Never dumps raw
 * tool logs into the resident assistant conversation.
 *
 * @param {any} ctx
 * @param {any} scope
 * @param {any} card
 * @param {any} [run]
 */
export async function deliverStructuredReceipt(ctx, scope, card, run) {
  const selfId = String(scope?.get?.()?.sessionId ?? '').trim();
  if (!selfId) return { delivered: false, reason: 'no-resident-session' };
  const owner = await resolveOwnerAgent(ctx, selfId);
  if (typeof owner?.session?.append !== 'function') {
    return { delivered: false, reason: 'resident-unavailable' };
  }
  const receiptId = `whale-todo-receipt-${card.id}-${card.generation}-${run?.attempt ?? 1}`;
  const events = typeof owner.session.snapshotEvents === 'function' ? owner.session.snapshotEvents() : [];
  if (events.some((ev) => ev?.type === 'user/message' && ev?.data?.source?.receiptId === receiptId)) {
    return { delivered: true, deduplicated: true };
  }
  const text = formatStructuredReceipt(card, run);
  owner.session.append('user/message', Object.freeze({
    ...createUserMessage({
      source: {
        kind: 'plugin',
        plugin: 'dsh-whale',
        form: 'notice',
        summary: `任务「${card.title}」${card.state}`,
        cardId: card.id,
        receiptId,
      },
      content: [{ type: 'text', text }],
    }),
    id: receiptId,
  }), { surfaceOp: 'append' });
  const sessionsSvc = ctx?.get?.('sessions') ?? ctx?.sessions;
  if (typeof sessionsSvc?.flush === 'function') {
    await sessionsSvc.flush(owner.session).catch(() => { /* Session journal flush is best-effort after receipt append. */ });
  }
  return { delivered: true, receiptId };
}

/**
 * Execute a `readonly-brief` task card through the restricted `whale-task-reader`
 * worker preset (zero shell/fs/network, `forbiddenRoot: $DSH_HOME`, step/byte/
 * deadline caps).
 *
 * @param {{
 *   ctx: any,
 *   home: string,
 *   card: any,
 *   run: any,
 *   selectedModel: { provider: string, model: string },
 *   startWorker?: typeof startTaskWorker,
 *   assertCurrent: () => void,
 *   onBoundAgent?: (agent: any) => void,
 * }} opts
 */
export async function executeReadonlyBriefRun({
  ctx,
  home,
  card,
  run,
  selectedModel,
  startWorker = startTaskWorker,
  assertCurrent,
  onBoundAgent,
}) {
  const files = Array.isArray(card.files) ? card.files : [];
  if (!files.length) {
    throw new Error('readonly-brief 任务需要至少一个待阅读的文本文件（files）。');
  }
  const isIm = card.origin?.kind === 'im';
  const inputs = await captureInputs(files, {
    allowedFiles: isIm ? files : undefined,
    forbiddenRoot: home || undefined,
  });
  const now = Date.now();
  const execution = {
    id: run.runId,
    sessionId: run.sessionId,
    promptId: `${run.runId}-prompt`,
    generation: card.generation,
    startedAt: now,
    deadlineAt: now + taskLimits.deadlineMs,
    requests: 0,
    readBytes: 0,
    readIds: [],
    report: null,
  };
  const criteriaList = String(card.criteria ?? '')
    .split(/\r?\n|[;；]/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const syntheticTask = {
    id: card.id,
    generation: card.generation,
    goal: card.description ? `${card.title}：${card.description}` : card.title,
    criteria: criteriaList.length ? criteriaList : ['给出有证据引用的资料摘要，并说明未确认项。'],
    inputs,
    model: { provider: selectedModel.provider, model: selectedModel.model },
    execution,
  };
  const cwd = home ? path.join(home, 'data', 'whale-task-workspaces', card.id) : card.cwd;
  await fs.mkdir(cwd, { recursive: true });

  const policy = {
    cwd,
    bindAgent: (agent) => onBoundAgent?.(agent),
    assertCurrent,
    validate: async () => { assertCurrent(); },
    request: async () => {
      assertCurrent();
      if (execution.requests >= taskLimits.maxRequests) throw new Error('任务模型请求达到上限。');
      execution.requests += 1;
    },
    read: async (inputId, bytes) => {
      assertCurrent();
      if (execution.readBytes + bytes > taskLimits.maxReadBytes) throw new Error('资料读取量达到上限。');
      execution.readBytes += bytes;
      if (inputId && bytes > 0 && !execution.readIds.includes(inputId)) execution.readIds.push(inputId);
    },
    report: async (args) => {
      assertCurrent();
      if (execution.report) throw new Error('本次执行已提交报告。');
      if (!Array.isArray(args?.evidence) || !args.evidence.every((ref) => inputs.some((item) => item.id === ref) && execution.readIds.includes(ref))) {
        throw new Error('报告引用了未获准或未读取的资料。');
      }
      execution.report = args;
    },
  };
  const worker = startWorker(ctx, syntheticTask, policy);
  return {
    worker,
    inputs,
    execution,
  };
}
