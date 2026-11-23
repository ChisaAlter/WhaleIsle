/**
 * WhaleIsle Projects — Client half.
 *
 * Full-page three-column project workspace registered through four DSH slots:
 *   1. `sidebar.panellist` (id: 'projects', order: 30) — left sidebar entry.
 *   2. `main` (key: 'projects') — three-column container-aware board page.
 *   3. `projects.conversation` — embedded native DSH conversation surface.
 *   4. `tool.call.toolview` (key: 'projects_dispatch') — clickable dispatch card.
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

    const LIST_DEFAULT_WIDTH = 248
    const LIST_MIN_WIDTH = 188
    const EXEC_DEFAULT_WIDTH = 380
    const EXEC_MIN_WIDTH = 280
    const MAIN_MIN_WIDTH = 400
    const RAIL_WIDTH = 44
    const RESIZER_WIDTH = 5
    const EXEC_FOLD_BELOW = MAIN_MIN_WIDTH + LIST_MIN_WIDTH + EXEC_MIN_WIDTH + RESIZER_WIDTH * 2
    const LIST_FOLD_BELOW = MAIN_MIN_WIDTH + LIST_MIN_WIDTH + RAIL_WIDTH + RESIZER_WIDTH
    const MENU_MARGIN = 8
    const MAX_CONCURRENCY = 8
    const GENERIC_EFFORTS = ['off', 'low', 'high', 'max']
    const SSE_MIN_DELAY_MS = 1000
    const SSE_MAX_DELAY_MS = 30000

    const THREAD_GROUPS = [
      { key: 'running', icon: 'running', titleKey: 'groupRunning', statuses: ['running'] },
      { key: 'review', icon: 'review', titleKey: 'groupReview', statuses: ['review'] },
      { key: 'waiting', icon: 'waiting', titleKey: 'groupWaiting', statuses: ['blocked', 'failed'] },
      { key: 'idle', icon: 'idle', titleKey: 'groupIdle', statuses: ['queued'] },
      { key: 'resolved', icon: 'resolved', titleKey: 'groupResolved', statuses: ['resolved'] },
    ]

    const DEFAULT_COLLAPSED_GROUPS = { resolved: true }

    const ZH = {
      nav: '项目',
      title: '项目',
      projects: '项目',
      project: '项目',
      newProject: '新建项目',
      projectName: '项目名称',
      projectNamePlaceholder: '例如：接口重构、发布前巡检…',
      instructions: '项目指令',
      instructionsHint: '作为长期背景与约束发送给协调者和每位执行者。',
      instructionsPlaceholder: '目标、范围、代码规范、验收标准…',
      workspace: '工作区',
      chooseFolder: '选择文件夹',
      clear: '清除',
      noWorkspace: '未选择目录（继承默认工作目录）',
      openFolder: '打开工作目录',
      autonomy: '派发模式',
      autonomyManual: '手动审批',
      autonomyAuto: '自动派发',
      autonomyManualHint: '任务需先批准，协调者才可派发执行。',
      autonomyAutoHint: '协调者拆解后可直接派发执行。',
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
      settings: '项目设置',
      settingsNav: '设置分组',
      general: '通用',
      threads: '线程',
      threadsSettings: '执行线程',
      threadsHint: '配置本项目执行者的默认派发策略、并发上限、模型路由与目录隔离。',
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
      archiveSection: '归档项目',
      archiveWarning: '归档后项目移入底部归档列表并停止新派发；任务、记忆与会话保留，关联工作树会被清理。',
      archive: '归档项目',
      archiveConfirm: '确认归档',
      unarchive: '恢复项目',
      archivedBadge: '已归档',
      archivedProjects: '已归档项目',
      archivedHint: '项目已归档，请先在设置中恢复后再启动或派发。',
      noProjects: '还没有项目。新建一个项目，让协调者帮你并行推进。',
      noSelection: '从左侧选择一个项目，或新建一个项目。',
      nameRequired: '请输入项目名称。',
      startCoordinator: '启动协调者',
      startCoordinatorHint: '协调者负责拆解目标、并行派发任务并汇总进度，它的完整原生对话就在这里。',
      coordinatorArchived: '协调者会话已归档，新消息不会触发运行。恢复后可继续对话。',
      restore: '恢复会话',
      coordinatorChatFailed: '无法加载内嵌协调者会话。',
      workerChatFailed: '无法加载执行者会话。',
      noConversation: '该任务尚未启动执行者会话。',
      taskBriefHeading: '任务说明',
      emptyTasks: '还没有任务。在中间对话告诉协调者目标，由它拆解并派发。',
      noMatches: '没有匹配的线程。',
      noTask: '该任务已不在当前看板中。',
      searchThreads: '搜索线程',
      filterThreads: '筛选分组',
      filterGroups: '显示的分组',
      showAllGroups: '显示全部分组',
      collapseAll: '全部折叠',
      expandAll: '全部展开',
      collapseList: '收起项目栏',
      expandList: '展开项目栏',
      collapseThreads: '收起线程栏',
      expandThreads: '展开线程栏',
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
      copyBranch: '复制分支名',
      branchCopied: '分支名已复制。',
      copyFailed: '剪贴板不可用，无法复制分支名。',
      switchDiscardTitle: '放弃未保存修改？',
      switchDiscardDesc: '当前项目指令有未保存的更改，切换项目将丢弃这些修改。',
      discardAndSwitch: '放弃并切换',
      keepEditing: '继续编辑',
      dispatchCard: '派发任务',
      dispatchPreparing: '正在派发…',
      dispatchOpenHint: '点击查看该执行者详情',
      taskActions: '任务操作',
      justNow: '刚刚',
      counts: '个任务',
      unsavedTag: '未保存',
      sseDisconnected: '实时连接中断，正在自动重连…',
      sessionUnavailable: '当前环境不支持会话服务。',
      pickerUnavailable: '当前环境不支持目录选择器。',
      promptRejected: '发送协调者首条消息被拒绝。',
      errorPrefix: '操作失败：',
    }

    const EN = {
      nav: 'Projects',
      title: 'Projects',
      projects: 'Projects',
      project: 'Project',
      newProject: 'New project',
      projectName: 'Project name',
      projectNamePlaceholder: 'e.g. API Refactor, Release Audit…',
      instructions: 'Project instructions',
      instructionsHint: 'Shared goal, constraints and acceptance conventions sent to coordinator and workers.',
      instructionsPlaceholder: 'Goal, scope, conventions, verification criteria…',
      workspace: 'Workspace',
      chooseFolder: 'Choose folder',
      clear: 'Clear',
      noWorkspace: 'No folder (inherits default directory)',
      openFolder: 'Open workspace folder',
      autonomy: 'Dispatch mode',
      autonomyManual: 'Manual approval',
      autonomyAuto: 'Auto dispatch',
      autonomyManualHint: 'Tasks require approval before the coordinator can dispatch them.',
      autonomyAutoHint: 'Coordinator dispatches tasks immediately without waiting.',
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
      settings: 'Project settings',
      settingsNav: 'Settings sections',
      general: 'General',
      threads: 'Threads',
      threadsSettings: 'Worker threads',
      threadsHint: 'Default dispatch mode, concurrency cap, model route and worktree isolation for this project.',
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
      archiveSection: 'Archive project',
      archiveWarning: 'Moves project to archived list and stops new dispatches. Tasks, memory and sessions stay intact; task worktrees are cleaned up.',
      archive: 'Archive project',
      archiveConfirm: 'Confirm archive',
      unarchive: 'Restore project',
      archivedBadge: 'Archived',
      archivedProjects: 'Archived projects',
      archivedHint: 'This project is archived. Restore it in settings to resume.',
      noProjects: 'No projects yet. Create one to let the coordinator split and run tasks in parallel.',
      noSelection: 'Select a project on the left, or create a new one.',
      nameRequired: 'Project name is required.',
      startCoordinator: 'Start coordinator',
      startCoordinatorHint: 'The coordinator splits goals, dispatches parallel workers and reports back in this native conversation.',
      coordinatorArchived: 'Coordinator session is archived and cannot run new messages. Restore it to continue.',
      restore: 'Restore session',
      coordinatorChatFailed: 'Could not mount the embedded coordinator conversation.',
      workerChatFailed: 'Could not mount the worker conversation.',
      noConversation: 'This task has no worker session yet.',
      taskBriefHeading: 'Task brief',
      emptyTasks: 'No tasks yet. Describe your goal in the coordinator chat to split and dispatch work.',
      noMatches: 'No matching threads.',
      noTask: 'This task is no longer on the board.',
      searchThreads: 'Search threads',
      filterThreads: 'Filter groups',
      filterGroups: 'Visible groups',
      showAllGroups: 'Show all groups',
      collapseAll: 'Collapse all',
      expandAll: 'Expand all',
      collapseList: 'Collapse project list',
      expandList: 'Expand project list',
      collapseThreads: 'Collapse threads panel',
      expandThreads: 'Expand threads panel',
      resizeColumns: 'Resize columns',
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
      copyBranch: 'Copy branch name',
      branchCopied: 'Branch name copied.',
      copyFailed: 'Clipboard unavailable; could not copy branch name.',
      switchDiscardTitle: 'Discard unsaved changes?',
      switchDiscardDesc: 'Project instructions have unsaved edits. Switching projects will discard them.',
      discardAndSwitch: 'Discard and switch',
      keepEditing: 'Keep editing',
      dispatchCard: 'Dispatched task',
      dispatchPreparing: 'Dispatching…',
      dispatchOpenHint: 'Click to inspect worker thread',
      taskActions: 'Task actions',
      justNow: 'just now',
      counts: 'tasks',
      unsavedTag: 'Unsaved',
      sseDisconnected: 'Realtime stream disconnected, reconnecting…',
      sessionUnavailable: 'Session service is unavailable on this page.',
      pickerUnavailable: 'Directory picker is unavailable on this page.',
      promptRejected: 'Initial coordinator message was rejected.',
      errorPrefix: 'Error: ',
    }

    function formatCopy(template, params) {
      if (!params) return template
      return String(template).replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
    }

    // Shared rules used both inside the full page and inside standalone
    // `projects_dispatch` tool cards rendered in conversations outside the page.
    const DISPATCH_SHARED_CSS = `
.pj-dispatch-wrap{margin:4px 0}
.pj-dispatch-card{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
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
.pj-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;height:20px;padding:0 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pj-chip-branch{font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:0.5px solid var(--dsw-alias-border-l2)}
.pj-chip-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-label)}
`

    const PAGE_CSS = `
.pj-page{display:flex;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px;line-height:22px;box-sizing:border-box}
.pj-page *,.pj-page *::before,.pj-page *::after{box-sizing:border-box}
.pj-page :focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.pj-page.pj-resizing{cursor:col-resize;user-select:none}

/* Columns */
.pj-list{display:flex;flex-direction:column;flex:0 0 auto;min-width:0;min-height:0;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2)}
.pj-list.pj-collapsed{width:44px;min-width:44px;max-width:44px}
.pj-main{display:flex;flex-direction:column;flex:1 1 0;min-width:0;min-height:0;background:transparent}
.pj-exec{display:flex;flex-direction:column;flex:0 0 auto;min-width:0;min-height:0;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2)}
.pj-exec.pj-collapsed{width:44px;min-width:44px;max-width:44px}

