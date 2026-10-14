/** Desktop-market discovery controls, catalog details, and operation history. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Menu, Modal, MarkdownText, Toast, IconRefreshOutline16, IconChevronDownOutline14, IconChevronLeftOutline14, IconChevronRightOutline14, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketSectionProps } from './MarketSection.tsx'
import type { MarketItem, MarketOperation, MarketplaceDetails } from './desktop-shell.ts'
import type { MarketLocaleKey } from './locales.ts'
import css from './MarketSection.module.css'

type T = MarketSectionProps['t']

/**
 * Keep catalog media and navigation restricted to credential-free HTTPS URLs.
 * @param value - untrusted catalog URL.
 * @returns the normalized HTTPS URL, or null when rejected.
 */
export function marketHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

/**
 * Render a choice using the baseline menu.
 * @param props - localized option keys, selected id and change callback.
 * @returns the trigger and anchored menu.
 */
export function MarketChoice({ labelKey, value, options, onChange, t }: {
  labelKey: MarketLocaleKey; value: string; options: { id: string; labelKey: MarketLocaleKey }[]
  onChange: (value: string) => void; t: T
}): ReactNode {
  const [open, setOpen] = useState(false)
  return <Menu open={open} onClose={() => { setOpen(false) }} selectedId={value}
    anchor={<Button size="sm" variant="outline" aria-label={t(labelKey)} aria-haspopup="menu" aria-expanded={open}
      icon={<IconChevronDownOutline14 />} onClick={() => { setOpen(!open) }}>
      {t(options.find(option => option.id === value)!.labelKey)}
    </Button>}
    items={options.map(option => ({ id: option.id, label: t(option.labelKey) }))}
    onSelect={id => { onChange(id); setOpen(false) }} />
}

/**
 * Render read-only details of a curated row without interpreting raw HTML.
 * @param props - catalog row, documentation loader, locale and close callback.
 * @returns the baseline details modal.
 */
