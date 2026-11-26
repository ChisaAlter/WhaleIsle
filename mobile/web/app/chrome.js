// app/chrome.js — split from app.js (#442).
import { sessionTitle } from '../conversation/title.js';
import { transportModeLabel } from '../chisacode/controller.js';
import { schemeIsDark, channelLabel } from '../ui/settings-hub.js?v=20261028-mobile';
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { clearButtonBusy, buttonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { h } from '../ui/dom.js';
import { BASE_TITLE, bannerEl, connBanner, connectError, darkQuery, dialogRoot, draft, origin, phone, sheetRoot, state, store, toastRoot } from './context.js?v=20261117-app-split';
import { currentRow } from './header.js?v=20261117-app-split';
import { scheduleNativeSnapshot } from './native.js?v=20261117-app-split';
import { ghostButton } from './nodes.js?v=20261117-app-split';
import { broadcastWhaleUiTheme } from './whale-ui.js?v=20261117-app-split';

export let toastTimer = 0;

/** Tab title carries run / approval state so a backgrounded tab still reports progress. */
export function updateDocumentTitle() {
  if (!state.connected || !state.sessionId) {
    document.title = BASE_TITLE;
    return;
  }
  const row = currentRow();
  const prefix = state.pendingApprovals.length ? '待审批 · ' : row?.running ? '● ' : '';
  document.title = `${prefix}${row ? sessionTitle(row) : '新会话'} · ${BASE_TITLE}`;
}

/** Clipboard with the non-secure-context fallback (LAN pages lack navigator.clipboard). */
export async function copyText(text, { done = '已复制', quiet = false } = {}) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      field.tabIndex = -1;
      field.setAttribute('aria-hidden', 'true');
      const parent = dialogRoot.querySelector('.surface-content') || sheetRoot.querySelector('.surface-content') || phone;
      parent.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (!copied) throw new Error('copy refused');
    }
    if (!quiet) setToast(done, { tone: 'success', holdMs: 1600 });
    return true;
  } catch {
    operationError('无法访问剪贴板，请长按文字手动复制');
    return false;
  }
}

export function applyComposerPreferences() {
  draft.setAttribute('enterkeyhint', store.enterSend ? 'send' : 'enter');
}

export function applyAppearance() {
  const dark = schemeIsDark(store.scheme, darkQuery.matches);
  document.documentElement.toggleAttribute('data-ds-dark-theme', dark);
  document.documentElement.style.setProperty('--dsw-alias-glass-opacity', `${store.glass}%`);
  document.documentElement.style.setProperty('--dsh-message-scale', String(store.messageScale));
  if (store.uiFont.trim()) {
    document.documentElement.style.setProperty('--dsw-font-family', `${store.uiFont.trim()}, -apple-system, sans-serif`);
  } else {
    document.documentElement.style.removeProperty('--dsw-font-family');
  }
  broadcastWhaleUiTheme();
}

darkQuery.addEventListener?.('change', () => {
  if (store.scheme === 'system') applyAppearance();
});

export function showError(message) {
  connectError.textContent = '';
  connectError.classList.add('hidden');
  if (message) setToast(message, { tone: 'error', holdMs: 5000 });
}

export function surfaceBusy(content, busy) {
  const panel = content.closest('.surface-panel') || content;
  panel.classList.toggle('surface-busy', Boolean(busy));
  panel.setAttribute('aria-busy', String(Boolean(busy)));
}

export function operationError(message, retry, actions = []) {
  const owner = sessionOwner(state);
  setToast(message, {
    tone: 'error', holdMs: retry || actions.length ? 6000 : 5000,
    actions: [...(retry ? [{ label: '重试', onClick: async () => {
      if (!owner.owns()) {
        operationError('会话或连接已切换，请从原入口重试');
        return;
      }
      if (state.gitToast === message) setToast('');
      await retry();
    } }] : []), ...actions],
  });
}

export function showBanner(message) {
  const previous = state.banner;
  state.banner = message || '';
  bannerEl.textContent = '';
  bannerEl.classList.add('hidden');
  if (message) {
    if (!(state.toastTone === 'error' && state.toastActions.length && state.gitToast.includes(message))) operationError(message);
  } else if (previous && state.gitToast === previous) setToast('');
  scheduleNativeSnapshot();
}

export function renderConnBanner() {
  const visible = state.transport === 'chisacode' && state.connected && state.connPhase !== 'online';
  connBanner.classList.toggle('hidden', !visible);
  if (visible) {
    connBanner.dataset.phase = state.connPhase;
    connBanner.replaceChildren(document.createTextNode(state.connLabel || ''));
    if (state.connPhase === 'offline' || state.connPhase === 'disconnected') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'conn-retry';
      retry.textContent = '重新连接';
      retry.addEventListener('click', () => window.dispatchEvent(new Event('dshd-resume')));
      connBanner.append(' ', retry);
    }
  } else {
    delete connBanner.dataset.phase;
    connBanner.replaceChildren();
  }
  scheduleNativeSnapshot();
}

export function composerOffline() {
  return state.transport === 'chisacode' && state.connPhase !== 'online';
}

export function connectionLabel() {
  return state.transport === 'chisacode'
    ? transportModeLabel(state.transportMode)
    : channelLabel(origin);
}

