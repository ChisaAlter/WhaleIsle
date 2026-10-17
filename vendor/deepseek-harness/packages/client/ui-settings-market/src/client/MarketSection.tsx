import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
  Input,
  Pill,
  Modal,
  Tooltip,
  Toast,
  IconInfoOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  InstalledPlugin,
  MarketCatalog,
  MarketItem,
  MarketplaceUpdateStatus,
  MarketplaceUpdatesPayload,
  PluginOpResult,
  PluginProgress,
  MarketplaceState,
  MarketplaceDetails,
} from './desktop-shell.ts'
import { MarketChoice, MarketDetails, MarketHistory, marketHttpsUrl } from './MarketExtras.tsx'
import { specMatchesOwnerRepo } from './spec-match.ts'
import css from './MarketSection.module.css'

/** Registration-side desktop callbacks used by the marketplace section. */
export interface MarketSectionInjected {
  /** Load bounded public documentation and manifest requirements by curated id. */
  getDetails: (id: string, options?: { force?: boolean }) => Promise<MarketplaceDetails>
  /** Read durable desktop favorites and operation history. */
  getMarketState: () => Promise<MarketplaceState>
  /** Persist one favorite without replacing other tabs' preferences. */
  setFavorite: (id: string, favorite: boolean) => Promise<MarketplaceState>
  /** Sequential updates with one desktop-owned restart. */
  updateMany: (ids: string[]) => Promise<PluginOpResult>
  /** Read the curated catalog (localized main-process payload). */
  listCatalog: (options?: { refresh?: boolean }) => Promise<MarketCatalog>
  /** Read the profile's installed-plugin rows. */
  listInstalled: () => Promise<InstalledPlugin[]>
  /** Compare installed versions/commits with curated upstream sources. */
  checkUpdates: (options?: { force?: boolean }) => Promise<MarketplaceUpdatesPayload>
  /** Install one catalog row by registry id; the engine restarts Harness. */
  install: (id: string, options?: { allowBuilds?: string[] }) => Promise<PluginOpResult>
  /** Update one installed catalog row; the engine rolls back failures. */
  update: (id: string, options?: { allowBuilds?: string[] }) => Promise<PluginOpResult>
  /** Uninstall one installed package by name; the engine restarts Harness. */
  uninstall: (name: string) => Promise<PluginOpResult>
  /** Subscribe to install/uninstall/restart progress lines. */
  onProgress: (listener: (payload: PluginProgress) => void) => () => void
}

/** Full component props assembled by the Settings section slot. */
export type MarketSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.market'>
  & InjectFace<MarketSectionInjected>

type CatalogState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  /** `refreshFailed` keeps the shown catalog when a later reload throws. */
  | { readonly status: 'ready'; readonly catalog: MarketCatalog; readonly refreshFailed?: boolean }

type Tab = 'discover' | 'installed' | 'favorites' | 'history'

type BusyOp = { kind: 'install' | 'update' | 'uninstall' | 'batch'; id: string } | null
type Confirmation = { kind: 'install'; item: MarketItem }
  | { kind: 'uninstall'; id: string; name: string }
  | { kind: 'batch'; ids: string[] }

type Notice = { kind: 'ok' | 'error'; text: string; retry?: 'catalog' } | null

type AllowBuildsAsk = { kind: 'install' | 'update'; item: MarketItem; keys: string[] } | null


/**
 * Discover cards rendered per page. The curated registry carries thousands of
 * rows; mounting them all at once stalls the settings panel, so the pane
 * renders one page and grows on demand through the show-more button.
 */
export const DISCOVER_PAGE_SIZE = 60

/** The installed package name backing one catalog row, or null. */
function installedNameFor(item: MarketItem, plugins: InstalledPlugin[]): string | null {
  if (item.packageName && plugins.some(row => row.name === item.packageName)) {
    return item.packageName
  }
  const bySpec = plugins.find(row => specMatchesOwnerRepo(row.spec, item.owner, item.repo))
  return bySpec ? bySpec.name : null
}

