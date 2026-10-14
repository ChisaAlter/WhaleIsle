/** Registers the Desktop file tree and editor in the native right Sidebar. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, NS, zh, type FilesKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-surfaces/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  DESKTOP_FILE_KIND,
  DESKTOP_FILE_ID,
  DESKTOP_FILES_ID,
  desktopFileDefinition,
  desktopFilesDefinition,
} from './desktop-files.ts'
import { FilePreview, SidebarFilePreview, SidebarFileTitle } from './FilePreview.tsx'
import { FilesPanel, SidebarFilesPanel, type SidebarFilesPanelProps } from './FilesPanel.tsx'
import { hasFloatingPreview } from './floating-preview.ts'
import { readFilesShell, type FilesShellInjected } from './shell.ts'
import { appendToDraft } from './draft.ts'
import { serializeComposerFileLink } from './composerMention.ts'
import { SidebarFloatingPreviewAction } from './SidebarFloatingPreviewAction.tsx'
import { DesktopFileState, type DesktopFileStateInjected } from './desktop-file-state.ts'
import { FileClosePrompt, type FileClosePromptInjected } from './FileClosePrompt.tsx'
import { parseFileAddress, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'

export type { FilesPanelProps, SidebarFilesPanelProps } from './FilesPanel.tsx'
export type { FilePreviewProps, SidebarFilePreviewProps } from './FilePreview.tsx'
export type { FilesKey } from './locales.ts'
export type { DirEntry, FilesShellInjected, ListDirResult, ReadFileMediaResult, ReadFileResult, WriteFileResult } from './shell.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Files surface copy. */
    files: FilesKey
  }
}

/** Services required by the files plugin. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'workspaces']

/**
 * Register dictionaries and inject the tree and preview occupants.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-files: dictionaries')
  const t = ctx.locale.bind(NS)
  const files = new DesktopFileState()
  ctx.effect(() => () => { files.dispose() }, 'ui-files: draft and close lifecycle')

  const injected = (): FilesShellInjected & DesktopFileStateInjected & Pick<SidebarFilesPanelProps, 'openWorkspaceFile'> => ({
    ...readFilesShell(),
    mentionFile: (targetSessionId, relativePath) => {
      appendToDraft(ctx, targetSessionId, serializeComposerFileLink(relativePath))
    },
    appendComposerText: (targetSessionId, text) => {
      appendToDraft(ctx, targetSessionId, text)
    },
    readFileBuffer: address => files.read(address),
    writeFileBuffer: (address, buffer) => { files.write(address, buffer) },
    registerFileSave: (tabId, address, save) => { files.registerSave(tabId, address, save) },
    openWorkspaceFile: async (sessionId, cwd, relativePath) => {
      const workspaces = ctx.workspaces as typeof ctx.workspaces & {
        openPath?: (path: string, options: { sessionId: string }) => Promise<void>
      }
      if (workspaces.openPath === undefined) throw new Error('workspace path opener is unavailable')
      await workspaces.openPath(resolveWorkspacePath(cwd, relativePath), { sessionId })
    },
  })

  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(DESKTOP_FILE_KIND, (_sessionId, tab, proceed) => {
    const parsed = parseFileAddress(tab.contentId)
    return files.requestClose(tab.id, tab.contentId, parsed?.path ?? tab.title, proceed)
  }), 'ui-files: unsaved close guard')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'files-close-confirmation',
    locale: NS,
    inject: (): FileClosePromptInjected => ({
      hooks: { closeRequest: files.closeRequest },
      cancelClose: () => { files.cancelClose() },
      discardClose: () => { files.discardClose() },
      saveClose: () => files.saveClose(),
    }),
  }, FileClosePrompt))

  const cwdOf = (sessionId: string): string | undefined => {
    const cwd = sessionWorkingDirectory(ctx.sessions.list.getSnapshot().byId[sessionId as SessionId])
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  }

  ctx.effect(() => ctx.sidebarRightTabs.register(
    desktopFilesDefinition(t),
  ), 'ui-files: desktop files type')
  ctx.effect(() => ctx.sidebarRightTabs.register(
    desktopFileDefinition(t, cwdOf),
  ), 'ui-files: desktop file type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: DESKTOP_FILES_ID,
    locale: NS,
    inject: injected,
  }, SidebarFilesPanel)), 'ui-files: desktop files body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: DESKTOP_FILE_ID,
    locale: NS,
    inject: injected,
  }, SidebarFilePreview)), 'ui-files: desktop file body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: DESKTOP_FILE_ID,
    locale: NS,
  }, SidebarFileTitle)), 'ui-files: desktop file title')

  ctx.slots.inject('surfaces.files', () => ctx.slots.register({
    name: 'surfaces.files', locale: NS, inject: injected,
  }, FilesPanel))
  ctx.slots.inject('surfaces.file', () => ctx.slots.register({
    name: 'surfaces.file', locale: NS, inject: injected,
  }, FilePreview))

  ctx.slots.inject('sidebar.right.tab.document.actions', () => {
    if (!hasFloatingPreview()) return () => {}
    return ctx.slots.register({
      name: 'sidebar.right.tab.document.actions',
      id: 'floating-preview',
      locale: NS,
    }, SidebarFloatingPreviewAction)
  })
}
