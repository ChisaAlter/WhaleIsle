import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SidebarRightOpenTab } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TeamAction, type TeamActionInjected } from '../src/client/TeamAction.tsx'
import { TeamSidebar } from '../src/client/TeamSidebar.tsx'
import { apply, inject, TEAM_SIDEBAR_ID, TEAM_SIDEBAR_KIND } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SESSION = 'team-session' as SessionId
const CHILD = 'team-child' as SessionId

async function bench(options: { addressed?: boolean; sidebar?: boolean } = {}) {
  const ctx = new Context()
  const navigation: unknown[] = []
  const tabTypes = new Set<{ id: string; kind: string; title: () => string }>()
  const openTabs = createSnapshotStore<readonly SidebarRightOpenTab[]>([])
  const mounted = createSnapshotStore<SessionId | undefined>(SESSION)
  let expanded = true
  if (options.sidebar === true) {
    ctx.provide('sidebarRight', {
      openTabs,
      mounted,
      isExpanded: () => expanded,
      toggleExpanded: () => { expanded = !expanded; navigation.push(['sidebar-expanded', expanded]) },
      openResource: (address: string, opening: unknown) => { navigation.push(['aside', address, opening]) },
      openTabIn: (sessionId: SessionId, kind: string) => { navigation.push(['team-sidebar', sessionId, kind]); return true },
    } as never)
    ctx.provide('sidebarRightTabs', {
      register: (definition: { id: string; kind: string; title: () => string }) => {
        tabTypes.add(definition)
        return () => { tabTypes.delete(definition) }
      },
    } as never)
  }
  let mainSessionId = options.addressed === true ? CHILD : SESSION
  ctx.provide('sessions', {
    binding: (id: SessionId) => options.addressed === true && id === CHILD
      ? { session: { getSnapshot: () => ({
        subagent: {
          address: {
            parentSessionId: SESSION,
            childSessionId: CHILD,
            mode: 'continuable' as const,
          },
        },
      }) } }
      : undefined,
    refreshProjections: (id: SessionId) => {
      navigation.push(['refresh', id])
      return Promise.resolve()
    },
    retainInfo: (id: SessionId) => ({
      getSnapshot: () => ({
        referenceCount: id === mainSessionId ? 1 : 0,
        retainedBy: id === mainSessionId ? { mainView: 1 } : {},
      }),
      subscribe: () => () => {},
    }),
  })
  ctx.provide('uiWorkspace', {
    openSession: (target: unknown) => { navigation.push(['open', target]) },
  } as never)
  ctx.provide('conversation', {})
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  const collapseHeader = ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = () => ctx.slots.entries('conversation.session.header.actions')
    .find(candidate => candidate.component === TeamAction)
  const actions = (): TeamActionInjected => {
    const injected = entry()!.inject!()
    const { openTeammate } = injected
    if (typeof openTeammate !== 'function') {
      throw new Error('Team header action lacks its injected callbacks')
    }
    return {
      openTeammate: openTeammate as TeamActionInjected['openTeammate'],
    }
  }
  const page = () => ctx.slots.entries('sidebar.right.pane.tab')
    .find(candidate => candidate.component === TeamSidebar)
  return {
    ctx,
    fiber,
    navigation,
    tabTypes,
    page,
    entry,
    actions,
    collapseHeader,
    openTabs,
    mounted,
    setExpanded: (next: boolean) => { expanded = next },
    select: (sessionId: SessionId) => { mainSessionId = sessionId },
  }
}

