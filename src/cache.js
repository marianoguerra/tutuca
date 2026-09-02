// A value can key a WeakMap only if it is a non-null object or a function.
// `typeof null === "object"`, so a plain `typeof k === "object"` check lets
// `null` through and `WeakMap.set(null, …)` then throws; primitives (strings,
// numbers, booleans, `undefined`, `null`) are not weakly holdable, so an entry
// keyed by one simply goes uncached.
const isWeakKey = (k) => k !== null && (typeof k === "object" || typeof k === "function");
export class NullDomCache {
  get(_keys, _cacheKey) {}
  set(_keys, _cacheKey, _v) {}
  evict() {}
}
// Rendered subtrees keyed by a chain of immutable values (a WeakMap per level,
// so an entry dies with its values) and, at the leaf, by a string cache key.
export class WeakMapDomCache {
  constructor() {
    this.keysByLen = new Map();
  }
  get(keys, cacheKey) {
    const len = keys.length;
    let cur = this.keysByLen.get(len);
    if (!cur) return undefined;
    for (let i = 0; i < len - 1; i++) {
      cur = cur.get(keys[i]);
      if (!cur) return undefined;
    }
    return cur.get(keys[len - 1])?.[cacheKey];
  }
  set(keys, cacheKey, v) {
    const len = keys.length;
    let cur = this.keysByLen.get(len);
    if (!cur) {
      cur = new WeakMap();
      this.keysByLen.set(len, cur);
    }
    for (let i = 0; i < len - 1; i++) {
      const key = keys[i];
      let next = cur.get(key);
      if (!next) {
        if (!isWeakKey(key)) return;
        next = new WeakMap();
        cur.set(key, next);
      }
      cur = next;
    }
    const lastKey = keys[len - 1];
    const leaf = cur.get(lastKey);
    if (leaf) leaf[cacheKey] = v;
    else if (isWeakKey(lastKey)) cur.set(lastKey, { [cacheKey]: v });
  }
  evict() {
    this.keysByLen = new Map();
  }
}
