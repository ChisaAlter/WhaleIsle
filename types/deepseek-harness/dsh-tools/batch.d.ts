/**
 * Schedules one assistant step's tool calls. Exclusive calls form barriers;
 * parallel calls use a bounded rolling pool and are reclassified before start.
 * Dispatch may overlap, while policy, results, and result context remain
 * model-ordered. Abort or an internal scheduler failure stops replenishment
 * and drains started calls.
 *
 * Abort records synthetic error results for skipped calls so replay stays
 * valid. A terminal scheduler failure rejects after draining; the owning step
 * records conservative recovery results before closing.
 * @module dsh-tools/batch
 */
import type { ToolBatchInput, ToolBatchResult } from './executor.ts';
import type { ToolExecutionPipeline } from './pipeline.ts';
/** Default bound in milliseconds for draining started tool dispatches after abort. */
export declare const DEFAULT_ABORT_DRAIN_TIMEOUT_MS = 5000;
/** Scheduler overrides for executing a batch of tool calls. */
export interface ExecuteToolBatchOptions {
    /**
     * Maximum milliseconds to wait for already-dispatched tool bodies to settle
     * once `signal` aborts. Unsettled calls are detached and recorded with
     * {@link TOOL_ABORTED}. Defaults to {@link DEFAULT_ABORT_DRAIN_TIMEOUT_MS}.
     */
    readonly abortDrainTimeoutMs?: number;
}
/**
 * Execute raw calls with ordered policy and results around overlapping tool bodies.
 * Abort drains started calls and synthesizes results for skipped calls. Internal
 * failures drain before rejecting with the already committed results and context.
 * @param input - raw calls, optional concurrency override, and optional Session owner.
 * @param pipeline - executor-owned invocation implementation.
 * @param maxParallel - reads the executor's current validated limit when input has no override.
 * @param options - optional scheduler overrides such as {@link ExecuteToolBatchOptions.abortDrainTimeoutMs}.
 * @returns model-ordered outcomes after every started body has settled, or after
 *   {@link ExecuteToolBatchOptions.abortDrainTimeoutMs} detaches hung calls on abort.
 * @throws RangeError when the explicit concurrency override or abort drain timeout is invalid.
 */
export declare function executeToolBatch(input: ToolBatchInput, pipeline: ToolExecutionPipeline, maxParallel: () => number, options?: ExecuteToolBatchOptions): Promise<ToolBatchResult>;
//# sourceMappingURL=batch.d.ts.map