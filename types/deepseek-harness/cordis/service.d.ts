import { Context } from './context.ts';
import { symbols } from './utils.ts';
/**
 * Base class for services that expose a named API on `ctx`.
 *
 * Subclasses call `super(ctx, name)` from their constructor. The service is
 * registered immediately and is automatically removed with the owning fiber.
 */
export declare abstract class Service<out T = never> {
    protected ctx: Context;
    /** Symbol key of an instance method run after construction (class plugins). */
    static readonly init: unique symbol;
    /** Symbol key of the availability predicate passed to `ctx.provide()`. */
    static readonly check: unique symbol;
    /** Symbol key of the call body making a service callable (e.g. `ctx.logger()`). */
    static readonly invoke: unique symbol;
    /** Symbol key of the phantom intercept-metadata type parameter. */
    static readonly metadata: unique symbol;
    /** Symbol key of the helper deriving an extended service instance. */
    static readonly extend: unique symbol;
    /** Symbol key of the tracker metadata used for context tracing. */
    static readonly tracker: unique symbol;
    /** Symbol key of the intercept-metadata merge hook below. */
    static readonly mergeIntercept: unique symbol;
    /** Symbol key of the intercept-metadata resolution helper below. */
    static readonly resolveIntercept: unique symbol;
    [symbols.metadata]: T;
    /** The service name this instance is registered under. */
    name: string;
    /**
     * Register this instance as `name` in the current context.
     *
     * Calls `ctx.reflect.provide(name, this, this[Service.check])`, so the
     * service is unregistered automatically when the owning fiber unloads.
     * Services with a `[Service.invoke]` body return a callable instance.
     *
     * @param ctx — the context to register in (stored as `this.ctx`).
     * @param name — the service name; defaults to the static `provide` field.
     */
    constructor(ctx: Context, name: string);
    protected [symbols.filter](ctx: Context): boolean;
    protected [symbols.extend](props?: any): any;
    /**
     * Merge intercept metadata values, lowest precedence first.
     *
     * Override to customize merging; the default is a shallow `Object.assign`.
     *
     * @param values — the metadata values in increasing precedence.
     * @returns the merged metadata.
     */
    [symbols.mergeIntercept](...values: T[]): T;
    /**
     * Resolve the intercept metadata visible to the current caller.
     *
     * The metadata injected by the fiber that admits the access applies first,
     * then intercepts added by ancestor contexts, closest to the root first.
     * The values are combined with `[Service.mergeIntercept]`.
     *
     * @returns the merged metadata.
     */
    [symbols.resolveIntercept](): T;
    static [Symbol.hasInstance](instance: any): boolean;
}
//# sourceMappingURL=service.d.ts.map