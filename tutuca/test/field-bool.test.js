import { expect, test } from "bun:test";
import { classFromData, FieldBool, fieldsByTypeName } from "../src/oo.js";

test("FieldBool is registered in fieldsByTypeName", () => {
  expect(fieldsByTypeName.bool).toBe(FieldBool);
});

test("FieldBool validates booleans", () => {
  const f = new FieldBool("on");
  expect(f.isValid(true)).toBe(true);
  expect(f.isValid(false)).toBe(true);
  expect(f.isValid(0)).toBe(false);
  expect(f.isValid("true")).toBe(false);
  expect(f.isValid(null)).toBe(false);
});

test("FieldBool coerces truthy/falsy to boolean", () => {
  const f = new FieldBool("on");
  expect(f.coerceOr(1)).toBe(true);
  expect(f.coerceOr(0)).toBe(false);
  expect(f.coerceOr("yes")).toBe(true);
  expect(f.coerceOr("")).toBe(false);
});

test("FieldBool default value is false", () => {
  const f = new FieldBool("on");
  expect(f.defaultValue).toBe(false);
});

test("classFromData detects boolean and creates FieldBool", () => {
  const Cls = classFromData("WithBool", { fields: { on: true } });
  const inst = Cls();
  expect(inst.get("on")).toBe(true);
});

test("proto: toggleOn", () => {
  const Cls = classFromData("BoolToggle", { fields: { on: false } });
  const inst = Cls();
  expect(inst.get("on")).toBe(false);
  const toggled = inst.toggleOn();
  expect(toggled.get("on")).toBe(true);
  const back = toggled.toggleOn();
  expect(back.get("on")).toBe(false);
});

test("proto: setOn coerces to boolean", () => {
  const Cls = classFromData("BoolSet", { fields: { on: false } });
  const inst = Cls();
  const r = inst.setOn(1);
  expect(r.get("on")).toBe(true);
  const r2 = r.setOn(0);
  expect(r2.get("on")).toBe(false);
});

test("proto: resetOn", () => {
  const Cls = classFromData("BoolReset", { fields: { on: true } });
  const inst = Cls().setOn(false);
  expect(inst.get("on")).toBe(false);
  const r = inst.resetOn();
  expect(r.get("on")).toBe(true);
});
