/** Runtime input allowlist, tool guard, research host policy and targeted ask clearing. */
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { safeReadStoreFileSync, samePath, within } from './files.js';
import { queuePlugin } from './queue.js';

const copy = value => JSON.parse(JSON.stringify(value));
const content = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const latest = stream => stream.delegations.find(item => item.ref === stream.currentDelegationRef);
const readOnly = scope => scope === 'readonly' || scope === 'research';
const webTools = new Set(['web_search', 'web_fetch']);

const COORDINATOR_TOOLS = new Set([
  'project_review', 'project_request', 'project_queue', 'project_ask', 'project_standby', 'project_deliver',
  'project_delegate', 'project_read_store', 'project_stop', 'subagent', 'team_task_create', 'team_task_get',
  'team_task_update', 'project_read', 'project_search', 'list_agents', 'team_task_list', 'send_message',
  'html_preview', 'html_render', 'todo_write',
]);
const WORKER_SAFE_TOOLS = new Set([
  'wait_agent', 'subagent', 'subagent_fork', 'team_task_create', 'team_task_get', 'team_task_update',
  'project_read_store', 'project_read', 'project_search', 'glob', 'grep', 'project_report',
  'project_write_artifact', 'project_write_document', 'list_agents', 'team_task_list', 'send_message',
]);

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function optionMatchesUser(option, normalizedUser, userLines) {
  const optionText = normalizeText(option);
  if (optionText.length < 2) return false;
  return normalizedUser === optionText || userLines.some(line => line === optionText);
}

/** Clear only the matching pending ask(s) when multiple parallel requirements have unanswered questions. */
export function clearMatchedAsks(state, projectId, userText) {
  const asking = (state.requests ?? []).filter(row => row.projectId === projectId && row.ask);
  if (!asking.length) return;
  if (asking.length === 1) { delete asking[0].ask; return; }
  const normalized = normalizeText(userText);
  if (!normalized) return;
  const userLines = String(userText ?? '').split(/\r?\n/).map(normalizeText);
  const firstLine = userLines[0] ?? '';
  for (const row of asking) {
    const q = normalizeText(row.ask.question);
    const title = normalizeText(row.title);
    const matchesQuestion = Boolean(q) && (normalized.includes(q) || firstLine === q);
    const matchesMeta = (title.length >= 4 && normalized.includes(title)) || normalized.includes(row.id.toLowerCase());
    const matchesOption = (row.ask.options ?? []).some(opt => optionMatchesUser(opt, normalized, userLines));
    if (matchesQuestion || matchesMeta || matchesOption) delete row.ask;
  }
}

function checkScopedSearchPath(worker, exec) {
  const raw = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments.path : undefined;
  if (raw === undefined || raw === null || raw === '') return;
  if (typeof raw !== 'string') return 'Search path must be a string inside the assigned directory.';
  if (raw.split(/[\\/]+/).some(part => part.toLowerCase() === '.git')) return 'Searching inside .git metadata is not permitted.';
  if (!worker.cwd) return 'Worker working directory is not prepared.';
  let realRoot;
  try { realRoot = realpathSync(resolve(worker.cwd)); } catch { return 'Worker working directory is unavailable.'; }
  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(realRoot, raw);
  if (!within(realRoot, candidate)) return 'Search path escapes the assigned working directory.';
  let node = candidate;
  for (;;) {
    try {
      const actual = realpathSync(node);
      if (!within(realRoot, actual) || relative(realRoot, actual).split(/[\\/]+/).some(part => part.toLowerCase() === '.git')) {
        return 'Search path resolves outside the assigned working directory.';
      }
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') return 'Search path could not be verified.';
      const parent = dirname(node);
      if (samePath(parent, node)) return 'Search path could not be verified.';
      node = parent;
    }
  }
}

/** Strict allowlist for Worker pre-step messages: blocks plugin, dsh-whale:* and unauthorized external sources. */
export function validTeamInputs(service, root, worker, messages) {
  const directParent = worker.parentSessionId ?? root.id;
  const receipt = latest(service.stream(worker.workstreamId));
  return messages.every(message => {
    const kind = message.source?.kind;
    if (kind === 'user') return true;
    if (kind === 'agent-message') {
      if (receipt?.report) return false;
      if (message.source.senderSessionId === directParent) return true;
      const peer = service.state().workers.find(row => row.sessionId === message.source.senderSessionId && row.projectId === worker.projectId);
      return Boolean(peer && !peer.stopped && !service.held.has(peer.sessionId));
    }
    if (kind === 'subagent-settled') {
      return service.state().workers.some(child => child.projectId === worker.projectId && child.sessionId === message.source.senderSessionId && child.parentSessionId === worker.sessionId);
    }
    return false;
  });
}

