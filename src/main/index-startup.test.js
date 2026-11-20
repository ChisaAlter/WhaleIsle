'use strict';

// P3-4 特征测试：固定 src/main/index.js 按启动阶段拆分前后的行为契约。
// 测试不在 index.js 单一文件上断言，而是在「入口源码集」（index.js 与拆出的
// app-*.js 模块）中定位持有标记的文件再切片，因此拆分前后都可运行。
//
// 固定范围：
// - 启动顺序：GPU 开关 → userData 保留 → 单实例锁 → whenReady 内的步骤次序；
// - 退出流程：before-quit 拦截 → coordinate('quit') → closing overlay →
//   六件套关停 → app.quit / app.exit，以及 window-all-closed 与 quitApp 的
//   QA 拦截；
// - 更新流程入口：check → confirm → install 的接线（冷启动 gate、
//   parked drain、桌面 openDesktopUpdate）；
// - 控制通道：startDesktopInstallControl 的依赖装配、desktopInstallReady
//   等待、令牌经 dsh.js 下发给 Harness；
// - 窗口关闭：主窗/启动器 close 与 show 上的退出/隐藏/排空分支。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const ENTRY_FILES = [
  'index.js',
  // index.js 拆分产生的启动阶段模块（存在即参与定位；拆分前不存在）。
  'app-shell-state.js',
  'app-windows.js',
  'app-dialogs.js',
  'app-updates.js',
  'app-account.js',
  'app-lifecycle.js',
  'app-harness.js',
  'app-events.js',
  'app-ready.js',
];

function entrySources() {
  return ENTRY_FILES
    .filter((name) => fs.existsSync(path.join(__dirname, name)))
    .map((file) => ({
      file,
      source: fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n'),
    }));
}

/** Return the single entry file containing `marker`. */
function entryFile(marker) {
  const hits = entrySources().filter((entry) => entry.source.includes(marker));
  assert.equal(hits.length, 1, `expected exactly one entry file containing ${marker}`);
  return hits[0];
}

/** Slice [start, end) inside the single entry file containing `start`. */
function sliceEntry(start, end) {
  const entry = entryFile(start);
  const from = entry.source.indexOf(start);
  const to = entry.source.indexOf(end, from + start.length);
  assert.ok(to > from, `${entry.file}: ${end} must appear after ${start}`);
  return entry.source.slice(from, to);
}

/** Slice [start, first hit among ends) inside the file containing `start`. */
function sliceEntryAny(start, ends) {
  const entry = entryFile(start);
  const from = entry.source.indexOf(start);
  let to = -1;
  for (const end of ends) {
    const at = entry.source.indexOf(end, from + start.length);
    if (at >= 0 && (to < 0 || at < to)) to = at;
  }
  assert.ok(to > from, `${entry.file}: none of the end markers follows ${start}`);
  return entry.source.slice(from, to);
}

/** Ordered markers inside the single entry file containing `anchor`. */
function assertOrdered(anchor, markers) {
  const entry = entryFile(anchor);
  let cursor = entry.source.indexOf(anchor);
  for (const marker of markers) {
    const next = entry.source.indexOf(marker, cursor);
    assert.ok(next >= 0, `${entry.file}: ${marker} must appear after ${anchor}`);
    cursor = next + marker.length;
  }
  return entry;
}

// Shared mutable state is being folded into one explicit context object; the
// aliases let vm slices written either way (`quitting` / `state.quitting`)
// observe the same value before and after the split.
const STATE_KEYS = [
  'quitting', 'stoppingForQuit', 'quitInProgress', 'nativeQuitReady',
  'closingOverlayActive', 'desktopResources', 'qaQuitIntercepted',
  'backgroundStartup', 'launcherWindowHandle', 'updateCenter',
  'platformView', 'platformSessionRefresh',
];

function installStateAliases(context, state) {
  for (const key of STATE_KEYS) {
    Object.defineProperty(context, key, {
      configurable: true,
      get: () => state[key],
      set: (value) => { state[key] = value; },
    });
  }
  return context;
}

