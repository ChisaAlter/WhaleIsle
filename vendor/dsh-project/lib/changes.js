/** Git change tracking, controlled snapshot refs, overlap-safe revert and worktree cleanup. */
import { samePath } from './files.js';

const copy = value => structuredClone(value);
const readOnly = scope => scope === 'readonly' || scope === 'research';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export function changeWorkspaces(service, row) {
  if (!row.changes) return [];
  // Catalogs written before per-workspace tracking used the bound directory.
  return row.changes.workspaces ?? [{ ...row.changes, workingDirectory: service.project(row.projectId).canonicalWorkingDirectory }];
}

export function changePayload(projectId, area) {
  return {
    projectId,
    workingDirectory: area.workingDirectory,
    ...(area.workstreamId ? { workstreamId: area.workstreamId, workspace: area.workspace } : {}),
  };
}

export function changeSummary(areas) {
  const git = areas.filter(area => area.isGit);
  const files = git.flatMap(area => (area.files ?? []).map(file => ({
    ...file,
    ...(areas.length > 1 ? { workingDirectory: area.workingDirectory } : {}),
  })));
  return {
    isGit: git.length > 0,
    fileCount: git.reduce((sum, area) => sum + (area.fileCount ?? 0), 0),
    files: files.slice(0, 300),
    added: git.reduce((sum, area) => sum + (area.added ?? 0), 0),
    removed: git.reduce((sum, area) => sum + (area.removed ?? 0), 0),
  };
}

export function missingLegacyChangeWorkspaces(service, row) {
  if (!row.changes || row.changes.workspaces) return [];
  return [...new Set(service.state().workstreams.filter(work => work.projectId === row.projectId
    && work.delegations.some(receipt => receipt.source.requestId === row.id && !readOnly(receipt.scope) && receipt.runId))
    .map(work => service.worker(work.workerSessionId))
    .filter(worker => worker.mode === 'worktree' && worker.cwd)
    .map(worker => worker.cwd))];
}

export function legacyChangesError(directories) {
  return `The saved requirement snapshot did not record these isolated execution directories:\n${directories.join('\n')}\nAsk the coordinator to inspect the original work before reverting; their missing starting points cannot be reconstructed by taking a new snapshot.`;
}

export function changesRevertible(service, row) {
  const areas = changeWorkspaces(service, row);
  return !(row.changes?.isolated && !row.changes.workspaces)
    && !missingLegacyChangeWorkspaces(service, row).length
    && areas.length > 0
    && areas.every(area => area.isGit && area.baseline && area.end)
    && areas.some(area => !area.revertedAt);
}

function areaOverlapsTarget(otherArea, area, targetStart, targetEnd) {
  if (!otherArea.isGit || otherArea.revertedAt) return false;
  if (!samePath(otherArea.workingDirectory, area.workingDirectory)) return false;
  const otherStart = otherArea.capturedAt;
  const otherEnd = otherArea.endedAt ?? Infinity;
  if (!(otherStart < targetEnd && otherEnd > targetStart)) return false;
  if (otherArea.endedAt && (otherArea.fileCount ?? otherArea.files?.length ?? 0) === 0) return false;
  return true;
}

/** Detect concurrent overlapping writes from another requirement in the same shared working directory. */
export function overlappingRequirementWriters(service, projectId, targetRow, area) {
  const targetStart = area.capturedAt, targetEnd = area.endedAt;
  if (!Number.isFinite(targetStart) || !Number.isFinite(targetEnd)) return [];
  const conflicts = [];
  for (const other of service.state().requests ?? []) {
    if (other.projectId !== projectId || other.id === targetRow.id || !other.changes || other.changes.revertedAt) continue;
    const hit = changeWorkspaces(service, other).find(otherArea => areaOverlapsTarget(otherArea, area, targetStart, targetEnd));
    if (hit) conflicts.push({ requestId: other.id, title: other.title, workingDirectory: hit.workingDirectory });
  }
  return conflicts;
}

