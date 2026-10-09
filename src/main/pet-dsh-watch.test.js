'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createDshWatch, decodeAppended, MILESTONES } = require('./pet-dsh-watch');
const { normalizeDshState } = require('./pet-settings');

function tmpSessions(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-watch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function appendEvents(file, events) {
  const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, zlib.zstdCompressSync(Buffer.from(body, 'utf8')));
}

function logFile(sessionsDir, sess = 'sess-1') {
  return path.join(sessionsDir, 'ws-a', sess, 'session.jsonl.zstd');
}

function makeWatch(t, sessionsDir, { dsh, now, rng } = {}) {
  const state = { dsh: dsh || {} };
  const events = [];
  const states = [];
  let saves = 0;
  const watch = createDshWatch({
    sessionsDir,
    getDsh: () => state.dsh,
    saveDsh: (next) => { state.dsh = next; saves += 1; },
    onEvent: (e) => events.push(e),
    onState: (s) => states.push(s),
    now: now || (() => Date.now()),
    rng: rng || (() => 0), // deterministic: every gate admits
    frameSizeOf: require('./pet-growth').zstdFrameSize,
  });
  return { watch, events, states, state, get saves() { return saves; } };
}

test('idle polls do not rewrite watermarks or usage mirror without changes', (t) => {
  const dir = tmpSessions(t);
  let clock = Date.now();
  const usageFile = path.join(dir, 'usage-today.json');
  const state = { dsh: {}, writes: 0 };
  const watch = createDshWatch({
    sessionsDir: dir,
    usageFile,
    getDsh: () => state.dsh,
    saveDsh: (next) => { state.dsh = next; state.writes += 1; },
    now: () => clock,
  });
  watch.poll();
  const saved = state.writes;
  const mirror = fs.readFileSync(usageFile, 'utf8');
  for (let i = 0; i < 10; i += 1) {
    clock += 2000;
    watch.poll();
  }
  assert.equal(state.writes, saved);
  assert.equal(fs.readFileSync(usageFile, 'utf8'), mirror);
});

test('usage mirror retries the same snapshot after atomic rename fails', (t) => {
  const dir = tmpSessions(t);
  const usageFile = path.join(dir, 'usage-today.json');
  let renames = 0;
  const fsImpl = { ...fs, renameSync: (...args) => {
    renames += 1;
    if (renames === 1) { throw new Error('temporary lock'); }
    return fs.renameSync(...args);
  } };
  let dsh = {};
  const watch = createDshWatch({ sessionsDir: dir, usageFile, fsImpl,
    getDsh: () => dsh, saveDsh: (next) => { dsh = next; } });
  watch.poll();
  assert.equal(fs.existsSync(usageFile), false);
  watch.poll();
  assert.equal(renames, 2);
  assert.equal(JSON.parse(fs.readFileSync(usageFile, 'utf8')).used, 0);
});

