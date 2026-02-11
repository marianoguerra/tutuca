// src/Iterator.ts
var _computedKey;
var ITERATE_KEYS = 0;
var ITERATE_VALUES = 1;
var ITERATE_ENTRIES = 2;
_computedKey = Symbol.iterator;
var Iterator = class {
  static KEYS = ITERATE_KEYS;
  static VALUES = ITERATE_VALUES;
  static ENTRIES = ITERATE_ENTRIES;
  constructor(next) {
    if (next) {
      this.next = next;
    }
  }
  toString() {
    return "[Iterator]";
  }
  inspect() {
    return this.toString();
  }
  toSource() {
    return this.toString();
  }
  [_computedKey]() {
    return this;
  }
};
function iteratorValue(type, k, v, iteratorResult) {
  const value = getValueFromType(type, k, v);
  if (iteratorResult) {
    iteratorResult.value = value;
    return iteratorResult;
  }
  return {
    value,
    done: false
  };
}
function getValueFromType(type, k, v) {
  return type === ITERATE_KEYS ? k : type === ITERATE_VALUES ? v : [
    k,
    v
  ];
}
function iteratorDone() {
  return {
    value: void 0,
    done: true
  };
}
function hasIterator(maybeIterable) {
  if (Array.isArray(maybeIterable)) {
    return true;
  }
  return !!getIteratorFn(maybeIterable);
}
function isIterator(maybeIterator) {
  return !!(maybeIterator && // @ts-expect-error: maybeIterator is typed as `{}`
  typeof maybeIterator.next === "function");
}
function getIterator(iterable) {
  const iteratorFn = getIteratorFn(iterable);
  return iteratorFn && iteratorFn.call(iterable);
}
function getIteratorFn(iterable) {
  const iteratorFn = iterable && // @ts-expect-error: maybeIterator is typed as `{}`
  iterable[Symbol.iterator];
  if (typeof iteratorFn === "function") {
    return iteratorFn;
  }
}
function isEntriesIterable(maybeIterable) {
  const iteratorFn = getIteratorFn(maybeIterable);
  return iteratorFn && iteratorFn === maybeIterable.entries;
}
function isKeysIterable(maybeIterable) {
  const iteratorFn = getIteratorFn(maybeIterable);
  return iteratorFn && iteratorFn === maybeIterable.keys;
}

// src/predicates/isIndexed.ts
var IS_INDEXED_SYMBOL = "@@__IMMUTABLE_INDEXED__@@";
function isIndexed(maybeIndexed) {
  return Boolean(maybeIndexed && // @ts-expect-error: maybeIndexed is typed as `{}`, need to change in 6.0 to `maybeIndexed && typeof maybeIndexed === 'object' && IS_INDEXED_SYMBOL in maybeIndexed`
  maybeIndexed[IS_INDEXED_SYMBOL]);
}

// src/predicates/isKeyed.ts
var IS_KEYED_SYMBOL = "@@__IMMUTABLE_KEYED__@@";
function isKeyed(maybeKeyed) {
  return Boolean(maybeKeyed && // @ts-expect-error: maybeKeyed is typed as `{}`, need to change in 6.0 to `maybeKeyed && typeof maybeKeyed === 'object' && IS_KEYED_SYMBOL in maybeKeyed`
  maybeKeyed[IS_KEYED_SYMBOL]);
}

// src/predicates/isAssociative.ts
function isAssociative(maybeAssociative) {
  return isKeyed(maybeAssociative) || isIndexed(maybeAssociative);
}

// src/predicates/isCollection.ts
var IS_COLLECTION_SYMBOL = "@@__IMMUTABLE_ITERABLE__@@";
function isCollection(maybeCollection) {
  return Boolean(maybeCollection && // @ts-expect-error: maybeCollection is typed as `{}`, need to change in 6.0 to `maybeCollection && typeof maybeCollection === 'object' && IS_COLLECTION_SYMBOL in maybeCollection`
  maybeCollection[IS_COLLECTION_SYMBOL]);
}

// src/utils/invariant.ts
function invariant(condition, error) {
  if (!condition) throw new Error(error);
}

// src/utils/assertNotInfinite.ts
function assertNotInfinite(size) {
  invariant(size !== Infinity, "Cannot perform this action with an infinite size.");
}

// src/TrieUtils.ts
var DELETE = "delete";
var SHIFT = 5;
var SIZE = 1 << SHIFT;
var MASK = SIZE - 1;
var NOT_SET = {};
function MakeRef() {
  return {
    value: false
  };
}
function SetRef(ref) {
  if (ref) {
    ref.value = true;
  }
}
function OwnerID() {
}
function ensureSize(iter) {
  if (iter.size === void 0) {
    iter.size = iter.__iterate(returnTrue);
  }
  return iter.size;
}
function wrapIndex(iter, index) {
  if (typeof index !== "number") {
    const uint32Index = index >>> 0;
    if ("" + uint32Index !== index || uint32Index === 4294967295) {
      return NaN;
    }
    index = uint32Index;
  }
  return index < 0 ? ensureSize(iter) + index : index;
}
function returnTrue() {
  return true;
}
function wholeSlice(begin, end, size) {
  return (begin === 0 && !isNeg(begin) || size !== void 0 && (begin ?? 0) <= -size) && (end === void 0 || size !== void 0 && end >= size);
}
function resolveBegin(begin, size) {
  return resolveIndex(begin, size, 0);
}
function resolveEnd(end, size) {
  return resolveIndex(end, size, size);
}
function resolveIndex(index, size, defaultIndex) {
  return index === void 0 ? defaultIndex : isNeg(index) ? size === Infinity ? size : Math.max(0, size + index) | 0 : size === void 0 || size === index ? index : Math.min(size, index) | 0;
}
function isNeg(value) {
  return value < 0 || value === 0 && 1 / value === -Infinity;
}

// src/predicates/isValueObject.ts
function isValueObject(maybeValue) {
  return Boolean(maybeValue && // @ts-expect-error: maybeValue is typed as `{}`
  typeof maybeValue.equals === "function" && // @ts-expect-error: maybeValue is typed as `{}`
  typeof maybeValue.hashCode === "function");
}

// src/is.ts
function is(valueA, valueB) {
  if (valueA === valueB || valueA !== valueA && valueB !== valueB) {
    return true;
  }
  if (!valueA || !valueB) {
    return false;
  }
  if (typeof valueA.valueOf === "function" && typeof valueB.valueOf === "function") {
    valueA = valueA.valueOf();
    valueB = valueB.valueOf();
    if (valueA === valueB || valueA !== valueA && valueB !== valueB) {
      return true;
    }
    if (!valueA || !valueB) {
      return false;
    }
  }
  return !!(isValueObject(valueA) && isValueObject(valueB) && valueA.equals(valueB));
}

// src/predicates/isOrdered.ts
var IS_ORDERED_SYMBOL = "@@__IMMUTABLE_ORDERED__@@";
function isOrdered(maybeOrdered) {
  return Boolean(maybeOrdered && // @ts-expect-error: maybeOrdered is typed as `{}`, need to change in 6.0 to `maybeOrdered && typeof maybeOrdered === 'object' && IS_ORDERED_SYMBOL in maybeOrdered`
  maybeOrdered[IS_ORDERED_SYMBOL]);
}

// src/utils/deepEqual.ts
function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!isCollection(b) || a.size !== void 0 && b.size !== void 0 && a.size !== b.size || // @ts-expect-error __hash exists on Collection
  a.__hash !== void 0 && // @ts-expect-error __hash exists on Collection
  b.__hash !== void 0 && // @ts-expect-error __hash exists on Collection
  a.__hash !== b.__hash || isKeyed(a) !== isKeyed(b) || isIndexed(a) !== isIndexed(b) || isOrdered(a) !== isOrdered(b)) {
    return false;
  }
  if (a.size === 0 && b.size === 0) {
    return true;
  }
  const notAssociative = !isAssociative(a);
  if (isOrdered(a)) {
    const entries = a.entries();
    return !!(b.every((v, k) => {
      const entry = entries.next().value;
      return entry && is(entry[1], v) && (notAssociative || is(entry[0], k));
    }) && entries.next().done);
  }
  let flipped = false;
  if (a.size === void 0) {
    if (b.size === void 0) {
      if (typeof a.cacheResult === "function") {
        a.cacheResult();
      }
    } else {
      flipped = true;
      const _ = a;
      a = b;
      b = _;
    }
  }
  let allEqual = true;
  const bSize = b.__iterate((v, k) => {
    if (notAssociative ? !a.has(v) : flipped ? !is(v, a.get(k, NOT_SET)) : !is(a.get(k, NOT_SET), v)) {
      allEqual = false;
      return false;
    }
  });
  return allEqual && a.size === bSize;
}

// src/Math.ts
var imul = Math.imul;
function smi(i32) {
  return i32 >>> 1 & 1073741824 | i32 & 3221225471;
}

// src/Hash.ts
function hash(o) {
  if (o == null) {
    return hashNullish(o);
  }
  if (typeof o.hashCode === "function") {
    return smi(o.hashCode(o));
  }
  const v = valueOf(o);
  if (v == null) {
    return hashNullish(v);
  }
  switch (typeof v) {
    case "boolean":
      return v ? 1108378657 : 1108378656;
    case "number":
      return hashNumber(v);
    case "string":
      return v.length > STRING_HASH_CACHE_MIN_STRLEN ? cachedHashString(v) : hashString(v);
    case "object":
    case "function":
      return hashJSObj(v);
    case "symbol":
      return hashSymbol(v);
    default:
      if (typeof v.toString === "function") {
        return hashString(v.toString());
      }
      throw new Error("Value type " + typeof v + " cannot be hashed.");
  }
}
function hashNullish(nullish) {
  return nullish === null ? 1108378658 : (
    /* undefined */
    1108378659
  );
}
function hashNumber(n) {
  if (n !== n || n === Infinity) {
    return 0;
  }
  let hash2 = n | 0;
  if (hash2 !== n) {
    hash2 ^= n * 4294967295;
  }
  while (n > 4294967295) {
    n /= 4294967295;
    hash2 ^= n;
  }
  return smi(hash2);
}
function cachedHashString(string) {
  let hashed = stringHashCache[string];
  if (hashed === void 0) {
    hashed = hashString(string);
    if (STRING_HASH_CACHE_SIZE === STRING_HASH_CACHE_MAX_SIZE) {
      STRING_HASH_CACHE_SIZE = 0;
      stringHashCache = {};
    }
    STRING_HASH_CACHE_SIZE++;
    stringHashCache[string] = hashed;
  }
  return hashed;
}
function hashString(string) {
  let hashed = 0;
  for (let ii = 0; ii < string.length; ii++) {
    hashed = 31 * hashed + string.charCodeAt(ii) | 0;
  }
  return smi(hashed);
}
function hashSymbol(sym) {
  let hashed = symbolMap[sym];
  if (hashed !== void 0) {
    return hashed;
  }
  hashed = nextHash();
  symbolMap[sym] = hashed;
  return hashed;
}
function hashJSObj(obj) {
  let hashed;
  hashed = weakMap.get(obj);
  if (hashed !== void 0) {
    return hashed;
  }
  hashed = obj[UID_HASH_KEY];
  if (hashed !== void 0) {
    return hashed;
  }
  hashed = nextHash();
  weakMap.set(obj, hashed);
  return hashed;
}
function valueOf(obj) {
  return obj.valueOf !== Object.prototype.valueOf && typeof obj.valueOf === "function" ? obj.valueOf(obj) : obj;
}
function nextHash() {
  const nextHash2 = ++_objHashUID;
  if (_objHashUID & 1073741824) {
    _objHashUID = 0;
  }
  return nextHash2;
}
var weakMap = /* @__PURE__ */ new WeakMap();
var symbolMap = /* @__PURE__ */ Object.create(null);
var _objHashUID = 0;
var UID_HASH_KEY = Symbol("__immutablehash__");
var STRING_HASH_CACHE_MIN_STRLEN = 16;
var STRING_HASH_CACHE_MAX_SIZE = 255;
var STRING_HASH_CACHE_SIZE = 0;
var stringHashCache = {};

// src/utils/hashCollection.ts
function hashCollection(collection) {
  if (collection.size === Infinity) {
    return 0;
  }
  const ordered = isOrdered(collection);
  const keyed = isKeyed(collection);
  let h = ordered ? 1 : 0;
  collection.__iterate(keyed ? ordered ? (v, k) => {
    h = 31 * h + hashMerge(hash(v), hash(k)) | 0;
  } : (v, k) => {
    h = h + hashMerge(hash(v), hash(k)) | 0;
  } : ordered ? (v) => {
    h = 31 * h + hash(v) | 0;
  } : (v) => {
    h = h + hash(v) | 0;
  });
  return murmurHashOfSize(collection.size, h);
}
function murmurHashOfSize(size, h) {
  h = imul(h, 3432918353);
  h = imul(h << 15 | h >>> -15, 461845907);
  h = imul(h << 13 | h >>> -13, 5);
  h = (h + 3864292196 | 0) ^ size;
  h = imul(h ^ h >>> 16, 2246822507);
  h = imul(h ^ h >>> 13, 3266489909);
  h = smi(h ^ h >>> 16);
  return h;
}
function hashMerge(a, b) {
  return a ^ b + 2654435769 + (a << 6) + (a >> 2) | 0;
}

// src/Collection.ts
function Collection(value) {
  return isCollection(value) ? value : Seq(value);
}
var CollectionImpl = class {
  __hash;
  size = 0;
  equals(other) {
    return deepEqual(this, other);
  }
  hashCode() {
    return this.__hash || (this.__hash = hashCollection(this));
  }
  every(predicate, context) {
    assertNotInfinite(this.size);
    let returnValue = true;
    this.__iterate((v, k, c) => {
      if (!predicate.call(context, v, k, c)) {
        returnValue = false;
        return false;
      }
    });
    return returnValue;
  }
  entries() {
    return this.__iterator(ITERATE_ENTRIES);
  }
  __iterate(fn, reverse = false) {
    throw new Error("CollectionImpl does not implement __iterate. Use a subclass instead.");
  }
  __iterator(type, reverse = false) {
    throw new Error("CollectionImpl does not implement __iterator. Use a subclass instead.");
  }
};
function KeyedCollection(value) {
  return isKeyed(value) ? value : KeyedSeq(value);
}
var KeyedCollectionImpl = class extends CollectionImpl {
};
function IndexedCollection(value) {
  return isIndexed(value) ? value : IndexedSeq(value);
}
var IndexedCollectionImpl = class extends CollectionImpl {
};
function SetCollection(value) {
  return isCollection(value) && !isAssociative(value) ? value : SetSeq(value);
}
var SetCollectionImpl = class extends CollectionImpl {
};
Collection.Keyed = KeyedCollection;
Collection.Indexed = IndexedCollection;
Collection.Set = SetCollection;

// src/predicates/isRecord.ts
var IS_RECORD_SYMBOL = "@@__IMMUTABLE_RECORD__@@";
function isRecord(maybeRecord) {
  return Boolean(maybeRecord && // @ts-expect-error: maybeRecord is typed as `{}`, need to change in 6.0 to `maybeRecord && typeof maybeRecord === 'object' && IS_RECORD_SYMBOL in maybeRecord`
  maybeRecord[IS_RECORD_SYMBOL]);
}

// src/predicates/isImmutable.ts
function isImmutable(maybeImmutable) {
  return isCollection(maybeImmutable) || isRecord(maybeImmutable);
}

// src/predicates/isSeq.ts
var IS_SEQ_SYMBOL = "@@__IMMUTABLE_SEQ__@@";
function isSeq(maybeSeq) {
  return Boolean(maybeSeq && // @ts-expect-error: maybeSeq is typed as `{}`, need to change in 6.0 to `maybeSeq && typeof maybeSeq === 'object' && MAYBE_SEQ_SYMBOL in maybeSeq`
  maybeSeq[IS_SEQ_SYMBOL]);
}

// src/utils/hasOwnProperty.ts
var hasOwnProperty_default = Object.prototype.hasOwnProperty;

// src/utils/isArrayLike.ts
function isArrayLike(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return true;
  }
  return value && typeof value === "object" && // @ts-expect-error check that `'length' in value &&`
  Number.isInteger(value.length) && // @ts-expect-error check that `'length' in value &&`
  value.length >= 0 && // @ts-expect-error check that `'length' in value &&`
  (value.length === 0 ? Object.keys(value).length === 1 : (
    // @ts-expect-error check that `'length' in value &&`
    value.hasOwnProperty(value.length - 1)
  ));
}

