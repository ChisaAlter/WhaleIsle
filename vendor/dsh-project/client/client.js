window.__ModuleLoader__.load({ id: 'dsh-project', factory: (require) => {
  const { createElement: h, useState, useEffect, useLayoutEffect, useRef, useCallback, Fragment } = require('react');
  const { createPortal } = require('react-dom');
  const { Button, Input, Menu, Modal, Pill, SegmentedTabs, Tag, MarkdownText, Toast, Tooltip, IconFolderCloseRegular, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconChevronRightOutlineRegular, IconEllipsisOutlineRegular, IconUsersOutlineRegular, IconChecklistOutlineRegular, useAnchoredPosition } = require('@deepseek-ai/dsh-client-ui-primitives');
  const { createSnapshotStore, defineStore } = require('@deepseek-ai/dsh-client-store');
  const { teamEnglish, teamChinese } = require('@deepseek-ai/dsh-experimental-client-ui-agent-team');
  const NS = 'dsh-project';
  const zh = {
    diffTruncated: '差异过长，仅显示前一部分；请打开目录查看完整改动。', tab: 'Project', more: '更多', rename: '重命名', cancel: '取消', archiveActive: '停止后台工作并归档', archiveHint: '后台工作会停止，工作目录、对话和成果将保留。', team: '团队', add: '添加 Project…', rowCreate: '在此目录新建 Project', backgroundError: 'Project 出错：{message}', dirMissing: '找不到这个目录。', dirNotDirectory: '这个路径不是文件夹。', dirRoot: '磁盘根目录不能作为 Project 目录，请选择具体的项目文件夹。', dirHome: '用户主目录不能作为 Project 目录，请选择其中具体的项目文件夹。', dirSystemData: '系统配置目录（如 AppData、.config、.ssh）不能作为 Project 目录，请选择你的项目文件夹。', dirAppData: '这是鲸屿自己的数据目录，不能作为 Project 目录，请选择你的项目文件夹。', rowOpen: '打开 Project', heroHint: '以当前目录开启 Project，已输入的内容会一起带过去', heroOpenHint: '打开此目录的 Project，已输入的内容会一起带过去', loading: '正在读取…', close: '关闭', refresh: '刷新',
    requirements: '需求', requirementGoal: '完整目标', requirementConstraints: '约束', requirementConditions: '完成条件', noRequirementConstraints: '未记录约束。', noRequirementConditions: '未记录完成条件。',
    requestRoleDevelopment: '开发', requestRoleReview: '检查', requestRoleDocs: '文档', requestHandover: '等待协调者交付', requestArranging: '正在安排', requestArrangingHint: '协调者正在安排团队开发。', deleted: '已移除', requestDiscussing: '讨论中', requestQueued: '等待开发', requestCancelled: '已取消', requestQueuePosition: '队列第 {position} 项', requestQueueCount: '{count} 项排队', requestEnqueue: '加入开发队列', requestMoveUp: '上移一位', requestMoveDown: '下移一位', requestCancel: '取消需求', requestRejoin: '重新加入队列', requestResume: '继续当前需求', requestResumeQueue: '继续队列', requestRestarted: '应用已重启，等待你继续当前需求', requestQueuePaused: '队列已暂停', requestQueueWaiting: '前一项需求交付后自动开始', requestQueueReady: '等待协调者安排开发', requestDiscussingHint: '需求仍在讨论，确认后加入开发队列。', requestCancelledHint: '已从开发队列取消，要求和已有成果仍保留。', taskCancelled: '已取消需求', taskCancelledEmpty: '还没有取消的需求。',
    archivedHint: '项目已归档。恢复后可继续对话，旧工作不会自动启动。', archiving: '正在停止后台工作并归档…', queued: '排队中', archived: '已归档',
    directory: 'Project 工作目录', openDirectory: '打开项目目录', materials: '项目资料', progress: '工作进度',
    noWork: '在这里提出需求，后续可以继续同一项工作。', process: '成员记录', viewProcess: '查看记录', viewResult: '查看成果', workDetails: '详情', executionInfo: '执行信息', earlierWork: '更早工作',
    processHint: '需要调整这项工作时，在主对话中继续说明。', noProcess: '暂无记录。', priorWorkFailed: '此前工作失败', priorWorkStopped: '此前工作已停止', priorReportPending: '此前报告待汇总', priorWorkPending: '此前工作尚未完成',
    older: '更早记录', workRequest: '工作要求', earlierRequests: '更早要求', teamMessage: '团队消息',
    newer: '最新记录', previous: '更早一页', next: '更新一页', assistant: '助手', tool: '工具',
    result: '结果', failed: '失败', open: '等待工作', running: '进行中', blocked: '需要处理', done: '已完成',
    provisioning: '正在准备', active: '执行中', idle: '空闲', stopping: '正在停止', paused: '已停止',
    pause: '暂停后台工作', resume: '解除暂停', resumeHint: '在主对话中提出新的要求，即可继续原工作。',
    stop: '停止后台工作', stopWork: '停止这项工作', archive: '归档项目', restore: '恢复项目',
    notes: '笔记', preferences: '项目要求', docs: '全部文档', allResults: '全部成果', noDocs: '暂无项目文档。', noResults: '完成工作后，成果会保存在这里。',
    generatedNotes: '工作记录', userNotes: '项目笔记', remainingIssues: '待处理事项', reportDetails: '报告详情', reportSource: '成员报告',
    keyEvidence: '关键验证', noEvidence: '这份报告未提供验证记录。', backToResults: '返回成果', delivered: '已交付', partialDelivery: '部分交付', historicalDelivery: '历史交付', historicalDeliveryHint: '这是旧版本保存的交付记录，保留原结论和资料；不代表当前要求已经完成。继续工作时，请在主对话中说明新的要求。', deliveryDetails: '交付详情', memberReports: '成员报告与文件', earlierDeliveries: '更早交付', requestVersion: '要求版本', executionRound: '执行轮次', roundEnded: '本轮执行已结束', historicalError: '本轮曾遇到错误', selectRun: '定位执行记录', locatingRun: '正在定位这轮执行记录…', runRecordsMissing: '未找到这轮执行的原始记录。', recordedAt: '记录时间', saveAndClose: '保存并关闭', saveBeforeClose: '保存修改后再关闭？', resultMissing: '原报告当前不可用，请查看错误详情。',
    notesHint: '记录你希望保留的背景和想法。', preferencesHint: '设置本项目的长期约定，例如代码风格、测试命令和交付要求；后续明确要求优先。',
    storeHint: '查看项目成果，管理此项目的笔记与长期偏好。', save: '保存', saved: '已保存', saveFailed: '修改尚未保存，你可以重试或继续编辑。', materialsError: '操作未完成，请查看错误详情。', textTooLong: '内容过长，请缩短后再保存。',
    workResults: '成果', resultHistory: '其他报告版本', currentResult: '最新成果', previousResult: '历史成果', completed: '已完成', modifiedArtifact: '文件在报告后发生了变化，当前打开的是最新内容。', archivedMaterials: '恢复项目后可编辑笔记和项目要求。',
    openFile: '打开文件', fileMore: '文件操作', diff: '当前目录改动', diffScope: '可能包含原有改动及其他工作的修改。',
    fileLocation: '文件位置', artifactMaterials: '项目资料', artifactExisting: '项目目录', artifactWorktree: '独立分支', errorDetails: '错误详情', modelSettings: '模型设置',
    summaryCredentialHint: '当前模型未配置凭据。请补充凭据，或在输入框选择已配置的模型，再重新汇总。', summaryErrorHint: '本次汇总未完成。请查看错误详情，处理原因后重新汇总。', sidebarSummaryFailed: '汇总失败', sidebarPendingSummary: '等待汇总',
    noDiff: '当前没有文件差异。', diffWorkingDirectory: '工作目录', diffRepositoryPath: '仓库内路径', branch: '分支', readonly: '查看项目文件，不修改文件', docsScope: '修改已授权的文档', developmentScope: '执行已授权的开发工作', worktree: '独立分支', existing: '项目目录',
    copy: '复制', copied: '已复制', footnotes: '脚注', unavailable: 'Project 暂不可用',
    evidence: '验证记录', pendingSummary: '正在汇总', pendingDelivery: '交付未完成', needsReview: '结果需复核', roundDelivered: '本轮已交付', summaryFailed: '成果已保存，汇总未完成', retrySummary: '重新汇总', resultUpdated: '结果已更新，请查看最新结果。', handoverErrorHint: '本次交付未完成。已有成果仍保留，处理错误后可重新汇总。', authorityErrorHint: '这项要求缺少可核对的原始授权记录。请在主对话中重新说明或修订要求，再继续工作。',
    retrySummaryPrompt: '请重新汇总以下已保存结果，说明成果、验证和剩余问题；只读取已有报告，不重新执行后台工作：', waitingDependencies: '等待前置工作完成', waitingDirectory: '等待其他工作释放目录', waitingCapacity: '等待团队空出执行名额', prerequisitesChanged: '依据已变化', prerequisitesHint: '前置工作已收到新要求。这份报告保留原有结果，需按当前要求复核。', deliveryChangedHint: '要求或依据已变化。这份交付保留原版本结果，需按当前要求复核。',
    notGit: '当前目录不是 Git 仓库，无法读取 Git 差异。', unsaved: '修改尚未保存', discard: '放弃修改', saveAndSwitch: '保存并切换', discardAndSwitch: '放弃并切换', keepEditing: '继续编辑', saveBeforeSwitch: '是否保存修改，再切换页面？',
    taskList: '任务', taskCurrent: '当前工作', taskCompleted: '已交付', taskArchive: '归档任务', taskArchiveEmpty: '还没有归档任务。', taskEmptyTitle: '还没有任务', taskEmpty: '直接在主对话里说你要完成什么。协调者开始后，这里会显示进度与成果。', taskDetail: '任务详情', taskOverview: '概览', taskTeam: '团队', taskResults: '成果', taskActivity: '活动', taskMaterials: '成果与资料', taskBack: '返回任务', teamBack: '返回团队', taskArchiveAction: '归档任务', taskRestoreAction: '移回任务列表', taskArchiveUnavailable: '只有已完成交付的任务可以归档。', taskMemberCount: '位成员', taskWorkCount: '项工作', taskNoMembers: '协调者尚未安排团队成员。', taskNoResults: '尚无最终交付；已有成员报告会继续保留。', taskNoActivity: '尚无执行记录。', taskRevision: '第 {revision} 版要求', observerStrip: '收起', observerOpen: '打开 Project 面板', observerIdle: '待命', observerArchiving: '归档中', taskMore: '加载更多',
    projectOverview: '项目概览', observerExpand: '展开', visualResults: '可视化成果', resultFiles: '相关文件',
    teamLead: '协调者', teamMember: '团队成员', teamLeadRole: '安排工作与汇总交付', teamLeadWorking: '正在处理主对话',
    teamLeadWaiting: '等待主对话继续安排', teamLeadBackground: '团队成员在后台工作，协调者当前未运行', teamAssigned: '已分配，当前未运行', teamReported: '已提交报告', teamReady: '待命',
    teamStatusUnavailable: '当前运行状态不可用', teamNoAssignment: '暂无分配工作', teamNoMatch: '没有匹配的成员或工作。',
    teamOtherWork: '其他工作', teamTarget: '消息目标', teamSession: '会话 ID',
    observerTaskProgress: '任务进度', observerTodo: '当前待办', observerTodoPending: '待完成', observerExecutor: '当前执行者', observerFlow: '从需求到交付', observerNoTodo: '尚未安排具体工作', observerCard: '收起详情', observerIsland: '收为灵动浮条', observerReturnCurrent: '返回当前任务', observerTaskCount: '项当前任务', observerReports: '份报告已提交', observerAwaitDelivery: '等待协调者交付', observerDeliverToYou: '交付给你', observerRegistered: '已登记', observerReportCount: '{count} 份', observerNoCurrent: '没有当前任务',

  };
  const en = {
    requirements: 'Requests', requirementGoal: 'Full goal', requirementConstraints: 'Constraints', requirementConditions: 'Completion conditions', noRequirementConstraints: 'No constraints recorded.', noRequirementConditions: 'No completion conditions recorded.',
    requestRoleDevelopment: 'Development', requestRoleReview: 'Review', requestRoleDocs: 'Documentation', requestHandover: 'Awaiting coordinator delivery', requestArranging: 'Arranging work', requestArrangingHint: 'The coordinator is arranging development with the team.', deleted: 'Removed', requestDiscussing: 'Discussing', requestQueued: 'Awaiting development', requestCancelled: 'Cancelled', requestQueuePosition: 'Queue position {position}', requestQueueCount: '{count} queued', requestEnqueue: 'Add to development queue', requestMoveUp: 'Move up', requestMoveDown: 'Move down', requestCancel: 'Cancel request', requestRejoin: 'Rejoin queue', requestResume: 'Continue current request', requestResumeQueue: 'Continue queue', requestRestarted: 'Application restarted; waiting for explicit continuation.', requestQueuePaused: 'Queue paused', requestQueueWaiting: 'Starts automatically after the previous request is delivered', requestQueueReady: 'Waiting for the coordinator to arrange development', requestDiscussingHint: 'This request is being discussed. Add it to the development queue when ready.', requestCancelledHint: 'Removed from the development queue. Requirements and existing results are retained.', taskCancelled: 'Cancelled requests', taskCancelledEmpty: 'No cancelled requests yet.',
    diffTruncated: 'The diff is truncated. Open the directory for the complete changes.', tab: 'Project', more: 'More', rename: 'Rename', cancel: 'Cancel', archiveActive: 'Stop work and archive', archiveHint: 'Background work will stop. Files, conversation and results are retained.', team: 'Team', add: 'Add Project…', rowCreate: 'New Project here', backgroundError: 'Project error: {message}', dirMissing: 'This folder cannot be found.', dirNotDirectory: 'This path is not a folder.', dirRoot: 'A drive root cannot be a Project folder. Choose a specific project folder.', dirHome: 'Your home folder cannot be a Project folder. Choose a specific project folder inside it.', dirSystemData: 'System configuration folders (such as AppData, .config or .ssh) cannot be Project folders. Choose your project folder.', dirAppData: 'This is Whale Isle’s own data folder and cannot be a Project folder. Choose your project folder.', rowOpen: 'Open Project', heroHint: 'Start a Project in this directory; your draft comes along', heroOpenHint: 'Open this directory’s Project; your draft comes along', loading: 'Loading…', close: 'Close', refresh: 'Refresh',
    archivedHint: 'This Project is archived. Restore it to continue; previous work will not restart automatically.', archiving: 'Stopping work and archiving…', queued: 'Queued', archived: 'Archived',
    directory: 'Project working directory', openDirectory: 'Open project directory', materials: 'Project materials', progress: 'Work progress',
    noWork: 'Describe what you need here, and continue the same work later.', process: 'Member history', viewProcess: 'View history', viewResult: 'View results', workDetails: 'Details', executionInfo: 'Execution details', earlierWork: 'Earlier work',
    processHint: 'Continue in the main conversation to request changes to this work.', noProcess: 'No records yet.', priorWorkFailed: 'Earlier work failed', priorWorkStopped: 'Earlier work stopped', priorReportPending: 'Earlier report awaits handover', priorWorkPending: 'Earlier work is unfinished',
    older: 'Earlier records', workRequest: 'Assignment', earlierRequests: 'Earlier requests', teamMessage: 'Team message',
    newer: 'Latest records', previous: 'Earlier page', next: 'Later page', assistant: 'Assistant', tool: 'Tool',
    result: 'Result', failed: 'Failed', open: 'Waiting for work', running: 'In progress', blocked: 'Needs attention', done: 'Done',
    provisioning: 'Preparing', active: 'Running', idle: 'Idle', stopping: 'Stopping', paused: 'Stopped',
    pause: 'Pause background work', resume: 'Unpause', resumeHint: 'Give a new instruction in the main conversation to continue the original work.',
    stop: 'Stop background work', stopWork: 'Stop this work', archive: 'Archive project', restore: 'Restore project',
    notes: 'Notes', preferences: 'Project instructions', docs: 'All documents', allResults: 'All results', noDocs: 'No Project documents yet.', noResults: 'Results will be saved here when work is completed.',
    generatedNotes: 'Work history', userNotes: 'Project notes', remainingIssues: 'Open issues', reportDetails: 'Report details', reportSource: 'Member report',
    keyEvidence: 'Key verification', noEvidence: 'This report has no verification records.', backToResults: 'Back to results', delivered: 'Delivered', partialDelivery: 'Partial delivery', historicalDelivery: 'Historical delivery', historicalDeliveryHint: 'This delivery was saved by an earlier version. Its conclusion and materials remain available, but it does not confirm completion of the current request. Describe a new request in the main conversation to continue.', deliveryDetails: 'Delivery details', memberReports: 'Member reports and files', earlierDeliveries: 'Earlier deliveries', requestVersion: 'Request version', executionRound: 'Execution round', roundEnded: 'This execution ended', historicalError: 'An error occurred in this execution', selectRun: 'Locate execution records', locatingRun: 'Locating this execution’s records…', runRecordsMissing: 'The original records for this execution were not found.', recordedAt: 'Recorded at', saveAndClose: 'Save and close', saveBeforeClose: 'Save your changes before closing?', resultMissing: 'The original report is unavailable. Review the error details.',
    notesHint: 'Keep the background and ideas you want to remember.', preferencesHint: 'Set this Project’s standing instructions, such as code style, test commands and delivery requirements. Later explicit requests take precedence.',
    storeHint: 'View results and manage this Project’s notes and preferences.', save: 'Save', saved: 'Saved', saveFailed: 'Changes are not saved. Retry or keep editing.', materialsError: 'The operation did not finish. Review the error details.', textTooLong: 'This content is too long. Shorten it before saving.',
    workResults: 'Results', resultHistory: 'Other report versions', currentResult: 'Latest result', previousResult: 'Historical result', completed: 'Completed', modifiedArtifact: 'The file changed after this report. The preview shows its latest content.', archivedMaterials: 'Restore the Project to edit notes and instructions.',
    openFile: 'Open file', fileMore: 'File actions', diff: 'Current directory changes', diffScope: 'May include pre-existing changes and changes from other work.',
    fileLocation: 'File location', artifactMaterials: 'Project materials', artifactExisting: 'Project directory', artifactWorktree: 'Independent branch', errorDetails: 'Error details', modelSettings: 'Model settings',
    summaryCredentialHint: 'The current model has no credentials. Add credentials or choose a configured model in the composer, then summarize again.', summaryErrorHint: 'The summary did not finish. Review the error details, address the cause, then summarize again.', sidebarSummaryFailed: 'Summary failed', sidebarPendingSummary: 'Awaiting summary',
    noDiff: 'There are no current file changes.', diffWorkingDirectory: 'Working directory', diffRepositoryPath: 'Repository path', branch: 'Branch', readonly: 'Inspect Project files without modifying them', docsScope: 'Edit authorized documents', developmentScope: 'Perform authorized development', worktree: 'Independent branch', existing: 'Project directory',
    copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes', unavailable: 'Project is currently unavailable',
    evidence: 'Verification records', pendingSummary: 'Preparing summary', pendingDelivery: 'Delivery incomplete', needsReview: 'Results need review', roundDelivered: 'This request is delivered', summaryFailed: 'Results saved; summary incomplete', retrySummary: 'Summarize again', resultUpdated: 'The result changed. View the latest result.', handoverErrorHint: 'The handover did not complete. Saved results remain available; resolve the error and summarize again.', authorityErrorHint: 'The original authorization for this request cannot be verified. Restate or revise the request in the main conversation before continuing.',
    retrySummaryPrompt: 'Summarize the following saved result again, including changes, verification and remaining issues. Read the existing report without rerunning background work:', waitingDependencies: 'Waiting for prerequisite work', waitingDirectory: 'Waiting for other work to release the directory', waitingCapacity: 'Waiting for an available team slot', prerequisitesChanged: 'Prerequisites changed', prerequisitesHint: 'Prerequisite work has received a new request. This report retains the original result and needs review against the current request.', deliveryChangedHint: 'The request or its prerequisites changed. This delivery retains its original version and needs review against the current request.',
    notGit: 'This directory is not a Git repository; Git changes are unavailable.', unsaved: 'Unsaved changes', discard: 'Discard changes', saveAndSwitch: 'Save and switch', discardAndSwitch: 'Discard and switch', keepEditing: 'Keep editing', saveBeforeSwitch: 'Save your changes before switching pages?',
    taskList: 'Tasks', taskCurrent: 'Current work', taskCompleted: 'Delivered', taskArchive: 'Archived tasks', taskArchiveEmpty: 'No archived tasks yet.', taskEmptyTitle: 'No tasks yet', taskEmpty: 'Tell the Lead what you want to accomplish in the main conversation. Progress and results appear here when work starts.', taskDetail: 'Task details', taskOverview: 'Overview', taskTeam: 'Team', taskResults: 'Results', taskActivity: 'Activity', taskMaterials: 'Results & materials', taskBack: 'Back to tasks', teamBack: 'Back to team', taskArchiveAction: 'Archive task', taskRestoreAction: 'Move to task list', taskArchiveUnavailable: 'Only delivered tasks can be archived.', taskMemberCount: 'members', taskWorkCount: 'team jobs', taskNoMembers: 'The Lead has not assigned a team member yet.', taskNoResults: 'No final delivery yet. Existing member reports remain available.', taskNoActivity: 'No execution records yet.', taskRevision: 'Request version {revision}', observerStrip: 'Collapse', observerOpen: 'Open Project panel', observerIdle: 'Ready', observerArchiving: 'Archiving', taskMore: 'Load more',
    projectOverview: 'Project overview', observerExpand: 'Expand', visualResults: 'Visual results', resultFiles: 'Related files',
    teamLead: 'Coordinator', teamMember: 'Team member', teamLeadRole: 'Assigns work and prepares delivery', teamLeadWorking: 'Working in the main conversation',
    teamLeadWaiting: 'Awaiting the next request in the main conversation', teamLeadBackground: 'Team members are working in the background; the coordinator is not running.', teamAssigned: 'Assigned · not running', teamReported: 'Report submitted', teamReady: 'Ready',
    teamStatusUnavailable: 'Current runtime status unavailable', teamNoAssignment: 'No work assigned', teamNoMatch: 'No matching members or work.',
    teamOtherWork: 'Other work', teamTarget: 'Message target', teamSession: 'Session ID',
    observerTaskProgress: 'Task progress', observerTodo: 'Current to-dos', observerTodoPending: 'Pending', observerExecutor: 'Current executor', observerFlow: 'From request to delivery', observerNoTodo: 'No work has been assigned yet', observerCard: 'Collapse details', observerIsland: 'Collapse to status strip', observerReturnCurrent: 'Back to current task', observerTaskCount: 'current tasks', observerReports: 'reports submitted', observerAwaitDelivery: 'Awaiting the coordinator’s delivery', observerDeliverToYou: 'Delivery to you', observerRegistered: 'Registered', observerReportCount: '{count} reports', observerNoCurrent: 'No current task',

  };
  const charterLimit = 16000;
  Object.assign(zh, {
    preferences: '偏好', preferencesHint: '软性的习惯与偏好，例如回复风格、常用命令。必须遵守的内容请写进「项目规则」。',
    charter: '项目规则', charterHint: '写下这个项目长期要遵守的规则，每条一行。协调者和每位成员每次工作都会读到；你在对话里明确要求破例时，协调者会先和你确认。',
    charterPlaceholder: '例如：\n- 新增或修改的功能必须附带测试\n- 不要修改 vendor/ 目录\n- 交付前运行项目测试并报告结果',
    charterUsage: '{used} / {limit} KB', charterTooLong: '规则超过 16 KB，请精简后再保存。', charterExamples: '常用规则',
    charterExampleTests: '附带测试', charterExampleScope: '只改相关文件', charterExampleVerify: '交付前跑测试', charterExampleLanguage: '中文文案',
    charterLineTests: '- 新增或修改的功能必须附带测试', charterLineScope: '- 只修改与需求相关的文件，不顺手重构无关代码',
    charterLineVerify: '- 交付前运行项目测试，并在交付中报告结果', charterLineLanguage: '- 界面文案使用中文，代码注释使用英文',
    statusDiscussing: '讨论中', statusQueued: '排队中', statusActive: '进行中', statusBlocked: '受阻', statusPartial: '部分交付', statusDelivered: '已交付',
    statusNeedsReview: '需复查', statusPaused: '已暂停', statusStopping: '正在停止', statusCancelled: '已取消', statusArchived: '已归档', statusQueuePosition: '第 {position} 位',
    nextStep: '下一步：', nextDependencies: '前置工作完成后自动继续', nextDirectory: '目录空出后自动继续', nextCapacity: '有空闲成员后自动继续',
    nextFailure: '打开详情查看原因，或在对话里让协调者重试', nextSummary: '打开详情重新汇总', nextAuthority: '在对话里重新说明这个需求',
    nextPartial: '在对话里补充，或让协调者继续未完成的部分', nextNeedsReview: '交付依据已变化，查看详情后重新加入队列', nextPaused: '点「继续」恢复',
    nextDiscussing: '确认要做时，点「加入开发队列」', nextQueued: '前一项交付后自动开始', nextQueuedPreparing: '正在提前调查；前一项交付后开始开发', nextQueuedPaused: '队列已暂停，点「继续队列」恢复', nextCancelled: '需要时可从菜单重新加入队列',
    boardSummary: '需求概况', boardActive: '进行中', boardBlocked: '受阻', boardWaiting: '待开始', boardDelivered: '已交付', requestUndo: '撤销',
    deliveryFiles: '交付文件', deliveryFileCount: '{count} 个', stripFileCount: '{count} 个文件', viewChanges: '查看改动', viewResultPage: '查看结果页', moreFiles: '查看全部 {count} 个文件',
    diffFileCount: '{count} 个文件有改动', diff_added: '新增', diff_deleted: '删除', diff_renamed: '重命名', diff_untracked: '未跟踪', diff_modified: '修改',
    diffUntrackedHint: '新文件尚未纳入 Git，差异中不含其内容；可在目录中打开查看。', diffBinary: '二进制文件，不显示内容。', diffNoContent: '没有可显示的文本差异。', diffLinesCapped: '仅显示前 {count} 行；完整内容请打开目录查看。',
    changeStats: '{count} 个文件', revertChanges: '撤销改动', revertTitle: '撤销这条需求的改动？', revertBody: '会把这条需求改动过的文件恢复到开始开发前的状态，其他文件不受影响。如果这些文件在交付后又被改过，撤销不会执行，你可以交给协调者处理。',
    revertConfirm: '撤销改动', revertDone: '已撤销这条需求的改动。', revertConflictTitle: '无法自动撤销', revertConflictBody: '这些文件在交付后又被修改过，自动撤销会覆盖新的修改，因此没有执行任何更改。',
    revertAsk: '交给协调者处理', revertAskPrompt: '请撤销需求「{title}」带来的改动。自动撤销遇到冲突（文件在交付后被修改过），请检查冲突文件，只还原这条需求的改动，保留之后的其他修改。',
    statusReverted: '已撤销改动', nextReverted: '如需重新实现，在对话里说一声', requestDiffIsolated: '部分开发在独立工作目录中进行，那些改动不在此列，也不能从这里撤销。', requestDiffScope: '这条需求从开始开发到交付的改动。', requestDiffLive: '这条需求从开始开发至今的改动，尚未交付。', requestDiffReverted: '这些改动已被撤销。',
    decisionLog: '决策日志', decisionLogEmpty: '交付后，协调者的关键决策会自动记录在这里。',
  });
  Object.assign(en, {
    preferences: 'Preferences', preferencesHint: 'Soft habits and preferences, such as reply style or common commands. Put anything that must always be followed in Project rules.',
    charter: 'Project rules', charterHint: 'Write the standing rules for this Project, one per line. The coordinator and every member read them on every assignment; if you explicitly ask for an exception in the conversation, the coordinator confirms it with you first.',
    charterPlaceholder: 'For example:\n- New or changed features must include tests\n- Do not modify the vendor/ directory\n- Run the project tests before delivery and report the result',
    charterUsage: '{used} / {limit} KB', charterTooLong: 'Rules exceed 16 KB. Shorten them before saving.', charterExamples: 'Common rules',
    charterExampleTests: 'Include tests', charterExampleScope: 'Related files only', charterExampleVerify: 'Test before delivery', charterExampleLanguage: 'Product language',
    charterLineTests: '- New or changed features must include tests', charterLineScope: '- Change only files related to the requirement; no unrelated refactoring',
    charterLineVerify: '- Run the project tests before delivery and report the result', charterLineLanguage: '- Keep user-facing text in the product language; write code comments in English',
    statusDiscussing: 'Discussing', statusQueued: 'Queued', statusActive: 'In progress', statusBlocked: 'Blocked', statusPartial: 'Partly delivered', statusDelivered: 'Delivered',
    statusNeedsReview: 'Needs review', statusPaused: 'Paused', statusStopping: 'Stopping', statusCancelled: 'Cancelled', statusArchived: 'Archived', statusQueuePosition: '#{position}',
    nextStep: 'Next: ', nextDependencies: 'Continues automatically after its prerequisites finish', nextDirectory: 'Continues automatically when the directory is free', nextCapacity: 'Continues automatically when a member is free',
    nextFailure: 'Open details for the cause, or ask the coordinator to retry', nextSummary: 'Open details to summarize again', nextAuthority: 'Restate this requirement in the conversation',
    nextPartial: 'Add details in the conversation, or ask the coordinator to finish the rest', nextNeedsReview: 'Its delivery evidence changed; review details, then queue it again', nextPaused: 'Choose Continue to resume',
    nextDiscussing: 'When you want it built, choose Add to development queue', nextQueued: 'Starts automatically after the previous delivery', nextQueuedPreparing: 'Investigating ahead; development starts after the previous delivery', nextQueuedPaused: 'The queue is paused; choose Continue queue', nextCancelled: 'You can queue it again from the menu',
    boardSummary: 'Requirements overview', boardActive: 'In progress', boardBlocked: 'Blocked', boardWaiting: 'Up next', boardDelivered: 'Delivered', requestUndo: 'Undo',
    deliveryFiles: 'Delivered files', deliveryFileCount: '{count}', stripFileCount: '{count} files', viewChanges: 'View changes', viewResultPage: 'View result page', moreFiles: 'View all {count} files',
    diffFileCount: '{count} changed files', diff_added: 'Added', diff_deleted: 'Deleted', diff_renamed: 'Renamed', diff_untracked: 'Untracked', diff_modified: 'Modified',
    diffUntrackedHint: 'This new file is not tracked by Git yet, so the diff has no content; open the directory to view it.', diffBinary: 'Binary file; content is not shown.', diffNoContent: 'No text differences to show.', diffLinesCapped: 'Showing the first {count} lines; open the directory for the full content.',
    changeStats: '{count} files', revertChanges: 'Revert changes', revertTitle: 'Revert this requirement’s changes?', revertBody: 'Files changed by this requirement return to their state before development started; other files are untouched. If they changed again after delivery, nothing is reverted and you can hand it to the coordinator.',
    revertConfirm: 'Revert changes', revertDone: 'This requirement’s changes were reverted.', revertConflictTitle: 'Could not revert automatically', revertConflictBody: 'These files changed after delivery. Reverting automatically would overwrite the newer edits, so nothing was changed.',
    revertAsk: 'Ask the coordinator', revertAskPrompt: 'Please revert the changes from the requirement “{title}”. The automatic revert hit a conflict because the files changed after delivery; inspect the conflicting files and restore only this requirement’s changes while keeping later edits.',
    statusReverted: 'Changes reverted', nextReverted: 'Say so in the conversation if you want it implemented again', requestDiffIsolated: 'Part of this work ran in an isolated worktree; those changes are not listed here and cannot be reverted from here.', requestDiffScope: 'Changes made by this requirement from the start of development to delivery.', requestDiffLive: 'Changes made by this requirement since development started; not delivered yet.', requestDiffReverted: 'These changes have been reverted.',
    decisionLog: 'Decision log', decisionLogEmpty: 'After deliveries, the coordinator’s key decisions are recorded here automatically.',
  });
  const CSS = `
    .dsh-project-hero-option-wrap{display:inline-flex;border-radius:var(--dsw-radius-sm)}
    .dsh-project-hero-option-wrap:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .dsh-project-row-badge{flex:none;margin-left:6px;padding:0 5px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:16px;font-weight:500;white-space:nowrap}
    .dsh-project-heading,.dsh-project-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .dsh-project-heading{justify-content:space-between;gap:4px;flex-wrap:nowrap}
    .dsh-project-list{display:flex;flex-direction:column;gap:2px}
    .dsh-project-header{display:flex;align-items:center;flex:0 0 auto;white-space:nowrap}
    .dsh-project-header-directory{min-width:0;max-width:100%}
    .dsh-project-header-path{min-width:0;max-width:280px;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-return-materials{max-width:min(240px,25vw);min-width:0}
    .dsh-project-return-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-materials-frame{display:flex;flex:1;min-height:0;overflow:hidden}
    .dsh-project-archive-notice{padding:16px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}
    .dsh-project-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
    .dsh-project-error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;font-size:13px}
    .dsh-project-progress{max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px}
    .dsh-project-progress>p{margin:0}
    .dsh-project-work{border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;min-width:0}
    .dsh-project-work>.dsh-project-actions{grid-column:2;grid-row:1}
    .dsh-project-work>p,.dsh-project-work>button,.dsh-project-work>details{grid-column:1/-1}
    .dsh-project-work>button{justify-self:start}
    .dsh-project-work>p{margin:0}
    .dsh-project-work-heading{flex-wrap:nowrap;min-width:0}
    .dsh-project-work-heading strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-work-details>summary,.dsh-project-work-history>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
    .dsh-project-work-details[open]>summary{margin-bottom:8px}
    .dsh-project-work-detail-body{display:flex;flex-direction:column;gap:6px;min-width:0}
    .dsh-project-work-history{display:flex;flex-direction:column;gap:8px}
    .dsh-project-path{color:var(--dsw-alias-label-tertiary);font:12px monospace;overflow-wrap:anywhere}
    .dsh-project-body{display:flex;flex-direction:column;gap:12px;min-width:0}
    .dsh-project-artifact{display:flex;flex-direction:column;gap:4px;min-width:0}
    .dsh-project-artifact-row{display:flex;align-items:center;gap:8px;min-width:0}
    .dsh-project-artifact-title{flex:1;min-width:0;height:auto;min-height:32px;white-space:normal;overflow-wrap:anywhere;text-align:left;justify-content:flex-start}
    .dsh-project-artifact-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-left:8px}
    .dsh-project-artifact-row>span{flex-shrink:0}
    .dsh-project-artifact>.dsh-project-path{padding:8px}
    .dsh-project-error-details>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
    .dsh-project-error-details pre{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace;color:var(--dsw-alias-label-secondary)}
    .dsh-project-modal{width:min(760px,calc(100vw - 32px))}
    .dsh-project-modal-content{max-height:80vh;overflow:hidden}
    .dsh-project-modal-content>:first-child{flex-shrink:0}
    .dsh-project-modal-content>:last-child{min-height:0;overflow:auto}
    .dsh-project-editor{width:100%;min-height:240px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:1.6;box-sizing:border-box}
    .dsh-project-materials{min-height:0;overflow:hidden!important}
    .dsh-project-materials-tabs{flex-shrink:0}
    .dsh-project-materials-content{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px}
    .dsh-project-materials-footer{flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;gap:12px}
    .dsh-project-materials-footer>.dsh-project-muted{flex:1}
    .dsh-project-result{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2);min-width:0}
    .dsh-project-result:first-child{padding-top:0}
    .dsh-project-result-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0}
    .dsh-project-result-heading strong{min-width:0;overflow-wrap:anywhere}
    .dsh-project-result-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .dsh-project-result-body{display:flex;flex-direction:column;gap:8px;min-width:0}
    .dsh-project-result-disclosure>summary,.dsh-project-documents>summary{cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary)}
    .dsh-project-result-disclosure[open]>summary{margin-bottom:8px}
    .dsh-project-result-details{display:flex;flex-direction:column;gap:8px}
    .dsh-project-work-detail-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .dsh-project-empty{margin:0;padding:4px 12px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center;line-height:1.5}
    .dsh-project-result-conclusion{margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
    .dsh-project-result-checks{display:flex;flex-direction:column;gap:4px;font-size:13px;line-height:1.6;min-width:0}
    .dsh-project-result-checks ul{margin:0;padding-left:20px;overflow-wrap:anywhere}
    .dsh-project-materials-host{display:flex;flex-direction:column;min-height:0;overflow:hidden;flex:1}
    .dsh-project-materials-host[hidden],.dsh-project-results-list[hidden]{display:none}
    .dsh-project-results-list{display:flex;flex-direction:column;gap:16px;min-width:0}
    .dsh-project-context{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;margin-bottom:12px}
    .dsh-project-context-label{font-size:13px;color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}
    .dsh-project-record-heading{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
    .dsh-project-record-time{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
    .dsh-project-record-round{padding-top:16px;display:flex;flex-direction:column;gap:6px}
    .dsh-project-record-runs{display:flex;flex-direction:column;gap:4px}
    .dsh-project-record-runs button{height:auto;white-space:normal;text-align:left;justify-content:flex-start}
    .dsh-project-result-heading>:last-child{flex-shrink:0;white-space:nowrap}
    .dsh-project-record{font:12px/1.6 monospace;white-space:pre;overflow:auto;padding:10px;background:var(--dsw-alias-markdown-code-block);border-radius:12px;max-height:320px}
    .dsh-project-record-row{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
    .dsh-project-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
    .dsh-project-task-group-title{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:20px 0 4px;color:var(--dsw-alias-label-secondary);font-size:13px}
    .dsh-project-task-group-title:first-child{padding-top:0}
    .dsh-project-task-pagination{display:flex;gap:8px;justify-content:flex-end}
    .dsh-project-task-detail{display:flex;flex-direction:column;gap:10px;min-width:0}
    .dsh-project-task-queue-actions{display:flex;align-items:center;gap:8px;flex:0 1 auto;flex-wrap:wrap;min-width:0}
    .dsh-project-task-queue-actions>button{min-height:28px}
    .dsh-project-task-detail-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
    .dsh-project-task-detail-heading h2{margin:0;min-width:0;overflow-wrap:anywhere;font-size:16px;line-height:24px}
    .dsh-project-task-tabs{flex:none;min-width:0}
    .dsh-project-task-tab-body{min-width:0}
    .dsh-project-task-section{display:flex;flex-direction:column;gap:8px;min-width:0;padding:8px 0}
    .dsh-project-task-section p,.dsh-project-task-member p{margin:0}
    .dsh-project-task-section ul{margin:0;padding-left:20px;overflow-wrap:anywhere}
    .dsh-project-task-member{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
    .dsh-project-task-member .dsh-project-actions{grid-column:1/-1}
    .dsh-project-task-event{display:grid;grid-template-columns:100px minmax(0,1fr);gap:2px 8px;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);min-width:0}
    .dsh-project-task-event>span:last-child{grid-column:2;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
    .dsh-project-task-version{padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);min-width:0;overflow-wrap:anywhere}
    .dsh-project-task-version>summary{line-height:1.5}
    .dsh-project-task-version>summary time{margin-right:8px}
    .dsh-project-task-version>summary strong{color:var(--dsw-alias-label-primary)}
    .dsh-project-task-version .dsh-project-task-section{gap:4px}
    .dsh-project-team-member{display:flex;flex-direction:column;gap:8px;padding:12px 0 16px;border-bottom:.5px solid var(--dsw-alias-border-l2);min-width:0}
    .dsh-project-team-row{display:flex;align-items:flex-start;gap:8px;min-width:0;flex-wrap:wrap}
    .dsh-project-team-row>:not(.dsh-project-team-row-content){flex-shrink:0}
    .dsh-project-team-row-content{display:flex;flex:1;flex-direction:column;gap:4px;min-width:160px}
    .dsh-project-team-row-content strong{font-size:14px;line-height:22px;overflow-wrap:anywhere}
    .dsh-project-team-row-content small{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
    .dsh-project-team-context{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}
    .dsh-project-team-details>summary,.dsh-project-team-technical>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px}
    .dsh-project-team-assignments{display:flex;flex-direction:column;gap:8px;padding-top:8px;min-width:0}
    .dsh-project-team-technical dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:12px}
    .dsh-project-team-technical dt{color:var(--dsw-alias-label-secondary)}
    .dsh-project-team-technical dd{margin:0;overflow-wrap:anywhere}
    .dsh-project-visual-results,.dsh-project-result-files{display:flex;flex-direction:column;gap:12px;min-width:0;padding:8px 0}
    .dsh-project-visual-page{min-width:0;max-width:100%;overflow:hidden}
    .dsh-project-result-checks{padding:8px 0}
    .dsh-project-result-heading{align-items:flex-start;flex-wrap:wrap;line-height:24px}
    .dsh-project-team-work{display:flex;flex-direction:column;gap:5px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);min-width:0}
    .dsh-project-team-work strong{min-width:0;overflow-wrap:anywhere}
    .dsh-project-team-work p{margin:0}
    .dsh-project-team-work details p{white-space:pre-wrap;overflow-wrap:anywhere}
    @keyframes dsh-project-ticker{0%,15%{transform:translateX(0)}85%,100%{transform:translateX(var(--project-ticker-end))}}
    .dsh-project-task-tabs button{min-height:28px;height:28px;padding:0 8px;font:var(--dsw-font-xxs-12)}
    .dsh-project-task-tabs{position:sticky;top:0;z-index:1;padding:4px 0 8px;background:var(--dsw-alias-bg-panel-solid)}
    .dsh-project-header-panel{position:relative;flex:none;min-width:28px}
    .dsh-project-header-trigger{display:inline-flex;align-items:center;gap:5px;min-height:28px;min-width:28px;max-width:100%;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
    .dsh-project-header-trigger svg{flex:none}.dsh-project-header-trigger:hover,.dsh-project-header-trigger:focus-visible,.dsh-project-header-trigger[aria-expanded=true]{color:var(--dsw-alias-label-primary)}
    .dsh-project-header-trigger-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-header-badge{min-width:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}
    .dsh-project-header-badge[data-tone=info]{color:var(--dsw-alias-label-primary)}.dsh-project-header-badge[data-tone=warning]{color:var(--dsw-alias-state-warn-primary)}
    @container (max-width:560px){.dsh-project-header-trigger-label{display:none}.dsh-project-header-trigger{padding:0 4px;justify-content:center}}
    .dsh-project-header-surface{position:fixed;z-index:100;display:flex;flex-direction:column;box-sizing:border-box;width:min(460px,100vw - 32px);max-height:min(680px,calc(100vh - 32px));padding:8px 2px 0;overflow:hidden;border-radius:12px;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);outline:none}
    .dsh-project-header-surface[hidden]{display:none}.dsh-project-header-surface::before{content:'';position:absolute;z-index:-1;inset:0;border-radius:12px;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter)}
    .dsh-project-panel-body{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0;min-width:0;padding:0 9px 16px 14px;overflow-y:auto;scrollbar-gutter:stable}
    .dsh-project-requests-toolbar{display:flex;align-items:center;gap:4px;min-width:0;min-height:32px;flex:none}
    .dsh-project-requests-toolbar>strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--dsw-font-xxs-strong-12)}.dsh-project-requests-toolbar button{flex:none}
    .dsh-project-requests-current,.dsh-project-requests-list{display:flex;flex-direction:column;gap:8px;min-width:0}
    .dsh-project-requests-empty{padding:16px;background:var(--dsw-alias-bg-panel-solid);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;font:var(--dsw-font-s-14)}.dsh-project-requests-empty p{margin:8px 0 0;color:var(--dsw-alias-label-secondary)}
    .dsh-project-task-card{position:relative;isolation:isolate;min-width:0;border-radius:14px;color:var(--dsw-alias-label-primary)}
    .dsh-project-task-surface{position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;background:var(--dsw-alias-bg-panel-solid);border:1px solid var(--dsw-alias-border-l2)}
    .dsh-project-task-card:not([data-project-request-mode=strip]){padding:14px 16px 8px}.dsh-project-task-card[data-project-request-mode=strip]{height:44px;min-height:44px}
    .dsh-project-task-strip{display:flex;align-items:center;gap:0;height:44px;padding:0 4px;min-width:0}.dsh-project-task-strip-open{display:flex;align-items:center;justify-content:flex-start;gap:8px;flex:1;min-width:0;height:44px;padding:0 8px;font:var(--dsw-font-xxs-12)}
    .dsh-project-task-strip-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.dsh-project-task-strip-open>small{max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit;color:var(--dsw-alias-label-secondary)}.dsh-project-task-strip-open>svg,.dsh-project-task-strip>.dsh-project-task-queue-actions{flex:none}
    .dsh-project-task-card-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0}.dsh-project-task-title{display:block;flex:1;min-width:0;font:var(--dsw-font-base-strong-16);font-weight:600;line-height:24px;overflow-wrap:anywhere}
    .dsh-project-task-queue-actions{display:flex;align-items:center;gap:0;flex:none}.dsh-project-task-queue-actions>button{height:28px;min-height:28px;padding:0 6px}
    .dsh-project-task-meta{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;min-width:0;padding:8px 0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}.dsh-project-task-meta>span{min-width:0;overflow-wrap:anywhere}.dsh-project-task-meta>span:last-child{text-align:right;max-width:65%}.dsh-project-task-state{color:var(--dsw-alias-label-primary)}
    .dsh-project-task-summary{min-width:0;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}.dsh-project-task-summary>p{margin:0 0 8px;overflow-wrap:anywhere;font:var(--dsw-font-xxs-12)}
    .dsh-project-task-step{display:flex;align-items:flex-start;gap:8px;min-width:0;padding:6px 0;font:var(--dsw-font-xxs-12)}.dsh-project-task-step>span:not(.dsh-project-task-state-dot){flex:1;min-width:0;overflow-wrap:anywhere}.dsh-project-task-step>small{max-width:46%;min-width:0;text-align:right;color:var(--dsw-alias-label-secondary);font:inherit;overflow-wrap:anywhere}.dsh-project-task-step>svg{flex:none;margin-top:2px;color:var(--dsw-alias-state-success-primary)}
    .dsh-project-task-state-dot{display:block;flex:none;width:6px;height:6px;margin:6px 4px 0;border-radius:50%;background:var(--dsw-alias-label-secondary)}.dsh-project-task-strip .dsh-project-task-state-dot{margin-top:0}.dsh-project-task-state-dot[data-state=running]{background:var(--dsw-alias-state-business-primary)}.dsh-project-task-state-dot[data-state=blocked]{background:var(--dsw-alias-state-warn-primary)}
    .dsh-project-task-waiting{color:var(--dsw-alias-label-secondary)}.dsh-project-task-outcome{color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .dsh-project-task-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;padding-top:8px}.dsh-project-task-footer button{height:28px;min-height:28px;padding:0 8px;font:var(--dsw-font-xxs-12)}
    .dsh-project-task-full{min-height:0;max-height:min(420px,calc(100vh - 240px));overflow:auto;scrollbar-gutter:stable;scrollbar-color:var(--dsw-alias-border-l3) transparent}.dsh-project-task-tabs{position:sticky;top:0;z-index:1;padding:4px 0 8px;background:var(--dsw-alias-bg-panel-solid)}.dsh-project-task-tabs button{height:28px;min-height:28px;padding:0 8px;font:var(--dsw-font-xxs-12)}
    .dsh-project-observer-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;font:var(--dsw-font-xxs-strong-12)}.dsh-project-observer-section-heading>span{color:var(--dsw-alias-label-secondary);font-weight:400}
    .dsh-project-task-progress-track{height:3px;background:var(--dsw-alias-interactive-bg-active);border-radius:2px;margin:4px 0 6px;overflow:hidden}.dsh-project-task-progress-track>span{display:block;height:100%;background:var(--dsw-alias-state-business-primary)}
    .dsh-project-observer-flow{display:flex;align-items:center;gap:4px;min-width:0}.dsh-project-observer-flow>svg{flex:none;width:12px}.dsh-project-observer-flow-node{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0;padding:8px 4px;text-align:center;background:var(--dsw-alias-interactive-bg-hover);border-radius:8px;font:var(--dsw-font-xxs-12);overflow-wrap:anywhere}.dsh-project-observer-flow-node>span{color:var(--dsw-alias-label-secondary)}
    .dsh-project-observer-blocker,.dsh-project-observer-request-info{font:var(--dsw-font-xxs-12);overflow-wrap:anywhere}.dsh-project-observer-blocker{color:var(--dsw-alias-label-secondary)}
    .dsh-project-observer-team{display:flex;flex-direction:column;gap:8px;min-width:0}.dsh-project-observer-team>input{width:100%;box-sizing:border-box;height:32px;min-height:32px}
    .dsh-project-requests-list>.dsh-project-task-group-title{padding:8px 4px 0;font:var(--dsw-font-xxs-12)}
    .dsh-project-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:4px;background:var(--dsw-alias-bg-panel-solid);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;min-width:0}
    .dsh-project-board-cell{display:flex;flex-direction:column;gap:2px;min-width:0;padding:8px 12px}
    .dsh-project-board-cell+.dsh-project-board-cell{border-left:1px solid var(--dsw-alias-border-l1)}
    .dsh-project-board-cell>strong{font-size:16px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
    .dsh-project-board-cell[data-empty=true]>strong{color:var(--dsw-alias-label-tertiary);font-weight:400}
    .dsh-project-board-label{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dsh-project-tone-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
    .dsh-project-tone-dot[data-tone=info],.dsh-project-task-state-dot[data-tone=info]{background:var(--dsw-alias-state-business-primary)}
    .dsh-project-tone-dot[data-tone=warning],.dsh-project-task-state-dot[data-tone=warning]{background:var(--dsw-alias-state-warn-primary)}
    .dsh-project-tone-dot[data-tone=success],.dsh-project-task-state-dot[data-tone=success]{background:var(--dsw-alias-state-success-primary)}
    .dsh-project-tone-dot[data-tone=danger],.dsh-project-task-state-dot[data-tone=danger]{background:var(--dsw-alias-state-error-primary)}
    .dsh-project-task-state-dot[data-tone=neutral],.dsh-project-task-state-dot[data-tone=outline]{background:var(--dsw-alias-label-tertiary)}
    .dsh-project-task-status{display:flex;flex-direction:column;gap:8px;min-width:0;padding:8px 0}
    .dsh-project-task-status-row{display:flex;align-items:center;gap:8px;min-width:0}
    .dsh-project-task-status-row>.dsh-project-task-state{flex:none;display:inline-flex}
    .dsh-project-task-status-row>span:last-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
    .dsh-project-task-next{display:flex;flex-direction:column;gap:2px;min-width:0;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .dsh-project-task-next[data-tone=warning]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
    .dsh-project-task-next[data-tone=info]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent)}
    .dsh-project-task-next>span:first-child:not(:last-child){color:var(--dsw-alias-label-primary)}
    .dsh-project-task-next strong{font-weight:500;color:var(--dsw-alias-label-primary)}
    .dsh-project-task-footer-actions{display:flex;align-items:center;gap:4px;min-width:0}
    .dsh-project-charter-intro{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
    .dsh-project-charter-intro>strong{font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}
    .dsh-project-charter-intro>p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
    .dsh-project-charter-examples{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .dsh-project-charter-examples>span{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
    .dsh-project-charter-meter{display:flex;align-items:center;gap:12px;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
    .dsh-project-charter-meter-track{flex:1;height:3px;border-radius:2px;background:var(--dsw-alias-interactive-bg-active);overflow:hidden}
    .dsh-project-charter-meter-track>span{display:block;height:100%;background:var(--dsw-alias-label-tertiary)}
    .dsh-project-charter-meter[data-over=true]{color:var(--dsw-alias-state-error-primary)}
    .dsh-project-charter-meter[data-over=true] .dsh-project-charter-meter-track>span{background:var(--dsw-alias-state-error-primary)}
    .dsh-project-task-delivery{display:flex;flex-direction:column;gap:4px;min-width:0;padding:4px 0 8px}
    .dsh-project-task-files{display:flex;flex-direction:column;gap:0;min-width:0;margin:0 -8px}
    .dsh-project-task-file{display:flex;align-items:baseline;justify-content:flex-start;gap:8px;width:100%;min-width:0;height:auto;min-height:28px;padding:5px 8px;font-size:12px;line-height:18px;text-align:left}
    .dsh-project-task-file>span{flex:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary)}
    .dsh-project-task-file>small{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit;color:var(--dsw-alias-label-tertiary)}
    .dsh-project-task-delivery-actions{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-left:-8px}
    .dsh-project-diff{gap:12px}
    .dsh-project-diff-summary{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:13px;line-height:20px}
    .dsh-project-diff-summary>strong{font-weight:600}
    .dsh-project-diff-add{color:var(--dsw-alias-state-success-primary);font-variant-numeric:tabular-nums;font-size:12px}
    .dsh-project-diff-del{color:var(--dsw-alias-state-error-primary);font-variant-numeric:tabular-nums;font-size:12px}
    .dsh-project-diff-file{min-width:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-panel-solid)}
    .dsh-project-diff-file>summary{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 12px;list-style:none;cursor:pointer;font-size:12px;line-height:18px}
    .dsh-project-diff-file>summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dsh-project-diff-file[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l1)}
    .dsh-project-diff-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary)}
    .dsh-project-diff-name>span{color:var(--dsw-alias-label-tertiary)}
    .dsh-project-diff-lines{margin:0;padding:4px 0;max-height:360px;overflow:auto;font:12px/18px var(--ds-font-family-code);white-space:pre;tab-size:2;color:var(--dsw-alias-label-primary)}
    .dsh-project-diff-line{display:block;min-width:max-content;padding:0 12px}
    .dsh-project-diff-line[data-kind=add]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}
    .dsh-project-diff-line[data-kind=del]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
    .dsh-project-diff-line[data-kind=hunk]{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover)}
    .dsh-project-diff-line[data-kind=note]{color:var(--dsw-alias-label-tertiary)}
    .dsh-project-diff-note{margin:0;padding:8px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
    .dsh-project-task-changes{display:inline-flex;align-items:baseline;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
    .dsh-project-task-delivery-actions>.dsh-project-task-changes{margin-right:auto;padding-left:8px}
    .dsh-project-confirm-detail{margin:0;padding:8px 12px;max-height:160px;overflow:auto;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);font:12px/18px var(--ds-font-family-code);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}


  `;
  const requestId = () => globalThis.crypto.randomUUID();
  const button = (label, onClick, disabled = false) => h(Button, { variant: 'outline', onClick, disabled }, label);
  const markdown = (t, text) => h(MarkdownText, { text, labels: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') } });
  const stateLabel = (t, state) => Object.hasOwn(zh, state) ? t(state) : String(state ?? '');
  const waitingLabel = (t, waiting) => waiting ? `${t({ dependencies: 'waitingDependencies', directory: 'waitingDirectory', capacity: 'waitingCapacity' }[waiting.kind])}${waiting.workTitles?.length ? ` · ${waiting.workTitles.join('、')}` : ''}` : '';
  const workBlockedLabel = (t, reason) => reason === 'Application restarted; waiting for explicit continuation.' ? t('requestRestarted') : reason;
  const errorText = failure => failure?.message ?? String(failure);
  const messageText = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  const processRecords = entries => entries.filter(entry => entry.type === 'event' && ['turn/start', 'user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/end'].includes(entry.event.type)).map(entry => entry.event);
  const assignmentIndex = (records, messageId) => typeof messageId === 'string' && messageId ? records.findIndex(event => event.type === 'user/message' && (event.data.id === messageId || event.data.source?.messageId === messageId)) : -1;
  const assignmentPageStart = (records, index) => {
    const before = records.findLastIndex((event, at) => at < index && event.type === 'turn/start');
    return Math.max(0, before);
  };
  const assignmentPageEnd = (records, index, leadId) => {
    const next = records.findIndex((event, at) => at > index && event.type === 'user/message' && event.data.source?.kind === 'team-message' && event.data.source.senderId === leadId);
    if (next < 0) return records.length;
    const boundary = records.findLastIndex((event, at) => at > index && at < next && event.type === 'turn/start');
    return boundary < 0 ? next : boundary;
  };
  const timeLabel = value => Number.isFinite(value) && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString() : '';
  const recordedTime = value => timeLabel(value) ? h('time', { className: 'dsh-project-record-time', dateTime: new Date(value).toISOString() }, timeLabel(value)) : null;
  const summaryPreview = text => {
    const blocks = String(text ?? '').trim().split(/\n\s*\n/);
    const body = blocks.map(block => block.split('\n').filter(line => !/^\s*#{1,6}\s/.test(line)).join('\n').trim()).find(block => block && !/^\s*(```|~~~)/.test(block)) ?? blocks[0] ?? '';
    const preview = body.trim();
    return preview.length > 360 ? preview.slice(0, 360) + '…' : preview;
  };
  const requestLabel = (t, request) => request ? `${request.title} · ${t('requestVersion')} ${request.revision}` : '';
  const isLive = worker => Boolean(worker.activeRunId || worker.jobs?.length || worker.phase === 'stopping');
  const fileName = path => path.split(/[\\/]/).at(-1);
  // Why the desktop refuses a folder (see the desktop directory check), as locale keys.
  const DIRECTORY_REFUSALS = { missing: 'dirMissing', 'not-directory': 'dirNotDirectory', root: 'dirRoot', home: 'dirHome', 'system-data': 'dirSystemData', 'app-data': 'dirAppData' };
  const comparablePath = path => path.replaceAll('\\', '/').replace(/\/$/, '');
  const directoryParts = project => project.canonicalWorkingDirectory.replaceAll('\\', '/').replace(/\/$/, '').split('/').filter(Boolean);
  function Artifact({ file, open, busy, t }) {
    const [menu, setMenu] = useState(false), [locationOpen, setLocationOpen] = useState(false);
    const name = fileName(file.path), location = { materials: 'artifactMaterials', existing: 'artifactExisting', worktree: 'artifactWorktree' }[file.location];
    const size = Number.isFinite(file.size) ? file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB` : '';
    return h('div', { className: 'dsh-project-artifact' },
      h('div', { className: 'dsh-project-artifact-row' }, h(Button, { variant: 'ghost', className: 'dsh-project-artifact-title', title: file.path, 'aria-label': `${t('openFile')}: ${name}`, disabled: busy, onClick: () => open(file.path) }, name),
        size ? h('span', { className: 'dsh-project-muted' }, size) : null,
        h(Menu, { open: menu, onClose: () => setMenu(false), portal: true, compact: true, align: 'end', items: [{ id: 'location', label: t('fileLocation') }], onSelect: () => { setMenu(false); setLocationOpen(value => !value); }, anchor: h(Button, { variant: 'ghost', size: 'sm', 'aria-label': `${t('fileMore')}: ${name}`, 'aria-expanded': menu, onClick: () => setMenu(value => !value) }, '…') })),
      location ? h('div', { className: 'dsh-project-artifact-meta dsh-project-muted' }, t(location)) : null,
      locationOpen ? h('div', { className: 'dsh-project-path' }, file.path) : null);
  }

  function SummaryFailure({ failure, openModelSettings, t }) {
    const credentials = failure.error.code === 'MISSING_CREDENTIAL';
    return h(Fragment, null,
      h('p', { className: 'dsh-project-error' }, t('summaryFailed')),
      h('p', { className: 'dsh-project-muted' }, t(credentials ? 'summaryCredentialHint' : 'summaryErrorHint')),
      credentials ? button(t('modelSettings'), openModelSettings) : null,
      h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, `${failure.error.code}\n${failure.error.message}`)));
  }

  function ProjectLifecycleDialog({ useStore, actions, useProjects, command, t }) {
    const lifecycle = useStore(value => value.lifecycle), project = useProjects(value => value.projects.find(item => item.id === lifecycle?.projectId));
    const [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => { setTitle(project?.title ?? ''); setError(''); }, [lifecycle]);
    if (!lifecycle) return null;
    const close = () => { if (!busy) actions.setLifecycle(null); };
    const execute = async () => { setBusy(true); setError(''); try { await command(project.id, lifecycle.action, lifecycle.action === 'rename' ? { title } : undefined); actions.setLifecycle(null); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    const unavailable = lifecycle.error || !project;
    return h(Modal, { open: true, onClose: close, closeLabel: t('cancel'), className: 'dsh-project-confirm', title: t(unavailable ? 'unavailable' : lifecycle.action === 'rename' ? 'rename' : 'archiveActive'), footer: h('div', { className: 'dsh-project-actions' }, button(t('cancel'), close, busy), unavailable ? null : button(t(lifecycle.action === 'rename' ? 'save' : 'archiveActive'), execute, busy || lifecycle.action === 'rename' && !title.trim())) },
      unavailable ? h('p', { role: 'alert', className: 'dsh-project-error' }, lifecycle.error || t('unavailable')) : lifecycle.action === 'rename' ? h(Input, { value: title, maxLength: 240, 'aria-label': t('rename'), onChange: event => setTitle(event.target.value) }) : h('p', null, t('archiveHint')),
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  // Project Leads list among ordinary conversations; this tag marks them.
  function ProjectRowBadge({ sessionId, useProjects, t }) {
    const project = useProjects(value => value.projects.some(item => item.coordinatorSessionId === sessionId));
    return project ? h('span', { className: 'dsh-project-row-badge' }, t('tab')) : null;
  }

  // Background failures (list refresh, detail reload) have no panel of their own;
  // each distinct message is shown once, and a recovery lets it show again.
  function ProjectErrorNotice({ useProjects, t }) {
    const error = useProjects(value => value.error);
    const [dismissed, setDismissed] = useState('');
    useEffect(() => { if (!error) setDismissed(''); }, [error]);
    if (!error || error === dismissed) return null;
    return h(Toast, { key: error, text: t('backgroundError').replace('{message}', error), holdMs: 8000, onDone: () => setDismissed(error) });
  }

  // New Session option: start (or reopen) the selected directory's Project and carry the draft into its Lead.
  // A folder the desktop refuses keeps the option visible but disabled, with its reason.
  function ProjectHeroOption({ sessionId, openWithDraft, startProject, checkDirectory, useProjects, useProjectSessions, useWorkspaceList, useDirectoryChecks, t }) {
    const available = useProjects(value => value.available), cwd = useProjectSessions(value => value.byId[sessionId]?.cwd);
    const scratch = useWorkspaceList(value => value.scratchCwd);
    const existing = useProjects(value => Boolean(cwd) && value.projects.some(project => project.lifecycle !== 'archived' && comparablePath(project.canonicalWorkingDirectory) === comparablePath(cwd)));
    const refusal = useDirectoryChecks(value => cwd ? value[comparablePath(cwd)]?.reason : undefined);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => { if (available && cwd && cwd !== scratch) checkDirectory(cwd); }, [available, cwd, scratch]);
    if (!available || !cwd || cwd === scratch) return null;
    const start = async () => { setBusy(true); setError(''); try { await startProject(cwd, openWithDraft); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    const reason = refusal ? t(DIRECTORY_REFUSALS[refusal] ?? 'unavailable') : '';
    const option = h(Button, { variant: 'ghost', size: 'sm', className: 'dsh-project-hero-option', title: reason ? undefined : t(existing ? 'heroOpenHint' : 'heroHint'), 'aria-busy': busy || undefined, 'aria-description': reason || undefined, disabled: busy || Boolean(reason), onClick: () => { void start(); } },
      h(IconChecklistOutlineRegular, { size: 16 }), t('tab'));
    return h(Fragment, null,
      // A disabled button receives no pointer events, so the reason's tooltip anchors on a focusable wrapper.
      reason ? h(Tooltip, { label: reason, side: 'bottom', align: 'end', portal: true, maxWidth: 280 }, h('span', { className: 'dsh-project-hero-option-wrap', tabIndex: 0 }, option)) : option,
      error ? h(Toast, { text: error, holdMs: 6000, onDone: () => setError('') }) : null);
  }

  // One header trigger with an anchored panel, matching the native Team action:
  // hover opens after 150ms when the label is visible, a click pins it, and
  // Escape, an outside pointer or a native file preview closes it. Project
  // dialogs open above it, so closing one returns to the same panel.
  function HeaderPanel({ id, icon, label, badge, tone, useDismissals, children }) {
    const [open, setOpen] = useState(false), [visited, setVisited] = useState(false), rootRef = useRef(null), triggerRef = useRef(null), labelRef = useRef(null), panelRef = useRef(null);
    const timer = useRef(), pinned = useRef(false), dismissedByKey = useRef(false), dismissals = useDismissals(value => value);
    const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16 });
    const cancel = () => { clearTimeout(timer.current); timer.current = undefined; };
    const change = next => { cancel(); if (!next) pinned.current = false; else setVisited(true); setOpen(next); };
    useEffect(() => cancel, []);
    useEffect(() => { change(false); }, [dismissals]);
    useLayoutEffect(() => { if (open && position && pinned.current) panelRef.current?.focus(); }, [open, Boolean(position)]);
    useEffect(() => {
      if (!open) return;
      const outside = event => {
        const target = event.target;
        if (!target || rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
        // Menus inside the panel portal their lists to the body; dialogs stack above it.
        if (target.closest?.('[role="menu"], [role="dialog"][aria-modal="true"]')) return;
        change(false);
      };
      const escape = event => {
        if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')) return;
        event.preventDefault(); dismissedByKey.current = true;
        const inside = panelRef.current?.contains(document.activeElement);
        change(false); if (inside) triggerRef.current?.focus();
      };
      document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
      return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
    }, [open]);
    const hoverOpen = () => {
      cancel();
      if (open || dismissedByKey.current || !labelRef.current || getComputedStyle(labelRef.current).display === 'none') return;
      timer.current = setTimeout(() => change(true), 150);
    };
    const hoverClose = () => {
      cancel(); dismissedByKey.current = false;
      if (!pinned.current) timer.current = setTimeout(() => change(false), 120);
    };
    return h('div', { ref: rootRef, className: 'dsh-project-header-panel', 'data-project-header-panel': id, onMouseLeave: hoverClose },
      h('button', { type: 'button', ref: triggerRef, className: 'dsh-project-header-trigger', 'aria-label': label, title: label, 'aria-haspopup': 'dialog', 'aria-expanded': open,
        onMouseEnter: hoverOpen, onClick: () => { cancel(); dismissedByKey.current = false; pinned.current = true; if (!open) change(true); else panelRef.current?.focus(); } },
        icon, h('span', { ref: labelRef, className: 'dsh-project-header-trigger-label' }, label),
        badge ? h('span', { className: 'dsh-project-header-badge', 'data-tone': tone }, badge) : null),
      // Once opened, the contents stay mounted while hidden so tabs, pages and expanded cards survive a close.
      visited ? createPortal(h('div', { ref: panelRef, className: 'dsh-project-header-surface', 'data-project-panel': id, role: 'dialog', tabIndex: -1, 'aria-label': label, hidden: !open,
        style: position ?? { visibility: 'hidden', left: 0, top: 0 }, onMouseEnter: cancel, onMouseLeave: hoverClose,
        onFocusCapture: () => { pinned.current = true; }, onPointerDownCapture: () => { pinned.current = true; } }, children), document.body) : null);
  }

  function useProjectLive({ useProjects, useProjectSessions, useProjectSessionStatus }, sessionId, project) {
    const detail = useProjects(value => project ? value.details[project.id] : undefined);
    const team = useProjectSessions(value => value.projectionsBySession[sessionId]?.values.agentTeam);
    const summarySessions = useProjectSessions(value => value.byId), statuses = useProjectSessionStatus(value => value);
    const sessions = Object.fromEntries([...new Set([...Object.keys(summarySessions), ...statuses.keys()])].map(id => [id, { ...summarySessions[id], running: statuses.get(id)?.running ?? summarySessions[id]?.running }]));
    return { detail, team, sessions };
  }

  function ProjectTeamPanel(props) {
    const { sessionId, project, readDetail, showProcess, teamT, t } = props;
    const { detail, team, sessions } = useProjectLive(props, sessionId, project);
    const [error, setError] = useState('');
    useEffect(() => { void readDetail(project.id).catch(failure => setError(errorText(failure))); }, [project.id]);
    return h('section', { className: 'dsh-project-panel-body', 'aria-label': t('team') },
      h(ProjectTeamOverview, { team, sessions, detail, openMember: workerSessionId => showProcess(project.id, workerSessionId, true), teamT, t }),
      error ? h(Toast, { text: error, onDone: () => setError('') }) : null);
  }

  function ProjectHeader(props) {
    const { sessionId, useProjects, useDismissals, read, trackActiveProject, teamT, t } = props;
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    const [openFailure, setOpenFailure] = useState(null);
    useEffect(() => { if (project) return trackActiveProject(project.id); }, [project?.id]);
    if (!project) return null;
    const directory = directoryParts(project).at(-1) || project.canonicalWorkingDirectory;
    const queue = project.queue, waiting = (queue?.queued?.length ?? 0) + (queue?.discussingCount ?? 0);
    const tone = project.paused || project.activity?.blocked ? 'warning' : queue?.active ? 'info' : 'neutral';
    return h('div', { className: 'dsh-project-header' },
      h(Button, { variant: 'ghost', size: 'sm', className: 'dsh-project-header-directory', onClick: () => { void read(project.id, 'open').catch(failure => setOpenFailure(previous => ({ seq: (previous?.seq ?? 0) + 1, text: `${t('openDirectory')}: ${errorText(failure)}` }))); }, title: project.canonicalWorkingDirectory },
        h(IconFolderCloseRegular, { size: 16 }), h('span', { className: 'dsh-project-header-path' }, directory)),
      h(HeaderPanel, { id: 'team', icon: h(IconUsersOutlineRegular, { size: 14 }), label: teamT('trigger'), useDismissals },
        h(ProjectTeamPanel, { ...props, project })),
      h(HeaderPanel, { id: 'requests', icon: h(IconChecklistOutlineRegular, { size: 14 }), label: t('requirements'), useDismissals,
        badge: queue?.active || waiting ? String((queue?.active ? 1 : 0) + waiting) : '', tone },
        h(ProjectRequirements, { ...props, project })),
      openFailure ? h(Toast, { key: openFailure.seq, text: openFailure.text, holdMs: 6000, onDone: () => setOpenFailure(null) }) : null);
  }

  const requestStateLabel = (t, card, position = true) => card.status === 'completed' ? t('completed')
    : card.queue?.state === 'queued' ? `${t('requestQueued')}${position && card.queue.position ? ` · ${t('requestQueuePosition').replace('{position}', card.queue.position)}` : ''}`
    : card.queue?.state === 'discussing' ? t('requestDiscussing') : card.queue?.state === 'cancelled' ? t('requestCancelled') : stateLabel(t, card.status);
  const requestQueueNote = (t, card, queue) => card.status === 'completed' ? ''
    : card.queue?.state === 'queued' ? t(queue?.paused ? 'requestQueuePaused' : !queue?.active && card.queue.position === 1 ? 'requestQueueReady' : 'requestQueueWaiting')
    : card.queue?.state === 'discussing' ? t('requestDiscussingHint') : card.queue?.state === 'cancelled' ? t('requestCancelledHint') : '';
  const requestQueueItems = (card, queue, busy, t) => {
    if (!card.queue || card.status === 'completed' || card.archivedAt) return [];
    const state = card.queue.state, index = queue?.queued?.findIndex(item => item.id === card.id) ?? -1;
    return [
      ...(state === 'discussing' ? [{ id: 'enqueue', label: t('requestEnqueue'), disabled: busy }] : []),
      ...(state === 'cancelled' || card.queue.released ? [{ id: 'enqueue', label: t('requestRejoin'), disabled: busy }] : []),
      ...(card.id === queue?.active?.id && !card.queue.released && (queue.paused || card.status === 'paused') ? [{ id: 'resume', label: t('requestResume'), disabled: busy }] : []),
      ...(state === 'queued' && queue?.paused && !queue.active && index === 0 ? [{ id: 'resume', label: t('requestResumeQueue'), disabled: busy }] : []),
      ...(state === 'queued' ? [{ id: 'moveUp', label: t('requestMoveUp'), disabled: busy || index <= 0 },
        { id: 'moveDown', label: t('requestMoveDown'), disabled: busy || index < 0 || index >= queue.queued.length - 1 }] : []),
      ...(['discussing', 'queued', 'active'].includes(state) ? [{ id: 'cancel', label: t('requestCancel'), danger: true, disabled: busy }] : []),
    ];
  };
  const humanNextKeys = { dependencies: 'nextDependencies', directory: 'nextDirectory', capacity: 'nextCapacity' };
  // One plain-language status per requirement: tone for the badge, an optional reason and the user's next step.
  const requestHumanStatus = (project, card, state, steps, queue, t) => {
    const status = (tone, label, next, reason) => ({ tone, label: t(label), ...(next ? { next: t(next) } : {}), ...(reason ? { reason } : {}) });
    const waiting = steps.find(item => item.waitingReason || item.blockedReason);
    if (card.archivedAt) return status('neutral', 'statusArchived');
    if (card.queue?.state === 'cancelled') return status('neutral', 'statusCancelled', 'nextCancelled');
    if (card.status === 'completed' && card.changes?.revertedAt) return status('neutral', 'statusReverted', 'nextReverted');
    if (card.status === 'completed') return status('success', 'statusDelivered');
    if (card.status === 'needsReview') return status('warning', 'statusNeedsReview', 'nextNeedsReview');
    if (card.queue?.state === 'discussing') return status('neutral', 'statusDiscussing', 'nextDiscussing');
    if (card.queue?.state === 'queued') return { ...status('outline', 'statusQueued', queue?.paused ? 'nextQueuedPaused' : steps.some(item => item.status === 'running') ? 'nextQueuedPreparing' : 'nextQueued'),
      label: card.queue.position ? `${t('statusQueued')} · ${t('statusQueuePosition').replace('{position}', card.queue.position)}` : t('statusQueued') };
    if (card.status === 'stopping' || project.activity?.state === 'stopping') return status('neutral', 'statusStopping');
    if (card.status === 'paused' || project.paused) return status('warning', 'statusPaused', 'nextPaused');
    if (card.authorityError) return status('warning', 'statusBlocked', 'nextAuthority', t('authorityErrorHint'));
    if (card.status === 'summaryFailed' || card.handoverError) return status('warning', 'statusBlocked', 'nextSummary', t('summaryFailed'));
    if (card.status === 'blocked' && card.delivery?.outcome === 'partial') return status('warning', 'statusPartial', 'nextPartial');
    if (waiting?.waitingReason) return card.status === 'blocked'
      ? status('warning', 'statusBlocked', humanNextKeys[waiting.waitingReason.kind], waitingLabel(t, waiting.waitingReason))
      : status('info', 'statusActive', humanNextKeys[waiting.waitingReason.kind], waitingLabel(t, waiting.waitingReason));
    if (card.status === 'blocked') return status('warning', 'statusBlocked', 'nextFailure', waiting?.blockedReason ? workBlockedLabel(t, waiting.blockedReason) : '');
    return status('info', 'statusActive', '', state === 'requestArranging' ? t('requestArrangingHint') : '');
  };
  // Delivered files, the requirement's own changes, revert and its result page, shown on the task card itself.
  function ProjectTaskDelivery({ project, card, controls, read, openResults, t }) {
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirm, setConfirm] = useState(null);
    const delivery = card.delivery, changes = card.changes;
    if (!delivery || !Array.isArray(delivery.artifacts) || !(card.status === 'completed' || delivery.outcome === 'partial')) return null;
    const files = delivery.artifacts, pages = delivery.pages ?? [], diffWork = (card.work ?? []).find(item => item.memberRole && item.memberRole !== 'readonly');
    const requirementDiff = changes?.isGit && changes.fileCount !== undefined;
    if (!files.length && !pages.length && !diffWork && !requirementDiff) return null;
    const open = async file => {
      setBusy(true);
      try { const value = await read(project.id, 'open', { workstreamId: file.workstreamId, delegationRef: file.delegationRef, path: file.path }); if (value?.modifiedSinceReport) setMessage(t('modifiedArtifact')); }
      catch (failure) { setMessage(errorText(failure)); } finally { setBusy(false); }
    };
    const revert = async () => {
      setBusy(true);
      try { await controls.revert(card); setConfirm(null); setMessage(t('revertDone')); }
      catch (failure) { setConfirm(failure.code === 'revert_conflict' ? { conflict: errorText(failure) } : null); if (failure.code !== 'revert_conflict') setMessage(errorText(failure)); }
      finally { setBusy(false); }
    };
    const ask = async () => { setConfirm(null); try { await controls.ask(t('revertAskPrompt').replace('{title}', card.title)); } catch (failure) { setMessage(errorText(failure)); } };
    return h('section', { className: 'dsh-project-task-delivery', 'aria-label': t('deliveryFiles') },
      files.length ? h(Fragment, null,
        h('div', { className: 'dsh-project-observer-section-heading' }, h('strong', null, t('deliveryFiles')), h('span', null, t('deliveryFileCount').replace('{count}', files.length))),
        h('div', { className: 'dsh-project-task-files' }, files.slice(0, 4).map(file => {
          const name = fileName(file.path), folder = file.path.slice(0, file.path.length - name.length).replace(/[\\/]$/, '');
          return h(Button, { key: `${file.workstreamId}:${file.delegationRef}:${file.path}`, variant: 'ghost', size: 'sm', className: 'dsh-project-task-file', title: file.path,
            'aria-label': `${t('openFile')}: ${name}`, disabled: busy, onClick: () => { void open(file); } }, h('span', null, name), folder ? h('small', null, folder) : null);
        }))) : null,
      h('div', { className: 'dsh-project-task-delivery-actions' },
        requirementDiff ? h('span', { className: 'dsh-project-task-changes' }, t('changeStats').replace('{count}', changes.fileCount),
          changes.added ? h('span', { className: 'dsh-project-diff-add' }, `+${changes.added}`) : null, changes.removed ? h('span', { className: 'dsh-project-diff-del' }, `−${changes.removed}`) : null) : null,
        requirementDiff || diffWork ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => requirementDiff ? controls.showRequestDiff(card.id) : controls.showDiff(project.id, diffWork.workstreamId) }, t('viewChanges')) : null,
        pages.length ? h(Button, { variant: 'ghost', size: 'sm', onClick: openResults }, t('viewResultPage'))
          : files.length > 4 ? h(Button, { variant: 'ghost', size: 'sm', onClick: openResults }, t('moreFiles').replace('{count}', files.length)) : null,
        changes?.revertible && project.lifecycle === 'ready' && !project.archiving ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy || controls.busy, onClick: () => setConfirm({}) }, t('revertChanges')) : null),
      confirm ? h(Modal, { open: true, onClose: () => { if (!busy) setConfirm(null); }, closeLabel: t('cancel'), title: t(confirm.conflict ? 'revertConflictTitle' : 'revertTitle'), className: 'dsh-project-confirm',
        footer: h('div', { className: 'dsh-project-actions' }, button(t('cancel'), () => setConfirm(null), busy),
          confirm.conflict ? h(Button, { variant: 'primary', onClick: () => { void ask(); } }, t('revertAsk'))
            : h(Button, { variant: 'primary', disabled: busy, onClick: () => { void revert(); } }, t('revertConfirm'))) },
        h('p', null, t(confirm.conflict ? 'revertConflictBody' : 'revertBody')), confirm.conflict ? h('pre', { className: 'dsh-project-confirm-detail' }, confirm.conflict) : null) : null,
      message ? h(Toast, { text: message, onDone: () => setMessage('') }) : null);
  }
  function ProjectRequestQueueActions({ card, queue, changeQueue, busy, t }) {
    const [menu, setMenu] = useState(false);
    const items = requestQueueItems(card, queue, busy, t);
    if (!items.length) return null;
    const primary = items.find(item => ['enqueue', 'resume'].includes(item.id));
    return h('div', { className: 'dsh-project-task-queue-actions' },
      primary ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => changeQueue(card, primary.id) }, primary.label) : null,
      h(Menu, { open: menu, onClose: () => setMenu(false), portal: true, compact: true, align: 'end', items,
        onSelect: action => { setMenu(false); changeQueue(card, action); },
        anchor: h(Button, { variant: 'ghost', size: 'sm', 'aria-label': `${card.title} · ${t('more')}`, disabled: busy, onClick: () => setMenu(value => !value) }, '…') }));
  }

  function ProjectTaskCard({ card: preview, project, resourceRevision, mode, setMode, read, team, sessions, controls, queue, changeQueue, archive, retryHandover, showProcess, showReport, renderFactorySlot, t }) {
    const [saved, setSaved] = useState(null), [error, setError] = useState(''), [menu, setMenu] = useState(false), [tab, setTab] = useState('overview');
    const bodyRef = useRef(null), expanded = mode !== 'strip';
    useEffect(() => {
      if (!expanded) return;
      let live = true;
      void read(project.id, 'requests/get', { requestId: preview.id }).then(value => { if (live) { setSaved(value.card); setError(''); } })
        .catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [project.id, preview.id, preview.revision, resourceRevision, expanded]);
    useLayoutEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [tab]);
    const card = saved?.revision === preview.revision ? saved : preview;
    const done = card.status === 'completed', steps = projectRequestSteps(card, team, t, sessions);
    const executor = projectRequestExecutor(project, card, team, t, sessions), state = projectRequestStage(project, card, steps);
    const label = ['requestArranging', 'requestHandover'].includes(state) ? t(state) : requestStateLabel(t, card);
    const human = requestHumanStatus(project, card, state, steps, queue, t);
    const waiting = steps.find(item => item.waitingReason || item.blockedReason);
    const queueItems = project.lifecycle === 'ready' && !project.archiving ? requestQueueItems(card, queue, controls.busy, t) : [];
    const primary = queueItems.find(item => ['enqueue', 'resume'].includes(item.id));
    const archiveItems = project.lifecycle === 'ready' && !project.archiving && (done || card.archivedAt)
      ? [{ id: 'archive', label: t(card.archivedAt ? 'taskRestoreAction' : 'taskArchiveAction'), disabled: controls.busy }] : [];
    const more = h(Menu, { open: menu, onClose: () => setMenu(false), portal: true, compact: true, align: 'end',
      items: [...queueItems, ...archiveItems], onSelect: action => { setMenu(false); if (action === 'archive') archive(card); else changeQueue(card, action); },
      anchor: h(Button, { variant: 'ghost', size: 'sm', 'aria-label': `${card.title} · ${t('more')}`, onClick: () => setMenu(value => !value) }, h(IconEllipsisOutlineRegular, { size: 16 })) });
    return h('article', { className: 'dsh-project-task-card', 'data-project-request-id': card.id, 'data-project-request-mode': mode, 'data-project-request-status': state },
      h('div', { className: 'dsh-project-task-surface', 'aria-hidden': true }),
      mode === 'strip' ? h('div', { className: 'dsh-project-task-strip' },
        h(Button, { variant: 'ghost', className: 'dsh-project-task-strip-open', 'aria-label': `${card.title} · ${label}`, 'aria-expanded': false, onClick: () => setMode('card'), title: `${card.title} · ${label} · ${executor.name}` },
          done ? h(IconCheckOutlineRegular, { size: 14 }) : h('span', { className: 'dsh-project-task-state-dot', 'data-state': state, 'data-tone': human.tone, 'aria-hidden': true }),
          h('span', { className: 'dsh-project-task-strip-title' }, card.title), h('small', null, card.queue?.state === 'queued' ? human.label : done && (card.delivery?.artifactCount ?? card.delivery?.artifacts?.length) ? `${human.label} · ${t('stripFileCount').replace('{count}', card.delivery.artifactCount ?? card.delivery.artifacts.length)}` : `${human.label} · ${executor.name}`),
          h(IconChevronDownOutlineRegular, { size: 14 })), queueItems.length || archiveItems.length ? more : null) : h(Fragment, null,
        h('div', { className: 'dsh-project-task-card-heading' }, h('strong', { className: 'dsh-project-task-title' }, card.title),
          h('div', { className: 'dsh-project-task-queue-actions' }, queueItems.length || archiveItems.length ? more : null,
            h(Button, { variant: 'ghost', size: 'sm', 'aria-label': `${card.title} · ${t('observerStrip')}`, onClick: () => setMode('strip') }, h(IconChevronUpOutlineRegular, { size: 14 })))),
        h('div', { className: 'dsh-project-task-status' }, h('div', { className: 'dsh-project-task-status-row' }, h('span', { role: 'status', className: 'dsh-project-task-state' }, h(Tag, { tone: human.tone }, human.label)),
          h('span', null, executor.name, ' · ', state === 'requestArranging' ? t('requestArranging') : executor.stage)),
          mode === 'card' && (human.reason || human.next) ? h('div', { className: 'dsh-project-task-next', 'data-tone': human.tone },
            human.reason ? h('span', null, human.reason) : null, human.next ? h('span', null, h('strong', null, t('nextStep')), human.next) : null) : null),
        mode === 'card' ? h('div', { className: 'dsh-project-task-summary' },
          done && card.delivery?.summaryPreview ? h('p', { className: 'dsh-project-task-outcome' }, summaryPreview(card.delivery.summary ?? card.delivery.summaryPreview)) : null,
          h(ProjectTaskDelivery, { project, card, controls, read, openResults: () => { setTab('results'); setMode('full'); }, t }),
          steps.length ? h(Fragment, null, h('div', { className: 'dsh-project-observer-section-heading' }, h('strong', null, t('observerTaskProgress')),
            h('span', null, `${steps.filter(item => item.status === 'completed').length} / ${steps.length} ${t('taskWorkCount')}`)),
            h('div', { className: 'dsh-project-task-progress-track', role: 'progressbar', 'aria-label': t('observerTaskProgress'), 'aria-valuemin': 0, 'aria-valuemax': steps.length, 'aria-valuenow': steps.filter(item => item.status === 'completed').length }, h('span', { style: { width: `${steps.filter(item => item.status === 'completed').length / steps.length * 100}%` } })),
            steps.slice(0, 3).map(item => h('div', { key: `${item.workstreamId}:${item.delegationRef}`, className: 'dsh-project-task-step' },
              item.status === 'completed' ? h(IconCheckOutlineRegular, { size: 14 }) : h('span', { className: 'dsh-project-task-state-dot', 'data-state': item.status, 'aria-hidden': true }),
              h('span', null, item.title), h('small', null, item.executor, ' · ', stateLabel(t, item.status)))))
            : !done && !human.next && !human.reason ? h('p', { className: 'dsh-project-task-waiting' }, t('observerNoTodo')) : null,
          null,
          h('div', { className: 'dsh-project-task-footer' }, h('div', { className: 'dsh-project-task-footer-actions' }, primary ? h(Button, { variant: 'ghost', size: 'sm', disabled: controls.busy, onClick: () => changeQueue(card, primary.id) }, primary.label) : null,
            ['discussing', 'queued'].includes(card.queue?.state) && queueItems.some(item => item.id === 'cancel') ? h(Button, { variant: 'ghost', size: 'sm', disabled: controls.busy, onClick: () => changeQueue(card, 'cancel') }, t('requestUndo')) : null),
            h(Button, { variant: 'ghost', size: 'sm', onClick: () => setMode('full') }, t('taskDetail'), h(IconChevronRightOutlineRegular, { size: 14 }))))
          : h(Fragment, null, h('div', { ref: bodyRef, className: 'dsh-project-task-full' }, saved ? h(ProjectTaskDetail, { projectId: project.id, card, tab, setTab, resourceRevision,
              read, showProcess, showReport, controls, retryHandover, queue, changeQueue, renderFactorySlot, embedded: true, t }) : h('p', { role: 'status' }, t('loading'))),
            h('div', { className: 'dsh-project-task-footer' }, h(Button, { variant: 'ghost', size: 'sm', onClick: () => setMode('card') }, t('observerCard'), h(IconChevronUpOutlineRegular, { size: 14 }))))),
      error ? h(Toast, { text: error, onDone: () => setError('') }) : null);
  }

  function projectMemberDisplayName(member, work, t) {
    if (member.role === 'lead') return t('teamLead');
    const name = member.name?.trim();
    const internalName = name === `member-${member.id?.replace(/^session-/, '')}`
      || /^member-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name ?? '');
    return name && !internalName ? name : work?.title || work?.subject || member.description || t('teamMember');
  }

  function projectRequestSteps(card, team, t, sessions = {}) {
    return (card?.work ?? card?.workPreview ?? []).map(work => {
      const historical = card.status === 'completed' || card.queue?.released || work.current === false;
      const task = historical ? undefined : team?.tasks?.find(item => item.id === work.workstreamId);
      const member = historical ? undefined : team?.members?.find(item => task?.ownerName ? item.name === task.ownerName : item.id === work.workerSessionId);
      const title = task?.subject || work.title, name = projectMemberDisplayName(member ?? { name: work.memberName }, work, t);
      const roleKey = { development: 'requestRoleDevelopment', readonly: 'requestRoleReview', docs: 'requestRoleDocs' }[work.memberRole];
      const executorName = name === title || name === work.title ? t('teamMember') : name;
      const executor = roleKey ? executorName === t('teamMember') ? t(roleKey) : `${t(roleKey)} · ${executorName}` : executorName;
      const blocked = task?.blockedBy?.filter(id => team.tasks.find(item => item.id === id)?.status !== 'completed') ?? [];
      const dependencyBlocked = blocked.length > 0 || task?.status === 'pending' && task.ready === false;
      const running = sessions[member?.id ?? work.workerSessionId]?.running;
      const status = task ? task.status === 'completed' ? 'completed' : task.status === 'deleted' ? 'deleted' : dependencyBlocked ? 'blocked'
        : task.status === 'in_progress' ? running === true ? 'running' : 'teamAssigned' : 'queued' : work.status;
      return { ...work, title, status, executor,
        ...(dependencyBlocked ? { waitingReason: { kind: 'dependencies', workTitles: blocked.map(id => team.tasks.find(item => item.id === id)?.subject).filter(Boolean) } } : {}) };
    });
  }

  function projectRequestStage(project, card, steps) {
    return card?.queue?.state === 'active' && !card.queue.released && !project.paused && !steps.length && !card.delivery && !card.handoverError && !card.authorityError
      ? 'requestArranging' : card?.status === 'pendingDelivery' && steps.length && steps.every(item => item.status === 'completed') ? 'requestHandover' : card?.status ?? project.activity?.state ?? 'idle';
  }

  function projectRequestExecutor(project, card, team, t, sessions) {
    if (card?.status === 'completed') return { name: t('teamLead'), stage: t('completed') };
    if (project.archiving || project.activity?.state === 'stopping') return { name: t('teamLead'), stage: t('stopping') };
    const steps = projectRequestSteps(card, team, t, sessions);
    if (projectRequestStage(project, card, steps) === 'requestArranging') return { name: t('teamLead'), stage: t('requestArranging') };
    if (card?.queue && (card.queue.state !== 'active' || card.queue.released)) return { name: t('teamLead'), stage: requestStateLabel(t, card, false) };
    const work = steps.find(item => item.status === 'running');
    if (work) return { name: work.executor, stage: stateLabel(t, work.status), title: work.title, sessionId: work.workerSessionId };
    if (project.activity?.coordinatorRunning) return { name: t('teamLead'), stage: stateLabel(t, project.activity.pendingSummary ? 'pendingSummary' : 'running'), sessionId: project.coordinatorSessionId };
    return { name: t('teamLead'), stage: stateLabel(t, card?.status ?? 'observerIdle') };
  }

  function ProjectRequestFlow({ card, t }) {
    const work = card.work ?? [], reports = work.filter(item => item.reportId).length;
    const nodes = [
      { title: t('workRequest'), label: t('observerRegistered'), state: 'registered' },
      { title: t('team'), label: work.length ? `${work.filter(item => item.status === 'completed').length} / ${work.length}` : t('observerNoTodo'), state: 'assigned' },
      { title: t('reportSource'), label: t('observerReportCount').replace('{count}', reports), state: 'reported' },
      { title: t('observerDeliverToYou'), label: stateLabel(t, card.status), state: card.status },
    ];
    return h('section', { className: 'dsh-project-task-section', 'aria-label': t('observerFlow') },
      h('div', { className: 'dsh-project-observer-section-heading' }, h('strong', null, t('observerFlow'))),
      h('div', { className: 'dsh-project-observer-flow' }, nodes.map((node, index) => h(Fragment, { key: node.title },
        index ? h(IconChevronRightOutlineRegular, { size: 12, 'aria-hidden': true }) : null,
        h('div', { className: 'dsh-project-observer-flow-node', 'data-state': node.state }, h('strong', null, node.title), h('span', null, node.label))))));
  }

  function ProjectTeamOverview({ team, detail, sessions, openMember, teamT, t }) {
    const [query, setQuery] = useState(''), [memberPage, setMemberPage] = useState(0), [workPage, setWorkPage] = useState(0);
    const search = query.trim().toLocaleLowerCase(), allWork = team?.tasks ?? [], streams = detail?.workstreams ?? [];
    const workers = detail?.workers ?? [], allMembers = [...(team?.members ?? [])], activity = detail?.project?.activity;
    for (const worker of workers) if (!allMembers.some(member => member.id === worker.sessionId)) {
      allMembers.push({ id: worker.sessionId, role: 'member', description: streams.find(work => work.workerSessionId === worker.sessionId)?.title });
    }
    const matches = value => String(value ?? '').toLocaleLowerCase().includes(search);
    const rows = allMembers.map(member => {
      const worker = workers.find(item => item.sessionId === member.id);
      const work = streams.find(item => item.workerSessionId === member.id);
      const tasks = allWork.filter(item => (member.name && item.ownerName === member.name) || item.id === work?.id)
        .toReversed().sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed'));
      const current = work ?? tasks[0], label = projectMemberDisplayName(member, current, t);
      const running = member.role === 'lead' ? Boolean(activity?.coordinatorRunning)
        : Boolean(sessions?.[member.id]?.running || worker?.activeRunId || worker?.jobs?.length);
      const summaryFailure = work?.summaryFailure && (!work.currentDelegationRef || work.summaryFailure.delegationRef === work.currentDelegationRef);
      const pendingSummary = work?.pendingSummary && !detail?.project?.paused && !worker?.stopped;
      // The lead observes the whole Project, including work outside this page.
      const state = member.role === 'lead' ? ({ idle: 'teamReady', done: 'roundDelivered', summaryFailed: 'sidebarSummaryFailed' }[activity?.state] ?? activity?.state ?? 'teamStatusUnavailable')
        : worker?.phase === 'stopping' ? 'stopping' : worker?.phase === 'failed' || member.phase === 'failed' ? 'failed'
        : running ? 'running' : worker?.stopped && work?.status !== 'done' ? 'paused'
        : work?.delegation?.phase === 'preparing' || member.phase === 'provisioning' ? 'provisioning'
        : work?.delegation?.phase === 'queued' ? 'queued' : summaryFailure ? 'sidebarSummaryFailed'
        : pendingSummary ? 'sidebarPendingSummary' : work?.prerequisitesChanged ? 'needsReview'
        : work?.status === 'blocked' ? 'blocked' : work?.hasReport ? 'teamReported'
        : work?.status === 'done' || tasks.length && tasks.every(item => item.status === 'completed') ? 'roundEnded'
        : tasks.some(item => item.status !== 'completed') || work?.status === 'running' ? 'teamAssigned'
        : worker || sessions?.[member.id] ? 'teamReady' : 'teamStatusUnavailable';
      const waiting = work?.delegation?.phase === 'queued' ? waitingLabel(t, work.delegation.waitingReason) : '';
      const blockers = !work && tasks[0]?.blockedBy?.filter(id => allWork.find(item => item.id === id)?.status !== 'completed');
      const reason = waiting || (blockers?.length ? `${t('waitingDependencies')} · ${blockers.map(id => allWork.find(item => item.id === id)?.subject || teamT('project.missingDependency')).join('、')}` : '')
        || (!worker?.stopped && (worker?.error || workBlockedLabel(t, work?.blockedReason) !== 'stopped' && work?.blockedReason))
        || (state === 'sidebarSummaryFailed' ? t('summaryErrorHint') : state === 'paused' ? t('resumeHint') : '');
      const title = current?.title || current?.subject;
      const leadContext = member.role !== 'lead' ? null : running ? 'teamLeadWorking'
        : ['running', 'provisioning', 'queued'].includes(state) ? 'teamLeadBackground'
        : ['teamReady', 'roundDelivered', 'pendingDelivery'].includes(state) ? 'teamLeadWaiting' : null;
      return { member, worker, work, tasks, label, state, reason, title, running, summaryFailure, leadContext };
    });
    const memberPriority = row => row.member.role === 'lead' ? 0 : row.running || ['stopping', 'provisioning'].includes(row.state) ? 1
      : ['queued', 'blocked', 'failed', 'sidebarSummaryFailed', 'needsReview'].includes(row.state) ? 2 : row.state === 'sidebarPendingSummary' ? 3 : 4;
    const members = rows.toReversed().filter(row => !search || [row.label, row.title, row.reason, row.member.name, row.member.description, row.member.role].some(matches)
      || row.tasks.some(task => [task.subject, task.description].some(matches))).toSorted((a, b) => memberPriority(a) - memberPriority(b));
    const associated = new Set(rows.flatMap(row => row.tasks.map(task => task.id)));
    const work = allWork.filter(item => !associated.has(item.id) && (!search || [item.subject, item.description, item.ownerName].some(matches))).toReversed()
      .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed'));
    useEffect(() => setMemberPage(page => Math.min(page, Math.max(0, Math.ceil(members.length / 8) - 1))), [members.length]);
    useEffect(() => setWorkPage(page => Math.min(page, Math.max(0, Math.ceil(work.length / 8) - 1))), [work.length]);
    const memberStart = memberPage * 8, workStart = workPage * 8;
    const memberRows = members.slice(memberStart, memberStart + 8), workRows = work.slice(workStart, workStart + 8);
    const pager = (length, page, setPage) => length > 8 ? h('div', { className: 'dsh-project-task-pagination' },
      page ? button(t('previous'), () => setPage(value => Math.max(0, value - 1))) : null,
      h('span', { className: 'dsh-project-muted' }, `${page * 8 + 1}–${Math.min(length, page * 8 + 8)} / ${length}`),
      (page + 1) * 8 < length ? button(t('next'), () => setPage(value => value + 1)) : null) : null;
    return h('div', { className: 'dsh-project-observer-team' },
      h(Input, { value: query, placeholder: teamT('project.searchHint'), 'aria-label': teamT('project.search'),
        onChange: event => { setQuery(event.target.value); setMemberPage(0); setWorkPage(0); } }),
      h('div', { className: 'dsh-project-task-group-title' }, h('strong', null, teamT('roster')), h('span', null, members.length)),
      memberRows.map(({ member, worker, work: stream, tasks, label, state, reason, title, summaryFailure, leadContext }) => h('article', {
        key: member.id, className: 'dsh-project-team-member', 'data-team-member-id': member.id,
      },
        h('div', { className: 'dsh-project-team-row' },
          h('div', { className: 'dsh-project-team-row-content' }, h('strong', null, label),
            member.role === 'lead' ? h('small', null, t('teamLeadRole')) : title && title !== label ? h('small', null, title) : null),
          h(Pill, null, stateLabel(t, state)), member.role !== 'lead' ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => openMember(member.id), 'aria-label': `${label} · ${t('viewProcess')}` }, t('viewProcess')) : null),
        member.role === 'lead' ? leadContext ? h('p', { className: 'dsh-project-team-context' }, t(leadContext)) : null
          : !title ? h('p', { className: 'dsh-project-team-context' }, t('teamNoAssignment')) : null,
        reason ? h('p', { className: 'dsh-project-team-context', role: state === 'failed' ? 'alert' : undefined }, reason) : null,
        stream?.prerequisitesChanged ? h('p', { className: 'dsh-project-team-context' }, t('prerequisitesHint')) : null,
        h('details', { className: 'dsh-project-result-disclosure dsh-project-team-details' }, h('summary', null, t('workDetails')),
          tasks.length ? h('div', { className: 'dsh-project-team-assignments' }, tasks.map(task => h('div', { key: task.id },
            tasks.length > 1 || task.subject !== label ? h('div', { className: 'dsh-project-task-detail-heading' }, h('strong', null, task.subject), h(Pill, null, teamT(`status.${task.status}`))) : null,
            task.description ? markdown(t, task.description) : null))) : member.description && member.description !== label ? h('p', null, member.description) : null,
          summaryFailure ? h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')),
            h('pre', null, [stream.summaryFailure.error?.code, stream.summaryFailure.error?.message].filter(Boolean).join('\n'))) : null,
          h('details', { className: 'dsh-project-team-technical' }, h('summary', null, t('executionInfo')),
            member.name ? h('p', null, `${t('teamTarget')}: `, h('code', null, member.name)) : null,
            h('p', null, `${t('teamSession')}: `, h('code', null, member.id)),
            worker?.cwd ? h('p', { className: 'dsh-project-path' }, worker.cwd) : null,
            worker?.branch ? h('p', { className: 'dsh-project-path' }, `${t('branch')}: ${worker.branch}`) : null)))),
      !members.length && !work.length ? h('p', { className: 'dsh-project-empty' }, search ? t('teamNoMatch') : team ? teamT('project.noMembers') : teamT('project.empty')) : null,
      pager(members.length, memberPage, setMemberPage),
      work.length ? h('div', { className: 'dsh-project-task-group-title' }, h('strong', null, t('teamOtherWork')), h('span', null, work.length)) : null,
      workRows.map(item => h('div', { key: item.id, className: 'dsh-project-team-work' },
        h('div', { className: 'dsh-project-task-detail-heading' }, h('strong', null, item.subject), h(Pill, null, teamT(`status.${item.status}`))),
        !item.ownerName ? h('p', { className: 'dsh-project-team-context' }, teamT('unowned')) : null,
        item.blockedBy?.some(id => allWork.find(task => task.id === id)?.status !== 'completed') ? h('p', { className: 'dsh-project-team-context' },
          `${t('waitingDependencies')} · ${item.blockedBy.filter(id => allWork.find(task => task.id === id)?.status !== 'completed').map(id => allWork.find(task => task.id === id)?.subject || teamT('project.missingDependency')).join('、')}`) : null,
        item.description || item.ownerName ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('workDetails')),
          item.description ? markdown(t, item.description) : null,
          item.ownerName ? h('details', { className: 'dsh-project-team-technical' }, h('summary', null, t('executionInfo')),
            h('p', null, `${t('teamTarget')}: `, h('code', null, item.ownerName))) : null) : null)),
      pager(work.length, workPage, setWorkPage));
  }

  function ProjectReportView({ projectId, reference, read, showProcess, t }) {
    const [result, setResult] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      let live = true; setResult(null); setError('');
      Promise.all([read(projectId, 'workstreams/get', { workstreamId: reference.workstreamId }),
        read(projectId, 'store/results', { workstreamId: reference.workstreamId, delegationRef: reference.delegationRef })])
        .then(([work, reports]) => { if (live) {
          const report = reports.items.find(item => item.delegationRef === reference.delegationRef);
          if (!report) throw new Error(t('resultMissing'));
          setResult({ workstreamId: reference.workstreamId, title: work.workstream.title, report, reportCount: reports.total,
            request: reports.request ?? report.request, current: work.workstream.currentDelegationRef === reference.delegationRef });
        } }).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [projectId, reference.workstreamId, reference.delegationRef]);
    return error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : result
      ? h(ResultEntry, { projectId, result, read, showProcess, t }) : h('p', { role: 'status' }, t('loading'));
  }

  function ProjectTaskWork({ projectId, item, resourceRevision, read, controls, t }) {
    const [value, setValue] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      if (!item.current) return;
      let live = true;
      read(projectId, 'workstreams/get', { workstreamId: item.workstreamId }).then(result => { if (live) setValue(result); })
        .catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [projectId, item.workstreamId, item.delegationRef, item.updatedAt, item.status]);
    if (value?.workstream.currentDelegationRef === item.delegationRef) return h(WorkProgressItem, {
      projectId, resourceRevision, work: { ...value.workstream, id: item.workstreamId, hasReport: Boolean(value.workstream.latestReport) }, worker: value.worker,
      read, ...controls, t,
    });
    return h('div', { className: 'dsh-project-task-member' },
      h('div', null, h('strong', null, projectMemberDisplayName({ name: item.memberName, description: item.title }, item, t)), recordedTime(item.updatedAt)),
      h(Pill, null, stateLabel(t, item.status)),
      item.waitingReason || item.blockedReason ? h('p', { className: 'dsh-project-muted' }, waitingLabel(t, item.waitingReason) || workBlockedLabel(t, item.blockedReason)) : null,
      h('div', { className: 'dsh-project-actions' }, h(Button, { variant: 'ghost', size: 'sm', onClick: () => controls.showProcess(projectId, item.workstreamId, false, { delegationRef: item.delegationRef }) }, t('viewProcess')),
        item.reportId ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => controls.showMaterials(projectId, item.workstreamId, { delegationRef: item.delegationRef }) }, t('viewResult')) : null),
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  function ProjectTaskDetail({ projectId, card, tab, setTab, resourceRevision, read, showProcess, showReport, controls, retryHandover, queue, changeQueue, renderFactorySlot, embedded = false, t }) {
    const work = card.work ?? [], delivery = card.delivery && { ...card.delivery, requestId: card.id, requestRevision: card.revision, title: card.title,
      reportRefs: card.delivery.reportRefs ?? [], terminalRefs: card.delivery.terminalRefs ?? [] };
    const tabs = [['overview', 'taskOverview'], ['team', 'taskTeam'], ['results', 'taskResults'], ['activity', 'taskActivity']];
    const waiting = work.find(item => item.waitingReason || item.blockedReason);
    const blocker = summaryPreview(card.authorityError ? t('authorityErrorHint') : card.handoverError ? t('handoverErrorHint')
      : waiting ? waitingLabel(t, waiting.waitingReason) || workBlockedLabel(t, waiting.blockedReason) : delivery?.remainingIssues?.[0]);
    return h('div', { className: 'dsh-project-task-detail', 'data-project-detail-id': card.id },
      !embedded ? h('div', { className: 'dsh-project-task-detail-heading' }, h('h2', null, card.title), h(Pill, null, requestStateLabel(t, card, false))) : null,
      !embedded && card.queue && card.status !== 'completed' ? h('div', { className: 'dsh-project-task-footer' },
        requestQueueNote(t, card, queue) ? h('span', { className: 'dsh-project-muted' }, requestQueueNote(t, card, queue)) : null,
        h(ProjectRequestQueueActions, { card, queue, changeQueue, busy: controls.busy, t })) : null,
      h(SegmentedTabs, { className: 'dsh-project-task-tabs', label: t('taskDetail'), value: tab, onChange: setTab,
        items: tabs.map(([id, label]) => ({ value: id, label: t(label), id: `${card.id}-tab-${id}`, panelId: `${card.id}-panel-${id}` })) }),
      h('div', { className: 'dsh-project-task-tab-body', role: 'tabpanel', id: `${card.id}-panel-${tab}`, 'aria-labelledby': `${card.id}-tab-${tab}` },
        tab === 'overview' ? h(Fragment, null,
          h(ProjectRequestFlow, { card, t }),
          blocker ? h('p', { className: 'dsh-project-observer-blocker' }, blocker.length > 140 ? blocker.slice(0, 140) + '…' : blocker) : null,
          h(ProjectVisualResults, { pages: delivery?.pages, renderFactorySlot, t }),
          delivery ? h('div', { className: 'dsh-project-task-section' }, h('strong', null, t('result')), h('p', null, summaryPreview(delivery.summary)))
            : h('p', { className: 'dsh-project-muted' }, t('taskNoResults')),
          h('details', { className: 'dsh-project-result-disclosure dsh-project-observer-request-info' }, h('summary', null, t('workRequest')),
            markdown(t, card.goal),
            card.conditions?.length ? h('div', { className: 'dsh-project-task-section' }, h('strong', null, t('keyEvidence')), h('ul', null, card.conditions.map((item, index) => h('li', { key: index }, item)))) : null,
            card.constraints?.length ? h('div', { className: 'dsh-project-task-section' }, h('strong', null, t('executionInfo')), h('ul', null, card.constraints.map((item, index) => h('li', { key: index }, item)))) : null),
          card.authorityError ? h(RequestAuthority, { request: card, t }) : null,
          card.handoverError && !card.authorityError ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('errorDetails')),
            h('p', { className: 'dsh-project-error' }, t('handoverErrorHint')), button(t('retrySummary'), () => retryHandover(card), controls.busy),
            h('pre', null, card.handoverError)) : null,
          delivery?.remainingIssues?.length ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('remainingIssues')),
            h('ul', null, delivery.remainingIssues.map((item, index) => h('li', { key: index }, item)))) : null) : null,
        tab === 'team' ? h('div', { className: 'dsh-project-task-section' }, work.length ? work.map(item => h(ProjectTaskWork, {
          key: item.workstreamId + ':' + item.delegationRef, projectId, item, resourceRevision, read, controls, t,
        })) : h('p', { className: 'dsh-project-muted' }, t('taskNoMembers'))) : null,
        tab === 'results' ? h('div', { className: 'dsh-project-task-section' }, delivery
          ? h(DeliveryEntry, { projectId, delivery, results: work.map(item => ({ workstreamId: item.workstreamId, title: item.title })), read,
            openReport: showReport, showProcess: (_id, workstreamId, _member, context) => showProcess({ workstreamId, delegationRef: context.delegationRef }), renderFactorySlot, t })
          : h('p', { className: 'dsh-project-muted' }, t('taskNoResults')),
           work.filter(item => item.reportId && !delivery?.reportRefs?.some(ref => ref.workstreamId === item.workstreamId && ref.delegationRef === item.delegationRef))
            .map(item => h(Button, { key: item.workstreamId + ':' + item.delegationRef, variant: 'ghost', size: 'sm', onClick: () => showReport(item) }, item.title, ' · ', t('reportSource')))) : null,
        tab === 'activity' ? h('div', { className: 'dsh-project-task-section' },
          [...(card.versions ?? []).map(version => ({ key: `version-${version.revision}`, at: version.at, label: `${t('requestVersion')} ${version.revision}`, detail: version.title, version })),
            ...work.flatMap(item => [{ key: `${item.delegationRef}-assignment`, at: item.assignmentAt, label: item.title, detail: item.memberName },
              ...(item.reportAt ? [{ key: `${item.delegationRef}-report`, at: item.reportAt, label: t('reportSource'), detail: item.title }] : []),
              ...(item.terminalAt ? [{ key: `${item.delegationRef}-terminal`, at: item.terminalAt, label: stateLabel(t, item.status), detail: item.title }] : [])]),
            ...(delivery ? [{ key: `delivery-${delivery.id}`, at: delivery.at, label: t('delivered'), detail: delivery.summary }] : [])]
            .filter(item => Number.isFinite(item.at)).sort((a, b) => b.at - a.at)
            .map(item => item.version ? h('details', { key: item.key, className: 'dsh-project-task-version dsh-project-result-disclosure' },
              h('summary', null, recordedTime(item.at), h('strong', null, item.label), ' · ', item.detail),
              h('div', { className: 'dsh-project-result-details' },
                h('div', { className: 'dsh-project-task-section' }, h('strong', null, t('requirementGoal')), markdown(t, item.version.goal)),
                ...[['constraints', 'requirementConstraints', 'noRequirementConstraints'], ['conditions', 'requirementConditions', 'noRequirementConditions']].map(([field, label, empty]) =>
                  h('div', { key: field, className: 'dsh-project-task-section' }, h('strong', null, t(label)), item.version[field]?.length
                    ? h('ul', null, item.version[field].map((text, index) => h('li', { key: index }, markdown(t, text))))
                    : h('p', { className: 'dsh-project-muted' }, t(empty))))))
              : h('div', { key: item.key, className: 'dsh-project-task-event' }, recordedTime(item.at), h('strong', null, item.label), h('span', null, summaryPreview(item.detail)))),
          !card.versions?.length && !work.length && !delivery ? h('p', { className: 'dsh-project-muted' }, t('taskNoActivity')) : null) : null),
      h('details', { className: 'dsh-project-result-disclosure dsh-project-observer-request-info' }, h('summary', null, t('executionInfo')),
        h('div', { className: 'dsh-project-task-meta' }, recordedTime(card.updatedAt), h('span', null, `${t('requestVersion')} ${card.revision}`))));
  }

  // The requirement list: the current requirement first, waiting requirements in
  // queue order, delivered ones as strips. Records, results and changes open in
  // the Project dialog above it, so this panel never owns an editor.
  function ProjectRequirements(props) {
    const { sessionId, project, useRequestModes, readDetail, read, command, sendUserRequest, openModelSettings, setRequestMode, renderFactorySlot, t } = props;
    const { detail, team, sessions } = useProjectLive(props, sessionId, project);
    const requestModes = useRequestModes(value => value[sessionId]?.requests);
    const [historyKind, setHistoryKind] = useState(null), [historyMenu, setHistoryMenu] = useState(false);
    const cursorScope = `${project.id}:${detail?.revision ?? ''}`;
    const newCursors = () => ({ scope: cursorScope, current: [null], completed: [null], archived: [null], cancelled: [null] });
    const [cursorState, setCursorState] = useState(newCursors), [pages, setPages] = useState({}), [cardsBusy, setCardsBusy] = useState(false);
    const activeCursors = cursorState.scope === cursorScope ? cursorState : newCursors();
    const [actionBusy, setActionBusy] = useState(false), [queueFailure, setQueueFailure] = useState(null), [error, setError] = useState(''), [refreshKey, setRefreshKey] = useState(0);
    const queueChanging = useRef(false);
    useEffect(() => { void readDetail(project.id).catch(failure => setError(errorText(failure))); }, [project.id]);
    useEffect(() => {
      let live = true; setCardsBusy(true);
      const kinds = ['current', 'completed', 'archived', 'cancelled'];
      void Promise.all(kinds.map(kind => read(project.id, 'requests/list', { kind, ...(activeCursors[kind].at(-1) ? { cursor: activeCursors[kind].at(-1) } : {}) }).then(page => [kind, page])))
        .then(rows => { if (live) { setPages(Object.fromEntries(rows)); setError(''); } })
        .catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setCardsBusy(false); });
      return () => { live = false; };
    }, [project.id, detail?.revision, refreshKey, activeCursors.current.at(-1), activeCursors.completed.at(-1), activeCursors.archived.at(-1), activeCursors.cancelled.at(-1)]);
    const archive = async item => {
      setError('');
      try {
        await command(project.id, item.archivedAt ? 'requests/restore' : 'requests/archive', { requestId: item.id });
        setCursorState(newCursors()); setRefreshKey(value => value + 1);
      } catch (failure) { setError(errorText(failure)); }
    };
    const queue = project.queue;
    const changeQueue = async (item, action) => {
      if (queueChanging.current || project.lifecycle !== 'ready' || project.archiving) return;
      queueChanging.current = true; setActionBusy(true);
      try {
        const index = queue?.queued?.findIndex(row => row.id === item.id) ?? -1;
        if (action === 'moveUp' && index <= 0 || action === 'moveDown' && (index < 0 || index >= queue.queued.length - 1)) return;
        const beforeRequestId = action === 'moveUp' ? queue.queued[index - 1].id : action === 'moveDown' ? queue.queued[index + 2]?.id : undefined;
        await command(project.id, 'requests/queue', { requestId: item.id, requestRevision: item.revision,
          action: ['moveUp', 'moveDown'].includes(action) ? 'move' : action, ...(beforeRequestId ? { beforeRequestId } : {}) });
        setCursorState(newCursors()); setRefreshKey(value => value + 1);
      } catch (failure) {
        setQueueFailure(previous => ({ seq: (previous?.seq ?? 0) + 1, text: errorText(failure) }));
      } finally { queueChanging.current = false; setActionBusy(false); }
    };
    const updateCursors = (kind, change) => setCursorState(before => {
      const current = before.scope === cursorScope ? before : newCursors(); return { ...current, [kind]: change(current[kind]) };
    });
    const pageControls = kind => activeCursors[kind].length > 1 || pages[kind]?.nextCursor ? h('div', { className: 'dsh-project-task-pagination' },
      activeCursors[kind].length > 1 ? button(t('previous'), () => updateCursors(kind, before => before.slice(0, -1)), cardsBusy) : null,
      pages[kind]?.nextCursor ? button(t('taskMore'), () => updateCursors(kind, before => [...before, pages[kind].nextCursor]), cardsBusy) : null) : null;
    const showProcess = item => props.showProcess(project.id, item.workstreamId ?? item.workerSessionId, !item.workstreamId, { delegationRef: item.delegationRef });
    const showReport = item => props.showReport(project.id, item.workstreamId, { delegationRef: item.delegationRef });
    const act = async (endpoint, input) => {
      setActionBusy(true); setError('');
      try { await command(project.id, endpoint, input); } catch (failure) { setError(errorText(failure)); } finally { setActionBusy(false); }
    };
    const retrySummary = async work => {
      setActionBusy(true); setError('');
      try {
        const { workstream } = await read(project.id, 'workstreams/get', { workstreamId: work.id });
        if (workstream.request?.authorityError) throw new Error(t('authorityErrorHint'));
        const report = workstream.latestReport, failure = workstream.summaryFailure;
        const terminal = workstream.recentSettlements?.find(item => item.runId === failure?.runId && item.delegationRefs.includes(failure.delegationRef));
        if (failure?.delegationRef !== work.summaryFailure.delegationRef || !(report?.delegationRef === failure.delegationRef || terminal)) throw new Error(t('resultUpdated'));
        await sendUserRequest(project.id, `${t('retrySummaryPrompt')}\n${workstream.title} · ${new Date((report ?? terminal).at).toISOString()}`);
      } catch (failure) { setError(errorText(failure)); } finally { setActionBusy(false); }
    };
    const retryHandover = async request => {
      setActionBusy(true); setError('');
      try {
        const fresh = await read(project.id, 'detail');
        const current = fresh.project.currentRequests?.find(item => item.id === request.id && item.revision === request.revision && item.handoverError === request.handoverError);
        if (!current) throw new Error(t('resultUpdated'));
        if (current.authorityError) throw new Error(t('authorityErrorHint'));
        await sendUserRequest(project.id, `${t('retrySummaryPrompt')}\n${requestLabel(t, current)}\n${current.goal}`);
      } catch (failure) { setError(errorText(failure)); } finally { setActionBusy(false); }
    };
    const controls = { paused: project.paused, act, retrySummary, openModelSettings, busy: actionBusy || project.lifecycle !== 'ready' || project.archiving,
      showProcess: (_id, workstreamId, member, context = {}) => props.showProcess(project.id, workstreamId, member, { delegationRef: context.delegationRef }),
      showMaterials: (_id, workstreamId, context = {}) => showReport({ workstreamId, delegationRef: context.delegationRef }),
      showDiff: (_id, workstreamId) => props.showDiff(project.id, workstreamId),
      showRequestDiff: id => props.showRequestDiff(project.id, id),
      revert: async item => { await command(project.id, 'requests/revert', { requestId: item.id, requestRevision: item.revision }); setCursorState(newCursors()); setRefreshKey(value => value + 1); },
      ask: text => sendUserRequest(project.id, text) };
    const cardMode = (item, initialMode = 'strip') => requestModes?.[item.id]?.completed === (item.status === 'completed') ? requestModes[item.id].mode : initialMode;
    const renderCard = (item, initialMode = 'strip') => h(ProjectTaskCard, { key: item.id, card: item, project, resourceRevision: detail?.revision,
      mode: cardMode(item, initialMode), setMode: mode => setRequestMode(sessionId, item.id, mode, item.status === 'completed'),
      read, team, sessions, controls, queue, changeQueue, archive, retryHandover, showProcess, showReport, renderFactorySlot, t });
    const current = pages.current?.items ?? [], activeCard = current.find(item => item.id === queue?.active?.id) ?? queue?.active;
    const waiting = current.filter(item => item.id !== activeCard?.id);
    const activeSteps = activeCard ? projectRequestSteps(activeCard, team, t, sessions) : [];
    const activeHuman = activeCard ? requestHumanStatus(project, activeCard, projectRequestStage(project, activeCard, activeSteps), activeSteps, queue, t) : null;
    const board = [
      { id: 'active', label: 'boardActive', tone: 'info', count: activeHuman && activeHuman.tone !== 'warning' ? 1 : 0 },
      { id: 'blocked', label: 'boardBlocked', tone: 'warning', count: activeHuman?.tone === 'warning' ? 1 : 0 },
      { id: 'waiting', label: 'boardWaiting', tone: 'neutral', count: (queue?.queued?.length ?? 0) + (queue?.discussingCount ?? 0) },
      { id: 'delivered', label: 'boardDelivered', tone: 'success', count: pages.completed?.total ?? 0 },
    ];
    return h('section', { className: 'dsh-project-panel-body dsh-project-requests', 'aria-label': t('requirements') },
      h('header', { className: 'dsh-project-requests-toolbar' },
        h('strong', { title: project.canonicalWorkingDirectory }, project.title),
        h(Button, { variant: 'ghost', size: 'sm', onClick: () => props.showMaterials(project.id) }, t('taskMaterials')),
        h(Menu, { open: historyMenu, onClose: () => setHistoryMenu(false), portal: true, compact: true, align: 'end',
          items: [{ id: 'cancelled', label: `${t('taskCancelled')} · ${pages.cancelled?.total ?? 0}` }, { id: 'archived', label: `${t('taskArchive')} · ${pages.archived?.total ?? 0}` }],
          onSelect: kind => { setHistoryMenu(false); setHistoryKind(value => value === kind ? null : kind); },
          anchor: h(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('more'), onClick: () => setHistoryMenu(value => !value) }, h(IconEllipsisOutlineRegular, { size: 16 })) })),
      board.some(item => item.count) ? h('div', { className: 'dsh-project-board', role: 'group', 'aria-label': t('boardSummary') }, board.map(item => h('div', { key: item.id, className: 'dsh-project-board-cell', 'data-empty': !item.count },
        h('strong', null, item.count), h('span', { className: 'dsh-project-board-label' }, h('span', { className: 'dsh-project-tone-dot', 'data-tone': item.count ? item.tone : 'idle', 'aria-hidden': true }), t(item.label))))) : null,
      activeCard ? h('div', { className: 'dsh-project-requests-current' }, renderCard(activeCard, 'card')) : null,
      !activeCard && !current.length && !pages.completed?.total && !cardsBusy ? h('div', { className: 'dsh-project-requests-empty' }, h('strong', null, t('taskEmptyTitle')), h('p', null, t('taskEmpty'))) : null,
      waiting.length ? h('div', { className: 'dsh-project-requests-list', 'aria-label': t('requestQueued') }, waiting.map(item => renderCard(item))) : null,
      pageControls('current'),
      historyKind ? h('section', { className: 'dsh-project-requests-list' }, h('div', { className: 'dsh-project-task-group-title' }, h('strong', null, t(historyKind === 'archived' ? 'taskArchive' : 'taskCancelled')), h(Button, { variant: 'ghost', size: 'sm', onClick: () => setHistoryKind(null) }, t('taskBack'))),
        (pages[historyKind]?.items ?? []).map(item => renderCard(item)), pageControls(historyKind)) : null,
      pages.completed?.total ? h('section', { className: 'dsh-project-requests-list' }, h('div', { className: 'dsh-project-task-group-title' }, h('strong', null, t('taskCompleted')), h('span', null, pages.completed.total)),
        (pages.completed.items ?? []).map(item => renderCard(item)), pageControls('completed')) : null,
      cardsBusy && !pages.current ? h('p', { role: 'status', className: 'dsh-project-empty' }, t('loading')) : null,
      project.diagnostics?.length ? h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), project.diagnostics.map((item, index) => h('pre', { key: index }, typeof item === 'string' ? item : item.message))) : null,
      error || queueFailure ? h(Toast, { text: queueFailure?.text ?? error, onDone: () => { setError(''); setQueueFailure(null); } }) : null);
  }

  function ProjectArchiveComposer({ matched, useProjects, command, t }) {
    const project = useProjects(value => value.projects.find(item => item.id === matched.projectId));
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const restore = async () => { setBusy(true); setError(''); try { await command(project.id, 'restore'); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    return h('div', { className: 'dsh-project-archive-notice', role: 'status' }, h('p', null, t(project?.archiving ? 'archiving' : 'archivedHint')), project?.lifecycle === 'archived' ? button(t('restore'), restore, busy) : null, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  function WorkProgressItem({ projectId, work, worker, resourceRevision, paused, act, read, retrySummary, openModelSettings, showProcess, showDiff, showMaterials, busy, t }) {
    const [expanded, setExpanded] = useState(false), [value, setValue] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      if (!expanded) return;
      let live = true; setValue(null); setError('');
      void read(projectId, 'workstreams/get', { workstreamId: work.id }).then(result => { if (live) setValue(result); }).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [expanded, projectId, work.id, work.updatedAt, work.prerequisitesChanged, resourceRevision]);
    const report = value?.workstream.latestReport, member = value?.worker;
    const waiting = work.delegation?.waitingReason;
    const summaryFailure = work.summaryFailure && (!work.currentDelegationRef || work.summaryFailure.delegationRef === work.currentDelegationRef) ? work.summaryFailure : null;
    const state = worker?.phase === 'stopping' ? 'stopping' : worker?.phase === 'failed' ? 'failed' : worker?.stopped && work.status !== 'done' ? 'paused' : worker && isLive(worker) ? 'running' : work.delegation?.phase === 'queued' ? 'queued' : work.delegation?.phase === 'preparing' ? 'provisioning' : work.status === 'running' ? 'running' : summaryFailure ? 'sidebarSummaryFailed' : work.pendingSummary && !worker?.stopped && !paused ? 'pendingSummary' : work.status;
    return h('div', { className: 'dsh-project-work', 'data-workstream-id': work.id },
      h('div', { className: 'dsh-project-heading dsh-project-work-heading' }, h('strong', { title: work.title }, work.title), h(Pill, null, stateLabel(t, state))),
      worker?.error || !worker?.stopped && work.blockedReason && work.blockedReason !== 'stopped' ? h('p', { className: 'dsh-project-error' }, worker?.error || workBlockedLabel(t, work.blockedReason)) : null,
      work.delegation?.phase === 'queued' ? h('p', { className: 'dsh-project-muted' }, waiting ? `${t({ dependencies: 'waitingDependencies', directory: 'waitingDirectory', capacity: 'waitingCapacity' }[waiting.kind])}${waiting.workTitles.length ? ` · ${waiting.workTitles.join('、')}` : ''}` : t('queued')) : null,
      summaryFailure && !work.request?.authorityError ? h(SummaryFailure, { failure: summaryFailure, openModelSettings, t }) : null,
      (value?.workstream.prerequisitesChanged ?? work.prerequisitesChanged) ? h('p', { className: 'dsh-project-muted', title: t('prerequisitesHint') }, t('prerequisitesChanged')) : null,
      h('div', { className: 'dsh-project-actions' }, work.hasReport ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => showMaterials(projectId, work.id, { delegationRef: work.currentDelegationRef }) }, t('viewResult')) : null,
        summaryFailure && !work.request?.authorityError ? button(t('retrySummary'), () => retrySummary(work), busy) : null,
        worker && !worker.stopped && (isLive(worker) || ['queued', 'preparing'].includes(work.delegation?.phase)) ? button(t('stopWork'), () => act('stop', { workstreamId: work.id }), busy) : null),
      h('details', { className: 'dsh-project-work-details', open: expanded, onToggle: event => setExpanded(event.currentTarget.open) }, h('summary', null, t('workDetails')),
        expanded ? h('div', { className: 'dsh-project-work-detail-body' },
          summaryFailure && work.request?.authorityError ? h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, [summaryFailure.error.code, summaryFailure.error.message].filter(Boolean).join('\n'))) : null,
          !value && !error ? h('p', { role: 'status' }, t('loading')) : null,
          error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
          h('div', { className: 'dsh-project-work-detail-actions' }, work.workerSessionId ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => showProcess(projectId, work.id) }, t('viewProcess')) : null,
            report && !work.hasReport ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => showMaterials(projectId, work.id, { delegationRef: report.delegationRef }) }, t('viewResult')) : null,
            member && member.role !== 'readonly' ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => showDiff(projectId, work.id) }, t('diff')) : null),
          member ? h('details', null, h('summary', null, t('executionInfo')),
            h('p', { className: 'dsh-project-muted' }, t(member.role === 'readonly' ? 'readonly' : member.role === 'docs' ? 'docsScope' : 'developmentScope')),
            h('div', { className: 'dsh-project-path' }, member.cwd, member.branch ? ` · ${t('branch')}: ${member.branch}` : ''),
            member.writePaths?.length ? h('ul', null, member.writePaths.map(path => h('li', { key: path, className: 'dsh-project-path' }, path))) : null) : null) : null));
  }

  function RequestAuthority({ request, className = 'dsh-project-work', t }) {
    return h('div', { className, 'data-request-recovery-id': request.id },
      h('strong', null, requestLabel(t, request)), h('p', { className: 'dsh-project-error' }, t('authorityErrorHint')),
      h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('workRequest')), markdown(t, request.goal)),
      h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, request.authorityError)));
  }

  function ProjectStop({ sessionId, useProjects, command, t, compact = true }) {
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    if (!project || project.lifecycle !== 'ready' || project.archiving || compact && project.activity?.coordinatorRunning || !(project.activity?.running || project.activity?.queued || project.activity?.provisioning || !compact && project.activity?.coordinatorRunning || project.activity?.state === 'stopping') && !error) return null;
    const stop = async () => { setBusy(true); setError(''); try { await command(project.id, 'stop'); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    return h(Fragment, null, h(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('stop'), title: error || t('stop'), disabled: busy || project.activity?.state === 'stopping', onClick: stop }, compact ? '■' : t('stop')), error ? h('span', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  const ProjectApprovalStop = props => h(ProjectStop, { ...props, compact: false });

  function ResultCard({ projectId, workstreamId, report, read, showProcess, request, t }) {
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const open = async path => { setError(''); setNotice(''); setBusy(true); try { const value = await read(projectId, 'open', { workstreamId, delegationRef: report.delegationRef, path }); if (value.modifiedSinceReport) setNotice(t('modifiedArtifact')); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    return h('div', { className: 'dsh-project-result-body' }, h('div', { className: 'dsh-project-result-meta' }, h(Pill, null, stateLabel(t, report.outcome)), recordedTime(report.at), h('span', { className: 'dsh-project-muted' }, t('reportSource'))),
      request ? h('p', { className: 'dsh-project-muted' }, requestLabel(t, request)) : null,
      h('div', { className: 'dsh-project-result-conclusion' }, markdown(t, summaryPreview(report.summary))),
      report.prerequisitesChanged ? h('p', { className: 'dsh-project-muted' }, t('prerequisitesChanged'), ' · ', t('prerequisitesHint')) : null,
      h('div', { className: 'dsh-project-result-checks' }, h('strong', null, t('keyEvidence')), report.evidence?.length ? h('ul', null, report.evidence.slice(0, 2).map((item, index) => h('li', { key: index }, item))) : h('p', { className: 'dsh-project-muted' }, t('noEvidence'))),
      report.remainingIssues?.length ? h('div', { className: 'dsh-project-result-checks' }, h('strong', null, t('remainingIssues')), h('ul', null, report.remainingIssues.map((item, index) => h('li', { key: index }, item)))) : null,
      report.artifacts?.map(file => h(Artifact, { key: file.path, file, open, busy, t })),
      h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('reportDetails')),
        h('div', { className: 'dsh-project-result-details' }, markdown(t, report.summary),
          report.evidence?.length > 2 ? h('details', null, h('summary', null, t('evidence')), h('ul', null, report.evidence.map((item, index) => h('li', { key: index }, item)))) : null)),
      showProcess ? h('div', { className: 'dsh-project-work-detail-actions' }, h(Button, { variant: 'ghost', size: 'sm', onClick: () => showProcess(projectId, workstreamId, false, { delegationRef: report.delegationRef, reportAt: report.at, request }) }, t('viewProcess'))) : null,
      notice ? h('p', { role: 'status', className: 'dsh-project-muted' }, notice) : null, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  function ResultHistory({ projectId, result, read, showProcess, t }) {
    const [open, setOpen] = useState(false), [history, setHistory] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [cursors, setCursors] = useState([null]);
    const selected = cursors.at(-1);
    useEffect(() => {
      if (!open) return;
      let live = true; setBusy(true); setError('');
      void read(projectId, 'store/results', { workstreamId: result.workstreamId, ...(selected ? { cursor: selected } : {}) }).then(value => { if (live) setHistory(value); }).catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setBusy(false); });
      return () => { live = false; };
    }, [open, projectId, result.workstreamId, selected]);
    return h('details', { className: 'dsh-project-result-disclosure', open, onToggle: event => setOpen(event.currentTarget.open) }, h('summary', null, t('resultHistory'), ` (${result.reportCount - 1})`),
      open ? h(Fragment, null,
      history?.items.filter(report => report.delegationRef !== result.report.delegationRef).map(report => h(ResultCard, { key: report.delegationRef, projectId, workstreamId: result.workstreamId, report, request: report.request, read, showProcess, t })),
      busy ? h('p', { role: 'status' }, t('loading')) : null, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
      h('div', { className: 'dsh-project-actions' }, cursors.length > 1 ? button(t('previous'), () => setCursors(before => before.slice(0, -1)), busy) : null,
        history?.nextCursor ? button(t('older'), () => setCursors(before => [...before, history.nextCursor]), busy) : null)) : null);
  }

  function ResultEntry({ projectId, result, read, showProcess, t }) {
    return h('article', { className: 'dsh-project-result', 'data-result-workstream-id': result.workstreamId },
      h('div', { className: 'dsh-project-result-heading' }, h('strong', null, result.title), h('span', { className: 'dsh-project-muted' }, t(result.current ? 'currentResult' : 'previousResult'))),
      h(ResultCard, { projectId, workstreamId: result.workstreamId, report: result.report, request: result.request, read, showProcess, t }),
      result.reportCount > 1 ? h(ResultHistory, { key: result.report.delegationRef, projectId, result, read, showProcess, t }) : null);
  }

  function ProjectVisualResults({ pages, renderFactorySlot, t }) {
    return pages?.length ? h('section', { className: 'dsh-project-visual-results', 'aria-label': t('visualResults') },
      pages.map(page => h('div', { key: page.callId, className: 'dsh-project-visual-page' },
        renderFactorySlot('visual-reply.page', { sessionId: page.sessionId, file: page.file, title: page.title, height: page.height },
          { fallback: h('p', { role: 'status' }, t('loading')) })))) : null;
  }

  function DeliveryEntry({ projectId, delivery, results, read, openReport, showProcess, renderFactorySlot, t }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const historical = delivery.status === 'historical' || delivery.status === 'obsolete';
    const openFile = async file => {
      setBusy(true); setError(''); setNotice('');
      try { const value = await read(projectId, 'open', { workstreamId: file.workstreamId, delegationRef: file.delegationRef, path: file.path }); if (value.modifiedSinceReport) setNotice(t('modifiedArtifact')); }
      catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
    };
    return h('article', { className: 'dsh-project-result', 'data-delivery-id': delivery.id },
      h('div', { className: 'dsh-project-result-heading' }, h('strong', null, delivery.title), h(Pill, null, t(historical ? 'historicalDelivery' : delivery.outcome === 'completed' ? 'delivered' : 'partialDelivery'))),
      h(ProjectVisualResults, { pages: delivery.pages, renderFactorySlot, t }),
      h('div', { className: 'dsh-project-result-conclusion' }, markdown(t, summaryPreview(delivery.summary))),
      historical ? h('p', { className: 'dsh-project-muted' }, t('historicalDeliveryHint')) : delivery.applicable === false ? h('p', { className: 'dsh-project-muted' }, t('needsReview'), ' · ', t('deliveryChangedHint')) : null,
      delivery.evidence?.length ? h('div', { className: 'dsh-project-result-checks' }, h('strong', null, t('keyEvidence')), h('ul', null, delivery.evidence.slice(0, 2).map((item, index) => h('li', { key: index }, item)))) : null,
      delivery.remainingIssues?.length ? h('div', { className: 'dsh-project-result-checks' }, h('strong', null, t('remainingIssues')), h('ul', null, delivery.remainingIssues.map((item, index) => h('li', { key: index }, item)))) : null,
      delivery.artifacts?.length ? h('section', { className: 'dsh-project-result-files' }, h('strong', null, t('resultFiles')),
        delivery.artifacts.map(file => h(Artifact, { key: file.workstreamId + ':' + file.delegationRef + ':' + file.path, file, busy, t, open: () => openFile(file) }))) : null,
      delivery.reportRefs.length ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('reportSource')), h('div', { className: 'dsh-project-work-detail-actions' }, delivery.reportRefs.map((reference, index) => h(Button, { key: reference.workstreamId + ':' + reference.delegationRef, variant: 'ghost', size: 'sm', onClick: () => openReport(reference) }, results?.find(result => result.workstreamId === reference.workstreamId)?.title ?? `${t('reportSource')} ${index + 1}`)))) : null,
      h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('deliveryDetails')),
        h('div', { className: 'dsh-project-result-meta' }, h('span', { className: 'dsh-project-muted' }, `${t('requestVersion')} ${delivery.requestRevision}`), recordedTime(delivery.at)),
        markdown(t, delivery.summary), delivery.evidence?.length > 2 ? h('ul', null, delivery.evidence.map((item, index) => h('li', { key: index }, item))) : null,
        historical ? h('p', { className: 'dsh-project-muted' }, t('result'), ' · ', t(delivery.outcome === 'completed' ? 'completed' : delivery.outcome === 'partial' ? 'partialDelivery' : delivery.outcome)) : null,
        showProcess && delivery.terminalRefs?.length ? h('div', { className: 'dsh-project-work-detail-actions' }, delivery.terminalRefs.map((reference, index) => h(Button, {
          key: reference.workstreamId + ':' + reference.delegationRef + ':' + reference.runId, variant: 'ghost', size: 'sm',
          onClick: () => showProcess(projectId, reference.workstreamId, false, { delegationRef: reference.delegationRef, reportAt: delivery.at, request: { id: delivery.requestId, title: delivery.title, revision: delivery.requestRevision } }),
        }, t('viewProcess'), delivery.terminalRefs.length > 1 ? ` ${index + 1}` : ''))) : null),
      delivery.error ? h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, errorText(delivery.error))) : null,
      notice ? h('p', { role: 'status', className: 'dsh-project-muted' }, notice) : null, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  function DeliveryGroup({ projectId, items, results, read, openReport, showProcess, renderFactorySlot, t }) {
    const versions = [...items].sort((left, right) => right.requestRevision - left.requestRevision || right.at - left.at);
    const render = delivery => h(DeliveryEntry, { key: delivery.id, projectId, delivery, results, read, openReport, showProcess, renderFactorySlot, t });
    return h('section', { className: 'dsh-project-delivery-group', 'data-request-id': versions[0].requestId }, render(versions[0]),
      versions.length > 1 ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('earlierDeliveries')), versions.slice(1).map(render)) : null);
  }

  function Materials({ projectId, workstreamId, delegationRef, resourceRevision, active = true, read: readOriginal, command, onDirtyChange, editorRef, readonly, showProcess: showProcessOriginal, renderFactorySlot, t }) {
    const [listing, setListing] = useState(null), [path, setPath] = useState('docs'), [text, setText] = useState('');
    const [loadedPath, setLoadedPath] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [savedText, setSavedText] = useState(''), [generatedText, setGeneratedText] = useState(''), [decisionText, setDecisionText] = useState('');
    const [resultCursors, setResultCursors] = useState([null]), resultsCursor = resultCursors.at(-1);
    const [deliveryCursors, setDeliveryCursors] = useState([null]), deliveryCursor = deliveryCursors.at(-1);
    const [deliveries, setDeliveries] = useState(null), [deliveriesBusy, setDeliveriesBusy] = useState(false);
    const [requestCursors, setRequestCursors] = useState([null]), requestCursor = requestCursors.at(-1);
    const [requestsPage, setRequestsPage] = useState(null), [requestsBusy, setRequestsBusy] = useState(false);
    const [selectedWork, setSelectedWork] = useState(workstreamId), [selectedDelegation, setSelectedDelegation] = useState(delegationRef), [selectedResult, setSelectedResult] = useState(null), [pendingPath, setPendingPath] = useState(null);
    const contentRef = useRef(null), returnScroll = useRef(0), visibleScroll = useRef(0);
    useLayoutEffect(() => { if (active && contentRef.current) contentRef.current.scrollTop = visibleScroll.current; }, [active]);
    const materialTarget = useRef(null);
    useLayoutEffect(() => {
      if (!active) { materialTarget.current = null; return; }
      const target = { path, selectedWork, selectedDelegation };
      materialTarget.current = target;
      return () => { materialTarget.current = null; };
    }, [active, path, selectedWork, selectedDelegation]);
    const read = (...args) => {
      const target = materialTarget.current;
      if (args[1] === 'open' && active) visibleScroll.current = contentRef.current?.scrollTop ?? 0;
      return readOriginal(...args, () => target !== null && materialTarget.current === target);
    };
    const showProcess = (id, work, member, context) => {
      const target = materialTarget.current;
      if (active) visibleScroll.current = contentRef.current?.scrollTop ?? 0;
      showProcessOriginal(id, work, member, { ...context, isCurrent: () => target !== null && materialTarget.current === target });
    };
    const [listingBusy, setListingBusy] = useState(true), [selectionBusy, setSelectionBusy] = useState(Boolean(workstreamId));
    const pending = busy || listingBusy || selectionBusy;
    const dirty = loadedPath === path && text !== savedText;
    useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
    useEffect(() => {
      let live = true;
      setListingBusy(true); setError('');
      read(projectId, 'store/list', resultsCursor ? { resultsCursor } : {}).then(value => { if (live) setListing(value); }).catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setListingBusy(false); });
      return () => { live = false; };
    }, [projectId, resultsCursor, resourceRevision]);
    useEffect(() => {
      if (!deliveryCursor) { setDeliveries(null); return; }
      let live = true; setDeliveriesBusy(true); setError('');
      read(projectId, 'store/list', { kind: 'deliveries', cursor: deliveryCursor }).then(value => { if (live) setDeliveries(value.deliveries); }).catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setDeliveriesBusy(false); });
      return () => { live = false; };
    }, [projectId, deliveryCursor, resourceRevision]);
    useEffect(() => {
      if (!requestCursor) { setRequestsPage(null); return; }
      let live = true; setRequestsBusy(true); setError('');
      read(projectId, 'store/list', { kind: 'requests', cursor: requestCursor }).then(value => { if (live) setRequestsPage(value.requests); }).catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setRequestsBusy(false); });
      return () => { live = false; };
    }, [projectId, requestCursor, resourceRevision]);
    useEffect(() => {
      if (!selectedWork) { setSelectionBusy(false); return; }
      let live = true; setSelectedResult(null); setError(''); setSelectionBusy(true);
      Promise.all([read(projectId, 'workstreams/get', { workstreamId: selectedWork }), read(projectId, 'store/results', { workstreamId: selectedWork, ...(selectedDelegation ? { delegationRef: selectedDelegation } : {}) })]).then(([value, history]) => {
        if (!live) return;
        const report = selectedDelegation ? history.items.find(item => item.delegationRef === selectedDelegation) : history.items[0];
        if (selectedDelegation && !report) throw new Error(t('resultMissing'));
        setSelectedResult(report ? { workstreamId: selectedWork, title: value.workstream.title, report, reportCount: history.total, request: history.request ?? report.request, current: report.delegationRef === value.workstream.currentDelegationRef } : null);
      }).catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setSelectionBusy(false); });
      return () => { live = false; };
    }, [projectId, selectedWork, selectedDelegation]);
    useEffect(() => { if (!selectedWork && contentRef.current) contentRef.current.scrollTop = returnScroll.current; }, [selectedWork]);
    useEffect(() => {
      let live = true;
      if (path === 'docs') { setLoadedPath('docs'); setBusy(false); setError(''); return; }
      setLoadedPath(null); setBusy(true); setError(''); setNotice(''); setGeneratedText('');
      if (path === 'notes.md') read(projectId, 'store/read', { path: 'decisions.md' }).then(value => { if (live) setDecisionText(value?.text ?? ''); }).catch(() => { if (live) setDecisionText(''); });
      read(projectId, 'store/read', { path }).then(value => { if (live) { const editableText = path === 'notes.md' ? value.userText : value.text; setText(editableText); setSavedText(editableText); setGeneratedText(value.generatedText ?? ''); setLoadedPath(path); } })
        .catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setBusy(false); });
      return () => { live = false; };
    }, [projectId, path]);
    const editable = path === 'notes.md' || path === 'preferences.md' || path === 'charter.md';
    const textBytes = editable && loadedPath === path ? new TextEncoder().encode(text).byteLength : 0, tooLong = textBytes > (path === 'charter.md' ? charterLimit : 256000);
    const charterLines = ['Tests', 'Scope', 'Verify', 'Language'].map(key => ({ key, label: t(`charterExample${key}`), line: t(`charterLine${key}`) }));
    const hasRule = line => text.split('\n').some(item => item.trim() === line);
    const toggleRule = line => { if (readonly || pending) return; setText(hasRule(line) ? text.split('\n').filter(item => item.trim() !== line).join('\n') : `${text.replace(/\s+$/, '')}${text.trim() ? '\n' : ''}${line}`); setNotice(''); };
    const save = async () => {
      if (tooLong) return false;
      setBusy(true); setError(''); setNotice('');
      try { const value = await command(projectId, 'store/write', { path, text }); setSavedText(text); if (path === 'notes.md') setGeneratedText(value.generatedText ?? generatedText); setNotice(t('saved')); return true; } catch (failure) { setError(errorText(failure)); return false; } finally { setBusy(false); }
    };
    useEffect(() => { if (editorRef) editorRef.current = { save, discard: () => { setText(savedText); setNotice(''); }, dirty, busy: pending, tooLong }; return () => { if (editorRef) editorRef.current = null; }; }, [editorRef, save, savedText, dirty, pending, tooLong]);
    const tabs = ['docs', 'charter.md', 'preferences.md', 'notes.md'].map(file => ({ value: file, label: t({ docs: 'workResults', 'charter.md': 'charter', 'preferences.md': 'preferences', 'notes.md': 'notes' }[file]), id: `${projectId}-material-tab-${file}`, panelId: `${projectId}-material-panel-${file}` }));
    const switchPath = next => { if (pending || next === path) return; if (dirty) { setError(''); setPendingPath(next); } else setPath(next); };
    const finishSwitch = () => { setPath(pendingPath); setPendingPath(null); setNotice(''); };
    const openReport = reference => { returnScroll.current = contentRef.current?.scrollTop ?? 0; setSelectedDelegation(reference.delegationRef); setSelectedWork(reference.workstreamId); };
    const deliveryPage = deliveries ?? listing?.deliveries;
    const authorityRequests = requestsPage ?? listing?.requests;
    const deliveryGroups = new Map();
    for (const delivery of deliveryPage?.items ?? []) { const items = deliveryGroups.get(delivery.requestId) ?? []; items.push(delivery); deliveryGroups.set(delivery.requestId, items); }
    return h(Fragment, null, h('div', { className: 'dsh-project-body dsh-project-materials' },
      h(SegmentedTabs, { className: 'dsh-project-materials-tabs', label: t('materials'), items: tabs, value: path, onChange: switchPath }),
      h('div', { ref: contentRef, className: 'dsh-project-materials-content', onScroll: event => { if (active) visibleScroll.current = event.currentTarget.scrollTop; }, role: 'tabpanel', id: `${projectId}-material-panel-${path}`, 'aria-labelledby': `${projectId}-material-tab-${path}` },
      path === 'docs' ? h(Fragment, null,
      selectedWork ? h(Fragment, null,
        h(Button, { variant: 'ghost', size: 'sm', style: { alignSelf: 'flex-start' }, onClick: () => { setSelectedWork(undefined); setSelectedDelegation(undefined); setSelectedResult(null); } }, t('allResults')),
        selectedResult ? h(ResultEntry, { key: selectedResult.workstreamId + ':' + selectedResult.report.delegationRef, projectId, result: selectedResult, read, showProcess, t }) : null) : null,
      h('div', { className: 'dsh-project-results-list', hidden: Boolean(selectedWork) },
        authorityRequests?.items.map(request => h(RequestAuthority, { key: request.id, request, className: 'dsh-project-result', t })),
        h('div', { className: 'dsh-project-actions' }, requestCursors.length > 1 ? button(t('previous'), () => setRequestCursors(before => before.slice(0, -1)), requestsBusy) : null,
          authorityRequests?.nextCursor ? button(t('earlierRequests'), () => setRequestCursors(before => [...before, authorityRequests.nextCursor]), requestsBusy) : null),
        requestsBusy ? h('p', { role: 'status' }, t('loading')) : null,
        [...deliveryGroups.entries()].map(([requestId, items]) => h(DeliveryGroup, { key: requestId, projectId, items, results: listing?.results, read, openReport, showProcess, renderFactorySlot, t })),
        h('div', { className: 'dsh-project-actions' }, deliveryCursors.length > 1 ? button(t('previous'), () => setDeliveryCursors(before => before.slice(0, -1)), deliveriesBusy) : null,
          deliveryPage?.nextCursor ? button(t('earlierDeliveries'), () => setDeliveryCursors(before => [...before, deliveryPage.nextCursor]), deliveriesBusy) : null),
        deliveriesBusy ? h('p', { role: 'status' }, t('loading')) : null,
        listing?.results?.length ? h('details', { className: 'dsh-project-result-disclosure', open: !deliveryPage?.items.length }, h('summary', null, t('memberReports')),
          listing.results.map(result => h(ResultEntry, { key: result.workstreamId, projectId, result, read, showProcess, t })),
          h('div', { className: 'dsh-project-actions' }, resultCursors.length > 1 ? button(t('previous'), () => setResultCursors(before => before.slice(0, -1)), pending) : null,
            listing.nextResultsCursor ? button(t('next'), () => setResultCursors(before => [...before, listing.nextResultsCursor]), pending) : null)) : null,
        !pending && !error && !deliveryPage?.items.length && !listing?.results?.length && !authorityRequests?.items.length ? h('p', { className: 'dsh-project-muted' }, t('noResults')) : null),
      h('details', { className: 'dsh-project-documents' }, h('summary', null, t('docs'), ` (${listing?.docs.length ?? 0})`), listing?.docs.length ? h('div', { className: 'dsh-project-list' }, listing.docs.map(file => h(Artifact, {
        key: file.path, file: { ...file, location: 'materials' }, busy: pending, t, open: path => { void read(projectId, 'open', { path }).catch(failure => setError(errorText(failure))); },
      }))) : h('p', { className: 'dsh-project-muted' }, t('noDocs')))) : loadedPath === path ? h(Fragment, null,
        path === 'charter.md' ? h('div', { className: 'dsh-project-charter-intro' }, h('strong', null, t('charter')), h('p', null, t('charterHint'))) : h('p', { className: 'dsh-project-muted' }, t(path === 'notes.md' ? 'notesHint' : 'preferencesHint')),
        path === 'charter.md' && !readonly ? h('div', { className: 'dsh-project-charter-examples' }, h('span', null, t('charterExamples')),
          charterLines.map(item => h(Pill, { key: item.key, active: hasRule(item.line), 'aria-pressed': hasRule(item.line), disabled: pending, title: item.line.replace(/^-\s*/, ''), onClick: () => toggleRule(item.line) }, item.label))) : null,
        h('textarea', { className: 'dsh-project-editor', value: text, placeholder: path === 'charter.md' ? t('charterPlaceholder') : undefined, disabled: pending, readOnly: readonly, 'aria-label': t(path === 'notes.md' ? 'userNotes' : path === 'charter.md' ? 'charter' : 'preferences'), onChange: event => { setText(event.target.value); setNotice(''); } }),
        path === 'charter.md' ? h('div', { className: 'dsh-project-charter-meter', 'data-over': tooLong },
          h('div', { className: 'dsh-project-charter-meter-track', 'aria-hidden': true }, h('span', { style: { width: `${Math.min(100, textBytes / charterLimit * 100)}%` } })),
          h('span', { role: tooLong ? 'alert' : undefined }, tooLong ? t('charterTooLong') : t('charterUsage').replace('{used}', (textBytes / 1000).toFixed(1)).replace('{limit}', String(charterLimit / 1000))))
          : tooLong ? h('p', { role: 'alert', className: 'dsh-project-error' }, t('textTooLong')) : null,
        path === 'notes.md' ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('generatedNotes')), markdown(t, generatedText)) : null,
        path === 'notes.md' ? h('details', { className: 'dsh-project-result-disclosure', 'data-decision-log': true }, h('summary', null, t('decisionLog')),
          decisionText.replace(/^# .*\n+/, '').trim() ? markdown(t, decisionText.replace(/^# .*\n+/, '').replace(/<!-- decision:[^>]* -->\n?/g, '')) : h('p', { className: 'dsh-project-muted' }, t('decisionLogEmpty'))) : null) : null,
      pending ? h('p', { role: 'status' }, t('loading')) : null,
      error ? h(Fragment, null, h('p', { role: 'alert', className: 'dsh-project-error' }, t(editable && dirty ? 'saveFailed' : 'materialsError')), h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, error))) : null),
      editable ? h('div', { className: 'dsh-project-materials-footer' }, readonly ? h('p', { className: 'dsh-project-muted' }, t('archivedMaterials')) : h(Fragment, null,
        notice ? h('p', { role: 'status', className: 'dsh-project-muted' }, notice) : null, h(Button, { variant: 'primary', onClick: save, disabled: pending || loadedPath !== path || !dirty || tooLong }, t('save')))) : null),
      h(Modal, { open: pendingPath !== null, onClose: () => { if (!busy) setPendingPath(null); }, closeLabel: t('keepEditing'), className: 'dsh-project-confirm', title: t('unsaved'), footer: h('div', { className: 'dsh-project-actions' },
        h(Button, { variant: 'ghost', onClick: () => setPendingPath(null), disabled: busy }, t('keepEditing')), button(t('discardAndSwitch'), () => { setText(savedText); finishSwitch(); }, busy), h(Button, { variant: 'primary', onClick: async () => { if (await save()) finishSwitch(); }, disabled: busy || readonly || tooLong }, t('saveAndSwitch'))) },
        h('p', { className: 'dsh-project-muted' }, t('saveBeforeSwitch')),
        tooLong ? h('p', { role: 'alert', className: 'dsh-project-error' }, t('textTooLong')) : null,
        error ? h(Fragment, null, h('p', { role: 'alert', className: 'dsh-project-error' }, t('saveFailed')), h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, error))) : null));
  }

  function ProcessRecords({ project, work, delegation, retainProcess, t }) {
    const [binding, setBinding] = useState(null), [window, setWindow] = useState(null), [sessionState, setSessionState] = useState(null);
    const [error, setError] = useState(''), [pageEnd, setPageEnd] = useState(null), [pageStart, setPageStart] = useState(null), [busy, setBusy] = useState(false), [locating, setLocating] = useState(false), [locatedRef, setLocatedRef] = useState(null);
    useEffect(() => {
      let live = true, reference, offEvents, offState;
      setError('');
      try {
        reference = retainProcess(project, work);
        reference.ready.then(value => {
          if (!live) return;
          setBinding(value);
          const updateEvents = () => setWindow(value.eventSource.getSnapshot()), updateState = () => setSessionState(value.session.getSnapshot());
          offEvents = value.eventSource.subscribe(updateEvents); offState = value.session.subscribe(updateState); updateEvents(); updateState();
        }).catch(failure => { if (live) setError(errorText(failure)); });
      } catch (failure) { setError(errorText(failure)); }
      return () => { live = false; offEvents?.(); offState?.(); reference?.release(); };
    }, [project.id, work.workerSessionId]);
    useEffect(() => {
      if (!binding || !delegation) return;
      let live = true; setLocating(true); setError('');
      void (async () => {
        if (!delegation.messageId) throw new Error(t('runRecordsMissing'));
        while (live) {
          const snapshot = binding.eventSource.getSnapshot(), items = processRecords(snapshot.entries);
          const target = assignmentIndex(items, delegation.messageId);
          if (target >= 0) {
            const boundary = assignmentPageStart(items, target);
            setPageStart(boundary); setPageEnd(Math.min(assignmentPageEnd(items, target, project.coordinatorSessionId), boundary + 50)); setLocatedRef(delegation.ref); return;
          }
          if (!snapshot.hasMore) throw new Error(t('runRecordsMissing'));
          const firstSeq = snapshot.entries.find(entry => entry.type === 'event')?.event.seq;
          await binding.session.loadOlder();
          if (!live) return;
          if (binding.eventSource.getSnapshot().entries.find(entry => entry.type === 'event')?.event.seq === firstSeq) throw new Error(t('runRecordsMissing'));
        }
      })().catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setLocating(false); });
      return () => { live = false; };
    }, [binding, delegation?.ref]);
    const records = processRecords(window?.entries ?? []), end = pageEnd ?? records.length, start = pageStart ?? Math.max(0, end - 50);
    const callNames = new Map(records.filter(event => event.type === 'tool/call').map(event => [event.data.callId, event.data.name]));
    const targetUnresolved = Boolean(delegation && locatedRef !== delegation.ref);
    const older = async () => {
      if (start > 0) { setPageStart(null); setPageEnd(start); return; }
      if (!binding || !window.hasMore) return;
      const firstSeq = records[0]?.seq;
      setBusy(true); setError('');
      try {
        await binding.session.loadOlder();
        const updated = processRecords(binding.eventSource.getSnapshot().entries);
        const boundary = firstSeq === undefined ? updated.length : updated.findIndex(event => event.seq === firstSeq);
        if (boundary > 0) { setPageStart(null); setPageEnd(boundary); }
      } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
    };
    return h('div', { className: 'dsh-project-body' }, h('p', { className: 'dsh-project-muted' }, t('processHint')),
      !window && !error ? h('p', { role: 'status' }, t('loading')) : null,
      locating ? h('p', { role: 'status' }, t('locatingRun')) : null,
      (targetUnresolved ? [] : records.slice(start, end)).map(event => {
        const data = event.data;
        if (event.type === 'turn/start') return h('div', { key: event.seq, className: 'dsh-project-record-round' }, h('div', { className: 'dsh-project-record-heading' }, h('strong', null, `${t('executionRound')} ${data.turn}`), recordedTime(event.time)));
        if (event.type === 'user/message') return h('details', { key: event.seq, className: 'dsh-project-record-row' }, h('summary', null, t(data.source.kind === 'team-message' ? 'teamMessage' : 'workRequest'), ' · ', recordedTime(event.time)), markdown(t, messageText(data)));
        if (event.type === 'assistant/message') {
          const text = messageText(data.message);
          return text.trim() ? h('div', { key: event.seq, className: 'dsh-project-record-row' }, h('div', { className: 'dsh-project-record-heading' }, h('strong', null, t('assistant')), recordedTime(event.time)), markdown(t, text)) : null;
        }
        if (event.type === 'tool/call') return h('details', { key: event.seq, className: 'dsh-project-record-row' }, h('summary', null, `${t('tool')}: ${data.name}`, ' · ', recordedTime(event.time)), h('pre', { className: 'dsh-project-record' }, data.arguments));
        if (event.type === 'tool/result') return h('details', { key: event.seq, className: 'dsh-project-record-row' }, h('summary', null, `${t(data.message.isError ? 'failed' : 'result')}: ${callNames.get(data.message.toolCallId) ?? t('tool')}`, ' · ', recordedTime(event.time)), h('pre', { className: 'dsh-project-record' }, messageText(data.message)), data.error ? h('p', { className: 'dsh-project-error' }, data.error.reason ?? data.error.code) : null);
        return h('details', { key: event.seq, className: 'dsh-project-record-row' }, h('summary', null, `${t('executionRound')} ${data.turn} · ${t(data.reason?.kind === 'error' ? 'historicalError' : 'roundEnded')}`, ' · ', recordedTime(event.time)), data.reason?.kind === 'error' ? h('pre', { className: 'dsh-project-record' }, data.reason.error.message) : null);
      }), window && !records.length ? h('p', { className: 'dsh-project-muted' }, t('noProcess')) : null,
      sessionState?.openError ? h('p', { role: 'alert', className: 'dsh-project-error' }, sessionState.openError.message) : null,
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
      h('div', { className: 'dsh-project-actions' }, start > 0 || window?.hasMore ? button(t(start > 0 ? 'previous' : 'older'), older, busy || locating || targetUnresolved) : null,
        pageEnd !== null && end < records.length ? button(t('next'), () => { setPageStart(end); setPageEnd(Math.min(records.length, end + 50)); }, busy || locating || targetUnresolved) : null,
        pageEnd !== null ? button(t('newer'), () => { setPageStart(null); setPageEnd(null); }, busy || locating || targetUnresolved) : null));
  }

  const diffLineLimit = 400;
  const diffLineKind = line => line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('\\') ? 'note' : 'context';
  const diffStatusKind = status => status === '??' ? 'untracked' : /D/.test(status) ? 'deleted' : /A/.test(status) ? 'added' : /R/.test(status) ? 'renamed' : 'modified';
  // Split a unified `git diff` into per-file sections with added/removed line counts.
  function parseUnifiedDiff(text) {
    const files = []; let current = null;
    for (const line of String(text ?? '').replace(/\n$/, '').split('\n')) {
      const header = /^diff --git a\/(.*?) b\/(.*)$/.exec(line);
      if (header) { current = { path: header[2], lines: [], added: 0, removed: 0, kind: header[1] !== header[2] ? 'renamed' : 'modified' }; files.push(current); continue; }
      if (!current) continue;
      if (!current.lines.length && /^new file mode/.test(line)) current.kind = 'added';
      else if (!current.lines.length && /^deleted file mode/.test(line)) current.kind = 'deleted';
      else if (!current.lines.length && /^(index |similarity |dissimilarity |rename |copy |old mode|new mode|--- |\+\+\+ )/.test(line)) continue;
      else if (/^Binary files /.test(line)) current.binary = true;
      else { if (line.startsWith('+')) current.added++; else if (line.startsWith('-')) current.removed++; current.lines.push(line); }
    }
    return files;
  }
  const diffTone = { added: 'success', deleted: 'danger', renamed: 'info', untracked: 'outline', modified: 'neutral' };
  function diffDirectoryLabel(directory, directories) {
    const parts = directoryParts({ canonicalWorkingDirectory: directory });
    if (!parts.length || /^[a-z]:[\\/]*$/i.test(directory)) return directory;
    const peers = directories.filter(other => other !== directory).map(other => directoryParts({ canonicalWorkingDirectory: other }));
    for (let count = 1; count < parts.length; count++) {
      const label = parts.slice(-count).join('/');
      if (peers.every(other => other.slice(-count).join('/') !== label)) return `…/${label}`;
    }
    return directory;
  }
  function DiffFile({ file, directoryLabel, open, t }) {
    const slash = file.path.lastIndexOf('/'), shown = file.lines.slice(0, diffLineLimit);
    const location = file.workingDirectory ? `${t('diffWorkingDirectory')}: ${file.workingDirectory}\n${t('diffRepositoryPath')}: ${file.path}` : file.path;
    return h('details', { className: 'dsh-project-diff-file', open, 'data-diff-path': file.path, 'data-diff-directory': file.workingDirectory },
      h('summary', null, h(Tag, { tone: diffTone[file.kind] }, t(`diff_${file.kind}`)),
        h('span', { className: 'dsh-project-diff-name', title: location }, slash >= 0 ? h('span', null, file.path.slice(0, slash + 1)) : null, file.path.slice(slash + 1),
          file.workingDirectory ? h('span', null, ` · ${directoryLabel}`) : null),
        file.added ? h('span', { className: 'dsh-project-diff-add' }, `+${file.added}`) : null, file.removed ? h('span', { className: 'dsh-project-diff-del' }, `−${file.removed}`) : null),
      file.kind === 'untracked' ? h('p', { className: 'dsh-project-diff-note' }, t('diffUntrackedHint'))
        : file.binary ? h('p', { className: 'dsh-project-diff-note' }, t('diffBinary'))
        : shown.length ? h('pre', { className: 'dsh-project-diff-lines' }, shown.map((line, index) => h('span', { key: index, className: 'dsh-project-diff-line', 'data-kind': diffLineKind(line) }, line || ' ')))
        : h('p', { className: 'dsh-project-diff-note' }, t('diffNoContent')),
      file.lines.length > diffLineLimit ? h('p', { className: 'dsh-project-diff-note' }, t('diffLinesCapped').replace('{count}', diffLineLimit)) : null);
  }

  function DiffView({ files, truncated, t }) {
    const added = files.reduce((sum, file) => sum + file.added, 0), removed = files.reduce((sum, file) => sum + file.removed, 0);
    const directories = [...new Set(files.map(file => file.workingDirectory).filter(Boolean))];
    const labels = new Map(directories.map(directory => [directory, diffDirectoryLabel(directory, directories)]));
    return !files.length ? h('p', { className: 'dsh-project-muted' }, t('noDiff')) : h(Fragment, null,
      h('div', { className: 'dsh-project-diff-summary' }, h('strong', null, t('diffFileCount').replace('{count}', files.length)),
        h('span', { className: 'dsh-project-diff-add' }, `+${added}`), h('span', { className: 'dsh-project-diff-del' }, `−${removed}`)),
      files.map((file, index) => h(DiffFile, { key: `${file.workingDirectory ?? ''}:${file.path}`, file, directoryLabel: labels.get(file.workingDirectory), open: index < 3, t })),
      truncated ? h('p', { className: 'dsh-project-muted' }, t('diffTruncated')) : null);
  }

  function FileDiff({ projectId, workstreamId, read, t }) {
    const [value, setValue] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      let live = true;
      read(projectId, 'diff', { workstreamId }).then(result => { if (live) setValue(result); }).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [projectId, workstreamId]);
    if (error) return h('div', { className: 'dsh-project-body' }, h('p', { role: 'alert', className: 'dsh-project-error' }, error));
    if (!value) return h('div', { className: 'dsh-project-body' }, h('p', { role: 'status' }, t('loading')));
    const parsed = parseUnifiedDiff(value.snapshot.diff), known = new Set(parsed.map(file => file.path));
    const files = [...parsed, ...(value.snapshot.files ?? []).filter(file => !known.has(file.path)).map(file => ({ path: file.path, lines: [], added: 0, removed: 0, kind: diffStatusKind(file.status) }))];
    return h('div', { className: 'dsh-project-body dsh-project-diff' },
      h('p', { className: 'dsh-project-muted' }, t('diffScope')),
      h('p', { className: 'dsh-project-path' }, value.worker.cwd, value.worker.branch ? ` · ${t('branch')}: ${value.worker.branch}` : ''),
      value.snapshot.isGit === false ? h('p', { className: 'dsh-project-muted' }, t('notGit')) : h(DiffView, { files, truncated: value.snapshot.truncated, t }));
  }

  // One requirement's own changes: from its recorded starting point to its delivery (or to now before delivery).
  function RequestDiff({ projectId, requestId, read, t }) {
    const [value, setValue] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      let live = true;
      read(projectId, 'requests/changes', { requestId }).then(result => { if (live) setValue(result); }).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [projectId, requestId]);
    if (error) return h('div', { className: 'dsh-project-body' }, h('p', { role: 'alert', className: 'dsh-project-error' }, error));
    if (!value) return h('div', { className: 'dsh-project-body' }, h('p', { role: 'status' }, t('loading')));
    const files = (value.workspaces ?? [value]).flatMap(scope => {
      const parsed = parseUnifiedDiff(scope.diff), known = new Set(parsed.map(file => file.path));
      return [...parsed, ...(scope.files ?? []).filter(file => !known.has(file.path)).map(file => ({ path: file.path, lines: [], added: file.added, removed: file.removed, binary: file.binary, kind: diffStatusKind(file.status) }))]
        .map(file => ({ ...file, ...(scope.workingDirectory ? { workingDirectory: scope.workingDirectory } : {}) }));
    });
    return h('div', { className: 'dsh-project-body dsh-project-diff', 'data-request-diff': requestId },
      h('p', { className: 'dsh-project-muted' }, t(value.final ? 'requestDiffScope' : 'requestDiffLive'), value.revertedAt ? ` ${t('requestDiffReverted')}` : '', value.isolated ? ` ${t('requestDiffIsolated')}` : ''),
      h(DiffView, { files, truncated: value.truncated, t }));
  }

  function ProcessPreview({ project, workstreamId, workerSessionId, delegationRef, read, retainProcess, t }) {
    const [value, setValue] = useState(null), [error, setError] = useState(''), [selectedRef, setSelectedRef] = useState(delegationRef);
    const [pickerOpen, setPickerOpen] = useState(false), [runPageEnd, setRunPageEnd] = useState(null);
    useEffect(() => { setSelectedRef(delegationRef); }, [delegationRef]);
    useEffect(() => {
      let live = true; setValue(null); setError('');
      void read(project.id, 'workstreams/get', workerSessionId ? { workerSessionId } : { workstreamId }).then(result => { if (live) setValue(result); }).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [project.id, workstreamId, workerSessionId]);
    const delegation = value?.workstream.delegations?.find(item => item.ref === selectedRef);
    const delegations = value?.workstream.delegations ?? [], runEnd = runPageEnd ?? delegations.length, runStart = Math.max(0, runEnd - 20);
    return error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : value ? h('div', { className: 'dsh-project-body' },
      h('strong', null, value.workstream.title),
      value.workstream.request && (!delegation || delegation.requestId === value.workstream.request.id && delegation.requestRevision === value.workstream.request.revision) ? h('p', { className: 'dsh-project-muted' }, requestLabel(t, value.workstream.request)) : delegation?.requestRevision ? h('p', { className: 'dsh-project-muted' }, `${t('requestVersion')} ${delegation.requestRevision}`) : null,
      delegations.length > 1 ? h('details', { className: 'dsh-project-result-disclosure', open: pickerOpen, onToggle: event => setPickerOpen(event.currentTarget.open) }, h('summary', null, t('selectRun')), pickerOpen ? h(Fragment, null,
        h('div', { className: 'dsh-project-record-runs' }, delegations.slice(runStart, runEnd).map(item => h(Button, { key: item.ref, variant: 'ghost', size: 'sm', 'aria-pressed': item.ref === selectedRef, onClick: () => setSelectedRef(item.ref) }, recordedTime(item.createdAt), item.requestRevision ? ` · ${t('requestVersion')} ${item.requestRevision}` : ''))),
        h('div', { className: 'dsh-project-actions' }, runStart > 0 ? button(t('previous'), () => setRunPageEnd(runStart)) : null, runEnd < delegations.length ? button(t('next'), () => setRunPageEnd(Math.min(delegations.length, runEnd + 20))) : null)) : null) : null,
      selectedRef && !delegation ? h('p', { role: 'alert', className: 'dsh-project-error' }, t('runRecordsMissing')) : h(ProcessRecords, { key: value.workstream.workerSessionId, project, work: value.workstream, delegation, retainProcess, t })) : h('p', { role: 'status' }, t('loading'));
  }

  function ProjectOverlay({ useStore, actions, useProjects, read, command, retainProcess, getFileReturn, renderFactorySlot, t }) {
    const modal = useStore(value => value.modal), transition = useStore(value => value.pendingModal), materialsPreview = useStore(value => value.materialsPreview);
    const detail = useProjects(value => modal ? value.details[modal.projectId] : undefined), project = useProjects(value => modal ? value.projects.find(item => item.id === modal.projectId) : undefined);
    const [child, setChild] = useState(null), [transitionBusy, setTransitionBusy] = useState(false), [transitionFailed, setTransitionFailed] = useState(false);
    const editorRef = useRef(null), backRef = useRef(null), processReturn = useRef(null), materialsHost = useRef(null), parking = useRef(null), wasPreview = useRef(false), returnPosition = useRef();
    const [materialsContainer] = useState(() => { const element = document.createElement('div'); element.className = 'dsh-project-materials-host'; return element; });
    const restoreMaterialsScroll = () => {
      const content = materialsContainer.querySelector('.dsh-project-materials-content');
      const saved = returnPosition.current;
      if (saved?.scrollTop !== undefined && (!saved.isCurrent || saved.isCurrent()) && saved.modal.projectId === modal?.projectId && saved.modal.workstreamId === modal?.workstreamId && saved.modal.delegationRef === modal?.delegationRef
        && !materialsPreview && !child && !materialsContainer.hidden && content?.getClientRects().length) {
        content.scrollTop = saved.scrollTop;
        returnPosition.current = undefined;
        if (saved === processReturn.current) saved.pending = false;
      }
    };
    useLayoutEffect(() => {
      if (wasPreview.current && !materialsPreview) returnPosition.current = getFileReturn();
      if (!child && processReturn.current?.pending) returnPosition.current = processReturn.current;
      materialsContainer.hidden = Boolean(child);
      const target = materialsPreview ? parking.current : materialsHost.current;
      if (target && materialsContainer.parentNode !== target) target.append(materialsContainer);
      if (target && target === materialsHost.current) restoreMaterialsScroll();
    }, [materialsContainer, materialsPreview, child, modal]);
    useEffect(() => { if (wasPreview.current && !materialsPreview && !transition) { const origin = getFileReturn()?.origin; if (origin?.isConnected) origin.focus({ preventScroll: true }); } wasPreview.current = materialsPreview; }, [materialsPreview, transition]);
    useEffect(() => { setChild(null); processReturn.current = null; returnPosition.current = undefined; }, [modal]);
    useEffect(() => { if (child) backRef.current?.focus(); else if (processReturn.current?.origin?.isConnected && (!processReturn.current.isCurrent || processReturn.current.isCurrent())) processReturn.current.origin.focus({ preventScroll: true }); }, [child]);
    useEffect(() => { setTransitionFailed(false); }, [transition]);
    if (!modal) return null;
    const close = () => { if (child) setChild(null); else actions.setModal(null); };
    const openRecords = (_projectId, workstreamId, member = false, context = {}) => {
      processReturn.current = { origin: document.activeElement, modal, scrollTop: materialsContainer.querySelector('.dsh-project-materials-content')?.scrollTop, isCurrent: context.isCurrent, pending: true };
      setChild({ kind: 'process', workstreamId, ...(member ? { workerSessionId: workstreamId } : {}), ...context });
    };
    const saveAndLeave = async () => { if (!editorRef.current || editorRef.current.busy || transitionBusy) return; setTransitionBusy(true); setTransitionFailed(false); try { if (await editorRef.current.save()) actions.completeModalTransition(); else setTransitionFailed(true); } finally { setTransitionBusy(false); } };
    const title = `${t(child ? 'process' : { report: 'reportSource', requestDiff: 'viewChanges' }[modal.kind] ?? modal.kind)}${project ? ' · ' + project.title : ''}`;
    return h(Fragment, null, h('div', { hidden: true, ref: parking }),
      modal.kind === 'materials' ? createPortal(h(Materials, { key: `${modal.projectId}:${modal.workstreamId ?? ''}:${modal.delegationRef ?? ''}`, projectId: modal.projectId, resourceRevision: detail?.revision, workstreamId: modal.workstreamId, delegationRef: modal.delegationRef, read, command, onDirtyChange: actions.setModalDirty, editorRef, readonly: detail?.project.lifecycle === 'archived' || detail?.project.archiving, showProcess: openRecords, renderFactorySlot, t }), materialsContainer) : null,
      h(Modal, { open: !materialsPreview, onClose: close, closeLabel: t(child ? 'backToResults' : 'close'), title, className: 'dsh-project-modal', contentClassName: 'dsh-project-modal-content' },
      child ? h('div', { className: 'dsh-project-context' }, h(Button, { ref: backRef, variant: 'ghost', size: 'sm', onClick: () => setChild(null) }, t('backToResults')), child.request ? h('span', { className: 'dsh-project-context-label' }, requestLabel(t, child.request)) : child.reportAt ? recordedTime(child.reportAt) : null) : null,
      modal.kind === 'materials' ? h('div', { className: 'dsh-project-materials-frame', ref: element => { materialsHost.current = element; if (element && !materialsPreview) { element.append(materialsContainer); restoreMaterialsScroll(); } } })
        : modal.kind === 'diff' ? h(FileDiff, { key: modal.workstreamId, projectId: modal.projectId, workstreamId: modal.workstreamId, read, t })
          : modal.kind === 'requestDiff' ? h(RequestDiff, { key: modal.requestId, projectId: modal.projectId, requestId: modal.requestId, read, t })
          : modal.kind === 'report' ? h('div', { hidden: Boolean(child) }, h(ProjectReportView, { key: `${modal.workstreamId}:${modal.delegationRef ?? ''}`, projectId: modal.projectId, reference: modal, read, showProcess: openRecords, t }))
          : detail ? h(ProcessPreview, { key: modal.workstreamId ?? modal.workerSessionId, project: detail.project, workstreamId: modal.workstreamId, workerSessionId: modal.workerSessionId, delegationRef: modal.delegationRef, read, retainProcess, t }) : h('p', { role: 'status' }, t('loading')),
      child && detail ? h(ProcessPreview, { key: child.workstreamId + ':' + (child.delegationRef ?? ''), project: detail.project, workstreamId: child.workerSessionId ? undefined : child.workstreamId, workerSessionId: child.workerSessionId, delegationRef: child.delegationRef, read, retainProcess, t }) : null),
      h(Modal, { open: Boolean(transition), onClose: () => { if (!transitionBusy) actions.cancelModalTransition(); }, closeLabel: t('keepEditing'), className: 'dsh-project-confirm', title: t('unsaved'), footer: h('div', { className: 'dsh-project-actions' },
        button(t('keepEditing'), () => actions.cancelModalTransition(), transitionBusy), button(t(transition?.target ? 'discardAndSwitch' : 'discard'), () => actions.completeModalTransition(), transitionBusy), h(Button, { variant: 'primary', onClick: saveAndLeave, disabled: transitionBusy || editorRef.current?.busy || editorRef.current?.tooLong || project?.lifecycle === 'archived' || project?.archiving }, t(transition?.target ? 'saveAndSwitch' : 'saveAndClose'))) },
        project ? h('p', { className: 'dsh-project-context-label' }, project.title) : null,
        h('p', { className: 'dsh-project-muted' }, t(transition?.target ? 'saveBeforeSwitch' : 'saveBeforeClose')),
        editorRef.current?.tooLong ? h('p', { role: 'alert', className: 'dsh-project-error' }, t('textTooLong')) : null,
        transitionFailed ? h('p', { role: 'alert', className: 'dsh-project-error' }, t('saveFailed')) : null));
  }

  return {
    inject: ['slots', 'connection', 'locale', 'uiWorkspace', 'uiSidebar', 'workspaces', 'sessions', 'uiSession', 'conversation', 'settingsNavigation'],
    apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-project: locale');
      ctx.effect(() => ctx.locale.register('project-team', { zh: teamChinese, en: teamEnglish }), 'dsh-project: team locale');
      const snapshot = createSnapshotStore({ projects: [], details: {}, available: false, loading: true, error: '' });
      const requestModes = createSnapshotStore({}, { persist: { name: 'dsh-project.request-modes' } });
      // Desktop verdicts on whether a folder may host a Project, keyed by comparable path.
      const directoryChecks = createSnapshotStore({});
      const checkDirectory = path => {
        const key = comparablePath(path);
        if (directoryChecks.getSnapshot()[key] !== undefined) return;
        directoryChecks.set({ ...directoryChecks.getSnapshot(), [key]: { pending: true } });
        void rpc('directory/check', { workingDirectory: path }).then(
          result => {
            directoryChecks.set({ ...directoryChecks.getSnapshot(), [key]: result.allowed === false ? { reason: result.reason } : {} });
            // Republish so Workspace rows drop the entry for a refused folder.
            if (result.allowed === false) registerAction();
          },
          // An unavailable check leaves the entry; creation still enforces the rule.
          () => directoryChecks.set({ ...directoryChecks.getSnapshot(), [key]: {} }));
      };
      // Bumped to close the header panels when a native file preview takes over.
      const dismissals = createSnapshotStore(0);
      const dismissPanels = () => dismissals.set(dismissals.getSnapshot() + 1);
      const archiveRequests = new Set();
      const viewHandle = defineStore({ init: () => ({ selected: null, modal: null, modalDirty: false, pendingModal: null, modalRevision: 0, materialsPreview: false, lifecycle: null }), actions: {
        selectProject: (draft, id) => { draft.selected = id; },
        setModal: (draft, modal) => {
          if (draft.modal?.kind === modal?.kind && draft.modal?.projectId === modal?.projectId && draft.modal?.workstreamId === modal?.workstreamId && draft.modal?.workerSessionId === modal?.workerSessionId && draft.modal?.delegationRef === modal?.delegationRef && draft.modal?.requestId === modal?.requestId) return;
          if (draft.modal?.kind === 'materials' && draft.modalDirty) { draft.materialsPreview = false; draft.pendingModal = { target: modal }; return; }
          draft.modal = modal; draft.modalDirty = false; draft.pendingModal = null; draft.materialsPreview = false; draft.modalRevision++;
        },
        suspendMaterials: (draft, projectId, revision) => { if (draft.modal?.kind === 'materials' && draft.modal.projectId === projectId && draft.modalRevision === revision) draft.materialsPreview = true; },
        returnMaterials: (draft, projectId) => { if (draft.modal?.projectId === projectId && draft.materialsPreview) { draft.materialsPreview = false; draft.modalRevision++; } },
        setLifecycle: (draft, lifecycle) => { draft.lifecycle = lifecycle; },
        setModalDirty: (draft, dirty) => { draft.modalDirty = dirty; },
        cancelModalTransition: draft => { draft.pendingModal = null; },
        completeModalTransition: draft => { if (!draft.pendingModal) return; draft.modal = draft.pendingModal.target; draft.modalDirty = false; draft.pendingModal = null; draft.materialsPreview = false; draft.modalRevision++; },
      } });
      const viewInstance = viewHandle.create(), viewStore = { ...viewHandle, create: () => viewInstance };
      let alive = true, refreshing, disposeAction, trackedProject, fileReturn;
      let navigationGeneration = 0, refreshGeneration = 0;
      const detailSequences = new Map(), detailPages = new Map();
      const rpc = async (endpoint, input = {}) => {
        const response = await ctx.connection.rpc.call('/dsh-project', endpoint, input), result = response?.result ?? response;
        if (result?.ok === false) throw Object.assign(new Error(result.error?.message ?? result.error?.code ?? t('unavailable')), { code: result.error?.code });
        return result?.value ?? result;
      };
      const acceptDetail = detail => {
        if (!alive || detail?.unchanged || !detail?.project) return;
        const previous = snapshot.getSnapshot(), id = detail.project.id;
        snapshot.set({ ...previous, error: '', projects: previous.projects.some(project => project.id === id)
          ? previous.projects.map(project => project.id === id ? detail.project : project) : [...previous.projects, detail.project],
          details: { ...previous.details, [id]: { workstreams: [], workers: [], ...previous.details[id], ...detail } } });
      };
      const read = async (projectId, endpoint, input, isCurrent) => {
        const originalView = viewInstance.getSnapshot(), origin = document.activeElement;
        const scrollTop = endpoint === 'open' && input?.path && originalView.modal?.kind === 'materials' && originalView.modal.projectId === projectId
          ? document.querySelector('.dsh-project-materials-host:not([hidden]) .dsh-project-materials-content')?.scrollTop : undefined;
        const value = await rpc(endpoint, { ...input, projectId });
        if (endpoint === 'open' && input?.path) {
          if (isCurrent && !isCurrent()) return value;
          if (typeof ctx.workspaces.openPath !== 'function') throw new Error(t('unavailable'));
          const project = snapshot.getSnapshot().projects.find(item => item.id === projectId);
          await ctx.workspaces.openPath(value.canonicalPath, { sessionId: project.coordinatorSessionId, workingDirectory: value.root, presentation: 'mini' });
          if (isCurrent && !isCurrent()) return value;
          dismissPanels();
          // Only Materials can be suspended and returned to; other dialogs give way to the preview.
          if (originalView.modal && originalView.modal.kind !== 'materials' && viewInstance.getSnapshot().modalRevision === originalView.modalRevision) viewInstance.actions.setModal(null);
          const currentView = viewInstance.getSnapshot();
          if (originalView.modal?.kind === 'materials' && originalView.modal.projectId === projectId && originalView.modalRevision === currentView.modalRevision && !currentView.pendingModal && (!isCurrent || isCurrent())) { fileReturn = { origin, modal: originalView.modal, scrollTop, isCurrent }; viewInstance.actions.suspendMaterials(projectId, originalView.modalRevision); }
        }
        return value;
      };
      const readDetail = async (projectId, incremental = false, cursor = detailPages.has(projectId) ? detailPages.get(projectId) : snapshot.getSnapshot().details[projectId]?.workPage?.currentCursor) => {
        const sequence = (detailSequences.get(projectId) ?? 0) + 1;
        detailSequences.set(projectId, sequence); detailPages.set(projectId, cursor ?? null);
        const generation = refreshGeneration, since = incremental ? snapshot.getSnapshot().details[projectId]?.revision : undefined;
        const detail = await read(projectId, 'detail', { ...(since === undefined ? {} : { since }), ...(cursor ? { currentCursor: cursor } : {}) });
        if (generation === refreshGeneration && detailSequences.get(projectId) === sequence) {
          if (!detail.unchanged) detailPages.set(projectId, detail.workPage?.currentCursor ?? null);
          acceptDetail(detail);
        }
        return detail.unchanged ? snapshot.getSnapshot().details[projectId] : detail;
      };
      const command = async (projectId, endpoint, input) => {
        refreshGeneration++;
        if (endpoint === 'archive') { archiveRequests.add(projectId); const current = snapshot.getSnapshot(); snapshot.set({ ...current, projects: current.projects.map(project => project.id === projectId ? { ...project, archiving: true } : project) }); }
        let value;
        try {
          value = await read(projectId, endpoint, endpoint.startsWith('requests/') ? input : { ...input, requestId: requestId() });
          refreshGeneration++;
          if (value?.project) acceptDetail(value);
        } finally { if (endpoint === 'archive') { archiveRequests.delete(projectId); const current = snapshot.getSnapshot(); snapshot.set({ ...current, projects: current.projects.map(project => project.id === projectId ? { ...project, archiving: false } : project) }); } }
        if (!Array.isArray(value?.workstreams) || !Array.isArray(value?.workers)) {
          await readDetail(projectId).catch(failure => { if (alive) snapshot.set({ ...snapshot.getSnapshot(), error: errorText(failure) }); });
        }
        return value;
      };
      const registerAction = () => {
        disposeAction?.(); disposeAction = undefined;
        if (!snapshot.getSnapshot().available) return;
        // Projects start from the New Session option or a Workspace row, not the directory picker.
        disposeAction = ctx.uiWorkspace.registerDirectoryAction({ id: NS, label: t('add'), order: 20, picker: false, adopt: path => startProject(path),
          rowLabel: path => {
            if (projectAt(path)) return t('rowOpen');
            const check = directoryChecks.getSnapshot()[comparablePath(path)];
            if (check === undefined) checkDirectory(path);
            return check?.reason ? undefined : t('rowCreate');
          } });
      };
      const refresh = () => {
        if (refreshing) return refreshing;
        const generation = refreshGeneration;
        refreshing = (async () => {
          try {
            const result = await rpc('list');
            if (!alive || generation !== refreshGeneration) return;
            const previous = snapshot.getSnapshot();
            snapshot.set({ ...previous, projects: result.projects, available: result.available === true, loading: false, error: result.error ?? '' });
            if (previous.available !== (result.available === true)) registerAction();
            if (trackedProject && result.projects.some(project => project.id === trackedProject)) await readDetail(trackedProject, true);
          } catch (failure) { if (alive) snapshot.set({ ...snapshot.getSnapshot(), loading: false, error: errorText(failure) }); }
          finally { refreshing = undefined; }
        })();
        return refreshing;
      };
      // Callers surface failures: the directory picker, a directory row or the New Session option.
      const openProject = async (projectId, open = sessionId => ctx.uiWorkspace.openSession(sessionId)) => {
        const navigation = ++navigationGeneration;
        const detail = await readDetail(projectId);
        if (!alive || navigation !== navigationGeneration) return;
        viewInstance.actions.selectProject(projectId); ctx.uiSidebar.selectTab('sessions'); open(detail.project.coordinatorSessionId);
      };
      const projectAt = path => snapshot.getSnapshot().projects.some(project => project.lifecycle !== 'archived' && comparablePath(project.canonicalWorkingDirectory) === comparablePath(path));
      // Creating an existing directory's Project resumes its original Lead.
      const startProject = async (path, open) => {
        const result = await rpc('create', { workingDirectory: path, requestId: requestId() });
        acceptDetail({ project: result.project }); await openProject(result.project.id, open);
      };
      const show = (kind, projectId, workstreamId, context = {}) => { viewInstance.actions.setModal({ kind, projectId, workstreamId, ...context }); };
      const openLifecycle = async (projectId, action) => {
        const project = snapshot.getSnapshot().projects.find(item => item.id === projectId);
        if (!project) { viewInstance.actions.setLifecycle({ action, error: t('unavailable') }); return; }
        try {
          if (action === 'archive') {
            const detail = await readDetail(project.id), activity = detail.project.activity;
            if (!(activity?.coordinatorRunning || activity?.running || activity?.queued || activity?.provisioning || activity?.state === 'stopping')) { await command(project.id, 'archive'); return; }
          }
          viewInstance.actions.setLifecycle({ projectId, action });
        } catch (failure) { viewInstance.actions.setLifecycle({ projectId, action, error: errorText(failure) }); }
      };
      ctx.effect(() => ctx.uiWorkspace.registerSessionActions('project', {
        rename: sessionId => { const project = snapshot.getSnapshot().projects.find(item => item.coordinatorSessionId === sessionId); void openLifecycle(project?.id, 'rename'); },
        archive: sessionId => { const project = snapshot.getSnapshot().projects.find(item => item.coordinatorSessionId === sessionId); void openLifecycle(project?.id, 'archive'); },
        restore: sessionId => { const project = snapshot.getSnapshot().projects.find(item => item.coordinatorSessionId === sessionId); if (project) return command(project.id, 'restore'); },
      }), 'dsh-project: Project lifecycle commands');
      ctx.effect(() => {
        const entries = createSnapshotStore([]);
        const sync = () => entries.set(snapshot.getSnapshot().projects.map(project => ({ sessionId: project.coordinatorSessionId,
          workingDirectory: project.canonicalWorkingDirectory, archived: project.lifecycle === 'archived' })));
        sync();
        const off = snapshot.subscribe(sync);
        const unregister = ctx.uiWorkspace.registerSessionNavigation('project', entries);
        return () => { off(); unregister(); };
      }, 'dsh-project: workspace navigation');
      const sendUserRequest = async (projectId, text) => {
        const project = snapshot.getSnapshot().projects.find(item => item.id === projectId);
        if (!project || project.lifecycle !== 'ready' || project.archiving) throw new Error(t('unavailable'));
        const scope = ctx.sessions.scope(project.coordinatorSessionId);
        if (!scope) throw new Error(t('unavailable'));
        await scope.get('conversation').send(text);
      };
      const setRequestMode = (sessionId, id, mode, completed = false) => {
        const before = requestModes.getSnapshot();
        requestModes.set({ ...before, [sessionId]: { requests: { ...before[sessionId]?.requests, [id]: { mode, completed } } } });
      };
      const face = () => ({ startProject, checkDirectory, hooks: { directoryChecks, projects: snapshot, projectSessions: ctx.sessions.list, workspaceList: ctx.workspaces.list, projectSessionStatus: ctx.uiSession.sessionStatus, projectView: viewInstance, requestModes, dismissals }, read, command, refresh, openProject, openLifecycle, readDetail, sendUserRequest, getFileReturn: () => fileReturn, teamT: ctx.locale.bind('project-team'),
        setRequestMode,
        trackActiveProject: projectId => { trackedProject = projectId; return () => { if (trackedProject === projectId) trackedProject = undefined; }; },
        openModelSettings: () => ctx.settingsNavigation.open('models'),
        showMaterials: (projectId, workstreamId, context) => { const view = viewInstance.getSnapshot(); if (!workstreamId && view.materialsPreview && view.modal?.projectId === projectId) viewInstance.actions.returnMaterials(projectId); else show('materials', projectId, workstreamId, context); }, showProcess: (projectId, workstreamId, member = false, context = {}) => { viewInstance.actions.setModal({ kind: 'process', projectId, ...(member ? { workerSessionId: workstreamId } : { workstreamId }), ...context }); }, showDiff: (projectId, workstreamId) => show('diff', projectId, workstreamId),
        showReport: (projectId, workstreamId, context) => show('report', projectId, workstreamId, context), showRequestDiff: (projectId, requestId) => show('requestDiff', projectId, undefined, { requestId }),
        trackProject: projectId => { trackedProject = projectId; return () => { if (trackedProject === projectId) trackedProject = undefined; }; },
        retainProcess: (project, work) => ctx.sessions.retain({ parentSessionId: project.coordinatorSessionId, childSessionId: work.workerSessionId, mode: 'continuable' }, { source: 'projectPreview' }),
      });
      ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({ name: 'conversation.hero.options', id: NS, locale: NS, inject: face }, ProjectHeroOption));
      ctx.slots.inject('sidebar.session.row.badge', () => ctx.slots.register({ name: 'sidebar.session.row.badge', id: NS, locale: NS, inject: face }, ProjectRowBadge));
      ctx.slots.inject('conversation.composer', () => {
        const mounted = new Map();
        const sync = () => {
          const projects = snapshot.getSnapshot().projects.filter(project => archiveRequests.has(project.id) || project.archiving || project.lifecycle === 'archived');
          for (const [id, dispose] of mounted) if (!projects.some(project => project.id === id)) { dispose(); mounted.delete(id); }
          for (const project of projects) if (!mounted.has(project.id)) mounted.set(project.id, ctx.slots.register({ name: 'conversation.composer', id: NS + '-' + project.id, priority: 100, locale: NS, inject: face, select: owner => owner.sessionId === project.coordinatorSessionId ? { projectId: project.id } : null }, ProjectArchiveComposer));
        };
        const off = snapshot.subscribe(sync); sync();
        return () => { off(); for (const dispose of mounted.values()) dispose(); };
      });
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: NS, order: -20, locale: NS, inject: face }, ProjectHeader));
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: NS, order: 30, locale: NS, inject: face }, ProjectStop));
      ctx.slots.inject('conversation.approval.actions', () => ctx.slots.register({ name: 'conversation.approval.actions', id: NS, locale: NS, inject: face }, ProjectApprovalStop));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS, locale: NS, store: viewStore, inject: face }, ProjectOverlay));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS + '-lifecycle', locale: NS, store: viewStore, inject: face }, ProjectLifecycleDialog));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS + '-errors', locale: NS, inject: face }, ProjectErrorNotice));
      ctx.effect(() => {
        const style = document.createElement('style'); style.dataset.dshProject = ''; style.textContent = CSS; document.head.append(style);
        const offLocale = ctx.locale.subscribe(registerAction), offReset = ctx.on('connection/reset', () => {
          if (viewInstance.getSnapshot().modal?.kind !== 'materials') viewInstance.actions.setModal(null);
          refreshGeneration++;
          snapshot.set({ ...snapshot.getSnapshot(), available: false }); registerAction(); void refresh();
        });
        const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
        void refresh();
        return () => { alive = false; disposeAction?.(); offLocale(); offReset(); clearInterval(timer); style.remove(); };
      }, 'dsh-project: local conversation entry and progress');
    },
  };
} });
