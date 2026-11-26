/**
 * Remote decorators and explicit Gateway bindings backed by versioned
 * descriptors carried on decorated class prototypes. Strict reflection
 * remains a Typert compiler responsibility.
 * @module @deepseek-ai/dsh-typert-protocol
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { RemoteWireArgs, TypertContextMap, TypertResourceReader, TypertResourceReaders } from './types.ts';
export { RemoteError, remoteErrorOf } from './remote-error.ts';
export { TYPERT_OWNED_VALUE, isTypertOwnedValue, typertOwnedValue } from './owned-value.ts';
export type { TypertOwnedValue } from './owned-value.ts';
export { isRemoteJsonValue, isRemoteUplinkItem } from './json-value.ts';
export { createTypertRemoteInfo, isTypertRemoteMethod } from './remote-info.ts';
export { principalOf } from './principal.ts';
export type { RemoteAccessResource, RemoteAccessResourceKind, RemoteAccessResourceOf } from './remote-access.ts';
/**
 * Test one generated Remote name against the Connection endpoint grammar.
 * @param value - namespace, method, lookup, or Context segment.
 * @returns whether the value can cross the shared RPC carrier unchanged.
 */
export declare function isTypertRemoteSegment(value: string): boolean;
export type { InvocationDescriptor, InvocationParameterDescriptor, InvocationSourceLocation, PeerId, PeerScope, Principal, PrincipalMap, RemoteDecoded, RemoteErrorCode, RemoteErrorDetailsMap, RemoteFailure, RemoteInvocation, RemoteResult, RemoteStream, RemoteStreamHandle, RemoteUplinkWindow, RemoteWireArgs, RemoteWireValue, TypertClientEventListener, TypertClientRemote, TypertClientContextAdapter, TypertCodec, TypertContext, TypertContextMap, TypertContextRegistry, TypertContextWire, TypertDisposer, TypertForwardableEvent, TypertForwardableEventEntry, TypertHostContextAdapter, TypertHostContextResolver, TypertResource, TypertResourceDeclaration, TypertResourceEntry, TypertResourceId, TypertResourceKind, TypertResourceMap, TypertResourceReader, TypertResourceReaders, TypertResourceRegistry, TypertResourceResolveInput, TypertLocalRegistry, TypertLookup, TypertLookupDefinition, TypertLookupHost, TypertLookupMap, TypertLookupProvider, TypertLookupResolver, TypertLookupRegistry, TypertLookupWire, TypertRemoteScopeApi, TypertRemoteScopeMap, TypertRemoteScopeNamespace, TypertRemoteContribution, TypertRemoteInfo, TypertRemoteInputOptions, TypertRemoteMethod, TypertRemoteValue, TypertRemoteCodecSpec, TypertRemoteParameterSpec, TypertRemoteMethodSpec, TypertRemoteSpec, TypertRemoteEvent, TypertRemoteEventSelection, TypertRemoteMap, TypertRemoteNamespace, TypertRemoteNamespaceMap, TypertRemoteRegistry, TypertRegistryChange, TypertRegistryListener, TypertSchema, TypertRegistryContract, } from './types.ts';
/** Options for an explicit Service-to-Gateway binding. */
export interface TypertGatewayBindingOptions {
    /** Wire namespace; defaults to the Cordis service key. */
    readonly namespace?: string;
}
/** Visible declaration that one Service participates in Typert Gateway export. */
export interface TypertGatewayBinding<Service extends object = object> {
    readonly service: Service;
    readonly serviceKey: string;
    readonly namespace: string;
}
/** Invocation mode recorded by a Remote method decorator. */
export type RemoteInvocationMarker = {
    readonly kind: 'direct';
} | {
    readonly kind: 'context';
    readonly context: string;
};
/** One decorator marker discovered for a live Service instance. */
export interface RemoteMethodMarker {
    /** Public instance method carrying the implementation. */
    readonly method: string;
    /** Endpoint method when it differs from the implementation member. */
    readonly exportName?: string;
    /** Stream methods yield many independently validated result items. */
    readonly mode?: 'stream';
    readonly invocation: RemoteInvocationMarker;
    /**
     * Declared `resources` readers keyed by resource kind. Callers spread the
     * method's wire arguments into each one and validate its result.
     */
    readonly resources?: Readonly<Record<string, TypertResourceReader>>;
}
/**
 * Explicit endpoint and resource choices for one Remote Scope method.
 * @template WireArgs - the decorated method's positional parameters as the
 *   wire carries them; the default `never` admits readers of any tuple.
 */
