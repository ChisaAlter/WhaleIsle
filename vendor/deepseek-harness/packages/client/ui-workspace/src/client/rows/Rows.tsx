/**
 * Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
 * all data and callbacks arrive via props. Hover swaps (folder->chevron,
 * time->ellipsis, action buttons) are CSS-only, and a session row's clipped
 * title marquees programmatically while the row is hovered. Workspace row
 * menus share captured Workspace actions with right-click. A Session row's "..." menu and
 * its hover buttons are the `sidebar.workspaces.session.menu.item` and
 * `sidebar.workspaces.session.row.action` lists, rendered through the
 * browser's `renderSlot` with the menu's open state as the occurrence's hook
 * context; this package's own actions are entries like any plugin's. The
 * session and workspace hover cards are suppressed while a menu is open.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, ReactNode, RefObject } from 'react'
import clsx from 'clsx'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Checkbox, HoverCard, IconArchiveOutlineRegular,
  IconEllipsisOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
  IconNewChatOutlineRegular, IconPinFillRegular, IconPlusOutlineRegular, IconTrashOutlineRegular,
  IconTriangleRightFillRegular, IconUnarchiveOutlineRegular, Menu, relativeTime, StateDot, Tooltip, useRowDragPreview,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { usePresence } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { GroupNode, SearchResultNode, SessionNode } from '../tree.ts'
import css from './Rows.module.css'
import type { SessionRowSelection } from './SessionSelection.tsx'

/** Register a real row for the browser's visible-row selection control. */
function useRowSelection(id: SessionNode['id'], title: string, blank: boolean, ref: RefObject<HTMLDivElement | null>, selection: SessionRowSelection | undefined) {
  useEffect(() => {
    if (blank || selection === undefined || ref.current === null) return
    return selection.register(id, title, ref.current)
  }, [id, title, blank, ref, selection?.register])
}

/** Native checkbox replaces the status cell while selecting conversations. */
function SessionCheckbox({ id, title, selection, t }: {
  id: SessionNode['id']
  title: string
  selection: SessionRowSelection
  t: RowTranslate
}) {
  return <span onClick={(event) => { event.stopPropagation() }}>
    <Checkbox
      className={css.selectionCheckbox}
      label={t('selection.session.aria', { name: title })}
      checked={selection.selected.has(id)}
      disabled={selection.busy}
      onChange={() => { selection.toggle(id, title) }}
    />
  </span>
}

/** Sidebar-owned layout values needed by row copies mounted outside the sidebar. */
const DRAG_PREVIEW_PROPERTIES = [
  '--dsh-sidebar-row-padding',
  '--dsh-sidebar-label-gap',
  '--dsh-sidebar-paint-inset',
] as const

/** The standard locale seat, prop-passed from the browser root. */
type RowTranslate = WorkspaceBrowserProps['t']

/**
 * Child-seat renderer threaded from the browser root: the row's action lists,
 * its leading and trailing decorations, its title badge, and its hover-card section. The
 * leading
 * seat is rendered only while the row's primary state is idle, so a
 * status dot and a leading occupant never share the row; the badge seat in
 * every state; the hover seat only while the row's card is open.
 */
type RowRenderSlots = PropsRenderSlots<
  | 'sidebar.workspaces.session.row.action'
  | 'sidebar.session.row.trailing'
  | 'sidebar.session.row.leading'
  | 'sidebar.session.row.badge'
  | 'sidebar.session.row.hover'
>['renderSlot']

/** Row display title: blank rows show the localized New Session label. */
function displayTitle(node: SessionNode, t: RowTranslate): string {
  return node.blank ? t('session.new') : (node.title || t('session.untitled'))
}

/* Overflow this small hides no meaningful tail; scrolling for it reads as an
   accidental jitter, so the title stays put. */
const MIN_TITLE_REVEAL_PX = 8

/* Marquee travel speed: slow enough to read the text as it passes. */
const TITLE_MARQUEE_PX_PER_MS = 0.03

/**
 * Place the title's scroll position and publish the stylesheet's fade-mask
 * hooks: `data-scrolled` while the title has left its start (left fade) and
 * `data-clipped` while text remains beyond the right edge (right fade).
 * @param title - the row's clipping title element.
 * @param left - scroll offset in CSS pixels.
 * @param range - the title's maximum scroll offset in CSS pixels.
 */
function placeTitle(title: HTMLSpanElement, left: number, range: number): void {
  // jsdom implements no scrollTo; the lane's direct assignment is instant there
  // anyway, so both paths land on the same position.
  if (typeof title.scrollTo === 'function') title.scrollTo({ left, behavior: 'instant' })
  else title.scrollLeft = left
  if (left > 0) title.dataset.scrolled = ''
  else delete title.dataset.scrolled
  if (left < range) title.dataset.clipped = ''
  else delete title.dataset.clipped
}

/**
 * Return the title to its resting state: scrolled to the start with both fade
 * masks off, so the resting ellipsis renders at full strength.
 * @param title - the row's clipping title element.
 */
function restTitle(title: HTMLSpanElement): void {
  if (typeof title.scrollTo === 'function') title.scrollTo({ left: 0, behavior: 'instant' })
  else title.scrollLeft = 0
  delete title.dataset.scrolled
  delete title.dataset.clipped
}

