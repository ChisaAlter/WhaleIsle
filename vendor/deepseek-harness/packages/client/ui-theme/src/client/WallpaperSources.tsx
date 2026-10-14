/**
 * Gallery-window wallpaper source list: add, edit, and delete named sources.
 */
import { useEffect, useState } from 'react'
import { Button, Input, Modal, SettingsSelect, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  sanitizeWallpaperSources,
  type WallpaperSource,
  type WallpaperSourceKind,
} from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import css from './AppearanceSection.module.css'

function kindLabel(kind: WallpaperSourceKind, t: (key: ThemeKey) => string): string {
  if (kind === 'bing') return t('wallpaper.sourceKindBing')
  if (kind === 'wallhaven') return t('wallpaper.sourceKindWallhaven')
  return t('wallpaper.sourceKindCatalog')
}

function defaultName(kind: WallpaperSourceKind): string {
  if (kind === 'bing') return '必应'
  if (kind === 'wallhaven') return 'Wallhaven'
  return ''
}

/**
 * Render the gallery source list and stacked add/edit dialog.
 * @param props - current sources, copy, and the write callback.
 * @returns the sources pane.
 */
export function WallpaperSources({
  wallpaperSources,
  t,
  setWallpaperSources,
}: {
  wallpaperSources: readonly WallpaperSource[]
  t: (key: ThemeKey) => string
  setWallpaperSources: (patch: { wallpaperSources: WallpaperSource[] }) => void
}) {
  const [editor, setEditor] = useState<
    { mode: 'add' | 'edit'; id?: string; kind: WallpaperSourceKind; name: string; url: string; error?: string }
    | undefined
  >(undefined)
  const [notice, setNotice] = useState<string>()
  useEffect(() => { setNotice(editor?.error) }, [editor?.error])

  const occupied = (kind: WallpaperSourceKind, exceptId?: string): boolean =>
    wallpaperSources.some(source => source.kind === kind && source.id !== exceptId)

  const persist = (next: WallpaperSource[]): boolean => {
    const sanitized = sanitizeWallpaperSources(next)
    if (JSON.stringify(sanitized) === JSON.stringify(wallpaperSources)) return false
    setWallpaperSources({ wallpaperSources: sanitized })
    return true
  }

  const save = (): void => {
    if (editor === undefined) return
    const name = editor.name.trim()
    if (name.length === 0) return
    if (editor.kind === 'catalog' && editor.url.trim().length === 0) {
      const error = t('wallpaper.catalogRejected')
      setEditor({ ...editor, error })
      setNotice(error)
      return
    }
    if (editor.mode === 'add' && (editor.kind === 'bing' || editor.kind === 'wallhaven')
      && occupied(editor.kind)) {
      const error = t('wallpaper.sourceExists')
      setEditor({ ...editor, error })
      setNotice(error)
      return
    }
    const draft: WallpaperSource = editor.kind === 'catalog'
      ? { id: editor.id ?? '', kind: 'catalog', name, url: editor.url }
      : { id: editor.kind, kind: editor.kind, name }
    const next = editor.mode === 'add'
      ? [...wallpaperSources, draft]
      : wallpaperSources.map(source => source.id === editor.id ? { ...source, ...draft, id: source.id } : source)
    if (!persist(next)) {
      const error = t(editor.kind === 'catalog' ? 'wallpaper.catalogRejected' : 'wallpaper.sourceExists')
      setEditor({ ...editor, error })
      setNotice(error)
      return
    }
    setEditor(undefined)
  }

  return (
    <>
      <div className={css.sourceToolbar}>
        <p className={css.hint}>{t('wallpaper.sourcesHint')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const kind: WallpaperSourceKind = occupied('bing')
              ? (occupied('wallhaven') ? 'catalog' : 'wallhaven')
              : 'bing'
            setEditor({ mode: 'add', kind, name: defaultName(kind), url: '' })
          }}
        >
          {t('wallpaper.addSource')}
        </Button>
      </div>
      {wallpaperSources.map(source => (
        <div className={css.sourceRow} key={source.id}>
          <span className={css.sourceName}>{source.name}</span>
          <span className={css.sourceKind}>{kindLabel(source.kind, t)}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditor({
                mode: 'edit',
                id: source.id,
                kind: source.kind,
                name: source.name,
                url: source.url ?? '',
              })
            }}
          >
            {t('library.edit')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              persist(wallpaperSources.filter(row => row.id !== source.id))
            }}
          >
            {t('library.delete')}
          </Button>
        </div>
      ))}
      <Modal
        open={editor !== undefined}
        onClose={() => { setEditor(undefined) }}
        title={t(editor?.mode === 'edit' ? 'wallpaper.editSource' : 'wallpaper.addSource')}
        closeLabel={t('wallpaper.close')}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => { setEditor(undefined) }}>
              {t('editor.cancel')}
            </Button>
            <Button type="button" variant="primary" onClick={save}>{t('editor.save')}</Button>
          </>
        )}
      >
        {editor !== undefined ? (
          <div className={css.sourceForm}>
            {notice !== undefined && <Toast key={notice} text={notice} holdMs={null} dismissLabel={t('wallpaper.close')} onDone={() => { setNotice(undefined) }} />}
            <label className={css.field}>
              {t('wallpaper.sourceKind')}
              <SettingsSelect
                variant="block"
                aria-label={editor.error !== undefined && editor.kind !== 'catalog' ? `${t('wallpaper.sourceKind')} — ${editor.error}` : t('wallpaper.sourceKind')}
                value={editor.kind}
                disabled={editor.mode === 'edit'}
                options={[
                  {
                    id: 'bing',
                    label: t('wallpaper.sourceKindBing'),
                    disabled: editor.mode === 'add' && occupied('bing'),
                  },
                  {
                    id: 'wallhaven',
                    label: t('wallpaper.sourceKindWallhaven'),
                    disabled: editor.mode === 'add' && occupied('wallhaven'),
                  },
                  { id: 'catalog', label: t('wallpaper.sourceKindCatalog') },
                ]}
                onChange={(id) => {
                  const kind = id as WallpaperSourceKind
                  const { error: _error, ...rest } = editor
                  setEditor({ ...rest, kind, name: defaultName(kind), url: '' })
                }}
              />
            </label>
            <label className={css.field}>
              {t('wallpaper.sourceName')}
              <Input
                value={editor.name}
                aria-label={t('wallpaper.sourceName')}
                onChange={(event) => {
                  const { error: _error, ...rest } = editor
                  setEditor({ ...rest, name: event.currentTarget.value })
                }}
              />
            </label>
            {editor.kind === 'catalog' ? (
              <label className={css.field}>
                {t('wallpaper.sourceUrl')}
                <Input
                  value={editor.url}
                  placeholder={t('wallpaper.catalogPlaceholder')}
                  aria-label={t('wallpaper.sourceUrl')}
                  aria-invalid={editor.error !== undefined}
                  onChange={(event) => {
                    const { error: _error, ...rest } = editor
                    setEditor({ ...rest, url: event.currentTarget.value })
                  }}
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
