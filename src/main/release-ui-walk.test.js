'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertReleaseQaResult,
  QA_REQUIRED_STEPS,
  PAGE_HELPERS,
  waitForComposerIdle,
  waitForComposerSubmission,
  probeSessionLogMenu,
  probeGitCommitMenu,
  probeRemoteEntry,
  probeSignedOutAccountMenu,
  probeAppearanceControls,
} = require('./release-ui-walk');
const vm = require('node:vm');

/** Small DOM face: execute the real injected helpers and click callbacks. */
function pageNode(attributes = {}, text = '', queries = {}) {
  return {
    disabled: false,
    textContent: text,
    innerText: text,
    getAttribute: (name) => attributes[name] ?? null,
    closest: () => null,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 30 }),
    querySelector: (selector) => (queries[selector] || [])[0] || null,
    querySelectorAll: (selector) => queries[selector] || (selector.startsWith('button, ') ? queries.controls || [] : []),
    click() {},
    focus() {},
    scrollIntoView() {},
    dispatchEvent() {},
  };
}

function pageWorld(queries = {}, ids = {}) {
  const document = pageNode({}, '', queries);
  document.getElementById = (id) => ids[id] || null;
  const context = vm.createContext({ document,
    window: { getSelection: () => null },
    KeyboardEvent: class {},
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) });
  vm.runInContext(PAGE_HELPERS, context);
  return {
    eval: (script) => vm.runInContext(script, context),
    wc: { executeJavaScript: async (script) => vm.runInContext(script, context) },
  };
}

test('account probe waits for both signed-out actions and ignores another open menu', async () => {
  const unrelated = pageNode({}, '', { controls: [pageNode({}, 'Settings')] });
  const accountControls = [pageNode({}, 'Sign in')];
  const account = pageNode({}, '', { controls: accountControls });
  const world = pageWorld({ '[role="menu"]': [unrelated, account] });
  let reads = 0;
  const wc = { executeJavaScript: async (script) => {
    const value = await world.wc.executeJavaScript(script);
    reads++;
    if (reads === 1) accountControls.push(pageNode({}, 'Contact us'));
    return value;
  } };
  const result = await probeSignedOutAccountMenu(wc, 2_000);
  assert.equal(reads, 2, 'a menu with only Sign in is not ready');
  assert.equal(result.signIn, true);
  assert.equal(result.contact, true);
});

test('account probe reports failure when the missing signed-out action never mounts', async () => {
  const account = pageNode({}, '', { controls: [pageNode({}, 'Sign in')] });
  const world = pageWorld({ '[role="menu"]': [account] });
  assert.equal(await probeSignedOutAccountMenu(world.wc, 10), null,
    'a partial snapshot cannot become success at the deadline');
});

test('appearance probe waits for the active Settings page and both wallpaper controls', async () => {
  const navAttrs = { 'aria-current': 'false' };
  const controls = [];
  const settingsQueries = { controls, 'h1, h2, h3': [] };
  const otherDialog = pageNode({ 'aria-label': 'Other dialog' }, '', {
    controls: [pageNode({}, 'Choose image'), pageNode({}, 'Browse gallery')],
    'h1, h2, h3': [pageNode({}, 'Wallpaper')],
  });
  const settings = pageNode({ 'aria-label': 'Settings' }, '', settingsQueries);
  const world = pageWorld({ '[role="dialog"]': [otherDialog, settings],
    '[data-dsh-settings-section="appearance"]': [pageNode(navAttrs)] });
  let reads = 0;
  const wc = { executeJavaScript: async (script) => {
    const value = await world.wc.executeJavaScript(script);
    reads++;
    if (reads === 1) {
      navAttrs['aria-current'] = 'true';
      settingsQueries['h1, h2, h3'] = [pageNode({}, 'Wallpaper')];
      controls.push(pageNode({}, 'Choose image'));
    } else if (reads === 2) {
      controls.push(pageNode({}, 'Browse gallery'));
    }
    return value;
  } };
  const result = await probeAppearanceControls(wc, 2_000);
  assert.equal(reads, 3, 'all-false and partially loaded snapshots keep waiting');
  assert.equal(result.nav, true);
  assert.equal(result.choose, true);
  assert.equal(result.browse, true);
});

