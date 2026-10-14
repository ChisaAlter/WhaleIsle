import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconCloseOutline16,
  IconFullscreenOutline16,
  IconPanelBottomOutline16,
  IconPlusOutline16,
  IconSplitOutline16,
  IconTrashOutline16,
  Tooltip,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { cwdFromSessions } from './cwd.ts'
import { clampDrawerHeight, maxDrawerHeight, TERMINAL_DRAWER_DEFAULT } from './height.ts'
import { NS } from './locales.ts'
import type { TerminalShellInjected } from './shell.ts'
import {
  acquireCreate,
  MAX_TERMINALS_PER_GROUP,
  releaseCreate,
  snapshotOf,
  type TerminalSplitDirection,
  type createTerminalSessionStore,
} from './stores.ts'
import { TerminalPane } from './TerminalPane.tsx'
import css from './TerminalWorkspace.module.css'

export type TerminalWorkspaceProps =
  & Pick<PropsRuntime<'shell.terminalDrawer'>, 'useSessions'>
  & PropsStore<ReturnType<typeof createTerminalSessionStore>>
  & PropsLocale<typeof NS>
  & Omit<TerminalShellInjected, 'onPtyData' | 'onPtyExit'>
  & { mode: 'drawer' | 'surface'; sessionId: SessionId | undefined }

type ActionBarProps = {
  compact: boolean
  mode: 'drawer' | 'surface'
  available: boolean
  hasSessions: boolean
  atLimit: boolean
  activeId: string
  creating: 'ensure' | 'new' | TerminalSplitDirection | null
  t: TerminalWorkspaceProps['t']
  onSplit: (direction: TerminalSplitDirection) => void
  onMaximize: () => void
  maximizeLabel: string
  onNew: () => void
  onClose: () => void
}

function ActionBar({
  compact,
  mode,
  available,
  hasSessions,
  atLimit,
  activeId,
  creating,
  t,
  onSplit,
  onMaximize,
  maximizeLabel,
  onNew,
  onClose,
}: ActionBarProps): ReactNode {
  const splitH = atLimit ? t('action.splitHorizontal.limit') : t('action.splitHorizontal')
  const splitV = atLimit ? t('action.splitVertical.limit') : t('action.splitVertical')
  const splitDisabled = !available || !hasSessions || atLimit || creating !== null
  const divider = (): ReactNode => compact ? null : <div className={css.rule} />
  return (
    <div className={compact ? css.sidebarActions : css.toolbar}>
      <Tooltip label={splitH} side="bottom">
        <Button
          type="button"
          size="sm"
          className={css.action}
          loading={creating === 'horizontal'}
          aria-label={splitH}
          disabled={splitDisabled}
          onClick={() => { onSplit('horizontal') }}
        >
          <IconSplitOutline16 size={compact ? 12 : 14} />
        </Button>
      </Tooltip>
      {divider()}
      <Tooltip label={splitV} side="bottom">
        <Button
          type="button"
          size="sm"
          className={css.action}
          loading={creating === 'vertical'}
          aria-label={splitV}
          disabled={splitDisabled}
          onClick={() => { onSplit('vertical') }}
        >
          <IconSplitOutline16 size={compact ? 12 : 14} className={css.splitVertical} />
        </Button>
      </Tooltip>
      {divider()}
      {mode === 'drawer' ? (
        <>
          <Tooltip label={maximizeLabel} side="bottom">
            <button
              type="button"
              className={css.action}
              aria-label={maximizeLabel}
              onClick={onMaximize}
            >
              <IconFullscreenOutline16 size={compact ? 12 : 14} />
            </button>
          </Tooltip>
          {divider()}
        </>
      ) : null}
      <Tooltip label={t(available ? 'action.new' : 'empty.unavailable')} side="bottom">
        <Button
          key={hasSessions ? 'new-terminal' : 'ensure-terminal'}
          type="button"
          size="sm"
          className={css.action}
          loading={creating === 'new' || creating === 'ensure'}
          aria-label={t('action.new')}
          disabled={!available || creating !== null}
          onClick={onNew}
        >
          <IconPlusOutline16 size={compact ? 12 : 14} />
        </Button>
      </Tooltip>
      {divider()}
      <Tooltip label={t('action.close')} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={t('action.close')}
          disabled={!activeId}
          onClick={onClose}
        >
          <IconTrashOutline16 size={compact ? 12 : 14} />
        </button>
      </Tooltip>
    </div>
  )
}

/**
 * Terminal chrome for one shell: toolbar, empty state, tiled PTY panes, and
 * the session list shown once more than one PTY exists on that shell.
 * @param props - session seats, this shell's store, PTY IPC, layout writes, and copy.
 * @returns the drawer or surface body.
 */
