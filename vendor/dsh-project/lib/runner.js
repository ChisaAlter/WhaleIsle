/**
 * Execution engine for Projects:
 * - Dynamic `projects:coordinator` system prompt section (order 700, zero impact on other sessions)
 * - Worker dispatch with concurrency/dependency/approval/pause/admission gates
 * - Existing worker session continuation (`ctx.subagents.sendMessage` + `pendingNotes`)
 * - Single-task stop (`AbortController` + subtree drain) and single-task retry
 * - `subagent/end` settlement serialized through the per-project write queue
 */
import {
  beginDesktopAdmission,
  drainAgentAndJobs,
} from '../../dsh-shared/lib/managed-task-runtime.mjs';
import { safeReadStoreFileSync } from './files.js';
import {
  COORDINATOR_CONTEXT_NAME,
  COORDINATOR_CONTEXT_ORDER,
  COORDINATOR_SECTION_NAME,
  COORDINATOR_SECTION_ORDER,
  buildActivationParams,
  continuationPrompt,
  coordinatorDynamicContextText,
  coordinatorRules,
  coordinatorSectionText,
  formatDispatchSummary,
  replyLanguage,
  workerPrompt,
} from './runner-prompts.js';
import { createReportDispatcher } from './runner-reports.js';
import {
  MAX_OUTPUT,
  blocksToText,
  dependencyGate,
  effectiveTaskRoute,
  messageOf,
  routeChanged,
  workerIsLive,
} from './schema.js';
import { isDirectory } from './store.js';

export {
  COORDINATOR_CONTEXT_NAME,
  COORDINATOR_CONTEXT_ORDER,
  COORDINATOR_SECTION_NAME,
  COORDINATOR_SECTION_ORDER,
  continuationPrompt,
  coordinatorDynamicContextText,
  coordinatorRules,
  coordinatorSectionText,
  replyLanguage,
  workerPrompt,
};

function continuationNotes(task, note) {
  const pending = Array.isArray(task.pendingNotes) ? task.pendingNotes.filter(Boolean) : [];
  return note ? [...pending, note] : pending;
}

