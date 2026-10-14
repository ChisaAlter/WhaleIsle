import { useMemo, useState } from 'react'
import {
  Button, extractMarkdownPlainText, IconEditOutlineRegular, StateDot, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingQuestion, PlanReview, QuestionComposerProps } from './contract/slots.ts'
import css from './PlanReviewPanel.module.css'

/** The panel's own props: the question domain face, the narrowed review, and the locale seat. */
export type PlanReviewPanelProps =
  { pending: PendingQuestion; review: PlanReview } & Pick<QuestionComposerProps, 't' | 'renderSlot'>

/**
 * Optional-prop spread for a decision button's tooltip: `title` is optional on
 * the DOM props, and exactOptionalPropertyTypes rejects an explicit undefined.
 *
 * @param description - the asker's option description, when it carries one.
 * @returns The `title` prop to spread, or nothing.
 */
function tooltip(description: string | undefined): { title?: string } {
  return description === undefined ? {} : { title: description }
}

/**
 * Render plan review controls; the submitted document opens in the sidebar.
 *
 * @param props - the question domain face, the narrowed plan review, and `t`.
 * @returns The plan-review takeover for this request.
 */
export function PlanReviewPanel({ pending, review, t, renderSlot }: PlanReviewPanelProps) {
  // Foreground decisions wait for the resolved frame; accepted Remote decisions
  // hide the panel. A failed send re-enables the buttons and shows the error.
  const [busy, setBusy] = useState<'discuss' | 'approve' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedbackVisible, setFeedbackVisible] = useState(true)
  const settle = (send: () => Promise<void>, remote = false, action: 'discuss' | 'approve' = 'approve'): void => {
    if (busy !== null) return
    setBusy(action)
    setError(null)
    setFeedbackVisible(true)
    void send()
      .then(() => {
        if (!remote) return
        setBusy(null)
        void pending.dismiss().catch(() => { setError(t('status.sent')) })
      })
      .catch((cause: unknown) => {
        setBusy(null)
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }
  const decide = (label: string): void => {
    settle(() => pending.answer({ answers: [{ id: review.id, selected: [label] }] }), pending.snapshot().channel === 'rpc')
  }
  const summary = useMemo(() => {
    const title = extractMarkdownPlainText(review.plan, { mode: 'first-line' })
    const description = extractMarkdownPlainText(review.plan, { mode: 'first-paragraph' })
    return { title, description: description === title ? '' : description }
  }, [review.plan])

  return (
    <div className={css.frame} data-plan-review-key={pending.key}>
      {error !== null && feedbackVisible && <Toast text={error} holdMs={null} dismissLabel={t('close')} onDone={() => { setFeedbackVisible(false) }} />}
      <section className={css.card} aria-label={review.question} aria-busy={busy !== null}>
        <div className={css.strip}>
          <StateDot state={busy !== null ? 'ongoing' : 'warning'} />
          {t('plan.header')}
          <div className={css.previewActions}>
            {renderSlot('conversation.plan-review.actions', { review, requestKey: pending.key })}
          </div>
        </div>
        <div className={css.summary}>
          <h3 className={css.title}>{summary.title}</h3>
          {summary.description !== '' && <p className={css.description}>{summary.description}</p>}
        </div>
        <div className={css.footer}>
          <div className={css.feedback} aria-hidden />
          <div className={css.actions}>
            <Button
              variant="outline" className={css.discuss} icon={<IconEditOutlineRegular size={14} />}
              loading={busy === 'discuss'} disabled={busy !== null} onClick={() => { settle(() => pending.dismiss(), false, 'discuss') }}
            >
              {t('plan.discuss')}
            </Button>
            <Button
              variant="primary" {...tooltip(review.approve.description)}
              loading={busy === 'approve'} disabled={busy !== null} onClick={() => { decide(review.approve.label) }}
            >
              {t('plan.approve')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