function shellState(overrides = {}) {
  return {
    quitting: false,
    stoppingForQuit: false,
    quitInProgress: false,
    nativeQuitReady: false,
    closingOverlayActive: false,
    desktopResources: null,
    qaQuitIntercepted: false,
    backgroundStartup: false,
    launcherWindowHandle: null,
    updateCenter: null,
    platformView: undefined,
    platformSessionRefresh: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 启动顺序

test('启动顺序：commandLine 开关 → preserveUserDataPath → 单实例锁 → 锁内 setName → whenReady', () => {
  const index = entryFile('app.requestSingleInstanceLock');
  const positions = [
    "app.commandLine.appendSwitch('force_high_performance_gpu')",
    'preserveUserDataPath(app, LEGACY_DESKTOP_USER_DATA)',
    'app.requestSingleInstanceLock()',
    'app.setName(PRODUCT_NAME)',
    "app.setAppUserModelId('ai.deepseek.harness.gui')",
    'app.whenReady()',
  ];
  let cursor = 0;
  for (const marker of positions) {
    const at = index.source.indexOf(marker);
    assert.ok(at > cursor, `index.js: ${marker} 顺序错误`);
    cursor = at;
  }
  assert.match(index.source, /if \(!gotLock\) \{[\s\S]*?app\.quit\(\)/, '未获锁必须直接退出');
  assert.ok(index.source.indexOf("app.on('second-instance'", index.source.indexOf('app.requestSingleInstanceLock()')) > -1
    || index.source.includes('registerAppEvents'),
    'second-instance 只能在拿到锁之后注册');
});

test('启动顺序：ready 阶段步骤次序固定', () => {
  assertOrdered('await migrateLegacyNotificationShortcut(', [
    'const homeEnv = sanitizePackagedDshHomeEnv',
    'setRenderHintsSource(detectGpuTier(app)',
    'setDesktopDshHome(desktopDshHomeFromUserData',
    "require('./whalebridge-notifications').startWhaleBridgeNotifications()",
    "app.once('will-quit', stopWhaleBridgeNotifications)",
    'configureDesktopPet({',
    'configureProfileOps({',
    'configureLive2dPet({',
    'fs.mkdirSync(config.workspace',
    'app.setLoginItemSettings(',
    'setGithubTokenProvider(',
    'setUpdateRouteProvider(',
    'startDesktopInstallControl({',
    'await desktopInstallReady()',
    'taskControlPeer.start()',
    'createDesktopUpdateCenter(',
    'desktopResources = registerIpc(',
    'installShortcutService({',
    'getShortcutService().attach(existingView)',
    'rebuildMenu()',
    'createTray(',
    'watchSystemTheme()',
    'createUpdatesState({',
    'installBrowserGuests(',
    'new DesktopPlatformView(',
    'registerPlatformIpc({',
    'installMediaPermissions(',
    'pruneCrashReports(',
    "on('will-download'",
    'await prepareLauncher()',
    'bindLauncherClose(launcherWin)',
  ]);
});

test('启动顺序：--dshd-from-launcher 直通分支与 backgroundStartup 复位', () => {
  const region = sliceEntryAny('const startupOptions = { activate: !', [
    "qaEnv('DSH_SMOKE')",
    '\n  return {',
    '\n}',
  ]);
  const direct = region.indexOf("process.argv.includes('--dshd-from-launcher')");
  assert.ok(direct >= 0);
  assert.ok(region.indexOf("process.argv.includes('--skip-user-plugins')") > direct);
  assert.ok(region.indexOf('harness.writePluginSkip(') > direct);
  const start = region.indexOf('await startDesktopFromLauncher(startupOptions)', direct);
  assert.ok(start > direct, '直通分支直接启动桌面');
  assert.ok(region.indexOf('runColdStartGate(startupOptions)') > start,
    '普通分支走冷启动闸门');
  assert.match(region, /finally \{[\s\S]*?backgroundStartup = false;/,
    '成功或失败都必须复位 backgroundStartup');
});

test('启动顺序：smoke 编排只在 DSH_SMOKE 门禁内惰性加载 ./smoke', () => {
  const index = entryFile("qaEnv('DSH_SMOKE')");
  const gate = index.source.indexOf("qaEnv('DSH_SMOKE')");
  const lazy = index.source.indexOf("require('./smoke')");
  assert.ok(gate >= 0 && lazy > gate, 'smoke 模块必须在门禁之后惰性 require');
  assert.match(index.source, /getDesktopResources:\s*\(\)\s*=>\s*(?:state\.)?desktopResources/);
  assert.match(index.source, /getQuitIntercepted:\s*\(\)\s*=>\s*(?:state\.)?qaQuitIntercepted/);
  assert.match(index.source, /resetQuitIntercepted:\s*\(\)\s*=>\s*\{\s*(?:state\.)?qaQuitIntercepted = false;\s*\}/);
});

// ---------------------------------------------------------------------------
// 退出流程

function productionQuitSlice() {
  return sliceEntry("app.on('before-quit'", "app.on('window-all-closed'") +
    '\n' + sliceEntry('function quitApp()', 'function ignoreFailure(') +
    '\n' + sliceEntry('function bindMainClose(', 'async function openLauncher(') +
    '\n; ({ finalize: finalizeQuit, request: quitApp, bindMainClose, bindLauncherClose })';
}

function quitContext(state, overrides = {}) {
  const appEvents = new EventEmitter();
  const context = {
    state,
    dsh: { log: () => {} },
    taskProtection: {
      coordinate: async () => ({ proceeded: true }),
      cleanupAfterQuit: async () => {},
    },
    harness: { shutdown: async () => {} },
    cleanupDesktopResources: async () => {},
    getLive2dPet: () => null,
    stopDesktopInstallControl: () => {},
    taskControlPeer: { stop: async () => {} },
    showClosingOverlay: async () => {},
    getMainWindow: () => null,
    getHarnessWebContents: () => null,
    loadConfig: () => ({}),
    hideOnClose: () => false,
    qaEnv: () => false,
    process,
    console,
    setTimeout,
    clearTimeout,
    quitApp: () => {},
    mainCloseBound: new WeakSet(),
    launcherCloseBound: new WeakSet(),
    trayHideNotice: { close: (fn) => fn() },
    drainParkedUpdateCheck: { drain: async () => {} },
    app: { quit() {}, exit() {} },
    ...overrides,
  };
  context.app.on = appEvents.on.bind(appEvents);
  context.app.once = appEvents.once.bind(appEvents);
  installStateAliases(context, state);
  vm.createContext(context);
  return { context, appEvents };
}

function loadProductionQuit(state, overrides = {}) {
  const { context, appEvents } = quitContext(state, overrides);
  const fns = vm.runInContext(productionQuitSlice(), context);
  return { ...fns, beforeQuit: (event) => appEvents.emit('before-quit', event), context, appEvents };
}

test('退出：before-quit 拦截后经任务保护走关闭覆盖层与六件套关停再 app.quit', async () => {
  const events = [];
  const state = shellState();
  const fixture = loadProductionQuit(state, {
    taskProtection: {
      coordinate: async (op, opts) => {
        events.push(`coordinate:${op}`);
        assert.equal(op, 'quit');
        assert.equal(opts.terminal, true);
        assert.equal(opts.preConfirmed, true);
        assert.equal(opts.drainTimeoutMs, 3000);
        await opts.commit();
        return { proceeded: true };
      },
      cleanupAfterQuit: async () => events.push('protection-cleanup'),
    },
    harness: { shutdown: async () => events.push('harness-shutdown') },
    cleanupDesktopResources: async () => events.push('desktop-cleanup'),
    getLive2dPet: () => ({ dispose: async () => events.push('pet-dispose') }),
    stopDesktopInstallControl: () => events.push('control-stop'),
    taskControlPeer: { stop: async () => events.push('peer-stop') },
    showClosingOverlay: async () => { events.push('closing-overlay'); },
    getMainWindow: () => ({}),
    app: {
      quit() { events.push('app.quit'); fixture.appEvents.emit('quit', {}, 0); },
      exit() { events.push('app.exit'); },
    },
  });
  const { beforeQuit } = fixture;
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  beforeQuit(event);
  assert.equal(event.defaultPrevented, true, 'before-quit 必须拦截默认退出');
  assert.equal(state.quitting, true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.slice(0, 1), ['coordinate:quit']);
  assert.ok(events.indexOf('closing-overlay') < events.indexOf('harness-shutdown'),
    '关闭覆盖层先于资源关停');
  for (const step of ['desktop-cleanup', 'pet-dispose', 'control-stop', 'peer-stop', 'protection-cleanup']) {
    assert.ok(events.includes(step), `缺少关停步骤 ${step}`);
  }
  assert.equal(state.nativeQuitReady, true);
  assert.equal(events.at(-1), 'app.quit');
});

test('退出：任务保护放行失败时执行有界清理后直接 app.exit(0)', async () => {
  const events = [];
  const state = shellState();
  const { beforeQuit } = loadProductionQuit(state, {
    taskProtection: {
      coordinate: async () => ({ proceeded: false, code: 'dshd/drain-timeout', pendingCount: 1, pendingLabels: ['job'] }),
      cleanupAfterQuit: async () => events.push('protection-cleanup'),
    },
    harness: { shutdown: async () => events.push('harness-shutdown') },
    app: { quit() { events.push('app.quit'); }, exit(code) { events.push(`app.exit:${code}`); } },
  });
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  beforeQuit(event);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(events.includes('harness-shutdown'), '失败分支仍执行关停');
  assert.equal(events.at(-1), 'app.exit:0');
  assert.equal(state.nativeQuitReady, false);
  assert.equal(state.quitInProgress, false);
});

test('退出：window-all-closed 在非 darwin 且不驻留时走 quitApp', () => {
  const region = `${sliceEntryAny("app.on('window-all-closed'", ['\n  });', '\n    });'])}\n  });`;
  for (const [platform, hide, expected] of [
    ['linux', false, true],
    ['linux', true, false],
    ['darwin', false, false],
  ]) {
    let quits = 0;
    let listener;
    const context = vm.createContext({
      process: { platform },
      hideOnClose: () => hide,
      loadConfig: () => ({}),
      quitApp: () => { quits++; },
      app: { on: (_name, fn) => { listener = fn; } },
    });
    vm.runInContext(region, context);
    listener();
    assert.equal(quits, expected ? 1 : 0, `${platform} hide=${hide}`);
  }
});

test('退出：quitApp 在 QA 壳下拦截且不触碰 app.quit', () => {
  const source = sliceEntry('function quitApp()', 'function ignoreFailure(');
  for (const allow of [false, true]) {
    const state = shellState();
    let quits = 0;
    const context = {
      state,
      qaEnv: () => !allow,
      process: { env: allow ? { DSH_QA_ALLOW_QUIT: '1' } : {} },
      console: { log() {} },
      app: { quit: () => { quits++; } },
    };
    installStateAliases(context, state);
    vm.runInNewContext(`${source}; ({ quitApp })`, context).quitApp();
    if (allow) {
      assert.equal(quits, 1);
      assert.equal(state.qaQuitIntercepted, false);
      assert.equal(state.quitting, true);
    } else {
      assert.equal(quits, 0, 'QA 拦截不得真正退出');
      assert.equal(state.qaQuitIntercepted, true);
    }
  }
});

// ---------------------------------------------------------------------------
// 窗口关闭行为（托盘隐藏而非退出）

function closeSliceContext(state, scenario = {}) {
  const win = new EventEmitter();
  win.hide = () => { scenario.hidden = true; };
  win.isDestroyed = () => false;
  const context = {
    state,
    mainCloseBound: new WeakSet(),
    launcherCloseBound: new WeakSet(),
    hideOnClose: () => scenario.hide === true,
    loadConfig: () => ({}),
    trayHideNotice: { close: (fn) => fn() },
    quitApp: () => { scenario.quits = (scenario.quits || 0) + 1; },
    drainParkedUpdateCheck: { drain: (options) => { scenario.drained.push(options); return Promise.resolve(); } },
    getMainWindow: () => scenario.mainWindow || null,
  };
  installStateAliases(context, state);
  return { win, context };
}

test('窗口关闭：主窗 close 依配置隐藏到托盘或走受保护退出，quitting 时阻止关闭直到放行', () => {
  const region = `${sliceEntry('function bindMainClose(', 'async function openLauncher(')}; ({ bindMainClose, bindLauncherClose })`;
  for (const scenario of [
    { name: 'quitting 未放行', state: { quitting: true, nativeQuitReady: false }, hide: false,
      expect: { prevented: true, hidden: false, quit: 0 } },
    { name: 'quitting 已放行', state: { quitting: true, nativeQuitReady: true }, hide: false,
      expect: { prevented: false, hidden: false, quit: 0 } },
    { name: '驻留托盘', state: { quitting: false }, hide: true,
      expect: { prevented: true, hidden: true, quit: 0 } },
    { name: '直接退出', state: { quitting: false }, hide: false,
      expect: { prevented: true, hidden: false, quit: 1 } },
  ]) {
    const state = shellState(scenario.state);
    const probe = { hide: scenario.hide, quits: 0, hidden: false, drained: [], mainWindow: null };
    const { win, context } = closeSliceContext(state, probe);
    const { bindMainClose } = vm.runInNewContext(region, context);
    bindMainClose(win);
    let prevented = false;
    win.emit('close', { preventDefault: () => { prevented = true; } });
    assert.equal(prevented, scenario.expect.prevented, scenario.name);
    assert.equal(probe.hidden, scenario.expect.hidden, scenario.name);
    assert.equal(probe.quits, scenario.expect.quit, scenario.name);
  }
});

test('窗口关闭：启动器 show 时排空暂存的更新检查，无主窗时 close 走退出', () => {
  const region = `${sliceEntry('function bindMainClose(', 'async function openLauncher(')}; ({ bindLauncherClose })`;
  const state = shellState();
  const probe = { quits: 0, hidden: false, drained: [], mainWindow: null };
  const { win, context } = closeSliceContext(state, probe);
  const { bindLauncherClose } = vm.runInNewContext(region, context);
  bindLauncherClose(win);
  win.emit('show');
  assert.equal(probe.drained.length, 1, 'launcher 显示即排空暂存的更新检查');
  assert.equal(probe.drained[0].generation, win);
  let prevented = false;
  win.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(probe.quits, 1, '无主窗时关闭启动器等同退出');
  probe.mainWindow = {};
  probe.quits = 0;
  win.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(probe.quits, 0, '主窗存在时关闭启动器不触发退出');
});

// ---------------------------------------------------------------------------
// 更新流程入口

test('更新：冷启动闸门 installUpdate 与 parked drainer 接线固定', () => {
  const gate = sliceEntry('function gateInstallUpdate(', 'function runColdStartGate(');
  assert.match(gate, /(?:state\.)?desktopResources\.launcher\.installUpdate\(onProgress,\s*\{/);
  assert.match(gate, /confirmUnverified:\s*confirmUnverifiedColdStart/);
  assert.match(gate, /expectedCheck:\s*check/);
  assert.match(gate, /downloadMode:\s*check\?\.downloadMode/);

  const coldGate = sliceEntry('function runColdStartGate(', 'const drainParkedUpdateCheck =');
  for (const marker of [
    'isLauncherPackage()',
    'runtimeInstall.checkDesktopUpdate()',
    "async () => ({ status: 'none' })",
    'installUpdate: gateInstallUpdate',
    'check.downloadMode = result.downloadMode',
    'runtimeInstall.startExternalDesktop()',
    'startDesktopFromLauncher(options)',
    'recoverInterruptedImport',
    'readImportJournal',
    'journalIsBlocked',
    'sendToLauncher',
  ]) {
    assert.ok(coldGate.includes(marker), `冷启动闸门缺少接线 ${marker}`);
  }
  assert.match(coldGate, /confirmUpdate:\s*async\s*\((?:\/\*\*\s*@type\s*\{[^}]+\}\s*\*\/\s*)?check\)/,
    '冷启动闸门缺少 confirmUpdate 接线');

  const drainer = `${sliceEntryAny('createParkedUpdateDrainer({', ['\n});', '\n  });'])}\n});`;
  for (const marker of [
    'isVisible:',
    'isQuitting:',
    'isCurrentGeneration:',
    'presentUpdateAsk({',
    'pending.downloadMode = result.downloadMode',
    'installUpdate: gateInstallUpdate',
    'openLauncher,',
    'sendToLauncher,',
    'shouldContinue:',
  ]) {
    assert.ok(drainer.includes(marker), `暂存更新检查排空缺少接线 ${marker}`);
  }
  assert.match(drainer, /confirmUpdate:\s*async\s*\((?:\/\*\*\s*@type\s*\{[^}]+\}\s*\*\/\s*)?pending\)/,
    '暂存更新检查排空缺少 confirmUpdate 接线');
});

test('更新：openDesktopUpdate 走 检查→确认→安装，updateCenter 存在时改走更新中心', async () => {
  const fn = `${sliceEntryAny('async function openDesktopUpdate(', [
    '\n\n// Anchor for productized confirmations',
    '\n\n  return {',
  ])}\n; openDesktopUpdate`;
  // updateCenter 存在 → 直接打开更新中心
  {
    let opened = 0;
    const state = shellState({ updateCenter: { snapshot: () => ({}) } });
    const context = {
      state,
      openUpdateCenter: () => { opened++; },
      getMainWindow: () => 'main',
      checkUpdate: () => assert.fail('不应再检查更新'),
    };
    installStateAliases(context, state);
    await vm.runInNewContext(fn, context)();
    assert.equal(opened, 1);
  }
  // 已是最新
  {
    const dialogs = [];
    const state = shellState({ desktopResources: { launcher: {} } });
    const context = {
      state,
      openUpdateCenter: () => assert.fail('无更新中心'),
      getMainWindow: () => 'main',
      checkUpdate: async () => ({ status: 'none' }),
      confirmDialog: async (_win, options) => { dialogs.push(options.message); return { response: 0 }; },
      currentVersion: () => '1.0.0',
    };
    installStateAliases(context, state);
    await vm.runInNewContext(fn, context)();
    assert.deepEqual(dialogs, ['当前已是最新版本 1.0.0']);
  }
  // 可用 → 确认 → 安装（downloadMode 传递），已 launched 不再弹总结
  {
    const installs = [];
    const state = shellState({
      desktopResources: {
        launcher: { installUpdate: async (_progress, options) => { installs.push(options); return { launched: true }; } },
      },
    });
    const check = { status: 'available', latest: '2.0.0' };
    const context = {
      state,
      openUpdateCenter: () => assert.fail('无更新中心'),
      getMainWindow: () => 'main',
      checkUpdate: async () => check,
      updateAskOptions: async (info) => { assert.equal(info, check); return { buttons: [] }; },
      confirmDialog: async () => ({ response: 0, downloadMode: 'delta' }),
      confirmUnverifiedColdStart: async () => true,
    };
    installStateAliases(context, state);
    await vm.runInNewContext(fn, context)();
    assert.equal(installs.length, 1);
    assert.equal(installs[0].expectedCheck, check);
    assert.equal(installs[0].downloadMode, 'delta');
    assert.equal(typeof installs[0].confirmUnverified, 'function');
  }
});

// ---------------------------------------------------------------------------
// 控制通道

test('控制通道：startDesktopInstallControl 装配确认/重启/desktop 能力并等待就绪', () => {
  const region = sliceEntry('startDesktopInstallControl({', 'taskControlPeer.start()');
  // 参数名前可带可选的内联 JSDoc 类型注解（拆分模块为 0 诊断补的注解）。
  const T = '(?:/\\*\\*\\s*@type\\s*\\{[^}]+\\}\\s*\\*/\\s*)?';
  for (const pattern of [
    new RegExp(`installPlugin:\\s*\\(${T}spec,\\s*${T}options\\)\\s*=>`),
    /token:\s*loadConfig\(\)\.githubToken/,
    /startHarness:\s*restartWithCleanup/,
    /confirmModelAction/,
    /showSecret:\s*showDesktopSecret/,
    /desktop:\s*\{/,
    new RegExp(`project:\\s*\\(${T}payload\\)\\s*=>\\s*projectEnvironment\\.dispatch\\(payload\\)`),
    /state:\s*\(\)\s*=>\s*\{/,
    /kernel:\s*dshKernelState\(dsh\)/,
    /config:\s*publicConfig\(configNow\)/,
    /listMarketplace:/,
    new RegExp(`applyConfig:\\s*\\(${T}patch\\)\\s*=>`),
    /petSettings:/,
    new RegExp(`applyPetSettings:\\s*\\(${T}patch\\)\\s*=>`),
    new RegExp(`installCatalog:\\s*\\(${T}id,\\s*${T}options\\s*=\\s*\\{\\}\\)\\s*=>`),
    new RegExp(`removePlugin:\\s*async \\(${T}name\\)\\s*=>`),
    new RegExp(`disablePlugins:\\s*\\(${T}names\\)\\s*=>`),
    new RegExp(`enablePlugin:\\s*\\(${T}name\\)\\s*=>`),
  ]) {
    assert.match(region, pattern, `控制通道装配缺少 ${pattern}`);
  }
  const ready = region.indexOf('await desktopInstallReady()');
  const stop = region.indexOf('stopDesktopInstallControl()');
  assert.ok(ready > 0 && stop > ready, '启动失败必须 stopDesktopInstallControl');
  assert.match(region, /桌面安装控制通道启动失败/);
});

test('控制通道：令牌与环境经 dsh.js 注入 Harness 子进程', () => {
  const dsh = fs.readFileSync(path.join(__dirname, 'dsh.js'), 'utf8');
  assert.match(dsh, /desktopInstallEnv\(\)/, 'DSH_DESKTOP_INSTALL_URL 注入子进程环境');
  assert.match(dsh, /'DSH_DESKTOP_INSTALL_TOKEN',\s*desktopInstallToken\(\)/,
    'Bearer 令牌经秘密通道下发给 Harness');
});

test('控制通道：/desktop/state 形状固定', () => {
  const region = sliceEntry('state: () => {', 'listMarketplace:');
  const state = shellState();
  const context = {
    loadConfig: () => ({ disabledPlugins: ['a'], locale: 'zh' }),
    listInstalledPlugins: () => ({ plugins: [{ name: 'p1' }, { name: 'p2' }] }),
    currentVersion: () => '1.2.3',
    dshKernelState: () => 'ready',
    dsh: {},
    publicConfig: (config) => ({ public: config }),
  };
  installStateAliases(context, state);
  const fn = vm.runInNewContext(`({ ${region} }).state`, context);
  // vm realm 的对象原型不同，经 JSON 归一后比较形状
  assert.deepEqual(JSON.parse(JSON.stringify(fn())), {
    ok: true,
    version: '1.2.3',
    kernel: 'ready',
    plugins: ['p1', 'p2'],
    disabledPlugins: ['a'],
    config: { public: { disabledPlugins: ['a'], locale: 'zh' } },
  });
});

// ---------------------------------------------------------------------------
// Harness 组装线（保持现有装配文本）

test('Harness 组装：showHarness 不等待账号服务且携带会话 cookie', () => {
  const index = entryFile('new HarnessController({');
  const body = index.source.match(/showHarness:\s*async\s*\((?:\/\*\*\s*@type\s*\{[^}]+\}\s*\*\/\s*)?url,\s*(?:\/\*\*\s*@type\s*\{[^}]+\}\s*\*\/\s*)?extra\)\s*=>\s*\{([\s\S]*?)\n {2,}\},/);
  assert.ok(body, 'HarnessController 装配必须保留 showHarness 包装');
  assert.match(body[1], /initializeDesktopAccount\(url\)/);
  assert.match(body[1], /cookie:\s*dsh\.sessionCookie/);
  assert.match(body[1], /activate:\s*!(?:state\.)?backgroundStartup/);
});
