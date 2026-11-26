/**
 * LLM failure codes and helpers over the shared Harness error base. The base
 * class lives in `@deepseek-ai/dsh-error` and is re-exported here, so both
 * import paths name the same class.
 * @module @deepseek-ai/dsh-llm/error
 */
import { HarnessError } from '@deepseek-ai/dsh-error';
export { HarnessError };
/**
 * Every failure code the built-in providers and the LLM runtime raise. An entry
 * marked `retryChoice` is offered as a choice for a provider retry policy's
 * `retryableCodes`; being a choice does not make a code retried by default.
 */
export declare const LLM_FAILURE_CODES: {
    readonly ABORTED: {};
    readonly ACCOUNT_QUOTA: {};
    readonly ACCOUNT_SIGN_IN_REQUIRED: {};
    readonly ACCOUNT_TOKEN_INVALID: {};
    readonly AUTH: {};
    readonly CLIENT_UPGRADE_REQUIRED: {};
    readonly CONTENT_REFUSED: {};
    readonly CONTEXT_WINDOW_EXCEEDED: {};
    readonly DISCOVERY_FAILED: {};
    readonly DISCOVERY_UNSUPPORTED: {};
    readonly DUPLICATE_ADAPTER: {};
    readonly DUPLICATE_DIRECTORY: {};
    readonly DUPLICATE_DISCOVERY: {};
    readonly EMPTY_RESPONSE: {
        readonly retryChoice: true;
    };
    readonly FILES_API: {};
    readonly IMAGE_OFFLOAD_REQUIRED: {};
    readonly INVALID_ADAPTER: {};
    readonly INVALID_CATALOG: {};
    readonly INVALID_CONFIG: {};
    readonly INVALID_CREDENTIAL: {};
    readonly INVALID_DIRECTORY: {};
    readonly INVALID_DISCOVERY: {};
    readonly INVALID_MODEL_CONTEXT: {};
    readonly INVALID_MODEL_INFO: {};
    readonly INVALID_MODEL_MAX_TOKENS: {};
    readonly INVALID_MODEL_REASONING: {};
    readonly INVALID_PREPARED_CALL: {};
    readonly INVALID_REPLAY_STATE: {};
    readonly INVALID_REQUEST: {};
    readonly INVALID_RESPONSE: {};
    readonly MALFORMED_RESPONSE: {
        readonly retryChoice: true;
    };
    readonly MISSING_CREDENTIAL: {};
    readonly MODEL_SWITCH_COMPACTION_FAILED: {};
    readonly MODEL_UNSUPPORTED: {};
    readonly NO_ADAPTER: {};
    readonly NO_CREDENTIAL_STORE: {};
    readonly NO_DISCOVERY: {};
    readonly PI_AI_ERROR: {};
    readonly QUOTA: {
        readonly retryChoice: true;
    };
    readonly RATE_LIMIT: {
        readonly retryChoice: true;
    };
    readonly REGISTRATION_DISPOSED: {};
    readonly REQUEST_EXTENSION: {};
    readonly REQUEST_HEADERS: {};
    readonly SERVER: {
        readonly retryChoice: true;
    };
    readonly STREAM_CLOSED: {
        readonly retryChoice: true;
    };
    readonly TIMEOUT: {
        readonly retryChoice: true;
    };
    readonly TRANSPORT: {
        readonly retryChoice: true;
    };
    readonly UNKNOWN: {};
    readonly UNKNOWN_MODEL: {};
    readonly UNSTORABLE_PROVIDER_ID: {};
    readonly UNSUPPORTED_CONTENT: {};
    readonly UNSUPPORTED_OPTION: {};
    readonly UNSUPPORTED_REASONING_EFFORT: {};
};
/** A failure code from {@link LLM_FAILURE_CODES}, or an unclassified provider HTTP status. */
export type BuiltinLlmFailureCode = keyof typeof LLM_FAILURE_CODES | `HTTP_${number}`;
/** The {@link LLM_FAILURE_CODES} entries marked as retry-policy choices, in definition order. */
export declare const RETRY_CODE_CHOICES: readonly BuiltinLlmFailureCode[];
/** Canonical provider-neutral code for a model request rejected because its context window was exceeded. */
export declare const CONTEXT_WINDOW_EXCEEDED_CODE = "CONTEXT_WINDOW_EXCEEDED";
/** Canonical provider-neutral code for an exhausted account quota or balance. */
export declare const QUOTA_EXCEEDED_CODE = "QUOTA";
/** Account-token quota that can be replenished through the first-party billing page. */
export declare const ACCOUNT_QUOTA_EXCEEDED_CODE = "ACCOUNT_QUOTA";
/**
 * Canonical provider-neutral code for a response that completed normally but
 * carried no content blocks at all. Providers occasionally emit a degenerate
 * completion (a terminal stop with zero output); adapters classify it as this
 * failure instead of yielding an empty assistant message, because an empty
 * message silently ends the turn with nothing for the user or the loop to act
 * on. The attempt produced nothing durable, so retry policy treats it as safe
 * to repeat.
 */
