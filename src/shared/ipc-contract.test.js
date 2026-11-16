'use strict';

// IPC contract tests (#436, P3-1). Four guarantees:
//  1. Every main-process channel a registration module actually mounts is a
//     non-pending invoke/send row in IPC_CONTRACT — and nothing else. The
//     modules are driven with a recording ipc-register stub so the test sees
//     the real call sites, not a copied list.
//  2. Every channel a preload touches is open to that preload's surface in
//     the contract — and vice versa, both directions checked (preloads keep
//     literals because 6/7 run sandboxed; see the contract header).
//  3. Surface/role consistency: harness-only API sections map to harness-
//     only contract rows; shared surfaces only reach shared rows.
//  4. Every literal `webContents.send(...)`/`sendTo*(...)` push channel in
//     main/launcher code is declared as an `event` row.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { IPC_CONTRACT, IPC_SURFACES } = require('./ipc-contract');
const { IPC_ROLES } = require('../main/ipc-authorization');

const SRC = path.resolve(__dirname, '..');

// --- contract shape -----------------------------------------------------------

test('contract rows are well-formed and unique per (channel, kind)', () => {
  const seen = new Set();
  const kinds = new Set(['invoke', 'send', 'event']);
  const surfaces = new Set(Object.values(IPC_SURFACES));
  for (const row of IPC_CONTRACT) {
    assert.equal(typeof row.channel, 'string', 'channel name required');
    assert.ok(row.channel.length > 0, 'channel name required');
    assert.ok(kinds.has(row.kind), `${row.channel}: bad kind ${row.kind}`);
    assert.ok(Array.isArray(row.roles) && row.roles.length > 0, `${row.channel}: roles required`);
    for (const role of row.roles) {
      assert.ok(surfaces.has(role), `${row.channel}: unknown surface ${role}`);
    }
    const key = `${row.channel}#${row.kind}`;
    assert.ok(!seen.has(key), `duplicate contract row ${key}`);
    seen.add(key);
    if (row.kind !== 'event' && row.pending !== true && row.transport !== 'webContents') {
      assert.equal(typeof row.validate, 'function', `${row.channel}: incoming rows need validate`);
    }
    if (row.authorize !== undefined) {
      assert.equal(row.authorize, 'channel-owned', `${row.channel}: bad authorize marker`);
    }
  }
});

// --- driven main-process registrations -----------------------------------------

function stubModule(id, exports) {
  const filename = require.resolve(id);
  const previous = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return { filename, previous };
}

function restoreStubs(entries) {
  for (const { filename, previous } of entries) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
}

class FakeWindow {
  constructor() {
    this.webContents = {
      mainFrame: {},
      setWindowOpenHandler() {},
      on() {},
      once() {},
      send() {},
      isDestroyed: () => false,
    };
  }
  once() {} on() {} off() {}
  isDestroyed() { return false; }
  async loadFile() {} async loadURL() {}
  show() {} focus() {} close() {} destroy() {}
}

function electronStub() {
  return {
    ipcMain: { handle() {}, handleOnce() {}, on() {}, once() {}, removeHandler() {} },
    BrowserWindow: FakeWindow,
    BrowserView: class {},
    WebContentsView: class {},
    Menu: { buildFromTemplate: () => ({ popup() {} }) },
    nativeTheme: { on() {}, off() {}, removeListener() {}, themeSource: 'system', shouldUseDarkColors: false },
    screen: {
      getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
      getAllDisplays: () => [{ workAreaSize: { width: 1920, height: 1080 } }],
    },
    app: {
      getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-contract-')),
      getVersion: () => '0.0.0',
      setLoginItemSettings() {},
      commandLine: { appendSwitch() {} },
    },
    shell: { openExternal: async () => {}, openPath: async () => '' },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    session: { defaultSession: { on() {}, webRequest: { onHeadersReceived() {} } } },
    protocol: { handle() {}, registerSchemesAsPrivileged() {} },
    safeStorage: { isEncryptionAvailable: () => false },
    systemPreferences: {},
    Notification: class {},
    globalShortcut: { register() {}, unregisterAll() {} },
    clipboard: { writeText() {} },
  };
}

/**
 * Require `modulePath` against the stubbed electron/ipc-register and run
 * `register(exports)`, collecting every spec the module mounts.
 */
