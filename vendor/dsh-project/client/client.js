/**
 * WhaleIsle Projects — Client half.
 *
 * Full-page project workspace registered through four DSH slots:
 *   1. `sidebar.panellist` (id: 'projects', order: 30) — left sidebar entry.
 *   2. `main` (key: 'projects') — Overview canvas + 1–2 column Project workspace.
 *   3. `projects.conversation` — embedded native DSH conversation surface.
 *   4. `tool.call.toolview` (key: 'projects_dispatch') — clickable dispatch card.
 *
 * Layout model:
 *   - Overview (0 projects): centered empty state, zero split panes.
 *   - Overview (>= 1 projects, when navigating back): centered 920px card grid.
 *   - Workspace: single 48px Row-1 topbar (project switcher, workspace capsule,
 *     dispatch/pause pills, settings, tasks toggle) + wide Main Stage (coordinator
 *     chat or wide task detail drill-in with Chat/Diff tabs) + optional right
 *     Tasks drawer (auto-collapsed when 0 tasks, auto-expanded when tasks exist).
 *
 * Data flows through same-origin `/projects-api/*` REST routes and real-time
 * `EventSource('/projects-api/events')` SSE updates. All styling strictly uses
 * `--dsw-*` / `--ds-*` design tokens and `@deepseek-ai/dsh-client-ui-primitives`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-project',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React
    const Primitives = require('@deepseek-ai/dsh-client-ui-primitives') || {}

    const NS = 'dsh-project'
    const PANEL_ID = 'projects'
    const API_BASE = '/projects-api'

    // =========================================================================
    // Section 1: Constants, Localization (zh / en), and Token-Only Stylesheet
    // =========================================================================

    const EXEC_DEFAULT_WIDTH = 340
    const EXEC_MIN_WIDTH = 280
    const EXEC_MAX_WIDTH = 520
    const MAIN_MIN_WIDTH = 400
    const EXEC_DOCK_MIN = MAIN_MIN_WIDTH + EXEC_MIN_WIDTH
    const TOPBAR_HIDE_WS_WIDTH = 780
    const MENU_MARGIN = 8
    const MAX_CONCURRENCY = 8
    const TOAST_HOLD_MS = 4500
    const GENERIC_EFFORTS = ['off', 'low', 'high', 'max']
    const SSE_MIN_DELAY_MS = 1000
    const SSE_MAX_DELAY_MS = 30000

    const THREAD_GROUPS = [
      { key: 'waiting', icon: 'waiting', titleKey: 'groupWaiting', statuses: ['blocked', 'failed'] },
      { key: 'running', icon: 'running', titleKey: 'groupRunning', statuses: ['running'] },
      { key: 'review', icon: 'review', titleKey: 'groupReview', statuses: ['review'] },
      { key: 'idle', icon: 'idle', titleKey: 'groupIdle', statuses: ['queued'] },
      { key: 'resolved', icon: 'resolved', titleKey: 'groupResolved', statuses: ['resolved'] },
    ]

    const DEFAULT_COLLAPSED_GROUPS = { resolved: true }

    const ZH = {
      nav: '项目',
      title: '项目',
      projects: '项目',
      allProjects: '全部项目',
      switchProject: '切换项目',
      project: '项目',
      newProject: '新建项目',
      emptyHeroTitle: '用项目并行推进复杂目标',
      emptyHeroDesc: '创建一个项目，协调者会帮你拆解目标、并行派发执行者并持续汇总进度。',
      projectName: '项目名称',
      projectNamePlaceholder: '例如：接口重构、发布前巡检…',
      instructions: '项目指令',
      instructionsHint: '作为长期背景与约束实时注入协调者和每位执行者。',
      instructionsPlaceholder: '目标、范围、代码规范、验收标准…',
      workspace: '工作区',
      chooseFolder: '选择文件夹',
      clear: '清除',
      noWorkspace: '未选择目录（继承默认工作目录）',
      openFolder: '打开工作目录',
      autonomy: '派发模式',
      autonomyManual: '手动审批',
      autonomyManualOption: '手动逐条审批',
      autonomyAuto: '自动并行',
      autonomyManualHint: '每条任务需人工批准后，协调者才可派发执行。',
      autonomyAutoHint: '协调者先澄清需求，再自动并行派发线程，完成后回流汇总。',
      pausedBadge: '已暂停',
      pauseProject: '暂停派发',
      resumeProject: '恢复派发',
      pausedHint: '开启后阻止新任务派发，已运行的执行者不受影响。',
      concurrency: '并发上限',
      concurrencyHint: '同时运行的执行者线程数（1–8）。',
      worktreeIsolation: '独立 Git Worktree',
      worktreeIsolationHint: '为每个任务创建独立工作树与分支，互不覆盖改动；非 Git 目录自动降级。',
      create: '创建项目',
      cancel: '取消',
      save: '保存',
      close: '关闭',
      confirm: '确认',
      retryAction: '重试',
      settings: '项目设置',
      settingsNav: '设置分组',
      general: '通用',
      threads: '线程',
      threadsPanelTitle: '项目上下文',
      drawerTabs: '项目上下文视图',
      drawerTabThreads: '线程',
      drawerTabLibrary: '资料',
      drawerTabMemory: '记忆',
      libraryReferences: '参考资料',
      libraryArtifacts: '任务产物',
      libraryAddFile: '添加文件',
      libraryPathLabel: '参考文件路径',
      libraryPathPlaceholder: '输入工作区相对路径或绝对路径…',
      libraryPathRequired: '请输入文件路径。',
      libraryTitleLabel: '资料标题',
      libraryTitlePlaceholder: '显示名称（可选）',
      libraryNoteLabel: '资料备注',
      libraryNotePlaceholder: '一句话说明用途（可选）',
      libraryPickDir: '选择目录',
      libraryAddConfirm: '添加',
      libraryRemoveRef: '移除参考资料',
      libraryMissing: '文件缺失',
      libraryRefAdded: '参考资料已添加。',
      libraryRefRemoved: '已移除参考资料引用。',
      libraryEmptyRefs: '暂无参考资料，添加文档或规范供协调者与执行者按需查阅。',
      libraryEmptyArtifacts: '执行者交付的产物与变更文件会自动归集于此。',
      libraryOpenFile: '打开预览',
      libraryJumpTask: '查看来源任务',
      rulesSection: '项目规则',
      rulesEmpty: '尚未设置项目规则，点击编辑以约束协调者与执行者。',
      rulesSaved: '项目规则已保存。',
      memorySearchPlaceholder: '搜索共享记忆…',
      memorySearchLabel: '搜索共享记忆',
      memorySearchEmpty: '没有匹配的共享记忆。',
      memoryPin: '置顶主题',
      memoryUnpin: '取消置顶',
      memoryPinned: '已置顶',
      memoryTokensUnit: 'tokens',
      memorySourceTask: '来源任务',
      diffRequestChanges: '提修改',
      diffFeedbackLabel: '向此执行者发修改意见',
      diffFeedbackPlaceholder: '输入修改意见，Enter 发送给此执行者…',
      diffFeedbackUnavailable: '当前任务无活跃执行者会话，无法直接发送修改意见。',
      diffFeedbackSend: '发送',
      diffFeedbackSent: '已发送修改意见给执行者。',
      mergeClean: '可无冲突合并',
      mergeConflicts: '存在合并冲突',
      mergeDirtyWorktree: '工作树有未提交改动',
      mergeDirtyWorkspace: '主工作区有未提交改动',
      mergeAlreadyMerged: '已合并',
      statusWaiting: '等你处理',
      statusRunning: '执行中',
      statusReview: '待验收',
      statusIdle: '空闲',
      threadsSettings: '执行线程',
      threadsHint: '配置本项目执行者的默认派发策略、并发上限、预设、模型路由与目录隔离。',
      backToCoordinator: '返回协调者',
      memory: '共享记忆',
      memoryHint: '按主题分文件保存项目长期知识；执行者按索引按需读取与追加。',
      memoryEmpty: '还没有共享记忆主题。',
      memoryNewTopic: '新建主题',
      memoryTopicName: '主题标识',
      memoryTopicNamePlaceholder: '例如：architecture-notes',
      memoryTopicDesc: '一句话摘要',
      memoryTopicDescPlaceholder: '供索引展示的简短说明（可选）',
      memoryBody: '正文内容',
      memoryPlaceholder: '记录关键结论、约定、踩坑与依赖关系…',
      memoryFiles: '个主题',
      memoryChars: '字',
      memoryBudget: '预算',
      memoryAutoCompact: '超预算自动归档',
      memoryAutoCompactHint: '总字数超出预算时，自动将最旧整文件移入 archive/（永不拆分单文件）。',
      memoryIndex: '索引',
      memoryReadOnly: '只读',
      memoryStale: '已过时',
      memoryArchived: '已归档',
      memoryIndexDesc: '由各主题文件自动生成的共享记忆索引',
      memoryIndexHint: 'MEMORY.md 每次写入自动重建，仅可只读查看；请编辑或删除具体主题文件。',
      memoryArchivedHint: '该文件已由自动压缩移至 memory/archive/，此处仅可查看。',
      memoryLoading: '正在读取…',
      memoryLoadFailed: '读取记忆文件失败',
      memoryEditFile: '编辑',
      memoryDeleteFile: '删除主题',
      memoryDeleteConfirm: '确认删除',
      memoryDeleted: '主题已删除。',
      memoryNameRequired: '请输入主题标识。',
      memoryTextRequired: '请输入正文内容。',
      model: '默认模型',
      agentPreset: '默认预设',
      agentPresetDefault: '默认（继承宿主）',
      agentPresetPlaceholder: '输入预设 ID（可选）',
      agentPresetFreeTextHint: '当前无法枚举预设列表，可手填预设 ID。',
      reasoningEffort: '思考强度',
      effortShort: '思考',
      modelDefault: '默认（继承宿主）',
      effortDefault: '默认（跟随模型）',
      modelRoutePlaceholder: 'provider/model',
      modelFreeTextHint: '当前无法枚举模型列表，可手填 provider/model。',
      effortFreeTextHint: '当前无法枚举思考强度，可手填档位 ID（如 low / high）。',
      effortOff: '关闭',
      effortLow: '低',
      effortHigh: '高',
      effortMax: '最高',
      effectiveModel: '生效模型',
      fromTask: '任务覆盖',
      fromProject: '项目默认',
      fromHost: '宿主默认',
      archiveSection: '归档与删除',
      archiveWarning: '归档后项目移入归档列表并停止新派发；任务、记忆与会话保留，关联工作树会被清理。',
      archive: '归档项目',
      archiveConfirm: '确认归档',
      unarchive: '恢复项目',
      archivedBadge: '已归档',
      archivedProjects: '已归档',
      showArchived: '显示已归档',
      archivedHint: '项目已归档，请先在设置中恢复后再继续对话或派发任务。',
      openSettings: '打开设置',
      deleteProject: '删除项目',
      deleteProjectTitle: '永久删除该项目？',
      deleteProjectDesc: '将停止该项目下仍在运行的任务、清理关联工作树并永久删除项目记录与共享记忆。你的真实工作区源码不会被删除。',
      deleteProjectArchiveSessions: '同时归档项目关联的协调者与执行者会话',
      deleteProjectConfirm: '确认删除项目',
      projectDeleted: '项目已删除。',
      noProjects: '还没有项目。新建一个项目，让协调者帮你并行推进。',
      noActiveProjects: '当前没有活跃项目，可新建项目或查看已归档项目。',
      nameRequired: '请输入项目名称。',
      preparingCoordinator: '正在准备协调者会话…',
      coordinatorArchived: '协调者会话已归档，新消息不会触发运行。恢复后可继续对话。',
      restore: '恢复会话',
      coordinatorChatFailed: '无法加载内嵌协调者会话。',
      workerChatFailed: '无法加载执行者会话。',
      noConversation: '该任务尚未启动执行者会话。',
      taskBriefHeading: '任务说明',
      emptyTasks: '还没有执行任务。在左侧对话告诉协调者目标，由它拆解并派发。',
      noMatches: '没有匹配的任务。',
      noTask: '该任务已不在当前项目中。',
      searchThreads: '搜索任务',
      filterThreads: '筛选分组',
      filterGroups: '显示的分组',
      showAllGroups: '显示全部分组',
      collapseAll: '全部折叠',
      expandAll: '全部展开',
      collapseThreads: '收起任务栏',
      expandThreads: '展开任务栏',
      resizeColumns: '拖拽调整栏宽',
      groupRunning: '执行中',
      groupReview: '待验收',
      groupWaiting: '等你处理',
      groupIdle: '待开始',
      groupResolved: '已解决',
      queued: '待开始',
      running: '执行中',
      review: '待验收',
      failed: '失败',
      blocked: '受阻',
      resolved: '已解决',
      needsApproval: '待批准',
      approve: '批准',
      approvedBadge: '已批准',
      stop: '停止',
      retry: '重试',
      resolve: '验收解决',
      unresolve: '退回待验收',
      resolvedBadge: '已解决',
      delete: '删除',
      deleteConfirm: '确认删除任务',
      deleteOnlyTask: '只删任务',
      deleteOnlyTaskHint: '保留执行者会话与历史记录。',
      deleteAndArchive: '删除并归档会话',
      archiveSessionHint: '归档执行者会话（移出侧栏且不再运行），不释放磁盘空间。',
      deleteArchived: '任务已删除，执行者会话已归档。',
      archiveRunning: '执行者仍在运行，请先停止或等待其结束。',
      archiveParamRejected: '归档参数被拒绝，任务未删除：',
      taskRetriedDispatched: '任务已重新派发。',
      taskRetriedQueued: '任务已重置为待开始，可在对话中让协调者派发。',
      taskStopped: '已请求停止该任务。',
      tabChat: '对话',
      tabDiff: '改动',
      taskViewTabs: '任务详情视图',
      diffLoading: '正在读取改动…',
      diffEmpty: '当前没有文件改动。',
      diffUnavailable: '无法读取 Git 改动。',
      diffTruncated: '差异过长，仅展示前一部分。',
      diffFilesCount: '个文件变更',
      diffRefresh: '刷新',
      diffAdded: '新增',
      diffModified: '修改',
      diffDeleted: '删除',
      diffRenamed: '重命名',
      diffUntracked: '未跟踪',
      worktreeMerge: '合并到主分支',
      worktreeMergeTitle: '合并工作树到主分支？',
      worktreeMergeDesc: '将分支 {branch} 的改动合并回主工作区。若存在冲突或主工作区有冲突改动，操作会被安全中止。',
      worktreeMerged: '已合并到主分支。',
      worktreeCleanup: '清理工作树',
      worktreeCleanupTitle: '清理此任务的工作树？',
      worktreeCleanupDesc: '将强制移除该任务的独立工作树目录与分支（包含未提交改动），任务记录与会话不受影响。',
      worktreeCleaned: '工作树已清理。',
      worktreeWorkspaceMissing: '已开启独立工作树，但工作区目录缺失，已降级到默认目录运行。',
      worktreeNotGit: '已开启独立工作树，但当前目录不是 Git 仓库，已降级到共享目录运行。',
      isolatedBranch: '独立分支',
      copyBranch: '复制分支名',
      branchCopied: '分支名已复制。',
      copyFailed: '剪贴板不可用，无法复制分支名。',
      switchDiscardTitle: '放弃未保存修改？',
      switchDiscardDesc: '当前项目设置有未保存的更改，切换项目将丢弃这些修改。',
      discardAndSwitch: '放弃并切换',
      keepEditing: '继续编辑',
      dispatchCard: '派发任务',
      dispatchPreparing: '正在派发…',
      dispatchOpenHint: '点击查看该执行者详情',
      taskActions: '任务操作',
      justNow: '刚刚',
      counts: '个任务',
      unsavedTag: '未保存',
      sessionUnavailable: '当前环境不支持会话服务。',
      pickerUnavailable: '当前环境不支持目录选择器。',
      errorPrefix: '操作失败：',
    }

    const EN = {
      nav: 'Projects',
      title: 'Projects',
      projects: 'Projects',
      allProjects: 'All projects',
      switchProject: 'Switch project',
      project: 'Project',
      newProject: 'New project',
      emptyHeroTitle: 'Run complex goals in parallel',
      emptyHeroDesc: 'Create a project and the coordinator will split goals, dispatch parallel workers, and report progress.',
      projectName: 'Project name',
      projectNamePlaceholder: 'e.g. API Refactor, Release Audit…',
      instructions: 'Project instructions',
      instructionsHint: 'Live goal, constraints, and acceptance conventions injected into coordinator and workers.',
      instructionsPlaceholder: 'Goal, scope, conventions, verification criteria…',
      workspace: 'Workspace',
      chooseFolder: 'Choose folder',
      clear: 'Clear',
      noWorkspace: 'No folder (inherits default directory)',
      openFolder: 'Open workspace folder',
      autonomy: 'Dispatch mode',
      autonomyManual: 'Manual approval',
      autonomyManualOption: 'Manual per task',
      autonomyAuto: 'Auto parallel',
      autonomyManualHint: 'Each task requires approval before the coordinator can dispatch it.',
      autonomyAutoHint: 'Coordinator clarifies scope, dispatches parallel threads, and reports back.',
      pausedBadge: 'Paused',
      pauseProject: 'Pause dispatch',
      resumeProject: 'Resume dispatch',
      pausedHint: 'Blocks dispatching new tasks without stopping running workers.',
      concurrency: 'Concurrency',
      concurrencyHint: 'Max parallel worker threads (1–8).',
      worktreeIsolation: 'Isolated Git Worktree',
      worktreeIsolationHint: 'Runs each task in its own worktree and branch; degrades cleanly for non-git folders.',
      create: 'Create project',
      cancel: 'Cancel',
      save: 'Save',
      close: 'Close',
      confirm: 'Confirm',
      retryAction: 'Retry',
      settings: 'Project settings',
      settingsNav: 'Settings sections',
      general: 'General',
      threads: 'Threads',
      threadsPanelTitle: 'Project context',
      drawerTabs: 'Project context tabs',
      drawerTabThreads: 'Threads',
      drawerTabLibrary: 'Library',
      drawerTabMemory: 'Memory',
      libraryReferences: 'Reference files',
      libraryArtifacts: 'Task artifacts',
      libraryAddFile: 'Add file',
      libraryPathLabel: 'Reference file path',
      libraryPathPlaceholder: 'Workspace-relative or absolute file path…',
      libraryPathRequired: 'A file path is required.',
      libraryTitleLabel: 'Title',
      libraryTitlePlaceholder: 'Display name (optional)',
      libraryNoteLabel: 'Note',
      libraryNotePlaceholder: 'Short context note (optional)',
      libraryPickDir: 'Pick folder',
      libraryAddConfirm: 'Add',
      libraryRemoveRef: 'Remove reference',
      libraryMissing: 'Missing',
      libraryRefAdded: 'Reference file added.',
      libraryRefRemoved: 'Reference removed.',
      libraryEmptyRefs: 'No reference files yet. Add docs or specs for the coordinator and workers.',
      libraryEmptyArtifacts: 'Deliverables and modified files from worker tasks appear here automatically.',
      libraryOpenFile: 'Open preview',
      libraryJumpTask: 'Open source task',
      rulesSection: 'Instructions',
      rulesEmpty: 'No project instructions yet. Edit to guide the coordinator and workers.',
      rulesSaved: 'Project instructions saved.',
      memorySearchPlaceholder: 'Search shared memory…',
      memorySearchLabel: 'Search shared memory',
      memorySearchEmpty: 'No matching memory topics.',
      memoryPin: 'Pin topic',
      memoryUnpin: 'Unpin topic',
      memoryPinned: 'Pinned',
      memoryTokensUnit: 'tokens',
      memorySourceTask: 'Source task',
      diffRequestChanges: 'Request changes',
      diffFeedbackLabel: 'Send revision request to worker',
      diffFeedbackPlaceholder: 'Describe requested changes, press Enter to send…',
      diffFeedbackUnavailable: 'No active worker session to receive revision feedback.',
      diffFeedbackSend: 'Send',
      diffFeedbackSent: 'Revision request sent to worker.',
      mergeClean: 'Clean merge',
      mergeConflicts: 'Merge conflicts',
      mergeDirtyWorktree: 'Uncommitted worktree changes',
      mergeDirtyWorkspace: 'Uncommitted workspace changes',
      mergeAlreadyMerged: 'Already merged',
      statusWaiting: 'Waiting on you',
      statusRunning: 'Running',
      statusReview: 'Ready for review',
      statusIdle: 'Idle',
      threadsSettings: 'Worker threads',
      threadsHint: 'Default dispatch mode, concurrency cap, preset, model route, and worktree isolation.',
      backToCoordinator: 'Coordinator',
      memory: 'Shared memory',
      memoryHint: 'Per-topic markdown files read and updated on demand by workers via index.',
      memoryEmpty: 'No shared memory topics yet.',
      memoryNewTopic: 'New topic',
      memoryTopicName: 'Topic slug',
      memoryTopicNamePlaceholder: 'e.g. architecture-notes',
      memoryTopicDesc: 'One-line description',
      memoryTopicDescPlaceholder: 'Short summary shown in index (optional)',
      memoryBody: 'Content',
      memoryPlaceholder: 'Record findings, decisions, gotchas and conventions…',
      memoryFiles: 'topics',
      memoryChars: 'chars',
      memoryBudget: 'Budget',
      memoryAutoCompact: 'Auto-archive over budget',
      memoryAutoCompactHint: 'Moves oldest whole topic files to archive/ when exceeding budget without splitting files.',
      memoryIndex: 'Index',
      memoryReadOnly: 'Read-only',
      memoryStale: 'Superseded',
      memoryArchived: 'Archived',
      memoryIndexDesc: 'Generated index of all topic files in shared memory',
      memoryIndexHint: 'MEMORY.md is rebuilt automatically on every write and is read-only here.',
      memoryArchivedHint: 'Moved to memory/archive/ by compaction; read-only here.',
      memoryLoading: 'Loading…',
      memoryLoadFailed: 'Could not read memory file',
      memoryEditFile: 'Edit',
      memoryDeleteFile: 'Delete topic',
      memoryDeleteConfirm: 'Confirm delete',
      memoryDeleted: 'Memory topic deleted.',
      memoryNameRequired: 'A topic slug is required.',
      memoryTextRequired: 'Content is required.',
      model: 'Default model',
      agentPreset: 'Default preset',
      agentPresetDefault: 'Default (inherit host)',
      agentPresetPlaceholder: 'Type a preset id (optional)',
      agentPresetFreeTextHint: 'Presets could not be enumerated; type a preset id.',
      reasoningEffort: 'Reasoning effort',
      effortShort: 'Effort',
      modelDefault: 'Default (inherit host)',
      effortDefault: 'Default (model default)',
      modelRoutePlaceholder: 'provider/model',
      modelFreeTextHint: 'Models could not be enumerated; type a provider/model route.',
      effortFreeTextHint: 'Efforts could not be enumerated; type an effort id such as low or high.',
      effortOff: 'Off',
      effortLow: 'Low',
      effortHigh: 'High',
      effortMax: 'Max',
      effectiveModel: 'Effective model',
      fromTask: 'task override',
      fromProject: 'project default',
      fromHost: 'host default',
      archiveSection: 'Archive & delete',
      archiveWarning: 'Moves project to archived list and stops new dispatches. Tasks, memory and sessions stay intact; task worktrees are cleaned up.',
      archive: 'Archive project',
      archiveConfirm: 'Confirm archive',
      unarchive: 'Restore project',
      archivedBadge: 'Archived',
      archivedProjects: 'Archived',
      showArchived: 'Show archived',
      archivedHint: 'This project is archived. Restore it in settings to resume.',
      openSettings: 'Open settings',
      deleteProject: 'Delete project',
      deleteProjectTitle: 'Permanently delete this project?',
      deleteProjectDesc: 'Stops running tasks, removes isolated worktrees, and deletes project records and shared memory. Your real workspace files will never be deleted.',
      deleteProjectArchiveSessions: 'Also archive coordinator and worker sessions',
      deleteProjectConfirm: 'Confirm delete project',
      projectDeleted: 'Project deleted.',
      noProjects: 'No projects yet. Create one to let the coordinator split and run tasks in parallel.',
      noActiveProjects: 'No active projects. Create one or view archived projects.',
      nameRequired: 'Project name is required.',
      preparingCoordinator: 'Preparing coordinator session…',
      coordinatorArchived: 'Coordinator session is archived and cannot run new messages. Restore it to continue.',
      restore: 'Restore session',
      coordinatorChatFailed: 'Could not mount the embedded coordinator conversation.',
      workerChatFailed: 'Could not mount the worker conversation.',
      noConversation: 'This task has no worker session yet.',
      taskBriefHeading: 'Task brief',
      emptyTasks: 'No tasks yet. Describe your goal in the coordinator chat to split and dispatch work.',
      noMatches: 'No matching tasks.',
      noTask: 'This task is no longer in this project.',
      searchThreads: 'Search tasks',
      filterThreads: 'Filter groups',
      filterGroups: 'Visible groups',
      showAllGroups: 'Show all groups',
      collapseAll: 'Collapse all',
      expandAll: 'Expand all',
      collapseThreads: 'Hide tasks panel',
      expandThreads: 'Show tasks panel',
      resizeColumns: 'Resize panel',
      groupRunning: 'Running',
      groupReview: 'Ready for review',
      groupWaiting: 'Waiting on you',
      groupIdle: 'Queued',
      groupResolved: 'Resolved',
      queued: 'Queued',
      running: 'Running',
      review: 'Ready for review',
      failed: 'Failed',
      blocked: 'Blocked',
      resolved: 'Resolved',
      needsApproval: 'Needs approval',
      approve: 'Approve',
      approvedBadge: 'Approved',
      stop: 'Stop',
      retry: 'Retry',
      resolve: 'Resolve',
      unresolve: 'Unresolve',
      resolvedBadge: 'Resolved',
      delete: 'Delete',
      deleteConfirm: 'Confirm delete',
      deleteOnlyTask: 'Delete task only',
      deleteOnlyTaskHint: 'Keeps the worker session and history.',
      deleteAndArchive: 'Delete and archive session',
      archiveSessionHint: 'Archives the worker session (hides from sidebar, stops runs). Frees no disk space.',
      deleteArchived: 'Task deleted and worker session archived.',
      archiveRunning: 'Worker is still running. Stop it or wait for it to finish first.',
      archiveParamRejected: 'Archive parameter rejected; task was not deleted:',
      taskRetriedDispatched: 'Task re-dispatched.',
      taskRetriedQueued: 'Task reset to queued. Ask the coordinator to dispatch it.',
      taskStopped: 'Stop requested for this task.',
      tabChat: 'Chat',
      tabDiff: 'Changes',
      taskViewTabs: 'Task detail view',
      diffLoading: 'Loading diff…',
      diffEmpty: 'No file changes detected.',
      diffUnavailable: 'Git diff is unavailable.',
      diffTruncated: 'Diff is truncated to the leading portion.',
      diffFilesCount: 'files changed',
      diffRefresh: 'Refresh',
      diffAdded: 'Added',
      diffModified: 'Modified',
      diffDeleted: 'Deleted',
      diffRenamed: 'Renamed',
      diffUntracked: 'Untracked',
      worktreeMerge: 'Merge to main',
      worktreeMergeTitle: 'Merge worktree into main branch?',
      worktreeMergeDesc: 'Merges branch {branch} into the main workspace. Conflicts or dirty conflicting files abort safely.',
      worktreeMerged: 'Merged into main branch.',
      worktreeCleanup: 'Remove worktree',
      worktreeCleanupTitle: 'Remove task worktree?',
      worktreeCleanupDesc: 'Force-removes this task’s worktree directory and branch (including uncommitted edits). Task record and chat remain.',
      worktreeCleaned: 'Worktree removed.',
      worktreeWorkspaceMissing: 'Worktree isolation is enabled, but workspace folder is missing; ran in default folder.',
      worktreeNotGit: 'Worktree isolation is enabled, but workspace is not a Git repository; ran in shared folder.',
      isolatedBranch: 'Isolated branch',
      copyBranch: 'Copy branch name',
      branchCopied: 'Branch name copied.',
      copyFailed: 'Clipboard unavailable; could not copy branch name.',
      switchDiscardTitle: 'Discard unsaved changes?',
      switchDiscardDesc: 'Project settings have unsaved edits. Switching projects will discard them.',
      discardAndSwitch: 'Discard and switch',
      keepEditing: 'Keep editing',
      dispatchCard: 'Dispatched task',
      dispatchPreparing: 'Dispatching…',
      dispatchOpenHint: 'Click to inspect worker thread',
      taskActions: 'Task actions',
      justNow: 'just now',
      counts: 'tasks',
      unsavedTag: 'Unsaved',
      sessionUnavailable: 'Session service is unavailable on this page.',
      pickerUnavailable: 'Directory picker is unavailable on this page.',
      errorPrefix: 'Error: ',
    }

    function formatCopy(template, params) {
      if (!params) return template
      return String(template).replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
    }

    const DISPATCH_SHARED_CSS = `
.pj-dispatch-wrap{margin:4px 0}
.pj-dispatch-card{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 64%,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-dispatch-card:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.pj-dispatch-card:disabled{cursor:default;opacity:0.72}
.pj-dispatch-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.pj-dispatch-time{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.pj-glyph{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none}
.pj-glyph-review{color:var(--dsw-alias-state-success-primary)}
.pj-glyph-waiting{color:var(--dsw-alias-state-warn-primary)}
.pj-glyph-failed{color:var(--dsw-alias-state-error-primary)}
.pj-glyph-idle{color:var(--dsw-alias-label-tertiary)}
.pj-glyph-resolved{color:var(--dsw-alias-label-secondary)}
.pj-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;height:20px;padding:0 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pj-chip-branch{color:var(--dsw-alias-label-primary);border:0.5px solid var(--dsw-alias-border-l2)}
.pj-chip-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-label)}
`

    const PAGE_CSS = `
.pj-page{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px;line-height:22px;box-sizing:border-box}
.pj-page *,.pj-page *::before,.pj-page *::after{box-sizing:border-box}
.pj-page :focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.pj-page.pj-resizing{cursor:col-resize;user-select:none}

/* Unified 48px Topbar (Row-1 caption-aligned, shares AppFrame .captionDrag) */
.pj-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;height:48px;min-height:48px;padding:0 max(16px,calc(var(--dshd-titlebar-conversation-reserve,var(--dshd-wco-controls,0px)) + 8px)) 0 max(16px,var(--dsh-frame-leading-clearance,0px));border-bottom:0.5px solid var(--dsw-alias-border-l2);flex:none;min-width:0}
.pj-topbar.pj-topbar-quiet{border-bottom-color:transparent}
.pj-nodrag{-webkit-app-region:no-drag}
.pj-topbar-left{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto}
.pj-topbar-left > *{min-width:0}
.pj-topbar-right{display:flex;align-items:center;gap:8px;flex:none}
.pj-switcher-wrap{position:relative;display:inline-flex;align-items:center;flex:0 1 auto;min-width:0;max-width:100%}
.pj-switcher-btn{display:inline-flex;align-items:center;gap:8px;max-width:220px;min-width:0;height:28px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;font-weight:600;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-switcher-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pj-switcher-btn > svg{flex:none}
.pj-switcher-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pj-ws-pill{flex:0 1 auto;min-width:72px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-ws-pill > svg{flex:none}
.pj-ws-pill-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pj-pill-paused{color:var(--dsw-alias-state-warn-label)}
.pj-tasks-toggle{display:inline-flex;align-items:center;gap:8px}
.pj-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.pj-icon-btn:disabled{opacity:0.4;cursor:not-allowed}
.pj-icon-btn.pj-active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.pj-head-actions{display:flex;align-items:center;gap:8px;flex:none}

/* Overview Canvas (0 projects empty hero & >=1 projects 920px card grid) */
.pj-overview-empty{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px 24px 72px;text-align:center;max-width:460px;margin:0 auto}
.pj-empty-mark{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.pj-empty-heading{margin:0;font-size:20px;line-height:28px;font-weight:500;color:var(--dsw-alias-label-primary)}
.pj-empty-desc{margin:0 0 8px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}

.pj-overview-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:24px clamp(20px,4vw,40px) 48px}
.pj-overview-inner{width:100%;max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
.pj-overview-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.pj-overview-title-row{display:flex;align-items:baseline;gap:8px;min-width:0}
.pj-overview-title{margin:0;font-size:20px;line-height:28px;font-weight:500;color:var(--dsw-alias-label-primary)}
.pj-overview-count{font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.pj-overview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:12px}
.pj-card{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 42%,transparent);text-align:left;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-card:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.pj-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.pj-card-name{margin:0;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.pj-card-goal{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pj-card-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.pj-card-dir{display:inline-flex;align-items:center;gap:4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.pj-card-actions{display:flex;align-items:center;gap:4px;flex:none}

/* Workspace Body: Wide Main Stage + Optional Right Tasks Panel */
.pj-body{position:relative;display:flex;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
.pj-stage{display:flex;flex-direction:column;flex:1 1 0;min-width:0;min-height:0;overflow:hidden;background:transparent}
.pj-chat-host{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
.pj-center-state{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;max-width:440px;margin:0 auto;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.pj-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px;flex:none}

/* Wide Task Detail Drill-In (lives inside .pj-stage for 600px+ Chat & Diff) */
.pj-detail-shell{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
.pj-detail-bar{display:flex;flex-direction:column;gap:8px;padding:8px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l2);flex:none;background:transparent}
.pj-detail-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;min-width:0}
.pj-detail-lead{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 200px}
.pj-detail-title{font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pj-detail-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex:none}
.pj-detail-meta-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);min-width:0}
.pj-branch-pill{display:inline-flex;align-items:center;gap:4px;max-width:100%;min-width:0;height:24px;padding:0 4px 0 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.pj-branch-code{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-worktree-warn{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-detail-body{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
.pj-brief-card{margin:16px auto 0;width:min(720px,calc(100% - 32px));padding:14px 16px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 50%,transparent);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}

/* Right Context Drawer (transparent single-ground docked, glass overlay on narrow) */
.pj-overlay-host{position:absolute;inset:0;pointer-events:none;z-index:30}
.pj-exec{position:relative;display:flex;flex-direction:column;flex:0 0 auto;min-width:0;min-height:0;background:transparent;border-left:0.5px solid var(--dsw-alias-border-l2)}
.pj-exec.pj-exec-overlay{position:absolute;top:0;right:0;bottom:0;z-index:30;pointer-events:auto;max-width:min(360px,calc(100% - 24px));background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent)}
.pj-resizer{position:absolute;top:0;bottom:0;left:-3px;width:6px;padding:0;border:0;background:transparent;cursor:col-resize;touch-action:none;z-index:6}
.pj-resizer:hover,.pj-resizer:focus-visible{background:color-mix(in srgb,var(--dsw-alias-border-l3) 70%,transparent)}
.pj-exec-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:8px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}
.pj-exec-title{margin:0;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-drawer-subbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}
.pj-drawer-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-search-bar{padding:8px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}
.pj-exec-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 12px 24px}
.pj-group{margin-bottom:12px}
.pj-group-btn{display:flex;align-items:center;gap:8px;width:100%;padding:4px 8px;margin-bottom:4px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;font-weight:500;text-align:left;cursor:pointer}
.pj-group-btn:hover{color:var(--dsw-alias-label-primary)}
.pj-group-btn.pj-group-waiting{color:var(--dsw-alias-state-warn-label);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
.pj-group-btn.pj-group-waiting:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent)}

/* Unified 3-color real-time status dot (true circle under global corner-shape, no custom keyframes) */
.pj-sdot{display:inline-block;width:8px;height:8px;border-radius:50%;corner-shape:round;flex:none;background:var(--dsw-alias-label-quaternary,var(--dsw-alias-border-l3))}
.pj-sdot-waiting{background:var(--dsw-alias-state-warn-primary)}
.pj-sdot-running{background:var(--dsw-alias-state-business-primary)}
.pj-sdot-review{background:var(--dsw-alias-state-success-primary)}
.pj-sdot-idle{background:var(--dsw-alias-label-quaternary,var(--dsw-alias-border-l3))}
.pj-card-title-wrap{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto}

/* Drawer Library & Inline Memory/Rules Sections */
.pj-drawer-section{display:flex;flex-direction:column;gap:8px;padding-bottom:14px;margin-bottom:14px;border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.pj-drawer-section:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
.pj-drawer-sec-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.pj-drawer-sec-title{margin:0;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;gap:8px}
.pj-inline-form{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 48%,transparent)}
.pj-inline-form-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.pj-lib-list{display:flex;flex-direction:column;gap:4px}
.pj-lib-row{display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 36%,transparent);transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-lib-row:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.pj-lib-main{display:flex;align-items:flex-start;gap:8px;flex:1 1 auto;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.pj-lib-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-top:2px;flex:none;color:var(--dsw-alias-label-secondary)}
.pj-lib-copy{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto}
.pj-lib-name{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-lib-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-lib-meta-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}
.pj-task-link{display:inline-flex;align-items:center;gap:4px;max-width:100%;height:22px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-task-link:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.pj-rules-card{padding:12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 36%,transparent);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.pj-rules-card.pj-rules-empty{color:var(--dsw-alias-label-tertiary)}
.pj-rules-text{display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;margin:0}
.pj-mem-card{display:flex;flex-direction:column;gap:4px;padding:8px 12px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 42%,transparent);transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-mem-card:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.pj-mem-card.pj-mem-pinned{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,var(--dsw-alias-border-l2))}
.pj-mem-card-top{display:flex;align-items:center;gap:4px;min-width:0}
.pj-mem-card-trigger{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.pj-pin-btn{width:24px;height:24px;flex:none}
.pj-pin-btn.pj-pinned{color:var(--dsw-alias-state-business-primary)}
.pj-mem-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}

/* Diff Feedback Bar */
.pj-diff-file-right{display:inline-flex;align-items:center;gap:8px;flex:none}
.pj-diff-file-right > button{flex:none;white-space:nowrap}
.pj-diff-feedback-bar{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:0.5px solid var(--dsw-alias-border-l2);background:transparent;flex:none}
.pj-diff-feedback-bar > :first-child,.pj-diff-feedback-input{flex:1 1 0;min-width:0}
.pj-diff-feedback-bar > button{flex:none;white-space:nowrap}
.pj-task-card-wrap{display:flex;flex-direction:column;gap:4px;margin-bottom:4px;padding:2px;border-radius:var(--dsw-radius-md);transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-task-card{display:grid;grid-template-columns:16px minmax(0,1fr) auto;grid-template-areas:"icon title time" "icon sub sub" "icon chips chips";align-items:center;column-gap:8px;row-gap:2px;width:100%;padding:8px 12px;border:0.5px solid transparent;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-task-card:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1)}
.pj-task-card.pj-active{background:var(--dsw-specific-sidebar-nav-item-active);border-color:var(--dsw-alias-border-l2)}
.pj-task-icon{grid-area:icon;align-self:start;margin-top:4px}
.pj-task-title{grid-area:title;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-task-time{grid-area:time;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.pj-task-sub{grid-area:sub;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-task-chips{grid-area:chips;display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;min-width:0}
.pj-task-quick{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 12px 8px 32px}

/* Fallback Popover & Context Menu (when Primitives.Menu is unavailable) */
.pj-filter-wrap{position:relative;display:inline-flex}
.pj-popover-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:80;min-width:200px;padding:4px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);display:flex;flex-direction:column;gap:2px}
.pj-popover-menu.pj-align-start{left:0;right:auto}
.pj-ctx-menu{position:fixed;z-index:1200;min-width:196px;max-width:296px;padding:4px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);display:flex;flex-direction:column;gap:2px}
.pj-menu-row{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.pj-menu-row:hover:not(:disabled),.pj-menu-row:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);outline:none}
.pj-menu-row:disabled{opacity:0.4;cursor:not-allowed}
.pj-menu-row.pj-danger{color:var(--dsw-alias-state-error-primary)}
.pj-menu-row.pj-danger:hover:not(:disabled),.pj-menu-row.pj-danger:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.pj-menu-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;color:var(--dsw-alias-menu-icon)}
.pj-menu-row.pj-danger .pj-menu-icon{color:var(--dsw-alias-state-error-primary)}
.pj-menu-check{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;color:var(--dsw-alias-state-business-primary)}
.pj-menu-text{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
.pj-menu-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:normal}
.pj-menu-caption{padding:4px 8px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-tertiary)}
.pj-menu-sep{height:0.5px;margin:4px 8px;background:var(--dsw-alias-border-l2)}

/* Wide Diff View */
.pj-diff-panel{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}
.pj-diff-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}
.pj-diff-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 16px 24px;display:flex;flex-direction:column;gap:12px}
.pj-diff-files{display:flex;flex-direction:column;gap:4px}
.pj-diff-file-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 50%,transparent);border:0.5px solid var(--dsw-alias-border-l1);font-size:12px;line-height:18px}
.pj-diff-file-path{font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.pj-diff-counts{display:inline-flex;align-items:center;gap:8px;flex:none;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px}
.pj-diff-add{color:var(--dsw-alias-state-success-primary)}
.pj-diff-del{color:var(--dsw-alias-state-error-primary)}
.pj-diff-pre{margin:0;padding:12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 56%,transparent);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;overflow:auto;white-space:pre}
.pj-diff-line{display:block;padding:0 8px}
.pj-diff-line-add{background:var(--dsw-alias-code-diff-added,color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent));color:var(--dsw-alias-file-diff-added-marker,var(--dsw-alias-state-success-primary))}
.pj-diff-line-del{background:var(--dsw-alias-code-diff-deleted,color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent));color:var(--dsw-alias-file-diff-deleted-marker,var(--dsw-alias-state-error-primary))}
.pj-diff-line-hunk{color:var(--dsw-alias-state-business-primary)}

