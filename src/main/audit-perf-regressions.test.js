'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { readMagpieUsage } = require('./pet-growth');
const { createPetProtocolHandler, createLive2dPetManager } = require('./desktop-live2d');
const { createDshWatch } = require('./pet-dsh-watch');

test('readMagpieUsage reuses unchanged cache and incrementally tails appended lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-magpie-cache-'));
  const file = path.join(dir, 'usage.jsonl');
  const now = Date.parse('2026-11-27T08:00:00Z');
  const cache = new Map();
  try {
    const row1 = JSON.stringify({ agent: 'dsh', in: 100, out: 50, t: '2026-11-27T07:00:00Z', route_id: 'r1', session: 's1' });
    fs.writeFileSync(file, `${row1}\n`, 'utf8');
    const first = readMagpieUsage(file, { now, cache });
    assert.equal(first.total, 150);
    assert.equal(first.calls, 1);

    // Second call with unchanged file must hit cache without calling readFileSync
    const origReadFile = fs.readFileSync;
    let fullReads = 0;
    fs.readFileSync = (...args) => { fullReads += 1; return origReadFile(...args); };
    try {
      const second = readMagpieUsage(file, { now, cache });
      assert.equal(second.total, 150);
      assert.equal(fullReads, 0);

      // Appending a new row uses incremental range read, not readFileSync
      const row2 = JSON.stringify({ agent: 'dsh', in: 200, out: 100, t: '2026-11-27T07:30:00Z', route_id: 'r2', session: 's2' });
      fs.appendFileSync(file, `${row2}\n`, 'utf8');
      const third = readMagpieUsage(file, { now, cache });
      assert.equal(third.total, 450);
      assert.equal(third.calls, 2);
      assert.equal(third.sessions, 2);
      assert.equal(fullReads, 0);
    } finally {
      fs.readFileSync = origReadFile;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pet:// protocol rejects non-pet hostnames and non-pet renderer files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pet-proto-'));
  try {
    fs.writeFileSync(path.join(dir, 'pet-live2d.html'), '<h1>pet</h1>');
    fs.writeFileSync(path.join(dir, 'launcher.html'), '<h1>launcher</h1>');
    const handler = createPetProtocolHandler((name) => path.join(dir, name));
    assert.equal((await handler({ url: 'pet://pet/pet-live2d.html' })).status, 200);
    assert.equal((await handler({ url: 'pet://evil/pet-live2d.html' })).status, 404);
    assert.equal((await handler({ url: 'pet://pet/launcher.html' })).status, 404);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createLive2dPetManager skips dshWatch when disabled and pauses/resumes on powerMonitor events', async (t) => {
  const timers = [];
  t.mock.method(global, 'setInterval', (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; });
  t.mock.method(global, 'clearInterval', () => {});
  const powerMonitor = new EventEmitter();
  const sends = [];
  const win = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), {
      send: (ch, payload) => sends.push([ch, payload]),
      setWindowOpenHandler() {},
      mainFrame: { url: 'pet://pet/pet-live2d.html' },
    }),
    isDestroyed: () => false,
    isVisible: () => true,
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
    setBounds() {},
    setAlwaysOnTop() {},
    setVisibleOnAllWorkspaces() {},
    setIgnoreMouseEvents() {},
    showInactive() {},
    close() {},
    destroy() {},
    loadURL: async () => {},
  });
  const BrowserWindow = function () { return win; };
  const electron = {
    BrowserWindow,
    screen: {
      getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 720 } }),
      getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1280, height: 720 } }],
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    },
    ipcMain: { handle() {}, removeHandler() {} },
    protocol: { handle() {}, unhandle() {} },
    powerMonitor,
  };
  let cfg = { live2dPet: { enabled: false } };
  const mgr = createLive2dPetManager({
    electron,
    sessionsDir: os.tmpdir(),
    loadConfig: () => cfg,
    saveConfig: (patch) => { cfg = { ...cfg, ...patch }; },
    scanTokens: async () => ({ total: 0, sessions: 0 }),
  });
  t.after(() => mgr.dispose());
  assert.equal(timers.some((x) => x.ms === 2000), false, 'disabled pet must not start 2s dshWatch');
  mgr.setEnabled(true);
  assert.equal(timers.some((x) => x.ms === 2000), true, 'enabled pet starts dshWatch');
  powerMonitor.emit('lock-screen');
  assert.ok(sends.some(([ch, p]) => ch === 'shell:live2d-power' && p.paused === true));
  powerMonitor.emit('unlock-screen');
  assert.ok(sends.some(([ch, p]) => ch === 'shell:live2d-power' && p.paused === false));
});

test('createDshWatch prunes removed sessions and day rollover from usageSeen without throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-watch-prune-'));
  try {
    let saved = {};
    let currentTime = Date.parse('2026-11-27T10:00:00Z');
    const watch = createDshWatch({
      sessionsDir: dir,
      getDsh: () => saved,
      saveDsh: (next) => { saved = next; },
      now: () => currentTime,
    });
    watch.poll();
    currentTime = Date.parse('2026-11-28T10:00:00Z');
    watch.poll();
    assert.equal(saved.day, '2026-11-28');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