/**
 * Marquee a title wider than its one-line cell while its row is hovered: the
 * title clips its own text, so entering crawls it at a constant speed until the
 * far edge (a fork's incremented title, for example) is in view, then rests
 * there under the pointer. Overflow of at most {@link MIN_TITLE_REVEAL_PX}
 * stays put — a barely-clipped title moving a few pixels reads as jitter, not a
 * reveal. Leaving returns the title to the start in one step, because the
 * resting ellipsis and the narrowed cell would otherwise meet the text while it
 * travelled back. Reduced motion jumps to the far edge instead of crawling.
 * @param title - ref to the row's clipping title element.
 * @returns stable pointer enter/leave handlers for the row.
 */
function useTitleMarquee(title: RefObject<HTMLSpanElement | null>): {
  enter: (event?: PointerEvent) => void
  leave: () => void
} {
  const frame = useRef(0)
  const revealing = useRef(false)
  useEffect(() => () => { cancelAnimationFrame(frame.current) }, [])
  return useMemo(() => ({
    enter: (event?: PointerEvent): void => {
      if (event?.pointerType === 'touch') return
      /* v8 ignore next -- defensive: the title span renders unconditionally. */
      if (title.current === null) return
      if (revealing.current) return
      revealing.current = true
      const element = title.current
      const range = element.scrollWidth - element.clientWidth
      if (range <= MIN_TITLE_REVEAL_PX) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        placeTitle(element, range, range)
        return
      }
      cancelAnimationFrame(frame.current)
      let previous: number | undefined
      let position = 0
      const step = (now: DOMHighResTimeStamp): void => {
        position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS
        previous = now
        placeTitle(element, Math.min(position, range), range)
        if (position < range) frame.current = requestAnimationFrame(step)
      }
      frame.current = requestAnimationFrame(step)
    },
    leave: (): void => {
      revealing.current = false
      cancelAnimationFrame(frame.current)
      /* v8 ignore next -- defensive: the title span renders unconditionally. */
      if (title.current === null) return
      restTitle(title.current)
    },
  }), [title])
}

/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
function timeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare (no "now ago"). */
function hoverTimeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t('time.ago', { t: t(`time.${unit}`, { n }) })
}

/**
 * Absolute creation time through the dictionary's date template (the message
 * clock pattern): `toLocaleString` would follow the browser language, not the
 * app locale, and produce mixed-language text after a switch.
 */
function createdLabel(createdAt: number, t: RowTranslate): string {
  const d = new Date(createdAt)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  const date = t('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
  return t('hover.created', { time: `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` })
}

/** Hover-card body: workspace title, display directory path, absolute creation time. */
function WorkspaceHoverContent({ label, cwd, createdAt, t }: {
  label: string
  cwd: string | undefined
  createdAt: number
  t: RowTranslate
}) {
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{label}</div>
      <div className={css.hoverPath}>{cwd}</div>
      <div className={css.hoverTime}>{createdLabel(createdAt, t)}</div>
    </div>
  )
}

/**
 * Row drag wiring supplied by the tree owner. `drop` reports the half of the
 * row where the pointer released so the owner can resolve an insert anchor.
 */
export interface RowDragProps {
  /** Start dragging this row. */
  start: () => void
  /** A compatible row drag is in flight. */
  active: boolean
  /** Current marker on this row: insert line above, below, or none. */
  marker: 'before' | 'after' | null
  /** Report the hovered half while a compatible drag passes over this row. */
  hover: (half: 'before' | 'after') => void
  drop: (half: 'before' | 'after') => void
  end: () => void
}

/** Drag lifecycle owned by a workspace row; its enclosing group owns hit testing. */
interface WorkspaceRowDragProps {
  start: () => void
  end: () => void
}

/** Pointer-position half of a row (insert line above or below). */
function rowHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/** Owner props of one Workspace header row; the access Hooks are the browser root's own standard seats. */
type ProjectRowItemProps = {
  group: GroupNode
  newShortcut?: ShortcutCatalogEntry | undefined
  containsCurrentDescendant?: boolean
  onToggle: () => void
  /** Absent for navigation-only groups, which cannot start a Session. */
  onCreate?: (() => void) | undefined
  /** Present only for real Workspace rows in the grouped view. */
  drag?: WorkspaceRowDragProps | undefined
  /** Host account home; POSIX home-rooted hover paths display as `~`. */
  home?: string | undefined
  t: RowTranslate
} & Pick<WorkspaceBrowserProps, 'useRemoteAccess' | 'useWorkspaceAccess' | 'openWorkspaceMenu' | 'useContextMenuTarget' | 'useContextMenu'>

/** Which of one header row's actions the caller's access snapshot allows. */
interface ProjectRowAccess {
  readonly create: boolean
  readonly reorder: boolean
}

/**
 * Fade-and-collapse the session run under a Workspace or Tasks header.
 * Presence keeps the last open rows mounted through the fade recipe; the
 * inner track collapses `0fr`/`1fr` on the same duration token as AppFrame.
 * @param props.open - whether the group is logically expanded.
 * @param props.children - session rows and the optional overflow control.
 * @returns the animated run, or nothing before the first expand.
 */
