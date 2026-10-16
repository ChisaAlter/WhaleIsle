import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createStore, createStreamingParser } from "../../vendor/open-intelligent-ui/node_modules/@openuidev/lang-core/dist/index.mjs";
import { createPersistentStore, subscribePersistedViewerState } from "./state-store.ts";

const spec = JSON.parse(readFileSync(new URL("../../vendor/open-intelligent-ui/src/generated/spec.json", import.meta.url), "utf8"));

function storeFor(t) {
  const store = createPersistentStore(createStore);
  t.after(() => store.dispose());
  return store;
}

function captureWrites(t) {
  const writes = [];
  t.after(subscribePersistedViewerState((state) => writes.push(structuredClone(state))));
  return writes;
}

test("streamed defaults remain replaceable while the edited binding persists", { concurrency: false }, (t) => {
  const parser = createStreamingParser(spec.schema, "Col");
  const prefix = 'root = Col([Input($a, "A"), Text($b + "")])\n$a = "x"\n$b = 1';
  const partial = parser.set(prefix);
  const complete = parser.set(`${prefix}2\n`, true);
  assert.deepEqual(partial.meta.errors, []);
  assert.deepEqual(complete.meta.errors, []);
  assert.equal(partial.stateDeclarations.$b, 1);
  assert.equal(complete.stateDeclarations.$b, 12);

  const writes = captureWrites(t);
  const store = storeFor(t);
  store.initialize(partial.stateDeclarations, {});
  assert.deepEqual(writes, []);
  store.set("$a", "typed");
  store.initialize(complete.stateDeclarations, writes.at(-1));

  assert.equal(store.get("$a"), "typed");
  assert.equal(store.get("$b"), 12);
  assert.deepEqual(writes, [{ $a: "typed" }]);
  assert.deepEqual(store.getPersistedSnapshot(), { $a: "typed" });
});

test("same-value numeric edits and resets publish dirty identity changes", { concurrency: false }, (t) => {
  const writes = captureWrites(t);
  const numeric = storeFor(t);
  numeric.initialize({ $a: 1000 }, {});
  let numericNotifications = 0;
  numeric.subscribe(() => numericNotifications++);
  numeric.set("$a", Number("1,000".replaceAll(",", "")));
  assert.equal(numericNotifications, 0);
  assert.deepEqual(writes, [{ $a: 1000 }]);
  numeric.initialize({ $a: 10000 }, writes.at(-1));
  assert.equal(numeric.get("$a"), 1000);
  const reloadedNumeric = storeFor(t);
  reloadedNumeric.initialize({ $a: 10000 }, writes.at(-1));
  assert.equal(reloadedNumeric.get("$a"), 1000);

  writes.length = 0;
  const reset = storeFor(t);
  reset.initialize({ $a: 1 }, {});
  let resetNotifications = 0;
  reset.subscribe(() => resetNotifications++);
  reset.set("$a", 2);
  reset.set("$a", 1);
  assert.equal(resetNotifications, 2);
  reset.set("$a", 1, { pristine: true });
  assert.equal(resetNotifications, 2);
  assert.deepEqual(writes, [{ $a: 2 }, { $a: 1 }, {}]);
  reset.initialize({ $a: 12 }, writes.at(-1));
  assert.equal(reset.get("$a"), 12);
  assert.deepEqual(writes, [{ $a: 2 }, { $a: 1 }, {}]);
  const reloadedReset = storeFor(t);
  reloadedReset.initialize({ $a: 12 }, writes.at(-1));
  assert.equal(reloadedReset.get("$a"), 12);
});

test("mixed form fields and bindings survive two hydrations without partial writes", { concurrency: false }, (t) => {
  const expected = { $a: "typed", A: { value: "draft", componentType: "Input" } };
  let saved = structuredClone(expected);
  const writes = [];
  t.after(subscribePersistedViewerState((state) => {
    saved = structuredClone(state);
    writes.push(saved);
  }));

  for (let reload = 0; reload < 2; reload++) {
    const store = storeFor(t);
    const bindings = {};
    const before = writes.length;
    // Match the SDK's hydration order: restore non-$ fields first, then initialize bindings.
    for (const [name, value] of Object.entries(saved)) {
      if (name.startsWith("$")) bindings[name] = value;
      else store.set(name, value);
    }
    assert.equal(writes.length, before, "must not publish a field-only partial map");
    store.initialize({ $a: "default" }, bindings);
    assert.equal(writes.length, before + 1);
    assert.deepEqual(saved, expected);
    assert.equal(store.get("$a"), "typed");
    assert.deepEqual(store.get("A"), expected.A);
  }
  assert.deepEqual(writes, [expected, expected]);
});
