// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Switch } from '../src/Switch.tsx'

afterEach(cleanup)

describe('Switch', () => {
  // Controlled form: `label` selects the button-based control.
  it('exposes its state and its caller-owned name to assistive technology', () => {
    render(<Switch checked label="Subagent model selection" onChange={() => {}} />)
    const control = screen.getByRole('switch', { name: 'Subagent model selection' })
    expect(control.getAttribute('aria-checked')).toBe('true')
  })

  it('reports the state the click asks for, not the state it has', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Switch checked={false} label="Toggle" onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)

    onChange.mockClear()
    rerender(<Switch checked label="Toggle" onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('stays silent while disabled', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} disabled label="Toggle" onChange={onChange} />)
    const control = screen.getByRole('switch')
    expect((control as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(control)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps its checked state and blocks interaction while loading, then allows the next toggle', () => {
    const change = vi.fn()
    const view = render(<Switch checked label="Toggle" loading onChange={change} />)
    const control = screen.getByRole('switch', { name: 'Toggle' })
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(control.getAttribute('aria-busy')).toBe('true')
    expect(control).toHaveProperty('disabled', true)
    fireEvent.click(control)
    expect(change).not.toHaveBeenCalled()
    view.rerender(<Switch checked label="Toggle" onChange={change} />)
    fireEvent.click(control)
    expect(change).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('also blocks the native checkbox form while loading without changing its value', () => {
    const change = vi.fn()
    render(<Switch aria-label="Enable sync" defaultChecked loading onChange={change} />)
    const control = screen.getByRole<HTMLInputElement>('switch', { name: 'Enable sync' })
    expect(control.getAttribute('aria-busy')).toBe('true')
    expect(control.disabled).toBe(true)
    control.click()
    expect(control.checked).toBe(true)
    expect(change).not.toHaveBeenCalled()
  })

  it('carries a lock reason as the hover title when the owner names one', () => {
    render(<Switch checked={false} disabled label="Toggle" title="Managed by policy" onChange={() => {}} />)
    expect(screen.getByRole('switch').getAttribute('title')).toBe('Managed by policy')
  })

  it('never submits a surrounding form', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => { event.preventDefault() })
    render(<form onSubmit={onSubmit}><Switch checked={false} label="Toggle" onChange={() => {}} /></form>)
    fireEvent.click(screen.getByRole('switch'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps a caller class alongside its own so a render site can place it', () => {
    render(<Switch checked={false} className="placed" label="Toggle" onChange={() => {}} />)
    const control = screen.getByRole('switch')
    expect(control.classList.contains('placed')).toBe(true)
    expect(control.classList.length).toBeGreaterThan(1)
  })

  // Native-checkbox form: no `label`, native input attributes and the native change event.
  it('renders a native checkbox switch and forwards input attributes and className', () => {
    render(
      <Switch
        aria-label="Enable sync"
        className="settings-switch"
        defaultChecked
        id="sync"
        name="sync"
        required
        value="enabled"
      />,
    )

    const control = screen.getByRole<HTMLInputElement>('switch', { name: 'Enable sync' })
    expect(control.type).toBe('checkbox')
    expect(control.checked).toBe(true)
    expect(control.id).toBe('sync')
    expect(control.name).toBe('sync')
    expect(control.required).toBe(true)
    expect(control.value).toBe('enabled')
    expect(control.classList.contains('settings-switch')).toBe(true)
  })

  it('reports checked state changes through the native change event', () => {
    const onChange = vi.fn()
    render(<Switch aria-label="Enable sync" onChange={onChange} />)

    const control = screen.getByRole<HTMLInputElement>('switch', { name: 'Enable sync' })
    fireEvent.click(control)

    expect(control.checked).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('stays unchanged and emits no change while disabled', () => {
    const onChange = vi.fn()
    render(<Switch aria-label="Enable sync" disabled onChange={onChange} />)

    const control = screen.getByRole<HTMLInputElement>('switch', { name: 'Enable sync' })
    control.click()

    expect(control.disabled).toBe(true)
    expect(control.checked).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is keyboard focusable and toggles from the keyboard activation click', () => {
    const onChange = vi.fn()
    render(<Switch aria-label="Enable sync" onChange={onChange} />)

    const control = screen.getByRole<HTMLInputElement>('switch', { name: 'Enable sync' })
    control.focus()
    expect(document.activeElement).toBe(control)

    fireEvent.keyDown(control, { key: ' ', code: 'Space' })
    fireEvent.keyUp(control, { key: ' ', code: 'Space' })
    fireEvent.click(control, { detail: 0 })

    expect(control.checked).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
