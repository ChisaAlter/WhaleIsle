'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  LIVE2D_PET_FEATURE,
  PET_WIDTH,
  PET_HEIGHT,
  PET_PAGE_URL,
  configureLive2dPet,
  createLive2dPetManager,
  createPetProtocolHandler,
  defaultPosition,
  getLive2dPet,
  isPetFrameUrl,
  normalizeLive2dPetState,
} = require('./desktop-live2d');

function stubIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
  };
}

function stubWindow() {
  const win = {
    ignoreCalls: [],
    positions: [],
    sends: [],
    closed: false,
    shown: false,
    webContents: {
      setWindowOpenHandler: () => {},
      on: () => {},
      once: () => {},
      send: (channel, payload) => win.sends.push([channel, payload]),
    },
    setAlwaysOnTop: () => {},
    setVisibleOnAllWorkspaces: () => {},
    setIgnoreMouseEvents(ignore, options) {
      this.ignoreCalls.push([ignore, options]);
    },
    setPosition(x, y) {
      this.positions.push([x, y]);
    },
    getPosition() {
      return this.positions.at(-1) || [10, 20];
    },
    getBounds() {
      return { x: 0, y: 0, width: PET_WIDTH, height: PET_HEIGHT };
    },
    isDestroyed: () => false,
    isVisible() {
      return this.shown;
    },
    show() {
      this.shown = true;
    },
    showInactive() {
      this.shown = true;
    },
    close() {
      this.closed = true;
    },
    once: () => {},
    on: () => {},
    loadFile: () => Promise.resolve(),
    loadURL: () => Promise.resolve(),
  };
  return win;
}

function live2dDeps(overrides = {}) {
  const win = stubWindow();
  const config = overrides.loadConfig || (() => ({}));
  return {
    win,
    electron: {
      BrowserWindow: class {},
      Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
      screen: {
        getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
        getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
      },
      ipcMain: stubIpcMain(),
    },
    BrowserWindow: function () {
      return win;
    },
    rendererFile: (name) => `C:/app/src/renderer/${name}`,
    preloadFile: () => 'C:/app/src/preload/index.js',
    loadConfig: () => ({}),
    saveConfig: () => {},
    ...overrides,
    loadConfig: () => {
      const saved = config();
      return { ...saved, live2dPet: { enabled: true, ...saved.live2dPet } };
    },
  };
}

function authorizedEvent(deps, url = PET_PAGE_URL) {
  const frame = { url };
  return { sender: deps.win.webContents, senderFrame: deps.win.webContents.mainFrame = frame && frame, frame };
}

test('native pet region excludes the desktop even when renderer interactivity is stale', { skip: process.platform === 'darwin' }, (t) => {
  const shapes = [];
  const deps = live2dDeps();
  deps.win.setShape = (rects) => shapes.push(rects);
  deps.win.getBounds = () => ({ x: 0, y: 0, width: 800, height: 600 });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const handler = deps.electron.ipcMain.handlers.get('shell:live2d-interactive');
  const regions = [{ x: 10, y: 20, width: 60, height: 80 }, { x: 200, y: 20, width: 80, height: 90 }];
  handler(authorizedEvent(deps), { interactive: true, regions });
  assert.deepEqual(shapes.at(-1), regions, 'native hit area has two separate islands, even before renderer exit');
  const count = shapes.length;
  handler(authorizedEvent(deps), { interactive: true, regions });
  assert.equal(shapes.length, count, 'unchanged geometry does not rebuild the native region');
  handler(authorizedEvent(deps), { regions: [] });
  assert.deepEqual(shapes.at(-1), [{ x: 0, y: 0, width: 0, height: 0 }], 'empty surface is never setShape([]), which restores full-screen');
  handler(authorizedEvent(deps), { regions: [
    { x: -3.2, y: 590.5, width: 20, height: 100 },
    { x: NaN, y: 0, width: 20, height: 20 },
    { x: 0, y: 0, width: -1, height: 20 },
  ] });
  assert.deepEqual(shapes.at(-1), [{ x: 0, y: 590, width: 17, height: 10 }]);
});

test('showing a hidden pet uses inactive presentation', (t) => {
  const deps = live2dDeps();
  deps.win.show = () => assert.fail('show would activate the overlay');
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  manager.show();
  assert.equal(deps.win.shown, true);
});

test('theme changes preserve the pet overlay transparency, including recreated windows', (t) => {
  const windows = [];
  const deps = live2dDeps();
  deps.electron.screen.getDisplayMatching = deps.electron.screen.getPrimaryDisplay;
  deps.BrowserWindow = function (options) {
    const win = stubWindow();
    win.background = options.backgroundColor;
    win.destroy = () => { win.closed = true; };
    win.isDestroyed = () => win.closed;
    win.setBackgroundColor = (color) => { win.background = color; };
    win.webContents.getURL = () => PET_PAGE_URL;
    win.webContents.isDestroyed = () => false;
    win.isMinimized = () => false;
    win.isMaximized = () => false;
    windows.push(win);
    return win;
  };
  const nativeTheme = { shouldUseDarkColors: false };
  const stubs = {
    electron: { ...deps.electron, nativeTheme, BrowserWindow: { getAllWindows: () => windows } },
    './config': { loadConfig: () => ({}) },
    './window': { getHarnessWebContents: () => null },
    './desktop-pet': { getDesktopPet: () => null },
  };
  const originals = new Map();
  for (const [id, exports] of Object.entries(stubs)) {
    const filename = require.resolve(id);
    originals.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }
  const chromePath = require.resolve('./chrome');
  originals.set(chromePath, require.cache[chromePath]);
  delete require.cache[chromePath];
  t.after(() => {
    for (const [filename, previous] of originals) {
      if (previous) require.cache[filename] = previous;
      else delete require.cache[filename];
    }
  });
  const chrome = require('./chrome');
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const verifyThemeCycle = () => {
    for (const dark of [true, false, true]) {
      nativeTheme.shouldUseDarkColors = dark;
      chrome.applyAppTheme();
      assert.equal(windows.at(-1).background, '#00000000', `pet background after ${dark ? 'dark' : 'light'} theme`);
    }
  };
  verifyThemeCycle();
  manager.recreateWindow();
  assert.equal(windows.length, 2);
  verifyThemeCycle();
});

