/**
 * Unified managed task domain schema (TaskCard -> Attempt/Run -> Session).
 * Lives in a non-tool-registering module so storage-domain metadata stays
 * cleanly separated from model-callable tool registration.
 */
import path from 'node:path';
import { z } from 'zod';
import { resolvedTaskRootDir, validateTaskCwd } from './task-paths.js';

const text = z.string().max(6000);

export const TASK_MODES = /** @type {const} */ (['workspace-task', 'readonly-brief']);
export const TASK_STATES = /** @type {const} */ ([
  'pending',
  'starting',
  'running',
  'waiting_approval',
  'waiting_input',
  'stopping',
  'review',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);
export const PENDING_INPUT_KINDS = /** @type {const} */ (['approval', 'question', 'other']);

export const BUSY_STATES = new Set([
  'starting',
  'running',
  'waiting_approval',
  'waiting_input',
  'stopping',
]);
export const TERMINAL_STATES = new Set([
  'review',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);

export const taskDeliverableSchema = z.object({
  path: z.string().max(2000),
  description: z.string().max(500).default(''),
  seq: z.number().int().nonnegative().default(0),
  index: z.number().int().nonnegative().default(0),
  sessionId: z.string().max(256).default(''),
});

export const taskRunSchema = z.object({
  runId: z.string().max(128),
  attempt: z.number().int().positive(),
  sessionId: z.string().max(256).default(''),
  mode: z.enum(TASK_MODES).default('workspace-task'),
  baseSeq: z.number().int().nonnegative().default(0),
  startedAt: z.number(),
  endedAt: z.number().default(0),
  state: z.enum(TASK_STATES).default('starting'),
  summary: text.default(''),
  error: text.default(''),
  deliverables: z.array(taskDeliverableSchema).max(50).default([]),
  evidence: z.array(z.string().max(256)).max(50).default([]),
});

export const taskOriginSchema = z.object({
  kind: z.enum(['desktop', 'im']).default('desktop'),
  actor: z.string().max(256).default('desktop-owner'),
  eventId: z.string().max(256).default(''),
  route: z.record(z.string(), z.unknown()).optional(),
  allowedFiles: z.array(z.string().max(2000)).max(20).optional(),
});

export const taskEffectSchema = z.object({
  id: z.string().max(256),
  target: z.enum(['session', 'im']),
  state: z.enum(['pending', 'sending', 'sent', 'failed', 'unknown', 'cancelled']),
  attempts: z.number().int().nonnegative().default(0),
  error: z.string().max(1000).default(''),
});

export const todoSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(200),
  description: text,
  criteria: text,
  mode: z.enum(TASK_MODES).default('workspace-task'),
  cwd: z.string().max(2000),
  dependsOn: z.array(z.string().max(128)).max(20).default([]),
  files: z.array(z.string().max(2000)).max(20).default([]),
  state: z.enum(TASK_STATES),
  pinned: z.boolean(),
  archived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  sessionId: z.string(),
  activeRunId: z.string().max(128).default(''),
  phase: z.string().max(240).default(''),
  pendingInput: z.array(z.enum(PENDING_INPUT_KINDS)).max(10).default([]),
  deliverables: z.array(taskDeliverableSchema).max(50).default([]),
  runs: z.array(taskRunSchema).max(50).default([]),
  origin: taskOriginSchema.default({ kind: 'desktop', actor: 'desktop-owner', eventId: '' }),
  effects: z.array(taskEffectSchema).max(20).default([]),
  legacyTaskId: z.string().max(128).default(''),
  error: text,
  summary: text,
  generation: z.number().int().nonnegative(),
});

export const todoDomain = {
  name: 'whale_todos',
  version: 1,
  tables: { cards: { valueSchema: todoSchema } },
};

/** @param {{ state?: string } | null | undefined} card */
export function isBusyCard(card) {
  return Boolean(card && BUSY_STATES.has(card.state));
}

/** @param {{ state?: string } | null | undefined} card */
export function isTerminalCard(card) {
  return Boolean(card && TERMINAL_STATES.has(card.state));
}

/** @param {{ state?: string } | null | undefined} card */
export function needsUserAttention(card) {
  return Boolean(card && (card.state === 'waiting_approval' || card.state === 'waiting_input'));
}

/**
 * Derive a filesystem-safe, human-readable per-task subdirectory slug.
 * @param {string} title
 * @param {string} id
 */
export function taskSubdirName(title, id) {
  const shortId = String(id ?? '').replace(/^todo-/u, '').replace(/[^A-Za-z0-9]/gu, '').slice(0, 8) || 'task';
  const cleaned = String(title ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[.-]+|[.-]+$/gu, '')
    .slice(0, 36);
  return cleaned ? `${cleaned}-${shortId}` : `task-${shortId}`;
}

/**
 * Resolve cwd for a new task card. Explicit cwd is validated and kept verbatim;
 * omitted cwd on workspace-task allocates an isolated per-task subdirectory
 * under the user's configured taskRootDir.
 * @param {{ rawCwd?: unknown, title: string, id: string, mode: string, settings?: any, home?: string }} input
 */
export function resolveCardCwd({ rawCwd, title, id, mode, settings, home }) {
  const trimmed = typeof rawCwd === 'string' ? rawCwd.trim() : '';
  if (trimmed) {
    return validateTaskCwd(trimmed, { dshHome: home, requireExisting: false });
  }
  const root = resolvedTaskRootDir(settings, home);
  if (mode === 'readonly-brief') {
    return validateTaskCwd(root, { dshHome: home, requireExisting: false });
  }
  const isolated = path.join(root, taskSubdirName(title, id));
  return validateTaskCwd(isolated, { dshHome: home, requireExisting: false });
}

