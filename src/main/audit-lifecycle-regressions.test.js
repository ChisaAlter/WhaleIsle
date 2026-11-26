'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sameProcessStartTime, windowsProcessStartTime, readProcessStartTimeSync } = require('../shared/process-tree');
const { collectInternalSecrets } = require('../shared/secret');
const { DshManager } = require('./dsh');
const { parseUnifiedDiff, unquoteGitPath } = require('./git-diff');
const { createPtyController, setWorkspaceAuthority: setPtyAuthority } = require('./pty');
const { createPreviewController } = require('./preview-controller');
const { HarnessController } = require('./harness-controller');
const importGuard = require('./import-guard');
const { createUpdateCenter } = require('./update-center/service');

test('sameProcessStartTime equates winft: FILETIME and ISO-8601 representations of the same process', () => {
  if (process.platform === 'win32') {
    const iso = windowsProcessStartTime(process.pid);
    const { windowsProcessStartTime: dshWinStart } = require('./dsh-win-process');
    return dshWinStart(process.pid, null, null, async () => '').then((winft) => {
      assert.match(winft, /^winft:\d+$/);
      assert.equal(sameProcessStartTime(iso, winft), true);
      assert.equal(sameProcessStartTime(winft, iso), true);
    });
  }
  const token = readProcessStartTimeSync(process.pid);
  assert.ok(token.length > 0);
  // 2026-11-26T16:49:35.4904135Z in Windows 100ns FILETIME ticks
  assert.equal(sameProcessStartTime('2026-11-26T16:49:35.4904135Z', 'winft:134401853754904135'), true);
});

test('DshManager._doStop refuses to kill a live pid-file process when startTime mismatches', async () => {
  let killed = 0;
  let cleared = 0;
  const manager = new DshManager({
    readPidFile: () => ({ pid: process.pid, port: 3080, startTime: '2020-01-01T00:00:00.0000000Z' }),
    processStartTime: async () => '2026-11-26T16:49:35.4904135Z',
    killTree: async () => { killed += 1; return true; },
    clearPidFile: () => { cleared += 1; },
  });
  await manager.stop();
  assert.equal(killed, 0);
  assert.equal(cleared, 1);
});

test('collectInternalSecrets settles on timeout when end marker never arrives', async () => {
  const stream = new PassThrough();
  const secrets = await collectInternalSecrets(stream, { timeoutMs: 40 });
  assert.equal(secrets.get('MISSING'), undefined);
});

test('unquoteGitPath and parseUnifiedDiff decode UTF-8 octal C-quoted Chinese paths', () => {
  assert.equal(unquoteGitPath('"\\344\\270\\255\\346\\226\\207/\\350\\257\\264\\346\\230\\216 \\346\\226\\207\\346\\241\\243.md"'), '中文/说明 文档.md');
  const diff = [
    'diff --git "a/\\344\\270\\255\\346\\226\\207.txt" "b/\\344\\270\\255\\346\\226\\207.txt"',
    '--- "a/\\344\\270\\255\\346\\226\\207.txt"',
    '+++ "b/\\344\\270\\255\\346\\226\\207.txt"',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  const parsed = parseUnifiedDiff(diff);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].path, '中文.txt');
});

test('pty.kill deletes session even if backend throws and killAll retires silent sessions', async () => {
  const emitted = [];
  let dataHandler = null;
  setPtyAuthority({ resolveAuthorizedCwd: (cwd) => cwd });
  try {
    const ctrl = createPtyController({
      emit: (channel, payload) => emitted.push({ channel, payload }),
      spawn() {
        return {
          onData(fn) { dataHandler = fn; },
          onExit() {},
          write() {},
          resize() {},
          async kill() { throw new Error('already closed'); },
        };
      },
    });
    const s1 = await ctrl.create({ cwd: process.cwd() });
    assert.equal(ctrl.count(), 1);
    await assert.rejects(() => ctrl.kill(s1.id), /already closed/);
    assert.equal(ctrl.count(), 0);

    const s2 = await ctrl.create({ cwd: process.cwd() });
    await ctrl.killAll();
    dataHandler?.('late output after killAll');
    assert.equal(emitted.filter((e) => e.channel === 'shell:pty-data' && e.payload?.id === s2.id).length, 0);
  } finally {
    setPtyAuthority(null);
  }
});

test('preview pickElement survives subframe navigation and cancels on closeAll', async () => {
  const wc = new EventEmitter();
  wc.ipc = new EventEmitter();
  wc.loadURL = async () => {};
  wc.close = () => {};
  wc.send = () => {};
  wc.getURL = () => 'http://127.0.0.1:3000/';
  const controller = createPreviewController({
    attach: () => ({
      partition: 'p',
      webContents: wc,
      setBounds() {},
      setVisible() {},
      destroy() {},
    }),
  });
  const opened = await controller.open({ url: 'http://127.0.0.1:3000/' });
  const pick1 = controller.pickElement(opened.id);
  wc.emit('did-start-navigation', {}, 'http://127.0.0.1:3000/iframe', false, false);
  let settledAfterIframe = false;
  void pick1.then(() => { settledAfterIframe = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(settledAfterIframe, false);
  wc.emit('did-start-navigation', {}, 'http://127.0.0.1:3000/next', false, true);
  assert.equal((await pick1).message, 'cancelled');

  const pick2 = controller.pickElement(opened.id);
  await controller.closeAll();
  assert.equal((await pick2).message, 'cancelled');
  assert.equal((await controller.setColorScheme(opened.id, 'bogus')).ok, false);
});

test('HarnessController.runAutomaticRestart defers when maintenance lock is held', async () => {
  let started = 0;
  const dsh = Object.assign(new EventEmitter(), {
    state: 'error',
    logs: [],
    snapshot: () => ({ state: 'error', error: 'crashed', logs: [] }),
    log() {},
    start: async () => { started += 1; return 'http://127.0.0.1:3080'; },
    stop: async () => {},
  });
  const controller = new HarnessController({ dsh, loadConfig: () => ({}), sendToBoot: () => {} });
  controller.recovery = { status: 'scheduled', attempt: 1, nextRetryAt: Date.now(), reason: '' };
  const token = importGuard.acquireMaintenance('test-hold');
  try {
    await controller.runAutomaticRestart(1);
    assert.equal(started, 0);
    assert.equal(controller.recovery.status, 'failed');
  } finally {
    importGuard.releaseMaintenance(token);
  }
});

test('UpdateCenter.installVersion rejects release without checksumUrl', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-uc-'));
  try {
    const uc = createUpdateCenter({
      userDataDir: dir,
      currentVersion: () => '0.3.16',
      routes: [{ id: 'github', label: 'GitHub' }],
      getRoute: () => 'github',
      compareVersions: () => 1,
      resolveRelease: async () => ({
        version: '0.3.17',
        tag: 'v0.3.17',
        assetName: 'a.exe',
        assetUrl: 'https://example.com/a.exe',
        assetSize: 100,
      }),
    });
    const snap = await uc.command('installVersion', 'v0.3.17');
    assert.equal(snap.phase, 'error');
    assert.match(snap.error?.message || '', /校验文件/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
