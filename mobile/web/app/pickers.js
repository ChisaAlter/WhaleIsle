// app/pickers.js — split from app.js (#442).
import { buttonBusy, clearButtonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { h } from '../ui/dom.js';
import { isRoutable, effortsFor } from '../host/models.js';
import { gitStatusLine } from '../ui/settings-hub.js?v=20261028-mobile';
import { openPullRequest, showBanner, surfaceBusy } from './chrome.js?v=20261117-app-split';
import { fileCamera, fileGallery, sheetRoot, state } from './context.js?v=20261117-app-split';
import { renderDialog } from './dialogs.js?v=20261117-app-split';
import { openFilesPane } from './files.js?v=20261117-app-split';
import { currentQuick, gitAction, gitBusyLabel, loadBranches, maybeConfirm, refreshGit, runGitPrimary, switchBranch } from './git.js?v=20261117-app-split';
import { currentModeState, currentReadOnlyReason } from './header.js?v=20261117-app-split';
import { navigationBusy, preserveSurfaceInput, scheduleNavigation } from './navigation.js?v=20261117-app-split';
import { clearExclusiveDialogs, startWorkspaceRename } from './new-session.js?v=20261117-app-split';
import { descNode, fieldInput } from './nodes.js?v=20261117-app-split';
import { setDrawerOpen } from './screens.js?v=20261117-app-split';
import { startSessionConfirm } from './session-actions.js?v=20261117-app-split';
import { changeAgentMode, changeAgentModel, loadModelPane, openSettings } from './settings.js?v=20261117-app-split';
import { closeGitLayer, renderHistorySheet, renderNewSessionSheet, renderSessionMenuSheet, renderSubagentSheet, sheetItem, sheetLayer } from './sheets.js?v=20261117-app-split';

/** Row inside a picker sheet: label (+ hint) with the current choice marked. */
function pickerRow({ label, hint = '', current = false, enabled = true, busy = false, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sheet-item mode-row';
  button.disabled = !enabled;
  button.setAttribute('aria-pressed', String(current));
  const main = document.createElement('span');
  main.className = 'sheet-item-main';
  const title = document.createElement('span');
  title.textContent = label;
  main.append(title);
  if (hint) {
    const hintNode = document.createElement('span');
    hintNode.className = 'sheet-hint';
    hintNode.textContent = hint;
    main.append(hintNode);
  }
  button.append(main);
  if (current) {
    const mark = document.createElement('span');
    mark.className = 'mode-current';
    mark.textContent = '✓';
    button.append(mark);
  }
  buttonBusy(button, busy, { label: '切换中…' });
  if (enabled) button.addEventListener('click', onClick);
  return button;
}

function closePicker() {
  state.pickerSheet = '';
  state.pickerPage = '';
  renderSheet();
}

function modePickerCard() {
  const { modes, currentModeId } = currentModeState();
  const card = document.createElement('div');
  card.className = 'card';
  for (const mode of modes) {
    card.append(pickerRow({
      label: mode.label,
      hint: mode.desc || '',
      current: mode.id === currentModeId,
      enabled: !state.modeBusy,
      busy: state.modeBusy && mode.id === currentModeId,
      onClick: () => {
        changeAgentMode(mode.id);
      },
    }));
  }
  return card;
}

/** 权限 picker: the composer chip's sheet (desktop PermissionSelect menu). */
function renderModePickerSheet() {
  const { layer, sheet } = sheetLayer('权限', closePicker);
  sheet.append(modePickerCard());
  sheetRoot.append(layer);
}

const DRILL_ICONS = {
  effort: () => h('svg', { width: '16', height: '16', viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
    h('circle', { cx: '10', cy: '10', r: '7', stroke: 'currentColor', 'stroke-width': '1.4' }),
    h('path', { d: 'M10 6v4l2.5 2', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' })),
  mode: () => h('svg', { width: '16', height: '16', viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: 'M10 2.5 4 5v4.5c0 3.6 2.6 6.6 6 8 3.4-1.4 6-4.4 6-8V5l-6-2.5Z', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linejoin': 'round' })),
  more: () => h('svg', { width: '16', height: '16', viewBox: '0 0 20 20', fill: 'currentColor', 'aria-hidden': 'true' },
    h('circle', { cx: '4.5', cy: '10', r: '1.5' }),
    h('circle', { cx: '10', cy: '10', r: '1.5' }),
    h('circle', { cx: '15.5', cy: '10', r: '1.5' })),
};

export function drillChevron() {
  return h('svg', { class: 'chev', width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: 'm6 3.5 4.5 4.5L6 12.5', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

function drillRow({ icon, title, value, page = '', accent = false, enabled = true, onClick }) {
  const button = document.createElement('button');
  if (page) button.dataset.pickerPage = page;
  button.type = 'button';
  button.className = 'drill';
  button.disabled = !enabled;
  const round = document.createElement('span');
  round.className = 'drill-icon';
  round.append(icon());
  const main = document.createElement('span');
  main.className = 'drill-main';
  const t = document.createElement('span');
  t.className = 'drill-title';
  t.textContent = title;
  main.append(t);
  if (value) {
    const v = document.createElement('span');
    v.className = `drill-value${accent ? ' accent' : ''}`;
    v.textContent = value;
    main.append(v);
  }
  button.append(round, main, drillChevron());
  if (enabled) button.addEventListener('click', onClick);
  return button;
}

function modelRowButton(row, current) {
  const routable = isRoutable(row);
  return pickerRow({
    label: row.name,
    hint: !routable ? '尚未配置，请在电脑端配置此模型' : (row.reasoning ? '可调整思考强度' : ''),
    current: current?.provider === row.provider && current?.model === row.id,
    enabled: !state.modelBusy && routable,
    busy: state.modelBusy && current?.provider === row.provider && current?.model === row.id,
    onClick: () => changeAgentModel(row.provider, row.id),
  });
}

function setPickerPage(page) {
  state.pickerPage = page;
  renderSheet();
}

/** 模型 picker root page: current provider's models + 思考强度/权限/更多模型 drills. */
function renderModelPickerRoot(sheet, { current, rows }) {
  const efforts = effortsFor(current, rows);
  const provider = current?.provider || rows[0]?.provider;
  const providerRows = rows.filter((row) => row.provider === provider);
  const card = document.createElement('div');
  card.className = 'card';
  for (const row of providerRows) card.append(modelRowButton(row, current));
  if (!providerRows.length) card.append(descNode('没有可用模型', 'sheet-note'));
  sheet.append(card);
  if (efforts.length) {
    const effortName = efforts.find((effort) => effort.id === current?.reasoningEffort)?.name
      || current?.reasoningEffort || '';
    const drillCard = document.createElement('div');
    drillCard.className = 'card';
    drillCard.append(drillRow({
      icon: DRILL_ICONS.effort, page: 'effort',
      title: '思考强度',
      value: effortName,
      accent: true,
      onClick: () => setPickerPage('effort'),
    }));
    sheet.append(drillCard);
  }
  const modeCard = document.createElement('div');
  modeCard.className = 'card';
  modeCard.append(drillRow({
    icon: DRILL_ICONS.mode, page: 'mode',
    title: '权限',
    value: currentModeState().currentLabel,
    onClick: () => setPickerPage('mode'),
  }));
  sheet.append(modeCard);
  const routableCount = rows.filter(isRoutable).length;
  const moreCard = document.createElement('div');
  moreCard.className = 'card';
  moreCard.append(drillRow({
    icon: DRILL_ICONS.more, page: 'more',
    title: '更多模型',
    value: `按提供方浏览 · ${routableCount} 个`,
    onClick: () => setPickerPage('more'),
  }));
  sheet.append(moreCard);
}

/** 模型 picker「思考强度」page: effort rows with a trailing check. */
function renderModelPickerEffort(sheet, { current, rows }) {
  const card = document.createElement('div');
  card.className = 'card';
  for (const effort of effortsFor(current, rows)) {
    card.append(pickerRow({
      label: effort.name || effort.id,
      current: current?.reasoningEffort === effort.id,
      enabled: !state.modelBusy,
      busy: state.modelBusy && current?.reasoningEffort === effort.id,
      onClick: () => {
        if (current) changeAgentModel(current.provider, current.model, effort.id);
      },
    }));
  }
  sheet.append(card);
}

/** 模型 picker「更多模型」page: search field + provider-grouped full list. */
function renderModelPickerMore(sheet, { current, rows, pane }) {
  const searchInput = fieldInput(state.modelQuery, '搜索模型或提供方', (value) => {
    state.modelQuery = value;
    renderRows();
  });
  searchInput.setAttribute('aria-label', '搜索模型');
  searchInput.classList.add('model-search');
  sheet.append(searchInput);
  const list = document.createElement('div');
  list.className = 'card model-results';
  function renderRows() {
    clearButtonBusy(list);
    list.replaceChildren();
    const query = state.modelQuery.trim().toLocaleLowerCase();
    const matches = rows.filter((row) => !query || `${row.name} ${row.id} ${row.providerName}`.toLocaleLowerCase().includes(query));
    let provider = null;
    for (const row of matches) {
      if (row.providerName !== provider) {
        provider = row.providerName;
        list.append(descNode(provider || '模型', 'sheet-title sheet-group'));
      }
      list.append(modelRowButton(row, current));
    }
    if (!matches.length && !pane?.loading) list.append(descNode('没有匹配的模型', 'sheet-note'));
  }
  renderRows();
  sheet.append(list);
}

/** 模型 picker: provider models on the root page, drills switch pages in place. */
function renderModelPickerSheet() {
  const pageTitles = { effort: '思考强度', mode: '权限', more: '更多模型' };
  const { layer, sheet } = sheetLayer(pageTitles[state.pickerPage] || '选择模型', closePicker);
  if (!state.modelPane) loadModelPane();
  const pane = state.modelPane;
  const { current, rows } = state.modelCatalog;
  if (pane?.loading && !rows.length) {
    surfaceBusy(sheet, true);
  } else if (pane?.error) {
    // The persistent feedback retains retry; cached model choices stay usable.
    renderModelPickerRoot(sheet, { current, rows });
  } else if (state.pickerPage === 'effort') {
    renderModelPickerEffort(sheet, { current, rows });
  } else if (state.pickerPage === 'mode') {
    sheet.append(modePickerCard());
  } else if (state.pickerPage === 'more') {
    renderModelPickerMore(sheet, { current, rows, pane });
  } else {
    renderModelPickerRoot(sheet, { current, rows });
  }
  sheetRoot.append(layer);
}

export function openPicker(kind) {
  if (!state.sessionId) {
    showBanner('先打开一个会话，再选择权限或模型。');
    return;
  }
  if (currentReadOnlyReason()) return;
  if (navigationBusy()) return;
  state.newSession = null;
  state.history = null;
  state.sessionMenu = '';
  state.workspaceMenu = '';
  state.subagentSheet = false;
  state.pickerError = '';
  state.modelQuery = '';
  state.pickerPage = '';
  setDrawerOpen(false);
  clearExclusiveDialogs();
  state.attachOpen = false;
  state.gitDialog = '';
  state.pickerSheet = kind;
  renderSheet();
}

export function renderSheet() {
  scheduleNavigation();
  preserveSurfaceInput(sheetRoot);
  clearButtonBusy(sheetRoot);
  sheetRoot.replaceChildren();
  if (state.newSession) {
    renderNewSessionSheet();
    return;
  }
  if (state.history) {
    renderHistorySheet();
    return;
  }
  if (state.sessionMenu) {
    renderSessionMenuSheet();
    if (state.sessionMenu) return;
  }
  if (state.workspaceMenu) {
    const workspace = (state.workspaces.items || []).find((item) => item.workspaceId === state.workspaceMenu);
    if (!workspace) {
      state.workspaceMenu = '';
    } else {
      const { layer, sheet } = sheetLayer(workspace.title || workspace.path, () => {
        state.workspaceMenu = '';
        renderSheet();
      });
      sheet.append(
        sheetItem({
          label: '重命名工作区',
          onClick: () => startWorkspaceRename(workspace),
        }),
        sheetItem({
          label: '从列表移除',
          hint: '不删除磁盘上的文件夹',
          onClick: () => {
            state.workspaceMenu = '';
            startSessionConfirm('workspace-delete', {
              sessionId: workspace.workspaceId,
              projections: { values: { title: workspace.title || workspace.path } },
            });
          },
        }),
      );
      sheetRoot.append(layer);
      return;
    }
  }
  if (state.subagentSheet) {
    renderSubagentSheet();
    if (state.subagentSheet) return;
  }
  if (state.attachOpen) {
    const { layer, sheet } = sheetLayer('添加附件', () => {
      state.attachOpen = false;
      renderSheet();
    });
    const card = document.createElement('div');
    card.className = 'card';
    card.append(
      sheetItem({ label: '拍照', onClick: () => { state.attachOpen = false; renderSheet(); fileCamera.click(); } }),
      sheetItem({ label: '从相册选择', onClick: () => { state.attachOpen = false; renderSheet(); fileGallery.click(); } }),
      sheetItem({ label: '从工作区选文件', onClick: () => { state.attachOpen = false; renderSheet(); openSettings('文件'); openFilesPane(); } }),
    );
    sheet.append(card);
    sheetRoot.append(layer);
    return;
  }
  if (state.pickerSheet === 'mode') {
    renderModePickerSheet();
    return;
  }
  if (state.pickerSheet === 'model') {
    renderModelPickerSheet();
    return;
  }
  if (state.gitDialog === 'menu') {
    const { layer, sheet } = sheetLayer('Git', closeGitLayer);
    const quick = currentQuick();
    const hasOpenPr = state.gitStatus.pr?.state === 'open';
    const status = state.gitStatus;
    // Branch head: the current ref with its sync line, tapping opens the
    // branch switcher (desktop title-bar branch menu).
    if (status.isRepo !== false) {
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'sheet-item git-sheet-head';
      head.disabled = state.gitBusy;
      const main = document.createElement('span');
      main.className = 'sheet-item-main';
      const ref = document.createElement('span');
      ref.className = 'git-sheet-ref';
      ref.append(h('svg', { width: '14', height: '14', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm0 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6-7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5 6v4m6-4c0 2-1.5 3-3.5 3', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' })));
      const refName = document.createElement('b');
      refName.textContent = status.refName ?? '—';
      ref.append(refName);
      const line = document.createElement('span');
      line.className = 'sheet-hint';
      line.textContent = gitStatusLine(status).replace(/^[^·]*· /, '');
      main.append(ref, line);
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.textContent = '切换 ›';
      head.append(main, chev);
      head.addEventListener('click', () => loadBranches());
      sheet.append(head);
      const divider = document.createElement('div');
      divider.className = 'sheet-divider';
      sheet.append(divider);
    }
    const primary = sheetItem({ label: state.gitRetry ? '继续未完成操作' : quick.label, enabled: !state.gitBusy && (!quick.disabled || Boolean(state.gitRetry)), onClick: () => state.gitRetry ? gitAction('gitCommit', { retry: true }) : runGitPrimary() });
    primary.dataset.gitFeedback = '';
    buttonBusy(primary, state.gitBusy, { label: gitBusyLabel() });
    sheet.append(
      primary,
      sheetItem({ label: 'Pull', enabled: !state.gitBusy, onClick: () => gitAction('gitPull') }),
      sheetItem({
        label: 'Commit',
        enabled: !state.gitBusy && status.hasWorkingTreeChanges,
        hint: status.hasWorkingTreeChanges ? '' : '工作区是干净的。请先改文件再提交。',
        onClick: () => { state.pendingStacked = 'commit'; state.gitDialog = 'commit'; renderSheet(); renderDialog(); },
      }),
      sheetItem({
        label: 'Push',
        enabled: !state.gitBusy && status.aheadCount > 0 && !status.hasWorkingTreeChanges && status.behindCount === 0,
        hint: status.hasWorkingTreeChanges ? '请先提交或贮藏本地改动再推送。' : '',
        onClick: () => maybeConfirm('gitPush'),
      }),
      sheetItem({
        label: hasOpenPr ? 'View PR' : 'Create PR',
        enabled: !state.gitBusy && (hasOpenPr || (status.aheadCount > 0 && !status.hasWorkingTreeChanges)),
        onClick: () => {
          if (hasOpenPr) {
            closeGitLayer();
            openPullRequest();
          } else {
            maybeConfirm('gitCreateChangeRequest');
          }
        },
      }),
    );
    if (quick.kind === 'run_init') {
      sheet.append(sheetItem({
        label: 'Initialize Git',
        hint: '在当前工作区初始化仓库',
        enabled: !state.gitBusy,
        onClick: () => runGitPrimary(),
      }));
    }
    if (quick.kind === 'show_hint' && quick.hint) {
      const note = document.createElement('p');
      note.className = 'sheet-note';
      note.textContent = quick.hint;
      sheet.append(note);
    }
    sheet.append(sheetItem({
      label: '更改与文件',
      hint: '查看本轮改动、浏览工作区文件',
      onClick: () => {
        closeGitLayer();
        openSettings('工作区');
        refreshGit();
      },
    }));
    sheetRoot.append(layer);
    return;
  }
  if (state.gitDialog === 'branch') {
    const { layer, sheet } = sheetLayer('切换分支', closeGitLayer);
    surfaceBusy(sheet, state.branchLoading);
    const list = document.createElement('div');
    const renderRows = () => {
      const query = state.branchQuery.trim();
      const rows = state.branches.filter((branch) => !query || branch.name.toLowerCase().includes(query.toLowerCase()));
      const nodes = [];
      if (!rows.length && !state.branchLoading && !state.gitError) {
        const note = document.createElement('p');
        note.className = 'sheet-note';
        note.textContent = '没有匹配的分支';
        nodes.push(note);
      }
      for (const branch of rows) {
        const current = branch.isCurrent && !branch.isRemote;
        const switchable = branch.switchable !== false;
        const button = sheetItem({
          label: branch.name,
          enabled: !state.gitBusy && !state.branchLoading && !current && switchable,
          hint: !switchable
            ? '名称含桌面无法安全传给 git 的字符'
            : (branch.isRemote ? '远程' : current ? '当前' : ''),
          onClick: () => switchBranch(branch.isRemote ? branch.name.replace(/^origin\//, '') : branch.name),
        });
        const switching = state.gitBusy && state.gitProgress === 'switch-branch' && state.gitPendingRef === (branch.isRemote ? branch.name.replace(/^origin\//, '') : branch.name);
        if (switching) button.dataset.gitFeedback = '';
        buttonBusy(button, switching, { label: gitBusyLabel() });
        nodes.push(button);
      }
      const canCreate = Boolean(query) && !state.branches.some((branch) => branch.name === query && !branch.isRemote);
      nodes.push(sheetItem({
        label: canCreate ? `创建并检出分支「${query}」` : '创建并检出新分支…',
        enabled: !state.gitBusy && !state.branchLoading,
        onClick: () => {
          if (canCreate) state.newBranchName = query;
          state.gitDialog = 'create-branch';
          renderSheet();
          renderDialog();
        },
      }));
      clearButtonBusy(list);
      list.replaceChildren(...nodes);
    };
    sheet.append(fieldInput(state.branchQuery, '搜索分支…', (value) => {
      state.branchQuery = value;
      renderRows();
    }), list);
    renderRows();
    sheetRoot.append(layer);
    return;
  }
  renderDialog();
}
