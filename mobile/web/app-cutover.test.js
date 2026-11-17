import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { clearButtonBusy } from './ui/button-busy.js';
import { h } from './ui/dom.js';
import { gitTunnelAction, gitCommitPayload } from './git/bridge.js';

const webDir = dirname(fileURLToPath(import.meta.url));
// #442: app.js was split into mobile/web/app/*.js. Assertions below run against
// the concatenated split sources; slices strip import/export so runInNewContext
// can evaluate the moved functions just like they behaved inside app.js.
const appDir = join(webDir, 'app');
const appFiles = ['app.js', ...(existsSync(appDir) ? readdirSync(appDir).filter((f) => f.endsWith('.js')).sort().map((f) => join('app', f)) : [])];
const sources = new Map(appFiles.map((f) => [f, readFileSync(join(webDir, f), 'utf8')]));
const appSource = [...sources.values()].join('\n');
const app = appSource.replace(/^import\b[^;]*;/gm, '').replace(/^export /gm, '');
const css = readFileSync(join(webDir, 'app.css'), 'utf8');
const surfaces = readFileSync(join(webDir, 'ui', 'surfaces.js'), 'utf8');

// Slice one moved function cluster from whichever split file contains startMarker.
const sliceInFile = (startMarker, endMarker) => {
  const text = [...sources.values()].find((t) => t.includes(startMarker));
  assert.ok(text, `no app module contains ${startMarker}`);
  const start = text.indexOf(startMarker);
  const end = endMarker ? text.indexOf(endMarker, start) : -1;
  return text.slice(start, end >= 0 ? end : undefined).replace(/^export /gm, '');
};

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

test('unsaved appearance keeps the default glass value while an explicit zero remains valid', () => {
  const context = { localStorage: { getItem: () => null } };
  runInNewContext(sliceInFile('const PHONE_KEYS = ', 'function persistPhoneStore('), context);
  assert.equal(context.readPhoneStore().glass, 80);
  context.localStorage.getItem = (key) => key === 'dsh-phone-glass' ? '0' : null;
  assert.equal(context.readPhoneStore().glass, 0);
  context.localStorage.getItem = (key) => key === 'dsh-phone-glass' ? '101' : null;
  assert.equal(context.readPhoneStore().glass, 80);
});

test('Android WebView receives a measured viewport-height fallback for the app shell', () => {
  assert.match(css, /height: var\(--dsh-viewport-height, 100dvh\)/);
  assert.match(app, /syncViewportHeight/);
  assert.match(app, /--dsh-viewport-height/);
});

test('mobile surfaces keep desktop Menu, Modal and full-task roles', () => {
  assert.match(surfaces, /surfaceVariant === 'menu' \? 'menu' : 'dialog'/);
  assert.match(surfaces, /if \(surfaceVariant === 'menu' && !onBack\) panel\.append\(content\)/);
  assert.match(app, /const task = !compact/);
  assert.match(css, /\.menu-layer > \.sheet-mask \{ background: transparent; backdrop-filter: none; \}/);
  assert.match(css, /border-radius: 12px; background: var\(--dsw-specific-menu\)/);
  assert.match(css, /width: min\(380px, 100%\)/);
});

