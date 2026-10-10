/** One published page is rendered by its independent conversation node. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { VisualReplyModel } from './model.ts'
import { VisualReplyFrame } from './VisualReplyFrame.tsx'
import type { VisualRepliesKey } from './locale.ts'
import css from './VisualReply.module.css'

export interface VisualReplyInjected {
  /** Only the desktop carrier with page isolation may execute interactive HTML. */
  readonly interactive: boolean
  readonly loadPage: (attachmentId: FileAttachmentRef['attachmentId'], signal: AbortSignal) => Promise<string>
  readonly hooks: { readonly theme: HostObservable<ThemeSnapshot> }
}

type PageProps = PropsLocale<'visual-replies'> & InjectFace<VisualReplyInjected> & { readonly model: VisualReplyModel }
type PageState = { readonly status: 'loading' } | { readonly status: 'failed'; readonly error: unknown } | { readonly status: 'ready'; readonly html: string }

/** Preserve the Host's typed failure while retaining the page-loader's string result. */
export class VisualReplyLoadError extends Error {
  constructor(readonly failure: RemoteFailure) {
    super(failure.message)
    this.name = 'VisualReplyLoadError'
  }
}

/** Permanent attachment failures need an explanation, rather than another read. */
function pageFailure(error: unknown): { readonly key: VisualRepliesKey; readonly reload: boolean } {
  if (error instanceof VisualReplyLoadError) {
    const { failure } = error
    if (failure.code === 'session/not-found') return { key: 'card.loadSessionMissing', reload: false }
    if (failure.code === 'session/attachment-invalid') {
      switch (failure.details.reason) {
        case 'ATTACHMENT_NOT_REFERENCED': return { key: 'card.loadNotReferenced', reload: false }
        case 'VISUAL_REPLY_TOO_LARGE': return { key: 'card.loadTooLarge', reload: false }
        case 'VISUAL_REPLY_INVALID_UTF8': return { key: 'card.loadInvalidUtf8', reload: false }
        case 'ATTACHMENT_NOT_FOUND': return { key: 'card.loadMissing', reload: false }
        case 'ATTACHMENT_CORRUPT': return { key: 'card.loadCorrupt', reload: false }
        case 'INVALID_ATTACHMENT_REF': return { key: 'card.loadInvalidRef', reload: false }
      }
    }
  }
  return { key: 'card.loadFailed', reload: true }
}

export function PublishedPage({ model, interactive, loadPage, useTheme, t }: PageProps) {
  const [page, setPage] = useState<PageState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [source, setSource] = useState(false)
  const inlineHost = useRef<HTMLDivElement>(null)
  const [expandedHost, setExpandedHost] = useState<HTMLDivElement | null>(null)
  // React owns the portal's children, while connected DOM moves own its position.
  const [frameContainer] = useState(() => interactive ? document.createElement('div') : null)
  const theme = useTheme(value => value)
  useEffect(() => {
    const controller = new AbortController()
    setPage({ status: 'loading' })
    loadPage(model.file.attachmentId, controller.signal).then(html => {
      if (!controller.signal.aborted) setPage({ status: 'ready', html })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setPage({ status: 'failed', error })
    })
    return () => controller.abort()
  }, [loadPage, model.file.attachmentId, revision])
  useLayoutEffect(() => {
    if (!interactive || page.status !== 'ready' || frameContainer === null) return
    const target = expanded ? expandedHost : inlineHost.current
    if (target === null || frameContainer.parentElement === target) return
    // Both hosts are in this document. Atomic moves retain the iframe's loaded page.
    if (frameContainer.isConnected) target.moveBefore(frameContainer, null)
    else target.appendChild(frameContainer)
    if (!expanded) target.style.removeProperty('--visual-reply-placeholder-height')
  }, [expanded, expandedHost, frameContainer, interactive, page.status])
  const openPage = (showSource: boolean): void => {
    const host = inlineHost.current
    if (host !== null) host.style.setProperty('--visual-reply-placeholder-height', `${host.getBoundingClientRect().height}px`)
    setSource(showSource)
    setExpanded(true)
  }
  const save = (): void => {
    if (page.status !== 'ready') return
    const url = URL.createObjectURL(new Blob([page.html], { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `visual-reply-${Date.now()}.html`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const frameTitle = t('card.frameTitle', { title: model.title })
  const showSource = source || !interactive
  const failure = page.status === 'failed' ? pageFailure(page.error) : null
  return <section className={css.card} aria-label={t('card.title')}>
    <header className={css.header}>
      <span className={css.title} title={model.title}>{model.title}</span>
      <div className={css.actions}>
        <Button size="sm" onClick={() => openPage(false)} disabled={!interactive || page.status !== 'ready'}>{t('card.expand')}</Button>
        <Button size="sm" onClick={() => openPage(true)} disabled={page.status !== 'ready'}>{t('card.source')}</Button>
        <Button size="sm" onClick={save} disabled={page.status !== 'ready'}>{t('card.save')}</Button>
      </div>
    </header>
    {page.status === 'ready' ? (interactive
      ? <div ref={inlineHost} className={css.inlineHost} />
      : <div className={css.status}>{t('card.desktopOnly')}</div>)
      : <div className={css.status} role={page.status === 'failed' ? 'alert' : 'status'}>
        <span>{t(failure?.key ?? 'card.loading')}</span>
        {failure?.reload && <Button size="sm" onClick={() => setRevision(value => value + 1)}>{t('card.reload')}</Button>}
      </div>}
    {page.status === 'ready' && interactive && frameContainer !== null && createPortal(
      <VisualReplyFrame html={page.html} title={frameTitle} initialHeight={model.height} theme={theme} expanded={expanded} />,
      frameContainer,
    )}
    <Modal open={expanded} onClose={() => setExpanded(false)} title={showSource ? t('card.sourceTitle') : model.title}
      closeLabel={t('card.close')} className={css.dialog} contentClassName={css.dialogContent}
      headerActions={<div className={css.actions}>
        {interactive && <Button size="sm" onClick={() => setSource(value => !value)}>{t(source ? 'card.preview' : 'card.source')}</Button>}
        <Button size="sm" onClick={save}>{t('card.save')}</Button>
      </div>}>
      {page.status === 'ready' && <>
        {interactive && <div ref={setExpandedHost} hidden={showSource} />}
        {showSource && <pre className={css.source}>{page.html}</pre>}
      </>}
    </Modal>
  </section>
}
