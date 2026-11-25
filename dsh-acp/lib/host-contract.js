/** The host's public control contract differs between shipped 0.2.1 and 0.2.2. */
export async function listDirectChildren(subagents, parentId, signal) {
  if (typeof subagents.listChildren === 'function') return subagents.listChildren(parentId, signal);
  const rows = await subagents.listDescendants(parentId, signal);
  const direct = rows.filter((row) => row.parentId === parentId && row.depth === 1);
  const diagnostic = direct.find((row) => row.kind === 'diagnostic');
  if (diagnostic) throw new Error(`Cannot read child ${diagnostic.id}: ${diagnostic.reason}.`);
  return direct.filter((row) => row.kind === 'child');
}

/** A persisted request fixes the execution route; creation options are only a fallback. */
export function executionProvider(agent) {
  return agent?.session?.requestHeader?.()?.config?.provider
    || agent?.model?.current?.()?.provider || agent?.options?.provider;
}

/** Safely retrieve a service from a Cordis context or plain mock object. */
export function safeGetService(ctx, serviceName) {
  if (!ctx) return undefined;
  try {
    if (typeof ctx.get === 'function') {
      const val = ctx.get(serviceName);
      if (val !== undefined) return val;
    }
    return ctx[serviceName];
  } catch {
    return undefined;
  }
}

/** Read the effective approval policy through each shipped host's public API. */
export function approvalPolicyOf(approval, session) {
  if (!approval) return 'never';
  if (typeof approval.policyOf === 'function') return approval.policyOf(session);
  if (typeof approval.overrideOf === 'function') {
    return approval.overrideOf(session) ?? approval.config?.policy ?? 'ask';
  }
  return 'ask';
}

/**
 * Map the host's sandbox/approval state to the ACP client runtime policy.
 * Only an unrestricted host sandbox may put the agent in its own no-prompt
 * mode (Antigravity "yolo"); under workspace-write, requests must still reach
 * the client policy, which enforces the sandbox.
 */
export function acpRuntimePolicy({ cwd, readOnly, sandboxMode, ask }) {
  const sandboxPolicy = { type: readOnly ? 'readOnly' : sandboxMode === 'danger-full-access' ? 'dangerFullAccess' : 'workspaceWrite', writableRoots: [cwd] };
  const fullAccess = !readOnly && !ask && sandboxPolicy.type === 'dangerFullAccess';
  return { cwd, runtimeMode: fullAccess ? 'full-access' : 'approval-required',
    approvalPolicy: ask ? 'on-request' : 'never', sandboxPolicy };
}
