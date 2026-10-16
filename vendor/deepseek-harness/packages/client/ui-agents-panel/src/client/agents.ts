import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
/** One current-session subagent row derived from the existing snapshot. */
export interface AgentRow {
  id: SessionId
  label: string
  activity: 'running' | 'inactive'
  mode?: 'one-shot' | 'continuable' | 'external'
}

function fromCatalog(
  catalog: NonNullable<SessionListState['projectionsBySession'][SessionId]>['values']['subagentCatalog'],
  byId: SessionListState['byId'],
): AgentRow[] {
  const rows: AgentRow[] = []
  for (const entry of catalog ?? []) {
    const summary = byId[entry.id]
    const labeled = entry.label
    rows.push({
      id: entry.id,
      label: labeled && labeled.length > 0 ? labeled : summary?.displayTitle ?? String(entry.id),
      activity: summary?.running === true ? 'running' : 'inactive',
      ...entry.mode === 'unknown' ? {} : { mode: entry.mode },
    })
  }
  return rows
}

function fromLineage(parent: SessionId, state: SessionListState): AgentRow[] {
  return Object.values(state.byId)
    .filter(child => child.parentId === parent)
    .map(child => ({
      id: child.id,
      label: child.displayTitle,
      activity: child.running ? 'running' as const : 'inactive' as const,
    }))
}

/**
 * List current-session subagents from the existing session snapshot.
 * Prefers the parent's `subagentCatalog` projection; falls back to `byId` children.
 * @param state - live session list snapshot.
 * @param sessionId - surfaces session, or the session retained by the main view.
 * @returns rows in catalog / list order; empty when none.
 */
export function listSessionAgents(state: SessionListState, sessionId: SessionId | undefined): AgentRow[] {
  const parent = sessionId ?? Object.values(state.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
  if (parent === undefined) return []
  const catalog = state.projectionsBySession[parent]?.values.subagentCatalog
  if (catalog !== undefined) return fromCatalog(catalog, state.byId)
  return fromLineage(parent, state)
}
