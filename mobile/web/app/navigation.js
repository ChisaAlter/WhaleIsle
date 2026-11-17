// app/navigation.js — split from app.js (#442).
import { createNavigation, backTarget } from '../ui/navigation.js?v=20261115-subagents';
import { hasOfferFragment } from '../chisacode/session.js';
import { accessChip, backdrop, dialogRoot, el, focusScope, lightboxRoot, menuPositioner, modelChip, phone, sessionsPage, settings, sheetRoot, state, toastRoot } from './context.js?v=20261117-app-split';
import { renderDialog, renderLightbox } from './dialogs.js?v=20261117-app-split';
import { updateNewSession } from './new-session.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';
import { closeScan } from './scan.js?v=20261117-app-split';
import { renderScreen, setDrawerOpen } from './screens.js?v=20261117-app-split';
import { renderSettings } from './settings.js?v=20261117-app-split';
import { sheetTrigger } from './sheets.js?v=20261117-app-split';

let navigationQueued = false;

let lastSurfaceKey = '';

export const navigation = createNavigation({
  history: window.history,
  listen: (handler) => window.addEventListener('popstate', handler),
  hasSurface: () => backTarget(state) !== 'root',
  getSurfaceKey: () => `${state.sessionEpoch}:${surfaceIdentity()}`,
  canTrack: () => !hasOfferFragment(location.hash),
  isBlocked: navigationBusy,
  onBack: backOneSurface,
});

window.__dshdNavigation = Object.freeze({ back: () => navigation.back() });

export function navigationBusy() {
  const target = backTarget(state);
  if (['sessionConfirm', 'workspaceRename', 'folderCreate', 'sessionRename', 'queueEdit', 'confirmAction'].includes(target)) return Boolean(state[target]?.busy);
  return (target === 'git' && state.gitBusy) || Boolean(state.newSession?.creating);
}

function backOneSurface() {
  const target = backTarget(state);
  const pickerPage = state.pickerSheet === 'model' ? state.pickerPage : '';
  if (target === 'lightbox') state.lightbox = null;
  else if (['sessionConfirm', 'workspaceRename', 'folderCreate', 'sessionRename', 'queueEdit', 'confirmAction'].includes(target)) state[target] = null;
  else if (target === 'git') {
    state.gitError = '';
    if (state.gitDialog === 'create-branch') state.gitDialog = state.gitConfirmAction ? 'confirm' : 'branch';
    else {
      state.gitDialog = state.gitDialog === 'menu' ? '' : 'menu';
      state.gitConfirmAction = '';
      state.gitConfirmExtra = {};
    }
  } else if (target === 'directory') updateNewSession({ step: 'workspace', loading: false, error: '' });
  else if (target === 'newSession') state.newSession = null;
  else if (target === 'history') state.history = null;
  else if (target === 'picker') {
    if (state.pickerSheet === 'model' && state.pickerPage) state.pickerPage = '';
    else state.pickerSheet = '';
  }
  else if (target === 'attachment') state.attachOpen = false;
  else if (target === 'settingsPane') state.settingsPane = '';
  else if (target === 'settings') state.settingsOpen = false;
  else if (target === 'drawer') setDrawerOpen(false);
  else if (target === 'scan') { closeScan(); return; }
  else if (target === 'sessionMenu' || target === 'workspaceMenu') state[target] = '';
  else if (target === 'subagents') state.subagentSheet = false;
  else if (target === 'sessions') state.sessionsOpen = false;
  renderSheet(); renderDialog(); renderLightbox(); renderScreen();
  if (pickerPage && state.pickerSheet === 'model' && !state.pickerPage) {
    queueMicrotask(() => sheetRoot.querySelector(`[data-picker-page="${pickerPage}"]`)?.focus({ preventScroll: true }));
  }
  if (state.settingsOpen) renderSettings();
}

export function scheduleNavigation() {
  if (navigationQueued) return;
  navigationQueued = true;
  queueMicrotask(() => {
    navigationQueued = false;
    const active = lightboxRoot.firstElementChild || dialogRoot.firstElementChild || sheetRoot.firstElementChild
      || (state.settingsOpen ? settings : state.sessionsOpen ? sessionsPage : state.drawerOpen ? el('drawer') : null);
    for (const child of phone.children) {
      child.inert = Boolean(active && child !== toastRoot && child !== active && !child.contains(active));
    }
    if (active === el('drawer')) backdrop.inert = false;
    if (!state.drawerOpen) el('drawer').inert = true;
    el('attach-toggle').setAttribute('aria-expanded', String(state.attachOpen));
    accessChip.setAttribute('aria-expanded', String(state.pickerSheet === 'mode'));
    modelChip.setAttribute('aria-expanded', String(state.pickerSheet === 'model'));
    const target = backTarget(state);
    const menu = active?.matches('.menu-layer') ? active : null;
    menuPositioner.sync(menu, menu ? sheetTrigger() : null, {
      preferAbove: menu?.dataset.anchor === 'composer', alignEnd: Boolean(state.pickerSheet),
    });
    const motionKey = state.pickerSheet ? `picker:${state.pickerSheet}` : surfaceIdentity();
    if (active?.querySelector('.surface-panel') && lastSurfaceKey === motionKey) active.querySelector('.surface-panel').dataset.refreshed = '';
    lastSurfaceKey = active ? motionKey : '';
    focusScope.sync(active, active ? surfaceIdentity() : '');
    navigation.sync();
  });
}

function surfaceIdentity() {
  return `${backTarget(state)}:${state.gitDialog}:${state.settingsPane}:${state.pickerSheet}:${state.pickerPage}:${state.newSession?.step || ''}`;
}

export function preserveSurfaceInput(root) {
  const identity = surfaceIdentity();
  const active = document.activeElement;
  const editing = root.contains(active) && active.matches('input:not([type=checkbox]),textarea');
  const focused = root.contains(active);
  const label = focused ? active.getAttribute('aria-label') : null;
  const text = focused ? active.textContent : '';
  const placeholder = editing ? active.getAttribute('placeholder') : null;
  const selection = editing ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = root.querySelector('.surface-content')?.scrollTop || 0;
  queueMicrotask(() => {
    if (surfaceIdentity() !== identity) return;
    const content = root.querySelector('.surface-content');
    if (content) content.scrollTop = scroll;
    if (!focused || active.isConnected) return;
    const next = editing
      ? [...root.querySelectorAll('input,textarea')].find((node) => node.getAttribute('placeholder') === placeholder)
      : [...(root.querySelector('.surface-panel') || root).querySelectorAll('button,[tabindex]')].find((node) => node.tabIndex >= 0 && !node.disabled && node.getAttribute('aria-label') === label && node.textContent === text) || root.querySelector('.surface-title');
    if (!next || next.disabled || next.closest('[inert]')) return;
    next.focus({ preventScroll: true });
    if (selection && selection[0] !== null) next.setSelectionRange(...selection);
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && backTarget(state) !== 'root') {
    event.preventDefault(); navigation.back();
  }
});