// src/Seq.js
var Seq = (value) => value === void 0 || value === null ? emptySequence() : isImmutable(value) ? value.toSeq() : seqFromValue(value);
var SeqImpl = class extends CollectionImpl {
  toSeq() {
    return this;
  }
  toString() {
    return this.__toString("Seq {", "}");
  }
  cacheResult() {
    if (!this._cache && this.__iterateUncached) {
      this._cache = this.entrySeq().toArray();
      this.size = this._cache.length;
    }
    return this;
  }
  // abstract __iterateUncached(fn, reverse)
  __iterate(fn, reverse) {
    const cache = this._cache;
    if (cache) {
      const size = cache.length;
      let i = 0;
      while (i !== size) {
        const entry = cache[reverse ? size - ++i : i++];
        if (fn(entry[1], entry[0], this) === false) {
          break;
        }
      }
      return i;
    }
    return this.__iterateUncached(fn, reverse);
  }
  // abstract __iteratorUncached(type, reverse)
  __iterator(type, reverse) {
    const cache = this._cache;
    if (cache) {
      const size = cache.length;
      let i = 0;
      return new Iterator(() => {
        if (i === size) {
          return iteratorDone();
        }
        const entry = cache[reverse ? size - ++i : i++];
        return iteratorValue(type, entry[0], entry[1]);
      });
    }
    return this.__iteratorUncached(type, reverse);
  }
};
var KeyedSeq = (value) => value === void 0 || value === null ? emptySequence().toKeyedSeq() : isCollection(value) ? isKeyed(value) ? value.toSeq() : value.fromEntrySeq() : isRecord(value) ? value.toSeq() : keyedSeqFromValue(value);
var KeyedSeqImpl = class extends SeqImpl {
  toKeyedSeq() {
    return this;
  }
};
var IndexedSeq = (value) => value === void 0 || value === null ? emptySequence() : isCollection(value) ? isKeyed(value) ? value.entrySeq() : value.toIndexedSeq() : isRecord(value) ? value.toSeq().entrySeq() : indexedSeqFromValue(value);
IndexedSeq.of = function(...values) {
  return IndexedSeq(values);
};
var IndexedSeqImpl = class extends SeqImpl {
  toIndexedSeq() {
    return this;
  }
  toString() {
    return this.__toString("Seq [", "]");
  }
};
var SetSeq = (value) => (isCollection(value) && !isAssociative(value) ? value : IndexedSeq(value)).toSetSeq();
SetSeq.of = function(...values) {
  return SetSeq(values);
};
var SetSeqImpl = class extends SeqImpl {
  toSetSeq() {
    return this;
  }
};
Seq.isSeq = isSeq;
Seq.Keyed = KeyedSeq;
Seq.Set = SetSeq;
Seq.Indexed = IndexedSeq;
SeqImpl.prototype[IS_SEQ_SYMBOL] = true;
var ArraySeq = class extends IndexedSeqImpl {
  constructor(array) {
    super();
    this._array = array;
    this.size = array.length;
  }
  get(index, notSetValue) {
    return this.has(index) ? this._array[wrapIndex(this, index)] : notSetValue;
  }
  __iterate(fn, reverse) {
    const array = this._array;
    const size = array.length;
    let i = 0;
    while (i !== size) {
      const ii = reverse ? size - ++i : i++;
      if (fn(array[ii], ii, this) === false) {
        break;
      }
    }
    return i;
  }
  __iterator(type, reverse) {
    const array = this._array;
    const size = array.length;
    let i = 0;
    return new Iterator(() => {
      if (i === size) {
        return iteratorDone();
      }
      const ii = reverse ? size - ++i : i++;
      return iteratorValue(type, ii, array[ii]);
    });
  }
};
var ObjectSeq = class extends KeyedSeqImpl {
  constructor(object) {
    super();
    const keys = Object.keys(object).concat(Object.getOwnPropertySymbols ? Object.getOwnPropertySymbols(object) : []);
    this._object = object;
    this._keys = keys;
    this.size = keys.length;
  }
  get(key, notSetValue) {
    if (notSetValue !== void 0 && !this.has(key)) {
      return notSetValue;
    }
    return this._object[key];
  }
  has(key) {
    return hasOwnProperty_default.call(this._object, key);
  }
  __iterate(fn, reverse) {
    const object = this._object;
    const keys = this._keys;
    const size = keys.length;
    let i = 0;
    while (i !== size) {
      const key = keys[reverse ? size - ++i : i++];
      if (fn(object[key], key, this) === false) {
        break;
      }
    }
    return i;
  }
  __iterator(type, reverse) {
    const object = this._object;
    const keys = this._keys;
    const size = keys.length;
    let i = 0;
    return new Iterator(() => {
      if (i === size) {
        return iteratorDone();
      }
      const key = keys[reverse ? size - ++i : i++];
      return iteratorValue(type, key, object[key]);
    });
  }
};
ObjectSeq.prototype[IS_ORDERED_SYMBOL] = true;
var CollectionSeq = class extends IndexedSeqImpl {
  constructor(collection) {
    super();
    this._collection = collection;
    this.size = collection.length || collection.size;
  }
  __iterateUncached(fn, reverse) {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    const collection = this._collection;
    const iterator = getIterator(collection);
    let iterations = 0;
    if (isIterator(iterator)) {
      let step;
      while (!(step = iterator.next()).done) {
        if (fn(step.value, iterations++, this) === false) {
          break;
        }
      }
    }
    return iterations;
  }
  __iteratorUncached(type, reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    const collection = this._collection;
    const iterator = getIterator(collection);
    if (!isIterator(iterator)) {
      return new Iterator(iteratorDone);
    }
    let iterations = 0;
    return new Iterator(() => {
      const step = iterator.next();
      return step.done ? step : iteratorValue(type, iterations++, step.value);
    });
  }
};
function emptySequence() {
  return new ArraySeq([]);
}
function keyedSeqFromValue(value) {
  const seq = maybeIndexedSeqFromValue(value);
  if (seq) {
    return seq.fromEntrySeq();
  }
  if (typeof value === "object") {
    return new ObjectSeq(value);
  }
  throw new TypeError("Expected Array or collection object of [k, v] entries, or keyed object: " + value);
}
function indexedSeqFromValue(value) {
  const seq = maybeIndexedSeqFromValue(value);
  if (seq) {
    return seq;
  }
  throw new TypeError("Expected Array or collection object of values: " + value);
}
function seqFromValue(value) {
  const seq = maybeIndexedSeqFromValue(value);
  if (seq) {
    return isEntriesIterable(value) ? seq.fromEntrySeq() : isKeysIterable(value) ? seq.toSetSeq() : seq;
  }
  if (typeof value === "object") {
    return new ObjectSeq(value);
  }
  throw new TypeError("Expected Array or collection object of values, or keyed object: " + value);
}
function maybeIndexedSeqFromValue(value) {
  return isArrayLike(value) ? new ArraySeq(value) : hasIterator(value) ? new CollectionSeq(value) : void 0;
}

// src/methods/asImmutable.js
function asImmutable() {
  return this.__ensureOwner();
}

// src/methods/asMutable.js
function asMutable() {
  return this.__ownerID ? this : this.__ensureOwner(new OwnerID());
}

