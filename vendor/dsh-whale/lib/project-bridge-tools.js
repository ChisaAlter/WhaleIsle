/**
 * Cross-project Whale <-> Project bridge tools (`dsh-whale` -> optional `dsh-project`).
 * Looks up `projects` dynamically so `dsh-whale` has zero hard dependency on
 * `dsh-project` and degrades cleanly when Project is disabled or unavailable.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  ABORTED_TEXT,
  CONFIRM_TOOL_TIMEOUT_MS,
  confirmModelAction,
  refusalTextFor,
} from './desktop-confirm.js';
import {
  NON_OWNER_IM_REFUSAL_TEXT,
  TAINTED_SESSION_REFUSAL_TEXT,
  UNATTENDED_REFUSAL_TEXT,
  classifyCallOrigin,
  isSessionTainted,
} from './call-origin.js';

const VALID_SCOPE_CEILINGS = new Set(['readonly', 'research', 'docs', 'development']);
const DOC_EXT_RE = /\.(md|mdx|txt|rst|adoc)$/i;

const listOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: Array.isArray(value?.projects) && value.projects.length
      ? value.projects.map((p) => `- ${p.title} [${p.projectId}] (${p.canonicalWorkingDirectory}) status=${p.activity?.state ?? p.lifecycle}`).join('\n')
      : String(value?.detail ?? ''),
  }],
};

const inspectOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: value?.project
      ? `${value.project.title} [${value.project.projectId}] (${value.project.canonicalWorkingDirectory}) status=${value.project.activity?.state ?? value.project.lifecycle}`
      : String(value?.detail ?? ''),
  }],
};

const handoffOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      accepted: { type: 'boolean', required: true },
      deduplicated: { type: 'boolean', required: true },
      projectId: { type: 'string', required: true },
      coordinatorSessionId: { type: 'string', required: true },
      handoffId: { type: 'string', required: true },
      messageId: { type: 'string', required: true },
      detail: { type: 'string', required: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.detail ?? '') }],
  /** @param {any} _args @param {any} value */
  presentationMeta: (_args, value) => ({ ok: Boolean(value?.ok), detail: String(value?.detail ?? '') }),
};

function projectService(ctx) {
  return ctx?.get?.('projects') ?? ctx?.projects ?? null;
}

function emptyHandoffFailure(detail, projectId = '') {
  return {
    ok: false,
    accepted: false,
    deduplicated: false,
    projectId: String(projectId || ''),
    coordinatorSessionId: '',
    handoffId: '',
    messageId: '',
    detail,
  };
}

function guardReadOrigin(exec, getSelfId) {
  if (exec?.signal?.aborted) return ABORTED_TEXT;
  if (isSessionTainted(exec?.agent)) return TAINTED_SESSION_REFUSAL_TEXT;
  const origin = classifyCallOrigin(exec, { selfSessionId: getSelfId() });
  if (origin.kind === 'im-non-owner') return NON_OWNER_IM_REFUSAL_TEXT;
  return '';
}

function normalizeOptionalList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 20);
}

function isUnsafeWritePath(entry) {
  return path.isAbsolute(entry)
    || entry.split(/[\\/]+/).some((part) => part === '..' || part.toLowerCase() === '.git');
}

function validateWritePaths(rawWritePaths, scopeCeiling) {
  const writePaths = normalizeOptionalList(rawWritePaths).slice(0, 32);
  for (const entry of writePaths) {
    if (isUnsafeWritePath(entry)) {
      return { error: `不允许的写入路径 "${entry}"：必须使用目标仓库内的相对路径，禁止包含 ".." 或 ".git"。` };
    }
  }
  if ((scopeCeiling === 'readonly' || scopeCeiling === 'research') && writePaths.length > 0) {
    return { error: `${scopeCeiling} 权限上限下不允许声明 writePaths。` };
  }
  if (scopeCeiling === 'docs' && writePaths.some((entry) => !DOC_EXT_RE.test(entry))) {
    return { error: 'docs 权限上限下 writePaths 只能包含文档扩展名（.md/.mdx/.txt/.rst/.adoc）。' };
  }
  return { writePaths };
}

