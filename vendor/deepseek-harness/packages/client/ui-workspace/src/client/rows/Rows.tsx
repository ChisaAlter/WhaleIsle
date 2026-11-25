/**
 * Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
 * all data and callbacks arrive via props. Hover swaps (folder->chevron,
 * time->ellipsis, action buttons) are CSS-only, and a session row's clipped
 * title marquees while the row is hovered or its menu is open. Workspace row
 * menus share captured Workspace actions with right-click. Both row types
 * render the shared `contextMenu.button` factory for their menu trigger.
 * Session hover buttons use the browser's `renderSlot` for the
 * `sidebar.workspaces.session.row.action` list. Session and Workspace
 * hover cards are suppressed while their menu is open.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import clsx from 'clsx'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Checkbox, HoverCard, IconArchiveOutlineRegular, MarqueeText,
  IconEllipsisOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
  IconNewChatOutlineRegular, IconPinFillRegular, IconPlusOutlineRegular, IconTrashOutlineRegular,
  IconTriangleRightFillRegular, IconUnarchiveOutlineRegular, Menu, relativeTime, StateDot, Tooltip, useHoverMarquee, useRowDragPreview,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { usePresence } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionDragType, WorkspaceBrowserProps } from '../contract/slots.ts'
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

/** Drag data type carrying a dragged Session row's id. */
const SESSION_DRAG_TYPE: SessionDragType = 'application/x-dsh-session'

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
  /**
   * End the drag.
   * @param claimed - another drop target accepted the Session as a copy; the owner discards the insert marker.
   */
  end: (claimed: boolean) => void
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
} & Pick<WorkspaceBrowserProps, 'useWorkspaceAccess' | 'renderFactorySlot' | 'useContextMenuTarget' | 'useContextMenu'>

