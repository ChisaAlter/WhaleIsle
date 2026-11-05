'use strict';

const ALWAYS_APPROVAL = new Set(['external_message', 'publish', 'account_change', 'permission_change', 'payment', 'irreversible_delete']);
const READ_ONLY = new Set(['read', 'summarize', 'inspect']);
const LOCAL_REVERSIBLE = new Set(['draft', 'local_write', 'test']);

class PolicyViolation extends Error {
  constructor(message, code = 'policy_denied') {
    super(message);
    this.name = 'PolicyViolation';
    this.code = code;
  }
}

function evaluate({ autonomy, action, approved = false, explicitAuthorization = false } = {}) {
  const level = Number(autonomy);
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    throw new RangeError('autonomy must be an integer from 1 to 5');
  }
  if (!action) throw new TypeError('action is required');

  if (READ_ONLY.has(action)) return { allowed: true, requiresApproval: false, level, action };
  if (level === 1) return { allowed: false, requiresApproval: false, level, action, reason: 'L1 is read-only' };
  if (LOCAL_REVERSIBLE.has(action) && level >= 2) return { allowed: true, requiresApproval: false, level, action };
  if (ALWAYS_APPROVAL.has(action)) {
    if (!approved) return { allowed: false, requiresApproval: true, level, action, reason: 'Human approval is required' };
    return { allowed: true, requiresApproval: true, level, action, explicitAuthorization };
  }
  if (level < 4) return { allowed: false, requiresApproval: true, level, action, reason: 'Action exceeds the autonomy level' };
  if (!explicitAuthorization) return { allowed: false, requiresApproval: true, level, action, reason: 'L4/L5 still needs task authorization' };
  return { allowed: true, requiresApproval: false, level, action, explicitAuthorization };
}

function assertAllowed(input) {
  const decision = evaluate(input);
  if (!decision.allowed) throw new PolicyViolation(decision.reason, decision.requiresApproval ? 'approval_required' : 'autonomy_denied');
  return decision;
}

module.exports = { ALWAYS_APPROVAL, LOCAL_REVERSIBLE, PolicyViolation, READ_ONLY, assertAllowed, evaluate };
