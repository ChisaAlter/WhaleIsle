import test from 'node:test';
import assert from 'node:assert/strict';
import './harness-runtime.mjs';
import { requestIdForCall } from '../lib/catalog-recovery.js';

const { projectDomain } = await import('../lib/domain.js');
const schema = projectDomain.tables.state.valueSchema;
function catalog() {
  const project = { id: 'project', title: 'Saved project', canonicalWorkingDirectory: '/repository', directoryIdentity: 'directory',
    coordinatorSessionId: 'lead', storageRoot: '/materials', lifecycle: 'ready', paused: true, holdSourceMessageId: '', diagnostics: [], creationRequestId: 'create', createdAt: 1, updatedAt: 2 };
  const versions = [1, 2].map(revision => ({ revision, title: 'Original goal', goal: `Original goal revision ${revision}`, constraints: ['Keep existing work'], conditions: ['Verify the result'], scope: 'worker', writePaths: [],
    source: { sessionId: 'lead', messageId: `human-${revision}`, messageIds: [`human-${revision}`], callId: `accept-${revision}`, authorizationCallId: `accept-${revision}`, text: `Original input ${revision}`, requestId: '', requestRevision: revision }, at: revision }));
  const request = { id: '', projectId: 'project', title: 'Original goal', revision: 2, versions, queue: { state: 'active', order: 1 }, createdAt: 1, updatedAt: 2 };
  const workstreams = versions.map(version => {
    const revision = version.revision, ref = `delegation-${revision}`, runId = `run-${revision}`;
    const report = { delegationRef: ref, outcome: 'completed', summary: `Original report ${revision}`, artifacts: [{ path: `result-${revision}.md`, size: 10, sha256: `recorded-artifact-${revision}`, type: 'file' }], evidence: ['Recorded observation'], remainingIssues: [], at: 3, callId: `report-${revision}` };
    return { id: `work-${revision}`, projectId: 'project', title: `Saved work ${revision}`, brief: 'Original assignment', status: 'done', workerSessionId: `worker-${revision}`, blockedReason: '', currentDelegationRef: ref,
      delegations: [{ ref, source: { ...version.source, callId: `delegate-${revision}` }, brief: 'Original assignment', scope: 'readonly', writePaths: [], phase: 'accepted', messageId: `assignment-${revision}`, runId, error: '', createdAt: 2, report }], latestReport: report,
      settlements: [{ runId, delegationRefs: [ref], stopReason: 'completed', summary: 'Original native settlement', at: 4, merged: false, noticeMessageId: `notice-${revision}`, summarizedBy: 'reply' }],
      pendingSummary: false, archived: false, createdAt: 1, updatedAt: 4 };
  });
  workstreams[1].replaces = { workstreamId: 'work-1', delegationRef: 'delegation-1', requestId: '', requestRevision: 2, reason: 'Original replacement reason' };
  const workers = [1, 2].map(revision => ({ sessionId: `worker-${revision}`, projectId: 'project', workstreamId: `work-${revision}`, cwd: '/repository', role: 'readonly', mode: 'existing', phase: 'idle', directoryHeld: false, stopped: true, materialized: true, writePaths: [], consumedDelegationRef: `delegation-${revision}`, error: '', updatedAt: 4 }));
  const delivery = { id: 'delivery', projectId: 'project', requestId: '', requestRevision: 2, title: 'Original delivery', summary: 'Original conclusion', outcome: 'partial', evidence: ['Original evidence'], remainingIssues: ['Original remaining issue'],
    reportRefs: [{ workstreamId: 'work-2', delegationRef: 'delegation-2', reportId: 'report-2' }], terminalRefs: [{ workstreamId: 'work-2', delegationRef: 'delegation-2', runId: 'run-2' }],
    requiredDelegations: [{ workstreamId: 'work-2', delegationRef: 'delegation-2', runId: 'run-2' }], declaredCallId: 'deliver', sessionId: 'lead', turn: 2, status: 'delivered', replyMessageId: 'reply', at: 5 };
  return { version: 2, revision: 7, projects: [project, { ...project, id: 'other-project', coordinatorSessionId: 'other-lead', paused: false }], workstreams, workers, requests: [request], deliveries: [delivery] };
}

test('empty requirement recovery preserves the complete identity graph, authority, reports and pause state', () => {
  const before = catalog(), original = structuredClone(before), result = schema.parse(before), expected = structuredClone(before);
  const id = requestIdForCall('lead', 'accept-1'), row = expected.requests[0];
  row.id = id; row.identityRecovery = { originalId: '', sessionId: 'lead', callId: 'accept-1' };
  for (const version of row.versions) version.source.requestId = id;
  for (const work of expected.workstreams) for (const receipt of work.delegations) receipt.source.requestId = id;
  expected.workstreams[1].replaces.requestId = id; expected.deliveries[0].requestId = id;
  assert.deepEqual(result, expected);
  assert.deepEqual(before, original, 'reading or rejecting a catalog never mutates the supplied records');
  assert.deepEqual(schema.parse(result), result, 'persisted recovery is stable on the next cold read');
});

test('recovery resolves original delegations before replacement links regardless of array order', () => {
  const before = catalog(); before.workstreams.reverse();
  const result = schema.parse(before);
  assert.equal(result.workstreams[0].replaces.requestId, result.requests[0].id);
});

test('ambiguous empty identities and mismatching references remain rejected without modifying history', () => {
  const cases = [
    value => value.requests.push(structuredClone(value.requests[0])),
    value => { value.requests[0].versions[1].source.sessionId = 'foreign-lead'; },
    value => { value.workstreams[0].delegations[0].source.authorizationCallId = 'unrelated-authorization'; },
    value => { value.workstreams[0].delegations[0].source.messageId = 'unrelated-human'; },
    value => { value.workstreams[0].delegations[0].source.requestRevision = 3; },
    value => { value.workstreams[0].projectId = 'other-project'; },
    value => { value.workstreams[1].replaces.delegationRef = 'missing-delegation'; },
    value => { value.deliveries[0].sessionId = 'foreign-lead'; },
    value => { value.requests.push({ ...structuredClone(value.requests[0]), id: requestIdForCall('lead', 'accept-1') }); },
  ];
  for (const mutate of cases) {
    const before = catalog(); mutate(before); const original = structuredClone(before), parsed = schema.safeParse(before);
    assert.equal(parsed.success, false);
    assert.match(parsed.error.issues[0].message, /catalog needs review/);
    assert.deepEqual(before, original);
  }
});

test('recovery leaves unrelated schema violations and unsupported empty identities rejected', () => {
  const before = catalog(); before.projects[0].title = 42;
  const parsed = schema.safeParse(before);
  assert.equal(parsed.success, false); assert.ok(parsed.error.issues.some(issue => issue.path.join('.') === 'projects.0.title'));
  const whitespace = catalog(); whitespace.requests[0].id = ' ';
  assert.equal(schema.safeParse(whitespace).success, false, 'blank source references are not repaired without the exact known empty-row pattern');
  const legacy = catalog(); legacy.version = 1;
  assert.equal(schema.safeParse(legacy).success, false, 'this v2 repair does not reinterpret a different historical format');
});
