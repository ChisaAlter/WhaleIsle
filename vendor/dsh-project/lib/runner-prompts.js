/**
 * Prompt builders, language rules, and summary formatters for `runner.js`.
 */
import { memoryIndex } from './memory.js';
import {
  counts,
  effortValue,
  formatCounts,
  modelRoute,
  presetValue,
} from './schema.js';

export const COORDINATOR_SECTION_NAME = 'projects:coordinator';
export const COORDINATOR_SECTION_ORDER = 700;
export const COORDINATOR_CONTEXT_NAME = 'projects:coordinator:state';
export const COORDINATOR_CONTEXT_ORDER = 700;

/** @type {Readonly<Record<string, string>>} */
const REPORT_STATUS_LABELS = Object.freeze({
  review: '待验收',
  failed: '失败',
  blocked: '受阻',
});

const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const LATIN = /[A-Za-z]/u;

/** @param {any} project @param {any} [task] */
export function replyLanguage(project, task) {
  const sample = (task?.brief || '').trim() || (project?.goal || '').trim();
  if (!sample) return '';
  if (KANA.test(sample)) return '';
  if (HAN.test(sample)) return 'zh';
  if (LATIN.test(sample)) return 'en';
  return '';
}

/** @param {string} language */
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

/** @param {any} project */
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
 * @param {any} project
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
 * @param {any} project
 * @param {{ memoryIndexText?: string, libraryIndexText?: string }} [options]
 */
export function coordinatorDynamicContextText(project, { memoryIndexText = '', libraryIndexText = '' } = {}) {
  const tasks = Array.isArray(project.tasks) ? project.tasks : [];
  const open = tasks.filter(/** @param {any} task */ (task) => task.status !== 'resolved');
  const tally = counts(tasks);
  const taskLines = open.length > 0
    ? open.slice(0, 40).map(/** @param {any} task */ (task) => `- ${task.id} [${task.status}]${task.approved ? ' approved' : ''} ${task.title}`).join('\n')
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

/** @param {any} task */
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

/**
 * @param {any} project
 * @param {any} task
 * @param {any} memoryFiles
 * @param {string | undefined} workdir
 * @param {string | undefined} branch
 * @param {string[]} [notes]
 */
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

/**
 * @param {any} project
 * @param {any} task
 * @param {string | undefined} workdir
 * @param {string[]} notes
 */
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

/** @param {{ project: any, task: any, memoryFiles: any, envInfo: any, notes: string[], exec: any, controller: AbortController }} opts */
export function buildActivationParams({ project, task, memoryFiles, envInfo, notes, exec, controller }) {
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

/** @param {{ task: any, started: any, childSessionId: string, route: any, effort: any, agentPreset: any, envInfo: any, continueFailure: string }} opts */
export function formatDispatchSummary({ task, started, childSessionId, route, effort, agentPreset, envInfo, continueFailure }) {
  const routeNote = route === undefined ? '' : ` model=${route.provider ? `${route.provider}/` : ''}${route.model}`;
  const presetNote = agentPreset ? ` preset=${agentPreset}` : '';
  const effortNote = effort ? ` effort=${effort}` : '';
  const fallbackNote = continueFailure
    ? ` The earlier worker session could not be continued (${continueFailure}), so this is a fresh session without its context.`
    : '';
  return `Dispatched task ${task.id} to worker ${started.name || childSessionId} (session ${childSessionId})${routeNote}${effortNote}${presetNote}.${envInfo.isolationNote} It runs in the background; its final message lands on the task when it settles.${fallbackNote}`;
}

/** @param {any} raw */
export function compactOutputSummary(raw) {
  const cleaned = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > 260 ? `${cleaned.slice(0, 260).trimEnd()}…` : cleaned;
}

/** @param {any} mergeability */
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

/**
 * @param {any} project
 * @param {any[]} items
 * @param {boolean} allSettled
 */
export function formatCoordinatorReportReceipt(project, items, allSettled) {
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
