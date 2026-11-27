// app/settings.js — split from app.js (#442).
import { UnauthorizedError } from '../shell/remote-shell.js';
import { h } from '../ui/dom.js';
import { settingsGroups, gitStatusLine, hostSettingsSection } from '../ui/settings-hub.js?v=20261028-mobile';
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { permissionCommand, DEFAULT_PRESETS } from '../host/permission.js';
import { buttonBusy, clearButtonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { hostCall } from '../host/backend.js';
import { flattenModels, modelChipLabel, effortsFor, isRoutable } from '../host/models.js';
import { sessionUsage, formatTokens } from '../host/projections.js?v=20261028-mobile';
import { applyAppearance, applyComposerPreferences, connectionLabel, operationError, setToast, showBanner, surfaceBusy } from './chrome.js?v=20261117-app-split';
import { renderComposer } from './composer.js?v=20261117-app-split';
import { forceLogout, shell } from './connect.js?v=20261117-app-split';
import { renderConnectionDetailsPane } from './connection-details.js?v=20261117-app-split';
import { el, logList, nativeAndroidApp, options, origin, persistPhoneStore, settings, settingsBack, settingsScroll, settingsTitle, state, store } from './context.js?v=20261117-app-split';
import { renderDialog } from './dialogs.js?v=20261117-app-split';
import { openFilesPane, renderFilesInto } from './files.js?v=20261117-app-split';
import { gitCapsuleNode, refreshGit } from './git.js?v=20261117-app-split';
import { currentModeState, currentRow, renderHeader } from './header.js?v=20261117-app-split';
import { renderLog } from './log.js?v=20261117-app-split';
import { navigationBusy, scheduleNavigation } from './navigation.js?v=20261117-app-split';
import { clearExclusiveDialogs } from './new-session.js?v=20261117-app-split';
import { descNode, fieldInput, ghostButton, groupNode, hairRow, noticeNode, primaryButton, sectionNode, valueNode } from './nodes.js?v=20261117-app-split';
import { openPicker, renderSheet } from './pickers.js?v=20261117-app-split';
import { renderScreen, setDrawerOpen } from './screens.js?v=20261117-app-split';
import { currentModelSelectionProjection, refreshProjections } from './session.js?v=20261117-app-split';
import { runHostCommand } from './session-actions.js?v=20261117-app-split';
import { EXT_PANES, extToggle, loadExtensions, openChangesTab, renderDiffInto, renderExtensionsPane } from './work-panes.js?v=20261117-app-split';

async function requestHost(name, payload = {}) {
  if (state.transport === 'chisacode') {
    showBanner('dshd 远程不能控制电脑窗口；请在电脑端操作');
    return;
  }
  try {
    await shell(name, payload);
    setToast(name === 'openGallery'
      ? '已请求电脑打开外观。请在电脑上点浏览图库。'
      : name === 'openSettings' ? '已请求在电脑打开设置' : '已发送到电脑', { tone: 'info' });
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      showBanner(error.message || '电脑没有响应');
    }
  }
}

async function logoutDevice() {
  if (state.transport === 'chisacode') {
    forceLogout('');
    return;
  }
  try {
    await fetch(`${origin}/__remote__/logout`, { credentials: 'include', redirect: 'manual' });
  } catch { /* 网络失败也照样清态回连接页 */ }
  forceLogout('');
}

// —— 设置 overlay（M4 Hub 钻取 + M5 工作区/文件 pane）—— //

export function openSettings(pane = '') {
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
  state.settingsOpen = true;
  state.settingsPane = pane;
  state.sessionsOpen = false;
  if (pane === '模型') state.modelPane = null;
  setDrawerOpen(false);
  renderSettings();
  renderScreen();
}

export function closeSettings() {
  state.settingsOpen = false;
  state.settingsPane = '';
  renderScreen();
}

