/** Repair the empty identity written by the former optional requestId path. */
import { createHash } from 'node:crypto';

export const requestIdForCall = (sessionId, callId) => `request-${createHash('sha256').update(`${sessionId}:${callId}`).digest('hex')}`;

export function optionalRequestId(value) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Object.assign(new Error('Invalid requirement identity.'), { code: 'invalid_request' });
  return value;
}

const review = message => { throw new Error(`Project catalog needs review: ${message} Original records were not changed.`); };
const sameAuthority = (source, expected) => source?.sessionId === expected.sessionId
  && source.messageId === expected.messageId && source.text === expected.text
  && source.authorizationCallId === expected.authorizationCallId
  && JSON.stringify(source.messageIds) === JSON.stringify(expected.messageIds);

export function recoverEmptyRequestIds(value) {
  if (value?.version !== 2 || !Array.isArray(value.requests) || !value.requests.some(row => row?.id === '')) return value;
  const next = structuredClone(value), recovered = new Map();
  for (const row of next.requests.filter(row => row.id === '')) {
    const project = next.projects?.find(project => project.id === row.projectId);
    if (!project || recovered.has(row.projectId)) review('An empty requirement identity has no unique owning Project.');
    const first = row.versions?.find(version => version.revision === 1)?.source;
    if (!first || typeof first.callId !== 'string' || !first.callId || first.authorizationCallId !== first.callId) review('An empty requirement identity has no original authorization call.');
    if (!row.versions.some(version => version.revision === row.revision)
      || new Set(row.versions.map(version => version.revision)).size !== row.versions.length) review('An empty requirement identity has conflicting versions.');
    for (const version of row.versions) {
      const source = version.source;
      if (!source || source.sessionId !== project.coordinatorSessionId || source.requestId !== ''
        || source.requestRevision !== version.revision || !source.messageId || !source.authorizationCallId
        || source.authorizationCallId !== source.callId) review('An empty requirement identity has conflicting source authorization.');
    }
    const id = requestIdForCall(first.sessionId, first.callId);
    if (next.requests.some(other => other !== row && other.id === id)) review('The recovered requirement identity is already used.');
    recovered.set(row.projectId, { row, id });
  }
  const resolve = (projectId, revision, source) => {
    const match = recovered.get(projectId), version = match?.row.versions.find(version => version.revision === revision);
    if (!version || source && !sameAuthority(source, version.source)) review('An empty requirement reference cannot be matched to its original version and authorization.');
    return match.id;
  };
  for (const work of next.workstreams ?? []) {
    for (const receipt of work.delegations ?? []) if (receipt.source?.requestId === '') {
      receipt.source.requestId = resolve(work.projectId, receipt.source.requestRevision, receipt.source);
    }
  }
  for (const work of next.workstreams ?? []) {
    if (work.replaces?.requestId === '') {
      const original = next.workstreams.find(item => item.id === work.replaces.workstreamId && item.projectId === work.projectId);
      const receipt = original?.delegations.find(item => item.ref === work.replaces.delegationRef);
      const id = resolve(work.projectId, work.replaces.requestRevision);
      if (!receipt || receipt.source.requestId !== id || receipt.source.requestRevision > work.replaces.requestRevision) review('A replacement has no uniquely matching original requirement.');
      work.replaces.requestId = id;
    }
  }
  for (const delivery of next.deliveries ?? []) if (delivery.requestId === '') {
    const id = resolve(delivery.projectId, delivery.requestRevision);
    if (delivery.sessionId !== next.projects.find(project => project.id === delivery.projectId)?.coordinatorSessionId) review('A handover has a conflicting requirement owner.');
    delivery.requestId = id;
  }
  for (const { row, id } of recovered.values()) {
    const source = row.versions.find(version => version.revision === 1).source;
    row.id = id;
    row.identityRecovery = { originalId: '', sessionId: source.sessionId, callId: source.callId };
    for (const version of row.versions) version.source.requestId = id;
  }
  return next;
}
