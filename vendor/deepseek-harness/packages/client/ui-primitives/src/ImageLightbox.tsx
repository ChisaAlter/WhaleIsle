import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutlineRegular } from './icons/index.tsx'
import { usePresence } from './usePresence.ts'
import css from './ImageLightbox.module.css'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal: an opener inside
 * a transformed or filtered ancestor would otherwise trap the fixed backdrop
 * in that ancestor's box instead of covering the viewport.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.open - whether the preview is showing; default true for mount-as-open callers.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog, or null after the exit hold.
 */
export function ImageLightbox({ open = true, src, alt, labels, onClose }: {
  open?: boolean
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const { mounted, state } = usePresence(open)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      restoreRef.current?.focus()
    }
  }, [open, onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
      data-dsh-motion="overlay"
      data-state={state}
      aria-hidden={open ? undefined : true}
    >
      <div className={css.stage}>
        <div className={css.mask} data-dsh-motion-part="mask" aria-hidden="true" onMouseDown={onClose} />
        <img className={css.image} data-dsh-motion-part="panel" src={src} alt={alt} />
        <button ref={closeRef} type="button" className={css.close} aria-label={labels.close} onClick={onClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
