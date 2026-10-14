import { useEffect, useRef, useState, type ReactNode } from 'react'
import { StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { FIT_SETTLE_MS, hostHasFitSize } from './fit.ts'
import { sessionBuffer, type TerminalSessionRecord } from './stores.ts'
import {
  activateTerminalTarget,
  extractTerminalLinks,
  isTerminalLinkActivation,
  type TerminalLinkMatch,
} from './links.ts'
import { NS } from './locales.ts'
import { normalizeSelection } from './selection.ts'
import type { TerminalShellInjected } from './shell.ts'
import { readXtermFont, terminalFontOptions, terminalThemeFromApp } from './terminal-theme.ts'
import { GhosttyTerminalSurface } from './ghostty/surface.ts'
import {
  isTerminalClearShortcut,
  isTerminalDrawerShortcut,
  terminalDeleteShortcutData,
  terminalNavigationShortcutData,
} from './ghostty/terminalKeyShortcuts.ts'
import css from './TerminalWorkspace.module.css'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

export interface TerminalPaneProps {
  /** The PTY session id backing this pane. */
  id: string
  /** Session record whose replay buffer seeds and backfills the terminal. */
  session?: TerminalSessionRecord | undefined
  /** True when this pane is the shell's active session; the surface is focused then. */
  active: boolean
  /** Mark this pane's session active without moving DOM focus onto the chrome. */
  onActivate: () => void
  /** Forward terminal input to the PTY. */
  onData: (bytes: string) => void
  /** Report the fitted geometry so the PTY can be resized. */
  onResize: (cols: number, rows: number) => void
  /** Current session id for composer writes; missing is a no-op. */
  sessionId: string | undefined
  /** Session cwd used to resolve relative path links. */
  cwd: string | undefined
  mentionTerminal: TerminalShellInjected['mentionTerminal']
  writeClipboard: TerminalShellInjected['writeClipboard']
  openWorkspacePath: TerminalShellInjected['openWorkspacePath']
  openLocalUrl: TerminalShellInjected['openLocalUrl']
  openExternal: TerminalShellInjected['openExternal']
  t: PropsLocale<typeof NS>['t']
}

/**
 * One interactive pane: Ghostty Canvas surface over a PTY. The
 * store's replay buffer seeds the terminal with `resetAndWrite` (PTY writer
 * detached) and backfills incrementally. Ghostty owns fit,
 * 150 ms PTY resize debounce, bold-as-700, and the engine ANSI palette.
 * @param props - pane identity, replay buffer, PTY callbacks, and work-loop injects.
 * @returns the Ghostty host element and the selection action bar.
 */
export function TerminalPane({
  id, session, active, onActivate, onResize, sessionId, cwd,
  mentionTerminal, writeClipboard, openWorkspacePath, openLocalUrl, openExternal, t,
  onData,
}: TerminalPaneProps): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<GhosttyTerminalSurface | null>(null)
  /** Bytes of the replay buffer already written to the current terminal. */
  const writtenRef = useRef(0)
  const callbacksRef = useRef({
    onData, onResize, onActivate, cwd, mentionTerminal, writeClipboard, openWorkspacePath, openLocalUrl, openExternal,
  })
  callbacksRef.current = {
    onData, onResize, onActivate, cwd, mentionTerminal, writeClipboard, openWorkspacePath, openLocalUrl, openExternal,
  }
  const [selection, setSelection] = useState('')
  const [initializing, setInitializing] = useState(true)
  const [failure, setFailure] = useState<string>()
  const sessionRef = useRef(session)
  sessionRef.current = session
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const host = hostRef.current
    /* v8 ignore next -- the host ref is attached on the div this effect reads. */
    if (host === null) return
    setInitializing(true)
    setFailure(undefined)
    let cancelled = false
    let teardown: (() => void) | undefined
    const font = readXtermFont(host)
    const setupFont = terminalFontOptions(font.fontFamily, font.fontSize)
    function handleBeforeKey(event: KeyboardEvent): boolean {
      // Ctrl/Cmd+` toggles the terminal drawer even from terminal focus:
      // refuse the key (the surface suppresses its keyup release) and let it
      // bubble to the titlebar window listener, which toggles and calls
      // preventDefault.
      if (isTerminalDrawerShortcut(event)) return false
      const navigationData = terminalNavigationShortcutData(event)
      if (navigationData !== null) {
        event.preventDefault()
        event.stopPropagation()
        callbacksRef.current.onData(navigationData)
        return false
      }
      const deleteData = terminalDeleteShortcutData(event)
      if (deleteData !== null) {
        event.preventDefault()
        event.stopPropagation()
        callbacksRef.current.onData(deleteData)
        return false
      }
      if (!isTerminalClearShortcut(event)) return true
      event.preventDefault()
      event.stopPropagation()
      callbacksRef.current.onData('\u000c')
      return false
    }
    void GhosttyTerminalSurface.create(host, {
      theme: terminalThemeFromApp(host),
      font: setupFont,
      onData: (bytes) => { callbacksRef.current.onData(bytes) },
      onResize: (cols, rows) => { callbacksRef.current.onResize(cols, rows) },
      onSelectionChange: () => {
        setSelection(normalizeSelection(termRef.current?.getSelection() ?? ''))
      },
      onCopy: (text) => { void callbacksRef.current.writeClipboard(text) },
      beforeKey: (event) => handleBeforeKey(event),
      onLinkActivate: (text, event) => {
        if (!isTerminalLinkActivation(event)) return
        activateTerminalTarget(text, callbacksRef.current.cwd, callbacksRef.current)
      },
    }).then((terminal) => {
      if (cancelled) {
        terminal.dispose()
        return
      }
      terminal.setTheme(terminalThemeFromApp(host))
      termRef.current = terminal
      setInitializing(false)
      const seed = sessionBuffer(sessionRef.current)
      if (seed.length > 0) terminal.resetAndWrite(seed)
      writtenRef.current = seed.length
      if (activeRef.current) window.requestAnimationFrame(() => { terminal.focus() })
      const applyTheme = (): void => {
        terminal.setTheme(terminalThemeFromApp(host))
      }
      const themeObserver = new MutationObserver(applyTheme)
      themeObserver.observe(host.ownerDocument.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      })
      themeObserver.observe(host.ownerDocument.body, {
        attributes: true,
        // The presenter writes the mixed surface tokens (the pane fill among
        // them) as inline custom properties on body, so style must be in the
        // filter for glass-slider and wallpaper changes to reach the canvas.
        attributeFilter: ['data-ds-dark-theme', 'style'],
      })
      const fitTimer = window.setTimeout(() => {
        const activeTerminal = termRef.current
        /* v8 ignore next -- teardown clears this timer when it nulls termRef. */
        if (activeTerminal === null) return
        // Do not fit a collapsed or not-yet-laid-out pane: Ghostty's default
        // grid would otherwise be reported to the PTY as a spurious resize.
        if (!hostHasFitSize(host)) return
        const wasAtBottom = activeTerminal.isAtBottom()
        activeTerminal.fit()
        if (wasAtBottom) activeTerminal.scrollToBottom()
      }, FIT_SETTLE_MS)
      teardown = () => {
        window.clearTimeout(fitTimer)
        themeObserver.disconnect()
        /* v8 ignore next -- a replaced surface already cleared this ref. */
        if (termRef.current === terminal) termRef.current = null
        terminal.dispose()
        writtenRef.current = 0
      }
      /* v8 ignore next -- unmount during the create then() after teardown is assigned. */
      if (cancelled) teardown()
    }).catch((error: unknown) => {
      /* v8 ignore next -- cancelled create failures are dropped like Ghostty. */
      if (cancelled) return
      const message =
        error instanceof Error ? error.message : 'Unable to initialize libghostty-vt'
      setInitializing(false)
      setFailure(message)
    })
    return () => {
      cancelled = true
      teardown?.()
    }
    // The terminal instance is per-pane: rebuild when the pane id changes.
  }, [id])

  useEffect(() => {
    if (!active) return
    const term = termRef.current
    /* v8 ignore next -- the instance effect assigns termRef before this focus effect. */
    if (term === null) return
    const frame = requestAnimationFrame(() => { term.focus() })
    return () => { cancelAnimationFrame(frame) }
  }, [active, id])

  // Backfill output that arrived while this pane was unmounted (replay buffer).
  useEffect(() => {
    const term = termRef.current
    /* v8 ignore next -- backfill runs after the instance effect on the same commit. */
    if (term === null) return
    const buffer = sessionBuffer(session)
    if (buffer.length > writtenRef.current) {
      term.write(buffer.slice(writtenRef.current))
      writtenRef.current = buffer.length
    }
  }, [session?.buffer])

  const link: TerminalLinkMatch | undefined = selection.length === 0
    ? undefined
    : extractTerminalLinks(selection)[0]
  const openLabel = link?.kind === 'url' ? t('action.openLink') : t('action.openPath')

  return (
    <div className={css.paneTerminalWrap}>
      {initializing && <div className={css.panePending} role="status" aria-label={t('loading')}><StateDot state="ongoing" size={28} /></div>}
      {active && failure !== undefined && <Toast key={failure} text={t('error.initialize', { message: failure })} holdMs={null} dismissLabel={t('dismissFeedback')} onDone={() => { setFailure(undefined) }} />}
      <div
        ref={hostRef}
        // The `xterm` class declares the terminal input region to the shortcut
        // dispatcher's region detection (closest('.xterm') → 'terminal').
        className={`${css.paneTerminal} thread-terminal-drawer xterm`}
        data-terminal-pane={id}
        role="log"
        aria-label={id}
        onPointerDown={() => { callbacksRef.current.onActivate() }}
        onClick={(event) => { event.stopPropagation() }}
      />
      {selection.length > 0 ? (
        <div className={css.selectionBar} role="toolbar" aria-label={t('action.addToChat')}>
          <button
            type="button"
            className={css.selectionAction}
            onClick={() => { void writeClipboard(selection) }}
          >
            {t('action.copy')}
          </button>
          <button
            type="button"
            className={css.selectionAction}
            disabled={sessionId === undefined}
            onClick={() => {
              /* v8 ignore next -- the button is disabled when sessionId is missing. */
              if (sessionId === undefined) return
              mentionTerminal(sessionId, selection)
              termRef.current?.clearSelection()
              setSelection('')
            }}
          >
            {t('action.addToChat')}
          </button>
          {link !== undefined ? (
            <button
              type="button"
              className={css.selectionAction}
              onClick={() => {
                activateTerminalTarget(selection, cwd, { openLocalUrl, openWorkspacePath, openExternal })
              }}
            >
              {openLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
