/** One floating-preview request target resolved from a file resource address. */
import { parseFileAddress, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Desktop preload surface used by the floating preview action. */
export interface FloatingPreviewShell {
  previewOpenFileWindow?: (input: FloatingPreviewRequest) => Promise<FloatingPreviewResult | null | undefined>
}

/** Input accepted by the desktop floating file viewer. */
export type FloatingPreviewRequest =
  | { cwd: string; relativePath: string }
  | { absolutePath: string }

/** Result returned by the desktop floating file viewer. */
export interface FloatingPreviewResult {
  ok?: boolean
  message?: string
}

/** Resolved activation target; `reason` is present only when activation is disabled. */
export type FloatingPreviewTarget =
  | { ok: true; request: FloatingPreviewRequest }
  | { ok: false; reason: 'no-cwd' }

/** Read the Desktop preload capability, if this renderer has one. */
export function readFloatingPreviewShell(): FloatingPreviewShell | undefined {
  /* v8 ignore next -- browser-only module; Node coverage never sees a missing window. */
  if (typeof window === 'undefined') return undefined
  return (window as Window & { shell?: FloatingPreviewShell }).shell
}

/** Whether the Desktop floating viewer is available in this renderer. */
export function hasFloatingPreview(): boolean {
  return typeof readFloatingPreviewShell()?.previewOpenFileWindow === 'function'
}

/**
 * Resolve a file resource address into the exact request the desktop viewer takes.
 * Relative addresses use the cwd of the Session named by the resource itself.
 */
export function floatingPreviewTarget(
  resourceAddress: string,
  sessions: SessionListState,
): FloatingPreviewTarget {
  const address = parseFileAddress(resourceAddress)
  if (address === undefined) return { ok: false, reason: 'no-cwd' }
  if (address.scope === 'absolute') {
    return { ok: true, request: { absolutePath: address.path } }
  }

  const cwd = sessionWorkingDirectory(sessions.byId[address.sessionId as SessionId])
  if (cwd !== undefined && cwd !== '') {
    const absolute = resolveWorkspacePath(cwd, address.path)
    const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
    const normalizedAbsolute = absolute.replace(/\\/g, '/')
    const relative = normalizedAbsolute === normalizedCwd
      ? ''
      : normalizedAbsolute.startsWith(`${normalizedCwd}/`)
        ? normalizedAbsolute.slice(normalizedCwd.length + 1)
        : undefined
    if (relative !== undefined && relative !== '') {
      return { ok: true, request: { cwd, relativePath: relative } }
    }
  }

  // A relative address without its owning Session cwd is ambiguous. Never
  // guess a scratch root; an absolute path inside the address is still usable.
  if (address.path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(address.path)) {
    return { ok: true, request: { absolutePath: address.path } }
  }
  return { ok: false, reason: 'no-cwd' }
}

/** Whether an activation result proves the desktop viewer opened. */
export function floatingPreviewSucceeded(
  result: FloatingPreviewResult | null | undefined,
): result is { ok: true } {
  return result?.ok === true
}
