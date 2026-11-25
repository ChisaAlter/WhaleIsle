/**
 * Shared request validation helpers for credential-keyed Remote controllers.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/key.ts
 */

import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Parse a raw `<scope>/<id>` string into a branded {@link CredentialKey},
 * converting grammar failures into `gateway/bad-request`.
 * @param method - Remote endpoint name for error diagnostics.
 * @param raw - untrusted string received over the wire.
 * @returns the validated branded key.
 */
export function parseCredentialKeyOrBadRequest(method: string, raw: unknown): CredentialKey {
  if (typeof raw !== 'string') {
    throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, {
      issues: [{ path: ['key'], message: 'credential key must be a string' }],
    })
  }
  try {
    return parseCredentialKey(raw)
  } catch (error: unknown) {
    throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, {
      issues: [{ path: ['key'], message: error instanceof Error ? error.message : String(error) }],
    })
  }
}
