/**
 * Map a vision-describe finish reason to an {@link LlmError} so agent-loop
 * records the provider code instead of flattening to UNKNOWN.
 *
 * @module @deepseek-ai/dsh-llm-vision-fallback/finish-error
 */

import { LlmError, type FinishReason } from '@deepseek-ai/dsh-llm'

const INVALID_REQUEST = 'INVALID_REQUEST'

/**
 * Translate terminal finish reasons of the describe call into a failure.
 * @param finish - assembler terminal reason after the vision stream ends.
 * @returns an {@link LlmError} to throw, or undefined when the stream succeeded.
 */
export function finishError(finish: FinishReason): LlmError | undefined {
  switch (finish.kind) {
    case 'stop':
    case 'max-tokens':
      // A truncated description is still the faithful prefix of one; the
      // configured cap is the deployment's chosen bound, not an error.
      return undefined
    case 'error':
    case 'aborted': {
      const { message, code, status, providerRetryAfterMs, requestId } = finish.failure
      return LlmError.fromFailure({ message, code,
        ...status === undefined ? {} : { status },
        ...providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs },
        ...requestId === undefined ? {} : { requestId },
      })
    }
    case 'tool-calls':
      return new LlmError(
        'vision-fallback: the vision model unexpectedly requested a tool',
        INVALID_REQUEST,
      )
    default:
      return new LlmError(
        `vision-fallback: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`,
        INVALID_REQUEST,
      )
  }
}
