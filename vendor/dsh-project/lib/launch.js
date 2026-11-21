/** Delegation, worker activation launch, recovery and project lifecycle cleanup/reset operations. */
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { checkedRoot, safeProjectSubdirectory, samePath } from './files.js';
import { ALL_WORKER_PRESETS, presetForScope } from './presets.js';
import { classifyExecutionError, detectHotspotConflicts } from './evidence.js';
import * as changesOps from './changes.js';
import * as workOps from './workstream-ops.js';
import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal';

const copy = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const required = (value, label, limit = 32000) => { if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Invalid ${label}.`); return value.trim(); };
const content = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const latest = stream => stream.delegations.find(item => item.ref === stream.currentDelegationRef);
const readOnly = scope => scope === 'readonly' || scope === 'research';
const policy = 'dsh-project-local';
const directoryDiagnosticPrefix = root => `Project directory check (${root}): `;
const isDirectoryDiagnostic = (message, root) => message.startsWith(directoryDiagnosticPrefix(root))
  || /^(ENOENT|ENOTDIR):/.test(message) && message.includes(`'${root}'`);

export function validateDependenciesFor(service, projectId, existingId, blockers) {
  const works = service.state().workstreams.filter(work => work.projectId === projectId);
  const graph = new Map(works.map(work => [work.id, work.id === existingId ? blockers : work.blockedBy ?? []]));
  for (const id of blockers) if (!graph.has(id)) fail('dependencies', 'Dependencies must reference existing work in this Project.');
  const nativeGraph = new Map(graph);
  const root = service.ctx.agents.get(service.project(projectId).coordinatorSessionId);
  if (root) for (const task of service.projectTasks(root)) nativeGraph.set(task.id, task.id === existingId ? blockers : task.blockedBy);
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
}

function validateDelegatePaths(role, paths) {
  if (!Array.isArray(paths) || paths.length > 64 || paths.some(path => typeof path !== 'string' || !path || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git'))) {
    fail('invalid_scope', 'Document scope requires exact relative paths.');
  }
  if (role === 'docs' && paths.some(path => !/\.(md|mdx|txt|rst|adoc)$/i.test(path))) {
    fail('invalid_scope', 'Documentation scope supports only declared .md, .mdx, .txt, .rst and .adoc documents.');
  }
}

async function drainExistingIfNeeded(service, actor, existing, { source, role, paths, blockers }) {
  if (!existing) return false;
  const worker = service.worker(existing.workerSessionId), previous = latest(existing);
  const changesScope = previous.scope !== role || (role === 'docs' && JSON.stringify([...new Set(paths)].sort()) !== JSON.stringify([...new Set(previous.writePaths)].sort()));
  const changesDependencies = JSON.stringify(existing.blockedBy ?? []) !== JSON.stringify([...new Set(blockers)]);
  const enablesApproval = service.approvals.needsDrain(actor, source, role, worker);
  const needsStop = (changesScope || changesDependencies || enablesApproval)
    && (enablesApproval || service.ctx.agents.get(worker.sessionId)?.status === 'running' || service.jobs(worker.sessionId).length);
  if (!needsStop) return false;
  const internallyDrained = !worker.stopped && !service.held.has(worker.sessionId);
  await service.stop(actor.project.id, existing.id, { recordHold: false });
  await service.stops.get(worker.sessionId);
  return internallyDrained;
}

async function persistDelegation(service, project, actor, existing, ctxData) {
  const { args, blockers, brief, role, paths, receipt, source, continuationId, internallyDrained, now } = ctxData;
  if (existing) {
    const worker = service.worker(existing.workerSessionId), row = service.stream(existing.id);
    if (worker.phase === 'stopping') fail('stopping', 'The original worker is still stopping.');
    if (args.isolate !== undefined && worker.mode !== (args.isolate ? 'worktree' : 'existing')) fail('fixed_directory', 'The original directory arrangement is fixed.');
    const stoppedHold = (worker.stopped && !internallyDrained || project.paused) && (latest(row).source.continuationMessageId ?? latest(row).source.messageId) === continuationId;
    if (worker.holdSourceMessageId === continuationId || stoppedHold) fail('stopped', 'Stopped work needs a new explicit user continuation.');
    await service.write(state => {
      const work = state.workstreams.find(item => item.id === row.id), member = state.workers.find(item => item.sessionId === worker.sessionId);
      for (const previous of work.delegations.filter(item => ['queued', 'preparing'].includes(item.phase))) {
        previous.phase = 'stopped'; previous.supersededBy = receipt.ref; previous.error = 'Replaced by a later accepted assignment before consumption.';
      }
      work.brief = brief; if (args.blockedBy !== undefined) work.blockedBy = [...new Set(blockers)];
      work.currentDelegationRef = receipt.ref; work.delegations.push(receipt); work.status = 'open'; work.blockedReason = '';
      delete work.latestReport; delete work.summaryFailure; delete work.escalatedAt; work.updatedAt = now;
      member.stopped = false; member.error = ''; member.preset = presetForScope(role);
      state.projects.find(item => item.id === project.id).paused = false;
    });
    return service.stream(row.id);
  }
  const replaces = await service.requirements.replacement(project.id, args, source);
  const id = `work-${randomUUID()}`, sessionId = `session-${randomUUID()}`;
  const work = {
    id, projectId: project.id, blockedBy: [...new Set(blockers)], title: required(args.title || brief.slice(0, 100), 'title', 240), brief, status: 'open',
    workerSessionId: sessionId, ...(replaces ? { replaces } : {}), blockedReason: '', currentDelegationRef: receipt.ref,
    delegations: [receipt], settlements: [], pendingSummary: false, archived: false, createdAt: now, updatedAt: now,
  };
  const worker = {
    sessionId, projectId: project.id, workstreamId: id, ...(actor.role === 'worker' ? { parentSessionId: actor.agent.id } : {}),
    cwd: '', role, preset: receipt.provider === 'fork' ? undefined : presetForScope(role), mode: args.isolate ? 'worktree' : 'existing',
    phase: 'provisioning', directoryHeld: false, stopped: false, materialized: false, writePaths: [...new Set(paths)],
    consumedDelegationRef: '', error: '', updatedAt: now,
  };
  await service.write(state => { state.workstreams.push(work); state.workers.push(worker); state.projects.find(item => item.id === project.id).paused = false; });
  return service.stream(id);
}

function resolveDelegateSpec(service, actor, args, existing) {
  const brief = required(args.brief, 'brief');
  const role = { development: 'worker', readonly: 'readonly', research: 'research', docs: 'docs' }[args.scope];
  if (!role) fail('invalid_scope', 'Choose readonly, research, docs or development.');
  const blockers = args.blockedBy === undefined ? existing?.blockedBy ?? [] : args.blockedBy;
  if (!Array.isArray(blockers) || blockers.length > 64) fail('dependencies', 'Dependencies must reference existing work in this Project.');
  const paths = args.writePaths ?? [];
  validateDelegatePaths(role, paths);
  return { brief, role, blockers, paths };
}

function buildDelegationReceipt({ ref, source, brief, role, args, hotspot, paths, now }) {
  return {
    ref, source, brief, scope: role, provider: args.nativeProvider ?? 'spawn',
    ...(args.nativeName ? { nativeName: args.nativeName } : {}),
    ...(args.nativeOptions ? { nativeOptions: args.nativeOptions } : {}),
    ...(args.reviewerFor ? { reviewerFor: args.reviewerFor } : {}),
    ...(hotspot.warnings.length ? { hotspotWarnings: hotspot.warnings } : {}),
    writePaths: [...new Set(paths)], phase: 'queued', messageId: '', runId: '', error: '', createdAt: now,
  };
}

function assertDelegationTransactionReady(service, project, existing, { source, role, continuationId, stopGeneration }) {
  if (service.closing || service.archiving.has(project.id) || project.lifecycle !== 'ready') fail('unavailable', 'Restore this Project before delegating.');
  service.requirements.get(project.id, source.requestId, source.requestRevision);
  service.queue.assertWork(service.requirements.get(project.id, source.requestId), source.requestRevision, readOnly(role) ? 'readonly' : role);
  if (service.projectHolds.get(project.id) === continuationId || project.holdSourceMessageId === continuationId) fail('stopped', 'The request was stopped; a new actual user message is required.');
  if (existing && (service.workerStops.get(existing.workerSessionId)?.generation ?? 0) !== stopGeneration) fail('stopped', 'The work was stopped while its continuation was being prepared.');
}

async function acceptDelegationTransaction(service, actor, existing, params) {
  const { args, source, continuationId, stopGeneration, ref, brief, role, blockers, paths, internallyDrained } = params;
  const project = service.project(actor.project.id);
  assertDelegationTransactionReady(service, project, existing, { source, role, continuationId, stopGeneration });
  const replay = service.state().workstreams.find(item => item.projectId === project.id && item.delegations.some(receipt => receipt.ref === ref));
  if (replay) return { stream: replay, hotspot: { conflicts: [], warnings: [], hasWriteOverlap: false } };
  validateDependenciesFor(service, project.id, existing?.id, blockers);
  const hotspot = detectHotspotConflicts(service.state(), project, { workstreamId: existing?.id, scope: role, writePaths: [...new Set(paths)], title: args.title ?? existing?.title, brief, blockedBy: blockers });
  const now = Date.now();
  const receipt = buildDelegationReceipt({ ref, source, brief, role, args, hotspot, paths, now });
  const stream = await persistDelegation(service, project, actor, existing, { args, blockers, brief, role, paths, receipt, source, continuationId, internallyDrained, now });
  if (existing && (service.workerStops.get(existing.workerSessionId)?.generation ?? 0) !== stopGeneration) fail('stopped', 'The work was stopped while its continuation was being prepared.');
  service.approvals.accept(actor, source, receipt, stream.workerSessionId);
  service.projectHolds.delete(project.id); service.held.delete(stream.workerSessionId);
  await service.notes(project.id);
  return { stream, hotspot };
}

export async function doDelegate(service, actor, args, exec) {
  if (actor.role !== 'coordinator' && !args.nativeProvider) fail('unauthorized', 'Nested work uses native delegation.');
  exec.signal.throwIfAborted();
  const existing = args.workstreamId ? service.stream(args.workstreamId, actor.project.id) : undefined;
  const { source } = actor.role === 'coordinator' ? await service.requirements.assignment(actor, args, exec, existing) : { source: copy(latest(service.stream(actor.worker.workstreamId)).source) };
  const continuationId = source.continuationMessageId ?? source.messageId;
  const assertNotHeld = () => {
    if (service.projectHolds.get(actor.project.id) === continuationId || service.project(actor.project.id).holdSourceMessageId === continuationId) fail('stopped', 'The request was stopped; a new actual user message is required.');
  };
  assertNotHeld();
  if (existing && service.workerStops.get(existing.workerSessionId)?.sourceMessageId === continuationId) fail('stopped', 'The request was stopped; a new actual user message is required.');
  const { brief, role, blockers, paths } = resolveDelegateSpec(service, actor, args, existing);
  await service.serial(() => validateDependenciesFor(service, actor.project.id, existing?.id, blockers));
  assertNotHeld();
  const ref = `${actor.agent.id}:${exec.callId}`;
  const stopGeneration = existing ? service.workerStops.get(existing.workerSessionId)?.generation ?? 0 : 0;
  const internallyDrained = await drainExistingIfNeeded(service, actor, existing, { source, role, paths, blockers });
  const { stream, hotspot } = await service.serial(() => acceptDelegationTransaction(service, actor, existing, { args, source, continuationId, stopGeneration, ref, brief, role, blockers, paths, internallyDrained }));
  await service.launch(stream.id, exec.signal);
  const worker = service.worker(stream.workerSessionId), receipt = service.stream(stream.id).delegations.find(item => item.ref === ref);
  return copy({
    workstreamId: stream.id, workerSessionId: worker.sessionId, delegationRef: ref, requestId: source.requestId, requestRevision: source.requestRevision,
    messageId: receipt.messageId, phase: receipt.phase === 'queued' ? 'queued' : worker.phase, cwd: worker.cwd, ...(receipt.error ? { error: receipt.error } : {}),
    ...(hotspot.conflicts.length ? { hotspotConflicts: hotspot.conflicts, hotspotWarnings: hotspot.warnings } : {}),
    instruction: 'After arranging necessary current assignments, briefly tell the user what is actually running or queued and what result they will receive, then end this turn. This is progress, not a repository finding or delivery. Native settlement resumes you with the real results; do not poll to wait for members.',
  });
}

function canReserveLaunch(service, project, worker, receipt, receiptRef) {
  if (!service.admissionOpen() || receipt.ref !== receiptRef || receipt.phase !== 'queued') return false;
  if (service.projectHolds.has(project.id) || service.held.has(worker.sessionId) || service.archiving.has(project.id)) return false;
  if (service.project(project.id).paused || worker.stopped || service.closing) return false;
  const requirement = receipt.source.requestId && service.requirements.rows(project.id).find(row => row.id === receipt.source.requestId);
  const version = requirement?.versions.find(item => item.revision === receipt.source.requestRevision);
  if (receipt.source.requestId && (!version || version.authorityError || !version.source)) return false;
  return !requirement || service.queue.acceptsWork(requirement, receipt.source.requestRevision, receipt.scope);
}

async function reserveLaunchSlot(service, project, id, receiptRef, recordWaiting) {
  let reserved = false, prerequisites = [], worker, receipt;
  await service.serial(async () => {
    const stream = service.stream(id); worker = service.worker(stream.workerSessionId); receipt = latest(stream);
    if (!canReserveLaunch(service, project, worker, receipt, receiptRef)) return;
    const task = service.projectTasks(service.ctx.agents.get(project.coordinatorSessionId)).find(candidate => candidate.id === id);
    const upstream = (stream.blockedBy ?? []).map(dependency => service.stream(dependency, project.id));
    const dependencies = upstream.filter(work => !service.acceptedWork(work) || !work.settlements.some(terminal => terminal.delegationRefs.includes(work.currentDelegationRef) && terminal.stopReason === 'completed'));
    if (dependencies.length) { await recordWaiting({ kind: 'dependencies', workTitles: dependencies.map(work => work.title) }); return; }
    if (!task || !task.ready && task.status !== 'in_progress') return;
    const occupied = service.directoryBlockers(worker, receipt.scope);
    if (occupied.length) {
      const hotspot = detectHotspotConflicts(service.state(), project, { workstreamId: stream.id, scope: receipt.scope, writePaths: receipt.writePaths, title: stream.title, brief: receipt.brief, blockedBy: stream.blockedBy });
      const workTitles = occupied.map(member => service.stream(member.workstreamId).title);
      await recordWaiting({ kind: 'directory', workTitles, ...(hotspot.conflicts.length ? { conflicts: hotspot.conflicts } : {}) });
      return;
    }
    prerequisites = upstream.map(work => ({ workstreamId: work.id, title: work.title, delegationRef: work.currentDelegationRef, report: latest(work).report ?? null }));
    await service.write(state => {
      const member = state.workers.find(item => item.sessionId === worker.sessionId); member.directoryHeld = !readOnly(receipt.scope); member.reservationRef = receipt.ref;
      const current = latest(state.workstreams.find(item => item.id === id)); current.phase = 'preparing'; delete current.waitingReason;
      current.dispatchedPrerequisites = prerequisites.map(({ workstreamId, title, delegationRef, report }) => ({ workstreamId, title, delegationRef, ...(report?.callId ? { reportId: report.callId } : {}) }));
    });
    reserved = true;
  });
  return { reserved, prerequisites, worker, receipt };
}

async function prepareWorkerEnvironment(service, project, id, worker) {
  for (const root of [project.storageRoot, project.canonicalWorkingDirectory]) {
    await checkedRoot(root);
    if (service.project(project.id).diagnostics.some(message => isDirectoryDiagnostic(message, root))) {
      await service.serial(() => service.write(state => { const row = state.projects.find(item => item.id === project.id); row.diagnostics = row.diagnostics.filter(message => !isDirectoryDiagnostic(message, root)); }));
    }
  }
  if (!worker.cwd) {
    const workspace = await service.desktop('prepare-workspace', { projectId: project.id, workstreamId: id, workingDirectory: worker.parentSessionId ? service.worker(worker.parentSessionId).cwd : project.canonicalWorkingDirectory, mode: worker.mode });
    const cwd = await checkedRoot(workspace.canonicalPath);
    await service.serial(() => service.write(state => { const member = state.workers.find(item => item.sessionId === worker.sessionId); member.cwd = cwd; member.workspace = copy(workspace); if (workspace.branch) member.branch = workspace.branch; }));
  } else {
    await service.desktop('check-workspace', { projectId: project.id, workstreamId: id, workspace: worker.workspace });
  }
}

async function buildWorkerBrief(service, project, stream, worker, receipt, prerequisites) {
  const internal = await safeProjectSubdirectory(service.home, project.id, 'internal', stream.id);
  const docs = await safeProjectSubdirectory(service.home, project.id, 'docs', stream.id);
  const previous = stream.delegations.slice(0, stream.delegations.findIndex(item => item.ref === receipt.ref)).findLast(item => item.report)?.report;
  const requirement = receipt.source.requestId && service.requirements.rows(project.id).find(row => row.id === receipt.source.requestId);
  const requirementVersion = requirement?.versions.find(version => version.revision === receipt.source.requestRevision);
  if (receipt.source.requestId && !requirementVersion) fail('request_missing', 'The accepted requirement version is missing; the assignment cannot be reconstructed.');
  if (requirementVersion?.authorityError || requirementVersion && !requirementVersion.source) fail('request_authority', 'The saved requirement needs a new actual user revision before execution.');
  const requirementBrief = requirementVersion ? `Requirement context (the accepted whole goal; execute only the current assigned stage):\n${JSON.stringify({ requestId: requirement.id, requestRevision: requirementVersion.revision, goal: requirementVersion.goal, constraints: requirementVersion.constraints, conditions: requirementVersion.conditions, scopeCeiling: requirementVersion.scope, writePaths: requirementVersion.writePaths, sourceMessageIds: requirementVersion.source.messageIds ?? [requirementVersion.source.messageId], ...(stream.replaces ? { replaces: stream.replaces } : {}) })}\n\n` : '';
  return `${stream.delegations.length > 1 ? 'Continue the same work and original Session. Preserve correct previous work; implement only the current changes.' : 'First assignment for this continuing work.'}\nProject ${project.title}\nTeam: ${project.coordinatorSessionId}\nWorkstream ${stream.id}: ${stream.title}\nDelegationRef: ${receipt.ref}\nWorking directory: ${worker.cwd}\nBranch: ${worker.branch || 'not applicable; selected project directory'}\n${process.platform === 'win32' ? 'Windows Git: use git -c core.longpaths=true for commands in this directory. Do not persist this setting. A Filename too long error does not prove deletion or a clean directory.\n' : ''}Scope: ${receipt.scope}; exact repository write paths: ${JSON.stringify(receipt.writePaths)}\nProject deliverables: ${docs}\nPrivate work notes: ${internal}\nActual user source (${receipt.source.messageId}):\n${receipt.source.text}\n\n${requirementBrief}Current assignment and completion criteria:\n${receipt.brief}\n\n${service.charterFor(project.coordinatorSessionId)}${service.preferencesFor(project.coordinatorSessionId)}\n${previous ? `Previous recorded result (historical, not proof of this request):\n${JSON.stringify(previous)}\n` : ''}${prerequisites.length ? `Prerequisite results:\n${JSON.stringify(prerequisites)}\n` : ''}Use the actual user's language. Use project_report for this delegationRef with real artifacts, verification and remaining issues, then finish. Do not send a duplicate completion message.`;
}

