/** `terminal` namespace dictionaries: drawer chrome. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'empty.title': '暂无终端会话',
  'empty.unavailable': '请先打开可访问的项目会话，再启动终端。',
  'action.splitHorizontal': '左右分屏',
  'action.splitHorizontal.limit': '左右分屏（每组最多 4 个）',
  'action.splitVertical': '上下分屏',
  'action.splitVertical.limit': '上下分屏（每组最多 4 个）',
  'action.maximize': '最大化',
  'action.restore': '还原',
  'action.new': '新建终端',
  'action.close': '关闭终端',
  'resize': '调整终端高度',
  'session.label': '终端',
  'sessions.list': '终端会话',
  'group.label': '组',
  'error.create': '无法启动终端',
  'error.initialize': '无法初始化终端：{message}。请关闭并重新打开终端。',
  loading: '正在初始化终端…',
  dismissFeedback: '关闭提示',
  'action.copy': '复制',
  'action.addToChat': '加入对话',
  'action.openLink': '打开链接',
  'action.openPath': '打开文件',
} satisfies Record<string, string>

/** The terminal namespace key union. */
export type TerminalKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'empty.title': 'No terminal sessions yet',
  'empty.unavailable': 'Open an accessible project session before starting a terminal.',
  'action.splitHorizontal': 'Split left/right',
  'action.splitHorizontal.limit': 'Split left/right (max 4 per group)',
  'action.splitVertical': 'Split top/bottom',
  'action.splitVertical.limit': 'Split top/bottom (max 4 per group)',
  'action.maximize': 'Maximize',
  'action.restore': 'Restore',
  'action.new': 'New terminal',
  'action.close': 'Close terminal',
  'resize': 'Resize terminal drawer',
  'session.label': 'Terminal',
  'sessions.list': 'Terminal sessions',
  'group.label': 'Group',
  'error.create': 'Could not start a terminal',
  'error.initialize': 'Could not initialize the terminal: {message}. Close and reopen the terminal to retry.',
  loading: 'Initializing terminal…',
  dismissFeedback: 'Dismiss notification',
  'action.copy': 'Copy',
  'action.addToChat': 'Add to chat',
  'action.openLink': 'Open link',
  'action.openPath': 'Open file',
} satisfies Record<TerminalKey, string>

/** Dictionary namespace owned by this plugin. */
export const NS = 'terminal'
