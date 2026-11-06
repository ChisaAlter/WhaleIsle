/** One durable aggregate owns task execution, reports and outbound effects. */
import { z } from 'zod';
import crypto from 'node:crypto';

const id = z.string().min(1).max(512);
const route = z.object({ channel: z.literal('feishu'), botId: id, incarnation: id,
  actor: id, chatId: id, messageId: id });
const input = z.object({ id, path: id, name: id, hash: id, bytes: z.number().int().nonnegative(),
  text: z.string().max(100000) });
const origin = z.object({ eventId: id, sessionId: id, messageId: id, rpcId: z.string(),
  actor: id, kind: z.enum(['desktop', 'im']), text: z.string().max(20000),
  route: route.optional(), files: z.array(z.string()).max(8) });
const report = z.object({ summary: z.string().trim().min(1).max(6000), evidence: z.array(id).max(8),
  coveredCriteria: z.array(z.string().min(1).max(300)).max(10),
  unmet: z.array(z.string().min(1).max(300)).max(10), outcome: z.enum(['completed', 'needs_user', 'failed']) });
const effect = z.object({ id, target: z.enum(['session', 'im', 'pet']), state: z.enum(['pending', 'sending', 'sent', 'failed', 'unknown', 'cancelled']),
  attempts: z.number().int().nonnegative(), nextAt: z.number(), content: z.string().max(9000),
  receipt: z.object({ providerMessageIds: z.array(z.string()), outcome: z.string(), read: z.literal('unknown') }).optional(), error: z.string().optional() });
export const taskSchema = z.object({ id, revision: z.number().int().positive(), generation: z.number().int().positive(),
  origin, goal: z.string().min(1).max(1000), criteria: z.array(z.string()).max(10), inputs: z.array(input).min(1).max(8),
  model: z.object({ provider: id, model: id }), state: z.enum(['queued', 'running', 'needs_user', 'stopping', 'cancelled', 'completed', 'failed', 'interrupted', 'unknown']),
  hold: z.boolean(), createdAt: z.number(), updatedAt: z.number(), error: z.string(),
  controlSources: z.array(z.object({ action: z.enum(['stop', 'resume']), eventId: id, messageId: id, actor: id, at: z.number() })).max(30).default([]),
  execution: z.object({ id, sessionId: id, promptId: id, generation: z.number(), startedAt: z.number(), deadlineAt: z.number(),
    requests: z.number().int().nonnegative(), readBytes: z.number().int().nonnegative(), readIds: z.array(id),
    terminal: z.object({ seq: z.number(), kind: z.string() }).optional(), report: report.optional() }).optional(),
  result: report.extend({ id }).optional(), effects: z.array(effect).max(3),
  history: z.array(z.object({ revision: z.number().int().positive(), generation: z.number().int().positive(), state: z.string(),
    execution: z.unknown().optional(), result: z.unknown().optional(), effects: z.array(effect) })).max(10).default([]) });
export const taskDomain = { name: 'whale_tasks', version: 1, tables: {
  tasks: { valueSchema: taskSchema }, origins: { valueSchema: origin },
  owners: { valueSchema: z.object({ channel: z.literal('feishu'), botId: id, actor: id }) },
} };
export const stableId = (prefix, ...parts) => `${prefix}-${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)}`;
export const copy = value => structuredClone(value);
export const digest = value => crypto.createHash('sha256').update(value).digest('hex');

/** Single owner serializes admission as well as record-level CAS. */
export class TaskStore {
  constructor(domain) { this.domain = domain; this.tasks = domain.table('tasks'); this.origins = domain.table('origins'); this.owners = domain.table('owners'); this.chain = Promise.resolve(); }
  serial(fn) { const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next; }
  get(id) { const value = this.tasks.get(id); if (!value) throw new Error('找不到任务。'); return copy(value); }
  list() { return [...this.tasks.entries()].map(([, value]) => copy(value)); }
  async put(value) { const parsed = taskSchema.parse(value); await this.tasks.put(parsed.id, parsed); return copy(parsed); }
  async change(id, fn) { return this.tasks.update(id, current => taskSchema.parse(fn(copy(current)))); }
  async close() { await this.chain; await this.domain.close(); }
}

/** Explicit human syntax keeps task scope out of model-generated arguments. */
export function parseTask(text) {
  const match = /^\/task\s+(\{[\s\S]*\})\s*$/u.exec(text.trim());
  if (!match) throw new Error('后台整理请明确发送 /task {"goal":"整理重点","files":["绝对文件路径"]}；IM 仅可使用本条消息附带的资料。');
  const value = JSON.parse(match[1]);
  return z.object({ goal: z.string().trim().min(1).max(1000), files: z.array(z.string().min(1).max(512)).min(1).max(8),
    criteria: z.array(z.string().trim().min(1).max(300)).min(1).max(10).default(['给出有来源引用的资料摘要']) }).strict().parse(value);
}

export const taskLimits = Object.freeze({ maxInputBytes: 100000, maxTotalInputBytes: 300000,
  maxReadBytes: 500000, maxRequests: 12, maxOutputTokens: 2048, deadlineMs: 300000,
  maxTasks: 100, maxDeliveryAttempts: 3 });

export function resultText(task) {
  const result = task.result;
  const boundedSummary = result.summary.length > 3000 ? `${result.summary.slice(0, 3000)}\n（完整摘要见主窗任务记录）` : result.summary;
  return [`资料整理 ${task.id}`, `状态：${task.state}`, boundedSummary,
    `来源：${result.evidence.map(ref => task.inputs.find(input => input.id === ref)?.name ?? ref).join('、') || '无已核对引用'}`,
    ...(result.unmet.length ? [`未满足：${result.unmet.join('；')}`] : []),
    '完整记录保留在鲸鱼娘任务状态中。'].join('\n\n');
}
