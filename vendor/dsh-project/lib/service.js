/**
 * Main ProjectService orchestrating store, shared memory, worktree, runner,
 * model catalog, session archiving, desktop open-path, and cross-plugin bridges.
 */
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { withinPath } from '../../dsh-shared/lib/path-guard.mjs';
import {
  acceptAuthorizedHandoff,
  inspectBridgeProject,
  listBridgeSummaries,
} from './bridge.js';
import { createMemoryManager } from './memory.js';
import { createRunner } from './runner.js';
import {
  AUTONOMY,
  HUMAN_STATUSES,
  HUMAN_TASK_FIELDS,
  MAX_BRIEF,
  MAX_CONCURRENCY,
  MAX_DEPENDS_ON,
  MAX_GOAL,
  MAX_OUTPUT,
  MAX_PENDING_NOTES,
  MAX_TASKS,
  MEMORY_BUDGET_MAX,
  MEMORY_BUDGET_MIN,
  STATUSES,
  dependencyIds,
  effortValue,
  httpError,
  intIn,
  messageOf,
  modelValue,
  newId,
  normalizeProject,
  normalizeTask,
  presetValue,
  text,
} from './schema.js';
import { createProjectStore, isDirectory } from './store.js';
import { createWorktreeManager } from './worktree.js';

export const SESSION_ACTIONS = Object.freeze(['archive']);
export const SESSION_DELETE_SPELLINGS = Object.freeze(['1', 'true', 'delete', 'remove', 'yes']);
export const SESSION_DELETE_REFUSED =
  'DeepSeek Harness cannot delete a session — sessions can be archived but never deleted. '
  + 'Use ?session=archive to archive the worker session, or drop the parameter to delete only the task. '
  + 'The task was not deleted.';

const MODEL_CACHE_MS = 60_000;

async function reasoningOf(llm, providerId, modelId) {
  let resolved;
  try {
    resolved = await llm.resolveModelInfo(providerId, modelId);
  } catch {
    return { efforts: [] };
  }
  const reasoning = resolved && typeof resolved === 'object' ? resolved.reasoning : undefined;
  if (!reasoning || !Array.isArray(reasoning.efforts)) return { efforts: [] };
  const efforts = [];
  for (const effort of reasoning.efforts) {
    if (!effort || typeof effort.id !== 'string' || !effort.id) continue;
    efforts.push({
      id: effort.id,
      name: typeof effort.name === 'string' && effort.name ? effort.name : effort.id,
      ...(typeof effort.description === 'string' && effort.description ? { description: effort.description } : {}),
    });
  }
  const defaultEffort = typeof reasoning.defaultEffort === 'string' && reasoning.defaultEffort
    ? reasoning.defaultEffort
    : undefined;
  return { efforts, ...(defaultEffort === undefined ? {} : { defaultEffort }) };
}

function applyProjectPatch(project, patch) {
  if (!patch || typeof patch !== 'object') return;
  if (patch.name !== undefined) project.name = text(patch.name, 120).trim() || project.name;
  if (patch.goal !== undefined) project.goal = text(patch.goal, MAX_GOAL);
  if (patch.workspace !== undefined) project.workspace = text(patch.workspace, 1024).trim();
  if (patch.autonomy !== undefined && AUTONOMY.includes(patch.autonomy)) project.autonomy = patch.autonomy;
  if (patch.concurrency !== undefined) {
    project.concurrency = intIn(patch.concurrency, 1, MAX_CONCURRENCY, project.concurrency);
  }
  if (typeof patch.paused === 'boolean') project.paused = patch.paused;
  if (typeof patch.archived === 'boolean') project.archived = patch.archived;
  if (typeof patch.worktreeIsolation === 'boolean') project.worktreeIsolation = patch.worktreeIsolation;
  applyProjectRouteAndMemoryPatch(project, patch);
}

function applyProjectRouteAndMemoryPatch(project, patch) {
  if (patch.model !== undefined) project.model = modelValue(patch.model);
  if (patch.agentPreset !== undefined) project.agentPreset = presetValue(patch.agentPreset);
  if (patch.reasoningEffort !== undefined) project.reasoningEffort = effortValue(patch.reasoningEffort);
  if (typeof patch.autoCompact === 'boolean') project.autoCompact = patch.autoCompact;
  if (patch.memoryBudget !== undefined) {
    project.memoryBudget = intIn(patch.memoryBudget, MEMORY_BUDGET_MIN, MEMORY_BUDGET_MAX, project.memoryBudget);
  }
  if (patch.coordinatorSessionId !== undefined) {
    const value = text(patch.coordinatorSessionId, 128).trim();
    if (value) project.coordinatorSessionId = value;
    else delete project.coordinatorSessionId;
  }
}

