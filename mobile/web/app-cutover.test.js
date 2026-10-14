import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.js'), 'utf8');
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8');
const surfaces = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ui', 'surfaces.js'), 'utf8');

test('paired SPA path does not call ACP fetchAgents or createAgent', () => {
  assert.equal(app.includes('fetchAgents'), false, 'app.js still mentions fetchAgents');
  assert.equal(app.includes('createMobileAgent'), false, 'app.js still mentions createMobileAgent');
  assert.equal(app.includes('createAgent('), false, 'app.js still mentions createAgent(');
});

test('paired SPA path does not tell users to create branches on the desktop', () => {
  assert.equal(app.includes('创建新分支（请在电脑端操作）'), false);
  assert.equal(app.includes('请在电脑上发布仓库'), false);
  assert.equal(app.includes('新建分支请在电脑端操作'), false);
});

test('composer and drawer gaps follow the 4px spacing grid', () => {
  assert.match(css, /\.composer-side \{ display: flex; align-items: center; gap: 8px; \}/);
  assert.match(css, /\.session-row \{ display: flex; align-items: center; gap: 4px; \}/);
  assert.equal(css.includes('.composer-side { display: flex; align-items: center; gap: 2px; }'), false);
});

test('Android WebView receives a measured viewport-height fallback for the app shell', () => {
  assert.match(css, /height: var\(--dsh-viewport-height, 100dvh\)/);
  assert.match(app, /syncViewportHeight/);
  assert.match(app, /--dsh-viewport-height/);
});

test('mobile surfaces keep the desktop Menu, Modal, and task roles', () => {
  assert.match(surfaces, /surfaceVariant === 'menu' \? 'menu' : 'dialog'/);
  assert.match(surfaces, /if \(surfaceVariant === 'menu'\) panel\.append\(content\)/);
  assert.match(app, /const task = Boolean\(state\.newSession \|\| state\.history \|\| state\.gitDialog === 'branch'\)/);
  assert.match(app, /const task = !compact/);
  assert.match(css, /\.menu-layer > \.sheet-mask \{ background: transparent; backdrop-filter: none; \}/);
  assert.match(css, /border-radius: 20px; background: var\(--dsw-specific-menu\)/);
  assert.match(css, /width: min\(380px, 100%\)/);
  assert.equal(css.includes('.dialog-layer[data-compact]'), false);
});

