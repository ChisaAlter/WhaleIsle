import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { WhalePanelOperation } from './whale-ui-store.ts'

/** Host acknowledgement of one completed Whale UI action. */
export type WhaleActionResult = { ok: true } | { ok: false; error: string }

/** Source languages compiled by the single Whale UI viewer. */
export type WhaleSourceLanguage = 'whale-ui' | 'openui' | 'openui-lang' | 'dsh-ui'

/** Persisted render_ui metadata passed by the owning Tool card after successful settlement. */
export interface WhaleUiToolOwner {
  readonly callId: string
  readonly seq: number
  readonly metadata: unknown
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One settled render_ui result, declared by its Tool card and rendered by Whale UI. */
    'tool.call.whale-ui': { kind: 'single'; scope: 'session'; owner: WhaleUiToolOwner }
  }
}

/** Explicit user action emitted by the isolated Whale UI renderer. */
export interface OpenUiAssistantAction {
  readonly message: string
  readonly formState?: unknown
  readonly context?: unknown
}

/** Assistant-only capabilities, bound to the node's owning Session by its registration. */
export interface OpenUiInjected {
  hooks: {
    openUiTheme: ObservableSnapshot<ThemeSnapshot | null>
    openUiLocale: ObservableSnapshot<'zh' | 'en'>
  }
  sendOpenUiAction(action: OpenUiAssistantAction): Promise<WhaleActionResult>
  readOpenUiState(instanceId: string): Record<string, unknown>
  saveOpenUiState(instanceId: string, state: Record<string, unknown>): void
}

/** Plain capabilities passed from the Assistant slot into its prose renderer. */
export interface AssistantOpenUi {
  readonly identity: string
  readonly theme: ThemeSnapshot | null
  readonly locale?: 'zh' | 'en'
  /** Real Session sequence, supplied by the owning Chat node. */
  readonly seq?: number
  readonly send: OpenUiInjected['sendOpenUiAction']
  readonly readState: OpenUiInjected['readOpenUiState']
  readonly saveState: OpenUiInjected['saveOpenUiState']
  readonly publishPanel?: (operation: WhalePanelOperation) => void
}

/** Keep interaction context in the ordinary, replayable user-message path. */
export function openUiActionText(action: OpenUiAssistantAction): string {
  const parts = [action.message]
  if (action.formState !== undefined) parts.push(`Whale UI form state:\n${JSON.stringify(action.formState)}`)
  if (action.context !== undefined) parts.push(`Whale UI context:\n${JSON.stringify(action.context)}`)
  return parts.join('\n\n')
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read v2 browser-local state, or migrate the legacy flat map without deleting it.
 * @param instanceId - stable Session, Assistant, block and source-offset identity.
 * @returns the viewer's opaque interaction record, preserving its own state version.
 */
export function readOpenUiState(instanceId: string): Record<string, unknown> {
  const stored = localStorage.getItem(`whale-ui:state:v2:${instanceId}`)
  if (stored !== null) {
    const envelope: unknown = JSON.parse(stored)
    if (!record(envelope) || envelope.version !== 2 || !record(envelope.state)) {
      throw new Error('Saved Whale UI state has an unsupported format.')
    }
    return envelope.state
  }
  const legacy = localStorage.getItem(`whale-openui:state:v1:${instanceId}`)
  if (legacy === null) return {}
  const state: unknown = JSON.parse(legacy)
  if (!record(state)) throw new Error('Saved Whale UI state is not an object.')
  saveOpenUiState(instanceId, state)
  return state
}

/** Persist explicit viewer state synchronously; never persist HTML or application capabilities. */
export function saveOpenUiState(instanceId: string, state: Record<string, unknown>): void {
  localStorage.setItem(`whale-ui:state:v2:${instanceId}`, JSON.stringify({ version: 2, state }))
}
