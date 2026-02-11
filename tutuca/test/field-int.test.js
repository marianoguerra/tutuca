import { expect, test } from "bun:test";
import { classFromData, FieldInt, fieldsByTypeName } from "../src/oo.js";

test("FieldInt is registered in fieldsByTypeName", () => {
  expect(fieldsByTypeName.int).toBe(FieldInt);
});

test("FieldInt validates integers", () => {
  const f = new FieldInt("count");
  expect(f.isValid(0)).toBe(true);
  expect(f.isValid(42)).toBe(true);
  expect(f.isValid(-1)).toBe(true);
  expect(f.isValid(3.14)).toBe(false);
  expect(f.isValid("5")).toBe(false);
  expect(f.isValid(NaN)).toBe(false);
  expect(f.isValid(Infinity)).toBe(false);
});

test("FieldInt coerces finite floats by truncating", () => {
  const f = new FieldInt("count");
  expect(f.coerceOr(3.7)).toBe(3);
  expect(f.coerceOr(-2.9)).toBe(-2);
});

test("FieldInt does not coerce non-finite values", () => {
  const f = new FieldInt("count");
  expect(f.coerceOr(NaN)).toBe(null);
  expect(f.coerceOr(Infinity)).toBe(null);
  expect(f.coerceOr("5")).toBe(null);
});

test("FieldInt default value is 0", () => {
  const f = new FieldInt("count");
  expect(f.defaultValue).toBe(0);
});

test("classFromData with type descriptor for int", () => {
  const Cls = classFromData("WithInt", {
    fields: { count: { type: "int", defaultValue: 10 } },
  });
  const inst = Cls();
  expect(inst.get("count")).toBe(10);
});

test("proto: setCount and updateCount", () => {
  const Cls = classFromData("IntOps", {
    fields: { count: { type: "int", defaultValue: 0 } },
  });
  const inst = Cls();
  const r = inst.setCount(5);
  expect(r.get("count")).toBe(5);

  const r2 = r.updateCount((v) => v + 1);
  expect(r2.get("count")).toBe(6);
});

test("proto: resetCount", () => {
  const Cls = classFromData("IntReset", {
    fields: { count: { type: "int", defaultValue: 42 } },
  });
  const inst = Cls().setCount(100);
  expect(inst.get("count")).toBe(100);
  const r = inst.resetCount();
  expect(r.get("count")).toBe(42);
});
