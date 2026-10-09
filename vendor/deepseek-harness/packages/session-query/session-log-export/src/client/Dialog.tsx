import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'

/** Browser operations and state injected into the shared download dialog. */
export interface SessionLogDownloadDialogInjected {
  hooks: {
    sessionLogDownload: ObservableSnapshot<SessionLogDownloadState>
  }
  request: (sessionId: SessionId) => Promise<void>
  dismiss: (sessionId: SessionId) => void
}

export type SessionLogDownloadDialogProps =
  PropsRuntime<'shell.titlebar.trailing'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadDialogInjected>
  & { sessionId?: SessionId }

/**
 * Modal shared by the Session Header download menu item and this browser's `/export` command.
 * @param props - Session runtime, bound controller state, actions, and localized copy.
 * @returns the modal portal contribution.
 */
export function SessionLogDownloadDialog({
  sessionId, useSessionLogDownload, dismiss, t,
}: SessionLogDownloadDialogProps & { sessionId: SessionId }) {
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])

  const status = entry?.status
  const open = entry?.open === true
  const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null
  const title = status === 'downloading'
    ? t('dialog.preparingTitle')
    : status === 'success' ? t('dialog.successTitle') : t('dialog.errorTitle')
  const description = status === 'downloading'
    ? t('dialog.preparingDescription')
    : status === 'success' ? t('dialog.successDescription') : error ?? t('dialog.commandFailed')

  return (
    <Modal
      open={open}
      onClose={() => { dismiss(sessionId) }}
      title={title}
      description={description}
      closeLabel={t('dialog.close')}
      footer={<Button variant="primary" onClick={() => { dismiss(sessionId) }}>{t('dialog.close')}</Button>}
    />
  )
}
