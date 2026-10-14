import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { describe, expect, it } from 'vitest'
import { ClientSessions, sessionWorkingDirectory } from '../src/client/sessions/service.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

const sid = (id: string): SessionId => id as SessionId

describe('client SessionSummary presentation projection', () => {
  it('maps session-list presentation to presentation, title, and displayTitle', async () => {
    const api = new FakeApiClient()
    const sessionId = sid('client-presentation')
    const presentation = { owner: 'project', title: 'Presented title', workingDirectory: '/user/project' }
    api.onList = () => Promise.resolve(ok({
      items: [{
        sessionId,
        updatedAt: 1,
        running: false,
        blank: true,
        title: 'Durable title',
        cwd: '/workspace/project',
        projections: {
          kind: 'sequenced',
          asOfSeq: 0,
          values: {
            sessionListMetadata: { blank: true, lastPromptAt: null, presentation },
          },
        },
      }],
    }) as never)
    const sessions = new ClientSessions(new Context(), fakeRemote(api))

    await sessions.refresh()
    await Promise.resolve()

    expect(sessions.list.getSnapshot().byId[sessionId]).toMatchObject({
      presentation,
      title: 'Presented title',
      displayTitle: 'Presented title',
      cwd: '/workspace/project',
    })
    expect(sessionWorkingDirectory(sessions.list.getSnapshot().byId[sessionId])).toBe('/user/project')
    expect(sessionWorkingDirectory({ cwd: '/ordinary/project' })).toBe('/ordinary/project')
    expect(sessionWorkingDirectory(undefined)).toBeUndefined()
  })
})
