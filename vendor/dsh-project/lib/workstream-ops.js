/** Workstream read models, Project store access, native task-slot reclamation and orphan sweeps. */
import fs from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { atomicText, checkedRoot, safeProjectSubdirectory, safeReadStoreFileSync, samePath, within } from './files.js';

const copy = value => JSON.parse(JSON.stringify(value));
const latest = work => work.delegations.find(item => item.ref === work.currentDelegationRef) ?? work.delegations.at(-1);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export const NOTES_MARKER = '<!-- whale-project:user-notes -->';
export const CHARTER_LIMIT = 16000;
const PREFERENCES_LIMIT = 256000;
const DECISION_LIMIT = 4000;
const NOTES_GENERATED_LIMIT = 256000 - Buffer.byteLength(NOTES_MARKER) - 2;
export const CONSECUTIVE_FAILURE_LIMIT = 3;
const PREPARING_ORPHAN_MS = 10 * 60_000;

export function boundedNotesGenerated(text) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= NOTES_GENERATED_LIMIT) return text;
  const notice = '\nGenerated summary truncated. Read individual work results with project_read_store.\n\n';
  let end = NOTES_GENERATED_LIMIT - Buffer.byteLength(notice);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8') + notice;
}

function hasPriorReferenceFailure(work, delegation, worker, references) {
  if (worker?.stopped) return false;
  return references.some(reference => {
    if (reference.delegationRef === delegation.ref) return false;
    const receipt = work.delegations.find(item => item.ref === reference.delegationRef);
    const terminal = work.settlements.find(item => item.runId === reference.runId && item.delegationRefs.includes(reference.delegationRef));
    return receipt.phase === 'failed' || Boolean(terminal && (terminal.stopReason !== 'completed' || !receipt.report || receipt.report.outcome !== 'completed'));
  });
}

function isWorkBlockedOrFailed(work, worker) {
  if (work.summaryFailure?.delegationRef === work.currentDelegationRef) return true;
  return !worker?.stopped && (work.status === 'blocked' || worker?.phase === 'failed');
}

function workRowRank(project, work, worker, jobs, delegation, pendingRequest, priorFailure) {
  if (priorFailure || (pendingRequest && isWorkBlockedOrFailed(work, worker))) return 0;
  if (worker && (worker.activeRunId || jobs.length || worker.phase === 'stopping')) return 1;
  if (pendingRequest && ['preparing', 'queued'].includes(delegation?.phase)) return 2;
  if (pendingRequest && work.pendingSummary && !worker?.stopped && !project.paused) return 3;
  return work.status === 'done' ? 4 : 5;
}

/** Pure in-memory workstream projection (no cold coordinator session wakeup). */
export function workRows(service, projectId) {
  const project = service.project(projectId);
  const workers = new Map(service.state().workers.filter(worker => worker.projectId === projectId).map(worker => [worker.sessionId, worker]));
  const pendingRequests = new Set(service.requirements.current(projectId).map(item => item.id));
  const required = service.projectView(project).currentWorkRefs.filter(reference => pendingRequests.has(reference.requestId));
  return service.state().workstreams.filter(work => work.projectId === projectId).map(work => {
    const worker = workers.get(work.workerSessionId);
    const jobs = service.jobs(work.workerSessionId);
    const delegation = latest(work);
    const references = required.filter(reference => reference.workstreamId === work.id);
    const pendingRequest = !delegation.source.requestId || references.some(reference => reference.delegationRef === delegation.ref);
    const priorFailure = hasPriorReferenceFailure(work, delegation, worker, references);
    const rank = workRowRank(project, work, worker, jobs, delegation, pendingRequest, priorFailure);
    return { work, worker, jobs, delegation, status: work.status, rank, group: rank < 4 ? 'current' : 'history' };
  }).sort((a, b) => (a.group === b.group ? a.group === 'current' ? a.rank - b.rank : 0 : a.group === 'current' ? -1 : 1)
    || b.work.updatedAt - a.work.updatedAt || a.work.id.localeCompare(b.work.id));
}

