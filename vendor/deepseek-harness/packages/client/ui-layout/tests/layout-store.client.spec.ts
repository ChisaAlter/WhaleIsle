// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamps
 * inside actions), main-panel selection, the rightbar presentation reports,
 * the narrow-sidebar override, and surfaces/drawer persistence. Uses the
 * test-sanctioned path: factory self-call + .create() gives the real engine
 * instance (same create path as production).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLayoutStore } from '../src/client/stores.ts'
import { LAYOUT_PERSIST_KEY } from '../src/client/persist.ts'
import { SIDEBAR_DEFAULT, SURFACES_DEFAULT, SURFACES_MAX, SURFACES_MIN, TERMINAL_DRAWER_MIN } from '../src/client/columns.ts'
import type { MainPanelId } from '../src/client/service.ts'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('innerWidth', 1920)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('createLayoutStore', () => {
  it('starts with the default sidebar, no right panel preference, and closed surfaces/drawer', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({
      panelInfo: { activePanelId: null },
      layoutInfo: {
        sidebar: SIDEBAR_DEFAULT,
        viewportWidth: 1920,
        narrow: false,
        narrowExpanded: false,
        surfaces: 0,
        terminalDrawer: 0,
        rightbar: null,
        rightbarShown: false,
        rightbarTrack: false,
        rightbarFullscreen: false,
        rightbarInstant: false,
      },
    })
  })

  it('creates independent instances without browser persistence', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    a.actions.openRightbar(true, false)
    expect(b.store.getSnapshot().layoutInfo.sidebar).toBe(280)
    expect(b.store.getSnapshot().layoutInfo.rightbar).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('clamps the sidebar to 264–420px', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().layoutInfo.sidebar).toBe(264)
    actions.setSidebar(9999)
    expect(store.getSnapshot().layoutInfo.sidebar).toBe(420)
  })

  it('toggles the wide sidebar between closed and default width', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo.sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo.sidebar).toBe(280)
  })

  it('keeps the sidebar preference while toggling its narrow override', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setViewportWidth(980)
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo).toMatchObject({ sidebar: 400, viewportWidth: 980, narrowExpanded: true })
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo).toMatchObject({ sidebar: 400, narrowExpanded: false })
  })

  it('clears the manual override only when crossing 1024px', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setViewportWidth(980)
    actions.toggleSidebar()
    actions.setViewportWidth(980)
    actions.setViewportWidth(1023)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(true)
    actions.setViewportWidth(1024)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
    actions.setViewportWidth(980)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
  })

  it('takes a landscape-aware narrow reading from the frame and drops the override on a change', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    // A portrait phone reports a narrow reading at a phone-width viewport.
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo).toMatchObject({ sidebar: 400, narrow: true, narrowExpanded: true })
    // Rotating to landscape reports a wide reading: the override drops and the
    // toggle flips the width preference again.
    actions.setNarrow(false)
    expect(store.getSnapshot().layoutInfo).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo).toMatchObject({ sidebar: 0, narrowExpanded: false })
    actions.toggleSidebar()
    // A viewport crossing re-derives the reading and drops the override.
    actions.setViewportWidth(800)
    expect(store.getSnapshot().layoutInfo).toMatchObject({ narrow: true, viewportWidth: 800 })
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(true)
    actions.closeNarrowSidebar()
    expect(store.getSnapshot().layoutInfo).toMatchObject({ sidebar: 280, narrow: true, narrowExpanded: false })
  })
})

describe('main panel selection', () => {
  const panelA = 'panel-a' as MainPanelId
  const panelB = 'panel-b' as MainPanelId

  it('changes only panelInfo when switching panels and returning to the Conversation', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.openRightbar(true, true)
    actions.closeRightbar()
    const layoutInfo = store.getSnapshot().layoutInfo
    for (const activePanelId of [panelA, panelB, null]) {
      const previousPanelInfo = store.getSnapshot().panelInfo
      actions.selectPanel(activePanelId)
      expect(store.getSnapshot().panelInfo).toEqual({ activePanelId })
      expect(store.getSnapshot().panelInfo).not.toBe(previousPanelInfo)
      expect(store.getSnapshot().layoutInfo).toBe(layoutInfo)
    }
  })

  it('keeps the complete snapshot when selecting the current panel again', () => {
    const { store, actions } = createLayoutStore().create()
    actions.selectPanel(panelA)
    const selected = store.getSnapshot()
    actions.selectPanel(panelA)
    expect(store.getSnapshot()).toBe(selected)
    expect(store.getSnapshot().panelInfo.activePanelId).toBe(panelA)
  })

  it('returns to the Conversation only when the selected main registration disappears', () => {
    const { store, actions } = createLayoutStore().create()
    const initial = store.getSnapshot()
    actions.retainMainPanels([])
    expect(store.getSnapshot()).toBe(initial)
    actions.selectPanel(panelA)
    const selected = store.getSnapshot()
    actions.retainMainPanels(['conversation', panelA, panelB])
    expect(store.getSnapshot()).toBe(selected)
    actions.retainMainPanels(['conversation', panelB])
    expect(store.getSnapshot().panelInfo).toEqual({ activePanelId: null })
    expect(store.getSnapshot().layoutInfo).toBe(selected.layoutInfo)
  })

  it.each(['setSidebar', 'toggleSidebar', 'setViewportWidth', 'setRightbar', 'openRightbar', 'closeRightbar'] as const)(
    'preserves panelInfo identity when %s changes layoutInfo', (action) => {
      const { store, actions } = createLayoutStore().create()
      actions.selectPanel(panelA)
      if (action === 'closeRightbar') actions.openRightbar(true, true)
      const previous = store.getSnapshot()
      switch (action) {
        case 'setSidebar': actions.setSidebar(400); break
        case 'toggleSidebar': actions.toggleSidebar(); break
        case 'setViewportWidth': actions.setViewportWidth(980); break
        case 'setRightbar': actions.setRightbar(500); break
        case 'openRightbar': actions.openRightbar(true, true); break
        case 'closeRightbar': actions.closeRightbar(); break
      }
      expect(store.getSnapshot().panelInfo).toBe(previous.panelInfo)
      expect(store.getSnapshot().layoutInfo).not.toBe(previous.layoutInfo)
    },
  )
})