const petSettings = require('./pet-settings');
const petGrowth = require('./pet-growth');

const DEFAULT_PET_SETTINGS = petSettings.defaultSettings();
const DEFAULT_DSH = petSettings.defaultDshState();
const DEFAULT_EATEN = { total: 0, history: [] };

test('normalizeLive2dPetState defaults to disabled with auto position', () => {
  const freshStats = { satiety: 70, mood: 70, affection: 0, lastTick: 42, care: {} };
  const extra = {
    settings: DEFAULT_PET_SETTINGS,
    dsh: DEFAULT_DSH,
    fileEaten: DEFAULT_EATEN,
    assistantSessionId: '',
  };
  assert.deepEqual(normalizeLive2dPetState(undefined, 42), { enabled: false, x: null, y: null, growth: { points: 0, tokensFed: 0, tokensSeen: 0, baseline: null, today: null }, stats: freshStats, ...extra });
  assert.deepEqual(normalizeLive2dPetState({ enabled: false, x: 12.6, y: 40.4 }, 42), { enabled: false, x: 13, y: 40, growth: { points: 0, tokensFed: 0, tokensSeen: 0, baseline: null, today: null }, stats: freshStats, ...extra });
  assert.deepEqual(normalizeLive2dPetState({ x: 'bad', y: {} }, 42), { enabled: false, x: null, y: null, growth: { points: 0, tokensFed: 0, tokensSeen: 0, baseline: null, today: null }, stats: freshStats, ...extra });
  assert.equal(normalizeLive2dPetState({ enabled: 'true' }).enabled, false);
  assert.equal(normalizeLive2dPetState({ enabled: true }).enabled, true);
});

test('default startup does not create a window or timers; opt-in remains available', (t) => {
  const timers = [];
  const cleared = [];
  t.mock.method(global, 'setInterval', (callback, ms) => {
    const timer = { ms, unref() {} };
    timers.push(timer);
    return timer;
  });
  t.mock.method(global, 'clearInterval', (timer) => cleared.push(timer));
  const saved = [];
  const deps = live2dDeps({ saveConfig: (next) => saved.push(next) });
  deps.loadConfig = () => ({});
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  assert.equal(manager.isEnabled(), false);
  assert.equal(manager.show(), null);
  assert.deepEqual(timers, []);
  assert.deepEqual(deps.win.ignoreCalls, []);
  manager.setEnabled(true);
  assert.equal(saved.at(-1).live2dPet.enabled, true);
  assert.ok(deps.win.ignoreCalls.length > 0);
  const growthTimer = timers.find(timer => timer.ms === 60000);
  assert.ok(growthTimer);
  manager.setEnabled(false);
  assert.equal(saved.at(-1).live2dPet.enabled, false);
  assert.equal(deps.win.closed, true);
  assert.ok(cleared.includes(growthTimer));
  manager.setEnabled(true);
  assert.equal(timers.filter(timer => timer.ms === 60000).length, 2);
});

test('defaultPosition anchors the pet to the work area bottom-right', () => {
  const pos = defaultPosition({ x: 0, y: 0, width: 1920, height: 1040 });
  assert.equal(pos.x, 1920 - PET_WIDTH - 24);
  assert.equal(pos.y, 1040 - PET_HEIGHT - 24);
  assert.deepEqual(defaultPosition(undefined), { x: 0, y: 0 });
});

test('isPetFrameUrl only accepts the bundled renderer page', () => {
  assert.equal(isPetFrameUrl(PET_PAGE_URL), true);
  assert.equal(isPetFrameUrl('pet://pet/other.html'), false);
  assert.equal(isPetFrameUrl('https://example.com/x'), false);
  assert.equal(isPetFrameUrl('not a url'), false);
});

test('manager toggles click-through with forward for gaze tracking', (t) => {
  const deps = live2dDeps();
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  assert.equal(deps.win.closed, false);
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [true, { forward: true }]);
  manager.setInteractive(true);
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [false, undefined]);
  manager.setInteractive(false);
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [true, { forward: true }]);
});

test('manager persists committed drag position and honors disabled state', (t) => {
  const saved = [];
  const deps = live2dDeps({ saveConfig: (next) => saved.push(next) });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const state = manager.commitPosition(120.4, 96.6);
  assert.equal(state.x, 120);
  assert.equal(state.y, 97);
  const persistedPet = saved.at(-1).live2dPet;
  assert.equal(persistedPet.x, 120);
  assert.equal(persistedPet.y, 97);
  assert.deepEqual(persistedPet.growth, { points: 0, tokensFed: 0, tokensSeen: 0, baseline: null, today: null });
  assert.equal(persistedPet.stats.satiety, 70);
  assert.equal(persistedPet.stats.affection, 0);
  manager.setEnabled(false);
  assert.equal(deps.win.closed, true);
  assert.equal(manager.isEnabled(), false);
});

test('ipc handlers reject senders outside the pet window', (t) => {
  const deps = live2dDeps();
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const handler = deps.electron.ipcMain.handlers.get('shell:live2d-interactive');
  assert.equal(typeof handler, 'function');
  assert.throws(() => handler({ sender: {}, senderFrame: {} }), /Unauthorized/);
});

test('moveTo relays positions to the renderer and ignores malformed payloads', (t) => {
  const deps = live2dDeps();
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  manager.moveTo(300, 200);
  manager.moveTo(undefined, Number.NaN);
  // The overlay window never moves — moveTo forwards the target to the
  // renderer, which repaints the character there.
  assert.deepEqual(deps.win.sends.at(-1), ['shell:live2d-move', { x: 300, y: 200 }]);
});

