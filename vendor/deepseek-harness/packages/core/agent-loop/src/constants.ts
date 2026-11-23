/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Default maximum consecutive auto-recovery continuations after max-tokens truncation. */
export const DEFAULT_MAX_TOKENS_RECOVERY_LIMIT = 2

/** Default maximum steps per turn before halting runaway loops. */
export const DEFAULT_MAX_STEPS_PER_TURN = 200
