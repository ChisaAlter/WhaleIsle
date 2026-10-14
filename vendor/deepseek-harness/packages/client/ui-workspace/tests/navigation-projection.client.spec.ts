import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { projectSessionNavigation } from '../src/client/navigation-projection.ts'
import { currentGroupKey, deriveFlat, deriveGroups, deriveSearchResults, sessionMemberIds } from '../src/client/tree.ts'

const sid = (id: string) => id as SessionId
const directory = 'C:\\work\\WhaleIsle-MyGo'
const materials = 'C:\\dsh-home\\projects\\project-a'
const lead: SessionSummary = {
  id: sid('lead'), displayTitle: 'Lead', title: 'Old conversation title', cwd: materials,
  presentation: { owner: 'project', title: 'MyGo planning', workingDirectory: directory },
  blank: true, running: false, updatedAt: 2, retainedBy: { mainView: 1 },
}
const ordinary: SessionSummary = {
  id: sid('ordinary'), displayTitle: 'Ordinary', title: 'Ordinary', cwd: directory,
  blank: false, running: false, updatedAt: 1, retainedBy: {},
}
const list: SessionListState = {
  ids: [lead.id, ordinary.id], byId: { [lead.id]: lead, [ordinary.id]: ordinary },
  phase: 'ready', projectionsBySession: {},
}
const workspace: WorkspaceView = {
  workspaceId: 'mygo' as WorkspaceId, path: directory, title: 'WhaleIsle-MyGo',
  sessionIds: [ordinary.id], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const entry = { owner: 'project', sessionId: lead.id, workingDirectory: directory, archived: false }
const rowState = { pinnedSessionIds: [], archivedSessionIds: [], archivedFilter: 'default' as const }

describe('owner Session directory navigation', () => {
  it('places the same Lead beside ordinary conversations in grouped, flat and search views', () => {
    const navigation = projectSessionNavigation(list, [workspace], [entry])
    const groups = deriveGroups(navigation.list, navigation.workspaces, rowState, new Map(),
      { expandedGroups: [workspace.workspaceId] }, undefined)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.sessions.map(row => row.id)).toEqual([lead.id, ordinary.id])
    expect(groups[0]?.sessions[0]).toMatchObject({ title: 'MyGo planning', owner: 'project', blank: false })
    expect(currentGroupKey(navigation.list, navigation.workspaces, undefined)).toBe(workspace.workspaceId)
    expect(deriveFlat(navigation.list, sessionMemberIds(navigation.list, navigation.workspaces), rowState, new Map())
      .map(row => row.id)).toEqual([lead.id, ordinary.id])
    expect(deriveSearchResults(navigation.list, navigation.workspaces, 'MyGo', [], 'default', new Map(),
      { items: [], hasMore: false }, 20, undefined).items.map(row => row.id)).toEqual([lead.id, ordinary.id])
    expect(navigation.list.byId[lead.id]?.cwd).toBe(materials)
    expect(workspace.sessionIds).toEqual([ordinary.id])
    expect(list.byId[lead.id]?.blank).toBe(true)
  })

  it('uses a browser-only directory row when the directory has no native registration', () => {
    const navigation = projectSessionNavigation(list, [], [entry, entry])
    expect(navigation.workspaces).toHaveLength(1)
    expect(navigation.workspaces[0]).toMatchObject({
      navigationOnly: true, path: directory, title: 'WhaleIsle-MyGo', sessionIds: [lead.id],
    })
    const key = navigation.workspaces[0]!.workspaceId
    const groups = deriveGroups(navigation.list, navigation.workspaces,
      { ...rowState, archivedSessionIds: [lead.id], archivedFilter: 'only' }, new Map(),
      { expandedGroups: [key] }, undefined)
    expect(groups[0]?.sessions[0]).toMatchObject({ id: lead.id, owner: 'project', archived: true })
    expect(groups[0]?.navigationOnly).toBe(true)
  })

  it('requires current presentation ownership and the authoritative display directory', () => {
    expect(projectSessionNavigation(list, [], [{ ...entry, workingDirectory: materials }]).workspaces).toEqual([])
    expect(projectSessionNavigation(list, [], [{ ...entry, owner: 'other' }]).workspaces).toEqual([])
    expect(projectSessionNavigation(list, [], [{ ...entry, sessionId: sid('missing') }]).workspaces).toEqual([])
  })
})
