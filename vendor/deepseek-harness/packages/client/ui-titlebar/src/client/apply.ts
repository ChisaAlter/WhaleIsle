/** Registers the titlebar panel toggles into the layout-owned trailing cluster. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PanelTogglesInjected } from './PanelToggles.tsx'
import { PanelToggles } from './PanelToggles.tsx'
import type { PanelToggleRowInjected } from './PanelToggleRow.tsx'
import { SurfacesToggleRow, TerminalToggleRow } from './PanelToggleRow.tsx'
import { ChromeVisibility } from './chrome-visibility.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import {
  SURFACES_TOGGLE_FIELD, TERMINAL_TOGGLE_FIELD, TITLEBAR_SETTINGS_NAMESPACE,
  type TitlebarSettings,
} from '../titlebar-settings.ts'
import { en, NS, zh, type TitlebarKey } from './locales.ts'

export type { PanelTogglesInjected, PanelTogglesProps } from './PanelToggles.tsx'
export type { TitlebarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Titlebar panel-toggle copy. */
    titlebar: TitlebarKey
  }
}

/** Services required by the titlebar plugin. */
export const inject = ['slots', 'layout', 'locale', 'connection', 'remote', 'configForms', 'shortcuts']

/** Toggle the single right panel shared by guide and content. */
function toggleSurfaces(ctx: Context): void {
  const sidebarRight = ctx.get('sidebarRight')
  if (sidebarRight === undefined) return
  const activePanelId = ctx.layout.panelInfo?.getSnapshot().activePanelId
  if (activePanelId === 'projects' && !sidebarRight.isExpanded()) return
  try {
    sidebarRight.toggleExpanded()
  } catch {
    // Non-conversation panels without an active preview mount no sidebarRight surface.
  }
}

/**
 * Register the dictionaries, inject the panel toggles at order 40, and
 * contribute the Interface Settings rows.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-titlebar: dictionaries')
  const t = ctx.locale.bind(NS)

  // Desktop runtime: the panel chords are registry commands (single owner,
  // rebindable, region-gated). The DOM listener in PanelToggles stays as the
  // web fallback only.
  const panels: ShortcutBinding = { code: 'Backslash', modifiers: ['primary'] }
  const drawer: ShortcutBinding = { code: 'Backquote', modifiers: ['primary'] }
  ctx.effect(() => ctx.shortcuts.register({
    id: 'surfaces.toggle' as ShortcutCommandId, label: () => t('surfaces.toggle'),
    aliases: ['right panel', 'surfaces', 'right sidebar'],
    defaults: {
      'desktop:macos': panels, 'desktop:windows': panels, 'desktop:linux': panels,
    },
    regions: ['page'], modals: [],
    resolve: () => {
      const activePanelId = ctx.layout.panelInfo?.getSnapshot().activePanelId
      if (activePanelId === 'projects' && ctx.get('sidebarRight')?.isExpanded() !== true) {
        return { status: 'blocked', reason: t('surfaces.toggle') }
      }
      return { status: 'handled', run: () => { toggleSurfaces(ctx) } }
    },
  }), 'ui-titlebar: surfaces.toggle')
  ctx.effect(() => ctx.shortcuts.register({
    id: 'terminal.drawer.toggle' as ShortcutCommandId, label: () => t('terminal.toggle'),
    aliases: ['terminal drawer', 'terminal toggle'],
    defaults: {
      'desktop:macos': drawer, 'desktop:windows': drawer, 'desktop:linux': drawer,
    },
    regions: ['page', 'terminal'], modals: [],
    resolve: () => {
      const items = (ctx.get('workspaces') as { list?: { getSnapshot(): { items?: unknown[] } } } | undefined)
        ?.list?.getSnapshot().items
      if (items !== undefined && items.length === 0) {
        return { status: 'blocked', reason: t('terminal.toggle') }
      }
      return { status: 'handled', run: () => { ctx.layout.toggleTerminalDrawer() } }
    },
  }), 'ui-titlebar: terminal.drawer.toggle')

  const host = ctx.configForms.get<TitlebarSettings>(TITLEBAR_SETTINGS_NAMESPACE)
  const terminalChrome = new ChromeVisibility(host, TERMINAL_TOGGLE_FIELD)
  const surfacesChrome = new ChromeVisibility(host, SURFACES_TOGGLE_FIELD)

  ctx.slots.inject('shell.titlebar.trailing', () => ctx.slots.register({
    name: 'shell.titlebar.trailing',
    id: 'panel-toggles',
    order: 40,
    locale: NS,
    inject: (): PanelTogglesInjected => ({
      toggleSurfaces: () => { toggleSurfaces(ctx) },
      toggleTerminalDrawer: () => { ctx.layout.toggleTerminalDrawer() },
      hooks: {
        terminalToggle: terminalChrome.visible,
        surfacesToggle: surfacesChrome.visible,
      },
    }),
  }, PanelToggles))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'terminal-toggle',
    order: 30,
    locale: NS,
    inject: (): PanelToggleRowInjected => ({
      hooks: { visible: terminalChrome.visible, writable: terminalChrome.writable },
      setVisible: (value) => { terminalChrome.setVisible(value) },
    }),
  }, TerminalToggleRow))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'surfaces-toggle',
    order: 40,
    locale: NS,
    inject: (): PanelToggleRowInjected => ({
      hooks: { visible: surfacesChrome.visible, writable: surfacesChrome.writable },
      setVisible: (value) => { surfacesChrome.setVisible(value) },
    }),
  }, SurfacesToggleRow))
}
