import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  Button, IconArchiveOutlineRegular, IconChecklistOutlineRegular,
  IconTrashOutlineRegular, Modal, StateDot, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import css from './SessionSelection.module.css'

type BatchKind = 'archive' | 'delete'
type SelectionOptions = Pick<WorkspaceBrowserProps, 'archiveSessionForBatch' | 'deleteSessionForBatch' | 't'> & {
  scopeKey: string
}

interface BatchTarget {
  id: SessionId
  title: string
}

interface BatchDialog {
  open: boolean
  kind: BatchKind
  targets: readonly BatchTarget[]
}

interface BatchFailure extends BatchTarget {
  message: string
}

interface BatchResult {
  kind: BatchKind
  succeeded: number
  failures: readonly BatchFailure[]
}

/** The narrow interaction share threaded to each Session row. */
export interface SessionRowSelection {
  readonly enabled: boolean
  readonly busy: boolean
  readonly selected: ReadonlySet<SessionId>
  toggle: (id: SessionId, title: string) => void
  register: (id: SessionId, title: string, element: HTMLElement) => () => void
}

/** Browser-owned viewing state and the controls that act on it. */
export interface SessionSelectionController extends SessionRowSelection {
  t: WorkspaceBrowserProps['t']
  toggleEnabled: () => void
  selectVisible: () => void
  clear: () => void
  request: (kind: BatchKind) => void
  closeDialog: () => void
  confirm: () => Promise<void>
  dialog: BatchDialog | null
  progress: { attempted: number; total: number } | null
  result: BatchResult | null
  resultVisible: boolean
  dismissResult: () => void
}

/** Mounted rows can remain in the tree while their group finishes collapsing. */
function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[aria-hidden="true"], [hidden]') !== null) return false
  if (element.getClientRects().length === 0) return false
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  return typeof element.checkVisibility !== 'function'
    || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
}

/** Preserve concrete wire errors, while translating known Session refusals. */
function batchErrorText(reason: unknown, t: WorkspaceBrowserProps['t']): string {
  const code = typeof reason === 'object' && reason !== null
    ? ('rpcError' in reason && typeof reason.rpcError === 'object' && reason.rpcError !== null
      && 'code' in reason.rpcError ? reason.rpcError.code : 'code' in reason ? reason.code : undefined)
    : undefined
  if (code === 'workspace/session-active') return t('selection.error.active')
  if (code === 'session-running') return t('delete.session.running')
  if (code === 'session-not-archived') return t('delete.session.notArchived')
  if (code === 'session-not-found' || code === 'session/not-found') return t('delete.session.notFound')
  if (code === 'session-live-unowned') return t('delete.session.liveUnowned')
  if (code === 'session-delete-partial') return t('delete.session.partial')
  if (code === 'session-delete-incomplete') return t('delete.session.incomplete')
  if (code === 'session-delete-in-progress') return t('delete.session.inProgress')
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'object' && reason !== null && 'message' in reason && typeof reason.message === 'string') {
    return reason.message
  }
  return String(reason)
}

/** Keep batch selection local to one browser, with Host mutation callbacks as its only data edge. */
export function useSessionSelection({ scopeKey, archiveSessionForBatch, deleteSessionForBatch, t }: SelectionOptions): SessionSelectionController {
  const [enabled, setEnabled] = useState(false)
  const [choices, setChoices] = useState<ReadonlyMap<SessionId, string>>(() => new Map())
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<BatchDialog | null>(null)
  const [progress, setProgress] = useState<SessionSelectionController['progress']>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [resultVisible, setResultVisible] = useState(false)
  const registry = useRef(new Map<SessionId, Map<HTMLElement, string>>())
  const executing = useRef(false)
  const currentScope = useRef(scopeKey)
  currentScope.current = scopeKey
  const previousScope = useRef(scopeKey)

  useEffect(() => {
    if (previousScope.current === scopeKey) return
    previousScope.current = scopeKey
    setChoices(new Map())
    if (!executing.current) {
      setDialog(value => value === null ? null : { ...value, open: false })
      setResult(null)
    }
  }, [scopeKey])

  const register = useCallback((id: SessionId, title: string, element: HTMLElement) => {
    let occurrences = registry.current.get(id)
    if (occurrences === undefined) {
      occurrences = new Map()
      registry.current.set(id, occurrences)
    }
    occurrences.set(element, title)
    return () => {
      const registered = registry.current.get(id)
      registered?.delete(element)
      if (registered?.size === 0) registry.current.delete(id)
    }
  }, [])

  const toggle = useCallback((id: SessionId, title: string) => {
    if (executing.current) return
    setChoices(value => {
      const next = new Map(value)
      if (next.has(id)) next.delete(id)
      else next.set(id, title)
      return next
    })
  }, [])

  const toggleEnabled = (): void => {
    if (executing.current) return
    setEnabled(value => !value)
    setChoices(new Map())
    setResult(null)
  }

  const selectVisible = (): void => {
    if (executing.current) return
    setChoices(value => {
      const next = new Map(value)
      for (const [id, occurrences] of registry.current) {
        for (const [element, title] of occurrences) {
          if (isVisible(element)) {
            next.set(id, title)
            break
          }
        }
      }
      return next
    })
  }

  const clear = (): void => {
    if (!executing.current) setChoices(new Map())
  }

  const request = (kind: BatchKind): void => {
    if (executing.current || choices.size === 0) return
    setResult(null)
    setDialog({ open: true, kind, targets: Array.from(choices, ([id, title]) => ({ id, title })) })
  }

  const closeDialog = (): void => {
    if (!executing.current) setDialog(value => value === null ? null : { ...value, open: false })
  }

  const confirm = async (): Promise<void> => {
    if (executing.current || dialog === null || !dialog.open) return
    const operation = dialog
    const operationScope = scopeKey
    executing.current = true
    setBusy(true)
    setProgress({ attempted: 0, total: operation.targets.length })
    const successes = new Set<SessionId>()
    const failures: BatchFailure[] = []
    for (const [index, target] of operation.targets.entries()) {
      try {
        if (operation.kind === 'archive') await archiveSessionForBatch(target.id, { stopActivity: true })
        else await deleteSessionForBatch(target.id)
        successes.add(target.id)
      } catch (reason) {
        failures.push({ ...target, message: batchErrorText(reason, t) })
      }
      setProgress({ attempted: index + 1, total: operation.targets.length })
    }
    setChoices(value => {
      if (currentScope.current !== operationScope) return new Map()
      const next = new Map(value)
      for (const id of successes) next.delete(id)
      for (const failure of failures) next.set(failure.id, failure.title)
      return next
    })
    setResult({ kind: operation.kind, succeeded: successes.size, failures })
    setResultVisible(true)
    setDialog(value => value === null ? null : { ...value, open: false })
    setProgress(null)
    executing.current = false
    setBusy(false)
  }

  const selected = useMemo(() => new Set(choices.keys()), [choices])
  return { enabled, busy, selected, toggle, register, t, toggleEnabled, selectVisible, clear, request, closeDialog, confirm, dialog, progress, result, resultVisible, dismissResult: () => { setResultVisible(false) } }
}

