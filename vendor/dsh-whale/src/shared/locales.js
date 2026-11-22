// Complete zh-CN / en-US locale dictionaries for WhaleIsle ("大肥鱼队友").
// Follows docs/design-language.md rule #15: natural Chinese product copy, English code comments.

export const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en-US']);

const EN_US = Object.freeze({
  // Sidebar section header & empty state
  'bots.section.title': 'Whale Bots',
  'bots.section.emptyCardTitle': 'Your Whale teammates',
  'bots.section.emptyCardSubtitle': 'Resident teammates, look-around & group collab',
  'bots.section.emptyTemplates': 'Templates',
  'bots.section.templates': 'Templates',
  'bots.section.newBot': 'New bot',
  'bots.section.new': 'New bot or group',
  'bots.section.startFromScratch': 'Start from scratch',
  'bots.section.browseTemplates': 'Browse templates',
  'bots.section.importFromLink': 'Import from link…',
  'bots.section.importFromApp': 'Import from another app…',
  'bots.section.newGroup': 'New group',
  'bots.section.expand': 'Expand Whale Bots',
  'bots.section.collapse': 'Collapse Whale Bots',
  'bots.section.expandAll': 'Expand all teammates',
  'bots.section.collapseAll': 'Collapse all teammates',
  'bots.section.summary': '{{action}}, {{total}} teammates, {{attention}} need you, {{unread}} unread, {{working}} working',
  'bots.section.showMore_one': 'Show {{count}} more teammate',
  'bots.section.showMore_other': 'Show {{count}} more teammates',

  // Runtime badge
  'bots.runtime.local': 'WhaleIsle Core',

  // Options & filters
  'bots.options.title': 'Teammate options',
  'bots.options.activeFilters_one': 'Teammate options ({{count}} filter active)',
  'bots.options.activeFilters_other': 'Teammate options ({{count}} filters active)',
  'bots.options.sortBy': 'Sort by',
  'bots.options.sortManual': 'Manual',
  'bots.options.sortSmart': 'Agent Activity',
  'bots.options.sortRecent': 'Recent',
  'bots.options.sortName': 'Name',
  'bots.options.sortManualDescription': 'Drag teammates to arrange them. New teammates go on top.',
  'bots.options.sortSmartDescription': 'Teammates that need you, then most recent activity.',
  'bots.options.filters': 'Filters',
  'bots.options.hidePaused': 'Hide paused teammates',
  'bots.options.hideSleepingWorkers': 'Hide sleeping workers',
  'bots.options.allHidden': 'All teammates are paused and hidden.',

  // Inline search
  'bots.search.open': 'Search teammates',
  'bots.search.label': 'Search teammates',
  'bots.search.clear': 'Clear search',
  'bots.search.noMatches': 'No matches',
  'bots.search.pausedMatches_one': '{{count}} paused match',
  'bots.search.pausedMatches_other': '{{count}} paused matches',
  'bots.search.showPaused': 'Show paused teammates',
  'bots.search.show': 'Show',
  'bots.search.matchCount_one': '{{count}} match',
  'bots.search.matchCount_other': '{{count}} matches',

  // Row status & context menu
  'bots.row.paused': 'Paused',
  'bots.row.disconnected': 'Disconnected',
  'bots.row.hostDisconnected': '{{host}} disconnected',
  'bots.row.reading': 'Reading your message',
  'bots.row.replying': 'Replying',
  'bots.row.replyingIn': 'Replying in {{place}}',
  'bots.row.replyingOn': 'Replying on {{place}}',
  'bots.row.idle': 'Idle',
  'bots.row.waitingFor': 'Waiting for {{label}}',
  'bots.row.waitingForUntil': 'Waiting for {{label}} · until {{time}}',
  'bots.row.waitingCount': 'Waiting on {{count}} events',
  'bots.row.runsOn': 'Runs on {{host}}',
  'bots.row.rename': 'Rename',
  'bots.row.settings': 'Teammate settings…',
  'bots.row.pause': 'Pause teammate',
  'bots.row.resume': 'Resume teammate',
  'bots.row.copyPath': 'Copy Path',
  'bots.row.markRead': 'Mark Read',
  'bots.row.markUnread': 'Mark Unread',
  'bots.row.delete': 'Remove teammate',
  'bots.row.deleteTitle': 'Remove {{name}}?',
  'bots.row.deleteDescription': 'Its folder, with its soul and memory, stays at {{path}}.',
  'bots.row.deleteConfirm': 'Remove teammate',

  // Chats & workers
  'bots.chats.home': 'Home Chat',
  'bots.chats.homeTooltip': "Home: the teammate's main chat. Its memory, automations and requests from others come together here.",
  'bots.chats.title': 'Chats',
  'bots.chats.newChat': 'New chat',
  'bots.chats.newHomeChat': 'New Home Chat',
  'bots.chats.kindSide': 'Side chat',
  'bots.chats.kindAutomation': 'Automation',
  'bots.chats.workers': 'Workers',
  'bots.chats.waitingCount': '{{count}} waiting',
  'bots.chats.runningCount': '{{count}} running',
  'bots.chats.searchPlaceholder': 'Search chats and workers',
  'bots.chats.showMoreWorkers': 'Show {{count}} more workers',
  'bots.chats.collapseWorkers': 'Collapse',
  'bots.chats.fromClosedChat': 'From a closed chat',
  'bots.chats.handedOver': 'Handed over',
  'bots.newHomeChat.title': 'Start a new Home Chat?',
  'bots.newHomeChat.description': 'Its soul and memory stay; this conversation moves to history.',
  'bots.newHomeChat.dontAskAgain': "Don't ask again",
  'bots.newHomeChat.confirm': 'New Home Chat',

  // Center pane & first screen
  'bots.paused.banner': 'Paused. Nothing runs for you until you turn it back on.',
  'bots.paused.resumeAction': 'Resume',
  'bots.usageLimit.hit': 'Usage limit reached',
  'bots.firstScreen.gettingSetUp': 'Getting set up',
  'bots.firstScreen.stepCreate': 'Create teammate',
  'bots.firstScreen.stepStart': 'Start {{agent}}',
  'bots.firstScreen.stepFirstMessage': 'First message',
  'bots.firstScreen.retry': 'Retry',
  'bots.quiet.nothingToReport': 'Nothing to report',

  // Panel tabs, header, needs you, items & snooze
  'bots.panel.tabTitle': 'Whale',
  'bots.panel.guideTitle': 'Whale panel',
  'bots.panel.guideDescription': 'Home, connectors, chats and files',
  'bots.panel.needYou_one': '{{count}} needs you',
  'bots.panel.needYou_other': '{{count}} need you',
  'bots.panel.working_one': '{{count}} working',
  'bots.panel.working_other': '{{count}} working',
  'bots.panel.working': '{{count}} working',
  'bots.panel.idle': 'Idle',
  'bots.panel.more': 'More',
  'bots.panel.settings.title': 'Settings',
  'bots.items.tab': 'Home',
  'bots.activity.tab': 'Activity',
  'bots.connectors.tab': 'Connectors',
  'bots.files.tab': 'Files',
  'bots.items.needsYou': 'Needs you',
  'bots.items.status.planned': 'Planned',
  'bots.items.status.working': 'In progress',
  'bots.items.status.needs_you': 'Needs you',
  'bots.items.status.done': 'Done',
  'bots.items.status.canceled': 'Canceled',
  'bots.items.stale': 'Stale',
  'bots.items.snoozed': 'Snoozed',
  'bots.items.snooze.later': 'Later today',
  'bots.items.snooze.inHours': 'In {{count}} hours',
  'bots.items.snooze.tomorrow': 'Tomorrow',
  'bots.items.snooze.monday': 'Monday',
  'bots.items.snooze.week': 'In a week',
  'bots.items.doneMeans': 'Done means',
  'bots.items.links': 'Links',
  'bots.items.empty': 'No items yet.',
  'bots.items.recommended': 'Recommended',

  // Upcoming & Up Next (Look around)
  'bots.upcoming.title': 'Upcoming',
  'bots.upNext.title': 'Up next',
  'bots.upNext.lookNow': 'Look now',
  'bots.upNext.start': 'Start',
  'bots.upNext.dismiss': 'Dismiss',

  // New bot dialog & avatar picker
  'bots.new.title': 'New Whale Bot',
  'bots.new.name': 'Name',
  'bots.new.namePlaceholder': 'Name your teammate',
  'bots.new.purposeLabel': 'Identity',
  'bots.new.purposePlaceholder': 'Describe its role, focus and daily work',
  'bots.new.picture': 'Avatar',
  'bots.new.pictureColor': 'Background color',
  'bots.new.pictureColorCustom': 'Custom color',
  'bots.new.colorSky': 'Sky',
  'bots.new.colorWhite': 'White',
  'bots.new.colorLavender': 'Lavender',
  'bots.new.colorPink': 'Pink',
  'bots.new.colorPeach': 'Peach',
  'bots.new.colorButter': 'Butter',
  'bots.new.colorSage': 'Sage',
  'bots.new.colorMint': 'Mint',
  'bots.new.colorSlate': 'Slate',
  'bots.new.colorGraphite': 'Graphite',
  'bots.new.colorInk': 'Ink',
  'bots.new.fromTemplate': 'Templates',
  'bots.new.watches': 'Watches',
  'bots.new.does': 'Does',
  'bots.new.reports': 'Reports',
  'bots.new.cancel': 'Cancel',
  'bots.new.creating': 'Creating…',
  'bots.new.create': 'Create',

  // Templates dialog
  'bots.templates.title': 'Whale Bot templates',
  'bots.templates.browse': 'Browse templates',
  'bots.templates.search': 'Search templates',
  'bots.templates.allCategories': 'All',
  'bots.templates.category.coding': 'Coding',
  'bots.templates.category.releases': 'Releases',
  'bots.templates.category.support': 'Support',
  'bots.templates.category.planning': 'Planning',
  'bots.templates.category.ops': 'Ops',
  'bots.templates.category.personal': 'Personal',
  'bots.templates.comesWith': 'Comes with',
  'bots.templates.useTemplate': 'Use template…',
  'bots.templates.firstChat': 'What it does first',

  // Groups
  'bots.groups.newGroup': 'New group',
  'bots.groups.manageMembers': 'Manage members…',
  'bots.groups.delete': 'Delete group…',
  'bots.groups.allBots': 'All teammates',
  'bots.groups.onlyWhenMentioned': 'Only when mentioned',
  'bots.groups.correctMention': 'Correct mention',
  'bots.groups.unavailableBot': 'Unavailable teammate',
  'bots.groups.allBotsCount': 'All teammates · {{count}}',
  'bots.groups.mentionedCount': '{{count}} mentioned',
  'bots.groups.suggestTwo': '{{a}} & {{b}}',
  'bots.groups.suggestThree': '{{a}}, {{b}} & {{c}}',
  'bots.groups.suggestMore': '{{a}}, {{b}} & {{count}} more',

  // Bot settings & global settings
  'settings.bots.enable': 'Enable Whale Bots',
  'settings.bots.askNewHomeChat': 'Ask before a new Home Chat',
  'settings.bots.soul': 'Soul',
  'settings.bots.soulRead': 'Read',
  'settings.bots.soulEdit': 'Edit',
  'settings.bots.soulDoubleClickHint': 'Double-click to edit',
  'settings.bots.soulEmpty': 'No instructions yet. Double-click or choose Edit to write them.',
  'settings.bots.soulConflict': 'SOUL.md changed on disk.',
  'settings.bots.memory': 'Memory',
  'settings.bots.memoryFacts': 'Facts',
  'settings.bots.memoryHistory': 'History',
  'settings.bots.memoryUndo': 'Undo',
  'settings.bots.addMemoryPlaceholder': 'Remember something new…',
  'settings.bots.memoryEmpty': 'No facts saved yet.',
  'settings.bots.lookAround.title': 'Look around',
  'settings.bots.lookAround.looking': 'Looking…',
  'settings.bots.tidyUp.title': 'Tidy up',
  'settings.bots.tidyUp.now': 'Tidy now',
  'settings.bots.tidyUp.tidied': 'Tidied memory · {{count}} changes',
  'settings.bots.tools.title': 'Tools',
  'settings.bots.tools.add': 'Add tool',
  'settings.bots.skills.title': 'Skills',
  'settings.bots.whoCanAsk.title': 'Who can ask',
  'settings.bots.notifications.title': 'Notifications',
  'settings.bots.notifications.needsPermission': 'Needs permission',
  'settings.bots.notifications.taskComplete': 'Task complete',
  'settings.bots.notifications.couldNotFinish': 'Could not finish',
  'settings.bots.saving': 'Saving…',
  'settings.bots.unsaved': 'Unsaved',
  'settings.bots.saved': 'Saved',
});

