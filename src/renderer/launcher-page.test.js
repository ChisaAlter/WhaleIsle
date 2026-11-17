'use strict';

// Characterization for the launcher page split (#440): the production page
// loads its code as several classic scripts sharing one global scope. This
// suite drives the real scripts in page order over a fake DOM parsed from
// launcher.html, pinning tab switching, home status, versions, plugins,
// import and settings behavior so a file split can be checked mechanically.

const test = require('node:test');
const assert = require('node:assert/strict');
const kit = require('./launcher-test-kit.cjs');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
// Values returned by page scripts carry the vm realm's Object.prototype, so
// strict deep-equal comparisons go through a JSON round-trip first.
const plain = (value) => JSON.parse(JSON.stringify(value));

function status(overrides = {}) {
  return {
    ok: true,
    version: '9.9.9',
    config: {},
    routes: [{ id: 'stable', label: '稳定线路', detail: '主线', verified: true },
      { id: 'beta', label: '候选线路', detail: '预发', verified: true }],
    downloadRoute: 'stable',
    desktop: { state: 'ready' },
    components: { items: [] },
    ...overrides,
  };
}

function apiWith(overrides = {}) {
  return {
    launcherStatus: async () => status(),
    componentsList: async () => ({ components: [] }),
    ...overrides,
  };
}

test('every launcher page script evaluates in one shared scope', () => {
  const { context, window: win } = kit.loadLauncherPage({ api: apiWith() });
  for (const name of ['showTab', 'activateTab', 'refreshStatus', 'refreshImport',
    'refreshReleases', 'refreshPlugins', 'installRuntime', 'installTag', 'installDelta',
    'runDesktopAction', 'checkUpdateNow', 'saveSettings', 'renderReleases',
    'renderPluginBoard', 'renderHomeRecovery', 'syncLauncherState', 'bind']) {
    assert.equal(typeof context[name], 'function', `${name} must reach the shared page scope`);
  }
  for (const name of ['appConfirm', 'appNotice', 'launcherButtonBusy', 'dshdErrText']) {
    assert.equal(typeof win[name], 'function', `${name} stays on window for launcher-components.js`);
  }
  assert.equal(typeof win.shellFeedback.mountProgress, 'function');
  assert.equal(typeof win.__launcherComponents.mount, 'function');
});

test('DOMContentLoaded binds controls, mounts feedback surfaces and paints home status', async () => {
  const calls = [];
  const api = apiWith({
    launcherStatus: async () => { calls.push('launcherStatus'); return status({ config: { quitAfterStart: false, autoStartDesktop: false, askOnUpdate: false } }); },
    componentsList: async () => { calls.push('componentsList'); return { components: [] }; },
  });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  assert.ok(calls.includes('launcherStatus'));
  assert.ok(calls.includes('componentsList'));
  assert.equal(doc.getElementById('home-version').textContent, 'v9.9.9');
  assert.match(doc.getElementById('home-status').textContent, /桌面端已就绪/);
  assert.equal(doc.body.dataset.launcherState, 'running');
  assert.equal(doc.getElementById('btn-start').hidden, true);
  assert.equal(doc.getElementById('btn-stop').hidden, false);
  assert.equal(doc.getElementById('opt-quit').checked, false);
  assert.equal(doc.getElementById('opt-auto').checked, false);
  assert.equal(doc.getElementById('opt-ask').checked, false);
  assert.equal(doc.getElementById('rail-route').textContent, '稳定线路');
  assert.ok(doc.querySelector('.shell-feedback-stack'), 'feedback stack mounted');
  // The window controls and the components module mounted real children.
  assert.ok(doc.querySelector('.window-controls [data-act="close"]'));
  assert.ok(doc.getElementById('tab-components').children.length > 0);
});

test('tab clicks switch the visible panel and kick that pane refresh', async () => {
  const calls = [];
  const api = apiWith({
    launcherStatus: async () => { calls.push('launcherStatus'); return status(); },
    listReleases: async () => { calls.push('listReleases'); return { status: 'ok', releases: [] }; },
    pluginForensics: async () => { calls.push('pluginForensics'); return { plugins: [] }; },
    scanImport: async () => { calls.push('scanImport'); return { sessions: [], skills: [], plugins: [], mcp: [], settings: [], presets: [] }; },
  });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  calls.length = 0;

  doc.querySelector('[data-tab="versions"]').click();
  await flush();
  assert.deepEqual(calls, ['listReleases']);
  assert.equal(doc.getElementById('panel-versions').classList.contains('is-active'), true);
  assert.equal(doc.getElementById('panel-versions').hidden, false);
  assert.equal(doc.getElementById('panel-home').hidden, true);

  doc.querySelector('[data-tab="plugins"]').click();
  await flush();
  assert.deepEqual(calls, ['listReleases', 'pluginForensics']);
  assert.equal(doc.getElementById('panel-plugins').hidden, false);

  // [data-goto] links drive the same activation path as the rail tabs.
  doc.querySelector('[data-goto="home"]').click();
  await flush();
  assert.deepEqual(calls, ['listReleases', 'pluginForensics', 'launcherStatus']);
  assert.equal(doc.getElementById('panel-home').hidden, false);
});

