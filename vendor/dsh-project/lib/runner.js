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
import { memoryIndex } from './memory.js';
import {
  MAX_OUTPUT,
  blocksToText,
  dependencyGate,
  effortValue,
  httpError,
  messageOf,
  modelRoute,
  presetValue,
  routeChanged,
  taskRoute,
  workerIsLive,
} from './schema.js';
import { isDirectory } from './store.js';

export const COORDINATOR_SECTION_NAME = 'projects:coordinator';
export const COORDINATOR_SECTION_ORDER = 700;

const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const LATIN = /[A-Za-z]/u;

export function replyLanguage(project, task) {
  const sample = (task?.brief || '').trim() || (project?.goal || '').trim();
  if (!sample) return '';
  if (KANA.test(sample)) return '';
  if (HAN.test(sample)) return 'zh';
  if (LATIN.test(sample)) return 'en';
  return '';
}

function languageRule(language) {
  const lines = ['## Language (hard rule)'];
  if (language === 'zh') {
    lines.push('Write your entire reply in Chinese (中文) — the language the human wrote the task brief in.');
  } else if (language === 'en') {
    lines.push('Write your entire reply in English — the language the human wrote the task brief in.');
  } else {
    lines.push('Write your entire reply in the language the human wrote the task brief in.');
  }
  lines.push(
    'If the brief is empty, follow the language of the project instructions instead.',
    'This prompt being in English is not a reason to answer in English, and neither are tool names, code, file paths, or shared memory.',
  );
  return lines;
}

export function coordinatorRules(project) {
  return [
    '## Language (hard rule)',
    'Reply in the language the user writes in, not in the language of this prompt. Keep matching the user language across turns. Tool names, code, file paths, project names, or shared memory are never a reason to switch to English.',
    '',
    '## Your job',
    'You do four things only: split the goal, dispatch, review, report.',
    '',
    '1. Anything that needs reading files, editing code, running commands, or multi-step investigation must be derived into a task with projects_add_task (except continuing an existing worker, see rule 8). Do not execute implementation work directly in this conversation.',
    '2. Use projects_add_task to split the goal into parallel, independently finishable tasks; set depends_on when one task must wait for another to be resolved.',
    '3. Use projects_dispatch to start tasks; return immediately so this conversation stays responsive.',
    '4. When a worker reports back, use projects_get to read its output, report the conclusion concisely, and invite the user to review and Resolve it on the Projects board.',
    '5. Maintain durable project knowledge in projects_memory (one topic file per subject) so every worker starts informed.',
    '6. The human owns acceptance: set status "resolved" with projects_update_task only when the user explicitly accepts the work.',
    project.autonomy === 'manual'
      ? '7. Autonomy is manual: obtain explicit user approval (on the board or in chat via projects_update_task approved=true) before dispatching.'
      : '7. Autonomy is auto: you may dispatch queued tasks without waiting for manual approval.',
    ...(project.paused ? ['   NOTE: This project is currently PAUSED. Do not dispatch until the user resumes it.'] : []),
    '8. Prefer continuing an existing worker (projects_dispatch with `note`, or projects_update_task with `append_brief`) whenever follow-up work builds on files, context, or conclusions that worker already established. Create a new task only for genuinely independent work.',
    '',
    '## How to write a task brief',
    '1. State three things clearly: the problem, constraints, and concrete acceptance criteria (how to verify).',
    '2. Do not micromanage step-by-step implementation or paste stale line numbers.',
    '3. Keep briefs concise (typically <= 15 lines) and avoid duplicating standing project instructions.',
    '',
    '## Reply style',
    '1. Lead with the conclusion or action; skip process narration.',
    '2. When dispatching, state briefly what was dispatched, why, and what you are waiting for without repeating the full brief or output.',
    '3. Ask one focused question at a time when user input is genuinely required.',
  ].join('\n');
}

export function coordinatorSectionText(project) {
  return `You are the coordinator of the WhaleIsle project "${project.name}" (project_id: ${project.id}).\n\n${coordinatorRules(project)}`;
}