/** @param {unknown} value @param {number} [maxLen] */
function trimmedString(value, maxLen = 0) {
  const s = String(value ?? '').trim();
  return maxLen > 0 ? s.slice(0, maxLen) : s;
}

function validateHandoffArgs(args) {
  const safeArgs = args && typeof args === 'object' ? args : {};
  const projectId = trimmedString(safeArgs.projectId);
  const cwd = trimmedString(safeArgs.cwd);
  if (!projectId && !cwd) return { error: '请至少指定目标 Project 的 projectId 或 cwd。' };
  const goal = trimmedString(safeArgs.goal);
  if (!goal) return { error: '请填写明确的移交目标（goal）。' };
  const scopeCeiling = trimmedString(safeArgs.scopeCeiling) || 'research';
  if (!VALID_SCOPE_CEILINGS.has(scopeCeiling)) {
    return { error: `无效的权限上限 scopeCeiling：${scopeCeiling}（仅支持 readonly / research / docs / development）。` };
  }
  const pathCheck = validateWritePaths(safeArgs.writePaths, scopeCeiling);
  if ('error' in pathCheck) return pathCheck;
  return {
    projectId,
    cwd,
    goal,
    title: trimmedString(safeArgs.title, 160),
    scopeCeiling,
    writePaths: pathCheck.writePaths,
    constraints: normalizeOptionalList(safeArgs.constraints),
    conditions: normalizeOptionalList(safeArgs.conditions),
    sourceSummary: trimmedString(safeArgs.sourceSummary, 1500),
  };
}

function guardHandoffOrigin(exec, getSelfId) {
  if (exec?.signal?.aborted) return ABORTED_TEXT;
  if (isSessionTainted(exec?.agent)) return TAINTED_SESSION_REFUSAL_TEXT;
  const origin = classifyCallOrigin(exec, { selfSessionId: getSelfId() });
  if (origin.kind === 'pulse') return UNATTENDED_REFUSAL_TEXT;
  if (origin.kind === 'im-non-owner') return NON_OWNER_IM_REFUSAL_TEXT;
  if (origin.kind !== 'desktop') return origin.reason || '将任务移交给 Project 需要桌面主对话交互确认。';
  return '';
}

function resolveReadyProjectTarget(ctx, parsed) {
  const projects = projectService(ctx);
  if (!projects?.available
    || typeof projects.inspectBridgeProject !== 'function'
    || typeof projects.acceptAuthorizedHandoff !== 'function') {
    return { error: '当前未启用 Project 服务，或 Project 不可用；如需独立处理可改用个人任务卡。', projectId: parsed.projectId };
  }
  const inspected = projects.inspectBridgeProject({ projectId: parsed.projectId, cwd: parsed.cwd });
  const target = inspected?.found ? inspected.project : null;
  if (!target) {
    return { error: inspected?.error || '未找到匹配的 Project。', projectId: parsed.projectId };
  }
  if (target.lifecycle !== 'ready' || target.archiving) {
    return { error: `Project「${target.title}」当前不可接收移交（lifecycle=${target.lifecycle}）。`, projectId: target.projectId };
  }
  return { projects, target };
}

function buildHandoffDetails(target, parsed) {
  return [
    `目标 Project：${target.title} (${target.projectId})`,
    `工作目录：${target.canonicalWorkingDirectory}`,
    `权限上限：${parsed.scopeCeiling}`,
    ...(parsed.writePaths.length ? [`允许路径：${parsed.writePaths.join(', ')}`] : []),
    `任务目标：${parsed.goal}`,
  ].join('\n');
}

