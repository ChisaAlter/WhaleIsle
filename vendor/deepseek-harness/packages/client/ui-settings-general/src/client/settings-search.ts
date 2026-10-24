/**
 * Settings search over rendered pages. Rows are drawn by their owners with
 * no shared row component, so the index reads the DOM: a setting is the
 * smallest block that holds a control or a heading, its title is the first
 * text in that block and its description the next. This covers marketplace
 * plugin pages without asking every row owner for search metadata.
 */

/** One searchable setting. */
export interface SearchEntry {
  sectionId: string
  title: string
  desc: string
}

/** One matched setting with its rank (lower is better). */
export interface SearchHit extends SearchEntry {
  rank: number
}

const CONTROL = 'input, select, textarea, button, [role="switch"], [role="slider"], [role="combobox"], [role="radiogroup"], [role="tablist"]'
const SKIP_TEXT = 'button, select, option, input, textarea, [role="switch"], [role="option"], [role="tab"], svg'
const MAX_TITLE = 60

/** Visible text leaves of a block, outside controls, in document order. */
function texts(block: Element): string[] {
  const out: string[] = []
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let last: Element | null = null
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent === null || parent.closest(SKIP_TEXT) !== null) continue
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (text === '') continue
    // Text split across inline children of one element reads as one string.
    if (parent === last && out.length > 0) out[out.length - 1] += text
    else out.push(text)
    last = parent
  }
  return out
}

/**
 * The setting blocks of one rendered page, innermost first.
 * @param root - the rendered page.
 * @returns blocks in document order, none containing another.
 */
export function settingBlocks(root: Element): Element[] {
  const found = new Set<Element>()
  for (const wrapper of root.querySelectorAll('[data-slot$=".item"]')) {
    for (const row of wrapper.children) found.add(row)
  }
  for (const control of root.querySelectorAll(CONTROL)) {
    // Climb past readouts such as a stepper's "14" to the block that names the setting.
    let block = control.parentElement
    while (block !== null && block !== root && describeBlock(block) === null) block = block.parentElement
    if (block !== null && block !== root) found.add(block)
  }
  for (const heading of root.querySelectorAll('h1, h2, h3, h4')) {
    // A heading's block is the first ancestor that also holds its description.
    let block = heading.parentElement
    while (block !== null && block.parentElement !== root && texts(block).length < 2) block = block.parentElement
    if (block !== null && block !== root) found.add(block)
  }
  // Keep the innermost blocks: an outer block that contains another is a
  // page or group, not one setting.
  const blocks = [...found].filter(block => ![...found].some(other => other !== block && block.contains(other)))
  return blocks.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
}

/**
 * Title and description of one setting block.
 * @param block - a block from {@link settingBlocks}.
 * @returns the title and description, or null for a block without a usable title.
 */
export function describeBlock(block: Element): { title: string; desc: string } | null {
  const [title = '', desc = ''] = texts(block)
  // Values such as "3", "1s" or "100%" are control readouts, not titles.
  if (title.length > MAX_TITLE || !/\p{L}/u.test(title)) return null
  return { title, desc }
}

/**
 * Index one rendered page.
 * @param sectionId - the page's section id.
 * @param root - the rendered page.
 * @returns its settings, deduplicated by title.
 */
export function indexSection(sectionId: string, root: Element): SearchEntry[] {
  const seen = new Set<string>()
  const entries: SearchEntry[] = []
  for (const block of settingBlocks(root)) {
    const described = describeBlock(block)
    if (described === null || seen.has(described.title)) continue
    seen.add(described.title)
    entries.push({ sectionId, ...described })
  }
  return entries
}

/**
 * Match settings against a query: every space-separated term must appear in
 * the title, description or page name. Title matches rank first.
 * @param entries - the index.
 * @param query - the user's text.
 * @param sectionLabel - page name by section id.
 * @returns matches, best first.
 */
export function searchSettings(
  entries: readonly SearchEntry[],
  query: string,
  sectionLabel: (id: string) => string,
): SearchHit[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const hits: SearchHit[] = []
  for (const entry of entries) {
    const title = entry.title.toLocaleLowerCase()
    const desc = entry.desc.toLocaleLowerCase()
    const page = sectionLabel(entry.sectionId).toLocaleLowerCase()
    if (!terms.every(term => title.includes(term) || desc.includes(term) || page.includes(term))) continue
    const rank = terms.every(term => title.includes(term)) ? (title.startsWith(terms[0] ?? '') ? 0 : 1)
      : terms.some(term => title.includes(term) || desc.includes(term)) ? 2 : 3
    hits.push({ ...entry, rank })
  }
  return hits.sort((a, b) => a.rank - b.rank)
}

/**
 * Find a setting in a live page and open its tab if it sits in a hidden tab
 * panel. The tab switch renders on the next frame, so the caller scrolls then.
 * @param root - the live page.
 * @param title - the setting's title.
 * @returns the block, or null when the page no longer shows it.
 */
export function revealSetting(root: Element, title: string): HTMLElement | null {
  const block = settingBlocks(root).find(candidate => describeBlock(candidate)?.title === title)
  if (!(block instanceof HTMLElement)) return null
  const panel = block.closest('[role="tabpanel"][hidden]')
  const tabId = panel?.getAttribute('aria-labelledby')
  if (tabId) (root.ownerDocument.getElementById(tabId) as HTMLElement | null)?.click()
  return block
}