export function openPullRequest() {
  try {
    const url = new URL(state.gitStatus.pr?.url || '');
    if (url.protocol !== 'https:') throw new Error('Pull request URL must use HTTPS');
    window.open(url.toString(), '_blank', 'noopener');
  } catch {
    showBanner('拉取请求链接不可用；请在电脑端打开');
  }
}

export function setToast(message, { tone = 'info', holdMs = 4000, actions = [] } = {}) {
  state.gitToast = message || '';
  state.toastTone = tone;
  state.toastHoldMs = holdMs;
  state.toastActions = actions;
  renderToast();
  clearTimeout(toastTimer);
  if (state.gitToast && !state.gitBusy && holdMs !== null) {
    toastTimer = setTimeout(() => {
      state.gitToast = '';
      renderToast();
    }, holdMs);
  }
}

export function renderToast() {
  clearButtonBusy(toastRoot);
  toastRoot.replaceChildren();
  // Running Git operations already report progress on their locked controls.
  if (state.gitBusy || !state.gitToast) return;
  const layer = document.createElement('div');
  layer.className = 'toast-layer';
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.tone = state.toastTone;
  toast.setAttribute('role', state.toastTone === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-atomic', 'true');
  {
    const bad = state.toastTone === 'error';
    const mark = document.createElement('span');
    mark.className = `mark ${bad ? 'bad' : state.toastTone === 'success' ? 'ok' : ''}`;
    mark.setAttribute('aria-hidden', 'true');
    // The standalone SPA uses the same SVG artwork as the shared Toast.
    mark.append(bad
      ? h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z', stroke: 'currentColor' }),
        h('path', { d: 'M8 4.29199V9.79199M8 10.708V11.708', stroke: 'currentColor' }))
      : state.toastTone === 'success'
        ? h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('path', { d: 'M12.5303 6.53027L8.80273 10.2578C8.54967 10.5109 8.31796 10.7439 8.10645 10.9141C7.88375 11.0932 7.616 11.2602 7.27344 11.3145C7.09229 11.3431 6.90771 11.3431 6.72656 11.3145C6.384 11.2602 6.11625 11.0932 5.89355 10.9141C5.68204 10.7439 5.45033 10.5109 5.19727 10.2578L3.46973 8.53027L4.53027 7.46973L6.25781 9.19727C6.53457 9.47402 6.70036 9.63859 6.83398 9.74609C6.95637 9.84453 6.98241 9.83644 6.96094 9.83301C6.98679 9.83709 7.01321 9.83709 7.03906 9.83301C7.01759 9.83644 7.04363 9.84453 7.16602 9.74609C7.29964 9.63859 7.46543 9.47402 7.74219 9.19727L11.4697 5.46973L12.5303 6.53027Z', fill: 'currentColor' }),
          h('path', { d: 'M14.5996 8C14.5996 4.35492 11.6451 1.40039 8 1.40039C4.35492 1.40039 1.40039 4.35492 1.40039 8C1.40039 11.6451 4.35492 14.5996 8 14.5996C11.6451 14.5996 14.5996 11.6451 14.5996 8ZM15.9004 8C15.9004 12.363 12.363 15.9004 8 15.9004C3.63695 15.9004 0.0996094 12.363 0.0996094 8C0.0996094 3.63695 3.63695 0.0996094 8 0.0996094C12.363 0.0996094 15.9004 3.63695 15.9004 8Z', fill: 'currentColor' }))
        : h('svg', { width: '16', height: '16', viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
          h('path', { d: 'M12.5757 7.00012C12.5757 3.92085 10.0794 1.42463 7.00012 1.42456C3.9208 1.42456 1.42456 3.9208 1.42456 7.00012C1.42463 10.0794 3.92085 12.5757 7.00012 12.5757C10.0793 12.5756 12.5756 10.0793 12.5757 7.00012ZM13.8002 7.00012C13.8001 10.7559 10.7559 13.8001 7.00012 13.8002C3.2443 13.8002 0.199291 10.7559 0.199219 7.00012C0.199219 3.24426 3.24426 0.199219 7.00012 0.199219C10.7559 0.199291 13.8002 3.2443 13.8002 7.00012Z', fill: 'currentColor' }),
          h('path', { d: 'M7.6127 3.18921V4.55986H6.38735V3.18921H7.6127ZM7.6127 5.68921V10.8109H6.38735V5.68921H7.6127Z', fill: 'currentColor' })));
    toast.append(mark);
  }
  const main = document.createElement('span');
  main.className = 'toast-main';
  const title = document.createElement('b');
  title.textContent = state.gitToast;
  main.append(title);
  if (state.toastActions.length) {
    const actions = document.createElement('div');
    actions.className = 'toast-actions';
    for (const action of state.toastActions) {
      const button = ghostButton(action.label, async () => {
        button.disabled = true;
        buttonBusy(button, true);
        try { await action.onClick(); }
        catch (error) { operationError(error?.message || '电脑没有响应', action.onClick); }
        finally { button.disabled = false; buttonBusy(button, false); }
      });
      actions.append(button);
    }
    main.append(actions);
  }
  toast.append(main);
  layer.append(toast);
  toastRoot.append(layer);
}
