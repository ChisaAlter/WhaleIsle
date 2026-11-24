import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmModelAction, DECLINED_TEXT } from './desktop-confirm.js';
import { resolveDelegationCwd } from './delegate-cwd.js';

/** Configured external agents share the host's managed child lifecycle. */
export const DELEGATION_PROVIDER = 'configured-acp';

function loadDefineTool() {
  const here = fileURLToPath(import.meta.url);
  const anchors = [];
  for (const root of [process.env.DSH_HARNESS_ROOT, process.env.DSH_INSTALLED_HOST_ROOT]) {
    if (!root) continue;
    anchors.push(path.join(root, 'package.json'));
    anchors.push(path.join(root, 'apps', 'cli', 'package.json'));
    anchors.push(path.join(root, 'packages', 'core', 'tools', 'package.json'));
  }
  if (process.argv[1]) anchors.push(path.resolve(process.argv[1]));
  anchors.push(here);
  const repoRoots = [path.resolve(path.dirname(here), '..', '..')];
  let cursor = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    repoRoots.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const root of repoRoots) {
    anchors.push(path.join(root, 'package.json'));
    anchors.push(path.join(root, 'vendor', 'deepseek-harness', 'apps', 'cli', 'package.json'));
    anchors.push(path.join(root, 'vendor', 'deepseek-harness', 'packages', 'core', 'tools', 'package.json'));
  }
  for (const anchor of anchors) {
    if (!existsSync(anchor)) continue;
    try {
      const mod = createRequire(anchor)('@deepseek-ai/dsh-tools');
      if (typeof mod?.defineTool === 'function') return mod.defineTool;
    } catch {
      // Try next resolution anchor.
    }
  }
  for (const root of repoRoots) {
    const directEntry = path.join(root, 'vendor', 'deepseek-harness', 'packages', 'core', 'tools', 'lib', 'index.js');
    if (existsSync(directEntry)) {
      const mod = createRequire(here)(directEntry);
      if (typeof mod?.defineTool === 'function') return mod.defineTool;
    }
  }
  throw new Error('Cannot resolve @deepseek-ai/dsh-tools defineTool');
}

export const AGENT_TOOLS = [
  {
    name: 'acp_agents',
    description: 'List configured, enabled coding agents and their model ids. Use an agent id with acp_delegate; this does not change the current agent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'acp_delegate',
    description: 'Start a background task on a configured coding agent in its own child session. Include all necessary context. The child shares the working directory, not this conversation. Use exact agent and model ids returned by acp_agents; omit model for the configured default. Connection, authentication and requested model/settings are validated before a task is dispatched; preparation may take time. A rejected preparation starts no child task. Never weaken runtime_mode to retry a model, authentication or network error. Returns subagentId after acceptance. Completion automatically delivers the result and wakes this conversation. Follow next: end your turn when waiting for the child; do not poll acp_result, list_agents, sleep, or launch a duplicate. Report actual errors without silently changing models.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Configured agent instance id from acp_agents.' },
        prompt: { type: 'string', description: 'Complete task and context for the child.' },
        cwd: { type: 'string', description: 'Optional absolute target working directory. Required when delegating from whale-girl; must be an existing directory outside $DSH_HOME and data/whale.' },
        description: { type: 'string', description: 'Short task label.' },
        name: { type: 'string', description: 'Optional child name, unique among your children: 1-32 lower-case letters, digits or hyphens, starting with a letter (not "lead"). Teammates are addressed as lead/<name>.' },
        model: { type: 'string', description: 'Optional model id; omit for the configured agent default.' },
        reasoning_effort: { type: 'string', description: 'Optional reasoning effort id.' },
        client_request_id: { type: 'string', description: 'Stable id for safe retries; reuse only for identical arguments.' },
        mode: { type: 'string', enum: ['async', 'wait'], description: 'Default async. A bounded wait still arranges automatic completion delivery.' },
        timeout_ms: { type: 'integer' },
        isolation: { type: 'string', enum: ['shared', 'worktree'], description: 'Shared cwd by default. Worktree creates a retained checkout from committed HEAD; uncommitted changes are not copied.' },
        interaction_mode: { type: 'string', enum: ['default', 'plan'] },
        runtime_mode: { type: 'string', enum: ['inherit', 'read-only', 'approval-required'], description: 'Inherit the host policy, or restrict it further. Cannot grant extra permissions.' },
        options: { type: 'array', description: 'Exact settings discovered in the selected model options.', items: { type: 'object', properties: { id: { type: 'string' }, value: { oneOf: [{ type: 'string' }, { type: 'boolean' }] } }, required: ['id', 'value'], additionalProperties: false } },
      },
      required: ['agent', 'prompt'],
      additionalProperties: false,
    },
  },
];

