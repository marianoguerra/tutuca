import { expect, test } from "bun:test";
import { classFromData, FieldFloat, fieldsByTypeName } from "../src/oo.js";

test("FieldFloat is registered in fieldsByTypeName", () => {
  expect(fieldsByTypeName.float).toBe(FieldFloat);
});

test("FieldFloat validates finite numbers", () => {
  const f = new FieldFloat("ratio");
  expect(f.isValid(0)).toBe(true);
  expect(f.isValid(3.14)).toBe(true);
  expect(f.isValid(-1.5)).toBe(true);
  expect(f.isValid(NaN)).toBe(false);
  expect(f.isValid(Infinity)).toBe(false);
  expect(f.isValid("3.14")).toBe(false);
});

test("FieldFloat does not coerce", () => {
  const f = new FieldFloat("ratio");
  expect(f.coerceOr("3.14")).toBe(null);
  expect(f.coerceOr(true)).toBe(null);
});

test("FieldFloat default value is 0", () => {
  const f = new FieldFloat("ratio");
  expect(f.defaultValue).toBe(0);
});

test("classFromData detects number and creates FieldFloat", () => {
  const Cls = classFromData("WithFloat", { fields: { ratio: 2.5 } });
  const inst = Cls();
  expect(inst.get("ratio")).toBe(2.5);
});

test("proto: setRatio and updateRatio", () => {
  const Cls = classFromData("FloatOps", { fields: { ratio: 1.0 } });
  const inst = Cls();
  const r = inst.setRatio(3.14);
  expect(r.get("ratio")).toBe(3.14);

  const r2 = r.updateRatio((v) => v * 2);
  expect(r2.get("ratio")).toBe(6.28);
});

test("proto: resetRatio", () => {
  const Cls = classFromData("FloatReset", { fields: { ratio: 0.5 } });
  const inst = Cls().setRatio(9.9);
  const r = inst.resetRatio();
  expect(r.get("ratio")).toBe(0.5);
});
