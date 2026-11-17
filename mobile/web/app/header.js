// app/header.js — split from app.js (#442).
import { withHeldLiveRow } from '../host/catalog.js';
import { DEFAULT_PRESETS, permissionLabel } from '../host/permission.js';
import { modelChipLabel } from '../host/models.js';
import { isReadOnlyRow, isSubagentRow, directSubagentRows } from '../chisacode/directory.js?v=20261115-subagents';
import { sessionTitle } from '../conversation/title.js';
import { updateDocumentTitle } from './chrome.js?v=20261117-app-split';
import { blankWorkspaceChip, chatTitle, composer, gitPill, gitPillCount, gitPillLabel, hostLine, phone, sendBtn, state, stopBtn, store, subagentsBtn } from './context.js?v=20261117-app-split';
import { scheduleNativeSnapshot } from './native.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';

export function currentRow() {
  const live = state.sessions.find((row) => row.sessionId === state.sessionId);
  if (live) return live;
  if (state.heldSession?.sessionId === state.sessionId) return state.heldSession;
  if (state.subagentRow?.sessionId === state.sessionId) return state.subagentRow;
  return undefined;
}

export function promoteHeldLive() {
  state.sessions = withHeldLiveRow(state.sessions, state.heldSession);
}

function syncRunning() {
  state.running = currentRow()?.running === true;
  sendBtn.classList.remove('hidden');
  sendBtn.setAttribute('aria-label', state.running ? '加入队列' : '发送消息');
  stopBtn.classList.toggle('hidden', !state.running);
  // Border beam on the composer capsule while the agent is thinking/streaming
  // (desktop InputBar `cardBeam`).
  composer.classList.toggle('is-running', state.running);
}

export function currentModeState() {
  const current = state.permission.current;
  return {
    modes: DEFAULT_PRESETS,
    currentModeId: current || null,
    currentLabel: permissionLabel(current) || '权限',
  };
}

export function currentModelState() {
  const { current, rows } = state.modelCatalog;
  // `current` may be replaced by selectModel echoes that omit capability
  // fields; resolve supportsImages from the matching catalog row each time.
  const row = current
    ? (Array.isArray(rows) ? rows : []).find((item) => item.provider === current.provider && item.id === current.model)
    : null;
  return {
    modelId: current?.model || null,
    label: modelChipLabel(current, rows),
    current: current ? { ...current, supportsImages: row ? row.supportsImages : current.supportsImages } : null,
  };
}

/** Subagent and archived sessions open read-only; the composer is hidden. */
export function currentReadOnlyReason() {
  const row = currentRow();
  if (!row || !isReadOnlyRow(row)) return '';
  if (row.archived === true) {
    return '已归档会话（只读）。可在「已归档会话」里取消归档。';
  }
  return '子智能体会话（只读）。由父会话驱动，不能直接发消息。';
}

function headerHostLabel() {
  const row = currentRow();
  if (row?.workspaceTitle) return row.workspaceTitle;
  if (row?.cwd) return row.cwd;
  const chip = blankWorkspaceChip?.textContent?.trim();
  if (chip && chip !== '工作区') return chip;
  const first = state.workspaces?.items?.find((item) => item?.title);
  if (first?.title) return first.title;
  return '已连接';
}

export function renderHeader() {
  const row = currentRow();
  updateDocumentTitle();
  chatTitle.textContent = row ? sessionTitle(row) : '新会话';
  hostLine.textContent = headerHostLabel();
  phone.dataset.sessionId = row?.sessionId || '';
  const showPill = store.gitTitle && (state.gitStatus.refName != null || state.gitStatus.isRepo === false);
  gitPill.classList.toggle('hidden', !showPill);
  if (!showPill && state.gitDialog === 'menu') { state.gitDialog = ''; renderSheet(); }
  // The center slot is either the Git pill or the session title, never both.
  chatTitle.classList.toggle('hidden', showPill);
  if (showPill) {
    const hasRef = state.gitStatus.refName != null;
    gitPillLabel.textContent = hasRef ? state.gitStatus.refName : 'Initialize Git';
    gitPillCount.textContent = hasRef && state.gitStatus.aheadCount > 0 ? `↑${state.gitStatus.aheadCount}` : '';
  }
  syncSubagentButton(row);
  syncRunning();
  scheduleNativeSnapshot();
}

/**
 * The header「子智能体」entry mirrors the desktop title-bar lineage menu:
 * visible only while the open conversation owns direct subagents, or is
 * itself a subagent (where the same sheet offers「返回父会话」).
 */
export function syncSubagentButton(row = currentRow()) {
  if (!subagentsBtn) return;
  const catalog = state.subagentCatalog?.sessionId === state.sessionId ? state.subagentCatalog : null;
  const visible = Boolean(row && state.sessionId)
    && (isSubagentRow(row)
      || directSubagentRows(state.sessions, state.sessionId).length > 0
      || (catalog?.entries.length ?? 0) > 0);
  subagentsBtn.classList.toggle('hidden', !visible);
  if (!visible && state.subagentSheet && catalog?.loading !== true) {
    state.subagentSheet = false;
    renderSheet();
  }
}
