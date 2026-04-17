import { describe, expect, test } from "bun:test";
import { classFromData, FieldInt } from "../src/oo.js";
import { expectFieldDefault, expectFieldRegistered } from "./dom.js";

describe("FieldInt", () => {
  test("is registered in fieldsByTypeName", () => {
    expectFieldRegistered("int", FieldInt);
  });

  test("validates integers", () => {
    const f = new FieldInt("count");
    expect(f.isValid(0)).toBe(true);
    expect(f.isValid(42)).toBe(true);
    expect(f.isValid(-1)).toBe(true);
    expect(f.isValid(3.14)).toBe(false);
    expect(f.isValid("5")).toBe(false);
    expect(f.isValid(NaN)).toBe(false);
    expect(f.isValid(Infinity)).toBe(false);
  });

  test("coerces finite floats by truncating", () => {
    const f = new FieldInt("count");
    expect(f.coerceOr(3.7)).toBe(3);
    expect(f.coerceOr(-2.9)).toBe(-2);
  });

  test("does not coerce non-finite values", () => {
    const f = new FieldInt("count");
    expect(f.coerceOr(NaN)).toBe(null);
    expect(f.coerceOr(Infinity)).toBe(null);
    expect(f.coerceOr("5")).toBe(null);
  });

  test("default value is 0", () => {
    expectFieldDefault(FieldInt, "count", 0);
  });

  test("classFromData with type descriptor", () => {
    const Cls = classFromData("WithInt", {
      fields: { count: { type: "int", defaultValue: 10 } },
    });
    expect(Cls().get("count")).toBe(10);
  });

  test("proto: setCount and updateCount", () => {
    const Cls = classFromData("IntOps", {
      fields: { count: { type: "int", defaultValue: 0 } },
    });
    const r = Cls().setCount(5);
    expect(r.get("count")).toBe(5);
    expect(r.updateCount((v) => v + 1).get("count")).toBe(6);
  });

  test("proto: resetCount", () => {
    const Cls = classFromData("IntReset", {
      fields: { count: { type: "int", defaultValue: 42 } },
    });
    const inst = Cls().setCount(100);
    expect(inst.get("count")).toBe(100);
    expect(inst.resetCount().get("count")).toBe(42);
  });
});
