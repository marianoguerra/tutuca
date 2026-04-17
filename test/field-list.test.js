import { describe, expect, test } from "bun:test";
import { List } from "../deps/immutable.js";
import { classFromData, FieldList } from "../src/oo.js";
import { expectFieldRegistered } from "./dom.js";

describe("FieldList", () => {
  test("is registered in fieldsByTypeName", () => {
    expectFieldRegistered("list", FieldList);
  });

  test("validates List values", () => {
    const f = new FieldList("items");
    expect(f.isValid(List())).toBe(true);
    expect(f.isValid(List([1, 2]))).toBe(true);
    expect(f.isValid([1, 2])).toBe(false);
    expect(f.isValid("nope")).toBe(false);
  });

  test("coerces arrays to List", () => {
    const f = new FieldList("items");
    const result = f.coerceOr([1, 2, 3]);
    expect(List.isList(result)).toBe(true);
    expect(result.size).toBe(3);
  });

  test("default value is empty List", () => {
    const f = new FieldList("items");
    expect(List.isList(f.defaultValue)).toBe(true);
    expect(f.defaultValue.size).toBe(0);
  });

  test("classFromData detects array", () => {
    const Cls = classFromData("WithList", { fields: { items: [1, 2, 3] } });
    const inst = Cls();
    expect(List.isList(inst.get("items"))).toBe(true);
    expect(inst.get("items").size).toBe(3);
  });

  test("classFromData detects List", () => {
    const Cls = classFromData("WithIList", {
      fields: { items: List(["a", "b"]) },
    });
    const inst = Cls();
    expect(List.isList(inst.get("items"))).toBe(true);
    expect(inst.get("items").size).toBe(2);
  });

  test("proto: isItemsEmpty and itemsLen", () => {
    const Cls = classFromData("ListSize", { fields: { items: [] } });
    const empty = Cls();
    expect(empty.isItemsEmpty()).toBe(true);
    expect(empty.itemsLen()).toBe(0);

    const withItems = empty.setItems(List([1, 2]));
    expect(withItems.isItemsEmpty()).toBe(false);
    expect(withItems.itemsLen()).toBe(2);
  });

  test("proto: pushInItems", () => {
    const Cls = classFromData("ListPush", { fields: { items: [] } });
    const r = Cls().pushInItems("a").pushInItems("b");
    expect(r.itemsLen()).toBe(2);
    expect(r.getInItemsAt(0)).toBe("a");
    expect(r.getInItemsAt(1)).toBe("b");
  });

  test("proto: insertInItemsAt", () => {
    const Cls = classFromData("ListInsert", { fields: { items: [1, 3] } });
    const r = Cls().insertInItemsAt(1, 2);
    expect(r.getInItemsAt(0)).toBe(1);
    expect(r.getInItemsAt(1)).toBe(2);
    expect(r.getInItemsAt(2)).toBe(3);
  });

  test("proto: setInItemsAt and getInItemsAt", () => {
    const Cls = classFromData("ListAccess", { fields: { items: ["a", "b", "c"] } });
    const inst = Cls();
    expect(inst.getInItemsAt(1)).toBe("b");
    expect(inst.setInItemsAt(1, "B").getInItemsAt(1)).toBe("B");
  });

  test("proto: updateInItemsAt", () => {
    const Cls = classFromData("ListUpd", { fields: { items: [10, 20, 30] } });
    const r = Cls().updateInItemsAt(1, (v) => v * 2);
    expect(r.getInItemsAt(1)).toBe(40);
  });

  test("proto: deleteInItemsAt / removeInItemsAt", () => {
    const Cls = classFromData("ListDel", { fields: { items: ["a", "b", "c"] } });
    const inst = Cls();

    const r = inst.deleteInItemsAt(1);
    expect(r.itemsLen()).toBe(2);
    expect(r.getInItemsAt(0)).toBe("a");
    expect(r.getInItemsAt(1)).toBe("c");

    expect(inst.removeInItemsAt(0).getInItemsAt(0)).toBe("b");
  });

  test("proto: setItems coerces array", () => {
    const Cls = classFromData("ListCoerce", { fields: { items: [] } });
    const r = Cls().setItems([4, 5, 6]);
    expect(List.isList(r.get("items"))).toBe(true);
    expect(r.itemsLen()).toBe(3);
  });

  test("proto: resetItems", () => {
    const Cls = classFromData("ListReset", { fields: { items: [] } });
    const r = Cls().pushInItems(1).pushInItems(2).resetItems();
    expect(r.itemsLen()).toBe(0);
  });
});
