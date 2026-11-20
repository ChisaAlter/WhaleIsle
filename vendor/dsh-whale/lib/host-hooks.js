/**
 * Modular Host hooks for `dsh-whale`:
 * - Unified `todos/*` RPC dispatcher
 * - Monotonic `MEMORY.md` cap & anti-deletion `ctx.tools.guard()` hook
 * - Pre-compaction flush (`agent/pre-step`) + idle incremental memory review (`turn/end`)
 * - Plugin-sourced pulse wake delivery (never targeting active task/subagent sessions)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { whaleHomeDir } from './preset.js';
import { parseTask } from './task-store.js';
import { controllerFrom, trimTo } from './shared.js';
import { isUnattendedPulseTurn } from './call-origin.js';
import {
  evaluateIndexWriteGuard,
  maybeTriggerPreCompactionFlush,
  memoryDirPath,
  memoryIndexPath,
  runIdleIncrementalMemoryReview,
} from './memory-store.js';
import { buildWorkbenchSnapshot } from './sse-hub.js';

const WRITE_TOOL_NAMES = new Set(['write', 'write_file', 'fs_write', 'create_file']);
const EDIT_TOOL_NAMES = new Set(['edit', 'edit_file', 'fs_edit', 'multi_edit', 'replace_file']);
const DELETE_TOOL_NAMES = new Set(['delete', 'delete_file', 'remove_file', 'rm', 'unlink']);

function normPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function extractToolTargetPath(args) {
  if (typeof args?.path === 'string') return args.path;
  if (typeof args?.file_path === 'string') return args.file_path;
  if (typeof args?.filePath === 'string') return args.filePath;
  return '';
}

function checkDirectEditGuard(home, args) {
  const oldStr = typeof args?.old_string === 'string' ? args.old_string
    : typeof args?.oldText === 'string' ? args.oldText : '';
  const newStr = typeof args?.new_string === 'string' ? args.new_string
    : typeof args?.newText === 'string' ? args.newText : '';
  if (!oldStr && !newStr) return undefined;
  try {
    const current = fs.existsSync(memoryIndexPath(home)) ? fs.readFileSync(memoryIndexPath(home), 'utf8') : '';
    const proposed = oldStr && current.includes(oldStr) ? current.replace(oldStr, newStr) : `${current}\n${newStr}`;
    const check = evaluateIndexWriteGuard(home, proposed);
    return check.allowed ? undefined : check.reason;
  } catch {
    return undefined;
  }
}

function resolveGuardPath(home, exec, rawPath) {
  const header = exec && exec.agent && exec.agent.session ? exec.agent.session.header : null;
  const baseCwd = (header && header.cwd) || whaleHomeDir(home);
  return normPath(path.isAbsolute(rawPath) ? rawPath : path.resolve(baseCwd, rawPath));
}

function checkDirectWriteGuard(home, args) {
  const content = typeof args.content === 'string' ? args.content
    : typeof args.text === 'string' ? args.text : null;
  if (content === null) return undefined;
  const check = evaluateIndexWriteGuard(home, content);
  return check.allowed ? undefined : check.reason;
}

function evaluateMemoryGuardExec(home, indexTarget, memoryRoot, exec) {
  const toolName = String((exec && exec.name) || '');
  const args = (exec && (exec.args || exec.input)) || {};
  const rawPath = extractToolTargetPath(args);
  if (!rawPath) return undefined;
  const resolved = resolveGuardPath(home, exec, rawPath);
  const inMemoryDir = resolved.startsWith(`${memoryRoot}${path.sep}`);

  if (DELETE_TOOL_NAMES.has(toolName) && (inMemoryDir || (resolved === indexTarget && isUnattendedPulseTurn(exec)))) {
    return '分层记忆禁止物理删除记忆文件；请使用 whale_memory_supersede 标记为 superseded 归档。';
  }
  if (resolved !== indexTarget) return undefined;
  if (WRITE_TOOL_NAMES.has(toolName)) return checkDirectWriteGuard(home, args);
  if (EDIT_TOOL_NAMES.has(toolName)) return checkDirectEditGuard(home, args);
  return undefined;
}

/**
 * Guard direct filesystem tool writes to `MEMORY.md` (monotonic cap: <=200 lines /
 * <=25 KiB, ALWAYS allowing shrinking compression writes when already over cap)
 * and forbid unattended physical deletion of atomic `memory/*.md` files.
 */
