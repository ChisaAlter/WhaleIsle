import { useState, type ReactNode } from 'react'
import { IconChecklistOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from './icons/index.tsx'
import css from './TaskDock.module.css'

/** Shared compact task strip above the composer, initially collapsed. */
export function TaskDock({ title, summary, children, testId }: {
  title: string
  summary?: string
  children: ReactNode
  testId?: string
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <section className={css.root} data-testid={testId} aria-label={title}>
      <div className={css.body}>
        <button type="button" className={css.header} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
          <span className={css.lead} aria-hidden><IconChecklistOutlineRegular /></span>
          <span className={css.title}>{title}</span>
          <span className={css.progress}>{summary}</span>
          <span className={css.chevron} aria-hidden>{expanded ? <IconChevronDownOutlineRegular /> : <IconChevronUpOutlineRegular />}</span>
        </button>
        {expanded && children}
      </div>
    </section>
  )
}
