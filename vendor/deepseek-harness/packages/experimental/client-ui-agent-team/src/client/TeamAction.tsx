import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsStore } from '@deepseek-ai/dsh-client-store'
import type { TeamActivityMap } from './mount.ts'
import type { createTeamViewStore } from './view-state.ts'
import type {
  TeamMemberProjection, TeamProjection,
  TeamTaskView as TeamTask,
} from '@deepseek-ai/dsh-experimental-agent-team/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import {
  IconChevronDownOutlineRegular,
  Button, Input, SegmentedTabs,
  IconUserOutlineRegular, IconUsersOutlineRegular, StateDot, Tag, Toast, Tooltip,
  useAnchoredPosition, useDismissOnOutsidePointer, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS, type TeamKey } from './locales.ts'
import css from './TeamAction.module.css'

/** Business actions injected by the browser plugin. */
export interface TeamActionInjected {
  /** Open a roster Session from the current conversation. */
  openTeammate: (sessionId: SessionId, childSessionId: SessionId) => void
  /** Open the existing Team Sidebar page; false means the conversation cannot receive it. */
  openTeamSidebar?: (sessionId: SessionId) => boolean
  /** Collapse the current Session's dock after its observer closes when only guide tabs remain. */
  collapseEmptyObserver?: (sessionId: SessionId) => void
  /** Project-owned current/recent task identities, ordered by actual business activity. */
  projectTaskIds?: readonly string[]
}

const memberPageSize = 6
const taskPageSize = 5

/** Bound each read-only collection independently; changing pages never changes Team state. */
function TeamPagination({ page, total, pageSize, onChange, label, t }: {
  page: number
  total: number
  pageSize: number
  onChange: (page: number) => void
  label: string
  t: TranslateNS<typeof NS>
}) {
  if (total <= pageSize) return null
  return (
    <nav className={css.pagination} aria-label={label}>
      <span className={css.pageRange} aria-live="polite">
        {t('project.range', { start: page * pageSize + 1, end: Math.min((page + 1) * pageSize, total), total })}
      </span>
      <Button size="sm" disabled={page === 0} onClick={() => { onChange(page - 1) }}>{t('project.previous')}</Button>
      <Button size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => { onChange(page + 1) }}>{t('project.next')}</Button>
    </nav>
  )
}

/** Durable lifecycle overlaid with the member Session's live turn activity. */
type MemberStatus = 'running' | 'inactive' | 'provisioning' | 'failed'

/** Owner-supplied current task ids by Lead Session id, read through the injected `teamTaskScopes` hook. */
export interface TeamTaskScopesProps {
  /** Select from the current scopes; absent where no scope service is composed. */
  useTeamTaskScopes?: <R>(selector: (scopes: Readonly<Record<string, readonly string[]>>) => R) => R
  /** Read owner-confirmed background Jobs and freshness through the bound activity source. */
  useTeamActivity?: <R>(selector: (activity: TeamActivityMap) => R) => R
}

/** Shared Project panel state; standalone renderers can omit the registered store. */
export type TeamViewProps = Partial<PropsStore<ReturnType<typeof createTeamViewStore>>>

/** Full props of the Team conversation-header action. */
export type TeamActionProps =
  PropsRuntime<'conversation.session.header.actions'> & TeamActionInjected & TeamTaskScopesProps & TeamViewProps & PropsLocale<typeof NS>

function statusKey(status: TeamTask['status']): TeamKey {
  switch (status) {
    case 'pending': return 'status.pending'
    case 'in_progress': return 'status.in_progress'
    case 'completed': return 'status.completed'
    /* v8 ignore next -- Team views omit deleted task tombstones. */
    case 'deleted': return 'status.completed'
  }
}

function memberStatusKey(status: MemberStatus): TeamKey {
  switch (status) {
    case 'running': return 'memberStatus.running'
    case 'inactive': return 'memberStatus.inactive'
    case 'provisioning': return 'memberStatus.provisioning'
    case 'failed': return 'memberStatus.failed'
  }
}

