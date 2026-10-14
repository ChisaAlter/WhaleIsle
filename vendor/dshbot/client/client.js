window.__ModuleLoader__.load({ id: "dshbot", factory: (require) => {
  const module = { exports: {} };
  const exports = module.exports;
  const react = require("react");
  const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
  const { createElement: h, useState, useEffect, useMemo, useRef } = react;
  const {
    Button, Input, Menu, Modal, Pill, SettingsSelect, Switch, Toast, Tooltip,
    DocumentFileIcon, MarkdownText, fileSizeText,
    IconPlusOutline16, IconSearchOutline16, IconEllipsisOutline16,
    IconEditOutline16, IconTrashOutline16, IconCopyOutline16,
    IconAgentPresetOutline16, IconClockOutline16, IconPlayOutline16,
    IconPauseOutline16, IconStopFill16,
    IconWarningOutline16, IconSkillOutline16, IconContextInjectionOutline16,
    IconSettingsOutline16, StateDot,
    IconChevronDownOutline14, IconChevronRightOutline14,
  } = primitives;

  const NS = "dshbot";
  const CATALOG_NS = "dsh-bot";
  const TAB_ID = "bots";
  const DEFAULT_BOT_NAME = "新机器人";
  const GROUP_MIN_MEMBERS = 2;
  const GROUP_MAX_MEMBERS = 6;
  // These are exported by lib/group-chat.js. The standalone client bundle
  // cannot import the host module, so keep the UI validation in lockstep.
  const GROUP_MAX_ROUNDS = 3;
  const GROUP_MAX_MEMBER_TURNS = 10;
  const GROUP_MAX_MESSAGES_PER_TURN = 2;
  const GROUP_DEFAULT_MAX_ROUNDS = GROUP_MAX_ROUNDS;
  const GROUP_DEFAULT_MAX_MEMBER_TURNS = GROUP_MAX_MEMBER_TURNS;
  // Keep aligned with lib/index.js ItemSchema objective fields.
  const OBJECTIVE_MAX_ROUNDS = 200;
  const OBJECTIVE_DEFAULT_MAX_ROUNDS = 16;
  // Keep legacy room reads aligned with lib/group-chat.js.
  const GROUP_THREAD_GAP_MS = 15 * 60 * 1000;
  const GROUP_THREAD_REPLY_PREFIX = "[DSHBOT_THREAD_REPLY:";
  const GROUP_THREAD_REPLY_COMMAND = "/dshbot-thread-reply";
  const ROUTINE_MIN_INTERVAL = 1;
  const ROUTINE_MAX_INTERVAL = 525600;
  const ROUTINE_MAX_RUNS = 100000;
  const ROUTINE_FREQUENCIES = ["once", "hourly", "daily", "weekdays", "weekly", "monthly", "interval", "advanced"];
  const CAPABILITY_GROUPS = [
    { id: "tools", labelKey: "capabilityTools", icon: IconContextInjectionOutline16 },
    { id: "skills", labelKey: "capabilitySkills", icon: IconSkillOutline16 },
    { id: "mcp", labelKey: "capabilityMcp", icon: IconSettingsOutline16 },
  ];
  const ROUTINE_TERMINAL_STATUSES = new Set(["completed", "failed", "interrupted"]);
  // Per-session dismissal for the missed-routine banner; not persisted.
  const dismissedRoutineBanners = new Set();
  // The browser permission prompt is requested at most once per session.
  let notificationPermissionRequested = false;

  const zh = {
    tab: "机器人",
    search: "搜索",
    add: "添加",
    addBot: "添加新 Bot",
    addRoom: "创建群聊",
    empty: "还没有机器人",
    emptyHint: "点右上角加号添加联系人或群聊。群聊需要 2–6 名成员。",
    roomEmptyHint: "说点什么 — 这个群里的每个机器人都会听到。",
    edit: "编辑资料",
    duplicate: "复制",
    delete: "删除",
    cancel: "取消",
    save: "保存",
    confirmDelete: "删除这个条目？会话不会从磁盘抹掉，只是从列表里消失。",
    deletePreviewLoading: "正在检查删除影响…",
    deletePreviewUnavailable: "无法检查删除影响，已停止删除。",
    deleteDependencies: "删除影响",
    deletePreserves: "会保留",
    deleteGroups: "群组",
    deleteRoutines: "定时任务",
    deleteTasks: "任务",
    deleteSources: "来源规则",
    deleteNone: "无",
    deleteConfirmCascade: "我已确认上述依赖影响",
    hostWarning: "Host 提示",
    name: "名称",
    title: "标题",
    stableAddress: "稳定地址",
    description: "描述 / 人设",
    personaHint: "芯片写入互不重叠的人设，仍可改。",
    personaOppose: "反对",
    personaFill: "补全",
    personaShip: "落地",
    personaSharp: "毒舌",
    model: "模型",
    workspace: "工作区",
    workspaceNone: "无目录",
    workspaceLocked: "有消息的机器人或已创建的群聊不能改工作区，请新建一个。",
    pin: "置顶",
    unpin: "取消置顶",
    hide: "隐藏",
    unhide: "取消隐藏",
    showHidden: "显示已隐藏",
    hideHidden: "收起已隐藏",
    members: "成员",
    membersHint: "选择 2–6 个已有机器人（不能选群）。",
    roomName: "群聊名称",
    defaultBotName: DEFAULT_BOT_NAME,
    defaultRoomName: "新群聊",
    provider: "供应商",
    noModel: "使用部署默认",
    modelUnavailable: "机器人没有可用的模型配置。",
    modelCatalogLoading: "正在加载模型目录…",
    modelCatalogUnavailable: "模型目录不可用；当前模型配置保持不变。",
    modelCatalogError: "模型目录加载失败",
    modelProviderDefault: "使用部署默认",
    modelSelect: "选择模型",
    reasoningEffort: "思考档",
    reasoningDefault: "模型默认",
    reasoningUnavailable: "该模型不提供可选思考档",
    error: "出错了",
    saving: "正在保存…",
    close: "关闭",
    avatar: "头像",
    avatarBlob: "机器人",
    avatarUpload: "上传",
    avatarPick: "选择图片",
    avatarCircle: "圆形",
    avatarSquare: "方形",
    avatarTooLarge: "图片太大，请换一张更小的。",
    avatarBadImage: "无法读取这张图片。",
    avatarCropZoom: "缩放",
    avatarCropApply: "应用",
    thinking: "思考中",
    roomBadge: "群",
    unreadCompleted: "有未读完成结果",
    sessionAttention: "需要处理",
    sessionError: "会话错误",
    applicationDefault: "应用默认",
    roomSettings: "群聊设置",
    catalogUnavailable: "机器人目录暂不可用",
    catalogReadOnly: "机器人目录为只读",
    saveConflict: "资料已更新，请重新打开编辑后保存。当前草稿未保存。",
    invalidSources: "请选择至少一个有效的机器人来源。",
    contacts: "联系人",
    tasks: "任务",
    taskSearch: "搜索任务、ID或参与者",
    taskStatusFilter: "状态",
    taskStatusAll: "全部",
    taskStatusQueued: "排队中",
    taskStatusDelivered: "已送达",
    taskStatusCompleted: "已完成",
    taskStatusFailed: "失败",
    taskStatusUnknown: "未知状态",
    taskEmpty: "还没有任务",
    taskNoMatch: "没有匹配的任务",
    taskDetails: "任务详情",
    taskId: "任务 ID",
    taskParticipants: "参与者",
    taskSender: "发起者",
    taskRecipient: "执行者",
    taskBody: "任务",
    taskConstraints: "约束",
    taskSuccessCriteria: "验收条件",
    taskResult: "结果",
    taskError: "错误",
    taskCreatedAt: "创建时间",
    taskUpdatedAt: "更新时间",
    taskAttempts: "投递次数",
    taskEvents: "事件",
    taskNone: "无",
    openConversation: "打开会话",
    participantUnavailable: "参与者不可用",
    participantMissing: "目录中不存在或会话不可用",
    catalogLoading: "正在加载机器人目录…",
    catalogUnavailableState: "机器人目录不可用",
    catalogReadOnlyState: "机器人目录为只读，无法保存更改。",
    sourcePolicy: "消息与任务来源",
    sourceDefault: "默认规则",
    sourceSelected: "指定机器人",
    sourceDefaultHint: "默认：消息不限制；任务仅同群成员可委派。",
    sourceSelectedHint: "指定机器人：只有所选机器人可发消息和任务，包括同群成员。",
    sourceInvalid: "存在已失效的来源，请移除后再保存。",
    sourceNeedOne: "请选择至少一个有效的机器人来源。",
    sourceUnavailable: "已失效来源",
    filter: "筛选",
    filterKind: "类型",
    filterAll: "全部",
    filterBots: "Bot",
    filterGroups: "群聊",
    filterActivity: "活动",
    filterActive: "活跃",
    filterRecent: "最近 7 天",
    filterOlder: "较早或无时间",
    filterSource: "来源",
    filterAllSources: "全部来源",
    section: "分组",
    newSection: "新建分组",
    newSectionTitle: "新建分组",
    renameSectionTitle: "重命名分组",
    sectionName: "分组名称",
    sectionNamePlaceholder: "例如：客户、研究",
    sectionCreate: "创建分组",
    sectionRename: "重命名",
    sectionMoveUp: "上移",
    sectionMoveDown: "下移",
    sectionDelete: "删除分组",
    sectionOptions: "分组操作",
    sectionEmpty: "此分组暂无联系人",
    unassigned: "未分组",
    moveToSection: "移动到分组",
    removeFromSection: "移到未分组",
    sectionUndo: "撤销",
    sectionDeleted: "分组已删除，成员已移到未分组。",
    sectionControlUnavailable: "分组管理不可用。",
    sectionConflict: "分组已更新，请重试。",
    routines: "定时",
    routineSearch: "搜索定时任务、机器人或错误",
    routineEmpty: "还没有定时任务",
    routineNoMatch: "没有匹配的定时任务",
    routineAdd: "添加定时任务",
    routineEdit: "编辑定时任务",
    routineDefaultName: "新定时任务",
    routineName: "名称",
    routineBot: "机器人",
    routinePrompt: "任务正文",
    routineFrequency: "频率",
    routineFrequencyOnce: "一次",
    routineFrequencyHourly: "每小时",
    routineFrequencyDaily: "每天",
    routineFrequencyWeekdays: "工作日",
    routineFrequencyWeekly: "每周",
    routineFrequencyMonthly: "每月",
    routineFrequencyInterval: "间隔",
    routineFrequencyAdvanced: "高级 Cron",
    routineOnceDelay: "延迟",
    routineTime: "时间",
    routineWeekday: "星期",
    routineMonthDay: "每月日期",
    routineIntervalAmount: "间隔数量",
    routineIntervalUnit: "间隔单位",
    routineMinutes: "分钟",
    routineHours: "小时",
    routineDays: "天",
    routineSchedule: "计划",
    routineScheduleHint: "保存为计划语法：30m、every 2h 或五字段 Cron。",
    routineLegacyMigrated: "旧间隔数据已迁移为结构化计划。",
    routineCron: "五字段 Cron",
    routineCronHint: "例如：0 9 * * 1-5",
    routineTimezone: "时区",
    routineTimezoneHint: "默认使用浏览器时区；可输入 IANA 时区。",
    routineMaxRuns: "最大运行次数",
    routineMaxRunsHint: "0 表示不限次数。",
    routineUnlimited: "不限",
    routineInvalidSchedule: "请输入有效的频率、时区和计划。",
    routineEnabled: "启用",
    routineStatus: "状态",
    routineEnabledState: "已启用",
    routinePausedState: "已暂停",
    routineNextRun: "下次运行",
    routineLastRun: "最近运行",
    routineRunCount: "运行次数",
    routineOutcomeQueued: "已排队",
    routineOutcomeRunning: "运行中",
    routineOutcomeCompleted: "回合完成",
    routineOutcomeFailed: "失败",
    routineOutcomeInterrupted: "已中断",
    routineHistory: "运行历史",
    routineHistoryEmpty: "还没有运行记录",
    routineHistoryUnavailable: "运行历史不可用",
    routineRunTriggerManual: "手动",
    routineRunTriggerSchedule: "定时",
    routineRunCreated: "创建",
    routineRunStarted: "开始",
    routineRunEnded: "结束",
    routineRunSession: "会话",
    routineRunTurn: "回合",
    routineLastError: "最近错误",
    routineNever: "从未",
    routineRunNow: "立即运行",
    routinePause: "暂停定时",
    routineResume: "启用定时",
    routineDelete: "删除定时任务",
    routineDeleteConfirm: "删除这个定时任务？",
    routineDeleteCaveat: "会移除尚未消费的定时消息，但不会停止已经开始的模型回合。",
    routineSave: "保存定时任务",
    routineBusy: "正在处理…",
    routineBotRequired: "请选择一个可用的机器人。",
    routinePromptHint: "最多 8000 个字符。",
    routineContextFrom: "上下文来源",
    routineContextFromHint: "运行时注入所选来源的最近输出；self 表示本任务上一次运行。",
    routineContextSelf: "上一次运行（self）",
    routineSilentAllowed: "允许静默回复",
    routineSilentAllowedHint: "没有新结果时可只回复 [SILENT]，完成不计为未读。",
    routineWatch: "监视",
    routineWatchNone: "不监视",
    routineWatchUrl: "URL",
    routineWatchCommand: "本地命令",
    routineWatchValue: "监视目标",
    routineWatchHint: "仅当监视内容变化时才运行；命令只可由用户在此设置。",
    routineWatchTimeout: "超时（毫秒）",
    routineTriggerUrl: "触发 URL",
    routineTriggerHint: "本机回环端点，仅本机可调用。",
    routineTriggerShow: "显示触发命令",
    routineTriggerCopy: "复制",
    routineTriggerCopied: "已复制",
    routineTriggerCopyFailed: "复制失败",
    groupRuntime: "群运行态",
    groupRuntimeLoading: "正在加载群运行态…",
    groupRuntimeUnavailable: "群运行态不可用；不会伪装成正常。",
    groupRuntimeError: "群运行态加载失败",
    groupRuntimeNoMembers: "没有可见成员运行态",
    groupMemberRunning: "运行中",
    groupMemberPending: "待处理",
    groupMemberError: "错误",
    groupMemberIdle: "空闲",
    groupMemberStopped: "已停止",
    groupMemberHeld: "已暂停",
    groupMemberPassed: "已完成",
    groupMemberCapped: "已达上限",
    groupMemberTimeout: "已超时",
    groupMemberSessionUnavailable: "成员会话不可用",
    groupHandle: "处理",
    groupInteractionApproval: "审批",
    groupInteractionQuestion: "提问",
    groupApprovalReason: "该成员请求执行工具",
    groupApprovalReject: "拒绝",
    groupApprovalAllow: "仅允许一次",
    groupQuestionCustom: "自定义回答",
    groupQuestionSkip: "跳过此题",
    groupQuestionCancel: "取消请求",
    groupQuestionSubmit: "提交回答",
    groupQuestionIncomplete: "请回答或明确跳过每个问题。",
    groupInteractionBusy: "正在提交…",
    groupInteractionFailed: "提交失败",
    groupNewThread: "新主题",
    groupReply: "在本轮对话中回复",
    groupReplying: "正在回复本轮对话",
    groupReplies: "条回复",
    groupCollapse: "收起本轮对话",
    groupOpenThread: "展开本轮对话",
    groupThreadFallback: "无文字主题",
    groupYou: "你",
    groupAttachment: "附件",
    groupImageUnavailable: "图片不可用",
    groupMemberFailed: "成员执行失败",
    groupActivity: "活动",
    groupActivityEmpty: "还没有活动",
    groupShowActivity: "展开活动",
    groupHideActivity: "收起活动",
    groupStop: "停止群聊",
    groupStopFailed: "停止群聊失败",
    groupDisband: "解散群聊",
    groupDisbandConfirm: "解散这个群聊？",
    groupDisbandCaveat: "只会移除群聊目录和群聊记录；成员自己的会话不会被删除。正在进行的群聊工作会失效。",
    groupMembersCount: "名成员",
    groupMarkdownCopy: "复制代码",
    groupMarkdownCopied: "已复制",
    groupMarkdownFootnotes: "脚注",
    capabilities: "能力",
    capabilityTools: "工具",
    capabilitySkills: "Skills",
    capabilityMcp: "MCP 工具",
    capabilityModeAll: "继承全部",
    capabilityModeSelected: "指定能力",
    capabilityAllHint: "使用当前发现的全部能力。",
    capabilitySelectedHint: "只允许选中的能力；不选任何项表示全部拒绝。",
    capabilitySelect: "选择",
    capabilitySelectGroup: "选择{capability}",
    capabilitySelectedCount: "已选择 {count} 项",
    capabilitySelectedNone: "未选择任何能力（全部拒绝）",
    capabilityPickerDone: "完成",
    capabilityLoad: "正在加载能力目录…",
    capabilityUnavailable: "能力目录不可用，已保存的能力保持不变。",
    capabilityInactive: "机器人会话未激活，暂时无法发现能力。",
    capabilitySkillsUnavailable: "Skills 服务不可用。",
    capabilityEmpty: "没有发现可选能力",
    capabilityStale: "已保存但当前不可用",
    capabilityInvalid: "请移除已失效的能力后再保存。",
    capabilityManage: "管理",
    capabilityManageTools: "管理工具与凭据",
    capabilityManageSkills: "管理与安装 Skills",
    capabilityManageMcp: "管理、测试与登录 MCP",
    capabilityManageUnavailable: "当前 Harness 不提供设置导航，无法打开真实能力管理页。",
    capabilityManageSaveFirst: "请先保存机器人，再管理它所在会话的能力。",
    capabilityScopeTools: "授权选择属于当前 Bot；工具插件与凭据配置属于整个应用。",
    capabilityScopeSkills: "授权选择属于当前 Bot；Skills 安装和编辑作用于当前用户或项目。",
    capabilityScopeMcp: "授权选择属于当前 Bot；MCP 服务、凭据和登录状态属于整个应用。",
    capabilityGlobalConfirmTitle: "打开应用级能力设置？",
    capabilityGlobalConfirmBody: "将离开当前 Bot 编辑器并打开 {capability} 的真实设置页。",
    capabilityGlobalConfirmCaveat: "这里的安装、凭据、启停、测试和登录会影响整个 Harness 应用；Bot 资料只保存允许使用哪些能力。",
    capabilityGlobalConfirm: "打开设置",
    profileTransportUnavailable: "机器人资料服务不可用，无法保存资料。",
    profileSessionUnavailable: "机器人资料服务未返回可用会话。",
    profileCreatedOpenFailed: "已创建，但打开失败：{message}",
    profileSavedOpenFailed: "已保存，但打开失败：{message}",
    memory: "长期记忆",
    memoryLoading: "正在加载记忆…",
    memoryUnavailable: "记忆管理不可用；不会伪装成空记忆。",
    memoryEmpty: "还没有记忆",
    memoryAdd: "添加记忆",
    memoryEdit: "编辑记忆",
    memoryDelete: "删除记忆",
    memorySave: "保存记忆",
    memoryCancel: "取消编辑",
    memoryText: "记忆内容",
    memoryHint: "记忆会写入这个 Bot 的资料，不会改写聊天记录。",
    memoryRequired: "请输入记忆内容。",
    memorySaving: "正在保存记忆…",
    memoryError: "记忆操作失败",
    memoryTrackNotes: "笔记",
    memoryTrackUser: "关于用户",
    memoryUsage: "已用 {used}/{limit}",
    memoryAutoTag: "auto",
    memoryReview: "自主学习记忆",
    memoryReviewHint: "允许 Bot 定期回顾对话，自动把值得长期保留的事实写入记忆（标记为 auto）。",
    objective: "目标",
    objectiveHint: "设定目标后 Bot 会在空闲时持续推进，直到它自报完成、轮数用尽或你暂停。模型需要「全部工具」模式，或在已选工具里勾选 read_goal、create_goal、update_goal 才能自报完成。",
    objectiveRounds: "轮数上限",
    objectiveRoundsHint: "1–200 的整数，默认 16。",
    objectiveStart: "开始",
    objectivePause: "暂停",
    objectiveClear: "清除",
    objectiveIdle: "待启动",
    objectiveWorking: "推进中",
    objectivePaused: "已暂停",
    objectiveBlocked: "已受阻",
    objectiveComplete: "已完成",
    objectiveRoundsCap: "上限 {limit} 轮",
    groupLimits: "群聊限制",
    maxRounds: "最大轮数",
    maxSpeaks: "群聊发言总上限",
    groupLimitHint: "轮数范围 1–3；群聊可见发言总数范围 1–10。",
    taskStatusPaused: "已暂停",
    taskStatusCancelled: "已取消",
    taskPause: "暂停任务",
    taskResume: "恢复任务",
    taskCancel: "取消任务",
    taskCancelConfirm: "取消这个任务？",
    taskRetry: "重试任务",
    taskRetryConfirm: "重试这个已失败或取消的任务？",
    taskSideEffectCaveat: "取消不会撤销已经发生的外部副作用。",
    taskControlUnavailable: "任务控制不可用。",
    sessionStop: "停止会话",
    sessionStopConfirm: "停止这个机器人的整个会话？",
    sessionStopCaveat: "这会停止整个机器人或群聊会话，不是单独取消某个任务；已经发生的外部副作用不会撤销。",
    sessionStopped: "停止请求已发送",
    notify: "通知",
    notifyHint: "窗口未聚焦时允许系统通知：待决请求、目标受阻、定时任务完成。",
    notifyAttention: "有待决定的请求",
    notifyRoutineFinished: "定时任务完成：{name}",
    notifyRoutineFailed: "定时任务失败：{name}",
    notifyObjectiveBlocked: "目标已受阻",
    routinesMissed: "{count} 个 routine 错过运行",
    routinesMissedDismiss: "知道了",
  };

  const en = {
    tab: "Bots",
    search: "Search",
    add: "Add",
    addBot: "New bot",
    addRoom: "New group",
    empty: "No bots yet",
    emptyHint: "Use the plus button to add a contact or group. Groups need 2–6 members.",
    roomEmptyHint: "Say something - every bot in this group hears the room.",
    edit: "Edit profile",
    duplicate: "Duplicate",
    delete: "Delete",
    cancel: "Cancel",
    save: "Save",
    confirmDelete: "Remove this entry? The session stays on disk; it only leaves the list.",
    deletePreviewLoading: "Checking deletion impact…",
    deletePreviewUnavailable: "Could not check deletion impact; deletion is stopped.",
    deleteDependencies: "Deletion impact",
    deletePreserves: "Preserved",
    deleteGroups: "Groups",
    deleteRoutines: "Routines",
    deleteTasks: "Tasks",
    deleteSources: "Source rules",
    deleteNone: "None",
    deleteConfirmCascade: "I confirm the dependency impact above",
    hostWarning: "Host warning",
    name: "Name",
    title: "Title",
    stableAddress: "Stable address",
    description: "Description / persona",
    personaHint: "Chips write non-overlapping personas you can still edit.",
    personaOppose: "Oppose",
    personaFill: "Fill",
    personaShip: "Ship",
    personaSharp: "Sharp",
    model: "Model",
    workspace: "Workspace",
    workspaceNone: "No directory",
    workspaceLocked: "A bot with messages or an established group cannot change workspace. Create a new one.",
    pin: "Pin",
    unpin: "Unpin",
    hide: "Hide",
    unhide: "Unhide",
    showHidden: "Show hidden",
    hideHidden: "Hide hidden list",
    members: "Members",
    membersHint: "Pick 2–6 existing bots (not groups).",
    roomName: "Group name",
    defaultBotName: "New bot",
    defaultRoomName: "New group",
    provider: "Provider",
    noModel: "Deployment default",
    modelUnavailable: "The bot has no usable model configuration.",
    modelCatalogLoading: "Loading model catalog…",
    modelCatalogUnavailable: "Model catalog unavailable; the current model configuration is preserved.",
    modelCatalogError: "Model catalog failed to load",
    modelProviderDefault: "Deployment default",
    modelSelect: "Choose a model",
    reasoningEffort: "Reasoning effort",
    reasoningDefault: "Model default",
    reasoningUnavailable: "This model has no selectable reasoning effort",
    error: "Something went wrong",
    saving: "Saving…",
    close: "Close",
    avatar: "Avatar",
    avatarBlob: "Robot",
    avatarUpload: "Upload",
    avatarPick: "Choose image",
    avatarCircle: "Circle",
    avatarSquare: "Square",
    avatarTooLarge: "That image is too large. Pick a smaller one.",
    avatarBadImage: "Could not read that image.",
    avatarCropZoom: "Zoom",
    avatarCropApply: "Apply",
    thinking: "Thinking",
    roomBadge: "Group",
    unreadCompleted: "Unread completed result",
    sessionAttention: "Needs attention",
    sessionError: "Session error",
    applicationDefault: "Application default",
    roomSettings: "Room settings",
    catalogUnavailable: "Bot catalog is unavailable",
    catalogReadOnly: "Bot catalog is read-only",
    saveConflict: "The profile changed. Reopen the editor before saving. Your draft has not been saved.",
    invalidSources: "Select at least one valid bot source.",
    contacts: "Contacts",
    tasks: "Tasks",
    taskSearch: "Search tasks, IDs, or participants",
    taskStatusFilter: "Status",
    taskStatusAll: "All",
    taskStatusQueued: "Queued",
    taskStatusDelivered: "Delivered",
    taskStatusCompleted: "Completed",
    taskStatusFailed: "Failed",
    taskStatusUnknown: "Unknown status",
    taskEmpty: "No tasks yet",
    taskNoMatch: "No matching tasks",
    taskDetails: "Task details",
    taskId: "Task ID",
    taskParticipants: "Participants",
    taskSender: "Requester",
    taskRecipient: "Recipient",
    taskBody: "Task",
    taskConstraints: "Constraints",
    taskSuccessCriteria: "Success criteria",
    taskResult: "Result",
    taskError: "Error",
    taskCreatedAt: "Created",
    taskUpdatedAt: "Updated",
    taskAttempts: "Delivery attempts",
    taskEvents: "Events",
    taskNone: "None",
    openConversation: "Open conversation",
    participantUnavailable: "Participant unavailable",
    participantMissing: "Not in the catalog or no usable session",
    catalogLoading: "Loading bot catalog…",
    catalogUnavailableState: "Bot catalog is unavailable",
    catalogReadOnlyState: "Bot catalog is read-only. Changes cannot be saved.",
    sourcePolicy: "Message and task sources",
    sourceDefault: "Default rule",
    sourceSelected: "Selected bots",
    sourceDefaultHint: "Default: messages are unrestricted; tasks can be delegated to shared-room members.",
    sourceSelectedHint: "Selected bots: only these bots can send messages and tasks, including shared-room members.",
    sourceInvalid: "A source is no longer available. Remove it before saving.",
    sourceNeedOne: "Select at least one valid bot source.",
    sourceUnavailable: "Unavailable source",
    filter: "Filter",
    filterKind: "Type",
    filterAll: "All",
    filterBots: "Bots",
    filterGroups: "Groups",
    filterActivity: "Activity",
    filterActive: "Active",
    filterRecent: "Last 7 days",
    filterOlder: "Older or undated",
    filterSource: "Source",
    filterAllSources: "All sources",
    section: "Sections",
    newSection: "New section",
    newSectionTitle: "New section",
    renameSectionTitle: "Rename section",
    sectionName: "Section name",
    sectionNamePlaceholder: "For example: Clients, Research",
    sectionCreate: "Create section",
    sectionRename: "Rename",
    sectionMoveUp: "Move up",
    sectionMoveDown: "Move down",
    sectionDelete: "Delete section",
    sectionOptions: "Section options",
    sectionEmpty: "No contacts in this section",
    unassigned: "Unassigned",
    moveToSection: "Move to section",
    removeFromSection: "Move to Unassigned",
    sectionUndo: "Undo",
    sectionDeleted: "Section deleted; members moved to Unassigned.",
    sectionControlUnavailable: "Section management is unavailable.",
    sectionConflict: "The section changed. Try again.",
    routines: "Routines",
    routineSearch: "Search routines, bots, or errors",
    routineEmpty: "No routines yet",
    routineNoMatch: "No matching routines",
    routineAdd: "Add routine",
    routineEdit: "Edit routine",
    routineDefaultName: "New routine",
    routineName: "Name",
    routineBot: "Bot",
    routinePrompt: "Task prompt",
    routineFrequency: "Frequency",
    routineFrequencyOnce: "Once",
    routineFrequencyHourly: "Hourly",
    routineFrequencyDaily: "Daily",
    routineFrequencyWeekdays: "Weekdays",
    routineFrequencyWeekly: "Weekly",
    routineFrequencyMonthly: "Monthly",
    routineFrequencyInterval: "Interval",
    routineFrequencyAdvanced: "Advanced cron",
    routineOnceDelay: "Delay",
    routineTime: "Time",
    routineWeekday: "Weekday",
    routineMonthDay: "Day of month",
    routineIntervalAmount: "Interval amount",
    routineIntervalUnit: "Interval unit",
    routineMinutes: "Minutes",
    routineHours: "Hours",
    routineDays: "Days",
    routineSchedule: "Schedule",
    routineScheduleHint: "Saved as schedule syntax: 30m, every 2h, or five-field cron.",
    routineLegacyMigrated: "Legacy interval data was migrated to a structured schedule.",
    routineCron: "Five-field cron",
    routineCronHint: "For example: 0 9 * * 1-5",
    routineTimezone: "Timezone",
    routineTimezoneHint: "Defaults to the browser timezone; enter an IANA timezone.",
    routineMaxRuns: "Maximum runs",
    routineMaxRunsHint: "0 means unlimited.",
    routineUnlimited: "Unlimited",
    routineInvalidSchedule: "Enter a valid frequency, timezone, and schedule.",
    routineEnabled: "Enabled",
    routineStatus: "Status",
    routineEnabledState: "Enabled",
    routinePausedState: "Paused",
    routineNextRun: "Next run",
    routineLastRun: "Last run",
    routineRunCount: "Run count",
    routineOutcomeQueued: "Queued",
    routineOutcomeRunning: "Running",
    routineOutcomeCompleted: "Turn completed",
    routineOutcomeFailed: "Failed",
    routineOutcomeInterrupted: "Interrupted",
    routineHistory: "Run history",
    routineHistoryEmpty: "No run history",
    routineHistoryUnavailable: "Run history unavailable",
    routineRunTriggerManual: "Manual",
    routineRunTriggerSchedule: "Scheduled",
    routineRunCreated: "Created",
    routineRunStarted: "Started",
    routineRunEnded: "Ended",
    routineRunSession: "Session",
    routineRunTurn: "Turn",
    routineLastError: "Last error",
    routineNever: "Never",
    routineRunNow: "Run now",
    routinePause: "Pause routine",
    routineResume: "Enable routine",
    routineDelete: "Delete routine",
    routineDeleteConfirm: "Delete this routine?",
    routineDeleteCaveat: "Undelivered routine mail will be removed, but an already-started model turn will not be stopped.",
    routineSave: "Save routine",
    routineBusy: "Working…",
    routineBotRequired: "Choose an available bot.",
    routinePromptHint: "Up to 8000 characters.",
    routineContextFrom: "Context sources",
    routineContextFromHint: "Each run injects the latest output of the picked sources; self means this routine's previous run.",
    routineContextSelf: "Previous run (self)",
    routineSilentAllowed: "Allow silent reply",
    routineSilentAllowedHint: "The bot may reply only [SILENT] when there is nothing new; silent runs never count as unread.",
    routineWatch: "Watch",
    routineWatchNone: "No watch",
    routineWatchUrl: "URL",
    routineWatchCommand: "Local command",
    routineWatchValue: "Watch target",
    routineWatchHint: "The routine only runs when the watched content changes; commands can only be set here by the user.",
    routineWatchTimeout: "Timeout (ms)",
    routineTriggerUrl: "Trigger URL",
    routineTriggerHint: "Loopback endpoint; callable only from this machine.",
    routineTriggerShow: "Show trigger command",
    routineTriggerCopy: "Copy",
    routineTriggerCopied: "Copied",
    routineTriggerCopyFailed: "Copy failed",
    groupRuntime: "Group runtime",
    groupRuntimeLoading: "Loading group runtime…",
    groupRuntimeUnavailable: "Group runtime is unavailable; it is not shown as healthy.",
    groupRuntimeError: "Group runtime failed to load",
    groupRuntimeNoMembers: "No member runtime is available",
    groupMemberRunning: "Running",
    groupMemberPending: "Pending",
    groupMemberError: "Error",
    groupMemberIdle: "Idle",
    groupMemberStopped: "Stopped",
    groupMemberHeld: "Held",
    groupMemberPassed: "Passed",
    groupMemberCapped: "Capped",
    groupMemberTimeout: "Timed out",
    groupMemberSessionUnavailable: "Member session unavailable",
    groupHandle: "Handle",
    groupInteractionApproval: "Approval",
    groupInteractionQuestion: "Question",
    groupApprovalReason: "This member requests permission to run a tool",
    groupApprovalReject: "Reject",
    groupApprovalAllow: "Allow once",
    groupQuestionCustom: "Custom answer",
    groupQuestionSkip: "Skip this question",
    groupQuestionCancel: "Cancel request",
    groupQuestionSubmit: "Submit answers",
    groupQuestionIncomplete: "Answer or explicitly skip every question.",
    groupInteractionBusy: "Submitting…",
    groupInteractionFailed: "Submission failed",
    groupNewThread: "New thread",
    groupReply: "Reply in thread",
    groupReplying: "Replying in thread",
    groupReplies: "replies",
    groupCollapse: "Collapse thread",
    groupOpenThread: "Open thread",
    groupThreadFallback: "Untitled thread",
    groupYou: "You",
    groupAttachment: "Attachment",
    groupImageUnavailable: "Image unavailable",
    groupMemberFailed: "Member run failed",
    groupActivity: "Activity",
    groupActivityEmpty: "No activity yet",
    groupShowActivity: "Show activity",
    groupHideActivity: "Hide activity",
    groupStop: "Stop group chat",
    groupStopFailed: "Could not stop group chat",
    groupDisband: "Disband group chat",
    groupDisbandConfirm: "Disband this group chat?",
    groupDisbandCaveat: "Only the group catalog entry and room record are removed; member conversations are preserved. Active group work is invalidated.",
    groupMembersCount: "members",
    groupMarkdownCopy: "Copy code",
    groupMarkdownCopied: "Copied",
    groupMarkdownFootnotes: "Footnotes",
    capabilities: "Capabilities",
    capabilityTools: "Tools",
    capabilitySkills: "Skills",
    capabilityMcp: "MCP tools",
    capabilityModeAll: "All discovered",
    capabilityModeSelected: "Selected only",
    capabilityAllHint: "Use every capability currently discovered.",
    capabilitySelectedHint: "Only checked capabilities are allowed; empty means deny all.",
    capabilitySelect: "Select",
    capabilitySelectGroup: "Select {capability}",
    capabilitySelectedCount: "{count} selected",
    capabilitySelectedNone: "No capabilities selected (deny all)",
    capabilityPickerDone: "Done",
    capabilityLoad: "Loading capability catalog…",
    capabilityUnavailable: "Capability catalog unavailable; saved capabilities are preserved.",
    capabilityInactive: "The bot conversation is inactive, so capabilities cannot be discovered yet.",
    capabilitySkillsUnavailable: "The Skills service is unavailable.",
    capabilityEmpty: "No selectable capabilities discovered",
    capabilityStale: "Saved but currently unavailable",
    capabilityInvalid: "Remove unavailable capabilities before saving.",
    capabilityManage: "Manage",
    capabilityManageTools: "Manage tools and credentials",
    capabilityManageSkills: "Manage and install Skills",
    capabilityManageMcp: "Manage, test, and sign in to MCP",
    capabilityManageUnavailable: "This Harness build does not expose Settings navigation, so the real capability page cannot be opened.",
    capabilityManageSaveFirst: "Save the bot before managing capabilities for its conversation.",
    capabilityScopeTools: "The grant belongs to this Bot; tool plugins and credentials are application-wide.",
    capabilityScopeSkills: "The grant belongs to this Bot; Skill installation and editing affect the current user or project.",
    capabilityScopeMcp: "The grant belongs to this Bot; MCP servers, credentials, and sign-in state are application-wide.",
    capabilityGlobalConfirmTitle: "Open application-wide capability settings?",
    capabilityGlobalConfirmBody: "This closes the Bot editor and opens the real {capability} Settings page.",
    capabilityGlobalConfirmCaveat: "Installation, credentials, enablement, testing, and sign-in here affect the entire Harness application. The Bot profile only stores which capabilities it may use.",
    capabilityGlobalConfirm: "Open Settings",
    profileTransportUnavailable: "Bot profile service is unavailable; the profile cannot be saved.",
    profileSessionUnavailable: "The bot profile service did not return a usable session.",
    profileCreatedOpenFailed: "Created, but opening failed: {message}",
    profileSavedOpenFailed: "Saved, but opening failed: {message}",
    memory: "Long-term memory",
    memoryLoading: "Loading memory…",
    memoryUnavailable: "Memory management is unavailable; it is not shown as empty.",
    memoryEmpty: "No memory entries yet",
    memoryAdd: "Add memory",
    memoryEdit: "Edit memory",
    memoryDelete: "Delete memory",
    memorySave: "Save memory",
    memoryCancel: "Cancel editing",
    memoryText: "Memory content",
    memoryHint: "Memory is stored on this Bot profile and does not rewrite chat history.",
    memoryRequired: "Enter some memory content.",
    memorySaving: "Saving memory…",
    memoryError: "Memory operation failed",
    memoryTrackNotes: "Notes",
    memoryTrackUser: "About the user",
    memoryUsage: "Used {used}/{limit}",
    memoryAutoTag: "auto",
    memoryReview: "Learn memory automatically",
    memoryReviewHint: "Lets the Bot periodically review the conversation and write durable facts into memory (tagged auto).",
    objective: "Objective",
    objectiveHint: "With an objective set, the Bot keeps working while idle until it reports done, the round cap runs out, or you pause it. The model needs All tools mode, or read_goal, create_goal, and update_goal checked under selected tools, to report completion.",
    objectiveRounds: "Round cap",
    objectiveRoundsHint: "An integer from 1–200; defaults to 16.",
    objectiveStart: "Start",
    objectivePause: "Pause",
    objectiveClear: "Clear",
    objectiveIdle: "Idle",
    objectiveWorking: "Working",
    objectivePaused: "Paused",
    objectiveBlocked: "Blocked",
    objectiveComplete: "Done",
    objectiveRoundsCap: "Up to {limit} rounds",
    groupLimits: "Group limits",
    maxRounds: "Maximum rounds",
    maxSpeaks: "Total visible room messages",
    groupLimitHint: "Rounds: 1–3; total visible room messages: 1–10.",
    taskStatusPaused: "Paused",
    taskStatusCancelled: "Cancelled",
    taskPause: "Pause task",
    taskResume: "Resume task",
    taskCancel: "Cancel task",
    taskCancelConfirm: "Cancel this task?",
    taskRetry: "Retry task",
    taskRetryConfirm: "Retry this failed or cancelled task?",
    taskSideEffectCaveat: "Cancellation cannot undo external side effects that already happened.",
    taskControlUnavailable: "Task controls are unavailable.",
    sessionStop: "Stop session",
    sessionStopConfirm: "Stop this bot's entire conversation?",
    sessionStopCaveat: "This stops the whole bot or group conversation, not one task; external side effects are not undone.",
    sessionStopped: "Stop requested",
    notify: "Notifications",
    notifyHint: "Allow system notifications while the window is unfocused: pending requests, blocked objectives, finished routines.",
    notifyAttention: "A request is waiting for a decision",
    notifyRoutineFinished: "Routine finished: {name}",
    notifyRoutineFailed: "Routine failed: {name}",
    notifyObjectiveBlocked: "Objective is blocked",
    routinesMissed: "{count} routines missed runs",
    routinesMissedDismiss: "Dismiss",
  };

  const CSS = `
.dshbot-page, .dshbot-form, .dshbot-bubble, .dshbot-roster, .dshbot-avatar-slot {
  --dshbot-blob-ink: var(--dsw-alias-label-primary);
  --dshbot-blob-brown: color-mix(in srgb, var(--dsw-static-amber-600) 70%, var(--dsw-static-neutral-bluish-1000));
  --dshbot-blob-red: var(--dsw-static-red-500);
  --dshbot-blob-orange: var(--dsw-static-amber-500);
  --dshbot-blob-yellow: var(--dsw-static-amber-400);
  --dshbot-blob-green: var(--dsw-static-green-500);
  --dshbot-blob-teal: color-mix(in srgb, var(--dsw-static-green-500) 55%, var(--dsw-static-deepseek-500));
  --dshbot-blob-blue: var(--dsw-static-deepseek-500);
  --dshbot-blob-purple: color-mix(in srgb, var(--dsw-static-red-500) 40%, var(--dsw-static-deepseek-600));
  --dshbot-blob-pink: color-mix(in srgb, var(--dsw-static-red-400) 70%, var(--dsw-static-neutral-bluish-00));
  --dshbot-blob-grey: var(--dsw-alias-label-tertiary);
}
.dshbot-page { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); }
  .dshbot-page { min-width: 0; overflow: hidden; }
  .dshbot-toolbar { display: flex; align-items: center; gap: 8px; padding: 0 0 8px; min-width: 0; }
  .dshbot-toolbar .dshbot-search { flex: 1; min-width: 0; }
  .dshbot-toolbar-action { flex: none; }
  .dshbot-filter-button[data-active="true"] { color: var(--dsw-alias-state-business-primary); }
  .dshbot-view-tabs { display: flex; flex: none; gap: 4px; width: 100%; min-width: 0; padding: 0 0 12px; box-sizing: border-box; }
  .dshbot-view-tabs [role="tab"] {
    flex: 1 1 0;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    box-shadow: none;
    color: var(--dsw-alias-label-secondary);
    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
  }
  .dshbot-view-tabs [role="tab"]:hover,
  .dshbot-view-tabs [role="tab"][aria-selected="true"] { background: var(--dsw-alias-interactive-bg-hover); }
  .dshbot-view-tabs [role="tab"][aria-selected="true"] { color: var(--dsw-alias-label-primary); }
.dshbot-task-toolbar { display: flex; align-items: center; gap: 8px; padding: 0 0 8px; }
.dshbot-task-toolbar .dshbot-task-search { flex: 1; min-width: 0; }
.dshbot-task-filter { flex: none; min-width: 96px; max-width: 148px; }
.dshbot-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.dshbot-row { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent; color: inherit; text-align: start; padding: 8px 10px; border-radius: 10px; cursor: pointer; }
.dshbot-row:hover, .dshbot-row[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.dshbot-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .dshbot-row-top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .dshbot-name { flex: 1; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dshbot-address { flex: none; max-width: 34%; color: var(--dsw-alias-label-tertiary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dshbot-time { margin-left: auto; flex-shrink: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dshbot-preview { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshbot-avatar-frame { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: visible; border-radius: 50%; }
.dshbot-avatar-frame[data-crop="circle"] { border-radius: 50%; overflow: hidden; }
.dshbot-avatar-frame[data-crop="square"] { border-radius: 10px; overflow: hidden; }
.dshbot-avatar-frame[data-active="true"] {
  box-shadow:
    0 0 0 2px var(--dsw-alias-bg-layer-1),
    0 0 0 4px color-mix(in srgb, currentColor 60%, transparent);
}
.dshbot-avatar-image { width: 100%; height: 100%; object-fit: cover; display: block; }
.dshbot-blob { width: 100%; height: 100%; display: block; overflow: visible; transform-origin: 50% 70%; will-change: transform; }
.dshbot-blob-eyes { transform: translate(var(--eye-x, 0px), var(--eye-y, 0px)); }
.dshbot-blob-eye-white { fill: var(--dsw-static-neutral-bluish-00); stroke: var(--dsw-static-neutral-bluish-1000); stroke-width: 1.15; }
.dshbot-blob-eye-pupil { fill: var(--dsw-static-neutral-bluish-1000); }
.dshbot-blob-eye-catchlight { fill: var(--dsw-static-neutral-bluish-00); }
.dshbot-blob-eye-closed { fill: none; stroke: var(--dsw-static-neutral-bluish-1000); stroke-width: 1.8; stroke-linecap: round; opacity: 0; }
.dshbot-blob-work-dots { fill: currentColor; opacity: 0; }
.dshbot-picker { display: flex; flex-direction: column; gap: 12px; }
.dshbot-picker-blob { display: flex; flex-direction: column; gap: 12px; }
.dshbot-pills { display: flex; gap: 4px; flex-wrap: wrap; }
.dshbot-crop { display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
.dshbot-crop-stage { position: relative; align-self: center; overflow: hidden; border-radius: 12px; background: var(--dsw-alias-bg-layer-1); touch-action: none; cursor: grab; }
.dshbot-crop-stage:active { cursor: grabbing; }
.dshbot-crop-stage img { position: absolute; left: 0; top: 0; max-width: none; user-select: none; -webkit-user-drag: none; }
.dshbot-crop-mask { position: absolute; inset: 0; pointer-events: none; }
.dshbot-crop-mask::before { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.75); box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45); }
.dshbot-crop-zoom { width: 100%; accent-color: var(--dsw-alias-state-business-primary); cursor: pointer; }
.dshbot-crop-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dshbot-shape-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(52px, 1fr)); gap: 8px; }
.dshbot-shape-cell { aspect-ratio: 1; border: 0; border-radius: 12px; background: var(--dsw-alias-bg-module-platform); color: inherit; display: flex; align-items: center; justify-content: center; padding: 8px; cursor: pointer; }
.dshbot-shape-cell[aria-pressed="true"] { box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-hover); }
.dshbot-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.dshbot-swatch { width: 28px; height: 28px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; background: var(--swatch); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.dshbot-swatch[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--dsw-alias-label-primary-foreground), 0 0 0 1px var(--dsw-alias-border-l2); }
.dshbot-upload { display: flex; flex-direction: column; gap: 12px; }
.dshbot-blob-ink { color: var(--dshbot-blob-ink); }
.dshbot-blob-brown { color: var(--dshbot-blob-brown); }
.dshbot-blob-red { color: var(--dshbot-blob-red); }
.dshbot-blob-orange { color: var(--dshbot-blob-orange); }
.dshbot-blob-yellow { color: var(--dshbot-blob-yellow); }
.dshbot-blob-green { color: var(--dshbot-blob-green); }
.dshbot-blob-teal { color: var(--dshbot-blob-teal); }
.dshbot-blob-blue { color: var(--dshbot-blob-blue); }
.dshbot-blob-purple { color: var(--dshbot-blob-purple); }
.dshbot-blob-pink { color: var(--dshbot-blob-pink); }
.dshbot-blob-grey { color: var(--dshbot-blob-grey); }
@media (prefers-reduced-motion: reduce) {
  .dshbot-blob { transform: none !important; will-change: auto; }
  .dshbot-blob-eyes { transform: none !important; }
  .dshbot-avatar-frame[data-mood="work"] .dshbot-blob-work-dots { opacity: .46; }
}
  .dshbot-empty { padding: 24px 12px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }
  .dshbot-state { flex: none; padding: 0 0 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
  .dshbot-section-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
  .dshbot-section { min-width: 0; }
  .dshbot-section-header { display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 30px; padding: 2px 4px 2px 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
  .dshbot-section-toggle { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; padding: 4px 6px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; text-align: start; cursor: pointer; }
  .dshbot-section-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
  .dshbot-section-toggle-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dshbot-section-count { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
  .dshbot-section-menu { flex: none; width: 28px; min-width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
  .dshbot-section-menu:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
  .dshbot-section-items { min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 2px; }
  .dshbot-section-empty { margin: 4px 8px 0; padding: 8px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; overflow-wrap: anywhere; }
  .dshbot-section-undo { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
  .dshbot-section-undo > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .dshbot-section-error { flex: none; padding: 4px 8px; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dshbot-task-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.dshbot-task-row { display: flex; flex-direction: column; align-items: stretch; gap: 4px; width: 100%; min-width: 0; padding: 8px 10px; border: 0; border-radius: 10px; background: transparent; color: inherit; text-align: start; cursor: pointer; }
.dshbot-task-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshbot-task-row-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dshbot-task-status { flex: none; max-width: 40%; padding: 2px 6px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dshbot-task-id { flex: 1; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-task-time { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dshbot-task-participants { min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-task-summary { min-width: 0; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-task-modal { width: min(560px, calc(100vw - 24px)); max-width: calc(100vw - 24px); }
.dshbot-task-detail { display: flex; flex-direction: column; gap: 12px; min-width: 0; max-height: calc(100vh - 200px); overflow: auto; }
.dshbot-task-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshbot-task-label { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshbot-task-value { min-width: 0; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-task-participant-list { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dshbot-task-participant { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshbot-task-participant-name { flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-task-event-list { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dshbot-task-event { min-width: 0; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshbot-task-event:first-child { padding-top: 0; border-top: 0; }
.dshbot-task-event-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-task-event-detail { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-task-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding-top: 4px; }
.dshbot-task-action-error { flex-basis: 100%; }
.dshbot-confirm { display: flex; flex-direction: column; gap: 12px; min-width: 0; max-width: 460px; }
.dshbot-confirm-caveat { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
.dshbot-routine-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.dshbot-routine-row { box-sizing: border-box; display: flex; flex-direction: column; align-items: stretch; gap: 8px; width: 100%; min-width: 0; padding: 10px; border-radius: 8px; }
.dshbot-routine-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshbot-routine-row[data-error="true"] { box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1); }
.dshbot-routine-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.dshbot-routine-head { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
.dshbot-routine-name { min-width: 0; font-weight: 500; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-routine-status { flex: none; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshbot-routine-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-routine-prompt { color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-routine-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-routine-history { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshbot-routine-history-heading { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.dshbot-routine-history-empty { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dshbot-routine-history-row { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshbot-routine-history-row:first-of-type { padding-top: 0; border-top: 0; }
.dshbot-routine-history-meta { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-routine-history-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-group-runtime { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-group-runtime-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dshbot-group-runtime-name { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-group-runtime-status[data-state="running"] { color: var(--dsw-alias-state-business-primary); }
.dshbot-group-runtime-status[data-state="pending"] { color: var(--dsw-alias-state-warn-primary); }
.dshbot-group-runtime-status[data-state="error"] { color: var(--dsw-alias-state-error-primary); }
.dshbot-group-runtime-panel { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 10px; border-top: 1px solid var(--dsw-alias-border-l1); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshbot-group-runtime-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.dshbot-group-runtime-panel-heading > span { min-width: 0; font-size: 13px; font-weight: 500; }
.dshbot-group-runtime-members { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dshbot-group-runtime-member { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.dshbot-group-runtime-member-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dshbot-group-runtime-member-head { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.dshbot-group-runtime-member-name { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-group-runtime-member-status { flex: none; font-size: 12px; }
.dshbot-group-runtime-member-status[data-state="running"] { color: var(--dsw-alias-state-business-primary); }
.dshbot-group-runtime-member-status[data-state="pending"] { color: var(--dsw-alias-state-warn-primary); }
.dshbot-group-runtime-member-status[data-state="error"] { color: var(--dsw-alias-state-error-primary); }
.dshbot-group-runtime-member-error { color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-group-interaction { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 8px; min-width: 0; width: 100%; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
.dshbot-group-interaction-copy { color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-group-interaction-actions { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.dshbot-group-question-list { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dshbot-group-question { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin: 0; padding: 0; border: 0; }
.dshbot-group-question legend { padding: 0; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; font-weight: 500; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-group-question-options { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshbot-group-question-option { display: grid; grid-template-columns: 16px minmax(0, 1fr); align-items: start; gap: 6px; min-width: 0; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; }
.dshbot-group-question-option input { margin: 2px 0 0; }
.dshbot-group-question-option-body { display: flex; flex-direction: column; min-width: 0; }
.dshbot-group-question-option-description { color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; word-break: break-word; }
.dshbot-group-question-custom { width: 100%; min-width: 0; resize: vertical; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 6px 8px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font: inherit; line-height: 18px; }
.dshbot-group-interaction-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-room-body { height: 100%; min-height: 0; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); }
.dshbot-room-participants { flex: none; width: min(100%, var(--dsh-chat-user-width, 920px)); min-width: 0; min-height: 40px; margin: 0 auto; padding: 6px 20px 2px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; }
.dshbot-room-participant-list { min-width: 0; display: flex; align-items: center; }
.dshbot-room-participant { position: relative; display: inline-flex; align-items: center; border-radius: 50%; }
.dshbot-room-participant + .dshbot-room-participant { margin-left: -4px; }
.dshbot-room-participant[data-state="running"] .dshbot-avatar-frame,
.dshbot-room-participant[data-state="pending"] .dshbot-avatar-frame { z-index: 1; }
.dshbot-room-member-count { min-width: 0; flex: 1; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshbot-room-participant-actions { flex: none; display: flex; align-items: center; gap: 2px; }
.dshbot-room-activity { flex: none; width: min(100%, var(--dsh-chat-user-width, 920px)); min-width: 0; margin: 0 auto; padding: 6px 20px; box-sizing: border-box; }
.dshbot-room-activity-toggle { width: 100%; min-width: 0; justify-content: flex-start; gap: 8px; color: var(--dsw-alias-label-secondary); }
.dshbot-room-activity-summary { min-width: 0; flex: 1; display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.dshbot-room-activity-list { display: flex; flex-direction: column; gap: 6px; padding: 8px 0 2px 22px; }
.dshbot-room-activity-row { display: flex; align-items: baseline; gap: 8px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshbot-room-activity-row-copy { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-room-activity-row[data-state="error"], .dshbot-room-activity-row[data-state="failed"] { color: var(--dsw-alias-state-error-primary); }
.dshbot-room-activity-stop { flex: none; }
.dshbot-room-scroll { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; }
.dshbot-room-threads { width: min(100%, var(--dsh-chat-user-width, 920px)); min-width: 0; margin: 0 auto; padding: 16px 20px calc(var(--dsh-composer-height, 152px) + 16px); display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; }
.dshbot-room-empty { padding: 48px 16px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; text-align: center; }
.dshbot-thread { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.dshbot-thread[data-historical="true"] { padding-left: 12px; border-left: 2px solid var(--dsw-alias-border-l2); }
.dshbot-thread-fold { width: 100%; min-width: 0; justify-content: flex-start; gap: 8px; }
.dshbot-thread-fold-text { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.dshbot-thread-meta { flex: none; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshbot-thread-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.dshbot-thread-collapse { color: var(--dsw-alias-label-secondary); }
.dshbot-thread-messages { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.dshbot-thread-message { min-width: 0; display: flex; align-items: flex-start; gap: 8px; }
.dshbot-thread-message[data-speaker="user"] { justify-content: flex-end; }
.dshbot-thread-message-body { min-width: 0; max-width: min(78%, 720px); display: flex; flex-direction: column; gap: 4px; }
.dshbot-thread-message[data-speaker="user"] .dshbot-thread-message-body { align-items: flex-end; }
.dshbot-thread-message-meta { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshbot-thread-message-name { min-width: 0; color: var(--dsw-alias-label-primary); font-weight: 500; overflow-wrap: anywhere; }
.dshbot-thread-message-content { min-width: 0; max-width: 100%; padding: 8px 12px; border-radius: 8px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); font-size: 14px; line-height: 22px; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-thread-message[data-speaker="user"] .dshbot-thread-message-content { background: var(--dsw-specific-bubble); border-color: transparent; }
.dshbot-thread-message[data-state="failed"] .dshbot-thread-message-content { color: var(--dsw-alias-state-error-primary); }
.dshbot-thread-attachments { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; max-width: 100%; }
.dshbot-thread-attachment { max-width: 240px; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
.dshbot-thread-attachment img { display: block; max-width: 220px; max-height: 180px; object-fit: contain; border-radius: 8px; }
.dshbot-thread-file-copy { min-width: 0; display: flex; flex-direction: column; }
.dshbot-thread-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshbot-thread-file-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshbot-thread-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshbot-thread-replying { color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 18px; }
@media (max-width: 480px) {
  .dshbot-room-participants { padding: 6px 8px 2px; }
  .dshbot-room-activity { padding: 6px 8px; }
  .dshbot-room-threads { padding: 12px 8px calc(var(--dsh-composer-height, 152px) + 12px); }
  .dshbot-thread[data-historical="true"] { padding-left: 8px; }
  .dshbot-thread-message-body { max-width: 88%; }
  .dshbot-thread-meta { white-space: normal; text-align: right; }
}
.dshbot-routine-actions { flex: none; align-self: flex-end; display: flex; align-items: center; gap: 2px; }
.dshbot-routine-toolbar { display: flex; align-items: center; gap: 8px; padding: 0 0 8px; }
.dshbot-routine-toolbar .dshbot-routine-search { flex: 1; min-width: 0; }
.dshbot-routine-form { display: flex; flex-direction: column; gap: 12px; width: 100%; min-width: 0; max-width: 460px; max-height: calc(100vh - 200px); overflow: auto; }
.dshbot-routine-schedule-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; min-width: 0; }
.dshbot-routine-trigger { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.dshbot-routine-trigger-command { flex: 1; min-width: 0; font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; color: var(--dsw-alias-label-primary); }
.dshbot-time-input { width: 100%; min-width: 0; box-sizing: border-box; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 20px; }
.dshbot-time-input:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.dshbot-capability-group { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshbot-capability-groups { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dshbot-capability-group:first-child { padding-top: 0; border-top: 0; }
.dshbot-capability-heading { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dshbot-capability-heading > span { min-width: 0; font-size: 14px; font-weight: 500; }
.dshbot-capability-manage { flex: none; margin-left: auto; }
.dshbot-capability-selection { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.dshbot-capability-selection-summary { min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dshbot-capability-select { flex: none; }
.dshbot-capability-picker { display: flex; flex-direction: column; gap: 10px; width: min(100%, 480px); min-width: 0; max-height: min(64vh, 520px); overflow: hidden; }
.dshbot-capability-picker .dshbot-capability-options { max-height: min(52vh, 380px); padding-right: 4px; }
.dshbot-capability-options { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow: auto; min-width: 0; }
.dshbot-capability-option { display: flex; align-items: flex-start; gap: 8px; min-width: 0; font-size: 13px; line-height: 20px; }
.dshbot-capability-option input { flex: none; margin-top: 3px; }
.dshbot-capability-option-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dshbot-capability-name { overflow-wrap: anywhere; word-break: break-word; }
.dshbot-capability-description { color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; word-break: break-word; }
.dshbot-capability-stale { color: var(--dsw-alias-state-error-primary); }
.dshbot-capability-empty { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dshbot-number-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshbot-number-row label { flex: 1; min-width: 0; }
.dshbot-number-input { width: 88px; flex: none; box-sizing: border-box; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 20px; }
.dshbot-number-input:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.dshbot-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.dshbot-switch-row label { min-width: 0; }
.dshbot-control-unavailable { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshbot-source-options { display: flex; flex-direction: column; gap: 6px; max-height: 200px; min-width: 0; overflow: auto; }
.dshbot-source-option { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14px; line-height: 22px; }
.dshbot-source-option > span { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.dshbot-source-invalid { color: var(--dsw-alias-state-error-primary); }
.dshbot-textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; }
.dshbot-roster { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; max-width: 480px; }
.dshbot-roster-member { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 72px; }
.dshbot-roster-name { font-size: 13px; color: var(--dsw-alias-label-primary); text-align: center; max-width: 88px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshbot-error { padding: 8px 10px; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dshbot-warning { padding: 8px 10px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); border-radius: 8px; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dshbot-warning-list { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshbot-delete-preview { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dshbot-delete-preview-list { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dshbot-delete-preview-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; font-size: 13px; line-height: 20px; }
.dshbot-delete-preview-row > span:first-child { min-width: 0; color: var(--dsw-alias-label-secondary); }
.dshbot-delete-preview-row > span:last-child { flex: none; font-variant-numeric: tabular-nums; }
.dshbot-delete-preserves { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dshbot-delete-confirm { display: flex; align-items: flex-start; gap: 8px; min-width: 0; font-size: 13px; line-height: 20px; }
.dshbot-delete-confirm input { flex: none; margin-top: 3px; }
.dshbot-managed-control {
  display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%;
  padding: 0 2px 0 8px; border-radius: 14px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-button-tool-bar-fill); font-size: 12px; line-height: 18px;
}
.dshbot-managed-model { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 220px; padding: 0 4px; border-radius: 8px; color: inherit; }
.dshbot-managed-label-text { min-width: 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshbot-managed-settings { width: 28px; min-width: 28px; height: 28px; padding: 0; border-radius: 8px; }
.dshbot-rail { width: 36px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--dsw-alias-label-primary); display: flex; align-items: center; justify-content: center; }
.dshbot-modal { max-height: calc(100vh - 48px); }
.dshbot-form { display: flex; flex-direction: column; gap: 12px; width: 100%; min-width: 0; max-width: 420px; max-height: calc(100vh - 200px); overflow: auto; }
.dshbot-field { display: flex; flex-direction: column; gap: 6px; }
.dshbot-field label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshbot-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dshbot-model-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr) minmax(0, 1fr); gap: 8px; min-width: 0; }
.dshbot-model-grid .dshbot-field { min-width: 0; }
.dshbot-model-state { min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dshbot-model-state[data-error="true"] { color: var(--dsw-alias-state-error-primary); }
.dshbot-memory { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshbot-memory-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.dshbot-memory-heading > span { min-width: 0; font-size: 14px; font-weight: 500; }
.dshbot-memory-list { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dshbot-memory-row { display: flex; align-items: flex-start; gap: 4px; min-width: 0; padding: 6px 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshbot-memory-row:first-child { border-top: 0; }
.dshbot-memory-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font-size: 13px; line-height: 20px; }
.dshbot-memory-actions { display: flex; flex: none; align-items: center; gap: 2px; }
.dshbot-memory-editor { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dshbot-memory-editor-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.dshbot-memory-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dshbot-memory-usage { margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dshbot-memory-tag { flex: none; margin-top: 3px; padding: 2px 4px; border-radius: 4px; font-size: 10px; line-height: 1; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.dshbot-memory-review { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.dshbot-objective { flex: none; width: min(100%, var(--dsh-chat-user-width, 920px)); min-width: 0; margin: 0 auto; padding: 6px 20px 0; box-sizing: border-box; }
.dshbot-objective-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 5px 8px 5px 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-module-platform); box-sizing: border-box; }
.dshbot-objective-chip { flex: none; padding: 2px 8px; border-radius: 999px; font-size: 11px; line-height: 16px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dshbot-objective-chip[data-state="active"] { color: var(--dsw-alias-state-business-primary); }
.dshbot-objective-chip[data-state="blocked"] { color: var(--dsw-alias-state-warn-primary); }
.dshbot-objective-chip[data-state="complete"] { color: var(--dsw-alias-label-tertiary); }
.dshbot-objective-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshbot-objective-rounds { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dshbot-objective-actions { display: flex; flex: none; align-items: center; gap: 2px; }
.dshbot-members { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow: auto; }
.dshbot-member { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dshbot-avatar-slot { position: relative; display: inline-flex; flex-shrink: 0; }
.dshbot-activity-dot {
  position: absolute; right: -2px; bottom: -2px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--dsw-alias-label-primary); box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1);
}
.dshbot-activity-dot[data-state="unread"] { background: var(--dsw-alias-state-business-primary); }
.dshbot-activity-dot[data-state="attention"] { background: var(--dsw-alias-state-warn-primary); }
.dshbot-activity-dot[data-state="error"] { background: var(--dsw-alias-state-error-primary); }
.dshbot-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  font-size: 9px;
  line-height: 1;
  padding: 2px 3px;
  border-radius: 4px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
}
.dshbot-bubble { display: flex; flex-direction: row; align-items: flex-start; gap: 8px; padding: 0; background: transparent; max-width: 100%; }
.dshbot-bubble-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.dshbot-bubble-name { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dshbot-bubble-text {
  font-size: 14px;
  white-space: pre-wrap;
  padding: 8px 10px;
  border-radius: 12px;
  background: var(--dsw-alias-interactive-bg-hover);
  width: fit-content;
  max-width: 100%;
}
.dshbot-bubble-text[data-pending="true"] { color: var(--dsw-alias-label-tertiary); }
.dshbot-bubble-omit { display: none; }
.dshbot-footer { display: flex; justify-content: flex-end; gap: 8px; }
.dshbot-official-entry { position: relative; flex: none; display: flex; align-items: center; width: 100%; }
.dshbot-official-entry.dshbot-official-rail { width: 36px; }
.dshbot-official-trigger {
  display: flex; align-items: center; gap: 8px;
  width: calc(100% + 8px); height: 34px; margin: 4px -4px; padding: 6px 2px 6px 10px;
  box-sizing: border-box; border: none; border-radius: 12px; background: transparent;
  color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 14px; line-height: 22px;
  cursor: pointer; overflow: hidden;
}
.dshbot-official-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshbot-official-trigger[aria-expanded="true"] { color: var(--dsw-alias-label-primary); }
.dshbot-official-trigger-label { overflow: hidden; white-space: nowrap; }
.dshbot-official-rail .dshbot-official-trigger {
  width: 36px; height: 36px; margin: 8px 0; justify-content: center; padding: 0; border-radius: 50%;
}
.dshbot-official-overlay { position: fixed; inset: 0; z-index: 1000; }
.dshbot-official-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); }
.dshbot-official-panel {
  position: absolute; left: 12px; bottom: 96px; z-index: 1;
  display: flex; flex-direction: column; gap: 8px;
  width: min(360px, calc(100vw - 24px)); height: min(560px, calc(100vh - 140px));
  padding: 16px; box-sizing: border-box;
  border-radius: 16px; background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-alias-shadow-m);
  color: var(--dsw-alias-label-primary);
}
.dshbot-official-panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none;
}
.dshbot-official-panel-head h2 {
  margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary);
}
.dshbot-official-panel-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dshbot-official-panel-body .dshbot-page { height: 100%; }
  @media (max-width: 420px) {
    .dshbot-toolbar { align-items: stretch; flex-wrap: wrap; }
    .dshbot-toolbar .dshbot-search { flex-basis: 100%; }
    .dshbot-toolbar-action { margin-left: auto; }
    .dshbot-model-grid { grid-template-columns: minmax(0, 1fr); }
  .dshbot-task-toolbar { align-items: stretch; flex-wrap: wrap; }
  .dshbot-task-toolbar .dshbot-task-search { flex-basis: 100%; }
  .dshbot-task-filter { flex: 1; max-width: none; }
  .dshbot-task-time { max-width: 36%; overflow-wrap: anywhere; text-align: end; }
  .dshbot-routine-actions { flex-wrap: wrap; justify-content: flex-end; }
  .dshbot-routine-schedule-grid { grid-template-columns: minmax(0, 1fr); }
  .dshbot-routine-form .dshbot-number-row {
    display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: center;
  }
  .dshbot-routine-form .dshbot-number-row label { grid-column: 1 / -1; }
  .dshbot-routine-form .dshbot-number-input { width: 100%; }
}
`;

  function injectCss() {
    if (typeof document === "undefined") return;
    let el = document.querySelector('style[data-plugin-css="dshbot"]');
    if (!el) {
      el = document.createElement("style");
      el.setAttribute("data-plugin-css", "dshbot");
      document.head.appendChild(el);
    }
    el.textContent = CSS;
  }

  const BLOB_SHAPES = ["circle", "soft", "square", "pill", "triangle", "hex", "cloud", "drop"];
  const BLOB_COLORS = ["ink", "brown", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "grey"];
  const BLOB_SHAPE_RADII = {
    circle: [22, 22, 22, 22, 22, 22, 22, 22],
    soft: [20, 25, 21, 24, 19, 23, 22, 26],
    square: [18, 26, 18, 26, 18, 26, 18, 26],
    pill: [14, 18, 26, 18, 14, 18, 26, 18],
    triangle: [26, 16, 12, 22, 13, 22, 12, 16],
    hex: [20, 24, 24, 20, 24, 24, 20, 24],
    cloud: [14, 26, 22, 18, 16, 18, 22, 26],
    drop: [12, 16, 20, 24, 26, 24, 20, 16],
  };
  const IMAGE_AVATAR_MAX_CHARS = 120000;
  const IMAGE_DATA_URL = /^data:image\/(jpeg|jpg|png);base64,/i;
  const HANDLE_K = (4 / 3) * Math.tan(Math.PI / 16);
  const PERSONA_TEMPLATES = [
    {
      id: "oppose",
      labelKey: "personaOppose",
      text: "专找漏洞和未说明的前提。不要重复已经有人提出的方案。如果没有新的反对点，保持沉默。",
    },
    {
      id: "fill",
      labelKey: "personaFill",
      text: "只补被漏掉的约束、边界条件和例外。不要重写别人已经说清的方案。",
    },
    {
      id: "ship",
      labelKey: "personaShip",
      text: "只谈能不能做、缺什么输入、下一步谁来做。不要空谈愿景。",
    },
    {
      id: "sharp",
      labelKey: "personaSharp",
      text: "话短、带刺、不迎合。没有新的刺就不说话。",
    },
  ];

  function avatarSeedHash(seed) {
    const text = String(seed ?? "");
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return hash;
  }

  function defaultBlobAvatar(seed) {
    const hash = avatarSeedHash(seed);
    return {
      kind: "blob",
      shape: "circle",
      color: BLOB_COLORS[Math.floor(hash / BLOB_SHAPES.length) % BLOB_COLORS.length],
    };
  }

  function assertImageAvatar(dataUrl, crop) {
    const url = String(dataUrl ?? "");
    const nextCrop = crop === "square" ? "square" : crop === "circle" ? "circle" : "";
    if (nextCrop !== "circle" && nextCrop !== "square") {
      throw new Error("avatar crop must be circle or square");
    }
    if (!IMAGE_DATA_URL.test(url)) {
      throw new Error("avatar image must be a jpeg or png data URL");
    }
    if (url.length > IMAGE_AVATAR_MAX_CHARS) {
      throw new Error("avatar image is too large");
    }
    return { kind: "image", dataUrl: url, crop: nextCrop };
  }

  function normalizeAvatar(raw, seed) {
    if (raw && raw.kind === "image") {
      try { return assertImageAvatar(raw.dataUrl, raw.crop); } catch { return defaultBlobAvatar(seed); }
    }
    if (raw && raw.kind === "blob" && BLOB_SHAPES.includes(raw.shape) && BLOB_COLORS.includes(raw.color)) {
      return { kind: "blob", shape: raw.shape, color: raw.color };
    }
    return defaultBlobAvatar(seed);
  }

  function blobPath(shape, squash, lean) {
    const radii = BLOB_SHAPE_RADII[shape] || BLOB_SHAPE_RADII.circle;
    const amount = Number(squash) || 0;
    const shear = Number(lean) || 0;
    const squat = Math.max(0, amount);
    const stretch = Math.max(0, -amount);
    const n = 8;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      const r = radii[i] * (
        1
        - squat * 0.42 * (ny * ny)
        + squat * 0.36 * (nx * nx)
        + stretch * 0.12 * (ny * ny)
        - stretch * 0.22 * (nx * nx)
      );
      pts.push({
        x: 32 + r * nx + shear * 7 * (0.35 - ny),
        y: 32 + r * ny + squat * 7 - stretch * 2,
        a,
        r,
      });
    }
    const cmds = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      const h0 = p0.r * HANDLE_K;
      const h1 = p1.r * HANDLE_K;
      const a0 = p0.a + Math.PI / 2;
      const a1 = p1.a + Math.PI / 2;
      if (i === 0) cmds.push(`M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`);
      cmds.push(
        `C ${(p0.x + Math.cos(a0) * h0).toFixed(2)} ${(p0.y + Math.sin(a0) * h0).toFixed(2)} `
        + `${(p1.x - Math.cos(a1) * h1).toFixed(2)} ${(p1.y - Math.sin(a1) * h1).toFixed(2)} `
        + `${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      );
    }
    cmds.push("Z");
    return cmds.join(" ");
  }

  function avatarFacePose(working, seconds, phase) {
    const t = seconds + phase;
    if (working) {
      return {
        squash: Math.sin(t * 2.2) * 0.3,
        lean: Math.sin(t * 0.75 + 0.8) * 0.32,
        gazeX: Math.sin(t * 0.55) * 3.6,
        gazeY: -1.2 + Math.sin(t * 0.38) * 1.4,
        roll: Math.sin(t * 0.75) * 4.2,
        blink: t % 1.45 > 1.28,
        dots: [0, 1, 2].map((index) => 0.22 + 0.78 * Math.max(0, Math.sin(t * 5.2 - index * 1.1))),
      };
    }
    return {
      squash: Math.sin(t * 0.7) * 0.06,
      lean: Math.sin(t * 0.5) * 0.06,
      gazeX: Math.sin(t * 0.4) * 0.7,
      gazeY: Math.sin(t * 0.27) * 0.4,
      roll: Math.sin(t * 0.85) * 1.2,
      blink: t % 3.2 > 3.02,
      dots: [0, 0, 0],
    };
  }

  const AVATAR_FACE_CLOCK_KEY = "__dshbotAvatarFaceClock";
  const AVATAR_FACE_CLOCK_VERSION = 2;

  function getAvatarFaceClock() {
    if (typeof window === "undefined" || typeof document === "undefined") return null;
    const previous = window[AVATAR_FACE_CLOCK_KEY];
    if (previous?.version === AVATAR_FACE_CLOCK_VERSION) return previous;
    previous?.dispose?.();

    const records = new Map();
    const visible = new Set();
    let frame = 0;
    let lastPaint = -Infinity;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
    const observer = typeof window.IntersectionObserver === "function"
      ? new window.IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        schedule();
      })
      : null;

    const hasVisibleFaces = () => records.size > 0 && (!observer || visible.size > 0) && !motion?.matches;
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const tick = (now) => {
      frame = 0;
      if (document.hidden || !hasVisibleFaces()) return;
      if (now - lastPaint >= 1000 / 15) {
        const targets = observer ? Array.from(visible) : Array.from(records.keys());
        for (const node of targets) {
          const record = records.get(node);
          if (record && node.isConnected) record.draw(now / 1000);
        }
        lastPaint = now;
      }
      frame = window.requestAnimationFrame(tick);
    };
    function schedule() {
      if (!frame && !document.hidden && hasVisibleFaces()) frame = window.requestAnimationFrame(tick);
    }
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else schedule();
    };
    const onMotionChange = () => {
      if (motion?.matches) {
        stop();
        for (const record of records.values()) record.reset();
      } else {
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (motion?.addEventListener) motion.addEventListener("change", onMotionChange);
    else motion?.addListener?.(onMotionChange);

    const api = {
      version: AVATAR_FACE_CLOCK_VERSION,
      subscribe(node, draw, reset) {
        if (!node) return () => {};
        records.set(node, { draw, reset });
        if (observer) observer.observe(node);
        else visible.add(node);
        if (motion?.matches) reset();
        schedule();
        return () => {
          records.delete(node);
          visible.delete(node);
          if (observer) observer.unobserve(node);
          if (!records.size || !hasVisibleFaces()) stop();
        };
      },
      dispose() {
        stop();
        observer?.disconnect();
        records.clear();
        visible.clear();
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (motion?.removeEventListener) motion.removeEventListener("change", onMotionChange);
        else motion?.removeListener?.(onMotionChange);
      },
    };
    window[AVATAR_FACE_CLOCK_KEY] = api;
    return api;
  }

  function prefersReducedMotion() {
    return typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function loadAvatarImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        resolve({ img, url, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("bad image"));
      };
      img.src = url;
    });
  }

  function bakeCroppedAvatar(img, sx, sy, side, size = 192) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    if (dataUrl.length > IMAGE_AVATAR_MAX_CHARS) {
      throw new Error("avatar image is too large");
    }
    return dataUrl;
  }

  function AvatarCropper(props) {
    const { t, source, onApply, onCancel } = props;
    const disabled = props.disabled === true;
    const STAGE = 220;
    const cover = Math.max(STAGE / source.width, STAGE / source.height);
    const [zoom, setZoom] = useState(1);
    const [pos, setPos] = useState(() => ({
      x: (STAGE - source.width * cover) / 2,
      y: (STAGE - source.height * cover) / 2,
    }));
    const dragRef = useRef(null);
    const scale = cover * zoom;

    const clampPos = (next, nextScale = scale) => ({
      x: Math.min(0, Math.max(STAGE - source.width * nextScale, next.x)),
      y: Math.min(0, Math.max(STAGE - source.height * nextScale, next.y)),
    });
    const onPointerDown = (event) => {
      if (disabled) return;
      dragRef.current = { x: event.clientX, y: event.clientY, pos };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPos(clampPos({ x: drag.pos.x + event.clientX - drag.x, y: drag.pos.y + event.clientY - drag.y }));
    };
    const endDrag = () => { dragRef.current = null; };
    const onZoom = (value) => {
      const nextScale = cover * value;
      setZoom(value);
      setPos(clampPos({
        x: STAGE / 2 - (STAGE / 2 - pos.x) * (nextScale / scale),
        y: STAGE / 2 - (STAGE / 2 - pos.y) * (nextScale / scale),
      }, nextScale));
    };
    const apply = () => {
      try {
        onApply(bakeCroppedAvatar(source.img, -pos.x / scale, -pos.y / scale, STAGE / scale));
      } catch {
        onApply(null);
      }
    };

    return h("div", { className: "dshbot-crop" },
      h("div", {
        className: "dshbot-crop-stage",
        style: { width: `${STAGE}px`, height: `${STAGE}px` },
        onPointerDown, onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onPointerLeave: endDrag,
      },
        h("img", {
          src: source.url,
          alt: "",
          draggable: false,
          style: {
            width: `${source.width}px`,
            height: `${source.height}px`,
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            transformOrigin: "0 0",
          },
        }),
        h("div", { className: "dshbot-crop-mask", "aria-hidden": "true" }),
      ),
      h("input", {
        className: "dshbot-crop-zoom",
        type: "range",
        min: 1,
        max: 3,
        step: 0.01,
        value: zoom,
        "aria-label": t("avatarCropZoom"),
        disabled,
        onChange: (event) => onZoom(Number(event.target.value)),
      }),
      h("div", { className: "dshbot-crop-actions" },
        h(Button, { variant: "outline", disabled, onClick: onCancel }, t("cancel")),
        h(Button, { variant: "primary", disabled, onClick: apply }, t("avatarCropApply")),
      ),
    );
  }


  function AvatarView(props) {
    const { thinking, size } = props;
    const live = props.live !== false;
    const seed = props.seed || props.name;
    const resolved = normalizeAvatar(props.avatar, seed);
    const working = Boolean(thinking && live);
    const svgRef = useRef(null);
    const pathRef = useRef(null);
    const eyesRef = useRef(null);
    const openEyesRef = useRef(null);
    const closedEyesRef = useRef(null);
    const dotsRef = useRef(null);
    const px = size || 32;

    useEffect(() => {
      if (resolved.kind !== "blob") return undefined;
      const phase = (avatarSeedHash(seed) % 1000) / 1000 * Math.PI * 2;
      const reset = () => {
        if (pathRef.current) pathRef.current.setAttribute("d", blobPath(resolved.shape, 0, 0));
        if (svgRef.current) svgRef.current.style.transform = "none";
        if (eyesRef.current) {
          eyesRef.current.style.setProperty("--eye-x", "0px");
          eyesRef.current.style.setProperty("--eye-y", "0px");
        }
        if (openEyesRef.current) openEyesRef.current.style.opacity = "1";
        if (closedEyesRef.current) closedEyesRef.current.style.opacity = "0";
        if (dotsRef.current) {
          dotsRef.current.style.opacity = working ? ".46" : "0";
          Array.from(dotsRef.current.children).forEach((dot) => { dot.style.opacity = working ? ".46" : "0"; });
        }
      };
      const draw = (seconds) => {
        const pose = avatarFacePose(working, seconds, phase);
        if (pathRef.current) pathRef.current.setAttribute("d", blobPath(resolved.shape, pose.squash, pose.lean));
        if (svgRef.current) svgRef.current.style.transform = `rotate(${pose.roll.toFixed(2)}deg)`;
        if (eyesRef.current) {
          eyesRef.current.style.setProperty("--eye-x", `${pose.gazeX.toFixed(2)}px`);
          eyesRef.current.style.setProperty("--eye-y", `${pose.gazeY.toFixed(2)}px`);
        }
        if (openEyesRef.current) openEyesRef.current.style.opacity = pose.blink ? "0" : "1";
        if (closedEyesRef.current) closedEyesRef.current.style.opacity = pose.blink ? "1" : "0";
        if (dotsRef.current) {
          dotsRef.current.style.opacity = working ? "1" : "0";
          Array.from(dotsRef.current.children).forEach((dot, index) => {
            dot.style.opacity = String(pose.dots[index] || 0);
          });
        }
      };
      if (!live) {
        reset();
        return undefined;
      }
      const clock = getAvatarFaceClock();
      if (prefersReducedMotion()) reset();
      else {
        const now = typeof performance !== "undefined" && performance.now ? performance.now() / 1000 : Date.now() / 1000;
        draw(now);
      }
      return clock?.subscribe(svgRef.current, draw, reset);
    }, [resolved.kind, resolved.shape, working, live, seed]);

    if (resolved.kind === "image") {
      return h("span", {
        className: "dshbot-avatar-frame",
        "data-crop": resolved.crop,
        "data-active": props.active ? "true" : undefined,
        "data-mood": working ? "work" : "idle",
        style: { width: px, height: px },
      }, h("img", { className: "dshbot-avatar-image", src: resolved.dataUrl, alt: "" }));
    }

    return h("span", {
      className: `dshbot-avatar-frame dshbot-blob-${resolved.color}`,
      "data-active": props.active ? "true" : undefined,
      "data-mood": working ? "work" : "idle",
      style: { width: px, height: px },
    }, h("svg", { ref: svgRef, className: "dshbot-blob", viewBox: "0 0 64 64", "aria-hidden": "true" },
      h("path", { ref: pathRef, className: "dshbot-blob-body", d: blobPath(resolved.shape, 0), fill: "currentColor" }),
      h("g", { ref: eyesRef, className: "dshbot-blob-eyes" },
        h("g", { ref: openEyesRef, className: "dshbot-blob-eye-open" },
          h("g", { className: "dshbot-blob-eye" },
            h("ellipse", { className: "dshbot-blob-eye-white", cx: 25, cy: 30, rx: 5.2, ry: 6.4 }),
            h("circle", { className: "dshbot-blob-eye-pupil", cx: 26.2, cy: 31, r: 2.45 }),
            h("circle", { className: "dshbot-blob-eye-catchlight", cx: 25.2, cy: 29.9, r: 0.8 }),
          ),
          h("g", { className: "dshbot-blob-eye" },
            h("ellipse", { className: "dshbot-blob-eye-white", cx: 39, cy: 30, rx: 5.2, ry: 6.4 }),
            h("circle", { className: "dshbot-blob-eye-pupil", cx: 40.2, cy: 31, r: 2.45 }),
            h("circle", { className: "dshbot-blob-eye-catchlight", cx: 39.2, cy: 29.9, r: 0.8 }),
          ),
        ),
        h("g", { ref: closedEyesRef, className: "dshbot-blob-eye-closed" },
          h("path", { d: "M 21 30.5 Q 25 33 29 30.5" }),
          h("path", { d: "M 35 30.5 Q 39 33 43 30.5" }),
        ),
      ),
      h("g", { ref: dotsRef, className: "dshbot-blob-work-dots" },
        h("circle", { cx: 27, cy: 58.5, r: 1.45 }),
        h("circle", { cx: 32, cy: 58.5, r: 1.45 }),
        h("circle", { cx: 37, cy: 58.5, r: 1.45 }),
      ),
    ));
  }

  function AvatarPicker(props) {
    const { t, onChange, onError: setError } = props;
    const disabled = props.disabled === true;
    const seed = props.seed || props.name;
    const resolved = normalizeAvatar(props.avatar, seed);
    const blobColor = resolved.kind === "blob" ? resolved.color : "ink";
    const blobShape = resolved.kind === "blob" ? resolved.shape : "circle";
    const [tab, setTab] = useState(resolved.kind === "image" ? "upload" : "blob");
    const [cropSource, setCropSource] = useState(null);
    const [imageBusy, setImageBusy] = useState(false);
    const fileRef = useRef(null);

    const closeCropper = () => {
      if (cropSource) URL.revokeObjectURL(cropSource.url);
      setCropSource(null);
    };

    useEffect(() => {
      setTab(resolved.kind === "image" ? "upload" : "blob");
    }, [resolved.kind]);

    return h("div", { className: "dshbot-picker" },
      h("div", { className: "dshbot-pills" },
        h(Pill, { active: tab === "blob", disabled, onClick: () => setTab("blob") }, t("avatarBlob")),
        h(Pill, { active: tab === "upload", disabled, onClick: () => setTab("upload") }, t("avatarUpload")),
      ),
      tab === "blob"
        ? h("div", { className: "dshbot-picker-blob" },
          h("div", { className: "dshbot-shape-grid" },
            BLOB_SHAPES.map((shape) => h("button", {
              key: shape,
              type: "button",
              className: "dshbot-shape-cell",
              "aria-label": shape,
              "aria-pressed": resolved.kind === "blob" && resolved.shape === shape ? "true" : "false",
              disabled,
              onClick: () => onChange({ kind: "blob", shape, color: blobColor }),
            }, h(AvatarView, {
              avatar: { kind: "blob", shape, color: blobColor },
              seed,
              size: 36,
              live: props.live,
            }))),
          ),
          h("div", { className: "dshbot-swatches" },
            BLOB_COLORS.map((color) => h("button", {
              key: color,
              type: "button",
              className: "dshbot-swatch",
              style: { "--swatch": `var(--dshbot-blob-${color})` },
              "aria-label": color,
              "aria-pressed": resolved.kind === "blob" && resolved.color === color ? "true" : "false",
              disabled,
              onClick: () => onChange({ kind: "blob", shape: blobShape, color }),
            })),
          ),
        )
        : cropSource
          ? h(AvatarCropper, {
            t,
            source: cropSource,
            disabled,
            onApply: (dataUrl) => {
              closeCropper();
              if (dataUrl === null) {
                setError(t("avatarTooLarge"));
                return;
              }
              try {
                onChange(assertImageAvatar(dataUrl, resolved.kind === "image" ? resolved.crop : "circle"));
                setError("");
              } catch {
                setError(t("avatarTooLarge"));
              }
            },
            onCancel: closeCropper,
          })
          : h("div", { className: "dshbot-upload" },
          h("input", {
            ref: fileRef,
            type: "file",
            accept: "image/*",
            hidden: true,
            disabled: disabled || imageBusy,
            onChange: async (event) => {
              const file = event.target.files && event.target.files[0];
              event.target.value = "";
              if (!file) return;
              setImageBusy(true);
              setError("");
              try {
                setCropSource(await loadAvatarImage(file));
                setError("");
              } catch {
                setError(t("avatarBadImage"));
              } finally {
                setImageBusy(false);
              }
            },
          }),
          h(Button, {
            variant: "outline",
            disabled: disabled || imageBusy,
            loading: imageBusy,
            onClick: () => { if (fileRef.current) fileRef.current.click(); },
          }, t("avatarPick")),
          h("div", { className: "dshbot-pills" },
            h(Pill, {
              active: (resolved.kind === "image" ? resolved.crop : "circle") === "circle",
              disabled,
              onClick: () => {
                if (resolved.kind === "image") onChange({ ...resolved, crop: "circle" });
              },
            }, t("avatarCircle")),
            h(Pill, {
              active: (resolved.kind === "image" ? resolved.crop : "circle") === "square",
              disabled,
              onClick: () => {
                if (resolved.kind === "image") onChange({ ...resolved, crop: "square" });
              },
            }, t("avatarSquare")),
          ),
        ),
    );
  }

  function filterItems(items, query) {
    const needle = String(query ?? "").trim().toLowerCase();
    if (!needle) return [...items];
    return items.filter((item) => [item.name, item.title, item.description].filter(Boolean).join("\n").toLowerCase().includes(needle));
  }

  function displayName(item) {
    const title = item?.kind === "room" ? "" : String(item?.title ?? "").trim();
    return title || String(item?.name ?? item?.id ?? "").trim();
  }

  function stableName(item) {
    return String(item?.name ?? item?.id ?? "").trim();
  }

  function identityAddress(item) {
    const name = stableName(item);
    return item?.kind !== "room" && name && displayName(item) !== name ? `@${name}` : "";
  }

  function catalogSections(snap) {
    const raw = Array.isArray(snap?.value?.sections)
      ? snap.value.sections
      : (Array.isArray(snap?.sections) ? snap.sections : []);
    const seen = new Set();
    return raw.map((section) => {
      const id = String(section?.id ?? "").trim();
      const name = String(section?.name ?? "").trim();
      return id && name && !seen.has(id) ? (seen.add(id), { ...section, id, name }) : null;
    }).filter(Boolean);
  }

  function itemSectionId(item) {
    return String(item?.sectionId ?? "").trim();
  }

  function itemSourceId(item) {
    return String(item?.sourceId ?? item?.source?.id ?? "").trim();
  }

  function itemSourceLabel(item) {
    return String(item?.sourceLabel ?? item?.source?.label ?? itemSourceId(item)).trim();
  }

  function sourceOptions(items) {
    const byId = new Map();
    for (const item of items || []) {
      const id = itemSourceId(item);
      if (!id || byId.has(id)) continue;
      byId.set(id, { id, label: itemSourceLabel(item) || id });
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }

  function sessionIsActive(session) {
    if (!session) return false;
    const status = String(session.status ?? "").toLowerCase();
    return session.running === true
      || Boolean(session.pendingApproval || session.pendingClarify || session.pendingQuestion
        || session.approval || session.clarification || session.question)
      || Boolean(session.error || session.failure || session.lastError)
      || /running|pending|waiting|approval|question|error|failed/.test(status);
  }

  function contactActivityAt(item, session, activity) {
    return Math.max(
      Number(activity?.activityAt) || 0,
      Number(session?.updatedAt) || 0,
      Number(item?.updatedAt) || 0,
    );
  }

  function contactActivityMatches(item, session, activity, filter, now = Date.now()) {
    const active = sessionIsActive(session);
    if (!filter || filter === "all") return true;
    if (filter === "active") return active;
    if (active) return false;
    const timestamp = contactActivityAt(item, session, activity);
    const recent = timestamp > 0 && now - timestamp <= 7 * 24 * 60 * 60 * 1000;
    return filter === "recent" ? recent : !recent;
  }

  function sectionUndoSnapshot(value) {
    return value?.undoSnapshot
      ?? value?.snapshot
      ?? value?.result?.undoSnapshot
      ?? value?.result?.snapshot
      ?? null;
  }

  function emptyRoster(items, sessionId) {
    if (!sessionId) return null;
    const item = items.find((entry) => entry.sessionId === sessionId);
    if (!item) return null;
    if (item.kind === "room") {
      const members = [];
      for (const botId of item.memberBotIds ?? []) {
        const member = items.find((entry) => entry.id === botId);
        if (member) members.push(member);
      }
      return members;
    }
    return [item];
  }

  function upsertItem(items, item) {
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index < 0) return [...items, item];
    const next = [...items];
    next[index] = item;
    return next;
  }

  function newId() {
    return globalThis.crypto?.randomUUID?.() ?? `dshbot-${Date.now().toString(36)}`;
  }

  const TASK_RETRY_STORAGE_KEY = "dshbot:task-retry:v1";
  const RETRY_TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const RETRY_OPERATION_ID_RE = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|dshbot-[A-Za-z0-9][A-Za-z0-9._:-]{0,95})$/i;

  function retryStorage() {
    try {
      const storage = globalThis.localStorage;
      return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function"
        ? storage
        : null;
    } catch {
      return null;
    }
  }

  function validRetryTaskId(value) {
    return RETRY_TASK_ID_RE.test(String(value ?? ""));
  }

  function validRetryOperationId(value) {
    return RETRY_OPERATION_ID_RE.test(String(value ?? ""));
  }

  function sanitizeRetryOperationIds(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .filter(([taskId, operationId]) => validRetryTaskId(taskId) && validRetryOperationId(operationId))
      .map(([taskId, operationId]) => [String(taskId), String(operationId)]));
  }

  function readRetryOperationIds() {
    const storage = retryStorage();
    if (!storage) return {};
    try {
      const raw = storage.getItem(TASK_RETRY_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !parsed.tasks || typeof parsed.tasks !== "object" || Array.isArray(parsed.tasks)) {
        storage.removeItem?.(TASK_RETRY_STORAGE_KEY);
        return {};
      }
      const sanitized = sanitizeRetryOperationIds(parsed.tasks);
      if (JSON.stringify(sanitized) !== JSON.stringify(parsed.tasks)) writeRetryOperationIds(sanitized);
      return sanitized;
    } catch {
      try { storage.removeItem?.(TASK_RETRY_STORAGE_KEY); } catch { /* storage may be unavailable */ }
      return {};
    }
  }

  function writeRetryOperationIds(value) {
    const storage = retryStorage();
    if (!storage) return;
    const tasks = sanitizeRetryOperationIds(value);
    try {
      if (Object.keys(tasks).length === 0) storage.removeItem?.(TASK_RETRY_STORAGE_KEY);
      else storage.setItem(TASK_RETRY_STORAGE_KEY, JSON.stringify({ version: 1, tasks }));
    } catch {
      // Local persistence is best effort; the Host remains the idempotency authority.
    }
  }

  function newRetryOperationId() {
    const candidate = newId();
    if (validRetryOperationId(candidate)) return candidate;
    return `dshbot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }

  function formatTime(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function rpcValue(response) {
    const result = response?.result ?? response;
    if (result && result.ok === false) {
      const error = new Error(result.error?.message || "rpc failed");
      error.rpcError = result.error;
      throw error;
    }
    return result?.value ?? result;
  }


  function catalogItems(snap) {
    if (Array.isArray(snap?.value?.items)) return snap.value.items;
    if (Array.isArray(snap?.items)) return snap.items;
    return [];
  }

  function roomAvailableBotIds(items) {
    return new Set((Array.isArray(items) ? items : [])
      .filter((item) => item?.kind === "bot" && item?.id)
      .map((item) => String(item.id)));
  }

  function normalizeRoomMemberIds(value, items) {
    const allowed = roomAvailableBotIds(items);
    return [...new Set((Array.isArray(value) ? value : [])
      .map((id) => String(id ?? "").trim())
      .filter((id) => id && allowed.has(id)))];
  }

  function roomMemberValidation(value, items) {
    const raw = Array.isArray(value)
      ? value.map((id) => String(id ?? "").trim()).filter(Boolean)
      : [];
    const allowed = roomAvailableBotIds(items);
    const normalized = [...new Set(raw.filter((id) => allowed.has(id)))];
    return {
      raw,
      normalized,
      invalid: raw.filter((id) => !allowed.has(id)),
      valid: raw.length > 0 && raw.every((id) => allowed.has(id))
        && normalized.length >= GROUP_MIN_MEMBERS
        && normalized.length <= GROUP_MAX_MEMBERS,
    };
  }

  function catalogTasks(snap) {
    return Array.isArray(snap?.value?.tasks) ? snap.value.tasks : [];
  }

  function catalogRoutines(snap) {
    return Array.isArray(snap?.value?.routines) ? snap.value.routines : [];
  }

  function defaultCapabilities() {
    return {
      tools: { mode: "all", names: [] },
      skills: { mode: "all", names: [] },
      mcp: { mode: "all", names: [] },
    };
  }

  function normalizeCapabilityPolicy(raw) {
    const names = Array.isArray(raw?.names)
      ? [...new Set(raw.names.map((name) => String(name ?? "").trim()).filter(Boolean))]
      : [];
    return { mode: raw?.mode === "selected" ? "selected" : "all", names };
  }

  function normalizeCapabilities(raw) {
    const defaults = defaultCapabilities();
    return {
      tools: normalizeCapabilityPolicy(raw?.tools ?? defaults.tools),
      skills: normalizeCapabilityPolicy(raw?.skills ?? defaults.skills),
      mcp: normalizeCapabilityPolicy(raw?.mcp ?? defaults.mcp),
    };
  }

  function capabilityEntries(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((entry) => {
      if (typeof entry === "string") return { name: entry, description: "" };
      return { name: String(entry?.name ?? "").trim(), description: String(entry?.description ?? "").trim() };
    }).filter((entry) => entry.name);
  }

  function capabilityCatalog(value) {
    return {
      tools: capabilityEntries(value?.tools),
      skills: capabilityEntries(value?.skills),
      mcp: capabilityEntries(value?.mcp),
    };
  }

  function capabilitySelectedNamesAreValid(capabilities, available) {
    return CAPABILITY_GROUPS.every(({ id }) => {
      if (capabilities[id]?.mode !== "selected") return true;
      const names = new Set((available[id] ?? []).map((entry) => entry.name));
      return (capabilities[id]?.names ?? []).every((name) => names.has(name));
    });
  }

  function modelGroups(value) {
    return Array.isArray(value?.groups) ? value.groups.filter((group) => group && (group.id || group.name)) : [];
  }

  function modelGroup(value, provider) {
    return modelGroups(value).find((group) => String(group.id ?? "") === String(provider ?? ""));
  }

  function modelEntry(value, provider, model) {
    return (modelGroup(value, provider)?.models ?? []).find((entry) => String(entry?.id ?? "") === String(model ?? ""));
  }

  function modelEfforts(entry) {
    return Array.isArray(entry?.reasoning?.efforts)
      ? entry.reasoning.efforts.filter((effort) => effort && effort.id)
      : [];
  }

  function normalizeMemoryEntries(value) {
    const rows = Array.isArray(value)
      ? value
      : Array.isArray(value?.entries)
        ? value.entries
        : Array.isArray(value?.memory?.entries)
          ? value.memory.entries
            : typeof value?.text === "string"
            ? value.text.split(/\r?\n/).map((text) => text.replace(/^\s*[-*]\s+/, "").trim()).filter(Boolean).map((text, index) => ({ id: `memory-${index}`, text }))
            : typeof value?.memory === "string"
              ? value.memory.split(/\r?\n/).map((text) => text.replace(/^\s*[-*]\s+/, "").trim()).filter(Boolean).map((text, index) => ({ id: `memory-${index}`, text }))
              : [];
    return rows.map((entry, index) => {
      if (typeof entry === "string") return { id: `memory-${index}`, text: entry };
      return {
        id: String(entry?.id ?? `memory-${index}`),
        text: String(entry?.text ?? entry?.note ?? entry?.content ?? ""),
      };
    }).filter((entry) => entry.text.trim());
  }

  function memoryRevision(value, fallback = null) {
    const revision = value?.memoryRevision ?? value?.revision;
    return typeof revision === "string" && revision ? revision : fallback;
  }

  function memoryText(entries) {
    return entries.map((entry) => `- ${String(entry?.text ?? "").trim()}`).filter((text) => text !== "- ").join("\n");
  }

  function normalizeWarnings(value) {
    if (!Array.isArray(value)) return [];
    return value.map((warning) => {
      if (typeof warning === "string") return warning.trim();
      return String(warning?.message ?? warning?.detail ?? warning?.code ?? "").trim();
    }).filter(Boolean);
  }

  function isRpcUnavailable(error) {
    const code = String(error?.rpcError?.code ?? "").toLowerCase();
    const message = String(error?.rpcError?.message ?? error?.message ?? error ?? "").toLowerCase();
    return /unknown|unsupported|unavailable|not found|not implemented/.test(`${code} ${message}`);
  }

  function routineSearchText(routine, items) {
    const bot = items.find((item) => item.id === routine?.botId);
    return [routine?.id, routine?.name, routine?.prompt, routine?.lastError, routine?.botId, bot?.name]
      .filter(Boolean).join("\n").toLowerCase();
  }

  function routineTimestamp(ts) {
    const value = Number(ts);
    if (!Number.isFinite(value) || value <= 0) return "";
    return new Date(value).toLocaleString();
  }

  function routineStatusLabel(t, routine) {
    return routine?.enabled === true ? t("routineEnabledState") : t("routinePausedState");
  }

  function routineOutcomeLabel(t, outcome) {
    const value = String(outcome ?? "").trim();
    if (value === "queued") return t("routineOutcomeQueued");
    if (value === "running") return t("routineOutcomeRunning");
    if (value === "completed") return t("routineOutcomeCompleted");
    if (value === "failed") return t("routineOutcomeFailed");
    if (value === "interrupted") return t("routineOutcomeInterrupted");
    return "";
  }

  function routineRunTriggerLabel(t, trigger) {
    return String(trigger ?? "").trim() === "manual"
      ? t("routineRunTriggerManual")
      : t("routineRunTriggerSchedule");
  }

  function routineHistoryRows(routine) {
    if (!Array.isArray(routine?.runHistory)) return null;
    return [...routine.runHistory].slice(-10).reverse();
  }

  function routineBrowserTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  }

  function routineDurationParts(value, fallbackAmount = "1", fallbackUnit = "h") {
    const match = /^(?:every\s+)?(\d+)([mhd])$/i.exec(String(value ?? "").trim());
    return match ? { amount: match[1], unit: match[2].toLowerCase() } : { amount: fallbackAmount, unit: fallbackUnit };
  }

  function routineTimeParts(minute, hour) {
    return {
      minute: String(Number(minute) || 0).padStart(2, "0"),
      hour: String(Number(hour) || 0).padStart(2, "0"),
    };
  }

  function routineDraftFromRecord(routine, fallbackTimezone = routineBrowserTimezone()) {
    const raw = String(routine?.schedule ?? "").trim();
    const legacyInterval = Number(routine?.intervalMinutes);
    const fallback = Number.isInteger(legacyInterval) && legacyInterval > 0
      ? routineDurationParts(`${legacyInterval}m`, String(legacyInterval), "m")
      : { amount: "1", unit: "h" };
    const draft = {
      frequency: "daily", onceDelay: "30m", hour: "09", minute: "00", weekday: "1", monthDay: "1",
      intervalAmount: fallback.amount, intervalUnit: fallback.unit, cron: "0 9 * * *",
      timezone: String(routine?.timezone ?? "").trim() || fallbackTimezone,
      maxRuns: Number.isInteger(Number(routine?.maxRuns)) && Number(routine.maxRuns) >= 0 ? String(routine.maxRuns) : "0",
      legacyMigrated: !raw && Number.isInteger(legacyInterval) && legacyInterval > 0,
    };
    if (!raw && Number.isInteger(legacyInterval) && legacyInterval > 0) draft.frequency = "interval";
    const once = /^(\d+)([mhd])$/i.exec(raw);
    if (once) {
      draft.frequency = "once";
      draft.onceDelay = `${once[1]}${once[2].toLowerCase()}`;
      return draft;
    }
    const interval = /^every\s+(\d+)([mhd])$/i.exec(raw);
    if (interval) {
      draft.frequency = "interval";
      draft.intervalAmount = interval[1];
      draft.intervalUnit = interval[2].toLowerCase();
      return draft;
    }
    const fields = raw.split(/\s+/);
    if (fields.length === 5) {
      const [minute, hour, day, month, week] = fields;
      const time = routineTimeParts(minute, hour);
      if (minute === "0" && hour === "*" && day === "*" && month === "*" && week === "*") {
        draft.frequency = "hourly";
        return draft;
      }
      if (/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour) && day === "*" && month === "*" && week === "*") {
        Object.assign(draft, time, { frequency: "daily" });
        return draft;
      }
      if (/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour) && day === "*" && month === "*" && week === "1-5") {
        Object.assign(draft, time, { frequency: "weekdays" });
        return draft;
      }
      if (/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour) && day === "*" && month === "*" && /^\d$/.test(week)) {
        Object.assign(draft, time, { frequency: "weekly", weekday: week });
        return draft;
      }
      if (/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour) && /^\d{1,2}$/.test(day) && month === "*" && week === "*") {
        Object.assign(draft, time, { frequency: "monthly", monthDay: day });
        return draft;
      }
      draft.frequency = "advanced";
      draft.cron = raw;
    }
    return draft;
  }

  function routineScheduleFromDraft(draft) {
    const time = routineTimeParts(draft.minute, draft.hour);
    switch (draft.frequency) {
      case "once": return String(draft.onceDelay ?? "").trim();
      case "hourly": return "every 1h";
      case "daily": return `${Number(time.minute)} ${Number(time.hour)} * * *`;
      case "weekdays": return `${Number(time.minute)} ${Number(time.hour)} * * 1-5`;
      case "weekly": return `${Number(time.minute)} ${Number(time.hour)} * * ${Number(draft.weekday)}`;
      case "monthly": return `${Number(time.minute)} ${Number(time.hour)} ${Number(draft.monthDay)} * *`;
      case "interval": return `every ${String(draft.intervalAmount ?? "").trim()}${draft.intervalUnit}`;
      case "advanced": return String(draft.cron ?? "").trim();
      default: return "";
    }
  }

  function routineDurationValid(value, unit) {
    const amount = Number(value);
    const multiplier = { m: 1, h: 60, d: 1440 }[unit];
    return Number.isInteger(amount) && amount >= ROUTINE_MIN_INTERVAL && multiplier !== undefined
      && amount * multiplier <= ROUTINE_MAX_INTERVAL;
  }

  function routineTimezoneValid(value) {
    const timezone = String(value ?? "").trim();
    if (!timezone) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0); return true; } catch { return false; }
  }

  function routineCronValid(value) {
    const fields = String(value ?? "").trim().split(/\s+/);
    return fields.length === 5 && fields.every((field) => field.length > 0 && field.length <= 40);
  }

  function routineDisplaySchedule(routine) {
    const schedule = String(routine?.schedule ?? "").trim();
    if (schedule) return schedule;
    const interval = Number(routine?.intervalMinutes);
    return Number.isInteger(interval) && interval > 0 ? `every ${interval}m` : "";
  }

  const TASK_STATUS_IDS = ["queued", "paused", "delivered", "completed", "failed", "cancelled"];

  function taskStatusLabel(t, status) {
    const value = String(status ?? "").trim();
    if (TASK_STATUS_IDS.includes(value)) return t(`taskStatus${value[0].toUpperCase()}${value.slice(1)}`);
    return `${t("taskStatusUnknown")}: ${value || t("taskNone")}`;
  }

  function taskTimestamp(ts) {
    const value = Number(ts);
    if (!Number.isFinite(value) || value <= 0) return "";
    return new Date(value).toLocaleString();
  }

  function taskSummary(task) {
    return String(task?.resultSummary || task?.error || task?.task || "").trim();
  }

  function taskSearchText(task) {
    return [
      task?.id,
      task?.task,
      task?.fromName,
      task?.toName,
      task?.fromId,
      task?.toId,
      task?.resultSummary,
      task?.error,
    ].filter(Boolean).join("\n").toLowerCase();
  }

  function sessionIndicator(session, activity, t, active = false) {
    if (!session) return null;
    if (activity?.attention === true) return { state: "attention", label: t("sessionAttention") };
    if (session.running === true) return { state: "running", label: t("thinking") };
    const status = String(session.status ?? "").toLowerCase();
    const pending = Boolean(session.pendingApproval || session.pendingClarify || session.pendingQuestion
      || session.approval || session.clarification || /pending|waiting/.test(status));
    if (pending) return { state: "attention", label: t("sessionAttention") };
    const failed = Boolean(session.error || session.failure || session.lastError || /error|failed/.test(status));
    if (failed) return { state: "error", label: t("sessionError") };
    const goal = activity?.goal;
    if (goal?.phase === "blocked") return { state: "attention", label: t("objectiveBlocked") };
    if (goal?.phase === "active" && goal?.activation === "armed") {
      return { state: "running", label: t("objectiveWorking") };
    }
    if (!active && activity?.readInitialized === true && Number(activity.activitySeq) > Number(activity.lastSeenSeq)) {
      return { state: "unread", label: t("unreadCompleted") };
    }
    return null;
  }

  function groupMemberIndicator(member, t) {
    if (!member) return { state: "idle", label: t("groupMemberIdle") };
    const status = String(member.status ?? "").toLowerCase();
    if (/capped|limit|maximum/.test(status)) return { state: "capped", label: t("groupMemberCapped") };
    if (/timeout|timed.?out/.test(status)) return { state: "timeout", label: t("groupMemberTimeout") };
    if (status === "held") return { state: "held", label: t("groupMemberHeld") };
    if (status === "stopped") return { state: "stopped", label: t("groupMemberStopped") };
    if (member.lastError || member.error || /error|failed/.test(status)) return { state: "error", label: t("groupMemberError") };
    if (member.pending === true || /pending|waiting|approval|question/.test(status)) return { state: "pending", label: t("groupMemberPending") };
    if (status === "running" || member.running === true) return { state: "running", label: t("groupMemberRunning") };
    if (/pass|complete|success|done|idle/.test(status) && status !== "idle") return { state: "pass", label: t("groupMemberPassed") };
    return { state: "idle", label: t("groupMemberIdle") };
  }

  function groupRuntimeMembers(value) {
    return Array.isArray(value?.members) ? value.members : [];
  }

  function pendingInteractionRows(value) {
    if (Array.isArray(value)) return value;
    if (value instanceof Map) return [...value.values()];
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }

  function interactionForSession(value, sessionId) {
    if (!sessionId) return undefined;
    return pendingInteractionRows(value).find((interaction) => [
      interaction?.sessionId,
      interaction?.memberSessionId,
      interaction?.roomSessionId,
      interaction?.targetSessionId,
    ].some((candidate) => candidate && candidate === sessionId));
  }

  function interactionLabel(t, interaction) {
    if (interaction?.kind === "approval") return t("groupInteractionApproval");
    if (interaction?.kind === "question" || interaction?.kind === "plan-review") return t("groupInteractionQuestion");
    return "";
  }

  function GroupPendingInteraction({ interaction, t }) {
    const questions = Array.isArray(interaction?.questions) ? interaction.questions : [];
    const [drafts, setDrafts] = useState([]);
    const [busy, setBusy] = useState(false);
    const [pendingAction, setPendingAction] = useState("");
    const [errorState, setError] = useFeedbackError();
    const error = errorState.error;

    useEffect(() => {
      setDrafts(questions.map(() => ({ selected: [], custom: "", skipped: false })));
      setBusy(false);
      setPendingAction("");
      setError("");
    }, [interaction?.key]);

    const settle = async (action, operation) => {
      if (busy) return;
      setBusy(true);
      setPendingAction(action);
      setError("");
      try {
        await operation();
      } catch (cause) {
        setBusy(false);
        setPendingAction("");
        setError(`${t("groupInteractionFailed")}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    };

    if (interaction?.kind === "approval") {
      const reason = String(interaction.reason ?? "").trim();
      const tool = String(interaction.toolName ?? "").trim();
      return h("div", { className: "dshbot-group-interaction", "data-dshbot-group-interaction": "approval" },
        h("div", { className: "dshbot-group-interaction-copy" },
          `${t("groupApprovalReason")}${tool ? `: ${tool}` : ""}${reason ? `\n${reason}` : ""}`,
        ),
        h(Feedback, { t, error, identity: errorState }),
        h("div", { className: "dshbot-group-interaction-actions" },
          h(Button, {
            variant: "ghost", size: "sm", disabled: busy,
            loading: busy && pendingAction === "reject",
            onClick: () => settle("reject", () => interaction.answer("rejected")),
          }, t("groupApprovalReject")),
          h(Button, {
            variant: "primary", size: "sm", disabled: busy,
            loading: busy && pendingAction === "allow",
            onClick: () => settle("allow", () => interaction.answer("allowed-once")),
          }, t("groupApprovalAllow")),
        ),
      );
    }

    const updateDraft = (index, update) => {
      setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? update(draft) : draft));
      setError("");
    };
    const incomplete = questions.length === 0 || drafts.length !== questions.length || drafts.some((draft) => (
      !draft.skipped && draft.selected.length === 0 && !draft.custom.trim()
    ));
    const submit = () => {
      if (incomplete) {
        setError(t("groupQuestionIncomplete"));
        return;
      }
      const answer = {
        answers: questions.map((question, index) => {
          const draft = drafts[index];
          if (draft.skipped) return { id: question.id, selected: [] };
          const custom = draft.custom.trim();
          return {
            id: question.id,
            selected: custom && question.multiSelect !== true ? [] : [...draft.selected],
            ...(custom ? { custom } : {}),
          };
        }),
      };
      settle("submit", () => interaction.answer(answer));
    };

    return h("div", { className: "dshbot-group-interaction", "data-dshbot-group-interaction": interaction?.kind || "question" },
      h("div", { className: "dshbot-group-question-list" }, questions.map((question, index) => {
        const draft = drafts[index] ?? { selected: [], custom: "", skipped: false };
        const options = Array.isArray(question?.options) ? question.options : [];
        const inputType = question?.multiSelect === true ? "checkbox" : "radio";
        const prompt = [question?.header, question?.question].filter(Boolean).join(" · ");
        return h("fieldset", { className: "dshbot-group-question", key: question?.id || index, disabled: busy },
          h("legend", null, prompt || t("groupInteractionQuestion")),
          question?.detail ? h("div", { className: "dshbot-group-interaction-copy" }, question.detail) : null,
          options.length > 0 ? h("div", {
            className: "dshbot-group-question-options",
            role: question?.multiSelect === true ? "group" : "radiogroup",
          }, options.map((option, optionIndex) => {
            const label = String(option?.label ?? "");
            const checked = draft.selected.includes(label);
            return h("label", { className: "dshbot-group-question-option", key: `${label}:${optionIndex}` },
              h("input", {
                type: inputType,
                name: `dshbot-question-${interaction?.key || "pending"}-${question?.id || index}`,
                checked,
                onChange: () => updateDraft(index, (current) => {
                  if (question?.multiSelect === true) {
                    const selected = current.selected.includes(label)
                      ? current.selected.filter((value) => value !== label)
                      : [...current.selected, label];
                    return { ...current, selected, skipped: false };
                  }
                  return { selected: [label], custom: "", skipped: false };
                }),
              }),
              h("span", { className: "dshbot-group-question-option-body" },
                h("span", null, label),
                option?.description ? h("span", { className: "dshbot-group-question-option-description" }, option.description) : null,
              ),
            );
          })) : null,
          h("textarea", {
            className: "dshbot-group-question-custom",
            rows: 2,
            value: draft.custom,
            "aria-label": `${t("groupQuestionCustom")}: ${prompt || question?.id || index + 1}`,
            placeholder: t("groupQuestionCustom"),
            onChange: (event) => updateDraft(index, (current) => ({
              ...current,
              selected: question?.multiSelect === true ? current.selected : [],
              custom: event.target.value,
              skipped: false,
            })),
          }),
          h("label", { className: "dshbot-group-question-option" },
            h("input", {
              type: "checkbox",
              checked: draft.skipped,
              onChange: (event) => updateDraft(index, (current) => event.target.checked
                ? { selected: [], custom: "", skipped: true }
                : { ...current, skipped: false }),
            }),
            h("span", null, t("groupQuestionSkip")),
          ),
        );
      })),
      h(Feedback, { t, error, identity: errorState }),
      h("div", { className: "dshbot-group-interaction-actions" },
        typeof interaction?.cancel === "function" ? h(Button, {
          variant: "ghost", size: "sm", disabled: busy,
          loading: busy && pendingAction === "cancel",
          onClick: () => settle("cancel", () => interaction.cancel()),
        }, t("groupQuestionCancel")) : null,
        h(Button, {
          variant: "primary", size: "sm", disabled: busy || questions.length === 0,
          loading: busy && pendingAction === "submit",
          onClick: submit,
        }, t("groupQuestionSubmit")),
      ),
    );
  }

  function DummyTab() {
    return null;
  }

  /** Keep lockstep with `lib/sidebar-host.js` hostDeclaresRegionTabs. */
  function hostDeclaresRegionTabs(slots) {
    if (!slots || typeof slots.spec !== "function") return false;
    try {
      return Boolean(slots.spec("sidebar.nav.tab") && slots.spec("sidebar.page"));
    } catch {
      return false;
    }
  }

  /** Keep lockstep with `lib/sidebar-host.js` hostDeclaresFooterAction. */
  function hostDeclaresFooterAction(slots) {
    if (!slots || typeof slots.spec !== "function") return false;
    try {
      return Boolean(slots.spec("sidebar.footer.action"));
    } catch {
      return false;
    }
  }

  function OfficialBotsEntry(props) {
    const {
      wide, t, useSessions, useCatalog, useEditor,
      addBot, createRoom, openItem, openEditor, duplicateItem, requestDelete,
      togglePin, toggleHide, stampRoomPresets, taskControl, routineControl,
      retryTask,
      stopBot, controlAvailable, useGroupRuntime, refreshGroupRuntime, usePendingInteractions, openSession,
      getActivity, markRead, sectionControl, getTriggerToken, getMissedRoutines,
    } = props;
    const [open, setOpen] = useState(false);
    useEffect(() => {
      if (!open) return undefined;
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        // Body-portaled dialogs and menus own Escape before the outer Bot panel.
        if (document.querySelector('[data-dsh-motion="overlay"]:not([aria-hidden="true"]), [role="menu"]')) return;
        setOpen(false);
      };
      document.addEventListener("keydown", onKey, true);
      return () => document.removeEventListener("keydown", onKey, true);
    }, [open]);
    return h("div", {
      className: wide ? "dshbot-official-entry" : "dshbot-official-entry dshbot-official-rail",
    },
      h("button", {
        type: "button",
        className: "dshbot-official-trigger",
        "data-dshbot-official-trigger": "",
        "aria-haspopup": "dialog",
        "aria-expanded": open ? "true" : "false",
        "aria-label": t("tab"),
        onClick: () => setOpen((value) => !value),
      },
        h(IconAgentPresetOutline16, { size: wide ? 16 : 18 }),
        wide ? h("span", { className: "dshbot-official-trigger-label" }, t("tab")) : null,
      ),
      open ? h("div", { className: "dshbot-official-overlay", role: "presentation" },
        h("div", {
          className: "dshbot-official-mask",
          "aria-hidden": "true",
          onClick: () => setOpen(false),
        }),
        h("div", {
          className: "dshbot-official-panel",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": t("tab"),
          "data-dshbot-official-panel": "",
        },
          h("div", { className: "dshbot-official-panel-head" },
            h("h2", null, t("tab")),
            h(Button, {
              variant: "ghost",
              size: "sm",
              "aria-label": t("cancel"),
              onClick: () => setOpen(false),
            }, t("cancel")),
          ),
          h("div", { className: "dshbot-official-panel-body" },
            h(BotPage, {
              wide: true,
              expandSidebar: () => {},
              t,
              useSessions,
              useCatalog,
              useEditor,
              addBot,
              createRoom,
              openItem,
              openEditor,
              duplicateItem,
              requestDelete,
              togglePin,
              toggleHide,
              stampRoomPresets,
              taskControl,
              routineControl,
              retryTask,
              stopBot,
              controlAvailable,
              useGroupRuntime,
              refreshGroupRuntime,
              usePendingInteractions,
              openSession,
              getActivity,
              markRead,
              sectionControl,
              getTriggerToken,
              getMissedRoutines,
            }),
          ),
        ),
      ) : null,
    );
  }

  function useFeedbackError() {
    const [state, setState] = useState({ error: "" });
    return [state, (error) => setState({ error })];
  }

  const dismissedFeedback = new WeakMap();

  function Feedback({ t, text, error, warnings, identity, loading = false }) {
    const message = [text || error, ...(Array.isArray(warnings)
      ? warnings.map((warning) => `${t("hostWarning")}: ${warning}`) : [])].filter(Boolean).join("\n");
    const [dismissed, setDismissed] = useState(false);
    useEffect(() => { setDismissed(false); }, [message, identity]);
    const sharedIdentity = identity !== null && typeof identity === "object";
    if (!message || dismissed || sharedIdentity && dismissedFeedback.get(identity) === message) return null;
    return h(Toast, {
      key: message,
      text: message,
      icon: loading ? h(StateDot, { state: "ongoing", size: 16 }) : h(IconWarningOutline16, { size: 16 }),
      holdMs: null,
      dismissLabel: t("close"),
      onDone: () => {
        if (sharedIdentity) dismissedFeedback.set(identity, message);
        setDismissed(true);
      },
    });
  }

  function ConfirmActionModal(props) {
    const {
      t, open, title, body, caveat, confirmLabel, onClose, onConfirm, busy, error, feedbackIdentity, feedbackLoading,
    } = props;
    return h(Modal, {
      open,
      onClose: () => { if (!busy) onClose(); },
      title,
      closeLabel: t("close"),
      className: "dshbot-task-modal",
      footer: h("div", { className: "dshbot-footer" },
        h(Button, { variant: "outline", "aria-label": t("cancel"), disabled: busy, onClick: onClose }, t("cancel")),
        h(Button, { variant: "primary", "aria-label": confirmLabel, disabled: busy, loading: busy, onClick: onConfirm }, confirmLabel),
      ),
    },
      h("div", { className: "dshbot-confirm" },
        h("div", { className: "dshbot-task-value" }, body),
        h("p", { className: "dshbot-confirm-caveat" }, caveat),
        h(Feedback, { t, error, identity: feedbackIdentity, loading: feedbackLoading }),
      ),
    );
  }

  function RoutineEditorModal(props) {
    const {
      t, open, mode, routine, items, routines, disabled, busy, error, feedbackIdentity, stateText, stateLoading, onClose, onSave, getTriggerToken,
    } = props;
    const [name, setName] = useState("");
    const [botId, setBotId] = useState("");
    const [prompt, setPrompt] = useState("");
    const [frequency, setFrequency] = useState("daily");
    const [onceDelay, setOnceDelay] = useState("30m");
    const [hour, setHour] = useState("09");
    const [minute, setMinute] = useState("00");
    const [weekday, setWeekday] = useState("1");
    const [monthDay, setMonthDay] = useState("1");
    const [intervalAmount, setIntervalAmount] = useState("1");
    const [intervalUnit, setIntervalUnit] = useState("h");
    const [cron, setCron] = useState("0 9 * * *");
    const [timezone, setTimezone] = useState(routineBrowserTimezone());
    const [maxRuns, setMaxRuns] = useState("0");
    const [legacyMigrated, setLegacyMigrated] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [contextFrom, setContextFrom] = useState([]);
    const [silentAllowed, setSilentAllowed] = useState(true);
    const [watchKind, setWatchKind] = useState("");
    const [watchValue, setWatchValue] = useState("");
    const [watchTimeout, setWatchTimeout] = useState("15000");
    const [trigger, setTrigger] = useState({ status: "idle", text: "", copied: false, error: "" });
    const [copyBusy, setCopyBusy] = useState(false);
    const triggerSequence = useRef(0);

    useEffect(() => {
      if (!trigger.copied) return undefined;
      const timer = setTimeout(() => setTrigger((current) => ({ ...current, copied: false })), 2000);
      return () => clearTimeout(timer);
    }, [trigger.copied, open, routine?.id]);

    useEffect(() => {
      triggerSequence.current++;
      setCopyBusy(false);
      if (!open) return;
      setName(routine?.name || t("routineDefaultName"));
      setBotId(routine?.botId || "");
      setPrompt(routine?.prompt || "");
      const draft = routineDraftFromRecord(routine, routineBrowserTimezone());
      setFrequency(draft.frequency);
      setOnceDelay(draft.onceDelay);
      setHour(draft.hour);
      setMinute(draft.minute);
      setWeekday(draft.weekday);
      setMonthDay(draft.monthDay);
      setIntervalAmount(draft.intervalAmount);
      setIntervalUnit(draft.intervalUnit);
      setCron(draft.cron);
      setTimezone(draft.timezone);
      setMaxRuns(draft.maxRuns);
      setLegacyMigrated(draft.legacyMigrated);
      setEnabled(routine?.enabled === true);
      setContextFrom(Array.isArray(routine?.contextFrom)
        ? [...new Set(routine.contextFrom.map(String).filter(Boolean))]
        : []);
      setSilentAllowed(routine?.silentAllowed !== false);
      setWatchKind(routine?.watch?.kind === "command" ? "command" : routine?.watch?.kind === "url" ? "url" : "");
      setWatchValue(String(routine?.watch?.value ?? ""));
      setWatchTimeout(String(Number(routine?.watch?.timeoutMs) || 15000));
      setTrigger({ status: "idle", text: "", copied: false, error: "" });
      return () => { triggerSequence.current++; };
    }, [open, routine?.id, mode]);

    const botChoices = items.filter((item) => item.kind !== "room");
    const botChoiceIds = new Set(botChoices.map((item) => item.id));
    const botAvailable = botChoiceIds.has(botId);
    const hourNumber = Number(hour);
    const minuteNumber = Number(minute);
    const validTime = Number.isInteger(hourNumber) && hourNumber >= 0 && hourNumber <= 23
      && Number.isInteger(minuteNumber) && minuteNumber >= 0 && minuteNumber <= 59;
    const onceMatch = /^(\d+)([mhd])$/i.exec(String(onceDelay).trim());
    const validOnce = Boolean(onceMatch) && routineDurationValid(onceMatch[1], onceMatch[2].toLowerCase());
    const validInterval = routineDurationValid(intervalAmount, intervalUnit);
    const weekdayNumber = Number(weekday);
    const monthDayNumber = Number(monthDay);
    const validWeekday = Number.isInteger(weekdayNumber) && weekdayNumber >= 0 && weekdayNumber <= 6;
    const validMonthDay = Number.isInteger(monthDayNumber) && monthDayNumber >= 1 && monthDayNumber <= 31;
    const validCron = routineCronValid(cron);
    const schedule = routineScheduleFromDraft({ frequency, onceDelay, hour, minute, weekday, monthDay, intervalAmount, intervalUnit, cron });
    const validSchedule = schedule.length > 0 && schedule.length <= 200 && (
      frequency === "once" ? validOnce
        : frequency === "hourly" ? true
          : ["daily", "weekdays"].includes(frequency) ? validTime
            : frequency === "weekly" ? validTime && validWeekday
              : frequency === "monthly" ? validTime && validMonthDay
                : frequency === "interval" ? validInterval
                  : frequency === "advanced" ? validCron : false
    );
    const maxRunsValue = Number(maxRuns);
    const validMaxRuns = Number.isInteger(maxRunsValue) && maxRunsValue >= 0 && maxRunsValue <= ROUTINE_MAX_RUNS;
    const validTimezone = routineTimezoneValid(timezone);
    const watchTimeoutValue = Number(watchTimeout);
    const validWatch = !watchKind || (watchValue.trim().length > 0 && watchValue.trim().length <= 2000
      && Number.isInteger(watchTimeoutValue) && watchTimeoutValue >= 1 && watchTimeoutValue <= 300000);
    const valid = Boolean(name.trim()) && name.trim().length <= 120
      && botAvailable && Boolean(prompt.trim()) && prompt.length <= 8000
      && validSchedule && validTimezone && validMaxRuns && validWatch;
    const options = botChoices.map((item) => ({ id: item.id, label: displayName(item) || stableName(item) }));
    if (botId && !botAvailable) {
      options.push({ id: botId, label: `${t("sourceUnavailable")}: ${botId}`, disabled: true });
    }
    const contextChoices = [
      { id: "self", label: t("routineContextSelf") },
      ...(Array.isArray(routines) ? routines : [])
        .filter((row) => row.botId === botId && row.id !== routine?.id)
        .map((row) => ({ id: row.id, label: String(row.name || row.id) })),
    ];
    const contextIds = new Set(contextChoices.map((choice) => choice.id));
    const contextSelection = contextFrom.filter((id) => contextIds.has(id));
    const showTrigger = async () => {
      if (typeof getTriggerToken !== "function" || !routine?.id) return;
      const sequence = ++triggerSequence.current;
      setTrigger({ status: "loading", text: "", copied: false, error: "" });
      try {
        const result = await getTriggerToken();
        if (sequence !== triggerSequence.current) return;
        const token = String(result?.token ?? "");
        if (!token) throw new Error(t("profileTransportUnavailable"));
        const origin = typeof location !== "undefined" && location.origin ? location.origin : "http://127.0.0.1";
        setTrigger({
          status: "ready",
          text: `curl -X POST ${origin}/dshbot-hook/routine/${routine.id} -H "X-Dshbot-Token: ${token}"`,
          copied: false,
          error: "",
        });
      } catch (cause) {
        if (sequence === triggerSequence.current) setTrigger({ status: "idle", text: "", copied: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    };
    const frequencyOptions = ROUTINE_FREQUENCIES.map((id) => ({ id, label: t(`routineFrequency${id[0].toUpperCase()}${id.slice(1)}`) }));
    const weekdayOptions = [
      ["0", "日"], ["1", "一"], ["2", "二"], ["3", "三"], ["4", "四"], ["5", "五"], ["6", "六"],
    ].map(([id, label]) => ({ id, label: `${t("routineWeekday")} ${label}` }));
    const intervalUnitOptions = [
      { id: "m", label: t("routineMinutes") },
      { id: "h", label: t("routineHours") },
      { id: "d", label: t("routineDays") },
    ];
    const timeValue = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const setTime = (value) => {
      const [nextHour = "", nextMinute = ""] = String(value).split(":");
      setHour(nextHour);
      setMinute(nextMinute);
    };
    const scheduleControls = frequency === "once"
      ? h("div", { className: "dshbot-field" },
        h("label", null, t("routineOnceDelay")),
        h(Input, {
          value: onceDelay,
          "aria-label": t("routineOnceDelay"),
          placeholder: "30m",
          disabled: disabled || busy,
          onChange: (event) => setOnceDelay(event.target.value),
        }),
      )
      : frequency === "advanced"
        ? h("div", { className: "dshbot-field" },
          h("label", null, t("routineCron")),
          h(Input, {
            value: cron,
            "aria-label": t("routineCron"),
            disabled: disabled || busy,
            onChange: (event) => setCron(event.target.value),
          }),
          h("div", { className: "dshbot-hint" }, t("routineCronHint")),
        )
        : frequency === "interval"
          ? h("div", { className: "dshbot-number-row" },
            h("label", { htmlFor: "dshbot-routine-interval-amount" }, t("routineIntervalAmount")),
            h("input", {
              id: "dshbot-routine-interval-amount",
              className: "dshbot-number-input",
              type: "number",
              min: ROUTINE_MIN_INTERVAL,
              step: 1,
              value: intervalAmount,
              "aria-label": t("routineIntervalAmount"),
              disabled: disabled || busy,
              onChange: (event) => setIntervalAmount(event.target.value),
            }),
            h(SettingsSelect, {
              variant: "block",
              value: intervalUnit,
              options: intervalUnitOptions,
              "aria-label": t("routineIntervalUnit"),
              disabled: disabled || busy,
              onChange: setIntervalUnit,
            }),
          )
          : ["daily", "weekdays", "weekly", "monthly"].includes(frequency)
            ? h("div", { className: "dshbot-routine-schedule-grid" },
              h("div", { className: "dshbot-field" },
                h("label", null, t("routineTime")),
                h("input", {
                  className: "dshbot-time-input",
                  type: "time",
                  value: timeValue,
                  "aria-label": t("routineTime"),
                  disabled: disabled || busy,
                  onChange: (event) => setTime(event.target.value),
                }),
              ),
              frequency === "weekly" ? h("div", { className: "dshbot-field" },
                h("label", null, t("routineWeekday")),
                h(SettingsSelect, {
                  variant: "block",
                  value: weekday,
                  options: weekdayOptions,
                  "aria-label": t("routineWeekday"),
                  disabled: disabled || busy,
                  onChange: setWeekday,
                }),
              ) : null,
              frequency === "monthly" ? h("div", { className: "dshbot-field" },
                h("label", null, t("routineMonthDay")),
                h("input", {
                  className: "dshbot-number-input",
                  type: "number",
                  min: 1,
                  max: 31,
                  step: 1,
                  value: monthDay,
                  "aria-label": t("routineMonthDay"),
                  disabled: disabled || busy,
                  onChange: (event) => setMonthDay(event.target.value),
                }),
              ) : null,
            )
            : null;
    return h(Modal, {
      open,
      onClose: () => { if (!busy) onClose(); },
      title: mode === "edit" ? t("routineEdit") : t("routineAdd"),
      closeLabel: t("close"),
      className: "dshbot-modal",
      footer: h("div", { className: "dshbot-footer" },
        h(Button, { variant: "outline", "aria-label": t("cancel"), disabled: busy, onClick: onClose }, t("cancel")),
        h(Button, {
          variant: "primary",
          "aria-label": t("routineSave"),
          disabled: disabled || busy || !valid,
          loading: busy,
          onClick: () => onSave({
            id: routine?.id,
            name: name.trim(),
            botId,
            prompt,
            schedule,
            timezone: timezone.trim(),
            maxRuns: maxRunsValue,
            enabled,
            contextFrom: contextSelection,
            silentAllowed,
            watch: watchKind ? { kind: watchKind, value: watchValue.trim(), timeoutMs: watchTimeoutValue } : null,
          }),
        }, t("save")),
      ),
    },
      h("div", { className: "dshbot-routine-form" },
        h(Feedback, { t, text: [error, trigger.error, stateText].filter(Boolean).join("\n"),
          identity: error ? feedbackIdentity : trigger, loading: Boolean(stateLoading && !error && !trigger.error) }),
        h("div", { className: "dshbot-field" },
          h("label", null, t("routineName")),
          h(Input, {
            value: name,
            "aria-label": t("routineName"),
            disabled: disabled || busy,
            maxLength: 120,
            onChange: (event) => setName(event.target.value),
          }),
        ),
        h("div", { className: "dshbot-field" },
          h("label", null, t("routineBot")),
          h(SettingsSelect, {
            variant: "block",
            value: botId,
            options,
            placeholder: t("routineBotRequired"),
            "aria-label": t("routineBot"),
            "aria-invalid": Boolean(botId && !botAvailable),
            "aria-description": botId && !botAvailable ? t("routineBotRequired") : undefined,
            title: botId && !botAvailable ? t("routineBotRequired") : undefined,
            disabled: disabled || busy,
            onChange: setBotId,
          }),
        ),
        h("div", { className: "dshbot-field" },
          h("label", null, t("routinePrompt")),
          h("textarea", {
            className: "dshbot-textarea",
            "aria-label": t("routinePrompt"),
            value: prompt,
            rows: 5,
            maxLength: 8000,
            disabled: disabled || busy,
            onChange: (event) => setPrompt(event.target.value),
          }),
          h("div", { className: "dshbot-hint" }, t("routinePromptHint")),
        ),
        h("div", { className: "dshbot-field" },
          h("label", null, t("routineFrequency")),
          h(SettingsSelect, {
            variant: "block",
            value: frequency,
            options: frequencyOptions,
            "aria-label": t("routineFrequency"),
            "aria-invalid": !validSchedule,
            "aria-description": !validSchedule ? t("routineInvalidSchedule") : undefined,
            title: !validSchedule ? t("routineInvalidSchedule") : undefined,
            disabled: disabled || busy,
            onChange: setFrequency,
          }),
          h("div", { className: "dshbot-hint" }, t("routineScheduleHint")),
          legacyMigrated ? h("div", { className: "dshbot-hint" }, t("routineLegacyMigrated")) : null,
        ),
        scheduleControls,
        h("div", { className: "dshbot-field" },
          h("label", null, t("routineTimezone")),
          h(Input, {
            value: timezone,
            "aria-label": t("routineTimezone"),
            "aria-invalid": !validTimezone,
            "aria-description": !validTimezone ? t("routineInvalidSchedule") : undefined,
            title: !validTimezone ? t("routineInvalidSchedule") : undefined,
            disabled: disabled || busy,
            onChange: (event) => setTimezone(event.target.value),
          }),
          h("div", { className: "dshbot-hint" }, t("routineTimezoneHint")),
        ),
        h("div", { className: "dshbot-number-row" },
          h("label", { htmlFor: "dshbot-routine-max-runs" }, t("routineMaxRuns")),
          h("input", {
            id: "dshbot-routine-max-runs",
            className: "dshbot-number-input",
            type: "number",
            min: 0,
            max: ROUTINE_MAX_RUNS,
            step: 1,
            value: maxRuns,
            "aria-label": t("routineMaxRuns"),
            "aria-invalid": !validMaxRuns,
            "aria-description": !validMaxRuns ? t("routineInvalidSchedule") : undefined,
            title: !validMaxRuns ? t("routineInvalidSchedule") : undefined,
            disabled: disabled || busy,
            onChange: (event) => setMaxRuns(event.target.value),
          }),
          Number(maxRuns) === 0 ? h("span", { className: "dshbot-hint" }, t("routineUnlimited")) : null,
        ),
        h("div", { className: "dshbot-field" },
          h("label", null, t("routineContextFrom")),
          h("div", { className: "dshbot-hint" }, t("routineContextFromHint")),
          contextChoices.length > 0 ? h("div", { className: "dshbot-members" },
            contextChoices.map((choice) => h("label", { key: choice.id, className: "dshbot-member" },
              h("input", {
                type: "checkbox",
                "aria-label": choice.label,
                checked: contextSelection.includes(choice.id),
                disabled: disabled || busy || (!contextSelection.includes(choice.id) && contextSelection.length >= 3),
                onChange: (event) => setContextFrom((current) => event.target.checked
                  ? [...current.filter((id) => id !== choice.id), choice.id].slice(-3)
                  : current.filter((id) => id !== choice.id)),
              }),
              h("span", null, choice.label),
            )),
          ) : null,
        ),
        h("div", { className: "dshbot-field" },
          h("div", { className: "dshbot-switch-row" },
            h("label", null, t("routineSilentAllowed")),
            h(Switch, {
              checked: silentAllowed,
              "aria-label": t("routineSilentAllowed"),
              disabled: disabled || busy,
              onChange: (event) => setSilentAllowed(event.target.checked),
            }),
          ),
          h("div", { className: "dshbot-hint" }, t("routineSilentAllowedHint")),
        ),
        h("div", { className: "dshbot-field" },
          h("label", null, t("routineWatch")),
          h(SettingsSelect, {
            variant: "block",
            value: watchKind,
            options: [
              { id: "", label: t("routineWatchNone") },
              { id: "url", label: t("routineWatchUrl") },
              { id: "command", label: t("routineWatchCommand") },
            ],
            "aria-label": t("routineWatch"),
            disabled: disabled || busy,
            onChange: setWatchKind,
          }),
          h("div", { className: "dshbot-hint" }, t("routineWatchHint")),
          watchKind ? h(Input, {
            value: watchValue,
            "aria-label": t("routineWatchValue"),
            disabled: disabled || busy,
            onChange: (event) => setWatchValue(event.target.value),
          }) : null,
          watchKind ? h("div", { className: "dshbot-number-row" },
            h("label", { htmlFor: "dshbot-routine-watch-timeout" }, t("routineWatchTimeout")),
            h("input", {
              id: "dshbot-routine-watch-timeout",
              className: "dshbot-number-input",
              type: "number",
              min: 1,
              max: 300000,
              step: 1000,
              value: watchTimeout,
              "aria-label": t("routineWatchTimeout"),
              disabled: disabled || busy,
              onChange: (event) => setWatchTimeout(event.target.value),
            }),
          ) : null,
        ),
        mode === "edit" && routine?.id ? h("div", { className: "dshbot-field" },
          h("label", null, t("routineTriggerUrl")),
          h("div", { className: "dshbot-hint" }, t("routineTriggerHint")),
          trigger.text ? h("div", { className: "dshbot-routine-trigger" },
            h("code", { className: "dshbot-routine-trigger-command" }, trigger.text),
            h(Button, {
              variant: "outline",
              "aria-label": t("routineTriggerCopy"),
              disabled: busy || copyBusy,
              loading: copyBusy,
              feedback: trigger.copied ? t("routineTriggerCopied") : undefined,
              onClick: async () => {
                if (copyBusy) return;
                const sequence = ++triggerSequence.current;
                setCopyBusy(true);
                setTrigger((current) => ({ ...current, copied: false, error: "" }));
                try {
                  await navigator.clipboard.writeText(trigger.text);
                  if (sequence === triggerSequence.current) setTrigger((current) => ({ ...current, copied: true }));
                } catch (cause) {
                  if (sequence === triggerSequence.current) setTrigger((current) => ({ ...current, copied: false,
                    error: `${t("routineTriggerCopyFailed")}: ${cause instanceof Error ? cause.message : String(cause)}` }));
                } finally {
                  if (sequence === triggerSequence.current) setCopyBusy(false);
                }
              },
            }, t("routineTriggerCopy")),
          ) : h(Button, {
            variant: "outline",
            "aria-label": t("routineTriggerShow"),
            disabled: disabled || busy || trigger.status === "loading" || typeof getTriggerToken !== "function",
            loading: trigger.status === "loading",
            onClick: () => { void showTrigger(); },
          }, t("routineTriggerShow")),
        ) : null,
        h("div", { className: "dshbot-switch-row" },
          h("label", null, t("routineEnabled")),
          h(Switch, {
            checked: enabled,
            "aria-label": t("routineEnabled"),
            disabled: disabled || busy,
            onChange: (event) => setEnabled(event.target.checked),
          }),
        ),
      ),
    );
  }

  function EmptyRoster(props) {
    const { sessionId, useCatalog } = props;
    const catalogSnap = useCatalog((s) => s);
    const roster = emptyRoster(catalogItems(catalogSnap), sessionId);
    if (!roster || roster.length === 0) return null;
    return h("div", { className: "dshbot-roster" },
      roster.map((item) => h("div", { key: item.id, className: "dshbot-roster-member" },
        h(AvatarView, { avatar: item.avatar, name: displayName(item), seed: item.id || stableName(item), size: 48, live: false }),
        h("span", { className: "dshbot-roster-name" }, displayName(item)),
        identityAddress(item) ? h("span", { className: "dshbot-address", title: identityAddress(item) }, identityAddress(item)) : null,
      )),
    );
  }

  function SectionNameModal(props) {
    const { t, open, mode, initialName, busy, error, feedbackIdentity, stateText, stateLoading, onClose, onSubmit } = props;
    const [value, setValue] = useState(initialName || "");
    useEffect(() => {
      if (open) setValue(initialName || "");
    }, [initialName, open]);
    const submit = () => {
      const name = value.trim();
      if (name) onSubmit(name);
    };
    return h(Modal, {
      open,
      onClose: () => { if (!busy) onClose(); },
      title: mode === "create" ? t("newSectionTitle") : t("renameSectionTitle"),
      closeLabel: t("close"),
      className: "dshbot-modal",
      footer: h("div", { className: "dshbot-footer" },
        h(Button, { variant: "outline", "aria-label": t("cancel"), disabled: busy, onClick: onClose }, t("cancel")),
        h(Button, {
          variant: "primary",
          "aria-label": mode === "create" ? t("sectionCreate") : t("sectionRename"),
          disabled: busy || !value.trim(),
          loading: busy,
          onClick: submit,
        }, mode === "create" ? t("sectionCreate") : t("sectionRename")),
      ),
    },
      h("div", { className: "dshbot-form" },
        h(Feedback, { t, text: [error, stateText].filter(Boolean).join("\n"), identity: feedbackIdentity, loading: Boolean(stateLoading && !error) }),
        h("div", { className: "dshbot-field" },
          h("label", null, t("sectionName")),
          h(Input, {
            autoFocus: true,
            value,
            maxLength: 120,
            "aria-label": t("sectionName"),
            placeholder: t("sectionNamePlaceholder"),
            disabled: busy,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            },
          }),
        ),
      ),
    );
  }

  function BotPage(props) {
    const {
      wide, expandSidebar, t, useSessions, useCatalog, useEditor,
      addBot, createRoom, openItem, openEditor, duplicateItem, requestDelete,
      togglePin, toggleHide, stampRoomPresets, taskControl, routineControl,
      retryTask,
      stopBot, controlAvailable, useGroupRuntime, refreshGroupRuntime, usePendingInteractions, openSession,
      getActivity, markRead, sectionControl, getTriggerToken, getMissedRoutines,
    } = props;
    const sessions = useSessions((s) => s);
    const catalogSnap = useCatalog((s) => s);
    const editor = useEditor((s) => s);
    const groupRuntime = typeof useGroupRuntime === "function" ? useGroupRuntime((s) => s) : { byRoomId: {} };
    const pendingSnapshot = typeof usePendingInteractions === "function" ? usePendingInteractions((s) => s) : new Map();
    const [query, setQuery] = useState("");
    const [taskQuery, setTaskQuery] = useState("");
    const [taskStatus, setTaskStatus] = useState("all");
    const [routineQuery, setRoutineQuery] = useState("");
    const [view, setView] = useState("contacts");
    const [taskDetailId, setTaskDetailId] = useState("");
    const [taskConfirmation, setTaskConfirmation] = useState(null);
    const [retryOperationIds, setRetryOperationIds] = useState(() => readRetryOperationIds());
    const [taskControlState, setTaskControlState] = useState({ busy: "", error: "" });
    const [routineEditor, setRoutineEditor] = useState({ open: false, mode: "create", id: null, revision: null, error: "" });
    const [routineDetailId, setRoutineDetailId] = useState("");
    const [routineControlState, setRoutineControlState] = useState({ busy: "", error: "" });
    const [routineConfirmation, setRoutineConfirmation] = useState(null);
    const [sessionStop, setSessionStop] = useState(null);
    const [sessionStopState, setSessionStopState] = useState({ busy: false, error: "" });
    const [plusOpen, setPlusOpen] = useState(false);
    const [menu, setMenu] = useState(null);
    const [contactBusy, setContactBusy] = useState({});
    const [contactErrorState, setContactError] = useFeedbackError();
    const contactPendingRef = useRef(new Set());
    const [showHidden, setShowHidden] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const [sectionMenuOpen, setSectionMenuOpen] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [activityFilter, setActivityFilter] = useState("all");
    const [sourceFilter, setSourceFilter] = useState("all");
    const [collapsedSections, setCollapsedSections] = useState(() => new Set());
    const [sectionDialog, setSectionDialog] = useState(null);
    const [sectionState, setSectionState] = useState({ busy: "", error: "" });
    const [sectionUndo, setSectionUndo] = useState(null);
    const [activityState, setActivityState] = useState({ status: "idle", byId: {} });
    const [activityTick, setActivityTick] = useState(0);
    const [missedRoutineIds, setMissedRoutineIds] = useState([]);
    const activityPrevRef = useRef({});
    const tabListRef = useRef(null);
    const items = catalogItems(catalogSnap);
    const tasks = catalogTasks(catalogSnap);
    const routines = catalogRoutines(catalogSnap);
    const catalogReady = catalogSnap?.status === "ready";
    const retryableTaskIds = useMemo(() => new Set(tasks
      .filter((task) => ["failed", "cancelled"].includes(String(task?.status ?? "")))
      .map((task) => String(task?.id ?? ""))
      .filter(validRetryTaskId)), [tasks]);
    const catalogLoading = catalogSnap?.status === "idle" || catalogSnap?.status === "loading";
    const catalogReadOnly = catalogReady && (!catalogSnap.writable || catalogSnap.mode !== "host");
    const catalogWriteDisabled = !catalogReady || catalogReadOnly;
    const catalogStateText = catalogLoading
      ? t("catalogLoading")
      : !catalogReady
        ? t("catalogUnavailableState")
        : catalogReadOnly ? t("catalogReadOnlyState") : "";
    const sections = catalogSections(catalogSnap);
    const sourceChoices = useMemo(() => sourceOptions(items), [items]);
    const sectionControlAvailable = Boolean(controlAvailable && typeof sectionControl === "function");
    const runContactAction = async (action, id, label, operation) => {
      const key = `${action}:${id}`;
      if (contactPendingRef.current.has(key)) return;
      contactPendingRef.current.add(key);
      setContactBusy((current) => ({ ...current, [key]: label }));
      setContactError("");
      try {
        await operation();
      } catch (cause) {
        setContactError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        contactPendingRef.current.delete(key);
        setContactBusy((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    };
    useEffect(() => {
      if (sourceFilter !== "all" && !sourceChoices.some((source) => source.id === sourceFilter)) {
        setSourceFilter("all");
      }
    }, [sourceChoices, sourceFilter]);
    useEffect(() => {
      if (!catalogReady) return;
      setRetryOperationIds((current) => {
        const next = Object.fromEntries(Object.entries(current)
          .filter(([taskId, operationId]) => retryableTaskIds.has(taskId) && validRetryOperationId(operationId)));
        const unchanged = Object.keys(current).length === Object.keys(next).length
          && Object.entries(next).every(([taskId, operationId]) => current[taskId] === operationId);
        if (unchanged) return current;
        writeRetryOperationIds(next);
        return next;
      });
    }, [catalogReady, retryableTaskIds]);
    const visible = useMemo(() => {
      const filtered = filterItems(items, query)
        .filter((item) => showHidden || item.hidden !== true)
        .filter((item) => kindFilter === "all" || (kindFilter === "groups" ? item.kind === "room" : item.kind !== "room"))
        .filter((item) => sourceFilter === "all" || itemSourceId(item) === sourceFilter)
        .filter((item) => {
          const session = sessions?.byId?.[item.sessionId];
          const activity = activityState.byId?.[item.id];
          const runtime = item.kind === "room" ? groupRuntime?.byRoomId?.[item.id]?.value : null;
          const runtimeActive = Array.isArray(runtime?.members) && runtime.members.some((member) => {
            const status = String(member?.status ?? "").toLowerCase();
            return member?.running === true || member?.pending === true || member?.error || member?.lastError
              || /running|pending|waiting|approval|question|error|failed/.test(status);
          });
          return contactActivityMatches(item, runtimeActive ? { ...session, running: true } : session, activity, activityFilter);
        });
      return filtered.sort((a, b) => {
        const pinned = Number(b.pinned === true) - Number(a.pinned === true);
        if (pinned) return pinned;
        const activity = contactActivityAt(b, sessions?.byId?.[b.sessionId], activityState.byId?.[b.id])
          - contactActivityAt(a, sessions?.byId?.[a.sessionId], activityState.byId?.[a.id]);
        if (activity) return activity;
        return displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" })
          || stableName(a).localeCompare(stableName(b), undefined, { sensitivity: "base" });
      });
    }, [activityFilter, activityState.byId, groupRuntime, items, kindFilter, query, sessions, showHidden, sourceFilter]);
    const sectionBlocks = useMemo(() => {
      const known = new Set(sections.map((section) => section.id));
      const groups = sections.map((section) => ({ id: section.id, name: section.name, items: [] }));
      const byId = new Map(groups.map((group) => [group.id, group]));
      const unassigned = [];
      for (const item of visible) {
        const sectionId = itemSectionId(item);
        if (sectionId && known.has(sectionId)) byId.get(sectionId).items.push(item);
        else unassigned.push(item);
      }
      if (sections.length > 0 || unassigned.length > 0) groups.push({ id: "", name: t("unassigned"), items: unassigned });
      return groups;
    }, [sections, t, visible]);
    const activeFilterCount = (kindFilter !== "all" ? 1 : 0) + (activityFilter !== "all" ? 1 : 0) + (sourceFilter !== "all" ? 1 : 0);
    const visibleTasks = useMemo(() => {
      const needle = String(taskQuery ?? "").trim().toLowerCase();
      return tasks
        .filter((task) => taskStatus === "all" || String(task.status ?? "") === taskStatus)
        .filter((task) => !needle || taskSearchText(task).includes(needle))
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
          || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    }, [tasks, taskQuery, taskStatus]);
    const visibleRoutines = useMemo(() => {
      const needle = String(routineQuery ?? "").trim().toLowerCase();
      return routines
        .filter((routine) => !needle || routineSearchText(routine, items).includes(needle))
        .sort((a, b) => (Number(a.nextRunAt) || 0) - (Number(b.nextRunAt) || 0)
          || String(a.name).localeCompare(String(b.name)));
    }, [items, routineQuery, routines]);
    const selectedTask = catalogReady ? tasks.find((task) => task.id === taskDetailId) : undefined;
    const selectedRoutine = routineEditor.id ? routines.find((routine) => routine.id === routineEditor.id) : undefined;
    const currentId = sessions?.current;
    const visibleMissedRoutines = missedRoutineIds.filter((id) => !dismissedRoutineBanners.has(id));
    const activityKey = items.map((item) => [
      item.id,
      item.sessionId,
      item.readInitialized === true ? 1 : 0,
      Number(item.lastSeenSeq) || 0,
      Number(sessions?.byId?.[item.sessionId]?.updatedAt) || 0,
    ].join(":")).join("|");
    const activityIdsKey = items.map((item) => item.id).join("|");
    const roomIds = useMemo(() => items.filter((item) => item.kind === "room").map((item) => item.id), [items]);
    const roomIdsKey = roomIds.join("|");
    useEffect(() => {
      stampRoomPresets?.(sessions?.byId);
    }, [stampRoomPresets, sessions, items]);
    // OS notification path: opt-out per bot, lazy one-shot permission request,
    // suppressed entirely while the window is focused or unsupported.
    const notifyBot = (item, body) => {
      if (!item || item.notify === false) return;
      if (typeof Notification === "undefined") return;
      if (document.hasFocus?.() !== false) return;
      const show = () => {
        try {
          const notification = new Notification(displayName(item), { body });
          notification.onclick = () => {
            window.focus?.();
            void openItem(item);
          };
        } catch {
          // Some shells expose the constructor but deny invocation.
        }
      };
      if (Notification.permission === "granted") {
        show();
        return;
      }
      if (Notification.permission === "denied" || notificationPermissionRequested) return;
      notificationPermissionRequested = true;
      try {
        void Promise.resolve(Notification.requestPermission?.()).then((permission) => {
          if (permission === "granted") show();
        });
      } catch {
        // Permission requests are best-effort; badges already carry the state.
      }
    };
    useEffect(() => {
      if (!catalogReady || !controlAvailable || typeof getActivity !== "function" || items.length === 0) {
        setActivityState({ status: "idle", byId: {} });
        return undefined;
      }
      let disposed = false;
      setActivityState((current) => ({ ...current, status: "loading" }));
      void getActivity(items.map((item) => item.id)).then(async (result) => {
        const entries = Array.isArray(result?.entries) ? result.entries : [];
        // The first observation per bot is a baseline; transitions after it
        // may raise an OS notification while the window is unfocused.
        for (const entry of entries) {
          if (!entry) continue;
          const previous = activityPrevRef.current[entry.botId];
          const run = entry.lastRun && typeof entry.lastRun === "object" ? entry.lastRun : null;
          const runKey = run && ROUTINE_TERMINAL_STATUSES.has(run.status) && run.silent !== true
            ? `${run.routineId}:${run.runId}` : "";
          const snapshot = {
            attention: entry.attention === true,
            runKey,
            goalPhase: String(entry.goal?.phase ?? ""),
          };
          activityPrevRef.current[entry.botId] = snapshot;
          if (!previous) continue;
          const item = items.find((candidate) => candidate.id === entry.botId);
          if (snapshot.attention && !previous.attention) notifyBot(item, t("notifyAttention"));
          if (snapshot.goalPhase === "blocked" && previous.goalPhase !== "blocked") {
            notifyBot(item, t("notifyObjectiveBlocked"));
          }
          if (snapshot.runKey && snapshot.runKey !== previous.runKey) {
            notifyBot(item, (run.status === "completed" ? t("notifyRoutineFinished") : t("notifyRoutineFailed"))
              .replace("{name}", String(run.name ?? "")));
          }
        }
        const marks = entries.filter((entry) => entry && (
          entry.readInitialized !== true
          || (entry.sessionId === currentId && Number(entry.activitySeq) > Number(entry.lastSeenSeq))
        )).map((entry) => ({ id: entry.botId, throughSeq: Math.max(0, Number(entry.activitySeq) || 0) }));
        if (!catalogWriteDisabled && marks.length > 0 && typeof markRead === "function") {
          await markRead(marks);
          const seen = new Map(marks.map((mark) => [mark.id, mark.throughSeq]));
          for (const entry of entries) {
            if (!seen.has(entry.botId)) continue;
            entry.readInitialized = true;
            entry.lastSeenSeq = Math.max(Number(entry.lastSeenSeq) || 0, seen.get(entry.botId));
          }
        }
        if (!disposed) {
          setActivityState({ status: "ready", byId: Object.fromEntries(entries.map((entry) => [entry.botId, entry])) });
        }
      }).catch(() => {
        if (!disposed) setActivityState({ status: "unavailable", byId: {} });
      });
      return () => { disposed = true; };
    }, [activityKey, activityTick, catalogReady, catalogWriteDisabled, controlAvailable, currentId, getActivity, markRead]);
    useEffect(() => {
      if (view !== "contacts" || !controlAvailable || !activityIdsKey) return undefined;
      const timer = setInterval(() => setActivityTick((value) => value + 1), 1500);
      return () => clearInterval(timer);
    }, [activityIdsKey, controlAvailable, view]);
    useEffect(() => {
      if (view !== "contacts" || !controlAvailable || typeof getMissedRoutines !== "function") return undefined;
      let disposed = false;
      void getMissedRoutines().then((result) => {
        if (!disposed) setMissedRoutineIds(Array.isArray(result?.ids) ? result.ids.map(String) : []);
      }).catch(() => {});
      return () => { disposed = true; };
    }, [controlAvailable, getMissedRoutines, view]);
    useEffect(() => {
      if (!controlAvailable || typeof refreshGroupRuntime !== "function" || roomIds.length === 0) return undefined;
      let disposed = false;
      const poll = () => {
        for (const roomId of roomIds) {
          if (!disposed) void refreshGroupRuntime(roomId);
        }
      };
      poll();
      const activeRoom = items.some((item) => item.kind === "room" && item.sessionId === currentId);
      const timer = setInterval(poll, activeRoom ? 1500 : 5000);
      return () => { disposed = true; clearInterval(timer); };
    }, [controlAvailable, currentId, items, refreshGroupRuntime, roomIds, roomIdsKey]);
    useEffect(() => {
      if (taskDetailId && !selectedTask) setTaskDetailId("");
    }, [taskDetailId, selectedTask]);
    useEffect(() => {
      if (routineEditor.id && !selectedRoutine && routineEditor.mode === "edit") {
        setRoutineEditor((current) => ({ ...current, error: t("routineNoMatch") }));
      }
    }, [routineEditor.id, routineEditor.mode, selectedRoutine]);
    useEffect(() => {
      if (routineDetailId && !routines.some((routine) => routine.id === routineDetailId)) setRoutineDetailId("");
    }, [routineDetailId, routines]);

    if (!wide) {
      return h("button", {
        type: "button",
        className: "dshbot-rail",
        "aria-label": t("tab"),
        title: t("tab"),
        onClick: expandSidebar,
      }, h(IconAgentPresetOutline16, { size: 18 }));
    }

    const tabIds = ["contacts", "tasks", "routines"];
    const focusTab = (nextView) => {
      setView(nextView);
      const target = tabListRef.current?.querySelector(`[role="tab"][data-dshbot-tab="${nextView}"]`);
      if (target && typeof target.focus === "function") target.focus();
    };
    const onTabKeyDown = (event) => {
      const currentIndex = tabIds.indexOf(view);
      let nextIndex = currentIndex;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabIds.length;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabIds.length - 1;
      if (nextIndex === currentIndex) return;
      event.preventDefault();
      focusTab(tabIds[nextIndex]);
    };
    const switchView = (nextView) => {
      setView(nextView);
      setPlusOpen(false);
      setMenu(null);
      if (nextView !== "tasks") setTaskDetailId("");
      if (nextView !== "routines") setRoutineDetailId("");
    };
    const taskStatusOptions = [
      { id: "all", label: t("taskStatusAll") },
      { id: "queued", label: t("taskStatusQueued") },
      { id: "delivered", label: t("taskStatusDelivered") },
      { id: "completed", label: t("taskStatusCompleted") },
      { id: "failed", label: t("taskStatusFailed") },
      { id: "paused", label: t("taskStatusPaused") },
      { id: "cancelled", label: t("taskStatusCancelled") },
    ];
    const rememberRetryOperation = (taskId, operationId) => {
      const id = String(taskId ?? "");
      if (!validRetryTaskId(id) || !validRetryOperationId(operationId)) return;
      setRetryOperationIds((current) => {
        const next = { ...current, [id]: String(operationId) };
        writeRetryOperationIds(next);
        return next;
      });
    };
    const discardRetryOperation = (taskId) => {
      const id = String(taskId ?? "");
      setRetryOperationIds((current) => {
        const next = { ...current };
        delete next[id];
        writeRetryOperationIds(next);
        return next;
      });
    };
    const executeTaskControl = async (action, task, operationId) => {
      const execute = action === "retry" ? retryTask : taskControl;
      if (typeof execute !== "function" || (action !== "retry" && !controlAvailable)
        || !task?.id || (action === "retry" && (!operationId || !["failed", "cancelled"].includes(String(task.status ?? ""))))) return;
      setTaskControlState({ busy: action, error: "" });
      try {
        const result = action === "retry"
          ? await retryTask(task, operationId)
          : await taskControl(action, task.id);
        if (action === "retry") {
          const nextTaskId = String(result?.taskId ?? "").trim();
          if (!result?.view || !nextTaskId) throw new Error(t("taskControlUnavailable"));
          setTaskDetailId(nextTaskId);
          discardRetryOperation(task.id);
        }
        setTaskConfirmation(null);
      } catch (error) {
        setTaskControlState({ busy: "", error: error instanceof Error ? error.message : String(error) });
        return;
      }
      setTaskControlState({ busy: "", error: "" });
    };
    const requestTaskControl = (action, task) => {
      if (!task || catalogWriteDisabled) return;
      if (action === "retry" && !["failed", "cancelled"].includes(String(task.status ?? ""))) return;
      if (action === "retry" && typeof retryTask !== "function") return;
      if (action !== "retry" && (!controlAvailable || typeof taskControl !== "function")) return;
      if (action === "cancel" || action === "retry") {
        const operationId = action === "retry"
          ? (validRetryOperationId(retryOperationIds[task.id])
            ? retryOperationIds[task.id]
            : newRetryOperationId())
          : undefined;
        if (operationId) rememberRetryOperation(task.id, operationId);
        setTaskConfirmation({ action, taskId: task.id, operationId });
        setTaskControlState({ busy: "", error: "" });
        return;
      }
      void executeTaskControl(action, task);
    };
    const openRoutineEditor = (mode, routine) => {
      setRoutineControlState({ busy: "", error: "" });
      setRoutineEditor({
        open: true,
        mode,
        id: routine?.id ?? null,
        revision: Number.isInteger(catalogSnap?.revision) ? catalogSnap.revision : null,
        error: "",
      });
    };
    const saveRoutine = async (draft) => {
      if (!routineControl || !controlAvailable || catalogWriteDisabled) return;
      if (!Number.isInteger(routineEditor.revision) || routineEditor.revision !== catalogSnap?.revision) {
        setRoutineEditor((current) => ({ ...current, error: t("saveConflict") }));
        return;
      }
      setRoutineControlState({ busy: "save", error: "" });
      setRoutineEditor((current) => ({ ...current, error: "" }));
      try {
        await routineControl("save", draft, routineEditor.revision);
        setRoutineEditor({ open: false, mode: "create", id: null, revision: null, error: "" });
      } catch (error) {
        setRoutineEditor((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
      } finally {
        setRoutineControlState({ busy: "", error: "" });
      }
    };
    const runRoutineAction = async (action, routine) => {
      if (!routineControl || !controlAvailable || catalogWriteDisabled || !routine?.id) return false;
      setRoutineControlState({ busy: `${action}:${routine.id}`, error: "" });
      try {
        await routineControl(action, { id: routine.id });
        if (action === "delete") setRoutineEditor((current) => current.id === routine.id
          ? { open: false, mode: "create", id: null, revision: null, error: "" } : current);
      } catch (error) {
        setRoutineControlState({ busy: "", error: error instanceof Error ? error.message : String(error) });
        return false;
      }
      setRoutineControlState({ busy: "", error: "" });
      return true;
    };
    const requestRoutineDelete = (routine) => {
      if (!routine) return;
      setRoutineConfirmation({ id: routine.id });
      setRoutineControlState({ busy: "", error: "" });
    };
    const requestSessionStop = (item) => {
      if (!item || !controlAvailable || catalogWriteDisabled) return;
      setSessionStop(item);
      setSessionStopState({ busy: false, error: "" });
    };
    const openSectionCreate = (itemId = "") => {
      setSectionState({ busy: "", error: "" });
      setSectionDialog({ mode: "create", itemId: itemId || "", initialName: "" });
    };
    const openSectionRename = (section) => {
      if (!section) return;
      setSectionState({ busy: "", error: "" });
      setSectionDialog({ mode: "rename", id: section.id, initialName: section.name });
    };
    const runSectionControl = async (action, input, busyKey = action, revisionOverride) => {
      if (!sectionControlAvailable || catalogWriteDisabled) {
        setSectionState({ busy: "", error: t("sectionControlUnavailable") });
        return null;
      }
      setSectionState({ busy: busyKey, error: "" });
      try {
        const result = await sectionControl(action, input, revisionOverride ?? catalogSnap?.revision);
        setSectionState({ busy: "", error: "" });
        return result;
      } catch (error) {
        setSectionState({ busy: "", error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    };
    const submitSection = async (name) => {
      if (!sectionDialog) return;
      const dialog = sectionDialog;
      if (dialog.mode === "create") {
        const result = await runSectionControl("create", { name: name.trim() }, "create");
        if (!result) return;
        const createdId = String(result?.section?.id
          ?? result?.view?.value?.sections?.find((section) => String(section?.name ?? "").trim() === name.trim())?.id
          ?? "").trim();
        setSectionDialog(null);
        if (createdId && dialog.itemId) {
          await runSectionControl("assign", { itemId: dialog.itemId, sectionId: createdId }, "assign", result?.view?.revision);
        }
        return;
      }
      const result = await runSectionControl("rename", { id: dialog.id, name: name.trim() }, "rename");
      if (result) setSectionDialog(null);
    };
    const moveSection = (section, delta) => {
      if (!section) return;
      void runSectionControl("move", { id: section.id, delta }, `move:${section.id}`);
    };
    const assignItemToSection = (item, sectionId) => {
      if (!item) return;
      void runSectionControl("assign", { itemId: item.id, sectionId: sectionId || "" }, `assign:${item.id}`);
    };
    const deleteSection = async (section) => {
      if (!section) return;
      const result = await runSectionControl("delete", { id: section.id }, `delete:${section.id}`);
      if (!result) return;
      const snapshot = sectionUndoSnapshot(result);
      setSectionUndo(snapshot ? { snapshot, name: section.name } : null);
    };
    const restoreSection = async () => {
      if (!sectionUndo?.snapshot) return;
      const result = await runSectionControl("restore", { snapshot: sectionUndo.snapshot }, "restore");
      if (result) setSectionUndo(null);
    };
    const memberName = (member) => {
      const item = items.find((entry) => entry.id === member?.botId || entry.sessionId === member?.sessionId);
      return item ? displayName(item) : (member?.displayName || member?.botId || member?.sessionId || t("taskNone"));
    };
    const memberErrorText = (member) => {
      if (!member?.lastError) return "";
      if (typeof member.lastError === "object") return String(member.lastError.message ?? member.lastError.code ?? "");
      return String(member.lastError);
    };
    const groupRuntimeFor = (item) => groupRuntime?.byRoomId?.[item?.id];
    const renderGroupRuntime = (item, panel = false) => {
      if (item?.kind !== "room") return null;
      const runtime = groupRuntimeFor(item);
      if (!runtime || runtime.status === "loading" && !runtime.value) {
        return h("div", { className: "dshbot-group-runtime", role: "status" }, t("groupRuntimeLoading"));
      }
      if (runtime.status !== "ready" && !runtime.value) {
        return h("div", { className: "dshbot-group-runtime", role: "status" }, `${runtime.status === "unavailable" ? t("groupRuntimeUnavailable") : t("groupRuntimeError")}${runtime.error ? `: ${runtime.error}` : ""}`);
      }
      const members = groupRuntimeMembers(runtime.value);
      if (members.length === 0) return h("div", { className: "dshbot-group-runtime", role: "status" }, t("groupRuntimeNoMembers"));
      return h("div", { className: panel ? "dshbot-group-runtime-members" : "dshbot-group-runtime" }, members.map((member, index) => {
        const indicator = groupMemberIndicator(member, t);
        const sessionId = member?.sessionId;
        const interaction = interactionForSession(pendingSnapshot, sessionId);
        const interactionText = interactionLabel(t, interaction);
        const actionable = Boolean(interaction && typeof interaction.answer === "function");
        const body = h("div", { className: panel ? "dshbot-group-runtime-member-body" : "dshbot-group-runtime-row" },
          h("span", { className: panel ? "dshbot-group-runtime-member-name" : "dshbot-group-runtime-name" }, memberName(member)),
          h("span", {
            className: panel ? "dshbot-group-runtime-member-status" : "dshbot-group-runtime-status",
            "data-state": indicator.state,
          }, interactionText ? `${interactionText} · ${indicator.label}` : indicator.label),
          panel && memberErrorText(member) ? h("span", { className: "dshbot-group-runtime-member-error" }, memberErrorText(member)) : null,
          panel && !sessionId ? h("span", { className: "dshbot-group-runtime-member-error" }, t("groupMemberSessionUnavailable")) : null,
          panel && actionable ? h(GroupPendingInteraction, { interaction, t, key: interaction.key }) : null,
        );
        return panel
          ? h("div", { className: "dshbot-group-runtime-member", key: `${sessionId || member?.botId || index}` },
            body,
            !actionable ? h(Button, {
              variant: "ghost",
              size: "sm",
              "aria-label": `${t("groupHandle")}: ${memberName(member)}${sessionId ? "" : ` (${t("groupMemberSessionUnavailable")})`}`,
              disabled: !sessionId || typeof openSession !== "function" || Boolean(contactBusy[`open:${sessionId}`]),
              loading: Boolean(contactBusy[`open:${sessionId}`]),
              onClick: () => { void runContactAction("open", sessionId, `${t("groupHandle")}: ${memberName(member)}`, () => openSession(sessionId)); },
            }, t("groupHandle")) : null,
          )
          : h("div", { className: "dshbot-group-runtime-row", key: `${sessionId || member?.botId || index}` }, body);
      }));
    };
    const activeRoom = items.find((item) => item.kind === "room" && item.sessionId === currentId);
    const activeRoomRuntime = activeRoom ? groupRuntimeFor(activeRoom) : null;
    const activeRoomNeedsAttention = groupRuntimeMembers(activeRoomRuntime?.value).some((member) => {
      const indicator = groupMemberIndicator(member, t);
      return Boolean(
        interactionForSession(pendingSnapshot, member?.sessionId)
        || memberErrorText(member)
        || !member?.sessionId
        || indicator.state === "error"
        || indicator.state === "timeout"
        || indicator.state === "capped"
      );
    });
    const groupRuntimePanel = activeRoom && activeRoomNeedsAttention ? h("div", {
      className: "dshbot-group-runtime-panel",
      role: "region",
      "aria-label": `${t("groupRuntime")}: ${activeRoom.name}`,
    },
      h("div", { className: "dshbot-group-runtime-panel-heading" }, h("span", null, t("groupRuntime")), h("span", null, activeRoom.name)),
      renderGroupRuntime(activeRoom, true),
    ) : null;
    const executeSessionStop = async () => {
      if (!sessionStop || !stopBot || !controlAvailable || catalogWriteDisabled) return;
      setSessionStopState({ busy: true, error: "" });
      try {
        await stopBot(sessionStop.id);
        setSessionStop(null);
      } catch (error) {
        setSessionStopState({ busy: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      setSessionStopState({ busy: false, error: "" });
    };
    const taskParticipant = (label, id, historicalName) => {
      const participantId = String(id ?? "").trim();
      const participant = items.find((item) => item.id === participantId && item.kind === "bot");
      const sessionId = typeof participant?.sessionId === "string" ? participant.sessionId.trim() : "";
      const usable = Boolean(participant && sessionId);
      const name = participant ? displayName(participant) : (historicalName || participantId || t("taskNone"));
      return h("div", { className: "dshbot-task-participant", key: label },
        h(AvatarView, {
          avatar: participant?.avatar,
          seed: participant?.id || participantId || name,
          size: 24,
          live: false,
        }),
        h("span", { className: "dshbot-task-participant-name" }, `${label}: ${name}`),
        usable
          ? h(Button, {
            variant: "ghost",
            size: "sm",
            title: t("openConversation"),
            "aria-label": `${t("openConversation")}: ${name}`,
            onClick: () => {
              setTaskDetailId("");
              void runContactAction("open", participant.id, `${t("openConversation")}: ${name}`, () => openItem(participant));
            },
          }, t("openConversation"))
          : h("span", {
            className: "dshbot-task-event-meta",
            title: t("participantMissing"),
            "aria-label": `${t("participantUnavailable")}: ${name}`,
          }, t("participantUnavailable")),
      );
    };
    const selectedTaskStatus = String(selectedTask?.status ?? "");
    const taskActionDisabled = (action) => catalogWriteDisabled
      || Boolean(taskControlState.busy)
      || (action === "retry" ? typeof retryTask !== "function" : !controlAvailable || typeof taskControl !== "function");
    const taskActionButton = (label, icon, action, confirm = false) => h(Tooltip, {
      key: action,
      label,
      side: "bottom",
      delayMs: 400,
      disabled: taskActionDisabled(action),
    }, h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
      variant: "ghost",
      size: "sm",
      icon: h(icon, { size: 16 }),
      "aria-label": label,
      title: label,
      disabled: taskActionDisabled(action),
      loading: taskControlState.busy === action,
        onClick: () => requestTaskControl(action, selectedTask),
    })));
    const taskActions = selectedTask
      ? [
        selectedTaskStatus === "queued" ? taskActionButton(t("taskPause"), IconPauseOutline16, "pause") : null,
        selectedTaskStatus === "paused" ? taskActionButton(t("taskResume"), IconPlayOutline16, "resume") : null,
        ["queued", "paused", "delivered"].includes(selectedTaskStatus)
          ? taskActionButton(t("taskCancel"), IconStopFill16, "cancel", true) : null,
        ["failed", "cancelled"].includes(selectedTaskStatus) && typeof retryTask === "function"
          ? taskActionButton(t("taskRetry"), IconPlayOutline16, "retry") : null,
      ].filter(Boolean)
      : [];
    const taskDetail = selectedTask
      ? h(Modal, {
        open: true,
        onClose: () => {
          if (!taskConfirmation && !taskControlState.busy) setTaskDetailId("");
        },
        title: t("taskDetails"),
        closeLabel: t("close"),
        className: "dshbot-task-modal",
        footer: h("div", { className: "dshbot-footer" },
          taskActions.length > 0 ? h("div", { className: "dshbot-task-actions" }, taskActions) : null,
          h(Button, {
            variant: "outline",
            "aria-label": t("close"),
            disabled: Boolean(taskControlState.busy),
            onClick: () => {
              if (taskConfirmation?.action === "retry") discardRetryOperation(taskConfirmation.taskId);
              setTaskConfirmation(null);
              setTaskDetailId("");
            },
          }, t("close")),
        ),
      },
        h("div", { className: "dshbot-task-detail" },
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskId")),
            h("div", { className: "dshbot-task-value" }, String(selectedTask.id || t("taskNone"))),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskParticipants")),
            h("div", { className: "dshbot-task-participant-list" },
              taskParticipant(t("taskSender"), selectedTask.fromId, selectedTask.fromName),
              taskParticipant(t("taskRecipient"), selectedTask.toId, selectedTask.toName),
            ),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskStatusFilter")),
            h("div", { className: "dshbot-task-value" }, taskStatusLabel(t, selectedTask.status)),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskBody")),
            h("div", { className: "dshbot-task-value" }, selectedTask.task || t("taskNone")),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskConstraints")),
            Array.isArray(selectedTask.constraints) && selectedTask.constraints.length > 0
              ? h("ul", { className: "dshbot-task-value" }, selectedTask.constraints.map((value, index) => h("li", { key: `${index}:${value}` }, value)))
              : h("div", { className: "dshbot-task-value" }, t("taskNone")),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskSuccessCriteria")),
            h("div", { className: "dshbot-task-value" }, selectedTask.successCriteria || t("taskNone")),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskResult")),
            h("div", { className: "dshbot-task-value" }, selectedTask.resultSummary || t("taskNone")),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskError")),
            h("div", { className: "dshbot-task-value" }, selectedTask.error || t("taskNone")),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskCreatedAt")),
            h("div", { className: "dshbot-task-value" }, taskTimestamp(selectedTask.createdAt) || t("taskNone")),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskUpdatedAt")),
            h("div", { className: "dshbot-task-value" }, taskTimestamp(selectedTask.updatedAt) || t("taskNone")),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskAttempts")),
            h("div", { className: "dshbot-task-value" }, Number.isFinite(Number(selectedTask.attempts)) ? String(selectedTask.attempts) : t("taskNone")),
          ),
          h("div", { className: "dshbot-task-field" },
            h("div", { className: "dshbot-task-label" }, t("taskEvents")),
            Array.isArray(selectedTask.events) && selectedTask.events.length > 0
              ? h("div", { className: "dshbot-task-event-list" }, selectedTask.events.map((event, index) => h("div", { className: "dshbot-task-event", key: `${event.type || "event"}:${event.at || index}:${index}` },
                h("div", { className: "dshbot-task-event-meta" }, [event.type, event.actorId, taskTimestamp(event.at)].filter(Boolean).join(" · ") || t("taskNone")),
                h("div", { className: "dshbot-task-event-detail" }, event.detail || t("taskNone")),
              )))
              : h("div", { className: "dshbot-task-value" }, t("taskNone")),
          ),
        ),
      )
      : null;

    const contextItem = menu ? items.find((entry) => entry.id === menu.itemId) : undefined;
    const contextSession = contextItem?.sessionId ? sessions?.byId?.[contextItem.sessionId] : undefined;
    const renderContactRow = (item) => {
      const session = sessions?.byId?.[item.sessionId];
      const isRoom = item.kind === "room";
      const activity = activityState.byId?.[item.id];
      const preview = activity?.workSummary || activity?.preview || (isRoom ? "" : (item.model?.model || t("noModel")));
      const active = currentId === item.sessionId;
      const indicator = sessionIndicator(session, activity, t, active);
      const name = displayName(item);
      const address = identityAddress(item);
      const statusDescription = indicator?.label || "";
      const accessibleName = [name, address, statusDescription].filter(Boolean).join(" · ");
      return h("button", {
        key: item.id,
        type: "button",
        className: "dshbot-row",
        "aria-label": accessibleName,
        "aria-description": statusDescription || undefined,
        title: accessibleName,
        "data-active": active ? "true" : undefined,
        "aria-current": active ? "true" : undefined,
        "aria-busy": Boolean(contactBusy[`open:${item.id}`]),
        disabled: Boolean(contactBusy[`open:${item.id}`]),
        onClick: () => { void runContactAction("open", item.id, `${t("openConversation")}: ${name}`, () => openItem(item)); },
        onContextMenu: (event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, itemId: item.id });
        },
      },
        h("span", {
          className: "dshbot-avatar-slot",
          "data-kind": isRoom ? "room" : undefined,
        },
          h(AvatarView, {
            avatar: item.avatar,
            name,
            seed: item.id || stableName(item),
            thinking: indicator?.state === "running",
            active,
            size: 32,
          }),
          isRoom ? h("span", { className: "dshbot-badge" }, t("roomBadge")) : null,
          indicator ? h("span", {
            className: "dshbot-activity-dot",
            "data-state": indicator.state,
            title: indicator.label,
            "aria-label": indicator.label,
            "aria-hidden": "true",
          }) : null,
        ),
        h("span", { className: "dshbot-row-body" },
          h("span", { className: "dshbot-row-top" },
            h("span", { className: "dshbot-name" }, name),
            address ? h("span", { className: "dshbot-address", title: address }, address) : null,
            h("span", { className: "dshbot-time" }, formatTime(contactActivityAt(item, session, activity))),
          ),
          preview ? h("span", { className: "dshbot-preview" }, preview) : null,
          renderGroupRuntime(item),
        ),
      );
    };
    const renderSectionBlock = (block) => {
      const key = block.id || "unassigned";
      const collapsed = collapsedSections.has(key);
      const section = block.id ? sections.find((entry) => entry.id === block.id) : null;
      const sectionIndex = section ? sections.findIndex((entry) => entry.id === section.id) : -1;
      const sectionMenuItems = section ? [
        { id: "rename", label: t("sectionRename"), icon: h(IconEditOutline16, { size: 16 }), disabled: !sectionControlAvailable || catalogWriteDisabled },
        { id: "move-up", label: t("sectionMoveUp"), disabled: !sectionControlAvailable || catalogWriteDisabled || sectionIndex <= 0 },
        { id: "move-down", label: t("sectionMoveDown"), disabled: !sectionControlAvailable || catalogWriteDisabled || sectionIndex < 0 || sectionIndex >= sections.length - 1 },
        { type: "separator", id: "section-separator" },
        { id: "delete", label: t("sectionDelete"), icon: h(IconTrashOutline16, { size: 16 }), danger: true, disabled: !sectionControlAvailable || catalogWriteDisabled },
      ] : [];
      return h("section", {
        key,
        className: "dshbot-section",
        "data-section-id": block.id || "unassigned",
      },
        h("div", { className: "dshbot-section-header" },
          h("button", {
            type: "button",
            className: "dshbot-section-toggle",
            "aria-expanded": collapsed ? "false" : "true",
            "aria-controls": `dshbot-section-items-${key}`,
            onClick: () => setCollapsedSections((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key); else next.add(key);
              return next;
            }),
          },
            h("span", { "aria-hidden": "true" }, collapsed ? "▸" : "▾"),
            h("span", { className: "dshbot-section-toggle-label" }, block.name),
            h("span", { className: "dshbot-section-count" }, String(block.items.length)),
          ),
          section ? h(Menu, {
            open: sectionMenuOpen === section.id,
            portal: true,
            align: "end",
            onClose: () => setSectionMenuOpen(""),
            onSelect: (id) => {
              setSectionMenuOpen("");
              if (id === "rename") openSectionRename(section);
              if (id === "move-up") moveSection(section, -1);
              if (id === "move-down") moveSection(section, 1);
              if (id === "delete") void deleteSection(section);
            },
            items: sectionMenuItems,
            anchor: h(Button, {
              variant: "ghost",
              size: "sm",
              className: "dshbot-section-menu",
              "aria-label": `${t("sectionOptions")}: ${section.name}`,
              title: t("sectionOptions"),
              disabled: sectionState.busy !== "" && sectionState.busy.includes(section.id),
              loading: sectionState.busy !== "" && sectionState.busy.includes(section.id),
              icon: h(IconEllipsisOutline16, { size: 16 }),
              onClick: () => setSectionMenuOpen((current) => current === section.id ? "" : section.id),
            }),
          }) : null,
        ),
        collapsed ? null : h("div", {
          id: `dshbot-section-items-${key}`,
          className: "dshbot-section-items",
          role: "list",
        }, block.items.length > 0
          ? block.items.map(renderContactRow)
          : h("div", { className: "dshbot-section-empty", role: "status" }, t("sectionEmpty"))),
      );
    };
    const contextMoveItems = contextItem ? [
      { id: "assign:", label: t("unassigned"), disabled: !sectionControlAvailable || catalogWriteDisabled || !itemSectionId(contextItem) },
      ...sections.map((section) => ({
        id: `assign:${section.id}`,
        label: section.name,
        disabled: !sectionControlAvailable || catalogWriteDisabled || itemSectionId(contextItem) === section.id,
      })),
      { id: "create-section", label: t("newSection"), disabled: !sectionControlAvailable || catalogWriteDisabled },
    ] : [];
    const contactPanel = h("div", {
      id: "dshbot-contacts-panel",
      role: "tabpanel",
      "aria-labelledby": "dshbot-contacts-tab",
      hidden: view !== "contacts",
    },
      h("div", { className: "dshbot-toolbar" },
        h(Input, {
          className: "dshbot-search",
          value: query,
          placeholder: t("search"),
          "aria-label": t("search"),
          icon: h(IconSearchOutline16, { size: 16 }),
          onChange: (event) => setQuery(event.target.value),
        }),
        h(Button, {
          variant: "ghost",
          size: "sm",
          className: "dshbot-toolbar-action",
          "aria-label": showHidden ? t("hideHidden") : t("showHidden"),
          onClick: () => setShowHidden((value) => !value),
        }, showHidden ? t("hideHidden") : t("showHidden")),
        h(Menu, {
          open: filterOpen,
          portal: true,
          align: "end",
          selectedIds: [`kind:${kindFilter}`, `activity:${activityFilter}`, `source:${sourceFilter}`],
          onClose: () => setFilterOpen(false),
          onSelect: (id) => {
            if (id.startsWith("kind:")) setKindFilter(id.slice(5));
            if (id.startsWith("activity:")) setActivityFilter(id.slice(9));
            if (id.startsWith("source:")) setSourceFilter(id.slice(7));
          },
          items: [
            { type: "label", id: "filter-kind-label", text: t("filterKind") },
            { id: "kind:all", label: t("filterAll") },
            { id: "kind:bots", label: t("filterBots") },
            { id: "kind:groups", label: t("filterGroups") },
            { type: "separator", id: "filter-kind-separator" },
            { type: "label", id: "filter-activity-label", text: t("filterActivity") },
            { id: "activity:all", label: t("filterAll") },
            { id: "activity:active", label: t("filterActive") },
            { id: "activity:recent", label: t("filterRecent") },
            { id: "activity:older", label: t("filterOlder") },
            ...(sourceChoices.length >= 2 ? [
              { type: "separator", id: "filter-source-separator" },
              { type: "label", id: "filter-source-label", text: t("filterSource") },
              { id: "source:all", label: t("filterAllSources") },
              ...sourceChoices.map((source) => ({ id: `source:${source.id}`, label: source.label })),
            ] : []),
          ],
          anchor: h(Button, {
            variant: "ghost",
            size: "sm",
            className: "dshbot-toolbar-action dshbot-filter-button",
            "data-active": activeFilterCount > 0 ? "true" : "false",
            title: t("filter"),
            "aria-label": activeFilterCount > 0 ? `${t("filter")} (${activeFilterCount})` : t("filter"),
            icon: h(IconEllipsisOutline16, { size: 16 }),
            onClick: () => setFilterOpen((value) => !value),
          }),
        }),
        h(Menu, {
          open: plusOpen,
          portal: true,
          align: "end",
          onClose: () => setPlusOpen(false),
          onSelect: (id) => {
            setPlusOpen(false);
            if (catalogWriteDisabled) return;
            if (id === "bot") addBot();
            if (id === "room") createRoom();
            if (id === "section") openSectionCreate();
          },
          items: [
            { id: "bot", label: t("addBot"), disabled: catalogWriteDisabled },
            {
              id: "room",
              label: t("addRoom"),
              disabled: catalogWriteDisabled || items.filter((item) => item.kind !== "room").length < GROUP_MIN_MEMBERS,
            },
            { type: "separator", id: "add-separator" },
            { id: "section", label: t("newSection"), disabled: catalogWriteDisabled || !sectionControlAvailable },
          ],
          anchor: h(Button, {
            variant: "ghost",
            size: "sm",
            title: t("add"),
            "aria-label": t("add"),
            disabled: catalogWriteDisabled,
            icon: h(IconPlusOutline16, { size: 16 }),
            onClick: () => setPlusOpen(true),
          }),
        }),
      ),
      visibleMissedRoutines.length > 0 ? h("div", { className: "dshbot-state dshbot-missed-banner", role: "status" },
        h("span", null, t("routinesMissed").replace("{count}", String(visibleMissedRoutines.length))),
        h(Button, {
          variant: "ghost",
          size: "sm",
          "aria-label": t("routinesMissedDismiss"),
          onClick: () => {
            for (const id of visibleMissedRoutines) dismissedRoutineBanners.add(id);
            setMissedRoutineIds((current) => current.filter((id) => !dismissedRoutineBanners.has(id)));
          },
        }, t("routinesMissedDismiss")),
      ) : null,
      groupRuntimePanel,
      !catalogReady
        ? null
        : visible.length === 0 && sectionBlocks.length === 0
          ? h("div", { className: "dshbot-empty" }, t("empty"), h("div", { className: "dshbot-hint" }, t("emptyHint")))
          : h("div", { className: "dshbot-section-list" }, sectionBlocks.map(renderSectionBlock)),
      h(Menu, {
        open: menu !== null,
        portal: true,
        getAnchorRect: () => (menu ? new DOMRect(menu.x, menu.y, 0, 0) : null),
        onClose: () => setMenu(null),
        onSelect: (id) => {
          const item = items.find((entry) => entry.id === menu?.itemId);
          setMenu(null);
          if (!item) return;
          if (id === "edit") openEditor(item.id);
          if (catalogWriteDisabled && id !== "edit") return;
          if (id === "duplicate") void runContactAction(id, item.id, `${t("duplicate")}: ${displayName(item)}`, () => duplicateItem(item.id));
          if (id === "pin") void runContactAction(id, item.id, `${itemPinnedLabel(items, item.id, t)}: ${displayName(item)}`, () => togglePin(item.id));
           if (id === "hide") void runContactAction(id, item.id, `${itemHiddenLabel(items, item.id, t)}: ${displayName(item)}`, () => toggleHide(item.id));
           if (id === "delete") requestDelete(item.id);
           if (id === "stop") requestSessionStop(item);
           if (id === "create-section") openSectionCreate(item.id);
           else if (id === "assign:") assignItemToSection(item, "");
           else if (id.startsWith("assign:")) assignItemToSection(item, id.slice("assign:".length));
        },
        items: [
          { id: "edit", label: t("edit"), icon: h(IconEditOutline16, { size: 16 }) },
          { id: "duplicate", label: t("duplicate"), disabled: catalogWriteDisabled, icon: h(IconCopyOutline16, { size: 16 }) },
          {
            id: "pin",
            label: itemPinnedLabel(items, menu?.itemId, t),
            disabled: catalogWriteDisabled,
          },
          {
            id: "hide",
            label: itemHiddenLabel(items, menu?.itemId, t),
            disabled: catalogWriteDisabled,
          },
          {
            id: "move-section",
            label: t("moveToSection"),
            disabled: catalogWriteDisabled || !sectionControlAvailable,
            submenu: contextMoveItems,
          },
          { type: "separator", id: "sep" },
          {
            id: "stop",
            label: t("sessionStop"),
            disabled: catalogWriteDisabled || !controlAvailable || contextSession?.running !== true,
            icon: h(IconStopFill16, { size: 16 }),
          },
          { type: "separator", id: "sep-delete" },
          { id: "delete", label: t("delete"), disabled: catalogWriteDisabled, danger: true, icon: h(IconTrashOutline16, { size: 16 }) },
        ],
        anchor: h("span"),
      }),
    );

    const taskPanel = h("div", {
      id: "dshbot-tasks-panel",
      role: "tabpanel",
      "aria-labelledby": "dshbot-tasks-tab",
      hidden: view !== "tasks",
    },
      h("div", { className: "dshbot-task-toolbar" },
        h(Input, {
          className: "dshbot-task-search",
          value: taskQuery,
          placeholder: t("taskSearch"),
          "aria-label": t("taskSearch"),
          icon: h(IconSearchOutline16, { size: 16 }),
          onChange: (event) => setTaskQuery(event.target.value),
        }),
        h(SettingsSelect, {
          className: "dshbot-task-filter",
          variant: "block",
          value: taskStatus,
          options: taskStatusOptions,
          "aria-label": t("taskStatusFilter"),
          onChange: setTaskStatus,
        }),
      ),
      !catalogReady
        ? null
        : tasks.length === 0
          ? h("div", { className: "dshbot-empty" }, t("taskEmpty"))
          : visibleTasks.length === 0
            ? h("div", { className: "dshbot-empty" }, t("taskNoMatch"))
            : h("div", { className: "dshbot-task-list", role: "list" },
              visibleTasks.map((task) => {
                const fromItem = items.find((item) => item.id === task.fromId);
                const toItem = items.find((item) => item.id === task.toId);
                const from = fromItem ? displayName(fromItem) : (task.fromName || task.fromId || t("taskNone"));
                const to = toItem ? displayName(toItem) : (task.toName || task.toId || t("taskNone"));
                const summary = taskSummary(task) || t("taskNone");
                return h("div", { key: task.id, role: "listitem" },
                  h("button", {
                    type: "button",
                    className: "dshbot-task-row",
                    "aria-label": `${taskStatusLabel(t, task.status)}: ${task.id || t("taskNone")}`,
                    onClick: () => setTaskDetailId(task.id),
                  },
                    h("span", { className: "dshbot-task-row-head" },
                      h("span", { className: "dshbot-task-status" }, taskStatusLabel(t, task.status)),
                      h("span", { className: "dshbot-task-id" }, task.id || t("taskNone")),
                      h("span", { className: "dshbot-task-time" }, formatTime(task.updatedAt)),
                    ),
                    h("span", { className: "dshbot-task-participants" }, `${from} → ${to}`),
                    h("span", { className: "dshbot-task-summary" }, summary),
                  ),
                );
              }),
            ),
    );

    const routinePanel = h("div", {
      id: "dshbot-routines-panel",
      role: "tabpanel",
      "aria-labelledby": "dshbot-routines-tab",
      hidden: view !== "routines",
    },
      h("div", { className: "dshbot-routine-toolbar" },
        h(Input, {
          className: "dshbot-routine-search",
          value: routineQuery,
          placeholder: t("routineSearch"),
          "aria-label": t("routineSearch"),
          icon: h(IconSearchOutline16, { size: 16 }),
          onChange: (event) => setRoutineQuery(event.target.value),
        }),
        h(Tooltip, { label: t("routineAdd"), side: "bottom", delayMs: 400, disabled: catalogWriteDisabled || !controlAvailable },
          h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
            variant: "ghost",
            size: "sm",
            icon: h(IconPlusOutline16, { size: 16 }),
            "aria-label": t("routineAdd"),
            title: t("routineAdd"),
            disabled: catalogWriteDisabled || !controlAvailable,
            onClick: () => openRoutineEditor("create", null),
          }))),
      ),
      !catalogReady
        ? null
        : routines.length === 0
          ? h("div", { className: "dshbot-empty" }, t("routineEmpty"))
          : visibleRoutines.length === 0
            ? h("div", { className: "dshbot-empty" }, t("routineNoMatch"))
            : h("div", { className: "dshbot-routine-list", role: "list" },
              visibleRoutines.map((routine) => {
                const bot = items.find((item) => item.id === routine.botId && item.kind !== "room");
                const busy = routineControlState.busy;
                const rowBusy = Boolean(busy && busy.endsWith(`:${routine.id}`));
                const outcome = routineOutcomeLabel(t, routine.lastOutcome);
                const history = routineHistoryRows(routine);
                const historyOpen = routineDetailId === routine.id;
                const historyPanel = historyOpen ? h("div", {
                  className: "dshbot-routine-history",
                  role: "region",
                  "aria-label": `${t("routineHistory")}: ${routine.name || routine.id}`,
                },
                  h("div", { className: "dshbot-routine-history-heading" }, t("routineHistory")),
                  history === null
                    ? h("div", { className: "dshbot-routine-history-empty", role: "status" }, t("routineHistoryUnavailable"))
                    : history.length === 0
                      ? h("div", { className: "dshbot-routine-history-empty", role: "status" }, t("routineHistoryEmpty"))
                      : history.map((run, index) => h("div", {
                        className: "dshbot-routine-history-row",
                        key: `${run.runId || "run"}:${index}`,
                      },
                        h("div", { className: "dshbot-routine-history-meta" }, [
                          routineOutcomeLabel(t, run.status) || String(run.status || t("taskNone")),
                          routineRunTriggerLabel(t, run.trigger),
                          run.runId || t("taskNone"),
                        ].filter(Boolean).join(" · ")),
                        h("div", { className: "dshbot-routine-history-meta" }, [
                          `${t("routineRunCreated")}: ${routineTimestamp(run.createdAt) || t("routineNever")}`,
                          run.startedAt ? `${t("routineRunStarted")}: ${routineTimestamp(run.startedAt)}` : null,
                          run.endedAt ? `${t("routineRunEnded")}: ${routineTimestamp(run.endedAt)}` : null,
                        ].filter(Boolean).join(" · ")),
                        run.sessionId ? h("div", { className: "dshbot-routine-history-meta" }, [
                          `${t("routineRunSession")}: ${run.sessionId}`,
                          Number(run.turn) > 0 ? `${t("routineRunTurn")}: ${run.turn}` : null,
                        ].filter(Boolean).join(" · ")) : null,
                        run.error ? h("div", { className: "dshbot-routine-history-error", role: "status" }, run.error) : null,
                      )),
                ) : null;
                return h("div", {
                  key: routine.id,
                  className: "dshbot-routine-row",
                  role: "listitem",
                  "data-error": routine.lastError ? "true" : undefined,
                },
                  h("div", { className: "dshbot-routine-main" },
                    h("div", { className: "dshbot-routine-head" },
                      h("span", { className: "dshbot-routine-name" }, routine.name || routine.id),
                      h("span", { className: "dshbot-routine-status" }, [routineStatusLabel(t, routine), outcome].filter(Boolean).join(" · ")),
                    ),
                    h("div", { className: "dshbot-routine-prompt" }, routine.prompt || t("taskNone")),
                    h("div", { className: "dshbot-routine-meta" }, [
                      `${t("routineBot")}: ${bot ? displayName(bot) : (routine.botId || t("taskNone"))}`,
                      `${t("routineSchedule")}: ${routineDisplaySchedule(routine) || t("taskNone")}`,
                      `${t("routineTimezone")}: ${routine.timezone || routineBrowserTimezone()}`,
                      `${t("routineNextRun")}: ${routineTimestamp(routine.nextRunAt) || t("routineNever")}`,
                      `${t("routineLastRun")}: ${routineTimestamp(routine.lastRunAt) || t("routineNever")}`,
                      `${t("routineRunCount")}: ${Number.isFinite(Number(routine.runCount)) ? routine.runCount : 0}/${Number(routine.maxRuns) > 0 ? routine.maxRuns : t("routineUnlimited")}`,
                    ].join(" · ")),
                    routine.lastError ? h("div", { className: "dshbot-routine-error", role: "status" }, `${t("routineLastError")}: ${routine.lastError}`) : null,
                    historyPanel,
                  ),
                  h("div", { className: "dshbot-routine-actions" },
                    h(Tooltip, { label: t("routineHistory"), side: "bottom", delayMs: 400 },
                      h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
                        variant: "ghost",
                        size: "sm",
                        icon: h(IconClockOutline16, { size: 16 }),
                        "aria-label": `${t("routineHistory")}: ${routine.name || routine.id}`,
                        "aria-expanded": historyOpen ? "true" : "false",
                        title: t("routineHistory"),
                        onClick: () => setRoutineDetailId((current) => current === routine.id ? "" : routine.id),
                      }))),
                    h(Tooltip, { label: routine.enabled ? t("routinePause") : t("routineResume"), side: "bottom", delayMs: 400 },
                      h("span", { className: "dshbot-tooltip-anchor" }, h(Switch, {
                        checked: routine.enabled === true,
                        "aria-label": routine.enabled ? t("routinePause") : t("routineResume"),
                        disabled: catalogWriteDisabled || !controlAvailable || rowBusy,
                        loading: busy === `toggle:${routine.id}`,
                        onChange: () => { void runRoutineAction("toggle", routine); },
                      }))),
                    h(Tooltip, { label: t("routineRunNow"), side: "bottom", delayMs: 400 },
                      h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
                        variant: "ghost",
                        size: "sm",
                        icon: h(IconPlayOutline16, { size: 16 }),
                        "aria-label": t("routineRunNow"),
                        title: t("routineRunNow"),
                        disabled: catalogWriteDisabled || !controlAvailable || rowBusy,
                        loading: busy === `run:${routine.id}`,
                        onClick: () => { void runRoutineAction("run", routine); },
                      }))),
                    h(Tooltip, { label: t("routineEdit"), side: "bottom", delayMs: 400 },
                      h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
                        variant: "ghost",
                        size: "sm",
                        icon: h(IconEditOutline16, { size: 16 }),
                        "aria-label": t("routineEdit"),
                        title: t("routineEdit"),
                        disabled: catalogWriteDisabled || !controlAvailable || rowBusy,
                        onClick: () => openRoutineEditor("edit", routine),
                      }))),
                    h(Tooltip, { label: t("routineDelete"), side: "bottom", delayMs: 400 },
                      h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
                        variant: "ghost",
                        size: "sm",
                        icon: h(IconTrashOutline16, { size: 16 }),
                        "aria-label": t("routineDelete"),
                        title: t("routineDelete"),
                        disabled: catalogWriteDisabled || !controlAvailable || rowBusy,
                        onClick: () => requestRoutineDelete(routine),
                      }))),
                  ),
                );
              }),
            ),
    );

    const confirmationTask = taskConfirmation
      ? tasks.find((task) => task.id === taskConfirmation.taskId)
      : undefined;
    const taskConfirmationModal = taskConfirmation && confirmationTask
      ? h(ConfirmActionModal, {
        t,
        open: true,
        title: taskConfirmation.action === "retry" ? t("taskRetry") : t("taskCancel"),
        body: taskConfirmation.action === "retry" ? t("taskRetryConfirm") : t("taskCancelConfirm"),
        caveat: t("taskSideEffectCaveat"),
        confirmLabel: taskConfirmation.action === "retry" ? t("taskRetry") : t("taskCancel"),
        busy: Boolean(taskControlState.busy),
        error: [taskControlState.error, catalogStateText].filter(Boolean).join("\n"),
        feedbackIdentity: taskControlState,
        feedbackLoading: catalogLoading && !taskControlState.error,
        onClose: () => {
          if (taskConfirmation.action === "retry") discardRetryOperation(taskConfirmation.taskId);
          setTaskConfirmation(null);
          setTaskControlState({ busy: "", error: "" });
        },
        onConfirm: () => { void executeTaskControl(taskConfirmation.action, confirmationTask, taskConfirmation.operationId); },
      })
      : null;
    const confirmationRoutine = routineConfirmation
      ? routines.find((routine) => routine.id === routineConfirmation.id)
      : undefined;
    const routineConfirmationModal = routineConfirmation && confirmationRoutine
      ? h(ConfirmActionModal, {
        t,
        open: true,
        title: t("routineDelete"),
        body: t("routineDeleteConfirm"),
        caveat: t("routineDeleteCaveat"),
        confirmLabel: t("delete"),
        busy: Boolean(routineControlState.busy),
        error: [routineControlState.error, catalogStateText].filter(Boolean).join("\n"),
        feedbackIdentity: routineControlState,
        feedbackLoading: catalogLoading && !routineControlState.error,
        onClose: () => { setRoutineConfirmation(null); setRoutineControlState({ busy: "", error: "" }); },
        onConfirm: async () => {
          if (await runRoutineAction("delete", confirmationRoutine)) setRoutineConfirmation(null);
        },
      })
      : null;
    const sessionStopModal = sessionStop
      ? h(ConfirmActionModal, {
        t,
        open: true,
        title: t("sessionStop"),
        body: `${t("sessionStopConfirm")} ${sessionStop.name || sessionStop.id}`,
        caveat: t("sessionStopCaveat"),
        confirmLabel: t("sessionStop"),
        busy: sessionStopState.busy,
        error: [sessionStopState.error, catalogStateText].filter(Boolean).join("\n"),
        feedbackIdentity: sessionStopState,
        feedbackLoading: catalogLoading && !sessionStopState.error,
        onClose: () => { setSessionStop(null); setSessionStopState({ busy: false, error: "" }); },
        onConfirm: () => { void executeSessionStop(); },
      })
      : null;

    return h("div", { className: "dshbot-page", "aria-busy": catalogLoading,
      "aria-description": catalogStateText || (!controlAvailable ? t("taskControlUnavailable") : undefined),
      title: catalogStateText || (!controlAvailable ? t("taskControlUnavailable") : undefined) },
      h("div", {
        ref: tabListRef,
        className: "dshbot-view-tabs",
        role: "tablist",
        "aria-label": t("tab"),
        onKeyDown: onTabKeyDown,
      },
        h(Pill, {
          id: "dshbot-contacts-tab",
          "data-dshbot-tab": "contacts",
          role: "tab",
          "aria-controls": "dshbot-contacts-panel",
          "aria-selected": view === "contacts" ? "true" : "false",
          tabIndex: view === "contacts" ? 0 : -1,
          active: view === "contacts",
          onClick: () => switchView("contacts"),
        }, t("contacts")),
        h(Pill, {
          id: "dshbot-tasks-tab",
          "data-dshbot-tab": "tasks",
          role: "tab",
          "aria-controls": "dshbot-tasks-panel",
          "aria-selected": view === "tasks" ? "true" : "false",
          tabIndex: view === "tasks" ? 0 : -1,
          active: view === "tasks",
          onClick: () => switchView("tasks"),
        }, t("tasks")),
        h(Pill, {
          id: "dshbot-routines-tab",
          "data-dshbot-tab": "routines",
          role: "tab",
          "aria-controls": "dshbot-routines-panel",
          "aria-selected": view === "routines" ? "true" : "false",
          tabIndex: view === "routines" ? 0 : -1,
          active: view === "routines",
          onClick: () => switchView("routines"),
        }, t("routines")),
      ),
      h(Feedback, { t,
        text: editor.open || sectionUndo || sectionDialog || routineEditor.open || taskConfirmation || routineConfirmation || sessionStop ? "" : [
          editor.error,
          ...Object.values(contactBusy), contactErrorState.error,
          sectionState.busy.startsWith("assign:") ? t("moveToSection") : "",
          catalogStateText,
          !controlAvailable && catalogReady ? t("taskControlUnavailable") : "",
          taskControlState.error, routineControlState.error, sectionState.error,
        ].filter(Boolean).join("\n"),
        warnings: editor.open || sectionUndo || sectionDialog || routineEditor.open || taskConfirmation || routineConfirmation || sessionStop ? [] : editor.warnings,
        identity: contactErrorState.error ? contactErrorState : taskControlState.error ? taskControlState : routineControlState.error ? routineControlState : sectionState.error ? sectionState : editor.feedbackId,
        loading: Boolean((catalogLoading || Object.keys(contactBusy).length > 0 || sectionState.busy.startsWith("assign:")) && !editor.error && !contactErrorState.error && !taskControlState.error && !routineControlState.error && !sectionState.error),
      }),
      sectionUndo && !editor.open && !sectionDialog && !routineEditor.open && !taskConfirmation && !routineConfirmation && !sessionStop ? h(Toast, {
        text: [`${t("sectionDeleted")} ${sectionUndo.name}`, catalogStateText, editor.error,
          ...Object.values(contactBusy), contactErrorState.error,
          ...(editor.warnings ?? []).map((warning) => `${t("hostWarning")}: ${warning}`), taskControlState.error, routineControlState.error, sectionState.error].filter(Boolean).join("\n"),
        tone: sectionState.busy || Object.keys(contactBusy).length > 0 || contactErrorState.error || sectionState.error || taskControlState.error || routineControlState.error || catalogStateText || editor.error || editor.warnings?.length ? undefined : "success",
        icon: sectionState.busy || Object.keys(contactBusy).length > 0 ? h(StateDot, { state: "ongoing", size: 16 })
          : contactErrorState.error || sectionState.error || taskControlState.error || routineControlState.error || catalogStateText || editor.error || editor.warnings?.length ? h(IconWarningOutline16, { size: 16 }) : undefined,
        holdMs: null,
        actions: [{ label: t("sectionUndo"), onClick: () => { if (!sectionState.busy) void restoreSection(); } }],
        onDone: () => {},
      }) : null,
      contactPanel,
      taskPanel,
      routinePanel,
      taskDetail,
      taskConfirmationModal,
      routineConfirmationModal,
      sessionStopModal,
      h(SectionNameModal, {
        t,
        open: Boolean(sectionDialog),
        mode: sectionDialog?.mode || "create",
        initialName: sectionDialog?.initialName || "",
        busy: Boolean(sectionState.busy),
        error: sectionState.error,
        feedbackIdentity: sectionState,
        stateText: catalogStateText,
        stateLoading: catalogLoading,
        onClose: () => { setSectionDialog(null); setSectionState({ busy: "", error: "" }); },
        onSubmit: (name) => { void submitSection(name); },
      }),
      h(RoutineEditorModal, {
        t,
        open: routineEditor.open,
        mode: routineEditor.mode,
        routine: selectedRoutine,
        items,
        routines,
        getTriggerToken,
        disabled: catalogWriteDisabled || !controlAvailable,
        busy: routineControlState.busy === "save",
        error: routineEditor.error,
        feedbackIdentity: routineEditor,
        stateText: catalogStateText,
        stateLoading: catalogLoading,
        onClose: () => setRoutineEditor({ open: false, mode: "create", id: null, revision: null, error: "" }),
        onSave: saveRoutine,
      }),
    );
  }

  function itemPinnedLabel(items, itemId, t) {
    const item = items.find((entry) => entry.id === itemId);
    return item?.pinned === true ? t("unpin") : t("pin");
  }

  function itemHiddenLabel(items, itemId, t) {
    const item = items.find((entry) => entry.id === itemId);
    return item?.hidden === true ? t("unhide") : t("hide");
  }

  function EditorOverlay(props) {
    const {
      t, useCatalog, useEditor, useSessions, useWorkspaces, closeEditor, saveItem, createBotSubmit, confirmDelete, createRoomSubmit,
      describeCapabilities, getModelCatalog, getMemory, replaceMemory, manageCapabilities,
    } = props;
    const catalogSnap = useCatalog((s) => s);
    const editor = useEditor((s) => s);
    const sessions = useSessions((s) => s);
    const workspaces = useWorkspaces((s) => s);
    const items = catalogItems(catalogSnap);
    const item = items.find((entry) => entry.id === editor.itemId);
    const open = Boolean(editor.open);
    const isRoomCreate = editor.mode === "create-room";
    const isBotCreate = editor.mode === "create-bot";
    const isDelete = editor.mode === "delete";
    const isRoom = isRoomCreate || item?.kind === "room";
    const session = item ? sessions?.byId?.[item.sessionId] : undefined;
    const workspaceLocked = Boolean(item && (item.kind === "room" || session?.blank === false));

    const [name, setName] = useState("");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [workspaceId, setWorkspaceId] = useState("");
    const [provider, setProvider] = useState("");
    const [model, setModel] = useState("");
    const [reasoningEffort, setReasoningEffort] = useState("");
    const [memberIds, setMemberIds] = useState([]);
    const [modelSource, setModelSource] = useState({ status: "idle", value: null, error: "" });
    const [busy, setBusy] = useState(false);
    const [avatar, setAvatar] = useState(null);
    const [avatarErrorState, setAvatarError] = useFeedbackError();
    const [sourcePolicy, setSourcePolicy] = useState("default");
    const [sourceIds, setSourceIds] = useState([]);
    const [capabilities, setCapabilities] = useState(defaultCapabilities());
    const [capabilitySource, setCapabilitySource] = useState({
      status: "idle", value: capabilityCatalog(null), active: false, skillsAvailable: false, error: "",
    });
    const [capabilityManager, setCapabilityManager] = useState({ confirm: null, error: "" });
    const [capabilityBusy, setCapabilityBusy] = useState(false);
    const [capabilityPicker, setCapabilityPicker] = useState(null);
    const [memorySource, setMemorySource] = useState({ status: "idle", value: null, error: "" });
    const [memoryTrack, setMemoryTrack] = useState("bot");
    const [memoryEditingId, setMemoryEditingId] = useState(null);
    const [memoryDraft, setMemoryDraft] = useState("");
    const [memoryBusy, setMemoryBusy] = useState(false);
    const [memoryAction, setMemoryAction] = useState("");
    const [memoryErrorState, setMemoryError] = useFeedbackError();
    const memoryError = memoryErrorState.error;
    const [deleteConfirmed, setDeleteConfirmed] = useState(false);
    const [maxRounds, setMaxRounds] = useState(String(GROUP_DEFAULT_MAX_ROUNDS));
    const [maxSpeaks, setMaxSpeaks] = useState(String(GROUP_DEFAULT_MAX_MEMBER_TURNS));
    const [objective, setObjective] = useState("");
    const [objectiveMaxRounds, setObjectiveMaxRounds] = useState(String(OBJECTIVE_DEFAULT_MAX_ROUNDS));
    const [memoryReview, setMemoryReview] = useState(true);
    const [notifyEnabled, setNotifyEnabled] = useState(true);

    const catalogReady = catalogSnap?.status === "ready";
    const catalogLoading = catalogSnap?.status === "idle" || catalogSnap?.status === "loading";
    const catalogReadOnly = catalogReady && (!catalogSnap.writable || catalogSnap.mode !== "host");
    const catalogUnavailable = !catalogReady && !catalogLoading;
    const catalogWriteDisabled = !catalogReady || catalogReadOnly;

    useEffect(() => {
      if (!open) return;
      setDeleteConfirmed(false);
      setMemoryError("");
      setAvatarError("");
      setCapabilityPicker(null);
      if (isRoomCreate) {
        setName(t("defaultRoomName"));
        setTitle("");
        setDescription("");
        setWorkspaceId("");
        setProvider("");
        setModel("");
        setReasoningEffort("");
        setMemberIds([]);
        setAvatar(null);
        setModelSource({ status: "idle", value: null, error: "" });
        setSourcePolicy("default");
        setSourceIds([]);
        setCapabilities(defaultCapabilities());
        setCapabilitySource({ status: "idle", value: capabilityCatalog(null), active: false, skillsAvailable: false, error: "" });
        setMemorySource({ status: "idle", value: null, error: "" });
        setMemoryTrack("bot");
        setMemoryEditingId(null);
        setMemoryDraft("");
        setMaxRounds(String(GROUP_DEFAULT_MAX_ROUNDS));
        setMaxSpeaks(String(GROUP_DEFAULT_MAX_MEMBER_TURNS));
        setObjective("");
        setObjectiveMaxRounds(String(OBJECTIVE_DEFAULT_MAX_ROUNDS));
        setMemoryReview(true);
        setNotifyEnabled(true);
        return;
      }
      if (isBotCreate) {
        setName(t("defaultBotName"));
        setTitle("");
        setDescription("");
        setWorkspaceId("");
        setProvider("");
        setModel("");
        setReasoningEffort("");
        setMemberIds([]);
        setAvatar(defaultBlobAvatar("new-bot"));
        setModelSource({ status: "idle", value: null, error: "" });
        setSourcePolicy("default");
        setSourceIds([]);
        setCapabilities(defaultCapabilities());
        setCapabilitySource({ status: "idle", value: capabilityCatalog(null), active: false, skillsAvailable: false, error: "" });
        setMemorySource({ status: "idle", value: null, error: "" });
        setMemoryTrack("bot");
        setMemoryEditingId(null);
        setMemoryDraft("");
        setMaxRounds(String(GROUP_DEFAULT_MAX_ROUNDS));
        setMaxSpeaks(String(GROUP_DEFAULT_MAX_MEMBER_TURNS));
        setObjective("");
        setObjectiveMaxRounds(String(OBJECTIVE_DEFAULT_MAX_ROUNDS));
        setMemoryReview(true);
        setNotifyEnabled(true);
        return;
      }
      if (!item) return;
      setName(item.name || "");
      setTitle(item.kind === "room" ? "" : (item.title || ""));
      setDescription(item.description || "");
      setWorkspaceId(item.workspaceId || "");
      setProvider(item.model?.provider || "");
      setModel(item.model?.model || "");
      setReasoningEffort(item.model?.reasoningEffort || "");
      setMemberIds(normalizeRoomMemberIds(item.memberBotIds, items));
      setAvatar(normalizeAvatar(item.avatar, item.id || item.name));
      setModelSource({ status: "idle", value: null, error: "" });
      const storedSourceIds = Array.isArray(item.allowedSenderIds) ? [...new Set(item.allowedSenderIds)] : [];
      setSourceIds(storedSourceIds);
      setSourcePolicy(storedSourceIds.length > 0 ? "selected" : "default");
      setCapabilities(normalizeCapabilities(item.capabilities));
      setCapabilitySource({ status: "idle", value: capabilityCatalog(null), active: false, skillsAvailable: false, error: "" });
      setCapabilityManager({ confirm: null, error: "" });
      setMemorySource({ status: "idle", value: null, error: "" });
      setMemoryTrack("bot");
      setMemoryEditingId(null);
      setMemoryDraft("");
      setMaxRounds(String(Number.isInteger(item.maxRounds) ? item.maxRounds : GROUP_DEFAULT_MAX_ROUNDS));
      setMaxSpeaks(String(Number.isInteger(item.maxSpeaks) ? item.maxSpeaks : GROUP_DEFAULT_MAX_MEMBER_TURNS));
      setObjective(item.kind === "room" ? "" : String(item.objective ?? ""));
      setObjectiveMaxRounds(String(Number.isInteger(item.objectiveMaxRounds) ? item.objectiveMaxRounds : OBJECTIVE_DEFAULT_MAX_ROUNDS));
      setMemoryReview(item.kind === "room" ? true : item.memoryReview !== false);
      setNotifyEnabled(item.kind === "room" ? true : item.notify !== false);
    }, [open, editor.itemId, editor.mode]);

    useEffect(() => {
      if (!open || isRoom || (!item?.id && !isBotCreate)) return undefined;
      let cancelled = false;
      setCapabilitySource((current) => ({ ...current, status: "loading", error: "" }));
      if (typeof describeCapabilities !== "function") {
        setCapabilitySource((current) => ({
          ...current,
          status: "unavailable",
          error: t("profileTransportUnavailable"),
        }));
        return () => { cancelled = true; };
      }
      describeCapabilities(item?.id).then((result) => {
        if (cancelled) return;
        if (!result?.capabilities || typeof result.capabilities !== "object") {
          setCapabilitySource((current) => ({
            ...current,
            status: "unavailable",
            error: t("capabilityUnavailable"),
          }));
          return;
        }
        const available = capabilityCatalog(result?.capabilities);
        setCapabilitySource({
          status: "ready",
          value: available,
          active: result?.capabilities?.active !== false,
          skillsAvailable: result?.capabilities?.skillsAvailable !== false,
          error: "",
        });
      }, (error) => {
        if (cancelled) return;
        setCapabilitySource((current) => ({
          ...current,
          status: "unavailable",
          error: error instanceof Error ? error.message : String(error),
        }));
      });
      return () => { cancelled = true; };
    }, [open, isRoom, isBotCreate, item?.id, describeCapabilities]);

    useEffect(() => {
      if (!open || isRoom) return undefined;
      let cancelled = false;
      setModelSource({ status: "loading", value: null, error: "" });
      if (typeof getModelCatalog !== "function") {
        setModelSource({ status: "unavailable", value: null, error: t("profileTransportUnavailable") });
        return () => { cancelled = true; };
      }
      getModelCatalog().then((response) => {
        if (cancelled) return;
        try {
          const value = rpcValue(response);
          if (!value || !Array.isArray(value.groups)) throw new Error(t("modelCatalogUnavailable"));
          setModelSource({ status: "ready", value, error: "" });
        } catch (error) {
          setModelSource({ status: "unavailable", value: null, error: error instanceof Error ? error.message : String(error) });
        }
      }, (error) => {
        if (!cancelled) setModelSource({ status: "unavailable", value: null, error: error instanceof Error ? error.message : String(error) });
      });
      return () => { cancelled = true; };
    }, [open, isRoom, getModelCatalog]);

    useEffect(() => {
      if (!open || isRoom || isBotCreate || !item?.id) return undefined;
      let cancelled = false;
      setMemorySource({ status: "loading", value: null, error: "" });
      if (typeof getMemory !== "function") {
        setMemorySource({ status: "unavailable", value: null, error: t("profileTransportUnavailable") });
        return () => { cancelled = true; };
      }
      getMemory(item.id).then((result) => {
        if (cancelled) return;
        const value = result?.memory ?? result;
        const trackState = (track) => ({
          entries: normalizeMemoryEntries(track),
          revision: memoryRevision(track),
          text: String(track?.text ?? ""),
        });
        setMemorySource({
          status: "ready",
          value: {
            bot: trackState(value?.bot),
            user: trackState(value?.user),
            limits: { bot: Number(value?.limits?.bot) || 0, user: Number(value?.limits?.user) || 0 },
          },
          error: "",
        });
      }, (error) => {
        if (!cancelled) setMemorySource({
          status: "unavailable",
          value: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return () => { cancelled = true; };
    }, [open, isRoom, isBotCreate, item?.id, getMemory]);

    const workspaceItems = [
      { id: "", label: t("workspaceNone") },
      ...(workspaces?.items ?? []).map((workspace) => ({
        id: workspace.workspaceId,
        label: workspace.title || workspace.path,
      })),
    ];
    const modelCatalogValue = modelSource.value;
    const groups = modelGroups(modelCatalogValue);
    const botChoices = items.filter((entry) => entry.kind === "bot");
    const sourceChoices = botChoices.filter((entry) => entry.id !== item?.id);
    const sourceChoiceIds = new Set(sourceChoices.map((entry) => entry.id));
    const validSourceIds = sourceIds.filter((id) => sourceChoiceIds.has(id));
    const invalidSourceIds = sourceIds.filter((id) => !sourceChoiceIds.has(id));
    const sourceSelectionInvalid = !isRoom
      && sourcePolicy === "selected"
      && (validSourceIds.length === 0 || invalidSourceIds.length > 0);
    const sourceValidationMessage = sourcePolicy === "selected" ? [
      invalidSourceIds.length > 0 ? t("sourceInvalid") : "",
      validSourceIds.length === 0 ? t("sourceNeedOne") : "",
    ].filter(Boolean).join(" ") : "";
    const catalogStateMessage = catalogLoading
      ? t("catalogLoading")
      : catalogUnavailable
        ? t("catalogUnavailableState")
        : catalogReadOnly ? t("catalogReadOnlyState") : "";
    const selectedGroup = modelGroup(modelCatalogValue, provider);
    const selectedModel = modelEntry(modelCatalogValue, provider, model);
    const providerOptions = [
      { id: "", label: t("modelProviderDefault") },
      ...groups.map((group) => ({ id: String(group.id), label: group.name || group.id })),
    ];
    if (provider && !selectedGroup) {
      providerOptions.push({ id: provider, label: `${provider} (${t("modelCatalogUnavailable")})`, disabled: true });
    }
    const modelOptions = [
      { id: "", label: t("modelSelect") },
      ...(selectedGroup?.models ?? []).map((entry) => ({ id: String(entry.id), label: entry.name || entry.id })),
    ];
    if (provider && model && !selectedModel) {
      modelOptions.push({ id: model, label: `${model} (${t("modelCatalogUnavailable")})`, disabled: true });
    }
    const effortOptions = [
      { id: "", label: selectedModel?.reasoning?.defaultEffort
        ? `${t("reasoningDefault")} (${selectedModel.reasoning.defaultEffort})`
        : t("reasoningDefault") },
      ...modelEfforts(selectedModel).map((effort) => ({ id: String(effort.id), label: effort.name || effort.id })),
    ];
    if (reasoningEffort && !modelEfforts(selectedModel).some((effort) => String(effort.id) === String(reasoningEffort))) {
      effortOptions.push({ id: reasoningEffort, label: `${reasoningEffort} (${t("modelCatalogUnavailable")})`, disabled: true });
    }
    const modelCatalogStateMessage = modelSource.status === "loading" || modelSource.status === "idle"
      ? t("modelCatalogLoading")
      : modelSource.status !== "ready"
        ? `${t("modelCatalogUnavailable")}${modelSource.error ? `: ${modelSource.error}` : ""}`
        : "";
    const modelSelectionInvalid = modelSource.status === "ready" && Boolean(
      (provider && !selectedGroup)
      || (model && !selectedModel)
      || (reasoningEffort && !modelEfforts(selectedModel).some((effort) => String(effort.id) === String(reasoningEffort))),
    );
    const discoveredCapabilities = capabilitySource.value;
    const capabilitySelectedInvalid = capabilitySource.status === "ready"
      && !capabilitySelectedNamesAreValid(capabilities, discoveredCapabilities);
    const capabilityStateMessage = capabilitySource.status === "loading" || capabilitySource.status === "idle"
      ? t("capabilityLoad")
      : capabilitySource.status !== "ready"
        ? `${t("capabilityUnavailable")}${capabilitySource.error ? `: ${capabilitySource.error}` : ""}`
        : capabilitySource.active === false
          ? t("capabilityInactive")
          : capabilitySource.skillsAvailable === false ? t("capabilitySkillsUnavailable") : "";
    const maxRoundsValue = Number(maxRounds);
    const maxSpeaksValue = Number(maxSpeaks);
    const groupLimitsInvalid = isRoom && (!Number.isInteger(maxRoundsValue)
      || maxRoundsValue < 1 || maxRoundsValue > GROUP_MAX_ROUNDS
      || !Number.isInteger(maxSpeaksValue) || maxSpeaksValue < 1 || maxSpeaksValue > GROUP_MAX_MEMBER_TURNS);
    const objectiveRoundsValue = Number(objectiveMaxRounds);
    const objectiveInvalid = !isRoom && (!Number.isInteger(objectiveRoundsValue)
      || objectiveRoundsValue < 1 || objectiveRoundsValue > OBJECTIVE_MAX_ROUNDS);
    const capabilityOptions = (groupId, selectedNames = []) => {
      const available = discoveredCapabilities[groupId] ?? [];
      const availableNames = new Set(available.map((entry) => entry.name));
      const stale = selectedNames.filter((name) => !availableNames.has(name));
      return [
        ...available,
        ...stale.map((name) => ({ name, description: t("capabilityStale"), stale: true })),
      ];
    };
    const capabilityGroup = (group) => {
      const policy = capabilities[group.id] ?? { mode: "all", names: [] };
      const policyInvalid = capabilitySource.status === "ready" && policy.mode === "selected"
        && policy.names.some((name) => !discoveredCapabilities[group.id].some((entry) => entry.name === name));
      const updatePolicy = (next) => setCapabilities((current) => ({
        ...current,
        [group.id]: normalizeCapabilityPolicy(next),
      }));
      const pickerTitle = t("capabilitySelectGroup").replace("{capability}", t(group.labelKey));
      const manageLabel = group.id === "skills" ? t("capabilityManageSkills")
        : group.id === "mcp" ? t("capabilityManageMcp") : t("capabilityManageTools");
      const scopeLabel = group.id === "skills" ? t("capabilityScopeSkills")
        : group.id === "mcp" ? t("capabilityScopeMcp") : t("capabilityScopeTools");
      const requestManagement = () => {
        if (!item) {
          setCapabilityManager({ confirm: null, error: t("capabilityManageSaveFirst") });
          return;
        }
        setCapabilityManager({ confirm: group, error: "" });
      };
      return h("div", { className: "dshbot-capability-group", key: group.id },
        h("div", { className: "dshbot-capability-heading" },
          h(group.icon, { size: 16 }),
          h("span", null, t(group.labelKey)),
          h(Button, {
            variant: "ghost",
            size: "sm",
            className: "dshbot-capability-manage",
            "aria-label": manageLabel,
            title: manageLabel,
            disabled: busy || capabilityBusy,
            loading: capabilityBusy && capabilityManager.confirm?.id === group.id,
            onClick: requestManagement,
          }, t("capabilityManage")),
        ),
        h(SettingsSelect, {
          variant: "block",
          value: policy.mode,
          options: [
            { id: "all", label: t("capabilityModeAll") },
            { id: "selected", label: t("capabilityModeSelected") },
          ],
          "aria-label": t(group.labelKey),
          "aria-invalid": policyInvalid,
          "aria-description": policyInvalid ? t("capabilityInvalid") : undefined,
          title: policyInvalid ? t("capabilityInvalid") : capabilityStateMessage || undefined,
          disabled: catalogWriteDisabled || busy || capabilitySource.status !== "ready" || capabilitySource.active === false,
          onChange: (mode) => updatePolicy({ ...policy, mode }),
        }),
        h("div", { className: "dshbot-hint" }, policy.mode === "selected" ? t("capabilitySelectedHint") : t("capabilityAllHint")),
        h("div", { className: "dshbot-hint" }, scopeLabel),
        policy.mode === "selected" ? h("div", { className: "dshbot-capability-selection" },
          h("span", { className: "dshbot-capability-selection-summary" }, policy.names.length > 0
            ? t("capabilitySelectedCount").replace("{count}", String(policy.names.length))
            : t("capabilitySelectedNone")),
          h(Button, {
            variant: "outline",
            size: "sm",
            className: "dshbot-capability-select",
            "aria-label": pickerTitle,
            title: policyInvalid ? `${pickerTitle}: ${t("capabilityInvalid")}` : pickerTitle,
            disabled: catalogWriteDisabled || busy || capabilitySource.status !== "ready" || capabilitySource.active === false,
            onClick: () => setCapabilityPicker({ groupId: group.id, names: [...policy.names] }),
          }, t("capabilitySelect")),
        ) : null,
      );
    };

    const activeMemory = memorySource.value?.[memoryTrack] ?? { entries: [], revision: null, text: "" };
    const activeMemoryLimit = Number(memorySource.value?.limits?.[memoryTrack]) || 0;
    const memoryUsageText = activeMemoryLimit > 0
      ? t("memoryUsage").replace("{used}", String(activeMemory.text.length)).replace("{limit}", String(activeMemoryLimit))
      : "";
    const memoryStateMessage = memorySource.status === "loading" || memorySource.status === "idle"
      ? t("memoryLoading")
      : memorySource.status !== "ready"
        ? `${t("memoryUnavailable")}${memorySource.error ? `: ${memorySource.error}` : ""}`
        : "";
    const beginMemoryAdd = () => {
      setMemoryEditingId("__new__");
      setMemoryDraft("");
      setMemoryError("");
      setMemorySource((current) => ({ ...current, error: "" }));
    };
    const beginMemoryEdit = (entry) => {
      setMemoryEditingId(entry.id);
      setMemoryDraft(entry.text);
      setMemoryError("");
      setMemorySource((current) => ({ ...current, error: "" }));
    };
    const cancelMemoryEdit = () => {
      setMemoryEditingId(null);
      setMemoryDraft("");
    };
    const updateMemoryTrack = (value, fallbackEntries) => setMemorySource((current) => {
      const returnedEntries = normalizeMemoryEntries(value);
      return {
        ...current,
        status: "ready",
        error: "",
        value: {
          ...current.value,
          [memoryTrack]: {
            entries: returnedEntries.length > 0 || fallbackEntries.length === 0 ? returnedEntries : fallbackEntries,
            revision: memoryRevision(value, current.value?.[memoryTrack]?.revision ?? null),
            text: String(value?.text ?? ""),
          },
        },
      };
    });
    const saveMemory = async () => {
      const text = memoryDraft.trim();
      if (!text) {
        setMemoryError(t("memoryRequired"));
        return;
      }
      if (!item?.id || memorySource.status !== "ready" || typeof replaceMemory !== "function") return;
      const nextEntries = memoryEditingId === "__new__"
        ? [...activeMemory.entries, { id: newId(), text }]
        : activeMemory.entries.map((entry) => entry.id === memoryEditingId ? { ...entry, text } : entry);
      setMemoryBusy(true);
      setMemoryAction("save");
      setMemoryError("");
      try {
        const result = await replaceMemory(item.id, memoryTrack, nextEntries, activeMemory.revision);
        updateMemoryTrack(result?.memory ?? result, nextEntries);
        cancelMemoryEdit();
      } catch (error) {
        setMemoryError(error instanceof Error ? error.message : String(error));
        setMemorySource((current) => ({
          ...current,
          status: isRpcUnavailable(error) ? "unavailable" : current.status,
        }));
      } finally {
        setMemoryBusy(false);
        setMemoryAction("");
      }
    };
    const deleteMemory = async (entry) => {
      if (!item?.id || memorySource.status !== "ready" || typeof replaceMemory !== "function") return;
      setMemoryBusy(true);
      setMemoryAction(entry.id);
      setMemoryError("");
      try {
        const nextEntries = activeMemory.entries.filter((current) => current.id !== entry.id);
        const result = await replaceMemory(item.id, memoryTrack, nextEntries, activeMemory.revision);
        updateMemoryTrack(result?.memory ?? result, nextEntries);
        if (memoryEditingId === entry.id) cancelMemoryEdit();
      } catch (error) {
        setMemoryError(error instanceof Error ? error.message : String(error));
        setMemorySource((current) => ({
          ...current,
          status: isRpcUnavailable(error) ? "unavailable" : current.status,
        }));
      } finally {
        setMemoryBusy(false);
        setMemoryAction("");
      }
    };
    const memorySection = !isRoom && !isBotCreate ? h("div", { className: "dshbot-memory", "data-dshbot-memory": "",
      "aria-busy": memorySource.status === "loading", "aria-description": memoryStateMessage || undefined,
      title: memoryStateMessage || undefined },
      h("div", { className: "dshbot-memory-heading" },
        h("span", null, t("memory")),
        memorySource.status === "ready" ? h(Button, {
          variant: "ghost",
          size: "sm",
          icon: h(IconPlusOutline16, { size: 16 }),
          "aria-label": t("memoryAdd"),
          title: t("memoryAdd"),
          disabled: catalogWriteDisabled || memoryBusy || memoryEditingId !== null,
          onClick: beginMemoryAdd,
        }) : null,
      ),
      memorySource.status === "ready" ? h("div", { className: "dshbot-memory-tabs" },
        h(Pill, {
          active: memoryTrack === "bot",
          disabled: memoryBusy || memoryEditingId !== null,
          onClick: () => setMemoryTrack("bot"),
        }, t("memoryTrackNotes")),
        h(Pill, {
          active: memoryTrack === "user",
          disabled: memoryBusy || memoryEditingId !== null,
          onClick: () => setMemoryTrack("user"),
        }, t("memoryTrackUser")),
        memoryUsageText ? h("span", { className: "dshbot-memory-usage" }, memoryUsageText) : null,
      ) : null,
      h("div", { className: "dshbot-hint" }, t("memoryHint")),
      h("label", { className: "dshbot-memory-review" },
        h("input", {
          type: "checkbox",
          "aria-label": t("memoryReview"),
          checked: memoryReview,
          disabled: catalogWriteDisabled || memoryBusy,
          onChange: (event) => setMemoryReview(event.target.checked),
        }),
        h("span", null, t("memoryReview")),
      ),
      h("div", { className: "dshbot-hint" }, t("memoryReviewHint")),
      memorySource.status === "ready" && activeMemory.entries.length === 0 && memoryEditingId === null
        ? h("div", { className: "dshbot-empty" }, t("memoryEmpty"))
        : null,
      memorySource.status === "ready" && activeMemory.entries.length > 0
        ? h("div", { className: "dshbot-memory-list" }, activeMemory.entries.map((entry) => h("div", {
          key: entry.id,
          className: "dshbot-memory-row",
          "data-dshbot-memory-entry": entry.id,
        },
          entry.text.startsWith("[auto] ") ? h("span", { className: "dshbot-memory-tag" }, t("memoryAutoTag")) : null,
          h("div", { className: "dshbot-memory-text" }, entry.text.startsWith("[auto] ") ? entry.text.slice(7) : entry.text),
          h("div", { className: "dshbot-memory-actions" },
            h(Tooltip, { label: t("memoryEdit"), side: "top", delayMs: 400 },
              h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
                variant: "ghost",
                size: "sm",
                icon: h(IconEditOutline16, { size: 16 }),
                "aria-label": `${t("memoryEdit")}: ${entry.text}`,
                title: t("memoryEdit"),
                disabled: memoryBusy || memoryEditingId !== null,
                onClick: () => beginMemoryEdit(entry),
              }))),
            h(Tooltip, { label: t("memoryDelete"), side: "top", delayMs: 400 },
              h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
                variant: "ghost",
                size: "sm",
                icon: h(IconTrashOutline16, { size: 16 }),
                "aria-label": `${t("memoryDelete")}: ${entry.text}`,
                title: t("memoryDelete"),
                disabled: memoryBusy || memoryEditingId !== null,
                loading: memoryBusy && memoryAction === entry.id,
                onClick: () => { void deleteMemory(entry); },
              }))),
          ),
        )))
        : null,
      memoryEditingId !== null ? h("div", { className: "dshbot-memory-editor" },
        h("label", { htmlFor: "dshbot-memory-text" }, t("memoryText")),
        h("textarea", {
          id: "dshbot-memory-text",
          className: "dshbot-textarea",
          "aria-label": t("memoryText"),
          value: memoryDraft,
          rows: 3,
          disabled: memoryBusy,
          onChange: (event) => setMemoryDraft(event.target.value),
        }),
        h("div", { className: "dshbot-memory-editor-actions" },
          h(Button, { variant: "outline", "aria-label": t("memoryCancel"), disabled: memoryBusy, onClick: cancelMemoryEdit }, t("cancel")),
          h(Button, { variant: "primary", "aria-label": t("memorySave"), disabled: memoryBusy || !memoryDraft.trim(), loading: memoryBusy && memoryAction === "save", onClick: () => { void saveMemory(); } }, t("memorySave")),
        ),
      ) : null,
    ) : null;

    const profileValues = {
      name: name.trim() || t("defaultBotName"),
      title: isRoom ? "" : title.trim(),
      description,
      avatar: isRoom
        ? (item?.avatar || defaultBlobAvatar(item?.id || name))
        : normalizeAvatar(avatar, item?.id || name),
      workspaceId: workspaceId || "",
      model: { provider, model, reasoningEffort: provider && model ? reasoningEffort : "" },
      allowedSenderIds: isRoom ? (item?.allowedSenderIds ?? []) : (sourcePolicy === "selected" ? sourceIds : []),
      capabilities: capabilitySource.status === "ready" ? capabilities : (item?.capabilities ?? capabilities),
      memberBotIds: isRoom ? normalizeRoomMemberIds(memberIds, items) : (item?.memberBotIds ?? []),
      maxRounds: isRoom ? maxRoundsValue : item?.maxRounds,
      maxSpeaks: isRoom ? maxSpeaksValue : item?.maxSpeaks,
      objective: isRoom ? "" : objective,
      objectiveMaxRounds: isRoom ? item?.objectiveMaxRounds : objectiveRoundsValue,
      memoryReview: isRoom ? true : memoryReview,
      notify: isRoom ? true : notifyEnabled,
    };
    const deletePreview = editor.deletePreview;
    const deletePreviewNames = (rows) => {
      if (!Array.isArray(rows) || rows.length === 0) return t("deleteNone");
      return rows.map((row) => {
        if (typeof row === "string") return row;
        if (row && typeof row === "object") return String(row.name ?? row.title ?? row.id ?? row.sourceId ?? row.removed ?? "");
        return String(row);
      }).filter(Boolean).join("、") || t("deleteNone");
    };
    const deleteDependencies = deletePreview?.dependencies ?? {};
    const deletePreviewContent = deletePreview?.status !== "ready"
        ? null
        : h("div", { className: "dshbot-delete-preview" },
          h("div", { className: "dshbot-delete-preview-row" }, h("span", null, t("deleteGroups")), h("span", null, deletePreviewNames(deleteDependencies.groups))),
          h("div", { className: "dshbot-delete-preview-row" }, h("span", null, t("deleteRoutines")), h("span", null, deletePreviewNames(deleteDependencies.routines))),
          h("div", { className: "dshbot-delete-preview-row" }, h("span", null, t("deleteTasks")), h("span", null, deletePreviewNames(deleteDependencies.tasks))),
          h("div", { className: "dshbot-delete-preview-row" }, h("span", null, t("deleteSources")), h("span", null, deletePreviewNames(deleteDependencies.sources))),
          h("div", { className: "dshbot-delete-preserves" }, `${t("deletePreserves")}: ${deletePreviewNames(deletePreview.preserves)}`),
          h("label", { className: "dshbot-delete-confirm" },
            h("input", { type: "checkbox", checked: deleteConfirmed, onChange: (event) => setDeleteConfirmed(event.target.checked) }),
            h("span", null, t("deleteConfirmCascade")),
          ),
        );

    const footer = isDelete
      ? h("div", { className: "dshbot-footer" },
        h(Button, { variant: "outline", "aria-label": t("cancel"), disabled: busy, onClick: closeEditor }, t("cancel")),
        h(Button, {
          variant: "primary",
          "aria-label": t("delete"),
          disabled: catalogWriteDisabled || busy || deletePreview?.status !== "ready" || !deleteConfirmed,
          loading: busy || deletePreview?.status === "loading",
          onClick: async () => {
            if (busy) return;
            setBusy(true);
            try { await confirmDelete(editor.itemId); }
            finally { setBusy(false); }
          },
        }, t("delete")),
      )
      : h("div", { className: "dshbot-footer" },
        h(Button, { variant: "outline", "aria-label": t("cancel"), onClick: closeEditor, disabled: busy }, t("cancel")),
        h(Button, {
          variant: "primary",
          "aria-label": t("save"),
          loading: busy,
          disabled: catalogWriteDisabled || busy || (!isRoom && modelSource.status === "loading") || (!isRoom && modelSelectionInvalid) || (isRoom && (
             memberIds.length < GROUP_MIN_MEMBERS || memberIds.length > GROUP_MAX_MEMBERS
           )) || sourceSelectionInvalid || groupLimitsInvalid || capabilitySelectedInvalid || objectiveInvalid,
          onClick: async () => {
            setBusy(true);
            try {
              if (isRoomCreate) {
                await createRoomSubmit({
                  ...profileValues,
                });
              } else if (isBotCreate) {
                await createBotSubmit(profileValues);
              } else if (item) {
                if (isRoom && (
                  memberIds.length < GROUP_MIN_MEMBERS || memberIds.length > GROUP_MAX_MEMBERS
                )) {
                  throw new Error(t("membersHint"));
                }
                 await saveItem({ ...item, ...profileValues, updatedAt: Date.now() }, {
                    workspaceLocked,
                    sourcePolicy,
                    capabilityCatalog: capabilitySource.status === "ready" ? discoveredCapabilities : undefined,
                 });
               }
            } finally {
              setBusy(false);
            }
          },
        }, t("save")),
      );

    const capabilityConfirmGroup = capabilityManager.confirm;
    const capabilityConfirmLabel = capabilityConfirmGroup ? t(capabilityConfirmGroup.labelKey) : "";
    const capabilityPickerGroup = capabilityPicker
      ? CAPABILITY_GROUPS.find((group) => group.id === capabilityPicker.groupId)
      : null;
    const capabilityPickerOptions = capabilityPickerGroup
      ? capabilityOptions(capabilityPickerGroup.id, capabilityPicker.names)
      : [];
    const capabilityPickerTitle = capabilityPickerGroup
      ? t("capabilitySelectGroup").replace("{capability}", t(capabilityPickerGroup.labelKey))
      : t("capabilities");
    const closeCapabilityPicker = () => setCapabilityPicker(null);
    const saveCapabilityPicker = () => {
      if (!capabilityPickerGroup || !capabilityPicker) return;
      setCapabilities((current) => ({
        ...current,
        [capabilityPickerGroup.id]: normalizeCapabilityPolicy({
          ...(current[capabilityPickerGroup.id] ?? { mode: "selected", names: [] }),
          mode: "selected",
          names: capabilityPicker.names,
        }),
      }));
      closeCapabilityPicker();
    };
    return h(react.Fragment, null,
      h(Feedback, { t,
        text: !open || capabilityManager.confirm ? "" : [
          editor.error,
          open ? catalogStateMessage : "",
          open && isDelete && deletePreview?.status === "loading" ? t("deletePreviewLoading") : "",
          open && isDelete && deletePreview?.status === "unavailable" ? t("deletePreviewUnavailable") : "",
          open && !isDelete && !isRoom ? modelCatalogStateMessage : "",
          open && !isDelete && !isRoom ? capabilityStateMessage : "",
          open && !isDelete && !isRoom && !isBotCreate ? memoryStateMessage : "",
          open && !isDelete ? avatarErrorState.error : "",
          open && !isDelete && memoryError ? `${t("memoryError")}: ${memoryError}` : "",
          open ? capabilityManager.error : "",
        ].filter(Boolean).join("\n"),
        warnings: open && !capabilityManager.confirm ? editor.warnings : [],
        identity: avatarErrorState.error ? avatarErrorState : memoryError ? memoryErrorState
          : capabilityManager.error ? capabilityManager : editor.feedbackId,
        loading: open && !editor.error && !avatarErrorState.error && !memoryError && !capabilityManager.error
          && (catalogLoading || isDelete && deletePreview?.status === "loading"
            || !isDelete && !isRoom && (modelSource.status === "loading" || capabilitySource.status === "loading" || !isBotCreate && memorySource.status === "loading")),
      }),
      h(Modal, {
      open,
      onClose: () => { if (!busy && !capabilityBusy) closeEditor(); },
      title: isDelete ? t("delete") : isRoom ? t("addRoom") : isBotCreate ? t("addBot") : t("edit"),
      closeLabel: t("close"),
      className: "dshbot-modal",
      footer,
    },
      isDelete
        ? h("div", { className: "dshbot-form", "aria-description": catalogStateMessage || undefined, title: catalogStateMessage || undefined },
          h("p", null, t("confirmDelete")),
          h("div", { className: "dshbot-field" },
            h("label", null, t("deleteDependencies")),
            deletePreviewContent,
          ),
        )
        : h("div", { className: "dshbot-form", "aria-description": catalogStateMessage || undefined, title: catalogStateMessage || undefined },
          !isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("avatar")),
            h(AvatarView, {
              avatar,
              seed: item?.id || name,
              thinking: false,
              size: 72,
              live: open,
            }),
            h(AvatarPicker, {
              t,
              avatar,
              seed: item?.id || name,
               onChange: setAvatar,
               live: open,
               disabled: catalogWriteDisabled,
               onError: setAvatarError,
             }),
          ) : null,
          h("div", { className: "dshbot-field" },
            h("label", null, isRoom ? t("roomName") : t("name")),
            h(Input, { value: name, "aria-label": isRoom ? t("roomName") : t("name"), disabled: catalogWriteDisabled, onChange: (event) => setName(event.target.value) }),
          ),
          !isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("title")),
            h(Input, {
              value: title,
              "aria-label": t("title"),
              disabled: catalogWriteDisabled,
              maxLength: 120,
              onChange: (event) => setTitle(event.target.value),
            }),
            title.trim() && title.trim() !== name.trim()
              ? h("div", { className: "dshbot-hint" }, `${t("stableAddress")}: @${name.trim() || t("defaultBotName")}`)
              : null,
          ) : null,
           h("div", { className: "dshbot-field" },
             h("label", null, t("description")),
            !isRoom ? h("div", { className: "dshbot-pills" },
              PERSONA_TEMPLATES.map((chip) => h(Pill, {
                key: chip.id,
                active: description === chip.text,
                disabled: catalogWriteDisabled,
                onClick: () => setDescription(chip.text),
              }, t(chip.labelKey))),
            ) : null,
            !isRoom ? h("div", { className: "dshbot-hint" }, t("personaHint")) : null,
            h("textarea", {
              className: "dshbot-textarea",
              "aria-label": t("description"),
              value: description,
              rows: isRoom ? 2 : 3,
              disabled: catalogWriteDisabled,
              onChange: (event) => setDescription(event.target.value),
            }),
          ),
          isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("members")),
            h("div", { className: "dshbot-hint" }, t("membersHint")),
            h("div", { className: "dshbot-members" },
              botChoices.map((bot) => h("label", { key: bot.id, className: "dshbot-member" },
                h("input", {
                  type: "checkbox",
                  "aria-label": displayName(bot),
                  checked: memberIds.includes(bot.id),
                  disabled: catalogWriteDisabled || ((!memberIds.includes(bot.id) && memberIds.length >= GROUP_MAX_MEMBERS)
                    || (memberIds.includes(bot.id) && memberIds.length <= GROUP_MIN_MEMBERS)),
                  onChange: (event) => {
                    setMemberIds((current) => {
                      if (!event.target.checked && current.length <= GROUP_MIN_MEMBERS) return current;
                      if (event.target.checked) {
                        return current.length >= GROUP_MAX_MEMBERS || current.includes(bot.id)
                          ? current
                          : [...current, bot.id];
                      }
                      return current.filter((id) => id !== bot.id);
                    });
                  },
                }),
                h(AvatarView, { avatar: bot.avatar, seed: bot.id || bot.name, size: 24 }),
                displayName(bot),
              )),
            ),
          ) : null,
          !isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("model")),
            h("div", { className: "dshbot-model-grid" },
              h("div", { className: "dshbot-field" },
                h("label", null, t("provider")),
                h(SettingsSelect, {
                  variant: "block",
                  value: provider,
                  options: providerOptions,
                  "aria-label": t("provider"),
                  "aria-busy": modelSource.status === "loading",
                  "aria-description": modelCatalogStateMessage || undefined,
                  title: modelCatalogStateMessage || undefined,
                  disabled: catalogWriteDisabled || modelSource.status !== "ready",
                  onChange: (value) => {
                    setProvider(value);
                    setModel("");
                    setReasoningEffort("");
                  },
                }),
              ),
              h("div", { className: "dshbot-field" },
                h("label", null, t("model")),
                h(SettingsSelect, {
                  variant: "block",
                  value: model,
                  options: modelOptions,
                  "aria-label": t("model"),
                  "aria-busy": modelSource.status === "loading",
                  "aria-description": modelCatalogStateMessage || undefined,
                  title: modelCatalogStateMessage || undefined,
                  disabled: catalogWriteDisabled || modelSource.status !== "ready" || !provider,
                  onChange: (value) => {
                    setModel(value);
                    setReasoningEffort(modelEfforts(modelEntry(modelCatalogValue, provider, value)).some((effort) => String(effort.id) === String(reasoningEffort)) ? reasoningEffort : (modelEntry(modelCatalogValue, provider, value)?.reasoning?.defaultEffort || ""));
                  },
                }),
              ),
              h("div", { className: "dshbot-field" },
                h("label", null, t("reasoningEffort")),
                h(SettingsSelect, {
                  variant: "block",
                  value: reasoningEffort,
                  options: effortOptions,
                  "aria-label": t("reasoningEffort"),
                  "aria-busy": modelSource.status === "loading",
                  "aria-description": modelCatalogStateMessage || undefined,
                  title: modelCatalogStateMessage || undefined,
                  disabled: catalogWriteDisabled || modelSource.status !== "ready" || !provider || !model || modelEfforts(selectedModel).length === 0,
                  onChange: setReasoningEffort,
                }),
                selectedModel && modelEfforts(selectedModel).length === 0 ? h("div", { className: "dshbot-hint" }, t("reasoningUnavailable")) : null,
              ),
            ),
          ) : null,
          !isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("sourcePolicy")),
            h(SettingsSelect, {
              variant: "block",
              value: sourcePolicy,
              options: [
                { id: "default", label: t("sourceDefault") },
                { id: "selected", label: t("sourceSelected") },
              ],
              "aria-label": t("sourcePolicy"),
              "aria-invalid": sourceSelectionInvalid,
              "aria-description": sourceValidationMessage || undefined,
              title: sourceValidationMessage || undefined,
              disabled: catalogWriteDisabled,
              onChange: setSourcePolicy,
            }),
            h("div", { className: "dshbot-hint" }, sourcePolicy === "selected" ? t("sourceSelectedHint") : t("sourceDefaultHint")),
            sourcePolicy === "selected" ? h("div", { className: "dshbot-source-options" },
              sourceChoices.map((bot) => h("label", { key: bot.id, className: "dshbot-source-option" },
                h("input", {
                  type: "checkbox",
                  "aria-label": displayName(bot),
                  checked: sourceIds.includes(bot.id),
                  disabled: catalogWriteDisabled,
                  onChange: (event) => setSourceIds(event.target.checked
                    ? [...new Set([...sourceIds, bot.id])]
                    : sourceIds.filter((id) => id !== bot.id)),
                }),
                h(AvatarView, { avatar: bot.avatar, seed: bot.id || bot.name, size: 24, live: false }),
                h("span", null, displayName(bot)),
              )),
              invalidSourceIds.map((id) => h("label", { key: `invalid:${id}`, className: "dshbot-source-option dshbot-source-invalid" },
                h("input", {
                  type: "checkbox",
                  "aria-label": `${t("sourceUnavailable")}: ${id}`,
                  checked: true,
                  disabled: catalogWriteDisabled,
                  onChange: () => setSourceIds(sourceIds.filter((sourceId) => sourceId !== id)),
                }),
                h("span", null, `${t("sourceUnavailable")}: ${id}`),
              )),
            ) : null,
          ) : null,
          isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("groupLimits")),
            h("div", { className: "dshbot-hint" }, t("groupLimitHint")),
            h("div", { className: "dshbot-number-row" },
              h("label", { htmlFor: "dshbot-max-rounds" }, t("maxRounds")),
              h("input", {
                id: "dshbot-max-rounds",
                className: "dshbot-number-input",
                type: "number",
                min: 1,
                max: GROUP_MAX_ROUNDS,
                step: 1,
                value: maxRounds,
                "aria-label": t("maxRounds"),
                "aria-invalid": groupLimitsInvalid,
                "aria-description": groupLimitsInvalid ? t("groupLimitHint") : undefined,
                title: groupLimitsInvalid ? t("groupLimitHint") : undefined,
                disabled: catalogWriteDisabled,
                onChange: (event) => setMaxRounds(event.target.value),
              }),
            ),
            h("div", { className: "dshbot-number-row" },
              h("label", { htmlFor: "dshbot-max-speaks" }, t("maxSpeaks")),
              h("input", {
                id: "dshbot-max-speaks",
                className: "dshbot-number-input",
                type: "number",
                min: 1,
                max: GROUP_MAX_MEMBER_TURNS,
                step: 1,
                value: maxSpeaks,
                "aria-label": t("maxSpeaks"),
                "aria-invalid": groupLimitsInvalid,
                "aria-description": groupLimitsInvalid ? t("groupLimitHint") : undefined,
                title: groupLimitsInvalid ? t("groupLimitHint") : undefined,
                disabled: catalogWriteDisabled,
                onChange: (event) => setMaxSpeaks(event.target.value),
              }),
            ),
          ) : null,
          h("div", { className: "dshbot-field" },
            h("label", null, t("workspace")),
            h(SettingsSelect, {
              variant: "block",
              value: workspaceId,
              options: workspaceItems,
              "aria-label": t("workspace"),
              disabled: catalogWriteDisabled || workspaceLocked,
              onChange: setWorkspaceId,
            }),
            workspaceLocked ? h("div", { className: "dshbot-hint" }, t("workspaceLocked")) : null,
          ),
          !isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("capabilities")),
            h("div", { className: "dshbot-capability-groups" }, CAPABILITY_GROUPS.map(capabilityGroup)),
          ) : null,
          !isRoom ? h("div", { className: "dshbot-field", "data-dshbot-objective-field": "" },
            h("label", null, t("objective")),
            h("div", { className: "dshbot-hint" }, t("objectiveHint")),
            h("textarea", {
              id: "dshbot-objective",
              className: "dshbot-textarea",
              "aria-label": t("objective"),
              value: objective,
              rows: 3,
              maxLength: 2000,
              disabled: catalogWriteDisabled,
              onChange: (event) => setObjective(event.target.value),
            }),
            h("div", { className: "dshbot-number-row" },
              h("label", { htmlFor: "dshbot-objective-rounds" }, t("objectiveRounds")),
              h("input", {
                id: "dshbot-objective-rounds",
                className: "dshbot-number-input",
                type: "number",
                min: 1,
                max: OBJECTIVE_MAX_ROUNDS,
                step: 1,
                value: objectiveMaxRounds,
                "aria-label": t("objectiveRounds"),
                "aria-invalid": objectiveInvalid,
                "aria-description": objectiveInvalid ? t("objectiveRoundsHint") : undefined,
                title: objectiveInvalid ? t("objectiveRoundsHint") : undefined,
                disabled: catalogWriteDisabled,
                onChange: (event) => setObjectiveMaxRounds(event.target.value),
              }),
              h("span", { className: "dshbot-hint" }, t("objectiveRoundsHint")),
            ),
          ) : null,
          !isRoom ? h("div", { className: "dshbot-field" },
            h("label", { className: "dshbot-memory-review" },
              h("input", {
                type: "checkbox",
                "aria-label": t("notify"),
                checked: notifyEnabled,
                disabled: catalogWriteDisabled,
                onChange: (event) => setNotifyEnabled(event.target.checked),
              }),
              h("span", null, t("notify")),
            ),
            h("div", { className: "dshbot-hint" }, t("notifyHint")),
          ) : null,
          memorySection,
        ),
      ),
      h(Modal, {
        open: Boolean(capabilityPickerGroup),
        onClose: closeCapabilityPicker,
        title: capabilityPickerTitle,
        closeLabel: t("close"),
        className: "dshbot-modal",
        footer: h("div", { className: "dshbot-footer" },
          h(Button, { variant: "outline", "aria-label": t("cancel"), onClick: closeCapabilityPicker }, t("cancel")),
          h(Button, { variant: "primary", "aria-label": t("capabilityPickerDone"), onClick: saveCapabilityPicker }, t("capabilityPickerDone")),
        ),
      },
        h("div", { className: "dshbot-capability-picker" },
          h("div", { className: "dshbot-hint" }, t("capabilitySelectedHint")),
          capabilityPickerOptions.length > 0
            ? h("div", { className: "dshbot-capability-options" }, capabilityPickerOptions.map((entry) => h("label", {
              key: `${capabilityPickerGroup?.id}:${entry.name}`,
              className: `dshbot-capability-option${entry.stale ? " dshbot-capability-stale" : ""}`,
            },
              h("input", {
                type: "checkbox",
                "aria-label": entry.name,
                checked: capabilityPicker?.names.includes(entry.name) === true,
                onChange: (event) => setCapabilityPicker((current) => {
                  if (!current) return current;
                  return {
                    ...current,
                    names: event.target.checked
                      ? [...new Set([...current.names, entry.name])]
                      : current.names.filter((name) => name !== entry.name),
                  };
                }),
              }),
              h("span", { className: "dshbot-capability-option-body" },
                h("span", { className: "dshbot-capability-name" }, entry.name),
                entry.description ? h("span", { className: "dshbot-capability-description" }, entry.description) : null,
              ),
            )))
            : h("div", { className: "dshbot-capability-empty" }, t("capabilityEmpty")),
        ),
      ),
      h(ConfirmActionModal, {
        t,
        open: Boolean(capabilityConfirmGroup),
        title: t("capabilityGlobalConfirmTitle"),
        body: t("capabilityGlobalConfirmBody").replace("{capability}", capabilityConfirmLabel),
        caveat: t("capabilityGlobalConfirmCaveat"),
        confirmLabel: t("capabilityGlobalConfirm"),
        busy: capabilityBusy,
        error: capabilityManager.error,
        feedbackIdentity: capabilityManager,
        onClose: () => setCapabilityManager({ confirm: null, error: "" }),
        onConfirm: async () => {
          if (!capabilityConfirmGroup || !item || capabilityBusy) return;
          setCapabilityBusy(true);
          setCapabilityManager({ confirm: capabilityConfirmGroup, error: "" });
          try {
            await manageCapabilities(capabilityConfirmGroup.id, item);
            setCapabilityManager({ confirm: null, error: "" });
          } catch (error) {
            setCapabilityManager({ confirm: capabilityConfirmGroup, error: error instanceof Error ? error.message : String(error) });
          } finally {
            setCapabilityBusy(false);
          }
        },
      }),
    );
  }

  function textsFromContent(content) {
    if (!Array.isArray(content)) return [];
    const parts = [];
    for (const part of content) {
      if (part?.type === "text" && typeof part.text === "string") {
        parts.push(part.text);
        continue;
      }
      if (part?.type === "tool-result" && Array.isArray(part.content)) {
        parts.push(...textsFromContent(part.content));
      }
    }
    return parts;
  }

  function isPassContent(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return true;
    return /^\(?\s*pass\s*\)?\.?$/i.test(trimmed);
  }

  function memberVisibleText(text) {
    const raw = String(text ?? "").replace(/[ \t]+$/gm, "").replace(/\s+$/u, "");
    const lines = raw.split("\n");
    const last = lines[lines.length - 1] ?? "";
    const visible = /^NEXT:\s*/i.test(last)
      ? lines.slice(0, -1).join("\n").replace(/\s+$/u, "")
      : raw;
    if (isPassContent(visible)) return "";
    return visible.trim();
  }

  function groupMemberResultState(event, content, failed = false) {
    const status = [
      event?.data?.status,
      event?.data?.state,
      event?.data?.result?.status,
      event?.data?.message?.status,
      event?.data?.error?.code,
      event?.data?.error?.kind,
    ].filter(Boolean).join(" ").toLowerCase();
    if (/capped|limit|maximum/.test(status)) return "capped";
    if (/timeout|timed.?out/.test(status)) return "timeout";
    if (/held|paused|deferred/.test(status)) return "held";
    if (/stopped|cancelled|canceled|aborted/.test(status)) return "stopped";
    if (/pending|waiting|approval|question/.test(status)) return "pending";
    if (/running|started/.test(status)) return "running";
    if (/failed|error/.test(status)) return "failed";
    if (failed) return "failed";
    const bodies = textsFromContent(content);
    if (bodies.length === 0 || bodies.every(isPassContent)) return "pass";
    if (/pass|complete|success|done/.test(status)) return "pass";
    return "settled";
  }

  function groupMessageStateLabel(t, state) {
    if (state === "pending" || state === "running") return t("groupMemberPending");
    if (state === "failed") return t("groupMemberFailed");
    if (state === "pass") return t("groupMemberPassed");
    if (state === "held") return t("groupMemberHeld");
    if (state === "stopped") return t("groupMemberStopped");
    if (state === "capped") return t("groupMemberCapped");
    if (state === "timeout") return t("groupMemberTimeout");
    return "";
  }

  function parseGroupThreadEnvelope(text) {
    const raw = String(text ?? "");
    if (!raw.startsWith(GROUP_THREAD_REPLY_PREFIX)) return { threadId: "", text: raw };
    const end = raw.indexOf("]\n", GROUP_THREAD_REPLY_PREFIX.length);
    if (end < 0) return { threadId: "", text: raw };
    const threadId = raw.slice(GROUP_THREAD_REPLY_PREFIX.length, end);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(threadId)) return { threadId: "", text: raw };
    return { threadId, text: raw.slice(end + 2) };
  }

  function encodeGroupThreadEnvelope(threadId, text) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(threadId ?? ""))) {
      throw new Error("Invalid group thread id.");
    }
    return `${GROUP_THREAD_REPLY_PREFIX}${threadId}]\n${String(text ?? "")}`;
  }

  function parseGroupThreadReplyArgs(raw) {
    const match = /^([A-Za-z0-9][A-Za-z0-9._:-]{0,127})(?:\s+([\s\S]*))?$/.exec(String(raw ?? "").trim());
    if (!match) return null;
    return { threadId: match[1], text: String(match[2] ?? "").trim() };
  }

  function parseGroupThreadReplyLine(line) {
    const raw = String(line ?? "").trim();
    if (!raw.startsWith(GROUP_THREAD_REPLY_COMMAND)) return null;
    const rest = raw.slice(GROUP_THREAD_REPLY_COMMAND.length);
    if (rest && !/^\s/.test(rest)) return null;
    return parseGroupThreadReplyArgs(rest);
  }

  function eventList(snapshot) {
    const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
    return entries.filter((row) => row?.type === "event" && row.event).map((row) => row.event);
  }

  function isValidGroupThreadId(value) {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value ?? ""));
  }

  function declaredGroupThreadIdForUserEvent(event) {
    const envelope = parseGroupThreadEnvelope(textsFromContent(event?.data?.content).join(""));
    if (envelope.threadId) return envelope.threadId;
    for (const candidate of [
      event?.threadId,
      event?.thread,
      event?.groupThreadId,
      event?.owningThreadId,
      event?.data?.threadId,
      event?.data?.thread,
      event?.data?.groupThreadId,
      event?.data?.owningThreadId,
      event?.data?.source?.threadId,
      event?.data?.source?.thread,
      event?.data?.source?.owningThreadId,
    ]) {
      if (isValidGroupThreadId(candidate)) return String(candidate);
    }
    return "";
  }

  function isRoomInputEvent(event) {
    if (event?.type !== "user/message") return false;
    const source = event.data?.source;
    return source?.kind === "user"
      || (source?.kind === "plugin" && source.plugin === "dshbot" && source.form === "relay");
  }

  function roomEventText(event) {
    return parseGroupThreadEnvelope(textsFromContent(event?.data?.content).join("")).text;
  }

  function lateResultPayloadFromSource(source) {
    if (source?.kind !== "plugin" || source.plugin !== "dshbot" || source.form !== "notice") return null;
    const payload = source.dshbotGroupLateResult;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const threadId = String(payload.threadId ?? payload.owningThreadId ?? "").trim();
    const toolCallId = String(payload.toolCallId ?? payload.callId ?? "").trim();
    const botId = String(payload.botId ?? "").trim();
    const texts = (Array.isArray(payload.texts) ? payload.texts : [])
      .map((text) => memberVisibleText(String(text ?? "")))
      .filter(Boolean)
      .slice(0, GROUP_MAX_MESSAGES_PER_TURN);
    if (!isValidGroupThreadId(threadId) || !toolCallId || !botId || texts.length === 0) return null;
    return {
      ...payload,
      carrierId: String(payload.carrierId ?? "").trim(),
      threadId,
      toolCallId,
      botId,
      name: String(payload.name ?? "").trim(),
      texts,
    };
  }

  function lateResultPayloadsForEvent(event) {
    if (event?.type === "user/message") {
      const payload = lateResultPayloadFromSource(event.data?.source ?? event.data?.message?.source);
      return payload ? [payload] : [];
    }
    if (event?.type !== "agent/inbox/spliced") return [];
    return (Array.isArray(event.data?.inserted) ? event.data.inserted : [])
      .map((message) => lateResultPayloadFromSource(message?.source ?? message?.data?.source))
      .filter(Boolean);
  }

  function groupThreadOf(message) {
    return isValidGroupThreadId(message?.thread) ? String(message.thread) : "legacy-0";
  }

  function assignLegacyThreads(log, options = {}) {
    const gapMs = Number.isFinite(options.gapMs)
      ? Math.max(0, Number(options.gapMs))
      : GROUP_THREAD_GAP_MS;
    let current = null;
    let sequence = 0;
    const source = Array.isArray(log) ? log : [];
    return source.map((entry, index) => {
      if (entry?.thread) {
        current = null;
        return entry;
      }
      const previous = source[index - 1];
      const previousAt = Number(previous?.at);
      const currentAt = Number(entry?.at);
      const lull = !previous
        || (Number.isFinite(currentAt) && Number.isFinite(previousAt) && currentAt - previousAt > gapMs);
      if (!current || (entry?.speaker?.kind === "user" && lull)) current = `legacy-${sequence++}`;
      return { ...entry, thread: current };
    });
  }

  function askParticipantArgs(event) {
    const raw = event?.data?.arguments;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    try {
      return JSON.parse(typeof raw === "string" ? raw : "{}");
    } catch {
      return {};
    }
  }

  function askParticipantThreadId(event, fallback = "") {
    const args = askParticipantArgs(event);
    for (const candidate of [
      args.threadId,
      args.thread,
      args.groupThreadId,
      args.owningThreadId,
      event?.data?.threadId,
      event?.data?.thread,
      event?.data?.groupThreadId,
      event?.data?.owningThreadId,
      event?.threadId,
      event?.thread,
    ]) {
      if (isValidGroupThreadId(candidate)) return String(candidate);
    }
    return fallback;
  }

  function groupResultThreadId(event) {
    for (const candidate of [
      event?.data?.threadId,
      event?.data?.thread,
      event?.data?.groupThreadId,
      event?.data?.owningThreadId,
      event?.data?.message?.threadId,
      event?.data?.message?.thread,
      event?.data?.message?.groupThreadId,
      event?.data?.message?.owningThreadId,
      event?.data?.message?.source?.threadId,
      event?.data?.message?.source?.thread,
      event?.data?.message?.source?.owningThreadId,
    ]) {
      if (isValidGroupThreadId(candidate)) return String(candidate);
    }
    return "";
  }

  function toolCallIdFromCall(event) {
    return String(event?.data?.callId ?? event?.data?.toolCallId ?? event?.data?.id ?? "");
  }

  function toolCallIdFromResult(event) {
    return String(
      event?.data?.message?.source?.callId
        ?? event?.data?.message?.source?.toolCallId
        ?? event?.data?.message?.toolCallId
        ?? event?.data?.toolCallId
        ?? event?.data?.callId
        ?? "",
    );
  }

  function hasErrorContent(content) {
    if (!Array.isArray(content)) return false;
    return content.some((block) => block?.isError === true || hasErrorContent(block?.content));
  }

  function groupResultContent(event) {
    return event?.data?.message?.content ?? event?.data?.content;
  }

  function groupResultFailed(event) {
    return Boolean(event?.data?.error) || hasErrorContent(groupResultContent(event));
  }

  function projectRoomEventThreads(events) {
    const list = Array.isArray(events) ? events : [];
    const declaredCallThreads = new Map();
    for (const event of list) {
      if (event?.type !== "tool/call" || event.data?.name !== "ask_participant") continue;
      const callId = toolCallIdFromCall(event);
      const threadId = askParticipantThreadId(event);
      if (callId && threadId) declaredCallThreads.set(callId, threadId);
    }

    const timeline = [];
    const timelineIndexes = [];
    const projectedLateCarriers = new Set();
    for (let index = 0; index < list.length; index += 1) {
      const event = list[index];
      const lateResults = lateResultPayloadsForEvent(event);
      if (lateResults.length > 0) {
        for (const lateResult of lateResults) {
          const carrierId = lateResult.carrierId;
          if (carrierId && projectedLateCarriers.has(carrierId)) continue;
          if (carrierId) projectedLateCarriers.add(carrierId);
          timeline.push({
            at: Number(event.time ?? 0),
            speaker: { kind: "member" },
            content: lateResult.texts.join("\n\n"),
            thread: lateResult.threadId,
          });
          timelineIndexes.push(index);
        }
        continue;
      }
      if (isRoomInputEvent(event)) {
        const thread = declaredGroupThreadIdForUserEvent(event);
        timeline.push({
          at: Number(event.time ?? 0),
          speaker: { kind: "user" },
          content: roomEventText(event),
          ...(thread ? { thread } : {}),
        });
        timelineIndexes.push(index);
        continue;
      }
      if (event?.type !== "tool/result") continue;
      const resultContent = groupResultContent(event);
      const resultState = groupMemberResultState(event, resultContent, groupResultFailed(event));
      if (resultState !== "settled" && resultState !== "replied") continue;
      const callId = toolCallIdFromResult(event);
      if (!callId) continue;
      const text = textsFromContent(resultContent).map(memberVisibleText).filter(Boolean).join("");
      if (!text) continue;
      const thread = groupResultThreadId(event) || declaredCallThreads.get(callId) || "";
      timeline.push({
        at: Number(event.time ?? 0),
        speaker: { kind: "member" },
        content: text,
        ...(thread ? { thread } : {}),
      });
      timelineIndexes.push(index);
    }

    const assigned = assignLegacyThreads(timeline);
    const threadByIndex = new Map();
    for (let index = 0; index < assigned.length; index += 1) {
      threadByIndex.set(timelineIndexes[index], groupThreadOf(assigned[index]));
    }

    const callThreads = new Map();
    let currentThread = "";
    for (let index = 0; index < list.length; index += 1) {
      const event = list[index];
      const lateResults = lateResultPayloadsForEvent(event);
      if (lateResults.length > 0) {
        for (const lateResult of lateResults) threadByIndex.set(index, lateResult.threadId);
        continue;
      }
      if (isRoomInputEvent(event)) {
        currentThread = threadByIndex.get(index) || currentThread || "legacy-0";
        continue;
      }
      if (event?.type === "tool/call" && event.data?.name === "ask_participant") {
        const callId = toolCallIdFromCall(event);
        const thread = askParticipantThreadId(event) || currentThread || "legacy-0";
        if (callId) callThreads.set(callId, thread);
        threadByIndex.set(index, thread);
        continue;
      }
      if (event?.type !== "tool/result") continue;
      const callId = toolCallIdFromResult(event);
      const thread = groupResultThreadId(event) || callThreads.get(callId) || threadByIndex.get(index) || "";
      if (thread) threadByIndex.set(index, thread);
    }
    return { threadByIndex, callThreads };
  }

  function groupRoomMessages(events, items, pendingSubmissions) {
    const messages = [];
    const calls = new Map();
    const admittedRequests = new Set();
    const projection = projectRoomEventThreads(events);
    const seenLateCarriers = new Set();
    let currentThread = "";
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const lateResults = lateResultPayloadsForEvent(event);
      if (lateResults.length > 0) {
        for (const lateResult of lateResults) {
          const carrierId = lateResult.carrierId;
          if (carrierId && seenLateCarriers.has(carrierId)) continue;
          if (carrierId) seenLateCarriers.add(carrierId);
          const threadId = lateResult.threadId;
          const botId = lateResult.botId;
          const bot = items.find((item) => item.kind !== "room" && item.id === botId);
          const name = lateResult.name || (bot ? displayName(bot) : botId || "Bot");
          lateResult.texts.forEach((body, bodyIndex) => messages.push({
            id: `event:${event.seq ?? index}:late:${bodyIndex}`,
            at: Number(event.time ?? 0),
            threadId,
            speaker: {
              kind: "member",
              id: botId,
              name,
              avatar: normalizeAvatar(bot?.avatar, botId),
            },
            text: body,
            attachments: [],
            state: "settled",
            late: true,
          }));
        }
        continue;
      }
      if (event?.type === "agent/inbox/spliced") continue;
      if (event?.type === "user/message") {
        const source = event.data?.source;
        if (!isRoomInputEvent(event)) continue;
        if (source?.rpcId) admittedRequests.add(String(source.rpcId));
        currentThread = projection.threadByIndex.get(index) || currentThread || "legacy-0";
        const envelope = parseGroupThreadEnvelope(textsFromContent(event.data?.content).join(""));
        const attachments = (Array.isArray(event.data?.content) ? event.data.content : [])
          .filter((block) => (block?.type === "image" || block?.type === "file") && block.attachment)
          .map((block) => ({ type: block.type, value: block.attachment }));
        if (envelope.text || attachments.length > 0) messages.push({
          id: `event:${event.seq ?? index}`,
          at: Number(event.time ?? 0),
          threadId: currentThread,
          speaker: { kind: "user", name: "" },
          text: envelope.text,
          attachments,
          state: "settled",
        });
        continue;
      }
      if (event?.type === "tool/call" && event.data?.name === "ask_participant") {
        const args = askParticipantArgs(event);
        const callId = toolCallIdFromCall(event);
        const bot = items.find((item) => item.kind !== "room" && (item.id === args.botId || item.name === args.botId));
        calls.set(callId, {
          botId: bot?.id || String(args.botId ?? ""),
          name: bot ? displayName(bot) : String(args.botId ?? "Bot"),
          avatar: normalizeAvatar(bot?.avatar, bot?.id || String(args.botId ?? "")),
          threadId: projection.callThreads.get(callId) || askParticipantThreadId(event) || currentThread || "legacy-0",
        });
        continue;
      }
      if (event?.type !== "tool/result") continue;
      const callId = toolCallIdFromResult(event);
      const call = calls.get(callId);
      if (!call) continue;
      const projectedThread = projection.threadByIndex.get(index) || groupResultThreadId(event);
      if (projectedThread && call.threadId && projectedThread !== call.threadId) continue;
      const resultContent = groupResultContent(event);
      const failed = groupResultFailed(event);
      const resultState = groupMemberResultState(event, resultContent, failed);
      if (resultState !== "settled" && resultState !== "replied") {
        messages.push({
          id: `event:${event.seq ?? index}:${resultState}`,
          at: Number(event.time ?? 0),
          threadId: call.threadId,
          speaker: { kind: "member", id: call.botId, name: call.name, avatar: call.avatar },
          text: "",
          attachments: [],
          state: resultState,
        });
        continue;
      }
      const rawBodies = textsFromContent(resultContent);
      const bodies = rawBodies.map(memberVisibleText).filter(Boolean);
      if (bodies.length === 0) {
        messages.push({
          id: `event:${event.seq ?? index}:pass`,
          at: Number(event.time ?? 0),
          threadId: call.threadId,
          speaker: { kind: "member", id: call.botId, name: call.name, avatar: call.avatar },
          text: "",
          attachments: [],
          state: resultState,
        });
      }
      bodies.forEach((body, bodyIndex) => messages.push({
        id: `event:${event.seq ?? index}:${bodyIndex}`,
        at: Number(event.time ?? 0),
        threadId: call.threadId,
        speaker: { kind: "member", id: call.botId, name: call.name, avatar: call.avatar },
        text: body,
        attachments: [],
        state: resultState,
      }));
    }
    for (const pending of pendingSubmissions ?? []) {
      if (admittedRequests.has(String(pending?.requestId ?? ""))) continue;
      const envelope = parseGroupThreadEnvelope(pending?.text);
      const threadId = envelope.threadId || `pending-${String(pending?.requestId ?? messages.length).replace(/[^A-Za-z0-9._:-]/g, "-")}`;
      const attachments = (pending?.attachments ?? []).map((attachment) => ({
        type: attachment.type,
        value: attachment.value,
        preview: attachment.type === "image",
      }));
      messages.push({
        id: `pending:${pending?.requestId ?? messages.length}`,
        at: Number(pending?.time ?? Date.now()),
        threadId,
        speaker: { kind: "user", name: "" },
        text: envelope.text,
        attachments,
        state: "pending",
      });
    }
    return messages;
  }

  function groupThreadBuckets(messages) {
    const byId = new Map();
    messages.forEach((message, index) => {
      const id = message.threadId || `legacy-${index}`;
      const prior = byId.get(id);
      if (prior) prior.messages.push(message);
      else byId.set(id, { id, messages: [message], firstIndex: index });
    });
    return [...byId.values()].sort((left, right) => {
      const leftAt = left.messages[left.messages.length - 1]?.at || left.firstIndex;
      const rightAt = right.messages[right.messages.length - 1]?.at || right.firstIndex;
      return leftAt - rightAt;
    });
  }

  function groupTime(at) {
    if (!Number.isFinite(at) || at <= 0) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  }

  function GroupRoomAttachment({ attachment, loadImage, t }) {
    const [src, setSrc] = useState(attachment.preview ? attachment.value?.previewUrl || "" : "");
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (attachment.type !== "image" || attachment.preview || !attachment.value) return undefined;
      let live = true;
      Promise.resolve(loadImage(attachment.value)).then((url) => {
        if (live) setSrc(url);
      }).catch(() => {
        if (live) setFailed(true);
      });
      return () => { live = false; };
    }, [attachment.preview, attachment.type, attachment.value, loadImage]);
    if (attachment.type === "image") {
      return h("div", { className: "dshbot-thread-attachment" },
        src && !failed
          ? h("img", { src, alt: attachment.value?.name || t("groupAttachment") })
          : h("span", { className: "dshbot-thread-file-meta" }, t("groupImageUnavailable")),
      );
    }
    const name = String(attachment.value?.name ?? t("groupAttachment"));
    return h("div", { className: "dshbot-thread-attachment", title: name },
      h(DocumentFileIcon, { size: 24 }),
      h("span", { className: "dshbot-thread-file-copy" },
        h("span", { className: "dshbot-thread-file-name" }, name),
        h("span", { className: "dshbot-thread-file-meta" }, fileSizeText(Number(attachment.value?.bytes ?? 0))),
      ),
    );
  }

  function GroupThreadMessage({ message, loadImage, t }) {
    const user = message.speaker.kind === "user";
    const label = user ? t("groupYou") : message.speaker.name;
    const stateLabel = user ? "" : groupMessageStateLabel(t, message.state);
    const markdownLabels = {
      code: { copyLabel: t("groupMarkdownCopy"), copiedLabel: t("groupMarkdownCopied") },
      footnotes: t("groupMarkdownFootnotes"),
    };
    return h("div", {
      className: "dshbot-thread-message",
      "data-speaker": user ? "user" : "member",
      "data-state": message.state,
    },
      !user ? h(AvatarView, { avatar: message.speaker.avatar, seed: message.speaker.id, thinking: message.state === "pending", size: 28 }) : null,
      h("div", { className: "dshbot-thread-message-body" },
        h("div", { className: "dshbot-thread-message-meta" },
          h("span", { className: "dshbot-thread-message-name" }, label),
          stateLabel ? h("span", null, stateLabel) : null,
          groupTime(message.at) ? h("span", null, groupTime(message.at)) : null,
        ),
        message.text ? h("div", { className: "dshbot-thread-message-content", "data-selectable-text": "true" },
          h(MarkdownText, { text: message.text, labels: markdownLabels }),
        ) : null,
        message.attachments?.length ? h("div", { className: "dshbot-thread-attachments" },
          message.attachments.map((attachment, index) => h(GroupRoomAttachment, {
            key: `${attachment.type}:${index}`,
            attachment,
            loadImage,
            t,
          })),
        ) : null,
      ),
    );
  }

  function GroupRoomBody(props) {
    const {
      sessionId, matched, useSession, useInput, inputActions, useCatalog, useGroupEvents,
      useGroupRuntime, usePendingInteractions, useReplySettlement, refreshGroupRuntime,
      openEditor, stopRoom, disbandRoom, loadImage, t,
    } = props;
    const roomId = String(matched?.roomId ?? "");
    const session = typeof useSession === "function" ? useSession((value) => value) : {};
    const input = typeof useInput === "function" ? useInput((value) => value) : {};
    const catalogSnapshot = typeof useCatalog === "function" ? useCatalog((value) => value) : {};
    const eventSnapshot = typeof useGroupEvents === "function" ? useGroupEvents((value) => value) : { entries: [] };
    const runtimeSnapshot = typeof useGroupRuntime === "function" ? useGroupRuntime((value) => value) : { byRoomId: {} };
    const pendingSnapshot = typeof usePendingInteractions === "function" ? usePendingInteractions((value) => value) : new Map();
    const replySettlementSnapshot = typeof useReplySettlement === "function"
      ? useReplySettlement((value) => value)
      : {};
    const items = catalogItems(catalogSnapshot);
    const room = items.find((item) => String(item.id) === String(roomId)
      && String(item.sessionId) === String(sessionId) && item.kind === "room");
    const messages = useMemo(
      () => groupRoomMessages(eventList(eventSnapshot), items, session?.pendingSubmissions),
      [eventSnapshot, items, session?.pendingSubmissions],
    );
    const transcriptMessages = useMemo(() => messages.filter((message) => message.speaker.kind === "user"
      || Boolean(message.text)
      || (Array.isArray(message.attachments) && message.attachments.length > 0)), [messages]);
    const threads = useMemo(() => groupThreadBuckets(transcriptMessages), [transcriptMessages]);
    const newest = threads[threads.length - 1]?.id || "";
    const [openThreads, setOpenThreads] = useState({});
    const [replyStash, setReplyStash] = useState(null);
    const [replyStartSeq, setReplyStartSeq] = useState(0);
    const [activityOpen, setActivityOpen] = useState(false);
    const [stopState, setStopState] = useState({ busy: false, error: "" });
    const [disbandOpen, setDisbandOpen] = useState(false);
    const [disbandState, setDisbandState] = useState({ busy: false, error: "" });
    const scrollRef = useRef(null);
    const pinnedRef = useRef(true);
    const runtimeState = runtimeSnapshot?.byRoomId?.[roomId];
    const runtime = runtimeState?.value;
    const replySettlement = replySettlementSnapshot?.bySession?.[sessionId];
    const runtimeByBot = new Map(groupRuntimeMembers(runtime).map((member) => [String(member.botId), member]));
    const members = normalizeRoomMemberIds(room?.memberBotIds, items).map((botId) => {
      const bot = items.find((item) => item.kind === "bot" && String(item.id) === botId);
      return {
        botId,
        name: bot ? displayName(bot) : botId,
        avatar: normalizeAvatar(bot?.avatar, bot?.id || botId),
        runtime: runtimeByBot.get(botId),
      };
    });
    const activeReply = replyStash?.threadId || "";
    const roomBusy = Boolean(session?.running) || members.some(({ runtime: member }) => {
      const state = groupMemberIndicator(member, t).state;
      return state === "running" || state === "pending";
    });

    useEffect(() => {
      if (typeof refreshGroupRuntime !== "function" || !roomId) return undefined;
      void refreshGroupRuntime(roomId);
      if (!session?.running) return undefined;
      const timer = setInterval(() => { void refreshGroupRuntime(roomId); }, 1500);
      return () => clearInterval(timer);
    }, [refreshGroupRuntime, roomId, session?.running]);

    useEffect(() => {
      const node = scrollRef.current;
      if (node && pinnedRef.current) node.scrollTop = node.scrollHeight;
    }, [messages.length, newest]);

    useEffect(() => {
      if (!replyStash || !replySettlement || Number(replySettlement.seq) <= replyStartSeq) return;
      if (replySettlement.ok) setReplyStash(null);
    }, [replySettlement, replyStash, replyStartSeq]);

    useEffect(() => {
      if (!replyStash || replySettlement || input?.phase !== "plain" || String(input?.draft ?? "") !== ""
        || (Array.isArray(input?.attachmentIds) && input.attachmentIds.length > 0)) return;
      // Hosts without the optional settlement source still expose committed input state.
      setReplyStash(null);
    }, [input?.attachmentIds, input?.draft, input?.phase, replySettlement, replyStash]);

    const startThreadReply = (threadId) => {
      if (!threadId || replyStash || input?.phase !== "plain" || !inputActions) return;
      const attachmentIds = Array.isArray(input?.attachmentIds) ? [...input.attachmentIds] : [];
      setReplyStash({ threadId, draft: String(input?.draft ?? ""), attachmentIds });
      setReplyStartSeq(Number(replySettlement?.seq) || 0);
      inputActions.setDraft?.(`${GROUP_THREAD_REPLY_COMMAND} ${threadId} `);
    };
    const cancelThreadReply = () => {
      if (!replyStash || !inputActions) return;
      const currentAttachments = Array.isArray(input?.attachmentIds) ? input.attachmentIds : [];
      currentAttachments.forEach((attachmentId) => inputActions.removeAttachment?.(attachmentId));
      inputActions.setDraft?.(replyStash.draft);
      if (replyStash.attachmentIds.length > 0) inputActions.addAttachments?.(replyStash.attachmentIds);
      setReplyStash(null);
    };
    const stopGroup = async () => {
      if (stopState.busy || typeof stopRoom !== "function") return;
      setStopState({ busy: true, error: "" });
      try {
        await stopRoom(sessionId, roomId);
      } catch (error) {
        setStopState({ busy: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      setStopState({ busy: false, error: "" });
    };
    const disband = async () => {
      if (disbandState.busy || typeof disbandRoom !== "function") return;
      setDisbandState({ busy: true, error: "" });
      try {
        await disbandRoom(roomId);
        setDisbandOpen(false);
      } catch (error) {
        setDisbandState({ busy: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      setDisbandState({ busy: false, error: "" });
    };

    const activityRows = useMemo(() => {
      const rows = [];
      messages.forEach((message) => {
        if (message.threadId !== newest || message.speaker.kind !== "member" || message.text
          || (Array.isArray(message.attachments) && message.attachments.length > 0)) return;
        const label = groupMessageStateLabel(t, message.state);
        if (!label) return;
        rows.push({
          id: `execution:${message.id}`,
          at: message.at,
          state: message.state,
          text: `${message.speaker.name} · ${label}`,
        });
      });
      members.forEach(({ botId, name, runtime: member }) => {
        if (!member) return;
        const indicator = groupMemberIndicator(member, t);
        if (indicator.state === "idle" || indicator.state === "pass") return;
        rows.push({
          id: `runtime:${botId}`,
          at: Number(member.updatedAt ?? member.time ?? 0),
          state: indicator.state,
          text: `${name} · ${indicator.label}`,
        });
      });
      if (runtimeState?.status && runtimeState.status !== "ready" && runtimeState.status !== "loading") {
        rows.push({
          id: "runtime:status",
          at: 0,
          state: "error",
          text: `${runtimeState.status === "unavailable" ? t("groupRuntimeUnavailable") : t("groupRuntimeError")}${runtimeState.error ? `: ${runtimeState.error}` : ""}`,
        });
      }
      return rows.sort((left, right) => (Number(left.at) || 0) - (Number(right.at) || 0));
    }, [members, messages, newest, runtimeState, t]);
    const latestActivity = activityRows[activityRows.length - 1];
    const activityVisible = roomBusy || activityRows.length > 0;

    const renderThread = (thread) => {
      const isNewest = thread.id === newest;
      const expanded = openThreads[thread.id] ?? isNewest;
      const head = thread.messages.find((message) => message.speaker.kind === "user") || thread.messages[0];
      const replyCount = Math.max(0, thread.messages.length - 1);
      const last = thread.messages[thread.messages.length - 1];
      if (!expanded) {
        return h(Button, {
          key: thread.id,
          variant: "ghost",
          size: "sm",
          className: "dshbot-thread-fold",
          title: t("groupOpenThread"),
          "aria-label": `${t("groupOpenThread")}: ${head?.text || t("groupThreadFallback")}`,
          onClick: () => setOpenThreads((current) => ({ ...current, [thread.id]: true })),
          icon: h(IconChevronRightOutline14, { size: 14 }),
        },
          h("span", { className: "dshbot-thread-fold-text" }, head?.text || t("groupThreadFallback")),
          h("span", { className: "dshbot-thread-meta" }, `${replyCount} ${t("groupReplies")} · ${groupTime(last?.at)}`),
        );
      }
      const interactions = members.filter(({ runtime: member }) => member?.threadId === thread.id)
        .map(({ runtime: member, name }) => ({ member, name, interaction: interactionForSession(pendingSnapshot, member?.sessionId) }))
        .filter(({ interaction }) => interaction);
      return h("section", { key: thread.id, className: "dshbot-thread", "data-historical": String(!isNewest) },
        (!isNewest || openThreads[thread.id] !== undefined) ? h("div", { className: "dshbot-thread-head" },
          h(Button, {
            variant: "ghost", size: "sm", className: "dshbot-thread-collapse",
            title: t("groupCollapse"),
            "aria-label": `${t("groupCollapse")}: ${head?.text || t("groupThreadFallback")}`,
            onClick: () => setOpenThreads((current) => ({ ...current, [thread.id]: false })),
            icon: h(IconChevronDownOutline14, { size: 14 }),
          }, t("groupCollapse")),
          h("span", { className: "dshbot-thread-meta" }, `${replyCount} ${t("groupReplies")} · ${groupTime(last?.at)}`),
        ) : null,
        h("div", { className: "dshbot-thread-messages" }, thread.messages.map((message) => h(GroupThreadMessage, {
          key: message.id,
          message,
          loadImage,
          t,
        }))),
        interactions.map(({ name, member, interaction }) => h("div", { key: interaction.key || member.sessionId },
          h("div", { className: "dshbot-thread-message-meta" }, name, " · ", interactionLabel(t, interaction)),
          h(GroupPendingInteraction, { interaction, t }),
        )),
        h("div", { className: "dshbot-thread-actions" },
          h(Button, {
            variant: activeReply === thread.id ? "primary" : "ghost",
            size: "sm",
            disabled: Boolean((session?.running && activeReply !== thread.id)
              || replyStash || input?.phase !== "plain" || !inputActions),
            onClick: () => startThreadReply(thread.id),
          }, t("groupReply")),
          activeReply === thread.id ? h(Button, {
            variant: "ghost",
            size: "sm",
            "aria-label": t("cancel"),
            onClick: cancelThreadReply,
          }, t("cancel")) : null,
          activeReply === thread.id ? h("span", { className: "dshbot-thread-replying", role: "status" }, t("groupReplying")) : null,
        ),
      );
    };

    if (!room) return null;
    return h(react.Fragment, null,
      h("div", {
        className: "dshbot-room-body",
        "data-dshbot-room-body": roomId,
        "data-conversation-composer-overlay": "",
      },
        h("div", {
          className: "dshbot-room-participants",
          role: "group",
          "aria-label": `${members.length} ${t("groupMembersCount")}`,
        },
          h("div", { className: "dshbot-room-participant-list", role: "list" },
            members.map(({ botId, name, avatar, runtime: member }) => {
              const indicator = groupMemberIndicator(member, t);
              const participantLabel = `${name} · ${indicator.label}`;
              return h("span", {
                key: botId,
                className: "dshbot-room-participant",
                role: "listitem",
                title: participantLabel,
                "aria-label": participantLabel,
                "data-state": indicator.state,
              }, h(AvatarView, {
                avatar,
                seed: botId,
                thinking: indicator.state === "running" || indicator.state === "pending",
                size: 26,
              }));
            }),
          ),
          h("span", { className: "dshbot-room-member-count" }, `${members.length} ${t("groupMembersCount")}`),
          h("div", { className: "dshbot-room-participant-actions" },
            h(Tooltip, { label: t("roomSettings"), side: "bottom", delayMs: 400 },
              h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
                variant: "ghost", size: "sm", icon: h(IconSettingsOutline16, { size: 16 }),
                "aria-label": t("roomSettings"), title: t("roomSettings"),
                onClick: () => openEditor?.(room.id),
              }))),
            h(Tooltip, { label: t("groupDisband"), side: "bottom", delayMs: 400 },
              h("span", { className: "dshbot-tooltip-anchor" }, h(Button, {
                variant: "ghost", size: "sm", icon: h(IconTrashOutline16, { size: 16 }),
                "aria-label": t("groupDisband"), title: t("groupDisband"),
                disabled: disbandState.busy,
                loading: disbandState.busy,
                onClick: () => { setDisbandState({ busy: false, error: "" }); setDisbandOpen(true); },
              }))),
          ),
        ),
        activityVisible ? h("div", { className: "dshbot-room-activity" },
          h("div", { className: "dshbot-room-activity-toggle" },
            h(Button, {
              variant: "ghost", size: "sm",
              icon: h(activityOpen ? IconChevronDownOutline14 : IconChevronRightOutline14, { size: 14 }),
              "aria-expanded": activityOpen,
              "aria-label": activityOpen ? t("groupHideActivity") : t("groupShowActivity"),
              onClick: () => setActivityOpen((value) => !value),
            },
              h("span", { className: "dshbot-room-activity-summary" },
                h("span", null, t("groupActivity")),
                h("span", null, latestActivity?.text || t("groupMemberRunning")),
              ),
            ),
            roomBusy ? h(Tooltip, { label: t("groupStop"), side: "bottom", delayMs: 400 },
              h("span", { className: "dshbot-tooltip-anchor dshbot-room-activity-stop" }, h(Button, {
                variant: "ghost", size: "sm", icon: h(IconStopFill16, { size: 16 }),
                "aria-label": t("groupStop"), title: t("groupStop"),
                disabled: stopState.busy || typeof stopRoom !== "function",
                loading: stopState.busy,
                onClick: () => { void stopGroup(); },
              }))) : null,
          ),
          activityOpen && activityRows.length > 0 ? h("div", { className: "dshbot-room-activity-list", role: "log", "aria-label": t("groupActivity") },
            activityRows.slice(-20).map((row) => h("div", { key: row.id, className: "dshbot-room-activity-row", "data-state": row.state },
                h("span", { className: "dshbot-room-activity-row-copy" }, row.text),
                groupTime(row.at) ? h("span", null, groupTime(row.at)) : null,
              )),
          ) : null,
        ) : null,
        h("div", {
          className: "dshbot-room-scroll",
          ref: scrollRef,
          onScroll: (event) => {
            const node = event.currentTarget;
            pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
          },
        },
          h("div", { className: "dshbot-room-threads" },
            threads.length ? threads.map(renderThread) : h("div", { className: "dshbot-room-empty" }, t("roomEmptyHint")),
          ),
        ),
      ),
      h(Feedback, { t, error: !disbandOpen && stopState.error ? `${t("groupStopFailed")}: ${stopState.error}` : "", identity: stopState }),
      h(ConfirmActionModal, {
        t,
        open: disbandOpen,
        title: t("groupDisband"),
        body: t("groupDisbandConfirm"),
        caveat: t("groupDisbandCaveat"),
        confirmLabel: t("groupDisband"),
        busy: disbandState.busy,
        error: disbandState.error,
        feedbackIdentity: disbandState,
        onClose: () => setDisbandOpen(false),
        onConfirm: () => { void disband(); },
      }),
    );
  }

  function ParticipantBubble(props) {
    const { block } = props;
    const settled = block?.kind === "tool-result";
    const argsRaw = (settled ? block.call?.argsRaw : block?.argsRaw) ?? "";
    let botId = "";
    try {
      botId = JSON.parse(argsRaw)?.botId ?? "";
    } catch {
      botId = "";
    }
    // Each rendered text block is one send_room_message delivery (Grok
    // parity): a two-message member turn stays two visible room messages.
    const ownTexts = settled ? textsFromContent(block.content) : [];
    const resultTexts = ownTexts.length > 0
      ? ownTexts
      : (settled ? textsFromContent(block.resultView?.content) : []);
    const visibleTexts = resultTexts.map(memberVisibleText).filter(Boolean);
    const visible = visibleTexts.length > 0;
    const resultName = (typeof block?.resultView?.title === "string" && block.resultView.title)
      || (typeof block?.callView?.title === "string" && block.callView.title)
      || "";
    const catalogName = typeof props.memberName === "function" ? props.memberName(botId) : "";
    const catalogAvatar = typeof props.memberAvatar === "function" ? props.memberAvatar(botId) : undefined;
    const thinkingLabel = typeof props.thinking === "function" ? props.thinking() : "";
    const title = catalogName || resultName || (typeof block?.title === "string" && block.title) || botId || "Bot";
    const thinking = !settled;
    if (settled && !visible) {
      return h("span", { className: "dshbot-bubble-omit", "aria-hidden": "true" });
    }
    return h("div", { className: "dshbot-bubble" },
      h(AvatarView, { avatar: catalogAvatar, seed: botId, thinking, size: 32 }),
      h("div", { className: "dshbot-bubble-body" },
        h("div", { className: "dshbot-bubble-name" }, title),
        settled
          ? visibleTexts.map((text, index) => h("div", {
            key: index,
            className: "dshbot-bubble-text",
          }, text))
          : h("div", {
            className: "dshbot-bubble-text",
            "data-pending": "true",
          }, thinkingLabel),
      ),
    );
  }

  function ManagedInputControl(props) {
    const { sessionId, managedSessionId, locked, useCatalog, openEditor, t } = props;
    const targetSessionId = sessionId ?? managedSessionId;
    const catalogSnap = useCatalog((snapshot) => snapshot);
    const item = catalogItems(catalogSnap).find((entry) => entry.sessionId === targetSessionId);
    if (!item) return null;

    const room = item.kind === "room";
    const label = room
      ? t("roomSettings")
      : item.model?.provider && item.model?.model
        ? `${item.model.provider}/${item.model.model}`
        : t("applicationDefault");
    const settingsLabel = room ? t("roomSettings") : t("edit");

    return h("div", {
      className: "dshbot-managed-control",
      "data-dshbot-managed-control": "",
      "data-session-id": targetSessionId,
      "data-locked": String(Boolean(locked)),
    },
      room
        ? h("span", { className: "dshbot-managed-model", title: label },
          h(IconAgentPresetOutline16, { size: 16 }),
          h("span", { className: "dshbot-managed-label-text" }, label),
        )
        : h(Button, {
          variant: "ghost",
          size: "sm",
          className: "dshbot-managed-model",
          "data-dshbot-managed-model": "",
          "aria-label": `${t("model")}: ${label}`,
          title: label,
          onClick: () => openEditor(item.id),
          icon: h(IconAgentPresetOutline16, { size: 16 }),
        }, h("span", { className: "dshbot-managed-label-text" }, label)),
      h(Tooltip, { label: settingsLabel, side: "top", delayMs: 400 },
        h("span", { className: "dshbot-tooltip-anchor" },
          h(Button, {
            variant: "ghost",
            size: "sm",
            className: "dshbot-managed-settings",
            "data-dshbot-managed-settings": "",
            "aria-label": settingsLabel,
            title: settingsLabel,
            // This remains available while the Host blocks message submission.
            onClick: () => openEditor(item.id),
            icon: h(IconSettingsOutline16, { size: 16 }),
          }),
        ),
      ),
    );
  }

  /** 1:1 Bot objective strip in the composer dock; the catalog objective renders even while the agent is cold. */
  function ObjectiveDock(props) {
    const { sessionId, t, useCatalog, getActivity, objectiveControl, controlAvailable } = props;
    const item = useCatalog((snapshot) => catalogItems(snapshot).find(
      (entry) => entry.kind !== "room" && entry.sessionId === sessionId));
    const botId = item?.id ?? "";
    const hasObjective = Boolean(String(item?.objective ?? "").trim());
    const [goal, setGoal] = useState(null);
    const [busy, setBusy] = useState(false);
    const [pendingAction, setPendingAction] = useState("");
    const [errorState, setError] = useFeedbackError();
    const error = errorState.error;

    useEffect(() => {
      if (!botId || !hasObjective || !controlAvailable || typeof getActivity !== "function") {
        setGoal(null);
        return undefined;
      }
      let disposed = false;
      const poll = () => {
        getActivity([botId]).then((result) => {
          if (disposed) return;
          const entry = Array.isArray(result?.entries) ? result.entries[0] : null;
          setGoal(entry?.goal ?? null);
        }, () => {});
      };
      poll();
      const timer = setInterval(poll, 1500);
      return () => { disposed = true; clearInterval(timer); };
    }, [botId, hasObjective, controlAvailable, getActivity]);

    if (!item || !hasObjective) return null;
    // A live goal is already managed by the host GoalBar in the same dock;
    // this strip covers the cold / not-yet-materialized catalog objective.
    if (goal) return null;
    const limit = Number(item.objectiveMaxRounds) || OBJECTIVE_DEFAULT_MAX_ROUNDS;
    const run = async (action) => {
      if (busy || typeof objectiveControl !== "function") return;
      setBusy(true);
      setPendingAction(action);
      setError("");
      try {
        const result = await objectiveControl(action, item.id);
        if (result && Object.hasOwn(result, "goal")) setGoal(result.goal ?? null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
        setPendingAction("");
      }
    };
    return h("div", { className: "dshbot-objective", "data-dshbot-objective": "", "data-session-id": sessionId },
      h("div", { className: "dshbot-objective-row" },
        h("span", { className: "dshbot-objective-chip", "data-state": "idle" }, t("objectiveIdle")),
        h("span", { className: "dshbot-objective-text", title: String(item.objective ?? "").trim() },
          String(item.objective ?? "").trim()),
        h("span", { className: "dshbot-objective-rounds" },
          t("objectiveRoundsCap").replace("{limit}", String(limit))),
        h("div", { className: "dshbot-objective-actions" },
          h(Button, {
            variant: "ghost", size: "sm", disabled: busy || !controlAvailable,
            loading: busy && pendingAction === "start",
            "aria-label": t("objectiveStart"), title: t("objectiveStart"),
            icon: h(IconPlayOutline16, { size: 16 }),
            onClick: () => { void run("start"); },
          }, t("objectiveStart")),
          h(Button, {
            variant: "ghost", size: "sm", disabled: busy || !controlAvailable,
            loading: busy && pendingAction === "clear",
            "aria-label": t("objectiveClear"), title: t("objectiveClear"),
            icon: h(IconTrashOutline16, { size: 16 }),
            onClick: () => { void run("clear"); },
          }, t("objectiveClear")),
        ),
      ),
      h(Feedback, { t, error, identity: errorState }),
    );
  }

  function apply(ctx) {
    injectCss();
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dshbot: dictionaries");
    const t = ctx.locale.bind(NS);
    const catalog = ctx.configForms.get(CATALOG_NS);
    let editor = { open: false, mode: "edit", itemId: null, error: "", warnings: [], deletePreview: null, feedbackId: {} };
    const editorListeners = new Set();
    const editorSource = {
      getSnapshot: () => editor,
      subscribe: (listener) => {
        editorListeners.add(listener);
        return () => editorListeners.delete(listener);
      },
    };
    const setEditor = (next) => {
      editor = { ...next, feedbackId: next.feedbackId ?? {} };
      for (const listener of [...editorListeners]) listener();
    };
    const catalogSource = {
      getSnapshot: () => catalog.getSnapshot(),
      subscribe: (listener) => catalog.subscribe(listener),
    };

    const readItems = () => catalogItems(catalog.getSnapshot());
    const connection = ctx.connection ?? ctx.get("connection");
    const sessionsSvc = ctx.sessions ?? ctx.get("sessions");
    const uiWorkspace = ctx.uiWorkspace;
    const controlAvailable = typeof connection?.rpc?.call === "function";

    const acceptControlView = (view) => {
      if (view?.ns !== CATALOG_NS || !Number.isInteger(view.revision) || !view.value || typeof view.value !== "object") {
        throw new Error(t("catalogUnavailable"));
      }
      const current = catalog.getSnapshot();
      if (Number.isInteger(current?.revision) && view.revision < current.revision) throw new Error(t("saveConflict"));
      if (Number.isInteger(current?.revision) && view.revision === current.revision
        && JSON.stringify(view.value) !== JSON.stringify(current.value)) {
        throw new Error(t("saveConflict"));
      }
      const describe = ctx.configForms.describe();
      if (typeof describe?.acceptView !== "function") throw new Error(t("catalogUnavailable"));
      describe.acceptView(view);
      return view;
    };

    const dshbotRpc = async (endpoint, input = {}, unavailableMessage = t("taskControlUnavailable")) => {
      if (!controlAvailable) throw new Error(unavailableMessage);
      const result = rpcValue(await connection.rpc.call("/dshbot", endpoint, input));
      if (result?.view) acceptControlView(result.view);
      return result;
    };

    let groupRuntime = { byRoomId: {} };
    const groupRuntimeListeners = new Set();
    const groupRuntimeSource = {
      getSnapshot: () => groupRuntime,
      subscribe: (listener) => {
        groupRuntimeListeners.add(listener);
        return () => groupRuntimeListeners.delete(listener);
      },
    };
    const uiSession = ctx.uiSession ?? ctx.get?.("uiSession");
    const pendingInteractionHostSource = uiSession?.sessionStatus ?? uiSession?.pendingInteractions;
    // The current host folds pending interactions into per-session
    // SessionStatus rows (`sessionStatus`); older builds exposed the Map
    // directly (`pendingInteractions`). Project the interaction column and
    // memoize on the source snapshot — a fresh Map per getSnapshot call would
    // loop the host's synthesized hook forever.
    let pendingCache = { source: undefined, projected: new Map() };
    const pendingInteractionSource = {
      getSnapshot: () => {
        const raw = typeof pendingInteractionHostSource?.getSnapshot === "function"
          ? pendingInteractionHostSource.getSnapshot()
          : pendingInteractionHostSource?.value ?? pendingInteractionHostSource;
        if (raw === pendingCache.source) return pendingCache.projected;
        let projected = new Map();
        if (raw instanceof Map) {
          const sample = raw.values().next().value;
          if (sample !== undefined && typeof sample === "object" && "pendingInteraction" in sample) {
            for (const [id, status] of raw) {
              if (status?.pendingInteraction !== undefined) projected.set(id, status.pendingInteraction);
            }
          } else {
            projected = raw;
          }
        }
        pendingCache = { source: raw, projected };
        return projected;
      },
      subscribe: (listener) => typeof pendingInteractionHostSource?.subscribe === "function"
        ? pendingInteractionHostSource.subscribe(listener)
        : () => {},
    };
    let replySettlement = { bySession: {} };
    const replySettlementListeners = new Set();
    const replySettlementSource = {
      getSnapshot: () => replySettlement,
      subscribe: (listener) => {
        replySettlementListeners.add(listener);
        return () => replySettlementListeners.delete(listener);
      },
    };
    const publishReplySettlement = (sessionId, ok) => {
      const id = String(sessionId ?? "");
      if (!id) return;
      const previous = replySettlement.bySession[id];
      replySettlement = {
        bySession: {
          ...replySettlement.bySession,
          [id]: { seq: (Number(previous?.seq) || 0) + 1, ok: Boolean(ok) },
        },
      };
      for (const listener of [...replySettlementListeners]) listener();
    };
    const publishGroupRuntime = () => {
      for (const listener of [...groupRuntimeListeners]) listener();
    };
    const refreshGroupRuntime = async (roomId) => {
      if (!roomId) return;
      const previous = groupRuntime.byRoomId[roomId];
      groupRuntime = {
        byRoomId: {
          ...groupRuntime.byRoomId,
          [roomId]: { status: "loading", value: previous?.value ?? null, error: "" },
        },
      };
      publishGroupRuntime();
      try {
        const value = await dshbotRpc("group/runtime", { roomId }, t("groupRuntimeUnavailable"));
        if (!value || value.roomId !== roomId || !Array.isArray(value.members)) throw new Error(t("groupRuntimeError"));
        groupRuntime = { byRoomId: { ...groupRuntime.byRoomId, [roomId]: { status: "ready", value, error: "" } } };
      } catch (error) {
        groupRuntime = {
          byRoomId: {
            ...groupRuntime.byRoomId,
            [roomId]: {
              status: isRpcUnavailable(error) ? "unavailable" : "error",
              value: previous?.value ?? null,
              error: error instanceof Error ? error.message : String(error),
            },
          },
        };
      }
      publishGroupRuntime();
    };
    const controlCommand = async (endpoint, input = {}, expectedRevision, unavailableMessage) => {
      const snapshot = editableSnapshot();
      const revision = expectedRevision ?? snapshot.revision;
      if (revision !== snapshot.revision) throw new Error(t("saveConflict"));
      return dshbotRpc(endpoint, { ...input, revision }, unavailableMessage);
    };

    const profileCommand = async (endpoint, input = {}, expectedRevision) => controlCommand(
      endpoint, input, expectedRevision, t("profileTransportUnavailable"),
    );
    const describeCapabilities = async (botId) => dshbotRpc("describe", botId ? { botId } : {}, t("profileTransportUnavailable"));
    const getActivity = async (ids) => dshbotRpc("bot/activity", { ids }, t("profileTransportUnavailable"));
    const getMissedRoutines = async () => dshbotRpc("routine/missed", {}, t("profileTransportUnavailable"));
    const markRead = async (marks) => dshbotRpc("bot/mark-read", { marks }, t("profileTransportUnavailable"));
    const getMemory = async (botId) => dshbotRpc("memory/get", { id: botId }, t("profileTransportUnavailable"));
    const replaceMemory = async (botId, track, entries, expectedMemoryRevision) => dshbotRpc("memory/replace", {
      id: botId,
      track: track === "user" ? "user" : "bot",
      memoryRevision: expectedMemoryRevision,
      text: memoryText(entries),
    }, t("profileTransportUnavailable"));

    const stopRoom = async (sessionId, roomId) => {
      const binding = sessionsSvc?.binding?.(sessionId);
      if (typeof binding?.session?.cancel !== "function") throw new Error(t("groupStopFailed"));
      const result = await binding.session.cancel();
      if (result?.ok === false) throw new Error(result.error?.message || t("groupStopFailed"));
      if (roomId) void refreshGroupRuntime(roomId);
      return result;
    };
    const loadSessionImage = async (sessionId, attachment) => {
      const attachmentId = attachment?.attachmentId || attachment?.id;
      const binding = sessionsSvc?.binding?.(sessionId);
      if (!attachmentId || typeof binding?.session?.readAttachment !== "function") throw new Error(t("groupImageUnavailable"));
      const result = await binding.session.readAttachment(attachmentId);
      if (!result?.ok) throw new Error(result?.error?.message || t("groupImageUnavailable"));
      const value = result.value;
      const data = value?.data instanceof Uint8Array ? value.data : Uint8Array.from(value?.data ?? []);
      const mediaType = value?.attachment?.mediaType || attachment?.mediaType || "image/png";
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Blob === "function") {
        return URL.createObjectURL(new Blob([data], { type: mediaType }));
      }
      let binary = "";
      for (const byte of data) binary += String.fromCharCode(byte);
      return `data:${mediaType};base64,${btoa(binary)}`;
    };
    const disbandRoom = async (roomId) => {
      const snapshot = editableSnapshot();
      const result = await profileCommand("bot/delete", { id: roomId, confirmCascade: true }, snapshot.revision);
      if (!result?.view) throw new Error(t("profileTransportUnavailable"));
      await sessionsSvc?.refresh?.();
      setEditor({ open: false, mode: "edit", itemId: null, error: "", warnings: normalizeWarnings(result.warnings), deletePreview: null });
      return result;
    };

    const stampRoomPresets = (byId) => {
      const sessionsSvc = ctx.sessions ?? ctx.get("sessions");
      const note = sessionsSvc?.noteAgentPreset;
      const rows = byId ?? sessionsSvc?.list?.getSnapshot?.()?.byId;
      if (typeof note !== "function" || !rows) return;
      for (const item of readItems()) {
        if (item.kind !== "room" || !item.sessionId) continue;
        const row = rows[item.sessionId];
        if (!row || row.agentPreset === "dshbot-room") continue;
        note.call(sessionsSvc, item.sessionId, "dshbot-room");
      }
    };
    ctx.effect(() => catalog.subscribe(() => stampRoomPresets()), "dshbot: stamp room agentPreset");
    ctx.effect(() => {
      const list = (ctx.sessions ?? ctx.get("sessions"))?.list;
      if (!list?.subscribe) return undefined;
      return list.subscribe(() => stampRoomPresets());
    }, "dshbot: stamp room agentPreset on list");
    stampRoomPresets();

    const editableSnapshot = () => {
      const snapshot = catalog.getSnapshot();
      if (snapshot.status !== "ready" || !Number.isInteger(snapshot.revision)) throw new Error(t("catalogUnavailable"));
      if (!snapshot.writable || snapshot.mode !== "host") throw new Error(t("catalogReadOnly"));
      return snapshot;
    };

    const persistItems = async (items, expectedRevision = editableSnapshot().revision) => {
      const result = await controlCommand("catalog/items", { items }, expectedRevision, t("catalogUnavailable"));
      return result?.view?.revision;
    };

    const fail = (error) => {
      setEditor({ ...editor, error: error instanceof Error ? error.message : String(error), feedbackId: {} });
    };

    let openSequence = 0;
    ctx.effect(() => {
      const list = ctx.sessions.list;
      let current = list.getSnapshot().current;
      const unsubscribe = list.subscribe(() => {
        const next = list.getSnapshot().current;
        if (next !== current) { current = next; openSequence++; }
      });
      return () => { openSequence++; unsubscribe(); };
    }, "dshbot: invalidate pending opens on navigation");
    const getModelCatalog = () => ctx.remote.session.modelCatalog();
    const getScratchCwd = () => String(ctx.workspaces?.list?.getSnapshot?.()?.scratchCwd ?? "");
    const lifecycleItems = (result) => catalogItems(result?.view ?? result);
    const lifecycleItem = (result, { botId, sessionId } = {}) => {
      const rows = lifecycleItems(result);
      return rows.find((item) => (botId && item.id === botId) || (sessionId && item.sessionId === sessionId));
    };
    const lifecycleSessionId = (result, fallback, botId) => result?.sessionId
      || result?.session?.sessionId
      || result?.bot?.sessionId
      || lifecycleItem(result, { botId: botId || result?.botId })?.sessionId
      || fallback;
    const ensureCanonicalSession = async (item) => {
      if (!item?.id) throw new Error(t("participantUnavailable"));
      const result = await profileCommand("bot/open", {
        id: item.id,
        scratchCwd: getScratchCwd(),
      });
      const sessionId = lifecycleSessionId(result, item.sessionId, item.id);
      if (!sessionId) throw new Error(t("profileSessionUnavailable"));
      return sessionId;
    };
    const injectFace = () => ({
      stampRoomPresets,
      connection,
      controlAvailable,
      describeCapabilities,
      getActivity,
      getMissedRoutines,
      markRead,
      getModelCatalog,
      getMemory,
      replaceMemory,
      manageCapabilities: async (kind, requestedItem) => {
        const item = readItems().find((entry) => entry.id === requestedItem?.id && entry.sessionId === requestedItem?.sessionId);
        if (!item) throw new Error(t("participantUnavailable"));
        const navigation = ctx.settingsNavigation ?? ctx.get("settingsNavigation");
        if (typeof navigation?.open !== "function") throw new Error(t("capabilityManageUnavailable"));
        const section = kind === "skills" ? "skills" : kind === "mcp" ? "mcp" : "plugins";
        uiWorkspace.openSession(await ensureCanonicalSession(item));
        await navigation.open(section);
        setEditor({ open: false, mode: "edit", itemId: null, error: "", warnings: [], deletePreview: null });
      },
      taskControl: (action, taskId) => controlCommand(`task/${action}`, { taskId }),
      retryTask: async (task, operationId) => {
        if (!task?.id || !operationId) throw new Error(t("taskControlUnavailable"));
        const result = await controlCommand("task/retry", {
          taskId: task.id,
          requestId: operationId,
        });
        if (!result?.view || !result?.taskId) throw new Error(t("taskControlUnavailable"));
        return result;
      },
      routineControl: (action, input, revision) => controlCommand(`routine/${action}`, input, revision),
      getTriggerToken: () => dshbotRpc("bot/trigger-token", {}, t("profileTransportUnavailable")),
      sectionControl: (action, input, revision) => {
        const actions = new Set(["create", "rename", "move", "assign", "delete", "restore"]);
        if (!actions.has(action)) throw new Error(t("sectionControlUnavailable"));
        return controlCommand(`section/${action}`, input, revision, t("sectionControlUnavailable"));
      },
      stopBot: (botId) => controlCommand("bot/stop", { botId }),
      objectiveControl: (action, botId) => {
        const actions = new Set(["start", "pause", "clear"]);
        if (!actions.has(action)) throw new Error(t("taskControlUnavailable"));
        return action === "clear"
          ? controlCommand("bot/objective/clear", { id: botId })
          : dshbotRpc(`bot/objective/${action}`, { id: botId }, t("profileTransportUnavailable"));
      },
      memberName: (botId) => {
        const item = readItems().find((entry) => entry.id === botId || entry.name === botId);
        return item ? displayName(item) : "";
      },
      memberAvatar: (botId) => {
        const item = readItems().find((entry) => entry.id === botId || entry.name === botId);
        return normalizeAvatar(item?.avatar, item?.id || botId);
      },
      thinking: () => t("thinking"),
      refreshGroupRuntime,
      openSession: async (sessionId) => {
        if (!sessionId) return;
        const item = readItems().find((entry) => entry.sessionId === sessionId);
        uiWorkspace.openSession(item ? await ensureCanonicalSession(item) : sessionId);
      },
      addBot: () => {
        setEditor({ open: true, mode: "create-bot", itemId: null, revision: catalog.getSnapshot().revision, error: "", warnings: [], deletePreview: null });
      },
      createBotSubmit: async (profile) => {
        let created = false;
        try {
          const result = await profileCommand("bot/create", {
            kind: "bot",
            name: profile.name,
            title: String(profile.title ?? "").trim(),
            description: profile.description,
            avatar: profile.avatar,
            workspaceId: profile.workspaceId,
            model: profile.model,
            capabilities: profile.capabilities,
            allowedSenderIds: profile.allowedSenderIds,
            objective: profile.objective,
            objectiveMaxRounds: profile.objectiveMaxRounds,
            memoryReview: profile.memoryReview !== false,
            notify: profile.notify !== false,
            scratchCwd: getScratchCwd(),
          });
          if (!result?.view) throw new Error(t("profileTransportUnavailable"));
          created = true;
          const sessionId = lifecycleSessionId(result);
          const item = lifecycleItem(result, { sessionId, botId: result?.botId })
            || readItems().find((entry) => entry.sessionId === sessionId);
          if (!sessionId || !item) throw new Error(t("profileSessionUnavailable"));
          setEditor({ open: false, mode: "edit", itemId: null, error: "", warnings: normalizeWarnings(result.warnings), deletePreview: null });
          uiWorkspace.openSession(sessionId);
        } catch (error) {
          fail(created ? new Error(t("profileCreatedOpenFailed").replace("{message}", error instanceof Error ? error.message : String(error))) : error);
        }
      },
      createRoom: () => {
        setEditor({ open: true, mode: "create-room", itemId: null, error: "", warnings: [], deletePreview: null });
      },
      createRoomSubmit: async ({ name, description, workspaceId, memberBotIds, maxRounds, maxSpeaks }) => {
        let created = false;
        try {
          editableSnapshot();
          const memberValidation = roomMemberValidation(memberBotIds, readItems());
          if (!memberValidation.valid) {
            fail(new Error(t("membersHint")));
            return;
          }
          if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > GROUP_MAX_ROUNDS
            || !Number.isInteger(maxSpeaks) || maxSpeaks < 1 || maxSpeaks > GROUP_MAX_MEMBER_TURNS) {
            fail(new Error(t("groupLimitHint")));
            return;
          }
          const result = await profileCommand("bot/create", {
            kind: "room",
            name: name || t("defaultRoomName"),
            description: description || "",
            avatar: defaultBlobAvatar("new-room"),
            workspaceId: workspaceId || "",
            model: { provider: "", model: "", reasoningEffort: "" },
            capabilities: defaultCapabilities(),
            allowedSenderIds: [],
            scratchCwd: getScratchCwd(),
            memberBotIds: memberValidation.normalized,
            maxRounds,
            maxSpeaks,
          });
          if (!result?.view) throw new Error(t("profileTransportUnavailable"));
          created = true;
          const sessionId = lifecycleSessionId(result);
          const item = lifecycleItem(result, { sessionId, botId: result?.botId })
            || readItems().find((entry) => entry.sessionId === sessionId);
          if (!sessionId || !item) throw new Error(t("profileSessionUnavailable"));
          setEditor({ open: false, mode: "edit", itemId: null, error: "", warnings: normalizeWarnings(result.warnings), deletePreview: null });
          uiWorkspace.openSession(sessionId);
        } catch (error) {
          fail(created ? new Error(t("profileCreatedOpenFailed").replace("{message}", error instanceof Error ? error.message : String(error))) : error);
        }
      },
      openItem: async (row) => {
        const sequence = ++openSequence;
        try {
          const item = readItems().find((entry) => entry.id === row?.id);
          if (!item?.sessionId) throw new Error(t("participantUnavailable"));
          if (sequence !== openSequence) return false;
          const canonical = readItems().find((entry) => entry.id === item.id && entry.sessionId === item.sessionId);
          if (!canonical) {
            throw new Error(t("participantUnavailable"));
          }
          const sessionId = await ensureCanonicalSession(canonical);
          if (sequence !== openSequence) return false;
          uiWorkspace.openSession(sessionId);
          return true;
        } catch (error) {
          if (sequence === openSequence) fail(error);
          return false;
        }
      },
      openEditor: (itemId) => {
        setEditor({ open: true, mode: "edit", itemId, revision: catalog.getSnapshot().revision, error: "", warnings: [], deletePreview: null });
      },
      closeEditor: () => setEditor({ open: false, mode: "edit", itemId: null, error: editor.error, warnings: editor.warnings ?? [], deletePreview: null, feedbackId: editor.feedbackId }),
      requestDelete: async (itemId) => {
        setEditor({ open: true, mode: "delete", itemId, revision: catalog.getSnapshot().revision, error: "", warnings: [], deletePreview: { status: "loading" } });
        try {
          const result = await dshbotRpc("bot/delete-preview", { id: itemId }, t("profileTransportUnavailable"));
          if (!result?.dependencies || !Object.hasOwn(result, "preserves")) throw new Error(t("deletePreviewUnavailable"));
          setEditor({ open: true, mode: "delete", itemId, revision: catalog.getSnapshot().revision, error: "", warnings: normalizeWarnings(result.warnings), deletePreview: {
            status: "ready", dependencies: result.dependencies, preserves: result.preserves,
          } });
        } catch (error) {
          setEditor({ open: true, mode: "delete", itemId, revision: catalog.getSnapshot().revision, error: error instanceof Error ? error.message : String(error), warnings: [], deletePreview: {
            status: "unavailable", error: error instanceof Error ? error.message : String(error),
          } });
        }
      },
      confirmDelete: async (itemId) => {
        try {
          const item = readItems().find((entry) => entry.id === itemId);
          if (!item) throw new Error(t("saveConflict"));
          if (editor.deletePreview?.status !== "ready") throw new Error(t("deletePreviewUnavailable"));
          const result = await profileCommand("bot/delete", { id: itemId, confirmCascade: true }, editor.revision);
          if (!result?.view) throw new Error(t("profileTransportUnavailable"));
          await ctx.sessions.refresh();
          setEditor({ open: false, mode: "edit", itemId: null, error: "", warnings: normalizeWarnings(result.warnings), deletePreview: null });
        } catch (error) {
          fail(error);
        }
      },
      duplicateItem: async (itemId) => {
        const source = readItems().find((item) => item.id === itemId);
        if (!source) return;
        let created = false;
        try {
          const result = await profileCommand("bot/duplicate", {
            id: itemId,
            scratchCwd: getScratchCwd(),
          });
          if (!result?.view) throw new Error(t("profileTransportUnavailable"));
          created = true;
          const sessionId = lifecycleSessionId(result);
          const copy = lifecycleItem(result, { sessionId, botId: result?.botId })
            || readItems().find((entry) => entry.sessionId === sessionId);
          if (!sessionId || !copy) throw new Error(t("profileSessionUnavailable"));
          setEditor({ open: false, mode: "edit", itemId: null, error: "", warnings: normalizeWarnings(result.warnings), deletePreview: null });
          uiWorkspace.openSession(sessionId);
        } catch (error) {
          fail(created ? new Error(t("profileCreatedOpenFailed").replace("{message}", error instanceof Error ? error.message : String(error))) : error);
        }
      },
      togglePin: async (itemId) => {
        const items = readItems();
        const source = items.find((item) => item.id === itemId);
        if (!source) return;
        const pinned = source.pinned !== true;
        const maxOrder = items
          .filter((item) => item.pinned)
          .reduce((max, item) => Math.max(max, Number(item.pinOrder) || 0), 0);
        await persistItems(upsertItem(items, {
          ...source,
          pinned,
          pinOrder: pinned ? maxOrder + 1 : 0,
          updatedAt: Date.now(),
        })).catch(fail);
      },
      toggleHide: async (itemId) => {
        const items = readItems();
        const source = items.find((item) => item.id === itemId);
        if (!source) return;
        await persistItems(upsertItem(items, {
          ...source,
          hidden: source.hidden !== true,
          updatedAt: Date.now(),
        })).catch(fail);
      },
      saveItem: async (next, { workspaceLocked, sourcePolicy, capabilityCatalog: availableCapabilities } = {}) => {
        let saved = false;
        try {
          const snapshot = editableSnapshot();
          if (snapshot.revision !== editor.revision) throw new Error(t("saveConflict"));
          const current = readItems().find((item) => item.id === next.id);
          if (!current) throw new Error(t("saveConflict"));
          const editableFields = ["name", "title", "description", "avatar", "workspaceId", "model", "allowedSenderIds", "memberBotIds", "capabilities", "maxRounds", "maxSpeaks", "objective", "objectiveMaxRounds", "memoryReview", "notify", "updatedAt"];
          const patch = Object.fromEntries(editableFields.filter((key) => Object.hasOwn(next, key)).map((key) => [key, next[key]]));
          next = { ...current, ...patch, workspaceId: (Object.hasOwn(patch, "workspaceId") ? patch.workspaceId : current.workspaceId) || "" };
          if (Object.hasOwn(patch, "model")) {
            const sameRoute = patch.model?.provider === current.model?.provider && patch.model?.model === current.model?.model;
            next.model = patch.model?.provider && patch.model?.model
              ? { ...patch.model, reasoningEffort: patch.model.reasoningEffort ?? (sameRoute ? current.model?.reasoningEffort ?? "" : "") }
              : { provider: "", model: "", reasoningEffort: "" };
          }
          if (current.kind !== "room" && Object.hasOwn(patch, "allowedSenderIds")) {
            const ids = patch.allowedSenderIds;
            const valid = Array.isArray(ids) && ids.every((id) => id !== current.id && readItems().some((entry) => entry.id === id && entry.kind !== "room"));
            if (!valid || (sourcePolicy === "selected" && ids.length === 0)) throw new Error(t("invalidSources"));
            next.allowedSenderIds = [...new Set(ids)];
          }
          if (Object.hasOwn(patch, "capabilities")) {
            const normalized = normalizeCapabilities(patch.capabilities);
            if (availableCapabilities && !capabilitySelectedNamesAreValid(normalized, availableCapabilities)) {
              throw new Error(t("capabilityInvalid"));
            }
            next.capabilities = normalized;
          }
          if (current.kind === "room") {
            const memberValidation = roomMemberValidation(next.memberBotIds, readItems());
            if (!memberValidation.valid) throw new Error(t("membersHint"));
            const maxRounds = Object.hasOwn(patch, "maxRounds") ? patch.maxRounds : current.maxRounds;
            const maxSpeaks = Object.hasOwn(patch, "maxSpeaks") ? patch.maxSpeaks : current.maxSpeaks;
            if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > GROUP_MAX_ROUNDS
              || !Number.isInteger(maxSpeaks) || maxSpeaks < 1 || maxSpeaks > GROUP_MAX_MEMBER_TURNS) {
              throw new Error(t("groupLimitHint"));
            }
            next.memberBotIds = memberValidation.normalized;
            next.maxRounds = maxRounds;
            next.maxSpeaks = maxSpeaks;
          } else {
            next.maxRounds = current.maxRounds;
            next.maxSpeaks = current.maxSpeaks;
            const rounds = Object.hasOwn(patch, "objectiveMaxRounds") ? Number(patch.objectiveMaxRounds)
              : (Number.isInteger(current.objectiveMaxRounds) ? current.objectiveMaxRounds : OBJECTIVE_DEFAULT_MAX_ROUNDS);
            if (!Number.isInteger(rounds) || rounds < 1 || rounds > OBJECTIVE_MAX_ROUNDS) {
              throw new Error(t("objectiveRoundsHint"));
            }
            next.objectiveMaxRounds = rounds;
            next.objective = String(Object.hasOwn(patch, "objective") ? patch.objective ?? "" : current.objective ?? "");
          }
          const workspaceChanged = (current.workspaceId || "") !== (next.workspaceId || "");
          if (workspaceChanged && workspaceLocked) next = { ...next, workspaceId: current.workspaceId };
          const profileUpdate = {
            id: current.id,
            name: next.name,
            description: next.description,
            avatar: next.avatar,
            workspaceId: next.workspaceId || "",
            model: next.model,
            allowedSenderIds: next.allowedSenderIds,
            capabilities: next.capabilities,
            scratchCwd: getScratchCwd(),
          };
          if (current.kind !== "room") Object.assign(profileUpdate, {
            title: String(next.title ?? "").trim(),
            objective: String(next.objective ?? ""),
            objectiveMaxRounds: next.objectiveMaxRounds,
            memoryReview: next.memoryReview !== false,
            notify: next.notify !== false,
          });
          if (current.kind === "room") Object.assign(profileUpdate, {
            memberBotIds: next.memberBotIds,
            maxRounds: next.maxRounds,
            maxSpeaks: next.maxSpeaks,
          });
          const result = await profileCommand("bot/update", profileUpdate, snapshot.revision);
          if (!result?.view) throw new Error(t("profileTransportUnavailable"));
          saved = true;
          const returned = lifecycleItem(result, { botId: current.id });
          const sessionId = lifecycleSessionId(result, returned?.sessionId || current.sessionId, current.id);
          const updated = returned || { ...next, sessionId };
          if (!sessionId || !updated) throw new Error(t("profileSessionUnavailable"));
          const warnings = normalizeWarnings(result.warnings);
          setEditor(warnings.length > 0
            ? { open: true, mode: "edit", itemId: current.id, revision: result.view.revision, error: "", warnings, deletePreview: null }
            : { open: false, mode: "edit", itemId: null, error: "", warnings: [], deletePreview: null });
          uiWorkspace.openSession(sessionId);
        } catch (error) {
          fail(saved ? new Error(t("profileSavedOpenFailed").replace("{message}", error instanceof Error ? error.message : String(error))) : error);
          return false;
        }
      },
      hooks: {
        catalog: catalogSource,
        editor: editorSource,
        groupRuntime: groupRuntimeSource,
        pendingInteractions: pendingInteractionSource,
      },
    });

    const emptyGroupEventSource = {
      getSnapshot: () => ({ entries: [], hasMore: false, revision: 0 }),
      subscribe: () => () => {},
    };
    const roomPresentationOwnerPrefix = "dshbot:room:";
    ctx.slots.inject("conversation.session.body", () => ctx.slots.register({
      name: "conversation.session.body",
      locale: NS,
      priority: -10,
      select: (owner) => {
        const ownerId = typeof owner?.presentation?.owner === "string"
          ? owner.presentation.owner
          : "";
        if (!ownerId.startsWith(roomPresentationOwnerPrefix)) return null;
        const roomId = ownerId.slice(roomPresentationOwnerPrefix.length);
        return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(roomId) ? { roomId } : null;
      },
      inject: (sessionId) => {
        const binding = sessionsSvc?.binding?.(sessionId);
        return {
          openEditor: (roomId) => {
            setEditor({ open: true, mode: "edit", itemId: roomId, revision: catalog.getSnapshot().revision, error: "", warnings: [], deletePreview: null });
          },
          stopRoom,
          disbandRoom,
          loadImage: (attachment) => loadSessionImage(sessionId, attachment),
          hooks: {
            catalog: catalogSource,
            groupEvents: binding?.eventSource ?? emptyGroupEventSource,
            groupRuntime: groupRuntimeSource,
            pendingInteractions: pendingInteractionSource,
            replySettlement: replySettlementSource,
          },
        };
      },
    }, GroupRoomBody));

    ctx.slots.inject("shell.overlay", () => ctx.slots.register({
      name: "shell.overlay",
      id: "dshbot-editor",
      locale: NS,
      inject: injectFace,
    }, EditorOverlay));

    // Prefer region tabs; keep the footer entry for hosts without that seat.
    let sidebarInstalled = false;
    const installSidebar = () => {
      if (sidebarInstalled) return;
      if (hostDeclaresRegionTabs(ctx.slots)) {
        sidebarInstalled = true;
        ctx.slots.inject("sidebar.nav.tab", () => ctx.slots.register({
          name: "sidebar.nav.tab", id: TAB_ID, order: 10, label: () => t("tab"), locale: NS,
        }, DummyTab));
        ctx.slots.inject("sidebar.page", () => ctx.slots.register({
          name: "sidebar.page", key: TAB_ID, locale: NS, inject: injectFace,
        }, BotPage));
      } else if (hostDeclaresFooterAction(ctx.slots)) {
        sidebarInstalled = true;
        ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
          name: "sidebar.footer.action", id: "dshbot-bots", order: 10, locale: NS, inject: injectFace,
        }, OfficialBotsEntry));
      }
    };
    ctx.effect(() => {
      // Slot declarations can arrive after this plugin activates during parallel boot.
      const subscriptions = ["sidebar.nav.tab", "sidebar.page", "sidebar.footer.action"]
        .map((key) => ctx.slots.subscribe?.(key, installSidebar));
      installSidebar();
      return () => { for (const unsubscribe of subscriptions) unsubscribe?.(); };
    });

    ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
      name: "tool.call.toolview",
      key: "ask_participant",
      locale: NS,
      inject: injectFace,
    }, ParticipantBubble));

    ctx.slots.inject("conversation.chat.empty", () => ctx.slots.register({
      name: "conversation.chat.empty",
      id: "dshbot-roster",
      locale: NS,
      inject: injectFace,
    }, EmptyRoster));

    ctx.slots.inject("conversation.input.managed", () => ctx.slots.register({
      name: "conversation.input.managed",
      locale: NS,
      inject: (sessionId) => ({ ...injectFace(), managedSessionId: sessionId }),
    }, ManagedInputControl));

    ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
      name: "conversation.input.dock",
      id: "dshbot-objective",
      order: 20,
      locale: NS,
      inject: injectFace,
    }, ObjectiveDock));

    const inputTriggers = ctx.inputTriggers ?? ctx.get("inputTriggers");
    if (inputTriggers?.registerSource) {
      ctx.effect(() => inputTriggers.registerSource({
        trigger: "/",
        name: "dshbot-room-reply",
        order: 10,
        candidates: () => Promise.resolve([]),
        onPick: () => undefined,
        matchEnter: async (session, line, signal) => {
          void signal;
          const room = readItems().find((item) => item.sessionId === session.sessionId && item.kind === "room");
          const target = parseGroupThreadReplyLine(line);
          if (!room || !target) return undefined;
          return {
            claim: {
              token: `${GROUP_THREAD_REPLY_COMMAND} `,
              attachments: true,
              submit: async (args, _actx, attachments) => {
                const parsed = parseGroupThreadReplyArgs(args);
                if (!parsed) return { kind: "error", text: t("groupInteractionFailed") };
                const binding = sessionsSvc?.binding?.(session.sessionId);
                const face = binding?.session;
                if (typeof face?.prompt !== "function") {
                  publishReplySettlement(session.sessionId, false);
                  return { kind: "error", text: t("groupInteractionFailed") };
                }
                const encoded = encodeGroupThreadEnvelope(parsed.threadId, parsed.text);
                const inputAttachments = Array.isArray(attachments) ? attachments : [];
                const content = [...inputAttachments, { type: "text", text: encoded }];
                const pendingAttachments = inputAttachments.map((attachment) => attachment.type === "image"
                  ? { type: "image", value: { previewUrl: `data:${attachment.mediaType};base64,${attachment.data}`, ...(attachment.name ? { name: attachment.name } : {}) } }
                  : { type: "file", value: { name: t("groupAttachment"), bytes: 0 } });
                let submission;
                try {
                  submission = typeof face.beginSubmission === "function"
                    ? face.beginSubmission({ mode: "queue", text: encoded, attachments: pendingAttachments })
                    : null;
                  const result = await face.prompt(content, "queue", undefined, submission?.requestId);
                  const ok = Boolean(result?.ok);
                  publishReplySettlement(session.sessionId, ok);
                  return ok ? { kind: "success" } : { kind: "error", text: t("groupInteractionFailed") };
                } catch (error) {
                  submission?.abandon?.();
                  publishReplySettlement(session.sessionId, false);
                  return { kind: "error", text: error instanceof Error ? error.message : String(error) };
                }
              },
            },
          };
        },
      }), "dshbot: room replies");
      ctx.effect(() => inputTriggers.registerSource({
        trigger: "@",
        name: "dshbot",
        order: 0,
        candidates(session, req) {
          const items = readItems();
          const room = items.find((item) => item.sessionId === session.sessionId && item.kind === "room");
          if (!room) return Promise.resolve([]);
          const needle = String(req.query ?? "").trim().toLowerCase();
          const rows = [];
          if (!needle || "everyone".includes(needle) || "all".includes(needle)) {
            rows.push({ name: "everyone", value: "everyone" });
          }
          for (const id of room.memberBotIds ?? []) {
            const bot = items.find((item) => item.id === id && item.kind !== "room");
            if (!bot) continue;
            const name = stableName(bot);
            const label = displayName(bot);
            if (!name) continue;
            if (needle && !label.toLowerCase().includes(needle) && !name.toLowerCase().includes(needle) && !String(id).toLowerCase().includes(needle)) continue;
            rows.push({ name: label || name, value: name, hint: label && label !== name ? `@${name}` : undefined });
          }
          return Promise.resolve(rows);
        },
        lexicon(session) {
          const items = readItems();
          const room = items.find((item) => item.sessionId === session.sessionId && item.kind === "room");
          if (!room) return [];
          const names = (room.memberBotIds ?? []).map((id) => {
            const bot = items.find((item) => item.id === id && item.kind !== "room");
            return stableName(bot);
          }).filter(Boolean);
          return ["everyone", ...names];
        },
        subscribeLexicon(_session, listener) {
          return catalog.subscribe(listener);
        },
        onPick({ candidate }) {
          return { text: `@${candidate.value || candidate.name} ` };
        },
      }), "dshbot: @ members");
    }
  }

  exports.name = "dsh-bot";
  exports.inject = ["slots", "locale", "sessions", "uiSession", "uiWorkspace", "workspaces", "configForms", "settingsNavigation", "connection", "remote", "remote.session", "inputTriggers"];
  exports.apply = apply;
  return module.exports;
}});
