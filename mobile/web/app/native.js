// app/native.js — split from app.js (#442).
import { groupTurns, foldEvents } from '../conversation/fold.js?v=20261028-mobile';
import { projectNativeSnapshot, nativeSessionTitle, isNativeBootstrapEpoch, validateNativeAction } from '../native-bridge.js?v=20260929-native-chat-epoch-v2';
import { isReadOnlyRow } from '../chisacode/directory.js?v=20261115-subagents';
import { DEFAULT_PRESETS } from '../host/permission.js';
import { listStickyServerIds, getMostRecentStickyServerId } from '../chisacode/session.js';
import { responseForAction, genericResponse } from '../chisacode/approvals.js';
import { composerOffline, showBanner } from './chrome.js?v=20261117-app-split';
import { renderComposer } from './composer.js?v=20261117-app-split';
import { connectSaved, draftStore, openSession, resumeRemoteConnection, runReconnectResync } from './connect.js?v=20261117-app-split';
import { draft, nativeAndroidApp, state } from './context.js?v=20261117-app-split';
import { currentModeState, currentModelState, currentReadOnlyReason, currentRow } from './header.js?v=20261117-app-split';
import { loadOlderMessages } from './log.js?v=20261117-app-split';
import { createWorkspaceSession } from './new-session.js?v=20261117-app-split';
import { answerLegacyApproval, cancelRun, respondToPendingApproval, runHostCommand, sendPrompt } from './session-actions.js?v=20261117-app-split';
import { changeAgentMode, changeAgentModel } from './settings.js?v=20261117-app-split';

let nativeSnapshotQueued = false;

let nativeSnapshotSeq = 0;

let nativeSnapshotEpoch = '';

export function scheduleNativeSnapshot() {
  if (!nativeAndroidApp || !nativeSnapshotEpoch || nativeSnapshotQueued) return;
  nativeSnapshotQueued = true;
  queueMicrotask(() => {
    nativeSnapshotQueued = false;
    const bridge = window.DshdNativeBridge;
    if (!nativeSnapshotEpoch || typeof bridge?.postMessage !== 'function') return;
    try {
      const rows = groupTurns(foldEvents(state.events), { running: state.running === true ? true : null });
      bridge.postMessage(JSON.stringify(projectNativeSnapshot({
        state, rows, title: currentRow() ? nativeSessionTitle(currentRow()) : '新会话',
        draft: draft.value, model: currentModelState().label,
        permission: currentModeState().currentLabel, readOnly: currentReadOnlyReason(),
        sessionReadOnly: isReadOnlyRow, permissionOptions: DEFAULT_PRESETS,
        seq: ++nativeSnapshotSeq, epoch: nativeSnapshotEpoch,
      })));
    } catch { /* A missing native receiver must never break the E2EE client. */ }
  });
}

if (nativeAndroidApp) {
  let nativeCreateBusy = false;
  window.__dshdNativeBootstrap = (epoch) => {
    if (!isNativeBootstrapEpoch(epoch)) return false;
    if (nativeSnapshotEpoch !== epoch) nativeSnapshotSeq = 0;
    nativeSnapshotEpoch = epoch;
    scheduleNativeSnapshot();
    return true;
  };
  // This entry point exists only in the packaged Android client. Android
  // verifies the calling frame's asset origin before exposing its receiver;
  // the browser path neither publishes this function nor emits snapshots.
  window.__dshdNativeAction = (raw) => {
    if (!nativeSnapshotEpoch) return false;
    const pending = state.pendingApprovals[0] || null;
    const action = validateNativeAction(raw, {
      connected: state.connected, offline: composerOffline(),
      sessions: state.heldSession ? [...state.sessions, state.heldSession] : state.sessions,
      sessionId: state.sessionId, readOnly: Boolean(currentReadOnlyReason()),
      running: currentRow()?.running === true, sendBusy: state.sendBusy,
      pending: Boolean(pending), approval: pending,
      hasOlder: state.timelinePage.hasOlder, olderLoading: state.timelineLoadingOlder,
      error: state.timelineError,
      modelOptions: state.modelCatalog.rows, permissionOptions: DEFAULT_PRESETS,
      modelBusy: state.modelBusy, modeBusy: state.modeBusy, planOn: state.permission.planOn,
    });
    if (!action) return false;
    const execute = async () => {
      switch (action.type) {
        case 'open': await openSession(action.sessionId); break;
        case 'new':
          if (nativeCreateBusy) return;
          nativeCreateBusy = true;
          try { await createWorkspaceSession(null); } finally { nativeCreateBusy = false; }
          break;
        case 'draft':
          draft.value = action.text;
          draft.dataset.draftSession = action.sessionId;
          draftStore?.save(action.sessionId, action.text);
          renderComposer({ nativeSnapshot: false });
          break;
        case 'send':
          draft.value = action.text;
          draft.dataset.draftSession = action.sessionId;
          draftStore?.save(action.sessionId, action.text);
          await sendPrompt();
          break;
        case 'cancel': await cancelRun(); break;
        case 'model': await changeAgentModel(action.provider, action.model, action.reasoningEffort); break;
        case 'permission': await changeAgentMode(action.id); break;
        case 'planOff': await runHostCommand('/plan off'); break;
        case 'slash': await runHostCommand(action.line.trim()); break;
        case 'approve': {
          const selected = pending.actions?.find((item) => item.id === action.actionId);
          if (pending.legacy) await answerLegacyApproval(action.actionId);
          else await respondToPendingApproval(pending, selected
            ? (selected.behavior ? responseForAction(selected) : { selectedActionId: selected.id })
            : genericResponse(action.actionId));
          break;
        }
        case 'older': await loadOlderMessages(); break;
        case 'retry': await openSession(action.sessionId); break;
        case 'refresh':
          if (state.connected && composerOffline()) await resumeRemoteConnection();
          else if (state.connected) await runReconnectResync();
          else if (listStickyServerIds().length) await connectSaved(getMostRecentStickyServerId());
          break;
      }
    };
    void execute().catch((error) => showBanner(error?.message || '电脑没有响应'));
    if (action.type !== 'draft') scheduleNativeSnapshot();
    return true;
  };
}
