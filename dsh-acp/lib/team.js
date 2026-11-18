/**
 * DSH Agent Teams for configured ACP agents.
 *
 * The host Team service authorizes every operation by the exact live DSH Agent
 * that calls it. Each ACP conversation and delegated child is backed by such an
 * Agent, so the MCP bridge passes that Agent as the caller: claim, ownership,
 * lead-only reassignment and revision checks remain host decisions.
 */

const TEAM_TOOL_NAMES = new Set(['team_task_create', 'team_task_list', 'team_task_get', 'team_task_update']);

/** Model-facing schemas matching the host's native Team tools. */
export const TEAM_TOOLS = [
  {
    name: 'team_task_create',
    description: 'Create one unowned pending task on the shared Team task board.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Concise task title.' },
        description: { type: 'string', description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.' },
      },
      required: ['subject', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'team_task_list',
    description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Optional exact status filter.' },
        owner: { type: 'string', description: 'Optional owner agent name filter; cannot be combined with unowned.' },
        unowned: { type: 'boolean', description: 'Filter tasks by whether they have no owner; cannot be combined with owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'team_task_get',
    description: 'Read the complete latest value of one shared task before changing or executing it.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'Shared task id.' } },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'team_task_update',
    description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Shared task id.' },
        expected_revision: { type: 'integer', description: 'Current task revision used as the CAS precondition.' },
        action: { type: 'string', enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'], description: 'Task transition to apply.' },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Agent name of the root or any continuable descendant for root-only reassign; omit to unassign.' },
      },
      required: ['task_id', 'expected_revision', 'action'],
      additionalProperties: false,
    },
  },
];

/**
 * The host's Team policy, expressed with the tools an ACP agent actually has:
 * teammates are created with acp_delegate and completion wakes the caller.
 */
export const TEAM_GUIDANCE = `Agent Teams is enabled for this conversation. The Team lead and all teammates share one working directory and filesystem; edits are immediately visible to every member. Split write work into disjoint scopes, record expected write_scopes on shared tasks, and use blocked_by when work must be ordered. Write-scope overlap is advisory, not a lock.
Shared-task workflow: team_task_list, team_task_get, team_task_update action "claim" with the current revision, do the work, then team_task_update action "complete". A teammate claims ready tasks itself; only the lead (name "lead") reassigns. Use names returned by list_agents as owner and as send_message targets. Task readiness never starts an owner and task changes wake nobody: use send_message when another member must act.
As lead, create teammates with acp_delegate and a short name (they become lead/<name>), tell each teammate which task ids to take, and wait for required teammates before giving the final answer; their completion wakes you automatically.`;

export function isTeamTool(name) {
  return TEAM_TOOL_NAMES.has(name);
}

function service(ctx, name) {
  try {
    const value = typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
    return value ?? ctx?.[name];
  } catch {
    return undefined;
  }
}

/** Whether the host mounts the Team domain at all. */
export function teamAvailable(ctx) {
  return typeof service(ctx, 'agentTeams')?.isEnabled === 'function';
}

/**
 * Whether the caller's subagent tree has Team mode enabled. An independently
 * resumed child without a live root has no Team mode, matching the host tools.
 */
export function teamEnabled(ctx, agent) {
  const teams = service(ctx, 'agentTeams');
  if (!agent || typeof teams?.isEnabled !== 'function') return false;
  try {
    return teams.isEnabled(agent) === true;
  } catch (error) {
    if (error?.code === 'UNAUTHORIZED') return false;
    throw error;
  }
}

/** Present a task as the host tools do: the owner's Session id becomes its agent name. */
function named({ ownerId, ownerName, ...task }) {
  return ownerId === undefined ? task : { ...task, owner: ownerName ?? ownerId };
}

