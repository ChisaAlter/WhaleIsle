// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  HIGHLIGHT_MAX_CHARS,
  HIGHLIGHT_MAX_LINES,
  HIGHLIGHT_MAX_LINE_CHARS,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CodeEditorSurface } from '../src/client/CodeEditorSurface.tsx'
import { FilePreview } from '../src/client/FilePreview.tsx'
import { resolveCenteredFileLineScrollTop } from '../src/client/fileLineReveal.ts'
import { en, zh } from '../src/client/locales.ts'

const t: PropsLocale<'files'>['t'] = key => (en as Record<string, string>)[key] ?? key
const SID = 'session-editor-ux' as SessionId

function sessions(): SessionListState {
  return {
    ids: [SID],
    byId: {
      [SID]: {
        id: SID,
        displayTitle: 'proj',
        running: false,
        blank: false,
        retainedBy: { mainView: 1 },
        updatedAt: 1,
        cwd: '/tmp/proj',
      },
    },
    phase: 'ready',
    projectionsBySession: {},
  }
}

function StatefulEditor({
  initialValue,
  relativePath = 'src/app.ts',
  wordWrap = false,
  onValueChange,
}: {
  initialValue: string
  relativePath?: string
  wordWrap?: boolean
  onValueChange?: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <CodeEditorSurface
      value={value}
      relativePath={relativePath}
      wordWrap={wordWrap}
      t={t}
      onChange={(next) => {
        setValue(next)
        onValueChange?.(next)
      }}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('files locales', () => {
  it('keeps zh and en dictionaries aligned across all keys', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const value of Object.values(zh)) expect(value.length).toBeGreaterThan(0)
    for (const value of Object.values(en)) expect(value.length).toBeGreaterThan(0)
  })
})

describe('CodeEditorSurface line gutter and scroll sync', () => {
  it('renders synchronized line numbers and tracks the active caret line', () => {
    const { container, rerender } = render(
      <CodeEditorSurface
        value={'one\ntwo\nthree\nfour'}
        relativePath="src/a.ts"
        wordWrap={false}
        t={t}
        onChange={() => {}}
      />,
    )

    const gutter = container.querySelector('[data-code-gutter]') as HTMLElement
    const highlight = container.querySelector('[data-code-highlight]') as HTMLElement
    const textarea = screen.getByLabelText('src/a.ts') as HTMLTextAreaElement

    expect(gutter).toBeTruthy()
    expect(gutter.getAttribute('data-word-wrap')).toBe('false')
    expect(gutter.querySelectorAll('[data-line-number]').length).toBe(4)
    expect(gutter.querySelector('[data-line-number="1"]')?.getAttribute('data-active')).toBe('true')

    textarea.setSelectionRange(5, 5)
    fireEvent.click(textarea)
    expect(gutter.querySelector('[data-line-number="2"]')?.getAttribute('data-active')).toBe('true')
    expect(gutter.querySelector('[data-line-number="1"]')?.getAttribute('data-active')).toBeNull()

    textarea.setSelectionRange(9, 9)
    fireEvent.keyUp(textarea, { key: 'ArrowDown' })
    expect(gutter.querySelector('[data-line-number="3"]')?.getAttribute('data-active')).toBe('true')

    textarea.setSelectionRange(15, 18)
    fireEvent.select(textarea)
    expect(gutter.querySelector('[data-line-number="4"]')?.getAttribute('data-active')).toBe('true')

    textarea.scrollTop = 140
    textarea.scrollLeft = 36
    fireEvent.scroll(textarea)
    expect(gutter.scrollTop).toBe(140)
    expect(highlight.scrollTop).toBe(140)
    expect(highlight.scrollLeft).toBe(36)

    rerender(
      <CodeEditorSurface
        value={'one\ntwo\nthree\nfour'}
        relativePath="src/a.ts"
        wordWrap
        t={t}
        onChange={() => {}}
      />,
    )
    expect(gutter.getAttribute('data-word-wrap')).toBe('true')
    expect(textarea.className.split(/\s+/).some(name => /wrap/i.test(name))).toBe(true)
  })
})

