// @vitest-environment jsdom
// Session-cost durable settings: the Interface row is the session-cost switch
// alone (the one price editor lives on the usage-stats settings page), the
// policy adopts accepted values, and the schema round-trips the price record
// through the wire envelope shape.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { CostSettingsRow } from '../src/client/settings/CostSettingsRow.tsx'
import type { CostSettingsRowProps } from '../src/client/settings/CostSettingsRow.tsx'
import { ComposerSubmissionPolicy } from '../src/client/input/submission-policy.ts'
import { ConversationSettingsSchema, DEFAULT_SESSION_COST } from '../src/submission-settings.ts'
import type { ConversationSettings } from '../src/submission-settings.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(cleanup)

const unused = (() => { throw new Error('unused by CostSettingsRow') }) as never

function mount(opts: {
  enabled?: boolean
  writable?: boolean
} = {}) {
  const setSessionCost = vi.fn()
  const props: CostSettingsRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unused,
    useSessionCost: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? false)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setSessionCost,
    t: key => key,
  }
  render(<CostSettingsRow {...props} />)
  return { setSessionCost }
}

describe('CostSettingsRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const written = mount()
    const toggle = screen.getByRole('switch', { name: 'settings.sessionCost.title' })
    expect(toggle).toHaveProperty('checked', false)
    fireEvent.click(toggle)
    expect(written.setSessionCost).toHaveBeenCalledWith(true)
    written.setSessionCost.mockClear()
    cleanup()
    mount({ enabled: true, writable: false })
    expect(screen.getByRole('switch', { name: 'settings.sessionCost.title' })).toHaveProperty('disabled', true)
  })

  it('renders the session-cost switch and no price entry of its own', () => {
    mount()
    // The one price editor lives on the usage-stats settings page, so the row
    // carries the switch alone — no button, no window.
    expect(screen.getByRole('switch', { name: 'settings.sessionCost.title' })).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('session-cost policy', () => {
  it('defaults off and publishes live before the durable write', () => {
    const host = {
      subscribe: vi.fn(() => () => {}),
      getSnapshot: vi.fn(() => ({ writable: true, value: undefined })),
      set: vi.fn(async () => {}),
    }
    const policy = new ComposerSubmissionPolicy(host as never)
    expect(policy.sessionCost.getSnapshot()).toBe(DEFAULT_SESSION_COST)
    policy.setSessionCost(true)
    expect(policy.sessionCost.getSnapshot()).toBe(true)
    expect(host.set).toHaveBeenCalledWith('sessionCost', true)
    // Same value is a no-op on both channels.
    policy.setSessionCost(true)
    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('replaces the custom price record durably', () => {
    const host = {
      subscribe: vi.fn(() => () => {}),
      getSnapshot: vi.fn(() => ({ writable: true, value: undefined })),
      set: vi.fn(async () => {}),
    }
    const policy = new ComposerSubmissionPolicy(host as never)
    const prices = { 'my-model': { inputCacheHit: 0.5, inputCacheMiss: 5, output: 15 } }
    policy.setSessionCostPrices(prices)
    expect(policy.sessionCostPrices.getSnapshot()).toBe(prices)
    expect(host.set).toHaveBeenCalledWith('sessionCostPrices', prices)
  })

  it('adopts the accepted document values without writing back', () => {
    let snapshot: { writable: boolean; value?: Record<string, unknown> } = { writable: true }
    const listeners = new Set<() => void>()
    const host = {
      subscribe: vi.fn((fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      }),
      getSnapshot: vi.fn(() => snapshot),
      set: vi.fn(async () => {}),
    }
    const policy = new ComposerSubmissionPolicy(host as never)
    expect(policy.sessionCost.getSnapshot()).toBe(false)
    snapshot = {
      writable: true,
      value: {
        sessionCost: true,
        sessionCostPrices: { 'deepseek-v4-pro': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } },
      },
    }
    for (const listener of listeners) listener()
    expect(policy.sessionCost.getSnapshot()).toBe(true)
    expect(policy.sessionCostPrices.getSnapshot()).toEqual({
      'deepseek-v4-pro': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 },
    })
    expect(host.set).not.toHaveBeenCalled()
  })
})

describe('session-cost settings schema', () => {
  it('defaults both fields and tolerates an absent price record', () => {
    // Runtime accepts an empty section (every defaulted field fills in); the
    // type wants the full shape, so state the emptiness explicitly.
    const value = ConversationSettingsSchema({} as ConversationSettings)
    // The field is optional without a materialized default, so the registered
    // section defaults keep their pre-cost shape; adoption reads absent as off.
    expect(value.sessionCost ?? false).toBe(false)
    // An absent record reads as "no custom prices" whether the schemastery
    // dict materializes an empty object or leaves the key out.
    expect(value.sessionCostPrices ?? {}).toEqual({})
  })

  it('round-trips a custom price record', () => {
    const record = {
      'deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 },
      'my-model': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 },
    }
    const value = ConversationSettingsSchema({
      sessionCost: true,
      sessionCostPrices: record,
    } as unknown as ConversationSettings)
    expect(value.sessionCost).toBe(true)
    expect(value.sessionCostPrices).toEqual(record)
  })
})
