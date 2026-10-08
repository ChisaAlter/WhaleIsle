// @vitest-environment jsdom
/** Files guide and restored viewer tabs through the production Sidebar slot chain. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { apply as applySidebar, inject as sidebarInject } from '../../ui-sidebar-right/src/client/index.ts'
import { readSidebarLayout, sidebarPersistence } from '../../ui-sidebar-right/src/client/persistence.ts'
import type { createSidebarRightStore, SurfaceState } from '../../ui-sidebar-right/src/client/stores.ts'
import { apply, inject } from '../src/client/index.ts'
import { DesktopFileState } from '../src/client/desktop-file-state.ts'
import type { FilesShellInjected } from '../src/client/shell.ts'

const OWN = 'owning-session' as SessionId
const OTHER = 'other-session' as SessionId
const ADDRESS = fileAddressFor(OWN, '/tmp/owning', 'src/a.ts')
const runtimes: SlotTestRuntime[] = []
let animations: PropertyDescriptor | undefined
usePinnedBrowserLanguages('en-US')

beforeEach(() => {
  localStorage.clear()
  animations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })
})

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  delete (window as Window & { shell?: unknown }).shell
  if (animations === undefined) Reflect.deleteProperty(Element.prototype, 'getAnimations')
  else Object.defineProperty(Element.prototype, 'getAnimations', animations)
  localStorage.clear()
})

function saveLegacy(address = 'sidebar://desktop-file', floating = false): void {
  const saved = {
    bySession: { [OWN]: {
      minted: 5,
      layout: {
        nodes: {
          pane1: { id: 'pane1', kind: 'pane', host: 'dock', tabs: floating ? ['tab3'] : ['tab2', 'tab3'], activeTabId: floating ? 'tab3' : 'tab2' },
          ...floating ? { float4: { id: 'float4', kind: 'pane', host: 'float', tabs: ['tab2'], activeTabId: 'tab2', rect: { x: 10, y: 20, width: 480, height: 600 } } } : {},
        },
        tabs: {
          tab2: { id: 'tab2', kind: 'desktop-file', contentId: address, title: address },
          tab3: { id: 'tab3', kind: 'desktop-file', contentId: ADDRESS, title: 'a.ts' },
        },
        rootId: 'pane1', floats: floating ? ['float4'] : [], activePaneId: 'pane1', expanded: false, mode: 'push',
      },
    } },
  }
  localStorage.setItem(`${sidebarPersistence}.${OWN}`, JSON.stringify(saved))
}

async function mountFiles(options: { missingCwd?: boolean; workingDirectory?: string } = {}) {
  const ipc = {
    listDir: vi.fn<FilesShellInjected['listDir']>(async () => ({ ok: true, entries: [{ name: 'notes.txt', kind: 'file' }] })),
    readFile: vi.fn<FilesShellInjected['readFile']>(async () => ({ ok: true, text: 'disk', binary: false })),
    readFileMedia: vi.fn<FilesShellInjected['readFileMedia']>(async () => ({ ok: false })),
    writeFile: vi.fn<FilesShellInjected['writeFile']>(async () => ({ ok: true })),
  }
  ;(window as Window & { shell?: typeof ipc }).shell = ipc
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  runtime.ctx.provide('layout', { openRightbar: vi.fn(), closeRightbar: vi.fn(), closeSurfaces: vi.fn(), panelInfo: runtime.panelInfo } as never)
  runtime.ctx.provide('resources', { pin: vi.fn() } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('shortcuts', { register: () => () => {}, catalog: createSnapshotStore<readonly ShortcutCatalogEntry[]>([]) } as never)
  await runtime.declare({
    rightbar: { kind: 'single', scope: 'root' },
    'conversation.session.header.corner': { kind: 'single', scope: 'session' },
  })
  await runtime.sessions.add({ id: OWN, summary: options.missingCwd ? {} : { cwd: '/tmp/owning', ...(options.workingDirectory === undefined ? {} : {
    presentation: { owner: 'project', title: 'Project', workingDirectory: options.workingDirectory },
  }) } })
  await runtime.sessions.add({ id: OTHER, summary: { cwd: '/tmp/other' } })
  let reference = runtime.sessions.retainFor(runtime.ctx, OWN, { source: 'mainView' })
  await runtime.mount({ inject: [...sidebarInject], apply: applySidebar })
  const controller = runtime.ctx.sidebarRight
  const openPath = vi.fn(async (path: string, options: { sessionId: string }) => {
    const id = options.sessionId as SessionId
    const cwd = sessionWorkingDirectory(runtime.sessions.list.getSnapshot().byId[id])
    controller.openResourceIn(id, fileAddressFor(id, cwd, path))
  })
  Object.assign(runtime.workspaces, { openPath })
  await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderSlot('rightbar', { width: 420, viewportWidth: 1440, canShow: true })
  const instance = runtime.storeOf('rightbar.session', reference) as ReturnType<ReturnType<typeof createSidebarRightStore>['create']>
  const surface = (): SurfaceState => instance.getSnapshot().bySession[OWN]!
  const selectOther = (): void => {
    const next = runtime.sessions.retainFor(runtime.ctx, OTHER, { source: 'mainView' })
    reference.release()
    reference = next
  }
  return { runtime, controller, instance, surface, view, ipc, openPath, selectOther }
}

describe('Files registration and restored addresses', () => {
  it('browses and opens the bound Project directory while its coordinator keeps a separate execution cwd', async () => {
    const h = await mountFiles({ workingDirectory: '/tmp/project-workspace' })
    await act(async () => { h.controller.openTab('guide') })
    const entry = h.view.container.querySelector<HTMLButtonElement>('[data-sidebar-right-guide-entry="files"]')
    if (entry === null) throw new Error('the registered Files guide entry did not render')
    fireEvent.click(entry)
    fireEvent.click(await h.view.view.findByRole('button', { name: /notes.txt/ }))
    await h.view.view.findByLabelText('notes.txt')
    expect(h.ipc.listDir).toHaveBeenCalledWith('/tmp/project-workspace', '')
    expect(h.openPath).toHaveBeenCalledExactlyOnceWith('/tmp/project-workspace/notes.txt', { sessionId: OWN })
    expect(h.ipc.readFile).toHaveBeenCalledExactlyOnceWith('/tmp/project-workspace', 'notes.txt')
    expect(h.runtime.sessions.list.getSnapshot().byId[OWN]?.cwd).toBe('/tmp/owning')
  })

  it('offers one Files guide entry and opens its chosen file through the keyed resource body', async () => {
    const h = await mountFiles()
    await act(async () => { h.controller.openTab('guide') })
    expect(h.runtime.ctx.sidebarRightTabs.guide().map(entry => entry.kind)).toEqual(['files'])
    const entry = h.view.container.querySelector<HTMLButtonElement>('[data-sidebar-right-guide-entry="files"]')
    if (entry === null) throw new Error('the registered Files guide entry did not render')
    fireEvent.click(entry)
    expect(Object.values(h.surface().layout.tabs).map(tab => [tab.kind, tab.contentId, tab.title])).toMatchInlineSnapshot(`
      [
        [
          "files",
          "sidebar://files",
          "Files",
        ],
      ]
    `)
    expect(h.ipc.readFile).not.toHaveBeenCalled()
    expect(h.ipc.readFileMedia).not.toHaveBeenCalled()
    fireEvent.click(await h.view.view.findByRole('button', { name: /notes.txt/ }))
    await h.view.view.findByLabelText('notes.txt')
    expect(h.openPath).toHaveBeenCalledExactlyOnceWith('/tmp/owning/notes.txt', { sessionId: OWN })
    expect(h.ipc.readFile).toHaveBeenCalledExactlyOnceWith('/tmp/owning', 'notes.txt')
    expect(h.controller.active()).toMatchObject({ kind: 'desktop-file', contentId: fileAddressFor(OWN, '/tmp/owning', 'notes.txt') })
  })

  it.each([
    'sidebar://desktop-file', 'sidebar://other-page', 'not-an-address',
    'dsh-resource://file/session/owning-session/%ZZ',
    'dsh-resource://file/absolute/tmp/a.txt', 'dsh-resource://file/session/owning-session/',
  ])('restores %s as the owning directory without file IO or layout mutation', async (address) => {
    saveLegacy(address)
    const h = await mountFiles()
    const restored = readSidebarLayout(OWN)
    expect(restored).toBeDefined()
    const before = h.surface().layout
    expect(before).toEqual(restored!.layout)
    expect(before.expanded).toBe(false)
    await act(async () => { h.controller.toggleExpanded() })
    const expanded = h.surface().layout
    await h.view.view.findByRole('button', { name: /notes.txt/, hidden: true })
    expect(h.view.view.queryByText(address)).toBeNull()
    expect(h.ipc.listDir).toHaveBeenCalledWith('/tmp/owning', '')
    expect(h.ipc.readFile).not.toHaveBeenCalled()
    expect(h.ipc.readFileMedia).not.toHaveBeenCalled()
    expect(h.ipc.writeFile).not.toHaveBeenCalled()
    expect(h.surface().layout).toBe(expanded)
    await act(async () => { h.selectOther() })
    expect(h.surface().layout).toBe(expanded)
    expect(h.ipc.listDir).not.toHaveBeenCalledWith('/tmp/other', '')
  })

  it('keeps a restored floating directory, collapsed state, valid resource tab and its draft', async () => {
    saveLegacy('sidebar://desktop-file', true)
    const state = new DesktopFileState()
    state.write(ADDRESS, { text: 'disk', draft: 'recovered edit' })
    const h = await mountFiles()
    const before = h.surface().layout
    await h.view.view.findByRole('button', { name: /notes.txt/, hidden: true })
    expect(h.surface().layout).toBe(before)
    expect(before.expanded).toBe(false)
    expect(before.floats).toEqual(['float4'])
    expect(h.view.container.querySelector('[data-dockkit-float="float4"]')).not.toBeNull()
    expect(Object.values(before.tabs).find(tab => tab.id === 'tab3')).toMatchObject({ kind: 'desktop-file', contentId: ADDRESS })
    expect(new DesktopFileState().read(ADDRESS)?.draft).toBe('recovered edit')
    expect(h.ipc.readFile).not.toHaveBeenCalled()
    expect(h.ipc.readFileMedia).not.toHaveBeenCalled()
    expect(h.ipc.writeFile).not.toHaveBeenCalled()
    await act(async () => { h.selectOther() })
    expect(h.surface().layout).toBe(before)
  })

  it('keeps a missing-workspace legacy directory unavailable after another Session becomes foreground', async () => {
    saveLegacy('sidebar://desktop-file', true)
    const h = await mountFiles({ missingCwd: true })
    await h.view.view.findByText('A workspace is required to browse files.')
    await act(async () => { h.selectOther() })
    await waitFor(() => { expect(h.controller.mounted.getSnapshot()).toBe(OTHER) })
    expect(h.ipc.listDir).not.toHaveBeenCalled()
    expect(h.ipc.readFile).not.toHaveBeenCalled()
    expect(h.ipc.readFileMedia).not.toHaveBeenCalled()
    expect(h.ipc.writeFile).not.toHaveBeenCalled()
  })
})