export async function captureBaseline(service, projectId, requestId, worker) {
  return service.serial(async () => {
    const row = (service.state().requests ?? []).find(item => item.id === requestId && item.projectId === projectId);
    if (!row) return;
    const missing = missingLegacyChangeWorkspaces(service, row);
    if (missing.length) {
      service.ctx.logger.warn('Project baseline remains unavailable: %s', legacyChangesError(missing));
      return;
    }
    const workingDirectory = worker?.cwd || service.project(projectId).canonicalWorkingDirectory;
    if (!row.changes?.revertedAt && changeWorkspaces(service, row).some(area => samePath(area.workingDirectory, workingDirectory))) return;
    const scope = {
      workingDirectory,
      ...(worker ? { workstreamId: worker.workstreamId, ...(worker.workspace ? { workspace: copy(worker.workspace) } : {}) } : {}),
    };
    let snapshot, error;
    try { snapshot = await service.desktop('baseline', changePayload(projectId, scope, requestId)); }
    catch (failure) {
      error = failure.message;
      snapshot = { isGit: false };
      service.ctx.logger.warn('Project baseline could not be recorded: %s', error);
    }
    await service.write(state => {
      const item = state.requests.find(entry => entry.id === requestId);
      const capturedAt = Date.now();
      const area = {
        ...scope,
        isGit: snapshot.isGit,
        ...(snapshot.isGit ? { baseline: snapshot.tree, ...(snapshot.ref ? { baselineRef: snapshot.ref } : {}) } : {}),
        ...(error ? { error } : {}),
        capturedAt,
      };
      if (!worker && (!item.changes || item.changes.revertedAt)) {
        item.changes = {
          isGit: area.isGit,
          ...(area.baseline ? { baseline: area.baseline } : {}),
          ...(area.baselineRef ? { baselineRef: area.baselineRef } : {}),
          ...(error ? { error } : {}),
          capturedAt,
        };
      } else {
        const workspaces = item.changes?.revertedAt ? [] : changeWorkspaces(service, item);
        workspaces.push(area);
        item.changes = { isGit: workspaces.some(entry => entry.isGit), capturedAt: workspaces[0].capturedAt, workspaces };
      }
    });
  });
}

export async function captureDeliveryChanges(service, delivery) {
  const row = (service.state().requests ?? []).find(item => item.id === delivery.requestId);
  if (!row?.changes || row.changes.revertedAt || row.changes.deliveryId === delivery.id) return;
  if (missingLegacyChangeWorkspaces(service, row).length) return;
  if (row.revision !== delivery.requestRevision || (service.state().deliveries ?? []).findLast(item => item.requestId === row.id && ['draft', 'delivered'].includes(item.status))?.id !== delivery.id) return;
  const areas = changeWorkspaces(service, row).map(copy);
  for (const area of areas) {
    if (!area.isGit || !area.baseline || area.revertedAt) continue;
    const value = await service.desktop('changes', { ...changePayload(delivery.projectId, area, row.id), base: area.baseline });
    Object.assign(area, {
      end: value.end,
      ...(value.endRef ? { endRef: value.endRef } : {}),
      endedAt: Date.now(),
      files: value.files.slice(0, 300),
      fileCount: value.files.length,
      added: value.files.reduce((sum, file) => sum + file.added, 0),
      removed: value.files.reduce((sum, file) => sum + file.removed, 0),
    });
  }
  if (service.closing && !service.persistOnDispose) return;
  await service.write(state => {
    const changes = state.requests.find(item => item.id === row.id).changes;
    if (changes.workspaces) Object.assign(changes, changeSummary(areas), { workspaces: areas, endedAt: Date.now(), deliveryId: delivery.id });
    else {
      const { workingDirectory: _cwd, ...captured } = areas[0];
      Object.assign(changes, captured, { deliveryId: delivery.id });
    }
  });
}

