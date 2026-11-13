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

/** Read the effective approval policy through each shipped host's public API. */
export function approvalPolicyOf(approval, session) {
  if (typeof approval?.policyOf === 'function') return approval.policyOf(session);
  if (typeof approval?.overrideOf === 'function') {
    return approval.overrideOf(session) ?? approval.config?.policy ?? 'ask';
  }
  return 'never';
}
