// @vitest-environment jsdom
// Conversation-owned settings rows and the peak/valley composer-dock entry.
// Chat View / StatsLine live in ui-chat after alpha.2.

import { describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime, usePinnedBrowserLanguages, stubSettingsScope, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BeamRowInjected } from '../src/client/settings/BeamRow.tsx'
import type { ResizeRowInjected } from '../src/client/settings/ResizeRow.tsx'
import type { StatsLineRowInjected } from '../src/client/settings/StatsLineRow.tsx'
import type { PeakValleySettingsRowInjected } from '../src/client/settings/PeakValleyRow.tsx'
import type { PeakValleyRowInjected } from '../src/client/chat/PeakValleyRow.tsx'
import type { ViewTabsRowInjected } from '../src/client/settings/ViewTabsRow.tsx'
import type { TypingFxRowInjected } from '../src/client/settings/TypingFxRow.tsx'
import { DEFAULT_COMPOSER_BEAM_STYLE, DEFAULT_TYPING_FX_STYLE } from '../src/submission-settings.ts'

usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId
const CHILD = 'child-1' as SessionId

async function bench() {
  const runtime = await SlotTestRuntime.create()
  await runtime.mount({ apply: installConnection })
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  runtime.ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  runtime.ctx.provide('uiWorkspace', { connectWorkspace: vi.fn(async () => ROOT) } as never)
  await runtime.sessions.add({
    id: ROOT,
    summary: { title: 'R', displayTitle: 'R', cwd: '/proj' },
  })
  await runtime.sessions.add({
    id: CHILD,
    summary: { title: 'C', displayTitle: 'C', cwd: '/proj', parentId: ROOT },
  })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)

  await runtime.root.declare({
    'main': { kind: 'keyed', scope: 'root' },
    'settings.general.item': { kind: 'list', scope: 'root' },
    'settings.interface.item': { kind: 'list', scope: 'root' },
    'settings.appearance.item': { kind: 'list', scope: 'root' },
    'settings.conversation.item': { kind: 'list', scope: 'root' },
    'settings.usage.item': { kind: 'list', scope: 'root' },
  }, (_p: { renderSlot?: unknown }) => null)

  const feature = await runtime.mount({ inject: [...inject], apply })
  return { runtime, feature, slots: runtime.slots }
}