test('appearance readiness does not hide forbidden gallery-source content', async () => {
  const dialog = pageNode({ 'aria-label': 'Settings' }, 'Bing daily wallpapers', {
    controls: [pageNode({}, 'Choose image'), pageNode({}, 'Browse gallery')],
    'h1, h2, h3': [pageNode({}, 'Wallpaper')],
  });
  const world = pageWorld({ '[role="dialog"]': [dialog],
    '[data-dsh-settings-section="appearance"]': [pageNode({ 'aria-current': 'true' })] });
  const result = await probeAppearanceControls(world.wc, 10);
  assert.equal(result.bingDaily, true, 'the existing noSourceDump verdict must still reject this copy');
});

test('appearance probe never accepts controls under another active settings section', async () => {
  const dialog = pageNode({ 'aria-label': 'Settings' }, '', {
    controls: [pageNode({}, 'Choose image'), pageNode({}, 'Browse gallery')],
    'h1, h2, h3': [pageNode({}, 'Wallpaper')],
  });
  const world = pageWorld({ '[role="dialog"]': [dialog],
    '[data-dsh-settings-section="appearance"]': [pageNode({ 'aria-current': 'false' })] });
  assert.equal(await probeAppearanceControls(world.wc, 10), null);
});

test('page names resolve ordered aria-labelledby references before label or text', () => {
  const control = pageNode({ 'aria-labelledby': 'title detail', 'aria-label': 'outdated' });
  // The injected helper gets the same aria-labelledby-only Switch as the UI.
  const labelledWorld = pageWorld({ controls: [control] }, {
    title: pageNode({}, '会话日志导出'), detail: pageNode({}, '开关'),
  });
  assert.equal(labelledWorld.eval("dshLabel(document.querySelectorAll('button, ')[0])"), '会话日志导出 开关');
  assert.equal(labelledWorld.eval("Boolean(dshFind('会话日志'))"), true);
  const fallback = pageWorld({ controls: [pageNode({ 'aria-labelledby': 'missing', 'aria-label': 'Contact us' }, 'other')] });
  assert.equal(fallback.eval("Boolean(dshFind('^contact us$'))"), true);
  assert.equal(fallback.eval("Boolean(dshFind('^feedback$'))"), false);
});

test('switch state reads native checked and controlled aria state without guessing unknown controls', () => {
  const native = pageNode({ 'aria-labelledby': 'log-title' });
  native.tagName = 'INPUT';
  native.type = 'checkbox';
  native.checked = false;
  native.click = () => { native.checked = !native.checked; };
  const world = pageWorld({ '[role="switch"]': [native] }, { 'log-title': pageNode({}, '会话日志导出') });
  const state = () => world.eval("dshSwitchChecked(document.querySelector('[role=\"switch\"]'))");
  assert.equal(state(), false);
  native.click();
  assert.equal(state(), true);
  native.click();
  assert.equal(state(), false);
  const controlledAttrs = { 'aria-checked': 'false' };
  const controlled = pageWorld({ '[role="switch"]': [pageNode(controlledAttrs)] });
  assert.equal(controlled.eval("dshSwitchChecked(document.querySelector('[role=\"switch\"]'))"), false);
  controlledAttrs['aria-checked'] = 'true';
  assert.equal(controlled.eval("dshSwitchChecked(document.querySelector('[role=\"switch\"]'))"), true);
  delete controlledAttrs['aria-checked'];
  assert.equal(controlled.eval("dshSwitchChecked(document.querySelector('[role=\"switch\"]'))"), null);
});

