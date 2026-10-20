import { useState, type ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  Button, IconDownloadOutlineRegular,
  IconEllipsisOutlineRegular, IconPaperPlaneOutlineRegular, Menu, MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'
import css from './HeaderAction.module.css'

/** Session-scoped menu state and actions; the titlebar contribution owns the shared download feedback. */
export interface SessionLogDownloadHeaderInjected {
  hooks: {
    sessionLogDownload: ObservableSnapshot<SessionLogDownloadState>
    feedbackAvailable: ObservableSnapshot<boolean>
  }
  request: (sessionId: SessionId) => Promise<void>
  /** Open a feedback draft without submitting feedback or exporting the Session. */
  openFeedback: (sessionId: SessionId) => void
}

export type SessionLogDownloadHeaderProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadHeaderInjected>

/**
 * Keep the Session's more-actions menu and feedback available while its download action is busy.
 * @param props - current Session, controller state, feedback availability, and copy.
 * @returns the compact Session action following the Agent controls.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadHeaderProps): ReactNode {
  const { sessionId, useSessions, useSessionLogDownload, useFeedbackAvailable, request, openFeedback, t } = props
  const managedSession = useSessions(state => state.byId[sessionId]?.presentation?.composer === 'managed')
  const feedbackAvailable = useFeedbackAvailable(value => value)
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
  const busy = entry?.status === 'downloading'
  const [open, setOpen] = useState(false)

  return managedSession ? null : (
    <Menu
      open={open}
      align="end"
      dense
      portal
      onClose={() => { setOpen(false) }}
      anchor={(
        <Button
          size="sm"
          className={css.moreButton}
          aria-label={t('header.more')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconEllipsisOutlineRegular />
        </Button>
      )}
    >
      <Button
        role="menuitem"
        className={css.downloadItem}
        icon={<IconDownloadOutlineRegular />}
        aria-busy={busy}
        loading={busy}
        disabled={busy}
        onClick={() => {
          setOpen(false)
          void request(sessionId)
        }}
      >
        {t('menu.download')}
      </Button>
      {feedbackAvailable && <MenuItemButton icon={<IconPaperPlaneOutlineRegular />} onSelect={() => {
        setOpen(false)
        openFeedback(sessionId)
      }}>
        {t('menu.feedback')}
      </MenuItemButton>}
    </Menu>
  )
}

/**
 * Keep the result feedback mounted for menu downloads and the /export command.
 * @param props - current-session list, download controller, and copy.
 * @returns the Session-scoped feedback without an extra titlebar shortcut.
 */
export function SessionLogDownloadTitlebarAction(props: SessionLogDownloadDialogProps): ReactNode {
  const {
    useSessions,
  } = props
  const listedId = useSessions(state => Object.values(state.byId)
    .find(row => (row.retainedBy.mainView ?? 0) > 0)?.id)
  const sessionId = listedId ?? props.sessionId
  const managedSession = useSessions(state => sessionId === undefined
    ? false : state.byId[sessionId]?.presentation?.composer === 'managed')
  return managedSession || sessionId === undefined ? null
    : <SessionLogDownloadDialog {...props} sessionId={sessionId} />
}
