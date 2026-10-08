/** Adapts workspace opens and preview events into the single right panel. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { en, NS, zh, type SurfacesKey } from './locales.ts'
import { ensureBaseOpenPath, wrapOpenPath, type OpenPathOptions, type OpenPathService } from './openpath-intercept.ts'
import { fileAddressFor, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { relativeTo } from './paths.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { FloatRect } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'

export type { SurfacesRootInjected, SurfacesRootProps } from './SurfacesRoot.tsx'
export type { SurfacesKey } from './locales.ts'
export type { OpenableKind, Surface, SurfaceKind, SurfacesState } from './stores.ts'
export { createSurfacesStore } from './stores.ts'

/** Owner props the Files occupant receives so it can open a file surface. */
export interface FilesOwnerProps {
  openFile: (relativePath: string) => void
}

/** Owner props the single-file occupant receives. */
export interface FileOwnerProps {
  relativePath: string
  /** 1-based line to scroll into view; omitted when the open was not a jump-to-line. */
  revealLine?: number
  /** Increments on each jump-to-line so the same line can be requested again. */
  revealRequestId?: number
  /** True while this file surface is the active tab (reread on activate). */
  active: boolean
  /** Report whether the editor has unsaved changes (for tab-close confirm). */
  onDirtyChange: (dirty: boolean) => void
  /** Read a remembered buffer for this file (survives occupant remount / session switches). */
  readBuffer: () => { text: string; draft: string } | undefined
  /** Remember or clear the in-memory buffer for this file. */
  writeBuffer: (buffer: { text: string; draft: string } | null) => void
  /** Register a save that returns whether the write succeeded (tab-close Save). */
  registerSave: (save: (() => Promise<boolean>) | null) => void
}

/** Owner props the Browser occupant receives so renderer chrome can hide the guest. */
export interface BrowserOwnerProps {
  /** True while this preview surface is the active tab. */
  active: boolean
  /** True while renderer-owned chrome overlaps the native guest hit-test area. */
  occluded?: boolean
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Right-panel surfaces copy. */
    surfaces: SurfacesKey
  }
  interface SlotMap {
    /**
     * Browser / preview occupant. ui-preview injects here.
     */
    'surfaces.browser': { kind: 'single'; scope: 'session-maybe'; owner: BrowserOwnerProps }
    /**
     * Terminal occupant. ui-user-terminal already injects here; kind and
     * scope must stay `single` + `session-maybe` so that inject attaches.
     */
    'surfaces.terminal': { kind: 'single'; scope: 'session-maybe'; owner: {} }
    /**
     * Workspace files occupant. ui-files injects here.
     */
    'surfaces.files': { kind: 'single'; scope: 'session-maybe'; owner: FilesOwnerProps }
    /**
     * Single-file preview occupant. ui-files injects here.
     */
    'surfaces.file': { kind: 'single'; scope: 'session-maybe'; owner: FileOwnerProps }
    /**
     * Git diff occupant. ui-diff injects here.
     */
    'surfaces.diff': { kind: 'single'; scope: 'session-maybe'; owner: FilesOwnerProps }
    /**
     * Running-agents occupant. ui-agents-panel injects here.
     */
    'surfaces.agents': { kind: 'single'; scope: 'session-maybe'; owner: {} }
  }
}

const OPEN_SURFACE_EVENT = 'dshd-open-surface'
const PENDING_PREVIEW_URL_KEY = 'dshd-pending-preview-url'
const PENDING_PREVIEW_PRESENTATION_KEY = 'dshd-pending-preview-presentation'
const PENDING_PREVIEW_SESSION_KEY = 'dshd-pending-preview-session'
const BROWSER_DOCUMENTS = new Set(['.html', '.htm', '.xhtml', '.pdf'])
interface DesktopShell {
  gitStatus?: (cwd: string) => Promise<unknown>
  previewOpen?: (input: { url: string }) => Promise<unknown>
  listDir?: (cwd: string, relativePath?: string) => Promise<unknown>
  previewWorkspaceFile?: (input: {
    cwd: string
    relativePath: string
  }) => Promise<{ ok?: boolean, url?: string } | null | undefined>
  onOpenPreviewUrl?: (handler: (payload: { url?: string }) => void) => () => void
}

/**
 * @returns the desktop `window.shell` object, or undefined outside the renderer.
 */