/** The header actions one row offers; an absent create offers no New Session button. */
interface ProjectRowActions {
  readonly create?: (() => void) | undefined
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
 * hover reveals the chevron and, on a real Workspace, the create button;
 * dwelling on a real Workspace shows its hover card. The ungrouped bucket
 * has neither, because it has no backing Workspace to start a Session in.
 * `containsCurrent` arrives on the node (derivation fact, no renderer scan).
 * Create and drag follow the Workspace access snapshot. Menu providers own
 * their access checks; the ungrouped bucket has no Workspace menu.
 * @param props.group - derived group node.
 * @param props.containsCurrentDescendant - highlight an ancestor even when its subtree is collapsed.
 * @param props.onToggle - expand/collapse the group.
 * @param props.onCreate - start a frontend Session inside the given Workspace.
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

/** The ungrouped bucket's header: no backing Workspace to start a Session in or reorder. */
function UngroupedProjectRow(props: ProjectRowItemProps) {
  return <ProjectRow {...props} actions={{ reorder: false }} />
}

/** A real Workspace's header: every action asks that Workspace's resource. */
function WorkspaceProjectRow({ workspaceId, ...props }: ProjectRowItemProps & { workspaceId: WorkspaceId }) {
  const { useWorkspaceAccess } = props
  const create = useWorkspaceAccess(workspaceId, 'session/create')
  const actions: ProjectRowActions = {
    create: create ? props.onCreate : undefined,
    reorder: useWorkspaceAccess(workspaceId, 'workspace/insertBefore'),
  }
  return <ProjectRow {...props} actions={actions} />
}

function ProjectRow({
  group, containsCurrentDescendant = false, onToggle, drag: offeredDrag, home, newShortcut, t, actions,
  renderFactorySlot, useContextMenuTarget, useContextMenu,
}: Omit<ProjectRowItemProps, 'onCreate'> & { actions: ProjectRowActions }) {
  const { getTriggerProps } = useContextMenu()
  const drag = actions.reorder ? offeredDrag : undefined
  const create = actions.create
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
          renderFactorySlot('contextMenu.button', {
            target: { kind: 'workspace', value: { ...workspaceMenuTarget, displayTitle: label } },
            label: t('actions.workspace.aria', { name: label }),
            className: css.iconButton,
          })
        )}
        {create !== undefined && (
          <Tooltip label={t('actions.newSession')} shortcutKeys={newShortcut?.keys} side="bottom" align="end" delayMs={500} portal>
            <button
              type="button"
              className={css.iconButton}
              aria-keyshortcuts={newShortcut?.aria}
              aria-label={t('actions.newSession.aria', { name: label })}
              onClick={(e) => { e.stopPropagation(); create() }}
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
  node: Pick<SessionNode, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed' | 'failed'>,
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
  const completion: SessionStatus = node.failed
    ? { state: 'error', label: t('status.failed') }
    : { state: 'done', label: t('status.unread') }
  const unread: SessionStatus[] = node.completed ? [completion] : []
  if (pending !== undefined) return subagents === undefined ? [pending, ...unread] : [pending, subagents, ...unread]
  if (node.running) {
    const primary: SessionStatus = { state: 'ongoing', label: t('status.running') }
    return subagents === undefined ? [primary, ...unread] : [primary, subagents, ...unread]
  }
  if (subagents !== undefined) return [subagents, ...unread]
  if (node.completed) return [completion]
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
  // Archived rows show live activity but suppress idle and unread reminders.
  const statuses = sessionStatuses(node.archived ? { ...node, completed: false } : node, t)
    .filter(status => !(node.archived && status.state === 'idle'))
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
  node, currentId, now, onOpen, onRenameRequest, renderSlot, renderFactorySlot, useContextMenuTarget,
  useContextMenu, onReveal, drag, home, useSessionAccess, selection: providedSelection, t,
}: {
  useContextMenu: WorkspaceBrowserProps['useContextMenu']
  renderFactorySlot: WorkspaceBrowserProps['renderFactorySlot']
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
  const draggable = !selection?.enabled && !row.blank && !row.archived && row.owner === undefined
  const reorderDraggable = draggable && drag !== undefined && reorderable
  const titleRef = useRef<HTMLSpanElement>(null)
  // On macOS the click that activates the window is not delivered, but the
  // next click arrives with detail 2 and fires dblclick, so rename requires a
  // detail-1 press on this title since the window last lost focus.
  const renameArmed = useRef(false)
  const disarmRename = useRef(() => { renameArmed.current = false }).current
  const marquee = useHoverMarquee(titleRef, { hold: menuOpen })
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
      onPointerEnter={marquee.onPointerEnter}
      onPointerLeave={marquee.onPointerLeave}
      draggable={draggable}
      onDragStart={!draggable
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = reorderDraggable ? 'copyMove' : 'copy'
          e.dataTransfer.setData(SESSION_DRAG_TYPE, node.id)
          if (reorderDraggable) {
            e.dataTransfer.setData('text/plain', node.id)
            drag.start()
          }
          dragPreview.start(e)
        }}
      onDragEnd={(e) => { if (dragPreview.clear()) drag?.end(e.dataTransfer.dropEffect === 'copy') }}
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
          unread reminder, which returns after activity stops
          and clears after the visible content is acknowledged. Archived rows keep the slot
          blank — the grayed row carries the archived look — and their live
          status stays on the hover card only. */}
      <span className={css.slot}>
        {selection?.enabled && !row.blank
          ? <SessionCheckbox id={node.id} title={title} selection={selection} t={t} />
          : !row.archived && !row.blank && (showStatus
          ? <SessionStatusDots statuses={statuses} />
          : renderSlot('sidebar.session.row.leading', { sessionId: node.id }))}
      </span>
      <MarqueeText
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
      </MarqueeText>
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
          {renderFactorySlot('contextMenu.button', {
            target: { kind: 'session', value: { sessionId: node.id, displayTitle: row.title } },
            label: t('actions.session.aria', { name: title }),
            className: css.iconButton,
          })}
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
