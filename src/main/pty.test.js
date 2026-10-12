const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceAuthority } = require('./workspace-authority');
const {
  BACKEND_UNAVAILABLE,
  DEFAULT_OPEN_COLS,
  DEFAULT_OPEN_ROWS,
  createPtyController,
  registerPtyIpc,
  setWorkspaceAuthority,
  defaultShell,
  defaultShellArgs,
  ptySpawnOptions,
  createTerminalSpawnEnv,
  resolveShellCandidates,
} = require('./pty.js');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');

// One shared workspace root for the whole suite; cwd checks resolve inside it.
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-ws-'));
setWorkspaceAuthority(createWorkspaceAuthority({ workspace: ws }));

function fakeSpawn() {
  return ({ onData, onExit }) => ({
    write(data) {
      onData(data);
    },
    resize() {},
    kill() {
      onExit(0);
    },
  });
}

function ptyHandlers() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle(channel, fn) { handlers.set(channel, fn); } },
  };
}

function lifecycleSender(id = 1) {
  const listeners = new Map();
  let destroyed = false;
  const sent = [];
  const sender = {
    id,
    sent,
    isDestroyed: () => destroyed,
    send(channel, payload) {
      sent.push([channel, payload]);
    },
    on(eventName, fn) {
      listeners.set(eventName, fn);
      return sender;
    },
    once(eventName, fn) {
      listeners.set(eventName, fn);
      return sender;
    },
    fire(eventName) {
      listeners.get(eventName)?.();
    },
    destroy() {
      destroyed = true;
      this.fire('destroyed');
    },
  };
  return sender;
}

test('ptyCreate write echoes through onPtyData then ptyKill emits exit', async () => {
  const events = [];
  const pty = createPtyController({
    spawn: fakeSpawn(),
    emit(channel, payload) {
      events.push({ channel, payload });
    },
  });

  const created = await pty.create({ cwd: ws });
  assert.equal(typeof created.id, 'string');
  assert.ok(created.id.length > 0);

  await pty.write(created.id, 'echo');
  assert.deepEqual(
    events.filter((event) => event.channel === 'shell:pty-data'),
    [{ channel: 'shell:pty-data', payload: { id: created.id, data: 'echo', seq: 1 } }],
  );

  await pty.kill(created.id);
  assert.deepEqual(
    events.filter((event) => event.channel === 'shell:pty-exit'),
    [{ channel: 'shell:pty-exit', payload: { id: created.id, code: 0 } }],
  );
});

test('ptyCreate accepts a second authorized root and rejects an outsider', async () => {
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-extra-'));
  const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-out-'));
  setWorkspaceAuthority(createWorkspaceAuthority({
    workspace: ws,
    extraWorkspaces: [extra],
  }));
  try {
    const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
    const created = await pty.create({ cwd: extra });
    assert.equal(typeof created.id, 'string');
    await assert.rejects(() => pty.create({ cwd: outsider }), /cwd/);
  } finally {
    setWorkspaceAuthority(createWorkspaceAuthority({ workspace: ws }));
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});

test('ptyCreate rejects a missing project cwd', async () => {
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  await assert.rejects(() => pty.create({ cwd: '' }), /cwd/);
  await assert.rejects(() => pty.create({}), /cwd/);
});

test('PTY creation preflight checks sender and workspace authorization without spawning', () => {
  const { handlers, ipcMain } = ptyHandlers();
  const pty = createPtyController({
    spawn() { assert.fail('preflight must not spawn a PTY'); },
    emit() {},
  });
  const sender = { id: 7 };
  const denied = new Error('Unauthorized IPC sender');
  registerPtyIpc(ipcMain, pty, {
    authorize(event) {
      if (event.sender !== sender) throw denied;
    },
  });
  const canCreate = handlers.get('shell:pty-can-create');
  const event = { sender };
  assert.equal(canCreate(event, ws), true);
  assert.equal(canCreate(event, path.dirname(ws)), false);
  assert.equal(canCreate(event, path.join(ws, 'missing-project')), false);
  assert.equal(canCreate(event, ''), false);
  assert.equal(canCreate(event), false);
  assert.throws(() => canCreate({ sender: { id: 8 } }, ws), denied);
  assert.equal(pty.count(), 0);
});

test('Windows PTY spawn uses pwsh without the login banner', () => {
  if (process.platform !== 'win32') return;
  assert.equal(defaultShell(), 'pwsh.exe');
  assert.deepEqual(defaultShellArgs(), ['-NoLogo']);
});

test('createPtyController does not load node-pty until create', () => {
  assert.doesNotThrow(() => createPtyController({ emit() {} }));
});

test('registerPtyIpc succeeds when the PTY backend is unavailable', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  };
  const pty = createPtyController({ spawn: null, emit() {} });
  assert.doesNotThrow(() => registerPtyIpc(ipcMain, pty));
  assert.equal(typeof handlers.get('shell:pty-can-create'), 'function');
  assert.equal(typeof handlers.get('shell:pty-create'), 'function');
  assert.equal(typeof handlers.get('shell:pty-write'), 'function');
  assert.equal(typeof handlers.get('shell:pty-resize'), 'function');
  assert.equal(typeof handlers.get('shell:pty-kill'), 'function');
  await assert.rejects(
    () => pty.create({ cwd: ws }),
    { message: BACKEND_UNAVAILABLE },
  );
});

