// @vitest-environment jsdom
/** Surfaces plugin occupies the layout `surfaces` column with SurfacesRoot and routes desktop opens through the live store. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, desktopListingAvailable, inject } from '../src/client/index.ts'
import { canOpenDesktopFile } from '../../ui-files/src/client/desktop-files.ts'
import { hostFileOf } from '../../ui-sidebar-documentpreview/src/client/rpc.ts'
import type { OpenPathOptions } from '../src/client/openpath-intercept.ts'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      surfaces: { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
}

function sessionsStub(opts: { mainView?: string; cwd?: string; background?: { id: string; cwd: string } } = {}) {
  const cwd = opts.cwd ?? '/tmp/proj'
  return {
    list: {
      getSnapshot: () => {
        const mainView = opts.mainView
        return {
          byId: {
            ...(mainView === undefined ? {} : {
              [mainView]: {
                id: mainView,
                displayTitle: mainView,
                running: false,
                blank: false,
                updatedAt: 1,
                cwd,
                retainedBy: { mainView: 1 },
              },
            }),
            ...(opts.background === undefined ? {} : {
              [opts.background.id]: {
                id: opts.background.id,
                displayTitle: opts.background.id,
                running: true,
                blank: false,
                updatedAt: 2,
                cwd: opts.background.cwd,
                retainedBy: { gateway: 1 },
              },
            }),
          },
        }
      },
    },
  }
}

async function bench(
  opts: {
    mainView?: string
    cwd?: string
    background?: { id: string; cwd: string }
    sidebarRight?: ReturnType<typeof sidebarRightStub>
    sidebarRightTabs?: ReturnType<typeof sidebarRightTabsStub>
  } = {},
) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  const layout = { openSurfaces: vi.fn(), closeSurfaces: vi.fn(), closeRightbar: vi.fn() }
  const originalOpen = vi.fn(async (_path: string, _options?: OpenPathOptions) => {})
  const hostOpenPath = vi.fn(async () => ({ ok: true as const, value: { opened: true as const } }))
  const workspaces = { openPath: originalOpen }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('workspaces', workspaces)
  ctx.provide('sessions', sessionsStub(opts))
  ctx.provide('uiSession', {} as never)
  ctx.provide('sidebarRight', (opts.sidebarRight ?? sidebarRightStub()) as never)
  if (opts.sidebarRightTabs !== undefined) ctx.provide('sidebarRightTabs', opts.sidebarRightTabs as never)
  new TestRemote(ctx, { session: { openWorkspacePath: hostOpenPath } })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, layout, workspaces, originalOpen, hostOpenPath }
}

function sidebarRightStub() {
  return {
    isExpanded: vi.fn(() => false),
    toggleExpanded: vi.fn(),
    openResource: vi.fn(),
    openResourceIn: vi.fn(() => true),
    openTab: vi.fn(),
    openTabIn: vi.fn(() => true),
    mounted: { getSnapshot: vi.fn(() => 'sess-mounted') },
  }
}

function sidebarRightTabsStub(entries: readonly unknown[] = []) {
  return {
    subscribe: vi.fn(() => () => {}),
    guide: vi.fn(() => entries),
  }
}


afterEach(() => {
  sessionStorage.clear()
  delete (window as Window & { shell?: unknown }).shell
})

function desktop(previewWorkspaceFile = vi.fn(async () => ({ ok: true, url: 'http://127.0.0.1/preview' }))) {
  Object.assign(window, { shell: { listDir: vi.fn(), previewWorkspaceFile } })
  return previewWorkspaceFile
}

describe('single right panel routing', () => {
  it.each(['/bound/report.docx', '/worktree/src/a.ts', '/projects/p/docs/result.md'])('previews the actual Project deliverable %s without rebasing or authorizing desktop edits', async path => {
    desktop()
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'project-main', cwd: '/projects/p', sidebarRight })
    await b.workspaces.openPath(path, { sessionId: 'project-main', workingDirectory: path.slice(0, path.lastIndexOf('/')) })
    const address = (sidebarRight.openResourceIn.mock.calls[0] as unknown as [string, string])[1]
    expect(hostFileOf(address)).toEqual({ sessionId: 'project-main', path })
    expect(canOpenDesktopFile(address, () => '/bound')).toBe(false)
    expect(b.originalOpen).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('does not register a second panel host', async () => {
    const b = await bench()
    expect(b.slots.entries('surfaces')).toEqual([])
    expect(desktopListingAvailable()).toBe(false)
    desktop()
    expect(desktopListingAvailable()).toBe(true)
    await b.fiber.dispose()
  })

  it.each(['notes.md', 'report.docx', 'table.xlsx'])('opens %s through the shared resource owner', async file => {
    desktop()
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    await b.workspaces.openPath(`/tmp/proj/${file}`, { sessionId: 'sess-1', line: 7 })
    expect(sidebarRight.openResourceIn).toHaveBeenCalledWith('sess-1', expect.stringContaining(file), { params: { line: 7 } })
    expect(b.layout.openSurfaces).not.toHaveBeenCalled()
    expect(sidebarRight.toggleExpanded).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('opens the workspace root as Files in the same panel', async () => {
    desktop()
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    await b.workspaces.openPath('/tmp/proj', { sessionId: 'sess-1' })
    expect(sidebarRight.openTabIn).toHaveBeenCalledWith('sess-1', 'files')
    await b.fiber.dispose()
  })

  it('routes a background request to its own session without toggling the foreground', async () => {
    desktop()
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', background: { id: 'sess-2', cwd: '/other' }, sidebarRight })
    await b.workspaces.openPath('/other/a.txt', { sessionId: 'sess-2' })
    expect(sidebarRight.openResourceIn).toHaveBeenCalledWith('sess-2', expect.stringContaining('a.txt'), undefined)
    expect(sidebarRight.toggleExpanded).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it.each(['preview', 'terminal', 'files', 'diff', 'agents'])('routes %s events through the single owner', async kind => {
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { kind } }))
    expect(sidebarRight.openTabIn).toHaveBeenCalledWith('sess-1', kind === 'preview' ? 'browser' : kind, undefined)
    expect(b.layout.openSurfaces).not.toHaveBeenCalled()
    await b.fiber.dispose()
    sidebarRight.openTabIn.mockClear()
    window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { kind } }))
    expect(sidebarRight.openTabIn).not.toHaveBeenCalled()
  })

  it('opens a mini browser without expanding or closing the panel', async () => {
    desktop()
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    await b.workspaces.openPath('/tmp/proj/a.html', { sessionId: 'sess-1', presentation: 'mini' })
    expect(sidebarRight.openTabIn).toHaveBeenCalledWith('sess-1', 'browser', { expand: false })
    expect(sidebarRight.openResourceIn).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('dshd-pending-preview-session')).toBe('sess-1')
    expect(sessionStorage.getItem('dshd-pending-preview-presentation')).toBe('mini')
    await b.fiber.dispose()
  })

  it.each(['notes.md', 'notes.txt', 'image.png'])('previews the delivery %s in the originating chat without opening the sidebar', async file => {
    const previewWorkspaceFile = desktop()
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    const conversation = document.createElement('div')
    conversation.dataset.conversationSession = 'sess-1'
    const chat = document.createElement('div')
    chat.setAttribute('data-conversation-scroll', '')
    conversation.append(chat)
    document.body.append(conversation)
    vi.spyOn(conversation, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 76, 800, 624))
    vi.spyOn(chat, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 76, 800, 624))
    try {
      await b.workspaces.openPath(`/tmp/proj/${file}`, { sessionId: 'sess-1', presentation: 'mini' })
      expect(sidebarRight.openResourceIn).toHaveBeenCalledWith('sess-1', expect.stringContaining(file), {
        expand: false, floating: { x: 508, y: 88, width: 380, height: 300 },
      })
      expect(sidebarRight.openTabIn).not.toHaveBeenCalled()
      expect(previewWorkspaceFile).not.toHaveBeenCalled()
      expect(b.originalOpen).not.toHaveBeenCalled()
    } finally {
      conversation.remove()
      await b.fiber.dispose()
    }
  })

  it('opens ordinary browser documents in the same panel after the file tab', async () => {
    desktop()
    const sidebarRight = sidebarRightStub()
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    await b.workspaces.openPath('/tmp/proj/a.html', { sessionId: 'sess-1' })
    expect(sidebarRight.openResourceIn).toHaveBeenCalledOnce()
    expect(sidebarRight.openTabIn).toHaveBeenCalledWith('sess-1', 'browser', undefined)
    await b.fiber.dispose()
  })

  it('falls back for paths outside workspace authority and unmounted target sessions', async () => {
    desktop()
    const sidebarRight = sidebarRightStub()
    sidebarRight.openResourceIn.mockReturnValue(false)
    const b = await bench({ mainView: 'sess-1', sidebarRight })
    await b.workspaces.openPath('/elsewhere/a.txt', { sessionId: 'sess-1' })
    await b.workspaces.openPath('/tmp/proj/a.txt', { sessionId: 'sess-1' })
    expect(b.originalOpen).toHaveBeenCalledTimes(2)
    await b.fiber.dispose()
  })
})