export declare const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
/**
 * Canonical provider-neutral code for a syntactically completed response that
 * violates the Harness protocol contract. The attempt contributes no durable
 * assistant message, so the default retry policy may safely repeat it.
 */
export declare const MALFORMED_RESPONSE_CODE = "MALFORMED_RESPONSE";
/**
 * Canonical provider-neutral code for a credential that was supplied but
 * cannot be used — malformed rather than absent. Distinct from
 * `MISSING_CREDENTIAL` because the fix differs: correct the stored value
 * rather than supply one. Deliberately outside the default retryable set —
 * a malformed credential fails identically on every attempt.
 */
export declare const INVALID_CREDENTIAL_CODE = "INVALID_CREDENTIAL";
/**
 * Recognize the context-overflow wording used by OpenAI-compatible providers
 * and library adapters. Adapters pass all available provider code, type, and
 * message text so both thrown and in-band delivery styles share one classifier.
 * @param detail - provider error code/type/message text joined into one string.
 * @returns true when the detail identifies a request exceeding the model context window.
 */
export declare function isContextWindowExceededError(detail: string): boolean;
/**
 * Recognize provider wording that identifies an exhausted account quota rather
 * than a transient request-rate limit.
 * @param detail - provider error code/type/message text joined into one string.
 * @returns true only for terminal quota, balance, credit, budget, or usage-limit wording.
 */
export declare function isQuotaExceededError(detail: string): boolean;
/**
 * Render a thrown value with its full `cause` chain and AggregateError
 * members, so transport wrappers like undici's `TypeError: fetch failed`
 * surface the underlying failure instead of masking it. Plain structured
 * failures render their own data-backed `message`. Diagnostic-surface
 * rendering only (messages, notices, logs) — never parse the result; route on
 * {@link HarnessError.code}.
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns the outermost message first, each cause appended with `: ` (skipped
 * when it repeats the wrapper message verbatim), and AggregateError members
 * bracketed and `; `-joined.
 */
export declare function errorChain(value: unknown): string;
/**
 * Narrow an arbitrary thrown value to a HarnessError (for `instanceof` at runtime boundaries).
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns true only for real instances; duck-typed or cross-realm errors do not narrow.
 */
export declare function isHarnessError(value: unknown): value is HarnessError;
/**
 * Canonical code for a request an image-capable route cannot send until more
 * of its images are offloaded. The failure's `offloadImages` names how many
 * more of the oldest retained occurrences must be offloaded;
 * `dsh-compaction-image-offload` records an `image/offload` selection before
 * the agent or summarizer retries with freshly derived input.
 */
export declare const IMAGE_OFFLOAD_REQUIRED_CODE = "IMAGE_OFFLOAD_REQUIRED";
//# sourceMappingURL=error.d.ts.map