export function GroupSessionRun({ open, children }: { open: boolean; children: ReactNode }) {
  const { mounted, state } = usePresence(open)
  if (!mounted) return null
  return (
    <div
      className={css.sessionRunFade}
      data-dsh-motion="fade"
      data-state={state}
      aria-hidden={open ? undefined : true}
    >
      <div className={css.sessionRun} data-state={state}>
        <div className={css.sessionRunInner}>{children}</div>
      </div>
    </div>
  )
}

/**
 * Project (workspace) header row: folder + title;
 * hover reveals the chevron and create button, and dwelling on a real
 * Workspace shows its hover card (the ungrouped bucket has none).
 * `containsCurrent` arrives on the node (derivation fact, no renderer scan).
 * Create and drag follow the Workspace access snapshot. Menu providers own
 * their access checks; the ungrouped bucket has no Workspace menu.
 * @param props.group - derived group node.
 * @param props.containsCurrentDescendant - highlight an ancestor even when its subtree is collapsed.
 * @param props.onToggle - expand/collapse the group.
 * @param props.onCreate - start a frontend Session inside this Workspace.
 * @param props.drag - optional workspace-row drag wiring.
 * @param props.home - host account home for POSIX hover-path abbreviation.
 * @param props.t - the browser root's locale seat.
 * @returns the row element.
 */
export function ProjectRowItem(props: ProjectRowItemProps) {
  const workspaceId = props.group.workspaceId
  return workspaceId === undefined
    ? <UngroupedProjectRow {...props} />
    : <WorkspaceProjectRow {...props} workspaceId={workspaceId} />
}

/** The ungrouped bucket's header: no Workspace resource, so starting a Session there asks the global resource. */
function UngroupedProjectRow(props: ProjectRowItemProps) {
  const create = props.useRemoteAccess('session/create')
  return <ProjectRow {...props} access={{ create, reorder: false }} />
}

/** A real Workspace's header: every action asks that Workspace's resource. */
function WorkspaceProjectRow({ workspaceId, ...props }: ProjectRowItemProps & { workspaceId: WorkspaceId }) {
  const { useWorkspaceAccess } = props
  const access: ProjectRowAccess = {
    create: useWorkspaceAccess(workspaceId, 'session/create'),
    reorder: useWorkspaceAccess(workspaceId, 'workspace/insertBefore'),
  }
  return <ProjectRow {...props} access={access} />
}

function ProjectRow({
  group, containsCurrentDescendant = false, onToggle, onCreate, drag: offeredDrag, home, newShortcut, t, access,
  openWorkspaceMenu, useContextMenuTarget, useContextMenu,
}: ProjectRowItemProps & { access: ProjectRowAccess }) {
  const { getTriggerProps } = useContextMenu()
  const drag = access.reorder ? offeredDrag : undefined
  const row = group
  // The ungrouped bucket has no workspace title: its label is dictionary copy.
  const label = row.workspaceId === undefined ? t('group.ungrouped') : row.label
  const active = containsCurrentDescendant || (group.expanded && group.containsCurrent)
  const menuOpen = useContextMenuTarget(target => target?.kind === 'workspace' && target.value.workspaceId === row.workspaceId)
  const dragPreview = useRowDragPreview(css.dragPreview as string, DRAG_PREVIEW_PROPERTIES)
  const workspaceMenuTarget = row.workspaceId !== undefined && row.cwd !== undefined
    ? { workspaceId: row.workspaceId, path: row.cwd } : undefined
  const ownRow = (
    <div
      className={clsx(css.projectRow, menuOpen && css.menuOpen)}
      data-row-key={`workspace:${group.key}`}
      role="treeitem"
      aria-expanded={row.expanded}
      onClick={onToggle}
      {...getTriggerProps(workspaceMenuTarget === undefined ? undefined : { kind: 'workspace', value: { ...workspaceMenuTarget, displayTitle: label } })}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', row.key)
          drag.start()
          dragPreview.start(e)
        }}
      onDragEnd={() => { if (dragPreview.clear()) drag?.end() }}
    >
      <span className={clsx(css.slot, css.folder, active && css.folderActive)}>
        {row.expanded ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}
      </span>
      <span className={clsx(css.slot, css.chevron)}>
        <IconTriangleRightFillRegular className={clsx(css.arrow, row.expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
      <span className={css.rowActions}>
        {workspaceMenuTarget !== undefined && (
          <button type="button" className={css.iconButton} data-context-menu-trigger
            aria-label={t('actions.workspace.aria', { name: label })} aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              openWorkspaceMenu(workspaceMenuTarget.workspaceId, workspaceMenuTarget.path, label, { x: rect.left, y: rect.bottom }, 'toggle')
            }}><IconEllipsisOutlineRegular /></button>
        )}
        {access.create && onCreate !== undefined && (
          <Tooltip label={t('actions.newSession')} shortcutKeys={newShortcut?.keys} side="bottom" align="end" delayMs={500} portal>
            <button
              type="button"
              className={css.iconButton}
              aria-keyshortcuts={newShortcut?.aria}
              aria-label={t('actions.newSession.aria', { name: label })}
              onClick={(e) => { e.stopPropagation(); onCreate() }}
            >
              <IconNewChatOutlineRegular size={14} />
            </button>
          </Tooltip>
        )}
      </span>
    </div>
  )
  // The ungrouped bucket has no backing Workspace: no card to show.
  if (row.createdAt === undefined) return ownRow
  return (
    <HoverCard
      anchor={ownRow}
      content={<WorkspaceHoverContent
        label={row.label}
        cwd={row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home)}
        createdAt={row.createdAt}
        t={t}
      />}
      openDelayMs={800}
      grouped
      disabled={menuOpen}
      copyText={row.cwd}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

