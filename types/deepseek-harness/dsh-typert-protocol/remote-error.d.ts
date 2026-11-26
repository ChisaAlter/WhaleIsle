/** The one Remote failure class shared by owners, the Gateway, and consumers. */
import { HarnessError } from '@deepseek-ai/dsh-error';
import type { RemoteErrorCode, RemoteErrorDetailsMap, RemoteFailure } from './types.ts';
/**
 * One Remote call failure: a `HarnessError` carrying its stable code and typed
 * details. Owners throw it at the failure point; the Host Gateway encodes it
 * onto the wire unchanged; the Client face rebuilds an instance for the
 * `RemoteResult` error branch, so `throw result.error` keeps throw semantics.
 * A tool body that throws it records `name: 'RemoteError'` and its Remote code
 * on `tool/result`. Discrimination is always by `code`, never by instanceof.
 */
export declare class RemoteError<Code extends RemoteErrorCode = RemoteErrorCode> extends HarnessError {
    readonly code: Code;
    readonly details: RemoteErrorDetailsMap[Code];
    /** Structural marker: cross-realm/bundle identification never uses instanceof. */
    readonly isDSHRemoteError: true;
    /**
     * @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
     * @param message - human diagnostic carried across the wire.
     * @param details - structured payload typed by the code.
     * @param options - standard Error options (`cause` survives in-process only).
     */
    constructor(code: Code, message: string, details: RemoteErrorDetailsMap[Code], options?: ErrorOptions);
}
/**
 * Structurally identify a RemoteError thrown across module or realm copies of
 * this class. Mechanism-internal: the Gateway and test assertions use it;
 * business code receives typed failures and never needs it.
 * @param value - a caught value.
 * @returns the failure when the marker matches, otherwise undefined.
 */
export declare function remoteErrorOf(value: unknown): RemoteFailure | undefined;
//# sourceMappingURL=remote-error.d.ts.map