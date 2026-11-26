/** Titlebar trailing entry that shows or hides the active Session's panel. */
import { useId, type ReactNode } from 'react'
import { Button, IconFlatListOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { panelElementId, toggleElementId } from './element-ids.ts'
import type { SessionPanelToggleProps } from './slots.ts'
import { presentationOf } from './visibility.ts'
import css from './SessionPanelToggle.module.css'

/**
 * Render the toggle for the active main-view Session. Its accessible name is
 * the panel name followed by the text of any indicator; the expanded state
 * says whether the panel shows. Blank home sessions, managed sessions, and
 * non-conversation main panels render nothing. While no Chat View shows the
 * active Session, as in the trajectory View, the panel has no place to show:
 * the toggle stays unavailable and its tooltip says so.
 * @param props - titlebar state, active Session selection, docking room, visibility, toggle action, indicator slot, and copy.
 * @returns the titlebar toggle, or null when no active conversation is shown.
 */
export function SessionPanelToggle({
  managedSession,
  usePanelInfo,
  useSessions,
  useDockable,
  useVisibility,
  toggle,
  renderSlot,
  SessionProvider,
  t,
}: SessionPanelToggleProps): ReactNode {
  const onConversation = usePanelInfo(info => info.activePanelId === null)
  const sessionId = useSessions((s) => {
    const mainView = Object.values(s.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)
    if (mainView === undefined) return undefined
    const presentationOwned = mainView.presentation !== undefined
    if (!presentationOwned && mainView.blank && !mainView.running) return undefined
    return mainView.id
  })
  const dockable = useDockable(entries => (sessionId === undefined ? undefined : entries.get(sessionId)))
  const shown = useVisibility(visibility => (
    sessionId === undefined ? false : presentationOf(dockable === true, visibility, sessionId) !== 'hidden'
  ))
  const nameId = useId()
  const indicatorsId = useId()

  if (!onConversation || managedSession || sessionId === undefined) return null

  const available = dockable !== undefined
  const open = available && shown
  const label = available ? t(open ? 'toggle.hide' : 'toggle.show') : t('toggle.unavailable')
  return (
    <Tooltip label={label} side="bottom" delayMs={500}>
      <Button
        size="sm"
        id={toggleElementId(sessionId)}
        className={css.trigger}
        aria-expanded={open}
        aria-controls={open ? panelElementId(sessionId) : undefined}
        aria-disabled={available ? undefined : true}
        // The name and the indicators' text join with a space, as the referenced elements of a label do.
        aria-labelledby={`${nameId} ${indicatorsId}`}
        data-session-panel-toggle=""
        onClick={() => { toggle(sessionId) }}
      >
        <IconFlatListOutlineRegular size={16} />
        <span id={nameId} className={css.name}>{t('panel.name')}</span>
        <span id={indicatorsId} className={css.indicators}>
          <SessionProvider>
            {renderSlot('conversation.session.panel.indicator', { panelShown: open })}
          </SessionProvider>
        </span>
      </Button>
    </Tooltip>
  )
}
