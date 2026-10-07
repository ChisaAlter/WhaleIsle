import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  Button, DisclosureRow, IconCodeOutline16, IconCompareSplitOutlineRegular, IconNowrapFillRegular,
  IconRefreshOutline16, IconWrapFillRegular, languageForPath, MAX_RENDERED_LINES, Menu, Modal,
  renderedHunks, ReviewDiff, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReviewHunk, ReviewNote } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { toReviewHunk } from './review-hunks.ts'
import {
  isStaged, isUnstaged, type DiffBranchRef, type DiffFile, type DiffShellInjected, type GitStatusEntry,
} from './shell.ts'
import css from './DiffPanel.module.css'

export type DiffPanelProps =
  & Pick<PropsRuntime<'surfaces.diff'>, 'sessionId' | 'useSessions'>
  & PropsLocale<typeof NS>
  & InjectFace<DiffShellInjected>
  & { openFile: (relativePath: string) => void | Promise<void> }

/** The git probes plus the session-bound workspace path opener. */
export interface DiffPanelInjected extends DiffShellInjected {
  openFile: (relativePath: string) => void | Promise<void>
}

/**
 * One open file's rendered slice: shared-format hunks, whether the panel-wide
 * row budget cut them, and whether the budget was already gone.
 */
interface FileView {
  hunks: ReviewHunk[]
  truncated: boolean
  omitted: boolean
}

/** The mounted-row ceiling across the whole panel; collapsed files never consume it. */
const PANEL_RENDER_BUDGET = MAX_RENDERED_LINES

/** The number of files above which rows start collapsed so a large diff mounts on demand. */
const COLLAPSE_FILE_THRESHOLD = 8

/**
 * Allocate the panel row budget across open files in display order and convert
 * each file's IPC hunks to the shared renderer's shape.
 * @param files - served files.
 * @param openPaths - expanded paths; only open files consume the budget.
 * @param order - display order of paths (staged+unstaged when known).
 * @returns per-path view data.
 */
function buildFileViews(files: readonly DiffFile[], openPaths: ReadonlySet<string>, order: readonly string[]): Map<string, FileView> {
  const views = new Map<string, FileView>()
  let remaining = PANEL_RENDER_BUDGET
  for (const path of order) {
    const file = files.find(entry => entry.path === path)
    if (file === undefined || !openPaths.has(path)) continue
    if (remaining === 0) {
      views.set(path, { hunks: [], truncated: false, omitted: true })
      continue
    }
    const review = file.hunks.map(toReviewHunk)
    const sliced = renderedHunks(review, remaining)
    remaining -= sliced.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
    views.set(path, { hunks: sliced.hunks, truncated: sliced.truncated, omitted: false })
  }
  return views
}

/**
 * Prefer origin HEAD, then main/master, then the first local branch.
 * @param branches - listed refs.
 * @param defaultRef - `refs/remotes/origin/HEAD` short name when present.
 */
export function pickBranchBase(branches: readonly DiffBranchRef[], defaultRef: string | null | undefined): string {
  if (typeof defaultRef === 'string' && defaultRef.length > 0) return defaultRef
  const marked = branches.find(branch => branch.isDefault)
  if (marked !== undefined) return marked.name
  const main = branches.find(branch => branch.name === 'main' || branch.name === 'master' || branch.name.endsWith('/main'))
  if (main !== undefined) return main.name
  const local = branches.find(branch => branch.isRemote !== true)
  return local?.name ?? 'main'
}

/**
 * Workspace diff body of the right Sidebar. Not a git repository shows the
 * Diff disabled reason.
 * @param props - session seats, git IPC, openFile, and copy.
 * @returns the diff panel.
 */