export function installMemoryToolGuard(host, home) {
  if (!home || typeof host?.tools?.guard !== 'function') return;
  const indexTarget = normPath(memoryIndexPath(home));
  const memoryRoot = normPath(memoryDirPath(home));
  host.tools.guard((exec) => evaluateMemoryGuardExec(home, indexTarget, memoryRoot, exec));
}

function dispatchTodoAction(service, input) {
  const action = input && input.action;
  if (action === 'start') return service.start(input.id);
  if (action === 'cancel') return service.stop(input.id);
  return service.transition(input && input.id, action);
}

export async function handleWhaleTodosEndpoint(ctx, scope, endpoint, input) {
  if (endpoint === 'todos/snapshot') return buildWorkbenchSnapshot(ctx, scope);
  const service = ctx.get('whaleTodos');
  if (!service || !service.available) throw new Error((service && service.error) || '任务卡服务尚未就绪。');
  const payload = input || {};
  if (endpoint === 'todos/list') {
    const autoAdvance = typeof service.autoAdvanceEnabled === 'function' ? service.autoAdvanceEnabled() : false;
    return { cards: service.list(), autoAdvance };
  }
  if (endpoint === 'todos/inspect') return { card: service.get(payload.id) };
  if (endpoint === 'todos/create') return service.create(payload);
  if (endpoint === 'todos/update') return service.update(payload.id, payload.patch || {});
  if (endpoint === 'todos/continue') return service.continue(payload.id, payload.feedback);
  if (endpoint === 'todos/auto-advance') return service.setAutoAdvance(payload.enabled === true);
  if (endpoint === 'todos/action') return dispatchTodoAction(service, payload);
  throw new Error('未知任务卡接口。');
}

function taskIdFromInput(input) {
  if (!input || typeof input.taskId !== 'string' || !input.taskId || Object.keys(input).some((k) => k !== 'taskId')) {
    throw new Error('任务控制仅接受 taskId；动作由专用入口指定，不能修改模型或资料。');
  }
  return input.taskId;
}

function requireTasksService(ctx) {
  const tasks = ctx.get('whaleTasks');
  if (!tasks || !tasks.available) throw new Error('后台任务不可用。');
  return tasks;
}

async function handleLegacyTaskOwner(tasks, input) {
  if (!input || input.channel !== 'feishu' || typeof input.botId !== 'string' || !input.botId
    || typeof input.actor !== 'string' || !input.actor || input.actor === '*') {
    throw new Error('需明确飞书机器人和个人 open_id，不接受通配符。');
  }
  await tasks.setOwner(input.botId, input.actor);
  return { ok: true };
}

export async function handleLegacyTasksEndpoint(ctx, scope, endpoint, input, ensureAssistantSession) {
  if (endpoint === 'tasks/list') {
    const tasks = ctx.get('whaleTasks');
    const available = Boolean(tasks && tasks.available);
    return { available, error: (tasks && tasks.error) || '', tasks: available ? tasks.list().map((t) => tasks.view(t)) : [] };
  }
  const tasks = requireTasksService(ctx);
  if (endpoint === 'tasks/start') {
    const ensured = await ensureAssistantSession(ctx, scope, controllerFrom(ctx));
    if (!ensured.ok) throw new Error(ensured.error);
    const id = crypto.randomUUID();
    const text = `/task ${JSON.stringify(input)}`;
    parseTask(text);
    const origin = {
      eventId: `desktop-${id}`, kind: 'desktop', actor: 'desktop-owner',
      sessionId: ensured.sessionId, messageId: `desktop-task-${id}`, rpcId: '', text, files: [],
    };
    await tasks.recordInbound(origin, text);
    const task = await tasks.accept(origin);
    tasks.schedule(task.id);
    return task;
  }
  if (endpoint === 'tasks/resume') {
    const id = taskIdFromInput(input);
    return tasks.resume(id, tasks.desktopControl(id, 'resume'));
  }
  if (endpoint === 'tasks/stop') {
    const id = taskIdFromInput(input);
    return tasks.stop(id, 'user', tasks.desktopControl(id, 'stop'));
  }
  if (endpoint === 'tasks/get') return tasks.view(tasks.store.get(input && input.taskId));
  if (endpoint === 'tasks/revoke-owner') {
    await tasks.revokeOwner(input && input.botId);
    return { ok: true };
  }
  if (endpoint === 'tasks/owner') return handleLegacyTaskOwner(tasks, input);
  throw new Error(`unknown-endpoint:${String(endpoint)}`);
}

