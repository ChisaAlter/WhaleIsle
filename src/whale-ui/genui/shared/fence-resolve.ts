import { partialRepairGenuiSpec, processGenuiSpec, type GenuiProcessResult } from '../client/guard.ts'
import { parsePartialGenuiSpec } from '../client/parse-partial.ts'
import type { GenuiSpec } from '../client/spec.ts'
import { completeFenceJson, repairFenceJson } from './fence-repair.ts'

export interface FenceResolveOptions { readonly settled: boolean }
export type FenceResolutionStatus = 'streaming-partial' | 'complete' | 'partial' | 'failed'
export interface FenceResolution {
  readonly value: unknown | null
  readonly processed: GenuiProcessResult | null
  readonly spec: GenuiSpec | null
  readonly status: FenceResolutionStatus
  /** True only when the complete JSON candidate passed without dropped nodes. */
  readonly complete: boolean
  readonly repaired: boolean
  readonly repairs: number
  readonly errors: readonly string[]
}
function resolveParsedFence(value: unknown, whole: boolean, repaired: boolean, repairs: number, settled: boolean): FenceResolution {
  const processed = processGenuiSpec(value)
  const spec = partialRepairGenuiSpec(processed)
  // A bounded preview may be safe to display even when policy caps removed
  // component nodes. Keep that preview, but completion must report the loss.
  const truncationErrors = processed.warnings.filter(warning => warning.kind === 'truncated')
    .map(warning => `${warning.path}: component nodes were truncated by policy limits; ${warning.message}`)
  const errors = [...new Set([...processed.errors, ...truncationErrors, ...(!whole && settled ? ['The completed fence contains an incomplete JSON tail.'] : [])])]
  const complete = whole && spec !== null && errors.length === 0
  return { value, processed, spec, status: complete ? 'complete' : !settled ? 'streaming-partial' : spec !== null ? 'partial' : 'failed', complete, repaired, repairs, errors }
}
/** Whole JSON and whole-body repairs always precede partial-prefix display.
 * Structural completion is settled-only. A displayed prefix retains errors. */
export function resolveFence(raw: string, options: FenceResolveOptions): FenceResolution {
  let parsedWhole: unknown
  let whole = false
  try { parsedWhole = JSON.parse(raw); whole = true } catch { /* JSON syntax only */ }
  if (whole) return resolveParsedFence(parsedWhole, true, false, 0, options.settled)
  const repaired = repairFenceJson(raw)
  if (repaired !== null) return resolveParsedFence(JSON.parse(repaired.text), true, true, repaired.repairs, options.settled)
  if (options.settled) {
    const completed = completeFenceJson(raw)
    if (completed !== null) return resolveParsedFence(JSON.parse(completed.text), true, true, completed.repairs, true)
  }
  const parsed = parsePartialGenuiSpec(raw)
  if (parsed !== null) return resolveParsedFence(parsed, false, false, 0, options.settled)
  return { value: null, processed: null, spec: null, status: options.settled ? 'failed' : 'streaming-partial', complete: false, repaired: false, repairs: 0, errors: options.settled ? ['The completed fence is not valid JSON.'] : [] }
}
export function resolveFenceSpec(raw: string, options: FenceResolveOptions): GenuiSpec | null { return resolveFence(raw, options).spec }
