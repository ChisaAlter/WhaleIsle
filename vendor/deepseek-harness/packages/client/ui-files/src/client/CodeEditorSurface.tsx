/** Modular code editor surface: line gutter, tiered async syntax highlight, Tab/Enter ergonomics, and in-file Ctrl/Cmd+F find. */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from 'react'
import clsx from 'clsx'
import {
  Button,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconCloseOutline16,
  Input,
  Tooltip,
  languageForPath,
  useCodeHighlighter,
  type CodeHighlighter,
  type HighlightSpan,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  applyEnterIndent,
  applyTabIndent,
  findAllMatches,
  lineNumberAtOffset,
  selectHighlightTier,
  splitLineSpansWithMatches,
  type TextMatchRange,
} from './codeEditorHelpers.ts'
import { resolveCenteredFileLineScrollTop } from './fileLineReveal.ts'
import { NS } from './locales.ts'
import css from './CodeEditorSurface.module.css'

const MAX_RENDERED_FIND_MARKS = 10_000

/** Imperative controls exposed by {@link CodeEditorSurface} for host shortcuts and reveal sync. */
export interface CodeEditorSurfaceHandle {
  /** Open or focus the in-file find bar. */
  openFind(): void
  /** Close the in-file find bar and return focus to the editor textarea. */
  closeFind(): void
  /** Sync line gutter and highlight layer scroll offsets to the textarea. */
  syncScroll(): void
}

/** Props for {@link CodeEditorSurface}. */
export interface CodeEditorSurfaceProps {
  /** Controlled editor value. */
  value: string
  /** Workspace-relative path used for accessible label and language grammar resolution. */
  relativePath: string
  /** Whether soft word wrapping is active. */
  wordWrap: boolean
  /** Localized copy resolver from the `files` namespace. */
  t: PropsLocale<typeof NS>['t']
  /** Optional ref forwarded to the underlying `<textarea>` element. */
  textareaRef?: Ref<HTMLTextAreaElement> | undefined
  /** Optional ref receiving {@link CodeEditorSurfaceHandle} controls. */
  surfaceRef?: Ref<CodeEditorSurfaceHandle> | undefined
  /** Controlled value change handler. */
  onChange: (nextValue: string) => void
  /** Optional keydown hook called ahead of built-in editor shortcuts. */
  onKeyDown?: ((event: KeyboardEvent<HTMLTextAreaElement>) => void) | undefined
  /** Optional selection event handler forwarded from the textarea. */
  onSelect?: ((event: SyntheticEvent<HTMLTextAreaElement>) => void) | undefined
  /** Optional callback invoked when programmatic edits adjust a non-collapsed selection. */
  onSelectionSync?: ((textarea: HTMLTextAreaElement) => void) | undefined
  /** Optional notification fired whenever the find bar opens or closes. */
  onFindOpenChange?: ((open: boolean) => void) | undefined
}

interface PendingSelection {
  readonly value: string
  readonly start: number
  readonly end: number
  readonly syncSelection: boolean
}

