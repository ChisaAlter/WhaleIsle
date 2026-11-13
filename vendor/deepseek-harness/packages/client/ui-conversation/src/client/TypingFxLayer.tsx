/**
 * Typing-effect overlay: ghosts each freshly typed character at its rendered
 * position and optionally replaces the native caret with a typewriter block
 * or underline. The Lexical-owned text DOM is never touched — every echo is
 * an absolutely-positioned sibling inside `.grow` that only animates
 * opacity/transform and unmounts with its own animationend. PASTE/history/
 * seed updates and in-flight IME composition never echo; a composition-end
 * commit echoes the whole committed span once, diffed against the text
 * snapshot from composition start (the rules live in
 * input/editor/typing-fx.ts).
 */
import { useEffect, useRef, useState } from 'react'
import { useMinimalMode } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CSSProperties, ReactNode } from 'react'
import { COMPOSITION_END_TAG, COMPOSITION_START_TAG, type LexicalEditor } from 'lexical'
import { resolveTypingFxColors, type TypingFxStyle } from '../submission-settings.ts'
import {
  MAX_TYPING_FX_ECHOES, readEditorText, typingFxInsertedText,
} from './input/editor/typing-fx.ts'
import css from './TypingFxLayer.module.css'

/** One transient glyph ghost in `.grow` coordinates. */
interface Echo {
  readonly id: number
  readonly text: string
  readonly x: number
  readonly y: number
}

/** Collapsed caret box in `.grow` coordinates. */
interface CaretBox {
  readonly x: number
  readonly y: number
  readonly height: number
}

const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The collapsed DOM selection inside the editor, translated into `.grow`
 * coordinates. A ranged selection, a selection outside the editor, and the
 * no-selection state all report null — the caret stays hidden rather than
 * guessing a position.
 */
function caretBox(editor: LexicalEditor, host: HTMLElement): CaretBox | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return null
  const root = editor.getRootElement()
  const anchor = selection.anchorNode
  if (root === null || anchor === null || !root.contains(anchor)) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  const hostRect = host.getBoundingClientRect()
  return { x: rect.x - hostRect.x, y: rect.y - hostRect.y, height: rect.height }
}

/** Overlay props: the editor binding plus the live preference pair. */
export interface TypingFxLayerProps {
  /** The bound editor; null (no-session/workspace-trigger) renders nothing. */
  readonly editor: LexicalEditor | null
  /** Master switch — false renders nothing and drops every listener. */
  readonly enabled: boolean
  /** Active visual treatment (effect, caret, blink, speed). */
  readonly style: TypingFxStyle
}

/**
 * Render the typing-effect overlay inside the composer's `.grow` surface.
 * @param props - editor binding, enablement, and the active style.
 * @returns the echo/caret layer, or null while disabled.
 */
export function TypingFxLayer({ editor, enabled: requested, style }: TypingFxLayerProps): ReactNode {
  const minimal = useMinimalMode()
  const enabled = requested && !minimal
  const rootRef = useRef<HTMLDivElement | null>(null)
  const echoSeq = useRef(0)
  const [echoes, setEchoes] = useState<readonly Echo[]>([])
  const [caret, setCaret] = useState<CaretBox | null>(null)
  const customCaret = style.cursor !== 'native'

  // Echo spawner: one bounded ghost per accepted user insertion, and one
  // per committed IME span. A composition-end update's own prev/next diff is
  // empty — the preview text already sits in the model — so the layer keeps
  // the pre-composition text and diffs the commit against that base. The
  // update listener runs after Lexical commits the DOM, so the collapsed
  // caret the keystroke left behind already sits right of the inserted
  // glyph.
  const compositionBase = useRef<string | null>(null)
  useEffect(() => {
    if (editor === null || !enabled) {
      compositionBase.current = null
      setEchoes([])
      return
    }
    return editor.registerUpdateListener(({ editorState, prevEditorState, tags }) => {
      if (reducedMotion()) return
      const host = rootRef.current
      if (host === null) return
      const prev = readEditorText(prevEditorState)
      const composing = editor.isComposing()
      if (tags.has(COMPOSITION_START_TAG) || composing) {
        if (tags.has(COMPOSITION_START_TAG) || compositionBase.current === null) {
          compositionBase.current = prev
        }
        return
      }
      let base: string | null = null
      if (tags.has(COMPOSITION_END_TAG)) {
        base = compositionBase.current
        compositionBase.current = null
      }
      const inserted = typingFxInsertedText({
        prev,
        next: readEditorText(editorState),
        tags,
        composing,
        compositionBase: base,
      })
      if (inserted === null) return
      const box = caretBox(editor, host)
      if (box === null) return
      const echo: Echo = { id: ++echoSeq.current, text: inserted, x: box.x, y: box.y }
      setEchoes(current => current.length >= MAX_TYPING_FX_ECHOES
        ? [...current.slice(current.length - MAX_TYPING_FX_ECHOES + 1), echo]
        : [...current, echo])
    })
  }, [editor, enabled])

  // Echo retirement: one delegated listener on the layer root (the same
  // native-listener pattern ConversationRoot uses for animationend — React's
  // delegated prop is not observable under jsdom). animationcancel retires the
  // ghost too so an effect switch cannot strand it.
  useEffect(() => {
    const host = rootRef.current
    if (host === null) return
    const onEnd = (event: Event) => {
      const hit = event.target instanceof Element
        ? event.target.closest('[data-typing-fx-echo]')
        : null
      if (hit === null) return
      const id = Number(hit.getAttribute('data-typing-fx-echo'))
      setEchoes(current => current.filter(item => item.id !== id))
    }
    host.addEventListener('animationend', onEnd)
    host.addEventListener('animationcancel', onEnd)
    return () => {
      host.removeEventListener('animationend', onEnd)
      host.removeEventListener('animationcancel', onEnd)
    }
  }, [editor, enabled])

  // Caret tracker: the collapsed DOM selection re-measured on every editor
  // commit and every browser selection change. Only mounted while a custom
  // caret is configured; `native` leaves the contenteditable caret alone.
  useEffect(() => {
    if (editor === null || !enabled || !customCaret) {
      setCaret(null)
      return
    }
    const update = (): void => {
      const host = rootRef.current
      setCaret(host === null ? null : caretBox(editor, host))
    }
    const off = editor.registerUpdateListener(update)
    document.addEventListener('selectionchange', update)
    update()
    return () => {
      off()
      document.removeEventListener('selectionchange', update)
    }
  }, [editor, enabled, customCaret])

  if (editor === null || !enabled) return null
  const colors = resolveTypingFxColors(style.colors)
  return (
    <div
      ref={rootRef}
      className={css.root}
      data-typing-fx
      data-typing-fx-root
      data-effect={style.effect}
      data-blink={style.cursorBlink || undefined}
      style={{
        '--dsh-typing-fx-speed': String(style.speed),
        '--dsh-typing-fx-echo-color': colors.echo ?? undefined,
        '--dsh-typing-fx-caret-color': colors.caret ?? undefined,
      } as CSSProperties}
      aria-hidden
    >
      {echoes.map(echo => (
        <span
          key={echo.id}
          className={css.echo}
          data-typing-fx-echo={echo.id}
          style={{ left: echo.x, top: echo.y }}
        >
          <span className={css.echoGlyph}>{echo.text}</span>
        </span>
      ))}
      {customCaret && caret !== null && (
        <span
          className={css.caret}
          data-typing-fx-caret={style.cursor}
          style={{ left: caret.x, top: caret.y, height: caret.height }}
        />
      )}
    </div>
  )
}
