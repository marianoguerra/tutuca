import { expect, test } from "bun:test";
import { Map as IMap } from "../deps/immutable.js";
import { classFromData, FieldMap, fieldsByTypeName } from "../src/oo.js";

test("FieldMap is registered in fieldsByTypeName", () => {
  expect(fieldsByTypeName.map).toBe(FieldMap);
});

test("FieldMap validates IMap values", () => {
  const f = new FieldMap("data");
  expect(f.isValid(IMap())).toBe(true);
  expect(f.isValid(IMap({ a: 1 }))).toBe(true);
  expect(f.isValid({ a: 1 })).toBe(false);
  expect(f.isValid("nope")).toBe(false);
});

test("FieldMap coerces plain objects to IMap", () => {
  const f = new FieldMap("data");
  const result = f.coerceOr({ a: 1, b: 2 });
  expect(IMap.isMap(result)).toBe(true);
  expect(result.get("a")).toBe(1);
});

test("FieldMap default value is empty IMap", () => {
  const f = new FieldMap("data");
  expect(IMap.isMap(f.defaultValue)).toBe(true);
  expect(f.defaultValue.size).toBe(0);
});

test("classFromData detects plain object and creates FieldMap", () => {
  const Cls = classFromData("WithMap", { fields: { data: { a: 1, b: 2 } } });
  const inst = Cls();
  expect(IMap.isMap(inst.get("data"))).toBe(true);
  expect(inst.get("data").get("a")).toBe(1);
});

test("classFromData detects IMap and creates FieldMap", () => {
  const Cls = classFromData("WithIMap", {
    fields: { data: IMap({ x: 10 }) },
  });
  const inst = Cls();
  expect(IMap.isMap(inst.get("data"))).toBe(true);
  expect(inst.get("data").get("x")).toBe(10);
});

test("proto: dataIsEmpty and dataLen", () => {
  const Cls = classFromData("MapSize", { fields: { data: IMap() } });
  const empty = Cls();
  expect(empty.dataIsEmpty()).toBe(true);
  expect(empty.dataLen()).toBe(0);

  const withData = empty.setData(IMap({ a: 1, b: 2 }));
  expect(withData.dataIsEmpty()).toBe(false);
  expect(withData.dataLen()).toBe(2);
});

test("proto: setInDataAt and getInDataAt", () => {
  const Cls = classFromData("MapAccess", { fields: { data: IMap({ k: "v" }) } });
  const inst = Cls();
  expect(inst.getInDataAt("k")).toBe("v");
  const r = inst.setInDataAt("k", "v2");
  expect(r.getInDataAt("k")).toBe("v2");
});

test("proto: updateInDataAt", () => {
  const Cls = classFromData("MapUpd", { fields: { data: IMap({ n: 5 }) } });
  const inst = Cls();
  const r = inst.updateInDataAt("n", (v) => v * 3);
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

  const r2 = inst.removeInDataAt("b");
  expect(r2.dataLen()).toBe(1);
});

test("proto: setData coerces plain object", () => {
  const Cls = classFromData("MapCoerce", { fields: { data: IMap() } });
  const inst = Cls();
  const r = inst.setData({ x: 1 });
  expect(IMap.isMap(r.get("data"))).toBe(true);
  expect(r.getInDataAt("x")).toBe(1);
});

test("proto: resetData", () => {
  const Cls = classFromData("MapReset", { fields: { data: IMap() } });
  const inst = Cls().setData(IMap({ a: 1 }));
  expect(inst.dataLen()).toBe(1);
  const r = inst.resetData();
  expect(r.dataLen()).toBe(0);
});
