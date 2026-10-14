/**
 * Wallpaper gallery dialog: source tabs, search, favorites, confirm-then-pick.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Modal, Pill, StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WallpaperFavorite, WallpaperSource } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type { WallpaperCatalogItem, WallpaperShell } from './wallpaper-shell.ts'
import { WallpaperSources } from './WallpaperSources.tsx'
import css from './AppearanceSection.module.css'

const FAVORITES_TAB = '__favorites__'
const WALLHAVEN_DEBOUNCE_MS = 300

type WallhavenCategory = '100' | '010' | '001'

function bingYears(now = new Date()): number[] {
  const current = now.getFullYear()
  return Array.from({ length: 8 }, (_, index) => current - index)
}

function matchesSearch(item: { title: string; copyright?: string }, query: string): boolean {
  if (!query) return true
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return item.title.toLowerCase().includes(needle)
    || (item.copyright ?? '').toLowerCase().includes(needle)
}

function favoriteIds(favorites: readonly WallpaperFavorite[]): Set<string> {
  return new Set(favorites.map(favorite => favorite.id))
}

/**
 * Render the gallery picker with per-source fetch, search, and favorites.
 * @param props.open - whether the dialog is showing.
 * @param props.busyId - id currently downloading, if any.
 * @param props.wallpaperSources - persisted gallery sources.
 * @param props.wallpaperFavorites - starred gallery items.
 * @param props.listWallpaperCatalog - desktop catalog fetch.
 * @param props.setWallpaperSources - persist sources; omitted off desktop.
 * @param props.setWallpaperFavorites - persist favorites; omitted off desktop.
 * @param props.t - Appearance copy.
 * @param props.onClose - dismiss.
 * @param props.onPick - download and crop after confirm.
 * @returns the modal tree.
 */
