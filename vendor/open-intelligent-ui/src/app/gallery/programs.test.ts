import { createParser, type LibrarySpec } from "@openuidev/lang-core";
import { describe, expect, it } from "vitest";
import spec from "@/generated/spec.json";
import { actions } from "@/lib/actions";
import { functions } from "@/lib/functions";
import { exampleDashboard, exampleShoppingList, exampleSteps, exampleTrip } from "@/lib/prompt-options";
import { compositionPrograms } from "./composition-programs";
import { programs } from "./programs";
import { toolPrograms } from "./tool-programs";

const library: LibrarySpec = spec;
const parser = createParser(library.schema!, library.root);

describe("the generated library spec", () => {
  it("lists every function and action (run npm run generate after changes)", () => {
    expect(Object.keys(library.functions ?? {})).toEqual(functions.map((f) => f.name));
    expect(Object.keys(library.actions ?? {})).toEqual(actions.map((a) => a.name));
  });

  it("gives each function a one-line description", () => {
    for (const f of functions) {
      expect(f.description, f.name).toMatch(/^[^\n—]{8,240}$/);
    }
  });
});

const all = [
  ...toolPrograms,
  { id: "example-list", code: exampleShoppingList },
  { id: "example-trip", code: exampleTrip },
  { id: "example-steps", code: exampleSteps },
  { id: "example-dashboard", code: exampleDashboard },
  ...programs,
  ...compositionPrograms,
];

describe.each(all)("$id", ({ code }) => {
  it("parses with the 1.0 parser without errors", () => {
    const result = parser.parse(code);
    expect(result.root).not.toBeNull();
    expect(result.meta.errors.map((e) => e.message)).toEqual([]);
    expect(result.meta.unresolved).toEqual([]);
    expect(result.meta.orphaned).toEqual([]);
  });
});
