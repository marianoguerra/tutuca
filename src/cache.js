// A value can key a WeakMap only if it is a non-null object or a function.
// `typeof null === "object"`, so a plain `typeof k === "object"` check lets
// `null` through and `WeakMap.set(null, …)` then throws; primitives (strings,
// numbers, booleans, `undefined`, `null`) are not weakly holdable and are
// counted as `badKey` instead — the entry simply goes uncached.
const isWeakKey = (k) => k !== null && (typeof k === "object" || typeof k === "function");
export class NullDomCache {
  get(_keys, _cacheKey) {}
  set(_keys, _cacheKey, _v) {}
  evict() {
    return { hit: 0, miss: 0, badKey: 0 };
  }
}
export class WeakMapDomCache {
  constructor() {
    this.hit = this.miss = this.badKey = 0;
    this.keysByLen = new Map();
  }
  _returnValue(r) {
    if (r === undefined) this.miss += 1;
    else this.hit += 1;
    return r;
  }
  get(keys, cacheKey) {
    const len = keys.length;
    let cur = this.keysByLen.get(len);
    if (!cur) return this._returnValue(undefined);
    for (let i = 0; i < len - 1; i++) {
      cur = cur.get(keys[i]);
      if (!cur) return this._returnValue(undefined);
    }
    return this._returnValue(cur.get(keys[len - 1])?.[cacheKey]);
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
        if (!isWeakKey(key)) {
          this.badKey += 1;
          return;
        }
        next = new WeakMap();
        cur.set(key, next);
      }
      cur = next;
    }
    const lastKey = keys[len - 1];
    const leaf = cur.get(lastKey);
    if (leaf) leaf[cacheKey] = v;
    else if (isWeakKey(lastKey)) cur.set(lastKey, { [cacheKey]: v });
    else this.badKey += 1;
  }
  evict() {
    const { hit, miss, badKey } = this;
    this.hit = this.miss = this.badKey = 0;
    this.keysByLen = new Map();
    return { hit, miss, badKey };
  }
}
