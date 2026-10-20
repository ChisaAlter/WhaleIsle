/** Serializable, secret-free interaction state owned and persisted by the embedding host. */
export interface BlockInteractionState {
  answers?: Record<string, string>
  multiAnswers?: Record<string, string[]>
  locked?: boolean
  fields?: Record<string, string>
  /** Local presentation/control state, addressed by renderer component path. */
  componentState?: Record<string, unknown>
}
