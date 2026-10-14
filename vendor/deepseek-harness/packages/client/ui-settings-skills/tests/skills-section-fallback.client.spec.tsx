// @vitest-environment jsdom
// Focused spec: the SkillsSection catalog degrades to the global catalog when
// the session-scoped read fails (a live session whose boot failed, for example
// a corrupt session log, cannot back the layered view).
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SkillInventoryEntry, SkillInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import type { SkillsSectionInjected, SkillsSectionProps } from '../src/client/SkillsSection.tsx'
import { en, type SkillsSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

const t = ((key: SkillsSettingsKey): string => en[key])

const skill: SkillInventoryEntry = {
  name: 'global-skill',
  description: 'Reachable without a live session',
  source: 'user-dsh',
  provider: 'filesystem',
  path: '/home/me/.dsh/skills/global-skill/SKILL.md',
  directory: '/home/me/.dsh/skills/global-skill',
  writable: true,
  modelInvocable: true,
  userInvocable: true,
}

function sessionState(cwd?: string, rawId = 'session-1'): SessionListState {
  const id = rawId as SessionId
  return {
    ids: cwd === undefined ? [] : [id],
    byId: cwd === undefined ? {} : {
      [id]: { id, displayTitle: 'project', cwd, running: false, retainedBy: { mainView: 1 }, blank: false, updatedAt: 0 },
    },
    phase: 'ready',
    projectionsBySession: {},
  }
}

function props(partial: Partial<SkillsSectionInjected> & Partial<Pick<SkillsSectionProps, 'useSessions'>> = {}): SkillsSectionProps {
  return {
    t,
    useSessions: selector => selector(sessionState('/work/broken')),
    list: async () => ({ skills: [skill] }),
    get: async () => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      path: skill.path ?? '',
      writable: skill.writable,
      modelInvocable: skill.modelInvocable,
      userInvocable: skill.userInvocable,
      content: 'Body',
    }),
    create: async () => {},
    update: async () => {},
    remove: async () => {},
    setInvocation: async () => {},
    searchHub: async () => [],
    installHub: async () => {},
    openDirectory: async () => {},
    ...partial,
  } as SkillsSectionProps
}

describe('SkillsSection scoped-catalog fallback', () => {
  it('falls back to the global catalog when the session-scoped read fails', async () => {
    const list = vi.fn((scope: { sessionId?: string }) => scope.sessionId === undefined
      ? Promise.resolve({ skills: [skill] })
      : Promise.reject(new Error('history unavailable')))
    render(<SkillsSection {...props({ list })} />)

    expect(await screen.findByText(skill.name)).toBeTruthy()
    expect(screen.getByText(en.sessionCatalogUnavailable)).toBeTruthy()
    expect(screen.queryByText(en.projectCatalogUnavailable)).toBeNull()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toBe(en.sessionCatalogUnavailable)
    expect(screen.queryByText(en.error)).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(1, { sessionId: 'session-1', cwd: '/work/broken' })
    expect(list).toHaveBeenNthCalledWith(2, {})
  })

  it('keeps the session-scoped catalog without a notice when the scoped read succeeds', async () => {
    const list = vi.fn(async () => ({ skills: [skill] }))
    render(<SkillsSection {...props({ list })} />)

    expect(await screen.findByText(skill.name)).toBeTruthy()
    expect(screen.queryByText(en.sessionCatalogUnavailable)).toBeNull()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ sessionId: 'session-1', cwd: '/work/broken' })
  })

  it('shows the error view only when the global fallback also fails', async () => {
    const list = vi.fn(async (scope: { sessionId?: string }): Promise<SkillInventorySnapshot> => {
      if (scope.sessionId !== undefined) throw new Error('history unavailable')
      throw new Error('catalog down')
    })
    const { container } = render(<SkillsSection {...props({ list })} />)

    expect((await screen.findByRole('alert')).textContent).toContain(en.error)
    expect(screen.queryByText(en.sessionCatalogUnavailable)).toBeNull()

    // A retry re-runs the scoped read and the fallback.
    list.mockImplementation(async (scope: { sessionId?: string }) => {
      if (scope.sessionId !== undefined) throw new Error('history unavailable')
      return { skills: [skill] }
    })
    fireEvent.click(within(container).getByRole('button', { name: en.retry }))
    expect(await screen.findByText(skill.name)).toBeTruthy()
    expect(screen.getByText(en.sessionCatalogUnavailable)).toBeTruthy()
  })

  it('clears the fallback notice once a scoped read succeeds again', async () => {
    let scopedFails = true
    const list = vi.fn(async (scope: { sessionId?: string }) => {
      if (scope.sessionId !== undefined && scopedFails) throw new Error('history unavailable')
      return { skills: [skill] }
    })
    const { rerender } = render(<SkillsSection {...props({ list })} />)
    expect(await screen.findByText(en.sessionCatalogUnavailable)).toBeTruthy()

    scopedFails = false
    rerender(<SkillsSection {...props({ list, useSessions: selector => selector(sessionState('/work/next', 'session-2')) })} />)
    await waitFor(() => { expect(screen.queryByText(en.sessionCatalogUnavailable)).toBeNull() })
    expect(await screen.findByText(skill.name)).toBeTruthy()
  })
})