/** The catalog row backing one installed plugin, or null when uncatalogued. */
function catalogItemFor(plugin: InstalledPlugin, items: MarketItem[]): MarketItem | null {
  const byName = items.find(item => item.packageName === plugin.name)
  if (byName) return byName
  return items.find(item => specMatchesOwnerRepo(plugin.spec, item.owner, item.repo)) ?? null
}

/**
 * Whether a not-yet-installed catalog row may offer its Install button:
 * deprecated rows and rows whose desktop engine resolved no install spec
 * get no install path from the card (parity: 空 `installSpec` 的卡片不提供
 * 安装按钮), matching the main-process gate that rejects them anyway.
 */
function installable(item: MarketItem): boolean {
  return item.deprecated !== true && item.installSpec.trim().length > 0
}

/** Compact display value: full semver, short Git commit. */
function updateValue(status: MarketplaceUpdateStatus, value: string): string {
  return status.kind === 'github' ? value.slice(0, 7) : value
}

/** Whether one catalog row matches the local search query. */
function matches(item: MarketItem, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [item.id, item.description, item.packageName]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/**
 * Plugin owner's GitHub avatar (no API call, browser-cached), falling back
 * to an initial-letter tile when the image cannot load.
 * @param props.owner - GitHub owner login; empty skips the network image.
 * @param props.repo - repository name feeding the fallback initial.
 * @returns a 16px decorative avatar node.
 */
function OwnerAvatar({ owner, repo }: { owner: string; repo: string }): ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed || owner === '') {
    return (
      <span className={css.avatarFallback} aria-hidden="true">
        {(repo.replace(/^dsh[-_]/i, '').charAt(0) || 'P').toUpperCase()}
      </span>
    )
  }
  return (
    <img
      className={css.avatar}
      src={`https://github.com/${encodeURIComponent(owner)}.png?size=96`}
      alt=""
      loading="lazy"
      onError={() => { setFailed(true) }}
    />
  )
}

/** One installed-pane group: a localized category heading plus its rows. */
type InstalledGroup = {
  key: string
  label: string
  rows: { plugin: InstalledPlugin; item: MarketItem | null }[]
}

/**
 * Group installed rows by their catalog category, keeping catalog order;
 * rows without a catalog match land in a trailing ungrouped section.
 */
function installedGroups(
  plugins: InstalledPlugin[],
  catalog: MarketCatalog,
  ungroupedLabel: string,
): InstalledGroup[] {
  const categories = catalog.categories.filter(row => row.id !== 'all')
  const rows = plugins.map(plugin => ({ plugin, item: catalogItemFor(plugin, catalog.items) }))
  const groups: InstalledGroup[] = []
  for (const category of categories) {
    const members = rows.filter(row => row.item !== null && row.item.category === category.id)
    if (members.length > 0) groups.push({ key: category.id, label: category.label, rows: members })
  }
  const grouped = new Set(groups.flatMap(group => group.rows.map(row => row.plugin.name)))
  const rest = rows.filter(row => !grouped.has(row.plugin.name))
  if (rest.length > 0) groups.push({ key: 'ungrouped', label: ungroupedLabel, rows: rest })
  return groups
}

/**
 * Marketplace settings section: a Discover tab (curated catalog browse/search
 * with per-card install) and an Installed tab (profile rows grouped by catalog
 * category with uninstall), plus allow-builds approval and progress lines.
 * All engine work happens in the desktop main process behind the injected
 * callbacks.
 * @param props - composed slot props plus the desktop inject face.
 * @returns the section content.
 */