function appendTaskBrief(task, rawAddition) {
  const addition = text(rawAddition, MAX_BRIEF).trim();
  if (!addition) return;
  const combined = task.brief.trim() ? `${task.brief.trimEnd()}\n\n${addition}` : addition;
  if (combined.length > MAX_BRIEF) {
    throw httpError(
      400,
      `brief_too_long: the brief is at ${task.brief.length} of ${MAX_BRIEF} characters; shorten it before appending`,
    );
  }
  const queued = Array.isArray(task.pendingNotes) ? task.pendingNotes : [];
  if (queued.length >= MAX_PENDING_NOTES) {
    throw httpError(
      400,
      `too_many_pending_notes: ${queued.length} notes are already waiting for a dispatch; dispatch the task before appending more`,
    );
  }
  task.brief = combined;
  task.pendingNotes = [...queued, addition];
}

function applyTaskPatch(task, patch) {
  if (!patch || typeof patch !== 'object') return;
  if (patch.title !== undefined) task.title = text(patch.title, 200).trim() || task.title;
  if (patch.brief !== undefined) task.brief = text(patch.brief, MAX_BRIEF);
  if (patch.appendBrief !== undefined) appendTaskBrief(task, patch.appendBrief);
  if (patch.status !== undefined && STATUSES.includes(patch.status)) task.status = patch.status;
  if (patch.approved !== undefined) task.approved = patch.approved === true;
  if (patch.output !== undefined) task.output = text(patch.output, MAX_OUTPUT);
  if (patch.model !== undefined) task.model = modelValue(patch.model);
  if (patch.agentPreset !== undefined) task.agentPreset = presetValue(patch.agentPreset);
  if (patch.reasoningEffort !== undefined) task.reasoningEffort = effortValue(patch.reasoningEffort);
}

async function enumerateProviderModels(llm, providerIds) {
  const canResolve = typeof llm.resolveModelInfo === 'function';
  const models = [];
  for (const providerId of providerIds) {
    let advertised;
    try {
      advertised = await llm.listModels(providerId);
    } catch {
      continue;
    }
    for (const model of Array.isArray(advertised) ? advertised : []) {
      if (!model || typeof model.id !== 'string' || !model.id) continue;
      const reasoning = canResolve ? await reasoningOf(llm, providerId, model.id) : { efforts: [] };
      models.push({
        id: `${providerId}/${model.id}`,
        provider: providerId,
        model: model.id,
        label: typeof model.name === 'string' && model.name ? model.name : model.id,
        ...(typeof model.description === 'string' && model.description ? { description: model.description } : {}),
        efforts: reasoning.efforts,
        ...(reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort }),
      });
    }
  }
  return models;
}

