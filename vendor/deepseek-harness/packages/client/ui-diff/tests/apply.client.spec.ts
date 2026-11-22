/**
 * The diff page type's registrations, and their removal when the plugin goes.
 *
 * The registry is real; the slot and locale services are recorders, because
 * what matters is the keyed body under the definition's id, the guide entry,
 * and that disposal leaves neither a type nor a seat behind.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SidebarRightTabRegistry } from '../../ui-sidebar-right/src/client/tab-registry.ts'
import { DIFF_ID, DIFF_KIND, apply, inject } from '../src/client/index.ts'
import { DiffPanel, type DiffPanelInjected } from '../src/client/DiffPanel.tsx'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  key: string
  locale: string
  inject: (sessionId: string) => DiffPanelInjected
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const injectedSlots: string[] = []
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((name: string, register: () => () => void) => {
      injectedSlots.push(name)
      return ctx.effect(register)
    }),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const sessions = {
    list: {
      getSnapshot: () => ({
        byId: { 'session-diff': { cwd: '/tmp/repo' } },
      }),
    },
  }
  const openPath = vi.fn(async () => {})
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', { openPath } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, injectedSlots, registered, dictionaries, openPath, fiber }
}

describe('ui-diff apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sidebarRightTabs', 'sessions', 'workspaces'])
  })

  it('registers the type, guide, dictionaries, and keyed body under the definition id', async () => {
    const b = await boot()
    const definition = b.tabs.get(DIFF_KIND)
    expect(definition?.id).toBe(DIFF_ID)
    expect(definition?.priority).toBe('extension')
    expect(definition?.title('sidebar://diff')).toBe('type.label')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()]))
      .toEqual([[30, 'guide.title', 'guide.description']])
    expect(b.dictionaries.get('diff')).toEqual({ zh, en })
    expect(b.registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', DIFF_ID, 'diff', DiffPanel],
      ['surfaces.diff', undefined, 'diff', DiffPanel],
    ])
    expect(b.injectedSlots).toEqual(['sidebar.right.pane.tab', 'surfaces.diff'])
  })

  it('opens a diff path through the tab session workspace opener', async () => {
    const b = await boot()
    const injected = b.registered[0]!.inject('session-diff')
    await injected.openFile('README.md')
    expect(b.openPath).toHaveBeenCalledWith('/tmp/repo/README.md', { sessionId: 'session-diff' })
    await b.fiber.dispose()
  })

  it('injects appendComposerText onto both diff slots and safely no-ops without conversation', async () => {
    const b = await boot()
    const tabInjected = b.registered[0]!.inject('session-diff')
    const surfaceInjected = b.registered[1]!.inject('session-diff')
    expect(typeof tabInjected.appendComposerText).toBe('function')
    expect(typeof surfaceInjected.appendComposerText).toBe('function')
    // No conversation service registered -> should not throw.
    expect(() => {
      tabInjected.appendComposerText?.('session-diff', 'L1 `a.ts`')
    }).not.toThrow()
    await b.fiber.dispose()

    let draft = ''
    const setDraft = vi.fn((next: string) => { draft = next })
    const ctx = new Context()
    const tabs = new SidebarRightTabRegistry(ctx)
    const registered: Recorded[] = []
    ctx.provide('sidebarRightTabs', tabs as never)
    ctx.provide('slots', {
      inject: vi.fn((_name: string, register: () => () => void) => ctx.effect(register)),
      register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
        const entry = { ...options, component }
        registered.push(entry)
        return () => {}
      }),
    } as never)
    ctx.provide('locale', {
      bind: vi.fn(() => (key: string) => key),
      register: vi.fn(() => () => {}),
    } as never)
    ctx.provide('sessions', {
      list: { getSnapshot: () => ({ byId: { 'session-diff': { cwd: '/tmp/repo' } } }) },
      scope: vi.fn((id: string) => (id === 'session-diff' ? { sid: id } : undefined)),
    } as never)
    ctx.provide('workspaces', { openPath: vi.fn(async () => {}) } as never)
    ctx.provide('conversation', {
      input: {
        for: vi.fn(() => ({
          setDraft,
          state: { getSnapshot: () => ({ draft }) },
        })),
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    registered[0]!.inject('session-diff').appendComposerText?.('session-diff', 'L1 `a.ts`\n\n```diff\n+a\n```')
    expect(setDraft).toHaveBeenLastCalledWith('L1 `a.ts`\n\n```diff\n+a\n```')
    registered[1]!.inject('session-diff').appendComposerText?.('session-diff', 'L2 `b.ts`')
    expect(setDraft).toHaveBeenLastCalledWith('L1 `a.ts`\n\n```diff\n+a\n``` L2 `b.ts`')
    registered[1]!.inject('session-diff').appendComposerText?.('session-diff', 'L3 `c.ts`\n\n```diff\n+c\n```')
    expect(setDraft).toHaveBeenLastCalledWith('L1 `a.ts`\n\n```diff\n+a\n``` L2 `b.ts`\n\nL3 `c.ts`\n\n```diff\n+c\n```')
    await fiber.dispose()
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const b = await boot()
    await b.fiber.dispose()
    expect(b.tabs.get(DIFF_KIND)).toBeUndefined()
    expect(b.registered).toEqual([])
    expect(b.dictionaries.size).toBe(0)
  })
})
