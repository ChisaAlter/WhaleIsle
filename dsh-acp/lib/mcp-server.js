/**
 * WhaleIsle-owned MCP endpoint served on the host webServer.
 *
 * ACP injects one curated MCP server exposing host capabilities into every
 * external agent session; this is the WhaleIsle equivalent. The toolkit is
 * intentionally small: it projects `ctx.skills` (the merged DSH skill catalog)
 * so external ACP agents can discover and load WhaleIsle skills they cannot
 * see through their own config directories.
 *
 * Transport is the request/response form of streamable HTTP: one JSON-RPC
 * payload per POST, `application/json` reply (202 for notifications), bearer
 * token scoped to the issuing agent connection.
 */
import crypto from 'node:crypto';
import {
  resolveDelegationCwd,
  assertWorkspaceContainment,
  checkForbiddenDelegateRoot,
  isPathInsideRoot,
  isWindowsUncOrDevicePath,
} from './delegate-cwd.js';
import { executionProvider, listDirectChildren } from './host-contract.js';
import {
  AGENT_TOOLS,
  CONTROL_TOOLS,
  resultRequest,
  buildDelegateConfirmRequest,
  formatConfirmPromptSection,
} from './delegation.js';
import { acpErrorMessage } from './errors.js';
import { confirmModelAction, DECLINED_TEXT } from './desktop-confirm.js';
import { TEAM_TOOLS, executeTeamTool, isTeamTool, listTeamMembers, teamAvailable, teamEnabled } from './team.js';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'whaleisle', title: 'WhaleIsle', version: '0.1.0' };
const RUNNING_TASK_NEXT = 'Completion wakes this conversation and delivers the result, so end your turn. Do not wait on it or poll it.';
const DEFAULT_LIVENESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const LOOKUP_MISS_WINDOW_MS = 60_000;
const LOOKUP_MISS_MAX_PER_WINDOW = 10;
const WRITE_CONTROL_TOOLS = new Set([
  'acp_delegate',
  'acp_cancel',
  'send_message',
  'interrupt_agent',
  'team_task_create',
  'team_task_update',
]);