describe('ui-team browser plugin', () => {
  it('registers one disposable header action without a Team Remote namespace', async () => {
    const b = await bench()
    expect(inject).toEqual(['sessions', 'uiWorkspace', 'slots', 'locale'])
    expect(b.entry()).toMatchObject({
      options: { id: 'agent-team', order: -20 },
      locale: 'agent-team',
    })
    const t = b.ctx.locale.bind('agent-team')
    expect(t('trigger')).toBe('Agent Team')

    expect(b.navigation).toEqual([])

    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(t('empty')).toBe('empty')
  })

  it('opens a continuable teammate address without touching the parent catalog', async () => {
    const b = await bench()
    b.actions().openTeammate(SESSION, CHILD)
    expect(b.navigation).toEqual([
      ['open', { parentSessionId: SESSION, childSessionId: CHILD, mode: 'continuable' }],
    ])
  })

  it('routes teammate navigation from an addressed teammate conversation back through its Lead', async () => {
    const b = await bench({ addressed: true })
    b.actions().openTeammate(CHILD, CHILD)
    expect(b.navigation).toEqual([
      ['open', { parentSessionId: SESSION, childSessionId: CHILD, mode: 'continuable' }],
    ])
  })

  it('opens the Lead from an addressed teammate conversation', async () => {
    const b = await bench({ addressed: true })
    b.actions().openTeammate(CHILD, SESSION)
    expect(b.navigation).toEqual([['open', SESSION]])
  })

  it('does not open a teammate from a conversation outside the main view', async () => {
    const b = await bench()
    b.select('other-session' as SessionId)
    b.actions().openTeammate(SESSION, CHILD)
    expect(b.navigation).toEqual([])
  })

  it('re-registers after the conversation header slot is collapsed and declared again', async () => {
    const b = await bench()
    expect(b.entry()).toBeDefined()
    b.collapseHeader()
    expect(b.entry()).toBeUndefined()
    b.ctx.slots.register({
      name: 'root',
      children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(b.entry()).toBeDefined()
  })

  it('registers a disposable Team Sidebar page only when the Sidebar is present', async () => {
    const without = await bench()
    expect(without.page()).toBeUndefined()

    const b = await bench({ sidebar: true })
    expect([...b.tabTypes].map(type => [type.id, type.kind, type.title()]))
      .toEqual([[TEAM_SIDEBAR_ID, TEAM_SIDEBAR_KIND, 'Agent Team']])
    expect(b.page()).toMatchObject({ locale: 'agent-team' })

    await b.fiber.dispose()
    expect(b.tabTypes.size).toBe(0)
    expect(b.page()).toBeUndefined()
  })

  it('opens a member beside the Team page and the Lead in the main view', async () => {
    const b = await bench({ sidebar: true })
    const aside = b.page()!.inject!() as unknown as TeamActionInjected
    aside.openTeammate(SESSION, CHILD)
    aside.openTeammate(SESSION, SESSION)
    expect(b.navigation).toEqual([
      ['aside', `dsh-resource://subagentchat/session/${CHILD}?parent=${SESSION}&mode=continuable`,
        { kind: 'subagentchat' }],
      ['open', SESSION],
    ])
  })

  it('provides owner task scopes that every Team view reads and that dispose with the plugin', async () => {
    const b = await bench({ sidebar: true })
    const scopes = b.ctx.get('agentTeamScopes')!
    const header = (b.entry()!.inject!() as unknown as { hooks: { teamTaskScopes: { getSnapshot: () => Record<string, readonly string[]> } } }).hooks.teamTaskScopes
    const aside = (b.page()!.inject!() as unknown as { hooks: { teamTaskScopes: typeof header } }).hooks.teamTaskScopes
    scopes.set(SESSION, ['task-b', 'task-a'])
    expect(header.getSnapshot()).toEqual({ [SESSION]: ['task-b', 'task-a'] })
    expect(aside.getSnapshot()).toBe(header.getSnapshot())
    scopes.set(SESSION, undefined)
    expect(header.getSnapshot()).toEqual({})
    await b.fiber.dispose()
    expect(b.ctx.get('agentTeamScopes')).toBeUndefined()
  })

  it('publishes owner Job activity independently of task scopes and shares it with both Team views', async () => {
    const b = await bench({ sidebar: true })
    const scopes = b.ctx.get('agentTeamScopes')!
    const header = b.entry()!.inject!()
    const aside = b.page()!.inject!()
    expect(header.hooks).toMatchObject({ teamActivity: scopes.activitySource })
    expect(aside.hooks).toMatchObject({ teamActivity: scopes.activitySource })
    scopes.set(SESSION, ['current-task'])
    scopes.setActivity(SESSION, { state: 'ready', runningJobSessionIds: [CHILD] })
    expect(scopes.activitySource.getSnapshot()).toEqual({ [SESSION]: { state: 'ready', runningJobSessionIds: [CHILD] } })
    scopes.setActivity(SESSION, { state: 'unavailable', runningJobSessionIds: [CHILD] })
    expect(scopes.activitySource.getSnapshot()[SESSION]?.state).toBe('unavailable')
    expect(scopes.source.getSnapshot()).toEqual({ [SESSION]: ['current-task'] })
    scopes.setActivity(SESSION, undefined)
    expect(scopes.activitySource.getSnapshot()).toEqual({})
    await b.fiber.dispose()
    expect(b.ctx.get('agentTeamScopes')).toBeUndefined()
  })

  it('offers manual Team Sidebar opening without opening it during registration and shares the view handle', async () => {
    const without = await bench()
    expect(without.entry()!.inject!().openTeamSidebar).toBeUndefined()
    const b = await bench({ sidebar: true })
    expect(b.navigation).toEqual([])
    const header = b.entry()!.inject!()
    expect(header.openTeamSidebar).toBeTypeOf('function')
    const open = header.openTeamSidebar as NonNullable<TeamActionInjected['openTeamSidebar']>
    expect(open(SESSION)).toBe(true)
    expect(b.navigation).toEqual([['team-sidebar', SESSION, TEAM_SIDEBAR_KIND]])
    expect(b.entry()!.store).toBe(b.page()!.store)
  })

  it('collapses a returned observer dock only when the mounted Session has no other content tabs', async () => {
    const b = await bench({ sidebar: true })
    const collapse = b.page()!.inject!().collapseEmptyObserver as NonNullable<TeamActionInjected['collapseEmptyObserver']>
    const guide: SidebarRightOpenTab = { sessionId: SESSION, tabId: 'guide-tab' as SidebarRightOpenTab['tabId'], kind: 'guide', contentId: 'sidebar://guide' }
    const content: SidebarRightOpenTab = { sessionId: SESSION, tabId: 'member-tab' as SidebarRightOpenTab['tabId'], kind: 'subagentchat', contentId: 'dsh-resource://subagentchat/session/member' }
    b.openTabs.set([guide, content])
    collapse(SESSION)
    expect(b.navigation).toEqual([])
    b.openTabs.set([guide])
    b.mounted.set(CHILD)
    collapse(SESSION)
    expect(b.navigation).toEqual([])
    b.mounted.set(SESSION)
    b.setExpanded(false)
    collapse(SESSION)
    expect(b.navigation).toEqual([])
    b.setExpanded(true)
    b.openTabs.set([guide, { ...content, sessionId: CHILD }])
    collapse(SESSION)
    expect(b.navigation).toEqual([['sidebar-expanded', false]])
    collapse(SESSION)
    expect(b.navigation).toEqual([['sidebar-expanded', false]])
  })

  it('keeps the node half inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