describe('right panel', () => {
  it('initializes at 45% of the latest frame only on first opening', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setViewportWidth(1000)
    expect(store.getSnapshot().layoutInfo.rightbar).toBeNull()
    actions.openRightbar(true, false)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(450)
    actions.setViewportWidth(2000)
    actions.openRightbar(true, true)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(450)
    actions.closeRightbar()
    actions.openRightbar(true, false)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(450)
  })

  it('keeps track and fullscreen reports independent and clears both on close', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar(true, false)
    expect(store.getSnapshot().layoutInfo).toMatchObject({ rightbarShown: true, rightbarTrack: true, rightbarFullscreen: false })
    actions.openRightbar(true, true)
    expect(store.getSnapshot().layoutInfo).toMatchObject({ rightbarShown: true, rightbarTrack: true, rightbarFullscreen: true })
    actions.openRightbar(false, true)
    expect(store.getSnapshot().layoutInfo).toMatchObject({ rightbarShown: true, rightbarTrack: false, rightbarFullscreen: true })
    actions.closeRightbar()
    expect(store.getSnapshot().layoutInfo).toMatchObject({ rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false })
  })

  it('keeps dragged px preferences across resize, close, and reopen', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar(true, false)
    actions.setRightbar(1100)
    actions.setViewportWidth(800)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(1100)
    actions.closeRightbar()
    actions.openRightbar(false, true)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(1100)
  })

  it('clamps drag preferences to 300px and 70% of the current frame', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setViewportWidth(1600)
    actions.setRightbar(9999)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(1120)
    actions.setViewportWidth(1000)
    actions.setRightbar(9999)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(700)
    actions.setRightbar(1)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(300)
  })

  it('retains a minimum normal preference when first opened fullscreen on a phone', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setViewportWidth(320)
    actions.openRightbar(false, true)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(300)
  })

  it('collapses a manually expanded narrow sidebar on opening, not presentation reports', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setViewportWidth(800)
    actions.toggleSidebar()
    actions.openRightbar(true, false)
    expect(store.getSnapshot().layoutInfo).toMatchObject({ sidebar: 400, narrowExpanded: false })
    actions.toggleSidebar()
    actions.openRightbar(true, true)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(true)
    actions.closeRightbar()
    actions.openRightbar(true, false)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
  })

  it('keeps the wide sidebar preference and never opens a closed right panel on resize', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(420)
    actions.openRightbar(true, false)
    expect(store.getSnapshot().layoutInfo.sidebar).toBe(420)
    actions.closeRightbar()
    actions.setViewportWidth(3000)
    expect(store.getSnapshot().layoutInfo).toMatchObject({ sidebar: 420, rightbarShown: false, rightbarTrack: false })
  })
})