export function prerequisiteStatus(service, report, projectId) {
  if (!report?.prerequisites) return {};
  return {
    prerequisitesChanged: report.prerequisites.some(reference => {
      const work = service.state().workstreams.find(item => item.projectId === projectId && item.id === reference.workstreamId);
      return !work || work.currentDelegationRef !== reference.delegationRef || reference.reportId !== undefined && latest(work).report?.callId !== reference.reportId;
    }),
  };
}

export function reportView(service, report, projectId) {
  if (!report) return;
  const work = service.state().workstreams.find(item => item.projectId === projectId && item.delegations.some(receipt => receipt.ref === report.delegationRef));
  const worker = work && service.worker(work.workerSessionId);
  const docs = join(service.project(projectId).storageRoot, 'docs');
  const receipt = work?.delegations.find(item => item.ref === report.delegationRef);
  return {
    ...report,
    ...(receipt?.sources?.length ? { sources: receipt.sources } : {}),
    request: work && service.requirements.associated(work, receipt),
    artifacts: report.artifacts.map(file => ({ ...file, location: within(docs, file.path) ? 'materials' : worker?.mode })),
    ...prerequisiteStatus(service, report, projectId),
  };
}

export function workSummaries(service, rows) {
  return {
    workstreams: rows.map(({ work, status, delegation, group }) => ({
      id: work.id,
      projectId: work.projectId,
      title: work.title,
      status,
      group,
      workerSessionId: work.workerSessionId,
      blockedBy: work.blockedBy,
      blockedReason: work.blockedReason?.slice(0, 500),
      pendingSummary: work.pendingSummary,
      summaryFailure: work.summaryFailure,
      autoRetry: service.autoRetry(work),
      currentDelegationRef: work.currentDelegationRef,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
      request: service.requirements.associated(work),
      delegation: delegation && { ref: delegation.ref, phase: delegation.phase, scope: delegation.scope, waitingReason: delegation.waitingReason },
      hasReport: Boolean(delegation?.report),
      ...prerequisiteStatus(service, delegation?.report, work.projectId),
    })),
    workers: rows.filter(row => row.worker).map(({ worker, jobs }) => ({
      sessionId: worker.sessionId,
      projectId: worker.projectId,
      workstreamId: worker.workstreamId,
      parentSessionId: worker.parentSessionId,
      cwd: worker.cwd,
      role: worker.role,
      mode: worker.mode,
      phase: worker.phase,
      stopped: worker.stopped,
      activeRunId: worker.activeRunId,
      branch: worker.branch,
      error: worker.error?.slice(0, 500),
      jobs: jobs.map(job => ({ id: job.id, status: job.status })),
    })),
  };
}

export function listWorkstreams(service, projectId, { kind, cursor } = {}) {
  if (!['current', 'history'].includes(kind)) fail('work_kind', 'Choose current or history work.');
  const all = workRows(service, projectId);
  const rows = all.filter(row => row.group === kind);
  if (kind === 'history' && cursor !== undefined && all.some(row => row.work.id === cursor && row.group === 'current')) cursor = undefined;
  const start = cursor === undefined ? 0 : rows.findIndex(row => row.work.id === cursor) + 1;
  if (cursor !== undefined && start === 0) fail('work_cursor', 'This work cursor does not belong to the selected Project and group.');
  const page = rows.slice(start, start + 20);
  const hasMore = start + page.length < rows.length;
  return copy({ ...workSummaries(service, page), cursor: cursor ?? null, total: rows.length, hasMore, nextCursor: hasMore ? page.at(-1).work.id : null });
}

export function getWorkstream(service, projectId, { workstreamId, workerSessionId } = {}) {
  if (Boolean(workstreamId) === Boolean(workerSessionId)) fail('work_identity', 'Choose one workstream or member Session.');
  const row = workRows(service, projectId).find(item => workstreamId ? item.work.id === workstreamId : item.work.workerSessionId === workerSessionId);
  if (!row) fail('missing', 'Workstream does not belong to this Project.');
  const { delegations, settlements, latestReport: _latest, ...work } = row.work;
  return copy({
    workstream: {
      ...work,
      parentSessionId: row.worker?.parentSessionId ?? service.project(projectId).coordinatorSessionId,
      request: service.requirements.associated(row.work),
      delegations: delegations.map(receipt => ({
        ref: receipt.ref,
        messageId: receipt.messageId,
        runId: receipt.runId,
        createdAt: receipt.createdAt,
        phase: receipt.phase,
        scope: receipt.scope,
        requestId: receipt.source.requestId,
        requestRevision: receipt.source.requestRevision,
        ...(receipt.sources?.length ? { sources: receipt.sources } : {}),
      })),
      status: row.status,
      group: row.group,
      delegation: row.delegation,
      latestReport: reportView(service, row.delegation?.report, projectId),
      ...prerequisiteStatus(service, row.delegation?.report, projectId),
      recentSettlements: settlements.slice(-5),
    },
    worker: row.worker && { ...row.worker, jobs: row.jobs },
  });
}

