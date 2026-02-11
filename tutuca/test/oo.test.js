import { IMap, List, OMap } from "../index.js";
import { classFromData } from "../src/oo.js";
import { describe, expect, test } from "bun:test";

describe("OO", () => {
  test("from data: all types", () => {
    const tags = List(["a", "b"]);
    const info = IMap({ a: 1, b: 2 });
    const om = OMap({ a: 10, b: 20 });
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
    const f = Foo();
    expect(f.count).toBe(1);
    expect(f.temp).toBe(2.5);
    expect(f.isValid).toBe(true);
    expect(f.tags).toBe(tags);
    expect(f.info).toBe(info);
    expect(f.om).toBe(om);
  });
  test("set on list runs coercer", () => {
    const Foo = classFromData("Foo", {
      fields: {
        items: List(),
      },
    });
    const f = Foo();
    const f1 = f.setItems([1, 2, 3]);
    expect(f1.items.size).toBe(3);
  });
  test("Constructor runs coercers", () => {
    const Foo = classFromData("Foo", {
      fields: {
        items: List(),
      },
    });
    const f = Foo.make({ items: [1, 2, 3] });
    expect(f.items.size).toBe(3);
  });
});