test('MCP readiness waits for the loaded search control and active target navigation', () => {
  const navAttrs = { 'aria-current': 'true' };
  const dialogQueries = { 'h1, h2, h3': [pageNode({}, 'MCP 服务器')],
    controls: [pageNode({ 'aria-label': '添加服务器' })] };
  const world = pageWorld({ '[role="dialog"]': [pageNode({ 'aria-label': '设置' }, '', dialogQueries)],
    '[data-dsh-settings-section="mcp"]': [pageNode(navAttrs)] });
  const ready = () => world.eval('(() => { const s = dshMcpSnapshot(); return s.active && s.heading && s.search && s.add; })()');
  assert.equal(ready(), false, 'the loading page has heading and Add but no search');
  dialogQueries['input[type="search"], [role="searchbox"]'] = [pageNode({ 'aria-label': '搜索名称、ID、命令或 URL' })];
  assert.equal(ready(), true);
  navAttrs['aria-current'] = 'false';
  assert.equal(ready(), false);
});

test('skills readiness rejects content from another active settings section', () => {
  const attrs = { 'aria-label': '设置' };
  const navAttrs = { 'aria-current': 'false' };
  const dialogQueries = { 'h1, h2, h3': [pageNode({}, '技能')], controls: [pageNode({ 'aria-label': '添加技能' })] };
  const world = pageWorld({ '[role="dialog"]': [pageNode(attrs, '', dialogQueries)],
    '[data-dsh-settings-section="skills"]': [pageNode(navAttrs)] });
  const ready = () => world.eval('(() => { const s = dshSkillsSnapshot(); return s.active && s.heading && s.add; })()');
  assert.equal(ready(), false);
  navAttrs['aria-current'] = 'true';
  assert.equal(ready(), true);
  dialogQueries.controls = [];
  assert.equal(ready(), false);
  assert.equal(world.eval('dshSkillsSnapshot().heading'), true);
});

test('custom provider confirmation requires a saved row and configured credential accessible name', () => {
  const rowQueries = { '[role="img"]': [] };
  const dialogQueries = { li: [pageNode({}, 'Dshd QA 自定义', rowQueries)] };
  const dialog = pageNode({ 'aria-label': '设置' }, 'Dshd QA', dialogQueries);
  const world = pageWorld({ '[role="dialog"]': [dialog],
    '[data-dsh-settings-section="models"]': [pageNode({ 'aria-current': 'true' })] });
  const saved = () => world.eval("dshSavedCustomProvider('dshdqa', 'Dshd QA')");
  assert.equal(saved().listed, true);
  assert.equal(saved().configured, false);
  rowQueries['[role="img"]'] = [pageNode({ 'aria-label': 'API 密钥已配置' })];
  assert.equal(saved().configured, true);
  dialog.innerText = 'Dshd QA\nstatus elsewhere: sk-dshd-qa-placeholder';
  assert.equal(saved().leak, true, 'plaintext outside the provider row must still fail');
  dialog.innerText = 'Dshd QA';
  assert.equal(saved().leak, false);
  rowQueries['[role="img"]'] = [pageNode({ 'aria-label': 'API key missing' })];
  assert.equal(saved().configured, false);
  dialogQueries.li = [];
  assert.equal(saved(), null, 'a draft name elsewhere in the dialog is not persistence');
});

test('custom provider card stays present through the real busy labels until its Provider ID field leaves', () => {
  const button = pageNode({}, 'Create provider');
  const card = pageNode({}, '', { button: [button] });
  const fieldRow = pageNode();
  fieldRow.parentElement = card;
  const route = pageNode({ 'aria-label': 'Provider ID' });
  route.parentElement = fieldRow;
  const queries = { 'input, textarea': [route], button: [button] };
  const dialog = pageNode({}, '', queries);
  const world = pageWorld({ '[role="dialog"]': [dialog] });
  const present = () => world.eval('dshCustomProviderCard(document.querySelector(\'[role="dialog"]\'))');
  assert.equal(present(), card);
  button.disabled = true;
  for (const label of ['Creating\u2026', '创建中\u2026']) {
    button.textContent = label;
    assert.equal(present(), card, 'busy submit text must not be mistaken for form closure');
  }
  queries['input, textarea'] = [];
  assert.equal(present(), null, 'a detached Provider ID is actual closure');
  queries['input, textarea'] = [pageNode({ 'aria-label': 'Provider' })];
  button.textContent = 'Create provider';
  assert.equal(present(), null, 'a different provider editor cannot become a custom creation card');
});