/* Column Headers */
.pj-col-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:48px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.pj-col-title{margin:0;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-main-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;min-width:0}
.pj-main-head-left{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto}
.pj-main-title{margin:0;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-main-head-right{display:flex;align-items:center;gap:6px;flex:none}
.pj-head-actions{display:flex;align-items:center;gap:4px;flex:none}
.pj-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.pj-icon-btn:disabled{opacity:0.4;cursor:not-allowed}
.pj-icon-btn.pj-active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.pj-icon-btn.pj-resolved-on{color:var(--dsw-alias-state-success-primary)}

/* Resizers */
.pj-resizer{position:relative;flex:0 0 5px;width:5px;padding:0;border:0;background:transparent;cursor:col-resize;touch-action:none}
.pj-resizer::after{content:'';position:absolute;inset:0 -2px}
.pj-resizer:hover,.pj-resizer:focus-visible{background:var(--dsw-alias-border-l3)}

/* Collapsed 44px Rails */
.pj-rail{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 0;flex:1 1 auto;min-height:0;overflow-y:auto}
.pj-rail-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;font-weight:600;cursor:pointer;flex:none;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-rail-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.pj-rail-btn.pj-active{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary)}
.pj-rail-sep{width:20px;height:1px;background:var(--dsw-alias-border-l2);flex:none;margin:2px 0}
.pj-rail-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 6px;border-radius:var(--dsw-radius-badge);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-weight:500}

/* Left Column: Project List */
.pj-list-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px}
.pj-list-item{display:flex;flex-direction:column;gap:2px;width:100%;padding:8px 10px;margin-bottom:2px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-list-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pj-list-item.pj-active{background:var(--dsw-specific-sidebar-nav-item-active)}
.pj-list-row-top{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
.pj-list-name{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.pj-list-dir{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-list-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-archived-fold{flex:none;border-top:1px solid var(--dsw-alias-border-l2);padding:6px 8px}
.pj-archived-toggle{display:flex;align-items:center;gap:6px;width:100%;padding:4px 6px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;font-weight:500;text-align:left;cursor:pointer}
.pj-archived-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.pj-archived-list{max-height:180px;overflow-y:auto;margin-top:4px}

/* Middle Column: Coordinator Conversation */
.pj-main-body{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
.pj-chat-host{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
.pj-start-hero{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;flex:1 1 auto;padding:24px;text-align:center;max-width:480px;margin:0 auto}
.pj-start-goal{width:100%;padding:12px 16px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-panel-solid);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;text-align:left;white-space:pre-wrap;max-height:180px;overflow-y:auto}
.pj-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,var(--dsw-alias-bg-panel-solid));color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px;flex:none}
.pj-ws-pill{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-pill-paused{color:var(--dsw-alias-state-warn-label)}

/* Right Column: Threads Panel */
.pj-search-bar{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.pj-exec-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 10px 24px}
.pj-group{margin-bottom:12px}
.pj-group-btn{display:flex;align-items:center;gap:6px;width:100%;padding:4px 8px;margin-bottom:2px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;font-weight:500;text-align:left;cursor:pointer}
.pj-group-btn:hover{color:var(--dsw-alias-label-primary)}
.pj-task-card-wrap{position:relative;margin-bottom:2px}
.pj-task-card{display:grid;grid-template-columns:16px minmax(0,1fr) auto;grid-template-areas:"icon title time" "icon sub sub" "icon chips chips";align-items:center;column-gap:8px;row-gap:2px;width:100%;padding:8px 10px;border:0.5px solid transparent;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-task-card:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1)}
.pj-task-card.pj-active{background:var(--dsw-specific-sidebar-nav-item-active);border-color:var(--dsw-alias-border-l2)}
.pj-task-icon{grid-area:icon;align-self:start;margin-top:3px}
.pj-task-title{grid-area:title;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-task-time{grid-area:time;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.pj-task-sub{grid-area:sub;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-task-chips{grid-area:chips;display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;min-width:0}
.pj-task-quick{position:absolute;top:6px;right:6px;display:flex;align-items:center;gap:4px;opacity:0;pointer-events:none;transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);background:var(--dsw-alias-bg-panel-solid);padding:2px;border-radius:var(--dsw-radius-sm);box-shadow:var(--dsw-shadow-lv1)}
.pj-task-card-wrap:hover .pj-task-quick,.pj-task-card-wrap:focus-within .pj-task-quick{opacity:1;pointer-events:auto}

/* Filter Popover & Context Menu */
.pj-filter-wrap{position:relative;display:inline-flex}
.pj-popover-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:80;min-width:200px;padding:4px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu,var(--dsw-alias-bg-panel-solid));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);display:flex;flex-direction:column;gap:2px}
.pj-ctx-menu{position:fixed;z-index:1200;min-width:196px;max-width:296px;padding:4px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu,var(--dsw-alias-bg-panel-solid));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);display:flex;flex-direction:column;gap:2px}
.pj-menu-row{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:6px 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.pj-menu-row:hover:not(:disabled),.pj-menu-row:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);outline:none}
.pj-menu-row:disabled{opacity:0.4;cursor:not-allowed}
.pj-menu-row.pj-danger{color:var(--dsw-alias-state-error-primary)}
.pj-menu-row.pj-danger:hover:not(:disabled),.pj-menu-row.pj-danger:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.pj-menu-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;color:var(--dsw-alias-menu-icon)}
.pj-menu-row.pj-danger .pj-menu-icon{color:var(--dsw-alias-state-error-primary)}
.pj-menu-check{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;color:var(--dsw-alias-state-business-primary)}
.pj-menu-text{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
.pj-menu-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:normal}
.pj-menu-caption{padding:4px 8px 2px;font-size:11px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-tertiary)}
.pj-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2)}

/* Task Master-Detail View */
.pj-detail-shell{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}
.pj-detail-head{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;background:var(--dsw-alias-bg-layer-1)}
.pj-detail-row{display:flex;align-items:center;gap:6px;min-width:0}
.pj-detail-title{flex:1 1 auto;min-width:0;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-detail-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.pj-detail-branch-row{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:18px}
.pj-branch-pill{display:inline-flex;align-items:center;gap:4px;max-width:100%;min-width:0;height:24px;padding:0 4px 0 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.pj-branch-code{font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-worktree-warn{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-detail-body{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}
.pj-brief-card{margin:12px;padding:12px 14px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-panel-solid);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}

/* Diff View */
.pj-diff-panel{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}
.pj-diff-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.pj-diff-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:12px}
.pj-diff-files{display:flex;flex-direction:column;gap:4px}
.pj-diff-file-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-panel-solid);border:0.5px solid var(--dsw-alias-border-l1);font-size:12px;line-height:18px}
.pj-diff-file-path{font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.pj-diff-counts{display:inline-flex;align-items:center;gap:6px;flex:none;font-family:var(--ds-font-family-code);font-size:11px;line-height:16px}
.pj-diff-add{color:var(--dsw-alias-state-success-primary)}
.pj-diff-del{color:var(--dsw-alias-state-error-primary)}
.pj-diff-pre{margin:0;padding:12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-panel-solid);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;overflow:auto;white-space:pre}
.pj-diff-line{display:block;padding:0 4px}
.pj-diff-line-add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.pj-diff-line-del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.pj-diff-line-hunk{color:var(--dsw-alias-state-business-primary)}

/* Forms & Modals (note: Modal & context menus portal to document.body outside .pj-page) */
.pj-modal-solid,.pj-modal-solid *,.pj-modal-solid *::before,.pj-modal-solid *::after,.pj-settings-modal,.pj-settings-modal *,.pj-settings-modal *::before,.pj-settings-modal *::after,.pj-ctx-menu,.pj-ctx-menu *{box-sizing:border-box}
.pj-modal-solid{background:var(--dsw-alias-bg-panel-solid)}
.pj-modal-form{width:min(500px,calc(100vw - 32px))}
.pj-modal-wide{width:min(620px,calc(100vw - 32px))}
.pj-form-stack{display:flex;flex-direction:column;gap:14px;min-width:0;width:100%}
.pj-field{display:flex;flex-direction:column;gap:6px;min-width:0;width:100%}
.pj-field-row{display:flex;align-items:center;gap:8px;min-width:0;width:100%}
.pj-field-row > button{flex:none;white-space:nowrap}
.pj-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;width:100%;min-width:0}
.pj-label{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.pj-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.pj-textarea,.pj-select{display:block;box-sizing:border-box;width:100%;max-width:100%;min-width:0;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-panel-solid);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:8px 12px}
.pj-textarea{min-height:92px;resize:vertical}
.pj-textarea-tall{min-height:260px;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px}
.pj-select{height:36px;padding:0 10px}
.pj-textarea:focus-visible,.pj-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.pj-path-box{box-sizing:border-box;flex:1 1 0;min-width:0;max-width:100%;height:36px;display:flex;align-items:center;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden}
.pj-path-box.pj-empty-path{color:var(--dsw-alias-label-tertiary)}
.pj-path-text{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-switch-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:8px 0}
.pj-switch-copy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.pj-danger-zone{margin-top:8px;padding-top:16px;border-top:0.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l2))}
.pj-danger-title{margin:0 0 6px;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-state-error-primary)}
.pj-danger-btn{color:var(--dsw-alias-state-error-primary)}