export function MarketSection({
  t,
  listCatalog,
  listInstalled,
  getMarketState,
  getDetails,
  setFavorite,
  updateMany,
  checkUpdates,
  install,
  update,
  uninstall,
}: MarketSectionProps): ReactNode {
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const [reloading, setReloading] = useState(false)
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [updates, setUpdates] = useState<Record<string, MarketplaceUpdateStatus>>({})
  const [updatesChecked, setUpdatesChecked] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updateCheckFailed, setUpdateCheckFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('discover')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [categoriesExpanded, setCategoriesExpanded] = useState(false)
  const [visibleCount, setVisibleCount] = useState(DISCOVER_PAGE_SIZE)
  const [busy, setBusy] = useState<BusyOp>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [noticeDismissed, setNoticeDismissed] = useState(false)
  const [noticeSequence, setNoticeSequence] = useState(0)
  const marketStateReadFailed = useRef(false)
  const notify = useCallback((value: Notice): void => {
    setNotice(value)
    setNoticeDismissed(false)
    setNoticeSequence(sequence => sequence + 1)
  }, [])
  const [ask, setAsk] = useState<AllowBuildsAsk>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [details, setDetails] = useState<MarketItem | null>(null)
  const [marketState, setMarketState] = useState<MarketplaceState>({ ok: true, favorites: [], operations: [] })
  const [favoriteBusy, setFavoriteBusy] = useState<string | undefined>()
  const [sort, setSort] = useState('catalog')
  const [period, setPeriod] = useState('all')
  const [installedFilter, setInstalledFilter] = useState('all')
  const operationLock = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const reloadMarketState = useCallback(async () => {
    try {
      const next = await getMarketState()
      if (next.ok !== true) throw new Error(t('stateFailed'))
      marketStateReadFailed.current = false
      if (alive.current) setMarketState(next)
    } catch {
      if (alive.current && !marketStateReadFailed.current) notify({ kind: 'error', text: t('stateFailed') })
      marketStateReadFailed.current = true
    }
  }, [getMarketState, notify, t])

  useEffect(() => {
    void reloadMarketState()
    const timer = setInterval(() => { void reloadMarketState() }, 3000)
    return () => { clearInterval(timer) }
  }, [reloadMarketState])

  const toggleFavorite = async (id: string) => {
    setFavoriteBusy(id)
    try {
      const next = await setFavorite(id, !marketState.favorites.includes(id))
      if (next.ok !== true) throw new Error(t('stateFailed'))
      if (alive.current) setMarketState(next)
    } catch {
      if (alive.current) notify({ kind: 'error', text: t('stateFailed') })
    } finally {
      if (alive.current) setFavoriteBusy(undefined)
    }
  }

  const reloadInstalled = useCallback(async () => {
    try {
      const plugins = await listInstalled()
      if (alive.current) setInstalled(plugins)
    } catch {
      if (alive.current) notify({ kind: 'error', text: t('installedReadFailed') })
    }
  }, [listInstalled, notify, t])

  const reloadUpdates = useCallback(async (force: boolean) => {
    setCheckingUpdates(true)
    setUpdateCheckFailed(false)
    try {
      const payload = await checkUpdates(force ? { force: true } : undefined)
      if (!alive.current) return
      setUpdates(payload.updates ?? {})
      setUpdatesChecked(true)
      setUpdateCheckFailed(payload.ok === false)
    } catch {
      if (alive.current) {
        setUpdatesChecked(true)
        setUpdateCheckFailed(true)
      }
    } finally {
      if (alive.current) setCheckingUpdates(false)
    }
  }, [checkUpdates])

  const load = useCallback(async (refresh: boolean) => {
    setNoticeDismissed(true)
    setReloading(true)
    setState(current => (current.status === 'ready' ? current : { status: 'loading' }))
    try {
      const catalog = await listCatalog(refresh ? { refresh: true } : undefined)
      if (catalog.ok !== true) throw new Error(t('loadError'))
      if (alive.current) {
        setState({ status: 'ready', catalog })
        await Promise.all([reloadInstalled(), reloadUpdates(refresh)])
      }
    } catch {
      // A failed reload keeps the shown catalog (per the marketplace failure
      // conventions); only the first load may land on the bare error state.
      if (alive.current) {
        setState(current => (current.status === 'ready'
          ? { ...current, refreshFailed: true }
          : { status: 'error' }))
        notify({ kind: 'error', text: t('loadError'), retry: 'catalog' })
      }
    } finally {
      if (alive.current) setReloading(false)
    }
  }, [listCatalog, reloadInstalled, reloadUpdates, notify, t])

  useEffect(() => { void load(false) }, [load])

  const runOp = useCallback(async (
    op: BusyOp & object,
    work: () => Promise<PluginOpResult>,
    doneText: string,
  ) => {
    if (operationLock.current) return
    operationLock.current = true
    setBusy(op)
    setNotice(null)
    setAsk(null)
    try {
      const result = await work()
      if (!alive.current) return
      const withHistoryWarning = (text: string): string => [text, result.historyWarning].filter(Boolean).join(' ')
      if (result.ok === true) {
        notify(result.harnessStarted === false
          ? { kind: 'error', text: withHistoryWarning(result.error || t('harnessDown')) }
          : result.harnessStarted !== true
            ? { kind: 'error', text: withHistoryWarning(t('opOutcomeUnknown')) }
          : result.historyWarning
            ? { kind: 'error', text: result.historyWarning }
          : { kind: 'ok', text: doneText })
      } else if (result.needsAllowBuilds && (op.kind === 'install' || op.kind === 'update')) {
        const item = state.status === 'ready'
          ? state.catalog.items.find(row => row.id === op.id) ?? null
          : null
        const keys = result.allowBuilds ?? []
        if (item && keys.length > 0) {
          setAsk({ kind: op.kind, item, keys })
          if (result.historyWarning) notify({ kind: 'error', text: result.historyWarning })
        } else notify({ kind: 'error', text: withHistoryWarning(t('opFailed', { message: result.error || t('buildApprovalMissing') })) })
        if (result.rolledBack === false) {
          setAsk(null)
          notify({ kind: 'error', text: withHistoryWarning(t('opFailed', { message: result.error || result.rollbackError || t('operationFailed') })) })
        }
      } else {
        notify({ kind: 'error', text: withHistoryWarning(t('opFailed', { message: result.error || t('unknown') })) })
      }
    } catch (caught) {
      if (alive.current) {
        notify({ kind: 'error', text: t('opFailed', { message: caught instanceof Error ? caught.message : String(caught) }) })
      }
    } finally {
      operationLock.current = false
      if (alive.current) {
        setBusy(null)
        void reloadInstalled()
        void reloadUpdates(true)
        void reloadMarketState()
      }
    }
  }, [reloadInstalled, reloadUpdates, reloadMarketState, state, notify, t])

  const startInstall = useCallback((item: MarketItem, allowBuilds?: string[]) => {
    void runOp(
      { kind: 'install', id: item.id },
      () => install(item.id, allowBuilds && allowBuilds.length > 0 ? { allowBuilds } : undefined),
      t('installDone'),
    )
  }, [install, runOp, t])

  const startUpdate = useCallback((item: MarketItem, allowBuilds?: string[]) => {
    void runOp(
      { kind: 'update', id: item.id },
      () => update(item.id, allowBuilds && allowBuilds.length > 0 ? { allowBuilds } : undefined),
      t('updateDone'),
    )
  }, [runOp, t, update])

  const startUninstall = useCallback((opId: string, name: string) => {
    void runOp({ kind: 'uninstall', id: opId }, () => uninstall(name), t('uninstallDone'))
  }, [runOp, t, uninstall])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const items = useMemo(() => {
    if (state.status !== 'ready') return []
    const cutoff = period === 'all' ? 0 : Date.now() - Number(period) * 86400000
    const filtered = state.catalog.items.filter(item => (
      (category === 'all' || item.category === category) && matches(item, normalizedQuery)
      && (tab !== 'favorites' || marketState.favorites.includes(item.id))
      && (cutoff === 0 || Date.parse(item.added || '') >= cutoff)
    ))
    if (sort === 'stars') filtered.sort((a, b) => b.stars - a.stars || a.id.localeCompare(b.id))
    if (sort === 'newest') filtered.sort((a, b) => (Date.parse(b.added || '') || 0) - (Date.parse(a.added || '') || 0) || a.id.localeCompare(b.id))
    return filtered
  }, [category, normalizedQuery, state, sort, period, tab, marketState.favorites])

  // A new search or category always starts back at the first page.
  useEffect(() => {
    setVisibleCount(DISCOVER_PAGE_SIZE)
  }, [category, normalizedQuery, sort, period, tab])

  const visibleItems = items.length > visibleCount ? items.slice(0, visibleCount) : items
  const hiddenCount = items.length - visibleItems.length

  const categoryLabels = useMemo(() => {
    if (state.status !== 'ready') return new Map<string, string>()
    return new Map(state.catalog.categories.map(row => [row.id, row.label]))
  }, [state])

  const groups = useMemo(() => (
    state.status === 'ready' ? installedGroups(installed, state.catalog, t('ungrouped'))
      .map(group => ({ ...group, rows: group.rows.filter(({ item }) => installedFilter === 'all'
        || (item && (installedFilter === 'updates' ? updates[item.id]?.updateAvailable : updates[item.id]?.checkFailed))) }))
      .filter(group => group.rows.length > 0) : []
  ), [installed, state, t, installedFilter, updates])

  const isBusy = busy !== null || marketState.operations.some(row => row.status === 'running')
  const updateCount = Object.values(updates).filter(status => status.updateAvailable).length
  const installedTabLabel = installed.length > 0
    ? `${t('tabInstalled')} (${installed.length})`
    : t('tabInstalled')

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {notice?.kind !== 'error' || noticeDismissed ? null : <Toast key={noticeSequence} text={notice.text}
        {...notice.retry ? { holdMs: null, actions: [{ label: t('retry'), onClick: () => { void load(true) } }] } : { holdMs: 9000 }}
        onDone={() => { setNoticeDismissed(true) }} />}
      {details ? <MarketDetails key={details.id} item={details} getDetails={getDetails} t={t} onClose={() => { setDetails(null) }} /> : null}
      {confirmation ? <Modal open title={t(confirmation.kind === 'install' ? 'confirmInstall' : confirmation.kind === 'batch' ? 'confirmBatch' : 'confirmUninstall')}
        className={css.confirmModal} contentClassName={css.dialogContent}
        closeLabel={t('close')} onClose={() => { setConfirmation(null) }}
        footer={<><Button size="sm" variant="ghost" onClick={() => { setConfirmation(null) }}>{t('allowBuildsCancel')}</Button>
          <Button size="sm" variant="primary" disabled={isBusy} onClick={() => {
            const action = confirmation
            setConfirmation(null)
            if (action.kind === 'install') startInstall(action.item)
            else if (action.kind === 'uninstall') startUninstall(action.id, action.name)
            else void runOp({ kind: 'batch', id: 'batch' }, () => updateMany(action.ids), t('updateDone'))
          }}>{t('confirmAction')}</Button></>}>
        <p className={css.detailsCopy}>{t(confirmation.kind === 'install' ? 'installWarning' : confirmation.kind === 'batch' ? 'batchWarning' : 'uninstallWarning')}</p>
        <pre className={css.confirmTarget}>{confirmation.kind === 'install' ? confirmation.item.installSpec
          : confirmation.kind === 'batch' ? confirmation.ids.join('\n') : confirmation.name}</pre>
      </Modal> : null}
      <header className={css.heading}>
        <div className={css.headingText}>
          <h2 className={css.title}>{t('heading')}</h2>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <div className={css.headingActions}>
          <Button
            size="sm"
            variant="outline"
            className={css.iconAction}
            icon={<IconRefreshOutline16 />}
            aria-label={state.status === 'loading' ? t('loading') : reloading ? t('refreshing') : t('refresh')}
            title={state.status === 'loading' ? t('loading') : reloading ? t('refreshing') : t('refresh')}
            disabled={isBusy || reloading || state.status === 'loading'}
            loading={reloading || state.status === 'loading'}
            onClick={() => { void load(true) }}
          />
        </div>
      </header>
      {state.status === 'ready' ? (
        <>
          <div className={css.tabs} role="tablist" aria-label={t('heading')}>
            <Pill
              role="tab"
              id="market-tab-discover"
              aria-selected={tab === 'discover'}
              aria-controls="market-panel-discover"
              active={tab === 'discover'}
              onClick={() => { setTab('discover') }}
            >
              {t('tabDiscover')}
            </Pill>
            <Pill
              role="tab"
              id="market-tab-installed"
              aria-selected={tab === 'installed'}
              aria-controls="market-panel-installed"
              active={tab === 'installed'}
              onClick={() => { setTab('installed') }}
            >
              {installedTabLabel}
            </Pill>
            {(['favorites', 'history'] as const).map(value => <Pill key={value} role="tab" id={`market-tab-${value}`}
              aria-selected={tab === value} aria-controls={`market-panel-${value}`} active={tab === value}
              onClick={() => { setTab(value) }}>{t(value === 'favorites' ? 'tabFavorites' : 'tabHistory')}</Pill>)}
          </div>
          {notice?.kind === 'ok' ? <p className={css.notice} data-kind="ok" role="status">{notice.text}</p> : null}
          {ask ? (
            <Modal open title={t('allowBuildsAsk', { name: ask.item.repo })} closeLabel={t('close')} onClose={() => { setAsk(null) }}
              className={css.confirmModal} contentClassName={css.dialogContent} footer={<>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    if (ask.kind === 'update') startUpdate(ask.item, ask.keys)
                    else startInstall(ask.item, ask.keys)
                  }}
                >
                  {t('allowBuildsConfirm')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAsk(null) }}>
                  {t('allowBuildsCancel')}
                </Button>
              </>}>
              {ask.keys.length > 0 ? <pre className={css.confirmTarget}>{t('allowBuildsKeys', { keys: ask.keys.join(', ') })}</pre> : null}
            </Modal>
          ) : null}
          <div
            key={tab}
            role="tabpanel"
            id={`market-panel-${tab}`}
            aria-labelledby={`market-tab-${tab}`}
            data-dsh-motion="swap"
            className={css.pane}
          >
            {tab === 'history' ? <MarketHistory operations={marketState.operations} t={t} /> : tab !== 'installed' ? (
              <>
                <div className={css.toolbar}>
                  <Input
                    className={css.search}
                    type="search"
                    icon={<IconSearchOutline16 />}
                    value={query}
                    placeholder={t('search')}
                    aria-label={t('search')}
                    onChange={(event) => { setQuery(event.currentTarget.value) }}
                  />
                  <MarketChoice labelKey="sort" value={sort} onChange={setSort} t={t}
                    options={[{ id: 'catalog', labelKey: 'sortCatalog' }, { id: 'stars', labelKey: 'sortStars' }, { id: 'newest', labelKey: 'sortNewest' }]} />
                  <MarketChoice labelKey="period" value={period} onChange={setPeriod} t={t}
                    options={[{ id: 'all', labelKey: 'periodAll' }, { id: '7', labelKey: 'periodWeek' }, { id: '30', labelKey: 'periodMonth' }]} />
                </div>
                {state.catalog.categories.length > 1 ? (
                  <div className={css.categories} role="radiogroup" aria-label={t('categories')}>
                    {state.catalog.categories.filter((row, index) => categoriesExpanded || index < 5 || row.id === category).map(row => (
                      <Pill
                        key={row.id}
                        role="radio"
                        aria-checked={category === row.id}
                        active={category === row.id}
                        onClick={() => { setCategory(row.id) }}
                      >
                        {row.label}
                        <span className={css.categoryCount}>{row.count}</span>
                      </Pill>
                    ))}
                    {state.catalog.categories.length > 5 ? (
                      <Button size="sm" variant="ghost" aria-expanded={categoriesExpanded}
                        onClick={() => { setCategoriesExpanded(value => !value) }}>
                        {t(categoriesExpanded ? 'collapseCategories' : 'expandCategories')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {state.catalog.warning ? (
                  <p className={css.warning} role="status">
                    <IconWarningOutline16 aria-hidden="true" />
                    <span>{state.catalog.warning}</span>
                  </p>
                ) : null}
                <p className={css.resultCount} data-market-count={items.length}>
                  {t('count', { count: String(items.length) })}
                </p>
                {state.catalog.items.length === 0 ? <p className={css.empty}>{t('empty')}</p> : null}
                {state.catalog.items.length > 0 && items.length === 0
                  ? <p className={css.empty}>{t('emptySearch')}</p>
                  : null}
                {items.length > 0 ? (
                  <ul className={css.cards}>
                    {visibleItems.map((item) => {
                      const installedName = installedNameFor(item, installed)
                      const updateStatus = updates[item.id]
                      const busyKind = busy !== null && busy.id === item.id ? busy.kind : null
                      return (
                        <li className={css.card} key={item.id} data-market-item={item.id}>
                          <div className={css.cardHead}>
                            <div className={css.cardIdentity}>
                              <span className={css.cardTitleRow}>
                                <strong className={css.cardTitle} title={item.id}>{item.repo}</strong>
                                {item.deprecated ? <span className={css.deprecatedTag}>{t('deprecated')}</span> : null}
                              </span>
                              <span className={css.cardByline}>
                                <OwnerAvatar owner={item.owner} repo={item.repo} />
                                <span className={css.cardOwner}>{item.owner}</span>
                                {item.stars > 0 ? (
                                  <span className={css.cardStars} title={t('stars', { count: String(item.stars) })}>
                                    ★ {item.stars}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                            <Tooltip label={t(marketState.favorites.includes(item.id) ? 'unfavorite' : 'favorite')}>
                              <span className={css.toolAnchor}><Button size="sm" variant="ghost" className={css.iconAction}
                                aria-label={t(marketState.favorites.includes(item.id) ? 'unfavorite' : 'favorite')}
                                aria-pressed={marketState.favorites.includes(item.id)} disabled={favoriteBusy !== undefined}
                                loading={favoriteBusy === item.id}
                                icon={<span aria-hidden="true">{marketState.favorites.includes(item.id) ? '★' : '☆'}</span>}
                                onClick={() => { void toggleFavorite(item.id) }} /></span>
                            </Tooltip>
                            <Tooltip label={t('details')}><span className={css.toolAnchor}><Button size="sm" variant="ghost" className={css.iconAction}
                              icon={<IconInfoOutline16 />} aria-label={t('details')} onClick={() => { setDetails(item) }} /></span></Tooltip>
                            {marketHttpsUrl(item.homepage) ? (
                              <a
                                className={css.cardLink}
                                href={marketHttpsUrl(item.homepage)!}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t('homepage')}
                                title={t('homepage')}
                              >
                                <IconRightUpOutline16 />
                              </a>
                            ) : null}
                          </div>
                          <p className={css.cardDescription}>{item.description}</p>
                          <div className={css.cardFoot}>
                            {item.category ? (
                              <Pill className={css.categoryTag}>
                                {categoryLabels.get(item.category) ?? item.category}
                              </Pill>
                            ) : null}
                            <span className={css.grow} />
                            {installedName ? (
                              <div className={css.cardActions}>
                                <span className={css.installedTag}>{t('installed')}</span>
                                {updateStatus?.updateAvailable && updateStatus.current && updateStatus.latest ? (
                                  <span
                                    className={css.updateMeta}
                                    title={t('updateFromTo', {
                                      current: updateStatus.current,
                                      latest: updateStatus.latest,
                                    })}
                                  >
                                    {t('updateFromTo', {
                                      current: updateValue(updateStatus, updateStatus.current),
                                      latest: updateValue(updateStatus, updateStatus.latest),
                                    })}
                                  </span>
                                ) : null}
                                {updateStatus?.updateAvailable ? (
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    disabled={isBusy}
                                    loading={busyKind === 'update'}
                                    feedback={busyKind === 'update' ? t('updating') : undefined}
                                    onClick={() => { startUpdate(item) }}
                                  >
                                    {t('update')}
                                  </Button>
                                ) : null}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isBusy}
                                  loading={busyKind === 'uninstall'}
                                  feedback={busyKind === 'uninstall' ? t('uninstalling') : undefined}
                                  onClick={() => { setConfirmation({ kind: 'uninstall', id: item.id, name: installedName }) }}
                                >
                                  {t('uninstall')}
                                </Button>
                              </div>
                            ) : installable(item) ? (
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={isBusy}
                                loading={busyKind === 'install'}
                                feedback={busyKind === 'install' ? t('installing') : undefined}
                                onClick={() => { setConfirmation({ kind: 'install', item }) }}
                              >
                                {t('install')}
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
                {hiddenCount > 0 ? (
                  <div className={css.showMore}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setVisibleCount(current => current + DISCOVER_PAGE_SIZE) }}
                    >
                      {t('showMore', { count: String(hiddenCount) })}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className={css.toolbar}>
                  <MarketChoice labelKey="installedFilter" value={installedFilter} onChange={setInstalledFilter} t={t}
                    options={[{ id: 'all', labelKey: 'filterAll' }, { id: 'updates', labelKey: 'filterUpdates' }, { id: 'failed', labelKey: 'filterFailed' }]} />
                  <Button size="sm" variant="primary" disabled={isBusy || checkingUpdates || updateCount === 0 || updateCount > 100}
                    loading={busy?.kind === 'batch'} feedback={busy?.kind === 'batch' ? t('updating') : undefined}
                    onClick={() => { setConfirmation({ kind: 'batch', ids: Object.values(updates).filter(row => row.updateAvailable).map(row => row.id) }) }}>{t('updateAll')}</Button>
                </div>
                <p className={css.updateSummary} role="status">
                  {checkingUpdates
                    ? t('checkingUpdates')
                    : updateCheckFailed
                      ? t('updateCheckFailed')
                      : updatesChecked && updateCount > 0
                        ? t('updatesAvailable', { count: String(updateCount) })
                        : updatesChecked
                          ? t('updatesCurrent')
                          : t('checkingUpdates')}
                </p>
                {installed.length === 0 ? (
                  <p className={css.empty}>{t('installedEmpty')}</p>
                ) : (
                  groups.map(group => (
                    <section key={group.key} className={css.installedGroup} aria-label={group.label}>
                      <h3 className={css.groupTitle}>{group.label}</h3>
                      <ul className={css.installedRows}>
                        {group.rows.map(({ plugin, item }) => {
                          const opId = item ? item.id : plugin.name
                          const updateStatus = item ? updates[item.id] : undefined
                          return (
                            <li className={css.installedRow} key={plugin.name}>
                              <div className={css.installedIdentity}>
                                <Tooltip label={t('updateCheckFailed')} disabled={updateStatus?.checkFailed !== true} portal>
                                <span className={css.installedName} tabIndex={updateStatus?.checkFailed ? 0 : undefined}
                                  aria-label={updateStatus?.checkFailed ? `${plugin.name}: ${t('updateCheckFailed')}` : undefined}>
                                  {plugin.name}
                                  {plugin.dropped ? <span className={css.deprecatedTag}>{t('dropped')}</span> : null}
                                </span>
                                </Tooltip>
                                <code className={css.installedSpec}>{plugin.spec}</code>
                                {updateStatus?.current ? (
                                  <span
                                    className={css.updateMeta}
                                    title={updateStatus.updateAvailable && updateStatus.latest
                                      ? t('updateFromTo', {
                                          current: updateStatus.current,
                                          latest: updateStatus.latest,
                                        })
                                      : t('currentVersion', {
                                          current: updateStatus.current,
                                        })}
                                  >
                                    {updateStatus.updateAvailable && updateStatus.latest
                                      ? t('updateFromTo', {
                                          current: updateValue(updateStatus, updateStatus.current),
                                          latest: updateValue(updateStatus, updateStatus.latest),
                                        })
                                      : t('currentVersion', {
                                          current: updateValue(updateStatus, updateStatus.current),
                                        })}
                                  </span>
                                ) : null}
                              </div>
                              <div className={css.installedActions}>
                                {item && updateStatus?.updateAvailable ? (
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    disabled={isBusy}
                                    loading={busy?.kind === 'update' && busy.id === opId}
                                    feedback={busy?.kind === 'update' && busy.id === opId ? t('updating') : undefined}
                                    onClick={() => { startUpdate(item) }}
                                  >
                                    {t('update')}
                                  </Button>
                                ) : null}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isBusy}
                                  loading={busy?.kind === 'uninstall' && busy.id === opId}
                                  feedback={busy?.kind === 'uninstall' && busy.id === opId ? t('uninstalling') : undefined}
                                  onClick={() => { setConfirmation({ kind: 'uninstall', id: opId, name: plugin.name }) }}
                                >
                                  {t('uninstall')}
                                </Button>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))
                )}
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