test('short choices stay compact while directory, archive and branch lists keep task navigation', () => {
  const capture = [];
  const state = {};
  const context = {
    state, document: {}, navigationBusy: () => false, navigation: { back() {} },
    el: () => ({ querySelectorAll: () => [] }), accessChip: {}, gitPill: {},
    phone: { getBoundingClientRect: () => ({ width: 390, height: 844, top: 0, bottom: 844, left: 0 }) },
    createSurface: (_document, options) => {
      capture.push(options);
      return { layer: { dataset: {}, style: { setProperty() {} } }, panel: { setAttribute() {} }, content: {} };
    },
  };
  runInNewContext(sliceInFile('function sheetLayer(', 'function closeGitLayer('), context);
  for (const [patch, variant, anchor] of [
    [{ pickerSheet: 'model' }, 'menu', 'composer'],
    [{ pickerSheet: 'mode' }, 'menu', 'composer'],
    [{ attachOpen: true }, 'menu', 'composer'],
    [{ newSession: { step: 'workspace' } }, 'modal', 'viewport'],
    [{ newSession: { step: 'browse' } }, 'task', 'viewport'],
    [{ history: { rows: [] } }, 'task', 'viewport'],
    [{ gitDialog: 'branch' }, 'task', 'viewport'],
    [{ gitDialog: 'menu' }, 'menu', 'header'],
    [{ sessionMenu: 's-1' }, 'menu', 'viewport'],
  ]) {
    Object.assign(state, { pickerSheet: '', attachOpen: false, newSession: null, history: null, gitDialog: '', sessionMenu: '', pickerPage: '' }, patch);
    context.sheetLayer('Choice', () => {});
    const options = capture.at(-1);
    assert.equal(options.variant, variant);
    assert.equal(options.task, variant === 'task');
    assert.equal(options.anchor, anchor);
  }
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
  assert.match(app, /pendingFromHistoryEvents\(state\.events/);
  assert.match(app, /mergeApprovalPending\(/);
  const poll = sliceInFile('historyPollTimer = setInterval');
  assert.match(poll, /applyHistoryPayload\(payload, \{ merge: true \}\)/);
  assert.match(poll, /renderApproval\(\)/);
});

test('live history ticks fetch a small window and keep older pages the user loaded', () => {
  const pull = sliceInFile('function pullCurrentHistory()', 'function forceLogout(');
  assert.match(pull, /maxMessages: POLL_PAGE_MESSAGES/);
  assert.match(pull, /mergeLatestHistory\(state\.events, hostHistoryPage\(payload\)\)\.contiguous/);
  assert.match(pull, /payload = await fetchPage\(\{\}\)/);
  const apply = sliceInFile('function applyHistoryPayload(', 'let projectionsInflight');
  assert.match(apply, /if \(!merged\.keptOlder\) state\.timelinePage =/);
  const poll = sliceInFile('historyPollTimer = setInterval', 'let historyPullInflight');
  assert.match(poll, /document\.visibilityState === 'hidden'/);
});

test('sends carry a stable request id and show a pending bubble until the host echoes them', () => {
  const send = sliceInFile('async function sendPrompt()', 'function finishSubmittedDraft(');
  assert.match(send, /promptIdentity\(state\.promptIdentity/);
  assert.match(send, /requestId: identity\.requestId, mode/);
  assert.match(send, /receipt\?\.value\?\.accepted === false/);
  assert.match(send, /state\.outbox = state\.outbox\.filter\(\(item\) => item !== entry\)/);
  assert.match(send, /store\.runningSend === 'steer' \? 'steer' : 'queue'/);
});

test('the conversation log reuses unchanged row nodes instead of replacing the whole list', () => {
  const render = sliceInFile('function renderLog(', 'async function loadOlderMessages()');
  assert.match(render, /logList\.nodes\(rows/);
  assert.match(render, /reconcileChildren\(logEl, nodes\)/);
  assert.equal(render.includes('logEl.replaceChildren('), false);
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

test('Git progress stays on operation controls and failure feedback has no close button', () => {
  const element = tag => ({
    tag, children: [], dataset: {}, listeners: {}, textContent: '',
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    querySelectorAll() { return []; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
  });
  const toastRoot = element('root');
  const state = {
    gitBusy: true, gitProgressDismissed: false, gitProgress: 'push',
    gitToast: '', toastActions: [], toastTone: 'info', gitDialog: 'commit',
  };
  const context = { state, toastRoot, clearButtonBusy, h,
    document: {
      createElement: element,
      createElementNS: (_ns, tag) => element(tag),
      createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    },
    clearTimeout, toastTimer: null };
  runInNewContext(sliceInFile('function renderToast()', 'function renderLightbox()'), context);
  const toast = () => toastRoot.children[0].children[0];
  // The real h() builds nodes through the global document, so the fake
  // factories are installed for the duration of the two render passes.
  const previousDocument = globalThis.document;
  globalThis.document = context.document;
  try {
    context.renderToast();
    assert.equal(toastRoot.children.length, 0, 'running operation must not create a second progress surface');
    assert.equal(state.gitBusy, true);
    assert.equal(state.gitDialog, 'commit');
    state.gitBusy = false;
    state.gitToast = '推送失败';
    state.toastTone = 'error';
    context.renderToast();
  } finally {
    globalThis.document = previousDocument;
  }
  assert.equal(toast().tag, 'div');
  assert.equal(toast().children[1].children[0].textContent, '推送失败');
  assert.equal(toast().children.length, 2, 'only status icon and message; no close X');
});

test('Git starts with locked visible controls, advances feedback, and sends each step once', async () => {
  const calls = [], renders = [];
  let finish;
  const state = {
    cwd: '/fixture', gitBusy: false, gitRetry: null, pendingStacked: 'commit_push',
    commitMessage: 'fixture', commitOnNewBranch: false, commitFiles: null,
  };
  const owner = { client: {}, sessionId: 'fixture', owns: () => true };
  const context = {
    state, gitTunnelAction, gitCommitPayload, sessionOwner: () => owner,
    clearTimeout, toastTimer: null,
    renderToast: () => renders.push('toast'), renderSettings: () => renders.push('settings'),
    renderSheet: () => renders.push('sheet'), renderDialog: () => renders.push('dialog'),
    refreshGitButtonFeedback: () => calls.push(`feedback:${state.gitProgress}`),
    setToast: () => {}, refreshGit: async () => {}, operationError: message => { throw new Error(message); },
    gitCall: async (_client, action) => { calls.push(action); },
    runStackedGit: async (run, _stacked, _body, { onProgress }) => {
      onProgress('git-commit');
      await run('git-commit');
      await new Promise(resolve => { finish = resolve; });
      onProgress('git-push');
      await run('git-push');
    },
  };
  runInNewContext(sliceInFile('async function gitAction(', 'function maybeConfirm('), context);
  const pending = context.gitAction('gitCommit');
  assert.equal(state.gitBusy, true);
  assert.deepEqual(renders.slice(0, 4), ['toast', 'settings', 'sheet', 'dialog']);
  assert.equal(await context.gitAction('gitCommit'), false, 'second activation cannot start another request');
  await Promise.resolve();
  finish();
  assert.equal(await pending, true);
  assert.deepEqual(calls, ['feedback:commit', 'git-commit', 'feedback:push', 'git-push']);
  assert.equal(state.gitBusy, false);
});

test('drawer hides untitled blank rows that arrive live via host/session-added', () => {
  const render = sliceInFile('function renderSessions()').slice(0, 600);
  assert.match(render, /!isUntitledBlank\(row\)/);
  assert.match(appSource, /import \{[^}]*isUntitledBlank[^}]*\} from '\.\.?\/conversation\/title\.js/);
  assert.match(appSource, /import \{[^}]*sessionTitle[^}]*\} from '\.\.?\/conversation\/title\.js/);
});

test('paired SPA subscribes the catalog mux right after connect, not only on openSession', () => {
  const connectTail = sliceInFile('async function finishChisaCodeConnect', 'async function connect(');
  assert.match(connectTail, /startLiveFollow\(\)/);
  assert.match(app, /catalogRefreshReason\(payload\)/);
});

test('running→idle status frame triggers one final history pull for the open session', () => {
  const mux = sliceInFile('function handleMuxFrame', 'function startLiveFollow');
  // host/session-status is consumed by the applyHostFrame branch; the idle
  // pull sits outside that if/else so both frame shapes reach it, and a
  // delayed second pull covers the assistant message committing after idle.
  assert.match(mux, /if \(idleFor && idleFor === state\.sessionId\) \{\s*void pullCurrentHistory\(\);/);
  assert.match(mux, /setTimeout\(\(\) => \{ if \(state\.sessionId === idleFor\) void pullCurrentHistory\(\); \}, 1500\)/);
  assert.match(app, /function pullCurrentHistory\(\)/);
});

test('sendPrompt refuses images on a model that declares no image input before session.prompt', () => {
  const send = sliceInFile('async function sendPrompt()', "await call('session.prompt'");
  assert.match(send, /attachmentGuard\(\{ current: currentModelState\(\)\.current, attachments: images \}\)/);
  assert.match(send, /showBanner\(guard\.message\)/);
});

test('search input enters search mode before the debounce so live frames cannot repaint the full list', () => {
  const handler = sliceInFile("search.addEventListener('input'");
  assert.match(handler, /state\.searchLoading = Boolean\(state\.query\.trim\(\)\)/);
  assert.match(handler, /renderSessions\(\);\s*clearTimeout\(searchTimer\)/);
});

test('logout rotates the mobile clientId so an in-tab re-pair does not stall', () => {
  const logout = sliceInFile('function forceLogout', 'async function shell(');
  assert.match(logout, /clearSecret\(serverId\);[\s\S]*rotateClientId\(\);/);
});

test('sending the first prompt promotes the blank session into the live drawer', () => {
  const send = sliceInFile('async function sendPrompt()', 'async function cancelRun()');
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
  const confirm = sliceInFile('function startSessionConfirm');
  assert.match(confirm, /clearExclusiveDialogs\(/);
  const dialog = sliceInFile('function renderDialog()');
  const confirmIdx = dialog.indexOf('if (state.sessionConfirm)');
  const renameIdx = dialog.indexOf('if (state.workspaceRename)');
  assert.equal(confirmIdx >= 0 && renameIdx >= 0 && confirmIdx < renameIdx, true, 'sessionConfirm must render before workspaceRename');
});

test('paired SPA uses host history poll and formal Host services, not ACP files', () => {
  assert.match(app, /historyQuery\(/);
  assert.match(app, /groupSessionRows|subagentSheetItems/);
  assert.match(app, /subscribeHostMux/);
  assert.match(app, /session\.selectModel/);
  assert.match(app, /gitCreateBranch/);
  assert.match(app, /host\.listDirectory/);
  for (const method of [
    'workspaceFiles.list', 'workspaceFiles.read', 'workspaceFiles.readImage', 'session.projections',
    'session.attachment', 'session.updateQueue', 'mcpServers.list', 'skillInventory.list',
    'skillInventory.get', 'pluginInventory.list', 'pluginManager.listBundles',
  ]) assert.ok(app.includes(`'${method}'`), method);
  assert.match(app, /gitCall\(owner\.client, 'git-diff', cwd/);
  assert.equal(app.includes('freezePane'), false);
  assert.equal(app.includes('listDirectoryView'), false);
  assert.equal(app.includes('openEventSockets({ origin'), false);
});
