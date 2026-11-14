import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import { expect, it } from 'vitest'

it('keeps the frosted backdrop supported by Chromium after the production CSS transform', () => {
  const filename = fileURLToPath(new URL('../packages/client/ui-primitives/src/UserMessageBubble.module.css', import.meta.url))
  const { code, exports } = transform({
    filename,
    code: readFileSync(filename),
    cssModules: { pattern: '[hash]_[local]' },
    minify: true,
  })
  const bubble = exports?.bubble?.name
  expect(bubble).toBeTruthy()
  const rule = code.toString().split(`.${bubble}{`)[1]?.split('}')[0]
  expect(rule).toMatch(/(?:^|;)backdrop-filter:var\(--dsw-menu-backdrop-filter\)/u)
  expect(rule).toContain('color-mix(in srgb, var(--dsw-specific-bubble) 40%, transparent)')
  expect(rule).not.toMatch(/(?:^|;)opacity:/u)
})
