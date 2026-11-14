/** Settings carrier geometry is independent of contributed launcher markup. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/SettingsRoot.module.css', import.meta.url), 'utf8')

it('keeps the indicator carrier full-width without inspecting account state', () => {
  // The desktop insets the full-width carrier by the 2px focus gutter on each side.
  expect(css).toMatch(/\.triggerRow\s*\{[^}]*width: calc\(100% - 4px\);[^}]*margin: 4px 2px;/)
  expect(css).not.toContain('data-signed-out')
  expect(css).toMatch(/\.triggerRow\.railRow\s*\{[^}]*width: 36px;/)
})
