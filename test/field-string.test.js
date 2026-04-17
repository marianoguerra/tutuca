import { describe, expect, test } from "bun:test";
import { classFromData, FieldString } from "../src/oo.js";
import { expectFieldDefault, expectFieldRegistered } from "./dom.js";

describe("FieldString", () => {
  test("is registered in fieldsByTypeName as 'text'", () => {
    expectFieldRegistered("text", FieldString);
  });

  test("validates strings", () => {
    const f = new FieldString("label");
    expect(f.isValid("hello")).toBe(true);
    expect(f.isValid("")).toBe(true);
    expect(f.isValid(42)).toBe(false);
    expect(f.isValid(null)).toBe(false);
  });

  test("coerces via toString", () => {
    const f = new FieldString("label");
    expect(f.coerceOr(42)).toBe("42");
    expect(f.coerceOr(true)).toBe("true");
  });

  test("default value is empty string", () => {
    expectFieldDefault(FieldString, "label", "");
  });

  test("classFromData detects string", () => {
    const Cls = classFromData("WithStr", { fields: { label: "hi" } });
    expect(Cls().get("label")).toBe("hi");
  });

  test("proto: isLabelEmpty and labelLen", () => {
    const Cls = classFromData("StrSize", { fields: { label: "" } });
    const empty = Cls();
    expect(empty.isLabelEmpty()).toBe(true);
    expect(empty.labelLen()).toBe(0);

    const withText = empty.setLabel("hello");
    expect(withText.isLabelEmpty()).toBe(false);
    expect(withText.labelLen()).toBe(5);
  });

  test("proto: setLabel coerces number to string", () => {
    const Cls = classFromData("StrCoerce", { fields: { label: "" } });
    expect(Cls().setLabel(123).get("label")).toBe("123");
  });

  test("proto: resetLabel", () => {
    const Cls = classFromData("StrReset", { fields: { label: "default" } });
    const r = Cls().setLabel("changed").resetLabel();
    expect(r.get("label")).toBe("default");
  });

  test("proto: updateLabel", () => {
    const Cls = classFromData("StrUpdate", { fields: { label: "hello" } });
    const r = Cls().updateLabel((v) => v.toUpperCase());
    expect(r.get("label")).toBe("HELLO");
  });
});
