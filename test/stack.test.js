import { describe, expect, test } from "vitest";
import { BindFrame, DynFrame, lookup, NEXT, STOP } from "../src/stack.js";

const binds = (it, bindings = {}, isFrame = true) => new BindFrame(it, bindings, isFrame);
const obinds = (bindings = {}, types = {}) => new DynFrame(bindings, types);
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
describe("DynFrame", () => {
  test("lookup works", () => {
    const b = obinds({ count: 20 });
    expect(b.lookup("foo")).toBe(NEXT);
    expect(b.lookup("count")).toBe(20);
  });
  // Values and types share one frame: `isTypeName` decides which half a name is
  // looked for in, so the two can never collide and nearest-ancestor-wins falls
  // out of frame order for both.
  test("a name is looked for in exactly one half, by its case", () => {
    const Cell = class {};
    const b = obinds({ color: "blue" }, { Cell });
    expect(b.lookup("color")).toBe("blue");
    expect(b.lookup("Cell")).toBe(Cell);
    expect(b.lookup("Color")).toBe(NEXT);
    expect(b.lookup("cell")).toBe(NEXT);
  });
  test("lookup works in a pair", () => {
    const p = [obinds({ bar: 20 }), [obinds({ foo: 10 }), null]];
    expect(lookup(p, "bar")).toBe(20);
    expect(lookup(p, "foo")).toBe(10);
  });
  // A frame is never a barrier, so the walk is a plain nearest-ancestor search:
  // the nearer publisher of a name shadows the further one.
  test("the nearest frame publishing a name wins", () => {
    const p = [obinds({ theme: "dark" }), [obinds({ theme: "light" }), null]];
    expect(lookup(p, "theme")).toBe("dark");
  });
});