// src/Operations.js
var ToKeyedSequence = class extends KeyedSeqImpl {
  constructor(indexed, useKeys) {
    super();
    this._iter = indexed;
    this._useKeys = useKeys;
    this.size = indexed.size;
  }
  get(key, notSetValue) {
    return this._iter.get(key, notSetValue);
  }
  has(key) {
    return this._iter.has(key);
  }
  valueSeq() {
    return this._iter.valueSeq();
  }
  reverse() {
    const reversedSequence = reverseFactory(this, true);
    if (!this._useKeys) {
      reversedSequence.valueSeq = () => this._iter.toSeq().reverse();
    }
    return reversedSequence;
  }
  map(mapper, context) {
    const mappedSequence = mapFactory(this, mapper, context);
    if (!this._useKeys) {
      mappedSequence.valueSeq = () => this._iter.toSeq().map(mapper, context);
    }
    return mappedSequence;
  }
  __iterate(fn, reverse) {
    return this._iter.__iterate((v, k) => fn(v, k, this), reverse);
  }
  __iterator(type, reverse) {
    return this._iter.__iterator(type, reverse);
  }
};
ToKeyedSequence.prototype[IS_ORDERED_SYMBOL] = true;
var ToIndexedSequence = class extends IndexedSeqImpl {
  constructor(iter) {
    super();
    this._iter = iter;
    this.size = iter.size;
  }
  includes(value) {
    return this._iter.includes(value);
  }
  __iterate(fn, reverse) {
    let i = 0;
    reverse && ensureSize(this);
    return this._iter.__iterate((v) => fn(v, reverse ? this.size - ++i : i++, this), reverse);
  }
  __iterator(type, reverse) {
    const iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
    let i = 0;
    reverse && ensureSize(this);
    return new Iterator(() => {
      const step = iterator.next();
      return step.done ? step : iteratorValue(type, reverse ? this.size - ++i : i++, step.value, step);
    });
  }
};
var ToSetSequence = class extends SetSeqImpl {
  constructor(iter) {
    super();
    this._iter = iter;
    this.size = iter.size;
  }
  has(key) {
    return this._iter.includes(key);
  }
  __iterate(fn, reverse) {
    return this._iter.__iterate((v) => fn(v, v, this), reverse);
  }
  __iterator(type, reverse) {
    const iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
    return new Iterator(() => {
      const step = iterator.next();
      return step.done ? step : iteratorValue(type, step.value, step.value, step);
    });
  }
};
var FromEntriesSequence = class extends KeyedSeqImpl {
  constructor(entries) {
    super();
    this._iter = entries;
    this.size = entries.size;
  }
  entrySeq() {
    return this._iter.toSeq();
  }
  __iterate(fn, reverse) {
    return this._iter.__iterate((entry) => {
      if (entry) {
        validateEntry(entry);
        const indexedCollection = isCollection(entry);
        return fn(indexedCollection ? entry.get(1) : entry[1], indexedCollection ? entry.get(0) : entry[0], this);
      }
    }, reverse);
  }
  __iterator(type, reverse) {
    const iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
    return new Iterator(() => {
      while (true) {
        const step = iterator.next();
        if (step.done) {
          return step;
        }
        const entry = step.value;
        if (entry) {
          validateEntry(entry);
          const indexedCollection = isCollection(entry);
          return iteratorValue(type, indexedCollection ? entry.get(0) : entry[0], indexedCollection ? entry.get(1) : entry[1], step);
        }
      }
    });
  }
};
ToIndexedSequence.prototype.cacheResult = ToKeyedSequence.prototype.cacheResult = ToSetSequence.prototype.cacheResult = FromEntriesSequence.prototype.cacheResult = cacheResultThrough;
function flipFactory(collection) {
  const flipSequence = makeSequence(collection);
  flipSequence._iter = collection;
  flipSequence.size = collection.size;
  flipSequence.flip = () => collection;
  flipSequence.reverse = function() {
    const reversedSequence = collection.reverse.apply(this);
    reversedSequence.flip = () => collection.reverse();
    return reversedSequence;
  };
  flipSequence.has = (key) => collection.includes(key);
  flipSequence.includes = (key) => collection.has(key);
  flipSequence.cacheResult = cacheResultThrough;
  flipSequence.__iterateUncached = function(fn, reverse) {
    return collection.__iterate((v, k) => fn(k, v, this) !== false, reverse);
  };
  flipSequence.__iteratorUncached = function(type, reverse) {
    if (type === ITERATE_ENTRIES) {
      const iterator = collection.__iterator(type, reverse);
      return new Iterator(() => {
        const step = iterator.next();
        if (!step.done) {
          const k = step.value[0];
          step.value[0] = step.value[1];
          step.value[1] = k;
        }
        return step;
      });
    }
    return collection.__iterator(type === ITERATE_VALUES ? ITERATE_KEYS : ITERATE_VALUES, reverse);
  };
  return flipSequence;
}
function mapFactory(collection, mapper, context) {
  const mappedSequence = makeSequence(collection);
  mappedSequence.size = collection.size;
  mappedSequence.has = (key) => collection.has(key);
  mappedSequence.get = (key, notSetValue) => {
    const v = collection.get(key, NOT_SET);
    return v === NOT_SET ? notSetValue : mapper.call(context, v, key, collection);
  };
  mappedSequence.__iterateUncached = function(fn, reverse) {
    return collection.__iterate((v, k, c) => fn(mapper.call(context, v, k, c), k, this) !== false, reverse);
  };
  mappedSequence.__iteratorUncached = function(type, reverse) {
    const iterator = collection.__iterator(ITERATE_ENTRIES, reverse);
    return new Iterator(() => {
      const step = iterator.next();
      if (step.done) {
        return step;
      }
      const entry = step.value;
      const key = entry[0];
      return iteratorValue(type, key, mapper.call(context, entry[1], key, collection), step);
    });
  };
  return mappedSequence;
}
function reverseFactory(collection, useKeys) {
  const reversedSequence = makeSequence(collection);
  reversedSequence._iter = collection;
  reversedSequence.size = collection.size;
  reversedSequence.reverse = () => collection;
  if (collection.flip) {
    reversedSequence.flip = function() {
      const flipSequence = flipFactory(collection);
      flipSequence.reverse = () => collection.flip();
      return flipSequence;
    };
  }
  reversedSequence.get = (key, notSetValue) => collection.get(useKeys ? key : -1 - key, notSetValue);
  reversedSequence.has = (key) => collection.has(useKeys ? key : -1 - key);
  reversedSequence.includes = (value) => collection.includes(value);
  reversedSequence.cacheResult = cacheResultThrough;
  reversedSequence.__iterate = function(fn, reverse) {
    let i = 0;
    reverse && ensureSize(collection);
    return collection.__iterate((v, k) => fn(v, useKeys ? k : reverse ? this.size - ++i : i++, this), !reverse);
  };
  reversedSequence.__iterator = (type, reverse) => {
    let i = 0;
    reverse && ensureSize(collection);
    const iterator = collection.__iterator(ITERATE_ENTRIES, !reverse);
    return new Iterator(() => {
      const step = iterator.next();
      if (step.done) {
        return step;
      }
      const entry = step.value;
      return iteratorValue(type, useKeys ? entry[0] : reverse ? this.size - ++i : i++, entry[1], step);
    });
  };
  return reversedSequence;
}
function filterFactory(collection, predicate, context, useKeys) {
  const filterSequence = makeSequence(collection);
  if (useKeys) {
    filterSequence.has = (key) => {
      const v = collection.get(key, NOT_SET);
      return v !== NOT_SET && !!predicate.call(context, v, key, collection);
    };
    filterSequence.get = (key, notSetValue) => {
      const v = collection.get(key, NOT_SET);
      return v !== NOT_SET && predicate.call(context, v, key, collection) ? v : notSetValue;
    };
  }
  filterSequence.__iterateUncached = function(fn, reverse) {
    let iterations = 0;
    collection.__iterate((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this);
      }
    }, reverse);
    return iterations;
  };
  filterSequence.__iteratorUncached = function(type, reverse) {
    const iterator = collection.__iterator(ITERATE_ENTRIES, reverse);
    let iterations = 0;
    return new Iterator(() => {
      while (true) {
        const step = iterator.next();
        if (step.done) {
          return step;
        }
        const entry = step.value;
        const key = entry[0];
        const value = entry[1];
        if (predicate.call(context, value, key, collection)) {
          return iteratorValue(type, useKeys ? key : iterations++, value, step);
        }
      }
    });
  };
  return filterSequence;
}
function countByFactory(collection, grouper, context) {
  const groups = Map().asMutable();
  collection.__iterate((v, k) => {
    groups.update(grouper.call(context, v, k, collection), 0, (a) => a + 1);
  });
  return groups.asImmutable();
}
function groupByFactory(collection, grouper, context) {
  const isKeyedIter = isKeyed(collection);
  const groups = (isOrdered(collection) ? OrderedMap() : Map()).asMutable();
  collection.__iterate((v, k) => {
    groups.update(grouper.call(context, v, k, collection), (a) => (a = a || [], a.push(isKeyedIter ? [
      k,
      v
    ] : v), a));
  });
  const coerce = collectionClass(collection);
  return groups.map((arr) => reify(collection, coerce(arr))).asImmutable();
}
function partitionFactory(collection, predicate, context) {
  const isKeyedIter = isKeyed(collection);
  const groups = [
    [],
    []
  ];
  collection.__iterate((v, k) => {
    groups[predicate.call(context, v, k, collection) ? 1 : 0].push(isKeyedIter ? [
      k,
      v
    ] : v);
  });
  const coerce = collectionClass(collection);
  return groups.map((arr) => reify(collection, coerce(arr)));
}
function sliceFactory(collection, begin, end, useKeys) {
  const originalSize = collection.size;
  if (wholeSlice(begin, end, originalSize)) {
    return collection;
  }
  if (typeof originalSize === "undefined" && (begin < 0 || end < 0)) {
    return sliceFactory(collection.toSeq().cacheResult(), begin, end, useKeys);
  }
  const resolvedBegin = resolveBegin(begin, originalSize);
  const resolvedEnd = resolveEnd(end, originalSize);
  const resolvedSize = resolvedEnd - resolvedBegin;
  let sliceSize;
  if (resolvedSize === resolvedSize) {
    sliceSize = resolvedSize < 0 ? 0 : resolvedSize;
  }
  const sliceSeq = makeSequence(collection);
  sliceSeq.size = sliceSize === 0 ? sliceSize : collection.size && sliceSize || void 0;
  if (!useKeys && isSeq(collection) && sliceSize >= 0) {
    sliceSeq.get = function(index, notSetValue) {
      index = wrapIndex(this, index);
      return index >= 0 && index < sliceSize ? collection.get(index + resolvedBegin, notSetValue) : notSetValue;
    };
  }
  sliceSeq.__iterateUncached = function(fn, reverse) {
    if (sliceSize === 0) {
      return 0;
    }
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let skipped = 0;
    let isSkipping = true;
    let iterations = 0;
    collection.__iterate((v, k) => {
      if (!(isSkipping && (isSkipping = skipped++ < resolvedBegin))) {
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this) !== false && iterations !== sliceSize;
      }
    });
    return iterations;
  };
  sliceSeq.__iteratorUncached = function(type, reverse) {
    if (sliceSize !== 0 && reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    if (sliceSize === 0) {
      return new Iterator(iteratorDone);
    }
    const iterator = collection.__iterator(type, reverse);
    let skipped = 0;
    let iterations = 0;
    return new Iterator(() => {
      while (skipped++ < resolvedBegin) {
        iterator.next();
      }
      if (++iterations > sliceSize) {
        return iteratorDone();
      }
      const step = iterator.next();
      if (useKeys || type === ITERATE_VALUES || step.done) {
        return step;
      }
      if (type === ITERATE_KEYS) {
        return iteratorValue(type, iterations - 1, void 0, step);
      }
      return iteratorValue(type, iterations - 1, step.value[1], step);
    });
  };
  return sliceSeq;
}
function takeWhileFactory(collection, predicate, context) {
  const takeSequence = makeSequence(collection);
  takeSequence.__iterateUncached = function(fn, reverse) {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let iterations = 0;
    collection.__iterate((v, k, c) => predicate.call(context, v, k, c) && ++iterations && fn(v, k, this));
    return iterations;
  };
  takeSequence.__iteratorUncached = function(type, reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    const iterator = collection.__iterator(ITERATE_ENTRIES, reverse);
    let iterating = true;
    return new Iterator(() => {
      if (!iterating) {
        return iteratorDone();
      }
      const step = iterator.next();
      if (step.done) {
        return step;
      }
      const entry = step.value;
      const k = entry[0];
      const v = entry[1];
      if (!predicate.call(context, v, k, this)) {
        iterating = false;
        return iteratorDone();
      }
      return type === ITERATE_ENTRIES ? step : iteratorValue(type, k, v, step);
    });
  };
  return takeSequence;
}
function skipWhileFactory(collection, predicate, context, useKeys) {
  const skipSequence = makeSequence(collection);
  skipSequence.__iterateUncached = function(fn, reverse) {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let isSkipping = true;
    let iterations = 0;
    collection.__iterate((v, k, c) => {
      if (!(isSkipping && (isSkipping = predicate.call(context, v, k, c)))) {
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this);
      }
    });
    return iterations;
  };
  skipSequence.__iteratorUncached = function(type, reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    const iterator = collection.__iterator(ITERATE_ENTRIES, reverse);
    let skipping = true;
    let iterations = 0;
    return new Iterator(() => {
      let step;
      let k;
      let v;
      do {
        step = iterator.next();
        if (step.done) {
          if (useKeys || type === ITERATE_VALUES) {
            return step;
          }
          if (type === ITERATE_KEYS) {
            return iteratorValue(type, iterations++, void 0, step);
          }
          return iteratorValue(type, iterations++, step.value[1], step);
        }
        const entry = step.value;
        k = entry[0];
        v = entry[1];
        skipping && (skipping = predicate.call(context, v, k, this));
      } while (skipping);
      return type === ITERATE_ENTRIES ? step : iteratorValue(type, k, v, step);
    });
  };
  return skipSequence;
}
var ConcatSeq = class extends SeqImpl {
  constructor(iterables) {
    super();
    this._wrappedIterables = iterables.flatMap((iterable) => {
      if (iterable._wrappedIterables) {
        return iterable._wrappedIterables;
      }
      return [
        iterable
      ];
    });
    this.size = this._wrappedIterables.reduce((sum, iterable) => {
      if (sum !== void 0) {
        const size = iterable.size;
        if (size !== void 0) {
          return sum + size;
        }
      }
    }, 0);
    this[IS_KEYED_SYMBOL] = this._wrappedIterables[0][IS_KEYED_SYMBOL];
    this[IS_INDEXED_SYMBOL] = this._wrappedIterables[0][IS_INDEXED_SYMBOL];
    this[IS_ORDERED_SYMBOL] = this._wrappedIterables[0][IS_ORDERED_SYMBOL];
  }
  __iterateUncached(fn, reverse) {
    if (this._wrappedIterables.length === 0) {
      return;
    }
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let iterableIndex = 0;
    const useKeys = isKeyed(this);
    const iteratorType = useKeys ? ITERATE_ENTRIES : ITERATE_VALUES;
    let currentIterator = this._wrappedIterables[iterableIndex].__iterator(iteratorType, reverse);
    let keepGoing = true;
    let index = 0;
    while (keepGoing) {
      let next = currentIterator.next();
      while (next.done) {
        iterableIndex++;
        if (iterableIndex === this._wrappedIterables.length) {
          return index;
        }
        currentIterator = this._wrappedIterables[iterableIndex].__iterator(iteratorType, reverse);
        next = currentIterator.next();
      }
      const fnResult = useKeys ? fn(next.value[1], next.value[0], this) : fn(next.value, index, this);
      keepGoing = fnResult !== false;
      index++;
    }
    return index;
  }
  __iteratorUncached(type, reverse) {
    if (this._wrappedIterables.length === 0) {
      return new Iterator(iteratorDone);
    }
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    let iterableIndex = 0;
    let currentIterator = this._wrappedIterables[iterableIndex].__iterator(type, reverse);
    return new Iterator(() => {
      let next = currentIterator.next();
      while (next.done) {
        iterableIndex++;
        if (iterableIndex === this._wrappedIterables.length) {
          return next;
        }
        currentIterator = this._wrappedIterables[iterableIndex].__iterator(type, reverse);
        next = currentIterator.next();
      }
      return next;
    });
  }
};
function concatFactory(collection, values) {
  const isKeyedCollection = isKeyed(collection);
  const iters = [
    collection
  ].concat(values).map((v) => {
    if (!isCollection(v)) {
      v = isKeyedCollection ? keyedSeqFromValue(v) : indexedSeqFromValue(Array.isArray(v) ? v : [
        v
      ]);
    } else if (isKeyedCollection) {
      v = KeyedCollection(v);
    }
    return v;
  }).filter((v) => v.size !== 0);
  if (iters.length === 0) {
    return collection;
  }
  if (iters.length === 1) {
    const singleton = iters[0];
    if (singleton === collection || isKeyedCollection && isKeyed(singleton) || isIndexed(collection) && isIndexed(singleton)) {
      return singleton;
    }
  }
  return new ConcatSeq(iters);
}
function flattenFactory(collection, depth, useKeys) {
  const flatSequence = makeSequence(collection);
  flatSequence.__iterateUncached = function(fn, reverse) {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let iterations = 0;
    let stopped = false;
    function flatDeep(iter, currentDepth) {
      iter.__iterate((v, k) => {
        if ((!depth || currentDepth < depth) && isCollection(v)) {
          flatDeep(v, currentDepth + 1);
        } else {
          iterations++;
          if (fn(v, useKeys ? k : iterations - 1, flatSequence) === false) {
            stopped = true;
          }
        }
        return !stopped;
      }, reverse);
    }
    flatDeep(collection, 0);
    return iterations;
  };
  flatSequence.__iteratorUncached = function(type, reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    let iterator = collection.__iterator(type, reverse);
    const stack = [];
    let iterations = 0;
    return new Iterator(() => {
      while (iterator) {
        const step = iterator.next();
        if (step.done !== false) {
          iterator = stack.pop();
          continue;
        }
        let v = step.value;
        if (type === ITERATE_ENTRIES) {
          v = v[1];
        }
        if ((!depth || stack.length < depth) && isCollection(v)) {
          stack.push(iterator);
          iterator = v.__iterator(type, reverse);
        } else {
          return useKeys ? step : iteratorValue(type, iterations++, v, step);
        }
      }
      return iteratorDone();
    });
  };
  return flatSequence;
}
function flatMapFactory(collection, mapper, context) {
  const coerce = collectionClass(collection);
  return collection.toSeq().map((v, k) => coerce(mapper.call(context, v, k, collection))).flatten(true);
}
function interposeFactory(collection, separator) {
  const interposedSequence = makeSequence(collection);
  interposedSequence.size = collection.size && collection.size * 2 - 1;
  interposedSequence.__iterateUncached = function(fn, reverse) {
    let iterations = 0;
    collection.__iterate((v) => (!iterations || fn(separator, iterations++, this) !== false) && fn(v, iterations++, this) !== false, reverse);
    return iterations;
  };
  interposedSequence.__iteratorUncached = function(type, reverse) {
    const iterator = collection.__iterator(ITERATE_VALUES, reverse);
    let iterations = 0;
    let step;
    return new Iterator(() => {
      if (!step || iterations % 2) {
        step = iterator.next();
        if (step.done) {
          return step;
        }
      }
      return iterations % 2 ? iteratorValue(type, iterations++, separator) : iteratorValue(type, iterations++, step.value, step);
    });
  };
  return interposedSequence;
}
function sortFactory(collection, comparator, mapper) {
  if (!comparator) {
    comparator = defaultComparator;
  }
  const isKeyedCollection = isKeyed(collection);
  let index = 0;
  const entries = collection.toSeq().map((v, k) => [
    k,
    v,
    index++,
    mapper ? mapper(v, k, collection) : v
  ]).valueSeq().toArray();
  entries.sort((a, b) => comparator(a[3], b[3]) || a[2] - b[2]).forEach(isKeyedCollection ? (v, i) => {
    entries[i].length = 2;
  } : (v, i) => {
    entries[i] = v[1];
  });
  return isKeyedCollection ? KeyedSeq(entries) : isIndexed(collection) ? IndexedSeq(entries) : SetSeq(entries);
}
function maxFactory(collection, comparator, mapper) {
  if (!comparator) {
    comparator = defaultComparator;
  }
  if (mapper) {
    const entry = collection.toSeq().map((v, k) => [
      v,
      mapper(v, k, collection)
    ]).reduce((a, b) => maxCompare(comparator, a[1], b[1]) ? b : a);
    return entry && entry[0];
  }
  return collection.reduce((a, b) => maxCompare(comparator, a, b) ? b : a);
}
function maxCompare(comparator, a, b) {
  const comp = comparator(b, a);
  return comp === 0 && b !== a && (b === void 0 || b === null || b !== b) || comp > 0;
}
function zipWithFactory(keyIter, zipper, iters, zipAll) {
  const zipSequence = makeSequence(keyIter);
  const sizes = new ArraySeq(iters).map((i) => i.size);
  zipSequence.size = zipAll ? sizes.max() : sizes.min();
  zipSequence.__iterate = function(fn, reverse) {
    const iterator = this.__iterator(ITERATE_VALUES, reverse);
    let step;
    let iterations = 0;
    while (!(step = iterator.next()).done) {
      if (fn(step.value, iterations++, this) === false) {
        break;
      }
    }
    return iterations;
  };
  zipSequence.__iteratorUncached = function(type, reverse) {
    const iterators = iters.map((i) => (i = Collection(i), getIterator(reverse ? i.reverse() : i)));
    let iterations = 0;
    let isDone = false;
    return new Iterator(() => {
      let steps;
      if (!isDone) {
        steps = iterators.map((i) => i.next());
        isDone = zipAll ? steps.every((s) => s.done) : steps.some((s) => s.done);
      }
      if (isDone) {
        return iteratorDone();
      }
      return iteratorValue(type, iterations++, zipper.apply(null, steps.map((s) => s.value)));
    });
  };
  return zipSequence;
}
function reify(iter, seq) {
  return iter === seq ? iter : isSeq(iter) ? seq : iter.create ? iter.create(seq) : iter.constructor(seq);
}
function validateEntry(entry) {
  if (entry !== Object(entry)) {
    throw new TypeError("Expected [K, V] tuple: " + entry);
  }
}
function collectionClass(collection) {
  return isKeyed(collection) ? KeyedCollection : isIndexed(collection) ? IndexedCollection : SetCollection;
}
function makeSequence(collection) {
  return Object.create((isKeyed(collection) ? KeyedSeqImpl : isIndexed(collection) ? IndexedSeqImpl : SetSeqImpl).prototype);
}
function cacheResultThrough() {
  if (this._iter.cacheResult) {
    this._iter.cacheResult();
    this.size = this._iter.size;
    return this;
  }
  return SeqImpl.prototype.cacheResult.call(this);
}
function defaultComparator(a, b) {
  if (a === void 0 && b === void 0) {
    return 0;
  }
  if (a === void 0) {
    return 1;
  }
  if (b === void 0) {
    return -1;
  }
  return a > b ? 1 : a < b ? -1 : 0;
}

// src/functional/update.ts
function update(collection, key, notSetValue, updater) {
  return updateIn(collection, [
    key
  ], notSetValue, updater);
}

// src/methods/merge.js
function merge(...iters) {
  return mergeIntoKeyedWith(this, iters);
}
function mergeWith(merger, ...iters) {
  if (typeof merger !== "function") {
    throw new TypeError("Invalid merger function: " + merger);
  }
  return mergeIntoKeyedWith(this, iters, merger);
}
function mergeIntoKeyedWith(collection, collections, merger) {
  const iters = [];
  for (let ii = 0; ii < collections.length; ii++) {
    const collection2 = KeyedCollection(collections[ii]);
    if (collection2.size !== 0) {
      iters.push(collection2);
    }
  }
  if (iters.length === 0) {
    return collection;
  }
  if (collection.toSeq().size === 0 && !collection.__ownerID && iters.length === 1) {
    return isRecord(collection) ? collection : collection.create(iters[0]);
  }
  return collection.withMutations((collection2) => {
    const mergeIntoCollection = merger ? (value, key) => {
      update(collection2, key, NOT_SET, (oldVal) => oldVal === NOT_SET ? value : merger(oldVal, value, key));
    } : (value, key) => {
      collection2.set(key, value);
    };
    for (let ii = 0; ii < iters.length; ii++) {
      iters[ii].forEach(mergeIntoCollection);
    }
  });
}

// src/utils/isPlainObj.ts
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === null) {
    return true;
  }
  let parentProto = proto;
  let nextProto = Object.getPrototypeOf(proto);
  while (nextProto !== null) {
    parentProto = nextProto;
    nextProto = Object.getPrototypeOf(parentProto);
  }
  return parentProto === proto;
}

// src/utils/isDataStructure.ts
function isDataStructure(value) {
  return typeof value === "object" && (isImmutable(value) || Array.isArray(value) || isPlainObject(value));
}

// src/utils/arrCopy.ts
function arrCopy(arr, offset = 0) {
  return arr.slice(offset);
}

// src/utils/shallowCopy.ts
function shallowCopy(from) {
  if (Array.isArray(from)) {
    return arrCopy(from);
  }
  const to = {};
  for (const key in from) {
    if (hasOwnProperty_default.call(from, key)) {
      to[key] = from[key];
    }
  }
  return to;
}

// src/functional/merge.js
function merge2(collection, ...sources) {
  return mergeWithSources(collection, sources);
}
function mergeWith2(merger, collection, ...sources) {
  return mergeWithSources(collection, sources, merger);
}
function mergeDeep(collection, ...sources) {
  return mergeDeepWithSources(collection, sources);
}
function mergeDeepWith(merger, collection, ...sources) {
  return mergeDeepWithSources(collection, sources, merger);
}
function mergeDeepWithSources(collection, sources, merger) {
  return mergeWithSources(collection, sources, deepMergerWith(merger));
}
function mergeWithSources(collection, sources, merger) {
  if (!isDataStructure(collection)) {
    throw new TypeError("Cannot merge into non-data-structure value: " + collection);
  }
  if (isImmutable(collection)) {
    return typeof merger === "function" && collection.mergeWith ? collection.mergeWith(merger, ...sources) : collection.merge ? collection.merge(...sources) : collection.concat(...sources);
  }
  const isArray = Array.isArray(collection);
  let merged = collection;
  const Collection2 = isArray ? IndexedCollection : KeyedCollection;
  const mergeItem = isArray ? (value) => {
    if (merged === collection) {
      merged = shallowCopy(merged);
    }
    merged.push(value);
  } : (value, key) => {
    const hasVal = hasOwnProperty_default.call(merged, key);
    const nextVal = hasVal && merger ? merger(merged[key], value, key) : value;
    if (!hasVal || nextVal !== merged[key]) {
      if (merged === collection) {
        merged = shallowCopy(merged);
      }
      merged[key] = nextVal;
    }
  };
  for (let i = 0; i < sources.length; i++) {
    Collection2(sources[i]).forEach(mergeItem);
  }
  return merged;
}
function deepMergerWith(merger) {
  function deepMerger(oldValue, newValue, key) {
    return isDataStructure(oldValue) && isDataStructure(newValue) && areMergeable(oldValue, newValue) ? mergeWithSources(oldValue, [
      newValue
    ], deepMerger) : merger ? merger(oldValue, newValue, key) : newValue;
  }
  return deepMerger;
}
function areMergeable(oldDataStructure, newDataStructure) {
  const oldSeq = Seq(oldDataStructure);
  const newSeq = Seq(newDataStructure);
  return isIndexed(oldSeq) === isIndexed(newSeq) && isKeyed(oldSeq) === isKeyed(newSeq);
}

