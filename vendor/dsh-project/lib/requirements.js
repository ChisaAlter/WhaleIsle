/** User goals and handover records; native Team/Session retain execution ownership. */
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const text = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const latest = work => work.delegations.find(item => item.ref === work.currentDelegationRef);
const scope = value => ({ readonly: 'readonly', docs: 'docs', development: 'worker', worker: 'worker' })[value];
const string = (value, label, limit = 32000) => { if (typeof value !== 'string' || !value.trim() || value.length > limit) fail('invalid_request', `Invalid ${label}.`); return value.trim(); };
const strings = (value = []) => { if (!Array.isArray(value) || value.length > 64 || value.some(item => typeof item !== 'string' || item.length > 8000)) fail('invalid_request', 'Expected bounded text items.'); return [...new Set(value)]; };
const stableId = (kind, callId) => `${kind}-${createHash('sha256').update(callId).digest('hex')}`;

export class ProjectRequirements {
  constructor(service) { this.service = service; }
  publishedPages(events, sessionId, turn) {
    const start = events.findLast(event => event.type === 'turn/start' && event.data.turn === turn);
    if (!start) return [];
    const calls = new Map(events.filter(event => event.type === 'tool/call' && event.data.turn === turn).map(event => [event.data.callId, event]));
    const pages = [];
    for (const event of events) {
      if (event.seq <= start.seq) continue;
      let callId, content, presentation;
      if (event.type === 'tool/result') {
        const message = event.data.message, call = calls.get(message.toolCallId);
        if (call?.data.name !== 'html_render' || event.data.turn !== turn || message.isError || event.data.error) continue;
        const meta = event.data.meta?.visualReply;
        if (meta?.version !== 1) continue;
        callId = message.toolCallId; content = message.content; presentation = meta;
      } else if (event.type === 'tool/ptc-dispatch') {
        const value = event.data;
        if (value.name !== 'html_render' || value.isError || value.error || !calls.has(value.rootCallId)) continue;
        callId = value.subCallId; content = value.content; presentation = value.arguments;
      } else continue;
      if (!Array.isArray(content) || content.some(part => part.type !== 'text' && part.type !== 'file')) continue;
      const files = content.filter(part => part.type === 'file'), file = files[0]?.attachment, height = presentation?.height ?? 480;
      if (files.length !== 1 || typeof callId !== 'string' || !callId || typeof file?.attachmentId !== 'string' || !file.attachmentId
        || typeof file.name !== 'string' || !file.name.endsWith('.html') || !Number.isInteger(file.bytes) || file.bytes <= 0
        || typeof presentation?.title !== 'string' || !presentation.title.trim() || !Number.isInteger(height) || height < 80 || height > 2000) continue;
      if (!pages.some(page => page.callId === callId)) pages.push({ sessionId, callId,
        file: { attachmentId: file.attachmentId, name: file.name, bytes: file.bytes }, title: presentation.title, height });
    }
    return pages;
  }
  rows(projectId) { return (this.service.state().requests ?? []).filter(item => item.projectId === projectId); }
  get(projectId, id, revision) {
    const row = this.rows(projectId).find(item => item.id === id);
    if (!row || revision !== undefined && row.revision !== revision) fail('request_changed', 'The requirement is missing or has changed. Read its current version.');
    return row;
  }
  version(row) { return row.versions.find(item => item.revision === row.revision); }
  inputs(actor, exec) {
    const events = actor.agent.session.snapshotEvents(), call = events.findLast(event => event.type === 'tool/call' && event.data.callId === (exec.rootCallId ?? exec.callId));
    if (!call) fail('unauthorized', 'No corresponding coordinator tool call exists.');
    const start = events.findLast(event => event.type === 'turn/start' && event.data.turn === call.data.turn);
    const messages = events.filter(event => event.type === 'user/message' && event.seq < call.seq && (!start || event.seq > start.seq));
    return { events, call, messages, human: messages.filter(event => event.data.source.kind === 'user') };
  }
  async accept(actor, args, exec) {
    const service = this.service; service.coordinatorOnly(actor); exec.signal.throwIfAborted();
    const input = this.inputs(actor, exec);
    if (!input.human.length) fail('unauthorized', 'A requirement or authorization revision needs actual human input.');
    const last = input.human.at(-1), ceiling = scope(args.scopeCeiling ?? args.scope), paths = strings(args.writePaths);
    if (!ceiling || paths.some(path => !path || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git')) || ceiling === 'docs' && paths.some(path => !/\.(md|mdx|txt|rst|adoc)$/i.test(path))) fail('invalid_scope', 'Declare the original scope ceiling and exact relative document paths.');
    const goal = string(args.goal, 'goal'), title = string(args.title ?? goal.slice(0, 100), 'title', 240);
    const disposition = args.disposition ?? 'queued';
    if (!['discussing', 'queued'].includes(disposition)) fail('queue_state', 'A requirement is either being discussed or approved for the development queue.');
    const id = args.requestId ?? stableId('request', `${actor.agent.id}:${exec.callId}`);
    await service.serial(async () => {
      const project = service.project(actor.project.id);
      if (service.closing || service.archiving.has(project.id) || project.lifecycle !== 'ready') fail('unavailable', 'Restore this Project before accepting work.');
      const existing = args.requestId ? this.get(project.id, id) : this.rows(project.id).find(item => item.id === id);
      if (existing?.versions.some(item => item.source?.authorizationCallId === exec.callId)) return;
      if (project.holdSourceMessageId === last.data.id || service.projectHolds.get(project.id) === last.data.id) fail('stopped', 'Stopped work needs a new human continuation.');
      exec.signal.throwIfAborted();
      const previous = existing && this.version(existing);
      const previousInputs = previous?.source?.messageIds ?? previous?.imported035?.inputs.map(item => item.messageId) ?? (previous?.source ? [previous.source.messageId] : []);
      if (previous && !input.human.some(item => !previousInputs.includes(item.data.id))) fail('unauthorized', 'Changing a requirement needs new human input. Its original authorization remains frozen.');
      const now = Date.now(), revision = (existing?.revision ?? 0) + 1;
      const version = { revision, title, goal, constraints: strings(args.constraints), conditions: strings(args.conditions), scope: ceiling, writePaths: paths,
        source: { sessionId: actor.agent.id, messageId: last.data.id, messageIds: input.human.map(item => item.data.id), callId: exec.callId, authorizationCallId: exec.callId,
          text: input.human.map(item => text(item.data)).join('\n\n'), requestId: id, requestRevision: revision }, at: now };
      await service.write(state => {
        state.requests ??= []; state.deliveries ??= [];
        const row = state.requests.find(item => item.id === id);
        if (row) { row.title = title; row.revision = revision; row.versions.push(version); delete row.archivedAt; row.updatedAt = now; service.queue.initialize(state, row, args.disposition ?? row.queue?.state ?? 'queued'); }
        else { const item = { id, projectId: project.id, title, revision, versions: [version], createdAt: now, updatedAt: now }; state.requests.push(item); service.queue.initialize(state, item, disposition); }
        for (const draft of state.deliveries.filter(item => item.requestId === id && item.status === 'draft')) draft.status = 'obsolete';
      });
      service.projectHolds.delete(project.id);
    });
    if (!service.project(actor.project.id).paused && !service.queue.active(actor.project.id) && service.queue.pending(actor.project.id).length) service.schedule();
    return this.view(this.get(actor.project.id, id));
  }
  view(row) {
    const version = this.version(row);
    const handover = (this.service.state().deliveries ?? []).findLast(item => item.requestId === row.id && item.requestRevision === row.revision);
    return { id: row.id, title: row.title, revision: row.revision, queue: this.service.queue.view(row), goal: version.goal, constraints: version.constraints, conditions: version.conditions, scopeCeiling: version.scope, writePaths: version.writePaths,
      ...(version.authorityError ? { authorityError: version.authorityError } : {}),
      ...(handover?.status !== 'delivered' && handover?.error ? { handoverError: handover.error } : {}),
      requiredWork: this.manifest(row).map(reference => {
        const work = this.service.stream(reference.workstreamId), receipt = work.delegations.find(item => item.ref === reference.delegationRef);
        const terminal = work.settlements.find(item => item.runId === reference.runId && item.delegationRefs.includes(reference.delegationRef));
        return { ...reference, title: work.title, requestRevision: receipt.source.requestRevision, currentDelegationRef: work.currentDelegationRef, phase: receipt.phase,
          error: receipt.error, hasReport: Boolean(receipt.report), at: receipt.report?.at ?? terminal?.at ?? receipt.createdAt,
          ...(receipt.report ? { reportId: receipt.report.callId, outcome: receipt.report.outcome } : {}),
          ...(terminal ? { stopReason: terminal.stopReason } : {}) };
      }) };
  }
  async assignment(actor, args, exec, work) {
    const input = this.inputs(actor, exec), service = this.service;
    let row = args.requestId ? this.get(actor.project.id, args.requestId, args.requestRevision) : undefined;
    if (!row && input.human.length) {
      const ids = input.human.map(item => item.data.id);
      const declared = this.rows(actor.project.id).filter(item => {
        const version = this.version(item), source = version.source; return !version.authorityError && source?.messageIds?.length === ids.length && ids.every(id => source.messageIds.includes(id));
      });
      if (declared.length === 1) row = declared[0];
      else {
        // Existing tool clients keep their direct-human delegation contract.
        // The Lead declares a whole-goal ceiling explicitly for multi-stage work.
        const previousId = work && latest(work).source.requestId;
        const accepted = await this.accept(actor, { requestId: previousId, goal: args.brief, title: work?.title ?? args.title,
          scopeCeiling: args.scope, writePaths: args.writePaths }, exec);
        row = this.get(actor.project.id, accepted.id);
      }
    }
    if (!row && work && latest(work).source.requestId) row = this.get(actor.project.id, latest(work).source.requestId);
    if (!row) fail('request_missing', 'Declare the user requirement before arranging new stages.');
    service.queue.assertActive(row, args.requestRevision ?? row.revision);
    const version = this.version(row);
    if (version.authorityError || !version.source) fail('request_authority', 'The saved requirement has no verified original authorization. Accept a new actual user revision before arranging work.');
    const related = input.messages.some(event => {
        if (event.data.source.kind !== 'subagent-settled') return false;
        const source = event.data.source, original = service.state().workstreams.find(item => item.projectId === actor.project.id && item.workerSessionId === source.senderSessionId);
        const receipt = original && original.delegations.find(item => item.runId === source.runId && item.source.requestId === row.id && item.source.requestRevision === row.revision);
        return receipt && original.currentDelegationRef === receipt.ref && !service.worker(original.workerSessionId).stopped
          && original.settlements.some(item => item.runId === source.runId && item.delegationRefs.includes(receipt.ref));
    });
    // A batch can contain goal A's settlement and an unrelated goal B. A's
    // real notice may advance its frozen authorization without absorbing B.
    const activation = service.queue.authorized(row, input.messages);
    const separateInputs = input.human.length > 0 && input.human.every(event => this.rows(actor.project.id).some(other => other.id !== row.id && this.version(other).source?.messageIds?.includes(event.data.id)));
    if (!related && !activation && !separateInputs && input.human.some(item => !(version.source.messageIds ?? [version.source.messageId]).includes(item.data.id))) fail('request_changed', 'Accept the new human inputs as a requirement revision or a separate discussed requirement before delegating.');
    if (!input.human.length && !related && !activation || (related || activation) && (service.project(actor.project.id).paused || service.projectHolds.has(actor.project.id))) fail('unauthorized', 'This notification cannot advance the selected requirement.');
    const chosen = scope(args.scope), paths = args.writePaths ?? [];
    if (!chosen || version.scope === 'readonly' && chosen !== 'readonly' || version.scope === 'docs' && (chosen === 'worker' || chosen === 'docs' && paths.some(path => !version.writePaths.includes(path)))) fail('unauthorized', 'This stage exceeds the original requirement authorization.');
    return { request: row, source: { ...version.source, callId: exec.callId,
      ...(row.queue?.activation?.resume ? { continuationMessageId: row.queue.activation.messageId } : {}) } };
  }
  associated(work, receipt = latest(work)) { const source = receipt?.source, row = source?.requestId && this.rows(work.projectId).find(item => item.id === source.requestId), version = row?.versions.find(item => item.revision === source.requestRevision); return version ? { id: row.id, title: version.title ?? version.goal.slice(0, 100), revision: version.revision, goal: version.goal } : undefined; }
  async replacement(projectId, args, source) {
    if (!args.replacesWorkstreamId) return;
    if (args.workstreamId) fail('invalid_replacement', 'Continue an existing work or explicitly replace a failed work, not both.');
    const work = this.service.stream(args.replacesWorkstreamId, projectId), receipt = latest(work), worker = this.service.worker(work.workerSessionId);
    const stopGeneration = this.service.workerStops.get(worker.sessionId)?.generation ?? 0;
    if (receipt.source.requestId !== source.requestId || receipt.source.requestRevision > source.requestRevision) fail('invalid_replacement', 'Replacement work must belong to the same user requirement.');
    if (worker.activeRunId || worker.directoryHeld || this.service.jobs(worker.sessionId).length || ['queued', 'preparing'].includes(receipt.phase)) fail('work_pending', 'The original work must really stop and drain before replacement.');
    if (worker.stopped && receipt.source.messageId === source.messageId || this.service.workerStops.get(worker.sessionId)?.sourceMessageId === source.messageId) fail('stopped', 'A replacement cannot bypass a stopped requirement.');
    const terminal = work.settlements.find(item => item.runId === receipt.runId && item.delegationRefs.includes(receipt.ref));
    const missing = worker.materialized && !await this.service.ctx.sessionPersistence.stat(worker.sessionId);
    if ((this.service.workerStops.get(worker.sessionId)?.generation ?? 0) !== stopGeneration) fail('stopped', 'The original work was stopped while its replacement was being prepared.');
    const failed = receipt.phase === 'failed' && receipt.error || terminal && (terminal.stopReason === 'error' || receipt.report && receipt.report.outcome !== 'completed');
    if (!missing && !failed) fail('invalid_replacement', 'Replace only a recorded failure or confirmed missing original Session; normal continuation retains its member.');
    if (this.service.state().workstreams.some(item => item.replaces?.workstreamId === work.id && item.replaces.delegationRef === receipt.ref)) fail('work_replaced', 'This assignment already has a replacement. Continue that actual work instead.');
    return { workstreamId: work.id, delegationRef: receipt.ref, requestId: source.requestId, requestRevision: source.requestRevision, reason: string(args.replacementReason, 'replacement reason', 2000) };
  }
  manifest(row) {
    // Work is continuous: the last assignment for this goal represents its
    // current obligation, including a revision that reuses prior evidence.
    // Moving the member to another goal cannot erase the first goal's work.
    const works = this.service.state().workstreams.filter(work => work.projectId === row.projectId);
    const references = works.flatMap(work => {
      const receipt = work.delegations.findLast(item => item.source.requestId === row.id && item.source.requestRevision <= row.revision);
      return receipt ? [{ workstreamId: work.id, delegationRef: receipt.ref, runId: receipt.runId }] : [];
    });
    return references.filter(reference => !works.some(work => work.replaces?.requestId === row.id && work.replaces.requestRevision <= row.revision
      && work.replaces.workstreamId === reference.workstreamId && work.replaces.delegationRef === reference.delegationRef
      && references.some(item => item.workstreamId === work.id))).sort((a, b) => a.workstreamId.localeCompare(b.workstreamId));
  }
  validReport(projectId, reference, completed) {
    const service = this.service, work = service.stream(reference.workstreamId, projectId), receipt = work.delegations.find(item => item.ref === reference.delegationRef), report = receipt?.report;
    if (!report || reference.reportId && report.callId !== reference.reportId) fail('result_changed', 'This delivery must reference an actual recorded report.');
    const terminal = work.settlements.find(item => item.runId === receipt.runId && item.delegationRefs.includes(receipt.ref));
    if (!terminal || completed && (terminal.stopReason !== 'completed' || report.outcome !== 'completed')) fail('result_unsettled', 'A complete delivery needs successful matching report and native settlement.');
    if (completed && service.prerequisiteStatus(report, projectId).prerequisitesChanged) fail('result_changed', 'The required evidence has changed and must be reassessed.');
    return { workstreamId: work.id, delegationRef: receipt.ref, reportId: report.callId };
  }
  validTerminal(projectId, reference) {
    const work = this.service.stream(reference.workstreamId, projectId), receipt = work.delegations.find(item => item.ref === reference.delegationRef);
    if (!receipt || receipt.runId !== reference.runId || !work.settlements.some(item => item.runId === reference.runId && item.delegationRefs.includes(receipt.ref))) fail('result_unsettled', 'Reference the exact recorded native run and assignment.');
    return { workstreamId: work.id, delegationRef: receipt.ref, runId: receipt.runId };
  }
  validate(draft) {
    const row = this.get(draft.projectId, draft.requestId, draft.requestRevision), service = this.service, current = this.manifest(row);
    service.queue.assertActive(row, draft.requestRevision);
    if (this.version(row).authorityError || !this.version(row).source) fail('request_authority', 'The saved requirement needs a new actual user revision before delivery can be confirmed.');
    if (JSON.stringify(current) !== JSON.stringify(draft.requiredDelegations)) fail('request_changed', 'Required work changed after this handover was declared.');
    for (const reference of draft.reportRefs) this.validReport(row.projectId, reference, draft.outcome === 'completed');
    for (const reference of draft.terminalRefs ?? []) this.validTerminal(row.projectId, reference);
    if (draft.outcome === 'completed') for (const reference of current) {
      const work = service.stream(reference.workstreamId), worker = service.worker(work.workerSessionId), receipt = work.delegations.find(item => item.ref === reference.delegationRef);
      const currentAssignment = work.currentDelegationRef === reference.delegationRef;
      if ((worker.activeRunId && worker.activeRunId === reference.runId) || (currentAssignment && (worker.directoryHeld || service.jobs(worker.sessionId).length)) || ['queued', 'preparing', 'failed', 'stopped'].includes(receipt.phase)) fail('work_pending', 'Required work is still active or has not completed.');
      if (!draft.reportRefs.some(item => item.workstreamId === work.id && item.delegationRef === reference.delegationRef)) fail('result_missing', 'Include each required stage result in the handover.');
      this.validReport(row.projectId, reference, true);
    }
    return row;
  }
  async declare(actor, args, exec) {
    const service = this.service; service.coordinatorOnly(actor); exec.signal.throwIfAborted();
    const input = this.inputs(actor, exec), row = this.get(actor.project.id, args.requestId, args.requestRevision);
    this.service.queue.assertActive(row, args.requestRevision);
    if (!['completed', 'partial'].includes(args.outcome)) fail('invalid_delivery', 'Choose completed or partial.');
    const remainingIssues = strings(args.remainingIssues), evidence = strings(args.evidence);
    if (args.outcome === 'completed' && remainingIssues.length || args.outcome === 'partial' && !remainingIssues.length) fail('invalid_delivery', 'A partial handover must preserve its unmet conditions.');
    if (!Array.isArray(args.reportRefs ?? []) || (args.reportRefs ?? []).length > 64) fail('invalid_delivery', 'Supply exact report references.');
    if (!Array.isArray(args.terminalRefs ?? []) || (args.terminalRefs ?? []).length > 64) fail('invalid_delivery', 'Supply exact terminal references.');
    const draft = { id: stableId('delivery', `${actor.agent.id}:${exec.callId}`), projectId: row.projectId, requestId: row.id, requestRevision: row.revision,
      title: row.title, summary: string(args.summary, 'delivery summary', 16000), outcome: args.outcome, evidence, remainingIssues,
      reportRefs: (args.reportRefs ?? []).map(reference => this.validReport(row.projectId, reference, args.outcome === 'completed')),
      terminalRefs: (args.terminalRefs ?? []).map(reference => this.validTerminal(row.projectId, reference)),
      requiredDelegations: this.manifest(row), declaredCallId: exec.rootCallId ?? exec.callId, sessionId: actor.agent.id, turn: input.call.data.turn, status: 'draft', at: Date.now(),
      ...(typeof args.decision === 'string' && args.decision.trim() ? { decision: args.decision.trim().slice(0, 2000) } : {}) };
    const published = this.publishedPages(input.events, actor.agent.id, draft.turn);
    this.validate(draft);
    await service.serial(async () => { this.validate(draft); await service.write(state => {
      state.deliveries ??= [];
      if (!state.deliveries.some(item => item.id === draft.id)) {
        // Replacing this revision's draft retains its pages; other handovers keep theirs.
        const claimed = new Set(state.deliveries.filter(item => item.sessionId === draft.sessionId && item.turn === draft.turn
          && !(item.requestId === draft.requestId && item.requestRevision === draft.requestRevision && ['draft', 'obsolete'].includes(item.status))).flatMap(item => item.pages ?? []).map(page => page.callId));
        draft.pages = published.filter(page => !claimed.has(page.callId));
        for (const previous of state.deliveries.filter(item => item.requestId === row.id && item.status === 'draft')) previous.status = 'obsolete';
        state.deliveries.push(draft);
      }
    }); });
    return { deliveryId: draft.id, requestId: row.id, requestRevision: row.revision, status: 'draft', instruction: 'Give the user the final result now. The host associates this handover only after the real reply and successful durable turn completion.' };
  }
  async turnEnded(session, event) {
    const drafts = (this.service.state().deliveries ?? []).filter(item => item.sessionId === session.id && item.turn === event.data.turn && item.status === 'draft');
    if (!drafts.length) return;
    if (event.data.reason.kind !== 'completed') { for (const draft of drafts) await this.failed(draft, `The coordinator reply ended ${event.data.reason.kind}; no handover was committed.`); return; }
    // Yield through the existing queue so all Session event listeners enqueue
    // the closer before the native JSONL durability checkpoint drains it.
    try {
      await this.service.serial(async () => {
        if (!await this.service.ctx.sessions.flush(session)) fail('delivery_persistence', 'No native Session persistence confirmed the handover.');
      });
      for (const draft of drafts) await this.commit(session, draft);
    } catch (error) {
      for (const draft of drafts) await this.failed(draft, error.message);
      throw error;
    }
  }
  async failed(draft, error) {
    await this.service.serial(() => this.service.write(state => {
      const row = state.deliveries?.find(item => item.id === draft.id);
      if (row?.status === 'draft') row.error = error;
    }));
  }
  async reconcile(project) {
    const drafts = (this.service.state().deliveries ?? []).filter(item => item.projectId === project.id && item.status === 'draft');
    if (!drafts.length) return;
    // Inspect the stored prefix, including on a hot plugin reload where the
    // attached Session may contain replies that failed to reach persistence.
    const handle = await this.service.ctx.sessionPersistence.open(project.coordinatorSessionId, 'read');
    let events;
    try { events = (await handle.read()).events; } finally { await handle.close(); }
    const session = { id: project.coordinatorSessionId, snapshotEvents: () => events };
    for (const draft of drafts) {
      const end = events.find(event => event.type === 'turn/end' && event.data.turn === draft.turn);
      if (end?.data.reason.kind === 'completed') await this.commit(session, draft, true);
      else await this.failed(draft, 'The stored coordinator turn did not complete a handover. Ask for a summary in the main conversation; saved member results remain available.');
    }
  }
  async commit(session, draft, reconciling = false) {
    const events = session.snapshotEvents(), declaration = events.find(event => event.type === 'tool/call' && event.data.callId === draft.declaredCallId && event.data.turn === draft.turn);
    const accepted = declaration && events.find(event => event.seq > declaration.seq && event.type === 'tool/result' && event.data.turn === draft.turn
      && event.data.message.toolCallId === draft.declaredCallId && !event.data.message.isError && !event.data.error);
    if (!accepted) { await this.failed(draft, 'The handover tool did not finish successfully; its draft was not delivered.'); return; }
    const reply = events.findLast(event => event.seq > accepted.seq && event.type === 'assistant/message' && event.data.turn === draft.turn
      && !event.data.interrupted && !event.data.message.content?.some(block => block.type === 'tool-call') && text(event.data.message).trim());
    if (!reply) { await this.failed(draft, 'No visible final coordinator reply followed the handover declaration.'); return; }
    const publications = new Map(this.publishedPages(events, session.id, draft.turn).map(page => [page.callId, page]));
    let committed = false;
    await this.service.serial(async () => {
      const stored = (this.service.state().deliveries ?? []).find(item => item.id === draft.id); if (stored?.status !== 'draft') return;
      const project = this.service.project(draft.projectId);
      const human = this.service.userTurns.get(session.id), humanSummary = human?.agent.session === session && human.turn === draft.turn;
      if (!reconciling && (project.paused && !humanSummary || project.lifecycle !== 'ready' || this.service.projectHolds.has(project.id) || this.service.archiving.has(project.id))) return;
      try { this.validate(stored); }
      catch (error) { await this.service.write(state => { const item = state.deliveries.find(item => item.id === draft.id); item.status = 'obsolete'; item.error = error.message; }); return; }
      await this.service.write(state => {
        const item = state.deliveries.find(item => item.id === draft.id); item.status = 'delivered'; item.replyMessageId = reply.data.message.id; delete item.error;
        if (item.outcome === 'completed') { const request = state.requests.find(row => row.id === item.requestId); request.queue = { ...(request.queue ?? { state: 'active' }), released: true }; }
        item.pages = (item.pages ?? []).filter(page => JSON.stringify(publications.get(page.callId)) === JSON.stringify(page));
        for (const reference of item.reportRefs) {
          const work = state.workstreams.find(work => work.id === reference.workstreamId), receipt = work.delegations.find(receipt => receipt.ref === reference.delegationRef);
          receipt.report.summarizedBy = item.replyMessageId;
          for (const terminal of work.settlements.filter(terminal => terminal.runId === receipt.runId && terminal.delegationRefs.includes(receipt.ref))) terminal.summarizedBy = item.replyMessageId;
          work.pendingSummary = work.delegations.some(receipt => receipt.report && !receipt.report.summarizedBy) || work.settlements.some(terminal => !terminal.summarizedBy);
          if (work.summaryFailure?.delegationRef === reference.delegationRef) delete work.summaryFailure;
        }
        for (const reference of item.terminalRefs ?? []) {
          const work = state.workstreams.find(work => work.id === reference.workstreamId);
          work.settlements.find(terminal => terminal.runId === reference.runId && terminal.delegationRefs.includes(reference.delegationRef)).summarizedBy = item.replyMessageId;
          work.pendingSummary = work.delegations.some(receipt => receipt.report && !receipt.report.summarizedBy) || work.settlements.some(terminal => !terminal.summarizedBy);
          if (work.summaryFailure?.delegationRef === reference.delegationRef) delete work.summaryFailure;
        }
      });
      committed = true;
      await this.service.notes(project.id);
    });
    // Record this requirement's own changes before the next requirement can start writing.
    if (committed) await this.service.afterDelivery(draft.id);
    if (!reconciling) await this.service.queue.pump(draft.projectId);
  }
  applicable(delivery) {
    if (delivery.status !== 'delivered') return false;
    const row = this.rows(delivery.projectId).find(row => row.id === delivery.requestId);
    if (!row || this.version(row).authorityError || row.revision !== delivery.requestRevision || JSON.stringify(this.manifest(row)) !== JSON.stringify(delivery.requiredDelegations)) return false;
    const imported = delivery.imported035;
    if (imported?.basisAlreadyChanged) return false;
    if (imported?.basisHeads && imported.basisHeads.some(head => {
      const work = this.service.state().workstreams.find(work => work.id === head.workstreamId && work.projectId === delivery.projectId), receipt = work && latest(work);
      return !receipt || work.currentDelegationRef !== head.delegationRef || (receipt.runId ?? '') !== head.runId || (receipt.report?.callId ?? '') !== head.reportId;
    })) return false;
    if ((delivery.terminalRefs ?? []).some(reference => {
      const work = this.service.state().workstreams.find(work => work.id === reference.workstreamId && work.projectId === delivery.projectId), receipt = work?.delegations.find(receipt => receipt.ref === reference.delegationRef);
      return !receipt || receipt.runId !== reference.runId || !work.settlements.some(terminal => terminal.runId === reference.runId && terminal.delegationRefs.includes(reference.delegationRef));
    })) return false;
    return delivery.reportRefs.every(reference => {
      const work = this.service.state().workstreams.find(work => work.id === reference.workstreamId && work.projectId === delivery.projectId);
      const report = work?.delegations.find(receipt => receipt.ref === reference.delegationRef)?.report;
      return report && (!reference.reportId || report.callId === reference.reportId) && !this.service.prerequisiteStatus(report, delivery.projectId).prerequisitesChanged;
    });
  }
  deliveries(projectId, cursor) {
    const all = (this.service.state().deliveries ?? []).filter(item => item.projectId === projectId && (item.status === 'delivered' || item.status === 'historical' || item.status === 'obsolete' && item.imported035)).toSorted((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    const start = cursor == null ? 0 : all.findIndex(item => item.id === cursor) + 1;
    if (cursor != null && !start) fail('delivery_cursor', 'This handover cursor does not belong to the Project.');
    const items = all.slice(start, start + 10).map(item => ({ ...item, applicable: this.applicable(item), artifacts: item.reportRefs.flatMap(reference => {
      const work = this.service.state().workstreams.find(work => work.id === reference.workstreamId && work.projectId === projectId), report = work?.delegations.find(receipt => receipt.ref === reference.delegationRef)?.report;
      return (this.service.reportView(report, projectId)?.artifacts ?? []).map(file => ({ ...file, workstreamId: reference.workstreamId, delegationRef: reference.delegationRef }));
    }).filter((file, index, files) => files.findIndex(other => other.path === file.path && other.workstreamId === file.workstreamId && other.delegationRef === file.delegationRef) === index) }));
    return { items, total: all.length, nextCursor: start + items.length < all.length ? items.at(-1).id : null };
  }
  current(projectId) {
    // Applicability belongs to the referenced result. A later independent
    // objective must not reopen every previously handed-over user goal.
    return this.rows(projectId).filter(row => this.service.queue.state(row) !== 'cancelled' && !this.handover(row).completed);
  }

  handover(row) {
    const matching = (this.service.state().deliveries ?? []).filter(item => item.requestId === row.id && item.requestRevision === row.revision);
    const latestAttempt = matching.at(-1), delivered = matching.filter(item => item.status === 'delivered')
      .toSorted((a, b) => b.at - a.at || b.id.localeCompare(a.id))[0];
    const applicable = delivered ? this.applicable(delivered) : false;
    const completed = delivered?.outcome === 'completed' && applicable && latestAttempt?.status !== 'draft'
      && !(latestAttempt?.status === 'historical' && latestAttempt.error);
    return { latestAttempt, delivered, applicable, completed };
  }

  card(projectId, row, byWork, full = false) {
    const service = this.service, project = service.project(projectId), version = this.version(row);
    const { latestAttempt, delivered, applicable, completed } = this.handover(row);
    const work = this.manifest(row).map(reference => {
      const record = byWork.get(reference.workstreamId), item = record?.work ?? service.stream(reference.workstreamId, projectId);
      const receipt = item.delegations.find(entry => entry.ref === reference.delegationRef);
      const worker = record?.worker ?? service.worker(item.workerSessionId);
      const terminal = item.settlements.find(entry => entry.runId === reference.runId && entry.delegationRefs.includes(reference.delegationRef));
      const current = item.currentDelegationRef === reference.delegationRef;
      const running = current && (worker.activeRunId === reference.runId || Boolean(record?.jobs.length));
      const status = current && !completed && item.summaryFailure?.delegationRef === reference.delegationRef ? 'summaryFailed'
        : current && worker.phase === 'stopping' ? 'stopping' : running ? 'running'
        : receipt.phase === 'failed' || receipt.report && receipt.report.outcome !== 'completed'
          || terminal && (terminal.stopReason !== 'completed' || !receipt.report) ? 'blocked'
        : receipt.phase === 'queued' || receipt.phase === 'preparing' ? 'queued'
        : receipt.report?.outcome === 'completed' && terminal?.stopReason === 'completed' ? 'completed'
        : worker.stopped || project.paused ? 'paused' : receipt.report || terminal ? 'pendingDelivery' : 'blocked';
      return { workstreamId: item.id, delegationRef: receipt.ref, runId: reference.runId, title: item.title,
        workerSessionId: worker.sessionId, memberName: service.memberName(worker), memberRole: worker.role, memberPhase: worker.phase,
        status, current, phase: receipt.phase, ...(receipt.waitingReason ? { waitingReason: receipt.waitingReason } : {}), ...(item.blockedReason ? { blockedReason: item.blockedReason } : {}),
        createdAt: item.createdAt, updatedAt: item.updatedAt, assignmentAt: receipt.createdAt,
        ...(receipt.report ? { reportId: receipt.report.callId, outcome: receipt.report.outcome, reportAt: receipt.report.at,
          ...(full ? { summary: receipt.report.summary } : {}) } : {}),
        ...(terminal ? { terminalStopReason: terminal.stopReason, terminalAt: terminal.at } : {}) };
    }).sort((a, b) => {
      const priority = { blocked: 0, summaryFailed: 0, stopping: 1, running: 2, queued: 3, paused: 4, pendingDelivery: 5, completed: 6 };
      return priority[a.status] - priority[b.status] || b.updatedAt - a.updatedAt || a.workstreamId.localeCompare(b.workstreamId);
    });
    const counts = { total: work.length, members: new Set(work.map(item => item.workerSessionId)).size,
      running: work.filter(item => item.status === 'running').length,
      queued: work.filter(item => item.status === 'queued').length,
      blocked: work.filter(item => item.status === 'blocked').length,
      summaryFailed: work.filter(item => item.status === 'summaryFailed').length,
      completed: work.filter(item => item.status === 'completed').length };
    const request = full ? this.view(row) : undefined;
    const status = completed ? 'completed'
      : version.authorityError || counts.blocked ? 'blocked'
      : request?.handoverError || latestAttempt?.status === 'historical' && latestAttempt.error || counts.summaryFailed ? 'summaryFailed'
      : work.some(item => item.status === 'stopping') ? 'stopping'
      : delivered?.outcome === 'completed' && !applicable ? 'needsReview'
      : latestAttempt?.status === 'draft' ? 'pendingDelivery'
      : counts.running ? 'running' : counts.queued ? 'queued'
      : delivered?.outcome === 'partial' ? 'blocked'
      : project.paused || work.some(item => item.status === 'paused') ? 'paused' : 'pendingDelivery';
    const memberRows = new Map();
    for (const item of work) if (!memberRows.has(item.workerSessionId)) memberRows.set(item.workerSessionId,
      { sessionId: item.workerSessionId, name: item.memberName, status: item.status });
    const members = [...memberRows.values()];
    const base = { id: row.id, projectId, title: row.title, revision: row.revision, createdAt: row.createdAt,
      updatedAt: row.updatedAt, ...(row.archivedAt !== undefined ? { archivedAt: row.archivedAt } : {}), queue: service.queue.view(row), status, counts,
      ...(row.changes ? { changes: { isGit: row.changes.isGit, revertible: Boolean(row.changes.isGit && row.changes.baseline && row.changes.end && !row.changes.revertedAt),
        ...(row.changes.end ? { fileCount: row.changes.fileCount ?? 0, added: row.changes.added ?? 0, removed: row.changes.removed ?? 0 } : {}),
        ...(row.changes.revertedAt ? { revertedAt: row.changes.revertedAt } : {}), ...(full && row.changes.files ? { files: row.changes.files.slice(0, 50) } : {}) } } : {}) };
    if (!full) return { ...base, goalPreview: version.goal.slice(0, 180), members: members.slice(0, 3), memberTotal: members.length,
      workPreview: work.slice(0, 3).map(item => ({ workstreamId: item.workstreamId, delegationRef: item.delegationRef,
        title: item.title, status: item.status, memberName: item.memberName, workerSessionId: item.workerSessionId,
        ...(item.waitingReason ? { waitingReason: item.waitingReason } : {}), ...(item.blockedReason ? { blockedReason: item.blockedReason } : {}) })),
      delivery: delivered && { id: delivered.id, outcome: delivered.outcome,
        summaryPreview: delivered.summary.slice(0, 240), at: delivered.at, applicable,
        artifactCount: delivered.reportRefs.reduce((count, reference) => {
          const item = service.stream(reference.workstreamId, projectId);
          return count + (item.delegations.find(entry => entry.ref === reference.delegationRef)?.report?.artifacts.length ?? 0);
        }, 0) } };
    const delivery = delivered && { id: delivered.id, outcome: delivered.outcome, summary: delivered.summary, evidence: delivered.evidence,
      remainingIssues: delivered.remainingIssues, at: delivered.at, applicable, reportRefs: delivered.reportRefs, terminalRefs: delivered.terminalRefs ?? [], pages: delivered.pages ?? [],
      artifacts: delivered.reportRefs.flatMap(reference => {
        const item = service.stream(reference.workstreamId, projectId);
        const receipt = item.delegations.find(entry => entry.ref === reference.delegationRef);
        return (service.reportView(receipt?.report, projectId)?.artifacts ?? []).map(file => ({ ...file,
          workstreamId: reference.workstreamId, delegationRef: reference.delegationRef }));
      }) };
    return { ...base, ...request, work, members, delivery,
      versions: row.versions.map(item => ({ revision: item.revision, title: item.title ?? item.goal.slice(0, 100),
        goal: item.goal, constraints: item.constraints, conditions: item.conditions, at: item.at })) };
  }

  async listCards(projectId, { kind = 'current', cursor } = {}) {
    if (!['current', 'completed', 'archived', 'cancelled'].includes(kind)) fail('request_kind', 'Choose current, completed, archived or cancelled Project tasks.');
    const service = this.service;
    const rows = this.rows(projectId).filter(row => {
      const completed = this.handover(row).completed;
      if (kind === 'cancelled') return service.queue.state(row) === 'cancelled';
      if (service.queue.state(row) === 'cancelled') return false;
      return kind === 'current' ? !completed : kind === 'archived' ? completed && row.archivedAt !== undefined
        : completed && row.archivedAt === undefined;
    })
      .toSorted((a, b) => {
        if (kind === 'current') { const priority = { active: 0, queued: 1, discussing: 2, cancelled: 3 }, order = (a.queue?.released ? 3 : priority[service.queue.state(a)]) - (b.queue?.released ? 3 : priority[service.queue.state(b)]);
          if (order) return order;
          if (service.queue.state(a) === 'queued') return (a.queue?.order ?? a.createdAt) - (b.queue?.order ?? b.createdAt) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
        }
        return (kind === 'archived' ? b.archivedAt - a.archivedAt : b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id);
      });
    const start = cursor == null ? 0 : rows.findIndex(row => row.id === cursor) + 1;
    if (cursor != null && start === 0) fail('request_cursor', 'This task cursor does not belong to the selected Project list.');
    const page = rows.slice(start, start + 10), workRows = page.length ? await service.workRows(projectId) : [];
    const byWork = new Map(workRows.map(row => [row.work.id, row]));
    return { items: page.map(row => this.card(projectId, row, byWork)), total: rows.length,
      nextCursor: start + page.length < rows.length ? page.at(-1).id : null };
  }

  async getCard(projectId, requestId) {
    const row = this.get(projectId, requestId), workRows = await this.service.workRows(projectId);
    return { card: this.card(projectId, row, new Map(workRows.map(item => [item.work.id, item])), true) };
  }

  async setArchived(projectId, requestId, archived) {
    const service = this.service;
    return service.serial(async () => {
      const project = service.project(projectId);
      if (project.lifecycle !== 'ready' || service.archiving.has(projectId)) fail('archived', 'Restore this Project before changing task cards.');
      const row = this.get(projectId, requestId);
      if (archived) {
        if (!this.handover(row).completed) fail('request_active', 'Only a completed and current Project task can be archived.');
        if (row.archivedAt !== undefined) return { requestId, archivedAt: row.archivedAt };
        for (const reference of this.manifest(row)) {
          const work = service.stream(reference.workstreamId, projectId), worker = service.worker(work.workerSessionId);
          if (work.currentDelegationRef === reference.delegationRef && (worker.activeRunId || service.jobs(worker.sessionId).length
            || worker.phase === 'stopping' || ['queued', 'preparing'].includes(latest(work).phase)))
            fail('request_active', 'This Project task still has active work.');
        }
      } else if (row.archivedAt === undefined) return { requestId, archivedAt: null };
      const archivedAt = archived ? Date.now() : null;
      await service.write(state => {
        const item = state.requests.find(value => value.projectId === projectId && value.id === requestId);
        if (archived) item.archivedAt = archivedAt;
        else delete item.archivedAt;
      });
      return { requestId, archivedAt };
    });
  }
}