/**
 * No-directory section header: chevron + localized "No workspace folder"
 * title + create. No folder icon and no Workspace menu — these sessions sit
 * directly under this row at the same indent as sessions under a workspace,
 * and ＋ mints a Session in the Host scratch cwd instead of a Workspace one.
 * @param props.expanded - whether the session list below is shown.
 * @param props.containsCurrent - the current session is in this section.
 * @param props.onToggle - expand/collapse.
 * @param props.onCreate - mint a no-directory session.
 * @param props.useRemoteAccess - the browser root's global access Hook; creating needs `session/create`.
 * @param props.t - the browser root's locale seat.
 * @returns the row element.
 */
export function TasksSectionHeader({ expanded, containsCurrent, onToggle, onCreate, useRemoteAccess, t }: {
  expanded: boolean
  containsCurrent: boolean
  onToggle: () => void
  onCreate: () => void
  t: RowTranslate
} & Pick<WorkspaceBrowserProps, 'useRemoteAccess'>) {
  const label = t('group.ungrouped')
  const canCreate = useRemoteAccess('session/create')
  return (
    <div
      className={clsx(css.projectRow, css.tasksSection)}
      role="treeitem"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className={clsx(css.slot, css.chevron, css.tasksChevron, containsCurrent && css.folderActive)}>
        <IconTriangleRightFillRegular className={clsx(css.arrow, expanded && css.arrowOpen)} size={14} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
      {canCreate && (
        <span className={css.rowActions}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('actions.newSession.aria', { name: label })}
            onClick={(e) => { e.stopPropagation(); onCreate() }}
          >
            <IconPlusOutlineRegular size={16} />
          </button>
        </span>
      )}
    </div>
  )
}

/**
 * Header of the cross-workspace pinned section: chevron + localized title, no create control.
 * @param props.expanded - whether the pinned rows below are shown.
 * @param props.onToggle - expand/collapse.
 * @param props.t - the browser root's locale seat.
 * @returns the section header row.
 */
export function PinnedSectionHeader({ expanded, onToggle, t }: {
  expanded: boolean
  onToggle: () => void
  t: RowTranslate
}) {
  return (
    <div
      className={clsx(css.projectRow, css.tasksSection)}
      data-row-key="pinned-section"
      role="treeitem"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className={clsx(css.slot, css.chevron, css.tasksChevron)}>
        <IconTriangleRightFillRegular className={clsx(css.arrow, expanded && css.arrowOpen)} size={14} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{t('section.pinned')}</span>
      </span>
    </div>
  )
}

/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
function assertNever(value: never): never {
  throw new Error(`unknown pending interaction: ${String(value)}`)
}

interface SessionStatus {
  state: StateDotState
  label: string
  /** Compact text that replaces the Session row's update time. */
  trailingLabel?: string
}

/**
 * Session status presentation; pending interaction is primary and live activity
 * outranks completion reminders.
 */
function sessionStatuses(
  node: Pick<SessionNode, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed'>,
  t: RowTranslate,
): readonly [SessionStatus, ...SessionStatus[]] {
  const subagents: SessionStatus | undefined = node.runningSubagentCount === 0
    ? undefined
    : {
      state: 'ongoing',
      label: t(
        node.runningSubagentCount === 1
          ? 'status.subagentsRunning.one'
          : 'status.subagentsRunning.other',
        { n: node.runningSubagentCount },
      ),
    }
  let pending: SessionStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval':
      pending = {
        state: 'warning',
        label: t('status.waitingApproval'),
        trailingLabel: t('status.compact.approval'),
      }
      break
    case 'plan-review':
      pending = {
        state: 'warning',
        label: t('status.planReview'),
        trailingLabel: t('status.compact.planReview'),
      }
      break
    case 'question':
      pending = {
        state: 'warning',
        label: t('status.waitingAnswer'),
        trailingLabel: t('status.compact.answer'),
      }
      break
    case undefined: break
    /* v8 ignore next -- closed PendingInteractionStatus union */
    default: return assertNever(node.pendingInteraction)
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const primary: SessionStatus = { state: 'ongoing', label: t('status.running') }
    return subagents === undefined ? [primary] : [primary, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'idle', label: t('status.idle') }]
}

/** Primary status dot plus every status's screen-reader label, shared by the search and session rows. */
function SessionStatusDots({ statuses }: { statuses: readonly [SessionStatus, ...SessionStatus[]] }) {
  return (
    <>
      <StateDot state={statuses[0].state} />
      {statuses.map(status => (
        <span className={css.visuallyHidden} key={status.label}>{status.label}</span>
      ))}
    </>
  )
}