function memberDotState(status: Exclude<MemberStatus, 'inactive'>): StateDotState {
  switch (status) {
    case 'running':
    case 'provisioning': return 'ongoing'
    case 'failed': return 'error'
  }
}

function taskDotState(task: TeamTask): StateDotState {
  switch (task.status) {
    case 'pending': return task.ready ? 'idle' : 'warning'
    case 'in_progress': return 'ongoing'
    case 'completed': return 'done'
    /* v8 ignore next -- Team views omit deleted task tombstones. */
    case 'deleted': return 'idle'
  }
}

type TeamMemberRowProps = Pick<TeamActionProps,
  'sessionId' | 'useSessions' | 'useSessionStatus' | 'openTeammate' | 't'
> & {
  member: TeamMemberProjection
  label: string
  project: boolean
  memberCount: number
  runningJob: boolean
  activityStale: boolean
  navigationFailure: string | undefined
  onError: (message: string | null, memberSessionId?: SessionId) => void
}

function TeamMemberRow({
  member, label, project, memberCount, runningJob, activityStale, navigationFailure, sessionId, useSessions, useSessionStatus, openTeammate, onError, t,
}: TeamMemberRowProps) {
  const model = useSessions(state => state.projectionsBySession[member.id]?.values.modelSelection?.next?.model)
  const running = useSessionStatus(state => state.get(member.id)?.running)
  const summaryRunning = useSessions(state => state.byId[member.id]?.running)
  const status: MemberStatus = member.phase === 'active'
    ? (running ?? summaryRunning) === true || runningJob && !activityStale ? 'running' : 'inactive'
    : member.phase
  const isCurrent = member.id === sessionId
  const highlightCurrent = isCurrent && memberCount > 1
  const inert = isCurrent || status === 'failed' || status === 'provisioning'

  return (
    <Tooltip label={navigationFailure ?? t(project ? 'project.open' : 'open')} side="bottom" gap={4} disabled={inert}>
      <button
        type="button"
        className={highlightCurrent ? `${css.member} ${css.memberCurrent}` : css.member}
        disabled={inert}
        title={navigationFailure}
        data-error={navigationFailure !== undefined || undefined}
        onClick={() => {
          try {
            openTeammate(sessionId, member.id)
            onError(null, member.id)
          } catch (reason) {
            onError(reason instanceof Error ? reason.message : String(reason), member.id)
          }
        }}
      >
        <span className={css.memberDot}>
          {status === 'inactive'
            ? <IconUserOutlineRegular size={14} className={css.inactiveIcon} />
            : <StateDot state={memberDotState(status)} />}
        </span>
        <span className={css.memberText}>
          <span className={css.memberName}>
            <span className={css.memberNameText} title={label}>{label}</span>
            {isCurrent && <Tag tone="info" className={css.currentTag}>{t('current')}</Tag>}
          </span>
          <small>
            {t(project && status === 'inactive' ? 'project.memberIdle' : memberStatusKey(status))}
            {project && status !== 'running' && (running ?? summaryRunning) === true && <span>{` · ${t('project.turnRunning')}`}</span>}
            {runningJob && <span>{` · ${t(activityStale ? 'project.jobLastConfirmed' : 'project.jobRunning')}`}</span>}
            {model !== undefined && (
              <span className={css.memberModel}>{` · ${t('model')}: ${model}`}</span>
            )}
          </small>
          {member.error !== undefined && <small className={css.diagnostic}>{member.error}</small>}
        </span>
      </button>
    </Tooltip>
  )
}

