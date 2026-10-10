import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { IconRefreshOutline16, Input, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { serializeComposerFileLink } from './composerMention.ts'
import { FileTree, joinRel, type TreeEntry } from './FileTree.tsx'
import { NS } from './locales.ts'
import { getProjectFilePickerMatches, type ProjectEntry } from './projectFilePicker.ts'
import type { FilesShellInjected, ListDirResult } from './shell.ts'
import css from './FilesPanel.module.css'

const SEARCH_LISTING_CONCURRENCY = 4

/** Share the four IPC slots across root, expansion and cancelled search walks. */
function directoryLister(listDir: FilesShellInjected['listDir']) {
  let active = 0
  const pending: {
    cwd: string
    path: string
    cancelled: () => boolean
    resolve: (value: ListDirResult | undefined) => void
    reject: (error: unknown) => void
  }[] = []
  const drain = (): void => {
    while (active < SEARCH_LISTING_CONCURRENCY && pending.length > 0) {
      const request = pending.shift()
      if (request === undefined) break
      if (request.cancelled()) {
        request.resolve(undefined)
        continue
      }
      active += 1
      const finish = (): void => {
        active -= 1
        drain()
      }
      try {
        void listDir(request.cwd, request.path).then(request.resolve, request.reject).finally(finish)
      } catch (error: unknown) {
        request.reject(error)
        finish()
      }
    }
  }
  return (cwd: string, path: string, cancelled: () => boolean): Promise<ListDirResult | undefined> =>
    new Promise((resolve, reject) => {
      pending.push({ cwd, path, cancelled, resolve, reject })
      drain()
    })
}

export interface FilesPanelProps extends PropsLocale<typeof NS>, FilesShellInjected {
  sessionId: string | undefined
  useSessions: UseSessions
  openFile: (relativePath: string) => void | Promise<void>
  /** Workspace root override for a caller that owns the Session (the Sidebar adapter). */
  workspaceCwd?: string | undefined
}

/** Props the Sidebar adapter needs from its tab plus the shared shell face. */
export interface SidebarFilesPanelProps extends PropsLocale<typeof NS>, FilesShellInjected {
  sessionId: string | undefined
  useSessions: UseSessions
  openWorkspaceFile: (sessionId: string, cwd: string, relativePath: string) => Promise<void>
}

/**
 * Adapt one Sidebar Files tab to the existing tree panel.
 *
 * The tree's own state and behavior are unchanged; only its session and file
 * open callback come from the tab that owns it, so a click opens the resource
 * in that same tab's session.
 * @param props - live tab information, shell face, and copy.
 * @returns the Desktop file tree.
 */
export function SidebarFilesPanel(props: SidebarFilesPanelProps): ReactNode {
  const { sessionId, useSessions, openWorkspaceFile, t, ...injected } = props
  const cwd = useSessions(state => sessionId === undefined
    ? undefined
    : state.byId[sessionId as SessionId]?.cwd || undefined)
  const openFile = async (relativePath: string): Promise<void> => {
    if (cwd === undefined || sessionId === undefined) return
    await openWorkspaceFile(sessionId, cwd, relativePath)
  }
  return (
    <FilesPanel
      {...injected}
      useSessions={useSessions}
      sessionId={sessionId}
      openFile={openFile}
      workspaceCwd={cwd}
      t={t}
    />
  )
}

function currentCwd(
  sessionId: string | undefined,
  useSessions: UseSessions,
): string | undefined {
  return useSessions((s) => {
    if (sessionId !== undefined) return s.byId[sessionId as SessionId]?.cwd || undefined
    const id = Object.values(s.byId)
      .find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
    const next = id === undefined ? undefined : s.byId[id]?.cwd
    return next ? next : undefined
  })
}

function toTree(parent: string, entries: { name: string; kind: 'file' | 'directory' }[]): TreeEntry[] {
  return entries.map(entry => ({ ...entry, path: joinRel(parent, entry.name) }))
}

function absoluteOf(cwd: string, relativePath: string): string {
  const root = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
  /* v8 ignore next -- the tree copies entry paths, never the empty workspace root. */
  if (relativePath === '') return root
  return `${root}/${relativePath}`
}

function collectFiles(
  root: readonly TreeEntry[],
  childrenByPath: Record<string, TreeEntry[]>,
): ProjectEntry[] {
  const files: ProjectEntry[] = []
  const visit = (entries: readonly TreeEntry[]): void => {
    for (const entry of entries) {
      if (entry.kind === 'file') files.push({ kind: 'file', path: entry.path })
      else visit(childrenByPath[entry.path] ?? [])
    }
  }
  visit(root)
  return files
}

/**
 * Workspace file tree occupant of `surfaces.files`. Clicking a file opens a
 * `file:` surface through the owner `openFile` callback. A root listing in
 * flight shows `listing` instead of `empty.dir`. Entering search walks the
 * tree once (uncapped DFS) and caches it; keystrokes filter that cache in
 * memory. Refresh reloads the root listing; while a search query is active it
 * re-walks that search instead of dropping nested matches. Mention is omitted
 * without a session id. A nested
 * `listDir` failure keeps the tree and shows a banner; only the workspace-root
 * listing replaces the tree.
 * @param props - session-maybe seats, listing IPC, locale, and openFile.
 * @returns the files panel.
 */
export function FilesPanel({
  sessionId,
  useSessions,
  openFile,
  listDir,
  mentionFile,
  listEditors,
  openInEditor,
  showItemInFolder,
  openWithSystemDefault,
  workspaceCwd,
  t,
}: FilesPanelProps): ReactNode {
  const selectedCwd = currentCwd(sessionId, useSessions)
  const cwd = workspaceCwd ?? selectedCwd
  const [root, setRoot] = useState<TreeEntry[]>([])
  const [listing, setListing] = useState<'pending' | 'settled'>('pending')
  const [childrenByPath, setChildrenByPath] = useState<Record<string, TreeEntry[]>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [query, setQuery] = useState('')
  const [searchPending, setSearchPending] = useState(false)
  const [editors, setEditors] = useState<readonly { id: string; label: string }[]>([])
  const searching = query.trim() !== ''
  const listDirectory = useMemo(() => directoryLister(listDir), [listDir])
  const listingIdentity = useRef({ cwd, generation, searching })
  listingIdentity.current = { cwd, generation, searching }
  const previousCwd = useRef(cwd)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (previousCwd.current !== cwd) {
      previousCwd.current = cwd
      setRoot([])
      setChildrenByPath({})
      setExpanded(new Set())
    }
    if (cwd === undefined) {
      setRoot([])
      setChildrenByPath({})
      setError(null)
      setListing('settled')
      return
    }
    setListing('pending')
    let cancelled = false
    void listDirectory(cwd, '', () => cancelled).then((result) => {
      if (cancelled || result === undefined) return
      if (!result.ok) {
        setError(result.message ?? t('error.list'))
        setRoot([])
        setListing('settled')
        return
      }
      setError(null)
      setRoot(toTree('', result.entries ?? []))
      setListing('settled')
    }).catch(() => {
      if (!cancelled) {
        setError(t('error.list'))
        setListing('settled')
      }
    })
    return () => { cancelled = true }
  }, [cwd, listDirectory, t, generation])

  // One walk per search session: traversal runs when the query first becomes
  // non-empty (and on Refresh via `generation`); further keystrokes only
  // filter the cached listing in memory. The cleanup flag also cancels an
  // in-flight walk when the session ends, so walks never stack.
  useEffect(() => {
    if (cwd === undefined || !searching) {
      setSearchPending(false)
      return
    }
    let cancelled = false
    setSearchPending(true)
    const acc: Record<string, TreeEntry[]> = {}
    const walk = async (): Promise<void> => {
      const pending = ['']
      let searchError: string | null = null
      while (pending.length > 0 && !cancelled) {
        const parents = pending.splice(0, SEARCH_LISTING_CONCURRENCY)
        const batch = await Promise.all(parents.map(async parent => {
          if (cancelled) return undefined
          try {
            const result = await listDirectory(cwd, parent, () => cancelled)
            if (cancelled || result === undefined) return undefined
            if (!result.ok) {
              searchError ??= result.message ?? t('error.list')
              return undefined
            }
            return { parent, entries: toTree(parent, result.entries ?? []) }
          } catch {
            if (!cancelled) searchError ??= t('error.list')
            return undefined
          }
        }))
        if (cancelled) return
        for (const result of batch) {
          if (result === undefined) continue
          acc[result.parent] = result.entries
          for (const entry of result.entries) {
            if (entry.kind === 'directory') pending.push(entry.path)
          }
        }
      }
      if (cancelled) return
      setError(searchError)
      setRoot(acc[''] ?? [])
      setChildrenByPath(acc)
      setExpanded(new Set(Object.keys(acc).filter(path => path !== '')))
      setListing('settled')
      setSearchPending(false)
    }
    void walk()
    return () => { cancelled = true }
  }, [cwd, listDirectory, searching, generation, t])

  useEffect(() => {
    if (listEditors === undefined) return
    let cancelled = false
    void listEditors().then((listed) => {
      if (!cancelled) setEditors(listed)
    })
    return () => { cancelled = true }
  }, [listEditors])

  const onToggle = (path: string): void => {
    if (expanded.has(path)) {
      const next = new Set(expanded)
      next.delete(path)
      setExpanded(next)
      return
    }
    setExpanded(new Set(expanded).add(path))
    if (childrenByPath[path] !== undefined) return
    /* v8 ignore next -- the tree unmounts when cwd is missing. */
    if (cwd === undefined) return
    const request = { cwd, generation, searching }
    const current = (): boolean => mounted.current && request.cwd === listingIdentity.current.cwd
      && request.generation === listingIdentity.current.generation
      && request.searching === listingIdentity.current.searching
    void listDirectory(cwd, path, () => !current()).then((result) => {
      if (!current() || result === undefined) return
      if (!result.ok) {
        setError(result.message ?? t('error.list'))
        return
      }
      setChildrenByPath(current => ({ ...current, [path]: toTree(path, result.entries ?? []) }))
    }).catch(() => { if (current()) setError(t('error.list')) })
  }

  const copyPath = (value: string): void => {
    void writeClipboard(value).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1200)
    })
  }

  const openFileInWorkspace = async (relativePath: string): Promise<void> => {
    try { await openFile(relativePath) }
    catch (_error: unknown) {
      setError(t('error.open'))
    }
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    setQuery('')
  }

  const pickerFiles = useMemo(() => searching ? collectFiles(root, childrenByPath) : [],
    [root, childrenByPath, searching])
  const pickerMatches = useMemo(() => searching
    ? getProjectFilePickerMatches(pickerFiles, query)
    : [], [pickerFiles, query, searching])

  return (
    <div className={css.root} data-files-panel>
      <div className={css.toolbar}>
        <Input
          className={css.search}
          value={query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={onSearchKey}
        />
        {copied && <span className={css.copied} role="status">{t('copied')}</span>}
        <Tooltip label={t('refresh')} side="bottom">
          <button
            type="button"
            className={css.refresh}
            aria-label={t('refresh')}
            onClick={() => {
              if (query.trim() === '') {
                setChildrenByPath({})
                setExpanded(new Set())
              }
              setGeneration(n => n + 1)
            }}
          >
            <IconRefreshOutline16 size={14} />
          </button>
        </Tooltip>
      </div>
      <div className={css.body} aria-busy={searching && searchPending || undefined}>
        {searching && searchPending ? <p className={css.message} role="status">{t('search.pending')}</p> : null}
        {cwd === undefined ? (
          <p className={css.message}>{t('empty.cwd')}</p>
        ) : error !== null ? (
          <p className={css.message}>{error}</p>
        ) : listing === 'pending' && root.length === 0 ? (
          <p className={css.message}>{t('listing')}</p>
        ) : root.length === 0 ? (
          <p className={css.message}>{t('empty.dir')}</p>
        ) : (
          searching ? (
            <div className={css.picker}>
              {pickerMatches.map(match => (
                <button
                  key={match.path}
                  type="button"
                  className={css.pickerRow}
                  onClick={() => { void openFileInWorkspace(match.path) }}
                >
                  <span className={css.pickerName}>{match.name}</span>
                  <span className={css.pickerPath}>{match.path}</span>
                </button>
              ))}
            </div>
          ) : (
            <FileTree
              entries={root}
              childrenByPath={childrenByPath}
              expanded={expanded}
              query={query}
              onToggle={onToggle}
              onOpenFile={(relativePath) => { void openFileInWorkspace(relativePath) }}
              onMention={sessionId === undefined ? undefined : (path) => {
                mentionFile(sessionId, path)
              }}
              onCopyRelative={(path) => { copyPath(path) }}
              onCopyAbsolute={(path) => { copyPath(absoluteOf(cwd, path)) }}
              onCopyMention={(path) => { copyPath(serializeComposerFileLink(path)) }}
              mentionLabel={sessionId === undefined ? undefined : t('mention')}
              copyMentionLabel={t('copy.mention')}
              copyRelativeLabel={t('copy.relative')}
              copyAbsoluteLabel={t('copy.absolute')}
              onShowInFolder={showItemInFolder === undefined ? undefined : (path) => {
                void showItemInFolder(cwd, path)
              }}
              onOpenInEditor={openInEditor === undefined ? undefined : (editor, path) => {
                void openInEditor({ editor, cwd, relativePath: path })
              }}
              onOpenWithSystemDefault={openWithSystemDefault === undefined ? undefined : (path) => {
                void openWithSystemDefault(cwd, path)
              }}
              editors={editors}
              showInFolderLabel={t('open.folder')}
              openWithSystemDefaultLabel={t('open.system')}
            />
          )
        )}
      </div>
    </div>
  )
}