test('ptyCreate maps a throwing spawn factory to the stable unavailable result', async () => {
  const pty = createPtyController({
    spawn() {
      throw new Error('node-pty is not available');
    },
    emit() {},
  });
  await assert.rejects(
    () => pty.create({ cwd: ws }),
    { message: BACKEND_UNAVAILABLE },
  );
});

test('killAll tears down every session and clears the table', async () => {
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  const a = await pty.create({ cwd: ws });
  const b = await pty.create({ cwd: ws });
  pty.killAll();
  await assert.rejects(() => pty.write(a.id, 'x'), /unknown pty id/);
  await assert.rejects(() => pty.write(b.id, 'x'), /unknown pty id/);
});

test('registerPtyIpc returns the live controller for lifecycle wiring', () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  const returned = registerPtyIpc(ipcMain, pty);
  assert.equal(returned, pty);
});

test('PTY event observers receive output and can unsubscribe', async () => {
  const observed = [];
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  const unsubscribe = pty.onEvent((channel, payload) => {
    observed.push({ channel, payload });
  });
  const created = await pty.create({ cwd: ws });
  await pty.write(created.id, 'marker');
  unsubscribe();
  await pty.write(created.id, 'ignored');
  await pty.kill(created.id);

  assert.deepEqual(observed, [
    { channel: 'shell:pty-data', payload: { id: created.id, data: 'marker', seq: 1 } },
  ]);
});

test('Windows PTY spawn matches NodePtyAdapter (name, no useConpty, no TERM overwrite)', () => {
  const leftoverEnvKey = ['T', '3CODE_BAR'].join('');
  const options = ptySpawnOptions({ cwd: ws, cols: 100, rows: 30 }, 'win32', {
    TERM: 'from-host',
    PORT: '3080',
    ELECTRON_RUN_AS_NODE: '1',
    VITE_FOO: 'x',
    [leftoverEnvKey]: 'y',
    Path: 'C:\\Windows',
  });
  assert.equal(options.name, 'xterm-color');
  assert.equal('useConpty' in options, false);
  assert.equal('useConptyDll' in options, false);
  assert.equal(options.cols, 100);
  assert.equal(options.rows, 30);
  assert.equal(options.env.TERM, 'from-host');
  assert.equal('PORT' in options.env, false);
  assert.equal('ELECTRON_RUN_AS_NODE' in options.env, false);
  assert.equal('VITE_FOO' in options.env, false);
  assert.equal(leftoverEnvKey in options.env, false);
  assert.equal(options.env.Path, 'C:\\Windows');
  const unix = ptySpawnOptions({ cwd: ws, cols: 80, rows: 24 }, 'linux', { TERM: 'xterm' });
  assert.equal(unix.name, 'xterm-256color');
  assert.equal(unix.env.TERM, 'xterm');
  assert.equal('useConpty' in unix, false);
  const defaults = ptySpawnOptions({ cwd: ws }, 'win32', {});
  assert.equal(defaults.cols, 120);
  assert.equal(defaults.rows, 30);
  assert.equal('TERM' in defaults.env, false);
  const electronWin = ptySpawnOptions({ cwd: ws }, 'win32', { TERM: 'dumb', Path: 'C:\\Windows' });
  assert.equal('TERM' in electronWin.env, false);
});

test('createTerminalSpawnEnv copies overlay env and AppImage scrub', () => {
  const env = createTerminalSpawnEnv(
    {
      PATH: '/tmp/.mount_App/usr/bin:/usr/bin',
      APPIMAGE: '/tmp/App.AppImage',
      APPDIR: '/tmp/.mount_App',
      ARGV0: 'App',
      KEEP: 'yes',
    },
    { EXTRA: '1' },
  );
  assert.equal(env.KEEP, 'yes');
  assert.equal(env.EXTRA, '1');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal('APPIMAGE' in env, false);
  assert.equal('APPDIR' in env, false);
  assert.equal('ARGV0' in env, false);
});

