// @vitest-environment jsdom
/** Desktop-only close-window row: present only when the shell can persist it. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubConfigForm, TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { CloseBehaviorRow } from '../src/client/CloseBehaviorRow.tsx'
import { AutoStartDesktopRow } from '../src/client/AutoStartDesktopRow.tsx'
import { DshbotRow } from '../src/client/DshbotRow.tsx'
import { ProjectRow } from '../src/client/ProjectRow.tsx'
import { RemoteWorkspaceRow } from '../src/client/RemoteWorkspaceRow.tsx'
import { WhaleAssistantRow } from '../src/client/WhaleAssistantRow.tsx'
import { PetSection } from '../src/client/PetSection.tsx'
import type { PetSectionInjected } from '../src/client/PetSection.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  delete (window as Window & { shell?: unknown }).shell
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('connection', {
    api: { settings: { describe: async () => ({ result: { ok: false } }) } },
    isLoopback: false,
  } as never)
  const remote = new TestRemote(ctx, {
    settings: { describe: async () => ({ ok: false }) },
    session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) },
  })
  remote.$host = { home: undefined, isLoopback: false }
  ctx.provide('configForms', { get: () => stubConfigForm().scope } as never)
  ctx.provide('shortcuts', { register: () => () => {} } as never)
  ctx.provide('modules', { entries: { dismissRelease: () => {}, releaseChange: () => {} } } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.trigger': { kind: 'single', scope: 'root' },
        'settings.header': { kind: 'single', scope: 'root' },
        'settings.action': { kind: 'list', scope: 'root' },
        'settings.close': { kind: 'single', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-settings-general desktop close-behavior row', () => {
  it('registers the row when the desktop shell can persist closeToTray', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ closeToTray: true }),
      saveConfig: async () => ({ closeToTray: true }),
    }
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const rows = b.slots.entries('settings.general.item')
    const closeRow = rows.find(row => row.options.id === 'close-behavior')!
    expect(closeRow.component).toBe(CloseBehaviorRow)
    expect(closeRow.options).toMatchObject({ id: 'close-behavior', order: 25 })
    expect(closeRow.locale).toBe('settings')
    const autoStartRow = rows.find(row => row.options.id === 'auto-start-desktop')!
    expect(autoStartRow.component).toBe(AutoStartDesktopRow)
    expect(autoStartRow.options).toMatchObject({ id: 'auto-start-desktop', order: 26 })
    const projectRow = b.slots.entries('settings.features.item')
      .find(row => row.options.id === 'project')!
    expect(projectRow.component).toBe(ProjectRow)
    expect(projectRow.options).toMatchObject({ id: 'project', order: 79 })
    expect(projectRow.locale).toBe('settings')
    const botRow = b.slots.entries('settings.features.item')
      .find(row => row.options.id === 'dshbot')!
    expect(botRow.component).toBe(DshbotRow)
    expect(botRow.options).toMatchObject({ id: 'dshbot', order: 80 })
    expect(botRow.locale).toBe('settings')
    const remoteWorkspaceRow = b.slots.entries('settings.features.item')
      .find(row => row.options.id === 'remote-workspace')!
    expect(remoteWorkspaceRow.component).toBe(RemoteWorkspaceRow)
    expect(remoteWorkspaceRow.options).toMatchObject({ id: 'remote-workspace', order: 81 })
    expect(remoteWorkspaceRow.locale).toBe('settings')
    const whaleRow = b.slots.entries('settings.features.item')
      .find(row => row.options.id === 'whale-assistant')!
    expect(whaleRow.component).toBe(WhaleAssistantRow)
    expect(b.slots.entries('settings.features.item').map(row => row.options.id))
      .toEqual(['whale-assistant', 'project', 'dshbot', 'remote-workspace'])
    await fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toEqual([])
    expect(b.slots.entries('settings.interface.item')).toEqual([])
    expect(b.slots.entries('settings.features.item')).toEqual([])
  })

  it('turning Project off leaves an open Lead for its Workspace or the no-directory Session', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ projectEnabled: true }),
      saveConfig: async () => ({ projectEnabled: false }),
    }
    const b = await bench()
    declare(b.slots)
    const opened: string[] = []
    let byId: Record<string, unknown> = {
      lead: { id: 'lead', cwd: '/repo', retainedBy: { mainView: 1 }, presentation: { owner: 'project', workingDirectory: '/repo' } },
    }
    const settled: string[] = []
    b.ctx.provide('sessions', {
      list: { getSnapshot: () => ({ byId }) },
      retain: (id: string) => ({ ready: Promise.resolve().then(() => { settled.push(id) }), release: () => {} }),
    } as never)
    b.ctx.provide('workspaces', { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-repo', path: '/repo' }] }) } } as never)
    b.ctx.provide('uiWorkspace', {
      openWorkspace: async (id: string) => {
        opened.push(`workspace:${id}`)
        byId = { ...byId, lead: { ...byId.lead as object, retainedBy: {} }, blank: { id: 'blank', cwd: '/repo', retainedBy: { mainView: 1 } } }
      },
      openNoDirectory: async () => { opened.push('no-directory') },
    } as never)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const row = b.slots.entries('settings.features.item').find(entry => entry.options.id === 'project')!
    const leave = () => (row.inject as unknown as () => { leaveProjectLead(): Promise<void> })().leaveProjectLead()
    await leave()
    expect(opened).toEqual(['workspace:ws-repo'])
    expect(settled).toEqual(['blank'])
    byId = { lead: { id: 'lead', cwd: '/elsewhere', retainedBy: { mainView: 1 }, presentation: { owner: 'project', workingDirectory: '/elsewhere' } } }
    await leave()
    expect(opened).toEqual(['workspace:ws-repo', 'no-directory'])
    byId = { chat: { id: 'chat', cwd: '/repo', retainedBy: { mainView: 1 } }, lead: { id: 'lead', cwd: '/repo', retainedBy: {}, presentation: { owner: 'project' } } }
    await leave()
    expect(opened).toHaveLength(2)
    await fiber.dispose()
  })

  it('withholds the row without a persistable desktop shell', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.general.item').some(row =>
      row.options.id === 'close-behavior' || row.options.id === 'auto-start-desktop')).toBe(false)
    expect(b.slots.entries('settings.interface.item')).toEqual([])
    expect(b.slots.entries('settings.section').some(row => row.options.id === 'features')).toBe(false)
  })
})

describe('ui-settings-general desktop pet section', () => {
  it('registers the pet section when the shell can write pet settings', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({}),
      saveConfig: async () => ({}),
      saveLive2dPetSettings: async () => ({ ok: true }),
    }
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const pet = b.slots.entries('settings.section').find(e => e.options.id === 'pet')!
    expect(pet.component).toBe(PetSection)
    expect(pet.options).toMatchObject({ id: 'pet', order: 40 })
    expect(pet.locale).toBe('settings')
    // The assistant's own fields mount through the section's child seat.
    expect(b.slots.spec('settings.pet.item')).toEqual({ kind: 'list', scope: 'root' })
    // The look picker's catalog read rides the injected session remote.
    const injected = (pet.inject as unknown as () => PetSectionInjected)()
    await expect(injected.modelCatalog()).resolves.toMatchObject({ ok: true })
    await fiber.dispose()
    expect(b.slots.entries('settings.section').find(e => e.options.id === 'pet')).toBeUndefined()
    expect(b.slots.spec('settings.pet.item')).toBeUndefined()
  })

  it('withholds the pet section without the pet write channel', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({}),
      saveConfig: async () => ({}),
    }
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section').find(e => e.options.id === 'pet')).toBeUndefined()
    expect(b.slots.spec('settings.pet.item')).toBeUndefined()
  })
})
