import { expect, test } from "bun:test";
import { OrderedMap } from "../deps/immutable.js";
import { classFromData, FieldOMap, fieldsByTypeName } from "../src/oo.js";

test("FieldOMap is registered in fieldsByTypeName", () => {
  expect(fieldsByTypeName.omap).toBe(FieldOMap);
});

test("FieldOMap validates OrderedMap values", () => {
  const f = new FieldOMap("data");
  expect(f.isValid(OrderedMap())).toBe(true);
  expect(f.isValid(OrderedMap({ a: 1 }))).toBe(true);
  expect(f.isValid({ a: 1 })).toBe(false);
  expect(f.isValid("nope")).toBe(false);
});

test("FieldOMap coerces to OrderedMap", () => {
  const f = new FieldOMap("data");
  const result = f.coerceOr({ a: 1 });
  expect(OrderedMap.isOrderedMap(result)).toBe(true);
  expect(result.get("a")).toBe(1);
});

test("FieldOMap default value is empty OrderedMap", () => {
  const f = new FieldOMap("data");
  expect(OrderedMap.isOrderedMap(f.defaultValue)).toBe(true);
  expect(f.defaultValue.size).toBe(0);
});

test("classFromData detects OrderedMap and creates FieldOMap", () => {
  const Cls = classFromData("WithOMap", {
    fields: { data: OrderedMap({ x: 1, y: 2 }) },
  });
  const inst = Cls();
  expect(OrderedMap.isOrderedMap(inst.get("data"))).toBe(true);
  expect(inst.get("data").get("x")).toBe(1);
});

test("proto: dataIsEmpty and dataLen", () => {
  const Cls = classFromData("OMapSize", {
    fields: { data: OrderedMap() },
  });
  const empty = Cls();
  expect(empty.dataIsEmpty()).toBe(true);
  expect(empty.dataLen()).toBe(0);

  const withData = empty.setData(OrderedMap({ a: 1 }));
  expect(withData.dataIsEmpty()).toBe(false);
  expect(withData.dataLen()).toBe(1);
});

test("proto: setInDataAt and getInDataAt", () => {
  const Cls = classFromData("OMapAccess", {
    fields: { data: OrderedMap({ k: "v" }) },
  });
  const inst = Cls();
  expect(inst.getInDataAt("k")).toBe("v");
  const r = inst.setInDataAt("k", "v2");
  expect(r.getInDataAt("k")).toBe("v2");
});

test("proto: updateInDataAt", () => {
  const Cls = classFromData("OMapUpd", {
    fields: { data: OrderedMap({ n: 5 }) },
  });
  const inst = Cls();
  const r = inst.updateInDataAt("n", (v) => v * 3);
  expect(r.getInDataAt("n")).toBe(15);
});

test("proto: deleteInDataAt / removeInDataAt", () => {
  const Cls = classFromData("OMapDel", {
    fields: { data: OrderedMap({ a: 1, b: 2 }) },
  });
  const inst = Cls();
  const r = inst.deleteInDataAt("a");
  expect(r.dataLen()).toBe(1);

  const r2 = inst.removeInDataAt("b");
  expect(r2.dataLen()).toBe(1);
});

test("proto: preserves insertion order", () => {
  const Cls = classFromData("OMapOrder", {
    fields: { data: OrderedMap() },
  });
  const inst = Cls()
    .setData(OrderedMap())
    .setData(OrderedMap().set("b", 2).set("a", 1).set("c", 3));
  const keys = inst.get("data").keySeq().toArray();
  expect(keys).toEqual(["b", "a", "c"]);
});

test("proto: resetData", () => {
  const Cls = classFromData("OMapReset", {
    fields: { data: OrderedMap() },
  });
  const inst = Cls().setData(OrderedMap({ a: 1 }));
  expect(inst.dataLen()).toBe(1);
  const r = inst.resetData();
  expect(r.dataLen()).toBe(0);
});