test('terminal spawn env does not inject the desktop DSH_HOME', () => {
  const desktopHome = path.join(os.tmpdir(), 'desktop-dsh-home');
  setDesktopDshHome(desktopHome);
  try {
    const env = createTerminalSpawnEnv({ PATH: '/usr/bin', KEEP: 'yes' });
    assert.equal(env.KEEP, 'yes');
    assert.equal('DSH_HOME' in env, false);
  } finally {
    clearDesktopDshHome();
  }
});

test('resolveShellCandidates copies Windows and Unix lists', () => {
  const win = resolveShellCandidates(() => 'pwsh.exe', 'win32', {
    SystemRoot: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  });
  assert.deepEqual(win.map((candidate) => candidate.shell), [
    'pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'powershell.exe',
    'C:\\Windows\\System32\\cmd.exe',
    'cmd.exe',
  ]);
  assert.deepEqual(win[0].args, ['-NoLogo']);
  const unix = resolveShellCandidates(() => '/bin/zsh', 'linux', { SHELL: '/bin/zsh' });
  assert.deepEqual(unix.map((candidate) => candidate.shell), [
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
    'zsh',
    'bash',
    'sh',
  ]);
  assert.deepEqual(unix[0].args, ['-o', 'nopromptsp']);
});

test('a renderer reload or crash reaps the PTYs that sender created', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  registerPtyIpc(ipcMain, pty);
  function makeSender(id) {
    const listeners = new Map();
    return {
      sender: {
        id,
        isDestroyed: () => false,
        send() {},
        on(eventName, fn) { listeners.set(eventName, fn); },
        once(eventName, fn) { listeners.set(eventName, fn); },
      },
      fire(eventName) { listeners.get(eventName)(); },
    };
  }
  const harness = makeSender(1);
  const other = makeSender(2);
  const a = await handlers.get('shell:pty-create')({ sender: harness.sender }, { cwd: ws });
  const b = await handlers.get('shell:pty-create')({ sender: harness.sender }, { cwd: ws });
  const keep = await handlers.get('shell:pty-create')({ sender: other.sender }, { cwd: ws });
  harness.fire('did-navigate');
  await assert.rejects(() => pty.write(a.id, 'x'), /unknown pty id/);
  await assert.rejects(() => pty.write(b.id, 'x'), /unknown pty id/);
  // Another sender's sessions survive the reload.
  await pty.write(keep.id, 'still-alive');
  const c = await handlers.get('shell:pty-create')({ sender: other.sender }, { cwd: ws });
  other.fire('render-process-gone');
  await assert.rejects(() => pty.write(c.id, 'x'), /unknown pty id/);
  await assert.rejects(() => pty.write(keep.id, 'x'), /unknown pty id/);
});

test('a normally exited PTY does not linger in the reap table', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const killed = [];
  const controller = createPtyController({ spawn: fakeSpawn(), emit() {} });
  const originalKill = controller.kill.bind(controller);
  controller.kill = (id) => { killed.push(id); return originalKill(id); };
  registerPtyIpc(ipcMain, controller);
  const listeners = new Map();
  const sender = {
    id: 3,
    isDestroyed: () => false,
    send() {},
    on(eventName, fn) { listeners.set(eventName, fn); },
    once(eventName, fn) { listeners.set(eventName, fn); },
  };
  const created = await handlers.get('shell:pty-create')({ sender }, { cwd: ws });
  await controller.kill(created.id);
  killed.length = 0;
  listeners.get('did-navigate')();
  assert.deepEqual(killed, []);
});

test('registerPtyIpc authorizes every renderer request before dispatch', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let authorized = 0;
  const controller = {
    create() {},
    write() {},
    resize() {},
    kill() { return 'killed'; },
  };
  registerPtyIpc(ipcMain, controller, {
    authorize(event) {
      assert.equal(event.sender.id, 7);
      authorized += 1;
    },
  });
  const sender = { id: 7, once() {}, isDestroyed: () => false };
  assert.equal(await handlers.get('shell:pty-kill')({ sender }, 'missing'), 'killed');
  assert.equal(authorized, 1);
});