/** Non-interactive pinned-row marker; the enclosing row remains the only action. */
function PinnedIndicator({ t }: { t: RowTranslate }) {
  const label = t('row.pinned')
  return (
    <span className={css.pinIndicator} role="img" aria-label={label} title={label}>
      <IconPinFillRegular size={14} />
    </span>
  )
}

/**
 * Hover-card body: full title, display working directory, relative time, the Session's own scheduled-task
 * section, and every relevant live status. The task section sits above the
 * status lines so they stay the card's trailing status line.
 */
function SessionHoverContent({ node, cwd, now, renderSlot, t }: {
  node: SessionNode
  /** Display working directory; absent omits the line. */
  cwd: string | undefined
  now: number
  renderSlot: RowRenderSlots
  t: RowTranslate
}) {
  // On archived rows the archived line already says the session is inactive,
  // so resting statuses (idle/completed) drop; live activity still shows.
  const statuses = sessionStatuses(node, t)
    .filter(status => !(node.archived && (status.state === 'done' || status.state === 'idle')))
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{displayTitle(node, t)}</div>
      {cwd !== undefined && <div className={css.hoverPath}>{cwd}</div>}
      {/* Same placeholder rule as the row's trailing cell: no timestamp
          before the first prompt. */}
      {!node.blank && <div className={css.hoverTime}>{hoverTimeLabel(node.updatedAt, now, t)}</div>}
      {renderSlot('sidebar.session.row.hover', { sessionId: node.id })}
      {statuses.map(status => (
        <div className={css.hoverStatus} key={status.label}>
          <StateDot state={status.state} />
          <span>{status.label}</span>
        </div>
      ))}
      {node.archived && (
        <div className={clsx(css.hoverStatus, css.hoverArchived)}>
          <IconArchiveOutlineRegular size={14} />
          <span>{t('row.archived')}</span>
        </div>
      )}
    </div>
  )
}

/**
 * One flat search result: title, Workspace context, and optional content
 * excerpt. Search navigation opens the session only; it does not address an
 * event inside the conversation. Archived rows carry the restore/delete
 * menu used by archive management, without opening or restoring on row click.
 * @param props.result - merged local/content search row.
 * @param props.currentId - selected session id.
 * @param props.onOpen - open the selected session.
 * @param props.onUnarchive - unarchive an archived result row.
 * @param props.onDelete - open the confirmation for deleting an archived result.
 * @param props.useSessionAccess - the browser root's Session access Hook; the restore control
 * appears only while the snapshot allows `workspace/unarchiveSession` for that Session.
 * @param props.t - Workspace-browser translation seat.
 * @returns the result row.
 */
