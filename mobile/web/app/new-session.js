// app/new-session.js — split from app.js (#442).
import { workspaceChoices, presetChoices, browseStartPath, workspaceIdFromCreate } from '../host/catalog.js';
import { hostCall } from '../host/backend.js';
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { historyQuery } from '../host/history.js?v=20261028-mobile';
import { operationError, setToast, showBanner } from './chrome.js?v=20261117-app-split';
import { renderComposer } from './composer.js?v=20261117-app-split';
import { openSession, runReconnectResync } from './connect.js?v=20261117-app-split';
import { state } from './context.js?v=20261117-app-split';
import { renderDialog } from './dialogs.js?v=20261117-app-split';
import { renderSessions, subagentHistoryAddress } from './drawer.js?v=20261117-app-split';
import { renderHeader } from './header.js?v=20261117-app-split';
import { renderApproval, renderLog } from './log.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';
import { setDrawerOpen } from './screens.js?v=20261117-app-split';
import { refreshHostCatalog } from './session.js?v=20261117-app-split';

// —— 新会话：已有工作区 / 无目录 / 浏览本机目录 —— //

export function updateNewSession(patch) {
  if (!state.newSession) return;
  Object.assign(state.newSession, patch);
  if (patch.error) {
    const task = state.newSession;
    const retry = task.createdSessionId ? retryCreatedSession : task.retry;
    operationError(patch.error, retry ? () => {
      state.newSession = task;
      renderSheet();
      return retry();
    } : null);
  }
  renderSheet();
}

export function startNewSessionChooser() {
  state.pickerSheet = '';
  state.pickerPage = '';
  state.history = null;
  state.sessionMenu = '';
  state.workspaceMenu = '';
  state.subagentSheet = false;
  state.attachOpen = false;
  state.gitDialog = '';
  setDrawerOpen(false);
  const { choices, noFolder } = workspaceChoices(state.workspaces);
  state.newSession = {
    step: 'workspace',
    loading: false,
    error: '',
    workspaces: [
      noFolder,
      ...choices,
      { id: '__browse__', name: '浏览本机目录…', cwd: '', browse: true },
    ],
    browse: null,
    presets: [],
    workspace: null,
  };
  renderSheet();
  const client = state.chisacode?.client;
  const session = state.newSession;
  if (!client) return;
  void hostCall(client, 'agentPreset.list', {}).then((listed) => {
    if (state.newSession !== session) return;
    updateNewSession({ presets: presetChoices(listed) });
  }).catch(() => {
    if (state.newSession !== session) return;
    updateNewSession({ presets: [] });
  });
}

export async function createWorkspaceSession(workspaceId, extra = {}) {
  const client = state.chisacode?.client;
  if (!client) return;
  try {
    const created = await hostCall(client, 'session.create', {
      ...(workspaceId ? { workspaceId } : {}),
      ...extra,
    });
    const sessionId = created.sessionId;
    await refreshHostCatalog();
    renderSessions();
    if (sessionId) await openSession(sessionId);
  } catch (error) {
    showBanner(`无法创建会话：${error?.message || '电脑没有响应'}`);
  }
}

async function finishNewSession(owner, task, created) {
  if (!owner.owns() || state.newSession !== task) return;
  task.createdSessionId = created.sessionId;
  await refreshHostCatalog();
  if (!owner.owns() || state.newSession !== task) return;
  state.newSession = null;
  renderSheet(); renderSessions();
  if (task.createdSessionId) await openSession(task.createdSessionId);
}

export async function retryCreatedSession() {
  const owner = sessionOwner(state);
  const task = state.newSession;
  if (!task?.createdSessionId || task.creating) return;
  updateNewSession({ creating: true, loading: true, error: '' });
  try { await finishNewSession(owner, task, { sessionId: task.createdSessionId }); }
  catch (error) {
    if (owner.owns() && state.newSession === task) updateNewSession({ creating: false, loading: false, error: error.message });
  }
}

export async function chooseNewSessionWorkspace(workspace, options = {}) {
  if (workspace?.browse) {
    await openDirectoryBrowse();
    return;
  }
  if (state.newSession?.creating) return;
  const owner = sessionOwner(state);
  state.newSession.retry = () => chooseNewSessionWorkspace(workspace, options);
  updateNewSession({ creating: true, loading: true, error: '' });
  const task = state.newSession;
  const extra = !workspace?.id && workspace?.cwd ? { cwd: workspace.cwd } : {};
  try {
    const created = await hostCall(owner.client, 'session.create', { ...(workspace?.id ? { workspaceId: workspace.id } : {}), ...extra, ...options });
    await finishNewSession(owner, task, created);
  } catch (error) {
    if (!owner.owns() || state.newSession !== task) return;
    updateNewSession({ creating: false, loading: false, error: error?.message || '无法创建会话' });
  }
}

export async function openDirectoryBrowse() {
  const client = state.chisacode?.client;
  if (!client) return;
  state.newSession.retry = openDirectoryBrowse;
  if (state.newSession?.browse) {
    updateNewSession({ step: 'browse', loading: false, error: '' });
    return;
  }
  updateNewSession({ step: 'browse', loading: true, error: '', browse: null });
  const session = state.newSession;
  const start = browseStartPath(state.workspaces);
  try {
    const listed = await hostCall(client, 'host.listDirectory', start ? { path: start } : {});
    if (state.newSession !== session) return;
    updateNewSession({ loading: false, browse: listed });
  } catch (error) {
    if (state.newSession !== session) return;
    updateNewSession({ loading: false, error: error?.message || '电脑没有响应' });
  }
}

