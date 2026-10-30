import { useState, type ReactNode } from 'react'
import { IconChecklistOutlineRegular, IconChevronUpOutlineRegular } from './icons/index.tsx'
import { usePresence } from './usePresence.ts'
import css from './TaskDock.module.css'

/** Shared compact task strip with retained exit and disclosure transitions. */
export function TaskDock({ title, summary, children, testId, open = true }: {
  title: string
  summary?: string
  children: ReactNode
  testId?: string
  /** Keep the last displayed content available until the closing transition ends. */
  open?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const presence = usePresence(open)
  const details = usePresence(expanded)
  if (!presence.mounted) return null
  return (
    <section
      className={css.root}
      data-testid={testId}
      data-state={presence.state}
      aria-label={title}
      aria-hidden={open ? undefined : true}
      {...open ? {} : { inert: '' }}
    >
      <div className={css.slot}>
        <div className={css.slide} data-state={presence.state}>
          <div className={css.surface} data-dsh-motion="fade" data-state={presence.state}>
            <div className={css.body}>
              <button type="button" className={css.header} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
                <span className={css.lead} aria-hidden><IconChecklistOutlineRegular /></span>
                <span className={css.title}>{title}</span>
                <span className={css.progress}>{summary}</span>
                <span className={css.chevron} data-expanded={expanded} aria-hidden><IconChevronUpOutlineRegular /></span>
              </button>
              {details.mounted && (
                <div className={css.details} data-state={details.state} aria-hidden={expanded ? undefined : true} {...expanded ? {} : { inert: '' }}>
                  <div className={css.clip}>
                    <div className={css.content} data-dsh-motion="fade" data-state={details.state}>{children}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
