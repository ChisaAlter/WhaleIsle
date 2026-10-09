window.__ModuleLoader__.load({ id: 'dsh-project', factory: (require) => {
  const { createElement: h, useState, useEffect, useLayoutEffect, useRef, Fragment } = require('react');
  const { Button, Input, Menu, Modal, Pill, SegmentedTabs, MarkdownText, TaskDock, IconFolderCloseRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
  const { createSnapshotStore, defineStore } = require('@deepseek-ai/dsh-client-store');
  const { TeamAction, teamEnglish, teamChinese } = require('@deepseek-ai/dsh-experimental-client-ui-agent-team');
  const NS = 'dsh-project';
  const zh = {
    diffTruncated: '差异过长，仅显示前一部分；请打开目录查看完整改动。', tab: 'Project', more: '更多', rename: '重命名', cancel: '取消', archiveActive: '停止后台工作并归档', archiveHint: '后台工作会停止，工作目录、对话和成果将保留。', team: '团队', add: '添加 Project…', loading: '正在读取…', close: '关闭', refresh: '刷新',
    archivedHint: '项目已归档。恢复后可继续对话，旧工作不会自动启动。', archiving: '正在停止后台工作并归档…', queued: '排队中', empty: '从新建对话的工作目录菜单添加 Project。', archived: '已归档', history: '显示归档项目',
    directory: 'Project 工作目录', openDirectory: '打开项目目录', materials: '项目资料', progress: '工作进度',
    noWork: '在这里提出需求，后续可以继续同一项工作。', process: '成员记录', viewProcess: '查看记录', viewResult: '查看成果', workDetails: '详情', executionInfo: '执行信息', earlierWork: '更早工作',
    processHint: '需要调整这项工作时，在主对话中继续说明。', noProcess: '暂无记录。',
    older: '更早记录', workRequest: '工作要求', teamMessage: '团队消息',
    newer: '最新记录', previous: '更早一页', next: '更新一页', assistant: '助手', tool: '工具',
    result: '结果', failed: '失败', open: '等待工作', running: '进行中', blocked: '需要处理', done: '已完成',
    provisioning: '正在准备', active: '执行中', idle: '空闲', stopping: '正在停止', paused: '已停止',
    pause: '暂停后台工作', resume: '解除暂停', resumeHint: '在主对话中提出新的要求，即可继续原工作。',
    stop: '停止后台工作', stopWork: '停止这项工作', archive: '归档项目', restore: '恢复项目',
    notes: '笔记', preferences: '项目要求', docs: '全部文档', allResults: '全部成果', noDocs: '暂无项目文档。', noResults: '完成工作后，成果会保存在这里。',
    generatedNotes: '工作记录', userNotes: '项目笔记', remainingIssues: '待处理事项', reportDetails: '报告详情', reportSource: '成员报告',
    notesHint: '记录你希望保留的背景和想法。', preferencesHint: '设置本项目的长期约定，例如代码风格、测试命令和交付要求；后续明确要求优先。',
    storeHint: '查看项目成果，管理此项目的笔记与长期偏好。', save: '保存', saved: '已保存', saveFailed: '修改尚未保存，你可以重试或继续编辑。', materialsError: '操作未完成，请查看错误详情。',
    workResults: '成果', resultHistory: '历史报告', currentResult: '最新成果', previousResult: '上一轮成果', completed: '已完成', modifiedArtifact: '文件在报告后发生了变化，当前打开的是最新内容。', archivedMaterials: '恢复项目后可编辑笔记和项目要求。',
    openFile: '打开文件', fileMore: '文件操作', diff: '当前目录改动', diffScope: '可能包含原有改动及其他工作的修改。',
    fileLocation: '文件位置', artifactMaterials: '项目资料', artifactExisting: '项目目录', artifactWorktree: '独立分支', errorDetails: '错误详情', modelSettings: '模型设置',
    summaryCredentialHint: '当前模型未配置凭据。请补充凭据，或在输入框选择已配置的模型，再重新汇总。', summaryErrorHint: '本次汇总未完成。请查看错误详情，处理原因后重新汇总。', sidebarSummaryFailed: '汇总失败', sidebarPendingSummary: '等待汇总',
    noDiff: '当前没有文件差异。', branch: '分支', readonly: '查看项目文件，不修改文件', docsScope: '修改已授权的文档', developmentScope: '执行已授权的开发工作', worktree: '独立分支', existing: '项目目录',
    copy: '复制', copied: '已复制', footnotes: '脚注', unavailable: 'Project 暂不可用',
    evidence: '验证记录', pendingSummary: '正在汇总', summaryFailed: '成果已保存，汇总未完成', retrySummary: '重新汇总', resultUpdated: '结果已更新，请查看最新结果。',
    retrySummaryPrompt: '请重新汇总以下已保存结果，说明成果、验证和剩余问题；只读取已有报告，不重新执行后台工作：', waitingDependencies: '等待前置工作完成', waitingDirectory: '等待其他工作释放目录', waitingCapacity: '等待团队空出执行名额', prerequisitesChanged: '依据已变化', prerequisitesHint: '前置工作已收到新要求。这份报告仍保留原有结果；如需重新验证，请在主对话中提出。',
    notGit: '当前目录不是 Git 仓库，无法读取 Git 差异。', unsaved: '修改尚未保存', discard: '放弃修改', saveAndSwitch: '保存并切换', discardAndSwitch: '放弃并切换', keepEditing: '继续编辑', saveBeforeSwitch: '是否保存修改，再切换页面？',
  };
  const en = {
    diffTruncated: 'The diff is truncated. Open the directory for the complete changes.', tab: 'Project', more: 'More', rename: 'Rename', cancel: 'Cancel', archiveActive: 'Stop work and archive', archiveHint: 'Background work will stop. Files, conversation and results are retained.', team: 'Team', add: 'Add Project…', loading: 'Loading…', close: 'Close', refresh: 'Refresh',
    archivedHint: 'This Project is archived. Restore it to continue; previous work will not restart automatically.', archiving: 'Stopping work and archiving…', queued: 'Queued', empty: 'Add a Project from the working-directory menu in New Conversation.', archived: 'Archived', history: 'Show archived projects',
    directory: 'Project working directory', openDirectory: 'Open project directory', materials: 'Project materials', progress: 'Work progress',
    noWork: 'Describe what you need here, and continue the same work later.', process: 'Member history', viewProcess: 'View history', viewResult: 'View results', workDetails: 'Details', executionInfo: 'Execution details', earlierWork: 'Earlier work',
    processHint: 'Continue in the main conversation to request changes to this work.', noProcess: 'No records yet.',
    older: 'Earlier records', workRequest: 'Assignment', teamMessage: 'Team message',
    newer: 'Latest records', previous: 'Earlier page', next: 'Later page', assistant: 'Assistant', tool: 'Tool',
    result: 'Result', failed: 'Failed', open: 'Waiting for work', running: 'In progress', blocked: 'Needs attention', done: 'Done',
    provisioning: 'Preparing', active: 'Running', idle: 'Idle', stopping: 'Stopping', paused: 'Stopped',
    pause: 'Pause background work', resume: 'Unpause', resumeHint: 'Give a new instruction in the main conversation to continue the original work.',
    stop: 'Stop background work', stopWork: 'Stop this work', archive: 'Archive project', restore: 'Restore project',
    notes: 'Notes', preferences: 'Project instructions', docs: 'All documents', allResults: 'All results', noDocs: 'No Project documents yet.', noResults: 'Results will be saved here when work is completed.',
    generatedNotes: 'Work history', userNotes: 'Project notes', remainingIssues: 'Open issues', reportDetails: 'Report details', reportSource: 'Member report',
    notesHint: 'Keep the background and ideas you want to remember.', preferencesHint: 'Set this Project’s standing instructions, such as code style, test commands and delivery requirements. Later explicit requests take precedence.',
    storeHint: 'View results and manage this Project’s notes and preferences.', save: 'Save', saved: 'Saved', saveFailed: 'Changes are not saved. Retry or keep editing.', materialsError: 'The operation did not finish. Review the error details.',
    workResults: 'Results', resultHistory: 'Earlier reports', currentResult: 'Latest result', previousResult: 'Previous result', completed: 'Completed', modifiedArtifact: 'The file changed after this report. The preview shows its latest content.', archivedMaterials: 'Restore the Project to edit notes and instructions.',
    openFile: 'Open file', fileMore: 'File actions', diff: 'Current directory changes', diffScope: 'May include pre-existing changes and changes from other work.',
    fileLocation: 'File location', artifactMaterials: 'Project materials', artifactExisting: 'Project directory', artifactWorktree: 'Independent branch', errorDetails: 'Error details', modelSettings: 'Model settings',
    summaryCredentialHint: 'The current model has no credentials. Add credentials or choose a configured model in the composer, then summarize again.', summaryErrorHint: 'The summary did not finish. Review the error details, address the cause, then summarize again.', sidebarSummaryFailed: 'Summary failed', sidebarPendingSummary: 'Awaiting summary',
    noDiff: 'There are no current file changes.', branch: 'Branch', readonly: 'Inspect Project files without modifying them', docsScope: 'Edit authorized documents', developmentScope: 'Perform authorized development', worktree: 'Independent branch', existing: 'Project directory',
    copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes', unavailable: 'Project is currently unavailable',
    evidence: 'Verification records', pendingSummary: 'Preparing summary', summaryFailed: 'Results saved; summary incomplete', retrySummary: 'Summarize again', resultUpdated: 'The result changed. View the latest result.',
    retrySummaryPrompt: 'Summarize the following saved result again, including changes, verification and remaining issues. Read the existing report without rerunning background work:', waitingDependencies: 'Waiting for prerequisite work', waitingDirectory: 'Waiting for other work to release the directory', waitingCapacity: 'Waiting for an available team slot', prerequisitesChanged: 'Prerequisites changed', prerequisitesHint: 'Prerequisite work has received a new request. This report retains the original result. Request revalidation in the main conversation if needed.',
    notGit: 'This directory is not a Git repository; Git changes are unavailable.', unsaved: 'Unsaved changes', discard: 'Discard changes', saveAndSwitch: 'Save and switch', discardAndSwitch: 'Discard and switch', keepEditing: 'Keep editing', saveBeforeSwitch: 'Save your changes before switching pages?',
  };
  Object.assign(zh, { delivery: '主对话交付', deliveryVersion: '要求版本', pendingSummary: '待交付', delivered: '本轮已交付', back: '返回成果位置', supportingReports: '成员依据', partial: '部分交付', needsReview: '要求或依据已变化，待复核', round: '执行轮次', locating: '正在定位原执行记录…', missingRound: '原执行输入尚未找到；未改用其他轮次的记录。' });
  Object.assign(en, { delivery: 'Delivered in conversation', deliveryVersion: 'Requirement version', pendingSummary: 'Awaiting delivery', delivered: 'Delivered this round', back: 'Return to results', supportingReports: 'Supporting reports', partial: 'Partial delivery', needsReview: 'Requirement or evidence changed; review needed', round: 'Execution round', locating: 'Locating the original execution…', missingRound: 'The original assignment was not found; no other execution was substituted.' });
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
    .dsh-project-modal,.dsh-project-confirm{background:var(--dsw-alias-bg-panel-solid)}.dsh-project-modal{width:min(760px,calc(100vw - 32px))}.dsh-project-modal-content{max-height:80vh;overflow:hidden}.dsh-project-modal-content>:first-child{flex-shrink:0}.dsh-project-modal-content>:last-child{min-height:0;overflow:auto}
    .dsh-project-editor{width:100%;min-height:240px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:1.6;box-sizing:border-box}
    .dsh-project-materials{min-height:0;overflow:hidden!important}.dsh-project-materials-tabs{flex-shrink:0}.dsh-project-materials-content{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px}.dsh-project-materials-footer{flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;gap:12px}.dsh-project-materials-footer>.dsh-project-muted{flex:1}
    .dsh-project-result{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2);min-width:0}.dsh-project-result:first-child{padding-top:0}.dsh-project-result-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0}.dsh-project-result-heading strong{min-width:0;overflow-wrap:anywhere}.dsh-project-result-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-project-result-body{display:flex;flex-direction:column;gap:8px;min-width:0}.dsh-project-result-disclosure>summary,.dsh-project-documents>summary{cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary)}.dsh-project-result-disclosure[open]>summary{margin-bottom:8px}.dsh-project-result-details{display:flex;flex-direction:column;gap:8px}.dsh-project-work-detail-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-project-empty{margin:0;padding:4px 12px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center;line-height:1.5}
    .dsh-project-record{font:12px/1.6 monospace;white-space:pre;overflow:auto;padding:10px;background:var(--dsw-alias-markdown-code-block);border-radius:12px;max-height:320px}
    .dsh-project-record-row{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.dsh-project-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
  `;
  const requestId = () => globalThis.crypto.randomUUID();
  const button = (label, onClick, disabled = false) => h(Button, { variant: 'outline', onClick, disabled }, label);
  const markdown = (t, text) => h(MarkdownText, { text, labels: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') } });
  const stateLabel = (t, state) => Object.hasOwn(zh, state) ? t(state) : String(state ?? '');
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

  function ProjectRow({ project, directoryLabel, currentSession, openProject, command, read, readDetail, t }) {
    const [menu, setMenu] = useState(false), [dialog, setDialog] = useState(null), [title, setTitle] = useState(project.title);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const execute = async (action, input) => { setBusy(true); setError(''); try { await command(project.id, action, input); setDialog(null); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    const select = async action => {
      setMenu(false); setError('');
      if (action === 'rename') { setTitle(project.title); setDialog('rename'); return; }
      try {
        if (action === 'openDirectory') { await read(project.id, 'open'); return; }
        if (action === 'archive') { const detail = await readDetail(project.id), activity = detail.project.activity; if (activity?.coordinatorRunning || activity?.running || activity?.queued || activity?.provisioning || activity?.state === 'stopping') { setDialog('archive'); return; } }
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
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
      h(Modal, { open: dialog !== null, onClose: () => { if (!busy) setDialog(null); }, closeLabel: t('cancel'), className: 'dsh-project-confirm', title: t(dialog === 'rename' ? 'rename' : 'archiveActive'), footer: h('div', { className: 'dsh-project-actions' }, button(t('cancel'), () => setDialog(null), busy), button(t(dialog === 'rename' ? 'save' : 'archiveActive'), () => execute(dialog, dialog === 'rename' ? { title } : undefined), busy || dialog === 'rename' && !title.trim())) },
        dialog === 'rename' ? h(Input, { value: title, maxLength: 240, 'aria-label': t('rename'), onChange: event => setTitle(event.target.value) }) : h('p', null, t('archiveHint'))));
  }

  function SidebarPage({ query = '', useProjects, useProjectSessions, useStore, actions, openProject, command, read, readDetail, addProject, t }) {
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
        h('div', { className: 'dsh-project-list' }, projects.map(project => h(ProjectRow, { key: project.id, project, directoryLabel: projectDirectoryLabel(project, projects), currentSession, openProject, command, read, readDetail, t })))) : null);
  }

  function ProjectHeader({ sessionId, useProjects, showMaterials, showProcess, teamT, useSession, useSessions, useSessionStatus, t }) {
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    if (!project) return null;
    return h('div', { className: 'dsh-project-header' },
      h(TeamAction, { sessionId, useSession, useSessions, useSessionStatus, t: teamT, openTeammate: (_parent, child) => { showProcess(project.id, child, true); } }),
      h(Button, { variant: 'ghost', size: 'sm', onClick: () => showMaterials(project.id) }, t('materials')));
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
    const state = worker?.phase === 'stopping' ? 'stopping' : worker?.phase === 'failed' ? 'failed' : worker?.stopped && work.status !== 'done' ? 'paused' : worker && isLive(worker) ? 'running' : work.delegation?.phase === 'queued' ? 'queued' : work.delegation?.phase === 'preparing' ? 'provisioning' : work.status === 'running' ? 'running' : work.summaryFailure ? 'sidebarSummaryFailed' : work.pendingSummary && !worker?.stopped && !paused ? 'pendingSummary' : work.status;
    return h('div', { className: 'dsh-project-work', 'data-workstream-id': work.id },
      h('div', { className: 'dsh-project-heading dsh-project-work-heading' }, h('strong', { title: work.title }, work.title), h(Pill, null, stateLabel(t, state))),
      worker?.error || !worker?.stopped && work.blockedReason && work.blockedReason !== 'stopped' ? h('p', { className: 'dsh-project-error' }, worker?.error || work.blockedReason) : null,
      work.delegation?.phase === 'queued' ? h('p', { className: 'dsh-project-muted' }, waiting ? `${t({ dependencies: 'waitingDependencies', directory: 'waitingDirectory', capacity: 'waitingCapacity' }[waiting.kind])}${waiting.workTitles.length ? ` · ${waiting.workTitles.join('、')}` : ''}` : t('queued')) : null,
      work.summaryFailure ? h(SummaryFailure, { failure: work.summaryFailure, openModelSettings, t }) : null,
      work.prerequisitesChanged ? h('p', { className: 'dsh-project-muted', title: t('prerequisitesHint') }, t('prerequisitesChanged')) : null,
      h('div', { className: 'dsh-project-actions' }, work.hasReport ? h(Button, { variant: 'ghost', size: 'sm', onClick: () => showMaterials(projectId, work.id) }, t('viewResult')) : null,
        work.summaryFailure ? button(t('retrySummary'), () => retrySummary(work), busy) : null,
        worker && !worker.stopped && (isLive(worker) || ['queued', 'preparing'].includes(work.delegation?.phase)) ? button(t('stopWork'), () => act('stop', { workstreamId: work.id }), busy) : null),
      h('details', { className: 'dsh-project-work-details', open: expanded, onToggle: event => setExpanded(event.currentTarget.open) }, h('summary', null, t('workDetails')),
        expanded ? h('div', { className: 'dsh-project-work-detail-body' },
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

  function WorkHistory({ projectId, cursor, count, revision, read, renderWork, t }) {
    const [open, setOpen] = useState(false), [cursors, setCursors] = useState([cursor]), [page, setPage] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const selected = cursors.at(-1);
    useEffect(() => { if (!open) setCursors([cursor]); }, [cursor, open]);
    useEffect(() => {
      if (!open) return;
      if (page?.revision === revision && page.cursor === (selected ?? null)) return;
      let live = true; setError(''); setBusy(true);
      void read(projectId, 'workstreams/list', { kind: 'history', ...(selected ? { cursor: selected } : {}) }).then(value => {
        if (!live) return;
        setPage({ ...value, revision });
        if (selected && value.cursor === null) setCursors([null]);
      }).catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setBusy(false); });
      return () => { live = false; };
    }, [open, projectId, selected, revision]);
    return h('details', { className: 'dsh-project-work-history', open, onToggle: event => setOpen(event.currentTarget.open) }, h('summary', null, `${t('earlierWork')} (${count})`),
      open ? h(Fragment, null, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : busy || !page ? h('p', { role: 'status' }, t('loading')) : null,
        page?.workstreams.map(work => renderWork({ work, worker: page.workers.find(worker => worker.sessionId === work.workerSessionId) })),
        h('div', { className: 'dsh-project-actions' }, cursors.length > 1 ? button(t('previous'), () => setCursors(before => before.slice(0, -1)), busy) : null,
          page?.nextCursor ? button(t('next'), () => setCursors(before => [...before, page.nextCursor]), busy) : null)) : null);
  }

  function ProjectProgress({ sessionId, useProjects, trackProject, readDetail, command, read, sendUserRequest, openModelSettings, showProcess, showDiff, showMaterials, t }) {
    const snapshot = useProjects(value => value), project = snapshot.projects.find(item => item.coordinatorSessionId === sessionId);
    const detail = project ? snapshot.details[project.id] : undefined;
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [currentCursors, setCurrentCursors] = useState([]);
    useEffect(() => {
      if (!project) return;
      let live = true;
      setError(''); setNotice(''); setCurrentCursors([]);
      const stopTracking = trackProject(project.id);
      void readDetail(project.id).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; stopTracking(); };
    }, [project?.id]);
    if (!project) return null;
    const act = async (endpoint, input = {}, reading = false) => {
      setBusy(true); setError(''); setNotice('');
      try { const value = await (reading ? read : command)(project.id, endpoint, input); if (value.modifiedSinceReport) setNotice(t('modifiedArtifact')); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
    };
    const retrySummary = async work => {
      setBusy(true); setError('');
      try {
        const { workstream } = await read(project.id, 'workstreams/get', { workstreamId: work.id });
        const report = workstream.latestReport, failure = workstream.summaryFailure;
        const terminal = workstream.recentSettlements?.find(item => item.runId === failure?.runId && item.delegationRefs.includes(failure.delegationRef));
        if (failure?.delegationRef !== work.summaryFailure.delegationRef || !(report?.delegationRef === failure.delegationRef || terminal)) throw new Error(t('resultUpdated'));
        await sendUserRequest(project.id, `${t('retrySummaryPrompt')}\n${workstream.title} · ${new Date((report ?? terminal).at).toISOString()}`);
      } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
    };
    if (project.lifecycle === 'archived' || project.archiving) return null;
    const works = detail?.workstreams ?? [];
    if (!works.length && !project.requestsTotal && !error && !project.diagnostics?.length) return detail && !detail.workPage?.currentTotal && !detail.workPage?.historyTotal ? h('p', { className: 'dsh-project-empty' }, t('noWork')) : null;
    const rows = works.map(work => ({ work, worker: detail.workers.find(item => item.sessionId === work.workerSessionId) }));
    const current = rows.filter(row => row.work.group === 'current'), previous = rows.filter(row => row.work.group === 'history');
    const activeCount = project.activity?.running ?? 0, attention = project.activity?.blocked ?? 0;
    const paused = project.paused || project.activity?.state === 'paused';
    const activity = project.activity;
    const summary = activity?.state === 'stopping' ? t('stopping') : activity?.state === 'blocked' ? (attention ? attention + ' · ' : '') + t('blocked') + (activeCount ? ' · ' + activeCount + ' · ' + t('running') : '') : activity?.state === 'summaryFailed' ? t('summaryFailed') + (activeCount ? ' · ' + activeCount + ' · ' + t('running') : '') : activity?.state === 'done' ? t(project.requestsTotal ? 'delivered' : 'done') : paused ? t('paused') : activeCount ? activeCount + ' · ' + t('running') : activity?.provisioning ? t('provisioning') : activity?.coordinatorRunning ? t('running') : activity?.queued ? activity.queued + ' · ' + t('queued') : activity?.state === 'pendingSummary' ? t('pendingSummary') : t('open');
    const renderWork = ({ work, worker }) => h(WorkProgressItem, { key: work.id, projectId: project.id, work, worker, paused, act, read, retrySummary, openModelSettings, showProcess, showDiff, showMaterials, busy, t });
    const changeCurrentPage = async (cursor, previousPage = false) => {
      setBusy(true); setError('');
      try { const value = await readDetail(project.id, false, cursor); setCurrentCursors(before => value.workPage?.currentCursor ? previousPage ? before.slice(0, -1) : [...before, detail.workPage?.currentCursor ?? null] : []); }
      catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
    };
    return h(TaskDock, { key: project.id, title: t('progress'), testId: 'project-progress', summary: detail?.workPage?.currentTotal === 1 ? `${current[0]?.work.title ?? ''} · ${summary}` : summary },
      h('div', { className: 'dsh-project-progress' },
        project.requests?.slice(0, 20).map(request => h('div', { key: request.id }, h('strong', null, request.goal), h('p', { className: 'dsh-project-muted' }, `${t('deliveryVersion')} ${request.version} · ${request.delivery?.needsReview ? t('needsReview') : request.delivery ? t(request.delivery.outcome === 'completed' ? 'delivered' : request.delivery.outcome) : t('pendingSummary')}`))),
        activeCount ? h('div', { className: 'dsh-project-actions' }, button(t('stop'), () => act('stop'), busy)) : null,
        paused ? h('p', { className: 'dsh-project-muted' }, t('resumeHint')) : null,
        !detail ? h('p', { role: 'status' }, t('loading')) : !works.length && !project.requestsTotal ? h('p', { className: 'dsh-project-muted' }, t('noWork')) : null,
        current.map(renderWork),
        h('div', { className: 'dsh-project-actions' }, detail?.workPage?.currentCursor ? button(t('previous'), () => changeCurrentPage(currentCursors.at(-1) ?? null, true), busy) : null,
          detail?.workPage?.currentNextCursor ? button(t('next'), () => changeCurrentPage(detail.workPage.currentNextCursor), busy) : null),
        previous.map(renderWork),
        detail?.workPage?.historyTotal > previous.length ? h(WorkHistory, { key: project.id, projectId: project.id, cursor: previous.at(-1)?.work.id, count: detail.workPage.historyTotal - previous.length, revision: detail.revision, read, renderWork, t }) : null,
        project.diagnostics?.map((notice, index) => h('p', { key: index, className: 'dsh-project-muted' }, typeof notice === 'string' ? notice : notice.message)),
        notice ? h('p', { role: 'status', className: 'dsh-project-muted' }, notice) : null, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null));
  }

  function ProjectStop({ sessionId, useProjects, command, t, compact = true }) {
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    if (!project || project.lifecycle !== 'ready' || project.archiving || compact && project.activity?.coordinatorRunning || !(project.activity?.running || project.activity?.queued || project.activity?.provisioning || !compact && project.activity?.coordinatorRunning || project.activity?.state === 'stopping') && !error) return null;
    const stop = async () => { setBusy(true); setError(''); try { await command(project.id, 'stop'); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    return h(Fragment, null, h(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('stop'), title: error || t('stop'), disabled: busy || project.activity?.state === 'stopping', onClick: stop }, compact ? '■' : t('stop')), error ? h('span', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  const ProjectApprovalStop = props => h(ProjectStop, { ...props, compact: false });

  function ResultCard({ projectId, workstreamId, report, read, t }) {
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const open = async path => { setError(''); setNotice(''); setBusy(true); try { const value = await read(projectId, 'open', { workstreamId, delegationRef: report.delegationRef, path }); if (value.modifiedSinceReport) setNotice(t('modifiedArtifact')); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    return h('div', { className: 'dsh-project-result-body' }, h('div', { className: 'dsh-project-result-meta' }, h(Pill, null, stateLabel(t, report.outcome)), h('time', { className: 'dsh-project-muted', dateTime: new Date(report.at).toISOString() }, new Date(report.at).toLocaleString()), h('span', { className: 'dsh-project-muted' }, t('reportSource'))),
      markdown(t, report.summary),
      report.prerequisitesChanged ? h('p', { className: 'dsh-project-muted' }, t('prerequisitesChanged'), ' · ', t('prerequisitesHint')) : null,
      report.artifacts?.map(file => h(Artifact, { key: file.path, file, open, busy, t })),
      h('details', { className: 'dsh-project-result-disclosure', open: report.outcome !== 'completed' || Boolean(report.remainingIssues?.length) }, h('summary', null, t('reportDetails')),
        h('div', { className: 'dsh-project-result-details' },
          report.evidence?.length ? h('details', null, h('summary', null, t('evidence')), h('ul', null, report.evidence.map((item, index) => h('li', { key: index }, item)))) : null,
          report.remainingIssues?.length ? h('div', null, h('strong', null, t('remainingIssues')), h('ul', null, report.remainingIssues.map((item, index) => h('li', { key: index }, item)))) : null)),
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
      history?.items.filter(report => report.delegationRef !== result.report.delegationRef).map(report => h('div', { key: report.delegationRef }, h(ResultCard, { projectId, workstreamId: result.workstreamId, report, read, t }), button(t('viewProcess'), () => showProcess(projectId, result.workstreamId, false, { delegationRef: report.delegationRef })))),
      busy ? h('p', { role: 'status' }, t('loading')) : null, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
      h('div', { className: 'dsh-project-actions' }, cursors.length > 1 ? button(t('previous'), () => setCursors(before => before.slice(0, -1)), busy) : null,
        history?.nextCursor ? button(t('older'), () => setCursors(before => [...before, history.nextCursor]), busy) : null)) : null);
  }

  function ResultEntry({ projectId, result, read, showProcess, t }) {
    return h('article', { className: 'dsh-project-result', 'data-result-workstream-id': result.workstreamId },
      h('div', { className: 'dsh-project-result-heading' }, h('strong', null, result.title), h('span', { className: 'dsh-project-muted' }, t(result.current ? 'currentResult' : 'previousResult'))),
      h(ResultCard, { projectId, workstreamId: result.workstreamId, report: result.report, read, t }),
      h('div', { className: 'dsh-project-work-detail-actions' }, h(Button, { variant: 'ghost', size: 'sm', onClick: () => showProcess(projectId, result.workstreamId, false, { delegationRef: result.report.delegationRef }) }, t('viewProcess'))),
      result.reportCount > 1 ? h(ResultHistory, { key: result.report.delegationRef, projectId, result, read, showProcess, t }) : null);
  }
  function DeliveryEntry({ projectId, delivery, read, showProcess, t }) {
    const [error, setError] = useState(''), [notice, setNotice] = useState('');
    const open = async (result, path) => { setError(''); setNotice(''); try { const value = await read(projectId, 'open', { workstreamId: result.workstreamId, delegationRef: result.report.delegationRef, path }); if (value.modifiedSinceReport) setNotice(t('modifiedArtifact')); } catch (failure) { setError(errorText(failure)); } };
    return h('article', { className: 'dsh-project-result', 'data-delivery-id': delivery.id },
      h('div', { className: 'dsh-project-result-heading' }, h('strong', null, delivery.title), h(Pill, null, t(delivery.outcome))),
      h('p', { className: 'dsh-project-muted' }, t('delivery'), ` · ${t('deliveryVersion')} ${delivery.requestVersion} · ${new Date(delivery.committedAt).toLocaleString()}`),
      markdown(t, delivery.summary), delivery.needsReview ? h('p', { className: 'dsh-project-muted' }, t('needsReview')) : null,
      delivery.remainingIssues.length ? h('div', null, h('strong', null, t('remainingIssues')), h('ul', null, delivery.remainingIssues.map((issue, index) => h('li', { key: index }, issue)))) : null,
      delivery.evidence.length ? h('details', null, h('summary', null, t('evidence')), h('ul', null, delivery.evidence.map((item, index) => h('li', { key: index }, item)))) : null,
      delivery.reports.map(result => h('div', { key: result.report.delegationRef }, result.report.artifacts.map(file => h(Artifact, { key: file.path, file, t, open: path => open(result, path) })),
        h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, result.title, ' · ', t('supportingReports')), h(ResultCard, { projectId, workstreamId: result.workstreamId, report: result.report, read, t }), button(t('viewProcess'), () => showProcess(projectId, result.workstreamId, false, delivery.references.find(ref => ref.workstreamId === result.workstreamId && ref.delegationRef === result.report.delegationRef)))))),
      notice ? h('p', { role: 'status', className: 'dsh-project-muted' }, notice) : null, error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null);
  }

  function Materials({ projectId, workstreamId, read, command, onDirtyChange, readonly, showProcess, t }) {
    const [listing, setListing] = useState(null), [path, setPath] = useState('docs'), [text, setText] = useState('');
    const [loadedPath, setLoadedPath] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [savedText, setSavedText] = useState(''), [generatedText, setGeneratedText] = useState('');
    const [resultCursors, setResultCursors] = useState([null]), resultsCursor = resultCursors.at(-1);
    const [deliveryCursors, setDeliveryCursors] = useState([null]), deliveryCursor = deliveryCursors.at(-1);
    const [selectedWork, setSelectedWork] = useState(workstreamId), [selectedResult, setSelectedResult] = useState(null), [pendingPath, setPendingPath] = useState(null);
    const [listingBusy, setListingBusy] = useState(true), [selectionBusy, setSelectionBusy] = useState(Boolean(workstreamId));
    const pending = busy || listingBusy || selectionBusy;
    const dirty = loadedPath === path && text !== savedText;
    useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
    useEffect(() => {
      let live = true;
      setListingBusy(true); setError('');
      read(projectId, 'store/list', { ...(resultsCursor ? { resultsCursor } : {}), ...(deliveryCursor ? { deliveryCursor } : {}), ...(selectedWork ? { workstreamId: selectedWork } : {}) }).then(value => { if (live) setListing(value); }).catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setListingBusy(false); });
      return () => { live = false; };
    }, [projectId, resultsCursor, deliveryCursor, selectedWork]);
    useEffect(() => {
      if (!selectedWork) { setSelectionBusy(false); return; }
      let live = true; setSelectedResult(null); setError(''); setSelectionBusy(true);
      Promise.all([read(projectId, 'workstreams/get', { workstreamId: selectedWork }), read(projectId, 'store/results', { workstreamId: selectedWork })]).then(([value, history]) => {
        if (!live) return;
        const report = history.items[0];
        setSelectedResult(report ? { workstreamId: selectedWork, title: value.workstream.title, report, reportCount: history.total, current: report.delegationRef === value.workstream.currentDelegationRef } : null);
      }).catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setSelectionBusy(false); });
      return () => { live = false; };
    }, [projectId, selectedWork]);
    useEffect(() => {
      let live = true;
      if (path === 'docs') { setLoadedPath('docs'); setBusy(false); setError(''); return; }
      setLoadedPath(null); setBusy(true); setError(''); setNotice(''); setGeneratedText('');
      read(projectId, 'store/read', { path }).then(value => { if (live) { const editableText = path === 'notes.md' ? value.userText : value.text; setText(editableText); setSavedText(editableText); setGeneratedText(value.generatedText ?? ''); setLoadedPath(path); } })
        .catch(failure => { if (live) setError(errorText(failure)); }).finally(() => { if (live) setBusy(false); });
      return () => { live = false; };
    }, [projectId, path]);
    const editable = path === 'notes.md' || path === 'preferences.md';
    const save = async () => {
      setBusy(true); setError(''); setNotice('');
      try { const value = await command(projectId, 'store/write', { path, text }); setSavedText(text); if (path === 'notes.md') setGeneratedText(value.generatedText ?? generatedText); setNotice(t('saved')); return true; } catch (failure) { setError(errorText(failure)); return false; } finally { setBusy(false); }
    };
    const tabs = ['docs', 'notes.md', 'preferences.md'].map(file => ({ value: file, label: t(file === 'docs' ? 'workResults' : file === 'notes.md' ? 'notes' : 'preferences'), id: `${projectId}-material-tab-${file}`, panelId: `${projectId}-material-panel-${file}` }));
    const switchPath = next => { if (pending || next === path) return; if (dirty) { setError(''); setPendingPath(next); } else setPath(next); };
    const finishSwitch = () => { setPath(pendingPath); setPendingPath(null); setNotice(''); };
    return h(Fragment, null, h('div', { className: 'dsh-project-body dsh-project-materials' },
      h(SegmentedTabs, { className: 'dsh-project-materials-tabs', label: t('materials'), items: tabs, value: path, onChange: switchPath }),
      h('div', { className: 'dsh-project-materials-content', role: 'tabpanel', id: `${projectId}-material-panel-${path}`, 'aria-labelledby': `${projectId}-material-tab-${path}` },
      path === 'docs' ? h(Fragment, null,
      selectedWork ? h(Button, { variant: 'ghost', size: 'sm', style: { alignSelf: 'flex-start' }, onClick: () => { setSelectedWork(undefined); setSelectedResult(null); } }, t('allResults')) : null,
      listing?.deliveries?.map(delivery => h(DeliveryEntry, { key: delivery.id, projectId, delivery, read, showProcess, t })),
      h('div', { className: 'dsh-project-actions' }, deliveryCursors.length > 1 ? button(t('previous'), () => setDeliveryCursors(before => before.slice(0, -1)), pending) : null, listing?.nextDeliveryCursor ? button(t('next'), () => setDeliveryCursors(before => [...before, listing.nextDeliveryCursor]), pending) : null),
      listing?.deliveriesTotal ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('supportingReports')), (selectedWork ? selectedResult ? [selectedResult] : [] : listing?.results ?? []).map(result => h(ResultEntry, { key: result.workstreamId, projectId, result, read, showProcess, t })),
        h('div', { className: 'dsh-project-actions' }, !selectedWork && resultCursors.length > 1 ? button(t('previous'), () => setResultCursors(before => before.slice(0, -1)), pending) : null, !selectedWork && listing?.nextResultsCursor ? button(t('next'), () => setResultCursors(before => [...before, listing.nextResultsCursor]), pending) : null)) : (selectedWork ? selectedResult ? [selectedResult] : [] : listing?.results ?? []).map(result => h(ResultEntry, { key: result.workstreamId, projectId, result, read, showProcess, t })),
      !pending && !error && !listing?.deliveries?.length && !(selectedWork ? selectedResult : listing?.results?.length) ? h('p', { className: 'dsh-project-muted' }, t('noResults')) : null,
      !listing?.deliveriesTotal ? h('div', { className: 'dsh-project-actions' }, !selectedWork && resultCursors.length > 1 ? button(t('previous'), () => setResultCursors(before => before.slice(0, -1)), pending) : null,
        !selectedWork && listing?.nextResultsCursor ? button(t('next'), () => setResultCursors(before => [...before, listing.nextResultsCursor]), pending) : null) : null,
      h('details', { className: 'dsh-project-documents' }, h('summary', null, t('docs'), ` (${listing?.docs.length ?? 0})`), listing?.docs.length ? h('div', { className: 'dsh-project-list' }, listing.docs.map(file => h(Artifact, {
        key: file.path, file: { ...file, location: 'materials' }, busy: pending, t, open: path => { void read(projectId, 'open', { path }).catch(failure => setError(errorText(failure))); },
      }))) : h('p', { className: 'dsh-project-muted' }, t('noDocs')))) : loadedPath === path ? h(Fragment, null,
        h('p', { className: 'dsh-project-muted' }, t(path === 'notes.md' ? 'notesHint' : 'preferencesHint')),
        h('textarea', { className: 'dsh-project-editor', value: text, disabled: pending, readOnly: readonly, 'aria-label': t(path === 'notes.md' ? 'userNotes' : 'preferences'), onChange: event => { setText(event.target.value); setNotice(''); } }),
        path === 'notes.md' ? h('details', { className: 'dsh-project-result-disclosure' }, h('summary', null, t('generatedNotes')), markdown(t, generatedText)) : null) : null,
      pending ? h('p', { role: 'status' }, t('loading')) : null,
      error && pendingPath === null ? h(Fragment, null, h('p', { role: 'alert', className: 'dsh-project-error' }, t(editable && dirty ? 'saveFailed' : 'materialsError')), h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, error))) : null),
      editable ? h('div', { className: 'dsh-project-materials-footer' }, readonly ? h('p', { className: 'dsh-project-muted' }, t('archivedMaterials')) : h(Fragment, null,
        notice ? h('p', { role: 'status', className: 'dsh-project-muted' }, notice) : null, h(Button, { variant: 'primary', onClick: save, disabled: pending || loadedPath !== path || !dirty }, t('save')))) : null),
      h(Modal, { open: pendingPath !== null, onClose: () => { if (!busy) setPendingPath(null); }, closeLabel: t('keepEditing'), className: 'dsh-project-confirm', title: t('unsaved'), footer: h('div', { className: 'dsh-project-actions' },
        h(Button, { variant: 'ghost', onClick: () => setPendingPath(null), disabled: busy }, t('keepEditing')), button(t('discardAndSwitch'), () => { setText(savedText); finishSwitch(); }, busy), h(Button, { variant: 'primary', onClick: async () => { if (await save()) finishSwitch(); }, disabled: busy }, t('saveAndSwitch'))) },
        h('p', { className: 'dsh-project-muted' }, t('saveBeforeSwitch')),
        error ? h(Fragment, null, h('p', { role: 'alert', className: 'dsh-project-error' }, t('saveFailed')), h('details', { className: 'dsh-project-error-details' }, h('summary', null, t('errorDetails')), h('pre', null, error))) : null));
  }

  function ProcessRecords({ project, work, retainProcess, t }) {
    const [binding, setBinding] = useState(null), [window, setWindow] = useState(null), [sessionState, setSessionState] = useState(null);
    const [error, setError] = useState(''), [pageEnd, setPageEnd] = useState(null), [pageStart, setPageStart] = useState(null), [busy, setBusy] = useState(false);
    const [located, setLocated] = useState(!work.processAnchor), [locating, setLocating] = useState(Boolean(work.processAnchor));
    useEffect(() => {
      let live = true, reference, offEvents, offState;
      setError('');
      try {
        reference = retainProcess(project, work);
        reference.ready.then(async value => {
          if (!live) return;
          setBinding(value);
          const updateEvents = () => setWindow(value.eventSource.getSnapshot()), updateState = () => setSessionState(value.session.getSnapshot());
          offEvents = value.eventSource.subscribe(updateEvents); offState = value.session.subscribe(updateState); updateEvents(); updateState();
          if (work.processAnchor) {
            let snapshot = value.eventSource.getSnapshot(), records = processRecords(snapshot.entries), index = assignmentIndex(records, work.processAnchor.messageId);
            while (live && index < 0 && snapshot.hasMore) {
              await value.session.loadOlder();
              const next = value.eventSource.getSnapshot();
              if (next === snapshot) break;
              snapshot = next; records = processRecords(snapshot.entries); index = assignmentIndex(records, work.processAnchor.messageId);
            }
            if (live) { setLocated(index >= 0); setLocating(false); if (index >= 0) { const start = assignmentPageStart(records, index); setPageStart(start); setPageEnd(Math.min(assignmentPageEnd(records, index, project.coordinatorSessionId), start + 50)); } else setError(t('missingRound')); }
          }
        }).catch(failure => { if (live) { setError(errorText(failure)); setLocating(false); } });
      } catch (failure) { setError(errorText(failure)); }
      return () => { live = false; offEvents?.(); offState?.(); reference?.release(); };
    }, [project.id, work.workerSessionId, work.processAnchor?.messageId]);
    const records = processRecords(window?.entries ?? []), end = pageEnd ?? records.length, start = pageStart ?? Math.max(0, end - 50);
    const callNames = new Map(records.filter(event => event.type === 'tool/call').map(event => [event.data.callId, event.data.name]));
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
      (!window || locating) && !error ? h('p', { role: 'status' }, t(locating ? 'locating' : 'loading')) : null,
      located && !locating ? records.slice(start, end).map(event => {
        const data = event.data;
        if (event.type === 'turn/start') return h('strong', { key: event.seq, className: 'dsh-project-record-row' }, `${t('round')} ${data.turn} · ${new Date(event.time).toLocaleString()}`);
        if (event.type === 'user/message') return h('details', { key: event.seq, className: 'dsh-project-record-row' }, h('summary', null, t(data.source.kind === 'team-message' ? 'teamMessage' : 'workRequest')), markdown(t, messageText(data)));
        if (event.type === 'assistant/message') {
          const text = messageText(data.message);
          return text.trim() ? h('div', { key: event.seq, className: 'dsh-project-record-row' }, h('strong', null, t('assistant')), markdown(t, text)) : null;
        }
        if (event.type === 'tool/call') return h('details', { key: event.seq, className: 'dsh-project-record-row' }, h('summary', null, `${t('tool')}: ${data.name}`), h('pre', { className: 'dsh-project-record' }, data.arguments));
        if (event.type === 'tool/result') return h('details', { key: event.seq, className: 'dsh-project-record-row' }, h('summary', null, `${t(data.message.isError ? 'failed' : 'result')}: ${callNames.get(data.message.toolCallId) ?? data.message.toolCallId}`), h('pre', { className: 'dsh-project-record' }, messageText(data.message)), data.error ? h('p', { className: 'dsh-project-error' }, data.error.reason ?? data.error.code) : null);
        return data.reason?.kind === 'error' ? h('p', { key: event.seq, className: 'dsh-project-error' }, data.reason.error.message) : null;
      }) : null, window && !records.length && located ? h('p', { className: 'dsh-project-muted' }, t('noProcess')) : null,
      sessionState?.openError ? h('p', { role: 'alert', className: 'dsh-project-error' }, sessionState.openError.message) : null,
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
      located && !locating ? h('div', { className: 'dsh-project-actions' }, start > 0 || window?.hasMore ? button(t(start > 0 ? 'previous' : 'older'), older, busy) : null,
        pageEnd !== null && end < records.length ? button(t('next'), () => { setPageStart(end); setPageEnd(Math.min(records.length, end + 50)); }, busy) : null,
        pageEnd !== null ? button(t('newer'), () => { setPageStart(null); setPageEnd(null); }, busy) : null) : null);
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

  function ProcessPreview({ project, workstreamId, workerSessionId, delegationRef, runId, read, retainProcess, t }) {
    const [value, setValue] = useState(null), [error, setError] = useState('');
    useEffect(() => {
      let live = true; setValue(null); setError('');
      void read(project.id, 'workstreams/get', { ...(workerSessionId ? { workerSessionId } : { workstreamId }), delegationRef, runId }).then(result => { if (live) setValue(result); }).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [project.id, workstreamId, workerSessionId, delegationRef, runId]);
    return error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : value ? h('div', { className: 'dsh-project-body' }, h('strong', null, value.workstream.title), h(ProcessRecords, { key: value.workstream.workerSessionId, project, work: value.workstream, retainProcess, t })) : h('p', { role: 'status' }, t('loading'));
  }

  function ProjectOverlay({ useStore, actions, useProjects, read, command, retainProcess, showProcess, t }) {
    const modal = useStore(value => value.modal), detail = useProjects(value => modal ? value.details[modal.projectId] : undefined);
    const [dirty, setDirty] = useState(false), [confirmClose, setConfirmClose] = useState(false);
    const body = useRef(null), materialsPosition = useRef(null);
    useEffect(() => { setConfirmClose(false); }, [modal]);
    useLayoutEffect(() => {
      if (modal?.kind === 'materials' && materialsPosition.current?.modal === modal) {
        // Modal's body scrolls; hiding the retained materials clamps that body's range.
        body.current.parentElement.scrollTop = materialsPosition.current.top;
      } else if (!modal || modal.kind === 'materials') materialsPosition.current = null;
    }, [modal]);
    if (!modal) return null;
    const materials = modal.kind === 'materials' ? modal : modal.returnTo?.kind === 'materials' ? modal.returnTo : null;
    const openProcess = (...args) => {
      materialsPosition.current = { modal, top: body.current.parentElement.scrollTop };
      showProcess(...args);
    };
    const close = () => { if (dirty) setConfirmClose(true); else actions.setModal(null); };
    return h(Fragment, null, h(Modal, { open: true, onClose: close, closeLabel: t('close'), title: `${detail?.project.title ?? ''} · ${t(modal.kind)}`, className: 'dsh-project-modal', contentClassName: 'dsh-project-modal-content' },
      h('div', { ref: body, className: 'dsh-project-body' }, modal.returnTo ? button(t('back'), () => actions.setModal(modal.returnTo)) : null,
        materials ? h('div', { key: `materials:${materials.projectId}:${materials.workstreamId ?? ''}`, hidden: modal.kind !== 'materials' }, h(Materials, { projectId: materials.projectId, workstreamId: materials.workstreamId, read, command, onDirtyChange: setDirty, readonly: detail?.project.lifecycle === 'archived' || detail?.project.archiving, showProcess: openProcess, t })) : null,
        modal.kind === 'diff' ? h(FileDiff, { key: modal.workstreamId, projectId: modal.projectId, workstreamId: modal.workstreamId, read, t })
          : modal.kind === 'process' ? detail ? h(ProcessPreview, { key: `${modal.workstreamId ?? modal.workerSessionId}:${modal.delegationRef ?? ''}`, project: detail.project, workstreamId: modal.workstreamId, workerSessionId: modal.workerSessionId, delegationRef: modal.delegationRef, runId: modal.runId, read, retainProcess, t }) : h('p', { role: 'status' }, t('loading')) : null)),
      h(Modal, { open: confirmClose, onClose: () => setConfirmClose(false), closeLabel: t('keepEditing'), className: 'dsh-project-confirm', title: t('unsaved'), footer: h('div', { className: 'dsh-project-actions' },
        button(t('keepEditing'), () => setConfirmClose(false)), button(t('discard'), () => { setConfirmClose(false); actions.setModal(null); })) }));
  }

  return {
    inject: ['slots', 'connection', 'locale', 'uiWorkspace', 'uiSidebar', 'workspaces', 'sessions', 'conversation', 'settingsNavigation'],
    apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-project: locale');
      ctx.effect(() => ctx.locale.register('project-team', { zh: teamChinese, en: teamEnglish }), 'dsh-project: team locale');
      const snapshot = createSnapshotStore({ projects: [], details: {}, available: false, loading: true, error: '' });
      const archiveRequests = new Set();
      const viewHandle = defineStore({ init: () => ({ selected: null, modal: null, history: false }), actions: {
        selectProject: (draft, id) => { draft.selected = id; },
        setModal: (draft, modal) => { draft.modal = modal; }, setHistory: (draft, value) => { draft.history = value; },
      } });
      const viewInstance = viewHandle.create(), viewStore = { ...viewHandle, create: () => viewInstance };
      let alive = true, refreshing, sidebarInstalled = false, disposeAction, trackedProject;
      let navigationGeneration = 0, refreshGeneration = 0;
      const detailSequences = new Map(), detailPages = new Map();
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
        installSidebar();
      };
      const read = async (projectId, endpoint, input) => {
        const value = await rpc(endpoint, { ...input, projectId });
        if (endpoint === 'open' && input?.path) {
          if (typeof ctx.workspaces.openPath !== 'function') throw new Error(t('unavailable'));
          const project = snapshot.getSnapshot().projects.find(item => item.id === projectId);
          await ctx.workspaces.openPath(value.canonicalPath, { sessionId: project.coordinatorSessionId, workingDirectory: value.root, presentation: 'mini' });
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
          value = await read(projectId, endpoint, { ...input, requestId: requestId() });
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
            installSidebar();
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
      const show = (kind, projectId, workstreamId, member = false, reference = {}) => { const previous = viewInstance.getSnapshot().modal; viewInstance.actions.setModal({ kind, projectId, ...(member ? { workerSessionId: workstreamId } : { workstreamId }), ...reference, ...(previous?.projectId === projectId ? { returnTo: previous } : {}) }); };
      const sendUserRequest = async (projectId, text) => {
        const project = snapshot.getSnapshot().projects.find(item => item.id === projectId);
        if (!project || project.lifecycle !== 'ready' || project.archiving) throw new Error(t('unavailable'));
        const scope = ctx.sessions.scope(project.coordinatorSessionId);
        if (!scope) throw new Error(t('unavailable'));
        await scope.get('conversation').send(text);
      };
      const face = () => ({ hooks: { projects: snapshot, projectSessions: ctx.sessions.list }, read, command, refresh, openProject, readDetail, sendUserRequest, teamT: ctx.locale.bind('project-team'),
        openModelSettings: () => ctx.settingsNavigation.open('models'),
        addProject: async () => { try { const path = await ctx.uiWorkspace.selectDirectory(); if (!path) return; const result = await rpc('create', { workingDirectory: path, requestId: requestId() }); acceptDetail({ project: result.project }); await openProject(result.project.id); } catch (failure) { snapshot.set({ ...snapshot.getSnapshot(), error: errorText(failure) }); } },
        showMaterials: (projectId, workstreamId) => show('materials', projectId, workstreamId), showProcess: (projectId, workstreamId, member = false, reference) => show('process', projectId, workstreamId, member, reference), showDiff: (projectId, workstreamId) => show('diff', projectId, workstreamId),
        trackProject: projectId => { trackedProject = projectId; return () => { if (trackedProject === projectId) trackedProject = undefined; }; },
        retainProcess: (project, work) => ctx.sessions.retain({ parentSessionId: project.coordinatorSessionId, childSessionId: work.workerSessionId, mode: 'continuable' }, { source: 'projectPreview' }),
      });
      const installSidebar = () => {
        if (sidebarInstalled || !snapshot.getSnapshot().available) return;
        sidebarInstalled = true;
        ctx.slots.inject('sidebar.workspaces.sections', () => ctx.slots.register({ name: 'sidebar.workspaces.sections', id: NS, locale: NS, store: viewStore, inject: face }, SidebarPage));
      };
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
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: NS, order: 30, locale: NS, inject: face }, ProjectProgress));
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: NS, order: 30, locale: NS, inject: face }, ProjectStop));
      ctx.slots.inject('conversation.approval.actions', () => ctx.slots.register({ name: 'conversation.approval.actions', id: NS, locale: NS, inject: face }, ProjectApprovalStop));
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS, locale: NS, store: viewStore, inject: face }, ProjectOverlay));
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
