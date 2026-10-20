/** Shared contracts between the embedded renderer and component families. */
import type { GenuiSpec } from '../spec.ts'
import type { BlockInteractionState } from '../interaction-state.ts'
import type { GenuiActionHandler } from '../action-context.ts'
import type { SubmissionRegistry } from '../submission-registry.ts'
import type { GenuiRenderDiagnosticsHandler } from '../render-diagnostics.tsx'

export interface GenuiBlockProps {
  spec: GenuiSpec
  /** Source revision identity for asynchronous render diagnostics; defaults to stateKey. */
  diagnosticSourceId?: string | undefined
  /** Active caught render/engine errors; an empty snapshot clears this source. */
  onRenderDiagnostics?: GenuiRenderDiagnosticsHandler | undefined
  /** Direct callback takes precedence over GenuiActionContext. Host success is acknowledged asynchronously. */
  onAction?: GenuiActionHandler | undefined
  /** Document/component identity supplied by the owner. Changing an established
   * identity remounts; a streaming instance can adopt its first settled key. */
  stateKey?: string | undefined
  animateEntrance?: boolean | undefined
  /** Owner snapshot. Replacing it updates an already mounted instance. */
  initialState?: BlockInteractionState | undefined
  /** Called synchronously for changes, before an event can unmount the block.
   * The host owns persistence; this renderer never accesses browser storage. */
  onStateChange?: ((state: BlockInteractionState) => void) | undefined
  /** Initial/current secret-free state for artifact or host snapshot capture. */
  onStateSnapshot?: ((state: BlockInteractionState) => void) | undefined
}

export interface AnswersState {
  answers: Record<string, string>
  multiAnswers: Record<string, string[]>
  fields: Record<string, string>
  secretFields: ReadonlySet<string>
  registry: SubmissionRegistry
  locked: boolean
  round: number
  setAnswer: (group: string, choice: string) => void
  setMultiAnswer: (group: string, choice: string, checked: boolean) => void
  setField: (id: string, value: string) => void
  registerSecretField: (id: string) => void
  clear: () => void
  setLocked: (locked: boolean) => void
}