test('bounded persistence does not rewrite on every poll with 401 live log cursors', (t) => {
  const dir = tmpSessions(t);
  const files = {};
  for (let i = 0; i < 401; i += 1) {
    const file = logFile(dir, `sess-${i}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    files[file] = 0;
  }
  let dsh = { files };
  let saves = 0;
  const watch = createDshWatch({ sessionsDir: dir,
    getDsh: () => dsh, saveDsh: (next) => { dsh = normalizeDshState(next); saves += 1; } });
  watch.poll();
  const first = saves;
  for (let i = 0; i < 3; i += 1) { watch.poll(); }
  assert.equal(saves, first);
  assert.equal(Object.keys(dsh.files).length, 400);
});

test('normal watcher stop flushes sub-minute active time', (t) => {
  const dir = tmpSessions(t);
  let clock = Date.now();
  let dsh = {};
  const watch = createDshWatch({ sessionsDir: dir, now: () => clock,
    getDsh: () => dsh, saveDsh: (next) => { dsh = normalizeDshState(next); } });
  appendEvents(logFile(dir), [{ type: 'turn/start', data: { turn: 1 } }]);
  const stop = watch.start();
  watch.poll();
  clock += 20000;
  watch.poll();
  assert.equal(dsh.activeMsToday, 0);
  stop();
  assert.equal(dsh.activeMsToday, 20000);
});

test('failed final checkpoint does not block watcher shutdown', (t) => {
  const dir = tmpSessions(t);
  let clock = Date.now();
  let dsh = {};
  let saves = 0;
  const watch = createDshWatch({ sessionsDir: dir, now: () => clock,
    getDsh: () => dsh, saveDsh: (next) => {
      if (saves++ > 0) { throw new Error('disk unavailable'); }
      dsh = normalizeDshState(next);
    } });
  appendEvents(logFile(dir), [{ type: 'turn/start', data: { turn: 1 } }]);
  const stop = watch.start();
  watch.poll();
  clock += 2000;
  watch.poll();
  assert.doesNotThrow(stop);
});

test('active time checkpoints by minute while new log events save immediately', (t) => {
  const dir = tmpSessions(t);
  let clock = Date.now();
  const fixture = makeWatch(t, dir, { now: () => clock });
  const file = logFile(dir);
  appendEvents(file, [{ type: 'turn/start', data: { turn: 1 } }]);
  fixture.watch.poll();
  const initialSaves = fixture.saves;
  for (let i = 0; i < 29; i += 1) {
    clock += 2000;
    fixture.watch.poll();
  }
  assert.equal(fixture.saves, initialSaves);
  clock += 2000;
  fixture.watch.poll();
  assert.equal(fixture.saves, initialSaves + 1);
  appendEvents(file, [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }]);
  clock += 2000;
  fixture.watch.poll();
  assert.equal(fixture.saves, initialSaves + 2);
});

test('idle poll on empty sessions dir emits nothing', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, states, state } = makeWatch(t, dir);
  watch.poll();
  assert.equal(events.length, 0);
  assert.deepEqual(states, ['idle']);
  assert.ok(state.dsh.day);
});

test('turn/start fires dshWorking once and state flips to working', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, states, state } = makeWatch(t, dir);
  appendEvents(logFile(dir), [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
  ]);
  watch.poll();
  assert.ok(events.some((e) => e.type === 'dshWorking'));
  assert.deepEqual(states, ['working']);
  assert.equal(state.dsh.openTurns['ws-a\\sess-1'] || state.dsh.openTurns['ws-a/sess-1'], 1);

  // Second poll sees no new bytes — the event must not refire.
  events.length = 0;
  watch.poll();
  assert.equal(events.length, 0);
});

test('turn/end completed fires dshDone, other kinds fire dshError', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, state } = makeWatch(t, dir);
  const file = logFile(dir);
  appendEvents(file, [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ]);
  watch.poll();
  assert.ok(events.some((e) => e.type === 'dshDone'));

  events.length = 0;
  appendEvents(file, [
    { type: 'turn/start', seq: 3, time: 3, data: { turn: 2 } },
    { type: 'turn/end', seq: 4, time: 4, data: { turn: 2, reason: { kind: 'error' } } },
  ]);
  watch.poll();
  assert.ok(events.some((e) => e.type === 'dshError' && e.reason === 'error'));
  assert.equal(Object.keys(state.dsh.openTurns).length, 0);
});

test('a session dir removed mid-turn drops only its own open turn', (t) => {
  const dir = tmpSessions(t);
  const { watch, state } = makeWatch(t, dir);
  const kept = logFile(dir, 'sess-1');
  const gone = logFile(dir, 'sess-2');
  appendEvents(kept, [{ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }]);
  appendEvents(gone, [{ type: 'turn/start', seq: 1, time: 1, data: { turn: 7 } }]);
  watch.poll();
  assert.equal(Object.keys(state.dsh.openTurns).length, 2);

  fs.rmSync(path.dirname(gone), { recursive: true, force: true });
  watch.poll();
  const keys = Object.keys(state.dsh.openTurns);
  assert.equal(keys.length, 1);
  assert.equal(state.dsh.openTurns[keys[0]], 1);
  assert.equal(state.dsh.files[gone], undefined); // vanished cursor dropped
  assert.ok(state.dsh.files[kept] > 0);
});

test('usage events accumulate dayTokens and fire milestones once', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, state } = makeWatch(t, dir);
  appendEvents(logFile(dir), [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    {
      type: 'assistant/message', seq: 2, time: 2,
      data: {
        turn: 1, step: 1,
        usage: { inputTokens: MILESTONES[0], outputTokens: 100 },
      },
    },
  ]);
  watch.poll();
  const marks = events.filter((e) => e.type === 'dshMilestone');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].tokens, MILESTONES[0]);
  assert.equal(state.dsh.dayTokens.used, MILESTONES[0] + 100);

  // A retried attempt's re-settlement for the same slot doesn't double-count.
  events.length = 0;
  appendEvents(logFile(dir), [
    {
      type: 'assistant/message', seq: 3, time: 3,
      data: {
        turn: 1, step: 1,
        usage: { inputTokens: MILESTONES[0], outputTokens: 200 },
      },
    },
  ]);
  watch.poll();
  assert.equal(state.dsh.dayTokens.used, MILESTONES[0] + 200);
  assert.equal(events.filter((e) => e.type === 'dshMilestone').length, 0);
});

test('rest reminder fires at 45min continuous then respects the hourly cooldown', (t) => {
  const dir = tmpSessions(t);
  let clock = 1000000;
  const { watch, events, state } = makeWatch(t, dir, { now: () => clock });
  const file = logFile(dir);
  appendEvents(file, [{ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }]);

  watch.poll(); // plants activeSince
  clock += 46 * 60000;
  watch.poll(); // activity still fresh? openTurns keeps it active
  assert.ok(events.some((e) => e.type === 'dshRest' && e.min >= 45));
  assert.ok(state.dsh.lastRestReminder > 0);

  clock += 30 * 60000; // still under the 60min cooldown
  events.length = 0;
  watch.poll();
  assert.equal(events.filter((e) => e.type === 'dshRest').length, 0);
});

test('miss greeting fires when returning after 3+ days', (t) => {
  const dir = tmpSessions(t);
  let clock = 1000000;
  const { watch, events, state } = makeWatch(t, dir, { now: () => clock });
  const file = logFile(dir);
  appendEvents(file, [{ type: 'tool/call', seq: 1, time: 1, data: { turn: 1, step: 1 } }]);
  watch.poll(); // lastSeenAt planted + first greet consumed
  assert.ok(events.some((e) => e.type === 'greet'));

  events.length = 0;
  clock += 4 * 86400000; // four days later
  appendEvents(file, [{ type: 'tool/call', seq: 2, time: 2, data: { turn: 2, step: 1 } }]);
  watch.poll();
  assert.ok(events.some((e) => e.type === 'dshMiss' && e.days === 4));
});

test('report gates thin working chatter via rng', (t) => {
  const dir = tmpSessions(t);
  const { watch, events } = makeWatch(t, dir, { rng: () => 0.9 });
  appendEvents(logFile(dir), [{ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }]);
  watch.poll();
  // rng 0.9 >= gate 0.5 → suppressed; but error/done gates are 1.0 so they pass.
  assert.equal(events.filter((e) => e.type === 'dshWorking').length, 0);
  assert.ok(events.some((e) => e.type === 'greet')); // greet is ungated
});

test('torn trailing frame keeps the offset and never crashes', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, state } = makeWatch(t, dir);
  const file = logFile(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const good = zlib.zstdCompressSync(Buffer.from('{"type":"turn/start","data":{"turn":1}}\n'));
  const torn = zlib.zstdCompressSync(Buffer.from('{"type":"turn/end","data":{"turn":1,"reason":{"kind":"completed"}}}\n'));
  fs.writeFileSync(file, Buffer.concat([good, torn.subarray(0, Math.floor(torn.length / 2))]));
  watch.poll();
  assert.ok(events.some((e) => e.type === 'dshWorking'));
  assert.equal(events.filter((e) => e.type === 'dshDone').length, 0);
  const off1 = state.dsh.files[file];
  assert.equal(off1, good.length);

  // Finish the torn frame — the next poll picks it up.
  fs.writeFileSync(file, Buffer.concat([good, torn]));
  events.length = 0;
  watch.poll();
  assert.ok(events.some((e) => e.type === 'dshDone'));
});

test('deleted log file drops its cursor', (t) => {
  const dir = tmpSessions(t);
  const { watch, state } = makeWatch(t, dir);
  const file = logFile(dir);
  appendEvents(file, [{ type: 'turn/start', seq: 1, data: { turn: 1 } }]);
  watch.poll();
  assert.ok(state.dsh.files[file] > 0);
  fs.rmSync(file);
  watch.poll();
  assert.equal(state.dsh.files[file], undefined);
});

test('decodeAppended stops at a torn frame', () => {
  const a = zlib.zstdCompressSync(Buffer.from('{"a":1}\n'));
  const b = zlib.zstdCompressSync(Buffer.from('{"b":2}\n'));
  const slice = Buffer.concat([a, b.subarray(0, b.length - 3)]);
  const { lines, consumed } = decodeAppended(slice, require('./pet-growth').zstdFrameSize);
  assert.deepEqual(lines, ['{"a":1}']);
  assert.equal(consumed, a.length);
});

function makeOutboxWatch(t, dir, { now, isPetVisible } = {}) {
  const outbox = path.join(dir, 'data', 'whale', 'pet-outbox.jsonl');
  const state = { dsh: {} };
  const events = [];
  const watch = createDshWatch({
    sessionsDir: path.join(dir, 'sessions'),
    outboxFile: outbox,
    isPetVisible,
    getDsh: () => state.dsh,
    saveDsh: (next) => { state.dsh = next; },
    onEvent: (e) => events.push(e),
    onState: () => {},
    now: now || (() => Date.now()),
    rng: () => 0,
    frameSizeOf: require('./pet-growth').zstdFrameSize,
  });
  return { watch, events, state, outbox };
}

test('hidden pets keep important outbox notifications unread while usage continues to update', (t) => {
  const dir = tmpSessions(t);
  let visible = false;
  const { watch, events, outbox } = makeOutboxWatch(t, dir, { isPetVisible: () => visible });
  fs.mkdirSync(path.dirname(outbox), { recursive: true });
  fs.writeFileSync(outbox, JSON.stringify({ type: 'whale/pet', kind: 'notify', text: '重要提醒' }) + '\n');
  watch.poll();
  assert.equal(events.some((event) => event.kind === 'notify'), false);
  visible = true;
  watch.poll();
  assert.equal(events.filter((event) => event.kind === 'notify').length, 1);
  watch.poll();
  assert.equal(events.filter((event) => event.kind === 'notify').length, 1);
});

test('outbox lines emit dshWhale with the text field verbatim', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, outbox } = makeOutboxWatch(t, dir);
  fs.mkdirSync(path.dirname(outbox), { recursive: true });
  fs.writeFileSync(outbox, [
    JSON.stringify({ kind: 'say', text: '主人，里程碑达成！', at: 1 }),
    JSON.stringify({ kind: 'say', text: '第二句', at: 2 }),
    '',
  ].join('\n'), 'utf8');
  watch.poll();
  const whale = events.filter((e) => e.type === 'dshWhale');
  assert.equal(whale.length, 2);
  assert.equal(whale[0].summary, '主人，里程碑达成！');
  assert.equal(whale[1].summary, '第二句');
});

test('outbox kind rides the event so the renderer can pin notify lines', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, outbox } = makeOutboxWatch(t, dir);
  fs.mkdirSync(path.dirname(outbox), { recursive: true });
  fs.writeFileSync(outbox, [
    JSON.stringify({ kind: 'notify', text: '任务完成：报告在 ~/out.pdf' }),
    JSON.stringify({ kind: 'say', text: '随便一句' }),
    JSON.stringify({ text: '无 kind 的老行' }),
    '',
  ].join('\n'), 'utf8');
  watch.poll();
  const whale = events.filter((e) => e.type === 'dshWhale');
  assert.equal(whale.length, 3);
  assert.equal(whale[0].kind, 'notify');
  assert.equal(whale[1].kind, 'say');
  assert.equal(whale[2].kind, '');
});

test('outbox torn trailing line keeps its offset until complete', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, state, outbox } = makeOutboxWatch(t, dir);
  fs.mkdirSync(path.dirname(outbox), { recursive: true });
  const full = JSON.stringify({ kind: 'say', text: '完整的一句' }) + '\n';
  const torn = JSON.stringify({ kind: 'say', text: '还没写完' });
  fs.writeFileSync(outbox, full + torn.slice(0, 8), 'utf8');
  watch.poll();
  assert.equal(events.filter((e) => e.type === 'dshWhale').length, 1);
  const off = state.dsh.files[outbox];
  assert.equal(off, Buffer.byteLength(full));

  // Writer completes the torn line — next poll delivers it, once.
  fs.appendFileSync(outbox, torn.slice(8) + '\n', 'utf8');
  watch.poll();
  const whale = events.filter((e) => e.type === 'dshWhale');
  assert.equal(whale.length, 2);
  assert.equal(whale[1].summary, '还没写完');
});

test('outbox malformed and text-less lines are skipped, text is capped', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, outbox } = makeOutboxWatch(t, dir);
  fs.mkdirSync(path.dirname(outbox), { recursive: true });
  const long = 'x'.repeat(900);
  fs.writeFileSync(outbox, [
    'not-json',
    JSON.stringify({ kind: 'say' }),           // no text field
    JSON.stringify({ kind: 'say', text: 42 }), // non-string text
    JSON.stringify({ kind: 'say', text: '' }), // empty
    JSON.stringify({ kind: 'say', text: long }),
    '',
  ].join('\n'), 'utf8');
  watch.poll();
  const whale = events.filter((e) => e.type === 'dshWhale');
  assert.equal(whale.length, 1);
  assert.equal(whale[0].summary.length, 512);
});

test('deleted outbox file drops its cursor and re-reads on recreate', (t) => {
  const dir = tmpSessions(t);
  const { watch, events, state, outbox } = makeOutboxWatch(t, dir);
  fs.mkdirSync(path.dirname(outbox), { recursive: true });
  fs.writeFileSync(outbox, JSON.stringify({ kind: 'say', text: '第一条' }) + '\n', 'utf8');
  watch.poll();
  assert.ok(state.dsh.files[outbox] > 0);
  fs.rmSync(outbox);
  watch.poll();
  assert.equal(state.dsh.files[outbox], undefined);

  fs.writeFileSync(outbox, JSON.stringify({ kind: 'say', text: '第二条' }) + '\n', 'utf8');
  events.length = 0;
  watch.poll();
  assert.ok(events.some((e) => e.type === 'dshWhale' && e.summary === '第二条'));
});
