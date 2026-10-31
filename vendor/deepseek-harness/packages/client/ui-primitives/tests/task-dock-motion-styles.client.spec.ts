/**
 * TaskDock motion as CSS text. jsdom has no layout or compositor, so this reads
 * the declarations that keep the strip smooth: the card moves with transform on
 * the compositor inside a clip that only its fixed bottom edge cuts, while the
 * 0fr/1fr track keeps the layout, and the surface that owns the backdrop filter
 * owns its own fade.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/TaskDock.module.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\=']/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(css)
  if (rule === null) throw new Error(`TaskDock.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('TaskDock.module.css motion', () => {
  it('moves the card with transform only; the root track keeps the layout', () => {
    expect(declarations('.slide[data-state]')).toContain('transition: transform var(--ds-transition-duration) var(--ds-ease-in-out)')
    expect(declarations(".slide[data-state='closed']")).toContain('transform: translateY(100%)')
    expect(declarations('.root')).toContain('transition: grid-template-rows var(--ds-transition-duration) var(--ds-ease-in-out)')
    expect(css).not.toMatch(/transition:[^;]*margin-bottom/)
  })

  it('collapses the track at once when leaving, so the exit is compositor-only', () => {
    expect(declarations(".root[data-state='closed']")).toContain('grid-template-rows: 0fr')
    expect(declarations(".root[data-state='closed']")).toContain('transition: none')
    expect(declarations(".slide[data-state='closed']")).toContain('transform: translateY(100%)')
  })

  it('clips the card at the slot bottom without a scroll container or backdrop root', () => {
    const slot = declarations('.slot')
    expect(slot).toContain('overflow: clip')
    expect(slot.some(declaration => /^(overflow: hidden|clip-path|mask|filter|opacity)/.test(declaration))).toBe(false)
  })

  it('fades the surface that owns the backdrop filter, and nothing above it', () => {
    const surface = declarations('.surface[data-state]')
    expect(surface).toContain('backdrop-filter: var(--dsw-menu-backdrop-filter)')
    expect(surface).toContain('transition: opacity var(--ds-transition-duration) var(--ds-ease-in-out)')
    for (const selector of ['.root', '.slot', '.slide[data-state]', ".slide[data-state='closed']"]) {
      expect(declarations(selector).some(declaration => /^opacity|transition:.*opacity/.test(declaration))).toBe(false)
    }
  })
})
