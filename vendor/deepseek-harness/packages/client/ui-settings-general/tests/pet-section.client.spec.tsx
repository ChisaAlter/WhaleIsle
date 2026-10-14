// @vitest-environment jsdom
// 鲸鱼娘 section：从 desktop config 读 live2dPet，经 shell:live2d-pet-settings
// 通道回写（主进程规范化+持久化+推送到宠物窗）；whaleAssistantEnabled 走
// 通用 saveConfig（自带 Harness 重启分支）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PetSection } from '../src/client/PetSection.tsx'
import type { PetSectionProps } from '../src/client/PetSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

function translate(key: string, params?: Record<string, string>) {
  let text = (en as Record<string, string>)[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, value)
    }
  }
  return text
}

function mount(opts?: {
  modelCatalog?: PetSectionProps['modelCatalog']
  renderSlot?: PetSectionProps['renderSlot']
}) {
  const props = {
    t: translate,
    modelCatalog: opts?.modelCatalog ?? (() => Promise.resolve({ ok: true, value: { groups: [] } })),
    renderSlot: opts?.renderSlot ?? (() => null),
  } as PetSectionProps
  render(<PetSection {...props} />)
}

function openDesktopTab() {
  fireEvent.click(screen.getByRole('tab', { name: en['pet.tab.desktop'] }))
}

const NORMALIZED = {
  scale: 1.4,
  opacity: 1,
  personality: 'tsundere',
  activity: 'active',
  selfTalk: true,
  wander: false,
  lockPosition: false,
  shiftToDrag: false,
  powerSave: false,
  clickSound: false,
  chatEnabled: true,
  lookModel: 'vis-1',
}

const CONFIG = {
  live2dPet: {
    enabled: true,
    settings: { ...NORMALIZED, wander: true, lookModel: '' },
  },
  whaleAssistantEnabled: false,
}

function shellWith(config: Record<string, unknown> = CONFIG) {
  const saveLive2dPetSettings = vi.fn(async (body: { enabled?: boolean }) => ({
    ok: true as const,
    enabled: body.enabled,
    settings: { ...NORMALIZED },
  }))
  const saveConfig = vi.fn(async () => ({}))
  ;(window as Window & { shell?: unknown }).shell = {
    getConfig: async () => config,
    saveConfig,
    saveLive2dPetSettings,
  }
  return { saveLive2dPetSettings, saveConfig }
}