function readWindowShell(): DesktopShell | undefined {
  /* v8 ignore next -- browser-only module; Node coverage never sees a missing window. */
  if (typeof window === 'undefined') return undefined
  return (window as Window & { shell?: DesktopShell }).shell
}

/**
 * @param relative - workspace-relative path using `/` separators.
 * @returns the lowercased extension including the leading dot, or empty.
 */
function documentExtension(relative: string): string {
  const slash = relative.lastIndexOf('/')
  const base = slash >= 0 ? relative.slice(slash + 1) : relative
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

/**
 * Write the pending preview URL and fan the event out to any mounted Browser
 * surface. The pending keys are read by the surface's mount effect; the
 * event drives a live one.
 * @param url - loopback http(s) the guest should load.
 * @param sessionId - originating Session, carried in the event detail.
 * @param presentation - 'mini' marks the mini-player pending flag.
 */
function openPreviewSurface(url: string, sessionId?: string, presentation?: 'mini'): void {
  try {
    sessionStorage.setItem(PENDING_PREVIEW_URL_KEY, url)
    if (presentation === 'mini') sessionStorage.setItem(PENDING_PREVIEW_PRESENTATION_KEY, 'mini')
    else sessionStorage.removeItem(PENDING_PREVIEW_PRESENTATION_KEY)
    if (sessionId === undefined) sessionStorage.removeItem(PENDING_PREVIEW_SESSION_KEY)
    else sessionStorage.setItem(PENDING_PREVIEW_SESSION_KEY, sessionId)
  } catch {
    // Quota / SecurityError: Preview still listens for the event when mounted.
  }
  window.dispatchEvent(new CustomEvent(OPEN_SURFACE_EVENT, {
    detail: { kind: 'preview', url, ...(sessionId === undefined ? {} : { sessionId }),
      ...(presentation === undefined ? {} : { presentation }) },
  }))
}

/**
 * Load a browser-renderable workspace file into a token-protected URL.
 * Missing or failing IPC yields undefined.
 * @param cwd - Session workspace root.
 * @param relative - path inside cwd.
 * @returns the loopback URL, or undefined when the file is not browser-renderable.
 */
async function browserDocumentUrl(cwd: string, relative: string): Promise<string | undefined> {
  const preview = readWindowShell()?.previewWorkspaceFile
  if (typeof preview !== 'function' || !BROWSER_DOCUMENTS.has(documentExtension(relative))) return undefined
  try {
    const result = await preview({ cwd, relativePath: relative })
    return result?.ok === true && typeof result.url === 'string' && result.url.length > 0
      ? result.url
      : undefined
  } catch {
    return undefined
  }
}

/**
 * After Files opens, load a browser-renderable workspace file in Browser.
 * Missing or failing IPC leaves Files in place and does not throw.
 * @param cwd - session workspace root, or undefined when the client summary has no cwd.
 * @param relative - path inside cwd.
 */
async function previewBrowserDocument(cwd: string | undefined, relative: string, sessionId: string): Promise<void> {
  if (cwd === undefined) return
  const url = await browserDocumentUrl(cwd, relative)
  if (url !== undefined) openPreviewSurface(url, sessionId)
}

/**
 * Forward main-process loopback popups into the same preview event as terminal.
 * @returns a disposer; a no-op when `onOpenPreviewUrl` is absent.
 */
function subscribeOpenPreviewUrl(): () => void {
  const subscribe = readWindowShell()?.onOpenPreviewUrl
  if (typeof subscribe !== 'function') return () => {}
  return subscribe((payload) => {
    if (typeof payload?.url === 'string' && payload.url.length > 0) {
      openPreviewSurface(payload.url)
    }
  })
}

/** Open workspace resources in the same tab owner as the guide. */
async function openWorkspaceSurface(
  ctx: Context,
  path: string,
  sessionId: string,
  options?: OpenPathOptions,
): Promise<boolean> {
  const id = sessionId as SessionId
  const session = ctx.sessions.list.getSnapshot().byId[id]
  const sessionCwd = session?.presentation?.workingDirectory ?? session?.cwd
  const cwd = options?.workingDirectory ?? sessionCwd
  if (typeof cwd !== 'string' || cwd.length === 0) return false
  const relative = relativeTo(cwd, path)
  if (relative === undefined) return false
  if (relative === '') return ctx.sidebarRight.openTabIn(id, 'files')
  // Project sessions store their private state under a different Host cwd.
  // Every resolved deliverable must therefore keep its absolute identity,
  // including Office files inside the presented working directory.
  const address = options?.workingDirectory === undefined
    ? fileAddressFor(id, sessionCwd, path)
    : sessionFileAddress(id, path)
  const own = currentSessionId(ctx) === sessionId
  if (own && options?.presentation === 'mini' && BROWSER_DOCUMENTS.has(documentExtension(relative))) {
    const url = await browserDocumentUrl(cwd, relative)
    if (url !== undefined) {
      openPreviewSurface(url, sessionId, 'mini')
      return true
    }
  }
  if (own && options?.presentation === 'mini' && !BROWSER_DOCUMENTS.has(documentExtension(relative))) {
    return ctx.sidebarRight.openResourceIn(id, address, {
      expand: false,
      floating: floatingFileRect(sessionId),
      ...options.line === undefined ? {} : { params: { line: options.line } },
    })
  }
  const opened = ctx.sidebarRight.openResourceIn(id, address,
    options?.line === undefined ? undefined : { params: { line: options.line } })
  if (opened && own) await previewBrowserDocument(cwd, relative, sessionId)
  return opened
}

/** Read the main-view Session without borrowing a retained background seat. */
function currentSessionId(ctx: Context): SessionId | undefined {
  return Object.values(ctx.sessions.list.getSnapshot().byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
}

/** Initial file preview rectangle inside the originating conversation. */
function floatingFileRect(sessionId: string): FloatRect {
  const conversation = [...document.querySelectorAll<HTMLElement>('[data-conversation-session]')]
    .find(node => node.dataset.conversationSession === sessionId && node.getBoundingClientRect().width > 0)
  const chat = conversation?.querySelector<HTMLElement>('[data-conversation-scroll]')
  const rect = chat?.getBoundingClientRect()
  if (rect === undefined || rect.width <= 0 || rect.height <= 0) {
    throw new Error('conversation preview viewport is unavailable')
  }
  const width = Math.min(380, Math.max(1, rect.width - 24))
  const height = Math.min(300, Math.max(1, rect.height - 24))
  return { x: rect.right - width - 12, y: rect.top + 12, width, height }
}

/**
 * True only in the desktop renderer where workspace listing IPC exists.
 * The web e2e lane must fall through to OS `openPath`.
 * @returns whether `window.shell.listDir` is a function.
 */
export function desktopListingAvailable(): boolean {
  return typeof readWindowShell()?.listDir === 'function'
}

/** Services required by the workspace-to-panel adapter. */
export const inject = [
  'locale', 'workspaces', 'sessions', 'remote', 'remote.session', 'sidebarRight',
]

/** Register desktop openers; the right Sidebar is the only panel host. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-surfaces: dictionaries')
  ctx.effect(() => subscribeOpenPreviewUrl(), 'ui-surfaces: open-preview-url')
  ctx.effect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<{
        kind?: string; sessionId?: string; presentation?: 'mini'
      } | undefined>).detail
      const kinds: Record<string, string> = {
        preview: 'browser', terminal: 'terminal', files: 'files', diff: 'diff', agents: 'agents',
      }
      const kind = detail?.kind === undefined ? undefined : kinds[detail.kind]
      const sessionId = detail?.sessionId ?? currentSessionId(ctx)
      if (kind === undefined || sessionId === undefined) return
      ctx.sidebarRight.openTabIn(sessionId as SessionId, kind,
        detail?.presentation === 'mini' ? { expand: false } : undefined)
    }
    window.addEventListener(OPEN_SURFACE_EVENT, onOpen)
    return () => { window.removeEventListener(OPEN_SURFACE_EVENT, onOpen) }
  }, 'ui-surfaces: unified panel events')

  ctx.effect(() => {
    const workspaces = ctx.workspaces as Partial<OpenPathService>
    const disposeBase = ensureBaseOpenPath(workspaces, async (path) => {
      const result = await ctx.remote.session.openWorkspacePath({ path })
      if (!result.ok) throw new Error(`path open failed: ${result.error.message}`)
    })
    const disposeIntercept = wrapOpenPath(workspaces, {
      takeoverEnabled: desktopListingAvailable,
      currentSessionId: () => currentSessionId(ctx),
      openInSurfaces: (path, sessionId, options) => openWorkspaceSurface(ctx, path, sessionId, options),
    })
    return () => { disposeIntercept(); disposeBase() }
  }, 'ui-surfaces: openPath intercept')
}
