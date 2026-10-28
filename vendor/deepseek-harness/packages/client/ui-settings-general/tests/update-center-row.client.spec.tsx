// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AboutSection } from '../src/client/AboutSection.tsx'
import type { AboutSectionProps } from '../src/client/AboutSection.tsx'
import type { UpdateCenterView } from '../src/client/desktop-shell.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

function translate(key: string, params?: Record<string, unknown>) {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

function center(initial: UpdateCenterView) {
  let listener: ((view: UpdateCenterView) => void) | null = null
  const api = {
    state: vi.fn(async () => initial),
    open: vi.fn(async () => initial),
    command: vi.fn(async (action: string) => ({ ...initial, phase: action === 'install' ? 'installing' : initial.phase } as UpdateCenterView)),
    onState: vi.fn((handler: (view: UpdateCenterView) => void) => { listener = handler; return () => { listener = null } }),
    push: (view: UpdateCenterView) => { act(() => listener?.(view)) },
  }
  return api
}

const base: UpdateCenterView = { phase: 'current', current: '0.3.12', target: null, progress: null, error: null }

it('replaces the route picker and legacy buttons with the update center status', async () => {
  const checkUpdate = vi.fn()
  const api = center(base)
  ;(window as Window & { shell?: unknown }).shell = { updateCenter: api, checkUpdate, saveConfig: vi.fn() }
  render(<AboutSection {...({ t: translate } as AboutSectionProps)} />)
  expect((await screen.findByRole('status')).textContent).toBe('Up to date (v0.3.12)')
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByRole('button', { name: en['about.installUpdate'] })).toBeNull()
  expect(checkUpdate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en['about.checkUpdate'] }))
  await waitFor(() => { expect(api.command).toHaveBeenCalledWith('check') })
  expect(api.open).toHaveBeenCalled()
})

it('follows the shared job: progress, then install and restart', async () => {
  const api = center({ ...base, phase: 'available', target: { version: '0.3.13' } })
  ;(window as Window & { shell?: unknown }).shell = { updateCenter: api }
  render(<AboutSection {...({ t: translate } as AboutSectionProps)} />)
  expect((await screen.findByRole('status')).textContent).toBe('Version v0.3.13 is available')
  api.push({ ...base, phase: 'downloading', target: { version: '0.3.13' }, progress: { received: 37, total: 100 } })
  expect(screen.getByRole('status').textContent).toBe('Downloading v0.3.13 · 37%')
  api.push({ ...base, phase: 'ready', target: { version: '0.3.13' } })
  fireEvent.click(screen.getByRole('button', { name: en['about.center.install'] }))
  await waitFor(() => { expect(api.command).toHaveBeenCalledWith('install') })
})
