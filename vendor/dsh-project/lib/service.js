/**
 * Main ProjectService orchestrating store, shared memory, worktree, runner,
 * model catalog, session archiving, desktop open-path, and cross-plugin bridges.
 */
import { realpath, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { withinPath } from '../../dsh-shared/lib/path-guard.mjs';
import {
  acceptAuthorizedHandoff,
  inspectBridgeProject,
  listBridgeSummaries,
} from './bridge.js';
import { createLibraryManager } from './library.js';
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
  SCOPE_CEILINGS,
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
  workerIsLive,
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

function hasUnsafeWorkspaceSyntax(raw) {
  if (/[\0\r\n]/.test(raw)) return true;
  if (/^(?:\\\\|\/\/)/.test(raw)) return true;
  if (process.platform === 'win32') {
    const afterDrive = raw.replace(/^[A-Za-z]:/, '');
    if (afterDrive.includes(':')) return true;
    const segments = afterDrive.split(/[\\/]+/).filter(Boolean);
    if (segments.some((segment) => segment !== '.' && segment !== '..' && /[. ]$/.test(segment))) {
      return true;
    }
  }
  return false;
}

async function highRiskAnchors(dshHome) {
  const candidates = [];
  const home = homedir();
  if (home) {
    candidates.push(home);
    if (process.platform === 'darwin') {
      candidates.push(join(home, 'Library'), join(home, 'Library', 'Application Support'));
    }
    candidates.push(join(home, '.config'), join(home, '.ssh'));
  }
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) candidates.push(value);
  }
  if (dshHome) {
    candidates.push(dshHome, dirname(resolve(dshHome)));
  }
  const anchors = [];
  for (const candidate of candidates) {
    try {
      anchors.push(await realpath(resolve(candidate)));
    } catch {
      // Missing anchor cannot be exposed.
    }
  }
  return { home, dshHome, anchors };
}

export async function validateWorkspacePath(rawWorkspace, dshHome = '') {
  const trimmed = text(rawWorkspace, 1024).trim();
  if (!trimmed) return '';
  if (hasUnsafeWorkspaceSyntax(trimmed)) {
    throw httpError(
      400,
      '不支持网络共享路径、设备路径或含保留/异常字符的目录路径，请选择本机普通文件夹。',
      { code: 'invalid_workspace' },
    );
  }
  if (!isAbsolute(trimmed)) {
    throw httpError(400, '工作目录必须是本机绝对路径。', { code: 'invalid_workspace' });
  }
  let canonical;
  try {
    canonical = await realpath(resolve(trimmed));
    const info = await stat(canonical);
    if (!info.isDirectory()) {
      throw httpError(400, '所选工作路径不是文件夹。', { code: 'invalid_workspace' });
    }
  } catch (error) {
    if (error?.status) throw error;
    throw httpError(400, `找不到工作目录：${trimmed}`, { code: 'invalid_workspace' });
  }
  if (parse(canonical).root === canonical) {
    throw httpError(400, '磁盘根目录不能作为项目工作目录，请选择具体的项目文件夹。', { code: 'invalid_workspace' });
  }
  const { home, anchors } = await highRiskAnchors(dshHome);
  const canonicalHome = home ? await realpath(resolve(home)).catch(() => '') : '';
  if (canonicalHome && withinPath(canonical, canonicalHome)) {
    throw httpError(400, '用户主目录不能作为项目工作目录，请选择其中的具体项目文件夹。', { code: 'invalid_workspace' });
  }
  const canonicalDshHome = dshHome ? await realpath(resolve(dshHome)).catch(() => '') : '';
  if (canonicalDshHome && (withinPath(canonicalDshHome, canonical) || withinPath(canonical, canonicalDshHome))) {
    throw httpError(400, '鲸屿数据目录不能作为项目工作目录，请选择你的项目文件夹。', { code: 'invalid_workspace' });
  }
  if (anchors.some((anchor) => anchor !== canonicalHome && anchor !== canonicalDshHome && withinPath(canonical, anchor))) {
    throw httpError(400, '系统配置目录不能作为项目工作目录，请选择具体的项目文件夹。', { code: 'invalid_workspace' });
  }
  return canonical;
}