// src/methods/mergeDeep.js
function mergeDeep2(...iters) {
  return mergeDeepWithSources(this, iters);
}
function mergeDeepWith2(merger, ...iters) {
  return mergeDeepWithSources(this, iters, merger);
}

// src/methods/mergeDeepIn.js
function mergeDeepIn(keyPath, ...iters) {
  return updateIn(this, keyPath, emptyMap(), (m) => mergeDeepWithSources(m, iters));
}

// src/methods/mergeIn.js
function mergeIn(keyPath, ...iters) {
  return updateIn(this, keyPath, emptyMap(), (m) => mergeWithSources(m, iters));
}

// src/functional/setIn.ts
function setIn(collection, keyPath, value) {
  return updateIn(collection, keyPath, NOT_SET, () => value);
}

// src/methods/setIn.js
function setIn2(keyPath, v) {
  return setIn(this, keyPath, v);
}

// src/methods/update.js
function update2(key, notSetValue, updater) {
  return arguments.length === 1 ? key(this) : update(this, key, notSetValue, updater);
}

// src/methods/updateIn.js
function updateIn2(keyPath, notSetValue, updater) {
  return updateIn(this, keyPath, notSetValue, updater);
}

// src/methods/wasAltered.js
function wasAltered() {
  return this.__altered;
}

// src/methods/withMutations.js
function withMutations(fn) {
  const mutable = this.asMutable();
  fn(mutable);
  return mutable.wasAltered() ? mutable.__ensureOwner(this.__ownerID) : this;
}

// src/predicates/isMap.ts
var IS_MAP_SYMBOL = "@@__IMMUTABLE_MAP__@@";
function isMap(maybeMap) {
  return Boolean(maybeMap && // @ts-expect-error: maybeMap is typed as `{}`, need to change in 6.0 to `maybeMap && typeof maybeMap === 'object' && IS_MAP_SYMBOL in maybeMap`
  maybeMap[IS_MAP_SYMBOL]);
}

// src/Map.js
var Map = (value) => value === void 0 || value === null ? emptyMap() : isMap(value) && !isOrdered(value) ? value : emptyMap().withMutations((map) => {
  const iter = KeyedCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v, k) => map.set(k, v));
});
var MapImpl = class extends KeyedCollectionImpl {
  create(value) {
    return Map(value);
  }
  toString() {
    return this.__toString("Map {", "}");
  }
  // @pragma Access
  get(k, notSetValue) {
    return this._root ? this._root.get(0, void 0, k, notSetValue) : notSetValue;
  }
  // @pragma Modification
  set(k, v) {
    return updateMap(this, k, v);
  }
  remove(k) {
    return updateMap(this, k, NOT_SET);
  }
  deleteAll(keys) {
    const collection = Collection(keys);
    if (collection.size === 0) {
      return this;
    }
    return this.withMutations((map) => {
      collection.forEach((key) => map.remove(key));
    });
  }
  clear() {
    if (this.size === 0) {
      return this;
    }
    if (this.__ownerID) {
      this.size = 0;
      this._root = null;
      this.__hash = void 0;
      this.__altered = true;
      return this;
    }
    return emptyMap();
  }
  // @pragma Composition
  sort(comparator) {
    return OrderedMap(sortFactory(this, comparator));
  }
  sortBy(mapper, comparator) {
    return OrderedMap(sortFactory(this, comparator, mapper));
  }
  map(mapper, context) {
    return this.withMutations((map) => {
      map.forEach((value, key) => {
        map.set(key, mapper.call(context, value, key, this));
      });
    });
  }
  // @pragma Mutability
  __iterator(type, reverse) {
    return new MapIterator(this, type, reverse);
  }
  __iterate(fn, reverse) {
    let iterations = 0;
    this._root && this._root.iterate((entry) => {
      iterations++;
      return fn(entry[1], entry[0], this);
    }, reverse);
    return iterations;
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    if (!ownerID) {
      if (this.size === 0) {
        return emptyMap();
      }
      this.__ownerID = ownerID;
      this.__altered = false;
      return this;
    }
    return makeMap(this.size, this._root, ownerID, this.__hash);
  }
};
Map.isMap = isMap;
var MapPrototype = MapImpl.prototype;
MapPrototype[IS_MAP_SYMBOL] = true;
MapPrototype[DELETE] = MapPrototype.remove;
MapPrototype.removeAll = MapPrototype.deleteAll;
MapPrototype.setIn = setIn2;
MapPrototype.removeIn = MapPrototype.deleteIn = deleteIn;
MapPrototype.update = update2;
MapPrototype.updateIn = updateIn2;
MapPrototype.merge = MapPrototype.concat = merge;
MapPrototype.mergeWith = mergeWith;
MapPrototype.mergeDeep = mergeDeep2;
MapPrototype.mergeDeepWith = mergeDeepWith2;
MapPrototype.mergeIn = mergeIn;
MapPrototype.mergeDeepIn = mergeDeepIn;
MapPrototype.withMutations = withMutations;
MapPrototype.wasAltered = wasAltered;
MapPrototype.asImmutable = asImmutable;
MapPrototype.asMutable = asMutable;
var ArrayMapNode = class _ArrayMapNode {
  constructor(ownerID, entries) {
    this.ownerID = ownerID;
    this.entries = entries;
  }
  get(shift, keyHash, key, notSetValue) {
    const entries = this.entries;
    for (let ii = 0, len = entries.length; ii < len; ii++) {
      if (is(key, entries[ii][0])) {
        return entries[ii][1];
      }
    }
    return notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    const removed = value === NOT_SET;
    const entries = this.entries;
    let idx = 0;
    const len = entries.length;
    for (; idx < len; idx++) {
      if (is(key, entries[idx][0])) {
        break;
      }
    }
    const exists = idx < len;
    if (exists ? entries[idx][1] === value : removed) {
      return this;
    }
    SetRef(didAlter);
    (removed || !exists) && SetRef(didChangeSize);
    if (removed && entries.length === 1) {
      return;
    }
    if (!exists && !removed && entries.length >= MAX_ARRAY_MAP_SIZE) {
      return createNodes(ownerID, entries, key, value);
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newEntries = isEditable ? entries : arrCopy(entries);
    if (exists) {
      if (removed) {
        idx === len - 1 ? newEntries.pop() : newEntries[idx] = newEntries.pop();
      } else {
        newEntries[idx] = [
          key,
          value
        ];
      }
    } else {
      newEntries.push([
        key,
        value
      ]);
    }
    if (isEditable) {
      this.entries = newEntries;
      return this;
    }
    return new _ArrayMapNode(ownerID, newEntries);
  }
};
var BitmapIndexedNode = class _BitmapIndexedNode {
  constructor(ownerID, bitmap, nodes) {
    this.ownerID = ownerID;
    this.bitmap = bitmap;
    this.nodes = nodes;
  }
  get(shift, keyHash, key, notSetValue) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const bit = 1 << ((shift === 0 ? keyHash : keyHash >>> shift) & MASK);
    const bitmap = this.bitmap;
    return (bitmap & bit) === 0 ? notSetValue : this.nodes[popCount(bitmap & bit - 1)].get(shift + SHIFT, keyHash, key, notSetValue);
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const keyHashFrag = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const bit = 1 << keyHashFrag;
    const bitmap = this.bitmap;
    const exists = (bitmap & bit) !== 0;
    if (!exists && value === NOT_SET) {
      return this;
    }
    const idx = popCount(bitmap & bit - 1);
    const nodes = this.nodes;
    const node = exists ? nodes[idx] : void 0;
    const newNode = updateNode(node, ownerID, shift + SHIFT, keyHash, key, value, didChangeSize, didAlter);
    if (newNode === node) {
      return this;
    }
    if (!exists && newNode && nodes.length >= MAX_BITMAP_INDEXED_SIZE) {
      return expandNodes(ownerID, nodes, bitmap, keyHashFrag, newNode);
    }
    if (exists && !newNode && nodes.length === 2 && isLeafNode(nodes[idx ^ 1])) {
      return nodes[idx ^ 1];
    }
    if (exists && newNode && nodes.length === 1 && isLeafNode(newNode)) {
      return newNode;
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newBitmap = exists ? newNode ? bitmap : bitmap ^ bit : bitmap | bit;
    const newNodes = exists ? newNode ? setAt(nodes, idx, newNode, isEditable) : spliceOut(nodes, idx, isEditable) : spliceIn(nodes, idx, newNode, isEditable);
    if (isEditable) {
      this.bitmap = newBitmap;
      this.nodes = newNodes;
      return this;
    }
    return new _BitmapIndexedNode(ownerID, newBitmap, newNodes);
  }
};
var HashArrayMapNode = class _HashArrayMapNode {
  constructor(ownerID, count, nodes) {
    this.ownerID = ownerID;
    this.count = count;
    this.nodes = nodes;
  }
  get(shift, keyHash, key, notSetValue) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const idx = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const node = this.nodes[idx];
    return node ? node.get(shift + SHIFT, keyHash, key, notSetValue) : notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const idx = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const removed = value === NOT_SET;
    const nodes = this.nodes;
    const node = nodes[idx];
    if (removed && !node) {
      return this;
    }
    const newNode = updateNode(node, ownerID, shift + SHIFT, keyHash, key, value, didChangeSize, didAlter);
    if (newNode === node) {
      return this;
    }
    let newCount = this.count;
    if (!node) {
      newCount++;
    } else if (!newNode) {
      newCount--;
      if (newCount < MIN_HASH_ARRAY_MAP_SIZE) {
        return packNodes(ownerID, nodes, newCount, idx);
      }
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newNodes = setAt(nodes, idx, newNode, isEditable);
    if (isEditable) {
      this.count = newCount;
      this.nodes = newNodes;
      return this;
    }
    return new _HashArrayMapNode(ownerID, newCount, newNodes);
  }
};
var HashCollisionNode = class _HashCollisionNode {
  constructor(ownerID, keyHash, entries) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entries = entries;
  }
  get(shift, keyHash, key, notSetValue) {
    const entries = this.entries;
    for (let ii = 0, len = entries.length; ii < len; ii++) {
      if (is(key, entries[ii][0])) {
        return entries[ii][1];
      }
    }
    return notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const removed = value === NOT_SET;
    if (keyHash !== this.keyHash) {
      if (removed) {
        return this;
      }
      SetRef(didAlter);
      SetRef(didChangeSize);
      return mergeIntoNode(this, ownerID, shift, keyHash, [
        key,
        value
      ]);
    }
    const entries = this.entries;
    let idx = 0;
    const len = entries.length;
    for (; idx < len; idx++) {
      if (is(key, entries[idx][0])) {
        break;
      }
    }
    const exists = idx < len;
    if (exists ? entries[idx][1] === value : removed) {
      return this;
    }
    SetRef(didAlter);
    (removed || !exists) && SetRef(didChangeSize);
    if (removed && len === 2) {
      return new ValueNode(ownerID, this.keyHash, entries[idx ^ 1]);
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newEntries = isEditable ? entries : arrCopy(entries);
    if (exists) {
      if (removed) {
        idx === len - 1 ? newEntries.pop() : newEntries[idx] = newEntries.pop();
      } else {
        newEntries[idx] = [
          key,
          value
        ];
      }
    } else {
      newEntries.push([
        key,
        value
      ]);
    }
    if (isEditable) {
      this.entries = newEntries;
      return this;
    }
    return new _HashCollisionNode(ownerID, this.keyHash, newEntries);
  }
};
var ValueNode = class _ValueNode {
  constructor(ownerID, keyHash, entry) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entry = entry;
  }
  get(shift, keyHash, key, notSetValue) {
    return is(key, this.entry[0]) ? this.entry[1] : notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    const removed = value === NOT_SET;
    const keyMatch = is(key, this.entry[0]);
    if (keyMatch ? value === this.entry[1] : removed) {
      return this;
    }
    SetRef(didAlter);
    if (removed) {
      SetRef(didChangeSize);
      return;
    }
    if (keyMatch) {
      if (ownerID && ownerID === this.ownerID) {
        this.entry[1] = value;
        return this;
      }
      return new _ValueNode(ownerID, this.keyHash, [
        key,
        value
      ]);
    }
    SetRef(didChangeSize);
    return mergeIntoNode(this, ownerID, shift, hash(key), [
      key,
      value
    ]);
  }
};
ArrayMapNode.prototype.iterate = HashCollisionNode.prototype.iterate = function(fn, reverse) {
  const entries = this.entries;
  for (let ii = 0, maxIndex = entries.length - 1; ii <= maxIndex; ii++) {
    if (fn(entries[reverse ? maxIndex - ii : ii]) === false) {
      return false;
    }
  }
};
BitmapIndexedNode.prototype.iterate = HashArrayMapNode.prototype.iterate = function(fn, reverse) {
  const nodes = this.nodes;
  for (let ii = 0, maxIndex = nodes.length - 1; ii <= maxIndex; ii++) {
    const node = nodes[reverse ? maxIndex - ii : ii];
    if (node && node.iterate(fn, reverse) === false) {
      return false;
    }
  }
};
ValueNode.prototype.iterate = function(fn, reverse) {
  return fn(this.entry);
};
var MapIterator = class extends Iterator {
  constructor(map, type, reverse) {
    super();
    this._type = type;
    this._reverse = reverse;
    this._stack = map._root && mapIteratorFrame(map._root);
  }
  next() {
    const type = this._type;
    let stack = this._stack;
    while (stack) {
      const node = stack.node;
      const index = stack.index++;
      let maxIndex;
      if (node.entry) {
        if (index === 0) {
          return mapIteratorValue(type, node.entry);
        }
      } else if (node.entries) {
        maxIndex = node.entries.length - 1;
        if (index <= maxIndex) {
          return mapIteratorValue(type, node.entries[this._reverse ? maxIndex - index : index]);
        }
      } else {
        maxIndex = node.nodes.length - 1;
        if (index <= maxIndex) {
          const subNode = node.nodes[this._reverse ? maxIndex - index : index];
          if (subNode) {
            if (subNode.entry) {
              return mapIteratorValue(type, subNode.entry);
            }
            stack = this._stack = mapIteratorFrame(subNode, stack);
          }
          continue;
        }
      }
      stack = this._stack = this._stack.__prev;
    }
    return iteratorDone();
  }
};
function mapIteratorValue(type, entry) {
  return iteratorValue(type, entry[0], entry[1]);
}
function mapIteratorFrame(node, prev) {
  return {
    node,
    index: 0,
    __prev: prev
  };
}
function makeMap(size, root, ownerID, hash2) {
  const map = Object.create(MapPrototype);
  map.size = size;
  map._root = root;
  map.__ownerID = ownerID;
  map.__hash = hash2;
  map.__altered = false;
  return map;
}
function emptyMap() {
  return makeMap(0);
}
function updateMap(map, k, v) {
  let newRoot;
  let newSize;
  if (!map._root) {
    if (v === NOT_SET) {
      return map;
    }
    newSize = 1;
    newRoot = new ArrayMapNode(map.__ownerID, [
      [
        k,
        v
      ]
    ]);
  } else {
    const didChangeSize = MakeRef();
    const didAlter = MakeRef();
    newRoot = updateNode(map._root, map.__ownerID, 0, void 0, k, v, didChangeSize, didAlter);
    if (!didAlter.value) {
      return map;
    }
    newSize = map.size + (didChangeSize.value ? v === NOT_SET ? -1 : 1 : 0);
  }
  if (map.__ownerID) {
    map.size = newSize;
    map._root = newRoot;
    map.__hash = void 0;
    map.__altered = true;
    return map;
  }
  return newRoot ? makeMap(newSize, newRoot) : emptyMap();
}
function updateNode(node, ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
  if (!node) {
    if (value === NOT_SET) {
      return node;
    }
    SetRef(didAlter);
    SetRef(didChangeSize);
    return new ValueNode(ownerID, keyHash, [
      key,
      value
    ]);
  }
  return node.update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter);
}
function isLeafNode(node) {
  return node.constructor === ValueNode || node.constructor === HashCollisionNode;
}
function mergeIntoNode(node, ownerID, shift, keyHash, entry) {
  if (node.keyHash === keyHash) {
    return new HashCollisionNode(ownerID, keyHash, [
      node.entry,
      entry
    ]);
  }
  const idx1 = (shift === 0 ? node.keyHash : node.keyHash >>> shift) & MASK;
  const idx2 = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
  let newNode;
  const nodes = idx1 === idx2 ? [
    mergeIntoNode(node, ownerID, shift + SHIFT, keyHash, entry)
  ] : (newNode = new ValueNode(ownerID, keyHash, entry), idx1 < idx2 ? [
    node,
    newNode
  ] : [
    newNode,
    node
  ]);
  return new BitmapIndexedNode(ownerID, 1 << idx1 | 1 << idx2, nodes);
}
function createNodes(ownerID, entries, key, value) {
  if (!ownerID) {
    ownerID = new OwnerID();
  }
  let node = new ValueNode(ownerID, hash(key), [
    key,
    value
  ]);
  for (let ii = 0; ii < entries.length; ii++) {
    const entry = entries[ii];
    node = node.update(ownerID, 0, void 0, entry[0], entry[1]);
  }
  return node;
}
function packNodes(ownerID, nodes, count, excluding) {
  let bitmap = 0;
  let packedII = 0;
  const packedNodes = new Array(count);
  for (let ii = 0, bit = 1, len = nodes.length; ii < len; ii++, bit <<= 1) {
    const node = nodes[ii];
    if (node !== void 0 && ii !== excluding) {
      bitmap |= bit;
      packedNodes[packedII++] = node;
    }
  }
  return new BitmapIndexedNode(ownerID, bitmap, packedNodes);
}
function expandNodes(ownerID, nodes, bitmap, including, node) {
  let count = 0;
  const expandedNodes = new Array(SIZE);
  for (let ii = 0; bitmap !== 0; ii++, bitmap >>>= 1) {
    expandedNodes[ii] = bitmap & 1 ? nodes[count++] : void 0;
  }
  expandedNodes[including] = node;
  return new HashArrayMapNode(ownerID, count + 1, expandedNodes);
}
function popCount(x) {
  x -= x >> 1 & 1431655765;
  x = (x & 858993459) + (x >> 2 & 858993459);
  x = x + (x >> 4) & 252645135;
  x += x >> 8;
  x += x >> 16;
  return x & 127;
}
function setAt(array, idx, val, canEdit) {
  const newArray = canEdit ? array : arrCopy(array);
  newArray[idx] = val;
  return newArray;
}
function spliceIn(array, idx, val, canEdit) {
  const newLen = array.length + 1;
  if (canEdit && idx + 1 === newLen) {
    array[idx] = val;
    return array;
  }
  const newArray = new Array(newLen);
  let after = 0;
  for (let ii = 0; ii < newLen; ii++) {
    if (ii === idx) {
      newArray[ii] = val;
      after = -1;
    } else {
      newArray[ii] = array[ii + after];
    }
  }
  return newArray;
}
function spliceOut(array, idx, canEdit) {
  const newLen = array.length - 1;
  if (canEdit && idx === newLen) {
    array.pop();
    return array;
  }
  const newArray = new Array(newLen);
  let after = 0;
  for (let ii = 0; ii < newLen; ii++) {
    if (ii === idx) {
      after = 1;
    }
    newArray[ii] = array[ii + after];
  }
  return newArray;
}
var MAX_ARRAY_MAP_SIZE = SIZE / 4;
var MAX_BITMAP_INDEXED_SIZE = SIZE / 2;
var MIN_HASH_ARRAY_MAP_SIZE = SIZE / 4;

