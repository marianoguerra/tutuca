import { expect, test } from "bun:test";
import { classFromData, FieldString, fieldsByTypeName } from "../src/oo.js";

test("FieldString is registered in fieldsByTypeName", () => {
  expect(fieldsByTypeName.text).toBe(FieldString);
});

test("FieldString validates strings", () => {
  const f = new FieldString("label");
  expect(f.isValid("hello")).toBe(true);
  expect(f.isValid("")).toBe(true);
  expect(f.isValid(42)).toBe(false);
  expect(f.isValid(null)).toBe(false);
});

test("FieldString coerces via toString", () => {
  const f = new FieldString("label");
  expect(f.coerceOr(42)).toBe("42");
  expect(f.coerceOr(true)).toBe("true");
});

test("FieldString default value is empty string", () => {
  const f = new FieldString("label");
  expect(f.defaultValue).toBe("");
});

test("classFromData detects string and creates FieldString", () => {
  const Cls = classFromData("WithStr", { fields: { label: "hi" } });
  const inst = Cls();
  expect(inst.get("label")).toBe("hi");
});

test("proto: labelIsEmpty and labelLen", () => {
  const Cls = classFromData("StrSize", { fields: { label: "" } });
  const empty = Cls();
  expect(empty.labelIsEmpty()).toBe(true);
  expect(empty.labelLen()).toBe(0);

  const withText = empty.setLabel("hello");
  expect(withText.labelIsEmpty()).toBe(false);
  expect(withText.labelLen()).toBe(5);
});

test("proto: setLabel coerces number to string", () => {
  const Cls = classFromData("StrCoerce", { fields: { label: "" } });
  const inst = Cls();
  const r = inst.setLabel(123);
  expect(r.get("label")).toBe("123");
});

test("proto: resetLabel", () => {
  const Cls = classFromData("StrReset", { fields: { label: "default" } });
  const inst = Cls().setLabel("changed");
  expect(inst.get("label")).toBe("changed");
  const r = inst.resetLabel();
  expect(r.get("label")).toBe("default");
});

test("proto: updateLabel", () => {
  const Cls = classFromData("StrUpdate", { fields: { label: "hello" } });
  const inst = Cls();
  const r = inst.updateLabel((v) => v.toUpperCase());
  expect(r.get("label")).toBe("HELLO");
});
