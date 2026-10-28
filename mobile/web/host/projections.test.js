import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTokens, queuedMessages, queueUpdate, sessionUsage } from './projections.js';

const inbox = {
  'next-turn': [
    { id: 'q1', source: { kind: 'user' }, content: [{ type: 'text', text: '下一轮' }] },
    { id: 'q2', source: { kind: 'user' }, content: [{ type: 'text', text: '带图' }, { type: 'image', attachment: { attachmentId: 'a' } }] },
    { id: 'q3', source: { kind: 'system' }, content: [{ type: 'text', text: '系统' }] },
    { source: { kind: 'user' }, content: [{ type: 'text', text: '无 id' }] },
  ],
  'next-step': [{ id: 'q4', source: { kind: 'user' }, content: [{ type: 'text', text: '本轮' }] }],
};

test('queuedMessages keeps identified user input in target order', () => {
  const items = queuedMessages({ inbox });
  assert.deepEqual(items.map((item) => [item.id, item.target, item.editable, item.hasAttachments]), [
    ['q1', 'next-turn', true, false],
    ['q2', 'next-turn', false, true],
    ['q4', 'next-step', true, false],
  ]);
  assert.equal(items[1].text, '带图');
  assert.deepEqual(queuedMessages(undefined), []);
});

test('sessionUsage requires every total and never invents zeros', () => {
  assert.deepEqual(sessionUsage({ usagePanel: { totals: { input: 1200, output: 30, cacheRead: 0, cacheWrite: 5 } } }), {
    input: 1200, output: 30, cacheRead: 0, cacheWrite: 5,
  });
  assert.equal(sessionUsage({ usagePanel: { totals: { input: 1, output: 2 } } }), null);
  assert.equal(sessionUsage({}), null);
});

test('queueUpdate validates edits, steering and unknown actions', () => {
  const [plain, image] = queuedMessages({ inbox });
  assert.deepEqual(queueUpdate('s', plain, 'edit', { text: '改' }), {
    sessionId: 's', itemId: 'q1', action: { kind: 'edit', content: [{ type: 'text', text: '改' }] },
  });
  assert.throws(() => queueUpdate('s', image, 'edit', { text: '改' }), /纯文本/);
  assert.throws(() => queueUpdate('s', plain, 'steer', { running: false }), /已结束/);
  assert.deepEqual(queueUpdate('s', plain, 'steer', { running: true }).action, { kind: 'steer' });
  assert.deepEqual(queueUpdate('s', image, 'remove').action, { kind: 'remove' });
  assert.throws(() => queueUpdate('s', plain, 'reorder'), /未知/);
  assert.throws(() => queueUpdate('s', null, 'remove'), /已不在/);
});

test('formatTokens keeps short readable counts', () => {
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(1530), '1.5K');
  assert.equal(formatTokens(25_400), '25K');
  assert.equal(formatTokens(2_300_000), '2.3M');
  assert.equal(formatTokens(null), '—');
});