test('pet protocol serves bundled renderer assets and rejects traversal', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-renderer-'));
  fs.writeFileSync(path.join(root, 'pet-live2d.html'), '<html></html>');
  const handler = createPetProtocolHandler((name) => path.join(root, name));
  const ok = handler({ url: 'pet://pet/pet-live2d.html' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'text/html');
  assert.equal(handler({ url: 'pet://pet/../secret.txt' }).status, 404);
  assert.equal(handler({ url: 'pet://pet/missing.png' }).status, 404);
});

test('pet protocol serves the shared tokens alias and nothing else outside root', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-alias-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const renderer = path.join(base, 'src', 'renderer');
  const shared = path.join(base, 'src', 'shared');
  const assets = path.join(base, 'assets');
  fs.mkdirSync(renderer, { recursive: true });
  fs.mkdirSync(shared, { recursive: true });
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(renderer, 'pet-live2d.html'), '<html></html>');
  fs.writeFileSync(path.join(shared, 'dsh-webui-tokens.css'), ':root{--x:1}');
  fs.writeFileSync(path.join(shared, 'secret.css'), 'body{display:none}');
  fs.writeFileSync(path.join(assets, 'whale-head.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const handler = createPetProtocolHandler((name) => path.join(renderer, name));
  const ok = handler({ url: 'pet://pet/dsh-webui-tokens.css' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'text/css');
  assert.equal(await ok.text(), ':root{--x:1}');
  const head = handler({ url: 'pet://pet/pet-head.png' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), 'image/png');
  assert.equal(handler({ url: 'pet://pet/secret.css' }).status, 404);
  assert.equal(handler({ url: 'pet://pet/../assets/whale-head.png' }).status, 404);
  assert.equal(handler({ url: 'pet://pet/..%2Fassets%2Fwhale-head.png' }).status, 404);
  assert.equal(handler({ url: 'pet://pet/../shared/secret.css' }).status, 404);
  assert.equal(handler({ url: 'pet://pet/..%2Fshared%2Fsecret.css' }).status, 404);
  assert.equal(handler({ url: 'pet://pet/dsh-webui-tokens.css/extra' }).status, 404);
});

test('configureLive2dPet returns a manager while the feature flag stays on', (t) => {
  assert.equal(LIVE2D_PET_FEATURE, true);
  const manager = configureLive2dPet(live2dDeps());
  t.after(() => manager.dispose());
  assert.equal(getLive2dPet(), manager);
});

// ── growth integration ──

function growthDeps(t, overrides = {}) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const zlib = require('node:zlib');
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-sessions-'));
  t.after(() => fs.rmSync(sessionsDir, { recursive: true, force: true }));
  const sessionDir = path.join(sessionsDir, 'sess-a');
  fs.mkdirSync(sessionDir, { recursive: true });
  const body = [
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 20000, outputTokens: 5000 } } }),
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 1, usage: { outputTokens: 500 } } }),
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(sessionDir, 'session.jsonl.zstd'),
    zlib.zstdCompressSync(Buffer.from(body, 'utf8')));
  const templates = [];
  const scanCache = new Map();
  return {
    templates,
    deps: live2dDeps({
      sessionsDir,
      // In-process scan keeps these tests deterministic and worker-free;
      // the default worker path is covered in pet-growth.test.js.
      scanTokens: (dir) => petGrowth.scanSessionTokens(dir, scanCache, true),
      // Pre-planted watermark: the fixture corpus counts as post-baseline
      // food — the backlog-exclusion path is covered in pet-growth.test.js.
      loadConfig: () => ({ live2dPet: { growth: { baseline: 0 } } }),
      ...overrides,
    }),
  };
}

test('usage continues while hidden and outbox waits for the renderer to finish loading', (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const timers = [];
  t.mock.method(global, 'setInterval', (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; });
  t.mock.method(global, 'clearInterval', () => {});
  const { deps } = growthDeps(t);
  const callbacks = new Map();
  deps.win.webContents.once = (name, fn) => callbacks.set(name, fn);
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'whale-renderer-ready-'));
  const isolatedSessions = path.join(home, 'sessions');
  fs.cpSync(deps.sessionsDir, isolatedSessions, { recursive: true });
  deps.sessionsDir = isolatedSessions;
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const whaleHome = path.join(path.dirname(deps.sessionsDir), 'data/whale');
  const outbox = path.join(whaleHome, 'pet-outbox.jsonl');
  fs.mkdirSync(whaleHome, { recursive: true });
  fs.writeFileSync(outbox, JSON.stringify({ kind: 'notify', text: '重要提醒' }) + '\n');
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  const tick = timers.find((timer) => timer.ms === 2000).fn;
  tick();
  assert.equal(JSON.parse(fs.readFileSync(path.join(whaleHome, 'usage-today.json'))).used, 25500);
  assert.equal(deps.win.sends.some(([channel, payload]) => channel === 'shell:live2d-dsh' && payload.kind === 'notify'), false);
  manager.show();
  deps.win.showInactive();
  tick();
  assert.equal(deps.win.sends.some(([channel, payload]) => channel === 'shell:live2d-dsh' && payload.kind === 'notify'), false);
  callbacks.get('did-finish-load')();
  tick();
  assert.equal(deps.win.sends.filter(([channel, payload]) => channel === 'shell:live2d-dsh' && payload.kind === 'notify').length, 1);
});

test('DSH config write retries after save mutates memory then throws', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const zlib = require('node:zlib');
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-dsh-retry-'));
  t.after(() => fs.rmSync(sessionsDir, { recursive: true, force: true }));
  const log = path.join(sessionsDir, 'ws-a', 'sess-a', 'session.jsonl.zstd');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, zlib.zstdCompressSync(Buffer.from(JSON.stringify({ type: 'turn/start', data: { turn: 1 } }) + '\n')));
  const timers = [];
  t.mock.method(global, 'setInterval', (fn, ms) => {
    const timer = { fn, ms, unref() {} };
    timers.push(timer);
    return timer;
  });
  t.mock.method(global, 'clearInterval', () => {});
  let writes = 0;
  let committed;
  const deps = live2dDeps({ sessionsDir, saveConfig: (next) => {
    writes += 1;
    if (writes === 1) { throw new Error('temporary config lock'); }
    committed = next.live2dPet.dsh;
  } });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const tick = timers.find((timer) => timer.ms === 2000)?.fn;
  assert.equal(typeof tick, 'function');
  tick();
  assert.equal(writes, 1);
  assert.equal(committed, undefined);
  assert.equal(Object.keys(manager.getState().dsh.files).length, 0);
  tick();
  assert.equal(writes, 2);
  assert.equal(Object.keys(committed.files).length, 1);
  assert.equal(deps.win.sends.filter(([channel, payload]) => channel === 'shell:live2d-dsh' && payload.state === 'working').length, 1);
});