export function resultHistory(service, projectId, { workstreamId, cursor, delegationRef } = {}) {
  const work = service.stream(workstreamId, projectId);
  const reports = work.delegations.filter(item => item.report).map(item => item.report).reverse();
  if (delegationRef) {
    const report = reports.find(item => item.delegationRef === delegationRef);
    if (!report) fail('missing_result', 'The exact recorded report does not exist.');
    return copy({
      items: [reportView(service, report, projectId)],
      total: 1,
      hasMore: false,
      nextCursor: null,
      request: service.requirements.associated(work, work.delegations.find(receipt => receipt.ref === delegationRef)),
    });
  }
  const start = cursor === undefined ? 0 : reports.findIndex(item => item.delegationRef === cursor) + 1;
  if (cursor !== undefined && start === 0) fail('result_cursor', 'This result cursor does not belong to the selected work.');
  const items = reports.slice(start, start + 10).map(item => reportView(service, item, projectId));
  const hasMore = start + items.length < reports.length;
  return copy({ items, total: reports.length, hasMore, nextCursor: hasMore ? items.at(-1).delegationRef : null });
}

export async function storeRoot(service, project) {
  const root = await safeProjectSubdirectory(service.home, project.id);
  if (!samePath(root, project.storageRoot)) fail('store_path', 'Project materials directory does not match its registered identity.');
  return checkedRoot(root);
}