async function preStepCoordinator(service, project, input, next) {
  const accepted = input.messages.filter(message => message.source.kind === queuePlugin ? service.queue.validNotice(project.id, message) : message.source.kind !== 'team-message');
  if (accepted.length !== input.messages.length) {
    if (!accepted.some(message => ['user', 'subagent-settled'].includes(message.source.kind) || message.source.kind === queuePlugin)) return { kind: 'reject' };
    const originalNext = next, allowed = new Set(accepted.map(message => message.id));
    next = async () => { const decision = await originalNext(); return decision.kind === 'enter' ? { ...decision, messages: decision.messages.filter(message => allowed.has(message.id)) } : decision; };
    input = { ...input, messages: accepted };
  }
  const notices = new Map();
  const actualUser = input.messages.findLast(item => item.source.kind === 'user');
  if (actualUser) {
    service.userTurns.set(input.agent.id, { agent: input.agent, turn: input.turn });
    service.cancelSummaryRetry(project.id);
    if (service.projectHolds.get(project.id) !== actualUser.id) service.projectHolds.delete(project.id);
    const userText = content(actualUser);
    await service.serial(() => service.write(state => {
      state.projects.find(item => item.id === project.id).updatedAt = Date.now();
      clearMatchedAsks(state, project.id, userText);
    }));
  }
  for (const message of input.messages.filter(item => item.source.kind === 'subagent-settled')) {
    await collectSettlementNotice(service, project, message, notices);
  }
  const human = service.userTurns.get(input.agent.id);
  const pausedWithoutHuman = service.project(project.id).paused && (human?.agent !== input.agent || human.turn !== input.turn);
  if (service.projectHolds.has(project.id) || service.archiving.has(project.id) || project.lifecycle !== 'ready' || pausedWithoutHuman) return { kind: 'reject' };
  const decision = await next();
  if (decision.kind !== 'enter' || !notices.size) return decision;
  return attachSettlementFacts(service, input, decision, notices);
}

async function collectSettlementNotice(service, project, message, notices) {
  const barrier = service.terminals.get(message.source.runId);
  if (barrier) { const result = await barrier.promise; if (result?.error) throw result.error; }
  await service.serial(() => service.write(state => {
    const work = state.workstreams.find(item => item.projectId === project.id && item.workerSessionId === message.source.senderSessionId);
    const terminal = work?.settlements.find(item => item.runId === message.source.runId);
    if (terminal) terminal.noticeMessageId = message.id;
  }));
  const work = service.state().workstreams.find(item => item.projectId === project.id && item.workerSessionId === message.source.senderSessionId);
  const terminal = work?.settlements.find(item => item.runId === message.source.runId);
  if (!terminal) return;
  const reports = work.delegations.filter(receipt => terminal.delegationRefs.includes(receipt.ref) && receipt.runId === terminal.runId && receipt.report).map(receipt => copy(receipt.report));
  notices.set(message.id, {
    workstreamId: work.id, title: work.title, workerSessionId: work.workerSessionId, runId: terminal.runId, stopReason: terminal.stopReason,
    request: service.requirements.associated(work, work.delegations.findLast(receipt => terminal.delegationRefs.includes(receipt.ref))),
    currentDelegationRef: work.currentDelegationRef, currentStatus: work.status,
    isCurrentDelegation: terminal.delegationRefs.includes(work.currentDelegationRef), reports,
  });
}

function attachSettlementFacts(service, input, decision, notices) {
  const consumed = [];
  const messages = decision.messages.map(message => {
    const facts = notices.get(message.id);
    if (!facts || message.source.kind !== 'subagent-settled') return message;
    consumed.push({ id: facts.workstreamId, runs: [facts.runId], reports: facts.reports.map(report => report.delegationRef) });
    return {
      ...message,
      content: [...message.content, {
        type: 'text',
        text: `Project recorded outcome for this native settlement (worker report, not independent verification):\n${JSON.stringify(facts)}\nThese facts refer only to the stated run and delegations. An older run does not complete a newer request or authorize new work.`,
      }],
    };
  });
  service.consume(input.agent.id, input.turn, consumed);
  return { ...decision, messages };
}

