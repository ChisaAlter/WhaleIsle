/**
 * Cross-plugin bridge exposing bounded Project status and confirmed handoffs to `dsh-whale`.
 * Preserves the exact contract consumed by `vendor/dsh-whale/lib/project-bridge-tools.js`.
 */
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { safeReadStoreFileSync, samePath } from './files.js';
import { counts, workerIsLive } from './schema.js';

const VALID_SCOPES = new Set(['readonly', 'research', 'docs', 'development']);
const DOC_EXT_RE = /\.(md|mdx|txt|rst|adoc)$/i;
const MAX_GOAL_CHARS = 4000;
const MAX_TITLE_CHARS = 160;
const MAX_LIST_ITEMS = 20;
const MAX_ITEM_CHARS = 500;
const MAX_WRITE_PATHS = 32;
const MAX_SOURCE_SUMMARY_CHARS = 1500;
const MAX_NOTES_PREVIEW_CHARS = 2000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function trimText(value, limit) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.length > limit ? `${raw.slice(0, limit)}…` : raw;
}

function normalizeStringList(value, label, { maxItems = MAX_LIST_ITEMS, maxChars = MAX_ITEM_CHARS } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw fail('invalid_request', `${label} 最多允许 ${maxItems} 项。`);
  }
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > maxChars) {
      throw fail('invalid_request', `${label} 中的每一项都必须是长度不超过 ${maxChars} 的字符串。`);
    }
    const trimmed = entry.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function normalizeWritePaths(rawPaths, scopeCeiling) {
  const paths = normalizeStringList(rawPaths, 'writePaths', { maxItems: MAX_WRITE_PATHS, maxChars: MAX_ITEM_CHARS });
  for (const entry of paths) {
    if (isAbsolute(entry) || entry.split(/[\\/]+/).some((part) => part === '..' || part.toLowerCase() === '.git')) {
      throw fail('invalid_scope', `不允许的写入路径 "${entry}"：必须使用目标仓库内的相对路径，禁止包含 ".." 或 ".git"。`);
    }
  }
  if ((scopeCeiling === 'readonly' || scopeCeiling === 'research') && paths.length > 0) {
    throw fail('invalid_scope', `${scopeCeiling} 权限上限不允许声明可写路径 writePaths。`);
  }
  if (scopeCeiling === 'docs' && paths.some((entry) => !DOC_EXT_RE.test(entry))) {
    throw fail('invalid_scope', 'docs 权限上限下 writePaths 只能包含文档扩展名（.md/.mdx/.txt/.rst/.adoc）。');
  }
  return paths;
}

function findBridgeProject(service, { projectId, cwd } = {}) {
  const id = typeof projectId === 'string' ? projectId.trim() : '';
  const dir = typeof cwd === 'string' ? cwd.trim() : '';
  if (!id && !dir) {
    return { project: null, reason: '请至少提供 projectId 或 cwd。' };
  }
  const projects = service.getCachedProjects();
  if (id) {
    const match = projects.find((item) => item.id === id) ?? null;
    if (!match) return { project: null, reason: `未找到 ID 为「${id}」的 Project。` };
    if (dir && match.workspace && !samePath(match.workspace, dir)) {
      return { project: null, reason: '提供的 projectId 与 cwd 不匹配同一个 Project 目录。' };
    }
    return { project: match, reason: '' };
  }
  const byDir = projects.find((item) => item.workspace && samePath(item.workspace, dir)) ?? null;
  if (!byDir) return { project: null, reason: `未找到绑定工作目录「${dir}」的 Project。` };
  return { project: byDir, reason: '' };
}

function readNotesPreview(service, project) {
  try {
    const memDir = service.memory.memoryDir(project.id);
    const indexRaw = safeReadStoreFileSync(memDir, 'MEMORY.md', 8192);
    if (indexRaw) {
      return indexRaw.length > MAX_NOTES_PREVIEW_CHARS
        ? `${indexRaw.slice(0, MAX_NOTES_PREVIEW_CHARS)}…`
        : indexRaw;
    }
  } catch {
    // Fallback to legacy notes.md if present.
  }
  try {
    const projDir = service.store.projectDir(project.id);
    const legacy = safeReadStoreFileSync(projDir, 'notes.md', 8192);
    if (legacy) {
      return legacy.length > MAX_NOTES_PREVIEW_CHARS
        ? `${legacy.slice(0, MAX_NOTES_PREVIEW_CHARS)}…`
        : legacy;
    }
  } catch {
    // No preview available.
  }
  return '';
}

function buildProjectSummary(project) {
  const tasks = Array.isArray(project.tasks) ? project.tasks : [];
  const tally = counts(tasks);
  const runningCount = tasks.filter(workerIsLive).length;
  const activeRequests = tasks
    .filter((task) => task.status !== 'resolved')
    .slice(0, 8)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      approved: task.approved === true,
    }));
  const recentDeliveries = tasks
    .filter((task) => task.status === 'resolved' || task.status === 'review')
    .slice(-5)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      summary: trimText(task.output, 300),
      at: task.finishedAt || task.updatedAt || 0,
    }));

  const state = project.archived
    ? 'archived'
    : project.paused
      ? 'paused'
      : runningCount > 0
        ? 'running'
        : 'idle';

  return {
    projectId: project.id,
    title: project.name,
    canonicalWorkingDirectory: project.workspace || '',
    lifecycle: project.archived ? 'archived' : 'ready',
    paused: project.paused === true,
    archiving: false,
    activity: { state, running: runningCount, counts: tally },
    updatedAt: project.updatedAt || 0,
    activeRequests,
    recentDeliveries,
  };
}