async function deliverOrStartWorker(service, project, stream, worker, receipt, brief, signal) {
  const parent = worker.parentSessionId ? service.ctx.agents.get(worker.parentSessionId) : await service.coordinator(project);
  const saved = await service.ctx.sessionPersistence.stat(worker.sessionId);
  if (!parent) fail('parent_unavailable', 'The original delegating member must be resident before its nested work can start.');
  if (worker.materialized && !saved) fail('session_missing', 'The original worker Session is missing; no replacement is created.');
  const targetPreset = presetForScope(receipt.scope);
  if (saved) {
    const live = service.ctx.agents.get(worker.sessionId);
    if (live && service.ctx.agentPresets?.composedPreset?.(live.ctx) !== targetPreset && typeof service.ctx.agentPresets?.mount === 'function') {
      await service.ctx.agentPresets.mount(live.ctx, targetPreset);
    }
    const messageId = await service.ctx.subagents[deliverSubagentPrompt](parent, worker.sessionId, [{ type: 'text', text: brief }], { kind: 'agent-message', form: 'relay', senderSessionId: parent.id }, signal, 'steer');
    return { messageId, targetPreset };
  }
  const provider = receipt.provider ?? 'spawn';
  // Fork inherits its parent's preset and KV cache; never force agentPreset on fork.
  const environment = { cwd: worker.cwd, ...(provider === 'fork' ? {} : { agentPreset: targetPreset }), admissionPolicy: policy };
  const started = await service.ctx.subagents.startActivation({
    provider, parent, childId: worker.sessionId,
    ...(receipt.nativeName ? { name: receipt.nativeName } : {}),
    ...(receipt.nativeOptions?.agentOptions ? { agentOptions: receipt.nativeOptions.agentOptions } : {}),
    ...(receipt.nativeOptions?.maxDepth !== undefined ? { maxDepth: receipt.nativeOptions.maxDepth } : {}),
    label: stream.title.slice(0, 200), prompt: [{ type: 'text', text: brief }], environment, signal, delivery: 'parent',
  });
  return { messageId: started.messageId, targetPreset };
}