export interface RemoteScopeOptions<WireArgs extends readonly unknown[] = never> {
    /** Exported endpoint method; omission retains the implementation member name. */
    readonly name?: string;
    /**
     * Per-kind readers of the resources one call touches. Each receives the
     * method's arguments as its own parameters, JSON arguments as their Typert
     * codecs validated them, a lookup parameter as its wire identity and a
     * cancellation parameter as the call's signal, so it performs plain reads
     * only, and returns one identity, several, or `undefined` for none. A
     * throw, an empty list, or an identity other than a non-empty string
     * refuses the call. For a kind without a reader, the Gateway reads the
     * identity of a scoped Context whose Host adapter declares that `resource`
     * and of lookup parameters declaring it, else the registered default of
     * `typert.resources`: a `resolve` function receiving the validated named
     * wire values and their ordered parameters, or a `field` naming a top-level
     * argument or, failing that, a field of the first object argument. A
     * throwing resolver, an array result, or a field holding an array refuses
     * the call. A call that carries no identity touches `global`. The readers
     * and these defaults together must name every resource the method accesses:
     * access control never checks a resource they omit.
     */
    readonly resources?: TypertResourceReaders<WireArgs>;
}
/**
 * Explicit endpoint, stream, and resource choices for one direct Remote method.
 * @template WireArgs - the decorated method's positional parameters as the
 *   wire carries them; the default `never` admits readers of any tuple.
 */
export interface RemoteMethodOptions<WireArgs extends readonly unknown[] = never> extends RemoteScopeOptions<WireArgs> {
    /** `stream`: deliver each Iterable item over the shared logical-stream carrier. */
    readonly mode?: 'stream';
}
/** A decorator whose `resources` readers were checked against the decorated method's parameters. */
type RemoteTypedMethodDecorator<This extends object, Args extends unknown[], Result> = (method: (this: This, ...args: Args) => Result, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>) => void;
type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(method: (this: This, ...args: Args) => Result, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>) => void;
/**
 * Bind one visible Service field to a Cordis key and Remote namespace. A
 * service that owns a Cordis Context also gives its tree `ctx.invocation`,
 * `undefined` outside a Remote call, so no `TypertRemoteService` is needed for
 * a Host composition to read it.
 * @param service - owning Service instance, normally `this`.
 * @param serviceKey - exact Cordis service key.
 * @param options - optional wire namespace.
 * @returns a frozen, inspectable binding with no compiler-injected metadata.
 */
export declare function bindTypertRemote<Service extends object>(service: Service, serviceKey: string, options?: TypertGatewayBindingOptions): TypertGatewayBinding<Service>;
/** Cordis Service base that exposes its registered name through Typert Gateway. */
export declare abstract class TypertRemoteService<out T = never> extends Service<T> {
    /** Visible binding consumed by the Gateway's source-mode discovery. */
    readonly typertRemote: TypertGatewayBinding<this>;
    /**
     * Register the Service and bind the same key to Typert Gateway.
     * @param ctx - owning Cordis Context.
     * @param serviceKey - exact Cordis service key and default wire namespace.
     * @param options - optional wire namespace.
     */
    protected constructor(ctx: Context, serviceKey: string, options?: TypertGatewayBindingOptions);
}
/**
 * Mark one public instance method as a direct Remote invocation.
 * @param _method - decorated method; retained only by the class itself.
 * @param context - standard decorator context used to schedule private marking.
 */
export declare function Remote<This extends object, Args extends unknown[], Result>(_method: (this: This, ...args: Args) => Result, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>): void;
/**
 * Mark one public instance method with an endpoint name.
 * @param name - exported endpoint method.
 * @returns a standard method decorator.
 */
export declare function Remote(name: string): RemoteMethodDecorator;
/**
 * Mark one public instance method with endpoint, stream, or resource options.
 * @param options - Remote options; each reader's parameters are inferred from the decorated method.
 * @returns a standard method decorator.
 */
export declare function Remote<This extends object, Args extends unknown[], Result>(options: NoInfer<RemoteMethodOptions<RemoteWireArgs<Args>>>): RemoteTypedMethodDecorator<This, Args, Result>;
/**
 * Create a decorator for a method resolved from one Remote Scope.
 * @param key - scope key declared through the Context map.
 * @param name - optional Remote export name; defaults to the method name.
 * @returns a standard method decorator that records a versioned prototype descriptor.
 */
export declare function RemoteScope(key: Extract<keyof TypertContextMap, string>, name?: string): RemoteMethodDecorator;
/**
 * Create a decorator for a Remote Scope method with endpoint or resource options.
 * @param key - scope key declared through the Context map.
 * @param options - Remote Scope options; each reader's parameters are inferred from the decorated method.
 * @returns a standard method decorator that records a versioned prototype descriptor.
 */
export declare function RemoteScope<This extends object, Args extends unknown[], Result>(key: Extract<keyof TypertContextMap, string>, options: NoInfer<RemoteScopeOptions<RemoteWireArgs<Args>>>): RemoteTypedMethodDecorator<This, Args, Result>;
/**
 * Read Remote markers attached to a live Service's class prototype.
 * The returned snapshot cannot mutate the stored descriptor.
 * @param service - live Service instance.
 * @returns markers in class declaration order.
 */
export declare function remoteMethods(service: object): readonly RemoteMethodMarker[];
//# sourceMappingURL=index.d.ts.map