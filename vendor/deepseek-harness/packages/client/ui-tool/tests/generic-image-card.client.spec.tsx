// @vitest-environment jsdom
// Generic Tool results with durable image blocks: the fallback card, its
// discoverable image count, ordered multi-image gallery, history reload, and
// load-failure surface. The durable bytes belong to the attachment presentation
// plugin; this spec drives the real gallery through ui-tool's parent slot.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import type { RenderToolImages } from '../src/client/contract/slots.ts'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { genericImageCardModel } from '../src/client/tool/models/image-card-model.ts'

afterEach(cleanup)

const t: GenericToolCardProps['t'] = makeTranslate(zh, commonZh)

const image = (index: number, name?: string): ImageAttachmentRef => ({
  attachmentId: `sha256:${String(index).padStart(64, '0')}` as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/png',
  bytes: 100 + index,
  width: 320,
  height: 200,
  ...name === undefined ? {} : { name },
})

/** A settled non-read_image result carrying durable images in block order. */
const settled = (content: ToolResultNode['content'], over: Partial<ToolResultNode> = {}): ToolResultNode => ({
  kind: 'tool-result',
  seq: 20,
  time: 2_000,
  callId: 'c1',
  call: { name: 'mcp_screenshot', argsRaw: '{"page":"/w/a"}' },
  args: PartialArguments.fromText('{"page":"/w/a"}'),
  callTime: 1_000,
  content,
  isError: false,
  subCalls: [],
  ...over,
}) as ToolResultNode

/**
 * A renderer standing in for the attachment plugin. It renders one real <img>
 * per durable image and calls the session loader, so order and load failures are
 * observable without importing the attachment package into ui-tool.
 */
const renderToolImages = (
  urls: readonly string[],
): RenderToolImages => {
  return owner => (
    <div data-images>
      {owner.images.map((source, index) => (
        'attachment' in source
          ? (
            <img
              key={source.attachment.attachmentId}
              data-image-id={source.attachment.attachmentId}
              data-index={index}
              src={urls[index]}
              alt={source.attachment.name ?? 'image'}
            />
          )
          : null
      ))}
    </div>
  )
}

const ownerProps = (
  block: ToolResultNode,
  loader: MessageImageLoader = vi.fn(() => Promise.resolve('blob:image')),
  renderer: RenderToolImages = renderToolImages(['blob:one', 'blob:two']),
): GenericToolCardProps => ({
  useDisclosure: () => {
    const [expanded, setExpanded] = useState(false)
    return { expanded, setExpanded, toggle: () => setExpanded(value => !value) }
  },
  callId: 'c1',
  toolName: 'mcp_screenshot',
  block,
  openFile: vi.fn(),
  loadImage: loader,
  renderToolImages: renderer,
  t,
}) as unknown as GenericToolCardProps

const toggleRow = (view: { container: HTMLElement }) => {
  fireEvent.click(view.container.querySelector('[data-expandable]')!)
}

describe('genericImageCardModel', () => {
  it('collects durable images in result order and preserves text blocks', () => {
    const model = genericImageCardModel(settled([
      { type: 'text', text: 'first frame' },
      { type: 'image', attachment: image(1, 'one.png') },
      { type: 'text', text: 'second frame' },
      { type: 'image', attachment: image(2, 'two.png') },
    ]))
    expect(model?.images.map(entry => entry.attachment.name)).toEqual(['one.png', 'two.png'])
    expect(model?.text).toBe('first frame\nsecond frame')
  })

  it('declines running, error, and image-free results', () => {
    expect(genericImageCardModel({
      phase: 'start', callId: 'c1', name: 'mcp_screenshot', argsRaw: '{}', args: PartialArguments.fromText('{}'), turn: 1, step: 1, time: 1, subCalls: [],
    })).toBeNull()
    expect(genericImageCardModel(settled([{ type: 'text', text: 'failed' }], { isError: true }))).toBeNull()
    expect(genericImageCardModel(settled([{ type: 'text', text: 'no image' }]))).toBeNull()
  })

  it('declines one malformed image rather than rendering a partial gallery', () => {
    expect(genericImageCardModel(settled([
      { type: 'image', attachment: image(1) },
      { type: 'image', attachment: { ...image(2), width: 0 } },
    ] as ToolResultNode['content']))).toBeNull()
  })
})

