// Button: token-styled button atom. Variants map to the --dsw-alias-button-*
// fill families; no framework imports, all behavior via props.

import { forwardRef, useCallback, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import { FlipText } from './FlipText.tsx'
import { StateDot } from './StateDot.tsx'
import css from './Button.module.css'

/** Visual variant, each backed by its --dsw-alias-button-* token family. */
export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

type ButtonProps = {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  /** Circular capsule corners instead of the default rounded control. */
  shape?: 'rounded' | 'pill'
  icon?: ReactNode
  className?: string | undefined
  children?: ReactNode
  /** Show a busy indicator inside the normal caption's seat. */
  loading?: boolean | undefined
  /** Localized transient result, overlaid without changing the button's size. */
  feedback?: string | undefined
} & ButtonHTMLAttributes<HTMLButtonElement>

/**
 * Render a button.
 * @param props.variant - visual family (default 'ghost').
 * @param props.size - 'md' 36px control or 'sm' 28px control.
 * @param props.shape - 'rounded' 12px/8px corners (default) or 'pill' 18px/14px circular corners.
 * @param props.icon - optional leading 16px icon node.
 * @param ref - native button for focus management and overlay anchors.
 * @returns the button element; native button attributes pass through.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'ghost', size = 'md', shape = 'rounded', icon, className, children, loading = false, feedback, ...rest
}, ref) {
  const busy = loading || rest['aria-busy'] === true || rest['aria-busy'] === 'true'
  const showingFeedback = feedback !== undefined
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const overlayRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [labelFits, setLabelFits] = useState(false)
  const attachButton = useCallback((element: HTMLButtonElement | null) => {
    buttonRef.current = element
    if (typeof ref === 'function') {
      const callback: (node: HTMLButtonElement | null) => void | (() => void) = ref
      const cleanup = callback(element)
      if (typeof cleanup === 'function') return () => {
        buttonRef.current = null
        cleanup()
      }
    } else if (ref !== null) ref.current = element
  }, [ref])
  const resting = useRef({ children, icon })
  useLayoutEffect(() => {
    if (!busy && !showingFeedback) resting.current = { children, icon }
  }, [busy, showingFeedback, children, icon])
  const caption = busy || showingFeedback ? resting.current.children : children
  const shownIcon = busy || showingFeedback ? resting.current.icon : icon
  const hasCaption = typeof caption === 'string' ? caption !== '' : typeof caption === 'number'
  const statusLabel = feedback ?? rest['aria-label'] ?? (typeof children === 'string' ? children : undefined)
  const feedbackLabel = feedback ?? (hasCaption ? statusLabel : undefined)
  useLayoutEffect(() => {
    const button = buttonRef.current
    const overlay = overlayRef.current
    const measure = measureRef.current
    if ((!busy && !showingFeedback) || button === null || overlay === null || measure === null) return
    const fit = (): void => {
      const style = getComputedStyle(overlay)
      const available = overlay.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')
      const indicator = busy ? 12 + parseFloat(style.columnGap || '0') : 0
      setLabelFits(feedbackLabel !== undefined && available > 0
        && measure.scrollWidth + indicator <= available)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(button)
    observer.observe(measure)
    return () => { observer.disconnect() }
  }, [busy, showingFeedback, feedbackLabel])
  const compact = (busy || showingFeedback) && !labelFits
  return (
    <button ref={attachButton} type="button" className={clsx(css.button, css[variant], css[size], shape === 'pill' && css.pill, className)} {...rest}
      disabled={rest.disabled || busy} aria-busy={busy ? true : rest['aria-busy']}
      aria-label={busy || showingFeedback ? statusLabel : rest['aria-label']}
      title={compact && statusLabel !== undefined ? statusLabel : rest.title}
      data-feedback-display={busy || showingFeedback ? compact ? busy ? hasCaption ? 'compact-label' : 'indicator' : 'caption' : 'label' : undefined}>
      {shownIcon != null && <span className={clsx(css.icon, busy && css.busyIcon)}>{shownIcon}</span>}
      {busy || showingFeedback ? <span className={css.caption}>
        <span className={clsx(css.reserve, compact && !busy && css.reserveVisible)} aria-hidden={statusLabel !== undefined}>{caption}</span>
        <span ref={overlayRef} className={css.feedback}>
          {busy && <StateDot state="ongoing" size={12} />}
          {busy && compact && hasCaption && <span aria-hidden="true">…</span>}
          {feedbackLabel !== undefined && <span ref={measureRef}
            className={clsx(css.feedbackLabel, !labelFits && css.feedbackLabelHidden)} aria-hidden={!labelFits}>
            <FlipText text={feedbackLabel} />
          </span>}
        </span>
      </span> : children}
    </button>
  )
})