export function workerPrompt(project, task, memoryFiles, workdir, branch, notes = []) {
  const lines = [
    `You are the worker for one task in the project "${project.name}" (project_id: ${project.id}).`,
    'Complete only this task and report back concisely. The coordinator remains free while you work.',
    '',
    ...languageRule(replyLanguage(project, task)),
    '',
    '## Project instructions',
    (project.goal || '').trim() || '(none)',
    '',
    '## Shared project memory',
    memoryIndex(memoryFiles),
    '',
    `The list above is an index of the shared memory, not its contents. Read a file before relying on it: projects_memory {project_id:"${project.id}", action:"read", name:"<name>"}.`,
    '',
    '## Your task',
    `Title: ${task.title}`,
  ];
  if ((task.brief || '').trim()) lines.push('', task.brief.trim());
  if (notes.length > 0) lines.push('', '## Follow-up note', notes.join('\n\n'));
  lines.push(
    '',
    '## How to work',
    workdir ? `- Work inside ${workdir}.` : '- Work in the current directory.',
    ...(branch
      ? [`- This is an isolated git worktree on branch ${branch}; commit your verified changes on this branch. Merging is handled separately after human review.`]
      : []),
    '- Keep changes scoped to this task; do not rewrite unrelated code.',
    `- Before finishing, record durable findings/decisions/gotchas in shared memory via projects_memory: project_id "${project.id}", action "append", name "<topic-slug>", description "<one line>".`,
    '- Do not change the task status directly; your final assistant message is recorded as the task output.',
    '- If blocked, explain precisely what blocked you and what human decision or input is needed.',
    '- End with a concise report: what changed, where, and how you verified it.',
  );
  return lines.join('\n');
}

export function continuationPrompt(project, task, workdir, notes) {
  const language = replyLanguage(project, task);
  const lines = [
    `## Follow-up stage of task ${task.id}`,
    `This is the next stage of task ${task.id} "${task.title}" in project "${project.name}" (project_id: ${project.id}). Keep the context you already built and avoid redoing finished work.`,
  ];
  if (notes.length > 0) lines.push('', '## Follow-up note', notes.join('\n\n'));
  else lines.push('', 'No additional note was provided: resume the task from where you stopped.');
  lines.push(
    '',
    '## How to work',
    workdir ? `- Work inside ${workdir}.` : '- Work in your assigned directory.',
    '- Keep changes scoped to this follow-up stage.',
    `- Record durable findings via projects_memory: project_id "${project.id}", action "append", name "<topic-slug>", description "<one line>".`,
    '- Do not change the task status directly; your final message becomes the recorded output.',
    language === 'zh'
      ? '- 用中文回复。'
      : language === 'en'
        ? '- Reply in English.'
        : '- Reply in the language the human wrote the task brief in.',
  );
  return lines.join('\n');
}

function continuationNotes(task, note) {
  const pending = Array.isArray(task.pendingNotes) ? task.pendingNotes.filter(Boolean) : [];
  return note ? [...pending, note] : pending;
}

