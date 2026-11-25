/**
 * Registers the 8 agent tools for Projects:
 *   projects_list, projects_create, projects_update, projects_get,
 *   projects_add_task, projects_update_task, projects_memory, projects_dispatch
 *
 * NOTE: `src/main/model-tool-effects.test.js` statically scans every `name: '...'`
 * literal in files containing `tools.register` or `defineTool`. Keep ONLY the 8
 * tool names as `name: '...'` literals in this module.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { memoryIndex, memoryNameOrThrow, searchMemory } from './memory.js';
import {
  MAX_DEPENDS_ON,
  MAX_NOTE,
  MEMORY_BUDGET,
  MEMORY_BUDGET_MAX,
  MEMORY_BUDGET_MIN,
  MEMORY_INDEX_TOOL_LIMIT,
  SCOPE_CEILINGS,
  STATUSES,
  counts,
  formatCounts,
  memoryBudgetOf,
  text,
} from './schema.js';
import { clampTaskScope, resolveActiveHandoffScope } from './scope-guard.js';

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
};

function genericCall(title, kind, summary = '') {
  return {
    card: 'generic',
    title,
    kind,
    ...(summary ? { content: [{ type: 'text', text: summary }] } : {}),
  };
}

function genericResult(title, result) {
  return {
    card: 'generic',
    title: result?.isError ? `${title} (failed)` : title,
    content: Array.isArray(result?.content) ? result.content : [],
  };
}

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
  const scope = task.scopeCeiling ? ` scope=${task.scopeCeiling}` : '';
  const deps = task.dependsOn.length > 0 ? ` deps: ${task.dependsOn.length}` : '';
  let worktree = '';
  if (task.worktreePath) worktree = ` worktree=${task.worktreePath} branch=${task.branch || '(unknown)'}`;
  else if (task.worktreeDegraded) worktree = ` worktree=off(${task.worktreeDegraded})`;
  const out = [
    `- ${task.id} [${task.status}]${task.approved ? ' approved' : ''}${worker}${model}${effort}${preset}${scope}${deps}${worktree} ${task.title}`,
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

async function mutateMemoryEntry(service, project, action, targetArg, args, exec) {
  const slug = memoryNameOrThrow(targetArg);
  const value = typeof args?.text === 'string' ? args.text.trim() : '';
  if (!value) throw new Error('text is required for append or write');
  const inferredTaskId = service.store.getWorkerInfo?.(sessionIdOf(exec))?.taskId || '';
  const payload = {
    name: slug,
    description: args?.description,
    type: args?.type,
    ...(typeof args?.pinned === 'boolean' ? { pinned: args.pinned } : {}),
    ...(args?.sourceTaskId !== undefined
      ? { sourceTaskId: args.sourceTaskId }
      : inferredTaskId
        ? { sourceTaskId: inferredTaskId }
        : {}),
    text: value,
  };
  if (action === 'write') {
    const written = await service.memory.writeMemoryFile(project.id, payload);
    return `Replaced memory file "${written.file.name}" (${written.file.chars} characters).${await service.memory.afterMemoryWrite(project, written)}`;
  }
  const written = await service.memory.appendMemoryFile(project.id, payload);
  return `Appended ${value.length} characters to memory file "${written.file.name}" (${written.file.chars} characters).${await service.memory.afterMemoryWrite(project, written)}`;
}

async function executeMemoryTool(service, args, exec) {
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
  return mutateMemoryEntry(service, project, action, targetArg, args, exec);
}

function memoryTargetArg(args) {
  const primary = typeof args?.name === 'string' ? args.name.trim() : '';
  if (primary) return primary;
  return typeof args?.section === 'string' ? args.section.trim() : '';
}

function sessionIdOf(context) {
  const sid = context?.agent?.session?.id ?? context?.agent?.id;
  return typeof sid === 'string' && sid.trim() ? sid.trim() : '';
}

export function registerProjectTools(ctx, service) {
  const isCoordinator = (context) => Boolean(service.store.getCoordinatorInfo(sessionIdOf(context)));
  const isProjectMember = (context) => {
    const sid = sessionIdOf(context);
    if (!sid) return false;
    return Boolean(service.store.getCoordinatorInfo(sid) || service.store.getWorkerInfo(sid));
  };

  const registerCoordinatorTool = (spec) => {
    ctx.tools.register(defineTool(spec), { when: isCoordinator });
  };
  const registerMemberTool = (spec) => {
    ctx.tools.register(defineTool(spec), { when: isProjectMember });
  };

  registerCoordinatorTool({
    name: 'projects_list',
    description:
      'List WhaleIsle projects with their task counts. A project holds one goal, standing instructions, a workspace, shared memory, and a task board. Use this to find project_id before calling other projects_* tools.',
    parameters: {},
    output: TEXT_OUTPUT,
    presentCall: () => genericCall('List projects', 'read'),
    presentResult: (_args, result) => genericResult('List projects', result),
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

  registerCoordinatorTool({
    name: 'projects_create',
    description:
      'Create a project: one goal, standing instructions, optional workspace directory, autonomy mode, worker concurrency limit, and optional default worker model/effort/preset.',
    parameters: {
      name: { type: 'string', required: true, description: 'Short project name.' },
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
        description: 'auto (default): coordinator dispatches without per-task approval. manual: tasks need human approval before dispatch.',
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
    output: TEXT_OUTPUT,
    presentCall: (args) => genericCall(`Create project: ${args.name}`, 'edit', args.workspace || ''),
    presentResult: (args, result) => genericResult(`Create project: ${args.name}`, result),
    execute: async (args) => {
      const project = await service.createProject(args);
      return `Created project ${project.id} "${project.name}". autonomy=${project.autonomy} concurrency=${project.concurrency} paused=${project.paused} worktreeIsolation=${project.worktreeIsolation ? 'on' : 'off'}.`;
    },
  });

  registerCoordinatorTool({
    name: 'projects_update',
    description:
      'Update a project settings: name, goal, workspace, autonomy, concurrency, paused state, memory compaction settings, or worktreeIsolation. Task state is managed with projects_update_task.',
    parameters: {
      project_id: { type: 'string', required: true, description: 'Project id.' },
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
    output: TEXT_OUTPUT,
    presentCall: (args) => genericCall(`Update project ${args.project_id}`, 'edit'),
    presentResult: (args, result) => genericResult(`Update project ${args.project_id}`, result),
    execute: async (args) => {
      const patch = pickDefined(args, PROJECT_PATCH_KEYS);
      const { project } = await service.updateProject(String(args?.project_id || ''), patch);
      return `Updated project ${project.id} "${project.name}". autonomy=${project.autonomy} concurrency=${project.concurrency} paused=${project.paused} memory=${memoryBudgetOf(project)} autoCompact=${project.autoCompact !== false} worktreeIsolation=${project.worktreeIsolation ? 'on' : 'off'}${formatCompaction(project)}.`;
    },
  });

  registerMemberTool({
    name: 'projects_get',
    description:
      'Read one project: instructions, workspace, autonomy, open tasks (with status and output), full status counts, and the shared memory index (titles and sizes, never full text). Pass include_resolved: true to list resolved tasks as well.',
    parameters: {
      project_id: { type: 'string', required: true, description: 'Project id from projects_list.' },
      include_resolved: {
        type: 'boolean',
        description: 'Include tasks already accepted as status "resolved". Defaults to false.',
      },
    },
    output: TEXT_OUTPUT,
    presentCall: (args) => genericCall(`Inspect project ${args.project_id}`, 'read'),
    presentResult: (args, result) => genericResult(`Inspect project ${args.project_id}`, result),
    execute: async (args) => {
      const project = await service.readProject(String(args?.project_id || ''));
      const memoryFiles = await service.memory.readMemoryFiles(project.id);
      return formatProject(project, memoryFiles, { includeResolved: args?.include_resolved === true });
    },
  });

  registerCoordinatorTool({
    name: 'projects_add_task',
    description:
      'Add one task to a project board. Each task should be independently finishable by one worker; use depends_on when ordering is required.',
    parameters: {
      project_id: { type: 'string', required: true, description: 'Project id.' },
      title: { type: 'string', required: true, description: 'One-line task title.' },
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
      scopeCeiling: {
        type: 'string',
        enum: SCOPE_CEILINGS,
        description: 'Optional worker permission ceiling enforced by the host (readonly, research, docs, development).',
      },
      writePaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional relative path allowlist enforced for docs/development workers.',
      },
    },
    output: TEXT_OUTPUT,
    presentCall: (args) => genericCall(`Add task: ${args.title}`, 'edit', args.brief ? args.brief.slice(0, 140) : ''),
    presentResult: (args, result) => genericResult(`Add task: ${args.title}`, result),
    execute: async (args, exec) => {
      const projectId = String(args?.project_id || '');
      const activeHandoff = resolveActiveHandoffScope(service, projectId, exec);
      const scoped = clampTaskScope(args?.scopeCeiling, args?.writePaths, activeHandoff);
      const { task } = await service.addTask(projectId, {
        ...args,
        dependsOn: args?.depends_on,
        ...scoped,
      });
      const scopeTag = task.scopeCeiling ? `, scope=${task.scopeCeiling}` : '';
      return `Added task ${task.id} "${task.title}" to project ${projectId} (status queued${scopeTag}).`;
    },
  });

  registerCoordinatorTool({
    name: 'projects_update_task',
    description:
      'Update a task: status (queued, running, review, failed, blocked — never resolved; only the human user marks a task resolved), recorded output, approval flag, deliverable artifacts, model/effort/preset overrides, or append_brief.',
    parameters: {
      project_id: { type: 'string', required: true, description: 'Project id.' },
      task_id: { type: 'string', required: true, description: 'Task id from projects_get.' },
      status: {
        type: 'string',
        enum: STATUSES,
        description: 'New status: queued, running, review, failed, or blocked (resolved is reserved for human acceptance).',
      },
      output: { type: 'string', description: 'Summary recorded on the task (up to 4000 chars).' },
      approved: { type: 'boolean', description: 'Approval flag for autonomy=manual projects.' },
      append_brief: {
        type: 'string',
        description: 'Append a follow-up paragraph to the brief and queue it for the next worker dispatch.',
      },
      artifacts: {
        type: 'array',
        description: 'Optional deliverable files produced by this task to register in the Project Library.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Path inside the task worktree or project workspace.' },
            title: { type: 'string', description: 'Optional display title for the artifact.' },
            kind: { type: 'string', description: 'Optional kind: document, image, html, data, code, or file.' },
          },
        },
      },
      model: { type: 'string', description: 'Per-task model override. Empty clears to project default.' },
      reasoningEffort: { type: 'string', description: 'Per-task reasoning effort override. Empty clears to project default.' },
      agentPreset: { type: 'string', description: 'Per-task agent preset override. Empty clears to project default.' },
    },
    output: TEXT_OUTPUT,
    presentCall: (args) => genericCall(
      `Update task ${args.task_id}${args.status ? ` → ${args.status}` : ''}`,
      'edit',
    ),
    presentResult: (args, result) => genericResult(
      `Update task ${args.task_id}${args.status ? ` → ${args.status}` : ''}`,
      result,
    ),
    execute: async (args) => {
      if (args?.status === 'resolved') {
        throw new Error(
          'Only the human user can mark a task "resolved" after reviewing it. Deliver finished work to status "review" instead.',
        );
      }
      const patch = pickDefined(args, TASK_PATCH_KEYS);
      if (args?.append_brief !== undefined) patch.appendBrief = args.append_brief;
      if (Array.isArray(args?.artifacts) && args.artifacts.length > 0) patch.artifacts = args.artifacts;
      const { task } = await service.updateTask(String(args?.project_id || ''), String(args?.task_id || ''), patch);
      const route = task.model ? ` model=${task.model}` : '';
      const effort = task.reasoningEffort ? ` effort=${task.reasoningEffort}` : '';
      const brief = args?.append_brief === undefined ? '' : ` brief=${task.brief.length} characters`;
      const artifactsNote = Array.isArray(args?.artifacts) && args.artifacts.length > 0
        ? ` artifacts=${args.artifacts.length}`
        : '';
      return `Task ${task.id} is now ${task.status}${task.approved ? ' (approved)' : ''}${route}${effort}${brief}${artifactsNote}.`;
    },
  });

  registerMemberTool({
    name: 'projects_memory',
    description:
      'Read, search, write, append, or delete per-topic shared memory files of a project. Use action "index" to list topics, "search" with query to locate topics without loading bodies, "read" with topic name to read one file, "append"/"write" to save durable findings, or "delete" to remove a topic.',
    parameters: {
      project_id: { type: 'string', required: true, description: 'Project id.' },
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
      pinned: { type: 'boolean', description: 'Pin this topic so it stays hot and is never auto-archived.' },
      sourceTaskId: { type: 'string', description: 'Optional originating task id for traceability.' },
      section: {
        type: 'string',
        description: 'Deprecated alias for topic name.',
      },
    },
    output: TEXT_OUTPUT,
    presentCall: (args) => {
      const action = args.action || 'read';
      const target = memoryTargetArg(args) || args.query || '';
      const kind = action === 'delete'
        ? 'delete'
        : action === 'write' || action === 'append'
          ? 'edit'
          : action === 'search'
            ? 'search'
            : 'read';
      return genericCall(`Project memory (${action})${target ? `: ${target}` : ''}`, kind);
    },
    presentResult: (args, result) => {
      const action = args.action || 'read';
      const target = memoryTargetArg(args) || args.query || '';
      return genericResult(`Project memory (${action})${target ? `: ${target}` : ''}`, result);
    },
    execute: async (args, exec) => executeMemoryTool(service, args, exec),
  });

  registerCoordinatorTool({
    name: 'projects_dispatch',
    description:
      'Dispatch a task to a worker subagent. If the task already ran, continues its existing worker session (preserving context) unless model/preset/effort changed; otherwise starts a fresh worker. Returns immediately so the coordinator stays responsive.',
    parameters: {
      project_id: { type: 'string', required: true, description: 'Project id.' },
      task_id: { type: 'string', required: true, description: 'Task id to dispatch.' },
      note: {
        type: 'string',
        description: 'Optional follow-up instruction for this dispatch (up to 4000 chars).',
      },
    },
    output: TEXT_OUTPUT,
    presentCall: (args) => genericCall(`Dispatch task ${args.task_id}`, 'execute', args.note ? args.note.slice(0, 140) : ''),
    presentResult: (args, result) => genericResult(`Dispatch task ${args.task_id}`, result),
    execute: async (args, exec) =>
      service.dispatchTask(
        String(args?.project_id || ''),
        String(args?.task_id || ''),
        exec,
        text(args?.note, MAX_NOTE).trim(),
      ),
  });
}