/** Project assignments disclose their execution brief; ordinary Teams retain the two-line preview. */
function TaskCard({ task, project, ownerLabel, dependencyLabels, expanded: sharedExpanded, onExpandedChange, t }: {
  task: TeamTask
  project: boolean
  ownerLabel: string
  dependencyLabels: string[]
  expanded?: boolean | undefined
  onExpandedChange?: ((expanded: boolean) => void) | undefined
  t: TranslateNS<typeof NS>
}) {
  const [localExpanded, setLocalExpanded] = useState(false)
  const expanded = sharedExpanded ?? localExpanded
  const setExpanded = (next: boolean): void => {
    if (onExpandedChange !== undefined) onExpandedChange(next)
    else setLocalExpanded(next)
  }
  const [clamped, setClamped] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    if (project || expanded) return
    const paragraph = textRef.current
    /* v8 ignore next -- the paragraph mounts in the same commit as the effect. */
    if (paragraph === null) return
    const measure = (): void => { setClamped(paragraph.scrollHeight > paragraph.clientHeight + 1) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(paragraph)
    return () => { observer.disconnect() }
  }, [task.description, expanded, project])
  return (
    <article className={css.task}>
      <div className={css.taskTitle}>
        <strong>{task.subject}</strong>
        <span className={css.taskState}>
          <StateDot state={taskDotState(task)} />
          <span>{t(statusKey(task.status))}</span>
        </span>
      </div>
      {(!project || expanded) && <p ref={textRef} className={expanded ? undefined : css.clampedDescription}>{task.description}</p>}
      <div className={css.meta}>
        {(project && task.description.length > 0 || clamped || expanded) && (
          <button
            type="button"
            className={css.expandToggle}
            aria-expanded={expanded}
            onClick={() => { setExpanded(!expanded) }}
          >
            {t(expanded ? 'task.collapse' : 'task.expand')}
            <IconChevronDownOutlineRegular size={12} className={expanded ? css.expandToggleOpen : undefined} />
          </button>
        )}
        {!project && <span>{task.id}</span>}
        <span>{t(project ? 'project.owner' : 'owner')}: {ownerLabel}</span>
        {task.status === 'pending' && <span>{task.ready ? t('ready') : t('blocked')}</span>}
        {dependencyLabels.length > 0 && <span>{t('blockedBy')}: {dependencyLabels.join(', ')}</span>}
        {task.writeScopes.length > 0 && <span>{t('writeScopes')}: {task.writeScopes.join(', ')}</span>}
        {task.writeScopeWarnings.map(warning => <span key={warning} className={css.warning}>{warning}</span>)}
      </div>
    </article>
  )
}

/** Props shared by every Team presentation: the runtime seats, navigation and localized copy. */
export type TeamBodyProps = Pick<TeamActionProps,
  'sessionId' | 'useSession' | 'useSessions' | 'useSessionStatus' | 'openTeammate' | 'projectTaskIds' | 'useTeamTaskScopes' | 'useTeamActivity' | 't'
> & TeamViewProps & {
  /** Report a navigation failure, or clear it with null. */
  onError: (message: string | null, memberSessionId?: SessionId) => void
  /** Retained navigation failure for the original member's retry control. */
  memberFailure?: { sessionId: SessionId; message: string } | null
  /** Whether this retained presentation is visible and may restore or publish its reading position. */
  surfaceActive?: boolean
}

/** Whether the Team view of a Session is still arriving with its conversation or list. */
function useTeamLoading({ sessionId, useSession, useSessions }: Pick<TeamBodyProps, 'sessionId' | 'useSession' | 'useSessions'>): boolean {
  const leadSessionId = useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? sessionId
  const team = useSessions(state => state.projectionsBySession[leadSessionId]?.values.agentTeam)
  const opening = useSession(snapshot => snapshot.openState === 'loading')
  const listing = useSessions(state => state.phase === 'pending')
  return team === undefined && (opening || listing)
}

/** Live member turns, with explicit runtime inactivity taking precedence over cached summaries. */
function useLiveMemberIds({ useSessions, useSessionStatus }: Pick<TeamBodyProps, 'useSessions' | 'useSessionStatus'>, team: TeamProjection | undefined): Set<string> {
  const running = useSessionStatus(state => team?.members.filter(member => state.get(member.id)?.running === true).map(member => member.id).join('\n') ?? '')
  const inactive = useSessionStatus(state => team?.members.filter(member => state.get(member.id)?.running === false).map(member => member.id).join('\n') ?? '')
  const summaryRunning = useSessions(state => team?.members.filter(member => state.byId[member.id]?.running === true).map(member => member.id).join('\n') ?? '')
  const inactiveIds = new Set(inactive.split('\n'))
  return new Set([...running.split('\n'), ...summaryRunning.split('\n').filter(id => !inactiveIds.has(id))].filter(Boolean))
}