async function handleLaunchError(service, project, id, worker, receipt, error) {
  if (service.closing && !service.persistOnDispose) throw error;
  if (!service.admissionOpen() || ['ACTIVATION_LIMIT_REACHED', 'TEAM_TASK_LIMIT', 'TEAM_TASK_BLOCKED'].includes(error.code)) {
    await service.serial(async () => {
      const currentWork = service.stream(id), root = service.ctx.agents.get(project.coordinatorSessionId);
      const dependencies = error.code === 'TEAM_TASK_BLOCKED' ? (currentWork.blockedBy ?? []).map(dependency => service.stream(dependency, project.id)).filter(work =>
        !service.acceptedWork(work) || service.workTask(root, work.id)?.status !== 'completed' || !work.settlements.some(terminal => terminal.delegationRefs.includes(work.currentDelegationRef) && terminal.stopReason === 'completed')) : [];
      await service.write(state => {
        const work = state.workstreams.find(item => item.id === id), member = state.workers.find(item => item.sessionId === worker.sessionId), waiting = work.delegations.find(item => item.ref === receipt.ref);
        if (waiting.phase === 'stopped' || member.stopped || work.currentDelegationRef !== receipt.ref) return;
        waiting.phase = 'queued'; waiting.error = '';
        waiting.waitingReason = !service.admissionOpen() ? { kind: 'capacity', workTitles: [], code: 'ADMISSION_LOCKED' }
          : error.code === 'TEAM_TASK_BLOCKED' ? { kind: 'dependencies', workTitles: dependencies.map(work => work.title) } : { kind: 'capacity', workTitles: [], code: error.code };
        member.reservationRef = ''; member.directoryHeld = Boolean(member.activeRunId || service.jobs(member.sessionId).length || service.ctx.agents.get(member.sessionId)?.status === 'running');
        member.phase = member.materialized ? 'idle' : 'provisioning'; member.error = '';
        work.status = 'open'; work.blockedReason = ''; work.updatedAt = Date.now();
      });
      await service.notes(project.id);
    });
    return;
  }
  await service.serial(async () => {
    await service.write(state => {
      const work = state.workstreams.find(item => item.id === id), member = state.workers.find(item => item.sessionId === worker.sessionId), failed = work.delegations.find(item => item.ref === receipt.ref);
      if (failed.phase !== 'stopped') failed.phase = 'failed'; failed.error = error.message; member.phase = 'failed'; member.error = error.message;
      member.directoryHeld = Boolean(member.activeRunId) || service.ctx.agents.get(member.sessionId)?.status === 'running' || service.jobs(member.sessionId).length > 0;
      if (!member.directoryHeld && member.reservationRef === receipt.ref) member.reservationRef = '';
      work.status = 'blocked'; work.blockedReason = error.message; work.updatedAt = Date.now();
    });
    await service.coldFailedLaunch(service.stream(id));
    await service.notes(project.id);
  });
  const classified = classifyExecutionError(error);
  await workOps.recordFailureAndEscalate(service, id, { reason: error.message, category: classified.category, retryRequired: classified.retryRequired })
    .catch(err => service.ctx.logger?.warn?.('Failure escalation skipped: %s', err.message));
  throw error;
}

