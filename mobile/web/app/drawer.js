// app/drawer.js — split from app.js (#442).
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { sessionTitle, isUntitledBlank } from '../conversation/title.js';
import { h } from '../ui/dom.js';
import { groupSessionRows, visibleSessionRows, isSubagentRow, parentSessionIdOf } from '../chisacode/directory.js?v=20261115-subagents';
import { workspaceDrawerSections } from '../host/catalog.js';
import { hostCall } from '../host/backend.js';
import { operationError, showBanner } from './chrome.js?v=20261117-app-split';
import { openSession, runReconnectResync } from './connect.js?v=20261117-app-split';
import { drawerAccount, drawerAccountName, drawerAvatar, drawerDirectory, drawerStatus, navSessionsCount, search, sessionList, state } from './context.js?v=20261117-app-split';
import { renderDialog } from './dialogs.js?v=20261117-app-split';
import { syncSubagentButton } from './header.js?v=20261117-app-split';
import { scheduleNativeSnapshot } from './native.js?v=20261117-app-split';
import { navigationBusy, scheduleNavigation } from './navigation.js?v=20261117-app-split';
import { clearExclusiveDialogs, createWorkspaceSession } from './new-session.js?v=20261117-app-split';
import { descNode } from './nodes.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';
import { renderScreen, setDrawerOpen } from './screens.js?v=20261117-app-split';
import { call } from './session.js?v=20261117-app-split';
import { openHistorySheet } from './session-actions.js?v=20261117-app-split';
import { sheetTrigger } from './sheets.js?v=20261117-app-split';

export function openSessionsPage() {
  if (navigationBusy()) return;
  state.pickerSheet = '';
  state.pickerPage = '';
  state.attachOpen = false;
  state.newSession = null;
  state.history = null;
  state.sessionMenu = '';
  state.workspaceMenu = '';
  state.subagentSheet = false;
  state.gitDialog = '';
  clearExclusiveDialogs();
  renderSheet(); renderDialog();
  setDrawerOpen(false);
  state.sessionsOpen = true;
  renderSessions();
  renderScreen();
}

export function openSubagentSheet() {
  if (!state.sessionId || navigationBusy()) return;
  state.sessionMenu = '';
  state.workspaceMenu = '';
  state.pickerSheet = '';
  state.pickerPage = '';
  state.attachOpen = false;
  state.history = null;
  state.newSession = null;
  state.gitDialog = '';
  setDrawerOpen(false);
  state.subagentSheet = true;
  void loadSubagentCatalog(state.sessionId);
  renderSheet();
}

/**
 * `subagent.list` supplements loaded rows and decides whether the header
 * entry exists at all: children archived or missing from `session.list`
 * only appear here. Stale replies never land on a different session.
 */
export async function loadSubagentCatalog(parentSessionId) {
  if (!parentSessionId) return;
  const owner = sessionOwner(state);
  state.subagentCatalog = { sessionId: parentSessionId, loading: true, error: '', entries: [] };
  renderSheet();
  const keep = () => owner.owns()
    && state.sessionId === parentSessionId
    && state.subagentCatalog?.sessionId === parentSessionId;
  try {
    const result = await call('subagent.list', { parentSessionId });
    const value = result?.value !== undefined ? result.value : result;
    if (!keep()) return;
    state.subagentCatalog = {
      sessionId: parentSessionId,
      loading: false,
      error: '',
      entries: Array.isArray(value?.entries) ? value.entries : [],
    };
  } catch (error) {
    if (!keep()) return;
    state.subagentCatalog = {
      sessionId: parentSessionId,
      loading: false,
      error: error?.message || '电脑没有响应',
      entries: [],
    };
  }
  renderSheet();
  syncSubagentButton();
}

