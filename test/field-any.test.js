import { describe, expect, test } from "bun:test";
import { classFromData, FieldAny } from "../src/oo.js";
import { expectFieldDefault, expectFieldRegistered } from "./dom.js";

describe("FieldAny", () => {
  test("is registered in fieldsByTypeName", () => {
    expectFieldRegistered("any", FieldAny);
  });

  test("validates any value", () => {
    const f = new FieldAny("val");
    expect(f.isValid("string")).toBe(true);
    expect(f.isValid(42)).toBe(true);
    expect(f.isValid(null)).toBe(true);
    expect(f.isValid(undefined)).toBe(true);
    expect(f.isValid({ a: 1 })).toBe(true);
  });

  test("coercer returns value as-is", () => {
    const f = new FieldAny("val");
    const obj = { x: 1 };
    expect(f.coerceOr(obj)).toBe(obj);
  });

  test("default value is null", () => {
    expectFieldDefault(FieldAny, "val", null);
  });

  test("proto: setVal and updateVal", () => {
    const Cls = classFromData("AnyOps", {
      fields: { val: { type: "any", defaultValue: null } },
    });
    const inst = Cls();
    expect(inst.get("val")).toBe(null);

    const r = inst.setVal("hello");
    expect(r.get("val")).toBe("hello");
    expect(r.updateVal((v) => v.toUpperCase()).get("val")).toBe("HELLO");
  });

  test("proto: isValNotSet and isValSet", () => {
    const Cls = classFromData("AnyCheck", {
      fields: { val: { type: "any", defaultValue: null } },
    });
    const inst = Cls();
    expect(inst.isValNotSet()).toBe(true);
    expect(inst.isValSet()).toBe(false);

    const r = inst.setVal("something");
    expect(r.isValNotSet()).toBe(false);
    expect(r.isValSet()).toBe(true);
  });

  test("proto: resetVal", () => {
    const Cls = classFromData("AnyReset", {
      fields: { val: { type: "any", defaultValue: null } },
    });
    const r = Cls().setVal(42).resetVal();
    expect(r.get("val")).toBe(null);
  });
});