test('composer-triggered choices use the bottom-sheet surface variant', () => {
  // surfaces.js: 'bottom' renders a dialog panel with back/close-left header.
  assert.match(surfaces, /surfaceVariant === 'bottom'/);
  assert.match(surfaces, /surface-spacer/);
  // sheetLayer routes picker + attach surfaces to 'bottom'; Git/session menus stay 'menu'.
  assert.match(app, /const bottom = !task && Boolean\(state\.pickerSheet \|\| state\.attachOpen\)/);
  assert.match(app, /variant: task \? 'task' : bottom \? 'bottom' : 'menu'/);
  assert.match(css, /\.bottom-layer > \.sheet \{[\s\S]*?border-radius: 24px 24px 0 0;/);
  assert.match(css, /@keyframes bottom-sheet-in/);
});

test('narrow composer remains one desktop-style tool row', () => {
  assert.match(css, /\.composer-row \{[\s\S]*?flex-wrap: nowrap;/);
  assert.match(css, /\.chip \{[\s\S]*?height: 32px;[\s\S]*?border-radius: 16px;/);
  assert.match(css, /\.send \{[\s\S]*?width: 32px; height: 32px;/);
  assert.equal(css.includes('grid-template-columns: minmax(64px, 1fr)'), false);
  assert.equal(css.includes('.phone .icon-btn, .phone .surface-control, .phone .phone-menu, .phone .send {\n  width: 44px'), false);
});

test('picker selection follows desktop trailing-check semantics', () => {
  assert.match(app, /mark\.textContent = '✓'/);
  assert.match(css, /\.sheet \.mode-row\[aria-pressed="true"\] \{ background: transparent; \}/);
});

test('paired SPA executes host slash commands, not session.prompt as /permission chat', () => {
  assert.match(app, /commands\/execute/);
  assert.match(app, /commands\/list/);
  assert.match(app, /runHostCommand\(permissionCommand\(modeId\)\)/);
  assert.equal(app.includes('promptPayload([textBlock(permissionCommand'), false);
  assert.equal(app.includes("promptPayload([textBlock('/plan off')])"), false);
});

test('new-session browse unwraps workspace.create nested id and keeps open blank sessions', () => {
  assert.match(app, /workspaceIdFromCreate\(/);
  assert.match(app, /heldSessionRow\(/);
  assert.match(app, /withHeldLiveRow\(/);
});

test('drawer workspace mutations stay on 0.1.2 host verbs and never use window.prompt', () => {
  assert.match(app, /insertSessionMove\(/);
  assert.match(app, /browseStartPath\(/);
  assert.match(app, /hostCall\([^,]+, 'agentPreset\.list'/);
  assert.match(app, /presetChoices\(/);
  assert.equal(app.includes("window.prompt('工作区名称'"), false);
  assert.equal(app.includes("window.prompt('新文件夹名称')"), false);
});

test('approval respond confirms host history after an E2EE ack timeout', () => {
  assert.match(app, /deliverApprovalRespond\(/);
  assert.match(app, /session\.history/);
});

test('history poll hydrates unanswered approval/asked into the strip', () => {
  assert.match(app, /pendingFromHistoryEvents\(/);
  assert.match(app, /mergeApprovalPending\(/);
  const poll = app.slice(app.indexOf('historyPollTimer = setInterval'));
  assert.match(poll, /applyHistoryPayload\(payload\)/);
  assert.match(poll, /renderApproval\(\)/);
});

test('open chat exposes the host session id on #phone for the current row', () => {
  assert.match(app, /phone\.dataset\.sessionId = row\?\.sessionId \|\| ''/);
});

test('opening a session refreshes Git so the titlebar pill can show', () => {
  assert.match(app, /void refreshGit\(\)/);
});

test('non-repo Git pill stays visible so Initialize Git is reachable', () => {
  assert.match(app, /state\.gitStatus\.isRepo === false/);
  assert.match(app, /Initialize Git/);
});

test('closing Git progress keeps a reachable view of the running operation and its latest step', () => {
  const element = tag => ({
    tag, children: [], dataset: {}, listeners: {}, textContent: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
  });
  const toastRoot = element('root');
  const state = {
    gitBusy: true, gitProgressDismissed: false, gitProgress: 'push',
    gitToast: '', toastActions: [], toastTone: 'info', gitDialog: 'commit',
  };
  const context = { state, toastRoot, document: { createElement: element }, svgNode: () => element('svg'), clearTimeout, toastTimer: null };
  runInNewContext(app.slice(app.indexOf('function renderToast()'), app.indexOf('function renderLightbox()')), context);
  const toast = () => toastRoot.children[0].children[0];
  context.renderToast();
  toast().children.at(-1).listeners.click();
  assert.equal(state.gitBusy, true, 'closing progress does not finish the operation');
  assert.equal(state.gitDialog, 'commit');
  assert.equal(toast().tag, 'button', 'recovery remains available while the Git dialog is pending');
  assert.equal(toast().textContent, '查看 Git 进度 · push');
  state.gitProgress = 'create-change-request';
  context.renderToast();
  assert.equal(toast().textContent, '查看 Git 进度 · create-change-request');
  toast().listeners.click();
  assert.equal(state.gitBusy, true);
  assert.equal(state.gitProgressDismissed, false);
  assert.equal(toast().children[1].children[0].textContent, 'Git: create-change-request');
  state.gitBusy = false;
  state.gitToast = '完成';
  state.toastTone = 'success';
  context.renderToast();
  assert.equal(toast().tag, 'div', 'completion replaces the pending recovery entry');
  assert.equal(toast().children[1].children[0].textContent, '完成');
});

test('drawer hides untitled blank rows that arrive live via host/session-added', () => {
  const render = app.slice(app.indexOf('function renderSessions()'), app.indexOf('function renderSessions()') + 600);
  assert.match(render, /!isUntitledBlank\(row\)/);
  assert.match(app, /import \{ isUntitledBlank, sessionTitle \} from '\.\/conversation\/title\.js'/);
});

test('paired SPA subscribes the catalog mux right after connect, not only on openSession', () => {
  const connectTail = app.slice(app.indexOf('async function finishChisaCodeConnect'), app.indexOf('async function connect('));
  assert.match(connectTail, /startLiveFollow\(\)/);
  assert.match(app, /catalogRefreshReason\(payload\)/);
});

test('running→idle status frame triggers one final history pull for the open session', () => {
  const mux = app.slice(app.indexOf('function handleMuxFrame'), app.indexOf('function startLiveFollow'));
  // host/session-status is consumed by the applyHostFrame branch; the idle
  // pull sits outside that if/else so both frame shapes reach it, and a
  // delayed second pull covers the assistant message committing after idle.
  assert.match(mux, /if \(idleFor && idleFor === state\.sessionId\) \{\s*void pullCurrentHistory\(\);/);
  assert.match(mux, /setTimeout\(\(\) => \{ if \(state\.sessionId === idleFor\) void pullCurrentHistory\(\); \}, 1500\)/);
  assert.match(app, /function pullCurrentHistory\(\)/);
});

test('sendPrompt refuses images on a model that declares no image input before session.prompt', () => {
  const send = app.slice(app.indexOf('async function sendPrompt()'), app.indexOf("await call('session.prompt'"));
  assert.match(send, /attachmentGuard\(\{ current: currentModelState\(\)\.current, attachments: images \}\)/);
  assert.match(send, /showBanner\(guard\.message\)/);
});

test('search input enters search mode before the debounce so live frames cannot repaint the full list', () => {
  const handler = app.slice(app.indexOf("search.addEventListener('input'"), app.indexOf("draft.addEventListener('input'"));
  assert.match(handler, /state\.searchLoading = Boolean\(state\.query\.trim\(\)\)/);
  assert.match(handler, /renderSessions\(\);\s*clearTimeout\(searchTimer\)/);
});

test('logout rotates the mobile clientId so an in-tab re-pair does not stall', () => {
  const logout = app.slice(app.indexOf('function forceLogout'), app.indexOf('async function shell('));
  assert.match(logout, /clearSecret\(serverId\);[\s\S]*rotateClientId\(\);/);
});

test('sending the first prompt promotes the blank session into the live drawer', () => {
  const send = app.slice(app.indexOf('async function sendPrompt()'), app.indexOf('async function cancelRun()'));
  assert.match(send, /row\.blank = false/);
  assert.match(send, /promoteHeldLive\(\)/);
});

test('drawer search is host session.search with a 20-hit hasMore hint', () => {
  assert.match(app, /hostCall\(paired\.client, 'session\.search', \{ query, limit: 20 \}\)/);
  assert.match(app, /state\.searchHasMore = result\.hasMore === true \|\| items\.length > 20/);
  assert.match(app, /还有更多结果，请改用更精确的词/);
});

test('destructive confirm dialogs win over leftover rename or mkdir dialogs', () => {
  assert.match(app, /function clearExclusiveDialogs\(/);
  const confirm = app.slice(app.indexOf('function startSessionConfirm'));
  assert.match(confirm, /clearExclusiveDialogs\(/);
  const dialog = app.slice(app.indexOf('function renderDialog()'));
  const confirmIdx = dialog.indexOf('if (state.sessionConfirm)');
  const renameIdx = dialog.indexOf('if (state.workspaceRename)');
  assert.equal(confirmIdx >= 0 && renameIdx >= 0 && confirmIdx < renameIdx, true, 'sessionConfirm must render before workspaceRename');
});

test('paired SPA uses host history poll and freeze bars, not ACP files', () => {
  assert.match(app, /historyQuery\(/);
  assert.match(app, /sessionRowForest/);
  assert.match(app, /subscribeHostMux/);
  assert.match(app, /session\.selectModel/);
  assert.match(app, /gitCreateBranch/);
  assert.match(app, /host\.listDirectory/);
  assert.match(app, /freezePane/);
  assert.equal(app.includes('openEventSockets({ origin'), false);
});
