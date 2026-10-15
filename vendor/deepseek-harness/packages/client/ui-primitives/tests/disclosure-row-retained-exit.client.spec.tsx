// @vitest-environment jsdom
/**
 * DisclosureRow's real callers drop their body on collapse (ReasoningRow's
 * content memo returns undefined; ToolRow removes `expandedContent`). The
 * shared row must retain the LAST OPEN body through the exit recipe — visible,
 * logically inactive at once, gone after the hold — without making collapsed
 * bodies eager (a lazy body is only built once, while opening).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { zh as commonZh } from '../../locale/src/locales/zh.ts'
import { zh as chatZh } from '../../ui-chat/src/client/locale.ts'
import { zh as toolZh } from '../../ui-conversation/src/client/locales.ts'
import { bindDisclosure, useDisclosure } from '../../ui-chat/src/client/chat/use-disclosure.ts'
import { useDetailedPresentation } from '../../ui-chat/tests/presentation-fixture.client.ts'
import { renderReasoningSlot } from '../../ui-chat/tests/reasoning-component-fixture.tsx'
import { ReasoningRow } from '../../ui-chat/src/client/chat/ReasoningRow.tsx'
import { ToolRow } from '../../ui-tool/src/client/tool/components/ToolRow.tsx'
import { PRESENCE_EXIT_MS } from '../src/usePresence.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const chatT = makeTranslate(chatZh, commonZh)
const toolT = makeTranslate(toolZh, commonZh)

describe('DisclosureRow retained exit frame', () => {
  it('keeps a real ReasoningRow body visible and logically inactive through its exit', () => {
    vi.useFakeTimers()
    const reset = createSnapshotStore(0)
    const useBoundDisclosure = bindDisclosure(reset)
    const view = render(
      <ReasoningRow
        renderSlot={renderReasoningSlot}
        useDisclosure={useBoundDisclosure}
        usePresentation={useDetailedPresentation}
        text={'First line\n\nDetailed reasoning body'}
        running={false}
        t={chatT}
      />,
    )
    const row = view.getByRole('button')
    expect(row.getAttribute('aria-expanded')).toBe('false')
    // Collapsed: the expensive Markdown body was never constructed.
    expect(view.queryByText('Detailed reasoning body')).toBeNull()

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    const body = view.getByText('Detailed reasoning body')
    const surface = body.closest('[data-dsh-motion="fade"]') as HTMLElement
    expect(surface).not.toBeNull()
    expect(surface.hasAttribute('inert')).toBe(false)

    // Collapse: the caller's content memo drops to undefined on this commit.
    fireEvent.click(view.getByRole('button'))
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    const retained = view.getByText('Detailed reasoning body')
    expect(retained).toBe(body)
    const retainedSurface = retained.closest('[data-dsh-motion="fade"]') as HTMLElement
    expect(retainedSurface.isConnected).toBe(true)
    expect(retainedSurface.getAttribute('data-state')).toBe('closed')
    expect(retainedSurface.getAttribute('aria-hidden')).toBe('true')
    expect(retainedSurface.hasAttribute('inert')).toBe(true)

    act(() => { vi.advanceTimersByTime(PRESENCE_EXIT_MS - 1) })
    expect(view.queryByText('Detailed reasoning body')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(view.queryByText('Detailed reasoning body')).toBeNull()
  })

  it('keeps a real ToolRow expanded body through its exit without building it eagerly again', () => {
    vi.useFakeTimers()
    const stringify = vi.spyOn(JSON, 'stringify')
    const bodyFormatCalls = () => stringify.mock.calls.filter(
      ([value, replacer, space]) => typeof value === 'object'
        && value !== null
        && 'a' in value
        && (value as { a?: unknown }).a === 1
        && replacer === null
        && space === 2,
    ).length
    const view = render(
      <ToolRow
        useDisclosure={useDisclosure}
        t={toolT}
        variant="bash"
        icon={<i data-testid="tool-icon" />}
        title="Bash"
        summary="List files"
        bodyRaw='{"a":1}'
        state="ok"
      />,
    )
    expect(bodyFormatCalls()).toBe(0)
    const row = view.getByRole('button', { name: /Bash/ })

    fireEvent.click(row)
    expect(bodyFormatCalls()).toBe(1)
    const body = view.getByText(/"a": 1/)
    const surface = body.closest('[data-dsh-motion="fade"]') as HTMLElement
    expect(surface.hasAttribute('inert')).toBe(false)

    // Collapse: ToolRow's `expandedContent` memo returns undefined this commit.
    fireEvent.click(view.getByRole('button', { name: /Bash/ }))
    expect(view.getByRole('button', { name: /Bash/ }).getAttribute('aria-expanded')).toBe('false')
    const retained = view.getByText(/"a": 1/)
    expect(retained).toBe(body)
    const retainedSurface = retained.closest('[data-dsh-motion="fade"]') as HTMLElement
    expect(retainedSurface.getAttribute('data-state')).toBe('closed')
    expect(retainedSurface.getAttribute('aria-hidden')).toBe('true')
    expect(retainedSurface.hasAttribute('inert')).toBe(true)
    // The last-open body is retained as-is; it is not reformatted on close.
    expect(bodyFormatCalls()).toBe(1)

    act(() => { vi.advanceTimersByTime(PRESENCE_EXIT_MS - 1) })
    expect(view.queryByText(/"a": 1/)).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(view.queryByText(/"a": 1/)).toBeNull()
  })
})
