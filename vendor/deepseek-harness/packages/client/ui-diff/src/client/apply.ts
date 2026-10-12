/** Registers the Diff page type in the right Sidebar. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-surfaces/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { DiffPanel, type DiffPanelInjected } from './DiffPanel.tsx'
import { en, NS, zh, type DiffKey } from './locales.ts'
import { readDiffShell } from './shell.ts'

export type { DiffPanelInjected, DiffPanelProps } from './DiffPanel.tsx'
export type { DiffKey } from './locales.ts'
export type { DiffBranchRef, DiffFile, DiffHunk, DiffLine, DiffShellInjected, GitBranchListResult, GitDiffOptions, GitDiffResult, GitStatusEntriesResult, GitStatusEntry } from './shell.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Diff surface copy. */
    diff: DiffKey
  }
}

/** The implementation identity, and the key its body registers under. */
export const DIFF_ID = '@deepseek-ai/dsh-client-ui-diff'

/** The page kind opened through the right Sidebar. */
export const DIFF_KIND = 'diff'

/** Services required by the diff plugin. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions', 'workspaces']

interface WorkspacePathOpener {
  openPath?: (path: string, options?: { sessionId?: string }) => Promise<void>
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[/\\]/.test(path)
}

function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  if (isAbsolutePath(path) || cwd === undefined || cwd === '') return path
  const separator = /^[A-Za-z]:[/\\]/.test(cwd) && cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[/\\]+$/, '')}${separator}${path.replace(/^[/\\]+/, '')}`
}

/**
 * Register the Diff page type, dictionaries, and its right-Sidebar body.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-diff: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: DIFF_ID,
    kind: DIFF_KIND,
    priority: 'extension',
    title: () => t('type.label'),
    guide: [{
      id: 'workspace',
      order: 30,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }), 'ui-diff: page type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: DIFF_ID,
    locale: NS,
    inject: (sessionId): DiffPanelInjected => ({
      ...readDiffShell(),
      openFile: async (relativePath) => {
        const workspaces = ctx.get('workspaces') as WorkspacePathOpener | undefined
        const openPath = workspaces?.openPath
        if (openPath === undefined) throw new Error('workspace path opener is unavailable')
        const cwd = sessionWorkingDirectory(ctx.sessions.list.getSnapshot().byId[sessionId as SessionId])
        await openPath.call(workspaces, resolveWorkspacePath(cwd, relativePath), { sessionId })
      },
    }),
  }, DiffPanel)), 'ui-diff: page body')

  ctx.effect(() => ctx.slots.inject('surfaces.diff', () => ctx.slots.register({
    name: 'surfaces.diff', locale: NS, inject: readDiffShell,
  }, DiffPanel)), 'ui-diff: DSHD surface')
}
