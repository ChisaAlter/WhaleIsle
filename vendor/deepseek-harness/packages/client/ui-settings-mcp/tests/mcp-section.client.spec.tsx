// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpSection } from '../src/client/McpSection.tsx'
import type { McpSectionInjected, McpSectionProps } from '../src/client/McpSection.tsx'
import { en, type McpSettingsKey } from '../src/client/locales.ts'
import type { McpServerTestResult } from '@deepseek-ai/dsh-api-remotes/client'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = ((key: McpSettingsKey): string => en[key])

const managedStdio = {
  id: 'github-id',
  origin: 'managed',
  writable: true,
  enabled: true,
  fiberPhase: 'active',
  spec: {
    id: 'github-id',
    enabled: true,
    transport: 'stdio',
    serverName: 'github',
    command: 'npx',
    args: ['-y', '@mcp/github'],
    env: { TOKEN: 'secret' },
    cwd: '/workspace',
  },
} as const

const managedHttp = {
  id: 'remote-id',
  origin: 'managed',
  writable: true,
  enabled: true,
  fiberPhase: 'active',
  spec: {
    id: 'remote-id',
    enabled: true,
    transport: 'streamable-http',
    serverName: 'remote-managed',
    url: 'https://managed.example.test/api',
  },
} as const

const compositionHttp = {
  id: 'cordis:remote',
  origin: 'composition',
  writable: false,
  enabled: false,
  fiberPhase: 'failed',
  spec: {
    id: 'remote',
    enabled: false,
    transport: 'streamable-http',
    serverName: 'remote-tools',
    url: 'https://mcp.example.test/api',
    headers: { Authorization: 'Bearer token' },
  },
} as const