test('composer idle waits reject disabled send, disabled editor and an active turn', async () => {
  const editorAttrs = { contenteditable: 'true', 'aria-disabled': 'false' };
  const editor = pageNode(editorAttrs);
  const send = pageNode({ 'aria-label': '发送消息' });
  const cardQueries = { controls: [send] };
  const queries = { '[data-composer-card]': [pageNode({}, '', cardQueries)], '[data-composer-input]': [editor], controls: [send] };
  const world = pageWorld(queries);
  assert.equal(await waitForComposerIdle(world.wc, 20), true);
  send.disabled = true;
  assert.equal(await waitForComposerIdle(world.wc, 20), false);
  send.disabled = false;
  editorAttrs.contenteditable = 'false';
  assert.equal(await waitForComposerIdle(world.wc, 20), false);
  editorAttrs.contenteditable = 'true';
  queries.controls = [send, pageNode({ 'aria-label': '停止生成' })];
  assert.equal(await waitForComposerIdle(world.wc, 20), false);
});

test('stopped empty composers prove enabled Send with an unsent readiness draft', async () => {
  const editor = pageNode({ contenteditable: 'true', 'aria-disabled': 'false' });
  const send = pageNode({ 'aria-label': '发送消息' });
  send.disabled = true;
  const queries = { '[data-composer-card]': [pageNode({}, '', { controls: [send] })],
    '[data-composer-input]': [editor], controls: [send] };
  const world = pageWorld(queries);
  let writes = 0;
  world.wc.insertText = (text) => { writes += 1; editor.innerText = text; send.disabled = false; };
  assert.equal(await waitForComposerIdle(world.wc, 1_000, 'QA readiness'), true);
  assert.equal(editor.innerText, 'QA readiness');
  assert.equal(writes, 1);
  editor.innerText = '';
  send.disabled = true;
  queries.controls = [send, pageNode({ 'aria-label': '停止生成' })];
  assert.equal(await waitForComposerIdle(world.wc, 20, 'QA readiness'), false);
  assert.equal(writes, 1, 'do not hide an active turn by typing into its composer');
});

test('submission waits for its user echo and cleared draft even when the fast turn already ended', async () => {
  const editor = pageNode({ contenteditable: 'true' }, 'ping Off');
  const send = pageNode({ 'aria-label': 'Send message' });
  send.disabled = true;
  const queries = { '[data-composer-card]': [pageNode({}, '', { controls: [send] })],
    '[data-composer-input]': [editor], '[data-chat-flow-kind="user"]': [pageNode({}, 'other ping')] };
  const world = pageWorld(queries);
  let reads = 0;
  const wc = { executeJavaScript: async (script) => {
    const value = await world.wc.executeJavaScript(script);
    reads++;
    if (reads === 1) queries['[data-chat-flow-kind="user"]'].push(pageNode({}, 'ping Off'));
    if (reads === 2) editor.innerText = editor.textContent = '';
    return value;
  } };
  assert.equal(await waitForComposerSubmission(wc, 'ping Off', 2_000), 'idle');
  assert.equal(reads, 3, 'neither an unrelated bubble nor the still-typed draft proves submission');
  assert.equal(send.disabled, true, 'a valid empty draft keeps Send disabled');
});