function sessionRowNode(row, { subagentCount = 0 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'session-row';
  if (row.sessionId) wrap.dataset.sessionId = row.sessionId;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `session${row.sessionId === state.sessionId ? ' active' : ''}`;
  const title = document.createElement('b');
  title.textContent = sessionTitle(row);
  const meta = document.createElement('span');
  meta.className = 'session-meta';
  meta.textContent = [
    subagentCount > 0 ? `${subagentCount} 个 subagent` : '',
    row.running ? '运行中' : '',
    row.searchSnippet || '',
  ].filter(Boolean).join(' · ');
  const status = row.sessionId === state.sessionId && state.pendingApprovals.length
    ? 'wait' : row.running ? 'run' : '';
  wrap.dataset.state = status;
  const dot = document.createElement('span');
  dot.className = 'session-state';
  dot.setAttribute('aria-hidden', 'true');
  button.append(dot, title);
  if (meta.textContent) button.append(meta);
  button.setAttribute('aria-label', [sessionTitle(row), meta.textContent, status === 'wait' ? '等待审批' : ''].filter(Boolean).join(' · '));
  button.addEventListener('click', () => {
    if (row.archived) return;
    openSession(row.sessionId).catch((error) => showBanner(error.message));
  });
  wrap.append(button);
  if (state.transport === 'chisacode') {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'session-more';
    more.setAttribute('aria-label', '会话操作');
    more.textContent = '⋯';
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      clearExclusiveDialogs();
      state.sessionMenu = row.sessionId;
      renderSheet();
      renderDialog();
    });
    wrap.append(more);
  }
  return wrap;
}

export function folderIcon() {
  return h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: 'M2 4.5A1.5 1.5 0 0 1 3.5 3h3.1a1 1 0 0 1 .7.3l1 1a1 1 0 0 0 .7.3h3.5A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' }));
}

