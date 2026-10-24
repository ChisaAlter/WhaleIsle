import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconCloudUploadOutline16,
  IconCommitOutline16,
  IconPullRequestOutline16,
  Menu,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-api-session-controller/types'
import type {
  DefaultBranchConfirmableAction,
  GitActionIconName,
  GitProgressEvent,
  GitResult,
  GitStackedAction,
  StackedActionResult,
  VcsStatus,
} from './git-logic.ts'
import {
  attachOpenPrForCta,
  buildGitActionProgressStages,
  buildMenuItems,
  getChangeRequestTerminology,
  getMenuActionDisabledReason,
  GIT_STATUS_WINDOW_REFRESH_DEBOUNCE_MS,
  requiresDefaultBranchConfirmation,
  resolveCompletionCta,
  resolveDefaultBranchActionDialogCopy,
  resolveQuickAction,
  summarizeGitActionResult,
  toastFailureDescription,
} from './git-logic.ts'
import { NS } from './locales.ts'
import { BranchMenu } from './BranchMenu.tsx'
import type { BranchRef } from './branches.ts'
import { CommitDialog, type CommitFileRow, type LargeFileWarning } from './CommitDialog.tsx'
import { GitProgressToast, type GitProgressState } from './GitProgressToast.tsx'
import { PublishDialog } from './PublishDialog.tsx'
import css from './GitActionsControl.module.css'
import labelCss from './GitLabel.module.css'

/** Must match ui-surfaces; client packages cannot share a value export. */
const GIT_INIT_EVENT = 'dshd-git-init'

/** Desktop git IPC the plugin injects from `window.shell`. */
export interface GitActionsInjected {
  gitStatus: (cwd: string) => Promise<VcsStatus | null>
  gitFetchForStatus: (cwd: string) => Promise<VcsStatus | null>
  gitReadPullRequest: (cwd: string) => Promise<GitResult & { pr?: VcsStatus['pr'] }>
  gitInit: (cwd: string) => Promise<GitResult>
  gitCommit: (cwd: string, message: string, filePaths?: readonly string[], actionId?: number, options?: { featureBranch?: boolean }) => Promise<GitResult>
  gitPush: (cwd: string, actionId?: number) => Promise<GitResult>
  gitPull: (cwd: string, actionId?: number) => Promise<GitResult>
  onGitProgress: (handler: (event: GitProgressEvent) => void) => () => void
  /**
   * Desktop signal that the harness workspace registry changed (a workspace
   * was registered or removed); returns the unsubscribe. The first status
   * read after opening a workspace can race the registry write and come back
   * unauthorized, and this signal is what recovers it without a window focus.
   */
  onWorkspacesChanged: (handler: () => void) => () => void
  gitCreateChangeRequest: (cwd: string, input?: { title?: string; body?: string }, actionId?: number) => Promise<GitResult>
  gitPublishRepository: (cwd: string, input: { name: string; visibility: 'public' | 'private'; remoteUrl?: string }, actionId?: number) => Promise<GitResult>
  gitBranchList: (cwd: string) => Promise<{ ok: boolean; message?: string; branches?: BranchRef[] }>
  gitCheckLargeFiles: (cwd: string) => Promise<GitResult & { files?: Array<{ path: string; size: number }> }>
  gitSwitchBranch: (cwd: string, ref: string) => Promise<GitResult & { refName?: string }>
  gitCreateBranch: (cwd: string, name: string) => Promise<GitResult & { refName?: string }>
  openExternal: (url: string) => Promise<boolean>
  openWorkspacePath: (cwd: string, relativePath: string) => Promise<GitResult>
  hooks: {
    /** Persisted titlebar Git visibility bound as useTitlebarGit. */
    titlebarGit: SnapshotStore<boolean>
  }
}

export type GitActionsProps =
  PropsRuntime<'shell.titlebar.trailing'>
  & PropsLocale<typeof NS>
  & InjectFace<GitActionsInjected>

interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction
  branchName: string
  includesCommit: boolean
  commitMessage?: string
  filePaths?: readonly string[]
}

function localizeGitLabel(label: string, t: GitActionsProps['t']): string {
  if (label === 'Commit') return t('action.commit')
  if (label === 'Commit & push') return t('action.commitPush')
  if (label === 'Push') return t('action.push')
  if (label === 'Pull') return t('action.pull')
  if (label === 'Publish repository') return t('action.publish')
  if (label === 'Sync ref') return t('action.sync')
  const pushCreate = 'Push & create '
  if (label.startsWith(pushCreate)) return t('action.pushCreate', { short: label.slice(pushCreate.length) })
  const commitPushCreate = 'Commit, push & '
  if (label.startsWith(commitPushCreate)) {
    return t('action.commitPushCreate', { short: label.slice(commitPushCreate.length) })
  }
  const view = 'View '
  if (label.startsWith(view)) return t('action.view', { short: label.slice(view.length) })
  const create = 'Create '
  if (label.startsWith(create)) return t('action.create', { short: label.slice(create.length) })
  /* v8 ignore next -- git-logic labels are a closed set; unknown strings pass through. */
  return label
}