describe('CodeEditorSurface syntax highlighting tiers', () => {
  it('highlights supported small TypeScript files immediately', () => {
    const { container } = render(
      <StatefulEditor
        initialValue={'const count: number = 42\nexport { count }'}
        relativePath="src/count.ts"
      />,
    )
    const root = container.querySelector('[data-code-editor]') as HTMLElement
    const highlight = container.querySelector('[data-code-highlight]') as HTMLElement
    expect(root.getAttribute('data-highlight-tier')).toBe('immediate')
    expect(highlight.getAttribute('aria-hidden')).toBe('true')
    expect(highlight.querySelectorAll('span[style]').length).toBeGreaterThan(0)
  })

  it('defers highlighting for medium-to-large files within budget without blocking initial render', async () => {
    const lines = Array.from({ length: 220 }, (_, index) => `const v${index} = ${index}`).join('\n')
    const { container } = render(<StatefulEditor initialValue={lines} relativePath="src/large.ts" />)
    const root = container.querySelector('[data-code-editor]') as HTMLElement
    const highlight = container.querySelector('[data-code-highlight]') as HTMLElement

    expect(root.getAttribute('data-highlight-tier')).toBe('deferred')
    expect(highlight.querySelectorAll('span[style]').length).toBe(0)

    await waitFor(() => {
      expect(highlight.querySelectorAll('span[style]').length).toBeGreaterThan(0)
    })
  })

  it('degrades to plain rendering for unknown extensions and over-budget files', () => {
    const unknownView = render(<StatefulEditor initialValue="const a = 1" relativePath="notes.txt" />)
    expect(unknownView.container.querySelector('[data-code-editor]')?.getAttribute('data-highlight-tier')).toBe('plain')
    expect(unknownView.container.querySelectorAll('[data-code-highlight] span[style]').length).toBe(0)
    cleanup()

    const tooManyLines = Array.from({ length: HIGHLIGHT_MAX_LINES + 1 }, () => 'const x = 1').join('\n')
    const lineBudgetView = render(<StatefulEditor initialValue={tooManyLines} relativePath="src/huge.ts" />)
    expect(lineBudgetView.container.querySelector('[data-code-editor]')?.getAttribute('data-highlight-tier')).toBe('plain')
    expect(lineBudgetView.container.querySelectorAll('[data-code-gutter] [data-line-number]').length).toBe(HIGHLIGHT_MAX_LINES + 1)
    expect(lineBudgetView.container.querySelectorAll('[data-code-highlight] span[style]').length).toBe(0)
    cleanup()

    const longLine = `const s = "${'a'.repeat(HIGHLIGHT_MAX_LINE_CHARS)}"`
    const lineCharView = render(<StatefulEditor initialValue={longLine} relativePath="src/long-line.ts" />)
    expect(lineCharView.container.querySelector('[data-code-editor]')?.getAttribute('data-highlight-tier')).toBe('plain')
    expect(lineCharView.container.querySelectorAll('[data-code-highlight] span[style]').length).toBe(0)
    cleanup()

    const overMaxChars = Array.from({ length: 130 }, () => 'a'.repeat(4096)).join('\n')
    expect(overMaxChars.length).toBeGreaterThan(HIGHLIGHT_MAX_CHARS)
    const charBudgetView = render(<StatefulEditor initialValue={overMaxChars} relativePath="src/huge-chars.ts" />)
    expect(charBudgetView.container.querySelector('[data-code-editor]')?.getAttribute('data-highlight-tier')).toBe('plain')
    expect(charBudgetView.container.querySelectorAll('[data-code-highlight] span[style]').length).toBe(0)
  })
})

