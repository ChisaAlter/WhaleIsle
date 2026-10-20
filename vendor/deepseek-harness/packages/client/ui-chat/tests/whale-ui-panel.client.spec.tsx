// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WhaleUiPanel } from '../src/client/chat/WhaleUiPanel.tsx'
import { WhaleUiToolView } from '../src/client/chat/WhaleUiPanelToolView.tsx'
import { createWhaleUiStore } from '../src/client/chat/whale-ui-store.ts'
import { readOpenUiState, saveOpenUiState } from '../src/client/chat/openui.ts'
import { en } from '../src/client/locale.ts'

const previousShell = Object.getOwnPropertyDescriptor(window, 'shell')
beforeEach(() => { localStorage.clear() })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (previousShell === undefined) Reflect.deleteProperty(window, 'shell')
  else Object.defineProperty(window, 'shell', previousShell)
})

function fixture() {
  const store = createWhaleUiStore().create('panel-session')
  const openuiViewer = vi.fn(async () => '<!doctype html><main></main>')
  Object.defineProperty(window, 'shell', { configurable: true, value: { openuiViewer } })
  const props = {
    sessionId: 'panel-session' as SessionId, useStore: bindSnapshotSelector(store), actions: store.actions,
    useOpenUiTheme: bindSnapshotSelector(createSnapshotStore<ThemeSnapshot | null>(null)),
    useOpenUiLocale: bindSnapshotSelector(createSnapshotStore<'zh' | 'en'>('en')),
    sendOpenUiAction: vi.fn(async () => ({ ok: true as const })),
    readOpenUiState, saveOpenUiState, t: makeTranslate(en),
  } as Parameters<typeof WhaleUiPanel>[0]
  return { store, props, openuiViewer }
}

describe('Whale UI persisted Tool results', () => {
  it('renders saved metadata with the original Session action and real result seq for panels', async () => {
    const h = fixture()
    const toolProps = { ...h.props, callId: 'render-call', seq: 30,
      metadata: { whaleUi: { version: 1, language: 'dsh-ui', program: '{"items":[]}' } },
    } as Parameters<typeof WhaleUiToolView>[0]
    const view = render(<WhaleUiToolView {...toolProps} />)
    await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
    const frame = view.container.querySelector('iframe')!
    const instanceId = 'panel-session:tool:render-call'
    const messages = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    expect(frame.name).toBe(`whale-ui:${instanceId}`)
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: {
        channel: 'whale-ui', version: 2, instanceId, type: 'ready',
      } }))
    })
    expect(messages.mock.calls.at(-1)?.[0]).toMatchObject({ language: 'dsh-ui', program: '{"items":[]}', streaming: false })
    h.store.actions.publish({ sourceId: 'earlier-fence', order: [12, 0, 0], append: false,
      spec: { items: [{ type: 'text', text: 'Earlier fence' }] } })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: {
        channel: 'whale-ui', version: 2, instanceId, type: 'panel',
        operation: { sourceId: 'forged', order: [1, 0, 0], append: false,
          spec: { items: [{ type: 'text', text: 'Later tool' }] } },
      } }))
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: {
        channel: 'whale-ui', version: 2, instanceId, type: 'action', action: 'assistant',
        requestId: 'tool-action', message: 'Go', formState: { amount: 7 },
      } }))
    })
    expect(h.store.getSnapshot().snapshot?.items).toEqual([{ type: 'text', text: 'Later tool' }])
    expect(h.store.getSnapshot().operations.at(-1)?.order).toEqual([30, 0, 0])
    await waitFor(() => { expect(h.props.sendOpenUiAction).toHaveBeenCalledWith({ message: 'Go', formState: { amount: 7 } }) })
    expect(messages).toHaveBeenCalledWith(expect.objectContaining({ type: 'action-response', requestId: 'tool-action', result: { ok: true } }), '*')
  })

  it('rejects unknown persisted metadata without inventing a preview', () => {
    const h = fixture()
    const view = render(<WhaleUiToolView {...h.props} callId="invalid" seq={30} metadata={{ whaleUi: { version: 3, program: 'ignored' } }} />)
    expect(screen.getByRole('alert').textContent).toBe(en['openui.invalidResult'])
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(h.openuiViewer).not.toHaveBeenCalled()
  })
})

describe('Whale UI composer panel', () => {
  it('uses the common dsh-ui frame, keeps it during collapse, and restores synchronous state after remount', async () => {
    const h = fixture()
    h.store.actions.publish({ sourceId: 'source-a', order: [17, 0, 2], append: false,
      spec: { title: 'Budget', items: [{ type: 'text', text: 'Panel body' }] } })
    const view = render(<WhaleUiPanel {...h.props} />)
    await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
    const frame = view.container.querySelector('iframe')!
    const messages = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    const instanceId = 'panel-session:panel:document'
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
        data: { channel: 'whale-ui', version: 2, instanceId, type: 'ready' } }))
    })
    expect(messages.mock.calls.at(-1)?.[0]).toMatchObject({ language: 'dsh-ui', panel: true,
      program: JSON.stringify(h.store.getSnapshot().snapshot) })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
        data: { channel: 'whale-ui', version: 2, instanceId, type: 'state', state: { answer: 'edited immediately' } } }))
    })
    fireEvent.click(screen.getByRole('button', { name: en['openui.collapse'] }))
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(h.store.getSnapshot().collapsed).toBe(true)
    expect(readOpenUiState(instanceId)).toEqual({ answer: 'edited immediately' })
    fireEvent.click(screen.getByRole('button', { name: en['openui.expand'] }))
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(h.openuiViewer).toHaveBeenCalledOnce()
    view.unmount()
    const reloaded = fixture()
    expect(reloaded.store.getSnapshot().snapshot?.title).toBe('Budget')
    const history = render(<WhaleUiPanel {...reloaded.props} />)
    await waitFor(() => { expect(history.container.querySelector('iframe')).not.toBeNull() })
    const restored = history.container.querySelector('iframe')!
    const outbound = vi.spyOn(restored.contentWindow!, 'postMessage').mockImplementation(() => {})
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: restored.contentWindow,
        data: { channel: 'whale-ui', version: 2, instanceId, type: 'ready' } }))
    })
    expect(outbound.mock.calls.at(-1)?.[0]).toMatchObject({ state: { answer: 'edited immediately' } })
    fireEvent.click(screen.getByRole('button', { name: en['openui.clear'] }))
    expect(history.container.querySelector('iframe')).toBeNull()
    expect(createWhaleUiStore().create('panel-session').getSnapshot().snapshot).toBeNull()
  })
})
