/**
 * Models section stylesheet contract, asserted against the CSS text on disk.
 *
 * The section paints in both themes, and a `--dsw-*` name the theme does not
 * declare fails silently: the browser takes the `var()` fallback, so the sheet
 * still renders and only the dark theme looks wrong. Checking the names against
 * the sheet that declares them is what turns that into a test failure.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRules } from '../../ui-theme/tests/stylesheet-scan.ts'

const css = readFileSync(fileURLToPath(new URL('../src/client/ModelsSection.module.css', import.meta.url)), 'utf8')
// The theme package maps `./styles/*` to `./src/styles/*`, so the declarations
// stay on the source plane rather than needing a build.
// Every theme sheet, not just the platform tokens: font and scrollbar
// variables are declared in siblings, and a gate reading one file would call
// their names undeclared.
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

const rules = parseRules(css)

/** Declarations for an exact selector, including a comma-separated selector group. */
function block(selector: string): Record<string, string> {
  const rule = rules.find(candidate => candidate.selectors.includes(selector))
  if (rule === undefined) throw new Error(`ModelsSection.module.css has no \`${selector}\` rule`)
  return Object.fromEntries(rule.declarations)
}

describe('ModelsSection theme styles', () => {
  it('names only theme variables the token sheet defines', () => {
    // A `--dsw-*` name the sheet never declares is not a near miss: it silently
    // resolves to whatever literal sits in its fallback slot, which is how this
    // section stayed light under the dark theme before. Undeclared names have
    // no fallback at all and inherit, so both spellings must fail here.
    // Every theme-variable prefix the sheets actually use, not just `--dsw-`:
    // a `--dsh-` name reads as a plausible sibling and would otherwise slip
    // past this gate into a fallback literal.
    const named = [...css.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1])
    const undeclared = [...new Set(named)].filter(name => !tokens.includes(`  ${String(name)}:`))
    expect(undeclared).toEqual([])
    expect(css).not.toMatch(/var\(--(?:surface|text-|border|accent-strong)/)
  })

  it('closes every block, so no rule is swallowed by the one above it', () => {
    // A missing `}` on an `@media` block is not a parse error: every rule after
    // it silently becomes conditional, and the whole fetch dialog once painted
    // unstyled for anyone whose system does not ask for reduced motion. Nothing
    // downstream reports this — the sheet loads and the classes still attach.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect((bare.match(/\}/g) ?? []).length).toBe((bare.match(/\{/g) ?? []).length)
  })

  it('uses the shared settings card material around the nested editor', () => {
    expect(block('.rowCard')).toMatchObject({
      border: '0.5px solid var(--dsw-alias-settings-card-stroke)',
      background: 'var(--dsw-alias-settings-card-fill)',
    })
    for (const selector of ['.editor', '.addCard', '.setupCard']) {
      expect(block(selector)).toMatchObject({ background: 'var(--dsw-alias-bg-module-platform)' })
    }
    for (const selector of ['.addCard .editor', '.setupCard .editor']) {
      expect(block(selector)).toMatchObject({ background: 'none', padding: '0' })
    }
  })

  it('ships no native select controls in the settings models UI', () => {
    // SettingsSelect (Menu + pill) owns every former dropdown; a leftover
    // `<select>` would paint the OS panel again.
    const sources = readdirSync(fileURLToPath(new URL('../src/client/', import.meta.url)))
      .filter(name => name.endsWith('.tsx'))
      .flatMap(name => {
        const text = readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8')
        return text.includes('<select') ? [name] : []
      })
    expect(sources).toEqual([])
  })

  it('lays thinking intensities in responsive equal columns while shared Checkbox owns control styling', () => {
    const editor = readFileSync(new URL('../src/client/ModelListEditor.tsx', import.meta.url), 'utf8')
    expect(editor).toMatch(/import\s*\{[^}]*\bCheckbox\b[^}]*\}\s*from '@deepseek-ai\/dsh-client-ui-primitives'/)
    expect(editor).toMatch(/<Checkbox\b[^>]*className=\{styles\['modelCheckbox'\]\}/)
    expect(block('.effortOptions')).toMatchObject({
      display: 'grid',
      'grid-template-columns': 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: '8px',
    })
    expect(block('.modelCheckbox')).toEqual({
      gap: '8px',
      'font-size': '14px',
      'line-height': '22px',
    })
  })

  it('never falls back to a literal colour', () => {
    // A token that resolves is never the problem; an undeclared one takes this
    // branch, and a literal here is a single colour for both themes.
    expect(css).not.toMatch(/var\(--dsw-[a-z0-9-]+\s*,\s*(?:#|rgb|rgba|hsl|hsla)/)
  })
})
