/** Runtime metadata is explicitly marked; business objects with `value` are ordinary data. */
export const COMPONENT_STATE_KEY = "__whale_component_state__";
export interface FieldRecord { __whaleField: 1; value: unknown; componentType?: string }
export function wrapFieldValue(value: unknown, componentType?: string): FieldRecord {
  return { __whaleField: 1, value, ...(componentType ? { componentType } : {}) };
}
export function unwrapFieldValue(value: unknown): unknown {
  return value && typeof value === "object" && (value as Partial<FieldRecord>).__whaleField === 1
    ? (value as FieldRecord).value : value;
}