describe('conversation apply wiring (desktop peak/valley + session cost)', () => {
  it('provides the conversation service without installing Chat', async () => {
    const b = await bench()
    expect(b.runtime.ctx.get('conversation')).toBeDefined()
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
    await b.runtime.dispose()
  })

  it('registers its settings rows on the Conversation, Interface, Appearance and usage pages', async () => {
    const b = await bench()
    const row = (slot: 'settings.interface.item' | 'settings.appearance.item' | 'settings.usage.item', id: string) =>
      b.slots.entries(slot).find(entry => entry.options.id === id)
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
    expect(b.slots.entries('settings.conversation.item').map(entry => entry.options.id))
      .toEqual(['composer-enter', 'next-prompt', 'custom-instructions'])
    expect(b.slots.entries('settings.interface.item').map(entry => entry.options.id))
      .toEqual(['composer-resize', 'stats-line', 'view-tabs'])
    expect(b.slots.entries('settings.usage.item').map(entry => entry.options.id))
      .toEqual(['session-cost', 'official-peak-valley'])
    const beam = row('settings.appearance.item', 'composer-beam')
    const beamInjected = (beam?.inject as unknown as () => BeamRowInjected)()
    expect(beamInjected.hooks.composerBeam.getSnapshot()).toBe(true)
    expect(beamInjected.hooks.composerBeamStyle.getSnapshot()).toEqual(DEFAULT_COMPOSER_BEAM_STYLE)
    beamInjected.setComposerBeam(false)
    expect(beamInjected.hooks.composerBeam.getSnapshot()).toBe(false)
    beamInjected.setComposerBeamStyle({ ...DEFAULT_COMPOSER_BEAM_STYLE, hue: 90 })
    expect(beamInjected.hooks.composerBeamStyle.getSnapshot().hue).toBe(90)
    const resize = row('settings.interface.item', 'composer-resize')
    const resizeInjected = (resize?.inject as unknown as () => ResizeRowInjected)()
    expect(resizeInjected.hooks.composerResize.getSnapshot()).toBe(false)
    resizeInjected.setComposerResize(true)
    expect(resizeInjected.hooks.composerResize.getSnapshot()).toBe(true)
    const stats = row('settings.interface.item', 'stats-line')
    const statsInjected = (stats?.inject as unknown as () => StatsLineRowInjected)()
    expect(statsInjected.hooks.statsLine.getSnapshot()).toBe(true)
    statsInjected.setStatsLine(false)
    expect(statsInjected.hooks.statsLine.getSnapshot()).toBe(false)
    const tabs = row('settings.interface.item', 'view-tabs')
    const tabsInjected = (tabs?.inject as unknown as () => ViewTabsRowInjected)()
    expect(tabsInjected.hooks.viewTabs.getSnapshot()).toBe(true)
    tabsInjected.setViewTabs(false)
    expect(tabsInjected.hooks.viewTabs.getSnapshot()).toBe(false)
    const peakValley = row('settings.usage.item', 'official-peak-valley')
    const peakValleyInjected = (peakValley?.inject as unknown as () => PeakValleySettingsRowInjected)()
    expect(peakValleyInjected.hooks.peakValley.getSnapshot()).toBe(false)
    peakValleyInjected.setPeakValley(true)
    expect(peakValleyInjected.hooks.peakValley.getSnapshot()).toBe(true)
    const typingFx = b.slots.entries('settings.appearance.item').filter(entry => entry.options.id === 'composer-typing-fx')
    expect(b.slots.entries('settings.appearance.item').map(entry => entry.options.id).sort())
      .toEqual(['composer-beam', 'composer-typing-fx'])
    const typingFxInjected = (typingFx[0]?.inject as unknown as () => TypingFxRowInjected)()
    expect(typingFxInjected.hooks.typingFx.getSnapshot()).toBe(false)
    expect(typingFxInjected.hooks.typingFxStyle.getSnapshot()).toEqual(DEFAULT_TYPING_FX_STYLE)
    typingFxInjected.setTypingFx(true)
    expect(typingFxInjected.hooks.typingFx.getSnapshot()).toBe(true)
    await b.runtime.dispose()
  })

  it('mounts the peak/valley composer-dock entry with a per-session model fact', async () => {
    const b = await bench()
    expect(b.slots.entries('conversation.composer.dock').map(e => e.options.id)).toEqual(['peak-valley'])
    const dockPeakValley = b.slots.entries('conversation.composer.dock')[0]
    const dockInjected = (dockPeakValley?.inject as unknown as (id: SessionId) => PeakValleyRowInjected)(ROOT)
    expect(dockInjected.hooks.peakValley.getSnapshot()).toBe(false)
    expect(dockInjected.hooks.modelProvider.getSnapshot()).toEqual({ provider: null })
    const other = (dockPeakValley?.inject as unknown as (id: SessionId) => PeakValleyRowInjected)(CHILD)
    expect(other.hooks.modelProvider).not.toBe(dockInjected.hooks.modelProvider)
    await b.runtime.dispose()
  })

  it('plugin fiber disposal collects conversation registrations', async () => {
    const b = await bench()
    await b.feature.dispose()
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
    expect(b.slots.entries('settings.interface.item')).toHaveLength(0)
    expect(b.slots.entries('settings.appearance.item')).toHaveLength(0)
    expect(b.slots.entries('settings.conversation.item')).toHaveLength(0)
    expect(b.slots.entries('settings.usage.item')).toHaveLength(0)
    expect(b.runtime.ctx.get('conversation')).toBeUndefined()
    await b.runtime.dispose()
  })
})
