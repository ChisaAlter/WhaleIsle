/**
 * Settings MCP page: searchable managed catalog plus read-only composition rows.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import type {
  McpServerEntry,
  McpServerRecord,
  McpServerSnapshot,
  McpServerTestResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconCloseOutline16,
  IconEditOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  Input,
  Modal,
  Pill,
  SettingsSelect,
  StateDot,
  Switch,
  Toast,
  Tooltip,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpSettingsKey } from './locales.ts'
import styles from './McpSection.module.css'

const NAME = /^[A-Za-z0-9_-]{1,32}$/
const PAIR_KEY = /^[^=\s]+$/
const TIMEOUT = /^[1-9]\d*$/

type StdioRecord = Extract<McpServerRecord, { transport: 'stdio' }>
type HttpRecord = Extract<McpServerRecord, { transport: 'streamable-http' }>
type EnabledFilter = 'all' | 'enabled' | 'disabled'
type EditorMode = 'form' | 'json'

/** Injected Host Remote wrappers. */
export interface McpSectionInjected {
  list: () => Promise<McpServerSnapshot>
  upsert: (spec: McpServerRecord) => Promise<void>
  remove: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  retry: (id: string) => Promise<void>
  test: (id: string) => Promise<McpServerTestResult>
  authorize: (id: string) => Promise<void>
  t: (key: McpSettingsKey) => string
}

/** Slot props for `settings.section` id `mcp`. */
export type McpSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<McpSectionInjected>

type View =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; snapshot: McpServerSnapshot }

type EditorTarget = { readonly creating: boolean; readonly draft: McpServerRecord }
type TestState =
  | { readonly status: 'success'; readonly result: McpServerTestResult }
  | { readonly status: 'error'; readonly message: string }

const PHASE: Record<Exclude<McpServerEntry['fiberPhase'], null>, McpSettingsKey> = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
}

const PHASE_DOT: Record<Exclude<McpServerEntry['fiberPhase'], null>, StateDotState> = {
  pending: 'warning',
  loading: 'ongoing',
  active: 'done',
  failed: 'error',
  unloading: 'warning',
}

const HEALTH_POLL_MS = 2000

type ConnectionHealth = NonNullable<McpServerEntry['connection']>['health']

const HEALTH: Record<ConnectionHealth, McpSettingsKey> = {
  connecting: 'healthConnecting',
  connected: 'healthConnected',
  reconnecting: 'healthReconnecting',
  failed: 'healthFailed',
}

const HEALTH_DOT: Record<ConnectionHealth, StateDotState> = {
  connecting: 'ongoing',
  connected: 'done',
  reconnecting: 'warning',
  failed: 'error',
}