describe('PetSection', () => {
  it('loads live2dPet from the config and writes switches through saveLive2dPetSettings', async () => {
    const { saveLive2dPetSettings } = shellWith()
    mount()
    openDesktopTab()
    const wander = await screen.findByRole('switch', { name: en['pet.wander'] })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: en['pet.wander'] }).getAttribute('aria-checked')).toBe('true')
    })
    fireEvent.click(wander)
    expect(saveLive2dPetSettings).toHaveBeenCalledWith({ patch: { wander: false } })
    // The normalized echo from main updates the row.
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: en['pet.wander'] }).getAttribute('aria-checked')).toBe('false')
    })
  })

  it('shows/hides the overlay through the pet channel and resets to defaults', async () => {
    const { saveLive2dPetSettings } = shellWith()
    mount()
    openDesktopTab()
    const toggle = await screen.findByRole('switch', { name: en['pet.enabled'] })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(saveLive2dPetSettings).toHaveBeenCalledWith({ enabled: false })
    const reset = screen.getByRole('button', { name: en['pet.reset'] })
    expect(reset).toHaveProperty('disabled', true)
    reset.click()
    expect(saveLive2dPetSettings).toHaveBeenCalledOnce()
    await waitFor(() => { expect(reset).toHaveProperty('disabled', false) })
    fireEvent.click(reset)
    expect(saveLive2dPetSettings).toHaveBeenCalledWith({ reset: true })
  })

  it('lists only image-capable routes and writes provider + model', async () => {
    const { saveLive2dPetSettings } = shellWith()
    mount({
      modelCatalog: () => Promise.resolve({
        ok: true,
        value: {
          groups: [{
            id: 'custom',
            name: 'Custom',
            models: [
              { id: 'qwen-vl-max', name: 'Qwen VL Max', inputModalities: ['text', 'image'] },
              { id: 'deepseek-chat', name: 'DeepSeek Chat', inputModalities: ['text'] },
            ],
          }],
        },
      }),
    })
    openDesktopTab()
    const select = await screen.findByRole('button', { name: en['pet.lookModel'] })
    fireEvent.click(select)
    const item = await screen.findByRole('menuitem', { name: 'Custom / Qwen VL Max' })
    // Text-only catalog models never reach the list.
    expect(screen.queryByRole('menuitem', { name: /DeepSeek Chat/ })).toBeNull()
    fireEvent.click(item)
    await waitFor(() => {
      expect(saveLive2dPetSettings).toHaveBeenCalledWith({
        patch: { lookModel: 'qwen-vl-max', lookProvider: 'custom' },
      })
    })
  })

  it('keeps a stored route the catalog no longer lists', async () => {
    shellWith({
      live2dPet: { enabled: true, settings: { ...NORMALIZED, lookModel: 'gone-vl', lookProvider: 'old-p' } },
      whaleAssistantEnabled: false,
    })
    mount()
    openDesktopTab()
    const select = await screen.findByRole('button', { name: en['pet.lookModel'] })
    await waitFor(() => {
      expect(select.textContent).toContain('old-p / gone-vl')
    })
  })

  it('clears provider + model when Off is picked', async () => {
    const { saveLive2dPetSettings } = shellWith({
      live2dPet: {
        enabled: true,
        settings: { ...NORMALIZED, lookModel: 'qwen-vl-max', lookProvider: 'custom' },
      },
      whaleAssistantEnabled: false,
    })
    mount({
      modelCatalog: () => Promise.resolve({
        ok: true,
        value: {
          groups: [{
            id: 'custom',
            name: 'Custom',
            models: [{ id: 'qwen-vl-max', name: 'Qwen VL Max', inputModalities: ['image'] }],
          }],
        },
      }),
    })
    openDesktopTab()
    const select = await screen.findByRole('button', { name: en['pet.lookModel'] })
    fireEvent.click(select)
    fireEvent.click(await screen.findByRole('menuitem', { name: en['pet.lookModelOff'] }))
    await waitFor(() => {
      expect(saveLive2dPetSettings).toHaveBeenCalledWith({
        patch: { lookModel: '', lookProvider: '' },
      })
    })
  })

  it('merges size+opacity into one row and shows a single personality select', async () => {
    shellWith()
    mount()
    expect(screen.getByRole('heading', { name: en['pet.nav'] })).toBeTruthy()
    openDesktopTab()
    await screen.findByRole('switch', { name: en['pet.enabled'] })
    // One merged row — the two selects keep their own aria labels.
    expect(screen.getByText(en['pet.scaleOpacity'])).toBeTruthy()
    expect(screen.getByRole('button', { name: en['pet.scale'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: en['pet.opacity'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: en['pet.personality'] })).toBeTruthy()
    // Self-talk and wander ride the shared autonomy row.
    expect(screen.getByText(en['pet.autonomy'])).toBeTruthy()
    expect(screen.getByRole('switch', { name: en['pet.selfTalk'] })).toBeTruthy()
    expect(screen.getByRole('switch', { name: en['pet.wander'] })).toBeTruthy()
  })

  it('maps lockPosition + shiftToDrag onto one drag-mode select', async () => {
    const { saveLive2dPetSettings } = shellWith()
    mount()
    openDesktopTab()
    const select = await screen.findByRole('button', { name: en['pet.dragMode'] })
    expect(select.textContent).toContain(en['pet.dragFree'])
    fireEvent.click(select)
    fireEvent.click(await screen.findByRole('menuitem', { name: en['pet.dragLocked'] }))
    await waitFor(() => {
      expect(saveLive2dPetSettings).toHaveBeenCalledWith({
        patch: { lockPosition: true, shiftToDrag: false },
      })
    })
  })

  it('clears both drag flags when free mode is picked', async () => {
    const { saveLive2dPetSettings } = shellWith({
      live2dPet: { enabled: true, settings: { ...NORMALIZED, shiftToDrag: true } },
      whaleAssistantEnabled: false,
    })
    mount()
    openDesktopTab()
    const select = await screen.findByRole('button', { name: en['pet.dragMode'] })
    expect(select.textContent).toContain(en['pet.dragShift'])
    fireEvent.click(select)
    fireEvent.click(await screen.findByRole('menuitem', { name: en['pet.dragFree'] }))
    await waitFor(() => {
      expect(saveLive2dPetSettings).toHaveBeenCalledWith({
        patch: { lockPosition: false, shiftToDrag: false },
      })
    })
  })

  it('mounts pet-adjacent feature blocks through the settings.pet.item seat', async () => {
    shellWith()
    const renderSlot = vi.fn(() => null)
    mount({ renderSlot })
    await screen.findByRole('switch', { name: en['pet.whaleAssistant'] })
    expect(renderSlot).toHaveBeenCalledWith('settings.pet.item', {})
  })

  it('toggles the whale assistant through saveConfig so Harness restarts', async () => {
    const { saveConfig, saveLive2dPetSettings } = shellWith()
    mount()
    const whale = await screen.findByRole('switch', { name: en['pet.whaleAssistant'] })
    expect(whale.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(whale)
    expect(saveConfig).toHaveBeenCalledWith({ whaleAssistantEnabled: true })
    expect(saveLive2dPetSettings).not.toHaveBeenCalled()
  })
})
