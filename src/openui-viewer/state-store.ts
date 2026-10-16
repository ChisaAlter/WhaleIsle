import type { Store } from "@openuidev/lang-core";

type PersistentStore = Store & { getPersistedSnapshot(): Record<string, unknown> };
let activeStore: PersistentStore | null = null;
const persistenceListeners = new Set<(state: Record<string, unknown>) => void>();

/** Preserve SDK pristine semantics while exposing only user-set/persisted keys. */
export function createPersistentStore(createUpstreamStore: () => Store): PersistentStore {
  const upstream = createUpstreamStore();
  const dirty = new Set<string>();
  let initialized = false;
  let published: Record<string, unknown> = {};
  const publish = () => {
    if (!initialized || activeStore !== store) return;
    const state = store.getPersistedSnapshot();
    const keys = Object.keys(state);
    if (keys.length === Object.keys(published).length && keys.every((name) => Object.hasOwn(published, name) && Object.is(state[name], published[name]))) return;
    published = state;
    for (const listener of persistenceListeners) listener(state);
  };
  const store: PersistentStore = {
    get: upstream.get,
    getSnapshot: upstream.getSnapshot,
    subscribe: upstream.subscribe,
    set(name, value, options) {
      const wasDirty = dirty.has(name);
      const previous = upstream.getSnapshot();
      if (options?.pristine) dirty.delete(name);
      else dirty.add(name);
      upstream.set(name, value, options);
      // The SDK intentionally does not notify for an equal value, but changing
      // pristine/dirty identity still changes what must survive a reload.
      if (wasDirty !== dirty.has(name) || previous !== upstream.getSnapshot()) publish();
    },
    initialize(defaults, persisted) {
      for (const name of Object.keys(persisted)) dirty.add(name);
      upstream.initialize(defaults, persisted);
      // The SDK first restores non-binding form fields with set(), then calls
      // initialize() with $bindings. Publish only after that first complete
      // hydration, never an intermediate map missing the saved bindings.
      initialized = true;
      publish();
    },
    getPersistedSnapshot() {
      return Object.fromEntries(Object.entries(upstream.getSnapshot()).filter(([name]) => dirty.has(name)));
    },
    dispose() {
      dirty.clear();
      upstream.dispose();
      if (activeStore === store) activeStore = null;
    },
  };
  activeStore = store;
  return store;
}

export function subscribePersistedViewerState(listener: (state: Record<string, unknown>) => void): () => void {
  persistenceListeners.add(listener);
  return () => { persistenceListeners.delete(listener); };
}