test('a PTY created after its renderer navigated is killed instead of becoming an orphan', async () => {
  const spawned = [];
  const pty = createPtyController({
    emit() {},
    spawn: fakeSpawn(),
  });
  const originalCreate = pty.create.bind(pty);
  pty.create = async (input) => {
    const created = await originalCreate(input);
    spawned.push({ id: created.id });
    return created;
  };
  const { handlers, ipcMain } = ptyHandlers();
  registerPtyIpc(ipcMain, pty);
  const sender = lifecycleSender(11);

  const creating = handlers.get('shell:pty-create')({ sender }, { cwd: ws });
  // The IPC handler is async: it has already spawned the PTY but has not yet
  // recorded ownership when this navigation/destruction callback runs.
  sender.destroy();
  await assert.rejects(creating, { code: 'ERR_DSH_IPC_SENDER' });
  await assert.rejects(() => pty.write(spawned[0].id, 'x'), /unknown pty id/);
});

test('a PTY created after its renderer navigated away is killed instead of becoming an orphan', async () => {
  const spawned = [];
  const pty = createPtyController({ emit() {}, spawn: fakeSpawn() });
  const originalCreate = pty.create.bind(pty);
  pty.create = async (input) => {
    const created = await originalCreate(input);
    spawned.push({ id: created.id });
    return created;
  };
  const { handlers, ipcMain } = ptyHandlers();
  registerPtyIpc(ipcMain, pty);
  // Cross-document navigation keeps the webContents object alive; only the
  // renderer context that owned the PTY is gone.
  const sender = lifecycleSender(12);
  const sending = { sender };

  const creating = handlers.get('shell:pty-create')(sending, { cwd: ws });
  sender.fire('did-navigate');
  await assert.rejects(creating, { code: 'ERR_DSH_IPC_SENDER' });
  assert.equal(spawned.length, 1);
  await assert.rejects(() => pty.write(spawned[0].id, 'x'), /unknown pty id/);
});

test('PTY output is routed only to the sender that created the PTY', async () => {
  const { handlers, ipcMain } = ptyHandlers();
  const sessions = new Map();
  const pty = createPtyController({
    emit() {},
    spawn({ onData, onExit }) {
      const session = {
        write(data) { onData(data); },
        resize() {},
        kill() { onExit(0); },
      };
      sessions.set(session, true);
      return session;
    },
  });
  registerPtyIpc(ipcMain, pty);
  const owner = lifecycleSender(21);
  const other = lifecycleSender(22);
  const created = await handlers.get('shell:pty-create')({ sender: owner }, { cwd: ws });

  await pty.write(created.id, 'owner-output');
  assert.deepEqual(owner.sent, [['shell:pty-data', { id: created.id, data: 'owner-output', seq: 1 }]]);
  assert.deepEqual(other.sent, []);
});

test('a non-owner renderer cannot write, resize, or kill another sender PTY', async () => {
  const { handlers, ipcMain } = ptyHandlers();
  const sessions = new Map();
  const pty = createPtyController({
    emit() {},
    spawn() {
      const session = { writes: [], resizes: [], kills: 0, write(data) { this.writes.push(data); }, resize(...args) { this.resizes.push(args); }, kill() { this.kills += 1; } };
      sessions.set(session, true);
      return session;
    },
  });
  registerPtyIpc(ipcMain, pty);
  const owner = lifecycleSender(31);
  const intruder = lifecycleSender(32);
  const created = await handlers.get('shell:pty-create')({ sender: owner }, { cwd: ws });
  const session = [...sessions.keys()][0];

  assert.throws(() => handlers.get('shell:pty-write')({ sender: intruder }, created.id, 'x'), /unknown pty id/);
  assert.throws(() => handlers.get('shell:pty-resize')({ sender: intruder }, created.id, 80, 24), /unknown pty id/);
  assert.throws(() => handlers.get('shell:pty-kill')({ sender: intruder }, created.id), /unknown pty id/);
  assert.deepEqual(session.writes, []);
  assert.deepEqual(session.resizes, []);
  assert.equal(session.kills, 0);
});

test('a destroyed sender is rejected before any PTY dispatch', async () => {
  const { handlers, ipcMain } = ptyHandlers();
  let dispatched = 0;
  const controller = {
    create() { dispatched += 1; return { ok: true, id: 'pty-1' }; },
    write() { dispatched += 1; },
    resize() { dispatched += 1; },
    kill() { dispatched += 1; return { ok: true }; },
  };
  registerPtyIpc(ipcMain, controller);
  const sender = lifecycleSender(41);
  sender.destroy();

  await assert.rejects(() => handlers.get('shell:pty-create')({ sender }, { cwd: ws }), { code: 'ERR_DSH_IPC_SENDER' });
  assert.throws(() => handlers.get('shell:pty-write')({ sender }, 'pty-1', 'x'), { code: 'ERR_DSH_IPC_SENDER' });
  assert.throws(() => handlers.get('shell:pty-resize')({ sender }, 'pty-1', 80, 24), { code: 'ERR_DSH_IPC_SENDER' });
  assert.throws(() => handlers.get('shell:pty-kill')({ sender }, 'pty-1'), { code: 'ERR_DSH_IPC_SENDER' });
  assert.equal(dispatched, 0);
});

