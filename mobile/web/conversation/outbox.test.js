import test from 'node:test';
import assert from 'node:assert/strict';
import { mintRequestId, promptIdentity, settleOutbox, userRowIds } from './outbox.js';

test('mintRequestId uses getRandomValues and v4 layout', () => {
  const id = mintRequestId({ getRandomValues: (bytes) => bytes.fill(0xab) });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('promptIdentity keeps the request id for an identical retry only', () => {
  const first = promptIdentity(null, { sessionId: 's', text: 'hi', images: [], mode: 'queue' });
  assert.equal(promptIdentity(first, { sessionId: 's', text: 'hi', images: [], mode: 'queue' }), first);
  assert.notEqual(promptIdentity(first, { sessionId: 's', text: 'hi!', images: [], mode: 'queue' }).requestId, first.requestId);
  assert.notEqual(promptIdentity(first, { sessionId: 's', text: 'hi', images: [], mode: 'steer' }).requestId, first.requestId);
});

test('settleOutbox clears an entry once a new matching user row arrives', () => {
  const before = [{ id: 'u1', role: 'user', text: 'hi' }];
  const entry = { id: 'r1', text: 'hi', images: [], baseline: userRowIds(before), status: 'sent' };
  assert.equal(settleOutbox([entry], before).length, 1, 'an older identical message does not settle it');
  assert.equal(settleOutbox([entry], [...before, { id: 'u2', role: 'user', text: ' hi ' }]).length, 0);
});

test('one echoed row settles one of two identical sends', () => {
  const baseline = new Set();
  const outbox = [
    { id: 'r1', text: 'go', images: [], baseline, status: 'sent' },
    { id: 'r2', text: 'go', images: [], baseline, status: 'sent' },
  ];
  assert.deepEqual(settleOutbox(outbox, [{ id: 'u9', role: 'user', text: 'go' }]).map((entry) => entry.id), ['r2']);
});

test('a confirmed send waiting in the host queue leaves the outbox', () => {
  const entry = { id: 'r1', text: '排队', images: [], baseline: new Set(), status: 'sent' };
  assert.equal(settleOutbox([entry], [], [{ id: 'q', text: '排队' }]).length, 0);
  assert.equal(settleOutbox([{ ...entry, status: 'sending' }], [], [{ id: 'q', text: '排队' }]).length, 1);
});