/** @param {any} res @param {any} target @param {string} handoffId */
function formatHandoffResult(res, target, handoffId) {
  const payload = res && typeof res === 'object' ? res : {};
  const deduplicated = Boolean(payload.deduplicated);
  return {
    ok: true,
    accepted: Boolean(payload.accepted),
    deduplicated,
    projectId: String(payload.projectId || target.projectId),
    coordinatorSessionId: String(payload.coordinatorSessionId || ''),
    handoffId: String(payload.handoffId || handoffId),
    messageId: String(payload.messageId || ''),
    detail: deduplicated
      ? `任务已幂等复用既有移交记录（handoffId=${handoffId}），交由 Project「${target.title}」协调员处理。`
      : `已将任务正式移交给 Project「${target.title}」协调会话（${payload.coordinatorSessionId || ''}）。`,
  };
}

async function deliverProjectHandoff(projects, target, parsed, exec, getSelfId) {
  const execCtx = exec && typeof exec === 'object' ? exec : {};
  const handoffId = String(execCtx.callId || crypto.randomUUID());
  try {
    const res = await projects.acceptAuthorizedHandoff({
      projectId: target.projectId,
      cwd: target.canonicalWorkingDirectory,
      title: parsed.title,
      goal: parsed.goal,
      scopeCeiling: parsed.scopeCeiling,
      writePaths: parsed.writePaths,
      constraints: parsed.constraints,
      conditions: parsed.conditions,
      sourceSummary: parsed.sourceSummary,
      confirmedByDesktop: true,
      handoffId,
      sourceSessionId: String(execCtx.agent?.id || getSelfId() || ''),
      signal: execCtx.signal,
    });
    return formatHandoffResult(res, target, handoffId);
  } catch (/** @type {any} */ error) {
    return emptyHandoffFailure(String(error?.message ?? error ?? '移交给 Project 失败。'), target.projectId);
  }
}

