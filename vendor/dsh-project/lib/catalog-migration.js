/** One-time conversion of the two shipped v1 catalogs, before any runtime admission. */
import { isAbsolute } from 'node:path';
import { projectDomain, publishedCatalog } from './domain.js';

const text = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const fail = message => { throw Object.assign(new Error(`Project catalog migration: ${message}`), { code: 'catalog_migration' }); };
const safePaths = paths => paths.every(path => path && !isAbsolute(path) && !path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git') && /\.(md|mdx|txt|rst|adoc)$/i.test(path));

/** Read the original durable prefixes; an attached Session is not persistence evidence. */
export async function migrateCatalog(before, persistence) {
  if (before.version === 2) return before;
  const next = structuredClone(before); next.version = 2; next.revision++;
  if (!publishedCatalog(before)) return projectDomain.tables.state.valueSchema.parse(next);
  const projects = new Map(next.projects.map(project => [project.id, project]));
  const prefixes = new Map();
  for (const project of next.projects) {
    if (!(before.requests ?? []).some(row => row.projectId === project.id) && !(before.deliveries ?? []).some(row => row.projectId === project.id)) continue;
    let handle;
    try { handle = await persistence.open(project.coordinatorSessionId, 'read'); prefixes.set(project.id, { events: (await handle.read()).events }); }
    catch (error) { prefixes.set(project.id, { error: `The original coordinator's persistent history could not be read: ${error.message}` }); }
    finally { await handle?.close(); }
  }
  next.requests = (before.requests ?? []).map(row => {
    const project = projects.get(row.projectId); if (!project) fail(`requirement ${row.id} has no original Project.`);
    const current = row.versions.find(version => version.version === row.currentVersion);
    if (!current || !row.versions.length) fail(`requirement ${row.id} has no recorded current version.`);
    const versions = row.versions.map(version => {
      const inputs = version.inputs, last = inputs.at(-1);
      return { revision: version.version, title: version.goal.slice(0, 240), goal: version.goal, constraints: version.constraints, conditions: version.criteria,
        scope: version.authorization, writePaths: version.writePaths, at: version.at,
        ...(last ? { source: { sessionId: project.coordinatorSessionId, messageId: last.messageId, messageIds: inputs.map(input => input.messageId),
          callId: version.callId, authorizationCallId: version.callId, text: inputs.map(input => input.text).join('\n\n'), requestId: row.id, requestRevision: version.version } } : { authorityError: 'The saved requirement has no original human input; it remains historical until an actual user revision.' }),
        imported035: { inputs, requiredWork: version.requiredWork, callId: version.callId } };
    });
    return { id: row.id, projectId: row.projectId, title: current.goal.slice(0, 240), revision: row.currentVersion, versions, createdAt: Math.min(...row.versions.map(version => version.at)), updatedAt: row.updatedAt };
  });
  const requests = new Map(next.requests.map(row => [row.id, row]));
  for (const work of next.workstreams) for (const receipt of work.delegations) {
    const requestId = receipt.requestId ?? receipt.source.requestId, requestRevision = receipt.requestVersion ?? receipt.source.requestVersion;
    if (receipt.requestId && receipt.source.requestId && receipt.requestId !== receipt.source.requestId || receipt.requestVersion && receipt.source.requestVersion && receipt.requestVersion !== receipt.source.requestVersion) fail(`assignment ${receipt.ref} has conflicting requirement identities.`);
    const { inputs, requestVersion, ...source } = receipt.source;
    receipt.source = { ...source, ...(inputs ? { messageIds: inputs.map(input => input.messageId), importedInputs: inputs } : {}), ...(requestId ? { requestId, requestRevision } : {}) };
    if (requestId) {
      const request = requests.get(requestId), version = request?.versions.find(version => version.revision === requestRevision);
      if (!version || request.projectId !== work.projectId) fail(`assignment ${receipt.ref} lacks its original requirement version.`);
      receipt.source.authorizationCallId = version.imported035.callId;
    }
    delete receipt.requestId; delete receipt.requestVersion;
  }
  for (const request of next.requests) for (const version of request.versions) {
    const prefix = prefixes.get(request.projectId), events = prefix?.events ?? [], original = version.imported035;
    const previous = request.versions.find(row => row.revision === version.revision - 1);
    const call = events.find(event => event.type === 'tool/call' && event.data.callId === original.callId && ['project_request', 'project_delegate'].includes(event.data.name));
    const start = call && events.findLast(event => event.type === 'turn/start' && event.data.turn === call.data.turn && event.seq < call.seq);
    const newlyAuthorized = original.inputs.filter(input => !previous?.imported035.inputs.some(prior => prior.messageId === input.messageId));
    const missingHuman = original.inputs.some(input => !events.some(event => event.type === 'user/message' && event.data.source.kind === 'user' && event.data.id === input.messageId && text(event.data) === input.text));
    const accepted = call && events.some(event => event.type === 'tool/result' && event.seq > call.seq && event.data.turn === call.data.turn && event.data.message.toolCallId === call.data.callId && !event.data.message.isError && !event.data.error);
    const actualTurnInput = call && start && newlyAuthorized.some(input => events.some(event => event.type === 'user/message' && event.seq > start.seq && event.seq < call.seq && event.data.source.kind === 'user' && event.data.id === input.messageId));
    const missingWork = original.requiredWork.some(reference => {
      const work = next.workstreams.find(work => work.id === reference.workstreamId && work.projectId === request.projectId), receipt = work?.delegations.find(receipt => receipt.ref === reference.delegationRef);
      return !receipt || receipt.source.requestId !== request.id || receipt.source.requestRevision > version.revision;
    });
    if (prefix?.error || !original.inputs.length || missingHuman || !accepted || !actualTurnInput || missingWork || version.scope === 'docs' && !safePaths(version.writePaths)) {
      version.authorityError = prefix?.error ?? 'The saved requirement cannot be matched to its original human inputs, accepted authorization call and necessary assignments. It remains historical; revise it with an actual user message before execution.';
    }
  }
  next.deliveries = (before.deliveries ?? []).map(row => {
    const request = requests.get(row.requestId), version = request?.versions.find(version => version.revision === row.requestVersion);
    if (!version || request.projectId !== row.projectId) fail(`delivery ${row.id} lacks its original requirement version.`);
    const prefix = prefixes.get(row.projectId), events = prefix?.events ?? [];
    const call = events.find(event => event.seq === row.callSeq && event.type === 'tool/call' && event.data.callId === row.callId && event.data.turn === row.turn && event.data.name === 'project_deliver');
    const requiredDelegations = row.requiredWork.map(reference => {
      const frozen = row.references.find(item => item.workstreamId === reference.workstreamId && item.delegationRef === reference.delegationRef)
        ?? row.basisHeads?.find(item => item.workstreamId === reference.workstreamId && item.delegationRef === reference.delegationRef);
      return { ...reference, runId: frozen?.runId ?? '' };
    });
    const imported035 = { callId: row.callId, callSeq: row.callSeq, references: row.references, requiredWork: row.requiredWork,
      ...(row.basisHeads ? { basisHeads: row.basisHeads } : {}), ...(row.basisAlreadyChanged !== undefined ? { basisAlreadyChanged: row.basisAlreadyChanged } : {}),
      ...(row.messageId ? { messageId: row.messageId } : {}), ...(row.committedAt !== undefined ? { committedAt: row.committedAt } : {}), ...(row.supersededBy ? { supersededBy: row.supersededBy } : {}) };
    const delivery = { id: row.id, projectId: row.projectId, requestId: row.requestId, requestRevision: row.requestVersion, title: version.title,
      summary: row.summary, outcome: row.outcome, evidence: row.evidence, remainingIssues: row.remainingIssues, at: row.at,
      reportRefs: row.references.filter(reference => reference.reportId).map(({ workstreamId, delegationRef, reportId }) => ({ workstreamId, delegationRef, reportId })),
      terminalRefs: row.references.map(({ workstreamId, delegationRef, runId }) => ({ workstreamId, delegationRef, runId })), requiredDelegations,
      declaredCallId: row.callId, sessionId: row.sessionId, turn: row.turn, status: row.supersededBy ? 'obsolete' : 'historical', imported035,
      ...(row.messageId ? { replyMessageId: row.messageId } : {}), ...(row.error ? { error: row.error } : {}) };
    const project = projects.get(row.projectId);
    const end = events.find(event => event.type === 'turn/end' && event.data.turn === row.turn && event.data.reason.kind === 'completed');
    const accepted = call && events.find(event => event.seq > call.seq && (!end || event.seq < end.seq) && event.type === 'tool/result' && event.data.turn === row.turn && event.data.message.toolCallId === call.data.callId && !event.data.message.isError && !event.data.error);
    const reply = accepted && end && events.findLast(event => event.seq > accepted.seq && event.seq < end.seq && event.type === 'assistant/message' && event.data.turn === row.turn
      && (!row.messageId || event.data.message.id === row.messageId) && !event.data.interrupted && !event.data.message.content?.some(block => block.type === 'tool-call') && text(event.data.message).trim());
    const exactReferences = row.references.every(reference => {
      const work = next.workstreams.find(work => work.id === reference.workstreamId && work.projectId === row.projectId), receipt = work?.delegations.find(receipt => receipt.ref === reference.delegationRef);
      return receipt?.runId === reference.runId && work.settlements.some(terminal => terminal.runId === reference.runId && terminal.delegationRefs.includes(reference.delegationRef))
        && (!reference.reportId || receipt.report?.callId === reference.reportId);
    });
    const exactObligations = requiredDelegations.every(reference => {
      const work = next.workstreams.find(work => work.id === reference.workstreamId && work.projectId === row.projectId), receipt = work?.delegations.find(receipt => receipt.ref === reference.delegationRef);
      return receipt?.source.requestId === row.requestId && receipt.source.requestRevision <= row.requestVersion;
    });
    const completeWork = row.outcome !== 'completed' || !row.remainingIssues.length && requiredDelegations.every(reference => {
      const work = next.workstreams.find(work => work.id === reference.workstreamId && work.projectId === row.projectId), receipt = work?.delegations.find(receipt => receipt.ref === reference.delegationRef);
      return reference.runId && receipt?.runId === reference.runId && receipt.report?.outcome === 'completed' && row.references.some(item => item.workstreamId === work.id && item.delegationRef === receipt.ref && item.reportId === receipt.report.callId)
        && work.settlements.some(terminal => terminal.runId === reference.runId && terminal.delegationRefs.includes(reference.delegationRef) && terminal.stopReason === 'completed');
    });
    if (!row.supersededBy && project?.coordinatorSessionId === row.sessionId && !version.authorityError && call && end && reply && exactReferences && exactObligations && completeWork) {
      delivery.status = 'delivered'; delivery.replyMessageId = reply.data.message.id; delete delivery.error;
    } else if (!row.supersededBy) delivery.error = prefix?.error ?? 'This saved handover lacks matching persistent declaration acceptance, final reply or exact settled evidence. Its original record is preserved as history; request a new summary in the original conversation.';
    return delivery;
  });
  return projectDomain.tables.state.valueSchema.parse(next);
}
