import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  Button, DEFAULT_PROGRESSIVE_CHUNK_LINES, DisclosureRow, IconCodeOutline16, IconCompareSplitOutlineRegular,
  IconNowrapFillRegular, IconRefreshOutline16, IconWarningOutline16, IconWrapFillRegular, languageForPath,
  Menu, Modal, ReviewDiff, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReviewHunk, ReviewLineCommentTarget, ReviewNote } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { buildSingleHunkPatch, formatDiffLineComment } from './hunk-patch.ts'
import { NS } from './locales.ts'
import {
  buildFileViews, buildVisibleRows, canPatchSingleHunk, COLLAPSE_FILE_THRESHOLD, needsSingleFileFetch,
  PANEL_RENDER_BUDGET, resolveRowFile, type FileView, type VisibleDiffRow,
} from './panel-model.ts'
import {
  isStaged, isUnstaged, type DiffBranchRef, type DiffFile, type DiffShellInjected, type GitDiffOptions,
  type GitStatusEntry,
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

type PendingFileAction = 'stage' | 'unstage' | 'discard' | 'stage-hunk' | 'unstage-hunk'

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
  gitStagePatch,
  gitUnstagePatch,
  appendComposerText,
  t,
}: DiffPanelProps): ReactNode {
  const resolvedSessionId = useSessions((state) => {
    return sessionId ?? Object.values(state.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
  })
  const cwd = useSessions((state) => {
    const next = resolvedSessionId === undefined ? undefined : sessionWorkingDirectory(state.byId[resolvedSessionId])
    return next ? next : undefined
  })
  const [available, setAvailable] = useState(false)
  const [files, setFiles] = useState<DiffFile[]>([])
  const [sectionFiles, setSectionFiles] = useState<Readonly<Record<string, DiffFile>>>({})
  const [loadingKeys, setLoadingKeys] = useState<ReadonlySet<string>>(new Set())
  const [entries, setEntries] = useState<GitStatusEntry[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ id: number; text: string; retry: () => void } | null>(null)
  const notificationId = useRef(0)
  const [loading, setLoading] = useState(cwd !== undefined)
  const [branchLoading, setBranchLoading] = useState(false)
  const [pendingOps, setPendingOps] = useState<Readonly<Record<string, PendingFileAction>>>({})
  const [pendingHunkKey, setPendingHunkKey] = useState<string | null>(null)
  const inFlightOps = useRef(new Set<string>())
  const activeLoadIdRef = useRef(0)
  const attemptedKeysRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const notifyError = useCallback((text: string, retry: () => void): void => {
    setNotification({ id: ++notificationId.current, text, retry })
  }, [])
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set())
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
    const loadId = ++activeLoadIdRef.current
    attemptedKeysRef.current.clear()
    setSectionFiles({})
    setLoadingKeys(new Set())
    if (cwd === undefined) {
      setAvailable(false)
      setFiles([])
      setEntries(null)
      setTruncated(false)
      setOpenKeys(new Set())
      setError(null)
      setNotification(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const options = scope === 'branch' && baseRef !== null ? { baseRef } : undefined
    const porcelainProbe = scope === 'worktree' ? gitStatusEntries(cwd) : Promise.resolve(null)
    void Promise.all([gitStatus(cwd), gitDiff(cwd, options), porcelainProbe]).then(([status, diff, porcelain]) => {
      if (cancelled || activeLoadIdRef.current !== loadId) return
      if (status === null) {
        setAvailable(false)
        setFiles([])
        setEntries(null)
        setTruncated(false)
        setOpenKeys(new Set())
        setError(null)
        setNotification(null)
        return
      }
      if (diff === null) {
        setAvailable(true)
        setFiles([])
        setEntries(null)
        setTruncated(false)
        setOpenKeys(new Set())
        setError(t('error.load'))
        notifyError(t('error.load'), reload)
        return
      }
      const porcelainEntries = porcelain?.ok === true ? porcelain.entries ?? [] : null
      const nextStaged = porcelainEntries?.filter(entry => isStaged(entry.xy)) ?? []
      const nextUnstaged = porcelainEntries?.filter(entry => isUnstaged(entry.xy)) ?? []
      const initialRows = buildVisibleRows(scope, porcelainEntries, nextStaged, nextUnstaged, diff.files)
      const rowCount = porcelainEntries !== null ? Math.max(diff.files.length, initialRows.length) : diff.files.length
      setAvailable(true)
      setFiles(diff.files)
      setTruncated(diff.truncated === true)
      setEntries(porcelainEntries)
      setOpenKeys(rowCount > COLLAPSE_FILE_THRESHOLD ? new Set() : new Set(initialRows.map(row => row.key)))
      setError(null)
      setNotification(null)
    }).catch(() => {
      if (!cancelled && activeLoadIdRef.current === loadId) {
        setError(t('error.load'))
        notifyError(t('error.load'), reload)
      }
    }).finally(() => {
      if (!cancelled && activeLoadIdRef.current === loadId) setLoading(false)
    })
    return () => { cancelled = true }
  }, [cwd, gitStatus, gitDiff, gitStatusEntries, t, generation, scope, baseRef, notifyError, reload])

  const staged = useMemo(() => entries?.filter(entry => isStaged(entry.xy)) ?? [], [entries])
  const unstaged = useMemo(() => entries?.filter(entry => isUnstaged(entry.xy)) ?? [], [entries])
  const visibleRows = useMemo(
    () => buildVisibleRows(scope, entries, staged, unstaged, files),
    [scope, entries, staged, unstaged, files],
  )

  useEffect(() => {
    if (loading || !available || cwd === undefined) return
    const loadId = activeLoadIdRef.current
    const pendingRows: VisibleDiffRow[] = []
    for (const row of visibleRows) {
      if (!openKeys.has(row.key)) continue
      const attemptToken = `${loadId}:${row.key}`
      if (attemptedKeysRef.current.has(attemptToken)) continue
      const initialFile = files.find(file => file.path === row.path)
      if (!needsSingleFileFetch(row, initialFile, truncated, files.length, scope)) continue
      attemptedKeysRef.current.add(attemptToken)
      pendingRows.push(row)
    }
    if (pendingRows.length === 0) return

    setLoadingKeys((previous) => {
      const next = new Set(previous)
      for (const row of pendingRows) next.add(row.key)
      return next
    })

    for (const row of pendingRows) {
      const singleOptions: GitDiffOptions = scope === 'branch' && baseRef !== null
        ? { baseRef, path: row.path }
        : row.section === 'staged'
          ? { path: row.path, staged: true }
          : row.section === 'unstaged'
            ? { path: row.path, staged: false }
            : { path: row.path }
      void gitDiff(cwd, singleOptions)
        .then((result) => {
          if (!mountedRef.current || activeLoadIdRef.current !== loadId) return
          const matched = result?.files.find(entry => entry.path === row.path)
          if (matched !== undefined) {
            setSectionFiles(previous => ({ ...previous, [row.key]: matched }))
          }
        })
        .catch(() => {
          // Smooth fallback to initial bulk diff without retry loop when single-file probe rejects.
        })
        .finally(() => {
          if (!mountedRef.current || activeLoadIdRef.current !== loadId) return
          setLoadingKeys((previous) => {
            if (!previous.has(row.key)) return previous
            const next = new Set(previous)
            next.delete(row.key)
            return next
          })
        })
    }
  }, [loading, available, cwd, visibleRows, openKeys, files, truncated, scope, baseRef, gitDiff])

  const toggle = (key: string): void => {
    const next = new Set(openKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setOpenKeys(next)
  }

  const runOp = async (
    op: (cwd: string, relativePath: string) => Promise<{ ok: boolean; message?: string }>,
    relativePath: string,
    action: 'stage' | 'unstage' | 'discard',
  ): Promise<void> => {
    /* v8 ignore next -- stage actions are not rendered without a cwd. */
    if (cwd === undefined || inFlightOps.current.has(relativePath)) return
    inFlightOps.current.add(relativePath)
    setPendingOps(previous => ({ ...previous, [relativePath]: action }))
    const retry = (): void => { void runOp(op, relativePath, action) }
    try {
      const result = await op(cwd, relativePath)
      if (!result.ok) {
        notifyError(result.message ?? t('error.load'), retry)
        return
      }
      setNotification(null)
      reload()
    } catch (reason) {
      notifyError(reason instanceof Error ? reason.message : t('error.load'), retry)
    } finally {
      inFlightOps.current.delete(relativePath)
      setPendingOps(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== relativePath)))
    }
  }

  const runHunkOp = async (
    op: (cwd: string, patchText: string) => Promise<{ ok: boolean; message?: string }>,
    relativePath: string,
    patchText: string,
    action: 'stage-hunk' | 'unstage-hunk',
    hunkOpKey: string,
  ): Promise<void> => {
    if (cwd === undefined || inFlightOps.current.has(relativePath)) return
    inFlightOps.current.add(relativePath)
    setPendingOps(previous => ({ ...previous, [relativePath]: action }))
    setPendingHunkKey(hunkOpKey)
    const retry = (): void => { void runHunkOp(op, relativePath, patchText, action, hunkOpKey) }
    try {
      const result = await op(cwd, patchText)
      if (!result.ok) {
        notifyError(result.message ?? t('error.load'), retry)
        return
      }
      setNotification(null)
      reload()
    } catch (reason) {
      notifyError(reason instanceof Error ? reason.message : t('error.load'), retry)
    } finally {
      inFlightOps.current.delete(relativePath)
      setPendingHunkKey(current => (current === hunkOpKey ? null : current))
      setPendingOps(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== relativePath)))
    }
  }

  const openWorkspaceFile = async (path: string): Promise<void> => {
    try { await openFile(path) }
    catch (reason) {
      notifyError(reason instanceof Error ? reason.message : t('error.open'), () => { void openWorkspaceFile(path) })
    }
  }

  const fileViews = useMemo(
    () => buildFileViews(visibleRows, openKeys, files, sectionFiles),
    [visibleRows, openKeys, files, sectionFiles],
  )

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
      notes.push(file.tooLarge === true
        ? { text: t('file.tooLarge'), attrs: { 'data-diff-note': 'too-large' } }
        : { text: t('file.binary'), attrs: { 'data-diff-note': 'binary' } })
      return notes
    }
    if (view.truncated) {
      notes.push({ text: t('file.truncated', { count: String(PANEL_RENDER_BUDGET) }), attrs: { 'data-diff-note': 'truncated' } })
    }
    return notes
  }

  const hunksFor = (row: VisibleDiffRow): ReactNode => {
    const file = resolveRowFile(row.key, row.path, files, sectionFiles)
    if (file === undefined) {
      if (!loadingKeys.has(row.key)) return null
      return (
        <div className={css.hunks}>
          <p className={css.message} data-diff-note="loading">{t('file.loading')}</p>
        </div>
      )
    }
    const view = fileViews.get(row.key)
    if (view === undefined) return null

    const hasSectionFile = sectionFiles[row.key] !== undefined
    const canOfferHunkSlot = scope === 'worktree'
      && entries !== null
      && row.section !== 'combined'
      && (row.section === 'staged' ? gitUnstagePatch !== undefined : gitStagePatch !== undefined)

    const renderHunkActions = canOfferHunkSlot
      ? (hunk: ReviewHunk, index: number): ReactNode => {
        const allowed = canPatchSingleHunk({
          scope,
          section: row.section,
          entry: row.entry,
          file,
          view,
          hunkIndex: index,
          renderedHunk: hunk,
          hasStagePatch: gitStagePatch !== undefined,
          hasUnstagePatch: gitUnstagePatch !== undefined,
          hasSectionFile,
        })
        if (!allowed) return null
        const patchOp = row.section === 'staged' ? gitUnstagePatch : gitStagePatch
        if (patchOp === undefined) return null
        const patchText = buildSingleHunkPatch(file, file.hunks[index] ?? hunk)
        if (patchText === null) return null
        const action = row.section === 'staged' ? 'unstage-hunk' : 'stage-hunk'
        const hunkOpKey = `${row.key}:${index}`
        return (
          <button
            type="button"
            className={css.hunkAction}
            data-diff-hunk-action={action}
            aria-busy={pendingHunkKey === hunkOpKey || undefined}
            disabled={pendingOps[row.path] !== undefined}
            onClick={(event) => {
              event.stopPropagation()
              void runHunkOp(patchOp, row.path, patchText, action, hunkOpKey)
            }}
          >
            {t(row.section === 'staged' ? 'hunk.unstage' : 'hunk.stage')}
          </button>
        )
      }
      : undefined

    const handleLineComment = appendComposerText !== undefined && resolvedSessionId !== undefined
      ? (target: ReviewLineCommentTarget): void => {
        appendComposerText(resolvedSessionId, formatDiffLineComment(file.path, target))
      }
      : undefined

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
              renderHunkActions={renderHunkActions}
              onLineComment={handleLineComment}
              lineCommentLabel={t('line.comment')}
              progressiveChunkLines={DEFAULT_PROGRESSIVE_CHUNK_LINES}
              showMoreLabel={(remaining, nextCount) => t('diff.showMore', { next: String(nextCount), remaining: String(remaining) })}
              expandRemainingLabel={remaining => t('diff.expandRemaining', { remaining: String(remaining) })}
            />
          )}
      </div>
    )
  }

  const fileRow = (row: VisibleDiffRow, actions: ReactNode): ReactNode => (
    <div
      key={row.key}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement
        if (target.closest(`.${css.fileTitle}`) !== null) void openWorkspaceFile(row.path)
      }}
    >
      <DisclosureRow
        icon={<IconCodeOutline16 size={14} />}
        title={row.path}
        titleClassName={css.fileTitle}
        open={openKeys.has(row.key)}
        expandable
        onToggle={() => { toggle(row.key) }}
        collapsedContent={actions}
        keepContentWhenOpen
      >
        {hunksFor(row)}
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
  const loadBranches = (): void => {
    if (cwd === undefined) return
    setBranchLoading(true)
    void gitBranchList(cwd).then((listed) => {
      if (listed?.ok !== true) {
        setBranches([])
        notifyError(listed?.message ?? t('error.branches'), loadBranches)
        return
      }
      const nextBranches = listed.branches ?? []
      setBranches(nextBranches)
      if (scope === 'worktree' && baseRef === null) setBaseRef(pickBranchBase(nextBranches, listed.defaultRef))
    }).catch((reason: unknown) => {
      notifyError(reason instanceof Error ? reason.message : t('error.branches'), loadBranches)
    }).finally(() => { setBranchLoading(false) })
  }

  const stagedRows = visibleRows.filter(row => row.section === 'staged')
  const unstagedRows = visibleRows.filter(row => row.section === 'unstaged')
  const combinedRows = visibleRows.filter(row => row.section === 'combined')

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
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className={css.scope}
              aria-label={scopeLabel}
              loading={branchLoading}
              onClick={() => {
                const next = !menuOpen
                setMenuOpen(next)
                if (next) loadBranches()
              }}
            >
              {scopeLabel}
            </Button>
          )}
        />
        <button
          type="button"
          className={css.action}
          onClick={() => { setOpenKeys(new Set()) }}
        >
          {t('collapseAll')}
        </button>
        <button
          type="button"
          className={css.action}
          onClick={() => { setOpenKeys(new Set(visibleRows.map(row => row.key))) }}
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
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className={css.refresh}
            aria-label={t('refresh')}
            loading={loading}
            onClick={() => { reload() }}
          >
            <IconRefreshOutline16 size={14} />
          </Button>
        </Tooltip>
      </div>
      <div className={css.body}>
        {cwd === undefined ? (
          <p className={css.message}>{t('empty.cwd')}</p>
        ) : error !== null ? (
          null
        ) : !available ? (
          loading ? null : <p className={css.message} data-diff-unavailable>{t('unavailable')}</p>
        ) : (
          <>
            {entries !== null && scope === 'worktree' ? (
              <>
                {truncated ? <p className={css.message}>{t('truncated')}</p> : null}
                {stagedRows.length === 0 && unstagedRows.length === 0 ? (
                  <p className={css.message}>{t('empty.changes')}</p>
                ) : (
                  <>
                    {stagedRows.length > 0 ? (
                      <section>
                        <h4 className={css.group}>{t('group.staged')}</h4>
                        {stagedRows.map(row => fileRow(row, (
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            className={css.action}
                            disabled={pendingOps[row.path] !== undefined}
                            loading={pendingOps[row.path] === 'unstage'}
                            onClick={(event) => {
                              event.stopPropagation()
                              void runOp(gitUnstage, row.path, 'unstage')
                            }}
                          >
                            {t('unstage')}
                          </Button>
                        )))}
                      </section>
                    ) : null}
                    {unstagedRows.length > 0 ? (
                      <section>
                        <h4 className={css.group}>{t('group.unstaged')}</h4>
                        {unstagedRows.map(row => fileRow(row, (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              className={css.action}
                              disabled={pendingOps[row.path] !== undefined}
                              loading={pendingOps[row.path] === 'stage'}
                              onClick={(event) => {
                                event.stopPropagation()
                                void runOp(gitStage, row.path, 'stage')
                              }}
                            >
                              {t('stage')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              className={css.action}
                              disabled={pendingOps[row.path] !== undefined}
                              loading={pendingOps[row.path] === 'discard'}
                              onClick={(event) => {
                                event.stopPropagation()
                                setDiscardPath(row.path)
                              }}
                            >
                              {t('discard')}
                            </Button>
                          </>
                        )))}
                      </section>
                    ) : null}
                  </>
                )}
              </>
            ) : combinedRows.length === 0 ? (
              <p className={css.message}>{t('empty.changes')}</p>
            ) : (
              <>
                {truncated ? <p className={css.message}>{t('truncated')}</p> : null}
                {combinedRows.map(row => fileRow(row, null))}
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
                if (path !== null) void runOp(gitDiscard, path, 'discard')
              }}
            >
              {t('discard.confirm')}
            </Button>
          </>
        )}
      />
      {notification !== null && <Toast key={notification.id} text={notification.text}
        icon={<IconWarningOutline16 />} holdMs={null} dismissLabel={t('feedback.close')}
        actions={[{ label: t('retry'), onClick: notification.retry }]}
        onDone={() => { setNotification(null) }} />}
    </div>
  )
}
