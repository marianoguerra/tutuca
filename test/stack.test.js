import { BindFrame, ObjectFrame, NEXT, Pair, STOP } from "../src/stack.js";
import { describe, expect, test } from "bun:test";

const pair = (a, b = null) => new Pair(a, b);
const binds = (it, bindings = {}, isFrame = true) => new BindFrame(it, bindings, isFrame);
const obinds = (bindings = {}) => new ObjectFrame(bindings);
describe("Stack", () => {
  test("single item pair iterates", () => {
    const p = pair(10);
    expect([...p]).toEqual([10]);
  });

  test("multi item pair iterates in the right order", () => {
    const p = pair(10);
    expect([...p.push(20)]).toEqual([20, 10]);
    expect([...p.push(20).push(30)]).toEqual([30, 20, 10]);
  });
});
describe("BindFrame", () => {
  test("lookup works for isFrame=true", () => {
    const b = binds(10, { count: 20 }, true);
    expect(b.it).toBe(10);
    expect(b.lookup("it")).toBe(STOP);
    expect(b.lookup("foo")).toBe(STOP);
    expect(b.lookup("count")).toBe(20);
  });
  test("lookup works for isFrame=false", () => {
    const b = binds(10, { count: 20 }, false);
    expect(b.it).toBe(10);
    expect(b.lookup("it")).toBe(NEXT);
    expect(b.lookup("foo")).toBe(NEXT);
    expect(b.lookup("count")).toBe(20);
  });
  test("lookup works for isFrame=true in a pair", () => {
    const p = pair(binds(1, { foo: 10 }, false)).push(binds(2, { bar: 20 }, true));
    expect(p.lookup("bar")).toBe(20);
    expect(p.lookup("foo")).toBe(null);
  });
  test("lookup works for isFrame=false in a pair", () => {
    const p = pair(binds(1, { foo: 10 }, false)).push(binds(2, { bar: 20 }, false));
    expect(p.lookup("bar")).toBe(20);
    expect(p.lookup("foo")).toBe(10);
  });
});
describe("ObjectFrame", () => {
  test("lookup works", () => {
    const b = obinds({ count: 20 });
    expect(b.lookup("foo")).toBe(NEXT);
    expect(b.lookup("count")).toBe(20);
  });
  test("symbols are valid key", () => {
    const count = Symbol("count");
    const count1 = Symbol("count");
    const b = obinds({ [count]: 20 });
    expect(b.lookup(count1)).toBe(NEXT);
    expect(b.lookup("count")).toBe(NEXT);
    expect(b.lookup(count)).toBe(20);
  });
  test("lookup works in a pair", () => {
    const p = pair(obinds({ foo: 10 })).push(obinds({ bar: 20 }));
    expect(p.lookup("bar")).toBe(20);
    expect(p.lookup("foo")).toBe(10);
  });
});