const stringList = (value, field) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${field} must be an array of strings.`);
  return value;
};

async function createTeamTask(teams, args, caller, signal) {
  if (typeof args.subject !== 'string' || typeof args.description !== 'string') throw new Error('subject and description are required.');
  const blockedBy = stringList(args.blocked_by, 'blocked_by');
  const writeScopes = stringList(args.write_scopes, 'write_scopes');
  return named(await teams.createTask(caller, {
    subject: args.subject, description: args.description,
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(writeScopes === undefined ? {} : { writeScopes }),
  }, signal));
}

async function listTeamTasks(teams, resolve, args, caller) {
  const cursor = args.cursor ?? 0;
  const limit = args.limit ?? 50;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100');
  if (args.owner !== undefined && args.unowned !== undefined) throw new Error('owner and unowned filters cannot be combined');
  const owner = args.owner === undefined ? undefined : await resolve(args.owner);
  const filtered = teams.listTasks(caller).filter((task) =>
    (args.status === undefined || task.status === args.status)
    && (owner === undefined || task.ownerId === owner)
    && (args.unowned === undefined || (task.ownerId === undefined) === args.unowned)
    && (args.ready === undefined || task.ready === args.ready));
  return {
    tasks: filtered.slice(cursor, cursor + limit).map(named),
    ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
  };
}

async function updateTeamTask(teams, resolve, args, caller, signal) {
  if (typeof args.task_id !== 'string' || !args.task_id) throw new Error('task_id is required.');
  if (!Number.isSafeInteger(args.expected_revision)) throw new Error('expected_revision must be an integer.');
  if (typeof args.action !== 'string') throw new Error('action is required.');
  const blockedBy = stringList(args.blocked_by, 'blocked_by');
  const writeScopes = stringList(args.write_scopes, 'write_scopes');
  return named(await teams.updateTask(caller, {
    taskId: args.task_id,
    expectedRevision: args.expected_revision,
    action: args.action,
    ...(args.subject === undefined ? {} : { subject: args.subject }),
    ...(args.description === undefined ? {} : { description: args.description }),
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(writeScopes === undefined ? {} : { writeScopes }),
    ...(args.owner === undefined ? {} : { owner: await resolve(args.owner) }),
  }, signal));
}

/**
 * Execute one Team tool for an exact live caller.
 * @returns the same value the host's native tool returns.
 */
export async function executeTeamTool(ctx, name, args, caller, signal) {
  const teams = service(ctx, 'agentTeams');
  const subagents = service(ctx, 'subagents');
  if (!teamAvailable(ctx)) throw new Error('Agent Teams is not available in this host.');
  if (!teamEnabled(ctx, caller)) throw new Error('Agent Teams is turned off for this conversation. The user can enable "Use Agent Teams" in the root conversation\'s model menu.');
  const resolve = (agentName) => subagents.resolveName(caller, agentName, signal);
  if (name === 'team_task_create') return createTeamTask(teams, args, caller, signal);
  if (name === 'team_task_list') return listTeamTasks(teams, resolve, args, caller);
  if (name === 'team_task_get') {
    if (typeof args.task_id !== 'string' || !args.task_id) throw new Error('task_id is required.');
    return named(teams.getTask(caller, args.task_id));
  }
  if (name === 'team_task_update') return updateTeamTask(teams, resolve, args, caller, signal);
  throw new Error(`Unknown Team tool "${name}".`);
}

/**
 * List the caller's whole subagent tree as the host's list_agents does: the
 * root as "lead" and every continuable descendant by its path name.
 */
export async function listTeamMembers(ctx, caller, signal) {
  const subagents = service(ctx, 'subagents');
  const agents = service(ctx, 'agents');
  const root = subagents.rootOf(caller);
  const statusOf = (id) => agents?.get(id)?.status === 'running' ? 'running' : 'inactive';
  const rows = await subagents.listDescendants(root.id, signal);
  return [
    { name: 'lead', id: root.id, status: statusOf(root.id), description: 'root agent', ...(root.id === caller.id ? { self: true } : {}) },
    ...rows.flatMap((row) => {
      const name = row.path ?? row.id;
      if (row.kind === 'diagnostic') return [{ name, id: row.id, status: row.reason }];
      if (row.mode !== 'continuable') return [];
      return [{ name, id: row.id, status: statusOf(row.id), ...(row.label ? { description: row.label } : {}), ...(row.id === caller.id ? { self: true } : {}) }];
    }),
  ];
}
