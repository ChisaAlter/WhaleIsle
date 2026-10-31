/**
 * Rows far from the reader skip style, layout and paint of their contents.
 *
 * Every style recalculation and layout pass costs in proportion to the whole transcript, however
 * little changed: sending into a long transcript restyled and relaid out about every element of it
 * (hundreds of milliseconds at 20k nodes), and the tail follow forces such a layout per call. A row
 * more than three screens from the viewport is marked `data-chat-cold`, which the stylesheet turns
 * into `content-visibility: auto` with the row's last measured height as its intrinsic size, so the
 * transcript keeps its exact length and scroll positions. Rows within two screens, the newest rows,
 * and rows holding focus are never marked, so everything the reader can see or reach with a short
 * scroll is laid out and painted exactly as before (paint containment would clip an action row that
 * hangs a few pixels outside its row). The thresholds differ so a row on the boundary does not flap.
 */

/** Attribute the stylesheet keys the skipping on. */
export const COLD_ATTRIBUTE = 'data-chat-cold'
/** Registered, non-inherited property carrying the row's last measured height. */
export const COLD_HEIGHT_PROPERTY = '--dsh-chat-cold-height'
/** A cold row warms up when it comes within this distance of the viewport. */
const WARM_MARGIN = '200% 0px 200% 0px'
/** A warm row goes cold beyond this distance. */
const COLD_MARGIN = '300% 0px 300% 0px'
/** The newest rows grow and re-key during a run, and the tail follow reads them. */
const WARM_TAIL = 4

/** Owns the cold marking of one Chat scrollport's rows. */
export class ColdRows {
  private warmObserver: IntersectionObserver | null = null
  private coldObserver: IntersectionObserver | null = null
  private mutations: MutationObserver | null = null
  private column: HTMLElement | null = null
  private readonly watched = new WeakSet<Element>()

  /**
   * Start marking rows of a column.
   * @param scroller - the scrollport the rows are measured against.
   * @param column - the Chat column; its flow anchor holds the rows as direct children.
   */
  attach(scroller: HTMLElement, column: HTMLElement): void {
    this.detach()
    if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return
    this.column = column
    this.warmObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) entry.target.removeAttribute(COLD_ATTRIBUTE)
    }, { root: scroller, rootMargin: WARM_MARGIN })
    this.coldObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) this.chill(entry.target as HTMLElement, entry.boundingClientRect.height)
      }
    }, { root: scroller, rootMargin: COLD_MARGIN })
    this.mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node instanceof Element) this.forget(node)
        }
      }
      this.scan()
    })
    this.mutations.observe(column, { childList: true })
    this.scan()
  }

  /** Stop marking, and give every row back to normal layout. */
  detach(): void {
    this.warmObserver?.disconnect()
    this.coldObserver?.disconnect()
    this.mutations?.disconnect()
    this.warmObserver = null
    this.coldObserver = null
    this.mutations = null
    const column = this.column
    this.column = null
    if (column === null) return
    for (const row of column.querySelectorAll<HTMLElement>(`[${COLD_ATTRIBUTE}]`)) {
      row.removeAttribute(COLD_ATTRIBUTE)
      row.style.removeProperty(COLD_HEIGHT_PROPERTY)
    }
  }

  /** The anchor that holds the rows; the column itself when the flow slot renders no anchor. */
  private flow(): Element | null {
    return this.column?.querySelector(':scope > [data-slot="conversation.chat.flow"]') ?? this.column
  }

  /** Observe rows that appeared, and follow the anchor if the slot swapped it. */
  private scan(): void {
    const flow = this.flow()
    if (flow === null || this.warmObserver === null || this.coldObserver === null) return
    if (flow !== this.column) this.mutations?.observe(flow, { childList: true })
    for (const row of flow.children) {
      if (!row.hasAttribute('data-chat-flow-key') || this.watched.has(row)) continue
      this.watched.add(row)
      this.warmObserver.observe(row)
      this.coldObserver.observe(row)
    }
  }

  /** @param node - a removed node (and anything that carried rows inside it). */
  private forget(node: Element): void {
    this.warmObserver?.unobserve(node)
    this.coldObserver?.unobserve(node)
    this.watched.delete(node)
  }

  /**
   * Mark one row cold, remembering its height first so the transcript keeps its length.
   * @param row - a row beyond the cold margin.
   * @param height - the row's measured height.
   */
  private chill(row: HTMLElement, height: number): void {
    if (row.hasAttribute(COLD_ATTRIBUTE) || !row.isConnected || row.hidden) return
    // A fold in progress and the reader's focus both need the row laid out.
    if (row.hasAttribute('data-chat-motion') || row.contains(document.activeElement)) return
    let following = 0
    for (let next = row.nextElementSibling; next !== null && following < WARM_TAIL; next = next.nextElementSibling) following++
    if (following < WARM_TAIL) return
    // The intrinsic size stands in for the content box, so padding and borders come off the border-box height. Heights
    // are layout units (1/64 px) and are written whole: a rounded copy would drift the transcript by a fraction per row.
    const style = getComputedStyle(row)
    const frame = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, property) => sum + (Number.parseFloat(style[property as 'paddingTop']) || 0), 0)
    const content = height - frame
    if (content > 0) row.style.setProperty(COLD_HEIGHT_PROPERTY, `${String(content)}px`)
    row.setAttribute(COLD_ATTRIBUTE, '')
  }
}
