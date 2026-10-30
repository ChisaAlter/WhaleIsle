/**
 * GoalBar motion as CSS text. jsdom has no layout or compositor, so this reads
 * the declarations that keep the strip smooth: the card moves with transform on
 * the compositor inside a clip that only its fixed bottom edge cuts, and
 * opacity never lands on an ancestor of the frosted material (that cuts the
 * backdrop filter off from the page until the fade ends).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/GoalBar.module.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\=']/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(css)
  if (rule === null) throw new Error(`GoalBar.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

describe('GoalBar.module.css motion', () => {
  it('moves the card with transform only; the slot track keeps the layout', () => {
    expect(declarations('.surface[data-state]')).toContain('transition: transform var(--ds-transition-duration) var(--ds-ease-in-out)')
    expect(declarations(".surface[data-state='closed']")).toContain('transform: translateY(100%)')
    expect(declarations('.dock')).toContain('transition: grid-template-rows var(--ds-transition-duration) var(--ds-ease-in-out)')
    expect(css).not.toMatch(/transition:[^;]*margin-bottom/)
  })

  it('clips the card at the slot bottom without a scroll container or backdrop root', () => {
    const clip = declarations('.clip')
    expect(clip).toContain('overflow: clip')
    expect(clip.some(declaration => /^(overflow: hidden|clip-path|mask|filter|opacity)/.test(declaration))).toBe(false)
  })

  it('fades the material and the content themselves, never an ancestor of the backdrop filter', () => {
    expect(declarations('.bar::before')).toContain('backdrop-filter: var(--dsw-menu-backdrop-filter)')
    expect(declarations('.surface[data-state] .bar::before, .surface[data-state] .content'))
      .toContain('transition: opacity var(--ds-transition-duration) var(--ds-ease-in-out)')
    expect(declarations(".surface[data-state='closed'] .bar::before, .surface[data-state='closed'] .content")).toContain('opacity: 0')
    for (const selector of ['.dock', '.clip', '.surface[data-state]', ".surface[data-state='closed']", '.bar']) {
      expect(declarations(selector).some(declaration => /^opacity|transition:.*opacity/.test(declaration))).toBe(false)
    }
  })
})