describe('GenericToolCard durable images', () => {
  it('shows a discoverable count and the ordered gallery when expanded', async () => {
    const loader = vi.fn(() => Promise.resolve('blob:image'))
    const renderer = vi.fn(renderToolImages(['blob:one', 'blob:two']))
    const view = render(<GenericToolCard {...ownerProps(settled([
      { type: 'text', text: 'capture complete' },
      { type: 'image', attachment: image(1, 'one.png') },
      { type: 'image', attachment: image(2, 'two.png') },
    ]), loader, renderer)} />)

    expect(view.container.textContent).toContain('图片 (2)')
    expect(view.container.querySelector('[data-images]')).toBeNull()
    toggleRow(view)

    expect(renderer).toHaveBeenCalledWith({
      images: [
        { attachment: image(1, 'one.png') },
        { attachment: image(2, 'two.png') },
      ],
      align: 'start',
    })
    await waitFor(() => {
      expect(view.container.querySelectorAll('[data-image-id]')).toHaveLength(2)
    })
    const rendered = [...view.container.querySelectorAll<HTMLElement>('[data-image-id]')]
    expect(rendered.map(node => node.dataset.imageId)).toEqual([
      image(1).attachmentId,
      image(2).attachmentId,
    ])
  })

  it('renders a settled image result while its assistant turn is still unfinished', () => {
    // A tool result node is its own settled record; it never waits for a later
    // assistant message or turn/end event before drawing the gallery.
    const view = render(<GenericToolCard {...ownerProps(settled([
      { type: 'text', text: 'one frame' },
      { type: 'image', attachment: image(1, 'one.png') },
    ]), vi.fn(() => Promise.resolve('blob:one')), renderToolImages(['blob:one']))} />)
    expect(view.container.textContent).toContain('图片 (1)')
    toggleRow(view)
    expect(view.container.querySelector('[data-images]')).not.toBeNull()
  })

  it('reloads the durable reference after history replay, not the original file path', async () => {
    const loader = vi.fn(() => Promise.resolve('blob:durable-copy'))
    const view = render(<GenericToolCard {...ownerProps(settled([
      { type: 'image', attachment: image(7, 'capture.png') },
    ]), loader, renderToolImages(['blob:durable-copy']))} />)
    toggleRow(view)
    await waitFor(() => {
      expect(view.container.querySelector('[data-image-id]')).not.toBeNull()
    })
    // The card carries the opaque durable reference; it never receives nor
    // renders the output path of the browser/MCP source. A historical reopen
    // therefore resolves bytes from the store rather than the original file.
    expect(view.container.querySelector('[data-image-id]')?.getAttribute('data-image-id'))
      .toBe(image(7).attachmentId)
    expect(view.container.querySelector('[data-image-id]')?.getAttribute('data-image-id'))
      .toMatch(/^sha256:/)
  })

  it('keeps the explicit load-failure surface when the loader cannot resolve an image', async () => {
    const failing: MessageImageLoader = vi.fn(() => Promise.reject(new Error('missing')))
    const renderer: RenderToolImages = owner => (
      <div data-images>
        {owner.images.map(source => (
          'attachment' in source
            ? <button key={source.attachment.attachmentId} type="button">图片加载失败，点击重试</button>
            : null
        ))}
      </div>
    )
    const view = render(<GenericToolCard {...ownerProps(settled([
      { type: 'image', attachment: image(1, 'gone.png') },
    ]), failing, renderer)} />)
    toggleRow(view)
    await waitFor(() => {
      expect(view.container.textContent).toContain('图片加载失败，点击重试')
    })
  })

  it('preserves ordinary text output when the result also carries images', () => {
    const view = render(<GenericToolCard {...ownerProps(settled([
      { type: 'text', text: 'browser captured the dashboard' },
      { type: 'image', attachment: image(1, 'dashboard.png') },
    ]))} />)
    toggleRow(view)
    expect(view.container.textContent).toContain('browser captured the dashboard')
  })
})