function isFindShortcut(event: KeyboardEvent<HTMLElement>): boolean {
  return (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey
    && !event.nativeEvent.isComposing
    && event.key.toLowerCase() === 'f'
}

/**
 * Code editor surface backed by a real controlled `<textarea>` with a scroll-synced
 * line gutter, tiered async Shiki syntax highlighting overlay, indentation ergonomics,
 * and an accessible in-file `Ctrl/Cmd+F` find bar.
 * @param props - editor state, path, wrap flag, locale, and callbacks.
 * @returns the composed editor surface element.
 */
export function CodeEditorSurface({
  value,
  relativePath,
  wordWrap,
  t,
  textareaRef,
  surfaceRef,
  onChange,
  onKeyDown,
  onSelect,
  onSelectionSync,
  onFindOpenChange,
}: CodeEditorSurfaceProps): ReactNode {
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const highlightRef = useRef<HTMLPreElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const gutterLineRefs = useRef<(HTMLDivElement | null)[]>([])
  const highlightLineRefs = useRef<(HTMLDivElement | null)[]>([])
  const pendingSelectionRef = useRef<PendingSelection | null>(null)

  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onSelectionSyncRef = useRef(onSelectionSync)
  onSelectionSyncRef.current = onSelectionSync
  const onFindOpenChangeRef = useRef(onFindOpenChange)
  onFindOpenChangeRef.current = onFindOpenChange

  const attachTextarea = useCallback((element: HTMLTextAreaElement | null): void => {
    localTextareaRef.current = element
    if (typeof textareaRef === 'function') {
      textareaRef(element)
    } else if (textareaRef != null) {
      (textareaRef as { current: HTMLTextAreaElement | null }).current = element
    }
  }, [textareaRef])

  const [activeLine, setActiveLine] = useState(1)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)

  const lines = useMemo(() => value.split('\n'), [value])
  gutterLineRefs.current.length = lines.length
  highlightLineRefs.current.length = lines.length

  const language = useMemo(() => languageForPath(relativePath), [relativePath])
  const highlight = useCodeHighlighter(language)
  const highlightTier = useMemo(
    () => selectHighlightTier(value, language),
    [value, language],
  )

  const immediateSpans = useMemo(
    () => (highlightTier === 'immediate' ? highlight(value) : undefined),
    [highlightTier, highlight, value],
  )

  const [deferredResult, setDeferredResult] = useState<{
    readonly value: string
    readonly highlight: CodeHighlighter
    readonly spans: HighlightSpan[][] | undefined
  } | null>(null)

  useEffect(() => {
    if (highlightTier !== 'deferred') {
      setDeferredResult(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      const spans = highlight(value)
      setDeferredResult({ value, highlight, spans })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [highlightTier, highlight, value])

  const activeSpans = highlightTier === 'immediate'
    ? immediateSpans
    : highlightTier === 'deferred'
      && deferredResult !== null
      && deferredResult.value === value
      && deferredResult.highlight === highlight
      ? deferredResult.spans
      : undefined

  const matches = useMemo(
    () => (findOpen ? findAllMatches(value, findQuery) : []),
    [findOpen, value, findQuery],
  )
  const safeActiveMatchIndex = matches.length === 0
    ? 0
    : Math.min(activeMatchIndex, matches.length - 1)

  const syncScroll = useCallback((): void => {
    const textarea = localTextareaRef.current
    if (textarea === null) return
    if (gutterRef.current !== null) gutterRef.current.scrollTop = textarea.scrollTop
    if (highlightRef.current !== null) {
      highlightRef.current.scrollTop = textarea.scrollTop
      highlightRef.current.scrollLeft = textarea.scrollLeft
    }
  }, [])

  const syncGeometry = useCallback((): void => {
    const textarea = localTextareaRef.current
    const highlightEl = highlightRef.current
    const gutterEl = gutterRef.current
    if (textarea === null || highlightEl === null || gutterEl === null) return

    const clientWidth = textarea.clientWidth
    const clientHeight = textarea.clientHeight
    const scrollbarHeight = Math.max(0, textarea.offsetHeight - clientHeight)

    highlightEl.style.width = clientWidth > 0 ? `${clientWidth}px` : ''
    highlightEl.style.height = clientHeight > 0 ? `${clientHeight}px` : ''
    gutterEl.style.paddingBottom = scrollbarHeight > 0 ? `${12 + scrollbarHeight}px` : ''

    const gutterNodes = gutterLineRefs.current
    if (!wordWrap) {
      for (const node of gutterNodes) {
        if (node !== null && node.style.height !== '') node.style.height = ''
      }
      return
    }

    const highlightNodes = highlightLineRefs.current
    const heights: number[] = []
    for (let index = 0; index < highlightNodes.length; index += 1) {
      const lineNode = highlightNodes[index]
      heights.push(lineNode === undefined || lineNode === null ? 0 : lineNode.getBoundingClientRect().height)
    }
    for (let index = 0; index < gutterNodes.length; index += 1) {
      const node = gutterNodes[index]
      if (node === undefined || node === null) continue
      const measured = heights[index] ?? 0
      const target = measured > 0 ? `${measured}px` : ''
      if (node.style.height !== target) node.style.height = target
    }
  }, [wordWrap])

  useLayoutEffect(() => {
    syncGeometry()
    syncScroll()
  }, [lines.length, value, wordWrap, findOpen, syncGeometry, syncScroll])

  useEffect(() => {
    const textarea = localTextareaRef.current
    if (textarea === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      syncGeometry()
      syncScroll()
    })
    observer.observe(textarea)
    return () => {
      observer.disconnect()
    }
  }, [syncGeometry, syncScroll])

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current
    const textarea = localTextareaRef.current
    if (pending === null || textarea === null || pending.value !== value) return
    pendingSelectionRef.current = null
    textarea.setSelectionRange(pending.start, pending.end)
    setActiveLine(lineNumberAtOffset(value, pending.start))
    if (pending.syncSelection) onSelectionSyncRef.current?.(textarea)
  }, [value])

  useLayoutEffect(() => {
    if (!findOpen) return
    const input = findInputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [findOpen, findFocusNonce])

  const revealMatch = useCallback((match: TextMatchRange): void => {
    const textarea = localTextareaRef.current
    if (textarea === null) return
    textarea.setSelectionRange(match.start, match.end)
    const targetLine = lineNumberAtOffset(value, match.start)
    setActiveLine(targetLine)

    const lineEl = highlightLineRefs.current[targetLine - 1]
    const computed = window.getComputedStyle(textarea)
    const parsedLineHeight = Number.parseFloat(computed.lineHeight)
    const lineHeight = Number.isFinite(parsedLineHeight) && parsedLineHeight > 0 ? parsedLineHeight : 20
    const parsedPaddingTop = Number.parseFloat(computed.paddingTop)
    const topInset = Number.isFinite(parsedPaddingTop) ? parsedPaddingTop : 12
    const rectHeight = lineEl?.getBoundingClientRect().height ?? 0
    const measuredTop = lineEl !== undefined && lineEl !== null && lineEl.offsetHeight > 0
      ? Math.max(0, lineEl.offsetTop - topInset)
      : (targetLine - 1) * lineHeight
    const measuredHeight = rectHeight > 0 ? rectHeight : lineHeight
    const rect = textarea.getBoundingClientRect()

    textarea.scrollTop = resolveCenteredFileLineScrollTop({
      scrollTop: textarea.scrollTop,
      scrollHeight: textarea.scrollHeight,
      viewportTop: rect.top,
      viewportHeight: textarea.clientHeight,
      fileTop: 0,
      estimatedLine: { top: measuredTop, height: measuredHeight },
    })
    syncScroll()
  }, [syncScroll, value])

  const openFind = useCallback((): void => {
    const textarea = localTextareaRef.current
    if (!findOpen && textarea !== null) {
      const start = Math.min(textarea.selectionStart, textarea.selectionEnd)
      const end = Math.max(textarea.selectionStart, textarea.selectionEnd)
      const selected = value.slice(start, end)
      if (selected !== '' && !selected.includes('\n') && selected.length <= 200) {
        const seededMatches = findAllMatches(value, selected)
        const selectedIndex = seededMatches.findIndex(m => m.start === start && m.end === end)
        setFindQuery(selected)
        setActiveMatchIndex(selectedIndex >= 0 ? selectedIndex : 0)
      }
    }
    setFindOpen(true)
    setFindFocusNonce(count => count + 1)
    onFindOpenChangeRef.current?.(true)
  }, [findOpen, value])

  const closeFind = useCallback((): void => {
    setFindOpen(false)
    onFindOpenChangeRef.current?.(false)
    localTextareaRef.current?.focus()
  }, [])

  useImperativeHandle(surfaceRef, () => ({
    openFind,
    closeFind,
    syncScroll,
  }), [openFind, closeFind, syncScroll])

  const stepMatch = useCallback((delta: 1 | -1): void => {
    if (matches.length === 0) return
    const nextIndex = (safeActiveMatchIndex + delta + matches.length) % matches.length
    setActiveMatchIndex(nextIndex)
    const match = matches[nextIndex]
    if (match !== undefined) revealMatch(match)
  }, [matches, revealMatch, safeActiveMatchIndex])

  const handleFindQueryChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextQuery = event.target.value
    setFindQuery(nextQuery)
    setActiveMatchIndex(0)
    const nextMatches = findAllMatches(value, nextQuery)
    const first = nextMatches[0]
    if (first !== undefined) revealMatch(first)
  }

  const handleFindInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      stepMatch(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeFind()
    }
  }

  const handleSurfaceKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isFindShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      openFind()
      return
    }
    if (findOpen && event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      event.stopPropagation()
      closeFind()
    }
  }

  const handleTextareaChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    pendingSelectionRef.current = null
    const nextValue = event.target.value
    const caret = event.target.selectionStart
    setActiveLine(lineNumberAtOffset(nextValue, caret))
    onChange(nextValue)
  }

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.nativeEvent.isComposing) return

    const textarea = event.currentTarget
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const edit = applyTabIndent(value, textarea.selectionStart, textarea.selectionEnd, event.shiftKey)
      if (!edit.changed) return
      pendingSelectionRef.current = {
        value: edit.value,
        start: edit.selectionStart,
        end: edit.selectionEnd,
        syncSelection: edit.selectionStart !== edit.selectionEnd,
      }
      onChange(edit.value)
      return
    }

    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      const edit = applyEnterIndent(value, textarea.selectionStart, textarea.selectionEnd)
      if (edit === null) return
      event.preventDefault()
      pendingSelectionRef.current = {
        value: edit.value,
        start: edit.selectionStart,
        end: edit.selectionEnd,
        syncSelection: false,
      }
      onChange(edit.value)
    }
  }

  const updateCaretLine = (textarea: HTMLTextAreaElement): void => {
    const caret = textarea.selectionStart
    setActiveLine(lineNumberAtOffset(textarea.value, caret))
  }

  const handleTextareaCaretEvent = (event: SyntheticEvent<HTMLTextAreaElement>): void => {
    updateCaretLine(event.currentTarget)
  }

  const handleTextareaSelect = (event: SyntheticEvent<HTMLTextAreaElement>): void => {
    updateCaretLine(event.currentTarget)
    onSelectRef.current?.(event)
  }

  const gutterDigits = Math.max(2, String(lines.length).length)
  const gutterStyle = { '--code-gutter-digits': String(gutterDigits) } as CSSProperties
  const clampedActiveLine = Math.min(Math.max(1, activeLine), lines.length)

  const renderedHighlightLines = useMemo(() => {
    const activeMatch = matches[safeActiveMatchIndex]
    const decoratedMatches: readonly TextMatchRange[] = matches.length <= MAX_RENDERED_FIND_MARKS
      ? matches
      : activeMatch === undefined
        ? []
        : [activeMatch]
    const decoratedActiveIndex = matches.length <= MAX_RENDERED_FIND_MARKS ? safeActiveMatchIndex : 0

    let offset = 0
    let matchCursor = 0
    return lines.map((lineText, index) => {
      const lineNumber = index + 1
      const lineStartOffset = offset
      offset += lineText.length + 1
      const lineSpans = activeSpans?.[index]
      const { segments, nextMatchCursor } = splitLineSpansWithMatches(
        lineText,
        lineStartOffset,
        lineSpans,
        decoratedMatches,
        matchCursor,
        decoratedActiveIndex,
      )
      matchCursor = nextMatchCursor

      return (
        <div
          key={lineNumber}
          ref={(el) => { highlightLineRefs.current[index] = el }}
          className={css.highlightLine}
          data-code-line={lineNumber}
        >
          {segments.map((segment, segIndex) => {
            if (segment.matchIndex !== null) {
              return (
                <mark
                  key={segIndex}
                  className={clsx(css.findMatch, segment.active && css.findMatchActive)}
                  data-find-match=""
                  data-find-active={segment.active ? 'true' : undefined}
                  style={segment.style}
                >
                  {segment.text}
                </mark>
              )
            }
            if (segment.style !== undefined) {
              return <span key={segIndex} style={segment.style}>{segment.text}</span>
            }
            return segment.text
          })}
        </div>
      )
    })
  }, [lines, activeSpans, matches, safeActiveMatchIndex])

  return (
    <div
      className={css.surface}
      data-code-editor=""
      data-highlight-tier={highlightTier}
      onKeyDown={handleSurfaceKeyDown}
    >
      {findOpen ? (
        <div
          className={css.findBar}
          data-file-find-bar=""
          role="search"
          aria-label={t('find.label')}
        >
          <Input
            ref={findInputRef}
            className={css.findInput}
            type="text"
            value={findQuery}
            placeholder={t('find.placeholder')}
            aria-label={t('find.placeholder')}
            onChange={handleFindQueryChange}
            onKeyDown={handleFindInputKeyDown}
          />
          {findQuery !== '' ? (
            <span className={css.findCount} data-file-find-count="" aria-live="polite">
              {matches.length > 0 ? `${safeActiveMatchIndex + 1}/${matches.length}` : t('find.noResults')}
            </span>
          ) : null}
          <div className={css.findActions}>
            <Tooltip label={t('find.previous')} side="bottom" delayMs={500} disabled={matches.length === 0}>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className={css.findButton}
                aria-label={t('find.previous')}
                disabled={matches.length === 0}
                onClick={() => { stepMatch(-1) }}
              >
                <IconChevronUpOutline14 />
              </Button>
            </Tooltip>
            <Tooltip label={t('find.next')} side="bottom" delayMs={500} disabled={matches.length === 0}>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className={css.findButton}
                aria-label={t('find.next')}
                disabled={matches.length === 0}
                onClick={() => { stepMatch(1) }}
              >
                <IconChevronDownOutline14 />
              </Button>
            </Tooltip>
            <Tooltip label={t('find.close')} side="bottom" delayMs={500}>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className={css.findButton}
                aria-label={t('find.close')}
                onClick={closeFind}
              >
                <IconCloseOutline16 size={14} />
              </Button>
            </Tooltip>
          </div>
        </div>
      ) : null}
      <div className={css.editorArea}>
        <div
          ref={gutterRef}
          className={css.gutter}
          data-code-gutter=""
          data-word-wrap={wordWrap ? 'true' : 'false'}
          aria-hidden="true"
          style={gutterStyle}
        >
          {lines.map((_line, index) => {
            const lineNumber = index + 1
            const isActive = lineNumber === clampedActiveLine
            return (
              <div
                key={lineNumber}
                ref={(el) => { gutterLineRefs.current[index] = el }}
                className={clsx(css.gutterLine, isActive && css.gutterLineActive)}
                data-line-number={lineNumber}
                data-active={isActive ? 'true' : undefined}
              >
                {lineNumber}
              </div>
            )
          })}
        </div>
        <div className={css.codeStage}>
          <pre
            ref={highlightRef}
            className={clsx(css.highlight, wordWrap && css.wrap)}
            aria-hidden="true"
            data-code-highlight=""
          >
            {renderedHighlightLines}
          </pre>
          <textarea
            ref={attachTextarea}
            className={clsx(css.textarea, wordWrap && css.wrap)}
            value={value}
            aria-label={relativePath}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            onChange={handleTextareaChange}
            onKeyDown={handleTextareaKeyDown}
            onClick={handleTextareaCaretEvent}
            onKeyUp={handleTextareaCaretEvent}
            onSelect={handleTextareaSelect}
            onFocus={handleTextareaCaretEvent}
            onScroll={syncScroll}
          />
        </div>
      </div>
    </div>
  )
}