test('PTY create and resize normalize malformed dimensions before touching the backend', async () => {
  const sessions = [];
  const pty = createPtyController({
    emit() {},
    spawn(input) {
      const session = {
        input,
        write() {},
        resize(cols, rows) { this.last = [cols, rows]; },
        kill() {},
      };
      sessions.push(session);
      return session;
    },
  });
  await pty.create({ cwd: ws, cols: Number.NaN, rows: Number.POSITIVE_INFINITY });
  assert.deepEqual(
    [sessions.at(-1).input.cols, sessions.at(-1).input.rows],
    [DEFAULT_OPEN_COLS, DEFAULT_OPEN_ROWS],
  );
  const created = await pty.create({ cwd: ws, cols: 0, rows: -3 });
  const session = sessions.at(-1);
  assert.deepEqual([session.input.cols, session.input.rows], [1, 1]);
  await pty.resize(created.id, 99999.9, 0);
  assert.deepEqual(session.last, [1000, 1]);
  await pty.resize(created.id, Number.NaN, Number.POSITIVE_INFINITY);
  assert.deepEqual(session.last, [DEFAULT_OPEN_COLS, DEFAULT_OPEN_ROWS]);
});

test('write, resize, and repeated teardown after kill are bounded no-ops', async () => {
  const pty = createPtyController({ emit() {}, spawn: fakeSpawn() });
  const created = await pty.create({ cwd: ws, cols: 80, rows: 24 });
  await pty.kill(created.id);
  await pty.kill(created.id);
  await assert.rejects(() => pty.write(created.id, 'x'), /unknown pty id/);
  await assert.rejects(() => pty.resize(created.id, 100, 30), /unknown pty id/);
  await pty.killAll();
  await pty.killAll();
});

/** Emit `count` small chunks from one backend PTY and record what was published. */
async function burstEvents(count, chunk = 'x') {
  const events = [];
  let emitData = null;
  const pty = createPtyController({
    coalesceMs: 5,
    emit(channel, payload) {
      events.push({ channel, payload });
    },
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      return { write() {}, resize() {}, kill() { onExit(0); } };
    },
  });
  const created = await pty.create({ cwd: ws });
  for (let i = 0; i < count; i += 1) emitData(chunk);
  return { pty, id: created.id, events, dataEvents: () => events.filter((event) => event.channel === 'shell:pty-data') };
}

test('a dense PTY burst is coalesced before it reaches the renderer', async () => {
  const { pty, id, dataEvents } = await burstEvents(200);
  // The first chunk after an idle terminal goes out at once; the rest of the
  // burst waits for the window instead of crossing IPC chunk by chunk.
  assert.equal(dataEvents().length, 1);
  assert.equal(dataEvents()[0].payload.data, 'x');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const published = dataEvents();
  assert.equal(published.length, 2, JSON.stringify(published.map((event) => event.payload.data.length)));
  assert.equal(published[1].payload.data.length, 199);
  assert.equal(published.every((event) => event.payload.id === id), true);
  await pty.killAll();
});

test('coalesced PTY output preserves byte order and total content', async () => {
  const events = [];
  let emitData = null;
  const pty = createPtyController({
    coalesceMs: 5,
    emit(channel, payload) {
      events.push({ channel, payload });
    },
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      return { write() {}, resize() {}, kill() { onExit(0); } };
    },
  });
  await pty.create({ cwd: ws });
  const chunks = Array.from({ length: 50 }, (_, i) => `chunk-${i};`);
  for (const chunk of chunks) emitData(chunk);
  await pty.killAll();
  const joined = events
    .filter((event) => event.channel === 'shell:pty-data')
    .map((event) => event.payload.data)
    .join('');
  assert.equal(joined, chunks.join(''));
});

test('the byte ceiling flushes a burst mid-window', async () => {
  const { pty, dataEvents } = await burstEvents(10, 'y'.repeat(4096));
  // 4096-byte chunks: the first is immediate, the following eight cross the
  // 32 KiB ceiling before the timer fires.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const published = dataEvents();
  assert.ok(published.length >= 2, JSON.stringify(published.map((event) => event.payload.data.length)));
  const joined = published.map((event) => event.payload.data);
  assert.equal(joined.join('').length, 10 * 4096);
  assert.equal(joined[0].length, 4096);
  await pty.killAll();
});

