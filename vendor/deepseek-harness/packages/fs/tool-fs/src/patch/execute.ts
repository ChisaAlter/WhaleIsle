/** Sequential provider commits with truthful partial results and uncertainty checks. */
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { FsSandboxController } from '../sandbox.ts'
import { destinationIntent, mutationTargets, patchFailure, sourceIntent } from './plan.ts'
import type { PatchExecutionReport, PatchOperationOutcome, PlannedOperation } from './types.ts'

interface BeforeTarget {
  target: FsTarget
  info: FsInfo | undefined
}

interface TargetSnapshot {
  readonly target: FsTarget
  readonly existed: boolean
  readonly content: string | undefined
}

interface CompletedRollback {
  readonly index: number
  readonly snapshots: readonly TargetSnapshot[]
}

async function captureSnapshots(
  ctx: Context, before: readonly BeforeTarget[], signal: AbortSignal,
): Promise<TargetSnapshot[]> {
  const snapshots: TargetSnapshot[] = []
  for (const entry of before) {
    if (entry.info === undefined || entry.info.type !== 'file') {
      snapshots.push({ target: entry.target, existed: false, content: undefined })
    } else {
      snapshots.push({
        target: entry.target,
        existed: true,
        content: await ctx.fs.readText(entry.target, signal),
      })
    }
  }
  return snapshots
}

async function restoreTarget(
  ctx: Context, exec: ToolExecution, policy: SandboxExecutionPolicy | undefined, snapshot: TargetSnapshot,
): Promise<boolean> {
  try {
    if (snapshot.existed) {
      const outcome = await ctx.fs.writeText(snapshot.target, snapshot.content ?? '', undefined, undefined, policy)
      ctx.emit('fs/observed', snapshot.target, { kind: 'present', version: outcome.version }, exec)
      return true
    }
    await ctx.fs.deleteFile(snapshot.target, undefined, undefined, policy)
    ctx.emit('fs/observed', snapshot.target, { kind: 'absent' }, exec)
    return true
  } catch (error) {
    if (!(error instanceof FsError)) throw error
    if (!snapshot.existed && error.code === 'FS_NOT_FOUND') {
      // Target is already absent on disk; emit accurate absence state.
      ctx.emit('fs/observed', snapshot.target, { kind: 'absent' }, exec)
      return true
    }
    // Best-effort rollback continues across remaining targets and operations.
    return false
  }
}

async function rollbackCompleted(
  ctx: Context, exec: ToolExecution, policy: SandboxExecutionPolicy | undefined,
  completed: readonly CompletedRollback[], outcomes: PatchOperationOutcome[],
): Promise<void> {
  for (let i = completed.length - 1; i >= 0; i--) {
    const item = completed[i]
    if (item === undefined) continue
    let restored = true
    for (const snapshot of item.snapshots) {
      if (!await restoreTarget(ctx, exec, policy, snapshot)) restored = false
    }
    const prior = outcomes[item.index]
    if (restored && prior !== undefined) {
      outcomes[item.index] = { status: 'skipped', operation: prior.operation }
    }
  }
}

async function unchanged(ctx: Context, before: readonly BeforeTarget[]): Promise<boolean> {
  try {
    for (const entry of before) {
      // An aborted tool signal must not cancel the independent outcome check.
      const after = await ctx.fs.stat(entry.target)
      if (after?.version !== entry.info?.version) return false
    }
    return true
  } catch (error) {
    if (!(error instanceof FsError)) throw error
    return false
  }
}

/**
 * Commit a fully admitted plan. When a later operation (`index > 0`) fails with
 * a deterministic (`!uncertain`) error, best-effort rollback reverts prior
 * completed operations in reverse order and re-emits accurate `fs/observed` state.
 * @param ctx - provider and observation dispatcher.
 * @param sandbox - existing model-facing denial mapper.
 * @param exec - session actor and cancellation signal.
 * @param policy - request's resolved confinement policy.
 * @param operations - operations that all passed preflight.
 * @returns known changes, failed or unknown effects, and skipped or rolled-back entries.
 */
