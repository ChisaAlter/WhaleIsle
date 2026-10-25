// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { RemoteSection } from '../src/client/RemoteSection.tsx'
import { RemoteMenuAction } from '../src/client/RemoteSection.tsx'
import type { RemoteSectionInjected } from '../src/client/RemoteSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'settings.launcher': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-settings-remote browser plugin', () => {
  it('declares only the services used by the sidebar contribution', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('does not register a Remote control without the desktop remote API', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('registers a Remote footer action when the desktop shell can pair', async () => {
    const b = await bench()
    declare(b.slots)
    const shell = {
      getRemote: vi.fn(async () => ({ enabled: false, urls: [] })),
      saveRemote: vi.fn(async () => ({ enabled: true, urls: [] })),
      revokeRemotePairingLink: async () => ({ enabled: true, urls: [] }),
      rotateRemoteToken: vi.fn(async () => ({ enabled: true, urls: [] })),
      unbindRemoteDevice: vi.fn(async () => ({ enabled: true, urls: [], devices: [] })),
      renameRemoteDevice: vi.fn(async () => ({ enabled: true, urls: [], devices: [] })),
    }
    ;(window as Window & { shell?: unknown }).shell = shell
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('sidebar.footer.action')[0]!
    expect(entry.component).toBe(RemoteSection)
    expect(entry.options).toMatchObject({ id: 'remote', order: 80 })
    const injected = (entry.inject as unknown as () => RemoteSectionInjected)()
    await expect(injected.getRemote()).resolves.toEqual({ enabled: false, urls: [] })
    await expect(injected.saveRemote({ remoteEnabled: true })).resolves.toEqual({ enabled: true, urls: [] })
    await expect(injected.unbindRemoteDevice('dev-1')).resolves.toEqual({ enabled: true, urls: [], devices: [] })
    await expect(injected.renameRemoteDevice('dev-1', 'Pixel 8')).resolves.toEqual({ enabled: true, urls: [], devices: [] })
    await b.ctx.fiber.dispose()
  })

  it('recovers across late declaration', async () => {
    const b = await bench()
    ;(window as Window & { shell?: unknown }).shell = {
      getRemote: async () => ({ enabled: false, urls: [] }),
      saveRemote: async () => ({ enabled: false, urls: [] }),
      revokeRemotePairingLink: async () => ({ enabled: true, urls: [] }),
      rotateRemoteToken: async () => ({ enabled: false, urls: [] }),
      unbindRemoteDevice: async () => ({ enabled: false, urls: [], devices: [] }),
      renameRemoteDevice: async () => ({ enabled: false, urls: [], devices: [] }),
    }
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1) })
    stop()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('moves Remote into a late account launcher and restores the footer fallback when it leaves', async () => {
    const b = await bench()
    declare(b.slots)
    ;(window as Window & { shell?: unknown }).shell = {
      getRemote: async () => ({ enabled: false, urls: [] }),
      saveRemote: async () => ({ enabled: false, urls: [] }),
      revokeRemotePairingLink: async () => ({ enabled: true, urls: [] }),
      rotateRemoteToken: async () => ({ enabled: false, urls: [] }),
      unbindRemoteDevice: async () => ({ enabled: false, urls: [], devices: [] }),
      renameRemoteDevice: async () => ({ enabled: false, urls: [], devices: [] }),
    }
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1)
    const stopAccount = b.slots.register({
      name: 'settings.launcher',
      children: { 'settings.launcher.action': { kind: 'list', scope: 'root' } },
    } as never, (() => null) as never)
    await vi.waitFor(() => {
      expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
      expect(b.slots.entries('settings.launcher.action')).toHaveLength(1)
    })
    const action = b.slots.entries('settings.launcher.action')[0]!
    expect(action.component).toBe(RemoteMenuAction)
    expect(action.options).toMatchObject({ id: 'remote', order: 50 })
    stopAccount()
    await vi.waitFor(() => { expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1) })
    await b.ctx.fiber.dispose()
  })

  it('registers only the account action when the launcher is already present', async () => {
    const b = await bench()
    declare(b.slots)
    const stopAccount = b.slots.register({
      name: 'settings.launcher',
      children: { 'settings.launcher.action': { kind: 'list', scope: 'root' } },
    } as never, (() => null) as never)
    ;(window as Window & { shell?: unknown }).shell = {
      getRemote: async () => ({ enabled: false, urls: [] }),
      saveRemote: async () => ({ enabled: false, urls: [] }),
      revokeRemotePairingLink: async () => ({ enabled: true, urls: [] }),
      rotateRemoteToken: async () => ({ enabled: false, urls: [] }),
      unbindRemoteDevice: async () => ({ enabled: false, urls: [], devices: [] }),
      renameRemoteDevice: async () => ({ enabled: false, urls: [], devices: [] }),
    }
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(b.slots.entries('settings.launcher.action').map(entry => entry.options.id)).toEqual(['remote'])
    stopAccount()
    await vi.waitFor(() => { expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1) })
    await b.ctx.fiber.dispose()
  })
})