export function createRunner({ ctx, store, memory, worktree }) {
  /** @type {Map<string, { controller: AbortController, childSessionId: string, permit: any, projectId: string, taskId: string, parent: any }>} */
  const activeRuns = new Map();
  /** @type {Set<string>} taskKeys currently reserving a slot during async startActivation */
  const inFlightDispatches = new Set();

  const taskKey = (projectId, taskId) => `${projectId}:${taskId}`;

  function coordinatorSectionFor(context) {
    const session = context && context.agent && context.agent.session;
    const sessionId = session && typeof session.id === 'string' ? session.id : '';
    if (!sessionId) return '';
    const project = store.getCoordinatorInfo(sessionId);
    return project ? coordinatorSectionText(project) : '';
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

  function getService(name) {
    return ctx?.get?.(name) ?? ctx?.[name];
  }

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
    if (routeChanged(task)) return { continued: false, reason: 'the task model, preset or effort changed since its last run' };
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

  function applyFreshDispatchRow(row, started, childSessionId, envInfo) {
    row.status = 'running';
    row.childSessionId = childSessionId;
    if (started.name) row.childName = started.name;
    row.startedAt = Date.now();
    delete row.finishedAt;
    delete row.stopReason;
    row.output = '';
    delete row.pendingNotes;
    row.childRoute = taskRoute(row);
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

  function buildActivationParams({ project, task, memoryFiles, envInfo, notes, exec, controller }) {
    const route = modelRoute(task.model || project.model);
    const agentPreset = presetValue(task.agentPreset || project.agentPreset);
    const effort = effortValue(task.reasoningEffort || project.reasoningEffort);
    const agentOptions = route === undefined && !effort
      ? undefined
      : { ...(route === undefined ? {} : route), ...(effort ? { reasoningEffort: effort } : {}) };
    return {
      route,
      agentPreset,
      effort,
      params: {
        provider: 'spawn',
        label: `${project.name} · ${task.title}`.slice(0, 120),
        prompt: [{ type: 'text', text: workerPrompt(project, task, memoryFiles, envInfo.cwd, envInfo.preparedWorktree?.branch, notes) }],
        parent: exec.agent,
        ...(envInfo.cwd === undefined ? {} : { cwd: envInfo.cwd }),
        ...(agentPreset ? { agentPreset } : {}),
        ...(agentOptions === undefined ? {} : { agentOptions }),
        signal: controller.signal,
        delivery: 'parent',
      },
    };
  }

  function formatDispatchSummary({ task, started, childSessionId, route, effort, agentPreset, envInfo, continueFailure }) {
    const routeNote = route === undefined ? '' : ` model=${route.provider ? `${route.provider}/` : ''}${route.model}`;
    const presetNote = agentPreset ? ` preset=${agentPreset}` : '';
    const effortNote = effort ? ` effort=${effort}` : '';
    const fallbackNote = continueFailure
      ? ` The earlier worker session could not be continued (${continueFailure}), so this is a fresh session without its context.`
      : '';
    return `Dispatched task ${task.id} to worker ${started.name || childSessionId} (session ${childSessionId})${routeNote}${effortNote}${presetNote}.${envInfo.isolationNote} It runs in the background; its final message lands on the task when it settles.${fallbackNote}`;
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

    await store.withProjectLock(project.id, async () => {
      const latest = await store.readProject(project.id);
      const row = latest.tasks.find((c) => c.id === task.id);
      if (!row) return;
      applyFreshDispatchRow(row, started, childSessionId, envInfo);
      latest.updatedAt = Date.now();
      await store.writeProject(latest);
    });

    store.emitChange({ type: 'task.dispatched', projectId: project.id, taskId: task.id });
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

    if (runEntry) {
      try {
        runEntry.controller.abort(new Error('stopped_by_user'));
      } catch {
        // Already aborted.
      }
    }

    const childSessionId = runEntry?.childSessionId || target.childSessionId || '';
    if (childSessionId) {
      try {
        await drainAgentAndJobs(ctx, childSessionId, {
          killReason: 'stopped_by_user',
          waitMs: 5_000,
          parent: runEntry?.parent ?? null,
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

    // Attempt immediate re-dispatch when coordinator agent is live and gates allow it.
    let dispatched = false;
    let finalTask = result.task;
    const { project } = result;
    const subagents = ctx?.get?.('subagents') ?? ctx?.subagents;
    const canDispatch =
      Boolean(subagents)
      && !project.archived
      && !project.paused
      && (project.autonomy === 'auto' || result.task.approved);

    if (canDispatch) {
      const coordinatorAgent = await resolveCoordinatorAgent(project);
      if (coordinatorAgent) {
        try {
          const message = await dispatchTask(projectId, taskId, { agent: coordinatorAgent });
          if (/^(Dispatched|Continued) task\b/.test(String(message))) {
            dispatched = true;
            const latest = await store.readProject(projectId);
            finalTask = latest.tasks.find((candidate) => candidate.id === taskId) || finalTask;
          }
        } catch {
          // Leave task queued cleanly; coordinator or user can dispatch later.
        }
      }
    }

    return { retried: true, dispatched, task: finalTask };
  }

  async function settleWorker(info) {
    if (!info || typeof info.id !== 'string') return;
    const childId = info.id;

    // Locate owning project (prefer activeRuns or cache, fallback to disk scan).
    let matchProjectId = '';
    let matchTaskId = '';
    for (const entry of activeRuns.values()) {
      if (entry.childSessionId === childId) {
        matchProjectId = entry.projectId;
        matchTaskId = entry.taskId;
        break;
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
    if (!matchProjectId) return;

    let settled = false;
    await store.withProjectLock(matchProjectId, async () => {
      const project = await store.readProject(matchProjectId);
      const task = project.tasks.find((candidate) =>
        candidate.id === matchTaskId || candidate.childSessionId === childId,
      );
      if (!task) return;
      if (task.finishedAt) return;
      if (task.status === 'running') {
        task.status = info.stopReason === 'completed' ? 'review' : 'failed';
      }
      if (typeof info.stopReason === 'string' && info.stopReason) {
        task.stopReason = info.stopReason;
      }
      const rawOutput = blocksToText(info.lastAssistantMessage);
      task.output = rawOutput.length > MAX_OUTPUT ? rawOutput.slice(-MAX_OUTPUT) : rawOutput;
      task.finishedAt = Date.now();
      task.updatedAt = Date.now();
      project.updatedAt = Date.now();
      await store.writeProject(project);
      matchTaskId = task.id;
      settled = true;
    });

    releaseRun(taskKey(matchProjectId, matchTaskId));
    if (settled) {
      store.emitChange({ type: 'task.settled', projectId: matchProjectId, taskId: matchTaskId });
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
    for (const [key, entry] of [...activeRuns.entries()]) {
      try {
        entry.controller.abort(new Error('plugin_unloaded'));
      } catch {
        // Already settled.
      }
      releaseRun(key);
    }
    inFlightDispatches.clear();
  }

  return {
    coordinatorSectionFor,
    dispatchTask,
    stopTask,
    retryTask,
    settleWorker,
    listActiveWork,
    dispose,
  };
}
