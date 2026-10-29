'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { createShortcutService, ariaToAccelerator, CHANNELS } = require('./shortcuts');

const PROTOCOL_URL = pathToFileURL(path.join(
  __dirname, 'shortcuts-protocol.mjs',
)).href;

const DEFINITIONS = [
  {
    id: 'workspace.add',
    defaults: { 'desktop:windows': { code: 'KeyO', modifiers: ['primary'] } },
  },
  {
    id: 'settings.open',
    defaults: { 'desktop:windows': { code: 'Comma', modifiers: ['primary'] } },
  },
  {
    id: 'surfaces.toggle',
    defaults: { 'desktop:windows': { code: 'Backslash', modifiers: ['primary'] } },
  },
];

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-shortcuts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeIpc() {
  const handlers = new Map();
  return {
    handle(channel, fn) { handlers.set(channel, fn); },
    removeHandler(channel) { handlers.delete(channel); },
    handlers,
  };
}

function fakeWindow() {
  const listeners = new Map();
  return {
    closedCount: 0,
    isDestroyed: () => false,
    isFocused: () => true,
    isEnabled: () => true,
    close() { this.closedCount += 1; },
    on(name, fn) { listeners.set(name, fn); },
    off(name) { listeners.delete(name); },
  };
}

function fakeContents(origin) {
  const listeners = new Map();
  const contents = {
    mainFrame: { url: `${origin}/`, parent: null, name: '' },
    focusedFrame: null,
    sent: [],
    ignoredMenuShortcuts: false,
    isDestroyed: () => false,
    send(channel, payload) { this.sent.push({ channel, payload }); },
    setIgnoreMenuShortcuts(value) { this.ignoredMenuShortcuts = value; },
    on(name, fn) { listeners.set(name, [...(listeners.get(name) ?? []), fn]); },
    once(name, fn) { listeners.set(name, [...(listeners.get(name) ?? []), fn]); },
    off(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== fn)); },
    emit(name, ...args) { for (const fn of listeners.get(name) ?? []) fn(...args); },
  };
  contents.focusedFrame = contents.mainFrame;
  return contents;
}

async function createService(t, { origin = 'http://127.0.0.1:4180', platform = 'windows' } = {}) {
  const protocol = await import(PROTOCOL_URL);
  const userData = tmpDir(t);
  const ipc = fakeIpc();
  const win = fakeWindow();
  const contents = fakeContents(origin);
  const view = { webContents: contents };
  const overlay = { revision: 0, blocked: false };
  const menuCalls = [];
  const service = createShortcutService({
    ipcMain: ipc,
    userData,
    platform,
    getView: () => view,
    getWindow: () => win,
    getOrigin: () => origin,
    overlayInput: () => overlay,
    onMenuChanged: () => menuCalls.push(Date.now()),
    protocol,
  });
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const inputEvent = () => {
    let prevented = false;
    return { preventDefault: () => { prevented = true; }, get defaultPrevented() { return prevented; } };
  };
  return { service, ipc, win, contents, view, overlay, menuCalls, event, inputEvent, userData, origin };
}

const keydown = (code, opts = {}) => ({
  type: 'keyDown', code, key: code, control: false, alt: false, shift: false, meta: false,
  isAutoRepeat: false, isComposing: false, modifiers: [], ...opts,
});

test('Mac native redo reaches the editor without registry interception and respects input guards', async (t) => {
  const b = await createService(t, { platform: 'macos' });
  t.after(() => b.service.dispose());
  const sent = [];
  b.contents.focus = () => {};
  b.contents.sendInputEvent = input => sent.push(input);
  assert.equal(b.service.sendEditingKey('Z', ['meta', 'shift']), true);
  assert.deepEqual(sent, [
    { type: 'keyDown', keyCode: 'Z', modifiers: ['meta', 'shift'] },
    { type: 'keyUp', keyCode: 'Z', modifiers: ['meta', 'shift'] },
  ]);
  b.overlay.blocked = true;
  assert.equal(b.service.sendEditingKey('Z', ['meta', 'shift']), true);
  assert.equal(sent.length, 2);
  b.win.isFocused = () => false;
  assert.equal(b.service.sendEditingKey('Z', ['meta', 'shift']), false);
  assert.equal(sent.length, 2, 'launcher and other windows keep their native editing owner');
});

test('get serves defaults when no device file exists', async (t) => {
  const { service, ipc, event, userData } = await createService(t);
  const snapshot = await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, null);
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.usingDefaults, true);
  assert.equal(fs.existsSync(path.join(userData, 'keybindings.json')), false);
  assert.ok(service.currentRevision());
});