test('exit flushes buffered tail output before the exit event', async () => {
  const events = [];
  let emitData = null;
  let emitExit = null;
  const pty = createPtyController({
    coalesceMs: 5_000,
    emit(channel, payload) {
      events.push({ channel, payload });
    },
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      emitExit = (code) => onExit(code);
      return { write() {}, resize() {}, kill() {} };
    },
  });
  const created = await pty.create({ cwd: ws });
  emitData('head');
  emitData('tail');
  emitExit(0);
  const channels = events.map((event) => event.channel);
  assert.deepEqual(channels, ['shell:pty-data', 'shell:pty-data', 'shell:pty-exit']);
  assert.equal(events[1].payload.data, 'tail');
  assert.equal(events[2].payload.code, 0);
  assert.equal(events.every((event) => event.payload.id === created.id), true);
  await pty.killAll();
});

/**
 * Emit `count` chunks of `size` bytes each, recording the pause/resume calls
 * the controller makes on the backend and the frames it publishes.
 */
async function backpressureHarness(count, size, options = {}) {
  const frames = [];
  const flow = [];
  let emitData = null;
  const pty = createPtyController({
    coalesceMs: 0,
    coalesceBytes: 8 * 1024,
    highWaterBytes: options.highWaterBytes ?? 16 * 1024,
    lowWaterBytes: options.lowWaterBytes ?? 4 * 1024,
    emit(channel, payload) {
      if (channel === 'shell:pty-data') frames.push(payload);
    },
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      return {
        write() {},
        resize() {},
        pause() { flow.push('pause'); },
        resume() { flow.push('resume'); },
        kill() { onExit(0); },
      };
    },
  });
  const created = await pty.create({ cwd: ws });
  for (let index = 0; index < count; index += 1) emitData('x'.repeat(size));
  return { pty, id: created.id, frames, flow, emitData };
}

test('a backlog above the high-water mark pauses the backend, and an ACK resumes it', async () => {
  const { pty, id, frames, flow } = await backpressureHarness(6, 4096);
  // 6 x 4 KiB published, nothing acknowledged: the unacknowledged backlog
  // crosses 16 KiB and the controller must stop the producer.
  assert.deepEqual(flow, ['pause']);
  const last = frames.at(-1);
  assert.ok(last !== undefined && typeof last.seq === 'number', JSON.stringify(last));
  // Acknowledging everything releases the producer once the backlog falls to
  // the low mark.
  pty.acknowledge(id, last.seq);
  assert.deepEqual(flow, ['pause', 'resume']);
  await pty.killAll();
});

test('backpressure never drops or reorders a byte', async () => {
  const { pty, id, frames } = await backpressureHarness(5, 4096);
  pty.acknowledge(id, frames.at(-1).seq);
  const joined = frames.map((frame) => frame.data).join('');
  assert.equal(joined.length, 5 * 4096);
  assert.equal(joined, 'x'.repeat(5 * 4096));
  // Sequences are strictly increasing by one, so the renderer can detect a gap.
  assert.deepEqual(frames.map((frame) => frame.seq), [1, 2, 3, 4, 5]);
  await pty.killAll();
});

test('an acknowledgement only releases the bytes it covers', async () => {
  const { pty, id, frames, flow } = await backpressureHarness(6, 4096);
  assert.deepEqual(flow, ['pause']);
  // One frame of 4 KiB brings the 24 KiB backlog to 20 KiB: still above the
  // 4 KiB low mark, so the producer stays paused.
  pty.acknowledge(id, frames[0].seq);
  assert.deepEqual(flow, ['pause']);
  pty.acknowledge(id, frames[4].seq);
  assert.deepEqual(flow, ['pause', 'resume']);
  await pty.killAll();
});

test('stale, unknown, and regressing acknowledgements are bounded no-ops', async () => {
  const { pty, id, frames, flow } = await backpressureHarness(6, 4096);
  pty.acknowledge(id, frames.at(-1).seq);
  const settled = [...flow];
  // Replaying an older sequence, a non-numeric sequence, and an id that never
  // existed must not throw or resume anything a second time.
  pty.acknowledge(id, 1);
  pty.acknowledge(id, Number.NaN);
  pty.acknowledge(id, -5);
  pty.acknowledge('pty-missing', 9);
  assert.deepEqual(flow, settled);
  await pty.killAll();
});

test('a burst below the high-water mark never pauses the backend', async () => {
  const { pty, id, frames, flow } = await backpressureHarness(2, 1024);
  assert.deepEqual(flow, []);
  pty.acknowledge(id, frames.at(-1).seq);
  assert.deepEqual(flow, []);
  await pty.killAll();
});