/** Render the MCP settings page. */
export function McpSection(props: McpSectionProps) {
  const t = props.t
  const mountedRef = useRef(true)
  const loadSequence = useRef(0)
  const [view, setView] = useState<View>({ status: 'loading' })
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all')
  const [editor, setEditor] = useState<EditorTarget | undefined>()
  const [deleting, setDeleting] = useState<McpServerEntry | undefined>()
  const [deletePending, setDeletePending] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>()
  const [togglePending, setTogglePending] = useState<ReadonlySet<string>>(new Set())
  const [testPending, setTestPending] = useState<ReadonlySet<string>>(new Set())
  const [signInPending, setSignInPending] = useState<ReadonlySet<string>>(new Set())
  const [testResults, setTestResults] = useState<Readonly<Record<string, TestState>>>({})
  const [rowFailures, setRowFailures] = useState<Readonly<Record<string, string>>>({})
  const [refreshFailure, setRefreshFailure] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [notice, setNotice] = useState<{ text: string } | undefined>()
  const [noticeDismissed, setNoticeDismissed] = useState(false)
  const [noticeSequence, setNoticeSequence] = useState(0)
  const notify = useCallback((text: string): void => {
    setNotice({ text })
    setNoticeDismissed(false)
    setNoticeSequence(sequence => sequence + 1)
  }, [])
  useEffect(() => {
    if (refreshFailure) notify(t('refreshFailed'))
  }, [refreshFailure, notify, t])
  useEffect(() => {
    if (view.status === 'error') notify(t('error'))
    else if (view.status === 'loading') setNoticeDismissed(true)
  }, [view.status, notify, t])
  useEffect(() => {
    if (!refreshFailure && notice?.text === t('refreshFailed')) setNoticeDismissed(true)
  }, [refreshFailure, notice, t])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const sequence = loadSequence.current + 1
    loadSequence.current = sequence
    void props.list().then(
      (snapshot) => {
        if (loadSequence.current === sequence) {
          setView({ status: 'ready', snapshot })
          setRefreshFailure(false)
        }
      },
      () => {
        if (loadSequence.current === sequence) setView({ status: 'error' })
      },
    )
    return () => {
      loadSequence.current += 1
    }
  }, [props.list, request])

  const togglePendingRef = useRef(togglePending)
  togglePendingRef.current = togglePending
  const signInPendingRef = useRef(signInPending)
  signInPendingRef.current = signInPending
  const testPendingRef = useRef(testPending)
  testPendingRef.current = testPending

  const servers = view.status === 'ready' ? view.snapshot.servers : []
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = useMemo(() => servers.filter((entry) => {
    const matchesQuery = normalizedQuery.length === 0 || searchableValues(entry)
      .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
    const matchesEnabled = enabledFilter === 'all'
      || (enabledFilter === 'enabled' ? entry.enabled : !entry.enabled)
    return matchesQuery && matchesEnabled
  }), [enabledFilter, normalizedQuery, servers])
  const managed = filtered.filter(entry => entry.origin === 'managed')
  const composition = filtered.filter(entry => entry.origin === 'composition')

  const reloadReady = async (): Promise<void> => {
    const sequence = loadSequence.current + 1
    loadSequence.current = sequence
    try {
      const snapshot = await props.list()
      if (loadSequence.current === sequence) {
        setView({ status: 'ready', snapshot })
        setRefreshFailure(false)
      }
    } catch (error) {
      if (loadSequence.current === sequence) setRefreshFailure(true)
      throw error
    }
  }

  useEffect(() => {
    if (view.status !== 'ready') return
    // Poll unconditionally so a server connected outside this page (direct
    // composition rows, a child that finished its initial tool sync between
    // polls) still shows its health and tool count without an app restart.
    const id = window.setInterval(() => {
      if (togglePendingRef.current.size > 0 || testPendingRef.current.size > 0 || signInPendingRef.current.size > 0) return
      void reloadReady().catch(() => {
        // reloadReady already recorded refreshFailure for this tick.
      })
    }, HEALTH_POLL_MS)
    return () => { window.clearInterval(id) }
  }, [props.list, view.status])

  const refresh = (): void => {
    if (refreshPending) return
    setNoticeDismissed(true)
    if (view.status !== 'ready') {
      retry()
      return
    }
    setRefreshPending(true)
    void (async () => {
      const failures: string[] = []
      if (view.status === 'ready') {
        const failed = view.snapshot.servers.filter(entry =>
          entry.origin === 'managed' && entry.connection?.health === 'failed')
        for (const entry of failed) {
          try {
            await props.retry(entry.id)
          } catch (error) {
            failures.push(`${entry.spec.serverName}: ${messageOf(error, t('error'))}`)
          }
        }
      }
      try {
        await reloadReady()
        if (failures.length > 0) notify(failures.join('; '))
      } catch {
        notify(t('refreshFailed'))
      } finally {
        if (mountedRef.current) setRefreshPending(false)
      }
    })()
  }

  const retry = (): void => {
    setView({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const clearFilters = (): void => {
    setQuery('')
    setEnabledFilter('all')
  }

  const toggle = (entry: McpServerEntry, enabled: boolean): void => {
    if (togglePending.has(entry.id)) return
    setTogglePending(current => new Set(current).add(entry.id))
    setRowFailures(current => omitKey(current, entry.id))
    setView(current => current.status !== 'ready' ? current : ({
      status: 'ready',
      snapshot: {
        servers: current.snapshot.servers.map(item => item.id === entry.id
          ? { ...item, enabled, spec: { ...item.spec, enabled } }
          : item),
      },
    }))
    const clearPending = (): void => {
      setTogglePending((current) => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
    }
    void props.setEnabled(entry.id, enabled).then(() => {
      if (!mountedRef.current) return
      clearPending()
      void reloadReady().catch(() => {})
    }).catch((error: unknown) => {
      if (!mountedRef.current) return
      setView(current => current.status !== 'ready' ? current : ({
        status: 'ready',
        snapshot: {
          servers: current.snapshot.servers.map(item => item.id === entry.id
            ? { ...item, enabled: entry.enabled, spec: { ...item.spec, enabled: entry.spec.enabled } }
            : item),
        },
      }))
      setRowFailures(current => ({ ...current, [entry.id]: messageOf(error, t('toggleFailed')) }))
      notify(`${entry.spec.serverName}: ${messageOf(error, t('toggleFailed'))}`)
      clearPending()
      void reloadReady().catch(() => {})
    })
  }

  const signIn = (entry: McpServerEntry): void => {
    if (signInPending.has(entry.id)) return
    setSignInPending(current => new Set(current).add(entry.id))
    setRowFailures(current => omitKey(current, entry.id))
    const clearPending = (): void => {
      setSignInPending((current) => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
    }
    void props.authorize(entry.id).then(() => {
      if (!mountedRef.current) return
      clearPending()
      void reloadReady().catch(() => {})
    }).catch((error: unknown) => {
      if (!mountedRef.current) return
      setRowFailures(current => ({ ...current, [entry.id]: messageOf(error, t('signInFailed')) }))
      notify(`${entry.spec.serverName}: ${messageOf(error, t('signInFailed'))}`)
      clearPending()
    })
  }

  const test = (entry: McpServerEntry): void => {
    if (testPending.has(entry.id)) return
    setTestPending(current => new Set(current).add(entry.id))
    setTestResults(current => omitTestResult(current, entry.id))
    const clearPending = (): void => {
      setTestPending(current => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
    }
    void props.test(entry.id).then((result) => {
      if (!mountedRef.current) return
      setTestResults(current => ({ ...current, [entry.id]: { status: 'success', result } }))
    }).catch((error: unknown) => {
      if (!mountedRef.current) return
      setTestResults(current => ({
        ...current,
        [entry.id]: { status: 'error', message: messageOf(error, t('testFailed')) },
      }))
      notify(`${entry.spec.serverName}: ${messageOf(error, t('testFailed'))}`)
    }).finally(clearPending)
  }

  const filterOptions = [
    ['all', t('filterAll')],
    ['enabled', t('filterEnabledOnly')],
    ['disabled', t('filterDisabledOnly')],
  ] as const

  return (
    <div className={styles.section} aria-busy={view.status === 'loading'}>
      {notice === undefined || noticeDismissed ? null : <Toast key={noticeSequence} text={notice.text}
        holdMs={9000} onDone={() => { setNoticeDismissed(true) }} />}
      <div className={styles.heading}>
        <div>
          <h2 className={styles.title}>{t('title')}</h2>
          <p className={styles.intro}>{t('intro')}</p>
        </div>
        <div className={styles.headingActions}>
          <Button
            size="sm"
            variant="outline"
            className={styles.iconAction}
            icon={<IconPlusOutline16 />}
            aria-label={t('add')}
            onClick={() => { setEditor({ creating: true, draft: emptyDraft() }) }}
          />
          <Button
            size="sm"
            variant="outline"
            className={styles.iconAction}
            icon={<IconRefreshOutline16 />}
            aria-label={view.status === 'loading' ? t('loading') : t('refresh')}
            title={view.status === 'error' ? t('error') : t('refresh')}
            loading={refreshPending || view.status === 'loading'}
            disabled={refreshPending || view.status === 'loading'}
            onClick={refresh}
          />
        </div>
      </div>


      {view.status === 'ready' ? (
        <>
          <div className={styles.searchRow}>
            <Input
              {...styles.search === undefined ? {} : { className: styles.search }}
              type="search"
              icon={<IconSearchOutline16 />}
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
            <SettingsSelect
              align="end"
              aria-label={t('filterEnabled')}
              value={enabledFilter}
              options={filterOptions.map(([id, copy]) => ({ id, label: copy }))}
              onChange={(id) => { setEnabledFilter(id as EnabledFilter) }}
            />
          </div>
          {servers.length === 0 ? <p className={styles.empty}>{t('empty')}</p> : null}
          {servers.length > 0 && filtered.length === 0 ? (
            <div className={styles.emptySearch}>
              <p>{t('emptySearch')}</p>
              <Button size="sm" variant="outline" onClick={clearFilters}>{t('clearFilters')}</Button>
            </div>
          ) : null}
          {managed.length > 0 ? (
            <section className={styles.groupSection} aria-labelledby="mcp-configured">
              <h3 id="mcp-configured" className={styles.groupTitle}>
                {format(t('configuredCount'), { count: String(managed.length) })}
              </h3>
              <ul className={styles.rows}>
                {managed.map(entry => (
                  <ServerRow
                    key={entry.id}
                    entry={entry}
                    pending={togglePending.has(entry.id)}
                    testing={testPending.has(entry.id)}
                    testResult={testResults[entry.id]}
                    failure={rowFailures[entry.id]}
                    t={t}
                    onToggleEnabled={(enabled) => { toggle(entry, enabled) }}
                    onTest={() => { test(entry) }}
                    onEdit={() => { setEditor({ creating: false, draft: entry.spec }) }}
                    onDelete={() => {
                      setDeleting(entry)
                      setDeleteFailure(undefined)
                      setDeletePending(false)
                    }}
                    signingIn={signInPending.has(entry.id)}
                    onSignIn={() => { signIn(entry) }}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {composition.length > 0 ? (
            <section className={styles.groupSection} aria-labelledby="mcp-composition">
              <h3 id="mcp-composition" className={styles.groupTitle}>{t('compositionSection')}</h3>
              <p className={styles.groupNote}>{t('compositionNote')}</p>
              <ul className={styles.rows}>
                {composition.map(entry => (
                  <ServerRow
                    key={entry.id}
                    entry={entry}
                    pending={false}
                    testing={testPending.has(entry.id)}
                    testResult={testResults[entry.id]}
                    failure={rowFailures[entry.id]}
                    t={t}
                    onToggleEnabled={() => {}}
                    onTest={() => { test(entry) }}
                    onEdit={() => {}}
                    onDelete={() => {}}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      <EditorModal
        open={editor !== undefined}
        draft={editor?.draft ?? emptyDraft()}
        creating={editor?.creating === true}
        t={t}
        onClose={() => { setEditor(undefined) }}
        onSave={async (spec) => {
          await props.upsert(spec)
          setEditor(undefined)
          void reloadReady().catch(() => {})
        }}
      />
      <Modal
        open={deleting !== undefined}
        onClose={() => { if (!deletePending) setDeleting(undefined) }}
        title={format(t('deleteTitle'), { name: deleting?.spec.serverName ?? '' })}
        closeLabel={t('close')}
        description={format(t('deleteBody'), { name: deleting?.spec.serverName ?? '' })}
        footer={(
          <>
            <Button disabled={deletePending} onClick={() => { setDeleting(undefined) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={deletePending}
              loading={deletePending}
              feedback={deletePending ? t('deleting') : undefined}
              aria-describedby={deleteFailure === undefined ? undefined : 'mcp-delete-error'}
              onClick={() => {
                if (deleting === undefined || deletePending) return
                const target = deleting
                setDeletePending(true)
                setDeleteFailure(undefined)
                void props.remove(target.id)
                  .then(() => {
                    if (!mountedRef.current) return
                    setDeletePending(false)
                    setDeleting(undefined)
                    void reloadReady().catch(() => {})
                  })
                  .catch((error: unknown) => {
                    if (!mountedRef.current) return
                    setDeleteFailure(messageOf(error, t('deleteFailed')))
                    notify(messageOf(error, t('deleteFailed')))
                    setDeletePending(false)
                  })
              }}
            >
              {t('deleteConfirm')}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <span className={styles.visuallyHidden} id="mcp-delete-error">{deleteFailure}</span>}
      </Modal>
    </div>
  )
}

function needsSignIn(entry: McpServerEntry): boolean {
  if (!entry.writable || !entry.enabled || entry.spec.transport !== 'streamable-http') return false
  const lastError = entry.connection?.lastError
  if (typeof lastError !== 'string') return false
  return /\b(?:HTTP\s+)?(?:401|403)\b|\b(?:unauthorized|forbidden)\b|\b(?:invalid_token|invalid_grant|insufficient_scope)\b|missing bearer token/i.test(lastError)
}

function ToolsDialog({
  open, name, tools, t, onClose,
}: {
  open: boolean
  name: string
  tools: readonly string[]
  t: McpSectionInjected['t']
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={format(t('toolsTitle'), { name })}
      headless
      className={styles.toolsDialog}
    >
      <div className={styles.toolsDialogHeader} data-dsh-modal-header="">
        <h2 className={styles.toolsDialogTitle}>{format(t('toolsTitle'), { name })}</h2>
        <button type="button" className={styles.toolsDialogClose} aria-label={t('close')} onClick={onClose}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      <ul className={styles.toolsDialogList}>
        {tools.map((tool) => (
          <li key={tool} className={styles.toolsDialogItem}>{tool}</li>
        ))}
      </ul>
    </Modal>
  )
}

function ServerRow({
  entry, pending, testing, testResult, failure, t, onToggleEnabled, onTest, onEdit, onDelete, signingIn, onSignIn,
}: {
  entry: McpServerEntry
  pending: boolean
  testing: boolean
  testResult: TestState | undefined
  failure: string | undefined
  t: McpSectionInjected['t']
  onToggleEnabled: (enabled: boolean) => void
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
  signingIn?: boolean
  onSignIn?: () => void
}) {
  const connection = entry.connection
  const status = connection !== undefined
    ? t(HEALTH[connection.health])
    : entry.fiberPhase === null ? t('unobserved') : t(PHASE[entry.fiberPhase])
  const state = connection !== undefined
    ? HEALTH_DOT[connection.health]
    : entry.fiberPhase === null ? undefined : PHASE_DOT[entry.fiberPhase]
  const detail = connection?.lastError !== undefined
    ? `${status}: ${connection.lastError}`
    : status
  const name = entry.spec.serverName
  const [toolsOpen, setToolsOpen] = useState(false)
  const failureId = useId()
  const testMessage = testResult?.status === 'error' ? testResult.message
    : testResult?.status === 'success' ? format(t('testSuccess'), { count: String(testResult.result.toolCount), tools: toolSummary(testResult.result.toolNames, t) }) : undefined
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.runtime} title={detail}>
          {state === undefined ? null : <StateDot state={state} />}
          <span>{status}</span>
        </span>
        <span className={styles.identity}>
          <strong className={styles.name}>{name}</strong>
          <span className={styles.summary}>{summaryLine(entry, t)}</span>
          {connection?.lastError === undefined ? null : (
            <span className={styles.lastError}>{connection.lastError}</span>
          )}
          {connection?.tools === undefined || connection.tools.length === 0 ? null : (
            <>
              <button type="button" className={styles.tools} onClick={() => { setToolsOpen(true) }}>
                {format(t('toolCount'), { count: String(connection.tools.length) })}
              </button>
              <ToolsDialog
                open={toolsOpen}
                name={name}
                tools={connection.tools}
                t={t}
                onClose={() => { setToolsOpen(false) }}
              />
            </>
          )}
        </span>
        <Pill>{entry.origin === 'managed' ? t('managed') : t('composition')}</Pill>
      </div>
      <div className={styles.rowActions}>
        <Button
          size="sm"
          variant="outline"
          disabled={testing || pending}
          aria-label={format(t('testFor'), { name })}
          title={testMessage}
          aria-describedby={testMessage === undefined ? undefined : `${failureId}-test`}
          loading={testing}
          feedback={testing ? t('testing') : undefined}
          onClick={onTest}
        >
          {t('test')}
        </Button>
        {entry.writable ? (
          <Switch
            checked={entry.enabled}
            disabled={pending}
            loading={pending}
            aria-describedby={failure === undefined ? undefined : failureId}
            title={failure}
            aria-label={format(t('enableAria'), { name })}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { onToggleEnabled(event.currentTarget.checked) }}
          />
        ) : <span className={styles.readOnly}>{t('readOnly')}</span>}
        {entry.writable ? (
          <>
            {needsSignIn(entry) && onSignIn !== undefined ? (
              <Button
                size="sm"
                variant="outline"
                disabled={signingIn === true || pending}
                aria-label={format(t('signInFor'), { name })}
                loading={signingIn === true}
                feedback={signingIn === true ? t('signingIn') : undefined}
                onClick={onSignIn}
              >
                {t('signIn')}
              </Button>
            ) : null}
            <button
              type="button"
              className={styles.iconButton}
              aria-label={format(t('editFor'), { name })}
              onClick={onEdit}
            >
              <IconEditOutline16 />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={format(t('removeFor'), { name })}
              onClick={onDelete}
            >
              <IconTrashOutline16 />
            </button>
          </>
        ) : null}
      </div>
      {failure === undefined ? null : <span className={styles.visuallyHidden} id={failureId}>{failure}</span>}
      {testMessage === undefined ? null : <span className={styles.visuallyHidden} id={`${failureId}-test`}>{testMessage}</span>}
    </li>
  )
}

interface EditorDraft {
  readonly id: string
  readonly serverName: string
  readonly enabled: boolean
  readonly transport: McpServerRecord['transport']
  readonly timeout: string
  readonly stdio: {
    readonly command: string
    readonly args: string
    readonly env: string
    readonly cwd: string
  }
  readonly http: {
    readonly url: string
    readonly headers: string
  }
  readonly retained: Pick<McpServerRecord, 'failOnStartupError' | 'reconnect'>
}

type FieldError = Partial<Record<'id' | 'serverName' | 'command' | 'url' | 'env' | 'headers' | 'timeout', string>>

function EditorModal({ open, draft, creating, t, onClose, onSave }: {
  open: boolean
  draft: McpServerRecord
  creating: boolean
  t: McpSectionInjected['t']
  onClose: () => void
  onSave: (spec: McpServerRecord) => Promise<void>
}) {
  const fieldId = useId()
  const [form, setForm] = useState<EditorDraft>(() => editorDraft(draft))
  const [mode, setMode] = useState<EditorMode>('form')
  const [jsonText, setJsonText] = useState(() => toJsonText(editorDraft(draft)))
  const [envOpen, setEnvOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [remoteError, setRemoteError] = useState<string | undefined>()
  const [remoteErrorDismissed, setRemoteErrorDismissed] = useState(false)
  const [remoteErrorSequence, setRemoteErrorSequence] = useState(0)
  useEffect(() => { setRemoteErrorDismissed(false) }, [remoteError])
  useEffect(() => {
    const next = editorDraft(draft)
    setForm(next)
    setMode('form')
    setJsonText(toJsonText(next))
    setEnvOpen((draft.transport === 'stdio' ? Object.keys(draft.env ?? {}).length : 0) > 0)
    setSubmitted(false)
    setPending(false)
    setRemoteError(undefined)
  }, [draft, open])

  const errors = submitted && mode === 'form' ? validate(form, t) : {}
  const describedBy = (name: keyof FieldError, hint?: string): string | undefined => {
    if (errors[name] !== undefined) return `${fieldId}-${name}-error`
    return hint === undefined ? undefined : `${fieldId}-${name}-hint`
  }
  const updateIdentity = (patch: Partial<Pick<EditorDraft, 'id' | 'serverName'>>): void => {
    setForm(current => ({ ...current, ...patch }))
    setRemoteError(undefined)
  }
  const fallback = (): { id: string; serverName: string; enabled: boolean } => ({
    id: form.id,
    serverName: form.serverName,
    enabled: form.enabled,
  })
  const applyJson = (): McpServerRecord | undefined => {
    const parsed = parseServerJson(jsonText, fallback())
    if (!parsed.ok) {
      setRemoteErrorDismissed(false)
      setRemoteErrorSequence(sequence => sequence + 1)
      setRemoteError(t(parsed.messageKey))
      return undefined
    }
    return parsed.record
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!pending) onClose() }}
      title={creating ? t('editorTitleAdd') : t('editorTitleEdit')}
      closeLabel={t('close')}
      description={t('editorDescription')}
      {...styles.modalContent === undefined ? {} : { contentClassName: styles.modalContent }}
      footer={(
        <>
          <Button disabled={pending} onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={pending}
            loading={pending}
            feedback={pending ? t('saving') : undefined}
            onClick={() => {
              if (pending) return
              setRemoteErrorDismissed(false)
              setRemoteErrorSequence(sequence => sequence + 1)
              setSubmitted(true)
              setRemoteError(undefined)
              if (mode === 'json') {
                const record = applyJson()
                if (record === undefined) return
                const nextForm = editorDraft(record)
                const nextErrors = validate(nextForm, t)
                if (Object.keys(nextErrors).length > 0) {
                  setForm(nextForm)
                  setMode('form')
                  setRemoteError(Object.values(nextErrors).join('; '))
                  return
                }
                setPending(true)
                void onSave(record).catch((error: unknown) => {
                  setRemoteError(messageOf(error, t('saveFailed')))
                }).finally(() => { setPending(false) })
                return
              }
              const nextErrors = validate(form, t)
              if (Object.keys(nextErrors).length > 0) {
                setRemoteError(Object.values(nextErrors).join('; '))
                return
              }
              setPending(true)
              void onSave(toRecord(form)).catch((error: unknown) => {
                setRemoteError(messageOf(error, t('saveFailed')))
              }).finally(() => { setPending(false) })
            }}
          >
            {t('save')}
          </Button>
        </>
      )}
    >
      <div className={styles.form}>
        <div className={styles.modeSwitch} role="group" aria-label={t('editorMode')}>
          <Button
            size="sm"
            className={mode === 'form' ? styles.modeActive : undefined}
            aria-pressed={mode === 'form'}
            disabled={pending}
            onClick={() => {
              if (mode === 'form') return
              const record = applyJson()
              if (record === undefined) return
              setForm(editorDraft(record))
              setMode('form')
            }}
          >
            {t('editorModeForm')}
          </Button>
          <Button
            size="sm"
            className={mode === 'json' ? styles.modeActive : undefined}
            aria-pressed={mode === 'json'}
            disabled={pending}
            onClick={() => {
              if (mode === 'json') return
              setJsonText(toJsonText(form))
              setRemoteError(undefined)
              setMode('json')
            }}
          >
            {t('editorModeJson')}
          </Button>
        </div>

        {mode === 'json' ? (
          <label className={styles.field}>
            <span className={styles.label}>{t('jsonLabel')}</span>
            <textarea
              className={styles.jsonEditor}
              aria-label={t('jsonLabel')}
              aria-invalid={remoteError !== undefined}
              aria-describedby={remoteError === undefined ? undefined : `${fieldId}-remote-error`}
              spellCheck={false}
              value={jsonText}
              disabled={pending}
              onChange={(event) => {
                setJsonText(event.currentTarget.value)
                setRemoteError(undefined)
              }}
            />
          </label>
        ) : (
          <>
            <fieldset className={styles.group}>
              <legend>{t('generalGroup')}</legend>
              <Field label={t('id')} hint={t('idHint')} error={errors.id} id={`${fieldId}-id`}>
                <Input
                  id={`${fieldId}-id`}
                  value={form.id}
                  disabled={!creating || pending}
                  aria-invalid={errors.id !== undefined}
                  aria-describedby={describedBy('id', t('idHint'))}
                  onChange={(event) => {
                    const id = event.currentTarget.value
                    updateIdentity({ id, serverName: form.serverName === form.id ? id : form.serverName })
                  }}
                />
              </Field>
              <Field label={t('serverName')} hint={t('serverNameHint')} error={errors.serverName} id={`${fieldId}-serverName`}>
                <Input
                  id={`${fieldId}-serverName`}
                  value={form.serverName}
                  disabled={pending}
                  aria-invalid={errors.serverName !== undefined}
                  aria-describedby={describedBy('serverName', t('serverNameHint'))}
                  onChange={(event) => { updateIdentity({ serverName: event.currentTarget.value }) }}
                />
              </Field>
              <label className={styles.field}>
                <span className={styles.label}>{t('transport')}</span>
                <SettingsSelect
                  variant="block"
                  aria-label={t('transport')}
                  value={form.transport}
                  disabled={pending}
                  options={[
                    { id: 'stdio', label: t('stdio') },
                    { id: 'streamable-http', label: t('http') },
                  ]}
                  onChange={(id) => {
                    const transport = id === 'streamable-http' ? 'streamable-http' : 'stdio'
                    setForm(current => ({ ...current, transport }))
                    setRemoteError(undefined)
                  }}
                />
              </label>
              <Field label={t('timeout')} hint={t('timeoutHint')} error={errors.timeout} id={`${fieldId}-timeout`}>
                <Input
                  id={`${fieldId}-timeout`}
                  inputMode="numeric"
                  value={form.timeout}
                  disabled={pending}
                  aria-invalid={errors.timeout !== undefined}
                  aria-describedby={describedBy('timeout', t('timeoutHint'))}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setForm(current => ({ ...current, timeout: value }))
                    setRemoteError(undefined)
                  }}
                />
              </Field>
            </fieldset>

            <fieldset className={styles.group}>
              <legend>{t('connectionGroup')}</legend>
              {form.transport === 'stdio' ? (
                <>
                  <div className={styles.riskNote} role="note">
                    <strong>{t('stdioRiskTitle')}</strong>
                    <span>{t('stdioRiskBody')}</span>
                  </div>
                  <Field label={t('command')} error={errors.command} id={`${fieldId}-command`}>
                    <Input
                      id={`${fieldId}-command`}
                      value={form.stdio.command}
                      disabled={pending}
                      aria-invalid={errors.command !== undefined}
                      aria-describedby={describedBy('command')}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setForm(current => ({ ...current, stdio: { ...current.stdio, command: value } }))
                        setRemoteError(undefined)
                      }}
                    />
                  </Field>
                  <Field label={t('args')} id={`${fieldId}-args`}>
                    <Input
                      id={`${fieldId}-args`}
                      value={form.stdio.args}
                      disabled={pending}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setForm(current => ({ ...current, stdio: { ...current.stdio, args: value } }))
                      }}
                    />
                  </Field>
                  <Field label={t('cwd')} id={`${fieldId}-cwd`}>
                    <Input
                      id={`${fieldId}-cwd`}
                      value={form.stdio.cwd}
                      disabled={pending}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setForm(current => ({ ...current, stdio: { ...current.stdio, cwd: value } }))
                      }}
                    />
                  </Field>
                  <Button
                    size="sm"
                    aria-expanded={envOpen}
                    onClick={() => { setEnvOpen(current => !current) }}
                  >
                    {t('envToggle')}
                  </Button>
                  {envOpen ? (
                    <Field label={t('env')} error={errors.env} id={`${fieldId}-env`}>
                      <textarea
                        id={`${fieldId}-env`}
                        className={styles.textarea}
                        value={form.stdio.env}
                        disabled={pending}
                        aria-invalid={errors.env !== undefined}
                        aria-describedby={describedBy('env')}
                        onChange={(event) => {
                          const value = event.currentTarget.value
                          setForm(current => ({ ...current, stdio: { ...current.stdio, env: value } }))
                          setRemoteError(undefined)
                        }}
                      />
                    </Field>
                  ) : null}
                </>
              ) : (
                <>
                  <Field label={t('url')} error={errors.url} id={`${fieldId}-url`}>
                    <Input
                      id={`${fieldId}-url`}
                      type="url"
                      value={form.http.url}
                      disabled={pending}
                      aria-invalid={errors.url !== undefined}
                      aria-describedby={describedBy('url')}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setForm(current => ({ ...current, http: { ...current.http, url: value } }))
                        setRemoteError(undefined)
                      }}
                    />
                  </Field>
                  <Field label={t('headers')} error={errors.headers} id={`${fieldId}-headers`}>
                    <textarea
                      id={`${fieldId}-headers`}
                      className={styles.textarea}
                      value={form.http.headers}
                      disabled={pending}
                      aria-invalid={errors.headers !== undefined}
                      aria-describedby={describedBy('headers')}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setForm(current => ({ ...current, http: { ...current.http, headers: value } }))
                        setRemoteError(undefined)
                      }}
                    />
                  </Field>
                </>
              )}
            </fieldset>
          </>
        )}
        {remoteError === undefined ? null : <span className={styles.visuallyHidden} id={`${fieldId}-remote-error`}>{remoteError}</span>}
        {remoteError === undefined || remoteErrorDismissed ? null : <Toast key={remoteErrorSequence} text={remoteError} holdMs={9000} onDone={() => { setRemoteErrorDismissed(true) }} />}
      </div>
    </Modal>
  )
}

function Field({ label, hint, error, id, children }: {
  label: string
  hint?: string
  error?: string | undefined
  id: string
  children: ReactElement
}) {
  const baseId = id.replace(/-(?:id|serverName|command|args|env|cwd|url|headers|timeout)$/, '')
  const name = id.slice(baseId.length + 1)
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <Tooltip label={error ?? ''} disabled={error === undefined} portal side="bottom">{children}</Tooltip>
      {error === undefined ? null : <span className={styles.visuallyHidden} id={`${baseId}-${name}-error`}>{error}</span>}
      {hint === undefined ? null : <p className={styles.hint} id={`${baseId}-${name}-hint`}>{hint}</p>}
    </div>
  )
}

function emptyDraft(): McpServerRecord {
  return { id: '', enabled: true, transport: 'stdio', serverName: '', command: '' }
}

function editorDraft(spec: McpServerRecord): EditorDraft {
  return {
    id: spec.id,
    serverName: spec.serverName,
    enabled: spec.enabled,
    transport: spec.transport,
    timeout: spec.toolCallTimeoutMs === undefined ? '' : String(spec.toolCallTimeoutMs),
    retained: {
      ...(spec.failOnStartupError === undefined ? {} : { failOnStartupError: spec.failOnStartupError }),
      ...(spec.reconnect === undefined ? {} : { reconnect: spec.reconnect }),
    },
    stdio: spec.transport === 'stdio'
      ? { command: spec.command, args: (spec.args ?? []).join(' '), env: pairs(spec.env), cwd: spec.cwd ?? '' }
      : { command: '', args: '', env: '', cwd: '' },
    http: spec.transport === 'streamable-http'
      ? { url: spec.url, headers: pairs(spec.headers) }
      : { url: '', headers: '' },
  }
}

function validate(form: EditorDraft, t: McpSectionInjected['t']): FieldError {
  const errors: FieldError = {}
  if (!NAME.test(form.id)) errors.id = t('idInvalid')
  if (!NAME.test(form.serverName)) errors.serverName = t('serverNameInvalid')
  if (form.timeout.trim().length > 0 && !TIMEOUT.test(form.timeout.trim())) errors.timeout = t('timeoutInvalid')
  if (form.transport === 'stdio') {
    if (form.stdio.command.trim().length === 0) errors.command = t('commandRequired')
    const invalid = invalidPairLine(form.stdio.env)
    if (invalid !== undefined) errors.env = format(t('envLineInvalid'), { line: String(invalid) })
  } else {
    if (form.http.url.trim().length === 0) errors.url = t('urlRequired')
    else if (!isHttpUrl(form.http.url)) errors.url = t('urlInvalid')
    const invalid = invalidPairLine(form.http.headers)
    if (invalid !== undefined) errors.headers = format(t('headerLineInvalid'), { line: String(invalid) })
  }
  return errors
}

function toRecord(form: EditorDraft): McpServerRecord {
  const timeout = form.timeout.trim()
  const common = {
    ...form.retained,
    id: form.id.trim(),
    serverName: form.serverName.trim(),
    enabled: form.enabled,
    ...(timeout.length === 0 ? {} : { toolCallTimeoutMs: Number(timeout) }),
  }
  if (form.transport === 'stdio') {
    const args = splitArgs(form.stdio.args)
    const env = parsePairs(form.stdio.env)
    const cwd = form.stdio.cwd.trim()
    return {
      ...common,
      transport: 'stdio',
      command: form.stdio.command.trim(),
      ...(args.length === 0 ? {} : { args }),
      ...(Object.keys(env).length === 0 ? {} : { env }),
      ...(cwd.length === 0 ? {} : { cwd }),
    } satisfies StdioRecord
  }
  const headers = parsePairs(form.http.headers)
  return {
    ...common,
    transport: 'streamable-http',
    url: form.http.url.trim(),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  } satisfies HttpRecord
}

function toJsonText(form: EditorDraft): string {
  const name = form.serverName.trim() || form.id.trim() || 'server'
  const body: Record<string, unknown> = { transport: form.transport }
  if (form.transport === 'stdio') {
    body.command = form.stdio.command
    const args = splitArgs(form.stdio.args)
    if (args.length > 0) body.args = args
    if (form.stdio.cwd.trim().length > 0) body.cwd = form.stdio.cwd.trim()
    const env = parsePairs(form.stdio.env)
    if (Object.keys(env).length > 0) body.env = env
  } else {
    body.url = form.http.url
    const headers = parsePairs(form.http.headers)
    if (Object.keys(headers).length > 0) body.headers = headers
  }
  if (TIMEOUT.test(form.timeout.trim())) body.toolCallTimeoutMs = Number(form.timeout.trim())
  if (form.retained.failOnStartupError !== undefined) body.failOnStartupError = form.retained.failOnStartupError
  if (form.retained.reconnect !== undefined) body.reconnect = form.retained.reconnect
  return JSON.stringify({ [name]: body }, null, 2)
}

function parseServerJson(
  text: string,
  fallback: { id: string; serverName: string; enabled: boolean },
): { ok: true; record: McpServerRecord } | { ok: false; messageKey: 'jsonInvalid' | 'jsonEmpty' } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, messageKey: 'jsonInvalid' }
  }
  if (!isPlainObject(value)) return { ok: false, messageKey: 'jsonInvalid' }
  const root = isPlainObject(value.mcpServers) ? value.mcpServers : value
  if (isSpec(root)) {
    const name = fallback.serverName || fallback.id
    if (name.length === 0) return { ok: false, messageKey: 'jsonEmpty' }
    return { ok: true, record: specToRecord(name, root, fallback) }
  }
  const entries = Object.entries(root).filter((entry): entry is [string, Record<string, unknown>] => isSpec(entry[1]))
  if (entries.length === 0) return { ok: false, messageKey: 'jsonEmpty' }
  const match = entries.find(([key]) => key === fallback.id || key === fallback.serverName) ?? entries[0]
  if (match === undefined) return { ok: false, messageKey: 'jsonEmpty' }
  return { ok: true, record: specToRecord(match[0], match[1], fallback) }
}