export function listBridgeSummaries(service) {
  if (!service || service.available !== true) {
    return { available: false, projects: [], error: service?.error || 'Project host is unavailable.' };
  }
  const projects = service
    .getCachedProjects()
    .map((project) => buildProjectSummary(project))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { available: true, projects };
}

export function inspectBridgeProject(service, { projectId, cwd } = {}) {
  if (!service || service.available !== true) {
    return { available: false, found: false, project: null, error: service?.error || 'Project host is unavailable.' };
  }
  const { project, reason } = findBridgeProject(service, { projectId, cwd });
  if (!project) {
    return { available: true, found: false, project: null, error: reason };
  }
  const summary = buildProjectSummary(project);
  const tasks = (project.tasks || [])
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 15)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      approved: task.approved === true,
      branch: task.branch || '',
      updatedAt: task.updatedAt || 0,
    }));
  return {
    available: true,
    found: true,
    project: {
      ...summary,
      coordinatorSessionId: project.coordinatorSessionId || '',
      tasks,
      workstreams: tasks,
      notesPreview: readNotesPreview(service, project),
    },
  };
}

function findMatchingHandoffEvent(events, handoffId) {
  if (!Array.isArray(events)) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type !== 'user/message') continue;
    const source = ev.data?.source ?? {};
    if (source.handoffId === handoffId || source.rpcId === handoffId || ev.data?.id === handoffId) {
      return ev;
    }
  }
  return null;
}

function formatHandoffPrompt({
  handoffId,
  title,
  goal,
  scopeCeiling,
  writePaths,
  constraints,
  conditions,
  sourceSummary,
}) {
  const lines = [
    '[Whale Assistant Handoff]',
    `handoffId: ${handoffId}`,
    `title: ${title}`,
    `scopeCeiling: ${scopeCeiling}`,
  ];
  if (writePaths.length) lines.push(`writePaths: ${writePaths.join(', ')}`);
  lines.push(`goal: ${goal}`);
  if (constraints.length) {
    lines.push('constraints:');
    for (const item of constraints) lines.push(`- ${item}`);
  }
  if (conditions.length) {
    lines.push('conditions:');
    for (const item of conditions) lines.push(`- ${item}`);
  }
  if (sourceSummary) lines.push(`sourceSummary: ${sourceSummary}`);
  lines.push(
    '',
    '请 Project 协调者严格在目标工作区边界与上述权限上限内，调用 projects_add_task 登记任务并按审批策略调用 projects_dispatch 派发执行。',
  );
  return lines.join('\n');
}

function assertHandoffAvailable(service, input) {
  if (input?.confirmedByDesktop !== true) {
    throw fail('unauthorized', '移交给 Project 必须先通过桌面端显式确认。');
  }
  if (!service || service.available !== true || service.closing) {
    throw fail('unavailable', service?.error || 'Project 服务当前不可用。');
  }
  if (typeof service.admissionOpen === 'function' && !service.admissionOpen()) {
    throw fail('admission_locked', '桌面任务准入已锁定，暂不接收移交。');
  }
  const { project, reason } = findBridgeProject(service, { projectId: input.projectId, cwd: input.cwd });
  if (!project) throw fail('missing', reason || '未找到目标 Project。');
  if (project.archived) throw fail('unavailable', `Project「${project.name}」已归档，当前不可接收移交。`);
  return project;
}

function parseHandoffPayload(project, input) {
  const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
  if (!goal || goal.length > MAX_GOAL_CHARS) {
    throw fail('invalid_request', `goal 不能为空且长度不能超过 ${MAX_GOAL_CHARS} 字符。`);
  }
  const rawTitle = typeof input.title === 'string' ? input.title.trim() : '';
  const title = (rawTitle || goal.split(/\r?\n/u)[0] || project.name).slice(0, MAX_TITLE_CHARS);
  const scopeCeiling = typeof input.scopeCeiling === 'string' && input.scopeCeiling.trim()
    ? input.scopeCeiling.trim()
    : 'research';
  if (!VALID_SCOPES.has(scopeCeiling)) {
    throw fail('invalid_scope', `无效的权限上限 scopeCeiling：${scopeCeiling}（仅支持 readonly/research/docs/development）。`);
  }
  const rawHandoffId = typeof input.handoffId === 'string' ? input.handoffId.trim() : '';
  return {
    goal,
    title,
    scopeCeiling,
    writePaths: normalizeWritePaths(input.writePaths, scopeCeiling),
    constraints: normalizeStringList(input.constraints, 'constraints'),
    conditions: normalizeStringList(input.conditions, 'conditions'),
    sourceSummary: trimText(input.sourceSummary, MAX_SOURCE_SUMMARY_CHARS),
    sourceSessionId: typeof input.sourceSessionId === 'string' ? input.sourceSessionId.trim().slice(0, 200) : '',
    handoffId: rawHandoffId && rawHandoffId.length <= 200 ? rawHandoffId : randomUUID(),
  };
}

