/** Visual-reply settings and conversation-card copy. */

/** Locale namespace shared with the stable Host settings entry. */
export const NS = 'visual-replies'

/** Chinese dictionary and key-set source of truth. */
export const zh = {
  'settings.title': '视觉回复',
  'settings.description': '允许智能体生成交互式页面并在会话内展示。截图检查需要支持图片的模型，或已配置的识图模型；关闭后已生成页面仍可查看。',
  'settings.saving': '正在保存…',
  'settings.saveFailed': '无法保存设置，请重试。',
  'settings.unavailable': '当前连接无法更改此设置。',
  'card.title': '视觉回复',
  'card.preview': '预览',
  'card.expand': '展开页面',
  'card.collapse': '收起页面',
  'card.source': '查看源码',
  'card.hideSource': '隐藏源码',
  'card.sourceTitle': 'HTML 源码',
  'card.reload': '重新加载',
  'card.save': '保存 HTML',
  'card.saveFailed': '无法保存页面，请重试。',
  'card.loading': '正在加载页面…',
  'card.loadFailed': '页面加载失败，请重新加载。',
  'card.loadNotReferenced': '这个页面不属于当前会话，无法读取。',
  'card.loadTooLarge': '页面超过 25 MiB 的读取上限，无法加载。',
  'card.loadInvalidUtf8': '页面不是有效的 UTF-8 HTML，无法读取。',
  'card.loadMissing': '页面附件已不存在，无法读取。',
  'card.loadCorrupt': '页面附件已损坏，无法读取。',
  'card.loadInvalidRef': '页面附件引用无效，无法读取。',
  'card.loadSessionMissing': '此会话已不存在，无法读取页面。',
  'card.frameTitle': '视觉回复：{title}',
  'card.desktopOnly': '请在鲸屿桌面端打开此页面以交互预览。',
  'card.close': '关闭页面',
} satisfies Record<string, string>

/** All visual-reply product-copy keys. */
export type VisualRepliesKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  'settings.title': 'Visual replies',
  'settings.description': 'Allow the agent to create interactive pages and show them in conversations. Screenshot inspection requires an image-capable model or a configured vision model. Existing pages remain available when this is off.',
  'settings.saving': 'Saving…',
  'settings.saveFailed': 'Could not save this setting. Try again.',
  'settings.unavailable': 'This setting cannot be changed through the current connection.',
  'card.title': 'Visual reply',
  'card.preview': 'Preview',
  'card.expand': 'Expand page',
  'card.collapse': 'Collapse page',
  'card.source': 'View source',
  'card.hideSource': 'Hide source',
  'card.sourceTitle': 'HTML source',
  'card.reload': 'Reload',
  'card.save': 'Save HTML',
  'card.saveFailed': 'Could not save the page. Try again.',
  'card.loading': 'Loading page…',
  'card.loadFailed': 'The page could not be loaded. Reload to try again.',
  'card.loadNotReferenced': 'This page is not referenced by the current conversation and cannot be read.',
  'card.loadTooLarge': 'The page exceeds the 25 MiB read limit and cannot be loaded.',
  'card.loadInvalidUtf8': 'The page is not valid UTF-8 HTML and cannot be read.',
  'card.loadMissing': 'The page attachment no longer exists and cannot be read.',
  'card.loadCorrupt': 'The page attachment is damaged and cannot be read.',
  'card.loadInvalidRef': 'The page attachment reference is invalid and cannot be read.',
  'card.loadSessionMissing': 'This conversation no longer exists, so the page cannot be read.',
  'card.frameTitle': 'Visual reply: {title}',
  'card.desktopOnly': 'Open this page in the Whale Isle desktop app for an interactive preview.',
  'card.close': 'Close page',
} satisfies Record<VisualRepliesKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Visual replies own their settings, page controls, and status copy. */
    'visual-replies': VisualRepliesKey
  }
}