test('growth ipc is authorized like every other pet channel', (t) => {
  const { deps } = growthDeps(t);
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  for (const channel of ['shell:live2d-growth', 'shell:live2d-feed']) {
    const handler = deps.electron.ipcMain.handlers.get(channel);
    assert.equal(typeof handler, 'function', `${channel} registered`);
    assert.throws(() => handler({ sender: {}, senderFrame: {} }, {}), /Unauthorized/);
  }
});

test('live2d-growth returns a snapshot and live2d-feed pushes it', async (t) => {
  const { deps } = growthDeps(t);
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  const snap = await deps.electron.ipcMain.handlers.get('shell:live2d-growth')(event);
  assert.equal(snap.level, 1);
  assert.equal(snap.levelName, '幼鲸');
  const res = await deps.electron.ipcMain.handlers.get('shell:live2d-feed')(event, {});
  assert.equal(res.fed, 25500); // eats all feedable — the 1亿 meal cap is not hit
  assert.equal(res.points, 25500);
  assert.equal(res.leveledUp, false);
  assert.equal(res.level, 1); // 25500 is far below the 小鲸 threshold
  const push = deps.win.sends.at(-1);
  assert.equal(push[0], 'shell:live2d-growth');
  assert.equal(push[1].fed, 25500);
  // The bowl is empty now.
  const res2 = await deps.electron.ipcMain.handlers.get('shell:live2d-feed')(event, {});
  assert.equal(res2.fed, 0);
});

test('a failed feed save preserves the balance for a single retry', async (t) => {
  let failNext = false;
  const { deps } = growthDeps(t, { saveConfig: () => {
    if (failNext) { failNext = false; throw new Error('temporary config lock'); }
  } });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  const inspect = deps.electron.ipcMain.handlers.get('shell:live2d-growth');
  const feed = deps.electron.ipcMain.handlers.get('shell:live2d-feed');
  assert.equal((await inspect(event)).feedable, 25500);
  failNext = true;
  await assert.rejects(feed(event, { amount: 100 }), /temporary config lock/);
  assert.equal(manager.getState().growth.points, 0);
  assert.equal((await inspect(event)).feedable, 25500);
  const result = await feed(event, { amount: 100 });
  assert.equal(result.points, 100);
  assert.equal(result.tokensFed, 100);
  assert.equal(result.feedable, 25400);
});

test('settings-get reads; applySettings persists and pushes the normalized shape', (t) => {
  const saved = [];
  const { deps } = growthDeps(t, { saveConfig: (next) => saved.push(next) });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  const get = deps.electron.ipcMain.handlers.get('shell:live2d-settings-get');
  assert.equal(typeof get, 'function');
  assert.throws(() => get({ sender: {}, senderFrame: {} }), /Unauthorized/);
  // The pet frame is read-only for settings — writes live on the harness
  // channel, so no live2d-settings-set handler is registered.
  assert.equal(deps.electron.ipcMain.handlers.get('shell:live2d-settings-set'), undefined);
  assert.deepEqual(get(event), {
    ...petSettings.defaultSettings(),
    lookAvailable: false, // no lookModel configured in the fixture
  });
  // The main-window settings page writes through applySettings — the same
  // normalize → persist → push path the old pet-frame channel used.
  const back = manager.applySettings({ patch: { scale: 1.34, personality: 'tsundere', selfTalk: false } });
  assert.equal(back.scale, 1.3); // snapped to the 0.1 grid
  assert.equal(back.personality, 'tsundere');
  assert.equal(back.selfTalk, false);
  // Persisted settings carry no derived flag; the pushed payload does, so
  // the 「看看」cell appears live on edit.
  assert.deepEqual(saved.at(-1).live2dPet.settings, {
    ...petSettings.defaultSettings(),
    scale: 1.3,
    personality: 'tsundere',
    selfTalk: false,
  });
  const push = deps.win.sends.at(-1);
  assert.equal(push[0], 'shell:live2d-settings');
  assert.deepEqual(push[1], back);
  assert.equal(back.lookAvailable, false);
  // Junk patch preserves the current value — a bad field can never reset.
  const junk = manager.applySettings({ patch: { scale: 'x', personality: 'evil' } });
  assert.equal(junk.scale, 1.3);
  assert.equal(junk.personality, 'tsundere');
  // Reset restores defaults in one shot.
  const reset = manager.applySettings({ reset: true });
  const { lookAvailable: _flag, ...resetSettings } = reset;
  assert.deepEqual(resetSettings, petSettings.defaultSettings());
});

