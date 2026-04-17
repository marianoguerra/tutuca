import { describe, expect, test } from "bun:test";
import { Map as IMap } from "../deps/immutable.js";
import { classFromData, FieldMap } from "../src/oo.js";
import { expectFieldRegistered } from "./dom.js";

describe("FieldMap", () => {
  test("is registered in fieldsByTypeName", () => {
    expectFieldRegistered("map", FieldMap);
  });

  test("validates IMap values", () => {
    const f = new FieldMap("data");
    expect(f.isValid(IMap())).toBe(true);
    expect(f.isValid(IMap({ a: 1 }))).toBe(true);
    expect(f.isValid({ a: 1 })).toBe(false);
    expect(f.isValid("nope")).toBe(false);
  });

  test("coerces plain objects to IMap", () => {
    const f = new FieldMap("data");
    const result = f.coerceOr({ a: 1, b: 2 });
    expect(IMap.isMap(result)).toBe(true);
    expect(result.get("a")).toBe(1);
  });

  test("default value is empty IMap", () => {
    const f = new FieldMap("data");
    expect(IMap.isMap(f.defaultValue)).toBe(true);
    expect(f.defaultValue.size).toBe(0);
  });

  test("classFromData detects plain object", () => {
    const Cls = classFromData("WithMap", { fields: { data: { a: 1, b: 2 } } });
    const inst = Cls();
    expect(IMap.isMap(inst.get("data"))).toBe(true);
    expect(inst.get("data").get("a")).toBe(1);
  });

  test("classFromData detects IMap", () => {
    const Cls = classFromData("WithIMap", {
      fields: { data: IMap({ x: 10 }) },
    });
    const inst = Cls();
    expect(IMap.isMap(inst.get("data"))).toBe(true);
    expect(inst.get("data").get("x")).toBe(10);
  });

  test("proto: isDataEmpty and dataLen", () => {
    const Cls = classFromData("MapSize", { fields: { data: IMap() } });
    const empty = Cls();
    expect(empty.isDataEmpty()).toBe(true);
    expect(empty.dataLen()).toBe(0);

    const withData = empty.setData(IMap({ a: 1, b: 2 }));
    expect(withData.isDataEmpty()).toBe(false);
    expect(withData.dataLen()).toBe(2);
  });

  test("proto: setInDataAt and getInDataAt", () => {
    const Cls = classFromData("MapAccess", { fields: { data: IMap({ k: "v" }) } });
    const inst = Cls();
    expect(inst.getInDataAt("k")).toBe("v");
    expect(inst.setInDataAt("k", "v2").getInDataAt("k")).toBe("v2");
  });

  test("proto: updateInDataAt", () => {
    const Cls = classFromData("MapUpd", { fields: { data: IMap({ n: 5 }) } });
    const r = Cls().updateInDataAt("n", (v) => v * 3);
    expect(r.getInDataAt("n")).toBe(15);
  });

  test("proto: deleteInDataAt / removeInDataAt", () => {
    const Cls = classFromData("MapDel", {
      fields: { data: IMap({ a: 1, b: 2 }) },
    });
    const inst = Cls();

    const r = inst.deleteInDataAt("a");
    expect(r.dataLen()).toBe(1);
    expect(r.getInDataAt("a", "gone")).toBe("gone");

    expect(inst.removeInDataAt("b").dataLen()).toBe(1);
  });

  test("proto: setData coerces plain object", () => {
    const Cls = classFromData("MapCoerce", { fields: { data: IMap() } });
    const r = Cls().setData({ x: 1 });
    expect(IMap.isMap(r.get("data"))).toBe(true);
    expect(r.getInDataAt("x")).toBe(1);
  });

  test("proto: resetData", () => {
    const Cls = classFromData("MapReset", { fields: { data: IMap() } });
    const r = Cls().setData(IMap({ a: 1 })).resetData();
    expect(r.dataLen()).toBe(0);
  });
});
