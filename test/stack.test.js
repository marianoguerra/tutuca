import { describe, expect, test } from "bun:test";
import { BindFrame, lookup, NEXT, ObjectFrame, STOP } from "../src/stack.js";

const binds = (it, bindings = {}, isFrame = true) => new BindFrame(it, bindings, isFrame);
const obinds = (bindings = {}) => new ObjectFrame(bindings);
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
    const p = [binds(2, { bar: 20 }, true), [binds(1, { foo: 10 }, false), null]];
    expect(lookup(p, "bar")).toBe(20);
    expect(lookup(p, "foo")).toBe(null);
  });
  test("lookup works for isFrame=false in a pair", () => {
    const p = [binds(2, { bar: 20 }, false), [binds(1, { foo: 10 }, false), null]];
    expect(lookup(p, "bar")).toBe(20);
    expect(lookup(p, "foo")).toBe(10);
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
    const p = [obinds({ bar: 20 }), [obinds({ foo: 10 }), null]];
    expect(lookup(p, "bar")).toBe(20);
    expect(lookup(p, "foo")).toBe(10);
  });
});
