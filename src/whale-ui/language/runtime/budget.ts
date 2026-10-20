/** Shared limits for one Whale UI document. Counts include data as well as components. */
export const DEFAULT_LIMITS = Object.freeze({
  sourceChars: 262_144,
  tokens: 40_000,
  depth: 80,
  astNodes: 20_000,
  materializedNodes: 30_000,
  evaluationSteps: 50_000,
  renderNodes: 12_000,
  stateKeys: 1_000,
  stateChars: 524_288,
  valueNodes: 30_000,
  collectionItems: 10_000,
});

export class RuntimeBudgetError extends Error {
  readonly code = "budget-exceeded";
  constructor(public readonly phase: string, public readonly limit: number, public readonly path = "") {
    super(`Whale UI ${phase} budget exceeded (${limit})${path ? ` at ${path}` : ""}`);
    this.name = "RuntimeBudgetError";
  }
}

export interface Budget {
  count: number;
  depth: number;
  enter(path?: string): () => void;
}

export function createBudget(phase: string, limit: number, maxDepth = DEFAULT_LIMITS.depth): Budget {
  const budget: Budget = {
    count: 0, depth: 0,
    enter(path = "") {
      if (++budget.count > limit) throw new RuntimeBudgetError(phase, limit, path);
      if (++budget.depth > maxDepth) {
        budget.depth--;
        throw new RuntimeBudgetError(`${phase} depth`, maxDepth, path);
      }
      return () => { budget.depth--; };
    },
  };
  return budget;
}

/** Iterative traversal, so the budget check itself cannot overflow the stack. */
export function assertValueBudget(value: unknown, phase = "value", maxChars: number = DEFAULT_LIMITS.stateChars): void {
  const pending: { value: unknown; depth: number; path: string; exit?: boolean }[] = [{ value, depth: 0, path: "$" }];
  const ancestors = new Set<object>();
  let nodes = 0;
  let chars = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (item.exit) { ancestors.delete(item.value as object); continue; }
    if (++nodes > DEFAULT_LIMITS.valueNodes) throw new RuntimeBudgetError(`${phase} nodes`, DEFAULT_LIMITS.valueNodes, item.path);
    if (item.depth > DEFAULT_LIMITS.depth) throw new RuntimeBudgetError(`${phase} depth`, DEFAULT_LIMITS.depth, item.path);
    const current = item.value;
    if (typeof current === "string") chars += current.length;
    else if (current && typeof current === "object") {
      if (ancestors.has(current)) throw new Error(`Whale UI ${phase} contains a cycle at ${item.path}`);
      ancestors.add(current);
      pending.push({ ...item, exit: true });
      const entries = Object.entries(current);
      if (entries.length > DEFAULT_LIMITS.collectionItems) throw new RuntimeBudgetError(`${phase} collection`, DEFAULT_LIMITS.collectionItems, item.path);
      for (const [key, child] of entries) {
        chars += key.length + 4;
        pending.push({ value: child, depth: item.depth + 1, path: `${item.path}/${key}` });
      }
    } else chars += 8;
    if (chars > maxChars) throw new RuntimeBudgetError(`${phase} size`, maxChars, item.path);
  }
}
