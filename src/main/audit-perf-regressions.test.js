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

      // Appending a UTF-8 multibyte row split mid-character must not corrupt session/sampleKey
      const row2 = JSON.stringify({ agent: 'dsh', in: 200, out: 100, t: '2026-11-27T07:30:00Z', session: '中文会话' }) + '\n';
      const bytes = Buffer.from(row2, 'utf8');
      const midChar = bytes.indexOf(0xe4) + 1;
      fs.appendFileSync(file, bytes.subarray(0, midChar));
      readMagpieUsage(file, { now, cache });
      fs.appendFileSync(file, bytes.subarray(midChar));
      const third = readMagpieUsage(file, { now, cache });
      assert.equal(fullReads, 0);
      const fresh = readMagpieUsage(file, { now });
      assert.deepEqual(third, fresh);

      // Same-inode overwrite with larger content must invalidate via prefix digest
      const rewritten = JSON.stringify({ agent: 'dsh', in: 900, out: 200, t: '2026-11-27T07:45:00Z', route_id: 'rw', session: 's9' }) + '\n'
        + ' '.repeat(512) + '\n';
      fs.writeFileSync(file, rewritten, 'utf8');
      const afterRewrite = readMagpieUsage(file, { now, cache });
      assert.equal(afterRewrite.total, 1100);
    } finally {
      fs.readFileSync = origReadFile;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pet:// protocol serves every real pet-live2d.html asset and blocks backslash traversal', async () => {
  const rendererRoot = path.resolve(__dirname, '../renderer');
  const html = fs.readFileSync(path.join(rendererRoot, 'pet-live2d.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1].replace(/^\/+/, ''));
  refs.push('dialogue/whale.json');
  const handler = createPetProtocolHandler((name) => path.join(rendererRoot, name));
  for (const rel of refs) {
    const res = await handler({ url: `pet://pet/${rel}` });
    assert.equal(res.status, 200, `expected 200 for pet://pet/${rel}`);
  }
  assert.equal((await handler({ url: 'pet://evil/pet-live2d.html' })).status, 404);
  assert.equal((await handler({ url: 'pet://pet/launcher.html' })).status, 404);
  assert.equal((await handler({ url: 'pet://pet/pet-live2d/..%5clauncher.html' })).status, 404);
  assert.equal((await handler({ url: 'pet://pet/pet-live2d/..\\launcher.html' })).status, 404);
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