/**
 * Compact structured receipt sent to the resident assistant ONLY after card
 * state has been durably persisted. Never includes raw tool logs.
 * @param {any} card
 * @param {any} [run]
 */
export function formatStructuredReceipt(card, run) {
  const stateLabel = {
    review: '待验收（review）',
    completed: '已完成',
    failed: '执行失败',
    cancelled: '已取消',
    interrupted: '已中断',
  }[card.state] ?? card.state;
  const lines = [
    `[任务回执] ${card.title} (${card.id})`,
    `模式：${card.mode}｜状态：${stateLabel}${run?.attempt ? `｜第 ${run.attempt} 次尝试` : ''}`,
  ];
  if (card.summary) lines.push(`摘要：${String(card.summary).trim().slice(0, 1000)}`);
  if (card.error) lines.push(`异常：${String(card.error).trim().slice(0, 500)}`);
  const files = Array.isArray(card.deliverables) ? card.deliverables : [];
  if (files.length) {
    lines.push(`产出文件（${files.length}）：${files.map((item) => item.description ? `${path.basename(item.path)}（${item.description}）` : path.basename(item.path)).join('、')}`);
  }
  if (card.sessionId) lines.push(`关联会话：${card.sessionId}`);
  return lines.join('\n');
}

const LEGACY_STATE_MAP = Object.freeze({
  queued: 'pending',
  running: 'running',
  stopping: 'stopping',
  completed: 'review',
  needs_user: 'waiting_input',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
  unknown: 'interrupted',
});
const EFFECT_STATES = new Set(['pending', 'sending', 'sent', 'failed', 'unknown', 'cancelled']);

function projectLegacyRuns(legacy, id, mappedState, summary, createdAt, updatedAt) {
  if (!legacy?.execution) return [];
  const evidence = Array.isArray(legacy.result?.evidence) ? legacy.result.evidence.map(String).slice(0, 50) : [];
  return [{
    runId: String(legacy.execution.id || `${id}-r1`),
    attempt: Number(legacy.revision) || 1,
    sessionId: String(legacy.execution.sessionId || ''),
    mode: 'readonly-brief',
    startedAt: Number(legacy.execution.startedAt) || createdAt,
    endedAt: updatedAt,
    state: mappedState,
    summary,
    error: String(legacy.error ?? '').slice(0, 6000),
    deliverables: [],
    evidence,
  }];
}

function projectLegacyEffects(legacy) {
  if (!Array.isArray(legacy?.effects)) return [];
  return legacy.effects.slice(0, 20).map((ef) => ({
    id: String(ef?.id ?? ''),
    target: ef?.target === 'im' ? 'im' : 'session',
    state: EFFECT_STATES.has(ef?.state) ? ef.state : 'unknown',
    attempts: Number(ef?.attempts) || 0,
    error: String(ef?.error ?? '').slice(0, 1000),
  })).filter((ef) => ef.id);
}

function projectLegacyOrigin(legacy) {
  const raw = legacy?.origin ?? {};
  return {
    kind: raw.kind === 'im' ? 'im' : 'desktop',
    actor: String(raw.actor ?? 'desktop-owner'),
    eventId: String(raw.eventId ?? ''),
    ...(raw.route ? { route: raw.route } : {}),
  };
}

function projectLegacyFiles(legacy) {
  if (!Array.isArray(legacy.inputs)) return [];
  return legacy.inputs.map((item) => String((item && (item.path || item.name)) || '')).filter(Boolean).slice(0, 20);
}

/**
 * Convert a legacy WhaleTasks record into a read-compatible unified TaskCard
 * without modifying or deleting the legacy `storages/whale_tasks.json` store.
 * @param {any} legacy
 * @param {{ home?: string, settings?: any }} opts
 */
export function projectLegacyTaskToCard(legacy, { home, settings }) {
  const row = legacy || {};
  const mappedState = LEGACY_STATE_MAP[row.state] || 'interrupted';
  const id = `todo-legacy-${String(row.id || 'unknown').slice(0, 64)}`;
  const createdAt = Number(row.createdAt) || Date.now();
  const updatedAt = Number(row.updatedAt) || createdAt;
  const summary = String((row.result && row.result.summary) || '').slice(0, 6000);
  const runs = projectLegacyRuns(row, id, mappedState, summary, createdAt, updatedAt);
  const lastRun = runs.at(-1);
  return todoSchema.parse({
    id,
    title: String(row.goal || '历史后台整理任务').trim().slice(0, 200) || '历史后台整理任务',
    description: '由历史后台资料整理任务平滑迁移（只读保留原记录）。',
    criteria: Array.isArray(row.criteria) ? row.criteria.join('；').slice(0, 6000) : '',
    mode: 'readonly-brief',
    cwd: resolvedTaskRootDir(settings, home),
    dependsOn: [],
    files: projectLegacyFiles(row),
    state: mappedState,
    pinned: false,
    archived: row.state === 'completed' || row.state === 'cancelled',
    createdAt,
    updatedAt,
    sessionId: String((row.execution && row.execution.sessionId) || ''),
    activeRunId: lastRun ? lastRun.runId : '',
    phase: mappedState === 'review' ? '待验收' : '',
    pendingInput: mappedState === 'waiting_input' ? ['question'] : [],
    deliverables: [],
    runs,
    origin: projectLegacyOrigin(row),
    effects: projectLegacyEffects(row),
    legacyTaskId: String(row.id || ''),
    error: String(row.error || '').slice(0, 6000),
    summary,
    generation: Number(row.generation) || 1,
  });
}
