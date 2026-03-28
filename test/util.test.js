import { Map as IMap, List } from "../deps/immutable.js";
import { KList } from "../extra/klist.js";
import { describe, expect, test } from "bun:test";

describe("KList", () => {
  test("Constructor creates empty KList", () => {
    const kl = new KList();
    expect(kl.size).toBe(0);
    expect(IMap.isMap(kl.items)).toBeTruthy();
    expect(List.isList(kl.order)).toBeTruthy();
  });

  test("Constructor with initial data", () => {
    const kl = new KList(IMap({ a: 1 }), List(["a"]));
    expect(kl.size).toBe(1);
    expect(kl.get("a")).toBe(1);
  });

  test("set() on empty KList", () => {
    const kl = new KList();
    const kl2 = kl.set("a", 1);

    expect(kl.size).toBe(0); // original unchanged
    expect(kl2.size).toBe(1);
    expect(kl2.get("a")).toBe(1);
    expect(kl2.order.toArray()).toEqual(["a"]);
  });

  test("set() multiple items", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("c", 3);

    expect(kl.size).toBe(3);
    expect(kl.get("a")).toBe(1);
    expect(kl.get("b")).toBe(2);
    expect(kl.get("c")).toBe(3);
    expect(kl.order.toArray()).toEqual(["a", "b", "c"]);
  });

  test("set() existing key doesn't change order", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("a", 10);

    expect(kl.size).toBe(2);
    expect(kl.get("a")).toBe(10);
    expect(kl.get("b")).toBe(2);
    expect(kl.order.toArray()).toEqual(["a", "b"]);
  });

  test("set() existing key changes value", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("a", 10);

    expect(kl.size).toBe(2);
    expect(kl.get("a")).toBe(10);
    expect(kl.get("b")).toBe(2);
    expect(kl.order.toArray()).toEqual(["a", "b"]);
  });

  test("set() existing key changes value", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("a", 10);

    expect(kl.size).toBe(2);
    expect(kl.get("a")).toBe(10);
    expect(kl.get("b")).toBe(2);
    expect(kl.order.toArray()).toEqual(["a", "b"]);
  });

  test("get() with default value", () => {
    const kl = new KList().set("a", 1);

    expect(kl.get("a")).toBe(1);
    expect(kl.get("b")).toBe(null);
    expect(kl.get("b", "default")).toBe("default");
  });

  test("delete() from empty KList", () => {
    const kl = new KList();
    const kl2 = kl.delete("a");

    expect(kl2.size).toBe(0);
    expect(kl).toBe(kl2); // should return same instance
  });

  test("delete() single item", () => {
    const kl = new KList().set("a", 1);
    const kl2 = kl.delete("a");

    expect(kl.size).toBe(1);
    expect(kl2.size).toBe(0);
    expect(kl2.get("a")).toBe(null);
    expect(kl2.order.toArray()).toEqual([]);
  });

  test("delete() from multiple items", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("c", 3);

    const kl2 = kl.delete("b");

    expect(kl2.size).toBe(2);
    expect(kl2.get("a")).toBe(1);
    expect(kl2.get("b")).toBe(null);
    expect(kl2.get("c")).toBe(3);
    expect(kl2.order.toArray()).toEqual(["a", "c"]);
  });

  test("delete() non-existent key", () => {
    const kl = new KList().set("a", 1);
    const kl2 = kl.delete("b");

    expect(kl).toBe(kl2); // should return same instance
    expect(kl2.size).toBe(1);
    expect(kl2.get("a")).toBe(1);
  });

  test("moveKeyBeforeKey() with empty KList", () => {
    const kl = new KList();
    const kl2 = kl.moveKeyBeforeKey("a", "b");

    expect(kl).toBe(kl2); // should return same instance
  });

  test("moveKeyBeforeKey() with non-existent keys", () => {
    const kl = new KList().set("a", 1);
    const kl2 = kl.moveKeyBeforeKey("b", "c");

    expect(kl).toBe(kl2); // should return same instance
    expect(kl2.order.toArray()).toEqual(["a"]);
  });

  test("moveKeyBeforeKey() same key", () => {
    const kl = new KList().set("a", 1);
    const kl2 = kl.moveKeyBeforeKey("a", "a");

    expect(kl).toBe(kl2); // should return same instance
  });

  test("moveKeyBeforeKey() two items", () => {
    const kl = new KList().set("a", 1).set("b", 2);

    const kl2 = kl.moveKeyBeforeKey("b", "a");

    expect(kl2.order.toArray()).toEqual(["b", "a"]);
    expect(kl2.get("a")).toBe(1);
    expect(kl2.get("b")).toBe(2);
  });

  test("moveKeyBeforeKey() three items - move middle to front", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("c", 3);

    const kl2 = kl.moveKeyBeforeKey("b", "a");

    expect(kl2.order.toArray()).toEqual(["b", "a", "c"]);
  });

  test("moveKeyBeforeKey() three items - move last to middle", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("c", 3);

    const kl2 = kl.moveKeyBeforeKey("c", "b");

    expect(kl2.order.toArray()).toEqual(["a", "c", "b"]);
  });

  test("moveKeyBeforeKey() three items - move first to end", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("c", 3);

    const kl2 = kl.moveKeyBeforeKey("a", "c");

    expect(kl2.order.toArray()).toEqual(["b", "a", "c"]);
  });

  test("moveKeyAfterKey() with empty KList", () => {
    const kl = new KList();
    const kl2 = kl.moveKeyAfterKey("a", "b");

    expect(kl).toBe(kl2); // should return same instance
  });

  test("moveKeyAfterKey() with non-existent keys", () => {
    const kl = new KList().set("a", 1);
    const kl2 = kl.moveKeyAfterKey("b", "c");

    expect(kl).toBe(kl2); // should return same instance
    expect(kl2.order.toArray()).toEqual(["a"]);
  });

  test("moveKeyAfterKey() same key", () => {
    const kl = new KList().set("a", 1);
    const kl2 = kl.moveKeyAfterKey("a", "a");

    expect(kl).toBe(kl2); // should return same instance
  });

  test("moveKeyAfterKey() two items", () => {
    const kl = new KList().set("a", 1).set("b", 2);

    const kl2 = kl.moveKeyAfterKey("a", "b");

    expect(kl2.get("a")).toBe(1);
    expect(kl2.get("b")).toBe(2);
    expect(kl2.order.toArray()).toEqual(["b", "a"]);
  });

  test("moveKeyAfterKey() three items - move first after middle", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("c", 3);

    const kl2 = kl.moveKeyAfterKey("a", "b");

    expect(kl2.order.toArray()).toEqual(["b", "a", "c"]);
  });

  test("moveKeyAfterKey() three items - move middle after last", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("c", 3);

    const kl2 = kl.moveKeyAfterKey("b", "c");

    expect(kl2.order.toArray()).toEqual(["a", "c", "b"]);
  });

  test("moveKeyAfterKey() three items - move last after first", () => {
    const kl = new KList().set("a", 1).set("b", 2).set("c", 3);

    const kl2 = kl.moveKeyAfterKey("c", "a");

    expect(kl2.order.toArray()).toEqual(["a", "c", "b"]);
  });

  test("KList is immutable", () => {
    const kl = new KList().set("a", 1);
    const kl2 = kl.set("b", 2);
    const kl3 = kl2.delete("a");

    expect(kl.size).toBe(1);
    expect(kl2.size).toBe(2);
    expect(kl3.size).toBe(1);
    expect(kl.order.toArray()).toEqual(["a"]);
    expect(kl2.order.toArray()).toEqual(["a", "b"]);
    expect(kl3.order.toArray()).toEqual(["b"]);
  });

  test("Complex operations sequence", () => {
    const kl = new KList()
      .set("first", 1)
      .set("second", 2)
      .set("third", 3)
      .set("fourth", 4)
      .moveKeyAfterKey("first", "third")
      .moveKeyBeforeKey("fourth", "second")
      .set("first", 10)
      .delete("third");

    expect(kl.size).toBe(3);
    expect(kl.get("first")).toBe(10);
    expect(kl.get("second")).toBe(2);
    expect(kl.get("third")).toBe(null);
    expect(kl.get("fourth")).toBe(4);
    expect(kl.order.toArray()).toEqual(["fourth", "second", "first"]);
  });
});