test('personality edits made during an in-flight mirror reach the assistant', async (t) => {
  const posts = [];
  let release;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    posts.push(JSON.parse(init.body).payload.personality);
    if (posts.length === 1) await new Promise((resolve) => { release = resolve; });
    return { ok: true, json: async () => ({ result: { ok: true, value: {} } }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const deps = live2dDeps({
    getHarnessOrigin: () => 'http://127.0.0.1:9', getSessionCookie: () => 'sess=1',
    loadConfig: () => ({ whaleAssistantEnabled: true }),
  });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.applySettings({ patch: { personality: 'poison' } });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(posts, ['natural', 'poison']);
  assert.equal(manager.getSettings().personality, 'poison');
});

test('personality changes mirror into the whale assistant catalog', async (t) => {
  const posts = [];
  const okReply = { ok: true, json: async () => ({ result: { ok: true, value: {} } }) };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return okReply;
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { deps } = growthDeps(t, {
    getHarnessOrigin: () => 'http://127.0.0.1:9',
    getSessionCookie: () => 'sess=1',
    // The mirror only posts while her route exists — assistant enabled.
    loadConfig: () => ({ whaleAssistantEnabled: true, live2dPet: { growth: { baseline: 0 } } }),
  });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const mirrors = () => posts.filter((p) => p.url.endsWith('/dsh-whale/settings/update'));
  await settle();
  // Startup heal re-asserts the pet's personality so a stale assistant
  // catalog converges without a user edit.
  assert.equal(mirrors().length, 1);
  assert.equal(mirrors()[0].body.method, 'settings/update');
  assert.deepEqual(mirrors()[0].body.payload, { personality: 'natural' });
  posts.length = 0;
  // A personality edit mirrors; an unrelated edit posts nothing.
  manager.applySettings({ patch: { personality: 'tsundere' } });
  await settle();
  manager.applySettings({ patch: { scale: 1.2 } });
  await settle();
  assert.equal(mirrors().length, 1);
  assert.deepEqual(mirrors()[0].body.payload, { personality: 'tsundere' });
  // A transport miss keeps the value queued — the next flush delivers the
  // latest value, not the stale one.
  globalThis.fetch = async () => { throw new Error('harness down'); };
  manager.applySettings({ patch: { personality: 'genki' } });
  await settle();
  globalThis.fetch = async (url, init) => {
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return okReply;
  };
  manager.applySettings({ patch: { personality: 'poison' } });
  await settle();
  const last = mirrors().at(-1);
  assert.deepEqual(last.body.payload, { personality: 'poison' });
});

test('personality mirror retries an answered rejection a bounded number of times', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const posts = [];
  const originalFetch = globalThis.fetch;
  // The endpoint answers but refuses (e.g. a snapshot-conflict write) — the
  // value must be retried, then dropped, never parked silently forever.
  globalThis.fetch = async (url, init) => {
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ result: { ok: false, error: { message: 'conflict' } } }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { deps } = growthDeps(t, {
    getHarnessOrigin: () => 'http://127.0.0.1:9',
    getSessionCookie: () => 'sess=1',
    loadConfig: () => ({ whaleAssistantEnabled: true, live2dPet: { growth: { baseline: 0 } } }),
    mirrorRetryMs: 5,
  });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const settle = async () => {
    // Let each async response settle, then advance the retry clock. Wall-clock
    // sleeps race CPU contention when the complete desktop suite is running.
    for (let step = 0; step < 6; step += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.timers.tick(5);
    }
  };
  await settle();
  const mirrors = () => posts.filter((p) => p.url.endsWith('/dsh-whale/settings/update'));
  // Startup heal posted once; the rejection earned three bounded retries.
  assert.equal(mirrors().length, 4);
  assert.deepEqual(mirrors()[0].body.payload, { personality: 'natural' });
  assert.deepEqual(mirrors().at(-1).body.payload, { personality: 'natural' });
  // The queue is drained — a later edit posts fresh, not behind the corpse.
  manager.applySettings({ patch: { personality: 'tsundere' } });
  await settle();
  const last = mirrors().at(-1);
  assert.deepEqual(last.body.payload, { personality: 'tsundere' });
  assert.equal(mirrors().length, 8);
});

test('personality mirror parks while the assistant is disabled', async (t) => {
  const posts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    posts.push(String(url));
    return { ok: true, json: async () => ({ result: { ok: true, value: {} } }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { deps } = growthDeps(t, {
    getHarnessOrigin: () => 'http://127.0.0.1:9',
    getSessionCookie: () => 'sess=1',
    // No whaleAssistantEnabled → her /dsh-whale route is unmounted; posting
    // would be a guaranteed miss, so the value waits for a later retry.
    loadConfig: () => ({ live2dPet: { growth: { baseline: 0 } } }),
  });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  manager.applySettings({ patch: { personality: 'tsundere' } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(posts.length, 0);
});

test('live2d-open-settings navigates to the main-window pet section', async (t) => {
  const calls = [];
  const { deps } = growthDeps(t, {
    openPetSettings: async () => { calls.push('open'); return { ok: true }; },
  });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  const open = deps.electron.ipcMain.handlers.get('shell:live2d-open-settings');
  assert.equal(typeof open, 'function');
  await assert.rejects(() => open({ sender: {}, senderFrame: {} }), /Unauthorized/);
  assert.deepEqual(await open(event), { ok: true });
  assert.deepEqual(calls, ['open']);
});

test('live2d-open-settings reports unavailable/failure without breaking', async (t) => {
  const { deps } = growthDeps(t, { openPetSettings: async () => ({ ok: false, reason: 'harness-not-ready' }) });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const open = deps.electron.ipcMain.handlers.get('shell:live2d-open-settings');
  assert.deepEqual(await open(authorizedEvent(deps)), { ok: false, reason: 'harness-not-ready' });
});

test('live2d-open-settings reports unavailable when no navigation is wired', async (t) => {
  const { deps } = growthDeps(t);
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const open = deps.electron.ipcMain.handlers.get('shell:live2d-open-settings');
  assert.deepEqual(await open(authorizedEvent(deps)), { ok: false, reason: 'unavailable' });
});

test('live2d-roam accepts a finite rect and never persists it', (t) => {
  const saved = [];
  const { deps } = growthDeps(t, { saveConfig: (next) => saved.push(next) });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  const roam = deps.electron.ipcMain.handlers.get('shell:live2d-roam');
  assert.equal(typeof roam, 'function');
  assert.throws(() => roam({ sender: {}, senderFrame: {} }, {}), /Unauthorized/);
  assert.equal(roam(event, { x: 100.6, y: 200.4, w: 300, h: 320 }), null);
  // Bad payloads are dropped without throwing.
  assert.equal(roam(event, { x: 'a', y: 0, w: 10, h: 10 }), null);
  assert.equal(roam(event, { x: 0, y: 0, w: -5, h: 10 }), null);
  // Roaming is transient: nothing about it reaches saveConfig.
  assert.equal(saved.length, 0);
});

test('live2d-file-eat counts metadata only and caps the daily satiety trickle', (t) => {
  const saved = [];
  const { deps } = growthDeps(t, { saveConfig: (next) => saved.push(next) });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  const eat = deps.electron.ipcMain.handlers.get('shell:live2d-file-eat');
  assert.equal(typeof eat, 'function');
  assert.throws(() => eat({ sender: {}, senderFrame: {} }, { names: ['a'] }), /Unauthorized/);
  const res = eat(event, { names: ['report.pdf', ' notes.txt '] });
  assert.equal(res.ate, true);
  assert.equal(res.count, 2);
  assert.equal(res.satietyGranted, true);
  const persisted = saved.at(-1).live2dPet.fileEaten;
  assert.equal(persisted.total, 2);
  assert.equal(persisted.history.length, 2);
  assert.equal(persisted.history[1].name, 'notes.txt'); // trimmed
  // Empty/garbage drops do nothing.
  assert.equal(eat(event, { names: [] }).ate, false);
  assert.equal(eat(event, {}).ate, false);
  // Six single-file drops in one day: only the first five grant satiety.
  for (let i = 0; i < 6; i += 1) {
    const r = eat(event, { names: [`f${i}.txt`] });
    assert.equal(r.satietyGranted, i < 3, `drop ${i}`); // 2-entry batch ate 2 of 5
  }
});

test('live2d-chat is authorized, gated by chatEnabled, and degrades without creds', async (t) => {
  const { deps } = growthDeps(t);
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  const chat = deps.electron.ipcMain.handlers.get('shell:live2d-chat');
  const look = deps.electron.ipcMain.handlers.get('shell:live2d-look');
  assert.equal(typeof chat, 'function');
  assert.equal(typeof look, 'function');
  await assert.rejects(() => chat({ sender: {}, senderFrame: {} }, { text: 'x' }), /Unauthorized/);
  // Default fixture has no apiKey → clean no-credentials, no network.
  const res = await chat(event, { text: '在吗' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-credentials');
  // Toggle chat off → short-circuit before any fetch.
  manager.applySettings({ patch: { chatEnabled: false } });
  const off = await chat(event, { text: '在吗' });
  assert.deepEqual(off, { ok: false, reason: 'disabled' });
  // No vision model in the fixture → the look path refuses before any
  // capture attempt (the stub has no desktopCapturer; reaching it would
  // answer 'no-capturer' instead).
  const noLook = await look(event);
  assert.deepEqual(noLook, { ok: false, reason: 'no-vision-model' });
  // The settings-page look-model field wakes the feature live: the gate
  // passes and the next failure is the missing capturer stub.
  const get = deps.electron.ipcMain.handlers.get('shell:live2d-settings-get');
  manager.applySettings({ patch: { lookModel: 'vis-1' } });
  assert.equal(get(event).lookAvailable, true);
  assert.deepEqual(await look(event), { ok: false, reason: 'no-capturer' });
  // The cooldown stamps before capture — an immediate retry is throttled.
  assert.deepEqual(await look(event), { ok: false, reason: 'cooldown' });
  // Clearing the field sleeps the feature again, before any capture.
  manager.applySettings({ patch: { lookModel: ' ' } });
  assert.equal(get(event).lookAvailable, false);
  assert.deepEqual(await look(event), { ok: false, reason: 'no-vision-model' });
});

test('options.lookModel stays a wiring-time fallback for the look gate', async (t) => {
  const { deps } = growthDeps(t, { lookModel: 'opt-vis' });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  const get = deps.electron.ipcMain.handlers.get('shell:live2d-settings-get');
  assert.equal(get(event).lookAvailable, true);
  const look = deps.electron.ipcMain.handlers.get('shell:live2d-look');
  assert.deepEqual(await look(event), { ok: false, reason: 'no-capturer' });
});

// 「看看」 dispatches the picked catalog route through the whale plugin's
// pet/look endpoint — the desktop baseUrl cannot express catalog
// providers, so provider+model MUST reach the RPC payload for the pick to
// be real. These cases stub desktopCapturer and the loopback fetch.
function lookDeps(t, { endpointResult, electron: electronOverrides = {}, ...overrides } = {}) {
  const posts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ result: endpointResult }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { deps } = growthDeps(t, {
    getHarnessOrigin: () => 'http://127.0.0.1:9',
    getSessionCookie: () => 'sess=1',
    loadConfig: () => ({ whaleAssistantEnabled: true, apiKey: 'k', live2dPet: { growth: { baseline: 0 } } }),
    electron: {
      BrowserWindow: class {},
      Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
      screen: {
        getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
        getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
      },
      ipcMain: stubIpcMain(),
      desktopCapturer: {
        getSources: async () => [{
          display_id: '1',
          thumbnail: { toJPEG: () => Buffer.from('jpeg-bytes') },
        }],
      },
      ...electronOverrides,
    },
    ...overrides,
  });
  return { deps, posts };
}

test('live2d-look posts the picked provider+model to whale pet/look', async (t) => {
  const { deps, posts } = lookDeps(t, {
    endpointResult: { ok: true, value: { ok: true, reply: '看到你在写代码' } },
  });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  manager.applySettings({ patch: { lookProvider: 'my-provider', lookModel: 'vis-1' } });
  const look = deps.electron.ipcMain.handlers.get('shell:live2d-look');
  const res = await look(event);
  assert.deepEqual(res, { ok: true, reply: '看到你在写代码', via: 'whale' });
  const post = posts.find((p) => p.url.endsWith('/dsh-whale/pet/look'));
  assert.ok(post, 'pet/look RPC issued');
  assert.equal(post.body.method, 'pet/look');
  assert.equal(post.body.payload.provider, 'my-provider');
  assert.equal(post.body.payload.model, 'vis-1');
  assert.equal(post.body.payload.image, Buffer.from('jpeg-bytes').toString('base64'));
});

test('live2d-look surfaces the endpoint verdict, not a generic failure', async (t) => {
  const { deps } = lookDeps(t, {
    endpointResult: { ok: true, value: { ok: false, error: 'model-error', detail: 'MODEL_NOT_FOUND', status: 404 } },
  });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  manager.applySettings({ patch: { lookProvider: 'p', lookModel: 'm' } });
  const look = deps.electron.ipcMain.handlers.get('shell:live2d-look');
  const res = await look(event);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'model-error');
  assert.ok(res.detail.includes('MODEL_NOT_FOUND'));
});

test('live2d-look with a provider but assistant disabled reports assistant-off', async (t) => {
  const { deps, posts } = lookDeps(t, {
    endpointResult: { ok: true, value: { ok: true, reply: 'x' } },
    // Assistant off → no whale route; a catalog provider can never be
    // reached by the legacy baseUrl call, so it must not even try.
    loadConfig: () => ({ apiKey: 'k', live2dPet: { growth: { baseline: 0 } } }),
  });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const event = authorizedEvent(deps);
  manager.applySettings({ patch: { lookProvider: 'p', lookModel: 'm' } });
  const look = deps.electron.ipcMain.handlers.get('shell:live2d-look');
  const res = await look(event);
  assert.deepEqual(res, { ok: false, reason: 'assistant-off' });
  assert.equal(posts.length, 0);
});

test('live2d-hide disables the pet like the old menu item did', (t) => {
  const { deps } = growthDeps(t);
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const handler = deps.electron.ipcMain.handlers.get('shell:live2d-hide');
  assert.equal(typeof handler, 'function', 'hide channel registered');
  assert.throws(() => handler({ sender: {}, senderFrame: {} }), /Unauthorized/);
  handler(authorizedEvent(deps));
  assert.equal(manager.isEnabled(), false);
});

test('setEnabled reports every flip through onEnabledChange so the tray can resync', (t) => {
  const flips = [];
  const { deps } = growthDeps(t, { onEnabledChange: (enabled) => flips.push(enabled) });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  deps.electron.ipcMain.handlers.get('shell:live2d-hide')(authorizedEvent(deps));
  manager.setEnabled(true);
  assert.deepEqual(flips, [false, true]);
});

test('growth state survives through config normalization and persist', (t) => {
  const saved = [];
  const existing = {
    live2dPet: {
      enabled: true, x: 10, y: 20,
      growth: { points: 60000, tokensFed: 60000, tokensSeen: 70000, baseline: null, today: null },
    },
  };
  const deps = live2dDeps({
    loadConfig: () => existing,
    saveConfig: (next) => saved.push(next),
    sessionsDir: '',
  });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  manager.commitPosition(30, 40);
  const persisted = saved.at(-1).live2dPet;
  assert.deepEqual(persisted.growth, { points: 60000, tokensFed: 60000, tokensSeen: 70000, baseline: null, today: null });
});

test('commitPosition clamps an off-display landing back into the home display', (t) => {
  const saved = [];
  const deps = live2dDeps({ saveConfig: (next) => saved.push(next) });
  // Overlay covers the whole 1920x1080 display.
  deps.win.getBounds = () => ({ x: 0, y: 0, width: 1920, height: 1080 });
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  const state = manager.commitPosition(2500, 300);
  assert.equal(state.x, 1920 - PET_WIDTH);
  assert.equal(state.y, 300);
  const persisted = saved.at(-1).live2dPet;
  assert.equal(persisted.x, state.x);
  assert.equal(persisted.y, state.y);
});

test('relocate hops only after the cursor holds on the other display', (t) => {
  const deps = live2dDeps({ sessionsDir: '' });
  let cursor = { x: 2100, y: 500 }; // second display at x:2000
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  deps.electron.screen.getAllDisplays = () => [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 2000, y: 0, width: 1920, height: 1080 } },
  ];
  deps.electron.screen.getCursorScreenPoint = () => cursor;
  const boundCalls = [];
  deps.win.getBounds = () => ({ ...bounds });
  deps.win.setBounds = (b) => { boundCalls.push(b); Object.assign(bounds, b); };
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  boundCalls.length = 0; // show() itself may re-seat the overlay
  const relocate = deps.electron.ipcMain.handlers.get('shell:live2d-relocate');
  const ev = authorizedEvent(deps);
  // First poll seeing the cursor away only arms the streak — a throw-flick
  // releases before the next poll and must not hop the overlay.
  relocate(ev);
  assert.equal(boundCalls.length, 0);
  // Still held there on the next poll → hop to display 2.
  relocate(ev);
  assert.equal(boundCalls.length, 1);
  assert.deepEqual(boundCalls[0], { x: 2000, y: 0, width: 1920, height: 1080 });
  // A single away-poll toward another display only re-arms — never hops alone.
  cursor = { x: 100, y: 100 };
  relocate(ev);
  cursor = { x: 2100, y: 500 };
  relocate(ev); // display 2 is home now → streak resets
  assert.equal(boundCalls.length, 1);
});

test('relocate streak does not leak across drag sessions', (t) => {
  const deps = live2dDeps({ sessionsDir: '' });
  let cursor = { x: 2100, y: 500 };
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  deps.electron.screen.getAllDisplays = () => [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 2000, y: 0, width: 1920, height: 1080 } },
  ];
  deps.electron.screen.getCursorScreenPoint = () => cursor;
  const boundCalls = [];
  deps.win.getBounds = () => ({ ...bounds });
  deps.win.setBounds = (b) => { boundCalls.push(b); Object.assign(bounds, b); };
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  boundCalls.length = 0;
  const relocate = deps.electron.ipcMain.handlers.get('shell:live2d-relocate');
  const ev = authorizedEvent(deps);
  // Drag A's flick grazes display 2 once → streak 1, drag ends (polls stop).
  relocate(ev);
  // Drag B starts later: the poll gap is a new session — first away-poll
  // re-arms from 0 instead of combining into a single-poll hop.
  const realNow = Date.now;
  Date.now = () => realNow() + 500;
  try {
    relocate(ev);
  } finally {
    Date.now = realNow;
  }
  assert.equal(boundCalls.length, 0);
});

test('cursor pump pushes window-local positions and dedupes', (t) => {
  let point = { x: 50, y: 60 };
  const deps = live2dDeps({
    sessionsDir: '',
  });
  deps.electron.screen.getCursorScreenPoint = () => point;
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  deps.win.sends.length = 0;
  // Window bounds are {x:0,y:0,w:240,h:260} in the stub — inside → coords.
  manager.pollCursor();
  assert.deepEqual(deps.win.sends.at(-1), ['shell:live2d-cursor', { inside: true, x: 50, y: 60 }]);
  // Same position → no duplicate push.
  manager.pollCursor();
  assert.equal(deps.win.sends.length, 1);
  // Leaving the overlay pushes inside:false exactly once.
  point = { x: 500, y: 600 };
  manager.pollCursor();
  assert.deepEqual(deps.win.sends.at(-1), ['shell:live2d-cursor', { inside: false }]);
  manager.pollCursor();
  assert.equal(deps.win.sends.length, 2);
  // Re-entering sends fresh inside coords again.
  point = { x: 10, y: 10 };
  manager.pollCursor();
  assert.deepEqual(deps.win.sends.at(-1), ['shell:live2d-cursor', { inside: true, x: 10, y: 10 }]);
});

test('cursor hold keeps the window clickable inside the padded pet frame', (t) => {
  let point = { x: 50, y: 60 };
  const deps = live2dDeps({
    sessionsDir: '',
    loadConfig: () => ({ live2dPet: { x: 10, y: 10 } }),
  });
  deps.electron.screen.getCursorScreenPoint = () => point;
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  deps.win.ignoreCalls.length = 0;
  // Entering the padded pet frame holds interactivity on the same tick —
  // clicks land without waiting for the renderer round-trip.
  manager.pollCursor();
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [false, undefined]);
  // A renderer exit while the cursor is still in the frame is ignored —
  // honoring it would punch a click-through hole under in-flight clicks.
  deps.electron.ipcMain.handlers.get('shell:live2d-interactive')(authorizedEvent(deps), { interactive: false });
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [false, undefined]);
  // Leaving the frame releases the hold — the renderer flag governs again.
  point = { x: 500, y: 600 };
  manager.pollCursor();
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [true, { forward: true }]);
  // The renderer's own request still works outside the frame entirely.
  deps.electron.ipcMain.handlers.get('shell:live2d-interactive')(authorizedEvent(deps), { interactive: true });
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [false, undefined]);
});