const ZH_CN = Object.freeze({
  // Sidebar section header & empty state
  'bots.section.title': '大肥鱼队友',
  'bots.section.emptyCardTitle': '你的大肥鱼队友',
  'bots.section.emptyCardSubtitle': '常驻协作、自主巡视与多鱼联动',
  'bots.section.emptyTemplates': '模板库',
  'bots.section.templates': '模板库',
  'bots.section.newBot': '新建队友',
  'bots.section.new': '新建大肥鱼队友或鱼群',
  'bots.section.startFromScratch': '从零创建',
  'bots.section.browseTemplates': '浏览模板库',
  'bots.section.importFromLink': '从链接导入…',
  'bots.section.importFromApp': '从其他应用导入…',
  'bots.section.newGroup': '新建鱼群协作',
  'bots.section.expand': '展开大肥鱼队友',
  'bots.section.collapse': '折叠大肥鱼队友',
  'bots.section.expandAll': '展开全部队友',
  'bots.section.collapseAll': '折叠全部队友',
  'bots.section.summary': '{{action}}，共 {{total}} 位队友，{{attention}} 项待你处理，{{unread}} 条未读，{{working}} 位工作中',
  'bots.section.showMore_one': '再显示 {{count}} 位队友',
  'bots.section.showMore_other': '再显示 {{count}} 位队友',

  // Runtime badge
  'bots.runtime.local': '鲸屿内核',

  // Options & filters
  'bots.options.title': '队友显示选项',
  'bots.options.activeFilters_one': '队友显示选项（已启用 {{count}} 项筛选）',
  'bots.options.activeFilters_other': '队友显示选项（已启用 {{count}} 项筛选）',
  'bots.options.sortBy': '排序方式',
  'bots.options.sortManual': '手动',
  'bots.options.sortSmart': '智能活跃度',
  'bots.options.sortRecent': '最近活跃',
  'bots.options.sortName': '名称',
  'bots.options.sortManualDescription': '拖动队友调整顺序，新建队友默认置顶。',
  'bots.options.sortSmartDescription': '优先展示需要你处理的队友，其次按最近活跃排序。',
  'bots.options.filters': '筛选条件',
  'bots.options.hidePaused': '隐藏已暂停的队友',
  'bots.options.hideSleepingWorkers': '隐藏休眠的执行者',
  'bots.options.allHidden': '所有队友均已暂停并隐藏。',

  // Inline search
  'bots.search.open': '搜索队友',
  'bots.search.label': '搜索大肥鱼队友',
  'bots.search.clear': '清除搜索',
  'bots.search.noMatches': '没有匹配项',
  'bots.search.pausedMatches_one': '{{count}} 位已暂停的匹配队友',
  'bots.search.pausedMatches_other': '{{count}} 位已暂停的匹配队友',
  'bots.search.showPaused': '显示已暂停的队友',
  'bots.search.show': '显示',
  'bots.search.matchCount_one': '{{count}} 个匹配项',
  'bots.search.matchCount_other': '{{count}} 个匹配项',

  // Row status & context menu
  'bots.row.paused': '已暂停',
  'bots.row.disconnected': '已断开连接',
  'bots.row.hostDisconnected': '{{host}} 已断开连接',
  'bots.row.reading': '正在阅读你的消息',
  'bots.row.replying': '正在回复',
  'bots.row.replyingIn': '正在 {{place}} 中回复',
  'bots.row.replyingOn': '正在 {{place}} 上回复',
  'bots.row.idle': '空闲',
  'bots.row.waitingFor': '正在等待 {{label}}',
  'bots.row.waitingForUntil': '正在等待 {{label}} · 直到 {{time}}',
  'bots.row.waitingCount': '等待中的事件：{{count}}',
  'bots.row.runsOn': '运行于 {{host}}',
  'bots.row.rename': '重命名',
  'bots.row.settings': '队友设置…',
  'bots.row.pause': '暂停队友',
  'bots.row.resume': '恢复队友',
  'bots.row.copyPath': '复制路径',
  'bots.row.markRead': '标记为已读',
  'bots.row.markUnread': '标记为未读',
  'bots.row.delete': '移除队友',
  'bots.row.deleteTitle': '要移除 {{name}} 吗？',
  'bots.row.deleteDescription': '其目录（含灵魂设定与记忆文件）会保留在 {{path}}。',
  'bots.row.deleteConfirm': '移除队友',

  // Chats & workers
  'bots.chats.home': '主对话',
  'bots.chats.homeTooltip': '主对话：队友的核心会话。它的记忆、自动化任务和协作请求都会汇集于此。',
  'bots.chats.title': '对话',
  'bots.chats.newChat': '新建支线对话',
  'bots.chats.newHomeChat': '新建主对话',
  'bots.chats.kindSide': '支线对话',
  'bots.chats.kindAutomation': '自动化',
  'bots.chats.workers': '执行者',
  'bots.chats.waitingCount': '{{count}} 个等待中',
  'bots.chats.runningCount': '{{count}} 个运行中',
  'bots.chats.searchPlaceholder': '搜索对话和执行者',
  'bots.chats.showMoreWorkers': '再显示 {{count}} 个执行者',
  'bots.chats.collapseWorkers': '收起',
  'bots.chats.fromClosedChat': '来自已结束的对话',
  'bots.chats.handedOver': '已交接',
  'bots.newHomeChat.title': '要开启新的主对话吗？',
  'bots.newHomeChat.description': '会保留其灵魂设定与长期记忆，当前对话会归档至历史记录。',
  'bots.newHomeChat.dontAskAgain': '不再询问',
  'bots.newHomeChat.confirm': '新建主对话',

  // Center pane & first screen
  'bots.paused.banner': '已暂停。恢复启用前，该队友不会执行任何任务。',
  'bots.paused.resumeAction': '恢复',
  'bots.usageLimit.hit': '已达用量上限',
  'bots.firstScreen.gettingSetUp': '正在初始化队友',
  'bots.firstScreen.stepCreate': '创建大肥鱼队友',
  'bots.firstScreen.stepStart': '启动 {{agent}}',
  'bots.firstScreen.stepFirstMessage': '首条招呼',
  'bots.firstScreen.retry': '重试',
  'bots.quiet.nothingToReport': '暂无需要汇报的内容',

  // Panel tabs, header, needs you, items & snooze
  'bots.panel.tabTitle': '大肥鱼',
  'bots.panel.guideTitle': '大肥鱼工作台',
  'bots.panel.guideDescription': '概览、连接器、对话与文件',
  'bots.panel.needYou_one': '{{count}} 项需要你处理',
  'bots.panel.needYou_other': '{{count}} 项需要你处理',
  'bots.panel.working_one': '{{count}} 项处理中',
  'bots.panel.working_other': '{{count}} 项工作进行中',
  'bots.panel.working': '{{count}} 项工作进行中',
  'bots.panel.idle': '空闲',
  'bots.panel.more': '更多',
  'bots.panel.settings.title': '设置',
  'bots.items.tab': '概览',
  'bots.activity.tab': '活动',
  'bots.connectors.tab': '连接器',
  'bots.files.tab': '文件',
  'bots.items.needsYou': '需要你处理',
  'bots.items.status.planned': '已计划',
  'bots.items.status.working': '进行中',
  'bots.items.status.needs_you': '需要你处理',
  'bots.items.status.done': '完成',
  'bots.items.status.canceled': '已取消',
  'bots.items.stale': '长期无活动',
  'bots.items.snoozed': '已延后提醒',
  'bots.items.snooze.later': '今天晚些时候',
  'bots.items.snooze.inHours': '{{count}} 小时后',
  'bots.items.snooze.tomorrow': '明天',
  'bots.items.snooze.monday': '星期一',
  'bots.items.snooze.week': '一周后',
  'bots.items.doneMeans': '验收标准',
  'bots.items.links': '关联链接',
  'bots.items.empty': '还没有工作条目。',
  'bots.items.recommended': '推荐',

  // Upcoming & Up Next (Look around)
  'bots.upcoming.title': '即将运行',
  'bots.upNext.title': '巡视建议',
  'bots.upNext.lookNow': '立即巡视',
  'bots.upNext.start': '开始执行',
  'bots.upNext.dismiss': '忽略',

  // New bot dialog & avatar picker
  'bots.new.title': '新建大肥鱼队友',
  'bots.new.name': '名称',
  'bots.new.namePlaceholder': '给你的大肥鱼起个名字',
  'bots.new.purposeLabel': '角色与职责',
  'bots.new.purposePlaceholder': '描述它的角色、专长和日常职责',
  'bots.new.picture': '头像',
  'bots.new.pictureColor': '背景颜色',
  'bots.new.pictureColorCustom': '自定义颜色',
  'bots.new.colorSky': '天蓝',
  'bots.new.colorWhite': '白色',
  'bots.new.colorLavender': '薰衣草紫',
  'bots.new.colorPink': '粉色',
  'bots.new.colorPeach': '蜜桃色',
  'bots.new.colorButter': '奶油黄',
  'bots.new.colorSage': '鼠尾草绿',
  'bots.new.colorMint': '薄荷绿',
  'bots.new.colorSlate': '石板灰',
  'bots.new.colorGraphite': '石墨色',
  'bots.new.colorInk': '墨黑',
  'bots.new.fromTemplate': '模板库',
  'bots.new.watches': '关注内容',
  'bots.new.does': '执行工作',
  'bots.new.reports': '汇报内容',
  'bots.new.cancel': '取消',
  'bots.new.creating': '创建中…',
  'bots.new.create': '创建',

  // Templates dialog
  'bots.templates.title': '大肥鱼模板库',
  'bots.templates.browse': '浏览模板库',
  'bots.templates.search': '搜索模板',
  'bots.templates.allCategories': '全部',
  'bots.templates.category.coding': '编程',
  'bots.templates.category.releases': '发布',
  'bots.templates.category.support': '支持',
  'bots.templates.category.planning': '规划',
  'bots.templates.category.ops': '运维',
  'bots.templates.category.personal': '个人',
  'bots.templates.comesWith': '预置能力',
  'bots.templates.useTemplate': '使用此模板…',
  'bots.templates.firstChat': '首次对话会做什么',

  // Groups
  'bots.groups.newGroup': '新建鱼群协作',
  'bots.groups.manageMembers': '管理鱼群成员…',
  'bots.groups.delete': '解散鱼群…',
  'bots.groups.allBots': '全体队友',
  'bots.groups.onlyWhenMentioned': '仅在被 @ 提及时回复',
  'bots.groups.correctMention': '更正提及',
  'bots.groups.unavailableBot': '暂不可用的队友',
  'bots.groups.allBotsCount': '全体队友 · {{count}}',
  'bots.groups.mentionedCount': '已提及 {{count}} 位',
  'bots.groups.suggestTwo': '{{a}} & {{b}}',
  'bots.groups.suggestThree': '{{a}}、{{b}} & {{c}}',
  'bots.groups.suggestMore': '{{a}}、{{b}} 及其他 {{count}} 位',

  // Bot settings & global settings
  'settings.bots.enable': '启用大肥鱼队友',
  'settings.bots.askNewHomeChat': '新建主对话前询问',
  'settings.bots.soul': '灵魂',
  'settings.bots.soulRead': '阅读',
  'settings.bots.soulEdit': '编辑',
  'settings.bots.soulDoubleClickHint': '双击编辑',
  'settings.bots.soulEmpty': '尚未添加指令。双击或点击「编辑」即可编写。',
  'settings.bots.soulConflict': '磁盘上的 SOUL.md 已被修改。',
  'settings.bots.memory': '记忆',
  'settings.bots.memoryFacts': '事实',
  'settings.bots.memoryHistory': '历史',
  'settings.bots.memoryUndo': '撤销',
  'settings.bots.addMemoryPlaceholder': '记住新内容…',
  'settings.bots.memoryEmpty': '尚未保存任何事实。',
  'settings.bots.lookAround.title': '巡视',
  'settings.bots.lookAround.looking': '巡视中…',
  'settings.bots.tidyUp.title': '记忆维护',
  'settings.bots.tidyUp.now': '立即整理',
  'settings.bots.tidyUp.tidied': '已整理记忆 · {{count}} 项变更',
  'settings.bots.tools.title': '工具',
  'settings.bots.tools.add': '添加工具',
  'settings.bots.skills.title': '技能',
  'settings.bots.whoCanAsk.title': '谁可以提问',
  'settings.bots.notifications.title': '通知',
  'settings.bots.notifications.needsPermission': '需要权限',
  'settings.bots.notifications.taskComplete': '任务完成',
  'settings.bots.notifications.couldNotFinish': '未能完成',
  'settings.bots.saving': '保存中…',
  'settings.bots.unsaved': '未保存',
  'settings.bots.saved': '已保存',
});