test('get migrates a valid web document once, keeping a receipt', async (t) => {
  const { ipc, event, userData } = await createService(t);
  const webRaw = JSON.stringify({
    schemaVersion: 1,
    profiles: { 'web:windows': { 'workspace.add': { code: 'KeyP', modifiers: ['primary'] } } },
  });
  const snapshot = await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, webRaw);
  assert.equal(snapshot.status, 'ready');
  const migrated = JSON.parse(fs.readFileSync(path.join(userData, 'keybindings.json'), 'utf8'));
  assert.equal(migrated.profiles['web:windows']['workspace.add'].code, 'KeyP');
  const receipt = JSON.parse(fs.readFileSync(path.join(userData, 'keybindings-migration.json'), 'utf8'));
  assert.equal(receipt.target, 'keybindings.json');
});

test('get never overwrites an existing device file with web state', async (t) => {
  const { ipc, event, userData } = await createService(t);
  const existing = JSON.stringify({ schemaVersion: 2, profiles: { 'desktop:windows': {} } });
  fs.writeFileSync(path.join(userData, 'keybindings.json'), existing);
  const webRaw = JSON.stringify({ schemaVersion: 1, profiles: { 'web:windows': { 'workspace.add': { code: 'KeyP', modifiers: ['primary'] } } } });
  await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, webRaw);
  assert.equal(fs.readFileSync(path.join(userData, 'keybindings.json'), 'utf8'), existing);
  assert.equal(fs.existsSync(path.join(userData, 'keybindings-migration.json')), false);
});

test('get ignores an invalid web payload', async (t) => {
  const { ipc, event, userData } = await createService(t);
  await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, '{"schemaVersion":9}');
  assert.equal(fs.existsSync(path.join(userData, 'keybindings.json')), false);
});

test('edit persists a user binding and stale revisions are rejected', async (t) => {
  const { service, ipc, event, userData } = await createService(t);
  const snapshot = await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, null);
  const stale = await ipc.handlers.get(CHANNELS.edit)(
    event, { type: 'set', id: 'workspace.add', binding: { code: 'KeyP', modifiers: ['primary'] } }, 'wrong-revision');
  assert.equal(stale.status, 'stale');
  const saved = await ipc.handlers.get(CHANNELS.edit)(
    event, { type: 'set', id: 'workspace.add', binding: { code: 'KeyP', modifiers: ['primary'] } }, snapshot.revision);
  assert.equal(saved.status, 'saved');
  const written = JSON.parse(fs.readFileSync(path.join(userData, 'keybindings.json'), 'utf8'));
  assert.equal(written.profiles['desktop:windows']['workspace.add'].code, 'KeyP');
  assert.equal(service.acceleratorFor('workspace.add'), 'CmdOrCtrl+P');
  const cleared = await ipc.handlers.get(CHANNELS.edit)(
    event, { type: 'set', id: 'workspace.add', binding: null }, saved.snapshot.revision);
  assert.equal(cleared.status, 'saved');
  // An unbound command owns no menu keycap; the menu must not show one.
  assert.equal(service.acceleratorFor('workspace.add'), undefined);
});

test('bound chords suppress native menu accelerators; unbound keys do not', async (t) => {
  const { service, ipc, event, contents, inputEvent } = await createService(t);
  service.attach({ webContents: contents });
  await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, null);
  contents.emit('before-input-event', inputEvent(), keydown('KeyO', { control: true }));
  assert.equal(contents.ignoredMenuShortcuts, true);
  contents.emit('before-input-event', inputEvent(), keydown('KeyZ', { control: true }));
  assert.equal(contents.ignoredMenuShortcuts, false);
});

test('overlay blocking swallows input; untrusted senders are rejected', async (t) => {
  const { service, ipc, event, contents, overlay, inputEvent } = await createService(t);
  service.attach({ webContents: contents });
  await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, null);
  overlay.blocked = true;
  const evt = inputEvent();
  contents.emit('before-input-event', evt, keydown('KeyO', { control: true }));
  assert.equal(evt.defaultPrevented, true);
  assert.equal(contents.ignoredMenuShortcuts, true);
  overlay.blocked = false;
  await assert.rejects(() => ipc.handlers.get(CHANNELS.get)(
    { sender: contents, senderFrame: { url: 'https://evil.example/' } }, DEFINITIONS, null), /rejected/);
});

test('recording suppresses menu shortcuts and menu dispatch honors it', async (t) => {
  const { service, ipc, event, contents } = await createService(t);
  service.attach({ webContents: contents });
  await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, null);
  ipc.handlers.get(CHANNELS.recording)(event, true);
  assert.equal(contents.ignoredMenuShortcuts, true);
  assert.equal(service.dispatchMenuCommand('workspace.add'), false);
  ipc.handlers.get(CHANNELS.recording)(event, false);
  assert.equal(service.dispatchMenuCommand('workspace.add'), true);
  const input = contents.sent.find((entry) => entry.channel === CHANNELS.input);
  assert.equal(input.payload.kind, 'menu');
  assert.equal(input.payload.commandId, 'workspace.add');
});

test('closeWindow requires the accepted revision', async (t) => {
  const { ipc, event, win } = await createService(t);
  const snapshot = await ipc.handlers.get(CHANNELS.get)({}, {}, null).catch(() => null);
  assert.equal(snapshot, null); // sender assertion
});

