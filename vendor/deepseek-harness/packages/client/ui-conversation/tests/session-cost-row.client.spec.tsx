// @vitest-environment jsdom
// Session-cost half of the PeakValleyRow: the cost switch gates the whole
// row (phase + figure), same-line layout, the phase tooltip, the reminder
// that names where prices are set (the row owns no price entry — the one
// editor lives on the usage-stats settings page), live repricing when the
// projection or the price record moves, and the click-opened cost card: its
// per-route consumption blocks, the delegation tree folded into one row per
// route plus one disclosure, and its dismiss behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState, SessionProjectionMap, SessionSummary, UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BilledUsageBuckets, BilledUsageProjection, ModelBilledUsage } from '@deepseek-ai/dsh-token-meter/client'
import { PeakValleyRow, type PeakValleyRowProps } from '../src/client/chat/PeakValleyRow.tsx'
import type { ComposerModelFact } from '../src/client/input/model-facts.ts'
import type { SessionCostPrices } from '../src/submission-settings.ts'
import { en } from '../src/client/locales.ts'

// Mirrors the real lookup chain (conversation namespace, then common).
const tEn = makeTranslate(en, commonEn)

const ZERO: BilledUsageBuckets = { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }

const ZERO_USAGE: BilledUsageProjection = {
  peak: ZERO,
  offPeak: ZERO,
  models: [],
}

const SESSION = SessionId('session-current')
const CHILD = SessionId('session-child')
const GRANDCHILD = SessionId('session-grandchild')
const OTHER_SESSION = SessionId('session-other')

/** One billed route row: peak buckets plus zero off-peak buckets. */
const routeRow = (
  provider: string,
  model: string,
  peak: BilledUsageBuckets,
): ModelBilledUsage => ({ provider, model, peak, offPeak: ZERO })

/** A projection whose session totals are the sum of its route rows. */
const usageOf = (...models: ModelBilledUsage[]): BilledUsageProjection => ({
  peak: models.reduce((sum, row) => ({
    missInputTokens: sum.missInputTokens + row.peak.missInputTokens,
    cacheReadTokens: sum.cacheReadTokens + row.peak.cacheReadTokens,
    outputTokens: sum.outputTokens + row.peak.outputTokens,
  }), ZERO),
  offPeak: ZERO,
  models,
})