function chevronIcon() {
  return h('svg', { width: '12', height: '12', viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: 'M4.5 2.5 8 6l-3.5 3.5', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

function workspaceHeadNode(workspace, { count = 0 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'session-row workspace-head';
  if (workspace.workspaceId) wrap.dataset.workspaceId = workspace.workspaceId;
  const expanded = state.expandedWorkspaces[workspace.workspaceId] !== false;
  wrap.dataset.expanded = expanded ? 'true' : 'false';
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'session workspace-toggle';
  expand.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  expand.setAttribute('aria-label', `${expanded ? '折叠' : '展开'}工作区 ${workspace.title || workspace.path || ''}`.trim());
  const lead = document.createElement('span');
  lead.className = 'workspace-lead';
  const chevron = chevronIcon();
  chevron.classList.add('workspace-chevron');
  const folder = folderIcon();
  folder.classList.add('workspace-folder');
  lead.append(chevron, folder);
  const text = document.createElement('span');
  text.className = 'workspace-text';
  const title = document.createElement('b');
  title.textContent = workspace.title || workspace.path || workspace.workspaceId;
  const path = document.createElement('span');
  path.className = 'workspace-path';
  path.textContent = workspace.path || '无工作区文件夹';
  path.title = workspace.path || '无工作区文件夹';
  text.append(title, path);
  expand.append(lead, text);
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'workspace-count';
    badge.textContent = String(count);
    expand.append(badge);
  }
  expand.addEventListener('click', () => {
    state.expandedWorkspaces[workspace.workspaceId] = !expanded;
    renderSessions();
  });
  wrap.append(expand);
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'session-more';
  add.setAttribute('aria-label', '在此工作区新建会话');
  add.textContent = '+';
  add.addEventListener('click', (event) => {
    event.stopPropagation();
    void createWorkspaceSession(workspace.workspaceId);
  });
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'session-more';
  more.setAttribute('aria-label', '工作区操作');
  more.textContent = '⋯';
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    clearExclusiveDialogs();
    state.workspaceMenu = workspace.workspaceId;
    renderSheet();
    renderDialog();
  });
  wrap.append(add, more);
  return wrap;
}

function drawerFootButton(label, { disabled = false, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'session-list-action';
  button.disabled = disabled;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function appendGroupedRows(nodes, rows, { inWorkspace = false } = {}) {
  for (const group of groupSessionRows(rows)) {
    const rowNode = sessionRowNode(group.row, { subagentCount: group.subagentCount });
    if (inWorkspace) rowNode.classList.add('in-workspace');
    nodes.push(rowNode);
  }
}

export function renderSessions() {
  const query = state.query.trim();
  // Blank rows may enter state.sessions live via host/session-added; the
  // desktop reuses blank as New Session, so the drawer hides them until a
  // title or first turn lands (LIST-006).
  const rows = state.sessions.filter((row) => !row.archived && !isUntitledBlank(row));
  const nodes = [];
  sessionList.classList.toggle('surface-busy', state.searchLoading);
  sessionList.setAttribute('aria-busy', String(state.searchLoading));
  // On the full-screen sessions page each group's rows live inside one card;
  // the group head stays outside on the canvas.
  const cardOfRows = (rowNodes) => {
    const card = document.createElement('div');
    card.className = 'card list-card';
    card.append(...rowNodes);
    return card;
  };
  const collectRows = (rows, options) => {
    const sink = [];
    appendGroupedRows(sink, rows, options);
    return sink;
  };
  if (query) {
    const hits = Array.isArray(state.searchHits) ? state.searchHits : [];
    if (!state.searchLoading && !hits.length) {
      nodes.push(descNode('没有匹配的会话'));
    } else if (!state.searchLoading) {
      nodes.push(cardOfRows(hits.map((hit) => sessionRowNode(hit))));
      if (state.searchHasMore) {
        nodes.push(descNode('还有更多结果，请改用更精确的词'));
      }
    }
  } else if (state.sessionView === 'grouped') {
    const { sections, ungrouped } = workspaceDrawerSections(rows, state.workspaces);
    for (const section of sections) {
      const group = document.createElement('div');
      group.className = 'ws-group';
      group.append(workspaceHeadNode(section.workspace, { count: visibleSessionRows(section.rows).length }));
      if (state.expandedWorkspaces[section.workspace.workspaceId] !== false) {
        group.append(cardOfRows(collectRows(section.rows, { inWorkspace: true })));
      }
      nodes.push(group);
    }
    if (ungrouped.length) {
      const group = document.createElement('div');
      group.className = 'ws-group';
      if (sections.length) group.append(descNode('无工作区文件夹', 'row-desc session-section-label'));
      group.append(cardOfRows(collectRows(ungrouped)));
      nodes.push(group);
    }
  } else {
    nodes.push(cardOfRows(collectRows(rows)));
  }
  if (state.transport === 'chisacode' && !query) {
    nodes.push(drawerFootButton(
      state.sessionView === 'grouped' ? '一个列表' : '按工作区分组',
      {
        onClick: () => {
          state.sessionView = state.sessionView === 'grouped' ? 'flat' : 'grouped';
          renderSessions();
        },
      },
    ));
    nodes.push(drawerFootButton('已归档会话', { onClick: () => openHistorySheet() }));
  }
  sessionList.replaceChildren(...nodes);
  renderDrawer(rows);
  syncSubagentButton();
  scheduleNativeSnapshot();
}

/** The sidebar mirrors the desktop workspace tree and keeps every row action. */
export function renderDrawer(visibleRows) {
  const rows = Array.isArray(visibleRows)
    ? visibleRows
    : state.sessions.filter((row) => !row.archived && !isUntitledBlank(row));
  navSessionsCount.textContent = String(visibleSessionRows(rows).length);
  const host = (state.hostName || '我的电脑').trim() || '我的电脑';
  drawerAvatar.textContent = host.charAt(0);
  drawerAccountName.textContent = host;
  drawerAccount.title = `${host} · 连接详情`;
  drawerStatus.replaceChildren();
  const busy = state.catalogBusy === true;
  drawerDirectory.classList.toggle('surface-busy', busy);
  drawerDirectory.setAttribute('aria-busy', String(busy));
  const nodes = [];
  const { sections, ungrouped } = workspaceDrawerSections(rows, state.workspaces);
  for (const section of sections) {
    const group = document.createElement('div');
    group.className = 'drawer-workspace';
    group.append(workspaceHeadNode(section.workspace, { count: visibleSessionRows(section.rows).length }));
    if (state.expandedWorkspaces[section.workspace.workspaceId] !== false) {
      const children = [];
      appendGroupedRows(children, section.rows, { inWorkspace: true });
      if (children.length) group.append(...children);
      else group.append(descNode('暂无会话', 'row-desc drawer-empty'));
    }
    nodes.push(group);
  }
  if (ungrouped.length) {
    nodes.push(descNode('无工作区文件夹', 'row-desc session-section-label'));
    appendGroupedRows(nodes, ungrouped);
  }
  if (!busy && !sections.length && !ungrouped.length && !state.sessionsError) {
    nodes.push(descNode('还没有会话，选择工作区或开始新会话。', 'row-desc drawer-empty'));
  }
  if (state.sessionsError) {
    const retry = drawerFootButton('重试加载会话', { disabled: busy, onClick: () => runReconnectResync() });
    retry.title = state.sessionsError;
    nodes.push(retry);
  }
  if (state.transport === 'chisacode') {
    nodes.push(drawerFootButton('已归档会话', { onClick: () => openHistorySheet() }));
  }
  const scroll = drawerDirectory.scrollTop;
  drawerDirectory.replaceChildren(...nodes);
  drawerDirectory.scrollTop = scroll;
  if (state.sessionMenu || state.workspaceMenu) {
    const trigger = sheetTrigger();
    if (trigger) scheduleNavigation();
    else { state.sessionMenu = ''; state.workspaceMenu = ''; renderSheet(); }
  }
}

async function runSessionSearch(query) {
  const paired = state.chisacode;
  if (!paired || !query) {
    state.searchHits = null;
    state.searchHasMore = false;
    state.searchLoading = false;
    renderSessions();
    return;
  }
  state.searchLoading = true;
  renderSessions();
  try {
    const result = await hostCall(paired.client, 'session.search', { query, limit: 20 });
    if (state.chisacode !== paired || state.query.trim() !== query) return;
    const byId = new Map(state.sessions.map((row) => [row.sessionId, row]));
    const items = Array.isArray(result.items) ? result.items : [];
    state.searchHits = items.slice(0, 20)
      .map((item) => ({
        ...(byId.get(item.sessionId) || { sessionId: item.sessionId, projections: { values: {} } }),
        searchSnippet: item.snippet || '',
      }))
      .filter((hit) => !isSubagentRow(hit));
    state.searchHasMore = result.hasMore === true || items.length > 20;
    state.searchLoading = false;
    renderSessions();
  } catch (error) {
    if (state.chisacode !== paired) return;
    state.searchLoading = false;
    state.searchHits = [];
    state.searchHasMore = false;
    state.banner = `搜索失败：${error?.message || '电脑没有响应'}`;
    operationError(state.banner, () => runSessionSearch(state.query.trim()));
    renderSessions();
  }
}

// —— 会话操作（重命名 / 重新生成标题 / 归档 / 删除）与已归档历史 —— //

export function sessionRowById(sessionId) {
  return state.sessions.find((row) => row.sessionId === sessionId);
}

/** `session.history` needs the parent address to read a subagent timeline. */
export function subagentHistoryAddress(sessionId) {
  const held = state.subagentRow?.sessionId === sessionId ? state.subagentRow : null;
  const row = sessionRowById(sessionId) || held;
  if (!row || !isSubagentRow(row)) return null;
  const parentSessionId = parentSessionIdOf(row) || held?.parentSessionId || '';
  if (!parentSessionId || parentSessionId === sessionId) return null;
  const catalog = state.subagentCatalog?.sessionId === parentSessionId ? state.subagentCatalog : null;
  const catalogEntry = catalog?.entries?.find?.((entry) => entry?.id === sessionId);
  return {
    kind: 'subagent',
    parentSessionId,
    childSessionId: sessionId,
    mode: held?.subagentMode || row.subagentMode || catalogEntry?.mode || 'unknown',
  };
}

let searchTimer = 0;

search.addEventListener('input', () => {
  state.query = search.value;
  // Switch the drawer into search mode immediately so the full list never
  // shows (or gets re-painted by live frames) during the debounce window.
  state.searchLoading = Boolean(state.query.trim());
  if (!state.searchLoading) {
    state.searchHits = null;
    state.searchHasMore = false;
  }
  renderSessions();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void runSessionSearch(state.query.trim());
  }, 200);
});
