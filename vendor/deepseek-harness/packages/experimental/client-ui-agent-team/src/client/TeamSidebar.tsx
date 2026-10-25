/** Right-Sidebar page presenting the Team beside its conversation. */
import { useEffect, useState } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TeamBody, type TeamActionInjected, type TeamTaskScopesProps } from './TeamAction.tsx'
import type { NS } from './locales.ts'
import actionCss from './TeamAction.module.css'

/** Full props of the Team Sidebar page body. */
export type TeamSidebarProps =
  PropsRuntime<'sidebar.right.pane.tab'> & TeamActionInjected & TeamTaskScopesProps & PropsLocale<typeof NS>

/** Render the same roster and task board as the header action inside a Sidebar page. */
export function TeamSidebar(props: TeamSidebarProps) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setError(null) }, [props.sessionId])
  return (
    <div className={`${actionCss.projectPanel} ${actionCss.sidebar}`} data-team-sidebar>
      {error !== null && <div className={actionCss.error} role="alert"><StateDot state="error" />{error}</div>}
      <TeamBody {...props} onError={setError} />
    </div>
  )
}