function mountChannels(drivers) {
  const mounted = [];
  const real = require('../main/ipc-register');
  const registerStub = {
    ...real,
    registerIpc: (spec) => { mounted.push(spec); },
    createRegisterIpc: () => (spec) => { mounted.push(spec); },
  };
  const stubs = [
    stubModule('electron', electronStub()),
    stubModule('../main/ipc-register', registerStub),
  ];
  try {
    for (const [modulePath, register] of drivers) {
      const resolved = require.resolve(modulePath);
      delete require.cache[resolved];
      register(require(resolved));
    }
  } finally {
    restoreStubs(stubs);
  }
  return mounted;
}

test('main-process registrations equal the contract invoke/send rows', () => {
  const mounted = mountChannels([
    // Core boot/harness/launcher surface; also mounts the shared launcher
    // lane, ipc-components, ipc-delta, launcher-confirm, pty and preview.
    ['../main/ipc', (m) => m.registerIpc({
      dsh: { snapshot: () => ({}), logs: [], log() {} },
      harness: null,
      startHarness: async () => ({ ok: true }),
      reloadPage() {},
      startDesktop: async () => ({ ok: true }),
      stopDesktopCleanup() {},
      remote: null,
      onOpenLauncher: async () => {},
      getLive2dPet: () => null,
    })],
    ['../main/chrome', (m) => m.bindChromeIpc()],
    ['../main/shortcuts', (m) => m.installShortcutService({
      ipcMain: {},
      userData: fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-contract-')),
      platform: 'linux',
      getView: () => undefined,
      getWindow: () => undefined,
      getOrigin: () => 'http://127.0.0.1:1',
      overlayInput: () => ({ revision: 0, blocked: false }),
      onMenuChanged() {},
    })],
    ['../main/updates-state', (m) => m.createUpdatesState({ onOpen: async () => {} })],
    ['../main/update-center/ipc', (m) => m.registerUpdateCenterIpc({
      ipcMain: {},
      center: { snapshot: () => ({}), subscribe: () => () => {}, command: async () => {} },
      centerWindow: { owns: () => false, webContents: null, open() {}, close() {} },
      releaseNotes: { releaseNotesTabs: () => [], plainReleaseNotes: () => '' },
      authorize: () => 'harness',
      parentFor: () => null,
      surfaces: () => [],
    })],
    ['../main/update-dialog', (m) => new m.ShellConfirmDialog('preload.js', 'file:///d.html', { create() {} })],
    // Mounts synchronously before its first await (register calls precede
    // `await window.loadFile`).
    ['../main/welcome-window', (m) => { void m.openWelcomeWindow({ id: 'zh-CN' }, {
      takeNotice: async () => {},
      startSignIn: async () => ({}),
      cancelSignIn: async () => {},
      copySignInLink: async () => '',
      saveApiKey: async () => ({}),
      skip: async () => {},
    }); }],
    ['../main/preview-file-window', (m) => m.createFilePreviewWindowController({
      ipcMain: { handle() {} },
      workspacePreview: { fileUrl: async () => ({ ok: true, url: 'file:///x' }) },
      authority: {},
    })],
    ['../main/browser-guests', (m) => m.installBrowserGuests(
      new m.BrowserGuests(() => 'http://127.0.0.1:1'),
      { ipcMain: {}, getView: () => undefined, getOrigin: () => 'http://127.0.0.1:1' },
    )],
    ['../main/platform-ipc', (m) => m.registerPlatformIpc({
      ipcMain: {},
      platformView: { bootstrap() {}, async open() {}, setBounds() {}, close() {} },
      refreshSession: async () => {},
      getHarnessView: () => undefined,
      getHarnessOrigin: () => 'http://127.0.0.1:1',
      getMainWindow: () => null,
      nativeTheme: {},
    })],
    ['../main/desktop-pet', (m) => m.createDesktopPetManager({
      ipcMain: { handle() {} },
      loadConfig: () => ({}),
      saveConfig() {},
      discoverPets: () => [],
      rendererFile: () => 'pet.html',
      preloadFile: () => 'pet-preload.js',
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
    })],
    ['../main/desktop-live2d', (m) => m.createLive2dPetManager({
      ipcMain: { handle() {} },
      protocol: { handle() {} },
      loadConfig: () => ({}),
      saveConfig() {},
      rendererFile: () => 'pet.html',
      preloadFile: () => 'pet-preload.js',
      getMainWindow: () => null,
      sessionsDir: '',
    })],
  ]);

  // Registration specs carry no inline contract fields — those are resolved
  // from IPC_CONTRACT by mount().
  for (const spec of mounted) {
    for (const key of ['kind', 'roles', 'validate']) {
      assert.equal(spec[key], undefined,
        `registerIpc(${spec.channel}): ${key} must come from the contract`);
    }
  }

  const actual = new Set(mounted.map((spec) => spec.channel));
  const expected = new Set(IPC_CONTRACT
    .filter((row) => row.kind !== 'event' && row.pending !== true && row.transport !== 'webContents')
    .map((row) => row.channel));
  assert.deepEqual([...actual].sort(), [...expected].sort(),
    'mounted channels must equal the contract incoming rows');
});

