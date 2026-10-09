/** Project task identity owns admission; native ApprovalService owns every decision and audit. */
export class ProjectApprovals {
  constructor(service) {
    this.service = service;
    this.accepted = new Map();
    this.routes = new Map();
  }
  get native() { return this.service.ctx.get('approval'); }

  /** Only the current human-authored Lead turn can enable asking for a new assignment. */
  requested(actor, source, scope) {
    if (scope !== 'worker' || this.native?.policyOf(actor.agent.session) !== 'ask') return false;
    const events = actor.agent.session.snapshotEvents();
    const call = events.findLast(event => event.type === 'tool/call' && event.data.callId === source.callId);
    const start = call && events.findLast(event => event.type === 'turn/start' && event.data.turn === call.data.turn);
    return Boolean(call && start && events.some(event => event.type === 'user/message' && event.seq > start.seq && event.seq < call.seq
      && event.data.id === source.messageId && event.data.source.kind === 'user'));
  }

  /** A resident never member must drain before a new turn can assemble ask context. */
  needsDrain(actor, source, scope, worker) {
    const agent = this.service.ctx.agents.get(worker.sessionId);
    if (!agent || !this.requested(actor, source, scope)) return false;
    const policy = agent.session.snapshotEvents().findLast(event => event.type === 'approval/policy');
    return policy?.data.source === 'delegation' && policy.data.policy === 'never';
  }

  accept(actor, source, receipt, workerId) {
    this.accepted.delete(workerId);
    if (this.requested(actor, source, receipt.scope)) this.accepted.set(workerId, receipt.ref);
  }

  /** Runs in the native serial agent/created hook, before context assembly or inbox release. */
  created(agent) {
    const service = this.service, worker = service.state().workers.find(item => item.sessionId === agent.id);
    if (!worker) return;
    const work = service.stream(worker.workstreamId), ref = this.accepted.get(worker.sessionId);
    if (!ref || work.currentDelegationRef !== ref) return;
    this.accepted.delete(worker.sessionId);
    const project = service.project(worker.projectId), owner = service.ctx.agents.get(project.coordinatorSessionId);
    const receipt = work.delegations.find(item => item.ref === ref);
    if (owner && receipt?.scope === 'worker' && !service.closing && !service.recovering && !worker.stopped
      && !service.held.has(worker.sessionId) && !service.projectHolds.has(project.id) && !project.paused
      && project.lifecycle === 'ready' && !service.archiving.has(project.id)) this.native?.enableDelegatedRequests(agent, owner);
  }

  /** Bind presentation to the consumed assignment, not a queued replacement or a peer's claim. */
  bind(agent) {
    const service = this.service, worker = service.worker(agent.id), work = service.stream(worker.workstreamId);
    const project = service.project(worker.projectId), owner = service.ctx.agents.get(project.coordinatorSessionId);
    const ref = worker.consumedDelegationRef, runId = worker.activeRunId;
    if (!owner || !runId || worker.role !== 'worker' || !ref || !this.native) { this.clear(agent.id); return; }
    const previous = this.routes.get(agent.id);
    if (previous?.agent === agent && previous.ref === ref && previous.runId === runId && previous.owner === owner) return;
    previous?.dispose();
    const dispose = this.native.bindDelegatedRequester(agent, { owner, label: work.title, validate: () => {
      const member = service.worker(agent.id), current = service.stream(member.workstreamId), row = service.project(member.projectId);
      const receipt = current.delegations.find(item => item.ref === ref);
      return !service.closing && !service.recovering && service.ctx.agents.get(agent.id) === agent
        && service.ctx.agents.get(owner.id) === owner && row.coordinatorSessionId === owner.id
        && row.lifecycle === 'ready' && !row.paused && !service.archiving.has(row.id) && !service.projectHolds.has(row.id)
        && !service.held.has(agent.id) && !member.stopped && member.role === 'worker'
        && member.activeRunId === runId && member.consumedDelegationRef === ref
        && receipt?.scope === 'worker' && receipt.runId === runId && !receipt.report;
    } });
    this.routes.set(agent.id, { agent, owner, ref, runId, dispose });
  }

  release(workerId) {
    this.routes.get(workerId)?.dispose();
    this.routes.delete(workerId);
  }
  clear(workerId) { this.accepted.delete(workerId); this.release(workerId); }
  dispose() {
    for (const id of this.routes.keys()) this.clear(id);
    this.accepted.clear();
  }
}