export class ProjectService {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.available = true;
    this.closing = false;
    this.error = '';
    this.desktop = typeof options.desktop === 'function' ? options.desktop : null;
    this.store = createProjectStore({ home: options.home || '' });
    this.memory = createMemoryManager(this.store);
    this.worktree = createWorktreeManager(this.store);
    this.runner = createRunner({
      ctx,
      store: this.store,
      memory: this.memory,
      worktree: this.worktree,
    });
    this.modelCache = new Map();
    this.handoffReceipts = new Map();
    this.store.primeSync();
  }

  admissionOpen() {
    const admission = this.ctx?.get?.('desktopTaskAdmission');
    if (!admission || typeof admission.check !== 'function') return true;
    return Boolean(admission.check());
  }

  /** Used by `dsh-task-control` to inspect active project work before quit/update. */
  inspect() {
    return { details: this.runner.listActiveWork() };
  }

  /** Hook invoked by `dsh-task-control` when desktop task admission unlocks. */
  schedule() {
    this.store.emitChange({ type: 'schedule.unlocked' });
  }

  getCachedProjects() {
    return this.store.getCachedProjects();
  }

  subscribeEvents(listener) {
    return this.store.subscribe(listener);
  }

  // -------------------------------------------------------------------------
  // Cross-plugin bridge (`dsh-whale`)

  listBridgeSummaries() {
    return listBridgeSummaries(this);
  }

  inspectBridgeProject(input) {
    return inspectBridgeProject(this, input);
  }

  acceptAuthorizedHandoff(input) {
    return acceptAuthorizedHandoff(this, input);
  }

  // -------------------------------------------------------------------------
  // Project CRUD

  async listProjects() {
    return this.store.listProjects();
  }

  async readProject(id) {
    return this.store.readProject(id);
  }

  async createProject(input = {}) {
    const project = normalizeProject({
      id: newId('p'),
      name: input?.name,
      goal: input?.goal,
      workspace: input?.workspace,
      autonomy: input?.autonomy,
      concurrency: input?.concurrency,
      paused: input?.paused,
      model: input?.model,
      agentPreset: input?.agentPreset,
      reasoningEffort: input?.reasoningEffort,
      autoCompact: input?.autoCompact,
      memoryBudget: input?.memoryBudget,
      worktreeIsolation: input?.worktreeIsolation,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tasks: [],
    });
    const saved = await this.store.writeProject(project);
    this.store.emitChange({ type: 'project.created', projectId: saved.id });
    return saved;
  }

  async updateProject(id, patch = {}) {
    const result = await this.store.withProjectLock(id, async () => {
      const project = await this.store.readProject(id);
      applyProjectPatch(project, patch);
      const worktrees = patch?.archived === true
        ? await this.worktree.removeProjectWorktrees(project)
        : undefined;
      project.updatedAt = Date.now();
      const saved = await this.store.writeProject(project);
      return { project: saved, ...(worktrees === undefined ? {} : { worktrees }) };
    });
    this.store.emitChange({ type: 'project.updated', projectId: result.project.id });
    return result;
  }

  // -------------------------------------------------------------------------
  // Task operations

  async addTask(projectId, input = {}) {
    const result = await this.store.withProjectLock(projectId, async () => {
      const project = await this.store.readProject(projectId);
      if (project.tasks.length >= MAX_TASKS) throw httpError(409, 'too_many_tasks');
      const dependsOn = dependencyIds(input?.dependsOn ?? input?.depends_on);
      if (dependsOn.length > MAX_DEPENDS_ON) {
        throw httpError(
          400,
          `too_many_dependencies: a task may depend on at most ${MAX_DEPENDS_ON} tasks (got ${dependsOn.length})`,
        );
      }
      const task = normalizeTask({
        id: newId('t'),
        title: input?.title,
        brief: input?.brief,
        status: 'queued',
        approved: input?.approved === true,
        dependsOn,
        model: input?.model,
        agentPreset: input?.agentPreset,
        reasoningEffort: input?.reasoningEffort,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      project.tasks.push(task);
      project.updatedAt = Date.now();
      const saved = await this.store.writeProject(project);
      const storedTask = saved.tasks.find((item) => item.id === task.id) || task;
      return { project: saved, task: storedTask };
    });
    this.store.emitChange({ type: 'task.added', projectId: result.project.id, taskId: result.task.id });
    return result;
  }

  async updateTask(projectId, taskId, patch = {}) {
    const result = await this.store.withProjectLock(projectId, async () => {
      const project = await this.store.readProject(projectId);
      const task = project.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw httpError(404, 'task_not_found');
      applyTaskPatch(task, patch);
      task.updatedAt = Date.now();
      project.updatedAt = Date.now();
      const saved = await this.store.writeProject(project);
      const storedTask = saved.tasks.find((item) => item.id === taskId) || task;
      return { project: saved, task: storedTask };
    });
    this.store.emitChange({ type: 'task.updated', projectId: result.project.id, taskId: result.task.id });
    return result;
  }

  /**
   * Narrow human write door for `PATCH /projects-api/projects/:id/tasks/:taskId`:
   * only `status` is accepted, and only `resolved` or `review`.
   */
  async resolveTask(projectId, taskId, patch) {
    const body = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const foreign = Object.keys(body).filter((key) => !HUMAN_TASK_FIELDS.includes(key));
    if (foreign.length > 0) {
      throw httpError(
        400,
        `only "status" is writable from the page (rejected: ${foreign.join(', ')}); send status "resolved" or "review"`,
      );
    }
    if (body.status === undefined) throw httpError(400, 'status_required');
    if (!HUMAN_STATUSES.includes(body.status)) {
      throw httpError(
        400,
        `the page may only set status to "resolved" or "review" (rejected: ${JSON.stringify(body.status)})`,
      );
    }
    return this.updateTask(projectId, taskId, { status: body.status });
  }

  async approveTask(projectId, taskId) {
    const result = await this.store.withProjectLock(projectId, async () => {
      const project = await this.store.readProject(projectId);
      const task = project.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw httpError(404, 'task_not_found');
      if (task.approved) return { project, task, changed: false };
      if (task.status === 'running') throw httpError(400, 'task_already_running');
      task.approved = true;
      task.updatedAt = Date.now();
      project.updatedAt = Date.now();
      const saved = await this.store.writeProject(project);
      const storedTask = saved.tasks.find((item) => item.id === taskId) || task;
      return { project: saved, task: storedTask, changed: true };
    });
    if (result.changed) {
      this.store.emitChange({ type: 'task.approved', projectId: result.project.id, taskId: result.task.id });
    }
    return { project: result.project, task: result.task };
  }

  async archiveTaskSession(project, task) {
    const sessionId = typeof task.childSessionId === 'string' ? task.childSessionId.trim() : '';
    if (!sessionId) return null;
    if (project.coordinatorSessionId === sessionId) {
      throw httpError(
        409,
        `refusing to archive ${sessionId}: it is the coordinator session of project ${project.id}`,
      );
    }
    const registry = this.ctx?.get?.('workspaceRegistry') ?? this.ctx?.workspaceRegistry;
    if (!registry || typeof registry.archiveSession !== 'function') {
      throw httpError(503, 'workspace_registry_unavailable');
    }
    try {
      await registry.archiveSession(sessionId);
    } catch (error) {
      if (error?.name === 'WorkspaceUnknownSessionError') return { id: sessionId, archived: false };
      if (error?.name === 'WorkspaceActiveSessionError') {
        throw httpError(
          409,
          `refusing to archive ${sessionId}: the worker is still running (${messageOf(error)}); stop it first, or delete the task without ?session=archive`,
        );
      }
      throw httpError(500, `could not archive session ${sessionId}: ${messageOf(error)}`);
    }
    return { id: sessionId, archived: true };
  }

  async removeTask(projectId, taskId, action = '') {
    if (action && !SESSION_ACTIONS.includes(action)) {
      throw httpError(
        400,
        SESSION_DELETE_SPELLINGS.includes(action)
          ? SESSION_DELETE_REFUSED
          : `unknown session action "${action}" (supported: ${SESSION_ACTIONS.join(', ')})`,
      );
    }

    const result = await this.store.withProjectLock(projectId, async () => {
      const project = await this.store.readProject(projectId);
      const index = project.tasks.findIndex((candidate) => candidate.id === taskId);
      if (index < 0) throw httpError(404, 'task_not_found');
      const task = project.tasks[index];
      const session = action === 'archive' ? await this.archiveTaskSession(project, task) : null;
      const worktree = await this.worktree.cleanupTaskWorktree(project, task);
      project.tasks.splice(index, 1);
      project.updatedAt = Date.now();
      const saved = await this.store.writeProject(project);
      return { project: saved, session, worktree };
    });

    this.store.emitChange({ type: 'task.deleted', projectId, taskId });
    return result;
  }

  // -------------------------------------------------------------------------
  // Execution & Worktree controls

  dispatchTask(projectId, taskId, exec, note = '') {
    return this.runner.dispatchTask(projectId, taskId, exec, note);
  }

  stopTask(projectId, taskId) {
    return this.runner.stopTask(projectId, taskId);
  }

  retryTask(projectId, taskId) {
    return this.runner.retryTask(projectId, taskId);
  }

  settleWorker(info) {
    return this.runner.settleWorker(info);
  }

  async getTaskDiff(projectId, taskId) {
    const project = await this.store.readProject(projectId);
    const task = project.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw httpError(404, 'task_not_found');
    return this.worktree.getTaskDiff(project, task);
  }

  async mergeTaskWorktree(projectId, taskId) {
    const project = await this.store.readProject(projectId);
    const task = project.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw httpError(404, 'task_not_found');
    const merged = await this.worktree.mergeTaskWorktree(project, task);
    const updated = await this.store.withProjectLock(projectId, async () => {
      const latest = await this.store.readProject(projectId);
      const row = latest.tasks.find((candidate) => candidate.id === taskId);
      if (row) {
        row.updatedAt = Date.now();
        latest.updatedAt = Date.now();
        await this.store.writeProject(latest);
      }
      return row || task;
    });
    this.store.emitChange({ type: 'task.worktree_merged', projectId, taskId });
    return { ...merged, task: updated };
  }

  async cleanupTaskWorktree(projectId, taskId) {
    const result = await this.store.withProjectLock(projectId, async () => {
      const project = await this.store.readProject(projectId);
      const task = project.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw httpError(404, 'task_not_found');
      const cleaned = await this.worktree.cleanupTaskWorktree(project, task);
      delete task.worktreePath;
      delete task.branch;
      delete task.baseCommit;
      delete task.worktreeDegraded;
      delete task.worktreeNote;
      task.updatedAt = Date.now();
      project.updatedAt = Date.now();
      const saved = await this.store.writeProject(project);
      const storedTask = saved.tasks.find((candidate) => candidate.id === taskId) || task;
      return { cleaned: true, worktree: cleaned, task: storedTask };
    });
    this.store.emitChange({ type: 'task.worktree_cleaned', projectId, taskId });
    return result;
  }

  // -------------------------------------------------------------------------
  // Catalog, session restore, and desktop open-path

  async listModelChoices() {
    const llm = this.ctx?.get?.('llm') ?? this.ctx?.llm;
    if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
      return { models: [], enumerable: false };
    }
    let providers;
    try {
      providers = llm.listProviders();
    } catch {
      return { models: [], enumerable: false };
    }
    const ids = (Array.isArray(providers) ? providers : [])
      .map((provider) => (typeof provider?.id === 'string' ? provider.id : ''))
      .filter(Boolean);
    if (ids.length === 0) return { models: [], enumerable: false };

    const cacheKey = ids.join('\n');
    const cached = this.modelCache.get(cacheKey);
    if (cached && Date.now() - cached.at < MODEL_CACHE_MS) {
      return { models: cached.models, enumerable: true };
    }

    const models = await enumerateProviderModels(llm, ids);
    if (models.length === 0) return { models: [], enumerable: false };
    this.modelCache.set(cacheKey, { at: Date.now(), models });
    return { models, enumerable: true };
  }

  async listPresetChoices() {
    const registry = this.ctx?.get?.('agentPresets') ?? this.ctx?.agentPresets;
    if (!registry || typeof registry.list !== 'function') {
      return { presets: [], enumerable: false };
    }
    let rows;
    try {
      rows = await registry.list();
    } catch {
      return { presets: [], enumerable: false };
    }
    const presets = (Array.isArray(rows) ? rows : [])
      .filter((row) => row && typeof row.id === 'string' && row.id && row.hidden !== true)
      .map((row) => ({
        id: row.id,
        label: typeof row.name === 'string' && row.name ? row.name : row.id,
        ...(typeof row.description === 'string' && row.description ? { description: row.description } : {}),
        ...(typeof row.broken === 'string' && row.broken ? { broken: row.broken } : {}),
      }));
    return { presets, enumerable: presets.length > 0 };
  }

  async listModels() {
    const [models, presets] = await Promise.all([this.listModelChoices(), this.listPresetChoices()]);
    return {
      models: models.models,
      enumerable: models.enumerable,
      presets: presets.presets,
      presetsEnumerable: presets.enumerable,
    };
  }

  async restoreSession(sessionId) {
    const id = text(sessionId, 128).trim();
    if (!id) throw httpError(400, 'sessionId_required');
    const registry = this.ctx?.get?.('workspaceRegistry') ?? this.ctx?.workspaceRegistry;
    if (!registry || typeof registry.unarchiveSession !== 'function') {
      throw httpError(503, 'workspace_registry_unavailable');
    }
    await registry.unarchiveSession(id);
    return { restored: true };
  }

  async collectAllowedOpenRoots(project) {
    const candidates = [
      project.workspace,
      this.store.projectDir(project.id),
      ...(project.tasks || []).map((task) => task.worktreePath),
    ].filter(Boolean);
    const roots = [];
    for (const dir of candidates) {
      if (await isDirectory(dir)) roots.push(await realpath(dir));
    }
    return roots;
  }

  async openPath({ projectId, path: requestedPath = '' } = {}) {
    const project = await this.store.readProject(projectId);
    const rawTarget = typeof requestedPath === 'string' && requestedPath.trim()
      ? requestedPath.trim()
      : project.workspace;
    if (!rawTarget) throw httpError(400, 'path_required');
    const candidate = isAbsolute(rawTarget)
      ? resolve(rawTarget)
      : project.workspace
        ? resolve(project.workspace, rawTarget)
        : '';
    if (!candidate) throw httpError(400, 'invalid_path');

    let actualTarget;
    try {
      actualTarget = await realpath(candidate);
    } catch {
      throw httpError(404, 'path_not_found');
    }

    const allowedRoots = await this.collectAllowedOpenRoots(project);
    if (!allowedRoots.some((root) => withinPath(root, actualTarget))) {
      throw httpError(403, 'path_outside_project_scope');
    }
    if (!this.desktop) throw httpError(503, 'desktop_bridge_unavailable');
    const response = await this.desktop('open-path', {
      projectId: project.id,
      workingDirectory: project.workspace || actualTarget,
      path: actualTarget,
    });
    return { ok: true, opened: true, path: response?.canonicalPath || actualTarget };
  }

  dispose() {
    this.closing = true;
    this.runner.dispose();
  }
}
