import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemeSettings } from '../theme-settings.ts'
import type { ThemeRuntime } from './index.ts'
import { observeStartupResponsiveness } from './startup-responsiveness.ts'

/** Desktop-only transport; no polling of CPU, memory or process metrics. */
interface RenderingBridge {
  setMinimalMode: (value: boolean) => Promise<boolean>
  claimSuggestion: () => Promise<boolean>
}

/** Couple the profile preference, shell cache and one startup observation lifetime. */
export function installMinimalModeLifecycle(ctx: Context, theme: ThemeRuntime, host: ConfigForm<ThemeSettings>): void {
  const desktop = (globalThis as { dshDesktop?: { rendering?: RenderingBridge } }).dshDesktop
  const bridge = desktop?.rendering
  if (bridge === undefined || typeof document === 'undefined') return
  const suggestion = theme.minimalSuggestion
  let started = false
  let disposed = false
  let stop: (() => void) | undefined
  let stopWaiting: (() => void) | undefined
  let pendingTimer: ReturnType<typeof setTimeout> | undefined
  let mirrored: boolean | undefined
  const eligible = (): boolean => {
    const snapshot = theme.getTheme()
    return !disposed && snapshot.minimalMode !== true && snapshot.minimalModeSuggestions !== false
      && (snapshot.minimalModeSnoozedUntil ?? 0) <= Date.now()
  }
  const offer = (): void => {
    let remaining = 30
    let lastInput = Date.now()
    const input = (): void => { lastInput = Date.now() }
    document.addEventListener('input', input, { capture: true, passive: true })
    document.addEventListener('keydown', input, { capture: true, passive: true })
    stopWaiting = () => {
      clearTimeout(pendingTimer)
      document.removeEventListener('input', input, true)
      document.removeEventListener('keydown', input, true)
    }
    const attempt = (): void => {
      if (!eligible() || --remaining < 0) { stopWaiting?.(); return }
      const typing = Date.now() - lastInput < 3000
        && document.activeElement?.matches('input, textarea, [contenteditable="true"]')
      if (document.visibilityState === 'hidden' || !document.hasFocus() || typing
        || document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]') !== null) {
        pendingTimer = setTimeout(attempt, 2000)
        return
      }
      stopWaiting?.()
      void bridge.claimSuggestion().then(claimed => {
        if (claimed && eligible()) suggestion.set(true)
      }).catch((error: unknown) => { ctx.logger.error(error) })
    }
    pendingTimer = setTimeout(attempt, 1500)
  }
  const sync = (): void => {
    if (host.getSnapshot().value === undefined) return
    const minimal = theme.getTheme().minimalMode === true
    if (mirrored !== minimal) {
      mirrored = minimal
      void bridge.setMinimalMode(minimal).catch((error: unknown) => { ctx.logger.error(error) })
    }
    if (!eligible()) {
      stop?.()
      stopWaiting?.()
      suggestion.set(false)
    } else if (!started) {
      started = true
      stop = observeStartupResponsiveness(offer)
    }
  }
  ctx.on('theme/change', sync)
  ctx.effect(() => host.subscribe(sync), 'ui-theme: rendering preference readiness')
  ctx.effect(() => {
    sync()
    return () => { disposed = true; stop?.(); stopWaiting?.() }
  }, 'ui-theme: bounded startup responsiveness observation')
}