function iconFor(name: GitActionIconName): ReactNode {
  if (name === 'commit') return <IconCommitOutline16 size={14} />
  if (name === 'push') return <IconCloudUploadOutline16 size={14} />
  return <IconPullRequestOutline16 size={14} />
}

function quickIcon(action: { kind: string; action?: string; label: string }): GitActionIconName {
  if (action.kind === 'open_pr') return 'pr'
  if (action.action === 'commit' || action.label === 'Commit') return 'commit'
  return 'push'
}

function failureMessage(result: GitResult, fallback: string): string | undefined {
  if (result.ok) return undefined
  const message = result.message?.trim()
  return message !== undefined && message !== '' ? message : fallback
}

/** Message for a rejected git IPC promise, so the progress toast never hangs in loading. */
function thrownMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  const text = String(error).trim()
  return text !== '' && text !== 'undefined' && text !== 'null' ? text : fallback
}

function foldCommit(result: GitResult): NonNullable<StackedActionResult['commit']> {
  return {
    status: result.skipped ? 'skipped' : 'created',
    ...(result.commitSha ? { commitSha: result.commitSha } : {}),
    ...(result.subject ? { subject: result.subject } : {}),
  }
}

function foldPush(result: GitResult): NonNullable<StackedActionResult['push']> {
  return {
    status: result.skipped ? 'skipped' : 'pushed',
    ...(result.branch || result.refName ? { branch: result.branch ?? result.refName } : {}),
    ...(result.upstreamBranch ? { upstreamBranch: result.upstreamBranch } : {}),
  }
}

function foldPr(result: GitResult): NonNullable<StackedActionResult['pr']> {
  if (result.skipped) {
    return {
      status: 'opened_existing',
      ...(result.url ? { url: result.url } : {}),
      ...(result.number ? { number: result.number } : {}),
      ...(result.title ? { title: result.title } : {}),
    }
  }
  return {
    status: result.status === 'opened_existing' ? 'opened_existing' : 'created',
    ...(result.url ? { url: result.url } : {}),
    ...(result.number ? { number: result.number } : {}),
    ...(result.title ? { title: result.title } : {}),
  }
}

/**
 * Narrow host-reported large files to the ones this commit will contain.
 * The host scans every changed path; the dialog lets the user exclude some,
 * and an excluded file is no longer a candidate. A new untracked directory
 * reaches the dialog collapsed to `dir/`, so a warned path nested under a
 * selected directory entry is still selected.
 * @param largeFiles - paths the host found over the hosting limit.
 * @param files - the dialog's live file rows.
 * @param excluded - paths the user removed from this commit.
 * @returns the warnings to show, in host order.
 */
function selectedLargeFiles(
  largeFiles: readonly LargeFileWarning[],
  files: readonly CommitFileRow[],
  excluded: ReadonlySet<string>,
): LargeFileWarning[] {
  const selected = files.filter(file => !excluded.has(file.path)).map(file => file.path)
  return largeFiles.filter(warning => selected.some(entry => (
    entry === warning.path || (entry.endsWith('/') && warning.path.startsWith(entry))
  )))
}

/**
 * Render the titlebar Git split button, dropdown, commit dialog, and default-ref confirm.
 * @param props - titlebar owner widths and density, current-session seats, git IPC, and copy.
 * @returns the split button and any open dialogs.
 */
