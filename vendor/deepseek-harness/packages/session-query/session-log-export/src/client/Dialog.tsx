import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'

/** Browser operations and state injected into the shared download feedback. */
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
 * Floating feedback shared by the Session Header download menu item and this browser's `/export` command.
 * @param props - Session runtime, bound controller state, actions, and localized copy.
 * @returns a transient alert that dismisses this Session's feedback after fading.
 */
export function SessionLogDownloadDialog({
  sessionId, useSessionLogDownload, dismiss, t,
}: SessionLogDownloadDialogProps & { sessionId: SessionId }) {
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])

  const status = entry?.status
  const open = entry?.open === true
  const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null
  const text = status === 'downloading'
    ? t('dialog.preparingDescription')
    : status === 'success' ? t('dialog.successTitle') : error ?? t('dialog.commandFailed')

  return open ? <Toast
    key={`${String(sessionId)}-${status ?? 'idle'}`}
    text={text}
    holdMs={null}
    tone={status === 'success' ? 'success' : undefined}
    icon={status === 'downloading' ? <StateDot state="ongoing" /> : undefined}
    dismissLabel={t('dialog.close')}
    onDone={() => { dismiss(sessionId) }}
  /> : null
}
