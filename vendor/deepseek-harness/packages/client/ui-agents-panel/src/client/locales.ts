/** `agents` namespace dictionaries: current-session subagent list. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'type.label': '代理',
  'guide.title': '代理与后台任务',
  'guide.description': '查看当前会话的子代理和后台任务。',
  'empty.title': '还没有子代理',
  'empty.body': '当前会话生成子代理后，会显示在这里。',
  'activity.running': '正在运行',
  'activity.inactive': '当前未运行',
  'mode.oneShot': '一次性',
  'mode.continuable': '可继续',
  'mode.external': '外部任务',
  'list.aria': '当前会话的子代理',
  'jobs.title': '后台任务',
  'jobs.aria': '当前会话的后台任务',
  'jobs.status.running': '正在运行',
  'jobs.status.stopping': '正在停止',
  'jobs.status.completed': '已完成',
  'jobs.status.killed': '已终止',
  'jobs.status.failed': '失败',
} satisfies Record<string, string>

/** The agents namespace key union. */
export type AgentsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'type.label': 'Agents',
  'guide.title': 'Agents and jobs',
  'guide.description': 'Review subagents and background jobs in this session.',
  'empty.title': 'No agents yet',
  'empty.body': 'When this session spawns subagents, they show up here.',
  'activity.running': 'running',
  'activity.inactive': 'not running',
  'mode.oneShot': 'one-shot',
  'mode.continuable': 'continuable',
  'mode.external': 'External task',
  'list.aria': 'Subagents in this session',
  'jobs.title': 'Background jobs',
  'jobs.aria': 'Background jobs in this session',
  'jobs.status.running': 'running',
  'jobs.status.stopping': 'stopping',
  'jobs.status.completed': 'completed',
  'jobs.status.killed': 'killed',
  'jobs.status.failed': 'failed',
} satisfies Record<AgentsKey, string>

/** Dictionary namespace owned by this plugin. */
export const NS = 'agents'
