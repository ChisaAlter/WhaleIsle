window.__ModuleLoader__.load({ id: 'dsh-project', factory: (require) => {
  const { createElement: h, useState, useEffect, useLayoutEffect, useRef, Fragment } = require('react');
  const { createPortal, flushSync } = require('react-dom');
  const { Button, Input, Menu, Modal, Pill, SegmentedTabs, StateDot, Tag, MarkdownText, Toast, Tooltip, IconFolderCloseRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconChecklistOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
  const { createSnapshotStore, defineStore } = require('@deepseek-ai/dsh-client-store');
  const { subagentChatAddress } = require('@deepseek-ai/dsh-client-ui-subagent');
  const NS = 'dsh-project';
  const zh = {
    diffTruncated: '差异过长，仅显示前一部分；请打开目录查看完整改动。', tab: 'Project', more: '更多', rename: '重命名', cancel: '取消', archiveActive: '停止后台工作并归档', archiveHint: '后台工作会停止，工作目录、对话和成果将保留。', team: '团队', add: '添加 Project…', rowCreate: '在此目录新建 Project', backgroundError: 'Project 出错：{message}', dirMissing: '找不到这个目录。', dirNotDirectory: '这个路径不是文件夹。', dirRoot: '磁盘根目录不能作为 Project 目录，请选择具体的项目文件夹。', dirHome: '用户主目录不能作为 Project 目录，请选择其中具体的项目文件夹。', dirSystemData: '系统配置目录（如 AppData、.config、.ssh）不能作为 Project 目录，请选择你的项目文件夹。', dirAppData: '这是鲸屿自己的数据目录，不能作为 Project 目录，请选择你的项目文件夹。', rowOpen: '打开 Project', heroHint: '以当前目录开启 Project，已输入的内容会一起带过去', heroOpenHint: '打开此目录的 Project，已输入的内容会一起带过去', loading: '正在读取…', close: '关闭', refresh: '刷新',
    requirements: '需求', requirementGoal: '完整目标', requirementConstraints: '约束', requirementConditions: '完成条件', noRequirementConstraints: '未记录约束。', noRequirementConditions: '未记录完成条件。',
    requestRoleDevelopment: '开发', requestRoleReview: '检查', requestRoleDocs: '文档', requestHandover: '等待协调者交付', requestArranging: '正在安排', requestArrangingHint: '协调者正在安排团队开发。', deleted: '已移除', requestDiscussing: '讨论中', requestQueued: '等待开发', requestCancelled: '已取消', requestQueuePosition: '队列第 {position} 项', requestQueueCount: '{count} 项排队', requestEnqueue: '加入开发队列', requestMoveUp: '上移一位', requestMoveDown: '下移一位', requestCancel: '取消需求', requestRejoin: '重新加入队列', requestResume: '继续当前需求', requestResumeQueue: '继续队列', requestRestarted: '应用已重启，等待你继续当前需求', requestQueuePaused: '队列已暂停', requestQueueWaiting: '等待依赖、资源或执行容量', requestQueueReady: '等待协调者安排开发', requestDiscussingHint: '需求仍在讨论，确认后加入开发队列。', requestCancelledHint: '已从开发队列取消，要求和已有成果仍保留。', taskCancelled: '已取消需求', taskCancelledEmpty: '还没有取消的需求。',
    archivedHint: '项目已归档。恢复后可继续对话，旧工作不会自动启动。', archiving: '正在停止后台工作并归档…', queued: '排队中', archived: '已归档',
    directory: 'Project 工作目录', openDirectory: '打开项目目录', materials: '项目资料', progress: '工作进度',
    noWork: '在这里提出需求，后续可以继续同一项工作。', process: '成员记录', viewProcess: '查看记录', viewResult: '查看成果', workDetails: '详情', executionInfo: '执行信息', earlierWork: '更早工作',
    processHint: '需要调整这项工作时，在主对话中继续说明。', noProcess: '暂无记录。', priorWorkFailed: '此前工作失败', priorWorkStopped: '此前工作已停止', priorReportPending: '此前报告待汇总', priorWorkPending: '此前工作尚未完成',
    older: '更早记录', workRequest: '工作要求', earlierRequests: '更早要求', teamMessage: '团队消息',
    newer: '最新记录', previous: '更早一页', next: '更新一页', assistant: '助手', tool: '工具',
    result: '结果', failed: '失败', open: '等待工作', running: '进行中', blocked: '需要处理', done: '已完成',
    provisioning: '正在准备', active: '执行中', idle: '空闲', stopping: '正在停止', paused: '已停止',
    pause: '暂停后台工作', resume: '解除暂停', resumeHint: '在主对话中提出新的要求，即可继续原工作。',
    checklistTitle: '任务清单', checklistProgress: '{done}/{total} 已完成',
    membersWorking: '{count} 个成员工作中', membersWaiting: '{count} 项工作等待中', openTeam: '打开智能体团队',
    memberRecordTitle: '成员工作记录', memberComposerHint: '在这里查看成员的执行过程。安排或调整工作，请回到协调者对话。', backToLead: '回到协调者',
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
    checklistTitle: 'Checklist', checklistProgress: '{done}/{total} done',
    membersWorking: 'Working: {count}', membersWaiting: 'Waiting: {count}', openTeam: 'Open Agent Team',
    memberRecordTitle: 'Member work records', memberComposerHint: 'View this member’s progress here. Return to the coordinator to assign or change work.', backToLead: 'Back to coordinator',
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
  Object.assign(zh, { requestSections: '需求详情', requestProgress: '进度', requestResults: '成果', leadPlan: '协调者计划', stageRail: '执行阶段', stageArranging: '安排', stageExecuting: '执行', stageSummarizing: '汇总', stageDelivered: '交付', sectionMembers: '成员', panelSections: '面板内容', pinObserver: '固定观察', returnFloat: '返回浮窗', closeObserver: '关闭观察', statusUnknown: '状态未知', statusWaiting: '等待中', statusHandover: '等待交付', statusArranging: '正在安排', statusSummarizing: '正在汇总', retryRead: '重新读取', retainedStatus: '连接中断，以下为上次确认的数据。', queueRetry: '重试队列操作', allRequestDetails: '查看完整需求', workPreviewHint: '完整工作记录正在读取…' });
  Object.assign(en, { requestSections: 'Request details', requestProgress: 'Progress', requestResults: 'Results', leadPlan: 'Coordinator plan', stageRail: 'Execution stages', stageArranging: 'Arrange', stageExecuting: 'Execute', stageSummarizing: 'Summarize', stageDelivered: 'Deliver', sectionMembers: 'Members', panelSections: 'Panel sections', pinObserver: 'Keep observing', returnFloat: 'Return to popover', closeObserver: 'Close observer', statusUnknown: 'Unknown', statusWaiting: 'Waiting', statusHandover: 'Awaiting delivery', statusArranging: 'Arranging', statusSummarizing: 'Summarizing', retryRead: 'Reload', retainedStatus: 'Disconnected; showing the last confirmed data.', queueRetry: 'Retry queue action', allRequestDetails: 'View full request', workPreviewHint: 'Loading full work records…' });
  Object.assign(zh, { researchHosts: '研究站点', researchHostsHint: '限制研究成员只能读取这些站点：每行一个域名（如 example.com，同时包含它的子域），用 # 写注释。留空表示不限制。', researchHostsPlaceholder: 'example.com\ndocs.example.org  # 注释' });
  Object.assign(en, { researchHosts: 'Research sites', researchHostsHint: 'Limit research members to these sites: one domain per line (example.com also covers its subdomains), # starts a comment. Leave it empty for no limit.', researchHostsPlaceholder: 'example.com\ndocs.example.org  # comment' });
  Object.assign(zh, { requestRoleResearch: '调研', researchSources: '查阅的来源', searchedPrefix: '搜索：' });
  Object.assign(en, { requestRoleResearch: 'Research', researchSources: 'Sources consulted', searchedPrefix: 'Searched: ' });
  Object.assign(zh, { needsYou: '需要你', groupActive: '进行中', stageAwaitingAnswer: '等你回答', stageAwaitingDecision: '等你决定', askFromMember: '成员在等你回答', askPlaceholder: '输入你的回答', askSend: '回答', askSent: '已回复，协调者处理中…', askIfUnanswered: '不回答时：{text}', askAnswer: '{title}：{answer}',
    blockedRetry: '重试', blockedRetryPrompt: '请重试受阻的需求「{title}」。受阻原因：{reason}。先说明你准备怎么做；如果需要我提供什么，请用 project_ask 问我。', viewResults: '查看成果', statusNeedsYou: '{count} 项等你', statusSummaryRetrying: '汇总遇到临时故障，自动重试中', summaryRetrying: '临时故障，自动重试中（第 {attempt}/{of} 次）' });
  Object.assign(en, { needsYou: 'Needs you', groupActive: 'In progress', stageAwaitingAnswer: 'Waiting for your answer', stageAwaitingDecision: 'Waiting for your decision', askFromMember: 'A member is waiting for your answer', askPlaceholder: 'Type your answer', askSend: 'Answer', askSent: 'Sent; the coordinator is on it…', askIfUnanswered: 'If you don’t answer: {text}', askAnswer: '{title}: {answer}',
    blockedRetry: 'Retry', blockedRetryPrompt: 'Please retry the blocked requirement “{title}”. Reason: {reason}. Say how you plan to proceed; if you need something from me, ask with project_ask.', viewResults: 'View results', statusNeedsYou: '{count} need you', statusSummaryRetrying: 'Temporary failure, retrying the summary', summaryRetrying: 'Temporary failure, retrying automatically (attempt {attempt}/{of})' });
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
    dirUnsafePath: '这个路径包含不受支持的网络共享、设备前缀或特殊尾缀。',
    waitingConflict: '等待写入冲突释放',
    stopAllTitle: '停止全部后台工作？',
    stopAllBody: '所有正在运行或排队中的成员工作都会停止，已保存的成果和对话记录会保留。',
    stopAllConfirm: '确认停止',
    diagnosticsTitle: '项目诊断提示',
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
    dirUnsafePath: 'This path uses an unsupported network share, device prefix, or unsafe segment.',
    waitingConflict: 'Waiting for conflicting write path to clear',
    stopAllTitle: 'Stop all background work?',
    stopAllBody: 'All running and queued member work will stop. Saved results and conversation history are retained.',
    stopAllConfirm: 'Stop all',
    diagnosticsTitle: 'Project diagnostics',
  });
  const CSS = `
    [data-project-rail="true"][data-project-rail-compact="false"]>[data-conversation-content]{margin-right:336px}
    .dsh-project-task-rail{position:absolute;inset:84px 12px 12px auto;width:312px;display:flex;flex-direction:column;min-height:0;z-index:12;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 28px rgb(0 0 0 / .16);color:var(--dsw-alias-label-primary)}
    [data-project-rail-compact="true"] .dsh-project-task-rail{bottom:calc(var(--project-composer-height,180px) + 12px);max-height:65%;width:min(340px,calc(100% - 24px))}
    .dsh-project-rail-heading,.dsh-project-rail-footer,.dsh-project-rail-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;flex:none}
    .dsh-project-rail-heading{font-size:14px;line-height:22px}
    .dsh-project-rail-footer{border-top:1px solid var(--dsw-alias-border-standard)}
    .dsh-project-rail-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 12px 12px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-label-tertiary) transparent}
    .dsh-project-rail-tools{padding:0 0 8px}.dsh-project-rail-tools select{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-standard);border-radius:8px;padding:5px 8px;max-width:70%}
    .dsh-project-rail-card{border:1px solid var(--dsw-alias-border-standard);border-radius:12px;padding:12px;margin-bottom:10px;font-size:13px;line-height:20px;background:var(--dsw-alias-bg-base)}
    .dsh-project-rail-card-title{display:flex;align-items:start;justify-content:space-between;gap:8px;width:100%;text-align:left;background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer}
    .dsh-project-rail-card-title strong{overflow-wrap:anywhere;font-size:14px;line-height:22px;font-weight:600}
    .dsh-project-rail-card-title svg{flex:none;margin-top:4px}
    .dsh-project-rail-status{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);margin:6px 0 10px;font-size:12px;line-height:18px}
    .dsh-project-rail-work{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-top:8px}
    .dsh-project-rail-work p{flex-basis:100%;margin:0;color:var(--dsw-alias-label-secondary)}
    .dsh-project-rail-link{background:none;border:0;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere;flex:1}
    .dsh-project-rail-summary{margin:10px 0 0;overflow-wrap:anywhere}
    .dsh-project-rail-details{margin-top:12px;border-top:1px solid var(--dsw-alias-border-standard);padding-top:10px;overflow-wrap:anywhere}
    .dsh-project-task-rail > .dsh-project-rail-details{margin:0 12px 12px;flex-shrink:0}
    .dsh-project-rail-details p{margin:0 0 10px}.dsh-project-rail-details ul{padding-left:18px}.dsh-project-rail-details .dsh-project-actions{margin-top:12px}
    .dsh-project-rail-empty{padding:18px 4px;color:var(--dsw-alias-label-secondary)}
    .dsh-project-rail-count{display:inline-block;min-width:3ch;text-align:center;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
    .dsh-project-rail-needs-you{margin-left:4px;padding:0 6px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:11px;line-height:18px;font-weight:500}
    .dsh-project-diagnostics{border-left:3px solid var(--dsw-alias-state-warn-primary);padding-left:10px}
    .dsh-project-diagnostics>strong{display:block;margin-bottom:4px;font-size:12px}
    .dsh-project-diagnostics>ul{margin:0;padding-left:16px;font-size:12px;color:var(--dsw-alias-label-secondary)}
    .dsh-project-rail-card button:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:3px;border-radius:4px}

    .dsh-project-hero-option-wrap{display:inline-flex;border-radius:var(--dsw-radius-sm)}
    .dsh-project-hero-option-wrap:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .dsh-project-row-badge{flex:none;margin-left:6px;padding:0 5px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:16px;font-weight:500;white-space:nowrap}
    /* The badge sits against the row's time; a fixed time width keeps every badge in one column ("刚刚" is 20px, "59分钟" 34px). */
    :has(>.dsh-project-row-badge)+span{min-width:36px;text-align:right}
    .dsh-project-heading,.dsh-project-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .dsh-project-heading{justify-content:space-between;gap:4px;flex-wrap:nowrap}
    .dsh-project-list{display:flex;flex-direction:column;gap:2px}
    .dsh-project-header{display:flex;align-items:center;flex:0 0 auto;white-space:nowrap}
    .dsh-project-header-directory{min-width:0;max-width:100%}
    .dsh-project-header-path{min-width:0;max-width:280px;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-return-materials{max-width:min(240px,25vw);min-width:0}
    .dsh-project-return-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-materials-frame{display:flex;flex:1;min-height:0;overflow:hidden}
    .dsh-project-composer-notice{display:flex;flex-direction:column;gap:12px;align-self:center;width:var(--dsh-composer-card-max-width);min-width:0;max-width:calc(100% - 16px);margin:8px auto;box-sizing:border-box;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);corner-shape:round;background:var(--dsw-alias-bg-panel-solid);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}
    .dsh-project-composer-notice-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
    .dsh-project-composer-notice-copy>strong{color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-strong-14)}
    .dsh-project-composer-notice p{margin:0;overflow-wrap:anywhere}
    .dsh-project-composer-notice .dsh-project-actions{gap:8px}
    .dsh-project-composer-notice .dsh-project-actions>button{flex:none;max-width:100%}
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
    .dsh-project-visual-results,.dsh-project-result-files{display:flex;flex-direction:column;gap:12px;min-width:0;padding:8px 0}
    .dsh-project-visual-page{min-width:0;max-width:100%;overflow:hidden}
    .dsh-project-result-checks{padding:8px 0}
    .dsh-project-result-heading{align-items:flex-start;flex-wrap:wrap;line-height:24px}
    .dsh-project-observer-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;font:var(--dsw-font-xxs-strong-12)}.dsh-project-observer-section-heading>span{color:var(--dsw-alias-label-secondary);font-weight:400}
    .dsh-project-ask-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
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
    .dsh-project-stop{width:28px;min-width:28px;height:28px;padding:0;flex:none;position:relative}
    .dsh-project-stop[data-error=true]{color:var(--dsw-alias-state-error-primary)}
    .dsh-project-stop[data-error=true]::after{content:'';position:absolute;right:3px;top:3px;width:4px;height:4px;border-radius:50%;background:currentColor}
    .dsh-project-materials-footer button{min-width:76px}
    [data-composer-seat]:has([data-project-composer-takeover]) [data-chain-overlay-fallback='conversation.composer']{display:block!important;position:absolute;inset:0 0 auto;visibility:hidden;pointer-events:none}
    .dsh-project-composer-frame{display:flex;align-items:center;flex-direction:column;padding:var(--project-composer-top,0px) var(--dsh-composer-side-clearance,16px) var(--project-composer-bottom,32px);min-width:0}
    .dsh-project-composer-frame>.dsh-project-archive-notice{box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;gap:8px;width:var(--project-composer-width,100%);max-width:100%;height:var(--project-composer-height,128px);min-height:0;margin:0;overflow:auto;border-radius:var(--dsw-radius-md);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);padding:12px}
    .dsh-project-composer-frame p{margin:0;font-size:12px;overflow-wrap:anywhere}
    .dsh-project-composer-frame button{flex:none;min-height:28px;align-self:flex-start}
    .dsh-project-materials [data-error=true]{color:var(--dsw-alias-state-error-primary)}
  `;
  const requestId = () => globalThis.crypto.randomUUID();
  const button = (label, onClick, disabled = false) => h(Button, { variant: 'outline', onClick, disabled }, label);
  function OperationToast({ text }) {
    const [dismissed, setDismissed] = useState('');
    useEffect(() => { if (!text) setDismissed(''); }, [text]);
    return text && text !== dismissed ? h(Toast, { text, holdMs: 6000, onDone: () => setDismissed(text) }) : null;
  }
  const markdown = (t, text) => h(MarkdownText, { text, labels: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') } });
  const stateLabel = (t, state) => Object.hasOwn(zh, state) ? t(state) : String(state ?? '');
  const waitingLabel = (t, waiting) => waiting ? `${t({ dependencies: 'waitingDependencies', directory: 'waitingDirectory', capacity: 'waitingCapacity', conflict: 'waitingConflict' }[waiting.kind] ?? 'waitingDirectory')}${waiting.workTitles?.length ? ` · ${waiting.workTitles.join('、')}` : ''}` : '';
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
    const next = records.findIndex((event, at) => at > index && event.type === 'user/message' && (event.data.source?.kind === 'team-message' && event.data.source.senderId === leadId || event.data.source?.kind === 'agent-message' && event.data.source.senderSessionId === leadId));
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
  const DIRECTORY_REFUSALS = { missing: 'dirMissing', 'not-directory': 'dirNotDirectory', root: 'dirRoot', home: 'dirHome', 'system-data': 'dirSystemData', 'app-data': 'dirAppData', 'unsafe-path': 'dirUnsafePath' };
  const isWindowsPath = path => /^[a-zA-Z]:[\\/]/.test(String(path ?? '')) || String(path ?? '').includes('\\');
  const comparablePath = path => {
    const raw = String(path ?? '');
    const normalized = raw.replaceAll('\\', '/').replace(/\/+$/, '');
    return isWindowsPath(raw) ? normalized.toLowerCase() : normalized;
  };
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

  function SummaryFailure({ failure, autoRetry, openModelSettings, t }) {
    const credentials = failure.error.code === 'MISSING_CREDENTIAL';
    return h(Fragment, null,
      h('p', { className: 'dsh-project-error' }, t('summaryFailed')),
      autoRetry ? h('p', { role: 'status', className: 'dsh-project-muted' }, t('summaryRetrying').replace('{attempt}', autoRetry.attempt).replace('{of}', autoRetry.of)) : null,
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
    return h(Modal, { open: true, onClose: close, closeLabel: t('cancel'), className: 'dsh-project-confirm', title: t(unavailable ? 'unavailable' : lifecycle.action === 'rename' ? 'rename' : 'archiveActive'), footer: h('div', { className: 'dsh-project-actions' }, button(t('cancel'), close, busy), unavailable ? null : h(Button, { variant: 'outline', loading: busy, title: error || undefined, 'data-error': Boolean(error), onClick: execute, disabled: busy || lifecycle.action === 'rename' && !title.trim() }, t(lifecycle.action === 'rename' ? 'save' : 'archiveActive'))) },
      unavailable ? h('p', { role: 'alert', className: 'dsh-project-error' }, lifecycle.error || t('unavailable')) : lifecycle.action === 'rename' ? h(Input, { value: title, maxLength: 240, 'aria-label': t('rename'), onChange: event => setTitle(event.target.value) }) : h('p', null, t('archiveHint')),
      h(OperationToast, { text: error }));
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
    const isScratch = Boolean(cwd && scratch && comparablePath(cwd) === comparablePath(scratch));
    const existing = useProjects(value => Boolean(cwd) && value.projects.some(project => project.lifecycle !== 'archived' && comparablePath(project.canonicalWorkingDirectory) === comparablePath(cwd)));
    const refusal = useDirectoryChecks(value => cwd ? value[comparablePath(cwd)]?.reason : undefined);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => { if (available && cwd && !isScratch) checkDirectory(cwd); }, [available, cwd, isScratch]);
    if (!available || !cwd || isScratch) return null;
    const start = async () => { setBusy(true); setError(''); try { await startProject(cwd, openWithDraft); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    const reason = refusal ? t(DIRECTORY_REFUSALS[refusal] ?? 'unavailable') : '';
    const option = h(Button, { variant: 'ghost', size: 'sm', className: 'dsh-project-hero-option', title: reason ? undefined : t(existing ? 'heroOpenHint' : 'heroHint'), 'aria-busy': busy || undefined, 'aria-description': reason || undefined, disabled: busy || Boolean(reason), onClick: () => { void start(); } },
      h(IconChecklistOutlineRegular, { size: 16 }), t('tab'));
    return h(Fragment, null,
      // A disabled button receives no pointer events, so the reason's tooltip anchors on a focusable wrapper.
      reason ? h(Tooltip, { label: reason, side: 'bottom', align: 'end', portal: true, maxWidth: 280 }, h('span', { className: 'dsh-project-hero-option-wrap', tabIndex: 0 }, option)) : option,
      error ? h(Toast, { text: error, holdMs: 6000, onDone: () => setError('') }) : null);
  }

  const projectHeaderState = (project, current, t) => {
    const state = current.loading ? 'loading' : !current.available || current.error ? 'unknown' : project.archiving ? 'stopping' : project.lifecycle === 'archived' ? 'archived' : project.activity?.state ?? 'unknown';
    const keys = { unknown: 'statusUnknown', loading: 'loading', archived: 'statusArchived', stopping: 'statusStopping', blocked: 'statusBlocked', summaryFailed: 'statusBlocked', needsReview: 'statusNeedsReview', paused: 'statusPaused', running: project.activity?.coordinatorRunning && !project.activity?.running ? 'statusArranging' : 'statusActive', provisioning: 'provisioning', queued: 'statusWaiting', pendingSummary: 'statusSummarizing', pendingDelivery: 'statusHandover', done: 'statusDelivered', idle: 'observerIdle' };
    return { state, label: t(keys[state] ?? 'statusUnknown'), tone: ['blocked', 'summaryFailed', 'needsReview', 'paused', 'unknown'].includes(state) ? 'warning' : state === 'done' ? 'success' : ['running', 'pendingSummary', 'pendingDelivery'].includes(state) ? 'info' : 'neutral' };
  };
  function ProjectHeader(props) {
    const { sessionId, useProjects, read, trackActiveProject, t } = props;
    const current = useProjects(value => value);
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    const panel = props.useRequestPanels(value => value[sessionId]);
    const anchor = useRef(null), [host, setHost] = useState(null), [error, setError] = useState(null);
    const open = Boolean(panel?.open);
    useEffect(() => { if (project) return trackActiveProject(project.id); }, [project?.id]);
    useLayoutEffect(() => {
      const root = anchor.current?.closest('[data-dsh-chat]');
      if (!root || !project) return;
      setHost(root);
      const measure = () => { root.dataset.projectRailCompact = String(root.clientWidth < 920); const composer = root.querySelector('[data-composer-seat]'); root.style.setProperty('--project-composer-height', (composer?.getBoundingClientRect().height ?? 180) + 'px'); };
      const observer = new ResizeObserver(measure); observer.observe(root);
      const composer = root.querySelector('[data-composer-seat]'); if (composer) observer.observe(composer);
      measure();
      return () => { observer.disconnect(); delete root.dataset.projectRail; delete root.dataset.projectRailCompact; root.style.removeProperty('--project-composer-height'); };
    }, [project?.id]);
    useLayoutEffect(() => { if (host) host.dataset.projectRail = String(open); }, [host, open]);
    if (!project) return null;
    const count = (project.queue?.activeRequests?.length ?? (project.queue?.active ? 1 : 0)) + (project.queue?.queued?.length ?? 0);
    const headerState = projectHeaderState(project, current, t), unknown = ['unknown', 'loading'].includes(headerState.state);
    const needsYou = !unknown ? (project.activity?.needsYou ?? 0) : 0;
    const diagnostics = Array.isArray(project.diagnostics) ? project.diagnostics.filter(Boolean) : [];
    const close = () => { props.setRequestPanel(sessionId, { open: false }); anchor.current?.focus(); };
    return h('div', { className: 'dsh-project-header', 'data-state': headerState.state, 'data-needs-you': needsYou || undefined },
      h(Button, { variant: 'ghost', size: 'sm', onClick: () => void read(project.id, 'open').catch(failure => setError(before => ({ id: (before?.id ?? 0) + 1, text: t('openDirectory') + ': ' + errorText(failure) }))), title: project.canonicalWorkingDirectory, 'aria-label': t('openDirectory') }, h(IconFolderCloseRegular, { size: 16 })),
      h(Button, { ref: anchor, variant: 'ghost', size: 'sm', title: needsYou ? `${headerState.label} · ${t('statusNeedsYou').replace('{count}', needsYou)}` : headerState.label, 'aria-expanded': open, 'aria-controls': 'project-rail-' + project.id, onClick: () => props.setRequestPanel(sessionId, { open: !open }), className: 'dsh-project-rail-toggle' },
        h(IconChecklistOutlineRegular, { size: 16 }), t('taskList'),
        h('span', { className: 'dsh-project-rail-count' }, unknown ? '?' : count > 99 ? '99+' : count),
        needsYou ? h('span', { className: 'dsh-project-rail-needs-you', 'data-needs-you': needsYou }, t('statusNeedsYou').replace('{count}', needsYou)) : null),
      host && open ? createPortal(h('aside', { id: 'project-rail-' + project.id, className: 'dsh-project-task-rail', 'aria-label': t('taskList'), onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } } },
        h('div', { className: 'dsh-project-rail-heading' }, h('strong', null, t('taskList')), h(Button, { variant: 'ghost', size: 'sm', onClick: close, 'aria-label': t('close') }, h(IconChevronRightOutlineRegular, { size: 16 }))),
        current.error || !current.available ? h('div', { className: 'dsh-project-rail-details', role: 'alert' }, h('p', null, t('retainedStatus')), h('p', null, current.error || t('unavailable')), h(Button, { variant: 'ghost', size: 'sm', onClick: props.refresh }, t('retryRead'))) : null,
        diagnostics.length ? h('div', { className: 'dsh-project-rail-details dsh-project-diagnostics', role: 'alert', 'data-project-diagnostics': diagnostics.length },
          h('strong', null, t('diagnosticsTitle')),
          h('ul', null, diagnostics.map((item, index) => h('li', { key: index }, typeof item === 'string' ? item : item?.message ?? String(item))))) : null,
        h(ProjectRequirements, { ...props, project }),
        h('footer', { className: 'dsh-project-rail-footer' }, h(Button, { variant: 'ghost', size: 'sm', onClick: () => props.showMaterials(project.id) }, t('taskMaterials')), h(ProjectStop, { ...props, compact: false, confirm: true }))), host) : null,
      error ? h(OperationToast, { key: error.id, text: error.text }) : null);
  }

  const requestStateLabel = (t, card, position = true) => card.status === 'completed' ? t('completed')
    : card.queue?.state === 'queued' ? `${t('requestQueued')}${position && card.queue.position ? ` · ${t('requestQueuePosition').replace('{position}', card.queue.position)}` : ''}`
    : card.queue?.state === 'discussing' ? t('requestDiscussing') : card.queue?.state === 'cancelled' ? t('requestCancelled') : stateLabel(t, card.status);
  // Delivered files, the requirement's own changes, revert and its result page, shown on the task card itself.
  function ProjectTaskDelivery({ project, card, controls, read, openResults, t }) {
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirm, setConfirm] = useState(null);
    const delivery = card.delivery, changes = card.changes;
    if (!delivery || !Array.isArray(delivery.artifacts) || !(card.status === 'completed' || delivery.outcome === 'partial')) return null;
    const files = delivery.artifacts, pages = delivery.pages ?? [], diffWork = (card.work ?? []).find(item => item.memberRole && !['readonly', 'research'].includes(item.memberRole));
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
      catch (failure) {
        const isConflict = failure?.code === 'project/revert_conflict';
        setConfirm(isConflict ? { conflict: errorText(failure) } : null);
        if (!isConflict) setMessage(errorText(failure));
      } finally { setBusy(false); }
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

  function RailQuestion({ project, ask, sendUserRequest, t }) {
    const [answer, setAnswer] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('');
    const submitting = useRef(false);
    useEffect(() => { setAnswer(''); setSent(false); setError(''); submitting.current = false; }, [ask.id, ask.question]);
    const send = async text => {
      const value = String(text ?? '').trim();
      if (!value || busy || sent || submitting.current) return;
      submitting.current = true; setBusy(true); setError('');
      try {
        await sendUserRequest(project.id, ask.question + '\n' + value);
        setAnswer(''); setSent(true);
      } catch (failure) { setError(errorText(failure)); }
      finally { submitting.current = false; setBusy(false); }
    };
    return h('div', { className: 'dsh-project-rail-details', 'data-project-ask': ask.id ?? true },
      h('p', null, ask.question),
      sent ? h('p', { role: 'status', className: 'dsh-project-ask-note' }, t('askSent')) : h(Fragment, null,
        ask.options?.length ? h('div', { className: 'dsh-project-actions' }, ask.options.map(option => h(Button, { key: option, variant: 'outline', size: 'sm', disabled: busy, onClick: () => { void send(option); } }, option))) : null,
        h('form', { onSubmit: event => { event.preventDefault(); void send(answer); } },
          h(Input, { 'aria-label': ask.question, value: answer, onChange: event => setAnswer(event.target.value), disabled: busy }),
          h(Button, { type: 'submit', variant: 'ghost', size: 'sm', disabled: busy || !answer.trim() }, t('askSend'))),
        ask.ifUnanswered ? h('p', { className: 'dsh-project-ask-note' }, t('askIfUnanswered').replace('{text}', ask.ifUnanswered)) : null),
      error ? h('p', { role: 'alert' }, error) : null);
  }
  function RailFailure({ project, card, work, read, sendUserRequest, openModelSettings, t }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const failure = work?.summaryFailure;
    const retry = async () => {
      setBusy(true); setError('');
      try {
        let context;
        if (work) {
          const { workstream } = await read(project.id, 'workstreams/get', { workstreamId: work.id });
          if (workstream.request?.authorityError) throw new Error(t('authorityErrorHint'));
          const fresh = workstream.summaryFailure, report = workstream.latestReport;
          const terminal = workstream.recentSettlements?.find(item => item.runId === fresh?.runId && item.delegationRefs.includes(fresh.delegationRef));
          if (fresh?.delegationRef !== failure.delegationRef || !(report?.delegationRef === fresh.delegationRef || terminal)) throw new Error(t('resultUpdated'));
          context = workstream.title + ' · ' + new Date((report ?? terminal).at).toISOString();
        } else {
          const fresh = await read(project.id, 'detail');
          const current = fresh.project.currentRequests?.find(item => item.id === card.id && item.revision === card.revision && item.handoverError === card.handoverError);
          if (!current) throw new Error(t('resultUpdated'));
          if (current.authorityError) throw new Error(t('authorityErrorHint'));
          context = requestLabel(t, current) + '\n' + current.goal;
        }
        await sendUserRequest(project.id, t('retrySummaryPrompt') + '\n' + context);
      } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
    };
    return h('div', { className: 'dsh-project-rail-details' },
      failure ? h(SummaryFailure, { failure, autoRetry: work.autoRetry, openModelSettings, t }) : h(Fragment, null, h('p', null, t('handoverErrorHint')), h('details', null, h('summary', null, t('errorDetails')), h('pre', null, card.handoverError))),
      h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: retry }, t('retrySummary')),
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }
  function RailCard(props) {
    const { card, project, t } = props, [expanded, setExpanded] = useState(Boolean(props.expandedCards?.[card.id])), [full, setFull] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => { let live = true; if (expanded) void props.read(project.id, 'requests/get', { requestId: card.id }).then(value => { if (live) { setFull(value); setError(''); } }, failure => { if (live) setError(errorText(failure)); }); return () => { live = false; }; }, [expanded, card.updatedAt, card.status]);
    const action = async name => { setBusy(true); setError(''); try { await props.command(project.id, 'requests/queue', { requestId: card.id, requestRevision: card.revision, action: name }); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    const current = full?.card ?? full?.request ?? full ?? card, work = expanded && full ? current.work ?? card.workPreview ?? [] : card.workPreview ?? [];
    const toggle = () => { setExpanded(value => !value); props.rememberExpanded?.(card.id, !expanded); };
    const allWork = current.work ?? work;
    const diffWork = allWork.find(item => item.memberRole && !['readonly', 'research'].includes(item.memberRole));
    const hasRequestDiff = Boolean(current.changes?.isGit && current.changes.fileCount !== undefined);
    const deliveryRendered = Boolean(current.delivery && Array.isArray(current.delivery.artifacts)
      && (current.status === 'completed' || current.delivery.outcome === 'partial')
      && (current.delivery.artifacts.length || current.delivery.pages?.length || diffWork || hasRequestDiff));
    const showFooterDiff = !deliveryRendered && (Boolean(current.changes?.isGit) || (current.changes?.isGit !== false && Boolean(diffWork)));
    const canResume = card.status !== 'completed' && !card.queue?.released && (project.paused || card.queue?.suspended || card.status === 'paused') && ['active', 'queued'].includes(card.queue?.state);
    return h('article', { className: 'dsh-project-rail-card', 'data-project-request': card.id },
      h('button', { type: 'button', className: 'dsh-project-rail-card-title', 'aria-expanded': expanded, onClick: toggle }, h('strong', null, card.title), h(IconChevronDownOutlineRegular, { size: 14, style: { transform: expanded ? 'rotate(180deg)' : undefined } })),
      h('div', { className: 'dsh-project-rail-status', 'data-status': card.status }, h(StateDot, { tone: ['blocked', 'failed', 'summaryFailed'].includes(card.status) ? 'warning' : card.status === 'completed' ? 'success' : 'neutral' }), requestStateLabel(t, card)),
      work.map(item => h('div', { className: 'dsh-project-rail-work', key: item.workstreamId }, h('button', { type: 'button', className: 'dsh-project-rail-link', disabled: !item.workerSessionId, onClick: () => props.openMember(project, item.workerSessionId, item.parentSessionId) }, item.title), h('span', { className: 'dsh-project-muted' }, stateLabel(t, item.status)), ['running','queued','preparing','stopping'].includes(item.status) ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy || item.status === 'stopping', onClick: async () => { setBusy(true); setError(''); try { await props.command(project.id, 'stop', { workstreamId: item.workstreamId }); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } } }, t('stopWork')) : null, item.waitingReason || item.blockedReason ? h('p', null, item.waitingReason ? waitingLabel(t, item.waitingReason) : workBlockedLabel(t, item.blockedReason)) : null)),
      card.delivery?.summaryPreview ? h('p', { className: 'dsh-project-rail-summary' }, card.delivery.summaryPreview) : null,
      card.stage?.ask ? h(RailQuestion, { ...props, ask: card.stage.ask }) : null,
      current.authorityError ? h('p', { role: 'alert', className: 'dsh-project-rail-details' }, t('authorityErrorHint')) : current.handoverError ? h(RailFailure, { ...props, card: current }) : null,
      work.filter(item => item.status === 'summaryFailed' && !current.authorityError).map(item => {
        const stream = props.workstreams?.find(row => row.id === item.workstreamId);
        const failureWork = stream?.summaryFailure ? stream : item.summaryFailure ? { id: item.workstreamId, summaryFailure: item.summaryFailure, autoRetry: item.autoRetry } : null;
        return failureWork ? h(RailFailure, { ...props, key: item.workstreamId, work: failureWork }) : null;
      }),
      expanded ? h('div', { className: 'dsh-project-rail-details' }, full ? h(Fragment, null,
        h('p', null, current.goal),
        h(ProjectTaskDelivery, { project, card: current, read: props.read, openResults: () => props.showMaterials(project.id), controls: { busy, revert: card => props.command(project.id, 'requests/revert', { requestId: card.id, requestRevision: card.revision }), ask: text => props.sendUserRequest(project.id, text), showRequestDiff: requestId => props.showRequestDiff(project.id, requestId), showDiff: props.showDiff }, t }),
        h(ProjectVisualResults, { pages: current.delivery?.pages, renderFactorySlot: props.renderFactorySlot, t }),
        current.delivery ? h('section', null, h('strong', null, t('viewResult')), h('p', null, current.delivery.summary), current.delivery.evidence?.map((text, index) => h('p', { key: index }, text)), current.delivery.remainingIssues?.map((text, index) => h('p', { key: index }, text))) : null,
        current.constraints?.length ? h('ul', null, current.constraints.map((text, index) => h('li', { key: index }, text))) : null,
        current.versions?.length > 1 ? h('details', null, h('summary', null, t('requestVersion')), current.versions.map(version => h('section', { key: version.revision }, h('strong', null, version.title), h('p', null, version.goal), h('ul', null, [...(version.constraints ?? []), ...(version.conditions ?? [])].map((text, index) => h('li', { key: index }, text)))))) : null,
        current.conditions?.length ? h('details', null, h('summary', null, t('requirementConditions')), h('ul', null, current.conditions.map((text, index) => h('li', { key: index }, text)))) : null,
        (current.work ?? current.requiredWork ?? []).map(item => item.reportId ? h(Button, { key: item.workstreamId + item.delegationRef, variant: 'ghost', size: 'sm', 'aria-label': t('viewResult'), onClick: () => props.showReport(project.id, item.workstreamId, { delegationRef: item.delegationRef }) }, item.title ?? t('viewResult')) : null)) : h('p', { role: 'status' }, t('loading')),
        h('div', { className: 'dsh-project-actions' },
          ['discussing', 'cancelled'].includes(card.queue?.state) ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => action('enqueue') }, t('requestEnqueue')) : null,
          canResume ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => action('resume') }, t('requestResume')) : null,
          !['completed', 'cancelled'].includes(card.status) ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => action('cancel') }, t('requestCancel')) : null,
          (card.status === 'completed' || card.archivedAt) && project.lifecycle === 'ready' && !project.archiving ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: async () => { setBusy(true); setError(''); try { await props.command(project.id, card.archivedAt ? 'requests/restore' : 'requests/archive', { requestId: card.id }); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } } }, t(card.archivedAt ? 'taskRestoreAction' : 'taskArchiveAction')) : null,
          showFooterDiff ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => current.changes?.isGit ? props.showRequestDiff(project.id, card.id) : props.showDiff(project.id, diffWork.workstreamId) }, t('viewChanges')) : null)) : null,
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  // One quiet list over existing goal records; history and evidence remain available on demand.
  function ProjectRequirements(props) {
    const { project, sessionId, t } = props, detail = props.useProjects(value => value.details[project.id]);
    const saved = props.useRequestPanels(value => value[sessionId]?.rail), [history, setHistory] = useState(saved?.history ?? 'current'), [page, setPage] = useState({ items: [] }), [cursor, setCursor] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [expandedCards, setExpandedCards] = useState(saved?.expandedCards ?? {});
    const list = useRef(null), order = useRef([]), retained = useRef(new Map()), firstPageIds = useRef(new Set()), group = useRef(history), position = useRef(saved?.scrollTop ?? 0), resetOnHome = useRef(false);
    useEffect(() => {
      let live = true; setLoading(true);
      if (group.current !== history || resetOnHome.current) {
        retained.current.clear(); order.current = []; firstPageIds.current.clear();
        group.current = history; resetOnHome.current = false;
      }
      void (async () => {
        const value = await props.read(project.id, 'requests/list', { kind: history, ...(cursor ? { cursor } : {}) });
        if (!live) return;
        let updates = [];
        if (!cursor) {
          // A completed card from the first page stays at its reading position until the user changes
          // the group, returns to page 1, or closes the rail. Never fan out requests/get for older pages.
          const present = new Set(value.items.map(item => item.id));
          const missing = [...firstPageIds.current].filter(id => retained.current.has(id) && !present.has(id));
          if (missing.length) {
            updates = await Promise.all(missing.map(requestId => props.read(project.id, 'requests/get', { requestId })));
            if (!live) return;
          }
          for (const item of value.items) firstPageIds.current.add(item.id);
        }
        for (const item of [...value.items, ...updates.map(item => item.card)]) {
          if (!order.current.includes(item.id)) order.current.push(item.id);
          retained.current.set(item.id, item);
        }
        setPage({ ...value, items: [...retained.current.values()] }); setError('');
      })().catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setLoading(false); });
      return () => { live = false; };
    }, [project.id, detail?.revision, project.updatedAt, history, cursor, refresh]);
    useLayoutEffect(() => { if (list.current) list.current.scrollTop = position.current; }, [Boolean(page.items.length)]);
    useEffect(() => { props.setRequestPanel(sessionId, { rail: { history, expandedCards, scrollTop: position.current } }); }, [history, expandedCards, sessionId]);
    const cards = [...page.items].sort((a, b) => order.current.indexOf(a.id) - order.current.indexOf(b.id));
    const returnHome = () => {
      retained.current.clear(); order.current = []; firstPageIds.current.clear();
      position.current = 0; resetOnHome.current = true;
      if (list.current) list.current.scrollTop = 0;
      setCursor(null);
    };
    return h('div', { className: 'dsh-project-rail-body', ref: list, onScroll: event => { position.current = event.currentTarget.scrollTop; props.setRequestPanel(sessionId, { rail: { history, expandedCards, scrollTop: position.current } }); } },
      h('div', { className: 'dsh-project-rail-tools' }, h('select', { 'aria-label': t('taskList'), value: history, onChange: event => { setHistory(event.target.value); setCursor(null); order.current = []; retained.current.clear(); firstPageIds.current.clear(); position.current = 0; } }, ['current', 'completed', 'cancelled', 'archived'].map(kind => h('option', { value: kind, key: kind }, t({ current: 'groupActive', completed: 'taskCompleted', cancelled: 'taskCancelled', archived: 'taskArchive' }[kind])))), h(Button, { variant: 'ghost', size: 'sm', onClick: () => setRefresh(value => value + 1) }, t('refresh'))),
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
      loading && !cards.length ? h('p', { role: 'status' }, t('loading')) : null,
      !loading && !error && !cards.length ? h('div', { className: 'dsh-project-rail-empty' }, h('strong', null, t('taskEmptyTitle')), h('p', null, t('taskEmpty'))) : null,
      cards.map(card => h(RailCard, { ...props, workstreams: detail?.workstreams, card, key: card.id, expandedCards, rememberExpanded: (id, value) => setExpandedCards(before => ({ ...before, [id]: value })) })),
      page.nextCursor ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => setCursor(page.nextCursor) }, t('more')) : null,
      cursor ? h(Button, { variant: 'ghost', size: 'sm', onClick: returnHome }, t('taskBack')) : null);
  }

  function ProjectComposerFrame({ children, label }) {
    const rootRef = useRef(null);
    useLayoutEffect(() => {
      const root = rootRef.current, seat = root?.closest('[data-composer-seat]');
      const card = seat?.querySelector('[data-chain-overlay-fallback="conversation.composer"] [data-composer-card]');
      if (!root || !card) return;
      const frame = card.closest('[data-chain-overlay-fallback="conversation.composer"]');
      const layoutTop = element => { let top = 0; for (let node = element; node; node = node.offsetParent) top += node.offsetTop; return top; };
      const measure = () => {
        const box = card.getBoundingClientRect();
        root.style.setProperty('--project-composer-width', `${box.width}px`);
        root.style.setProperty('--project-composer-height', `${box.height}px`);
        if (frame) {
          const top = layoutTop(card) - layoutTop(frame);
          root.style.setProperty('--project-composer-top', `${top}px`);
          root.style.setProperty('--project-composer-bottom', `${frame.offsetHeight - card.offsetHeight - top}px`);
        }
      };
      const observer = new ResizeObserver(measure); observer.observe(card); if (frame) observer.observe(frame); measure();
      return () => observer.disconnect();
    }, []);
    return h('div', { ref: rootRef, className: 'dsh-project-composer-frame', 'data-project-composer-takeover': true }, h('div', { className: 'dsh-project-archive-notice dsh-project-composer-notice', role: 'note', 'aria-label': label }, children));
  }

  // A member's conversation is read for its progress; work reaches it through the Lead.
  function ProjectMemberComposer({ matched, useProjects, read, command, openLead, t }) {
    const project = useProjects(value => value.projects.find(item => item.id === matched.projectId));
    const cachedWorker = useProjects(value => value.details[matched.projectId]?.workers?.find(item => item.sessionId === matched.workerSessionId));
    const [fetchedWorker, setFetchedWorker] = useState(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => {
      if (cachedWorker || !matched.projectId || !matched.workerSessionId || typeof read !== 'function') { setFetchedWorker(null); return; }
      let live = true;
      void read(matched.projectId, 'workstreams/get', { workerSessionId: matched.workerSessionId })
        .then(value => { if (live) setFetchedWorker(value?.worker ?? null); })
        .catch(() => { /* keep member notice usable even if workstream detail is unavailable */ });
      return () => { live = false; };
    }, [matched.projectId, matched.workerSessionId, Boolean(cachedWorker)]);
    const worker = cachedWorker ?? fetchedWorker;
    const stop = async () => { setBusy(true); setError(''); try { await command(matched.projectId, 'stop', { workstreamId: worker.workstreamId }); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    const back = event => { try { openLead(project.coordinatorSessionId, event.currentTarget); } catch (failure) { setError(errorText(failure)); } };
    return h(ProjectComposerFrame, { label: t('memberRecordTitle') },
      h('div', { className: 'dsh-project-composer-notice-copy' }, h('strong', null, t('memberRecordTitle')), h('p', null, t('memberComposerHint'))),
      h('div', { className: 'dsh-project-actions' }, project ? h(Button, { variant: 'outline', size: 'sm', shape: 'pill', onClick: back }, t('backToLead')) : null,
        worker && !worker.stopped && isLive(worker) && project?.lifecycle === 'ready' ? h(Button, { variant: 'ghost', size: 'sm', shape: 'pill', loading: busy, disabled: busy || worker.phase === 'stopping', 'aria-busy': busy || worker.phase === 'stopping', onClick: stop }, t('stopWork')) : null),
      error ? h(OperationToast, { text: error }) : null);
  }

  function ProjectArchiveComposer({ matched, useProjects, command, t }) {
    const project = useProjects(value => value.projects.find(item => item.id === matched.projectId));
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const restore = async () => { setBusy(true); setError(''); try { await command(project.id, 'restore'); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    return h(ProjectComposerFrame, { label: t(project?.archiving ? 'archiving' : 'archived') },
      h('p', null, t(project?.archiving ? 'archiving' : 'archivedHint')),
      h('div', { className: 'dsh-project-actions' }, h(Button, { variant: 'outline', size: 'sm', shape: 'pill', loading: busy, disabled: busy || project?.lifecycle !== 'archived', onClick: restore }, t('restore'))),
      error ? h(OperationToast, { text: error }) : null);
  }

  function RequestAuthority({ request, className = 'dsh-project-work', t }) {
    return h('div', { className, 'data-request-recovery-id': request.id },
      h('strong', null, requestLabel(t, request)), h('p', { className: 'dsh-project-error' }, t('authorityErrorHint')),
      h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('workRequest')), markdown(t, request.goal)),
      h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, request.authorityError)));
  }

  function ProjectStop({ sessionId, useProjects, command, t, compact = true, confirm = false }) {
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmOpen, setConfirmOpen] = useState(false);
    if (!project || project.lifecycle !== 'ready' || project.archiving) return null;
    const active = Boolean(project.activity?.running || project.activity?.queued || project.activity?.provisioning || project.activity?.coordinatorRunning || project.activity?.state === 'stopping');
    const stop = async () => {
      setBusy(true); setError('');
      try { await command(project.id, 'stop'); setConfirmOpen(false); }
      catch (failure) { setError(errorText(failure)); setConfirmOpen(false); }
      finally { setBusy(false); }
    };
    const trigger = () => { if (confirm) setConfirmOpen(true); else void stop(); };
    return h(Fragment, null,
      h(Button, { variant: 'ghost', size: 'sm', className: compact ? 'dsh-project-stop' : undefined, loading: busy, 'data-error': Boolean(error), 'aria-label': t('stop'), title: error || t('stop'), disabled: busy || !active && !error || project.activity?.state === 'stopping', onClick: trigger }, compact ? h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true }, h('rect', { x: 3, y: 3, width: 10, height: 10, rx: 2, fill: 'currentColor' })) : t('stop')),
      confirmOpen ? h(Modal, { open: true, onClose: () => { if (!busy) setConfirmOpen(false); }, closeLabel: t('cancel'), className: 'dsh-project-confirm', title: t('stopAllTitle'),
        footer: h('div', { className: 'dsh-project-actions' }, button(t('cancel'), () => setConfirmOpen(false), busy), h(Button, { variant: 'primary', loading: busy, disabled: busy, onClick: () => { void stop(); } }, t('stopAllConfirm'))) },
        h('p', null, t('stopAllBody'))) : null,
      error ? h(OperationToast, { text: error }) : null);
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
      // What a research member opened and searched, as the host recorded it while the calls were made.
      report.sources?.length ? h('details', { className: 'dsh-project-result-disclosure', 'data-project-sources': report.sources.length }, h('summary', null, `${t('researchSources')} · ${report.sources.length}`),
        h('ul', null, report.sources.map((item, index) => h('li', { key: index }, item.kind === 'search' ? `${t('searchedPrefix')}${item.text}` : item.text)))) : null,
      h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('reportDetails')),
        h('div', { className: 'dsh-project-result-details' }, markdown(t, report.summary),
          report.evidence?.length > 2 ? h('details', null, h('summary', null, t('evidence')), h('ul', null, report.evidence.map((item, index) => h('li', { key: index }, item)))) : null)),
      showProcess ? h('div', { className: 'dsh-project-work-detail-actions' }, h(Button, { variant: 'ghost', size: 'sm', onClick: () => showProcess(projectId, workstreamId, false, { delegationRef: report.delegationRef, reportAt: report.at, request }) }, t('viewProcess'))) : null,
      h(OperationToast, { text: error || notice }));
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
      h(OperationToast, { text: error || notice }));
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
    const editable = path === 'notes.md' || path === 'preferences.md' || path === 'charter.md' || path === 'research-hosts.txt';
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
    const tabs = ['docs', 'charter.md', 'preferences.md', 'research-hosts.txt', 'notes.md'].map(file => ({ value: file, label: t({ docs: 'workResults', 'charter.md': 'charter', 'preferences.md': 'preferences', 'research-hosts.txt': 'researchHosts', 'notes.md': 'notes' }[file]), id: `${projectId}-material-tab-${file}`, panelId: `${projectId}-material-panel-${file}` }));
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
        path === 'charter.md' ? h('div', { className: 'dsh-project-charter-intro' }, h('strong', null, t('charter')), h('p', null, t('charterHint'))) : h('p', { className: 'dsh-project-muted' }, t({ 'notes.md': 'notesHint', 'research-hosts.txt': 'researchHostsHint' }[path] ?? 'preferencesHint')),
        path === 'charter.md' && !readonly ? h('div', { className: 'dsh-project-charter-examples' }, h('span', null, t('charterExamples')),
          charterLines.map(item => h(Pill, { key: item.key, active: hasRule(item.line), 'aria-pressed': hasRule(item.line), disabled: pending, title: item.line.replace(/^-\s*/, ''), onClick: () => toggleRule(item.line) }, item.label))) : null,
        h('textarea', { className: 'dsh-project-editor', value: text, placeholder: path === 'charter.md' ? t('charterPlaceholder') : path === 'research-hosts.txt' ? t('researchHostsPlaceholder') : undefined, disabled: pending, readOnly: readonly, 'aria-label': t(path === 'notes.md' ? 'userNotes' : path === 'charter.md' ? 'charter' : path === 'research-hosts.txt' ? 'researchHosts' : 'preferences'), onChange: event => { setText(event.target.value); setNotice(''); } }),
        path === 'charter.md' ? h('div', { className: 'dsh-project-charter-meter', 'data-over': tooLong },
          h('div', { className: 'dsh-project-charter-meter-track', 'aria-hidden': true }, h('span', { style: { width: `${Math.min(100, textBytes / charterLimit * 100)}%` } })),
          h('span', { role: tooLong ? 'alert' : undefined }, tooLong ? t('charterTooLong') : t('charterUsage').replace('{used}', (textBytes / 1000).toFixed(1)).replace('{limit}', String(charterLimit / 1000))))
          : tooLong ? h('p', { role: 'alert', className: 'dsh-project-error' }, t('textTooLong')) : null,
        path === 'notes.md' ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('generatedNotes')), markdown(t, generatedText)) : null,
        path === 'notes.md' ? h('details', { className: 'dsh-project-result-disclosure', 'data-decision-log': true }, h('summary', null, t('decisionLog')),
          decisionText.replace(/^# .*\n+/, '').trim() ? markdown(t, decisionText.replace(/^# .*\n+/, '').replace(/<!-- decision:[^>]* -->\n?/g, '')) : h('p', { className: 'dsh-project-muted' }, t('decisionLogEmpty'))) : null) : null,
      pending ? h('p', { role: 'status' }, t('loading')) : null,
      h(OperationToast, { text: error ? `${t(editable && dirty ? 'saveFailed' : 'materialsError')} ${error}` : '' })),
      editable ? h('div', { className: 'dsh-project-materials-footer' }, readonly ? h('p', { className: 'dsh-project-muted' }, t('archivedMaterials')) :
        h(Button, { variant: 'primary', loading: busy, feedback: notice || undefined, title: error || undefined, 'data-error': Boolean(error), onClick: save, disabled: pending || loadedPath !== path || !dirty || tooLong }, t('save'))) : null),
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
            setPageStart(boundary); setPageEnd(Math.min(assignmentPageEnd(items, target, work.parentSessionId ?? project.coordinatorSessionId), boundary + 50)); setLocatedRef(delegation.ref); return;
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
    const selfKey = comparablePath(directory);
    const fold = isWindowsPath(directory);
    const peers = directories.filter(other => comparablePath(other) !== selfKey).map(other => directoryParts({ canonicalWorkingDirectory: other }));
    for (let count = 1; count < parts.length; count++) {
      const label = parts.slice(-count).join('/');
      const target = fold ? label.toLowerCase() : label;
      if (peers.every(other => {
        const candidate = other.slice(-count).join('/');
        return (fold ? candidate.toLowerCase() : candidate) !== target;
      })) return `…/${label}`;
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
      value.isGit === false ? h('p', { className: 'dsh-project-muted' }, t('notGit')) : h(DiffView, { files, truncated: value.truncated, t }));
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
      const snapshot = createSnapshotStore({ projects: [], details: {}, available: false, loading: true, error: '' });
      const requestPanels = createSnapshotStore({});
      const setRequestPanel = (sessionId, next) => requestPanels.set({ ...requestPanels.getSnapshot(), [sessionId]: { ...requestPanels.getSnapshot()[sessionId], ...next } });
      let sidebar;
      ctx.inject(['sidebarRight'], scope => {
        sidebar = scope.sidebarRight;
        scope.effect(() => () => { sidebar = undefined; }, 'dsh-project: Sidebar');
      });
      const collapseEmptyObserver = sessionId => {
        if (sidebar?.mounted.getSnapshot() === sessionId && sidebar.isExpanded()
          && !sidebar.openTabs.getSnapshot().some(tab => tab.sessionId === sessionId && tab.kind !== 'guide')) sidebar.toggleExpanded();
      };
      const openLead = (sessionId, origin) => {
        const target = sidebar?.focusedTarget(origin);
        const fullscreen = origin.closest('[data-sidebar-right-panel="fullscreen"]') !== null;
        // Commit the destination before restoring its editor's retained caret.
        flushSync(() => {
          if (target?.sessionId === sessionId) {
            sidebar.closeTarget(target);
          }
          ctx.uiSidebar.selectTab('sessions');
          ctx.uiWorkspace.openSession(sessionId);
        });
        // The destination may restore its own fullscreen Sidebar when leaving a main member.
        const coveringSidebar = fullscreen || [...document.querySelectorAll('[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]')].some(panel => panel.dataset.sidebarRightSession === sessionId);
        if (coveringSidebar && sidebar?.isExpanded()) flushSync(() => sidebar.toggleExpanded());
        else flushSync(() => collapseEmptyObserver(sessionId));
        const scope = ctx.sessions.scope(sessionId);
        if (!scope) throw new Error(t('unavailable'));
        ctx.conversation.input.for(scope).focus();
      };
      // A member's live conversation opens beside the Lead instead of replacing it.
      const openMember = (project, workerSessionId, parentSessionId = project.coordinatorSessionId) => sidebar?.openResource(subagentChatAddress({
        parentSessionId, childSessionId: workerSessionId, mode: 'continuable' }), { kind: 'subagentchat' });
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
            snapshot.set({ ...previous, projects: result.available === true ? result.projects : previous.projects, available: result.available === true, loading: false, error: result.error ?? '' });
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
      const resolveMemberProject = owner => {
        const state = snapshot.getSnapshot();
        for (const project of state.projects) {
          const workers = state.details[project.id]?.workers;
          if (workers?.some(worker => worker.sessionId === owner.sessionId)) {
            return { projectId: project.id, workerSessionId: owner.sessionId };
          }
        }
        const byId = ctx.sessions.list.getSnapshot()?.byId ?? {};
        const parentOf = id => {
          const info = byId[id];
          return info?.parentSessionId ?? info?.subagent?.address?.parentSessionId ?? null;
        };
        const visited = new Set([owner.sessionId]);
        let current = owner.session?.subagent?.address?.parentSessionId ?? parentOf(owner.sessionId);
        while (current && !visited.has(current)) {
          visited.add(current);
          const direct = state.projects.find(item => item.coordinatorSessionId === current);
          if (direct) return { projectId: direct.id, workerSessionId: owner.sessionId };
          for (const project of state.projects) {
            const workers = state.details[project.id]?.workers;
            if (workers?.some(worker => worker.sessionId === current)) {
              return { projectId: project.id, workerSessionId: owner.sessionId };
            }
          }
          current = parentOf(current);
        }
        return null;
      };
      const face = () => ({ startProject, checkDirectory, hooks: { directoryChecks, projects: snapshot, projectSessions: ctx.sessions.list, workspaceList: ctx.workspaces.list, projectSessionStatus: ctx.uiSession.sessionStatus, projectView: viewInstance, requestPanels }, read, command, refresh, openProject, openLifecycle, readDetail, sendUserRequest, getFileReturn: () => fileReturn, openMember,
        setRequestPanel, collapseEmptyObserver,
        trackActiveProject: projectId => { trackedProject = projectId; return () => { if (trackedProject === projectId) trackedProject = undefined; }; },
        openModelSettings: () => ctx.settingsNavigation.open('models'),
        showMaterials: (projectId, workstreamId, context) => { const view = viewInstance.getSnapshot(); if (!workstreamId && view.materialsPreview && view.modal?.projectId === projectId) viewInstance.actions.returnMaterials(projectId); else show('materials', projectId, workstreamId, context); }, showProcess: (projectId, workstreamId, member = false, context = {}) => { viewInstance.actions.setModal({ kind: 'process', projectId, ...(member ? { workerSessionId: workstreamId } : { workstreamId }), ...context }); }, showDiff: (projectId, workstreamId) => show('diff', projectId, workstreamId),
        showReport: (projectId, workstreamId, context) => show('report', projectId, workstreamId, context), showRequestDiff: (projectId, requestId) => show('requestDiff', projectId, undefined, { requestId }),
        trackProject: projectId => { trackedProject = projectId; return () => { if (trackedProject === projectId) trackedProject = undefined; }; },
        retainProcess: (project, work) => ctx.sessions.retain({ parentSessionId: work.parentSessionId ?? project.coordinatorSessionId, childSessionId: work.workerSessionId, mode: 'continuable' }, { source: 'projectPreview' }),
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
      ctx.slots.inject('conversation.composer', () => ctx.slots.register({ name: 'conversation.composer', id: NS + '-member', priority: 90, locale: NS,
        inject: () => ({ ...face(), openLead }),
        select: resolveMemberProject }, ProjectMemberComposer));
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: NS, order: -20, locale: NS, inject: face }, ProjectHeader));
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
