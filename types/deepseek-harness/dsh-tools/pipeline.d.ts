/** Shared tool invocation policy, cancellation, and result settlement. @module */
import type { Context } from '@deepseek-ai/cordis';
import type { ScopeKey } from '@deepseek-ai/dsh-scope';
import type { ResolvedToolSet, ToolDefinition, ToolExecutionInput, ToolExecutionMode, ToolRunContext, ToolExecutionResult } from './contracts.ts';
/** Executor-owned lookup and restrictions applied before extensible execution policy. */
export interface ToolExecutionSource {
    /**
     * Override registry lookup for executor-owned capabilities; omitted uses the
     * retained registry's executable lookup, which applies the call's step admission.
     */
    get?(name: string, scope?: ScopeKey, toolSet?: ResolvedToolSet): ToolDefinition | undefined;
    /** Reject an otherwise visible invocation before policy; omitted permits it. */
    reject?(name: string, nested: boolean): Error | undefined;
}
/** Prepared invocation; immediate results carry their post-execute requirement. */
export type ScheduledToolPreparation = {
    kind: 'dispatch';
    exec: ToolRunContext;
} | ({
    exec: ToolRunContext;
} & ScheduledToolDispatch);
/** A `post-result` receives post-execute; a `final-result` bypasses it. */
export type ScheduledToolDispatch = {
    kind: 'post-result';
    result: ToolExecutionResult;
} | {
    kind: 'final-result';
    result: ToolExecutionResult;
};
/**
 * Shared invocation stages for batch and program schedulers. Schedulers order
 * prepare and complete calls while dispatch may overlap. Use executeToolBatch
 * for complete calls, including a single-call batch.
 */
