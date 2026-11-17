// app/screens.js — split from app.js (#442).
import { visibleScreen } from '../ui/chrome.js';
import { renderSavedComputers } from './connect.js?v=20261117-app-split';
import { backdrop, el, phone, screenChat, screenConnect, screenPermission, screenScan, sessionsPage, settings, state } from './context.js?v=20261117-app-split';
import { openFilesPane } from './files.js?v=20261117-app-split';
import { refreshGit } from './git.js?v=20261117-app-split';
import { scheduleNativeSnapshot } from './native.js?v=20261117-app-split';
import { scheduleNavigation } from './navigation.js?v=20261117-app-split';
import { renderBlankHero } from './session.js?v=20261117-app-split';
import { openSettings } from './settings.js?v=20261117-app-split';
import { openChangesTab } from './work-panes.js?v=20261117-app-split';

export function renderScreen() {
  scheduleNavigation();
  const name = visibleScreen(state);
  if (name === 'connect') renderSavedComputers();
  screenConnect.classList.toggle('hidden', name !== 'connect');
  screenScan.classList.toggle('hidden', name !== 'scan');
  screenPermission.classList.toggle('hidden', name !== 'permission');
  screenChat.classList.toggle('hidden', name !== 'chat');
  settings.classList.toggle('hidden', !(name === 'chat' && state.settingsOpen));
  sessionsPage.classList.toggle('hidden', !(name === 'chat' && state.sessionsOpen));
  renderBlankHero();
  scheduleNativeSnapshot();
}

// The drawer owns its close control and shares the normal Back hierarchy.
export function setDrawerOpen(open) {
  state.drawerOpen = open;
  phone.toggleAttribute('data-drawer', open);
  backdrop.classList.toggle('hidden', !open);
  el('menu').setAttribute('aria-expanded', open ? 'true' : 'false');
  scheduleNavigation();
}

export function openWorkspacePane() {
  openSettings('工作区');
  refreshGit();
  if (state.wsTab === 'files') openFilesPane();
  else openChangesTab();
}
