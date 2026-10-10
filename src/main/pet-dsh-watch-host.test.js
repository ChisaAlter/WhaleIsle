'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createDshWatchWorker } = require('./pet-dsh-watch-host');
const { normalizeDshState } = require('./pet-settings');

function fixture(t, { open = false, save } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-watch-worker-'));
  const file = path.join(dir, 'sessions', 'ws', 'session', 'session.jsonl.zstd');
  const usageFile = path.join(dir, 'data', 'usage-today.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const append = (events) => fs.appendFileSync(file,
    zlib.zstdCompressSync(Buffer.from(events.map((event) => JSON.stringify(event)).join('\n') + '\n')));
  append([{ type: 'turn/start', data: { turn: 1 } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 200 } } },
    ...(!open ? [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'failed' } } }] : []),
  ]);
  let dsh = {};
  let clock = Date.now();
  let saves = 0;
  const effects = [];
  const watch = createDshWatchWorker({
    sessionsDir: path.join(dir, 'sessions'), usageFile,
    getDsh: () => dsh,
    saveDsh: (next) => {
      saves += 1;
      save?.(next, saves);
      dsh = normalizeDshState(next);
    },
    now: () => clock,
    isPetVisible: () => false,
    onEvent: (event) => effects.push(event.type),
    onState: (state) => effects.push(state),
  });
  t.after(async () => { await watch.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { watch, append, usageFile, effects, get dsh() { return dsh; }, get saves() { return saves; },
    advance: (ms) => { clock += ms; } };
}

test('worker shares an in-flight poll and preserves hidden usage, state and event order', async (t) => {
  const f = fixture(t);
  const first = f.watch.poll();
  assert.equal(f.watch.poll(), first);
  await first;
  assert.equal(f.saves, 1);
  assert.equal(f.dsh.dayTokens.used, 200);
  assert.ok(f.effects.indexOf('dshError') < f.effects.indexOf('working'));
  assert.equal(JSON.parse(fs.readFileSync(f.usageFile, 'utf8')).used, 200);
  f.advance(2000);
  await f.watch.poll();
  assert.equal(f.saves, 1);
  assert.equal(f.dsh.dayTokens.used, 200);
});

test('failed main checkpoint retries before publishing the usage mirror', async (t) => {
  const f = fixture(t, { save: (_next, attempt) => {
    if (attempt === 1) throw new Error('temporary config lock');
  } });
  await assert.rejects(f.watch.poll(), /temporary config lock/);
  assert.equal(fs.existsSync(f.usageFile), false);
  assert.deepEqual(f.dsh, {});
  f.advance(2000);
  await f.watch.poll();
  assert.equal(f.saves, 2);
  assert.equal(f.dsh.dayTokens.used, 200);
  assert.equal(JSON.parse(fs.readFileSync(f.usageFile, 'utf8')).used, 200);
});

test('stop commits the last sub-minute runtime checkpoint and is idempotent', async (t) => {
  const f = fixture(t, { open: true });
  await f.watch.poll();
  f.advance(2000);
  await f.watch.poll();
  assert.equal(f.saves, 1);
  assert.equal(f.dsh.activeMsToday, 0);
  const closing = f.watch.close();
  assert.equal(f.watch.close(), closing);
  assert.equal(f.dsh.activeMsToday, 2000);
  await closing;
  await assert.rejects(f.watch.poll(), /closed/);
});

test('stop before a result suppresses late config and event effects', async (t) => {
  const f = fixture(t);
  const pending = f.watch.poll();
  const rejected = assert.rejects(pending, /closed/);
  await f.watch.close();
  await rejected;
  assert.equal(f.saves, 0);
  assert.deepEqual(f.effects, []);
});

test('stop during an accepted checkpoint cannot rewind to an older runtime projection', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-watch-checkpoint-stop-'));
  const file = path.join(dir, 'ws', 'session', 'session.jsonl.zstd');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const append = (step, tokens) => fs.appendFileSync(file, zlib.zstdCompressSync(Buffer.from(
    JSON.stringify({ type: 'assistant/message', data: { turn: 1, step, usage: { inputTokens: tokens } } }) + '\n')));
  append(1, 200);
  let dsh = {};
  let stopAtSave = false;
  let closed;
  const watch = createDshWatchWorker({ sessionsDir: dir, getDsh: () => dsh,
    saveDsh: (next) => { dsh = normalizeDshState(next); if (stopAtSave) closed = watch.close(); } });
  t.after(async () => { await watch.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await watch.poll();
  append(2, 300);
  stopAtSave = true;
  await assert.rejects(watch.poll(), /closed/);
  await closed;
  assert.equal(dsh.dayTokens.used, 500);
  assert.equal(dsh.files[file], fs.statSync(file).size);
});

for (const failSave of [false, true]) test(`hiding during a scan keeps outbox unread${failSave ? ' even if saving fails' : ''}`, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-watch-hidden-scan-'));
  const outboxFile = path.join(dir, 'pet-outbox.jsonl');
  fs.writeFileSync(outboxFile, JSON.stringify({ kind: 'notify', text: '重要提醒' }) + '\n');
  let dsh = normalizeDshState({ lastSeenAt: 123 });
  let visible = true;
  let fail = failSave;
  const events = [];
  const watch = createDshWatchWorker({ outboxFile, getDsh: () => dsh,
    isPetVisible: () => visible, onEvent: (event) => events.push(event),
    saveDsh: (next) => { if (fail) throw Error('save failed'); dsh = normalizeDshState(next); } });
  t.after(async () => { await watch.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const first = watch.poll();
  visible = false;
  if (failSave) await assert.rejects(first, /save failed/);
  else await first;
  assert.equal(events.filter((event) => event.type === 'dshWhale').length, 0);
  assert.equal(dsh.files[outboxFile], undefined);
  assert.equal(dsh.lastSeenAt, 123);
  fail = false;
  visible = true;
  await watch.poll();
  await watch.poll();
  assert.deepEqual(events.filter((event) => event.type === 'dshWhale').map((event) => event.summary), ['重要提醒']);
  assert.equal(dsh.files[outboxFile], fs.statSync(outboxFile).size);
});
