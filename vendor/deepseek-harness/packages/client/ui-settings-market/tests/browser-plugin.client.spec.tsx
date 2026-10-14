// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { MarketSection } from '../src/client/MarketSection.tsx'
import type { MarketSectionInjected } from '../src/client/MarketSection.tsx'

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
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

function marketShell() {
  return {
    getMarketplaceDetails: vi.fn(async () => ({ ok: true, partial: false, readme: '', version: '', requirements: [] })),
    getMarketplaceState: vi.fn(async () => ({ ok: true, favorites: [], operations: [] })),
    setMarketplaceFavorite: vi.fn(async () => ({ ok: true, favorites: [], operations: [] })),
    updateMarketplacePlugins: vi.fn(async () => ({ ok: true })),
    listMarketplace: vi.fn(async () => ({
      ok: true,
      items: [],
      categories: [{ id: 'all', label: '全部', count: 0 }],
      fetchedAt: 0,
      source: 'cache',
      warning: '',
    })),
    listInstalledPlugins: vi.fn(async () => ({ ok: true, plugins: [{ name: 'demo', spec: '1.0.0' }] })),
    checkMarketplaceUpdates: vi.fn(async () => ({ ok: true, updates: {}, checkedAt: Date.now() })),
    installMarketplacePlugin: vi.fn(async () => ({ ok: true, harnessStarted: true })),
    updateMarketplacePlugin: vi.fn(async () => ({ ok: true, harnessStarted: true })),
    uninstallPlugin: vi.fn(async () => ({ ok: true, harnessStarted: true })),
    onPluginProgress: vi.fn(() => () => {}),
  }
}

describe('ui-settings-market browser plugin', () => {
  it('declares only the services used by the section contribution', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('does not register a market section without the desktop marketplace API', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('registers the market section when the desktop shell exposes the engine', async () => {
    const b = await bench()
    declare(b.slots)
    const shell = marketShell()
    ;(window as Window & { shell?: unknown }).shell = shell
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(MarketSection)
    expect(entry.options).toMatchObject({ id: 'market', order: 17 })
    const injected = (entry.inject as unknown as () => MarketSectionInjected)()
    await expect(injected.listCatalog()).resolves.toMatchObject({ ok: true, items: [] })
    // The main process localizes the payload from the active UI language.
    expect(shell.listMarketplace).toHaveBeenCalledWith({ locale: 'zh' })
    await expect(injected.listInstalled()).resolves.toEqual([{ name: 'demo', spec: '1.0.0' }])
    await expect(injected.checkUpdates()).resolves.toMatchObject({ ok: true, updates: {} })
    await expect(injected.install('acme/demo')).resolves.toMatchObject({ ok: true })
    await expect(injected.update('acme/demo')).resolves.toMatchObject({ ok: true })
    await expect(injected.uninstall('demo')).resolves.toMatchObject({ ok: true })
    await b.ctx.fiber.dispose()
  })

  it('recovers across late declaration', async () => {
    const b = await bench()
    ;(window as Window & { shell?: unknown }).shell = marketShell()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it.each([
    { status: 'failed', payload: { ok: false, plugins: [] } },
    { status: 'unknown', payload: { plugins: [] } },
  ])('rejects the localized installed-read error when the bridge status is $status', async ({ payload }) => {
    const b = await bench()
    declare(b.slots)
    ;(window as Window & { shell?: unknown }).shell = {
      ...marketShell(),
      listInstalledPlugins: vi.fn(async () => payload),
    }
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => MarketSectionInjected)()
    await expect(injected.listInstalled()).rejects.toThrow('无法读取已安装插件；当前列表可能不是最新状态。')
    await b.ctx.fiber.dispose()
  })

  it('propagates a rejected installed-plugin bridge request', async () => {
    const b = await bench()
    declare(b.slots)
    const failure = new Error('desktop bridge disconnected')
    ;(window as Window & { shell?: unknown }).shell = {
      ...marketShell(),
      listInstalledPlugins: vi.fn(async () => { throw failure }),
    }
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => MarketSectionInjected)()
    await expect(injected.listInstalled()).rejects.toBe(failure)
    await b.ctx.fiber.dispose()
  })

  it('accepts a successful installed-plugin payload without rows as an empty list', async () => {
    const b = await bench()
    declare(b.slots)
    ;(window as Window & { shell?: unknown }).shell = {
      ...marketShell(),
      listInstalledPlugins: vi.fn(async () => ({ ok: true })),
    }
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => MarketSectionInjected)()
    await expect(injected.listInstalled()).resolves.toEqual([])
    await b.ctx.fiber.dispose()
  })
})
