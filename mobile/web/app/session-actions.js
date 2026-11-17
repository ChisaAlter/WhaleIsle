// app/session-actions.js — split from app.js (#442).
import { sessionTitle } from '../conversation/title.js';
import { hostCall } from '../host/backend.js';
import { insertSessionMove } from '../host/catalog.js';
import { promptPayload, textBlock } from '../host/prompt.js';
import { applyHostFrame } from '../host/frames.js';
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { commandExecutePayload, admitCommandResult, isSlashSubmitLine } from '../host/commands.js';
import { attachmentGuard } from '../host/attach-guard.js';
import { promptIdentity, userRowIds } from '../conversation/outbox.js?v=20261028-mobile';
import { foldEvents } from '../conversation/fold.js?v=20261028-mobile';
import { buttonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { deliverApprovalRespond } from '../host/approval-respond.js';
import { respond } from '../host/rpc.js';
import { composerOffline, operationError, setToast, showBanner } from './chrome.js?v=20261117-app-split';
import { renderComposer, renderSlashPop } from './composer.js?v=20261117-app-split';
import { clearApproval, draftStore, openSession } from './connect.js?v=20261117-app-split';
import { draft, origin, state, stopBtn, store } from './context.js?v=20261117-app-split';
import { renderDialog } from './dialogs.js?v=20261117-app-split';
import { renderSessions, sessionRowById } from './drawer.js?v=20261117-app-split';
import { currentModelState, currentReadOnlyReason, currentRow, promoteHeldLive, renderHeader } from './header.js?v=20261117-app-split';
import { renderApproval, renderLog } from './log.js?v=20261117-app-split';
import { clearExclusiveDialogs, clearSessionView, historyRequest, startNewSessionChooser } from './new-session.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';
import { setDrawerOpen } from './screens.js?v=20261117-app-split';
import { applyHistoryPayload, assertNotLegacyHostRpc, call, pullCurrentHistory, refreshHostCatalog, refreshProjections } from './session.js?v=20261117-app-split';
import { renderSettings } from './settings.js?v=20261117-app-split';

export function startSessionRename(row) {
  state.sessionMenu = '';
  clearExclusiveDialogs();
  state.sessionRename = {
    sessionId: row.sessionId,
    value: sessionTitle(row),
    busy: false,
    error: '',
  };
  renderSheet();
  renderDialog();
}

export async function submitSessionRename() {
  const rename = state.sessionRename;
  const paired = state.chisacode;
  if (!rename || rename.busy || !paired) return;
  rename.busy = true;
  rename.error = '';
  renderDialog();
  try {
    await hostCall(paired.client, 'session.rename', {
      sessionId: rename.sessionId,
      title: rename.value,
    });
    if (state.sessionRename !== rename) return;
    // The daemon accepted; reflect the confirmed name locally right away
    // (the authoritative agent_update upsert follows).
    const row = sessionRowById(rename.sessionId);
    if (row) {
      row.projections = row.projections || { values: {} };
      row.projections.values = { ...row.projections.values, title: rename.value.trim() };
      row.title = rename.value.trim();
    }
    state.sessionRename = null;
    renderDialog();
    renderSessions();
    renderHeader();
    setToast('已重命名', { tone: 'success' });
  } catch (error) {
    if (state.sessionRename !== rename) return;
    rename.busy = false;
    rename.error = error?.message || '电脑没有响应';
    operationError(rename.error, () => {
      state.sessionRename = rename;
      renderDialog();
      return submitSessionRename();
    });
    renderDialog();
  }
}

export async function forkSession(row) {
  state.sessionMenu = '';
  renderSheet();
  try {
    const created = await hostCall(state.chisacode.client, 'session.fork', {
      sessionId: row.sessionId,
    });
    await refreshHostCatalog();
    renderSessions();
    if (created.sessionId) await openSession(created.sessionId);
  } catch (error) {
    showBanner(`Fork 失败：${error?.message || '电脑没有响应'}`);
  }
}

export async function moveSession(row, direction) {
  const client = state.chisacode?.client;
  const payload = insertSessionMove(row, direction, state.workspaces, state.sessions);
  if (!client || !payload) return;
  state.sessionMenu = '';
  renderSheet();
  try {
    await hostCall(client, 'workspace.insertSessionBefore', payload);
    await refreshHostCatalog();
    renderSessions();
  } catch (error) {
    showBanner(`排序失败：${error?.message || '电脑没有响应'}`);
  }
}

async function regenerateSessionTitle(row) {
  state.sessionMenu = '';
  renderSheet();
  try {
    await hostCall(state.chisacode.client, 'session.prompt', {
      sessionId: row.sessionId,
      ...promptPayload([textBlock('/rename')]),
    });
    setToast('已请求重新生成标题', { tone: 'info' });
  } catch (error) {
    showBanner(`重新生成标题失败：${error?.message || '电脑没有响应'}`);
  }
}

export function startSessionConfirm(kind, row) {
  state.sessionMenu = '';
  state.workspaceMenu = '';
  clearExclusiveDialogs();
  state.sessionConfirm = {
    kind,
    sessionId: row.sessionId,
    title: sessionTitle(row),
    busy: false,
    error: '',
  };
  renderSheet();
  renderDialog();
}

export async function runSessionConfirm() {
  const confirm = state.sessionConfirm;
  const paired = state.chisacode;
  if (!confirm || confirm.busy || !paired) return;
  confirm.busy = true;
  confirm.error = '';
  renderDialog();
  try {
    if (confirm.kind === 'archive') {
      await hostCall(paired.client, 'workspace.archiveSession', { sessionId: confirm.sessionId });
    } else if (confirm.kind === 'delete') {
      await hostCall(paired.client, 'session.delete', { sessionId: confirm.sessionId });
    } else if (confirm.kind === 'workspace-delete') {
      await hostCall(paired.client, 'workspace.delete', { workspaceId: confirm.sessionId });
    }
    if (state.sessionConfirm !== confirm) return;
    await refreshHostCatalog();
    clearSessionView(confirm.sessionId);
    state.sessionConfirm = null;
    renderDialog();
    renderSessions();
    setToast(confirm.kind === 'archive' ? '已归档' : confirm.kind === 'workspace-delete' ? '已从列表移除' : '已删除', { tone: 'success' });
  } catch (error) {
    if (state.sessionConfirm !== confirm) return;
    confirm.busy = false;
    confirm.error = error?.message || '电脑没有响应';
    operationError(confirm.error, () => {
      state.sessionConfirm = confirm;
      renderDialog();
      return runSessionConfirm();
    });
    renderDialog();
  }
}

export function openHistorySheet() {
  setDrawerOpen(false);
  state.history = {
    rows: state.archivedRows.slice(),
    nextCursor: null,
    hasMore: false,
    loading: false,
    error: '',
    busyId: '',
  };
  renderSheet();
}

export async function loadHistoryPage() {
  return;
}

export async function unarchiveFromHistory(row) {
  const view = state.history;
  const paired = state.chisacode;
  if (!view || !paired || view.busyId) return;
  view.busyId = row.sessionId;
  view.error = '';
  renderSheet();
  try {
    await hostCall(paired.client, 'workspace.unarchiveSession', { sessionId: row.sessionId });
    await refreshHostCatalog();
    if (state.history !== view) return;
    view.rows = state.archivedRows.slice();
    view.busyId = '';
    renderSheet();
    renderSessions();
    setToast('已取消归档', { tone: 'success' });
  } catch (error) {
    if (state.history !== view) return;
    view.busyId = '';
    view.error = `取消归档失败：${error?.message || '电脑没有响应'}`;
    operationError(view.error, () => {
      state.history = view;
      renderSheet();
      return unarchiveFromHistory(row);
    });
    renderSheet();
  }
}

export async function createSession() {
  if (state.transport === 'chisacode') {
    startNewSessionChooser();
    return;
  }
  const created = await call('session.create', {});
  const sessionId = created.value?.sessionId;
  if (!sessionId) return;
  state.sessions = applyHostFrame(state.sessions, {
    type: 'host/session-added',
    sessionId,
    blank: true,
  });
  await openSession(sessionId);
}

export async function runHostCommand(line, images = []) {
  const owner = sessionOwner(state);
  const value = await hostCall(
    owner.client,
    'commands/execute',
    commandExecutePayload(owner.sessionId, line, images),
  );
  admitCommandResult(value, line);
  if (!owner.owns()) return;
  const history = await hostCall(owner.client, 'session.history', historyRequest(owner.sessionId));
  if (!owner.owns()) return;
  applyHistoryPayload(history, { merge: true });
  renderLog();
  renderComposer();
  renderSettings();
  void refreshProjections();
}

export async function sendPrompt() {
  if (state.sendBusy) return;
  const owner = sessionOwner(state);
  const submittedText = draft.value;
  const text = draft.value.trim();
  const images = state.attachments.slice();
  if (!state.sessionId || (!text && !images.length)) return;
  if (state.pendingApprovals.length) return;
  if (currentReadOnlyReason()) {
    showBanner('只读会话不能发送消息');
    return;
  }
  if (composerOffline()) {
    showBanner('连接已断开，消息未发送；草稿已保留，恢复连接后再发');
    return;
  }
  if (isSlashSubmitLine(text)) {
    state.sendBusy = true;
    renderComposer();
    try {
      await runHostCommand(text, images);
      if (owner.owns()) finishSubmittedDraft(submittedText, images);
    } finally {
      if (owner.owns()) { state.sendBusy = false; renderComposer(); }
    }
    return;
  }
  const guard = attachmentGuard({ current: currentModelState().current, attachments: images });
  if (!guard.ok) {
    showBanner(guard.message);
    return;
  }
  const blocks = [];
  if (text) blocks.push(textBlock(text));
  for (const image of images) {
    blocks.push({ type: 'image', mediaType: image.mediaType, data: image.data });
  }
  // While a reply runs the phone preference decides between the next turn
  // (queue) and the current reply (steer); an idle session always queues.
  const wasRunning = currentRow()?.running === true;
  const mode = wasRunning && store.runningSend === 'steer' ? 'steer' : 'queue';
  const identity = promptIdentity(state.promptIdentity, { sessionId: owner.sessionId, text, images, mode });
  state.promptIdentity = identity;
  const entry = {
    id: identity.requestId, text, images, mode, queued: wasRunning && mode === 'queue',
    status: 'sending', sentAt: Date.now(), baseline: userRowIds(foldEvents(state.events)),
  };
  state.outbox = [...state.outbox.filter((item) => item.id !== entry.id), entry];
  state.sendBusy = true;
  renderComposer();
  renderLog({ anchor: 'bottom' });
  try {
    const receipt = await call('session.prompt', { sessionId: owner.sessionId, requestId: identity.requestId, mode, content: blocks });
    if (receipt?.value?.accepted === false) throw new Error('未能确认消息发送，请同步后重试');
  } catch (error) {
    if (owner.owns()) {
      state.outbox = state.outbox.filter((item) => item !== entry);
      renderLog({ anchor: 'hold' });
    }
    throw error;
  } finally {
    if (owner.owns()) { state.sendBusy = false; renderComposer(); }
  }
  if (!owner.owns()) return;
  state.promptIdentity = null;
  entry.status = 'sent';
  entry.sentAt = Date.now();
  finishSubmittedDraft(submittedText, images);
  const row = currentRow();
  if (row) {
    row.running = true;
    row.blank = false;
    if (state.heldSession?.sessionId === row.sessionId) {
      state.heldSession = { ...row, blank: false };
    }
    promoteHeldLive();
    renderSessions();
  }
  renderComposer();
  renderSlashPop();
  renderHeader();
  renderLog({ anchor: 'bottom' });
  void pullCurrentHistory();
  void refreshProjections();
}

function finishSubmittedDraft(submittedText, images) {
  if (draft.value === submittedText) draft.value = '';
  state.attachments = state.attachments.filter((image) => !images.includes(image));
  draftStore?.save(state.sessionId, draft.value);
  draftStore?.saveAttachments(state.sessionId, state.attachments);
  renderComposer(); renderSlashPop(); renderHeader();
}

export async function cancelRun() {
  if (!state.sessionId) return;
  if (stopBtn.disabled) return;
  stopBtn.disabled = true;
  buttonBusy(stopBtn, true, { iconOnly: true, label: '正在停止运行…' });
  try {
    await call('session.cancel', { sessionId: state.sessionId });
  } catch (error) {
    showBanner(error.message || '无法停止');
  } finally {
    stopBtn.disabled = false;
    buttonBusy(stopBtn, false);
  }
}

export async function respondToPendingApproval(pending, response) {
  const pendingId = pending.approvalId || pending.rpcId || pending.requestId;
  const active = state.pendingApprovals.find((item) => (item.approvalId || item.rpcId || item.requestId) === pendingId);
  if (!active) {
    operationError('审批已结束，请查看当前会话');
    return;
  }
  pending = active;
  if (pending.responding) return;
  const owner = sessionOwner(state);
  pending.responding = true;
  pending.respondingAction = response?.selectedActionId || response?.behavior || '';
  if (pending.error && state.gitToast === pending.error) setToast('');
  pending.error = '';
  renderApproval();
  const outcome = response?.selectedActionId === 'rejected'
    || response?.behavior === 'deny'
    ? 'rejected'
    : (pending.actions?.find((action) => action.id === response?.selectedActionId)?.outcome || 'allowed-once');
  const client = owner.client;
  try {
    const result = await deliverApprovalRespond({
    hostCall,
    client,
    pending: {
      ...pending,
      sessionId: pending.sessionId || owner.sessionId,
    },
    outcome,
    loadHistory: (sessionId) => hostCall(client, 'session.history', historyRequest(sessionId)),
    });
    if (!owner.owns()) return;
    if (result.ok) {
      clearApproval(pending.rpcId); clearApproval(pending.approvalId);
    } else {
      pending.error = result.error?.message || '审批未能送达电脑';
      operationError(pending.error, () => respondToPendingApproval(pending, response));
    }
  } catch (error) {
    if (owner.owns()) {
      pending.error = error?.message || '审批未能送达电脑';
      operationError(pending.error, () => respondToPendingApproval(pending, response));
    }
  } finally {
    pending.responding = false;
    pending.respondingAction = '';
    if (owner.owns()) renderApproval();
  }
}

export async function answerLegacyApproval(outcome, expected = state.pendingApprovals[0]) {
  const pending = state.pendingApprovals[0];
  if (!pending || (pending.approvalId || pending.rpcId || pending.requestId) !== (expected?.approvalId || expected?.rpcId || expected?.requestId)) {
    operationError('审批已结束，请查看当前会话');
    return;
  }
  if (!pending || !pending.legacy || pending.responding) return;
  const owner = sessionOwner(state);
  pending.responding = true;
  pending.respondingAction = outcome;
  if (pending.error && state.gitToast === pending.error) setToast('');
  pending.error = '';
  renderApproval();
  try {
    assertNotLegacyHostRpc();
    await respond({
      origin,
      rpcId: pending.rpcId,
      value: { sessionId: pending.sessionId, approvalId: pending.approvalId, outcome },
    });
    if (owner.owns()) state.pendingApprovals = state.pendingApprovals.filter((item) => item !== pending);
  } catch (error) {
    if (owner.owns()) {
      pending.error = error?.message || '审批未能送达电脑';
      operationError(pending.error, () => answerLegacyApproval(outcome, pending));
    }
  } finally {
    pending.responding = false;
    pending.respondingAction = '';
    if (owner.owns()) renderApproval();
  }
}
