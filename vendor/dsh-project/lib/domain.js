/** Project indexes complement the existing Session and continuable runtime. */
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
const id = z.string().min(1);
const project = z.object({ id, title: id, workspaceId: id.optional(), canonicalWorkingDirectory: id, directoryIdentity: id,
  coordinatorSessionId: id, storageRoot: id, lifecycle: z.enum(['creating', 'ready', 'archived']),
  paused: z.boolean(), holdSourceMessageId: z.string(), diagnostics: z.array(z.string()), creationRequestId: id, createdAt: z.number(), updatedAt: z.number() });
const source = z.object({ sessionId: id, messageId: id, callId: id, text: z.string(), messageIds: z.array(id).optional(), continuationMessageId: id.optional(), importedInputs: z.array(z.object({ messageId: id, text: z.string() })).optional(), authorizationCallId: id.optional(), requestId: id.optional(), requestRevision: z.number().int().positive().optional() });
const humanInput = z.object({ messageId: id, text: z.string() });
const workReference = z.object({ workstreamId: id, delegationRef: id });
const evidenceReference = workReference.extend({ runId: id, reportId: id.optional() });
const basisHead = workReference.extend({ runId: z.string(), reportId: z.string() });
const importedRequest = z.object({ inputs: z.array(humanInput), requiredWork: z.array(workReference), callId: id });
const importedDelivery = z.object({ callId: id, callSeq: z.number(), references: z.array(evidenceReference), requiredWork: z.array(workReference),
  basisHeads: z.array(basisHead).optional(), basisAlreadyChanged: z.boolean().optional(), messageId: id.optional(), committedAt: z.number().optional(), supersededBy: id.optional() });
const requestVersion = z.object({ revision: z.number().int().positive(), title: id.optional(), goal: id, constraints: z.array(z.string()), conditions: z.array(z.string()), scope: z.enum(['worker', 'readonly', 'docs']), writePaths: z.array(z.string()), source: source.optional(), authorityError: id.optional(), imported035: importedRequest.optional(), at: z.number() });
const requestQueue = z.object({ state: z.enum(['discussing', 'queued', 'active', 'cancelled']), order: z.number().optional(),
  released: z.boolean().optional(), resumeRequested: z.boolean().optional(), activation: z.object({ messageId: id, requestRevision: z.number().int().positive(), resume: z.boolean().optional() }).optional() });
const requestChanges = z.object({ isGit: z.boolean(), baseline: z.string().optional(), capturedAt: z.number(), end: z.string().optional(), endedAt: z.number().optional(),
  files: z.array(z.object({ path: z.string(), status: z.string(), added: z.number(), removed: z.number(), binary: z.boolean().optional() })).optional(),
  fileCount: z.number().optional(), added: z.number().optional(), removed: z.number().optional(), isolated: z.boolean().optional(), revertedAt: z.number().optional() });
const request = z.object({ id, projectId: id, title: id, revision: z.number().int().positive(), versions: z.array(requestVersion), queue: requestQueue.optional(), archivedAt: z.number().optional(), changes: requestChanges.optional(), createdAt: z.number(), updatedAt: z.number() });
const resultReference = z.object({ workstreamId: id, delegationRef: id, reportId: id.optional() });
const terminalReference = z.object({ workstreamId: id, delegationRef: id, runId: id });
const visualReplyPage = z.object({ sessionId: id, callId: id, file: z.object({ attachmentId: id, name: id, bytes: z.number().int().positive() }), title: id, height: z.number().int().min(80).max(2000) });
const delivery = z.object({ id, projectId: id, requestId: id, requestRevision: z.number().int().positive(), title: id, summary: id, outcome: z.enum(['completed', 'partial', 'blocked', 'failed']), evidence: z.array(z.string()), remainingIssues: z.array(z.string()), reportRefs: z.array(resultReference), terminalRefs: z.array(terminalReference).optional(), pages: z.array(visualReplyPage).optional(), requiredDelegations: z.array(z.object({ workstreamId: id, delegationRef: id, runId: z.string() })), declaredCallId: id, sessionId: id, turn: z.number(), status: z.enum(['draft', 'delivered', 'obsolete', 'historical']), decision: z.string().optional(), replyMessageId: id.optional(), error: z.string().optional(), imported035: importedDelivery.optional(), at: z.number() });
const prerequisite = z.object({ workstreamId: id, title: id, delegationRef: id, reportId: id.optional() });
const waitingReason = z.object({ kind: z.enum(['dependencies', 'directory', 'capacity']), workTitles: z.array(z.string()), code: z.string().optional() });
const report = z.object({ delegationRef: id, outcome: z.enum(['completed', 'blocked', 'failed']), summary: id,
  artifacts: z.array(z.object({ path: id, size: z.number(), sha256: id, type: id })), evidence: z.array(z.string()), remainingIssues: z.array(z.string()), at: z.number(), callId: id, summarizedBy: z.string().optional(), prerequisites: z.array(prerequisite).optional() });
const delegation = z.object({ ref: id, source, brief: id, scope: z.enum(['worker', 'readonly', 'docs']), writePaths: z.array(z.string()), phase: z.enum(['queued', 'preparing', 'accepted', 'failed', 'stopped']),
  messageId: z.string(), runId: z.string(), error: z.string(), createdAt: z.number(), report: report.optional(), waitingReason: waitingReason.optional(),
  dispatchedPrerequisites: z.array(prerequisite).optional(), prerequisites: z.array(prerequisite).optional(), supersededBy: id.optional() });
