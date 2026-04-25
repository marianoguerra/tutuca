import { describe, expect, test } from "bun:test";
import { NullDomCache, WeakMapDomCache } from "../src/cache.js";

describe("NullDomCache", () => {
  test("get/set are no-ops and evict returns zeroed stats", () => {
    const c = new NullDomCache();
    c.set([{}, {}], "ck", 1);
    expect(c.get([{}, {}], "ck")).toBeUndefined();
    expect(c.evict()).toEqual({ hit: 0, miss: 0, badKey: 0 });
  });
});

describe("WeakMapDomCache get/set", () => {
  for (const n of [1, 2, 3, 4]) {
    describe(`length ${n}`, () => {
      const makeKeys = () => Array.from({ length: n }, () => ({}));

      test("set then get returns the stored value", () => {
        const c = new WeakMapDomCache();
        const keys = makeKeys();
        c.set(keys, "ck", 42);
        expect(c.get(keys, "ck")).toBe(42);
        expect(c.evict()).toEqual({ hit: 1, miss: 0, badKey: 0 });
      });

      test("get with unknown keys counts a miss", () => {
        const c = new WeakMapDomCache();
        expect(c.get(makeKeys(), "ck")).toBeUndefined();
        expect(c.evict()).toEqual({ hit: 0, miss: 1, badKey: 0 });
      });

      test("get with the wrong cacheKey returns undefined", () => {
        const c = new WeakMapDomCache();
        const keys = makeKeys();
        c.set(keys, "a", 42);
        expect(c.get(keys, "b")).toBeUndefined();
      });

      test("multiple cacheKeys at the same path coexist", () => {
        const c = new WeakMapDomCache();
        const keys = makeKeys();
        c.set(keys, "a", 1);
        c.set(keys, "b", 2);
        expect(c.get(keys, "a")).toBe(1);
        expect(c.get(keys, "b")).toBe(2);
      });

      test("set overwrites the value at the same cacheKey", () => {
        const c = new WeakMapDomCache();
        const keys = makeKeys();
        c.set(keys, "ck", 1);
        c.set(keys, "ck", 2);
        expect(c.get(keys, "ck")).toBe(2);
      });

      test("different paths do not collide", () => {
        const c = new WeakMapDomCache();
        const keysA = makeKeys();
        const keysB = makeKeys();
        c.set(keysA, "ck", "A");
        c.set(keysB, "ck", "B");
        expect(c.get(keysA, "ck")).toBe("A");
        expect(c.get(keysB, "ck")).toBe("B");
      });

      if (n > 1) {
        test("changing only the last key returns undefined", () => {
          const c = new WeakMapDomCache();
          const keys = makeKeys();
          c.set(keys, "ck", 42);
          const other = [...keys.slice(0, -1), {}];
          expect(c.get(other, "ck")).toBeUndefined();
        });

        test("changing only the first key returns undefined", () => {
          const c = new WeakMapDomCache();
          const keys = makeKeys();
          c.set(keys, "ck", 42);
          const other = [{}, ...keys.slice(1)];
          expect(c.get(other, "ck")).toBeUndefined();
        });
      }

      test("primitive last key counts a badKey", () => {
        const c = new WeakMapDomCache();
        const keys = makeKeys();
        keys[n - 1] = "not-object";
        c.set(keys, "ck", 42);
        expect(c.evict().badKey).toBe(1);
      });

      if (n > 1) {
        test("primitive first key counts a badKey", () => {
          const c = new WeakMapDomCache();
          const keys = makeKeys();
          keys[0] = "not-object";
          c.set(keys, "ck", 42);
          expect(c.evict().badKey).toBe(1);
        });
      }

      test("evict resets stats and storage", () => {
        const c = new WeakMapDomCache();
        const keys = makeKeys();
        c.set(keys, "ck", 7);
        expect(c.get(keys, "ck")).toBe(7);
        expect(c.evict()).toEqual({ hit: 1, miss: 0, badKey: 0 });
        expect(c.get(keys, "ck")).toBeUndefined();
        expect(c.evict()).toEqual({ hit: 0, miss: 1, badKey: 0 });
      });

      test("falsy non-undefined values round-trip and count as hits", () => {
        const c = new WeakMapDomCache();
        const keys = makeKeys();
        c.set(keys, "zero", 0);
        c.set(keys, "null", null);
        c.set(keys, "empty", "");
        c.set(keys, "false", false);
        expect(c.get(keys, "zero")).toBe(0);
        expect(c.get(keys, "null")).toBeNull();
        expect(c.get(keys, "empty")).toBe("");
        expect(c.get(keys, "false")).toBe(false);
        expect(c.evict()).toEqual({ hit: 4, miss: 0, badKey: 0 });
      });

      test("counters accumulate across mixed hits, misses, and badKeys", () => {
        const c = new WeakMapDomCache();
        const keys = makeKeys();
        c.set(keys, "ck", 1);
        c.get(keys, "ck"); // hit
        c.get(keys, "ck"); // hit
        c.get(makeKeys(), "ck"); // miss
        c.get(makeKeys(), "ck"); // miss
        c.get(makeKeys(), "ck"); // miss
        const bad = makeKeys();
        bad[n - 1] = "primitive";
        c.set(bad, "ck", 2); // badKey
        expect(c.evict()).toEqual({ hit: 2, miss: 3, badKey: 1 });
      });

      if (n >= 2) {
        test("sibling paths sharing a prefix coexist", () => {
          const c = new WeakMapDomCache();
          const shared = Array.from({ length: n - 1 }, () => ({}));
          const keysA = [...shared, {}];
          const keysB = [...shared, {}];
          c.set(keysA, "ck", "A");
          c.set(keysB, "ck", "B");
          expect(c.get(keysA, "ck")).toBe("A");
          expect(c.get(keysB, "ck")).toBe("B");
        });
      }

      if (n >= 3) {
        test("primitive middle key counts a badKey", () => {
          const c = new WeakMapDomCache();
          const keys = makeKeys();
          keys[1] = "not-object";
          c.set(keys, "ck", 42);
          expect(c.evict().badKey).toBe(1);
        });
      }
    });
  }
});

