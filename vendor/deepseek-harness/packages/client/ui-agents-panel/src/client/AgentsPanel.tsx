import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { IconAgentPresetOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JobView } from '@deepseek-ai/dsh-jobs/view'
import type { IJobs } from '@deepseek-ai/dsh-api-job-controller/client'
import { listSessionAgents } from './agents.ts'
import { NS, type AgentsKey } from './locales.ts'
import css from './AgentsPanel.module.css'

/** Injected navigation into a child session. */
export interface AgentsPanelInjected {
  openAgent: (id: SessionId) => void
  jobs: IJobs['state']
  watchJobs: (sessionId: SessionId) => () => void
}

export type AgentsPanelProps =
  & Pick<PropsRuntime<'surfaces.agents'>, 'sessionId' | 'useSessions'>
  & PropsLocale<typeof NS>
  & InjectFace<AgentsPanelInjected>

const JOB_STATUS_KEY = {
  running: 'jobs.status.running',
  stopping: 'jobs.status.stopping',
  completed: 'jobs.status.completed',
  killed: 'jobs.status.killed',
  failed: 'jobs.status.failed',
} as const satisfies Record<JobView['status'], AgentsKey>

/**
 * Current-session subagent body of the right Sidebar. Reads the existing
 * session snapshot; it does not dispatch or spawn agents.
 * @param props - session seats, openAgent, and copy.
 * @returns the agents surface.
 */
export function AgentsPanel({ sessionId, useSessions, openAgent, jobs: jobsSource, watchJobs, t }: AgentsPanelProps): ReactNode {
  const activeSessionId = useSessions(state => sessionId ?? Object.values(state.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id)
  const agents = useSessions(state => listSessionAgents(state, sessionId))
  useEffect(() => activeSessionId === undefined ? undefined : watchJobs(activeSessionId), [activeSessionId, watchJobs])
  const subscribeJobs = useCallback((listener: () => void) => jobsSource.subscribe(listener), [jobsSource])
  const getJobsSnapshot = useCallback(() => jobsSource.getSnapshot(), [jobsSource])
  const jobsBySession = useSyncExternalStore(subscribeJobs, getJobsSnapshot).rows
  const jobs = activeSessionId === undefined ? [] : jobsBySession[activeSessionId] ?? []

  return (
    <div className={css.root} data-agents-panel>
      <div className={css.body}>
        {agents.length === 0 ? (
          <div className={css.empty} data-agents-empty>
            <IconAgentPresetOutline16 size={20} />
            <p className={css.emptyTitle}>{t('empty.title')}</p>
            <p className={css.emptyBody}>{t('empty.body')}</p>
          </div>
        ) : (
          <ul className={css.list} aria-label={t('list.aria')}>
            {agents.map(agent => (
              <li key={agent.id} className={css.row} data-agent-id={agent.id}>
                <button
                  type="button"
                  className={css.open}
                  disabled={agent.mode === 'external'}
                  onClick={() => { openAgent(agent.id) }}
                >
                  {agent.mode !== 'external' && <StateDot state={agent.activity === 'running' ? 'ongoing' : 'done'} />}
                  <span className={css.label}>{agent.label}</span>
                  <span className={css.meta}>
                    {agent.mode === 'external' ? t('mode.external') : t(agent.activity === 'running' ? 'activity.running' : 'activity.inactive')}
                    {agent.mode === 'one-shot' ? ` · ${t('mode.oneShot')}` : null}
                    {agent.mode === 'continuable' ? ` · ${t('mode.continuable')}` : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {jobs.length > 0 ? (
          <div className={css.jobs} data-agents-jobs>
            <h4 className={css.jobsTitle}>{t('jobs.title')}</h4>
            <ul className={css.list} aria-label={t('jobs.aria')}>
              {jobs.map(job => (
                <li key={job.id} className={css.row} data-job-id={job.id}>
                  <span className={css.label}>{job.label}</span>
                  <span className={css.meta}>
                    {t(JOB_STATUS_KEY[job.status])}
                    {job.detail !== undefined ? ` · ${job.detail}` : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