export function registerProjectBridgeTools(ctx, { getSelfId = () => '' } = {}) {
  ctx.tools.register(defineTool({
    name: 'whale_list_projects',
    description:
      '只读列出桌面端已创建的目录绑定型 Project 摘要（projectId、标题、绑定的工作目录、当前状态、最近需求与交付）。'
      + '先用它确认目标仓库是否已有 Project，再用 whale_inspect_project 或 whale_handoff_to_project。',
    timeoutMs: 15_000,
    parameters: {},
    output: listOutput,
    presentCall: () => ({ card: 'generic', title: 'List projects', kind: 'other', content: [] }),
    async execute(_args, exec) {
      const blocked = guardReadOrigin(exec, getSelfId);
      if (blocked) return { ok: false, available: false, projects: [], detail: blocked };
      const projects = projectService(ctx);
      if (!projects?.available || typeof projects.listBridgeSummaries !== 'function') {
        return {
          ok: true,
          available: false,
          projects: [],
          detail: '当前未启用 Project 服务，或 Project 不可用。',
        };
      }
      const res = projects.listBridgeSummaries();
      const rows = Array.isArray(res?.projects) ? res.projects : [];
      return {
        ok: true,
        available: res?.available !== false,
        projects: rows,
        detail: rows.length ? `共有 ${rows.length} 个 Project。` : '当前还没有已绑定的 Project。',
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_inspect_project',
    description:
      '只读查看单个 Project 的详细进度：协调会话 id、工作流队列、最近交付记录以及受限 notes.md 预览。'
      + '可通过 projectId 或绑定的 cwd 查找。',
    timeoutMs: 15_000,
    parameters: {
      projectId: { type: 'string', description: 'Target Project id.' },
      cwd: { type: 'string', description: 'Bound repository working directory for the Project.' },
    },
    output: inspectOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Inspect project',
      kind: 'other',
      content: [{ type: 'text', text: String(args?.projectId ?? args?.cwd ?? '') }],
    }),
    async execute(args, exec) {
      const blocked = guardReadOrigin(exec, getSelfId);
      if (blocked) return { ok: false, available: false, found: false, project: null, detail: blocked };
      const projectId = String(args?.projectId ?? '').trim();
      const cwd = String(args?.cwd ?? '').trim();
      if (!projectId && !cwd) {
        return { ok: false, available: true, found: false, project: null, detail: '请至少提供 projectId 或 cwd。' };
      }
      const projects = projectService(ctx);
      if (!projects?.available || typeof projects.inspectBridgeProject !== 'function') {
        return {
          ok: false,
          available: false,
          found: false,
          project: null,
          detail: '当前未启用 Project 服务，或 Project 不可用。',
        };
      }
      const res = projects.inspectBridgeProject({ projectId, cwd });
      if (!res?.found || !res.project) {
        return {
          ok: false,
          available: res?.available !== false,
          found: false,
          project: null,
          detail: res?.error || '未找到匹配的 Project。',
        };
      }
      return {
        ok: true,
        available: true,
        found: true,
        project: res.project,
        detail: `Project「${res.project.title}」当前状态：${res.project.activity?.state ?? res.project.lifecycle}。`,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_handoff_to_project',
    description:
      '经桌面用户显式确认后，将需要围绕已绑定项目仓库持久协作的任务正式移交给对应 Project 协调员执行。'
      + '移交前会先校验 Project 可用性与目标存在；禁止在无人值守脉冲或 IM 渠道触发。',
    timeoutMs: CONFIRM_TOOL_TIMEOUT_MS,
    parameters: {
      projectId: { type: 'string', description: 'Target Project id.' },
      cwd: { type: 'string', description: 'Bound repository working directory for the Project.' },
      title: { type: 'string', description: 'Short title for the handed-off requirement.' },
      goal: { type: 'string', required: true, description: 'Clear goal statement and acceptance expectation for the Project.' },
      scopeCeiling: { type: 'string', description: 'Authorization ceiling: readonly | research (default) | docs | development.' },
      writePaths: { type: 'array', items: { type: 'string' }, description: 'Relative write paths allowed under docs/development.' },
      constraints: { type: 'array', items: { type: 'string' }, description: 'Optional constraints.' },
      conditions: { type: 'array', items: { type: 'string' }, description: 'Optional acceptance conditions.' },
      sourceSummary: { type: 'string', description: 'Optional concise context summary from resident conversation.' },
    },
    output: handoffOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Handoff to project',
      kind: 'other',
      content: [{ type: 'text', text: String(args?.title || args?.goal || args?.projectId || args?.cwd || '') }],
    }),
    presentResult: (_args, result) => {
      if (!result || result.isError) return undefined;
      const meta = result.meta && typeof result.meta === 'object' && !Array.isArray(result.meta)
        ? /** @type {Record<string, any>} */ (result.meta)
        : null;
      if (meta && 'ok' in meta && meta.ok !== true) return undefined;
      const fallbackText = Array.isArray(result.content)
        ? result.content.map((/** @param {any} b */ b) => (b && b.type === 'text' ? String(b.text ?? '') : '')).filter(Boolean).join('\n')
        : '';
      return {
        card: 'generic',
        title: 'Project handoff delivered',
        content: [{ type: 'text', text: String(meta?.detail ?? fallbackText) }],
      };
    },
    async execute(args, exec) {
      const originError = guardHandoffOrigin(exec, getSelfId);
      if (originError) return emptyHandoffFailure(originError, args?.projectId);
      const parsed = validateHandoffArgs(args);
      if ('error' in parsed) return emptyHandoffFailure(parsed.error, args?.projectId);
      const resolved = resolveReadyProjectTarget(ctx, parsed);
      if ('error' in resolved) return emptyHandoffFailure(resolved.error, resolved.projectId);
      const { projects, target } = resolved;
      const confirmation = await confirmModelAction({
        tool: 'whale_handoff_to_project',
        action: 'handoff',
        effect: 'code',
        summary: `将任务移交给 Project「${target.title}」（权限上限：${parsed.scopeCeiling}）`,
        details: buildHandoffDetails(target, parsed),
      }, exec?.signal, exec);
      if (confirmation.ok !== true || exec?.signal?.aborted) {
        return emptyHandoffFailure(refusalTextFor(confirmation, exec?.signal), target.projectId);
      }
      return deliverProjectHandoff(projects, target, parsed, exec, getSelfId);
    },
  }));
}