export const LOCALES = Object.freeze({
  'zh-CN': ZH_CN,
  'en-US': EN_US,
});

export function normalizeLocale(locale) {
  if (typeof locale !== 'string' || !locale.trim()) {
    return 'zh-CN';
  }
  const lower = locale.trim().toLowerCase();
  return lower.startsWith('zh') ? 'zh-CN' : 'en-US';
}

function lookupTemplate(dict, key, params) {
  if (params && typeof params.count === 'number') {
    const suffix = params.count === 1 ? '_one' : '_other';
    if (Object.prototype.hasOwnProperty.call(dict, `${key}${suffix}`)) {
      return dict[`${key}${suffix}`];
    }
  }
  return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : null;
}

/**
 * Translates a Whale Bots UI key in `'zh-CN'` or `'en-US'` with `{{param}}` interpolation and
 * `_one`/`_other` plural lookup.
 */
export function t(locale, key, params = null) {
  const normalized = normalizeLocale(locale);
  const primary = LOCALES[normalized] ?? ZH_CN;
  const template = lookupTemplate(primary, key, params)
    ?? lookupTemplate(EN_US, key, params)
    ?? (typeof params?.defaultValue === 'string' ? params.defaultValue : key);
  if (!params || typeof params !== 'object') {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => (
    params[name] === undefined || params[name] === null ? '' : String(params[name])
  ));
}

/** Creates a `(key, fallbackOrParams?, params?) => string` translator bound to `locale`. */
export function createTranslator(locale = 'zh-CN') {
  const normalized = normalizeLocale(locale);
  return (key, fallbackOrParams, maybeParams) => {
    const hasFallback = typeof fallbackOrParams === 'string';
    const params = hasFallback ? (maybeParams ?? {}) : (fallbackOrParams ?? {});
    const primary = LOCALES[normalized] ?? ZH_CN;
    const found = lookupTemplate(primary, key, params) ?? lookupTemplate(EN_US, key, params);
    const template = found ?? (hasFallback ? fallbackOrParams : key);
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => (
      params[name] === undefined || params[name] === null ? '' : String(params[name])
    ));
  };
}