const workstream = z.object({ id, projectId: id, title: id, brief: id, status: z.enum(['open', 'running', 'blocked', 'done']),
  replaces: z.object({ workstreamId: id, delegationRef: id, requestId: id, requestRevision: z.number().int().positive(), reason: id }).optional(),
  workerSessionId: id, blockedBy: z.array(id).optional(), blockedReason: z.string(), currentDelegationRef: id, delegations: z.array(delegation), latestReport: report.optional(),
  settlements: z.array(z.object({ runId: id, delegationRefs: z.array(id), stopReason: id, summary: z.string(), at: z.number(),
    merged: z.boolean(), noticeMessageId: z.string(), summarizedBy: z.string() })),
  pendingSummary: z.boolean(), summaryFailure: z.object({ turn: z.number(), at: z.number(), delegationRef: id, runId: id.optional(),
    error: z.object({ code: id, message: id }) }).optional(), archived: z.boolean(), createdAt: z.number(), updatedAt: z.number() });
const worker = z.object({ sessionId: id, projectId: id, workstreamId: id, cwd: z.string(),
  role: z.enum(['worker', 'readonly', 'docs']), mode: z.enum(['existing', 'worktree']),
  phase: z.enum(['provisioning', 'active', 'idle', 'failed', 'stopping']), directoryHeld: z.boolean(), stopped: z.boolean(), materialized: z.boolean(),
  activeRunId: z.string().optional(), reservationRef: z.string().optional(), holdSourceMessageId: z.string().optional(),
  branch: z.string().optional(), workspace: z.unknown().optional(), writePaths: z.array(z.string()), consumedDelegationRef: z.string(), error: z.string(), updatedAt: z.number() });
const state = z.object({ version: z.literal(2), revision: z.number().int().nonnegative(), projects: z.array(project), workstreams: z.array(workstream), workers: z.array(worker), requests: z.array(request).optional(), deliveries: z.array(delivery).optional() });
const finalV1 = state.extend({ version: z.literal(1), requests: z.array(request.extend({ versions: z.array(requestVersion.extend({ source })) })).optional(),
  deliveries: z.array(delivery.extend({ outcome: z.enum(['completed', 'partial']), status: z.enum(['draft', 'delivered', 'obsolete']) })).optional() });
const publishedSource = z.object({ sessionId: id, messageId: id, callId: id, text: z.string(), inputs: z.array(humanInput).optional(), requestId: id.optional(), requestVersion: z.number().int().positive().optional() });
const publishedVersion = z.object({ version: z.number().int().positive(), goal: id, criteria: z.array(z.string()), constraints: z.array(z.string()), authorization: z.enum(['readonly', 'docs', 'worker']), writePaths: z.array(z.string()), inputs: z.array(humanInput), requiredWork: z.array(workReference), callId: id, at: z.number() });
const publishedRequest = z.object({ id, projectId: id, currentVersion: z.number().int().positive(), versions: z.array(publishedVersion), updatedAt: z.number() });
const publishedDelivery = z.object({ id, projectId: id, requestId: id, requestVersion: z.number().int().positive(), outcome: z.enum(['completed', 'blocked', 'failed', 'partial']), summary: id, evidence: z.array(z.string()), remainingIssues: z.array(z.string()), references: z.array(evidenceReference), requiredWork: z.array(workReference), basisHeads: z.array(basisHead).optional(), basisAlreadyChanged: z.boolean().optional(), sessionId: id, turn: z.number(), callId: id, callSeq: z.number(), at: z.number(), messageId: id.optional(), committedAt: z.number().optional(), supersededBy: id.optional(), error: z.string().optional() });
const publishedV1 = state.extend({ version: z.literal(1), requests: z.array(publishedRequest).optional(), deliveries: z.array(publishedDelivery).optional(),
  workstreams: z.array(workstream.extend({ delegations: z.array(delegation.extend({ source: publishedSource, requestId: id.optional(), requestVersion: z.number().int().positive().optional() })) })) });
export function publishedCatalog(value) {
  return value?.requests?.some(row => Object.hasOwn(row, 'currentVersion')) || value?.deliveries?.some(row => Object.hasOwn(row, 'requestVersion'))
    || value?.workstreams?.some(row => row.delegations?.some(receipt => Object.hasOwn(receipt, 'requestVersion') || Object.hasOwn(receipt.source ?? {}, 'inputs') || Object.hasOwn(receipt.source ?? {}, 'requestVersion')));
}
const catalogSchema = z.unknown().transform((value, context) => {
  const parsed = (value?.version === 2 ? state : publishedCatalog(value) ? publishedV1 : finalV1).safeParse(value);
  if (!parsed.success) { for (const issue of parsed.error.issues) context.addIssue(issue); return z.NEVER; }
  if (parsed.data.version === 2) for (const row of parsed.data.requests ?? []) for (const version of row.versions) {
    if (!version.source && !version.authorityError) { context.addIssue({ code: 'custom', message: `Request ${row.id} revision ${version.revision} has neither source authority nor its preserved migration error.` }); return z.NEVER; }
  }
  return parsed.data;
});
export const initialState = { version: 2, revision: 0, projects: [], workstreams: [], workers: [], requests: [], deliveries: [] };
// Abandoned Team trial data is preserved in whale_project; never reinterpret it.
// The single-file storage envelope stays at 1; catalog content owns its explicit migration to 2.
export const projectDomain = defineDomain({ name: 'whale_project_local', version: 1, tables: { state: domainTable(catalogSchema) } });
