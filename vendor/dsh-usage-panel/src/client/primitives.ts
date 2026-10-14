// Host ui-primitives presence check. The module is a build external; older
// hosts may resolve it without Button/Menu/Modal/Switch/Toast. apply() skips
// registration then (strip, modal and switches degrade with the section).
export const REQUIRED_PRIMITIVES = ['Button', 'Menu', 'Modal', 'Switch', 'Toast'] as const

export function missingPrimitives(mod: Record<string, unknown> | null | undefined): string[] {
  const src = mod || {}
  return REQUIRED_PRIMITIVES.filter((name) => src[name] === undefined)
}
