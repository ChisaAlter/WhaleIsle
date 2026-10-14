// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SkillInventoryDetail, SkillInventoryEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import type { SkillsSectionInjected, SkillsSectionProps } from '../src/client/SkillsSection.tsx'
import { en, type SkillsSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

const t = ((key: SkillsSettingsKey): string => en[key])

const writableSkill = {
  name: 'demo-skill',
  description: 'Reviews a proposed change',
  whenToUse: 'Use before merging code',
  source: 'user-dsh',
  provider: 'filesystem',
  path: '/home/me/.dsh/skills/demo-skill/SKILL.md',
  directory: '/home/me/.dsh/skills/demo-skill',
  writable: true,
  modelInvocable: true,
  userInvocable: true,
} as const

const readOnlySkill = {
  name: 'shipped-skill',
  description: 'Bundled guidance',
  whenToUse: 'Use for shipped workflows',
  source: 'bundled',
  provider: 'filesystem',
  path: '/app/skills/shipped-skill/SKILL.md',
  directory: '/app/skills/shipped-skill',
  writable: false,
  modelInvocable: true,
  userInvocable: false,
} as const

function detail(skill: SkillInventoryEntry = writableSkill): SkillInventoryDetail {
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
    ...skill.groups === undefined ? {} : { groups: [...skill.groups] },
    source: skill.source,
    ...skill.path === undefined ? {} : { path: skill.path },
    writable: skill.writable,
    modelInvocable: skill.modelInvocable,
    userInvocable: skill.userInvocable,
    content: '# Instructions\n\nFollow every step carefully.',
  }
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

function sessionHook(state: SessionListState): SkillsSectionProps['useSessions'] {
  return selector => selector(state)
}

type SkillsOverrides = Partial<SkillsSectionInjected> & Partial<Pick<SkillsSectionProps, 'useSessions'>>

function props(partial: SkillsOverrides = {}): SkillsSectionProps {
  return {
    t,
    useSessions: sessionHook(sessionState()),
    list: async () => ({ skills: [] }),
    get: async () => detail(),
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function renderCatalog(partial: SkillsOverrides = {}) {
  render(<SkillsSection {...props({
    list: async () => ({ skills: [writableSkill, readOnlySkill] }),
    get: async name => name === readOnlySkill.name ? detail(readOnlySkill) : detail(),
    ...partial,
  })} />)
  await screen.findByText(writableSkill.name)
}

function openDelete(name: string = writableSkill.name) {
  fireEvent.click(screen.getByRole('button', { name: `Delete ${name}` }))
}

describe('SkillsSection', () => {
  it('searches name, description, and when-to-use text and applies the source filter', async () => {
    await renderCatalog()

    const search = screen.getByRole('searchbox', { name: en.searchLabel })
    fireEvent.change(search, { target: { value: 'merging' } })
    expect(screen.getByText(writableSkill.name)).toBeTruthy()
    expect(screen.queryByText(readOnlySkill.name)).toBeNull()

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: en.sourceFilter }))
    fireEvent.click(screen.getByRole('menuitem', { name: en.sourceBundled }))
    expect(screen.queryByText(writableSkill.name)).toBeNull()
    expect(screen.getByText(readOnlySkill.name)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.clearFilters }))
    expect(screen.getByText(writableSkill.name)).toBeTruthy()
    expect(screen.getByText(readOnlySkill.name)).toBeTruthy()
  })

  it('renders flat rows with a source Pill and a model-invocation Switch', async () => {
    await renderCatalog()

    expect(screen.getByText(en.resultCount.replace('{count}', '2'))).toBeTruthy()
    const writableRow = screen.getByText(writableSkill.name).closest('li')
    expect(writableRow).not.toBeNull()
    expect(within(writableRow!).getByText(en.sourceUser)).toBeTruthy()
    expect(within(writableRow!).getByRole('switch', { name: `Model invocation for ${writableSkill.name}` })).toBeTruthy()
    expect(within(writableRow!).getByRole('button', { name: `Delete ${writableSkill.name}` })).toBeTruthy()

    const readOnlyRow = screen.getByText(readOnlySkill.name).closest('li')
    expect(readOnlyRow).not.toBeNull()
    expect(within(readOnlyRow!).getByText(en.sourceBundled)).toBeTruthy()
    expect(within(readOnlyRow!).getByRole<HTMLInputElement>('switch', { name: `Model invocation for ${readOnlySkill.name}` }).disabled).toBe(true)
    expect(within(readOnlyRow!).queryByRole('button', { name: `Delete ${readOnlySkill.name}` })).toBeNull()
  })

  it('sections rows by group, ungrouped last, and keeps sections under search', async () => {
    const groupedA = { ...writableSkill, name: 'group-a', groups: ['review'] }
    const groupedB = { ...writableSkill, name: 'group-b', groups: ['review'] }
    const groupedC = { ...writableSkill, name: 'group-c', groups: ['docs'] }
    const plain: SkillInventoryEntry = {
      name: 'plain-skill',
      description: 'No group label',
      source: 'user-dsh',
      provider: 'filesystem',
      path: '/home/me/.dsh/skills/plain-skill/SKILL.md',
      directory: '/home/me/.dsh/skills/plain-skill',
      writable: true,
      modelInvocable: true,
      userInvocable: true,
    }
    render(<SkillsSection {...props({
      list: async () => ({ skills: [groupedA, plain, groupedB, groupedC] }),
      get: async () => detail(groupedA),
    })} />)
    await screen.findByText(groupedA.name)

    const disclosures = screen.getAllByRole('button', { name: /skills/ }).filter(button => button.getAttribute('aria-expanded') !== null)
    expect(disclosures.map(button => button.textContent?.replace(/\d+ skills$/, '').trim())).toEqual(['review', 'docs', en.ungrouped])

    const reviewSection = disclosures[0]!.closest('section')
    expect(reviewSection).not.toBeNull()
    expect(within(reviewSection!).getByText(groupedA.name)).toBeTruthy()
    expect(within(reviewSection!).getByText(groupedB.name)).toBeTruthy()
    expect(within(reviewSection!).queryByText(groupedC.name)).toBeNull()
    expect(within(reviewSection!).queryByText(plain.name)).toBeNull()

    const ungroupedSection = disclosures[2]!.closest('section')
    expect(within(ungroupedSection!).getByText(plain.name)).toBeTruthy()

    const search = screen.getByRole('searchbox', { name: en.searchLabel })
    fireEvent.change(search, { target: { value: 'docs' } })
    expect(screen.getByText(groupedC.name)).toBeTruthy()
    expect(screen.queryByText(groupedA.name)).toBeNull()
    expect(screen.queryByText(plain.name)).toBeNull()
    const afterSearch = screen.getAllByRole('button', { name: /skills/ }).filter(button => button.getAttribute('aria-expanded') !== null)
    expect(afterSearch.map(button => button.textContent?.replace(/\d+ skills$/, '').trim())).toEqual(['docs'])
  })

  it('shows a tree node for a single group without ungrouped rows', async () => {
    const grouped = { ...writableSkill, name: 'lone-grouped', groups: ['tooling'] }
    render(<SkillsSection {...props({
      list: async () => ({ skills: [grouped] }),
      get: async () => detail(grouped),
    })} />)
    await screen.findByText(grouped.name)
    const disclosure = screen.getAllByRole('button', { name: /skills/ }).find(button => button.getAttribute('aria-expanded') !== null)
    expect(disclosure).not.toBeUndefined()
    expect(disclosure!.getAttribute('aria-expanded')).toBe('true')
    expect(disclosure!.textContent).toContain('tooling')
  })

  it('collapses and expands a group, remembering the state across remounts', async () => {
    const groupedA = { ...writableSkill, name: 'tree-a', groups: ['review'] }
    const plain: SkillInventoryEntry = {
      name: 'tree-plain',
      description: 'No group label',
      source: 'user-dsh',
      provider: 'filesystem',
      path: '/home/me/.dsh/skills/tree-plain/SKILL.md',
      directory: '/home/me/.dsh/skills/tree-plain',
      writable: true,
      modelInvocable: true,
      userInvocable: true,
    }
    const base = {
      list: async () => ({ skills: [groupedA, plain] }),
      get: async () => detail(groupedA),
    }
    const { unmount } = render(<SkillsSection {...props(base)} />)
    await screen.findByText(groupedA.name)

    const disclosure = () => screen.getAllByRole('button', { name: /skills/ }).find(button => button.getAttribute('aria-expanded') !== null)!
    fireEvent.click(disclosure())
    expect(disclosure().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(groupedA.name)).toBeNull()

    unmount()
    render(<SkillsSection {...props(base)} />)
    await screen.findByText(plain.name)
    expect(disclosure().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(groupedA.name)).toBeNull()

    fireEvent.click(disclosure())
    expect(disclosure().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(groupedA.name)).toBeTruthy()
  })

  it('tolerates a corrupt or non-object remembered tree state', async () => {
    const grouped = { ...writableSkill, name: 'corrupt-tree', groups: ['review'] }
    const base = {
      list: async () => ({ skills: [grouped] }),
      get: async () => detail(grouped),
    }
    const disclosureOf = () => screen.getAllByRole('button', { name: /skills/ }).find(button => button.getAttribute('aria-expanded') !== null)!

    sessionStorage.setItem('dshd.settings.skills.tree', '{not-json')
    render(<SkillsSection {...props(base)} />)
    await screen.findByText(grouped.name)
    expect(disclosureOf().getAttribute('aria-expanded')).toBe('true')

    cleanup()
    sessionStorage.setItem('dshd.settings.skills.tree', '["review"]')
    render(<SkillsSection {...props(base)} />)
    await screen.findByText(grouped.name)
    expect(disclosureOf().getAttribute('aria-expanded')).toBe('true')
  })

  it('toggles the whole group through the group switch and keeps the section open on disable', async () => {
    const groupedA = { ...writableSkill, name: 'group-a', groups: ['review'] }
    const groupedB = { ...writableSkill, name: 'group-b', groups: ['review'] }
    const setInvocation = vi.fn(async () => {})
    render(<SkillsSection {...props({
      list: async () => ({ skills: [groupedA, groupedB] }),
      get: async () => detail(groupedA),
      setInvocation,
    })} />)
    await screen.findByText(groupedA.name)

    const groupSwitch = screen.getByRole('switch', { name: en.groupToggleFor.replace('{group}', 'review') })
    const disclosure = () => screen.getAllByRole('button', { name: /skills/ }).find(button => button.getAttribute('aria-expanded') !== null)!

    fireEvent.click(groupSwitch)
    expect(setInvocation).toHaveBeenCalledTimes(2)
    expect(setInvocation).toHaveBeenCalledWith(groupedA.name, false, true, {})
    expect(setInvocation).toHaveBeenCalledWith(groupedB.name, false, true, {})
    // Disabling keeps the section expanded.
    await waitFor(() => {
      expect(disclosure().getAttribute('aria-expanded')).toBe('true')
      expect(screen.getByText(groupedA.name)).toBeTruthy()
    })
    const rows = screen.getAllByRole('switch', { name: /Model invocation for/ })
    expect(rows.every(item => (item as HTMLInputElement).checked)).toBe(false)
    expect(screen.getByRole<HTMLInputElement>('switch', { name: en.groupToggleFor.replace('{group}', 'review') }).checked).toBe(false)
  })

  it('flips the group rows optimistically while the frontmatter writes are in flight', async () => {
    const groupedA = { ...writableSkill, name: 'group-a', groups: ['review'] }
    const groupedB = { ...writableSkill, name: 'group-b', groups: ['review'] }
    const pending = deferred<undefined>()
    const setInvocation = vi.fn(() => pending.promise)
    render(<SkillsSection {...props({
      list: async () => ({ skills: [groupedA, groupedB] }),
      get: async () => detail(groupedA),
      setInvocation,
    })} />)
    await screen.findByText(groupedA.name)

    const groupSwitch = screen.getByRole<HTMLInputElement>('switch', { name: en.groupToggleFor.replace('{group}', 'review') })
    fireEvent.click(groupSwitch)
    // The echo lands without waiting for the writes to settle.
    expect(setInvocation).toHaveBeenCalledTimes(2)
    const rows = screen.getAllByRole('switch', { name: /Model invocation for/ })
    expect(rows.every(item => !(item as HTMLInputElement).checked)).toBe(true)
    expect(groupSwitch.checked).toBe(false)
    expect(groupSwitch.disabled).toBe(true)

    pending.resolve(undefined)
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('switch', { name: en.groupToggleFor.replace('{group}', 'review') }).disabled).toBe(false)
    })
  })

  it('keeps read-only skills out of a group toggle and disables all-readonly groups', async () => {
    const writable = { ...writableSkill, name: 'mixed-writable', groups: ['review'] }
    const readonly = { ...readOnlySkill, name: 'mixed-readonly', groups: ['review'] }
    const setInvocation = vi.fn(async () => {})
    render(<SkillsSection {...props({
      list: async () => ({ skills: [writable, readonly] }),
      get: async name => name === readonly.name ? detail(readonly) : detail(writable),
      setInvocation,
    })} />)
    await screen.findByText(writable.name)

    const groupSwitch = screen.getByRole('switch', { name: en.groupToggleFor.replace('{group}', 'review') })
    fireEvent.click(groupSwitch)
    expect(setInvocation).toHaveBeenCalledTimes(1)
    expect(setInvocation).toHaveBeenCalledWith(writable.name, false, true, {})
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('switch', { name: `Model invocation for ${writable.name}` }).checked).toBe(false)
    })

    cleanup()
    render(<SkillsSection {...props({
      list: async () => ({ skills: [readonly] }),
      get: async () => detail(readonly),
      setInvocation,
    })} />)
    await screen.findByText(readonly.name)
    expect(screen.getByRole<HTMLInputElement>('switch', { name: en.groupToggleFor.replace('{group}', 'review') }).disabled).toBe(true)
  })

  it('reports per-row failures from a group toggle and re-enables the switch', async () => {
    const groupedA = { ...writableSkill, name: 'group-a', groups: ['review'] }
    const groupedB = { ...writableSkill, name: 'group-b', groups: ['review'] }
    const first = deferred<undefined>()
    const second = deferred<undefined>()
    const setInvocation = vi.fn((name: string) => name === groupedA.name ? first.promise : second.promise)
    render(<SkillsSection {...props({
      list: async () => ({ skills: [groupedA, groupedB] }),
      get: async () => detail(groupedA),
      setInvocation,
    })} />)
    await screen.findByText(groupedA.name)

    const groupSwitchName = en.groupToggleFor.replace('{group}', 'review')
    fireEvent.click(screen.getByRole('switch', { name: groupSwitchName }))
    // The group switch stays disabled while its batch is in flight.
    expect(screen.getByRole<HTMLInputElement>('switch', { name: groupSwitchName }).disabled).toBe(true)
    first.resolve(undefined)
    second.reject(new Error('frontmatter is locked'))
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('switch', { name: groupSwitchName }).disabled).toBe(false)
    })
    // The section stays open after the toggle, so the failed row reports inline.
    expect((await screen.findByRole('alert')).textContent).toContain('frontmatter is locked')
  })

  it('toggles ungrouped writable skills through the ungrouped node switch', async () => {
    const groupedA = { ...writableSkill, name: 'group-a', groups: ['review'] }
    const plainA: SkillInventoryEntry = {
      name: 'plain-a',
      description: 'Ungrouped one',
      source: 'user-dsh',
      provider: 'filesystem',
      path: '/home/me/.dsh/skills/plain-a/SKILL.md',
      directory: '/home/me/.dsh/skills/plain-a',
      writable: true,
      modelInvocable: true,
      userInvocable: true,
    }
    const plainB = { ...plainA, name: 'plain-b', modelInvocable: false }
    const setInvocation = vi.fn(async () => {})
    render(<SkillsSection {...props({
      list: async () => ({ skills: [groupedA, plainA, plainB] }),
      get: async () => detail(plainA),
      setInvocation,
    })} />)
    await screen.findByText(groupedA.name)

    const ungroupedSwitch = screen.getByRole('switch', { name: en.groupToggleFor.replace('{group}', en.ungrouped) })
    expect((ungroupedSwitch as HTMLInputElement).checked).toBe(false)
    fireEvent.click(ungroupedSwitch)
    expect(setInvocation).toHaveBeenCalledTimes(2)
    expect(setInvocation).toHaveBeenCalledWith(plainA.name, true, true, {})
    expect(setInvocation).toHaveBeenCalledWith(plainB.name, true, true, {})
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('switch', { name: `Model invocation for ${plainA.name}` }).checked).toBe(true)
      expect(screen.getByRole<HTMLInputElement>('switch', { name: `Model invocation for ${plainB.name}` }).checked).toBe(true)
    })
  })

  it('opens the skill directory from the row and reports failures', async () => {
    const first = deferred<boolean>()
    const openDirectory = vi.fn(async () => { await first.promise })
    await renderCatalog({ openDirectory })

    const button = screen.getByRole('button', { name: `Open the directory containing ${writableSkill.name}` })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(openDirectory).toHaveBeenCalledTimes(1)
    expect(openDirectory).toHaveBeenCalledWith(writableSkill.directory)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: `Open the directory containing ${writableSkill.name}` }).disabled).toBe(true)
    first.resolve(true)
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: `Open the directory containing ${writableSkill.name}` }).disabled).toBe(false)
    })

    openDirectory.mockImplementationOnce(async () => { throw new Error('file manager missing') })
    fireEvent.click(screen.getByRole('button', { name: `Open the directory containing ${writableSkill.name}` }))
    expect((await screen.findByRole('alert')).textContent).toContain('file manager missing')
  })

  it('hides the open-directory control for skills without a directory', async () => {
    const runtime: SkillInventoryEntry = {
      name: 'runtime-skill',
      description: 'In-memory guidance',
      source: 'runtime',
      provider: 'runtime',
      writable: false,
      modelInvocable: true,
      userInvocable: false,
    }
    render(<SkillsSection {...props({
      list: async () => ({ skills: [runtime] }),
      get: async () => detail(runtime),
    })} />)
    await screen.findByText(runtime.name)
    expect(screen.queryByRole('button', { name: `Open the directory containing ${runtime.name}` })).toBeNull()
  })

  it('opens the editor from a writable row and ignores a read-only row click', async () => {
    const get = vi.fn(async () => detail())
    await renderCatalog({ get })

    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    expect(await screen.findByRole('dialog', { name: en.editorTitleEdit })).toBeTruthy()
    expect(get).toHaveBeenCalledWith(writableSkill.name, {})

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    fireEvent.click(screen.getByText(readOnlySkill.name).closest('button')!)
    expect(screen.queryByRole('dialog', { name: en.editorTitleEdit })).toBeNull()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('opens Edit when the same detail request was already started', async () => {
    const request = deferred<SkillInventoryDetail>()
    const get = vi.fn(() => request.promise)
    await renderCatalog({ get })

    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    expect(get).toHaveBeenCalledTimes(1)
    request.resolve(detail())

    expect(await screen.findByRole('dialog', { name: en.editorTitleEdit })).toBeTruthy()
  })

  it('updates the model-invocation Switch in place with pending and failure feedback', async () => {
    const first = deferred<boolean>()
    const setInvocation = vi.fn(async () => { await first.promise })
    await renderCatalog({ setInvocation })

    fireEvent.click(screen.getByRole('switch', { name: `Model invocation for ${writableSkill.name}` }))

    expect(setInvocation).toHaveBeenCalledWith(writableSkill.name, false, true, {})
    expect(screen.getByRole<HTMLInputElement>('switch', { name: `Model invocation for ${writableSkill.name}` }).disabled).toBe(true)
    first.resolve(true)
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('switch', { name: `Model invocation for ${writableSkill.name}` }).checked).toBe(false)
    })

    setInvocation.mockImplementationOnce(async () => { throw new Error('frontmatter is locked') })
    fireEvent.click(screen.getByRole('switch', { name: `Model invocation for ${writableSkill.name}` }))
    expect((await screen.findByRole('alert')).textContent).toContain('frontmatter is locked')

    // A non-Error rejection falls back to the localized failure copy.
    setInvocation.mockImplementationOnce(async () => { throw 'plain failure' })
    fireEvent.click(screen.getByRole('switch', { name: `Model invocation for ${writableSkill.name}` }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en.invocationFailed) })
    expect(setInvocation).toHaveBeenCalledTimes(3)
    expect(screen.getByRole<HTMLInputElement>('switch', { name: `Model invocation for ${writableSkill.name}` }).checked).toBe(false)
  })

  it('reloads for the active project and ignores a late response from the previous project', async () => {
    const first = deferred<{ skills: readonly typeof writableSkill[] }>()
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => scope.cwd === '/work/one'
      ? first.promise
      : Promise.resolve({ skills: [projectSkill] }))
    const firstSessions = sessionHook(sessionState('/work/one'))
    const secondSessions = sessionHook(sessionState('/work/two'))
    const { rerender } = render(<SkillsSection {...props({ list, useSessions: firstSessions })} />)

    rerender(<SkillsSection {...props({ list, useSessions: secondSessions })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    first.resolve({ skills: [writableSkill] })
    await waitFor(() => { expect(screen.queryByText(writableSkill.name)).toBeNull() })
    expect(list).toHaveBeenCalledWith({ sessionId: 'session-1', cwd: '/work/one' })
    expect(list).toHaveBeenCalledWith({ sessionId: 'session-1', cwd: '/work/two' })
  })

  it('shows the error view on a failed first load and retries from it', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('catalog down'))
      .mockResolvedValueOnce({ skills: [writableSkill] })
    render(<SkillsSection {...props({ list })} />)

    const failure = await screen.findByRole('alert')
    expect(failure.textContent).toContain(en.error)
    fireEvent.click(within(failure).getByRole('button', { name: en.retry }))
    expect(await screen.findByText(writableSkill.name)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores a late rejected catalog load after the project changes', async () => {
    const first = deferred<never>()
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => scope.cwd === '/work/one'
      ? first.promise as Promise<{ skills: readonly SkillInventoryEntry[] }>
      : Promise.resolve({ skills: [projectSkill] }))
    const { rerender } = render(<SkillsSection {...props({
      list,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)

    rerender(<SkillsSection {...props({
      list,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    first.reject(new Error('catalog down'))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(screen.getByText(projectSkill.name)).toBeTruthy()
  })

  it('reopens a cached detail without refetching', async () => {
    const get = vi.fn(async () => detail())
    await renderCatalog({ get })

    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    expect(await screen.findByRole('dialog', { name: en.editorTitleEdit })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    expect(await screen.findByRole('dialog', { name: en.editorTitleEdit })).toBeTruthy()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('ignores a late detail response and reports same-generation detail failures', async () => {
    const first = deferred<SkillInventoryDetail>()
    const get = vi.fn(() => first.promise)
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => Promise.resolve({
      skills: scope.cwd === '/work/one' ? [writableSkill] : [projectSkill],
    }))
    const { rerender } = render(<SkillsSection {...props({
      list,
      get,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    await screen.findByText(writableSkill.name)
    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)

    rerender(<SkillsSection {...props({
      list,
      get,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    first.resolve(detail())
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: en.editorTitleEdit })).toBeNull() })
  })

  it('reports a detail failure and ignores a late rejection', async () => {
    const late = deferred<SkillInventoryDetail>()
    const get = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('detail locked')))
      .mockImplementationOnce(() => late.promise)
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => Promise.resolve({
      skills: scope.cwd === '/work/one' ? [writableSkill] : [projectSkill],
    }))
    const { rerender } = render(<SkillsSection {...props({
      list,
      get,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    await screen.findByText(writableSkill.name)
    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    expect((await screen.findByRole('alert')).textContent).toContain('detail locked')

    rerender(<SkillsSection {...props({
      list,
      get,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    fireEvent.click(screen.getByText(projectSkill.name).closest('button')!)
    rerender(<SkillsSection {...props({
      list,
      get,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    expect(await screen.findByText(writableSkill.name)).toBeTruthy()
    await act(async () => { late.reject(new Error('late detail failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores a late invocation update after the project changes', async () => {
    const first = deferred<boolean>()
    const setInvocation = vi.fn(async () => { await first.promise })
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => Promise.resolve({
      skills: scope.cwd === '/work/one' ? [writableSkill] : [projectSkill],
    }))
    const { rerender } = render(<SkillsSection {...props({
      list,
      setInvocation,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    await screen.findByText(writableSkill.name)
    fireEvent.click(screen.getByRole('switch', { name: `Model invocation for ${writableSkill.name}` }))

    rerender(<SkillsSection {...props({
      list,
      setInvocation,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    first.resolve(true)
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('switch', { name: `Model invocation for ${projectSkill.name}` }).checked).toBe(true)
    })
  })

  it('keeps the last known cwd when a retained fallback row has no cwd', async () => {
    const projectSkill = { ...writableSkill, name: 'flicker-project', source: 'project-dsh' as const }
    const list = vi.fn(async (scope: { cwd?: string }) => ({ skills: scope.cwd === undefined ? [] : [projectSkill] }))
    const settled = sessionHook(sessionState('/work/x'))
    const { rerender } = render(<SkillsSection {...props({ list, useSessions: settled })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()

    // alpha.2 preserves a local row for retained references even when the
    // Host catalog entry is absent; its cwd can be temporarily unavailable.
    const rebuilt = sessionState('/work/x')
    delete rebuilt.byId['session-1' as SessionId]!.cwd
    rerender(<SkillsSection {...props({ list, useSessions: sessionHook(rebuilt) })} />)
    await waitFor(() => { expect(list).toHaveBeenLastCalledWith({ sessionId: 'session-1', cwd: '/work/x' }) })
    expect(screen.getByText(projectSkill.name)).toBeTruthy()
    expect(screen.queryByText(en.projectCatalogUnavailable)).toBeNull()
  })

  it('ignores catalog rows not retained by the main view and clears released scope', async () => {
    const list = vi.fn(async () => ({ skills: [] }))
    const state = sessionState('/work/main')
    const backgroundId = 'background' as SessionId
    state.byId = {
      [backgroundId]: { id: backgroundId, displayTitle: 'background', cwd: '/work/other', retainedBy: {}, running: true, blank: false, updatedAt: 2 },
      ...state.byId,
    }
    const { rerender } = render(<SkillsSection {...props({ list, useSessions: sessionHook(state) })} />)
    await waitFor(() => { expect(list).toHaveBeenLastCalledWith({ sessionId: 'session-1', cwd: '/work/main' }) })
    const released = sessionState('/work/main')
    released.byId['session-1' as SessionId] = { ...released.byId['session-1' as SessionId]!, retainedBy: {} }
    rerender(<SkillsSection {...props({ list, useSessions: sessionHook(released) })} />)
    await waitFor(() => { expect(list).toHaveBeenLastCalledWith({}) })
  })

  it('reloads when the active session changes without changing cwd', async () => {
    const first = deferred<{ skills: readonly typeof writableSkill[] }>()
    const secondSkill = { ...writableSkill, name: 'second-session-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { sessionId?: SessionId }) => scope.sessionId === 'session-one'
      ? first.promise
      : Promise.resolve({ skills: [secondSkill] }))
    const { rerender } = render(<SkillsSection {...props({
      list,
      useSessions: sessionHook(sessionState('/work/shared', 'session-one')),
    })} />)

    rerender(<SkillsSection {...props({
      list,
      useSessions: sessionHook(sessionState('/work/shared', 'session-two')),
    })} />)
    expect(await screen.findByText(secondSkill.name)).toBeTruthy()
    first.resolve({ skills: [writableSkill] })
    await waitFor(() => { expect(screen.queryByText(writableSkill.name)).toBeNull() })
    expect(list).toHaveBeenCalledWith({ sessionId: 'session-one', cwd: '/work/shared' })
    expect(list).toHaveBeenCalledWith({ sessionId: 'session-two', cwd: '/work/shared' })
  })

  it('ignores a save that finishes after the active project changes', async () => {
    const updateRequest = deferred<undefined>()
    const update = vi.fn(() => updateRequest.promise)
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => Promise.resolve({
      skills: scope.cwd === '/work/one' ? [writableSkill] : [projectSkill],
    }))
    const get = vi.fn(async () => detail())
    const { rerender } = render(<SkillsSection {...props({
      list,
      get,
      update,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    await screen.findByText(writableSkill.name)
    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    const dialog = await screen.findByRole('dialog', { name: en.editorTitleEdit })
    fireEvent.change(within(dialog).getByLabelText(en.content), { target: { value: 'Late revision' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    rerender(<SkillsSection {...props({
      list,
      get,
      update,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    updateRequest.resolve(undefined)
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(screen.queryByText(writableSkill.name)).toBeNull()
    expect(screen.queryByRole('dialog', { name: en.editorTitleEdit })).toBeNull()
  })

  it('opens the editor for a project skill without when-to-use text', async () => {
    const projectSkill: SkillInventoryEntry = {
      name: 'project-skill',
      description: 'Project guidance',
      source: 'project-dsh',
      provider: 'filesystem',
      path: '/work/project/.dsh/skills/project-skill/SKILL.md',
      directory: '/work/project/.dsh/skills/project-skill',
      writable: true,
      modelInvocable: true,
      userInvocable: true,
    }
    const get = vi.fn(async () => ({
      ...detail(projectSkill),
      ...projectSkill.groups === undefined ? {} : { groups: [...projectSkill.groups] },
    }))
    render(<SkillsSection {...props({
      list: async () => ({ skills: [projectSkill] }),
      get,
      useSessions: sessionHook(sessionState('/work/project')),
    })} />)
    await screen.findByText(projectSkill.name)
    fireEvent.click(screen.getByText(projectSkill.name).closest('button')!)
    const dialog = await screen.findByRole('dialog', { name: en.editorTitleEdit })
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.name).disabled).toBe(true)
  })

  it('picks groups from the dropdown, adds a new label by typing, and clears them', async () => {
    const groupedA = { ...writableSkill, name: 'group-a', groups: ['review'] }
    const groupedB = { ...writableSkill, name: 'group-b', groups: ['docs'] }
    const create = vi.fn(async () => {})
    render(<SkillsSection {...props({
      list: async () => ({ skills: [groupedA, groupedB] }),
      get: async () => detail(groupedA),
      create,
    })} />)
    await screen.findByText(groupedA.name)
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const dialog = screen.getByRole('dialog', { name: en.editorTitleAdd })

    // Selecting a group toggles a removable tag and keeps the menu open for more picks.
    fireEvent.click(within(dialog).getByRole('button', { name: en.groupOptionsLabel }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'review' }))
    expect(within(dialog).getByRole('button', { name: en.groupRemoveFor.replace('{group}', 'review') })).toBeTruthy()
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.group).value).toBe('')
    fireEvent.click(screen.getByRole('menuitem', { name: 'docs' }))
    expect(within(dialog).getByRole('button', { name: en.groupRemoveFor.replace('{group}', 'docs') })).toBeTruthy()

    // The clear-all row empties the selection.
    fireEvent.click(screen.getByRole('menuitem', { name: en.groupClearOption }))
    expect(within(dialog).queryByRole('button', { name: en.groupRemoveFor.replace('{group}', 'review') })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: en.groupRemoveFor.replace('{group}', 'docs') })).toBeNull()

    // A typed label commits on Enter without touching the input text.
    fireEvent.change(within(dialog).getByLabelText(en.group), { target: { value: 'brand-new' } })
    fireEvent.keyDown(within(dialog).getByLabelText(en.group), { key: 'Enter' })
    expect(within(dialog).getByRole('button', { name: en.groupRemoveFor.replace('{group}', 'brand-new') })).toBeTruthy()
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.group).value).toBe('')

    fireEvent.change(within(dialog).getByLabelText(en.name), { target: { value: 'new-skill' } })
    fireEvent.change(within(dialog).getByLabelText(en.description), { target: { value: 'Does work' } })
    fireEvent.change(within(dialog).getByLabelText(en.content), { target: { value: 'Instructions' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ groups: ['brand-new'] }))
    })
  })

  it('shows only the disabled clear row in the group dropdown when no groups exist', async () => {
    render(<SkillsSection {...props()} />)
    await screen.findByRole('button', { name: en.add })
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const dialog = screen.getByRole('dialog', { name: en.editorTitleAdd })
    fireEvent.click(within(dialog).getByRole('button', { name: en.groupOptionsLabel }))
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: en.groupClearOption }).disabled).toBe(true)
    expect(screen.queryByRole('menuitem', { name: 'review' })).toBeNull()
  })

  it('renders a multi-group skill in every one of its group sections', async () => {
    const multi = { ...writableSkill, name: 'multi-skill', groups: ['review', 'docs'] }
    const other = { ...writableSkill, name: 'other-skill', groups: ['review'] }
    render(<SkillsSection {...props({
      list: async () => ({ skills: [multi, other] }),
      get: async () => detail(multi),
    })} />)
    // The multi-group skill renders once per section.
    await screen.findAllByText(multi.name)

    const disclosures = screen.getAllByRole('button', { name: /skills/ }).filter(button => button.getAttribute('aria-expanded') !== null)
    expect(disclosures.map(button => button.textContent?.replace(/\d+ skills$/, '').trim())).toEqual(['review', 'docs'])

    const reviewSection = disclosures[0]!.closest('section')
    const docsSection = disclosures[1]!.closest('section')
    expect(within(reviewSection!).getByText(multi.name)).toBeTruthy()
    expect(within(reviewSection!).getByText(other.name)).toBeTruthy()
    expect(within(docsSection!).getByText(multi.name)).toBeTruthy()
    expect(within(docsSection!).queryByText(other.name)).toBeNull()

    // The result count still counts each skill once.
    expect(screen.getByText(en.resultCount.replace('{count}', '2'))).toBeTruthy()
  })

  it('removes a selected tag and saves the remaining group labels', async () => {
    const update = vi.fn(async () => {})
    const grouped = { ...writableSkill, groups: ['review', 'docs'] }
    render(<SkillsSection {...props({
      list: async () => ({ skills: [grouped] }),
      get: async () => detail(grouped),
      update,
    })} />)
    // The skill renders in both of its group sections; open the editor from either row.
    await screen.findAllByText(grouped.name)
    fireEvent.click(screen.getAllByText(grouped.name)[0]!.closest('button')!)
    const dialog = await screen.findByRole('dialog', { name: en.editorTitleEdit })
    fireEvent.click(within(dialog).getByRole('button', { name: en.groupRemoveFor.replace('{group}', 'review') }))
    expect(within(dialog).queryByRole('button', { name: en.groupRemoveFor.replace('{group}', 'review') })).toBeNull()
    expect(within(dialog).getByRole('button', { name: en.groupRemoveFor.replace('{group}', 'docs') })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ groups: ['docs'] }))
    })
  })

  it('creates a project skill with invocation flags and disables project scope without cwd', async () => {
    const create = vi.fn(async () => {})
    render(<SkillsSection {...props({ create })} />)
    await screen.findByRole('button', { name: en.add })
    fireEvent.click(screen.getByRole('button', { name: en.add }))

    const unavailableDialog = screen.getByRole('dialog', { name: en.editorTitleAdd })
    expect(within(unavailableDialog).getByRole<HTMLButtonElement>('button', { name: en.scopeProject }).disabled).toBe(true)
    expect(within(unavailableDialog).getByText(en.projectUnavailable)).toBeTruthy()
    fireEvent.click(within(unavailableDialog).getByRole('button', { name: en.scopeUser }))

    cleanup()
    render(<SkillsSection {...props({
      create,
      useSessions: sessionHook(sessionState('/work/project')),
    })} />)
    await screen.findByRole('button', { name: en.add })
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const projectDialog = screen.getByRole('dialog', { name: en.editorTitleAdd })
    fireEvent.click(within(projectDialog).getByRole('button', { name: en.scopeProject }))
    fireEvent.change(within(projectDialog).getByLabelText(en.name), { target: { value: 'new-skill' } })
    fireEvent.change(within(projectDialog).getByLabelText(en.description), { target: { value: 'Does work' } })
    fireEvent.change(within(projectDialog).getByLabelText(en.whenToUse), { target: { value: 'Use for releases' } })
    fireEvent.change(within(projectDialog).getByLabelText(en.group), { target: { value: 'releases' } })
    fireEvent.keyDown(within(projectDialog).getByLabelText(en.group), { key: 'Enter' })
    fireEvent.change(within(projectDialog).getByLabelText(en.content), { target: { value: 'Instructions' } })
    const switches = within(projectDialog).getAllByRole('switch')
    fireEvent.click(switches[0]!)
    fireEvent.click(within(projectDialog).getByRole('button', { name: en.save }))

    await waitFor(() => {
      expect(create).toHaveBeenLastCalledWith({
        name: 'new-skill',
        description: 'Does work',
        whenToUse: 'Use for releases',
        groups: ['releases'],
        content: 'Instructions',
        root: 'project-dsh',
        modelInvocable: false,
        userInvocable: true,
        sessionId: 'session-1',
        cwd: '/work/project',
      })
    })
  })

  it('reports a refresh failure after a successful create and retries the catalog load', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ skills: [] })
      .mockRejectedValueOnce(new Error('refresh unavailable'))
      .mockResolvedValueOnce({ skills: [writableSkill] })
    render(<SkillsSection {...props({ list })} />)
    fireEvent.click(await screen.findByRole('button', { name: en.add }))
    const dialog = screen.getByRole('dialog', { name: en.editorTitleAdd })
    fireEvent.change(within(dialog).getByLabelText(en.name), { target: { value: 'new-skill' } })
    fireEvent.change(within(dialog).getByLabelText(en.description), { target: { value: 'Does work' } })
    fireEvent.change(within(dialog).getByLabelText(en.content), { target: { value: 'Instructions' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    expect(await screen.findByText(en.refreshFailed)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: en.editorTitleAdd })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText(writableSkill.name)).toBeTruthy()
    expect(screen.queryByText(en.refreshFailed)).toBeNull()
  })

  it('shows field errors and preserves the editor while an asynchronous save fails', async () => {
    const create = vi.fn(async () => { throw new Error('directory already exists') })
    render(<SkillsSection {...props({ create })} />)
    await screen.findByRole('button', { name: en.add })
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const dialog = screen.getByRole('dialog', { name: en.editorTitleAdd })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    expect(within(dialog).getByText(en.nameRequired)).toBeTruthy()
    expect(within(dialog).getByText(en.descriptionRequired)).toBeTruthy()
    expect(within(dialog).getByText(en.contentRequired)).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText(en.name), { target: { value: 'new-skill' } })
    fireEvent.change(within(dialog).getByLabelText(en.description), { target: { value: 'Does work' } })
    fireEvent.change(within(dialog).getByLabelText(en.content), { target: { value: 'A'.repeat(2_000) } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    expect((await screen.findByRole('alert')).textContent).toContain('directory already exists')
    expect(screen.getByRole('dialog', { name: en.editorTitleAdd })).toBeTruthy()
    expect(create).toHaveBeenCalledOnce()
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.name).value).toBe('new-skill')
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.description).value).toBe('Does work')
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>(en.content).value).toBe('A'.repeat(2_000))
  })

  it('loads editing from the row and saves body and invocation changes', async () => {
    const update = vi.fn(async () => {})
    const get = vi.fn(async () => detail())
    await renderCatalog({ get, update })

    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    const dialog = await screen.findByRole('dialog', { name: en.editorTitleEdit })
    expect(get).toHaveBeenCalledWith(writableSkill.name, {})
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.name).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(en.group), { target: { value: 'workflows' } })
    fireEvent.keyDown(within(dialog).getByLabelText(en.group), { key: 'Enter' })
    fireEvent.change(within(dialog).getByLabelText(en.content), { target: { value: 'Revised instructions' } })
    fireEvent.click(within(dialog).getAllByRole('switch')[1]!)
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        name: writableSkill.name,
        description: writableSkill.description,
        whenToUse: writableSkill.whenToUse,
        groups: ['workflows'],
        content: 'Revised instructions',
        modelInvocable: true,
        userInvocable: false,
      })
    })
  })

  it('confirms directory deletion from the row delete control', async () => {
    const removeRequest = deferred<boolean>()
    const remove = vi.fn(async () => { await removeRequest.promise })
    await renderCatalog({ remove })

    openDelete()
    expect(screen.getByText(/entire skill directory/)).toBeTruthy()
    expect(screen.getByText(/every accompanying file/)).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: en.deleteConfirm })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(remove).toHaveBeenCalledWith(writableSkill.name, {})
    expect(remove).toHaveBeenCalledOnce()
    expect(confirm.disabled).toBe(true)
    expect(confirm.getAttribute('aria-busy')).toBe('true')
    expect(within(dialog).getByRole('button', { name: en.deleteConfirm })).toBe(confirm)
    // Close stays blocked while the deletion is pending.
    fireEvent.click(within(dialog).getByRole('button', { name: en.close }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    removeRequest.resolve(true)
    await waitFor(() => { expect(screen.queryByText(writableSkill.name)).toBeNull() })
  })

  it('reloads the catalog from the header refresh control', async () => {
    const list = vi.fn(async () => ({ skills: [writableSkill] }))
    render(<SkillsSection {...props({ list })} />)
    await screen.findByText(writableSkill.name)
    expect(list).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
  })

  it('searches GitHub skills and installs an exact result after confirmation', async () => {
    const result = {
      description: 'Automates browser work',
      namespace: '',
      path: 'browser/SKILL.md',
      repo: 'owner/skills',
      skillName: 'browser',
      stars: 42,
    }
    const list = vi.fn(async () => ({ skills: [] }))
    const searchHub = vi.fn(async () => [result])
    const installHub = vi.fn(async () => {})
    render(<SkillsSection {...props({ list, searchHub, installHub })} />)

    fireEvent.click(await screen.findByRole('button', { name: en.hubOpen }))
    let dialog = screen.getByRole('dialog', { name: en.hubTitle })
    fireEvent.change(within(dialog).getByRole('searchbox', { name: en.hubSearchLabel }), { target: { value: 'browser' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.hubSearch }))
    expect(await within(dialog).findByText(result.skillName)).toBeTruthy()
    expect(searchHub).toHaveBeenCalledWith('browser', 15, 'user-dsh', {})
    expect(within(dialog).getByText(/owner\/skills/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: en.hubInstall }))
    dialog = screen.getByRole('dialog', { name: en.hubConfirmTitle })
    expect(within(dialog).getByText(result.repo)).toBeTruthy()
    expect(within(dialog).getByText(result.path)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: en.hubInstallConfirm }))

    await waitFor(() => {
      expect(installHub).toHaveBeenCalledWith(result, 'user-dsh', {})
      expect(list).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByRole('dialog', { name: en.hubTitle })).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.hubInstalled }).disabled).toBe(true)
  })

  it('renders durable installed and local-name conflict search states without an install action', async () => {
    const installed = {
      description: 'Installed', namespace: '', path: 'browser/SKILL.md', repo: 'owner/skills',
      skillName: 'browser', stars: 4, installationStatus: 'installed' as const,
    }
    const conflict = {
      description: 'Conflict', namespace: '', path: 'review/SKILL.md', repo: 'owner/skills',
      skillName: 'review', stars: 3, installationStatus: 'conflict' as const,
    }
    render(<SkillsSection {...props({ searchHub: async () => [installed, conflict] })} />)
    fireEvent.click(await screen.findByRole('button', { name: en.hubOpen }))
    const dialog = screen.getByRole('dialog', { name: en.hubTitle })
    fireEvent.change(within(dialog).getByRole('searchbox', { name: en.hubSearchLabel }), { target: { value: 'skill' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.hubSearch }))
    expect(await within(dialog).findByText(installed.skillName)).toBeTruthy()
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: en.hubInstalled }).disabled).toBe(true)
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: en.hubConflict }).disabled).toBe(true)
  })

  it('installs GitHub skills into the current project and preserves a failed confirmation', async () => {
    const result = {
      description: '', namespace: '', path: '.github/skills/review/SKILL.md',
      repo: 'owner/project', skillName: 'review', stars: 1,
    }
    const installHub = vi.fn(async () => { throw new Error('skill already exists') })
    render(<SkillsSection {...props({
      searchHub: async () => [result],
      installHub,
      useSessions: sessionHook(sessionState('/work/project')),
    })} />)

    fireEvent.click(await screen.findByRole('button', { name: en.hubOpen }))
    let dialog = screen.getByRole('dialog', { name: en.hubTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: en.scopeProject }))
    expect(within(dialog).getByText(en.hubProjectScope.replace('{cwd}', '/work/project'))).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('searchbox', { name: en.hubSearchLabel }), { target: { value: 'review' } })
    fireEvent.keyDown(within(dialog).getByRole('searchbox', { name: en.hubSearchLabel }), { key: 'Enter' })
    fireEvent.click(await within(dialog).findByRole('button', { name: en.hubInstall }))
    dialog = screen.getByRole('dialog', { name: en.hubConfirmTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: en.hubInstallConfirm }))
    expect((await screen.findByRole('alert')).textContent).toContain('skill already exists')
    expect(installHub).toHaveBeenCalledOnce()
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: en.hubInstallConfirm }).disabled).toBe(false)
    expect(installHub).toHaveBeenCalledWith(result, 'project-dsh', {
      sessionId: 'session-1',
      cwd: '/work/project',
    })
    expect(screen.getByRole('dialog', { name: en.hubConfirmTitle })).toBeTruthy()
  })

  it('shows the no-results empty state when every row is filtered out', async () => {
    await renderCatalog()
    const search = screen.getByRole('searchbox', { name: en.searchLabel })
    fireEvent.change(search, { target: { value: 'no-such-skill' } })
    expect(screen.getByText(en.noResults)).toBeTruthy()
  })

  it('keeps the editor open while a save is pending even when close is clicked', async () => {
    const updateRequest = deferred<undefined>()
    const update = vi.fn(() => updateRequest.promise)
    await renderCatalog({ update })

    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    const dialog = await screen.findByRole('dialog', { name: en.editorTitleEdit })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
    fireEvent.click(within(dialog).getByRole('button', { name: en.close }))
    expect(screen.getByRole('dialog', { name: en.editorTitleEdit })).toBeTruthy()
    updateRequest.resolve(undefined)
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: en.editorTitleEdit })).toBeNull() })
  })

  it('clears whenToUse on edit when the field is emptied', async () => {
    const update = vi.fn(async () => {})
    const get = vi.fn(async () => detail())
    await renderCatalog({ get, update })

    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    const dialog = await screen.findByRole('dialog', { name: en.editorTitleEdit })
    fireEvent.change(within(dialog).getByLabelText(en.whenToUse), { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        name: writableSkill.name,
        groups: [],
      }))
    })
    const saved = (update.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
    expect(saved).not.toHaveProperty('whenToUse')
  })

  it('ignores a save that rejects after the active project changes', async () => {
    const updateRequest = deferred<never>()
    const update = vi.fn(() => updateRequest.promise as Promise<undefined>)
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => Promise.resolve({
      skills: scope.cwd === '/work/one' ? [writableSkill] : [projectSkill],
    }))
    const get = vi.fn(async () => detail())
    const { rerender } = render(<SkillsSection {...props({
      list,
      get,
      update,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    await screen.findByText(writableSkill.name)
    fireEvent.click(screen.getByText(writableSkill.name).closest('button')!)
    const dialog = await screen.findByRole('dialog', { name: en.editorTitleEdit })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    rerender(<SkillsSection {...props({
      list,
      get,
      update,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    await act(async () => { updateRequest.reject(new Error('late save failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('closes the delete dialog from its close control and its cancel button', async () => {
    await renderCatalog()

    openDelete()
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(screen.queryByRole('dialog')).toBeNull()

    openDelete()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports delete failures and ignores late delete outcomes', async () => {
    const failing = deferred<boolean>()
    const lateResolve = deferred<boolean>()
    const lateReject = deferred<boolean>()
    const remove = vi.fn()
      .mockImplementationOnce(() => failing.promise)
      .mockImplementationOnce(() => lateResolve.promise)
      .mockImplementationOnce(() => lateReject.promise)
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => Promise.resolve({
      skills: scope.cwd === '/work/one' ? [writableSkill] : [projectSkill],
    }))
    const { rerender } = render(<SkillsSection {...props({
      list,
      remove,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    await screen.findByText(writableSkill.name)
    openDelete()
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    await act(async () => { failing.reject(new Error('directory locked')) })
    expect(screen.getByRole('alert').textContent).toContain('directory locked')

    rerender(<SkillsSection {...props({
      list,
      remove,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    openDelete(projectSkill.name)
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    rerender(<SkillsSection {...props({
      list,
      remove,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    expect(await screen.findByText(writableSkill.name)).toBeTruthy()
    await act(async () => { lateResolve.resolve(true) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(writableSkill.name)).toBeTruthy()

    openDelete()
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    rerender(<SkillsSection {...props({
      list,
      remove,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    await act(async () => { lateReject.reject(new Error('late delete failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(projectSkill.name)).toBeTruthy()
  })

  it('ignores a late open-directory failure after the project changes', async () => {
    const pending = deferred<undefined>()
    const openDirectory = vi.fn(() => pending.promise)
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => Promise.resolve({
      skills: scope.cwd === '/work/one' ? [writableSkill] : [projectSkill],
    }))
    const { rerender } = render(<SkillsSection {...props({
      list,
      openDirectory,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    await screen.findByText(writableSkill.name)
    fireEvent.click(screen.getByRole('button', { name: `Open the directory containing ${writableSkill.name}` }))

    rerender(<SkillsSection {...props({
      list,
      openDirectory,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    await act(async () => { pending.reject(new Error('late open failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores a late row invocation failure after the project changes', async () => {
    const pending = deferred<undefined>()
    const setInvocation = vi.fn(() => pending.promise)
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => Promise.resolve({
      skills: scope.cwd === '/work/one' ? [writableSkill] : [projectSkill],
    }))
    const { rerender } = render(<SkillsSection {...props({
      list,
      setInvocation,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    await screen.findByText(writableSkill.name)
    fireEvent.click(screen.getByRole('switch', { name: `Model invocation for ${writableSkill.name}` }))

    rerender(<SkillsSection {...props({
      list,
      setInvocation,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    await act(async () => { pending.reject(new Error('late invocation failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores late group-toggle outcomes after the project changes', async () => {
    const first = deferred<undefined>()
    const second = deferred<undefined>()
    const setInvocation = vi.fn((name: string) => name === 'group-a' ? first.promise : second.promise)
    const groupedA = { ...writableSkill, name: 'group-a', groups: ['review'] }
    const groupedB = { ...writableSkill, name: 'group-b', groups: ['review'] }
    const projectSkill = { ...writableSkill, name: 'project-skill', source: 'project-dsh' as const }
    const list = vi.fn((scope: { cwd?: string }) => Promise.resolve({
      skills: scope.cwd === '/work/one' ? [groupedA, groupedB] : [projectSkill],
    }))
    const { rerender } = render(<SkillsSection {...props({
      list,
      setInvocation,
      useSessions: sessionHook(sessionState('/work/one')),
    })} />)
    await screen.findByText(groupedA.name)
    fireEvent.click(screen.getByRole('switch', { name: en.groupToggleFor.replace('{group}', 'review') }))

    rerender(<SkillsSection {...props({
      list,
      setInvocation,
      useSessions: sessionHook(sessionState('/work/two')),
    })} />)
    expect(await screen.findByText(projectSkill.name)).toBeTruthy()
    await act(async () => {
      first.resolve(undefined)
      second.reject(new Error('late group failure'))
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(projectSkill.name)).toBeTruthy()
  })
})