function retainedFromSpec(spec: Record<string, unknown>): Pick<McpServerRecord, 'failOnStartupError' | 'reconnect'> {
  const failOnStartupError = typeof spec.failOnStartupError === 'boolean' ? spec.failOnStartupError : undefined
  const reconnect = parseReconnect(spec.reconnect)
  return {
    ...(failOnStartupError === undefined ? {} : { failOnStartupError }),
    ...(reconnect === undefined ? {} : { reconnect }),
  }
}

function parseReconnect(value: unknown): McpServerRecord['reconnect'] {
  if (!isPlainObject(value)) return undefined
  const reconnect = {
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(isPositiveNumber(value.initialDelayMs) ? { initialDelayMs: value.initialDelayMs } : {}),
    ...(isPositiveNumber(value.maxDelayMs) ? { maxDelayMs: value.maxDelayMs } : {}),
    ...(isPositiveNumber(value.maxAttempts) ? { maxAttempts: value.maxAttempts } : {}),
  }
  return Object.keys(reconnect).length === 0 ? undefined : reconnect
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function specToRecord(
  name: string,
  spec: Record<string, unknown>,
  fallback: { id: string; serverName: string; enabled: boolean },
): McpServerRecord {
  const rawTransport = typeof spec.transport === 'string' ? spec.transport : typeof spec.type === 'string' ? spec.type : undefined
  const url = typeof spec.url === 'string' ? spec.url : ''
  const httpish = rawTransport === 'streamable-http' || rawTransport === 'http' || rawTransport === 'sse'
    || (url.length > 0 && rawTransport !== 'stdio')
  const id = pickName(spec.id, name, fallback.id)
  const serverName = pickName(spec.serverName, name, fallback.serverName)
  const enabled = typeof spec.enabled === 'boolean' ? spec.enabled : fallback.enabled
  const timeout = typeof spec.toolCallTimeoutMs === 'number' && Number.isInteger(spec.toolCallTimeoutMs) && spec.toolCallTimeoutMs > 0
    ? spec.toolCallTimeoutMs
    : undefined
  const retained = retainedFromSpec(spec)
  const shared = {
    id,
    serverName,
    enabled,
    ...retained,
    ...(timeout === undefined ? {} : { toolCallTimeoutMs: timeout }),
  }
  if (httpish) {
    const headers = isPlainObject(spec.headers) ? stringMap(spec.headers) : undefined
    return {
      ...shared,
      transport: 'streamable-http',
      url,
      ...(headers === undefined || Object.keys(headers).length === 0 ? {} : { headers }),
    }
  }
  const args = normalizeArgs(spec.args)
  const env = isPlainObject(spec.env) ? stringMap(spec.env) : undefined
  const cwd = typeof spec.cwd === 'string' ? spec.cwd.trim() : ''
  return {
    ...shared,
    transport: 'stdio',
    command: typeof spec.command === 'string' ? spec.command : '',
    ...(args.length === 0 ? {} : { args }),
    ...(env === undefined || Object.keys(env).length === 0 ? {} : { env }),
    ...(cwd.length === 0 ? {} : { cwd }),
  }
}

function isSpec(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && (
    typeof value.command === 'string'
    || typeof value.url === 'string'
    || typeof value.transport === 'string'
    || typeof value.type === 'string'
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringMap(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function pickName(...candidates: unknown[]): string {
  for (const value of candidates) {
    if (typeof value === 'string' && NAME.test(value)) return value
  }
  const first = candidates.find((value): value is string => typeof value === 'string' && value.length > 0)
  return first ?? ''
}

function normalizeArgs(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string') return splitArgs(value)
  return []
}

function splitArgs(value: string): string[] {
  const trimmed = value.trim()
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/)
}

function summaryLine(entry: McpServerEntry, t: McpSectionInjected['t']): string {
  if (entry.spec.transport === 'stdio') {
    const args = (entry.spec.args ?? []).join(' ')
    const command = args.length === 0 ? entry.spec.command : `${entry.spec.command} ${args}`
    return entry.spec.cwd === undefined || entry.spec.cwd.length === 0
      ? `${t('stdio')} · ${command}`
      : `${t('stdio')} · ${command} · ${entry.spec.cwd}`
  }
  return `${t('http')} · ${entry.spec.url}`
}

function searchableValues(entry: McpServerEntry): readonly string[] {
  return entry.spec.transport === 'stdio'
    ? [entry.spec.serverName, entry.id, entry.spec.command]
    : [entry.spec.serverName, entry.id, entry.spec.url]
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

function invalidPairLine(text: string): number | undefined {
  const rows = text.split(/\r?\n/)
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]?.trim() ?? ''
    if (row.length === 0) continue
    const separator = row.indexOf('=')
    if (separator <= 0 || !PAIR_KEY.test(row.slice(0, separator).trim())) return index + 1
  }
  return undefined
}

function pairs(values: Readonly<Record<string, string>> | undefined): string {
  return Object.entries(values ?? {}).map(([key, value]) => `${key}=${value}`).join('\n')
}

function parsePairs(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/).map(item => item.trim()).filter(item => item.length > 0)) {
    const index = line.indexOf('=')
    result[line.slice(0, index).trim()] = line.slice(index + 1)
  }
  return result
}

function omitKey(values: Readonly<Record<string, string>>, key: string): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(values).filter(([entryKey]) => entryKey !== key))
}

function omitTestResult(values: Readonly<Record<string, TestState>>, key: string): Readonly<Record<string, TestState>> {
  return Object.fromEntries(Object.entries(values).filter(([entryKey]) => entryKey !== key))
}

function toolSummary(names: readonly string[], t: McpSectionInjected['t']): string {
  if (names.length === 0) return t('testNoTools')
  const visible = names.slice(0, 3).join(', ')
  return names.length <= 3 ? visible : format(t('testMoreTools'), { names: visible, count: String(names.length - 3) })
}

function format(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}
