// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { OpenUiFrame } from '../src/client/chat/OpenUiFrame.tsx'
import { readOpenUiState, saveOpenUiState } from '../src/client/chat/openui.ts'
import { en } from '../src/client/locale.ts'

const VIEWER = '<!doctype html><html><body><main id="whale-ui"></main></body></html>'
const INSTANCE = 'original-session:assistant-1:0:24'
const previousShell = Object.getOwnPropertyDescriptor(window, 'shell')
const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
type FrameProps = Parameters<typeof OpenUiFrame>[0]

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (previousShell === undefined) Reflect.deleteProperty(window, 'shell')
  else Object.defineProperty(window, 'shell', previousShell)
  if (previousClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', previousClipboard)
})

function harness(instanceId = INSTANCE) {
  const shell = {
    openuiViewer: vi.fn(async () => VIEWER),
    openuiApi: vi.fn(async (_input: unknown) => ({ status: 200, body: { title: 'Lookup result' } })),
    openuiBundle: vi.fn(async (_input: { name: string }) => 'YWJj'),
    openExternal: vi.fn(async (_url: string) => {}),
  }
  Object.defineProperty(window, 'shell', { configurable: true, value: shell })
  const send = vi.fn<FrameProps['openUi']['send']>().mockResolvedValue({ ok: true })
  const props: FrameProps = {
    instanceId, program: 'root = Col([Text("Ready")])', language: 'whale-ui', streaming: true,
    openUi: { identity: 'original-session:assistant-1', theme: null, locale: 'en', send,
      readState: readOpenUiState, saveState: saveOpenUiState },
    t: makeTranslate(en),
  }
  return { shell, send, props }
}

function emit(frame: HTMLIFrameElement, payload: Record<string, unknown>, source: MessageEventSource | null = frame.contentWindow) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      source, data: { channel: 'whale-ui', version: 2, instanceId: INSTANCE, ...payload },
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

function expectAction(outbound: unknown, requestId: string, result: object) {
  expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ type: 'action-response', requestId, result }), '*')
}

