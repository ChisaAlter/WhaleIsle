/**
 * The root entry's transient layout store: frame measurement, panel geometry
 * as plain widths in px (0 = closed), and the right column's presentation
 * reports. Module level exports the factory only — a module-level handle would
 * pin the store's identity in the module cache (a de-facto singleton surviving
 * plugin reloads). register() receives a shared instance wrapper, AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the same bound actions through the registration's store field.
 * Surfaces width and terminal-drawer height persist last-open sizes and whether
 * they were open, so reload and toggle restore the drag.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from './service.ts'
import {
  clampWidth, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO, RIGHTBAR_MIN,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT, SIDEBAR_DRAWER_BREAKPOINT, SIDEBAR_MAX, SIDEBAR_MIN,
  SURFACES_MAX, SURFACES_MIN, TERMINAL_DRAWER_MIN,
} from './columns.ts'
import { lastDrawerHeight, lastSurfacesWidth, readLayoutPersist, writeLayoutPersist } from './persist.ts'

/**
 * Transient layout preferences. Responsive concessions never rewrite widths;
 * the right panel's expanded state belongs to its occupant. `narrow` mirrors
 * AppFrame's landscape-aware breakpoint reading (viewport <
 * SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 */
type LayoutState = {
  panelInfo: {
    /** Null selects the Conversation; global panels keep the current Session intact. */
    activePanelId: MainPanelId | null
  }
  layoutInfo: LayoutInfo
}

type LayoutInfo = {
  sidebar: number
  /** Last positive frame measurement; window width bootstraps the first render. */
  viewportWidth: number
  /** True while AppFrame reads the frame as narrow (portrait below the breakpoint). */
  narrow: boolean
  narrowExpanded: boolean
  /** Far-right surfaces column width in px (0 = closed). */
  surfaces: number
  /** Terminal drawer height in px under the conversation column (0 = closed). */
  terminalDrawer: number
  /**
   * Saved right panel width in px, or null before its first opening. Resizing
   * the frame and closing the panel preserve this preference.
   */
  rightbar: number | null
  /**
   * Whether the right panel is drawn at all, in either presentation.
   *
   * Derived chrome, not a source of truth: whether the right surface is
   * expanded is a recorded fact owned by that surface, reported here so the
   * frame can place the panel's resize handle. The occupant reports it; nothing
   * else writes it.
   */
  rightbarShown: boolean
  /**
   * Whether the normal panel width reserves a grid track, including beneath
   * fullscreen. Reported by the occupant; always false while hidden.
   */
  rightbarTrack: boolean
  /** Reported fullscreen presentation; hides the outer resize handle. */
  rightbarFullscreen: boolean
  /** Suppress transitions for a fullscreen exit until another geometry action. */
  rightbarInstant: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  selectPanel: (draft: LayoutState, panelId: MainPanelId | null) => void
  retainMainPanels: (draft: LayoutState, panelIds: readonly string[]) => void
  setSidebar: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setViewportWidth: (draft: LayoutState, width: number) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  closeNarrowSidebar: (draft: LayoutState) => void
  setRightbar: (draft: LayoutState, px: number) => void
  openRightbar: (draft: LayoutState, track: boolean, fullscreen: boolean) => void
  closeRightbar: (draft: LayoutState) => void
  setSurfaces: (draft: LayoutState, px: number) => void
  toggleSurfaces: (draft: LayoutState) => void
  openSurfaces: (draft: LayoutState) => void
  closeSurfaces: (draft: LayoutState) => void
  toggleTerminalDrawer: (draft: LayoutState) => void
  setTerminalDrawer: (draft: LayoutState, px: number) => void
}