/** Render the Team roster and read-only task board without its surrounding surface. */
export function TeamBody({
  sessionId, useSession, useSessions, useSessionStatus, openTeammate, projectTaskIds: injectedTaskIds, useTeamTaskScopes, useTeamActivity, useStore, actions, onError, memberFailure, surfaceActive = true, t,
}: TeamBodyProps) {
  const [localView, setLocalView] = useState<'current' | 'history'>('current')
  const [localQuery, setLocalQuery] = useState('')
  const [localMemberPage, setLocalMemberPage] = useState(0)
  const [localTaskPage, setLocalTaskPage] = useState(0)
  const sharedView = useStore?.(state => state.view)
  const sharedQuery = useStore?.(state => state.query)
  const sharedMemberPage = useStore?.(state => state.memberPage)
  const sharedTaskPage = useStore?.(state => state.taskPage)
  const expandedTaskIds = useStore?.(state => state.expandedTaskIds)
  const scrollTop = useStore?.(state => state.scrollTop)
  const bodyRef = useRef<HTMLDivElement>(null)
  const view = sharedView ?? localView
  const query = sharedQuery ?? localQuery
  const memberPage = sharedMemberPage ?? localMemberPage
  const taskPage = sharedTaskPage ?? localTaskPage
  useLayoutEffect(() => {
    if (surfaceActive && scrollTop !== undefined && bodyRef.current !== null) bodyRef.current.scrollTop = scrollTop
  }, [surfaceActive, scrollTop])
  const setView = actions?.setView ?? setLocalView
  const setQuery = actions?.setQuery ?? setLocalQuery
  const setMemberPage = actions?.setMemberPage ?? setLocalMemberPage
  const setTaskPage = actions?.setTaskPage ?? setLocalTaskPage
  const viewId = useId()
  const leadSessionId = useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? sessionId
  const team = useSessions(state => state.projectionsBySession[leadSessionId]?.values.agentTeam)
  const project = useSessions(state => state.byId[leadSessionId]?.presentation?.owner === 'project')
  // The conversation owner's current work, when it names one, scopes the Current view.
  const projectTaskIds = useTeamTaskScopes?.(scopes => scopes[leadSessionId]) ?? injectedTaskIds
  const activity = useTeamActivity?.(facts => facts[leadSessionId])
  const runningJobIds = new Set(project ? activity?.runningJobSessionIds : [])
  const activityStale = project && useTeamActivity !== undefined && activity?.state !== 'ready'
  const liveMemberIds = useLiveMemberIds({ useSessions, useSessionStatus }, project ? team : undefined)
  if (!activityStale) for (const id of runningJobIds) liveMemberIds.add(id)
  const loadingTeam = useTeamLoading({ sessionId, useSession, useSessions })

  useEffect(() => {
    if (useStore !== undefined) return
    setLocalView('current')
    setLocalQuery('')
    setLocalMemberPage(0)
    setLocalTaskPage(0)
  }, [sessionId, useStore])

  const compact = team !== undefined && team.members.length === 1 && team.tasks.length === 0
  const taskById = new Map<string, TeamTask>(team?.tasks.map(task => [task.id, task]))
  const taskByOwner = new Map<string, TeamTask>()
  // Prefer the Project's real current task when a native member has older tasks too.
  for (const task of [...(projectTaskIds?.flatMap(id => taskById.get(id) ?? []) ?? []), ...(team?.tasks ?? [])]) {
    if (task.ownerName !== undefined && !taskByOwner.has(task.ownerName)) taskByOwner.set(task.ownerName, task)
  }
  const memberLabel = (member: TeamMemberProjection): string => {
    if (!project) return member.name
    if (member.role === 'lead') return t('project.lead')
    return taskByOwner.get(member.name)?.subject ?? member.description ?? member.name
  }
  const memberByName = new Map(team?.members.map(member => [member.name, member]))
  const activeOwnerNames = new Set(team?.members.filter(member => liveMemberIds.has(member.id) || member.phase === 'provisioning').map(member => member.name))
  const taskOrder = new Map(projectTaskIds?.map((id, index) => [id, index]))
  const activeTasks = (team?.tasks.filter(task => projectTaskIds === undefined
    ? task.status === 'pending' || task.status === 'in_progress'
    : task.ownerName !== undefined && activeOwnerNames.has(task.ownerName)) ?? [])
    .sort((a, b) => (taskOrder.get(a.id) ?? taskOrder.size) - (taskOrder.get(b.id) ?? taskOrder.size))
  // Old Projects have no request association. Only their recent recorded completions
  // supplement live work; insertion order never stands in for a current Request.
  const relatedTasks = projectTaskIds?.flatMap(id => taskById.get(id) ?? [])
    ?? [...(team?.tasks ?? [])].reverse().filter(task => task.status === 'completed').slice(0, 3)
  const currentTasks = [...new Map([...activeTasks, ...relatedTasks].map(task => [task.id, task])).values()]
  const currentOwners = new Set(currentTasks.flatMap(task => task.ownerName === undefined ? [] : [task.ownerName]))
  const search = query.trim().toLocaleLowerCase()
  const matchingTasks = new Set(team?.tasks.filter(task => `${task.subject}\n${task.description}`.toLocaleLowerCase().includes(search)).map(task => task.id))
  const matchingOwners = new Set(team?.tasks.filter(task => matchingTasks.has(task.id)).map(task => task.ownerName))
  const taskCandidates = !project ? team?.tasks ?? [] : view === 'history'
    ? [...(team?.tasks ?? [])].reverse().filter(task => {
      const owner = task.ownerName === undefined ? undefined : memberByName.get(task.ownerName)
      return matchingTasks.has(task.id) || owner !== undefined && memberLabel(owner).toLocaleLowerCase().includes(search)
    })
    : currentTasks
  const memberCandidates = !project ? team?.members ?? [] : view === 'history'
    ? [...(team?.members ?? [])].reverse().filter(member => memberLabel(member).toLocaleLowerCase().includes(search)
      || (member.description ?? '').toLocaleLowerCase().includes(search) || matchingOwners.has(member.name))
    : (team?.members ?? []).filter(member => member.role === 'lead' || currentOwners.has(member.name)
      || liveMemberIds.has(member.id) || runningJobIds.has(member.id) || member.phase === 'provisioning')
  const visibleMemberPage = Math.min(memberPage, Math.max(0, Math.ceil(memberCandidates.length / memberPageSize) - 1))
  const visibleTaskPage = Math.min(taskPage, Math.max(0, Math.ceil(taskCandidates.length / taskPageSize) - 1))
  const visibleMembers = project ? memberCandidates.slice(visibleMemberPage * memberPageSize, (visibleMemberPage + 1) * memberPageSize) : memberCandidates
  const visibleTasks = project ? taskCandidates.slice(visibleTaskPage * taskPageSize, (visibleTaskPage + 1) * taskPageSize) : taskCandidates

  useEffect(() => { setMemberPage(visibleMemberPage) }, [visibleMemberPage])
  useEffect(() => { setTaskPage(visibleTaskPage) }, [visibleTaskPage])

  return (
    <>
    {project && team !== undefined && !compact && (
      <div className={css.projectToolbar}>
        <SegmentedTabs
          label={t('project.view')}
          value={view}
          items={[
            { value: 'current', label: t('project.recent'), id: `${viewId}-current`, panelId: `${viewId}-panel` },
            { value: 'history', label: t('project.history'), id: `${viewId}-history`, panelId: `${viewId}-panel` },
          ]}
          onChange={next => { setView(next); setQuery(''); setMemberPage(0); setTaskPage(0) }}
        />
        {view === 'history' && <label className={css.searchLabel}>
          <span>{t('project.search')}</span>
          <Input type="search" value={query} placeholder={t('project.searchHint')}
            onChange={event => { setQuery(event.target.value); setMemberPage(0); setTaskPage(0) }} />
        </label>}
      </div>
    )}
    <div ref={bodyRef} className={css.body} aria-busy={loadingTeam} data-team-loading={loadingTeam || undefined}
      onScroll={event => { if (project && surfaceActive) actions?.setScrollTop(event.currentTarget.scrollTop) }}
      id={project && team !== undefined && !compact ? `${viewId}-panel` : undefined}
      role={project && team !== undefined && !compact ? 'tabpanel' : undefined}
      aria-labelledby={project && team !== undefined && !compact ? `${viewId}-${view}` : undefined}>
      {loadingTeam && <span className={css.loading} aria-hidden="true"><StateDot state="ongoing" /></span>}
      {team === undefined && !loadingTeam && (
        <div className={css.notice} role="status">
          <StateDot state="warning" />
          {t('unavailable')}
        </div>
      )}
      {project && activityStale && <p className={css.collectionHint} role="status">{t('project.activityStale')}</p>}
      {team !== undefined && (
        <>
          {team.failure !== undefined && (
            <div className={css.error} role="alert"><StateDot state="error" />{t('failure', { message: team.failure })}</div>
          )}
          <section>
            <h3>
              {t('roster')}
              {memberCandidates.length > 1 && <span className={css.count}>{memberCandidates.length}</span>}
            </h3>
            <div className={css.roster}>
              {visibleMembers.map(member => (
                <TeamMemberRow
                  key={member.id}
                  member={member}
                  label={memberLabel(member)}
                  project={project}
                  memberCount={team.members.length}
                  runningJob={runningJobIds.has(member.id)}
                  activityStale={activityStale}
                  navigationFailure={memberFailure?.sessionId === member.id ? memberFailure.message : undefined}
                  sessionId={sessionId}
                  useSessions={useSessions}
                  useSessionStatus={useSessionStatus}
                  openTeammate={openTeammate}
                  onError={onError}
                  t={t}
                />
              ))}
            </div>
            {project && memberCandidates.length === 0 && <p className={css.emptyNotice}>{t('project.noMembers')}</p>}
            {project && <TeamPagination page={visibleMemberPage} total={memberCandidates.length} pageSize={memberPageSize}
              onChange={setMemberPage} label={t('project.memberPages')} t={t} />}
          </section>
          <section>
            {taskCandidates.length === 0
              ? <p className={css.emptyNotice}>{t(!project ? 'empty' : view === 'history' && search ? 'project.noTasks' : team.tasks.length === 0 ? 'project.empty' : 'project.noCurrentWork')}</p>
              : (
                <>
                  <h3>{t(project ? 'project.work' : 'tasks')}<span className={css.count}>{taskCandidates.length}</span></h3>
                  {project && view === 'current' && projectTaskIds === undefined && relatedTasks.length > 0
                    && <p className={css.collectionHint}>{t('project.legacyRecent')}</p>}
                  <div className={css.tasks}>
                    {visibleTasks.map(task => {
                      const owner = task.ownerName === undefined ? undefined : memberByName.get(task.ownerName)
                      return <TaskCard key={task.id} task={task} project={project}
                        ownerLabel={project && owner !== undefined ? memberLabel(owner) : task.ownerName ?? t('unowned')}
                        dependencyLabels={task.blockedBy.map(id => project
                          ? taskById.get(id)?.subject ?? t('project.missingDependency')
                          : id)}
                        expanded={project && expandedTaskIds !== undefined ? expandedTaskIds.includes(task.id) : undefined}
                        onExpandedChange={project && actions !== undefined ? next => { actions.setTaskExpanded(task.id, next) } : undefined}
                        t={t} />
                    })}
                  </div>
                  {project && <TeamPagination page={visibleTaskPage} total={taskCandidates.length} pageSize={taskPageSize}
                    onChange={setTaskPage} label={t('project.workPages')} t={t} />}
                </>
              )}
          </section>
        </>
      )}
    </div>
    </>
  )
}

