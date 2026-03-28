import { expect, test } from "bun:test";
import { classFromData, FieldAny, fieldsByTypeName } from "../src/oo.js";

test("FieldAny is registered in fieldsByTypeName", () => {
  expect(fieldsByTypeName.any).toBe(FieldAny);
});

test("FieldAny validates any value", () => {
  const f = new FieldAny("val");
  expect(f.isValid("string")).toBe(true);
  expect(f.isValid(42)).toBe(true);
  expect(f.isValid(null)).toBe(true);
  expect(f.isValid(undefined)).toBe(true);
  expect(f.isValid({ a: 1 })).toBe(true);
});

test("FieldAny coercer returns value as-is", () => {
  const f = new FieldAny("val");
  const obj = { x: 1 };
  expect(f.coerceOr(obj)).toBe(obj);
});

test("FieldAny default value is null", () => {
  const f = new FieldAny("val");
  expect(f.defaultValue).toBe(null);
});

test("proto: setVal and updateVal", () => {
  const Cls = classFromData("AnyOps", {
    fields: { val: { type: "any", defaultValue: null } },
  });
  const inst = Cls();
  expect(inst.get("val")).toBe(null);

  const r = inst.setVal("hello");
  expect(r.get("val")).toBe("hello");

  const r2 = r.updateVal((v) => v.toUpperCase());
  expect(r2.get("val")).toBe("HELLO");
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
  const inst = Cls().setVal(42);
  expect(inst.get("val")).toBe(42);
  const r = inst.resetVal();
  expect(r.get("val")).toBe(null);
});
