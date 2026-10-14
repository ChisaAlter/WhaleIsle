import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { OwnedSessionNavigation } from './navigation.ts'

/** Browser-only directory accounts; navigationOnly identities never enter Host mutations. */
export interface NavigationWorkspace extends WorkspaceView {
  readonly navigationOnly?: boolean
}

export interface NavigationSessionSummary extends SessionSummary {
  readonly navigationOwner?: string
}

/** Merge owner display membership with real directory rows without changing immutable Session cwd. */
export function projectSessionNavigation(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  entries: readonly OwnedSessionNavigation[],
): { list: SessionListState; workspaces: NavigationWorkspace[] } {
  const byId = { ...list.byId }
  const ids = [...list.ids]
  const directories: NavigationWorkspace[] = workspaces.map(workspace => ({
    ...workspace,
    sessionIds: workspace.sessionIds.filter(id => list.byId[id]?.presentation === undefined),
  }))
  for (const entry of entries) {
    const session = list.byId[entry.sessionId]
    if (session?.presentation?.owner !== entry.owner
      || session.presentation.workingDirectory !== entry.workingDirectory) continue
    byId[session.id] = {
      ...session, blank: false, title: session.presentation.title,
      navigationOwner: entry.owner,
    } as NavigationSessionSummary
    if (!ids.includes(session.id)) ids.push(session.id)
    let directory = directories.find(workspace => workspace.path === entry.workingDirectory)
    if (directory === undefined) {
      const path = entry.workingDirectory.replaceAll('\\', '/').replace(/\/$/, '')
      directory = {
        workspaceId: `navigation:${entry.workingDirectory}` as WorkspaceId,
        navigationOnly: true, path: entry.workingDirectory,
        title: path.slice(path.lastIndexOf('/') + 1) || entry.workingDirectory,
        sessionIds: [], createdAt: '', updatedAt: '',
      }
      directories.push(directory)
    }
    directories[directories.indexOf(directory)] = {
      ...directory, sessionIds: [session.id, ...directory.sessionIds.filter(id => id !== session.id)],
    }
  }
  return { list: { ...list, ids, byId }, workspaces: directories }
}
