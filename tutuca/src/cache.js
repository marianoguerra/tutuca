export class NullDomCache {
  get(_k, _cacheKey) {}
  set(_k, _cacheKey, _v) {}
  get2(_k1, _k2, _cacheKey) {}
  set2(_k1, _k2, _cacheKey, _v) {}
  evict() {
    return { hit: 0, miss: 0, badKey: 0 };
  }
}
export class WeakMapDomCache {
  constructor() {
    this.hit = this.miss = this.badKey = 0;
    this.map = new WeakMap();
  }
  _returnValue(r) {
    if (r === undefined) {
      this.miss += 1;
    } else {
      this.hit += 1;
    }
    return r;
  }
  get(k, cacheKey) {
    return this._returnValue(this.map.get(k)?.[cacheKey]);
  }
  set(k, cacheKey, v) {
    const cur = this.map.get(k);
    if (cur) {
      cur[cacheKey] = v;
    } else if (typeof k === "object") {
      this.map.set(k, { [cacheKey]: v });
    } else {
      this.badKey += 1;
    }
  }
  get2(k1, k2, cacheKey) {
    return this._returnValue(this.map.get(k1)?.get?.(k2)?.[cacheKey]);
  }
  set2(k1, k2, cacheKey, v) {
    const cur1 = this.map.get(k1);
    if (cur1) {
      const cur = cur1.get(k2);
      if (cur) {
        cur[cacheKey] = v;
      } else {
        cur1.set(k2, { [cacheKey]: v });
      }
    } else if (typeof k1 === "object" && typeof k2 === "object") {
      const cur = new WeakMap();
      cur.set(k2, { [cacheKey]: v });
      this.map.set(k1, cur);
    } else {
      this.badKey += 1;
    }
  }
  evict() {
    const { hit, miss, badKey } = this;
    this.hit = this.miss = this.badKey = 0;
    this.map = new WeakMap();
    return { hit, miss, badKey };
  }
}
export class NullComputedCache {
  getKey(v, _key, fn) {
    return fn.call(v);
  }
}
export class WeakMapComputedCache {
  constructor() {
    this.map = new WeakMap();
  }
  getKey(v, key, fn) {
    const cur = this.map.get(v);
    if (cur) {
      const curValue = cur[key];
      if (curValue !== undefined) {
        return curValue;
      }
      const newValue = fn.call(v) ?? null; // don't allow undefined
      cur[key] = newValue;
      return newValue;
    }
    const newValue = fn.call(v) ?? null; // don't allow undefined
    this.map.set(v, { [key]: newValue });
    return newValue;
  }
}