export function WallpaperGalleryModal({
  open,
  busyId,
  wallpaperSources,
  wallpaperFavorites,
  listWallpaperCatalog,
  setWallpaperSources,
  setWallpaperFavorites,
  t,
  onClose,
  onPick,
}: {
  open: boolean
  busyId: string | undefined
  wallpaperSources: readonly WallpaperSource[]
  wallpaperFavorites: readonly WallpaperFavorite[]
  listWallpaperCatalog: WallpaperShell['listWallpaperCatalog']
  setWallpaperSources?: (patch: { wallpaperSources: WallpaperSource[] }) => void
  setWallpaperFavorites?: (patch: { wallpaperFavorites: WallpaperFavorite[] }) => void
  t: (key: ThemeKey) => string
  onClose: () => void
  onPick: (item: WallpaperCatalogItem) => void
}) {
  const [pane, setPane] = useState<'gallery' | 'sources'>('gallery')
  const [activeTab, setActiveTab] = useState(() => wallpaperSources[0]?.id ?? FAVORITES_TAB)
  const [bingYear, setBingYear] = useState<number | 'today'>('today')
  const [wallhavenCategory, setWallhavenCategory] = useState<WallhavenCategory>('100')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [items, setItems] = useState<readonly WallpaperCatalogItem[]>([])
  const [warning, setWarning] = useState<string | undefined>(undefined)
  const [nextPage, setNextPage] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<WallpaperCatalogItem | undefined>(undefined)
  const listToken = useRef(0)

  const activeSource = wallpaperSources.find(source => source.id === activeTab)
  const starred = useMemo(() => favoriteIds(wallpaperFavorites), [wallpaperFavorites])

  useEffect(() => {
    if (!open) {
      setPane('gallery')
      setPending(undefined)
      setSearch('')
      setDebouncedSearch('')
      setBingYear('today')
      setWallhavenCategory('100')
      setItems([])
      setWarning(undefined)
      setNextPage(undefined)
      setLoading(false)
      setActiveTab(wallpaperSources[0]?.id ?? FAVORITES_TAB)
      return
    }
    setActiveTab(current => {
      if (current === FAVORITES_TAB) return current
      if (wallpaperSources.some(source => source.id === current)) return current
      return wallpaperSources[0]?.id ?? FAVORITES_TAB
    })
    const first = wallpaperSources[0]?.id
    if (first !== undefined) setLoading(true)
  }, [open, wallpaperSources])

  useEffect(() => {
    if (activeSource?.kind !== 'wallhaven') {
      setDebouncedSearch(search)
      return
    }
    const timer = window.setTimeout(() => { setDebouncedSearch(search) }, WALLHAVEN_DEBOUNCE_MS)
    return () => { window.clearTimeout(timer) }
  }, [search, activeSource?.kind])

  const wallhavenQ = activeSource?.kind === 'wallhaven' ? debouncedSearch.trim() : ''

  useEffect(() => {
    if (!open || pane !== 'gallery') return
    if (activeTab === FAVORITES_TAB || activeSource === undefined) {
      listToken.current += 1
      setItems([])
      setWarning(undefined)
      setNextPage(undefined)
      setLoading(false)
      return
    }

    const token = ++listToken.current
    setLoading(true)
    setWarning(undefined)
    setNextPage(undefined)
    setItems([])

    const query = activeSource.kind === 'bing'
      ? {
          kind: 'bing' as const,
          ...(bingYear === 'today' ? {} : { year: bingYear }),
        }
      : activeSource.kind === 'wallhaven'
        ? {
            kind: 'wallhaven' as const,
            categories: wallhavenCategory,
            page: 1,
            ...(wallhavenQ ? { q: wallhavenQ } : {}),
          }
        : {
            kind: 'catalog' as const,
            url: activeSource.url ?? '',
          }

    void listWallpaperCatalog(query).then((result) => {
      if (token !== listToken.current) return
      setItems(result.items ?? [])
      setWarning(result.warning)
      setNextPage(result.nextPage)
      setLoading(false)
    }, () => {
      if (token !== listToken.current) return
      setItems([])
      setWarning(t('wallpaper.galleryFailed'))
      setNextPage(undefined)
      setLoading(false)
    })
  }, [
    open,
    pane,
    activeTab,
    activeSource,
    bingYear,
    wallhavenCategory,
    wallhavenQ,
    listWallpaperCatalog,
    t,
  ])

  const loadMore = (): void => {
    if (activeSource?.kind !== 'wallhaven' || nextPage === undefined || loading) return
    const token = ++listToken.current
    setLoading(true)
    void listWallpaperCatalog({
      kind: 'wallhaven',
      categories: wallhavenCategory,
      page: nextPage,
      ...(wallhavenQ ? { q: wallhavenQ } : {}),
    }).then((result) => {
      if (token !== listToken.current) return
      setItems(current => [...current, ...(result.items ?? [])])
      setWarning(result.warning)
      setNextPage(result.nextPage)
      setLoading(false)
    }, () => {
      if (token !== listToken.current) return
      setWarning(t('wallpaper.galleryFailed'))
      setLoading(false)
    })
  }

  const visibleItems = useMemo((): readonly WallpaperCatalogItem[] => {
    if (activeTab === FAVORITES_TAB) {
      const rows: WallpaperCatalogItem[] = wallpaperFavorites.map(favorite => ({
        id: favorite.id,
        title: favorite.title,
        copyright: '',
        thumbUrl: favorite.thumbUrl,
        imageUrl: favorite.imageUrl,
        source: favorite.sourceId,
      }))
      return rows.filter(item => matchesSearch(item, search))
    }
    if (activeSource?.kind === 'wallhaven') return items
    return items.filter(item => matchesSearch(item, search))
  }, [activeTab, activeSource?.kind, wallpaperFavorites, items, search])

  const toggleFavorite = (item: WallpaperCatalogItem): void => {
    if (setWallpaperFavorites === undefined) return
    const sourceId = activeTab === FAVORITES_TAB ? item.source : (activeSource?.id ?? item.source)
    if (starred.has(item.id)) {
      setWallpaperFavorites({
        wallpaperFavorites: wallpaperFavorites.filter(favorite => favorite.id !== item.id),
      })
      return
    }
    setWallpaperFavorites({
      wallpaperFavorites: [
        ...wallpaperFavorites,
        {
          id: item.id,
          sourceId,
          title: item.title || item.id,
          thumbUrl: item.thumbUrl,
          imageUrl: item.imageUrl,
        },
      ],
    })
  }

  const years = useMemo(() => bingYears(), [])

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('wallpaper.browse')}
        closeLabel={t('wallpaper.close')}
        className={css.galleryDialog ?? ''}
        contentClassName={css.galleryContent ?? ''}
        headerActions={setWallpaperSources !== undefined ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { setPane(current => current === 'sources' ? 'gallery' : 'sources') }}
          >
            {pane === 'sources' ? t('wallpaper.backToGallery') : t('wallpaper.sources')}
          </Button>
        ) : null}
        footer={<Button type="button" onClick={onClose}>{t('editor.cancel')}</Button>}
      >
        {pane === 'sources' && setWallpaperSources !== undefined ? (
          <WallpaperSources
            wallpaperSources={wallpaperSources}
            t={t}
            setWallpaperSources={setWallpaperSources}
          />
        ) : (
          <>
            <div className={css.galleryToolbar}>
              <div className={css.galleryTabs} role="tablist" aria-label={t('wallpaper.sources')}>
                {wallpaperSources.map(source => (
                  <Pill
                    key={source.id}
                    active={activeTab === source.id}
                    onClick={() => { setActiveTab(source.id) }}
                  >
                    {source.name}
                  </Pill>
                ))}
                <Pill
                  active={activeTab === FAVORITES_TAB}
                  onClick={() => { setActiveTab(FAVORITES_TAB) }}
                >
                  {t('wallpaper.favorites')}
                </Pill>
              </div>
              <Input
                type="search"
                value={search}
                placeholder={t('wallpaper.search')}
                aria-label={t('wallpaper.search')}
                onChange={(event) => { setSearch(event.currentTarget.value) }}
              />
            </div>
            {activeSource?.kind === 'bing' ? (
              <div className={css.galleryChips} role="group" aria-label={t('wallpaper.sourceKindBing')}>
                <Pill active={bingYear === 'today'} onClick={() => { setBingYear('today') }}>
                  {t('wallpaper.today')}
                </Pill>
                {years.map(year => (
                  <Pill key={year} active={bingYear === year} onClick={() => { setBingYear(year) }}>
                    {String(year)}
                  </Pill>
                ))}
              </div>
            ) : null}
            {activeSource?.kind === 'wallhaven' ? (
              <div className={css.galleryChips} role="group" aria-label={t('wallpaper.sourceKindWallhaven')}>
                <Pill active={wallhavenCategory === '100'} onClick={() => { setWallhavenCategory('100') }}>
                  {t('wallpaper.wallhavenGeneral')}
                </Pill>
                <Pill active={wallhavenCategory === '010'} onClick={() => { setWallhavenCategory('010') }}>
                  {t('wallpaper.wallhavenAnime')}
                </Pill>
                <Pill active={wallhavenCategory === '001'} onClick={() => { setWallhavenCategory('001') }}>
                  {t('wallpaper.wallhavenPeople')}
                </Pill>
              </div>
            ) : null}
            {open && warning ? <Toast key={warning} text={warning} holdMs={null} dismissLabel={t('wallpaper.close')} onDone={() => { setWarning(undefined) }} /> : null}
            <div className={css.galleryBody}>
              {loading && visibleItems.length === 0 ? (
                <div className={css.galleryStatus} role="status" aria-busy="true" aria-label={t('wallpaper.loading')}>
                  <StateDot state="ongoing" size={28} />
                </div>
              ) : visibleItems.length === 0 ? (
                <div className={css.galleryStatus} role="status">
                  <span>{t('wallpaper.galleryEmpty')}</span>
                </div>
              ) : (
                <div className={css.galleryGrid}>
                  {visibleItems.map((item) => (
                    <div key={`${item.source}:${item.id}`} className={css.galleryCardWrap}>
                      <button
                        type="button"
                        className={css.galleryCard}
                        disabled={busyId !== undefined}
                        onClick={() => { setPending(item) }}
                      >
                        <img className={css.galleryThumb} src={item.thumbUrl} alt="" referrerPolicy="no-referrer" />
                        <span className={css.galleryMeta}>
                          <span className={css.galleryTitle}>{item.title || item.id}</span>
                          {item.copyright ? <span className={css.galleryCopyright}>{item.copyright}</span> : null}
                        </span>
                      </button>
                      {busyId === item.id && <span className={css.galleryDownload} role="status" aria-label={t('wallpaper.downloading')}><StateDot state="ongoing" size={28} /></span>}
                      {setWallpaperFavorites !== undefined ? (
                        <button
                          type="button"
                          className={css.galleryStar}
                          aria-label={t('wallpaper.favorite')}
                          aria-pressed={starred.has(item.id)}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleFavorite(item)
                          }}
                        >
                          {starred.has(item.id) ? '★' : '☆'}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {activeSource?.kind === 'wallhaven' && nextPage !== undefined ? (
                <Button type="button" variant="outline" loading={loading} disabled={busyId !== undefined} onClick={loadMore}>
                  {t('wallpaper.loadMore')}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={pending !== undefined}
        onClose={() => { setPending(undefined) }}
        title={t('wallpaper.confirmSet')}
        closeLabel={t('wallpaper.close')}
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={() => { setPending(undefined) }}>
              {t('wallpaper.confirmSetNo')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (pending === undefined) return
                const item = pending
                setPending(undefined)
                onPick(item)
              }}
            >
              {t('wallpaper.confirmSetYes')}
            </Button>
          </>
        )}
      >
        <p className={css.hint}>{pending?.title || pending?.id}</p>
      </Modal>
    </>
  )
}