function cachedHandoffReceipt(service, project, handoffId) {
  service.handoffReceipts ??= new Map();
  const cached = service.handoffReceipts.get(handoffId);
  if (!cached) return null;
  if (cached.projectId !== project.id) {
    throw fail('conflict', '相同的 handoffId 已关联到另一个 Project，禁止重复路由。');
  }
  return {
    accepted: true,
    deduplicated: true,
    projectId: project.id,
    title: project.name,
    coordinatorSessionId: cached.coordinatorSessionId || project.coordinatorSessionId || '',
    handoffId,
    messageId: cached.messageId,
  };
}

async function ensureCoordinatorSessionId(service, project, sessionController) {
  let sid = typeof project.coordinatorSessionId === 'string' ? project.coordinatorSessionId.trim() : '';
  if (!sid && typeof sessionController?.create === 'function') {
    const created = await sessionController.create(project.workspace ? { cwd: project.workspace } : {});
    sid = String(created?.sessionId || created?.id || '');
    if (sid) await service.updateProject(project.id, { coordinatorSessionId: sid });
  }
  if (!sid) {
    throw fail('unavailable', `Project「${project.name}」尚未启动协调者会话，请先在项目页启动协调者。`);
  }
  return sid;
}

async function resolveHandoffTarget(service, project) {
  const ctx = service.ctx || {};
  const get = typeof ctx.get === 'function' ? (k) => ctx.get(k) : (k) => ctx[k];
  const sessionController = get('sessionController') || ctx.sessionController;
  const agents = get('agents') || ctx.agents;
  const coordinatorSessionId = await ensureCoordinatorSessionId(service, project, sessionController);
  let coordinator = agents?.get?.(coordinatorSessionId) || null;
  if (!coordinator && typeof sessionController?.resolveAgent === 'function') {
    try {
      const resolved = await sessionController.resolveAgent(coordinatorSessionId);
      coordinator = resolved?.agent ?? resolved ?? null;
    } catch {
      coordinator = null;
    }
  }
  return { sessionController, coordinator, coordinatorSessionId };
}

async function deliverHandoffMessage({ sessionController, coordinator, coordinatorSessionId, promptText, payload, signal }) {
  if (typeof sessionController?.prompt === 'function') {
    await sessionController.prompt(
      {
        sessionId: coordinatorSessionId,
        requestId: payload.handoffId,
        mode: 'queue',
        content: [{ type: 'text', text: promptText }],
      },
      signal ?? new AbortController().signal,
    );
    const matched = findMatchingHandoffEvent(coordinator?.session?.snapshotEvents?.(), payload.handoffId);
    return String(matched?.data?.id ?? payload.handoffId);
  }
  if (typeof coordinator?.followup === 'function') {
    const message = createUserMessage({
      content: [{ type: 'text', text: promptText }],
      source: {
        kind: 'user',
        form: 'relay',
        plugin: 'dsh-whale:handoff',
        handoffId: payload.handoffId,
        rpcId: payload.handoffId,
        ...(payload.sourceSessionId ? { sourceSessionId: payload.sourceSessionId } : {}),
      },
    });
    await coordinator.followup(message);
    return String(message.id ?? payload.handoffId);
  }
  throw fail('unavailable', 'Project 协调会话当前不支持消息投递。');
}

export async function acceptAuthorizedHandoff(service, input = {}) {
  const project = assertHandoffAvailable(service, input);
  const payload = parseHandoffPayload(project, input);
  const cached = cachedHandoffReceipt(service, project, payload.handoffId);
  if (cached) return cached;

  const target = await resolveHandoffTarget(service, project);
  const existingEvent = findMatchingHandoffEvent(target.coordinator?.session?.snapshotEvents?.(), payload.handoffId);
  if (existingEvent) {
    const existingMessageId = String(existingEvent.data?.id ?? payload.handoffId);
    service.handoffReceipts.set(payload.handoffId, {
      projectId: project.id,
      coordinatorSessionId: target.coordinatorSessionId,
      messageId: existingMessageId,
    });
    return {
      accepted: true,
      deduplicated: true,
      projectId: project.id,
      title: project.name,
      coordinatorSessionId: target.coordinatorSessionId,
      handoffId: payload.handoffId,
      messageId: existingMessageId,
    };
  }

  const promptText = formatHandoffPrompt(payload);
  const messageId = await deliverHandoffMessage({
    ...target,
    promptText,
    payload,
    signal: input.signal,
  });
  service.handoffReceipts.set(payload.handoffId, {
    projectId: project.id,
    coordinatorSessionId: target.coordinatorSessionId,
    messageId,
  });
  return {
    accepted: true,
    deduplicated: false,
    projectId: project.id,
    title: project.name,
    coordinatorSessionId: target.coordinatorSessionId,
    handoffId: payload.handoffId,
    messageId,
  };
}
