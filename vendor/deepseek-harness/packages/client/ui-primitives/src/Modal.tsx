import { useRef } from 'react'
import type { KeyboardEventHandler, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutline16 } from './icons/index.tsx'
import { usePresence } from './usePresence.ts'
import { modalHasToastControls, useModalLayer } from './useModalLayer.ts'
import css from './Modal.module.css'

interface ModalBaseProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  headerActions?: ReactNode
  className?: string | undefined
  contentClassName?: string | undefined
  shortcutModal?: string
  onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>
  backdropBlur?: boolean
}

type ModalProps = ModalBaseProps & (
  | { headless: true; closeLabel?: never }
  | { headless?: false; closeLabel: string }
)

/**
 * Render a centered, body-portaled modal over a blurred page mask.
 * @param props.open - whether the dialog is showing.
 * @param props.onClose - application close command, Escape, or mask click; while a menu is open inside the
 * dialog, Escape belongs to that menu first.
 * @param props.title - dialog heading (aria-label in every mode).
 * @param props.closeLabel - localized accessible close-button label.
 * @param props.description - optional supporting sentence under the title.
 * @param props.children - dialog body; mark its initial-focus control with
 * data-modal-autofocus instead of React autoFocus to preserve return focus.
 * @param props.footer - action row (Cancel / Create).
 * @param props.contentClassName - optional class for a scrollable content region.
 * @param props.backdropBlur - disable when the caller already blurs the page; defaults to true.
 * @param props.shortcutModal - command scope allowed by shortcut owners; unnamed
 * dialogs block application commands unless their owner allows the "other" scope.
 * @param props.headless - render children directly in the card (no default
 * header/close/body chrome); mask, card, Escape, and aria-label remain.
 * @param props.onKeyDownCapture - handle a nested dialog's keys before the document Escape listeners.
 * @returns null when unmounted; the overlay tree stays mounted through the
 * 200ms exit hold so the shared overlay recipe can play its exit transition.
 */
export function Modal({
  open, onClose, title, closeLabel, description, children, footer, headerActions, className, contentClassName,
  onKeyDownCapture, headless = false, backdropBlur = true, shortcutModal,
}: ModalProps) {
  const { mounted, state } = usePresence(open)
  const dialog = useRef<HTMLDivElement>(null)
  const owner = useRef<HTMLSpanElement>(null)
  useModalLayer(dialog, open, onClose, owner)

  if (!mounted) return null

  return <><span ref={owner} hidden data-dsh-modal-owner="" />{createPortal((
    <div
      className={css.root}
      role="presentation"
      data-dsh-motion="overlay"
      data-state={state}
      aria-hidden={open ? undefined : true}
      onKeyDownCapture={(event) => {
        // A caller's DOM-only Tab trap cannot see the body-portaled actions.
        if (event.key === 'Tab' && dialog.current !== null && modalHasToastControls(dialog.current)) return
        onKeyDownCapture?.(event)
      }}
    >
      <div className={css.mask} style={backdropBlur ? undefined : { backdropFilter: 'none' }} data-dsh-motion-part="mask" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialog}
        tabIndex={-1}
        data-shortcut-modal={shortcutModal}
        className={clsx(css.dialog, className)}
        data-dsh-motion-part="panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {headless
          ? children
          : (
            <>
              <div className={clsx(css.content, contentClassName)}>
                <div className={css.header} data-dsh-modal-header="">
                  <h2 className={css.title}>{title}</h2>
                  <div className={css.headerEnd}>
                    {headerActions}
                    <button type="button" className={css.close} aria-label={closeLabel} onClick={onClose}>
                      <IconCloseOutline16 size={14} />
                    </button>
                  </div>
                </div>
                {description !== undefined && description !== '' && (
                  <p className={css.description}>{description}</p>
                )}
                {children !== undefined && <div className={css.body}>{children}</div>}
              </div>
              {footer !== undefined && <div className={css.footer} data-dsh-modal-footer="">{footer}</div>}
            </>
          )}
      </div>
    </div>
  ), document.body)}</>
}
