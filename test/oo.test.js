import { describe, expect, test } from "vitest";
import { produce } from "../src/immer.js";
import { classFromData, Field } from "../src/oo.js";

describe("OO", () => {
  test("from data: all types", () => {
    const tags = ["a", "b"];
    const info = new Map(Object.entries({ a: 1, b: 2 }));
    const om = new Map(Object.entries({ a: 10, b: 20 }));
    const Foo = classFromData("Foo", {
      fields: {
        count: 1,
        temp: 2.5,
        isValid: true,
        id: "321",
        tags,
        info,
        om,
      },
    });
    const f = Foo.make();
    expect(f.count).toBe(1);
    expect(f.temp).toBe(2.5);
    expect(f.isValid).toBe(true);
    expect(f.tags).toEqual(tags);
    expect(f.info).toEqual(info);
    expect(f.om).toEqual(om);
  });
  test("draft assignment on list runs coercer", () => {
    const Foo = classFromData("Foo", {
      fields: {
        items: [],
      },
    });
    const f = Foo.make();
    const f1 = produce(f, (draft) => {
      draft.items = [1, 2, 3];
    });
    expect(f1.items.length).toBe(3);
  });
  test("Constructor runs coercers", () => {
    const Foo = classFromData("Foo", {
      fields: {
        items: [],
      },
    });
    const f = Foo.make({ items: [1, 2, 3] });
    expect(f.items.length).toBe(3);
  });
});

describe("Field type check", () => {
  test("isValid runs the type predicate; coerceOr falls back on failure", () => {
    const f = new Field("int", "count");
    expect(f.isValid(5)).toBe(true);
    expect(f.isValid(3.14)).toBe(false);
    expect(f.coerceOr(3.14)).toBe(3);
    expect(f.coerceOr("nope", -1)).toBe(-1);
  });
});