test('cursor hold releases close to the reported body instead of swallowing nearby clicks', (t) => {
  let point = { x: 200, y: 200 };
  const deps = live2dDeps({
    sessionsDir: '',
    loadConfig: () => ({ live2dPet: { x: 10, y: 10 } }),
  });
  deps.electron.screen.getCursorScreenPoint = () => point;
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  // Renderer reports her tight body bounds (already incl. its hover pad).
  deps.electron.ipcMain.handlers.get('shell:live2d-roam')(
    authorizedEvent(deps), { x: 10, y: 10, w: 50, h: 50 });
  deps.win.ignoreCalls.length = 0;
  // A small margin absorbs sway without blocking neighboring controls.
  point = { x: 65, y: 50 };
  manager.pollCursor();
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [false, undefined]);
  point = { x: 70, y: 50 };
  manager.pollCursor();
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [true, { forward: true }]);
});

test('cursor hold follows the reported hit islands onto the status card', (t) => {
  let point = { x: 150, y: 150 };
  const deps = live2dDeps({
    sessionsDir: '',
    loadConfig: () => ({ live2dPet: { x: 10, y: 10 } }),
  });
  deps.electron.screen.getCursorScreenPoint = () => point;
  const manager = createLive2dPetManager(deps);
  t.after(() => manager.dispose());
  manager.show();
  // Body island on the left; the status card is a SEPARATE island to its
  // right, exactly like the renderer reports them.
  deps.electron.ipcMain.handlers.get('shell:live2d-roam')(
    authorizedEvent(deps), { x: 10, y: 20, w: 30, h: 40 });
  deps.electron.ipcMain.handlers.get('shell:live2d-interactive')(authorizedEvent(deps), {
    hitRegions: [
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 100, y: 90, width: 80, height: 120 },
    ],
  });
  deps.win.ignoreCalls.length = 0;
  // Over the CARD, well outside the body hold zone — still interactive, so
  // stepping off her onto the card never drops the window's input.
  manager.pollCursor();
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [false, undefined]);
  // The transparent gap between the two islands stays click-through.
  point = { x: 60, y: 150 };
  manager.pollCursor();
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [true, { forward: true }]);
  point = { x: 150, y: 150 };
  manager.pollCursor();
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [false, undefined]);
  // Stale islands are dropped when the card closes → the hold releases.
  deps.electron.ipcMain.handlers.get('shell:live2d-interactive')(authorizedEvent(deps), {
    hitRegions: [{ x: 10, y: 20, width: 30, height: 40 }],
  });
  manager.pollCursor();
  assert.deepEqual(deps.win.ignoreCalls.at(-1), [true, { forward: true }]);
});



test('render-process-gone recreates the overlay window instead of leaving an opaque surface', () => {
  const created = [];
  const goneHandlers = [];
  const deps = live2dDeps({
    BrowserWindow: function () {
      const w = stubWindow();
      w.destroyed = false;
      w.destroy = () => { w.destroyed = true; w.closed = true; };
      w.webContents.on = (name, fn) => { if (name === 'render-process-gone') goneHandlers.push([w, fn]); };
      w.webContents.once = () => {};
      created.push(w);
      return w;
    },
  });
  const manager = createLive2dPetManager(deps);
  manager.setEnabled(true);
  manager.show();
  assert.equal(created.length, 1);
  const [dead] = goneHandlers;
  dead[1]({}, { reason: 'crashed' });
  assert.equal(created.length, 2);
  assert.equal(dead[0].destroyed, true);
  assert.equal(created[1].destroyed, false);
});