export function TerminalWorkspace({
  mode,
  sessionId,
  useSessions,
  useStore,
  actions,
  ptyCreate,
  ptyCanCreate,
  ptyWrite,
  ptyResize,
  ptyKill,
  setTerminalDrawer,
  mentionTerminal,
  writeClipboard,
  openWorkspacePath,
  openLocalUrl,
  openExternal,
  t,
}: TerminalWorkspaceProps): ReactNode {
  const cwd = useSessions(list => cwdFromSessions(sessionId, list))
  const sessions = useStore(s => s.sessions)
  const activeId = useStore(s => s.activeId)
  const groups = useStore(s => s.groups)
  const createFailed = useStore(s => s.createFailed)
  const rootRef = useRef<HTMLElement | null>(null)
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const lastHeight = useRef(TERMINAL_DRAWER_DEFAULT)
  const [maximized, setMaximized] = useState(false)
  const [creating, setCreating] = useState<'ensure' | 'new' | TerminalSplitDirection | null>(null)
  const [notice, setNotice] = useState<string>()

  const activeGroup = groups.find(group => group.terminalIds.includes(activeId)) ?? groups[0]
  const visibleIds = activeGroup?.terminalIds ?? (activeId ? [activeId] : [])
  const splitDirection: TerminalSplitDirection = activeGroup?.splitDirection ?? 'horizontal'
  const atLimit = visibleIds.length >= MAX_TERMINALS_PER_GROUP
  const [authorizedCwd, setAuthorizedCwd] = useState<string>()
  const available = cwd !== undefined && authorizedCwd === cwd
  useEffect(() => {
    let cancelled = false
    setAuthorizedCwd(undefined)
    if (cwd) void ptyCanCreate(cwd).then(allowed => {
      if (!cancelled && allowed) setAuthorizedCwd(cwd)
    }).catch(() => { /* Keep creation unavailable when authority cannot be read. */ })
    return () => { cancelled = true }
  }, [cwd, ptyCanCreate])
  const hasTerminalSidebar = sessions.length > 1

  const create = useCallback(async (kind: 'ensure' | 'new' | TerminalSplitDirection) => {
    if (!available || !cwd || !acquireCreate(actions)) return
    try {
      const snap = snapshotOf(actions)
      if (kind === 'ensure' && snap && snap.sessions.length > 0) return
      if (kind !== 'ensure' && kind !== 'new' && atLimit) return
      setCreating(kind)
      setNotice(undefined)
      const created = await ptyCreate({ cwd })
      if (kind === 'ensure' || kind === 'new') actions.newTerminal(created.id, cwd)
      else actions.split(created.id, cwd, kind)
    } catch {
      actions.failCreate()
      setNotice(t('error.create'))
    } finally {
      setCreating(null)
      releaseCreate(actions)
    }
  }, [actions, atLimit, available, cwd, ptyCreate, t])

  const closeSession = useCallback((id: string) => {
    actions.close(id)
    void ptyKill(id)
  }, [actions, ptyKill])

  const closeActive = useCallback(() => {
    if (!activeId) return
    closeSession(activeId)
  }, [activeId, closeSession])

  const wasOpen = useRef(false)
  useEffect(() => {
    const el = rootRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    wasOpen.current = false
    const observer = new ResizeObserver(() => {
      const open = el.clientHeight > 0
      const justOpened = open && !wasOpen.current
      wasOpen.current = open
      if (!justOpened) return
      const snap = snapshotOf(actions)
      if (!available || !cwd || !snap || snap.sessions.length > 0 || snap.createFailed) return
      void create('ensure')
    })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [actions, available, create, createFailed, cwd])

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const height = rootRef.current?.clientHeight ?? 0
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: height > 0 ? height : TERMINAL_DRAWER_DEFAULT,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [])

  const onResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    event.preventDefault()
    const next = clampDrawerHeight(
      state.startHeight + (state.startY - event.clientY),
      window.innerHeight,
    )
    lastHeight.current = next
    setMaximized(false)
    setTerminalDrawer(next)
  }, [setTerminalDrawer])

  const onResizePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
  }, [])

  const actionBar = (compact: boolean): ReactNode => (
    <ActionBar
      compact={compact}
      mode={mode}
      available={available}
      hasSessions={sessions.length > 0}
      atLimit={atLimit}
      activeId={activeId}
      creating={creating}
      t={t}
      onSplit={direction => { void create(direction) }}
      maximizeLabel={maximized ? t('action.restore') : t('action.maximize')}
      onMaximize={() => {
        const max = maxDrawerHeight(window.innerHeight)
        const current = rootRef.current?.clientHeight ?? 0
        if (maximized) {
          setTerminalDrawer(lastHeight.current)
          setMaximized(false)
          return
        }
        if (current > 0 && current < max) lastHeight.current = current
        setTerminalDrawer(max)
        setMaximized(true)
      }}
      onNew={() => { void create(sessions.length === 0 ? 'ensure' : 'new') }}
      onClose={closeActive}
    />
  )

  const paneGridStyle = splitDirection === 'vertical'
    ? {
        gridTemplateRows: `repeat(${visibleIds.length}, minmax(0, 1fr))`,
        gridTemplateColumns: 'minmax(0, 1fr)',
      }
    : {
        gridTemplateColumns: `repeat(${visibleIds.length}, minmax(0, 1fr))`,
      }

  return (
    <aside ref={rootRef} className={css.root} data-terminal-owner={mode}>
      {notice !== undefined && <Toast key={notice} text={notice} holdMs={null} dismissLabel={t('dismissFeedback')}
        onDone={() => { setNotice(undefined) }} actions={[{ label: t('action.new'), onClick: () => { void create('new') } }]} />}
      {mode === 'drawer' ? (
        <div
          className={css.resize}
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('resize')}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerEnd}
          onPointerCancel={onResizePointerEnd}
        />
      ) : null}

      {!hasTerminalSidebar ? actionBar(false) : null}

      <div className={css.body}>
        {sessions.length === 0 ? (
          <div className={css.empty}>
            <p>{!available ? t('empty.unavailable') : t('empty.title')}</p>
          </div>
        ) : (
          <div
            className={css.panes}
            data-split-direction={splitDirection}
            style={paneGridStyle}
          >
            {visibleIds.map(id => {
              const session = sessions.find(item => item.id === id)
              return (
                <div
                  key={id}
                  role="group"
                  tabIndex={0}
                  className={clsx(css.pane)}
                  data-active={id === activeId || undefined}
                  aria-label={`${t('session.label')} ${id}`}
                  onPointerDown={() => { actions.activate(id) }}
                  onClick={() => { actions.activate(id) }}
                >
                  <TerminalPane
                    id={id}
                    session={session}
                    active={id === activeId}
                    onActivate={() => { actions.activate(id) }}
                    sessionId={sessionId}
                    cwd={cwd}
                    mentionTerminal={mentionTerminal}
                    writeClipboard={writeClipboard}
                    openWorkspacePath={openWorkspacePath}
                    openLocalUrl={openLocalUrl}
                    openExternal={openExternal}
                    t={t}
                    onData={bytes => { void ptyWrite(id, bytes) }}
                    onResize={(cols, rows) => {
                      actions.setSize(id, cols, rows)
                      void ptyResize(id, cols, rows)
                    }}
                  />
                </div>
              )
            })}
          </div>
        )}

        {hasTerminalSidebar ? (
          <aside className={css.sidebar}>
            <div className={css.sidebarHeader}>
              {actionBar(true)}
            </div>
            <div className={css.sidebarList} role="list" aria-label={t('sessions.list')}>
              {groups.map((group, groupIndex) => (
                <div key={group.id} className={css.groupBlock}>
                  <button
                    type="button"
                    className={clsx(
                      css.groupHeader,
                      group.terminalIds.includes(activeId) && css.groupHeaderActive,
                    )}
                    onClick={() => {
                      actions.activate(
                        group.terminalIds.includes(activeId)
                          ? activeId
                          : group.terminalIds[0]!,
                      )
                    }}
                  >
                    {`${t('group.label')} ${groupIndex + 1}`}
                  </button>
                  <div className={css.groupItems}>
                    {group.terminalIds.map(id => {
                      const sessionIndex = sessions.findIndex(item => item.id === id)
                      const label = `${t('session.label')} ${sessionIndex + 1}`
                      return (
                        <div
                          key={id}
                          role="listitem"
                          className={clsx(css.sessionRow, id === activeId && css.sessionRowActive)}
                        >
                          <button
                            type="button"
                            className={css.sessionActivate}
                            onClick={() => { actions.activate(id) }}
                          >
                            <IconPanelBottomOutline16 size={12} />
                            <span className={css.sessionLabel}>{label}</span>
                          </button>
                          <button
                            type="button"
                            className={css.sessionClose}
                            aria-label={`${t('action.close')} ${label}`}
                            onClick={() => { closeSession(id) }}
                          >
                            <IconCloseOutline16 size={10} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </aside>
  )
}
