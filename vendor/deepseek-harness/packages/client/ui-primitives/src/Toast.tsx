import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconCheckCircleOutlineRegular } from './icons/index.tsx'
import { acquireToastStack, registerToastLayer } from './useModalLayer.ts'
import css from './Toast.module.css'

/** Full-opacity hold before the fade starts, when the owner names none. */
const HOLD_MS = 3000
/** Fade duration. Must agree with the stylesheet's toast-fade duration. */
const FADE_MS = 1000
/** Hold for a notice that carries a recovery action, long enough to reach it. */
const ACTION_HOLD_MS = 6000

/**
 * Transient top-center banner: slides in, holds at full opacity, fades out,
 * then reports done so the owner can unmount it. Re-showing the same text
 * restarts the cycle when the owner remounts the component (key it by a
 * per-show sequence). Rendered through a body portal so an owner inside a
 * transformed or filtered ancestor cannot trap the fixed banner in that
 * ancestor's box.
 * With unchanged holdMs, parent rerenders do not extend the lifetime.
 * Completion calls the latest onDone handler; fully faded actions receive no input.
 *
 * The hold is the owner's to set, because how long a banner has to stay
 * depends on how much there is to read: a one-line limit lands in the default
 * window, while a failure that names what broke does not. One value drives
 * both the unmount timer and the stylesheet's fade delay — the stylesheet
 * reads it as a custom property — so the two can no longer disagree and leave
 * the banner unmounting mid-fade.
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph (e.g. a warning icon); ignored
 * under `tone="success"`, which brings its own glyph.
 * @param props.tone - 'success' renders the design's circled green check as
 * the leading glyph; omitted, the icon seat keeps its warning tint.
 * @param props.actions - optional inline actions continuing the sentence:
 * each renders its plain-text `prefix` (a connective like 或) followed by its
 * localized `label` as blue clickable text, flowing after `text` as one
 * sentence. Each press is the owner's to handle (e.g. undo the reported
 * change, then unmount the toast). The banner surface stays click-through —
 * only the action text takes the pointer.
 * @param props.holdMs - full-opacity hold before the fade; defaults to 3000.
 * Every banner fades on its own: `null` holds for {@link ACTION_HOLD_MS}, and
 * `dismissLabel` no longer renders a close control.
 * @param props.anchor - optional element whose horizontal center the banner
 * follows (e.g. the composer card, so the banner centers over the chat column
 * rather than the whole window); omitted, it centers on the viewport.
 * @param props.onDone - called once the fade completes; unmount the toast here.
 * @returns the floating banner.
 */
export function Toast({ text, icon, tone, anchor, holdMs: requestedHold = HOLD_MS, actions, onDone }: {
  text: string
  icon?: ReactNode
  tone?: 'success' | undefined
  anchor?: HTMLElement | null
  /** Null asks for the longer hold of a notice with a recovery action. */
  holdMs?: number | null | undefined
  actions?: readonly { label: string; prefix?: string; disabled?: boolean | undefined; onClick: () => void }[] | undefined
  /** Accepted from existing owners; banners render no close control. */
  dismissLabel?: string | undefined
  onDone: () => void
}) {
  const holdMs = requestedHold ?? ACTION_HOLD_MS
  const owner = useRef<HTMLSpanElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const [stack, setStack] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)
  const elapsed = useRef(0)
  const duration = useRef(holdMs)
  const [animationElapsed, setAnimationElapsed] = useState(0)
  const latestOnDone = useRef(onDone)
  useLayoutEffect(() => { latestOnDone.current = onDone }, [onDone])
  useLayoutEffect(() => {
    const lease = acquireToastStack(document, css.stack as string)
    setStack(lease.element)
    return lease.release
  }, [])
  useLayoutEffect(() => {
    if (owner.current === null || surface.current === null) return
    return registerToastLayer(owner.current, surface.current, setVisible)
  }, [stack, text])
  useLayoutEffect(() => {
    duration.current = holdMs
    elapsed.current = 0
    setAnimationElapsed(0)
  }, [holdMs])
  useEffect(() => {
    if (!visible) return
    const started = performance.now()
    const timer = setTimeout(() => { latestOnDone.current() }, Math.max(0, holdMs + FADE_MS - elapsed.current))
    return () => {
      clearTimeout(timer)
      if (duration.current !== holdMs) return
      elapsed.current += performance.now() - started
      setAnimationElapsed(elapsed.current)
    }
  }, [holdMs, visible])
  // Anchor-centered placement re-measures on window resizes; the banner lives
  // four seconds, so sub-window layout drift within that span stays out of
  // scope.
  const [left, setLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (anchor == null) return
    const measure = (): void => {
      const rect = anchor.getBoundingClientRect()
      setLeft(rect.left + rect.width / 2)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [anchor])
  return <><span ref={owner} hidden data-dsh-toast-owner="" />{stack === null ? null : createPortal(
    <div
      ref={surface}
      className={css.toast}
      role="alert"
      hidden={!visible}
      data-dsh-toast=""
      style={{
        ...left === null ? {} : { left },
        '--dsh-toast-hold': `${String(holdMs)}ms`,
        '--dsh-toast-elapsed': `${String(animationElapsed)}ms`,
      } as CSSProperties}
    >
      {tone === 'success'
        ? <span className={`${css.icon} ${css.success}`} aria-hidden><IconCheckCircleOutlineRegular /></span>
        : icon !== undefined && <span className={css.icon} aria-hidden>{icon}</span>}
      <span className={css.text}>
        {text}
        {actions?.map(action => (
          <Fragment key={action.label}>
            {action.prefix}
            <button type="button" className={css.action} disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </button>
          </Fragment>
        ))}
      </span>
    </div>,
    stack,
  )}</>
}