export async function storePath(service, project, path) {
  if (typeof path !== 'string' || !(path === 'notes.md' || path === 'preferences.md' || path === 'charter.md' || path === 'decisions.md' || path === 'research-hosts.txt' || path.startsWith('docs/')) || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === 'internal' || part.toLowerCase() === '.git')) {
    fail('store_path', 'Only notes.md, preferences.md, charter.md, decisions.md, research-hosts.txt and docs files are readable.');
  }
  const root = await storeRoot(service, project);
  if (path === 'charter.md' || path === 'decisions.md' || path === 'research-hosts.txt') {
    try { await fs.writeFile(join(root, path), '', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const actual = await fs.realpath(resolve(root, path));
  const docs = await checkedRoot(join(root, 'docs'));
  if ((path.startsWith('docs/') ? !within(docs, actual) : !samePath(actual, join(root, path))) || !(await fs.stat(actual)).isFile()) {
    fail('store_path', 'Material is outside the allowed root or is not a file.');
  }
  return actual;
}

export async function readStore(service, id, path) {
  const actual = await storePath(service, service.project(id), path);
  if (path !== 'notes.md' && (await fs.stat(actual)).size > 512000) fail('store_size', 'Material exceeds the read limit.');
  const value = await fs.readFile(actual, 'utf8');
  if (path !== 'notes.md') return { path, text: value };
  const split = value.indexOf(NOTES_MARKER);
  const suffix = split >= 0 ? value.slice(split + NOTES_MARKER.length) : '';
  const userText = suffix.replace(/^\r?\n/, '');
  if (Buffer.byteLength(userText) > 256000) fail('store_size', 'User notes exceed the read limit.');
  const generatedText = boundedNotesGenerated(split >= 0 ? value.slice(0, split) : value);
  return { path, text: generatedText + (split >= 0 ? NOTES_MARKER + suffix : ''), generatedText, userText };
}

function buildWorkstreamHistoryPage(service, projectId, historyWork, args, terminalFor) {
  const unreported = historyWork.settlements.filter(terminal => !historyWork.delegations.some(receipt => receipt.report && receipt.runId === terminal.runId && terminal.delegationRefs.includes(receipt.ref))).toReversed();
  if (args.cursor?.startsWith('terminal:')) {
    const anchor = args.cursor.slice('terminal:'.length);
    const start = anchor ? unreported.findIndex(item => item.runId === anchor) + 1 : 0;
    if (anchor && start === 0) fail('result_cursor', 'This terminal cursor does not belong to the selected work.');
    const items = unreported.slice(start, start + 10).map(terminal => ({ terminal }));
    const hasMore = start + items.length < unreported.length;
    return { items, total: unreported.length, hasMore, nextCursor: hasMore ? `terminal:${items.at(-1).terminal.runId}` : null };
  }
  const historyPage = service.resultHistory(projectId, args);
  const nextCursor = historyPage.nextCursor ?? (unreported.length ? 'terminal:' : null);
  return { ...historyPage, hasMore: Boolean(nextCursor), nextCursor, items: historyPage.items.map(report => ({ report, terminal: terminalFor(historyWork, report) })) };
}

export async function readStoreTool(service, actor, args) {
  if (args.path !== 'notes.md') return service.readStore(actor.project.id, args.path);
  const all = (await service.workRows(actor.project.id)).map(row => row.work).filter(item => (!args.workstreamId || item.id === args.workstreamId)
    && (!args.requestId || item.delegations.some(receipt => receipt.source.requestId === args.requestId))
    && (!args.query || item.title.toLowerCase().includes(args.query.toLowerCase())));
  const currentRequestIds = new Set(service.requirements.current(actor.project.id).map(row => row.id));
  const requests = service.requirements.rows(actor.project.id).filter(row => (!args.requestId || row.id === args.requestId)
    && (!args.query || `${row.title}\n${service.requirements.version(row).goal}`.toLowerCase().includes(args.query.toLowerCase())))
    .toSorted((a, b) => Number(currentRequestIds.has(b.id)) - Number(currentRequestIds.has(a.id)) || b.updatedAt - a.updatedAt);
  const offset = args.workstreamId ? 0 : Math.max(0, Number(args.cursor) || 0), page = all.slice(offset, offset + 20);
  const terminalFor = (work, report) => {
    const receipt = report ? work.delegations.find(item => item.ref === report.delegationRef) : latest(work);
    return receipt && work.settlements.find(item => item.runId === receipt.runId && item.delegationRefs.includes(receipt.ref));
  };
  const historyWork = args.workstreamId ? service.stream(args.workstreamId, actor.project.id) : undefined;
  const history = historyWork ? buildWorkstreamHistoryPage(service, actor.project.id, historyWork, args, terminalFor) : undefined;
  const delivered = page.map(work => ({ work, reports: latest(work).report ? [latest(work).report] : [], terminals: [terminalFor(work, latest(work).report)].filter(Boolean) }));
  if (history) delivered.push({ work: historyWork, reports: history.items.map(item => item.report).filter(Boolean), terminals: history.items.map(item => item.terminal).filter(Boolean) });
  const userNotes = (await service.readStore(actor.project.id, 'notes.md')).userText;
  if (actor.role === 'coordinator') {
    const turn = actor.agent.session.snapshotEvents().findLast(event => event.type === 'turn/start')?.data.turn;
    service.consume(actor.agent.id, turn, delivered.filter(({ work }) => work.pendingSummary).map(({ work, reports, terminals }) => ({
      id: work.id,
      runs: terminals.filter(terminal => !terminal.summarizedBy).map(terminal => terminal.runId),
      reports: reports.filter(report => !report.summarizedBy).map(report => report.delegationRef),
    })));
  }
  return copy({
    project: service.projectFacts(service.project(actor.project.id)),
    total: all.length,
    nextCursor: args.workstreamId ? history.nextCursor : offset + page.length < all.length ? String(offset + page.length) : null,
    requests: requests.slice(0, 20).map(row => service.requirements.view(row)),
    requestCount: requests.length,
    deliveries: service.requirements.deliveriesForLead(actor.project.id, args.requestId),
    work: page.map(work => ({
      id: work.id, title: work.title, status: work.status, replaces: work.replaces, request: service.requirements.associated(work),
      summaryFailure: work.summaryFailure, requirement: latest(work).brief,
      report: latest(work).report && service.reportView(latest(work).report, actor.project.id),
      terminal: terminalFor(work, latest(work).report), workerSessionId: work.workerSessionId,
      resultRef: latest(work).report ? { teamId: actor.project.coordinatorSessionId, taskId: work.id, assignmentRef: latest(work).ref, reportId: latest(work).report.callId } : null,
    })),
    ...(history ? { history } : { historyHint: 'Read notes.md with workstreamId and optional cursor to page through that work\'s actual historical reports and matching settlements.' }),
    ...userNotes.length > 4000 && !args.fullNotes
      ? { userNotes: `${userNotes.slice(0, 4000)}…`, userNotesChars: userNotes.length, userNotesHint: 'Only the first 4000 characters are shown; pass fullNotes to read all of them.' }
      : { userNotes },
  });
}

export async function listStore(service, id, { resultsCursor, kind, cursor } = {}) {
  if (kind === 'deliveries') return copy({ deliveries: service.requirements.deliveries(id, cursor) });
  const requestRows = service.requirements.rows(id).filter(row => service.requirements.version(row).authorityError).toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const requestStart = kind === 'requests' && cursor != null ? requestRows.findIndex(row => row.id === cursor) + 1 : 0;
  if (kind === 'requests' && cursor != null && !requestStart) fail('request_cursor', 'This requirement cursor does not belong to the Project requirements that need revision.');
  const requestItems = requestRows.slice(requestStart, requestStart + 10);
  const requests = { items: requestItems.map(row => service.requirements.view(row)), total: requestRows.length, nextCursor: requestStart + requestItems.length < requestRows.length ? requestItems.at(-1).id : null };
  if (kind === 'requests') return copy({ requests });
  const root = await checkedRoot(join(await storeRoot(service, service.project(id)), 'docs'));
  const docs = [];
  const visit = async folder => {
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const filePath = join(folder, item.name);
      if (item.isDirectory()) await visit(filePath);
      else if (item.isFile()) docs.push({ path: `docs/${relative(root, filePath).replaceAll('\\', '/')}`, size: (await fs.stat(filePath)).size });
    }
  };
  await visit(root);
  const all = service.state().workstreams.filter(work => work.projectId === id).flatMap(work => {
    const report = work.delegations.findLast(item => item.report)?.report;
    return report ? [{ workstreamId: work.id, title: work.title, current: report.delegationRef === work.currentDelegationRef, reportCount: work.delegations.filter(item => item.report).length, report }] : [];
  }).sort((a, b) => b.report.at - a.report.at || a.report.delegationRef.localeCompare(b.report.delegationRef));
  const start = resultsCursor == null ? 0 : all.findIndex(item => item.report.delegationRef === resultsCursor) + 1;
  if (resultsCursor != null && start === 0) fail('result_cursor', 'This result cursor does not belong to the current Project results.');
  const results = all.slice(start, start + 10).map(item => ({
    ...item,
    request: service.requirements.associated(service.stream(item.workstreamId), service.stream(item.workstreamId).delegations.find(receipt => receipt.ref === item.report.delegationRef)),
    report: reportView(service, item.report, id),
  }));
  return copy({
    docs,
    results,
    resultsTotal: all.length,
    resultsCursor: resultsCursor ?? null,
    deliveries: service.requirements.deliveries(id),
    requests,
    nextResultsCursor: start + results.length < all.length ? results.at(-1).report.delegationRef : null,
    notes: 'notes.md',
    preferences: 'preferences.md',
  });
}

export async function writeNotes(service, id) {
  const project = service.project(id);
  const root = await storeRoot(service, project);
  const path = join(root, 'notes.md');
  let user = '';
  try {
    const actual = await storePath(service, project, 'notes.md');
    const old = await fs.readFile(actual, 'utf8');
    if (old.includes(NOTES_MARKER)) user = old.slice(old.indexOf(NOTES_MARKER) + NOTES_MARKER.length);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const all = service.state().workstreams.filter(item => item.projectId === id);
  const rows = workRows(service, id).slice(0, 20).map(({ work, worker }) => `- [${work.status === 'done' ? 'x' : ' '}] ${work.title} (${work.id})\n  Status: ${work.status}${work.blockedReason ? `; ${work.blockedReason}` : ''}; worker ${worker.phase}\n  Directory: ${worker.cwd || 'not started'}\n  Current request: ${work.brief.slice(0, 2000)}\n${work.latestReport ? `  Worker report (${work.latestReport.outcome}): ${work.latestReport.summary.slice(0, 2000)}\n  Artifacts: ${work.latestReport.artifacts.map(item => item.path).join(', ')}\n  Evidence: ${work.latestReport.evidence.join('; ').slice(0, 2000)}\n  Remaining issues: ${work.latestReport.remainingIssues.join('; ').slice(0, 2000) || 'none reported'}\n` : ''}${work.summaryFailure ? `  Summary failed (${work.summaryFailure.error.code}): ${work.summaryFailure.error.message}\n  Saved result remains available; request a new summary in the main conversation.\n` : work.pendingSummary ? '  Pending: no associated visible coordinator summary yet.\n' : ''}`);
  const requirements = service.requirements.rows(id).toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, 20).map(row => {
    const version = service.requirements.version(row);
    return `- ${row.title} (${row.id}, revision ${row.revision})\n  Goal: ${version.goal.slice(0, 2000)}\n  Conditions: ${version.conditions.join('; ').slice(0, 2000)}\n  Restrictions: ${version.constraints.join('; ').slice(0, 2000)}\n`;
  });
  const generated = `# ${project.title}\n\nBound directory: ${project.canonicalWorkingDirectory}\nProject ${project.paused ? 'paused' : 'available'}; ${project.lifecycle}\n\nRequirements:\n${requirements.join('\n') || 'No recorded user goals yet.'}\n\n${rows.join('\n') || 'No delegated work yet.'}\nShowing ${rows.length} of ${all.length} works. Use project_read_store with cursor/query for older work.\n\n`;
  await atomicText(path, boundedNotesGenerated(generated) + NOTES_MARKER + user);
}

export function charterFor(service, id) {
  const project = service.state().projects.find(item => item.coordinatorSessionId === id);
  if (!project) return '';
  let value;
  try { value = safeReadStoreFileSync(project.storageRoot, 'charter.md', 512 * 1024); }
  catch (error) { fail('store_path', error.message); }
  if (!value || !value.trim()) return '';
  const bytes = Buffer.from(value);
  if (bytes.length > CHARTER_LIMIT) {
    let end = CHARTER_LIMIT;
    while ((bytes[end] & 0xc0) === 0x80) end--;
    value = bytes.subarray(0, end).toString('utf8') + '\n[Project rules truncated at the size limit; ask the user to shorten them.]';
  }
  return `Project rules (the user's standing rules for this Project):\n${value}\nFollow these rules over your own defaults and habits. If the user explicitly asks in the current conversation to deviate, confirm the exception once, then follow the user and mention the exception in your reply.\n`;
}

export function decisionsFor(service, id) {
  const project = service.state().projects.find(item => item.coordinatorSessionId === id);
  if (!project) return '';
  let value;
  try { value = safeReadStoreFileSync(project.storageRoot, 'decisions.md', 512 * 1024); }
  catch { return ''; }
  if (!value) return '';
  let recent = value.replace(/^# .*\n+/, '');
  if (!recent.trim()) return '';
  const bytes = Buffer.from(recent);
  if (bytes.length > DECISION_LIMIT) {
    recent = bytes.subarray(bytes.length - DECISION_LIMIT).toString('utf8');
    const start = recent.indexOf('\n## ');
    recent = start >= 0 ? recent.slice(start + 1) : recent;
  }
  return `Recent Project decisions (oldest first; the full log is decisions.md through project_read_store). Keep later work consistent with them unless the user decides otherwise:\n${recent}`;
}

export function preferencesFor(service, id) {
  const project = service.state().projects.find(item => item.coordinatorSessionId === id);
  if (!project) return '';
  let value;
  try { value = safeReadStoreFileSync(project.storageRoot, 'preferences.md', 512 * 1024); }
  catch (error) { fail('store_path', error.message); }
  if (!value || !value.trim()) return '';
  const bytes = Buffer.from(value);
  if (bytes.length > PREFERENCES_LIMIT) {
    let end = PREFERENCES_LIMIT;
    while ((bytes[end] & 0xc0) === 0x80) end--;
    value = bytes.subarray(0, end).toString('utf8') + '\n[Project preferences truncated at the size limit; ask the user to shorten them.]';
  }
  return `Project preferences (current user instructions take precedence):\n${value}`;
}

function collectActiveNativeDependencyIds(service, projectWorks) {
  const activeDepIds = new Set();
  for (const work of projectWorks) {
    if (!work.nativeTaskId || work.archived) continue;
    const worker = service.worker(work.workerSessionId);
    const active = Boolean(worker?.activeRunId || ['active', 'provisioning', 'stopping'].includes(worker?.phase) || ['queued', 'preparing'].includes(latest(work)?.phase));
    if (active) for (const depId of work.blockedBy ?? []) activeDepIds.add(depId);
  }
  return activeDepIds;
}

function isWorkerBusyForRelease(service, work) {
  const worker = service.worker(work.workerSessionId);
  return Boolean(worker?.activeRunId || ['active', 'provisioning', 'stopping'].includes(worker?.phase) || service.launches.has(work.id) || service.jobs(work.workerSessionId).length);
}

function isHistoricalTaskReleasable(service, work, requests, activeDepIds, { requestId, forceAll }) {
  if (!work.nativeTaskId || activeDepIds.has(work.id) || isWorkerBusyForRelease(service, work)) return false;
  const reqId = latest(work)?.source?.requestId;
  if (requestId && reqId !== requestId) return false;
  if (forceAll) return true;
  const req = reqId ? requests.get(reqId) : undefined;
  if (req && service.requirements.handover(req).completed) return true;
  if (work.archived || req?.archivedAt || req?.queue?.state === 'cancelled') return true;
  return !reqId && work.status === 'done' && !work.pendingSummary;
}

/**
 * Release native TeamTaskBoard slots for completed/delivered, archived or cancelled historical workstreams
 * without deleting their durable Project history records.
 */
export async function releaseHistoricalNativeTasks(service, projectId, { requestId, forceAll = false } = {}) {
  const project = service.project(projectId);
  const root = service.ctx.agents.get(project.coordinatorSessionId) ?? await service.coordinator(project).catch(() => null);
  if (!root || !service.teams) return 0;
  const projectWorks = service.state().workstreams.filter(work => work.projectId === projectId);
  const requests = new Map((service.state().requests ?? []).filter(row => row.projectId === projectId).map(row => [row.id, row]));
  const activeDepIds = collectActiveNativeDependencyIds(service, projectWorks);
  const toRelease = projectWorks.filter(work => isHistoricalTaskReleasable(service, work, requests, activeDepIds, { requestId, forceAll }));
  const releasedIds = [];
  for (const work of toRelease) {
    try {
      await service.teams.updateTask(root, { taskId: work.nativeTaskId, action: 'delete' });
      releasedIds.push(work.id);
    } catch (error) {
      if (/not found|deleted/i.test(error?.message ?? '')) releasedIds.push(work.id);
      else service.ctx.logger?.warn?.('Native task slot release skipped for %s: %s', work.id, error.message);
    }
  }
  if (releasedIds.length) {
    const now = Date.now();
    await service.write(state => {
      for (const workId of releasedIds) {
        const row = state.workstreams.find(item => item.id === workId);
        if (!row?.nativeTaskId) continue;
        row.archivedNativeTaskId = row.nativeTaskId;
        delete row.nativeTaskId;
        row.updatedAt = now;
      }
    });
  }
  return releasedIds.length;
}

/**
 * Record a workstream failure, track consecutive failure budget, and escalate with concrete evidence
 * once consecutive failures hit the limit or a non-retryable config/auth/environment error occurs.
 */
export async function recordFailureAndEscalate(service, workId, { reason, category, retryRequired }) {
  let escalated = false;
  let requestId;
  let workTitle = '';
  let count = 0;
  const now = Date.now();
  await service.serial(() => service.write(state => {
    const work = state.workstreams.find(item => item.id === workId);
    if (!work) return;
    workTitle = work.title;
    requestId = latest(work)?.source?.requestId;
    if (!retryRequired) work.consecutiveFailures = (work.consecutiveFailures ?? 0) + 1;
    count = work.consecutiveFailures ?? 0;
    if ((retryRequired || count >= CONSECUTIVE_FAILURE_LIMIT) && !work.escalatedAt) {
      work.escalatedAt = now;
      escalated = true;
    }
    work.updatedAt = now;
  }));
  if (!escalated || !requestId) return { escalated, count };
  const work = service.state().workstreams.find(item => item.id === workId);
  const req = (service.state().requests ?? []).find(row => row.id === requestId && row.projectId === work?.projectId);
  if (req && !req.ask) {
    const question = retryRequired
      ? `工作流「${workTitle}」遇到需要人工修复的${category || '配置/环境'}错误，已暂停自动重试：${String(reason).slice(0, 400)}。修复后请告知继续。`
      : `工作流「${workTitle}」连续失败 ${count} 次，已自动暂停升级介入。最近错误：${String(reason).slice(0, 400)}。请确认是否调整方案或重试。`;
    await service.requirements.ask(req.projectId, {
      requestId: req.id,
      requestRevision: req.revision,
      question,
      options: ['修复后继续', '调整方案', '停止此需求'],
      ifUnanswered: '保持暂停，不再消耗重试预算。',
      workstreamId: workId,
      delegationRef: work?.currentDelegationRef,
    }).catch(error => service.ctx?.logger?.warn?.('Escalation question placement skipped: %s', error.message));
  }
  return { escalated, count };
}

/** Periodically detect and heal orphaned active/preparing worker states whose live agent is gone. */
export async function sweepOrphans(service) {
  if (service.closing || service.recovering || !service.available) return 0;
  const now = Date.now();
  const orphans = [];
  for (const worker of service.state().workers) {
    if (service.launches.has(worker.workstreamId) || service.stops.has(worker.sessionId) || service.held.has(worker.sessionId)) continue;
    const work = service.state().workstreams.find(item => item.id === worker.workstreamId);
    if (!work) continue;
    const receipt = latest(work);
    const live = service.ctx.agents.get(worker.sessionId);
    const liveRunning = live?.status === 'running';
    const hasJobs = service.jobs(worker.sessionId).length > 0;
    if (worker.phase === 'active' && !liveRunning && !hasJobs) {
      orphans.push({ kind: 'worker', workerId: worker.sessionId, workId: work.id, projectId: worker.projectId });
    } else if (receipt?.phase === 'preparing' && now - receipt.createdAt > PREPARING_ORPHAN_MS) {
      orphans.push({ kind: 'preparing', workerId: worker.sessionId, workId: work.id, projectId: worker.projectId, ref: receipt.ref });
    }
  }
  if (!orphans.length) return 0;
  await service.serial(async () => {
    const touchedProjects = new Set();
    await service.write(state => {
      for (const item of orphans) {
        const worker = state.workers.find(row => row.sessionId === item.workerId);
        const work = state.workstreams.find(row => row.id === item.workId);
        if (!worker || !work || service.launches.has(work.id) || service.stops.has(worker.sessionId)) continue;
        if (service.ctx.agents.get(worker.sessionId)?.status === 'running' || service.jobs(worker.sessionId).length) continue;
        touchedProjects.add(item.projectId);
        worker.directoryHeld = false;
        worker.activeRunId = '';
        worker.reservationRef = '';
        worker.phase = worker.materialized ? 'idle' : 'failed';
        worker.updatedAt = now;
        if (item.kind === 'preparing') {
          const receipt = work.delegations.find(entry => entry.ref === item.ref);
          if (receipt && receipt.phase === 'preparing') {
            receipt.phase = 'failed';
            receipt.error = 'Orphaned preparing delegation timed out without a live launch.';
          }
        }
        if (work.status === 'running') {
          work.status = 'blocked';
          work.blockedReason = 'Orphaned worker session exited without settlement; waiting for inspection or retry.';
          work.updatedAt = now;
        }
      }
    });
    for (const projectId of touchedProjects) {
      await service.notes(projectId).catch(error => service.ctx?.logger?.warn?.('Orphan sweep notes refresh skipped: %s', error.message));
    }
  });
  service.schedule();
  return orphans.length;
}
