import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TeamMemberProjection,
  TeamTaskView as TeamTask,
} from '@deepseek-ai/dsh-experimental-agent-team/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import {
  IconChevronDownOutlineRegular,
  IconUserOutlineRegular, IconUsersOutlineRegular, StateDot, Tag, Tooltip,
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
}

/** Durable lifecycle overlaid with the member Session's live turn activity. */
type MemberStatus = 'running' | 'inactive' | 'provisioning' | 'failed'

/** Full props of the Team conversation-header action. */
export type TeamActionProps =
  PropsRuntime<'conversation.session.header.actions'> & TeamActionInjected & PropsLocale<typeof NS>

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
  onError: (message: string) => void
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
          try {
            openTeammate(sessionId, member.id)
          } catch (reason) {
            onError(String(reason))
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
            <span className={css.memberNameText}>{label}</span>
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

/** Render the Team roster and read-only task board. */
export function TeamAction({
  sessionId, useSession, useSessions, useSessionStatus, openTeammate, t,
}: TeamActionProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState(false)
  const [page, setPage] = useState(0)
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
  const sessionRows = useSessions(state => state.byId)
  const project = useSessions(state => state.byId[leadSessionId]?.presentation?.owner === 'project')
  const opening = useSession(snapshot => snapshot.openState === 'loading')
  const listing = useSessions(state => state.phase === 'pending')
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
    setHistory(false)
    setPage(0)
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
  const memberLabel = (member: TeamMemberProjection): string => {
    if (!project) return member.name
    if (member.role === 'lead') return t('project.lead')
    return team?.tasks.find(task => task.ownerName === member.name)?.subject ?? member.description ?? member.name
  }
  const taskRows = project && team !== undefined
    ? history ? team.tasks.filter(task => task.status === 'completed').toReversed()
      : [...team.tasks.filter(task => task.status !== 'completed'), ...team.tasks.filter(task => task.status === 'completed').slice(-3).reverse()]
    : team?.tasks ?? []
  const pageCount = Math.max(1, Math.ceil(taskRows.length / 20)), currentPage = Math.min(page, pageCount - 1)
  const visibleTasks = project ? taskRows.slice(currentPage * 20, (currentPage + 1) * 20) : taskRows
  const visibleMembers = project ? (team?.members ?? []).filter(member => member.role === 'lead' || member.id === sessionId || member.phase === 'provisioning' || sessionRows[member.id]?.running === true || visibleTasks.some(task => task.ownerName === member.name)) : team?.members ?? []

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
      {open && createPortal(
        <div
          ref={panelRef}
          className={compact ? `${css.panel} ${css.panelCompact}` : css.panel}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          tabIndex={-1}
          aria-label={t('trigger')}
          data-team-panel
          onMouseEnter={cancelHoverChange}
          onMouseLeave={scheduleHoverClose}
        >
          <div className={css.body}>
            {error !== null && (
              <div className={css.error} role="alert"><StateDot state="error" />{error}</div>
            )}
            {team === undefined && (
              <div className={css.notice} role="status">
                <StateDot state={opening || listing ? 'ongoing' : 'warning'} />
                {t(opening || listing ? 'loading' : 'unavailable')}
              </div>
            )}
            {team !== undefined && (
              <>
                {project && <div className={css.meta}>
                  <button type="button" onClick={() => { setHistory(value => !value); setPage(0) }}>{t(history ? 'project.currentWork' : 'project.history')}</button>
                  <span>{t(history ? 'project.history' : 'project.currentWork')} · {taskRows.length}</span>
                  {currentPage > 0 && <button type="button" onClick={() => { setPage(currentPage - 1) }}>{t('project.previous')}</button>}
                  {currentPage + 1 < pageCount && <button type="button" onClick={() => { setPage(currentPage + 1) }}>{t('project.next')}</button>}
                </div>}
                {team.failure !== undefined && (
                  <div className={css.error} role="alert"><StateDot state="error" />{t('failure', { message: team.failure })}</div>
                )}
                <section>
                  <h3>
                    {t('roster')}
                    {team.members.length > 1 && <span className={css.count}>{team.members.length}</span>}
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
                        onError={setError}
                        t={t}
                      />
                    ))}
                  </div>
                </section>
                <section>
                  {team.tasks.length === 0
                    ? <p className={css.emptyNotice}>{t('empty')}</p>
                    : (
                      <>
                        <h3>{t('tasks')}<span className={css.count}>{team.tasks.length}</span></h3>
                        <div className={css.tasks}>
                          {visibleTasks.map(task => {
                            const owner = team.members.find(member => member.name === task.ownerName)
                            return <TaskCard key={task.id} task={task} project={project}
                              ownerLabel={project && owner !== undefined ? memberLabel(owner) : task.ownerName ?? t('unowned')}
                              dependencyLabels={task.blockedBy.map(id => project
                                ? team.tasks.find(dependency => dependency.id === id)?.subject ?? t('project.missingDependency')
                                : id)}
                              t={t} />
                          })}
                        </div>
                      </>
                    )}
                </section>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