describe('right panel instant geometry', () => {
  it.each([true, false])('closes fullscreen with track=%s in one instant update and retains repeated close reports', (track) => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar(track, true)
    actions.closeRightbar()
    expect(store.getSnapshot().layoutInfo).toMatchObject({
      rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false, rightbarInstant: true,
    })
    const closed = store.getSnapshot()
    actions.closeRightbar()
    expect(store.getSnapshot()).toBe(closed)
  })

  it('restores the normal track instantly, retaining the marker on an identical report', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar(true, true)
    actions.openRightbar(true, false)
    expect(store.getSnapshot().layoutInfo).toMatchObject({
      rightbarShown: true, rightbarTrack: true, rightbarFullscreen: false, rightbarInstant: true,
    })
    const restored = store.getSnapshot()
    actions.openRightbar(true, false)
    expect(store.getSnapshot()).toBe(restored)
    actions.openRightbar(false, false)
    expect(store.getSnapshot().layoutInfo.rightbarInstant).toBe(false)
  })

  it('allows a normal close to animate, including after restoring from fullscreen', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar(true, false)
    actions.closeRightbar()
    expect(store.getSnapshot().layoutInfo.rightbarInstant).toBe(false)
    actions.openRightbar(true, true)
    actions.openRightbar(true, false)
    expect(store.getSnapshot().layoutInfo.rightbarInstant).toBe(true)
    actions.closeRightbar()
    expect(store.getSnapshot().layoutInfo).toMatchObject({ rightbarTrack: false, rightbarInstant: false })
  })

  it.each(['setSidebar', 'toggleSidebar', 'setRightbar', 'setViewportWidth'] as const)('clears instant geometry on %s', (action) => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar(true, true)
    actions.closeRightbar()
    expect(store.getSnapshot().layoutInfo.rightbarInstant).toBe(true)
    if (action === 'toggleSidebar') actions.toggleSidebar()
    else actions[action](action === 'setViewportWidth' ? 1800 : 350)
    expect(store.getSnapshot().layoutInfo.rightbarInstant).toBe(false)
    actions.closeRightbar()
    expect(store.getSnapshot().layoutInfo.rightbarInstant).toBe(false)
  })

  it('does not let an unchanged frame measurement reset the fullscreen-exit marker', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar(true, true)
    actions.closeRightbar()
    const closed = store.getSnapshot()
    actions.setViewportWidth(closed.layoutInfo.viewportWidth)
    expect(store.getSnapshot()).toBe(closed)
  })

  it.each([true, false])('clears the exit marker on a fresh opening with fullscreen=%s', (fullscreen) => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar(true, true)
    actions.closeRightbar()
    actions.openRightbar(true, fullscreen)
    expect(store.getSnapshot().layoutInfo).toMatchObject({ rightbarShown: true, rightbarFullscreen: fullscreen, rightbarInstant: false })
  })
})

describe('surfaces column and terminal drawer', () => {
  it('setSurfaces clamps into the contract range', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSurfaces(1)
    expect(store.getSnapshot().layoutInfo.surfaces).toBe(SURFACES_MIN)
    actions.setSurfaces(9999)
    expect(store.getSnapshot().layoutInfo.surfaces).toBe(SURFACES_MAX)
  })

  it('openSurfaces uses the contract default, preserves an open width, and closeSurfaces zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openSurfaces()
    expect(store.getSnapshot().layoutInfo.surfaces).toBe(SURFACES_DEFAULT)
    actions.setSurfaces(500)
    actions.openSurfaces()
    expect(store.getSnapshot().layoutInfo.surfaces).toBe(500)
    actions.closeSurfaces()
    expect(store.getSnapshot().layoutInfo.surfaces).toBe(0)
  })

  it('toggleSurfaces restores the last drag width instead of the contract default', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSurfaces(500)
    actions.toggleSurfaces()
    expect(store.getSnapshot().layoutInfo.surfaces).toBe(0)
    actions.toggleSurfaces()
    expect(store.getSnapshot().layoutInfo.surfaces).toBe(500)
  })

  it('toggleTerminalDrawer restores the last drag height', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setTerminalDrawer(360)
    actions.toggleTerminalDrawer()
    expect(store.getSnapshot().layoutInfo.terminalDrawer).toBe(0)
    actions.toggleTerminalDrawer()
    expect(store.getSnapshot().layoutInfo.terminalDrawer).toBe(360)
  })

  it('setTerminalDrawer clamps to the floor and never writes closed', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setTerminalDrawer(1)
    expect(store.getSnapshot().layoutInfo.terminalDrawer).toBe(TERMINAL_DRAWER_MIN)
    actions.setTerminalDrawer(480)
    expect(store.getSnapshot().layoutInfo.terminalDrawer).toBe(480)
  })

  it('persists surfaces and drawer sizes and hydrates them on the next create', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openRightbar(true, false)
    first.actions.setRightbar(500)
    first.actions.setSurfaces(500)
    first.actions.setTerminalDrawer(320)
    expect(localStorage.getItem(LAYOUT_PERSIST_KEY)).not.toBeNull()

    const second = createLayoutStore().create()
    expect(second.store.getSnapshot().layoutInfo).toMatchObject({
      sidebar: SIDEBAR_DEFAULT,
      surfaces: 500,
      terminalDrawer: 320,
      narrowExpanded: false,
      rightbar: null,
      rightbarShown: false,
    })
  })
})

describe('drawer navigation', () => {
  it.each(['plugins' as MainPanelId, null])('closes the narrow drawer on navigation to %s', (panel) => {
    const { store, actions } = createLayoutStore().create()
    actions.setViewportWidth(390)
    actions.toggleSidebar()
    actions.selectPanel(panel)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
  })

  it('keeps a tablet sidebar open when navigating', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setViewportWidth(768)
    actions.toggleSidebar()
    actions.selectPanel(null)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(true)

  })
})
