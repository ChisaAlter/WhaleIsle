/** User-facing unified task tools scoped to the resident assistant. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  TAINTED_SESSION_REFUSAL_TEXT,
  assertNotAborted,
  classifyCallOrigin,
  isSessionTainted,
} from './call-origin.js';
import { createWhaleScope } from './scope.js';

const output = {
  schema: /** @type {const} */ ({ type: 'object', additionalProperties: true }),
  /** @param {any} _args @param {any} value */
  render: (_args, value) => [{ type: /** @type {const} */ ('text'), text: JSON.stringify(value) }],
};

/**
 * @param {any} ctx
 * @param {any} [todoService]
 */
function resolveSelfId(ctx, todoService) {
  const fromTodos = todoService?.scope?.get?.()?.sessionId;
  if (fromTodos) return fromTodos;
  const fromTasks = ctx.get?.('whaleTasks')?.scope?.get?.()?.sessionId;
  if (fromTasks) return fromTasks;
  return process.env.DSH_HOME ? createWhaleScope(process.env.DSH_HOME).get().sessionId : '';
}

/**
 * Authorize task-card access by call origin:
 * - desktop: full access to workspace-task and readonly-brief cards
 * - im-owner / im (paired single-owner private DM): read + create/start/stop `readonly-brief` cards
 * - pulse: read-only (`list`, `inspect`)
 * - tainted (guest/group), im-non-owner, foreign, system: refused
 *
 * @param {any} exec
 * @param {string} selfSessionId
 * @param {{ allowPulse?: boolean, allowImOwner?: boolean }} [opts]
 */
function assertTodoCaller(exec, selfSessionId, { allowPulse = false, allowImOwner = false } = {}) {
  const origin = classifyCallOrigin(exec, { selfSessionId });
  if (origin.kind === 'im-non-owner') throw new Error(origin.reason || '当前消息来自非主人 IM 来源，禁止授权或执行敏感操作。');
  if (isSessionTainted(exec?.agent)) throw new Error(TAINTED_SESSION_REFUSAL_TEXT);
  if (origin.kind === 'desktop') return origin;
  if (allowPulse && origin.kind === 'pulse') return origin;
  if (allowImOwner && (origin.kind === 'im-owner' || origin.kind === 'im')) {
    return origin;
  }
  if (origin.kind === 'pulse') throw new Error('定时/观察唤醒的无人值守回合不能直接创建或变更个人任务卡。');
  throw new Error(origin.reason || '个人任务卡仅供桌面主人管理。');
}