test('submission does not accept Stop without the matching user echo, or a disabled composer', async () => {
  const attrs = { contenteditable: 'true' };
  const queries = { '[data-composer-input]': [pageNode(attrs)],
    controls: [pageNode({ 'aria-label': 'Stop generating' })], '[data-chat-flow-kind="user"]': [] };
  const world = pageWorld(queries);
  assert.equal(await waitForComposerSubmission(world.wc, 'ping Low', 10), null);
  queries['[data-chat-flow-kind="user"]'].push(pageNode({}, 'ping Low'));
  assert.equal(await waitForComposerSubmission(world.wc, 'ping Low', 10), 'engaged');
  attrs['aria-disabled'] = 'true';
  assert.equal(await waitForComposerSubmission(world.wc, 'ping Low', 10), null);
});

test('session log menu probes a sent session and waits for its own enabled download', async () => {
  const more = pageNode({ 'aria-label': 'More actions' });
  const unrelated = pageNode({}, '', { controls: [pageNode({}, 'Commit')] });
  const download = pageNode({}, 'Download session log');
  download.disabled = true;
  const ownMenu = pageNode({}, '', { controls: [download] });
  const queries = { controls: [more], '[data-chat-flow-kind="user"]': [pageNode({}, 'sent ping')],
    '[role="menu"]': [unrelated] };
  more.click = () => { queries['[role="menu"]'].push(ownMenu); };
  const world = pageWorld(queries);
  let reads = 0;
  const wc = { executeJavaScript: async (script) => {
    const value = await world.wc.executeJavaScript(script);
    reads++;
    if (reads === 2) download.disabled = false;
    return value;
  } };
  const result = await probeSessionLogMenu(wc, 2_000);
  assert.equal(result.ordinary, true);
  assert.equal(result.opened, true);
  assert.equal(result.download, true);
  assert.equal(result.extraShortcut, false);
  assert.equal(reads, 3, 'disabled download cannot count as reachable');
});

test('session log probe rejects a blank draft and retains the duplicate-shortcut failure', async () => {
  const more = pageNode({ 'aria-label': 'More actions' });
  let clicks = 0;
  more.click = () => { clicks++; };
  const queries = { controls: [more], '[data-chat-flow-kind="user"]': [],
    '#dshd-shell-titlebar-trailing': [pageNode({}, '', { controls: [pageNode({}, 'Session log')] })] };
  const world = pageWorld(queries);
  const result = await probeSessionLogMenu(world.wc, 10);
  assert.equal(result.ordinary, false);
  assert.equal(result.download, false);
  assert.equal(result.extraShortcut, true);
  assert.equal(clicks, 0, 'blank drafts have no session menu to verify');
});

test('Git Commit entry is reachable through the menu when the primary action is Publish', async () => {
  const commit = pageNode({ 'aria-disabled': 'true' }, 'Commit');
  const world = pageWorld({ controls: [pageNode({}, 'Publish repository')],
    '[role="menu"]': [pageNode({}, '', { controls: [commit] })] });
  const result = await probeGitCommitMenu(world.wc, 10);
  assert.equal(result.present, true);
  assert.equal(result.enabled, false, 'clean-repository disabling must remain visible to QA');
  commit.getAttribute = () => null;
  assert.equal((await probeGitCommitMenu(world.wc, 10)).enabled, true);
});

test('Git Commit probe cannot be satisfied by a primary button or Commit and push', async () => {
  const world = pageWorld({ controls: [pageNode({}, 'Commit')],
    '[role="menu"]': [pageNode({}, '', { controls: [pageNode({}, 'Commit & push')] })] });
  assert.equal(await probeGitCommitMenu(world.wc, 10), null);
});