test('the PTY IPC registers an ACK handler that requires ownership', async () => {
  const { handlers, ipcMain } = ptyHandlers();
  const pty = createPtyController({
    coalesceMs: 0,
    coalesceBytes: 8 * 1024,
    highWaterBytes: 16 * 1024,
    lowWaterBytes: 4 * 1024,
    emit() {},
    spawn({ onData, onExit }) {
      return {
        write(data) { onData(data); },
        resize() {},
        pause() {},
        resume() {},
        kill() { onExit(0); },
      };
    },
  });
  registerPtyIpc(ipcMain, pty);
  const owner = lifecycleSender(31);
  const other = lifecycleSender(32);
  const created = await handlers.get('shell:pty-create')({ sender: owner }, { cwd: ws });
  await handlers.get('shell:pty-write')({ sender: owner }, created.id, 'x');
  assert.doesNotThrow(() => handlers.get('shell:pty-ack')({ sender: owner }, created.id, 1));
  assert.throws(() => handlers.get('shell:pty-ack')({ sender: other }, created.id, 1), /unknown pty id/);
  const destroyed = lifecycleSender(33);
  destroyed.destroy();
  assert.throws(
    () => handlers.get('shell:pty-ack')({ sender: destroyed }, created.id, 1),
    { code: 'ERR_DSH_IPC_SENDER' },
  );
});

test('kill retires flow state so a late acknowledgement cannot resume a dead PTY', async () => {
  const { pty, id, frames, flow } = await backpressureHarness(6, 4096);
  assert.deepEqual(flow, ['pause']);
  await pty.kill(id);
  pty.acknowledge(id, frames.at(-1).seq);
  assert.deepEqual(flow, ['pause']);
});

test('an interactive shell that types once pays no coalescing delay', async () => {
  const events = [];
  let emitData = null;
  const pty = createPtyController({
    coalesceMs: 5_000,
    emit(channel, payload) {
      events.push({ channel, payload });
    },
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      return { write() {}, resize() {}, kill() { onExit(0); } };
    },
  });
  await pty.create({ cwd: ws });
  emitData('prompt> ');
  assert.deepEqual(events.map((event) => event.payload.data), ['prompt> ']);
  await pty.killAll();
});

/**
 * The published acceptance gate for output coalescing: 10,000 one-kilobyte
 * backend chunks must reach the renderer in at most 20% of the messages they
 * used to, and the concatenated stream must still match byte for byte.
 */
test('a 10k x 1 KiB burst publishes at most a fifth of the backend chunks', async () => {
  const events = [];
  let emitData = null;
  const pty = createPtyController({
    coalesceMs: 8,
    emit(channel, payload) {
      if (channel === 'shell:pty-data') events.push(payload);
    },
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      return { write() {}, resize() {}, kill() { onExit(0); } };
    },
  });
  await pty.create({ cwd: ws });

  const chunk = 'a'.repeat(1024);
  const total = 10_000;
  for (let i = 0; i < total; i += 1) {
    emitData(chunk);
    // Yield like a real backend does, so timer flushes can run inside the
    // burst instead of collapsing the whole stream into one message.
    if (i % 500 === 499) await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(events.map((event) => event.data).join(''), chunk.repeat(total));
  assert.ok(
    events.length <= total / 5,
    `expected <= ${total / 5} data messages, saw ${events.length}`,
  );
  await pty.killAll();
});

test('coalesced payloads respect the 32 KiB ceiling', async () => {
  const events = [];
  let emitData = null;
  const pty = createPtyController({
    coalesceMs: 8,
    emit(channel, payload) {
      if (channel === 'shell:pty-data') events.push(payload.data);
    },
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      return { write() {}, resize() {}, kill() { onExit(0); } };
    },
  });
  await pty.create({ cwd: ws });
  const chunk = 'b'.repeat(4096);
  for (let i = 0; i < 40; i += 1) emitData(chunk);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.join('').length, 40 * 4096);
  // The first chunk is published alone; no batched payload may exceed the
  // ceiling (a single backend chunk larger than it still passes through).
  assert.equal(events.slice(1).every((data) => Buffer.byteLength(data, 'utf8') <= 32 * 1024), true);
  await pty.killAll();
});

/** Collect every published data frame for one synthetic PTY burst. */
async function collectFrames(chunks, options = {}) {
  const frames = [];
  let emitData = null;
  const pty = createPtyController({
    coalesceMs: options.coalesceMs ?? 8,
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      return { write() {}, resize() {}, kill() { onExit(0); } };
    },
    emit(channel, payload) {
      if (channel === 'shell:pty-data') frames.push(payload.data);
    },
  });
  await pty.create({ cwd: ws });
  for (const chunk of chunks) emitData(chunk);
  await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? 20));
  return { pty, frames };
}