/* Forms & Modals (glass-native Modal surface, scrollable body, bounded height) */
.pj-modal-glass,.pj-modal-glass *,.pj-modal-glass *::before,.pj-modal-glass *::after,.pj-settings-modal,.pj-settings-modal *,.pj-settings-modal *::before,.pj-settings-modal *::after,.pj-ctx-menu,.pj-ctx-menu *{box-sizing:border-box}
.pj-modal-glass{max-height:100%}
.pj-modal-content{min-height:0;flex:1 1 auto;overflow-y:auto}
.pj-modal-form{width:min(520px,calc(100vw - 32px))}
.pj-modal-wide{width:min(640px,calc(100vw - 32px))}
.pj-form-stack{display:flex;flex-direction:column;gap:14px;min-width:0;width:100%}
.pj-field{display:flex;flex-direction:column;gap:8px;min-width:0;width:100%}
.pj-field-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.pj-field-err{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);white-space:nowrap}
.pj-field-row{display:flex;align-items:center;gap:8px;min-width:0;width:100%}
.pj-field-row > button{flex:none;white-space:nowrap}
.pj-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;width:100%;min-width:0}
.pj-label{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.pj-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.pj-textarea,.pj-select{display:block;box-sizing:border-box;width:100%;max-width:100%;min-width:0;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:8px 12px}
.pj-textarea{min-height:88px;max-height:220px;resize:vertical}
.pj-textarea-tall{min-height:240px;max-height:420px;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px}
.pj-select{height:36px;padding:0 12px}
.pj-textarea:focus-visible,.pj-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.pj-input-invalid{border-color:var(--dsw-alias-state-error-primary) !important}
.pj-path-box{box-sizing:border-box;flex:1 1 0;min-width:0;max-width:100%;height:36px;display:flex;align-items:center;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 50%,transparent);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden}
.pj-path-box.pj-empty-path{color:var(--dsw-alias-label-tertiary)}
.pj-path-text{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-switch-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:8px 0}
.pj-switch-copy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.pj-danger-zone{margin-top:8px;padding-top:16px;border-top:0.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l2));display:flex;flex-direction:column;gap:12px}
.pj-danger-title{margin:0;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-state-error-primary)}
.pj-danger-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pj-danger-btn{color:var(--dsw-alias-state-error-primary)}