test('remote gate clicks the account menu and requires its actual pairing dialog', async () => {
  const queries = { controls: [], '[role="menu"]': [], '[data-dsh-remote-panel]': [] };
  const account = pageNode({ 'aria-label': '账号菜单' });
  const remote = pageNode({}, '远程');
  const panel = pageNode({ role: 'dialog', 'aria-label': '远程' }, '', { 'h1, h2, h3': [pageNode({}, '远程')] });
  let accountClicks = 0;
  let remoteClicks = 0;
  account.click = () => { accountClicks += 1; queries['[role="menu"]'] = [pageNode({}, '', { controls: [remote] })]; };
  remote.click = () => { remoteClicks += 1; queries['[data-dsh-remote-panel]'] = [panel]; };
  queries.controls = [account];
  const world = pageWorld(queries);
  assert.equal((await probeRemoteEntry(world.wc, 20)).ok, true);
  assert.equal(accountClicks, 1);
  assert.equal(remoteClicks, 1);
  queries['[data-dsh-remote-panel]'] = [];
  remote.click = () => { remoteClicks += 1; };
  assert.equal((await probeRemoteEntry(world.wc, 20)).ok, false, 'the menu label alone cannot pass');
  remote.click = () => { queries['[data-dsh-remote-panel]'] = [panel]; };
  queries['[data-dsh-remote-trigger], [data-sidebar-action="remote"]'] = [pageNode()];
  assert.equal((await probeRemoteEntry(world.wc, 20)).ok, false, 'duplicate standalone footer violates the account contract');
  queries.controls = [];
  queries['[role="menu"]'] = [];
  const footer = pageNode();
  footer.click = () => { queries['[data-dsh-remote-panel]'] = [panel]; };
  queries['[data-dsh-remote-trigger], [data-sidebar-action="remote"]'] = [footer];
  assert.equal((await probeRemoteEntry(world.wc, 20)).ok, true, 'account-absent sidebar fallback still opens the pairing popup');
  queries['[data-dsh-remote-trigger], [data-sidebar-action="remote"]'] = [];
  assert.equal((await probeRemoteEntry(world.wc, 20)).ok, false, 'missing every launcher must fail');
});

test('assertReleaseQaResult passes when every required step is present and ok', () => {
  const steps = QA_REQUIRED_STEPS.map((name) => ({ name, ok: true, detail: '' }));
  steps.push({ name: 'gallery.items', ok: false, optional: true, detail: 'network' });
  assert.doesNotThrow(() => assertReleaseQaResult({
    qa: { ok: true, failed: [], steps },
  }));
});

test('assertReleaseQaResult fails on a required step miss or omission', () => {
  assert.throws(
    () => assertReleaseQaResult({ qa: { ok: false, failed: ['files.panel'], steps: [] } }),
    /files\.panel/,
  );
  const steps = QA_REQUIRED_STEPS
    .filter((name) => name !== 'market.installed')
    .map((name) => ({ name, ok: true, detail: '' }));
  assert.throws(
    () => assertReleaseQaResult({ qa: { ok: true, failed: [], steps } }),
    /market\.installed/,
  );
});