export async function getRequestChanges(service, projectId, input, required) {
  const row = service.requirements.get(projectId, required(input.requestId, 'task identity', 200));
  const changes = row.changes;
  const scopes = changeWorkspaces(service, row);
  const legacyMissing = missingLegacyChangeWorkspaces(service, row);
  if (legacyMissing.length) fail('changes_unavailable', legacyChangesError(legacyMissing));
  const missing = scopes.filter(area => area.error);
  if (missing.length) fail('changes_unavailable', `The starting point could not be recorded for these directories:\n${missing.map(area => `${area.workingDirectory}: ${area.error}`).join('\n')}\nAsk the coordinator to inspect the actual work; no later snapshot can reconstruct those missing starting points.`);
  const areas = scopes.filter(area => area.isGit && area.baseline);
  if (!areas.length) fail('changes_unavailable', 'This requirement has no recorded starting point; view the directory changes instead.');
  const values = await Promise.all(areas.map(async area => ({
    area,
    value: await service.desktop('changes', {
      ...changePayload(projectId, area, row.id),
      base: area.baseline,
      ...(area.end ? { end: area.end } : {}),
      diff: true,
    }),
  })));
  return {
    files: values.flatMap(({ area, value }) => value.files.map(file => ({
      ...file,
      ...(areas.length > 1 ? { workingDirectory: area.workingDirectory } : {}),
    }))),
    diff: values.map(({ area, value }) => `${areas.length > 1 ? `# Working directory: ${area.workingDirectory}\n` : ''}${value.diff ?? ''}`).join('\n'),
    ...(changes.workspaces ? { workspaces: values.map(({ area, value }) => ({ workingDirectory: area.workingDirectory, files: value.files, diff: value.diff, truncated: value.truncated })) } : {}),
    truncated: values.some(({ value }) => value.truncated),
    final: areas.every(area => Boolean(area.end)),
    ...(changes.isolated ? { isolated: true } : {}),
    ...(changes.revertedAt ? { revertedAt: changes.revertedAt } : {}),
  };
}

function assertRevertPreconditions(service, projectId, row, input) {
  if (input.requestRevision !== undefined && Number(input.requestRevision) !== row.revision) {
    fail('stale_revision', `Requirement "${row.title}" is now at revision ${row.revision}; refresh before reverting.`);
  }
  const project = service.project(projectId), changes = row.changes;
  if (service.closing || project.lifecycle !== 'ready' || service.archiving.has(projectId)) {
    fail('unavailable', 'Restore this Project before reverting its changes.');
  }
  const missing = missingLegacyChangeWorkspaces(service, row);
  if (missing.length) fail('revert_unavailable', legacyChangesError(missing));
  const areas = changeWorkspaces(service, row);
  if (service.queue.busy(projectId) || areas.some(area => service.directoryInUse(area.workingDirectory))) {
    fail('busy', 'Background work is still running in this directory. Wait for it to finish or stop it before reverting.');
  }
  if (changes?.isolated && !changes.workspaces) {
    fail('revert_unavailable', 'Part of this requirement was developed in an isolated worktree, so its changes cannot be reverted from the Project directory.');
  }
  if (!changesRevertible(service, row) || changes.revertedAt) {
    fail('revert_unavailable', 'This requirement has no delivered changes that can be reverted.');
  }
  const pending = areas.filter(area => !area.revertedAt);
  for (const area of pending) {
    const concurrent = overlappingRequirementWriters(service, projectId, row, area);
    if (concurrent.length) {
      const names = concurrent.map(item => `"${item.title}" (${item.requestId})`).join(', ');
      fail('revert_conflict', `Another requirement (${names}) wrote in ${area.workingDirectory} during the same window; inspect and revert manually to avoid overwriting its changes.`);
    }
  }
  return { project, areas, pending };
}

export async function revertRequestChanges(service, projectId, input, required) {
  return service.serial(async () => {
    const row = service.requirements.get(projectId, required(input.requestId, 'task identity', 200));
    const { project, areas, pending } = assertRevertPreconditions(service, projectId, row, input);
    const apply = (area, checkOnly = false) => service.desktop('revert', {
      ...changePayload(projectId, area),
      base: area.baseline,
      end: area.end,
      ...(checkOnly ? { checkOnly: true } : {}),
    });
    try {
      if (pending.length > 1) for (const area of pending) {
        const checked = await apply(area, true);
        if (checked.conflict) fail('revert_conflict', checked.message || 'Files changed after delivery, so the revert does not apply cleanly.');
      }
      for (const area of pending) {
        const result = await apply(area);
        if (result.conflict) fail('revert_conflict', result.message || 'Files changed after delivery, so the revert does not apply cleanly.');
        if (!result.applied) fail('revert_unavailable', 'This requirement left no changes in the recorded directory to revert.');
        await service.write(state => {
          const item = state.requests.find(entry => entry.id === row.id), revertedAt = Date.now();
          if (item.changes.workspaces) {
            item.changes.workspaces.find(entry => samePath(entry.workingDirectory, area.workingDirectory)).revertedAt = revertedAt;
            if (item.changes.workspaces.every(entry => entry.revertedAt)) item.changes.revertedAt = revertedAt;
          } else item.changes.revertedAt = revertedAt;
          item.updatedAt = revertedAt;
        });
      }
    } catch (error) {
      const current = changeWorkspaces(service, service.requirements.get(projectId, row.id));
      const done = current.filter(area => area.revertedAt);
      if (done.length) {
        fail('revert_partial', `${error.message}\nReverted directories:\n${done.map(area => area.workingDirectory).join('\n')}\nNot reverted:\n${current.filter(area => !area.revertedAt).map(area => area.workingDirectory).join('\n')}\nResolve the remaining error, then retry to revert only the remaining directories.`);
      }
      throw error;
    }
    await service.appendDecision(project, {
      id: `revert-${row.id}-${areas.map(area => area.end.slice(0, 12)).join('-')}`,
      title: row.title,
      outcome: 'reverted',
      text: '用户撤销了这条需求带来的改动，相关文件已恢复到开始开发前的状态。',
    }).catch(error => service.ctx.logger.warn('Project decision log could not be updated: %s', error.message));
    await service.notes(projectId);
    return { requestId: row.id, reverted: true };
  });
}

function refsFromChanges(service, row) {
  const refsByDir = new Map();
  const add = (dir, ref) => {
    if (!dir || !ref || typeof ref !== 'string') return;
    if (!refsByDir.has(dir)) refsByDir.set(dir, new Set());
    refsByDir.get(dir).add(ref);
  };
  for (const area of changeWorkspaces(service, row)) {
    add(area.workingDirectory, area.baselineRef);
    add(area.workingDirectory, area.endRef);
  }
  const projectDir = service.project(row.projectId).canonicalWorkingDirectory;
  add(projectDir, row.changes?.baselineRef);
  add(projectDir, row.changes?.endRef);
  return refsByDir;
}

/** Release controlled Git snapshot refs owned by an archived or removed requirement. */
export async function releaseRequestSnapshots(service, projectId, row) {
  if (!row?.changes) return 0;
  const byDir = refsFromChanges(service, row);
  let released = 0;
  for (const [workingDirectory, refs] of byDir) {
    const list = [...refs];
    if (!list.length) continue;
    try {
      await service.desktop('release-snapshots', { projectId, workingDirectory, refs: list });
      released += list.length;
    } catch (error) {
      service.ctx.logger?.warn?.('Project snapshot refs could not be released: %s', error.message);
    }
  }
  return released;
}

/** Release all controlled snapshot refs for every request in a Project (during archive/cleanup/reset). */
export async function releaseProjectSnapshots(service, projectId, { onlyArchived = false } = {}) {
  let released = 0;
  for (const row of service.state().requests ?? []) {
    if (row.projectId !== projectId) continue;
    if (onlyArchived && !row.archivedAt && !row.changes?.revertedAt) continue;
    released += await releaseRequestSnapshots(service, projectId, row);
  }
  return released;
}

function isWorktreeEligibleForCleanup(service, projectId, worker, requests, onlyArchived) {
  if (worker.projectId !== projectId || worker.mode !== 'worktree' || !worker.workspace || worker.workspaceCleanedAt) return false;
  if (worker.activeRunId || ['active', 'provisioning', 'stopping'].includes(worker.phase)) return false;
  if (service.launches.has(worker.workstreamId) || service.jobs(worker.sessionId).length) return false;
  if (!onlyArchived) return true;
  const work = service.state().workstreams.find(item => item.id === worker.workstreamId);
  if (!work) return true;
  const requestId = work.delegations.at(-1)?.source?.requestId;
  const request = requestId ? requests.get(requestId) : undefined;
  return Boolean(work.archived || request?.archivedAt || request?.queue?.state === 'cancelled');
}

/** Reclaim Project-owned worktrees via desktop `cleanup-workspace` once their workers are idle/stopped. */
export async function cleanupProjectWorktrees(service, projectId, { onlyArchived = false } = {}) {
  const project = service.project(projectId);
  const requests = new Map((service.state().requests ?? []).filter(row => row.projectId === projectId).map(row => [row.id, row]));
  const cleaned = [];
  for (const worker of service.state().workers) {
    if (!isWorktreeEligibleForCleanup(service, projectId, worker, requests, onlyArchived)) continue;
    try {
      await service.desktop('cleanup-workspace', { projectId: project.id, workstreamId: worker.workstreamId, workspace: copy(worker.workspace) });
      cleaned.push(worker.workstreamId);
    } catch (error) {
      service.ctx.logger?.warn?.('Project worktree cleanup skipped for %s: %s', worker.workstreamId, error.message);
    }
  }
  if (cleaned.length) {
    const now = Date.now();
    await service.write(state => {
      for (const workstreamId of cleaned) {
        const row = state.workers.find(item => item.workstreamId === workstreamId && item.projectId === projectId);
        if (row) { row.workspaceCleanedAt = now; row.directoryHeld = false; row.updatedAt = now; }
      }
    });
  }
  return cleaned;
}
