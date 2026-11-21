/** Local Project indexes over the existing Session and continuing-child runtime. */
import fs from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkedFile, projectDirectory, safeProjectSubdirectory, atomicText, samePath, within } from './files.js';
import { ProjectApprovals } from './approvals.js';
import { ProjectRequirements } from './requirements.js';
import { ProjectQueue } from './queue.js';
import { wrapCatalogTable } from './catalog-store.js';
import { classifyExecutionError, probeReportEvidence } from './evidence.js';
import { handleProjectReview } from './review.js';
import * as changesOps from './changes.js';
import * as workOps from './workstream-ops.js';
import * as runtimeGuard from './runtime-guard.js';
import * as launchOps from './launch.js';
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm';

const copy = value => JSON.parse(JSON.stringify(value));
const required = (value, label, limit = 32000) => { if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Invalid ${label}.`); return value.trim(); };
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const content = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const latest = stream => stream.delegations.find(item => item.ref === stream.currentDelegationRef);
const policy = 'dsh-project-local';
const readOnly = scope => scope === 'readonly' || scope === 'research';

export const summaryRetryPlugin = 'whale-project:summary-retry';
export const settlementCheckPlugin = 'whale-project:settlement-check';

function applyRunEndStatus(service, work, member, receipt, info) {
  if (member.stopped || service.project(member.projectId).paused) { work.status = 'blocked'; work.blockedReason = 'stopped'; return null; }
  if (info.stopReason !== 'completed') {
    work.status = 'blocked'; work.blockedReason = `Worker ended: ${info.stopReason}`;
    return info.stopReason === 'error' ? work.blockedReason : null;
  }
  if (member.directoryHeld) { work.status = 'blocked'; work.blockedReason = 'Worker-owned jobs are still active.'; return null; }
  if (receipt.report) {
    work.latestReport = receipt.report;
    work.status = receipt.report.outcome === 'completed' ? 'done' : 'blocked';
    work.blockedReason = receipt.report.outcome === 'completed' ? '' : receipt.report.summary;
    if (receipt.report.outcome === 'completed') { work.consecutiveFailures = 0; delete work.escalatedAt; return null; }
    return receipt.report.outcome === 'failed' ? receipt.report.summary : null;
  }
  work.status = 'blocked'; work.blockedReason = 'This turn ended without an explicit result report.';
  return work.blockedReason;
}

export class ProjectService {
  constructor(ctx, table, { home, desktop, teams = ctx.agentTeams, orphanSweepIntervalMs = 60000 }) {
    this.ctx = ctx; this.teams = teams; this.table = wrapCatalogTable(table); this.home = home; this.desktop = desktop; this.available = true;
    this.tail = Promise.resolve(); this.notesWrites = new Map(); this.delegationTails = new Map(); this.launches = new Map();
    this.stops = new Map(); this.terminals = new Map(); this.consumed = new Map(); this.userTurns = new Map();
    this.background = new Set(); this.closing = false; this.recovering = true; this.scheduling = false; this.scheduleRevision = 0;
    this.held = new Set(); this.workerStops = new Map(); this.projectHolds = new Map(); this.archiving = new Set();
    this.summaryRetryDelays = [30000, 120000, 360000]; this.summaryRetryTimers = new Map();
    this.settlementCheckDelay = 45000; this.settlementCheckTimers = new Map(); this.settlementChecks = new Map();
    this.approvals = new ProjectApprovals(this);
    this.requirements = new ProjectRequirements(this);
    this.queue = new ProjectQueue(this);
    this.taskTails = new Map();
    this.catalog = this.table.get('catalog');
    this.unpolicy = ctx.subagents.registerContinuationPolicy(policy, args => this.admit(args));
    this.orphanSweepTimer = orphanSweepIntervalMs > 0 ? setInterval(() => {
      if (this.admissionOpen()) this.track(this.sweepOrphans(), 'Project orphan sweep failed');
    }, orphanSweepIntervalMs) : null;
    this.orphanSweepTimer?.unref?.();
  }
  state() { return this.closing && !this.persistOnDispose ? this.catalog : (this.catalog = this.table.get('catalog')); }
  admissionOpen() {
    const admission = this.ctx.get('desktopTaskAdmission');
    if (!admission) return true;
    if (typeof admission.check === 'function') return Boolean(admission.check());
    if (typeof admission.isLocked === 'function') return !admission.isLocked();
    return true;
  }
  track(work, label) { const settled = work.catch(error => this.ctx.logger.warn(`${label}: %s`, error.message)).finally(() => this.background.delete(settled)); this.background.add(settled); }
  serial(work) { const result = this.tail.then(work); this.tail = result.catch(() => { /* Caller receives rejection; serial queue continues for subsequent operations. */ }); return result; }
  async write(change) {
    if (this.closing && !this.persistOnDispose) fail('unavailable', 'Project is unloading; only runtime cleanup remains.');
    await this.table.update('catalog', before => { const next = structuredClone(before); change(next); next.revision++; return next; });
    this.catalog = this.table.get('catalog');
  }
  project(id) { const row = this.state().projects.find(item => item.id === id); if (!row) fail('missing', 'Project does not exist.'); return row; }
  stream(id, projectId) { const row = this.state().workstreams.find(item => item.id === id && (!projectId || item.projectId === projectId)); if (!row) fail('missing', 'Workstream does not belong to this Project.'); return row; }
  worker(id) { const row = this.state().workers.find(item => item.sessionId === id); if (!row) fail('missing', 'Project worker does not exist.'); return row; }
  jobs(id) { return (this.ctx.get('jobs')?.list(id) ?? []).filter(job => job.owner === id && ['running', 'stopping'].includes(job.status)); }
  memberName(worker) { return worker.sessionId; }
  isTopLevelWorker(worker) { return !worker.parentSessionId || worker.parentSessionId === this.project(worker.projectId).coordinatorSessionId; }

  /** Snapshot of active Project work for `dsh-task-control` shutdown/update protection. */
  inspect() {
    if (!this.available) return { activeCount: 0, activeProjects: [], details: [] };
    const state = this.state(), details = [], activeProjectIds = new Set();
    const add = (projectId, kind, id) => { activeProjectIds.add(projectId); details.push({ projectId, kind, id }); };
    for (const project of state.projects) this.inspectProject(project, add);
    for (const worker of state.workers) if (this.isWorkerBusyForInspect(worker)) add(worker.projectId, 'worker', worker.sessionId);
    for (const work of state.workstreams) this.inspectWorkstream(state, work, add);
    return { activeCount: details.length, activeProjects: [...activeProjectIds], details };
  }
  inspectProject(project, add) {
    if (this.archiving.has(project.id)) add(project.id, 'archiving', project.id);
    if (this.summaryRetryTimers.has(project.id)) add(project.id, 'summary-retry-timer', project.id);
    if (this.settlementCheckTimers.has(project.id)) add(project.id, 'settlement-check-timer', project.id);
    if (this.ctx.agents.get(project.coordinatorSessionId)?.status === 'running') add(project.id, 'coordinator', project.coordinatorSessionId);
  }
  isWorkerBusyForInspect(worker) {
    return Boolean(worker.activeRunId || (['active', 'provisioning', 'stopping'].includes(worker.phase) && !worker.stopped)
      || worker.directoryHeld || this.jobs(worker.sessionId).length || this.stops.has(worker.sessionId));
  }
  inspectWorkstream(state, work, add) {
    if (this.launches.has(work.id)) { add(work.projectId, 'launch', work.id); return; }
    const project = this.project(work.projectId);
    const worker = state.workers.find(row => row.sessionId === work.workerSessionId);
    const receipt = latest(work);
    if (!project.paused && project.lifecycle === 'ready' && !worker?.stopped && receipt && ['queued', 'preparing'].includes(receipt.phase)) {
      add(work.projectId, `work-${receipt.phase}`, work.id);
    }
  }

  projectView(project) {
    const allWork = this.state().workstreams.filter(item => item.projectId === project.id);
    const workers = this.state().workers.filter(item => item.projectId === project.id);
    const requests = this.requirements.rows(project.id), currentRequests = this.requirements.current(project.id);
    const activeRequests = currentRequests.filter(row => this.queue.accepts(row));
    const recent = activeRequests.length ? activeRequests : currentRequests.length ? currentRequests : requests.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, 1);
    const currentWorkRefs = recent.flatMap(row => this.requirements.manifest(row).map(reference => ({ requestId: row.id, requestRevision: row.revision, ...reference })));
    const pendingWorkRefs = currentWorkRefs.filter(reference => activeRequests.some(row => row.id === reference.requestId));
    const members = new Map(workers.map(worker => [worker.sessionId, worker]));
    const active = item => members.get(item.workerSessionId)?.activeRunId || this.jobs(item.workerSessionId).length || members.get(item.workerSessionId)?.phase === 'stopping';
    const requiredLatest = item => pendingWorkRefs.some(reference => reference.workstreamId === item.id && reference.delegationRef === item.currentDelegationRef);
    const work = allWork.filter(item => !latest(item).source.requestId || requiredLatest(item) || active(item));
    const activity = this.computeProjectActivity(project, { workers, work, currentRequests, activeRequests, recent, pendingWorkRefs, members });
    const currentTaskIds = allWork.filter(item => currentWorkRefs.some(reference => reference.workstreamId === item.id) || active(item)).sort((a, b) => b.updatedAt - a.updatedAt).map(item => item.id);
    return {
      ...project, queue: this.queue.summary(project.id), archiving: this.archiving.has(project.id),
      ...(requests.length ? { currentTaskIds } : {}), currentWorkRefs, currentRequests: currentRequests.slice(0, 20).map(row => this.requirements.view(row)),
      activity, updatedAt: Math.max(project.updatedAt, ...allWork.map(item => item.updatedAt), ...requests.map(item => item.updatedAt)),
    };
  }
  computeProjectActivity(project, { workers, work, currentRequests, activeRequests, recent, pendingWorkRefs, members }) {
    const stopping = workers.some(item => item.phase === 'stopping');
    const running = workers.filter(item => item.activeRunId || this.jobs(item.sessionId).length).length;
    const queued = work.filter(item => latest(item).phase === 'queued').length;
    const provisioning = work.filter(item => latest(item).phase === 'preparing').length;
    const failedWorkIds = new Set(pendingWorkRefs.filter(reference => {
      const item = this.stream(reference.workstreamId), receipt = item.delegations.find(entry => entry.ref === reference.delegationRef);
      if (members.get(item.workerSessionId)?.stopped) return false;
      if (reference.delegationRef === item.currentDelegationRef) return item.status === 'blocked' || members.get(item.workerSessionId)?.phase === 'failed';
      const terminal = item.settlements.find(entry => entry.runId === reference.runId && entry.delegationRefs.includes(reference.delegationRef));
      return receipt.phase === 'failed' || terminal && (terminal.stopReason !== 'completed' || !receipt.report || receipt.report.outcome !== 'completed');
    }).map(reference => reference.workstreamId));
    for (const item of work) if (!members.get(item.workerSessionId)?.stopped && (item.status === 'blocked' || members.get(item.workerSessionId)?.phase === 'failed')) failedWorkIds.add(item.id);
    const blocked = failedWorkIds.size + currentRequests.filter(row => this.requirements.version(row).authorityError).length;
    const handoverFailures = new Set((activeRequests.length ? activeRequests : currentRequests.filter(row => this.queue.state(row) === 'active')).filter(row => this.requirements.view(row).handoverError).map(row => row.id));
    const summaryFailed = handoverFailures.size + work.filter(item => !handoverFailures.has(latest(item).source.requestId) && item.pendingSummary && item.summaryFailure?.delegationRef === item.currentDelegationRef).length;
    const pendingSummary = project.paused ? 0 : work.filter(item => item.pendingSummary && !item.summaryFailure && !members.get(item.workerSessionId)?.stopped).length;
    const coordinatorRunning = this.ctx.agents.get(project.coordinatorSessionId)?.status === 'running';
    const needsYou = this.needsYouCount(project.id);
    const pendingDelivery = project.paused ? 0 : activeRequests.filter(row => { const refs = this.requirements.manifest(row); return !refs.length || refs.some(reference => !members.get(this.stream(reference.workstreamId).workerSessionId)?.stopped); }).length;
    const handovers = recent.map(row => (this.state().deliveries ?? []).findLast(item => item.projectId === project.id && item.requestId === row.id && item.requestRevision === row.revision && item.status === 'delivered'));
    const needsReview = handovers.filter(item => item?.outcome === 'completed' && !this.requirements.applicable(item)).length;
    const delivered = recent.length > 0 && handovers.every(item => item?.outcome === 'completed' && item.replyMessageId && this.requirements.applicable(item));
    const unfinished = activeRequests.length > 0 || this.queue.pending(project.id).length > 0 || work.some(item => item.status !== 'done');
    const state = this.resolveActivityState({ project, stopping, coordinatorRunning, blocked, summaryFailed, needsReview, unfinished, running, provisioning, queued, pendingSummary, pendingDelivery, work, delivered });
    return { needsYou, running, runningJobSessionIds: workers.filter(worker => this.jobs(worker.sessionId).length > 0).map(worker => worker.sessionId), coordinatorRunning, queued, provisioning, blocked, pendingSummary, pendingDelivery, needsReview, summaryFailed, state };
  }
  resolveActivityState({ project, stopping, coordinatorRunning, blocked, summaryFailed, needsReview, unfinished, running, provisioning, queued, pendingSummary, pendingDelivery, work, delivered }) {
    if (stopping || project.paused && coordinatorRunning) return 'stopping';
    if (blocked || project.diagnostics.length) return 'blocked';
    if (summaryFailed) return 'summaryFailed';
    if (needsReview) return 'needsReview';
    if (project.paused && unfinished) return 'paused';
    if (running) return 'running';
    if (provisioning) return 'provisioning';
    if (queued) return 'queued';
    if (coordinatorRunning) return pendingSummary ? 'pendingSummary' : 'running';
    if (pendingDelivery || pendingSummary) return 'pendingDelivery';
    if (work.some(item => item.status !== 'done')) return 'paused';
    return delivered ? 'done' : 'idle';
  }

  /** Always map native tasks against the true Coordinator root, never a nested worker session. */
  projectTasks(rootOrAgent) {
    if (!rootOrAgent) return [];
    const ownerProject = this.state().projects.find(project => project.coordinatorSessionId === rootOrAgent.id)
      ?? (() => { const w = this.state().workers.find(row => row.sessionId === rootOrAgent.id); return w ? this.project(w.projectId) : undefined; })();
    const root = ownerProject ? this.ctx.agents.get(ownerProject.coordinatorSessionId) : rootOrAgent;
    if (!root) return [];
    const works = this.state().workstreams.filter(work => this.project(work.projectId).coordinatorSessionId === root.id);
    const mapping = new Map(works.filter(work => work.nativeTaskId).map(work => [work.nativeTaskId, work.id]));
    return this.teams.listTasks(root).map(task => ({ ...task, nativeTaskId: task.id, id: mapping.get(task.id) ?? task.id, blockedBy: task.blockedBy.map(id => mapping.get(id) ?? id) }));
  }
  workTask(root, id) { return this.projectTasks(root).find(task => task.id === id); }
  async ensureTask(work) {
    if (this.taskTails.has(work.id)) return this.taskTails.get(work.id);
    const pending = this.prepareTask(work).finally(() => this.taskTails.delete(work.id));
    this.taskTails.set(work.id, pending); return pending;
  }
  async createNativeTaskWithReclaim(root, work, payload) {
    try { return await this.teams.createTask(root, payload); }
    catch (error) {
      if (error?.code !== 'TEAM_TASK_LIMIT') throw error;
      const freed = await workOps.releaseHistoricalNativeTasks(this, work.projectId);
      if (!freed) throw error;
      return this.teams.createTask(root, payload);
    }
  }
  async resolveNativeBlockers(work) {
    const blockedBy = [];
    for (const id of work.blockedBy ?? []) {
      const dep = this.stream(id, work.projectId);
      if (dep.archivedNativeTaskId && !dep.nativeTaskId && this.acceptedWork(dep)) continue;
      await this.ensureTask(dep);
      if (this.stream(id).nativeTaskId) blockedBy.push(this.stream(id).nativeTaskId);
    }
    return blockedBy;
  }
  async syncNativeTaskFields(root, work, task, description, blockedBy) {
    const subject = work.title.slice(0, 200);
    if (task.subject !== subject || task.description !== description) {
      task = await this.teams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'edit', subject, description, writeScopes: latest(work).writePaths });
    }
    if (JSON.stringify(task.blockedBy) !== JSON.stringify(blockedBy)) {
      task = await this.teams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'set_dependencies', blockedBy });
    }
    if (task.status === 'completed' && !latest(work).report && latest(work).phase === 'queued') {
      await this.teams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'reopen' });
    }
  }
  async prepareTask(work) {
    const root = await this.coordinator(this.project(work.projectId));
    await this.teams.setEnabled(root, true);
    const blockedBy = await this.resolveNativeBlockers(work);
    const marker = '[Project work: ' + work.id + ']\n', description = (marker + work.brief).slice(0, 16384);
    let task = work.nativeTaskId ? this.teams.getTask(root, work.nativeTaskId)
      : this.teams.listTasks(root).find(item => item.id === work.id || item.description.startsWith(marker));
    if (!task) {
      if (work.archivedNativeTaskId && latest(work).phase !== 'queued') return undefined;
      task = await this.createNativeTaskWithReclaim(root, work, { subject: work.title.slice(0, 200), description, blockedBy, writeScopes: latest(work).writePaths });
    }
    if (work.nativeTaskId !== task.id) await this.write(state => { const row = state.workstreams.find(item => item.id === work.id); row.nativeTaskId = task.id; delete row.archivedNativeTaskId; });
    if (task.status === 'deleted') {
      if (latest(work).phase !== 'queued') return task;
      fail('task_deleted', 'The native task was deleted. Keep its history and arrange an explicit replacement through project_delegate.');
    }
    if (!this.recovering) await this.syncNativeTaskFields(root, work, task, description, blockedBy);
    return this.workTask(root, work.id);
  }
  acceptedWork(work) {
    const receipt = latest(work);
    return receipt.report?.outcome === 'completed' && receipt.review?.decision === 'accepted'
      && receipt.review.reportId === receipt.report.callId && !this.prerequisiteStatus(receipt.report, work.projectId).prerequisitesChanged;
  }
  review(actor, args, exec) { return handleProjectReview(this, actor, args, exec); }
  async assignTask(work, worker) {
    const root = await this.coordinator(this.project(work.projectId));
    const task = this.workTask(root, work.id);
    if (task?.status === 'pending') await this.teams.updateTask(root, { taskId: task.nativeTaskId, expectedRevision: task.revision, action: 'reassign', owner: worker.sessionId });
  }
  async completeTask(work) {
    const root = this.ctx.agents.get(this.project(work.projectId).coordinatorSessionId);
    if (!root) return;
    const receipt = latest(work), worker = this.worker(work.workerSessionId), task = this.workTask(root, work.id);
    const settled = work.settlements.some(item => item.runId === receipt.runId && item.delegationRefs.includes(receipt.ref) && item.stopReason === 'completed');
    if (task?.status === 'in_progress' && receipt.report?.outcome === 'completed' && settled && !this.jobs(worker.sessionId).length) await this.teams.updateTask(root, { taskId: task.nativeTaskId, expectedRevision: task.revision, action: 'complete' });
    if (!worker.activeRunId && !this.jobs(worker.sessionId).length) this.approvals.release(worker.sessionId);
  }
  async closeCancelledTasks(projectId, ids) {
    const root = await this.coordinator(this.project(projectId));
    for (const id of ids) {
      const task = this.workTask(root, id);
      if (task?.status === 'in_progress') await this.teams.updateTask(root, { taskId: task.nativeTaskId, expectedRevision: task.revision, action: 'release' });
    }
    await workOps.releaseHistoricalNativeTasks(this, projectId);
  }
  async coldFailedLaunch(work) { const worker = this.worker(work.workerSessionId); if (!worker.activeRunId && !this.jobs(worker.sessionId).length) this.approvals.release(worker.sessionId); }
  validTeamInputs(root, worker, messages) { return runtimeGuard.validTeamInputs(this, root, worker, messages); }
  actor(agent) {
    if (!agent || this.ctx.agents.get(agent.id) !== agent) fail('unauthorized', 'Project tools require the exact live Agent.');
    const project = this.state().projects.find(item => item.coordinatorSessionId === agent.id);
    if (project) return { role: 'coordinator', project, agent };
    const worker = this.state().workers.find(item => item.sessionId === agent.id);
    if (worker) return { role: 'worker', project: this.project(worker.projectId), worker, stream: this.stream(worker.workstreamId), agent };
    fail('unauthorized', 'This Agent does not belong to a Project.');
  }
  coordinatorOnly(actor) { if (actor.role !== 'coordinator') fail('unauthorized', 'Only the coordinator can delegate or stop work.'); }
  nativeDelegateCandidates(actor, exec) {
    const input = this.requirements.inputs(actor, exec);
    const candidates = this.requirements.rows(actor.project.id).filter(row => this.queue.accepts(row) && input.human.some(event => this.requirements.version(row).source?.messageIds?.includes(event.data.id)));
    if (input.human.length) return candidates;
    for (const event of input.messages) {
      if (event.data.source.kind !== 'subagent-settled') continue;
      const work = this.state().workstreams.find(item => item.workerSessionId === event.data.source.senderSessionId);
      const requestId = work && latest(work).source.requestId;
      const row = requestId && this.requirements.rows(actor.project.id).find(item => item.id === requestId);
      if (row && this.queue.accepts(row) && !candidates.includes(row)) candidates.push(row);
    }
    return candidates;
  }
  async nativeDelegate({ provider, args, options }, exec) {
    const actor = this.actor(exec.agent);
    if (actor.role === 'worker') {
      const worker = this.worker(actor.agent.id), receipt = latest(this.stream(worker.workstreamId));
      if (this.guard(exec)) fail('unauthorized', this.guard(exec));
      if (args.cwd && !samePath(args.cwd, worker.cwd)) fail('fixed_directory', 'Nested work retains its assigned directory.');
      const result = await this.delegate(actor, {
        requestId: receipt.source.requestId, requestRevision: receipt.source.requestRevision,
        scope: receipt.scope === 'worker' ? 'development' : receipt.scope, writePaths: receipt.writePaths,
        brief: args.prompt, title: args.description, nativeProvider: provider, nativeName: args.name, nativeOptions: options,
      }, exec);
      return { kind: result.phase === 'queued' ? 'queued' : 'activation', name: result.workerSessionId };
    }
    if (provider === 'fork') fail('provider', 'Coordinator cannot use subagent_fork; delegate via project_delegate or spawn.');
    if (provider !== 'spawn') fail('provider', 'This Project coordinator uses the native spawn provider.');
    const candidates = this.nativeDelegateCandidates(actor, exec);
    if (candidates.length !== 1) fail('request_missing', 'Record the user goal with project_request first. When this turn concerns multiple goals, use project_delegate with the exact requestId.');
    if (args.cwd && !samePath(args.cwd, actor.project.canonicalWorkingDirectory)) fail('fixed_directory', 'Use the Project directory; arrange independent worktrees explicitly through project_delegate.');
    const row = candidates[0], version = this.requirements.version(row);
    const result = await this.delegate(actor, {
      requestId: row.id, requestRevision: row.revision,
      title: args.description, brief: args.prompt, scope: version.scope === 'worker' ? 'development' : version.scope,
      writePaths: version.writePaths, nativeProvider: provider, nativeName: args.name, nativeOptions: options,
    }, exec);
    return { kind: result.phase === 'queued' ? 'queued' : 'activation', name: result.workerSessionId };
  }
  acceptRequest(actor, args, exec) { return this.requirements.accept(actor, args, exec); }
  async standby(actor, args, exec) {
    this.coordinatorOnly(actor); exec.signal.throwIfAborted();
    const input = this.requirements.inputs(actor, exec);
    if (input.human.length) fail('speak_required', 'The user wrote in this turn. Answer them; silence is only for a turn a host notice started.');
    if ((this.state().deliveries ?? []).some(item => item.projectId === actor.project.id && item.sessionId === actor.agent.id && item.turn === input.call.data.turn && item.status === 'draft')) fail('speak_required', 'This turn declared a handover. Give its reply instead of staying silent.');
    const blockers = this.requirements.silenceBlockers(actor.project.id);
    if (blockers.length) fail('speak_required', `Do not stay silent: ${blockers.join('; ')}.`);
    return { standby: true };
  }
  async askHuman(actor, args, exec) { this.coordinatorOnly(actor); exec.signal.throwIfAborted(); return this.requirements.ask(actor.project.id, args); }
  liveWork(projectId) {
    const workers = new Map(this.state().workers.filter(worker => worker.projectId === projectId).map(worker => [worker.sessionId, worker]));
    return new Map(this.state().workstreams.filter(work => work.projectId === projectId).map(work => [work.id, { work, worker: workers.get(work.workerSessionId), jobs: this.jobs(work.workerSessionId) }]));
  }
  autoRetry(work) {
    const failure = work.summaryFailure;
    if (!failure || failure.delegationRef !== work.currentDelegationRef) return undefined;
    const retryable = failure.retryable !== undefined ? failure.retryable : classifyExecutionError(failure.error).retryable;
    if (!retryable || failure.retryRequired) return undefined;
    const used = failure.autoRetries ?? 0;
    if (used >= this.summaryRetryDelays.length) return undefined;
    if (!this.summaryRetryTimers.has(work.projectId) && this.ctx.agents.get(this.project(work.projectId).coordinatorSessionId)?.status !== 'running') return undefined;
    return { attempt: used + 1, of: this.summaryRetryDelays.length };
  }
  needsYouCount(projectId) { try { return this.requirements.attention(projectId).length; } catch { return 0; } }
  async queueRequest(actor, args, exec) {
    this.coordinatorOnly(actor); exec.signal.throwIfAborted();
    if (!this.requirements.inputs(actor, exec).human.length) fail('unauthorized', 'Queue changes require actual human input. A settlement or host activation cannot enqueue, cancel or resume requirements.');
    return this.queue.change(actor.project.id, args);
  }
  deliver(actor, args, exec) { return this.requirements.declare(actor, args, exec); }
  source(actor, exec, stream) {
    const events = actor.agent.session.snapshotEvents();
    const call = events.findLast(event => event.type === 'tool/call' && event.data.callId === (exec.rootCallId ?? exec.callId));
    if (!call) fail('unauthorized', 'No corresponding coordinator tool call exists.');
    const start = events.findLast(event => event.type === 'turn/start' && event.data.turn === call.data.turn);
    const inputs = events.filter(event => event.type === 'user/message' && event.seq < call.seq && (!start || event.seq > start.seq));
    const input = inputs.findLast(event => event.data.source.kind === 'user') ?? inputs.findLast(event => event.data.source.kind === 'subagent-settled');
    if (!input) fail('unauthorized', 'No corresponding input message exists.');
    if (input.data.source.kind === 'user') { const human = inputs.filter(event => event.data.source.kind === 'user'); return { sessionId: actor.agent.id, messageId: input.data.id, messageIds: human.map(event => event.data.id), callId: exec.callId, text: human.map(event => content(event.data)).join('\n\n') }; }
    if (stream && input.data.source.kind === 'subagent-settled' && input.data.source.senderSessionId === stream.workerSessionId && input.data.source.runId === latest(stream).runId && !this.worker(stream.workerSessionId).stopped && !this.project(stream.projectId).paused) return { ...latest(stream).source, callId: exec.callId };
    fail('unauthorized', 'A runtime notice cannot authorize unrelated work or resume stopped work.');
  }
  async coordinator(project) {
    if (!await this.ctx.sessionPersistence.stat(project.coordinatorSessionId)) fail('session_missing', 'The original coordinator Session is missing; its association is preserved.');
    const resolved = await this.ctx.sessionController.resolveAgent(project.coordinatorSessionId);
    if ('error' in resolved) throw resolved.error;
    return resolved.agent;
  }
  async create(input) {
    return this.serial(async () => {
      required(input.requestId, 'creation request', 200);
      const directory = await this.desktop('select-directory', { workingDirectory: required(input.workingDirectory, 'working directory', 32768) });
      let project = this.state().projects.find(item => item.directoryIdentity === directory.identity);
      const reused = Boolean(project);
      if (!project) {
        const id = `project-${randomUUID()}`, root = await projectDirectory(this.home, id), now = Date.now();
        project = { id, title: (basename(directory.canonicalPath) || directory.canonicalPath).slice(0, 240), canonicalWorkingDirectory: directory.canonicalPath, directoryIdentity: directory.identity, coordinatorSessionId: `session-${randomUUID()}`, storageRoot: root, lifecycle: 'creating', paused: false, holdSourceMessageId: '', diagnostics: [], creationRequestId: input.requestId, createdAt: now, updatedAt: now };
        await this.write(state => state.projects.push(project));
      }
      if (project.lifecycle === 'creating') await this.finishCreation(project);
      return { project: copy(this.project(project.id)), reused };
    });
  }
  async finishCreation(project) {
    await safeProjectSubdirectory(this.home, project.id, 'docs'); await safeProjectSubdirectory(this.home, project.id, 'internal');
    for (const file of ['preferences.md', 'charter.md']) { try { await fs.writeFile(join(project.storageRoot, file), '', { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
    if (await this.ctx.sessionPersistence.stat(project.coordinatorSessionId)) await this.coordinator(project);
    else await this.ctx.sessionController.create({ sessionId: project.coordinatorSessionId, cwd: project.storageRoot, agentPreset: 'project-coordinator', presentation: { owner: 'project', title: project.title, workingDirectory: project.canonicalWorkingDirectory } });
    await this.ctx.sessions.flush(this.ctx.agents.get(project.coordinatorSessionId).session);
    await this.teams.setEnabled(this.ctx.agents.get(project.coordinatorSessionId), true);
    await this.write(state => { const row = state.projects.find(item => item.id === project.id); row.lifecycle = 'ready'; row.diagnostics = []; row.updatedAt = Date.now(); });
    await this.notes(project.id);
  }
  async detail(projectId, input = {}) {
    const rows = this.workRows(projectId), current = rows.filter(row => row.group === 'current'), history = rows.filter(row => row.group === 'history');
    const anchor = input.currentCursor ? current.findIndex(row => row.work.id === input.currentCursor) : -1;
    const currentCursor = anchor < 0 ? null : input.currentCursor, start = anchor + 1;
    const project = this.projectView(this.project(projectId)), revision = `${this.state().revision}:${this.archiving.has(projectId)}:${currentCursor ?? ''}`;
    if (input.since === revision) return { projectId, revision, unchanged: true };
    const page = current.slice(start, start + 20);
    return copy({
      project, revision, team: { id: project.coordinatorSessionId }, ...this.workSummaries([...page, ...history.slice(0, 3)]),
      workPage: { currentTotal: current.length, currentCursor, currentNextCursor: start + page.length < current.length ? page.at(-1).work.id : null, historyTotal: history.length, historyNextCursor: history.length > 3 ? history[2].work.id : null },
    });
  }
  workRows(projectId) { return workOps.workRows(this, projectId); }
  prerequisiteStatus(report, projectId) { return workOps.prerequisiteStatus(this, report, projectId); }
  reportView(report, projectId) { return workOps.reportView(this, report, projectId); }
  workSummaries(rows) { return workOps.workSummaries(this, rows); }
  listWorkstreams(projectId, input) { return workOps.listWorkstreams(this, projectId, input); }
  getWorkstream(projectId, input) { return workOps.getWorkstream(this, projectId, input); }
  resultHistory(projectId, input) { return workOps.resultHistory(this, projectId, input); }
  storeRoot(project) { return workOps.storeRoot(this, project); }
  storePath(project, path) { return workOps.storePath(this, project, path); }
  readStore(id, path) { return workOps.readStore(this, id, path); }
  readStoreTool(actor, args) { return workOps.readStoreTool(this, actor, args); }
  listStore(id, input) { return workOps.listStore(this, id, input); }
  writeNotes(id) { return workOps.writeNotes(this, id); }
  charterFor(id) { return workOps.charterFor(this, id); }
  decisionsFor(id) { return workOps.decisionsFor(this, id); }
  preferencesFor(id) { return workOps.preferencesFor(this, id); }
  sweepOrphans() { return workOps.sweepOrphans(this); }
  changeWorkspaces(row) { return changesOps.changeWorkspaces(this, row); }
  changePayload(projectId, area) { return changesOps.changePayload(projectId, area); }
  changeSummary(areas) { return changesOps.changeSummary(areas); }
  missingLegacyChangeWorkspaces(row) { return changesOps.missingLegacyChangeWorkspaces(this, row); }
  legacyChangesError(directories) { return changesOps.legacyChangesError(directories); }
  changesRevertible(row) { return changesOps.changesRevertible(this, row); }
  captureBaseline(projectId, requestId, worker) { return changesOps.captureBaseline(this, projectId, requestId, worker); }
  captureDeliveryChanges(delivery) { return changesOps.captureDeliveryChanges(this, delivery); }
  requestChanges(projectId, input) { return changesOps.getRequestChanges(this, projectId, input, required); }
  revertRequest(projectId, input) { return changesOps.revertRequestChanges(this, projectId, input, required); }
  async onRequestArchived(projectId, row) {
    await workOps.releaseHistoricalNativeTasks(this, projectId, { requestId: row.id });
    await changesOps.releaseRequestSnapshots(this, projectId, row);
    await changesOps.cleanupProjectWorktrees(this, projectId, { onlyArchived: true });
  }
  async afterDelivery(deliveryId) {
    const delivery = (this.state().deliveries ?? []).find(item => item.id === deliveryId);
    if (!delivery || delivery.status !== 'delivered') return;
    if (!this.closing || this.persistOnDispose) await this.serial(() => this.captureDeliveryChanges(delivery));
    await this.deliveryDecision(delivery);
  }
  async deliveryDecision(delivery) {
    const project = this.project(delivery.projectId);
    const fallback = delivery.summary.split('\n').map(line => line.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean)?.slice(0, 300) ?? '';
    await this.appendDecision(project, { id: delivery.id, title: delivery.title, revision: delivery.requestRevision, outcome: delivery.outcome, text: delivery.decision || fallback })
      .catch(error => this.ctx.logger.warn('Project decision log could not be updated: %s', error.message));
  }
  async appendDecision(project, entry) {
    const path = await this.storePath(project, 'decisions.md'), old = await fs.readFile(path, 'utf8'), tag = `<!-- decision:${entry.id} -->`;
    if (old.includes(tag)) return;
    const label = { completed: '完整交付', partial: '部分交付', reverted: '已撤销改动' }[entry.outcome] ?? entry.outcome;
    const block = `## ${new Date().toISOString().slice(0, 10)} · ${entry.title}${entry.revision ? `（第 ${entry.revision} 版）` : ''}\n${tag}\n- 结果：${label}\n${entry.text ? `- 决策：${entry.text.replace(/\s*\n\s*/g, ' ')}\n` : ''}`;
    let next = `${old.trim() ? old.replace(/\s*$/, '\n\n') : '# 决策日志\n\n'}${block}`;
    if (Buffer.byteLength(next) > 400000) { const cut = next.indexOf('\n## ', next.length - 300000); next = `# 决策日志\n\n${next.slice(cut + 1)}`; }
    await atomicText(path, next);
  }
  async delegate(actor, args, exec) {
    const id = actor.project.id, result = (this.delegationTails.get(id) ?? Promise.resolve()).then(() => this.doDelegate(actor, args, exec));
    const tail = result.then(() => {}, () => {}); this.delegationTails.set(id, tail);
    try { return await result; } finally { if (this.delegationTails.get(id) === tail) this.delegationTails.delete(id); }
  }
  doDelegate(actor, args, exec) { return launchOps.doDelegate(this, actor, args, exec); }
  ancestors(worker) {
    const ids = new Set();
    while (worker.parentSessionId) { ids.add(worker.parentSessionId); worker = this.worker(worker.parentSessionId); }
    return ids;
  }
  descendants(workerId) { return this.state().workers.filter(worker => this.ancestors(worker).has(workerId)); }
  directoryAvailable(worker, role = latest(this.stream(worker.workstreamId)).scope) { return this.directoryBlockers(worker, role).length === 0; }
  directoryInUse(directory) {
    return this.state().workers.some(worker => {
      if (!this.queue.workerBusy(worker)) return false;
      const occupied = worker.cwd || (worker.mode === 'existing' ? this.project(worker.projectId).canonicalWorkingDirectory : '');
      return occupied && (within(directory, occupied) || within(occupied, directory));
    });
  }
  directoryBlockers(worker, role) {
    if (readOnly(role)) return [];
    const cwd = worker.cwd || (worker.mode === 'existing' ? this.project(worker.projectId).canonicalWorkingDirectory : '');
    if (!cwd) return [];
    return this.state().workers.filter(other => {
      if (other.sessionId === worker.sessionId || !other.directoryHeld) return false;
      if (this.ancestors(worker).has(other.sessionId) && !this.jobs(other.sessionId).length) return false;
      const occupied = other.cwd || (other.mode === 'existing' ? this.project(other.projectId).canonicalWorkingDirectory : '');
      if (!occupied || !(within(cwd, occupied) || within(occupied, cwd))) return false;
      const own = latest(this.stream(worker.workstreamId)), held = latest(this.stream(other.workstreamId));
      if (role !== 'docs' || held.scope !== 'docs' || !own.writePaths.length || !held.writePaths.length) return true;
      return own.writePaths.some(path => held.writePaths.some(otherPath => {
        const a = resolve(cwd, path), b = resolve(occupied, otherPath);
        return samePath(a, b) || within(a, b) || within(b, a);
      }));
    });
  }
  launch(id, signal = new AbortController().signal) {
    if (this.launches.has(id)) return this.launches.get(id);
    const ref = latest(this.stream(id)).ref, scheduleRevision = this.scheduleRevision;
    const promise = this.doLaunch(id, signal).finally(() => {
      this.launches.delete(id);
      if (latest(this.stream(id)).ref !== ref || latest(this.stream(id)).phase === 'failed' || latest(this.stream(id)).phase === 'queued' && this.scheduleRevision !== scheduleRevision
        || !this.queue.active(this.stream(id).projectId) && this.queue.pending(this.stream(id).projectId).length) this.schedule();
    });
    this.launches.set(id, promise); return promise;
  }
  doLaunch(id, signal) { return launchOps.doLaunch(this, id, signal); }
  isContinuationPaused(project, worker, parent) {
    return !this.admissionOpen() || this.closing || this.recovering || this.projectHolds.has(project.id) || this.held.has(worker.sessionId)
      || this.archiving.has(project.id) || parent.id !== (worker.parentSessionId ?? project.coordinatorSessionId)
      || this.ctx.agents.get(parent.id) !== parent || project.lifecycle !== 'ready' || project.paused || worker.stopped || worker.phase === 'stopping';
  }
  async admit({ parent, childId, reason, settlement }) {
    if (settlement) await this.runEnded({ id: childId, runId: settlement.runId, stopReason: settlement.stopReason, lastAssistantMessage: settlement.output });
    const worker = this.worker(childId), project = this.project(worker.projectId), assignment = latest(this.stream(worker.workstreamId));
    if (assignment.source.requestId && !this.queue.acceptsWork(this.requirements.get(project.id, assignment.source.requestId), assignment.source.requestRevision, assignment.scope)) fail('request_queued', 'The requirement is no longer active.');
    if (this.isContinuationPaused(project, worker, parent)) fail('paused', 'Project continuation is stopped or paused.');
    if (reason !== 'settlement' && (!worker.cwd || !this.directoryAvailable(worker))) fail('directory_busy', 'The writable directory is occupied.');
    if (reason !== 'settlement' && (this.stream(worker.workstreamId).blockedBy ?? []).some(id => !this.acceptedWork(this.stream(id)))) fail('dependencies', 'This work is waiting for its dependencies to complete.');
  }
  runStarted(info) {
    if (this.closing && !this.persistOnDispose) return Promise.resolve();
    if (!this.state().workers.some(item => item.sessionId === info.id)) return Promise.resolve();
    if (!this.terminals.has(info.runId)) { let done; const promise = new Promise(r => { done = r; }); this.terminals.set(info.runId, { promise, resolve: done }); }
    return this.serial(() => this.write(state => {
      const work = state.workstreams.find(item => item.workerSessionId === info.id), member = state.workers.find(item => item.sessionId === info.id);
      member.activeRunId = info.runId;
      const submitted = work.delegations.find(item => item.ref === member.reservationRef);
      if (submitted?.phase === 'preparing') submitted.runId = info.runId;
      if (!member.stopped) { member.phase = 'active'; member.directoryHeld = !readOnly(latest(work).scope); work.status = 'running'; }
    }));
  }
  releaseWorkerOnRunEnd(work, member, runId) {
    if (member.activeRunId !== runId) return;
    member.activeRunId = '';
    const reservation = work.delegations.find(item => item.ref === member.reservationRef);
    const preparing = reservation?.phase === 'preparing' && !reservation.runId;
    member.phase = member.stopped ? 'stopping' : preparing ? 'provisioning' : 'idle';
    const hasJobs = !readOnly(member.role) && this.jobs(member.sessionId).length > 0;
    member.directoryHeld = member.stopped || this.held.has(member.sessionId)
      ? member.directoryHeld || hasJobs
      : Boolean(preparing && !readOnly(reservation.scope)) || hasJobs;
  }
  runEnded(info) {
    if (this.closing && !this.persistOnDispose) { this.terminals.get(info.runId)?.resolve(); return Promise.resolve(); }
    const worker = this.state().workers.find(item => item.sessionId === info.id);
    if (!worker) return Promise.resolve();
    const topLevel = this.isTopLevelWorker(worker);
    let failureReason = null;
    const result = this.serial(async () => {
      await this.write(state => {
        const work = state.workstreams.find(item => item.id === worker.workstreamId), member = state.workers.find(item => item.sessionId === info.id);
        if (work.settlements.some(item => item.runId === info.runId)) return;
        const refs = work.delegations.filter(item => item.runId === info.runId).map(item => item.ref);
        if (refs.length > 0) {
          work.settlements.push({ runId: info.runId, delegationRefs: refs, stopReason: info.stopReason, summary: (info.lastAssistantMessage ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n'), at: Date.now(), merged: true, noticeMessageId: '', summarizedBy: '' });
          if (topLevel) work.pendingSummary = true;
        }
        this.releaseWorkerOnRunEnd(work, member, info.runId);
        const receipt = latest(work);
        if (refs.includes(receipt.ref)) failureReason = applyRunEndStatus(this, work, member, receipt, info);
        work.updatedAt = member.updatedAt = Date.now();
      });
      await this.completeTask(this.stream(worker.workstreamId));
      await this.notes(worker.projectId);
    });
    const settled = result.then(async () => {
      if (failureReason) {
        await workOps.recordFailureAndEscalate(this, worker.workstreamId, { reason: failureReason, category: 'unknown', retryRequired: false })
          .catch(err => this.ctx.logger?.warn?.('Failure escalation skipped: %s', err.message));
      }
    });
    settled.then(() => this.terminals.get(info.runId)?.resolve(), error => this.terminals.get(info.runId)?.resolve({ error }));
    settled.then(() => { this.schedule(); if (topLevel) this.scheduleSettlementCheck(worker.projectId); }, error => this.ctx.logger.warn('Project settlement failed: %s', error.message));
    return settled;
  }
  preStep(input, next) { return runtimeGuard.handlePreStep(this, input, next); }
  consume(sessionId, turn, streams) {
    const session = this.ctx.agents.get(sessionId)?.session, previous = this.consumed.get(sessionId);
    const entries = previous?.session === session && previous?.turn === turn ? previous.streams.map(entry => ({ ...entry, runs: [...entry.runs], reports: [...entry.reports] })) : [];
    for (const facts of streams) { const entry = entries.find(item => item.id === facts.id); if (entry) { entry.runs = [...new Set([...entry.runs, ...facts.runs])]; entry.reports = [...new Set([...entry.reports, ...facts.reports])]; } else entries.push(facts); }
    this.consumed.set(sessionId, { session, turn, streams: entries });
  }
  guard(exec) { return runtimeGuard.guardToolExecution(this, exec); }
  researchHosts(project) { return runtimeGuard.researchHosts(project); }
  researchCall(worker, exec) { return runtimeGuard.researchCall(this, worker, exec); }
  async assistantReply(session, event) {
    if (this.closing && !this.persistOnDispose) return;
    if (event.type === 'team/task' && this.state().projects.some(project => project.coordinatorSessionId === session.id)) this.schedule();
    if (event.type === 'turn/end') {
      await this.requirements.turnEnded(session, event); await this.summaryTurnEnded(session, event);
      if (this.state().projects.some(project => project.coordinatorSessionId === session.id)) this.schedule();
    }
  }
  async summaryTurnEnded(session, event) {
    const consumed = this.consumed.get(session.id);
    if (!consumed || consumed.session !== session || consumed.turn !== event.data.turn) return;
    this.consumed.delete(session.id);
    if (event.data.reason.kind !== 'error') return;
    let escalations = [];
    await this.serial(async () => {
      const project = this.state().projects.find(item => item.coordinatorSessionId === session.id);
      const human = this.userTurns.get(session.id), humanSummary = human?.agent.session === session && human.turn === event.data.turn;
      if (!project || project.paused && !humanSummary || project.lifecycle !== 'ready' || this.projectHolds.has(project.id) || this.archiving.has(project.id)) return;
      const failed = consumed.streams.flatMap(entry => {
        const work = this.stream(entry.id, project.id), receipt = latest(work), report = receipt.report;
        const terminal = work.settlements.find(item => item.runId === receipt.runId && item.delegationRefs.includes(receipt.ref) && !item.summarizedBy && entry.runs.includes(item.runId));
        const reportConsumed = report && !report.summarizedBy && entry.reports.includes(receipt.ref);
        return work.pendingSummary && (reportConsumed || terminal) && (!this.worker(work.workerSessionId).stopped || humanSummary) ? [{ id: work.id, runId: terminal?.runId }] : [];
      });
      if (!failed.length) return;
      const { code, message } = event.data.reason.error, classified = classifyExecutionError(event.data.reason.error);
      await this.write(state => {
        for (const entry of failed) {
          const work = state.workstreams.find(item => item.id === entry.id);
          const retries = work.summaryFailure?.delegationRef === work.currentDelegationRef ? work.summaryFailure.autoRetries ?? 0 : 0;
          work.summaryFailure = { turn: event.data.turn, at: event.time, delegationRef: work.currentDelegationRef, ...(entry.runId ? { runId: entry.runId } : {}), error: { code, message }, ...(retries ? { autoRetries: retries } : {}), retryable: classified.retryable, category: classified.category, retryRequired: classified.retryRequired };
          work.updatedAt = event.time;
        }
      });
      await this.notes(project.id);
      if (classified.retryRequired) escalations = failed.map(entry => ({ id: entry.id, reason: message, category: classified.category }));
      else if (!humanSummary) this.scheduleSummaryRetry(project.id, code);
    });
    for (const entry of escalations) {
      await workOps.recordFailureAndEscalate(this, entry.id, { reason: entry.reason, category: entry.category, retryRequired: true })
        .catch(err => this.ctx.logger?.warn?.('Summary failure escalation skipped: %s', err.message));
    }
  }
  scheduleSummaryRetry(projectId, code, delay) {
    if (this.closing || !this.admissionOpen() || !classifyExecutionError({ code, message: '' }).retryable) return;
    const attempt = Math.max(0, ...this.state().workstreams.filter(work => work.projectId === projectId && work.pendingSummary && work.summaryFailure?.delegationRef === work.currentDelegationRef && !work.summaryFailure.retryRequired).map(work => work.summaryFailure.autoRetries ?? 0));
    delay ??= this.summaryRetryDelays[attempt]; if (delay === undefined) return;
    clearTimeout(this.summaryRetryTimers.get(projectId));
    const timer = setTimeout(() => { this.summaryRetryTimers.delete(projectId); this.summaryRetry(projectId, code).catch(error => this.ctx.logger.warn('Project summary retry failed: %s', error.message)); }, delay);
    timer.unref?.(); this.summaryRetryTimers.set(projectId, timer);
  }
  cancelSummaryRetry(projectId) { clearTimeout(this.summaryRetryTimers.get(projectId)); this.summaryRetryTimers.delete(projectId); }
  async summaryRetry(projectId, code) {
    if (!this.admissionOpen()) return;
    let message;
    await this.serial(async () => {
      const project = this.state().projects.find(item => item.id === projectId);
      if (!project || this.closing || this.recovering || !this.admissionOpen() || project.paused || project.lifecycle !== 'ready' || this.archiving.has(projectId) || this.projectHolds.has(projectId)) return;
      const lead = this.ctx.agents.get(project.coordinatorSessionId);
      if (lead?.status === 'running') { this.scheduleSummaryRetry(projectId, code, 5000); return; }
      const failed = this.state().workstreams.filter(work => work.projectId === projectId && work.pendingSummary && work.summaryFailure?.delegationRef === work.currentDelegationRef && work.summaryFailure.retryable !== false && !work.summaryFailure.retryRequired && !this.worker(work.workerSessionId).stopped);
      if (!failed.length) return;
      const text = `The Project host is trying a summary again: the model service reported a temporary error (${code}) while you were summarizing. Read notes.md and summarize the saved results of: ${failed.map(work => `${work.title} (${work.id})`).join('; ')}. This only retries the summary. Do not start, restart or revise work, and it is not new user authorization.`;
      message = createUserMessage({ source: { kind: summaryRetryPlugin, form: 'notice', summary: boundContextSummary(`Summary retry: ${failed.map(work => work.title).join('; ')}`) }, content: [{ type: 'text', text }] });
      await this.write(state => { for (const work of failed) { const item = state.workstreams.find(row => row.id === work.id); item.summaryFailure.autoRetries = (item.summaryFailure.autoRetries ?? 0) + 1; } });
    });
    if (!message || !this.admissionOpen()) return;
    (await this.coordinator(this.project(projectId))).followup(message);
  }
  scheduleSettlementCheck(projectId, delay = this.settlementCheckDelay) {
    if (this.closing || !this.admissionOpen()) return;
    clearTimeout(this.settlementCheckTimers.get(projectId));
    const timer = setTimeout(() => { this.settlementCheckTimers.delete(projectId); this.settlementCheck(projectId).catch(error => this.ctx.logger.warn('Project settlement check failed: %s', error.message)); }, delay);
    timer.unref?.(); this.settlementCheckTimers.set(projectId, timer);
  }
  cancelSettlementCheck(projectId) { clearTimeout(this.settlementCheckTimers.get(projectId)); this.settlementCheckTimers.delete(projectId); this.settlementChecks.delete(projectId); }
  unreadSettlements(projectId) {
    return this.state().workstreams.filter(work => {
      if (work.projectId !== projectId || !work.pendingSummary || work.summaryFailure) return false;
      const worker = this.worker(work.workerSessionId);
      if (worker.stopped || !this.isTopLevelWorker(worker)) return false;
      return work.settlements.some(item => !item.noticeMessageId && !item.recoveryNoticeMessageId && !item.summarizedBy && item.delegationRefs.includes(work.currentDelegationRef));
    });
  }
  settlementNoticeMatches(work, receipt, message) {
    return message.source.kind === settlementCheckPlugin && work.currentDelegationRef === receipt.ref
      && !this.worker(work.workerSessionId).stopped && work.settlements.some(item => item.runId === receipt.runId && item.delegationRefs.includes(receipt.ref) && item.recoveryNoticeMessageId === message.id);
  }
  async settlementCheck(projectId) {
    if (!this.admissionOpen()) return;
    let message, lead;
    await this.serial(async () => {
      const project = this.state().projects.find(item => item.id === projectId);
      if (!project || this.closing || this.recovering || !this.admissionOpen() || project.paused || project.lifecycle !== 'ready' || this.archiving.has(projectId) || this.projectHolds.has(projectId)) return;
      const unread = this.unreadSettlements(projectId);
      if (!unread.length) { this.settlementChecks.delete(projectId); return; }
      const waited = (this.settlementChecks.get(projectId) ?? 0) + 1;
      if (this.ctx.agents.get(project.coordinatorSessionId)?.status === 'running') {
        if (waited <= 120) { this.settlementChecks.set(projectId, waited); this.scheduleSettlementCheck(projectId, 15000); } else this.settlementChecks.delete(projectId);
        return;
      }
      this.settlementChecks.delete(projectId);
      lead = await this.coordinator(project);
      const text = `The Project host found member results that you have not read yet: ${unread.map(work => `${work.title} (${work.id})`).join('; ')}. Read notes.md and the saved reports, then arrange the next stage or deliver as you normally would after a result arrives. This only brings the results to you; it is not new user authorization.`;
      message = createUserMessage({ source: { kind: settlementCheckPlugin, form: 'notice', summary: boundContextSummary(`Unread results: ${unread.map(work => work.title).join('; ')}`) }, content: [{ type: 'text', text }] });
      await this.write(state => { for (const work of unread) { const current = state.workstreams.find(item => item.id === work.id); for (const item of current.settlements) if (!item.noticeMessageId && !item.recoveryNoticeMessageId && !item.summarizedBy && item.delegationRefs.includes(current.currentDelegationRef)) item.recoveryNoticeMessageId = message.id; } });
    });
    if (!message || this.closing || !this.admissionOpen() || this.project(projectId).paused || this.projectHolds.has(projectId) || this.archiving.has(projectId)) return;
    lead.followup(message);
  }
  assertReportActive(worker, assignment, delegationRef) {
    if (assignment?.source.requestId && this.queue.state(this.requirements.get(worker.projectId, assignment.source.requestId)) === 'cancelled') fail('obsolete_result', 'The requirement was cancelled. Its late result cannot revive development.');
    if (this.held.has(worker.sessionId) || worker.stopped || worker.consumedDelegationRef !== delegationRef || !assignment || assignment.runId !== worker.activeRunId || this.project(worker.projectId).paused) fail('obsolete_result', 'The report is not for the current consumed delegation.');
    if (this.descendants(worker.sessionId).some(child => this.queue.workerBusy(child) || ['queued', 'preparing'].includes(latest(this.stream(child.workstreamId)).phase))) fail('work_pending', 'Finish or stop delegated descendants before reporting this work.');
  }
  validateReportInput(worker, _stream, assignment, args) {
    this.assertReportActive(worker, assignment, args.delegationRef);
    if (!['completed', 'blocked', 'failed'].includes(args.outcome)) fail('invalid_result', 'Choose completed, blocked or failed.');
    const paths = args.artifacts ?? [], evidence = args.evidence ?? [], remainingIssues = args.remainingIssues ?? [];
    if (!Array.isArray(paths) || paths.length > 64 || !Array.isArray(evidence) || evidence.some(item => typeof item !== 'string') || !Array.isArray(remainingIssues) || remainingIssues.some(item => typeof item !== 'string')) fail('invalid_result', 'Artifacts, evidence and remaining issues must be bounded text lists.');
    const humanAction = args.humanAction === undefined ? undefined : args.outcome === 'completed' ? fail('invalid_result', 'Only a blocked or failed report can ask the user a question.') : this.requirements.askFields(args.humanAction);
    return { paths, evidence, remainingIssues, humanAction };
  }
  async report(actor, args, exec) {
    if (actor.role !== 'worker') fail('unauthorized', 'Only the assigned worker can report.');
    const worker = this.worker(actor.agent.id), stream = this.stream(worker.workstreamId), artifacts = [];
    const assignment = stream.delegations.find(item => item.ref === args.delegationRef);
    const { paths, evidence, remainingIssues, humanAction } = this.validateReportInput(worker, stream, assignment, args);
    for (const path of paths) artifacts.push(await checkedFile(path, [worker.cwd, join(actor.project.storageRoot, 'docs', stream.id)]));
    const baseReport = { delegationRef: args.delegationRef, outcome: args.outcome, summary: required(args.summary, 'result summary'), artifacts, evidence, remainingIssues, at: Date.now(), callId: exec.callId, ...(assignment.prerequisites === undefined ? {} : { prerequisites: copy(assignment.prerequisites) }) };
    const probe = await probeReportEvidence({ report: baseReport, worker, project: actor.project, events: actor.agent.session?.snapshotEvents?.() }).catch(() => null);
    const report = probe ? { ...baseReport, ...(probe.evidenceChecks.length ? { evidenceChecks: probe.evidenceChecks } : {}), probeSummary: probe.probeSummary } : baseReport;
    await this.serial(async () => {
      const current = this.worker(worker.sessionId);
      if (current.stopped || current.consumedDelegationRef !== args.delegationRef || assignment.runId !== current.activeRunId) fail('obsolete_result', 'The assignment changed while reporting.');
      await this.write(state => {
        const work = state.workstreams.find(item => item.id === stream.id);
        work.delegations.find(item => item.ref === args.delegationRef).report = report;
        if (work.currentDelegationRef === args.delegationRef) work.latestReport = report;
        work.updatedAt = Date.now();
        const asked = humanAction && assignment.source.requestId ? state.requests?.find(item => item.id === assignment.source.requestId && item.revision === assignment.source.requestRevision) : undefined;
        if (asked) this.requirements.placeAsk(asked, humanAction, { by: 'member', workstreamId: stream.id, delegationRef: args.delegationRef }, Date.now());
      });
      await this.notes(worker.projectId);
    });
    return { recorded: true, workstreamId: stream.id, report: this.reportView(report, actor.project.id), resultRef: { teamId: actor.project.coordinatorSessionId, taskId: stream.id, assignmentRef: report.delegationRef, reportId: report.callId } };
  }
  async stopTool(actor, args) { this.coordinatorOnly(actor); return this.stop(actor.project.id, args.workstreamId); }
  async stop(projectId, workstreamId, { recordHold = true } = {}) {
    if (this.closing && !this.persistOnDispose) return { projectId, workstreamId, state: 'stopping' };
    const project = this.project(projectId);
    const streams = workstreamId ? [this.stream(workstreamId, projectId), ...this.descendants(this.stream(workstreamId, projectId).workerSessionId).map(worker => this.stream(worker.workstreamId))] : this.state().workstreams.filter(item => item.projectId === projectId);
    const ids = streams.map(item => item.workerSessionId);
    const lead = this.ctx.agents.get(project.coordinatorSessionId);
    const lastUserEvent = lead?.session?.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user');
    if (recordHold) for (const work of streams) this.workerStops.set(work.workerSessionId, { generation: (this.workerStops.get(work.workerSessionId)?.generation ?? 0) + 1, sourceMessageId: lastUserEvent?.data.id ?? latest(work).source.messageId });
    if (!workstreamId) { this.projectHolds.set(projectId, lastUserEvent?.data.id ?? ''); lead?.cancel({ kind: 'user' }); }
    for (const id of ids) { this.held.add(id); this.approvals.clear(id); this.ctx.agents.get(id)?.cancel({ kind: 'user' }); for (const job of this.jobs(id)) this.ctx.get('jobs').kill(job.id, id, 'Project work stopped'); }
    let persistenceError;
    try {
      await this.serial(() => this.write(state => {
        if (!workstreamId) {
          const row = state.projects.find(item => item.id === projectId); row.paused = true; if (lastUserEvent) row.holdSourceMessageId = lastUserEvent.data.id;
          for (const request of state.requests ?? []) if (request.projectId === projectId && ['active', 'queued'].includes(this.queue.state(request)) && this.queue.unfinished(request)) { request.queue = { ...request.queue, state: this.queue.state(request), suspended: true }; delete request.queue.activation; }
        }
        for (const work of state.workstreams.filter(item => ids.includes(item.workerSessionId))) {
          const member = state.workers.find(item => item.sessionId === work.workerSessionId); member.stopped = true;
          if (recordHold) member.holdSourceMessageId = lastUserEvent?.data.id ?? latest(work).source.messageId;
          member.phase = this.ctx.agents.get(member.sessionId)?.status === 'running' || this.launches.has(work.id) || this.jobs(member.sessionId).length ? 'stopping' : 'idle';
          for (const receipt of work.delegations.filter(item => ['queued', 'preparing'].includes(item.phase))) receipt.phase = 'stopped';
          if (work.status !== 'done') { work.status = 'blocked'; work.blockedReason = 'stopped'; } work.updatedAt = Date.now();
        }
      }));
    } catch (error) { persistenceError = error; }
    for (const id of ids) if (!this.stops.has(id)) {
      const promise = this.finishStop(project, [id]).catch(async error => {
        if (this.closing && !this.persistOnDispose) { this.ctx.logger.warn('Project runtime stop needs attention: %s', error.message); return; }
        try { await this.serial(async () => { await this.write(state => { const worker = state.workers.find(item => item.sessionId === id); if (worker.phase === 'stopping') { worker.error = error.message; state.workstreams.find(item => item.id === worker.workstreamId).blockedReason = error.message; } }); await this.notes(projectId); }); }
        catch (recordingError) { this.ctx.logger.warn('Project stop diagnostic could not be saved: %s', recordingError.message); }
        this.ctx.logger.warn('Project stop needs attention: %s', error.message);
      }).finally(() => this.stops.delete(id));
      this.stops.set(id, promise);
    }
    await this.serial(() => this.notes(projectId)).catch(error => this.ctx.logger.warn('Project stopped; notes could not be refreshed: %s', error.message));
    if (persistenceError) throw persistenceError;
    return { projectId, workstreamId, state: ids.some(id => this.worker(id).phase === 'stopping') ? 'stopping' : 'stopped' };
  }
  async finishStop(project, ids) {
    for (const id of ids) {
      await this.drainWorker(project, id);
      if (this.closing && !this.persistOnDispose) return;
      await this.serial(() => this.write(state => { const row = state.workers.find(item => item.sessionId === id); row.phase = 'idle'; row.activeRunId = ''; row.reservationRef = ''; row.directoryHeld = false; row.updatedAt = Date.now(); }));
    }
    await this.serial(() => this.notes(project.id)).catch(error => this.ctx.logger.warn('Project drained; notes could not be refreshed: %s', error.message)); this.schedule();
  }
  async drainWorker(project, id) {
    const member = this.worker(id), launch = this.launches.get(member.workstreamId);
    if (launch) await launch.catch(() => { /* Launch owner handles its own failure; teardown still drains the worker. */ });
    const agent = this.ctx.agents.get(id), jobs = this.ctx.get('jobs'), owned = this.jobs(id);
    for (const job of owned) jobs.kill(job.id, id, 'Project work stopped');
    const waits = owned.map(job => jobs.wait(job.id, 30000, id)); agent?.cancel({ kind: 'user' });
    const parent = this.ctx.agents.get(member.parentSessionId ?? project.coordinatorSessionId); if (parent) await this.ctx.subagents.drainChildren(parent, [id]);
    if (agent) await agent.whenIdle();
    for (const after of await Promise.all(waits)) if (['running', 'stopping'].includes(after.status)) fail('stopping', 'A worker-owned job has not stopped; the directory stays occupied.');
  }
  schedule() {
    if (this.closing || this.recovering || !this.admissionOpen()) return;
    this.scheduleRevision++; this.scheduleRequested = true;
    if (this.scheduling) return; this.scheduling = true;
    void (async () => {
      do {
        this.scheduleRequested = false;
        if (!this.admissionOpen()) break;
        for (const project of this.state().projects) await this.queue.pump(project.id).catch(error => this.ctx.logger.warn('Project queue handoff blocked: %s', error.message));
        for (const work of this.state().workstreams) if (!this.projectHolds.has(work.projectId) && !this.held.has(work.workerSessionId) && !this.worker(work.workerSessionId).stopped && !this.project(work.projectId).paused && latest(work).phase === 'queued') await this.launch(work.id).catch(error => this.ctx.logger.warn('Project queued work blocked: %s', error.message));
      } while (this.scheduleRequested && !this.closing && this.admissionOpen());
    })().finally(() => { this.scheduling = false; });
  }
  async jobChanged(event) {
    if (this.closing && !this.persistOnDispose) return;
    if (event.type !== 'settled' && event.type !== 'removed') return;
    const id = event.job.owner, member = this.state().workers.find(item => item.sessionId === id);
    if (!member || member.activeRunId || this.launches.has(member.workstreamId) || this.jobs(id).length || this.ctx.agents.get(id)?.status === 'running' || member.phase === 'stopping' || member.stopped || this.held.has(id)) return;
    await this.serial(async () => {
      const current = this.worker(id);
      if (current.activeRunId || this.launches.has(current.workstreamId) || this.jobs(id).length || this.ctx.agents.get(id)?.status === 'running' || current.phase === 'stopping' || current.stopped || this.held.has(id)) return;
      await this.write(state => {
        const worker = state.workers.find(item => item.sessionId === id); worker.directoryHeld = false;
        const work = state.workstreams.find(item => item.id === worker.workstreamId), receipt = latest(work);
        if (!worker.stopped && receipt.report && work.settlements.some(terminal => terminal.delegationRefs.includes(receipt.ref) && terminal.stopReason === 'completed')) { work.status = receipt.report.outcome === 'completed' ? 'done' : 'blocked'; work.blockedReason = receipt.report.outcome === 'completed' ? '' : receipt.report.summary; }
      });
      await this.completeTask(this.stream(member.workstreamId)); await this.notes(member.projectId);
    });
    this.schedule();
  }
  projectFacts(project) { return { title: project.title, canonicalWorkingDirectory: project.canonicalWorkingDirectory, storageRoot: project.storageRoot, lifecycle: project.lifecycle, activity: this.projectView(project).activity, queue: this.queue.summary(project.id) }; }
  contextFor(id) {
    const project = this.state().projects.find(item => item.coordinatorSessionId === id);
    return project ? `Current Project host facts (data):\n${JSON.stringify(this.projectFacts(project))}\ncanonicalWorkingDirectory is the user's bound repository. storageRoot is only the Project materials directory and this coordinator's cwd. Project records describe prior work; repository contents are established by actual inspection.` : '';
  }
  humanTurnOpen(sessionId) {
    const lead = this.ctx.agents.get(sessionId), human = this.userTurns.get(sessionId);
    const events = lead?.session.snapshotEvents() ?? [], started = events.findLast(event => event.type === 'turn/start');
    return Boolean(lead?.status === 'running' && human?.agent === lead && human.turn === started?.data.turn && !events.some(event => event.type === 'turn/end' && event.data.turn === human.turn && event.seq > started.seq));
  }
  notes(id) {
    const run = (this.notesWrites.get(id) ?? Promise.resolve()).catch(() => { /* Previous notes error reported to its caller; next write still proceeds. */ }).then(() => this.writeNotes(id));
    this.notesWrites.set(id, run);
    void run.finally(() => { if (this.notesWrites.get(id) === run) this.notesWrites.delete(id); }).catch(() => { /* Original promise returned to caller; cleanup ignores duplicate rejection. */ });
    return run;
  }
  async writeArtifact(actor, args, exec) {
    if (actor.role !== 'worker' || this.worker(actor.agent.id).stopped) fail('unauthorized', 'Only an active assigned worker may write materials.');
    if (typeof args.path !== 'string' || !/^[a-zA-Z0-9_.-]{1,140}$/.test(args.path) || ['.', '..'].includes(args.path)) fail('store_path', 'Use one material filename.');
    if (typeof args.text !== 'string' || Buffer.byteLength(args.text, 'utf8') > 512000) fail('store_size', 'Material exceeds the write limit.');
    const root = await safeProjectSubdirectory(this.home, actor.project.id, args.internal ? 'internal' : 'docs', actor.worker.workstreamId), path = join(root, args.path);
    exec.signal.throwIfAborted();
    if (this.worker(actor.agent.id).stopped || this.project(actor.project.id).paused) fail('stopped', 'Project work was stopped before writing the material.');
    await fs.writeFile(path, args.text, { flag: 'wx', mode: 0o600 }); return { path };
  }
  recover() { return launchOps.recoverAll(this); }
  async writeStoreCommand(project, input) {
    return this.serial(async () => {
      if (this.project(project.id).lifecycle !== 'ready' || this.archiving.has(project.id)) fail('archived', 'Restore this Project before editing its materials.');
      if (!['notes.md', 'preferences.md', 'charter.md', 'research-hosts.txt'].includes(input.path) || typeof input.text !== 'string' || Buffer.byteLength(input.text, 'utf8') > 256000) fail('store_path', 'Only notes正文, preferences and charter may be edited.');
      if (input.path === 'research-hosts.txt' && Buffer.byteLength(input.text, 'utf8') > 16000) fail('store_size', 'The research sites list is limited to 16000 bytes.');
      if (input.path === 'charter.md' && Buffer.byteLength(input.text, 'utf8') > workOps.CHARTER_LIMIT) fail('store_size', `Project rules are limited to ${workOps.CHARTER_LIMIT} bytes; shorten them before saving.`);
      const path = await this.storePath(project, input.path);
      if (input.path === 'notes.md') {
        if (input.text.includes(workOps.NOTES_MARKER)) fail('store_path', 'Edit only the user notes body, not the generated section.');
        const old = await fs.readFile(path, 'utf8');
        if (!old.includes(workOps.NOTES_MARKER)) fail('store_path', 'The generated notes separator is missing.');
        await atomicText(path, workOps.boundedNotesGenerated(old.slice(0, old.indexOf(workOps.NOTES_MARKER))) + workOps.NOTES_MARKER + '\n' + input.text);
      } else await atomicText(path, input.text);
      await this.write(state => { state.projects.find(item => item.id === project.id).updatedAt = Date.now(); });
      return this.readStore(project.id, input.path);
    });
  }
  async openCommand(project, input) {
    if (!input.path) return this.desktop('open-path', { projectId: project.id, workingDirectory: project.canonicalWorkingDirectory, path: project.canonicalWorkingDirectory });
    if (input.workstreamId) {
      const work = this.stream(input.workstreamId, project.id), worker = this.worker(work.workerSessionId);
      const requestedPath = await fs.realpath(resolve(input.path));
      const artifact = work.delegations.filter(item => !input.delegationRef || item.ref === input.delegationRef).flatMap(item => item.report?.artifacts ?? []).find(item => samePath(item.path, requestedPath));
      if (!artifact) fail('store_path', 'The selected result did not report this artifact.');
      const checked = await checkedFile(artifact.path, [worker.cwd, join(project.storageRoot, 'docs', work.id)]);
      const opened = await this.desktop('resolve-path', { projectId: project.id, workstreamId: work.id, workingDirectory: worker.cwd, path: checked.path });
      return { ...opened, modifiedSinceReport: checked.sha256 !== artifact.sha256 };
    }
    if (!String(input.path).startsWith('docs/')) fail('store_path', 'Desktop material opening is limited to Project docs.');
    return this.desktop('resolve-path', { projectId: project.id, path: await this.storePath(project, input.path) });
  }
  async command(endpoint, input = {}) {
    if (endpoint === 'list' && !this.available) return { projects: [], available: false, error: this.error || 'Project Host is unavailable.' };
    if (!this.available || this.closing) fail('unavailable', this.error || 'Project Host is unavailable.');
    if (endpoint === 'list') return copy({ projects: this.state().projects.map(project => this.projectView(project)).sort((a, b) => b.updatedAt - a.updatedAt), available: true });
    if (endpoint === 'create') return this.create(input);
    if (endpoint === 'directory/check') return this.desktop('check-directory', { workingDirectory: required(input.workingDirectory, 'working directory', 32768) });
    const project = this.project(input.projectId);
    const handlers = {
      detail: () => this.detail(project.id, input),
      'requests/list': () => this.requirements.listCards(project.id, input),
      'requests/get': () => this.requirements.getCard(project.id, required(input.requestId, 'task identity', 200)),
      'requests/attention': () => this.requirements.listAttention(project.id),
      'requests/queue': () => this.queue.change(project.id, input),
      'requests/changes': () => this.requestChanges(project.id, input),
      'requests/revert': () => this.revertRequest(project.id, input),
      'requests/archive': () => this.requirements.setArchived(project.id, required(input.requestId, 'task identity', 200), true),
      'requests/restore': () => this.requirements.setArchived(project.id, required(input.requestId, 'task identity', 200), false),
      'workstreams/list': () => this.listWorkstreams(project.id, input),
      'workstreams/get': () => this.getWorkstream(project.id, input),
      stop: () => { if (!input.workstreamId) this.ctx.agents.get(project.coordinatorSessionId)?.cancel({ kind: 'user' }); return this.stop(project.id, input.workstreamId); },
      pause: () => { this.ctx.agents.get(project.coordinatorSessionId)?.cancel({ kind: 'user' }); return this.stop(project.id, undefined); },
      restore: async () => { await this.serial(async () => { await this.write(state => { const row = state.projects.find(item => item.id === project.id); row.paused = false; row.lifecycle = 'ready'; row.updatedAt = Date.now(); }); await this.notes(project.id); }); return { project: copy(this.project(project.id)), note: 'Ready for a new user message; old requests are not automatically started.' }; },
      archive: () => launchOps.archiveProject(this, project),
      cleanup: () => launchOps.cleanupProject(this, project),
      reset: () => launchOps.resetProject(this, project),
      rename: async () => { const title = required(input.title, 'project title', 240); await this.serial(() => this.write(state => { const row = state.projects.find(item => item.id === project.id); row.title = title; row.updatedAt = Date.now(); })); const root = await this.coordinator(this.project(project.id)); root.session.append('session/presentation', { owner: 'project', title, workingDirectory: project.canonicalWorkingDirectory }); await this.ctx.sessions.flush(root.session); await this.notes(project.id); return { project: copy(this.project(project.id)) }; },
      'store/list': () => this.listStore(project.id, input),
      'store/results': () => this.resultHistory(project.id, input),
      'store/read': () => this.readStore(project.id, input.path),
      'store/write': () => this.writeStoreCommand(project, input),
      open: () => this.openCommand(project, input),
      diff: async () => { const work = this.stream(input.workstreamId, project.id), worker = this.worker(work.workerSessionId); return { snapshot: await this.desktop('snapshot', { projectId: project.id, workstreamId: work.id, workspace: worker.workspace }), worker: { cwd: worker.cwd, mode: worker.mode, ...(worker.branch ? { branch: worker.branch } : {}) } }; },
    };
    if (Object.hasOwn(handlers, endpoint)) return handlers[endpoint]();
    fail('unknown_command', 'This Project command is unavailable. Delegation and reporting require actual Agent tool provenance.');
  }
  dispose({ persist = true } = {}) { return this.disposal ??= this.doDispose(persist); }
  async doDispose(persist) {
    const projects = this.state().projects;
    this.persistOnDispose = persist; this.closing = true;
    if (this.orphanSweepTimer) { clearInterval(this.orphanSweepTimer); this.orphanSweepTimer = null; }
    for (const timer of this.summaryRetryTimers.values()) clearTimeout(timer); this.summaryRetryTimers.clear();
    for (const timer of this.settlementCheckTimers.values()) clearTimeout(timer); this.settlementCheckTimers.clear();
    this.approvals.dispose();
    if (persist) for (const project of projects) await this.stop(project.id);
    const coordinators = this.state().projects.map(project => this.ctx.agents.get(project.coordinatorSessionId)).filter(Boolean);
    for (const agent of coordinators) agent.cancel({ kind: 'user' });
    await Promise.all(coordinators.map(agent => agent.whenIdle()));
    if (!persist) await Promise.all(this.state().workers.map(worker => this.drainWorker(this.project(worker.projectId), worker.sessionId)));
    await Promise.all([...this.launches.values()].map(promise => promise.catch(() => { /* Launch owners handle individual failures; disposal drains them all. */ })));
    await Promise.all([...this.stops.values()]);
    while (this.background.size) await Promise.all([...this.background]);
    await this.tail; this.unpolicy(); this.available = false;
  }
}