// src/utils/coerceKeyPath.ts
function coerceKeyPath(keyPath) {
  if (isArrayLike(keyPath) && typeof keyPath !== "string") {
    return keyPath;
  }
  if (isOrdered(keyPath)) {
    return keyPath.toArray();
  }
  throw new TypeError("Invalid keyPath: expected Ordered Collection or Array: " + keyPath);
}

// src/utils/quoteString.ts
function quoteString(value) {
  try {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  } catch (_ignoreError) {
    return JSON.stringify(value);
  }
}

// src/functional/has.ts
function has(collection, key) {
  return isImmutable(collection) ? collection.has(key) : isDataStructure(collection) && hasOwnProperty_default.call(collection, key);
}

// src/functional/get.ts
function get(collection, key, notSetValue) {
  return isImmutable(collection) ? collection.get(key, notSetValue) : !has(collection, key) ? notSetValue : typeof collection.get === "function" ? collection.get(key) : collection[key];
}

// src/functional/remove.ts
function remove(collection, key) {
  if (!isDataStructure(collection)) {
    throw new TypeError("Cannot update non-data-structure value: " + collection);
  }
  if (isImmutable(collection)) {
    if (!collection.remove) {
      throw new TypeError("Cannot update immutable value without .remove() method: " + collection);
    }
    return collection.remove(key);
  }
  if (!hasOwnProperty_default.call(collection, key)) {
    return collection;
  }
  const collectionCopy = shallowCopy(collection);
  if (Array.isArray(collectionCopy)) {
    collectionCopy.splice(key, 1);
  } else {
    delete collectionCopy[key];
  }
  return collectionCopy;
}

// src/functional/set.ts
function set(collection, key, value) {
  if (!isDataStructure(collection)) {
    throw new TypeError("Cannot update non-data-structure value: " + collection);
  }
  if (isImmutable(collection)) {
    if (!collection.set) {
      throw new TypeError("Cannot update immutable value without .set() method: " + collection);
    }
    return collection.set(key, value);
  }
  if (hasOwnProperty_default.call(collection, key) && value === collection[key]) {
    return collection;
  }
  const collectionCopy = shallowCopy(collection);
  collectionCopy[key] = value;
  return collectionCopy;
}

// src/functional/updateIn.ts
function updateIn(collection, keyPath, notSetValue, updater) {
  if (!updater) {
    updater = notSetValue;
    notSetValue = void 0;
  }
  const updatedValue = updateInDeeply(isImmutable(collection), collection, coerceKeyPath(keyPath), 0, notSetValue, updater);
  return updatedValue === NOT_SET ? notSetValue : updatedValue;
}
function updateInDeeply(inImmutable, existing, keyPath, i, notSetValue, updater) {
  const wasNotSet = existing === NOT_SET;
  if (i === keyPath.length) {
    const existingValue = wasNotSet ? notSetValue : existing;
    const newValue = updater(existingValue);
    return newValue === existingValue ? existing : newValue;
  }
  if (!wasNotSet && !isDataStructure(existing)) {
    throw new TypeError("Cannot update within non-data-structure value in path [" + Array.from(keyPath).slice(0, i).map(quoteString) + "]: " + existing);
  }
  const key = keyPath[i];
  const nextExisting = wasNotSet ? NOT_SET : get(existing, key, NOT_SET);
  const nextUpdated = updateInDeeply(nextExisting === NOT_SET ? inImmutable : isImmutable(nextExisting), nextExisting, keyPath, i + 1, notSetValue, updater);
  return nextUpdated === nextExisting ? existing : nextUpdated === NOT_SET ? remove(existing, key) : set(wasNotSet ? inImmutable ? emptyMap() : {} : existing, key, nextUpdated);
}

// src/functional/removeIn.ts
function removeIn(collection, keyPath) {
  return updateIn(collection, keyPath, () => NOT_SET);
}

// src/methods/deleteIn.js
function deleteIn(keyPath) {
  return removeIn(this, keyPath);
}

// src/predicates/isList.ts
var IS_LIST_SYMBOL = "@@__IMMUTABLE_LIST__@@";
function isList(maybeList) {
  return Boolean(maybeList && // @ts-expect-error: maybeList is typed as `{}`, need to change in 6.0 to `maybeList && typeof maybeList === 'object' && IS_LIST_SYMBOL in maybeList`
  maybeList[IS_LIST_SYMBOL]);
}

// src/List.js
var List = (value) => {
  const empty = emptyList();
  if (value === void 0 || value === null) {
    return empty;
  }
  if (isList(value)) {
    return value;
  }
  const iter = IndexedCollection(value);
  const size = iter.size;
  if (size === 0) {
    return empty;
  }
  assertNotInfinite(size);
  if (size > 0 && size < SIZE) {
    return makeList(0, size, SHIFT, null, new VNode(iter.toArray()));
  }
  return empty.withMutations((list) => {
    list.setSize(size);
    iter.forEach((v, i) => list.set(i, v));
  });
};
List.of = function(...values) {
  return List(values);
};
var ListImpl = class extends IndexedCollectionImpl {
  // @pragma Construction
  create(value) {
    return List(value);
  }
  toString() {
    return this.__toString("List [", "]");
  }
  // @pragma Access
  get(index, notSetValue) {
    index = wrapIndex(this, index);
    if (index >= 0 && index < this.size) {
      index += this._origin;
      const node = listNodeFor(this, index);
      return node && node.array[index & MASK];
    }
    return notSetValue;
  }
  // @pragma Modification
  set(index, value) {
    return updateList(this, index, value);
  }
  remove(index) {
    return !this.has(index) ? this : index === 0 ? this.shift() : index === this.size - 1 ? this.pop() : this.splice(index, 1);
  }
  insert(index, value) {
    return this.splice(index, 0, value);
  }
  clear() {
    if (this.size === 0) {
      return this;
    }
    if (this.__ownerID) {
      this.size = this._origin = this._capacity = 0;
      this._level = SHIFT;
      this._root = this._tail = this.__hash = void 0;
      this.__altered = true;
      return this;
    }
    return emptyList();
  }
  push(...values) {
    const oldSize = this.size;
    return this.withMutations((list) => {
      setListBounds(list, 0, oldSize + values.length);
      for (let ii = 0; ii < values.length; ii++) {
        list.set(oldSize + ii, values[ii]);
      }
    });
  }
  pop() {
    return setListBounds(this, 0, -1);
  }
  unshift(...values) {
    return this.withMutations((list) => {
      setListBounds(list, -values.length);
      for (let ii = 0; ii < values.length; ii++) {
        list.set(ii, values[ii]);
      }
    });
  }
  shift() {
    return setListBounds(this, 1);
  }
  shuffle(random = Math.random) {
    return this.withMutations((mutable) => {
      let current = mutable.size;
      let destination;
      let tmp;
      while (current) {
        destination = Math.floor(random() * current--);
        tmp = mutable.get(destination);
        mutable.set(destination, mutable.get(current));
        mutable.set(current, tmp);
      }
    });
  }
  // @pragma Composition
  concat(...collections) {
    const seqs = [];
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      const seq = IndexedCollection(typeof collection !== "string" && hasIterator(collection) ? collection : [
        collection
      ]);
      if (seq.size !== 0) {
        seqs.push(seq);
      }
    }
    if (seqs.length === 0) {
      return this;
    }
    if (this.size === 0 && !this.__ownerID && seqs.length === 1) {
      return List(seqs[0]);
    }
    return this.withMutations((list) => {
      seqs.forEach((seq) => seq.forEach((value) => list.push(value)));
    });
  }
  setSize(size) {
    return setListBounds(this, 0, size);
  }
  map(mapper, context) {
    return this.withMutations((list) => {
      for (let i = 0; i < this.size; i++) {
        list.set(i, mapper.call(context, list.get(i), i, this));
      }
    });
  }
  // @pragma Iteration
  slice(begin, end) {
    const size = this.size;
    if (wholeSlice(begin, end, size)) {
      return this;
    }
    return setListBounds(this, resolveBegin(begin, size), resolveEnd(end, size));
  }
  __iterator(type, reverse) {
    let index = reverse ? this.size : 0;
    const values = iterateList(this, reverse);
    return new Iterator(() => {
      const value = values();
      return value === DONE ? iteratorDone() : iteratorValue(type, reverse ? --index : index++, value);
    });
  }
  __iterate(fn, reverse) {
    let index = reverse ? this.size : 0;
    const values = iterateList(this, reverse);
    let value;
    while ((value = values()) !== DONE) {
      if (fn(value, reverse ? --index : index++, this) === false) {
        break;
      }
    }
    return index;
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    if (!ownerID) {
      if (this.size === 0) {
        return emptyList();
      }
      this.__ownerID = ownerID;
      this.__altered = false;
      return this;
    }
    return makeList(this._origin, this._capacity, this._level, this._root, this._tail, ownerID, this.__hash);
  }
};
List.isList = isList;
var ListPrototype = ListImpl.prototype;
ListPrototype[IS_LIST_SYMBOL] = true;
ListPrototype[DELETE] = ListPrototype.remove;
ListPrototype.merge = ListPrototype.concat;
ListPrototype.setIn = setIn2;
ListPrototype.deleteIn = ListPrototype.removeIn = deleteIn;
ListPrototype.update = update2;
ListPrototype.updateIn = updateIn2;
ListPrototype.mergeIn = mergeIn;
ListPrototype.mergeDeepIn = mergeDeepIn;
ListPrototype.withMutations = withMutations;
ListPrototype.wasAltered = wasAltered;
ListPrototype.asImmutable = asImmutable;
ListPrototype.asMutable = asMutable;
var VNode = class _VNode {
  constructor(array, ownerID) {
    this.array = array;
    this.ownerID = ownerID;
  }
  // TODO: seems like these methods are very similar
  removeBefore(ownerID, level, index) {
    if ((index & (1 << level + SHIFT) - 1) === 0 || this.array.length === 0) {
      return this;
    }
    const originIndex = index >>> level & MASK;
    if (originIndex >= this.array.length) {
      return new _VNode([], ownerID);
    }
    const removingFirst = originIndex === 0;
    let newChild;
    if (level > 0) {
      const oldChild = this.array[originIndex];
      newChild = oldChild && oldChild.removeBefore(ownerID, level - SHIFT, index);
      if (newChild === oldChild && removingFirst) {
        return this;
      }
    }
    if (removingFirst && !newChild) {
      return this;
    }
    const editable = editableVNode(this, ownerID);
    if (!removingFirst) {
      for (let ii = 0; ii < originIndex; ii++) {
        editable.array[ii] = void 0;
      }
    }
    if (newChild) {
      editable.array[originIndex] = newChild;
    }
    return editable;
  }
  removeAfter(ownerID, level, index) {
    if (index === (level ? 1 << level + SHIFT : SIZE) || this.array.length === 0) {
      return this;
    }
    const sizeIndex = index - 1 >>> level & MASK;
    if (sizeIndex >= this.array.length) {
      return this;
    }
    let newChild;
    if (level > 0) {
      const oldChild = this.array[sizeIndex];
      newChild = oldChild && oldChild.removeAfter(ownerID, level - SHIFT, index);
      if (newChild === oldChild && sizeIndex === this.array.length - 1) {
        return this;
      }
    }
    const editable = editableVNode(this, ownerID);
    editable.array.splice(sizeIndex + 1);
    if (newChild) {
      editable.array[sizeIndex] = newChild;
    }
    return editable;
  }
};
var DONE = {};
function iterateList(list, reverse) {
  const left = list._origin;
  const right = list._capacity;
  const tailPos = getTailOffset(right);
  const tail = list._tail;
  return iterateNodeOrLeaf(list._root, list._level, 0);
  function iterateNodeOrLeaf(node, level, offset) {
    return level === 0 ? iterateLeaf(node, offset) : iterateNode(node, level, offset);
  }
  function iterateLeaf(node, offset) {
    const array = offset === tailPos ? tail && tail.array : node && node.array;
    let from = offset > left ? 0 : left - offset;
    let to = right - offset;
    if (to > SIZE) {
      to = SIZE;
    }
    return () => {
      if (from === to) {
        return DONE;
      }
      const idx = reverse ? --to : from++;
      return array && array[idx];
    };
  }
  function iterateNode(node, level, offset) {
    let values;
    const array = node && node.array;
    let from = offset > left ? 0 : left - offset >> level;
    let to = (right - offset >> level) + 1;
    if (to > SIZE) {
      to = SIZE;
    }
    return () => {
      while (true) {
        if (values) {
          const value = values();
          if (value !== DONE) {
            return value;
          }
          values = null;
        }
        if (from === to) {
          return DONE;
        }
        const idx = reverse ? --to : from++;
        values = iterateNodeOrLeaf(array && array[idx], level - SHIFT, offset + (idx << level));
      }
    };
  }
}
function makeList(origin, capacity, level, root, tail, ownerID, hash2) {
  const list = Object.create(ListPrototype);
  list.size = capacity - origin;
  list._origin = origin;
  list._capacity = capacity;
  list._level = level;
  list._root = root;
  list._tail = tail;
  list.__ownerID = ownerID;
  list.__hash = hash2;
  list.__altered = false;
  return list;
}
function emptyList() {
  return makeList(0, 0, SHIFT);
}
function updateList(list, index, value) {
  index = wrapIndex(list, index);
  if (index !== index) {
    return list;
  }
  if (index >= list.size || index < 0) {
    return list.withMutations((list2) => {
      index < 0 ? setListBounds(list2, index).set(0, value) : setListBounds(list2, 0, index + 1).set(index, value);
    });
  }
  index += list._origin;
  let newTail = list._tail;
  let newRoot = list._root;
  const didAlter = MakeRef();
  if (index >= getTailOffset(list._capacity)) {
    newTail = updateVNode(newTail, list.__ownerID, 0, index, value, didAlter);
  } else {
    newRoot = updateVNode(newRoot, list.__ownerID, list._level, index, value, didAlter);
  }
  if (!didAlter.value) {
    return list;
  }
  if (list.__ownerID) {
    list._root = newRoot;
    list._tail = newTail;
    list.__hash = void 0;
    list.__altered = true;
    return list;
  }
  return makeList(list._origin, list._capacity, list._level, newRoot, newTail);
}
function updateVNode(node, ownerID, level, index, value, didAlter) {
  const idx = index >>> level & MASK;
  const nodeHas = node && idx < node.array.length;
  if (!nodeHas && value === void 0) {
    return node;
  }
  let newNode;
  if (level > 0) {
    const lowerNode = node && node.array[idx];
    const newLowerNode = updateVNode(lowerNode, ownerID, level - SHIFT, index, value, didAlter);
    if (newLowerNode === lowerNode) {
      return node;
    }
    newNode = editableVNode(node, ownerID);
    newNode.array[idx] = newLowerNode;
    return newNode;
  }
  if (nodeHas && node.array[idx] === value) {
    return node;
  }
  if (didAlter) {
    SetRef(didAlter);
  }
  newNode = editableVNode(node, ownerID);
  if (value === void 0 && idx === newNode.array.length - 1) {
    newNode.array.pop();
  } else {
    newNode.array[idx] = value;
  }
  return newNode;
}
function editableVNode(node, ownerID) {
  if (ownerID && node && ownerID === node.ownerID) {
    return node;
  }
  return new VNode(node ? node.array.slice() : [], ownerID);
}
function listNodeFor(list, rawIndex) {
  if (rawIndex >= getTailOffset(list._capacity)) {
    return list._tail;
  }
  if (rawIndex < 1 << list._level + SHIFT) {
    let node = list._root;
    let level = list._level;
    while (node && level > 0) {
      node = node.array[rawIndex >>> level & MASK];
      level -= SHIFT;
    }
    return node;
  }
}
function setListBounds(list, begin, end) {
  if (begin !== void 0) {
    begin |= 0;
  }
  if (end !== void 0) {
    end |= 0;
  }
  const owner = list.__ownerID || new OwnerID();
  let oldOrigin = list._origin;
  let oldCapacity = list._capacity;
  let newOrigin = oldOrigin + begin;
  let newCapacity = end === void 0 ? oldCapacity : end < 0 ? oldCapacity + end : oldOrigin + end;
  if (newOrigin === oldOrigin && newCapacity === oldCapacity) {
    return list;
  }
  if (newOrigin >= newCapacity) {
    return list.clear();
  }
  let newLevel = list._level;
  let newRoot = list._root;
  let offsetShift = 0;
  while (newOrigin + offsetShift < 0) {
    newRoot = new VNode(newRoot && newRoot.array.length ? [
      void 0,
      newRoot
    ] : [], owner);
    newLevel += SHIFT;
    offsetShift += 1 << newLevel;
  }
  if (offsetShift) {
    newOrigin += offsetShift;
    oldOrigin += offsetShift;
    newCapacity += offsetShift;
    oldCapacity += offsetShift;
  }
  const oldTailOffset = getTailOffset(oldCapacity);
  const newTailOffset = getTailOffset(newCapacity);
  while (newTailOffset >= 1 << newLevel + SHIFT) {
    newRoot = new VNode(newRoot && newRoot.array.length ? [
      newRoot
    ] : [], owner);
    newLevel += SHIFT;
  }
  const oldTail = list._tail;
  let newTail = newTailOffset < oldTailOffset ? listNodeFor(list, newCapacity - 1) : newTailOffset > oldTailOffset ? new VNode([], owner) : oldTail;
  if (oldTail && newTailOffset > oldTailOffset && newOrigin < oldCapacity && oldTail.array.length) {
    newRoot = editableVNode(newRoot, owner);
    let node = newRoot;
    for (let level = newLevel; level > SHIFT; level -= SHIFT) {
      const idx = oldTailOffset >>> level & MASK;
      node = node.array[idx] = editableVNode(node.array[idx], owner);
    }
    node.array[oldTailOffset >>> SHIFT & MASK] = oldTail;
  }
  if (newCapacity < oldCapacity) {
    newTail = newTail && newTail.removeAfter(owner, 0, newCapacity);
  }
  if (newOrigin >= newTailOffset) {
    newOrigin -= newTailOffset;
    newCapacity -= newTailOffset;
    newLevel = SHIFT;
    newRoot = null;
    newTail = newTail && newTail.removeBefore(owner, 0, newOrigin);
  } else if (newOrigin > oldOrigin || newTailOffset < oldTailOffset) {
    offsetShift = 0;
    while (newRoot) {
      const beginIndex = newOrigin >>> newLevel & MASK;
      if (beginIndex !== newTailOffset >>> newLevel & MASK) {
        break;
      }
      if (beginIndex) {
        offsetShift += (1 << newLevel) * beginIndex;
      }
      newLevel -= SHIFT;
      newRoot = newRoot.array[beginIndex];
    }
    if (newRoot && newOrigin > oldOrigin) {
      newRoot = newRoot.removeBefore(owner, newLevel, newOrigin - offsetShift);
    }
    if (newRoot && newTailOffset < oldTailOffset) {
      newRoot = newRoot.removeAfter(owner, newLevel, newTailOffset - offsetShift);
    }
    if (offsetShift) {
      newOrigin -= offsetShift;
      newCapacity -= offsetShift;
    }
  }
  if (list.__ownerID) {
    list.size = newCapacity - newOrigin;
    list._origin = newOrigin;
    list._capacity = newCapacity;
    list._level = newLevel;
    list._root = newRoot;
    list._tail = newTail;
    list.__hash = void 0;
    list.__altered = true;
    return list;
  }
  return makeList(newOrigin, newCapacity, newLevel, newRoot, newTail);
}
function getTailOffset(size) {
  return size < SIZE ? 0 : size - 1 >>> SHIFT << SHIFT;
}

