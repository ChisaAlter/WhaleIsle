/**
 * Browser-safe failure and streaming vocabulary of the configuration surfaces
 * this package serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

import type {
  AuthorizationNotice,
  AuthorizationStatus,
  AuthorizationWirePrompt,
} from '@deepseek-ai/dsh-authorization/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write or record deletion, for
     * example because the stored document no longer parses. The details name
     * only the reference or key, never the value or payload.
     */
    'credential/rejected': { readonly ref: string } | { readonly key: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

export type { AuthorizationWirePrompt }

/**
 * Wire-safe stream frame emitted by `authorization.start()`.
 */
export type AuthorizationStreamEvent =
  | { readonly type: 'notice'; readonly notice: AuthorizationNotice }
  | { readonly type: 'prompt'; readonly promptId: string; readonly prompt: AuthorizationWirePrompt }
  | { readonly type: 'prompt-withdrawn'; readonly promptId: string }
  | { readonly type: 'done'; readonly status: AuthorizationStatus }
  | { readonly type: 'error'; readonly code: string; readonly message: string }
