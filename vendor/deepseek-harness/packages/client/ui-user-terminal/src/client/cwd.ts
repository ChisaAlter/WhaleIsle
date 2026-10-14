import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'
/**
 * Resolve the project cwd for a session-maybe occupant.
 * Prefer the slot's sessionId; otherwise use the session retained by the main view.
 * @param sessionId - framework session id when a session is current.
 * @param list - global session list snapshot.
 * @returns a non-empty cwd, or undefined when no project is selected.
 */
export function cwdFromSessions(
  sessionId: SessionId | undefined,
  list: SessionListState,
): string | undefined {
  const id = sessionId ?? Object.values(list.byId)
    .find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
  const next = id === undefined ? undefined : sessionWorkingDirectory(list.byId[id])
  return next ? next : undefined
}