// src/predicates/isOrderedMap.ts
function isOrderedMap(maybeOrderedMap) {
  return isMap(maybeOrderedMap) && isOrdered(maybeOrderedMap);
}

// src/OrderedMap.js
var OrderedMap = (value) => value === void 0 || value === null ? emptyOrderedMap() : isOrderedMap(value) ? value : emptyOrderedMap().withMutations((map) => {
  const iter = KeyedCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v, k) => map.set(k, v));
});
OrderedMap.of = function(...values) {
  return OrderedMap(values);
};
var OrderedMapImpl = class extends MapImpl {
  create(value) {
    return OrderedMap(value);
  }
  toString() {
    return this.__toString("OrderedMap {", "}");
  }
  // @pragma Access
  get(k, notSetValue) {
    const index = this._map.get(k);
    return index !== void 0 ? this._list.get(index)[1] : notSetValue;
  }
  // @pragma Modification
  clear() {
    if (this.size === 0) {
      return this;
    }
    if (this.__ownerID) {
      this.size = 0;
      this._map.clear();
      this._list.clear();
      this.__altered = true;
      return this;
    }
    return emptyOrderedMap();
  }
  set(k, v) {
    return updateOrderedMap(this, k, v);
  }
  remove(k) {
    return updateOrderedMap(this, k, NOT_SET);
  }
  __iterate(fn, reverse) {
    return this._list.__iterate((entry) => entry && fn(entry[1], entry[0], this), reverse);
  }
  __iterator(type, reverse) {
    return this._list.fromEntrySeq().__iterator(type, reverse);
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    const newMap = this._map.__ensureOwner(ownerID);
    const newList = this._list.__ensureOwner(ownerID);
    if (!ownerID) {
      if (this.size === 0) {
        return emptyOrderedMap();
      }
      this.__ownerID = ownerID;
      this.__altered = false;
      this._map = newMap;
      this._list = newList;
      return this;
    }
    return makeOrderedMap(newMap, newList, ownerID, this.__hash);
  }
};
OrderedMap.isOrderedMap = isOrderedMap;
OrderedMapImpl.prototype[IS_ORDERED_SYMBOL] = true;
OrderedMapImpl.prototype[DELETE] = OrderedMapImpl.prototype.remove;
function makeOrderedMap(map, list, ownerID, hash2) {
  const omap = Object.create(OrderedMapImpl.prototype);
  omap.size = map ? map.size : 0;
  omap._map = map;
  omap._list = list;
  omap.__ownerID = ownerID;
  omap.__hash = hash2;
  omap.__altered = false;
  return omap;
}
function emptyOrderedMap() {
  return makeOrderedMap(emptyMap(), emptyList());
}
function updateOrderedMap(omap, k, v) {
  const map = omap._map;
  const list = omap._list;
  const i = map.get(k);
  const has2 = i !== void 0;
  let newMap;
  let newList;
  if (v === NOT_SET) {
    if (!has2) {
      return omap;
    }
    if (list.size >= SIZE && list.size >= map.size * 2) {
      newList = list.filter((entry, idx) => entry !== void 0 && i !== idx);
      newMap = newList.toKeyedSeq().map((entry) => entry[0]).flip().toMap();
      if (omap.__ownerID) {
        newMap.__ownerID = newList.__ownerID = omap.__ownerID;
      }
    } else {
      newMap = map.remove(k);
      newList = i === list.size - 1 ? list.pop() : list.set(i, void 0);
    }
  } else if (has2) {
    if (v === list.get(i)[1]) {
      return omap;
    }
    newMap = map;
    newList = list.set(i, [
      k,
      v
    ]);
  } else {
    newMap = map.set(k, list.size);
    newList = list.set(list.size, [
      k,
      v
    ]);
  }
  if (omap.__ownerID) {
    omap.size = newMap.size;
    omap._map = newMap;
    omap._list = newList;
    omap.__hash = void 0;
    omap.__altered = true;
    return omap;
  }
  return makeOrderedMap(newMap, newList);
}

// src/predicates/isStack.ts
var IS_STACK_SYMBOL = "@@__IMMUTABLE_STACK__@@";
function isStack(maybeStack) {
  return Boolean(maybeStack && // @ts-expect-error: maybeStack is typed as `{}`, need to change in 6.0 to `maybeStack && typeof maybeStack === 'object' && MAYBE_STACK_SYMBOL in maybeStack`
  maybeStack[IS_STACK_SYMBOL]);
}

// src/Stack.js
var Stack = (value) => value === void 0 || value === null ? emptyStack() : isStack(value) ? value : emptyStack().pushAll(value);
Stack.of = function(...values) {
  return Stack(values);
};
var StackImpl = class extends IndexedCollectionImpl {
  create(value) {
    return Stack(value);
  }
  toString() {
    return this.__toString("Stack [", "]");
  }
  // @pragma Access
  get(index, notSetValue) {
    let head = this._head;
    index = wrapIndex(this, index);
    while (head && index--) {
      head = head.next;
    }
    return head ? head.value : notSetValue;
  }
  peek() {
    return this._head && this._head.value;
  }
  // @pragma Modification
  push(...values) {
    if (values.length === 0) {
      return this;
    }
    const newSize = this.size + values.length;
    let head = this._head;
    for (let ii = values.length - 1; ii >= 0; ii--) {
      head = {
        value: values[ii],
        next: head
      };
    }
    if (this.__ownerID) {
      this.size = newSize;
      this._head = head;
      this.__hash = void 0;
      this.__altered = true;
      return this;
    }
    return makeStack(newSize, head);
  }
  pushAll(iter) {
    iter = IndexedCollection(iter);
    if (iter.size === 0) {
      return this;
    }
    if (this.size === 0 && isStack(iter)) {
      return iter;
    }
    assertNotInfinite(iter.size);
    let newSize = this.size;
    let head = this._head;
    iter.__iterate(
      (value) => {
        newSize++;
        head = {
          value,
          next: head
        };
      },
      /* reverse */
      true
    );
    if (this.__ownerID) {
      this.size = newSize;
      this._head = head;
      this.__hash = void 0;
      this.__altered = true;
      return this;
    }
    return makeStack(newSize, head);
  }
  pop() {
    return this.slice(1);
  }
  clear() {
    if (this.size === 0) {
      return this;
    }
    if (this.__ownerID) {
      this.size = 0;
      this._head = void 0;
      this.__hash = void 0;
      this.__altered = true;
      return this;
    }
    return emptyStack();
  }
  slice(begin, end) {
    if (wholeSlice(begin, end, this.size)) {
      return this;
    }
    let resolvedBegin = resolveBegin(begin, this.size);
    const resolvedEnd = resolveEnd(end, this.size);
    if (resolvedEnd !== this.size) {
      return IndexedCollectionImpl.prototype.slice.call(this, begin, end);
    }
    const newSize = this.size - resolvedBegin;
    let head = this._head;
    while (resolvedBegin--) {
      head = head.next;
    }
    if (this.__ownerID) {
      this.size = newSize;
      this._head = head;
      this.__hash = void 0;
      this.__altered = true;
      return this;
    }
    return makeStack(newSize, head);
  }
  // @pragma Mutability
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    if (!ownerID) {
      if (this.size === 0) {
        return emptyStack();
      }
      this.__ownerID = ownerID;
      this.__altered = false;
      return this;
    }
    return makeStack(this.size, this._head, ownerID, this.__hash);
  }
  // @pragma Iteration
  __iterate(fn, reverse) {
    if (reverse) {
      return new ArraySeq(this.toArray()).__iterate((v, k) => fn(v, k, this), reverse);
    }
    let iterations = 0;
    let node = this._head;
    while (node) {
      if (fn(node.value, iterations++, this) === false) {
        break;
      }
      node = node.next;
    }
    return iterations;
  }
  __iterator(type, reverse) {
    if (reverse) {
      return new ArraySeq(this.toArray()).__iterator(type, reverse);
    }
    let iterations = 0;
    let node = this._head;
    return new Iterator(() => {
      if (node) {
        const value = node.value;
        node = node.next;
        return iteratorValue(type, iterations++, value);
      }
      return iteratorDone();
    });
  }
};
Stack.isStack = isStack;
var StackPrototype = StackImpl.prototype;
StackPrototype[IS_STACK_SYMBOL] = true;
StackPrototype.shift = StackPrototype.pop;
StackPrototype.unshift = StackPrototype.push;
StackPrototype.unshiftAll = StackPrototype.pushAll;
StackPrototype.withMutations = withMutations;
StackPrototype.wasAltered = wasAltered;
StackPrototype.asImmutable = asImmutable;
StackPrototype.asMutable = asMutable;
function makeStack(size, head, ownerID, hash2) {
  const map = Object.create(StackPrototype);
  map.size = size;
  map._head = head;
  map.__ownerID = ownerID;
  map.__hash = hash2;
  map.__altered = false;
  return map;
}
function emptyStack() {
  return makeStack(0);
}

// src/CollectionHelperMethods.ts
function reduce(collection, reducer, reduction, context, useFirst, reverse) {
  assertNotInfinite(collection.size);
  collection.__iterate((v, k, c) => {
    if (useFirst) {
      useFirst = false;
      reduction = v;
    } else {
      reduction = reducer.call(context, reduction, v, k, c);
    }
  }, reverse);
  return reduction;
}
function keyMapper(v, k) {
  return k;
}
function entryMapper(v, k) {
  return [
    k,
    v
  ];
}
function not(predicate) {
  return function(...args) {
    return !predicate.apply(this, args);
  };
}
function neg(predicate) {
  return function(...args) {
    return -predicate.apply(this, args);
  };
}
function defaultNegComparator(a, b) {
  return a < b ? 1 : a > b ? -1 : 0;
}

