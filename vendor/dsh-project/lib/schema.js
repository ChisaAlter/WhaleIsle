/**
 * Core data schema, constants, normalization, and pure domain helpers for Projects.
 * Single source of truth shared across store, memory, worktree, runner, tools, and HTTP.
 */
import { randomBytes } from 'node:crypto';

export const STATUSES = Object.freeze(['queued', 'running', 'review', 'failed', 'blocked', 'resolved']);
export const HUMAN_TASK_FIELDS = Object.freeze(['status']);
export const HUMAN_STATUSES = Object.freeze(['resolved', 'review']);
export const AUTONOMY = Object.freeze(['manual', 'auto']);

export const MAX_GOAL = 16_000;
export const MAX_BRIEF = 8_000;
export const MAX_OUTPUT = 4_000;
export const MAX_NOTE = 4_000;
export const MAX_PENDING_NOTES = 20;
export const MAX_TASKS = 200;
export const MAX_DEPENDS_ON = 20;
export const MAX_MODEL = 200;
export const MAX_PRESET = 120;
export const MAX_EFFORT = 60;
export const MAX_CONCURRENCY = 8;
export const DEFAULT_CONCURRENCY = 3;

export const MEMORY_BUDGET = 64_000;
export const MEMORY_BUDGET_MIN = 4_000;
export const MEMORY_BUDGET_MAX = 200_000;
export const MAX_MEMORY = 200_000;
export const MEMORY_TARGET_RATIO = 0.6;
export const MEMORY_INDEX_LIMIT = 4_000;
export const MEMORY_INDEX_TOOL_LIMIT = 8_000;
export const MEMORY_DESCRIPTION_MAX = 80;
export const MEMORY_SEARCH_LIMIT = 10;
export const MEMORY_NAME_MAX = 60;
export const MEMORY_TYPE_MAX = 40;
export const MEMORY_STALE_MARKERS = Object.freeze(['[superseded]', '[archived]']);

