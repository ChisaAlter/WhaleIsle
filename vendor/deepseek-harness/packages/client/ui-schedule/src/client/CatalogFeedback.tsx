/** Catalog query states shared by the task list, the detail, and the task tab. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './TaskManagerPage.module.css'

/** Props of the catalog states: query state, shown content, and the retry action. */
export type CatalogFeedbackProps = PropsLocale<'schedule.manager'> & {
  /** Catalog query state; loading and a failed read each render their own state. */
  readonly status: 'loading' | 'ready' | 'error'
  /**
   * Whether catalog content is on screen: shown content keeps a compact
   * failure notice beside it, while an empty panel centers its states.
   */
  readonly populated: boolean
  /** Reload the catalog after a query failure. */
  readonly onRetry: () => Promise<void>
}

/**
 * Render the catalog's loading and query-failure states.
 *
 * An empty panel centers a bare spinner while loading. A failed read shows a
 * transient toast, then keeps an inline retry until the next read starts. An
 * empty panel centers that recovery; retained content keeps it compact. Refresh
 * loading stays silent over retained content. The app-wide toast announces
 * deletion outcomes separately.
 * @param props - query state, whether content is shown, the retry action, and localized copy.
 * @returns the applicable states, or nothing while the catalog is ready.
 */
export function CatalogFeedback({ status, populated, onRetry, t }: CatalogFeedbackProps): ReactNode {
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => { setDismissed(false) }, [status])
  return <>
    {status === 'loading' && !populated && <div className={css.empty} role="status" aria-label={t('list.loading')}>
      <StateDot state="ongoing" />
    </div>}
    {status === 'error' && (dismissed
      ? <div className={populated ? css.notice : css.empty} role="status">
        <p>{t('list.retryAvailable')}</p>
        <Button variant="outline" size="sm" onClick={() => { void onRetry() }}>{t('list.retry')}</Button>
      </div>
      : <Toast
        text={t('list.error')}
        holdMs={null}
        actions={[{ label: t('list.retry'), onClick: () => { void onRetry() } }]}
        onDone={() => { setDismissed(true) }}
      />)}
  </>
}