/* Two-Column Settings Shell (inside headless Modal) */
.pj-settings-modal{width:min(780px,calc(100vw - 32px));height:min(680px,calc(100vh - 48px));max-height:calc(100vh - 48px);padding:0;overflow:hidden;background:var(--dsw-alias-bg-panel-solid)}
.pj-settings-grid{display:grid;grid-template-columns:188px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);grid-template-areas:"title head" "nav body";width:100%;height:100%;min-height:0}
.pj-settings-title{grid-area:title;margin:0;padding:18px 12px 10px 20px;font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.pj-settings-head{grid-area:head;display:flex;align-items:center;justify-content:flex-end;padding:12px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.pj-settings-nav{grid-area:nav;display:flex;flex-direction:column;gap:4px;padding:12px;border-right:1px solid var(--dsw-alias-border-l2);overflow-y:auto}
.pj-settings-nav-btn{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 12px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:400;text-align:left;cursor:pointer}
.pj-settings-nav-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.pj-settings-nav-btn.pj-active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}
.pj-settings-body{grid-area:body;min-width:0;min-height:0;overflow-y:auto;padding:16px 20px 24px;display:flex;flex-direction:column;gap:16px}
.pj-section{display:flex;flex-direction:column;gap:10px;padding-bottom:16px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.pj-section:last-child{border-bottom:0;padding-bottom:0}
.pj-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pj-section-title{margin:0;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}

/* Shared Memory List & Progress */
.pj-budget-bar{width:100%;height:6px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.pj-budget-fill{height:100%;background:var(--dsw-alias-state-business-primary);transition:width var(--ds-transition-duration) var(--ds-ease-in-out)}
.pj-budget-fill.pj-over{background:var(--dsw-alias-state-warn-primary)}
.pj-memory-list{display:flex;flex-direction:column;gap:4px}
.pj-memory-row{display:flex;flex-direction:column;gap:2px;width:100%;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-memory-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pj-memory-row-head{display:flex;align-items:center;gap:6px;min-width:0}
.pj-memory-row-name{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-memory-row-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-memory-row-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.pj-memory-body-pre{margin:0;padding:12px;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow-y:auto}
.pj-empty{padding:24px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;display:flex;flex-direction:column;align-items:center;gap:12px}

/* Fallback switch when primitive unavailable */
.pj-switch-fallback{position:relative;display:inline-flex;align-items:center;width:36px;height:20px;padding:0;border:0;border-radius:14px;background:var(--dsw-alias-border-l3);cursor:pointer;flex:none;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-switch-fallback[aria-checked='true']{background:var(--dsw-alias-state-business-primary)}
.pj-switch-fallback-thumb{position:absolute;left:2px;width:16px;height:16px;border-radius:14px;background:var(--dsw-alias-label-primary-foreground);transition:transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.pj-switch-fallback[aria-checked='true'] .pj-switch-fallback-thumb{transform:translateX(16px)}

@media (max-width: 640px){
  .pj-settings-grid{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto minmax(0,1fr);grid-template-areas:"title head" "nav nav" "body body"}
  .pj-settings-nav{flex-direction:row;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2);padding:8px 12px}
  .pj-field-grid{grid-template-columns:minmax(0,1fr)}
}
@media (prefers-reduced-motion: reduce){
  .pj-page *,.pj-dispatch-card{transition:none !important;animation:none !important}
}
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
        throw failure
      }
      return payload
    }

    /**
     * Subscribe to `/projects-api/events` SSE stream with exponential-backoff
     * reconnect and visibility recovery. Calls `onUpdate(payload)` on each
     * server push and `onReconnect()` after a reconnect so no change is missed.
     */
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
     * Compute three-column collapsed states and pixel widths purely from the
     * observed container width (via ResizeObserver), independent of viewport width.
     */
    function computeColumnLayout({
      containerWidth,
      listChoice,
      execChoice,
      execForceOpen = false,
      lastOpenedSide = 'exec',
      listWidth,
      execWidth,
    }) {
      const w = Number(containerWidth) || 0
      let listCollapsed = listChoice === '1' || (listChoice !== '0' && w > 0 && w < LIST_FOLD_BELOW)
      let execCollapsed = !execForceOpen && (execChoice === '1' || (execChoice !== '0' && w > 0 && w < EXEC_FOLD_BELOW))

      // Never allow both side columns to squeeze the middle Coordinator column
      // below MAIN_MIN_WIDTH (400px); auto-fold the other side to its 44px rail.
      if (w > 0 && !listCollapsed && !execCollapsed && w < EXEC_FOLD_BELOW) {
        if (execForceOpen || lastOpenedSide === 'exec') listCollapsed = true
        else execCollapsed = true
      }

      const listSpan = listCollapsed ? RAIL_WIDTH : listWidth
      const execSpan = execCollapsed ? RAIL_WIDTH : execWidth
      if (!(w > 0) || (listCollapsed && execCollapsed)) {
        return { listCollapsed, execCollapsed, list: listSpan, exec: execSpan }
      }
      const separators = (listCollapsed ? 0 : RESIZER_WIDTH) + (execCollapsed ? 0 : RESIZER_WIDTH)
      const room = w - MAIN_MIN_WIDTH - separators
      if (listCollapsed) {
        const maxExec = Math.max(0, room - RAIL_WIDTH)
        const exec = maxExec >= EXEC_MIN_WIDTH ? clamp(execWidth, EXEC_MIN_WIDTH, maxExec) : Math.max(200, maxExec)
        return { listCollapsed, execCollapsed, list: RAIL_WIDTH, exec }
      }
      if (execCollapsed) {
        const maxList = Math.max(0, room - RAIL_WIDTH)
        const list = maxList >= LIST_MIN_WIDTH ? clamp(listWidth, LIST_MIN_WIDTH, maxList) : Math.max(160, maxList)
        return { listCollapsed, execCollapsed, list, exec: RAIL_WIDTH }
      }
      if (listWidth + execWidth <= room) {
        return { listCollapsed, execCollapsed, list: listWidth, exec: execWidth }
      }
      const spare = Math.max(0, room - LIST_MIN_WIDTH - EXEC_MIN_WIDTH)
      const excess = (listWidth - LIST_MIN_WIDTH) + (execWidth - EXEC_MIN_WIDTH)
      const scale = excess > 0 ? Math.min(1, spare / excess) : 0
      const list = LIST_MIN_WIDTH + Math.round((listWidth - LIST_MIN_WIDTH) * scale)
      return { listCollapsed, execCollapsed, list, exec: Math.max(EXEC_MIN_WIDTH, room - list) }
    }

    function columnDragCeiling({ containerWidth, layout, which }) {
      const w = Number(containerWidth) || 0
      if (!(w > 0)) return 680
      const other = which === 'list' ? layout.exec : layout.list
      const separators = (layout.listCollapsed ? 0 : RESIZER_WIDTH) + (layout.execCollapsed ? 0 : RESIZER_WIDTH)
      const floor = which === 'list' ? LIST_MIN_WIDTH : EXEC_MIN_WIDTH
      return Math.max(floor, Math.round(w - MAIN_MIN_WIDTH - other - separators))
    }

    function shortPath(workspace) {
      const raw = String(workspace || '').trim().replace(/[\\/]+$/, '')
      if (!raw) return ''
      const parts = raw.split(/[\\/]/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : raw
    }

    function initialOf(name) {
      const value = String(name || '').trim()
      return value ? Array.from(value)[0].toUpperCase() : '·'
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
      if (branch) chips.push({ key: 'branch', text: branch, kind: 'branch' })
      if (project && project.autonomy === 'manual' && task && !task.approved && task.status === 'queued') {
        chips.push({ key: 'approval', text: t('needsApproval'), kind: 'warn' })
      }
      const model = String((task && task.model) || '').trim()
      if (model) chips.push({ key: 'model', text: model.split('/').pop() || model, kind: 'default' })
      if (task && task.id) chips.push({ key: 'id', text: String(task.id).slice(0, 10), kind: 'default' })
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

    /** First user message sent when starting a fresh coordinator session (board snapshot only; rules live in system prompt). */
    function coordinatorBoard(project) {
      const tasks = (project && project.tasks) || []
      const open = tasks.filter((task) => task.status !== 'resolved')
      const tally = {}
      for (const task of tasks) tally[task.status] = (tally[task.status] || 0) + 1
      const countsText =
        ['running', 'review', 'queued', 'failed', 'blocked', 'resolved']
          .filter((status) => (tally[status] || 0) > 0)
          .map((status) => `${tally[status]} ${status}`)
          .join(', ') || 'none'
      const taskLines = open.length
        ? open.map((task) => `- ${task.id} [${task.status}] ${task.title}`).join('\n')
        : tasks.length === 0
          ? '(none yet)'
          : '(no open tasks)'
      const resolvedNote = tally.resolved > 0
        ? `${tally.resolved} resolved task(s) are not listed here; read their output with projects_get and include_resolved: true.`
        : ''
      return [
        `The board of the DSH project "${project.name}" (project_id: ${project.id}).`,
        '',
        '## Project instructions',
        (project.goal && project.goal.trim()) || '(none)',
        '',
        '## Current tasks',
        `counts: ${countsText}`,
        taskLines,
        ...(resolvedNote ? [resolvedNote] : []),
      ].join('\n')
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

    const UIModal = Primitives.Modal || function FallbackModal({ open, title, closeLabel, onClose, children, footer, headless }) {
      if (!open) return null
      return h(
        'div',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, className: 'pj-modal-solid' },
        headless
          ? children
          : h(
              Fragment,
              null,
              h('div', null, h('h2', null, title), closeLabel && h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel)),
              children,
              footer,
            ),
      )
    }

    const UIPill = Primitives.Pill || function FallbackPill({ active, onClick, children, ...rest }) {
      return onClick
        ? h('button', { type: 'button', 'aria-pressed': active, onClick, ...rest }, children)
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
            'aria-selected': value === item.value,
            'aria-controls': item.panelId,
            onClick: () => onChange(item.value),
          }, item.label),
        ),
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

    /** Hand-drawn 24x24 stacked-card outline glyph for `sidebar.panellist`. */
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
      // Minimal 16px SVG fallbacks when running under lightweight unit mocks.
      const props = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }
      const s = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }
      if (name === 'IconPlusOutlineRegular') return h('svg', props, h('path', { d: 'M8 2.5v11M2.5 8h11', ...s }))
      if (name === 'IconCloseOutline16' || name === 'IconCloseOutlineRegular') return h('svg', props, h('path', { d: 'M3 3l10 10M13 3L3 13', ...s }))
      if (name === 'IconCheckOutlineRegular') return h('svg', props, h('path', { d: 'M3.2 8.4l3 3 6.6-6.6', ...s }))
      if (name === 'IconPanelRightOutline16') return h('svg', props, h('rect', { x: 1.5, y: 1.5, width: 13, height: 13, rx: 1.5, ...s }), h('path', { d: 'M10.5 1.5v13', ...s }))
      if (name === 'IconPanelLeftOutlineRegular') return h('svg', props, h('rect', { x: 1.5, y: 1.5, width: 13, height: 13, rx: 1.5, ...s }), h('path', { d: 'M5.5 1.5v13', ...s }))
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
      if (name === 'IconChevronLeftOutlineRegular') return h('svg', props, h('path', { d: 'M9.5 3.5L5 8l4.5 4.5', ...s }))
      if (name === 'IconChevronRightOutlineRegular') return h('svg', props, h('path', { d: 'M6.5 3.5L11 8l-4.5 4.5', ...s }))
      if (name === 'IconChevronDownOutlineRegular') return h('svg', props, h('path', { d: 'M3.5 6.5L8 11l4.5-4.5', ...s }))
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
        return h(
          'span',
          { className: `pj-glyph pj-glyph-review ${className || ''}` },
          h(UIStateDot, { state: 'done', size: 10 }),
        )
      }
      if (status === 'failed') {
        return h(
          'span',
          { className: `pj-glyph pj-glyph-failed ${className || ''}` },
          h(UIStateDot, { state: 'error', size: 10 }),
        )
      }
      if (status === 'blocked' || status === 'waiting') {
        return h(
          'span',
          { className: `pj-glyph pj-glyph-waiting ${className || ''}` },
          h(UIStateDot, { state: 'warning', size: 10 }),
        )
      }
      if (status === 'resolved') {
        return h(
          'span',
          { className: `pj-glyph pj-glyph-resolved ${className || ''}` },
          h(UIStateDot, { state: 'done', appearance: 'step', size: 14 }),
        )
      }
      return h(
        'span',
        { className: `pj-glyph pj-glyph-idle ${className || ''}` },
        h(UIStateDot, { state: 'idle', size: 10 }),
      )
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
      const { sessionId, useSession, useConversation, useSessions, renderFactorySlot } = props
      const session = useSession((value) => value)
      const conversation = typeof useConversation === 'function' ? useConversation((value) => value) : undefined
      const active = (conversation && conversation.activeTargets && conversation.activeTargets.size > 0)
        || (session && !session.blank && !session.awaitingFirstTurn)
        || Boolean(session && session.running)
      const phase = active ? 'active' : (session && session.promptAttempted) ? 'engaging' : 'blank'
      const summaryBlank = typeof useSessions === 'function' ? useSessions((state) => state?.byId?.[sessionId]?.blank) : undefined
      const settling = phase === 'blank' && session && session.openState === 'loading' && summaryBlank !== true
      const hero = phase === 'blank' && ((session && session.openState === 'open') || summaryBlank === true)
      const resolved = settling ? 'settling' : hero ? 'hero' : 'active'
      return renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: resolved, hero },
        { slots: { views: FixedChatView } },
      )
    }

    function EmbeddedConversation(props) {
      if (typeof props.useSession !== 'function' || typeof props.renderFactorySlot !== 'function') {
        return h('div', { className: 'pj-empty' }, 'The conversation surface is unavailable.')
      }
      return h(ConversationContentHost, props)
    }

    /** `tool.call.toolview` card for `projects_dispatch` calls inside coordinator chat. */
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
          branch && h('span', { className: 'pj-chip pj-chip-branch' }, branch),
          stamp && h('span', { className: 'pj-dispatch-time' }, stamp),
          h(StatusBadge, { status, t }),
        ),
      )
    }

    // =========================================================================
    // Section 7: Focused Column & Detail Sub-Components
    // =========================================================================

    function ProjectListColumn({
      projects,
      selectedId,
      collapsed,
      width,
      busy,
      onSelect,
      onNewProject,
      onToggleCollapse,
      newProjectBtnRef,
      t,
    }) {
      const [archivedOpen, setArchivedOpen] = useState(false)
      const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects])
      const archivedProjects = useMemo(() => projects.filter((p) => p.archived), [projects])

      if (collapsed) {
        return h(
          'aside',
          { className: 'pj-list pj-collapsed', 'aria-label': t('projects') },
          h(
            'div',
            { className: 'pj-rail' },
            h(
              UITooltip,
              { label: t('expandList'), side: 'right', portal: true },
              h(
                'button',
                {
                  type: 'button',
                  className: 'pj-rail-btn',
                  'aria-label': t('expandList'),
                  'aria-expanded': 'false',
                  onClick: onToggleCollapse,
                },
                h(Icon, { name: 'IconPanelLeftOutlineRegular', size: 16 }),
              ),
            ),
            h(
              UITooltip,
              { label: t('newProject'), side: 'right', portal: true },
              h(
                'button',
                {
                  type: 'button',
                  ref: newProjectBtnRef,
                  className: 'pj-rail-btn',
                  'aria-label': t('newProject'),
                  disabled: busy,
                  onClick: onNewProject,
                },
                h(Icon, { name: 'IconPlusOutlineRegular', size: 16 }),
              ),
            ),
            activeProjects.length > 0 && h('div', { className: 'pj-rail-sep' }),
            activeProjects.map((entry) =>
              h(
                UITooltip,
                { key: entry.id, label: entry.name, side: 'right', portal: true },
                h(
                  'button',
                  {
                    type: 'button',
                    className: `pj-rail-btn${entry.id === selectedId ? ' pj-active' : ''}`,
                    'aria-label': entry.name,
                    'aria-current': entry.id === selectedId ? 'true' : undefined,
                    onClick: () => onSelect(entry),
                  },
                  initialOf(entry.name),
                ),
              ),
            ),
          ),
        )
      }

      const renderRow = (entry) =>
        h(
          'button',
          {
            key: entry.id,
            type: 'button',
            className: `pj-list-item${entry.id === selectedId ? ' pj-active' : ''}`,
            'aria-current': entry.id === selectedId ? 'true' : undefined,
            onClick: () => onSelect(entry),
          },
          h(
            'div',
            { className: 'pj-list-row-top' },
            h('span', { className: 'pj-list-name' }, entry.name),
            entry.paused && !entry.archived && h(UITag, { tone: 'warning' }, t('pausedBadge')),
            entry.archived && h(UITag, { tone: 'neutral' }, t('archivedBadge')),
          ),
          entry.workspace && h('span', { className: 'pj-list-dir', title: entry.workspace }, shortPath(entry.workspace)),
          h('span', { className: 'pj-list-meta' }, countsLine(entry, t)),
        )

      return h(
        'aside',
        { className: 'pj-list', style: { width: `${width}px`, flexBasis: `${width}px` }, 'aria-label': t('projects') },
        h(
          'div',
          { className: 'pj-col-head' },
          h('h2', { className: 'pj-col-title' }, t('projects')),
          h(
            'div',
            { className: 'pj-head-actions' },
            h(
              UITooltip,
              { label: t('newProject'), side: 'bottom', portal: true },
              h(
                'button',
                {
                  type: 'button',
                  ref: newProjectBtnRef,
                  className: 'pj-icon-btn',
                  'aria-label': t('newProject'),
                  disabled: busy,
                  onClick: onNewProject,
                },
                h(Icon, { name: 'IconPlusOutlineRegular', size: 16 }),
              ),
            ),
            h(
              UITooltip,
              { label: t('collapseList'), side: 'bottom', portal: true },
              h(
                'button',
                {
                  type: 'button',
                  className: 'pj-icon-btn',
                  'aria-label': t('collapseList'),
                  'aria-expanded': 'true',
                  onClick: onToggleCollapse,
                },
                h(Icon, { name: 'IconPanelLeftOutlineRegular', size: 16 }),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'pj-list-scroll' },
          activeProjects.length === 0 && archivedProjects.length === 0
            ? h(
                'div',
                { className: 'pj-empty' },
                h('div', null, t('noProjects')),
                h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', onClick: onNewProject }, t('newProject')),
              )
            : activeProjects.map(renderRow),
        ),
        archivedProjects.length > 0 &&
          h(
            'div',
            { className: 'pj-archived-fold' },
            h(
              'button',
              {
                type: 'button',
                className: 'pj-archived-toggle',
                'aria-expanded': archivedOpen ? 'true' : 'false',
                onClick: () => setArchivedOpen((v) => !v),
              },
              h(Icon, { name: archivedOpen ? 'IconChevronDownOutlineRegular' : 'IconChevronRightOutlineRegular', size: 14 }),
              h('span', null, `${t('archivedProjects')} (${archivedProjects.length})`),
            ),
            archivedOpen && h('div', { className: 'pj-archived-list' }, archivedProjects.map(renderRow)),
          ),
      )
    }

    function CoordinatorColumn({
      project,
      thread,
      coordinatorArchived,
      busy,
      onOpenWorkspace,
      onToggleAutonomy,
      onTogglePaused,
      onOpenSettings,
      onStartCoordinator,
      onRestoreCoordinator,
      settingsBtnRef,
      SessionProvider,
      renderSlot,
      t,
    }) {
      return h(
        'section',
        { className: 'pj-main', 'aria-label': project ? project.name : t('title') },
        h(
          'header',
          { className: 'pj-main-head' },
          h(
            'div',
            { className: 'pj-main-head-left' },
            h('h1', { className: 'pj-main-title', title: project ? project.name : t('title') }, project ? project.name : t('title')),
            project && project.archived && h(UITag, { tone: 'neutral' }, t('archivedBadge')),
            project && project.workspace &&
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
                  h('span', { className: 'pj-ws-pill' }, shortPath(project.workspace)),
                ),
              ),
          ),
          project &&
            h(
              'div',
              { className: 'pj-main-head-right' },
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
                  project.autonomy === 'auto' ? t('autonomyAuto') : t('autonomyManual'),
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
                  project.paused ? t('resumeProject') : t('pauseProject'),
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
            ),
        ),
        coordinatorArchived &&
          h(
            'div',
            { className: 'pj-banner', role: 'status' },
            h('span', null, t('coordinatorArchived')),
            h(UIButton, { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy, onClick: onRestoreCoordinator }, t('restore')),
          ),
        h(
          'div',
          { className: 'pj-main-body' },
          !project
            ? h('div', { className: 'pj-empty' }, t('noSelection'))
            : thread && thread.reference
              ? h(
                  'div',
                  { className: 'pj-chat-host' },
                  h(
                    EmbeddedBoundary,
                    { fallback: h('div', { className: 'pj-empty' }, t('coordinatorChatFailed')) },
                    typeof SessionProvider === 'function' && typeof renderSlot === 'function'
                      ? h(SessionProvider, { session: thread.reference }, renderSlot('projects.conversation', {}))
                      : h('div', { className: 'pj-empty' }, t('coordinatorChatFailed')),
                  ),
                )
              : h(
                  'div',
                  { className: 'pj-start-hero' },
                  project.goal && project.goal.trim() && h('div', { className: 'pj-start-goal' }, project.goal.trim()),
                  h('p', { className: 'pj-hint' }, t('startCoordinatorHint')),
                  h(
                    UIButton,
                    {
                      variant: 'primary',
                      size: 'md',
                      shape: 'pill',
                      loading: busy,
                      disabled: busy || project.archived,
                      title: project.archived ? t('archivedHint') : undefined,
                      onClick: onStartCoordinator,
                    },
                    t('startCoordinator'),
                  ),
                ),
        ),
      )
    }

    function TaskDiffPanel({ projectId, task, refreshToken, onMerge, onCleanup, busy, t }) {
      const [loading, setLoading] = useState(true)
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const seqRef = useRef(0)

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
      }, [fetchDiff, refreshToken])

      const hasWorktree = Boolean((task && (task.worktreePath || task.branch)) || (data && data.worktreePath))
      const files = (data && Array.isArray(data.files)) ? data.files : []
      const diffText = (data && typeof data.diff === 'string') ? data.diff : ''

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
            'span',
            { className: 'pj-hint' },
            files.length > 0 ? `${files.length} ${t('diffFilesCount')}` : (data && data.baseRef ? `base: ${data.baseRef}` : t('tabDiff')),
          ),
          h(
            'div',
            { className: 'pj-head-actions' },
            hasWorktree &&
              h(
                UIButton,
                { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy || loading, onClick: onMerge },
                t('worktreeMerge'),
              ),
            hasWorktree &&
              h(
                UIButton,
                { variant: 'outline', size: 'sm', shape: 'pill', disabled: busy || loading, onClick: onCleanup },
                t('worktreeCleanup'),
              ),
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
              h(Icon, { name: 'IconRefreshOutlineRegular', size: 15 }),
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
                                'span',
                                { className: 'pj-diff-counts' },
                                typeof file.additions === 'number' && file.additions > 0 && h('span', { className: 'pj-diff-add' }, `+${file.additions}`),
                                typeof file.deletions === 'number' && file.deletions > 0 && h('span', { className: 'pj-diff-del' }, `-${file.deletions}`),
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
      const menuRef = useRef(null)
      const [pos, setPos] = useState({ x: menu.x, y: menu.y })
      const [confirming, setConfirming] = useState(false)
      const armedAtRef = useRef(0)
      const armTimerRef = useRef(null)

      useEffect(() => {
        setPos({ x: menu.x, y: menu.y })
        setConfirming(false)
        if (armTimerRef.current !== null) {
          clearTimeout(armTimerRef.current)
          armTimerRef.current = null
        }
      }, [menu.x, menu.y, menu.taskId])

      useEffect(() => () => {
        if (armTimerRef.current !== null) {
          clearTimeout(armTimerRef.current)
          armTimerRef.current = null
        }
      }, [])

      useLayoutEffect(() => {
        const node = menuRef.current
        if (!node || typeof node.getBoundingClientRect !== 'function') return
        const rect = node.getBoundingClientRect()
        const vw = typeof document !== 'undefined' && document.documentElement ? document.documentElement.clientWidth : 0
        const vh = typeof document !== 'undefined' && document.documentElement ? document.documentElement.clientHeight : 0
        if (!(vw > 0 && vh > 0)) return
        const x = clamp(menu.x, MENU_MARGIN, vw - rect.width - MENU_MARGIN)
        const y = clamp(menu.y, MENU_MARGIN, vh - rect.height - MENU_MARGIN)
        if (x !== pos.x || y !== pos.y) setPos({ x, y })
      }, [menu.x, menu.y, confirming])

      useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onPointerDown = (event) => {
          if (menuRef.current && typeof menuRef.current.contains === 'function' && menuRef.current.contains(event.target)) return
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
      }, [onClose])

      if (!task) return null
      const accepted = task.status === 'resolved'
      const canArchive = Boolean(task.childSessionId)

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
        onDelete(task.id, { archive })
      }

      return h(
        'div',
        {
          ref: menuRef,
          className: 'pj-ctx-menu',
          role: 'menu',
          'aria-label': t('taskActions'),
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
            onClick: () => { onClose(); onResolve(task) },
          },
          h('span', { className: 'pj-menu-icon' }, h(Icon, { name: 'IconCheckOutlineRegular', size: 14 })),
          h('span', null, accepted ? t('unresolve') : t('resolve')),
        ),
        task.status === 'running' &&
          h(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              className: 'pj-menu-row',
              disabled: busy,
              onClick: () => { onClose(); onStop(task) },
            },
            h('span', { className: 'pj-menu-icon' }, h(Icon, { name: 'IconStopFillRegular', size: 14 })),
            h('span', null, t('stop')),
          ),
        (task.status === 'failed' || task.status === 'blocked') &&
          h(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              className: 'pj-menu-row',
              disabled: busy,
              onClick: () => { onClose(); onRetry(task) },
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

    function ThreadsColumn({
      project,
      catalog,
      collapsed,
      width,
      busy,
      execTarget,
      diffRefreshToken,
      onToggleCollapse,
      onSelectTask,
      onCloseDetail,
      onApproveTask,
      onStopTask,
      onRetryTask,
      onResolveTask,
      onDeleteTask,
      onCopyBranch,
      onRequestMergeWorktree,
      onRequestCleanupWorktree,
      SessionProvider,
      renderSlot,
      activeLocale,
      t,
    }) {
      const [searchOpen, setSearchOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [filterOpen, setFilterOpen] = useState(false)
      const [hiddenGroups, setHiddenGroups] = useState({})
      const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedGroups)
      const [detailTab, setDetailTab] = useState('chat')
      const [menu, setMenu] = useState(null)
      const searchRef = useRef(null)
      const filterWrapRef = useRef(null)

      useEffect(() => {
        writeStored('collapsedGroups', JSON.stringify(collapsedGroups))
      }, [collapsedGroups])

      useEffect(() => {
        setDetailTab('chat')
      }, [execTarget && execTarget.taskId])

      useEffect(() => {
        setFilterOpen(false)
        setHiddenGroups({})
        setMenu(null)
      }, [project && project.id])

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

      const taskList = (project && project.tasks) || []
      const execTask = execTarget ? taskList.find((item) => item.id === execTarget.taskId) || null : null

      if (collapsed) {
        return h(
          'aside',
          { className: 'pj-exec pj-collapsed', 'aria-label': t('threads') },
          h(
            'div',
            { className: 'pj-rail' },
            h(
              UITooltip,
              { label: t('expandThreads'), side: 'left', portal: true },
              h(
                'button',
                {
                  type: 'button',
                  className: 'pj-rail-btn',
                  'aria-label': t('expandThreads'),
                  'aria-expanded': 'false',
                  onClick: onToggleCollapse,
                },
                h(Icon, { name: 'IconPanelRightOutline16', size: 16 }),
              ),
            ),
            taskList.length > 0 &&
              h(
                UITooltip,
                { label: `${taskList.length} ${t('counts')}`, side: 'left', portal: true },
                h('span', { className: 'pj-rail-count' }, String(taskList.length)),
              ),
          ),
        )
      }

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

      if (execTarget && project) {
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
          'aside',
          { className: 'pj-exec', style: { width: `${width}px`, flexBasis: `${width}px` }, 'aria-label': t('threads') },
          h(
            'div',
            { className: 'pj-detail-shell' },
            h(
              'header',
              { className: 'pj-detail-head' },
              h(
                'div',
                { className: 'pj-detail-row' },
                h(
                  UIButton,
                  {
                    variant: 'ghost',
                    size: 'sm',
                    icon: h(Icon, { name: 'IconChevronLeftOutlineRegular', size: 14 }),
                    onClick: onCloseDetail,
                  },
                  t('threads'),
                ),
                h('span', { className: 'pj-detail-title', title: (execTask && execTask.title) || execTarget.title }, (execTask && execTask.title) || execTarget.title),
                execTask && h(StatusBadge, { status: execTask.status, t }),
              ),
              execTask &&
                h(
                  'div',
                  { className: 'pj-detail-row' },
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
              metaParts.length > 0 &&
                h(
                  'div',
                  { className: 'pj-detail-meta' },
                  h('span', null, metaParts.join(' · ')),
                  execTask && execTask.approved && h(UITag, { tone: 'neutral' }, t('approvedBadge')),
                ),
              (branch || wtNote) &&
                h(
                  'div',
                  { className: 'pj-detail-branch-row' },
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
                ),
              execTask &&
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
                                h('div', { className: 'pj-label', style: { marginBottom: '6px' } }, t('taskBriefHeading')),
                                execTask.brief,
                              ),
                            h('div', { className: 'pj-empty' }, t('noConversation')),
                          ),
                    ),
            ),
          ),
        )
      }

      return h(
        'aside',
        { className: 'pj-exec', style: { width: `${width}px`, flexBasis: `${width}px` }, 'aria-label': t('threads') },
        h(
          'header',
          { className: 'pj-col-head' },
          h('h2', { className: 'pj-col-title' }, t('threads')),
          h(
            'div',
            { className: 'pj-head-actions' },
            project &&
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
                  h(Icon, { name: 'IconSearchOutlineRegular', size: 16 }),
                ),
              ),
            project &&
              h(
                'div',
                { ref: filterWrapRef, className: 'pj-filter-wrap' },
                h(
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
                    h(Icon, { name: 'IconSlidersTwoOutlineRegular', size: 16 }),
                  ),
                ),
                filterOpen &&
                  h(
                    'div',
                    { className: 'pj-popover-menu', role: 'menu', 'aria-label': t('filterGroups') },
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
              ),
            h(
              UITooltip,
              { label: t('collapseThreads'), side: 'bottom', portal: true },
              h(
                'button',
                {
                  type: 'button',
                  className: 'pj-icon-btn',
                  'aria-label': t('collapseThreads'),
                  'aria-expanded': 'true',
                  onClick: onToggleCollapse,
                },
                h(Icon, { name: 'IconPanelRightOutline16', size: 16 }),
              ),
            ),
          ),
        ),
        project && searchOpen &&
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
        !project
          ? null
          : h(
              'div',
              { className: 'pj-exec-scroll' },
              taskList.length === 0
                ? h('div', { className: 'pj-empty' }, t('emptyTasks'))
                : groups.length === 0
                  ? h('div', { className: 'pj-empty' }, t('noMatches'))
                  : groups.map((group) => {
                      const folded = Boolean(collapsedGroups[group.key])
                      return h(
                        'div',
                        { key: group.key, className: 'pj-group' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'pj-group-btn',
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
                                    setMenu({ taskId: task.id, x: e.clientX || 0, y: e.clientY || 0 })
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
                                          title: chip.text,
                                        },
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
        menu &&
          h(TaskContextMenu, {
            menu,
            task: taskList.find((item) => item.id === menu.taskId) || null,
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
        autonomy: 'manual',
        concurrency: 3,
        worktreeIsolation: false,
      })

      useEffect(() => {
        if (open) {
          setForm({ name: '', goal: '', workspace: '', autonomy: 'manual', concurrency: 3, worktreeIsolation: false })
        }
      }, [open])

      const chooseDir = async () => {
        const dir = await pickFolder()
        if (dir) setForm((cur) => ({ ...cur, workspace: dir }))
      }

      const submit = () => {
        onCreate({
          name: form.name.trim(),
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
        className: 'pj-modal-solid pj-modal-form',
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
            h('span', { className: 'pj-label' }, t('projectName')),
            h(UIInput, {
              variant: 'form',
              'data-modal-autofocus': '',
              'aria-label': t('projectName'),
              placeholder: t('projectNamePlaceholder'),
              value: form.name,
              onChange: (e) => setForm((cur) => ({ ...cur, name: e.target.value })),
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
              h(UISegmentedTabs, {
                size: 'sm',
                label: t('autonomy'),
                value: form.autonomy,
                onChange: (v) => setForm((cur) => ({ ...cur, autonomy: v })),
                items: [
                  { value: 'manual', label: t('autonomyManual'), id: 'pj-new-auto-manual', panelId: 'pj-new-auto-manual-p' },
                  { value: 'auto', label: t('autonomyAuto'), id: 'pj-new-auto-auto', panelId: 'pj-new-auto-auto-p' },
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
      goalText,
      goalDirty,
      busy,
      onGoalChange,
      onSaveGoal,
      onPatchProject,
      onChooseWorkspace,
      onClearWorkspace,
      onArchiveToggle,
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

      const renderGeneral = () =>
        h(
          Fragment,
          null,
          h(
            'div',
            { className: 'pj-section' },
            h('div', { className: 'pj-section-head' }, h('h3', { className: 'pj-section-title' }, t('project'))),
            h(
              'label',
              { className: 'pj-field' },
              h('span', { className: 'pj-label' }, t('projectName')),
              h(UIInput, {
                variant: 'form',
                key: `${project.id}:${project.name}`,
                defaultValue: project.name,
                'aria-label': t('projectName'),
                disabled: busy,
                onBlur: (e) => {
                  const val = e.target.value.trim()
                  if (val && val !== project.name) onPatchProject({ name: val })
                },
              }),
            ),
          ),
          h(
            'div',
            { className: 'pj-section' },
            h(
              'div',
              { className: 'pj-section-head' },
              h('h3', { className: 'pj-section-title' }, t('instructions')),
              h(
                'div',
                { className: 'pj-head-actions' },
                goalDirty && h(UITag, { tone: 'warning' }, t('unsavedTag')),
                h(UIButton, { variant: 'primary', size: 'sm', shape: 'pill', disabled: busy || !goalDirty, onClick: onSaveGoal }, t('save')),
              ),
            ),
            h('p', { className: 'pj-hint' }, t('instructionsHint')),
            h('textarea', {
              className: 'pj-textarea',
              'aria-label': t('instructions'),
              placeholder: t('instructionsPlaceholder'),
              value: goalText,
              onChange: (e) => onGoalChange(e.target.value),
            }),
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
                h(UISegmentedTabs, {
                  size: 'sm',
                  label: t('autonomy'),
                  value: project.autonomy === 'auto' ? 'auto' : 'manual',
                  onChange: (val) => onPatchProject({ autonomy: val }),
                  items: [
                    { value: 'manual', label: t('autonomyManual'), id: 'pj-set-auto-manual', panelId: 'pj-set-auto-manual-p' },
                    { value: 'auto', label: t('autonomyAuto'), id: 'pj-set-auto-auto', panelId: 'pj-set-auto-auto-p' },
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
                'label',
                { className: 'pj-field' },
                h('span', { className: 'pj-label' }, t('model')),
                catalog.enumerable
                  ? h(
                      'select',
                      {
                        className: 'pj-select',
                        'aria-label': t('model'),
                        value: project.model || '',
                        disabled: busy,
                        onChange: (e) => onPatchProject({ model: e.target.value }),
                      },
                      h('option', { value: '' }, t('modelDefault')),
                      ...(catalog.models || []).map((m) => h('option', { key: m.id, value: m.id }, m.label || m.id)),
                      project.model && !(catalog.models || []).some((m) => m.id === project.model)
                        ? h('option', { value: project.model }, project.model)
                        : null,
                    )
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
                'label',
                { className: 'pj-field' },
                h('span', { className: 'pj-label' }, t('reasoningEffort')),
                catalog.enumerable
                  ? h(
                      'select',
                      {
                        className: 'pj-select',
                        'aria-label': t('reasoningEffort'),
                        value: project.reasoningEffort || '',
                        disabled: busy,
                        onChange: (e) => onPatchProject({ reasoningEffort: e.target.value }),
                      },
                      h('option', { value: '' }, t('effortDefault')),
                      ...effortsFor(catalog, project.model).map((ef) =>
                        h('option', { key: ef.id, value: ef.id }, ef.name || effortLabel(catalog, project.model, ef.id, t)),
                      ),
                      project.reasoningEffort && !effortsFor(catalog, project.model).some((ef) => ef.id === project.reasoningEffort)
                        ? h('option', { value: project.reasoningEffort }, project.reasoningEffort)
                        : null,
                    )
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
            h('p', { className: 'pj-hint', style: { marginBottom: '10px' } }, t('archiveWarning')),
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
                      { variant: 'outline', size: 'sm', shape: 'pill', className: 'pj-danger-btn', disabled: busy, onClick: handleArchiveClick },
                      t('archive'),
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
              h('div', { className: `pj-budget-fill${totalChars > budget ? ' pj-over' : ''}`, style: { width: `${pct}%` } }),
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
        onClose: archiveArmed ? () => {} : onClose,
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
              { type: 'button', className: 'pj-icon-btn', 'aria-label': t('close'), onClick: onClose },
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
        className: 'pj-modal-solid pj-modal-wide',
        footer,
        children: h(
          'div',
          { className: 'pj-form-stack' },
          h(
            'div',
            { className: 'pj-detail-meta' },
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

      useEffect(() => {
        if (!editor) return
        setName(editor.name || '')
        setDescription(editor.description || '')
        setText(editor.text || '')
      }, [editor && editor.name, editor && editor.isNew, editor && editor.loading])

      if (!editor) return null
      const isNew = Boolean(editor.isNew)

      return h(UIModal, {
        open: Boolean(editor),
        onClose: busy ? () => {} : onClose,
        title: isNew ? t('memoryNewTopic') : editor.name,
        closeLabel: t('close'),
        className: 'pj-modal-solid pj-modal-wide',
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
              onClick: () => onSave({ name: name.trim(), description: description.trim(), type: editor.type || 'reference', text }),
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
              h('span', { className: 'pj-label' }, t('memoryTopicName')),
              h(UIInput, {
                variant: 'form',
                'data-modal-autofocus': '',
                'aria-label': t('memoryTopicName'),
                placeholder: t('memoryTopicNamePlaceholder'),
                value: name,
                onChange: (e) => setName(e.target.value),
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
            h('span', { className: 'pj-label' }, t('memoryBody')),
            h('textarea', {
              className: 'pj-textarea pj-textarea-tall',
              'data-modal-autofocus': isNew ? undefined : '',
              'aria-label': t('memoryBody'),
              placeholder: t('memoryPlaceholder'),
              disabled: busy || editor.loading,
              value: editor.loading ? '' : text,
              onChange: (e) => setText(e.target.value),
            }),
          ),
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
        className: 'pj-modal-solid',
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

    function ProjectsPage({
      translate,
      getLocale,
      localeStore,
      pickFolder,
      threadApi,
      renderSlot,
      SessionProvider,
      useWorkspaces,
    }) {
      useStoreValue(localeStore)
      const t = translate

      const pageRef = useRef(null)
      const newProjectBtnRef = useRef(null)
      const settingsBtnRef = useRef(null)
      const [containerWidth, setContainerWidth] = useState(0)

      const [projects, setProjects] = useState([])
      const [selectedId, setSelectedId] = useState(null)
      const [detail, setDetail] = useState(null)
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState(null)
      const toastSeqRef = useRef(0)

      const [goalText, setGoalText] = useState('')
      const [goalDirty, setGoalDirty] = useState(false)
      const goalDirtyRef = useRef(false)

      const [showNewProject, setShowNewProject] = useState(false)
      const [showSettings, setShowSettings] = useState(false)
      const [memoryPreview, setMemoryPreview] = useState(null)
      const [memoryEditor, setMemoryEditor] = useState(null)
      const [confirmState, setConfirmState] = useState(null)

      const [thread, setThread] = useState(null)
      const [execTarget, setExecTarget] = useState(null)
      const [diffRefreshToken, setDiffRefreshToken] = useState(0)
      const [catalog, setCatalog] = useState({ models: [], enumerable: false, presets: [], presetsEnumerable: false })

      const [listChoice, setListChoice] = useState(() => readStored('listCollapsed', ''))
      const [execChoice, setExecChoice] = useState(() => readStored('execCollapsed', ''))
      const [execForceOpen, setExecForceOpen] = useState(false)
      const [lastOpenedSide, setLastOpenedSide] = useState('exec')
      const [listWidth, setListWidth] = useState(() => readStoredNumber('listWidth', LIST_DEFAULT_WIDTH))
      const [execWidth, setExecWidth] = useState(() => readStoredNumber('execWidth', EXEC_DEFAULT_WIDTH))
      const [resizing, setResizing] = useState(null)

      const selectedRef = useRef(null)
      const listReqSeq = useRef(0)
      const detailReqSeq = useRef(0)
      const pendingOpenRef = useRef(null)

      const showToast = useCallback((text, options = {}) => {
        if (!text) return
        toastSeqRef.current += 1
        setToast({ seq: toastSeqRef.current, text, tone: options.tone, holdMs: options.holdMs })
      }, [])

      useEffect(() => {
        selectedRef.current = selectedId
      }, [selectedId])

      useEffect(() => { writeStored('listCollapsed', listChoice) }, [listChoice])
      useEffect(() => { writeStored('execCollapsed', execChoice) }, [execChoice])

      // Measure the actual Projects container with ResizeObserver (container-aware layout).
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

      // Release retained Session references on switch or unmount.
      useEffect(() => () => { try { thread?.reference?.release?.() } catch {} }, [thread])
      useEffect(() => () => { try { execTarget?.reference?.release?.() } catch {} }, [execTarget])

      const loadProjects = useCallback(async () => {
        const seq = ++listReqSeq.current
        const data = await api('/projects')
        if (seq !== listReqSeq.current) return null
        const list = Array.isArray(data.projects) ? data.projects : []
        setProjects(list)
        return list
      }, [])

      const loadDetail = useCallback(async (id) => {
        if (!id) return null
        const seq = ++detailReqSeq.current
        const data = await api(`/projects/${id}`)
        if (seq !== detailReqSeq.current) return null
        if (selectedRef.current && selectedRef.current !== id) return null
        setDetail(data)
        return data
      }, [])

      const refresh = useCallback(async (preferredId) => {
        const list = await loadProjects()
        if (!list) return
        const target = preferredId
          || (selectedRef.current && list.some((p) => p.id === selectedRef.current) ? selectedRef.current : null)
          || (list.find((p) => !p.archived) || list[0])?.id
          || null
        if (target) {
          selectedRef.current = target
          setSelectedId(target)
          await loadDetail(target)
        } else {
          selectedRef.current = null
          setSelectedId(null)
          setDetail(null)
        }
      }, [loadDetail, loadProjects])

      // Initial load + SSE real-time subscription (zero 4s blind polling).
      useEffect(() => {
        let stopped = false
        let flushTimer = null
        let pendingProjectId = null

        void refresh().catch((err) => {
          if (!stopped) showToast(`${t('errorPrefix')}${messageOf(err)}`, { holdMs: null })
        })

        const scheduleRefresh = (evt) => {
          if (stopped) return
          if (evt && evt.projectId) pendingProjectId = evt.projectId
          if (flushTimer !== null) return
          flushTimer = setTimeout(() => {
            flushTimer = null
            const hinted = pendingProjectId
            pendingProjectId = null
            void loadProjects().then((list) => {
              if (stopped || !list) return
              const activeId = selectedRef.current || (list.find((p) => !p.archived) || list[0])?.id || null
              if (activeId && (!hinted || hinted === activeId)) {
                if (!selectedRef.current) {
                  selectedRef.current = activeId
                  setSelectedId(activeId)
                }
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

      // Load model catalog once per mount.
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
      const coordinatorSessionId = project ? project.coordinatorSessionId : null
      const coordinatorArchived = Boolean(
        coordinatorSessionId && Array.isArray(archivedSessionIds) && archivedSessionIds.includes(coordinatorSessionId),
      )

      // Auto-reopen an already bound coordinator Session on project selection.
      useEffect(() => {
        if (!coordinatorSessionId) {
          setThread((cur) => (cur ? null : cur))
          return undefined
        }
        if (!threadApi || typeof threadApi.ensure !== 'function') return undefined
        if (thread && thread.sessionId === coordinatorSessionId) return undefined
        let cancelled = false
        void (async () => {
          try {
            if (Array.isArray(archivedSessionIds) && archivedSessionIds.includes(coordinatorSessionId)) {
              await threadApi.restoreSession(coordinatorSessionId)
            }
            const res = await threadApi.ensure(project, coordinatorBoard(project), { create: false })
            if (!res) return
            if (cancelled) {
              try { res.reference.release() } catch {}
            } else {
              setThread({ sessionId: res.sessionId, reference: res.reference })
            }
          } catch {}
        })()
        return () => { cancelled = true }
      }, [coordinatorSessionId])

      useEffect(() => {
        if (!coordinatorArchived || !coordinatorSessionId || !threadApi) return
        void threadApi.restoreSession(coordinatorSessionId).catch(() => {})
      }, [coordinatorArchived, coordinatorSessionId])

      // Reset project-local buffers when switching projects.
      useEffect(() => {
        goalDirtyRef.current = false
        setGoalDirty(false)
        setMemoryPreview(null)
        setMemoryEditor(null)
        setExecForceOpen(false)
        setExecTarget((cur) => (cur ? null : cur))
      }, [projectId])

      useEffect(() => {
        if (project && !goalDirtyRef.current) setGoalText(project.goal || '')
      }, [project])

      // Publish live project snapshot for in-chat `projects_dispatch` cards.
      useEffect(() => {
        projectSnapshot.set(project ? { projectId: project.id, project } : null)
      }, [project])
      useEffect(() => () => projectSnapshot.set(null), [])

      const run = useCallback(async (action) => {
        setBusy(true)
        try {
          const msg = await action()
          if (msg) showToast(msg, { tone: 'success' })
        } catch (err) {
          showToast(`${t('errorPrefix')}${messageOf(err)}`, { holdMs: null })
        } finally {
          setBusy(false)
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
        // Ephemerally reveal the Threads column for detail inspection without
        // permanently persisting an override to localStorage.
        setExecForceOpen(true)
        setLastOpenedSide('exec')
        void run(async () => {
          if (!task.childSessionId) {
            setExecTarget({ taskId: task.id, title: task.title, sessionId: '', reference: null })
            return ''
          }
          if (!threadApi || typeof threadApi.retainWorker !== 'function') {
            throw new Error(t('sessionUnavailable'))
          }
          const archived = Array.isArray(archivedSessionIds) ? archivedSessionIds : []
          if (project && project.coordinatorSessionId && archived.includes(project.coordinatorSessionId)) {
            await threadApi.restoreSession(project.coordinatorSessionId)
          }
          if (archived.includes(task.childSessionId)) {
            await threadApi.restoreSession(task.childSessionId)
          }
          const reference = threadApi.retainWorker(task.childSessionId, project && project.coordinatorSessionId)
          setExecTarget({ taskId: task.id, title: task.title, sessionId: task.childSessionId, reference })
          return ''
        })
      }, [archivedSessionIds, project, run, t, threadApi])

      // Handle clicks on `projects_dispatch` cards from coordinator conversation.
      useEffect(() => {
        return openTaskRequest.subscribe((req) => {
          if (!req) return
          if (req.projectId && req.projectId !== selectedRef.current) {
            if (!projects.some((p) => p && p.id === req.projectId)) return
            pendingOpenRef.current = req
            selectedRef.current = req.projectId
            setSelectedId(req.projectId)
            void refresh(req.projectId).catch((err) => showToast(`${t('errorPrefix')}${messageOf(err)}`, { holdMs: null }))
            return
          }
          const tasks = project && project.id === req.projectId ? (project.tasks || []) : []
          const found = tasks.find((item) => item && item.id === req.taskId)
          if (found) {
            openTaskDetail(found)
          } else if (!project || project.id !== req.projectId) {
            pendingOpenRef.current = req
          }
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

      // Project & task actions
      const commitSwitchProject = (entry) => {
        goalDirtyRef.current = false
        setGoalDirty(false)
        selectedRef.current = entry.id
        setSelectedId(entry.id)
        void loadDetail(entry.id).catch((err) => showToast(`${t('errorPrefix')}${messageOf(err)}`, { holdMs: null }))
      }

      const handleSelectProject = (entry) => {
        if (!entry || entry.id === selectedId) return
        if (goalDirtyRef.current) {
          setConfirmState({
            title: t('switchDiscardTitle'),
            description: t('switchDiscardDesc'),
            tone: 'warning',
            confirmLabel: t('discardAndSwitch'),
            cancelLabel: t('keepEditing'),
            onConfirm: () => {
              setConfirmState(null)
              commitSwitchProject(entry)
            },
          })
          return
        }
        commitSwitchProject(entry)
      }

      const handleCreateProject = (payload) =>
        void run(async () => {
          if (!payload.name) throw new Error(t('nameRequired'))
          const created = await api('/projects', { method: 'POST', body: JSON.stringify(payload) })
          setShowNewProject(false)
          await refresh(created.project && created.project.id)
          return ''
        })

      const handlePatchProject = (patch) =>
        void run(async () => {
          if (!projectId) return ''
          await api(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(patch) })
          await refresh(projectId)
          return ''
        })

      const handleSaveGoal = () =>
        void run(async () => {
          if (!projectId) return ''
          await api(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ goal: goalText }) })
          goalDirtyRef.current = false
          setGoalDirty(false)
          await refresh(projectId)
          return ''
        })

      const handleOpenWorkspace = (proj) =>
        void run(async () => {
          if (!proj || !proj.workspace) return ''
          await api('/open-path', { method: 'POST', body: JSON.stringify({ path: proj.workspace, projectId: proj.id }) })
          return ''
        })

      const handleStartCoordinator = () =>
        void run(async () => {
          if (!project) return ''
          if (!threadApi || typeof threadApi.ensure !== 'function') throw new Error(t('sessionUnavailable'))
          if (coordinatorArchived && project.coordinatorSessionId) {
            await threadApi.restoreSession(project.coordinatorSessionId)
          }
          const result = await threadApi.ensure(project, coordinatorBoard(project))
          setThread({ sessionId: result.sessionId, reference: result.reference })
          if (result.created) {
            try { await refresh(project.id) } catch {}
          }
          return ''
        })

      const handleRestoreCoordinator = () =>
        void run(async () => {
          if (!project || !project.coordinatorSessionId || !threadApi) return ''
          await threadApi.restoreSession(project.coordinatorSessionId)
          return ''
        })

      const handleApproveTask = (task) =>
        void run(async () => {
          const data = await api(`/projects/${projectId}/tasks/${task.id}/approve`, { method: 'POST', body: '{}' })
          if (data && data.task) applyTaskLocally(data.task)
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
          return archive && data && data.session && data.session.archived ? t('deleteArchived') : ''
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

      // Memory preview / edit / delete
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
          await refresh(projectId)
          return ''
        })

      const handleDeleteMemory = (file) =>
        void run(async () => {
          if (!projectId || !file || file.isIndex || file.readOnly) return ''
          await api(`/projects/${projectId}/memory/${encodeURIComponent(file.name)}`, { method: 'DELETE', body: '{}' })
          setMemoryPreview(null)
          await refresh(projectId)
          return t('memoryDeleted')
        })

      // Layout computation & drag resizing
      const layout = computeColumnLayout({
        containerWidth,
        listChoice,
        execChoice,
        execForceOpen,
        lastOpenedSide,
        listWidth,
        execWidth,
      })

      const startResize = (which, event) => {
        if (!event || (typeof event.button === 'number' && event.button !== 0)) return
        event.preventDefault?.()
        if (typeof window === 'undefined') return
        const startX = Number(event.clientX) || 0
        const from = which === 'list' ? layout.list : layout.exec
        const min = which === 'list' ? LIST_MIN_WIDTH : EXEC_MIN_WIDTH
        const max = columnDragCeiling({ containerWidth, layout, which })
        let latest = from
        setResizing(which)
        const onMove = (ev) => {
          const delta = (Number(ev.clientX) || 0) - startX
          const raw = which === 'list' ? from + delta : from - delta
          latest = Math.round(clamp(raw, min, max))
          if (which === 'list') setListWidth(latest)
          else setExecWidth(latest)
        }
        const onEnd = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onEnd)
          window.removeEventListener('pointercancel', onEnd)
          setResizing(null)
          writeStored(which === 'list' ? 'listWidth' : 'execWidth', latest)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onEnd)
        window.addEventListener('pointercancel', onEnd)
      }

      const nudgeWidth = (which, event) => {
        const step = event && event.shiftKey ? 48 : 16
        const delta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        if (!delta) return
        event.preventDefault?.()
        const max = columnDragCeiling({ containerWidth, layout, which })
        if (which === 'list') {
          const next = Math.round(clamp(layout.list + delta, LIST_MIN_WIDTH, max))
          setListWidth(next)
          writeStored('listWidth', next)
        } else {
          const next = Math.round(clamp(layout.exec - delta, EXEC_MIN_WIDTH, max))
          setExecWidth(next)
          writeStored('execWidth', next)
        }
      }

      return h(
        'div',
        { ref: pageRef, className: `pj-page${resizing ? ' pj-resizing' : ''}`, 'data-projects-page': 'true' },
        h('style', { dangerouslySetInnerHTML: { __html: PAGE_CSS } }),
        h(ProjectListColumn, {
          projects,
          selectedId,
          collapsed: layout.listCollapsed,
          width: layout.list,
          busy,
          onSelect: handleSelectProject,
          onNewProject: () => setShowNewProject(true),
          onToggleCollapse: () => {
            if (layout.listCollapsed) {
              setLastOpenedSide('list')
              setExecForceOpen(false)
              setListChoice('0')
            } else {
              setListChoice('1')
            }
          },
          newProjectBtnRef,
          t,
        }),
        !layout.listCollapsed &&
          h('div', {
            className: 'pj-resizer',
            role: 'separator',
            'aria-orientation': 'vertical',
            'aria-label': t('resizeColumns'),
            'aria-valuenow': layout.list,
            'aria-valuemin': LIST_MIN_WIDTH,
            'aria-valuemax': columnDragCeiling({ containerWidth, layout, which: 'list' }),
            tabIndex: 0,
            onPointerDown: (e) => startResize('list', e),
            onKeyDown: (e) => nudgeWidth('list', e),
          }),
        h(CoordinatorColumn, {
          project,
          thread,
          coordinatorArchived,
          busy,
          onOpenWorkspace: handleOpenWorkspace,
          onToggleAutonomy: () => project && handlePatchProject({ autonomy: project.autonomy === 'auto' ? 'manual' : 'auto' }),
          onTogglePaused: () => project && handlePatchProject({ paused: !project.paused }),
          onOpenSettings: () => setShowSettings(true),
          onStartCoordinator: handleStartCoordinator,
          onRestoreCoordinator: handleRestoreCoordinator,
          settingsBtnRef,
          SessionProvider,
          renderSlot,
          t,
        }),
        !layout.execCollapsed &&
          h('div', {
            className: 'pj-resizer',
            role: 'separator',
            'aria-orientation': 'vertical',
            'aria-label': t('resizeColumns'),
            'aria-valuenow': layout.exec,
            'aria-valuemin': EXEC_MIN_WIDTH,
            'aria-valuemax': columnDragCeiling({ containerWidth, layout, which: 'exec' }),
            tabIndex: 0,
            onPointerDown: (e) => startResize('exec', e),
            onKeyDown: (e) => nudgeWidth('exec', e),
          }),
        h(ThreadsColumn, {
          project,
          catalog,
          collapsed: layout.execCollapsed,
          width: layout.exec,
          busy,
          execTarget,
          diffRefreshToken,
          onToggleCollapse: () => {
            setExecForceOpen(false)
            if (layout.execCollapsed) {
              setLastOpenedSide('exec')
              setExecChoice('0')
            } else {
              setExecChoice('1')
            }
          },
          onSelectTask: openTaskDetail,
          onCloseDetail: () => {
            setExecForceOpen(false)
            setExecTarget(null)
          },
          onApproveTask: handleApproveTask,
          onStopTask: handleStopTask,
          onRetryTask: handleRetryTask,
          onResolveTask: handleResolveTask,
          onDeleteTask: handleDeleteTask,
          onCopyBranch: handleCopyBranch,
          onRequestMergeWorktree: handleRequestMergeWorktree,
          onRequestCleanupWorktree: handleRequestCleanupWorktree,
          SessionProvider,
          renderSlot,
          activeLocale: getLocale,
          t,
        }),
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
          goalText,
          goalDirty,
          busy,
          onGoalChange: (val) => {
            goalDirtyRef.current = true
            setGoalDirty(true)
            setGoalText(val)
          },
          onSaveGoal: handleSaveGoal,
          onPatchProject: handlePatchProject,
          onChooseWorkspace: () =>
            void run(async () => {
              const dir = await pickFolder()
              if (dir && projectId) {
                await api(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ workspace: dir }) })
                await refresh(projectId)
              }
              return ''
            }),
          onClearWorkspace: () => handlePatchProject({ workspace: '' }),
          onArchiveToggle: (archived) => handlePatchProject({ archived }),
          onOpenMemoryPreview: openMemoryPreview,
          onNewMemoryTopic: () => setMemoryEditor({ isNew: true, name: '', description: '', type: 'reference', text: '', loading: false }),
          onClose: () => setShowSettings(false),
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
          if (!ws || typeof ws.pickDirectory !== 'function') throw new Error(translate('pickerUnavailable'))
          return ws.pickDirectory()
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
          async ensure(project, prompt, options = {}) {
            const sessions = ctx.get('sessions')
            if (!sessions || typeof sessions.create !== 'function') {
              throw new Error(translate('sessionUnavailable'))
            }
            const existing = typeof project.coordinatorSessionId === 'string' ? project.coordinatorSessionId : ''
            let sessionId = existing
            let created = false
            let reference
            if (sessionId) {
              try {
                reference = sessions.retain(sessionId, { source: 'projects' })
                await reference.ready
              } catch {
                reference = undefined
                sessionId = ''
              }
            }
            if (!sessionId) {
              if (options.create === false) return null
              sessionId = await sessions.create(project.workspace ? { cwd: project.workspace } : {})
              created = true
              reference = sessions.retain(sessionId, { source: 'projects' })
              await reference.ready
            }
            const needsBind = existing !== sessionId
            if (needsBind) {
              await api(`/projects/${project.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ coordinatorSessionId: sessionId }),
              })
            }
            if (created) {
              const result = await reference.binding.session.prompt([{ type: 'text', text: prompt }], 'queue')
              if (!result || result.ok !== true) {
                try { reference.release() } catch {}
                if (needsBind) {
                  try {
                    await api(`/projects/${project.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ coordinatorSessionId: '' }),
                    })
                  } catch {}
                }
                throw new Error((result && result.error && result.error.message) || translate('promptRejected'))
              }
            }
            return { sessionId, reference, created }
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

        // Slot 2: Main full-page three-column board with session-scoped conversation child slot
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