test('import scan renders grouped sessions, keeps selections and folds across rescans', async () => {
  const scan = {
    homeDir: 'C:\\home',
    sourceHome: 'C:\\official',
    sourceHasData: true,
    sessions: [
      { rel: 'ws/alpha', title: '会话 A', cwd: 'C:\\home\\ws' },
      { rel: 'ws/beta', title: '会话 B', cwd: 'C:\\home\\ws' },
      { rel: 'other/gamma', unsupported: true },
    ],
    skills: [{ id: 's1', name: 'skill-one', source: 'home' }],
    plugins: [{ name: 'plug', spec: 'v1' }],
    mcp: [{ id: 'm1', name: 'mcp-one', enabled: true }],
    settings: [{ id: 'agents-md' }],
    presets: [{ id: 'p1' }],
  };
  const api = apiWith({ scanImport: async () => scan });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  doc.querySelector('[data-tab="import"]').click();
  await flush();

  assert.match(doc.getElementById('import-source').textContent, /有可导入数据/);
  const sessions = doc.getElementById('import-sessions');
  const clusters = sessions.querySelectorAll('[data-import-cluster]');
  assert.equal(clusters.length, 2, 'two session groups');
  const boxes = sessions.querySelectorAll('input[name="session-rel"]');
  assert.equal(boxes.length, 3);
  assert.equal(boxes.filter((b) => b.disabled).length, 1, 'unsupported session is disabled');
  // The grouped cluster checkbox is checked when all enabled members are.
  assert.equal(clusters[0].checked, true);

  // Uncheck one member, fold the group, then rescan: both choices survive.
  boxes[0].checked = false;
  doc.getElementById('import-board-body').dispatchEvent({ type: 'change', target: boxes[0] });
  await flush();
  assert.match(doc.getElementById('import-sessions-count').textContent, /^1\/3/);
  const fold = sessions.querySelector('[data-import-fold]');
  fold.click();
  await flush();
  assert.equal(fold.getAttribute('aria-expanded'), 'false');
  assert.equal(sessions.querySelector('[data-import-group-item]').hidden, true);

  doc.getElementById('btn-scan').click();
  await flush();
  const boxes2 = doc.getElementById('import-sessions').querySelectorAll('input[name="session-rel"]');
  assert.equal(boxes2[0].checked, false, 'rescan preserves the unchecked choice');
  assert.equal(doc.getElementById('import-sessions').querySelector('[data-import-fold]').getAttribute('aria-expanded'), 'false', 'rescan preserves folds');

  doc.getElementById('btn-import-select-all').click();
  const enabled = doc.getElementById('import-sessions').querySelectorAll('input[name="session-rel"]:not(:disabled)');
  assert.ok(enabled.every((b) => b.checked));
  doc.getElementById('btn-import-select-none').click();
  assert.ok(enabled.every((b) => !b.checked));
});

test('import categories switch panes through click and the summary line follows', async () => {
  const api = apiWith({ scanImport: async () => ({ sessions: [], skills: [{ id: 's1', name: 'x', source: 'home' }], plugins: [], mcp: [], settings: [], presets: [] }) });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  doc.querySelector('[data-tab="import"]').click();
  await flush();
  doc.querySelector('[data-import-cat="skills"]').click();
  assert.equal(doc.querySelector('[data-import-pane="skills"]').hidden, false);
  assert.equal(doc.querySelector('[data-import-pane="sessions"]').hidden, true);
  assert.equal(doc.getElementById('import-board-hint').textContent, '官方 skills、用户技能根与额外目录');
});

test('btn-import posts the checked ids and lands the terminal summary', async () => {
  let payload = null;
  const api = apiWith({
    scanImport: async () => ({
      sessions: [{ rel: 'ws/alpha' }],
      skills: [{ id: 's1', name: 'x', source: 'home' }],
      plugins: [{ name: 'plug', spec: 'v1' }],
      mcp: [{ id: 'm1' }],
      settings: [{ id: 'agents-md' }],
      presets: [{ id: 'p1' }],
    }),
    runImport: async (opts) => { payload = opts; return { ok: true, sessions: [{ rel: 'ws/alpha', status: 'copied' }], plugins: [{ name: 'plug', status: 'installed' }] }; },
  });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  doc.querySelector('[data-tab="import"]').click();
  await flush();
  doc.getElementById('import-overwrite').checked = true;
  doc.getElementById('btn-import').click();
  await flush();
  assert.deepEqual(plain(payload.selectedRels), ['ws/alpha']);
  assert.deepEqual(plain(payload.selectedSkillIds), ['s1']);
  assert.equal(payload.overwrite, true);
  assert.match(payload.opId, /^ui-import-/);
  assert.match(doc.getElementById('import-result').textContent, /会话 已拷 1/);
  assert.equal(doc.getElementById('btn-import').disabled, false);
  assert.equal(doc.getElementById('btn-import-cancel').hidden, true);
});

