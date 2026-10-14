const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-state-'));
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app: { getPath: () => dir } } };
const { listMarketplaceState, setMarketplaceFavorite, recordMarketplaceOperation, redactMarketLog } = require('./marketplace-state');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test.beforeEach(() => {
  fs.rmSync(path.join(dir, 'marketplace-state.json'), { force: true });
});

test('favorites survive reads, deduplicate, and validate IPC arguments', () => {
  setMarketplaceFavorite('acme/demo', true);
  setMarketplaceFavorite('acme/demo', true);
  assert.deepEqual(listMarketplaceState().favorites, ['acme/demo']);
  assert.throws(() => setMarketplaceFavorite({}, true));
  assert.throws(() => setMarketplaceFavorite('acme/demo', 'true'));
  assert.deepEqual(setMarketplaceFavorite('acme/demo', false).favorites, []);
});

test('operation history is bounded and secrets are removed before persistence', async () => {
  for (let i = 0; i < 32; i++) {
    await recordMarketplaceOperation('install', 'acme/demo', async progress => {
      progress({ line: 'https://user:secret@github.com/repo?token=private' });
      return { ok: false, error: 'Authorization: Bearer invisible', log: 'x'.repeat(20000) + ' _authToken=private' };
    });
  }
  const state = listMarketplaceState();
  assert.equal(state.operations.length, 30);
  assert.ok(state.operations[0].log.length <= 16000);
  assert.equal(state.operations[0].status, 'failed');
  const disk = fs.readFileSync(path.join(dir, 'marketplace-state.json'), 'utf8');
  assert.doesNotMatch(disk, /secret|private|invisible/);
});

test('running state and progress remain visible without the invoking renderer', async () => {
  let finish;
  const work = recordMarketplaceOperation('update', 'acme/demo', async progress => {
    progress({ line: 'working' });
    await new Promise(resolve => { finish = resolve; });
    return { ok: true, harnessStarted: false, error: 'restart failed' };
  });
  assert.equal(listMarketplaceState().operations[0].status, 'running');
  assert.match(listMarketplaceState().operations[0].log, /working/);
  finish();
  await work;
  assert.equal(listMarketplaceState().operations[0].status, 'failed');
});

test('a completed plugin operation is recorded as succeeded only after the Harness restart is confirmed', async () => {
  const result = { ok: true, harnessStarted: true };
  assert.equal(await recordMarketplaceOperation('install', 'acme/demo', async () => result), result);
  const operation = listMarketplaceState().operations[0];
  assert.equal(operation.status, 'succeeded');
  assert.equal(operation.error, '');
});

test('a returned plugin operation without a restart result remains explicitly unconfirmed in durable history', async () => {
  const result = { ok: true };
  assert.equal(await recordMarketplaceOperation('update', 'acme/demo', async () => result), result);
  const operation = listMarketplaceState().operations[0];
  assert.equal(operation.status, 'interrupted');
  assert.match(operation.error, /Harness 重启结果尚未确认/);
  assert.ok(Number.isFinite(operation.finishedAt));
});

for (const [name, outcome, expectedWarning] of [
  ['confirmed restart', { ok: true, harnessStarted: true }, /插件操作及 Harness 重启已完成/],
  ['restart failure', { ok: true, harnessStarted: false, error: 'restart failed' }, /Harness 未重新启动/],
  ['unknown restart', { ok: true }, /Harness 重启结果尚未确认/],
  ['operation failure', { ok: false, error: 'install failed' }, /插件操作未完成/],
]) {
  test(`history storage failure preserves the ${name} outcome and reports the redacted storage error`, async (t) => {
    const rename = fs.renameSync;
    let writes = 0;
    t.mock.method(fs, 'renameSync', (...args) => {
      if (++writes > 1) throw new Error('history denied Authorization: Bearer history-secret');
      return rename(...args);
    });
    const result = await recordMarketplaceOperation('install', 'acme/demo', async () => outcome);
    const { historyWarning, ...actualOutcome } = result;
    assert.deepEqual(actualOutcome, outcome);
    assert.match(historyWarning, expectedWarning);
    assert.match(historyWarning, /操作记录保存失败：history denied/);
    assert.doesNotMatch(historyWarning, /history-secret/);
  });
}

test('a thrown plugin error and a history write failure are both reported without losing either failure', async (t) => {
  const rename = fs.renameSync;
  let writes = 0;
  t.mock.method(fs, 'renameSync', (...args) => {
    if (++writes > 1) throw new Error('history denied');
    return rename(...args);
  });
  const result = await recordMarketplaceOperation('uninstall', 'acme/demo', async () => {
    throw new Error('remove failed Authorization: Bearer operation-secret');
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /remove failed/);
  assert.match(result.historyWarning, /插件操作失败；操作记录保存失败：history denied/);
  assert.doesNotMatch(JSON.stringify(result), /operation-secret/);
});

test('unfinished records from a previous desktop process become interrupted', () => {
  fs.writeFileSync(path.join(dir, 'marketplace-state.json'), JSON.stringify({ operations: [
    { id: 'old', kind: 'update', target: 'acme/demo', startedAt: Date.now(), status: 'running', log: '' },
    { id: 'invalid', kind: 'bogus', startedAt: 'bad' },
  ] }));
  assert.equal(listMarketplaceState().operations.length, 1);
  assert.equal(listMarketplaceState().operations[0].status, 'interrupted');
});

test('redaction handles URL userinfo, query credentials and known token prefixes', () => {
  const value = redactMarketLog('https://user:secret@host/path?access_token=abc Authorization: Bearer hidden github_pat_123456 api_key="private"');
  assert.doesNotMatch(value, /secret|abc|hidden|github_pat_123456|private/);
});