export function registerTaskTools(ctx) {
  const todos = () => {
    const value = ctx.get('whaleTodos');
    if (!value?.available) throw new Error(value?.error || '任务卡服务尚未就绪。');
    return value;
  };
  const service = () => {
    const value = ctx.get('whaleTasks');
    if (!value?.available) throw new Error('后台任务不可用，请检查桌面任务状态。');
    return value;
  };
  const register = (name, description, parameters, execute) => ctx.tools.register(defineTool({
    name,
    description,
    parameters,
    output,
    presentCall: () => ({ card: 'generic', title: description, kind: 'other', content: [] }),
    execute,
  }));

  register('whale_todo_create', '创建一张统一受管任务卡（workspace-task 默认在 taskRootDir 下独立子目录运行，readonly-brief 只读资料摘要；支持 dependsOn 前置依赖）；默认建卡不自动启动。', {
    title: { type: 'string', required: true },
    description: { type: 'string' },
    criteria: { type: 'string' },
    cwd: { type: 'string', description: 'Optional absolute working directory outside data/whale and system roots.' },
    mode: { type: 'string', description: 'workspace-task (default) | readonly-brief' },
    dependsOn: { type: 'array', items: { type: 'string' }, description: 'Optional task card ids that must complete before starting.' },
    files: { type: 'array', items: { type: 'string' }, description: 'Input text file paths for readonly-brief mode.' },
  }, async (args, exec) => {
    const todoService = todos();
    const origin = assertTodoCaller(exec, resolveSelfId(ctx, todoService), { allowPulse: false, allowImOwner: true });
    assertNotAborted(exec?.signal);
    const isIm = origin.kind === 'im-owner' || origin.kind === 'im';
    const mode = args.mode === 'readonly-brief' ? 'readonly-brief' : 'workspace-task';
    if (isIm && mode !== 'readonly-brief') {
      throw new Error('已配对单人 IM 仅可直接创建 readonly-brief 只读资料任务；工作区代码任务请在桌面端创建。');
    }
    return todoService.create({
      ...args,
      mode,
      ...(isIm ? { origin: { kind: 'im', actor: 'im-owner', eventId: String(origin.message?.data?.id ?? '') } } : {}),
    });
  });

  register('whale_todo_list', '查看统一受管任务卡及真实执行状态（含 waiting_approval / waiting_input / phase / deliverables）；回合结束后仍需用户确认完成。', {
    state: { type: 'string', description: 'Optional filter by card state.' },
    includeArchived: { type: 'boolean', description: 'Include archived cards (default true).' },
  }, async (args, exec) => {
    const todoService = todos();
    assertTodoCaller(exec, resolveSelfId(ctx, todoService), { allowPulse: true, allowImOwner: true });
    let cards = todoService.list();
    if (args?.includeArchived === false) cards = cards.filter((card) => !card.archived);
    if (typeof args?.state === 'string' && args.state.trim()) {
      const wanted = args.state.trim();
      cards = cards.filter((card) => card.state === wanted);
    }
    return { cards, autoAdvance: typeof todoService.autoAdvanceEnabled === 'function' ? todoService.autoAdvanceEnabled() : false };
  });

  register('whale_todo_inspect', '查看单张任务卡的完整详情：尝试记录（runs）、关联会话、待审批/待提问状态与产出文件（deliverables）。', {
    id: { type: 'string', required: true, description: 'Task card id.' },
  }, async (args, exec) => {
    const todoService = todos();
    assertTodoCaller(exec, resolveSelfId(ctx, todoService), { allowPulse: true, allowImOwner: true });
    const card = todoService.get(String(args.id ?? '').trim());
    return { card };
  });

  register('whale_todo_update', '更新一张待执行任务卡的字段（title/description/criteria/cwd/dependsOn/files/pinned/archived）。', {
    id: { type: 'string', required: true, description: 'Task card id.' },
    title: { type: 'string' },
    description: { type: 'string' },
    criteria: { type: 'string' },
    cwd: { type: 'string' },
    dependsOn: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    pinned: { type: 'boolean' },
    archived: { type: 'boolean' },
  }, async (args, exec) => {
    const todoService = todos();
    assertTodoCaller(exec, resolveSelfId(ctx, todoService), { allowPulse: false, allowImOwner: false });
    assertNotAborted(exec?.signal);
    const id = String(args.id ?? '').trim();
    const patch = {};
    for (const key of ['title', 'description', 'criteria', 'cwd', 'dependsOn', 'files', 'pinned', 'archived']) {
      if (Object.hasOwn(args, key)) patch[key] = args[key];
    }
    return todoService.update(id, patch);
  });

  register('whale_todo_start', '启动一张 pending 状态的受管任务卡（独立干净会话执行，不阻塞主对话）。', {
    id: { type: 'string', required: true, description: 'Task card id.' },
  }, async (args, exec) => {
    const todoService = todos();
    const origin = assertTodoCaller(exec, resolveSelfId(ctx, todoService), { allowPulse: false, allowImOwner: true });
    assertNotAborted(exec?.signal);
    const id = String(args.id ?? '').trim();
    const card = todoService.get(id);
    if ((origin.kind === 'im-owner' || origin.kind === 'im') && card.mode !== 'readonly-brief') {
      throw new Error('已配对单人 IM 仅可启动 readonly-brief 只读资料任务。');
    }
    return todoService.start(id);
  });

  register('whale_todo_stop', '停止一张正在执行的受管任务卡并排空其后台 jobs，历史保留。', {
    id: { type: 'string', required: true, description: 'Task card id.' },
  }, async (args, exec) => {
    const todoService = todos();
    const origin = assertTodoCaller(exec, resolveSelfId(ctx, todoService), { allowPulse: false, allowImOwner: true });
    assertNotAborted(exec?.signal);
    const id = String(args.id ?? '').trim();
    const card = todoService.get(id);
    if ((origin.kind === 'im-owner' || origin.kind === 'im') && card.mode !== 'readonly-brief') {
      throw new Error('已配对单人 IM 仅可停止 readonly-brief 只读资料任务。');
    }
    return todoService.stop(id);
  });

  register('whale_todo_continue', '在 review / interrupted / failed 状态下续接原任务会话追问修订，完整保留原 sessionId 上下文。', {
    id: { type: 'string', required: true, description: 'Task card id.' },
    feedback: { type: 'string', required: true, description: 'Revision or follow-up instruction for the same task session.' },
  }, async (args, exec) => {
    const todoService = todos();
    assertTodoCaller(exec, resolveSelfId(ctx, todoService), { allowPulse: false, allowImOwner: false });
    assertNotAborted(exec?.signal);
    return todoService.continue(String(args.id ?? '').trim(), String(args.feedback ?? ''));
  });

  register('whale_task_start', '接下本轮明确的 /task 资料整理委托；范围从用户原消息解析', {}, async (_args, exec) => {
    assertNotAborted(exec?.signal);
    const tasks = service();
    const origin = await tasks.originFor(exec);
    assertNotAborted(exec?.signal);
    const task = await tasks.accept(origin);
    tasks.schedule(task.id);
    return { ...task, acceptance: '仅接纳，后台执行完成后另行回报；status 可查询完整结果。' };
  });

  register('whale_task_list', '查看本人的后台资料任务', {}, async (/** @type {any} */ _args, /** @type {any} */ exec) => {
    const tasks = service();
    const origin = classifyCallOrigin(exec, { selfSessionId: resolveSelfId(ctx) });
    if (origin.kind === 'pulse') {
      return { tasks: tasks.list().map((/** @type {any} */ task) => ({ id: task.id, goal: task.goal, state: task.state, error: task.error })) };
    }
    const actor = tasks.actorFor(exec);
    return { tasks: tasks.list().filter((/** @type {any} */ task) => actor === 'desktop-owner' || task.origin.actor === actor).map((/** @type {any} */ task) => ({ id: task.id, goal: task.goal, state: task.state, error: task.error })) };
  });

  register('whale_task_status', '查看一个后台资料任务的结果、来源和投递状态', { taskId: { type: 'string', required: true } }, async (args, exec) => {
    const tasks = service();
    tasks.authorizeTask(args.taskId, exec, 'status');
    return tasks.view(tasks.store.get(args.taskId));
  });

  register('whale_task_stop', '停止用户本轮明确要求停止的任务；保留历史', { taskId: { type: 'string', required: true } }, async (args, exec) => {
    assertNotAborted(exec?.signal);
    const tasks = service();
    return tasks.stop(args.taskId, 'user', tasks.controlSource(exec, args.taskId, 'stop'));
  });

  register('whale_task_resume', '在本轮新的用户继续指令后续接任务，不会自动恢复', { taskId: { type: 'string', required: true } }, async (args, exec) => {
    assertNotAborted(exec?.signal);
    const tasks = service();
    return tasks.resume(args.taskId, tasks.controlSource(exec, args.taskId, 'resume'));
  });
}
