import { describe, expect, test } from "bun:test";
import { classFromData, FieldFloat } from "../src/oo.js";
import { expectFieldDefault, expectFieldRegistered } from "./dom.js";

describe("FieldFloat", () => {
  test("is registered in fieldsByTypeName", () => {
    expectFieldRegistered("float", FieldFloat);
  });

  test("validates finite numbers", () => {
    const f = new FieldFloat("ratio");
    expect(f.isValid(0)).toBe(true);
    expect(f.isValid(3.14)).toBe(true);
    expect(f.isValid(-1.5)).toBe(true);
    expect(f.isValid(NaN)).toBe(false);
    expect(f.isValid(Infinity)).toBe(false);
    expect(f.isValid("3.14")).toBe(false);
  });

  test("does not coerce", () => {
    const f = new FieldFloat("ratio");
    expect(f.coerceOr("3.14")).toBe(null);
    expect(f.coerceOr(true)).toBe(null);
  });

  test("default value is 0", () => {
    expectFieldDefault(FieldFloat, "ratio", 0);
  });

  test("classFromData detects number", () => {
    const Cls = classFromData("WithFloat", { fields: { ratio: 2.5 } });
    expect(Cls().get("ratio")).toBe(2.5);
  });

  test("proto: setRatio and updateRatio", () => {
    const Cls = classFromData("FloatOps", { fields: { ratio: 1.0 } });
    const r = Cls().setRatio(3.14);
    expect(r.get("ratio")).toBe(3.14);
    expect(r.updateRatio((v) => v * 2).get("ratio")).toBe(6.28);
  });

  test("proto: resetRatio", () => {
    const Cls = classFromData("FloatReset", { fields: { ratio: 0.5 } });
    const r = Cls().setRatio(9.9).resetRatio();
    expect(r.get("ratio")).toBe(0.5);
  });
});