export async function doLaunch(service, id, signal) {
  if (!service.admissionOpen()) return;
  const initialStream = service.stream(id), initialWorker = service.worker(initialStream.workerSessionId), initialReceipt = latest(initialStream);
  const project = service.project(initialStream.projectId);
  const recordWaiting = async reason => {
    const current = latest(service.stream(id));
    if (current.ref !== initialReceipt.ref || current.phase !== 'queued' || service.worker(initialWorker.sessionId).stopped || service.held.has(initialWorker.sessionId)) return;
    if (JSON.stringify(current.waitingReason) === JSON.stringify(reason)) return;
    await service.write(state => { const work = state.workstreams.find(item => item.id === id); latest(work).waitingReason = reason; work.updatedAt = Date.now(); });
  };
  try { await service.ensureTask(initialStream); }
  catch (error) { if (['TEAM_MEMBER_LIMIT', 'TEAM_TASK_LIMIT'].includes(error.code)) { await service.serial(() => recordWaiting({ kind: 'capacity', workTitles: [], code: error.code })); return; } throw error; }
  const { reserved, prerequisites, worker: reservedWorker, receipt } = await reserveLaunchSlot(service, project, id, initialReceipt.ref, recordWaiting);
  if (!reserved) return;
  try {
    await prepareWorkerEnvironment(service, project, id, reservedWorker);
    const worker = service.worker(reservedWorker.sessionId), stream = service.stream(id);
    if (!service.admissionOpen()) {
      await service.serial(() => service.write(state => {
        const work = state.workstreams.find(item => item.id === id), member = state.workers.find(item => item.sessionId === worker.sessionId), waiting = work.delegations.find(item => item.ref === receipt.ref);
        if (waiting.phase === 'preparing') waiting.phase = 'queued';
        member.reservationRef = ''; member.directoryHeld = false;
      }));
      return;
    }
    if (worker.stopped || service.held.has(worker.sessionId) || service.project(project.id).paused || receipt.source.requestId && !service.queue.acceptsWork(service.requirements.get(project.id, receipt.source.requestId), receipt.source.requestRevision, receipt.scope)) return;
    if (prerequisites.some(basis => { const current = service.stream(basis.workstreamId); return current.currentDelegationRef !== basis.delegationRef || !service.acceptedWork(current); })) fail('TEAM_TASK_BLOCKED', 'Prerequisite evidence changed during preparation.');
    if (!readOnly(receipt.scope) && receipt.source.requestId) await service.captureBaseline(project.id, receipt.source.requestId, worker);
    const brief = await buildWorkerBrief(service, project, stream, worker, receipt, prerequisites);
    const { messageId, targetPreset } = await deliverOrStartWorker(service, project, stream, worker, receipt, brief, signal);
    await service.assignTask(service.stream(id), worker);
    await service.completeTask(service.stream(id));
    await service.serial(async () => {
      await service.write(state => {
        const work = state.workstreams.find(item => item.id === id), member = state.workers.find(item => item.sessionId === worker.sessionId), accepted = work.delegations.find(item => item.ref === receipt.ref);
        accepted.messageId = messageId; accepted.phase = member.stopped ? 'stopped' : 'accepted'; member.materialized = true;
        if (receipt.provider !== 'fork') member.preset = targetPreset;
        if (!member.stopped && !work.settlements.some(terminal => terminal.delegationRefs.includes(receipt.ref))) { member.phase = 'active'; work.status = 'running'; work.blockedReason = ''; }
        member.updatedAt = work.updatedAt = Date.now();
      });
      await service.notes(project.id);
    });
  } catch (error) {
    await handleLaunchError(service, project, id, reservedWorker, receipt, error);
  }
}

