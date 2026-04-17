import { describe, expect, test } from "bun:test";
import { classFromData, FieldBool } from "../src/oo.js";
import { expectFieldDefault, expectFieldRegistered } from "./dom.js";

describe("FieldBool", () => {
  test("is registered in fieldsByTypeName", () => {
    expectFieldRegistered("bool", FieldBool);
  });

  test("validates booleans", () => {
    const f = new FieldBool("on");
    expect(f.isValid(true)).toBe(true);
    expect(f.isValid(false)).toBe(true);
    expect(f.isValid(0)).toBe(false);
    expect(f.isValid("true")).toBe(false);
    expect(f.isValid(null)).toBe(false);
  });

  test("coerces truthy/falsy to boolean", () => {
    const f = new FieldBool("on");
    expect(f.coerceOr(1)).toBe(true);
    expect(f.coerceOr(0)).toBe(false);
    expect(f.coerceOr("yes")).toBe(true);
    expect(f.coerceOr("")).toBe(false);
  });

  test("default value is false", () => {
    expectFieldDefault(FieldBool, "on", false);
  });

  test("classFromData detects boolean", () => {
    const Cls = classFromData("WithBool", { fields: { on: true } });
    expect(Cls().get("on")).toBe(true);
  });

  test("proto: toggleOn", () => {
    const Cls = classFromData("BoolToggle", { fields: { on: false } });
    const inst = Cls();
    expect(inst.get("on")).toBe(false);
    const toggled = inst.toggleOn();
    expect(toggled.get("on")).toBe(true);
    expect(toggled.toggleOn().get("on")).toBe(false);
  });

  test("proto: setOn coerces to boolean", () => {
    const Cls = classFromData("BoolSet", { fields: { on: false } });
    const inst = Cls();
    expect(inst.setOn(1).get("on")).toBe(true);
    expect(inst.setOn(0).get("on")).toBe(false);
  });

  test("proto: resetOn", () => {
    const Cls = classFromData("BoolReset", { fields: { on: true } });
    const inst = Cls().setOn(false);
    expect(inst.get("on")).toBe(false);
    expect(inst.resetOn().get("on")).toBe(true);
  });
});