/** Render the Team header action: a hover or pinned popover around {@link TeamBody}. */
export function TeamAction(props: TeamActionProps) {
  const { sessionId, useSession, useSessions, useTeamActivity, useStore, actions, openTeamSidebar, t } = props
  const leadSessionId = useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? sessionId
  const team = useSessions(state => state.projectionsBySession[leadSessionId]?.values.agentTeam)
  const project = useSessions(state => state.byId[leadSessionId]?.presentation?.owner === 'project')
  const [localOpen, setLocalOpen] = useState(false)
  const sharedOpen = useStore?.(state => state.floatingOpen)
  const floatingVisited = useStore?.(state => state.floatingVisited) ?? false
  const open = project ? sharedOpen ?? localOpen : localOpen
  const setOpen = (next: boolean): void => {
    if (project && actions !== undefined) actions.setFloating(next)
    else setLocalOpen(next)
  }
  const [error, setError] = useState<string | null>(null)
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [errorSequence, setErrorSequence] = useState(0)
  const [loadingDismissed, setLoadingDismissed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const triggerLabelRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition({
    open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16,
  })
  const positioned = position !== null
  const activity = useTeamActivity?.(facts => facts[leadSessionId])
  const liveMemberIds = useLiveMemberIds(props, project ? team : undefined)
  const jobIds = new Set(activity?.runningJobSessionIds)
  const runningCount = new Set(team?.members.filter(member => member.role !== 'lead'
    && (liveMemberIds.has(member.id) || jobIds.has(member.id))).map(member => member.id)).size
  const countReadState = useSessions(state => state.projectionsBySession[leadSessionId]?.state)
  const openState = useSession(snapshot => snapshot.openState)
  const opening = openState === 'loading'
  const listing = useSessions(state => state.phase === 'pending')
  const countKnown = team !== undefined && team.failure === undefined && openState === 'open' && !listing
    && countReadState !== 'loading' && countReadState !== 'error' && countReadState !== 'migration-required'
    && (useTeamActivity === undefined || activity?.state === 'ready')
  const countText = countKnown ? runningCount > 99 ? '99+' : String(runningCount) : '?'
  const triggerLabel = project ? t('project.trigger', { count: countKnown ? runningCount : '?' }) : t('trigger')
  const loadingTeam = useTeamLoading({ sessionId, useSession, useSessions })
  useEffect(() => { setLoadingDismissed(false) }, [opening, listing, open])
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pinnedRef = useRef(false)
  const hoverDismissedRef = useRef(false)

  const cancelHoverChange = (): void => {
    clearTimeout(hoverTimer.current)
    hoverTimer.current = undefined
  }

  useEffect(() => {
    cancelHoverChange()
    pinnedRef.current = false
    hoverDismissedRef.current = false
    setLocalOpen(false)
    setError(null)
    setErrorDismissed(false)
  }, [sessionId])

  useEffect(() => cancelHoverChange, [])
  useEffect(() => () => { actions?.setFloating(false) }, [sessionId, actions])

  useLayoutEffect(() => {
    if (open && positioned && (project || pinnedRef.current)) panelRef.current?.focus()
  }, [open, positioned, project])

  const changeOpen = (next: boolean): void => {
    cancelHoverChange()
    if (!next) pinnedRef.current = false
    setOpen(next)
  }

  const scheduleHoverOpen = (): void => {
    cancelHoverChange()
    if (project || open || hoverDismissedRef.current) return
    const label = triggerLabelRef.current
    /* v8 ignore next -- the label mounts with the trigger that received the hover. */
    if (label === null) return
    // Icon-only trigger (label collapsed by the header container query):
    // hover-open would surprise on such a small target, so only click opens.
    if (getComputedStyle(label).display === 'none') return
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = undefined
      changeOpen(true)
    }, 150)
  }

  const scheduleHoverClose = (): void => {
    cancelHoverChange()
    hoverDismissedRef.current = false
    if (project || pinnedRef.current) return
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = undefined
      changeOpen(false)
    }, 120)
  }

  useDismissOnOutsidePointer(rootRef, open, changeOpen, panelRef)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelHoverChange()
      // Removing the panel can emit a fresh mouse-enter on the trigger under
      // the stationary pointer. Escape stays dismissed until that pointer leaves.
      hoverDismissedRef.current = true
      pinnedRef.current = false
      setOpen(false)
      if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus()
    }
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('keydown', dismiss) }
  }, [open])

  const compact = team !== undefined && team.members.length === 1 && team.tasks.length === 0
  return (
    <div
      ref={rootRef}
      className={css.root}
      data-team-action
      onMouseLeave={scheduleHoverClose}
    >
      <Tooltip label={t(countKnown ? 'project.tooltip' : 'project.tooltipUnknown', { count: runningCount })}
        disabled={!project || open} side="bottom" delayMs={350} portal maxWidth={260}>
      <button
        type="button"
        ref={triggerRef}
        onMouseEnter={scheduleHoverOpen}
        className={`${css.trigger}${project ? ` ${css.projectTrigger}` : ''}`}
        aria-label={triggerLabel}
        title={project ? undefined : t('trigger')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          cancelHoverChange()
          hoverDismissedRef.current = false
          pinnedRef.current = true
          if (project) changeOpen(!open)
          else if (!open) changeOpen(true)
          else panelRef.current?.focus()
        }}
      >
        <IconUsersOutlineRegular size={14} />
        <span ref={triggerLabelRef} className={css.triggerLabel}>{t(project ? 'project.triggerLabel' : 'trigger')}</span>
        {project && <span className={css.triggerCount} aria-hidden="true" data-team-running-count>{countText}</span>}
      </button>
      </Tooltip>
      {open && error !== null && !errorDismissed ? <Toast key={errorSequence} text={error} holdMs={null}
        dismissLabel={t('dismissFeedback')} onDone={() => { setErrorDismissed(true) }} />
        : open && loadingTeam && !loadingDismissed ? <Toast text={t('loading')} icon={<StateDot state="ongoing" />}
          holdMs={null} dismissLabel={t('dismissFeedback')} onDone={() => { setLoadingDismissed(true) }} /> : null}
      {(open || project && floatingVisited) && createPortal(
        <div
          ref={panelRef}
          className={`${css.panel}${compact ? ` ${css.panelCompact}` : ''}${project ? ` ${css.projectPanel}` : ''}`}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          tabIndex={-1}
          aria-label={t('trigger')}
          data-team-panel
          hidden={!open}
          onMouseEnter={cancelHoverChange}
          onMouseLeave={scheduleHoverClose}
          onFocusCapture={() => { if (project) pinnedRef.current = true }}
          onPointerDownCapture={() => { if (project) pinnedRef.current = true }}
        >
          {project && <div className={css.surfaceToolbar}>
            {openTeamSidebar !== undefined && <Button size="sm" onClick={() => {
              try {
                if (!openTeamSidebar(sessionId)) throw new Error(t('project.sidebarUnavailable'))
                changeOpen(false)
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : String(reason))
                setErrorDismissed(false)
                setErrorSequence(sequence => sequence + 1)
              }
            }}>{t('project.pin')}</Button>}
            <Button size="sm" onClick={() => { changeOpen(false); triggerRef.current?.focus() }}>{t('project.close')}</Button>
          </div>}
          <TeamBody {...props} surfaceActive={open} onError={(message) => {
            setError(message)
            setErrorDismissed(false)
            setErrorSequence(sequence => sequence + 1)
          }} />
        </div>,
        document.body,
      )}
    </div>
  )
}
