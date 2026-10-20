import { GENUI_NATIVE_TYPES } from './schema.ts'
import { walkRawGenuiNodes } from '../walk-spec.ts'
import { isComponentRoot, wrapSingleComponentRoot } from '../spec.ts'

export interface GenuiUnsupportedComponentDiagnostic {
  readonly code: 'unsupported-component'
  readonly path: string
  readonly type: string
  readonly message: string
}
export function unsupportedGenuiComponentMessage(type: string, path: string): string {
  return `${path}: unsupported component type '${type}' (no renderer registered)`
}
/** Shared host/browser capability check. Only real renderer child slots are
 * inspected; JSON, chart/file-tree data and unsupported payloads stay opaque.
 * A supplied set must describe renderers actually installed by the caller. */
export function diagnoseUnsupportedGenuiTypes(value: unknown, supportedTypes: ReadonlySet<string> = GENUI_NATIVE_TYPES): GenuiUnsupportedComponentDiagnostic[] {
  const diagnostics: GenuiUnsupportedComponentDiagnostic[] = []
  const envelope = isComponentRoot(value) ? wrapSingleComponentRoot(value) : value
  walkRawGenuiNodes(envelope, (node, path) => {
    const type = node.type as string
    if (!supportedTypes.has(type)) diagnostics.push({ code: 'unsupported-component', path, type, message: unsupportedGenuiComponentMessage(type, path) })
  }, { familyCaps: false })
  return diagnostics
}
