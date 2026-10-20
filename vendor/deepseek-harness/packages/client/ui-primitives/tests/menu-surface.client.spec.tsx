// @vitest-environment jsdom
/** Menu backing lifetime and placement identity. */
import { createRef } from 'react'
import { createPortal } from 'react-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MenuSurface } from '../src/MenuSurface.tsx'

afterEach(cleanup)

it('keeps each backing after its menu anchor and removes it when unmounted', () => {
  const ref = createRef<HTMLDivElement>()
  const view = render(createPortal(<MenuSurface ref={ref} role="menu" compact><button>Action</button></MenuSurface>, document.body))
  const menu = screen.getByRole('menu')
  const backing = document.querySelector<HTMLElement>('[data-menu-backing]')!
  expect(ref.current).toBe(menu)
  expect(menu.compareDocumentPosition(backing) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  expect(backing.style.getPropertyValue('--dsh-menu-anchor')).toBe(menu.style.getPropertyValue('--dsh-menu-anchor'))
  expect(backing.getAttribute('aria-hidden')).toBe('true')
  view.unmount()
  expect(document.querySelector('[data-menu-backing]')).toBeNull()
})

it('switches material while keeping the same backing, placement anchor, and exit visibility', () => {
  const ref = createRef<HTMLDivElement>()
  const view = render(<MenuSurface ref={ref} role="menu" data-state="open" />)
  const menu = screen.getByRole('menu')
  const backing = document.querySelector<HTMLElement>('[data-menu-backing]')!
  const anchor = menu.style.getPropertyValue('--dsh-menu-anchor')
  expect(menu.getAttribute('data-menu-material')).toBe('translucent')
  view.rerender(<MenuSurface ref={ref} material="solid" role="menu" data-state="closed" style={{ visibility: 'hidden' }} />)
  expect(ref.current).toBe(menu)
  expect(menu.getAttribute('data-menu-material')).toBe('solid')
  expect(menu.hasAttribute('material')).toBe(false)
  expect(document.querySelector('[data-menu-backing]')).toBe(backing)
  expect(menu.style.getPropertyValue('--dsh-menu-anchor')).toBe(anchor)
  expect(backing.style.getPropertyValue('--dsh-menu-anchor')).toBe(anchor)
  expect(backing.getAttribute('data-menu-state')).toBe('closed')
  expect(backing.style.visibility).toBe('hidden')
  expect(backing.getAttribute('aria-hidden')).toBe('true')
  view.unmount()
  expect(ref.current).toBeNull()
  expect(document.querySelector('[data-menu-backing]')).toBeNull()
})

it('gives simultaneously open menus independent anchors and follows visibility changes', () => {
  const view = render(<><MenuSurface role="menu" /><MenuSurface role="menu" /></>)
  const anchors = screen.getAllByRole('menu').map(menu => menu.style.getPropertyValue('--dsh-menu-anchor'))
  expect(new Set(anchors).size).toBe(2)
  expect(document.querySelectorAll('[data-menu-backing]')).toHaveLength(2)
  view.rerender(<MenuSurface role="menu" style={{ visibility: 'hidden' }} />)
  expect(document.querySelector<HTMLElement>('[data-menu-backing]')!.style.visibility).toBe('hidden')
})
