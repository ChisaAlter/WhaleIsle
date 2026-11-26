import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askLockKey,
  buildOwnerAnswerPayload,
  buildQuickAskChoiceKey,
  buildQuickAskRequestId,
  resolveItemQuestionEventId,
} from './bot-quick-ask.ts';

test('resolveItemQuestionEventId prefers question.eventId and falls back to item.questionEventId / question.id', () => {
  assert.equal(resolveItemQuestionEventId({ uid: 'u1', questionEventId: 'e12', question: { eventId: 'e15', id: 15 } }), 'e15');
  assert.equal(resolveItemQuestionEventId({ uid: 'u1', questionEventId: 'e12', question: { id: 12 } }), 'e12');
  assert.equal(resolveItemQuestionEventId({ uid: 'u1', question: { id: 19 } }), 19);
  assert.equal(resolveItemQuestionEventId({ uid: 'u1' }, { eventId: 'e99' }), 'e99');
  assert.equal(resolveItemQuestionEventId({ uid: 'u1' }), undefined);
});

test('buildQuickAskRequestId produces deterministic <=128 char idempotent IDs keyed by (uid, questionEventId, choiceKey)', () => {
  const decA = [{ picks: [2, 0] }];
  const decB = [{ picks: [0, 2] }];
  const idA = buildQuickAskRequestId('itm-1', 'e42', decA, 'text');
  const idB = buildQuickAskRequestId('itm-1', 'e42', decB, 'text');
  assert.equal(idA, idB);
  assert.equal(idA, 'ask:itm-1:e42:0:0,2');

  const idOtherQ = buildQuickAskRequestId('itm-1', 'e43', decA, 'text');
  assert.notEqual(idA, idOtherQ);

  const manyDecisions = Array.from({ length: 40 }, (_, i) => ({ picks: [i, i + 1, i + 2] }));
  const longId = buildQuickAskRequestId('itm-long-uid', 'e999', manyDecisions, 'fallback');
  assert.ok(longId.length <= 128);
  assert.equal(longId, buildQuickAskRequestId('itm-long-uid', 'e999', manyDecisions, 'fallback'));
  assert.equal(buildQuickAskChoiceKey(undefined, '同意继续'), buildQuickAskChoiceKey([], '  同意继续  '));
});

test('buildOwnerAnswerPayload aligns answers with questionEventId and preserves decisions', () => {
  assert.deepEqual(buildOwnerAnswerPayload('e77', [{ picks: [1] }]), {
    decisions: [{ picks: [1] }],
    questionEventId: 'e77',
    answers: 'e77',
  });
  assert.deepEqual(buildOwnerAnswerPayload(undefined, [{ picks: [0] }]), {
    decisions: [{ picks: [0] }],
  });
  assert.equal(askLockKey('itm-1', 'e77'), 'itm-1:e77');
  assert.equal(askLockKey('itm-1', undefined), 'itm-1:none');
});
