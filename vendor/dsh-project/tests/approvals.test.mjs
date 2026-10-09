import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectApprovals } from '../lib/approvals.js';

function setup() {
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'user/message', data: { id: 'human', source: { kind: 'user' } } },
    { seq: 2, type: 'tool/call', data: { turn: 1, callId: 'delegate' } },
  ];
  const owner = { id: 'lead', session: { snapshotEvents: () => events } }, agent = { id: 'member' };
  const source = { messageId: 'human', callId: 'delegate' };
  const receipt = { ref: 'r1', scope: 'worker', runId: 'run1', source };
  const work = { id: 'work', title: 'Build task', currentDelegationRef: 'r1', delegations: [receipt] };
  const member = { sessionId: 'member', projectId: 'project', workstreamId: 'work', role: 'worker', activeRunId: 'run1', consumedDelegationRef: 'r1' };
  const project = { id: 'project', coordinatorSessionId: 'lead', lifecycle: 'ready', paused: false };
  let policy = 'ask'; const enabled = [], bound = [];
  const native = { policyOf: () => policy, enableDelegatedRequests: (...args) => enabled.push(args), bindDelegatedRequester(_agent, route) {
    const binding = { ...route, disposed: false }; bound.push(binding); return () => { binding.disposed = true; };
  } };
  const service = { closing: false, recovering: false, held: new Set(), projectHolds: new Map(), archiving: new Set(),
    ctx: { get: () => native, agents: { get: id => id === 'lead' ? owner : id === 'member' ? agent : undefined } },
    state: () => ({ workers: [member] }), stream: () => work, worker: () => member, project: () => project };
  return { approvals: new ProjectApprovals(service), service, actor: { agent: owner }, agent, owner, source, receipt, work, member, project, events, enabled, bound, setPolicy(value) { policy = value; } };
}

test('only a newly accepted human development assignment enables asking before creation is released', () => {
  const f = setup();
  f.approvals.created(f.agent);
  assert.equal(f.enabled.length, 0, 'startup does not adopt old never');
  f.approvals.accept(f.actor, f.source, f.receipt, f.agent.id);
  f.approvals.created(f.agent);
  assert.deepEqual(f.enabled, [[f.agent, f.owner]]);
  f.approvals.created(f.agent);
  assert.equal(f.enabled.length, 1, 'admission is consumed once');
  f.events.push({ seq: 3, type: 'turn/start', data: { turn: 2 } },
    { seq: 4, type: 'user/message', data: { id: 'notice', source: { kind: 'subagent-settled' } } },
    { seq: 5, type: 'tool/call', data: { turn: 2, callId: 'followup' } });
  f.approvals.accept(f.actor, { ...f.source, callId: 'followup' }, f.receipt, f.agent.id);
  f.approvals.created(f.agent);
  assert.equal(f.enabled.length, 1, 'a notice borrowing the old source cannot enable asking');
});

test('readonly, docs, never and recovering do not enable requests', () => {
  for (const scope of ['readonly', 'docs']) {
    const f = setup(); f.approvals.accept(f.actor, f.source, { ...f.receipt, scope }, f.agent.id); f.approvals.created(f.agent);
    assert.equal(f.enabled.length, 0);
  }
  const f = setup(); f.setPolicy('never'); f.approvals.accept(f.actor, f.source, f.receipt, f.agent.id); f.approvals.created(f.agent);
  assert.equal(f.enabled.length, 0);
  f.setPolicy('ask'); f.approvals.accept(f.actor, f.source, f.receipt, f.agent.id); f.service.recovering = true; f.approvals.created(f.agent);
  assert.equal(f.enabled.length, 0);
});

test('queued followup preserves the consumed run; consumption, stop and archive revoke its approval route', () => {
  const f = setup(); f.approvals.bind(f.agent);
  const original = f.bound[0]; assert.equal(original.validate(), true);
  f.work.currentDelegationRef = 'r2';
  f.work.delegations.push({ ...f.receipt, ref: 'r2' });
  f.approvals.accept(f.actor, f.source, f.work.delegations[1], f.agent.id);
  f.approvals.bind(f.agent);
  assert.equal(original.disposed, false); assert.equal(original.validate(), true);
  f.member.consumedDelegationRef = 'r2'; f.approvals.bind(f.agent);
  assert.equal(original.disposed, true); assert.equal(original.validate(), false);
  const current = f.bound[1]; assert.equal(current.validate(), true);
  f.service.archiving.add('project'); assert.equal(current.validate(), false); f.service.archiving.clear();
  f.approvals.clear(f.agent.id); assert.equal(current.disposed, true);
});
