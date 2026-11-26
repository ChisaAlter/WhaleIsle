// app/log.js — split from app.js (#442).
import { groupTurns, foldEvents } from '../conversation/fold.js?v=20261028-mobile';
import { queuedMessages } from '../host/projections.js?v=20261028-mobile';
import { resolveLogAnchor } from '../chisacode/timeline.js';
import { clearButtonBusy, buttonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { reconcileChildren } from '../ui/keyed-list.js?v=20261028-mobile';
import { hostCall } from '../host/backend.js';
import { hostHistoryPage, mergeOlderHistory } from '../host/history.js?v=20261028-mobile';
import { responseForAction, genericResponse } from '../chisacode/approvals.js';
import { operationError, setToast, showBanner, updateDocumentTitle } from './chrome.js?v=20261117-app-split';
import { renderSlashPop } from './composer.js?v=20261117-app-split';
import { approval, approvalActions, approvalCommand, approvalTitle, blankEl, composer, el, jumpBottom, logEl, logList, readonlyNote, state, store } from './context.js?v=20261117-app-split';
import { openSession, renderDrawer } from './drawer.js?v=20261117-app-split';
import { currentReadOnlyReason } from './header.js?v=20261117-app-split';
import { logRowNode, outboxNode, queuePanelNode } from './log-rows.js?v=20261117-app-split';
import { scheduleNativeSnapshot } from './native.js?v=20261117-app-split';
import { historyRequest } from './new-session.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';
import { renderBlankHero } from './session.js?v=20261117-app-split';
import { answerLegacyApproval, respondToPendingApproval } from './session-actions.js?v=20261117-app-split';

function hideReasoningRows(rows) {
  return rows
    .filter((row) => row.role !== 'reasoning')
    .map((row) => (row.role === 'turn-process' ? { ...row, rows: row.rows.filter((child) => child.role !== 'reasoning') } : row))
    .filter((row) => row.role !== 'turn-process' || row.rows.length);
}

function visibleLogRows() {
  const rows = groupTurns(foldEvents(state.events), { running: state.running === true ? true : null });
  return store.showReasoning ? rows : hideReasoningRows(rows);
}

let logTail = '';

let logUnseen = false;

/** @type {HTMLButtonElement | null} */
let olderBtn = null;
function ensureOlderBtn() {
  if (!olderBtn) {
    olderBtn = document.createElement('button');
    olderBtn.type = 'button';
    olderBtn.className = 'load-older';
    olderBtn.textContent = '加载更早消息';
    olderBtn.addEventListener('click', () => loadOlderMessages());
  }
  return olderBtn;
}

function syncJumpBottom() {
  const distance = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight;
  const away = !logEl.classList.contains('hidden') && distance > 160;
  if (!away) logUnseen = false;
  jumpBottom.classList.toggle('hidden', !away);
  jumpBottom.toggleAttribute('data-unseen', away && logUnseen);
  jumpBottom.setAttribute('aria-label', away && logUnseen ? '有新消息，回到最新' : '回到最新消息');
}

/** In-log placeholder when the open session's timeline fetch failed. */
function timelineErrorNode() {
  const node = document.createElement('div');
  node.className = 'timeline-error';
  const text = document.createElement('p');
  text.className = 'log-error';
  text.textContent = `载入会话失败：${state.timelineError}`;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'ghost-btn';
  retry.textContent = '重试';
  retry.addEventListener('click', () => {
    if (state.toastTone === 'error') setToast('');
    showBanner('');
    const subagent = state.subagentRow
      ? {
        parentSessionId: state.subagentRow.parentSessionId,
        mode: state.subagentRow.subagentMode,
        label: state.subagentRow.projections?.values?.title || '',
      }
      : null;
    openSession(state.sessionId, subagent ? { subagent } : {}).catch((/** @type {any} */ error) => showBanner(error?.message || '电脑没有响应'));
  });
  node.append(text, retry);
  return node;
}

/**
 * @param {{ anchor?: 'auto' | 'bottom' | 'preserve' | 'hold' }} options
 * 'preserve' keeps the visual scroll position across a prepend (load-older),
 * 'bottom' follows the newest message, 'hold' keeps scrollTop as-is across an
 * append, and 'auto' (default) resolves to 'bottom' only when the viewport
 * was already at the bottom — stream events must not pull a user reading
 * history back down.
 */
export function renderLog({ anchor = 'auto' } = {}) {
  // The session row's live `running` beats the event log while a turn is
  // streaming (mux status frames land before the closing history pull).
  const rows = visibleLogRows();
  const queue = queuedMessages(state.sessionValues);
  const content = rows.length + state.outbox.length + queue.length;
  const placeholder = Boolean(state.timelineError) || state.timelineLoading;
  blankEl.classList.toggle('hidden', content > 0 || placeholder);
  logEl.classList.toggle('hidden', content === 0 && !placeholder);
  const prevHeight = logEl.scrollHeight;
  const prevTop = logEl.scrollTop;
  const resolved = resolveLogAnchor({
    anchor,
    scrollTop: prevTop,
    scrollHeight: prevHeight,
    clientHeight: logEl.clientHeight,
  });
  const nodes = [];
  clearButtonBusy(logEl);
  logEl.classList.toggle('surface-busy', state.timelineLoading && !rows.length);
  logEl.setAttribute('aria-busy', String(state.timelineLoading));
  if (state.timelineError) {
    nodes.push(timelineErrorNode());
  } else {
    if (state.transport === 'chisacode' && state.timelinePage.hasOlder) {
      const older = ensureOlderBtn();
      older.disabled = state.timelineLoadingOlder;
      buttonBusy(older, state.timelineLoadingOlder, { label: '加载中…' });
      nodes.push(older);
    }
    // Unchanged rows keep their nodes: a live tick rebuilds only what changed.
    nodes.push(...logList.nodes(rows, { key: (row) => `${row.role}:${row.id}`, build: (row) => logRowNode(row) }));
    nodes.push(...state.outbox.map(outboxNode));
    if (queue.length) nodes.push(queuePanelNode(queue));
  }
  reconcileChildren(logEl, nodes);
  renderBlankHero();
  scheduleNativeSnapshot();
  const tail = `${rows.length}:${rows.at(-1)?.id || ''}:${rows.at(-1)?.text?.length || 0}:${state.outbox.length}:${queue.length}`;
  if (tail !== logTail && resolved === 'hold' && logTail) logUnseen = true;
  logTail = tail;
  if (content) {
    if (resolved === 'preserve') {
      logEl.scrollTop = prevTop + (logEl.scrollHeight - prevHeight);
    } else if (resolved === 'hold') {
      logEl.scrollTop = prevTop;
    } else {
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
  syncJumpBottom();
  updateDocumentTitle();
}

export async function loadOlderMessages() {
  const paired = state.chisacode;
  const sessionId = state.sessionId;
  const page = state.timelinePage;
  if (!paired || !sessionId || !page.hasOlder || state.timelineLoadingOlder) return;
  state.timelineLoadingOlder = true;
  renderLog({ anchor: 'preserve' });
  try {
    const payload = await hostCall(paired.client, 'session.history', historyRequest(sessionId, {
      beforeSeq: page.beforeSeq,
    }));
    if (state.chisacode !== paired || state.sessionId !== sessionId) return;
    const older = hostHistoryPage(payload);
    state.events = mergeOlderHistory(older.events, state.events);
    state.timelinePage = { hasOlder: older.hasOlder, beforeSeq: older.beforeSeq };
    state.timelineLoadingOlder = false;
    renderLog({ anchor: 'preserve' });
  } catch (error) {
    if (state.chisacode !== paired || state.sessionId !== sessionId) return;
    state.timelineLoadingOlder = false;
    renderLog({ anchor: 'preserve' });
    state.banner = `无法加载更早消息：${error?.message || '电脑没有响应'}`;
    operationError(state.banner, loadOlderMessages);
  }
}

function approvalActionButton(label, className, onClick, actionId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.dataset.approvalAction = actionId;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * The composer area is one of: read-only note (subagent/archived), the first
 * pending daemon approval (with the daemon's own action list), or the
 * composer form.
 */
export function renderApproval() {
  const readOnly = currentReadOnlyReason();
  const pending = readOnly ? null : state.pendingApprovals[0] || null;
  readonlyNote.textContent = readOnly;
  readonlyNote.classList.toggle('hidden', !readOnly);
  composer.classList.toggle('hidden', Boolean(pending) || Boolean(readOnly));
  approval.classList.toggle('hidden', !pending);
  if ((pending || readOnly) && (state.pickerSheet || state.attachOpen)) {
    state.pickerSheet = ''; state.pickerPage = ''; state.attachOpen = false;
    renderSheet();
  }
  // Always re-render the slash popup: it must hide itself when an approval
  // arrives mid-typing and may return once the approval resolves.
  renderSlashPop();
  scheduleNativeSnapshot();
  updateDocumentTitle();
  if (!pending) return;
  approvalTitle.textContent = pending.title || '需要审批';
  approvalCommand.textContent = pending.command || '';
  el('approval-error').textContent = '';
  el('approval-error').classList.add('hidden');
  const buttons = [];
  if (pending.legacy) {
    buttons.push(
      approvalActionButton('拒绝', 'ghost-btn', () => {
        answerLegacyApproval('rejected', pending).catch((error) => showBanner(error.message));
      }, 'rejected'),
      approvalActionButton('允许一次', 'primary-btn', () => {
        answerLegacyApproval('allowed-once', pending).catch((error) => showBanner(error.message));
      }, 'allowed-once'),
    );
  } else if (pending.actions.length) {
    // Render exactly the daemon's action list — labels, order, and variants.
    for (const action of pending.actions) {
      const className = action.variant === 'primary'
        ? 'primary-btn'
        : action.variant === 'danger' ? 'danger-btn' : 'ghost-btn';
      buttons.push(approvalActionButton(action.label, className, () => {
        respondToPendingApproval(pending, responseForAction(action))
          .catch((error) => showBanner(error.message));
      }, action.id));
    }
  } else {
    buttons.push(
      approvalActionButton('拒绝', 'ghost-btn', () => {
        respondToPendingApproval(pending, genericResponse('deny'))
          .catch((error) => showBanner(error.message));
      }, 'deny'),
      approvalActionButton('允许一次', 'primary-btn', () => {
        respondToPendingApproval(pending, genericResponse('allow'))
          .catch((error) => showBanner(error.message));
      }, 'allow'),
    );
  }
  for (const button of buttons) {
    button.disabled = Boolean(pending.responding);
    buttonBusy(button, pending.responding && button.dataset.approvalAction === pending.respondingAction);
  }
  clearButtonBusy(approvalActions);
  approvalActions.replaceChildren(...buttons);
  renderDrawer();
}

let jumpFrame = 0;

logEl.addEventListener('scroll', () => {
  if (jumpFrame) return;
  jumpFrame = requestAnimationFrame(() => { jumpFrame = 0; syncJumpBottom(); });
}, { passive: true });

jumpBottom.addEventListener('click', () => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  logUnseen = false;
  logEl.scrollTo({ top: logEl.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
});
