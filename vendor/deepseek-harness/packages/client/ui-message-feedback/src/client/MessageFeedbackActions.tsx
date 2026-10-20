/**
 * Per-message feedback controls: the Like/Dislike pair inside the assistant
 * message's IconActions row, between copy and branch. Either rating opens the
 * Session's feedback dialog, whose submission records that judgment with its
 * category and text. Clicking the recorded rating retracts it. A recorded rating
 * shows the filled glyph so the signal survives a pointer leaving the row.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/MessageFeedbackActions
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, IconDislikeFillRegular, IconDislikeOutlineRegular, IconLikeFillRegular, IconLikeOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import type { MessageFeedbackActionFailure } from './controller.ts'
import type { MessageFeedbackActionProps } from './slots.ts'
import css from './MessageFeedbackActions.module.css'

/**
 * One message's feedback controls.
 * @param props - the owner's message identity, the injected verbs, and the
 * shared feedback hook.
 * @returns the rating buttons with any failure notice beside them.
 */
export function MessageFeedbackActions({
  messageId, ensure, current, retract, openDialog, useFeedback, t,
}: MessageFeedbackActionProps) {
  const item = useFeedback(view => view.items.get(messageId))
  const loadFailed = useFeedback(view => view.status === 'error')
  const rating = item?.rating
  const [pending, setPending] = useState<MessageFeedbackRating | null>(null)
  // Failure copy is display state; the controller retains the rating and load state.
  const [failure, setFailure] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  // The controls mount for every settled message in the transcript, so the
  // Session's feedback is read once on first hover/focus rather than on mount.
  const seeded = useRef(false)
  const seed = useCallback(() => {
    if (seeded.current) return
    seeded.current = true
    void ensure().then(loaded => {
      if (!alive.current) return
      if (!loaded.ok) setFailure(t('error.load'))
    })
  }, [ensure, t])

  const errorCopy = useCallback((result: MessageFeedbackActionFailure) => {
    return result.error.code === 'version-conflict' ? t('error.conflict') : t('error.generic')
  }, [t])

  // A recorded rating retracts on click; either unrecorded rating opens the
  // dialog and records only after submission. The decision waits for the
  // seeding read, so a click on a cold row still sees the stored judgment.
  const choose = useCallback((nextRating: MessageFeedbackRating) => {
    if (pending !== null) return
    setPending(nextRating)
    setFailure(null)
    void ensure().then((loaded) => {
      if (!alive.current) return
      if (!loaded.ok || current(messageId)?.rating !== nextRating) {
        setPending(null)
        if (!loaded.ok) setFailure(t('error.load'))
        openDialog(messageId, nextRating)
        return
      }
      void retract(messageId, nextRating).then((result) => {
        if (!alive.current) return
        setPending(null)
        if (!result.ok) setFailure(errorCopy(result))
      })
    })
  }, [current, ensure, errorCopy, messageId, openDialog, pending, retract, t])

  const onLike = useCallback(() => { choose('positive') }, [choose])
  const onDislike = useCallback(() => { choose('negative') }, [choose])

  const likeLabel = rating === 'positive' ? t('action.likeActive') : t('action.like')
  const dislikeLabel = rating === 'negative' ? t('action.dislikeActive') : t('action.dislike')

  return (
    <>
      <Tooltip label={likeLabel} side="bottom">
        <Button
          type="button"
          size="sm"
          className={css.action}
          loading={pending === 'positive'}
          aria-label={likeLabel}
          aria-pressed={rating === 'positive'}
          data-active={rating === 'positive' || undefined}
          disabled={pending !== null}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={onLike}
        >
          {rating === 'positive' ? <IconLikeFillRegular /> : <IconLikeOutlineRegular />}
        </Button>
      </Tooltip>
      <Tooltip label={dislikeLabel} side="bottom">
        <Button
          type="button"
          size="sm"
          className={css.action}
          loading={pending === 'negative'}
          aria-label={dislikeLabel}
          aria-pressed={rating === 'negative'}
          data-active={rating === 'negative' || undefined}
          disabled={pending !== null}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={onDislike}
        >
          {rating === 'negative' ? <IconDislikeFillRegular /> : <IconDislikeOutlineRegular />}
        </Button>
      </Tooltip>
      {failure === null && loadFailed && <span className={css.failure} role="status">{t('error.load')}</span>}
      {failure !== null && <span className={css.failure} role="status">{failure}</span>}
    </>
  )
}
