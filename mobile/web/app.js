// Split #442: app.js keeps the boot sequence and cross-page event wiring;
// feature pages and shared runtime live under ./app/.
// Keep ESM child modules on the same cache-busting contract as index.html.
// Mobile WebViews cache module URLs independently, so updating app.js alone
// can otherwise combine a new parent with an older fold implementation.
import { buttonBusy } from './ui/button-busy.js?v=20261021-button-feedback';
import { hasOfferFragment, listStickyServerIds, getMostRecentStickyServerId } from './chisacode/session.js';
import { applyAppearance, applyComposerPreferences, showBanner, showError } from './app/chrome.js?v=20261117-app-split';
import { renderComposer } from './app/composer.js?v=20261117-app-split';
import { connect, connectSaved } from './app/connect.js?v=20261117-app-split';
import { accessChip, backdrop, blankWorkspaceChip, el, phone, planChip, settingsBack, state, stopBtn, subagentsBtn } from './app/context.js?v=20261117-app-split';
import { openSessionsPage, openSubagentSheet } from './app/drawer.js?v=20261117-app-split';
import { navigation, navigationBusy } from './app/navigation.js?v=20261117-app-split';
import { openDirectoryBrowse, startNewSessionChooser } from './app/new-session.js?v=20261117-app-split';
import { openPicker, renderSheet } from './app/pickers.js?v=20261117-app-split';
import { initScanButton } from './app/scan.js?v=20261117-app-split';
import { openWorkspacePane, renderScreen, setDrawerOpen } from './app/screens.js?v=20261117-app-split';
import { cancelRun, createSession, runHostCommand } from './app/session-actions.js?v=20261117-app-split';
import { closeSettings, openSettings } from './app/settings.js?v=20261117-app-split';

el('menu').addEventListener('click', () => {
  setDrawerOpen(!phone.hasAttribute('data-drawer'));
});

backdrop.addEventListener('click', () => setDrawerOpen(false));

el('drawer-close').addEventListener('click', () => setDrawerOpen(false));

el('drawer-add-workspace').addEventListener('click', () => {
  startNewSessionChooser();
  void openDirectoryBrowse();
});

el('new-session').addEventListener('click', () => {
  createSession().catch((error) => showBanner(error.message));
});

el('new-chat-top').addEventListener('click', () => {
  createSession().catch((error) => showBanner(error.message));
});

subagentsBtn.addEventListener('click', () => openSubagentSheet());

el('nav-sessions').addEventListener('click', () => openSessionsPage());

el('nav-workspace').addEventListener('click', () => openWorkspacePane());

el('nav-settings').addEventListener('click', () => openSettings(''));

el('drawer-account').addEventListener('click', () => openSettings('连接详情'));

el('sessions-back').addEventListener('click', () => {
  navigation.back();
});

el('sessions-new').addEventListener('click', () => {
  createSession().catch((error) => showBanner(error.message));
});

settingsBack.addEventListener('click', () => {
  navigation.back();
});

el('close-settings').addEventListener('click', () => closeSettings());

el('settings-mask').addEventListener('click', () => closeSettings());

stopBtn.addEventListener('click', () => cancelRun());

el('attach-toggle').addEventListener('click', () => {
  if (navigationBusy()) return;
  state.pickerSheet = '';
  state.pickerPage = '';
  state.newSession = null;
  state.attachOpen = !state.attachOpen;
  state.gitDialog = '';
  renderSheet();
});

accessChip.addEventListener('click', () => openPicker('mode'));

planChip.addEventListener('click', () => {
  if (!state.sessionId || planChip.disabled) return;
  planChip.disabled = true;
  buttonBusy(planChip, true, { label: '关闭中…' });
  runHostCommand('/plan off').then(() => {
    renderComposer();
  }).catch((error) => showBanner(error.message || '无法关闭计划')).finally(() => {
    planChip.disabled = false;
    buttonBusy(planChip, false);
  });
});

el('model-chip').addEventListener('click', () => openPicker('model'));

blankWorkspaceChip?.addEventListener('click', () => startNewSessionChooser());

// —— 启动 —— //

window.addEventListener('hashchange', () => {
  if (hasOfferFragment(location.hash)) void connect(location.href);
});

applyAppearance();

applyComposerPreferences();

renderComposer();

renderScreen();

initScanButton();

if (hasOfferFragment(window.location.hash)) {
  connect(window.location.href).catch((error) => showError(error.message || '配对链接无效'));
} else if (listStickyServerIds().length) {
  // Auto-reconnect targets the most recent computer; the connect screen's
  // saved-computer rows stay disabled until this attempt settles.
  void connectSaved(getMostRecentStickyServerId());
}
