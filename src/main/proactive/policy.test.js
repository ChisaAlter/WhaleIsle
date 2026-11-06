'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PolicyViolation, assertAllowed, evaluate } = require('./policy');

test('read-only work is available at every autonomy level', () => {
  for (const autonomy of [1, 2, 3, 4, 5]) {
    assert.equal(evaluate({ autonomy, action: 'read' }).allowed, true);
  }
});

test('L1 cannot write and L2 can prepare a reversible draft', () => {
  assert.equal(evaluate({ autonomy: 1, action: 'draft' }).allowed, false);
  assert.equal(evaluate({ autonomy: 2, action: 'draft' }).allowed, true);
});

test('external communication requires approval even at L5', () => {
  const pending = evaluate({ autonomy: 5, action: 'external_message', explicitAuthorization: true });
  assert.equal(pending.requiresApproval, true);
  assert.equal(pending.allowed, false);
  assert.equal(evaluate({ autonomy: 5, action: 'external_message', approved: true, explicitAuthorization: true }).allowed, true);
});

test('assertAllowed exposes a stable approval-required error code', () => {
  assert.throws(() => assertAllowed({ autonomy: 3, action: 'publish' }), error => {
    assert.ok(error instanceof PolicyViolation);
    assert.equal(error.code, 'approval_required');
    return true;
  });
});