export function isInvalidRpcEndpoint(endpoint) {
  return !endpoint || endpoint.split('/').some(
    (seg) => !seg || seg === '.' || seg === '..' || !/^[A-Za-z0-9_$.-]+$/.test(seg),
  );
}

export function isValidClientRequestBody(body, endpoint) {
  return Boolean(
    body && typeof body === 'object' && !Array.isArray(body)
    && body.type === 'client-request' && typeof body.rpcId === 'string' && body.method === endpoint,
  );
}

function liveQueuedCount(ctx, sessionId) {
  const agents = (typeof ctx.get === 'function' ? ctx.get('agents') : null) || ctx.agents;
  const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : null;
  if (!agent || !agent.inbox) return 0;
  const nextTurn = Array.isArray(agent.inbox.nextTurn) ? agent.inbox.nextTurn.length : 0;
  const nextStep = Array.isArray(agent.inbox.nextStep) ? agent.inbox.nextStep.length : 0;
  return nextTurn + nextStep;
}

function handleIdleTurnEnd(ctx, scope, home, session, event, readSettings) {
  if (!home || !event || event.type !== 'turn/end') return;
  if (!event.data || !event.data.reason || event.data.reason.kind !== 'completed') return;
  const snap = readSettings(scope);
  if (!snap.sessionId || !session || session.id !== snap.sessionId) return;
  try {
    if (liveQueuedCount(ctx, session.id) > 0) return;
    runIdleIncrementalMemoryReview(home, session);
  } catch (error) {
    if (ctx.logger && typeof ctx.logger.warn === 'function') {
      ctx.logger.warn(`dsh-whale idle memory review failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}

export function installWhaleMemoryLifecycle(ctx, scope, home, { readSettings, isWhaleAssistantContext }) {
  if (typeof ctx.on !== 'function') return;
  const flushedEpochBySession = new Map();
  ctx.on('agent/pre-step', async (input, next) => {
    if (typeof next !== 'function') return;
    try {
      if (home && isWhaleAssistantContext({ agent: input?.agent }, readSettings(scope), home)) {
        await maybeTriggerPreCompactionFlush(ctx, input.agent, flushedEpochBySession);
      }
    } catch (error) {
      ctx.logger?.warn?.(`dsh-whale pre-compaction flush skipped: ${error?.message ?? error}`);
    }
    return next();
  });
  ctx.on('session/event', (session, event) => {
    handleIdleTurnEnd(ctx, scope, home, session, event, readSettings);
  }, { global: true });
}

async function resolveResidentLiveAgent(host, sessionId) {
  const direct = host.get?.('agents')?.get?.(sessionId) ?? host.agents?.get?.(sessionId);
  if (direct) return direct;
  if (typeof host.sessionController?.resolveAgent !== 'function') return null;
  const resolved = await host.sessionController.resolveAgent(sessionId).catch(() => null);
  return resolved && !resolved.error ? resolved.agent : null;
}

export function createWhalePulseWake(ctx, host, scope, ensureAssistantSession) {
  return async (text) => {
    const ensured = await ensureAssistantSession(ctx, scope, host.sessionController);
    if (!ensured.ok) throw new Error(ensured.error || 'session-controller-unavailable');
    const rpcId = `whale-pulse-${crypto.randomUUID()}`;
    if (host.get?.('whaleTodos')?.activeBySession?.has?.(ensured.sessionId)) {
      throw new Error('refusing-pulse-into-active-task-session');
    }
    const live = await resolveResidentLiveAgent(host, ensured.sessionId);
    if (live && live.session?.header?.origin !== 'subagent' && typeof live.followup === 'function') {
      await live.followup(createUserMessage({
        source: { kind: 'plugin', plugin: 'dsh-whale', form: 'pulse', rpcId },
        content: [{ type: 'text', text: trimTo(text, 2000) }],
      }));
      return { accepted: true };
    }
    if (typeof host.sessionController?.prompt !== 'function') {
      throw new Error('session-controller-unavailable');
    }
    return host.sessionController.prompt({
      requestId: rpcId,
      sessionId: ensured.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: trimTo(text, 2000) }],
    }, new AbortController().signal);
  };
}
