import { confirmModelAction, DECLINED_TEXT } from './desktop-confirm.js';

/** Configured external agents share the host's managed child lifecycle. */
export const DELEGATION_PROVIDER = 'configured-acp';

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
        description: { type: 'string', description: 'Short task label.' },
        name: { type: 'string', description: 'Optional child name, unique among your children: 1-32 lower-case letters, digits or hyphens, starting with a letter (not "lead"). Teammates are addressed as lead/<name>.' },
        model: { type: 'string', description: 'Optional model id; omit for the configured agent default.' },
        reasoning_effort: { type: 'string', description: 'Optional reasoning effort id.' },
        client_request_id: { type: 'string', description: 'Stable id for safe retries; reuse only for identical arguments.' },
        mode: { type: 'string', enum: ['async', 'wait'], description: 'Default async. A bounded wait still arranges automatic completion delivery.' },
        timeout_ms: { type: 'integer', minimum: 0, maximum: 20000 },
        isolation: { type: 'string', enum: ['shared', 'worktree'], description: 'Shared cwd by default. Worktree creates a retained checkout from committed HEAD; uncommitted changes are not copied.' },
        interaction_mode: { type: 'string', enum: ['default', 'plan'] },
        runtime_mode: { type: 'string', enum: ['inherit', 'read-only', 'approval-required'], description: 'Inherit the host policy, or restrict it further. Cannot grant extra permissions.' },
        options: { type: 'array', description: 'Exact settings discovered in the selected model options.', items: { type: 'object', properties: { id: { type: 'string' }, value: { type: ['string', 'boolean'] } }, required: ['id', 'value'], additionalProperties: false } },
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
        wait_ms: { type: 'integer', minimum: 0, maximum: 20000 },
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

/** Host tools declare per-parameter `required`; MCP uses a JSON Schema `required` list. */
function hostParameters(inputSchema) {
  const required = new Set(inputSchema.required || []);
  return Object.fromEntries(Object.entries(inputSchema.properties).map(([name, schema]) => [
    name, { ...schema, ...(required.has(name) ? { required: true } : {}) },
  ]));
}

export function registerDelegation(ctx, manager) {
  ctx.effect(() => ctx.subagents.registerProvider({
    name: DELEGATION_PROVIDER,
    capabilities: { agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: true },
    inheritsParentContext: false,
    prepareContinuable: async () => ({}),
  }));
  const handlers = {
    acp_agents: () => ({ agents: manager.listDelegationAgents() }),
    async acp_delegate(args, exec) {
      const confirmation = await confirmModelAction({
        tool: 'acp_delegate',
        action: 'delegate',
        effect: 'code',
        summary: `在已配置代理 ${String(args.agent ?? '?')} 上启动一个可以执行命令的子任务`,
        details: String(args.prompt ?? '').slice(0, 2000),
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
    ctx.effect(() => ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: hostParameters(tool.inputSchema),
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
      },
      isConcurrencySafe: () => true,
      execute: (args, exec) => handlers[tool.name](args, exec),
    }));
  }
}
