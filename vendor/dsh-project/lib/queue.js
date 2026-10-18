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
  active(projectId) { return this.rows(projectId).filter(row => this.state(row) === 'active' && !row.queue?.released && this.unfinished(row)).toSorted((a, b) => a.createdAt - b.createdAt)[0]; }
  view(row) { const pending = this.pending(row.projectId), index = pending.findIndex(item => item.id === row.id);
    return { state: this.state(row), ...(row.queue?.released ? { released: true } : {}), ...(index >= 0 ? { position: index + 1, total: pending.length } : {}) }; }
  accepts(row, revision = row.revision) { return this.state(row) === 'active' && row.revision === revision && this.active(row.projectId)?.id === row.id && this.unfinished(row); }
  // Read-only preparation may start for an authorized queued requirement; any write waits for activation.
  acceptsWork(row, revision, scope) { return this.accepts(row, revision) || scope === 'readonly' && this.state(row) === 'queued' && row.revision === revision && !row.queue?.released && this.unfinished(row); }
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
    let active = requests.find(item => item.id !== row.id && (item.queue?.state ?? 'active') === 'active' && !item.queue?.released && this.unfinished(item));
    const stateName = preserveActive && row.queue?.state === 'active' && !row.queue.released ? 'active'
      : disposition === 'active' ? 'queued' : disposition;
    const nextOrder = Math.max(0, ...requests.map(item => item.queue?.order ?? 0)) + 1;
    const order = row.queue?.released ? nextOrder : row.queue?.order ?? nextOrder;
    row.queue = { state: stateName, order };
    const firstQueued = requests.filter(item => item.queue?.state === 'queued' && this.unfinished(item))
      .toSorted((a, b) => (a.queue.order ?? a.createdAt) - (b.queue.order ?? b.createdAt) || a.id.localeCompare(b.id))[0];
    if (stateName === 'queued' && !active && firstQueued?.id === row.id && !this.busy(row.projectId)) row.queue.state = 'active';
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
      const resumeHead = action === 'resume' && stateName === 'queued' && !this.active(projectId) && this.pending(projectId)[0]?.id === row.id;
      const resumeCurrent = action === 'resume' && !released && this.active(projectId)?.id === row.id;
      if (action === 'resume' && !resumeCurrent && !resumeHead) fail('request_not_active', 'Resume only the current active requirement or the next queued requirement when there is no active one. Rejoin cancelled or historical requirements with enqueue.');
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
        if (action === 'cancel') item.queue = { state: 'cancelled' };
        else if (action !== 'resume' || stateName !== 'active') { item.queue = { ...item.queue, state: 'queued' }; delete item.queue.activation; delete item.queue.released; }
        else { item.queue = { ...item.queue, state: 'active', resumeRequested: true }; delete item.queue.activation; }
        if (action === 'resume') item.queue.resumeRequested = true;
        if (action === 'enqueue' && (stateName === 'cancelled' || released)) item.queue.resumeRequested = true;
        for (let i = 0; i < ordered.length; i++) { const next = state.requests.find(item => item.id === ordered[i].id); next.queue = { ...next.queue, state: 'queued', order: i }; next.updatedAt = now; }
        item.updatedAt = now;
        if (action === 'resume') { state.projects.find(item => item.id === projectId).paused = false; state.projects.find(item => item.id === projectId).holdSourceMessageId = ''; }
      });
      if (action === 'resume') service.projectHolds.delete(projectId);
    });
    for (const workId of cancelWork) await service.stop(projectId, workId, { recordHold: false });
    await Promise.all(cancelWork.map(workId => service.stops.get(service.stream(workId).workerSessionId)).filter(Boolean));
    await this.pump(projectId);
    await service.notes(projectId);
    return { requestId, queue: this.view(service.requirements.get(projectId, requestId)), projectQueue: this.summary(projectId) };
  }
  summary(projectId) { const active = this.active(projectId), pending = this.pending(projectId), card = active && this.service.requirements.card(projectId, active, new Map());
    return { active: card ? { id: card.id, title: card.title, revision: card.revision, status: card.status,
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
    const service = this.service; let message, selected;
    await service.serial(async () => {
      const project = service.project(projectId);
      if (service.closing || service.recovering || project.paused || project.lifecycle !== 'ready' || service.archiving.has(projectId) || service.projectHolds.has(projectId)) return;
      let row = this.active(projectId), promoted = false;
      if (!row) {
        if (this.busy(projectId)) return;
        row = this.pending(projectId)[0]; if (!row) return;
        await service.write(state => { const item = state.requests.find(item => item.id === row.id); item.queue.state = 'active'; delete item.queue.activation; item.updatedAt = Date.now(); });
        row = service.requirements.get(projectId, row.id);
        promoted = true;
      }
      if (!wake || row.queue?.activation || this.busy(projectId)) return;
      if (!promoted && !row.queue?.resumeRequested && service.requirements.manifest(row).length) return;
      // No extra activation is needed while the original human turn can arrange
      // its accepted work. Later handoffs use one exact native plugin message.
      if (!promoted && !row.queue?.resumeRequested && service.humanTurnOpen(project.coordinatorSessionId)) return;
      message = createUserMessage({ source: { kind: queuePlugin, form: 'notice', summary: boundContextSummary(`Project activated: ${row.title}`) }, content: [{ type: 'text', text: `The Project host activated the next user-authorized requirement. Read notes.md, preserve this requirement's stored scope and restrictions, delegate its actual work, then report progress. This is queue continuation, not new human authorization.\n${JSON.stringify(service.requirements.view(row))}` }] });
      selected = { id: row.id, revision: row.revision };
      await service.write(state => { const item = state.requests.find(item => item.id === row.id); item.queue.activation = { messageId: message.id, requestRevision: row.revision, ...(item.queue.resumeRequested ? { resume: true } : {}) }; delete item.queue.resumeRequested; });
    });
    if (!message) return;
    const row = service.requirements.get(projectId, selected.id);
    if (!this.notice(row, message) || service.project(projectId).paused || service.projectHolds.has(projectId)) return;
    const lead = await service.coordinator(service.project(projectId));
    lead.followup(message);
  }
}
