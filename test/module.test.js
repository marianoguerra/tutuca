import { describe, expect, test } from "vitest";
import { findComponentNameConflicts } from "../tools/core/module.js";

// The detector only reads `.name` and object identity, so plain stand-ins suffice.
const comp = (name) => ({ name });

describe("findComponentNameConflicts", () => {
  test("no conflict when every name maps to one distinct object", () => {
    const a = comp("Box");
    const b = comp("Chip");
    expect(
      findComponentNameConflicts([
        { path: "/a.dev.js", components: [a] },
        { path: "/b.dev.js", components: [b] },
      ]),
    ).toEqual([]);
  });

  test("the same object listed by several modules is fine (shared-leaf contract)", () => {
    const shared = comp("Leaf");
    expect(
      findComponentNameConflicts([
        { path: "/a.dev.js", components: [shared] },
        { path: "/b.dev.js", components: [shared] },
      ]),
    ).toEqual([]);
  });

  test("two DIFFERENT objects with the same name are reported, with the module paths", () => {
    const dist = comp("JsonNull");
    const src = comp("JsonNull");
    const conflicts = findComponentNameConflicts([
      { path: "/docs/a.dev.js", components: [dist] },
      { path: "/src/b.dev.js", components: [src] },
    ]);
    expect(conflicts).toEqual([{ name: "JsonNull", paths: ["/docs/a.dev.js", "/src/b.dev.js"] }]);
  });

  test("conflicts are sorted by name; non-conflicting names are omitted", () => {
    const conflicts = findComponentNameConflicts([
      { path: "/1.dev.js", components: [comp("Zed"), comp("Ok")] },
      { path: "/2.dev.js", components: [comp("Zed"), comp("Amp")] },
      { path: "/3.dev.js", components: [comp("Amp")] },
    ]);
    expect(conflicts.map((c) => c.name)).toEqual(["Amp", "Zed"]);
  });

  test("ignores missing/empty component lists and unnamed entries", () => {
    expect(
      findComponentNameConflicts([
        { path: "/a.dev.js" },
        { path: "/b.dev.js", components: [] },
        { path: "/c.dev.js", components: [null, {}, comp("X")] },
      ]),
    ).toEqual([]);
  });
});