export function coordinatorPresentationOf(project) {
  return {
    owner: 'dsh-project',
    title: text(project?.name, 120).trim() || 'Project',
    ...(typeof project?.workspace === 'string' && project.workspace.trim()
      ? { workingDirectory: project.workspace.trim() }
      : {}),
  };
}

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
    this.library = createLibraryManager(this.store);
    this.worktree = createWorktreeManager(this.store);
    this.runner = createRunner({
      ctx,
      store: this.store,
      memory: this.memory,
      worktree: this.worktree,
      library: this.library,
      ...(options.notifyBatchMs !== undefined ? { notifyBatchMs: options.notifyBatchMs } : {}),
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
    for (const project of this.store.getCachedProjects()) {
      if (project.archived || project.paused) continue;
      void this.runner.scheduleReadyTasks(project.id).catch(() => {
        // Best-effort wake on admission unlock.
      });
    }
  }

  async syncCoordinatorPresentation(project) {
    const sid = typeof project?.coordinatorSessionId === 'string' ? project.coordinatorSessionId.trim() : '';
    if (!sid) return false;
    const controller = this.ctx?.get?.('sessionController') ?? this.ctx?.sessionController;
    if (!controller || typeof controller.setPresentation !== 'function') return false;
    try {
      await controller.setPresentation({
        sessionId: sid,
        presentation: coordinatorPresentationOf(project),
      });
      return true;
    } catch {
      return false;
    }
  }

  isSessionArchived(sessionId) {
    if (!sessionId) return false;
    const registry = this.ctx?.get?.('workspaceRegistry') ?? this.ctx?.workspaceRegistry;
    if (!registry) return false;
    if (Array.isArray(registry.archivedSessionIds)) {
      return registry.archivedSessionIds.includes(sessionId);
    }
    if (typeof registry.isArchived === 'function') {
      return Boolean(registry.isArchived(sessionId));
    }
    return false;
  }

  async ensureCoordinatorSession(projectId, { restore = false } = {}) {
    const outcome = await this.store.withProjectLock(projectId, async () => {
      const project = await this.store.readProject(projectId);
      const controller = this.ctx?.get?.('sessionController') ?? this.ctx?.sessionController;
      const registry = this.ctx?.get?.('workspaceRegistry') ?? this.ctx?.workspaceRegistry;

      let sid = typeof project.coordinatorSessionId === 'string' ? project.coordinatorSessionId.trim() : '';
      if (sid) {
        let missing = false;
        if (typeof controller?.inspect === 'function') {
          try {
            await controller.inspect(sid);
          } catch (error) {
            if (error?.name === 'ApiSessionNotFound' || /not found/i.test(messageOf(error))) {
              missing = true;
            }
          }
        }
        if (!missing) {
          let archived = this.isSessionArchived(sid);
          if (archived && restore && typeof registry?.unarchiveSession === 'function') {
            await registry.unarchiveSession(sid);
            archived = false;
          }
          await this.syncCoordinatorPresentation(project);
          return { project, coordinatorSessionId: sid, created: false, archived };
        }
        sid = '';
      }

      if (project.archived) {
        throw httpError(409, 'project_archived');
      }
      if (!controller || typeof controller.create !== 'function') {
        throw httpError(503, 'session_controller_unavailable');
      }

      const presentation = coordinatorPresentationOf(project);
      const created = await controller.create({
        ...(project.workspace ? { cwd: project.workspace } : {}),
        presentation,
      });
      sid = String(created?.sessionId || created?.id || '').trim();
      if (!sid) {
        throw httpError(500, 'coordinator_session_create_failed');
      }
      project.coordinatorSessionId = sid;
      project.updatedAt = Date.now();
      const saved = await this.store.writeProject(project);
      await this.syncCoordinatorPresentation(saved);
      return { project: saved, coordinatorSessionId: sid, created: true, archived: false };
    });

    if (outcome.created) {
      this.store.emitChange({ type: 'project.updated', projectId: outcome.project.id });
    }
    return outcome;
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
    const workspace = input?.workspace !== undefined
      ? await validateWorkspacePath(input.workspace, this.store.getHome())
      : '';
    const project = normalizeProject({
      id: newId('p'),
      name: input?.name,
      goal: input?.goal,
      workspace,
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
    const sanitizedPatch = patch && typeof patch === 'object' ? { ...patch } : {};
    if (sanitizedPatch.workspace !== undefined) {
      sanitizedPatch.workspace = await validateWorkspacePath(sanitizedPatch.workspace, this.store.getHome());
    }
    const result = await this.store.withProjectLock(id, async () => {
      const project = await this.store.readProject(id);
      const prevName = project.name;
      const prevWorkspace = project.workspace;
      const prevAutonomy = project.autonomy;
      const prevPaused = project.paused === true;
      const prevCoordinator = project.coordinatorSessionId || '';
      applyProjectPatch(project, sanitizedPatch);
      const worktrees = sanitizedPatch.archived === true
        ? await this.worktree.removeProjectWorktrees(project)
        : undefined;
      project.updatedAt = Date.now();
      const saved = await this.store.writeProject(project);
      return {
        project: saved,
        ...(worktrees === undefined ? {} : { worktrees }),
        shouldSyncPresentation: Boolean(saved.coordinatorSessionId)
          && (saved.name !== prevName
            || saved.workspace !== prevWorkspace
            || saved.coordinatorSessionId !== prevCoordinator),
        shouldSchedule: !saved.archived
          && !saved.paused
          && ((prevAutonomy !== 'auto' && saved.autonomy === 'auto')
            || (prevPaused && !saved.paused)),
      };
    });

    if (result.shouldSyncPresentation) {
      await this.syncCoordinatorPresentation(result.project);
    }
    this.store.emitChange({ type: 'project.updated', projectId: result.project.id });

    let finalProject = result.project;
    let dispatchedTaskIds;
    if (result.shouldSchedule) {
      const scheduled = await this.runner.scheduleReadyTasks(id);
      if (scheduled.length > 0) {
        dispatchedTaskIds = scheduled;
        finalProject = await this.store.readProject(id);
      }
    }
    return {
      project: finalProject,
      ...(result.worktrees === undefined ? {} : { worktrees: result.worktrees }),
      ...(dispatchedTaskIds === undefined ? {} : { dispatchedTaskIds }),
    };
  }

  async deleteProject(projectId, { archiveSessions = false } = {}) {
    const initial = await this.store.readProject(projectId);
    const stoppedTasks = [];
    for (const task of initial.tasks || []) {
      if (!workerIsLive(task) && task.status !== 'running') continue;
      try {
        await this.stopTask(projectId, task.id);
        stoppedTasks.push(task.id);
      } catch {
        // Task may already have settled before stopTask ran.
      }
    }

    const result = await this.store.withProjectLock(projectId, async () => {
      const project = await this.store.readProject(projectId);
      const worktrees = await this.worktree.removeProjectWorktrees(project);
      const archivedSessions = [];
      if (archiveSessions) {
        const registry = this.ctx?.get?.('workspaceRegistry') ?? this.ctx?.workspaceRegistry;
        if (registry && typeof registry.archiveSession === 'function') {
          const sessionIds = new Set();
          if (typeof project.coordinatorSessionId === 'string' && project.coordinatorSessionId.trim()) {
            sessionIds.add(project.coordinatorSessionId.trim());
          }
          for (const task of project.tasks || []) {
            if (typeof task?.childSessionId === 'string' && task.childSessionId.trim()) {
              sessionIds.add(task.childSessionId.trim());
            }
          }
          for (const sid of sessionIds) {
            try {
              await registry.archiveSession(sid);
              archivedSessions.push(sid);
            } catch {
              // Ignore already-archived or missing sessions during project deletion.
            }
          }
        }
      }
      await this.store.deleteProjectDir(projectId);
      // Best-effort cleanup of empty per-project worktree pool folder (never touches user workspace).
      await rm(join(this.store.worktreesRootDir(), projectId), { recursive: true, force: true }).catch(() => {
        // Pool folder may already be absent.
      });
      return { archivedSessions, worktrees };
    });

    this.store.emitChange({ type: 'project.deleted', projectId });
    return {
      deleted: true,
      projectId,
      stoppedTasks,
      archivedSessions: result.archivedSessions,
      worktrees: result.worktrees,
    };
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
      const scopeCeiling = typeof input?.scopeCeiling === 'string' && SCOPE_CEILINGS.includes(input.scopeCeiling.trim())
        ? input.scopeCeiling.trim()
        : undefined;
      const writePaths = Array.isArray(input?.writePaths) ? input.writePaths : undefined;
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
        ...(scopeCeiling ? { scopeCeiling } : {}),
        ...(writePaths ? { writePaths } : {}),
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
    if (Array.isArray(patch?.artifacts) && patch.artifacts.length > 0) {
      await this.library.recordTaskArtifacts(result.project, result.task, patch.artifacts, { source: 'explicit' });
    }
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
    const updated = await this.updateTask(projectId, taskId, { status: body.status });
    if (body.status === 'resolved') {
      const dispatchedTaskIds = await this.runner.scheduleReadyTasks(projectId);
      if (dispatchedTaskIds.length > 0) {
        const latestProject = await this.store.readProject(projectId);
        const latestTask = latestProject.tasks.find((item) => item.id === taskId) || updated.task;
        return { project: latestProject, task: latestTask, dispatchedTaskIds };
      }
    }
    return updated;
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
    let finalProject = result.project;
    let finalTask = result.task;
    let dispatched = false;
    if (finalTask.status === 'queued') {
      const dispatchedIds = await this.runner.scheduleReadyTasks(projectId, { preferredTaskId: taskId });
      dispatched = dispatchedIds.includes(taskId);
      if (dispatchedIds.length > 0) {
        finalProject = await this.store.readProject(projectId);
        finalTask = finalProject.tasks.find((item) => item.id === taskId) || finalTask;
      }
    }
    return { project: finalProject, task: finalTask, dispatched };
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
    await this.library.removeTaskArtifacts(projectId, taskId).catch(() => {});
    return result;
  }

  // -------------------------------------------------------------------------
  // Project Library (references & task artifacts)

  async getLibrary(projectId) {
    const project = await this.store.readProject(projectId);
    return this.library.readLibrary(project);
  }

  async addLibraryReference(projectId, input = {}) {
    const project = await this.store.readProject(projectId);
    return this.library.addReference(project, input);
  }

  async removeLibraryReference(projectId, refId) {
    const project = await this.store.readProject(projectId);
    return this.library.removeReference(project, refId);
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
      this.memory.memoryDir(project.id),
      join(this.store.projectDir(project.id), 'docs'),
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
    const inAllowedRoot = allowedRoots.some((root) => withinPath(root, actualTarget));
    const inLibrary = inAllowedRoot ? false : await this.library.isRegisteredLibraryFile(project.id, actualTarget);
    if (!inAllowedRoot && !inLibrary) {
      throw httpError(403, 'path_outside_project_scope');
    }
    if (!this.desktop) throw httpError(503, 'desktop_bridge_unavailable');
    let matchingWorktreeTask = null;
    for (const task of project.tasks || []) {
      if (!task?.worktreePath) continue;
      try {
        const wtReal = await realpath(task.worktreePath);
        if (withinPath(wtReal, actualTarget)) {
          matchingWorktreeTask = { id: task.id, path: wtReal };
          break;
        }
      } catch {
        // Ignore stale worktree path.
      }
    }
    const response = await this.desktop('open-path', {
      projectId: project.id,
      ...(matchingWorktreeTask ? { taskId: matchingWorktreeTask.id } : {}),
      workingDirectory: matchingWorktreeTask ? matchingWorktreeTask.path : (project.workspace || actualTarget),
      path: actualTarget,
    });
    return { ok: true, opened: true, path: response?.canonicalPath || actualTarget };
  }

  dispose() {
    this.closing = true;
    this.runner.dispose();
  }
}
