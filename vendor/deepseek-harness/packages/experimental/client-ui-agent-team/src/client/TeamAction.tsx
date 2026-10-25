import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TeamMemberProjection,
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
}

/** Full props of the Team conversation-header action. */
export type TeamActionProps =
  PropsRuntime<'conversation.session.header.actions'> & TeamActionInjected & TeamTaskScopesProps & PropsLocale<typeof NS>

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
  onError: (message: string | null) => void
}

function TeamMemberRow({
  member, label, project, memberCount, sessionId, useSessions, useSessionStatus, openTeammate, onError, t,
}: TeamMemberRowProps) {
  const model = useSessions(state => state.projectionsBySession[member.id]?.values.modelSelection?.next?.model)
  const running = useSessionStatus(state => state.get(member.id)?.running)
  const summaryRunning = useSessions(state => state.byId[member.id]?.running)
  const status: MemberStatus = member.phase === 'active'
    ? (running ?? summaryRunning) === true ? 'running' : 'inactive'
    : member.phase
  const isCurrent = member.id === sessionId
  const highlightCurrent = isCurrent && memberCount > 1
  const inert = isCurrent || status === 'failed' || status === 'provisioning'

  return (
    <Tooltip label={t(project ? 'project.open' : 'open')} side="bottom" gap={4} disabled={inert}>
      <button
        type="button"
        className={highlightCurrent ? `${css.member} ${css.memberCurrent}` : css.member}
        disabled={inert}
        onClick={() => {
          onError(null)
          try {
            openTeammate(sessionId, member.id)
          } catch (reason) {
            onError(reason instanceof Error ? reason.message : String(reason))
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
function TaskCard({ task, project, ownerLabel, dependencyLabels, t }: {
  task: TeamTask
  project: boolean
  ownerLabel: string
  dependencyLabels: string[]
  t: TranslateNS<typeof NS>
}) {
  const [expanded, setExpanded] = useState(false)
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
            onClick={() => { setExpanded(current => !current) }}
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
  'sessionId' | 'useSession' | 'useSessions' | 'useSessionStatus' | 'openTeammate' | 'projectTaskIds' | 'useTeamTaskScopes' | 't'
> & {
  /** Report a navigation failure, or clear it with null. */
  onError: (message: string | null) => void
}

/** Whether the Team view of a Session is still arriving with its conversation or list. */
function useTeamLoading({ sessionId, useSession, useSessions }: Pick<TeamBodyProps, 'sessionId' | 'useSession' | 'useSessions'>): boolean {
  const leadSessionId = useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? sessionId
  const team = useSessions(state => state.projectionsBySession[leadSessionId]?.values.agentTeam)
  const opening = useSession(snapshot => snapshot.openState === 'loading')
  const listing = useSessions(state => state.phase === 'pending')
  return team === undefined && (opening || listing)
}

/** Render the Team roster and read-only task board without its surrounding surface. */
export function TeamBody({
  sessionId, useSession, useSessions, useSessionStatus, openTeammate, projectTaskIds: injectedTaskIds, useTeamTaskScopes, onError, t,
}: TeamBodyProps) {
  const [view, setView] = useState<'current' | 'history'>('current')
  const [query, setQuery] = useState('')
  const [memberPage, setMemberPage] = useState(0)
  const [taskPage, setTaskPage] = useState(0)
  const viewId = useId()
  const leadSessionId = useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? sessionId
  const team = useSessions(state => state.projectionsBySession[leadSessionId]?.values.agentTeam)
  const project = useSessions(state => state.byId[leadSessionId]?.presentation?.owner === 'project')
  // The conversation owner's current work, when it names one, scopes the Current view.
  const projectTaskIds = useTeamTaskScopes?.(scopes => scopes[leadSessionId]) ?? injectedTaskIds
  const liveMembers = useSessionStatus(state => project
    ? team?.members.filter(member => state.get(member.id)?.running === true).map(member => member.id).join('\n') ?? ''
    : '')
  const inactiveMembers = useSessionStatus(state => project
    ? team?.members.filter(member => state.get(member.id)?.running === false).map(member => member.id).join('\n') ?? ''
    : '')
  const summaryLiveMembers = useSessions(state => project
    ? team?.members.filter(member => state.byId[member.id]?.running === true).map(member => member.id).join('\n') ?? ''
    : '')
  const loadingTeam = useTeamLoading({ sessionId, useSession, useSessions })

  useEffect(() => {
    setView('current')
    setQuery('')
    setMemberPage(0)
    setTaskPage(0)
  }, [sessionId])

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
  const inactiveMemberIds = new Set(inactiveMembers.split('\n'))
  const liveMemberIds = new Set([...liveMembers.split('\n'), ...summaryLiveMembers.split('\n').filter(id => !inactiveMemberIds.has(id))])
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
      || liveMemberIds.has(member.id) || member.phase === 'provisioning')
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
    <div className={css.body} aria-busy={loadingTeam} data-team-loading={loadingTeam || undefined}
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
  const { sessionId, useSession, useSessions, t } = props
  const [open, setOpen] = useState(false)
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
  const leadSessionId = useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? sessionId
  const team = useSessions(state => state.projectionsBySession[leadSessionId]?.values.agentTeam)
  const project = useSessions(state => state.byId[leadSessionId]?.presentation?.owner === 'project')
  const loadingTeam = useTeamLoading({ sessionId, useSession, useSessions })
  const opening = useSession(snapshot => snapshot.openState === 'loading')
  const listing = useSessions(state => state.phase === 'pending')
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
    setOpen(false)
    setError(null)
    setErrorDismissed(false)
  }, [sessionId])

  useEffect(() => cancelHoverChange, [])

  useLayoutEffect(() => {
    if (open && positioned && pinnedRef.current) panelRef.current?.focus()
  }, [open, positioned])

  const changeOpen = (next: boolean): void => {
    cancelHoverChange()
    if (!next) pinnedRef.current = false
    setOpen(next)
  }

  const scheduleHoverOpen = (): void => {
    cancelHoverChange()
    if (open || hoverDismissedRef.current) return
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
    if (pinnedRef.current) return
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
      <button
        type="button"
        ref={triggerRef}
        onMouseEnter={scheduleHoverOpen}
        className={css.trigger}
        aria-label={t('trigger')}
        title={t('trigger')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          cancelHoverChange()
          hoverDismissedRef.current = false
          pinnedRef.current = true
          if (!open) changeOpen(true)
          else panelRef.current?.focus()
        }}
      >
        <IconUsersOutlineRegular size={14} />
        <span ref={triggerLabelRef} className={css.triggerLabel}>{t('trigger')}</span>
      </button>
      {open && error !== null && !errorDismissed ? <Toast key={errorSequence} text={error} holdMs={null}
        dismissLabel={t('dismissFeedback')} onDone={() => { setErrorDismissed(true) }} />
        : open && loadingTeam && !loadingDismissed ? <Toast text={t('loading')} icon={<StateDot state="ongoing" />}
          holdMs={null} dismissLabel={t('dismissFeedback')} onDone={() => { setLoadingDismissed(true) }} /> : null}
      {open && createPortal(
        <div
          ref={panelRef}
          className={`${css.panel}${compact ? ` ${css.panelCompact}` : ''}${project ? ` ${css.projectPanel}` : ''}`}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          tabIndex={-1}
          aria-label={t('trigger')}
          data-team-panel
          onMouseEnter={cancelHoverChange}
          onMouseLeave={scheduleHoverClose}
          onFocusCapture={() => { if (project) pinnedRef.current = true }}
          onPointerDownCapture={() => { if (project) pinnedRef.current = true }}
        >
          <TeamBody {...props} onError={(message) => {
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
