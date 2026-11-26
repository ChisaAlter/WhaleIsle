// @vitest-environment jsdom
/** The Settings entry that lets the user leave Settings for the Plugins page on demand. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginsSettingsLink, type PluginsSettingsLinkProps } from '../src/client/PluginsSettingsLink.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

describe('PluginsSettingsLink', () => {
  it('stays inside Settings on mount and opens Plugins only when the action button is clicked', () => {
    const calls: string[] = []
    const props = {
      close: vi.fn(() => { calls.push('close') }),
      openPlugins: vi.fn(() => { calls.push('open') }),
    } satisfies Pick<PluginsSettingsLinkProps, 'close' | 'openPlugins'>
    render(<PluginsSettingsLink {...props as PluginsSettingsLinkProps} />)
    expect(calls).toEqual([])
    expect(screen.getByRole('heading', { name: en.settingsEntry })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.settingsOpenPlugins }))
    expect(calls).toEqual(['close', 'open'])
  })

  it('does not navigate when mounted only for Settings search indexing', () => {
    const close = vi.fn()
    const openPlugins = vi.fn()
    render(<PluginsSettingsLink {...{ close, openPlugins, indexOnly: true } as PluginsSettingsLinkProps} />)
    expect(close).not.toHaveBeenCalled()
    expect(openPlugins).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: en.settingsOpenPlugins })).toBeTruthy()
  })
})
