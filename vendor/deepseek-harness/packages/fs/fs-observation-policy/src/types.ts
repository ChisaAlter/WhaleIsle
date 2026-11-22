/**
 * Vocabulary for the fs-observation-policy plugin: the minimal execution-context
 * fields used to derive an observed-state owner by narrowing the opaque `object`
 * actor the `fs/*` events carry.
 *
 * The provider vocabulary (`FsTarget`, `FsVersion`, write/edit request types) is
 * re-used from `@deepseek-ai/dsh-fs`; this package owns only the observed-state
 * owner structure on top of it.
 *
 * @module @deepseek-ai/dsh-fs-observation-policy/types
 */

/**
 * Minimal structural view of a tool execution the policy plugin needs to derive
 * an observed-state owner. `@deepseek-ai/dsh-tools`' `ToolExecution` contains
 * these fields, so the tool passes its `exec` straight through as the opaque
 * `object` actor on the `fs/*` events; this plugin narrows that actor to
 * `FsObservationActor` without importing `dsh-tools`, `dsh-agent`, or `dsh-session`.
 *
 * The owner is `agent.session` when present. It is treated as an opaque object
 * identity (a `WeakMap` key); this package never reads any of its fields.
 */
/**
 * Minimal structural view of a persisted content block inside `agent.session.deriveMessages()`,
 * avoiding a hard package dependency on `@deepseek-ai/dsh-session`.
 */
export interface FsSessionContentBlock {
  readonly type: string
  readonly id?: string
  readonly name?: string
  readonly arguments?: string
  readonly text?: string
}

/** Minimal structural view of one derived session message. */
export interface FsSessionMessage {
  readonly role: string
  readonly toolCallId?: string
  readonly isError?: boolean
  readonly content?: readonly FsSessionContentBlock[]
}

/** Structural contract for a live or resumed session exposed on `actor.agent.session`. */
export interface FsObservedSession {
  readonly header?: { readonly cwd?: string }
  readonly deriveMessages?: () => readonly FsSessionMessage[]
}

export interface FsObservationActor {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    /** The session that owns observed-file state, used as an opaque key. */
    session?: object
  }
}
