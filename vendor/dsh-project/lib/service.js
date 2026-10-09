/** Local Project indexes over the existing Session and continuing-child runtime. */
import fs from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { checkedRoot, checkedFile, projectDirectory, safeProjectSubdirectory, atomicText, within } from './files.js';
import { ProjectApprovals } from './approvals.js';

const copy = value => JSON.parse(JSON.stringify(value));
const required = (value, label, limit = 32000) => { if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Invalid ${label}.`); return value.trim(); };
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const content = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const latest = stream => stream.delegations.find(item => item.ref === stream.currentDelegationRef);
const marker = '<!-- whale-project:user-notes -->';
const notesGeneratedLimit = 256000 - Buffer.byteLength(marker) - 2;
const boundedNotesGenerated = text => {
  const bytes = Buffer.from(text);
  if (bytes.length <= notesGeneratedLimit) return text;
  const notice = '\nGenerated summary truncated. Read individual work results with project_read_store.\n\n';
  let end = notesGeneratedLimit - Buffer.byteLength(notice);
  while ((bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8') + notice;
};
const policy = 'dsh-project-local';
const directoryDiagnosticPrefix = root => `Project directory check (${root}): `;
const isDirectoryDiagnostic = (message, root) => message.startsWith(directoryDiagnosticPrefix(root))
  || /^(ENOENT|ENOTDIR):/.test(message) && message.includes(`'${root}'`);

export class ProjectService {
  constructor(ctx, table, { home, desktop, teams = ctx.agentTeams }) {
    this.ctx = ctx; this.teams = teams; this.table = table; this.home = home; this.desktop = desktop; this.available = true;
    this.tail = Promise.resolve(); this.delegationTails = new Map(); this.launches = new Map(); this.stops = new Map(); this.terminals = new Map(); this.consumed = new Map(); this.userTurns = new Map();
    this.closing = false; this.recovering = true; this.scheduling = false; this.scheduleRevision = 0; this.held = new Set(); this.workerStops = new Map(); this.projectHolds = new Map(); this.archiving = new Set();
    this.approvals = new ProjectApprovals(this);
    this.unteam = teams.registerPolicy(policy, { admit: (root, operation, value) => this.teamAdmission(root, operation, value) });
    this.catalog = table.get('catalog');
    this.unpolicy = ctx.subagents.registerContinuationPolicy(policy, args => this.admit(args));
  }
  state() { return this.closing && !this.persistOnDispose ? this.catalog : (this.catalog = this.table.get('catalog')); }
  serial(work) { const result = this.tail.then(work); this.tail = result.catch(() => {}); return result; }
  async write(change) { if (this.closing && !this.persistOnDispose) fail('unavailable', 'Project is unloading; only runtime cleanup remains.'); await this.table.update('catalog', before => { const next = structuredClone(before); change(next); next.revision++; return next; }); this.catalog = this.table.get('catalog'); }
  project(id) { const row = this.state().projects.find(item => item.id === id); if (!row) fail('missing', 'Project does not exist.'); return row; }
  projectView(project) {
    const work = this.state().workstreams.filter(item => item.projectId === project.id), workers = this.state().workers.filter(item => item.projectId === project.id);
    const members = new Map(workers.map(worker => [worker.sessionId, worker]));
    const stopping = workers.some(item => item.phase === 'stopping'), running = workers.filter(item => item.activeRunId || this.jobs(item.sessionId).length).length;
    const queued = work.filter(item => latest(item).phase === 'queued').length, provisioning = work.filter(item => latest(item).phase === 'preparing').length;
    const blocked = work.filter(item => !members.get(item.workerSessionId)?.stopped && (item.status === 'blocked' || members.get(item.workerSessionId)?.phase === 'failed')).length;
    const summaryFailed = work.filter(item => item.pendingSummary && item.summaryFailure?.delegationRef === item.currentDelegationRef).length;
    const pendingSummary = project.paused ? 0 : work.filter(item => item.pendingSummary && !item.summaryFailure && !members.get(item.workerSessionId)?.stopped).length;
    const coordinatorRunning = this.ctx.agents.get(project.coordinatorSessionId)?.status === 'running';
    return { ...project, archiving: this.archiving.has(project.id), activity: { running, coordinatorRunning, queued, provisioning, blocked, pendingSummary, summaryFailed, state: stopping ? 'stopping' : blocked || project.diagnostics.length ? 'blocked' : summaryFailed ? 'summaryFailed' : running || coordinatorRunning ? 'running' : provisioning ? 'provisioning' : queued ? 'queued' : pendingSummary ? 'pendingSummary' : work.some(item => item.status !== 'done') ? 'paused' : work.length ? 'done' : 'idle' }, updatedAt: Math.max(project.updatedAt, ...work.map(item => item.updatedAt)) };
  }
  stream(id, projectId) { const row = this.state().workstreams.find(item => item.id === id && (!projectId || item.projectId === projectId)); if (!row) fail('missing', 'Workstream does not belong to this Project.'); return row; }
  worker(id) { const row = this.state().workers.find(item => item.sessionId === id); if (!row) fail('missing', 'Project worker does not exist.'); return row; }
  jobs(id) { return (this.ctx.get('jobs')?.list(id) ?? []).filter(job => job.owner === id && ['running', 'stopping'].includes(job.status)); }
  memberName(worker) { return `member-${worker.sessionId.replace(/^session-/, '')}`; }
  assignmentMessage(receipt) { return `team-message-${createHash('sha256').update(receipt.ref).digest('hex')}`; }
  memberRequest(worker, work, signal = new AbortController().signal, brief = '') {
    return { childId: worker.sessionId, name: this.memberName(worker), description: work.title.slice(0, 200), provider: 'spawn', context: 'fresh',
      environment: { cwd: worker.cwd, agentPreset: 'project-worker', admissionPolicy: policy }, prompt: [{ type: 'text', text: brief }], signal };
  }
  async ensureTask(work) {
    const root = await this.coordinator(this.project(work.projectId));
    await this.teams.bindPolicy(root, policy);
    if (!this.recovering && work.blockedBy?.length) { const tasks = this.teams.listTasks(root); if (work.blockedBy.some(id => !tasks.some(task => task.id === id))) return; }
    let task = await this.teams.createTask(root, { taskId: work.id, subject: work.title.slice(0, 200), description: work.brief.slice(0, 16384), blockedBy: work.blockedBy ?? [] });
    if (!this.recovering && (task.subject !== work.title.slice(0, 200) || task.description !== work.brief.slice(0, 16384))) task = await this.teams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'edit', subject: work.title.slice(0, 200), description: work.brief.slice(0, 16384) });
    if (!this.recovering && JSON.stringify(task.blockedBy) !== JSON.stringify(work.blockedBy ?? [])) task = await this.teams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'set_dependencies', blockedBy: work.blockedBy ?? [] });
    if (!this.recovering && task.status === 'completed' && !latest(work).report && latest(work).phase === 'queued') task = await this.teams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'reopen' });
    return task;
  }
  async assignTask(root, work, worker) {
    let task = this.teams.getTask(root, work.id);
    if (!this.recovering && task.status === 'completed' && latest(work).report?.outcome !== 'completed') task = await this.teams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'reopen' });
    if (task.status === 'pending') await this.teams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: this.memberName(worker) });
    if (!this.recovering) await this.teams.setCold(root, worker.sessionId, work.id, false);
  }
  async completeTask(work) {
    const root = this.ctx.agents.get(this.project(work.projectId).coordinatorSessionId);
    if (!root) return;
    const receipt = latest(work), worker = this.worker(work.workerSessionId);
    const settled = work.settlements.some(item => item.runId === receipt.runId && item.delegationRefs.includes(receipt.ref) && item.stopReason === 'completed');
    let task = this.teams.getTask(root, work.id);
    if (receipt.report?.outcome === 'completed' && settled && !this.jobs(worker.sessionId).length && task.status === 'in_progress') {
      task = await this.teams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'complete' });
    }
    if (!worker.activeRunId && !this.jobs(worker.sessionId).length) {
      this.approvals.release(worker.sessionId);
      if (worker.materialized) await this.teams.setCold(root, worker.sessionId, work.id, true);
    }
  }
  async coldFailedLaunch(work) {
    const worker = this.worker(work.workerSessionId), root = this.ctx.agents.get(this.project(work.projectId).coordinatorSessionId);
    if (!root || latest(work).phase !== 'failed' || worker.activeRunId || worker.reservationRef || worker.directoryHeld
      || this.jobs(worker.sessionId).length || this.ctx.agents.get(worker.sessionId)?.status === 'running') return;
    this.approvals.release(worker.sessionId);
    await this.teams.setCold(root, worker.sessionId, work.id, true);
  }
  async teamAdmission(root, operation, value) {
    const project = this.state().projects.find(item => item.coordinatorSessionId === root.id);
    if (!project || this.ctx.agents.get(root.id) !== root) fail('team_identity', 'Managed Team has no original Project coordinator.');
    if (operation === 'cold') {
      const worker = this.worker(value.memberId), work = this.stream(value.taskId, project.id);
      if (work.workerSessionId !== worker.sessionId || value.cold && (worker.activeRunId || this.jobs(worker.sessionId).length)) fail('team_busy', 'Active work cannot release its Team capacity.');
      return;
    }
    if (operation === 'task') {
      const { caller, request } = value, work = this.stream(request.taskId, project.id);
      if (caller !== root || !['edit', 'set_dependencies', 'reassign', 'reopen', 'complete'].includes(request.action)) fail('team_task', 'Project task transitions are owned by the coordinator host.');
      if (request.action === 'edit' && (request.subject !== work.title.slice(0, 200) || request.description !== work.brief.slice(0, 16384))) fail('team_task', 'Task text must match the accepted Project assignment.');
      if (request.action === 'set_dependencies' && JSON.stringify(request.blockedBy) !== JSON.stringify(work.blockedBy ?? [])) fail('team_task', 'Task dependencies must match the accepted Project assignment.');
      if (request.action === 'reopen' && (project.paused || this.held.has(work.workerSessionId) || latest(work).report)) fail('stopped', 'Reopening needs a current accepted continuation.');
      if (request.action === 'reassign' && request.owner !== this.memberName(this.worker(work.workerSessionId))) fail('team_task', 'This work keeps its original member.');
      if (request.action === 'complete') {
        const receipt = latest(work);
        if (receipt.report?.outcome !== 'completed' || !work.settlements.some(item => item.runId === receipt.runId && item.delegationRefs.includes(receipt.ref) && item.stopReason === 'completed')) fail('team_result', 'Task completion needs its current report and native settlement.');
      }
      return;
    }
    if (operation === 'spawn' || operation === 'adopt' || operation === 'startMember') {
      const { request, caller } = value, worker = this.worker(request.childId);
      if (caller !== root || worker.projectId !== project.id || request.environment?.cwd !== worker.cwd || request.environment?.agentPreset !== 'project-worker' || request.environment?.admissionPolicy !== policy) fail('team_environment', 'Team member must use its assigned Project environment.');
      if (operation === 'adopt') return;
      if (this.recovering || this.projectHolds.has(project.id) || worker.stopped || this.held.has(worker.sessionId) || project.paused || this.archiving.has(project.id)) fail('stopped', 'Project work is stopped.');
      if (operation === 'startMember') await this.assignTask(root, this.stream(worker.workstreamId), worker);
      return;
    }
    if (operation === 'send') {
      const { caller, request } = value;
      const target = this.teams.listMembers(root).find(item => item.name === request.target);
      if (!target) fail('team_target', 'The Team member does not exist.');
      if (caller === root) {
        const worker = this.worker(target.id), receipt = latest(this.stream(worker.workstreamId));
        if (request.messageId !== this.assignmentMessage(receipt)) fail('team_source', 'New assignments use project_delegate.');
      } else { const sender = this.actor(caller), targetWorker = this.state().workers.find(item => item.sessionId === target.id);
        const scope = request.messageId && this.teams.messageContext(root, request.messageId);
        if (!scope || scope.senderAssignment !== latest(sender.stream).ref || targetWorker && (targetWorker.stopped || this.held.has(target.id) || scope.targetAssignment !== latest(this.stream(targetWorker.workstreamId)).ref)) fail('team_source', 'Peer input must belong to active assignments.');
      }
      return;
    }
    if (operation === 'deliver') {
      if (this.recovering || this.closing || this.projectHolds.has(project.id) || project.paused || project.lifecycle !== 'ready' || this.archiving.has(project.id)) fail('stopped', 'Project delivery is stopped.');
      if (value.senderId !== root.id && !this.peerCurrent(root, value)) fail('obsolete_message', 'This peer message belongs to an earlier assignment.');
      if (value.targetId === root.id) {
        const sender = this.worker(value.senderId);
        if (sender.stopped || this.held.has(sender.sessionId)) fail('stopped', 'The sending assignment is stopped.');
        return;
      }
      const worker = this.worker(value.targetId), work = this.stream(worker.workstreamId), receipt = latest(work);
      if (worker.stopped || this.held.has(worker.sessionId) || receipt.report || !this.directoryAvailable(worker)) fail('stopped', 'This member is not accepting executable messages.');
      const tasks = this.teams.listTasks(root);
      if ((work.blockedBy ?? []).some(id => !tasks.some(task => task.id === id && task.status === 'completed'))) fail('dependencies', 'This work is waiting for its dependencies to complete.');
      if (value.senderId === root.id && value.id !== this.assignmentMessage(receipt)) fail('obsolete_message', 'An old assignment cannot restart this work.');
      await this.teams.setCold(root, worker.sessionId, work.id, false);
      return;
    }
    fail('team_operation', 'Unsupported managed Team operation.');
  }
  validTeamInputs(root, worker, messages) {
    const receipt = latest(this.stream(worker.workstreamId));
    return messages.every(message => {
      if (message.source.kind !== 'team-message') return true;
      const source = message.source, queued = this.teams.message(root, source.messageId);
      if (source.teamId !== root.id || !queued || queued.targetId !== worker.sessionId || queued.senderId !== source.senderId || this.teams.messageCancelled(root, source.messageId)) return false;
      return source.senderId === root.id ? source.messageId === this.assignmentMessage(receipt) : this.peerCurrent(root, queued);
    });
  }
  peerCurrent(root, message) {
    const scope = this.teams.messageContext(root, message.id), sender = this.state().workers.find(item => item.sessionId === message.senderId), target = this.state().workers.find(item => item.sessionId === message.targetId);
    return Boolean(scope && sender && !sender.stopped && !this.held.has(sender.sessionId) && scope.senderAssignment === latest(this.stream(sender.workstreamId)).ref && (message.targetId === root.id || target && !target.stopped && !this.held.has(target.sessionId) && scope.targetAssignment === latest(this.stream(target.workstreamId)).ref));
  }
  teamMembers(actor) { return { members: this.teams.listMembers(actor.agent).map(({ id, name, ...row }) => ({ ...row, target: name, sessionId: id })) }; }
  teamTasks(actor) { return { tasks: this.teams.listTasks(actor.agent) }; }
  async teamSend(actor, args, exec) {
    if (actor.role === 'coordinator') fail('team_source', 'Delegate changes through project_delegate.');
    const root = this.ctx.agents.get(actor.project.coordinatorSessionId), target = this.teams.listMembers(root).find(item => item.name === args.target);
    if (!target) fail('team_target', 'Target is not a member of this Team.');
    const recipient = this.state().workers.find(item => item.sessionId === target.id), messageId = `team-message-${createHash('sha256').update(`${actor.agent.id}:${exec.callId}`).digest('hex')}`;
    await this.teams.bindMessage(root, messageId, latest(this.stream(actor.worker.workstreamId)).ref, recipient ? latest(this.stream(recipient.workstreamId)).ref : 'lead');
    return this.teams.sendMessage(actor.agent, { target: required(args.target, 'member'), content: [{ type: 'text', text: required(args.message, 'message') }], signal: exec.signal, messageId });
  }
  actor(agent) {
    if (!agent || this.ctx.agents.get(agent.id) !== agent) fail('unauthorized', 'Project tools require the exact live Agent.');
    const project = this.state().projects.find(item => item.coordinatorSessionId === agent.id);
    if (project) return { role: 'coordinator', project, agent };
    const worker = this.state().workers.find(item => item.sessionId === agent.id);
    if (worker) return { role: 'worker', project: this.project(worker.projectId), worker, stream: this.stream(worker.workstreamId), agent };
    fail('unauthorized', 'This Agent does not belong to a Project.');
  }
  coordinatorOnly(actor) { if (actor.role !== 'coordinator') fail('unauthorized', 'Only the coordinator can delegate or stop work.'); }
  source(actor, exec, stream) {
    const events = actor.agent.session.snapshotEvents();
    const call = events.findLast(event => event.type === 'tool/call' && event.data.callId === (exec.rootCallId ?? exec.callId));
    if (!call) fail('unauthorized', 'No corresponding coordinator tool call exists.');
    const start = events.findLast(event => event.type === 'turn/start' && event.data.turn === call.data.turn);
    const inputs = events.filter(event => event.type === 'user/message' && event.seq < call.seq && (!start || event.seq > start.seq));
    // Dynamic runtime snapshots are user-role model context, never human
    // authorization. A human steer wins over notices claimed in the same turn.
    const input = inputs.findLast(event => event.data.source.kind === 'user')
      ?? inputs.findLast(event => event.data.source.kind === 'subagent-settled');
    if (!input) fail('unauthorized', 'No corresponding input message exists.');
    if (input.data.source.kind === 'user') return { sessionId: actor.agent.id, messageId: input.data.id, callId: exec.callId, text: content(input.data) };
    if (stream && input.data.source.kind === 'subagent-settled' && input.data.source.senderSessionId === stream.workerSessionId && input.data.source.runId === latest(stream).runId && !this.worker(stream.workerSessionId).stopped && !this.project(stream.projectId).paused) return { ...latest(stream).source, callId: exec.callId };
    fail('unauthorized', 'A runtime notice cannot authorize unrelated work or resume stopped work.');
  }
  async coordinator(project) {
    if (!await this.ctx.sessionPersistence.stat(project.coordinatorSessionId)) fail('session_missing', 'The original coordinator Session is missing; its association is preserved.');
    if (!this.ctx.agents.get(project.coordinatorSessionId)) await this.ctx.sessionController.create({ sessionId: project.coordinatorSessionId, cwd: project.storageRoot, agentPreset: 'project-coordinator', presentation: { owner: 'project', title: project.title, workingDirectory: project.canonicalWorkingDirectory } });
    return this.ctx.agents.get(project.coordinatorSessionId);
  }
  async create(input) {
    return this.serial(async () => {
      required(input.requestId, 'creation request', 200);
      const directory = await this.desktop('select-directory', { workingDirectory: required(input.workingDirectory, 'working directory', 32768) });
      let project = this.state().projects.find(item => item.directoryIdentity === directory.identity);
      const reused = Boolean(project);
      if (!project) {
        const id = `project-${randomUUID()}`, root = await projectDirectory(this.home, id), now = Date.now();
        project = { id, title: (basename(directory.canonicalPath) || directory.canonicalPath).slice(0, 240),
          canonicalWorkingDirectory: directory.canonicalPath, directoryIdentity: directory.identity, coordinatorSessionId: `session-${randomUUID()}`,
          storageRoot: root, lifecycle: 'creating', paused: false, holdSourceMessageId: '', diagnostics: [], creationRequestId: input.requestId, createdAt: now, updatedAt: now };
        await this.write(state => state.projects.push(project));
      }
      if (project.lifecycle === 'creating') await this.finishCreation(project);
      return { project: copy(this.project(project.id)), reused };
    });
  }
  async finishCreation(project) {
    await safeProjectSubdirectory(this.home, project.id, 'docs'); await safeProjectSubdirectory(this.home, project.id, 'internal');
    try { await fs.writeFile(join(project.storageRoot, 'preferences.md'), '', { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await this.ctx.sessionController.create({ sessionId: project.coordinatorSessionId, cwd: project.storageRoot, agentPreset: 'project-coordinator', presentation: { owner: 'project', title: project.title, workingDirectory: project.canonicalWorkingDirectory } });
    await this.ctx.sessions.flush(this.ctx.agents.get(project.coordinatorSessionId).session);
    await this.teams.bindPolicy(this.ctx.agents.get(project.coordinatorSessionId), policy);
    await this.write(state => { const row = state.projects.find(item => item.id === project.id); row.lifecycle = 'ready'; row.diagnostics = []; row.updatedAt = Date.now(); });
    await this.notes(project.id);
  }
  async detail(projectId, input = {}) {
    const rows = await this.workRows(projectId), current = rows.filter(row => row.group === 'current'), history = rows.filter(row => row.group === 'history');
    // A live work can leave this group between polls. Its old page anchor then
    // returns to the first page rather than leaving an unreadable current page.
    const anchor = input.currentCursor ? current.findIndex(row => row.work.id === input.currentCursor) : -1;
    const currentCursor = anchor < 0 ? null : input.currentCursor, start = anchor + 1;
    const project = this.projectView(this.project(projectId)), revision = `${this.state().revision}:${this.archiving.has(projectId)}:${currentCursor ?? ''}`;
    if (input.since === revision) return { projectId, revision, unchanged: true };
    const page = current.slice(start, start + 20);
    return copy({ project, revision, team: { id: project.coordinatorSessionId }, ...this.workSummaries([...page, ...history.slice(0, 3)]),
      workPage: { currentTotal: current.length, currentCursor, currentNextCursor: start + page.length < current.length ? page.at(-1).work.id : null,
        historyTotal: history.length, historyNextCursor: history.length > 3 ? history[2].work.id : null } });
  }
  async workRows(projectId) {
    const project = this.project(projectId), root = await this.coordinator(project);
    const tasks = new Map(this.teams.listTasks(root).map(task => [task.id, task]));
    const workers = new Map(this.state().workers.filter(worker => worker.projectId === projectId).map(worker => [worker.sessionId, worker]));
    return this.state().workstreams.filter(work => work.projectId === projectId).map(work => {
      const worker = workers.get(work.workerSessionId), jobs = this.jobs(work.workerSessionId), delegation = latest(work);
      const status = tasks.get(work.id)?.status === 'completed' ? 'done' : work.status === 'done' ? 'blocked' : work.status;
      const rank = work.summaryFailure?.delegationRef === work.currentDelegationRef || !worker?.stopped && (status === 'blocked' || worker?.phase === 'failed') ? 0
        : worker && (worker.activeRunId || jobs.length || worker.phase === 'stopping') ? 1
        : ['preparing', 'queued'].includes(delegation?.phase) ? 2
        : work.pendingSummary && !worker?.stopped && !project.paused ? 3 : status === 'done' ? 4 : 5;
      return { work, worker, jobs, delegation, status, rank, group: rank < 4 ? 'current' : 'history' };
    }).sort((a, b) => (a.group === b.group ? a.group === 'current' ? a.rank - b.rank : 0 : a.group === 'current' ? -1 : 1)
      || b.work.updatedAt - a.work.updatedAt || a.work.id.localeCompare(b.work.id));
  }
  prerequisiteStatus(report, projectId) {
    if (!report?.prerequisites) return {};
    return { prerequisitesChanged: report.prerequisites.some(reference => {
      const work = this.state().workstreams.find(item => item.projectId === projectId && item.id === reference.workstreamId);
      return !work || work.currentDelegationRef !== reference.delegationRef || reference.reportId !== undefined && latest(work).report?.callId !== reference.reportId;
    }) };
  }
  reportView(report, projectId) {
    if (!report) return;
    const work = this.state().workstreams.find(item => item.projectId === projectId && item.delegations.some(receipt => receipt.ref === report.delegationRef));
    const worker = work && this.worker(work.workerSessionId), docs = join(this.project(projectId).storageRoot, 'docs');
    return { ...report, artifacts: report.artifacts.map(file => ({ ...file, location: within(docs, file.path) ? 'materials' : worker?.mode })), ...this.prerequisiteStatus(report, projectId) };
  }
  workSummaries(rows) {
    return {
      workstreams: rows.map(({ work, status, delegation, group }) => ({ id: work.id, projectId: work.projectId, title: work.title, status, group,
        workerSessionId: work.workerSessionId, blockedBy: work.blockedBy, blockedReason: work.blockedReason?.slice(0, 500), pendingSummary: work.pendingSummary, summaryFailure: work.summaryFailure,
        currentDelegationRef: work.currentDelegationRef, createdAt: work.createdAt, updatedAt: work.updatedAt,
        delegation: delegation && { ref: delegation.ref, phase: delegation.phase, scope: delegation.scope, waitingReason: delegation.waitingReason }, hasReport: Boolean(delegation?.report),
        ...this.prerequisiteStatus(delegation?.report, work.projectId) })),
      workers: rows.filter(row => row.worker).map(({ worker, jobs }) => ({ sessionId: worker.sessionId, projectId: worker.projectId, workstreamId: worker.workstreamId,
        cwd: worker.cwd, role: worker.role, mode: worker.mode, phase: worker.phase, stopped: worker.stopped, activeRunId: worker.activeRunId,
        branch: worker.branch, error: worker.error?.slice(0, 500), jobs: jobs.map(job => ({ id: job.id, status: job.status })) })),
    };
  }
  async listWorkstreams(projectId, { kind, cursor } = {}) {
    if (!['current', 'history'].includes(kind)) fail('work_kind', 'Choose current or history work.');
    const all = await this.workRows(projectId), rows = all.filter(row => row.group === kind);
    if (kind === 'history' && cursor !== undefined && all.some(row => row.work.id === cursor && row.group === 'current')) cursor = undefined;
    const start = cursor === undefined ? 0 : rows.findIndex(row => row.work.id === cursor) + 1;
    if (cursor !== undefined && start === 0) fail('work_cursor', 'This work cursor does not belong to the selected Project and group.');
    const page = rows.slice(start, start + 20), hasMore = start + page.length < rows.length;
    return copy({ ...this.workSummaries(page), cursor: cursor ?? null, total: rows.length, hasMore, nextCursor: hasMore ? page.at(-1).work.id : null });
  }
  async getWorkstream(projectId, { workstreamId, workerSessionId } = {}) {
    if (Boolean(workstreamId) === Boolean(workerSessionId)) fail('work_identity', 'Choose one workstream or member Session.');
    const row = (await this.workRows(projectId)).find(row => workstreamId ? row.work.id === workstreamId : row.work.workerSessionId === workerSessionId);
    if (!row) fail('missing', 'Workstream does not belong to this Project.');
    const { delegations, settlements, latestReport, ...work } = row.work;
    return copy({ workstream: { ...work, status: row.status, group: row.group, delegation: row.delegation,
      latestReport: this.reportView(row.delegation?.report, projectId), ...this.prerequisiteStatus(row.delegation?.report, projectId), recentSettlements: settlements.slice(-5) }, worker: row.worker && { ...row.worker, jobs: row.jobs } });
  }
  async delegate(actor, args, exec) {
    // Keep dependency validation, an internal drain and acceptance in one order;
    // the state transaction queue stays available to cancellation and settlement.
    const id = actor.project.id, result = (this.delegationTails.get(id) ?? Promise.resolve()).then(() => this.doDelegate(actor, args, exec));
    const tail = result.then(() => {}, () => {}); this.delegationTails.set(id, tail);
    try { return await result; } finally { if (this.delegationTails.get(id) === tail) this.delegationTails.delete(id); }
  }
  async doDelegate(actor, args, exec) {
    this.coordinatorOnly(actor); exec.signal.throwIfAborted();
    const existing = args.workstreamId ? this.stream(args.workstreamId, actor.project.id) : undefined;
    const source = this.source(actor, exec, existing), brief = required(args.brief, 'brief'), role = { development: 'worker', readonly: 'readonly', docs: 'docs' }[args.scope];
    const stopGeneration = existing ? this.workerStops.get(existing.workerSessionId)?.generation ?? 0 : 0;
    if (existing && this.workerStops.get(existing.workerSessionId)?.sourceMessageId === source.messageId) fail('stopped', 'The request was stopped; a new actual user message is required.');
    if (!role) fail('invalid_scope', 'Choose readonly, docs or development.');
    const blockers = args.blockedBy === undefined ? existing?.blockedBy ?? [] : args.blockedBy;
    if (!Array.isArray(blockers) || blockers.length > 64) fail('dependencies', 'Dependencies must reference existing work in this Project.');
    const validateDependencies = () => {
      const works = this.state().workstreams.filter(work => work.projectId === actor.project.id);
      const graph = new Map(works.map(work => [work.id, work.id === existing?.id ? blockers : work.blockedBy ?? []]));
      for (const id of blockers) if (!graph.has(id)) fail('dependencies', 'Dependencies must reference existing work in this Project.');
      const nativeGraph = new Map(graph);
      for (const task of this.teams.listTasks(actor.agent)) nativeGraph.set(task.id, task.id === existing?.id ? blockers : task.blockedBy);
      for (const candidate of [graph, nativeGraph]) {
        const visiting = new Set(), visited = new Set();
        const visit = id => {
          if (visiting.has(id)) fail('TEAM_TASK_DEPENDENCY_CYCLE', 'A Project work dependency cannot contain a cycle.');
          if (visited.has(id)) return;
          visiting.add(id);
          for (const dependency of candidate.get(id) ?? []) visit(dependency);
          visiting.delete(id); visited.add(id);
        };
        for (const id of candidate.keys()) visit(id);
      }
    };
    await this.serial(() => validateDependencies());
    const paths = args.writePaths ?? [];
    if (!Array.isArray(paths) || paths.length > 64 || paths.some(path => typeof path !== 'string' || !path || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git'))) fail('invalid_scope', 'Document scope requires exact relative paths.');
    if (role === 'docs' && paths.some(path => !/\.(md|mdx|txt|rst|adoc)$/i.test(path))) fail('invalid_scope', 'Documentation scope supports only declared .md, .mdx, .txt, .rst and .adoc documents.');
    if (this.projectHolds.get(actor.project.id) === source.messageId || this.project(actor.project.id).holdSourceMessageId === source.messageId) fail('stopped', 'The request was stopped; a new actual user message is required.');
    const ref = `${actor.agent.id}:${exec.callId}`;
    let internallyDrained = false;
    if (existing) {
      const worker = this.worker(existing.workerSessionId);
      const previous = latest(existing), changesScope = previous.scope !== role || (role === 'docs' && paths.some(path => !previous.writePaths.includes(path)));
      const changesDependencies = JSON.stringify(existing.blockedBy ?? []) !== JSON.stringify([...new Set(blockers)]);
      const enablesApproval = this.approvals.needsDrain(actor, source, role, worker);
      const expands = previous.scope === 'readonly' && role !== 'readonly' || previous.scope === 'docs' && (role === 'worker' || role === 'docs' && paths.some(path => !previous.writePaths.includes(path)));
      if (expands && source.messageId === previous.source.messageId) fail('unauthorized', 'Scope expansion needs a new actual user message.');
      if ((changesScope || changesDependencies || enablesApproval) && (enablesApproval || this.ctx.agents.get(worker.sessionId)?.status === 'running' || this.jobs(worker.sessionId).length)) {
        internallyDrained = !worker.stopped && !this.held.has(worker.sessionId);
        await this.stop(actor.project.id, existing.id, { recordHold: false }); await this.stops.get(worker.sessionId);
      }
    }
    let stream;
    await this.serial(async () => {
      const project = this.project(actor.project.id);
      if (this.closing || this.archiving.has(project.id) || project.lifecycle !== 'ready') fail('unavailable', 'Restore this Project before delegating.');
      if (this.projectHolds.get(project.id) === source.messageId || project.holdSourceMessageId === source.messageId) fail('stopped', 'The request was stopped; a new actual user message is required.');
      if (existing && (this.workerStops.get(existing.workerSessionId)?.generation ?? 0) !== stopGeneration) fail('stopped', 'The work was stopped while its continuation was being prepared.');
      const replay = this.state().workstreams.find(item => item.projectId === project.id && item.delegations.some(receipt => receipt.ref === ref));
      if (replay) { stream = replay; return; }
      validateDependencies();
      const now = Date.now(), receipt = { ref, source, brief, scope: role, writePaths: [...new Set(paths)], phase: 'queued', messageId: '', runId: '', error: '', createdAt: now };
      if (existing) {
        const worker = this.worker(existing.workerSessionId), row = this.stream(existing.id);
        if (worker.phase === 'stopping') fail('stopping', 'The original worker is still stopping.');
        if (args.isolate !== undefined && worker.mode !== (args.isolate ? 'worktree' : 'existing')) fail('fixed_directory', 'The original directory arrangement is fixed.');
        if (worker.holdSourceMessageId === source.messageId || ((worker.stopped && !internallyDrained || project.paused) && latest(row).source.messageId === source.messageId)) fail('stopped', 'Stopped work needs a new explicit user continuation.');
        await this.write(state => { const work = state.workstreams.find(item => item.id === row.id), member = state.workers.find(item => item.sessionId === worker.sessionId);
          work.brief = brief; if (args.blockedBy !== undefined) work.blockedBy = [...new Set(blockers)]; work.currentDelegationRef = ref; work.delegations.push(receipt); work.status = 'open'; work.blockedReason = ''; delete work.latestReport; delete work.summaryFailure; work.updatedAt = now; member.stopped = false; member.error = ''; state.projects.find(item => item.id === project.id).paused = false; });
        stream = this.stream(row.id);
      } else {
        const id = `work-${randomUUID()}`, sessionId = `session-${randomUUID()}`;
        const work = { id, projectId: project.id, blockedBy: [...new Set(blockers)], title: required(args.title || brief.slice(0, 100), 'title', 240), brief, status: 'open', workerSessionId: sessionId,
          blockedReason: '', currentDelegationRef: ref, delegations: [receipt], settlements: [], pendingSummary: false, archived: false, createdAt: now, updatedAt: now };
        const worker = { sessionId, projectId: project.id, workstreamId: id, cwd: '', role, mode: args.isolate ? 'worktree' : 'existing', phase: 'provisioning', directoryHeld: false,
          stopped: false, materialized: false, writePaths: [...new Set(paths)], consumedDelegationRef: '', error: '', updatedAt: now };
        await this.write(state => { state.workstreams.push(work); state.workers.push(worker); state.projects.find(item => item.id === project.id).paused = false; }); stream = this.stream(id);
      }
      if (existing && (this.workerStops.get(existing.workerSessionId)?.generation ?? 0) !== stopGeneration) fail('stopped', 'The work was stopped while its continuation was being prepared.');
      this.approvals.accept(actor, source, receipt, stream.workerSessionId);
      this.projectHolds.delete(project.id); this.held.delete(stream.workerSessionId);
      await this.notes(project.id);
    });
    await this.launch(stream.id, exec.signal);
    const worker = this.worker(stream.workerSessionId), receipt = this.stream(stream.id).delegations.find(item => item.ref === ref);
    return copy({ workstreamId: stream.id, workerSessionId: worker.sessionId, delegationRef: ref, messageId: receipt.messageId,
      phase: receipt.phase === 'queued' ? 'queued' : worker.phase, cwd: worker.cwd, ...(receipt.error ? { error: receipt.error } : {}) });
  }
  directoryAvailable(worker, role = latest(this.stream(worker.workstreamId)).scope) {
    return this.directoryBlockers(worker, role).length === 0;
  }
  directoryBlockers(worker, role) {
    if (role === 'readonly') return [];
    const cwd = worker.cwd || (worker.mode === 'existing' ? this.project(worker.projectId).canonicalWorkingDirectory : '');
    if (!cwd) return []; // An unprepared isolated worktree owns no shared directory yet.
    return this.state().workers.filter(other => {
      if (other.sessionId === worker.sessionId || !other.directoryHeld) return false;
      const occupied = other.cwd || (other.mode === 'existing' ? this.project(other.projectId).canonicalWorkingDirectory : '');
      return occupied && (within(cwd, occupied) || within(occupied, cwd));
    });
  }
  launch(id, signal = new AbortController().signal) {
    if (this.launches.has(id)) return this.launches.get(id);
    const ref = latest(this.stream(id)).ref, scheduleRevision = this.scheduleRevision;
    const promise = this.doLaunch(id, signal).finally(() => {
      this.launches.delete(id);
      if (latest(this.stream(id)).ref !== ref || latest(this.stream(id)).phase === 'failed' || latest(this.stream(id)).phase === 'queued' && this.scheduleRevision !== scheduleRevision) this.schedule();
    }); this.launches.set(id, promise); return promise;
  }
  async doLaunch(id, signal) {
    let stream = this.stream(id), worker = this.worker(stream.workerSessionId), receipt = latest(stream); const project = this.project(stream.projectId);
    const recordWaiting = async reason => {
      const current = latest(this.stream(id));
      if (current.ref !== receipt.ref || current.phase !== 'queued' || this.worker(worker.sessionId).stopped || this.held.has(worker.sessionId)) return;
      if (JSON.stringify(current.waitingReason) === JSON.stringify(reason)) return;
      await this.write(state => { const work = state.workstreams.find(item => item.id === id); latest(work).waitingReason = reason; work.updatedAt = Date.now(); });
    };
    let task;
    try { task = await this.ensureTask(stream); }
    catch (error) { if (['TEAM_MEMBER_LIMIT', 'TEAM_TASK_LIMIT'].includes(error.code)) { await this.serial(() => recordWaiting({ kind: 'capacity', workTitles: [], code: error.code })); return; } throw error; }
    let reserved = false, prerequisites;
    await this.serial(async () => {
      stream = this.stream(id); worker = this.worker(stream.workerSessionId); receipt = latest(stream);
      if (receipt.phase !== 'queued' || this.projectHolds.has(project.id) || this.held.has(worker.sessionId) || this.archiving.has(project.id) || this.project(project.id).paused || worker.stopped || this.closing) return;
      const tasks = this.teams.listTasks(this.ctx.agents.get(project.coordinatorSessionId));
      task = tasks.find(candidate => candidate.id === id);
      const upstream = (stream.blockedBy ?? []).map(dependency => this.stream(dependency, project.id));
      const dependencies = upstream.filter(work => !tasks.some(candidate => candidate.id === work.id && candidate.status === 'completed') || !work.settlements.some(terminal => terminal.delegationRefs.includes(work.currentDelegationRef) && terminal.stopReason === 'completed'));
      if (dependencies.length) { await recordWaiting({ kind: 'dependencies', workTitles: dependencies.map(work => work.title) }); return; }
      if (!task || !task.ready && task.status !== 'in_progress') return;
      const occupied = this.directoryBlockers(worker, receipt.scope);
      if (occupied.length) { await recordWaiting({ kind: 'directory', workTitles: occupied.map(member => this.stream(member.workstreamId).title) }); return; }
      prerequisites = upstream.map(work => ({ workstreamId: work.id, title: work.title, delegationRef: work.currentDelegationRef, report: latest(work).report ?? null }));
      await this.write(state => { const member = state.workers.find(item => item.sessionId === worker.sessionId); member.directoryHeld = receipt.scope !== 'readonly'; member.reservationRef = receipt.ref; const current = latest(state.workstreams.find(item => item.id === id)); current.phase = 'preparing'; delete current.waitingReason;
        current.dispatchedPrerequisites = prerequisites.map(({ workstreamId, title, delegationRef, report }) => ({ workstreamId, title, delegationRef, ...(report?.callId ? { reportId: report.callId } : {}) }));
      }); reserved = true;
    });
    if (!reserved) return;
    try {
      for (const root of [project.storageRoot, project.canonicalWorkingDirectory]) {
        await checkedRoot(root);
        if (this.project(project.id).diagnostics.some(message => isDirectoryDiagnostic(message, root))) await this.serial(() => this.write(state => {
          const row = state.projects.find(item => item.id === project.id);
          row.diagnostics = row.diagnostics.filter(message => !isDirectoryDiagnostic(message, root));
        }));
      }
      if (!worker.cwd) {
        const workspace = await this.desktop('prepare-workspace', { projectId: project.id, workstreamId: id, workingDirectory: project.canonicalWorkingDirectory, mode: worker.mode });
        const cwd = await checkedRoot(workspace.canonicalPath);
        await this.serial(() => this.write(state => { const member = state.workers.find(item => item.sessionId === worker.sessionId); member.cwd = cwd; member.workspace = copy(workspace); if (workspace.branch) member.branch = workspace.branch; }));
      } else await this.desktop('check-workspace', { projectId: project.id, workstreamId: id, workspace: worker.workspace });
      worker = this.worker(worker.sessionId); stream = this.stream(id);
      if (worker.stopped || this.held.has(worker.sessionId) || this.project(project.id).paused) return;
      const internal = await safeProjectSubdirectory(this.home, project.id, 'internal', id), docs = await safeProjectSubdirectory(this.home, project.id, 'docs', id);
      const previous = stream.delegations.slice(0, stream.delegations.findIndex(item => item.ref === receipt.ref)).findLast(item => item.report)?.report;
      const brief = `${stream.delegations.length > 1 ? 'Continue the same work and original Session. Preserve correct previous work; implement only the current changes.' : 'First assignment for this continuing work.'}\nProject ${project.title}\nTeam: ${project.coordinatorSessionId}\nWorkstream ${id}: ${stream.title}\nDelegationRef: ${receipt.ref}\nWorking directory: ${worker.cwd}\nBranch: ${worker.branch || 'not applicable; selected project directory'}\n${process.platform === 'win32' ? 'Windows Git: use git -c core.longpaths=true for commands in this directory. Do not persist this setting. A Filename too long error does not prove deletion or a clean directory.\n' : ''}Scope: ${receipt.scope}; exact repository write paths: ${JSON.stringify(receipt.writePaths)}\nProject deliverables: ${docs}\nPrivate work notes: ${internal}\nActual user source (${receipt.source.messageId}):\n${receipt.source.text}\n\nCurrent assignment and completion criteria:\n${receipt.brief}\n\n${this.preferencesFor(project.coordinatorSessionId)}\n${previous ? `Previous recorded result (historical, not proof of this request):\n${JSON.stringify(previous)}\n` : ''}${prerequisites.length ? `Prerequisite results:\n${JSON.stringify(prerequisites)}\n` : ''}Use the actual user's language. Use project_report for this delegationRef with real artifacts, verification and remaining issues, then finish. Do not send a duplicate completion message.`;
      const parent = await this.coordinator(project), saved = await this.ctx.sessionPersistence.stat(worker.sessionId); let messageId;
      if (worker.materialized && !saved) fail('session_missing', 'The original worker Session is missing; no replacement is created.');
      const request = this.memberRequest(worker, stream, signal, brief);
      await this.teams.bindPolicy(parent, policy);
      if (saved) {
        await this.teams.adoptMember(parent, request);
        await this.assignTask(parent, stream, worker);
        const sent = await this.teams.sendMessage(parent, { target: this.memberName(worker), content: [{ type: 'text', text: brief }], signal, messageId: this.assignmentMessage(receipt) });
        messageId = sent.messageId;
      } else {
        const started = await this.teams.spawnTeammate(parent, request);
        messageId = started.messageId;
      }
      await this.serial(async () => { await this.write(state => { const work = state.workstreams.find(item => item.id === id), member = state.workers.find(item => item.sessionId === worker.sessionId), accepted = work.delegations.find(item => item.ref === receipt.ref);
        accepted.messageId = messageId; accepted.phase = member.stopped ? 'stopped' : 'accepted'; member.materialized = true;
        if (!member.stopped && !work.settlements.some(terminal => terminal.delegationRefs.includes(receipt.ref))) { member.phase = 'active'; work.status = 'running'; work.blockedReason = ''; } member.updatedAt = work.updatedAt = Date.now(); }); await this.notes(project.id); });
    } catch (error) {
      if (this.closing && !this.persistOnDispose) throw error;
      if (['TEAM_MEMBER_LIMIT', 'TEAM_TASK_LIMIT', 'TEAM_TASK_BLOCKED'].includes(error.code)) {
        await this.serial(async () => {
          const currentWork = this.stream(id), root = this.ctx.agents.get(project.coordinatorSessionId);
          const dependencies = error.code === 'TEAM_TASK_BLOCKED' ? (currentWork.blockedBy ?? []).map(dependency => this.stream(dependency, project.id)).filter(work =>
            this.teams.getTask(root, work.id)?.status !== 'completed' || !work.settlements.some(terminal => terminal.delegationRefs.includes(work.currentDelegationRef) && terminal.stopReason === 'completed')) : [];
          await this.write(state => {
          const work = state.workstreams.find(item => item.id === id), member = state.workers.find(item => item.sessionId === worker.sessionId), waiting = work.delegations.find(item => item.ref === receipt.ref);
          if (waiting.phase === 'stopped' || member.stopped || work.currentDelegationRef !== receipt.ref) return;
          waiting.phase = 'queued'; waiting.error = ''; waiting.waitingReason = error.code === 'TEAM_TASK_BLOCKED' ? { kind: 'dependencies', workTitles: dependencies.map(work => work.title) } : { kind: 'capacity', workTitles: [], code: error.code };
          member.reservationRef = ''; member.directoryHeld = Boolean(member.activeRunId || this.jobs(member.sessionId).length || this.ctx.agents.get(member.sessionId)?.status === 'running'); member.phase = member.materialized ? 'idle' : 'provisioning'; member.error = '';
          work.status = 'open'; work.blockedReason = ''; work.updatedAt = Date.now();
          });
          const member = this.worker(worker.sessionId);
          if (error.code === 'TEAM_TASK_BLOCKED' && latest(this.stream(id)).ref === receipt.ref && !member.directoryHeld && !member.activeRunId && !member.reservationRef && !this.jobs(member.sessionId).length && this.ctx.agents.get(member.sessionId)?.status !== 'running') await this.teams.setCold(root, member.sessionId, id, true);
          await this.notes(project.id);
        });
        return;
      }
      await this.serial(async () => { await this.write(state => { const work = state.workstreams.find(item => item.id === id), member = state.workers.find(item => item.sessionId === worker.sessionId), failed = work.delegations.find(item => item.ref === receipt.ref);
        if (failed.phase !== 'stopped') failed.phase = 'failed'; failed.error = error.message; member.phase = 'failed'; member.error = error.message; member.directoryHeld = Boolean(member.activeRunId) || this.ctx.agents.get(member.sessionId)?.status === 'running' || this.jobs(member.sessionId).length > 0;
        if (!member.directoryHeld && member.reservationRef === receipt.ref) member.reservationRef = '';
        work.status = 'blocked'; work.blockedReason = error.message; work.updatedAt = Date.now(); }); await this.coldFailedLaunch(this.stream(id)); await this.notes(project.id); }); throw error;
    }
  }
  async admit({ parent, childId, reason, settlement }) {
    if (settlement) await this.runEnded({ id: childId, runId: settlement.runId, stopReason: settlement.stopReason, lastAssistantMessage: settlement.output });
    const worker = this.worker(childId), project = this.project(worker.projectId);
    if (this.closing || this.recovering || this.projectHolds.has(project.id) || this.held.has(childId) || this.archiving.has(project.id) || parent.id !== project.coordinatorSessionId || this.ctx.agents.get(parent.id) !== parent || project.lifecycle !== 'ready' || project.paused || worker.stopped || worker.phase === 'stopping') fail('paused', 'Project continuation is stopped or paused.');
    if (reason !== 'settlement' && (!worker.cwd || !this.directoryAvailable(worker))) fail('directory_busy', 'The writable directory is occupied.');
    if (reason !== 'settlement') {
      const tasks = this.teams.listTasks(parent);
      if ((this.stream(worker.workstreamId).blockedBy ?? []).some(id => !tasks.some(task => task.id === id && task.status === 'completed'))) fail('dependencies', 'This work is waiting for its dependencies to complete.');
    }
    // Do not enter serial: native start/drain await this callback themselves.
  }
  runStarted(info) {
    if (this.closing && !this.persistOnDispose) return Promise.resolve();
    if (!this.state().workers.some(item => item.sessionId === info.id)) return Promise.resolve();
    if (!this.terminals.has(info.runId)) { let resolve; const promise = new Promise(done => { resolve = done; }); this.terminals.set(info.runId, { promise, resolve }); }
    return this.serial(() => this.write(state => { const work = state.workstreams.find(item => item.workerSessionId === info.id), member = state.workers.find(item => item.sessionId === info.id);
      member.activeRunId = info.runId;
      const submitted = work.delegations.find(item => item.ref === member.reservationRef);
      if (submitted?.phase === 'preparing') submitted.runId = info.runId;
      if (!member.stopped) { member.phase = 'active'; member.directoryHeld = latest(work).scope !== 'readonly'; work.status = 'running'; }
    }));
  }
  runEnded(info) {
    if (this.closing && !this.persistOnDispose) { this.terminals.get(info.runId)?.resolve(); return Promise.resolve(); }
    const worker = this.state().workers.find(item => item.sessionId === info.id); if (!worker) return Promise.resolve();
    const result = this.serial(async () => {
      await this.write(state => {
        const work = state.workstreams.find(item => item.id === worker.workstreamId), member = state.workers.find(item => item.sessionId === info.id);
        if (work.settlements.some(item => item.runId === info.runId)) return;
        const refs = work.delegations.filter(item => item.runId === info.runId).map(item => item.ref);
        work.settlements.push({ runId: info.runId, delegationRefs: refs, stopReason: info.stopReason, summary: (info.lastAssistantMessage ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n'), at: Date.now(), merged: true, noticeMessageId: '', summarizedBy: '' }); work.pendingSummary = true;
        if (member.activeRunId === info.runId) {
          member.activeRunId = '';
          const reservation = work.delegations.find(item => item.ref === member.reservationRef);
          const preparing = reservation?.phase === 'preparing' && !reservation.runId;
          member.phase = member.stopped ? 'stopping' : preparing ? 'provisioning' : 'idle';
          member.directoryHeld = Boolean(preparing && reservation.scope !== 'readonly') || (member.role !== 'readonly' && this.jobs(member.sessionId).length > 0);
        }
        const receipt = latest(work);
        if (refs.includes(receipt.ref)) {
          if (member.stopped || this.project(member.projectId).paused) { work.status = 'blocked'; work.blockedReason = 'stopped'; }
          else if (info.stopReason !== 'completed') { work.status = 'blocked'; work.blockedReason = `Worker ended: ${info.stopReason}`; }
          else if (member.directoryHeld) { work.status = 'blocked'; work.blockedReason = 'Worker-owned jobs are still active.'; }
          else if (receipt.report) { work.latestReport = receipt.report; work.status = receipt.report.outcome === 'completed' ? 'done' : 'blocked'; work.blockedReason = receipt.report.outcome === 'completed' ? '' : receipt.report.summary; }
          else { work.status = 'blocked'; work.blockedReason = 'This turn ended without an explicit result report.'; }
        } work.updatedAt = member.updatedAt = Date.now();
      });
      await this.completeTask(this.stream(worker.workstreamId));
      await this.notes(worker.projectId);
    });
    result.then(() => this.terminals.get(info.runId)?.resolve(), error => this.terminals.get(info.runId)?.resolve({ error }));
    result.then(() => this.schedule(), error => this.ctx.logger.warn('Project settlement failed: %s', error.message)); return result;
  }
  async preStep(input, next) {
    if (this.closing) return { kind: 'reject' };
    const project = this.state().projects.find(item => item.coordinatorSessionId === input.agent.id);
    const owner = project ?? this.state().projects.find(item => item.id === this.state().workers.find(worker => worker.sessionId === input.agent.id)?.projectId);
    const root = owner && this.ctx.agents.get(owner.coordinatorSessionId);
    const accepted = input.messages.filter(message => {
      if (message.source.kind !== 'team-message') return true;
      const queued = root && this.teams.message(root, message.source.messageId);
      if (!queued || queued.targetId !== input.agent.id || queued.senderId !== message.source.senderId || message.source.teamId !== root.id || this.teams.messageCancelled(root, queued.id)) return false;
      if (queued.senderId !== root.id) return this.peerCurrent(root, queued);
      const worker = this.worker(input.agent.id);
      return queued.id === this.assignmentMessage(latest(this.stream(worker.workstreamId)));
    });
    if (accepted.length !== input.messages.length) {
      if (!accepted.some(message => ['user', 'team-message', 'subagent-settled'].includes(message.source.kind))) return { kind: 'reject' };
      const originalNext = next, allowed = new Set(accepted.map(message => message.id));
      next = async () => { const decision = await originalNext(); return decision.kind === 'enter' ? { ...decision, messages: decision.messages.filter(message => allowed.has(message.id)) } : decision; };
      input = { ...input, messages: accepted };
    }
    if (project) {
      const notices = new Map();
      const actualUser = input.messages.findLast(item => item.source.kind === 'user');
      if (actualUser) {
        this.userTurns.set(input.agent.id, { agent: input.agent, turn: input.turn });
        if (this.projectHolds.get(project.id) !== actualUser.id) this.projectHolds.delete(project.id);
        await this.serial(() => this.write(state => { state.projects.find(item => item.id === project.id).updatedAt = Date.now(); }));
      }
      for (const message of input.messages.filter(item => item.source.kind === 'subagent-settled')) {
        const barrier = this.terminals.get(message.source.runId); if (barrier) { const result = await barrier.promise; if (result?.error) throw result.error; }
        await this.serial(() => this.write(state => { const work = state.workstreams.find(item => item.projectId === project.id && item.workerSessionId === message.source.senderSessionId), terminal = work?.settlements.find(item => item.runId === message.source.runId); if (terminal) terminal.noticeMessageId = message.id; }));
        const work = this.state().workstreams.find(item => item.projectId === project.id && item.workerSessionId === message.source.senderSessionId), terminal = work?.settlements.find(item => item.runId === message.source.runId);
        if (terminal) {
          const reports = work.delegations.filter(receipt => terminal.delegationRefs.includes(receipt.ref) && receipt.runId === terminal.runId && receipt.report).map(receipt => copy(receipt.report));
          notices.set(message.id, { workstreamId: work.id, title: work.title, workerSessionId: work.workerSessionId, runId: terminal.runId, stopReason: terminal.stopReason,
            currentDelegationRef: work.currentDelegationRef, currentStatus: work.status, isCurrentDelegation: terminal.delegationRefs.includes(work.currentDelegationRef), reports });
        }
      }
      const human = this.userTurns.get(input.agent.id);
      if (this.projectHolds.has(project.id) || this.archiving.has(project.id) || project.lifecycle !== 'ready' || (this.project(project.id).paused && (human?.agent !== input.agent || human.turn !== input.turn))) return { kind: 'reject' };
      const decision = await next();
      if (decision.kind !== 'enter' || !notices.size) return decision;
      const consumed = [];
      const messages = decision.messages.map(message => {
        const facts = notices.get(message.id); if (!facts || message.source.kind !== 'subagent-settled') return message;
        consumed.push({ id: facts.workstreamId, runs: [facts.runId], reports: facts.reports.map(report => report.delegationRef) });
        // project_report ends a worker turn without closing prose. Add its
        // recorded facts to this SAME native notice, preserving identity and
        // authorization source; never send a second notification or wakeup.
        return { ...message, content: [...message.content, { type: 'text', text: `Project recorded outcome for this native settlement (worker report, not independent verification):\n${JSON.stringify(facts)}\nThese facts refer only to the stated run and delegations. An older run does not complete a newer request or authorize new work.` }] };
      });
      this.consume(input.agent.id, input.turn, consumed);
      return { ...decision, messages };
    } else {
      const worker = this.state().workers.find(item => item.sessionId === input.agent.id);
      if (worker) {
        if (this.closing || this.recovering || this.projectHolds.has(worker.projectId) || this.held.has(worker.sessionId) || worker.stopped || this.project(worker.projectId).paused) return { kind: 'reject' };
        const root = this.ctx.agents.get(this.project(worker.projectId).coordinatorSessionId);
        if (!root || !this.validTeamInputs(root, worker, input.messages)) return { kind: 'reject' };
        const stream = this.stream(worker.workstreamId), receipt = latest(stream);
        if (input.messages.some(message => message.source.kind === 'user' && (message.source.rpcId || !content(message).includes(`DelegationRef: ${receipt.ref}`)
          || (receipt.messageId ? receipt.messageId !== message.id : receipt.phase !== 'preparing')))) return { kind: 'reject' };
        if (input.messages.some(message => message.source.kind === 'agent-message' && message.source.senderSessionId !== this.project(worker.projectId).coordinatorSessionId)) return { kind: 'reject' };
        const consumesAssignment = input.messages.some(message => content(message).includes(`DelegationRef: ${receipt.ref}`));
        const resumesAssignment = worker.consumedDelegationRef === receipt.ref && !receipt.report && input.messages.some(message => message.source.kind === 'team-message' && this.teams.messageContext(root, message.source.messageId)?.targetAssignment === receipt.ref);
        if (consumesAssignment || resumesAssignment) await this.serial(() => this.write(state => {
          const member = state.workers.find(item => item.sessionId === worker.sessionId); member.role = receipt.scope; member.writePaths = receipt.writePaths; member.consumedDelegationRef = receipt.ref;
          // The native start precedes message consumption. Bind this input to
          // that activation, never to the latest delegation at start time.
          const consumed = state.workstreams.find(item => item.id === stream.id).delegations.find(item => item.ref === receipt.ref);
          consumed.runId = member.activeRunId;
          if (consumesAssignment && consumed.dispatchedPrerequisites !== undefined && consumed.prerequisites === undefined) consumed.prerequisites = copy(consumed.dispatchedPrerequisites);
          delete consumed.waitingReason;
        }));
        this.approvals.bind(input.agent);
      }
    }
    return next();
  }
  consume(sessionId, turn, streams) {
    const session = this.ctx.agents.get(sessionId)?.session, previous = this.consumed.get(sessionId), entries = previous?.session === session && previous?.turn === turn ? previous.streams.map(entry => ({ ...entry, runs: [...entry.runs], reports: [...entry.reports] })) : [];
    for (const facts of streams) { const entry = entries.find(item => item.id === facts.id); if (entry) { entry.runs = [...new Set([...entry.runs, ...facts.runs])]; entry.reports = [...new Set([...entry.reports, ...facts.reports])]; } else entries.push(facts); }
    this.consumed.set(sessionId, { session, turn, streams: entries });
  }
  guard(exec) {
    if (this.closing) return 'Project is unloading.';
    const coordinator = this.state().projects.find(item => item.coordinatorSessionId === exec.agent?.id);
    if (coordinator && !['project_delegate', 'project_read_store', 'project_stop', 'list_agents', 'team_task_list', 'send_message'].includes(exec.name)) return 'The Project coordinator may only read its materials, delegate or stop work.';
    const worker = this.state().workers.find(item => item.sessionId === exec.agent?.id); if (!worker) return;
    if (this.ctx.agents.get(worker.sessionId) !== exec.agent) return 'Project tools require the exact live worker.';
    if (this.closing || this.held.has(worker.sessionId) || worker.stopped || this.project(worker.projectId).paused) return 'This Project worker is stopped.';
    if (!worker.consumedDelegationRef) return 'A Project assignment has not been consumed.';
    const safe = new Set(['project_read_store', 'project_read', 'project_search', 'project_report', 'project_write_artifact', 'project_write_document', 'list_agents', 'team_task_list', 'send_message']);
    if (worker.role !== 'worker' && !safe.has(exec.name)) return 'This assignment has no shell or unrestricted repository write capability.';
    if (worker.role === 'readonly' && exec.name === 'project_write_document') return 'This repository is read-only for the assignment.';
  }
  async assistantReply(session, event) {
    if (this.closing && !this.persistOnDispose) return;
    if (event.type === 'turn/end') return this.summaryTurnEnded(session, event);
    if (event.type !== 'assistant/message' || event.data.interrupted || event.data.message.content?.some(block => block.type === 'tool-call')) return;
    const consumed = this.consumed.get(session.id), reply = content(event.data.message); if (!consumed || consumed.session !== session || consumed.turn !== event.data.turn || !reply) return;
    await this.serial(async () => { const project = this.state().projects.find(item => item.coordinatorSessionId === session.id); if (!project) return;
      await this.write(state => { for (const entry of consumed.streams) { const work = state.workstreams.find(item => item.id === entry.id);
        // Bind the visible reply to the exact result receipts consumed by this turn.
        for (const terminal of work.settlements) if (entry.runs.includes(terminal.runId)) terminal.summarizedBy = event.data.message.id;
        for (const receipt of work.delegations) if (receipt.report && entry.reports.includes(receipt.ref)) receipt.report.summarizedBy = event.data.message.id;
        if (work.latestReport && entry.reports.includes(work.latestReport.delegationRef)) work.latestReport.summarizedBy = event.data.message.id;
        if (work.summaryFailure && (entry.reports.includes(work.summaryFailure.delegationRef)
          || work.summaryFailure.runId && entry.runs.includes(work.summaryFailure.runId) && work.settlements.some(terminal => terminal.runId === work.summaryFailure.runId && terminal.delegationRefs.includes(work.summaryFailure.delegationRef)))) delete work.summaryFailure;
        work.pendingSummary = work.settlements.some(item => !item.summarizedBy) || work.delegations.some(item => item.report && !item.report.summarizedBy);
      } }); await this.notes(project.id); });
  }
  async summaryTurnEnded(session, event) {
    const consumed = this.consumed.get(session.id);
    if (!consumed || consumed.session !== session || consumed.turn !== event.data.turn) return;
    this.consumed.delete(session.id);
    if (event.data.reason.kind !== 'error') return;
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
      const { code, message } = event.data.reason.error;
      await this.write(state => { for (const entry of failed) {
        const work = state.workstreams.find(item => item.id === entry.id);
        work.summaryFailure = { turn: event.data.turn, at: event.time, delegationRef: work.currentDelegationRef, ...(entry.runId ? { runId: entry.runId } : {}), error: { code, message } };
        work.updatedAt = event.time;
      } });
      await this.notes(project.id);
    });
  }
  async report(actor, args, exec) {
    if (actor.role !== 'worker') fail('unauthorized', 'Only the assigned worker can report.');
    const worker = this.worker(actor.agent.id), stream = this.stream(worker.workstreamId), artifacts = [];
    if (this.held.has(worker.sessionId) || worker.stopped || worker.consumedDelegationRef !== args.delegationRef || latest(stream).ref !== args.delegationRef || this.project(worker.projectId).paused) fail('obsolete_result', 'The report is not for the current consumed delegation.');
    if (!['completed', 'blocked', 'failed'].includes(args.outcome)) fail('invalid_result', 'Choose completed, blocked or failed.');
    const paths = args.artifacts ?? [], evidence = args.evidence ?? [], remainingIssues = args.remainingIssues ?? [];
    if (!Array.isArray(paths) || paths.length > 64 || !Array.isArray(evidence) || evidence.some(item => typeof item !== 'string') || !Array.isArray(remainingIssues) || remainingIssues.some(item => typeof item !== 'string')) fail('invalid_result', 'Artifacts, evidence and remaining issues must be bounded text lists.');
    for (const path of paths) artifacts.push(await checkedFile(path, [worker.cwd, join(actor.project.storageRoot, 'docs', stream.id)]));
    const report = { delegationRef: args.delegationRef, outcome: args.outcome, summary: required(args.summary, 'result summary'), artifacts, evidence, remainingIssues, at: Date.now(), callId: exec.callId,
      ...(latest(stream).prerequisites === undefined ? {} : { prerequisites: copy(latest(stream).prerequisites) }) };
    await this.serial(async () => { if (this.worker(worker.sessionId).stopped || latest(this.stream(stream.id)).ref !== args.delegationRef) fail('obsolete_result', 'The assignment changed while reporting.');
      await this.write(state => { const work = state.workstreams.find(item => item.id === stream.id); latest(work).report = report; work.latestReport = report; work.updatedAt = Date.now(); }); await this.notes(worker.projectId); });
    return { recorded: true, workstreamId: stream.id, report: this.reportView(report, actor.project.id), resultRef: { teamId: actor.project.coordinatorSessionId, taskId: stream.id, assignmentRef: report.delegationRef, reportId: report.callId } };
  }
  async stopTool(actor, args) { this.coordinatorOnly(actor); return this.stop(actor.project.id, args.workstreamId); }
  async stop(projectId, workstreamId, { recordHold = true } = {}) {
    if (this.closing && !this.persistOnDispose) return { projectId, workstreamId, state: 'stopping' };
    const project = this.project(projectId), streams = workstreamId ? [this.stream(workstreamId, projectId)] : this.state().workstreams.filter(item => item.projectId === projectId), ids = streams.map(item => item.workerSessionId);
    if (recordHold) {
      const source = this.ctx.agents.get(project.coordinatorSessionId)?.session?.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user');
      for (const work of streams) this.workerStops.set(work.workerSessionId, { generation: (this.workerStops.get(work.workerSessionId)?.generation ?? 0) + 1, sourceMessageId: source?.data.id ?? latest(work).source.messageId });
    }
    if (!workstreamId) { const lead = this.ctx.agents.get(project.coordinatorSessionId); const last = lead?.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user'); this.projectHolds.set(projectId, last?.data.id ?? ''); lead?.cancel({ kind: 'user' }); }
    for (const id of ids) { this.held.add(id); this.approvals.clear(id); this.ctx.agents.get(id)?.cancel({ kind: 'user' }); for (const job of this.jobs(id)) this.ctx.get('jobs').kill(job.id, id, 'Project work stopped'); }
    let persistenceError;
    try { await this.serial(async () => { const lastUser = this.ctx.agents.get(project.coordinatorSessionId)?.session?.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user');
      await this.write(state => { if (!workstreamId) { const row = state.projects.find(item => item.id === projectId); row.paused = true; if (lastUser) row.holdSourceMessageId = lastUser.data.id; }
      for (const work of state.workstreams.filter(item => ids.includes(item.workerSessionId))) { const member = state.workers.find(item => item.sessionId === work.workerSessionId); member.stopped = true; if (recordHold) member.holdSourceMessageId = lastUser?.data.id ?? latest(work).source.messageId;
        member.phase = this.ctx.agents.get(member.sessionId)?.status === 'running' || this.launches.has(work.id) || this.jobs(member.sessionId).length ? 'stopping' : 'idle';
        for (const receipt of work.delegations.filter(item => ['queued', 'preparing'].includes(item.phase))) receipt.phase = 'stopped';
        if (work.status !== 'done') { work.status = 'blocked'; work.blockedReason = 'stopped'; } work.updatedAt = Date.now(); }
    }); }); } catch (error) { persistenceError = error; }
    const root = this.ctx.agents.get(project.coordinatorSessionId);
    if (root) await this.teams.cancelMessages(root, [...ids, ...(!workstreamId ? [root.id] : [])]).catch(error => { persistenceError ??= error; });
    for (const id of ids) if (!this.stops.has(id)) { const promise = this.finishStop(project, [id]).catch(async error => {
      if (this.closing && !this.persistOnDispose) { this.ctx.logger.warn('Project runtime stop needs attention: %s', error.message); return; }
      // Cancellation/draining has already been attempted. Failure to persist
      // its diagnostic must not leave an unobserved background rejection.
      try {
        await this.serial(async () => { await this.write(state => { const worker = state.workers.find(item => item.sessionId === id); if (worker.phase === 'stopping') { worker.error = error.message; state.workstreams.find(item => item.id === worker.workstreamId).blockedReason = error.message; } }); await this.notes(projectId); });
      } catch (recordingError) { this.ctx.logger.warn('Project stop diagnostic could not be saved: %s', recordingError.message); }
      this.ctx.logger.warn('Project stop needs attention: %s', error.message);
    }).finally(() => this.stops.delete(id)); this.stops.set(id, promise); }
    await this.serial(() => this.notes(projectId)).catch(error => this.ctx.logger.warn('Project stopped; notes could not be refreshed: %s', error.message));
    if (persistenceError) throw persistenceError;
    return { projectId, workstreamId, state: ids.some(id => this.worker(id).phase === 'stopping') ? 'stopping' : 'stopped' };
  }
  async finishStop(project, ids) {
    for (const id of ids) {
      await this.drainWorker(project, id);
      if (this.closing && !this.persistOnDispose) return;
      await this.serial(() => this.write(state => { const row = state.workers.find(item => item.sessionId === id); row.phase = 'idle'; row.activeRunId = ''; row.reservationRef = ''; row.directoryHeld = false; row.updatedAt = Date.now(); }));
      const root = this.ctx.agents.get(project.coordinatorSessionId); if (root) await this.teams.setCold(root, id, this.worker(id).workstreamId, true);
    }
    await this.serial(() => this.notes(project.id)).catch(error => this.ctx.logger.warn('Project drained; notes could not be refreshed: %s', error.message)); this.schedule();
  }
  async drainWorker(project, id) {
    const member = this.worker(id), launch = this.launches.get(member.workstreamId); if (launch) await launch.catch(() => {});
    const agent = this.ctx.agents.get(id), jobs = this.ctx.get('jobs'), owned = this.jobs(id);
    for (const job of owned) jobs.kill(job.id, id, 'Project work stopped');
    // Waiters precede native disposal, which removes owner records.
    const waits = owned.map(job => jobs.wait(job.id, 30000, id)); agent?.cancel({ kind: 'user' });
    const parent = this.ctx.agents.get(project.coordinatorSessionId); if (parent) await this.ctx.subagents.drainContinuableChildren(parent, [id]);
    if (agent) await agent.whenIdle();
    for (const after of await Promise.all(waits)) if (['running', 'stopping'].includes(after.status)) fail('stopping', 'A worker-owned job has not stopped; the directory stays occupied.');
  }
  async sessionStop(sessionId) { const project = this.state().projects.find(item => item.coordinatorSessionId === sessionId); if (project) await this.stop(project.id); }
  schedule() {
    if (this.closing) return;
    this.scheduleRevision++;
    this.scheduleRequested = true;
    if (this.scheduling) return; this.scheduling = true;
    void (async () => {
      do {
        this.scheduleRequested = false;
        for (const work of this.state().workstreams) if (!this.projectHolds.has(work.projectId) && !this.held.has(work.workerSessionId) && !this.worker(work.workerSessionId).stopped && !this.project(work.projectId).paused && latest(work).phase === 'queued') await this.launch(work.id).catch(error => this.ctx.logger.warn('Project queued work blocked: %s', error.message));
      } while (this.scheduleRequested && !this.closing);
    })().finally(() => { this.scheduling = false; });
  }
  async jobChanged(event) {
    if (this.closing && !this.persistOnDispose) return;
    if (event.type !== 'settled' && event.type !== 'removed') return;
    const id = event.job.owner, member = this.state().workers.find(item => item.sessionId === id); if (!member || member.activeRunId || this.launches.has(member.workstreamId) || this.jobs(id).length || this.ctx.agents.get(id)?.status === 'running' || member.phase === 'stopping') return;
    await this.serial(async () => {
      const current = this.worker(id);
      if (current.activeRunId || this.launches.has(current.workstreamId) || this.jobs(id).length || this.ctx.agents.get(id)?.status === 'running' || current.phase === 'stopping') return;
      await this.write(state => { const worker = state.workers.find(item => item.sessionId === id); worker.directoryHeld = false; const work = state.workstreams.find(item => item.id === worker.workstreamId), receipt = latest(work);
      if (!worker.stopped && receipt.report && work.settlements.some(terminal => terminal.delegationRefs.includes(receipt.ref) && terminal.stopReason === 'completed')) { work.status = receipt.report.outcome === 'completed' ? 'done' : 'blocked'; work.blockedReason = receipt.report.outcome === 'completed' ? '' : receipt.report.summary; }
    }); await this.completeTask(this.stream(member.workstreamId)); await this.notes(member.projectId); }); this.schedule();
  }
  preferencesFor(id) {
    const project = this.state().projects.find(item => item.coordinatorSessionId === id); if (!project) return '';
    if (realpathSync(project.storageRoot) !== project.storageRoot) fail('store_path', 'Project materials directory was replaced with a link.');
    const path = join(project.storageRoot, 'preferences.md'); if (realpathSync(path) !== path) fail('store_path', 'Preferences was replaced with a link.');
    const value = readFileSync(path, 'utf8'); if (Buffer.byteLength(value, 'utf8') > 256000) fail('store_size', 'Preferences exceeds the size limit.'); return value ? `Project preferences (current user instructions take precedence):\n${value}` : '';
  }
  async notes(id) {
    const project = this.project(id), root = await this.storeRoot(project), path = join(root, 'notes.md'); let user = '';
    try { const actual = await this.storePath(project, 'notes.md'), old = await fs.readFile(actual, 'utf8'); if (old.includes(marker)) user = old.slice(old.indexOf(marker) + marker.length); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const all = this.state().workstreams.filter(item => item.projectId === id);
    const rows = (await this.workRows(id)).slice(0,20).map(({ work, worker }) => `- [${work.status === 'done' ? 'x' : ' '}] ${work.title} (${work.id})\n  Status: ${work.status}${work.blockedReason ? `; ${work.blockedReason}` : ''}; worker ${worker.phase}\n  Directory: ${worker.cwd || 'not started'}\n  Current request: ${work.brief.slice(0, 2000)}\n${work.latestReport ? `  Worker report (${work.latestReport.outcome}): ${work.latestReport.summary.slice(0,2000)}\n  Artifacts: ${work.latestReport.artifacts.map(item => item.path).join(', ')}\n  Evidence: ${work.latestReport.evidence.join('; ').slice(0,2000)}\n  Remaining issues: ${work.latestReport.remainingIssues.join('; ').slice(0,2000) || 'none reported'}\n` : ''}${work.summaryFailure ? `  Summary failed (${work.summaryFailure.error.code}): ${work.summaryFailure.error.message}\n  Saved result remains available; request a new summary in the main conversation.\n` : work.pendingSummary ? '  Pending: no associated visible coordinator summary yet.\n' : ''}`);
    const generated = `# ${project.title}\n\nBound directory: ${project.canonicalWorkingDirectory}\nProject ${project.paused ? 'paused' : 'available'}; ${project.lifecycle}\n\n${rows.join('\n') || 'No delegated work yet.'}\nShowing ${rows.length} of ${all.length} works. Use project_read_store with cursor/query for older work.\n\n`;
    await atomicText(path, boundedNotesGenerated(generated) + marker + user);
  }
  async storeRoot(project) {
    const root = await safeProjectSubdirectory(this.home, project.id);
    if (root !== project.storageRoot) fail('store_path', 'Project materials directory does not match its registered identity.');
    return checkedRoot(root);
  }
  async storePath(project, path) {
    if (typeof path !== 'string' || !(path === 'notes.md' || path === 'preferences.md' || path.startsWith('docs/')) || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === 'internal' || part.toLowerCase() === '.git')) fail('store_path', 'Only notes.md, preferences.md and docs files are readable.');
    const root = await this.storeRoot(project), actual = await fs.realpath(resolve(root, path)), docs = await checkedRoot(join(root, 'docs'));
    if ((path.startsWith('docs/') ? !within(docs, actual) : actual !== join(root, path)) || !(await fs.stat(actual)).isFile()) fail('store_path', 'Material is outside the allowed root or is not a file.'); return actual;
  }
  async readStore(id, path) {
    const actual = await this.storePath(this.project(id), path);
    if (path !== 'notes.md' && (await fs.stat(actual)).size > 512000) fail('store_size', 'Material exceeds the read limit.');
    const value = await fs.readFile(actual, 'utf8');
    if (path !== 'notes.md') return { path, text: value };
    const split = value.indexOf(marker), suffix = split >= 0 ? value.slice(split + marker.length) : '', userText = suffix.replace(/^\r?\n/, '');
    if (Buffer.byteLength(userText) > 256000) fail('store_size', 'User notes exceed the read limit.');
    const generatedText = boundedNotesGenerated(split >= 0 ? value.slice(0, split) : value);
    return { path, text: generatedText + (split >= 0 ? marker + suffix : ''), generatedText, userText };
  }
  async readStoreTool(actor, args) {
    if (args.path === 'notes.md') {
      const all = (await this.workRows(actor.project.id)).map(row => row.work).filter(item => (!args.workstreamId || item.id === args.workstreamId) && (!args.query || item.title.toLowerCase().includes(args.query.toLowerCase())));
      const offset = args.workstreamId ? 0 : Math.max(0, Number(args.cursor) || 0), page = all.slice(offset, offset + 20);
      const terminalFor = (work, report) => {
        const receipt = report ? work.delegations.find(item => item.ref === report.delegationRef) : latest(work);
        return receipt && work.settlements.find(item => item.runId === receipt.runId && item.delegationRefs.includes(receipt.ref));
      };
      const historyWork = args.workstreamId ? this.stream(args.workstreamId, actor.project.id) : undefined;
      let history;
      if (historyWork) {
        const unreported = historyWork.settlements.filter(terminal => !historyWork.delegations.some(receipt => receipt.report && receipt.runId === terminal.runId && terminal.delegationRefs.includes(receipt.ref))).toReversed();
        if (args.cursor?.startsWith('terminal:')) {
          const anchor = args.cursor.slice('terminal:'.length), start = anchor ? unreported.findIndex(item => item.runId === anchor) + 1 : 0;
          if (anchor && start === 0) fail('result_cursor', 'This terminal cursor does not belong to the selected work.');
          const items = unreported.slice(start, start + 10).map(terminal => ({ terminal })), hasMore = start + items.length < unreported.length;
          history = { items, total: unreported.length, hasMore, nextCursor: hasMore ? `terminal:${items.at(-1).terminal.runId}` : null };
        } else {
          const historyPage = this.resultHistory(actor.project.id, args), nextCursor = historyPage.nextCursor ?? (unreported.length ? 'terminal:' : null);
          history = { ...historyPage, hasMore: Boolean(nextCursor), nextCursor, items: historyPage.items.map(report => ({ report, terminal: terminalFor(historyWork, report) })) };
        }
      }
      const delivered = page.map(work => ({ work, reports: latest(work).report ? [latest(work).report] : [], terminals: [terminalFor(work, latest(work).report)].filter(Boolean) }));
      if (history) delivered.push({ work: historyWork, reports: history.items.map(item => item.report).filter(Boolean), terminals: history.items.map(item => item.terminal).filter(Boolean) });
      const userNotes = (await this.readStore(actor.project.id, 'notes.md')).userText;
      if (actor.role === 'coordinator') {
        const turn = actor.agent.session.snapshotEvents().findLast(event => event.type === 'turn/start')?.data.turn;
        this.consume(actor.agent.id, turn, delivered.filter(({ work }) => work.pendingSummary).map(({ work, reports, terminals }) => ({ id: work.id,
          runs: terminals.filter(terminal => !terminal.summarizedBy).map(terminal => terminal.runId),
          reports: reports.filter(report => !report.summarizedBy).map(report => report.delegationRef) })));
      }
      return copy({ total: all.length, nextCursor: args.workstreamId ? history.nextCursor : offset + page.length < all.length ? String(offset + page.length) : null,
        work: page.map(work => ({ id: work.id, title: work.title, status: work.status, summaryFailure: work.summaryFailure, requirement: latest(work).brief, report: latest(work).report && this.reportView(latest(work).report, actor.project.id),
          terminal: terminalFor(work, latest(work).report), workerSessionId: work.workerSessionId, resultRef: latest(work).report ? { teamId: actor.project.coordinatorSessionId, taskId: work.id, assignmentRef: latest(work).ref, reportId: latest(work).report.callId } : null })),
        ...(history ? { history } : { historyHint: 'Read notes.md with workstreamId and optional cursor to page through that work\'s actual historical reports and matching settlements.' }),
        userNotes });
    }
    return this.readStore(actor.project.id, args.path);
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
  async listStore(id, { resultsCursor } = {}) {
    const root = await checkedRoot(join(await this.storeRoot(this.project(id)), 'docs')), docs = [];
    const visit = async folder => { for (const item of await fs.readdir(folder, { withFileTypes: true })) { if (item.isSymbolicLink()) continue; const path = join(folder, item.name); if (item.isDirectory()) await visit(path); else if (item.isFile()) docs.push({ path: `docs/${relative(root, path).replaceAll('\\', '/')}`, size: (await fs.stat(path)).size }); } }; await visit(root);
    const all = this.state().workstreams.filter(work => work.projectId === id).flatMap(work => { const report = work.delegations.findLast(item => item.report)?.report; return report ? [{ workstreamId: work.id, title: work.title, current: report.delegationRef === work.currentDelegationRef, reportCount: work.delegations.filter(item => item.report).length, report }] : []; }).sort((a,b) => b.report.at - a.report.at || a.report.delegationRef.localeCompare(b.report.delegationRef));
    const start = resultsCursor == null ? 0 : all.findIndex(item => item.report.delegationRef === resultsCursor) + 1;
    if (resultsCursor != null && start === 0) fail('result_cursor', 'This result cursor does not belong to the current Project results.');
    const results = all.slice(start, start + 10).map(item => ({ ...item, report: this.reportView(item.report, id) }));
    return copy({ docs, results, resultsTotal: all.length, resultsCursor: resultsCursor ?? null,
      nextResultsCursor: start + results.length < all.length ? results.at(-1).report.delegationRef : null, notes: 'notes.md', preferences: 'preferences.md' });
  }
  resultHistory(projectId, { workstreamId, cursor } = {}) {
    const work = this.stream(workstreamId, projectId), reports = work.delegations.filter(item => item.report).map(item => item.report).reverse();
    const start = cursor === undefined ? 0 : reports.findIndex(report => report.delegationRef === cursor) + 1;
    if (cursor !== undefined && start === 0) fail('result_cursor', 'This result cursor does not belong to the selected work.');
    const items = reports.slice(start, start + 10).map(report => this.reportView(report, projectId)), hasMore = start + items.length < reports.length;
    return copy({ items, total: reports.length, hasMore, nextCursor: hasMore ? items.at(-1).delegationRef : null });
  }
  async recover() {
    for (const project of this.state().projects) try {
      if (project.lifecycle === 'creating') await this.finishCreation(project);
      else {
        let directoryFailed = false;
        for (const root of [project.storageRoot, project.canonicalWorkingDirectory]) {
          let failure;
          try { await checkedRoot(root); } catch (error) { failure = error; directoryFailed = true; }
          const diagnostics = this.project(project.id).diagnostics;
          if (failure || diagnostics.some(message => isDirectoryDiagnostic(message, root))) await this.write(state => {
            const row = state.projects.find(item => item.id === project.id);
            row.diagnostics = row.diagnostics.filter(message => !isDirectoryDiagnostic(message, root));
            if (failure) { row.diagnostics.push(`${directoryDiagnosticPrefix(root)}${failure.message}`); row.paused = true; }
          });
        }
        if (!directoryFailed) await this.ctx.sessionController.inspect(project.coordinatorSessionId);
      }
    } catch (error) { await this.write(state => { const row = state.projects.find(item => item.id === project.id); if (!row.diagnostics.includes(error.message)) row.diagnostics.push(error.message); row.paused = true; }); }
    for (const worker of this.state().workers) {
      try {
        const saved = await this.ctx.sessionPersistence.stat(worker.sessionId);
        if (!saved) { if (worker.materialized) throw new Error('The original worker Session is missing.'); continue; }
        const inspection = await this.ctx.sessionController.inspect(worker.sessionId), project = this.project(worker.projectId);
        if (inspection.meta.parentSession !== project.coordinatorSessionId || inspection.meta.origin !== 'subagent'
          || inspection.meta.cwd !== worker.cwd || inspection.meta.agentPreset !== 'project-worker') throw new Error('The original worker Session identity, role or cwd does not match its Project.');
        await this.write(state => {
          const member = state.workers.find(item => item.sessionId === worker.sessionId), work = state.workstreams.find(item => item.id === worker.workstreamId); member.materialized = true;
          for (const receipt of work.delegations) {
            const input = inspection.events.find(event => event.type === 'user/message' && ['user', 'agent-message', 'team-message'].includes(event.data.source.kind) && content(event.data).includes(`DelegationRef: ${receipt.ref}`));
            if (!input) continue; receipt.messageId ||= input.data.id;
            if (['preparing', 'queued'].includes(receipt.phase)) receipt.phase = 'accepted';
            // A turn/end is not an activation settlement and cannot prove
            // aggregate stop reason, disposal or flush. Preserve un-settled
            // reports without manufacturing a native terminal fact.
            if (receipt.ref === work.currentDelegationRef && receipt.report && !work.settlements.some(terminal => terminal.delegationRefs.includes(receipt.ref))) {
              work.latestReport = receipt.report; work.status = 'blocked'; work.blockedReason = 'Worker report exists, but native settlement was not durably recorded.';
              work.pendingSummary ||= !receipt.report.summarizedBy;
            }
          }
        });
      } catch (error) {
        await this.write(state => { const member = state.workers.find(item => item.sessionId === worker.sessionId); member.error = error.message; member.phase = 'failed';
          const work = state.workstreams.find(item => item.id === worker.workstreamId); work.status = 'blocked'; work.blockedReason = error.message; });
      }
    }
    await this.write(state => { for (const project of state.projects) project.paused = true;
      for (const worker of state.workers) { worker.directoryHeld = false; worker.activeRunId = ''; worker.reservationRef = ''; if (['active', 'provisioning', 'stopping'].includes(worker.phase)) worker.phase = worker.materialized ? 'idle' : 'failed'; worker.stopped = true;
        const work = state.workstreams.find(item => item.id === worker.workstreamId); for (const receipt of work.delegations.filter(item => ['queued', 'preparing'].includes(item.phase))) { receipt.phase = 'failed'; receipt.error = 'Application interrupted; inbox acceptance could not be confirmed.'; }
        if (work.status !== 'done') { work.status = 'blocked'; work.blockedReason = 'Application restarted; waiting for explicit continuation.'; }
      } });
    for (const project of this.state().projects) if (!project.diagnostics.length) {
      try { const root = await this.coordinator(project); await this.teams.bindPolicy(root, policy);
        for (const work of this.state().workstreams.filter(item => item.projectId === project.id)) { await this.ensureTask(work); const worker = this.worker(work.workerSessionId); if (worker.materialized) { await this.teams.adoptMember(root, this.memberRequest(worker, work)); await this.assignTask(root, work, worker); await this.completeTask(work); await this.teams.setCold(root, worker.sessionId, work.id, true); } else await this.coldFailedLaunch(work); }
        await this.teams.cancelMessages(root, [root.id, ...this.state().workers.filter(item => item.projectId === project.id).map(item => item.sessionId)]); await this.notes(project.id);
      } catch (error) { await this.write(state => { state.projects.find(item => item.id === project.id).diagnostics = [error.message]; }); }
    }
    this.recovering = false;
    // Read-only reconciliation: no activation, followup or replacement notice.
  }
  async command(endpoint, input = {}) {
    if (endpoint === 'list' && !this.available) return { projects: [], available: false, error: this.error || 'Project Host is unavailable.' };
    if (!this.available || this.closing) fail('unavailable', this.error || 'Project Host is unavailable.');
    if (endpoint === 'list') return copy({ projects: this.state().projects.map(project => this.projectView(project)).sort((a,b) => b.updatedAt - a.updatedAt), available: true });
    if (endpoint === 'create') return this.create(input);
    const project = this.project(input.projectId);
    if (endpoint === 'detail') return this.detail(project.id, input);
    if (endpoint === 'workstreams/list') return this.listWorkstreams(project.id, input);
    if (endpoint === 'workstreams/get') return this.getWorkstream(project.id, input);
    if ((endpoint === 'stop' || endpoint === 'pause') && !input.workstreamId) this.ctx.agents.get(project.coordinatorSessionId)?.cancel({ kind: 'user' });
    if (endpoint === 'stop' || endpoint === 'pause') return this.stop(project.id, endpoint === 'stop' ? input.workstreamId : undefined);
    if (endpoint === 'resume' || endpoint === 'restore') { await this.serial(async () => { await this.write(state => { const row = state.projects.find(item => item.id === project.id); row.paused = false; if (endpoint === 'restore') row.lifecycle = 'ready'; row.updatedAt = Date.now(); }); await this.notes(project.id); }); return { project: copy(this.project(project.id)), note: 'Ready for a new user message; old requests are not automatically started.' }; }
    if (endpoint === 'archive') { this.archiving.add(project.id); try { const lead = this.ctx.agents.get(project.coordinatorSessionId); lead?.cancel({ kind: 'user' }); await this.stop(project.id); await lead?.whenIdle(); await Promise.all([...this.stops.values()]); if (this.state().workers.some(item => item.projectId === project.id && item.phase === 'stopping')) fail('stopping', 'Background activity has not stopped.'); await this.serial(async () => { await this.write(state => { state.projects.find(item => item.id === project.id).lifecycle = 'archived'; }); await this.notes(project.id); }); return { project: copy(this.project(project.id)) }; } finally { this.archiving.delete(project.id); } }
    if (endpoint === 'rename') { const title = required(input.title, 'project title', 240); await this.serial(() => this.write(state => { const row = state.projects.find(item => item.id === project.id); row.title = title; row.updatedAt = Date.now(); })); const root = await this.coordinator(this.project(project.id)); root.session.append('session/presentation', { owner: 'project', title, workingDirectory: project.canonicalWorkingDirectory }); await this.ctx.sessions.flush(root.session); await this.notes(project.id); return { project: copy(this.project(project.id)) }; }
    if (endpoint === 'store/list') return this.listStore(project.id, input);
    if (endpoint === 'store/results') return this.resultHistory(project.id, input);
    if (endpoint === 'store/read') return this.readStore(project.id, input.path);
    if (endpoint === 'store/write') return this.serial(async () => { if (this.project(project.id).lifecycle !== 'ready' || this.archiving.has(project.id)) fail('archived', 'Restore this Project before editing its materials.'); if (!['notes.md', 'preferences.md'].includes(input.path) || typeof input.text !== 'string' || Buffer.byteLength(input.text, 'utf8') > 256000) fail('store_path', 'Only notes正文 and preferences may be edited.'); const path = await this.storePath(project, input.path);
      if (input.path === 'notes.md') { if (input.text.includes(marker)) fail('store_path', 'Edit only the user notes body, not the generated section.'); const old = await fs.readFile(path, 'utf8'); if (!old.includes(marker)) fail('store_path', 'The generated notes separator is missing.'); await atomicText(path, boundedNotesGenerated(old.slice(0, old.indexOf(marker))) + marker + '\n' + input.text); } else await atomicText(path, input.text);
      await this.write(state => { state.projects.find(item => item.id === project.id).updatedAt = Date.now(); }); return this.readStore(project.id, input.path); });
    if (endpoint === 'open') {
      if (!input.path) return this.desktop('open-path', { projectId: project.id, workingDirectory: project.canonicalWorkingDirectory, path: project.canonicalWorkingDirectory });
      if (input.workstreamId) { const work = this.stream(input.workstreamId, project.id), worker = this.worker(work.workerSessionId), artifact = work.delegations.filter(item => !input.delegationRef || item.ref === input.delegationRef).flatMap(item => item.report?.artifacts ?? []).find(item => item.path === input.path); if (!artifact) fail('store_path', 'The selected result did not report this artifact.'); const checked = await checkedFile(artifact.path, [worker.cwd, join(project.storageRoot, 'docs', work.id)]); const opened = await this.desktop('resolve-path', { projectId: project.id, workstreamId: work.id, workingDirectory: worker.cwd, path: checked.path }); return { ...opened, modifiedSinceReport: checked.sha256 !== artifact.sha256 }; }
      if (!String(input.path).startsWith('docs/')) fail('store_path', 'Desktop material opening is limited to Project docs.'); return this.desktop('resolve-path', { projectId: project.id, path: await this.storePath(project, input.path) });
    }
    if (endpoint === 'diff') { const work = this.stream(input.workstreamId, project.id), worker = this.worker(work.workerSessionId); return { snapshot: await this.desktop('snapshot', { projectId: project.id, workstreamId: work.id, workspace: worker.workspace }), worker: { cwd: worker.cwd, mode: worker.mode, ...(worker.branch ? { branch: worker.branch } : {}) } }; }
    fail('unknown_command', 'This Project command is unavailable. Delegation and reporting require actual Agent tool provenance.');
  }
  dispose({ persist = true } = {}) { return this.disposal ??= this.doDispose(persist); }
  async doDispose(persist) { const projects = this.state().projects; this.persistOnDispose = persist; this.closing = true;
    this.approvals.dispose();
    if (persist) for (const project of projects) await this.stop(project.id);
    const coordinators = this.state().projects.map(project => this.ctx.agents.get(project.coordinatorSessionId)).filter(Boolean);
    for (const agent of coordinators) agent.cancel({ kind: 'user' });
    await Promise.all(coordinators.map(agent => agent.whenIdle()));
    if (!persist) await Promise.all(this.state().workers.map(worker => this.drainWorker(this.project(worker.projectId), worker.sessionId)));
    await Promise.all([...this.launches.values()].map(promise => promise.catch(() => {}))); await Promise.all([...this.stops.values()]); await this.tail; this.unpolicy(); this.unteam(); this.available = false; }
}
