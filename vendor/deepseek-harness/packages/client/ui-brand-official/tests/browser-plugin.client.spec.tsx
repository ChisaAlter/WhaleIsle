// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { OfficialBrandMark, OfficialBrandName } from '../src/client/Brand.tsx'
import { OfficialHeroBrandMark } from '../src/client/HeroBrandMark.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  delete (window as Window & { shell?: unknown }).shell
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('official browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('leaves every slot empty outside the official build profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('fills the hero independently of the sidebar declaration', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench(false)
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const declareHero = () => subject.slots.register({
      name: 'root',
      children: { 'conversation.hero.brand.mark': { kind: 'single', scope: 'root' } },
    } as never, () => null)
    const disposeHero = declareHero()
    await Promise.resolve()
    expect(subject.slots.entries('conversation.hero.brand.mark')).toHaveLength(1)
    expect(subject.slots.entries('sidebar.brand.mark')).toHaveLength(0)
    disposeHero()
    expect(subject.slots.entries('conversation.hero.brand.mark')).toHaveLength(0)
    declareHero()
    await Promise.resolve()
    expect(subject.slots.entries('conversation.hero.brand.mark')).toHaveLength(1)
    await fiber.dispose()
    expect(subject.slots.entries('conversation.hero.brand.mark')).toHaveLength(0)
  })

  it('renders a decorative hero mark at the requested size with the host theme class', () => {
    const view = render(<OfficialHeroBrandMark size={34} className="hero-theme-ink" />)
    const mark = view.container.querySelector('[data-whale-isle-brand="hero-mark"]')
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
    expect(mark?.classList.contains('hero-theme-ink')).toBe(true)
    expect(mark?.getAttribute('style')).toContain('width: 34px; height: 34px;')
    view.rerender(<OfficialHeroBrandMark size={24} />)
    expect(mark?.getAttribute('style')).toContain('width: 24px; height: 24px;')
  })

  it('renders Whale Isle in Web without a desktop preload', () => {
    const name = render(<OfficialBrandName />)
    expect(name.container.textContent).toContain('鲸屿')
    expect(name.container.textContent).toContain('WHALE ISLE')
    expect(name.container.textContent!.indexOf('鲸屿')).toBeLessThan(name.container.textContent!.indexOf('WHALE ISLE'))
    expect(name.getByText('BASED ON DEEPSEEK HARNESS')).toBeTruthy()
    expect(name.container.querySelector('img')?.getAttribute('src')).toBe('/whale-isle-head.png')
    name.unmount()

    const mark = render(<OfficialBrandMark size={34} />)
    expect(mark.container.querySelector('img')?.getAttribute('src')).toBe('/whale-isle-head.png')
    expect(mark.container.querySelector('img')?.getAttribute('width')).toBe('34')
    mark.rerender(<OfficialBrandMark size={24} />)
    expect(mark.container.querySelector('img')?.getAttribute('width')).toBe('24')
  })

  it('keeps the same integrated brand with a desktop preload', () => {
    ;(window as Window & { shell?: unknown }).shell = { getWindowState: () => ({}) }
    const name = render(<OfficialBrandName />)
    expect(name.container.textContent).toContain('鲸屿')
    expect(name.container.textContent).toContain('WHALE ISLE')
    expect(name.getByText('BASED ON DEEPSEEK HARNESS')).toBeTruthy()
    expect(name.container.querySelector('img')?.getAttribute('src')).toBe('/whale-isle-head.png')
    name.unmount()

    const mark = render(<OfficialBrandMark size={24} />)
    expect(mark.container.querySelector('img')?.getAttribute('src')).toBe('/whale-isle-head.png')
  })
})
