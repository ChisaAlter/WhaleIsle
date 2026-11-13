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

export function registerDelegation(ctx, manager) {
  ctx.effect(() => ctx.subagents.registerProvider({
    name: DELEGATION_PROVIDER,
    capabilities: { agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: true },
    inheritsParentContext: false,
    prepareContinuable: async () => ({}),
  }));
  for (const tool of AGENT_TOOLS) {
    const required = new Set(tool.inputSchema.required || []);
    ctx.effect(() => ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([name, schema]) => [
        name, { ...schema, ...(required.has(name) ? { required: true } : {}) },
      ])),
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (tool.name === 'acp_agents') return { agents: manager.listDelegationAgents() };
        const child = await manager.delegate(args, exec.agent, exec.signal, 'parent', ctx.subagents);
        if (args.mode === 'wait') return manager.waitTask(exec.agent, child.taskId, args.timeout_ms ?? 15000, exec.signal);
        if (child.recovered || manager.tasks.get(exec.agent.id, child.taskId).endedAt) return manager.tasks.snapshot(exec.agent, child.taskId, true);
        return { kind: 'activation', subagentId: child.childId, taskId: child.taskId, status: 'running', next: 'Completion wakes this conversation. End your turn; do not poll.' };
      },
    }));
  }
  for (const definition of [
    { name: 'acp_cancel', description: 'Cancel a configured-agent task, its queued work and descendants. Suppress its completion wake; retain its output.', parameters: { task_id: { type: 'string', required: true } },
      run: (args, exec) => manager.tasks.cancel(exec.agent, args.task_id) },
    { name: 'acp_result', description: 'Read a configured-agent task after completion wakes you, or when the user asks for status. Do not poll running tasks.', parameters: { task_id: { type: 'string', required: true } },
      run: (args, exec) => manager.tasks.snapshot(exec.agent, args.task_id, true) },
  ]) ctx.effect(() => ctx.tools.register({ ...definition, output: { schema: { type: 'object', additionalProperties: true }, render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] }, isConcurrencySafe: () => true,
    execute: definition.run }));
}
