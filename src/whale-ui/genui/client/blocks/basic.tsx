/**
 * Basic display family: avatar palette, and the local click-feedback button
 * (the actionable-button chip). Used by the render dispatcher.
 * @module @changfenhuang/dsh-genui/client/blocks/basic
 */
import { renderInline } from '../inline.ts'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import css from '../GenuiBlock.module.css'
import { useT } from '../i18n/index.ts'
import type { GenuiAudio, GenuiVideo } from '../spec.ts'
import type { GenuiActionAck } from '../action-context.ts'

/** Deterministic avatar color by name hash. Host static tokens ONLY —
 * design system v2: no off-brand hexes, the palette always matches the
 * theme's families (deepseek/blue/green/amber/red/neutral). */
const AVATAR_COLORS = [
  'var(--dsw-static-deepseek-400)',
  'var(--dsw-static-deepseek-450)',
  'var(--dsw-static-blue-450)',
  'var(--dsw-static-green-400)',
  'var(--dsw-static-amber-400)',
  'var(--dsw-static-red-400)',
  'var(--dsw-static-deepseek-300)',
  'var(--dsw-static-neutral-bluish-400)',
]

export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  // The array is a literal with 8 entries; the index is always in range.
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!
}

/** Button feedback follows the host acknowledgement; failure stays visible. */
export function ClickFeedbackButton({ className, disabled, onClick, children }: {
  className: string
  disabled?: boolean
  onClick?: (() => Promise<GenuiActionAck>) | undefined
  children: ReactNode
}) {
  const t = useT()
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; if (timer.current !== null) clearTimeout(timer.current) }
  }, [])
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || pending}
        onClick={onClick === undefined ? undefined : async () => {
          setPending(true); setSent(false); setError(null)
          try {
            const ack = await onClick()
            if (!alive.current) return
            if (ack.status === 'queued' || ack.status === 'completed') {
              if (timer.current !== null) clearTimeout(timer.current)
              setSent(true)
              timer.current = setTimeout(() => setSent(false), 1400)
            } else if (ack.status === 'failed') setError(ack.message)
          } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : String(failure)) }
          finally { if (alive.current) setPending(false) }
        }}
      >
        {children}
        {(sent || pending) && <span className={css.btnSent} aria-hidden>{t(pending ? 'action.pending' : 'action.queued')}</span>}
      </button>
      {/* Live-region sibling: button content is atomic to screen readers, so
       * the confirmation announces from a hidden status region. */}
      <span className={css.visuallyHidden} role="status">{pending ? t('action.pending') : sent ? t('action.queued') : ''}</span>
      {error !== null && <span role="alert">{t('action.failed')}: {error}</span>}
    </>
  )
}

/** Native controls intentionally own play/pause/seek/volume. Model-authored
 * autoplay and controls hints are ignored: media starts only after the user
 * asks for it. */
export const AudioNode = memo(function AudioNode({ node }: { node: GenuiAudio }): ReactNode {
  const t = useT()
  const [failed, setFailed] = useState(false)
  return (
    <figure className={css.media}>
      {node.alt !== undefined && <figcaption className={css.mediaLabel}>{renderInline(node.alt)}</figcaption>}
      {failed
        ? <div className={css.mediaError} role="alert">{t('block.audioError')}</div>
        : <audio
            className={css.mediaPlayer}
            src={node.src}
            aria-label={node.alt ?? t('block.audio')}
            controls
            preload="metadata"
            loop={node.loop === true}
            onError={() => setFailed(true)}
          />}
    </figure>
  )
})

export const VideoNode = memo(function VideoNode({ node }: { node: GenuiVideo }): ReactNode {
  const t = useT()
  const [failed, setFailed] = useState(false)
  return (
    <figure className={css.media}>
      {node.alt !== undefined && <figcaption className={css.mediaLabel}>{renderInline(node.alt)}</figcaption>}
      {failed
        ? <div className={css.mediaError} role="alert">{t('block.videoError')}</div>
        : <video
            className={`${css.mediaPlayer} ${css.videoPlayer}`}
            src={node.src}
            poster={node.poster}
            aria-label={node.alt ?? t('block.video')}
            controls
            preload="metadata"
            playsInline
            loop={node.loop === true}
            muted={node.muted === true}
            style={node.aspectRatio === undefined ? undefined : { aspectRatio: node.aspectRatio.replace(':', ' / ') }}
            onError={() => setFailed(true)}
          />}
    </figure>
  )
})
