/** Tool definitions and scoped dispatch to plugin-owned executors. @module */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ScopeKey } from '@deepseek-ai/dsh-scope';
import type { ToolExecutor, ToolBatchInput, ToolBatchResult } from './executor.ts';
import './events.ts';
import type { ToolSchema } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition, ToolRestriction, ToolExecution, ToolGuard, ToolGuardDenial, ResolvedToolSet, ToolActivationContext, ToolRegistrationOptions } from './contracts.ts';
declare module '@deepseek-ai/dsh-system-prompt' {
    interface AssembleContext {
        /** Step-owned tool selection; absent when inspecting registered definitions. */
        toolSet?: ResolvedToolSet;
    }
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        /** Tool availability changes supplied by the tool registry. */
        'tool-registry': {
            kind: 'tool-registry';
        };
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        tools: ToolsService;
    }
}
/** Concrete tool registry and scoped executor dispatcher. */
export declare class ToolsService extends Service {
    static inject: string[];
    static Config: z<Schemastery.ObjectS<NoInfer<{
        mode: z<never, never, "plain">;
        maxParallelSubCalls: z<never, never, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        mode: z<never, never, "plain">;
        maxParallelSubCalls: z<never, never, "plain">;
    }>>, "plain">;
    private readonly layers;
    private readonly scoped;
    private root;
    private readonly guards;
    constructor(ctx: Context);
    /**
     * Register globally or in the calling agent scope. Scoped tools shadow
     * globals; duplicates within one layer and the reserved `run_code` name fail.
     * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
     * @param options - optional step-time activation condition.
     * @returns the exact disposer that unregisters the tool.
     */
    register(definition: ToolDefinition, options?: ToolRegistrationOptions): () => void;
    /**
     * Restrict global tools for the calling agent scope. Empty filters, unknown
     * names, scope-local names, and reserved transport names fail. Restrictions
     * intersect; scoped registrations remain visible.
     * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
     * @returns the exact disposer that lifts this restriction.
     */
    restrict(filter: ToolRestriction): () => void;
    /**
     * Resolve visible tools and pre-restriction names. Restrictions across the
     * scope chain intersect over inherited global and ancestor tools; the viewing
     * scope's own registrations remain exempt. Nearer registrations shadow
     * farther ones. Pre-restriction names support restriction and prompt-order validation.
     * @param scope - the viewing scope (the agent), or undefined for the global view.
     * @returns the complete derived view for that scope.
     */
    private view;
    /**
     * Look up a tool as one scope sees it (scoped
     * shadows global; a restricted-away global reads as absent). Presenters pass
     * the calling agent so the rendered card matches the definition that
     * actually executed.
     * @param name - the tool name as registered.
     * @param scope - the viewing scope (the agent); omitted = the global view.
     * @param toolSet - step admission; omit only to inspect registered definitions.
     * @returns the definition the scope resolves, or undefined when none is visible.
     */
    get(name: string, scope?: ScopeKey, toolSet?: ResolvedToolSet): ToolDefinition | undefined;
    /**
     * Resolve the definition a call may execute. With a step's admitted set, the
     * set decides; without one, conditional registrations are unavailable.
     * @param name - the tool name as registered.
     * @param scope - the calling agent; omitted = the global view.
     * @param toolSet - step admission, or omitted for a call outside a model step.
     * @returns the executable definition, or undefined when the call must fail as `UNKNOWN_TOOL`.
     */
    executable(name: string, scope?: ScopeKey, toolSet?: ResolvedToolSet): ToolDefinition | undefined;
    /**
     * Resolve conditions once for this step without changing shared registrations.
     * Cancellation or a rejected condition publishes no partial selection. Removed
     * registrations cannot be restored by a late condition result.
     * @param context - preparing agent, captured model selection, and cancellation.
     * @returns the complete selection; the caller disposes it after its tool batch settles.
     */
    resolve(context: ToolActivationContext): Promise<ResolvedToolSet>;
    /**
     * Read the visible capability definitions for descriptions and program bindings.
     * @param scope - viewing Agent or preset; omitted selects the global view.
     * @param toolSet - step admission; omit only to inspect registered definitions.
     * @returns definitions after scoped shadowing and restrictions, limited to the step's admission when given.
     */
    definitions(scope?: ScopeKey, toolSet?: ResolvedToolSet): readonly ToolDefinition[];
    /**
     * Project visible definitions onto the allowlisted model-facing schema fields,
     * excluding execution and presentation callbacks.
     * @param scope - the viewing scope (the agent); omitted = the global view.
     * @param toolSet - step admission, or omitted for registered-definition inspection.
     * @returns one deep-cloned schema per visible tool.
     */
    schemas(scope?: ScopeKey, toolSet?: ResolvedToolSet): ToolSchema[];
    /**
     * Provide the executor for the calling scope; an unscoped contribution is the deployment default.
     * Rendering any executor-owned section requires the viewing scope's selection to remain available.
     * Disposal retires its sections; a replacement's same-name sections supersede those notices.
     * @param executor - initialized provider owned by the contributing plugin.
     * @returns the effect disposer. Unloading leaves the selection unavailable until it is replaced.
     */
    setExecutor(executor: ToolExecutor): () => void;
    /**
     * Resolve the nearest scoped provider, or the deployment default.
     * @param scope - Agent or preset scope; omitted selects only the root contribution.
     * @returns the selected executor; throws when it is missing or unloaded.
     */
    private selectExecutor;
    /**
     * Delegate a raw call batch to its Agent's provider or the deployment default.
     * Select at dispatch; accepted batches settle through that provider even if it unloads.
     * @param input - original calls, optional owning Agent, and optional logging step.
     * @returns the selected executor's settled batch; unavailable selections reject.
     */
    execute(input: ToolBatchInput): Promise<ToolBatchResult>;
    /**
     * Register a monotonic denial in the calling scope.
     * @param guard - evaluated after extensible pre-execute policy by the shared pipeline.
     * @returns the effect disposer that removes this guard.
     */
    guard(guard: ToolGuard): () => void;
    /**
     * Check global and inherited guards after pre-execute policy and approval resolve.
     * @param exec - invocation whose guards are checked before dispatch.
     * @returns the first denial with its optional structured identity, or undefined when no guard denies.
     */
    checkGuards(exec: ToolExecution): ToolGuardDenial | undefined;
}
export default ToolsService;
export * from './contracts.ts';
export * from './executor.ts';
export * from './schema.ts';
export * from './json-schema.ts';
export * from './presentation.ts';
export { ToolsService as ToolRuntime };
//# sourceMappingURL=index.d.ts.map