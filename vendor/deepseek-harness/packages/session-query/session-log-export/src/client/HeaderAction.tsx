import { useState, type ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  Button, IconDownloadOutline16, IconDownloadOutlineRegular,
  IconEllipsisOutlineRegular, IconPaperPlaneOutlineRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'
import css from './HeaderAction.module.css'

/** Session-scoped menu state and actions; the titlebar contribution owns the shared download modal. */
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
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadHeaderInjected>

/**
 * Render the Session's persistent more-actions menu, including feedback while its plugin is available.
 * @param props - current Session, controller state, feedback availability, and copy.
 * @returns the compact Session utility, independent of the optional titlebar shortcut.
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
      onClose={() => { setOpen(false) }}
      items={[
        { id: 'download', label: t('menu.download'), icon: <IconDownloadOutlineRegular />, disabled: busy },
        ...feedbackAvailable ? [{ id: 'feedback', label: t('menu.feedback'), icon: <IconPaperPlaneOutlineRegular /> }] : [],
      ]}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'feedback') openFeedback(sessionId)
        else void request(sessionId)
      }}
      anchor={(
        <Button
          size="sm"
          className={css.moreButton}
          aria-label={t('header.more')}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={busy}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconEllipsisOutlineRegular />
        </Button>
      )}
    />
  )
}

/**
 * Render the titlebar Session-log capsule and its shared result dialog.
 * @param props - titlebar density, current-session list, download controller, and copy.
 * @returns the persistent titlebar action and Session-scoped dialog.
 */
export function SessionLogDownloadTitlebarAction(props: SessionLogDownloadDialogProps): ReactNode {
  const {
    density = 'full',
    useSessions,
    useTitlebarAction,
    useSessionLogDownload,
    request,
    t,
  } = props
  const listedId = useSessions(state => Object.values(state.byId)
    .find(row => (row.retainedBy.mainView ?? 0) > 0)?.id)
  const sessionId = listedId ?? props.sessionId
  const managedSession = useSessions(state => sessionId === undefined
    ? false : state.byId[sessionId]?.presentation?.composer === 'managed')
  const showChrome = typeof useTitlebarAction === 'function' ? useTitlebarAction(value => value) : true
  const downloadEntry = useSessionLogDownload(state => (
    sessionId === undefined ? undefined : state.bySession[String(sessionId)]
  ))
  const busy = downloadEntry?.status === 'downloading'
  const compact = density === 'cozy' || density === 'compact'
  const className = compact ? `${css.sessionLogButton} ${css.iconOnly}` : css.sessionLogButton

  return managedSession ? null : (
    <>
      {showChrome && (
        <button
          type="button"
          className={className}
          disabled={busy || sessionId === undefined}
          aria-busy={busy}
          aria-label={t('menu.download')}
          onClick={() => {
            if (sessionId !== undefined) void request(sessionId)
          }}
        >
          {compact ? null : <span>{t('menu.download')}</span>}
          <IconDownloadOutline16 size={14} />
        </button>
      )}
      {sessionId !== undefined && <SessionLogDownloadDialog {...props} sessionId={sessionId} />}
    </>
  )
}