const SETTINGS_ROW_ICON_CHILDREN = {
  '阅读与输入': [h('path', { d: 'M4 14.5 3 17l3.2-1.1A7 7 0 1 0 4 14.5Z' })],
  '会话用量': [h('path', { d: 'M4 16.5V11M8.5 16.5V7M13 16.5V9.5M17 16.5V4' })],
  '权限': [h('path', { d: 'M10 2.5 4 5v4.5c0 3.6 2.6 6.6 6 8 3.4-1.4 6-4.4 6-8V5l-6-2.5Z' })],
  '模型': [h('path', { d: 'M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4M4.7 4.7l2.8 2.8M12.5 12.5l2.8 2.8M15.3 4.7l-2.8 2.8M7.5 12.5l-2.8 2.8' })],
  '文件': [h('path', { d: 'M5 2.5h6.5L15 6v11.5H5v-15Z' }), h('path', { d: 'M11 2.5V6.5h4' })],
  '外观': [h('path', { d: 'M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5Z' })],
  '电脑外观': [h('rect', { x: '2.5', y: '3.5', width: '15', height: '10', rx: '1.5' }), h('path', { d: 'M7 16.5h6M10 13.5v3' })],
  '界面设置': [h('path', { d: 'M4 6.5h12M4 13.5h12' }), h('circle', { cx: '8', cy: '6.5', r: '2' }), h('circle', { cx: '13', cy: '13.5', r: '2' })],
  'MCP': [h('path', { d: 'M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0V7ZM10 15v2.5' })],
  '技能': [h('path', { d: 'M4 3.5h9.5A2.5 2.5 0 0 1 16 6v10.5H6.5A2.5 2.5 0 0 1 4 14V3.5Z' }), h('path', { d: 'M4 14a2.5 2.5 0 0 1 2.5-2.5H16' })],
  '插件': [h('path', { d: 'M8 3.5v3M8 13.5v3M3.5 8h3M13.5 8h3' }), h('path', { d: 'M5.5 5.5h9v9h-9z' })],
  '市场': [h('path', { d: 'M4 7h12l-1 9.5H5L4 7Z' }), h('path', { d: 'M7.5 9.5a2.5 2.5 0 0 0 5 0' })],
  '关于': [h('circle', { cx: '10', cy: '10', r: '7' }), h('path', { d: 'M10 9v4.5M10 6.5v.01' })],
};