export declare class ToolExecutionPipeline {
    private readonly ctx;
    private readonly source;
    private readonly tools;
    constructor(ctx: Context, source?: ToolExecutionSource);
    private get;
    private resolveExecution;
    /** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
    private deferredContexts;
    /** Executions whose tool body declared the current turn complete. */
    private concludingExecutions;
    /** Original caller cancellation, kept outside the wrapper-mutable execution object. */
    private cancellationStates;
    /** Definition-owned final content transform snapshotted before policy begins. */
    private contentFinalizers;
    /** Execution-prepared content installed before post-execute policy. */
    private contentProjectors;
    /**
     * Classify a pending call through the caller's visible tool definition. Only
     * an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
     * throwing classifiers are exclusive.
     * @param exec - call name, parsed arguments, and optional agent scope.
     * @returns the fail-closed scheduling mode.
     */
    executionMode(exec: ToolExecutionInput): ToolExecutionMode;
    private createExecution;
    /**
     * Snapshot input, assign its correlation token, and run ordered pre-execute
     * policy and guards. Cancellation skips a body that has not started.
     * @param input - the caller-supplied execution input.
     * @returns the prepared execution plus the next scheduler stage.
     */
    prepare(input: ToolExecutionInput): Promise<ScheduledToolPreparation>;
    /** Whether the original caller signal is currently aborted. */
    private callerCancelled;
    /** Canonical cancellation outcome selected by whether the tool body started. */
    private cancellationResult;
    /**
     * Dispatch the registered body with the original caller signal fused back
     * into any around-wrapper replacement. Cancellation never abandons the body:
     * a started promise reaches quiescence before its outcome becomes `ABORTED`.
     * After cancellation, a thrown signal reason or an `Error` named
     * `AbortError` without `HarnessError` identity keeps its message and gains
     * the `ABORTED` identity, whichever operation inside the body aborted; a
     * thrown `HarnessError` and any other failure stay unchanged.
     */
    private dispatchToolBody;
    /**
     * Run around-dispatch and the tool body. Tool and unknown-tool failures still
     * receive post-execute; pipeline failures are already final. Started bodies
     * drain on cancellation before a successful outcome becomes `ABORTED`. After
     * caller cancellation, a wrapper that throws the caller signal's reason or an
     * `Error` named `AbortError` without `HarnessError` identity keeps its message
     * and gains `ABORTED`, or `ABORTED_BEFORE_DISPATCH` when the body never
     * started; a wrapper's `HarnessError` and other failures stay unchanged.
     * @param exec - the execution returned by this pipeline's prepare stage.
     * @returns whether the result still needs post-execute.
     */
    dispatch(exec: ToolRunContext): Promise<ScheduledToolDispatch>;
    /** Classify a failure thrown around dispatch; see {@link dispatch}. */
    private wrapperFailureResult;
    /**
     * Run post-execute when required, apply definition-owned content finalization,
     * and publish the lossless, frozen result. Policy and finalization failures
     * become error results. Cancellation replaces a successful outcome before
     * final materialization; tool-owned errors remain intact.
     * @param exec - the execution returned by this pipeline's prepare stage.
     * @param outcome - the preparation or dispatch result awaiting completion.
     * @returns the same materialized result delivered to final observers.
     */
    complete(exec: ToolRunContext, outcome: ScheduledToolDispatch): Promise<ToolExecutionResult>;
    /**
     * Materialize the candidate, apply definition-owned content finalization,
     * then materialize and notify the authoritative result.
     * @param exec - the prepared execution.
     * @param result - final result.
     * @returns the materialized final result.
     * @internal
     */
    private finish;
    /** Apply the snapshotted tool-owned content transform without exposing other result fields. */
    private applyFinalContent;
    /** Notify observers without exposing a mutation or error channel into the outcome. */
    private notifyResult;
    /**
     * Resolve an `ask` decision to allow/deny through the approval seam. The
     * seam is consumed opportunistically with `ctx.get('approval')` — a
     * deployment that composes no ApprovalService keeps the historical degrade
     * to deny, and an unmount mid-session degrades the same way on the next ask.
     * An agent-less execution also degrades: without an agent there is no
     * session to audit to and no UI to route to. Otherwise the outcome maps
     * one-to-one — `allowed-once` proceeds; the three non-grants deny with
     * distinct reasons so the model can tell a human "no" from an absent
     * approval channel. Every denial carries `ApprovalError` with
     * `APPROVAL_REJECTED`, `APPROVAL_CANCELLED`, or `APPROVAL_UNAVAILABLE`.
     */
    private serviceAsk;
    /**
     * Run the `tools/post-execute` waterfall over a dispatched `result` and apply
     * its {@link PostToolDecision}: `accept` keeps the call successful (replacing
     * `content` when given), `block` turns it into an `isError` whose content is
     * the corrective `feedback`. Either decision may attach `additionalContexts`,
     * which are ferried on the returned result for the loop's active-batch FIFO.
     * Context deferred by the tool body survives an accepted result but is
     * discarded when the outer call is blocked; a block exposes only context the
     * blocking decision explicitly supplied.
     * Runs inside `execute`'s outer try/catch (a throwing listener → isError).
     */
    private postExecute;
    /** Registry-normalized results and the exact dispatch that validated each value. */
    private readonly canonicalResults;
    /** Mark one registry-normalized result as canonical only for its owning dispatch. */
    private markCanonical;
    /** Snapshot, validate, render, and optionally project one successful body value. */
    private createSuccessResult;
    /** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
    private normalizeDispatchResult;
    /** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
    private materializeFinalResult;
}
/**
 * Best-effort human-readable message from an arbitrary thrown value: Error
 * instances use `.message`; non-Error objects with a string `message`
 * property (e.g. `throw { message: 'denied' }`) use it too; everything else
 * is stringified.
 * @param error - thrown value from a tool or policy callback.
 * @returns a printable failure message, including for hostile thrown values.
 */
export declare function toolErrorMessage(error: unknown): string;
export { executeToolBatch } from './batch.ts';
//# sourceMappingURL=pipeline.d.ts.map