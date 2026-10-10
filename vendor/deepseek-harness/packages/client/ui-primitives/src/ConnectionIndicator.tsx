import { useEffect, useState } from 'react'
import { IconCheckOutlineRegular, IconRefreshOutlineRegular } from './icons/index.tsx'
import { StateDot } from './StateDot.tsx'
import { Tooltip } from './Tooltip.tsx'
import css from './ConnectionIndicator.module.css'

/** Visual state rendered by {@link ConnectionIndicator}. */
export type ConnectionIndicatorState =
  | 'disconnected'
  | 'connecting'
  | 'recovered'

/** Exit-transition length; keep equal to the `.leaving` transition duration in the stylesheet. */
const EXIT_MS = 150

/**
 * Render an inline connection-recovery control. The outage and retry-attempt
 * states are one button whose static label already names the retry action;
 * clicking it requests an immediate reconnect. The indicator animates in on
 * appearance and fades out for {@link EXIT_MS} before unmounting.
 * @param props.state - visible outage, retry-attempt, or recovered state.
 * @param props.disconnectedLabel - localized outage text naming the retry action.
 * @param props.connectingLabel - localized retry text followed by the attempt dots.
 * @param props.recoveredLabel - localized recovery confirmation.
 * @param props.reconnectActionLabel - accessible label for the outage action.
 * @param props.restartActionLabel - accessible label for replacing an active attempt.
 * @param props.onReconnect - request an immediate reconnect attempt.
 * @param props.compact - Use a fixed 36px icon control with tooltip copy.
 * @returns the indicator, or null when no connection feedback is active.
 */
export function ConnectionIndicator({
  state,
  disconnectedLabel,
  connectingLabel,
  recoveredLabel,
  reconnectActionLabel,
  restartActionLabel,
  onReconnect,
  compact = false,
}: {
  state: ConnectionIndicatorState | undefined
  disconnectedLabel: string
  connectingLabel: string
  recoveredLabel: string
  reconnectActionLabel: string
  restartActionLabel: string
  onReconnect: () => void
  compact?: boolean
}) {
  const [rendered, setRendered] = useState(state)
  const leaving = state === undefined && rendered !== undefined
  useEffect(() => {
    if (state !== undefined) {
      setRendered(state)
      return
    }
    if (rendered === undefined) return
    const timeout = window.setTimeout(() => { setRendered(undefined) }, EXIT_MS)
    return () => { window.clearTimeout(timeout) }
  }, [state, rendered])

  if (rendered === undefined) return null
  const leavingClass = leaving ? ` ${css.leaving}` : ''
  const compactClass = compact ? ` ${css.compact}` : ''
  if (rendered === 'recovered') {
    const indicator = (
      <div
        className={`${css.indicator} ${css.success}${leavingClass}${compactClass}`}
        role="status"
        aria-label={recoveredLabel}
      >
        <span className={css.icon} aria-hidden="true"><IconCheckOutlineRegular size={14} /></span>
        {!compact && <span className={css.label}>{recoveredLabel}</span>}
      </div>
    )
    return compact ? <Tooltip label={recoveredLabel} side="top" portal>{indicator}</Tooltip> : indicator
  }

  const connecting = rendered === 'connecting'
  const indicator = (
    <button
      type="button"
      className={`${css.indicator} ${css.warning}${leavingClass}${compactClass}`}
      data-phase={rendered}
      aria-label={connecting ? restartActionLabel : reconnectActionLabel}
      onClick={onReconnect}
    >
      <span className={css.icon} aria-hidden="true">
        {connecting
          ? <StateDot state="ongoing" />
          : <IconRefreshOutlineRegular size={14} />}
      </span>
      {!compact && <span className={css.label}>
        {connecting
          ? (
            <>
              {connectingLabel}
              <span className={css.dots} aria-hidden="true">
                <span>.</span>
                <span className={css.secondDot}>.</span>
                <span className={css.thirdDot}>.</span>
              </span>
            </>
          )
          : disconnectedLabel}
      </span>}
    </button>
  )
  return compact
    ? <Tooltip label={connecting ? connectingLabel : disconnectedLabel} side="top" portal>{indicator}</Tooltip>
    : indicator
}
