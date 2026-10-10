// @vitest-environment jsdom
/** Durable native and PTC results use the same session-authorized page view. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { PublishedPage, VisualReplyLoadError } from '../src/client/PublishedPage.tsx'
import { visualReplyModel, type VisualReplyModel } from '../src/client/model.ts'
import { en, zh } from '../src/client/locale.ts'
import { emulateMoveBeforeInJsdom } from './fixtures/move-before.ts'

emulateMoveBeforeInJsdom()
afterEach(cleanup)

type PageProps = Parameters<typeof PublishedPage>[0]
const HTML = '<!doctype html><html><body><h1>Ready</h1></body></html>'
const FILE = { attachmentId: AttachmentId('sha256:visual-reply'), name: 'reply.html', bytes: HTML.length }
const translate: PageProps['t'] = makeTranslate(en)

function model(nested = false): VisualReplyModel {
  const title = nested ? 'PTC board' : 'Native board'
  const page = visualReplyModel({
    kind: 'tool-result',
    call: nested ? { name: 'html_render', argsRaw: JSON.stringify({ title, height: 300, file_path: 'reply.html' }) } : null,
    content: [{ type: 'text', text: 'Published page' }, { type: 'file', attachment: FILE }],
    isError: false,
    ...(nested ? {} : { meta: { visualReply: { version: 1, title, height: 300 } } }),
  })
  if (page === null) throw new Error('The authoritative publication should produce a page')
  return page
}

function pageProps(page: VisualReplyModel, loadPage: PageProps['loadPage']): PageProps {
  return {
    model: page, interactive: true, loadPage,
    useTheme: bindSnapshotSelector(createSnapshotStore({ active: { colorScheme: 'light' } } as ThemeSnapshot)),
    t: translate,
  }
}

describe('PublishedPage', () => {
  it('keeps HTML inert in a browser while allowing its source to be opened', async () => {
    const loadPage = vi.fn<PageProps['loadPage']>().mockResolvedValue(HTML)
    const view = render(<PublishedPage {...pageProps(model(), loadPage)} interactive={false} />)
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(await screen.findByText(en['card.desktopOnly'])).toBeTruthy()
    expect(screen.getByRole('button', { name: en['card.expand'] })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en['card.save'] })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: en['card.source'] }))
    const dialog = screen.getByRole('dialog', { name: en['card.sourceTitle'] })
    expect(within(dialog).getByText(HTML)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: en['card.preview'] })).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('retains one iframe across inline, expanded, source, preview, and close for nested=%s', async (nested) => {
    const title = nested ? 'PTC board' : 'Native board'
    const loadPage = vi.fn<PageProps['loadPage']>().mockResolvedValue(HTML)
    const view = render(<PublishedPage {...pageProps(model(nested), loadPage)} />)

    const frame = await screen.findByTitle(`Visual reply: ${title}`)
    expect(frame.getAttribute('srcdoc')).toBe(HTML)
    expect(loadPage).toHaveBeenCalledWith(FILE.attachmentId, expect.any(AbortSignal))
    expect(screen.getByText(title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['card.expand'] }))

    const dialog = screen.getByRole('dialog', { name: title })
    expect(within(dialog).getByTitle(`Visual reply: ${title}`)).toBe(frame)
    expect(view.container.contains(frame)).toBe(false)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('button', { name: en['card.source'] }))
    const source = screen.getByRole('dialog', { name: en['card.sourceTitle'] })
    expect(within(source).getByText(HTML)).toBeTruthy()
    expect(within(source).getByTitle(`Visual reply: ${title}`)).toBe(frame)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    fireEvent.click(within(source).getByRole('button', { name: en['card.preview'] }))
    const preview = screen.getByRole('dialog', { name: title })
    expect(within(preview).getByTitle(`Visual reply: ${title}`)).toBe(frame)
    fireEvent.click(within(preview).getByRole('button', { name: en['card.close'] }))
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(frame.getAttribute('srcdoc')).toBe(HTML)
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  it.each(['service', 'unknown'] as const)('keeps a %s load failure visible until the user explicitly reloads it', async (kind) => {
    const error = kind === 'service'
      ? new VisualReplyLoadError(new RemoteError('gateway/internal', 'Attachment service unavailable', {}))
      : new Error('Connection interrupted')
    const loadPage = vi.fn<PageProps['loadPage']>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(HTML)
    render(<PublishedPage {...pageProps(model(), loadPage)} />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en['card.loadFailed']))
    expect(loadPage).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: en['card.expand'] })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: en['card.reload'] }))
    expect((await screen.findByTitle('Visual reply: Native board')).getAttribute('srcdoc')).toBe(HTML)
    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['ATTACHMENT_NOT_REFERENCED', 'card.loadNotReferenced'],
    ['VISUAL_REPLY_TOO_LARGE', 'card.loadTooLarge'],
    ['VISUAL_REPLY_INVALID_UTF8', 'card.loadInvalidUtf8'],
    ['ATTACHMENT_NOT_FOUND', 'card.loadMissing'],
    ['ATTACHMENT_CORRUPT', 'card.loadCorrupt'],
    ['INVALID_ATTACHMENT_REF', 'card.loadInvalidRef'],
  ] as const)('explains permanent %s without offering another load', async (reason, key) => {
    const error = new VisualReplyLoadError(new RemoteError('session/attachment-invalid', 'Host diagnostic', { reason }))
    const loadPage = vi.fn<PageProps['loadPage']>().mockRejectedValue(error)
    render(<PublishedPage {...pageProps(model(), loadPage)} />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en[key])
    expect(screen.queryByRole('button', { name: en['card.reload'] })).toBeNull()
    expect(screen.getByRole('button', { name: en['card.expand'] })).toHaveProperty('disabled', true)
    expect(document.querySelector('iframe')).toBeNull()
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  it('localizes a deleted conversation failure without suggesting reload', async () => {
    const loadPage = vi.fn<PageProps['loadPage']>()
    const props = pageProps(model(), loadPage)
    const error = new VisualReplyLoadError(new RemoteError('session/not-found', 'Conversation missing', { sessionId: 'visual-session' as SessionId }))
    loadPage.mockRejectedValue(error)
    render(<PublishedPage {...props} t={makeTranslate(zh)} />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', zh['card.loadSessionMissing'])
    expect(screen.queryByRole('button', { name: zh['card.reload'] })).toBeNull()
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  it('ignores a late page response from the previous session loader', async () => {
    const oldPage = Promise.withResolvers<string>()
    let oldSignal: AbortSignal | undefined
    const oldLoader = vi.fn<PageProps['loadPage']>((_attachment, signal) => {
      oldSignal = signal
      return oldPage.promise
    })
    const currentHTML = '<html><body>Current session page</body></html>'
    const currentLoader = vi.fn<PageProps['loadPage']>().mockResolvedValue(currentHTML)
    const view = render(<PublishedPage {...pageProps(model(), oldLoader)} />)
    view.rerender(<PublishedPage {...pageProps(model(), currentLoader)} />)
    expect((await screen.findByTitle('Visual reply: Native board')).getAttribute('srcdoc')).toBe(currentHTML)

    await act(async () => { oldPage.resolve('<html><body>Previous session page</body></html>') })
    expect(oldSignal?.aborted).toBe(true)
    expect(screen.getByTitle('Visual reply: Native board').getAttribute('srcdoc')).toBe(currentHTML)
  })
})
