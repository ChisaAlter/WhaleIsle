/** Adapt the account's live catalog and saved model settings to the shared row editor. */
import { modelDrafts, type DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'

type ModelOverrides = Record<string, DeepSeekModelDraft>

function overridesOf(value: unknown): ModelOverrides {
  const overrides = Object.create(null) as ModelOverrides
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return overrides
  return Object.assign(overrides, Object.fromEntries(Object.entries(value).map(([id, fields]) => [id,
    typeof fields === 'object' && fields !== null && !Array.isArray(fields) ? { ...fields } : {},
  ])))
}

/**
 * Migrate the old replacement catalog in memory; explicit per-id fields win.
 * @param legacy - saved replacement catalog, absent for live-listing defaults.
 * @param overrides - current per-id settings.
 * @param defaults - bundled models whose legacy omissions must stay hidden.
 * @returns fields keyed by model id, without an embedded id field.
 */
export function accountOverrides(
  legacy: unknown,
  overrides: unknown,
  defaults: readonly DeepSeekModelDraft[],
): ModelOverrides {
  const rows = modelDrafts(legacy)
  const migrated = overridesOf(undefined)
  if (Array.isArray(legacy)) {
    const ids = new Set(rows.map(row => row['id']))
    for (const row of defaults) {
      if (typeof row['id'] === 'string' && !ids.has(row['id'])) migrated[row['id']] = { disabled: true }
    }
    for (const { id, ...fields } of rows) {
      if (typeof id === 'string') migrated[id] = fields
    }
  }
  for (const [id, fields] of Object.entries(overridesOf(overrides))) {
    migrated[id] = { ...migrated[id], ...Object.fromEntries(Object.entries(fields)
      .filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))) }
  }
  return migrated
}

/**
 * Present enabled saved rows without replacing the live catalog's default path.
 * @param catalog - currently available account models.
 * @param overrides - saved fields and disabled keys.
 * @returns editable rows, including manually configured models.
 */
export function accountModelRows(
  catalog: readonly DeepSeekModelDraft[],
  overrides: ModelOverrides,
): DeepSeekModelDraft[] {
  const models = new Map(catalog.flatMap(row => typeof row['id'] === 'string' ? [[row['id'], { ...row }] as const] : []))
  for (const [id, fields] of Object.entries(overrides)) {
    if (fields['disabled'] === true) models.delete(id)
    else {
      const { disabled: _disabled, ...modelFields } = fields
      models.set(id, { ...models.get(id), ...modelFields, id })
    }
  }
  return [...models.values()]
}

/**
 * Save only edited fields; a renamed or removed id disables its old catalog key.
 * @param before - rows when this editing baseline was opened or reset.
 * @param after - rows after the user's changes.
 * @param original - overrides belonging to that baseline.
 * @returns the next single per-id settings map.
 */
export function editedAccountOverrides(
  before: readonly DeepSeekModelDraft[],
  after: readonly DeepSeekModelDraft[],
  original: ModelOverrides,
): ModelOverrides {
  const overrides = overridesOf(original)
  const previous = new Map(before.map(row => [row['id'], row]))
  const ids = new Set(after.map(row => row['id']))
  for (const row of before) {
    const id = row['id']
    if (typeof id === 'string' && !ids.has(id)) overrides[id] = { ...overrides[id], disabled: true }
  }
  for (const { id, ...fields } of after) {
    if (typeof id !== 'string') continue
    const old = previous.get(id)
    const next = { ...overrides[id] }
    if (next['disabled'] === true) next['disabled'] = false
    for (const key of new Set([...Object.keys(old ?? {}), ...Object.keys(fields)])) {
      if (key === 'id' || JSON.stringify(old?.[key]) === JSON.stringify(fields[key])) continue
      if (fields[key] === undefined) Reflect.deleteProperty(next, key)
      else next[key] = fields[key]
    }
    if (Object.keys(next).length > 0) overrides[id] = next
    else Reflect.deleteProperty(overrides, id)
  }
  return overrides
}