export function DiffPanel({
  sessionId,
  useSessions,
  openFile,
  gitStatus,
  gitDiff,
  gitStatusEntries,
  gitStage,
  gitUnstage,
  gitDiscard,
  gitBranchList,
  t,
}: DiffPanelProps): ReactNode {
  const cwd = useSessions((state) => {
    const id = sessionId ?? Object.values(state.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
    const next = id === undefined ? undefined : sessionWorkingDirectory(state.byId[id])
    return next ? next : undefined
  })
  const [available, setAvailable] = useState(false)
  const [files, setFiles] = useState<DiffFile[]>([])
  const [entries, setEntries] = useState<GitStatusEntry[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opError, setOpError] = useState<string | null>(null)
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(new Set())
  const [discardPath, setDiscardPath] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const [split, setSplit] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [scope, setScope] = useState<'worktree' | 'branch'>('worktree')
  const [baseRef, setBaseRef] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [branches, setBranches] = useState<DiffBranchRef[]>([])

  const reload = useCallback(() => { setGeneration(n => n + 1) }, [])

  useEffect(() => {
    const onFocus = (): void => { reload() }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [reload])

  useEffect(() => {
    if (cwd === undefined) {
      setAvailable(false)
      setFiles([])
      setEntries(null)
      setTruncated(false)
      setError(null)
      setOpError(null)
      return
    }
    let cancelled = false
    const options = scope === 'branch' && baseRef !== null ? { baseRef } : undefined
    const porcelainProbe = scope === 'worktree' ? gitStatusEntries(cwd) : Promise.resolve(null)
    void Promise.all([gitStatus(cwd), gitDiff(cwd, options), porcelainProbe]).then(([status, diff, porcelain]) => {
      if (cancelled) return
      if (status === null) {
        setAvailable(false)
        setFiles([])
        setEntries(null)
        setTruncated(false)
        setError(null)
        setOpError(null)
        return
      }
      if (diff === null) {
        setAvailable(true)
        setFiles([])
        setEntries(null)
        setTruncated(false)
        setError(t('error.load'))
        setOpError(null)
        return
      }
      setAvailable(true)
      setFiles(diff.files)
      setTruncated(diff.truncated === true)
      setEntries(porcelain?.ok === true ? porcelain.entries ?? [] : null)
      setOpenPaths(diff.files.length > COLLAPSE_FILE_THRESHOLD
        ? new Set()
        : new Set(diff.files.map(file => file.path)))
      setError(null)
      setOpError(null)
    }).catch(() => {
      if (!cancelled) {
        setError(t('error.load'))
        setOpError(null)
      }
    })
    return () => { cancelled = true }
  }, [cwd, gitStatus, gitDiff, gitStatusEntries, t, generation, scope, baseRef])

  const toggle = (path: string): void => {
    const next = new Set(openPaths)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setOpenPaths(next)
  }

  const runOp = async (
    op: (cwd: string, relativePath: string) => Promise<{ ok: boolean; message?: string }>,
    relativePath: string,
  ): Promise<void> => {
    /* v8 ignore next -- stage actions are not rendered without a cwd. */
    if (cwd === undefined) return
    const result = await op(cwd, relativePath)
    if (!result.ok) {
      setOpError(result.message ?? t('error.load'))
      return
    }
    setOpError(null)
    reload()
  }

  const staged = useMemo(() => entries?.filter(entry => isStaged(entry.xy)) ?? [], [entries])
  const unstaged = useMemo(() => entries?.filter(entry => isUnstaged(entry.xy)) ?? [], [entries])
  const displayOrder = useMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const path of [...staged, ...unstaged].map(entry => entry.path).concat(files.map(file => file.path))) {
      if (seen.has(path)) continue
      seen.add(path)
      order.push(path)
    }
    return order
  }, [staged, unstaged, files])

  const fileViews = useMemo(() => buildFileViews(files, openPaths, displayOrder), [files, openPaths, displayOrder])

  const fileNotes = (file: DiffFile, view: FileView): ReviewNote[] => {
    const notes: ReviewNote[] = []
    if (file.status === 'renamed' && file.oldPath !== undefined) {
      notes.push({ text: t('file.renamed', { from: file.oldPath }), attrs: { 'data-diff-note': 'renamed' } })
    }
    if (view.omitted) {
      notes.push({ text: t('file.omitted'), attrs: { 'data-diff-note': 'omitted' } })
      return notes
    }
    if (file.hunks.length === 0) {
      notes.push({ text: t('file.binary'), attrs: { 'data-diff-note': 'binary' } })
      return notes
    }
    if (view.truncated) {
      notes.push({ text: t('file.truncated', { count: String(PANEL_RENDER_BUDGET) }), attrs: { 'data-diff-note': 'truncated' } })
    }
    return notes
  }

  const hunksFor = (path: string): ReactNode => {
    const file = files.find(entry => entry.path === path)
    if (file === undefined) return null
    const view = fileViews.get(path)
    if (view === undefined) return null
    return (
      <div className={css.hunks}>
        {view.omitted
          ? fileNotes(file, view).map((note, index) => <p key={index} className={css.message} {...note.attrs}>{note.text}</p>)
          : (
            <ReviewDiff
              hunks={view.hunks}
              language={languageForPath(file.path)}
              split={split}
              wrap={wrap}
              notes={fileNotes(file, view)}
              skippedNote={t('diff.highlightSkipped')}
            />
          )}
      </div>
    )
  }

  const fileRow = (path: string, actions: ReactNode): ReactNode => (
    <div
      key={path}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement
        if (target.closest(`.${css.fileTitle}`) !== null) void openFile(path)
      }}
    >
      <DisclosureRow
        icon={<IconCodeOutline16 size={14} />}
        title={path}
        titleClassName={css.fileTitle}
        open={openPaths.has(path)}
        expandable
        onToggle={() => { toggle(path) }}
        collapsedContent={actions}
        keepContentWhenOpen
      >
        {hunksFor(path)}
      </DisclosureRow>
    </div>
  )

  const scopeLabel = scope === 'branch' && baseRef !== null
    ? `${t('scope.branch')} · ${baseRef}`
    : t('scope.worktree')
  const normalizedQuery = query.trim().toLowerCase()
  const branchItems = branches
    .filter(branch => normalizedQuery.length === 0 || branch.name.toLowerCase().includes(normalizedQuery))
    .map(branch => ({
      id: `ref:${branch.name}`,
      label: branch.name,
    }))

  const closeMenu = (): void => {
    setMenuOpen(false)
    setQuery('')
  }

  return (
    <div className={css.root} data-diff-panel>
      <div className={css.toolbar}>
        <Menu
          open={menuOpen}
          portal
          onClose={closeMenu}
          selectedId={scope === 'worktree' ? 'worktree' : `ref:${baseRef ?? ''}`}
          filter={{
            value: query,
            placeholder: t('scope.search'),
            label: t('scope.search'),
            onChange: setQuery,
          }}
          onSelect={(id) => {
            closeMenu()
            if (id === 'worktree') {
              setScope('worktree')
              setBaseRef(null)
              reload()
              return
            }
            const name = id.startsWith('ref:') ? id.slice(4) : id
            setScope('branch')
            setBaseRef(name)
            reload()
          }}
          items={[
            { id: 'worktree', label: t('scope.worktree') },
            { type: 'separator', id: 'sep-scope' },
            { type: 'label', id: 'branch-label', text: t('scope.branch') },
            ...branchItems,
          ]}
          anchor={(
            <button
              type="button"
              className={css.scope}
              aria-label={scopeLabel}
              onClick={() => {
                const next = !menuOpen
                setMenuOpen(next)
                if (next && cwd !== undefined) {
                  void gitBranchList(cwd).then((listed) => {
                    if (listed?.ok !== true) {
                      setBranches([])
                      return
                    }
                    const nextBranches = listed.branches ?? []
                    setBranches(nextBranches)
                    if (scope === 'worktree' && baseRef === null) {
                      setBaseRef(pickBranchBase(nextBranches, listed.defaultRef))
                    }
                  })
                }
              }}
            >
              {scopeLabel}
            </button>
          )}
        />
        <button
          type="button"
          className={css.action}
          onClick={() => { setOpenPaths(new Set()) }}
        >
          {t('collapseAll')}
        </button>
        <button
          type="button"
          className={css.action}
          onClick={() => { setOpenPaths(new Set(files.map(file => file.path))) }}
        >
          {t('expandAll')}
        </button>
        <Tooltip label={t(split ? 'view.unified' : 'view.split')} side="bottom">
          <button
            type="button"
            className={css.refresh}
            aria-pressed={split}
            aria-label={t('view.splitAria')}
            data-diff-tool="split"
            onClick={() => { setSplit(value => !value) }}
          >
            <IconCompareSplitOutlineRegular />
          </button>
        </Tooltip>
        <Tooltip label={t(wrap ? 'view.nowrap' : 'view.wrap')} side="bottom">
          <button
            type="button"
            className={css.refresh}
            aria-pressed={wrap}
            aria-label={t('view.wrapAria')}
            data-diff-tool="wrap"
            onClick={() => { setWrap(value => !value) }}
          >
            {wrap ? <IconNowrapFillRegular /> : <IconWrapFillRegular />}
          </button>
        </Tooltip>
        <Tooltip label={t('refresh')} side="bottom">
          <button
            type="button"
            className={css.refresh}
            aria-label={t('refresh')}
            onClick={() => { reload() }}
          >
            <IconRefreshOutline16 size={14} />
          </button>
        </Tooltip>
      </div>
      <div className={css.body}>
        {cwd === undefined ? (
          <p className={css.message}>{t('empty.cwd')}</p>
        ) : error !== null ? (
          <p className={css.message}>{error}</p>
        ) : !available ? (
          <p className={css.message} data-diff-unavailable>{t('unavailable')}</p>
        ) : (
          <>
            {opError !== null ? <p className={css.opError} role="alert">{opError}</p> : null}
            {entries !== null ? (
          <>
            {truncated ? <p className={css.message}>{t('truncated')}</p> : null}
            {staged.length === 0 && unstaged.length === 0 ? (
              <p className={css.message}>{t('empty.changes')}</p>
            ) : (
              <>
                {staged.length > 0 ? (
                  <section>
                    <h4 className={css.group}>{t('group.staged')}</h4>
                    {staged.map(entry => fileRow(entry.path, (
                      <button
                        type="button"
                        className={css.action}
                        onClick={(event) => {
                          event.stopPropagation()
                          void runOp(gitUnstage, entry.path)
                        }}
                      >
                        {t('unstage')}
                      </button>
                    )))}
                  </section>
                ) : null}
                {unstaged.length > 0 ? (
                  <section>
                    <h4 className={css.group}>{t('group.unstaged')}</h4>
                    {unstaged.map(entry => fileRow(entry.path, (
                      <>
                        <button
                          type="button"
                          className={css.action}
                          onClick={(event) => {
                            event.stopPropagation()
                            void runOp(gitStage, entry.path)
                          }}
                        >
                          {t('stage')}
                        </button>
                        <button
                          type="button"
                          className={css.action}
                          onClick={(event) => {
                            event.stopPropagation()
                            setDiscardPath(entry.path)
                          }}
                        >
                          {t('discard')}
                        </button>
                      </>
                    )))}
                  </section>
                ) : null}
              </>
            )}
          </>
        ) : files.length === 0 ? (
          <p className={css.message}>{t('empty.changes')}</p>
        ) : (
          <>
            {truncated ? <p className={css.message}>{t('truncated')}</p> : null}
            {files.map(file => fileRow(file.path, null))}
          </>
            )}
          </>
        )}
      </div>
      <Modal
        open={discardPath !== null}
        onClose={() => { setDiscardPath(null) }}
        title={t('discard.title')}
        closeLabel={t('discard.cancel')}
        description={t('discard.body')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setDiscardPath(null) }}>{t('discard.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const path = discardPath
                setDiscardPath(null)
                /* v8 ignore next -- confirm is only rendered while discardPath is set. */
                if (path !== null) void runOp(gitDiscard, path)
              }}
            >
              {t('discard.confirm')}
            </Button>
          </>
        )}
      />
    </div>
  )
}
