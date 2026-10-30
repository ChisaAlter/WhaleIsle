/**
 * Tooltip's placement, recipe ownership and overflow bounds as CSS text. jsdom
 * resolves CSS Modules to class-name maps, so the stylesheet itself is the only
 * place to pin the per-side transforms and prove the old private entrance
 * keyframe is gone.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/Tooltip.module.css', import.meta.url)), 'utf8')

describe('Tooltip.module.css', () => {
  it('keeps the placement transforms intact', () => {
    expect(css).toMatch(/\.bubble\[data-side='bottom'\]\s*\{\s*transform: translateX\(-50%\);/u)
    expect(css).toMatch(/\.bubble\[data-side='top'\]\s*\{\s*transform: translate\(-50%, -100%\);/u)
    expect(css).toMatch(/\.bubble\[data-side='bottom'\]\[data-align='end'\]\s*\{\s*transform: translateX\(-100%\);/u)
    expect(css).toMatch(/\.bubble\[data-side='top'\]\[data-align='end'\]\s*\{\s*transform: translate\(-100%, -100%\);/u)
  })

  it('defines no private entrance animation beside the shared fade recipe', () => {
    expect(css).not.toContain('@keyframes tooltip-in')
    expect(css).not.toMatch(/\.bubble\s*\{[^}]*animation:/su)
  })
})

describe('tooltip overflow styles', () => {
  it('wraps unbroken labels and bounds the complete bubble in both viewport dimensions', () => {
    expect(css).toContain('width: max-content;')
    expect(css).toContain('box-sizing: border-box;')
    expect(css).toContain('max-width: min(50vw, calc(100vw - 24px));')
    expect(css).toContain('max-height: calc(100vh - 24px);')
    expect(css).toContain('overflow-wrap: break-word;')
    expect(css).toContain('.label { min-width: 0; }')
  })

  it('keeps oversized content scrollable from its start when pinned', () => {
    expect(css).toContain('align-items: safe center;')
    expect(css).toContain('overflow: auto;')
    expect(css).toContain('.bubble[data-pinned] { pointer-events: auto; }')
  })

  it('uses the same vertical centering for left and right placements', () => {
    expect(css).toMatch(/\.bubble\[data-side='right'\],\s*\.bubble\[data-side='left'\]\s*\{\s*transform: translateY\(-50%\);/)
  })
})