describe('Whale UI parent bridge', () => {
  it('keeps one isolated viewer across streamed programs, settlement, theme, locale and source changes', async () => {
    const h = harness()
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    expect(frame.name).toBe(`whale-ui:${INSTANCE}`)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.allowFullscreen).toBe(true)
    expect(frame.getAttribute('srcdoc')).toBe(VIEWER)
    view.rerender(<OpenUiFrame {...h.props} program='root = Col([Text("Completed")])' streaming={false}
      openUi={{ ...h.props.openUi, locale: 'zh', theme: { active: { colorScheme: 'light' } } as never }} />)
    expect(outbound.mock.calls.at(-1)?.[0]).toMatchObject({ channel: 'whale-ui', version: 2, type: 'render',
      language: 'whale-ui', streaming: false, locale: 'zh', theme: { appearance: 'light' } })
    fireEvent.click(screen.getByRole('button', { name: en['openui.source'] }))
    expect(frame.hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en['openui.preview'] }))
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(frame.hidden).toBe(false)
    expect(h.shell.openuiViewer).toHaveBeenCalledOnce()
  })

  it('names the accessible viewer without repeating its title or a status toolbar above the answer', async () => {
    const h = harness()
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame } = await connect(view)
    expect(view.container.querySelector('header')).toBeNull()
    expect(frame.title).toBe(en['openui.title'])
    expect(screen.queryByText(en['openui.title'])).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
    const toggle = screen.getByRole('button', { name: en['openui.source'] })
    expect(toggle.textContent).toBe('')
    expect(toggle.getAttribute('type')).toBe('button')
    expect(toggle.querySelector('svg')).not.toBeNull()
    emit(frame, { type: 'title', title: '  ChisaBot repository overview ' })
    expect(frame.title).toBe('ChisaBot repository overview')
    expect(screen.queryByText('ChisaBot repository overview')).toBeNull()
    emit(frame, { type: 'title', title: 42 })
    expect(frame.title).toBe('ChisaBot repository overview')
    emit(frame, { type: 'title', title: '' })
    expect(frame.title).toBe(en['openui.title'])
  })

  it.each(['keyboard', 'touch'] as const)('keeps the icon source toggle reachable by %s and retains the same edited iframe', async input => {
    const h = harness()
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    emit(frame, { type: 'state', state: { amount: 42 } })
    const toggle = screen.getByRole('button', { name: en['openui.source'] })
    if (input === 'keyboard') {
      fireEvent.keyDown(document, { key: 'Tab' })
      act(() => { toggle.focus() })
      expect(document.activeElement).toBe(toggle)
      expect(toggle.tabIndex).toBe(0)
      // Native keyboard button activation dispatches a click with no pointer detail.
      fireEvent.click(toggle, { detail: 0 })
    } else {
      fireEvent.pointerDown(toggle, { pointerType: 'touch', pointerId: 1 })
      fireEvent.pointerUp(toggle, { pointerType: 'touch', pointerId: 1 })
      fireEvent.click(toggle)
    }
    expect(frame.hidden).toBe(true)
    expect(screen.getByRole('button', { name: en['openui.preview'] }).getAttribute('aria-pressed')).toBe('true')
    expect(view.container.querySelector('code')?.textContent).toBe(h.props.program)
    fireEvent.click(screen.getByRole('button', { name: en['openui.preview'] }), { detail: input === 'keyboard' ? 0 : 1 })
    expect(frame.hidden).toBe(false)
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(readOpenUiState(INSTANCE)).toEqual({ amount: 42 })
    view.rerender(<OpenUiFrame {...h.props} streaming={false} />)
    expect(outbound.mock.calls.at(-1)?.[0]).toMatchObject({ state: { amount: 42 } })
  })

  it('requires the exact contentWindow, channel, version and instance for actions and state', async () => {
    const h = harness()
    const saveState = vi.fn(h.props.openUi.saveState)
    const view = render(<OpenUiFrame {...h.props} openUi={{ ...h.props.openUi, saveState }} />)
    const { frame, outbound } = await connect(view)
    const action = { type: 'action', action: 'assistant', requestId: 'send-1', message: 'Calculate' }
    emit(frame, action, window)
    emit(frame, { ...action, channel: 'whale-openui' })
    emit(frame, { ...action, version: 1 })
    emit(frame, { ...action, instanceId: 'another' })
    emit(frame, { type: 'state', state: { amount: 999 }, instanceId: 'another' })
    expect(h.send).not.toHaveBeenCalled()
    expect(saveState).not.toHaveBeenCalled()
    emit(frame, { type: 'state', state: { amount: 42, secretOutsideForm: 'unrelated' } })
    emit(frame, { ...action, formState: { amount: 42 }, context: { panel: 'costs' } })
    await waitFor(() => { expectAction(outbound, 'send-1', { ok: true }) })
    expect(h.send).toHaveBeenCalledWith({ message: 'Calculate', formState: { amount: 42 }, context: { panel: 'costs' } })
    emit(frame, { ...action, requestId: 'send-2' })
    await waitFor(() => { expectAction(outbound, 'send-2', { ok: true }) })
    expect(h.send).toHaveBeenLastCalledWith({ message: 'Calculate' })
    expect(saveState).toHaveBeenCalledWith(INSTANCE, { amount: 42, secretOutsideForm: 'unrelated' })
  })

  it('migrates legacy state without deleting it and restores opaque v2 records independently', async () => {
    const h = harness()
    const legacyKey = `whale-openui:state:v1:${INSTANCE}`
    const v2Key = `whale-ui:state:v2:${INSTANCE}`
    localStorage.setItem(legacyKey, JSON.stringify({ '$amount': 12 }))
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    expect(outbound.mock.calls.at(-1)?.[0]).toMatchObject({ state: { '$amount': 12 } })
    expect(JSON.parse(localStorage.getItem(v2Key)!)).toEqual({ version: 2, state: { '$amount': 12 } })
    const state = { format: 'whale-ui-state', version: 1, values: { '$amount': 13, '$component:timer': { left: 7 } } }
    emit(frame, { type: 'state', state })
    view.unmount()
    const history = render(<OpenUiFrame {...h.props} streaming={false} />)
    const restored = await connect(history)
    expect(restored.outbound.mock.calls.at(-1)?.[0]).toMatchObject({ state })
    expect(localStorage.getItem(legacyKey)).toBe('{"$amount":12}')
    expect(readOpenUiState(`${INSTANCE}:another-fence`)).toEqual({})
  })

  it('acknowledges the actual queue result only after settlement and shows structured failures', async () => {
    const h = harness()
    let settle: (value: { ok: true }) => void = () => { throw new Error('Action was not started') }
    h.send.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    emit(frame, { type: 'action', action: 'assistant', requestId: 'queue', message: 'Apply' })
    expect(outbound.mock.calls.some(call => (call[0] as Record<string, unknown>).type === 'action-response')).toBe(false)
    expect(view.container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe(en['openui.sending'])
    expect(view.container.querySelector('header')).toBeNull()
    await act(async () => { settle({ ok: true }) })
    expectAction(outbound, 'queue', { ok: true })
    expect(view.container.querySelector('section')?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByRole('status').textContent).toBe('')
    h.send.mockResolvedValueOnce({ ok: false, error: 'Permission denied' })
    emit(frame, { type: 'action', action: 'assistant', requestId: 'denied', message: 'Apply' })
    expect((await screen.findByRole('alert')).textContent).toContain('Permission denied')
    expectAction(outbound, 'denied', { ok: false, error: 'Permission denied' })
    expect(view.container.querySelector('iframe')).toBe(frame)
  })

  it('contains action rejections and persistence failures without replacing the viewer', async () => {
    const h = harness()
    h.send.mockRejectedValueOnce(new Error('Original Session unavailable'))
    const view = render(<OpenUiFrame {...h.props} openUi={{ ...h.props.openUi, saveState: () => { throw new Error('Storage full') } }} />)
    const { frame, outbound } = await connect(view)
    emit(frame, { type: 'action', action: 'assistant', requestId: 'send', message: 'Apply' })
    expect((await screen.findByRole('alert')).textContent).toContain('Original Session unavailable')
    expectAction(outbound, 'send', { ok: false, error: 'Original Session unavailable' })
    fireEvent.click(screen.getByRole('button', { name: en['openui.dismiss'] }))
    emit(frame, { type: 'state', state: { count: 3 } })
    expect(screen.getByRole('alert').textContent).toContain('Storage full')
    expect(view.container.querySelector('iframe')).toBe(frame)
  })

  it('acknowledges late assistant and link failures without showing them on a replacement source', async () => {
    const h = harness()
    let settleSend: (result: { ok: false; error: string }) => void = () => { throw new Error('Send did not start') }
    let rejectLink: (error: Error) => void = () => { throw new Error('Link did not start') }
    h.send.mockImplementationOnce(() => new Promise(resolve => { settleSend = resolve }))
    h.shell.openExternal.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLink = reject }))
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    emit(frame, { type: 'action', action: 'assistant', requestId: 'old-send', message: 'From original' })
    emit(frame, { type: 'action', action: 'open-url', requestId: 'old-link', url: 'https://example.test/old' })
    view.rerender(<OpenUiFrame {...h.props} program='root = Col([Text("Replacement")])' streaming={false} />)
    await act(async () => {
      settleSend({ ok: false, error: 'Original queue failure' })
      rejectLink(new Error('Original link failure'))
    })
    expectAction(outbound, 'old-send', { ok: false, error: 'Original queue failure' })
    expectAction(outbound, 'old-link', { ok: false, error: 'Original link failure' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(view.container.querySelector('iframe')).toBe(frame)
    h.send.mockResolvedValueOnce({ ok: false, error: 'Replacement queue failure' })
    emit(frame, { type: 'action', action: 'assistant', requestId: 'new-send', message: 'From replacement' })
    expect((await screen.findByRole('alert')).textContent).toContain('Replacement queue failure')
    view.rerender(<OpenUiFrame {...h.props} program='root = Col([Text("Third")])' streaming={false} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps persistence errors visible when a later action succeeds on a replacement source', async () => {
    const h = harness()
    const openUi = { ...h.props.openUi, saveState: () => { throw new Error('State could not be saved') } }
    const view = render(<OpenUiFrame {...h.props} openUi={openUi} />)
    const { frame, outbound } = await connect(view)
    emit(frame, { type: 'state', state: { amount: 7 } })
    expect(screen.getByRole('alert').textContent).toContain('State could not be saved')
    view.rerender(<OpenUiFrame {...h.props} program='root = Col([Text("Replacement")])' streaming={false} openUi={openUi} />)
    emit(frame, { type: 'action', action: 'assistant', requestId: 'success', message: 'Go' })
    await waitFor(() => { expectAction(outbound, 'success', { ok: true }) })
    expect(screen.getByRole('alert').textContent).toContain('State could not be saved')
  })

  it('clears current viewer diagnostics on complete success while retaining host failures', async () => {
    const h = harness()
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame } = await connect(view)
    emit(frame, { type: 'diagnostics', program: h.props.program, complete: false,
      diagnostics: [{ phase: 'parse', code: 'incomplete', message: 'Unclosed string', path: 'root' }] })
    expect(screen.getByRole('alert').textContent).toContain('root: Unclosed string')
    emit(frame, { type: 'diagnostics', program: 'old', complete: true, diagnostics: [] })
    emit(frame, { type: 'diagnostics', program: h.props.program, complete: false, diagnostics: [] })
    expect(screen.getByRole('alert')).not.toBeNull()
    emit(frame, { type: 'diagnostics', program: h.props.program, complete: true, diagnostics: [] })
    expect(screen.queryByRole('alert')).toBeNull()
    h.send.mockResolvedValueOnce({ ok: false, error: 'Session action denied' })
    emit(frame, { type: 'action', action: 'assistant', requestId: 'denied', message: 'Apply' })
    expect((await screen.findByRole('alert')).textContent).toContain('Session action denied')
    emit(frame, { type: 'diagnostics', program: h.props.program, complete: true, diagnostics: [] })
    expect(screen.getByRole('alert').textContent).toContain('Session action denied')
  })

  it('reports saved-state corruption and missing desktop viewers visibly', async () => {
    const h = harness()
    localStorage.setItem(`whale-ui:state:v2:${INSTANCE}`, '{"version":3,"state":{}}')
    const view = render(<OpenUiFrame {...h.props} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en['openui.stateFailed'])
    await connect(view)
    view.unmount()
    Reflect.deleteProperty(window, 'shell')
    render(<OpenUiFrame {...h.props} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en['openui.desktopOnly'])
  })

  it('acknowledges clipboard and links and enforces the exact resource and bundle allowlists', async () => {
    const h = harness()
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    emit(frame, { type: 'action', action: 'clipboard', requestId: 'copy-1', text: 'Actual text' })
    await waitFor(() => { expectAction(outbound, 'copy-1', { ok: true }) })
    writeText.mockRejectedValueOnce(new Error('Clipboard blocked'))
    emit(frame, { type: 'action', action: 'clipboard', requestId: 'copy-2', text: 'Cannot copy' })
    await waitFor(() => { expectAction(outbound, 'copy-2', { ok: false, error: 'Clipboard blocked' }) })
    emit(frame, { type: 'resource', requestId: 'resource-1', path: '/api/wiki', query: { query: 'Whales' } })
    await waitFor(() => { expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ type: 'resource-response', requestId: 'resource-1', status: 200 }), '*') })
    emit(frame, { type: 'resource', requestId: 'bad-resource', path: '/api/arbitrary', query: {} })
    expect(h.shell.openuiApi).toHaveBeenCalledOnce()
    expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ type: 'resource-response', requestId: 'bad-resource', status: 400 }), '*')
    emit(frame, { type: 'bundle', requestId: 'bundle-1', name: 'echarts-full.js' })
    await waitFor(() => { expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ type: 'bundle-response', requestId: 'bundle-1', name: 'echarts-full.js', base64: 'YWJj' }), '*') })
    emit(frame, { type: 'bundle', requestId: 'bad-bundle', name: '../secret.js' })
    expect(h.shell.openuiBundle).toHaveBeenCalledOnce()
    expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ type: 'bundle-response', requestId: 'bad-bundle', error: en['openui.invalidBundle'] }), '*')
    emit(frame, { type: 'action', action: 'open-url', requestId: 'bad-url', url: 'javascript:alert(1)' })
    await waitFor(() => { expectAction(outbound, 'bad-url', { ok: false, error: en['openui.invalidAction'] }) })
    expect(h.shell.openExternal).not.toHaveBeenCalled()
    emit(frame, { type: 'action', action: 'open-url', requestId: 'url', url: 'https://example.test/details' })
    await waitFor(() => { expectAction(outbound, 'url', { ok: true }) })
    expect(h.shell.openExternal).toHaveBeenCalledWith('https://example.test/details')
  })

  it('converts data downloads to a Blob and clicks a host anchor with a safe filename', async () => {
    const h = harness()
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:whale-download')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', class extends URL { static override createObjectURL = createObjectURL; static override revokeObjectURL = revokeObjectURL })
    const clicks: { href: string; filename: string; attached: boolean }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, filename: this.download, attached: this.isConnected })
    })
    const view = render(<OpenUiFrame {...h.props} />)
    const { frame, outbound } = await connect(view)
    emit(frame, { type: 'action', action: 'download', requestId: 'download', filename: 'results.json', mime: 'application/json', content: 'data:application/json;base64,eyJhIjoxfQ==' })
    await waitFor(() => { expectAction(outbound, 'download', { ok: true }) })
    expect(createObjectURL.mock.calls[0]?.[0].size).toBe(7)
    expect(createObjectURL.mock.calls[0]?.[0].type).toBe('application/json')
    expect(clicks).toEqual([{ href: 'blob:whale-download', filename: 'results.json', attached: true }])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:whale-download')
    expect(h.shell.openExternal).not.toHaveBeenCalled()
    emit(frame, { type: 'action', action: 'download', requestId: 'unsafe', filename: '../bad.html', mime: 'text/html', content: 'test' })
    await waitFor(() => { expectAction(outbound, 'unsafe', { ok: false, error: 'The download filename is invalid.' }) })
    expect(clicks).toHaveLength(1)
  })

  it('publishes settled normalized panels with only host-owned source and real sequence order', async () => {
    const h = harness()
    const publishPanel = vi.fn()
    const panelSource = { sourceId: INSTANCE, order: [30, 0, 24] as const }
    const view = render(<OpenUiFrame {...h.props} language="dsh-ui" panelSource={panelSource}
      openUi={{ ...h.props.openUi, publishPanel }} />)
    const { frame } = await connect(view)
    const spec = { panel: true, items: [{ type: 'text', text: 'Panel content' }] }
    const operation = { sourceId: 'another-session', order: [9999, 0, 0], append: true, spec }
    emit(frame, { type: 'panel', operation })
    expect(publishPanel).not.toHaveBeenCalled()
    view.rerender(<OpenUiFrame {...h.props} language="dsh-ui" streaming={false} panelSource={panelSource}
      openUi={{ ...h.props.openUi, publishPanel }} />)
    emit(frame, { type: 'panel', operation })
    expect(publishPanel).toHaveBeenCalledWith({ ...panelSource, append: true, spec })
    expect(screen.getByRole('status').textContent).toBe(en['openui.panelPublished'])
    expect(view.container.querySelector('header')).toBeNull()
    expect(frame.hidden).toBe(true)
    expect(view.container.querySelector('iframe')).toBe(frame)
    fireEvent.click(screen.getByRole('button', { name: en['openui.source'] }))
    expect(view.container.querySelector('code')?.textContent).toBe(h.props.program)
    expect(frame.hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en['openui.preview'] }))
    expect(view.container.querySelector('code')).toBeNull()
    expect(view.container.querySelector('iframe')).toBe(frame)
    view.rerender(<OpenUiFrame {...h.props} language="dsh-ui" streaming={false} panel panelSource={panelSource}
      openUi={{ ...h.props.openUi, publishPanel }} />)
    emit(frame, { type: 'panel', operation })
    expect(publishPanel).toHaveBeenCalledOnce()
  })
})