/** One million-token cache-miss sample on the official flash column (¥3.00). */
const FLASH_SAMPLE: BilledUsageProjection = usageOf(
  routeRow('deepseek-official', 'deepseek-v4-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }),
)

type CatalogEntry = SessionProjectionMap['subagentCatalog'][number]

/** One listed Session row; subagent rows carry their parent and their own usage. */
function listedRow(opts: {
  id: SessionId
  parentId?: SessionId
  origin?: 'subagent'
  displayTitle?: string
  usage?: BilledUsageProjection
}): SessionSummary {
  return {
    id: opts.id,
    displayTitle: opts.displayTitle ?? String(opts.id),
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
    ...(opts.parentId === undefined ? {} : { parentId: opts.parentId }),
    ...(opts.origin === undefined ? {} : { origin: opts.origin }),
    ...(opts.usage === undefined ? {} : { projectionValues: { billedUsage: opts.usage } }),
  }
}

/** A list carrying the current Session plus the given rows. */
function listOf(...rows: readonly SessionSummary[]): SessionListState {
  return {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready',
    projectionsBySession: {},
  }
}

/** Children of the current Session, in order, each billed the same usage. */
function childrenOf(count: number, usage: BilledUsageProjection): SessionSummary[] {
  return Array.from({ length: count }, (_unused, index) => listedRow({
    id: SessionId(`session-child-${index + 1}`),
    parentId: SESSION,
    origin: 'subagent',
    displayTitle: `child-${String(index + 1).padStart(2, '0')}`,
    usage,
  }))
}

/** A parent's loaded catalog, which is what names a direct child in the card. */
function withCatalog(parent: SessionId, list: SessionListState, ...entries: readonly CatalogEntry[]): SessionListState {
  return { ...list, projectionsBySession: { ...list.projectionsBySession, [parent]: { values: { subagentCatalog: [...entries] }, state: 'ready', error: null } } }
}

type ChatSlice = { legacy: { nodes: readonly { kind: string; provenance?: { provider: string; model: string } }[] } }

/** Minimal chat-snapshot stub whose legacy nodes the row reads. */
function snapshotWithNodes(nodes: ChatSlice['legacy']['nodes']): ChatSlice {
  return { legacy: { nodes } }
}

/** One settled assistant node carrying durable provenance. */
function assistantNode(model: string | undefined): ChatSlice['legacy']['nodes'][number] {
  return {
    kind: 'assistant',
    ...(model === undefined ? {} : { provenance: { provider: 'deepseek-official', model } }),
  }
}

function bindProjection(
  store: SnapshotStore<BilledUsageProjection | undefined>,
): UseProjection {
  // The renderer binds projection faces through useSyncExternalStore; the stub
  // mirrors that so store writes re-render the row under test.
  const subscribe = (onStoreChange: () => void) => store.subscribe(onStoreChange)
  return ((key: string) => {
    if (key !== 'billedUsage') return undefined
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- stable per mount, called unconditionally by the row
    return useSyncExternalStore(subscribe, () => store.getSnapshot())
  }) as UseProjection
}

function mount(opts: {
  peakValley?: boolean
  provider?: string | null
  model?: string | null
  sessionCost?: boolean
  prices?: SessionCostPrices
  usage?: BilledUsageProjection | undefined
  projection?: UseProjection
  list?: SessionListState
  sessionId?: SessionId
  t?: PeakValleyRowProps['t']
} = {}) {
  const peakStore = createSnapshotStore(opts.peakValley ?? false)
  const factStore = createSnapshotStore<ComposerModelFact>({ provider: opts.provider ?? null })
  const nodesStore = createSnapshotStore(
    snapshotWithNodes(opts.model === undefined || opts.model === null ? [] : [assistantNode(opts.model)]),
  )
  const costStore = createSnapshotStore(opts.sessionCost ?? false)
  const pricesStore = createSnapshotStore<SessionCostPrices>(opts.prices ?? {})
  const usageStore = createSnapshotStore<BilledUsageProjection | undefined>(opts.usage ?? ZERO_USAGE)
  const listStore = createSnapshotStore<SessionListState>(opts.list ?? listOf())
  const projection = opts.projection ?? bindProjection(usageStore)
  const view = render(<PeakValleyRow
    usePeakValley={bindSnapshotSelector(peakStore)}
    useModelProvider={bindSnapshotSelector(factStore)}
    useChat={bindSnapshotSelector(nodesStore)}
    useSessionCost={bindSnapshotSelector(costStore)}
    useCostPrices={bindSnapshotSelector(pricesStore)}
    useProjection={projection}
    sessionId={opts.sessionId ?? SESSION}
    useSessions={bindSnapshotSelector(listStore)}
    t={opts.t ?? tEn}
  />)
  return {
    view,
    setPeakValley: (value: boolean) => act(() => { peakStore.set(value) }),
    setProvider: (provider: string | null) => act(() => { factStore.set({ provider }) }),
    setSessionCost: (value: boolean) => act(() => { costStore.set(value) }),
    setPrices: (value: SessionCostPrices) => act(() => { pricesStore.set(value) }),
    setUsage: (value: BilledUsageProjection | undefined) => act(() => { usageStore.set(value) }),
    setList: (value: SessionListState) => act(() => { listStore.set(value) }),
  }
}

type Mounted = ReturnType<typeof mount>

const rowOf = (view: Mounted): HTMLElement | null =>
  view.view.container.querySelector('[data-phase]')

/** The cost figure: the card's trigger, and the row's only control. */
function triggerOf(view: Mounted): HTMLElement {
  const trigger = view.view.container.querySelector<HTMLElement>('button[aria-haspopup="dialog"]')
  if (trigger === null) throw new Error('the row rendered no cost trigger')
  return trigger
}

/** The card's rendered text; the portaled panel is the dialog role. */
const cardText = (): string => screen.getByRole('dialog').textContent ?? ''

/** Open the card through the trigger and hand back both ends. */
function openCard(view: Mounted): { trigger: HTMLElement; dialog: HTMLElement; text: string } {
  const trigger = triggerOf(view)
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog')
  return { trigger, dialog, text: dialog.textContent ?? '' }
}

/** The card's one route block per billed route, in render order. */
const routeRows = (): HTMLElement[] =>
  [...screen.getByRole('dialog').querySelectorAll<HTMLElement>('[data-session-cost-route]')]

/** The delegation disclosure row, the card's only expandable control. */
function disclosureOf(): HTMLElement {
  const row = screen.getByRole('dialog').querySelector<HTMLElement>('[data-disclosure-row]')
  if (row === null) throw new Error('the card rendered no subagent disclosure')
  return row
}

/** The card's stylesheet with comments stripped, for the declarations jsdom cannot exercise. */
const cardCss = readFileSync(
  resolve(process.cwd(), 'packages/client/ui-conversation/src/client/chat/SessionCostCard.module.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ')

/** One card rule's declarations by selector. */
function cssDeclarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(cardCss)
  if (rule === null) throw new Error(`SessionCostCard.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

beforeEach(() => {
  vi.useFakeTimers()
  // Beijing Monday 2026-03-02 10:00 — peak, so the phase half is stable.
  vi.setSystemTime(new Date(Date.UTC(2026, 2, 2, 2, 0, 0, 0)))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('session cost trigger matrix', () => {
  it('hides the whole row while the session-cost switch is off, even on a DeepSeek route', () => {
    const view = mount({ provider: 'deepseek-official' })
    expect(rowOf(view)).toBeNull()
    expect(screen.queryByText('Session cost: ¥0.00')).toBeNull()
    expect(screen.queryByText('Peak hours')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the set-price reminder for an unnamed model on a non-DeepSeek route', () => {
    // Billed tokens exist but no price record names the route: the row names
    // the missing price instead of hiding or showing a figure.
    const view = mount({
      provider: 'anthropic-relay',
      sessionCost: true,
      usage: usageOf(routeRow('anthropic-relay', '', { missInputTokens: 100, cacheReadTokens: 0, outputTokens: 10 })),
    })
    const reminder = screen.getByText('No price set for the current model')
    expect(reminder).toBeTruthy()
    expect(screen.queryByText(/Session cost:/)).toBeNull()
    // The reminder is the card's trigger too: the missing price is exactly
    // where the reader needs the path to the one price editor.
    expect(triggerOf(view)).toBe(reminder)
  })

  it('shows the cost for a user-priced model even on a non-DeepSeek route', () => {
    // The user priced this relay model, so the figure is meaningful without a
    // DeepSeek route; the phase half stays hidden (no route, preference off)
    // and the row paints the cost alone. The card names the billed route, its
    // own cost and consumption, and its peak prices (no idle line for a
    // non-official model).
    const view = mount({
      provider: 'anthropic-relay',
      model: 'my-relay',
      sessionCost: true,
      prices: { 'my-relay': { inputCacheHit: 0, inputCacheMiss: 1, output: 0 } },
      usage: usageOf(routeRow('anthropic-relay', 'my-relay', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 })),
    })
    expect(screen.getByText('Session cost: ¥1.00')).toBeTruthy()
    expect(screen.queryByText('Peak hours')).toBeNull()
    const card = openCard(view)
    expect(card.dialog.getAttribute('aria-label')).toBe('Session cost')
    expect(card.text).toBe(
      'Session cost¥1.00'
      + 'anthropic-relay/my-relay'
      + 'Cost ¥1.00'
      + 'Peak hit 0 (0%) · miss 1M · output 0'
      + 'Off-peak hit 0 · miss 0 · output 0'
      + 'Price: hit 0 / miss 1 / output 0 (CNY per million tokens)',
    )
  })

  it('names an unpriced default-column model and its card says no price is set', () => {
    // DeepSeek route, but the billed model is not in the official table and
    // has no user price: the segment reminds instead of showing a guessed
    // figure, and the card names the route and says no price is set — while
    // still printing the tokens that route actually moved, because "this model
    // ran and is not priced" is the fact the reader needs — and ends with
    // where the price is set: the usage-stats settings page, not this row.
    const view = mount({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      sessionCost: true,
      usage: usageOf(routeRow('deepseek-official', 'deepseek-chat', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 })),
    })
    expect(screen.getByText('No price set for the current model')).toBeTruthy()
    expect(screen.queryByText(/Session cost:/)).toBeNull()
    const card = openCard(view)
    // The total never claims ¥0.00 for tokens nothing could price.
    expect(card.text).toBe(
      'Session cost' + en['sessionCost.priceTitle.none']
      + 'deepseek-official/deepseek-chat'
      + 'No price set'
      + 'Peak hit 0 (0%) · miss 1M · output 0'
      + 'Off-peak hit 0 · miss 0 · output 0'
      + en['sessionCost.noPriceHint'],
    )
    expect(card.text.endsWith(en['sessionCost.noPriceHint'])).toBe(true)
  })

  it('lists both periods in the card for an official model', () => {
    const view = mount({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      sessionCost: true,
      usage: ZERO_USAGE,
    })
    expect(screen.getByText('Session cost: ¥0.00')).toBeTruthy()
    const card = openCard(view)
    // Nothing billed yet: the one block describes the route about to be billed.
    expect(card.text).toBe(
      'Session cost¥0.00'
      + 'deepseek-official/deepseek-v4-pro'
      + 'Peak: hit 0.3 / miss 9 / output 27 (CNY per million tokens)'
      + 'Off-peak: hit 0.15 / miss 4.5 / output 13.5 (CNY per million tokens)',
    )
  })

  it('paints the cost when the switch is on and a DeepSeek route is detected', () => {
    mount({ provider: 'deepseek', model: 'deepseek-v4-flash', sessionCost: true })
    expect(screen.getByText('Session cost: ¥0.00')).toBeTruthy()
  })

  it('keeps the cost visible with the phase switch off, in neutral period colors', () => {
    const view = mount({ provider: 'deepseek-official', sessionCost: true })
    const row = rowOf(view)
    expect(row).not.toBeNull()
    // Peak phase is present for the schedule readout, but the preference is
    // off, so no phase coloring is requested.
    expect(row?.getAttribute('data-phase')).toBe('peak')
    expect(row?.hasAttribute('data-phase-color')).toBe(false)
  })

  it('colors the period only while the peak/valley preference is on', () => {
    const view = mount({ provider: 'deepseek-official', sessionCost: true, peakValley: true })
    expect(rowOf(view)?.hasAttribute('data-phase-color')).toBe(true)
  })

  it('drops the phase half with the cost switch, even when the peak/valley preference is on', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true })
    view.setSessionCost(false)
    expect(rowOf(view)).toBeNull()
    view.setPeakValley(true)
    expect(rowOf(view)).toBeNull()
    view.setSessionCost(true)
    expect(rowOf(view)).not.toBeNull()
    expect(screen.getByText('Session cost: ¥0.00')).toBeTruthy()
    expect(screen.getByText('Peak hours')).toBeTruthy()
  })

  it('paints no cost without the projection seat even when the switch is on', () => {
    const view = mount({ provider: 'deepseek', sessionCost: true, projection: (() => undefined) as UseProjection })
    // An absent billedUsage key means the host unit is not composed; a
    // fabricated ¥0.00 would be worse than no figure, and no set-price
    // reminder is owed for a figure the host never reported.
    expect(rowOf(view)).not.toBeNull()
    expect(screen.queryByText(/Session cost:/)).toBeNull()
    expect(screen.queryByText('No price set for the current model')).toBeNull()
    expect(view.view.container.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('cost card open, dismiss, and focus', () => {
  it('opens on a click, closes on a second click, and reports both through aria-expanded', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true })
    const trigger = triggerOf(view)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('hangs the card above the trigger by the height of the panel it rendered', () => {
    // jsdom reports zero offset sizes, so no other case here can tell a
    // placement measured before the panel existed from one measured after: with
    // height 0 the hook pins the card by its TOP edge 8px above the trigger and
    // the card grows downward over the composer. Pin a real trigger rect and a
    // real panel height, then read the invariant the placement owes — the card's
    // top is triggerTop − gap − height. Both spies are restored by afterEach.
    const triggerRect = {
      x: 100, y: 600, top: 600, bottom: 620, left: 100, right: 200, width: 100, height: 20,
      toJSON: () => ({}),
    } as DOMRect
    const panelHeight = 120
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(triggerRect)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(panelHeight)
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true })
    openCard(view)
    // 600 − 8 (gap) − 120 (measured panel) = 472; a placement taken one commit
    // early reads the absent panel as 0 and yields 592.
    expect(screen.getByRole('dialog').style.top).toBe('472px')
  })

  it('opens from the keyboard with Enter and Space', () => {
    // A real button plus the explicit key handler: the handler cancels the
    // browser's own activation so a keypress toggles exactly once.
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true })
    const trigger = triggerOf(view)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on Escape and hands the keyboard back to the trigger', () => {
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      usage: FLASH_SAMPLE,
      list: listOf(listedRow({ id: SESSION }), listedRow({
        id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'Docs relay', usage: FLASH_SAMPLE,
      })),
    })
    const { trigger } = openCard(view)
    // Focus inside the portaled panel: Escape must not leave it on a node the
    // close unmounts.
    disclosureOf().focus()
    expect(document.activeElement).toBe(disclosureOf())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    // The close nulls the placement while the passage tree is still mounted, so
    // the exiting panel keeps the hidden measure style instead of repainting a
    // card at the wrong edge for the length of the fade.
    expect(document.querySelector<HTMLElement>('[role="dialog"]')?.style.visibility).toBe('hidden')
  })

  it('closes on an outside pointerdown and keeps the card on a press inside it', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true })
    openCard(view)
    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('carries no native title on the figure or anywhere above it', () => {
    // The card is the detail surface: a leftover native tooltip would fire
    // beside it. The schedule hint moved onto the phase group for the same
    // reason — an ancestor's title applies to the figure too.
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true, peakValley: true })
    const trigger = triggerOf(view)
    expect(trigger.hasAttribute('title')).toBe(false)
    expect(rowOf(view)?.hasAttribute('title')).toBe(false)
    expect(view.view.container.querySelector('[class*="phaseGroup"]')?.getAttribute('title'))
      .toBe(en['peakValley.hint.peak'])
  })
})

describe('session cost figure and same-line layout', () => {
  it('shows the phase text and the cost on the same row element', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true, peakValley: true })
    const row = rowOf(view)!
    expect(row.textContent).toContain('Peak hours')
    expect(row.textContent).toContain('Switches in')
    expect(row.textContent).toContain('Session cost:')
    // Same line: the trigger is a child of the row div, not a sibling block.
    expect(row.querySelector('[class*="cost"]')).not.toBeNull()
  })

  it('prices the projected usage with the billed route column', () => {
    mount({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      sessionCost: true,
      usage: usageOf(routeRow('deepseek-official', 'deepseek-v4-pro', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 })),
    })
    // v4-pro miss input at 9.0 CNY/M peak = 9.00 CNY.
    expect(screen.getByText('Session cost: ¥9.00')).toBeTruthy()
  })

  it('prices every route of a multi-model conversation at its own column', () => {
    // The reported defect: a session that ran a relay model and then an
    // official one used to bill ALL tokens at the newest model's column (and
    // to report "no price set" whenever that newest model was the unpriced
    // one). Each route now bills at its own resolved column, and the card
    // reports each route's own cost, consumption, and columns.
    const usage = usageOf(
      routeRow('relay', 'glm-5.3-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }),
      routeRow('deepseek-official', 'deepseek-v4-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }),
    )
    const view = mount({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionCost: true,
      prices: { 'relay/glm-5.3-flash': { inputCacheHit: 0, inputCacheMiss: 1, output: 0 } },
      usage,
    })
    // 1,000,000 relay miss at 1.0 CNY/M (100 fen) + official flash at 3.0 (300 fen).
    expect(screen.getByText('Session cost: ¥4.00')).toBeTruthy()
    const card = openCard(view)
    expect(card.text).toBe(
      'Session cost¥4.00'
      + 'relay/glm-5.3-flash'
      + 'Cost ¥1.00'
      + 'Peak hit 0 (0%) · miss 1M · output 0'
      + 'Off-peak hit 0 · miss 0 · output 0'
      + 'Price: hit 0 / miss 1 / output 0 (CNY per million tokens)'
      + 'deepseek-official/deepseek-v4-flash'
      + 'Cost ¥3.00'
      + 'Peak hit 0 (0%) · miss 1M · output 0'
      + 'Off-peak hit 0 · miss 0 · output 0'
      + 'Peak: hit 0.1 / miss 3 / output 9 (CNY per million tokens)'
      + 'Off-peak: hit 0.05 / miss 1.5 / output 4.5 (CNY per million tokens)',
    )
    expect(routeRows()).toHaveLength(2)
  })

  it('prints an unpriced route next to a priced one, tokens included', () => {
    // The mixed-session case end to end: the unpriced route contributes no
    // money, keeps its own tokens, and its block carries the no-price notice
    // with no invented price line; the priced route keeps its own block. The
    // card also carries the path to the one price editor.
    const usage = usageOf(
      routeRow('relay', 'glm-5.3-flash', { missInputTokens: 12_240, cacheReadTokens: 3_000, outputTokens: 517 }),
      routeRow('deepseek-official', 'deepseek-v4-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }),
    )
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true, usage })
    expect(screen.getByText('Session cost: ¥3.00 (some models unpriced)')).toBeTruthy()
    const card = openCard(view)
    expect(card.text).toBe(
      'Session cost¥3.00' + en['sessionCost.partialNote']
      + 'relay/glm-5.3-flash'
      + 'No price set'
      + 'Peak hit 3K (20%) · miss 12.2K · output 517'
      + 'Off-peak hit 0 · miss 0 · output 0'
      + 'deepseek-official/deepseek-v4-flash'
      + 'Cost ¥3.00'
      + 'Peak hit 0 (0%) · miss 1M · output 0'
      + 'Off-peak hit 0 · miss 0 · output 0'
      + 'Peak: hit 0.1 / miss 3 / output 9 (CNY per million tokens)'
      + 'Off-peak: hit 0.05 / miss 1.5 / output 4.5 (CNY per million tokens)'
      + en['sessionCost.noPriceHint'],
    )
  })

  it('marks the figure when only some billed routes carry a price', () => {
    const usage = usageOf(
      routeRow('relay', 'glm-5.3-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }),
      routeRow('deepseek-official', 'deepseek-v4-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }),
    )
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true, usage })
    expect(screen.getByText('Session cost: ¥3.00 (some models unpriced)')).toBeTruthy()
    openCard(view)
    expect(cardText()).toContain('relay/glm-5.3-flashNo price set')
  })

  it('reprices live when the usage projection moves (incremental host fold)', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true })
    expect(screen.getByText('Session cost: ¥0.00')).toBeTruthy()
    view.setUsage(FLASH_SAMPLE)
    expect(screen.getByText('Session cost: ¥3.00')).toBeTruthy()
  })

  it('keeps an open card live through a sample and a price edit', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true })
    openCard(view)
    // Nothing billed yet: the card describes the route about to be billed.
    expect(cardText()).toContain('Session cost¥0.00')
    expect(cardText()).toContain('Peak: hit 0.1 / miss 3 / output 9 (CNY per million tokens)')
    view.setUsage(FLASH_SAMPLE)
    expect(cardText()).toContain('Session cost¥3.00')
    expect(cardText()).toContain('Cost ¥3.00')
    view.setPrices({ 'deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 1, output: 9 } })
    expect(cardText()).toContain('Cost ¥1.00')
  })

  it('reprices live when a custom price is saved', () => {
    const view = mount({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionCost: true,
      usage: usageOf(routeRow('deepseek-official', 'deepseek-v4-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 })),
    })
    expect(screen.getByText('Session cost: ¥3.00')).toBeTruthy()
    view.setPrices({ 'deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 1, output: 9 } })
    expect(screen.getByText('Session cost: ¥1.00')).toBeTruthy()
  })
})

describe('delegated subagent consumption', () => {
  const currentUsage = FLASH_SAMPLE
  const childUsage = FLASH_SAMPLE

  it('merges one model billed by the session and a child into a single route row', () => {
    // The card lists one row per (provider, model): a model the parent and the
    // child both billed is ONE row whose tokens and cost are the sums, so the
    // header total is exactly the sum of the rows however many children ran.
    const view = mount({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionCost: true,
      usage: currentUsage,
      list: listOf(listedRow({ id: SESSION, displayTitle: 'Current' }), listedRow({
        id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'Docs relay', usage: childUsage,
      })),
    })
    expect(screen.getByText('Session cost: ¥6.00')).toBeTruthy()
    const card = openCard(view)
    expect(routeRows()).toHaveLength(1)
    expect(card.text).toBe(
      'Session cost¥6.00'
      + 'deepseek-official/deepseek-v4-flash'
      + 'Cost ¥6.00'
      + 'Peak hit 0 (0%) · miss 2M · output 0'
      + 'Off-peak hit 0 · miss 0 · output 0'
      + 'Peak: hit 0.1 / miss 3 / output 9 (CNY per million tokens)'
      + 'Off-peak: hit 0.05 / miss 1.5 / output 4.5 (CNY per million tokens)'
      + 'Subagents (1) · Cost ¥3.00 · Hit 0 (0%) · miss 1M · output 0',
    )
  })

  it('folds the delegation tree into one collapsed disclosure row', () => {
    const view = mount({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionCost: true,
      usage: currentUsage,
      list: listOf(listedRow({ id: SESSION, displayTitle: 'Current' }), listedRow({
        id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'Docs relay', usage: childUsage,
      })),
    })
    openCard(view)
    const disclosure = disclosureOf()
    // Collapsed by default: the summary names the count and the subtotal, and
    // nothing per child is rendered yet.
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(disclosure.textContent).toBe('Subagents (1) · Cost ¥3.00 · Hit 0 (0%) · miss 1M · output 0')
    expect(screen.queryByText('Docs relay')).toBeNull()
    expect(cardText()).toContain('Subagents (1) · Cost ¥3.00 · Hit 0 (0%) · miss 1M · output 0')

    // A real control: Enter expands it, and the child line appears.
    fireEvent.keyDown(disclosure, { key: 'Enter' })
    expect(disclosureOf().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Docs relay')).toBeTruthy()
    expect(cardText()).toContain('Cost ¥3.00 · Hit 0 (0%) · miss 1M · output 0')
  })

  it('prefers the parent catalog label over the child list title', () => {
    const listed = listOf(
      listedRow({ id: SESSION }),
      listedRow({ id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'session-child', usage: childUsage }),
    )
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      usage: currentUsage,
      list: withCatalog(SESSION, listed, {
        id: CHILD, createdAt: 0, mode: 'continuable', label: 'Docs relay',
      }),
    })
    openCard(view)
    expect(cardText()).toContain('Subagents (1) · Cost ¥3.00 · Hit 0 (0%) · miss 1M · output 0')
    fireEvent.click(disclosureOf())
    expect(screen.getByText('Docs relay')).toBeTruthy()
    expect(screen.queryByText('session-child')).toBeNull()
  })

  it('folds a grandchild, because a child may delegate again', () => {
    const grandchildUsage = usageOf(routeRow('relay', 'glm-5.3-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }))
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      prices: { 'relay/glm-5.3-flash': { inputCacheHit: 0, inputCacheMiss: 1, output: 0 } },
      usage: currentUsage,
      list: listOf(
        listedRow({ id: SESSION }),
        listedRow({ id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'Docs relay', usage: childUsage }),
        listedRow({ id: GRANDCHILD, parentId: CHILD, origin: 'subagent', displayTitle: 'Sub relay', usage: grandchildUsage }),
      ),
    })
    expect(screen.getByText('Session cost: ¥7.00')).toBeTruthy()
    openCard(view)
    expect(cardText()).toContain('Subagents (2) · Cost ¥4.00 · Hit 0 (0%) · miss 2M · output 0')
    fireEvent.click(disclosureOf())
    expect(cardText()).toContain('Sub relayCost ¥1.00 · Hit 0 (0%) · miss 1M · output 0')
  })

  it('ignores rows that are not descendants of the current Session', () => {
    // A sibling's child, and a plain fork (parent id without the subagent
    // origin), are both outside this Session's delegation tree.
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      usage: currentUsage,
      list: listOf(
        listedRow({ id: SESSION }),
        listedRow({ id: OTHER_SESSION, parentId: SESSION, displayTitle: 'Fork', usage: childUsage }),
        listedRow({ id: CHILD, parentId: OTHER_SESSION, origin: 'subagent', displayTitle: 'Elsewhere', usage: childUsage }),
      ),
    })
    expect(screen.getByText('Session cost: ¥3.00')).toBeTruthy()
    openCard(view)
    expect(cardText()).not.toContain('Subagents')
  })

  it('reports an unpriced child inside the disclosure instead of folding it into the subtotal', () => {
    const unpricedChild = usageOf(routeRow('relay', 'glm-5.3-flash', { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }))
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      usage: currentUsage,
      list: listOf(
        listedRow({ id: SESSION }),
        listedRow({ id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'Docs relay', usage: unpricedChild }),
      ),
    })
    expect(screen.getByText('Session cost: ¥3.00 (some models unpriced)')).toBeTruthy()
    openCard(view)
    // The subtotal prices nothing, so it says so rather than printing ¥0.00.
    expect(cardText()).toContain('Subagents (1) · No price set · Hit 0 (0%) · miss 1M · output 0')
    // The child's own route is reported — tokens, no price — and the card ends
    // with the path to the one price editor.
    expect(cardText()).toContain('relay/glm-5.3-flashNo price setPeak hit 0 (0%) · miss 1M · output 0')
    expect(cardText().endsWith(en['sessionCost.noPriceHint'])).toBe(true)
    fireEvent.click(disclosureOf())
    expect(cardText()).toContain('Docs relayNo price set · Hit 0 (0%) · miss 1M · output 0')
  })

  it('caps the expanded child lines and stays compact for many subagents', () => {
    // Fifty children must not produce a fifty-line card: one route row, one
    // summary row, ten child lines, and an honest remainder.
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      usage: currentUsage,
      list: listOf(listedRow({ id: SESSION }), ...childrenOf(50, childUsage)),
    })
    // 1M + 50M miss on the official flash column = ¥153.00.
    expect(screen.getByText('Session cost: ¥153.00')).toBeTruthy()
    openCard(view)
    expect(routeRows()).toHaveLength(1)
    expect(cardText()).toContain('Subagents (50) · Cost ¥150.00 · Hit 0 (0%) · miss 50M · output 0')
    // Collapsed: not one child line is in the tree.
    expect(screen.queryByText('child-01')).toBeNull()
    expect(screen.getByRole('dialog').querySelectorAll('dt')).toHaveLength(0)

    fireEvent.click(disclosureOf())
    expect(screen.getByText('child-01')).toBeTruthy()
    expect(screen.getByText('child-10')).toBeTruthy()
    expect(screen.queryByText('child-11')).toBeNull()
    expect(screen.getByRole('dialog').querySelectorAll('dt')).toHaveLength(10)
    expect(cardText()).toContain(en['sessionCost.subagent.more'].replace('{count}', '40'))
  })

  it('reprices when the child reports another sample', () => {
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      usage: currentUsage,
      list: listOf(listedRow({ id: SESSION }), listedRow({
        id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'Docs relay', usage: ZERO_USAGE,
      })),
    })
    expect(screen.getByText('Session cost: ¥3.00')).toBeTruthy()
    view.setList(listOf(listedRow({ id: SESSION }), listedRow({
      id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'Docs relay', usage: childUsage,
    })))
    expect(screen.getByText('Session cost: ¥6.00')).toBeTruthy()
  })

  it('leaves the figure on the current Session while the child reports no usage', () => {
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      usage: currentUsage,
      list: listOf(
        listedRow({ id: SESSION }),
        listedRow({ id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'Docs relay' }),
      ),
    })
    expect(screen.getByText('Session cost: ¥3.00')).toBeTruthy()
    openCard(view)
    // Nothing to itemize: a child with no reported usage has no row.
    expect(cardText()).not.toContain('Subagents')
  })

  it('counts nothing while the sessions seat is absent', () => {
    // Hand assembly and older mounts carry no sessions seat: the strip keeps
    // pricing the current Session instead of failing.
    const view = render(<PeakValleyRow
      usePeakValley={bindSnapshotSelector(createSnapshotStore(false))}
      useModelProvider={bindSnapshotSelector(createSnapshotStore<ComposerModelFact>({ provider: 'deepseek-official' }))}
      useSessionCost={bindSnapshotSelector(createSnapshotStore(true))}
      useProjection={bindProjection(createSnapshotStore<BilledUsageProjection | undefined>(currentUsage))}
      t={tEn}
    />)
    expect(screen.getByText('Session cost: ¥3.00')).toBeTruthy()
    const trigger = view.container.querySelector<HTMLElement>('button[aria-haspopup="dialog"]')!
    fireEvent.click(trigger)
    expect(cardText()).toBe(
      'Session cost¥3.00'
      + 'deepseek-official/deepseek-v4-flash'
      + 'Cost ¥3.00'
      + 'Peak hit 0 (0%) · miss 1M · output 0'
      + 'Off-peak hit 0 · miss 0 · output 0'
      + 'Peak: hit 0.1 / miss 3 / output 9 (CNY per million tokens)'
      + 'Off-peak: hit 0.05 / miss 1.5 / output 4.5 (CNY per million tokens)',
    )
  })
})

describe('cache-hit rate lines', () => {
  it('rates each period by its own buckets, never by the combined one', () => {
    // Peak: 100 cache reads of 100 prompt tokens (100%). Off-peak: 100 misses
    // and no read (0%). The combined rate would be 50% — a per-period line that
    // printed it would be answering a question the line does not ask.
    const usage = usageOf({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      peak: { missInputTokens: 0, cacheReadTokens: 100, outputTokens: 0 },
      offPeak: { missInputTokens: 100, cacheReadTokens: 0, outputTokens: 0 },
    })
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true, usage })
    openCard(view)
    expect(cardText()).toContain('Peak hit 100 (100%) · miss 0 · output 0')
    expect(cardText()).toContain('Off-peak hit 0 (0%) · miss 100 · output 0')
  })

  it('omits the parenthetical on a line whose period billed no prompt token', () => {
    // Output-only peak usage: no prompt input, so no rate — the line keeps the
    // three token figures and adds nothing that would read as "0% cached".
    const usage = usageOf({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 900 },
      offPeak: ZERO,
    })
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true, usage })
    openCard(view)
    expect(cardText()).toContain('Peak hit 0 · miss 0 · output 900')
    expect(cardText()).not.toContain('Cache hit')
  })
})

describe('subagent summary line', () => {
  it('keeps the summary affordance after its text, inside the disclosure row', () => {
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      usage: FLASH_SAMPLE,
      list: listOf(listedRow({ id: SESSION }), listedRow({
        id: CHILD, parentId: SESSION, origin: 'subagent', displayTitle: 'Docs relay', usage: FLASH_SAMPLE,
      })),
    })
    openCard(view)
    const row = disclosureOf()
    const title = row.querySelector<HTMLElement>('[class*="subagentTitle"]')
    expect(title?.textContent).toBe('Subagents (1) · Cost ¥3.00 · Hit 0 (0%) · miss 1M · output 0')
    // TextShimmer wraps the content; the affordance must still directly follow
    // the title and finish that content, so only the text gives way when narrow.
    const affordance = title?.nextElementSibling
    expect(row.lastElementChild?.contains(title!)).toBe(true)
    expect(title?.parentElement?.lastElementChild).toBe(affordance)
    expect(affordance?.tagName.toLowerCase()).toBe('svg')
  })

  it('carries the one-line guarantee in CSS, where jsdom cannot lay it out', () => {
    // jsdom reports no layout, so the single-line result is a CSS contract:
    // `white-space: nowrap` is what forbids the second line, `min-width: 0` is
    // what lets the flex item shrink instead of widening the row, and the
    // ellipsis only marks the clipped tail. The affordance must not shrink
    // either, or it would be the thing squeezed out.
    expect(cssDeclarations('.subagent .subagentTitle')).toEqual(expect.arrayContaining([
      'flex: 1 1 auto',
      'min-width: 0',
      'overflow: hidden',
      'text-overflow: ellipsis',
      'white-space: nowrap',
    ]))
    expect(cssDeclarations('.subagentChevron')).toEqual(expect.arrayContaining(['flex: none']))
  })
})

describe('panel sizing', () => {
  it('lets the content drive the width, bounded only by the viewport margin', () => {
    // jsdom has no layout, so the growth is a CSS contract read as text: the
    // panel sizes to its widest row and stops at the 12px viewport margin. The
    // old fixed 440px cap is what clipped a long summary row in an ordinary
    // window, and the child-name column carries no percentage cap because a
    // percentage inside a `max-content` box resolves against the width the
    // content is supposed to decide.
    expect(cssDeclarations('.panel')).toEqual(expect.arrayContaining([
      'width: max-content',
      'min-width: min(300px, calc(100vw - 24px))',
      'max-width: calc(100vw - 24px)',
    ]))
    expect(cardCss).not.toContain('440px')
    expect(cardCss).not.toContain('max-width: 40%')
  })

  it('starts every line on one left edge', () => {
    // The card's only horizontal padding belongs to the panel; the child rows
    // and the overflow line carry none, because the disclosure row's own
    // affordance expresses the nesting and an indent would cost blank space at
    // the front of every line. `padding-left` is asserted absent wholesale: no
    // rule in this sheet may indent a line away from that edge.
    expect(cssDeclarations('.panel')).toEqual(expect.arrayContaining(['padding: 16px']))
    expect(cssDeclarations('.subagentList')).toEqual(expect.arrayContaining(['padding: 4px 0', 'margin: 0']))
    expect(cardCss).not.toContain('padding-left')
    expect(cardCss).not.toContain('22px')
  })

  it('scrolls the row area vertically only, so a wide row cannot become a sideways scrollbar', () => {
    expect(cssDeclarations('.body')).toEqual(expect.arrayContaining(['overflow: hidden auto']))
  })
})

describe('phase tooltip', () => {
  it('shows a hover bubble carrying the same phase and countdown text', () => {
    const view = mount({ provider: 'deepseek-official', sessionCost: true, peakValley: true })
    const phaseGroup = view.view.container.querySelector('[class*="phaseGroup"]')!
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(phaseGroup)
    act(() => { vi.advanceTimersByTime(400) })
    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toContain('Peak hours')
    expect(bubble.textContent).toContain('Switches in 02:00:00')
    fireEvent.mouseLeave(phaseGroup)
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('price entry ownership', () => {
  it('renders no price entry and no price window on any state', () => {
    // Model prices are edited on the usage-stats settings page; the row is a
    // readout, so its only control is the figure that opens the cost card, and
    // no state opens a second window of its own.
    const states: (Parameters<typeof mount>[0])[] = [
      { sessionCost: true },
      { provider: 'deepseek', sessionCost: true },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', sessionCost: true },
      { provider: 'deepseek-official', model: 'deepseek-chat', sessionCost: true },
      {
        provider: 'anthropic-relay',
        sessionCost: true,
        prices: { 'my-relay': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } },
      },
    ]
    for (const state of states) {
      const view = mount(state)
      expect(view.view.container.querySelectorAll('button')).toHaveLength(1)
      expect(triggerOf(view).getAttribute('aria-haspopup')).toBe('dialog')
      expect(screen.queryByRole('dialog')).toBeNull()
      cleanup()
    }
  })
})
