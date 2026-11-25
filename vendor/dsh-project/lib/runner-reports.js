/**
 * Batched coordinator report-back queue and settlement artifact/diff collection for `runner.js`.
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { compactOutputSummary, formatCoordinatorReportReceipt } from './runner-prompts.js';
import { workerIsLive } from './schema.js';

const DEFAULT_NOTIFY_BATCH_MS = 1_500;
const MAX_NOTIFIED_REVISIONS = 500;

/**
 * @param {{
 *   store: any,
 *   worktree: any,
 *   library?: any,
 *   getService: (name: string) => any,
 *   resolveCoordinatorAgent: (project: any) => Promise<any>,
 *   notifyBatchMs?: number,
 * }} deps
 */
export function createReportDispatcher({
  store,
  worktree,
  library = null,
  getService,
  resolveCoordinatorAgent,
  notifyBatchMs = DEFAULT_NOTIFY_BATCH_MS,
}) {
  /** @type {Map<string, { timer: any, items: Map<string, any> }>} */
  const pendingReports = new Map();
  /** @type {Set<string>} */
  const notifiedRevisions = new Set();
  let disposed = false;

  /** @param {string} revKey */
  function recordNotifiedRevision(revKey) {
    if (notifiedRevisions.has(revKey)) return false;
    notifiedRevisions.add(revKey);
    if (notifiedRevisions.size > MAX_NOTIFIED_REVISIONS) {
      const oldest = notifiedRevisions.values().next().value;
      if (oldest !== undefined) notifiedRevisions.delete(oldest);
    }
    return true;
  }

  /**
   * @param {any} project
   * @param {any[]} items
   * @param {boolean} allSettled
   */
  async function deliverCoordinatorReport(project, items, allSettled) {
    const sid = typeof project?.coordinatorSessionId === 'string' ? project.coordinatorSessionId.trim() : '';
    if (!sid || disposed) return false;
    const receiptText = formatCoordinatorReportReceipt(project, items, allSettled);
    const taskIds = items.map((item) => item.taskId);
    const requestId = `dsh-project-report:${project.id}:${taskIds.join(',')}:${items.map((item) => item.settledAt).join(',')}`.slice(0, 180);

    const controller = getService('sessionController');
    if (typeof controller?.prompt === 'function') {
      try {
        await controller.prompt(
          {
            sessionId: sid,
            requestId,
            mode: 'queue',
            content: [{ type: 'text', text: receiptText }],
          },
          new AbortController().signal,
        );
        return true;
      } catch {
        // Fall through to live coordinator.followup fallback.
      }
    }

    const coordinator = await resolveCoordinatorAgent(project);
    if (typeof coordinator?.followup === 'function') {
      try {
        const message = createUserMessage({
          content: [{ type: 'text', text: receiptText }],
          source: {
            kind: 'user',
            form: 'relay',
            plugin: 'dsh-project:worker-report',
            projectId: project.id,
            taskIds,
          },
        });
        await coordinator.followup(message);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** @param {string} projectId */
  async function flushCoordinatorReports(projectId) {
    const bucket = pendingReports.get(projectId);
    if (!bucket) return;
    clearTimeout(bucket.timer);
    pendingReports.delete(projectId);
    if (disposed || bucket.items.size === 0) return;

    let project;
    try {
      project = await store.readProject(projectId);
    } catch {
      return;
    }
    if (project.archived || project.paused || !project.coordinatorSessionId) return;

    const items = [...bucket.items.values()];
    const allSettled = !(project.tasks || []).some(
      /** @param {any} candidate */ (candidate) =>
        workerIsLive(candidate)
        || candidate.status === 'running'
        || (candidate.status === 'queued' && (project.autonomy === 'auto' || candidate.approved === true)),
    );

    const delivered = await deliverCoordinatorReport(project, items, allSettled);
    if (delivered) {
      store.emitChange({
        type: 'coordinator.notified',
        projectId,
        taskIds: items.map((item) => item.taskId),
        allSettled,
      });
    }
  }

  /** @param {any} project @param {any} task */
  async function collectSettlementArtifactsAndDiff(project, task) {
    let changedFiles = 0;
    let mergeability = null;
    /** @type {string[]} */
    let artifactPaths = [];

    if (task.worktreePath || (task.status === 'review' && project.workspace)) {
      try {
        const diff = await worktree.getTaskDiff(project, task);
        if (diff && diff.available) {
          changedFiles = Array.isArray(diff.files) ? diff.files.length : 0;
          mergeability = diff.mergeability || null;
          if (task.status === 'review' && library && changedFiles > 0 && task.worktreePath) {
            await library.collectWorktreeArtifacts(project, task, diff.files);
          }
        }
      } catch {
        // Diff/artifact collection is best-effort and never blocks settlement.
      }
    }

    if (library) {
      try {
        const lib = await library.readLibrary(project);
        artifactPaths = (lib.artifacts || [])
          .filter(/** @param {any} entry */ (entry) => entry.taskId === task.id)
          .map(/** @param {any} entry */ (entry) => entry.relativePath || entry.title)
          .filter(Boolean);
      } catch {
        artifactPaths = [];
      }
    }

    return { changedFiles, mergeability, artifactPaths };
  }

  /** @param {any} project @param {any} task */
  async function enqueueCoordinatorReport(project, task) {
    if (disposed || !project || !task) return;
    if (!['review', 'failed', 'blocked'].includes(task.status)) return;
    if (task.stopReason === 'stopped_by_user' || task.stopReason === 'interrupted_by_restart') return;

    // Always collect review artifacts & diff metadata even when coordinatorSessionId is absent or paused.
    const { changedFiles, mergeability, artifactPaths } = await collectSettlementArtifactsAndDiff(project, task);
    if (disposed) return;
    if (project.archived || project.paused || !project.coordinatorSessionId) return;

    const settledAt = Number(task.finishedAt || task.updatedAt) || Date.now();
    const revKey = `${project.id}:${task.id}:${settledAt}`;
    if (!recordNotifiedRevision(revKey)) return;

    let bucket = pendingReports.get(project.id);
    if (!bucket) {
      const delay = Math.max(0, Number(notifyBatchMs) || 0);
      const timer = setTimeout(() => {
        void flushCoordinatorReports(project.id).catch(() => {
          // Best-effort batched coordinator report-back.
        });
      }, delay);
      timer.unref?.();
      bucket = { timer, items: new Map() };
      pendingReports.set(project.id, bucket);
    }

    bucket.items.set(task.id, {
      taskId: task.id,
      title: task.title,
      status: task.status,
      stopReason: task.stopReason || '',
      summary: compactOutputSummary(task.output),
      changedFiles,
      mergeability,
      artifacts: artifactPaths,
      settledAt,
    });
  }

  function dispose() {
    disposed = true;
    for (const bucket of pendingReports.values()) {
      clearTimeout(bucket.timer);
    }
    pendingReports.clear();
    notifiedRevisions.clear();
  }

  return { enqueueCoordinatorReport, dispose };
}
