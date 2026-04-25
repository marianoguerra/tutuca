import { describe, expect, test } from "bun:test";
import { IMap, List, OMap } from "../index.js";
import { classFromData, FieldInt } from "../src/oo.js";

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

describe("Field.addCheck", () => {
  const positiveCheck = {
    isValid: (v) => v > 0,
    getMessage: () => "Must be positive",
  };
  const evenCheck = {
    isValid: (v) => v % 2 === 0,
    getMessage: () => "Must be even",
  };

  test("returns the field for chaining", () => {
    const f = new FieldInt("count");
    expect(f.addCheck(positiveCheck)).toBe(f);
  });

  test("custom check fails when type passes but value is rejected", () => {
    const f = new FieldInt("count").addCheck(positiveCheck);
    expect(f.isValid(5)).toBe(true);
    expect(f.isValid(0)).toBe(false);
    expect(f.isValid(-3)).toBe(false);
    expect(f.getFirstFailingCheck(-3)).toBe(positiveCheck);
  });

  test("type check still runs before custom checks", () => {
    const f = new FieldInt("count").addCheck(positiveCheck);
    expect(f.isValid(3.14)).toBe(false);
    expect(f.getFirstFailingCheck(3.14)).toBe(f.typeCheck);
  });

  test("multiple checks compose; first failure wins", () => {
    const f = new FieldInt("count").addCheck(positiveCheck).addCheck(evenCheck);
    expect(f.isValid(4)).toBe(true);
    expect(f.isValid(3)).toBe(false);
    expect(f.getFirstFailingCheck(3)).toBe(evenCheck);
    expect(f.getFirstFailingCheck(-2)).toBe(positiveCheck);
  });
});