/* Two-Column Settings Shell (glass-native headless Modal) */
.pj-settings-modal{width:min(780px,calc(100vw - 32px));height:min(680px,100%);max-height:100%;padding:0;overflow:hidden}
.pj-settings-grid{display:grid;grid-template-columns:188px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);grid-template-areas:"title head" "nav body";width:100%;height:100%;min-height:0}
.pj-settings-title{grid-area:title;margin:0;padding:16px 12px 12px 20px;font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary);border-right:0.5px solid var(--dsw-alias-border-l2);border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.pj-settings-head{grid-area:head;display:flex;align-items:center;justify-content:flex-end;padding:12px 14px;border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.pj-settings-nav{grid-area:nav;display:flex;flex-direction:column;gap:4px;padding:12px;border-right:0.5px solid var(--dsw-alias-border-l2);overflow-y:auto}
.pj-settings-nav-btn{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 12px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:400;text-align:left;cursor:pointer}
.pj-settings-nav-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.pj-settings-nav-btn.pj-active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}
.pj-page .pj-settings-nav-btn:focus-visible,.pj-settings-modal .pj-settings-nav-btn:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}
.pj-settings-body{grid-area:body;min-width:0;min-height:0;overflow-y:auto;padding:16px 20px 24px;display:flex;flex-direction:column;gap:16px}
.pj-section{display:flex;flex-direction:column;gap:12px;padding-bottom:16px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.pj-section:last-child{border-bottom:0;padding-bottom:0}
.pj-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pj-section-title{margin:0;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}

/* Shared Memory List & Progress (transform-only GPU progress bar) */
.pj-budget-bar{width:100%;height:4px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}
.pj-budget-fill{width:100%;height:100%;background:var(--dsw-alias-state-business-primary);transform-origin:left center;transition:transform var(--ds-transition-duration) var(--ds-ease-in-out)}
.pj-budget-fill.pj-over{background:var(--dsw-alias-state-warn-primary)}
.pj-memory-list{display:flex;flex-direction:column;gap:4px}
.pj-memory-row{display:flex;flex-direction:column;gap:2px;width:100%;padding:8px 12px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 48%,transparent);color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-memory-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pj-memory-row-head{display:flex;align-items:center;gap:8px;min-width:0}
.pj-memory-row-name{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-memory-row-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-memory-row-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.pj-memory-body-pre{margin:0;padding:12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 52%,transparent);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow-y:auto}
.pj-empty{padding:24px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;flex:1 1 auto}

/* Fallback switch & segmented control when primitives unavailable */
.pj-switch-fallback{position:relative;display:inline-flex;align-items:center;width:36px;height:20px;padding:0;border:0;border-radius:14px;background:var(--dsw-alias-border-l3);cursor:pointer;flex:none;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-switch-fallback[aria-checked='true']{background:var(--dsw-alias-state-business-primary)}
.pj-switch-fallback-thumb{position:absolute;left:2px;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-switch-fallback[aria-checked='true'] .pj-switch-fallback-thumb{transform:translateX(16px)}
.pj-seg-fallback{display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:2px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover)}
.pj-seg-fallback-btn{height:28px;padding:0 12px;border:0;border-radius:var(--dsw-radius-compact,6px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;font-weight:500;cursor:pointer}
.pj-seg-fallback-btn[aria-checked='true']{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}

@media (max-width: 640px){
  .pj-settings-grid{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto minmax(0,1fr);grid-template-areas:"title head" "nav nav" "body body"}
  .pj-settings-title{border-right:0}
  .pj-settings-nav{flex-direction:row;border-right:0;border-bottom:0.5px solid var(--dsw-alias-border-l2);padding:8px 12px}
  .pj-field-grid{grid-template-columns:minmax(0,1fr)}
}
@media (prefers-reduced-motion: reduce){
  .pj-page *,.pj-dispatch-card{transition:none !important;animation:none !important}
}
:root[data-dsh-minimal] .pj-page *,:root[data-dsh-minimal] .pj-dispatch-card{transition:none !important;animation:none !important}
${DISPATCH_SHARED_CSS}
`

    // =========================================================================
    // Section 2: HTTP Client & SSE Real-Time Event Subscription
    // =========================================================================

    function messageOf(error) {
      if (error instanceof Error) return error.message
      return String(error)
    }

    async function api(path, init) {
      const method = (init && init.method ? String(init.method) : 'GET').toUpperCase()
      const headers = {
        'x-projects-api': '1',
        ...(method === 'GET' || method === 'HEAD' ? {} : { 'content-type': 'application/json' }),
        ...(init && init.headers),
      }
      const response = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...init,
        method,
        headers,
      })
      let payload = {}
      try {
        payload = await response.json()
      } catch {
        payload = {}
      }
      if (!response.ok) {
        const failure = new Error(
          (payload && (typeof payload.error === 'string' ? payload.error : payload.error?.message))
            || `HTTP ${response.status}`,
        )
        failure.status = response.status
        if (payload && payload.code) failure.code = payload.code
        throw failure
      }
      return payload
    }

    function subscribeProjectEvents({ onUpdate, onReconnect, onStateChange }) {
      const ES = typeof EventSource !== 'undefined'
        ? EventSource
        : (typeof window !== 'undefined' ? window.EventSource : undefined)
      if (typeof ES !== 'function') {
        onStateChange?.('unavailable')
        return () => {}
      }
      let source = null
      let retryTimer = null
      let retryDelay = SSE_MIN_DELAY_MS
      let connectedOnce = false
      let closed = false

      const clearRetry = () => {
        if (retryTimer !== null) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
      }
      const closeSource = () => {
        if (source) {
          try { source.close() } catch {}
          source = null
        }
      }
      const scheduleReconnect = () => {
        if (closed || retryTimer !== null) return
        const wait = retryDelay
        retryDelay = Math.min(SSE_MAX_DELAY_MS, Math.round(retryDelay * 1.8))
        retryTimer = setTimeout(() => {
          retryTimer = null
          connect()
        }, wait)
      }
      const parseEvent = (raw) => {
        try {
          return JSON.parse(raw)
        } catch {
          return { type: 'update', ts: Date.now() }
        }
      }
      const connect = () => {
        if (closed) return
        closeSource()
        let es
        try {
          es = new ES(`${API_BASE}/events`, { withCredentials: true })
        } catch {
          onStateChange?.('disconnected')
          scheduleReconnect()
          return
        }
        source = es
        let settledOpen = false
        const handleOpen = () => {
          if (settledOpen) return
          settledOpen = true
          const isReconnect = connectedOnce
          connectedOnce = true
          retryDelay = SSE_MIN_DELAY_MS
          onStateChange?.('connected')
          if (isReconnect) onReconnect?.()
        }
        const handleUpdate = (event) => {
          onUpdate?.(parseEvent(event && event.data))
        }
        if (typeof es.addEventListener === 'function') {
          es.addEventListener('open', handleOpen)
          es.addEventListener('ready', handleOpen)
          es.addEventListener('update', handleUpdate)
          es.addEventListener('message', handleUpdate)
        } else {
          es.onopen = handleOpen
          es.onmessage = handleUpdate
        }
        es.onerror = () => {
          onStateChange?.('disconnected')
          closeSource()
          scheduleReconnect()
        }
      }

      const onVisibility = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible' && !source && !closed) {
          clearRetry()
          retryDelay = SSE_MIN_DELAY_MS
          connect()
        }
      }
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVisibility)
      }
      connect()

      return () => {
        closed = true
        clearRetry()
        closeSource()
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }
    }

    // =========================================================================
    // Section 3: Cross-Subtree Stores (Dispatch Cards & Locale Updates)
    // =========================================================================

    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        get: () => value,
        set(next) {
          if (Object.is(next, value)) return
          value = next
          for (const listener of [...listeners]) {
            try { listener(value) } catch {}
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    function useStoreValue(store) {
      const [value, setValue] = useState(store.get)
      useEffect(() => {
        setValue(store.get())
        return store.subscribe(setValue)
      }, [store])
      return value
    }

    const projectSnapshot = createStore(null)
    const openTaskRequest = createStore(null)
    let openTaskSeq = 0

    function requestOpenTask(projectId, taskId) {
      openTaskSeq += 1
      openTaskRequest.set({ projectId, taskId, seq: openTaskSeq })
    }

    // =========================================================================
    // Section 4: Container-Aware Layout & Pure Domain Helpers
    // =========================================================================

    function readStored(key, fallback) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return fallback
        const value = window.localStorage.getItem(`projects.${key}`)
        return value === null ? fallback : value
      } catch {
        return fallback
      }
    }

    function writeStored(key, value) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(`projects.${key}`, String(value))
      } catch {}
    }

    function readStoredNumber(key, fallback) {
      const n = Number(readStored(key, ''))
      return Number.isFinite(n) && n > 0 ? n : fallback
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), Math.max(min, max))
    }

    /**
     * Resolve right Tasks panel visibility, docking vs overlay mode, and pixel width
     * from measured container width (via ResizeObserver) and task count.
     */
    /**
     * Unified 3-color project status priority (event-driven, zero model calls):
     *   waiting (yellow: blocked / failed / manual unapproved)
     *   > running (blue breathing)
     *   > review (green: ready for review)
     *   > idle (grey)
     */
    function projectStatusOf(projectOrSummary) {
      if (!projectOrSummary) return 'idle'
      if (Array.isArray(projectOrSummary.tasks)) {
        const tasks = projectOrSummary.tasks
        const isManual = projectOrSummary.autonomy === 'manual'
        if (
          tasks.some(
            (tk) =>
              tk &&
              (tk.status === 'blocked' ||
                tk.status === 'failed' ||
                (isManual && tk.status === 'queued' && !tk.approved)),
          )
        ) {
          return 'waiting'
        }
        if (tasks.some((tk) => tk && tk.status === 'running')) return 'running'
        if (tasks.some((tk) => tk && tk.status === 'review')) return 'review'
        return 'idle'
      }
      const counts = (projectOrSummary && projectOrSummary.counts) || {}
      const needsApproval = Number(counts.needsApproval) || 0
      if (
        (Number(counts.blocked) || 0) > 0 ||
        (Number(counts.failed) || 0) > 0 ||
        needsApproval > 0 ||
        (projectOrSummary.autonomy === 'manual' && (Number(counts.queued) || 0) > 0)
      ) {
        return 'waiting'
      }
      if ((Number(counts.running) || 0) > 0) return 'running'
      if ((Number(counts.review) || 0) > 0) return 'review'
      return 'idle'
    }

    function projectStatusLabel(status, t) {
      if (status === 'waiting') return t('statusWaiting')
      if (status === 'running') return t('statusRunning')
      if (status === 'review') return t('statusReview')
      return t('statusIdle')
    }

    function ProjectStatusDot({ status, title }) {
      const normalized = status === 'waiting' || status === 'running' || status === 'review' ? status : 'idle'
      return h('span', {
        className: `pj-sdot pj-sdot-${normalized}`,
        'data-project-status': normalized,
        title: title || undefined,
        'aria-hidden': true,
      })
    }

    function computeTasksLayout({ containerWidth, execPref, hasTasks, hasContent, execWidth }) {
      const w = Number(containerWidth) || 0
      const canDock = w === 0 || w >= EXEC_DOCK_MIN
      const shouldAutoOpen = Boolean(hasContent !== undefined ? hasContent : hasTasks)
      let open = false
      if (execPref === 'open') open = true
      else if (execPref === 'closed') open = false
      else open = shouldAutoOpen && canDock

      if (!open) return { open: false, overlay: false, width: 0 }
      if (!canDock) {
        return { open: true, overlay: true, width: Math.min(EXEC_DEFAULT_WIDTH, Math.max(240, w - 24)) }
      }
      const ceiling = w > 0 ? Math.min(EXEC_MAX_WIDTH, Math.max(EXEC_MIN_WIDTH, w - MAIN_MIN_WIDTH)) : EXEC_MAX_WIDTH
      return { open: true, overlay: false, width: clamp(execWidth, EXEC_MIN_WIDTH, ceiling) }
    }

    function shortPath(workspace) {
      const raw = String(workspace || '').trim().replace(/[\\/]+$/, '')
      if (!raw) return ''
      const parts = raw.split(/[\\/]/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : raw
    }

    function plainLine(text) {
      const line = String(text || '').split('\n').find((entry) => entry.trim())
      if (!line) return ''
      return line
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*>\s*/, '')
        .replace(/\*\*|__|`/g, '')
        .trim()
    }

    function taskSubtitle(task, t) {
      return plainLine(task && task.output) || plainLine(task && task.brief) || t((task && task.status) || 'queued')
    }

    function relativeTime(task, t, locale) {
      const stamp = Number(task && task.finishedAt) || Number(task && task.updatedAt) || Number(task && task.createdAt) || 0
      if (!stamp) return ''
      const delta = Date.now() - stamp
      if (!Number.isFinite(delta) || delta < 60000) return t('justNow')
      const hour = 3600000
      const day = 86400000
      if (delta < hour) return `${Math.floor(delta / 60000)}m`
      if (delta < day) return `${Math.floor(delta / hour)}h`
      if (delta < 7 * day) return `${Math.floor(delta / day)}d`
      try {
        return new Date(stamp).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
      } catch {
        return ''
      }
    }

    function taskChips(task, project, t) {
      const chips = []
      const branch = String((task && task.branch) || '').trim()
      if (branch) chips.push({ key: 'branch', text: t('isolatedBranch'), title: branch, kind: 'branch' })
      if (project && project.autonomy === 'manual' && task && !task.approved && task.status === 'queued') {
        chips.push({ key: 'approval', text: t('needsApproval'), title: t('needsApproval'), kind: 'warn' })
      }
      const model = String((task && task.model) || '').trim()
      if (model) {
        const shortModel = model.split('/').pop() || model
        chips.push({ key: 'model', text: shortModel, title: model, kind: 'default' })
      }
      return chips.slice(0, 2)
    }

    function threadGroups(tasks) {
      const buckets = new Map(THREAD_GROUPS.map((g) => [g.key, []]))
      for (const task of tasks || []) {
        const group = THREAD_GROUPS.find((entry) => entry.statuses.includes(task.status))
        if (group) buckets.get(group.key).push(task)
      }
      return THREAD_GROUPS.map((group) => ({ ...group, tasks: buckets.get(group.key) }))
    }

    function countsLine(project, t) {
      const counts = (project && project.counts) || {}
      const parts = ['running', 'review', 'blocked', 'failed', 'queued', 'resolved']
        .filter((status) => (counts[status] || 0) > 0)
        .map((status) => `${counts[status]} ${t(status)}`)
      if (parts.length) return parts.join(' · ')
      const total = Object.values(counts).reduce((sum, v) => sum + (Number(v) || 0), 0)
      return `${total} ${t('counts')}`
    }

    function modelLabel(catalog, value) {
      const route = String(value || '').trim()
      if (!route) return ''
      const found = ((catalog && catalog.models) || []).find((entry) => entry && entry.id === route)
      return (found && found.label) || route
    }

    function effectiveModel(project, task) {
      const fromTask = String((task && task.model) || '').trim()
      if (fromTask) return { value: fromTask, source: 'task' }
      const fromProject = String((project && project.model) || '').trim()
      if (fromProject) return { value: fromProject, source: 'project' }
      return { value: '', source: 'host' }
    }

    function effortsFor(catalog, route) {
      const key = String(route || '').trim()
      const found = ((catalog && catalog.models) || []).find((entry) => entry && entry.id === key)
      const advertised = found && Array.isArray(found.efforts) ? found.efforts : []
      const entries = advertised
        .filter((e) => e && e.id)
        .map((e) => ({ id: String(e.id), name: e.name ? String(e.name) : String(e.id) }))
      if (entries.length) return entries
      return GENERIC_EFFORTS.map((id) => ({ id, name: '' }))
    }

    function effortLabel(catalog, route, value, t) {
      const id = String(value || '').trim()
      if (!id) return ''
      const found = effortsFor(catalog, route).find((e) => e.id === id)
      if (found && found.name) return found.name
      const key = `effort${id.charAt(0).toUpperCase()}${id.slice(1)}`
      const localized = t(key)
      return localized === key ? id : localized
    }

    function effectiveEffort(project, task) {
      const fromTask = String((task && task.reasoningEffort) || '').trim()
      if (fromTask) return { value: fromTask, source: 'task' }
      const fromProject = String((project && project.reasoningEffort) || '').trim()
      if (fromProject) return { value: fromProject, source: 'project' }
      return { value: '', source: 'host' }
    }

    function memorySize(chars, t) {
      const value = Number(chars) || 0
      const formatted = value < 1000 ? String(value) : `${Math.round(value / 100) / 10}k`
      return `${formatted} ${t('memoryChars')}`
    }

    function memoryDateOf(modified) {
      const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(modified || ''))
      return match ? match[1] : ''
    }

    function memoryMeta(file, t) {
      const parts = [memorySize(file && file.size, t)]
      const date = memoryDateOf(file && file.modified)
      if (date) parts.push(date)
      return parts.join(' · ')
    }

    function worktreeNoteOf(task, t) {
      const note = String((task && task.worktreeNote) || '').trim()
      if (note) return note
      if (task && task.worktreeDegraded === 'workspace_missing') return t('worktreeWorkspaceMissing')
      if (task && task.worktreeDegraded === 'not_a_git_repository') return t('worktreeNotGit')
      return ''
    }

    function taskDeleteFailure(failure, t, archive) {
      const status = failure && failure.status
      const detail = messageOf(failure)
      if (archive && status === 409) {
        return /still running/i.test(detail) ? t('archiveRunning') : detail
      }
      if (archive && status === 400) return `${t('archiveParamRejected')} ${detail}`
      return detail
    }

    function readCollapsedGroups() {
      const raw = readStored('collapsedGroups', '')
      if (!raw) return { ...DEFAULT_COLLAPSED_GROUPS }
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_COLLAPSED_GROUPS }
        const next = {}
        for (const g of THREAD_GROUPS) next[g.key] = parsed[g.key] === true
        return next
      } catch {
        return { ...DEFAULT_COLLAPSED_GROUPS }
      }
    }

    // =========================================================================
    // Section 5: Icons & UI Primitives Bridge
    // =========================================================================

    const UIButton = Primitives.Button || React.forwardRef(function FallbackButton(
      { variant, size, shape, icon, loading, feedback, children, ...rest },
      ref,
    ) {
      return h('button', { type: 'button', ref, ...rest, disabled: rest.disabled || loading }, icon, children)
    })

    const UIInput = Primitives.Input || React.forwardRef(function FallbackInput(
      { variant, icon, className, ...rest },
      ref,
    ) {
      return h('input', { ref, className, ...rest })
    })

    const UIModal = Primitives.Modal || function FallbackModal({ open, title, description, closeLabel, onClose, children, footer, headless }) {
      if (!open) return null
      return h(
        'div',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, className: 'pj-modal-glass' },
        headless
          ? children
          : h(
              Fragment,
              null,
              h('div', null, h('h2', null, title), description && h('p', null, description), closeLabel && h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel)),
              children,
              footer,
            ),
      )
    }

    const UIPill = Primitives.Pill || function FallbackPill({ active, onClick, children, ...rest }) {
      return onClick
        ? h('button', { type: 'button', 'aria-pressed': active ? 'true' : 'false', onClick, ...rest }, children)
        : h('span', rest, children)
    }

    const UISegmentedTabs = Primitives.SegmentedTabs || function FallbackTabs({ items, value, onChange, label }) {
      return h(
        'div',
        { role: 'tablist', 'aria-label': label },
        items.map((item) =>
          h('button', {
            key: item.value,
            id: item.id,
            type: 'button',
            role: 'tab',
            'aria-selected': value === item.value ? 'true' : 'false',
            'aria-controls': item.panelId,
            onClick: () => onChange(item.value),
          }, item.label),
        ),
      )
    }

    function SafeSegmentedControl({ id, value, options, onChange, label, disabled }) {
      if (typeof Primitives.SegmentedControl === 'function') {
        return h(Primitives.SegmentedControl, { id, value, options, onChange, label, disabled })
      }
      return h(
        'div',
        { role: 'radiogroup', 'aria-label': label, className: 'pj-seg-fallback' },
        options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              role: 'radio',
              'aria-checked': value === option.value ? 'true' : 'false',
              disabled: disabled || option.disabled,
              className: 'pj-seg-fallback-btn',
              onClick: () => { if (option.value !== value) onChange(option.value) },
            },
            option.label,
          ),
        ),
      )
    }

    function SafeSelect({ value, options, onChange, 'aria-label': ariaLabel, disabled, placeholder }) {
      if (typeof Primitives.SettingsSelect === 'function') {
        return h(Primitives.SettingsSelect, {
          value: value || '',
          options,
          onChange,
          'aria-label': ariaLabel,
          disabled,
          placeholder: placeholder || '',
          variant: 'block',
          align: 'start',
        })
      }
      return h(
        'select',
        {
          className: 'pj-select',
          'aria-label': ariaLabel,
          value: value || '',
          disabled,
          onChange: (e) => onChange(e.target.value),
        },
        options.map((opt) => h('option', { key: opt.id, value: opt.id, disabled: opt.disabled }, opt.label)),
      )
    }

    const UIStateDot = Primitives.StateDot || function FallbackDot({ state }) {
      return h('span', { 'data-state-dot': state, 'aria-hidden': true })
    }

    const UITag = Primitives.Tag || function FallbackTag({ tone, className, children }) {
      return h('span', { 'data-tone': tone, className }, children)
    }

    const UITooltip = Primitives.Tooltip || function FallbackTooltip({ label, children }) {
      return children
    }

    const UIToast = Primitives.Toast || function FallbackToast({ text }) {
      return h('div', { role: 'status' }, text)
    }

    function useSafePresence(open, durationMs) {
      if (typeof Primitives.usePresence === 'function') {
        return Primitives.usePresence(Boolean(open), durationMs)
      }
      return { mounted: Boolean(open), state: open ? 'open' : 'closed' }
    }

    function SafeFlipText({ text, className }) {
      if (typeof Primitives.FlipText === 'function') {
        return h(Primitives.FlipText, { text: String(text || ''), className })
      }
      return h('span', { className }, String(text || ''))
    }

    function SafeSwitch({ checked, onChange, label, disabled, title }) {
      if (typeof Primitives.Switch === 'function') {
        return h(Primitives.Switch, { checked: Boolean(checked), onChange, label, disabled, title })
      }
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          className: 'pj-switch-fallback',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          title,
          disabled,
          onClick: () => onChange(!checked),
        },
        h('span', { className: 'pj-switch-fallback-thumb', 'aria-hidden': true }),
      )
    }

    function ProjectsIcon({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 18
      const stroke = {
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }
      return h(
        'svg',
        { width: edge, height: edge, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M7 2.9H17', ...stroke }),
        h('path', { d: 'M5 7.9H19', ...stroke }),
        h('path', {
          d: 'M5.9 12.9H18.1Q21.1 12.9 21.1 15.9V18.1Q21.1 21.1 18.1 21.1H5.9Q2.9 21.1 2.9 18.1V15.9Q2.9 12.9 5.9 12.9Z',
          ...stroke,
        }),
      )
    }

    function Icon({ name, size = 16 }) {
      const Comp = Primitives[name]
      if (typeof Comp === 'function') return h(Comp, { size })
      const props = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }
      const s = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }
      if (name === 'IconPlusOutlineRegular') return h('svg', props, h('path', { d: 'M8 2.5v11M2.5 8h11', ...s }))
      if (name === 'IconCloseOutline16' || name === 'IconCloseOutlineRegular') return h('svg', props, h('path', { d: 'M3 3l10 10M13 3L3 13', ...s }))
      if (name === 'IconCheckOutlineRegular') return h('svg', props, h('path', { d: 'M3.2 8.4l3 3 6.6-6.6', ...s }))
      if (name === 'IconPanelRightOutline16') return h('svg', props, h('rect', { x: 1.5, y: 1.5, width: 13, height: 13, rx: 1.5, ...s }), h('path', { d: 'M10.5 1.5v13', ...s }))
      if (name === 'IconSearchOutlineRegular') return h('svg', props, h('circle', { cx: 6.8, cy: 6.8, r: 4.5, ...s }), h('path', { d: 'M10.4 10.4L14 14', ...s }))
      if (name === 'IconSlidersTwoOutlineRegular') return h('svg', props, h('path', { d: 'M2.5 5h5.5M11.5 5h2M2.5 11h2M8 11h5.5', ...s }), h('circle', { cx: 9.8, cy: 5, r: 1.4, ...s }), h('circle', { cx: 6.2, cy: 11, r: 1.4, ...s }))
      if (name === 'IconBranchOutlineRegular') return h('svg', props, h('path', { d: 'M4.5 4v8M4.5 8c0-2 1.5-3.4 3.5-3.4h3', ...s }), h('circle', { cx: 4.5, cy: 3, r: 1.2, ...s }), h('circle', { cx: 4.5, cy: 13, r: 1.2, ...s }), h('circle', { cx: 11.5, cy: 4.6, r: 1.2, ...s }))
      if (name === 'IconStopFillRegular') return h('svg', props, h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.2, fill: 'currentColor' }))
      if (name === 'IconRefreshOutlineRegular') return h('svg', props, h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.5L13 6M13 2.5V6H9.5', ...s }))
      if (name === 'IconTrashOutlineRegular') return h('svg', props, h('path', { d: 'M3.2 5.2h9.6M6.2 5.2V3.6h3.6v1.6M4.6 5.2l.6 7.4h5.6l.6-7.4', ...s }))
      if (name === 'IconArchiveOutlineRegular') return h('svg', props, h('rect', { x: 1.8, y: 2.5, width: 12.4, height: 3, rx: 0.8, ...s }), h('path', { d: 'M2.8 5.5v7.5a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1V5.5M6.5 9.2h3', ...s }))
      if (name === 'IconCopyOutlineRegular') return h('svg', props, h('rect', { x: 5.5, y: 5.5, width: 7.5, height: 7.5, rx: 1.2, ...s }), h('path', { d: 'M10.5 5.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5', ...s }))
      if (name === 'IconFolderOpenOutlineRegular') return h('svg', props, h('path', { d: 'M2 4.5a1 1 0 0 1 1-1h3.2l1.4 1.5H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5z', ...s }))
      if (name === 'IconPauseOutlineRegular') return h('svg', props, h('path', { d: 'M5.5 3.5v9M10.5 3.5v9', ...s }))
      if (name === 'IconPlayOutlineRegular') return h('svg', props, h('path', { d: 'M5 3.5l7.5 4.5L5 12.5V3.5z', ...s }))
      if (name === 'IconSettingsOutlineRegular') return h('svg', props, h('circle', { cx: 8, cy: 8, r: 2.2, ...s }), h('circle', { cx: 8, cy: 8, r: 5.5, strokeDasharray: '2.5 2', ...s }))
      if (name === 'IconDataOutlineRegular') return h('svg', props, h('ellipse', { cx: 8, cy: 4, rx: 5, ry: 2, ...s }), h('path', { d: 'M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4', ...s }))
      if (name === 'IconChevronLeftOutlineRegular') return h('svg', props, h('path', { d: 'M9.5 3.5L5 8l4.5 4.5', ...s }))
      if (name === 'IconChevronRightOutlineRegular') return h('svg', props, h('path', { d: 'M6.5 3.5L11 8l-4.5 4.5', ...s }))
      if (name === 'IconChevronDownOutlineRegular') return h('svg', props, h('path', { d: 'M3.5 6.5L8 11l4.5-4.5', ...s }))
      if (name === 'IconPinOutlineRegular') return h('svg', props, h('path', { d: 'M5.5 2.5h5l-.8 4.2 2.3 2.1v1H8.7v3.7L8 14.5l-.7-1V9.8H4v-1l2.3-2.1-.8-4.2z', ...s }))
      if (name === 'IconPinFillRegular') return h('svg', props, h('path', { d: 'M5.5 2.5h5l-.8 4.2 2.3 2.1v1H8.7v3.7L8 14.5l-.7-1V9.8H4v-1l2.3-2.1-.8-4.2z', fill: 'currentColor' }))
      if (name === 'IconDeliverDocRegular') return h('svg', props, h('path', { d: 'M4 2.2h5.2L12.5 5.5v8.3H4V2.2z', ...s }), h('path', { d: 'M9 2.2v3.5h3.5M6 8.2h4M6 10.8h4', ...s }))
      if (name === 'IconSendOutlineRegular') return h('svg', props, h('path', { d: 'M2.2 8l11.6-5.2-3.4 11.4-2.5-4.2L2.2 8z', ...s }))
      if (name === 'IconEditOutlineRegular') return h('svg', props, h('path', { d: 'M10.8 2.8l2.4 2.4-7.4 7.4-3 .6.6-3 7.4-7.4z', ...s }))
      if (name === 'IconLinkOutlineRegular') return h('svg', props, h('path', { d: 'M6.5 9.5l3-3M5.2 10.8a2.5 2.5 0 0 1 0-3.5l1.2-1.2a2.5 2.5 0 0 1 3.5 0M10.8 5.2a2.5 2.5 0 0 1 0 3.5l-1.2 1.2a2.5 2.5 0 0 1-3.5 0', ...s }))
      if (name === 'IconWarningOutlineRegular') return h('svg', props, h('path', { d: 'M8 2.4L14 13H2L8 2.4zM8 6.4v3.2M8 11.2h.01', ...s }))
      return h('svg', props, h('circle', { cx: 8, cy: 8, r: 4, ...s }))
    }

    function statusTagTone(status) {
      if (status === 'running') return 'info'
      if (status === 'review') return 'warning'
      if (status === 'failed') return 'danger'
      if (status === 'blocked') return 'warning'
      if (status === 'resolved') return 'success'
      return 'neutral'
    }

    function StatusBadge({ status, t }) {
      return h(UITag, { tone: statusTagTone(status) }, t(status || 'queued'))
    }

    function ThreadGlyph({ status, className }) {
      if (status === 'running') {
        return h('span', { className: `pj-glyph ${className || ''}` }, h(UIStateDot, { state: 'ongoing', size: 14 }))
      }
      if (status === 'review') {
        return h('span', { className: `pj-glyph pj-glyph-review ${className || ''}` }, h(ProjectStatusDot, { status: 'review' }))
      }
      if (status === 'failed') {
        return h('span', { className: `pj-glyph pj-glyph-failed ${className || ''}` }, h(UIStateDot, { state: 'error', size: 10 }))
      }
      if (status === 'blocked' || status === 'waiting') {
        return h('span', { className: `pj-glyph pj-glyph-waiting ${className || ''}` }, h(ProjectStatusDot, { status: 'waiting' }))
      }
      if (status === 'resolved') {
        return h('span', { className: `pj-glyph pj-glyph-resolved ${className || ''}` }, h(UIStateDot, { state: 'done', appearance: 'step', size: 14 }))
      }
      return h('span', { className: `pj-glyph pj-glyph-idle ${className || ''}` }, h(ProjectStatusDot, { status: 'idle' }))
    }

    // =========================================================================
    // Section 6: Embedded Conversation & In-Chat Dispatch Tool Card
    // =========================================================================

    class EmbeddedBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error) {
        console.error('dsh-project: embedded conversation failed', error)
      }
      render() {
        return this.state.failed ? this.props.fallback : this.props.children
      }
    }

    function FixedChatView(props) {
      return typeof props.renderSlot === 'function'
        ? props.renderSlot('conversation.session', { view: 'chat' })
        : null
    }

    function ConversationContentHost(props) {
      const { sessionId, useSession, renderFactorySlot } = props
      const session = useSession((value) => value)
      // Embedded coordinator & worker chats always dock the composer directly
      // (hero: false) so the global welcome hero / workspace picker never flashes
      // inside a project surface that already owns its workspace.
      const settling = !sessionId || (session && session.openState === 'loading')
      return renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: settling ? 'settling' : 'active', hero: false },
        { slots: { views: FixedChatView } },
      )
    }

    function EmbeddedConversation(props) {
      if (typeof props.useSession !== 'function' || typeof props.renderFactorySlot !== 'function') {
        return h('div', { className: 'pj-empty' }, 'The conversation surface is unavailable.')
      }
      return h(ConversationContentHost, props)
    }

    function ProjectsDispatchRow(props) {
      const t = typeof props.translate === 'function' ? props.translate : (k) => k
      const locale = typeof props.activeLocale === 'function' ? props.activeLocale() : 'zh'
      const block = props.block
      const args = block && block.args
      const readArg = (name) => {
        try {
          return args && typeof args.text === 'function' ? String(args.text(name) || '') : ''
        } catch {
          return ''
        }
      }
      const projectId = readArg('project_id')
      const taskId = readArg('task_id')
      const snapshot = useStoreValue(projectSnapshot)
      const tasks = snapshot && snapshot.projectId === projectId ? (snapshot.project && snapshot.project.tasks) || [] : []
      const task = tasks.find((entry) => entry && entry.id === taskId) || null
      const resultText = props.phase === 'result' && block && Array.isArray(block.content)
        ? block.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n').trim()
        : ''
      const status = task
        ? task.status
        : props.phase === 'result'
          ? (block && block.isError) ? 'failed' : /^(Dispatched|Continued) task\b/.test(resultText) ? 'running' : 'queued'
          : props.phase === 'start'
            ? 'running'
            : 'queued'
      const title = (task && task.title) || taskId || t('dispatchPreparing')
      const stamp = task ? relativeTime(task, t, locale) : ''
      const branch = task && task.branch ? String(task.branch).trim() : ''
      const openable = Boolean(projectId && taskId)

      return h(
        'div',
        { className: 'pj-dispatch-wrap' },
        h('style', { dangerouslySetInnerHTML: { __html: DISPATCH_SHARED_CSS } }),
        h(
          'button',
          {
            type: 'button',
            className: 'pj-dispatch-card',
            disabled: !openable,
            'aria-label': `${t('dispatchCard')}: ${title}`,
            title: openable ? `${title} — ${t('dispatchOpenHint')}` : title,
            onClick: () => {
              if (openable) requestOpenTask(projectId, taskId)
            },
          },
          h(ThreadGlyph, { status }),
          h('span', { className: 'pj-dispatch-title' }, title),
          branch &&
            h(
              'span',
              { className: 'pj-chip pj-chip-branch', title: branch },
              h(Icon, { name: 'IconBranchOutlineRegular', size: 12 }),
              t('isolatedBranch'),
            ),
          stamp && h('span', { className: 'pj-dispatch-time' }, stamp),
          h(StatusBadge, { status, t }),
        ),
      )
    }

    // =========================================================================
    // Section 7: Overview, Topbar Switcher, Task Detail & Tasks Drawer
    // =========================================================================

    function ProjectsOverview({
      projects,
      busy,
      onSelect,
      onNewProject,
      onOpenSettings,
      onArchiveToggle,
      onRequestDelete,
      t,
    }) {
      const [showArchived, setShowArchived] = useState(false)
      const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects])
      const archivedProjects = useMemo(() => projects.filter((p) => p.archived), [projects])
      const visibleProjects = showArchived ? projects : activeProjects

      if (projects.length === 0) {
        return h(
          Fragment,
          null,
          h('header', { className: 'pj-topbar pj-topbar-quiet', 'aria-hidden': 'true' }),
          h(
            'section',
            { className: 'pj-overview-empty', 'data-projects-empty': 'true', 'aria-label': t('projects') },
            h('div', { className: 'pj-empty-mark' }, h(ProjectsIcon, { size: 22 })),
            h('h1', { className: 'pj-empty-heading' }, t('emptyHeroTitle')),
            h('p', { className: 'pj-empty-desc' }, t('emptyHeroDesc')),
            h(
              UIButton,
              {
                variant: 'primary',
                size: 'md',
                shape: 'pill',
                icon: h(Icon, { name: 'IconPlusOutlineRegular', size: 14 }),
                disabled: busy,
                onClick: onNewProject,
              },
              t('newProject'),
            ),
          ),
        )
      }

      return h(
        Fragment,
        null,
        h('header', { className: 'pj-topbar pj-topbar-quiet', 'aria-hidden': 'true' }),
        h(
          'section',
          { className: 'pj-overview-scroll', 'data-projects-overview': 'true', 'aria-label': t('allProjects') },
          h(
            'div',
            { className: 'pj-overview-inner' },
            h(
              'div',
              { className: 'pj-overview-head' },
              h(
                'div',
                { className: 'pj-overview-title-row' },
                h('h1', { className: 'pj-overview-title' }, t('allProjects')),
                h('span', { className: 'pj-overview-count' }, String(visibleProjects.length)),
              ),
              h(
                'div',
                { className: 'pj-head-actions' },
                archivedProjects.length > 0 &&
                  h(
                    UIPill,
                    {
                      active: showArchived,
                      onClick: () => setShowArchived((v) => !v),
                    },
                    `${t('archivedProjects')} (${archivedProjects.length})`,
                  ),
                h(
                  UIButton,
                  {
                    variant: 'primary',
                    size: 'sm',
                    shape: 'pill',
                    icon: h(Icon, { name: 'IconPlusOutlineRegular', size: 14 }),
                    disabled: busy,
                    onClick: onNewProject,
                  },
                  t('newProject'),
                ),
              ),
            ),
            visibleProjects.length === 0
              ? h('div', { className: 'pj-empty' }, t('noActiveProjects'))
              : h(
                  'div',
                  { className: 'pj-overview-grid' },
                  visibleProjects.map((entry) =>
                    h(
                      'div',
                      {
                        key: entry.id,
                        role: 'button',
                        tabIndex: 0,
                        className: 'pj-card',
                        onClick: () => onSelect(entry),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onSelect(entry)
                          }
                        },
                      },
                      h(
                        'div',
                        { className: 'pj-card-top' },
                        h(
                          'div',
                          { className: 'pj-card-title-wrap' },
                          h(ProjectStatusDot, {
                            status: projectStatusOf(entry),
                            title: projectStatusLabel(projectStatusOf(entry), t),
                          }),
                          h('h2', { className: 'pj-card-name', title: entry.name }, entry.name),
                        ),
                        entry.paused && !entry.archived && h(UITag, { tone: 'warning' }, t('pausedBadge')),
                        entry.archived && h(UITag, { tone: 'neutral' }, t('archivedBadge')),
                      ),
                      h(
                        'div',
                        { className: 'pj-card-meta' },
                        entry.workspace &&
                          h(
                            'span',
                            { className: 'pj-card-dir', title: entry.workspace },
                            h(Icon, { name: 'IconFolderOpenOutlineRegular', size: 13 }),
                            shortPath(entry.workspace),
                          ),
                      ),
                      h(
                        'div',
                        { className: 'pj-card-foot' },
                        h('span', { className: 'pj-hint' }, countsLine(entry, t)),
                        h(
                          'div',
                          { className: 'pj-card-actions', onClick: (e) => e.stopPropagation() },
                          h(
                            UITooltip,
                            { label: t('settings'), side: 'bottom', portal: true },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'pj-icon-btn',
                                'aria-label': `${t('settings')}: ${entry.name}`,
                                disabled: busy,
                                onClick: () => onOpenSettings(entry),
                              },
                              h(Icon, { name: 'IconSettingsOutlineRegular', size: 14 }),
                            ),
                          ),
                          h(
                            UITooltip,
                            { label: entry.archived ? t('unarchive') : t('archive'), side: 'bottom', portal: true },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'pj-icon-btn',
                                'aria-label': `${entry.archived ? t('unarchive') : t('archive')}: ${entry.name}`,
                                disabled: busy,
                                onClick: () => onArchiveToggle(entry, !entry.archived),
                              },
                              h(Icon, { name: 'IconArchiveOutlineRegular', size: 14 }),
                            ),
                          ),
                          h(
                            UITooltip,
                            { label: t('deleteProject'), side: 'bottom', portal: true },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'pj-icon-btn pj-danger-btn',
                                'aria-label': `${t('deleteProject')}: ${entry.name}`,
                                disabled: busy,
                                onClick: () => onRequestDelete(entry),
                              },
                              h(Icon, { name: 'IconTrashOutlineRegular', size: 14 }),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
          ),
        ),
      )
    }

    function ProjectSwitcher({
      projects,
      currentProject,
      busy,
      onSelect,
      onNewProject,
      onShowOverview,
      t,
    }) {
      const [open, setOpen] = useState(false)
      const wrapRef = useRef(null)

      const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects])
      const archivedProjects = useMemo(() => projects.filter((p) => p.archived), [projects])

      useEffect(() => {
        if (!open || typeof Primitives.Menu === 'function' || typeof window === 'undefined') return undefined
        const onPointerDown = (e) => {
          if (wrapRef.current && typeof wrapRef.current.contains === 'function' && wrapRef.current.contains(e.target)) return
          setOpen(false)
        }
        const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false) }
        window.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
          window.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open])

      const currentStatus = projectStatusOf(currentProject)
      const statusForEntry = (entry) => (entry.id === currentProject.id ? currentStatus : projectStatusOf(entry))

      const trigger = h(
        'button',
        {
          type: 'button',
          className: 'pj-switcher-btn',
          'aria-label': t('switchProject'),
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          title: currentProject.name,
          onClick: () => setOpen((v) => !v),
        },
        h(ProjectStatusDot, { status: currentStatus, title: projectStatusLabel(currentStatus, t) }),
        h('span', { className: 'pj-switcher-name' }, currentProject.name),
        h(Icon, { name: 'IconChevronDownOutlineRegular', size: 14 }),
      )

      if (typeof Primitives.Menu === 'function') {
        const items = [
          ...activeProjects.map((entry) => {
            const st = statusForEntry(entry)
            return {
              id: `proj:${entry.id}`,
              label: entry.name,
              hint: countsLine(entry, t),
              icon: h(ProjectStatusDot, { status: st, title: projectStatusLabel(st, t) }),
            }
          }),
          ...(archivedProjects.length > 0
            ? [
                { type: 'separator', id: 'sep-archived' },
                { type: 'label', id: 'lbl-archived', text: t('archivedProjects') },
                ...archivedProjects.map((entry) => ({
                  id: `proj:${entry.id}`,
                  label: entry.name,
                  hint: t('archivedBadge'),
                  icon: h(ProjectStatusDot, { status: 'idle', title: t('archivedBadge') }),
                })),
              ]
            : []),
        ]
        const footer = [
          { id: 'act:new', label: t('newProject'), icon: h(Icon, { name: 'IconPlusOutlineRegular', size: 14 }), disabled: busy },
          { id: 'act:all', label: t('allProjects'), icon: h(ProjectsIcon, { size: 14 }) },
        ]
        return h(Primitives.Menu, {
          open,
          onClose: () => setOpen(false),
          align: 'start',
          portal: true,
          anchor: trigger,
          items,
          footer,
          selectedId: `proj:${currentProject.id}`,
          onSelect: (id) => {
            setOpen(false)
            if (id === 'act:new') onNewProject()
            else if (id === 'act:all') onShowOverview()
            else if (id.startsWith('proj:')) {
              const target = projects.find((p) => p.id === id.slice(5))
              if (target) onSelect(target)
            }
          },
        })
      }

      return h(
        'div',
        { ref: wrapRef, className: 'pj-switcher-wrap' },
        trigger,
        open &&
          h(
            'div',
            { className: 'pj-popover-menu pj-align-start', role: 'menu', 'aria-label': t('switchProject') },
            activeProjects.map((entry) => {
              const st = statusForEntry(entry)
              return h(
                'button',
                {
                  key: entry.id,
                  type: 'button',
                  role: 'menuitem',
                  className: 'pj-menu-row',
                  onClick: () => { setOpen(false); onSelect(entry) },
                },
                h('span', { className: 'pj-menu-check' }, entry.id === currentProject.id ? h(Icon, { name: 'IconCheckOutlineRegular', size: 14 }) : null),
                h(ProjectStatusDot, { status: st, title: projectStatusLabel(st, t) }),
                h(
                  'span',
                  { className: 'pj-menu-text' },
                  h('span', null, entry.name),
                  h('span', { className: 'pj-menu-hint' }, countsLine(entry, t)),
                ),
              )
            }),
            archivedProjects.length > 0 &&
              h(
                Fragment,
                null,
                h('div', { className: 'pj-menu-sep', role: 'separator' }),
                h('div', { className: 'pj-menu-caption' }, t('archivedProjects')),
                archivedProjects.map((entry) =>
                  h(
                    'button',
                    {
                      key: entry.id,
                      type: 'button',
                      role: 'menuitem',
                      className: 'pj-menu-row',
                      onClick: () => { setOpen(false); onSelect(entry) },
                    },
                    h('span', { className: 'pj-menu-check' }, entry.id === currentProject.id ? h(Icon, { name: 'IconCheckOutlineRegular', size: 14 }) : null),
                    h('span', null, entry.name),
                  ),
                ),
              ),
            h('div', { className: 'pj-menu-sep', role: 'separator' }),
            h(
              'button',
              { type: 'button', role: 'menuitem', className: 'pj-menu-row', disabled: busy, onClick: () => { setOpen(false); onNewProject() } },
              h('span', { className: 'pj-menu-icon' }, h(Icon, { name: 'IconPlusOutlineRegular', size: 14 })),
              h('span', null, t('newProject')),
            ),
            h(
              'button',
              { type: 'button', role: 'menuitem', className: 'pj-menu-row', onClick: () => { setOpen(false); onShowOverview() } },
              h('span', { className: 'pj-menu-icon' }, h(ProjectsIcon, { size: 14 })),
              h('span', null, t('allProjects')),
            ),
          ),
      )
    }

    function WorkspaceTopbar({
      projects,
      project,
      taskList,
      threadsOpen,
      containerWidth,
      busy,
      onShowOverview,
      onSelectProject,
      onNewProject,
      onOpenWorkspace,
      onToggleAutonomy,
      onTogglePaused,
      onOpenSettings,
      onToggleThreads,
      settingsBtnRef,
      t,
    }) {
      const currentStatus = projectStatusOf(project)
      const compactTopbar = containerWidth > 0 && containerWidth < TOPBAR_HIDE_WS_WIDTH

      return h(
        'header',
        { className: 'pj-topbar', 'data-projects-topbar': 'true', 'data-compact': compactTopbar ? 'true' : 'false' },
        h(
          'div',
          { className: 'pj-topbar-left' },
          h(
            UITooltip,
            { label: t('allProjects'), side: 'bottom', portal: true },
            h(
              'button',
              {
                type: 'button',
                className: 'pj-icon-btn',
                'aria-label': t('allProjects'),
                onClick: onShowOverview,
              },
              h(Icon, { name: 'IconChevronLeftOutlineRegular', size: 16 }),
            ),
          ),
          h(ProjectSwitcher, {
            projects,
            currentProject: project,
            busy,
            onSelect: onSelectProject,
            onNewProject,
            onShowOverview,
            t,
          }),
          project.archived && h(UITag, { tone: 'neutral' }, t('archivedBadge')),
          !compactTopbar &&
            project.workspace &&
            h(
              UITooltip,
              { label: `${t('openFolder')}: ${project.workspace}`, side: 'bottom', portal: true },
              h(
                UIPill,
                {
                  className: 'pj-ws-pill',
                  disabled: busy,
                  onClick: () => onOpenWorkspace(project),
                },
                h(Icon, { name: 'IconFolderOpenOutlineRegular', size: 13 }),
                h('span', { className: 'pj-ws-pill-text' }, shortPath(project.workspace)),
              ),
            ),
        ),
        h(
          'div',
          { className: 'pj-topbar-right' },
          h(
            UITooltip,
            {
              label: project.autonomy === 'auto' ? t('autonomyAutoHint') : t('autonomyManualHint'),
              side: 'bottom',
              portal: true,
            },
            h(
              UIPill,
              {
                active: project.autonomy === 'auto',
                disabled: busy || project.archived,
                'aria-label': t('autonomy'),
                onClick: onToggleAutonomy,
              },
              h(SafeFlipText, { text: project.autonomy === 'auto' ? t('autonomyAuto') : t('autonomyManual') }),
            ),
          ),
          h(
            UITooltip,
            { label: project.paused ? t('resumeProject') : t('pauseProject'), side: 'bottom', portal: true },
            h(
              UIPill,
              {
                active: Boolean(project.paused),
                className: project.paused ? 'pj-pill-paused' : undefined,
                disabled: busy || project.archived,
                'aria-label': project.paused ? t('resumeProject') : t('pauseProject'),
                onClick: onTogglePaused,
              },
              h(Icon, { name: project.paused ? 'IconPlayOutlineRegular' : 'IconPauseOutlineRegular', size: 12 }),
              h(SafeFlipText, { text: project.paused ? t('resumeProject') : t('pauseProject') }),
            ),
          ),
          h(
            UITooltip,
            { label: t('settings'), side: 'bottom', portal: true },
            h(
              'button',
              {
                type: 'button',
                ref: settingsBtnRef,
                className: 'pj-icon-btn',
                'aria-label': t('settings'),
                onClick: onOpenSettings,
              },
              h(Icon, { name: 'IconSettingsOutlineRegular', size: 16 }),
            ),
          ),
          h(
            UITooltip,
            { label: threadsOpen ? t('collapseThreads') : t('expandThreads'), side: 'bottom', portal: true },
            h(
              UIPill,
              {
                active: threadsOpen,
                className: 'pj-tasks-toggle',
                'aria-label': threadsOpen ? t('collapseThreads') : t('expandThreads'),
                'aria-expanded': threadsOpen ? 'true' : 'false',
                onClick: onToggleThreads,
              },
              h(ProjectStatusDot, { status: currentStatus, title: projectStatusLabel(currentStatus, t) }),
              h('span', null, `${t('threads')} · ${taskList.length}`),
            ),
          ),
        ),
      )
    }

    function TaskDiffPanel({ projectId, task, refreshToken, onMerge, onCleanup, canSendFeedback, onSendFeedback, busy, t }) {
      const [loading, setLoading] = useState(true)
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [feedback, setFeedback] = useState('')
      const [sendingFeedback, setSendingFeedback] = useState(false)
      const feedbackRef = useRef(null)
      const seqRef = useRef(0)

      useEffect(() => {
        setFeedback('')
      }, [task && task.id])

      const fetchDiff = useCallback(async () => {
        if (!projectId || !task || !task.id) return
        const seq = ++seqRef.current
        setLoading(true)
        setError('')
        try {
          const result = await api(`/projects/${projectId}/tasks/${task.id}/diff`)
          if (seq !== seqRef.current) return
          setData(result)
        } catch (err) {
          if (seq !== seqRef.current) return
          setError(messageOf(err))
        } finally {
          if (seq === seqRef.current) setLoading(false)
        }
      }, [projectId, task && task.id])

      useEffect(() => {
        void fetchDiff()
        return () => { seqRef.current += 1 }
      }, [fetchDiff, refreshToken])

      const hasWorktree = Boolean((task && (task.worktreePath || task.branch)) || (data && data.worktreePath))
      const files = (data && Array.isArray(data.files)) ? data.files : []
      const diffText = (data && typeof data.diff === 'string') ? data.diff : ''
      const mergeability = data && data.mergeability && typeof data.mergeability === 'object' ? data.mergeability : null

      const renderMergeabilityBadge = () => {
        if (!mergeability || !mergeability.status || mergeability.status === 'unavailable') return null
        const st = mergeability.status
        const conflicts = Array.isArray(mergeability.conflictFiles) ? mergeability.conflictFiles : []
        const tip = mergeability.reason || (conflicts.length > 0 ? conflicts.join(', ') : '')
        if (st === 'clean' || mergeability.canMergeCleanly === true) {
          return h('span', { title: tip || undefined, 'data-mergeability': 'clean' }, h(UITag, { tone: 'success' }, t('mergeClean')))
        }
        if (st === 'conflicts') {
          const label = conflicts.length > 0 ? `${t('mergeConflicts')} (${conflicts.length})` : t('mergeConflicts')
          return h('span', { title: tip || undefined, 'data-mergeability': 'conflicts' }, h(UITag, { tone: 'danger' }, label))
        }
        if (st === 'dirty_worktree') {
          return h('span', { title: tip || undefined, 'data-mergeability': st }, h(UITag, { tone: 'warning' }, t('mergeDirtyWorktree')))
        }
        if (st === 'dirty_workspace') {
          return h('span', { title: tip || undefined, 'data-mergeability': st }, h(UITag, { tone: 'warning' }, t('mergeDirtyWorkspace')))
        }
        if (st === 'already_merged') {
          return h('span', { title: tip || undefined, 'data-mergeability': st }, h(UITag, { tone: 'neutral' }, t('mergeAlreadyMerged')))
        }
        return null
      }

      const prefillForFile = (filePath) => {
        const prefix = `[${filePath}] `
        setFeedback((cur) => {
          const trimmed = cur.trimStart()
          if (!trimmed || /^\[[^\]]+\]\s*$/.test(trimmed)) return prefix
          if (trimmed.startsWith(prefix)) return cur
          return `${prefix}${trimmed}`
        })
        const focusInput = () => {
          const node = feedbackRef.current
          if (node && typeof node.focus === 'function') {
            node.focus()
            if (typeof node.setSelectionRange === 'function') {
              const end = (node.value || '').length
              try { node.setSelectionRange(end, end) } catch {}
            }
          }
        }
        if (typeof queueMicrotask === 'function') queueMicrotask(focusInput)
        else focusInput()
      }

      const submitFeedback = async () => {
        const text = feedback.trim()
        if (!text || !canSendFeedback || typeof onSendFeedback !== 'function' || sendingFeedback) return
        setSendingFeedback(true)
        try {
          const sent = await onSendFeedback(text)
          if (sent !== false) setFeedback('')
        } finally {
          setSendingFeedback(false)
        }
      }

      const fileStatusLabel = (st) => {
        if (st === 'added' || st === 'A') return t('diffAdded')
        if (st === 'deleted' || st === 'D') return t('diffDeleted')
        if (st === 'renamed' || st === 'R') return t('diffRenamed')
        if (st === 'untracked' || st === '?') return t('diffUntracked')
        return t('diffModified')
      }

      const fileStatusTone = (st) => {
        if (st === 'added' || st === 'A') return 'success'
        if (st === 'deleted' || st === 'D') return 'danger'
        if (st === 'untracked' || st === '?') return 'info'
        return 'neutral'
      }

      return h(
        'div',
        { className: 'pj-diff-panel' },
        h(
          'div',
          { className: 'pj-diff-toolbar' },
          h(
            'div',
            { className: 'pj-head-actions' },
            h(
              'span',
              { className: 'pj-hint' },
              files.length > 0 ? `${files.length} ${t('diffFilesCount')}` : (data && data.baseRef ? `base: ${data.baseRef}` : t('tabDiff')),
            ),
            renderMergeabilityBadge(),
          ),
          h(
            'div',
            { className: 'pj-head-actions' },
            hasWorktree &&
              h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy || loading, onClick: onMerge }, t('worktreeMerge')),
            hasWorktree &&
              h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy || loading, onClick: onCleanup }, t('worktreeCleanup')),
            h(
              'button',
              {
                type: 'button',
                className: 'pj-icon-btn',
                'aria-label': t('diffRefresh'),
                title: t('diffRefresh'),
                disabled: loading,
                onClick: () => void fetchDiff(),
              },
              h(Icon, { name: 'IconRefreshOutlineRegular', size: 14 }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'pj-diff-scroll' },
          loading
            ? h('div', { className: 'pj-empty' }, t('diffLoading'))
            : error
              ? h('div', { className: 'pj-empty' }, error)
              : data && data.available === false
                ? h('div', { className: 'pj-empty' }, data.note || t('diffUnavailable'))
                : files.length === 0 && !diffText
                  ? h('div', { className: 'pj-empty' }, (data && data.note) || t('diffEmpty'))
                  : h(
                      Fragment,
                      null,
                      files.length > 0 &&
                        h(
                          'div',
                          { className: 'pj-diff-files' },
                          files.map((file, idx) =>
                            h(
                              'div',
                              { key: `${file.path}:${idx}`, className: 'pj-diff-file-row' },
                              h(UITag, { tone: fileStatusTone(file.status) }, fileStatusLabel(file.status)),
                              h('span', { className: 'pj-diff-file-path', title: file.path }, file.path),
                              h(
                                'div',
                                { className: 'pj-diff-file-right' },
                                h(
                                  'span',
                                  { className: 'pj-diff-counts' },
                                  typeof file.additions === 'number' && file.additions > 0 && h('span', { className: 'pj-diff-add' }, `+${file.additions}`),
                                  typeof file.deletions === 'number' && file.deletions > 0 && h('span', { className: 'pj-diff-del' }, `-${file.deletions}`),
                                ),
                                h(
                                  UIButton,
                                  {
                                    variant: 'ghost',
                                    size: 'sm',
                                    shape: 'pill',
                                    disabled: !canSendFeedback || busy,
                                    'aria-label': `${t('diffRequestChanges')}: ${file.path}`,
                                    onClick: () => prefillForFile(file.path),
                                  },
                                  t('diffRequestChanges'),
                                ),
                              ),
                            ),
                          ),
                        ),
                      data && data.truncated && h('p', { className: 'pj-hint' }, t('diffTruncated')),
                      diffText &&
                        h(
                          'pre',
                          { className: 'pj-diff-pre' },
                          diffText.split('\n').map((line, i) => {
                            const cls = line.startsWith('+') && !line.startsWith('+++')
                              ? 'pj-diff-line pj-diff-line-add'
                              : line.startsWith('-') && !line.startsWith('---')
                                ? 'pj-diff-line pj-diff-line-del'
                                : line.startsWith('@@')
                                  ? 'pj-diff-line pj-diff-line-hunk'
                                  : 'pj-diff-line'
                            return h('span', { key: i, className: cls }, `${line}\n`)
                          }),
                        ),
                    ),
        ),
        h(
          'div',
          { className: 'pj-diff-feedback-bar', 'data-diff-feedback-bar': 'true' },
          h(UIInput, {
            ref: feedbackRef,
            variant: 'form',
            className: 'pj-diff-feedback-input',
            'aria-label': t('diffFeedbackLabel'),
            placeholder: canSendFeedback ? t('diffFeedbackPlaceholder') : t('diffFeedbackUnavailable'),
            disabled: !canSendFeedback || busy || sendingFeedback,
            value: feedback,
            onChange: (e) => setFeedback(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
                e.preventDefault()
                void submitFeedback()
              }
            },
          }),
          h(
            UIButton,
            {
              variant: 'primary',
              size: 'sm',
              shape: 'pill',
              icon: h(Icon, { name: 'IconSendOutlineRegular', size: 13 }),
              loading: sendingFeedback,
              disabled: !canSendFeedback || busy || sendingFeedback || !feedback.trim(),
              onClick: () => void submitFeedback(),
            },
            t('diffFeedbackSend'),
          ),
        ),
      )
    }

    function TaskDetailStage({
      project,
      catalog,
      execTarget,
      execTask,
      diffRefreshToken,
      busy,
      onCloseDetail,
      onApproveTask,
      onStopTask,
      onRetryTask,
      onResolveTask,
      onCopyBranch,
      onRequestMergeWorktree,
      onRequestCleanupWorktree,
      onSendWorkerFeedback,
      SessionProvider,
      renderSlot,
      t,
    }) {
      const [detailTab, setDetailTab] = useState('chat')

      useEffect(() => {
        setDetailTab('chat')
      }, [execTarget && execTarget.taskId])

      const accepted = execTask && execTask.status === 'resolved'
      const effModel = execTask ? effectiveModel(project, execTask) : null
      const effEffort = execTask ? effectiveEffort(project, execTask) : null
      const modelSrc = effModel && (effModel.source === 'task' ? t('fromTask') : effModel.source === 'project' ? t('fromProject') : t('fromHost'))
      const effEffortText = effEffort && effEffort.value ? effortLabel(catalog, effModel && effModel.value, effEffort.value, t) : ''
      const metaParts = execTask
        ? [
            effModel && effModel.value ? `${modelLabel(catalog, effModel.value)} (${modelSrc})` : t('fromHost'),
            effEffortText ? `${t('effortShort')}: ${effEffortText}` : '',
            execTask.childName || '',
          ].filter(Boolean)
        : []
      const branch = execTask ? String(execTask.branch || '').trim() : ''
      const wtNote = execTask ? worktreeNoteOf(execTask, t) : ''
      const canApprove = Boolean(execTask && project.autonomy === 'manual' && !execTask.approved && execTask.status !== 'running' && execTask.status !== 'resolved')

      return h(
        'div',
        { className: 'pj-detail-shell', 'data-projects-task-detail': execTarget.taskId },
        h(
          'div',
          { className: 'pj-detail-bar' },
          h(
            'div',
            { className: 'pj-detail-row' },
            h(
              'div',
              { className: 'pj-detail-lead' },
              h(
                UIButton,
                {
                  variant: 'ghost',
                  size: 'sm',
                  icon: h(Icon, { name: 'IconChevronLeftOutlineRegular', size: 14 }),
                  onClick: onCloseDetail,
                },
                t('backToCoordinator'),
              ),
              h('span', { className: 'pj-detail-title', title: (execTask && execTask.title) || execTarget.title }, (execTask && execTask.title) || execTarget.title),
              execTask && h(StatusBadge, { status: execTask.status, t }),
            ),
            execTask &&
              h(
                'div',
                { className: 'pj-detail-controls' },
                h(UISegmentedTabs, {
                  size: 'sm',
                  label: t('taskViewTabs'),
                  value: detailTab,
                  onChange: setDetailTab,
                  items: [
                    { value: 'chat', label: t('tabChat'), id: 'pj-tab-chat', panelId: 'pj-panel-chat' },
                    { value: 'diff', label: t('tabDiff'), id: 'pj-tab-diff', panelId: 'pj-panel-diff' },
                  ],
                }),
                canApprove &&
                  h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy || project.archived, onClick: () => onApproveTask(execTask) }, t('approve')),
                execTask.status === 'running' &&
                  h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, icon: h(Icon, { name: 'IconStopFillRegular', size: 12 }), onClick: () => onStopTask(execTask) }, t('stop')),
                (execTask.status === 'failed' || execTask.status === 'blocked') &&
                  h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy || project.archived, icon: h(Icon, { name: 'IconRefreshOutlineRegular', size: 13 }), onClick: () => onRetryTask(execTask) }, t('retry')),
                h(
                  UIButton,
                  {
                    variant: accepted ? 'outline' : 'ghost',
                    size: 'sm',
                    shape: 'pill',
                    disabled: busy,
                    'aria-pressed': accepted ? 'true' : 'false',
                    icon: h(Icon, { name: 'IconCheckOutlineRegular', size: 14 }),
                    onClick: () => onResolveTask(execTask),
                  },
                  accepted ? t('unresolve') : t('resolve'),
                ),
              ),
          ),
          (branch || wtNote || metaParts.length > 0) &&
            h(
              'div',
              { className: 'pj-detail-meta-bar' },
              branch &&
                h(
                  'span',
                  { className: 'pj-branch-pill' },
                  h(Icon, { name: 'IconBranchOutlineRegular', size: 12 }),
                  h('code', { className: 'pj-branch-code', title: execTask.worktreePath || branch }, branch),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'pj-icon-btn',
                      style: { width: '20px', height: '20px' },
                      'aria-label': t('copyBranch'),
                      title: t('copyBranch'),
                      onClick: () => onCopyBranch(branch),
                    },
                    h(Icon, { name: 'IconCopyOutlineRegular', size: 12 }),
                  ),
                ),
              wtNote && h('span', { className: 'pj-worktree-warn', title: wtNote }, wtNote),
              metaParts.length > 0 && h('span', null, metaParts.join(' · ')),
              execTask && execTask.approved && h(UITag, { tone: 'neutral' }, t('approvedBadge')),
            ),
        ),
        h(
          'div',
          { className: 'pj-detail-body' },
          !execTask
            ? h('div', { className: 'pj-empty' }, t('noTask'))
            : detailTab === 'diff'
              ? h(
                  'div',
                  { id: 'pj-panel-diff', role: 'tabpanel', 'aria-labelledby': 'pj-tab-diff', className: 'pj-detail-body' },
                  h(TaskDiffPanel, {
                    projectId: project.id,
                    task: execTask,
                    refreshToken: diffRefreshToken,
                    busy,
                    canSendFeedback: Boolean(execTarget && execTarget.reference && !project.archived),
                    onSendFeedback: async (message) => {
                      if (typeof onSendWorkerFeedback !== 'function') return false
                      const ok = await onSendWorkerFeedback(execTarget, message)
                      if (ok !== false) setDetailTab('chat')
                      return ok
                    },
                    onMerge: () => onRequestMergeWorktree(execTask),
                    onCleanup: () => onRequestCleanupWorktree(execTask),
                    t,
                  }),
                )
              : h(
                  'div',
                  { id: 'pj-panel-chat', role: 'tabpanel', 'aria-labelledby': 'pj-tab-chat', className: 'pj-detail-body' },
                  execTarget.reference
                    ? h(
                        'div',
                        { className: 'pj-chat-host' },
                        h(
                          EmbeddedBoundary,
                          { fallback: h('div', { className: 'pj-empty' }, t('workerChatFailed')) },
                          typeof SessionProvider === 'function' && typeof renderSlot === 'function'
                            ? h(SessionProvider, { session: execTarget.reference }, renderSlot('projects.conversation', {}))
                            : h('div', { className: 'pj-empty' }, t('workerChatFailed')),
                        ),
                      )
                    : h(
                        'div',
                        { className: 'pj-exec-scroll' },
                        execTask.brief &&
                          h(
                            'div',
                            { className: 'pj-brief-card' },
                            h('div', { className: 'pj-label', style: { marginBottom: '8px' } }, t('taskBriefHeading')),
                            execTask.brief,
                          ),
                        h('div', { className: 'pj-empty' }, t('noConversation')),
                      ),
                ),
        ),
      )
    }

    function TaskContextMenu({
      menu,
      task,
      busy,
      onClose,
      onResolve,
      onStop,
      onRetry,
      onDelete,
      t,
    }) {
      const open = Boolean(menu && task)
      const presence = useSafePresence(open)
      const lastRef = useRef({ menu: null, task: null })
      if (open) lastRef.current = { menu, task }
      const activeMenu = open ? menu : lastRef.current.menu
      const activeTask = open ? task : lastRef.current.task

      const menuRef = useRef(null)
      const [pos, setPos] = useState({ x: (activeMenu && activeMenu.x) || 0, y: (activeMenu && activeMenu.y) || 0 })
      const [confirming, setConfirming] = useState(false)
      const armedAtRef = useRef(0)
      const armTimerRef = useRef(null)

      useEffect(() => {
        if (!activeMenu) return
        setPos({ x: activeMenu.x, y: activeMenu.y })
        setConfirming(false)
        if (armTimerRef.current !== null) {
          clearTimeout(armTimerRef.current)
          armTimerRef.current = null
        }
      }, [activeMenu && activeMenu.x, activeMenu && activeMenu.y, activeMenu && activeMenu.taskId, open])

      useEffect(() => () => {
        if (armTimerRef.current !== null) {
          clearTimeout(armTimerRef.current)
          armTimerRef.current = null
        }
      }, [])

      useLayoutEffect(() => {
        if (!open || !activeMenu) return
        const node = menuRef.current
        if (!node || typeof node.getBoundingClientRect !== 'function') return
        const rect = node.getBoundingClientRect()
        const vw = typeof document !== 'undefined' && document.documentElement ? document.documentElement.clientWidth : 0
        const vh = typeof document !== 'undefined' && document.documentElement ? document.documentElement.clientHeight : 0
        if (!(vw > 0 && vh > 0)) return
        const x = clamp(activeMenu.x, MENU_MARGIN, vw - rect.width - MENU_MARGIN)
        const y = clamp(activeMenu.y, MENU_MARGIN, vh - rect.height - MENU_MARGIN)
        if (x !== pos.x || y !== pos.y) setPos({ x, y })
      }, [open, activeMenu && activeMenu.x, activeMenu && activeMenu.y, confirming])

      useEffect(() => {
        if (!open || typeof window === 'undefined') return undefined
        const onPointerDown = (event) => {
          if (menuRef.current && typeof menuRef.current.contains === 'function' && menuRef.current.contains(event.target)) return
          if (event.button === 2 && activeMenu && activeMenu.trigger && typeof activeMenu.trigger.contains === 'function' && activeMenu.trigger.contains(event.target)) return
          onClose()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') onClose()
        }
        const onScroll = () => onClose()
        window.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        return () => {
          window.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
        }
      }, [open, onClose, activeMenu])

      if (!presence.mounted || !activeTask) return null
      const accepted = activeTask.status === 'resolved'
      const canArchive = Boolean(activeTask.childSessionId)

      const armDelete = () => {
        setConfirming(true)
        armedAtRef.current = Date.now()
        if (armTimerRef.current !== null) clearTimeout(armTimerRef.current)
        armTimerRef.current = setTimeout(() => {
          armTimerRef.current = null
          setConfirming((cur) => (Date.now() - armedAtRef.current >= 2900 ? false : cur))
        }, 3000)
      }

      const executeDelete = (archive) => {
        if (Date.now() - armedAtRef.current < 500) return
        if (armTimerRef.current !== null) {
          clearTimeout(armTimerRef.current)
          armTimerRef.current = null
        }
        onClose()
        onDelete(activeTask.id, { archive })
      }

      return h(
        'div',
        {
          ref: menuRef,
          className: 'pj-ctx-menu',
          role: 'menu',
          'aria-label': t('taskActions'),
          'aria-hidden': open ? undefined : 'true',
          'data-dsh-motion': 'popover',
          'data-state': presence.state,
          style: { left: `${pos.x}px`, top: `${pos.y}px` },
          onContextMenu: (e) => e.preventDefault(),
        },
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'pj-menu-row',
            disabled: busy,
            onClick: () => { onClose(); onResolve(activeTask) },
          },
          h('span', { className: 'pj-menu-icon' }, h(Icon, { name: 'IconCheckOutlineRegular', size: 14 })),
          h('span', null, accepted ? t('unresolve') : t('resolve')),
        ),
        activeTask.status === 'running' &&
          h(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              className: 'pj-menu-row',
              disabled: busy,
              onClick: () => { onClose(); onStop(activeTask) },
            },
            h('span', { className: 'pj-menu-icon' }, h(Icon, { name: 'IconStopFillRegular', size: 14 })),
            h('span', null, t('stop')),
          ),
        (activeTask.status === 'failed' || activeTask.status === 'blocked') &&
          h(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              className: 'pj-menu-row',
              disabled: busy,
              onClick: () => { onClose(); onRetry(activeTask) },
            },
            h('span', { className: 'pj-menu-icon' }, h(Icon, { name: 'IconRefreshOutlineRegular', size: 14 })),
            h('span', null, t('retry')),
          ),
        h('div', { className: 'pj-menu-sep', role: 'separator' }),
        !confirming
          ? h(
              'button',
              {
                type: 'button',
                role: 'menuitem',
                className: 'pj-menu-row pj-danger',
                disabled: busy,
                onClick: armDelete,
              },
              h('span', { className: 'pj-menu-icon' }, h(Icon, { name: 'IconTrashOutlineRegular', size: 14 })),
              h('span', null, t('delete')),
            )
          : h(
              Fragment,
              null,
              h('div', { className: 'pj-menu-caption' }, t('deleteConfirm')),
              h(
                'button',
                {
                  type: 'button',
                  role: 'menuitem',
                  className: 'pj-menu-row pj-danger',
                  disabled: busy,
                  onClick: () => executeDelete(false),
                },
                h('span', { className: 'pj-menu-icon' }, h(Icon, { name: 'IconTrashOutlineRegular', size: 14 })),
                h(
                  'span',
                  { className: 'pj-menu-text' },
                  h('span', null, t('deleteOnlyTask')),
                  h('span', { className: 'pj-menu-hint' }, t('deleteOnlyTaskHint')),
                ),
              ),
              canArchive &&
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    className: 'pj-menu-row',
                    disabled: busy,
                    onClick: () => executeDelete(true),
                  },
                  h('span', { className: 'pj-menu-icon' }, h(Icon, { name: 'IconArchiveOutlineRegular', size: 14 })),
                  h(
                    'span',
                    { className: 'pj-menu-text' },
                    h('span', null, t('deleteAndArchive')),
                    h('span', { className: 'pj-menu-hint' }, t('archiveSessionHint')),
                  ),
                ),
            ),
      )
    }

    function TasksPanel({
      project,
      library,
      memory,
      drawerTab,
      onDrawerTabChange,
      width,
      overlay,
      busy,
      execTarget,
      onClosePanel,
      onStartResize,
      onNudgeWidth,
      onSelectTask,
      onJumpTaskById,
      onApproveTask,
      onStopTask,
      onRetryTask,
      onResolveTask,
      onDeleteTask,
      onAddReference,
      onRemoveReference,
      onPreviewFile,
      onSaveInstructions,
      onToggleMemoryPin,
      onOpenMemoryPreview,
      onNewMemoryTopic,
      pickFolder,
      activeLocale,
      t,
    }) {
      const [searchOpen, setSearchOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [filterOpen, setFilterOpen] = useState(false)
      const [hiddenGroups, setHiddenGroups] = useState({})
      const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedGroups)
      const [menu, setMenu] = useState(null)
      const searchRef = useRef(null)
      const filterWrapRef = useRef(null)

      // Library inline add-reference state
      const [addingRef, setAddingRef] = useState(false)
      const [refPath, setRefPath] = useState('')
      const [refTitle, setRefTitle] = useState('')
      const [refNote, setRefNote] = useState('')
      const [refPathInvalid, setRefPathInvalid] = useState(false)

      // Memory tab: inline Instructions editor & live Memory search state
      const [editingRules, setEditingRules] = useState(false)
      const [rulesDraft, setRulesDraft] = useState('')
      const [memQuery, setMemQuery] = useState('')
      const [memSearchResult, setMemSearchResult] = useState(null)
      const [memSearching, setMemSearching] = useState(false)
      const memSearchSeqRef = useRef(0)

      useEffect(() => {
        writeStored('collapsedGroups', JSON.stringify(collapsedGroups))
      }, [collapsedGroups])

      useEffect(() => {
        setFilterOpen(false)
        setHiddenGroups({})
        setMenu(null)
        setAddingRef(false)
        setRefPath('')
        setRefTitle('')
        setRefNote('')
        setRefPathInvalid(false)
        setEditingRules(false)
        setRulesDraft((project && project.goal) || '')
        setMemQuery('')
        setMemSearchResult(null)
      }, [project && project.id])

      useEffect(() => {
        if (!editingRules) setRulesDraft((project && project.goal) || '')
      }, [project && project.goal, editingRules])

      useEffect(() => {
        if (searchOpen && searchRef.current && typeof searchRef.current.focus === 'function') {
          searchRef.current.focus()
        }
      }, [searchOpen])

      useEffect(() => {
        if (!filterOpen || typeof window === 'undefined') return undefined
        const onPointerDown = (e) => {
          if (filterWrapRef.current && typeof filterWrapRef.current.contains === 'function' && filterWrapRef.current.contains(e.target)) return
          setFilterOpen(false)
        }
        const onKeyDown = (e) => { if (e.key === 'Escape') setFilterOpen(false) }
        window.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
          window.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, [filterOpen])

      // Debounced backend search for shared memory (`GET /projects-api/projects/:id/memory?q=...`)
      useEffect(() => {
        const trimmed = memQuery.trim()
        const pid = project && project.id
        if (!pid || !trimmed || drawerTab !== 'memory') {
          memSearchSeqRef.current += 1
          setMemSearchResult(null)
          setMemSearching(false)
          return undefined
        }
        const seq = ++memSearchSeqRef.current
        setMemSearching(true)
        const timer = setTimeout(() => {
          void api(`/projects/${pid}/memory?q=${encodeURIComponent(trimmed)}`)
            .then((res) => {
              if (seq !== memSearchSeqRef.current) return
              const list = Array.isArray(res && res.matches)
                ? res.matches
                : Array.isArray(res && res.memory && res.memory.files)
                  ? res.memory.files
                  : []
              setMemSearchResult(list)
            })
            .catch(() => {
              if (seq !== memSearchSeqRef.current) return
              const base = (memory && Array.isArray(memory.files)) ? memory.files : []
              const lower = trimmed.toLowerCase()
              setMemSearchResult(
                base.filter((f) => `${f.name || ''} ${f.description || ''}`.toLowerCase().includes(lower)),
              )
            })
            .finally(() => {
              if (seq === memSearchSeqRef.current) setMemSearching(false)
            })
        }, 160)
        return () => {
          clearTimeout(timer)
          memSearchSeqRef.current += 1
        }
      }, [memQuery, project && project.id, drawerTab, memory])

      const taskList = (project && project.tasks) || []
      const references = (library && Array.isArray(library.references)) ? library.references : []
      const artifacts = (library && Array.isArray(library.artifacts)) ? library.artifacts : []
      const activeTab = drawerTab === 'library' || drawerTab === 'memory' ? drawerTab : 'threads'

      const toggleSearch = () => {
        setSearchOpen((open) => {
          if (open) setQuery('')
          return !open
        })
      }

      const allCollapsed = THREAD_GROUPS.every((g) => collapsedGroups[g.key])
      const anyHidden = THREAD_GROUPS.some((g) => hiddenGroups[g.key])

      const toggleAllGroups = () => {
        const next = {}
        for (const g of THREAD_GROUPS) next[g.key] = !allCollapsed
        setCollapsedGroups(next)
        setFilterOpen(false)
      }

      const needle = query.trim().toLowerCase()
      const visibleTasks = needle
        ? taskList.filter((task) => `${task.title || ''} ${taskSubtitle(task, t)}`.toLowerCase().includes(needle))
        : taskList
      const groups = threadGroups(visibleTasks).filter((g) => g.tasks.length > 0 && !hiddenGroups[g.key])

      const submitReference = async () => {
        const cleanPath = refPath.trim()
        if (!cleanPath) {
          setRefPathInvalid(true)
          return
        }
        setRefPathInvalid(false)
        if (typeof onAddReference !== 'function') return
        const ok = await onAddReference({ path: cleanPath, title: refTitle.trim(), note: refNote.trim() })
        if (ok !== false) {
          setAddingRef(false)
          setRefPath('')
          setRefTitle('')
          setRefNote('')
        }
      }

      const submitRules = async () => {
        if (typeof onSaveInstructions !== 'function') return
        const ok = await onSaveInstructions(rulesDraft)
        if (ok !== false) setEditingRules(false)
      }

      const renderFilterControl = () => {
        const trigger = h(
          UITooltip,
          { label: t('filterThreads'), side: 'bottom', portal: true },
          h(
            'button',
            {
              type: 'button',
              className: `pj-icon-btn${anyHidden ? ' pj-active' : ''}`,
              'aria-label': t('filterThreads'),
              'aria-haspopup': 'menu',
              'aria-expanded': filterOpen ? 'true' : 'false',
              onClick: () => setFilterOpen((o) => !o),
            },
            h(Icon, { name: 'IconSlidersTwoOutlineRegular', size: 14 }),
          ),
        )
        if (typeof Primitives.Menu === 'function') {
          const items = [
            ...THREAD_GROUPS.map((g) => {
              const shown = !hiddenGroups[g.key]
              return {
                id: `grp:${g.key}`,
                label: t(g.titleKey),
                icon: shown ? h(Icon, { name: 'IconCheckOutlineRegular', size: 14 }) : null,
              }
            }),
            { type: 'separator', id: 'sep-fold' },
            { id: 'act:fold', label: allCollapsed ? t('expandAll') : t('collapseAll') },
            ...(anyHidden ? [{ id: 'act:show-all', label: t('showAllGroups') }] : []),
          ]
          return h(Primitives.Menu, {
            open: filterOpen,
            onClose: () => setFilterOpen(false),
            align: 'end',
            portal: true,
            anchor: trigger,
            items,
            onSelect: (id) => {
              if (id.startsWith('grp:')) {
                const key = id.slice(4)
                setHiddenGroups((cur) => ({ ...cur, [key]: !cur[key] }))
              } else if (id === 'act:fold') {
                toggleAllGroups()
              } else if (id === 'act:show-all') {
                setHiddenGroups({})
                setFilterOpen(false)
              }
            },
          })
        }
        return h(
          'div',
          { ref: filterWrapRef, className: 'pj-filter-wrap' },
          trigger,
          filterOpen &&
            h(
              'div',
              { className: 'pj-popover-menu', role: 'menu', 'aria-label': t('filterGroups'), 'data-dsh-motion': 'popover', 'data-state': 'open' },
              THREAD_GROUPS.map((g) => {
                const shown = !hiddenGroups[g.key]
                return h(
                  'button',
                  {
                    key: g.key,
                    type: 'button',
                    role: 'menuitemcheckbox',
                    'aria-checked': shown ? 'true' : 'false',
                    className: 'pj-menu-row',
                    onClick: () => setHiddenGroups((cur) => ({ ...cur, [g.key]: !cur[g.key] })),
                  },
                  h('span', { className: 'pj-menu-check' }, shown ? h(Icon, { name: 'IconCheckOutlineRegular', size: 14 }) : null),
                  h('span', null, t(g.titleKey)),
                )
              }),
              h('div', { className: 'pj-menu-sep', role: 'separator' }),
              h(
                'button',
                { type: 'button', role: 'menuitem', className: 'pj-menu-row', onClick: toggleAllGroups },
                h('span', { className: 'pj-menu-check' }),
                h('span', null, allCollapsed ? t('expandAll') : t('collapseAll')),
              ),
              anyHidden &&
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    className: 'pj-menu-row',
                    onClick: () => { setHiddenGroups({}); setFilterOpen(false) },
                  },
                  h('span', { className: 'pj-menu-check' }),
                  h('span', null, t('showAllGroups')),
                ),
            ),
        )
      }

      const renderThreadsTab = () =>
        h(
          'div',
          { id: 'pj-drawer-panel-threads', role: 'tabpanel', 'aria-labelledby': 'pj-drawer-tab-threads', className: 'pj-detail-body' },
          h(
            'div',
            { className: 'pj-drawer-subbar' },
            h('span', { className: 'pj-drawer-meta' }, `${t('drawerTabThreads')} (${taskList.length})`),
            h(
              'div',
              { className: 'pj-head-actions' },
              h(
                UITooltip,
                { label: t('searchThreads'), side: 'bottom', portal: true },
                h(
                  'button',
                  {
                    type: 'button',
                    className: `pj-icon-btn${searchOpen ? ' pj-active' : ''}`,
                    'aria-label': t('searchThreads'),
                    'aria-expanded': searchOpen ? 'true' : 'false',
                    onClick: toggleSearch,
                  },
                  h(Icon, { name: 'IconSearchOutlineRegular', size: 14 }),
                ),
              ),
              renderFilterControl(),
            ),
          ),
          searchOpen &&
            h(
              'div',
              { className: 'pj-search-bar' },
              h(UIInput, {
                ref: searchRef,
                type: 'search',
                icon: h(Icon, { name: 'IconSearchOutlineRegular', size: 14 }),
                placeholder: t('searchThreads'),
                'aria-label': t('searchThreads'),
                value: query,
                onChange: (e) => setQuery(e.target.value),
              }),
            ),
          h(
            'div',
            { className: 'pj-exec-scroll' },
            taskList.length === 0
              ? h('div', { className: 'pj-empty' }, t('emptyTasks'))
              : groups.length === 0
                ? h(
                    'div',
                    { className: 'pj-empty' },
                    h('span', null, t('noMatches')),
                    anyHidden &&
                      h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', onClick: () => setHiddenGroups({}) }, t('showAllGroups')),
                  )
                : groups.map((group) => {
                    const folded = Boolean(collapsedGroups[group.key])
                    return h(
                      'div',
                      { key: group.key, className: 'pj-group', 'data-thread-group': group.key },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: `pj-group-btn${group.key === 'waiting' ? ' pj-group-waiting' : ''}`,
                          'aria-expanded': folded ? 'false' : 'true',
                          onClick: () => setCollapsedGroups((c) => ({ ...c, [group.key]: !c[group.key] })),
                        },
                        h(Icon, { name: folded ? 'IconChevronRightOutlineRegular' : 'IconChevronDownOutlineRegular', size: 12 }),
                        h(ThreadGlyph, { status: group.icon }),
                        h('span', null, `${t(group.titleKey)} · ${group.tasks.length}`),
                      ),
                      !folded &&
                        group.tasks.map((task) => {
                          const chips = taskChips(task, project, t)
                          const stamp = relativeTime(task, t, activeLocale())
                          const showQuickStop = task.status === 'running'
                          const showQuickApprove = project.autonomy === 'manual' && !task.approved && task.status === 'queued' && !project.archived
                          return h(
                            'div',
                            { key: task.id, className: 'pj-task-card-wrap' },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: `pj-task-card${execTarget && execTarget.taskId === task.id ? ' pj-active' : ''}`,
                                title: `${task.title}\n${taskSubtitle(task, t)}`,
                                onClick: () => onSelectTask(task),
                                onContextMenu: (e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setMenu({ taskId: task.id, x: e.clientX || 0, y: e.clientY || 0, trigger: e.currentTarget })
                                },
                              },
                              h('span', { className: 'pj-task-icon' }, h(ThreadGlyph, { status: task.status })),
                              h('span', { className: 'pj-task-title' }, task.title || ''),
                              stamp && h('span', { className: 'pj-task-time' }, stamp),
                              h('span', { className: 'pj-task-sub' }, taskSubtitle(task, t)),
                              chips.length > 0 &&
                                h(
                                  'span',
                                  { className: 'pj-task-chips' },
                                  chips.map((chip) =>
                                    h(
                                      'span',
                                      {
                                        key: chip.key,
                                        className: `pj-chip${chip.kind === 'branch' ? ' pj-chip-branch' : chip.kind === 'warn' ? ' pj-chip-warn' : ''}`,
                                        title: chip.title || chip.text,
                                      },
                                      chip.kind === 'branch' && h(Icon, { name: 'IconBranchOutlineRegular', size: 12 }),
                                      chip.text,
                                    ),
                                  ),
                                ),
                            ),
                            (showQuickStop || showQuickApprove) &&
                              h(
                                'div',
                                { className: 'pj-task-quick' },
                                showQuickApprove &&
                                  h(
                                    UIButton,
                                    {
                                      variant: 'primary',
                                      size: 'sm',
                                      shape: 'pill',
                                      disabled: busy,
                                      onClick: (e) => { e.stopPropagation(); onApproveTask(task) },
                                    },
                                    t('approve'),
                                  ),
                                showQuickStop &&
                                  h(
                                    UIButton,
                                    {
                                      variant: 'outline',
                                      size: 'sm',
                                      shape: 'pill',
                                      disabled: busy,
                                      onClick: (e) => { e.stopPropagation(); onStopTask(task) },
                                    },
                                    t('stop'),
                                  ),
                              ),
                          )
                        }),
                    )
                  }),
          ),
        )

      const renderLibraryTab = () =>
        h(
          'div',
          { id: 'pj-drawer-panel-library', role: 'tabpanel', 'aria-labelledby': 'pj-drawer-tab-library', className: 'pj-detail-body' },
          h(
            'div',
            { className: 'pj-exec-scroll' },
            h(
              'section',
              { className: 'pj-drawer-section', 'data-library-references': 'true' },
              h(
                'div',
                { className: 'pj-drawer-sec-head' },
                h('h3', { className: 'pj-drawer-sec-title' }, `${t('libraryReferences')} (${references.length})`),
                h(
                  UIButton,
                  {
                    variant: 'ghost',
                    size: 'sm',
                    shape: 'pill',
                    icon: h(Icon, { name: 'IconPlusOutlineRegular', size: 13 }),
                    disabled: busy || project.archived,
                    onClick: () => {
                      setAddingRef((v) => !v)
                      setRefPathInvalid(false)
                    },
                  },
                  t('libraryAddFile'),
                ),
              ),
              addingRef &&
                h(
                  'div',
                  { className: 'pj-inline-form', 'data-library-add-form': 'true' },
                  h(
                    'div',
                    { className: 'pj-field-row' },
                    h(UIInput, {
                      variant: 'form',
                      className: refPathInvalid ? 'pj-input-invalid' : undefined,
                      'aria-invalid': refPathInvalid ? 'true' : undefined,
                      'aria-label': t('libraryPathLabel'),
                      placeholder: t('libraryPathPlaceholder'),
                      value: refPath,
                      onChange: (e) => {
                        if (refPathInvalid && e.target.value.trim()) setRefPathInvalid(false)
                        setRefPath(e.target.value)
                      },
                      onKeyDown: (e) => {
                        if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
                          e.preventDefault()
                          void submitReference()
                        }
                      },
                    }),
                    typeof pickFolder === 'function' &&
                      h(
                        UITooltip,
                        { label: t('libraryPickDir'), side: 'bottom', portal: true },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'pj-icon-btn',
                            'aria-label': t('libraryPickDir'),
                            disabled: busy,
                            onClick: () => {
                              void Promise.resolve(pickFolder())
                                .then((dir) => { if (dir) setRefPath(dir) })
                                .catch(() => {})
                            },
                          },
                          h(Icon, { name: 'IconFolderOpenOutlineRegular', size: 14 }),
                        ),
                      ),
                  ),
                  refPathInvalid && h('span', { className: 'pj-field-err', role: 'alert' }, t('libraryPathRequired')),
                  h(UIInput, {
                    variant: 'form',
                    'aria-label': t('libraryTitleLabel'),
                    placeholder: t('libraryTitlePlaceholder'),
                    value: refTitle,
                    onChange: (e) => setRefTitle(e.target.value),
                  }),
                  h(UIInput, {
                    variant: 'form',
                    'aria-label': t('libraryNoteLabel'),
                    placeholder: t('libraryNotePlaceholder'),
                    value: refNote,
                    onChange: (e) => setRefNote(e.target.value),
                  }),
                  h(
                    'div',
                    { className: 'pj-inline-form-foot' },
                    h(UIButton, { variant: 'ghost', size: 'sm', shape: 'pill', disabled: busy, onClick: () => { setAddingRef(false); setRefPathInvalid(false) } }, t('cancel')),
                    h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy, onClick: () => void submitReference() }, t('libraryAddConfirm')),
                  ),
                ),
              references.length === 0
                ? h('p', { className: 'pj-hint' }, t('libraryEmptyRefs'))
                : h(
                    'div',
                    { className: 'pj-lib-list' },
                    references.map((ref) => {
                      const display = ref.title || shortPath(ref.relativePath || ref.path)
                      const subtitle = ref.note || ref.relativePath || ref.path
                      return h(
                        'div',
                        { key: ref.id || ref.path, className: 'pj-lib-row', 'data-library-ref': ref.id || ref.path },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'pj-lib-main',
                            title: `${t('libraryOpenFile')}: ${ref.path}`,
                            onClick: () => onPreviewFile && onPreviewFile(ref.path),
                          },
                          h('span', { className: 'pj-lib-icon' }, h(Icon, { name: 'IconDeliverDocRegular', size: 14 })),
                          h(
                            'span',
                            { className: 'pj-lib-copy' },
                            h('span', { className: 'pj-lib-name' }, display),
                            subtitle && h('span', { className: 'pj-lib-sub' }, subtitle),
                            ref.exists === false && h(UITag, { tone: 'warning' }, t('libraryMissing')),
                          ),
                        ),
                        h(
                          UITooltip,
                          { label: t('libraryRemoveRef'), side: 'bottom', portal: true },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'pj-icon-btn',
                              'aria-label': `${t('libraryRemoveRef')}: ${display}`,
                              disabled: busy,
                              onClick: () => onRemoveReference && onRemoveReference(ref.id),
                            },
                            h(Icon, { name: 'IconTrashOutlineRegular', size: 14 }),
                          ),
                        ),
                      )
                    }),
                  ),
            ),
            h(
              'section',
              { className: 'pj-drawer-section', 'data-library-artifacts': 'true' },
              h(
                'div',
                { className: 'pj-drawer-sec-head' },
                h('h3', { className: 'pj-drawer-sec-title' }, `${t('libraryArtifacts')} (${artifacts.length})`),
              ),
              artifacts.length === 0
                ? h('p', { className: 'pj-hint' }, t('libraryEmptyArtifacts'))
                : h(
                    'div',
                    { className: 'pj-lib-list' },
                    artifacts.map((art) => {
                      const display = art.title || shortPath(art.relativePath || art.path)
                      const matchedTask = art.taskId ? taskList.find((tk) => tk.id === art.taskId) : null
                      const taskLabel = art.taskTitle || (matchedTask && matchedTask.title) || ''
                      return h(
                        'div',
                        { key: art.id || `${art.taskId}:${art.path}`, className: 'pj-lib-row', 'data-library-artifact': art.id || art.path },
                        h(
                          'div',
                          { className: 'pj-lib-copy' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'pj-lib-main',
                              title: `${t('libraryOpenFile')}: ${art.path}`,
                              onClick: () => onPreviewFile && onPreviewFile(art.path),
                            },
                            h('span', { className: 'pj-lib-icon' }, h(Icon, { name: 'IconDeliverDocRegular', size: 14 })),
                            h(
                              'span',
                              { className: 'pj-lib-copy' },
                              h('span', { className: 'pj-lib-name' }, display),
                              h('span', { className: 'pj-lib-sub' }, art.relativePath || art.path),
                            ),
                          ),
                          taskLabel &&
                            h(
                              'div',
                              { className: 'pj-lib-meta-row' },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'pj-task-link',
                                  title: `${t('libraryJumpTask')}: ${taskLabel}`,
                                  onClick: () => onJumpTaskById && onJumpTaskById(art.taskId),
                                },
                                h(Icon, { name: 'IconLinkOutlineRegular', size: 11 }),
                                h('span', null, taskLabel),
                              ),
                            ),
                        ),
                      )
                    }),
                  ),
            ),
          ),
        )

      const renderMemoryTab = () => {
        const allFiles = (memory && Array.isArray(memory.files)) ? memory.files.filter(Boolean) : []
        const sortedFiles = [...allFiles].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
        const shownFiles = memQuery.trim() ? (memSearchResult || []) : sortedFiles
        const hotCount = typeof (memory && memory.hotCount) === 'number' ? memory.hotCount : allFiles.length
        const pinnedCount = typeof (memory && memory.pinnedCount) === 'number'
          ? memory.pinnedCount
          : allFiles.filter((f) => f && f.pinned).length
        const totalChars = Number(memory && memory.total) || 0
        const budgetChars = Number(memory && memory.budget) || Number(project && project.memoryBudget) || 64000
        const estTokens = typeof (memory && memory.estimatedTokens) === 'number' ? memory.estimatedTokens : null
        const budgetTokens = typeof (memory && memory.budgetTokens) === 'number' ? memory.budgetTokens : null
        const pct = estTokens !== null && budgetTokens
          ? Math.min(100, Math.round((estTokens / Math.max(1, budgetTokens)) * 100))
          : Math.min(100, Math.round((totalChars / Math.max(1, budgetChars)) * 100))
        const overBudget = estTokens !== null && budgetTokens ? estTokens > budgetTokens : totalChars > budgetChars
        const budgetSummary = estTokens !== null && budgetTokens
          ? `~${estTokens} / ${budgetTokens} ${t('memoryTokensUnit')}`
          : `${memorySize(totalChars, t)} / ${memorySize(budgetChars, t)}`

        return h(
          'div',
          { id: 'pj-drawer-panel-memory', role: 'tabpanel', 'aria-labelledby': 'pj-drawer-tab-memory', className: 'pj-detail-body' },
          h(
            'div',
            { className: 'pj-exec-scroll' },
            h(
              'section',
              { className: 'pj-drawer-section', 'data-drawer-instructions': 'true' },
              h(
                'div',
                { className: 'pj-drawer-sec-head' },
                h('h3', { className: 'pj-drawer-sec-title' }, t('rulesSection')),
                editingRules
                  ? h(
                      'div',
                      { className: 'pj-head-actions' },
                      h(UIButton, { variant: 'ghost', size: 'sm', shape: 'pill', disabled: busy, onClick: () => { setEditingRules(false); setRulesDraft((project && project.goal) || '') } }, t('cancel')),
                      h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy, onClick: () => void submitRules() }, t('save')),
                    )
                  : h(
                      UIButton,
                      {
                        variant: 'ghost',
                        size: 'sm',
                        shape: 'pill',
                        icon: h(Icon, { name: 'IconEditOutlineRegular', size: 13 }),
                        disabled: busy || project.archived,
                        onClick: () => { setRulesDraft((project && project.goal) || ''); setEditingRules(true) },
                      },
                      t('memoryEditFile'),
                    ),
              ),
              editingRules
                ? h('textarea', {
                    className: 'pj-textarea',
                    'aria-label': t('rulesSection'),
                    placeholder: t('instructionsPlaceholder'),
                    value: rulesDraft,
                    onChange: (e) => setRulesDraft(e.target.value),
                  })
                : h(
                    'div',
                    { className: `pj-rules-card${project && project.goal ? '' : ' pj-rules-empty'}` },
                    h('p', { className: 'pj-rules-text' }, (project && project.goal) || t('rulesEmpty')),
                  ),
            ),
            h(
              'section',
              { className: 'pj-drawer-section', 'data-drawer-memory': 'true' },
              h(
                'div',
                { className: 'pj-drawer-sec-head' },
                h('h3', { className: 'pj-drawer-sec-title' }, t('memory')),
                h(
                  UIButton,
                  {
                    variant: 'ghost',
                    size: 'sm',
                    shape: 'pill',
                    icon: h(Icon, { name: 'IconPlusOutlineRegular', size: 13 }),
                    disabled: busy || project.archived,
                    onClick: onNewMemoryTopic,
                  },
                  t('memoryNewTopic'),
                ),
              ),
              h(
                'div',
                { className: 'pj-field' },
                h(
                  'div',
                  { className: 'pj-drawer-sec-head' },
                  h('span', { className: 'pj-hint' }, `${hotCount} ${t('memoryFiles')}${pinnedCount > 0 ? ` · ${pinnedCount} ${t('memoryPinned')}` : ''}`),
                  h('span', { className: 'pj-hint' }, budgetSummary),
                ),
                h(
                  'div',
                  { className: 'pj-budget-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
                  h('div', { className: `pj-budget-fill${overBudget ? ' pj-over' : ''}`, style: { transform: `scaleX(${pct / 100})` } }),
                ),
              ),
              h(UIInput, {
                type: 'search',
                icon: h(Icon, { name: 'IconSearchOutlineRegular', size: 14 }),
                placeholder: t('memorySearchPlaceholder'),
                'aria-label': t('memorySearchLabel'),
                value: memQuery,
                onChange: (e) => setMemQuery(e.target.value),
              }),
              memSearching
                ? h('p', { className: 'pj-hint' }, t('memoryLoading'))
                : shownFiles.length === 0
                  ? h('p', { className: 'pj-hint' }, memQuery.trim() ? t('memorySearchEmpty') : t('memoryEmpty'))
                  : h(
                      'div',
                      { className: 'pj-memory-list' },
                      shownFiles.map((file) => {
                        const pinned = Boolean(file.pinned)
                        const sourceTask = file.sourceTaskId ? taskList.find((tk) => tk.id === file.sourceTaskId) : null
                        const metaText = typeof file.estimatedTokens === 'number'
                          ? `${memoryMeta(file, t)} · ~${file.estimatedTokens} ${t('memoryTokensUnit')}`
                          : memoryMeta(file, t)
                        return h(
                          'div',
                          {
                            key: file.name,
                            className: `pj-mem-card${pinned ? ' pj-mem-pinned' : ''}`,
                            'data-memory-topic': file.name,
                            'data-memory-pinned': pinned ? 'true' : 'false',
                          },
                          h(
                            'div',
                            { className: 'pj-mem-card-top' },
                            h(
                              UITooltip,
                              { label: pinned ? t('memoryUnpin') : t('memoryPin'), side: 'bottom', portal: true },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: `pj-icon-btn pj-pin-btn${pinned ? ' pj-pinned' : ''}`,
                                  'aria-label': `${pinned ? t('memoryUnpin') : t('memoryPin')}: ${file.name}`,
                                  'aria-pressed': pinned ? 'true' : 'false',
                                  disabled: busy || project.archived,
                                  onClick: () => onToggleMemoryPin && onToggleMemoryPin(file),
                                },
                                h(Icon, { name: pinned ? 'IconPinFillRegular' : 'IconPinOutlineRegular', size: 13 }),
                              ),
                            ),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'pj-mem-card-trigger',
                                onClick: () => onOpenMemoryPreview && onOpenMemoryPreview(file),
                              },
                              h(
                                'div',
                                { className: 'pj-memory-row-head' },
                                h('span', { className: 'pj-memory-row-name' }, file.name),
                                file.stale && h(UITag, { tone: 'warning' }, t('memoryStale')),
                              ),
                              file.description && h('span', { className: 'pj-memory-row-desc' }, file.description),
                            ),
                          ),
                          h(
                            'div',
                            { className: 'pj-mem-card-foot' },
                            h('span', { className: 'pj-memory-row-meta' }, metaText),
                            file.sourceTaskId &&
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'pj-task-link',
                                  title: `${t('memorySourceTask')}: ${(sourceTask && sourceTask.title) || file.sourceTaskId}`,
                                  onClick: () => onJumpTaskById && onJumpTaskById(file.sourceTaskId),
                                },
                                h(Icon, { name: 'IconLinkOutlineRegular', size: 11 }),
                                h('span', null, (sourceTask && sourceTask.title) || t('memorySourceTask')),
                              ),
                          ),
                        )
                      }),
                    ),
            ),
          ),
        )
      }

      return h(
        'aside',
        {
          className: `pj-exec${overlay ? ' pj-exec-overlay' : ''}`,
          style: { width: `${width}px`, flexBasis: `${width}px` },
          'data-projects-tasks-panel': 'true',
          'data-drawer-tab': activeTab,
          'data-dsh-motion-part': overlay ? 'panel' : undefined,
          'aria-label': t('threadsPanelTitle'),
        },
        !overlay &&
          h('div', {
            className: 'pj-resizer',
            role: 'separator',
            'aria-orientation': 'vertical',
            'aria-label': t('resizeColumns'),
            'aria-valuenow': width,
            'aria-valuemin': EXEC_MIN_WIDTH,
            'aria-valuemax': EXEC_MAX_WIDTH,
            tabIndex: 0,
            onPointerDown: onStartResize,
            onKeyDown: onNudgeWidth,
          }),
        h(
          'div',
          { className: 'pj-exec-head' },
          h(UISegmentedTabs, {
            size: 'sm',
            label: t('drawerTabs'),
            value: activeTab,
            onChange: (next) => onDrawerTabChange && onDrawerTabChange(next),
            items: [
              { value: 'threads', label: t('drawerTabThreads'), id: 'pj-drawer-tab-threads', panelId: 'pj-drawer-panel-threads' },
              { value: 'library', label: t('drawerTabLibrary'), id: 'pj-drawer-tab-library', panelId: 'pj-drawer-panel-library' },
              { value: 'memory', label: t('drawerTabMemory'), id: 'pj-drawer-tab-memory', panelId: 'pj-drawer-panel-memory' },
            ],
          }),
          h(
            UITooltip,
            { label: t('collapseThreads'), side: 'bottom', portal: true },
            h(
              'button',
              {
                type: 'button',
                className: 'pj-icon-btn',
                'aria-label': t('collapseThreads'),
                onClick: onClosePanel,
              },
              h(Icon, { name: 'IconCloseOutline16', size: 14 }),
            ),
          ),
        ),
        activeTab === 'library'
          ? renderLibraryTab()
          : activeTab === 'memory'
            ? renderMemoryTab()
            : renderThreadsTab(),
        h(TaskContextMenu, {
          menu,
          task: menu ? (taskList.find((item) => item.id === menu.taskId) || null) : null,
          busy,
          onClose: () => setMenu(null),
          onResolve: onResolveTask,
          onStop: onStopTask,
          onRetry: onRetryTask,
          onDelete: onDeleteTask,
          t,
        }),
      )
    }

    // =========================================================================
    // Section 8: In-App Modals (New Project, Settings, Memory, Confirm)
    // =========================================================================

    function NewProjectModal({ open, busy, onClose, onCreate, pickFolder, t }) {
      const [form, setForm] = useState({
        name: '',
        goal: '',
        workspace: '',
        autonomy: 'auto',
        concurrency: 3,
        worktreeIsolation: false,
      })
      const [nameInvalid, setNameInvalid] = useState(false)

      useEffect(() => {
        if (open) {
          setForm({ name: '', goal: '', workspace: '', autonomy: 'auto', concurrency: 3, worktreeIsolation: false })
          setNameInvalid(false)
        }
      }, [open])

      const chooseDir = async () => {
        const dir = await pickFolder()
        if (dir) setForm((cur) => ({ ...cur, workspace: dir }))
      }

      const submit = () => {
        const trimmedName = form.name.trim()
        if (!trimmedName) {
          setNameInvalid(true)
          return
        }
        setNameInvalid(false)
        onCreate({
          name: trimmedName,
          goal: form.goal.trim(),
          workspace: form.workspace.trim(),
          autonomy: form.autonomy,
          concurrency: clamp(Number(form.concurrency) || 3, 1, MAX_CONCURRENCY),
          worktreeIsolation: Boolean(form.worktreeIsolation),
        })
      }

      return h(UIModal, {
        open,
        onClose: busy ? () => {} : onClose,
        title: t('newProject'),
        closeLabel: t('close'),
        className: 'pj-modal-glass pj-modal-form',
        contentClassName: 'pj-modal-content',
        footer: h(
          Fragment,
          null,
          h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: onClose }, t('cancel')),
          h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', loading: busy, disabled: busy, onClick: submit }, t('create')),
        ),
        children: h(
          'div',
          { className: 'pj-form-stack' },
          h(
            'label',
            { className: 'pj-field' },
            h(
              'span',
              { className: 'pj-field-head' },
              h('span', { className: 'pj-label' }, t('projectName')),
              nameInvalid && h('span', { className: 'pj-field-err', role: 'alert' }, t('nameRequired')),
            ),
            h(UIInput, {
              variant: 'form',
              className: nameInvalid ? 'pj-input-invalid' : undefined,
              'aria-invalid': nameInvalid ? 'true' : undefined,
              'data-modal-autofocus': '',
              'aria-label': t('projectName'),
              placeholder: t('projectNamePlaceholder'),
              value: form.name,
              onChange: (e) => {
                if (nameInvalid && e.target.value.trim()) setNameInvalid(false)
                setForm((cur) => ({ ...cur, name: e.target.value }))
              },
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
                  e.preventDefault()
                  submit()
                }
              },
            }),
          ),
          h(
            'label',
            { className: 'pj-field' },
            h('span', { className: 'pj-label' }, t('instructions')),
            h('textarea', {
              className: 'pj-textarea',
              'aria-label': t('instructions'),
              placeholder: t('instructionsPlaceholder'),
              value: form.goal,
              onChange: (e) => setForm((cur) => ({ ...cur, goal: e.target.value })),
            }),
          ),
          h(
            'div',
            { className: 'pj-field' },
            h('span', { className: 'pj-label' }, t('workspace')),
            h(
              'div',
              { className: 'pj-field-row' },
              h(
                'div',
                { className: `pj-path-box${form.workspace ? '' : ' pj-empty-path'}`, title: form.workspace || t('noWorkspace') },
                h('span', { className: 'pj-path-text' }, form.workspace || t('noWorkspace')),
              ),
              h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: () => void chooseDir() }, t('chooseFolder')),
              form.workspace &&
                h(UIButton, { variant: 'ghost', size: 'sm', shape: 'pill', disabled: busy, onClick: () => setForm((c) => ({ ...c, workspace: '' })) }, t('clear')),
            ),
          ),
          h(
            'div',
            { className: 'pj-field-grid' },
            h(
              'div',
              { className: 'pj-field' },
              h('span', { className: 'pj-label' }, t('autonomy')),
              h(SafeSegmentedControl, {
                id: 'pj-new-autonomy',
                label: t('autonomy'),
                value: form.autonomy,
                disabled: busy,
                onChange: (v) => setForm((cur) => ({ ...cur, autonomy: v })),
                options: [
                  { value: 'auto', label: t('autonomyAuto') },
                  { value: 'manual', label: t('autonomyManualOption') },
                ],
              }),
              h('p', { className: 'pj-hint' }, form.autonomy === 'auto' ? t('autonomyAutoHint') : t('autonomyManualHint')),
            ),
            h(
              'label',
              { className: 'pj-field' },
              h('span', { className: 'pj-label' }, t('concurrency')),
              h(UIInput, {
                variant: 'form',
                type: 'number',
                min: 1,
                max: MAX_CONCURRENCY,
                'aria-label': t('concurrency'),
                value: form.concurrency,
                onChange: (e) => setForm((cur) => ({ ...cur, concurrency: e.target.value })),
              }),
            ),
          ),
          h(
            'div',
            { className: 'pj-switch-row' },
            h(
              'div',
              { className: 'pj-switch-copy' },
              h('span', { className: 'pj-label' }, t('worktreeIsolation')),
              h('span', { className: 'pj-hint' }, t('worktreeIsolationHint')),
            ),
            h(SafeSwitch, {
              checked: form.worktreeIsolation,
              disabled: busy,
              label: t('worktreeIsolation'),
              onChange: (next) => setForm((cur) => ({ ...cur, worktreeIsolation: next })),
            }),
          ),
        ),
      })
    }

    function ProjectSettingsModal({
      open,
      project,
      memory,
      catalog,
      nameText,
      goalText,
      settingsDirty,
      busy,
      onNameChange,
      onGoalChange,
      onSaveBasics,
      onPatchProject,
      onChooseWorkspace,
      onClearWorkspace,
      onArchiveToggle,
      onRequestDeleteProject,
      onOpenMemoryPreview,
      onNewMemoryTopic,
      onClose,
      t,
    }) {
      const [group, setGroup] = useState('general')
      const [archiveArmed, setArchiveArmed] = useState(false)

      useEffect(() => {
        if (open) {
          setGroup('general')
          setArchiveArmed(false)
        }
      }, [open, project && project.id])

      if (!project) return null

      const memoryFiles = (memory && Array.isArray(memory.files)) ? memory.files.filter(Boolean) : []
      const indexFile = (memory && memory.indexFile && typeof memory.indexFile === 'object') ? memory.indexFile : null
      const totalChars = Number(memory && memory.total) || 0
      const budget = Number(memory && memory.budget) || Number(project.memoryBudget) || 64000
      const pct = Math.min(100, Math.round((totalChars / Math.max(1, budget)) * 100))

      const handleClose = () => {
        setArchiveArmed(false)
        onClose()
      }

      const handleArchiveClick = () => {
        if (project.archived) {
          setArchiveArmed(false)
          onArchiveToggle(false)
          return
        }
        if (!archiveArmed) {
          setArchiveArmed(true)
          return
        }
        setArchiveArmed(false)
        onArchiveToggle(true)
      }

      const modelOptions = [
        { id: '', label: t('modelDefault') },
        ...(catalog.models || []).map((m) => ({ id: m.id, label: m.label || m.id })),
        ...(project.model && !(catalog.models || []).some((m) => m.id === project.model)
          ? [{ id: project.model, label: project.model }]
          : []),
      ]

      const effortList = effortsFor(catalog, project.model)
      const effortOptions = [
        { id: '', label: t('effortDefault') },
        ...effortList.map((ef) => ({ id: ef.id, label: ef.name || effortLabel(catalog, project.model, ef.id, t) })),
        ...(project.reasoningEffort && !effortList.some((ef) => ef.id === project.reasoningEffort)
          ? [{ id: project.reasoningEffort, label: project.reasoningEffort }]
          : []),
      ]

      const presetList = Array.isArray(catalog.presets) ? catalog.presets : []
      const presetOptions = [
        { id: '', label: t('agentPresetDefault') },
        ...presetList.map((p) => {
          const id = typeof p === 'string' ? p : String(p.id || p.name || '')
          const label = typeof p === 'string' ? p : String(p.label || p.title || p.name || id)
          return { id, label }
        }).filter((p) => p.id),
        ...(project.agentPreset && !presetList.some((p) => (typeof p === 'string' ? p : (p.id || p.name)) === project.agentPreset)
          ? [{ id: project.agentPreset, label: project.agentPreset }]
          : []),
      ]

      const renderGeneral = () =>
        h(
          Fragment,
          null,
          h(
            'div',
            { className: 'pj-section' },
            h(
              'div',
              { className: 'pj-section-head' },
              h('h3', { className: 'pj-section-title' }, t('project')),
              h(
                'div',
                { className: 'pj-head-actions' },
                settingsDirty && h(UITag, { tone: 'warning' }, t('unsavedTag')),
                h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy || !settingsDirty || !nameText.trim(), onClick: onSaveBasics }, t('save')),
              ),
            ),
            h(
              'label',
              { className: 'pj-field' },
              h('span', { className: 'pj-label' }, t('projectName')),
              h(UIInput, {
                variant: 'form',
                value: nameText,
                'aria-label': t('projectName'),
                disabled: busy,
                onChange: (e) => onNameChange(e.target.value),
              }),
            ),
            h(
              'label',
              { className: 'pj-field' },
              h('span', { className: 'pj-label' }, t('instructions')),
              h('p', { className: 'pj-hint' }, t('instructionsHint')),
              h('textarea', {
                className: 'pj-textarea',
                'aria-label': t('instructions'),
                placeholder: t('instructionsPlaceholder'),
                value: goalText,
                onChange: (e) => onGoalChange(e.target.value),
              }),
            ),
          ),
          h(
            'div',
            { className: 'pj-section' },
            h('div', { className: 'pj-section-head' }, h('h3', { className: 'pj-section-title' }, t('workspace'))),
            h(
              'div',
              { className: 'pj-field-row' },
              h(
                'div',
                { className: `pj-path-box${project.workspace ? '' : ' pj-empty-path'}`, title: project.workspace || t('noWorkspace') },
                h('span', { className: 'pj-path-text' }, project.workspace || t('noWorkspace')),
              ),
              h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: onChooseWorkspace }, t('chooseFolder')),
              project.workspace &&
                h(UIButton, { variant: 'ghost', size: 'sm', shape: 'pill', disabled: busy, onClick: onClearWorkspace }, t('clear')),
            ),
          ),
          h(
            'div',
            { className: 'pj-section' },
            h('div', { className: 'pj-section-head' }, h('h3', { className: 'pj-section-title' }, t('threadsSettings'))),
            h('p', { className: 'pj-hint' }, t('threadsHint')),
            h(
              'div',
              { className: 'pj-field-grid' },
              h(
                'div',
                { className: 'pj-field' },
                h('span', { className: 'pj-label' }, t('autonomy')),
                h(SafeSegmentedControl, {
                  id: 'pj-set-autonomy',
                  label: t('autonomy'),
                  value: project.autonomy === 'auto' ? 'auto' : 'manual',
                  disabled: busy || project.archived,
                  onChange: (val) => onPatchProject({ autonomy: val }),
                  options: [
                    { value: 'auto', label: t('autonomyAuto') },
                    { value: 'manual', label: t('autonomyManualOption') },
                  ],
                }),
              ),
              h(
                'label',
                { className: 'pj-field' },
                h('span', { className: 'pj-label' }, t('concurrency')),
                h(UIInput, {
                  variant: 'form',
                  type: 'number',
                  min: 1,
                  max: MAX_CONCURRENCY,
                  key: `${project.id}:c:${project.concurrency}`,
                  defaultValue: project.concurrency,
                  'aria-label': t('concurrency'),
                  disabled: busy,
                  onBlur: (e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n !== project.concurrency) onPatchProject({ concurrency: clamp(n, 1, MAX_CONCURRENCY) })
                  },
                }),
              ),
            ),
            h(
              'div',
              { className: 'pj-switch-row' },
              h(
                'div',
                { className: 'pj-switch-copy' },
                h('span', { className: 'pj-label' }, t('pauseProject')),
                h('span', { className: 'pj-hint' }, t('pausedHint')),
              ),
              h(SafeSwitch, {
                checked: Boolean(project.paused),
                disabled: busy || project.archived,
                label: t('pauseProject'),
                onChange: (next) => onPatchProject({ paused: next }),
              }),
            ),
            h(
              'div',
              { className: 'pj-field-grid' },
              h(
                'div',
                { className: 'pj-field' },
                h('span', { className: 'pj-label' }, t('model')),
                catalog.enumerable
                  ? h(SafeSelect, {
                      'aria-label': t('model'),
                      value: project.model || '',
                      options: modelOptions,
                      disabled: busy,
                      placeholder: t('modelDefault'),
                      onChange: (val) => onPatchProject({ model: val }),
                    })
                  : h(UIInput, {
                      variant: 'form',
                      key: `${project.id}:m:${project.model || ''}`,
                      defaultValue: project.model || '',
                      placeholder: t('modelRoutePlaceholder'),
                      'aria-label': t('model'),
                      disabled: busy,
                      onBlur: (e) => {
                        const v = e.target.value.trim()
                        if (v !== (project.model || '')) onPatchProject({ model: v })
                      },
                    }),
                !catalog.enumerable && h('span', { className: 'pj-hint' }, t('modelFreeTextHint')),
              ),
              h(
                'div',
                { className: 'pj-field' },
                h('span', { className: 'pj-label' }, t('reasoningEffort')),
                catalog.enumerable
                  ? h(SafeSelect, {
                      'aria-label': t('reasoningEffort'),
                      value: project.reasoningEffort || '',
                      options: effortOptions,
                      disabled: busy,
                      placeholder: t('effortDefault'),
                      onChange: (val) => onPatchProject({ reasoningEffort: val }),
                    })
                  : h(UIInput, {
                      variant: 'form',
                      key: `${project.id}:e:${project.reasoningEffort || ''}`,
                      defaultValue: project.reasoningEffort || '',
                      placeholder: t('effortDefault'),
                      'aria-label': t('reasoningEffort'),
                      disabled: busy,
                      onBlur: (e) => {
                        const v = e.target.value.trim()
                        if (v !== (project.reasoningEffort || '')) onPatchProject({ reasoningEffort: v })
                      },
                    }),
                !catalog.enumerable && h('span', { className: 'pj-hint' }, t('effortFreeTextHint')),
              ),
            ),
            h(
              'div',
              { className: 'pj-field' },
              h('span', { className: 'pj-label' }, t('agentPreset')),
              catalog.presetsEnumerable && presetOptions.length > 1
                ? h(SafeSelect, {
                    'aria-label': t('agentPreset'),
                    value: project.agentPreset || '',
                    options: presetOptions,
                    disabled: busy,
                    placeholder: t('agentPresetDefault'),
                    onChange: (val) => onPatchProject({ agentPreset: val }),
                  })
                : h(UIInput, {
                    variant: 'form',
                    key: `${project.id}:p:${project.agentPreset || ''}`,
                    defaultValue: project.agentPreset || '',
                    placeholder: t('agentPresetPlaceholder'),
                    'aria-label': t('agentPreset'),
                    disabled: busy,
                    onBlur: (e) => {
                      const v = e.target.value.trim()
                      if (v !== (project.agentPreset || '')) onPatchProject({ agentPreset: v })
                    },
                  }),
              !(catalog.presetsEnumerable && presetOptions.length > 1) && h('span', { className: 'pj-hint' }, t('agentPresetFreeTextHint')),
            ),
            h(
              'div',
              { className: 'pj-switch-row' },
              h(
                'div',
                { className: 'pj-switch-copy' },
                h('span', { className: 'pj-label' }, t('worktreeIsolation')),
                h('span', { className: 'pj-hint' }, t('worktreeIsolationHint')),
              ),
              h(SafeSwitch, {
                checked: Boolean(project.worktreeIsolation),
                disabled: busy,
                label: t('worktreeIsolation'),
                onChange: (next) => onPatchProject({ worktreeIsolation: next }),
              }),
            ),
          ),
          h(
            'div',
            { className: 'pj-danger-zone' },
            h('h3', { className: 'pj-danger-title' }, t('archiveSection')),
            h('p', { className: 'pj-hint' }, t('archiveWarning')),
            h(
              'div',
              { className: 'pj-danger-row' },
              h(
                'div',
                { className: 'pj-head-actions' },
                project.archived
                  ? h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: handleArchiveClick }, t('unarchive'))
                  : archiveArmed
                    ? h(
                        Fragment,
                        null,
                        h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy, onClick: handleArchiveClick }, t('archiveConfirm')),
                        h(UIButton, { variant: 'ghost', size: 'sm', shape: 'pill', disabled: busy, onClick: () => setArchiveArmed(false) }, t('cancel')),
                      )
                    : h(
                        UIButton,
                        { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: handleArchiveClick },
                        t('archive'),
                      ),
              ),
              h(
                UIButton,
                {
                  variant: 'outline',
                  size: 'sm',
                  shape: 'pill',
                  className: 'pj-danger-btn',
                  icon: h(Icon, { name: 'IconTrashOutlineRegular', size: 14 }),
                  disabled: busy,
                  onClick: () => onRequestDeleteProject(project),
                },
                t('deleteProject'),
              ),
            ),
          ),
        )

      const renderMemory = () => {
        const rows = indexFile
          ? [{ ...indexFile, name: indexFile.name || 'MEMORY.md', description: t('memoryIndexDesc'), isIndex: true, readOnly: true }, ...memoryFiles]
          : memoryFiles
        return h(
          'div',
          { className: 'pj-section' },
          h(
            'div',
            { className: 'pj-section-head' },
            h('h3', { className: 'pj-section-title' }, t('memory')),
            h(
              UIButton,
              {
                variant: 'primary',
                size: 'sm',
                shape: 'pill',
                icon: h(Icon, { name: 'IconPlusOutlineRegular', size: 14 }),
                disabled: busy,
                onClick: onNewMemoryTopic,
              },
              t('memoryNewTopic'),
            ),
          ),
          h('p', { className: 'pj-hint' }, t('memoryHint')),
          h(
            'div',
            { className: 'pj-field' },
            h(
              'div',
              { className: 'pj-section-head' },
              h('span', { className: 'pj-hint' }, `${memoryFiles.length} ${t('memoryFiles')} · ${memorySize(totalChars, t)}`),
              h('span', { className: 'pj-hint' }, `${t('memoryBudget')}: ${memorySize(budget, t)} (${pct}%)`),
            ),
            h(
              'div',
              { className: 'pj-budget-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
              h('div', { className: `pj-budget-fill${totalChars > budget ? ' pj-over' : ''}`, style: { transform: `scaleX(${pct / 100})` } }),
            ),
          ),
          h(
            'div',
            { className: 'pj-switch-row' },
            h(
              'div',
              { className: 'pj-switch-copy' },
              h('span', { className: 'pj-label' }, t('memoryAutoCompact')),
              h('span', { className: 'pj-hint' }, t('memoryAutoCompactHint')),
            ),
            h(SafeSwitch, {
              checked: project.autoCompact !== false,
              disabled: busy,
              label: t('memoryAutoCompact'),
              onChange: (next) => onPatchProject({ autoCompact: next }),
            }),
          ),
          rows.length === 0
            ? h('div', { className: 'pj-empty' }, t('memoryEmpty'))
            : h(
                'div',
                { className: 'pj-memory-list' },
                rows.map((file) => {
                  const isIdx = Boolean(file.isIndex || file.readOnly)
                  return h(
                    'button',
                    {
                      key: file.name,
                      type: 'button',
                      className: 'pj-memory-row',
                      onClick: () => onOpenMemoryPreview(file),
                    },
                    h(
                      'div',
                      { className: 'pj-memory-row-head' },
                      h('span', { className: 'pj-memory-row-name' }, file.name),
                      isIdx && h(UITag, { tone: 'neutral' }, t('memoryIndex')),
                      isIdx && h(UITag, { tone: 'quiet' }, t('memoryReadOnly')),
                      file.stale && h(UITag, { tone: 'warning' }, t('memoryStale')),
                    ),
                    file.description && h('span', { className: 'pj-memory-row-desc' }, file.description),
                    h('span', { className: 'pj-memory-row-meta' }, memoryMeta(file, t)),
                  )
                }),
              ),
        )
      }

      return h(UIModal, {
        open,
        headless: true,
        onClose: handleClose,
        title: t('settings'),
        className: 'pj-settings-modal',
        children: h(
          'div',
          { className: 'pj-settings-grid' },
          h('h2', { className: 'pj-settings-title' }, t('settings')),
          h(
            'div',
            { className: 'pj-settings-head' },
            h(
              'button',
              { type: 'button', className: 'pj-icon-btn', 'aria-label': t('close'), onClick: handleClose },
              h(Icon, { name: 'IconCloseOutline16', size: 14 }),
            ),
          ),
          h(
            'nav',
            { className: 'pj-settings-nav', 'aria-label': t('settingsNav') },
            h(
              'button',
              {
                type: 'button',
                className: `pj-settings-nav-btn${group === 'general' ? ' pj-active' : ''}`,
                'aria-current': group === 'general' ? 'true' : undefined,
                onClick: () => { setArchiveArmed(false); setGroup('general') },
              },
              h(Icon, { name: 'IconSettingsOutlineRegular', size: 16 }),
              h('span', null, t('general')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: `pj-settings-nav-btn${group === 'memory' ? ' pj-active' : ''}`,
                'aria-current': group === 'memory' ? 'true' : undefined,
                onClick: () => { setArchiveArmed(false); setGroup('memory') },
              },
              h(Icon, { name: 'IconDataOutlineRegular', size: 16 }),
              h('span', null, t('memory')),
            ),
          ),
          h('div', { className: 'pj-settings-body' }, group === 'memory' ? renderMemory() : renderGeneral()),
        ),
      })
    }

    function MemoryPreviewModal({ file, busy, onClose, onEdit, onDelete, t }) {
      const [armed, setArmed] = useState(false)
      useEffect(() => { setArmed(false) }, [file && file.name])
      if (!file) return null
      const isIdx = Boolean(file.isIndex || file.readOnly)
      const isArchived = file.archived === true
      const footer = isIdx
        ? null
        : armed
          ? h(
              Fragment,
              null,
              h(UIButton, { variant: 'ghost', size: 'sm', shape: 'pill', disabled: busy, onClick: () => setArmed(false) }, t('cancel')),
              h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy, onClick: () => onDelete(file) }, t('memoryDeleteConfirm')),
            )
          : h(
              Fragment,
              null,
              h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', className: 'pj-danger-btn', disabled: busy || isArchived || file.loading, onClick: () => setArmed(true) }, t('memoryDeleteFile')),
              h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy || isArchived || file.loading, onClick: () => onEdit(file) }, t('memoryEditFile')),
            )

      return h(UIModal, {
        open: Boolean(file),
        onClose,
        title: file.name,
        closeLabel: t('close'),
        className: 'pj-modal-glass pj-modal-wide',
        contentClassName: 'pj-modal-content',
        footer,
        children: h(
          'div',
          { className: 'pj-form-stack' },
          h(
            'div',
            { className: 'pj-detail-meta-bar' },
            h('span', null, memoryMeta(file, t)),
            isIdx && h(UITag, { tone: 'neutral' }, t('memoryReadOnly')),
            file.stale && h(UITag, { tone: 'warning' }, t('memoryStale')),
            isArchived && h(UITag, { tone: 'neutral' }, t('memoryArchived')),
          ),
          file.description && h('p', { className: 'pj-hint' }, file.description),
          isIdx && h('p', { className: 'pj-hint' }, t('memoryIndexHint')),
          isArchived && h('p', { className: 'pj-hint' }, t('memoryArchivedHint')),
          file.loading
            ? h('div', { className: 'pj-empty' }, t('memoryLoading'))
            : file.error
              ? h('div', { className: 'pj-empty' }, file.error)
              : h('pre', { className: 'pj-memory-body-pre' }, file.text || ''),
        ),
      })
    }

    function MemoryEditorModal({ editor, busy, onClose, onSave, t }) {
      const [name, setName] = useState('')
      const [description, setDescription] = useState('')
      const [text, setText] = useState('')
      const [nameInvalid, setNameInvalid] = useState(false)
      const [textInvalid, setTextInvalid] = useState(false)

      useEffect(() => {
        if (!editor) return
        setName(editor.name || '')
        setDescription(editor.description || '')
        setText(editor.text || '')
        setNameInvalid(false)
        setTextInvalid(false)
      }, [editor && editor.name, editor && editor.isNew, editor && editor.loading])

      if (!editor) return null
      const isNew = Boolean(editor.isNew)

      const submit = () => {
        const cleanName = name.trim()
        const cleanText = text.trim()
        if (!cleanName) setNameInvalid(true)
        if (!cleanText) setTextInvalid(true)
        if (!cleanName || !cleanText) return
        onSave({ name: cleanName, description: description.trim(), type: editor.type || 'reference', text })
      }

      return h(UIModal, {
        open: Boolean(editor),
        onClose: busy ? () => {} : onClose,
        title: isNew ? t('memoryNewTopic') : editor.name,
        closeLabel: t('close'),
        className: 'pj-modal-glass pj-modal-wide',
        contentClassName: 'pj-modal-content',
        footer: h(
          Fragment,
          null,
          h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: onClose }, t('cancel')),
          h(
            UIButton,
            {
              variant: 'primary',
              size: 'sm',
              shape: 'pill',
              loading: busy,
              disabled: busy || editor.loading,
              onClick: submit,
            },
            t('save'),
          ),
        ),
        children: h(
          'div',
          { className: 'pj-form-stack' },
          isNew &&
            h(
              'label',
              { className: 'pj-field' },
              h(
                'span',
                { className: 'pj-field-head' },
                h('span', { className: 'pj-label' }, t('memoryTopicName')),
                nameInvalid && h('span', { className: 'pj-field-err', role: 'alert' }, t('memoryNameRequired')),
              ),
              h(UIInput, {
                variant: 'form',
                className: nameInvalid ? 'pj-input-invalid' : undefined,
                'aria-invalid': nameInvalid ? 'true' : undefined,
                'data-modal-autofocus': '',
                'aria-label': t('memoryTopicName'),
                placeholder: t('memoryTopicNamePlaceholder'),
                value: name,
                onChange: (e) => {
                  if (nameInvalid && e.target.value.trim()) setNameInvalid(false)
                  setName(e.target.value)
                },
              }),
            ),
          h(
            'label',
            { className: 'pj-field' },
            h('span', { className: 'pj-label' }, t('memoryTopicDesc')),
            h(UIInput, {
              variant: 'form',
              'aria-label': t('memoryTopicDesc'),
              placeholder: t('memoryTopicDescPlaceholder'),
              value: description,
              onChange: (e) => setDescription(e.target.value),
            }),
          ),
          h(
            'label',
            { className: 'pj-field' },
            h(
              'span',
              { className: 'pj-field-head' },
              h('span', { className: 'pj-label' }, t('memoryBody')),
              textInvalid && h('span', { className: 'pj-field-err', role: 'alert' }, t('memoryTextRequired')),
            ),
            h('textarea', {
              className: `pj-textarea pj-textarea-tall${textInvalid ? ' pj-input-invalid' : ''}`,
              'aria-invalid': textInvalid ? 'true' : undefined,
              'data-modal-autofocus': isNew ? undefined : '',
              'aria-label': t('memoryBody'),
              placeholder: t('memoryPlaceholder'),
              disabled: busy || editor.loading,
              value: editor.loading ? '' : text,
              onChange: (e) => {
                if (textInvalid && e.target.value.trim()) setTextInvalid(false)
                setText(e.target.value)
              },
            }),
          ),
        ),
      })
    }

    function DeleteProjectModal({ target, busy, onClose, onConfirm, t }) {
      const [archiveSessions, setArchiveSessions] = useState(true)

      useEffect(() => {
        if (target) setArchiveSessions(true)
      }, [target && target.id])

      if (!target) return null
      return h(UIModal, {
        open: Boolean(target),
        onClose: busy ? () => {} : onClose,
        title: `${t('deleteProjectTitle')}（${target.name}）`,
        description: t('deleteProjectDesc'),
        tone: 'warning',
        closeLabel: t('close'),
        className: 'pj-modal-glass pj-modal-form',
        contentClassName: 'pj-modal-content',
        footer: h(
          Fragment,
          null,
          h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: onClose }, t('cancel')),
          h(
            UIButton,
            {
              variant: 'primary',
              size: 'sm',
              shape: 'pill',
              loading: busy,
              disabled: busy,
              onClick: () => onConfirm(target, { archiveSessions }),
            },
            t('deleteProjectConfirm'),
          ),
        ),
        children: h(
          'div',
          { className: 'pj-switch-row' },
          h(
            'div',
            { className: 'pj-switch-copy' },
            h('span', { className: 'pj-label' }, t('deleteProjectArchiveSessions')),
          ),
          h(SafeSwitch, {
            checked: archiveSessions,
            disabled: busy,
            label: t('deleteProjectArchiveSessions'),
            onChange: setArchiveSessions,
          }),
        ),
      })
    }

    function ConfirmModal({ state, busy, onClose, t }) {
      if (!state) return null
      return h(UIModal, {
        open: Boolean(state),
        onClose: busy ? () => {} : onClose,
        title: state.title,
        description: state.description,
        tone: state.tone,
        closeLabel: t('close'),
        className: 'pj-modal-glass',
        contentClassName: 'pj-modal-content',
        footer: h(
          Fragment,
          null,
          h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: onClose }, state.cancelLabel || t('cancel')),
          h(
            UIButton,
            {
              variant: 'primary',
              size: 'sm',
              shape: 'pill',
              loading: busy,
              disabled: busy,
              onClick: () => state.onConfirm(),
            },
            state.confirmLabel || t('confirm'),
          ),
        ),
      })
    }

    // =========================================================================
    // Section 9: Main Page Orchestrator & Plugin Entry
    // =========================================================================

    function OverlayDrawerHost({ open, children }) {
      const presence = useSafePresence(open)
      if (!presence.mounted) return null
      return h(
        'div',
        {
          className: 'pj-overlay-host',
          'data-dsh-motion': 'overlay',
          'data-state': presence.state,
          'aria-hidden': open ? undefined : 'true',
        },
        children,
      )
    }

    function ProjectsPage({
      translate,
      getLocale,
      localeStore,
      pickFolder,
      previewFile,
      threadApi,
      renderSlot,
      SessionProvider,
      useWorkspaces,
    }) {
      useStoreValue(localeStore)
      const t = translate

      const pageRef = useRef(null)
      const settingsBtnRef = useRef(null)
      const [containerWidth, setContainerWidth] = useState(0)

      const [projects, setProjects] = useState([])
      const [viewMode, setViewMode] = useState('overview')
      const [selectedId, setSelectedId] = useState(null)
      const [detail, setDetail] = useState(null)
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState(null)
      const toastSeqRef = useRef(0)

      const [nameText, setNameText] = useState('')
      const [goalText, setGoalText] = useState('')
      const [settingsDirty, setSettingsDirty] = useState(false)
      const settingsDirtyRef = useRef(false)

      const [showNewProject, setShowNewProject] = useState(false)
      const [showSettings, setShowSettings] = useState(false)
      const [deleteTarget, setDeleteTarget] = useState(null)
      const [memoryPreview, setMemoryPreview] = useState(null)
      const [memoryEditor, setMemoryEditor] = useState(null)
      const [confirmState, setConfirmState] = useState(null)

      const [thread, setThread] = useState(null)
      const [ensuringCoord, setEnsuringCoord] = useState(false)
      const [coordError, setCoordError] = useState('')
      const [coordRetryToken, setCoordRetryToken] = useState(0)
      const [execTarget, setExecTarget] = useState(null)
      const [diffRefreshToken, setDiffRefreshToken] = useState(0)
      const [catalog, setCatalog] = useState({ models: [], enumerable: false, presets: [], presetsEnumerable: false })

      const [execPref, setExecPref] = useState(() => {
        const stored = readStored('execPanelPref', 'auto')
        return stored === 'open' || stored === 'closed' ? stored : 'auto'
      })
      const [drawerTab, setDrawerTab] = useState('threads')
      const [execWidth, setExecWidth] = useState(() => readStoredNumber('execWidth', EXEC_DEFAULT_WIDTH))
      const [resizing, setResizing] = useState(false)

      const selectedRef = useRef(null)
      const viewModeRef = useRef('overview')
      const listReqSeq = useRef(0)
      const detailReqSeq = useRef(0)
      const pendingOpenRef = useRef(null)
      const prevTaskStatusRef = useRef(new Map())
      const notifiedEventsRef = useRef(new Set())
      const mountedRef = useRef(true)

      useEffect(() => {
        mountedRef.current = true
        return () => {
          mountedRef.current = false
          listReqSeq.current += 1
          detailReqSeq.current += 1
        }
      }, [])

      const showToast = useCallback((text, options = {}) => {
        if (!text || !mountedRef.current) return
        toastSeqRef.current += 1
        setToast({
          seq: toastSeqRef.current,
          text,
          tone: options.tone,
          holdMs: typeof options.holdMs === 'number' ? options.holdMs : TOAST_HOLD_MS,
        })
      }, [])

      useEffect(() => { selectedRef.current = selectedId }, [selectedId])
      useEffect(() => { viewModeRef.current = viewMode }, [viewMode])
      useEffect(() => { writeStored('execPanelPref', execPref) }, [execPref])

      useEffect(() => {
        const node = pageRef.current
        if (!node) return undefined
        const update = (w) => {
          const measured = Math.round(Number(w) || 0)
          if (measured > 0) setContainerWidth(measured)
        }
        if (typeof node.getBoundingClientRect === 'function') {
          update(node.getBoundingClientRect().width)
        }
        const RO = typeof ResizeObserver !== 'undefined'
          ? ResizeObserver
          : (typeof window !== 'undefined' ? window.ResizeObserver : undefined)
        if (typeof RO !== 'function') return undefined
        const observer = new RO((entries) => {
          const entry = entries && entries[0]
          if (entry && entry.contentRect) update(entry.contentRect.width)
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [])

      useEffect(() => () => { try { thread?.reference?.release?.() } catch {} }, [thread])
      useEffect(() => () => { try { execTarget?.reference?.release?.() } catch {} }, [execTarget])

      const loadProjects = useCallback(async () => {
        const seq = ++listReqSeq.current
        const data = await api('/projects')
        if (!mountedRef.current || seq !== listReqSeq.current) return null
        const list = Array.isArray(data.projects) ? data.projects : []
        setProjects(list)
        return list
      }, [])

      const loadDetail = useCallback(async (id) => {
        if (!id) return null
        const seq = ++detailReqSeq.current
        const data = await api(`/projects/${id}`)
        if (!mountedRef.current || seq !== detailReqSeq.current) return null
        if (selectedRef.current && selectedRef.current !== id) return null
        setDetail(data)
        return data
      }, [])

      const refresh = useCallback(async (preferredId, options = {}) => {
        const list = await loadProjects()
        if (!list) return
        if (list.length === 0) {
          selectedRef.current = null
          setSelectedId(null)
          setDetail(null)
          setViewMode('overview')
          return
        }
        const target = preferredId
          || (selectedRef.current && list.some((p) => p.id === selectedRef.current) ? selectedRef.current : null)
          || (list.find((p) => !p.archived) || list[0])?.id
          || null
        if (target) {
          selectedRef.current = target
          setSelectedId(target)
          if (options.enterWorkspace || preferredId || viewModeRef.current === 'overview') {
            if (!options.stayOverview) setViewMode('workspace')
          }
          await loadDetail(target)
        }
      }, [loadDetail, loadProjects])

      useEffect(() => {
        let stopped = false
        let flushTimer = null
        let pendingProjectIds = new Set()
        let pendingAll = false

        void refresh().catch((err) => {
          if (!stopped) showToast(`${t('errorPrefix')}${messageOf(err)}`, { tone: 'error' })
        })

        const scheduleRefresh = (evt) => {
          if (stopped) return
          if (evt && evt.projectId) pendingProjectIds.add(evt.projectId)
          else pendingAll = true
          if (flushTimer !== null) return
          flushTimer = setTimeout(() => {
            flushTimer = null
            const hintedIds = pendingProjectIds
            const refreshAll = pendingAll
            pendingProjectIds = new Set()
            pendingAll = false
            void loadProjects().then((list) => {
              if (stopped || !list) return
              if (list.length === 0) {
                selectedRef.current = null
                setSelectedId(null)
                setDetail(null)
                setViewMode('overview')
                return
              }
              const stillExists = selectedRef.current && list.some((p) => p.id === selectedRef.current)
              if (!stillExists) {
                const fallback = (list.find((p) => !p.archived) || list[0])?.id || null
                selectedRef.current = fallback
                setSelectedId(fallback)
                if (fallback) void loadDetail(fallback).catch(() => {})
                else setDetail(null)
                return
              }
              const activeId = selectedRef.current
              if (activeId && (refreshAll || hintedIds.size === 0 || hintedIds.has(activeId))) {
                void loadDetail(activeId).catch(() => {})
                setDiffRefreshToken((n) => n + 1)
              }
            }).catch(() => {})
          }, 80)
        }

        const unsubscribe = subscribeProjectEvents({
          onUpdate: scheduleRefresh,
          onReconnect: () => scheduleRefresh(null),
        })

        return () => {
          stopped = true
          if (flushTimer !== null) clearTimeout(flushTimer)
          unsubscribe()
        }
      }, [loadDetail, loadProjects, refresh])

      useEffect(() => {
        let stopped = false
        void api('/models')
          .then((data) => {
            if (stopped) return
            setCatalog({
              models: Array.isArray(data.models) ? data.models : [],
              enumerable: data.enumerable === true,
              presets: Array.isArray(data.presets) ? data.presets : [],
              presetsEnumerable: data.presetsEnumerable === true,
            })
          })
          .catch(() => {
            if (!stopped) setCatalog({ models: [], enumerable: false, presets: [], presetsEnumerable: false })
          })
        return () => { stopped = true }
      }, [])

      const useWorkspacesSafe = typeof useWorkspaces === 'function' ? useWorkspaces : () => undefined
      const archivedSessionIds = useWorkspacesSafe((state) => state && state.archivedSessionIds)
      const project = detail && detail.project ? detail.project : null
      const projectId = project ? project.id : null
      const projectArchived = Boolean(project && project.archived)
      const coordinatorSessionId = project ? project.coordinatorSessionId : null
      const coordinatorArchived = Boolean(
        coordinatorSessionId && Array.isArray(archivedSessionIds) && archivedSessionIds.includes(coordinatorSessionId),
      )

      // Automatically ensure & mount the isolated coordinator session whenever
      // entering a project workspace (zero "Start coordinator" gate, zero English prompt).
      useEffect(() => {
        if (viewMode !== 'workspace' || !projectId) {
          setEnsuringCoord(false)
          setCoordError('')
          return undefined
        }
        if (projectArchived && !coordinatorSessionId) {
          setThread((cur) => (cur ? null : cur))
          setEnsuringCoord(false)
          setCoordError('')
          return undefined
        }
        if (thread && coordinatorSessionId && thread.sessionId === coordinatorSessionId) {
          setEnsuringCoord(false)
          setCoordError('')
          return undefined
        }
        if (!threadApi || typeof threadApi.ensureCoordinator !== 'function') {
          setEnsuringCoord(false)
          setCoordError(t('sessionUnavailable'))
          return undefined
        }
        let cancelled = false
        setEnsuringCoord(true)
        setCoordError('')
        void (async () => {
          try {
            const res = await threadApi.ensureCoordinator(project)
            if (cancelled) {
              try { res?.reference?.release?.() } catch {}
              return
            }
            if (res && res.reference) {
              setThread({ sessionId: res.sessionId, reference: res.reference })
              if (res.project) {
                setDetail((cur) => (cur && cur.project && cur.project.id === res.project.id ? { ...cur, project: res.project } : cur))
              }
            } else {
              setCoordError(t('coordinatorChatFailed'))
            }
          } catch (err) {
            if (!cancelled) setCoordError(messageOf(err))
          } finally {
            if (!cancelled) setEnsuringCoord(false)
          }
        })()
        return () => { cancelled = true }
      }, [viewMode, projectId, projectArchived, coordinatorSessionId, coordRetryToken])

      useEffect(() => {
        settingsDirtyRef.current = false
        setSettingsDirty(false)
        setMemoryPreview(null)
        setMemoryEditor(null)
        setExecTarget((cur) => (cur ? null : cur))
        setThread((cur) => (cur && cur.sessionId !== coordinatorSessionId ? null : cur))
        setCoordError('')
      }, [projectId])

      useEffect(() => {
        if (project && !settingsDirtyRef.current) {
          setNameText(project.name || '')
          setGoalText(project.goal || '')
        }
      }, [project])

      useEffect(() => {
        projectSnapshot.set(project ? { projectId: project.id, project } : null)
      }, [project])
      useEffect(() => () => projectSnapshot.set(null), [])

      // Fetch /library lazily if detail response didn't include it (e.g. older hosts/mocks).
      useEffect(() => {
        if (drawerTab !== 'library' || !projectId || (detail && detail.library)) return undefined
        let cancelled = false
        void api(`/projects/${projectId}/library`)
          .then((lib) => {
            if (cancelled || !mountedRef.current) return
            setDetail((cur) => (cur && cur.project && cur.project.id === projectId ? { ...cur, library: lib } : cur))
          })
          .catch(() => {})
        return () => { cancelled = true }
      }, [drawerTab, projectId, Boolean(detail && detail.library)])

      // Event-driven background notification when a running task transitions into
      // review / blocked / failed while the window is unfocused.
      useEffect(() => {
        if (!project || !project.id) return
        const prevMap = prevTaskStatusRef.current
        const nextTasks = Array.isArray(project.tasks) ? project.tasks : []
        const unfocused =
          typeof document !== 'undefined' &&
          (document.hidden === true || (typeof document.hasFocus === 'function' && !document.hasFocus()))
        const Notif = typeof Notification === 'function'
          ? Notification
          : (typeof window !== 'undefined' && typeof window.Notification === 'function' ? window.Notification : null)

        for (const tk of nextTasks) {
          if (!tk || !tk.id) continue
          const key = `${project.id}:${tk.id}`
          const prev = prevMap.get(key)
          prevMap.set(key, tk.status)
          if (
            prev === 'running' &&
            (tk.status === 'review' || tk.status === 'blocked' || tk.status === 'failed') &&
            unfocused &&
            Notif &&
            Notif.permission === 'granted'
          ) {
            const dedupeKey = `${key}:${tk.status}:${tk.finishedAt || tk.updatedAt || ''}`
            if (notifiedEventsRef.current.has(dedupeKey)) continue
            notifiedEventsRef.current.add(dedupeKey)
            try {
              const summary = taskSubtitle(tk, t)
              const body = summary && summary !== tk.title ? `${tk.title} — ${summary}` : tk.title
              const n = new Notif(`${project.name} · ${t(tk.status)}`, { body })
              if (n) {
                n.onclick = () => {
                  try { window.focus?.() } catch {}
                  requestOpenTask(project.id, tk.id)
                }
              }
            } catch {}
          }
        }
      }, [project, t])

      const run = useCallback(async (action) => {
        if (!mountedRef.current) return false
        setBusy(true)
        try {
          const msg = await action()
          if (mountedRef.current && msg) showToast(msg, { tone: 'success' })
          return true
        } catch (err) {
          if (mountedRef.current) showToast(`${t('errorPrefix')}${messageOf(err)}`, { tone: 'error' })
          return false
        } finally {
          if (mountedRef.current) setBusy(false)
        }
      }, [showToast, t])

      const applyTaskLocally = useCallback((nextTask) => {
        if (!nextTask || !nextTask.id) return
        setDetail((cur) => {
          if (!cur || !cur.project) return cur
          const tasks = (cur.project.tasks || []).map((item) => (item.id === nextTask.id ? nextTask : item))
          return { ...cur, project: { ...cur.project, tasks } }
        })
      }, [])

      const openTaskDetail = useCallback((task) => {
        if (!task) return
        void run(async () => {
          if (!task.childSessionId) {
            setExecTarget({ taskId: task.id, title: task.title, sessionId: '', reference: null })
            return ''
          }
          if (!threadApi || typeof threadApi.retainWorker !== 'function') {
            throw new Error(t('sessionUnavailable'))
          }
          const archived = Array.isArray(archivedSessionIds) ? archivedSessionIds : []
          if (archived.includes(task.childSessionId)) {
            await threadApi.restoreSession(task.childSessionId)
          }
          const reference = threadApi.retainWorker(task.childSessionId, project && project.coordinatorSessionId)
          setExecTarget({ taskId: task.id, title: task.title, sessionId: task.childSessionId, reference })
          return ''
        })
      }, [archivedSessionIds, project, run, t, threadApi])

      useEffect(() => {
        return openTaskRequest.subscribe((req) => {
          if (!req) return
          if (req.projectId && req.projectId !== selectedRef.current) {
            if (!projects.some((p) => p && p.id === req.projectId)) return
            pendingOpenRef.current = req
            selectedRef.current = req.projectId
            setSelectedId(req.projectId)
            setViewMode('workspace')
            void refresh(req.projectId, { enterWorkspace: true }).catch((err) => showToast(`${t('errorPrefix')}${messageOf(err)}`, { tone: 'error' }))
            return
          }
          setViewMode('workspace')
          const tasks = project && project.id === req.projectId ? (project.tasks || []) : []
          const found = tasks.find((item) => item && item.id === req.taskId)
          if (found) openTaskDetail(found)
          else if (!project || project.id !== req.projectId) pendingOpenRef.current = req
        })
      }, [openTaskDetail, project, projects, refresh, showToast, t])

      useEffect(() => {
        const pending = pendingOpenRef.current
        if (!pending || !project || project.id !== pending.projectId) return
        const found = (project.tasks || []).find((item) => item && item.id === pending.taskId)
        if (!found) return
        pendingOpenRef.current = null
        openTaskDetail(found)
      }, [openTaskDetail, project])

      const commitSwitchProject = (entry, options = {}) => {
        settingsDirtyRef.current = false
        setSettingsDirty(false)
        selectedRef.current = entry.id
        setSelectedId(entry.id)
        if (!options.stayOverview) setViewMode('workspace')
        void loadDetail(entry.id).catch((err) => showToast(`${t('errorPrefix')}${messageOf(err)}`, { tone: 'error' }))
      }

      const handleSelectProject = (entry, options = {}) => {
        if (!entry) return
        if (entry.id === selectedId && viewMode === 'workspace' && !options.openSettings) return
        if (settingsDirtyRef.current && entry.id !== selectedId) {
          setConfirmState({
            title: t('switchDiscardTitle'),
            description: t('switchDiscardDesc'),
            tone: 'warning',
            confirmLabel: t('discardAndSwitch'),
            cancelLabel: t('keepEditing'),
            onConfirm: () => {
              setConfirmState(null)
              commitSwitchProject(entry, options)
              if (options.openSettings) setShowSettings(true)
            },
          })
          return
        }
        commitSwitchProject(entry, options)
        if (options.openSettings) setShowSettings(true)
      }

      const handleCreateProject = (payload) =>
        void run(async () => {
          if (!payload.name) throw new Error(t('nameRequired'))
          const created = await api('/projects', { method: 'POST', body: JSON.stringify(payload) })
          setShowNewProject(false)
          await refresh(created.project && created.project.id, { enterWorkspace: true })
          return ''
        })

      const handlePatchProject = (patch, targetId) =>
        void run(async () => {
          const id = targetId || projectId
          if (!id) return ''
          await api(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
          await refresh(id, { stayOverview: viewModeRef.current === 'overview' })
          return ''
        })

      const handleSaveBasics = () =>
        void run(async () => {
          if (!projectId) return ''
          const trimmedName = nameText.trim()
          if (!trimmedName) throw new Error(t('nameRequired'))
          await api(`/projects/${projectId}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: trimmedName, goal: goalText }),
          })
          settingsDirtyRef.current = false
          setSettingsDirty(false)
          await refresh(projectId, { stayOverview: viewModeRef.current === 'overview' })
          return ''
        })

      const handleDeleteProject = (target, { archiveSessions }) =>
        void run(async () => {
          if (!target || !target.id) return ''
          await api(`/projects/${target.id}`, {
            method: 'DELETE',
            body: JSON.stringify({ archiveSessions: Boolean(archiveSessions) }),
          })
          setDeleteTarget(null)
          setShowSettings(false)
          if (selectedRef.current === target.id) {
            selectedRef.current = null
            setSelectedId(null)
            setDetail(null)
            setExecTarget(null)
            setThread(null)
          }
          const list = await loadProjects()
          if (!list || list.length === 0) {
            setViewMode('overview')
          } else if (viewModeRef.current === 'workspace' && !selectedRef.current) {
            const next = (list.find((p) => !p.archived) || list[0])?.id || null
            if (next) {
              selectedRef.current = next
              setSelectedId(next)
              await loadDetail(next)
            } else {
              setViewMode('overview')
            }
          }
          return ''
        })

      const handleOpenWorkspace = (proj) =>
        void run(async () => {
          if (!proj || !proj.workspace) return ''
          await api('/open-path', { method: 'POST', body: JSON.stringify({ path: proj.workspace, projectId: proj.id }) })
          return ''
        })

      const handleRestoreCoordinator = () =>
        void run(async () => {
          if (!project || !project.id || !threadApi) return ''
          if (project.coordinatorSessionId) {
            await threadApi.restoreSession(project.coordinatorSessionId)
          }
          try {
            await api(`/projects/${project.id}/coordinator/ensure`, {
              method: 'POST',
              body: JSON.stringify({ restore: true }),
            })
          } catch {}
          setCoordRetryToken((n) => n + 1)
          return ''
        })

      const handleApproveTask = (task) =>
        void run(async () => {
          const data = await api(`/projects/${projectId}/tasks/${task.id}/approve`, { method: 'POST', body: '{}' })
          if (data && data.task) applyTaskLocally(data.task)
          await refresh(projectId)
          return ''
        })

      const handleStopTask = (task) =>
        void run(async () => {
          const data = await api(`/projects/${projectId}/tasks/${task.id}/stop`, { method: 'POST', body: '{}' })
          if (data && data.task) applyTaskLocally(data.task)
          await refresh(projectId)
          return t('taskStopped')
        })

      const handleRetryTask = (task) =>
        void run(async () => {
          const data = await api(`/projects/${projectId}/tasks/${task.id}/retry`, { method: 'POST', body: '{}' })
          if (data && data.task) applyTaskLocally(data.task)
          await refresh(projectId)
          return data && data.dispatched ? t('taskRetriedDispatched') : t('taskRetriedQueued')
        })

      const handleResolveTask = (task) =>
        void run(async () => {
          const nextStatus = task.status === 'resolved' ? 'review' : 'resolved'
          const data = await api(`/projects/${projectId}/tasks/${task.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: nextStatus }),
          })
          if (data && data.task) applyTaskLocally(data.task)
          await refresh(projectId)
          return ''
        })

      const handleDeleteTask = (taskId, options) =>
        void run(async () => {
          const archive = Boolean(options && options.archive)
          let data
          try {
            data = await api(`/projects/${projectId}/tasks/${taskId}${archive ? '?session=archive' : ''}`, {
              method: 'DELETE',
              body: '{}',
            })
          } catch (err) {
            throw new Error(taskDeleteFailure(err, t, archive))
          }
          if (execTarget && execTarget.taskId === taskId) setExecTarget(null)
          await refresh(projectId)
          return ''
        })

      const handleCopyBranch = (branch) =>
        void run(async () => {
          if (typeof Primitives.writeClipboard === 'function') {
            await Primitives.writeClipboard(branch)
            return t('branchCopied')
          }
          const clip = globalThis.navigator && globalThis.navigator.clipboard
          if (!clip || typeof clip.writeText !== 'function') throw new Error(t('copyFailed'))
          await clip.writeText(branch)
          return t('branchCopied')
        })

      const handleRequestMergeWorktree = (task) => {
        setConfirmState({
          title: t('worktreeMergeTitle'),
          description: formatCopy(t('worktreeMergeDesc'), { branch: task.branch || task.id }),
          confirmLabel: t('worktreeMerge'),
          onConfirm: () => {
            setConfirmState(null)
            void run(async () => {
              await api(`/projects/${projectId}/tasks/${task.id}/worktree/merge`, { method: 'POST', body: '{}' })
              setDiffRefreshToken((n) => n + 1)
              await refresh(projectId)
              return t('worktreeMerged')
            })
          },
        })
      }

      const handleRequestCleanupWorktree = (task) => {
        setConfirmState({
          title: t('worktreeCleanupTitle'),
          description: t('worktreeCleanupDesc'),
          tone: 'warning',
          confirmLabel: t('worktreeCleanup'),
          onConfirm: () => {
            setConfirmState(null)
            void run(async () => {
              await api(`/projects/${projectId}/tasks/${task.id}/worktree`, { method: 'DELETE', body: '{}' })
              setDiffRefreshToken((n) => n + 1)
              await refresh(projectId)
              return t('worktreeCleaned')
            })
          },
        })
      }

      const openMemoryPreview = (file) => {
        if (!file || !projectId) return
        setMemoryPreview({ ...file, text: '', loading: true, error: '' })
        void api(`/projects/${projectId}/memory/${encodeURIComponent(file.name)}`)
          .then((data) => {
            setMemoryPreview((cur) => (cur && cur.name === file.name ? { ...cur, ...data, description: cur.description || data.description, loading: false, error: '' } : cur))
          })
          .catch((err) => {
            setMemoryPreview((cur) => (cur && cur.name === file.name ? { ...cur, loading: false, error: `${t('memoryLoadFailed')}: ${messageOf(err)}` } : cur))
          })
      }

      const openMemoryEditorForFile = (file) => {
        setMemoryPreview(null)
        setMemoryEditor({ ...file, isNew: false, loading: false })
      }

      const handleSaveMemory = ({ name, description, type, text }) =>
        void run(async () => {
          if (!projectId) return ''
          if (!name) throw new Error(t('memoryNameRequired'))
          if (!text || !text.trim()) throw new Error(t('memoryTextRequired'))
          await api(`/projects/${projectId}/memory`, {
            method: 'POST',
            body: JSON.stringify({ name, description, type, text }),
          })
          setMemoryEditor(null)
          await refresh(projectId, { stayOverview: viewModeRef.current === 'overview' })
          return ''
        })

      const handleDeleteMemory = (file) =>
        void run(async () => {
          if (!projectId || !file || file.isIndex || file.readOnly) return ''
          await api(`/projects/${projectId}/memory/${encodeURIComponent(file.name)}`, { method: 'DELETE', body: '{}' })
          setMemoryPreview(null)
          await refresh(projectId, { stayOverview: viewModeRef.current === 'overview' })
          return ''
        })

      const handleToggleMemoryPin = (file) =>
        void run(async () => {
          if (!projectId || !file || !file.name) return ''
          const nextPinned = !file.pinned
          await api(`/projects/${projectId}/memory/${encodeURIComponent(file.name)}`, {
            method: 'PATCH',
            body: JSON.stringify({ pinned: nextPinned }),
          })
          setDetail((cur) => {
            if (!cur || !cur.memory || !Array.isArray(cur.memory.files)) return cur
            const files = cur.memory.files.map((item) =>
              item && item.name === file.name ? { ...item, pinned: nextPinned } : item,
            )
            const pinnedCount = files.filter((item) => item && item.pinned).length
            return { ...cur, memory: { ...cur.memory, files, pinnedCount } }
          })
          await loadDetail(projectId)
          return ''
        })

      const handleSaveInstructions = (nextGoal) =>
        run(async () => {
          if (!projectId) return ''
          await api(`/projects/${projectId}`, {
            method: 'PATCH',
            body: JSON.stringify({ goal: nextGoal }),
          })
          settingsDirtyRef.current = false
          setSettingsDirty(false)
          setGoalText(nextGoal)
          await refresh(projectId, { stayOverview: viewModeRef.current === 'overview' })
          return ''
        })

      const handleAddReference = ({ path: refPathValue, title, note }) =>
        run(async () => {
          if (!projectId) return ''
          const data = await api(`/projects/${projectId}/library/references`, {
            method: 'POST',
            body: JSON.stringify({ path: refPathValue, title: title || undefined, note: note || undefined }),
          })
          setDetail((cur) => {
            if (!cur || !cur.project || cur.project.id !== projectId) return cur
            const prevLib = cur.library || { references: [], artifacts: [] }
            const references = Array.isArray(data && data.references)
              ? data.references
              : data && data.reference
                ? [...(prevLib.references || []), data.reference]
                : prevLib.references || []
            return { ...cur, library: { ...prevLib, references } }
          })
          return ''
        })

      const handleRemoveReference = (refId) =>
        void run(async () => {
          if (!projectId || !refId) return ''
          const data = await api(`/projects/${projectId}/library/references/${encodeURIComponent(refId)}`, {
            method: 'DELETE',
            body: '{}',
          })
          setDetail((cur) => {
            if (!cur || !cur.project || cur.project.id !== projectId) return cur
            const prevLib = cur.library || { references: [], artifacts: [] }
            const references = Array.isArray(data && data.references)
              ? data.references
              : (prevLib.references || []).filter((item) => item && item.id !== refId)
            return { ...cur, library: { ...prevLib, references } }
          })
          return ''
        })

      const handlePreviewFile = (filePath) =>
        void run(async () => {
          if (!project || !filePath) return ''
          if (typeof previewFile === 'function') {
            await previewFile(project, filePath)
          } else {
            await api('/open-path', { method: 'POST', body: JSON.stringify({ path: filePath, projectId: project.id }) })
          }
          return ''
        })

      const handleJumpTaskById = (taskId) => {
        if (!taskId || !project) return
        const found = (project.tasks || []).find((item) => item && item.id === taskId)
        if (found) {
          if (tasksLayout.overlay) setExecPref('closed')
          openTaskDetail(found)
        } else {
          requestOpenTask(project.id, taskId)
        }
      }

      const handleSendWorkerFeedback = (target, message) =>
        run(async () => {
          const text = String(message || '').trim()
          if (!text || !target || !target.reference) throw new Error(t('diffFeedbackUnavailable'))
          if (target.reference.ready && typeof target.reference.ready.then === 'function') {
            await target.reference.ready
          }
          const session = target.reference.binding && target.reference.binding.session
          if (!session || typeof session.prompt !== 'function') {
            throw new Error(t('diffFeedbackUnavailable'))
          }
          const res = await session.prompt([{ type: 'text', text }], 'queue')
          if (res && res.ok === false) {
            throw new Error((res.error && res.error.message) || t('diffFeedbackUnavailable'))
          }
          return ''
        })

      const taskList = (project && project.tasks) || []
      const library = (detail && detail.library) || { references: [], artifacts: [] }
      const refList = Array.isArray(library.references) ? library.references : []
      const execTask = execTarget ? taskList.find((item) => item.id === execTarget.taskId) || null : null
      const tasksLayout = computeTasksLayout({
        containerWidth,
        execPref,
        hasTasks: taskList.length > 0,
        hasContent: taskList.length > 0 || refList.length > 0,
        execWidth,
      })

      const startResize = (event) => {
        if (!event || (typeof event.button === 'number' && event.button !== 0)) return
        event.preventDefault?.()
        if (typeof window === 'undefined') return
        const startX = Number(event.clientX) || 0
        const from = tasksLayout.width
        const ceiling = containerWidth > 0 ? Math.min(EXEC_MAX_WIDTH, Math.max(EXEC_MIN_WIDTH, containerWidth - MAIN_MIN_WIDTH)) : EXEC_MAX_WIDTH
        let latest = from
        setResizing(true)
        const onMove = (ev) => {
          const delta = (Number(ev.clientX) || 0) - startX
          latest = Math.round(clamp(from - delta, EXEC_MIN_WIDTH, ceiling))
          setExecWidth(latest)
        }
        const onEnd = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onEnd)
          window.removeEventListener('pointercancel', onEnd)
          setResizing(false)
          writeStored('execWidth', latest)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onEnd)
        window.addEventListener('pointercancel', onEnd)
      }

      const nudgeWidth = (event) => {
        const step = event && event.shiftKey ? 48 : 16
        const delta = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0
        if (!delta) return
        event.preventDefault?.()
        const ceiling = containerWidth > 0 ? Math.min(EXEC_MAX_WIDTH, Math.max(EXEC_MIN_WIDTH, containerWidth - MAIN_MIN_WIDTH)) : EXEC_MAX_WIDTH
        const next = Math.round(clamp(tasksLayout.width + delta, EXEC_MIN_WIDTH, ceiling))
        setExecWidth(next)
        writeStored('execWidth', next)
      }

      const showWorkspace = viewMode === 'workspace' && Boolean(project)

      return h(
        'div',
        { ref: pageRef, className: `pj-page${resizing ? ' pj-resizing' : ''}`, 'data-projects-page': 'true' },
        h('style', { dangerouslySetInnerHTML: { __html: PAGE_CSS } }),
        !showWorkspace
          ? h(ProjectsOverview, {
              projects,
              busy,
              onSelect: (entry) => handleSelectProject(entry),
              onNewProject: () => setShowNewProject(true),
              onOpenSettings: (entry) => handleSelectProject(entry, { stayOverview: true, openSettings: true }),
              onArchiveToggle: (entry, archived) => handlePatchProject({ archived }, entry.id),
              onRequestDelete: (entry) => setDeleteTarget(entry),
              t,
            })
          : h(
              Fragment,
              null,
              h(WorkspaceTopbar, {
                projects,
                project,
                taskList,
                threadsOpen: tasksLayout.open,
                containerWidth,
                busy,
                onShowOverview: () => { setExecTarget(null); setViewMode('overview') },
                onSelectProject: (entry) => handleSelectProject(entry),
                onNewProject: () => setShowNewProject(true),
                onOpenWorkspace: handleOpenWorkspace,
                onToggleAutonomy: () => handlePatchProject({ autonomy: project.autonomy === 'auto' ? 'manual' : 'auto' }),
                onTogglePaused: () => handlePatchProject({ paused: !project.paused }),
                onOpenSettings: () => setShowSettings(true),
                onToggleThreads: () => setExecPref(tasksLayout.open ? 'closed' : 'open'),
                settingsBtnRef,
                t,
              }),
              h(
                'div',
                { className: 'pj-body' },
                h(
                  'section',
                  { className: 'pj-stage', 'aria-label': execTarget ? execTarget.title : project.name },
                  execTarget
                    ? h(TaskDetailStage, {
                        project,
                        catalog,
                        execTarget,
                        execTask,
                        diffRefreshToken,
                        busy,
                        onCloseDetail: () => setExecTarget(null),
                        onApproveTask: handleApproveTask,
                        onStopTask: handleStopTask,
                        onRetryTask: handleRetryTask,
                        onResolveTask: handleResolveTask,
                        onCopyBranch: handleCopyBranch,
                        onRequestMergeWorktree: handleRequestMergeWorktree,
                        onRequestCleanupWorktree: handleRequestCleanupWorktree,
                        onSendWorkerFeedback: handleSendWorkerFeedback,
                        SessionProvider,
                        renderSlot,
                        t,
                      })
                    : h(
                        Fragment,
                        null,
                        coordinatorArchived &&
                          h(
                            'div',
                            { className: 'pj-banner', role: 'status' },
                            h('span', null, t('coordinatorArchived')),
                            h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: handleRestoreCoordinator }, t('restore')),
                          ),
                        project.archived && !project.coordinatorSessionId
                          ? h(
                              'div',
                              { className: 'pj-center-state' },
                              h('p', { className: 'pj-hint' }, t('archivedHint')),
                              h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', onClick: () => setShowSettings(true) }, t('openSettings')),
                            )
                          : thread && thread.reference
                            ? h(
                                'div',
                                { className: 'pj-chat-host' },
                                h(
                                  EmbeddedBoundary,
                                  { fallback: h('div', { className: 'pj-center-state' }, t('coordinatorChatFailed')) },
                                  typeof SessionProvider === 'function' && typeof renderSlot === 'function'
                                    ? h(SessionProvider, { session: thread.reference }, renderSlot('projects.conversation', {}))
                                    : h('div', { className: 'pj-center-state' }, t('coordinatorChatFailed')),
                                ),
                              )
                            : ensuringCoord
                              ? h(
                                  'div',
                                  { className: 'pj-center-state', role: 'status' },
                                  h(UIStateDot, { state: 'ongoing', size: 16 }),
                                  h('span', null, t('preparingCoordinator')),
                                )
                              : h(
                                  'div',
                                  { className: 'pj-center-state' },
                                  h('span', null, coordError || t('coordinatorChatFailed')),
                                  h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', onClick: () => setCoordRetryToken((n) => n + 1) }, t('retryAction')),
                                ),
                      ),
                ),
                tasksLayout.open && !tasksLayout.overlay &&
                  h(TasksPanel, {
                    project,
                    library,
                    memory: detail && detail.memory,
                    drawerTab,
                    onDrawerTabChange: setDrawerTab,
                    width: tasksLayout.width,
                    overlay: false,
                    busy,
                    execTarget,
                    onClosePanel: () => setExecPref('closed'),
                    onStartResize: startResize,
                    onNudgeWidth: nudgeWidth,
                    onSelectTask: (task) => openTaskDetail(task),
                    onJumpTaskById: handleJumpTaskById,
                    onApproveTask: handleApproveTask,
                    onStopTask: handleStopTask,
                    onRetryTask: handleRetryTask,
                    onResolveTask: handleResolveTask,
                    onDeleteTask: handleDeleteTask,
                    onAddReference: handleAddReference,
                    onRemoveReference: handleRemoveReference,
                    onPreviewFile: handlePreviewFile,
                    onSaveInstructions: handleSaveInstructions,
                    onToggleMemoryPin: handleToggleMemoryPin,
                    onOpenMemoryPreview: openMemoryPreview,
                    onNewMemoryTopic: () => setMemoryEditor({ isNew: true, name: '', description: '', type: 'reference', text: '', loading: false }),
                    pickFolder,
                    activeLocale: getLocale,
                    t,
                  }),
                h(
                  OverlayDrawerHost,
                  { open: tasksLayout.open && tasksLayout.overlay },
                  h(TasksPanel, {
                    project,
                    library,
                    memory: detail && detail.memory,
                    drawerTab,
                    onDrawerTabChange: setDrawerTab,
                    width: tasksLayout.width || Math.min(EXEC_DEFAULT_WIDTH, Math.max(240, (containerWidth || EXEC_DEFAULT_WIDTH) - 24)),
                    overlay: true,
                    busy,
                    execTarget,
                    onClosePanel: () => setExecPref('closed'),
                    onStartResize: startResize,
                    onNudgeWidth: nudgeWidth,
                    onSelectTask: (task) => {
                      setExecPref('closed')
                      openTaskDetail(task)
                    },
                    onJumpTaskById: handleJumpTaskById,
                    onApproveTask: handleApproveTask,
                    onStopTask: handleStopTask,
                    onRetryTask: handleRetryTask,
                    onResolveTask: handleResolveTask,
                    onDeleteTask: handleDeleteTask,
                    onAddReference: handleAddReference,
                    onRemoveReference: handleRemoveReference,
                    onPreviewFile: handlePreviewFile,
                    onSaveInstructions: handleSaveInstructions,
                    onToggleMemoryPin: handleToggleMemoryPin,
                    onOpenMemoryPreview: openMemoryPreview,
                    onNewMemoryTopic: () => setMemoryEditor({ isNew: true, name: '', description: '', type: 'reference', text: '', loading: false }),
                    pickFolder,
                    activeLocale: getLocale,
                    t,
                  }),
                ),
              ),
            ),
        h(NewProjectModal, {
          open: showNewProject,
          busy,
          onClose: () => setShowNewProject(false),
          onCreate: handleCreateProject,
          pickFolder,
          t,
        }),
        h(ProjectSettingsModal, {
          open: showSettings,
          project,
          memory: detail && detail.memory,
          catalog,
          nameText,
          goalText,
          settingsDirty,
          busy,
          onNameChange: (val) => {
            settingsDirtyRef.current = true
            setSettingsDirty(true)
            setNameText(val)
          },
          onGoalChange: (val) => {
            settingsDirtyRef.current = true
            setSettingsDirty(true)
            setGoalText(val)
          },
          onSaveBasics: handleSaveBasics,
          onPatchProject: handlePatchProject,
          onChooseWorkspace: () =>
            void run(async () => {
              const dir = await pickFolder()
              if (dir && projectId) {
                await api(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ workspace: dir }) })
                await refresh(projectId, { stayOverview: viewModeRef.current === 'overview' })
              }
              return ''
            }),
          onClearWorkspace: () => handlePatchProject({ workspace: '' }),
          onArchiveToggle: (archived) => handlePatchProject({ archived }),
          onRequestDeleteProject: (entry) => setDeleteTarget(entry),
          onOpenMemoryPreview: openMemoryPreview,
          onNewMemoryTopic: () => setMemoryEditor({ isNew: true, name: '', description: '', type: 'reference', text: '', loading: false }),
          onClose: () => setShowSettings(false),
          t,
        }),
        h(DeleteProjectModal, {
          target: deleteTarget,
          busy,
          onClose: () => setDeleteTarget(null),
          onConfirm: handleDeleteProject,
          t,
        }),
        h(MemoryPreviewModal, {
          file: memoryPreview,
          busy,
          onClose: () => setMemoryPreview(null),
          onEdit: openMemoryEditorForFile,
          onDelete: handleDeleteMemory,
          t,
        }),
        h(MemoryEditorModal, {
          editor: memoryEditor,
          busy,
          onClose: () => setMemoryEditor(null),
          onSave: handleSaveMemory,
          t,
        }),
        h(ConfirmModal, {
          state: confirmState,
          busy,
          onClose: () => setConfirmState(null),
          t,
        }),
        toast &&
          h(UIToast, {
            key: toast.seq,
            text: toast.text,
            tone: toast.tone,
            holdMs: toast.holdMs,
            onDone: () => setToast((cur) => (cur && cur.seq === toast.seq ? null : cur)),
          }),
      )
    }

    // =========================================================================
    // Plugin Export (Strictly 4 Client Slots, Zero Legacy UI Surfaces)
    // =========================================================================

    return {
      inject: ['slots', 'locale', 'uiWorkspace', 'sessions'],
      apply(ctx) {
        const localeStore = createStore(0)
        const activeLocale = () => {
          try {
            return String(ctx.locale.getLocale().active || 'zh')
          } catch {
            return 'zh'
          }
        }
        const translate = (key) => {
          const dict = activeLocale().toLowerCase().startsWith('zh') ? ZH : EN
          return dict[key] || EN[key] || key
        }

        try {
          ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-project: dictionaries')
        } catch {}

        if (ctx.locale && typeof ctx.locale.subscribe === 'function') {
          try {
            ctx.effect(() => ctx.locale.subscribe(() => localeStore.set(localeStore.get() + 1)), 'dsh-project: locale watch')
          } catch {}
        }

        const pickFolder = async () => {
          const ws = ctx.get('uiWorkspace')
          const picker = ws && (typeof ws.selectDirectory === 'function' ? ws.selectDirectory : ws.pickDirectory)
          if (typeof picker !== 'function') throw new Error(translate('pickerUnavailable'))
          return picker.call(ws)
        }

        const previewFile = async (project, filePath) => {
          const target = String(filePath || '').trim()
          if (!project || !target) return
          const wsSvc = typeof ctx.get === 'function' ? ctx.get('workspaces') : undefined
          const sid = typeof project.coordinatorSessionId === 'string' && project.coordinatorSessionId.trim()
            ? project.coordinatorSessionId.trim()
            : undefined
          if (wsSvc && typeof wsSvc.openPath === 'function' && sid) {
            try {
              await wsSvc.openPath(target, { sessionId: sid })
              return
            } catch {}
          }
          await api('/open-path', {
            method: 'POST',
            body: JSON.stringify({ path: target, projectId: project.id }),
          })
        }

        const restoreSession = async (sessionId) => {
          if (!sessionId) return false
          const ws = ctx.get('uiWorkspace')
          if (ws && typeof ws.unarchiveSession === 'function') {
            await ws.unarchiveSession(sessionId)
            return true
          }
          await api('/sessions/restore', { method: 'POST', body: JSON.stringify({ sessionId }) })
          return true
        }

        const threadApi = {
          restoreSession,
          async ensureCoordinator(project) {
            const sessions = ctx.get('sessions')
            if (!sessions || typeof sessions.retain !== 'function') {
              throw new Error(translate('sessionUnavailable'))
            }
            let sessionId = typeof project.coordinatorSessionId === 'string' ? project.coordinatorSessionId.trim() : ''
            let updatedProject = null
            if (!sessionId) {
              const ensured = await api(`/projects/${project.id}/coordinator/ensure`, {
                method: 'POST',
                body: '{}',
              })
              sessionId = String(ensured.coordinatorSessionId || (ensured.project && ensured.project.coordinatorSessionId) || '').trim()
              updatedProject = ensured.project || null
            }
            if (!sessionId) throw new Error(translate('coordinatorChatFailed'))
            const reference = sessions.retain(sessionId, { source: 'projects' })
            try {
              await reference.ready
            } catch (err) {
              try { reference.release() } catch {}
              // Re-ensure once if a persisted coordinatorSessionId became stale.
              const ensured = await api(`/projects/${project.id}/coordinator/ensure`, {
                method: 'POST',
                body: '{}',
              })
              const nextId = String(ensured.coordinatorSessionId || (ensured.project && ensured.project.coordinatorSessionId) || '').trim()
              if (!nextId || nextId === sessionId) throw err
              const nextRef = sessions.retain(nextId, { source: 'projects' })
              await nextRef.ready
              return { sessionId: nextId, reference: nextRef, project: ensured.project || null }
            }
            return { sessionId, reference, project: updatedProject }
          },
          retainWorker(childSessionId, parentSessionId) {
            const sessions = ctx.get('sessions')
            if (!sessions || typeof sessions.retain !== 'function') {
              throw new Error(translate('sessionUnavailable'))
            }
            if (parentSessionId) {
              try {
                return sessions.retain(
                  { parentSessionId, childSessionId, mode: 'continuable' },
                  { source: 'projects' },
                )
              } catch {}
            }
            return sessions.retain(childSessionId, { source: 'projects' })
          },
        }

        // Slot 1: Left sidebar panel entry (order: 30, after plugins / schedules / dsh-whale)
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => translate('nav') },
            ProjectsIcon,
          ),
        )

        // Slot 2: Main full-page workspace with session-scoped conversation child slot
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              children: { 'projects.conversation': { kind: 'single', scope: 'session' } },
            },
            (props) =>
              h(ProjectsPage, {
                ...props,
                translate,
                getLocale: activeLocale,
                localeStore,
                pickFolder,
                previewFile,
                threadApi,
              }),
          ),
        )

        // Slot 3: Embedded native DSH conversation host
        ctx.slots.inject('projects.conversation', () =>
          ctx.slots.register({ name: 'projects.conversation' }, EmbeddedConversation),
        )

        // Slot 4: In-chat clickable task dispatch card
        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register(
            {
              name: 'tool.call.toolview',
              key: 'projects_dispatch',
              inject: () => ({ translate, activeLocale }),
            },
            ProjectsDispatchRow,
          ),
        )
      },
    }
  },
})
