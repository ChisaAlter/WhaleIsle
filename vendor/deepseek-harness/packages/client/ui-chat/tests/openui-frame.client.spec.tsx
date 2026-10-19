// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { OpenUiFrame } from '../src/client/chat/OpenUiFrame.tsx'
import { readOpenUiState, saveOpenUiState } from '../src/client/chat/openui.ts'
import { en } from '../src/client/locale.ts'

const VIEWER = '<!doctype html><html><body><main id="openui"></main></body></html>'
const INSTANCE = 'original-session:assistant-1:0:24'
const previousShell = Object.getOwnPropertyDescriptor(window, 'shell')
const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
type FrameProps = Parameters<typeof OpenUiFrame>[0]

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (previousShell === undefined) Reflect.deleteProperty(window, 'shell')
  else Object.defineProperty(window, 'shell', previousShell)
  if (previousClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', previousClipboard)
})

function harness(instanceId = INSTANCE) {
  const shell = {
    openuiViewer: vi.fn(async () => VIEWER),
    openuiApi: vi.fn(async (_input: unknown) => ({ status: 200, body: { title: 'Lookup result' } })),
    openExternal: vi.fn(async (_url: string) => {}),
  }
  Object.defineProperty(window, 'shell', { configurable: true, value: shell })
  const send = vi.fn<FrameProps['openUi']['send']>().mockResolvedValue(undefined)
  const props: FrameProps = {
    instanceId, program: 'root = TextContent("Ready")', streaming: true,
    openUi: { identity: 'original-session:assistant-1', theme: null, send, readState: readOpenUiState, saveState: saveOpenUiState },
    t: makeTranslate(en),
  }
  return { shell, send, props }
}

function emit(frame: HTMLIFrameElement, payload: Record<string, unknown>, source: MessageEventSource | null = frame.contentWindow) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      source,
      data: { channel: 'whale-openui', version: 1, instanceId: INSTANCE, ...payload },
    }))
  })
}

async function connect(view: ReturnType<typeof render>) {
  await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
  const frame = view.container.querySelector('iframe')!
  const outbound = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  emit(frame, { type: 'ready' })
  return { frame, outbound }
}

