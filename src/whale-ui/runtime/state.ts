import type { Store } from '../language/index.ts';

export type InteractionState = Record<string, unknown>;
export type DocumentState = {
  format: 'whale-ui-state';
  version: 1;
  values: InteractionState;
};
export type PersistentStore = Store & {
  getPersistedSnapshot(): InteractionState;
  subscribePersisted(listener: (state: InteractionState) => void): () => void;
};

/** Restore the legacy flat binding map without changing the original saved record. */
export function restoreDocumentState(value: InteractionState): InteractionState {
  if (value.format !== 'whale-ui-state') {
    const fieldTypes = new Set(['Input', 'TextArea', 'Select', 'Checkbox', 'RadioGroup', 'DatePicker', 'Slider', 'SegmentedControl', 'Timer', 'Map']);
    const migrate = (candidate: unknown): unknown => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
      const fields = candidate as Record<string, unknown>;
      const keys = Object.keys(fields);
      if (keys.length === 2 && keys.includes('value') && keys.includes('componentType')
        && typeof fields.componentType === 'string' && fieldTypes.has(fields.componentType)) return { __whaleField: 1, ...fields };
      return Object.fromEntries(Object.entries(fields).map(([name, field]) => {
        if (!field || typeof field !== 'object' || Array.isArray(field)) return [name, field];
        const saved = field as Record<string, unknown>;
        const savedKeys = Object.keys(saved);
        return [name, savedKeys.length === 2 && savedKeys.includes('value') && savedKeys.includes('componentType')
          && typeof saved.componentType === 'string' && fieldTypes.has(saved.componentType) ? { __whaleField: 1, ...saved } : field];
      }));
    };
    return Object.fromEntries(Object.entries(value).map(([name, saved]) => [name, name.startsWith('$') ? saved : migrate(saved)]));
  }
  if (value.version !== 1 || !value.values || typeof value.values !== 'object' || Array.isArray(value.values)) {
    throw new Error('Unsupported Whale UI interaction state.');
  }
  return value.values as InteractionState;
}

export function documentState(values: InteractionState): DocumentState {
  return { format: 'whale-ui-state', version: 1, values };
}

/** One document owns its dirty values and notifications, including equal-value user edits. */
export function createPersistentStore(createBaseStore: () => Store): PersistentStore {
  const base = createBaseStore();
  const dirty = new Set<string>();
  const listeners = new Set<(state: InteractionState) => void>();
  let initialized = false;
  let published: InteractionState = {};
  const publish = () => {
    if (!initialized) return;
    const state = store.getPersistedSnapshot();
    const keys = Object.keys(state);
    if (keys.length === Object.keys(published).length
      && keys.every(key => Object.hasOwn(published, key) && Object.is(state[key], published[key]))) return;
    published = state;
    for (const listener of listeners) listener(state);
  };
  const store: PersistentStore = {
    get: base.get,
    getSnapshot: base.getSnapshot,
    subscribe: base.subscribe,
    set(name, value, options) {
      const before = base.getSnapshot();
      const wasDirty = dirty.has(name);
      // Let the base validate and commit before publishing dirty metadata.
      base.set(name, value, options);
      if (options?.pristine) dirty.delete(name);
      else dirty.add(name);
      if (wasDirty !== dirty.has(name) || before !== base.getSnapshot()) publish();
    },
    initialize(defaults, persisted) {
      const restored = initialized ? {} : persisted;
      base.initialize(defaults, restored);
      for (const key of Object.keys(restored)) dirty.add(key);
      initialized = true;
      publish();
    },
    getPersistedSnapshot() {
      return Object.fromEntries(Object.entries(base.getSnapshot()).filter(([key]) => dirty.has(key)));
    },
    subscribePersisted(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      listeners.clear();
      dirty.clear();
      base.dispose();
    },
  };
  return store;
}
