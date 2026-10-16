// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownCodeFence, MarkdownCodeFenceRenderer } from '../src/markdown/MarkdownText.tsx'
import { MarkdownText } from './markdown-test-components.tsx'

afterEach(cleanup)

function FenceForm({
  fence, actionLabel = 'Submit', onAction,
}: {
  fence: MarkdownCodeFence
  actionLabel?: string
  onAction?: () => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <section data-testid={`fence-${String(fence.sourceOffset)}`} data-streaming={String(fence.streaming)}>
      <pre>{fence.code}</pre>
      <input aria-label="Draft" value={draft} onChange={event => { setDraft(event.target.value) }} />
      <button type="button" onClick={onAction}>{actionLabel}</button>
    </section>
  )
}

const renderOpenUi: MarkdownCodeFenceRenderer = fence => fence.language === 'openui'
  ? <FenceForm fence={fence} />
  : undefined

describe('MarkdownText document-local code fence rendering', () => {
  it.each([true, false])('retains ordinary fence output when the owner declines it (streaming=%s)', (streaming) => {
    const text = [
      '# Ordinary Markdown',
      '',
      'Prose with `inline code` stays outside the fence renderer.',
      '',
      '```ts title="example"',
      'const answer = 42',
      '',
      '```',
      '',
      '```text/plain raw',
      '<b>literal source</b>',
      '```',
      '',
      '```empty',
      '```',
      '',
      '```',
      'unlabelled source',
      '```',
      '',
      'Tail one.',
      '',
      'Tail two.',
      '',
      'Tail three.',
    ].join('\n')
    const decline = vi.fn<MarkdownCodeFenceRenderer>(() => undefined)
    const original = render(<MarkdownText text={text} streaming={streaming} />)
    const extended = render(<MarkdownText text={text} streaming={streaming} renderCodeFence={decline} />)

    expect(extended.container.innerHTML).toBe(original.container.innerHTML)
    expect([...extended.container.querySelectorAll('pre')].map(node => node.textContent)).toEqual([
      'const answer = 42\n', '<b>literal source</b>', '', 'unlabelled source',
    ])
    expect(within(extended.container).getAllByRole('button', { name: '复制' })).toHaveLength(3)
    expect(decline.mock.calls.map(([fence]) => fence)).toEqual([
      { code: 'const answer = 42\n', language: 'ts', meta: 'title="example"', sourceOffset: text.indexOf('```ts'), streaming },
      { code: '<b>literal source</b>', language: 'text/plain', meta: 'raw', sourceOffset: text.indexOf('```text/plain'), streaming },
      { code: '', language: 'empty', meta: undefined, sourceOffset: text.indexOf('```empty'), streaming },
      { code: 'unlabelled source', language: undefined, meta: undefined, sourceOffset: text.indexOf('```\nunlabelled'), streaming },
    ])
  })

  it('preserves independent forms through fence growth, freezing, and the settled parse', () => {
    const prefix = '前言 🌊.\n\nSecond paragraph.\n\nThird paragraph.\n\n'
    const firstOffset = prefix.length
    let text = `${prefix}\`\`\`openui first\nroot =`
    const live = render(<MarkdownText text={text} streaming renderCodeFence={renderOpenUi} />)
    const first = live.getByTestId(`fence-${String(firstOffset)}`)
    const firstInput = within(first).getByRole('textbox')
    fireEvent.change(firstInput, { target: { value: 'First form draft' } })

    text += ' Card("First")\n'
    live.rerender(<MarkdownText text={text} streaming renderCodeFence={renderOpenUi} />)
    expect(live.getByTestId(`fence-${String(firstOffset)}`)).toBe(first)
    expect(within(first).getByRole('textbox')).toBe(firstInput)
    expect(first.querySelector('pre')?.textContent).toBe('root = Card("First")')

    text += '```\n\nAfter first.\n\nMore after first.\n\n'
    const secondOffset = text.length
    text += '```openui second\nroot = Card('
    live.rerender(<MarkdownText text={text} streaming renderCodeFence={renderOpenUi} />)
    const second = live.getByTestId(`fence-${String(secondOffset)}`)
    const secondInput = within(second).getByRole('textbox')
    fireEvent.change(secondInput, { target: { value: 'Second form draft' } })
    expect(firstOffset).not.toBe(secondOffset)
    expect(second).not.toBe(first)

    text += '"Second")\n```\n\nAfter second.\n\nMore after second.\n\nFinal paragraph.'
    live.rerender(<MarkdownText text={text} streaming renderCodeFence={renderOpenUi} />)
    expect(live.getByTestId(`fence-${String(firstOffset)}`)).toBe(first)
    expect(live.getByTestId(`fence-${String(secondOffset)}`)).toBe(second)
    expect(second.querySelector('pre')?.textContent).toBe('root = Card("Second")')

    live.rerender(<MarkdownText text={text} renderCodeFence={renderOpenUi} />)
    expect(live.getByTestId(`fence-${String(firstOffset)}`)).toBe(first)
    expect(live.getByTestId(`fence-${String(secondOffset)}`)).toBe(second)
    expect(within(first).getByRole('textbox')).toBe(firstInput)
    expect(within(second).getByRole('textbox')).toBe(secondInput)
    expect((firstInput as HTMLInputElement).value).toBe('First form draft')
    expect((secondInput as HTMLInputElement).value).toBe('Second form draft')
    expect(first.getAttribute('data-streaming')).toBe('false')
    expect(second.getAttribute('data-streaming')).toBe('false')
  })

  it('keeps nested fence offsets absolute across parser-tail slices and settling', () => {
    const prefix = 'Prefix 🌊.\n\nSecond.\n\nThird.\n\nFourth.\n\n'
    const quoted = '> Quote heading.\n>\n> ```openui quote\n> root = Card("Quoted")\n> ```'
    const listed = '- List heading.\n\n  ```openui list\n  root = Card("Listed")\n  ```'
    let text = prefix
    const live = render(<MarkdownText text={text} streaming renderCodeFence={renderOpenUi} />)

    text += quoted
    const quoteOffset = text.indexOf('```openui quote')
    live.rerender(<MarkdownText text={text} streaming renderCodeFence={renderOpenUi} />)
    const quote = live.getByTestId(`fence-${String(quoteOffset)}`)
    expect(quote.closest('blockquote')).not.toBeNull()
    expect(quote.querySelector('pre')?.textContent).toBe('root = Card("Quoted")')

    text += `\n\nAfter quote.\n\nMore after quote.\n\n${listed}`
    const listOffset = text.indexOf('```openui list')
    live.rerender(<MarkdownText text={text} streaming renderCodeFence={renderOpenUi} />)
    const list = live.getByTestId(`fence-${String(listOffset)}`)
    expect(list.closest('li')).not.toBeNull()
    expect(list.querySelector('pre')?.textContent).toBe('root = Card("Listed")')
    expect(live.getByTestId(`fence-${String(quoteOffset)}`)).toBe(quote)

    text += '\n\nAfter list.\n\nMore after list.\n\nFinal paragraph.'
    live.rerender(<MarkdownText text={text} streaming renderCodeFence={renderOpenUi} />)
    live.rerender(<MarkdownText text={text} renderCodeFence={renderOpenUi} />)
    expect(live.getByTestId(`fence-${String(quoteOffset)}`)).toBe(quote)
    expect(live.getByTestId(`fence-${String(listOffset)}`)).toBe(list)
    expect(live.getAllByRole('textbox')).toHaveLength(2)
  })

  it('refreshes frozen fence content and actions when the renderer callback changes', () => {
    const text = '```openui\nroot = Card("Form")\n```\n\nAfter one.\n\nAfter two.\n\nAfter three.'
    const oldAction = vi.fn()
    const newAction = vi.fn()
    const oldRenderer: MarkdownCodeFenceRenderer = fence => fence.language === 'openui'
      ? <FenceForm fence={fence} actionLabel="Old action" onAction={oldAction} />
      : undefined
    const newRenderer: MarkdownCodeFenceRenderer = fence => fence.language === 'openui'
      ? <FenceForm fence={fence} actionLabel="New action" onAction={newAction} />
      : undefined
    const live = render(<MarkdownText text={text} streaming renderCodeFence={oldRenderer} />)
    const form = live.getByTestId('fence-0')
    const input = within(form).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Unsaved form state' } })

    live.rerender(<MarkdownText text={text} streaming renderCodeFence={newRenderer} />)
    expect(live.getByTestId('fence-0')).toBe(form)
    expect(within(form).getByRole('textbox')).toBe(input)
    expect((input as HTMLInputElement).value).toBe('Unsaved form state')
    expect(within(form).queryByRole('button', { name: 'Old action' })).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: 'New action' }))
    expect(newAction).toHaveBeenCalledOnce()
    expect(oldAction).not.toHaveBeenCalled()
  })
})