function isInvalidWorkerUserMessage(message, receipt) {
  if (message.source.kind !== 'user') return false;
  if (message.source.rpcId || !content(message).includes(`DelegationRef: ${receipt.ref}`)) return true;
  return receipt.messageId ? receipt.messageId !== message.id : receipt.phase !== 'preparing';
}

async function preStepWorker(service, worker, input, next) {
  if (service.closing || service.recovering || service.projectHolds.has(worker.projectId) || service.held.has(worker.sessionId) || worker.stopped || service.project(worker.projectId).paused) return { kind: 'reject' };
  const root = service.ctx.agents.get(service.project(worker.projectId).coordinatorSessionId);
  if (!root || !validTeamInputs(service, root, worker, input.messages)) return { kind: 'reject' };
  const stream = service.stream(worker.workstreamId), receipt = latest(stream);
  if (input.messages.some(message => isInvalidWorkerUserMessage(message, receipt))) return { kind: 'reject' };
  if (input.messages.some(message => message.source.kind === 'agent-message') && receipt.report) return { kind: 'reject' };
  const consumesAssignment = input.messages.some(message => content(message).includes(`DelegationRef: ${receipt.ref}`));
  const resumesAssignment = worker.consumedDelegationRef === receipt.ref && !receipt.report && input.messages.some(message => ['agent-message', 'subagent-settled'].includes(message.source.kind));
  if (input.messages.some(message => ['agent-message', 'user', 'subagent-settled'].includes(message.source.kind)) && !consumesAssignment && !resumesAssignment) return { kind: 'reject' };
  if (consumesAssignment || resumesAssignment) {
    await service.serial(() => service.write(state => {
      const member = state.workers.find(item => item.sessionId === worker.sessionId);
      member.role = receipt.scope; member.writePaths = receipt.writePaths; member.consumedDelegationRef = receipt.ref;
      const consumed = state.workstreams.find(item => item.id === stream.id).delegations.find(item => item.ref === receipt.ref);
      consumed.runId = member.activeRunId;
      if (consumesAssignment && consumed.dispatchedPrerequisites !== undefined && consumed.prerequisites === undefined) consumed.prerequisites = copy(consumed.dispatchedPrerequisites);
      delete consumed.waitingReason;
    }));
  }
  service.approvals.bind(input.agent);
  return next();
}

export async function handlePreStep(service, input, next) {
  if (service.closing) return { kind: 'reject' };
  const project = service.state().projects.find(item => item.coordinatorSessionId === input.agent.id);
  if (project) return preStepCoordinator(service, project, input, next);
  const worker = service.state().workers.find(item => item.sessionId === input.agent.id);
  if (worker) return preStepWorker(service, worker, input, next);
  return next();
}

function resolveSendTargetWorker(service, projectId, agentName) {
  if (typeof agentName !== 'string' || !agentName.trim()) return undefined;
  const wanted = agentName.trim();
  const workers = service.state().workers.filter(item => item.projectId === projectId);
  const direct = workers.find(item => item.sessionId === wanted);
  if (direct) return direct;
  for (const candidate of workers) {
    const live = service.ctx.agents.get(candidate.sessionId);
    if (live && typeof service.ctx.subagents?.namesOf === 'function') {
      try {
        const names = service.ctx.subagents.namesOf(live);
        if (names?.self === wanted || names?.self?.endsWith(`/${wanted}`)) return candidate;
      } catch { /* Unregistered or disposed live agent has no resolvable subagent alias. */ }
    }
    const work = service.state().workstreams.find(item => item.id === candidate.workstreamId);
    if (work && latest(work)?.nativeName === wanted) return candidate;
  }
  return undefined;
}

function guardSharedCollaboration(service, projectId, exec) {
  if (exec.name === 'team_task_update' && ['delete', 'complete'].includes(exec.arguments?.action)) {
    return 'Project owns native task completion and archival; use project_review, project_deliver or project_stop instead of deleting or completing native tasks directly.';
  }
  if (exec.name === 'send_message') {
    const target = resolveSendTargetWorker(service, projectId, exec.arguments?.agent);
    if (target) {
      const targetWork = service.state().workstreams.find(item => item.id === target.workstreamId);
      if (target.stopped || Boolean(targetWork && latest(targetWork)?.report)) {
        return 'This member has already reported or stopped; start a new assignment through project_delegate instead of send_message.';
      }
    }
  }
}