// --- preload coverage ------------------------------------------------------------

const PRELOAD_SURFACE = Object.freeze({
  'index.js': 'shell', // role-gated inside; sections map below
  'platform.js': IPC_SURFACES.PLATFORM,
  'update-center.js': IPC_SURFACES.UPDATE_CENTER,
  'update-dialog.js': IPC_SURFACES.UPDATE_DIALOG,
  'welcome.js': IPC_SURFACES.WELCOME,
  'whalebridge.js': IPC_SURFACES.WHALEBRIDGE,
  'file-preview.js': IPC_SURFACES.FILE_PREVIEW,
});

/** Extract { channel -> Set('invoke'|'send'|'event') } from preload source. */
function parsePreloadSource(src, file = '<fixture>') {
  const tables = {};
  for (const m of src.matchAll(/const (IPC|CHANNELS)\s*=\s*\{([^}]*)\}/g)) {
    const table = {};
    for (const kv of m[2].matchAll(/(\w+)\s*:\s*'([^']+)'/g)) table[kv[1]] = kv[2];
    tables[m[1]] = table;
  }
  const usage = new Map();
  const add = (kind, channel) => {
    if (!usage.has(channel)) usage.set(channel, new Set());
    usage.get(channel).add(kind);
  };
  // invoke(renderer|ipcRenderer, 'ch') / send(...) / subscribe(...)
  for (const m of src.matchAll(/\b(invoke|send|subscribe)\((?:renderer|ipcRenderer)\s*,\s*'([^']+)'/g)) {
    add(m[1] === 'subscribe' ? 'event' : m[1] === 'invoke' ? 'invoke' : 'send', m[2]);
  }
  // ipcRenderer.invoke('ch') / .send('ch') / .sendSync('ch') / .on('ch') / .once('ch')
  for (const m of src.matchAll(/ipcRenderer\.(invoke|sendSync|send|on|once)\(\s*'([^']+)'/g)) {
    add(m[1] === 'invoke' ? 'invoke' : (m[1] === 'send' || m[1] === 'sendSync') ? 'send' : 'event', m[2]);
  }
  // ipcRenderer.invoke(IPC.x) / .send(CHANNELS.x) / .on(IPC.x)
  for (const m of src.matchAll(/ipcRenderer\.(invoke|sendSync|send|on|once)\(\s*(IPC|CHANNELS)\.(\w+)/g)) {
    const channel = tables[m[2]]?.[m[3]];
    assert.ok(channel, `${file}: ${m[2]}.${m[3]} is not a channel table entry`);
    add(m[1] === 'invoke' ? 'invoke' : (m[1] === 'send' || m[1] === 'sendSync') ? 'send' : 'event', channel);
  }
  return usage;
}

function preloadUsage(file) {
  const src = fs.readFileSync(path.join(SRC, 'preload', file), 'utf8');
  return { src, usage: parsePreloadSource(src, file) };
}

