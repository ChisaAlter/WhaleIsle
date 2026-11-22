/**
 * Registers the 8 agent tools for Projects:
 *   projects_list, projects_create, projects_update, projects_get,
 *   projects_add_task, projects_update_task, projects_memory, projects_dispatch
 *
 * NOTE: `src/main/model-tool-effects.test.js` statically scans every `name: '...'`
 * literal in files containing `tools.register`. Keep ONLY the 8 tool names as
 * `name: '...'` literals in this module.
 */
import { memoryIndex, memoryNameOrThrow, searchMemory } from './memory.js';
import {
  MAX_DEPENDS_ON,
  MAX_NOTE,
  MEMORY_BUDGET,
  MEMORY_BUDGET_MAX,
  MEMORY_BUDGET_MIN,
  MEMORY_INDEX_TOOL_LIMIT,
  STATUSES,
  counts,
  formatCounts,
  memoryBudgetOf,
  text,
} from './schema.js';

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
};

function formatCompaction(project) {
  const last = project.lastCompaction;
  if (!last || !last.at) return '';
  return ` · last compaction ${last.before} → ${last.after} characters at ${new Date(last.at).toISOString()}`;
}

function formatTaskLine(task) {
  const worker = task.childName ? ` worker=${task.childName}` : '';
  const model = task.model ? ` model=${task.model}` : '';
  const effort = task.reasoningEffort ? ` effort=${task.reasoningEffort}` : '';
  const preset = task.agentPreset ? ` preset=${task.agentPreset}` : '';
  const deps = task.dependsOn.length > 0 ? ` deps: ${task.dependsOn.length}` : '';
  let worktree = '';
  if (task.worktreePath) worktree = ` worktree=${task.worktreePath} branch=${task.branch || '(unknown)'}`;
  else if (task.worktreeDegraded) worktree = ` worktree=off(${task.worktreeDegraded})`;
  const out = [
    `- ${task.id} [${task.status}]${task.approved ? ' approved' : ''}${worker}${model}${effort}${preset}${deps}${worktree} ${task.title}`,
  ];
  if (task.worktreeNote) out.push(`    worktree: ${task.worktreeNote}`);
  if (task.output) out.push(`    output: ${task.output.replace(/\n+/g, ' ').slice(0, 300)}`);
  return out;
}

export function formatProject(project, memoryFiles, options = {}) {
  const includeResolved = options.includeResolved === true;
  const tally = counts(project.tasks);
  const tasks = includeResolved
    ? project.tasks
    : project.tasks.filter((task) => task.status !== 'resolved');
  const hidden = project.tasks.length - tasks.length;
  const flags = [
    `autonomy: ${project.autonomy}`,
    `concurrency: ${project.concurrency}`,
    ...(project.paused ? ['PAUSED'] : []),
    ...(project.worktreeIsolation ? ['worktree isolation: on'] : []),
    ...(project.archived ? ['ARCHIVED'] : []),
  ].join(', ');
  const routeParts = [
    `worker model: ${project.model || '(host default)'}`,
    ...(project.reasoningEffort ? [`effort: ${project.reasoningEffort}`] : []),
    ...(project.agentPreset ? [`preset: ${project.agentPreset}`] : []),
  ].join(', ');
  const lines = [
    `Project ${project.id} — ${project.name}`,
    `workspace: ${project.workspace || '(inherited)'}`,
    flags,
    routeParts,
    `memory: budget ${memoryBudgetOf(project)}, auto-compaction ${project.autoCompact === false ? 'off' : 'on'}${formatCompaction(project)}`,
    '',
    '## Instructions',
    (project.goal || '').trim() || '(none)',
    '',
    `## Tasks (${hidden > 0 ? `${tasks.length} of ${project.tasks.length}` : project.tasks.length})`,
    `counts: ${formatCounts(tally)}`,
  ];
  if (hidden > 0) {
    lines.push(`${hidden} resolved task(s) hidden — pass include_resolved: true to list them with their output.`);
  }
  if (tasks.length === 0) lines.push(hidden > 0 ? '(no open tasks)' : '(none)');
  for (const task of tasks) lines.push(...formatTaskLine(task));
  lines.push(
    '',
    '## Shared memory',
    memoryFiles.length > 0 ? memoryIndex(memoryFiles, MEMORY_INDEX_TOOL_LIMIT) : '(empty)',
  );
  return lines.join('\n');
}

