import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const base = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: `export * from './language/index.ts'; export * from './runtime/state.ts';`, sourcefile: 'integration-state-entry.ts', resolveDir: base, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', tsconfigRaw: {}, logLevel: 'silent' });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, loaded, loaded.exports);
const { createStore, createPersistentStore, restoreDocumentState, documentState, DEFAULT_LIMITS } = loaded.exports;

function persistent() { return createPersistentStore(createStore); }

test('pristine streaming defaults update until an equal-value user edit makes them durable', () => {
  const store = persistent();
  const snapshots = [];
  store.subscribePersisted(value => snapshots.push(value));
  store.initialize({ $n: 1 }, {});
  assert.deepEqual(store.getPersistedSnapshot(), {});
  store.initialize({ $n: 2 }, {});
  assert.equal(store.get('$n'), 2);
  assert.equal(snapshots.length, 0);
  store.set('$n', 2);
  assert.deepEqual(store.getPersistedSnapshot(), { $n: 2 });
  assert.deepEqual(snapshots, [{ $n: 2 }]);
  store.initialize({ $n: 3 }, {});
  assert.equal(store.get('$n'), 2);
  assert.deepEqual(store.getPersistedSnapshot(), { $n: 2 });
  store.dispose();
});

test('hydrated state is applied once; source updates never replay stale persisted input over a later user edit', () => {
  const store = persistent();
  const originalPersisted = { $n: 7 };
  store.initialize({ $n: 1 }, originalPersisted);
  store.set('$n', 8);
  store.initialize({ $n: 2 }, originalPersisted);
  assert.equal(store.get('$n'), 8);
  assert.deepEqual(store.getPersistedSnapshot(), { $n: 8 });
  store.dispose();
});

test('Reset clears hydrated dirty state and follows a later completed default without resurrecting persisted input', () => {
  const store = persistent();
  const originalPersisted = { $n: 7, contact: { Note: { __whaleField: 1, value: 'saved', componentType: 'Input' } } };
  store.initialize({ $n: 1 }, originalPersisted);
  store.set('$n', 1, { pristine: true });
  assert.equal(store.get('$n'), 1);
  assert.ok(!Object.hasOwn(store.getPersistedSnapshot(), '$n'));
  store.initialize({ $n: 2 }, originalPersisted);
  assert.equal(store.get('$n'), 2);
  assert.ok(!Object.hasOwn(store.getPersistedSnapshot(), '$n'));
  assert.deepEqual(store.getPersistedSnapshot().contact, originalPersisted.contact);
  store.dispose();
});

test('rejected bounded edits leave values and dirty metadata unchanged', () => {
  const store = persistent();
  store.initialize({ $n: 1 }, {});
  assert.throws(() => store.set('$tooLarge', 'x'.repeat(DEFAULT_LIMITS.stateChars + 1)), /budget exceeded/);
  assert.deepEqual(store.getPersistedSnapshot(), {});
  assert.deepEqual(store.getSnapshot(), { $n: 1 });
  store.dispose();
});

test('legacy hydration marks only recognized exact field wrappers and preserves unmatched user data', () => {
  const original = { $item: { value: 10, unit: 'kg' }, contact: { Note: { value: 'saved note', componentType: 'Input' }, opaque: { value: 10, unit: 'kg' }, extra: { value: 3, componentType: 'Input', unit: 'kg' }, unknown: { value: 4, componentType: 'BusinessRecord' } } };
  const saved = structuredClone(original);
  const restored = restoreDocumentState(original);
  assert.deepEqual(original, saved);
  assert.deepEqual(restored.$item, saved.$item);
  assert.equal(restored.contact.Note.__whaleField, 1);
  assert.deepEqual(restored.contact.opaque, saved.contact.opaque);
  assert.deepEqual(restored.contact.extra, saved.contact.extra);
  assert.deepEqual(restored.contact.unknown, saved.contact.unknown);
  assert.deepEqual(restoreDocumentState(documentState(restored)), restored);
});