// index.js sections: which API builder a channel literal sits in decides the
// surfaces it is exposed to. windowApi spreads into boot, harness and
// launcher; configApi only into harnessApi (saveConfig never reaches the
// boot or launcher API). The tail harness bridges and the shared
// render-mode block are handled separately below.
function sectionUsage(src = preloadUsage('index.js').src) {
  const sectionRoles = {
    windowApi: [IPC_ROLES.BOOT, IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER],
    configApi: [IPC_ROLES.HARNESS],
    bootApi: [IPC_ROLES.BOOT],
    harnessApi: [IPC_ROLES.HARNESS],
    launcherApi: [IPC_ROLES.LAUNCHER],
    petApi: [IPC_SURFACES.PET],
    live2dPetApi: [IPC_SURFACES.PET_LIVE2D],
  };
  const out = new Map(); // channel -> Map<kind, Set<surface>>
  const add = (channel, kind, roles) => {
    if (!out.has(channel)) out.set(channel, new Map());
    const kinds = out.get(channel);
    if (!kinds.has(kind)) kinds.set(kind, new Set());
    for (const role of roles) kinds.get(kind).add(role);
  };
  for (const [fn, roles] of Object.entries(sectionRoles)) {
    const m = src.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
    assert.ok(m, `index.js: missing builder ${fn}`);
    for (const call of m[0].matchAll(/\b(invoke|send|subscribe)\(renderer,\s*'([^']+)'/g)) {
      add(call[2], call[1] === 'subscribe' ? 'event' : call[1], roles);
    }
  }
  // Remaining literals outside the builders: the harness-only bridges
  // (dshDesktop/dshPlatform/native-theme) live in the `role === 'harness'`
  // block before the shell API is exposed; the render-mode block after
  // exposeInMainWorld('shell', ...) is gated to boot/harness/launcher.
  const tail = src.slice(src.indexOf("if (role === 'harness'"));
  const exposeAt = tail.indexOf("exposeInMainWorld('shell'");
  assert.ok(exposeAt > 0, 'index.js: shell exposure marker not found');
  const tailCalls = (part) => part.matchAll(
    /ipcRenderer\.(invoke|send|sendSync|on|once)\(\s*'([^']+)'|\b(invoke|send|subscribe)\(ipcRenderer,\s*'([^']+)'/g,
  );
  const callKind = (call) => {
    const kind = call[1] ?? call[3];
    return kind === 'invoke' ? 'invoke' : (kind === 'send' || kind === 'sendSync') ? 'send' : 'event';
  };
  for (const call of tailCalls(tail.slice(0, exposeAt))) {
    add(call[2] ?? call[4], callKind(call), [IPC_ROLES.HARNESS]);
  }
  for (const call of tailCalls(tail.slice(exposeAt))) {
    add(call[2] ?? call[4], callKind(call),
      [IPC_ROLES.BOOT, IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER]);
  }
  return out;
}

const INDEX_SURFACES = Object.freeze([
  IPC_ROLES.BOOT, IPC_ROLES.HARNESS, IPC_ROLES.LAUNCHER,
  IPC_SURFACES.PET, IPC_SURFACES.PET_LIVE2D,
]);

/**
 * Both directions between the contract and an index.js exposure map
 * (channel -> Map<kind, Set<surface>>):
 *  - the preload may only bind a (channel, kind) on a surface the contract
 *    authorizes for that kind — anything else is dead, over-broad API;
 *  - a contract row may not open a surface the preload never binds for that
 *    kind — roles are authorization facts, not hopes.
 * Returns human-readable violations; [] means consistent.
 */
function indexViolations(contract, exposure, surfaces = INDEX_SURFACES) {
  const violations = [];
  for (const [channel, kinds] of exposure) {
    for (const [kind, roles] of kinds) {
      for (const role of roles) {
        const found = contract.some((row) => row.channel === channel
          && row.kind === kind && row.roles.includes(role));
        if (!found) {
          violations.push(`${channel}: the preload exposes ${kind} to ${role} but no contract row authorizes it`);
        }
      }
    }
  }
  for (const row of contract) {
    if (row.transport === 'webContents') continue;
    for (const role of surfaces) {
      if (!row.roles.includes(role)) continue;
      if (!exposure.get(row.channel)?.get(row.kind)?.has(role)) {
        violations.push(`${row.channel} (${row.kind}): the contract opens ${role} but the preload never binds it there`);
      }
    }
  }
  return violations;
}

/**
 * Both directions for a window-owned preload (usage: channel -> Set<kind>):
 * every (channel, kind) it uses must be open to its surface, and every
 * non-channel-owned, non-pending row opening that surface must be used.
 * Channel-owned rows (e.g. the update center's own authorize) are exempt
 * from the second direction — their roles describe what `authorize` may
 * grant, not what every surface binds.
 */
function preloadViolations(contract, surface, usage) {
  const violations = [];
  for (const [channel, kinds] of usage) {
    const rows = contract.filter((row) => row.channel === channel && row.roles.includes(surface));
    if (rows.length === 0) {
      violations.push(`${channel}: the ${surface} preload uses it but the contract does not open it to ${surface}`);
      continue;
    }
    for (const kind of kinds) {
      if (!rows.some((row) => row.kind === kind)) {
        violations.push(`${channel}: the ${surface} preload uses ${kind} but the contract has ${rows.map((row) => row.kind)}`);
      }
    }
  }
  for (const row of contract) {
    if (!row.roles.includes(surface) || row.authorize === 'channel-owned' || row.pending === true) continue;
    if (!usage.has(row.channel)) {
      violations.push(`${row.channel} (${row.kind}): the contract opens ${surface} but the preload never uses it`);
    }
  }
  return violations;
}

test('index.js preload channels match the contract for each gated surface', () => {
  const map = sectionUsage();
  assert.ok(map.size > 100, `index.js channel extraction too small: ${map.size}`);
  assert.deepEqual(indexViolations(IPC_CONTRACT, map), []);
});

test('window-owned preloads use exactly the channels their surface allows', () => {
  for (const [file, surface] of Object.entries(PRELOAD_SURFACE)) {
    if (file === 'index.js') continue;
    const { usage } = preloadUsage(file);
    assert.deepEqual(preloadViolations(IPC_CONTRACT, surface, usage), []);
  }
});

test('surface checks reject fixture over-exposure and unbound contract rows', () => {
  const contract = [
    { channel: 'shell:demo', kind: 'invoke', roles: [IPC_ROLES.HARNESS], validate: () => [] },
    { channel: 'shell:wants-boot', kind: 'invoke', roles: [IPC_ROLES.BOOT], validate: () => [] },
    { channel: 'shell:evt', kind: 'event', roles: [IPC_ROLES.BOOT] },
  ];
  const exposure = new Map([
    // Over-exposed: bound on boot although the contract only authorizes harness.
    ['shell:demo', new Map([['invoke', new Set([IPC_ROLES.BOOT, IPC_ROLES.HARNESS])]])],
    // shell:wants-boot has no binding at all; shell:evt is never subscribed.
    ['shell:evt', new Map()],
  ]);
  const violations = indexViolations(contract, exposure);
  assert.ok(violations.some((v) => v.includes('shell:demo') && v.includes(IPC_ROLES.BOOT)),
    `over-exposure not reported: ${violations}`);
  assert.ok(violations.some((v) => v.includes('shell:wants-boot')),
    `unbound contract row not reported: ${violations}`);
  assert.ok(violations.some((v) => v.includes('shell:evt')),
    `unbound event row not reported: ${violations}`);

  const usage = new Map([
    ['shell:demo', new Set(['invoke'])],
    ['shell:foreign', new Set(['invoke'])],
  ]);
  const windowBad = preloadViolations(contract, IPC_SURFACES.UPDATE_CENTER, usage);
  assert.ok(windowBad.some((v) => v.includes('shell:demo')),
    `unauthorized surface use not reported: ${windowBad}`);
  assert.ok(windowBad.some((v) => v.includes('shell:foreign')),
    `undeclared channel not reported: ${windowBad}`);
});

test('fixture preload source fails the real contract check in both directions', () => {
  // A miniature index.js that misplaces shell:save-config (HARNESS_ONLY)
  // inside the boot API and binds nothing else. The check must flag both the
  // over-exposure and the contract rows that go unbound on their surfaces.
  const fixtureSrc = `'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (renderer, channel) => (...args) => renderer.invoke(channel, ...args);
const send = (renderer, channel) => (...args) => renderer.send(channel, ...args);
function windowApi(renderer) {
  return { windowAction: send(renderer, 'shell:window') };
}
function configApi(renderer) {
  return { saveConfig: invoke(renderer, 'shell:save-config') };
}
function bootApi(renderer) {
  return {
    ...windowApi(renderer),
    saveConfig: invoke(renderer, 'shell:save-config'),
  };
}
function harnessApi(renderer) {
  return { ...windowApi(renderer), ...configApi(renderer) };
}
function launcherApi(renderer) {
  return { ...windowApi(renderer) };
}
function petApi(renderer) {
  return {};
}
function live2dPetApi(renderer) {
  return {};
}
function buildApi(role, renderer) {
  if (role === 'harness') return harnessApi(renderer);
  return windowApi(renderer);
}
contextBridge.exposeInMainWorld('shell', buildApi(role, ipcRenderer));
`;
  const violations = indexViolations(IPC_CONTRACT, sectionUsage(fixtureSrc));
  assert.ok(violations.some((v) => v.includes('shell:save-config')
    && v.includes(`exposes invoke to ${IPC_ROLES.BOOT}`)),
    `over-exposure not reported: ${violations.join('\n')}`);
  assert.ok(violations.some((v) => v.includes('shell:restart')
    && v.includes('never binds')),
    `unbound contract row not reported: ${violations.join('\n')}`);

  // Same both-direction proof for a window-owned preload: it invokes a
  // channel the contract never opens to its surface, and it never
  // subscribes to the update-center state broadcast the contract opens.
  const centerSrc = `'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('updateCenter', {
  state: () => ipcRenderer.invoke('shell:update-center-state'),
  foreign: () => ipcRenderer.invoke('shell:open-external'),
});
`;
  const windowBad = preloadViolations(IPC_CONTRACT, IPC_SURFACES.UPDATE_CENTER,
    parsePreloadSource(centerSrc));
  assert.ok(windowBad.some((v) => v.includes('shell:open-external')),
    `unauthorized surface use not reported: ${windowBad.join('\n')}`);
  assert.ok(windowBad.some((v) => v.includes('shell:update-center (event)')),
    `unused contract row not reported: ${windowBad.join('\n')}`);
});

// --- main→renderer push coverage ---------------------------------------------------

test('every literal push channel in main/launcher code is a contract event', () => {
  const files = [
    ...fs.readdirSync(path.join(SRC, 'main')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => `main/${f}`),
    ...fs.readdirSync(path.join(SRC, 'main', 'update-center')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => `main/update-center/${f}`),
    ...fs.readdirSync(path.join(SRC, 'launcher')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => `launcher/${f}`),
  ];
  const events = new Set(IPC_CONTRACT.filter((row) => row.kind === 'event').map((row) => row.channel));
  const tables = new Map(); // file -> {tableName -> {key -> channel}}
  const found = new Set();
  for (const file of files) {
    const src = fs.readFileSync(path.join(SRC, file), 'utf8');
    const table = {};
    for (const m of src.matchAll(/const (IPC|CHANNELS|PLATFORM_IPC|UPDATE_CENTER_IPC|UPDATE_DIALOG_IPC|WELCOME_IPC|BROWSER_IPC)\s*=\s*(?:Object\.freeze\()?\{([^}]*)\}/g)) {
      for (const kv of m[2].matchAll(/(\w+)\s*:\s*'([^']+)'/g)) table[`${m[1]}.${kv[1]}`] = kv[2];
    }
    tables.set(file, table);
    // literal sends: .send('ch', ...)
    for (const m of src.matchAll(/\.send\(\s*'([^']+)'/g)) found.add(m[1]);
    // table sends: .send(IPC.x / CHANNELS.x / PLATFORM_IPC.x / ...)
    for (const m of src.matchAll(/\.send\(\s*((?:IPC|CHANNELS|PLATFORM_IPC|UPDATE_CENTER_IPC|UPDATE_DIALOG_IPC|WELCOME_IPC|BROWSER_IPC)\.\w+)/g)) {
      const channel = table[m[1]];
      assert.ok(channel, `${file}: ${m[1]} is not a channel table entry`);
      found.add(channel);
    }
  }
  // Parameterized helpers carry literals at their call sites.
  const callers = [path.join(SRC, 'main', 'index.js'), path.join(SRC, 'main', 'harness-controller.js'),
    path.join(SRC, 'main', 'launcher-gate.js'), path.join(SRC, 'main', 'window.js'),
    path.join(SRC, 'main', 'preview.js'), path.join(SRC, 'main', 'pty.js'),
    path.join(SRC, 'launcher', 'launcher-confirm.js')];
  for (const file of callers) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\b(?:sendToBoot|sendToLauncher|sendToHost|publish)\('([^']+)'/g)) {
      found.add(m[1]);
    }
    for (const m of src.matchAll(/\.send\(\s*(CONFIRM_EVENT|FILE_PREVIEW_STATE_CHANNEL)\b/g)) {
      found.add(m[1] === 'CONFIRM_EVENT' ? 'shell:app-confirm' : 'shell:file-preview-state');
    }
  }
  for (const channel of found) {
    assert.ok(events.has(channel), `${channel}: pushed to renderers but not a contract event`);
  }
});
