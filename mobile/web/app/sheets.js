// app/sheets.js — split from app.js (#442).
import { createSurface } from '../ui/surfaces.js?v=20261025-anchored-menus';
import { buttonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { sessionTitle } from '../conversation/title.js';
import { insertSessionMove } from '../host/catalog.js';
import { isSubagentRow, parentSessionIdOf, subagentSheetItems } from '../chisacode/directory.js?v=20261115-subagents';
import { showBanner, surfaceBusy } from './chrome.js?v=20261117-app-split';
import { openSession } from './connect.js?v=20261117-app-split';
import { accessChip, drawerDirectory, el, gitPill, modelChip, sessionList, sheetRoot, state, subagentsBtn } from './context.js?v=20261117-app-split';
import { renderDialog } from './dialogs.js?v=20261117-app-split';
import { loadSubagentCatalog, sessionRowById } from './drawer.js?v=20261117-app-split';
import { currentRow } from './header.js?v=20261117-app-split';
import { navigation, navigationBusy } from './navigation.js?v=20261117-app-split';
import { browseDirectory, chooseNewSessionWorkspace, createBrowsedWorkspace, retryCreatedSession, startFolderCreate } from './new-session.js?v=20261117-app-split';
import { descNode, ghostButton, primaryButton } from './nodes.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';
import { forkSession, loadHistoryPage, moveSession, startSessionConfirm, startSessionRename, unarchiveFromHistory } from './session-actions.js?v=20261117-app-split';

// —— sheet / dialog / toast / lightbox —— //

export function sheetItem({ label, hint = '', enabled = true, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sheet-item';
  button.disabled = !enabled;
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
  if (enabled) button.addEventListener('click', onClick);
  return button;
}

export function sheetTrigger() {
  if (state.attachOpen) return el('attach-toggle');
  if (state.pickerSheet === 'model') return modelChip;
  if (state.pickerSheet === 'mode') return accessChip;
  if (state.gitDialog === 'menu') return gitPill;
  if (state.subagentSheet) return subagentsBtn;
  const directory = state.sessionsOpen ? sessionList : drawerDirectory;
  if (state.sessionMenu) return [...directory.querySelectorAll('.session-row')]
    .find((node) => node.dataset.sessionId === state.sessionMenu)?.querySelector('.session-more');
  if (state.workspaceMenu) return [...directory.querySelectorAll('.workspace-head')]
    .find((node) => node.dataset.workspaceId === state.workspaceMenu)?.querySelector('.session-more:last-child');
  return null;
}

export function sheetLayer(title, closeSheet) {
  const task = Boolean(state.newSession?.step === 'browse' || state.history || state.gitDialog === 'branch');
  const modal = !task && Boolean(state.newSession);
  const anchor = state.pickerSheet || state.attachOpen ? 'composer' : (state.gitDialog === 'menu' || state.subagentSheet) ? 'header' : 'viewport';
  const result = createSurface(document, {
    title, task, variant: task ? 'task' : modal ? 'modal' : 'menu', anchor,
    onClose: () => { if (!navigationBusy()) closeSheet(); },
    onBack: (task || (state.pickerSheet === 'model' && state.pickerPage))
      ? () => navigation.back()
      : null,
  });
  if (result.layer.dataset.surface === 'menu') {
    result.panel.addEventListener('keydown', (event) => {
      if (event.target.matches('input,textarea')) return;
      const rows = [...result.panel.querySelectorAll('button:not([disabled])')];
      let index = rows.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') index = index < 0 ? 0 : (index + 1) % rows.length;
      else if (event.key === 'ArrowUp') index = index < 0 ? rows.length - 1 : (index - 1 + rows.length) % rows.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = rows.length - 1;
      else if (event.key === 'ArrowLeft' && state.pickerPage) { event.preventDefault(); navigation.back(); return; }
      else return;
      if (rows[index]) { event.preventDefault(); rows[index].focus({ preventScroll: true }); rows[index].scrollIntoView({ block: 'nearest' }); }
    });
  }
  return { layer: result.layer, sheet: result.content };
}

export function closeGitLayer() {
  if (state.gitBusy) return;
  state.gitDialog = '';
  state.gitConfirmAction = '';
  state.gitConfirmExtra = {};
  renderSheet();
  renderDialog();
}

function newSessionStepTitle(step) {
  if (step === 'browse') return '新会话 · 浏览本机目录';
  return '新会话 · 选择工作区';
}

export function renderNewSessionSheet() {
  const session = state.newSession;
  const { layer, sheet } = sheetLayer(newSessionStepTitle(session.step), () => {
    state.newSession = null;
    renderSheet();
  });
  surfaceBusy(sheet, session.loading);
  if (session.createdSessionId) {
    sheet.append(primaryButton('打开已创建会话', retryCreatedSession));
    sheetRoot.append(layer);
    return;
  }
  if (session.step === 'workspace') {
    for (const preset of session.presets || []) {
      sheet.append(sheetItem({
        label: `预设 · ${preset.name}`,
        hint: '用此智能体预设开新会话',
        enabled: !session.loading,
        onClick: () => chooseNewSessionWorkspace(null, { agentPreset: preset.id }),
      }));
    }
    for (const workspace of session.workspaces) {
      sheet.append(sheetItem({
        label: workspace.name,
        hint: workspace.cwd || '',
        enabled: !session.loading,
        onClick: () => chooseNewSessionWorkspace(workspace),
      }));
    }
  } else if (session.step === 'browse' && session.browse) {
    const browse = session.browse;
    sheet.append(descNode(browse.path || ''));
    const crumbs = Array.isArray(browse.crumbs) ? browse.crumbs : [];
    if (crumbs.length > 1) {
      const parent = crumbs[crumbs.length - 2];
      sheet.append(sheetItem({
        label: '上层目录',
        hint: parent.path,
        enabled: !session.loading,
        onClick: () => browseDirectory(parent.path),
      }));
    }
    for (const entry of browse.entries || []) {
      sheet.append(sheetItem({
        label: entry.name,
        hint: entry.path,
        enabled: !session.loading,
        onClick: () => browseDirectory(entry.path),
      }));
    }
    const actions = document.createElement('footer');
    actions.className = 'task-actions';
    const createFolder = ghostButton('新建文件夹', startFolderCreate);
    const useDirectory = buttonBusy(primaryButton('使用此目录作为工作区', createBrowsedWorkspace), session.creating, { label: '创建中…' });
    createFolder.disabled = session.loading;
    useDirectory.disabled = session.loading;
    actions.append(createFolder, useDirectory);
    sheet.parentElement.append(actions);
  }
  sheetRoot.append(layer);
}

export function renderSessionMenuSheet() {
  const row = sessionRowById(state.sessionMenu);
  if (!row) {
    state.sessionMenu = '';
    return;
  }
  const { layer, sheet } = sheetLayer(sessionTitle(row), () => {
    state.sessionMenu = '';
    renderSheet();
  });
  const items = [
    sheetItem({ label: '重命名', onClick: () => startSessionRename(row) }),
    sheetItem({ label: 'Fork', hint: '复制为新会话', onClick: () => forkSession(row) }),
  ];
  if (insertSessionMove(row, 'up', state.workspaces, state.sessions)) {
    items.push(sheetItem({ label: '上移', onClick: () => moveSession(row, 'up') }));
  }
  if (insertSessionMove(row, 'down', state.workspaces, state.sessions)) {
    items.push(sheetItem({ label: '下移', onClick: () => moveSession(row, 'down') }));
  }
  items.push(sheetItem({
    label: '归档',
    hint: '移入「已归档会话」，可取消归档',
    onClick: () => startSessionConfirm('archive', row),
  }));
  sheet.append(...items);
  sheetRoot.append(layer);
}

function subagentTimeText(value) {
  const time = Date.parse(value || '');
  if (!time) return '';
  return new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function subagentSheetItem(item) {
  const label = item.row ? sessionTitle(item.row) : (item.entry?.label || item.sessionId);
  const parts = [];
  if (item.diagnostic) {
    parts.push('无法打开');
  } else {
    if (item.running) parts.push('运行中');
    if (item.mode === 'one-shot') parts.push('一次性');
    else if (item.mode === 'continuable') parts.push('可继续');
    const time = subagentTimeText(item.activityAt);
    if (time) parts.push(time);
  }
  return {
    label,
    hint: parts.filter(Boolean).join(' · '),
    enabled: !item.diagnostic,
    onClick: () => {
      state.subagentSheet = false;
      renderSheet();
      openSession(item.sessionId, {
        subagent: {
          parentSessionId: state.sessionId,
          mode: item.mode || 'unknown',
          label,
        },
      }).catch((error) => showBanner(error.message));
    },
  };
}

/** Direct children of the open conversation — the desktop lineage catalog's scope. */
export function renderSubagentSheet() {
  const row = currentRow();
  if (!row) {
    state.subagentSheet = false;
    return;
  }
  const { layer, sheet } = sheetLayer('子智能体', () => {
    state.subagentSheet = false;
    renderSheet();
  });
  const parentId = isSubagentRow(row) ? parentSessionIdOf(row) : '';
  if (parentId) {
    const parentRow = sessionRowById(parentId);
    sheet.append(sheetItem({
      label: '返回父会话',
      hint: parentRow ? sessionTitle(parentRow) : '',
      onClick: () => {
        state.subagentSheet = false;
        renderSheet();
        openSession(parentId).catch((error) => showBanner(error.message));
      },
    }));
  }
  const catalog = state.subagentCatalog?.sessionId === state.sessionId ? state.subagentCatalog : null;
  const items = subagentSheetItems(state.sessions, state.sessionId, catalog?.entries);
  for (const item of items) {
    sheet.append(sheetItem(subagentSheetItem(item)));
  }
  if (catalog?.error) {
    const note = document.createElement('p');
    note.className = 'sheet-note';
    note.textContent = catalog.error;
    sheet.append(note);
    sheet.append(sheetItem({
      label: '重试',
      onClick: () => void loadSubagentCatalog(state.sessionId),
    }));
  } else if (!items.length && catalog?.loading !== true) {
    const note = document.createElement('p');
    note.className = 'sheet-note';
    note.textContent = '这个会话没有子智能体。';
    sheet.append(note);
  }
  surfaceBusy(sheet, catalog?.loading === true);
  sheetRoot.append(layer);
}

export function renderHistorySheet() {
  const view = state.history;
  const { layer, sheet } = sheetLayer('已归档会话', () => {
    state.history = null;
    renderSheet();
  });
  const note = document.createElement('p');
  note.className = 'sheet-note';
  note.textContent = '取消归档会让电脑端重新载入这个会话；这不会恢复正在运行的任务。';
  sheet.append(note);
  for (const row of view.rows) {
    const busy = view.busyId === row.sessionId;
    sheet.append(buttonBusy(sheetItem({
      label: sessionTitle(row),
      hint: '点按取消归档',
      enabled: !view.busyId && !view.loading,
      onClick: () => unarchiveFromHistory(row),
    }), busy, { label: '取消归档中…' }));
    sheet.append(sheetItem({
      label: `删除「${sessionTitle(row)}」`,
      hint: '仅已归档会话可删除',
      enabled: !view.busyId && !view.loading,
      onClick: () => startSessionConfirm('delete', row),
    }));
  }
  surfaceBusy(sheet, view.loading);
  if (!view.loading && !view.rows.length && !view.error) {
    const empty = document.createElement('p');
    empty.className = 'sheet-note';
    empty.textContent = '没有已归档的会话。';
    sheet.append(empty);
  }
  if (view.hasMore && !view.loading) {
    sheet.append(sheetItem({
      label: '加载更多',
      enabled: !view.busyId,
      onClick: () => loadHistoryPage(false),
    }));
  }
  sheetRoot.append(layer);
}