async function recoverProject(service, project) {
  try {
    if (project.lifecycle === 'creating') { await service.finishCreation(project); return; }
    let directoryFailed = false;
    for (const root of [project.storageRoot, project.canonicalWorkingDirectory]) {
      let failure;
      try { await checkedRoot(root); } catch (error) { failure = error; directoryFailed = true; }
      const diagnostics = service.project(project.id).diagnostics;
      if (failure || diagnostics.some(message => isDirectoryDiagnostic(message, root))) {
        await service.write(state => {
          const row = state.projects.find(item => item.id === project.id);
          row.diagnostics = row.diagnostics.filter(message => !isDirectoryDiagnostic(message, root));
          if (failure) { row.diagnostics.push(`${directoryDiagnosticPrefix(root)}${failure.message}`); row.paused = true; }
        });
      }
    }
    if (!directoryFailed) {
      await service.ctx.sessionController.inspect(project.coordinatorSessionId);
      if (service.project(project.id).diagnostics.length) await service.write(state => { state.projects.find(item => item.id === project.id).diagnostics = []; });
    }
  } catch (error) {
    await service.write(state => { const row = state.projects.find(item => item.id === project.id); if (!row.diagnostics.includes(error.message)) row.diagnostics.push(error.message); row.paused = true; });
  }
}

