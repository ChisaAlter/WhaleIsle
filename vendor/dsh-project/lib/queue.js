/** Requirement ordering; execution and message delivery remain native Session work. */
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm';

const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const latest = work => work.delegations.find(item => item.ref === work.currentDelegationRef);
export const queuePlugin = 'whale-project:queue';

export class ProjectQueue {
  constructor(service) { this.service = service; this.pumps = new Map(); }
  rows(projectId) { return this.service.requirements.rows(projectId); }
  unfinished(row) { return !this.service.requirements.handover(row).completed; }
  state(row) { return row.queue?.state ?? 'active'; }
  pending(projectId) { return this.rows(projectId).filter(row => this.state(row) === 'queued' && this.unfinished(row))
    .toSorted((a, b) => (a.queue?.order ?? a.createdAt) - (b.queue?.order ?? b.createdAt) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)); }
  active(projectId) { return this.rows(projectId).filter(row => this.accepts(row)).toSorted((a, b) => a.createdAt - b.createdAt)[0]; }
  view(row) { const pending = this.pending(row.projectId), index = pending.findIndex(item => item.id === row.id);
    return { state: this.state(row), ...(row.queue?.suspended ? { suspended: true } : {}), ...(row.queue?.released ? { released: true } : {}), ...(index >= 0 ? { position: index + 1, total: pending.length } : {}) }; }
  accepts(row, revision = row.revision) { return this.state(row) === 'active' && !row.queue?.released && !row.queue?.suspended && row.revision === revision && this.unfinished(row); }
  // Read-only preparation may start for an authorized queued requirement; any write waits for activation.
  acceptsWork(row, revision, scope) { return this.accepts(row, revision) || scope === 'readonly' && this.state(row) === 'queued' && row.revision === revision && !row.queue?.released && !row.queue?.suspended && this.unfinished(row); }
  assertWork(row, revision, scope) { if (!this.acceptsWork(row, revision, scope)) fail('request_queued', scope === 'readonly' ? 'Only the active or an authorized queued requirement may run read-only work. Discussed or cancelled requirements cannot run.' : 'Only the current active requirement may write. A queued requirement may only run read-only preparation.'); }
  assertActive(row, revision) { if (!this.accepts(row, revision)) fail('request_queued', 'Only the current active requirement may execute. Discussed, queued or cancelled requirements cannot run.'); }
  busy(projectId) { return this.service.state().workers.some(worker => worker.projectId === projectId && this.workerBusy(worker)); }
  workerBusy(worker) { return Boolean(worker.activeRunId || worker.reservationRef && this.service.stream(worker.workstreamId).delegations.some(receipt => receipt.ref === worker.reservationRef && receipt.phase === 'preparing') || worker.directoryHeld || worker.phase === 'stopping'
      || this.service.jobs(worker.sessionId).length || this.service.launches.has(worker.workstreamId)); }
  notice(row, message) { return message.source?.kind === queuePlugin
    && row.queue?.activation?.messageId === message.id && row.queue.activation.requestRevision === row.revision && this.accepts(row); }
  authorized(row, messages) { return messages.some(event => this.notice(row, event.data ?? event)); }
  validNotice(projectId, message) { return this.rows(projectId).some(row => this.notice(row, message)); }
  initialize(state, row, disposition, { preserveActive = true } = {}) {
    const requests = state.requests.filter(item => item.projectId === row.projectId);
    // Existing accepted goals retain their execution authority; adopt their order
    // only on a real mutation, never while reading or recovering persisted data.
    const stateName = preserveActive && row.queue?.state === 'active' && !row.queue.released ? 'active'
      : disposition === 'active' || disposition === 'queued' ? 'active' : disposition;
    const nextOrder = Math.max(0, ...requests.map(item => item.queue?.order ?? 0)) + 1;
    const order = row.queue?.released ? nextOrder : row.queue?.order ?? nextOrder;
    row.queue = { state: stateName, order };
  }
  async change(projectId, args) {
    const service = this.service, { requestId, requestRevision, action, beforeRequestId } = args;
    if (!['enqueue', 'move', 'cancel', 'resume'].includes(action)) fail('queue_action', 'Choose enqueue, move, cancel or resume.');
    if (!Number.isInteger(requestRevision)) fail('request_changed', 'Read the current requirement revision before changing its queue.');
    let cancelWork = [];
    await service.serial(async () => {
      const project = service.project(projectId), row = service.requirements.get(projectId, requestId, requestRevision);
      if (service.closing || service.archiving.has(projectId) || project.lifecycle !== 'ready') fail('unavailable', 'Restore this Project before changing its queue.');
      if (!this.unfinished(row)) fail('request_completed', 'A completed requirement remains in its delivery history. Revise it to request new development.');
      const stateName = this.state(row), released = row.queue?.released === true;
      if (action === 'move' && stateName !== 'queued') fail('queue_active', 'Only a queued requirement can be reordered.');
      if (action === 'enqueue' && !released && !['discussing', 'cancelled', 'queued'].includes(stateName)) fail('queue_active', 'The requirement is already active.');
      const resumeHead = action === 'resume' && !released && stateName === 'queued';
      const resumeCurrent = action === 'resume' && !released && stateName === 'active';
      if (action === 'resume' && !resumeCurrent && !resumeHead) fail('request_not_active', 'Resume an accepted active or queued requirement. Rejoin cancelled or historical requirements with enqueue.');
      let ordered = this.pending(projectId).filter(item => item.id !== row.id);
      if (resumeHead) ordered.unshift(row);
      if (action === 'move' || action === 'enqueue') {
        const before = beforeRequestId === undefined ? ordered.length : ordered.findIndex(item => item.id === beforeRequestId);
        if (before < 0 || beforeRequestId === row.id) fail('queue_order', 'The requested preceding requirement is no longer queued. Refresh the queue.');
        ordered.splice(before, 0, row);
      }
      if (action === 'cancel') cancelWork = service.state().workstreams.filter(work => work.projectId === projectId && latest(work).source.requestId === row.id).map(work => work.id);
      await service.write(state => {
        const item = state.requests.find(item => item.id === row.id), now = Date.now();
        if (action === 'cancel') { item.queue = { state: 'cancelled' }; delete item.ask; }
        else if (action !== 'move') { item.queue = { ...item.queue, state: 'active', resumeRequested: true, suspended: action !== 'resume' && project.paused }; delete item.queue.activation; delete item.queue.released; }
        if (action === 'resume') item.queue.resumeRequested = true;
        if (action === 'enqueue' && (stateName === 'cancelled' || released)) item.queue.resumeRequested = true;
        for (let i = 0; i < ordered.length; i++) { if (ordered[i].id === row.id && action !== 'move') continue; const next = state.requests.find(item => item.id === ordered[i].id); next.queue = { ...next.queue, state: 'queued', order: i }; next.updatedAt = now; }
        item.updatedAt = now;
        if (action === 'resume') { state.projects.find(item => item.id === projectId).paused = false; state.projects.find(item => item.id === projectId).holdSourceMessageId = ''; }
      });
      if (action === 'resume') service.projectHolds.delete(projectId);
    });
    for (const workId of cancelWork) await service.stop(projectId, workId, { recordHold: false });
    await Promise.all(cancelWork.map(workId => service.stops.get(service.stream(workId).workerSessionId)).filter(Boolean));
    await service.closeCancelledTasks(projectId, cancelWork);
    await this.pump(projectId);
    await service.notes(projectId);
    return { requestId, queue: this.view(service.requirements.get(projectId, requestId)), projectQueue: this.summary(projectId) };
  }
  summary(projectId) { const active = this.active(projectId), pending = this.pending(projectId), card = active && this.service.requirements.card(projectId, active, new Map());
    return { activeRequests: this.rows(projectId).filter(row => this.accepts(row)).map(row => ({ id: row.id, title: row.title, revision: row.revision })), active: card ? { id: card.id, title: card.title, revision: card.revision, status: card.status,
      ...(card.workPreview ? { workPreview: card.workPreview } : {}), queue: card.queue } : null,
      queued: pending.map((row, index) => ({ id: row.id, title: row.title, revision: row.revision, queue: { state: 'queued', position: index + 1, total: pending.length }, position: index + 1 })),
      discussingCount: this.rows(projectId).filter(row => this.state(row) === 'discussing' && this.unfinished(row)).length,
      cancelledCount: this.rows(projectId).filter(row => this.state(row) === 'cancelled').length, paused: this.service.project(projectId).paused };
  }
  pump(projectId, { wake = true } = {}) {
    if (this.pumps.has(projectId)) return this.pumps.get(projectId);
    const promise = this.doPump(projectId, wake).finally(() => this.pumps.delete(projectId));
    this.pumps.set(projectId, promise); return promise;
  }
  async doPump(projectId, wake) {
    const service = this.service, messages = [];
    await service.serial(async () => {
      const project = service.project(projectId);
      if (service.closing || service.recovering || project.paused || project.lifecycle !== 'ready' || service.archiving.has(projectId) || service.projectHolds.has(projectId)) return;
      for (let row of this.rows(projectId)) {
        // Legacy waiting requirements remain inert after recovery until the user resumes them.
        if (!this.accepts(row) || !wake || row.queue?.activation) continue;
        if (!row.queue?.resumeRequested && (service.requirements.manifest(row).length || service.humanTurnOpen(project.coordinatorSessionId))) continue;
        const message = createUserMessage({ source: { kind: queuePlugin, form: 'notice', summary: boundContextSummary('Project goal: ' + row.title) }, content: [{ type: 'text', text: 'Continue this user-authorized Project goal. Arrange ready work alongside other goals, respecting dependencies and real resource conflicts. This is continuation, not new human authorization.\n' + JSON.stringify(service.requirements.view(row)) }] });
        messages.push({ id: row.id, message });
        await service.write(state => { const item = state.requests.find(item => item.id === row.id); item.queue.activation = { messageId: message.id, requestRevision: row.revision, ...(item.queue.resumeRequested ? { resume: true } : {}) }; delete item.queue.resumeRequested; });
      }
    });
    for (const { id, message } of messages) {
      if (!this.notice(service.requirements.get(projectId, id), message) || service.project(projectId).paused || service.projectHolds.has(projectId)) continue;
      (await service.coordinator(service.project(projectId))).followup(message);
    }
  }
}