describe('OpenUI parent bridge', () => {
  it('keeps one isolated viewer across streamed programs, settlement, theme and source changes', async () => {
    const h = harness()
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    expect(frame.name).toBe(`whale-openui:${INSTANCE}`)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.allowFullscreen).toBe(true)
    expect(frame.getAttribute('allow')).toBe('fullscreen; picture-in-picture; encrypted-media')
    expect(frame.getAttribute('srcdoc')).toBe(VIEWER)
    view.rerender(<OpenUiFrame {...h.props} program='root = TextContent("Completed")' streaming={false}
      openUi={{ ...h.props.openUi, theme: { active: { colorScheme: 'light' } } as never }} />)
    const sent = outbound.mock.calls.map(call => call[0] as Record<string, unknown>)
    expect(sent.at(-1)).toMatchObject({ type: 'render', streaming: false, program: 'root = TextContent("Completed")', theme: { appearance: 'light' } })
    fireEvent.click(screen.getByRole('button', { name: en['openui.source'] }))
    expect(frame.hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en['openui.preview'] }))
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(frame.hidden).toBe(false)
    expect(h.shell.openuiViewer).toHaveBeenCalledOnce()
  })

  it('names the card by the answer heading the viewer reports and falls back to the generic label', async () => {
    const h = harness()
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame } = await connect(view)
    const label = () => view.container.querySelector('header [role="status"]')!.textContent
    expect(label()).toBe(en['openui.title'])
    emit(frame, { type: 'title', title: '  ChisaBot repository overview ' })
    expect(label()).toBe('ChisaBot repository overview')
    expect(frame.title).toBe('ChisaBot repository overview')
    emit(frame, { type: 'title', title: 42 })
    expect(label()).toBe('ChisaBot repository overview')
    emit(frame, { type: 'title', title: '' })
    expect(label()).toBe(en['openui.title'])
  })

  it('requires the exact contentWindow, channel, version and instance for actions and state', async () => {
    const h = harness()
    const saveState = vi.fn(h.props.openUi.saveState)
    const view = render(<OpenUiFrame {...h.props} openUi={{ ...h.props.openUi, saveState }} />)
    const { frame } = await connect(view)
    emit(frame, { type: 'assistant', message: 'spoofed source' }, window)
    emit(frame, { type: 'assistant', message: 'wrong channel', channel: 'other' })
    emit(frame, { type: 'assistant', message: 'wrong version', version: 2 })
    emit(frame, { type: 'assistant', message: 'wrong instance', instanceId: 'another' })
    emit(frame, { type: 'state', state: { amount: 999 }, instanceId: 'another' })
    expect(h.send).not.toHaveBeenCalled()
    expect(saveState).not.toHaveBeenCalled()
    emit(frame, { type: 'state', state: { amount: 42 } })
    emit(frame, { type: 'assistant', message: 'Calculate', context: { panel: 'costs' } })
    await waitFor(() => { expect(h.send).toHaveBeenCalledWith({ message: 'Calculate', formState: { amount: 42 }, context: { panel: 'costs' } }) })
    expect(saveState).toHaveBeenCalledWith(INSTANCE, { amount: 42 })
  })

  it('restores the same fence state after history remount and keeps other fences independent', async () => {
    const h = harness()
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    expect(outbound.mock.calls.at(-1)?.[0]).toMatchObject({ state: {} })
    emit(frame, { type: 'state', state: { selected: ['b'], amount: 12 } })
    view.unmount()
    const history = render(<OpenUiFrame {...h.props} streaming={false} />)
    const restored = await connect(history)
    expect(restored.outbound.mock.calls.at(-1)?.[0]).toMatchObject({ state: { selected: ['b'], amount: 12 } })
    history.unmount()
    const otherProps = { ...h.props, instanceId: `${INSTANCE}:another-fence` }
    const other = render(<OpenUiFrame {...otherProps} />)
    await waitFor(() => { expect(other.container.querySelector('iframe')).not.toBeNull() })
    const otherFrame = other.container.querySelector('iframe')!
    const messages = vi.spyOn(otherFrame.contentWindow!, 'postMessage').mockImplementation(() => {})
    emit(otherFrame, { type: 'ready', instanceId: otherProps.instanceId })
    expect(messages.mock.calls.at(-1)?.[0]).toMatchObject({ state: {} })
  })

  it('shows rejected actions and persistence failures without replacing the usable viewer', async () => {
    const h = harness()
    h.send.mockRejectedValue(new Error('Permission denied'))
    const view = render(<OpenUiFrame {...h.props} openUi={{ ...h.props.openUi, saveState: () => { throw new Error('Storage full') } }} />)
    const { frame } = await connect(view)
    emit(frame, { type: 'assistant', message: 'Apply', formState: { count: 2 } })
    expect((await screen.findByRole('alert')).textContent).toContain('Permission denied')
    expect(view.container.querySelector('iframe')).toBe(frame)
    fireEvent.click(screen.getByRole('button', { name: en['openui.dismiss'] }))
    emit(frame, { type: 'state', state: { count: 3 } })
    expect(screen.getByRole('alert').textContent).toContain('Storage full')
    expect(view.container.querySelector('iframe')).toBe(frame)
  })

  it('clears viewer failures only after the current program resolves and retains host failures', async () => {
    const h = harness()
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame } = await connect(view)
    emit(frame, { type: 'error', message: 'Unknown component' })
    expect(screen.getByRole('alert').textContent).toContain('Unknown component')
    const next = 'root = TextContent("Repaired")'
    view.rerender(<OpenUiFrame {...h.props} program={next} streaming={false} />)
    expect(screen.getByRole('alert').textContent).toContain('Unknown component')
    emit(frame, { type: 'resolved', program: h.props.program })
    expect(screen.getByRole('alert').textContent).toContain('Unknown component')
    emit(frame, { type: 'resolved', program: next })
    expect(screen.queryByRole('alert')).toBeNull()
    h.send.mockRejectedValueOnce(new Error('Session action denied'))
    emit(frame, { type: 'assistant', message: 'Apply' })
    expect((await screen.findByRole('alert')).textContent).toContain('Session action denied')
    emit(frame, { type: 'resolved', program: next })
    expect(screen.getByRole('alert').textContent).toContain('Session action denied')
  })

  it('reports saved-state corruption and unavailable desktop viewers as visible failures', async () => {
    const h = harness()
    localStorage.setItem(`whale-openui:state:v1:${INSTANCE}`, '[]')
    const view = render(<OpenUiFrame {...h.props} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en['openui.stateFailed'])
    await connect(view)
    view.unmount()
    Reflect.deleteProperty(window, 'shell')
    render(<OpenUiFrame {...h.props} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en['openui.desktopOnly'])
    expect(screen.queryByText(en['openui.loading'])).toBeNull()
  })

  it('acknowledges actual clipboard success or failure and only forwards allowed API requests', async () => {
    const h = harness()
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    emit(frame, { type: 'clipboard', requestId: 'copy-1', text: 'Actual text' })
    await waitFor(() => { expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ type: 'clipboard-response', requestId: 'copy-1', ok: true }), '*') })
    writeText.mockRejectedValueOnce(new Error('Clipboard blocked'))
    emit(frame, { type: 'clipboard', requestId: 'copy-2', text: 'Cannot copy' })
    await waitFor(() => { expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ type: 'clipboard-response', requestId: 'copy-2', ok: false, error: 'Clipboard blocked' }), '*') })
    emit(frame, { type: 'api-request', requestId: 'api-1', path: '/api/wiki', query: { query: 'Whales' } })
    await waitFor(() => { expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ type: 'api-response', requestId: 'api-1', status: 200, body: { title: 'Lookup result' } }), '*') })
    expect(h.shell.openuiApi).toHaveBeenCalledWith({ path: '/api/wiki', query: { query: 'Whales' } })
    emit(frame, { type: 'api-request', requestId: 'api-2', path: '/api/arbitrary', query: {} })
    expect(h.shell.openuiApi).toHaveBeenCalledOnce()
    expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ type: 'api-response', requestId: 'api-2', status: 400 }), '*')
    emit(frame, { type: 'open-url', url: 'javascript:alert(1)' })
    expect(h.shell.openExternal).not.toHaveBeenCalled()
    emit(frame, { type: 'open-url', url: 'https://example.test/details' })
    await waitFor(() => { expect(h.shell.openExternal).toHaveBeenCalledWith('https://example.test/details') })
  })
})
