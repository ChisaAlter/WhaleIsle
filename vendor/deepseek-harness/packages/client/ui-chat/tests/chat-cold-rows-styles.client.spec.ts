/**
 * Cold rows as CSS text: jsdom has no layout, so this reads the declarations that keep a skipped row at
 * its measured height and make writing that height restyle one row only.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/chat/ChatView.module.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ')

describe('ChatView.module.css cold rows', () => {
  it('skips a cold row at its last measured height, on the row itself only', () => {
    const selector = ':global([data-slot="conversation.chat.flow"]) > :global([data-chat-cold])'
    expect(css).toContain(`${selector} { content-visibility: auto; contain-intrinsic-size: auto var(--dsh-chat-cold-height); }`)
  })

  it('registers the height as a non-inherited length so writing it restyles one row', () => {
    expect(css).toMatch(/@property --dsh-chat-cold-height \{ syntax: '<length>'; inherits: false; initial-value: 160px; \}/)
  })
})
