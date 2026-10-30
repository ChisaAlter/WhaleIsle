/**
 * Sidebar slot contract: the registrant-side props composition for the
 * layout-owned `sidebar` slot, plus the holes this shell declares. The shell
 * owns column geometry (fold state machine, brand row, New Session), the
 * region tab strip when plugins occupy `sidebar.nav.tab`, and global panel
 * rows. Everything between the workspace section header and the list bottom is
 * the `sidebar.workspaces` registrant's (ui-workspace) while the sessions tab
 * is selected; a plugin tab swaps that region for `sidebar.page`. The foot is
 * the `sidebar.settings` registrant's (ui-settings), followed by optional
 * footer actions in `sidebar.footer.action`.
 */
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'sidebar' entry) and its
// main-panel ids into every program that sees this contract, so
// PropsRuntime<'sidebar'> resolves.
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createSidebarNavStore, SidebarNavTabRow } from '../stores.ts'
import type { ProductEventMap } from '@deepseek-ai/dsh-client-product-analytics/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Non-interactive notification inside the collapsed sidebar expand button. */
    'sidebar.toggle.badge': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    /**
     * Brand mark rendered in the expanded brand row and collapsed rail.
     * Declared by this package's `sidebar` entry; deployments may replace
     * the shell's fish fallback without replacing the surrounding controls.
     */
    'sidebar.brand.mark': { kind: 'single'; scope: 'root'; owner: SidebarBrandMarkOwnerProps }
    /**
     * Brand name rendered beside the expanded mark. Declared by this
     * package's `sidebar` entry; the shell supplies a generic text fallback.
     */
    'sidebar.brand.name': { kind: 'single'; scope: 'root'; owner: SidebarBrandNameOwnerProps }
    /**
     * Global panel icons. Each list id addresses the matching main panel;
     * the sidebar owns the button and resolves its label from list metadata.
     */
    'sidebar.panellist': { kind: 'list'; scope: 'root'; owner: SidebarPanelIconOwnerProps }
    /** Rows of the panel list's More menu; the sidebar shows More only while this list has registrations. */
    'sidebar.panellist.actions': { kind: 'list'; scope: 'root'; owner: SidebarPanelActionsOwnerProps }
    /**
     * The workspace/session browsing region: section header, search, the
     * grouped/flat session list, and every workspace dialog. Declared by this
     * package's 'sidebar' entry (declaring is claiming); ui-workspace
     * registers the browser. Hidden while a plugin region tab is selected.
     */
    'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }
    /**
     * Additive region tabs. Occupancy is the only signal that draws the tab
     * strip; zero entries keep the shipped chrome (New Session + workspaces)
     * with no extra controls. Options: `id` (tab key, also the `sidebar.page`
     * entryKey), `order`, `label`.
     */
    'sidebar.nav.tab': { kind: 'list'; scope: 'root'; owner: SidebarNavTabOwnerProps }
    /**
     * Plugin region page keyed by the matching `sidebar.nav.tab` id. Rendered
     * only while that tab is selected; the sessions tab keeps `sidebar.workspaces`.
     */
    'sidebar.page': { kind: 'keyed'; scope: 'root'; owner: SidebarPageOwnerProps }
    /**
     * The settings seat at the sidebar foot. Declared by this package's
     * 'sidebar' entry; ui-settings registers its trigger row + modal panel.
     * The sidebar passes only its column state — it holds no settings state.
     */
    'sidebar.settings': { kind: 'single'; scope: 'root'; owner: SidebarSettingsOwnerProps }
    /**
     * Optional actions beside Settings at the sidebar foot. Declared by this
     * package's 'sidebar' entry; each action receives only the column state.
     */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
  }
}

/** Geometry supplied to the sidebar brand-mark occupant. */
export interface SidebarBrandMarkOwnerProps {
  /** Requested square edge in pixels. */
  size: number
}

/** Empty owner share for the sidebar brand-name occupant. */
export interface SidebarBrandNameOwnerProps {
  /** Marker field: the occupant owns its own content and width. */
  children?: never
}

/** Icon presentation supplied by the global panel row. */
export interface SidebarPanelIconOwnerProps {
  /** Requested square edge in pixels. */
  size: number
  /** Whether this panel is selected in the main column. */
  active: boolean
}

/** Serializable metadata for one active global panel list registration. */
export interface SidebarPanelMetadata {
  /** List id and matching main panel key. */
  id: MainPanelId
  /** Ascending row order; ties retain registration order. */
  order: number
  /** Row title and accessible name: resolved label, or the id when omitted. */
  label: string
}

