window.__ModuleLoader__.load({ id: 'dsh-project', factory: (require) => {
  const { createElement: h, useState, useEffect, useLayoutEffect, useRef, useCallback, Fragment } = require('react');
  const { createPortal } = require('react-dom');
  const { Button, Input, Menu, Modal, Pill, SegmentedTabs, MarkdownText, Toast, IconFolderCloseRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
  const { createSnapshotStore, defineStore } = require('@deepseek-ai/dsh-client-store');
  const { teamEnglish, teamChinese } = require('@deepseek-ai/dsh-experimental-client-ui-agent-team');
  const NS = 'dsh-project';
  const zh = {
    diffTruncated: '差异过长，仅显示前一部分；请打开目录查看完整改动。', tab: 'Project', more: '更多', rename: '重命名', cancel: '取消', archiveActive: '停止后台工作并归档', archiveHint: '后台工作会停止，工作目录、对话和成果将保留。', team: '团队', add: '添加 Project…', loading: '正在读取…', close: '关闭', refresh: '刷新',
    archivedHint: '项目已归档。恢复后可继续对话，旧工作不会自动启动。', archiving: '正在停止后台工作并归档…', queued: '排队中', empty: '从新建对话的工作目录菜单添加 Project。', archived: '已归档', history: '显示归档项目',
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
    noDiff: '当前没有文件差异。', branch: '分支', readonly: '查看项目文件，不修改文件', docsScope: '修改已授权的文档', developmentScope: '执行已授权的开发工作', worktree: '独立分支', existing: '项目目录',
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
  };
  const en = {
    diffTruncated: 'The diff is truncated. Open the directory for the complete changes.', tab: 'Project', more: 'More', rename: 'Rename', cancel: 'Cancel', archiveActive: 'Stop work and archive', archiveHint: 'Background work will stop. Files, conversation and results are retained.', team: 'Team', add: 'Add Project…', loading: 'Loading…', close: 'Close', refresh: 'Refresh',
    archivedHint: 'This Project is archived. Restore it to continue; previous work will not restart automatically.', archiving: 'Stopping work and archiving…', queued: 'Queued', empty: 'Add a Project from the working-directory menu in New Conversation.', archived: 'Archived', history: 'Show archived projects',
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
    noDiff: 'There are no current file changes.', branch: 'Branch', readonly: 'Inspect Project files without modifying them', docsScope: 'Edit authorized documents', developmentScope: 'Perform authorized development', worktree: 'Independent branch', existing: 'Project directory',
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
  };
  const CSS = `
    .dsh-project-page{padding:12px 0 8px;display:flex;flex-direction:column;gap:4px;min-width:0}
    .dsh-project-row-wrap{display:flex;align-items:center;min-width:0}.dsh-project-row-wrap>.dsh-project-row{flex:1}.dsh-project-category{flex:1;min-width:0;display:flex;align-items:center;gap:4px;height:36px;padding:0 8px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
    .dsh-project-category:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dsh-project-category span{flex:1}.dsh-project-category-count{font-size:12px;font-weight:400}
    .dsh-project-heading,.dsh-project-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .dsh-project-heading{justify-content:space-between}.dsh-project-list{display:flex;flex-direction:column;gap:4px}
    .dsh-project-header{display:flex;align-items:center;flex:0 0 auto;white-space:nowrap}
    .dsh-project-header-directory{min-width:0;max-width:100%}.dsh-project-header-label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;flex:0 0 auto}
    .dsh-project-header-path{min-width:0;max-width:280px;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-return-materials{max-width:min(240px,25vw);min-width:0}.dsh-project-return-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-project-materials-frame{display:flex;flex:1;min-height:0;overflow:hidden}
    .dsh-project-row{border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);padding:10px;display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer;min-width:0}
    .dsh-project-row:hover,.dsh-project-row[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover)}
    .dsh-project-row-text{display:flex;flex:1;flex-direction:column;min-width:0}.dsh-project-row-title,.dsh-project-row-text>.dsh-project-muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-project-row-meta{display:flex;align-items:center;gap:8px;min-width:0}.dsh-project-row-meta>.dsh-project-muted{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-archive-notice{padding:16px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}.dsh-project-row small{flex-shrink:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}
    .dsh-project-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dsh-project-error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;font-size:13px}
    .dsh-project-progress{max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px}
    .dsh-project-progress>p{margin:0}.dsh-project-work{border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;min-width:0}.dsh-project-work>.dsh-project-actions{grid-column:2;grid-row:1}.dsh-project-work>p,.dsh-project-work>button,.dsh-project-work>details{grid-column:1/-1}.dsh-project-work>button{justify-self:start}.dsh-project-work>p{margin:0}
    .dsh-project-work-heading{flex-wrap:nowrap;min-width:0}.dsh-project-work-heading strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-project-work-details>summary,.dsh-project-work-history>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}.dsh-project-work-details[open]>summary{margin-bottom:8px}.dsh-project-work-detail-body{display:flex;flex-direction:column;gap:6px;min-width:0}.dsh-project-work-history{display:flex;flex-direction:column;gap:8px}
    .dsh-project-path{color:var(--dsw-alias-label-tertiary);font:12px monospace;overflow-wrap:anywhere}.dsh-project-body{display:flex;flex-direction:column;gap:12px;min-width:0}
    .dsh-project-artifact{display:flex;flex-direction:column;gap:4px;min-width:0}.dsh-project-artifact-row{display:flex;align-items:center;gap:8px;min-width:0}.dsh-project-artifact-title{flex:1;min-width:0;height:auto;min-height:32px;white-space:normal;overflow-wrap:anywhere;text-align:left;justify-content:flex-start}.dsh-project-artifact-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-left:8px}.dsh-project-artifact-row>span{flex-shrink:0}.dsh-project-artifact>.dsh-project-path{padding:8px}.dsh-project-error-details>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}.dsh-project-error-details pre{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace;color:var(--dsw-alias-label-secondary)}
    .dsh-project-modal{width:min(760px,calc(100vw - 32px))}.dsh-project-modal-content{max-height:80vh;overflow:hidden}.dsh-project-modal-content>:first-child{flex-shrink:0}.dsh-project-modal-content>:last-child{min-height:0;overflow:auto}
    .dsh-project-editor{width:100%;min-height:240px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:1.6;box-sizing:border-box}
    .dsh-project-materials{min-height:0;overflow:hidden!important}.dsh-project-materials-tabs{flex-shrink:0}.dsh-project-materials-content{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px}.dsh-project-materials-footer{flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;gap:12px}.dsh-project-materials-footer>.dsh-project-muted{flex:1}
    .dsh-project-result{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2);min-width:0}.dsh-project-result:first-child{padding-top:0}.dsh-project-result-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0}.dsh-project-result-heading strong{min-width:0;overflow-wrap:anywhere}.dsh-project-result-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-project-result-body{display:flex;flex-direction:column;gap:8px;min-width:0}.dsh-project-result-disclosure>summary,.dsh-project-documents>summary{cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary)}.dsh-project-result-disclosure[open]>summary{margin-bottom:8px}.dsh-project-result-details{display:flex;flex-direction:column;gap:8px}.dsh-project-work-detail-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-project-empty{margin:0;padding:4px 12px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center;line-height:1.5}
    .dsh-project-result-conclusion{margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}.dsh-project-result-checks{display:flex;flex-direction:column;gap:4px;font-size:13px;line-height:1.6;min-width:0}.dsh-project-result-checks ul{margin:0;padding-left:20px;overflow-wrap:anywhere}.dsh-project-materials-host{display:flex;flex-direction:column;min-height:0;overflow:hidden;flex:1}.dsh-project-materials-host[hidden],.dsh-project-results-list[hidden]{display:none}.dsh-project-results-list{display:flex;flex-direction:column;gap:16px;min-width:0}.dsh-project-context{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;margin-bottom:12px}.dsh-project-context-label{font-size:13px;color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}.dsh-project-record-heading{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.dsh-project-record-time{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}.dsh-project-record-round{padding-top:16px;display:flex;flex-direction:column;gap:6px}.dsh-project-record-runs{display:flex;flex-direction:column;gap:4px}.dsh-project-record-runs button{height:auto;white-space:normal;text-align:left;justify-content:flex-start}
    .dsh-project-result-heading>:last-child{flex-shrink:0;white-space:nowrap}
    .dsh-project-record{font:12px/1.6 monospace;white-space:pre;overflow:auto;padding:10px;background:var(--dsw-alias-markdown-code-block);border-radius:12px;max-height:320px}
    .dsh-project-record-row{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.dsh-project-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
    .dsh-project-observer-title{display:flex;align-items:center;gap:8px;min-width:0;width:100%;height:28px;color:var(--dsw-alias-label-primary);font-size:13px}
    [data-dockkit-float-title]:has(.dsh-project-observer-title){flex:1 1 auto;max-width:none}
    .dsh-project-observer-title-text{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-observer-title-state{flex:none;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}
    .dsh-project-mode-controls{display:flex;align-items:center;gap:2px;flex:none;margin-left:auto}
    .dsh-project-mode-button{display:flex;align-items:center;justify-content:center;gap:2px;height:28px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
    .dsh-project-mode-button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-project-mode-button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
    .dsh-project-mode-button:focus-visible,.dsh-project-observer button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
    .dsh-project-observer{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;background:var(--dsw-alias-bg-panel-solid);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
    .dsh-project-observer-toolbar{display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:44px;padding:4px 16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
    .dsh-project-observer-sections{display:flex;align-items:center;min-width:0;gap:4px}.dsh-project-observer-sections button{border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;padding:6px 9px;white-space:nowrap}
    .dsh-project-observer-sections button:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dsh-project-observer-sections button[aria-current=page]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:600}
    .dsh-project-observer-scroll{flex:1;min-height:0;overflow:auto;scrollbar-color:var(--dsw-alias-border-l3) transparent}
    .dsh-project-observer-full-body{height:100%;min-height:0}.dsh-project-observer-full-body[hidden]{display:none}
    .dsh-project-observer-list,.dsh-project-observer-detail,.dsh-project-observer-subview{display:flex;flex-direction:column;gap:8px;padding:16px;min-width:0}
    .dsh-project-observer-empty{display:flex;flex:1;flex-direction:column;justify-content:center;gap:8px;padding:12px;min-width:0}.dsh-project-observer-empty strong{font-size:14px;color:var(--dsw-alias-label-primary)}.dsh-project-observer-empty p{margin:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
    .dsh-project-task-group-title{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:20px 0 4px;color:var(--dsw-alias-label-secondary);font-size:13px}.dsh-project-task-group-title:first-child{padding-top:0}
    .dsh-project-task-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px 0 16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
    .dsh-project-task-card-heading,.dsh-project-task-meta,.dsh-project-task-footer,.dsh-project-task-members{display:flex;align-items:center;gap:8px;min-width:0}.dsh-project-task-card-heading{justify-content:space-between}
    .dsh-project-task-title{flex:1;min-width:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:15px;line-height:24px;font-weight:600;text-align:left;white-space:normal;overflow-wrap:anywhere;cursor:pointer}
    .dsh-project-task-title:hover{text-decoration:underline;text-underline-offset:3px}.dsh-project-task-meta{justify-content:space-between;color:var(--dsw-alias-label-tertiary);font-size:12px}
    .dsh-project-task-goal,.dsh-project-task-outcome{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;overflow-wrap:anywhere}
    .dsh-project-task-footer{justify-content:space-between;flex-wrap:wrap;font-size:13px}.dsh-project-task-state{color:var(--dsw-alias-label-primary)}.dsh-project-task-waiting{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}
    .dsh-project-task-preview{display:flex;flex-direction:column;gap:8px;padding-top:4px}.dsh-project-task-preview>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px}.dsh-project-task-preview span{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}.dsh-project-task-preview small{color:var(--dsw-alias-label-secondary);white-space:nowrap}.dsh-project-task-preview p{grid-column:1/-1;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}
    .dsh-project-task-members{gap:4px}.dsh-project-task-avatar{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:600}
    .dsh-project-task-pagination{display:flex;gap:8px;justify-content:flex-end}.dsh-project-task-detail{display:flex;flex-direction:column;gap:10px;min-width:0}
    .dsh-project-task-detail-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dsh-project-task-detail-heading h2{margin:0;min-width:0;overflow-wrap:anywhere;font-size:16px;line-height:24px}
    .dsh-project-task-tabs{flex:none;min-width:0}
    .dsh-project-task-tab-body{min-width:0}.dsh-project-task-section{display:flex;flex-direction:column;gap:8px;min-width:0;padding:8px 0}.dsh-project-task-section p,.dsh-project-task-member p{margin:0}
    .dsh-project-task-section ul{margin:0;padding-left:20px;overflow-wrap:anywhere}.dsh-project-task-member{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}.dsh-project-task-member .dsh-project-actions{grid-column:1/-1}
    .dsh-project-task-event{display:grid;grid-template-columns:100px minmax(0,1fr);gap:2px 8px;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);min-width:0}.dsh-project-task-event>span:last-child{grid-column:2;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
    .dsh-project-observer-team{display:flex;flex-direction:column;gap:8px;padding:16px;min-width:0}.dsh-project-observer-team>input{width:100%;box-sizing:border-box}.dsh-project-observer-team input::placeholder{color:var(--dsw-alias-label-secondary);opacity:1}
    .dsh-project-team-member{display:flex;flex-direction:column;gap:8px;padding:12px 0 16px;border-bottom:.5px solid var(--dsw-alias-border-l2);min-width:0}
    .dsh-project-team-row{display:flex;align-items:flex-start;gap:8px;min-width:0;flex-wrap:wrap}.dsh-project-team-row>:not(.dsh-project-team-row-content){flex-shrink:0}
    .dsh-project-team-row-content{display:flex;flex:1;flex-direction:column;gap:4px;min-width:160px}.dsh-project-team-row-content strong{font-size:14px;line-height:22px;overflow-wrap:anywhere}.dsh-project-team-row-content small{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
    .dsh-project-team-context{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}.dsh-project-team-details>summary,.dsh-project-team-technical>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px}
    .dsh-project-team-assignments{display:flex;flex-direction:column;gap:8px;padding-top:8px;min-width:0}.dsh-project-team-technical dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:12px}.dsh-project-team-technical dt{color:var(--dsw-alias-label-secondary)}.dsh-project-team-technical dd{margin:0;overflow-wrap:anywhere}
    .dsh-project-visual-results,.dsh-project-result-files{display:flex;flex-direction:column;gap:12px;min-width:0;padding:8px 0}.dsh-project-visual-page{min-width:0;max-width:100%;overflow:hidden}.dsh-project-result-checks{padding:8px 0}.dsh-project-result-heading{align-items:flex-start;flex-wrap:wrap;line-height:24px}
    .dsh-project-team-work{display:flex;flex-direction:column;gap:5px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);min-width:0}.dsh-project-team-work strong{min-width:0;overflow-wrap:anywhere}.dsh-project-team-work p{margin:0}.dsh-project-team-work details p{white-space:pre-wrap;overflow-wrap:anywhere}
    .dsh-project-observer-materials{display:flex;flex-direction:column;height:100%;min-height:0}.dsh-project-observer-materials[hidden]{display:none}.dsh-project-observer-materials>.dsh-project-materials{flex:1;height:100%;box-sizing:border-box;padding:12px}.dsh-project-observer-error{margin:6px 12px}
  `;
  const requestId = () => globalThis.crypto.randomUUID();
  const button = (label, onClick, disabled = false) => h(Button, { variant: 'outline', onClick, disabled }, label);
  const markdown = (t, text) => h(MarkdownText, { text, labels: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') } });
  const stateLabel = (t, state) => Object.hasOwn(zh, state) ? t(state) : String(state ?? '');
  const waitingLabel = (t, waiting) => waiting ? `${t({ dependencies: 'waitingDependencies', directory: 'waitingDirectory', capacity: 'waitingCapacity' }[waiting.kind])}${waiting.workTitles?.length ? ` · ${waiting.workTitles.join('、')}` : ''}` : '';
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
  const directoryParts = project => project.canonicalWorkingDirectory.replaceAll('\\', '/').replace(/\/$/, '').split('/').filter(Boolean);
  function projectDirectoryLabel(project, projects) {
    const peers = projects.filter(other => other.id !== project.id && other.title === project.title);
    if (!peers.length) return '';
    const parts = directoryParts(project);
    for (let count = 1; count < parts.length; count++) {
      const label = parts.slice(-count).join('/');
      if (peers.every(other => directoryParts(other).slice(-count).join('/') !== label)) return `…/${label}`;
    }
    return project.canonicalWorkingDirectory;
  }

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

  function ProjectRow({ project, directoryLabel, currentSession, openProject, command, read, openLifecycle, t }) {
    const [menu, setMenu] = useState(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const execute = async (action, input) => { setBusy(true); setError(''); try { await command(project.id, action, input); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    const select = async action => {
      setMenu(false); setError('');
      try {
        if (action === 'rename' || action === 'archive') { await openLifecycle(project.id, action); return; }
        if (action === 'openDirectory') { await read(project.id, 'open'); return; }
        await execute(action);
      } catch (failure) { setError(errorText(failure)); }
    };
    const activity = project.activity?.state;
    const status = project.lifecycle === 'archived' ? t('archived') : activity && !['idle', 'done'].includes(activity) ? t({ summaryFailed: 'sidebarSummaryFailed', pendingSummary: 'sidebarPendingSummary' }[activity] ?? activity) : '';
    return h(Fragment, null,
      h('div', { className: 'dsh-project-row-wrap', onContextMenu: event => { event.preventDefault(); setMenu(true); }, onKeyDown: event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); setMenu(true); } } },
        h('button', { type: 'button', className: 'dsh-project-row', title: `${project.title}\n${project.canonicalWorkingDirectory}`, 'aria-current': currentSession === project.coordinatorSessionId ? 'page' : undefined, onClick: () => { void openProject(project.id); } },
          h(IconFolderCloseRegular, { size: 16 }), h('span', { className: 'dsh-project-row-text' }, h('span', { className: 'dsh-project-row-title' }, project.title), directoryLabel || status ? h('span', { className: 'dsh-project-row-meta' }, directoryLabel ? h('span', { className: 'dsh-project-muted' }, directoryLabel) : null, status ? h('small', { title: `${stateLabel(t, activity)} · ${project.activity?.running ?? 0} ${t('running')} · ${project.activity?.queued ?? 0} ${t('queued')}` }, status) : null) : null)),
        h(Menu, { open: menu, onClose: () => setMenu(false), portal: true, align: 'end', compact: true, onSelect: action => { void select(action); }, items: [{ id: 'rename', label: t('rename') }, { id: 'openDirectory', label: t('openDirectory') }, { id: project.lifecycle === 'archived' ? 'restore' : 'archive', label: t(project.lifecycle === 'archived' ? 'restore' : 'archive') }], anchor: h(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('more'), onClick: () => setMenu(value => !value) }, '…') })),
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  function SidebarPage({ query = '', useProjects, useProjectSessions, useStore, actions, openProject, command, read, openLifecycle, addProject, t }) {
    const snapshot = useProjects(value => value), view = useStore(value => value);
    const currentSession = useProjectSessions(value => Object.values(value.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id);
    const [expanded, setExpanded] = useState(true), [menu, setMenu] = useState(false);
    const projects = snapshot.projects.filter(project => (view.history ? project.lifecycle === 'archived' : project.lifecycle !== 'archived') && (!query || project.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
    return h('section', { className: 'dsh-project-page', 'aria-label': t('tab') },
      h('div', { className: 'dsh-project-heading' }, h('button', { type: 'button', className: 'dsh-project-category', 'aria-expanded': expanded, onClick: () => setExpanded(value => !value) },
        h(expanded ? IconChevronDownOutlineRegular : IconChevronRightOutlineRegular, { size: 14 }), h('span', null, t('tab'), view.history ? ' · ' + t('archived') : '')),
        h(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('add'), onClick: () => { void addProject(); } }, '+'),
        h(Menu, { open: menu, onClose: () => setMenu(false), portal: true, compact: true, items: [{ id: 'history', label: t(view.history ? 'tab' : 'history') }], onSelect: () => { actions.setHistory(!view.history); setMenu(false); }, anchor: h(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('more'), onClick: () => setMenu(value => !value) }, '…') })),
      expanded ? h(Fragment, null,
        snapshot.error ? h('p', { role: 'alert', className: 'dsh-project-error' }, snapshot.error) : null,
        snapshot.loading && !snapshot.projects.length ? h('p', { role: 'status' }, t('loading')) : null,
        h('div', { className: 'dsh-project-list' }, projects.map(project => h(ProjectRow, { key: project.id, project, directoryLabel: projectDirectoryLabel(project, projects), currentSession, openProject, command, read, openLifecycle, t })))) : null);
  }

  function ProjectHeader({ sessionId, useProjects, read, openObserver, trackActiveProject, t }) {
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    const [openFailure, setOpenFailure] = useState(null);
    useEffect(() => { if (project) return trackActiveProject(project.id); }, [project?.id]);
    if (!project) return null;
    const directory = directoryParts(project).at(-1) || project.canonicalWorkingDirectory;
    return h('div', { className: 'dsh-project-header' },
      h(Button, { variant: 'ghost', size: 'sm', className: 'dsh-project-header-directory', onClick: () => { void read(project.id, 'open').catch(failure => setOpenFailure(previous => ({ seq: (previous?.seq ?? 0) + 1, text: `${t('openDirectory')}: ${errorText(failure)}` }))); }, title: project.canonicalWorkingDirectory },
        h(IconFolderCloseRegular, { size: 16 }), h('span', { className: 'dsh-project-header-path' }, directory)),
      h(Button, { variant: 'ghost', size: 'sm', className: 'dsh-project-header-label', onClick: () => openObserver(project.id), title: t('projectOverview') }, t('projectOverview')),
      openFailure ? h(Toast, { key: openFailure.seq, text: openFailure.text, holdMs: 6000, onDone: () => setOpenFailure(null) }) : null);
  }

  const OBSERVER_KIND = 'project';
  const OBSERVER_TAB = 'dsh-project/observer';
  function observerRect(mode, current) {
    const root = document.documentElement;
    const caption = root.hasAttribute('data-windows-titlebar') && !root.hasAttribute('data-fullscreen')
      ? Number.parseFloat(root.style.getPropertyValue('--dsh-windows-titlebar-height')) || 0 : 0;
    const desktopCaption = Number.parseFloat(getComputedStyle(root).getPropertyValue('--dshd-wco-caption')) || 0;
    const top = Math.max(12, caption + 20, desktopCaption + 20), width = Math.min(current?.width ?? 480, Math.max(1, window.innerWidth - 16));
    const composer = [...document.querySelectorAll('[data-composer-card]')].map(element => element.getBoundingClientRect())
      .find(rect => rect.height > 0 && rect.top > top + 140);
    const bottom = Math.min(window.innerHeight - 12, composer ? composer.top - 12 : window.innerHeight - 12);
    const minimumHeight = mode === 'strip' ? 38 : 140, availableHeight = Math.max(minimumHeight, bottom - top);
    const height = Math.max(minimumHeight, Math.min(mode === 'strip' ? 38 : current?.height ?? 520, availableHeight));
    return { x: Math.max(8, Math.min(current?.x ?? window.innerWidth - width - 12, window.innerWidth - width - 8)),
      y: Math.max(top, Math.min(current?.y ?? top, bottom - height)), width, height };
  }
  const panelMode = panel => panel.host === 'float' && panel.rect?.height <= 38 ? 'strip' : 'full';

  function ProjectObserverTitle({ sessionId, useTabInfo, useProjects, useObserverModes, read, resizeObserver, t }) {
    const { panel, tab } = useTabInfo();
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    const selectedMode = useObserverModes(value => value[sessionId]?.[panel.id]);
    const mode = panel.host === 'float' && (selectedMode === 'strip' || !selectedMode && panelMode(panel) === 'strip') ? 'strip' : 'full';
    const state = project?.archiving ? 'archiving' : project?.lifecycle === 'archived' ? 'archived' : project?.activity?.state ?? 'idle';
    const status = stateLabel(t, ({ idle: 'observerIdle', archiving: 'observerArchiving', summaryFailed: 'sidebarSummaryFailed' })[state] ?? state);
    return h('span', { className: 'dsh-project-observer-title' },
      h(IconFolderCloseRegular, { size: 16 }), h('span', { className: 'dsh-project-observer-title-text', title: project?.canonicalWorkingDirectory }, project?.title || t('tab')),
      h('span', { className: 'dsh-project-observer-title-state', role: 'status', title: stateLabel(t, state) }, status),
      panel.host === 'float' ? h(Button, { variant: 'ghost', size: 'sm', className: 'dsh-project-mode-button',
        'aria-expanded': mode !== 'strip', onPointerDown: event => event.stopPropagation(),
        onClick: event => { event.stopPropagation(); resizeObserver(sessionId, panel, tab.id, mode === 'strip' ? 'full' : 'strip'); },
      }, t(mode === 'strip' ? 'observerExpand' : 'observerStrip')) : null);
  }

  function ProjectTaskCard({ card, open, openResult, archive, archivable, t }) {
    const [menu, setMenu] = useState(false), done = card.status === 'completed';
    const activeWork = (card.workPreview ?? []).filter(item => !['done', 'completed'].includes(item.status));
    const preview = done ? [] : activeWork.filter(item => item.title !== card.title).slice(0, 2);
    const waiting = activeWork.find(item => item.waitingReason || item.blockedReason);
    return h('article', { className: 'dsh-project-task-card', 'data-project-request-id': card.id,
      onContextMenu: event => { event.preventDefault(); setMenu(true); } },
      h('div', { className: 'dsh-project-task-card-heading' },
        h('button', { type: 'button', className: 'dsh-project-task-title', onClick: open, title: card.title }, card.title),
        h(Menu, { open: menu, onClose: () => setMenu(false), portal: true, compact: true, align: 'end',
          items: [{ id: 'open', label: t('taskDetail') }, ...(archivable && (done || card.archivedAt) ? [{ id: 'archive', label: t(card.archivedAt ? 'taskRestoreAction' : 'taskArchiveAction') }] : [])],
          onSelect: action => { setMenu(false); if (action === 'archive') archive(); else open(); },
          anchor: h(Button, { variant: 'ghost', size: 'sm', 'aria-label': `${card.title} · ${t('more')}`, onClick: () => setMenu(value => !value) }, '…') })),
      h('div', { className: 'dsh-project-task-meta' }, h('span', { className: 'dsh-project-task-state' }, stateLabel(t, card.status)),
        card.counts?.total ? h('span', null, `${card.counts.completed ?? 0} / ${card.counts.total} ${t('taskWorkCount')}`) : null),
      done && card.delivery?.summaryPreview ? h('p', { className: 'dsh-project-task-outcome' }, summaryPreview(card.delivery.summaryPreview)) : null,
      waiting ? h('p', { className: 'dsh-project-task-waiting' }, waitingLabel(t, waiting.waitingReason) || waiting.blockedReason) : null,
      preview.length ? h('div', { className: 'dsh-project-task-preview' }, preview.map(item => h('div', { key: item.delegationRef },
        h('span', null, item.title), h('small', null, stateLabel(t, item.status))))) : null,
      h('div', { className: 'dsh-project-task-footer' },
        card.memberTotal ? h('span', { className: 'dsh-project-muted' }, `${card.memberTotal} ${t('taskMemberCount')}`) : null,
        h(Button, { variant: 'ghost', size: 'sm', onClick: done ? openResult : open }, t(done ? 'viewResult' : 'taskDetail'))));
  }

  function projectMemberDisplayName(member, work, t) {
    if (member.role === 'lead') return t('teamLead');
    const name = member.name?.trim();
    const internalName = name === `member-${member.id?.replace(/^session-/, '')}`
      || /^member-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name ?? '');
    return name && !internalName ? name : work?.title || work?.subject || member.description || t('teamMember');
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
        || (!worker?.stopped && (worker?.error || work?.blockedReason !== 'stopped' && work?.blockedReason))
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

  function ProjectTaskWork({ projectId, item, read, controls, t }) {
    const [value, setValue] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      if (!item.current) return;
      let live = true;
      read(projectId, 'workstreams/get', { workstreamId: item.workstreamId }).then(result => { if (live) setValue(result); })
        .catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [projectId, item.workstreamId, item.delegationRef, item.updatedAt, item.status]);
    if (value?.workstream.currentDelegationRef === item.delegationRef) return h(WorkProgressItem, {
      projectId, work: { ...value.workstream, id: item.workstreamId, hasReport: Boolean(value.workstream.latestReport) }, worker: value.worker,
      read, ...controls, t,
    });
    return h('div', { className: 'dsh-project-task-member' },
      h('div', null, h('strong', null, projectMemberDisplayName({ name: item.memberName, description: item.title }, item, t)), recordedTime(item.updatedAt)),
      h(Pill, null, stateLabel(t, item.status)),
      item.waitingReason || item.blockedReason ? h('p', { className: 'dsh-project-muted' }, waitingLabel(t, item.waitingReason) || item.blockedReason) : null,
      h('div', { className: 'dsh-project-actions' }, h(Button, { variant: 'ghost', size: 'sm', onClick: () => controls.showProcess(projectId, item.workstreamId, false, { delegationRef: item.delegationRef }) }, t('viewProcess')),
        item.reportId ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => controls.showMaterials(projectId, item.workstreamId, { delegationRef: item.delegationRef }) }, t('viewResult')) : null),
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  function ProjectTaskDetail({ projectId, card, tab, setTab, read, showProcess, showReport, controls, retryHandover, renderFactorySlot, t }) {
    const work = card.work ?? [], delivery = card.delivery && { ...card.delivery, requestId: card.id, requestRevision: card.revision, title: card.title,
      reportRefs: card.delivery.reportRefs ?? [], terminalRefs: card.delivery.terminalRefs ?? [] };
    const tabs = [['overview', 'taskOverview'], ['team', 'taskTeam'], ['results', 'taskResults'], ['activity', 'taskActivity']];
    return h('div', { className: 'dsh-project-task-detail', 'data-project-detail-id': card.id },
      h('div', { className: 'dsh-project-task-detail-heading' }, h('h2', null, card.title), h(Pill, null, stateLabel(t, card.status))),
      h('div', { className: 'dsh-project-task-meta' }, recordedTime(card.updatedAt), h('span', null, `${t('requestVersion')} ${card.revision}`)),
      h(SegmentedTabs, { className: 'dsh-project-task-tabs', label: t('taskDetail'), value: tab, onChange: setTab,
        items: tabs.map(([id, label]) => ({ value: id, label: t(label), id: `${card.id}-tab-${id}`, panelId: `${card.id}-panel-${id}` })) }),
      h('div', { className: 'dsh-project-task-tab-body', role: 'tabpanel', id: `${card.id}-panel-${tab}`, 'aria-labelledby': `${card.id}-tab-${tab}` },
        tab === 'overview' ? h(Fragment, null,
          card.authorityError ? h(RequestAuthority, { request: card, t }) : null,
          card.handoverError && !card.authorityError ? h('div', { className: 'dsh-project-task-section' },
            h('p', { className: 'dsh-project-error' }, t('handoverErrorHint')),
            button(t('retrySummary'), () => retryHandover(card), controls.busy),
            h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, card.handoverError))) : null,
          h('div', { className: 'dsh-project-task-section' }, h('strong', null, t('workRequest')), markdown(t, card.goal)),
          card.conditions?.length ? h('div', { className: 'dsh-project-task-section' }, h('strong', null, t('keyEvidence')), h('ul', null, card.conditions.map((item, index) => h('li', { key: index }, item)))) : null,
          card.constraints?.length ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('executionInfo')), h('ul', null, card.constraints.map((item, index) => h('li', { key: index }, item)))) : null,
          delivery ? h('div', { className: 'dsh-project-task-section' }, h('strong', null, t('result')), h('p', null, summaryPreview(delivery.summary)),
            delivery.remainingIssues?.length ? h('p', { className: 'dsh-project-muted' }, `${t('remainingIssues')}: ${delivery.remainingIssues.join('；')}`) : null) : null) : null,
        tab === 'team' ? h('div', { className: 'dsh-project-task-section' }, work.length ? work.map(item => h(ProjectTaskWork, {
          key: item.workstreamId + ':' + item.delegationRef, projectId, item, read, controls, t,
        })) : h('p', { className: 'dsh-project-muted' }, t('taskNoMembers'))) : null,
        tab === 'results' ? h('div', { className: 'dsh-project-task-section' }, delivery
          ? h(DeliveryEntry, { projectId, delivery, results: work.map(item => ({ workstreamId: item.workstreamId, title: item.title })), read,
            openReport: showReport, showProcess: (_id, workstreamId, _member, context) => showProcess({ workstreamId, delegationRef: context.delegationRef }), renderFactorySlot, t })
          : h('p', { className: 'dsh-project-muted' }, t('taskNoResults')),
           work.filter(item => item.reportId && !delivery?.reportRefs?.some(ref => ref.workstreamId === item.workstreamId && ref.delegationRef === item.delegationRef))
            .map(item => h(Button, { key: item.workstreamId + ':' + item.delegationRef, variant: 'ghost', size: 'sm', onClick: () => showReport(item) }, item.title, ' · ', t('reportSource')))) : null,
        tab === 'activity' ? h('div', { className: 'dsh-project-task-section' },
          [...(card.versions ?? []).map(version => ({ key: `version-${version.revision}`, at: version.at, label: `${t('requestVersion')} ${version.revision}`, detail: version.title })),
            ...work.flatMap(item => [{ key: `${item.delegationRef}-assignment`, at: item.assignmentAt, label: item.title, detail: item.memberName },
              ...(item.reportAt ? [{ key: `${item.delegationRef}-report`, at: item.reportAt, label: t('reportSource'), detail: item.title }] : []),
              ...(item.terminalAt ? [{ key: `${item.delegationRef}-terminal`, at: item.terminalAt, label: stateLabel(t, item.status), detail: item.title }] : [])]),
            ...(delivery ? [{ key: `delivery-${delivery.id}`, at: delivery.at, label: t('delivered'), detail: delivery.summary }] : [])]
            .filter(item => Number.isFinite(item.at)).sort((a, b) => b.at - a.at)
            .map(item => h('div', { key: item.key, className: 'dsh-project-task-event' }, recordedTime(item.at), h('strong', null, item.label), h('span', null, summaryPreview(item.detail)))),
          !card.versions?.length && !work.length && !delivery ? h('p', { className: 'dsh-project-muted' }, t('taskNoActivity')) : null) : null));
  }

  function ProjectObserver({ sessionId, useTabInfo, useProjects, useProjectSessions, useObserverModes, useSidebarMounted, readDetail, read, command, sendUserRequest, openModelSettings, retainProcess, resizeObserver, registerObserverEditor, renderFactorySlot, teamT, t }) {
    const { panel, tab } = useTabInfo();
    const selectedMode = useObserverModes(value => value[sessionId]?.[panel.id]);
    const active = useSidebarMounted(value => value === sessionId);
    const mode = panel.host === 'float' && (selectedMode === 'strip' || !selectedMode && panelMode(panel) === 'strip') ? 'strip' : 'full';
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    const detail = useProjects(value => project ? value.details[project.id] : undefined);
    const team = useProjectSessions(value => value.projectionsBySession[sessionId]?.values.agentTeam);
    const sessions = useProjectSessions(value => value.byId);
    const [section, setSection] = useState('tasks'), [archiveView, setArchiveView] = useState(false), [selectedId, setSelectedId] = useState(null);
    const [taskTab, setTaskTab] = useState('overview'), [subview, setSubview] = useState(null), [subviewReturn, setSubviewReturn] = useState('tasks');
    const observerRef = useRef(null), subviewBackRef = useRef(null), subviewOrigin = useRef(null);
    useLayoutEffect(() => {
      if (!active || mode !== 'full') return;
      if (subview) { subviewBackRef.current?.focus({ preventScroll: true }); return; }
      const origin = subviewOrigin.current;
      subviewOrigin.current = null;
      if (observerRef.current?.contains(origin) && origin.getClientRects().length) origin.focus({ preventScroll: true });
    }, [subview]);
    const [materialsVisited, setMaterialsVisited] = useState(false);
    const cursorScope = `${project?.id ?? ''}:${detail?.revision ?? ''}`;
    const [cursorState, setCursorState] = useState({ scope: cursorScope, current: [null], completed: [null], archived: [null] });
    const activeCursors = cursorState.scope === cursorScope ? cursorState : { scope: cursorScope, current: [null], completed: [null], archived: [null] };
    const [pages, setPages] = useState({}), [cardsBusy, setCardsBusy] = useState(false), [card, setCard] = useState(null), [cardBusy, setCardBusy] = useState(false);
    const [actionBusy, setActionBusy] = useState(false);
    const panelRef = useRef(panel);
    panelRef.current = panel;
    useLayoutEffect(() => {
      if (!active || panel.host !== 'float') return;
      const fit = () => resizeObserver(sessionId, panelRef.current, tab.id, mode, false);
      const observer = new ResizeObserver(fit);
      document.querySelectorAll('[data-composer-card]').forEach(element => observer.observe(element));
      window.addEventListener('resize', fit);
      fit();
      return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
    }, [sessionId, panel.id, panel.host, mode, active]);
    const [error, setError] = useState(''), [refreshKey, setRefreshKey] = useState(0), [materialsDirty, setMaterialsDirty] = useState(false), [pendingRoute, setPendingRoute] = useState(null);
    const editorRef = useRef(null), materialsDirtyRef = useRef(false);
    const onMaterialsDirty = useCallback(value => { materialsDirtyRef.current = value; setMaterialsDirty(value); }, []);
    useEffect(() => { if (section === 'materials') setMaterialsVisited(true); }, [section]);
    useEffect(() => registerObserverEditor(sessionId, tab.id, {
      getPanel: () => panelRef.current,
      isDirty: () => materialsDirtyRef.current,
      requestClose: proceed => setPendingRoute({ close: proceed }),
    }), [sessionId, tab.id]);
    useEffect(() => {
      if (!project) return;
      void readDetail(project.id).catch(failure => setError(errorText(failure)));
    }, [project?.id]);
    useEffect(() => {
      if (!project) return;
      let live = true; setCardsBusy(true);
      const kinds = ['current', 'completed', 'archived'];
      const cursor = { current: activeCursors.current.at(-1), completed: activeCursors.completed.at(-1), archived: activeCursors.archived.at(-1) };
      void Promise.all(kinds.map(kind => read(project.id, 'requests/list', { kind, ...(cursor[kind] ? { cursor: cursor[kind] } : {}) }).then(page => [kind, page])))
        .then(rows => { if (live) {
          setPages(before => ({ ...before, ...Object.fromEntries(rows) }));
          setError('');
        } })
        .catch(failure => { if (live) setError(errorText(failure)); })
        .finally(() => { if (live) setCardsBusy(false); });
      return () => { live = false; };
    }, [project?.id, detail?.revision, refreshKey, activeCursors.current.at(-1), activeCursors.completed.at(-1), activeCursors.archived.at(-1)]);
    useEffect(() => {
      if (!project || !selectedId) { setCard(null); return; }
      let live = true; setCard(null); setCardBusy(true);
      void read(project.id, 'requests/get', { requestId: selectedId }).then(value => { if (live) { setCard(value.card); setError(''); } })
        .catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setCardBusy(false); });
      return () => { live = false; };
    }, [project?.id, selectedId, detail?.revision, refreshKey]);
    if (!project) return h('p', { className: 'dsh-project-empty' }, t('unavailable'));

    const applyRoute = route => { setSection(route.section ?? 'tasks'); setSubview(route.subview ?? null); if (route.returnSection) setSubviewReturn(route.returnSection); if (Object.hasOwn(route, 'selectedId')) setSelectedId(route.selectedId); };
    const navigate = route => {
      if (route.subview && !subview) subviewOrigin.current = document.activeElement;
      if (section === 'materials' && materialsDirty && route.section !== 'materials' && !route.subview) setPendingRoute(route);
      else applyRoute(route);
    };
    const closePending = () => setPendingRoute(null);
    const leaveMaterials = async save => {
      if (save && !(await editorRef.current?.save())) return;
      if (!save && !pendingRoute?.close) editorRef.current?.discard();
      if (pendingRoute?.close) pendingRoute.close();
      else applyRoute(pendingRoute);
      setPendingRoute(null);
    };
    const archive = async item => {
      setError('');
      try {
        await command(project.id, item.archivedAt ? 'requests/restore' : 'requests/archive', { requestId: item.id });
        setSelectedId(null); setCard(null); setCursorState({ scope: cursorScope, current: [null], completed: [null], archived: [null] }); setRefreshKey(value => value + 1);
      } catch (failure) { setError(errorText(failure)); }
    };
    const updateCursors = (kind, change) => setCursorState(before => {
      const current = before.scope === cursorScope ? before : { scope: cursorScope, current: [null], completed: [null], archived: [null] };
      return { ...current, [kind]: change(current[kind]) };
    });
    const pageControls = (kind, page) => h('div', { className: 'dsh-project-task-pagination' },
      activeCursors[kind].length > 1 ? button(t('previous'), () => updateCursors(kind, before => before.slice(0, -1)), cardsBusy) : null,
      page?.nextCursor ? button(t('taskMore'), () => updateCursors(kind, before => [...before, page.nextCursor]), cardsBusy) : null);
    const list = kind => h(Fragment, null,
      (pages[kind]?.items ?? []).map(item => h(ProjectTaskCard, { key: item.id, card: item,
        open: () => { setSelectedId(item.id); setTaskTab('overview'); }, openResult: () => { setSelectedId(item.id); setTaskTab('results'); },
        archive: () => { void archive(item); }, archivable: project.lifecycle === 'ready' && !project.archiving, t })),
      pageControls(kind, pages[kind]));
    const showProcess = item => navigate({ section: 'tasks', returnSection: section, subview: { kind: 'process',
      ...(item.workstreamId ? { workstreamId: item.workstreamId } : { workerSessionId: item.workerSessionId }), delegationRef: item.delegationRef } });
    const showReport = item => navigate({ section: 'tasks', returnSection: section, subview: { kind: 'report', workstreamId: item.workstreamId, delegationRef: item.delegationRef } });
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
      showProcess: (_id, workstreamId, member, context = {}) => showProcess({ ...(member ? { workerSessionId: workstreamId } : { workstreamId }), delegationRef: context.delegationRef }),
      showMaterials: (_id, workstreamId, context = {}) => showReport({ workstreamId, delegationRef: context.delegationRef ?? card?.work.find(item => item.workstreamId === workstreamId && item.current)?.delegationRef }),
      showDiff: (_id, workstreamId) => navigate({ section: 'tasks', returnSection: section, subview: { kind: 'diff', workstreamId } }) };
    const emptyBody = h('div', { className: 'dsh-project-observer-empty' }, h('strong', null, t('taskEmptyTitle')), h('p', null, t('taskEmpty')));
    const taskBody = subview ? h('div', { className: 'dsh-project-observer-subview' },
        h(Button, { ref: subviewBackRef, variant: 'ghost', size: 'sm', onClick: () => subviewReturn === 'tasks' ? setSubview(null) : applyRoute({ section: subviewReturn }) },
          t(subviewReturn === 'materials' ? 'backToResults' : subviewReturn === 'team' ? 'teamBack' : 'taskBack')),
        subview.kind === 'process' && detail ? h(ProcessPreview, { key: (subview.workstreamId ?? subview.workerSessionId) + ':' + (subview.delegationRef ?? ''), project: detail.project,
          workstreamId: subview.workstreamId, workerSessionId: subview.workerSessionId, delegationRef: subview.delegationRef, read, retainProcess, t }) :
          subview.kind === 'report' ? h(ProjectReportView, { projectId: project.id, reference: subview, read, showProcess: (_id, workstreamId, _member, context) => showProcess({ workstreamId, delegationRef: context?.delegationRef }), t }) :
          subview.kind === 'diff' ? h(FileDiff, { projectId: project.id, workstreamId: subview.workstreamId, read, t }) : null) :
      selectedId ? h('div', { className: 'dsh-project-observer-detail' },
        h(Button, { variant: 'ghost', size: 'sm', onClick: () => setSelectedId(null) }, t(archiveView ? 'taskArchive' : 'taskBack')),
        cardBusy && !card ? h('p', { role: 'status' }, t('loading')) : card ? h(ProjectTaskDetail, { projectId: project.id, card, tab: taskTab, setTab: setTaskTab,
          read, showProcess, showReport, controls, retryHandover, renderFactorySlot, t }) : null) :
      h('div', { className: 'dsh-project-observer-list' }, archiveView ? h(Fragment, null,
        h('div', { className: 'dsh-project-task-group-title' }, h('strong', null, t('taskArchive')), h('span', null, pages.archived?.total ?? 0)),
        list('archived'), !pages.archived?.total && !cardsBusy ? h('p', { className: 'dsh-project-empty' }, t('taskArchiveEmpty')) : null) : h(Fragment, null,
        h('div', { className: 'dsh-project-task-group-title' }, h('strong', null, t('taskCurrent')), h('span', null, pages.current?.total ?? 0)),
        list('current'),
        h('div', { className: 'dsh-project-task-group-title' }, h('strong', null, t('taskCompleted')), h('span', null, pages.completed?.total ?? 0)),
        list('completed'),
        !pages.current?.total && !pages.completed?.total && !cardsBusy ? emptyBody : null));
    const fullBody = h(Fragment, null,
      materialsVisited || section === 'materials' ? h('div', { className: 'dsh-project-observer-materials', hidden: section !== 'materials' },
        h(Materials, { key: project.id, projectId: project.id, resourceRevision: detail?.revision, active: section === 'materials' && mode === 'full', read, command, onDirtyChange: onMaterialsDirty, editorRef,
          readonly: project.lifecycle === 'archived' || project.archiving, showProcess: (_id, workstreamId, _member, context) => showProcess({ workstreamId, delegationRef: context?.delegationRef }), renderFactorySlot, t })) : null,
      h('div', { hidden: section === 'materials' }, section === 'team'
        ? h(ProjectTeamOverview, { team, sessions, detail, openMember: workerSessionId => showProcess({ workerSessionId }), teamT, t }) : taskBody));
    return h('section', { ref: observerRef, className: 'dsh-project-observer', 'data-project-observer-mode': mode, 'aria-label': t('observerOpen') },
      mode === 'full' ? h('div', { className: 'dsh-project-observer-toolbar' },
        h('div', { className: 'dsh-project-observer-sections' },
           h('button', { type: 'button', 'aria-current': section === 'tasks' ? 'page' : undefined, onClick: () => navigate({ section: 'tasks', selectedId: null }) }, t('taskList')),
           h('button', { type: 'button', 'aria-current': section === 'team' ? 'page' : undefined, onClick: () => navigate({ section: 'team' }) }, t('team')),
          h('button', { type: 'button', 'aria-current': section === 'materials' ? 'page' : undefined, onClick: () => navigate({ section: 'materials' }) }, t('taskMaterials'))),
        section === 'tasks' ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => { setSelectedId(null); setArchiveView(value => !value); } }, t(archiveView ? 'taskBack' : 'taskArchive'), archiveView ? '' : ` · ${pages.archived?.total ?? 0}`) : null) : null,
      error ? h('p', { role: 'alert', className: 'dsh-project-error dsh-project-observer-error' }, error) : null,
      mode === 'full' && project.diagnostics?.length ? h('details', { className: 'dsh-project-error-details dsh-project-observer-error' },
        h('summary', null, t('blocked'), ' · ', t('errorDetails')),
        project.diagnostics.map((item, index) => h('pre', { key: index }, typeof item === 'string' ? item : item.message))) : null,
      cardsBusy && !pages.current && !pages.completed && !pages.archived ? h('p', { role: 'status', className: 'dsh-project-empty' }, t('loading')) : null,
      h('div', { className: 'dsh-project-observer-scroll' }, h('div', { className: 'dsh-project-observer-full-body', hidden: mode !== 'full' }, fullBody)),
      pendingRoute ? h(Modal, { open: true, onClose: closePending, closeLabel: t('keepEditing'), title: t('unsaved'), className: 'dsh-project-confirm',
        footer: h('div', { className: 'dsh-project-actions' }, button(t('keepEditing'), closePending), button(t(pendingRoute.close ? 'discard' : 'discardAndSwitch'), () => { void leaveMaterials(false); }),
          h(Button, { variant: 'primary', disabled: editorRef.current?.busy || editorRef.current?.tooLong, onClick: () => { void leaveMaterials(true); } }, t(pendingRoute.close ? 'saveAndClose' : 'saveAndSwitch'))) },
        h('p', null, t(pendingRoute.close ? 'saveBeforeClose' : 'saveBeforeSwitch'))) : null);
  }

  function ProjectArchiveComposer({ matched, useProjects, command, t }) {
    const project = useProjects(value => value.projects.find(item => item.id === matched.projectId));
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const restore = async () => { setBusy(true); setError(''); try { await command(project.id, 'restore'); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    return h('div', { className: 'dsh-project-archive-notice', role: 'status' }, h('p', null, t(project?.archiving ? 'archiving' : 'archivedHint')), project?.lifecycle === 'archived' ? button(t('restore'), restore, busy) : null, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  function WorkProgressItem({ projectId, work, worker, paused, act, read, retrySummary, openModelSettings, showProcess, showDiff, showMaterials, busy, t }) {
    const [expanded, setExpanded] = useState(false), [value, setValue] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      if (!expanded) return;
      let live = true; setValue(null); setError('');
      void read(projectId, 'workstreams/get', { workstreamId: work.id }).then(result => { if (live) setValue(result); }).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [expanded, projectId, work.id, work.updatedAt, work.prerequisitesChanged]);
    const report = value?.workstream.latestReport, member = value?.worker;
    const waiting = work.delegation?.waitingReason;
    const summaryFailure = work.summaryFailure && (!work.currentDelegationRef || work.summaryFailure.delegationRef === work.currentDelegationRef) ? work.summaryFailure : null;
    const state = worker?.phase === 'stopping' ? 'stopping' : worker?.phase === 'failed' ? 'failed' : worker?.stopped && work.status !== 'done' ? 'paused' : worker && isLive(worker) ? 'running' : work.delegation?.phase === 'queued' ? 'queued' : work.delegation?.phase === 'preparing' ? 'provisioning' : work.status === 'running' ? 'running' : summaryFailure ? 'sidebarSummaryFailed' : work.pendingSummary && !worker?.stopped && !paused ? 'pendingSummary' : work.status;
    return h('div', { className: 'dsh-project-work', 'data-workstream-id': work.id },
      h('div', { className: 'dsh-project-heading dsh-project-work-heading' }, h('strong', { title: work.title }, work.title), h(Pill, null, stateLabel(t, state))),
      worker?.error || !worker?.stopped && work.blockedReason && work.blockedReason !== 'stopped' ? h('p', { className: 'dsh-project-error' }, worker?.error || work.blockedReason) : null,
      work.delegation?.phase === 'queued' ? h('p', { className: 'dsh-project-muted' }, waiting ? `${t({ dependencies: 'waitingDependencies', directory: 'waitingDirectory', capacity: 'waitingCapacity' }[waiting.kind])}${waiting.workTitles.length ? ` · ${waiting.workTitles.join('、')}` : ''}` : t('queued')) : null,
      summaryFailure && !work.request?.authorityError ? h(SummaryFailure, { failure: summaryFailure, openModelSettings, t }) : null,
      work.prerequisitesChanged ? h('p', { className: 'dsh-project-muted', title: t('prerequisitesHint') }, t('prerequisitesChanged')) : null,
      h('div', { className: 'dsh-project-actions' }, work.hasReport ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => showMaterials(projectId, work.id) }, t('viewResult')) : null,
        summaryFailure && !work.request?.authorityError ? button(t('retrySummary'), () => retrySummary(work), busy) : null,
        worker && !worker.stopped && (isLive(worker) || ['queued', 'preparing'].includes(work.delegation?.phase)) ? button(t('stopWork'), () => act('stop', { workstreamId: work.id }), busy) : null),
      h('details', { className: 'dsh-project-work-details', open: expanded, onToggle: event => setExpanded(event.currentTarget.open) }, h('summary', null, t('workDetails')),
        expanded ? h('div', { className: 'dsh-project-work-detail-body' },
          summaryFailure && work.request?.authorityError ? h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, [summaryFailure.error.code, summaryFailure.error.message].filter(Boolean).join('\n'))) : null,
          !value && !error ? h('p', { role: 'status' }, t('loading')) : null,
          error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
          h('div', { className: 'dsh-project-work-detail-actions' }, work.workerSessionId ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => showProcess(projectId, work.id) }, t('viewProcess')) : null,
            report && !work.hasReport ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => showMaterials(projectId, work.id) }, t('viewResult')) : null,
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
    const [savedText, setSavedText] = useState(''), [generatedText, setGeneratedText] = useState('');
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
      read(projectId, 'store/read', { path }).then(value => { if (live) { const editableText = path === 'notes.md' ? value.userText : value.text; setText(editableText); setSavedText(editableText); setGeneratedText(value.generatedText ?? ''); setLoadedPath(path); } })
        .catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setBusy(false); });
      return () => { live = false; };
    }, [projectId, path]);
    const editable = path === 'notes.md' || path === 'preferences.md';
    const tooLong = editable && loadedPath === path && new TextEncoder().encode(text).byteLength > 256000;
    const save = async () => {
      if (tooLong) return false;
      setBusy(true); setError(''); setNotice('');
      try { const value = await command(projectId, 'store/write', { path, text }); setSavedText(text); if (path === 'notes.md') setGeneratedText(value.generatedText ?? generatedText); setNotice(t('saved')); return true; } catch (failure) { setError(errorText(failure)); return false; } finally { setBusy(false); }
    };
    useEffect(() => { if (editorRef) editorRef.current = { save, discard: () => { setText(savedText); setNotice(''); }, dirty, busy: pending, tooLong }; return () => { if (editorRef) editorRef.current = null; }; }, [editorRef, save, savedText, dirty, pending, tooLong]);
    const tabs = ['docs', 'notes.md', 'preferences.md'].map(file => ({ value: file, label: t(file === 'docs' ? 'workResults' : file === 'notes.md' ? 'notes' : 'preferences'), id: `${projectId}-material-tab-${file}`, panelId: `${projectId}-material-panel-${file}` }));
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
        h('p', { className: 'dsh-project-muted' }, t(path === 'notes.md' ? 'notesHint' : 'preferencesHint')),
        h('textarea', { className: 'dsh-project-editor', value: text, disabled: pending, readOnly: readonly, 'aria-label': t(path === 'notes.md' ? 'userNotes' : 'preferences'), onChange: event => { setText(event.target.value); setNotice(''); } }),
        tooLong ? h('p', { role: 'alert', className: 'dsh-project-error' }, t('textTooLong')) : null,
        path === 'notes.md' ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('generatedNotes')), markdown(t, generatedText)) : null) : null,
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

  function FileDiff({ projectId, workstreamId, read, t }) {
    const [value, setValue] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      let live = true;
      read(projectId, 'diff', { workstreamId }).then(result => { if (live) setValue(result); }).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [projectId, workstreamId]);
    return h('div', { className: 'dsh-project-body' }, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error)
      : !value ? h('p', { role: 'status' }, t('loading')) : h('div', null,
        h('p', { className: 'dsh-project-muted' }, t('diffScope')),
        h('p', { className: 'dsh-project-path' }, value.worker.cwd, value.worker.branch ? ` · ${t('branch')}: ${value.worker.branch}` : ''),
        value.snapshot.files?.length ? h('ul', null, value.snapshot.files.map(file => h('li', { key: file.path, className: 'dsh-project-path' }, file.path))) : null,
        value.snapshot.truncated ? h('p', { className: 'dsh-project-muted' }, t('diffTruncated')) : null,
        value.snapshot.isGit === false ? h('p', { className: 'dsh-project-muted' }, t('notGit'))
          : value.snapshot.diff ? h('pre', { className: 'dsh-project-record' }, value.snapshot.diff) : !value.snapshot.files?.length ? h('p', { className: 'dsh-project-muted' }, t('noDiff')) : null));
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
    const title = `${t(child ? 'process' : modal.kind)}${project ? ' · ' + project.title : ''}`;
    return h(Fragment, null, h('div', { hidden: true, ref: parking }),
      modal.kind === 'materials' ? createPortal(h(Materials, { key: `${modal.projectId}:${modal.workstreamId ?? ''}:${modal.delegationRef ?? ''}`, projectId: modal.projectId, resourceRevision: detail?.revision, workstreamId: modal.workstreamId, delegationRef: modal.delegationRef, read, command, onDirtyChange: actions.setModalDirty, editorRef, readonly: detail?.project.lifecycle === 'archived' || detail?.project.archiving, showProcess: openRecords, renderFactorySlot, t }), materialsContainer) : null,
      h(Modal, { open: !materialsPreview, onClose: close, closeLabel: t(child ? 'backToResults' : 'close'), title, className: 'dsh-project-modal', contentClassName: 'dsh-project-modal-content' },
      child ? h('div', { className: 'dsh-project-context' }, h(Button, { ref: backRef, variant: 'ghost', size: 'sm', onClick: () => setChild(null) }, t('backToResults')), child.request ? h('span', { className: 'dsh-project-context-label' }, requestLabel(t, child.request)) : child.reportAt ? recordedTime(child.reportAt) : null) : null,
      modal.kind === 'materials' ? h('div', { className: 'dsh-project-materials-frame', ref: element => { materialsHost.current = element; if (element && !materialsPreview) { element.append(materialsContainer); restoreMaterialsScroll(); } } })
        : modal.kind === 'diff' ? h(FileDiff, { key: modal.workstreamId, projectId: modal.projectId, workstreamId: modal.workstreamId, read, t })
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
    inject: ['slots', 'connection', 'locale', 'uiWorkspace', 'uiSidebar', 'sidebarRight', 'sidebarRightTabs', 'workspaces', 'sessions', 'conversation', 'settingsNavigation'],
    apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-project: locale');
      ctx.effect(() => ctx.locale.register('project-team', { zh: teamChinese, en: teamEnglish }), 'dsh-project: team locale');
      const snapshot = createSnapshotStore({ projects: [], details: {}, available: false, loading: true, error: '' });
      const observerModes = createSnapshotStore({});
      const archiveRequests = new Set();
      const viewHandle = defineStore({ init: () => ({ selected: null, modal: null, modalDirty: false, pendingModal: null, modalRevision: 0, materialsPreview: false, lifecycle: null, history: false }), actions: {
        selectProject: (draft, id) => { draft.selected = id; },
        setModal: (draft, modal) => {
          if (draft.modal?.kind === modal?.kind && draft.modal?.projectId === modal?.projectId && draft.modal?.workstreamId === modal?.workstreamId && draft.modal?.workerSessionId === modal?.workerSessionId && draft.modal?.delegationRef === modal?.delegationRef) return;
          if (draft.modal?.kind === 'materials' && draft.modalDirty) { draft.materialsPreview = false; draft.pendingModal = { target: modal }; return; }
          draft.modal = modal; draft.modalDirty = false; draft.pendingModal = null; draft.materialsPreview = false; draft.modalRevision++;
        },
        suspendMaterials: (draft, projectId, revision) => { if (draft.modal?.kind === 'materials' && draft.modal.projectId === projectId && draft.modalRevision === revision) draft.materialsPreview = true; },
        returnMaterials: (draft, projectId) => { if (draft.modal?.projectId === projectId && draft.materialsPreview) { draft.materialsPreview = false; draft.modalRevision++; } },
        setLifecycle: (draft, lifecycle) => { draft.lifecycle = lifecycle; },
        setModalDirty: (draft, dirty) => { draft.modalDirty = dirty; },
        cancelModalTransition: draft => { draft.pendingModal = null; },
        completeModalTransition: draft => { if (!draft.pendingModal) return; draft.modal = draft.pendingModal.target; draft.modalDirty = false; draft.pendingModal = null; draft.materialsPreview = false; draft.modalRevision++; },
        setHistory: (draft, value) => { draft.history = value; },
      } });
      const viewInstance = viewHandle.create(), viewStore = { ...viewHandle, create: () => viewInstance };
      let alive = true, refreshing, disposeAction, trackedProject, fileReturn;
      let navigationGeneration = 0, refreshGeneration = 0;
      const detailSequences = new Map(), detailPages = new Map();
      const observerEditors = new Map();
      const observerRects = createSnapshotStore({}, { persist: { name: 'dsh-project.observer-rects.v1' } });
      const registerObserverEditor = (sessionId, tabId, editor) => {
        const key = JSON.stringify([sessionId, tabId]);
        observerEditors.set(key, editor);
        return () => {
          if (observerEditors.get(key) === editor) {
            observerEditors.delete(key);
          }
        };
      };
      ctx.effect(() => {
        const sync = () => {
          const open = new Set(ctx.sidebarRight.openTabs.getSnapshot().filter(tab => tab.kind === OBSERVER_KIND)
            .map(tab => JSON.stringify([tab.sessionId, tab.tabId])));
          const before = observerRects.getSnapshot();
          const retained = Object.fromEntries(Object.entries(before).filter(([key]) => open.has(key)));
          if (Object.keys(retained).length !== Object.keys(before).length) observerRects.set(retained);
        };
        sync();
        return ctx.sidebarRight.openTabs.subscribe(sync);
      }, 'dsh-project: retain observer frames for saved native tabs');
      ctx.effect(() => ctx.sidebarRight.registerCloseHandler(OBSERVER_KIND, (sessionId, tab, proceed) => {
        const editor = observerEditors.get(JSON.stringify([sessionId, tab.id]));
        if (!editor?.isDirty()) return;
        editor.requestClose(proceed);
        return false;
      }), 'dsh-project: preserve unsaved Project notes on panel close');
      const rpc = async (endpoint, input = {}) => {
        const response = await ctx.connection.rpc.call('/dsh-project', endpoint, input), result = response?.result ?? response;
        if (result?.ok === false) throw new Error(result.error?.message ?? result.error?.code ?? t('unavailable'));
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
        const originPanel = endpoint === 'open' && input?.path ? ctx.sidebarRight.focusedTarget(origin) : undefined;
        const scrollTop = endpoint === 'open' && input?.path && originalView.modal?.kind === 'materials' && originalView.modal.projectId === projectId
          ? document.querySelector('.dsh-project-materials-host:not([hidden]) .dsh-project-materials-content')?.scrollTop : undefined;
        const value = await rpc(endpoint, { ...input, projectId });
        if (endpoint === 'open' && input?.path) {
          if (isCurrent && !isCurrent()) return value;
          if (typeof ctx.workspaces.openPath !== 'function') throw new Error(t('unavailable'));
          const project = snapshot.getSnapshot().projects.find(item => item.id === projectId);
          await ctx.workspaces.openPath(value.canonicalPath, { sessionId: project.coordinatorSessionId, workingDirectory: value.root, presentation: 'mini' });
          if (isCurrent && !isCurrent()) return value;
          if (originPanel?.sessionId === project.coordinatorSessionId && ctx.sidebarRight.mounted.getSnapshot() === project.coordinatorSessionId && originPanel.host === 'float'
            && ctx.sidebarRight.tabsIn(project.coordinatorSessionId).some(tab => tab.id === originPanel.tabId && tab.kind === OBSERVER_KIND)) {
            const panel = observerEditors.get(JSON.stringify([project.coordinatorSessionId, originPanel.tabId]))?.getPanel();
            if (panel?.id === originPanel.paneId) resizeObserver(project.coordinatorSessionId, panel, originPanel.tabId, 'strip');
          }
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
        disposeAction = ctx.uiWorkspace.registerDirectoryAction({ id: NS, label: t('add'), order: 20, adopt: async path => {
          const result = await rpc('create', { workingDirectory: path, requestId: requestId() });
          acceptDetail({ project: result.project }); await openProject(result.project.id);
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
            snapshot.set({ ...previous, projects: result.projects, available: result.available === true, loading: false, error: result.error ?? previous.error });
            if (previous.available !== (result.available === true)) registerAction();
            if (trackedProject && result.projects.some(project => project.id === trackedProject)) await readDetail(trackedProject, true);
          } catch (failure) { if (alive) snapshot.set({ ...snapshot.getSnapshot(), loading: false, error: errorText(failure) }); }
          finally { refreshing = undefined; }
        })();
        return refreshing;
      };
      const openProject = async projectId => {
        const navigation = ++navigationGeneration;
        try {
          const detail = await readDetail(projectId);
          if (!alive || navigation !== navigationGeneration) return;
          viewInstance.actions.selectProject(projectId); ctx.uiSidebar.selectTab('sessions'); ctx.uiWorkspace.openSession(detail.project.coordinatorSessionId);
        } catch (failure) { if (alive && navigation === navigationGeneration) snapshot.set({ ...snapshot.getSnapshot(), error: errorText(failure) }); }
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
      const openObserver = projectId => {
        const project = snapshot.getSnapshot().projects.find(item => item.id === projectId);
        if (!project) return false;
        const existing = ctx.sidebarRight.tabsIn(project.coordinatorSessionId).find(tab => tab.kind === OBSERVER_KIND);
        if (existing) {
          ctx.sidebarRight.focus(existing.id);
          const panel = observerEditors.get(JSON.stringify([project.coordinatorSessionId, existing.id]))?.getPanel();
          if (panel?.host === 'float' && panel.rect?.height <= 38) resizeObserver(project.coordinatorSessionId, panel, existing.id, 'full');
          return true;
        }
        return ctx.sidebarRight.openTabIn(project.coordinatorSessionId, OBSERVER_KIND, { expand: false, floating: observerRect('full') });
      };
      const resizeObserver = (sessionId, panel, tabId, mode, remember = true) => {
        // Pane ids are local to a Session; retained background bodies cannot resize the foreground one.
        if (ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return;
        // Desktop boot mounts Harness at 0x0 until reveal; do not save that temporary viewport.
        if (window.innerWidth === 0 || window.innerHeight === 0) return;
        const key = JSON.stringify([sessionId, tabId]), previous = observerRects.getSnapshot()[key];
        const current = panel.host === 'float' ? panel.rect : undefined;
        const unchanged = current && previous?.paneId === panel.id
          && ['x', 'y', 'width', 'height'].every(field => current[field] === previous.applied[field]);
        // Viewport fits only change the displayed frame; a real user gesture replaces the preferred frame.
        const fullHeight = previous?.paneId === panel.id ? previous.preferred.height : 520;
        const preferred = unchanged ? previous.preferred : current ? {
          ...current, height: panelMode(panel) === 'strip' ? fullHeight : current.height,
        } : undefined;
        const rect = observerRect(mode, preferred);
        observerRects.set({ ...observerRects.getSnapshot(), [key]: { paneId: panel.id, preferred: preferred ?? rect, applied: rect } });
        if (remember || panel.host === 'float' && panelMode({ ...panel, rect }) !== mode) {
          const modes = observerModes.getSnapshot();
          observerModes.set({ ...modes, [sessionId]: { ...modes[sessionId], [panel.id]: mode } });
        }
        if (panel.host === 'float') ctx.sidebarRight.resizeFloat(panel.id, rect);
        else if (tabId) ctx.sidebarRight.float(tabId, rect);
      };
      const face = () => ({ hooks: { projects: snapshot, projectSessions: ctx.sessions.list, projectView: viewInstance, observerModes, sidebarMounted: ctx.sidebarRight.mounted }, read, command, refresh, openProject, openLifecycle, readDetail, sendUserRequest, getFileReturn: () => fileReturn, teamT: ctx.locale.bind('project-team'),
        openObserver, resizeObserver, registerObserverEditor,
        trackActiveProject: projectId => { trackedProject = projectId; return () => { if (trackedProject === projectId) trackedProject = undefined; }; },
        openModelSettings: () => ctx.settingsNavigation.open('models'),
        addProject: async () => { try { const path = await ctx.uiWorkspace.selectDirectory(); if (!path) return; const result = await rpc('create', { workingDirectory: path, requestId: requestId() }); acceptDetail({ project: result.project }); await openProject(result.project.id); } catch (failure) { snapshot.set({ ...snapshot.getSnapshot(), error: errorText(failure) }); } },
        showMaterials: (projectId, workstreamId, context) => { const view = viewInstance.getSnapshot(); if (!workstreamId && view.materialsPreview && view.modal?.projectId === projectId) viewInstance.actions.returnMaterials(projectId); else show('materials', projectId, workstreamId, context); }, showProcess: (projectId, workstreamId, member = false, context = {}) => { viewInstance.actions.setModal({ kind: 'process', projectId, ...(member ? { workerSessionId: workstreamId } : { workstreamId }), ...context }); }, showDiff: (projectId, workstreamId) => show('diff', projectId, workstreamId),
        trackProject: projectId => { trackedProject = projectId; return () => { if (trackedProject === projectId) trackedProject = undefined; }; },
        retainProcess: (project, work) => ctx.sessions.retain({ parentSessionId: project.coordinatorSessionId, childSessionId: work.workerSessionId, mode: 'continuable' }, { source: 'projectPreview' }),
      });
      ctx.effect(() => ctx.sidebarRightTabs.register({ id: OBSERVER_TAB, kind: OBSERVER_KIND, priority: 'extension', title: () => t('tab'), keepMounted: true, floatingOnly: true, showCloseButton: false }), 'dsh-project: observer tab type');
      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: OBSERVER_TAB, locale: NS,
        inject: sessionId => ({ ...face(), sessionId }) }, ProjectObserver));
      ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: OBSERVER_TAB, locale: NS,
        inject: sessionId => ({ ...face(), sessionId }) }, ProjectObserverTitle));
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
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: NS, locale: NS, inject: face }, ProjectHeader));
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: NS, order: 30, locale: NS, inject: face }, ProjectStop));
      ctx.slots.inject('conversation.approval.actions', () => ctx.slots.register({ name: 'conversation.approval.actions', id: NS, locale: NS, inject: face }, ProjectApprovalStop));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS, locale: NS, store: viewStore, inject: face }, ProjectOverlay));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS + '-lifecycle', locale: NS, store: viewStore, inject: face }, ProjectLifecycleDialog));
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