export async function commitPatch(
  ctx: Context, sandbox: FsSandboxController, exec: ToolExecution, policy: SandboxExecutionPolicy | undefined,
  operations: readonly PlannedOperation[],
): Promise<PatchExecutionReport> {
  const outcomes: PatchOperationOutcome[] = operations.map(operation => ({ status: 'skipped', operation: operation.record }))
  const completed: CompletedRollback[] = []
  let cancelled = false
  for (const [index, operation] of operations.entries()) {
    if (exec.signal.aborted) { cancelled = true; break }
    let started = false
    let before: BeforeTarget[] = []
    let failurePath = operation.target.displayPath
    const target = operation.target
    const record = operation.record
    let outcome: PatchOperationOutcome
    try {
      before = await Promise.all(mutationTargets(operation).map(async target => ({ target, info: await ctx.fs.stat(target, exec.signal) })))
      const snapshots = index < operations.length - 1 ? await captureSnapshots(ctx, before, exec.signal) : []
      switch (operation.kind) {
        case 'add': {
          const intent = await destinationIntent(ctx, exec, target)
          started = true
          const result = await ctx.fs.writeText(target, operation.content, intent, exec.signal, policy)
          ctx.emit('fs/observed', target, { kind: 'present', version: result.version }, exec)
          outcome = { status: 'completed', operation: record, changes: [{ path: ctx.fs.processPath(target), before: result.before, after: result.after }] }
          break
        }
        case 'update': {
          const intent = await sourceIntent(ctx, exec, target, 'edit')
          started = true
          const result = await ctx.fs.patchText(target, operation.hunks, intent, exec.signal, policy)
          ctx.emit('fs/observed', target, { kind: 'present', version: result.version }, exec)
          outcome = { status: 'completed', operation: record, changes: [{ path: ctx.fs.processPath(target), before: result.before, after: result.after }] }
          break
        }
        case 'delete': {
          const intent = await sourceIntent(ctx, exec, target, 'delete')
          started = true
          const result = await ctx.fs.deleteFile(target, intent, exec.signal, policy)
          ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
          outcome = { status: 'completed', operation: record, changes: [{ path: ctx.fs.processPath(target), before: result.before, after: null }] }
          break
        }
        case 'move': {
          const expectedSource = await sourceIntent(ctx, exec, target, 'edit')
          failurePath = operation.destination.displayPath
          const expectedDestination = await destinationIntent(ctx, exec, operation.destination)
          started = true
          const result = await ctx.fs.moveFile(target, operation.destination, {
            hunks: operation.hunks,
            ...(expectedSource === undefined ? {} : { expectedSource }),
            ...(expectedDestination === undefined ? {} : { expectedDestination }),
          }, exec.signal, policy)
          const changes = [{ path: ctx.fs.processPath(operation.destination),
            before: result.destination.before, after: result.destination.after }]
          ctx.emit('fs/observed', operation.destination, { kind: 'present', version: result.destination.version }, exec)
          if (result.sourceDeleted) {
            ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
            outcome = { status: 'completed', operation: record, changes: [...changes, { path: ctx.fs.processPath(target), before: result.sourceBefore, after: null }] }
          } else {
            const error = new FsError(result.sourceFailure.message, result.sourceFailure.code)
            outcome = { status: 'failed', operation: record, failure: patchFailure(sandbox, policy, error, target.displayPath), changes }
          }
          break
        }
        /* v8 ignore next -- Closed parsed-operation union; assertNever checks exhaustiveness at compile time. */
        default: assertNever(operation)
      }
      if (outcome.status === 'completed' && snapshots.length > 0) {
        completed.push({ index, snapshots })
      }
    } catch (error) {
      if (!(error instanceof FsError)) throw error
      const failure = patchFailure(sandbox, policy, error, failurePath)
      // A cancelled remote request rejects while the provider may still be writing, so no
      // stat can settle an aborted mutation; an I/O failure is settled by unchanged versions.
      const uncertain = started && (error.code === 'FS_ABORTED' || (error.code === 'FS_IO_ERROR' && !await unchanged(ctx, before)))
      outcome = uncertain
        ? { status: 'unknown', operation: record, failure: { ...failure, message: `${failure.message} — re-read the affected files before retrying` } }
        : { status: 'failed', operation: record, failure, changes: [] }
      if (!uncertain && index > 0 && completed.length > 0) {
        await rollbackCompleted(ctx, exec, policy, completed, outcomes)
      }
    }
    outcomes[index] = outcome
    if (outcome.status !== 'completed') { cancelled = exec.signal.aborted; break }
  }
  const affectedPaths = [...new Set(outcomes.flatMap(outcome => 'changes' in outcome ? outcome.changes.map(change => change.path) : []))]
  return { phase: 'commit', outcomes, affectedPaths, cancelled }
}