/** Task control shared by the host tools and the MCP bridge: one schema, one validation. */
export const CONTROL_TOOLS = [
  {
    name: 'acp_cancel',
    description: 'Cancel a direct child task, clear queued work, stop descendants, and suppress its completion wake. Completed output remains readable. Use interrupt_agent only to pause the current execution while retaining queued work.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string', description: 'Task identity returned by acp_delegate.' } }, required: ['task_id'], additionalProperties: false },
  },
  {
    name: 'acp_result',
    description: 'Read the state and output of a direct child task after its completion wakes you, or when the user requests status. Do not poll a running child: completion automatically delivers its result and wakes this conversation. Earlier tasks remain readable by task_id. Provide task_id (preferred) or agent_id (selects that child\'s latest task). Optional wait_ms (up to 20000) waits for completion.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Exact task identity; preferred to the compatibility child-session id.' },
        agent_id: { type: 'string', description: 'Child session id; selects its latest task.' },
        wait_ms: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
];

/** Validate acp_result arguments; returns the requested id and bounded wait. */
export function resultRequest(args = {}) {
  const id = args.task_id || args.agent_id;
  if (typeof id !== 'string' || !id) throw new Error('acp_result requires task_id or agent_id.');
  if (args.wait_ms !== undefined && (!Number.isInteger(args.wait_ms) || args.wait_ms < 0 || args.wait_ms > 20000)) throw new Error('wait_ms must be an integer from 0 to 20000.');
  return { id, waitMs: args.wait_ms || 0 };
}

/** Convert an MCP JSON Schema property map into the dsh-tools ParameterSchemaSpec DSL. */
function hostParameters(inputSchema) {
  const convertPropertyMap = (properties, requiredList) => {
    const required = new Set(requiredList || []);
    return Object.fromEntries(Object.entries(properties || {}).map(([name, schema]) => {
      const next = convertNode(schema);
      if (required.has(name)) next.required = true;
      return [name, next];
    }));
  };
  const convertNode = (schema) => {
    const copy = { ...schema };
    delete copy.minimum;
    delete copy.maximum;
    if (copy.type === 'object' && copy.properties) {
      const req = copy.required;
      delete copy.required;
      copy.properties = convertPropertyMap(copy.properties, req);
    } else if (copy.type === 'array' && copy.items) {
      copy.items = convertNode(copy.items);
    } else if (Array.isArray(copy.oneOf)) {
      copy.oneOf = copy.oneOf.map(convertNode);
    }
    return copy;
  };
  return convertPropertyMap(inputSchema.properties, inputSchema.required);
}

export function registerDelegation(ctx, manager) {
  const defineTool = loadDefineTool();
  ctx.effect(() => ctx.subagents.registerProvider({
    name: DELEGATION_PROVIDER,
    capabilities: { agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: true },
    inheritsParentContext: false,
    prepareContinuable: async () => ({}),
  }));
  const handlers = {
    acp_agents: () => ({ agents: manager.listDelegationAgents() }),
    async acp_delegate(args, exec) {
      if (args.timeout_ms !== undefined && (!Number.isInteger(args.timeout_ms) || args.timeout_ms < 0 || args.timeout_ms > 20000)) {
        throw new Error('timeout_ms must be an integer from 0 to 20000.');
      }
      const resolvedCwd = resolveDelegationCwd(args, exec.agent);
      const hasExplicitCwd = typeof args.cwd === 'string' && args.cwd.trim() !== '';
      const targetCwd = hasExplicitCwd ? resolvedCwd : '';
      const confirmation = await confirmModelAction({
        tool: 'acp_delegate',
        action: 'delegate',
        effect: 'code',
        summary: `在已配置代理 ${String(args.agent ?? '?')} 上启动一个可以执行命令的子任务${targetCwd ? `（目录：${targetCwd}）` : ''}`,
        details: `${targetCwd ? `目标目录：${targetCwd}\n\n` : ''}${String(args.prompt ?? '').slice(0, 2000)}`,
      });
      if (confirmation.ok !== true) throw new Error(DECLINED_TEXT);
      const child = await manager.delegate(args, exec.agent, exec.signal, 'parent', ctx.subagents);
      if (args.mode === 'wait') return manager.waitTask(exec.agent, child.taskId, args.timeout_ms ?? 15000, exec.signal);
      if (child.recovered || manager.tasks.get(exec.agent.id, child.taskId).endedAt) return manager.tasks.snapshot(exec.agent, child.taskId, true);
      return { kind: 'activation', subagentId: child.childId, ...(child.name ? { name: child.name } : {}), taskId: child.taskId, status: 'running', next: 'Completion wakes this conversation. End your turn; do not poll.' };
    },
    acp_cancel: (args, exec) => manager.tasks.cancel(exec.agent, args.task_id),
    acp_result(args, exec) {
      const { id, waitMs } = resultRequest(args);
      return manager.waitTask(exec.agent, manager.tasks.get(exec.agent.id, id).taskId, waitMs, exec.signal);
    },
  };
  for (const tool of [...AGENT_TOOLS, ...CONTROL_TOOLS]) {
    ctx.effect(() => ctx.tools.register(defineTool({
      name: tool.name,
      description: tool.description,
      parameters: hostParameters(tool.inputSchema),
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
      },
      isConcurrencySafe: () => true,
      execute: (args, exec) => handlers[tool.name](args, exec),
    })));
  }
}
