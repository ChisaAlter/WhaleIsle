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
import { executionProvider, listDirectChildren } from './host-contract.js';
import { AGENT_TOOLS } from './delegation.js';
import { acpErrorMessage } from './errors.js';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'whaleisle', title: 'WhaleIsle', version: '0.1.0' };
const RUNNING_TASK_NEXT = 'Completion wakes this conversation and delivers the result, so end your turn. Do not wait on it or poll it.';

const TOOL_DEFINITIONS = [
  ...AGENT_TOOLS,
  {
    name: 'acp_cancel',
    description: 'Cancel a direct child task, clear queued work, stop descendants, and suppress its completion wake. Completed output remains readable. Use interrupt_agent only to pause the current execution while retaining queued work.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'], additionalProperties: false },
  },
  {
    name: 'acp_result',
    description: 'Read the state and output of an existing direct child after its completion wakes you, or when the user requests status. Do not poll a running child: completion automatically delivers its result and wakes this conversation. Works for earlier child sessions too. Optional wait_ms (up to 20000) retains explicit bounded-wait support.',
    inputSchema: {
      type: 'object', properties: { agent_id: { type: 'string' }, task_id: { type: 'string', description: 'Exact task identity; preferred to the compatibility child-session id.' }, wait_ms: { type: 'integer', minimum: 0, maximum: 20000 } },
      additionalProperties: false,
    },
  },
  {
    name: 'send_message',
    description: 'Send a follow-up task or result to your parent or one of your child agents. Use the session id returned by acp_delegate, or the parent id given in your task.',
    inputSchema: {
      type: 'object', properties: { agent_id: { type: 'string' }, message: { type: 'string' } },
      required: ['agent_id', 'message'], additionalProperties: false,
    },
  },
  {
    name: 'list_agents',
    description: 'List your direct child sessions with current state, output preview and error when needed. Do not poll running children: completion automatically delivers results and wakes this conversation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'interrupt_agent',
    description: 'Stop one of your child agent sessions. The child stays available for a follow-up message.',
    inputSchema: {
      type: 'object', properties: { agent_id: { type: 'string' } },
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
export function createWhaleIsleMcp({ ctx, diag, listAgents, delegate, tasks, waitTask }) {
  const instanceId = `mcp-${++MCP_INSTANCE_SEQ}-pid${process.pid}`;
  /** @type {Map<string, { cwd: string, agentName: string, dshSession?: object, presented: Set<string> }>} */
  const sessions = new Map();
  const fp = (t) => crypto.createHash('sha256').update(String(t || '')).digest('hex').slice(0, 8);
  const log = (tag, extra) => {
    try { diag?.(tag, { instance: instanceId, ...extra }); } catch { /* never break */ }
  };

  function issueToken(session) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, {
      cwd: String(session?.cwd || process.cwd()),
      agentName: String(session?.agentName || 'ACP agent'),
      dshSession: session?.dshSession,
      presented: new Set(),
    });
    log('issue', { fp: fp(token), size: sessions.size, agent: session?.agentName });
    return token;
  }

  function revokeToken(token) {
    const had = sessions.delete(token);
    log('revoke', { fp: fp(token), had, size: sessions.size });
  }

  function sessionFor(token) {
    const found = sessions.get(String(token || '')) || null;
    if (!found) log('lookup-miss', { fp: fp(token), size: sessions.size });
    return found;
  }

  // The active dsh session can attach after the token was issued (restored
  // sessions resolve their agent per turn); rebind on every turn start.
  function bindSession(token, dshSession, signal, providerId) {
    const rec = sessions.get(String(token || ''));
    if (rec && dshSession) {
      rec.dshSession = dshSession;
      rec.signal = signal;
      rec.providerId = providerId;
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
      changed.catch(() => {});
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

  async function callTool(name, args, session) {
    const current = safeGetService('agents')?.get?.(session.dshSession?.id);
    const provider = executionProvider(current);
    if (session.providerId && provider && provider !== session.providerId) return errorResult('This MCP connection no longer owns the selected agent. Use the active agent connection.');
    if (name === 'acp_delegate' && session.providerId) {
      const edge = current?.session.snapshotEvents().findLast((event) => ['turn/start', 'turn/end'].includes(event.type));
      if (edge?.type !== 'turn/start') return errorResult('Delegation requires an open turn owned by this agent connection.');
    }
    if (['acp_delegate', 'acp_cancel', 'send_message', 'interrupt_agent'].includes(name) && session.signal?.aborted) return errorResult('This agent execution has ended; its MCP connection cannot start or change work.');
    if (['send_message', 'list_agents', 'interrupt_agent', 'acp_result', 'acp_cancel'].includes(name)) {
      const parent = safeGetService('agents')?.get?.(session.dshSession?.id);
      const subagents = safeGetService('subagents');
      if (!parent || !session.signal || !subagents) return errorResult('Agent control requires an active host session.');
      if (name === 'list_agents') {
        const children = await listDirectChildren(subagents, parent.id, session.signal);
        const agents = await Promise.all(children.map(async (child) => ({ ...child, ...await (tasks?.latest(parent.id, child.id) ? tasks.snapshot(parent, child.id) : childSnapshot(child.id, session.signal)) })));
        return textResult(JSON.stringify({ agents }), { structuredContent: { agents } });
      }
      if (name === 'acp_cancel') return resultResponse(await tasks.cancel(parent, args.task_id));
      if (name === 'acp_result' && args.task_id) args = { ...args, agent_id: tasks.get(parent.id, args.task_id).childId };
      if (typeof args.agent_id !== 'string' || !args.agent_id) return errorResult('agent_id is required.');
      if (name === 'acp_result') {
        if (args.wait_ms !== undefined && (!Number.isInteger(args.wait_ms) || args.wait_ms < 0 || args.wait_ms > 20000)) return errorResult('wait_ms must be an integer from 0 to 20000.');
        const task = tasks?.latest(parent.id, args.agent_id);
        if (task) return resultResponse(await waitTask(parent, args.task_id || task.taskId, args.wait_ms || 0, session.signal));
        const children = await listDirectChildren(subagents, parent.id, session.signal);
        if (!children.some((child) => child.id === args.agent_id)) return errorResult('Result access requires a direct child of this conversation.');
        return resultResponse(await readChildResult(args.agent_id, session.signal, args.wait_ms));
      }
      if (name === 'interrupt_agent') {
        subagents.interrupt(args.agent_id, { kind: 'ancestor', agent: parent });
        return textResult(`Interrupted ${args.agent_id}.`);
      }
      if (typeof args.message !== 'string' || !args.message.trim()) return errorResult('message must be non-empty.');
      const messageId = tasks?.latest(parent.id, args.agent_id)
        ? await tasks.followup(parent, args.agent_id, args.message, session.signal)
        : await subagents.sendMessage(parent, args.agent_id, [{ type: 'text', text: args.message }], { signal: session.signal });
      return textResult(JSON.stringify({ messageId }));
    }
    if (name === 'acp_agents') {
      const agents = listAgents();
      return textResult(JSON.stringify({ agents }), { structuredContent: { agents } });
    }
    if (name === 'acp_delegate') {
      const parent = safeGetService('agents')?.get?.(session.dshSession?.id);
      if (!parent || !session.signal) return errorResult('Delegation requires an active parent conversation.');
      const signal = session.signal;
      const child = await delegate(args, parent, signal);
      if (args.mode === 'wait') return resultResponse(await waitTask(parent, child.taskId, args.timeout_ms ?? 15000, signal));
      if (child.recovered || tasks?.get(parent.id, child.taskId).endedAt) return resultResponse(await tasks.snapshot(parent, child.taskId, true));
      return resultResponse({ subagentId: child.childId, taskId: child.taskId, status: 'running', output: [] });
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
      if (!skill) {
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
        const entry = await fs.lstat(filePath, { cwd: session.cwd });
        if (entry !== undefined && entry.type !== 'file') {
          return errorResult(`Cannot present ${filePath}: not a regular file.`);
        }
        const target = await fs.resolve(filePath, { cwd: session.cwd });
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file') {
          return errorResult(`Cannot present ${filePath}: file not found. Check the path, create the file if needed, and retry.`);
        }
        const canonical = fs.processPath(target);
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
      return {
        status: 200,
        body: { jsonrpc: '2.0', id: message.id ?? null, result: { tools: TOOL_DEFINITIONS } },
      };
    }
    if (method === 'tools/call') {
      try {
        const result = await callTool(message.params?.name, message.params?.arguments ?? {}, session);
        return { status: 200, body: { jsonrpc: '2.0', id: message.id ?? null, result } };
      } catch (err) {
        return {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: message.id ?? null,
            result: { ...errorResult(acpErrorMessage(err)), ...(err?.code === 'ACP_PREPARATION_FAILED' ? {
              structuredContent: { status: 'rejected', failure: { code: err.code, stage: err.stage, message: acpErrorMessage(err), ...(err.availableModels ? { availableModels: err.availableModels } : {}) } },
            } : {}) },
          },
        };
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