describe('CodeEditorSurface editing ergonomics', () => {
  it('indents and outdents single-line and multi-line selections on Tab / Shift+Tab', () => {
    render(<StatefulEditor initialValue={'alpha\nbeta\ngamma'} />)
    const textarea = screen.getByLabelText('src/app.ts') as HTMLTextAreaElement

    textarea.setSelectionRange(0, 0)
    fireEvent.keyDown(textarea, { key: 'Tab' })
    expect(textarea.value).toBe('  alpha\nbeta\ngamma')
    expect(textarea.selectionStart).toBe(2)
    expect(textarea.selectionEnd).toBe(2)

    fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true })
    expect(textarea.value).toBe('alpha\nbeta\ngamma')
    expect(textarea.selectionStart).toBe(0)
    expect(textarea.selectionEnd).toBe(0)

    // No-op Shift+Tab still prevents focus tab-out.
    expect(fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(textarea.value).toBe('alpha\nbeta\ngamma')

    // Multi-line selection batch indent and outdent keeps full span intact.
    textarea.setSelectionRange(0, 10)
    fireEvent.keyDown(textarea, { key: 'Tab' })
    expect(textarea.value).toBe('  alpha\n  beta\ngamma')
    expect(textarea.selectionStart).toBe(0)
    expect(textarea.selectionEnd).toBe(14)

    fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true })
    expect(textarea.value).toBe('alpha\nbeta\ngamma')
    expect(textarea.selectionStart).toBe(0)
    expect(textarea.selectionEnd).toBe(10)

    // IME composing Tab is not intercepted.
    expect(fireEvent.keyDown(textarea, { key: 'Tab', isComposing: true })).toBe(true)
  })

  it('inherits leading indentation on Enter only when leading whitespace exists', () => {
    const onValueChange = vi.fn()
    render(<StatefulEditor initialValue={'  const x = 1\nplain'} onValueChange={onValueChange} />)
    const textarea = screen.getByLabelText('src/app.ts') as HTMLTextAreaElement

    textarea.setSelectionRange(13, 13)
    const prevented = !fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(prevented).toBe(true)
    expect(textarea.value).toBe('  const x = 1\n  \nplain')
    expect(textarea.selectionStart).toBe(16)
    expect(textarea.selectionEnd).toBe(16)

    // Unindented line lets native Enter run untouched.
    onValueChange.mockClear()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    const nativeAllowed = fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(nativeAllowed).toBe(true)
    expect(onValueChange).not.toHaveBeenCalled()
  })
})