function guardWorkerCapabilities(service, worker, exec) {
  const busyChild = service.descendants(worker.sessionId).some(child => service.queue.workerBusy(child));
  if (['project_write_document', 'project_write_artifact'].includes(exec.name) && busyChild) return 'Finish delegated work before writing its shared resources.';
  if (!WORKER_SAFE_TOOLS.has(exec.name) && busyChild) return 'Delegated work is using this assignment’s resources. Coordinate or inspect its result before writing.';
  const web = webTools.has(exec.name);
  if (web && worker.role !== 'worker' && worker.role !== 'research') return 'Web access needs a research assignment.';
  if (worker.role !== 'worker' && !WORKER_SAFE_TOOLS.has(exec.name) && !web) return 'This assignment has no shell or unrestricted repository write capability.';
  if (worker.role !== 'worker' && (exec.name === 'glob' || exec.name === 'grep')) return checkScopedSearchPath(worker, exec);
  if (readOnly(worker.role) && exec.name === 'project_write_document') return 'This repository is read-only for the assignment.';
  if (web) return service.researchCall(worker, exec);
}

export function guardToolExecution(service, exec) {
  if (service.closing) return 'Project is unloading.';
  const coordinator = service.state().projects.find(item => item.coordinatorSessionId === exec.agent?.id);
  if (coordinator) {
    if (!COORDINATOR_TOOLS.has(exec.name)) return 'The Project coordinator may only organize requirements, keep its plan, read materials, visualize results, delegate, deliver or stop work.';
    return guardSharedCollaboration(service, coordinator.id, exec);
  }
  const worker = service.state().workers.find(item => item.sessionId === exec.agent?.id);
  if (!worker) return;
  if (service.ctx.agents.get(worker.sessionId) !== exec.agent) return 'Project tools require the exact live worker.';
  if (service.closing || service.held.has(worker.sessionId) || worker.stopped || service.project(worker.projectId).paused) return 'This Project worker is stopped.';
  const stream = service.stream(worker.workstreamId), receipt = latest(stream);
  if (receipt.source.requestId) {
    const row = service.requirements.get(worker.projectId, receipt.source.requestId);
    if (service.queue.state(row) === 'cancelled') return 'This requirement is cancelled.';
    if (!service.queue.acceptsWork(row, receipt.source.requestRevision, readOnly(worker.role) ? 'readonly' : worker.role)) return 'This requirement is suspended or its authorization has changed.';
  }
  if (!worker.consumedDelegationRef || worker.consumedDelegationRef !== receipt.ref) return 'The current Project assignment has not been consumed.';
  if (receipt.report) return 'This Project worker has already reported its current assignment.';
  if (!worker.activeRunId) return 'This Project worker has no active run.';
  const shared = guardSharedCollaboration(service, worker.projectId, exec);
  if (shared) return shared;
  return guardWorkerCapabilities(service, worker, exec);
}

export function researchHosts(project) {
  const raw = safeReadStoreFileSync(project.storageRoot, 'research-hosts.txt', 16384);
  if (raw === null) return [];
  return raw.split(/\r?\n/).map(line => line.replace(/#.*/, '').trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean).slice(0, 200);
}

export function researchCall(service, worker, exec) {
  const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}, fetching = exec.name === 'web_fetch';
  if (fetching) {
    let allowed;
    try { allowed = service.researchHosts(service.project(worker.projectId)); }
    catch (error) { return `The Project research sites list could not be read (${error.code || error.message}). Repair research-hosts.txt before fetching a page.`; }
    if (allowed.length) {
      let host; try { host = new URL(String(args.url)).hostname.toLowerCase(); } catch { return 'Give a complete http or https URL.'; }
      if (!allowed.some(entry => host === entry || host.endsWith(`.${entry}`))) return `This Project lets research read only these sites: ${allowed.join(', ')}.`;
    }
  }
  const entries = (fetching ? [args.url] : Array.isArray(args.queries) ? args.queries.slice(0, 8) : []).filter(item => typeof item === 'string' && item.trim()).map(item => ({ kind: fetching ? 'fetch' : 'search', text: item.trim().slice(0, fetching ? 500 : 300) }));
  if (entries.length) {
    void service.serial(() => service.write(state => {
      const work = state.workstreams.find(item => item.id === worker.workstreamId), receipt = work?.delegations.find(item => item.ref === worker.consumedDelegationRef);
      if (!receipt) return;
      receipt.sources ??= [];
      for (const entry of entries) if (receipt.sources.length < 100 && !receipt.sources.some(item => item.kind === entry.kind && item.text === entry.text)) receipt.sources.push({ ...entry, at: Date.now() });
    })).catch(error => service.ctx.logger.warn('Project could not record a research source: %s', error.message));
  }
}