async function recoverWorker(service, worker) {
  try {
    const saved = await service.ctx.sessionPersistence.stat(worker.sessionId);
    if (!saved) { if (worker.materialized) throw new Error('The original worker Session is missing.'); return; }
    const inspection = await service.ctx.sessionController.inspect(worker.sessionId), project = service.project(worker.projectId);
    if (inspection.meta.parentSession !== (worker.parentSessionId ?? project.coordinatorSessionId) || inspection.meta.origin !== 'subagent'
      || !samePath(inspection.meta.cwd, worker.cwd) || !ALL_WORKER_PRESETS.has(inspection.meta.agentPreset)) {
      throw new Error('The original worker Session identity, role or cwd does not match its Project.');
    }
    await service.write(state => {
      const member = state.workers.find(item => item.sessionId === worker.sessionId), work = state.workstreams.find(item => item.id === worker.workstreamId); member.materialized = true;
      for (const receipt of work.delegations) {
        const input = inspection.events.find(event => event.type === 'user/message' && ['user', 'agent-message', 'team-message'].includes(event.data.source.kind) && content(event.data).includes(`DelegationRef: ${receipt.ref}`));
        if (!input) continue; receipt.messageId ||= input.data.id;
        if (['preparing', 'queued'].includes(receipt.phase)) receipt.phase = 'accepted';
        if (receipt.ref === work.currentDelegationRef && receipt.report && !work.settlements.some(terminal => terminal.delegationRefs.includes(receipt.ref))) {
          work.latestReport = receipt.report; work.status = 'blocked'; work.blockedReason = 'Worker report exists, but native settlement was not durably recorded.';
          work.pendingSummary ||= !receipt.report.summarizedBy;
        }
      }
    });
  } catch (error) {
    await service.write(state => { const member = state.workers.find(item => item.sessionId === worker.sessionId); member.error = error.message; member.phase = 'failed'; const work = state.workstreams.find(item => item.id === worker.workstreamId); work.status = 'blocked'; work.blockedReason = error.message; });
  }
}