describe("WeakMapDomCache paths of different lengths are independent", () => {
  test("shorter set then longer set: both coexist", () => {
    const c = new WeakMapDomCache();
    const a = {};
    const b = {};
    const cc = {};
    c.set([a, b], "ck", 1);
    c.set([a, b, cc], "ck", 2);
    expect(c.get([a, b], "ck")).toBe(1);
    expect(c.get([a, b, cc], "ck")).toBe(2);
    expect(c.evict()).toEqual({ hit: 2, miss: 0, badKey: 0 });
  });

  test("longer set then shorter set: both coexist", () => {
    const c = new WeakMapDomCache();
    const a = {};
    const b = {};
    const cc = {};
    c.set([a, b, cc], "ck", 1);
    c.set([a, b], "ck", 2);
    expect(c.get([a, b, cc], "ck")).toBe(1);
    expect(c.get([a, b], "ck")).toBe(2);
    expect(c.evict()).toEqual({ hit: 2, miss: 0, badKey: 0 });
  });

  test("get longer than stored path returns miss", () => {
    const c = new WeakMapDomCache();
    const a = {};
    const b = {};
    const cc = {};
    c.set([a, b], "ck", 1);
    expect(c.get([a, b, cc], "ck")).toBeUndefined();
    expect(c.evict().miss).toBe(1);
  });

  test("get shorter than stored path returns miss", () => {
    const c = new WeakMapDomCache();
    const a = {};
    const b = {};
    const cc = {};
    c.set([a, b, cc], "ck", 1);
    expect(c.get([a, b], "ck")).toBeUndefined();
    expect(c.evict().miss).toBe(1);
  });
});

describe("WeakMapDomCache empty path", () => {
  test("set with empty keys is badKey, get with empty keys is miss", () => {
    const c = new WeakMapDomCache();
    c.set([], "ck", 42);
    expect(c.get([], "ck")).toBeUndefined();
    expect(c.evict()).toEqual({ hit: 0, miss: 1, badKey: 1 });
  });
});
