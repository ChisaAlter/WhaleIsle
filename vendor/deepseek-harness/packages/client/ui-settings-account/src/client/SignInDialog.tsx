/** Account authorization dialog; errors allow retry after cancelling any active attempt. */
import { useEffect, useState } from 'react'
import { Button, IconCloseOutlineRegular, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountSnapshot } from './AccountSection.tsx'
import type { SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { AccountKey } from './locales.ts'
import { authorizeUrlWithTheme } from './authorize-url.ts'
import css from './SignInDialog.module.css'

/** @param props - safe account state, localized copy, and user actions. @returns login dialog. */
export function SignInDialog({ account, colorScheme, start, cancel, close, useApiKey, t }: {
  account: AccountSnapshot
  /** Resolved scheme of the active application theme; the copied link carries it. */
  colorScheme: 'light' | 'dark'
  start: () => Promise<void>
  cancel: (id: SignInAttemptId) => Promise<void>
  close: () => void
  useApiKey: () => void
  t: (key: AccountKey) => string
}) {
  const [operation, setOperation] = useState<'sign-in' | 'cancel' | null>(null)
  const busy = operation !== null
  const [failed, setFailed] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyResult, setCopyResult] = useState<{ messageKey: 'copiedLink' | 'copyFailed'; sequence: number } | null>(null)
  const attempt = account.view?.attempt
  useEffect(() => { setCopyResult(null) }, [attempt?.id, attempt?.authorizeUrl])
  const authorizeUrl = attempt?.authorizeUrl
  const phase = attempt?.phase
  const active = busy || phase === 'initializing' || phase === 'waiting-browser' || phase === 'exchanging' || phase === 'committing'
  const expired = phase === 'expired'
  const localFailure = failed || account.loginFailed || account.failed
  const error = localFailure || phase === 'failed'
  const failureKey = !localFailure
    && phase === 'failed' && attempt?.errorCode === 'no-response' ? 'noResponse' : 'failed'
  const waiting = active && !error
  const committing = phase === 'committing'
  const [attemptNoticeVisible, setAttemptNoticeVisible] = useState(error || expired)
  useEffect(() => { setAttemptNoticeVisible(error || expired) }, [error, expired, failureKey, attempt?.id])
  useEffect(() => { if (account.view?.status === 'credential-stored') close() }, [account.view?.status, close])
  const run = async (action: () => Promise<void>, kind: 'sign-in' | 'cancel' = 'sign-in') => {
    setOperation(kind)
    setFailed(false)
    setAttemptNoticeVisible(false)
    try { await action() } catch { setFailed(true); setAttemptNoticeVisible(true) } finally { setOperation(null) }
  }
  const dismiss = () => {
    if (committing || busy) return
    if (active && attempt) void run(async () => { await cancel(attempt.id); close() }, 'cancel')
    else close()
  }
  const retry = async () => {
    if (active && attempt) await cancel(attempt.id)
    await start()
  }
  const copyLink = async (authorizeUrl: string) => {
    if (copying) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(authorizeUrlWithTheme(authorizeUrl, colorScheme))
      setCopyResult(previous => ({ messageKey: 'copiedLink', sequence: (previous?.sequence ?? 0) + 1 }))
    } catch { setCopyResult(previous => ({ messageKey: 'copyFailed', sequence: (previous?.sequence ?? 0) + 1 })) }
    finally { setCopying(false) }
  }
  const title = active ? t('browserTitle') : t('loginTitle')
  return <Modal open headless title={title} onClose={dismiss} className={css.dialog as string}>
    <div className={css.content}>
      <div className={css.header} data-dsh-modal-header="">
        <h2 className={css.title}>{title}</h2>
        <button type="button" className={css.close} aria-label={t('close')} onClick={dismiss}>
          <IconCloseOutlineRegular size={14} />
        </button>
      </div>
      {active ? <p className={css.description}>
        {t('browserPrompt')}<Button className={css.link} disabled={!authorizeUrl || copying} loading={copying}
          onClick={authorizeUrl ? () => { void copyLink(authorizeUrl) } : undefined}>
          {t('copyLink')}
        </Button>{t('browserDescription')}
      </p> : <p className={css.description}>
        {t('loginDescription')}
      </p>}
    </div>
    {copyResult !== null && <Toast key={copyResult.sequence} text={t(copyResult.messageKey)} holdMs={2000}
      {...copyResult.messageKey === 'copiedLink' ? { tone: 'success' as const } : {}}
      onDone={() => { setCopyResult(null) }} />}
    {(error || expired) && attemptNoticeVisible && <Toast
      text={error ? t(failureKey) : `${t('timeoutTitle')} ${t('timeoutDescription')}`}
      holdMs={null} dismissLabel={t('close')} onDone={() => { setAttemptNoticeVisible(false) }} />}
    <div className={css.actions} data-dsh-modal-footer="">
      <Button variant="outline" className={css.secondaryButton} disabled={committing || busy}
        loading={operation === 'cancel'} {...active ? { feedback: t('cancel') } : {}}
        onClick={active ? dismiss : useApiKey}>{t('addApiKey')}</Button>
      <Button variant="primary" className={css.primaryButton} disabled={busy || committing || waiting || account.view === undefined}
        loading={waiting && operation !== 'cancel'} {...expired || error ? { feedback: t('retry') } : {}}
        aria-label={waiting ? t('waiting') : undefined} onClick={() => { void run(retry) }}>
        {t('signIn')}
      </Button>
    </div>
  </Modal>
}