export async function recoverAll(service) {
  for (const project of service.state().projects) await recoverProject(service, project);
  for (const worker of service.state().workers) await recoverWorker(service, worker);
  await service.write(state => {
    for (const project of state.projects) project.paused = true;
    for (const request of state.requests ?? []) if (['active', 'queued'].includes(service.queue.state(request)) && service.queue.unfinished(request)) { request.queue = { ...request.queue, state: service.queue.state(request), suspended: true }; delete request.queue.activation; }
    for (const worker of state.workers) {
      worker.directoryHeld = false; worker.activeRunId = ''; worker.reservationRef = '';
      if (['active', 'provisioning', 'stopping'].includes(worker.phase)) worker.phase = worker.materialized ? 'idle' : 'failed';
      worker.stopped = true;
      const work = state.workstreams.find(item => item.id === worker.workstreamId);
      for (const receipt of work.delegations.filter(item => item.phase === 'preparing')) { receipt.phase = 'failed'; receipt.error = 'Application interrupted; inbox acceptance could not be confirmed.'; }
      if (work.status !== 'done') { work.status = 'blocked'; work.blockedReason = 'Application restarted; waiting for explicit continuation.'; }
    }
  });
  for (const project of service.state().projects) if (!project.diagnostics.length) {
    try {
      const root = await service.coordinator(project); await service.teams.setEnabled(root, true);
      for (const work of service.state().workstreams.filter(item => item.projectId === project.id)) {
        if (work.archivedNativeTaskId && !work.nativeTaskId) continue;
        if (!work.nativeTaskId && !service.worker(work.workerSessionId).materialized && latest(work).phase === 'queued') continue;
        await service.ensureTask(work); await service.completeTask(work);
      }
      await service.requirements.reconcile(project); await service.notes(project.id);
    } catch (error) { await service.write(state => { state.projects.find(item => item.id === project.id).diagnostics = [error.message]; }); }
  }
  service.recovering = false;
}

