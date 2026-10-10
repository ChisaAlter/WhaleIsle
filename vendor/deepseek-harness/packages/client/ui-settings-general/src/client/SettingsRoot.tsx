/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is
 * a pure composition face — slot-owned text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve from localized content (trigger: shell locale; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). The
 * SettingsNavigation service owns modal visibility and requested section
 * state, mirrored into the declared owner store for the shortcut command
 * surface;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here. Callers can
 * open the shell before this component mounts.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  ConnectionIndicator, Tooltip, useModalLayer,
  IconAgentPresetOutline16, IconArchiveOutline20, IconBrowseOutline16, IconChartOutline16,
  IconCloseOutline16, IconDataOutline16, IconDeviceOutline16,
  IconInfoOutline16, IconLightOutline16, IconPanelLeftOutline16,
  IconPersonalizationOutline16, IconServerOutline16, IconSettingsOutline16,
  IconSkillOutline16,
  usePresence,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionIndicatorState, PresenceState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'
import { DesktopUpdateIndicator } from './DesktopUpdateIndicator.tsx'

const RECOVERY_CONFIRMATION_MS = 2_000

/** Minimum visible time for the connecting pill; shorter attempts read as flicker. */
const CONNECTING_MIN_VISIBLE_MS = 800

const NAV_ICONS: Readonly<Record<string, typeof IconSettingsOutline16>> = {
  general: IconSettingsOutline16,
  interface: IconPanelLeftOutline16,
  appearance: IconLightOutline16,
  models: IconDataOutline16,
  'agent-presets': IconAgentPresetOutline16,
  plugins: IconPersonalizationOutline16,
  skills: IconSkillOutline16,
  mcp: IconServerOutline16,
  market: IconBrowseOutline16,
  remote: IconDeviceOutline16,
  about: IconInfoOutline16,
  'usage-stats': IconChartOutline16,
  // 20-native glyph in the rail's 16px icon slot, as on the Session row menu.
  'archived-sessions': IconArchiveOutline20,
}

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  const Icon = NAV_ICONS[id] ?? IconSettingsOutline16
  return <Icon className={css.navIcon} size={16} />
}

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  motionState: PresenceState
  open: boolean
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * Body-portaled modal layer: full-viewport mask + centered panel. Close paths: the
 * header button, a mask click, and document-level Escape (mounted only while
 * open, so the listener lifetime is the panel's).
 */
function SettingsPanel({ rows, renderSlot, activeId, motionState, open, onSelect, onClose }: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id
  const titleId = useId()

  const panel = useRef<HTMLDivElement>(null)
  // Register on the LOGICAL flag, not on this component's mount: Presence keeps
  // the panel mounted for the exit recipe, and a layer that stayed registered
  // through that window would keep the rest of the UI yielding keyboard input
  // (isBehindModal) after the shell was already logically closed.
  useModalLayer(panel, open, onClose)

  // Portalled beside #root like the Modal primitive: a covering surface mounted
  // inside the root would precede the columns' chrome in document order, so a
  // chrome row that declares window drag after it would override its subtraction.
  // Beside the root, base.css's `body > :not(#root)` rule subtracts it instead.
  return createPortal((
    <div
      className={css.overlay}
      role="presentation"
      data-dsh-motion="overlay"
      data-state={motionState}
      aria-hidden={open ? undefined : true}
    >
      <div className={css.mask} data-dsh-motion-part="mask" aria-hidden="true" onClick={onClose} />
      <div ref={panel} tabIndex={-1} data-shortcut-modal="settings" className={css.panel}
        data-dsh-motion-part="panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <nav className={css.nav}>
          <div className={css.navTitle} id={titleId} tabIndex={-1}
            data-modal-autofocus={active === undefined ? '' : undefined}>{renderSlot('settings.header', {})}</div>
          <div className={css.navList}>
            {rows.map(row => (
              <button
                key={row.id}
                type="button"
                className={clsx(css.navCell, row.id === active && css.active)}
                data-dsh-settings-section={row.id}
                aria-current={row.id === active ? 'true' : undefined}
                data-modal-autofocus={row.id === active ? '' : undefined}
                onClick={() => { onSelect(row.id) }}
              >
                {navIcon(row.id)}
                <span className={css.navLabel}>{row.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            <div className={css.actions}>{renderSlot('settings.action', {})}</div>
            <button type="button" className={css.close} onClick={onClose}>
              <IconCloseOutline16 size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div className={css.options}>
            {active !== undefined && (
              <div key={active} data-dsh-motion="swap">
                {renderSlot('settings.section', { close: onClose }, { only: active })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    wide, reconnect, openSettings, closeSettings, useConnectionState, useNavigation,
    useSections, useOnboardingSteps, useSessions, renderSlot, t,
    useDesktopUpdate, openDesktopUpdate, useShortcuts,
  } = props
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'settings.open'))
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const [explicitOnboarding, setExplicitOnboarding] = useState<string | undefined>()
  const [showRecovery, setShowRecovery] = useState(false)
  const [holdConnecting, setHoldConnecting] = useState(false)
  const connectingShownAt = useRef<number | undefined>(undefined)
  const triggerButton = useRef<HTMLButtonElement | null>(null)
  const launcherRow = useRef<HTMLDivElement | null>(null)
  const navigation = useNavigation(state => state)
  const { open, sectionId: activeId } = navigation
  const wasOpen = useRef(open)
  const { mounted, state } = usePresence(open)
  const launcher = renderSlot('settings.launcher', {
    wide,
    settingsOpen: open,
    openSettings: () => { openSettings() },
    ...(shortcut?.keys.length ? { settingsShortcut: { keys: shortcut.keys, aria: shortcut.aria } } : {}),
    openOnboarding: (id: string) => { setExplicitOnboarding(id) },
  })
  const close = useCallback(() => { closeSettings() }, [closeSettings])
  // The wide layout opens from the account launcher row, which is not the
  // trigger button useModalLayer captured, so that case needs the shell's own
  // return target. Without a launcher the hook's generic restore is already
  // correct (it returns focus to whichever control actually opened the shell),
  // and overriding it here would move focus away from that opener.
  useEffect(() => {
    if (!wasOpen.current || open) { wasOpen.current = open; return }
    // Ownership guard, matching useModalLayer's policy: if the close commit
    // left focus on a control that is not part of the retiring shell, another
    // surface already owns the keyboard and this preference must not steal it.
    const active = document.activeElement
    if (active instanceof HTMLElement && active.isConnected
      && active.closest('[aria-hidden="true"], [inert]') === null
      && active !== document.body
      && active.closest('[data-shortcut-modal="settings"]') === null) {
      wasOpen.current = open
      return
    }
    const launcherEntry = launcherRow.current?.querySelector('button')
    if (launcherEntry != null && launcherEntry.closest('[aria-hidden="true"], [inert]') === null) {
      launcherEntry.focus()
    }
    wasOpen.current = open
  }, [open])
  const openSection = useCallback((id: string) => {
    openSettings(id)
  }, [openSettings])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const desktopUpdate = useDesktopUpdate(state => state)
  const connectionState = useConnectionState(state => state)
  const previousConnectionState = useRef(connectionState)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions((state) => {
    const main = Object.values(state.byId)
      .find(session => (session.retainedBy.mainView ?? 0) > 0)
    return state.phase === 'ready' && (main === undefined || main.blank)
  })
  const onboardingStep = explicitOnboarding !== undefined
    ? onboardingSteps.find(step => step.id === explicitOnboarding)
    : onboardingActive
      ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
      : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  const onboardingStepSeen = useRef(onboardingStep)
  // An onboarding step owns the viewport and marks `#root` inert. The panel portals
  // beside `#root`, outside that mark, so a step that appears while the panel is open
  // takes the panel down rather than leaving it focusable behind the onboarding mask.
  useEffect(() => {
    const appeared = onboardingStepSeen.current === undefined && onboardingStep !== undefined
    onboardingStepSeen.current = onboardingStep
    if (appeared && open) close()
  }, [onboardingStep, open, close])

  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
  }, [connectionState])

  // The confirmation window starts when the recovered pill becomes visible,
  // which the connecting minimum-visible hold can delay past the transition.
  useLayoutEffect(() => {
    if (!showRecovery || holdConnecting) return
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [showRecovery, holdConnecting])

  useLayoutEffect(() => {
    if (connectionState === 'connecting') {
      connectingShownAt.current = Date.now()
      return
    }
    const shownAt = connectingShownAt.current
    if (shownAt === undefined) return
    connectingShownAt.current = undefined
    const remaining = CONNECTING_MIN_VISIBLE_MS - (Date.now() - shownAt)
    if (remaining <= 0) return
    setHoldConnecting(true)
    const timeout = window.setTimeout(() => { setHoldConnecting(false) }, remaining)
    return () => {
      window.clearTimeout(timeout)
      setHoldConnecting(false)
    }
  }, [connectionState])

  const completeOnboardingStep = useCallback((id: string) => {
    if (explicitOnboarding === id) {
      setExplicitOnboarding(undefined)
      return
    }
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [explicitOnboarding])

  let connectionIndicator: ConnectionIndicatorState | undefined
  if (connectionState === 'connecting' || holdConnecting) {
    connectionIndicator = 'connecting'
  } else if (connectionState === 'disconnected') {
    connectionIndicator = 'disconnected'
  } else if (showRecovery) {
    connectionIndicator = 'recovered'
  }

  return (
    <div className={clsx(css.root, !wide && css.railRoot)}>
      {launcher != null && <button type="button" hidden data-dsh-settings-trigger
        aria-expanded={open} onClick={() => { openSettings() }} />}
      <div className={clsx(css.triggerRow, !wide && css.railRow)}>
        {launcher != null && <div ref={launcherRow} className={css.launcherRow}>{launcher}</div>}
        {launcher == null && <Tooltip disabled={open} label={t('trigger')} shortcutKeys={shortcut?.keys}>
          <button
            ref={triggerButton}
            type="button"
            className={clsx(css.trigger, !wide && css.rail)}
            data-dsh-settings-trigger
            aria-label={t('trigger')}
            aria-keyshortcuts={shortcut?.aria}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => { openSettings() }}
          >
            {renderSlot('settings.trigger', { wide })}
          </button>
        </Tooltip>}
        <div className={css.statusSeat}>
          {connectionIndicator !== undefined && desktopUpdate.presentation?.phase !== 'installing'
            ? <ConnectionIndicator compact
              state={connectionIndicator}
              disconnectedLabel={t('connection.error')}
              connectingLabel={t('connection.connecting')}
              recoveredLabel={t('connection.connected')}
              reconnectActionLabel={t('connection.reconnect')}
              restartActionLabel={t('connection.restart')}
              onReconnect={reconnect}
            />
            : <DesktopUpdateIndicator hidden={false}
              t={t} view={desktopUpdate} onOpen={openDesktopUpdate} />}
        </div>
      </div>
      {mounted && (
        <SettingsPanel
          rows={rows}
          renderSlot={renderSlot}
          activeId={activeId}
          motionState={state}
          open={open}
          onSelect={openSection}
          onClose={close}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        explicit: explicitOnboarding === onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </div>
  )
}
