// @vitest-environment jsdom

import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { CordisPanel, type CordisPanelProps } from '../src/client/CordisPanel.tsx'
import { createCordisInventory } from '../src/client/inventory.ts'
import type { CordisDynamicPort, CordisInventoryRow } from '../src/client/dynamic-port.ts'
import { en } from '../src/client/locales.ts'

const PLUGIN = 'clock-1' as CordisDynamicPluginId
const PACKAGE = 'package-1' as CordisDynamicPackageId
const SESSION = 'session-1' as SessionId
const ROW: CordisInventoryRow = {
  pluginId: PLUGIN,
  agentId: SESSION,
  packages: [{ packageId: PACKAGE, name: 'Clock', purpose: 'Show time', hasHostHalf: true, hasClientHalf: false }],
  currentPackageId: PACKAGE,
  activeRun: { packageId: PACKAGE, pluginRunId: 'run-1' as CordisDynamicPluginRunId },
}
const t: CordisPanelProps['t'] = (key, params) => {
  let text = key in en ? en[key as keyof typeof en] : key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}
const useValue = <T,>(value: T) => <Selected,>(selector: (snapshot: T) => Selected): Selected => selector(value)
const settle = () => act(async () => { await Promise.resolve() })

function mount(answer: CordisDynamicPort['inventory'], wide = true) {
  const read = vi.fn(answer)
  const inventory = createCordisInventory({
    inventory: read,
    stop: vi.fn(),
    remove: vi.fn(),
  }, vi.fn())
  const onRefresh = vi.fn(() => { inventory.refresh() })
  const onStop = vi.fn<CordisPanelProps['onStop']>(async () => ({ ok: true }))
  const props = {
    wide, t, onRefresh, onStop,
    useSessions: selector => selector({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
    useActiveRuns: useValue(new Map()),
    useRunErrors: useValue(new Map()),
    useRenderFailures: useValue(new Map()),
    useLoaded: useValue([]),
    onApprove: vi.fn(), onDecline: vi.fn(), onRun: vi.fn(), onRemove: vi.fn(),
  } satisfies Pick<CordisPanelProps,
    'wide' | 't' | 'onRefresh' | 'onStop' | 'useSessions' | 'useActiveRuns' | 'useRunErrors'
    | 'useRenderFailures' | 'useLoaded' | 'onApprove' | 'onDecline' | 'onRun' | 'onRemove'>
  const subscribe = (listener: () => void) => inventory.subscribe(listener)
  const getSnapshot = () => inventory.getSnapshot()
  function Panel() {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot)
    const panelProps = { ...props, useInventory: useValue(snapshot) } as CordisPanelProps
    return <CordisPanel {...panelProps} />
  }
  return { ...render(<Panel />), inventory, read, onRefresh, onStop }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Cordis inventory recovery', () => {
  it.each([true, false])('keeps recovery reachable after an initial empty read failure fades (wide=%s)', async (wide) => {
    vi.useFakeTimers()
    let fail = true
    const ui = mount(async () => {
      if (fail) throw new Error('socket closed')
      return [ROW]
    }, wide)
    await settle()
    expect(ui.inventory.getSnapshot()).toMatchObject({ rows: [], read: false, error: 'socket closed' })
    expect(ui.getByRole('alert').textContent).toContain('socket closed')
    act(() => { vi.advanceTimersByTime(6_000) })
    expect(ui.queryByRole('alert')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(ui.queryByRole('alert')).toBeNull()

    const trigger = ui.getByRole('button', { name: en['panel.plugins.aria'] })
    fireEvent.click(trigger)
    await settle()
    const panel = ui.getByRole('region', { name: en['panel.title'] })
    expect(panel.textContent).toContain('Reading the plugin inventory failed: socket closed')
    expect(within(panel).queryByText(en['panel.empty'])).toBeNull()
    act(() => { vi.advanceTimersByTime(7_000) })
    expect(ui.queryByRole('alert')).toBeNull()
    const retry = within(panel).getByRole('button', { name: en['action.retry'] })
    expect(retry).toHaveProperty('disabled', false)
    const previousReads = ui.read.mock.calls.length
    fail = false
    fireEvent.click(retry)
    await settle()
    expect(ui.read).toHaveBeenCalledTimes(previousReads + 1)
    expect(ui.inventory.getSnapshot()).toMatchObject({ rows: [ROW], read: true })
    expect(ui.inventory.getSnapshot().error).toBeUndefined()
    expect(within(panel).queryByRole('button', { name: en['action.retry'] })).toBeNull()
    expect(panel.textContent).toContain('Clock')
    fireEvent.click(within(panel).getByRole('button', { name: en['action.stop'] }))
    await settle()
    expect(ui.onStop).toHaveBeenCalledExactlyOnceWith(SESSION, PLUGIN)
  })

  it('keeps cached live controls and retry after a later inventory read fails', async () => {
    vi.useFakeTimers()
    let fail = false
    const ui = mount(async () => {
      if (fail) throw new Error('connection lost')
      return [ROW]
    })
    await settle()
    fireEvent.click(ui.getByRole('button', { name: en['panel.plugins.aria'] }))
    await settle()
    fail = true
    act(() => { ui.inventory.refresh() })
    await settle()
    act(() => { vi.advanceTimersByTime(7_000) })
    expect(ui.queryByRole('alert')).toBeNull()
    const panel = ui.getByRole('region', { name: en['panel.title'] })
    expect(panel.textContent).toContain('connection lost')
    expect(panel.textContent).toContain('Clock')
    expect(within(panel).getByRole('button', { name: en['action.retry'] })).toHaveProperty('disabled', false)
    expect(within(panel).getByRole('button', { name: en['action.stop'] })).toHaveProperty('disabled', false)
    expect(within(panel).getByRole('button', { name: en['action.remove'] })).toHaveProperty('disabled', false)
  })

  it('removes its recovery notice and panel when the footer contribution unmounts', async () => {
    vi.useFakeTimers()
    const ui = mount(async () => { throw new Error('socket closed') })
    await settle()
    fireEvent.click(ui.getByRole('button', { name: en['panel.plugins.aria'] }))
    await settle()
    expect(ui.queryByRole('alert')).not.toBeNull()
    expect(ui.queryByRole('region', { name: en['panel.title'] })).not.toBeNull()
    ui.unmount()
    await settle()
    act(() => { vi.advanceTimersByTime(7_000) })
    expect(ui.queryByRole('alert')).toBeNull()
    expect(ui.queryByRole('region', { name: en['panel.title'] })).toBeNull()
    expect(document.querySelector('[data-dsh-toast-stack]')).toBeNull()
  })
})
