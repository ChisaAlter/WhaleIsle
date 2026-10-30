/**
 * QueueDock motion as CSS text. jsdom has no layout or compositor, so this
 * reads the declarations that keep the panel smooth: it moves with transform on
 * the compositor inside a clip that only its fixed bottom edge (3px under the
 * input card) cuts, and opacity never lands on an ancestor of the frosted
 * material.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/queue/QueueDock.module.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\=']/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(css)
  if (rule === null) throw new Error(`QueueDock.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('QueueDock.module.css motion', () => {
  it('moves the panel with transform only; the dock track keeps the layout', () => {
    expect(declarations('.surface[data-state]')).toContain('transition: transform var(--ds-transition-duration) var(--ds-ease-in-out)')
    expect(declarations(".surface[data-state='closed']")).toContain('transform: translateY(100%)')
    expect(declarations('.dock')).toContain('transition: grid-template-rows var(--ds-transition-duration) var(--ds-ease-in-out)')
    expect(css).not.toMatch(/transition:[^;]*margin-bottom/)
  })

  it('clips the panel 3px under the input card, without a scroll container or backdrop root', () => {
    const clip = declarations('.clip')
    expect(clip).toContain('overflow: clip')
    expect(clip.some(declaration => /^(overflow: hidden|clip-path|mask|filter|opacity)/.test(declaration))).toBe(false)
    expect(declarations('.surface[data-state]')).toContain('margin-bottom: -3px')
  })

  it('fades the material, the border, and the content themselves', () => {
    expect(declarations('.panel::before')).toContain('backdrop-filter: var(--dsw-menu-backdrop-filter)')
    expect(declarations('.surface[data-state] .panel::before, .surface[data-state] .panel::after, .surface[data-state] .panelBody'))
      .toContain('transition: opacity var(--ds-transition-duration) var(--ds-ease-in-out)')
    for (const selector of ['.dock', '.clip', '.surface[data-state]', ".surface[data-state='closed']"]) {
      expect(declarations(selector).some(declaration => /^opacity|transition:.*opacity/.test(declaration))).toBe(false)
    }
  })
})
