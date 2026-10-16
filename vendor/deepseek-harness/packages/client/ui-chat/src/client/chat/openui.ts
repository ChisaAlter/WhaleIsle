import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Explicit user action emitted by the isolated OpenUI renderer. */
export interface OpenUiAssistantAction {
  readonly message: string
  readonly formState?: unknown
  readonly context?: unknown
}

/** Assistant-only capabilities, bound to the node's owning Session by its registration. */
export interface OpenUiInjected {
  hooks: {
    openUiTheme: ObservableSnapshot<ThemeSnapshot | null>
  }
  sendOpenUiAction(action: OpenUiAssistantAction): Promise<void>
  readOpenUiState(instanceId: string): Record<string, unknown>
  saveOpenUiState(instanceId: string, state: Record<string, unknown>): void
}

/** Plain capabilities passed from the Assistant slot into its prose renderer. */
export interface AssistantOpenUi {
  readonly identity: string
  readonly theme: ThemeSnapshot | null
  readonly send: OpenUiInjected['sendOpenUiAction']
  readonly readState: OpenUiInjected['readOpenUiState']
  readonly saveState: OpenUiInjected['saveOpenUiState']
}

/** Keep interaction context in the ordinary, replayable user-message path. */
export function openUiActionText(action: OpenUiAssistantAction): string {
  const parts = [action.message]
  if (action.formState !== undefined) parts.push(`OpenUI form state:\n${JSON.stringify(action.formState)}`)
  if (action.context !== undefined) parts.push(`OpenUI context:\n${JSON.stringify(action.context)}`)
  return parts.join('\n\n')
}

/** Versioned browser-local interaction state; the program remains in Session Markdown. */
export function readOpenUiState(instanceId: string): Record<string, unknown> {
  const stored = localStorage.getItem(`whale-openui:state:v1:${instanceId}`)
  if (stored === null) return {}
  const state: unknown = JSON.parse(stored)
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new Error('Saved OpenUI state is not an object.')
  }
  return state as Record<string, unknown>
}

/** Persist only explicit viewer state, never rendered HTML or application capabilities. */
export function saveOpenUiState(instanceId: string, state: Record<string, unknown>): void {
  localStorage.setItem(`whale-openui:state:v1:${instanceId}`, JSON.stringify(state))
}
