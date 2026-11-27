'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { formatBootLogDump, saveBootLog } = require('./boot-log-dump');

function sampleLogs() {
  return Array.from({ length: 81 }, (_, index) => `[app] line ${index + 1}`);
}

test('formatBootLogDump writes version, failure, and the full log ring', () => {
  const logs = sampleLogs();
  const text = formatBootLogDump({
    version: '0.2.3',
    savedAt: '2026-08-20T00:00:00.000Z',
    snapshot: {
      state: 'error',
      error: 'Harness 启动失败',
      failure: {
        phase: 'startup',
        message: '准备运行时失败：tar 退出码 1',
        code: 1,
        signal: null,
        occurredAt: '2026-08-20T00:00:00.000Z',
      },
      recovery: { status: 'exhausted', attempt: 3, maxAttempts: 3 },
      pluginRecovery: { skipUserPlugins: true },
    },
    logs,
  });

  assert.match(text, /^WhaleIsle 0\.2\.3\n/);
  assert.match(text, /^savedAt: 2026-08-20T00:00:00\.000Z$/m);
  assert.match(text, /^state: error$/m);
  assert.match(text, /^error: Harness 启动失败$/m);
  assert.match(text, /^failure\.phase: startup$/m);
  assert.match(text, /^failure\.message: 准备运行时失败：tar 退出码 1$/m);
  assert.match(text, /^failure\.code: 1$/m);
  assert.match(text, /^failure\.signal: -$/m);
  assert.match(text, /^failure\.occurredAt: 2026-08-20T00:00:00\.000Z$/m);
  assert.match(text, /^recovery\.status: exhausted$/m);
  assert.match(text, /^recovery\.attempt: 3$/m);
  assert.match(text, /^recovery\.maxAttempts: 3$/m);
  assert.match(text, /^pluginRecovery\.skipUserPlugins: true$/m);
  assert.match(text, /\n--- logs ---\n/);
  assert.match(text, /\[app\] line 1\n/);
  assert.match(text, /\[app\] line 81\n?$/);
  assert.doesNotMatch(text, /githubToken|secret-token/);
});

test('formatBootLogDump keeps the header and log marker when logs are empty', () => {
  const text = formatBootLogDump({
    version: '1.0.0',
    savedAt: '2026-08-20T00:00:00.000Z',
    snapshot: { state: 'error' },
    logs: [],
  });
  assert.match(text, /^WhaleIsle 1\.0\.0\n/);
  assert.match(text, /^failure\.phase: -$/m);
  assert.match(text, /\n--- logs ---\n$/);
  assert.doesNotMatch(text, /^recovery\./m);
  assert.doesNotMatch(text, /^pluginRecovery\./m);
});

test('saveBootLog skips write when the dialog is canceled', async () => {
  const writes = [];
  const result = await saveBootLog({
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    dump: 'body',
    writeFile: async (filePath, body) => { writes.push({ filePath, body }); },
    defaultDirectory: '/tmp/downloads',
    now: new Date('2026-08-20T08:42:00'),
  });
  assert.deepEqual(result, { ok: true, canceled: true });
  assert.equal(writes.length, 0);
});

test('saveBootLog writes the dump to the chosen path', async () => {
  const writes = [];
  let dialogOptions;
  const result = await saveBootLog({
    dialog: {
      showSaveDialog: async (_win, options) => {
        dialogOptions = options;
        return { canceled: false, filePath: '/tmp/out.log' };
      },
    },
    browserWindow: { id: 1 },
    dump: 'full dump',
    writeFile: async (filePath, body, encoding) => {
      writes.push({ filePath, body, encoding });
    },
    defaultDirectory: '/tmp/downloads',
    now: new Date('2026-08-20T08:42:03'),
  });
  assert.deepEqual(result, { ok: true, canceled: false, path: '/tmp/out.log' });
  assert.deepEqual(writes, [{ filePath: '/tmp/out.log', body: 'full dump', encoding: 'utf8' }]);
  assert.equal(dialogOptions.defaultPath, path.join('/tmp/downloads', 'dshd-boot-20260820-084203.log'));
  assert.deepEqual(dialogOptions.filters, [
    { name: 'Log', extensions: ['log', 'txt'] },
  ]);
});

test('saveBootLog returns ok false when writeFile throws', async () => {
  const result = await saveBootLog({
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: '/tmp/out.log' }) },
    dump: 'full dump',
    writeFile: async () => {
      throw new Error('disk full');
    },
    defaultDirectory: '/tmp/downloads',
    now: new Date('2026-08-20T08:42:03'),
  });
  assert.equal(result.ok, false);
  assert.match(String(result.error), /disk full/);
});
