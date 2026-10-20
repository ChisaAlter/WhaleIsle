// @vitest-environment jsdom
/** SettingsSelect: Menu-backed Setting-Cell Selector. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsSelect } from '../src/SettingsSelect.tsx'
import css from '../src/SettingsSelect.module.css'

afterEach(cleanup)

const OPTIONS = [
  { id: '', label: 'Off' },
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta', disabled: true },
]

describe('SettingsSelect', () => {
  it('opens a menu and commits a selection', () => {
    const onChange = vi.fn()
    render(
      <SettingsSelect
        aria-label="Pick"
        value=""
        options={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]}
        placeholder="Choose"
        onChange={onChange}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Pick' })
    expect(trigger.textContent).toContain('Choose')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(menu.getAttribute('data-menu-material')).toBe('translucent')
    expect(menu.classList.contains(css.list!)).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(onChange).toHaveBeenCalledWith('a')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the selected label and skips disabled rows', () => {
    const onChange = vi.fn()
    render(
      <SettingsSelect aria-label="Pick" value="a" options={OPTIONS} onChange={onChange} />,
    )
    expect(screen.getByRole('button', { name: 'Pick' }).textContent).toContain('Alpha')
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not open while disabled', () => {
    render(
      <SettingsSelect
        aria-label="Pick"
        value="a"
        options={OPTIONS}
        disabled
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the selected option visible and blocks a second selection while loading', () => {
    const change = vi.fn()
    const view = render(<SettingsSelect aria-label="Pick" value="a" options={OPTIONS} loading onChange={change} />)
    const trigger = screen.getByRole('button', { name: 'Pick' })
    expect(trigger.textContent).toContain('Alpha')
    expect(trigger.getAttribute('aria-busy')).toBe('true')
    expect(trigger).toHaveProperty('disabled', true)
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(change).not.toHaveBeenCalled()
    view.rerender(<SettingsSelect aria-label="Pick" value="a" options={OPTIONS} onChange={change} />)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Off' }))
    expect(change).toHaveBeenCalledExactlyOnceWith('')
  })

  it('falls back to the raw value when no option matches', () => {
    render(
      <SettingsSelect
        aria-label="Pick"
        value="stale"
        options={OPTIONS}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Pick' }).textContent).toContain('stale')
  })

  it('opens a solid block list at the trigger width and keeps keyboard selection and focus return', async () => {
    const onChange = vi.fn()
    render(
      <SettingsSelect
        variant="block"
        aria-label="Pick"
        value="a"
        options={OPTIONS}
        onChange={onChange}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Pick' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      width: 480,
      height: 36,
      top: 10,
      left: 20,
      bottom: 46,
      right: 500,
      x: 20,
      y: 10,
      toJSON() {},
    } as DOMRect)
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(menu.style.width).toBe('480px')
    expect(menu.style.maxWidth).toBe('none')
    expect(menu.getAttribute('data-menu-material')).toBe('solid')
    expect(menu.classList.contains(css.list!)).toBe(true)
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'End' })
    const alpha = screen.getByRole('menuitem', { name: 'Alpha' })
    expect(document.activeElement).toBe(alpha)
    fireEvent.keyDown(alpha, { key: 'Tab' })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a')
    expect(screen.queryByRole('menu')).toBeNull()
    await Promise.resolve()
    expect(document.activeElement).toBe(trigger)
  })

  it('opens with end-aligned menus', () => {
    render(
      <SettingsSelect
        align="end"
        aria-label="Pick"
        value="a"
        options={OPTIONS}
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })
})