const TOOL_DEFINITIONS = [
  ...AGENT_TOOLS,
  ...CONTROL_TOOLS,
  {
    name: 'send_message',
    description: 'Send a message to another agent in your subagent tree: your parent ("lead" for the root), a child, or a teammate. A working agent receives it at its next step; an idle agent starts a new turn with it.',
    inputSchema: {
      type: 'object', properties: { agent_id: { type: 'string', description: 'Agent name from list_agents (for example lead or lead/reviewer), or a session id.' }, message: { type: 'string' } },
      required: ['agent_id', 'message'], additionalProperties: false,
    },
  },
  {
    name: 'list_agents',
    description: 'List your direct child sessions with name, current state, output preview and error when needed. When Agent Teams is enabled, list the whole team instead: the root as "lead" and every continuable member by path name, with your own row marked self. Do not poll running children: completion automatically delivers results and wakes this conversation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'interrupt_agent',
    description: 'Stop the current work of an agent you created: a direct child or a deeper descendant. It stays available for a follow-up message.',
    inputSchema: {
      type: 'object', properties: { agent_id: { type: 'string', description: 'Agent name from list_agents, or a session id.' } },
      required: ['agent_id'], additionalProperties: false,
    },
  },
  {
    name: 'whaleisle_skill_list',
    description:
      'List skills installed on this WhaleIsle host (DeepSeek Harness). ' +
      'Returns each skill name, description, and source; call whaleisle_skill_get ' +
      'with a name to load the full instructions before acting on them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'whaleisle_skill_get',
    description:
      'Load one WhaleIsle skill by name. Returns the complete skill instructions ' +
      'plus the base directory its relative resources resolve against.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name from whaleisle_skill_list (kebab-case).' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'whaleisle_present',
    description:
      'Declare files you created or updated that the user asked to receive ' +
      '(HTML pages, images, documents, exports). WhaleIsle shows them as ' +
      'delivery cards and makes matching file references in your reply ' +
      'clickable. Call after producing each requested file, before your final ' +
      'reply. Do not declare ordinary source-code edits.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Absolute path, or path relative to the session working directory.' },
              description: { type: 'string', description: 'One-line description shown on the delivery card.' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
      required: ['files'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

function textResult(text, extra = {}) {
  return { content: [{ type: 'text', text }], ...extra };
}

function errorResult(text) {
  return textResult(text, { isError: true });
}

let MCP_INSTANCE_SEQ = 0;

/**
 * @param {object} options
 * @param {object} options.ctx - cordis host context (skills service, logger).
 * @param {(tag: string, extra: object) => void} [options.diag] - safe diagnostic sink.
 * @returns token lifecycle + JSON-RPC dispatch.
 */
export function createWhaleIsleMcp({
  ctx,
  diag,
  listAgents,
  delegate,
  preflightDelegate,
  tasks,
  waitTask,
  livenessWindowMs = DEFAULT_LIVENESS_WINDOW_MS,
  now = () => Date.now(),
}) {
  const instanceId = `mcp-${++MCP_INSTANCE_SEQ}-pid${process.pid}`;
  /** @type {Map<string, { cwd: string, agentName: string, dshSession?: object, presented: Set<string>, lastAliveAt: number, signal?: AbortSignal, providerId?: string }>} */
  const sessions = new Map();
  const hashToken = (t) => crypto.createHash('sha256').update(String(t || '')).digest('hex');
  const fp = (t) => hashToken(t).slice(0, 8);
  let missWindowStart = 0;
  let missCount = 0;
  const log = (tag, extra) => {
    try { diag?.(tag, { instance: instanceId, ...extra }); } catch { /* never break */ }
  };
  const logLookupMiss = (token, reason) => {
    const ts = now();
    if (ts - missWindowStart >= LOOKUP_MISS_WINDOW_MS) {
      missWindowStart = ts;
      missCount = 0;
    }
    missCount += 1;
    if (missCount <= LOOKUP_MISS_MAX_PER_WINDOW) {
      log('lookup-miss', { fp: fp(token), size: sessions.size, ...(reason ? { reason } : {}) });
    }
  };

  function issueToken(session) {
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    sessions.set(tokenHash, {
      cwd: String(session?.cwd || process.cwd()),
      agentName: String(session?.agentName || 'ACP agent'),
      dshSession: session?.dshSession,
      presented: new Set(),
      lastAliveAt: now(),
    });
    log('issue', { fp: tokenHash.slice(0, 8), size: sessions.size, agent: session?.agentName });
    return token;
  }

  function revokeToken(token) {
    const raw = String(token || '');
    const tokenHash = hashToken(raw);
    const had = sessions.delete(tokenHash);
    log('revoke', { fp: tokenHash.slice(0, 8), had, size: sessions.size });
  }

  function sessionFor(token) {
    const raw = String(token || '');
    if (!raw) {
      logLookupMiss(raw, 'empty');
      return null;
    }
    const tokenHash = hashToken(raw);
    const found = sessions.get(tokenHash) || null;
    if (!found) {
      logLookupMiss(raw);
      return null;
    }
    const ts = now();
    if (ts - found.lastAliveAt > livenessWindowMs) {
      logLookupMiss(raw, 'expired');
      return null;
    }
    found.lastAliveAt = ts;
    return found;
  }

  // The active dsh session can attach after the token was issued (restored
  // sessions resolve their agent per turn); rebind on every turn start and
  // refresh the liveness window so active sessions stay valid across idle gaps.
  function bindSession(token, dshSession, signal, providerId) {
    const raw = String(token || '');
    if (!raw) return;
    const rec = sessions.get(hashToken(raw));
    if (rec && dshSession) {
      rec.dshSession = dshSession;
      rec.signal = signal;
      rec.providerId = providerId;
      rec.lastAliveAt = now();
    }
  }

  function safeGetService(name) {
    try {
      if (typeof ctx?.get === 'function') {
        const val = ctx.get(name);
        if (val !== undefined) return val;
      }
      return ctx?.[name];
    } catch {
      return undefined;
    }
  }

  async function childSnapshot(childId, signal) {
    const observation = await safeGetService('sessionQuery').observeSession(childId, { signal });
    try {
      const events = observation.events;
      const start = events.findLast((event) => event.type === 'turn/start');
      const current = events.filter((event) => event.seq > (start?.seq ?? -1));
      const end = current.findLast((event) => event.type === 'turn/end');
      const reason = end?.data?.reason;
      const message = current.findLast((event) => event.type === 'assistant/message' && event.data.message.content.length > 0);
      const output = (message?.data?.message?.content || []).filter((part) => part.type === 'text');
      return {
        subagentId: childId,
        status: !end ? 'running' : reason?.kind === 'completed' ? 'completed' : ['interrupted', 'aborted'].includes(reason?.kind) ? 'cancelled' : 'failed',
        output, ...(end ? { stopReason: reason?.kind === 'completed' ? 'completed' : ['interrupted', 'aborted'].includes(reason?.kind) ? 'aborted' : 'error' } : {}),
        ...(reason?.error?.message ? { diagnostic: reason.error.message } : {}),
      };
    } finally { observation[Symbol.dispose](); }
  }

  // Explicit waits observe terminal events instead of repeatedly opening logs.
  // Subscribe before the first snapshot so completion cannot fall in a gap.
  async function readChildResult(childId, signal, waitMs) {
    if (!waitMs) return childSnapshot(childId, signal);
    let timer;
    let onAbort;
    let off;
    const changed = new Promise((resolve, reject) => {
      off = ctx.on('session/event', (childSession, event) => {
        if (childSession.id === childId && event.type === 'turn/end') resolve();
      });
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(resolve, waitMs);
    });
    try {
      signal.throwIfAborted();
      const initial = await childSnapshot(childId, signal);
      if (initial.status !== 'running') return initial;
      await changed;
      signal.throwIfAborted();
      return await childSnapshot(childId, signal);
    } finally {
      clearTimeout(timer);
      off?.();
      signal.removeEventListener('abort', onAbort);
      // A failed initial read must not leave a rejected abort waiter behind.
      changed.catch(() => { /* The initial read owns its failure; this observes the abandoned abort waiter. */ });
    }
  }

  const resultResponse = (value) => {
    value = { ...value, workState: value.workState || (value.status === 'running' ? 'working' : 'result_available'),
      ...(value.status === 'running' ? { next: RUNNING_TASK_NEXT } : {}) };
    const content = [...value.output, ...(value.diagnostic ? [{ type: 'text', text: value.diagnostic }] : [])];
    return {
      content: content.length ? content : [{ type: 'text', text: value.status === 'running'
        ? `Child ${value.subagentId} is running. ${RUNNING_TASK_NEXT}`
        : `Child ${value.subagentId} finished: ${value.stopReason}.` }],
      structuredContent: value, isError: value.status === 'failed' || value.status === 'cancelled',
    };
  };

  async function handleListAgents(parent, subagents, signal) {
    if (teamEnabled(ctx, parent)) {
      const members = await listTeamMembers(ctx, parent, signal);
      // Members this caller delegated also carry their task receipt state.
      const agents = await Promise.all(members.map(async (member) => {
        const task = tasks?.latest(parent.id, member.id);
        if (!task) return member;
        const { taskId, workState, status: taskStatus } = await tasks.snapshot(parent, member.id);
        return { ...member, taskId, taskStatus, workState };
      }));
      return textResult(JSON.stringify({ agents }), { structuredContent: { agents } });
    }
    const children = await listDirectChildren(subagents, parent.id, signal);
    const agents = await Promise.all(children.map(async (child) => ({ ...child, ...await (tasks?.latest(parent.id, child.id) ? tasks.snapshot(parent, child.id) : childSnapshot(child.id, signal)) })));
    return textResult(JSON.stringify({ agents }), { structuredContent: { agents } });
  }

  async function handleAcpResult(parent, subagents, args, signal) {
    const { waitMs } = resultRequest(args);
    if (args.task_id) return resultResponse(await waitTask(parent, tasks.get(parent.id, args.task_id).taskId, waitMs, signal));
    const task = tasks?.latest(parent.id, args.agent_id);
    if (task) return resultResponse(await waitTask(parent, task.taskId, waitMs, signal));
    // Children without a configured-agent receipt (other host providers).
    const children = await listDirectChildren(subagents, parent.id, signal);
    if (!children.some((child) => child.id === args.agent_id)) return errorResult('Result access requires a direct child of this conversation.');
    return resultResponse(await readChildResult(args.agent_id, signal, waitMs));
  }

  function checkOwnershipAndTurn(name, session) {
    const current = safeGetService('agents')?.get?.(session.dshSession?.id);
    const provider = executionProvider(current);
    if (session.providerId && provider && provider !== session.providerId) {
      return 'This MCP connection no longer owns the selected agent. Use the active agent connection.';
    }
    if (WRITE_CONTROL_TOOLS.has(name)) {
      if (session.signal?.aborted) {
        return 'This agent execution has ended; its MCP connection cannot start or change work.';
      }
      if (typeof current?.session?.snapshotEvents === 'function') {
        const edge = current.session.snapshotEvents().findLast((event) => ['turn/start', 'turn/end'].includes(event.type));
        if (session.providerId && edge?.type !== 'turn/start') {
          return name === 'acp_delegate'
            ? 'Delegation requires an open turn owned by this agent connection.'
            : 'This tool requires an open turn owned by this agent connection.';
        }
        if (!session.providerId && edge?.type === 'turn/end') {
          return 'This tool requires an open turn owned by this agent connection.';
        }
      }
    }
    return null;
  }

  async function handleAgentControl(name, args, session) {
    const parent = safeGetService('agents')?.get?.(session.dshSession?.id);
    const subagents = safeGetService('subagents');
    if (!parent || !session.signal || !subagents) return errorResult('Agent control requires an active host session.');
    if (name === 'list_agents') return handleListAgents(parent, subagents, session.signal);
    if (name === 'acp_cancel') return resultResponse(await tasks.cancel(parent, args.task_id));
    if (name === 'acp_result') return handleAcpResult(parent, subagents, args, session.signal);
    if (typeof args.agent_id !== 'string' || !args.agent_id) return errorResult('agent_id is required.');
    // Names resolve within the caller's tree like the host tools; a session id resolves to itself.
    const targetId = typeof subagents.resolveName === 'function'
      ? await subagents.resolveName(parent, args.agent_id, session.signal)
      : args.agent_id;
    if (name === 'interrupt_agent') {
      const descendants = typeof subagents.listDescendants === 'function'
        ? (await subagents.listDescendants(parent.id, session.signal)).filter((row) => row.kind !== 'diagnostic')
        : await listDirectChildren(subagents, parent.id, session.signal);
      if (!descendants.some((child) => child.id === targetId)) return errorResult('Interrupt requires an agent you created (a direct child or deeper descendant).');
      subagents.interrupt(targetId, { kind: 'ancestor', agent: parent });
      return textResult(`Interrupted ${args.agent_id}.`);
    }
    if (typeof args.message !== 'string' || !args.message.trim()) return errorResult('message must be non-empty.');
    const previousTask = tasks?.latest?.(parent.id, targetId);
    if (previousTask) {
      if (previousTask.endedAt) {
        const agentLabel = String(previousTask.agentName || previousTask.agentId || args.agent_id);
        const taskCwd = String(previousTask.cwd || '').trim();
        const metaLines = [
          ...(taskCwd ? [`目标目录：${taskCwd}`] : []),
          `目标代理：${agentLabel}（子会话：${targetId}）`,
          ...(previousTask.model ? [`模型：${previousTask.model} | 权限模式：${previousTask.runtimeMode || 'inherit'} | 交互模式：${previousTask.interactionMode || 'default'}`] : []),
        ];
        const confirmation = await confirmModelAction({
          tool: 'send_message',
          action: 'followup',
          effect: 'code',
          summary: `在已结束的已配置代理 ${agentLabel} 上继续启动新一轮可执行命令的子任务${taskCwd ? `（目录：${taskCwd}）` : ''}`,
          details: `${metaLines.join('\n')}\n\n${formatConfirmPromptSection(args.message)}`,
        }, { signal: session.signal });
        if (confirmation.ok !== true) return errorResult(DECLINED_TEXT);
        const postRejection = checkOwnershipAndTurn('send_message', session);
        if (postRejection) return errorResult(postRejection);
      }
      const messageId = await tasks.followup(parent, targetId, args.message, session.signal);
      return textResult(JSON.stringify({ messageId }));
    }
    const messageId = await subagents.sendMessage(parent, targetId, [{ type: 'text', text: args.message }], { signal: session.signal });
    return textResult(JSON.stringify({ messageId }));
  }

  async function callTool(name, args, session) {
    const preRejection = checkOwnershipAndTurn(name, session);
    if (preRejection) return errorResult(preRejection);
    if (isTeamTool(name)) {
      const caller = safeGetService('agents')?.get?.(session.dshSession?.id);
      if (!caller || !session.signal) return errorResult('Agent Teams requires an active host session.');
      const value = await executeTeamTool(ctx, name, args, caller, session.signal);
      return textResult(JSON.stringify(value), { structuredContent: value });
    }
    if (['send_message', 'list_agents', 'interrupt_agent', 'acp_result', 'acp_cancel'].includes(name)) {
      return handleAgentControl(name, args, session);
    }
    if (name === 'acp_agents') {
      const agents = listAgents();
      return textResult(JSON.stringify({ agents }), { structuredContent: { agents } });
    }
    if (name === 'acp_delegate') {
      const parent = safeGetService('agents')?.get?.(session.dshSession?.id);
      if (!parent || !session.signal) return errorResult('Delegation requires an active parent conversation.');
      let resolvedCwd = '';
      let effectiveModel = String(args?.model || '');
      let existingTask = null;
      try {
        if (typeof preflightDelegate === 'function') {
          const preflight = await preflightDelegate(args, parent, safeGetService('subagents'));
          resolvedCwd = preflight?.resolvedCwd ?? resolveDelegationCwd(args, parent);
          effectiveModel = preflight?.effectiveModel ?? effectiveModel;
          existingTask = preflight?.existingTask ?? null;
        } else {
          if (args.timeout_ms !== undefined && (!Number.isInteger(args.timeout_ms) || args.timeout_ms < 0 || args.timeout_ms > 20000)) {
            throw new Error('timeout_ms must be an integer from 0 to 20000.');
          }
          resolvedCwd = resolveDelegationCwd(args, parent);
        }
      } catch (error) {
        return errorResult(String(error instanceof Error ? error.message : error));
      }
      if (!existingTask) {
        const confirmation = await confirmModelAction(
          buildDelegateConfirmRequest(args, { resolvedCwd, effectiveModel }),
          { signal: session.signal },
        );
        if (confirmation.ok !== true) return errorResult(DECLINED_TEXT);
        const postRejection = checkOwnershipAndTurn('acp_delegate', session);
        if (postRejection) return errorResult(postRejection);
      }
      const signal = session.signal;
      const child = await delegate(args, parent, signal);
      if (args.mode === 'wait') return resultResponse(await waitTask(parent, child.taskId, args.timeout_ms ?? 15000, signal));
      if (child.recovered || tasks?.get(parent.id, child.taskId).endedAt) return resultResponse(await tasks.snapshot(parent, child.taskId, true));
      return resultResponse({ subagentId: child.childId, ...(child.name ? { name: child.name } : {}), taskId: child.taskId, status: 'running', output: [] });
    }
    if (name === 'whaleisle_skill_list') {
      const skills = safeGetService('skills');
      if (!skills || typeof skills.list !== 'function') {
        return errorResult('The WhaleIsle skills service is not available in this host.');
      }
      const list = await skills.list({ cwd: session.cwd });
      if (!Array.isArray(list) || list.length === 0) {
        return textResult('No skills are installed on this WhaleIsle host.', {
          structuredContent: { skills: [] },
        });
      }
      const rows = list
        .filter((s) => s?.invocation?.modelInvocable !== false)
        .map((s) => ({ name: s.name, description: s.description || '', source: s.source || 'unknown' }));
      const text = rows
        .map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ''} [${s.source}]`)
        .join('\n');
      return textResult(
        `WhaleIsle skills (${rows.length}):\n${text}\n\nLoad one with whaleisle_skill_get.`,
        { structuredContent: { skills: rows } },
      );
    }
    if (name === 'whaleisle_skill_get') {
      const skills = safeGetService('skills');
      if (!skills || typeof skills.get !== 'function') {
        return errorResult('The WhaleIsle skills service is not available in this host.');
      }
      const skillName = String(args?.name || '').trim();
      if (!skillName) return errorResult('whaleisle_skill_get requires a "name" argument.');
      const skill = await skills.get(skillName, { cwd: session.cwd });
      if (!skill || skill?.invocation?.modelInvocable === false) {
        return errorResult(`No WhaleIsle skill named "${skillName}". Run whaleisle_skill_list for the catalog.`);
      }
      const base = skill.resourceBase?.kind === 'directory' ? skill.resourceBase.path : null;
      const text = [
        `<skill_content name="${skillName}">`,
        ...(base ? [`Base directory for this skill: ${base}`, ''] : []),
        String(skill.content || ''),
        '</skill_content>',
      ].join('\n');
      return textResult(text);
    }
    if (name === 'whaleisle_present') {
      if (session.signal?.aborted) {
        return errorResult('This agent execution has ended; its MCP connection cannot present files.');
      }
      const dshSession = session.dshSession;
      if (!dshSession || typeof dshSession.append !== 'function') {
        return errorResult('No live WhaleIsle session is bound to this connection.');
      }
      const fs = safeGetService('fs');
      const projections = safeGetService('sessionProjections');
      if (!fs || typeof fs.resolve !== 'function' || !projections || typeof projections.stateOf !== 'function') {
        return errorResult('The WhaleIsle filesystem services are not available in this host.');
      }
      const boundary = projections.stateOf(dshSession, 'turnBoundary');
      if (!boundary || boundary.openTurnStartSeq === null || boundary.openTurnStartSeq === undefined) {
        return errorResult('whaleisle_present requires an open turn; call it while a request is in progress.');
      }
      const files = Array.isArray(args?.files) ? args.files : null;
      if (!files || files.length === 0 || files.length > 20) {
        return errorResult('whaleisle_present accepts 1 to 20 files.');
      }
      const presented = [];
      for (const file of files) {
        const filePath = String(file?.path || '').trim();
        if (!filePath) return errorResult('whaleisle_present requires a non-empty file path.');
        const outsideWorkspaceMsg = `Cannot present ${filePath}: path must be inside the session workspace.`;
        if (filePath.includes('\0') || isWindowsUncOrDevicePath(filePath)) {
          return errorResult(outsideWorkspaceMsg);
        }
        let contained;
        try {
          contained = assertWorkspaceContainment(session.cwd, filePath, {
            label: filePath,
            rejectLeafSymlink: true,
          });
        } catch {
          return errorResult(outsideWorkspaceMsg);
        }
        if (checkForbiddenDelegateRoot(contained)) {
          return errorResult(outsideWorkspaceMsg);
        }
        const entry = await fs.lstat(filePath, { cwd: session.cwd });
        if (entry !== undefined && entry.type !== 'file') {
          return errorResult(`Cannot present ${filePath}: not a regular file.`);
        }
        const target = await fs.resolve(filePath, { cwd: session.cwd });
        const canonical = fs.processPath(target);
        if (
          !isPathInsideRoot(session.cwd, canonical, { rejectLeafSymlink: true })
          || checkForbiddenDelegateRoot(canonical)
        ) {
          return errorResult(outsideWorkspaceMsg);
        }
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file') {
          return errorResult(`Cannot present ${filePath}: file not found. Check the path, create the file if needed, and retry.`);
        }
        session.presented.add(canonical);
        presented.push({ path: canonical, ...(file?.description ? { description: String(file.description) } : {}) });
      }
      dshSession.append('deliverables/presented', {
        turn: boundary.lastTurn,
        callId: `whaleisle-mcp-${crypto.randomBytes(6).toString('hex')}`,
        files: presented,
      });
      return textResult(
        `Delivered ${presented.length} file(s) to the user:\n${presented.map((f) => `- ${f.path}`).join('\n')}\n` +
        'WhaleIsle shows delivery cards and makes these file references clickable.',
        { structuredContent: { turn: boundary.lastTurn, files: presented } },
      );
    }
    return errorResult(`Unknown whaleisle tool "${name}".`);
  }

  function toolCallErrorResponse(messageId, err) {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id: messageId ?? null,
        result: { ...errorResult(acpErrorMessage(err)), ...(err?.code === 'ACP_PREPARATION_FAILED' ? {
          structuredContent: { status: 'rejected', failure: { code: err.code, stage: err.stage, message: acpErrorMessage(err), ...(err.availableModels ? { availableModels: err.availableModels } : {}) } },
        } : {}) },
      },
    };
  }

  /**
   * Dispatch one parsed JSON-RPC message against an authenticated session.
   * @returns {{ status: number, body?: object }} HTTP status + optional JSON body.
   */
  async function dispatch(message, session) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return { status: 200, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } } };
    }
    const method = message.method;
    if (method === 'initialize') {
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          },
        },
      };
    }
    if (typeof method === 'string' && method.startsWith('notifications/')) {
      return { status: 202 };
    }
    if (method === 'ping') {
      return { status: 200, body: { jsonrpc: '2.0', id: message.id ?? null, result: {} } };
    }
    if (method === 'tools/list') {
      // MCP tool lists are fixed per connection here; Team calls check the live mode.
      const tools = teamAvailable(ctx) ? [...TOOL_DEFINITIONS, ...TEAM_TOOLS] : TOOL_DEFINITIONS;
      return {
        status: 200,
        body: { jsonrpc: '2.0', id: message.id ?? null, result: { tools } },
      };
    }
    if (method === 'tools/call') {
      const rawArgs = message.params?.arguments;
      if (rawArgs !== undefined && (rawArgs === null || typeof rawArgs !== 'object' || Array.isArray(rawArgs))) {
        return {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: message.id ?? null,
            error: { code: -32602, message: 'Invalid params: arguments must be a JSON object.' },
          },
        };
      }
      try {
        const result = await callTool(message.params?.name, rawArgs ?? {}, session);
        return { status: 200, body: { jsonrpc: '2.0', id: message.id ?? null, result } };
      } catch (err) {
        return toolCallErrorResponse(message.id, err);
      }
    }
    if (message.id === undefined) {
      return { status: 202 };
    }
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Method not found: ${String(method)}` },
      },
    };
  }

  return { issueToken, revokeToken, sessionFor, bindSession, dispatch };
}
