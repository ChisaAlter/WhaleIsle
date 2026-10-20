import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Real Session sequence followed by text-block index and Markdown source offset. */
export type WhalePanelOrder = readonly [number, number, number]

/** A normalized viewer spec whose identity and order were assigned by the host. */
export interface WhalePanelOperation {
  readonly sourceId: string
  readonly order: WhalePanelOrder
  readonly append: boolean
  readonly spec: Record<string, unknown>
}

/** Session-local presentation state shared by Assistant publishers and the composer dock. */
export interface WhaleUiState {
  readonly snapshot: Record<string, unknown> | null
  readonly base: Record<string, unknown> | null
  readonly barrier: WhalePanelOrder | null
  readonly operations: readonly WhalePanelOperation[]
  readonly lastSeenSeq: number
  readonly collapsed: boolean
  readonly restoreError: string | null
}

type WhaleUiActions = {
  publish: (draft: WhaleUiState, operation: WhalePanelOperation) => void
  collapse: (draft: WhaleUiState, collapsed: boolean) => void
  clear: (draft: WhaleUiState) => void
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isOrder(value: unknown): value is WhalePanelOrder {
  return Array.isArray(value) && value.length === 3
    && value.every((part: unknown) => typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)
}

function compareOrder(left: WhalePanelOrder, right: WhalePanelOrder): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

function empty(): WhaleUiState {
  return { snapshot: null, base: null, barrier: null, operations: [], lastSeenSeq: -1, collapsed: false, restoreError: null }
}

function items(spec: Record<string, unknown>): unknown[] {
  if (!Array.isArray(spec.items)) throw new Error('Whale UI panel items must be an array.')
  return spec.items
}

function tabs(spec: Record<string, unknown>): Record<string, unknown>[] | undefined {
  const content = items(spec)
  const first: unknown = content[0]
  if (content.length !== 1 || !record(first) || first.type !== 'tabs' || !Array.isArray(first.tabs)) return undefined
  return first.tabs.every((tab: unknown) => record(tab) && typeof tab.label === 'string' && Array.isArray(tab.items))
    ? first.tabs as Record<string, unknown>[] : undefined
}

function merge(previous: Record<string, unknown> | null, next: Record<string, unknown>): Record<string, unknown> {
  if (previous === null || items(previous).length === 0) return next
  const left = tabs(previous)
  const right = tabs(next)
  const title = previous.title ?? next.title
  const base = { ...previous, ...(title === undefined ? {} : { title }) }
  if (left === undefined || right === undefined) return { ...base, items: [...items(previous), ...items(next)] }
  const merged: (Record<string, unknown> & { items: unknown[] })[] = left.map(tab => ({ ...tab, items: [...tab.items as unknown[]] }))
  for (const tab of right) {
    const existing = merged.find(candidate => candidate.label === tab.label)
    if (existing === undefined) merged.push({ ...tab, items: [...tab.items as unknown[]] })
    else existing.items.push(...tab.items as unknown[])
  }
  const root = items(previous)[0] as Record<string, unknown>
  return { ...base, items: [{ ...root, tabs: merged }] }
}

// Same complete-source budget as the Whale UI language lexer.
const SOURCE_CHARS = 262_144

function withinBudget(spec: Record<string, unknown> | null): void {
  if (spec !== null && `root = Col([genui])\ngenui = Genui(${JSON.stringify(spec)})`.length > SOURCE_CHARS) {
    throw new Error(`Whale UI panel exceeds the ${SOURCE_CHARS} character source limit.`)
  }
}

function publish(state: WhaleUiState, operation: WhalePanelOperation): WhaleUiState {
  if (!isOrder(operation.order) || operation.sourceId === '') throw new Error('Whale UI panel source has no real Session position.')
  items(operation.spec)
  if (state.barrier !== null && compareOrder(operation.order, state.barrier) <= 0) return state
  const previous = state.operations.find(candidate => candidate.sourceId === operation.sourceId)
  if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(operation)) return state
  const operations = [...state.operations.filter(candidate => candidate.sourceId !== operation.sourceId), operation]
    .sort((left, right) => compareOrder(left.order, right.order) || left.sourceId.localeCompare(right.sourceId))
  let snapshot = state.base
  for (const op of operations) snapshot = op.append ? merge(snapshot, op.spec) : op.spec
  withinBudget(snapshot)
  return { ...state, operations, snapshot, lastSeenSeq: Math.max(state.lastSeenSeq, operation.order[0]), restoreError: null }
}

function highestOrder(state: WhaleUiState): WhalePanelOrder | null {
  return state.operations.at(-1)?.order ?? state.barrier
}

function clear(state: WhaleUiState): WhaleUiState {
  return { ...state, snapshot: null, base: null, barrier: highestOrder(state), operations: [], restoreError: null }
}

function read(key: string): WhaleUiState {
  if (typeof localStorage === 'undefined') return empty()
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return empty()
    const saved: unknown = JSON.parse(raw)
    if (!record(saved) || saved.version !== 2 || (saved.snapshot !== null && !record(saved.snapshot))
      || (saved.barrier !== null && !isOrder(saved.barrier)) || typeof saved.collapsed !== 'boolean'
      || typeof saved.lastSeenSeq !== 'number' || !Number.isSafeInteger(saved.lastSeenSeq) || saved.lastSeenSeq < -1) {
      throw new Error('Saved Whale UI panel has an unsupported format.')
    }
    if (record(saved.snapshot)) { items(saved.snapshot); withinBudget(saved.snapshot) }
    return { snapshot: saved.snapshot, base: saved.snapshot, barrier: saved.barrier, operations: [],
      lastSeenSeq: saved.lastSeenSeq, collapsed: saved.collapsed, restoreError: null }
  } catch (error: unknown) {
    return { ...empty(), restoreError: error instanceof Error ? error.message : String(error) }
  }
}

function persist(key: string, state: WhaleUiState): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, JSON.stringify({ version: 2, snapshot: state.snapshot,
    barrier: highestOrder(state), lastSeenSeq: state.lastSeenSeq, collapsed: state.collapsed }))
}

/**
 * Declare the shared panel store; Slots creates one instance per Session.
 * Mutations persist synchronously before publishing, including collapse and clear.
 * Hydration uses the folded snapshot as the base and blocks replay through its exact last order.
 * @returns a registration handle, shared by the Assistant and dock entries.
 */
export function createWhaleUiStore(): EngineStoreHandle<WhaleUiState, WhaleUiActions> {
  const handle = defineStore({
    init: empty,
    actions: {
      publish: (draft, operation: WhalePanelOperation) => { Object.assign(draft, publish(draft, operation)) },
      collapse: (draft, collapsed: boolean) => { Object.assign(draft, { collapsed }) },
      clear: (draft) => { Object.assign(draft, clear(draft)) },
    },
  })
  return {
    ...handle,
    create(scopeKey?: string) {
      if (scopeKey === undefined) throw new Error('Whale UI panel store requires a Session identity.')
      const key = `whale-ui:panel:v2:${scopeKey}`
      const instance = handle.create(scopeKey)
      instance.store.set(read(key))
      const commit = (next: WhaleUiState): void => {
        if (next === instance.getSnapshot()) return
        persist(key, next)
        instance.store.set(next)
      }
      return { ...instance, actions: {
        publish: operation => { commit(publish(instance.getSnapshot(), operation)) },
        collapse: collapsed => { commit({ ...instance.getSnapshot(), collapsed }) },
        clear: () => { commit(clear(instance.getSnapshot())) },
      } }
    },
  }
}