// src/Range.ts
var Range = (start, end, step = 1) => {
  invariant(step !== 0, "Cannot step a Range by 0");
  invariant(start !== void 0, "You must define a start value when using Range");
  invariant(end !== void 0, "You must define an end value when using Range");
  step = Math.abs(step);
  if (end < start) {
    step = -step;
  }
  const size = Math.max(0, Math.ceil((end - start) / step - 1) + 1);
  return new RangeImpl(start, end, step, size);
};
var RangeImpl = class _RangeImpl extends IndexedSeqImpl {
  _start;
  _end;
  _step;
  constructor(start, end, step, size) {
    super();
    this._start = start;
    this._end = end;
    this._step = step;
    this.size = size;
  }
  toString() {
    return this.size === 0 ? "Range []" : `Range [ ${this._start}...${this._end}${this._step !== 1 ? " by " + this._step : ""} ]`;
  }
  get(index, notSetValue) {
    return this.has(index) ? this._start + wrapIndex(this, index) * this._step : notSetValue;
  }
  includes(searchValue) {
    const possibleIndex = (searchValue - this._start) / this._step;
    return possibleIndex >= 0 && possibleIndex < this.size && possibleIndex === Math.floor(possibleIndex);
  }
  // @ts-expect-error TypeScript does not understand the mixin
  slice(begin, end) {
    if (wholeSlice(begin, end, this.size)) {
      return this;
    }
    begin = resolveBegin(begin, this.size);
    end = resolveEnd(end, this.size);
    if (end <= begin) {
      return Range(0, 0);
    }
    return Range(this.get(begin, this._end), this.get(end, this._end), this._step);
  }
  indexOf(searchValue) {
    const offsetValue = searchValue - this._start;
    if (offsetValue % this._step === 0) {
      const index = offsetValue / this._step;
      if (index >= 0 && index < this.size) {
        return index;
      }
    }
    return -1;
  }
  lastIndexOf(searchValue) {
    return this.indexOf(searchValue);
  }
  __iterate(fn, reverse = false) {
    const size = this.size;
    const step = this._step;
    let value = reverse ? this._start + (size - 1) * step : this._start;
    let i = 0;
    while (i !== size) {
      if (fn(value, reverse ? size - ++i : i++, this) === false) {
        break;
      }
      value += reverse ? -step : step;
    }
    return i;
  }
  __iterator(type, reverse = false) {
    const size = this.size;
    const step = this._step;
    let value = reverse ? this._start + (size - 1) * step : this._start;
    let i = 0;
    return new Iterator(() => {
      if (i === size) {
        return iteratorDone();
      }
      const v = value;
      value += reverse ? -step : step;
      return iteratorValue(type, reverse ? size - ++i : i++, v);
    });
  }
  equals(other) {
    return other instanceof _RangeImpl ? this._start === other._start && this._end === other._end && this._step === other._step : deepEqual(this, other);
  }
};

// src/predicates/isSet.ts
var IS_SET_SYMBOL = "@@__IMMUTABLE_SET__@@";
function isSet(maybeSet) {
  return Boolean(maybeSet && // @ts-expect-error: maybeSet is typed as `{}`,  need to change in 6.0 to `maybeSeq && typeof maybeSet === 'object' && MAYBE_SET_SYMBOL in maybeSet`
  maybeSet[IS_SET_SYMBOL]);
}

// src/Set.js
var Set = (value) => value === void 0 || value === null ? emptySet() : isSet(value) && !isOrdered(value) ? value : emptySet().withMutations((set2) => {
  const iter = SetCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v) => set2.add(v));
});
Set.of = function(...values) {
  return Set(values);
};
Set.fromKeys = (value) => Set(KeyedCollection(value).keySeq());
Set.intersect = (sets) => {
  sets = Collection(sets).toArray();
  return sets.length ? SetPrototype.intersect.apply(Set(sets.pop()), sets) : emptySet();
};
Set.union = (sets) => {
  const setArray = Collection(sets).toArray();
  return setArray.length ? SetPrototype.union.apply(Set(setArray.pop()), setArray) : emptySet();
};
var SetImpl = class extends SetCollectionImpl {
  create(value) {
    return Set(value);
  }
  toString() {
    return this.__toString("Set {", "}");
  }
  // @pragma Access
  has(value) {
    return this._map.has(value);
  }
  // @pragma Modification
  add(value) {
    return updateSet(this, this._map.set(value, value));
  }
  remove(value) {
    return updateSet(this, this._map.remove(value));
  }
  clear() {
    return updateSet(this, this._map.clear());
  }
  // @pragma Composition
  map(mapper, context) {
    let didChanges = false;
    const newMap = updateSet(this, this._map.mapEntries(([, v]) => {
      const mapped = mapper.call(context, v, v, this);
      if (mapped !== v) {
        didChanges = true;
      }
      return [
        mapped,
        mapped
      ];
    }, context));
    return didChanges ? newMap : this;
  }
  union(...iters) {
    iters = iters.filter((x) => x.size !== 0);
    if (iters.length === 0) {
      return this;
    }
    if (this.size === 0 && !this.__ownerID && iters.length === 1) {
      return Set(iters[0]);
    }
    return this.withMutations((set2) => {
      for (let ii = 0; ii < iters.length; ii++) {
        if (typeof iters[ii] === "string") {
          set2.add(iters[ii]);
        } else {
          SetCollection(iters[ii]).forEach((value) => set2.add(value));
        }
      }
    });
  }
  intersect(...iters) {
    if (iters.length === 0) {
      return this;
    }
    iters = iters.map((iter) => SetCollection(iter));
    const toRemove = [];
    this.forEach((value) => {
      if (!iters.every((iter) => iter.includes(value))) {
        toRemove.push(value);
      }
    });
    return this.withMutations((set2) => {
      toRemove.forEach((value) => {
        set2.remove(value);
      });
    });
  }
  subtract(...iters) {
    if (iters.length === 0) {
      return this;
    }
    iters = iters.map((iter) => SetCollection(iter));
    const toRemove = [];
    this.forEach((value) => {
      if (iters.some((iter) => iter.includes(value))) {
        toRemove.push(value);
      }
    });
    return this.withMutations((set2) => {
      toRemove.forEach((value) => {
        set2.remove(value);
      });
    });
  }
  sort(comparator) {
    return OrderedSet(sortFactory(this, comparator));
  }
  sortBy(mapper, comparator) {
    return OrderedSet(sortFactory(this, comparator, mapper));
  }
  wasAltered() {
    return this._map.wasAltered();
  }
  __iterate(fn, reverse) {
    return this._map.__iterate((k) => fn(k, k, this), reverse);
  }
  __iterator(type, reverse) {
    return this._map.__iterator(type, reverse);
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    const newMap = this._map.__ensureOwner(ownerID);
    if (!ownerID) {
      if (this.size === 0) {
        return this.__empty();
      }
      this.__ownerID = ownerID;
      this._map = newMap;
      return this;
    }
    return this.__make(newMap, ownerID);
  }
};
Set.isSet = isSet;
var SetPrototype = SetImpl.prototype;
SetPrototype[IS_SET_SYMBOL] = true;
SetPrototype[DELETE] = SetPrototype.remove;
SetPrototype.merge = SetPrototype.concat = SetPrototype.union;
SetPrototype.withMutations = withMutations;
SetPrototype.asImmutable = asImmutable;
SetPrototype.asMutable = asMutable;
SetPrototype.__empty = emptySet;
SetPrototype.__make = makeSet;
function updateSet(set2, newMap) {
  if (set2.__ownerID) {
    set2.size = newMap.size;
    set2._map = newMap;
    return set2;
  }
  return newMap === set2._map ? set2 : newMap.size === 0 ? set2.__empty() : set2.__make(newMap);
}
function makeSet(map, ownerID) {
  const set2 = Object.create(SetPrototype);
  set2.size = map ? map.size : 0;
  set2._map = map;
  set2.__ownerID = ownerID;
  return set2;
}
function emptySet() {
  return makeSet(emptyMap());
}

// src/functional/getIn.ts
function getIn(collection, searchKeyPath, notSetValue) {
  const keyPath = coerceKeyPath(searchKeyPath);
  let i = 0;
  while (i !== keyPath.length) {
    collection = get(collection, keyPath[i++], NOT_SET);
    if (collection === NOT_SET) {
      return notSetValue;
    }
  }
  return collection;
}

// src/methods/getIn.js
function getIn2(searchKeyPath, notSetValue) {
  return getIn(this, searchKeyPath, notSetValue);
}

// src/functional/hasIn.ts
function hasIn(collection, keyPath) {
  return getIn(collection, keyPath, NOT_SET) !== NOT_SET;
}

// src/methods/hasIn.js
function hasIn2(searchKeyPath) {
  return hasIn(this, searchKeyPath);
}

// src/methods/toObject.js
function toObject() {
  assertNotInfinite(this.size);
  const object = {};
  this.__iterate((v, k) => {
    object[k] = v;
  });
  return object;
}

// src/toJS.ts
function toJS(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (!isCollection(value)) {
    if (!isDataStructure(value)) {
      return value;
    }
    value = Seq(value);
  }
  if (isKeyed(value)) {
    const result2 = {};
    value.__iterate((v, k) => {
      result2[String(k)] = toJS(v);
    });
    return result2;
  }
  const result = [];
  value.__iterate((v) => {
    result.push(toJS(v));
  });
  return result;
}

// src/utils/mixin.ts
function mixin(ctor, methods) {
  const keyCopier = (key) => {
    ctor.prototype[key] = methods[key];
  };
  Object.keys(methods).forEach(keyCopier);
  Object.getOwnPropertySymbols && Object.getOwnPropertySymbols(methods).forEach(keyCopier);
  return ctor;
}

// src/CollectionImpl.js
Collection.Iterator = Iterator;
mixin(CollectionImpl, {
  // ### Conversion to other types
  toArray() {
    assertNotInfinite(this.size);
    const array = new Array(this.size || 0);
    const useTuples = isKeyed(this);
    let i = 0;
    this.__iterate((v, k) => {
      array[i++] = useTuples ? [
        k,
        v
      ] : v;
    });
    return array;
  },
  toIndexedSeq() {
    return new ToIndexedSequence(this);
  },
  toJS() {
    return toJS(this);
  },
  toKeyedSeq() {
    return new ToKeyedSequence(this, true);
  },
  toMap() {
    return Map(this.toKeyedSeq());
  },
  toObject,
  toOrderedMap() {
    return OrderedMap(this.toKeyedSeq());
  },
  toOrderedSet() {
    return OrderedSet(isKeyed(this) ? this.valueSeq() : this);
  },
  toSet() {
    return Set(isKeyed(this) ? this.valueSeq() : this);
  },
  toSetSeq() {
    return new ToSetSequence(this);
  },
  toSeq() {
    return isIndexed(this) ? this.toIndexedSeq() : isKeyed(this) ? this.toKeyedSeq() : this.toSetSeq();
  },
  toStack() {
    return Stack(isKeyed(this) ? this.valueSeq() : this);
  },
  toList() {
    return List(isKeyed(this) ? this.valueSeq() : this);
  },
  // ### Common JavaScript methods and properties
  toString() {
    return "[Collection]";
  },
  __toString(head, tail) {
    if (this.size === 0) {
      return head + tail;
    }
    return head + " " + this.toSeq().map(this.__toStringMapper).join(", ") + " " + tail;
  },
  // ### ES6 Collection methods (ES6 Array and Map)
  concat(...values) {
    return reify(this, concatFactory(this, values));
  },
  includes(searchValue) {
    return this.some((value) => is(value, searchValue));
  },
  filter(predicate, context) {
    return reify(this, filterFactory(this, predicate, context, true));
  },
  partition(predicate, context) {
    return partitionFactory(this, predicate, context);
  },
  find(predicate, context, notSetValue) {
    const entry = this.findEntry(predicate, context);
    return entry ? entry[1] : notSetValue;
  },
  forEach(sideEffect, context) {
    assertNotInfinite(this.size);
    return this.__iterate(context ? sideEffect.bind(context) : sideEffect);
  },
  join(separator) {
    assertNotInfinite(this.size);
    separator = separator !== void 0 ? "" + separator : ",";
    let joined = "";
    let isFirst = true;
    this.__iterate((v) => {
      isFirst ? isFirst = false : joined += separator;
      joined += v !== null && v !== void 0 ? v.toString() : "";
    });
    return joined;
  },
  keys() {
    return this.__iterator(ITERATE_KEYS);
  },
  map(mapper, context) {
    return reify(this, mapFactory(this, mapper, context));
  },
  reduce(reducer, initialReduction, context) {
    return reduce(this, reducer, initialReduction, context, arguments.length < 2, false);
  },
  reduceRight(reducer, initialReduction, context) {
    return reduce(this, reducer, initialReduction, context, arguments.length < 2, true);
  },
  reverse() {
    return reify(this, reverseFactory(this, true));
  },
  slice(begin, end) {
    return reify(this, sliceFactory(this, begin, end, true));
  },
  some(predicate, context) {
    assertNotInfinite(this.size);
    let returnValue = false;
    this.__iterate((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        returnValue = true;
        return false;
      }
    });
    return returnValue;
  },
  sort(comparator) {
    return reify(this, sortFactory(this, comparator));
  },
  values() {
    return this.__iterator(ITERATE_VALUES);
  },
  // ### More sequential methods
  butLast() {
    return this.slice(0, -1);
  },
  isEmpty() {
    return this.size !== void 0 ? this.size === 0 : !this.some(() => true);
  },
  count(predicate, context) {
    return ensureSize(predicate ? this.toSeq().filter(predicate, context) : this);
  },
  countBy(grouper, context) {
    return countByFactory(this, grouper, context);
  },
  // equals(other) {
  //   return deepEqual(this, other);
  // },
  entrySeq() {
    const collection = this;
    if (collection._cache) {
      return new ArraySeq(collection._cache);
    }
    const entriesSequence = collection.toSeq().map(entryMapper).toIndexedSeq();
    entriesSequence.fromEntrySeq = () => collection.toSeq();
    return entriesSequence;
  },
  filterNot(predicate, context) {
    return this.filter(not(predicate), context);
  },
  findEntry(predicate, context, notSetValue) {
    let found = notSetValue;
    this.__iterate((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        found = [
          k,
          v
        ];
        return false;
      }
    });
    return found;
  },
  findKey(predicate, context) {
    const entry = this.findEntry(predicate, context);
    return entry && entry[0];
  },
  findLast(predicate, context, notSetValue) {
    return this.toKeyedSeq().reverse().find(predicate, context, notSetValue);
  },
  findLastEntry(predicate, context, notSetValue) {
    return this.toKeyedSeq().reverse().findEntry(predicate, context, notSetValue);
  },
  findLastKey(predicate, context) {
    return this.toKeyedSeq().reverse().findKey(predicate, context);
  },
  first(notSetValue) {
    return this.find(returnTrue, null, notSetValue);
  },
  flatMap(mapper, context) {
    return reify(this, flatMapFactory(this, mapper, context));
  },
  flatten(depth) {
    return reify(this, flattenFactory(this, depth, true));
  },
  fromEntrySeq() {
    return new FromEntriesSequence(this);
  },
  get(searchKey, notSetValue) {
    return this.find((_, key) => is(key, searchKey), void 0, notSetValue);
  },
  getIn: getIn2,
  groupBy(grouper, context) {
    return groupByFactory(this, grouper, context);
  },
  has(searchKey) {
    return this.get(searchKey, NOT_SET) !== NOT_SET;
  },
  hasIn: hasIn2,
  isSubset(iter) {
    iter = typeof iter.includes === "function" ? iter : Collection(iter);
    return this.every((value) => iter.includes(value));
  },
  isSuperset(iter) {
    iter = typeof iter.isSubset === "function" ? iter : Collection(iter);
    return iter.isSubset(this);
  },
  keyOf(searchValue) {
    return this.findKey((value) => is(value, searchValue));
  },
  keySeq() {
    return this.toSeq().map(keyMapper).toIndexedSeq();
  },
  last(notSetValue) {
    return this.toSeq().reverse().first(notSetValue);
  },
  lastKeyOf(searchValue) {
    return this.toKeyedSeq().reverse().keyOf(searchValue);
  },
  max(comparator) {
    return maxFactory(this, comparator);
  },
  maxBy(mapper, comparator) {
    return maxFactory(this, comparator, mapper);
  },
  min(comparator) {
    return maxFactory(this, comparator ? neg(comparator) : defaultNegComparator);
  },
  minBy(mapper, comparator) {
    return maxFactory(this, comparator ? neg(comparator) : defaultNegComparator, mapper);
  },
  rest() {
    return this.slice(1);
  },
  skip(amount) {
    return amount === 0 ? this : this.slice(Math.max(0, amount));
  },
  skipLast(amount) {
    return amount === 0 ? this : this.slice(0, -Math.max(0, amount));
  },
  skipWhile(predicate, context) {
    return reify(this, skipWhileFactory(this, predicate, context, true));
  },
  skipUntil(predicate, context) {
    return this.skipWhile(not(predicate), context);
  },
  sortBy(mapper, comparator) {
    return reify(this, sortFactory(this, comparator, mapper));
  },
  take(amount) {
    return this.slice(0, Math.max(0, amount));
  },
  takeLast(amount) {
    return this.slice(-Math.max(0, amount));
  },
  takeWhile(predicate, context) {
    return reify(this, takeWhileFactory(this, predicate, context));
  },
  takeUntil(predicate, context) {
    return this.takeWhile(not(predicate), context);
  },
  update(fn) {
    return fn(this);
  },
  valueSeq() {
    return this.toIndexedSeq();
  }
});
var CollectionPrototype = CollectionImpl.prototype;
CollectionPrototype[IS_COLLECTION_SYMBOL] = true;
CollectionPrototype[Symbol.iterator] = CollectionPrototype.values;
CollectionPrototype.toJSON = CollectionPrototype.toArray;
CollectionPrototype.__toStringMapper = quoteString;
CollectionPrototype.inspect = CollectionPrototype.toSource = function() {
  return this.toString();
};
CollectionPrototype.chain = CollectionPrototype.flatMap;
CollectionPrototype.contains = CollectionPrototype.includes;
mixin(KeyedCollectionImpl, {
  // ### More sequential methods
  flip() {
    return reify(this, flipFactory(this));
  },
  mapEntries(mapper, context) {
    let iterations = 0;
    return reify(this, this.toSeq().map((v, k) => mapper.call(context, [
      k,
      v
    ], iterations++, this)).fromEntrySeq());
  },
  mapKeys(mapper, context) {
    return reify(this, this.toSeq().flip().map((k, v) => mapper.call(context, k, v, this)).flip());
  }
});
var KeyedCollectionPrototype = KeyedCollectionImpl.prototype;
KeyedCollectionPrototype[IS_KEYED_SYMBOL] = true;
KeyedCollectionPrototype[Symbol.iterator] = CollectionPrototype.entries;
KeyedCollectionPrototype.toJSON = toObject;
KeyedCollectionPrototype.__toStringMapper = (v, k) => quoteString(k) + ": " + quoteString(v);
mixin(IndexedCollectionImpl, {
  // ### Conversion to other types
  toKeyedSeq() {
    return new ToKeyedSequence(this, false);
  },
  // ### ES6 Collection methods (ES6 Array and Map)
  filter(predicate, context) {
    return reify(this, filterFactory(this, predicate, context, false));
  },
  findIndex(predicate, context) {
    const entry = this.findEntry(predicate, context);
    return entry ? entry[0] : -1;
  },
  indexOf(searchValue) {
    const key = this.keyOf(searchValue);
    return key === void 0 ? -1 : key;
  },
  lastIndexOf(searchValue) {
    const key = this.lastKeyOf(searchValue);
    return key === void 0 ? -1 : key;
  },
  reverse() {
    return reify(this, reverseFactory(this, false));
  },
  slice(begin, end) {
    return reify(this, sliceFactory(this, begin, end, false));
  },
  splice(index, removeNum, ...values) {
    const numArgs = arguments.length;
    removeNum = Math.max(removeNum || 0, 0);
    if (numArgs === 0 || numArgs === 2 && !removeNum) {
      return this;
    }
    index = resolveBegin(index, index < 0 ? this.count() : this.size);
    const spliced = this.slice(0, index);
    return reify(this, numArgs === 1 ? spliced : spliced.concat(values, this.slice(index + removeNum)));
  },
  // ### More collection methods
  findLastIndex(predicate, context) {
    const entry = this.findLastEntry(predicate, context);
    return entry ? entry[0] : -1;
  },
  first(notSetValue) {
    return this.get(0, notSetValue);
  },
  flatten(depth) {
    return reify(this, flattenFactory(this, depth, false));
  },
  get(index, notSetValue) {
    index = wrapIndex(this, index);
    return index < 0 || this.size === Infinity || this.size !== void 0 && index > this.size ? notSetValue : this.find((_, key) => key === index, void 0, notSetValue);
  },
  has(index) {
    index = wrapIndex(this, index);
    return index >= 0 && (this.size !== void 0 ? this.size === Infinity || index < this.size : this.indexOf(index) !== -1);
  },
  interpose(separator) {
    return reify(this, interposeFactory(this, separator));
  },
  interleave(...collections) {
    const thisAndCollections = [
      this
    ].concat(collections);
    const zipped = zipWithFactory(this.toSeq(), IndexedSeq.of, thisAndCollections);
    const interleaved = zipped.flatten(true);
    if (zipped.size) {
      interleaved.size = zipped.size * thisAndCollections.length;
    }
    return reify(this, interleaved);
  },
  keySeq() {
    return Range(0, this.size);
  },
  last(notSetValue) {
    return this.get(-1, notSetValue);
  },
  skipWhile(predicate, context) {
    return reify(this, skipWhileFactory(this, predicate, context, false));
  },
  zip(...collections) {
    const thisAndCollections = [
      this
    ].concat(collections);
    return reify(this, zipWithFactory(this, defaultZipper, thisAndCollections));
  },
  zipAll(...collections) {
    const thisAndCollections = [
      this
    ].concat(collections);
    return reify(this, zipWithFactory(this, defaultZipper, thisAndCollections, true));
  },
  zipWith(zipper, ...collections) {
    const thisAndCollections = [
      this
    ].concat(collections);
    return reify(this, zipWithFactory(this, zipper, thisAndCollections));
  }
});
var IndexedCollectionPrototype = IndexedCollectionImpl.prototype;
IndexedCollectionPrototype[IS_INDEXED_SYMBOL] = true;
IndexedCollectionPrototype[IS_ORDERED_SYMBOL] = true;
mixin(SetCollectionImpl, {
  // ### ES6 Collection methods (ES6 Array and Map)
  get(value, notSetValue) {
    return this.has(value) ? value : notSetValue;
  },
  includes(value) {
    return this.has(value);
  },
  // ### More sequential methods
  keySeq() {
    return this.valueSeq();
  }
});
var SetCollectionPrototype = SetCollectionImpl.prototype;
SetCollectionPrototype.has = CollectionPrototype.includes;
SetCollectionPrototype.contains = SetCollectionPrototype.includes;
SetCollectionPrototype.keys = SetCollectionPrototype.values;
mixin(KeyedSeqImpl, KeyedCollectionPrototype);
mixin(IndexedSeqImpl, IndexedCollectionPrototype);
mixin(SetSeqImpl, SetCollectionPrototype);
function defaultZipper(...values) {
  return values;
}

