import { describe, expect, test } from "bun:test";
import { Map as IMap, OrderedMap as IOrderedMap } from "../deps/immutable.js";
import { component } from "../index.js";
import { collectIterBindings } from "../src/util/testing.js";

const Items = component({
  name: "Items",
  fields: { items: [], multiplier: 1 },
  alter: {
    keepEvenKeys(k) {
      return k % 2 === 0;
    },
    keepNone() {
      return false;
    },
    addLabel(binds, k, v) {
      binds.label = `${k}:${v}`;
    },
    addThisMultiplier(binds, _k, v) {
      binds.scaled = v * this.multiplier;
    },
    loopMeta(seq) {
      const len = seq.length ?? seq.size;
      return { iterData: { len, evens: len % 2 === 0 } };
    },
    keepIfDataEvens(_k, _v, { evens }) {
      return evens;
    },
    countingLoop(seq) {
      this.loopCalls = (this.loopCalls ?? 0) + 1;
      return { iterData: { seq } };
    },
    enrichFromLoop(binds, _k, _v, { len }) {
      binds.len = len;
    },
    sliceMiddle() {
      return { start: 1, end: 3 };
    },
    sliceFromOne() {
      return { start: 1 };
    },
    dropLastTwo() {
      return { end: -2 };
    },
    sliceEmpty() {
      return { start: 100, end: 200 };
    },
    sliceReversed() {
      return { start: 3, end: 1 };
    },
    sliceWithData(seq) {
      return { iterData: { len: seq.length ?? seq.size }, start: 1, end: 3 };
    },
    // returns an explicit (reordered) keys slice
    pickKeys() {
      return { keys: [3, 1] };
    },
    // uses ctx.filter (wraps @when) to build a keys slice
    pickKeysViaFilter(seq, { filter }) {
      const keys = [];
      for (let i = 0; i < (seq.length ?? seq.size); i++) {
        const v = Array.isArray(seq) ? seq[i] : seq.get(i);
        if (filter(i, v)) keys.push(i);
      }
      return { keys };
    },
    // uses ctx.lookup to forward keys a scope enrich already built
    forwardScopeKeys(_seq, { lookup }) {
      return { keys: lookup("__keys__") };
    },
    // a scope @enrich-with that publishes the keys (no per-item binds args)
    buildScopeKeys() {
      return { __keys__: [2, 0] };
    },
  },
});

describe("collectIterBindings", () => {
  test("no handlers — returns key/value for each item", () => {
    const it = Items.make({ items: [10, 20, 30] });
    const r = collectIterBindings(Items, it, [10, 20, 30]);
    expect(r).toEqual([
      { key: 0, value: 10 },
      { key: 1, value: 20 },
      { key: 2, value: 30 },
    ]);
  });

  test("when filter only", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40], { when: "keepEvenKeys" });
    expect(r).toEqual([
      { key: 0, value: 10 },
      { key: 2, value: 30 },
    ]);
  });

  test("loop-with feeds when", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40], {
      loopWith: "loopMeta",
      when: "keepIfDataEvens",
    });
    expect(r.length).toBe(4);
  });

  test("loop-with feeds when — odd-length seq filtered out entirely", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30], {
      loopWith: "loopMeta",
      when: "keepIfDataEvens",
    });
    expect(r).toEqual([]);
  });

  test("enrich-with mutates binds", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, ["a", "b"], { enrichWith: "addLabel" });
    expect(r).toEqual([
      { key: 0, value: "a", label: "0:a" },
      { key: 1, value: "b", label: "1:b" },
    ]);
  });

  test("all three handlers together", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40], {
      loopWith: "loopMeta",
      when: "keepEvenKeys",
      enrichWith: "enrichFromLoop",
    });
    expect(r).toEqual([
      { key: 0, value: 10, len: 4 },
      { key: 2, value: 30, len: 4 },
    ]);
  });

  test("keyed seq — key is the map key, not numeric index", () => {
    const it = Items.make();
    const seq = IMap({ a: 1, b: 2, c: 3 });
    const r = collectIterBindings(Items, it, seq);
    expect(r.map((b) => b.key).sort()).toEqual(["a", "b", "c"]);
    expect(r.map((b) => b.value).sort()).toEqual([1, 2, 3]);
  });

  test("compInstance is `this` for handlers", () => {
    const it = Items.make({ multiplier: 7 });
    const r = collectIterBindings(Items, it, [1, 2, 3], { enrichWith: "addThisMultiplier" });
    expect(r).toEqual([
      { key: 0, value: 1, scaled: 7 },
      { key: 1, value: 2, scaled: 14 },
      { key: 2, value: 3, scaled: 21 },
    ]);
  });

  test("unknown handler name throws", () => {
    const it = Items.make();
    expect(() => collectIterBindings(Items, it, [1, 2], { when: "doesNotExist" })).toThrow(
      /alter handler 'doesNotExist' not found on component 'Items'/,
    );
  });

  test("empty seq returns []", () => {
    const it = Items.make();
    expect(collectIterBindings(Items, it, [])).toEqual([]);
  });

  test("filter excludes everything — loopWith still runs once", () => {
    const it = Items.make();
    it.loopCalls = 0;
    const r = collectIterBindings(Items, it, [1, 2, 3], {
      loopWith: "countingLoop",
      when: "keepNone",
    });
    expect(r).toEqual([]);
    expect(it.loopCalls).toBe(1);
  });
});