export const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function newId(prefix) {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

export function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

export function httpError(status, message, extra = undefined) {
  const error = new Error(message);
  error.status = status;
  if (extra && typeof extra === 'object') Object.assign(error, extra);
  return error;
}

export function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function intIn(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

export function modelValue(value) {
  return text(value, MAX_MODEL).trim();
}

export function presetValue(value) {
  return text(value, MAX_PRESET).trim();
}

export function effortValue(value) {
  return text(value, MAX_EFFORT).trim();
}

/**
 * Translate a stored `provider/model` or bare model id into `agentOptions` route fields.
 * Returns undefined when unset so callers omit `agentOptions`.
 */
export function modelRoute(value) {
  const raw = modelValue(value);
  if (!raw) return undefined;
  const slash = raw.indexOf('/');
  if (slash > 0 && slash < raw.length - 1) {
    return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
  }
  return { model: raw };
}

export function dependencyIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (!id || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

function attachSessionFields(task, raw) {
  if (typeof raw.childSessionId === 'string' && raw.childSessionId.trim()) {
    task.childSessionId = raw.childSessionId.trim();
  }
  if (typeof raw.childName === 'string' && raw.childName.trim()) {
    task.childName = text(raw.childName.trim(), 200);
  }
  if (raw.childRoute && typeof raw.childRoute === 'object') {
    task.childRoute = {
      model: text(raw.childRoute.model, MAX_MODEL),
      agentPreset: text(raw.childRoute.agentPreset, MAX_PRESET),
      effort: text(raw.childRoute.effort, MAX_EFFORT),
    };
  }
  if (Array.isArray(raw.pendingNotes)) {
    const notes = raw.pendingNotes
      .filter((note) => typeof note === 'string' && note.trim())
      .slice(-MAX_PENDING_NOTES)
      .map((note) => text(note.trim(), MAX_BRIEF));
    if (notes.length > 0) task.pendingNotes = notes;
  }
  if (typeof raw.stopReason === 'string' && raw.stopReason.trim()) {
    task.stopReason = text(raw.stopReason.trim(), 120);
  }
}

function attachWorktreeFields(task, raw) {
  if (typeof raw.branch === 'string' && raw.branch.trim()) {
    task.branch = text(raw.branch.trim(), 200);
  }
  if (typeof raw.worktreePath === 'string' && raw.worktreePath.trim()) {
    task.worktreePath = text(raw.worktreePath.trim(), 1024);
  }
  if (typeof raw.baseCommit === 'string' && /^[0-9a-f]{7,64}$/i.test(raw.baseCommit.trim())) {
    task.baseCommit = raw.baseCommit.trim();
  }
  if (typeof raw.worktreeDegraded === 'string' && raw.worktreeDegraded.trim()) {
    task.worktreeDegraded = text(raw.worktreeDegraded.trim(), 60);
  }
  if (typeof raw.worktreeNote === 'string' && raw.worktreeNote.trim()) {
    task.worktreeNote = text(raw.worktreeNote.trim(), 600);
  }
  if (Number(raw.startedAt)) task.startedAt = Number(raw.startedAt);
  if (Number(raw.finishedAt)) task.finishedAt = Number(raw.finishedAt);
}

export function normalizeTask(raw = {}) {
  const accepted = raw.status === 'done' || raw.resolved === true;
  const task = {
    id: typeof raw.id === 'string' && TASK_ID_RE.test(raw.id) ? raw.id : newId('t'),
    title: text(raw.title, 200).trim() || 'Untitled task',
    brief: text(raw.brief, MAX_BRIEF),
    status: accepted ? 'resolved' : STATUSES.includes(raw.status) ? raw.status : 'queued',
    approved: raw.approved === true,
    dependsOn: dependencyIds(raw.dependsOn),
    output: text(raw.output, MAX_OUTPUT),
    model: modelValue(raw.model),
    agentPreset: presetValue(raw.agentPreset),
    reasoningEffort: effortValue(raw.reasoningEffort),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
  attachSessionFields(task, raw);
  attachWorktreeFields(task, raw);
  return task;
}

export function memoryBudgetOf(project) {
  return intIn(project?.memoryBudget, MEMORY_BUDGET_MIN, MEMORY_BUDGET_MAX, MEMORY_BUDGET);
}

export function normalizeProject(raw = {}) {
  const id = typeof raw.id === 'string' && PROJECT_ID_RE.test(raw.id) ? raw.id : newId('p');
  return {
    version: 2,
    id,
    name: text(raw.name, 120).trim() || 'Untitled project',
    goal: text(raw.goal, MAX_GOAL),
    workspace: text(raw.workspace, 1024).trim(),
    autonomy: AUTONOMY.includes(raw.autonomy) ? raw.autonomy : 'manual',
    concurrency: intIn(raw.concurrency, 1, MAX_CONCURRENCY, DEFAULT_CONCURRENCY),
    paused: raw.paused === true,
    archived: raw.archived === true,
    worktreeIsolation: raw.worktreeIsolation === true,
    model: modelValue(raw.model),
    agentPreset: presetValue(raw.agentPreset),
    reasoningEffort: effortValue(raw.reasoningEffort),
    autoCompact: raw.autoCompact !== false,
    memoryBudget: memoryBudgetOf(raw),
    ...(raw.lastCompaction && typeof raw.lastCompaction === 'object'
      ? {
          lastCompaction: {
            at: Number(raw.lastCompaction.at) || 0,
            before: Number(raw.lastCompaction.before) || 0,
            after: Number(raw.lastCompaction.after) || 0,
            archived: Number(raw.lastCompaction.archived) || 0,
          },
        }
      : {}),
    ...(typeof raw.coordinatorSessionId === 'string' && raw.coordinatorSessionId.trim()
      ? { coordinatorSessionId: raw.coordinatorSessionId.trim() }
      : {}),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    tasks: Array.isArray(raw.tasks) ? raw.tasks.slice(0, MAX_TASKS).map(normalizeTask) : [],
  };
}

export function counts(tasks = []) {
  const result = { queued: 0, running: 0, review: 0, failed: 0, blocked: 0, resolved: 0 };
  for (const task of tasks) {
    if (task && Object.hasOwn(result, task.status)) {
      result[task.status] += 1;
    }
  }
  return result;
}

export function formatCounts(tally) {
  const parts = STATUSES.filter((key) => (tally[key] || 0) > 0).map((key) => `${tally[key]} ${key}`);
  return parts.join(', ') || 'none';
}

export function summarizeProject(project) {
  return {
    id: project.id,
    name: project.name,
    workspace: project.workspace,
    autonomy: project.autonomy,
    concurrency: project.concurrency,
    paused: project.paused === true,
    archived: project.archived === true,
    worktreeIsolation: project.worktreeIsolation === true,
    model: project.model || '',
    agentPreset: project.agentPreset || '',
    reasoningEffort: project.reasoningEffort || '',
    autoCompact: project.autoCompact !== false,
    memoryBudget: memoryBudgetOf(project),
    ...(project.lastCompaction ? { lastCompaction: project.lastCompaction } : {}),
    ...(project.coordinatorSessionId ? { coordinatorSessionId: project.coordinatorSessionId } : {}),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    counts: counts(project.tasks),
  };
}

/**
 * Whether a worker subagent is still live behind a task.
 * Checking `finishedAt` keeps concurrency accurate even if the human resolves
 * a task while its worker is still running.
 */
export function workerIsLive(task) {
  if (!task || !task.childSessionId || task.finishedAt) return false;
  return task.status === 'running' || task.status === 'resolved';
}

export function taskRoute(task) {
  return {
    model: task?.model || '',
    agentPreset: task?.agentPreset || '',
    effort: task?.reasoningEffort || '',
  };
}

export function routeChanged(task) {
  const recorded = task?.childRoute;
  if (!recorded) return false;
  const wanted = taskRoute(task);
  return recorded.model !== wanted.model
    || recorded.agentPreset !== wanted.agentPreset
    || recorded.effort !== wanted.effort;
}

export function dependencyCycle(task, byId) {
  const path = [];
  const settled = new Set();
  const walk = (current) => {
    const at = path.indexOf(current.id);
    if (at !== -1) return [...path.slice(at), current.id];
    if (settled.has(current.id)) return null;
    path.push(current.id);
    for (const id of current.dependsOn || []) {
      const next = byId.get(id);
      if (!next) continue;
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    path.pop();
    settled.add(current.id);
    return null;
  };
  return walk(task);
}

export function dependencyGate(project, task) {
  const byId = new Map((project.tasks || []).map((candidate) => [candidate.id, candidate]));
  const missing = [];
  const unresolved = [];
  for (const id of task.dependsOn || []) {
    const dependency = byId.get(id);
    if (!dependency) missing.push(id);
    else if (dependency.status !== 'resolved') unresolved.push(dependency);
  }
  return {
    self: (task.dependsOn || []).includes(task.id),
    missing,
    unresolved,
    cycle: dependencyCycle(task, byId),
  };
}

export function blocksToText(blocks) {
  if (!Array.isArray(blocks)) return '';
  const parts = [];
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}