/** A persistent, compact entry beside the browser's section controls. */
export function SessionSelectionToggle({ selection }: { selection: SessionSelectionController }) {
  const { enabled, busy, t } = selection
  const label = t(enabled ? 'selection.exit' : 'selection.enter')
  return (
    <Tooltip label={label} side="bottom" delayMs={500}>
      <Button
        size="sm"
        className={css.toggle}
        aria-label={label}
        aria-pressed={enabled}
        disabled={busy}
        onClick={selection.toggleEnabled}
        icon={<IconChecklistOutlineRegular size={14} />}
      />
    </Tooltip>
  )
}

/** Batch choices keep their fixed height throughout the operation. */
export function SessionSelectionToolbar({ selection }: { selection: SessionSelectionController }) {
  const { enabled, busy, selected, t } = selection
  if (!enabled) return null
  return (
    <div className={css.toolbar} aria-label={t('selection.toolbar.aria')}>
      <div className={css.selectionLine}>
        <span className={css.count}>{t('selection.count', { n: selected.size })}</span>
        <Button size="sm" disabled={busy} onClick={selection.selectVisible}>{t('selection.allVisible')}</Button>
        <Button size="sm" disabled={busy || selected.size === 0} onClick={selection.clear}>{t('selection.clear')}</Button>
      </div>
      <div className={css.actions}>
        <Button size="sm" variant="outline" disabled={busy || selected.size === 0} onClick={() => { selection.request('archive') }} icon={<IconArchiveOutlineRegular size={14} />}>
          {t('selection.archive')}
        </Button>
        <Button size="sm" variant="outline" className={css.danger} disabled={busy || selected.size === 0} onClick={() => { selection.request('delete') }} icon={<IconTrashOutlineRegular size={14} />}>
          {t('selection.delete')}
        </Button>
      </div>
    </div>
  )
}

/** The target list is frozen when confirmation opens and throughout the actual RPC batch. */
export function SessionSelectionDialogs({ selection }: { selection: SessionSelectionController }) {
  const { dialog, busy, progress, result, resultVisible, t } = selection
  const kind = dialog?.kind ?? 'archive'
  const targets = dialog?.targets ?? []
  const title = t(kind === 'archive' ? 'selection.confirm.archive.title' : 'selection.confirm.delete.title', { n: targets.length })
  const resultText = result === null ? '' : [
    t(result.kind === 'archive' ? 'selection.result.archived' : 'selection.result.deleted', { n: result.succeeded }),
    ...result.failures.length > 0 ? [t('selection.result.failed', { n: result.failures.length })] : [],
    ...result.failures.map(failure => `${failure.title}: ${failure.message}`),
  ].join('；')
  return (<>
    <Modal open={dialog?.open ?? false} onClose={selection.closeDialog} title={title} headless className={css.dialog}>
      <div className={css.dialogBody}>
        <h2 className={css.dialogTitle}>{title}</h2>
        <p className={css.description}>{t(kind === 'archive' ? 'selection.confirm.archive.desc' : 'selection.confirm.delete.desc')}</p>
        <ul className={css.targets} aria-label={t('selection.confirm.targets')}>
          {targets.map(target => <li key={target.id}>{target.title}</li>)}
        </ul>
        {progress !== null && <Toast text={t('selection.progress', { n: progress.attempted, total: progress.total })}
          icon={<StateDot state="ongoing" />} holdMs={null} onDone={() => {}} />}
      </div>
      <div className={css.dialogFooter}>
        <Button variant="outline" disabled={busy} onClick={selection.closeDialog} data-modal-autofocus>{t('cancel')}</Button>
        <Button variant="outline" className={kind === 'delete' ? css.danger : undefined} disabled={busy} loading={busy} onClick={() => { void selection.confirm() }}>
          {t(kind === 'archive' ? 'selection.confirm.archive.action' : 'selection.confirm.delete.action')}
        </Button>
      </div>
    </Modal>
    {result !== null && resultVisible && <Toast text={resultText}
      tone={result.failures.length === 0 ? 'success' : undefined}
      holdMs={result.failures.length > 0 ? null : undefined}
      dismissLabel={result.failures.length > 0 ? t('close') : undefined}
      onDone={selection.dismissResult} />}
  </>)
}