export async function browseDirectory(path) {
  const client = state.chisacode?.client;
  if (!client || !state.newSession) return;
  state.newSession.retry = () => browseDirectory(path);
  updateNewSession({ loading: true, error: '' });
  const session = state.newSession;
  const request = session.browseRequest = (session.browseRequest || 0) + 1;
  try {
    const listed = await hostCall(client, 'host.listDirectory', { path });
    if (state.newSession !== session || session.browseRequest !== request) return;
    updateNewSession({ loading: false, browse: listed });
  } catch (error) {
    if (state.newSession !== session || session.browseRequest !== request) return;
    updateNewSession({ loading: false, error: error?.message || '电脑没有响应' });
  }
}

export async function createBrowsedWorkspace() {
  const client = state.chisacode?.client;
  const path = state.newSession?.browse?.path;
  if (!client || !path || state.newSession.creating) return;
  const owner = sessionOwner(state);
  state.newSession.retry = createBrowsedWorkspace;
  updateNewSession({ loading: true, creating: true, error: '' });
  const active = state.newSession;
  try {
    const cachedWorkspaceId = active.createdWorkspacePath === path ? active.createdWorkspaceId : null;
    const created = cachedWorkspaceId ? null : await hostCall(client, 'workspace.create', { path });
    if (!owner.owns() || state.newSession !== active) return;
    const workspaceId = cachedWorkspaceId || workspaceIdFromCreate(created);
    if (!workspaceId) throw new Error('工作区创建失败');
    active.createdWorkspaceId = workspaceId;
    active.createdWorkspacePath = path;
    const session = await hostCall(client, 'session.create', { workspaceId });
    await finishNewSession(owner, active, session);
  } catch (error) {
    if (state.newSession !== active) return;
    updateNewSession({ loading: false, creating: false, error: error?.message || '电脑没有响应' });
  }
}

export function clearExclusiveDialogs() {
  state.workspaceRename = null;
  state.folderCreate = null;
  state.sessionRename = null;
  state.sessionConfirm = null;
  state.queueEdit = null;
  state.confirmAction = null;
}

export function startFolderCreate() {
  if (!state.newSession?.browse?.path) return;
  clearExclusiveDialogs();
  state.folderCreate = { value: '', busy: false, error: '' };
  renderDialog();
}

export async function submitFolderCreate() {
  const create = state.folderCreate;
  const client = state.chisacode?.client;
  const path = state.newSession?.browse?.path;
  const task = state.newSession;
  if (!create || create.busy || !client || !path) return;
  const name = create.value.trim();
  if (!name) return;
  create.busy = true;
  create.error = '';
  renderDialog();
  try {
    const created = await hostCall(client, 'host.createDirectory', { path, name });
    if (state.folderCreate !== create) return;
    state.folderCreate = null;
    renderDialog();
    await browseDirectory(created.path || path);
  } catch (error) {
    if (state.folderCreate !== create) return;
    create.busy = false;
    create.error = error?.message || '无法创建文件夹';
    operationError(create.error, () => {
      state.newSession = task;
      state.folderCreate = create;
      renderSheet();
      renderDialog();
      return submitFolderCreate();
    });
    renderDialog();
  }
}

export function historyRequest(sessionId, extra = {}) {
  const address = subagentHistoryAddress(sessionId);
  return historyQuery(sessionId, address ? { address, ...extra } : extra);
}

export function clearSessionView(sessionId) {
  if (state.sessionId !== sessionId) return;
  state.sessionId = '';
  state.subagentRow = null;
  state.subagentCatalog = null;
  state.events = [];
  state.pendingApprovals = [];
  state.sessionValues = {};
  state.outbox = [];
  state.timelinePage = { hasOlder: false, beforeSeq: null };
  state.timelineError = '';
  state.timelineLoading = false;
  renderLog();
  renderApproval();
  renderComposer();
  renderHeader();
}

export function startWorkspaceRename(workspace) {
  state.workspaceMenu = '';
  clearExclusiveDialogs();
  state.workspaceRename = {
    workspaceId: workspace.workspaceId,
    value: workspace.title || '',
    busy: false,
    error: '',
  };
  renderSheet();
  renderDialog();
}

export async function submitWorkspaceRename() {
  const rename = state.workspaceRename;
  const paired = state.chisacode;
  if (!rename || rename.busy || !paired) return;
  const title = rename.value.trim();
  if (!title) return;
  rename.busy = true;
  rename.error = '';
  renderDialog();
  try {
    await hostCall(paired.client, 'workspace.rename', {
      workspaceId: rename.workspaceId,
      title,
    });
    if (state.workspaceRename !== rename) return;
    state.workspaceRename = null;
    renderDialog();
    try { await refreshHostCatalog(); }
    catch (error) {
      operationError(`工作区已重命名；同步失败：${error?.message || '电脑没有响应'}`, runReconnectResync);
      return;
    }
    renderSessions();
    setToast('已重命名工作区', { tone: 'success' });
  } catch (error) {
    if (state.workspaceRename !== rename) return;
    rename.busy = false;
    rename.error = error?.message || '电脑没有响应';
    operationError(rename.error, () => {
      state.workspaceRename = rename;
      renderDialog();
      return submitWorkspaceRename();
    });
    renderDialog();
  }
}