function settingsRowIcon(pane) {
  const children = SETTINGS_ROW_ICON_CHILDREN[pane] || SETTINGS_ROW_ICON_CHILDREN['关于'];
  return h('svg', { width: '18', height: '18', viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
    h('g', { stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      ...children.map((child) => child.cloneNode(true))));
}

function openSettingsRow(pane) {
  if (pane === '模型' || pane === '权限') {
    state.settingsOpen = false;
    state.settingsPane = '';
    renderScreen();
    openPicker(pane === '模型' ? 'model' : 'mode');
    return;
  }
  state.settingsPane = pane;
  if (pane === '工作区') {
    refreshGit();
    if (state.wsTab === 'files') openFilesPane();
    else openChangesTab();
  }
  if (pane === '文件') openFilesPane();
  if (pane === '模型') state.modelPane = null;
  if (pane === '会话用量') void refreshProjections();
  for (const [kind, name] of Object.entries(EXT_PANES)) {
    // Re-entering a management page always shows fresh Host state.
    if (pane === name && state.transport === 'chisacode') void loadExtensions(kind, { force: true });
  }
  renderSettings();
}

function renderSettingsHub() {
  // Computer card: this phone's connected host + a 「已连接」tag.
  const computer = document.createElement('button');
  computer.type = 'button';
  computer.className = 'group acct';
  const host = document.createElement('b');
  host.textContent = state.hostName;
  const tag = document.createElement('span');
  tag.className = 'acct-tag';
  tag.textContent = '已连接';
  computer.append(host, tag);
  computer.addEventListener('click', () => openSettingsRow('连接详情'));
  options.append(computer);

  // Current workspace card (only when a workspace/title is known).
  const row = currentRow();
  const wsTitle = row?.workspaceTitle
    || state.workspaces?.items?.find((item) => item?.title)?.title || '';
  if (wsTitle) {
    const card = document.createElement('div');
    card.className = 'group promo';
    const h = document.createElement('h3');
    h.textContent = wsTitle;
    const p = document.createElement('p');
    p.textContent = gitStatusLine(state.gitStatus);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'primary-btn promo-btn';
    open.textContent = '打开工作区';
    open.addEventListener('click', () => openSettingsRow('工作区'));
    card.append(h, p, open);
    options.append(card);
  }

  // One card per settings group, no group labels; rows already represented
  // elsewhere (连接详情 / 工作区 / logout) are skipped.
  const groups = settingsGroups({
    channel: connectionLabel(),
    accessMode: currentModeState().currentLabel,
    gitLine: gitStatusLine(state.gitStatus),
    scheme: store.scheme,
    usage: usageSummary(),
  });
  for (const group of groups) {
    const rows = group.rows.filter((item) => (
      !item.danger && item.action !== 'logout' && item.pane !== '连接详情' && item.pane !== '工作区'
    ));
    if (!rows.length) continue;
    const body = document.createElement('div');
    body.className = 'group';
    for (const item of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link-row';
      button.append(settingsRowIcon(item.pane));
      const main = document.createElement('span');
      main.className = 'link-main';
      const title = document.createElement('span');
      title.className = 'link-title';
      title.textContent = item.pane;
      const desc = document.createElement('span');
      desc.className = 'link-desc';
      desc.textContent = item.desc;
      main.append(title, desc);
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.textContent = '›';
      button.append(main, chev);
      button.addEventListener('click', () => openSettingsRow(item.pane));
      body.append(button);
    }
    options.append(body);
  }

  // Danger card at the bottom, then the notice as a bare caption.
  const danger = document.createElement('div');
  danger.className = 'group';
  const dangerRow = document.createElement('button');
  dangerRow.type = 'button';
  dangerRow.className = 'link-row danger';
  dangerRow.append(h('svg', { width: '18', height: '18', viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: 'M8 3.5H4.5v13H8M12 6.5 15.5 10 12 13.5M15.5 10H7.5', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
  const dangerMain = document.createElement('span');
  dangerMain.className = 'link-main';
  const dangerTitle = document.createElement('span');
  dangerTitle.className = 'link-title';
  dangerTitle.textContent = '断开这台设备';
  dangerMain.append(dangerTitle);
  dangerRow.append(dangerMain);
  dangerRow.addEventListener('click', () => logoutDevice());
  danger.append(dangerRow);
  options.append(danger);

  const notice = descNode('手机外观与阅读偏好只存在这台手机；MCP、技能和插件的修改直接写入电脑。', 'row-desc settings-note');
  options.append(notice);
}

function renderPhoneAppearance() {
  options.append(noticeNode('只改这台手机。电脑窗口的色制和背景图在「电脑外观」。'));

  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  for (const [id, label] of [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']]) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.textContent = label;
    tile.setAttribute('aria-pressed', String(store.scheme === id));
    tile.addEventListener('click', () => {
      store.scheme = id;
      persistPhoneStore('scheme', id);
      applyAppearance();
      renderSettings();
    });
    tiles.append(tile);
  }
  options.append(sectionNode('色制', '这台手机用浅色、深色，还是跟随系统。', tiles));

  const sliderRow = document.createElement('div');
  sliderRow.className = 'slider-row';
  const sliderValue = document.createElement('span');
  sliderValue.className = 'slider-value';
  sliderValue.textContent = `${store.glass}%`;
  const slider = document.createElement('input');
  slider.className = 'slider';
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(store.glass);
  slider.setAttribute('aria-label', '玻璃透明度');
  slider.style.setProperty('--fill', `${store.glass}%`);
  slider.addEventListener('input', () => {
    store.glass = Number(slider.value);
    slider.style.setProperty('--fill', `${store.glass}%`);
    sliderValue.textContent = `${store.glass}%`;
    persistPhoneStore('glass', store.glass);
    applyAppearance();
  });
  sliderRow.append(slider, sliderValue);
  options.append(sectionNode('玻璃透明度', '这台手机的毛玻璃。数值越低越通透。不改电脑窗口。', groupNode(sliderRow)));

  const fontInput = fieldInput(store.uiFont, '系统默认', (value) => {
    store.uiFont = value;
    persistPhoneStore('uiFont', value);
    applyAppearance();
  });
  fontInput.setAttribute('aria-label', '界面字体');
  options.append(sectionNode(
    '字体',
    '留空则用系统默认。只作用于这台手机。',
    groupNode(hairRow('界面字体', '', fontInput)),
  ));
}

export async function changeAgentMode(modeId) {
  if (!state.sessionId || state.modeBusy) return;
  const owner = sessionOwner(state);
  state.pickerError = '';
  const before = state.permission.current;
  if (before === modeId) return;
  state.modeBusy = true;
  state.permission = { ...state.permission, current: modeId, planOn: modeId === 'plan' };
  renderComposer();
  renderSettings();
  if (state.pickerSheet) renderSheet();
  try {
    await runHostCommand(permissionCommand(modeId));
    if (!owner.owns()) return;
    showBanner('');
  } catch (error) {
    if (!owner.owns()) return;
    state.permission = { ...state.permission, current: before, planOn: before === 'plan' };
    state.pickerError = error?.message || '切换权限失败';
    showBanner(`切换权限模式失败：${error?.message || '电脑没有响应'}`);
    operationError(`切换权限模式失败：${error?.message || '电脑没有响应'}`, () => changeAgentMode(modeId));
  } finally {
    if (owner.owns()) {
      state.modeBusy = false;
      renderComposer();
      renderSettings();
      if (state.pickerSheet === 'mode') renderSheet();
    }
  }
}

function renderModePane() {
  if (!state.sessionId) {
    options.append(descNode('先打开一个会话。权限预设来自正在跑的 dsh web。'));
    return;
  }
  const group = document.createElement('div');
  group.className = 'group';
  for (const mode of DEFAULT_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sheet-item mode-row';
    button.disabled = state.modeBusy;
    button.setAttribute('aria-pressed', String(mode.id === state.permission.current));
    const main = document.createElement('span');
    main.className = 'sheet-item-main';
    const title = document.createElement('span');
    title.textContent = mode.label;
    main.append(title);
    button.append(main);
    if (mode.id === state.permission.current) {
      const mark = document.createElement('span');
      mark.className = 'mode-current';
      mark.textContent = '当前';
      button.append(mark);
    }
    buttonBusy(button, state.modeBusy && mode.id === state.permission.current, { label: '切换中…' });
    button.addEventListener('click', () => changeAgentMode(mode.id));
    group.append(button);
  }
  options.append(sectionNode('权限预设', '切换会发送 /permission <id>，失败会回滚。', group));
}

export async function changeAgentModel(provider, model, reasoningEffort) {
  if (!state.sessionId || state.modelBusy) return;
  const owner = sessionOwner(state);
  state.pickerError = '';
  const before = state.modelCatalog.current;
  state.modelBusy = true;
  state.modelCatalog = {
    ...state.modelCatalog,
    current: { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) },
  };
  renderComposer();
  renderSettings();
  if (state.pickerSheet === 'model') renderSheet();
  try {
    const selected = await hostCall(owner.client, 'session.selectModel', {
      sessionId: owner.sessionId,
      provider,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
    if (!owner.owns()) return;
    state.modelCatalog = {
      ...state.modelCatalog,
      current: selected?.selected || { provider, model, reasoningEffort },
    };
    showBanner('');
  } catch (error) {
    if (!owner.owns()) return;
    state.modelCatalog = { ...state.modelCatalog, current: before };
    state.pickerError = error?.message || '切换模型失败';
    showBanner(`切换模型失败：${error?.message || '电脑没有响应'}`);
    operationError(`切换模型失败：${error?.message || '电脑没有响应'}`, () => changeAgentModel(provider, model, reasoningEffort));
  } finally {
    if (owner.owns()) {
      state.modelBusy = false;
      renderComposer();
      renderSettings();
      if (state.pickerSheet === 'model') renderSheet();
    }
  }
}

export function loadModelPane() {
  if (!state.sessionId) return;
  const owner = sessionOwner(state);
  const pane = { loading: true, error: '', rows: [] };
  state.modelPane = pane;
  hostCall(state.chisacode.client, 'session.models', { sessionId: state.sessionId })
    .then((catalog) => {
      if (state.modelPane !== pane || !owner.owns()) return;
      state.modelCatalogRaw = catalog;
      state.modelCatalog = flattenModels(catalog, currentModelSelectionProjection());
      state.modelPane = { loading: false, error: '', rows: state.modelCatalog.rows };
      renderSettings();
      if (state.pickerSheet === 'model') renderSheet();
    })
    .catch((error) => {
      if (state.modelPane !== pane || !owner.owns()) return;
      state.modelPane = { loading: false, error: error?.message || '电脑没有响应', rows: [] };
      operationError(`读取模型失败：${state.modelPane.error}`, () => { loadModelPane(); renderSettings(); renderSheet(); });
      renderSettings();
      if (state.pickerSheet === 'model') renderSheet();
    });
}

function renderModelPane() {
  if (!state.sessionId) {
    options.append(descNode('先打开一个会话。模型来自 session.models。'));
    return;
  }
  if (!state.modelPane) loadModelPane();
  const pane = state.modelPane;
  const { current, rows } = state.modelCatalog;
  options.append(sectionNode(
    null,
    null,
    groupNode(hairRow('当前模型', modelChipLabel(current, rows))),
  ));
  if (pane?.loading) {
    surfaceBusy(options, true);
    return;
  }
  surfaceBusy(options, false);
  if (pane?.error) {
    return;
  }
  const group = document.createElement('div');
  group.className = 'group';
  for (const row of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sheet-item mode-row';
    const routable = isRoutable(row);
    button.disabled = state.modelBusy || !routable;
    button.setAttribute('aria-pressed', String(current?.provider === row.provider && current?.model === row.id));
    const main = document.createElement('span');
    main.className = 'sheet-item-main';
    const title = document.createElement('span');
    title.textContent = row.name;
    main.append(title);
    const hint = document.createElement('span');
    hint.className = 'sheet-hint';
    hint.textContent = [
      row.providerName,
      !routable ? '未配置 API Key' : (row.reasoning ? '含思考档' : ''),
    ].filter(Boolean).join(' · ');
    main.append(hint);
    button.append(main);
    buttonBusy(button, state.modelBusy && current?.provider === row.provider && current?.model === row.id, { label: '切换中…' });
    if (routable) button.addEventListener('click', () => changeAgentModel(row.provider, row.id));
    group.append(button);
  }
  options.append(sectionNode('可选模型', '模型清单来自正在跑的 dsh web；切换会立即写回这个会话。', group));
  const efforts = effortsFor(current, rows);
  if (efforts.length) {
    const effortGroup = document.createElement('div');
    effortGroup.className = 'group';
    for (const effort of efforts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-item mode-row';
      button.setAttribute('aria-pressed', String(current?.reasoningEffort === effort.id));
      button.disabled = state.modelBusy;
      const main = document.createElement('span');
      main.className = 'sheet-item-main';
      main.textContent = effort.name || effort.id;
      button.append(main);
      if (current?.reasoningEffort === effort.id) {
        const mark = document.createElement('span');
        mark.className = 'mode-current';
        mark.textContent = '当前';
        button.append(mark);
      }
      buttonBusy(button, state.modelBusy && current?.reasoningEffort === effort.id, { label: '切换中…' });
      button.addEventListener('click', () => {
        if (current) changeAgentModel(current.provider, current.model, effort.id);
      });
      effortGroup.append(button);
    }
    options.append(sectionNode('思考强度', '只对当前模型生效。', effortGroup));
  }
}

function renderWorkspacePane() {
  const gitBlock = document.createElement('div');
  gitBlock.className = 'git-block';
  gitBlock.append(gitCapsuleNode(), descNode(gitStatusLine(state.gitStatus), 'row-desc git-status-line'));
  options.append(gitBlock);
  const tabs = document.createElement('div');
  tabs.className = 'ws-tabs';
  for (const [id, label] of [['changes', '更改'], ['files', '文件']]) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'ws-tab';
    tab.setAttribute('aria-selected', String(state.wsTab === id));
    tab.textContent = label;
    tab.addEventListener('click', () => {
      state.wsTab = id;
      if (id === 'files') openFilesPane();
      if (id === 'changes') openChangesTab();
      renderSettings();
    });
    tabs.append(tab);
  }
  options.append(tabs);
  if (state.wsTab === 'files') {
    renderFilesInto(options);
  } else if (state.transport === 'chisacode') {
    renderDiffInto(options);
  } else {
    options.append(descNode(state.gitStatus.hasWorkingTreeChanges
      ? '有未提交更改。用顶部胶囊提交，或到文件 Tab 插入路径。'
      : '工作区是干净的。'));
  }
}

function renderHostRequestPane(pane) {
  if (state.transport === 'chisacode') {
    options.append(noticeNode(`「${pane}」目前没有手机端入口。`));
    return;
  }
  const section = hostSettingsSection(pane);
  if (section) {
    options.append(sectionNode(
      null,
      '这些项在电脑 Host 上。手机只发送打开请求，不画假清单。',
      primaryButton(`在电脑上打开${pane}`, () => requestHost('openSettings', { sectionId: section })),
    ));
    return;
  }
  options.append(sectionNode(
    null,
    '会话内选项只留在这次连接。电脑窗口关闭行为请在电脑设置里改。',
    ghostButton('在电脑上打开设置', () => requestHost('openSettings')),
  ));
}

/** Phone-only boolean preference row; the consumer re-renders what it affects. */
function preferenceSwitch(key, label, after) {
  return extToggle(store[key], label, () => {
    store[key] = !store[key];
    persistPhoneStore(key, store[key]);
    after?.();
    renderSettings();
  }, false);
}

function choiceTiles(choices, current, label, onChoose) {
  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  tiles.setAttribute('role', 'group');
  tiles.setAttribute('aria-label', label);
  for (const [value, text] of choices) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.textContent = text;
    tile.setAttribute('aria-pressed', String(current === value));
    tile.addEventListener('click', () => onChoose(value));
    tiles.append(tile);
  }
  return tiles;
}

function repaintLogForPreferences() {
  logList.reset();
  renderLog({ anchor: 'hold' });
}

function renderReadingPane() {
  options.append(sectionNode('消息字号', '只改这台手机上对话正文的字号。', choiceTiles(
    [[0.875, '小'], [1, '标准'], [1.125, '大'], [1.25, '特大']], store.messageScale, '消息字号', (value) => {
      store.messageScale = value;
      persistPhoneStore('messageScale', value);
      applyAppearance();
      renderSettings();
    },
  )));
  options.append(sectionNode('对话显示', null, groupNode(
    hairRow('显示思考过程', '关闭后隐藏智能体的思考行。', preferenceSwitch('showReasoning', '显示思考过程', repaintLogForPreferences)),
    hairRow('默认展开工具详情', '新出现的工具调用直接展开输入与结果。', preferenceSwitch('expandTools', '默认展开工具详情', repaintLogForPreferences)),
    hairRow('标题栏 Git 分支', '在对话页头显示分支胶囊；工作区里的 Git 操作始终可用。', preferenceSwitch('gitTitle', '标题栏 Git 分支', renderHeader)),
  )));
  options.append(sectionNode('输入', null, groupNode(
    hairRow('Enter 发送', '外接键盘时 Enter 直接发送，Shift+Enter 换行；Ctrl/⌘+Enter 始终发送。', preferenceSwitch('enterSend', 'Enter 发送', applyComposerPreferences)),
  )));
  options.append(sectionNode('回复进行中发送', '回复还在进行时，新消息排到下一轮，或作为补充转入当前回复。', choiceTiles(
    [['queue', '排到下一轮'], ['steer', '转入当前回复']], store.runningSend, '回复进行中发送', (value) => {
      store.runningSend = value;
      persistPhoneStore('runningSend', value);
      renderComposer();
      renderSettings();
    },
  )));
  options.append(descNode('这些偏好只保存在这台手机，不写回电脑。', 'row-desc settings-note'));
}

function usageSummary() {
  const usage = sessionUsage(state.sessionValues);
  return usage ? `输入 ${formatTokens(usage.input)} · 输出 ${formatTokens(usage.output)}` : '当前会话';
}

function renderUsagePane() {
  if (!state.sessionId) {
    options.append(noticeNode('先打开一个会话，再查看它的用量。'));
    return;
  }
  const usage = sessionUsage(state.sessionValues);
  const refresh = ghostButton('刷新', async () => {
    buttonBusy(refresh, true, { label: '刷新中…' });
    await refreshProjections();
    renderSettings();
  });
  if (!usage) {
    options.append(sectionNode(null, '电脑尚未提供这个会话的用量数据。', refresh));
    return;
  }
  const headline = document.createElement('div');
  headline.className = 'usage-headline';
  const total = document.createElement('b');
  total.textContent = formatTokens(usage.input + usage.output);
  const caption = document.createElement('span');
  caption.textContent = '输入 + 输出 tokens';
  headline.append(total, caption);
  options.append(headline);
  const exact = (count) => valueNode(count.toLocaleString('zh-CN'));
  options.append(sectionNode(null, null, groupNode(
    hairRow('输入', '', exact(usage.input)),
    hairRow('输出', '', exact(usage.output)),
    hairRow('缓存读取', '', exact(usage.cacheRead)),
    hairRow('缓存写入', '', exact(usage.cacheWrite)),
  ), refresh));
  options.append(descNode('只统计这个会话的 token，不代表账户账单。', 'row-desc settings-note'));
}

function renderAboutPane() {
  options.append(sectionNode(null, null, groupNode(
    hairRow('应用', '', valueNode('WhaleIsle（鲸屿） · 手机远程')),
    hairRow('客户端', '', valueNode(nativeAndroidApp ? 'Android 应用内页面' : '浏览器')),
    hairRow('连接', '', valueNode(connectionLabel())),
    hairRow('电脑', '', valueNode(state.hostName)),
  )));
  options.append(descNode('会话内容经 dshd 端到端加密，中继只看到连接元数据。手机外观与阅读偏好只保存在这台设备。', 'row-desc settings-note'));
}

const TASK_PANES = new Set(['工作区', '文件', 'MCP', '技能', '插件']);

export function renderSettings() {
  scheduleNavigation();
  const savedScroll = settingsScroll.get(state.settingsPane) || 0;
  queueMicrotask(() => { options.scrollTop = savedScroll; });
  if (!state.settingsOpen) return;
  const pane = state.settingsPane;
  settings.toggleAttribute('data-task', TASK_PANES.has(pane));
  settingsTitle.textContent = pane || '设置';
  settingsBack.classList.toggle('hidden', !pane);
  el('close-settings').classList.remove('hidden');
  clearButtonBusy(options);
  options.replaceChildren();
  surfaceBusy(options, false);
  if (!pane) {
    renderSettingsHub();
    return;
  }
  if (pane === '外观') {
    renderPhoneAppearance();
    return;
  }
  if (pane === '阅读与输入') {
    renderReadingPane();
    return;
  }
  if (pane === '工作区') {
    renderWorkspacePane();
    return;
  }
  if (pane === '文件') {
    renderFilesInto(options);
    return;
  }
  if (pane === '连接详情') {
    renderConnectionDetailsPane({ onLogout: logoutDevice, onRefresh: renderSettings });
    return;
  }
  if (pane === '权限') {
    renderModePane();
    return;
  }
  if (pane === '模型') {
    renderModelPane();
    return;
  }
  if (pane === '会话用量') {
    renderUsagePane();
    return;
  }
  if (pane === '关于') {
    renderAboutPane();
    return;
  }
  const extKind = Object.keys(EXT_PANES).find((kind) => EXT_PANES[kind] === pane);
  if (extKind && state.transport === 'chisacode') {
    renderExtensionsPane(extKind);
    return;
  }
  renderHostRequestPane(pane);
}

/** Session-scoped panes follow live projection frames; long task panes keep their input. */
export function renderSettingsForSession() {
  if (state.settingsOpen && ['', '权限', '模型', '会话用量'].includes(state.settingsPane)) renderSettings();
}

options.addEventListener('scroll', () => { settingsScroll.set(state.settingsPane, options.scrollTop); });