test('release walk helpers stay injectable into the harness page', () => {
  assert.match(PAGE_HELPERS, /function dshShown/);
  assert.match(PAGE_HELPERS, /function dshFind/);
  assert.match(PAGE_HELPERS, /function dshAssignFile/);
  assert.match(PAGE_HELPERS, /function dshQaPngFile/);
  assert.match(PAGE_HELPERS, /send message\|发送消息/);
  assert.match(PAGE_HELPERS, /function dshSetValue/);
  assert.match(PAGE_HELPERS, /function dshField/);
  assert.match(PAGE_HELPERS, /insertText/);
  assert.match(PAGE_HELPERS, /execCommand/);
  assert.match(PAGE_HELPERS, /function dshDialogNamed/);
  assert.ok(QA_REQUIRED_STEPS.includes('workspace.connected'));
  assert.ok(QA_REQUIRED_STEPS.includes('workspace.picker'));
  assert.ok(QA_REQUIRED_STEPS.includes('gallery.sources'));
  assert.ok(QA_REQUIRED_STEPS.includes('market.discover'));
  assert.ok(QA_REQUIRED_STEPS.includes('browser.url'));
  // Source QA uses default-off config: the switch must be present and the tab absent.
  assert.ok(QA_REQUIRED_STEPS.includes('interface.dshbotSwitch'));
  assert.ok(QA_REQUIRED_STEPS.includes('plugin.dshbot.defaultOff'));
  assert.ok(QA_REQUIRED_STEPS.includes('rightbar.open'));
  assert.ok(QA_REQUIRED_STEPS.includes('rightbar.legacyDormant'));
  assert.ok(QA_REQUIRED_STEPS.includes('market.installed'));
  assert.ok(QA_REQUIRED_STEPS.includes('usage-stats.section'));
  assert.ok(QA_REQUIRED_STEPS.includes('files.mentionAppended'));
  assert.ok(QA_REQUIRED_STEPS.includes('files.mentionVisible'));
  assert.ok(QA_REQUIRED_STEPS.includes('composer.skillMenuAbsent'));
  assert.ok(QA_REQUIRED_STEPS.includes('composer.pathSourceAbsent'));
  assert.ok(QA_REQUIRED_STEPS.includes('remote.available'));
  assert.ok(QA_REQUIRED_STEPS.includes('remote.notListening'));
  assert.ok(QA_REQUIRED_STEPS.includes('remote.footerPresent'));
  assert.ok(QA_REQUIRED_STEPS.includes('titlebar.windowControls'));
  assert.ok(QA_REQUIRED_STEPS.includes('files.tabCloseRight'));
  assert.ok(QA_REQUIRED_STEPS.includes('account.launcher'));
  assert.ok(QA_REQUIRED_STEPS.includes('account.signedOutMenu'));
  assert.ok(QA_REQUIRED_STEPS.includes('git.commit'));
  assert.ok(QA_REQUIRED_STEPS.includes('models.heading'));
  assert.ok(QA_REQUIRED_STEPS.includes('models.customAdd'));
  assert.ok(QA_REQUIRED_STEPS.includes('models.visionPicker'));
  assert.ok(QA_REQUIRED_STEPS.includes('appearance.themeSwitch'));
  assert.ok(QA_REQUIRED_STEPS.includes('appearance.localCrop'));
  assert.ok(QA_REQUIRED_STEPS.includes('appearance.frost'));
  assert.ok(QA_REQUIRED_STEPS.includes('gallery.wallhavenSfw'));
  assert.ok(QA_REQUIRED_STEPS.includes('gallery.confirmSet'));
  assert.ok(QA_REQUIRED_STEPS.includes('composer.thinkingSwitch'));
  assert.ok(QA_REQUIRED_STEPS.includes('models.customForm'));
});

test('release walk source clicks Mention and asserts the composer markdown link', () => {
  const walk = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'release-ui-walk.js'),
    'utf8',
  );
  assert.match(walk, /files\.mentionAppended/);
  assert.match(walk, /mention in composer\|引用到输入框/);
  assert.match(walk, /typeIntoComposer\(wc, ''\)/);
  assert.match(walk, /\\\[note\\\.md\\\]\\\(note\\\.md\\\)/);
  assert.match(walk, /mention click missed/);
  assert.match(walk, /composer\.skillMenuAbsent/);
  assert.match(walk, /composer\.pathSourceAbsent/);
  assert.match(walk, /data-source="path"/);
  assert.match(walk, /probeRemote/);
  assert.match(walk, /remote\.available/);
  assert.match(walk, /remoteSnap\.available === false/);
  assert.match(walk, /remote\.footerPresent/);
  assert.match(walk, /parked hidden/);
  assert.match(walk, /titlebar\.windowControls/);
  assert.match(walk, /files\.tabCloseRight/);
  assert.match(walk, /data-sidebar-right-panel/);
  assert.match(walk, /data-sidebar-right-guide-entry/);
  assert.match(walk, /data-dockkit-tab-close/);
  assert.match(walk, /data-sidebar-terminal/);
  assert.match(walk, /account\.signedOutMenu/);
  assert.match(walk, /add model provider\|添加模型提供商/);
  assert.match(walk, /custom model api\|自定义模型 api/);
  assert.doesNotMatch(walk, /dshd-open-surface', \{ detail/);
  assert.match(walk, /git\.commitDialog/);
  assert.match(walk, /gitHeadSubject/);
  assert.match(walk, /dirtyQaNote/);
  assert.match(walk, /qa: commit note\.md \$\{Date\.now\(\)\}/);
  assert.match(walk, /git actions\|git 操作/);
  assert.match(walk, /\^commit\$/);
  assert.match(walk, /note\\.md/);
  assert.match(walk, /models\.visionPicker/);
  assert.match(walk, /appearance\.themeSwitch/);
  assert.match(walk, /appearance\.localCrop/);
  assert.match(walk, /gallery\.confirmSet/);
  assert.match(walk, /\^必应\$\|\^bing\$/);
  assert.match(walk, /Bing thumbnails did not load/);
  assert.match(walk, /models\.customForm/);
  assert.match(walk, /usage-stats\.section/);
  assert.match(walk, /data-dsh-settings-section="usage-stats"/);
  assert.match(walk, /dshCustomProviderCard/);
  assert.match(walk, /\^显示名称\$\|\^display name\$/);
  assert.match(walk, /typeIntoAriaField/);
  assert.match(walk, /Input\.insertText/);
  assert.doesNotMatch(walk, /未选择\|api 协议\|protocol/);
  assert.match(walk, /summarizeRemoteQaDetail/);
  assert.doesNotMatch(walk, /JSON\.stringify\(remoteSnap\)/);
  assert.match(walk, /composer\.thinkingSwitch/);
  assert.match(walk, /推理等级\|\^effort/);
  assert.match(walk, /gateway did not expose reasoning efforts/);
  assert.match(walk, /\$fo/);
});

