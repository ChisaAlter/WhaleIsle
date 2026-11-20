/** User-facing task tools remain scoped to the resident assistant. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { assertNotAborted, classifyCallOrigin } from './call-origin.js';
import { createWhaleScope } from './scope.js';

const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };

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
 * @param {any} exec
 * @param {string} selfSessionId
 */
function assertTodoCaller(exec, selfSessionId, { allowPulse = false } = {}) {
  const origin = classifyCallOrigin(exec, { selfSessionId });
  if (origin.kind === 'desktop') return origin;
  if (allowPulse && origin.kind === 'pulse') return origin;
  if (origin.kind === 'pulse') throw new Error('定时/观察唤醒的无人值守回合不能直接创建个人任务卡。');
  throw new Error(origin.reason || '个人任务卡仅供桌面用户管理。');
}

export function registerTaskTools(ctx) {
  const todos = () => { const value = ctx.get('whaleTodos'); if (!value?.available) throw new Error(value?.error || '任务卡服务尚未就绪。'); return value; };
  const service = () => { const value = ctx.get('whaleTasks'); if (!value?.available) throw new Error('后台任务不可用，请检查桌面任务状态。'); return value; };
  const register = (name, description, parameters, execute) => ctx.tools.register(defineTool({ name, description, parameters, output,
    presentCall: () => ({ card: 'generic', title: description, kind: 'other', content: [] }), execute }));
  register('whale_todo_create', '用户明确让你记下待办时创建一张任务卡；不自动执行，闲聊和同一任务的补充不要重复创建。', {
    title: { type: 'string', required: true },
    description: { type: 'string' },
    criteria: { type: 'string' },
    cwd: { type: 'string', description: 'Optional absolute working directory outside data/whale and system roots.' },
  }, async (args, exec) => {
    const todoService = todos();
    assertTodoCaller(exec, resolveSelfId(ctx, todoService), { allowPulse: false });
    assertNotAborted(exec?.signal);
    return todoService.create(args);
  });
  register('whale_todo_list', '查看个人任务卡及真实执行状态，用于回答进展；回合结束后仍需用户确认完成。', {}, async (_args, exec) => {
    const todoService = todos();
    assertTodoCaller(exec, resolveSelfId(ctx, todoService), { allowPulse: true });
    return { cards: todoService.list() };
  });
  register('whale_task_start', '接下本轮明确的 /task 资料整理委托；范围从用户原消息解析', {}, async (_args, exec) => {
    assertNotAborted(exec?.signal);
    const tasks = service(); const origin = await tasks.originFor(exec);
    assertNotAborted(exec?.signal);
    const task = await tasks.accept(origin); tasks.schedule(task.id);
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
    const tasks = service(); tasks.authorizeTask(args.taskId, exec, 'status'); return tasks.view(tasks.store.get(args.taskId));
  });
  register('whale_task_stop', '停止用户本轮明确要求停止的任务；保留历史', { taskId: { type: 'string', required: true } }, async (args, exec) => {
    assertNotAborted(exec?.signal);
    const tasks = service(); return tasks.stop(args.taskId, 'user', tasks.controlSource(exec, args.taskId, 'stop'));
  });
  register('whale_task_resume', '在本轮新的用户继续指令后续接任务，不会自动恢复', { taskId: { type: 'string', required: true } }, async (args, exec) => {
    assertNotAborted(exec?.signal);
    const tasks = service(); return tasks.resume(args.taskId, tasks.controlSource(exec, args.taskId, 'resume'));
  });
}