/**
 * Create the layout panel store handle. Sidebar and rightbar stay session-
 * transient. Surfaces width and terminal-drawer height persist last-open
 * sizes and whether they were open, so reload and toggle restore the drag.
 * For the sidebar the preference IS the width, so closing it forgets its drag
 * width — reopening restores the contract default. The right panel initializes
 * at 45% of the frame on first opening and keeps that px preference across
 * resizes and close. Drag writes clamp to the current frame's range. Narrow
 * sidebar toggles change only the expansion override; opening the right panel
 * clears that override.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => {
      const persisted = readLayoutPersist()
      return {
        panelInfo: { activePanelId: null },
        layoutInfo: {
          sidebar: SIDEBAR_DEFAULT,
          viewportWidth: window.innerWidth,
          narrow: window.innerWidth < SIDEBAR_AUTO_COLLAPSE,
          narrowExpanded: false,
          surfaces: persisted?.surfaces ?? 0,
          terminalDrawer: persisted?.terminalDrawer ?? 0,
          rightbar: typeof (window as Window & { shell?: { listDir?: unknown } }).shell?.listDir === 'function'
            ? lastSurfacesWidth() : null,
          rightbarShown: false,
          rightbarTrack: false,
          rightbarFullscreen: false,
          rightbarInstant: false,
        },
      }
    },
    actions: {
      selectPanel: (d, panelId: MainPanelId | null) => {
        d.panelInfo.activePanelId = panelId
        if (d.layoutInfo.viewportWidth < SIDEBAR_DRAWER_BREAKPOINT) d.layoutInfo.narrowExpanded = false
      },
      retainMainPanels: (d, panelIds: readonly string[]) => {
        if (d.panelInfo.activePanelId !== null && !panelIds.includes(d.panelInfo.activePanelId)) {
          d.panelInfo.activePanelId = null
        }
      },
      setSidebar: (d, px: number) => {
        d.layoutInfo.rightbarInstant = false
        d.layoutInfo.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX)
      },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        d.layoutInfo.rightbarInstant = false
        if (d.layoutInfo.narrow) d.layoutInfo.narrowExpanded = !d.layoutInfo.narrowExpanded
        else d.layoutInfo.sidebar = d.layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      // `narrow` re-derives here so callers that never report the
      // landscape-aware reading still get the viewport semantics.
      setViewportWidth: (d, width: number) => {
        if (d.layoutInfo.viewportWidth === width) return
        d.layoutInfo.rightbarInstant = false
        const wasNarrow = d.layoutInfo.viewportWidth < SIDEBAR_AUTO_COLLAPSE
        const narrow = width < SIDEBAR_AUTO_COLLAPSE
        const crossedDrawer = (d.layoutInfo.viewportWidth < SIDEBAR_DRAWER_BREAKPOINT) !== (width < SIDEBAR_DRAWER_BREAKPOINT)
        if (wasNarrow !== narrow || crossedDrawer) d.layoutInfo.narrowExpanded = false
        d.layoutInfo.narrow = narrow

        d.layoutInfo.viewportWidth = width
      },
      // Landscape rotates report a wide reading at a narrow viewport; changing
      // the reading drops the override the same way a breakpoint crossing does.
      setNarrow: (d, narrow: boolean) => {
        if (d.layoutInfo.narrow === narrow) return
        d.layoutInfo.rightbarInstant = false
        d.layoutInfo.narrow = narrow
        d.layoutInfo.narrowExpanded = false
      },
      // Session switch on phone/tablet: drop the overlay/re-expanded drawer
      // without rewriting the wide-window width preference.
      closeNarrowSidebar: (d) => { d.layoutInfo.narrowExpanded = false },
      setRightbar: (d, px: number) => {
        d.layoutInfo.rightbarInstant = false
        d.layoutInfo.rightbar = clampWidth(px, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, d.layoutInfo.viewportWidth * RIGHTBAR_MAX_RATIO))
        if (typeof (window as Window & { shell?: { listDir?: unknown } }).shell?.listDir === 'function') {
          writeLayoutPersist({ lastSurfaces: d.layoutInfo.rightbar })
        }
      },
      openRightbar: (d, track: boolean, fullscreen: boolean) => {
        if (!d.layoutInfo.rightbarShown || d.layoutInfo.rightbarTrack !== track || d.layoutInfo.rightbarFullscreen !== fullscreen) {
          d.layoutInfo.rightbarInstant = d.layoutInfo.rightbarFullscreen && !fullscreen
        }
        if (!d.layoutInfo.rightbarShown && d.layoutInfo.narrow) d.layoutInfo.narrowExpanded = false
        d.layoutInfo.rightbar ??= Math.max(RIGHTBAR_MIN, Math.round(d.layoutInfo.viewportWidth * RIGHTBAR_DEFAULT_RATIO))
        d.layoutInfo.rightbarShown = true
        d.layoutInfo.rightbarTrack = track
        d.layoutInfo.rightbarFullscreen = fullscreen
      },
      closeRightbar: (d) => {
        if (d.layoutInfo.rightbarShown) d.layoutInfo.rightbarInstant = d.layoutInfo.rightbarFullscreen
        d.layoutInfo.rightbarShown = false
        d.layoutInfo.rightbarTrack = false
        d.layoutInfo.rightbarFullscreen = false
      },
      setSurfaces: (d, px: number) => {
        d.layoutInfo.surfaces = clampWidth(px, SURFACES_MIN, SURFACES_MAX)
        writeLayoutPersist({ surfaces: d.layoutInfo.surfaces, lastSurfaces: d.layoutInfo.surfaces })
      },
      toggleSurfaces: (d) => {
        d.layoutInfo.surfaces = d.layoutInfo.surfaces === 0 ? lastSurfacesWidth() : 0
        writeLayoutPersist({
          surfaces: d.layoutInfo.surfaces,
          ...(d.layoutInfo.surfaces > 0 ? { lastSurfaces: d.layoutInfo.surfaces } : {}),
        })
      },
      openSurfaces: (d) => {
        if (d.layoutInfo.surfaces === 0) d.layoutInfo.surfaces = lastSurfacesWidth()
        writeLayoutPersist({ surfaces: d.layoutInfo.surfaces, lastSurfaces: d.layoutInfo.surfaces })
      },
      closeSurfaces: (d) => {
        d.layoutInfo.surfaces = 0
        writeLayoutPersist({ surfaces: 0 })
      },
      toggleTerminalDrawer: (d) => {
        d.layoutInfo.terminalDrawer = d.layoutInfo.terminalDrawer === 0 ? lastDrawerHeight() : 0
        writeLayoutPersist({
          terminalDrawer: d.layoutInfo.terminalDrawer,
          ...(d.layoutInfo.terminalDrawer > 0 ? { lastDrawer: d.layoutInfo.terminalDrawer } : {}),
        })
      },
      // Floor only: the drawer has no contract ceiling; 0 is reserved for close.
      setTerminalDrawer: (d, px: number) => {
        d.layoutInfo.terminalDrawer = Math.max(TERMINAL_DRAWER_MIN, Math.round(px))
        writeLayoutPersist({ terminalDrawer: d.layoutInfo.terminalDrawer, lastDrawer: d.layoutInfo.terminalDrawer })
      },
    },
  })
  return handle
}