describe("collectIterBindings — @loop-with slicing", () => {
  test("start/end window keeps original keys", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40, 50], { loopWith: "sliceMiddle" });
    expect(r).toEqual([
      { key: 1, value: 20 },
      { key: 2, value: 30 },
    ]);
  });

  test("start only drops the prefix", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30], { loopWith: "sliceFromOne" });
    expect(r).toEqual([
      { key: 1, value: 20 },
      { key: 2, value: 30 },
    ]);
  });

  test("negative end drops the suffix", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40], { loopWith: "dropLastTwo" });
    expect(r).toEqual([
      { key: 0, value: 10 },
      { key: 1, value: 20 },
    ]);
  });

  test("start beyond size yields nothing", () => {
    const it = Items.make();
    expect(collectIterBindings(Items, it, [10, 20, 30], { loopWith: "sliceEmpty" })).toEqual([]);
  });

  test("end before start yields nothing", () => {
    const it = Items.make();
    expect(collectIterBindings(Items, it, [10, 20, 30, 40], { loopWith: "sliceReversed" })).toEqual(
      [],
    );
  });

  test("iterData coexists with start/end", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40, 50], {
      loopWith: "sliceWithData",
      enrichWith: "enrichFromLoop",
    });
    expect(r).toEqual([
      { key: 1, value: 20, len: 5 },
      { key: 2, value: 30, len: 5 },
    ]);
  });

  test("slice composes with when (window then filter)", () => {
    const it = Items.make();
    // window is keys 1..3; keepEvenKeys then keeps only key 2
    const r = collectIterBindings(Items, it, [10, 20, 30, 40, 50], {
      loopWith: "sliceMiddle",
      when: "keepEvenKeys",
    });
    expect(r).toEqual([{ key: 2, value: 30 }]);
  });

  test("keyed seq — positional slice keeps map keys", () => {
    const it = Items.make();
    const seq = IOrderedMap([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    const r = collectIterBindings(Items, it, seq, { loopWith: "sliceMiddle" });
    expect(r).toEqual([
      { key: "b", value: 2 },
      { key: "c", value: 3 },
    ]);
  });
});

describe("collectIterBindings — @loop-with keys + ctx", () => {
  test("a keys return visits exactly those keys, in order", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40], { loopWith: "pickKeys" });
    expect(r).toEqual([
      { key: 3, value: 40 },
      { key: 1, value: 20 },
    ]);
  });

  test("a keys return is authoritative — @when is NOT re-applied", () => {
    const it = Items.make();
    // keepNone would drop everything, but the keys return bypasses it
    const r = collectIterBindings(Items, it, [10, 20, 30, 40], {
      loopWith: "pickKeys",
      when: "keepNone",
    });
    expect(r).toEqual([
      { key: 3, value: 40 },
      { key: 1, value: 20 },
    ]);
  });

  test("ctx.filter wraps @when so the handler can reuse the predicate", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40], {
      loopWith: "pickKeysViaFilter",
      when: "keepEvenKeys",
    });
    expect(r).toEqual([
      { key: 0, value: 10 },
      { key: 2, value: 30 },
    ]);
  });

  test("ctx.lookup reads a scope @enrich-with's published bindings", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40], {
      loopWith: "forwardScopeKeys",
      scopeEnrich: "buildScopeKeys",
    });
    expect(r).toEqual([
      { key: 2, value: 30 },
      { key: 0, value: 10 },
    ]);
  });

  test("ctx.lookup can also be supplied via opts.scope", () => {
    const it = Items.make();
    const r = collectIterBindings(Items, it, [10, 20, 30, 40], {
      loopWith: "forwardScopeKeys",
      scope: { __keys__: [1] },
    });
    expect(r).toEqual([{ key: 1, value: 20 }]);
  });
});