test('two individually small chunks never join past the ceiling', async () => {
  // 20 KiB + 20 KiB: each chunk is under the 32 KiB ceiling, so a
  // post-append check would publish a 40 KiB frame.
  const first = 'p'.repeat(20 * 1024);
  const second = 'q'.repeat(20 * 1024);
  const { pty, frames } = await collectFrames([first, second]);
  assert.equal(frames.join(''), first + second);
  assert.equal(frames.every((data) => Buffer.byteLength(data, 'utf8') <= 32 * 1024), true);
  await pty.killAll();
});

test('non-divisible chunk sizes stay within the ceiling and keep order', async () => {
  const chunks = Array.from({ length: 37 }, (_, i) => String.fromCharCode(97 + (i % 26)).repeat(1000 + i));
  const { pty, frames } = await collectFrames(chunks);
  assert.equal(frames.join(''), chunks.join(''));
  assert.equal(frames.every((data) => Buffer.byteLength(data, 'utf8') <= 32 * 1024), true);
  await pty.killAll();
});

test('multi-byte text is never split inside a code point', async () => {
  // 4-byte emoji plus 3-byte CJK: a byte-based slice would corrupt these.
  const chunks = Array.from({ length: 80 }, () => '终端输出😀'.repeat(600));
  const { pty, frames } = await collectFrames(chunks);
  assert.equal(frames.join(''), chunks.join(''));
  assert.equal(frames.every((data) => Buffer.byteLength(data, 'utf8') <= 32 * 1024), true);
  assert.equal(frames.join('').includes('\uFFFD'), false);
  await pty.killAll();
});

test('a single backend chunk larger than the ceiling is split, not dropped', async () => {
  const giant = 'z'.repeat(100 * 1024);
  const { pty, frames } = await collectFrames([giant]);
  assert.equal(frames.join(''), giant);
  assert.ok(frames.length > 1, `expected the oversized chunk to be split, saw ${frames.length} frame(s)`);
  assert.equal(frames.every((data) => Buffer.byteLength(data, 'utf8') <= 32 * 1024), true);
  await pty.killAll();
});

test('exit flushes the tail even when the tail crosses the ceiling', async () => {
  const frames = [];
  let emitData = null;
  let emitExit = null;
  const pty = createPtyController({
    coalesceMs: 5_000,
    emit(channel, payload) {
      if (channel === 'shell:pty-data') frames.push(payload.data);
    },
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      emitExit = (code) => onExit(code);
      return { write() {}, resize() {}, kill() {} };
    },
  });
  await pty.create({ cwd: ws });
  emitData('head');
  emitData('t'.repeat(20 * 1024));
  emitData('u'.repeat(20 * 1024));
  emitExit(0);
  assert.equal(frames.join(''), `head${'t'.repeat(20 * 1024)}${'u'.repeat(20 * 1024)}`);
  assert.equal(frames.every((data) => Buffer.byteLength(data, 'utf8') <= 32 * 1024), true);
  await pty.killAll();
});

test('a late backend callback after exit cannot resurrect batching state', async () => {
  const frames = [];
  let emitData = null;
  let emitExit = null;
  const pty = createPtyController({
    coalesceMs: 5,
    emit(channel, payload) {
      if (channel === 'shell:pty-data') frames.push(payload.data);
    },
    spawn({ onData, onExit }) {
      emitData = (text) => onData(text);
      emitExit = (code) => onExit(code);
      return { write() {}, resize() {}, kill() {} };
    },
  });
  await pty.create({ cwd: ws });
  emitData('live');
  emitExit(0);
  const afterExit = frames.slice();
  emitData('late');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(frames, afterExit, 'late output must not be published after exit');
  await pty.killAll();
});

test('output arriving after kill is dropped without recreating state', async () => {
  const frames = [];
  let emitData = null;
  const pty = createPtyController({
    coalesceMs: 5,
    emit(channel, payload) {
      if (channel === 'shell:pty-data') frames.push(payload.data);
    },
    spawn({ onData }) {
      emitData = (text) => onData(text);
      return { write() {}, resize() {}, kill() {} };
    },
  });
  const created = await pty.create({ cwd: ws });
  emitData('before');
  await pty.kill(created.id);
  const beforeLate = frames.length;
  emitData('after');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(frames.length, beforeLate);
  await pty.killAll();
});
