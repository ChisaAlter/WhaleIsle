// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeRuntime } from '../src/client/index.ts'
import { installMinimalModeLifecycle } from '../src/client/minimal-mode-lifecycle.ts'
import { DEFAULT_THEME_SETTINGS, type ThemeSettings } from '../src/theme-settings.ts'

const observation = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn(), detected: () => {} }))
vi.mock('../src/client/startup-responsiveness.ts', () => ({
  observeStartupResponsiveness: (callback: () => void) => {
    observation.start()
    observation.detected = callback
    return observation.stop
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  observation.start.mockClear()
  observation.stop.mockClear()
  vi.stubGlobal('dshDesktop', { rendering: {
    setMinimalMode: vi.fn().mockResolvedValue(true), claimSuggestion: vi.fn().mockResolvedValue(true),
  } })
})
afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function fixture(value?: Partial<ThemeSettings>) {
  const ctx = new Context()
  const host = stubConfigForm<ThemeSettings>()
  if (value !== undefined) host.publish({ status: 'ready', value: { ...DEFAULT_THEME_SETTINGS, ...value }, writable: true, revision: 1 })
  const theme = new ThemeRuntime(ctx, host.scope)
  installMinimalModeLifecycle(ctx, theme, host.scope)
  return { theme, host }
}

describe('startup recommendation lifecycle', () => {
  it('waits for durable settings, starts once, and stops when Minimal mode is enabled', () => {
    const { theme, host } = fixture()
    expect(observation.start).not.toHaveBeenCalled()
    host.publish({ status: 'ready', value: DEFAULT_THEME_SETTINGS, revision: 1, writable: true })
    expect(observation.start).toHaveBeenCalledOnce()
    theme.setMinimalMode(true)
    expect(observation.stop).toHaveBeenCalledOnce()
    theme.setMinimalMode(false)
    expect(observation.start).toHaveBeenCalledOnce()
  })

  it.each([
    { minimalMode: true }, { minimalModeSuggestions: false }, { minimalModeSnoozedUntil: Date.now() + 86400_000 },
  ])('does not start while ineligible: %j', settings => {
    fixture(settings)
    expect(observation.start).not.toHaveBeenCalled()
  })

  it('defers to typing and existing dialogs, and only offers the mode after a safe foreground interval', async () => {
    const { theme } = fixture({})
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    observation.detected()
    await vi.advanceTimersByTimeAsync(1500)
    expect(theme.minimalSuggestion.getSnapshot()).toBe(false)
    input.blur()
    const otherDialog = document.createElement('div')
    otherDialog.setAttribute('role', 'dialog')
    document.body.append(otherDialog)
    await vi.advanceTimersByTimeAsync(2000)
    expect(theme.minimalSuggestion.getSnapshot()).toBe(false)
    otherDialog.remove()
    await vi.advanceTimersByTimeAsync(2000)
    expect(theme.minimalSuggestion.getSnapshot()).toBe(true)
    expect(theme.getTheme().minimalMode).toBe(false)
    theme.decideMinimalSuggestion('later')
    expect(theme.minimalSuggestion.getSnapshot()).toBe(false)
    expect(theme.getTheme().minimalModeSnoozedUntil).toBeGreaterThan(Date.now())
  })

  it('cancels a pending prompt when the user changes mode manually', async () => {
    const { theme } = fixture({})
    observation.detected()
    theme.setMinimalMode(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(theme.minimalSuggestion.getSnapshot()).toBe(false)
  })
})