describe('CodeEditorSurface Ctrl/Cmd+F find bar', () => {
  it('opens on Ctrl+F or Cmd+F, counts matches, navigates prev/next, and restores focus on Escape/Close', () => {
    const rect = {
      x: 0,
      y: 0,
      width: 300,
      height: 60,
      top: 0,
      right: 300,
      bottom: 60,
      left: 0,
      toJSON: () => ({}),
    }
    const rectSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    Object.defineProperty(HTMLTextAreaElement.prototype, 'clientHeight', { configurable: true, get: () => 60 })
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => 2_000 })
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element)
      if (!(element instanceof HTMLTextAreaElement)) return style
      return new Proxy(style, {
        get(target, prop): string | ((property: string) => string) {
          if (prop === 'lineHeight') return '20px'
          if (prop === 'paddingTop') return '0px'
          if (prop === 'getPropertyValue') {
            return (property: string): string => target.getPropertyValue(property)
          }
          if (typeof prop === 'string') {
            return target.getPropertyValue(prop.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`))
          }
          return ''
        },
      })
    })

    try {
      const lines = Array.from({ length: 60 }, (_, idx) => (
        idx === 5 || idx === 25 || idx === 45 ? `target line ${idx + 1}` : `line ${idx + 1}`
      )).join('\n')
      const { container } = render(<StatefulEditor initialValue={lines} />)
      const textarea = screen.getByLabelText('src/app.ts') as HTMLTextAreaElement
      const gutter = container.querySelector('[data-code-gutter]') as HTMLElement
      const highlight = container.querySelector('[data-code-highlight]') as HTMLElement

      expect(container.querySelector('[data-file-find-bar]')).toBeNull()

      textarea.focus()
      fireEvent.keyDown(textarea, { key: 'f', ctrlKey: true })

      const findBar = container.querySelector('[data-file-find-bar]') as HTMLElement
      expect(findBar).toBeTruthy()
      const findInput = screen.getByLabelText(en['find.placeholder']) as HTMLInputElement
      expect(document.activeElement).toBe(findInput)

      fireEvent.change(findInput, { target: { value: 'missing-token' } })
      expect(container.querySelector('[data-file-find-count]')?.textContent).toBe(en['find.noResults'])
      expect(screen.getByRole('button', { name: en['find.next'] })).toHaveProperty('disabled', true)

      fireEvent.change(findInput, { target: { value: 'target' } })
      expect(container.querySelector('[data-file-find-count]')?.textContent).toBe('1/3')
      expect(container.querySelectorAll('[data-find-match]').length).toBe(3)
      expect(container.querySelectorAll('[data-find-active="true"]').length).toBe(1)

      const firstStart = lines.indexOf('target')
      expect(textarea.selectionStart).toBe(firstStart)
      expect(textarea.selectionEnd).toBe(firstStart + 6)

      // Enter steps to match 2/3 (line 26, index 25) and aligns scrollTop.
      fireEvent.keyDown(findInput, { key: 'Enter' })
      expect(container.querySelector('[data-file-find-count]')?.textContent).toBe('2/3')
      const secondStart = lines.indexOf('target', firstStart + 1)
      expect(textarea.selectionStart).toBe(secondStart)
      expect(textarea.selectionEnd).toBe(secondStart + 6)
      const expectedScroll = resolveCenteredFileLineScrollTop({
        scrollTop: 0,
        scrollHeight: 2_000,
        viewportTop: 0,
        viewportHeight: 60,
        fileTop: 0,
        estimatedLine: { top: 25 * 20, height: 20 },
      })
      expect(textarea.scrollTop).toBe(expectedScroll)
      expect(gutter.scrollTop).toBe(expectedScroll)
      expect(highlight.scrollTop).toBe(expectedScroll)

      // Next button -> 3/3; Next button wraps -> 1/3; Shift+Enter wraps back -> 3/3.
      fireEvent.click(screen.getByRole('button', { name: en['find.next'] }))
      expect(container.querySelector('[data-file-find-count]')?.textContent).toBe('3/3')
      fireEvent.click(screen.getByRole('button', { name: en['find.next'] }))
      expect(container.querySelector('[data-file-find-count]')?.textContent).toBe('1/3')
      fireEvent.keyDown(findInput, { key: 'Enter', shiftKey: true })
      expect(container.querySelector('[data-file-find-count]')?.textContent).toBe('3/3')
      fireEvent.click(screen.getByRole('button', { name: en['find.previous'] }))
      expect(container.querySelector('[data-file-find-count]')?.textContent).toBe('2/3')

      // Escape closes find bar and restores focus to textarea.
      fireEvent.keyDown(findInput, { key: 'Escape' })
      expect(container.querySelector('[data-file-find-bar]')).toBeNull()
      expect(document.activeElement).toBe(textarea)

      // Cmd+F reopens and pre-fills single-line selection, Close button closes & restores focus.
      textarea.setSelectionRange(firstStart, firstStart + 6)
      fireEvent.keyDown(textarea, { key: 'f', metaKey: true })
      expect(container.querySelector('[data-file-find-bar]')).toBeTruthy()
      expect(screen.getByLabelText(en['find.placeholder'])).toHaveProperty('value', 'target')
      expect(container.querySelector('[data-file-find-count]')?.textContent).toBe('1/3')

      fireEvent.click(screen.getByRole('button', { name: en['find.close'] }))
      expect(container.querySelector('[data-file-find-bar]')).toBeNull()
      expect(document.activeElement).toBe(textarea)
    } finally {
      rectSpy.mockRestore()
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'clientHeight')
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight')
    }
  })

  it('integrates find bar Escape precedence with FilePreview dismissal and preserves comment selection', async () => {
    const appendComposerText = vi.fn()
    const { container } = render(
      <FilePreview
        sessionId={SID}
        relativePath="src/a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSessions={sel => sel(sessions())}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'alpha\nbeta\nalpha', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        appendComposerText={appendComposerText}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )

    const editor = await screen.findByLabelText('src/a.ts') as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(0, 10)
    fireEvent.select(editor)
    expect(screen.getByRole('button', { name: en['preview.comment'] })).toBeTruthy()

    // Open find bar via Ctrl+F.
    fireEvent.keyDown(editor, { key: 'f', ctrlKey: true })
    expect(container.querySelector('[data-file-find-bar]')).toBeTruthy()

    // First Escape while focused in editor closes find bar instead of blurring editor.
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(container.querySelector('[data-file-find-bar]')).toBeNull()
    expect(document.activeElement).toBe(editor)
    expect(screen.getByRole('button', { name: en['preview.comment'] })).toBeTruthy()

    // Second Escape runs installFileEditorDismissal and clears selection.
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: en['preview.comment'] })).toBeNull()
  })
})