test('settings toggles post the whole options patch', async () => {
  const saved = [];
  const api = apiWith({ saveLauncherConfig: async (patch) => { saved.push(patch); return { ok: true }; } });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  const auto = doc.getElementById('opt-auto');
  auto.checked = false;
  auto.dispatchEvent({ type: 'change', target: auto });
  await flush();
  assert.deepEqual(plain(saved.at(-1)), { quitAfterStart: true, autoStartDesktop: false, askOnUpdate: true });
});

test('an up-to-date check answers on its own buttons; a failure lands under them', async () => {
  const api = apiWith({
    checkUpdate: async () => ({ status: 'current', currentVersion: '9.9.9' }),
  });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  const btn = doc.getElementById('btn-check-update');
  btn.click();
  await flush();
  assert.equal(btn.dataset.buttonLabel, 'done');
  assert.match(btn.textContent, /已是最新/);
  assert.deepEqual([...doc.querySelectorAll('[data-update-fail]')].map((n) => n.textContent), ['', '']);

  const apiFail = apiWith({ checkUpdate: async () => ({ status: 'error', hint: '连接超时' }) });
  const second = kit.loadLauncherPage({ api: apiFail });
  second.fireDOMContentLoaded();
  await flush();
  second.document.getElementById('btn-check-update-versions').click();
  await flush();
  const failLines = [...second.document.querySelectorAll('[data-update-fail]')].map((n) => n.textContent);
  assert.deepEqual(failLines, ['更新检查失败：连接超时', '更新检查失败：连接超时']);
});

test('route radio picks persist through the shared save flow', async () => {
  const saved = [];
  const api = apiWith({
    saveLauncherConfig: async (patch) => { saved.push(patch); return { ok: true }; },
  });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  const radios = doc.getElementById('route-picker').querySelectorAll('[data-route-pick]');
  assert.equal(radios.length, 2);
  radios[1].click();
  await flush();
  assert.deepEqual(plain(saved), [{ downloadRoute: 'beta' }]);
});

test('the versions route chip opens a listbox and a pick saves the route', async () => {
  const saved = [];
  const api = apiWith({
    saveLauncherConfig: async (patch) => { saved.push(patch); return { ok: true }; },
    listReleases: async () => ({ status: 'ok', releases: [] }),
  });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  const chip = doc.getElementById('rail-route-btn');
  const pop = doc.getElementById('rail-route-pop');
  chip.click();
  await flush();
  assert.equal(pop.hidden, false);
  assert.equal(chip.getAttribute('aria-expanded'), 'true');
  const options = pop.querySelectorAll('[role="option"]');
  assert.equal(options.length, 2);
  options[1].click();
  await flush();
  assert.deepEqual(plain(saved), [{ downloadRoute: 'beta' }]);
  assert.equal(pop.hidden, true);
});

test('plugin forensics render rows whose buttons call the bridge', async () => {
  const calls = [];
  const forensics = { plugins: [{ name: 'dsh-a' }, { name: 'dsh-b', suspect: true }], suspects: [{ name: 'dsh-b' }], evidence: [{ name: 'dsh-b', line: 'boom at dsh-b' }] };
  const api = apiWith({
    pluginForensics: async () => forensics,
    disablePlugin: async (name) => { calls.push(['disablePlugin', name]); return { ok: true, forensics }; },
  });
  const { document: doc, fireDOMContentLoaded } = kit.loadLauncherPage({ api });
  fireDOMContentLoaded();
  await flush();
  doc.querySelector('[data-tab="plugins"]').click();
  await flush();
  const rows = doc.getElementById('plugin-list').querySelectorAll('li');
  assert.equal(rows.length, 2);
  assert.match(doc.getElementById('forensics-summary').textContent, /dsh-b/);
  const disable = doc.getElementById('plugin-list').querySelector('[data-disable="dsh-b"]');
  assert.ok(disable, 'suspect row keeps its disable action');
  disable.click();
  await flush();
  assert.deepEqual(calls, [['disablePlugin', 'dsh-b']]);
});

test('summarizeImport and importProgressText keep their user-facing shapes', () => {
  const { context } = kit.loadLauncherPage({ api: apiWith() });
  const summary = context.summarizeImport({
    ok: true,
    sessions: [{ status: 'copied' }, { status: 'skipped' }],
    skills: [], plugins: [{ status: 'failed', name: 'p', error: 'denied' }],
    mcp: [], settings: [], credentials: [], presets: [],
  });
  assert.match(summary, /会话 已拷 1 · 跳过 1/);
  assert.match(summary, /共 1 项失败/);
  assert.match(summary, /p：denied/);
  assert.equal(context.importProgressText({ phase: 'sessions', done: 2, total: 5, rel: 'a/b' }), '正在导入会话 2/5：a/b');
  assert.equal(context.importProgressText({ phase: 'done' }), '导入完成。');
});