export function SearchResultItem({
  result, currentId, onOpen, onUnarchive, onDelete, renderSlot, selection: providedSelection, useSessionAccess, t,
}: {
  result: SearchResultNode
  currentId: string | undefined
  onOpen: (id: SearchResultNode['id']) => void
  onUnarchive: (id: SearchResultNode['id']) => void
  onDelete: (id: SearchResultNode['id'], title: string) => void
  renderSlot: RowRenderSlots
  selection?: SessionRowSelection | undefined
  t: RowTranslate
} & Pick<WorkspaceBrowserProps, 'useSessionAccess'>) {
  const selection = result.owner === undefined ? providedSelection : undefined
  const canUnarchive = useSessionAccess(result.id, 'workspace/unarchiveSession')
  const statuses = sessionStatuses(result, t)
  const primaryStatus = statuses[0]
  const [menuOpen, setMenuOpen] = useState(false)
  const title = result.title || t('session.untitled')
  const rowRef = useRef<HTMLDivElement>(null)
  useRowSelection(result.id, title, false, rowRef, selection)
  const selected = selection?.enabled ? selection.selected.has(result.id) : result.id === currentId
  return (
    <div
      ref={rowRef}
      className={clsx(css.searchResultRow, selected && css.selected, result.archived && css.archived, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-selected={selected}
      aria-description={result.archived && result.owner === undefined ? t('toast.archivedNotOpenable') : undefined}
      onClick={() => {
        if (selection?.enabled) { selection.toggle(result.id, title) }
        else onOpen(result.id)
      }}
    >
      <span className={css.searchResultHeading}>
        {/* Like session rows, the leading slot owns every row marker; on
            archived rows it stays blank — the grayed row carries the
            archived look. */}
        <span className={css.slot}>
          {selection?.enabled
            ? <SessionCheckbox id={result.id} title={title} selection={selection} t={t} />
            : !result.archived && primaryStatus.state !== 'idle' && (
            <SessionStatusDots statuses={statuses} />
          )}
        </span>
        <span className={css.searchResultTitle}>{title}</span>
        {renderSlot('sidebar.session.row.badge', { sessionId: result.id })}
        {result.archived && !selection?.enabled && canUnarchive && (
          <span className={css.rowActions} onClick={(e) => { e.stopPropagation() }}>
            <Menu
              open={menuOpen}
              onClose={() => { setMenuOpen(false) }}
              items={[
                { id: 'unarchive', label: t('menu.unarchiveSession'), icon: <IconUnarchiveOutlineRegular size={16} /> },
                ...result.owner === undefined
                  ? [{ id: 'delete', label: t('menu.deleteSession'), icon: <IconTrashOutlineRegular size={16} />, danger: true }] : [],
              ]}
              onSelect={(id) => {
                setMenuOpen(false)
                if (id === 'unarchive') onUnarchive(result.id)
                if (id === 'delete') onDelete(result.id, title)
              }}
              portal
              closeOnPointerLeave
              anchor={(
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('actions.session.aria', { name: title })}
                  onClick={() => { setMenuOpen(value => !value) }}
                >
                  <IconEllipsisOutlineRegular size={16} />
                </button>
              )}
            />
          </span>
        )}
      </span>
      <span className={css.searchResultMeta}>
        <span className={css.searchResultWorkspace}>{result.workspace || t('group.ungrouped')}</span>
        {result.snippet !== undefined && (
          <span className={css.searchResultSnippet}>{result.snippet}</span>
        )}
      </span>
    </div>
  )
}

/**
 * One top-level 32px session row: leading 16px cell (status dot, or the
 * leading seat while the row's primary state is idle), title, relative time or
 * compact pending label, and the row actions menu. A row that owns a state dot
 * keeps that cell and renders no seat, so an ambient automation mark never
 * appears beside the row's own state dot. An archived row keeps the cell blank:
 * neither marker renders there, and its live status stays on the hover card.
 * The row accepts Tab focus and opens with unmodified Enter or Space; descendant controls
 * handle their own activation without opening the row.
 * @param props.node - derived session node.
 * @param props.currentId - selected session id (row highlight).
 * @param props.now - epoch ms for relative-time formatting.
 * @param props.onOpen - open a session by id.
 * @param props.onRenameRequest - open the rename dialog from a title double-click (id + current title);
 * called only after a single press on the title since the window last lost focus.
 * @param props.renderSlot - child-seat renderer for the row's action lists
 * (`sidebar.workspaces.session.menu.item` / `sidebar.workspaces.session.row.action`),
 * its leading and trailing decorations, and its hover-card section.
 * @param props.onReveal - scroll this row into view after search navigation, then acknowledge it.
 * @param props.drag - optional row-drag target wiring; blank rows, and rows whose access excludes
 * `workspace/insertSessionBefore`, cannot start a drag.
 * @param props.home - host account home for POSIX hover-path abbreviation.
 * @param props.useSessionAccess - the browser root's Session access Hook; the title double-click
 * renames only while it allows `session/rename`.
 * @param props.t - the browser root's locale seat.
 * @returns the session row.
 */
export function SessionNodeItem({
  node, currentId, now, onOpen, onRenameRequest, renderSlot, openSessionMenu, useContextMenuTarget,
  useContextMenu, onReveal, drag, home, useSessionAccess, selection: providedSelection, t,
}: {
  useContextMenu: WorkspaceBrowserProps['useContextMenu']
  openSessionMenu: WorkspaceBrowserProps['openSessionMenu']
  useContextMenuTarget: WorkspaceBrowserProps['useContextMenuTarget']
  node: SessionNode
  currentId: string | undefined
  now: number
  onOpen: (id: SessionNode['id']) => void
  /** Open the rename dialog from a title double-click (id + current title); see the function JSDoc for the press precondition. */
  onRenameRequest: (id: SessionNode['id'], currentTitle: string) => void
  /** Scroll this row into view after search navigation, then acknowledge it. */
  onReveal?: (() => void) | undefined
  /** Present on reorderable-list rows so every row can remain a drop target. */
  drag?: RowDragProps | undefined
  selection?: SessionRowSelection | undefined
  /** Host account home; POSIX home-rooted hover paths display as `~`. */
  home?: string | undefined
  t: RowTranslate
} & Pick<WorkspaceBrowserProps, 'useSessionAccess'> & PropsRenderSlots<
  | 'sidebar.workspaces.session.row.action'
  | 'sidebar.session.row.trailing'
  | 'sidebar.session.row.leading'
  | 'sidebar.session.row.badge'
  | 'sidebar.session.row.hover'
>) {
  const { getTriggerProps } = useContextMenu()
  const row = node
  const selection = node.owner === undefined ? providedSelection : undefined
  const title = displayTitle(node, t)
  const statuses = sessionStatuses(node, t)
  const primaryStatus = statuses[0]
  const showStatus = primaryStatus.state !== 'idle'
  // Archived rows hold their in-place grayed slot, so manual reorder cannot
  // move them. Pinned rows drag within the pinned block: the browser gates
  // their drop targets to fellow pinned rows.
  const renamable = useSessionAccess(node.id, 'session/rename')
  const reorderable = useSessionAccess(node.id, 'workspace/insertSessionBefore')
  const menuOpen = useContextMenuTarget(target => target?.kind === 'session' && target.value.sessionId === node.id)
  const dragPreview = useRowDragPreview(css.dragPreview as string, DRAG_PREVIEW_PROPERTIES)
  const rowRef = useRef<HTMLDivElement>(null)
  useRowSelection(node.id, title, row.blank, rowRef, selection)
  const selected = selection?.enabled ? selection.selected.has(node.id) : node.id === currentId
  const draggable = !selection?.enabled && drag !== undefined && reorderable && !row.blank && !row.archived && row.owner === undefined
  const titleRef = useRef<HTMLSpanElement>(null)
  // On macOS the click that activates the window is not delivered, but the
  // next click arrives with detail 2 and fires dblclick, so rename requires a
  // detail-1 press on this title since the window last lost focus.
  const renameArmed = useRef(false)
  const disarmRename = useRef(() => { renameArmed.current = false }).current
  const marquee = useTitleMarquee(titleRef)
  useEffect(() => {
    if (menuOpen || rowRef.current?.matches(':hover')) marquee.enter()
    else marquee.leave()
  }, [menuOpen, marquee])
  useEffect(() => {
    if (onReveal === undefined) return
    rowRef.current?.scrollIntoView({ block: 'nearest' })
    onReveal()
  }, [onReveal])
  const ownRow = (
    <div
      ref={rowRef}
      data-row-key={`session:${node.id}`}
      className={clsx(
        css.sessionRow, selected && css.selected, menuOpen && css.menuOpen,
        row.archived && css.archived,
        drag?.marker === 'before' && css.dropBefore, drag?.marker === 'after' && css.dropAfter,
      )}
      role="treeitem"
      aria-selected={selected}
      aria-description={row.archived && row.owner === undefined ? t('toast.archivedNotOpenable') : undefined}
      tabIndex={0}

      onClick={() => {
        if (selection?.enabled) { if (!row.blank) selection.toggle(node.id, title) }
        else onOpen(node.id)
      }}
      {...getTriggerProps(row.blank ? undefined : { kind: 'session', value: { sessionId: node.id, displayTitle: row.title } }, { onKeyDown: (event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        event.preventDefault()
        onOpen(node.id)
      } })}
      onPointerEnter={marquee.enter}
      onPointerLeave={() => { if (!menuOpen) marquee.leave() }}
      draggable={draggable}
      onDragStart={!draggable
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.id)
          drag.start()
          dragPreview.start(e)
        }}
      onDragEnd={() => { if (dragPreview.clear()) drag?.end() }}
      onDragOver={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          drag.hover(rowHalf(e))
        }}
      onDrop={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          drag.drop(rowHalf(e))
        }}
    >
      {/* Pending interaction and own or descendant activity outrank the
          finished-but-unviewed reminder, which returns after activity stops
          and is cleared by opening the session. Archived rows keep the slot
          blank — the grayed row carries the archived look — and their live
          status stays on the hover card only. */}
      <span className={css.slot}>
        {selection?.enabled && !row.blank
          ? <SessionCheckbox id={node.id} title={title} selection={selection} t={t} />
          : !row.archived && !row.blank && (showStatus
          ? <SessionStatusDots statuses={statuses} />
          : renderSlot('sidebar.session.row.leading', { sessionId: node.id }))}
      </span>
      <span
        ref={titleRef}
        className={css.title}
        onMouseDown={(e) => {
          if (e.detail !== 1) return
          renameArmed.current = true
          // One shared function and options: repeated presses add one listener.
          window.addEventListener('blur', disarmRename, { once: true })
        }}
        onDoubleClick={row.blank || selection?.enabled || !renamable
          ? undefined
          : (e) => {
            e.stopPropagation()
            if (!renameArmed.current) return
            renameArmed.current = false
            onRenameRequest(node.id, row.title)
          }}
      >
        {title}
      </span>
      {/* Pinned-section rows leave their Workspace group, so the row names it. */}
      {node.context !== undefined && <span className={css.context} title={node.context}>{node.context}</span>}
      {!row.blank && renderSlot('sidebar.session.row.badge', { sessionId: node.id })}
      {/* Blank rows have no first prompt, so neither trailing details nor
          actions for existing content are available. */}
      {!row.blank && (
        <span className={css.rowResting}>
          <span
            className={clsx(css.time, primaryStatus.trailingLabel === undefined && css.timestamp)}
            aria-hidden={primaryStatus.trailingLabel === undefined ? undefined : true}
          >
            {primaryStatus.trailingLabel ?? timeLabel(row.updatedAt, now, t)}
          </span>
          {renderSlot('sidebar.session.row.trailing', { sessionId: node.id })}
          {row.pinned && !row.archived && node.context === undefined && <PinnedIndicator t={t} />}
        </span>
      )}
      {/* The strip's clicks stay in the strip: the trigger and every
          row.action entry act without also opening the row, so an entry's
          button needs no propagation handling of its own. */}
      {!row.blank && !selection?.enabled && (
        <span className={css.rowActions} onClick={(e) => { e.stopPropagation() }}>
          <button type="button" className={css.iconButton}
            aria-label={t('actions.session.aria', { name: title })}
            onPointerDown={(event) => { event.stopPropagation() }}
            data-context-menu-trigger=""
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true })
              const rect = event.currentTarget.getBoundingClientRect()
              openSessionMenu(node.id, row.title, { x: rect.left, y: rect.bottom }, 'toggle')
            }}><IconEllipsisOutlineRegular /></button>
          <span className={css.rowQuickActions}>
            {renderSlot('sidebar.workspaces.session.row.action', { sessionId: node.id, displayTitle: row.title })}
          </span>
        </span>
      )}
    </div>
  )
  return (
    <HoverCard
      anchor={ownRow}
      content={<SessionHoverContent
        node={node}
        cwd={row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home)}
        now={now}
        renderSlot={renderSlot}
        t={t}
      />}
      openDelayMs={800}
      grouped
      disabled={selection?.enabled || menuOpen || drag?.active === true}
      copyText={row.blank || row.title === '' ? undefined : row.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

/**
 * Archived-section header: chevron + localized title; no create control.
 * Defaults collapsed; expand is session-local in the browser.
 * @param props.expanded - whether archived session rows below are shown.
 * @param props.onToggle - expand/collapse.
 * @param props.t - the browser root's locale seat.
 * @returns the section header row.
 */
export function ArchivedSectionHeader({ expanded, onToggle, t }: {
  expanded: boolean
  onToggle: () => void
  t: RowTranslate
}) {
  const label = t('section.archived')
  return (
    <div
      className={clsx(css.projectRow, css.tasksSection)}
      role="treeitem"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className={clsx(css.slot, css.chevron, css.tasksChevron)}>
        <IconTriangleRightFillRegular className={clsx(css.arrow, expanded && css.arrowOpen)} size={14} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
    </div>
  )
}

/**
 * Archived session row: not draggable; menu is unarchive plus danger delete.
 * Row click is inert — restore and destroy stay menu-only so a casual click
 * cannot unarchive into the live list.
 * @param props.node - archived session node.
 * @param props.currentId - selected session id.
 * @param props.now - clock for the relative-time label.
 * @param props.onUnarchive - unarchive without opening (menu).
 * @param props.onDelete - open the browser-owned delete confirmation (menu).
 * @param props.t - the browser root's locale seat.
 * @returns the archived session row.
 */
export function ArchivedSessionNodeItem({ node, currentId, now, onOpen, onUnarchive, onDelete, renderSlot, selection: providedSelection, home, t }: {
  node: SessionNode
  currentId: string | undefined
  now: number
  onOpen?: ((id: SessionNode['id']) => void) | undefined
  onUnarchive: (id: SessionNode['id']) => void
  onDelete: (id: SessionNode['id'], title: string) => void
  renderSlot: RowRenderSlots
  selection?: SessionRowSelection | undefined
  /** Host account home; POSIX home-rooted hover paths display as `~`. */
  home?: string | undefined
  t: RowTranslate
}) {
  const row = node
  const selection = node.owner === undefined ? providedSelection : undefined
  const title = displayTitle(node, t)
  const rowRef = useRef<HTMLDivElement>(null)
  useRowSelection(node.id, title, row.blank, rowRef, selection)
  const selected = selection?.enabled ? selection.selected.has(node.id) : node.id === currentId
  const statuses = sessionStatuses(node, t)
  const primaryStatus = statuses[0]
  const showStatus = primaryStatus.state !== 'done' || row.completed
  const [menuOpen, setMenuOpen] = useState(false)
  const archivedMenuItems = [
    { id: 'unarchive', label: t('menu.unarchiveSession'), icon: <IconArchiveOutlineRegular size={16} /> },
    ...(row.owner === undefined ? [{ id: 'delete', label: t('menu.deleteSession'), icon: <IconTrashOutlineRegular size={16} />, danger: true }] : []),
  ]
  const ownRow = (
    <div
      ref={rowRef}
      className={clsx(css.sessionRow, css.archived, selected && css.selected, menuOpen && css.menuOpen)}
      data-row-key={`session:${node.id}`}
      role="treeitem"
      aria-selected={selected}
      aria-description={node.owner === undefined ? t('toast.archivedNotOpenable') : undefined}
      onClick={() => {
        if (selection?.enabled && !row.blank) selection.toggle(node.id, title)
        else if (node.owner !== undefined) onOpen?.(node.id)
      }}
    >
      <span className={css.slot}>
        {selection?.enabled && !row.blank
          ? <SessionCheckbox id={node.id} title={title} selection={selection} t={t} />
          : showStatus && <SessionStatusDots statuses={statuses} />}
      </span>
      <span className={css.title}>{title}</span>
      {!row.blank && renderSlot('sidebar.session.row.badge', { sessionId: node.id })}
      {!row.blank && <span className={css.time}>{timeLabel(row.updatedAt, now, t)}</span>}
      {!row.blank && !selection?.enabled && (
        <span className={css.rowActions} onClick={(event) => { event.stopPropagation() }}>
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={archivedMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'unarchive') onUnarchive(node.id)
              if (id === 'delete') onDelete(node.id, title)
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.session.aria', { name: title })}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutlineRegular size={16} />
              </button>
            )}
          />
        </span>
      )}
    </div>
  )
  return (
    <HoverCard
      anchor={ownRow}
      content={<SessionHoverContent
        node={node}
        cwd={row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home)}
        now={now}
        renderSlot={renderSlot}
        t={t}
      />}
      disabled={selection?.enabled || menuOpen}
      copyText={row.blank ? undefined : row.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}
