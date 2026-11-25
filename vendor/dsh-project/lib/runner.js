/**
 * Execution engine for Projects:
 * - Dynamic `projects:coordinator` system prompt section (order 700, zero impact on other sessions)
 * - Worker dispatch with concurrency/dependency/approval/pause/admission gates
 * - Existing worker session continuation (`ctx.subagents.sendMessage` + `pendingNotes`)
 * - Single-task stop (`AbortController` + subtree drain) and single-task retry
 * - `subagent/end` settlement serialized through the per-project write queue
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  beginDesktopAdmission,
  drainAgentAndJobs,
} from '../../dsh-shared/lib/managed-task-runtime.mjs';
import { safeReadStoreFileSync } from './files.js';
import { memoryIndex } from './memory.js';
import {
  MAX_OUTPUT,
  blocksToText,
  counts,
  dependencyGate,
  effectiveTaskRoute,
  effortValue,
  formatCounts,
  httpError,
  messageOf,
  modelRoute,
  presetValue,
  routeChanged,
  workerIsLive,
} from './schema.js';
import { isDirectory } from './store.js';

export const COORDINATOR_SECTION_NAME = 'projects:coordinator';
export const COORDINATOR_SECTION_ORDER = 700;
export const COORDINATOR_CONTEXT_NAME = 'projects:coordinator:state';
export const COORDINATOR_CONTEXT_ORDER = 700;
const DEFAULT_NOTIFY_BATCH_MS = 1_500;
const MAX_NOTIFIED_REVISIONS = 500;
const REPORT_STATUS_LABELS = Object.freeze({
  review: '待验收',
  failed: '失败',
  blocked: '受阻',
});

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
    '## Your job (Clarify -> Parallel Fan-out -> Summarize)',
    'You are the Chief-of-Staff coordinator: clarify only genuine decisions, split & dispatch parallel workers, keep shared memory/library organized, and summarize results for human acceptance.',
    '',
    '1. Clarify before guessing, without stalling: if the request has genuine ambiguities only the human can decide (product scope, trade-offs, destructive choices), ask 1-3 short, direct questions; for independent read-only or unambiguous subtasks, fan them out in parallel immediately.',
    '2. Anything requiring reading files, editing code, running commands, or multi-step investigation must be delegated via projects_add_task + projects_dispatch (or continuing an existing worker). Do not execute implementation work directly in this conversation.',
    '3. Split goals into parallel, independently finishable tasks; set depends_on only when strict ordering is required. For parallel editing tasks, assign disjoint writePaths (or rely on worktree isolation) so workers never overwrite each other.',
    '4. Use projects_dispatch to launch tasks and return immediately so this conversation stays responsive.',
    '5. The human exclusively owns acceptance ("resolved") and Git worktree merges. Workers and the coordinator only deliver work to status "review"; never attempt to mark tasks "resolved".',
    project.autonomy === 'manual'
      ? '6. Autonomy is manual: obtain explicit user approval (on the board or in chat via projects_update_task approved=true) before dispatching.'
      : '6. Autonomy is auto: dispatch queued tasks immediately without waiting for per-task approval.',
    ...(project.paused ? ['   NOTE: This project is currently PAUSED. Do not dispatch until the user resumes it.'] : []),
    '7. Prefer continuing an existing worker (projects_dispatch with `note`, or projects_update_task with `append_brief`) whenever follow-up work builds on files, context, or conclusions that worker already established. Create a new task only for genuinely independent work.',
    '8. Maintain durable project knowledge in projects_memory (one topic file per subject, attach sourceTaskId when derived from a task) and record key deliverable files via projects_update_task `artifacts`.',
    '',
    '## How to write a task brief',
    '1. State three things clearly: the problem, constraints, and concrete acceptance criteria (how to verify).',
    '2. Do not micromanage step-by-step implementation or paste stale line numbers.',
    '3. Keep briefs concise (typically <= 15 lines) and avoid duplicating standing project instructions.',
    '',
    '## Reply style & worker report-backs',
    '1. Lead with the conclusion or action; skip process narration.',
    '2. NEVER expose raw internal task IDs (such as t-xxxxxxxx) in user-facing replies — always refer to tasks by their readable title.',
    '3. When dispatching, state briefly what was dispatched, why, and what you are waiting for without repeating the full brief.',
    '4. When receiving a `[项目执行回执]` worker report-back, summarize each completed/blocked task in 1-2 concise sentences (in the user language) naming the task title, key deliverables/changed files, and acceptance/merge recommendation. When all active tasks have settled, give a crisp overall wrap-up.',
  ].join('\n');
}

/**
 * Stable, Prompt-Cache-friendly coordinator prefix (registered via `systemPrompt.section`).
 * Does NOT embed volatile task statuses or live memory index so KV cache survives board churn.
 */
