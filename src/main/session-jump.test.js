'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createListenerSet, createSessionJumpQueue } = require('./session-jump');

test('createListenerSet fans out to multiple subscribers and unsubscribes cleanly', () => {
  const set = createListenerSet();
  const seenA = [];
  const seenB = [];
  const unsubA = set.add((value) => seenA.push(value));
  set.add(() => { throw new Error('isolated listener failure'); });
  const unsubB = set.add((value) => seenB.push(value));

  set.emit('http://127.0.0.1:3080');
  assert.deepEqual(seenA, ['http://127.0.0.1:3080']);
  assert.deepEqual(seenB, ['http://127.0.0.1:3080']);

  unsubA();
  set.emit('');
  assert.deepEqual(seenA, ['http://127.0.0.1:3080']);
  assert.deepEqual(seenB, ['http://127.0.0.1:3080', '']);
  unsubB();
});

test('createSessionJumpQueue dispatches immediately when loaded or queues until reveal', () => {
  const queue = createSessionJumpQueue();
  const sent = [];
  let loaded = false;
  const fakeWin = {};
  const fakeWc = {
    isDestroyed: () => false,
    send: (channel, payload) => sent.push({ channel, payload }),
  };

  assert.equal(queue.request(fakeWin, () => loaded, () => fakeWc, 'sess-queued'), true);
  assert.equal(sent.length, 0, 'does not send before harness is revealed');

  loaded = true;
  queue.consume(fakeWin, () => loaded, () => fakeWc);
  assert.deepEqual(sent, [{ channel: 'shell:open-session', payload: { sessionId: 'sess-queued' } }]);

  queue.consume(fakeWin, () => loaded, () => fakeWc);
  assert.equal(sent.length, 1, 'pending session jump is consumed once');

  assert.equal(queue.request(fakeWin, () => loaded, () => fakeWc, 'sess-live'), true);
  assert.deepEqual(sent[1], { channel: 'shell:open-session', payload: { sessionId: 'sess-live' } });
});
