/** Request authority and explicit delivery over the original Lead's durable events. */
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const text = value => (value.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const strings = (value, label) => { if (!Array.isArray(value) || value.length > 64 || value.some(item => typeof item !== 'string' || Buffer.byteLength(item) > 32000)) fail('request_fields', `Invalid ${label}.`); return value; };
export class ProjectRequirements {
  constructor(service) { this.service = service; }
  get(id, projectId) { const request = this.service.state().requests?.find(row => row.id === id && row.projectId === projectId); if (!request) fail('request_missing', 'The requirement does not belong to this Project.'); return request; }
  current(request) { return request.versions.find(version => version.version === request.currentVersion); }
  call(actor, exec) {
    const events = actor.agent.session.snapshotEvents(), call = events.findLast(event => event.type === 'tool/call' && event.data.callId === (exec.rootCallId ?? exec.callId));
    if (!call) fail('unauthorized', 'The actual Lead tool call is missing.');
    const start = events.findLast(event => event.type === 'turn/start' && event.data.turn === call.data.turn);
    return { call, inputs: events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user' && event.seq < call.seq && (!start || event.seq > start.seq)).map(event => ({ messageId: event.data.id, text: text(event.data) })) };
  }
  source(actor, exec, requestId) {
    const service = this.service, request = this.get(requestId, actor.project.id), version = this.current(request);
    this.call(actor, exec);
    const events = actor.agent.session.snapshotEvents();
    if (!version.inputs.length || version.inputs.some(input => !events.some(event => event.type === 'user/message' && event.data.source.kind === 'user' && event.data.id === input.messageId && text(event.data) === input.text))) fail('unauthorized', 'The requirement has no matching original human authorization.');
    const input = version.inputs.at(-1);
    if (service.project(actor.project.id).paused || service.projectHolds.has(actor.project.id)) {
      const fresh = this.call(actor, exec).inputs;
      if (!fresh.some(row => version.inputs.some(source => source.messageId === row.messageId) && row.messageId !== service.project(actor.project.id).holdSourceMessageId)) fail('stopped', 'Stopped requirements need a new actual user continuation.');
    }
    const prior = request.versions.find(row => row.version === version.version - 1), changes = version.inputs.filter(row => !prior?.inputs.some(old => old.messageId === row.messageId));
    return { sessionId: actor.agent.id, messageId: input.messageId, callId: exec.callId, text: changes.map(row => row.text).join('\n\n'), inputs: version.inputs, requestId, requestVersion: version.version };
  }
  async accept(actor, args, exec) {
    const service = this.service; service.coordinatorOnly(actor); exec.signal.throwIfAborted();
    const { inputs } = this.call(actor, exec), ids = args.messageIds ?? inputs.map(input => input.messageId);
    if (!Array.isArray(ids) || !ids.length || ids.length > 64 || ids.some(id => !inputs.some(input => input.messageId === id))) fail('unauthorized', 'A requirement must reference actual human inputs consumed by this Lead turn.');
    const selected = inputs.filter(input => ids.includes(input.messageId)), authorization = { development: 'worker', readonly: 'readonly', docs: 'docs' }[args.authorization];
    if (!authorization || typeof args.goal !== 'string' || !args.goal.trim() || Buffer.byteLength(args.goal) > 32000) fail('request_fields', 'Supply a goal and its actual authorization ceiling.');
    const criteria = strings(args.criteria ?? [], 'completion criteria'), constraints = strings(args.constraints ?? [], 'constraints'), writePaths = strings(args.writePaths ?? [], 'document paths');
    if (writePaths.some(path => !path || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git') || !/\.(md|mdx|txt|rst|adoc)$/i.test(path))) fail('request_fields', 'Document authority requires exact safe repository-relative document paths.');
    const priorCall = service.state().requests?.find(row => row.projectId === actor.project.id && row.versions.some(version => version.callId === exec.callId));
    const id = args.requestId ?? priorCall?.id ?? `request-${randomUUID()}`;
    await service.serial(async () => {
      const project = service.project(actor.project.id); if (project.lifecycle !== 'ready' || service.archiving.has(project.id)) fail('archived', 'Restore this Project before accepting work.');
      const prior = args.requestId || priorCall ? this.get(id, project.id) : undefined;
      const replay = prior?.versions.find(version => version.callId === exec.callId); if (replay) return;
      const previous = prior && this.current(prior), version = (prior?.currentVersion ?? 0) + 1;
      const record = { version, goal: args.goal.trim(), criteria, constraints, authorization, writePaths, inputs: [...(previous?.inputs ?? []), ...selected.filter(input => !previous?.inputs.some(old => old.messageId === input.messageId))], requiredWork: structuredClone(previous?.requiredWork ?? []), callId: exec.callId, at: Date.now() };
      await service.write(state => { state.requests ??= []; const row = state.requests.find(row => row.id === id); if (row) { row.currentVersion = version; row.versions.push(record); row.updatedAt = record.at; } else state.requests.push({ id, projectId: project.id, currentVersion: version, versions: [record], updatedAt: record.at }); });
    });
    return { request: structuredClone(this.get(id, actor.project.id)) };
  }
  authorize(source, role, paths) {
    if (!source.requestId) return;
    const version = this.current(this.get(source.requestId, this.service.state().projects.find(row => row.coordinatorSessionId === source.sessionId).id));
    if (version.version !== source.requestVersion || version.authorization === 'readonly' && role !== 'readonly' || version.authorization === 'docs' && (role === 'worker' || role === 'docs' && paths.some(path => !version.writePaths.includes(path)))) fail('unauthorized', 'The stage exceeds the current requirement authorization.');
  }
  bind(state, receipt, workstreamId) {
    if (!receipt.requestId) return;
    const request = state.requests.find(row => row.id === receipt.requestId), version = this.current(request);
    if (version.version !== receipt.requestVersion) fail('obsolete_request', 'The requirement changed before delegation.');
    version.requiredWork = [...version.requiredWork.filter(row => row.workstreamId !== workstreamId), { workstreamId, delegationRef: receipt.ref }]; request.updatedAt = Date.now();
  }
  references(projectId, refs) {
    if (!Array.isArray(refs) || refs.length > 64) fail('delivery_evidence', 'Supply bounded real result references.');
    return refs.map(ref => {
      const work = this.service.stream(ref.workstreamId, projectId), receipt = work.delegations.find(row => row.ref === ref.delegationRef), terminal = receipt && work.settlements.find(row => row.runId === receipt.runId && row.delegationRefs.includes(receipt.ref));
      if (!terminal || ref.runId && ref.runId !== terminal.runId || ref.reportId && ref.reportId !== receipt.report?.callId) fail('delivery_evidence', 'The result lacks its matching native settlement or report.');
      return { workstreamId: work.id, delegationRef: receipt.ref, runId: terminal.runId, ...(receipt.report ? { reportId: receipt.report.callId } : {}) };
    });
  }
  heads(delivery) {
    return [...new Set([...delivery.requiredWork, ...delivery.references].map(ref => ref.workstreamId))].map(id => {
      const work = this.service.stream(id, delivery.projectId), receipt = work.delegations.find(row => row.ref === work.currentDelegationRef);
      return { workstreamId: id, delegationRef: work.currentDelegationRef, runId: receipt?.runId ?? '', reportId: receipt?.report?.callId ?? '' };
    });
  }
  headsChanged(delivery) { return JSON.stringify(this.heads(delivery)) !== JSON.stringify(delivery.basisHeads); }
  alreadyChanged(delivery) {
    return delivery.references.some(ref => {
      const work = this.service.stream(ref.workstreamId, delivery.projectId), receipt = work.delegations.find(row => row.ref === ref.delegationRef);
      // Earlier phases of this same version form one delivery when its final
      // required assignment is included. Reused evidence from another request
      // still has to be applicable when this delivery is declared.
      return work.currentDelegationRef !== ref.delegationRef && !(receipt?.requestId === delivery.requestId && receipt.requestVersion === delivery.requestVersion
        && delivery.requiredWork.some(row => row.workstreamId === work.id && row.delegationRef === work.currentDelegationRef)
        && delivery.references.some(row => row.workstreamId === work.id && row.delegationRef === work.currentDelegationRef));
    });
  }
  validate(draft, recoveringReply = false) {
    const service = this.service, request = this.get(draft.requestId, draft.projectId), version = this.current(request);
    const project = service.project(draft.projectId);
    if (!recoveringReply && (project.lifecycle !== 'ready' || service.archiving.has(project.id) || service.projectHolds.has(project.id))) fail('delivery_stopped', 'Project stopping or archive admission prevents this delivery.');
    if (!recoveringReply && project.paused) {
      const events = service.ctx.agents.get(draft.sessionId)?.session.snapshotEvents() ?? [], start = events.findLast(row => row.type === 'turn/start' && row.data.turn === draft.turn);
      if (!events.some(row => row.type === 'user/message' && row.data.source.kind === 'user' && row.seq > (start?.seq ?? -1) && row.seq < draft.callSeq && row.data.id !== project.holdSourceMessageId)) fail('delivery_stopped', 'Stopped results need a new actual user request to summarize.');
    }
    if (version.version !== draft.requestVersion || JSON.stringify(version.requiredWork) !== JSON.stringify(draft.requiredWork)) fail('obsolete_delivery', 'The requirement or its necessary work changed; declare the delivery again.');
    if (draft.basisHeads && this.headsChanged(draft)) fail('obsolete_delivery', 'The referenced execution changed after declaration; declare the delivery again.');
    this.references(draft.projectId, draft.references);
    if (draft.outcome === 'completed') {
      if (draft.remainingIssues.length) fail('delivery_incomplete', 'A complete delivery cannot retain unmet requirements.');
      for (const ref of version.requiredWork) {
        const work = service.stream(ref.workstreamId, draft.projectId), worker = service.worker(work.workerSessionId), receipt = work.delegations.find(row => row.ref === ref.delegationRef);
        const terminal = work.settlements.find(row => row.runId === receipt?.runId && row.delegationRefs.includes(receipt?.ref));
        if (!draft.references.some(row => row.workstreamId === ref.workstreamId && row.delegationRef === ref.delegationRef) || work.currentDelegationRef !== ref.delegationRef || receipt?.report?.outcome !== 'completed' || terminal?.stopReason !== 'completed' || service.prerequisiteStatus(receipt.report, draft.projectId).prerequisitesChanged || worker.activeRunId || service.jobs(worker.sessionId).length || ['queued', 'preparing'].includes(receipt.phase)) fail('delivery_incomplete', 'Necessary current work has not completed and settled with applicable evidence.');
      }
    }
  }
  async declare(actor, args, exec) {
    const service = this.service; service.coordinatorOnly(actor); const { call } = this.call(actor, exec), request = this.get(args.requestId, actor.project.id), version = this.current(request);
    if (args.requestVersion !== version.version || !['completed', 'blocked', 'failed', 'partial'].includes(args.outcome) || typeof args.summary !== 'string' || !args.summary.trim() || Buffer.byteLength(args.summary) > 32000) fail('delivery_fields', 'Supply the exact requirement version, outcome and conclusion.');
    const draft = { id: `${actor.agent.id}:${exec.callId}`, projectId: actor.project.id, requestId: request.id, requestVersion: version.version, outcome: args.outcome, summary: args.summary.trim(), evidence: strings(args.evidence ?? [], 'verification'), remainingIssues: strings(args.remainingIssues ?? [], 'remaining requirements'), references: this.references(actor.project.id, args.references ?? []), requiredWork: structuredClone(version.requiredWork), sessionId: actor.agent.id, turn: call.data.turn, callId: exec.callId, callSeq: call.seq, at: Date.now() };
    await service.serial(async () => { draft.basisHeads = this.heads(draft); draft.basisAlreadyChanged = this.alreadyChanged(draft); this.validate(draft); await service.write(state => { state.deliveries ??= []; if (!state.deliveries.some(row => row.id === draft.id)) { for (const prior of state.deliveries) if (prior.sessionId === draft.sessionId && prior.turn === draft.turn && prior.requestId === draft.requestId && !prior.committedAt) prior.supersededBy = draft.id; state.deliveries.push(draft); } }); });
    return { declared: true, deliveryId: draft.id, instruction: 'Now reply visibly with the conclusion, actual results, verification and remaining issues. Delivery binds only after this turn completes and its actual reply is durably flushed.' };
  }
  async event(session, event, recoveringReply = false) {
    const service = this.service, drafts = () => (service.state().deliveries ?? []).filter(row => row.sessionId === session.id && row.turn === event.data.turn && !row.committedAt && !row.supersededBy);
    if (!drafts().length) return;
    if (event.type === 'assistant/message' && !event.data.interrupted && !event.data.message.content?.some(block => block.type === 'tool-call') && text(event.data.message)) {
      await service.serial(() => service.write(state => { for (const row of state.deliveries) if (row.sessionId === session.id && row.turn === event.data.turn && !row.committedAt && event.seq > row.callSeq) row.messageId = event.data.message.id; })); return;
    }
    if (event.type !== 'turn/end') return;
    await service.serial(async () => {
      for (const draft of drafts()) try {
        if (event.data.reason.kind !== 'completed') fail('delivery_reply', 'The declared delivery turn did not complete.');
        const reply = session.snapshotEvents().find(row => row.type === 'assistant/message' && row.data.turn === draft.turn && row.data.message.id === draft.messageId && row.seq > draft.callSeq && !row.data.interrupted && text(row.data.message));
        if (!reply) fail('delivery_reply', 'The declared delivery has no actual visible reply.');
        this.validate(draft, recoveringReply); const persisted = await service.ctx.sessions.flush(session);
        if (persisted !== true) fail('delivery_persistence', 'No persistent Session listener confirmed this actual reply.');
        this.validate(draft, recoveringReply);
        await service.write(state => {
          const saved = state.deliveries.find(row => row.id === draft.id); saved.committedAt = Date.now(); delete saved.error;
          for (const ref of saved.references) {
            const work = state.workstreams.find(row => row.id === ref.workstreamId), receipt = work.delegations.find(row => row.ref === ref.delegationRef), terminal = work.settlements.find(row => row.runId === ref.runId);
            terminal.summarizedBy = saved.messageId; if (receipt.report) receipt.report.summarizedBy = saved.messageId;
            if (work.latestReport?.delegationRef === receipt.ref) work.latestReport.summarizedBy = saved.messageId;
            if (work.summaryFailure?.delegationRef === receipt.ref) delete work.summaryFailure;
            work.pendingSummary = work.settlements.some(row => !row.summarizedBy) || work.delegations.some(row => row.report && !row.report.summarizedBy);
          }
        });
      } catch (error) { await service.write(state => { state.deliveries.find(row => row.id === draft.id).error = error.message; }); }
    });
  }
  async reconcile(session) {
    const events = session.snapshotEvents();
    for (const draft of (this.service.state().deliveries ?? []).filter(row => row.sessionId === session.id && !row.committedAt && !row.supersededBy)) {
      const end = events.find(row => row.type === 'turn/end' && row.data.turn === draft.turn);
      if (!end) continue;
      const reply = events.findLast(row => row.type === 'assistant/message' && row.data.turn === draft.turn && row.seq > draft.callSeq && row.seq < end.seq && !row.data.interrupted && !row.data.message.content.some(block => block.type === 'tool-call') && text(row.data.message));
      if (reply) await this.event(session, reply, true);
      await this.event(session, end, true);
    }
  }
  deliveryView(delivery) {
    const request = this.get(delivery.requestId, delivery.projectId), version = request.versions.find(row => row.version === delivery.requestVersion);
    const reports = delivery.references.flatMap(ref => { const work = this.service.stream(ref.workstreamId, delivery.projectId), report = work.delegations.find(row => row.ref === ref.delegationRef)?.report; return report ? [{ workstreamId: work.id, title: work.title, report: this.service.reportView(report, delivery.projectId) }] : []; });
    const changedReference = ref => {
      const work = this.service.stream(ref.workstreamId, delivery.projectId), receipt = work.delegations.find(row => row.ref === ref.delegationRef);
      return !delivery.basisHeads && work.currentDelegationRef !== ref.delegationRef || ref.runId && receipt?.runId !== ref.runId || ref.reportId && receipt?.report?.callId !== ref.reportId;
    };
    return { ...delivery, title: version.goal, current: request.currentVersion === delivery.requestVersion, needsReview: request.currentVersion !== delivery.requestVersion || delivery.basisAlreadyChanged === true || delivery.basisHeads && this.headsChanged(delivery) || [...delivery.requiredWork, ...delivery.references].some(changedReference) || reports.some(row => row.report.prerequisitesChanged), reports };
  }
  views(projectId) {
    return (this.service.state().requests ?? []).filter(row => row.projectId === projectId).toSorted((a, b) => b.updatedAt - a.updatedAt).map(request => { const current = this.current(request), delivery = this.service.state().deliveries?.findLast(row => row.requestId === request.id && row.requestVersion === current.version && row.committedAt); return { id: request.id, version: current.version, goal: current.goal.slice(0, 500), requiredWork: current.requiredWork, delivery: delivery ? { id: delivery.id, outcome: delivery.outcome, messageId: delivery.messageId, remainingIssues: delivery.remainingIssues, needsReview: this.deliveryView(delivery).needsReview } : null }; });
  }
  read(projectId, args = {}) {
    if (args.requestId) {
      const request = this.get(args.requestId, projectId), number = args.version ?? request.currentVersion, version = request.versions.find(row => row.version === number);
      if (!version) fail('request_version', 'This requirement version does not exist.');
      const offset = Math.max(0, Number(args.cursor) || 0), inputs = version.inputs.slice(offset, offset + 20);
      return { requestId: request.id, currentVersion: request.currentVersion, version: { ...version, inputs }, inputsTotal: version.inputs.length, nextCursor: offset + inputs.length < version.inputs.length ? String(offset + inputs.length) : null, previousVersion: number > 1 ? number - 1 : null };
    }
    const rows = this.views(projectId).filter(row => !args.query || row.goal.toLowerCase().includes(args.query.toLowerCase())), offset = Math.max(0, Number(args.cursor) || 0), items = rows.slice(offset, offset + 20);
    return { items, total: rows.length, hasMore: offset + items.length < rows.length, nextCursor: offset + items.length < rows.length ? String(offset + items.length) : null };
  }
}