export function MarketDetails({ item, t, onClose, getDetails }: {
  item: MarketItem; t: T; onClose: () => void; getDetails: MarketSectionProps['getDetails']
}): ReactNode {
  const [index, setIndex] = useState(0)
  const [failed, setFailed] = useState<string[]>([])
  const [facts, setFacts] = useState<MarketplaceDetails | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [feedbackDismissed, setFeedbackDismissed] = useState(false)
  useEffect(() => { if (!loading && loadFailed) setFeedbackDismissed(false) }, [loading, loadFailed])
  useEffect(() => {
    let live = true
    setLoadFailed(false)
    setLoading(true)
    setFeedbackDismissed(false)
    void getDetails(item.id, attempt > 0 ? { force: true } : undefined).then(value => {
      if (live) { setFacts(value); setLoadFailed(value.ok !== true || value.partial) }
    }).catch(() => { if (live) setLoadFailed(true) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [item.id, getDetails, attempt])
  const images = (item.screenshots ?? []).filter((url): url is string => typeof url === 'string')
    .map(marketHttpsUrl).filter((url): url is string => url !== null).slice(0, 12)
  const image = images[index]
  const homepage = marketHttpsUrl(item.homepage)
  return <Modal open title={item.repo} closeLabel={t('close')} onClose={onClose} className={css.detailsModal} contentClassName={css.dialogContent}
    headerActions={<Button size="sm" variant="ghost" className={css.iconAction} icon={<IconRefreshOutline16 />}
      loading={loading} aria-label={t('refresh')} title={t('refresh')} onClick={() => { setAttempt(value => value + 1) }} />}>
    <p className={css.detailsCopy}>{item.description}</p>
    <dl className={css.metadata}>
      <dt>{t('author')}</dt><dd>{item.owner}</dd>
      <dt>{t('source')}</dt><dd><code>{item.installSpec || t('unavailable')}</code></dd>
      <dt>{t('added')}</dt><dd>{item.added || t('unknown')}</dd>
      <dt>{t('compatibility')}</dt><dd>{t('compatibilityUnknown')}</dd>
      {facts?.version ? <><dt>{t('publishedVersion')}</dt><dd>{facts.version}</dd></> : null}
      {facts?.requirements.length ? <><dt>{t('declaredRequirements')}</dt><dd>{facts.requirements.map(value => <div key={value}><code>{value}</code></div>)}</dd></> : null}
    </dl>
    {image ? <div className={css.screenshots}>
      {failed.includes(image) ? <p className={css.screenshot}>{t('imageFailed')}</p>
        : <img className={css.screenshot} src={image} alt={t('screenshot', { number: String(index + 1) })}
          referrerPolicy="no-referrer" onError={() => { setFailed(current => [...current, image]) }} />}
      <div className={css.imageActions}>
        <Button size="sm" variant="ghost" icon={<IconChevronLeftOutline14 />} aria-label={t('previousImage')}
          disabled={index === 0} onClick={() => { setIndex(current => current - 1) }} />
        <span>{t('imageCount', { current: String(index + 1), total: String(images.length) })}</span>
        <Button size="sm" variant="ghost" icon={<IconChevronRightOutline14 />} aria-label={t('nextImage')}
          disabled={index === images.length - 1} onClick={() => { setIndex(current => current + 1) }} />
        <a href={image} target="_blank" rel="noreferrer">{t('openImage')}</a>
      </div>
    </div> : <p className={css.updateSummary}>{t('noScreenshots')}</p>}
    {homepage ? <a href={homepage} target="_blank" rel="noreferrer">{t('readmeHomepage')}</a> : null}
    {!feedbackDismissed && (loading || loadFailed) ? <Toast key={attempt} text={t(loading ? 'detailsLoading' : 'detailsFailed')}
      holdMs={null} dismissLabel={t('close')}
      {...loadFailed && !loading ? { actions: [{ label: t('retry'), onClick: () => { setAttempt(value => value + 1) } }] } : {}}
      onDone={() => { setFeedbackDismissed(true) }} /> : null}
    {facts?.readme ? <section className={css.readme} aria-label={t('repositoryReadme')}>
      <h3>{t('repositoryReadme')}</h3>
      <MarkdownText text={facts.readme} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} />
    </section> : null}
  </Modal>
}

/**
 * Export only the already-redacted history returned by the desktop main process.
 * @param operations - bounded desktop operation records.
 * @returns nothing; triggers a text download and releases its object URL.
 */
export function downloadMarketHistory(operations: MarketOperation[]): void {
  const text = operations.map(row => `${new Date(row.startedAt).toISOString()} ${row.kind} ${row.target}\n${row.status}\n${row.error || ''}\n${row.log}`).join('\n\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'dshd-marketplace.log'
  anchor.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}

/**
 * Render operation records retained across Harness restarts.
 * @param props - desktop records and localized labels.
 * @returns the export action and compact expandable log list.
 */
export function MarketHistory({ operations, t }: { operations: MarketOperation[]; t: T }): ReactNode {
  const statusKeys = { running: 'operationRunning', succeeded: 'operationSucceeded', failed: 'operationFailed', interrupted: 'operationInterrupted' } as const
  const kindKeys = { install: 'install', update: 'update', uninstall: 'uninstall', batch: 'updateAll' } as const
  return <>
    <div className={css.toolbar}><Button size="sm" variant="outline" icon={<IconDownloadOutline16 />}
      disabled={operations.length === 0} onClick={() => { downloadMarketHistory(operations) }}>{t('exportLog')}</Button></div>
    {operations.length === 0 ? <p className={css.empty}>{t('historyEmpty')}</p> : operations.map(row => (
      <details key={row.id} className={css.historyRow}>
        <summary><span>{t(kindKeys[row.kind])}: {row.target}</span><span>{t(statusKeys[row.status])}</span></summary>
        <time dateTime={new Date(row.startedAt).toISOString()}>{new Date(row.startedAt).toLocaleString()}</time>
        {row.error ? <p role="alert">{row.error}</p> : null}
        <pre>{row.log || t('noLog')}</pre>
      </details>
    ))}
  </>
}