function props(partial: Partial<McpSectionInjected> = {}): McpSectionProps {
  return {
    t,
    list: async () => ({ servers: [] }),
    upsert: async () => {},
    remove: async () => {},
    setEnabled: async () => {},
    retry: async () => {},
    test: async () => ({
      ok: true,
      serverName: 'fixture',
      transport: 'stdio',
      toolNames: [],
      toolCount: 0,
      elapsedMs: 1,
    } satisfies McpServerTestResult),
    authorize: async () => {},
    ...partial,
  } as McpSectionProps
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function openAddEditor(partial: Partial<McpSectionInjected> = {}) {
  render(<McpSection {...props(partial)} />)
  fireEvent.click(await screen.findByRole('button', { name: en.add }))
  return screen.getByRole('dialog', { name: en.editorTitleAdd })
}

function selectFilter(option: string): void {
  fireEvent.click(screen.getByRole('button', { name: en.filterEnabled }))
  fireEvent.click(screen.getByRole('menuitem', { name: option }))
}

function pickTransport(dialog: HTMLElement, optionLabel: string): void {
  fireEvent.click(within(dialog).getByLabelText(en.transport))
  fireEvent.click(screen.getByRole('menuitem', { name: optionLabel }))
}

describe('McpSection', () => {
  it('searches name, ID, command, and URL and filters by enabled state', async () => {
    render(<McpSection {...props({ list: async () => ({ servers: [managedStdio, compositionHttp] }) })} />)
    const search = await screen.findByRole('searchbox', { name: en.search })
    expect(screen.getByRole('heading', { name: en.configuredCount.replace('{count}', '1') })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.compositionSection })).toBeTruthy()

    for (const term of ['github', 'github-id', 'npx', 'mcp.example.test']) {
      fireEvent.change(search, { target: { value: term } })
      expect(screen.getByText(term.includes('example') ? 'remote-tools' : 'github')).toBeTruthy()
      fireEvent.change(search, { target: { value: '' } })
    }

    selectFilter(en.filterDisabledOnly)
    expect(screen.getByText('remote-tools')).toBeTruthy()
    expect(screen.queryByText('github')).toBeNull()
  })

  it('shows distinct catalog-empty and no-result states and clears active filters', async () => {
    const { unmount } = render(<McpSection {...props()} />)
    expect(await screen.findByText(en.empty)).toBeTruthy()
    unmount()

    render(<McpSection {...props({ list: async () => ({ servers: [managedStdio] }) })} />)
    fireEvent.change(await screen.findByRole('searchbox', { name: en.search }), { target: { value: 'missing' } })
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.clearFilters }))
    expect(screen.getByText('github')).toBeTruthy()
  })

  it('renders configured and composition sections as flat rows with status and a summary line', async () => {
    render(<McpSection {...props({ list: async () => ({ servers: [managedStdio, compositionHttp] }) })} />)
    expect(await screen.findByText(en.managed)).toBeTruthy()
    expect(screen.getByText(en.active)).toBeTruthy()
    expect(screen.getByText('stdio · npx -y @mcp/github · /workspace')).toBeTruthy()
    expect(screen.getByText(en.compositionNote)).toBeTruthy()
    expect(screen.getByText('HTTP · https://mcp.example.test/api')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Expand configuration/ })).toBeNull()
  })

  it('prefers live connection health over the fiber phase and surfaces the failure reason', async () => {
    const reconnecting = {
      ...managedStdio,
      connection: { health: 'reconnecting', lastError: 'Error: spawn ENOENT' },
    } as const
    render(<McpSection {...props({ list: async () => ({ servers: [reconnecting] }) })} />)
    expect(await screen.findByText(en.healthReconnecting)).toBeTruthy()
    expect(screen.queryByText(en.active)).toBeNull()
    expect(screen.getByText('Error: spawn ENOENT')).toBeTruthy()
    const runtime = screen.getByTitle(`${en.healthReconnecting}: Error: spawn ENOENT`)
    expect(runtime).toBeTruthy()

    cleanup()
    const deadComposition = {
      ...compositionHttp,
      connection: { health: 'failed' },
    } as const
    render(<McpSection {...props({ list: async () => ({ servers: [deadComposition] }) })} />)
    expect(await screen.findByText(en.healthFailed)).toBeTruthy()
    // Connection health wins on the same row; the fiber copy stays hidden.
    expect(screen.queryByText(en.failed)).toBeNull()

    // Without a reporting mcp-client the row falls back to the fiber phase.
    cleanup()
    render(<McpSection {...props({ list: async () => ({ servers: [compositionHttp] }) })} />)
    expect(await screen.findByText(en.failed)).toBeTruthy()
  })

  it('toggles one writable row optimistically without replacing the page and blocks duplicate toggles', async () => {
    const pending = deferred<undefined>()
    const setEnabled = vi.fn(() => pending.promise)
    const list = vi.fn(async () => ({ servers: [managedStdio] }))
    render(<McpSection {...props({ list, setEnabled })} />)
    const toggle = await screen.findByRole('switch', { name: en.enableAria.replace('{name}', 'github') })

    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(setEnabled).toHaveBeenCalledTimes(1)
    expect(setEnabled).toHaveBeenCalledWith('github-id', false)
    expect(toggle.getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(1)
    pending.resolve(undefined)
    await waitFor(() => { expect(toggle.getAttribute('disabled')).toBeNull() })
  })

  it('clears independent pending rows when concurrent toggles finish around a reload', async () => {
    const first = deferred<undefined>()
    const second = deferred<undefined>()
    const setEnabled = vi.fn((id: string) => id === managedStdio.id ? first.promise : second.promise)
    const list = vi.fn(async () => ({ servers: [managedStdio, managedHttp] }))
    render(<McpSection {...props({ list, setEnabled })} />)
    const firstToggle = await screen.findByRole('switch', { name: en.enableAria.replace('{name}', 'github') })
    const secondToggle = screen.getByRole('switch', { name: en.enableAria.replace('{name}', 'remote-managed') })

    fireEvent.click(firstToggle)
    fireEvent.click(secondToggle)
    first.resolve(undefined)
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    second.resolve(undefined)

    await waitFor(() => {
      expect(firstToggle.getAttribute('disabled')).toBeNull()
      expect(secondToggle.getAttribute('disabled')).toBeNull()
    })
  })

  it('reports a post-mutation refresh failure without stranding the row pending', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ servers: [managedStdio] })
      .mockRejectedValueOnce(new Error('refresh unavailable'))
      .mockResolvedValueOnce({ servers: [managedStdio] })
    render(<McpSection {...props({ list })} />)
    const toggle = await screen.findByRole('switch', { name: en.enableAria.replace('{name}', 'github') })
    fireEvent.click(toggle)

    expect(await screen.findByText(en.refreshFailed)).toBeTruthy()
    expect(toggle.getAttribute('disabled')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(screen.queryByText(en.refreshFailed)).toBeNull() })
  })

  it('keeps a toggle error on its row and rolls back the optimistic value', async () => {
    const setEnabled = vi.fn(async () => { throw new Error('permission denied') })
    render(<McpSection {...props({ list: async () => ({ servers: [managedStdio] }), setEnabled })} />)
    const toggle = await screen.findByRole('switch', { name: en.enableAria.replace('{name}', 'github') }) as HTMLInputElement
    fireEvent.click(toggle)
    expect((await screen.findByRole('alert')).textContent).toContain('permission denied')
    await waitFor(() => { expect(toggle.checked).toBe(true) })
  })

  it('keeps composition rows read-only and retries an initial list failure', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ servers: [compositionHttp] })
    render(<McpSection {...props({ list })} />)
    expect(await screen.findByText(en.error)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(await screen.findByText(en.readOnly)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText(en.composition, { selector: 'span' })).toBeTruthy()
  })

  it('polls live connection health while the page is open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const list = vi.fn()
      .mockResolvedValueOnce({
        servers: [{ ...managedStdio, connection: { health: 'connecting' as const } }],
      })
      .mockResolvedValue({
        servers: [{ ...managedStdio, connection: { health: 'connected' as const } }],
      })
    render(<McpSection {...props({ list })} />)
    expect(await screen.findByText(en.healthConnecting)).toBeTruthy()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await screen.findByText(en.healthConnected)).toBeTruthy()
  })

  it('shows the tool count for a server connected while the page is open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const list = vi.fn()
      .mockResolvedValueOnce({ servers: [managedStdio] })
      .mockResolvedValue({
        servers: [{
          ...managedStdio,
          connection: { health: 'connected' as const, tools: ['mcp__github__create_issue'] },
        }],
      })
    render(<McpSection {...props({ list })} />)
    expect(await screen.findByText('github')).toBeTruthy()
    expect(screen.queryByText('1 tools')).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await screen.findByText('1 tools')).toBeTruthy()
  })

  it('shows the tool count and opens a closable tool dialog on a connected row', async () => {
    render(<McpSection {...props({
      list: async () => ({
        servers: [{
          ...managedStdio,
          connection: {
            health: 'connected' as const,
            tools: ['mcp__github__create_issue', 'mcp__github__list'],
          },
        }],
      }),
    })} />)
    expect(await screen.findByText(en.healthConnected)).toBeTruthy()
    expect(screen.queryByText('mcp__github__create_issue')).toBeNull()
    fireEvent.click(screen.getByText('2 tools'))
    expect(await screen.findByText('github tools')).toBeTruthy()
    expect(screen.getByText('mcp__github__create_issue')).toBeTruthy()
    expect(screen.getByText('mcp__github__list')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    await waitFor(() => {
      expect(screen.queryByText('mcp__github__create_issue')).toBeNull()
      expect(screen.queryByText('mcp__github__list')).toBeNull()
    })
  })

  it('tests managed and composition rows once, then shows discovered tools', async () => {
    const pending = deferred<McpServerTestResult>()
    const test = vi.fn((id: string) => id === managedStdio.id ? pending.promise : Promise.resolve({
      ok: true as const,
      serverName: 'remote-tools',
      transport: 'streamable-http' as const,
      toolNames: ['fetch'],
      toolCount: 1,
      elapsedMs: 7,
    }))
    render(<McpSection {...props({ list: async () => ({ servers: [managedStdio, compositionHttp] }), test })} />)
    const managedButton = await screen.findByRole('button', { name: en.testFor.replace('{name}', 'github') })
    fireEvent.click(managedButton)
    fireEvent.click(managedButton)
    expect(test).toHaveBeenCalledTimes(1)
    expect(screen.getByText(en.testing)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.testFor.replace('{name}', 'remote-tools') }))
    expect(await screen.findByText(en.testSuccess.replace('{count}', '1').replace('{tools}', 'fetch'))).toBeTruthy()
    pending.resolve({
      ok: true,
      serverName: 'github',
      transport: 'stdio',
      toolNames: ['search', 'open'],
      toolCount: 2,
      elapsedMs: 12,
    })
    expect(await screen.findByText(en.testSuccess.replace('{count}', '2').replace('{tools}', 'search, open'))).toBeTruthy()
  })

  it('shows a test failure without changing row or retry behavior', async () => {
    const test = vi.fn(async () => { throw new Error('connection refused') })
    render(<McpSection {...props({ list: async () => ({ servers: [managedStdio] }), test })} />)
    fireEvent.click(await screen.findByRole('button', { name: en.testFor.replace('{name}', 'github') }))
    expect((await screen.findAllByRole('alert')).some(item => item.textContent?.includes('connection refused'))).toBe(true)
    expect(screen.getByRole('button', { name: en.refresh })).toBeTruthy()
  })

  it('keeps repeated test success in its inline status', async () => {
    const test = vi.fn(props().test)
    render(<McpSection {...props({ list: async () => ({ servers: [managedStdio] }), test })} />)
    const button = await screen.findByRole('button', { name: en.testFor.replace('{name}', 'github') })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await act(async () => { fireEvent.click(button) })
    const first = screen.getByText(en.testSuccess.replace('{count}', '0').replace('{tools}', en.testNoTools))
    expect(first.textContent).toContain(en.testSuccess.replace('{count}', '0').replace('{tools}', en.testNoTools))

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await act(async () => { fireEvent.click(button) })
    expect(test).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(button.title).toBe(first.textContent)
    expect(button.getAttribute('aria-describedby')).toBe(first.id)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(button.title).toBe(first.textContent)
    expect(button.getAttribute('aria-describedby')).toBe(first.id)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('remounts failed managed rows when refresh is clicked', async () => {
    const retry = vi.fn(async () => {})
    const failed = {
      ...managedStdio,
      connection: { health: 'failed' as const, lastError: 'Error: spawn ENOENT' },
    }
    const failedComposition = {
      ...compositionHttp,
      connection: { health: 'failed' as const, lastError: 'Error: missing bearer token' },
    }
    render(<McpSection {...props({
      list: async () => ({ servers: [failed, failedComposition] }),
      retry,
    })} />)
    expect((await screen.findAllByText(en.healthFailed)).length).toBe(2)
    expect(screen.getByText('Error: missing bearer token')).toBeTruthy()
    expect(screen.queryByText(en.healthConnected)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(retry).toHaveBeenCalledWith('github-id') })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalledWith(failedComposition.id)
  })

  it('signs in a failed managed HTTP row so the Host can mount tools', async () => {
    const authorize = vi.fn(async () => {})
    const failedHttp = {
      ...managedHttp,
      connection: { health: 'failed' as const, lastError: 'Error: HTTP 401 Unauthorized' },
    }
    const failedStdio = {
      ...managedStdio,
      connection: { health: 'failed' as const, lastError: 'Error: spawn ENOENT' },
    }
    render(<McpSection {...props({
      list: async () => ({ servers: [failedHttp, failedStdio, compositionHttp] }),
      authorize,
    })} />)
    expect(await screen.findByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.signInFor.replace('{name}', 'github') })).toBeNull()
    expect(screen.queryByRole('button', { name: en.signInFor.replace('{name}', 'remote-tools') })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') }))
    await waitFor(() => { expect(authorize).toHaveBeenCalledWith('remote-id') })
  })

  it('clears Sign in pending after authorize even if list identity changes', async () => {
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    const authorize = vi.fn(async () => { await gate.promise })
    const failedHttp = {
      ...managedHttp,
      connection: { health: 'failed' as const, lastError: 'Error: HTTP 401 Unauthorized' },
    }
    const snapshot = { servers: [failedHttp] }
    const { rerender } = render(<McpSection {...props({
      list: async () => snapshot,
      authorize,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') }))
    expect(await screen.findByText(en.signingIn)).toBeTruthy()
    rerender(<McpSection {...props({
      list: async () => snapshot,
      authorize,
    })} />)
    expect(screen.getByText(en.signingIn)).toBeTruthy()
    gate.resolve()
    await waitFor(() => { expect(screen.queryByText(en.signingIn)).toBeNull() })
  })

  it('does not throw when Sign in settles after unmount', async () => {
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    const authorize = vi.fn(async () => { await gate.promise })
    const failedHttp = {
      ...managedHttp,
      connection: { health: 'failed' as const, lastError: 'Error: HTTP 401 Unauthorized' },
    }
    const { unmount } = render(<McpSection {...props({
      list: async () => ({ servers: [failedHttp] }),
      authorize,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') }))
    unmount()
    gate.resolve()
    await waitFor(() => { expect(authorize).toHaveBeenCalledWith('remote-id') })
  })

  it('hides Sign in on a failed managed HTTP row unless lastError is an auth challenge', async () => {
    const networkFailed = {
      ...managedHttp,
      connection: { health: 'failed' as const, lastError: 'Error: fetch failed' },
    }
    const { unmount } = render(<McpSection {...props({
      list: async () => ({ servers: [networkFailed] }),
    })} />)
    expect(await screen.findByText('Error: fetch failed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') })).toBeNull()
    unmount()

    const noError = {
      ...managedHttp,
      connection: { health: 'failed' as const },
    }
    const { unmount: unmountNoError } = render(<McpSection {...props({
      list: async () => ({ servers: [noError] }),
    })} />)
    expect(await screen.findByText(en.healthFailed)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') })).toBeNull()
    unmountNoError()

    const portFalsePositive = {
      ...managedHttp,
      connection: { health: 'failed' as const, lastError: 'ECONNREFUSED 127.0.0.1:4010' },
    }
    const { unmount: unmountPort } = render(<McpSection {...props({
      list: async () => ({ servers: [portFalsePositive] }),
    })} />)
    expect(await screen.findByText('ECONNREFUSED 127.0.0.1:4010')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') })).toBeNull()
    unmountPort()

    const oauthHost = {
      ...managedHttp,
      connection: { health: 'failed' as const, lastError: 'getaddrinfo ENOTFOUND foo.oauth.example.com' },
    }
    render(<McpSection {...props({
      list: async () => ({ servers: [oauthHost] }),
    })} />)
    expect(await screen.findByText('getaddrinfo ENOTFOUND foo.oauth.example.com')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') })).toBeNull()
  })

  it('shows Sign in for SDK POST 401 lastError and missing bearer bodies', async () => {
    const sdkPost = {
      ...managedHttp,
      connection: {
        health: 'failed' as const,
        lastError: 'HTTP 401: StreamableHTTPError: Streamable HTTP error: Error POSTing to endpoint: ',
      },
    }
    const { unmount } = render(<McpSection {...props({
      list: async () => ({ servers: [sdkPost] }),
    })} />)
    expect(await screen.findByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') })).toBeTruthy()
    unmount()

    const bearer = {
      ...managedHttp,
      connection: { health: 'failed' as const, lastError: 'Error: missing bearer token' },
    }
    render(<McpSection {...props({
      list: async () => ({ servers: [bearer] }),
    })} />)
    expect(await screen.findByRole('button', { name: en.signInFor.replace('{name}', 'remote-managed') })).toBeTruthy()
  })


  it('groups the add form, warns about stdio execution, and saves valid KEY=value lines', async () => {
    const upsert = vi.fn(async () => {})
    const dialog = await openAddEditor({ upsert })
    expect(within(dialog).getByText(en.generalGroup)).toBeTruthy()
    expect(within(dialog).getByText(en.connectionGroup)).toBeTruthy()
    expect(within(dialog).getByText(en.stdioRiskTitle)).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText(en.id), { target: { value: 'memory' } })
    fireEvent.change(within(dialog).getByLabelText(en.command), { target: { value: 'mcp-memory' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.envToggle }))
    fireEvent.change(within(dialog).getByLabelText(en.env), { target: { value: 'TOKEN=\nMODE=a=b' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
    await waitFor(() => {
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        id: 'memory',
        serverName: 'memory',
        command: 'mcp-memory',
        env: { TOKEN: '', MODE: 'a=b' },
      }))
    })
  })

  it('validates URL and every KEY=value line with accessible field errors', async () => {
    const dialog = await openAddEditor()
    fireEvent.change(within(dialog).getByLabelText(en.id), { target: { value: 'remote' } })
    pickTransport(dialog, en.http)
    const url = within(dialog).getByLabelText(en.url)
    const headers = within(dialog).getByLabelText(en.headers)
    fireEvent.change(url, { target: { value: 'ftp://example.test/mcp' } })
    fireEvent.change(headers, { target: { value: 'Authorization\nX-Valid=yes' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))

    expect(within(dialog).getByText(en.urlInvalid)).toBeTruthy()
    expect(within(dialog).getByText(en.headerLineInvalid.replace('{line}', '1'))).toBeTruthy()
    expect(url.getAttribute('aria-invalid')).toBe('true')
    expect(headers.getAttribute('aria-invalid')).toBe('true')
    expect(url.getAttribute('aria-describedby')).toContain('url-error')
    expect(headers.getAttribute('aria-describedby')).toContain('headers-error')
  })

  it('shows an identical form validation failure again after its notice expires', async () => {
    const upsert = vi.fn(async () => {})
    const dialog = await openAddEditor({ upsert })
    fireEvent.change(within(dialog).getByLabelText(en.id), { target: { value: 'memory' } })
    const command = within(dialog).getByLabelText(en.command)
    const save = within(dialog).getByRole('button', { name: en.save })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await act(async () => { fireEvent.click(save) })
    expect(screen.getByRole('alert').textContent).toContain(en.commandRequired)
    expect(command.getAttribute('aria-invalid')).toBe('true')
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(command.getAttribute('aria-invalid')).toBe('true')
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.id).value).toBe('memory')

    await act(async () => { fireEvent.click(save) })
    expect(screen.getByRole('alert').textContent).toContain(en.commandRequired)
    expect(upsert).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: en.editorTitleAdd })).toBe(dialog)
  })

  it('preserves independent stdio and HTTP drafts while switching transport branches', async () => {
    const dialog = await openAddEditor()
    fireEvent.change(within(dialog).getByLabelText(en.command), { target: { value: 'npx preserved' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.envToggle }))
    fireEvent.change(within(dialog).getByLabelText(en.env), { target: { value: 'TOKEN=stdio' } })

    pickTransport(dialog, en.http)
    fireEvent.change(within(dialog).getByLabelText(en.url), { target: { value: 'https://example.test/mcp' } })
    fireEvent.change(within(dialog).getByLabelText(en.headers), { target: { value: 'TOKEN=http' } })

    pickTransport(dialog, en.stdio)
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.command).value).toBe('npx preserved')
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>(en.env).value).toBe('TOKEN=stdio')

    pickTransport(dialog, en.http)
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.url).value).toBe('https://example.test/mcp')
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>(en.headers).value).toBe('TOKEN=http')
  })

  it('shows remote save errors in a floating notice and preserves the draft while blocking duplicate saves', async () => {
    const pending = deferred<undefined>()
    const upsert = vi.fn(() => pending.promise)
    const dialog = await openAddEditor({ upsert })
    fireEvent.change(within(dialog).getByLabelText(en.id), { target: { value: 'memory' } })
    fireEvent.change(within(dialog).getByLabelText(en.command), { target: { value: 'memory-server' } })
    const save = within(dialog).getByRole('button', { name: en.save })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(save.getAttribute('disabled')).not.toBeNull()

    pending.reject(new Error('remote rejected'))
    const failure = await screen.findByRole('alert')
    expect(failure.textContent).toContain('remote rejected')
    expect(dialog.contains(failure)).toBe(false)
    expect(screen.getByRole('dialog', { name: en.editorTitleAdd })).toBeTruthy()
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.id).value).toBe('memory')
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.command).value).toBe('memory-server')
    await waitFor(() => { expect(save.getAttribute('disabled')).toBeNull() })
  })

  it('uses row icon actions and keeps delete confirmation open when a floating failure appears', async () => {
    const remove = vi.fn(async () => { throw new Error('cannot remove') })
    render(<McpSection {...props({ list: async () => ({ servers: [managedStdio] }), remove })} />)
    await screen.findByText('github')

    fireEvent.click(screen.getByRole('button', { name: en.editFor.replace('{name}', 'github') }))
    expect(screen.getByRole('dialog', { name: en.editorTitleEdit })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))

    fireEvent.click(screen.getByRole('button', { name: en.removeFor.replace('{name}', 'github') }))
    const confirmation = screen.getByRole('dialog', { name: en.deleteTitle.replace('{name}', 'github') })
    fireEvent.click(within(confirmation).getByRole('button', { name: en.deleteConfirm }))
    const failure = await screen.findByRole('alert')
    expect(failure.textContent).toContain('cannot remove')
    expect(confirmation.contains(failure)).toBe(false)
    expect(screen.getByRole('dialog', { name: en.deleteTitle.replace('{name}', 'github') })).toBeTruthy()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('round-trips a named JSON object and an mcpServers wrapper into the same record', async () => {
    const upsert = vi.fn(async () => {})
    const dialog = await openAddEditor({ upsert })
    fireEvent.click(within(dialog).getByRole('button', { name: en.editorModeJson }))
    fireEvent.change(within(dialog).getByLabelText(en.jsonLabel), {
      target: {
        value: JSON.stringify({
          mcpServers: {
            memory: {
              type: 'stdio',
              command: 'mcp-memory',
              args: ['--port', '9'],
              toolCallTimeoutMs: 4000,
            },
          },
        }),
      },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: en.editorModeForm }))
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.id).value).toBe('memory')
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.command).value).toBe('mcp-memory')
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.args).value).toBe('--port 9')
    expect(within(dialog).getByLabelText<HTMLInputElement>(en.timeout).value).toBe('4000')

    fireEvent.click(within(dialog).getByRole('button', { name: en.editorModeJson }))
    fireEvent.change(within(dialog).getByLabelText(en.jsonLabel), {
      target: {
        value: JSON.stringify({
          remote: { url: 'https://mcp.example.test/api' },
        }),
      },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
    await waitFor(() => {
      expect(upsert).toHaveBeenCalledWith({
        id: 'remote',
        serverName: 'remote',
        enabled: true,
        transport: 'streamable-http',
        url: 'https://mcp.example.test/api',
      })
    })
  })

  it('round-trips failOnStartupError and reconnect through JSON', async () => {
    const upsert = vi.fn(async () => {})
    const dialog = await openAddEditor({ upsert })
    fireEvent.click(within(dialog).getByRole('button', { name: en.editorModeJson }))
    fireEvent.change(within(dialog).getByLabelText(en.jsonLabel), {
      target: {
        value: JSON.stringify({
          memory: {
            command: 'mcp-memory',
            failOnStartupError: true,
            reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 20, maxAttempts: 3 },
          },
        }),
      },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: en.editorModeForm }))
    fireEvent.click(within(dialog).getByRole('button', { name: en.editorModeJson }))
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>(en.jsonLabel).value).toContain('"failOnStartupError": true')
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>(en.jsonLabel).value).toContain('"maxAttempts": 3')
    fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
    await waitFor(() => {
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        id: 'memory',
        serverName: 'memory',
        command: 'mcp-memory',
        failOnStartupError: true,
        reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 20, maxAttempts: 3 },
      }))
    })
  })
})
