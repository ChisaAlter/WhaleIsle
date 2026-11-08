/** Running Turn clock isolated from the transcript's render cycle. */
import { memo, useEffect, useState } from 'react'
import { TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import { RunningWhaleGirl } from './RunningWhaleGirl.tsx'
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

interface RunningStatusProps {
  readonly startTime: number | undefined
  /** Freeze the shown duration while the Client cannot observe the Session. */
  readonly paused: boolean
  /** Keep the slot without showing or announcing the status: the Session stopped before its Turn closed. */
  readonly holding?: boolean
  readonly t: ChatViewSlotProps['t']
}

/**
 * Show live elapsed time after the current Turn's content without announcing ticks.
 * @param props - Current Turn start time, pause state, and localized copy.
 * @returns the skin-selected running indicator; mount while the Session is running, or holding its slot hidden until the
 * Turn's actions row replaces it.
 */
export const RunningStatus = memo(function RunningStatus({ startTime, paused, holding = false, t }: RunningStatusProps) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startTime === undefined || paused || holding) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [startTime, paused, holding])
  const params = { duration: formatRunDuration(Math.max(1000, now - (startTime ?? now)), t).map(part => part.text).join('') }
  const label = startTime === undefined ? t('chat.deepDiving') : t('chat.deepDivingFor', params)
  const thinkingLabel = startTime === undefined ? t('chat.thinking') : t('chat.thinkingFor', params)
  return (
    <div className={css.running} data-chat-running data-holding={holding ? '' : undefined} aria-hidden={holding || undefined}>
      {holding ? null : (
        <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
          <span data-dsh-mascot="default">{t('chat.deepDiving')}</span>
          <span data-dsh-mascot="claude">{t('chat.thinking')}</span>
        </span>
      )}
      <span className={css.runningDivider} aria-hidden="true" />
      <span className={css.runningContent}>
        <RunningWhaleGirl />
        <span data-dsh-mascot="default"><TextShimmer active={!holding} className={css.runningText}>{label}</TextShimmer></span>
        <span data-dsh-mascot="claude"><TextShimmer active className={css.runningText}>{thinkingLabel}</TextShimmer></span>
      </span>
    </div>
  )
})
