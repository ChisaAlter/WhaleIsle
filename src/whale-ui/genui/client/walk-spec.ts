import type { GenuiNode, GenuiSpec } from './spec.ts'
import { GENUI_LIMITS } from './genui-runtime/limits.ts'
import { isTableDetailReachable } from './table-details.ts'

export interface GenuiChildSlot {
  readonly value: unknown
  readonly key: string
  readonly path: string
  readonly holder: unknown[]
  readonly index: number
}
export interface GenuiWalkOptions { familyCaps?: boolean; maxNodes?: number }

/** Sole definition of renderer-owned children. JSON, file-tree records, chart
 * options, scene meshes and custom payloads stay opaque. Raw inputs are
 * accepted so diagnostics and normalization use the same child contract. */
export function genuiChildSlots(value: unknown, path = '', options: GenuiWalkOptions = {}): GenuiChildSlot[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const node = value as Record<string, unknown>
  const slots: GenuiChildSlot[] = []
  const add = (items: unknown, key: string, onlyNodes = false): void => {
    if (!Array.isArray(items)) return
    items.forEach((child, index) => {
      if (onlyNodes && (child === null || typeof child !== 'object' || !('type' in child))) return
      const relative = `${key}[${index}]`
      slots.push({ value: child, key: relative, path: path === '' ? relative : `${path}.${relative}`, holder: items, index })
    })
  }
  const sections = (items: unknown, key: string, cap: number): void => {
    if (!Array.isArray(items)) return
    items.slice(0, options.familyCaps === false ? items.length : cap).forEach((section, index) => {
      if (section !== null && typeof section === 'object') add((section as Record<string, unknown>).items, `${key}[${index}].items`)
    })
  }
  switch (node.type) {
    case 'row': case 'col': case 'grid': case 'card': add(node.items, 'items'); break
    case 'list': add(node.items, 'items', true); break
    case 'tabs': sections(node.tabs, 'tabs', GENUI_LIMITS.maxTabs); break
    case 'accordion': sections(node.items, 'items', GENUI_LIMITS.maxAccordionItems); break
    case 'table':
      if (Array.isArray(node.details)) node.details.forEach((detail, index) => {
        if (isTableDetailReachable(node, index)) add(detail, `details[${index}]`)
      })
      break
  }
  return slots
}

export function walkGenuiNodes(spec: GenuiSpec, visitor: (node: GenuiNode, path: string, depth: number) => void): void {
  walkRawGenuiNodes(spec, (value, path, depth) => visitor(value as unknown as GenuiNode, path, depth))
}

/** Bounded raw form used before validation; no traversal through data fields. */
export function walkRawGenuiNodes(spec: unknown, visitor: (node: Record<string, unknown>, path: string, depth: number) => void, options: GenuiWalkOptions = {}): void {
  if (spec === null || typeof spec !== 'object') return
  const root = spec as Record<string, unknown>
  const maxNodes = options.maxNodes ?? GENUI_LIMITS.maxNodes + 1
  let count = 0
  const visit = (value: unknown, path: string, depth: number): void => {
    if (count >= maxNodes || depth > GENUI_LIMITS.maxDepth || value === null || typeof value !== 'object' || Array.isArray(value)) return
    const node = value as Record<string, unknown>
    if (typeof node.type !== 'string') return
    count++
    visitor(node, path, depth)
    for (const child of genuiChildSlots(node, path, options)) visit(child.value, child.path, depth + 1)
  }
  if (typeof root.type === 'string' && root.type !== 'spec') visit(root, 'spec', 0)
  else if (Array.isArray(root.items)) root.items.forEach((value, index) => visit(value, `items[${index}]`, 0))
}

/** Map children on an isolated copy, preserving all opaque data payloads. */
export function mapGenuiNodes(spec: GenuiSpec, mapper: (node: GenuiNode, path: string, depth: number) => GenuiNode): GenuiSpec {
  const copy = structuredClone(spec)
  const visit = (node: GenuiNode, path: string, depth: number): GenuiNode => {
    if (depth > GENUI_LIMITS.maxDepth) return node
    const mapped = mapper(node, path, depth)
    if (depth < GENUI_LIMITS.maxDepth) for (const slot of genuiChildSlots(mapped, path, { familyCaps: false })) {
      slot.holder[slot.index] = visit(slot.value as GenuiNode, slot.path, depth + 1)
    }
    return mapped
  }
  copy.items = copy.items.map((node, index) => visit(node, `items[${index}]`, 0))
  return copy
}