/** One customizable panel launcher listed in the More menu. */
export interface SidebarPanelActionEntry {
  /** Panel id. */
  readonly id: string
  /** Resolved panel label. */
  readonly label: string
  /** False while the launcher is unpinned from the sidebar. */
  readonly pinned: boolean
  /** Whether this panel is selected, independently of its pin state. */
  readonly active?: boolean
}

/** Owner share of the panel list's More menu rows. */
export interface SidebarPanelActionsOwnerProps {
  /** Customizable panels in registration order; Plugins is never listed. */
  readonly entries: readonly SidebarPanelActionEntry[]
  /**
   * Open a panel without changing its pin state.
   * @param id - Listed panel id.
   */
  readonly onOpen: (id: string) => void
  /**
   * Show (true) or unpin (false) a panel launcher.
   * @param id - Listed panel id.
   * @param pinned - Whether the launcher shows in the sidebar.
   */
  readonly onPinnedChange: (id: string, pinned: boolean) => void
  /** Close the More menu. */
  readonly onDismiss: () => void
}

/**
 * Owner share of the browser hole — the only facts crossing the shell/region
 * boundary. Business data and actions arrive through the region's own inject.
 */
export interface SidebarSectionOwnerProps {
  /** Shell fold-state output: wide renders the full browser, rail the icon column. */
  wide: boolean
  /** Rail icons request expansion; the browser rides the wide flip for focus. */
  expandSidebar: () => void
}

/**
 * Owner share of a plugin region tab's metadata occupancy. The shell draws
 * the strip from registration options; tab components are not mounted.
 */
export interface SidebarNavTabOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * Owner share of a plugin region page — the same column facts the workspace
 * browser receives, so a page can offer rail icons while collapsed.
 */
export interface SidebarPageOwnerProps {
  /** Shell fold-state output: wide renders the full page, rail the icon column. */
  wide: boolean
  /** Rail icons request expansion; the page rides the wide flip for focus. */
  expandSidebar: () => void
}

/**
 * Owner share of the sidebar settings seat: the column display state the
 * occupant's trigger row must render against (wide row vs rail icon).
 */
export interface SidebarSettingsOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Owner share of an action rendered beside Settings at the sidebar foot. */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * Registrant-private injected share (arrives via the register inject
 * factory). The shell keeps starting a Session, toggling the column, and the
 * projected plugin-tab occupancy source; the renderer binds the panel
 * metadata source to usePanels.
 */
export type SidebarRootInjected = {
  /**
   * Start a New Session: with a workspace, reuse-or-create its blank session
   * and open it; without one, inherit the current Session Workspace, then the
   * recent Workspace, or clear into the New Session pure view when none exist.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
  /** Select the global panel addressed by a sidebar row. */
  selectPanel: (id: MainPanelId) => void
  /**
   * Show or unpin one panel launcher; Plugins is ignored.
   * @param id - Panel id.
   * @param pinned - Whether the launcher shows in the sidebar.
   */
  setPinned: (id: string, pinned: boolean) => void
  /** Record activation of an official navigation control without changing navigation. */
  trackEntryClick: (attributes: ProductEventMap['sidebar_menu_click']) => void
  /** Private reactive sources bound to framework selector hooks. */
  hooks: {
    /** `sidebar.nav.tab` ledger projected into ordered strip rows. */
    navTabs: HostObservable<readonly SidebarNavTabRow[]>
    /** Global panel metadata rows bound to usePanels. */
    panels: ObservableSnapshot<readonly SidebarPanelMetadata[]>
    /** Shortcut catalog rows bound to useShortcuts. */
    shortcuts: ObservableSnapshot<readonly ShortcutCatalogEntry[]>
    /** Ids of unpinned panel launchers held in memory until plugin reload. */
    entryPins: ObservableSnapshot<readonly string[]>
    /** Whether `sidebar.panellist.actions` has registrations. */
    entryActions: ObservableSnapshot<boolean>
  }
}

/**
 * Full component props: layout owner state/actions, the declared holes'
 * render shares, the region-tab store, injected callbacks, and the locale
 * seat. Panel metadata arrives through an injected observable.
 */
export type SidebarRootComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<
    | 'sidebar.brand.mark'
    | 'sidebar.brand.name'
    | 'sidebar.toggle.badge'
    | 'sidebar.panellist'
    | 'sidebar.panellist.actions'
    | 'sidebar.workspaces'
    | 'sidebar.nav.tab'
    | 'sidebar.page'
    | 'sidebar.settings'
    | 'sidebar.footer.action'
  >
  & PropsStore<ReturnType<typeof createSidebarNavStore>>
  & InjectFace<SidebarRootInjected>
  & PropsLocale<'sidebar'>