export function coordinatorSectionText(project) {
  return [
    `You are the coordinator of the WhaleIsle project "${project.name}" (project_id: ${project.id}).`,
    `Workspace: ${project.workspace || '(inherited default directory)'}`,
    `Autonomy: ${project.autonomy} · Concurrency: ${project.concurrency || 3}${project.paused ? ' · PAUSED' : ''}${project.worktreeIsolation ? ' · Worktree isolation: on' : ''}`,
    '',
    '## Project instructions',
    (project.goal || '').trim() || '(none)',
    '',
    coordinatorRules(project),
  ].join('\n');
}

/**
 * Volatile per-turn coordinator runtime state (registered via `systemPrompt.context`).
 * Holds live task board snapshot, Project Library index, and Hot Shared Memory index.
 */
export function coordinatorDynamicContextText(project, { memoryIndexText = '', libraryIndexText = '' } = {}) {
  const tasks = Array.isArray(project.tasks) ? project.tasks : [];
  const open = tasks.filter((task) => task.status !== 'resolved');
  const tally = counts(tasks);
  const taskLines = open.length > 0
    ? open.slice(0, 40).map((task) => `- ${task.id} [${task.status}]${task.approved ? ' approved' : ''} ${task.title}`).join('\n')
    : tasks.length === 0
      ? '(none yet)'
      : '(no open tasks)';
  const hiddenResolved = tally.resolved > 0
    ? `\n(${tally.resolved} resolved task(s) hidden — read their output via projects_get with include_resolved: true.)`
    : '';
  const sections = [
    `## Live project state (${project.name})`,
    `counts: ${formatCounts(tally)}`,
    `${taskLines}${hiddenResolved}`,
  ];
  if (libraryIndexText && libraryIndexText.trim()) {
    sections.push('', '## Project library (references & task artifacts)', libraryIndexText.trim());
  }
  if (memoryIndexText && memoryIndexText.trim()) {
    sections.push('', '## Shared project memory index', memoryIndexText.trim());
  }
  return sections.join('\n');
}