export async function archiveProject(service, project) {
  service.archiving.add(project.id);
  try {
    const lead = service.ctx.agents.get(project.coordinatorSessionId); lead?.cancel({ kind: 'user' });
    await service.stop(project.id); await lead?.whenIdle();
    await Promise.all(service.state().workers.filter(item => item.projectId === project.id).map(item => service.stops.get(item.sessionId)));
    if (service.state().workers.some(item => item.projectId === project.id && item.phase === 'stopping')) fail('stopping', 'Background activity has not stopped.');
    await workOps.releaseHistoricalNativeTasks(service, project.id, { forceAll: true });
    await changesOps.releaseProjectSnapshots(service, project.id);
    await changesOps.cleanupProjectWorktrees(service, project.id);
    await service.serial(async () => { await service.write(state => { state.projects.find(item => item.id === project.id).lifecycle = 'archived'; }); await service.notes(project.id); });
    return { project: copy(service.project(project.id)) };
  } finally { service.archiving.delete(project.id); }
}

export async function cleanupProject(service, project) {
  const releasedTasks = await workOps.releaseHistoricalNativeTasks(service, project.id);
  const releasedSnapshots = await changesOps.releaseProjectSnapshots(service, project.id, { onlyArchived: true });
  const cleanedWorktrees = await changesOps.cleanupProjectWorktrees(service, project.id, { onlyArchived: true });
  await service.serial(() => service.notes(project.id));
  return { projectId: project.id, releasedTasks, releasedSnapshots, cleanedWorktrees };
}

export async function resetProject(service, project) {
  const lead = service.ctx.agents.get(project.coordinatorSessionId); lead?.cancel({ kind: 'user' });
  await service.stop(project.id); await lead?.whenIdle();
  await Promise.all(service.state().workers.filter(item => item.projectId === project.id).map(item => service.stops.get(item.sessionId)));
  if (service.state().workers.some(item => item.projectId === project.id && item.phase === 'stopping')) fail('stopping', 'Background activity has not stopped.');
  const releasedTasks = await workOps.releaseHistoricalNativeTasks(service, project.id, { forceAll: true });
  const releasedSnapshots = await changesOps.releaseProjectSnapshots(service, project.id);
  const cleanedWorktrees = await changesOps.cleanupProjectWorktrees(service, project.id);
  await service.serial(async () => {
    const now = Date.now();
    await service.write(state => {
      for (const work of state.workstreams) if (work.projectId === project.id) { work.archived = true; work.pendingSummary = false; delete work.summaryFailure; work.updatedAt = now; }
      for (const row of state.requests ?? []) if (row.projectId === project.id && !row.archivedAt) {
        if (service.requirements.handover(row).completed) row.archivedAt = now;
        else { row.queue = { state: 'cancelled' }; delete row.ask; }
        row.updatedAt = now;
      }
      const entry = state.projects.find(item => item.id === project.id); entry.paused = false; entry.holdSourceMessageId = ''; entry.diagnostics = []; entry.updatedAt = now;
    });
    service.projectHolds.delete(project.id);
    await service.notes(project.id);
  });
  return { project: copy(service.project(project.id)), releasedTasks, releasedSnapshots, cleanedWorktrees };
}