function pickDefined(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

const PROJECT_PATCH_KEYS = [
  'name', 'goal', 'workspace', 'autonomy', 'concurrency',
  'paused', 'autoCompact', 'memoryBudget', 'worktreeIsolation',
];
const TASK_PATCH_KEYS = ['status', 'output', 'approved', 'model', 'reasoningEffort', 'agentPreset'];

async function readMemoryEntry(service, project, targetArg) {
  if (!targetArg) return service.memory.memoryIndexForTool(project);
  const found = await service.memory.readMemoryFile(project.id, targetArg);
  if (!found) {
    const files = await service.memory.readMemoryFiles(project.id);
    throw new Error(
      `No memory file matches "${targetArg}". Files: ${files.map((file) => file.name).join(' | ') || '(none)'}. Archived files are readable too (memory/archive/).`,
    );
  }
  const note = found.archived
    ? '\n\n(Archived: compaction moved this file into memory/archive/. It is no longer part of the live memory injected into workers.)'
    : '';
  return `${found.file.body || '(empty file)'}${note}`;
}

async function mutateMemoryEntry(service, project, action, targetArg, args) {
  const slug = memoryNameOrThrow(targetArg);
  const value = typeof args?.text === 'string' ? args.text.trim() : '';
  if (!value) throw new Error('text is required for append or write');
  const payload = { description: args?.description, type: args?.type, text: value };
  payload.name = slug;
  if (action === 'write') {
    const written = await service.memory.writeMemoryFile(project.id, payload);
    return `Replaced memory file "${written.file.name}" (${written.file.chars} characters).${await service.memory.afterMemoryWrite(project, written)}`;
  }
  const written = await service.memory.appendMemoryFile(project.id, payload);
  return `Appended ${value.length} characters to memory file "${written.file.name}" (${written.file.chars} characters).${await service.memory.afterMemoryWrite(project, written)}`;
}

async function executeMemoryTool(service, args) {
  const project = await service.readProject(String(args?.project_id || ''));
  const action = args?.action || 'read';
  const targetArg = memoryTargetArg(args);
  if (action === 'index') return service.memory.memoryIndexForTool(project);
  if (action === 'search') {
    return searchMemory(await service.memory.readMemoryFiles(project.id), args?.query);
  }
  if (action === 'read') return readMemoryEntry(service, project, targetArg);
  if (action === 'delete') {
    const slug = memoryNameOrThrow(targetArg);
    const deleted = await service.memory.deleteMemoryFile(project.id, slug);
    return `Deleted memory file "${deleted.file.name}" (${deleted.file.chars} characters). The memory now has ${deleted.count} file(s), ${deleted.total} characters.`;
  }
  return mutateMemoryEntry(service, project, action, targetArg, args);
}

function memoryTargetArg(args) {
  const primary = typeof args?.name === 'string' ? args.name.trim() : '';
  if (primary) return primary;
  return typeof args?.section === 'string' ? args.section.trim() : '';
}

export function registerProjectTools(ctx, service) {
  const register = (definition) => {
    ctx.tools.register(definition);
  };

  register({
    name: 'projects_list',
    description:
      'List WhaleIsle projects with their task counts. A project holds one goal, standing instructions, a workspace, shared memory, and a task board. Use this to find project_id before calling other projects_* tools.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: TEXT_OUTPUT,
    execute: async () => {
      const projects = await service.listProjects();
      if (projects.length === 0) return 'No projects yet. Create one with projects_create.';
      return projects
        .map((project) => {
          const tally = counts(project.tasks);
          return `- ${project.id}  "${project.name}"  autonomy=${project.autonomy} concurrency=${project.concurrency}${project.paused ? ' paused' : ''}${project.worktreeIsolation ? ' worktree=on' : ''}${project.model ? ` model=${project.model}` : ''}${project.reasoningEffort ? ` effort=${project.reasoningEffort}` : ''}${project.archived ? ' archived' : ''}  tasks: ${formatCounts(tally)}`;
        })
        .join('\n');
    },
  });

  register({
    name: 'projects_create',
    description:
      'Create a project: one goal, standing instructions, optional workspace directory, autonomy mode, worker concurrency limit, and optional default worker model/effort/preset.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short project name.' },
        goal: {
          type: 'string',
          description: 'Standing instructions every worker receives: goal, constraints, conventions (up to 16000 chars).',
        },
        workspace: {
          type: 'string',
          description: 'Absolute directory workers run in. Omit to inherit the coordinator session directory.',
        },
        autonomy: {
          type: 'string',
          enum: ['manual', 'auto'],
          description: 'manual (default): tasks need human approval before dispatch. auto: coordinator dispatches without waiting.',
        },
        concurrency: { type: 'integer', description: 'Maximum concurrent workers, 1-8; defaults to 3.' },
        paused: { type: 'boolean', description: 'Pause dispatching for this project. Defaults to false.' },
        model: {
          type: 'string',
          description: 'Default worker model route ("provider/model" or bare model id). Empty inherits host default.',
        },
        reasoningEffort: {
          type: 'string',
          description: 'Default worker reasoning effort id advertised by GET /projects-api/models. Empty follows provider default.',
        },
        agentPreset: {
          type: 'string',
          description: 'Default worker agent preset id. Empty inherits parent composition.',
        },
        autoCompact: {
          type: 'boolean',
          description: 'Compact shared memory automatically when exceeding memoryBudget. Defaults to true.',
        },
        memoryBudget: {
          type: 'integer',
          description: `Shared memory size triggering auto-compaction (${MEMORY_BUDGET_MIN}-${MEMORY_BUDGET_MAX}; default ${MEMORY_BUDGET}).`,
        },
        worktreeIsolation: {
          type: 'boolean',
          description: 'Give each task its own git worktree and branch when workspace is a git repository. Defaults to false.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const project = await service.createProject(args);
      return `Created project ${project.id} "${project.name}". autonomy=${project.autonomy} concurrency=${project.concurrency} paused=${project.paused} worktreeIsolation=${project.worktreeIsolation ? 'on' : 'off'}.`;
    },
  });

  register({
    name: 'projects_update',
    description:
      'Update a project settings: name, goal, workspace, autonomy, concurrency, paused state, memory compaction settings, or worktreeIsolation. Task state is managed with projects_update_task.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project id.' },
        name: { type: 'string', description: 'Short project name.' },
        goal: { type: 'string', description: 'Standing instructions every worker receives (up to 16000 chars).' },
        workspace: { type: 'string', description: 'Absolute directory workers run in. Empty inherits coordinator directory.' },
        autonomy: {
          type: 'string',
          enum: ['manual', 'auto'],
          description: 'manual: tasks require approval before dispatch. auto: dispatch without waiting.',
        },
        concurrency: { type: 'integer', description: 'Maximum concurrent workers, 1-8.' },
        paused: { type: 'boolean', description: 'Pause or resume worker dispatching for this project.' },
        autoCompact: { type: 'boolean', description: 'Enable or disable automatic shared memory compaction.' },
        memoryBudget: {
          type: 'integer',
          description: `Shared memory budget (${MEMORY_BUDGET_MIN}-${MEMORY_BUDGET_MAX}).`,
        },
        worktreeIsolation: {
          type: 'boolean',
          description: 'Enable or disable per-task isolated git worktrees.',
        },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const patch = pickDefined(args, PROJECT_PATCH_KEYS);
      const { project } = await service.updateProject(String(args?.project_id || ''), patch);
      return `Updated project ${project.id} "${project.name}". autonomy=${project.autonomy} concurrency=${project.concurrency} paused=${project.paused} memory=${memoryBudgetOf(project)} autoCompact=${project.autoCompact !== false} worktreeIsolation=${project.worktreeIsolation ? 'on' : 'off'}${formatCompaction(project)}.`;
    },
  });

  register({
    name: 'projects_get',
    description:
      'Read one project: instructions, workspace, autonomy, open tasks (with status and output), full status counts, and the shared memory index (titles and sizes, never full text). Pass include_resolved: true to list resolved tasks as well.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project id from projects_list.' },
        include_resolved: {
          type: 'boolean',
          description: 'Include tasks already accepted as status "resolved". Defaults to false.',
        },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const project = await service.readProject(String(args?.project_id || ''));
      const memoryFiles = await service.memory.readMemoryFiles(project.id);
      return formatProject(project, memoryFiles, { includeResolved: args?.include_resolved === true });
    },
  });

  register({
    name: 'projects_add_task',
    description:
      'Add one task to a project board. Each task should be independently finishable by one worker; use depends_on when ordering is required.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project id.' },
        title: { type: 'string', description: 'One-line task title.' },
        brief: {
          type: 'string',
          description: 'What the worker must do, constraints, and concrete verification criteria.',
        },
        approved: {
          type: 'boolean',
          description: 'For autonomy=manual: set true only when the user already approved this task in chat.',
        },
        depends_on: {
          type: 'array',
          items: { type: 'string' },
          description: `Task ids that must be resolved before this task can dispatch (at most ${MAX_DEPENDS_ON}).`,
        },
        model: { type: 'string', description: 'Optional per-task model override.' },
        reasoningEffort: { type: 'string', description: 'Optional per-task reasoning effort override.' },
        agentPreset: { type: 'string', description: 'Optional per-task agent preset override.' },
      },
      required: ['project_id', 'title'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const { task } = await service.addTask(String(args?.project_id || ''), {
        ...args,
        dependsOn: args?.depends_on,
      });
      return `Added task ${task.id} "${task.title}" to project ${args.project_id} (status queued).`;
    },
  });

  register({
    name: 'projects_update_task',
    description:
      'Update a task: status, recorded output, approval flag, model/effort/preset overrides, or append_brief (queues a follow-up paragraph for the next dispatch without changing status). Set status "resolved" only when relaying the human acceptance verdict.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project id.' },
        task_id: { type: 'string', description: 'Task id from projects_get.' },
        status: {
          type: 'string',
          enum: STATUSES,
          description: 'New status: queued, running, review, failed, blocked, or resolved.',
        },
        output: { type: 'string', description: 'Summary recorded on the task (up to 4000 chars).' },
        approved: { type: 'boolean', description: 'Approval flag for autonomy=manual projects.' },
        append_brief: {
          type: 'string',
          description: 'Append a follow-up paragraph to the brief and queue it for the next worker dispatch.',
        },
        model: { type: 'string', description: 'Per-task model override. Empty clears to project default.' },
        reasoningEffort: { type: 'string', description: 'Per-task reasoning effort override. Empty clears to project default.' },
        agentPreset: { type: 'string', description: 'Per-task agent preset override. Empty clears to project default.' },
      },
      required: ['project_id', 'task_id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      const patch = pickDefined(args, TASK_PATCH_KEYS);
      if (args?.append_brief !== undefined) patch.appendBrief = args.append_brief;
      const { task } = await service.updateTask(String(args?.project_id || ''), String(args?.task_id || ''), patch);
      const route = task.model ? ` model=${task.model}` : '';
      const effort = task.reasoningEffort ? ` effort=${task.reasoningEffort}` : '';
      const brief = args?.append_brief === undefined ? '' : ` brief=${task.brief.length} characters`;
      return `Task ${task.id} is now ${task.status}${task.approved ? ' (approved)' : ''}${route}${effort}${brief}.`;
    },
  });

  register({
    name: 'projects_memory',
    description:
      'Read, search, write, append, or delete per-topic shared memory files of a project. Use action "index" to list topics, "search" with query to locate topics without loading bodies, "read" with topic name to read one file, "append"/"write" to save durable findings, or "delete" to remove a topic.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project id.' },
        action: {
          type: 'string',
          enum: ['index', 'read', 'search', 'append', 'write', 'delete'],
          description: 'Operation to perform (defaults to "read").',
        },
        name: {
          type: 'string',
          description: 'Topic file slug (e.g. "deployment-notes", ".md" optional). Required for append, write, delete.',
        },
        description: {
          type: 'string',
          description: 'One-line description stored in frontmatter for append/write.',
        },
        type: {
          type: 'string',
          description: 'Frontmatter type for append/write; defaults to "reference".',
        },
        query: {
          type: 'string',
          description: 'Keyword for action "search" (case-insensitive across topic names, descriptions, and bodies).',
        },
        text: { type: 'string', description: 'Markdown body text for append or write.' },
        section: {
          type: 'string',
          description: 'Deprecated alias for topic name.',
        },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (args) => executeMemoryTool(service, args),
  });

  register({
    name: 'projects_dispatch',
    description:
      'Dispatch a task to a worker subagent. If the task already ran, continues its existing worker session (preserving context) unless model/preset/effort changed; otherwise starts a fresh worker. Returns immediately so the coordinator stays responsive.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project id.' },
        task_id: { type: 'string', description: 'Task id to dispatch.' },
        note: {
          type: 'string',
          description: 'Optional follow-up instruction for this dispatch (up to 4000 chars).',
        },
      },
      required: ['project_id', 'task_id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) =>
      service.dispatchTask(
        String(args?.project_id || ''),
        String(args?.task_id || ''),
        exec,
        text(args?.note, MAX_NOTE).trim(),
      ),
  });
}
