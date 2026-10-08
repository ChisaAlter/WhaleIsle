window.__ModuleLoader__.load({ id: 'dsh-project', factory: (require) => {
  const { createElement: h, useState, useEffect, Fragment } = require('react');
  const { Button, Input, Menu, Modal, Pill, MarkdownText, TaskDock, IconFolderCloseRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
  const { createSnapshotStore, defineStore } = require('@deepseek-ai/dsh-client-store');
  const { TeamAction, teamEnglish, teamChinese } = require('@deepseek-ai/dsh-experimental-client-ui-agent-team');
  const NS = 'dsh-project';
  const zh = {
    diffTruncated: '差异过长，仅显示前一部分；请打开目录查看完整改动。', tab: 'Project', more: '更多', rename: '重命名', cancel: '取消', archiveActive: '停止后台工作并归档', archiveHint: '后台工作会停止，工作目录、对话和成果将保留。', team: '团队', add: '添加 Project…', loading: '正在读取…', close: '关闭', refresh: '刷新',
    empty: '从新建对话的工作目录菜单添加 Project。', archived: '已归档', history: '显示归档项目',
    directory: 'Project 工作目录', openDirectory: '打开项目目录', materials: '项目资料', progress: '工作进度',
    noWork: '在主对话中提出开发需求，协调者会安排后台工作。', process: '只读过程',
    processHint: '这是后台成员的真实记录。追加要求请回到主对话。', noProcess: '暂无可显示的记录。',
    older: '加载更早记录', windowHint: '按 Session 历史分页读取；本页最多显示 50 条记录。',
    newer: '最新记录', previous: '更早一页', next: '更新一页', assistant: '助手', tool: '工具',
    result: '结果', failed: '失败', open: '等待工作', running: '进行中', blocked: '需要处理', done: '已完成',
    provisioning: '正在准备', active: '执行中', idle: '空闲', stopping: '正在停止', paused: '已停止',
    pause: '暂停后台工作', resume: '解除暂停', resumeHint: '在主对话中提出新的要求，即可继续原工作。',
    stop: '停止后台工作', stopWork: '停止这项工作', archive: '归档项目', restore: '恢复项目',
    notes: '项目笔记', preferences: '项目偏好', docs: '文档与成果', noDocs: '暂无已保存文档。',
    generatedNotes: '自动生成的工作记录', generatedReadonly: '此区域由工作记录生成，只读。', userNotes: '我的补充笔记', remainingIssues: '成员报告的未解决事项',
    storeHint: '笔记和偏好供协调者参考；开发需求仍在主对话提出。', save: '保存', saved: '已保存',
    docsReadonly: '文档只读。修改要求请在主对话说明。', openFile: '打开文件', diff: '当前目录改动',
    noDiff: '当前没有文件差异。', branch: '分支', readonly: '只读调查', worktree: '独立 worktree', existing: '项目目录',
    copy: '复制', copied: '已复制', footnotes: '脚注', unavailable: 'Project 暂不可用',
    reportHint: '以下内容来自后台成员报告，尚未独立验证。', evidence: '成员报告的验证记录', pendingSummary: '等待协调者汇总',
    notGit: '当前目录不是 Git 仓库，无法读取 Git 差异。', unsaved: '笔记尚未保存', discard: '放弃修改', keepEditing: '继续编辑', saveBeforeSwitch: '保存后可切换资料。',
  };
  const en = {
    diffTruncated: 'The diff is truncated. Open the directory for the complete changes.', tab: 'Project', more: 'More', rename: 'Rename', cancel: 'Cancel', archiveActive: 'Stop work and archive', archiveHint: 'Background work will stop. Files, conversation and results are retained.', team: 'Team', add: 'Add Project…', loading: 'Loading…', close: 'Close', refresh: 'Refresh',
    empty: 'Add a Project from the working-directory menu in New Conversation.', archived: 'Archived', history: 'Show archived projects',
    directory: 'Project working directory', openDirectory: 'Open project directory', materials: 'Project materials', progress: 'Work progress',
    noWork: 'Describe your development request in the main conversation. The coordinator will arrange background work.', process: 'Read-only process',
    processHint: 'These are the background worker’s real records. Give additional instructions in the main conversation.', noProcess: 'No records to show yet.',
    older: 'Load earlier records', windowHint: 'Read through Session history pages; at most 50 records are shown per page.',
    newer: 'Latest records', previous: 'Earlier page', next: 'Later page', assistant: 'Assistant', tool: 'Tool',
    result: 'Result', failed: 'Failed', open: 'Waiting for work', running: 'In progress', blocked: 'Needs attention', done: 'Done',
    provisioning: 'Preparing', active: 'Running', idle: 'Idle', stopping: 'Stopping', paused: 'Stopped',
    pause: 'Pause background work', resume: 'Unpause', resumeHint: 'Give a new instruction in the main conversation to continue the original work.',
    stop: 'Stop background work', stopWork: 'Stop this work', archive: 'Archive project', restore: 'Restore project',
    notes: 'Project notes', preferences: 'Project preferences', docs: 'Documents and results', noDocs: 'No saved documents yet.',
    generatedNotes: 'Generated work records', generatedReadonly: 'This section is generated from work records and is read-only.', userNotes: 'My additional notes', remainingIssues: 'Worker-reported remaining issues',
    storeHint: 'Notes and preferences inform the coordinator. Development requests belong in the main conversation.', save: 'Save', saved: 'Saved',
    docsReadonly: 'Documents are read-only. Request changes in the main conversation.', openFile: 'Open file', diff: 'Current directory changes',
    noDiff: 'There are no current file changes.', branch: 'Branch', readonly: 'Read-only investigation', worktree: 'Independent worktree', existing: 'Project directory',
    copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes', unavailable: 'Project is currently unavailable',
    reportHint: 'The following is the worker’s report and has not been independently verified.', evidence: 'Worker-reported verification', pendingSummary: 'Waiting for the coordinator’s summary',
    notGit: 'This directory is not a Git repository; Git changes are unavailable.', unsaved: 'Notes have unsaved changes', discard: 'Discard changes', keepEditing: 'Keep editing', saveBeforeSwitch: 'Save before switching documents.',
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
    .dsh-project-row{border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);padding:10px;display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer;min-width:0}
    .dsh-project-row:hover,.dsh-project-row[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover)}
    .dsh-project-row-text{display:flex;flex:1;flex-direction:column;min-width:0}.dsh-project-row-title,.dsh-project-row-text>.dsh-project-muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsh-project-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dsh-project-error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;font-size:13px}
    .dsh-project-progress{max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px}
    .dsh-project-work{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;display:flex;flex-direction:column;gap:6px;min-width:0}
    .dsh-project-path{color:var(--dsw-alias-label-tertiary);font:12px monospace;overflow-wrap:anywhere}.dsh-project-body{display:flex;flex-direction:column;gap:12px;min-width:0}
    .dsh-project-modal{width:min(760px,calc(100vw - 32px))}.dsh-project-modal-content{max-height:80vh;overflow:auto}
    .dsh-project-editor{width:100%;min-height:280px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:13px/1.6 monospace;box-sizing:border-box}
    .dsh-project-record{font:12px/1.6 monospace;white-space:pre;overflow:auto;padding:10px;background:var(--dsw-alias-markdown-code-block);border-radius:12px;max-height:320px}
    .dsh-project-record-row{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.dsh-project-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
  `;
  const requestId = () => globalThis.crypto.randomUUID();
  const button = (label, onClick, disabled = false) => h(Button, { variant: 'outline', onClick, disabled }, label);
  const markdown = (t, text) => h(MarkdownText, { text, labels: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') } });
  const stateLabel = (t, state) => Object.hasOwn(zh, state) ? t(state) : String(state ?? '');
  const errorText = failure => failure?.message ?? String(failure);
  const messageText = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  const processRecords = entries => entries.filter(entry => entry.type === 'event' && ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/end'].includes(entry.event.type)).map(entry => entry.event);
  const isLive = worker => Boolean(worker.activeRunId || worker.jobs?.length || worker.phase === 'stopping');

  function ProjectRow({ project, currentSession, openProject, command, read, readDetail, t }) {
    const [menu, setMenu] = useState(false), [dialog, setDialog] = useState(null), [title, setTitle] = useState(project.title);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const execute = async (action, input) => { setBusy(true); setError(''); try { await command(project.id, action, input); setDialog(null); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
    const select = async action => {
      setMenu(false); setError('');
      if (action === 'rename') { setTitle(project.title); setDialog('rename'); return; }
      try {
        if (action === 'openDirectory') { await read(project.id, 'open'); return; }
        if (action === 'archive') { const detail = await readDetail(project.id); if (detail.workers.some(worker => isLive(worker) || worker.jobs?.length)) { setDialog('archive'); return; } }
        await execute(action);
      } catch (failure) { setError(errorText(failure)); }
    };
    return h(Fragment, null,
      h('div', { className: 'dsh-project-row-wrap', onContextMenu: event => { event.preventDefault(); setMenu(true); }, onKeyDown: event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); setMenu(true); } } },
        h('button', { type: 'button', className: 'dsh-project-row', title: project.canonicalWorkingDirectory, 'aria-current': currentSession === project.coordinatorSessionId ? 'page' : undefined, onClick: () => { void openProject(project.id); } },
          h(IconFolderCloseRegular, { size: 16 }), h('span', { className: 'dsh-project-row-text' }, h('span', { className: 'dsh-project-row-title' }, project.title)), project.lifecycle === 'archived' ? h('small', null, t('archived')) : null),
        h(Menu, { open: menu, onClose: () => setMenu(false), portal: true, align: 'end', compact: true, onSelect: action => { void select(action); }, items: [{ id: 'rename', label: t('rename') }, { id: 'openDirectory', label: t('openDirectory') }, { id: project.lifecycle === 'archived' ? 'restore' : 'archive', label: t(project.lifecycle === 'archived' ? 'restore' : 'archive') }], anchor: h(Button, { variant: 'ghost', size: 'sm', 'aria-label': t('more'), onClick: () => setMenu(value => !value) }, '…') })),
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
      h(Modal, { open: dialog !== null, onClose: () => { if (!busy) setDialog(null); }, closeLabel: t('cancel'), title: t(dialog === 'rename' ? 'rename' : 'archiveActive'), footer: h('div', { className: 'dsh-project-actions' }, button(t('cancel'), () => setDialog(null), busy), button(t(dialog === 'rename' ? 'save' : 'archiveActive'), () => execute(dialog, dialog === 'rename' ? { title } : undefined), busy || dialog === 'rename' && !title.trim())) },
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
        h('div', { className: 'dsh-project-list' }, projects.map(project => h(ProjectRow, { key: project.id, project, currentSession, openProject, command, read, readDetail, t })))) : null);
  }

  function ProjectHeader({ sessionId, useProjects, showMaterials, showProcess, teamT, useSession, useSessions, useSessionStatus, t }) {
    const project = useProjects(value => value.projects.find(item => item.coordinatorSessionId === sessionId));
    if (!project) return null;
    return h('div', { className: 'dsh-project-header' },
      h(TeamAction, { sessionId, useSession, useSessions, useSessionStatus, t: teamT, openTeammate: (_parent, child) => { showProcess(project.id, child, true); } }),
      h(Button, { variant: 'ghost', size: 'sm', onClick: () => showMaterials(project.id) }, t('materials')));
  }

  function ProjectProgress({ sessionId, useProjects, trackProject, readDetail, command, read, showProcess, showDiff, t }) {
    const snapshot = useProjects(value => value), project = snapshot.projects.find(item => item.coordinatorSessionId === sessionId);
    const detail = project ? snapshot.details[project.id] : undefined;
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => {
      if (!project) return;
      let live = true;
      setError('');
      const stopTracking = trackProject(project.id);
      void readDetail(project.id).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; stopTracking(); };
    }, [project?.id]);
    if (!project) return null;
    const act = async (endpoint, input = {}, reading = false) => {
      setBusy(true); setError('');
      try { await (reading ? read : command)(project.id, endpoint, input); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
    };
    const works = detail?.workstreams ?? [];
    if (!works.length && !error && !project.diagnostics?.length) return null;
    const activeCount = detail?.workers.filter(worker => isLive(worker) && !worker.stopped).length ?? 0, attention = works.filter(work => work.status === 'blocked').length;
    const preparing = works.some(work => work.delegation?.phase === 'preparing');
    const summary = detail?.workers.some(worker => worker.phase === 'stopping') ? t('stopping') : project.paused ? t('paused') : activeCount ? activeCount + ' · ' + t('running') : preparing ? t('provisioning') : attention ? attention + ' · ' + t('blocked') : works.every(work => work.status === 'done') ? t('done') : t('open');
    return h(TaskDock, { key: project.id, title: t('progress'), testId: 'project-progress', summary },
      h('div', { className: 'dsh-project-progress' },
        activeCount ? h('div', { className: 'dsh-project-actions' }, button(t('stop'), () => act('stop'), busy)) : null,
        project.paused && project.lifecycle !== 'archived' ? h('p', { className: 'dsh-project-muted' }, t('resumeHint')) : null,
        !detail ? h('p', { role: 'status' }, t('loading')) : !works.length ? h('p', { className: 'dsh-project-muted' }, t('noWork')) : null,
        works.map(work => {
          const worker = detail.workers.find(item => item.sessionId === work.workerSessionId), report = work.latestReport;
          return h('div', { className: 'dsh-project-work', key: work.id },
            h('div', { className: 'dsh-project-heading' }, h('strong', null, work.title), h(Pill, null, stateLabel(t, worker?.phase === 'failed' ? 'failed' : work.status))),
            work.blockedReason || worker?.error ? h('p', { className: 'dsh-project-error' }, work.blockedReason ?? worker.error) : null,
            work.pendingSummary ? h('p', { className: 'dsh-project-muted' }, t('pendingSummary')) : null,
            worker ? h('div', { className: 'dsh-project-path' }, worker.cwd, worker.branch ? ` · ${t('branch')}: ${worker.branch}` : '', ` · ${stateLabel(t, worker.role === 'readonly' ? 'readonly' : worker.mode)}`) : null,
            report ? h('div', null, h('p', { className: 'dsh-project-muted' }, t('reportHint')), markdown(t, report.summary),
              report.evidence?.length ? h('details', null, h('summary', null, t('evidence')), h('ul', null, report.evidence.map((item, index) => h('li', { key: index }, item)))) : null,
              report.remainingIssues?.length ? h('div', null, h('strong', null, t('remainingIssues')), h('ul', null, report.remainingIssues.map((item, index) => h('li', { key: index }, item)))) : null,
              report.artifacts?.map(file => h('div', { key: file.path, className: 'dsh-project-actions' }, h('span', { className: 'dsh-project-path' }, file.path), button(t('openFile'), () => act('open', { workstreamId: work.id, path: file.path }, true), busy)))) : null,
            h('div', { className: 'dsh-project-actions' }, work.workerSessionId ? button(t('process'), () => showProcess(project.id, work.id)) : null,
              worker && worker.role !== 'readonly' ? button(t('diff'), () => showDiff(project.id, work.id)) : null,
              worker && isLive(worker) ? button(t('stopWork'), () => act('stop', { workstreamId: work.id }), busy) : null));
        }),
        project.diagnostics?.map((notice, index) => h('p', { key: index, className: 'dsh-project-muted' }, typeof notice === 'string' ? notice : notice.message)),
        error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null));
  }

  function Materials({ projectId, read, command, onDirtyChange, t }) {
    const [listing, setListing] = useState(null), [path, setPath] = useState('docs'), [text, setText] = useState('');
    const [loadedPath, setLoadedPath] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [savedText, setSavedText] = useState(''), [generatedText, setGeneratedText] = useState('');
    const dirty = loadedPath === path && text !== savedText;
    useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
    useEffect(() => {
      let live = true;
      read(projectId, 'store/list').then(value => { if (live) setListing(value); }).catch(failure => { if (live) setError(errorText(failure)); });
      return () => { live = false; };
    }, [projectId]);
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
      try { const value = await command(projectId, 'store/write', { path, text }); setSavedText(text); if (path === 'notes.md') setGeneratedText(value.generatedText ?? generatedText); setNotice(t('saved')); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
    };
    const open = async () => { setError(''); try { await read(projectId, 'open', { path }); } catch (failure) { setError(errorText(failure)); } };
    return h('div', { className: 'dsh-project-body' }, h('p', { className: 'dsh-project-muted' }, t('storeHint')),
      h('div', { className: 'dsh-project-actions' }, ['docs', 'notes.md', 'preferences.md'].map(file => h(Button, {
        key: file, variant: path === file ? 'primary' : 'outline', disabled: busy || dirty, onClick: () => setPath(file),
      }, t(file === 'docs' ? 'docs' : file === 'notes.md' ? 'notes' : 'preferences')))),
      h('details', { open: path === 'docs' }, h('summary', null, t('docs')), listing?.docs.length ? h('div', { className: 'dsh-project-list' }, listing.docs.map(file => h('button', {
        type: 'button', key: file.path, className: 'dsh-project-row', disabled: busy || dirty, onClick: () => { void read(projectId, 'open', { path: file.path }).catch(failure => setError(errorText(failure))); },
      }, file.path))) : h('p', { className: 'dsh-project-muted' }, t('noDocs'))), h('span', { className: 'dsh-project-path' }, path),
      path !== 'docs' && loadedPath === path ? editable ? h(Fragment, null,
        path === 'notes.md' ? h('div', null, h('strong', null, t('generatedNotes')), h('p', { className: 'dsh-project-muted' }, t('generatedReadonly')), markdown(t, generatedText), h('strong', null, t('userNotes'))) : null,
        h('textarea', { className: 'dsh-project-editor', value: text, disabled: busy, 'aria-label': t(path === 'notes.md' ? 'userNotes' : 'preferences'), onChange: event => { setText(event.target.value); setNotice(''); } }))
        : h('div', null, h('p', { className: 'dsh-project-muted' }, t('docsReadonly')), markdown(t, text)) : busy ? h('p', { role: 'status' }, t('loading')) : null,
      h('div', { className: 'dsh-project-actions' }, editable ? button(t('save'), save, busy || loadedPath !== path) : path !== 'docs' ? button(t('openFile'), open, busy || loadedPath !== path) : null),
      dirty ? h('p', { className: 'dsh-project-muted' }, t('saveBeforeSwitch')) : null,
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null, notice ? h('p', { role: 'status', className: 'dsh-project-muted' }, notice) : null);
  }

  function ProcessRecords({ project, work, retainProcess, t }) {
    const [binding, setBinding] = useState(null), [window, setWindow] = useState(null), [sessionState, setSessionState] = useState(null);
    const [error, setError] = useState(''), [pageEnd, setPageEnd] = useState(null), [busy, setBusy] = useState(false);
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
    const records = processRecords(window?.entries ?? []), end = pageEnd ?? records.length, start = Math.max(0, end - 50);
    const callNames = new Map(records.filter(event => event.type === 'tool/call').map(event => [event.data.callId, event.data.name]));
    const older = async () => {
      if (start > 0) { setPageEnd(start); return; }
      if (!binding || !window.hasMore) return;
      const firstSeq = records[0]?.seq;
      setBusy(true); setError('');
      try {
        await binding.session.loadOlder();
        const updated = processRecords(binding.eventSource.getSnapshot().entries);
        const boundary = firstSeq === undefined ? updated.length : updated.findIndex(event => event.seq === firstSeq);
        if (boundary > 0) setPageEnd(boundary);
      } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
    };
    return h('div', { className: 'dsh-project-body' }, h('p', { className: 'dsh-project-muted' }, t('processHint')), h('p', { className: 'dsh-project-muted' }, t('windowHint')),
      !window && !error ? h('p', { role: 'status' }, t('loading')) : null,
      records.slice(start, end).map(event => {
        const data = event.data;
        if (event.type === 'user/message') return h('div', { key: event.seq, className: 'dsh-project-record-row' }, h('strong', null, data.source.kind === 'team-message' ? t('team') : t('progress')), markdown(t, messageText(data)));
        if (event.type === 'assistant/message') return h('div', { key: event.seq, className: 'dsh-project-record-row' }, h('strong', null, t('assistant')), markdown(t, messageText(data.message)));
        if (event.type === 'tool/call') return h('details', { key: event.seq, className: 'dsh-project-record-row' }, h('summary', null, `${t('tool')}: ${data.name}`), h('pre', { className: 'dsh-project-record' }, data.arguments));
        if (event.type === 'tool/result') return h('details', { key: event.seq, className: 'dsh-project-record-row' }, h('summary', null, `${t(data.message.isError ? 'failed' : 'result')}: ${callNames.get(data.message.toolCallId) ?? data.message.toolCallId}`), h('pre', { className: 'dsh-project-record' }, messageText(data.message)), data.error ? h('p', { className: 'dsh-project-error' }, data.error.reason ?? data.error.code) : null);
        return data.reason?.kind === 'error' ? h('p', { key: event.seq, className: 'dsh-project-error' }, data.reason.error.message) : null;
      }), window && !records.length ? h('p', { className: 'dsh-project-muted' }, t('noProcess')) : null,
      sessionState?.openError ? h('p', { role: 'alert', className: 'dsh-project-error' }, sessionState.openError.message) : null,
      error ? h('p', { role: 'alert', className: 'dsh-project-error' }, error) : null,
      h('div', { className: 'dsh-project-actions' }, button(t(start > 0 ? 'previous' : 'older'), older, busy || !(start > 0 || window?.hasMore)),
        pageEnd !== null && end < records.length ? button(t('next'), () => setPageEnd(Math.min(records.length, end + 50)), busy) : null,
        pageEnd !== null ? button(t('newer'), () => setPageEnd(null), busy) : null));
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
        h('p', { className: 'dsh-project-path' }, value.worker.cwd, value.worker.branch ? ` · ${t('branch')}: ${value.worker.branch}` : ''),
        value.snapshot.files?.length ? h('ul', null, value.snapshot.files.map(file => h('li', { key: file.path, className: 'dsh-project-path' }, file.path))) : null,
        value.snapshot.truncated ? h('p', { className: 'dsh-project-muted' }, t('diffTruncated')) : null,
        value.snapshot.isGit === false ? h('p', { className: 'dsh-project-muted' }, t('notGit'))
          : value.snapshot.diff ? h('pre', { className: 'dsh-project-record' }, value.snapshot.diff) : !value.snapshot.files?.length ? h('p', { className: 'dsh-project-muted' }, t('noDiff')) : null));
  }

  function ProjectOverlay({ useStore, actions, useProjects, read, command, retainProcess, t }) {
    const modal = useStore(value => value.modal), detail = useProjects(value => modal ? value.details[modal.projectId] : undefined);
    const [dirty, setDirty] = useState(false), [confirmClose, setConfirmClose] = useState(false);
    useEffect(() => { setConfirmClose(false); }, [modal]);
    if (!modal) return null;
    const work = detail?.workstreams.find(item => item.id === modal.workstreamId);
    const close = () => { if (dirty) setConfirmClose(true); else actions.setModal(null); };
    return h(Fragment, null, h(Modal, { open: true, onClose: close, closeLabel: t('close'), title: t(modal.kind), className: 'dsh-project-modal', contentClassName: 'dsh-project-modal-content' },
      modal.kind === 'materials' ? h(Materials, { key: modal.projectId, projectId: modal.projectId, read, command, onDirtyChange: setDirty, t })
        : modal.kind === 'diff' ? h(FileDiff, { key: modal.workstreamId, projectId: modal.projectId, workstreamId: modal.workstreamId, read, t })
          : detail && work ? h(ProcessRecords, { key: work.workerSessionId, project: detail.project, work, retainProcess, t }) : h('p', { role: 'status' }, t('loading'))),
      h(Modal, { open: confirmClose, onClose: () => setConfirmClose(false), closeLabel: t('keepEditing'), title: t('unsaved'), footer: h('div', { className: 'dsh-project-actions' },
        button(t('keepEditing'), () => setConfirmClose(false)), button(t('discard'), () => { setConfirmClose(false); actions.setModal(null); })) }));
  }

  return {
    inject: ['slots', 'connection', 'locale', 'uiWorkspace', 'uiSidebar', 'workspaces', 'sessions'],
    apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-project: locale');
      ctx.effect(() => ctx.locale.register('project-team', { zh: teamChinese, en: teamEnglish }), 'dsh-project: team locale');
      const snapshot = createSnapshotStore({ projects: [], details: {}, available: false, loading: true, error: '' });
      const viewHandle = defineStore({ init: () => ({ selected: null, modal: null, history: false }), actions: {
        selectProject: (draft, id) => { draft.selected = id; },
        setModal: (draft, modal) => { draft.modal = modal; }, setHistory: (draft, value) => { draft.history = value; },
      } });
      const viewInstance = viewHandle.create(), viewStore = { ...viewHandle, create: () => viewInstance };
      let alive = true, refreshing, sidebarInstalled = false, disposeAction, trackedProject;
      let navigationGeneration = 0, refreshGeneration = 0;
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
      const readDetail = async (projectId, incremental = false) => {
        const generation = refreshGeneration, since = incremental ? snapshot.getSnapshot().details[projectId]?.revision : undefined;
        const detail = await read(projectId, 'detail', { ...(since === undefined ? {} : { since }) });
        if (generation === refreshGeneration) acceptDetail(detail);
        return detail.unchanged ? snapshot.getSnapshot().details[projectId] : detail;
      };
      const command = async (projectId, endpoint, input) => {
        refreshGeneration++;
        const value = await read(projectId, endpoint, { ...input, requestId: requestId() });
        refreshGeneration++;
        if (value?.project) acceptDetail(value);
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
      const show = (kind, projectId, workstreamId) => { viewInstance.actions.setModal({ kind, projectId, workstreamId }); };
      const face = () => ({ hooks: { projects: snapshot, projectSessions: ctx.sessions.list }, read, command, refresh, openProject, readDetail, teamT: ctx.locale.bind('project-team'),
        addProject: async () => { try { const path = await ctx.uiWorkspace.selectDirectory(); if (!path) return; const result = await rpc('create', { workingDirectory: path, requestId: requestId() }); acceptDetail({ project: result.project }); await openProject(result.project.id); } catch (failure) { snapshot.set({ ...snapshot.getSnapshot(), error: errorText(failure) }); } },
        showMaterials: projectId => show('materials', projectId), showProcess: (projectId, workstreamId, member = false) => { const work = member ? snapshot.getSnapshot().details[projectId]?.workstreams.find(item => item.workerSessionId === workstreamId) : undefined; if (!member || work) show('process', projectId, work?.id ?? workstreamId); }, showDiff: (projectId, workstreamId) => show('diff', projectId, workstreamId),
        trackProject: projectId => { trackedProject = projectId; return () => { if (trackedProject === projectId) trackedProject = undefined; }; },
        retainProcess: (project, work) => ctx.sessions.retain({ parentSessionId: project.coordinatorSessionId, childSessionId: work.workerSessionId, mode: 'continuable' }, { source: 'projectPreview' }),
      });
      const installSidebar = () => {
        if (sidebarInstalled || !snapshot.getSnapshot().available) return;
        sidebarInstalled = true;
        ctx.slots.inject('sidebar.workspaces.sections', () => ctx.slots.register({ name: 'sidebar.workspaces.sections', id: NS, locale: NS, store: viewStore, inject: face }, SidebarPage));
      };
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: NS, locale: NS, inject: face }, ProjectHeader));
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: NS, order: 30, locale: NS, inject: face }, ProjectProgress));
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
