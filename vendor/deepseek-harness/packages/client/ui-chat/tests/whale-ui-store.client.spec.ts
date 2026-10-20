// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWhaleUiStore, type WhalePanelOperation } from '../src/client/chat/whale-ui-store.ts'

beforeEach(() => { localStorage.clear() })

function operation(sourceId: string, seq: number, text: string, append = false, offset = 0): WhalePanelOperation {
  return { sourceId, order: [seq, 0, offset], append, spec: { items: [{ type: 'text', text }] } }
}

function content(instance: ReturnType<ReturnType<typeof createWhaleUiStore>['create']>) {
  return instance.getSnapshot().snapshot?.items
}

describe('Whale UI Session panel store', () => {
  it('restores the folded base before append and blocks exact source replays', () => {
    const first = createWhaleUiStore().create('session-a')
    first.actions.publish(operation('a', 12, 'A'))
    first.actions.collapse(true)
    const second = createWhaleUiStore().create('session-a')
    expect(second.getSnapshot()).toMatchObject({ collapsed: true, lastSeenSeq: 12 })
    second.actions.publish(operation('b', 13, 'B', true))
    expect(content(second)).toEqual([{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }])
    const snapshot = second.getSnapshot()
    second.actions.publish(operation('b', 13, 'B', true))
    second.actions.publish(operation('a', 12, 'A'))
    expect(second.getSnapshot()).toBe(snapshot)
    const third = createWhaleUiStore().create('session-a')
    expect(content(third)).toEqual(content(second))
    third.actions.publish(operation('c', 13, 'C', true, 50))
    expect(content(third)).toEqual([{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }, { type: 'text', text: 'C' }])
    expect(third.getSnapshot().lastSeenSeq).toBe(13)
  })

  it('orders real seq and source offsets deterministically and replaces changed source specs once', () => {
    const store = createWhaleUiStore().create('session-a')
    store.actions.publish(operation('later', 30, 'latest replacement'))
    store.actions.publish(operation('earlier', 12, 'old replacement'))
    store.actions.publish(operation('append', 31, 'first draft', true))
    store.actions.publish(operation('append', 31, 'final draft', true))
    store.actions.publish(operation('same-message', 31, 'later fence', true, 40))
    expect(content(store)).toEqual([{ type: 'text', text: 'latest replacement' },
      { type: 'text', text: 'final draft' }, { type: 'text', text: 'later fence' }])
    expect(store.getSnapshot().operations).toHaveLength(4)
  })

  it('merges same-labelled tabs without discarding tab metadata', () => {
    const store = createWhaleUiStore().create('session-a')
    store.actions.publish({ sourceId: 'a', order: [12, 0, 0], append: false, spec: { title: 'Report', items: [{ type: 'tabs', id: 'reports', tabs: [
      { label: 'A', id: 'tab-a', items: [{ type: 'text', text: 'first' }] },
    ] }] } })
    store.actions.publish({ sourceId: 'b', order: [13, 0, 0], append: true, spec: { items: [{ type: 'tabs', tabs: [
      { label: 'A', items: [{ type: 'text', text: 'second' }] },
      { label: 'B', items: [{ type: 'text', text: 'new tab' }] },
    ] }] } })
    expect(store.getSnapshot().snapshot).toEqual({ title: 'Report', items: [{ type: 'tabs', id: 'reports', tabs: [
      { label: 'A', id: 'tab-a', items: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] },
      { label: 'B', items: [{ type: 'text', text: 'new tab' }] },
    ] }] })
  })

  it('keeps Sessions independent and persists clear barriers before notifying observers', () => {
    const handle = createWhaleUiStore()
    const a = handle.create('session-a')
    const b = handle.create('session-b')
    a.actions.publish(operation('a', 12, 'A'))
    b.actions.publish(operation('b', 14, 'B'))
    const persistedAtNotification: unknown[] = []
    a.subscribe(() => { persistedAtNotification.push(JSON.parse(localStorage.getItem('whale-ui:panel:v2:session-a')!)) })
    a.actions.clear()
    expect(content(a)).toBeUndefined()
    expect(content(b)).toEqual([{ type: 'text', text: 'B' }])
    expect(persistedAtNotification).toEqual([expect.objectContaining({ snapshot: null, barrier: [12, 0, 0] })])
    const restored = createWhaleUiStore().create('session-a')
    restored.actions.publish(operation('a', 12, 'A'))
    expect(content(restored)).toBeUndefined()
    restored.actions.publish(operation('new', 13, 'new panel', true))
    expect(content(restored)).toEqual([{ type: 'text', text: 'new panel' }])
  })

  it('bounds the complete aggregate serialization before persisting or publishing', () => {
    const store = createWhaleUiStore().create('budget')
    const compiled = (spec: unknown) => `root = Col([genui])\ngenui = Genui(${JSON.stringify(spec)})`
    const bare = compiled(operation('exact', 1, '').spec).length
    store.actions.publish(operation('exact', 1, '界'.repeat(262_144 - bare)))
    expect(compiled(store.getSnapshot().snapshot).length).toBe(262_144)
    const before = store.getSnapshot()
    const persisted = localStorage.getItem('whale-ui:panel:v2:budget')
    expect(() => store.actions.publish(operation('too-many', 2, 'x', true))).toThrow('262144 character source limit')
    expect(store.getSnapshot()).toBe(before)
    expect(localStorage.getItem('whale-ui:panel:v2:budget')).toBe(persisted)
  })

  it('contains corrupt storage and rejects persistence failure without publishing an unsaved mutation', () => {
    localStorage.setItem('whale-ui:panel:v2:broken', '{"version":2,"snapshot":false}')
    expect(createWhaleUiStore().create('broken').getSnapshot().restoreError).toContain('unsupported format')
    const store = createWhaleUiStore().create('session-a')
    store.actions.publish(operation('a', 12, 'A'))
    const saved = store.getSnapshot()
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full') })
    try {
      expect(() => store.actions.publish(operation('b', 13, 'B', true))).toThrow('Storage full')
      expect(store.getSnapshot()).toBe(saved)
    } finally { write.mockRestore() }
    expect(() => store.actions.publish(operation('bad', Number.POSITIVE_INFINITY, 'bad'))).toThrow('real Session position')
  })
})
