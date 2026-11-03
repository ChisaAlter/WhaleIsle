/** The Team presented inside an owner's own surface, without a header entry or toolbar of its own. */
import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { TeamBody, type TeamBodyProps } from './TeamAction.tsx'
import actionCss from './TeamAction.module.css'

/** Full props of the embedded Team: the shared body's seats; the surface reports its own failures. */
export type TeamEmbeddedProps = Omit<TeamBodyProps, 'onError' | 'memberFailure'>

/** Render the same roster and task board as the header action inside the owner's page. */
export function TeamEmbedded(props: TeamEmbeddedProps) {
  const [error, setError] = useState<string | null>(null)
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [memberFailure, setMemberFailure] = useState<{ sessionId: SessionId; message: string } | null>(null)
  const [errorSequence, setErrorSequence] = useState(0)
  useEffect(() => { setError(null); setErrorDismissed(false); setMemberFailure(null) }, [props.sessionId])
  return (
    <div className={`${actionCss.projectPanel} ${actionCss.embedded}`} data-team-embedded>
      {error !== null && !errorDismissed && <Toast key={errorSequence} text={error} onDone={() => { setErrorDismissed(true) }} />}
      <TeamBody {...props} memberFailure={memberFailure} onError={(message, memberSessionId) => {
        if (message !== null && memberSessionId !== undefined) setMemberFailure({ sessionId: memberSessionId, message })
        else if (memberSessionId === memberFailure?.sessionId) setMemberFailure(null)
        setError(message)
        setErrorDismissed(false)
        setErrorSequence(sequence => sequence + 1)
      }} />
    </div>
  )
}
