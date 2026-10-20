// ─────────────────────────────────────────────────────────────────────────────
// Reactive schema marker — shared between lang-core (introspection) and
// framework adapters (runtime binding).
// ─────────────────────────────────────────────────────────────────────────────

/** WeakSet tracks reactive schemas without mutating the schema objects. */
const reactiveSchemas = new WeakSet<object>();

/** Mark a schema as reactive. Called by framework adapters' reactive() function. */
export function markReactive(schema: object): void {
  reactiveSchemas.add(schema);
}

/** Check if a schema was marked reactive. Used by Zod introspection for $binding<> prefix. */
export function isReactiveSchema(schema: unknown): boolean {
  const seen = new Set<object>();
  let current = schema;
  while (current && typeof current === "object" && !seen.has(current)) {
    if (reactiveSchemas.has(current)) return true;
    seen.add(current);
    const def = (current as { _zod?: { def?: { type?: string; innerType?: unknown } } })._zod?.def;
    if (!def || !["optional", "default", "nullable", "catch", "readonly", "prefault", "nonoptional"].includes(def.type ?? "")) return false;
    current = def.innerType;
  }
  return false;
}
