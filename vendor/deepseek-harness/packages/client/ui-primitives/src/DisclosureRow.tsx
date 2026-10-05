import { memo, useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from './icons/index.tsx'
import { TextShimmer } from './TextShimmer.tsx'
import { usePresence } from './usePresence.ts'
import css from './DisclosureRow.module.css'

/**
 * `inert` fully deactivates a retained exit frame: it leaves the a11y tree and
 * blocks focus and keyboard activation on every descendant. Gate it on the
 * LOGICAL open flag, never `data-state` — the fade recipe's first frame is
 * already `closed`, and the body must stay reachable then. React 18's DOM
 * typings predate the attribute, so it rides an attribute spread.
 */
function inertWhen(inactive: boolean): Record<string, string> {
  return inactive ? { inert: '' } : {}
}

/** Shared 24px disclosure chrome for compact flow rows. */
export interface DisclosureRowProps {
  icon: ReactNode
  title: string
  open: boolean
  expandable: boolean
  onToggle: () => void
  /** Animate the complete header while its owning operation is running. */
  running?: boolean | undefined
  /** Makes the complete title row the disclosure target. */
  expandOnRowClick?: boolean | undefined
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined
  collapsedContent?: ReactNode
  children?: ReactNode
  className?: string | undefined
  rowClassName?: string | undefined
  /** Sizing class for the header text area, beside the leading icon. */
  contentClassName?: string | undefined
  /** Layout class shared by the header text and its decorative copy. */
  contentLayoutClassName?: string | undefined
  leadingClassName?: string | undefined
  chevronClassName?: string | undefined
  titleClassName?: string | undefined
}

/**
 * Render one disclosure header and its controlled expanded content.
 * Shallow prop comparison requires stable callbacks and React nodes to skip unchanged renders.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export const DisclosureRow = memo(function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  running = false,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  collapsedContent,
  children,
  className,
  rowClassName,
  contentClassName,
  contentLayoutClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps) {
  const { mounted, state } = usePresence(open)
  /**
   * Real callers drop their body on collapse (ReasoningRow's memo returns
   * undefined when collapsed; ToolRow removes `expandedContent`), so the exit
   * frame would render an empty box. Keep the last open body — the SAME React
   * element, never a re-constructed expensive one — through the exit hold,
   * refresh it while open, and drop it once the hold ends.
   */
  const retainedBody = useRef<ReactNode>(null)
  if (open) retainedBody.current = children ?? null
  useEffect(() => {
    if (!mounted) retainedBody.current = null
  }, [mounted])
  const body = open ? children ?? null : retainedBody.current
  const rowExpands = expandable && expandOnRowClick
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle()
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rowExpands || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onToggle()
  }
  const collapsedLeading = previewChevron
    ? (
      <>
        <span className={css.iconIdle}>{icon}</span>
        <IconChevronDownOutlineRegular className={clsx(chevronClassName, css.chevronHover)} />
      </>
    )
    : icon
  const leading = open
    ? <IconChevronUpOutlineRegular className={chevronClassName} />
    : collapsedLeading

  return (
    <div className={clsx(css.root, className)} data-open={open || undefined}>
      <div
        className={clsx(css.row, rowClassName)}
        data-disclosure-row
        data-expandable={rowExpands || undefined}
        role={rowExpands ? 'button' : undefined}
        tabIndex={rowExpands ? 0 : undefined}
        aria-expanded={rowExpands ? open : undefined}
        onClick={rowExpands ? onToggle : undefined}
        onKeyDown={rowExpands ? toggleFromKeyboard : undefined}
      >
        {expandable && !rowExpands ? (
          <button
            type="button"
            className={clsx(css.leading, leadingClassName)}
            aria-label={title}
            aria-expanded={open}
            onClick={toggleFromLeading}
          >
            {leading}
          </button>
        ) : (
          <span className={clsx(css.leading, leadingClassName)}>
            {leading}
          </span>
        )}
        <TextShimmer active={running} className={contentClassName} contentClassName={contentLayoutClassName}>
          <TextShimmer className={clsx(css.title, titleClassName)}>{title}</TextShimmer>
          {(keepContentWhenOpen || !open) && collapsedContent}
        </TextShimmer>
      </div>
      {mounted && body != null && (
        <div data-dsh-motion="fade" data-state={state} aria-hidden={open ? undefined : true} {...inertWhen(!open)}>{body}</div>
      )}
    </div>
  )
})
