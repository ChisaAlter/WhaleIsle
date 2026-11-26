/** Lazy assembly of generated Remote definitions using caller-supplied Zod; no runtime imports. */
import type { z } from 'zod';
import type { InvocationDescriptor, TypertRemoteInfo, TypertRemoteMethod, TypertRemoteSpec } from './types.ts';
type Method = TypertRemoteMethod<object, unknown> | TypertRemoteMethod<object, unknown, 'stream', unknown>;
/**
 * Retain one generated definition per endpoint without constructing parsers or projections.
 * The class instance builds its shared descriptor/method index on first access;
 * input schemas and JSON Schema projections are cached only when requested.
 * @param spec - compiler-produced method facts and Zod factories.
 * @param zod - the generated artifact's Zod runtime for named-input parsers.
 * @returns a lazy, mountable info instance with no registration or transport effects.
 */
export declare function createTypertRemoteInfo(spec: TypertRemoteSpec, zod: typeof z): TypertRemoteInfo;
/**
 * Narrow a Registry descriptor to its generated direct-method capabilities.
 * @param descriptor - a live descriptor, including possible source fallback or Context-only receivers.
 * @returns whether generated named input and direct invocation are available.
 */
export declare function isTypertRemoteMethod(descriptor: InvocationDescriptor): descriptor is Method;
export {};
//# sourceMappingURL=remote-info.d.ts.map