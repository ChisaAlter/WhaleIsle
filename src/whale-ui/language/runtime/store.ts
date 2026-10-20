// OpenUI SDK store, owned and bounded by Whale UI. See ../LICENSE.
import { assertValueBudget, DEFAULT_LIMITS, RuntimeBudgetError } from "./budget";

export interface Store {
  get(name: string): unknown;
  /** Pristine defaults can be replaced by a later completed streaming declaration. */
  set(name: string, value: unknown, options?: { pristine?: boolean }): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): Record<string, unknown>;
  initialize(defaults: Record<string, unknown>, persisted: Record<string, unknown>): void;
  dispose(): void;
}

export function createStore(): Store {
  const state = new Map<string, unknown>();
  const pristine = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: Record<string, unknown> = {};

  function validate(candidate: Map<string, unknown>) {
    if (candidate.size > DEFAULT_LIMITS.stateKeys) throw new RuntimeBudgetError("state keys", DEFAULT_LIMITS.stateKeys);
    assertValueBudget(Object.fromEntries(candidate), "state");
  }
  function notify() { for (const listener of [...listeners]) listener(); }
  function commit(candidate: Map<string, unknown>) {
    validate(candidate);
    state.clear();
    for (const [key, value] of candidate) state.set(key, value);
    snapshot = Object.fromEntries(state);
    notify();
  }
  function set(name: string, value: unknown, options?: { pristine?: boolean }) {
    // Validation precedes mutation; a rejected update leaves values and pristine metadata intact.
    const candidate = new Map(state);
    candidate.set(name, value);
    validate(candidate);
    if (options?.pristine) pristine.add(name); else pristine.delete(name);
    if (Object.is(state.get(name), value) && state.has(name)) return;
    commit(candidate);
  }
  function initialize(defaults: Record<string, unknown>, persisted: Record<string, unknown>) {
    const candidate = new Map(state);
    const nextPristine = new Set(pristine);
    for (const [key, value] of Object.entries(persisted)) { candidate.set(key, value); nextPristine.delete(key); }
    for (const [key, value] of Object.entries(defaults)) {
      if (!candidate.has(key) || nextPristine.has(key)) { candidate.set(key, value); nextPristine.add(key); }
    }
    validate(candidate);
    pristine.clear();
    for (const key of nextPristine) pristine.add(key);
    if (candidate.size === state.size && [...candidate].every(([key, value]) => Object.is(state.get(key), value))) return;
    commit(candidate);
  }
  return {
    get: (name) => state.get(name), set,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot, initialize,
    dispose() { state.clear(); pristine.clear(); listeners.clear(); snapshot = {}; },
  };
}
