/** Project indexes complement the existing Session and continuable runtime. */
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
const id = z.string().min(1);
const project = z.object({ id, title: id, workspaceId: id, canonicalWorkingDirectory: id, directoryIdentity: id,
  coordinatorSessionId: id, storageRoot: id, lifecycle: z.enum(['creating', 'ready', 'archived']),
  paused: z.boolean(), holdSourceMessageId: z.string(), diagnostics: z.array(z.string()), creationRequestId: id, createdAt: z.number(), updatedAt: z.number() });
const source = z.object({ sessionId: id, messageId: id, callId: id, text: z.string() });
const report = z.object({ delegationRef: id, outcome: z.enum(['completed', 'blocked', 'failed']), summary: id,
  artifacts: z.array(z.object({ path: id, size: z.number(), sha256: id, type: id })), evidence: z.array(z.string()), remainingIssues: z.array(z.string()), at: z.number(), callId: id, summarizedBy: z.string().optional() });
const delegation = z.object({ ref: id, source, brief: id, scope: z.enum(['worker', 'readonly', 'docs']), writePaths: z.array(z.string()), phase: z.enum(['queued', 'preparing', 'accepted', 'failed', 'stopped']),
  messageId: z.string(), runId: z.string(), error: z.string(), createdAt: z.number(), report: report.optional() });
const workstream = z.object({ id, projectId: id, title: id, brief: id, status: z.enum(['open', 'running', 'blocked', 'done']),
  workerSessionId: id, blockedReason: z.string(), currentDelegationRef: id, delegations: z.array(delegation), latestReport: report.optional(),
  settlements: z.array(z.object({ runId: id, delegationRefs: z.array(id), stopReason: id, summary: z.string(), at: z.number(),
    merged: z.boolean(), noticeMessageId: z.string(), summarizedBy: z.string() })),
  pendingSummary: z.boolean(), archived: z.boolean(), createdAt: z.number(), updatedAt: z.number() });
const worker = z.object({ sessionId: id, projectId: id, workstreamId: id, cwd: z.string(),
  role: z.enum(['worker', 'readonly', 'docs']), mode: z.enum(['existing', 'worktree']),
  phase: z.enum(['provisioning', 'active', 'idle', 'failed', 'stopping']), directoryHeld: z.boolean(), stopped: z.boolean(), materialized: z.boolean(),
  branch: z.string().optional(), workspace: z.unknown().optional(), writePaths: z.array(z.string()), consumedDelegationRef: z.string(), error: z.string(), updatedAt: z.number() });
const state = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), projects: z.array(project), workstreams: z.array(workstream), workers: z.array(worker) });
export const initialState = { version: 1, revision: 0, projects: [], workstreams: [], workers: [] };
// Abandoned Team trial data is preserved in whale_project; never reinterpret it.
export const projectDomain = defineDomain({ name: 'whale_project_local', version: 1, tables: { state: domainTable(state) } });