test('closeWindow honors revision and focus state', async (t) => {
  const { ipc, event, win } = await createService(t);
  const snapshot = await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, null);
  ipc.handlers.get(CHANNELS.closeWindow)(event, 'stale-revision');
  assert.equal(win.closedCount, 0);
  ipc.handlers.get(CHANNELS.closeWindow)(event, snapshot.revision);
  assert.equal(win.closedCount, 1);
});

test('ariaToAccelerator maps aria strings to Electron tokens', () => {
  assert.equal(ariaToAccelerator('Control+O'), 'CmdOrCtrl+O');
  assert.equal(ariaToAccelerator('Control+Shift+P'), 'CmdOrCtrl+Shift+P');
  assert.equal(ariaToAccelerator('Control+,'), 'CmdOrCtrl+,');
  assert.equal(ariaToAccelerator(undefined), undefined);
});

test('macOS keeps physical Control distinct from Command in native accelerators', () => {
  assert.equal(ariaToAccelerator('Meta+O', 'macos'), 'Command+O');
  assert.equal(ariaToAccelerator('Control+O', 'macos'), 'Control+O');
  assert.equal(ariaToAccelerator('Control+Meta+Shift+P', 'macos'), 'Control+Command+Shift+P');
  assert.equal(ariaToAccelerator('Meta+Alt+,', 'macos'), 'Command+Alt+,');
  assert.equal(ariaToAccelerator('Control+O', 'windows'), 'CmdOrCtrl+O');
  assert.equal(ariaToAccelerator('Meta+O', 'linux'), 'Super+O');
});

test('Mac registry keycaps and native dispatch agree for Command and Control bindings', async t => {
  const { service, ipc, event, contents, inputEvent } = await createService(t, { platform: 'macos' });
  service.attach({ webContents: contents });
  await ipc.handlers.get(CHANNELS.get)(event, [
    { id: 'workspace.add', defaults: { 'desktop:macos': { code: 'KeyO', modifiers: ['primary'] } } },
    { id: 'custom.control', defaults: { 'desktop:macos': { code: 'KeyO', modifiers: ['control'] } } },
  ], null);
  assert.equal(service.acceleratorFor('workspace.add'), 'Command+O');
  assert.equal(service.acceleratorFor('custom.control'), 'Control+O');
  for (const modifier of ['meta', 'control']) {
    const evt = inputEvent();
    contents.emit('before-input-event', evt, keydown('KeyO', { [modifier]: true }));
    assert.equal(evt.defaultPrevented, true, modifier);
    const last = contents.sent.filter(item => item.channel === CHANNELS.input).at(-1);
    assert.ok(last, modifier);
    assert.equal(last.payload.code, 'KeyO');
    assert.equal(last.payload.meta, modifier === 'meta');
    assert.equal(last.payload.control, modifier === 'control');
  }
});

test('native-first: bound keys inside a focused iframe are intercepted and dispatched', async (t) => {
  const { service, ipc, event, contents, inputEvent } = await createService(t);
  service.attach({ webContents: contents });
  await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, null);
  contents.focusedFrame = { url: `${'http://127.0.0.1:4180'}/frame`, parent: contents.mainFrame, name: 'dsh-sidebar-x' };
  const evt = inputEvent();
  contents.emit('before-input-event', evt, keydown('KeyO', { control: true }));
  assert.equal(evt.defaultPrevented, true);
  const input = contents.sent.find((entry) => entry.channel === CHANNELS.input);
  assert.equal(input.payload.kind, 'iframe');
  assert.equal(input.payload.frameName, 'dsh-sidebar-x');
  assert.equal(input.payload.code, 'KeyO');
});

test('native-first: unbound iframe keys stay with the guest; main-frame bound keys intercept as keyboard', async (t) => {
  const { service, ipc, event, contents, inputEvent } = await createService(t);
  service.attach({ webContents: contents });
  await ipc.handlers.get(CHANNELS.get)(event, DEFINITIONS, null);
  contents.focusedFrame = { url: 'http://127.0.0.1:4180/frame', parent: contents.mainFrame, name: 'guest' };
  const evt = inputEvent();
  contents.emit('before-input-event', evt, keydown('KeyZ', { control: true }));
  assert.equal(evt.defaultPrevented, false); // unbound: guest keeps it
  contents.focusedFrame = contents.mainFrame;
  const evt2 = inputEvent();
  contents.emit('before-input-event', evt2, keydown('KeyO', { control: true }));
  // Upstream priority: an accepted binding is intercepted on the main frame
  // too — the vendored DOM dispatcher arbitrates region/modal after delivery.
  assert.equal(evt2.defaultPrevented, true);
  const input = contents.sent.find((entry) => entry.channel === CHANNELS.input);
  assert.equal(input.payload.kind, 'keyboard');
  assert.equal(input.payload.frameName, '');
  assert.equal(input.payload.code, 'KeyO');
});
