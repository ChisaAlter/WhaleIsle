/** Right-Sidebar page presenting the Team beside its conversation. */
import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TeamBody, type TeamActionInjected, type TeamTaskScopesProps, type TeamViewProps } from './TeamAction.tsx'
import type { NS } from './locales.ts'
import actionCss from './TeamAction.module.css'

/** Full props of the Team Sidebar page body. */
export type TeamSidebarProps =
  PropsRuntime<'sidebar.right.pane.tab'> & TeamActionInjected & TeamTaskScopesProps & TeamViewProps & PropsLocale<typeof NS>

/** Render the same roster and task board as the header action inside a Sidebar page. */
export function TeamSidebar(props: TeamSidebarProps) {
  const [error, setError] = useState<string | null>(null)
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [memberFailure, setMemberFailure] = useState<{ sessionId: SessionId; message: string } | null>(null)
  const [errorSequence, setErrorSequence] = useState(0)
  const leadSessionId = props.useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? props.sessionId
  const project = props.useSessions(state => state.byId[leadSessionId]?.presentation?.owner === 'project')
  const { panel, tab } = props.useTabInfo?.() ?? {}
  useEffect(() => { setError(null); setErrorDismissed(false); setMemberFailure(null) }, [props.sessionId])
  return (
    <div className={`${actionCss.projectPanel} ${actionCss.sidebar}`} data-team-sidebar>
      {project && props.actions !== undefined && tab !== undefined && <div className={actionCss.surfaceToolbar}>
        <Button size="sm" title={memberFailure === null ? error ?? undefined : undefined} data-error={error !== null && memberFailure === null || undefined} onClick={() => {
          try {
            tab.actions.close()
            if (panel?.host === 'dock') props.collapseEmptyObserver?.(props.sessionId)
            props.actions?.setFloating(true)
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason))
            setErrorDismissed(false)
            setErrorSequence(sequence => sequence + 1)
          }
        }}>{props.t('project.unpin')}</Button>
      </div>}
      {error !== null && !errorDismissed && <Toast key={errorSequence} text={error} onDone={() => { setErrorDismissed(true) }} />}
      <TeamBody {...props} memberFailure={memberFailure} surfaceActive={tab?.visible ?? true} onError={(message, memberSessionId) => {
        if (message !== null && memberSessionId !== undefined) setMemberFailure({ sessionId: memberSessionId, message })
        else if (memberSessionId === memberFailure?.sessionId) setMemberFailure(null)
        setError(message)
        setErrorDismissed(false)
        setErrorSequence(sequence => sequence + 1)
      }} />
    </div>
  )
}