export function GitActionsControl({
  density = 'full',
  managedSession,
  useSessions,
  useTitlebarGit,
  gitStatus,
  gitFetchForStatus,
  gitReadPullRequest,
  gitInit,
  gitCommit,
  gitPush,
  gitPull,
  onGitProgress,
  onWorkspacesChanged,
  gitCreateChangeRequest,
  gitPublishRepository,
  gitBranchList,
  gitCheckLargeFiles,
  gitSwitchBranch,
  gitCreateBranch,
  openExternal,
  openWorkspacePath,
  t,
}: GitActionsProps): ReactNode {
  const cwd = useSessions((s) => {
    // A presented working directory (a Project's repository) outranks the
    // Session's own cwd, matching the terminal and open-in-app targets.
    const mainView = Object.values(s.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)
    return sessionWorkingDirectory(mainView)
  })
  const showChrome = useTitlebarGit(value => value)
  const [status, setStatus] = useState<VcsStatus | null>(null)
  const [loadedCwd, setLoadedCwd] = useState<string | null>(null)
  const loaded = cwd !== undefined && loadedCwd === cwd
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [revealedParts, setRevealedParts] = useState({ branch: false, action: false })
  const [commitOpen, setCommitOpen] = useState(false)
  const [largeFiles, setLargeFiles] = useState<LargeFileWarning[]>([])
  const [commitMessage, setCommitMessage] = useState('')
  const [excludedFiles, setExcludedFiles] = useState<Set<string>>(() => new Set())
  const [editingFiles, setEditingFiles] = useState(false)
  const [pending, setPending] = useState<PendingDefaultBranchAction | null>(null)
  const [progress, setProgress] = useState<GitProgressState | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishName, setPublishName] = useState('')
  const [publishVisibility, setPublishVisibility] = useState<'public' | 'private'>('private')
  const [publishRemoteUrl, setPublishRemoteUrl] = useState('')
  const actionSeq = useRef(0)
  const refreshSeq = useRef(0)
  const largeFileScanSeq = useRef(0)
  const lastProgressLine = useRef<string | null>(null)
  const currentPhaseLabel = useRef('Running git action...')

  const beginProgress = (title: string): number => {
    const id = actionSeq.current + 1
    actionSeq.current = id
    lastProgressLine.current = null
    currentPhaseLabel.current = title
    setProgress({
      tone: 'loading',
      title,
      description: t('progress.waiting'),
      startedAt: null,
    })
    return id
  }

  const failProgress = (message: string, title = t('error.title')): void => {
    setProgress({
      tone: 'error',
      title,
      description: toastFailureDescription(message, lastProgressLine.current, t('error.fallback')),
      details: message,
      startedAt: null,
      copyLabel: t('progress.copy'),
      detailsLabel: t('progress.details'),
      hideDetailsLabel: t('progress.hideDetails'),
    })
  }

  const succeedProgress = (
    title: string,
    description?: string | undefined,
    action?: { label: string; onAction: () => void } | undefined,
  ): void => {
    setProgress({
      tone: 'success',
      title,
      ...(description ? { description } : {}),
      startedAt: null,
      ...(action ? { actionLabel: action.label, onAction: action.onAction } : {}),
    })
  }

  // Rejected refresh IPC promises degrade like the desktop guard's fallback
  // payloads (`null` snapshot / `ok:false` result): the local snapshot stays,
  // and nothing becomes an unhandled rejection. `refresh` is fired with
  // `void` from effects and `finally` blocks, so it must never reject.
  const statusOrNull = (target: string): Promise<VcsStatus | null> => gitStatus(target).catch(() => null)
  const fetchStatusOrNull = (target: string): Promise<VcsStatus | null> => gitFetchForStatus(target).catch(() => null)
  const readPullRequestOrFailure = (target: string): ReturnType<typeof gitReadPullRequest> => (
    gitReadPullRequest(target).catch(() => ({ ok: false }))
  )

  const refresh = async (target: string): Promise<VcsStatus | null> => {
    const token = refreshSeq.current + 1
    refreshSeq.current = token
    const next = await statusOrNull(target)
    if (token !== refreshSeq.current) return next
    // Only keep a prior PR badge when still on the same ref.
    setStatus(prev => (
      next && prev?.refName && next.refName === prev.refName
        ? { ...next, pr: next.pr ?? prev.pr ?? null }
        : next
    ))
    setLoadedCwd(target)
    void fetchStatusOrNull(target).then((fresh) => {
      if (token !== refreshSeq.current || !fresh) return
      setStatus(prev => (
        prev?.refName && fresh.refName === prev.refName
          ? { ...fresh, pr: prev.pr ?? fresh.pr ?? null }
          : fresh
      ))
    })
    void readPullRequestOrFailure(target).then((result) => {
      if (token !== refreshSeq.current || !result.ok) return
      setStatus(prev => (prev ? { ...prev, pr: result.pr ?? null } : prev))
    })
    return next
  }

  const settleStatus = async (target: string): Promise<VcsStatus | null> => {
    const token = refreshSeq.current + 1
    refreshSeq.current = token
    const local = await statusOrNull(target)
    if (token !== refreshSeq.current) return local
    setStatus(prev => (
      local && prev?.refName && local.refName === prev.refName
        ? { ...local, pr: local.pr ?? prev.pr ?? null }
        : local
    ))
    setLoadedCwd(target)
    const [fresh, prResult] = await Promise.all([
      fetchStatusOrNull(target),
      readPullRequestOrFailure(target),
    ])
    if (token !== refreshSeq.current) return local
    const pr = prResult.ok ? (prResult.pr ?? null) : (fresh?.pr ?? local?.pr ?? null)
    const merged = fresh ? { ...fresh, pr } : (local ? { ...local, pr } : null)
    if (merged) setStatus(merged)
    return merged
  }

  useEffect(() => {
    if (cwd === undefined) {
      setStatus(null)
      setLoadedCwd(null)
      return
    }
    setLoadedCwd(null)
    void refresh(cwd)
    return () => { refreshSeq.current += 1 }
  }, [cwd, gitStatus, gitFetchForStatus, gitReadPullRequest])

  // A newly opened workspace is registered by the harness asynchronously, so
  // the first status read can race that write and come back unauthorized
  // (a null snapshot). The desktop pushes this signal when the registry file
  // changes; re-read status immediately instead of leaving the titlebar
  // unavailable until the next window focus.
  useEffect(() => {
    if (cwd === undefined) return
    return onWorkspacesChanged(() => { void refresh(cwd) })
  }, [cwd, onWorkspacesChanged, gitStatus, gitFetchForStatus, gitReadPullRequest])

  useEffect(() => {
    return onGitProgress((event) => {
      if (event.actionId !== actionSeq.current) return
      setProgress((prev) => {
        if (!prev || prev.tone !== 'loading') return prev
        if (event.kind === 'phase' && event.title) {
          lastProgressLine.current = null
          currentPhaseLabel.current = event.title
          return { ...prev, title: event.title, description: undefined, startedAt: Date.now() }
        }
        if (event.kind === 'hook_finished') {
          lastProgressLine.current = null
          return {
            ...prev,
            title: currentPhaseLabel.current,
            description: undefined,
            startedAt: Date.now(),
          }
        }
        if (event.kind === 'hook' && event.title) {
          lastProgressLine.current = event.text ?? null
          return { ...prev, title: event.title, description: event.text, startedAt: Date.now() }
        }
        if (event.kind === 'line' && event.text) {
          lastProgressLine.current = event.text
          return { ...prev, description: event.text }
        }
        return prev
      })
    })
  }, [onGitProgress])

  useEffect(() => {
    if (progress?.tone !== 'success') return
    const timer = window.setTimeout(() => { setProgress(null) }, 10_000)
    return () => { window.clearTimeout(timer) }
  }, [progress?.tone, progress?.title])

  useEffect(() => {
    if (cwd === undefined) return
    let timer: number | null = null
    const schedule = (): void => {
      if (busy) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        void refresh(cwd)
      }, GIT_STATUS_WINDOW_REFRESH_DEBOUNCE_MS)
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') return
      schedule()
    }
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [busy, cwd, gitStatus])

  const isDefaultRef = status?.isDefaultRef ?? false
  const hasPrimaryRemote = status?.hasPrimaryRemote ?? false
  const isRepo = status?.isRepo ?? true
  const commitFiles = status?.workingTree.files ?? []
  const canPublish = loaded && status !== null && isRepo && !hasPrimaryRemote
  const showInit = loaded && cwd !== undefined && status !== null && ! isRepo
  const quickAction = useMemo(() => {
    if (cwd === undefined) {
      return { label: 'Commit', disabled: true, kind: 'show_hint' as const, hint: t('hint.unavailable') }
    }
    if (!loaded) {
      return { label: 'Commit', disabled: true, kind: 'show_hint' as const, hint: t('hint.busy') }
    }
    return resolveQuickAction(status, busy, isDefaultRef, hasPrimaryRemote)
  }, [busy, cwd, hasPrimaryRemote, isDefaultRef, loaded, status, t])
  const menuItems = useMemo(
    () => buildMenuItems(status, busy, hasPrimaryRemote),
    [busy, hasPrimaryRemote, status],
  )
  const pendingKeys = pending
    ? resolveDefaultBranchActionDialogCopy({
        action: pending.action,
        branchName: pending.branchName,
        includesCommit: pending.includesCommit,
        terminology: getChangeRequestTerminology(status?.sourceControlProvider),
      })
    : null
  const pendingCopy = pendingKeys
    ? {
        title: t(pendingKeys.title.key, pendingKeys.title.params),
        description: t(pendingKeys.description.key, pendingKeys.description.params),
        continueLabel: t(pendingKeys.continueLabel.key, pendingKeys.continueLabel.params),
      }
    : null

  const runInit = (): void => {
    if (cwd === undefined) return
    beginProgress(t('action.init.busy'))
    setBusy(true)
    void gitInit(cwd).then((result) => {
      const failed = failureMessage(result, t('error.fallback'))
      if (failed !== undefined) failProgress(failed)
      else {
        succeedProgress(t('action.init'))
        // Reopens the surfaces Diff gate without a session switch.
        window.dispatchEvent(new CustomEvent(GIT_INIT_EVENT))
      }
    }).catch((error: unknown) => {
      failProgress(thrownMessage(error, t('error.fallback')))
    }).finally(() => {
      setBusy(false)
      void refresh(cwd)
    })
  }

  const closeCommit = (): void => {
    // Bump the scan generation so an in-flight host answer cannot repopulate
    // the warnings of a dialog the user already dismissed.
    largeFileScanSeq.current += 1
    setCommitOpen(false)
    setCommitMessage('')
    setExcludedFiles(new Set())
    setEditingFiles(false)
    setLargeFiles([])
  }

  const openCommit = (): void => {
    setExcludedFiles(new Set())
    setEditingFiles(false)
    setCommitOpen(true)
    // Clear the previous dialog's answer: a warning must never describe the
    // commit the user is about to review from a stale scan.
    setLargeFiles([])
    const scan = largeFileScanSeq.current + 1
    largeFileScanSeq.current = scan
    if (cwd !== undefined) {
      void gitCheckLargeFiles(cwd).then((result) => {
        if (largeFileScanSeq.current !== scan) return
        setLargeFiles(result.ok && Array.isArray(result.files) ? result.files : [])
      }).catch(() => {
        if (largeFileScanSeq.current !== scan) return
        setLargeFiles([])
      })
    }
  }

  const selectedCommitPaths = (): string[] | undefined => {
    const selected = commitFiles.filter(file => !excludedFiles.has(file.path)).map(file => file.path)
    if (selected.length === 0 || selected.length === commitFiles.length) return undefined
    return selected
  }

  const runStacked = async (
    action: GitStackedAction,
    options: { commitMessage?: string; skipConfirm?: boolean; filePaths?: readonly string[]; featureBranch?: boolean } = {},
  ): Promise<void> => {
    if (cwd === undefined) return
    // A feature ref forces a commit step even when the working tree looks clean.
    const includesCommitPreview = (action === 'commit' || action === 'commit_push' || action === 'commit_push_pr')
      && (action === 'commit' || Boolean(status?.hasWorkingTreeChanges) || Boolean(options.featureBranch))
    // Leaving via a feature ref skips the default-branch prompt.
    const actionIsDefaultBranch = options.featureBranch ? false : isDefaultRef
    if (
      !options.skipConfirm
      && requiresDefaultBranchConfirmation(action, actionIsDefaultBranch)
      && status?.refName
    ) {
      setPending({
        action: action as DefaultBranchConfirmableAction,
        branchName: status.refName,
        includesCommit: includesCommitPreview,
        ...(options.commitMessage ? { commitMessage: options.commitMessage } : {}),
        ...(options.filePaths ? { filePaths: options.filePaths } : {}),
      })
      return
    }
    setBusy(true)
    const fallback = t('error.fallback')
    const folded: StackedActionResult = { action }
    let settled = false
    let actionId = 0
    try {
      // Open the progress card before any IPC. Stages use the last-known
      // status snapshot; gates re-read after a refresh below.
      const previewStatus = status
      const previewTerms = getChangeRequestTerminology(previewStatus?.sourceControlProvider)
      actionId = beginProgress(buildGitActionProgressStages({
        action,
        hasCustomCommitMessage: Boolean(options.commitMessage?.trim()),
        hasWorkingTreeChanges: Boolean(previewStatus?.hasWorkingTreeChanges),
        ...(options.featureBranch !== undefined ? { featureBranch: options.featureBranch } : {}),
        shouldPushBeforePr: action === 'create_pr'
          && (!previewStatus?.hasUpstream || (previewStatus?.aheadCount ?? 0) > 0),
        terminology: previewTerms,
      })[0] ?? 'Running git action...')

      // Refresh upstream before push/PR gates. Commit-only
      // stays on local porcelain so success is not blocked on fetch (Desktop contract).
      const live = (action === 'create_pr' || action === 'push')
        ? await gitFetchForStatus(cwd)
        : await gitStatus(cwd)
      if (live) {
        setStatus(prev => (
          prev?.refName && live.refName === prev.refName
            ? { ...live, pr: live.pr ?? prev.pr ?? null }
            : live
        ))
      }
      const actionStatus = live ?? previewStatus
      // Always run the commit step for commit_* actions.
      // A clean tree is skipped_no_changes on the desktop, not a skipped IPC call.
      const wantsCommit = action === 'commit' || action === 'commit_push' || action === 'commit_push_pr'
      if (options.featureBranch && !wantsCommit) {
        failProgress('Feature-branch checkout is only supported for commit actions.')
        return
      }
      if (!actionStatus?.refName && action !== 'commit') {
        failProgress('Cannot run this git action from detached HEAD.')
        return
      }
      if (action === 'create_pr' && actionStatus?.hasWorkingTreeChanges) {
        failProgress('Commit local changes before creating a PR.')
        return
      }
      if (wantsCommit) {
        const committed = await gitCommit(
          cwd,
          options.commitMessage?.trim() ?? '',
          options.filePaths,
          actionId,
          options.featureBranch ? { featureBranch: true } : undefined,
        )
        const failed = failureMessage(committed, fallback)
        if (failed !== undefined) {
          failProgress(failed)
          return
        }
        folded.commit = foldCommit(committed)
      }
      const needsPush = action === 'push'
        || action === 'commit_push'
        || action === 'commit_push_pr'
        || (action === 'create_pr' && (!actionStatus?.hasUpstream || (actionStatus?.aheadCount ?? 0) > 0))
      if (needsPush) {
        if (!actionStatus?.refName) {
          failProgress('Cannot push from detached HEAD.')
          return
        }
        const pushed = await gitPush(cwd, actionId)
        const failed = failureMessage(pushed, fallback)
        if (failed !== undefined) {
          failProgress(failed)
          return
        }
        folded.push = foldPush(pushed)
        if (!folded.commit && pushed.commitSha) {
          folded.commit = { status: 'created', commitSha: pushed.commitSha }
        }
      }
      if (action === 'create_pr' || action === 'commit_push_pr') {
        const created = await gitCreateChangeRequest(cwd, {}, actionId)
        const failed = failureMessage(created, fallback)
        if (failed !== undefined) {
          failProgress(failed)
          return
        }
        folded.pr = foldPr(created)
      }
      const terms = getChangeRequestTerminology(actionStatus?.sourceControlProvider)
      // The action already succeeded; a rejected post-action status read must
      // not repaint it as a failure.
      const nextStatus = action === 'commit'
        ? await statusOrNull(cwd)
        : await settleStatus(cwd)
      if (action === 'commit') {
        if (nextStatus) {
          setStatus(prev => (
            prev?.refName && nextStatus.refName === prev.refName
              ? { ...nextStatus, pr: nextStatus.pr ?? prev.pr ?? null }
              : nextStatus
          ))
        }
        void refresh(cwd)
      }
      settled = true
      const summary = summarizeGitActionResult(folded, terms)
      const cta = resolveCompletionCta(
        attachOpenPrForCta(folded, nextStatus),
        terms,
        nextStatus?.isDefaultRef ?? false,
      )
      succeedProgress(
        summary.title,
        summary.description,
        cta.kind === 'open_pr'
          ? { label: cta.label, onAction: () => { void openExternal(cta.url) } }
          : cta.kind === 'run_action'
            ? { label: cta.label, onAction: () => { void runStacked(cta.action) } }
            : undefined,
      )
    } catch (error) {
      // A rejected git IPC promise must land on the toast, not strand it loading.
      failProgress(thrownMessage(error, fallback))
    } finally {
      setBusy(false)
      if (!settled) await refresh(cwd)
    }
  }

  const openPublish = (): void => {
    if (cwd === undefined || !canPublish) return
    setPublishName(cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? '')
    setPublishVisibility('private')
    setPublishRemoteUrl('')
    setPublishOpen(true)
  }

  const openExistingPr = (): void => {
    const url = status?.pr?.state === 'open' ? status.pr.url : ''
    if (!url) {
      failProgress(`No open ${getChangeRequestTerminology(status?.sourceControlProvider).shortLabel} URL.`)
      return
    }
    void openExternal(url)
  }

  const runQuick = (): void => {
    if (quickAction.disabled || quickAction.kind === 'show_hint') return
    if (quickAction.kind === 'open_pr') {
      openExistingPr()
      return
    }
    if (quickAction.kind === 'open_publish') {
      openPublish()
      return
    }
    if (quickAction.kind === 'run_pull') {
      if (cwd === undefined) return
      const actionId = beginProgress('Pulling...')
      setBusy(true)
      void gitPull(cwd, actionId).then((result) => {
        const failed = failureMessage(result, t('error.fallback'))
        if (failed !== undefined) {
          failProgress(failed)
          return
        }
        if (result.status === 'up_to_date') {
          succeedProgress(
            t('progress.upToDate'),
            t('progress.synced', { branch: result.refName || status?.refName || '' }),
          )
          return
        }
        succeedProgress(
          t('progress.pulled'),
          t('progress.pulledFrom', {
            branch: result.refName || status?.refName || '',
            upstream: result.upstreamRef || 'upstream',
          }),
        )
      }).catch((error: unknown) => {
        failProgress(thrownMessage(error, t('error.fallback')))
      }).finally(() => {
        setBusy(false)
        void refresh(cwd)
      })
      return
    }
    if (quickAction.action === 'commit') {
      openCommit()
      return
    }
    if (quickAction.action) void runStacked(quickAction.action)
  }

  const onMenuSelect = (id: string): void => {
    setMenuOpen(false)
    if (id === 'publish') {
      openPublish()
      return
    }
    const item = menuItems.find(entry => entry.id === id)
    if (!item || item.disabled) return
    if (item.kind === 'open_pr') {
      openExistingPr()
      return
    }
    if (item.dialogAction === 'commit') {
      openCommit()
      return
    }
    if (item.dialogAction === 'push') void runStacked('push')
    if (item.dialogAction === 'create_pr') void runStacked('create_pr')
  }

  const hint = quickAction.disabled
    ? (quickAction.hint ?? t('hint.unavailable'))
    : undefined

  const quickLabel = localizeGitLabel(quickAction.label, t)
  const commitLargeFiles = selectedLargeFiles(largeFiles, commitFiles, excludedFiles)
  const mainButton = (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      className={css.primary}
      disabled={quickAction.disabled}
      loading={busy}
      aria-label={quickLabel}
      onClick={runQuick}
    >
      {iconFor(quickIcon(quickAction))}
      <span className={labelCss.label}>
        <span className={labelCss.clip}>
          <span className={labelCss.text}>{quickLabel}</span>
        </span>
      </span>
    </Button>
  )

  const initButton = (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      className={clsx(css.init, density === 'compact' && css.initCompact)}
      disabled={busy}
      loading={busy}
      aria-label={t('action.init')}
      onClick={runInit}
    >
      <IconBranchOutline16 size={14} />
      {density === 'compact' ? null : <span>{t('action.init')}</span>}
    </Button>
  )

  return managedSession ? null : (
    <>
      {showChrome && loaded && cwd !== undefined && status !== null ? (showInit ? initButton : (
        <div
          className={clsx(css.split, labelCss.toolbar)}
          data-git-toolbar
          data-git-reveal-branch={revealedParts.branch || undefined}
          data-git-reveal-action={revealedParts.action || undefined}
          onPointerOver={(event) => {
            if (event.pointerType === 'touch' || !(event.target instanceof Element)) return
            const part = event.target.closest('[data-git-part]')?.getAttribute('data-git-part')
            if (part === 'branch' || part === 'action') {
              setRevealedParts(previous => previous[part] ? previous : { ...previous, [part]: true })
            }
          }}
          onPointerLeave={() => { setRevealedParts({ branch: false, action: false }) }}
        >
          <BranchMenu
            cwd={cwd}
            currentRef={status?.refName ?? null}
            t={t}
            disabled={busy}
            compact={density === 'compact'}
            gitBranchList={gitBranchList}
            gitSwitchBranch={gitSwitchBranch}
            gitCreateBranch={gitCreateBranch}
            onChanged={() => { if (cwd !== undefined) void refresh(cwd) }}
            onError={(message, title) => { lastProgressLine.current = null; failProgress(message, title) }}
          />
          <span className={css.rule} aria-hidden="true" />
          <div className={clsx(css.action, labelCss.part)} data-git-part="action">
            {hint
              ? <Tooltip label={hint} side="bottom"><span className={css.hintWrap}>{mainButton}</span></Tooltip>
              : mainButton}
            <span className={css.rule} aria-hidden="true" />
            <Menu
              open={menuOpen}
              align="end"
              portal
              anchor={(
                <button
                  type="button"
                  className={css.chevron}
                  aria-label={t('menu.options')}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  disabled={busy}
                  onClick={() => {
                    const next = !menuOpen
                    setMenuOpen(next)
                    if (next && cwd !== undefined) void refresh(cwd)
                  }}
                >
                  <IconChevronDownOutline14 size={14} />
                </button>
              )}
              items={[
                ...menuItems.map(item => {
                  const hint = getMenuActionDisabledReason({
                    item,
                    gitStatus: status,
                    isBusy: busy,
                    hasPrimaryRemote,
                  })
                  return {
                    id: item.id,
                    label: localizeGitLabel(item.label, t),
                    disabled: item.disabled,
                    icon: iconFor(item.icon),
                    ...(hint ? { hint } : {}),
                  }
                }),
                ...(!canPublish
                  ? []
                  : [{
                    id: 'publish',
                    label: t('action.publish'),
                    disabled: busy,
                    icon: iconFor('push'),
                  }]),
              ]}
              footer={[
                ...(status?.refName === null
                  ? [{ type: 'label' as const, id: 'detached', text: t('menu.detached') }]
                  : []),
                ...(status
                  && status.refName !== null
                  && !status.hasWorkingTreeChanges
                  && status.behindCount > 0
                  && status.aheadCount === 0
                  ? [{ type: 'label' as const, id: 'behind', text: t('menu.behind') }]
                  : []),
              ]}
              onSelect={onMenuSelect}
              onClose={() => { setMenuOpen(false) }}
            />
          </div>
        </div>
      )) : null}

      <CommitDialog
        open={!showInit && commitOpen}
        branchName={status?.refName ?? null}
        isDefaultRef={isDefaultRef}
        files={commitFiles}
        excluded={excludedFiles}
        editing={editingFiles}
        message={commitMessage}
        t={t}
        largeFiles={commitLargeFiles}
        onClose={closeCommit}
        onMessage={setCommitMessage}
        onToggleEdit={() => { setEditingFiles(next => !next) }}
        onTogglePath={(filePath) => {
          setExcludedFiles(prev => {
            const next = new Set(prev)
            if (next.has(filePath)) next.delete(filePath)
            else next.add(filePath)
            return next
          })
        }}
        onToggleAll={() => {
          const allOn = commitFiles.length > 0 && commitFiles.every(file => !excludedFiles.has(file.path))
          setExcludedFiles(allOn ? new Set(commitFiles.map(file => file.path)) : new Set())
        }}
        onCommit={() => {
          const message = commitMessage
          const filePaths = selectedCommitPaths()
          closeCommit()
          void runStacked('commit', {
            commitMessage: message,
            ...(filePaths ? { filePaths } : {}),
          })
        }}
        onCommitNewRef={() => {
          const message = commitMessage
          const filePaths = selectedCommitPaths()
          closeCommit()
          void runStacked('commit', {
            commitMessage: message,
            featureBranch: true,
            skipConfirm: true,
            ...(filePaths ? { filePaths } : {}),
          })
        }}
        onOpenFile={(filePath) => {
          if (cwd === undefined) return
          void openWorkspacePath(cwd, filePath).then((result) => {
            const failed = failureMessage(result, t('error.fallback'))
            if (failed !== undefined) failProgress(failed, t('commit.openFailed'))
          }).catch((error: unknown) => {
            // shell:open-workspace-path sits outside the desktop git-ipc
            // guard, so a rejected invoke lands here instead of the console.
            failProgress(thrownMessage(error, t('error.fallback')), t('commit.openFailed'))
          })
        }}
      />

      <PublishDialog
        open={!showInit && publishOpen}
        name={publishName}
        visibility={publishVisibility}
        remoteUrl={publishRemoteUrl}
        t={t}
        onClose={() => { setPublishOpen(false) }}
        onName={setPublishName}
        onVisibility={setPublishVisibility}
        onRemoteUrl={setPublishRemoteUrl}
        onSubmit={() => {
          if (cwd === undefined) return
          const actionId = beginProgress('Publishing repository...')
          setPublishOpen(false)
          setBusy(true)
          void gitPublishRepository(cwd, {
            name: publishName.trim(),
            visibility: publishVisibility,
            ...(publishRemoteUrl.trim() ? { remoteUrl: publishRemoteUrl.trim() } : {}),
          }, actionId).then((result) => {
            const failed = failureMessage(result, t('error.fallback'))
            if (failed !== undefined) {
              failProgress(failed)
              setPublishOpen(true)
              return
            }
            const url = result.url
            succeedProgress(
              t('action.publish'),
              url,
              url
                ? { label: t('progress.openRepo'), onAction: () => { void openExternal(url) } }
                : undefined,
            )
          }).catch((error: unknown) => {
            // Same recovery as an ok:false publish: fail the toast, reopen the dialog.
            failProgress(thrownMessage(error, t('error.fallback')))
            setPublishOpen(true)
          }).finally(() => {
            setBusy(false)
            void refresh(cwd)
          })
        }}
      />

      {progress !== null && (
        <GitProgressToast
          state={progress}
          dismissLabel={t('progress.dismiss')}
          onClose={() => { setProgress(null) }}
        />
      )}

      <Modal
        open={!showInit && pending !== null}
        onClose={() => { setPending(null) }}
        title={pendingCopy?.title ?? ''}
        closeLabel={t('confirm.abort')}
        {...(pendingCopy?.description !== undefined ? { description: pendingCopy.description } : {})}
        footer={(
          <>
            <Button variant="ghost" size="sm" onClick={() => { setPending(null) }}>
              {t('confirm.abort')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!pending) return
                const next = pending
                setPending(null)
                void runStacked(next.action, {
                  skipConfirm: true,
                  ...(next.commitMessage ? { commitMessage: next.commitMessage } : {}),
                  ...(next.filePaths ? { filePaths: next.filePaths } : {}),
                })
              }}
            >
              {pendingCopy?.continueLabel}
            </Button>
            {pending?.includesCommit ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (!pending) return
                  const next = pending
                  setPending(null)
                  void runStacked(next.action, {
                    skipConfirm: true,
                    featureBranch: true,
                    ...(next.commitMessage ? { commitMessage: next.commitMessage } : {}),
                    ...(next.filePaths ? { filePaths: next.filePaths } : {}),
                  })
                }}
              >
                {t('confirm.featureContinue')}
              </Button>
            ) : null}
          </>
        )}
      />
    </>
  )
}
