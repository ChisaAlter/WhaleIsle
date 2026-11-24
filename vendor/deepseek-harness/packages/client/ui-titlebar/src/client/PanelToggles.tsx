import { useEffect, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconPanelBottomOutline16, IconPanelRightOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { isEditableKeyboardTarget, isSurfacesShortcut, isTerminalShortcut, isTextEntryTarget } from './keybindings.ts'
import { NS } from './locales.ts'
import css from './PanelToggles.module.css'

/** Layout writes injected into the titlebar trailing contribution. */
export interface PanelTogglesInjected {
  toggleSurfaces: () => void
  toggleTerminalDrawer: () => void
  hooks: {
    /** Persisted terminal-drawer button visibility bound as useTerminalToggle. */
    terminalToggle: SnapshotStore<boolean>
    /** Persisted surfaces-column button visibility bound as useSurfacesToggle. */
    surfacesToggle: SnapshotStore<boolean>
  }
}

export type PanelTogglesProps =
  PropsRuntime<'shell.titlebar.trailing'>
  & PropsLocale<typeof NS>
  & InjectFace<PanelTogglesInjected>

/**
 * Render the titlebar terminal-drawer and surfaces-column ghost toggles.
 * @param props - layout widths, workspace list, toggle callbacks, and copy.
 * @returns the two icon toggles.
 */
export function PanelToggles({
  rightbarShown,
  terminalDrawer,
  usePanelInfo,
  useWorkspaces,
  useTerminalToggle,
  useSurfacesToggle,
  toggleSurfaces,
  toggleTerminalDrawer,
  t,
}: PanelTogglesProps): ReactNode {
  const activePanelId = usePanelInfo(info => info.activePanelId)
  const isProjectsPanel = activePanelId === 'projects'
  const terminalAvailable = useWorkspaces(s => s.items.length > 0)
  const terminalOpen = terminalDrawer > 0
  const surfacesOpen = rightbarShown
  // On Projects, hide session-bound titlebar toggles unless that pane is already
  // open (e.g. an on-demand file preview in the shared rightbar) so the user can
  // still close it without duplicating the Projects task toggle or hitting an
  // unmounted sidebarRight surface.
  const showTerminal = useTerminalToggle(value => value) && (!isProjectsPanel || terminalOpen)
  const showSurfaces = useSurfacesToggle(value => value) && (!isProjectsPanel || surfacesOpen)

  useEffect(() => {
    // Desktop runtime owns both chords through the shortcut registry
    // (surfaces.toggle / terminal.drawer.toggle in apply.ts); keeping this DOM
    // listener would be a second track racing the same actions.
    if (document.documentElement.dataset.platform !== undefined) return
    const onKey = (event: KeyboardEvent) => {
      if (isSurfacesShortcut(event)) {
        if (isEditableKeyboardTarget(event.target)) return
        if (isProjectsPanel && !surfacesOpen) return
        event.preventDefault()
        toggleSurfaces()
        return
      }
      if (isTerminalShortcut(event)) {
        // The drawer toggle still applies with focus inside the terminal, so
        // only text entry fields are exempt for this shortcut.
        if (isTextEntryTarget(event.target)) return
        if (!terminalAvailable) return
        event.preventDefault()
        toggleTerminalDrawer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [isProjectsPanel, surfacesOpen, terminalAvailable, toggleSurfaces, toggleTerminalDrawer])

  if (!showTerminal && !showSurfaces) return <></>

  return (
    <div className={css.cluster} data-panel-layout-controls>
      {showTerminal ? (
        <Tooltip
          label={terminalAvailable
            ? `${t('terminal.toggle')} (${t('shortcut.terminal')})`
            : t('terminal.unavailable')}
          side="bottom"
        >
          <button
            type="button"
            className={clsx(css.toggle, terminalOpen && css.pressed)}
            aria-label={t('terminal.toggle')}
            aria-pressed={terminalOpen}
            disabled={!terminalAvailable}
            onClick={() => { toggleTerminalDrawer() }}
          >
            <IconPanelBottomOutline16 size={14} />
          </button>
        </Tooltip>
      ) : null}
      {showSurfaces ? (
        <Tooltip
          label={`${t('surfaces.toggle')} (${t('shortcut.surfaces')})`}
          side="bottom"
        >
          <button
            type="button"
            className={clsx(css.toggle, surfacesOpen && css.pressed)}
            aria-label={t('surfaces.toggle')}
            aria-pressed={surfacesOpen}
            onClick={() => { toggleSurfaces() }}
          >
            <IconPanelRightOutline16 size={14} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  )
}
