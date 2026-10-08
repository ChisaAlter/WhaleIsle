import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionLogDownloadHeaderAction, SessionLogDownloadTitlebarAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadHeaderInjected } from '../src/client/HeaderAction.tsx'
import { apply, inject } from '../src/client/index.ts'

const SID = 'session-export-apply' as SessionId

afterEach(() => { vi.unstubAllGlobals() })

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'shell.titlebar.trailing': { kind: 'list', scope: 'root' },
      'settings.interface.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

async function bench(titlebarAction = false) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false })
  ctx.provide('remote', { $on: () => () => {} })
  const legacySettings = stubConfigForm<{ titlebarAction: boolean }>()
  legacySettings.publish({ status: 'ready', value: { titlebarAction }, revision: 1, writable: true })
  const getConfigForm = vi.fn(() => legacySettings.scope)
  ctx.provide('configForms', { get: getConfigForm } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, legacySettings, getConfigForm }
}

describe('session-log-download browser plugin', () => {
  it('places More after the Agent controls and retains only the shared result dialog despite a legacy titlebar opt-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    const b = await bench(true)
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote'])
    expect(b.ctx.sessionLogDownload).toBeDefined()
    expect(b.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    expect(b.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    const entry = b.slots.entries('shell.titlebar.trailing')[0]
    expect(entry?.component).toBe(SessionLogDownloadTitlebarAction)
    expect(entry?.options).toMatchObject({ id: 'session-log-download', order: 10 })
    const menu = b.slots.entries('conversation.session.header.actions')[0]
    expect(menu?.component).toBe(SessionLogDownloadHeaderAction)
    expect(menu?.options).toMatchObject({ id: 'session-log-download', order: 0 })
    const menuInjected = (menu?.inject as unknown as () => SessionLogDownloadHeaderInjected)()
    expect(menuInjected.hooks.sessionLogDownload).toBe(b.ctx.sessionLogDownload.store)
    expect(b.slots.entries('settings.interface.item')).toHaveLength(0)
    expect(b.getConfigForm).not.toHaveBeenCalled()
    expect(b.legacySettings.scope.getSnapshot().value?.titlebarAction).toBe(true)
    expect(menuInjected.hooks.feedbackAvailable.getSnapshot()).toBe(false)
    const injected = (entry?.inject as unknown as () => import('../src/client/Dialog.tsx').SessionLogDownloadDialogInjected)()
    expect(injected.hooks).not.toHaveProperty('titlebarAction')
    await menuInjected.request(SID)
    expect(b.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.status).toBe('error')
    injected.dismiss(SID)
    expect(b.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.open).toBe(false)

    await b.fiber.dispose()
    expect(b.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(b.slots.entries('shell.titlebar.trailing')).toHaveLength(0)
    expect(b.slots.entries('settings.interface.item')).toHaveLength(0)
  })

  it('tracks feedback plugin availability and ignores a stale action after it unloads', async () => {
    const b = await bench()
    const entry = b.slots.entries('conversation.session.header.actions')[0]
    const injected = (entry?.inject as unknown as () => SessionLogDownloadHeaderInjected)()
    const openSession = vi.fn()
    expect(injected.hooks.feedbackAvailable.getSnapshot()).toBe(false)
    injected.openFeedback(SID)
    expect(openSession).not.toHaveBeenCalled()

    const feedback = b.ctx.plugin((ctx: Context) => { ctx.provide('feedbackUi', { openSession }) })
    await feedback.await()
    await vi.waitFor(() => { expect(injected.hooks.feedbackAvailable.getSnapshot()).toBe(true) })
    injected.openFeedback(SID)
    expect(openSession).toHaveBeenCalledWith(SID)
    expect(b.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]).toBeUndefined()

    await feedback.dispose()
    await vi.waitFor(() => { expect(injected.hooks.feedbackAvailable.getSnapshot()).toBe(false) })
    injected.openFeedback(SID)
    expect(openSession).toHaveBeenCalledOnce()
    await b.fiber.dispose()
  })

  it('downloads only for an export execution acknowledged by this browser client', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    const first = await bench()
    const second = await bench()

    first.ctx.emit('command/executed', SID, 'plan', { kind: 'success' })
    expect(fetcher).not.toHaveBeenCalled()
    first.ctx.emit('command/executed', SID, 'export', { kind: 'error', text: 'bad path' })
    expect(fetcher).not.toHaveBeenCalled()
    first.ctx.emit('command/executed', SID, 'export', { kind: 'success' })
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledOnce()
      expect(first.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.status).toBe('error')
    })
    expect(second.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]).toBeUndefined()

    await first.fiber.dispose()
    await second.fiber.dispose()
  })

  it('re-registers after the declaring Header slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(b.slots.entries('shell.titlebar.trailing')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('conversation.session.header.actions')[0]?.component).toBe(SessionLogDownloadHeaderAction)
    expect(b.slots.entries('shell.titlebar.trailing')[0]?.component).toBe(SessionLogDownloadTitlebarAction)
    redeclare()
    await b.fiber.dispose()
  })
})