// src/predicates/isOrderedSet.ts
function isOrderedSet(maybeOrderedSet) {
  return isSet(maybeOrderedSet) && isOrdered(maybeOrderedSet);
}

// src/OrderedSet.js
var OrderedSet = (value) => value === void 0 || value === null ? emptyOrderedSet() : isOrderedSet(value) ? value : emptyOrderedSet().withMutations((set2) => {
  const iter = SetCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v) => set2.add(v));
});
OrderedSet.of = function(...values) {
  return OrderedSet(values);
};
OrderedSet.fromKeys = function(value) {
  return OrderedSet(KeyedCollection(value).keySeq());
};
var OrderedSetImpl = class extends SetImpl {
  create(value) {
    return OrderedSet(value);
  }
  toString() {
    return this.__toString("OrderedSet {", "}");
  }
};
OrderedSet.isOrderedSet = isOrderedSet;
var OrderedSetPrototype = OrderedSetImpl.prototype;
OrderedSetPrototype[IS_ORDERED_SYMBOL] = true;
OrderedSetPrototype.zip = IndexedCollectionPrototype.zip;
OrderedSetPrototype.zipWith = IndexedCollectionPrototype.zipWith;
OrderedSetPrototype.zipAll = IndexedCollectionPrototype.zipAll;
OrderedSetPrototype.__empty = emptyOrderedSet;
OrderedSetPrototype.__make = makeOrderedSet;
function makeOrderedSet(map, ownerID) {
  const set2 = Object.create(OrderedSetPrototype);
  set2.size = map ? map.size : 0;
  set2._map = map;
  set2.__ownerID = ownerID;
  return set2;
}
function emptyOrderedSet() {
  return makeOrderedSet(emptyOrderedMap());
}

// src/PairSorting.ts
var PairSorting = {
  LeftThenRight: -1,
  RightThenLeft: 1
};

// src/Record.js
function throwOnInvalidDefaultValues(defaultValues) {
  if (isRecord(defaultValues)) {
    throw new Error("Can not call `Record` with an immutable Record as default values. Use a plain javascript object instead.");
  }
  if (isImmutable(defaultValues)) {
    throw new Error("Can not call `Record` with an immutable Collection as default values. Use a plain javascript object instead.");
  }
  if (defaultValues === null || typeof defaultValues !== "object") {
    throw new Error("Can not call `Record` with a non-object as default values. Use a plain javascript object instead.");
  }
}
var Record = (defaultValues, name) => {
  let hasInitialized;
  throwOnInvalidDefaultValues(defaultValues);
  const RecordType = function Record2(values) {
    if (values instanceof RecordType) {
      return values;
    }
    if (!(this instanceof RecordType)) {
      return new RecordType(values);
    }
    if (!hasInitialized) {
      hasInitialized = true;
      const keys = Object.keys(defaultValues);
      const indices = RecordTypePrototype._indices = {};
      RecordTypePrototype._name = name;
      RecordTypePrototype._keys = keys;
      RecordTypePrototype._defaultValues = defaultValues;
      for (let i = 0; i < keys.length; i++) {
        const propName = keys[i];
        indices[propName] = i;
        if (RecordTypePrototype[propName]) {
          typeof console === "object" && console.warn && console.warn("Cannot define " + recordName(this) + ' with property "' + propName + '" since that property name is part of the Record API.');
        } else {
          setProp(RecordTypePrototype, propName);
        }
      }
    }
    this.__ownerID = void 0;
    this._values = List().withMutations((l) => {
      l.setSize(this._keys.length);
      KeyedCollection(values).forEach((v, k) => {
        l.set(this._indices[k], v === this._defaultValues[k] ? void 0 : v);
      });
    });
    return this;
  };
  const RecordTypePrototype = RecordType.prototype = Object.create(RecordPrototype);
  RecordTypePrototype.constructor = RecordType;
  RecordTypePrototype.create = RecordType;
  if (name) {
    RecordType.displayName = name;
  }
  return RecordType;
};
var RecordImpl = class {
  toString() {
    let str = recordName(this) + " { ";
    const keys = this._keys;
    let k;
    for (let i = 0, l = keys.length; i !== l; i++) {
      k = keys[i];
      str += (i ? ", " : "") + k + ": " + quoteString(this.get(k));
    }
    return str + " }";
  }
  equals(other) {
    return this === other || isRecord(other) && recordSeq(this).equals(recordSeq(other));
  }
  hashCode() {
    return recordSeq(this).hashCode();
  }
  // @pragma Access
  has(k) {
    return this._indices.hasOwnProperty(k);
  }
  get(k, notSetValue) {
    if (!this.has(k)) {
      return notSetValue;
    }
    const index = this._indices[k];
    const value = this._values.get(index);
    return value === void 0 ? this._defaultValues[k] : value;
  }
  // @pragma Modification
  set(k, v) {
    if (this.has(k)) {
      const newValues = this._values.set(this._indices[k], v === this._defaultValues[k] ? void 0 : v);
      if (newValues !== this._values && !this.__ownerID) {
        return makeRecord(this, newValues);
      }
    }
    return this;
  }
  remove(k) {
    return this.set(k);
  }
  clear() {
    const newValues = this._values.clear().setSize(this._keys.length);
    return this.__ownerID ? this : makeRecord(this, newValues);
  }
  wasAltered() {
    return this._values.wasAltered();
  }
  toSeq() {
    return recordSeq(this);
  }
  toJS() {
    return toJS(this);
  }
  entries() {
    return this.__iterator(ITERATE_ENTRIES);
  }
  __iterator(type, reverse) {
    return recordSeq(this).__iterator(type, reverse);
  }
  __iterate(fn, reverse) {
    return recordSeq(this).__iterate(fn, reverse);
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    const newValues = this._values.__ensureOwner(ownerID);
    if (!ownerID) {
      this.__ownerID = ownerID;
      this._values = newValues;
      return this;
    }
    return makeRecord(this, newValues, ownerID);
  }
};
Record.isRecord = isRecord;
Record.getDescriptiveName = recordName;
var RecordPrototype = RecordImpl.prototype;
RecordPrototype[IS_RECORD_SYMBOL] = true;
RecordPrototype[DELETE] = RecordPrototype.remove;
RecordPrototype.deleteIn = RecordPrototype.removeIn = deleteIn;
RecordPrototype.getIn = getIn2;
RecordPrototype.hasIn = CollectionPrototype.hasIn;
RecordPrototype.merge = merge;
RecordPrototype.mergeWith = mergeWith;
RecordPrototype.mergeIn = mergeIn;
RecordPrototype.mergeDeep = mergeDeep2;
RecordPrototype.mergeDeepWith = mergeDeepWith2;
RecordPrototype.mergeDeepIn = mergeDeepIn;
RecordPrototype.setIn = setIn2;
RecordPrototype.update = update2;
RecordPrototype.updateIn = updateIn2;
RecordPrototype.withMutations = withMutations;
RecordPrototype.asMutable = asMutable;
RecordPrototype.asImmutable = asImmutable;
RecordPrototype[Symbol.iterator] = RecordPrototype.entries;
RecordPrototype.toJSON = RecordPrototype.toObject = CollectionPrototype.toObject;
RecordPrototype.inspect = RecordPrototype.toSource = function() {
  return this.toString();
};
function makeRecord(likeRecord, values, ownerID) {
  const record = Object.create(Object.getPrototypeOf(likeRecord));
  record._values = values;
  record.__ownerID = ownerID;
  return record;
}
function recordName(record) {
  return record.constructor.displayName || record.constructor.name || "Record";
}
function recordSeq(record) {
  return keyedSeqFromValue(record._keys.map((k) => [
    k,
    record.get(k)
  ]));
}
function setProp(prototype, name) {
  try {
    Object.defineProperty(prototype, name, {
      get: function() {
        return this.get(name);
      },
      set: function(value) {
        invariant(this.__ownerID, "Cannot set on an immutable record.");
        this.set(name, value);
      }
    });
  } catch (error) {
  }
}

// src/Repeat.js
var Repeat = (value, times) => {
  const size = times === void 0 ? Infinity : Math.max(0, times);
  return new RepeatImpl(value, size);
};
var RepeatImpl = class _RepeatImpl extends IndexedSeqImpl {
  constructor(value, size) {
    super();
    this._value = value;
    this.size = size;
  }
  toString() {
    if (this.size === 0) {
      return "Repeat []";
    }
    return "Repeat [ " + this._value + " " + this.size + " times ]";
  }
  get(index, notSetValue) {
    return this.has(index) ? this._value : notSetValue;
  }
  includes(searchValue) {
    return is(this._value, searchValue);
  }
  slice(begin, end) {
    const size = this.size;
    return wholeSlice(begin, end, size) ? this : new _RepeatImpl(this._value, resolveEnd(end, size) - resolveBegin(begin, size));
  }
  reverse() {
    return this;
  }
  indexOf(searchValue) {
    if (is(this._value, searchValue)) {
      return 0;
    }
    return -1;
  }
  lastIndexOf(searchValue) {
    if (is(this._value, searchValue)) {
      return this.size;
    }
    return -1;
  }
  __iterate(fn, reverse) {
    const size = this.size;
    let i = 0;
    while (i !== size) {
      if (fn(this._value, reverse ? size - ++i : i++, this) === false) {
        break;
      }
    }
    return i;
  }
  __iterator(type, reverse) {
    const size = this.size;
    let i = 0;
    return new Iterator(() => i === size ? iteratorDone() : iteratorValue(type, reverse ? size - ++i : i++, this._value));
  }
  equals(other) {
    return other instanceof Repeat ? is(this._value, other._value) : deepEqual(this, other);
  }
};

// src/fromJS.js
function fromJS(value, converter) {
  return fromJSWith([], converter || defaultConverter, value, "", converter && converter.length > 2 ? [] : void 0, {
    "": value
  });
}
function fromJSWith(stack, converter, value, key, keyPath, parentValue) {
  if (typeof value !== "string" && !isImmutable(value) && (isArrayLike(value) || hasIterator(value) || isPlainObject(value))) {
    if (~stack.indexOf(value)) {
      throw new TypeError("Cannot convert circular structure to Immutable");
    }
    stack.push(value);
    keyPath && key !== "" && keyPath.push(key);
    const converted = converter.call(parentValue, key, Seq(value).map((v, k) => fromJSWith(stack, converter, v, k, keyPath, value)), keyPath && keyPath.slice());
    stack.pop();
    keyPath && keyPath.pop();
    return converted;
  }
  return value;
}
function defaultConverter(k, v) {
  return isIndexed(v) ? v.toList() : isKeyed(v) ? v.toMap() : v.toSet();
}

// package.json
var version = "5.1.4";

// src/Immutable.js
var Iterable = Collection;
export {
  Collection,
  Iterable,
  List,
  Map,
  OrderedMap,
  OrderedSet,
  PairSorting,
  Range,
  Record,
  Repeat,
  Seq,
  Set,
  Stack,
  fromJS,
  get,
  getIn,
  has,
  hasIn,
  hash,
  is,
  isAssociative,
  isCollection,
  isImmutable,
  isIndexed,
  isKeyed,
  isList,
  isMap,
  isOrdered,
  isOrderedMap,
  isOrderedSet,
  isPlainObject,
  isRecord,
  isSeq,
  isSet,
  isStack,
  isValueObject,
  merge2 as merge,
  mergeDeep,
  mergeDeepWith,
  mergeWith2 as mergeWith,
  remove,
  removeIn,
  set,
  setIn,
  update,
  updateIn,
  version
};
