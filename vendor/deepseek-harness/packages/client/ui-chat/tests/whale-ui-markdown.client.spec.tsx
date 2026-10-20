// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import type { AssistantOpenUi } from '../src/client/chat/openui.ts'
import { useDetailedPresentation } from './presentation-fixture.client.ts'
import { unusedImageLoader } from './reasoning-component-fixture.tsx'
import { useDisclosure } from '../src/client/chat/use-disclosure.ts'
import { useSearchableHidden } from '../src/client/chat/searchable-hidden.ts'
import { en } from '../src/client/locale.ts'

const previousShell = Object.getOwnPropertyDescriptor(window, 'shell')
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (previousShell === undefined) Reflect.deleteProperty(window, 'shell')
  else Object.defineProperty(window, 'shell', previousShell)
})

function props(openUi: AssistantOpenUi, text: string, streaming: boolean): AssistantMarkdownProps {
  return { blocks: [{ kind: 'text', text }], streaming, openUi, renderSlot: () => null,
    useDisclosure, useGroupAction: useSearchableHidden, usePresentation: useDetailedPresentation,
    loadImage: unusedImageLoader, t: makeTranslate(en) }
}

function ready(frame: HTMLIFrameElement, instanceId: string) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
      data: { channel: 'whale-ui', version: 2, instanceId, type: 'ready' } }))
  })
}

function owner(): AssistantOpenUi {
  return { identity: 'session-side:assistant-7', seq: 37, theme: null, locale: 'en', send: async () => ({ ok: true }),
    readState: () => ({}), saveState: () => {}, publishPanel: vi.fn() }
}

describe('Whale UI direct Markdown fence hook', () => {
  it('keeps source-offset identity after preceding math and across streaming settlement', async () => {
    const openuiViewer = vi.fn(async () => '<!doctype html><main id="whale-ui"></main>')
    Object.defineProperty(window, 'shell', { configurable: true, value: { openuiViewer } })
    const openUi = owner()
    const prefix = 'Before.\n\n```math\nx^2\n```\n\n'
    const original = `${prefix}\`\`\`whale-ui\nroot = Col([Text("stream")])\n\`\`\``
    const expectedId = `${openUi.identity}:0:${prefix.length}`
    const view = render(<AssistantMarkdown {...props(openUi, original, true)} />)
    await waitFor(() => { expect(view.container.querySelectorAll('iframe')).toHaveLength(1) })
    const frame = view.container.querySelector('iframe')!
    expect(frame.name).toBe(`whale-ui:${expectedId}`)
    const messages = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    ready(frame, expectedId)
    const completed = original.replace('stream', 'completed')
    view.rerender(<AssistantMarkdown {...props(openUi, completed, false)} />)
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(openuiViewer).toHaveBeenCalledOnce()
    expect(messages.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'render', language: 'whale-ui', streaming: false,
      program: 'root = Col([Text("completed")])' })
    expect(view.container.querySelector('.katex')).not.toBeNull()
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: {
        channel: 'whale-ui', version: 2, instanceId: expectedId, type: 'panel',
        operation: { sourceId: 'forged', order: [9000, 0, 0], append: false, spec: { items: [] } },
      } }))
    })
    expect(openUi.publishPanel).toHaveBeenCalledWith({ sourceId: expectedId, order: [37, 0, prefix.length], append: false, spec: { items: [] } })
  })

  it.each(['whale-ui', 'openui', 'openui-lang', 'dsh-ui'] as const)('sends %s through the same viewer and keeps ordinary fences as code', async language => {
    Object.defineProperty(window, 'shell', { configurable: true, value: {
      openuiViewer: async () => '<!doctype html><main></main>',
    } })
    const openUi = owner()
    const text = `\`\`\`typescript\nconst kept = 1\n\`\`\`\n\n\`\`\`${language}\nroot = Col([])\n\`\`\``
    const view = render(<AssistantMarkdown {...props(openUi, text, false)} />)
    await waitFor(() => { expect(view.container.querySelectorAll('iframe')).toHaveLength(1) })
    const frame = view.container.querySelector('iframe')!
    const messages = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    ready(frame, `${openUi.identity}:0:${text.indexOf(`\`\`\`${language}`)}`)
    expect(messages.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'render', language })
    expect(view.container.textContent).toContain('const kept = 1')
  })
})