export function createRunner({ ctx, store, memory, worktree, library = null, notifyBatchMs }) {
  /** @type {Map<string, { controller: AbortController, childSessionId: string, permit: any, projectId: string, taskId: string, parent: any }>} */
  const activeRuns = new Map();
  /** @type {Set<string>} taskKeys currently reserving a slot during async startActivation */
  const inFlightDispatches = new Set();
  /** @type {Set<string>} taskKeys currently inside stopTask so settleWorker does not emit a duplicate/conflicting update */
  const stoppingTasks = new Set();
  /** @type {Map<string, { info: any, at: number }>} buffered subagent/end events that arrived before spawnFreshWorker wrote project.json */
  const earlySettlements = new Map();

  const taskKey = (projectId, taskId) => `${projectId}:${taskId}`;
  const getService = (name) => ctx?.get?.(name) ?? ctx?.[name];

  async function resolveCoordinatorAgent(project) {
    const sid = typeof project?.coordinatorSessionId === 'string' ? project.coordinatorSessionId.trim() : '';
    if (!sid) return null;
    const live = getService('agents')?.get?.(sid);
    if (live) return live;
    const controller = getService('sessionController');
    if (typeof controller?.resolveAgent !== 'function') return null;
    try {
      const resolved = await controller.resolveAgent(sid);
      return resolved?.agent ?? resolved ?? null;
    } catch {
      return null;
    }
  }

  const reports = createReportDispatcher({
    store,
    worktree,
    library,
    getService,
    resolveCoordinatorAgent,
    notifyBatchMs,
  });

  function pruneEarlySettlements() {
    const cutoff = Date.now() - 60_000;
    for (const [id, entry] of earlySettlements) {
      if (entry.at < cutoff) earlySettlements.delete(id);
    }
  }

  function applySettlementToRow(row, info) {
    if (row.status === 'running') {
      row.status = info.stopReason === 'completed' ? 'review' : 'failed';
    }
    if (typeof info.stopReason === 'string' && info.stopReason) {
      row.stopReason = info.stopReason;
    }
    const rawOutput = blocksToText(info.lastAssistantMessage);
    row.output = rawOutput.length > MAX_OUTPUT ? rawOutput.slice(-MAX_OUTPUT) : rawOutput;
    row.finishedAt = Date.now();
    row.updatedAt = Date.now();
  }

  function coordinatorSectionFor(context) {
    const session = context && context.agent && context.agent.session;
    const sessionId = session && typeof session.id === 'string' ? session.id : '';
    if (!sessionId) return '';
    const project = store.getCoordinatorInfo(sessionId);
    if (!project) return '';
    return coordinatorSectionText(project);
  }

  function coordinatorDynamicContextFor(context) {
    const session = context && context.agent && context.agent.session;
    const sessionId = session && typeof session.id === 'string' ? session.id : '';
    if (!sessionId) return '';
    const project = store.getCoordinatorInfo(sessionId);
    if (!project) return '';
    let memoryIndexText = '';
    try {
      memoryIndexText = safeReadStoreFileSync(memory.memoryDir(project.id), 'MEMORY.md', 8192) || '';
    } catch {
      memoryIndexText = '';
    }
    const libraryIndexText = library ? library.libraryIndexSync(project.id) : '';
    return coordinatorDynamicContextText(project, { memoryIndexText, libraryIndexText });
  }

  function releaseRun(key) {
    const entry = activeRuns.get(key);
    if (!entry) return;
    activeRuns.delete(key);
    try {
      entry.permit?.release?.();
    } catch {
      // Best-effort permit release.
    }
  }

  function validateDependencies(project, task) {
    if (!task.dependsOn.length) return '';
    const gate = dependencyGate(project, task);
    if (gate.self) {
      throw new Error(`Task ${task.id} lists itself in depends_on, so it can never be dispatched.`);
    }
    if (gate.cycle) {
      throw new Error(`Task ${task.id} is part of a dependency cycle (${gate.cycle.join(' → ')}), so it can never be dispatched.`);
    }
    if (gate.missing.length > 0) {
      throw new Error(`Task ${task.id} depends on unknown task(s): ${gate.missing.join(', ')}.`);
    }
    if (gate.unresolved.length > 0) {
      const blockers = gate.unresolved.map((dep) => `${dep.id} [${dep.status}]`).join(', ');
      return `Task ${task.id} is waiting on ${gate.unresolved.length} unresolved dependency(ies): ${blockers}. Dispatch it after every dependency is resolved.`;
    }
    return '';
  }

  function validateDispatchGate(project, task, key) {
    if (project.archived) return `Project ${project.id} is archived. Unarchive it before dispatching.`;
    if (project.paused) return `Project ${project.id} is paused. Resume it before dispatching.`;
    if (!task) throw new Error(`Unknown task in project ${project.id}.`);
    if (workerIsLive(task) || inFlightDispatches.has(key)) {
      return `Task ${task.id} is already running as ${task.childName || task.childSessionId || 'a worker'}.`;
    }
    if (task.status === 'resolved') {
      return `Task ${task.id} is resolved. Send it back to review (projects_update_task status "review") before dispatching it again.`;
    }
    const depRefusal = validateDependencies(project, task);
    if (depRefusal) return depRefusal;
    if (project.autonomy === 'manual' && !task.approved) {
      return `Task ${task.id} needs human approval first: project autonomy is "manual". Ask the user to approve it on the Projects board, then dispatch again.`;
    }
    const inFlightForProject = [...inFlightDispatches].filter((k) => k.startsWith(`${project.id}:`)).length;
    const running = project.tasks.filter(workerIsLive).length + inFlightForProject;
    if (running >= project.concurrency) {
      return `Concurrency limit reached (${running}/${project.concurrency} workers running). Wait for one to settle before dispatching ${task.id}.`;
    }
    return '';
  }

  async function tryContinueWorker({ subagents, exec, project, task, note, key, permit }) {
    if (!task.childSessionId) return { continued: false, reason: '' };
    if (routeChanged(task, project)) return { continued: false, reason: 'the task model, preset or effort changed since its last run' };
    if (typeof subagents.sendMessage !== 'function') return { continued: false, reason: 'this host exposes no subagent sendMessage API' };

    const notes = continuationNotes(task, note);
    const candidateDir = task.worktreePath || project.workspace;
    const workdir = candidateDir && (await isDirectory(candidateDir)) ? candidateDir : '';
    const controller = new AbortController();
    const prev = {
      status: task.status,
      finishedAt: task.finishedAt,
      stopReason: task.stopReason,
      output: task.output,
      startedAt: task.startedAt,
    };

    await store.withProjectLock(project.id, async () => {
      const latest = await store.readProject(project.id);
      const row = latest.tasks.find((c) => c.id === task.id);
      if (!row) throw new Error(`Task ${task.id} disappeared before continuation.`);
      row.status = 'running';
      delete row.finishedAt;
      delete row.stopReason;
      row.output = '';
      row.startedAt = Date.now();
      row.updatedAt = Date.now();
      latest.updatedAt = Date.now();
      await store.writeProject(latest);
    });

    let messageId;
    try {
      messageId = await subagents.sendMessage(
        exec.agent,
        task.childSessionId,
        [{ type: 'text', text: continuationPrompt(project, task, workdir, notes) }],
        { signal: controller.signal },
      );
    } catch (error) {
      await store.withProjectLock(project.id, async () => {
        const latest = await store.readProject(project.id);
        const row = latest.tasks.find((c) => c.id === task.id);
        if (!row) return;
        row.status = prev.status;
        if (prev.finishedAt) row.finishedAt = prev.finishedAt;
        if (prev.stopReason) row.stopReason = prev.stopReason;
        row.output = prev.output;
        if (prev.startedAt) row.startedAt = prev.startedAt;
        row.updatedAt = Date.now();
        await store.writeProject(latest);
      });
      return { continued: false, reason: messageOf(error) };
    }

    activeRuns.set(key, {
      controller,
      childSessionId: task.childSessionId,
      permit,
      projectId: project.id,
      taskId: task.id,
      parent: exec.agent,
    });
    await store.withProjectLock(project.id, async () => {
      const latest = await store.readProject(project.id);
      const row = latest.tasks.find((c) => c.id === task.id);
      if (!row) return;
      delete row.pendingNotes;
      row.updatedAt = Date.now();
      latest.updatedAt = Date.now();
      await store.writeProject(latest);
    });
    store.emitChange({ type: 'task.dispatched', projectId: project.id, taskId: task.id });
    const worker = task.childName || task.childSessionId;
    const stage = notes.length > 0 ? ' The follow-up instruction was delivered with it.' : '';
    return {
      continued: true,
      message: `Continued task ${task.id} in worker ${worker} (session ${task.childSessionId}); message ${messageId}. Context preserved.${stage} It runs in the background; its final message lands on the task when it settles.`,
    };
  }

  async function prepareWorkdir(project, task) {
    let cwd = project.workspace && (await isDirectory(project.workspace)) ? project.workspace : undefined;
    if (!project.worktreeIsolation) {
      return { cwd, preparedWorktree: null, worktreeDegraded: '', worktreeNote: '', isolationNote: '' };
    }
    const prepared = await worktree.createTaskWorktree(project, task);
    if (prepared.degraded) {
      return {
        cwd,
        preparedWorktree: null,
        worktreeDegraded: prepared.degraded,
        worktreeNote: prepared.note,
        isolationNote: ` Worktree isolation degraded (${prepared.degraded}): ${prepared.note}`,
      };
    }
    return {
      cwd: prepared.path,
      preparedWorktree: prepared,
      worktreeDegraded: '',
      worktreeNote: '',
      isolationNote: ` worktree=${prepared.path} branch=${prepared.branch}${prepared.reused ? ' (reused)' : ''}.`,
    };
  }

  function applyFreshDispatchRow(project, row, started, childSessionId, envInfo) {
    row.status = 'running';
    row.childSessionId = childSessionId;
    if (started.name) row.childName = started.name;
    row.startedAt = Date.now();
    delete row.finishedAt;
    delete row.stopReason;
    row.output = '';
    delete row.pendingNotes;
    row.childRoute = effectiveTaskRoute(project, row);
    if (envInfo.preparedWorktree) {
      row.branch = envInfo.preparedWorktree.branch;
      row.worktreePath = envInfo.preparedWorktree.path;
      if (envInfo.preparedWorktree.baseCommit) row.baseCommit = envInfo.preparedWorktree.baseCommit;
      delete row.worktreeDegraded;
      delete row.worktreeNote;
    } else if (envInfo.worktreeDegraded) {
      row.worktreeDegraded = envInfo.worktreeDegraded;
      row.worktreeNote = envInfo.worktreeNote;
    } else {
      delete row.worktreeDegraded;
      delete row.worktreeNote;
    }
    row.updatedAt = Date.now();
  }

  async function cleanupNewWorktreeOnFailure(project, task, preparedWorktree, originalError) {
    if (!preparedWorktree || preparedWorktree.reused) return;
    try {
      await worktree.cleanupTaskWorktree(project, {
        id: task.id,
        worktreePath: preparedWorktree.path,
        branch: preparedWorktree.branch,
      });
    } catch (cleanupError) {
      throw new Error(
        `Could not start the worker: ${messageOf(originalError)} (the new worktree ${preparedWorktree.path} could not be removed: ${messageOf(cleanupError)})`,
      );
    }
  }

  async function spawnFreshWorker({ subagents, exec, project, task, note, key, permit, continueFailure }) {
    const notes = note ? [note] : [];
    const memoryFiles = await memory.readMemoryFiles(project.id);
    const controller = new AbortController();
    const envInfo = await prepareWorkdir(project, task);
    const { route, agentPreset, effort, params } = buildActivationParams({
      project, task, memoryFiles, envInfo, notes, exec, controller,
    });

    let started;
    try {
      started = await subagents.startActivation(params);
    } catch (error) {
      await cleanupNewWorktreeOnFailure(project, task, envInfo.preparedWorktree, error);
      throw new Error(`Could not start the worker: ${messageOf(error)}`);
    }

    const childSessionId = String(started.childId);
    activeRuns.set(key, {
      controller,
      childSessionId,
      permit,
      projectId: project.id,
      taskId: task.id,
      parent: exec.agent,
    });

    let settledImmediately = false;
    let settledSnapshot = null;
    await store.withProjectLock(project.id, async () => {
      const latest = await store.readProject(project.id);
      const row = latest.tasks.find((c) => c.id === task.id);
      if (!row) return;
      applyFreshDispatchRow(latest, row, started, childSessionId, envInfo);
      const early = earlySettlements.get(childSessionId);
      if (early) {
        earlySettlements.delete(childSessionId);
        applySettlementToRow(row, early.info);
        settledImmediately = true;
      }
      latest.updatedAt = Date.now();
      await store.writeProject(latest);
      if (settledImmediately) {
        settledSnapshot = { project: structuredClone(latest), task: structuredClone(row) };
      }
    });

    if (settledImmediately) {
      releaseRun(key);
      store.emitChange({ type: 'task.settled', projectId: project.id, taskId: task.id });
      if (settledSnapshot) {
        void reports.enqueueCoordinatorReport(settledSnapshot.project, settledSnapshot.task).catch(() => {
          // Best-effort coordinator report-back after immediate settlement.
        });
        void scheduleReadyTasks(project.id).catch(() => {
          // Best-effort relay of queued tasks after immediate settlement.
        });
      }
    } else {
      store.emitChange({ type: 'task.dispatched', projectId: project.id, taskId: task.id });
    }
    return formatDispatchSummary({ task, started, childSessionId, route, effort, agentPreset, envInfo, continueFailure });
  }

  async function dispatchTask(projectId, taskId, exec, note = '') {
    const subagents = getService('subagents');
    if (!subagents) {
      throw new Error('The subagent service is unavailable in this profile, so no worker can start.');
    }
    if (!exec?.agent) {
      throw new Error('projects_dispatch needs a calling agent (exec.agent was undefined).');
    }

    const key = taskKey(projectId, taskId);
    const preflight = await store.withProjectLock(projectId, async () => {
      const project = await store.readProject(projectId);
      const task = project.tasks.find((candidate) => candidate.id === taskId);
      const refusal = validateDispatchGate(project, task, key);
      if (refusal) return { refusal };
      inFlightDispatches.add(key);
      return { project: structuredClone(project), task: structuredClone(task) };
    });
    if (preflight.refusal) return preflight.refusal;

    const { project, task } = preflight;
    let permit = null;
    try {
      permit = beginDesktopAdmission(ctx, `projects:dispatch:${project.id}:${task.id}`, {
        lockedMessage: 'Desktop task admission is currently locked; cannot dispatch workers.',
      });
      const cont = await tryContinueWorker({ subagents, exec, project, task, note, key, permit });
      if (cont.continued) {
        permit = null;
        return cont.message;
      }
      const message = await spawnFreshWorker({
        subagents,
        exec,
        project,
        task,
        note,
        key,
        permit,
        continueFailure: cont.reason,
      });
      permit = null;
      return message;
    } finally {
      inFlightDispatches.delete(key);
      if (permit) {
        try {
          permit.release();
        } catch {
          // Best-effort cleanup.
        }
      }
    }
  }

  async function stopTask(projectId, taskId) {
    const key = taskKey(projectId, taskId);
    const runEntry = activeRuns.get(key);
    const snapshot = await store.readProject(projectId);
    const target = snapshot.tasks.find((candidate) => candidate.id === taskId);
    if (!target) throw httpError(404, 'task_not_found');
    if (!workerIsLive(target) && !runEntry) {
      throw httpError(409, 'task_not_running');
    }

    stoppingTasks.add(key);
    try {
      if (runEntry) {
        try {
          runEntry.controller.abort(new Error('stopped_by_user'));
        } catch {
          // Already aborted.
        }
      }

      const childSessionId = runEntry?.childSessionId || target.childSessionId || '';
      if (childSessionId) {
        const parentAgent = runEntry?.parent ?? (await resolveCoordinatorAgent(snapshot));
        const subagents = getService('subagents');
        if (!runEntry && typeof subagents?.interrupt === 'function') {
          try {
            subagents.interrupt(childSessionId, { kind: 'user' });
          } catch {
            // Best-effort user-authority interrupt when activeRun is absent (e.g. after restart).
          }
        }
        try {
          await drainAgentAndJobs(ctx, childSessionId, {
            killReason: 'stopped_by_user',
            waitMs: 5_000,
            parent: parentAgent ?? null,
            cancelReason: { kind: 'user' },
            swallowWaitErrors: true,
          });
        } catch {
          // Best-effort worker drain.
        }
      }

      releaseRun(key);

      const updatedTask = await store.withProjectLock(projectId, async () => {
        const latest = await store.readProject(projectId);
        const row = latest.tasks.find((candidate) => candidate.id === taskId);
        if (!row) throw httpError(404, 'task_not_found');
        row.status = 'blocked';
        row.stopReason = 'stopped_by_user';
        row.finishedAt = Date.now();
        row.updatedAt = Date.now();
        latest.updatedAt = Date.now();
        await store.writeProject(latest);
        return row;
      });

      store.emitChange({ type: 'task.stopped', projectId, taskId });
      return { stopped: true, task: updatedTask };
    } finally {
      stoppingTasks.delete(key);
    }
  }

  async function scheduleReadyTasks(projectId, { preferredTaskId = '' } = {}) {
    const subagents = getService('subagents');
    if (!subagents) return [];

    let project;
    try {
      project = await store.readProject(projectId);
    } catch {
      return [];
    }
    if (project.archived || project.paused) return [];

    const admission = getService('desktopTaskAdmission');
    if (admission && typeof admission.check === 'function' && !admission.check()) {
      return [];
    }

    const candidates = (project.tasks || []).filter(
      (task) =>
        task.status === 'queued'
        && !workerIsLive(task)
        && (project.autonomy === 'auto' || task.approved === true),
    );
    if (candidates.length === 0) return [];

    if (preferredTaskId) {
      candidates.sort((left, right) => {
        if (left.id === preferredTaskId) return -1;
        if (right.id === preferredTaskId) return 1;
        return 0;
      });
    }

    const coordinatorAgent = await resolveCoordinatorAgent(project);
    if (!coordinatorAgent) return [];

    const dispatchedIds = [];
    for (const candidate of candidates) {
      try {
        const message = await dispatchTask(projectId, candidate.id, { agent: coordinatorAgent });
        if (/^(Dispatched|Continued) task\b/.test(String(message))) {
          dispatchedIds.push(candidate.id);
        }
      } catch {
        // Leave ineligible or failing tasks queued cleanly without blocking siblings.
      }
    }
    return dispatchedIds;
  }

  async function retryTask(projectId, taskId) {
    const result = await store.withProjectLock(projectId, async () => {
      const project = await store.readProject(projectId);
      const task = project.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw httpError(404, 'task_not_found');
      if (workerIsLive(task) || task.status === 'running') {
        throw httpError(409, 'task_already_running');
      }
      if (task.status === 'resolved') {
        throw httpError(400, 'task_already_resolved');
      }
      if (task.status === 'queued') {
        return { project, task, reset: false };
      }
      task.status = 'queued';
      delete task.stopReason;
      delete task.finishedAt;
      task.updatedAt = Date.now();
      project.updatedAt = Date.now();
      await store.writeProject(project);
      return { project, task, reset: true };
    });

    if (result.reset) {
      store.emitChange({ type: 'task.retried', projectId, taskId });
    }

    const dispatchedIds = await scheduleReadyTasks(projectId, { preferredTaskId: taskId });
    const dispatched = dispatchedIds.includes(taskId);
    let finalTask = result.task;
    if (dispatched) {
      const latest = await store.readProject(projectId);
      finalTask = latest.tasks.find((candidate) => candidate.id === taskId) || finalTask;
    }

    return { retried: true, dispatched, task: finalTask };
  }

  async function settleWorker(info) {
    if (!info || typeof info.id !== 'string') return;
    const childId = info.id;

    // Locate owning project (prefer activeRuns or index cache, fallback to disk scan).
    let matchProjectId = '';
    let matchTaskId = '';
    let matchedFromActiveRun = false;
    for (const entry of activeRuns.values()) {
      if (entry.childSessionId === childId) {
        matchProjectId = entry.projectId;
        matchTaskId = entry.taskId;
        matchedFromActiveRun = true;
        break;
      }
    }
    if (!matchProjectId) {
      const indexed = store.getWorkerInfo?.(childId);
      if (indexed) {
        matchProjectId = indexed.projectId;
        matchTaskId = indexed.taskId;
      }
    }
    if (!matchProjectId) {
      const projects = await store.listProjects();
      for (const project of projects) {
        const found = project.tasks.find((candidate) => candidate.childSessionId === childId);
        if (found) {
          matchProjectId = project.id;
          matchTaskId = found.id;
          break;
        }
      }
    }
    if (!matchProjectId) {
      if (inFlightDispatches.size > 0) {
        pruneEarlySettlements();
        earlySettlements.set(childId, { info, at: Date.now() });
      }
      return;
    }

    const key = taskKey(matchProjectId, matchTaskId);
    if (stoppingTasks.has(key)) {
      // stopTask owns final blocked state and emits a single task.stopped event.
      releaseRun(key);
      return;
    }

    let eventType = '';
    let settledSnapshot = null;
    await store.withProjectLock(matchProjectId, async () => {
      if (stoppingTasks.has(key)) return;
      const project = await store.readProject(matchProjectId);
      const task = project.tasks.find((candidate) =>
        candidate.id === matchTaskId || candidate.childSessionId === childId,
      );
      if (!task) return;
      matchTaskId = task.id;
      if (task.finishedAt) {
        // Already settled by dispatch, so a fresh subagent/end without an activeRun
        // comes from a human follow-up directly inside the embedded Worker conversation.
        if (matchedFromActiveRun) return;
        const rawOutput = blocksToText(info.lastAssistantMessage);
        // Ignore delayed abort callbacks arriving right after stopTask already finished.
        if (!rawOutput && task.stopReason === 'stopped_by_user' && info.stopReason === 'aborted') {
          return;
        }
        if (rawOutput) {
          task.output = rawOutput.length > MAX_OUTPUT ? rawOutput.slice(-MAX_OUTPUT) : rawOutput;
        }
        if (typeof info.stopReason === 'string' && info.stopReason) {
          task.stopReason = info.stopReason;
        }
        if ((task.status === 'failed' || task.status === 'blocked') && info.stopReason === 'completed') {
          task.status = 'review';
        }
        task.finishedAt = Date.now();
        task.updatedAt = Date.now();
        project.updatedAt = Date.now();
        await store.writeProject(project);
        eventType = 'task.updated';
        settledSnapshot = { project: structuredClone(project), task: structuredClone(task), slotFreed: false };
        return;
      }
      applySettlementToRow(task, info);
      project.updatedAt = Date.now();
      await store.writeProject(project);
      eventType = 'task.settled';
      settledSnapshot = { project: structuredClone(project), task: structuredClone(task), slotFreed: true };
    });

    releaseRun(taskKey(matchProjectId, matchTaskId));
    if (eventType) {
      store.emitChange({ type: eventType, projectId: matchProjectId, taskId: matchTaskId });
    }
    if (settledSnapshot) {
      await reports.enqueueCoordinatorReport(settledSnapshot.project, settledSnapshot.task).catch(() => {
        // Best-effort coordinator report-back; task settlement is already persisted.
      });
      if (settledSnapshot.slotFreed && !settledSnapshot.project.archived && !settledSnapshot.project.paused) {
        void scheduleReadyTasks(matchProjectId).catch(() => {
          // Best-effort relay of queued tasks after worker settlement.
        });
      }
    }
  }

  function listActiveWork() {
    const seen = new Set();
    const details = [];
    for (const entry of activeRuns.values()) {
      const key = taskKey(entry.projectId, entry.taskId);
      if (seen.has(key)) continue;
      seen.add(key);
      details.push({ projectId: entry.projectId, id: entry.taskId, kind: 'task' });
    }
    for (const project of store.getCachedProjects()) {
      for (const task of project.tasks || []) {
        if (!workerIsLive(task)) continue;
        const key = taskKey(project.id, task.id);
        if (seen.has(key)) continue;
        seen.add(key);
        details.push({ projectId: project.id, id: task.id, kind: 'task' });
      }
    }
    return details;
  }

  function dispose() {
    reports.dispose();
    for (const [key, entry] of [...activeRuns.entries()]) {
      try {
        entry.controller.abort(new Error('plugin_unloaded'));
      } catch {
        // Already settled.
      }
      releaseRun(key);
    }
    inFlightDispatches.clear();
    stoppingTasks.clear();
    earlySettlements.clear();
  }

  return {
    coordinatorSectionFor,
    coordinatorDynamicContextFor,
    dispatchTask,
    scheduleReadyTasks,
    stopTask,
    retryTask,
    settleWorker,
    listActiveWork,
    dispose,
  };
}
