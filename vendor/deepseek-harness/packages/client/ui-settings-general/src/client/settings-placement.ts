/**
 * Desktop settings navigation: which group each section belongs to and its
 * position there. Rows choose their section by the slot they register in.
 */

/** Nav group ids in display order. */
export type SettingsNavGroup = 'account' | 'general' | 'agent' | 'features' | 'other'

/**
 * Sections in display order per group. A section id missing here (a
 * marketplace plugin's own page) joins `features` after the listed ones, in
 * its registered order.
 */
export const NAV_GROUPS: readonly { id: SettingsNavGroup; sections: readonly string[] }[] = [
  { id: 'account', sections: ['account', 'usage-stats'] },
  { id: 'general', sections: ['general', 'appearance', 'interface', 'conversation', 'archived-sessions'] },
  { id: 'agent', sections: ['models', 'agent-presets', 'skills', 'mcp', 'plugins', 'market'] },
  { id: 'features', sections: ['features', 'pet', 'remote', 'remote-workspace'] },
  { id: 'other', sections: ['about'] },
]

/**
 * Arrange registered sections into nav groups.
 * @param rows - registered sections (id + order).
 * @returns non-empty groups in display order, each with its sections in order.
 */
export function groupSections<T extends { id: string; order: number }>(rows: readonly T[]): { id: SettingsNavGroup; rows: T[] }[] {
  const known = new Map<string, { group: SettingsNavGroup; index: number }>()
  for (const group of NAV_GROUPS) group.sections.forEach((id, index) => { known.set(id, { group: group.id, index }) })
  const groups = NAV_GROUPS.map(group => ({ id: group.id, rows: [] as T[] }))
  const extra: T[] = []
  for (const row of rows) {
    const place = known.get(row.id)
    if (place === undefined) extra.push(row)
    else groups.find(group => group.id === place.group)?.rows.push(row)
  }
  for (const group of groups) {
    group.rows.sort((a, b) => (known.get(a.id)?.index ?? 0) - (known.get(b.id)?.index ?? 0))
  }
  extra.sort((a, b) => a.order - b.order)
  groups.find(group => group.id === 'features')?.rows.push(...extra)
  return groups.filter(group => group.rows.length > 0)
}