function scopeRestrictionLines(task) {
  if (!task?.scopeCeiling) return [];
  const lines = ['', '## Authorization ceiling (enforced by runtime guard)'];
  lines.push(`- Scope ceiling: ${task.scopeCeiling}`);
  if (task.scopeCeiling === 'readonly' || task.scopeCeiling === 'research') {
    lines.push('- File edits and shell/command execution are disabled for this task. Inspect and report only.');
  } else if (task.scopeCeiling === 'docs') {
    lines.push('- Only documentation files (.md/.mdx/.txt/.rst/.adoc) may be written.');
  }
  if (Array.isArray(task.writePaths) && task.writePaths.length > 0) {
    lines.push(`- Allowed relative write paths: ${task.writePaths.join(', ')}`);
  }
  return lines;
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
  lines.push(...scopeRestrictionLines(task));
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

export function createRunner({ ctx, store, memory, worktree, library = null, notifyBatchMs = DEFAULT_NOTIFY_BATCH_MS }) {
  /** @type {Map<string, { controller: AbortController, childSessionId: string, permit: any, projectId: string, taskId: string, parent: any }>} */
  const activeRuns = new Map();
  /** @type {Set<string>} taskKeys currently reserving a slot during async startActivation */
  const inFlightDispatches = new Set();
  /** @type {Set<string>} taskKeys currently inside stopTask so settleWorker does not emit a duplicate/conflicting update */
  const stoppingTasks = new Set();
  /** @type {Map<string, { info: any, at: number }>} buffered subagent/end events that arrived before spawnFreshWorker wrote project.json */
  const earlySettlements = new Map();
  /** @type {Map<string, { timer: any, items: Map<string, any> }>} 1.5s per-project batching queue for coordinator report-backs */
  const pendingReports = new Map();
  /** @type {Set<string>} idempotent dedup set keyed by projectId:taskId:settledAt */
  const notifiedRevisions = new Set();
  let disposed = false;

  const taskKey = (projectId, taskId) => `${projectId}:${taskId}`;

  function recordNotifiedRevision(revKey) {
    if (notifiedRevisions.has(revKey)) return false;
    notifiedRevisions.add(revKey);
    if (notifiedRevisions.size > MAX_NOTIFIED_REVISIONS) {
      const oldest = notifiedRevisions.values().next().value;
      if (oldest !== undefined) notifiedRevisions.delete(oldest);
    }
    return true;
  }

  function compactOutputSummary(raw) {
    const cleaned = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    return cleaned.length > 260 ? `${cleaned.slice(0, 260).trimEnd()}…` : cleaned;
  }

  function formatMergeabilityShort(mergeability) {
    if (!mergeability || !mergeability.status || mergeability.status === 'unavailable') return '';
    if (mergeability.status === 'clean') return '可无冲突合并';
    if (mergeability.status === 'already_merged') return '已合并';
    if (mergeability.status === 'conflicts') {
      const files = Array.isArray(mergeability.conflictFiles) && mergeability.conflictFiles.length > 0
        ? `：${mergeability.conflictFiles.slice(0, 3).join(', ')}`
        : '';
      return `存在合并冲突${files}`;
    }
    if (mergeability.status === 'dirty_worktree') return '工作树有未提交改动';
    if (mergeability.status === 'dirty_workspace') return '主工作区有未提交改动';
    return '';
  }

  function formatCoordinatorReportReceipt(project, items, allSettled) {
    const header = `[项目执行回执] 项目「${project.name}」有 ${items.length} 个任务完成或需要处理${allSettled ? '（当前全部活跃任务已收尾）' : ''}：`;
    const lines = [header];
    for (const item of items) {
      const statusLabel = REPORT_STATUS_LABELS[item.status] || item.status;
      const meta = [];
      if (item.changedFiles > 0) meta.push(`变更 ${item.changedFiles} 个文件`);
      const mergeHint = formatMergeabilityShort(item.mergeability);
      if (mergeHint) meta.push(mergeHint);
      if (item.stopReason && item.status !== 'review') meta.push(`原因：${item.stopReason}`);
      lines.push(`- 「${item.title}」｜状态：${statusLabel}${meta.length ? `｜${meta.join('，')}` : ''}`);
      if (item.summary) lines.push(`  摘要：${item.summary}`);
      if (Array.isArray(item.artifacts) && item.artifacts.length > 0) {
        lines.push(`  产物：${item.artifacts.slice(0, 6).join('、')}${item.artifacts.length > 6 ? ' 等' : ''}`);
      }
    }
    lines.push(
      '',
      `请用简洁的中文向用户总结结论并给出验收/合并建议（直呼任务标题，不要输出内部 ID）${allSettled ? '，并补充整项目收尾汇总' : ''}。`,
    );
    return lines.join('\n');
  }

  async function deliverCoordinatorReport(project, items, allSettled) {
    const sid = typeof project?.coordinatorSessionId === 'string' ? project.coordinatorSessionId.trim() : '';
    if (!sid || disposed) return false;
    const receiptText = formatCoordinatorReportReceipt(project, items, allSettled);
    const taskIds = items.map((item) => item.taskId);
    const requestId = `dsh-project-report:${project.id}:${taskIds.join(',')}:${items.map((item) => item.settledAt).join(',')}`.slice(0, 180);

    const controller = getService('sessionController');
    if (typeof controller?.prompt === 'function') {
      try {
        await controller.prompt(
          {
            sessionId: sid,
            requestId,
            mode: 'queue',
            content: [{ type: 'text', text: receiptText }],
          },
          new AbortController().signal,
        );
        return true;
      } catch {
        // Fall through to live coordinator.followup fallback.
      }
    }

    const coordinator = await resolveCoordinatorAgent(project);
    if (typeof coordinator?.followup === 'function') {
      try {
        const message = createUserMessage({
          content: [{ type: 'text', text: receiptText }],
          source: {
            kind: 'user',
            form: 'relay',
            plugin: 'dsh-project:worker-report',
            projectId: project.id,
            taskIds,
          },
        });
        await coordinator.followup(message);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async function flushCoordinatorReports(projectId) {
    const bucket = pendingReports.get(projectId);
    if (!bucket) return;
    clearTimeout(bucket.timer);
    pendingReports.delete(projectId);
    if (disposed || bucket.items.size === 0) return;

    let project;
    try {
      project = await store.readProject(projectId);
    } catch {
      return;
    }
    if (project.archived || project.paused || !project.coordinatorSessionId) return;

    const items = [...bucket.items.values()];
    const allSettled = !(project.tasks || []).some(
      (candidate) =>
        workerIsLive(candidate)
        || candidate.status === 'running'
        || (candidate.status === 'queued' && (project.autonomy === 'auto' || candidate.approved === true)),
    );

    const delivered = await deliverCoordinatorReport(project, items, allSettled);
    if (delivered) {
      store.emitChange({
        type: 'coordinator.notified',
        projectId,
        taskIds: items.map((item) => item.taskId),
        allSettled,
      });
    }
  }

  async function collectSettlementArtifactsAndDiff(project, task) {
    let changedFiles = 0;
    let mergeability = null;
    let artifactPaths = [];

    if (task.worktreePath || (task.status === 'review' && project.workspace)) {
      try {
        const diff = await worktree.getTaskDiff(project, task);
        if (diff && diff.available) {
          changedFiles = Array.isArray(diff.files) ? diff.files.length : 0;
          mergeability = diff.mergeability || null;
          if (task.status === 'review' && library && changedFiles > 0 && task.worktreePath) {
            await library.collectWorktreeArtifacts(project, task, diff.files);
          }
        }
      } catch {
        // Diff/artifact collection is best-effort and never blocks settlement.
      }
    }

    if (library) {
      try {
        const lib = await library.readLibrary(project);
        artifactPaths = (lib.artifacts || [])
          .filter((entry) => entry.taskId === task.id)
          .map((entry) => entry.relativePath || entry.title)
          .filter(Boolean);
      } catch {
        artifactPaths = [];
      }
    }

    return { changedFiles, mergeability, artifactPaths };
  }

  async function enqueueCoordinatorReport(project, task) {
    if (disposed || !project || !task) return;
    if (!['review', 'failed', 'blocked'].includes(task.status)) return;
    if (task.stopReason === 'stopped_by_user' || task.stopReason === 'interrupted_by_restart') return;

    // Always collect review artifacts & diff metadata even when coordinatorSessionId is absent or paused.
    const { changedFiles, mergeability, artifactPaths } = await collectSettlementArtifactsAndDiff(project, task);
    if (disposed) return;

    if (project.archived || project.paused || !project.coordinatorSessionId) return;

    const settledAt = Number(task.finishedAt || task.updatedAt) || Date.now();
    const revKey = `${project.id}:${task.id}:${settledAt}`;
    if (!recordNotifiedRevision(revKey)) return;

    let bucket = pendingReports.get(project.id);
    if (!bucket) {
      const delay = Math.max(0, Number(notifyBatchMs) || 0);
      const timer = setTimeout(() => {
        void flushCoordinatorReports(project.id).catch(() => {
          // Best-effort batched coordinator report-back.
        });
      }, delay);
      timer.unref?.();
      bucket = { timer, items: new Map() };
      pendingReports.set(project.id, bucket);
    }

    bucket.items.set(task.id, {
      taskId: task.id,
      title: task.title,
      status: task.status,
      stopReason: task.stopReason || '',
      summary: compactOutputSummary(task.output),
      changedFiles,
      mergeability,
      artifacts: artifactPaths,
      settledAt,
    });
  }

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
        void enqueueCoordinatorReport(settledSnapshot.project, settledSnapshot.task).catch(() => {});
        void scheduleReadyTasks(project.id).catch(() => {});
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
      await enqueueCoordinatorReport(settledSnapshot.project, settledSnapshot.task).catch(() => {});
      if (settledSnapshot.slotFreed && !settledSnapshot.project.archived && !settledSnapshot.project.paused) {
        void scheduleReadyTasks(matchProjectId).catch(() => {});
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
    disposed = true;
    for (const bucket of pendingReports.values()) {
      clearTimeout(bucket.timer);
    }
    pendingReports.clear();
    notifiedRevisions.clear();
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