test('release walk types into Lexical composer and matches 0.1.2 chrome copy', () => {
  const walk = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'release-ui-walk.js'),
    'utf8',
  );
  assert.match(PAGE_HELPERS, /function dshComposerInput/);
  assert.match(PAGE_HELPERS, /function dshComposerReady/);
  assert.match(PAGE_HELPERS, /function dshComposerText/);
  assert.match(PAGE_HELPERS, /function dshSetComposerText/);
  assert.match(PAGE_HELPERS, /data-composer-input/);
  assert.match(walk, /dshComposerReady/);
  assert.match(walk, /dshSetComposerText/);
  assert.match(walk, /dshComposerText/);
  assert.match(walk, /typeIntoComposer/);
  assert.match(walk, /clickNewSession/);
  assert.match(walk, /sendInputEvent/);
  assert.match(walk, /insertText/);
  assert.match(walk, /Input\.insertText/);
  assert.match(walk, /dshSelectComposerAll/);
  assert.match(walk, /insertReplacementText/);
  assert.match(walk, /stop generating\|停止生成/);
  assert.match(walk, /no 发送消息 \(likely 停止生成 leftover\)/);
  assert.match(walk, /Session 日志/);
  assert.match(walk, /\^\(discover\|发现\)\$/);
  assert.match(walk, /识图模型/);
  assert.match(walk, /add files or run commands\|添加文件或调用指令/);
  assert.match(PAGE_HELPERS, /function composerModelTrigger/);
  assert.match(PAGE_HELPERS, /选择模型\|select model/);
  assert.match(PAGE_HELPERS, /selectNodeContents/);
  assert.ok(QA_REQUIRED_STEPS.includes('composer.heroCentered'));
  assert.match(walk, /composer\.heroCentered/);
  assert.match(walk, /data-phase/);
});

test('hero conversation root nests in the AppFrame center subgrid', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(
    path.join(__dirname, '../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css'),
    'utf8',
  );
  const rootBlock = css.slice(css.indexOf('.root {'), css.indexOf('\n.header {'));
  assert.match(rootBlock, /display:\s*grid/);
  assert.match(rootBlock, /grid-template-rows:\s*subgrid/);
  assert.match(rootBlock, /grid-row:\s*1\s*\/\s*-1/);
  assert.match(rootBlock, /min-height:\s*0/);
  assert.match(css, /\.header \{[\s\S]*?grid-row:\s*1/);
  assert.match(css, /\.body \{[\s\S]*?grid-row:\s*2/);
});
