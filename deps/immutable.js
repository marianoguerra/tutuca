// @license MIT Copyright (c) 2014-present, Lee Byron and other contributors.
function invariant(condition, error) {
  if (!condition) throw new Error(error);
}
function assertNotInfinite(size) {
  invariant(size !== Infinity, "Cannot perform this action with an infinite size.");
}
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
const keyMapper = (v, k) => k;
const entryMapper = (v, k) => [ k, v ];
const not = predicate => function(...args) {
  return !predicate.apply(this, args);
};
const neg = predicate => function(...args) {
  return -predicate.apply(this, args);
};
function defaultComparator(a, b) {
  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined) {
    return 1;
  }
  if (b === undefined) {
    return -1;
  }
  return a > b ? 1 : a < b ? -1 : 0;
}
const defaultNegComparator = (a, b) => a < b ? 1 : a > b ? -1 : 0;
const DONE = {
  done: true,
  value: undefined
};
class Iter {
  constructor(next) {
    this.next = next;
  }
  [Symbol.iterator]() {
    return this;
  }
}
function makeIterator(next) {
  return new Iter(next);
}
function makeEntryIterator(next) {
  const entry = [ undefined, undefined ];
  const result = {
    done: false,
    value: undefined
  };
  return makeIterator(() => {
    if (next(entry)) {
      result.value = [ entry[0], entry[1] ];
      return result;
    }
    return DONE;
  });
}
const EMPTY_ITERATOR = makeIterator(() => DONE);
const emptyIterator = () => EMPTY_ITERATOR;
function makeIndexKeys(size) {
  let i = 0;
  const result = {
    done: false,
    value: undefined
  };
  return makeIterator(() => {
    if (i === size) return DONE;
    result.value = i++;
    return result;
  });
}
function mapEntries(source, transform) {
  return makeEntryIterator(entry => {
    const step = source.next();
    if (step.done) return false;
    transform(step.value[0], step.value[1], entry);
    return true;
  });
}
function hasIterator(maybeIterable) {
  if (Array.isArray(maybeIterable)) {
    return true;
  }
  return !!getIteratorFn(maybeIterable);
}
const isIterator = maybeIterator => typeof maybeIterator?.next === "function";
function getIterator(iterable) {
  const iteratorFn = getIteratorFn(iterable);
  return iteratorFn?.call(iterable);
}
function getIteratorFn(iterable) {
  const iteratorFn = iterable?.[Symbol.iterator];
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
const DELETE = "delete";
const SHIFT = 5;
const SIZE = 1 << SHIFT;
const MASK = SIZE - 1;
const NOT_SET = {};
const MakeRef = () => ({
  value: false
});
function SetRef(ref) {
  if (ref) {
    ref.value = true;
  }
}
class OwnerID {}
function ensureSize(iter) {
  if (iter.size === undefined) {
    iter.size = iter.__iterate(returnTrue);
  }
  return iter.size;
}
function wrapIndex(iter, index) {
  if (typeof index !== "number") {
    const uint32Index = index >>> 0;
    if (String(uint32Index) !== index || uint32Index === 4294967295) {
      return NaN;
    }
    index = uint32Index;
  }
  return index < 0 ? ensureSize(iter) + index : index;
}
const returnTrue = () => true;
const isNeg = value => value < 0 || Object.is(value, -0);
const wholeSlice = (begin, end, size) => (begin === 0 && !isNeg(begin) || size !== undefined && (begin ?? 0) <= -size) && (end === undefined || size !== undefined && end >= size);
const resolveIndex = (index, size, defaultIndex) => index === undefined ? defaultIndex : isNeg(index) ? size === Infinity ? size : Math.max(0, size + index) | 0 : size === undefined || size === index ? index : Math.min(size, index) | 0;
const resolveBegin = (begin, size) => resolveIndex(begin, size, 0);
const resolveEnd = (end, size) => resolveIndex(end, size, size);
const IS_COLLECTION_SYMBOL = "@@__IMMUTABLE_ITERABLE__@@";
const IS_KEYED_SYMBOL = "@@__IMMUTABLE_KEYED__@@";
const IS_INDEXED_SYMBOL = "@@__IMMUTABLE_INDEXED__@@";
const IS_ORDERED_SYMBOL = "@@__IMMUTABLE_ORDERED__@@";
const IS_SEQ_SYMBOL = "@@__IMMUTABLE_SEQ__@@";
const IS_LIST_SYMBOL = "@@__IMMUTABLE_LIST__@@";
const IS_MAP_SYMBOL = "@@__IMMUTABLE_MAP__@@";
const IS_SET_SYMBOL = "@@__IMMUTABLE_SET__@@";
const IS_STACK_SYMBOL = "@@__IMMUTABLE_STACK__@@";
const IS_RECORD_SYMBOL = "@@__IMMUTABLE_RECORD__@@";
function hasSymbol(v, symbol) {
  return typeof v === "object" && v !== null && symbol in v;
}
const isCollection = v => hasSymbol(v, IS_COLLECTION_SYMBOL);
const isKeyed = v => hasSymbol(v, IS_KEYED_SYMBOL);
const isIndexed = v => hasSymbol(v, IS_INDEXED_SYMBOL);
const isAssociative = v => isKeyed(v) || isIndexed(v);
const isOrdered = v => hasSymbol(v, IS_ORDERED_SYMBOL);
const isSeq = v => hasSymbol(v, IS_SEQ_SYMBOL);
const isList = v => hasSymbol(v, IS_LIST_SYMBOL);
const isMap = v => hasSymbol(v, IS_MAP_SYMBOL);
const isSet = v => hasSymbol(v, IS_SET_SYMBOL);
const isStack = v => hasSymbol(v, IS_STACK_SYMBOL);
const isRecord = v => hasSymbol(v, IS_RECORD_SYMBOL);
const isImmutable = v => isCollection(v) || isRecord(v);
const isOrderedMap = v => isMap(v) && isOrdered(v);
const isOrderedSet = v => isSet(v) && isOrdered(v);
const isValueObject = v => typeof v === "object" && v !== null && typeof v.equals === "function" && typeof v.hashCode === "function";
function flipFactory(collection) {
  const flipSequence = makeSequence(collection);
  flipSequence._iter = collection;
  flipSequence.size = collection.size;
  flipSequence.flip = () => collection;
  flipSequence.reverse = function() {
    const reversedSequence = collection.reverse.call(this);
    reversedSequence.flip = () => collection.reverse();
    return reversedSequence;
  };
  flipSequence.has = key => collection.includes(key);
  flipSequence.includes = key => collection.has(key);
  flipSequence.cacheResult = cacheResultThrough;
  flipSequence.__iterate = function(fn, reverse) {
    return collection.__iterate((v, k) => fn(k, v, this), reverse);
  };
  flipSequence.__iteratorUncached = reverse => mapEntries(collection.__iterator(reverse), (k, v, entry) => {
    entry[0] = v;
    entry[1] = k;
  });
  return flipSequence;
}
function mapFactory(collection, mapper, context) {
  const mappedSequence = makeSequence(collection);
  mappedSequence.size = collection.size;
  mappedSequence.has = key => collection.has(key);
  mappedSequence.get = (key, notSetValue) => {
    const v = collection.get(key, NOT_SET);
    return v === NOT_SET ? notSetValue : mapper.call(context, v, key, collection);
  };
  mappedSequence.__iterate = function(fn, reverse) {
    return collection.__iterate((v, k) => fn(mapper.call(context, v, k, collection), k, this), reverse);
  };
  mappedSequence.__iteratorUncached = reverse => mapEntries(collection.__iterator(reverse), (k, v, entry) => {
    entry[0] = k;
    entry[1] = mapper.call(context, v, k, collection);
  });
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
  reversedSequence.has = key => collection.has(useKeys ? key : -1 - key);
  reversedSequence.includes = value => collection.includes(value);
  reversedSequence.cacheResult = cacheResultThrough;
  reversedSequence.__iterate = function(fn, reverse) {
    let i = 0;
    if (reverse) {
      ensureSize(collection);
    }
    return collection.__iterate((v, k) => fn(v, useKeys ? k : reverse ? this.size - ++i : i++, this), !reverse);
  };
  reversedSequence.__iteratorUncached = function(reverse) {
    let i = 0;
    if (reverse) {
      ensureSize(collection);
    }
    const size = this.size;
    return mapEntries(collection.__iterator(!reverse), (k, v, entry) => {
      entry[0] = useKeys ? k : reverse ? size - ++i : i++;
      entry[1] = v;
    });
  };
  return reversedSequence;
}
function sliceFactory(collection, begin, end, useKeys) {
  const originalSize = collection.size;
  if (wholeSlice(begin, end, originalSize)) {
    return collection;
  }
  if (originalSize === undefined && (begin < 0 || end < 0)) {
    return sliceFactory(collection.toSeq().cacheResult(), begin, end, useKeys);
  }
  const resolvedBegin = resolveBegin(begin, originalSize);
  const resolvedEnd = resolveEnd(end, originalSize);
  const resolvedSize = resolvedEnd - resolvedBegin;
  let sliceSize;
  if (!Number.isNaN(resolvedSize)) {
    sliceSize = Math.max(0, resolvedSize);
  }
  const sliceSeq = makeSequence(collection);
  sliceSeq.size = sliceSize === 0 ? sliceSize : collection.size && sliceSize || undefined;
  if (!useKeys && isSeq(collection) && sliceSize >= 0) {
    sliceSeq.get = function(index, notSetValue) {
      index = wrapIndex(this, index);
      return index >= 0 && index < sliceSize ? collection.get(index + resolvedBegin, notSetValue) : notSetValue;
    };
  }
  sliceSeq.__iterateUncached = function(fn, reverse) {
    if (sliceSize !== 0 && reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    if (sliceSize === 0) {
      return 0;
    }
    let skipped = 0;
    let iterations = 0;
    collection.__iterate((v, k) => {
      if (skipped < resolvedBegin) {
        skipped++;
        return;
      }
      if (sliceSize !== undefined && iterations >= sliceSize) {
        return false;
      }
      iterations++;
      if (fn(v, useKeys ? k : iterations - 1, this) === false) {
        return false;
      }
    }, reverse);
    return iterations;
  };
  sliceSeq.__iteratorUncached = function(reverse) {
    if (sliceSize !== 0 && reverse) {
      return this.cacheResult().__iterator(reverse);
    }
    if (sliceSize === 0) {
      return emptyIterator();
    }
    const iterator = collection.__iterator(reverse);
    let skipped = 0;
    let iterations = 0;
    if (useKeys) {
      return makeIterator(() => {
        while (skipped < resolvedBegin) {
          skipped++;
          iterator.next();
        }
        if (sliceSize !== undefined && iterations >= sliceSize) {
          return DONE;
        }
        const step = iterator.next();
        if (step.done) {
          return step;
        }
        iterations++;
        return step;
      });
    }
    return makeEntryIterator(entry => {
      while (skipped < resolvedBegin) {
        skipped++;
        iterator.next();
      }
      if (sliceSize !== undefined && iterations >= sliceSize) {
        return false;
      }
      const step = iterator.next();
      if (step.done) {
        return false;
      }
      iterations++;
      entry[0] = iterations - 1;
      entry[1] = step.value[1];
      return true;
    });
  };
  return sliceSeq;
}
function sortFactory(collection, comparator, mapper) {
  if (!comparator) {
    comparator = defaultComparator;
  }
  const isKeyedCollection = isKeyed(collection);
  let index = 0;
  const entries = collection.toSeq().map((v, k) => [ k, v, index++, mapper ? mapper(v, k, collection) : v ]).valueSeq().toArray();
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
    const entry = collection.toSeq().map((v, k) => [ v, mapper(v, k, collection) ]).reduce((a, b) => maxCompare(comparator, a[1], b[1]) ? b : a);
    return entry?.[0];
  }
  return collection.reduce((a, b) => maxCompare(comparator, a, b) ? b : a);
}
function maxCompare(comparator, a, b) {
  const comp = comparator(b, a);
  return comp === 0 && b !== a && (b === undefined || b === null || Number.isNaN(b)) || comp > 0;
}
function zipWithFactory(keyIter, zipper, iters, zipAll) {
  const zipSequence = makeSequence(keyIter);
  const sizes = new ArraySeq(iters).map(i => i.size);
  zipSequence.size = zipAll ? sizes.max() : sizes.min();
  zipSequence.__iterate = function(fn, reverse) {
    const iterator = this.__iterator(reverse);
    let iterations = 0;
    let step;
    while (!(step = iterator.next()).done) {
      if (fn(step.value[1], iterations++, this) === false) {
        break;
      }
    }
    return iterations;
  };
  zipSequence.__iteratorUncached = function(reverse) {
    const iterators = iters.map(i => {
      const col = Collection(i);
      return getIterator(reverse ? col.reverse() : col);
    });
    let iterations = 0;
    const steps = new Array(iterators.length);
    const values = new Array(iterators.length);
    return makeEntryIterator(entry => {
      let done = zipAll;
      for (let i = 0; i < iterators.length; i++) {
        steps[i] = iterators[i].next();
        done = zipAll ? done && steps[i].done : done || steps[i].done;
      }
      if (done) {
        return false;
      }
      for (let i = 0; i < steps.length; i++) {
        values[i] = steps[i].value;
      }
      entry[0] = iterations++;
      entry[1] = zipper(...values);
      return true;
    });
  };
  return zipSequence;
}
function isArrayLike(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return true;
  }
  return value && typeof value === "object" && Number.isInteger(value.length) && value.length >= 0 && (value.length === 0 ? Object.keys(value).length === 1 : Object.hasOwn(value, value.length - 1));
}
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
const isDataStructure = value => typeof value === "object" && (isImmutable(value) || Array.isArray(value) || isPlainObject(value));
function coerceKeyPath(keyPath) {
  if (isArrayLike(keyPath) && typeof keyPath !== "string") {
    return keyPath;
  }
  if (isOrdered(keyPath)) {
    return keyPath.toArray();
  }
  throw new TypeError(`Invalid keyPath: expected Ordered Collection or Array: ${keyPath}`);
}
const has = (collection, key) => isImmutable(collection) ? collection.has(key) : isDataStructure(collection) && Object.hasOwn(collection, key);
function get(collection, key, notSetValue) {
  return isImmutable(collection) ? collection.get(key, notSetValue) : !has(collection, key) ? notSetValue : typeof collection.get === "function" ? collection.get(key) : collection[key];
}
function getIn$1(collection, searchKeyPath, notSetValue) {
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
const hasIn$1 = (collection, keyPath) => getIn$1(collection, keyPath, NOT_SET) !== NOT_SET;
function is(valueA, valueB) {
  if (valueA === valueB || Number.isNaN(valueA) && Number.isNaN(valueB)) {
    return true;
  }
  if (!valueA || !valueB) {
    return false;
  }
  if (typeof valueA.valueOf === "function" && typeof valueB.valueOf === "function") {
    valueA = valueA.valueOf();
    valueB = valueB.valueOf();
    if (valueA === valueB || Number.isNaN(valueA) && Number.isNaN(valueB)) {
      return true;
    }
    if (!valueA || !valueB) {
      return false;
    }
  }
  return !!(isValueObject(valueA) && isValueObject(valueB) && valueA.equals(valueB));
}
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
    const result = {};
    value.__iterate((v, k) => {
      result[String(k)] = toJS(v);
    });
    return result;
  }
  const result = [];
  value.__iterate(v => {
    result.push(toJS(v));
  });
  return result;
}
function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!isCollection(b) || a.size !== undefined && b.size !== undefined && a.size !== b.size || a.__hash !== undefined && b.__hash !== undefined && a.__hash !== b.__hash || isKeyed(a) !== isKeyed(b) || isIndexed(a) !== isIndexed(b) || isOrdered(a) !== isOrdered(b)) {
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
  if (a.size === undefined) {
    if (b.size === undefined) {
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
    return true;
  });
  return allEqual && a.size === bSize;
}
const smi = i32 => i32 >>> 1 & 1073741824 | i32 & 3221225471;
function hash(o) {
  if (o === null || o === undefined) {
    return hashNullish(o);
  }
  if (typeof o.hashCode === "function") {
    return smi(o.hashCode(o));
  }
  const v = valueOf(o);
  if (v === null || v === undefined) {
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
    throw new Error(`Value type ${typeof v} cannot be hashed.`);
  }
}
const hashNullish = nullish => nullish === null ? 1108378658 : 1108378659;
function hashNumber(n) {
  if (Number.isNaN(n) || n === Infinity) {
    return 0;
  }
  let hash = n | 0;
  if (hash !== n) {
    hash ^= n * 4294967295;
  }
  while (n > 4294967295) {
    n /= 4294967295;
    hash ^= n;
  }
  return smi(hash);
}
function cachedHashString(string) {
  let hashed = stringHashCache[string];
  if (hashed === undefined) {
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
  if (hashed !== undefined) {
    return hashed;
  }
  hashed = nextHash();
  symbolMap[sym] = hashed;
  return hashed;
}
function hashJSObj(obj) {
  let hashed = weakMap.get(obj);
  if (hashed !== undefined) {
    return hashed;
  }
  hashed = nextHash();
  weakMap.set(obj, hashed);
  return hashed;
}
const valueOf = obj => obj.valueOf !== Object.prototype.valueOf ? obj.valueOf() : obj;
function nextHash() {
  const nextHash = ++_objHashUID;
  if (_objHashUID & 1073741824) {
    _objHashUID = 0;
  }
  return nextHash;
}
const weakMap = new WeakMap;
const symbolMap = Object.create(null);
let _objHashUID = 0;
const STRING_HASH_CACHE_MIN_STRLEN = 16;
const STRING_HASH_CACHE_MAX_SIZE = 255;
let STRING_HASH_CACHE_SIZE = 0;
let stringHashCache = {};
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
  } : ordered ? v => {
    h = 31 * h + hash(v) | 0;
  } : v => {
    h = h + hash(v) | 0;
  });
  return murmurHashOfSize(collection.size, h);
}
const hashMerge = (a, b) => a ^ b + 2654435769 + (a << 6) + (a >> 2) | 0;
function murmurHashOfSize(size, h) {
  h = Math.imul(h, 3432918353);
  h = Math.imul(h << 15 | h >>> -15, 461845907);
  h = Math.imul(h << 13 | h >>> -13, 5);
  h = (h + 3864292196 | 0) ^ size;
  h = Math.imul(h ^ h >>> 16, 2246822507);
  h = Math.imul(h ^ h >>> 13, 3266489909);
  h = smi(h ^ h >>> 16);
  return h;
}
function quoteString(value) {
  try {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  } catch {
    return JSON.stringify(value);
  }
}
const reify = (iter, seq) => iter === seq ? iter : isSeq(iter) ? seq : iter.create ? iter.create(seq) : iter.constructor(seq);
const reifyValues = (collection, arr) => reify(collection, (isKeyed(collection) ? KeyedCollection : isIndexed(collection) ? IndexedCollection : SetCollection)(arr));
const defaultZipper = (...values) => values;
const Collection = value => isCollection(value) ? value : Seq(value);
class CollectionImpl {
  size=0;
  static {
    this.prototype[IS_COLLECTION_SYMBOL] = true;
    this.prototype.__toStringMapper = quoteString;
    this.prototype[Symbol.iterator] = this.prototype.values;
    this.prototype.toJSON = this.prototype.toArray;
    this.prototype.contains = this.prototype.includes;
  }
  equals(other) {
    return deepEqual(this, other);
  }
  hashCode() {
    return this.__hash ?? (this.__hash = hashCollection(this));
  }
  toArray() {
    assertNotInfinite(this.size);
    const array = new Array(this.size || 0);
    const useTuples = isKeyed(this);
    let i = 0;
    this.__iterate((v, k) => {
      array[i++] = useTuples ? [ k, v ] : v;
    });
    return array;
  }
  toIndexedSeq() {
    return new ToIndexedSequence(this);
  }
  toJS() {
    return toJS(this);
  }
  toKeyedSeq() {
    return new ToKeyedSequence(this, true);
  }
  toMap() {
    throw new Error("toMap: not patched — import CollectionConversions");
  }
  toObject() {
    assertNotInfinite(this.size);
    const object = {};
    this.__iterate((v, k) => {
      object[k] = v;
    });
    return object;
  }
  toOrderedMap() {
    throw new Error("toOrderedMap: not patched — import CollectionConversions");
  }
  toOrderedSet() {
    throw new Error("toOrderedSet: not patched — import CollectionConversions");
  }
  toSet() {
    throw new Error("toSet: not patched — import CollectionConversions");
  }
  toSetSeq() {
    return new ToSetSequence(this);
  }
  toSeq() {
    return isIndexed(this) ? this.toIndexedSeq() : isKeyed(this) ? this.toKeyedSeq() : this.toSetSeq();
  }
  toStack() {
    throw new Error("toStack: not patched — import CollectionConversions");
  }
  toList() {
    throw new Error("toList: not patched — import CollectionConversions");
  }
  toString() {
    return "[Collection]";
  }
  __toString(head, tail) {
    if (this.size === 0) {
      return `${head}${tail}`;
    }
    return `${head} ${this.toSeq().map(this.__toStringMapper).join(", ")} ${tail}`;
  }
  concat(...values) {
    const isKeyedCollection = isKeyed(this);
    const iters = [ this, ...values ].map(v => {
      if (!isCollection(v)) {
        v = isKeyedCollection ? keyedSeqFromValue(v) : indexedSeqFromValue(Array.isArray(v) ? v : [ v ]);
      } else if (isKeyedCollection) {
        v = KeyedCollection(v);
      }
      return v;
    }).filter(v => v.size !== 0);
    if (iters.length === 0) {
      return this;
    }
    if (iters.length === 1) {
      const singleton = iters[0];
      if (singleton === this || isKeyedCollection && isKeyed(singleton) || isIndexed(this) && isIndexed(singleton)) {
        return singleton;
      }
    }
    return reify(this, new ConcatSeq(iters));
  }
  includes(searchValue) {
    return this.some(value => is(value, searchValue));
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
    return this.__iterator();
  }
  filter(predicate, context) {
    const collection = this;
    const useKeys = isKeyed(this);
    const filterSequence = makeSequence(collection);
    if (useKeys) {
      filterSequence.has = key => {
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
      collection.__iterate((v, k) => {
        if (predicate.call(context, v, k, collection)) {
          iterations++;
          return fn(v, useKeys ? k : iterations - 1, this);
        }
      }, reverse);
      return iterations;
    };
    filterSequence.__iteratorUncached = function(reverse) {
      const iterator = collection.__iterator(reverse);
      let iterations = 0;
      return makeEntryIterator(entry => {
        while (true) {
          const step = iterator.next();
          if (step.done) {
            return false;
          }
          const k = step.value[0];
          const v = step.value[1];
          if (predicate.call(context, v, k, collection)) {
            entry[0] = useKeys ? k : iterations++;
            entry[1] = v;
            return true;
          }
        }
      });
    };
    return reify(this, filterSequence);
  }
  partition(predicate, context) {
    const isKeyedIter = isKeyed(this);
    const groups = [ [], [] ];
    this.__iterate((v, k) => {
      groups[predicate.call(context, v, k, this) ? 1 : 0].push(isKeyedIter ? [ k, v ] : v);
    });
    return groups.map(arr => reifyValues(this, arr));
  }
  find(predicate, context, notSetValue) {
    const entry = this.findEntry(predicate, context);
    return entry ? entry[1] : notSetValue;
  }
  forEach(sideEffect, context) {
    assertNotInfinite(this.size);
    return this.__iterate(context ? sideEffect.bind(context) : sideEffect);
  }
  join(separator) {
    assertNotInfinite(this.size);
    separator = separator !== undefined ? String(separator) : ",";
    let joined = "";
    let isFirst = true;
    this.__iterate(v => {
      if (isFirst) {
        isFirst = false;
      } else {
        joined += separator;
      }
      joined += v !== null && v !== undefined ? String(v) : "";
    });
    return joined;
  }
  keys() {
    const iterator = this.__iterator();
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      const step = iterator.next();
      if (step.done) {
        return DONE;
      }
      result.value = step.value[0];
      return result;
    });
  }
  map(mapper, context) {
    return reify(this, mapFactory(this, mapper, context));
  }
  reduce(reducer, initialReduction = NOT_SET, context) {
    return reduce(this, reducer, initialReduction, context, initialReduction === NOT_SET, false);
  }
  reduceRight(reducer, initialReduction = NOT_SET, context) {
    return reduce(this, reducer, initialReduction, context, initialReduction === NOT_SET, true);
  }
  reverse() {
    return reify(this, reverseFactory(this, isKeyed(this)));
  }
  slice(begin, end) {
    return reify(this, sliceFactory(this, begin, end, isKeyed(this)));
  }
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
  }
  sort(comparator) {
    return reify(this, sortFactory(this, comparator));
  }
  values() {
    const iterator = this.__iterator();
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      const step = iterator.next();
      if (step.done) {
        return DONE;
      }
      result.value = step.value[1];
      return result;
    });
  }
  butLast() {
    return this.slice(0, -1);
  }
  isEmpty() {
    return this.size !== undefined ? this.size === 0 : !this.some(() => true);
  }
  count(predicate, context) {
    return ensureSize(predicate ? this.toSeq().filter(predicate, context) : this);
  }
  countBy(_grouper, _context) {
    throw new Error("countBy: not patched — import CollectionConversions");
  }
  entrySeq() {
    const collection = this;
    if (collection._cache) {
      return new ArraySeq(collection._cache);
    }
    const entriesSequence = collection.toSeq().map(entryMapper).toIndexedSeq();
    entriesSequence.fromEntrySeq = () => collection.toSeq();
    return entriesSequence;
  }
  filterNot(predicate, context) {
    return this.filter(not(predicate), context);
  }
  findEntry(predicate, context, notSetValue) {
    let found = notSetValue;
    this.__iterate((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        found = [ k, v ];
        return false;
      }
    });
    return found;
  }
  findKey(predicate, context) {
    const entry = this.findEntry(predicate, context);
    return entry?.[0];
  }
  findLast(predicate, context, notSetValue) {
    return this.toKeyedSeq().reverse().find(predicate, context, notSetValue);
  }
  findLastEntry(predicate, context, notSetValue) {
    return this.toKeyedSeq().reverse().findEntry(predicate, context, notSetValue);
  }
  findLastKey(predicate, context) {
    return this.toKeyedSeq().reverse().findKey(predicate, context);
  }
  first(notSetValue) {
    return this.find(returnTrue, null, notSetValue);
  }
  flatMap(mapper, context) {
    return reify(this, this.toSeq().map((v, k) => (isKeyed(this) ? KeyedCollection : isIndexed(this) ? IndexedCollection : SetCollection)(mapper.call(context, v, k, this))).flatten(true));
  }
  flatten(depth) {
    const collection = this;
    const useKeys = isKeyed(this);
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
          if (stopped) {
            return false;
          }
        }, reverse);
      }
      flatDeep(collection, 0);
      return iterations;
    };
    flatSequence.__iteratorUncached = function(reverse) {
      if (reverse) {
        return this.cacheResult().__iterator(reverse);
      }
      let iterations = 0;
      const stack = [ {
        iterator: collection.__iterator(reverse),
        depth: 0
      } ];
      return makeEntryIterator(entry => {
        while (stack.length > 0) {
          const frame = stack[stack.length - 1];
          const step = frame.iterator.next();
          if (step.done) {
            stack.pop();
            continue;
          }
          const v = step.value[1];
          if ((!depth || frame.depth < depth) && isCollection(v)) {
            stack.push({
              iterator: v.__iterator(reverse),
              depth: frame.depth + 1
            });
            continue;
          }
          entry[0] = useKeys ? step.value[0] : iterations++;
          entry[1] = v;
          return true;
        }
        return false;
      });
    };
    return reify(this, flatSequence);
  }
  fromEntrySeq() {
    return new FromEntriesSequence(this);
  }
  get(searchKey, notSetValue) {
    return this.find((_, key) => is(key, searchKey), undefined, notSetValue);
  }
  getIn(searchKeyPath, notSetValue) {
    return getIn$1(this, searchKeyPath, notSetValue);
  }
  groupBy(_grouper, _context) {
    throw new Error("groupBy: not patched — import CollectionConversions");
  }
  has(searchKey) {
    return this.get(searchKey, NOT_SET) !== NOT_SET;
  }
  hasIn(searchKeyPath) {
    return hasIn$1(this, searchKeyPath);
  }
  isSubset(iter) {
    const other = typeof iter.includes === "function" ? iter : Collection(iter);
    return this.every(value => other.includes(value));
  }
  isSuperset(iter) {
    const other = typeof iter.isSubset === "function" ? iter : Collection(iter);
    return other.isSubset(this);
  }
  keyOf(searchValue) {
    return this.findKey(value => is(value, searchValue));
  }
  keySeq() {
    return this.toSeq().map(keyMapper).toIndexedSeq();
  }
  last(notSetValue) {
    return this.toSeq().reverse().first(notSetValue);
  }
  lastKeyOf(searchValue) {
    return this.toKeyedSeq().reverse().keyOf(searchValue);
  }
  max(comparator) {
    return maxFactory(this, comparator);
  }
  maxBy(mapper, comparator) {
    return maxFactory(this, comparator, mapper);
  }
  min(comparator) {
    return maxFactory(this, comparator ? neg(comparator) : defaultNegComparator);
  }
  minBy(mapper, comparator) {
    return maxFactory(this, comparator ? neg(comparator) : defaultNegComparator, mapper);
  }
  rest() {
    return this.slice(1);
  }
  skip(amount) {
    return amount === 0 ? this : this.slice(Math.max(0, amount));
  }
  skipLast(amount) {
    return amount === 0 ? this : this.slice(0, -Math.max(0, amount));
  }
  skipWhile(predicate, context) {
    const collection = this;
    const useKeys = isKeyed(this);
    const skipSequence = makeSequence(collection);
    skipSequence.__iterateUncached = function(fn, reverse) {
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      let skipping = true;
      let iterations = 0;
      collection.__iterate((v, k) => {
        if (skipping && predicate.call(context, v, k, this)) {
          return;
        }
        skipping = false;
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this);
      }, reverse);
      return iterations;
    };
    skipSequence.__iteratorUncached = function(reverse) {
      if (reverse) {
        return this.cacheResult().__iterator(reverse);
      }
      const iterator = collection.__iterator(reverse);
      let iterations = 0;
      const seq = this;
      let skipping = true;
      return makeEntryIterator(entry => {
        while (true) {
          const step = iterator.next();
          if (step.done) {
            return false;
          }
          const k = step.value[0];
          const v = step.value[1];
          if (skipping && predicate.call(context, v, k, seq)) {
            continue;
          }
          skipping = false;
          entry[0] = useKeys ? k : iterations++;
          entry[1] = v;
          return true;
        }
      });
    };
    return reify(this, skipSequence);
  }
  skipUntil(predicate, context) {
    return this.skipWhile(not(predicate), context);
  }
  sortBy(mapper, comparator) {
    return reify(this, sortFactory(this, comparator, mapper));
  }
  take(amount) {
    return this.slice(0, Math.max(0, amount));
  }
  takeLast(amount) {
    return this.slice(-Math.max(0, amount));
  }
  takeWhile(predicate, context) {
    const collection = this;
    const takeSequence = makeSequence(collection);
    takeSequence.__iterateUncached = function(fn, reverse) {
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse);
      }
      let iterations = 0;
      collection.__iterate((v, k) => {
        if (!predicate.call(context, v, k, this)) {
          return false;
        }
        iterations++;
        return fn(v, k, this);
      }, reverse);
      return iterations;
    };
    takeSequence.__iteratorUncached = function(reverse) {
      if (reverse) {
        return this.cacheResult().__iterator(reverse);
      }
      const iterator = collection.__iterator(reverse);
      const seq = this;
      let finished = false;
      return makeIterator(() => {
        if (finished) {
          return DONE;
        }
        const step = iterator.next();
        if (step.done) {
          return step;
        }
        if (!predicate.call(context, step.value[1], step.value[0], seq)) {
          finished = true;
          return DONE;
        }
        return step;
      });
    };
    return reify(this, takeSequence);
  }
  takeUntil(predicate, context) {
    return this.takeWhile(not(predicate), context);
  }
  update(fn) {
    return fn(this);
  }
  valueSeq() {
    return this.toIndexedSeq();
  }
  __iterate(fn, reverse = false) {
    const iterator = this.__iterator(reverse);
    let iterations = 0;
    let step;
    while (!(step = iterator.next()).done) {
      iterations++;
      if (fn(step.value[1], step.value[0], this) === false) {
        break;
      }
    }
    return iterations;
  }
  __iterator(_reverse = false) {
    throw new Error("CollectionImpl does not implement __iterator. Use a subclass instead.");
  }
}
const KeyedCollection = value => isKeyed(value) ? value : KeyedSeq(value);
class KeyedCollectionImpl extends CollectionImpl {
  static {
    this.prototype[IS_KEYED_SYMBOL] = true;
    this.prototype.__toStringMapper = (v, k) => `${quoteString(k)}: ${quoteString(v)}`;
    this.prototype[Symbol.iterator] = CollectionImpl.prototype.entries;
    this.prototype.toJSON = function() {
      assertNotInfinite(this.size);
      const object = {};
      this.__iterate((v, k) => {
        object[k] = v;
      });
      return object;
    };
  }
  flip() {
    return reify(this, flipFactory(this));
  }
  mapEntries(mapper, context) {
    let iterations = 0;
    return reify(this, this.toSeq().map((v, k) => mapper.call(context, [ k, v ], iterations++, this)).fromEntrySeq());
  }
  mapKeys(mapper, context) {
    return reify(this, this.toSeq().flip().map((k, v) => mapper.call(context, k, v, this)).flip());
  }
}
const IndexedCollection = value => isIndexed(value) ? value : IndexedSeq(value);
class IndexedCollectionImpl extends CollectionImpl {
  static {
    this.prototype[IS_INDEXED_SYMBOL] = true;
    this.prototype[IS_ORDERED_SYMBOL] = true;
  }
  toKeyedSeq() {
    return new ToKeyedSequence(this, false);
  }
  findIndex(predicate, context) {
    const entry = this.findEntry(predicate, context);
    return entry ? entry[0] : -1;
  }
  indexOf(searchValue) {
    const key = this.keyOf(searchValue);
    return key === undefined ? -1 : key;
  }
  lastIndexOf(searchValue) {
    const key = this.lastKeyOf(searchValue);
    return key === undefined ? -1 : key;
  }
  splice(index, removeNum = NOT_SET, ...values) {
    if (index === undefined) {
      return this;
    }
    const hasRemoveNum = removeNum !== NOT_SET;
    removeNum = hasRemoveNum ? Math.max(removeNum || 0, 0) : 0;
    if (hasRemoveNum && !removeNum && values.length === 0) {
      return this;
    }
    index = resolveBegin(index, index < 0 ? this.count() : this.size);
    const spliced = this.slice(0, index);
    return reify(this, !hasRemoveNum ? spliced : spliced.concat(values, this.slice(index + removeNum)));
  }
  findLastIndex(predicate, context) {
    const entry = this.findLastEntry(predicate, context);
    return entry ? entry[0] : -1;
  }
  first(notSetValue) {
    return this.get(0, notSetValue);
  }
  get(index, notSetValue) {
    index = wrapIndex(this, index);
    return index < 0 || this.size === Infinity || this.size !== undefined && index > this.size ? notSetValue : this.find((_, key) => key === index, undefined, notSetValue);
  }
  has(index) {
    index = wrapIndex(this, index);
    return index >= 0 && (this.size !== undefined ? this.size === Infinity || index < this.size : this.indexOf(index) !== -1);
  }
  interpose(separator) {
    const collection = this;
    const interposedSequence = makeSequence(collection);
    interposedSequence.size = collection.size && collection.size * 2 - 1;
    interposedSequence.__iterateUncached = function(fn, reverse) {
      let iterations = 0;
      let isFirst = true;
      collection.__iterate(v => {
        if (!isFirst) {
          if (fn(separator, iterations++, this) === false) {
            return false;
          }
        }
        isFirst = false;
        return fn(v, iterations++, this);
      }, reverse);
      return iterations;
    };
    interposedSequence.__iteratorUncached = function(reverse) {
      const iterator = collection.__iterator(reverse);
      let iterations = 0;
      let isFirst = true;
      let pendingValue;
      let hasPending = false;
      return makeEntryIterator(entry => {
        if (hasPending) {
          hasPending = false;
          entry[0] = iterations++;
          entry[1] = pendingValue;
          return true;
        }
        const step = iterator.next();
        if (step.done) {
          return false;
        }
        const value = step.value[1];
        if (!isFirst) {
          pendingValue = value;
          hasPending = true;
          entry[0] = iterations++;
          entry[1] = separator;
          return true;
        }
        isFirst = false;
        entry[0] = iterations++;
        entry[1] = value;
        return true;
      });
    };
    return reify(this, interposedSequence);
  }
  interleave(...collections) {
    const thisAndCollections = [ this, ...collections ];
    const zipped = zipWithFactory(this.toSeq(), IndexedSeq.of, thisAndCollections);
    const interleaved = zipped.flatten(true);
    if (zipped.size) {
      interleaved.size = zipped.size * thisAndCollections.length;
    }
    return reify(this, interleaved);
  }
  keySeq() {
    throw new Error("keySeq: not patched — import CollectionConversions");
  }
  last(notSetValue) {
    return this.get(-1, notSetValue);
  }
  zip(...collections) {
    return this.zipWith(defaultZipper, ...collections);
  }
  zipAll(...collections) {
    const thisAndCollections = [ this, ...collections ];
    return reify(this, zipWithFactory(this, defaultZipper, thisAndCollections, true));
  }
  zipWith(zipper, ...collections) {
    const thisAndCollections = [ this, ...collections ];
    return reify(this, zipWithFactory(this, zipper, thisAndCollections));
  }
}
const SetCollection = value => isCollection(value) && !isAssociative(value) ? value : SetSeq(value);
class SetCollectionImpl extends CollectionImpl {
  static {
    this.prototype.has = CollectionImpl.prototype.includes;
    this.prototype.contains = CollectionImpl.prototype.includes;
    this.prototype.keys = SetCollectionImpl.prototype.values;
  }
  get(value, notSetValue) {
    return this.has(value) ? value : notSetValue;
  }
  includes(value) {
    return this.has(value);
  }
  keySeq() {
    return this.valueSeq();
  }
}
Collection.Keyed = KeyedCollection;
Collection.Indexed = IndexedCollection;
Collection.Set = SetCollection;
const IndexedCollectionPrototype = IndexedCollectionImpl.prototype;
const Seq = value => value === undefined || value === null ? emptySequence() : isImmutable(value) ? value.toSeq() : seqFromValue(value);
const makeSequence = collection => Object.create((isKeyed(collection) ? KeyedSeqImpl : isIndexed(collection) ? IndexedSeqImpl : SetSeqImpl).prototype);
class SeqImpl extends CollectionImpl {
  static {
    this.prototype[IS_SEQ_SYMBOL] = true;
  }
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
  __iterateUncached(fn, reverse) {
    const iterator = this.__iteratorUncached(reverse);
    let iterations = 0;
    let step;
    while (!(step = iterator.next()).done) {
      iterations++;
      if (fn(step.value[1], step.value[0], this) === false) {
        break;
      }
    }
    return iterations;
  }
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
  __iterator(reverse) {
    const cache = this._cache;
    if (cache) {
      const size = cache.length;
      let i = 0;
      const result = {
        done: false,
        value: undefined
      };
      return makeIterator(() => {
        if (i === size) {
          return DONE;
        }
        result.value = cache[reverse ? size - ++i : i++];
        return result;
      });
    }
    return this.__iteratorUncached(reverse);
  }
}
const seqMixin = {
  cacheResult: SeqImpl.prototype.cacheResult,
  __iterateUncached: SeqImpl.prototype.__iterateUncached,
  __iterate: SeqImpl.prototype.__iterate,
  __iterator: SeqImpl.prototype.__iterator
};
const KeyedSeq = value => value === undefined || value === null ? emptySequence().toKeyedSeq() : isCollection(value) ? isKeyed(value) ? value.toSeq() : value.fromEntrySeq() : isRecord(value) ? value.toSeq() : keyedSeqFromValue(value);
class KeyedSeqImpl extends KeyedCollectionImpl {
  static {
    this.prototype[IS_SEQ_SYMBOL] = true;
    Object.assign(this.prototype, seqMixin);
  }
  toSeq() {
    return this;
  }
  toKeyedSeq() {
    return this;
  }
}
const IndexedSeq = value => value === undefined || value === null ? emptySequence() : isCollection(value) ? isKeyed(value) ? value.entrySeq() : value.toIndexedSeq() : isRecord(value) ? value.toSeq().entrySeq() : indexedSeqFromValue(value);
IndexedSeq.of = (...values) => IndexedSeq(values);
class IndexedSeqImpl extends IndexedCollectionImpl {
  static {
    this.prototype[IS_SEQ_SYMBOL] = true;
    Object.assign(this.prototype, seqMixin);
  }
  toSeq() {
    return this;
  }
  toIndexedSeq() {
    return this;
  }
  toString() {
    return this.__toString("Seq [", "]");
  }
}
const SetSeq = value => (isCollection(value) && !isAssociative(value) ? value : IndexedSeq(value)).toSetSeq();
SetSeq.of = (...values) => SetSeq(values);
class SetSeqImpl extends SetCollectionImpl {
  static {
    this.prototype[IS_SEQ_SYMBOL] = true;
    Object.assign(this.prototype, seqMixin);
  }
  toSeq() {
    return this;
  }
  toSetSeq() {
    return this;
  }
}
Seq.isSeq = isSeq;
Seq.Keyed = KeyedSeq;
Seq.Set = SetSeq;
Seq.Indexed = IndexedSeq;
class ArraySeq extends IndexedSeqImpl {
  constructor(array) {
    super();
    this._array = array;
    this.size = array.length;
  }
  get(index, notSetValue) {
    return this.has(index) ? this._array[wrapIndex(this, index)] : notSetValue;
  }
  __iterateUncached(fn, reverse) {
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
  __iteratorUncached(reverse) {
    const array = this._array;
    const size = array.length;
    let i = 0;
    return makeEntryIterator(entry => {
      if (i === size) {
        return false;
      }
      const ii = reverse ? size - ++i : i++;
      entry[0] = ii;
      entry[1] = array[ii];
      return true;
    });
  }
}
class ObjectSeq extends KeyedSeqImpl {
  static {
    this.prototype[IS_ORDERED_SYMBOL] = true;
  }
  constructor(object) {
    super();
    const keys = [ ...Object.keys(object), ...Object.getOwnPropertySymbols(object) ];
    this._object = object;
    this._keys = keys;
    this.size = keys.length;
  }
  get(key, notSetValue) {
    if (notSetValue !== undefined && !this.has(key)) {
      return notSetValue;
    }
    return this._object[key];
  }
  has(key) {
    return Object.hasOwn(this._object, key);
  }
  __iterateUncached(fn, reverse) {
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
  __iteratorUncached(reverse) {
    const object = this._object;
    const keys = this._keys;
    const size = keys.length;
    let i = 0;
    return makeEntryIterator(entry => {
      if (i === size) {
        return false;
      }
      const key = keys[reverse ? size - ++i : i++];
      entry[0] = key;
      entry[1] = object[key];
      return true;
    });
  }
}
class CollectionSeq extends IndexedSeqImpl {
  constructor(collection) {
    super();
    this._collection = collection;
    this.size = collection.length || collection.size;
  }
  __iterateUncached(fn, reverse) {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    let iterations = 0;
    for (const value of this._collection) {
      if (fn(value, iterations, this) === false) {
        break;
      }
      iterations++;
    }
    return iterations;
  }
  __iteratorUncached(reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(reverse);
    }
    const collection = this._collection;
    const iterator = getIterator(collection);
    if (!isIterator(iterator)) {
      return emptyIterator();
    }
    let iterations = 0;
    return makeEntryIterator(entry => {
      const step = iterator.next();
      if (step.done) {
        return false;
      }
      entry[0] = iterations++;
      entry[1] = step.value;
      return true;
    });
  }
}
const emptySequence = () => new ArraySeq([]);
const maybeIndexedSeqFromValue = value => isArrayLike(value) ? new ArraySeq(value) : hasIterator(value) ? new CollectionSeq(value) : undefined;
function keyedSeqFromValue(value) {
  const seq = maybeIndexedSeqFromValue(value);
  if (seq) {
    return seq.fromEntrySeq();
  }
  if (typeof value === "object") {
    return new ObjectSeq(value);
  }
  throw new TypeError(`Expected Array or collection object of [k, v] entries, or keyed object: ${value}`);
}
function indexedSeqFromValue(value) {
  const seq = maybeIndexedSeqFromValue(value);
  if (seq) {
    return seq;
  }
  throw new TypeError(`Expected Array or collection object of values: ${value}`);
}
function seqFromValue(value) {
  const seq = maybeIndexedSeqFromValue(value);
  if (seq) {
    return isEntriesIterable(value) ? seq.fromEntrySeq() : isKeysIterable(value) ? seq.toSetSeq() : seq;
  }
  if (typeof value === "object") {
    return new ObjectSeq(value);
  }
  throw new TypeError(`Expected Array or collection object of values, or keyed object: ${value}`);
}
class ConcatSeq extends SeqImpl {
  constructor(iterables) {
    super();
    const wrappedIterables = [];
    let size = 0;
    let sizeKnown = true;
    for (const iterable of iterables) {
      if (iterable._wrappedIterables) {
        for (const wrapped of iterable._wrappedIterables) {
          wrappedIterables.push(wrapped);
          if (sizeKnown) {
            const s = wrapped.size;
            if (s !== undefined) {
              size += s;
            } else {
              sizeKnown = false;
            }
          }
        }
      } else {
        wrappedIterables.push(iterable);
        if (sizeKnown) {
          const s = iterable.size;
          if (s !== undefined) {
            size += s;
          } else {
            sizeKnown = false;
          }
        }
      }
    }
    this._wrappedIterables = wrappedIterables;
    this.size = sizeKnown ? size : undefined;
    const first = this._wrappedIterables[0];
    if (first[IS_KEYED_SYMBOL]) {
      this[IS_KEYED_SYMBOL] = true;
    }
    if (first[IS_INDEXED_SYMBOL]) {
      this[IS_INDEXED_SYMBOL] = true;
    }
    if (first[IS_ORDERED_SYMBOL]) {
      this[IS_ORDERED_SYMBOL] = true;
    }
  }
  __iterateUncached(fn, reverse) {
    if (this._wrappedIterables.length === 0) {
      return 0;
    }
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    const wrappedIterables = this._wrappedIterables;
    const reIndex = !isKeyed(this);
    let index = 0;
    let stopped = false;
    for (const iterable of wrappedIterables) {
      iterable.__iterate((v, k) => {
        if (fn(v, reIndex ? index++ : k, this) === false) {
          stopped = true;
          return false;
        }
      }, reverse);
      if (stopped) {
        break;
      }
    }
    return index;
  }
  __iteratorUncached(reverse) {
    if (this._wrappedIterables.length === 0) {
      return emptyIterator();
    }
    if (reverse) {
      return this.cacheResult().__iterator(reverse);
    }
    const wrappedIterables = this._wrappedIterables;
    const reIndex = !isKeyed(this);
    let iterableIdx = 0;
    let currentIterator = wrappedIterables[0].__iterator(reverse);
    function nextStep() {
      while (iterableIdx < wrappedIterables.length) {
        const step = currentIterator.next();
        if (!step.done) return step;
        iterableIdx++;
        if (iterableIdx < wrappedIterables.length) {
          currentIterator = wrappedIterables[iterableIdx].__iterator(reverse);
        }
      }
      return undefined;
    }
    if (reIndex) {
      let index = 0;
      return makeEntryIterator(entry => {
        const step = nextStep();
        if (!step) return false;
        entry[0] = index++;
        entry[1] = step.value[1];
        return true;
      });
    }
    return makeIterator(() => nextStep() || DONE);
  }
}
class ToKeyedSequence extends KeyedSeqImpl {
  static {
    this.prototype[IS_ORDERED_SYMBOL] = true;
  }
  constructor(indexed, useKeys) {
    super();
    this._iter = indexed;
    this._useKeys = useKeys;
    this.size = indexed.size;
  }
  cacheResult() {
    return cacheResultThrough.call(this);
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
  __iterateUncached(fn, reverse) {
    return this._iter.__iterate(fn, reverse);
  }
  __iteratorUncached(reverse) {
    return this._iter.__iterator(reverse);
  }
}
class ToIndexedSequence extends IndexedSeqImpl {
  constructor(iter) {
    super();
    this._iter = iter;
    this.size = iter.size;
  }
  cacheResult() {
    return cacheResultThrough.call(this);
  }
  includes(value) {
    return this._iter.includes(value);
  }
  __iterateUncached(fn, reverse) {
    let i = 0;
    if (reverse) {
      ensureSize(this);
    }
    const size = this.size;
    this._iter.__iterate(v => {
      const ii = reverse ? size - ++i : i++;
      return fn(v, ii, this);
    }, reverse);
    return i;
  }
  __iteratorUncached(reverse) {
    let i = 0;
    if (reverse) {
      ensureSize(this);
    }
    const size = this.size;
    return mapEntries(this._iter.__iterator(reverse), (k, v, entry) => {
      entry[0] = reverse ? size - ++i : i++;
      entry[1] = v;
    });
  }
}
class ToSetSequence extends SetSeqImpl {
  constructor(iter) {
    super();
    this._iter = iter;
    this.size = iter.size;
  }
  cacheResult() {
    return cacheResultThrough.call(this);
  }
  has(key) {
    return this._iter.includes(key);
  }
  __iterateUncached(fn, reverse) {
    return this._iter.__iterate(v => fn(v, v, this), reverse);
  }
  __iteratorUncached(reverse) {
    return mapEntries(this._iter.__iterator(reverse), (k, v, entry) => {
      entry[0] = v;
      entry[1] = v;
    });
  }
}
class FromEntriesSequence extends KeyedSeqImpl {
  constructor(entries) {
    super();
    this._iter = entries;
    this.size = entries.size;
  }
  cacheResult() {
    return cacheResultThrough.call(this);
  }
  entrySeq() {
    return this._iter.toSeq();
  }
  __iterateUncached(fn, reverse) {
    let iterations = 0;
    this._iter.__iterate(entry => {
      if (entry) {
        validateEntry(entry);
        iterations++;
        const indexedCollection = isCollection(entry);
        return fn(indexedCollection ? entry.get(1) : entry[1], indexedCollection ? entry.get(0) : entry[0], this);
      }
    }, reverse);
    return iterations;
  }
  __iteratorUncached(reverse) {
    const iterator = this._iter.__iterator(reverse);
    return makeEntryIterator(out => {
      while (true) {
        const step = iterator.next();
        if (step.done) {
          return false;
        }
        const entry = step.value[1];
        if (entry) {
          validateEntry(entry);
          const indexedCollection = isCollection(entry);
          out[0] = indexedCollection ? entry.get(0) : entry[0];
          out[1] = indexedCollection ? entry.get(1) : entry[1];
          return true;
        }
      }
    });
  }
}
function cacheResultThrough() {
  if (this._iter.cacheResult) {
    this._iter.cacheResult();
    this.size = this._iter.size;
    return this;
  }
  return SeqImpl.prototype.cacheResult.call(this);
}
function validateEntry(entry) {
  if (entry !== Object(entry)) {
    throw new TypeError(`Expected [K, V] tuple: ${entry}`);
  }
}
const Map = value => value === undefined || value === null ? emptyMap() : isMap(value) && !isOrdered(value) ? value : emptyMap().withMutations(map => {
  const iter = KeyedCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v, k) => map.set(k, v));
});
class MapImpl extends KeyedCollectionImpl {
  static {
    mixin(this, {
      asImmutable,
      asMutable,
      deleteIn,
      merge,
      mergeWith,
      mergeDeep,
      mergeDeepWith,
      mergeDeepIn,
      mergeIn,
      setIn,
      update,
      updateIn,
      wasAltered,
      withMutations,
      removeIn: deleteIn,
      concat: merge,
      [IS_MAP_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      removeAll: this.prototype.deleteAll,
      [Symbol.iterator]: this.prototype.entries,
      [Symbol.toStringTag]: "Immutable.Map"
    });
  }
  constructor(size, root, ownerID, hash) {
    super();
    this.size = size;
    this._root = root;
    this.__ownerID = ownerID;
    this.__hash = hash;
    this.__altered = false;
  }
  create(value) {
    return Map(value);
  }
  toString() {
    return this.__toString("Map {", "}");
  }
  get(k, notSetValue) {
    return this._root ? this._root.get(0, hash(k), k, notSetValue) : notSetValue;
  }
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
    return this.withMutations(map => {
      collection.forEach(key => map.remove(key));
    });
  }
  clear() {
    if (this.size === 0) {
      return this;
    }
    if (this.__ownerID) {
      this.size = 0;
      this._root = null;
      this.__hash = undefined;
      this.__altered = true;
      return this;
    }
    return emptyMap();
  }
  map(mapper, context) {
    return this.withMutations(map => {
      map.forEach((value, key) => {
        map.set(key, mapper.call(context, value, key, this));
      });
    });
  }
  keys() {
    if (!this._root) {
      return emptyIterator();
    }
    return mapIteratorGenerator(this._root, false, 0);
  }
  values() {
    if (!this._root) {
      return emptyIterator();
    }
    return mapIteratorGenerator(this._root, false, 1);
  }
  entries() {
    if (!this._root) {
      return emptyIterator();
    }
    return mapIteratorGenerator(this._root, false);
  }
  __iterator(reverse) {
    if (!this._root) {
      return emptyIterator();
    }
    return mapIteratorGenerator(this._root, reverse);
  }
  __iterate(fn, reverse) {
    let iterations = 0;
    if (this._root) {
      this._root.iterate(([key, value]) => {
        iterations++;
        return fn(value, key, this);
      }, reverse);
    }
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
}
Map.isMap = isMap;
class ArrayMapNode {
  constructor(ownerID, entries) {
    this.ownerID = ownerID;
    this.entries = entries;
  }
  get(shift, keyHash, key, notSetValue) {
    return linearGet(this.entries, key, notSetValue);
  }
  iterate(fn, reverse) {
    return iterateLinearEntries(this.entries, fn, reverse);
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    const removed = value === NOT_SET;
    const entries = this.entries;
    let idx = 0;
    const len = entries.length;
    for (;idx < len; idx++) {
      if (is(key, entries[idx][0])) {
        break;
      }
    }
    const exists = idx < len;
    if (exists ? entries[idx][1] === value : removed) {
      return this;
    }
    SetRef(didAlter);
    if (removed || !exists) {
      SetRef(didChangeSize);
    }
    if (removed && len === 1) {
      return;
    }
    if (!exists && !removed && len >= MAX_ARRAY_MAP_SIZE) {
      return createNodes(ownerID, entries, key, value);
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newEntries = isEditable ? entries : entries.slice();
    if (exists) {
      if (removed) {
        if (idx === len - 1) {
          newEntries.pop();
        } else {
          newEntries[idx] = newEntries.pop();
        }
      } else {
        newEntries[idx] = [ key, value ];
      }
    } else {
      newEntries.push([ key, value ]);
    }
    if (isEditable) {
      this.entries = newEntries;
      return this;
    }
    return new ArrayMapNode(ownerID, newEntries);
  }
}
class BitmapIndexedNode {
  constructor(ownerID, bitmap, nodes) {
    this.ownerID = ownerID;
    this.bitmap = bitmap;
    this.nodes = nodes;
  }
  iterate(fn, reverse) {
    return iterateNodeArray(this.nodes, fn, reverse);
  }
  get(shift, keyHash, key, notSetValue) {
    const bit = 1 << ((shift === 0 ? keyHash : keyHash >>> shift) & MASK);
    const bitmap = this.bitmap;
    return (bitmap & bit) === 0 ? notSetValue : this.nodes[popCount(bitmap & bit - 1)].get(shift + SHIFT, keyHash, key, notSetValue);
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    const keyHashFrag = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const bit = 1 << keyHashFrag;
    const bitmap = this.bitmap;
    const exists = (bitmap & bit) !== 0;
    if (!exists && value === NOT_SET) {
      return this;
    }
    const idx = popCount(bitmap & bit - 1);
    const nodes = this.nodes;
    const node = exists ? nodes[idx] : undefined;
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
    return new BitmapIndexedNode(ownerID, newBitmap, newNodes);
  }
}
class HashArrayMapNode {
  constructor(ownerID, count, nodes) {
    this.ownerID = ownerID;
    this.count = count;
    this.nodes = nodes;
  }
  iterate(fn, reverse) {
    return iterateNodeArray(this.nodes, fn, reverse);
  }
  get(shift, keyHash, key, notSetValue) {
    const idx = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const node = this.nodes[idx];
    return node ? node.get(shift + SHIFT, keyHash, key, notSetValue) : notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
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
    return new HashArrayMapNode(ownerID, newCount, newNodes);
  }
}
class HashCollisionNode {
  constructor(ownerID, keyHash, entries) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entries = entries;
  }
  get(shift, keyHash, key, notSetValue) {
    return linearGet(this.entries, key, notSetValue);
  }
  iterate(fn, reverse) {
    return iterateLinearEntries(this.entries, fn, reverse);
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    if (keyHash !== this.keyHash) {
      if (value === NOT_SET) {
        return this;
      }
      SetRef(didAlter);
      SetRef(didChangeSize);
      return mergeIntoNode(this, ownerID, shift, keyHash, [ key, value ]);
    }
    const removed = value === NOT_SET;
    const entries = this.entries;
    let idx = 0;
    const len = entries.length;
    for (;idx < len; idx++) {
      if (is(key, entries[idx][0])) {
        break;
      }
    }
    const exists = idx < len;
    if (exists ? entries[idx][1] === value : removed) {
      return this;
    }
    SetRef(didAlter);
    if (removed || !exists) {
      SetRef(didChangeSize);
    }
    if (removed && len === 2) {
      return new ValueNode(ownerID, this.keyHash, entries[idx ^ 1]);
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newEntries = isEditable ? entries : entries.slice();
    if (exists) {
      if (removed) {
        if (idx === len - 1) {
          newEntries.pop();
        } else {
          newEntries[idx] = newEntries.pop();
        }
      } else {
        newEntries[idx] = [ key, value ];
      }
    } else {
      newEntries.push([ key, value ]);
    }
    if (isEditable) {
      this.entries = newEntries;
      return this;
    }
    return new HashCollisionNode(ownerID, this.keyHash, newEntries);
  }
}
class ValueNode {
  constructor(ownerID, keyHash, entry) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entry = entry;
  }
  iterate(fn, _reverse) {
    return fn(this.entry);
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
      return new ValueNode(ownerID, this.keyHash, [ key, value ]);
    }
    SetRef(didChangeSize);
    return mergeIntoNode(this, ownerID, shift, hash(key), [ key, value ]);
  }
}
function linearGet(entries, key, notSetValue) {
  for (let ii = 0, len = entries.length; ii < len; ii++) {
    if (is(key, entries[ii][0])) {
      return entries[ii][1];
    }
  }
  return notSetValue;
}
function iterateLinearEntries(entries, fn, reverse) {
  for (let ii = 0, maxIndex = entries.length - 1; ii <= maxIndex; ii++) {
    if (fn(entries[reverse ? maxIndex - ii : ii]) === false) {
      return false;
    }
  }
}
function iterateNodeArray(nodes, fn, reverse) {
  for (let ii = 0, maxIndex = nodes.length - 1; ii <= maxIndex; ii++) {
    const node = nodes[reverse ? maxIndex - ii : ii];
    if (node?.iterate(fn, reverse) === false) {
      return false;
    }
  }
}
function mapIteratorGenerator(node, reverse, entryIndex) {
  let stack = {
    node,
    index: 0,
    __prev: null
  };
  const extractValue = entryIndex !== undefined ? entry => entry[entryIndex] : entry => entry;
  const result = {
    done: false,
    value: undefined
  };
  return makeIterator(() => {
    while (stack) {
      const node = stack.node;
      const index = stack.index++;
      let maxIndex;
      if (node.entry) {
        if (index === 0) {
          result.value = extractValue(node.entry);
          return result;
        }
      } else if (node.entries) {
        maxIndex = node.entries.length - 1;
        if (index <= maxIndex) {
          result.value = extractValue(node.entries[reverse ? maxIndex - index : index]);
          return result;
        }
      } else {
        maxIndex = node.nodes.length - 1;
        if (index <= maxIndex) {
          const subNode = node.nodes[reverse ? maxIndex - index : index];
          if (subNode) {
            if (subNode.entry) {
              result.value = extractValue(subNode.entry);
              return result;
            }
            stack = {
              node: subNode,
              index: 0,
              __prev: stack
            };
          }
          continue;
        }
      }
      stack = stack.__prev;
    }
    return DONE;
  });
}
const makeMap = (size, root, ownerID, hash) => new MapImpl(size, root, ownerID, hash);
let EMPTY_MAP;
const emptyMap = () => EMPTY_MAP || (EMPTY_MAP = makeMap(0));
function updateMap(map, k, v) {
  let newRoot;
  let newSize;
  if (!map._root) {
    if (v === NOT_SET) {
      return map;
    }
    newSize = 1;
    newRoot = new ArrayMapNode(map.__ownerID, [ [ k, v ] ]);
  } else {
    const didChangeSize = MakeRef();
    const didAlter = MakeRef();
    newRoot = updateNode(map._root, map.__ownerID, 0, hash(k), k, v, didChangeSize, didAlter);
    if (!didAlter.value) {
      return map;
    }
    newSize = map.size + (didChangeSize.value ? v === NOT_SET ? -1 : 1 : 0);
  }
  if (map.__ownerID) {
    map.size = newSize;
    map._root = newRoot;
    map.__hash = undefined;
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
    return new ValueNode(ownerID, keyHash, [ key, value ]);
  }
  return node.update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter);
}
const isLeafNode = node => node.constructor === ValueNode || node.constructor === HashCollisionNode;
function mergeIntoNode(node, ownerID, shift, keyHash, entry) {
  if (node.keyHash === keyHash) {
    return new HashCollisionNode(ownerID, keyHash, [ node.entry, entry ]);
  }
  const idx1 = (shift === 0 ? node.keyHash : node.keyHash >>> shift) & MASK;
  const idx2 = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
  const newNode = new ValueNode(ownerID, keyHash, entry);
  const nodes = idx1 === idx2 ? [ mergeIntoNode(node, ownerID, shift + SHIFT, keyHash, entry) ] : idx1 < idx2 ? [ node, newNode ] : [ newNode, node ];
  return new BitmapIndexedNode(ownerID, 1 << idx1 | 1 << idx2, nodes);
}
function createNodes(ownerID, entries, key, value) {
  if (!ownerID) {
    ownerID = new OwnerID;
  }
  let node = new ValueNode(ownerID, hash(key), [ key, value ]);
  for (const [k, v] of entries) {
    node = node.update(ownerID, 0, hash(k), k, v);
  }
  return node;
}
function packNodes(ownerID, nodes, count, excluding) {
  let bitmap = 0;
  let packedII = 0;
  const packedNodes = new Array(count);
  for (let ii = 0, bit = 1, len = nodes.length; ii < len; ii++, bit <<= 1) {
    const node = nodes[ii];
    if (node !== undefined && ii !== excluding) {
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
    expandedNodes[ii] = bitmap & 1 ? nodes[count++] : undefined;
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
  const newArray = canEdit ? array : array.slice();
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
const MAX_ARRAY_MAP_SIZE = SIZE / 4;
const MAX_BITMAP_INDEXED_SIZE = SIZE / 2;
const MIN_HASH_ARRAY_MAP_SIZE = SIZE / 4;
function shallowCopy(from) {
  if (Array.isArray(from)) {
    return from.slice();
  }
  return {
    ...from
  };
}
const merge$1 = (collection, ...sources) => mergeWithSources(collection, sources);
const mergeWith$1 = (merger, collection, ...sources) => mergeWithSources(collection, sources, merger);
const mergeDeepWithSources = (collection, sources, merger) => mergeWithSources(collection, sources, deepMergerWith(merger));
const mergeDeep$1 = (collection, ...sources) => mergeDeepWithSources(collection, sources);
const mergeDeepWith$1 = (merger, collection, ...sources) => mergeDeepWithSources(collection, sources, merger);
function mergeWithSources(collection, sources, merger) {
  if (!isDataStructure(collection)) {
    throw new TypeError(`Cannot merge into non-data-structure value: ${collection}`);
  }
  if (isImmutable(collection)) {
    return typeof merger === "function" && collection.mergeWith ? collection.mergeWith(merger, ...sources) : collection.merge ? collection.merge(...sources) : collection.concat(...sources);
  }
  const isArray = Array.isArray(collection);
  let merged = collection;
  const Collection = isArray ? IndexedCollection : KeyedCollection;
  const mergeItem = isArray ? value => {
    if (merged === collection) {
      merged = shallowCopy(merged);
    }
    merged.push(value);
  } : (value, key) => {
    const hasVal = Object.hasOwn(merged, key);
    const nextVal = hasVal && merger ? merger(merged[key], value, key) : value;
    if (!hasVal || nextVal !== merged[key]) {
      if (merged === collection) {
        merged = shallowCopy(merged);
      }
      merged[key] = nextVal;
    }
  };
  for (const source of sources) {
    Collection(source).forEach(mergeItem);
  }
  return merged;
}
function deepMergerWith(merger) {
  function deepMerger(oldValue, newValue, key) {
    return isDataStructure(oldValue) && isDataStructure(newValue) && areMergeable(oldValue, newValue) ? mergeWithSources(oldValue, [ newValue ], deepMerger) : merger ? merger(oldValue, newValue, key) : newValue;
  }
  return deepMerger;
}
function areMergeable(oldDataStructure, newDataStructure) {
  const oldSeq = Seq(oldDataStructure);
  const newSeq = Seq(newDataStructure);
  return isIndexed(oldSeq) === isIndexed(newSeq) && isKeyed(oldSeq) === isKeyed(newSeq);
}
function remove(collection, key) {
  if (!isDataStructure(collection)) {
    throw new TypeError(`Cannot update non-data-structure value: ${collection}`);
  }
  if (isImmutable(collection)) {
    if (!collection.remove) {
      throw new TypeError(`Cannot update immutable value without .remove() method: ${collection}`);
    }
    return collection.remove(key);
  }
  if (!Object.hasOwn(collection, key)) {
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
function set(collection, key, value) {
  if (!isDataStructure(collection)) {
    throw new TypeError(`Cannot update non-data-structure value: ${collection}`);
  }
  if (isImmutable(collection)) {
    if (!collection.set) {
      throw new TypeError(`Cannot update immutable value without .set() method: ${collection}`);
    }
    return collection.set(key, value);
  }
  if (Object.hasOwn(collection, key) && value === collection[key]) {
    return collection;
  }
  const collectionCopy = shallowCopy(collection);
  collectionCopy[key] = value;
  return collectionCopy;
}
function updateIn$1(collection, keyPath, notSetValue, updater) {
  if (!updater) {
    updater = notSetValue;
    notSetValue = undefined;
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
    throw new TypeError(`Cannot update within non-data-structure value in path [${Array.from(keyPath).slice(0, i).map(quoteString)}]: ${existing}`);
  }
  const key = keyPath[i];
  const nextExisting = wasNotSet ? NOT_SET : get(existing, key, NOT_SET);
  const nextUpdated = updateInDeeply(nextExisting === NOT_SET ? inImmutable : isImmutable(nextExisting), nextExisting, keyPath, i + 1, notSetValue, updater);
  if (nextUpdated === nextExisting) {
    return existing;
  }
  if (nextUpdated === NOT_SET) {
    return remove(existing, key);
  }
  const collection = wasNotSet ? inImmutable ? emptyMap() : {} : existing;
  return set(collection, key, nextUpdated);
}
const removeIn = (collection, keyPath) => updateIn$1(collection, keyPath, () => NOT_SET);
const setIn$1 = (collection, keyPath, value) => updateIn$1(collection, keyPath, NOT_SET, () => value);
function update$1(collection, key, notSetValue, updater) {
  return updateIn$1(collection, [ key ], notSetValue, updater);
}
function asImmutable() {
  return this.__ensureOwner();
}
function asMutable() {
  return this.__ownerID ? this : this.__ensureOwner(new OwnerID);
}
function wasAltered() {
  return this.__altered;
}
function withMutations(fn) {
  const mutable = this.asMutable();
  fn(mutable);
  return mutable.wasAltered() ? mutable.__ensureOwner(this.__ownerID) : this;
}
function getIn(searchKeyPath, notSetValue) {
  return getIn$1(this, searchKeyPath, notSetValue);
}
function hasIn(searchKeyPath) {
  return hasIn$1(this, searchKeyPath);
}
function deleteIn(keyPath) {
  return removeIn(this, keyPath);
}
function setIn(keyPath, v) {
  return setIn$1(this, keyPath, v);
}
function update(key, notSetValue, updater) {
  return typeof key === "function" ? key(this) : update$1(this, key, notSetValue, updater);
}
function updateIn(keyPath, notSetValue, updater) {
  return updateIn$1(this, keyPath, notSetValue, updater);
}
function toObject() {
  assertNotInfinite(this.size);
  const object = {};
  this.__iterate((v, k) => {
    object[k] = v;
  });
  return object;
}
function merge(...iters) {
  return mergeIntoKeyedWith(this, iters);
}
function mergeWith(merger, ...iters) {
  if (typeof merger !== "function") {
    throw new TypeError(`Invalid merger function: ${merger}`);
  }
  return mergeIntoKeyedWith(this, iters, merger);
}
function mergeIntoKeyedWith(collection, collections, merger) {
  const iters = [];
  for (const item of collections) {
    const collection = KeyedCollection(item);
    if (collection.size !== 0) {
      iters.push(collection);
    }
  }
  if (iters.length === 0) {
    return collection;
  }
  if (collection.toSeq().size === 0 && !collection.__ownerID && iters.length === 1) {
    return isRecord(collection) ? collection : collection.create(iters[0]);
  }
  return collection.withMutations(collection => {
    const mergeIntoCollection = merger ? (value, key) => {
      update$1(collection, key, NOT_SET, oldVal => oldVal === NOT_SET ? value : merger(oldVal, value, key));
    } : (value, key) => {
      collection.set(key, value);
    };
    for (const iter of iters) {
      iter.forEach(mergeIntoCollection);
    }
  });
}
function mergeDeep(...iters) {
  return mergeDeepWithSources(this, iters);
}
function mergeDeepWith(merger, ...iters) {
  return mergeDeepWithSources(this, iters, merger);
}
function mergeIn(keyPath, ...iters) {
  return updateIn$1(this, keyPath, emptyMap(), m => mergeWithSources(m, iters));
}
function mergeDeepIn(keyPath, ...iters) {
  return updateIn$1(this, keyPath, emptyMap(), m => mergeDeepWithSources(m, iters));
}
function mixin(Class, methods) {
  Object.assign(Class.prototype, methods);
}
const List = value => {
  const empty = emptyList();
  if (value === undefined || value === null) {
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
  return empty.withMutations(list => {
    list.setSize(size);
    iter.forEach((v, i) => list.set(i, v));
  });
};
List.of = (...values) => List(values);
class ListImpl extends IndexedCollectionImpl {
  static {
    mixin(this, {
      asImmutable,
      asMutable,
      deleteIn,
      mergeDeepIn,
      mergeIn,
      setIn,
      update,
      updateIn,
      wasAltered,
      withMutations,
      removeIn: deleteIn,
      [IS_LIST_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      merge: this.prototype.concat,
      [Symbol.toStringTag]: "Immutable.List",
      [Symbol.iterator]: this.prototype.values
    });
  }
  constructor(origin, capacity, level, root, tail, ownerID, hash) {
    super();
    this.size = capacity - origin;
    this._origin = origin;
    this._capacity = capacity;
    this._level = level;
    this._root = root;
    this._tail = tail;
    this.__ownerID = ownerID;
    this.__hash = hash;
    this.__altered = false;
  }
  create(value) {
    return List(value);
  }
  toString() {
    return this.__toString("List [", "]");
  }
  get(index, notSetValue) {
    index = wrapIndex(this, index);
    if (index >= 0 && index < this.size) {
      index += this._origin;
      const node = listNodeFor(this, index);
      return node?.array[index & MASK];
    }
    return notSetValue;
  }
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
      this._root = this._tail = this.__hash = undefined;
      this.__altered = true;
      return this;
    }
    return emptyList();
  }
  push(...values) {
    const oldSize = this.size;
    return this.withMutations(list => {
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
    return this.withMutations(list => {
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
    return this.withMutations(mutable => {
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
  concat(...collections) {
    const seqs = [];
    for (const collection of collections) {
      const seq = IndexedCollection(typeof collection !== "string" && hasIterator(collection) ? collection : [ collection ]);
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
    return this.withMutations(list => {
      seqs.forEach(seq => seq.forEach(value => list.push(value)));
    });
  }
  setSize(size) {
    return setListBounds(this, 0, size);
  }
  map(mapper, context) {
    return this.withMutations(list => {
      for (let i = 0; i < this.size; i++) {
        list.set(i, mapper.call(context, list.get(i), i, this));
      }
    });
  }
  slice(begin, end) {
    const size = this.size;
    if (wholeSlice(begin, end, size)) {
      return this;
    }
    return setListBounds(this, resolveBegin(begin, size), resolveEnd(end, size));
  }
  __iterate(fn, reverse) {
    let index = reverse ? this.size : 0;
    iterateListCallback(this, value => fn(value, reverse ? --index : index++, this), reverse);
    return reverse ? this.size - index : index;
  }
  __iterator(reverse) {
    let index = reverse ? this.size : 0;
    const iter = iterateList(this, reverse);
    return makeEntryIterator(entry => {
      const step = iter.next();
      if (step.done) {
        return false;
      }
      entry[0] = reverse ? --index : index++;
      entry[1] = step.value;
      return true;
    });
  }
  values() {
    return iterateList(this, false);
  }
  keys() {
    return makeIndexKeys(this.size);
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
}
List.isList = isList;
class VNode {
  constructor(array, ownerID) {
    this.array = array;
    this.ownerID = ownerID;
  }
  removeBefore(ownerID, level, index) {
    if ((index & (1 << level + SHIFT) - 1) === 0 || this.array.length === 0) {
      return this;
    }
    const originIndex = index >>> level & MASK;
    if (originIndex >= this.array.length) {
      return new VNode([], ownerID);
    }
    const removingFirst = originIndex === 0;
    let newChild;
    if (level > 0) {
      const oldChild = this.array[originIndex];
      newChild = oldChild?.removeBefore(ownerID, level - SHIFT, index);
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
        editable.array[ii] = undefined;
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
      newChild = oldChild?.removeAfter(ownerID, level - SHIFT, index);
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
}
function iterateList(list, reverse) {
  const left = list._origin;
  const right = list._capacity;
  const tailPos = getTailOffset(right);
  const tail = list._tail;
  const stack = [];
  pushFrame(list._root, list._level, 0);
  const result = {
    done: false,
    value: undefined
  };
  return makeIterator(() => {
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.from === frame.to) {
        stack.pop();
        continue;
      }
      const idx = reverse ? --frame.to : frame.from++;
      if (frame.isLeaf) {
        result.value = frame.array?.[idx];
        return result;
      }
      const childNode = frame.array?.[idx];
      const childLevel = frame.level - SHIFT;
      const childOffset = frame.offset + (idx << frame.level);
      pushFrame(childNode, childLevel, childOffset);
    }
    return DONE;
  });
  function pushFrame(node, level, offset) {
    if (level === 0) {
      const array = offset === tailPos ? tail?.array : node?.array;
      const from = offset > left ? 0 : left - offset;
      let to = right - offset;
      if (to > SIZE) {
        to = SIZE;
      }
      if (from !== to) {
        stack.push({
          array,
          from,
          to,
          isLeaf: true
        });
      }
    } else {
      const array = node?.array;
      const from = offset > left ? 0 : left - offset >> level;
      let to = (right - offset >> level) + 1;
      if (to > SIZE) {
        to = SIZE;
      }
      if (from !== to) {
        stack.push({
          array,
          from,
          to,
          level,
          offset,
          isLeaf: false
        });
      }
    }
  }
}
function iterateListCallback(list, fn, reverse) {
  const left = list._origin;
  const right = list._capacity;
  const tailPos = getTailOffset(right);
  const tail = list._tail;
  const level = list._level;
  const root = list._root;
  return level === 0 ? iterateLeaf(root, 0, left, right, tailPos, tail, fn, reverse) : iterateNode(root, level, 0, left, right, tailPos, tail, fn, reverse);
}
function iterateLeaf(node, offset, left, right, tailPos, tail, fn, reverse) {
  const array = offset === tailPos ? tail?.array : node?.array;
  let from = offset > left ? 0 : left - offset;
  let to = right - offset;
  if (to > SIZE) {
    to = SIZE;
  }
  while (from !== to) {
    const idx = reverse ? --to : from++;
    if (fn(array?.[idx]) === false) {
      return false;
    }
  }
}
function iterateNode(node, level, offset, left, right, tailPos, tail, fn, reverse) {
  const array = node?.array;
  let from = offset > left ? 0 : left - offset >> level;
  let to = (right - offset >> level) + 1;
  if (to > SIZE) {
    to = SIZE;
  }
  const nextLevel = level - SHIFT;
  while (from !== to) {
    const idx = reverse ? --to : from++;
    const nextOffset = offset + (idx << level);
    if ((nextLevel === 0 ? iterateLeaf(array?.[idx], nextOffset, left, right, tailPos, tail, fn, reverse) : iterateNode(array?.[idx], nextLevel, nextOffset, left, right, tailPos, tail, fn, reverse)) === false) {
      return false;
    }
  }
}
const makeList = (origin, capacity, level, root, tail, ownerID, hash) => new ListImpl(origin, capacity, level, root, tail, ownerID, hash);
const emptyList = () => makeList(0, 0, SHIFT);
function updateList(list, index, value) {
  index = wrapIndex(list, index);
  if (Number.isNaN(index)) {
    return list;
  }
  if (index >= list.size || index < 0) {
    return list.withMutations(list => {
      if (index < 0) {
        setListBounds(list, index).set(0, value);
      } else {
        setListBounds(list, 0, index + 1).set(index, value);
      }
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
    list.__hash = undefined;
    list.__altered = true;
    return list;
  }
  return makeList(list._origin, list._capacity, list._level, newRoot, newTail);
}
function updateVNode(node, ownerID, level, index, value, didAlter) {
  const idx = index >>> level & MASK;
  const nodeHas = node && idx < node.array.length;
  if (!nodeHas && value === undefined) {
    return node;
  }
  let newNode;
  if (level > 0) {
    const lowerNode = node?.array[idx];
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
  if (value === undefined && idx === newNode.array.length - 1) {
    newNode.array.pop();
  } else {
    newNode.array[idx] = value;
  }
  return newNode;
}
function editableVNode(node, ownerID) {
  if (ownerID && ownerID === node?.ownerID) {
    return node;
  }
  return new VNode(node?.array.slice() ?? [], ownerID);
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
  if (begin !== undefined) {
    begin |= 0;
  }
  if (end !== undefined) {
    end |= 0;
  }
  const owner = list.__ownerID || new OwnerID;
  let oldOrigin = list._origin;
  let oldCapacity = list._capacity;
  let newOrigin = oldOrigin + begin;
  let newCapacity = end === undefined ? oldCapacity : end < 0 ? oldCapacity + end : oldOrigin + end;
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
    newRoot = new VNode(newRoot?.array.length ? [ undefined, newRoot ] : [], owner);
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
    newRoot = new VNode(newRoot?.array.length ? [ newRoot ] : [], owner);
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
    newTail = newTail?.removeAfter(owner, 0, newCapacity);
  }
  if (newOrigin >= newTailOffset) {
    newOrigin -= newTailOffset;
    newCapacity -= newTailOffset;
    newLevel = SHIFT;
    newRoot = null;
    newTail = newTail?.removeBefore(owner, 0, newOrigin);
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
    list.__hash = undefined;
    list.__altered = true;
    return list;
  }
  return makeList(newOrigin, newCapacity, newLevel, newRoot, newTail);
}
const getTailOffset = size => size < SIZE ? 0 : size - 1 >>> SHIFT << SHIFT;
const OrderedMap = value => value === undefined || value === null ? emptyOrderedMap() : isOrderedMap(value) ? value : emptyOrderedMap().withMutations(map => {
  const iter = KeyedCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach((v, k) => map.set(k, v));
});
OrderedMap.of = (...values) => OrderedMap(values);
class OrderedMapImpl extends MapImpl {
  static {
    mixin(this, {
      [IS_ORDERED_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      [Symbol.iterator]: this.prototype.entries,
      [Symbol.toStringTag]: "Immutable.OrderedMap",
      keys: CollectionImpl.prototype.keys,
      values: CollectionImpl.prototype.values,
      __iterate: CollectionImpl.prototype.__iterate
    });
  }
  constructor(map, list, ownerID, hash) {
    super(map ? map.size : 0, undefined, ownerID, hash);
    this._map = map;
    this._list = list;
  }
  create(value) {
    return OrderedMap(value);
  }
  toString() {
    return this.__toString("OrderedMap {", "}");
  }
  get(k, notSetValue) {
    const index = this._map.get(k);
    return index !== undefined ? this._list.get(index)[1] : notSetValue;
  }
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
  entries() {
    return this.__iterator(false);
  }
  __iterator(reverse) {
    const listIter = this._list.__iterator(reverse);
    return makeEntryIterator(entry => {
      while (true) {
        const step = listIter.next();
        if (step.done) {
          return false;
        }
        const e = step.value[1];
        if (e) {
          entry[0] = e[0];
          entry[1] = e[1];
          return true;
        }
      }
    });
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
}
OrderedMap.isOrderedMap = isOrderedMap;
const makeOrderedMap = (map, list, ownerID, hash) => new OrderedMapImpl(map, list, ownerID, hash);
const emptyOrderedMap = () => makeOrderedMap(emptyMap(), emptyList());
function updateOrderedMap(omap, k, v) {
  const {_map: map, _list: list} = omap;
  const i = map.get(k);
  const has = i !== undefined;
  let newMap;
  let newList;
  if (v === NOT_SET) {
    if (!has) {
      return omap;
    }
    if (list.size >= SIZE && list.size >= map.size * 2) {
      const entries = [];
      list.forEach((entry, idx) => {
        if (entry !== undefined && i !== idx) {
          entries.push(entry);
        }
      });
      newList = emptyList().withMutations(l => {
        for (let j = 0; j < entries.length; j++) {
          l.set(j, entries[j]);
        }
      });
      newMap = emptyMap().withMutations(m => {
        for (let j = 0; j < entries.length; j++) {
          m.set(entries[j][0], j);
        }
      });
      if (omap.__ownerID) {
        newMap.__ownerID = newList.__ownerID = omap.__ownerID;
      }
    } else {
      newMap = map.remove(k);
      newList = i === list.size - 1 ? list.pop() : list.set(i, undefined);
    }
  } else if (has) {
    if (v === list.get(i)[1]) {
      return omap;
    }
    newMap = map;
    newList = list.set(i, [ k, v ]);
  } else {
    const newIdx = list.size;
    newMap = map.set(k, newIdx);
    newList = list.set(newIdx, [ k, v ]);
  }
  if (omap.__ownerID) {
    omap.size = newMap.size;
    omap._map = newMap;
    omap._list = newList;
    omap.__hash = undefined;
    omap.__altered = true;
    return omap;
  }
  return makeOrderedMap(newMap, newList);
}
const Stack = value => value === undefined || value === null ? emptyStack() : isStack(value) ? value : emptyStack().pushAll(value);
Stack.of = (...values) => Stack(values);
class StackImpl extends IndexedCollectionImpl {
  static {
    mixin(this, {
      asImmutable,
      asMutable,
      wasAltered,
      withMutations,
      [IS_STACK_SYMBOL]: true,
      shift: this.prototype.pop,
      unshift: this.prototype.push,
      unshiftAll: this.prototype.pushAll,
      [Symbol.toStringTag]: "Immutable.Stack",
      [Symbol.iterator]: this.prototype.values
    });
  }
  constructor(size, head, ownerID, hash) {
    super();
    this.size = size;
    this._head = head;
    this.__ownerID = ownerID;
    this.__hash = hash;
    this.__altered = false;
  }
  create(value) {
    return Stack(value);
  }
  toString() {
    return this.__toString("Stack [", "]");
  }
  get(index, notSetValue) {
    let head = this._head;
    index = wrapIndex(this, index);
    while (head && index--) {
      head = head.next;
    }
    return head ? head.value : notSetValue;
  }
  peek() {
    return this._head?.value;
  }
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
    return returnStack(this, newSize, head);
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
    iter.__iterate(value => {
      newSize++;
      head = {
        value,
        next: head
      };
    }, true);
    return returnStack(this, newSize, head);
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
      this._head = undefined;
      this.__hash = undefined;
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
    return returnStack(this, newSize, head);
  }
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
  __iterate(fn, reverse) {
    if (reverse) {
      const arr = this.toArray();
      const size = arr.length;
      let i = 0;
      while (i !== size) {
        if (fn(arr[size - ++i], size - i, this) === false) {
          break;
        }
      }
      return i;
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
  __iterator(reverse) {
    if (reverse) {
      const arr = this.toArray();
      const size = arr.length;
      let i = 0;
      return makeEntryIterator(entry => {
        if (i === size) {
          return false;
        }
        const ii = size - ++i;
        entry[0] = ii;
        entry[1] = arr[ii];
        return true;
      });
    }
    let iterations = 0;
    let node = this._head;
    return makeEntryIterator(entry => {
      if (!node) {
        return false;
      }
      entry[0] = iterations++;
      entry[1] = node.value;
      node = node.next;
      return true;
    });
  }
  values() {
    let node = this._head;
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      if (!node) return DONE;
      result.value = node.value;
      node = node.next;
      return result;
    });
  }
  keys() {
    return makeIndexKeys(this.size);
  }
}
Stack.isStack = isStack;
function returnStack(stack, newSize, head) {
  if (stack.__ownerID) {
    stack.size = newSize;
    stack._head = head;
    stack.__hash = undefined;
    stack.__altered = true;
    return stack;
  }
  return makeStack(newSize, head);
}
const makeStack = (size, head, ownerID, hash) => new StackImpl(size, head, ownerID, hash);
let EMPTY_STACK;
const emptyStack = () => EMPTY_STACK || (EMPTY_STACK = makeStack(0));
const Set = value => value === undefined || value === null ? emptySet() : isSet(value) && !isOrdered(value) ? value : emptySet().withMutations(set => {
  const iter = SetCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach(v => set.add(v));
});
Set.of = (...values) => Set(values);
Set.fromKeys = value => Set(KeyedCollection(value).keySeq());
Set.intersect = sets => {
  sets = Collection(sets).toArray();
  return sets.length ? Set(sets.pop()).intersect(...sets) : emptySet();
};
Set.union = sets => {
  const setArray = Collection(sets).toArray();
  return setArray.length ? Set(setArray.pop()).union(...setArray) : emptySet();
};
class SetImpl extends SetCollectionImpl {
  static {
    mixin(this, {
      withMutations,
      asImmutable,
      asMutable,
      [IS_SET_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      merge: this.prototype.union,
      concat: this.prototype.union,
      [Symbol.toStringTag]: "Immutable.Set"
    });
  }
  constructor(map, ownerID) {
    super();
    this.size = map ? map.size : 0;
    this._map = map;
    this.__ownerID = ownerID;
  }
  create(value) {
    return Set(value);
  }
  toString() {
    return this.__toString("Set {", "}");
  }
  has(value) {
    return this._map.has(value);
  }
  add(value) {
    return updateSet(this, this._map.set(value, value));
  }
  remove(value) {
    return updateSet(this, this._map.remove(value));
  }
  clear() {
    return updateSet(this, this._map.clear());
  }
  map(mapper, context) {
    let didChanges = false;
    const newMap = updateSet(this, this._map.mapEntries(([, v]) => {
      const mapped = mapper.call(context, v, v, this);
      if (mapped !== v) {
        didChanges = true;
      }
      return [ mapped, mapped ];
    }, context));
    return didChanges ? newMap : this;
  }
  union(...iters) {
    iters = iters.filter(x => x.size !== 0);
    if (iters.length === 0) {
      return this;
    }
    if (this.size === 0 && !this.__ownerID && iters.length === 1) {
      return Set(iters[0]);
    }
    return this.withMutations(set => {
      for (const iter of iters) {
        if (typeof iter === "string") {
          set.add(iter);
        } else {
          SetCollection(iter).forEach(value => set.add(value));
        }
      }
    });
  }
  intersect(...iters) {
    return filterByIters(this, iters, (value, sets) => !sets.every(iter => iter.includes(value)));
  }
  subtract(...iters) {
    return filterByIters(this, iters, (value, sets) => sets.some(iter => iter.includes(value)));
  }
  wasAltered() {
    return this._map.wasAltered();
  }
  __iterator(reverse) {
    return this._map.__iterator(reverse);
  }
  __empty() {
    return emptySet();
  }
  __make(map, ownerID) {
    return makeSet(map, ownerID);
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
}
Set.isSet = isSet;
const makeSet = (map, ownerID) => new SetImpl(map, ownerID);
let EMPTY_SET;
const emptySet = () => EMPTY_SET || (EMPTY_SET = makeSet(emptyMap()));
function filterByIters(set, iters, shouldRemove) {
  if (iters.length === 0) {
    return set;
  }
  iters = iters.map(iter => SetCollection(iter));
  return set.withMutations(s => {
    set.forEach(value => {
      if (shouldRemove(value, iters)) {
        s.remove(value);
      }
    });
  });
}
function updateSet(set, newMap) {
  if (set.__ownerID) {
    set.size = newMap.size;
    set._map = newMap;
    return set;
  }
  return newMap === set._map ? set : newMap.size === 0 ? set.__empty() : set.__make(newMap);
}
const OrderedSet = value => value === undefined || value === null ? emptyOrderedSet() : isOrderedSet(value) ? value : emptyOrderedSet().withMutations(set => {
  const iter = SetCollection(value);
  assertNotInfinite(iter.size);
  iter.forEach(v => set.add(v));
});
OrderedSet.of = (...values) => OrderedSet(values);
OrderedSet.fromKeys = value => OrderedSet(KeyedCollection(value).keySeq());
class OrderedSetImpl extends SetImpl {
  static {
    mixin(this, {
      [IS_ORDERED_SYMBOL]: true,
      [Symbol.toStringTag]: "Immutable.OrderedSet",
      zip: IndexedCollectionPrototype.zip,
      zipWith: IndexedCollectionPrototype.zipWith,
      zipAll: IndexedCollectionPrototype.zipAll
    });
  }
  create(value) {
    return OrderedSet(value);
  }
  toString() {
    return this.__toString("OrderedSet {", "}");
  }
  __empty() {
    return emptyOrderedSet();
  }
  __make(map, ownerID) {
    return makeOrderedSet(map, ownerID);
  }
}
OrderedSet.isOrderedSet = isOrderedSet;
const makeOrderedSet = (map, ownerID) => new OrderedSetImpl(map, ownerID);
const emptyOrderedSet = () => makeOrderedSet(emptyOrderedMap());
const PairSorting = {
  LeftThenRight: -1,
  RightThenLeft: 1
};
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
const Record = (defaultValues, name) => {
  let hasInitialized;
  throwOnInvalidDefaultValues(defaultValues);
  const RecordType = function Record(values) {
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
          console.warn(`Cannot define ${recordName(this)} with property "${propName}" since that property name is part of the Record API.`);
        } else {
          setProp(RecordTypePrototype, propName);
        }
      }
    }
    this.__ownerID = undefined;
    this._values = List().withMutations(l => {
      l.setSize(this._keys.length);
      KeyedCollection(values).forEach((v, k) => {
        l.set(this._indices[k], v === this._defaultValues[k] ? undefined : v);
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
class RecordImpl {
  static {
    mixin(this, {
      asImmutable,
      asMutable,
      deleteIn,
      getIn,
      hasIn,
      merge,
      mergeWith,
      mergeDeep,
      mergeDeepWith,
      mergeDeepIn,
      mergeIn,
      setIn,
      toObject,
      update,
      updateIn,
      withMutations,
      removeIn: deleteIn,
      toJSON: toObject,
      [IS_RECORD_SYMBOL]: true,
      [DELETE]: this.prototype.remove,
      [Symbol.iterator]: this.prototype.entries,
      [Symbol.toStringTag]: "Immutable.Record"
    });
  }
  toString() {
    const body = this._keys.map(k => `${k}: ${quoteString(this.get(k))}`).join(", ");
    return `${recordName(this)} { ${body} }`;
  }
  equals(other) {
    return this === other || isRecord(other) && recordSeq(this).equals(recordSeq(other));
  }
  hashCode() {
    return recordSeq(this).hashCode();
  }
  has(k) {
    return Object.hasOwn(this._indices, k);
  }
  get(k, notSetValue) {
    if (!this.has(k)) {
      return notSetValue;
    }
    const index = this._indices[k];
    const value = this._values.get(index);
    return value === undefined ? this._defaultValues[k] : value;
  }
  set(k, v) {
    if (this.has(k)) {
      const newValues = this._values.set(this._indices[k], v === this._defaultValues[k] ? undefined : v);
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
    return this.__iterator();
  }
  __iterate(fn, reverse) {
    return recordSeq(this).__iterate(fn, reverse);
  }
  __iterator(reverse) {
    return recordSeq(this).__iterator(reverse);
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
}
Record.isRecord = isRecord;
const recordName = record => record.constructor.displayName || record.constructor.name || "Record";
class RecordSeq extends KeyedSeqImpl {
  constructor(record) {
    super();
    this._record = record;
    this.size = record._keys.length;
  }
  get(key, notSetValue) {
    return this._record.get(key, notSetValue);
  }
  has(key) {
    return this._record.has(key);
  }
  __iterateUncached(fn, reverse) {
    const record = this._record;
    const keys = record._keys;
    const size = keys.length;
    let i = 0;
    while (i !== size) {
      const ii = reverse ? size - ++i : i++;
      const k = keys[ii];
      if (fn(record.get(k), k, this) === false) {
        break;
      }
    }
    return i;
  }
  __iteratorUncached(reverse) {
    const record = this._record;
    const keys = record._keys;
    const size = keys.length;
    let i = 0;
    return makeEntryIterator(entry => {
      if (i === size) {
        return false;
      }
      const ii = reverse ? size - ++i : i++;
      const k = keys[ii];
      entry[0] = k;
      entry[1] = record.get(k);
      return true;
    });
  }
}
const recordSeq = record => new RecordSeq(record);
Record.getDescriptiveName = recordName;
const RecordPrototype = RecordImpl.prototype;
function makeRecord(likeRecord, values, ownerID) {
  const record = Object.create(Object.getPrototypeOf(likeRecord));
  record._values = values;
  record.__ownerID = ownerID;
  return record;
}
function setProp(prototype, name) {
  Object.defineProperty(prototype, name, {
    get() {
      return this.get(name);
    },
    set(value) {
      invariant(this.__ownerID, "Cannot set on an immutable record.");
      this.set(name, value);
    }
  });
}
const Range = (start, end, step = 1) => {
  invariant(step !== 0, "Cannot step a Range by 0");
  invariant(start !== undefined, "You must define a start value when using Range");
  invariant(end !== undefined, "You must define an end value when using Range");
  step = Math.abs(step);
  if (end < start) {
    step = -step;
  }
  const size = Math.max(0, Math.ceil((end - start) / step - 1) + 1);
  return new RangeImpl(start, end, step, size);
};
class RangeImpl extends IndexedSeqImpl {
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
    return this.size === 0 ? "Range []" : `Range [ ${this._start}...${this._end}${this._step !== 1 ? ` by ${this._step}` : ""} ]`;
  }
  get(index, notSetValue) {
    return this.has(index) ? this._start + wrapIndex(this, index) * this._step : notSetValue;
  }
  includes(searchValue) {
    const possibleIndex = (searchValue - this._start) / this._step;
    return possibleIndex >= 0 && possibleIndex < this.size && possibleIndex === Math.floor(possibleIndex);
  }
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
  __iterateUncached(fn, reverse = false) {
    const size = this.size;
    const step = this._step;
    let value = reverse ? this._start + (size - 1) * step : this._start;
    let i = 0;
    while (i !== size) {
      const v = value;
      value += reverse ? -step : step;
      const ii = reverse ? size - ++i : i++;
      if (fn(v, ii, this) === false) {
        break;
      }
    }
    return i;
  }
  __iteratorUncached(reverse = false) {
    const size = this.size;
    const step = this._step;
    let value = reverse ? this._start + (size - 1) * step : this._start;
    let i = 0;
    return makeEntryIterator(entry => {
      if (i === size) {
        return false;
      }
      const v = value;
      value += reverse ? -step : step;
      entry[0] = reverse ? size - ++i : i++;
      entry[1] = v;
      return true;
    });
  }
  values() {
    const size = this.size;
    const step = this._step;
    let value = this._start;
    let i = 0;
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      if (i === size) return DONE;
      result.value = value;
      value += step;
      i++;
      return result;
    });
  }
  keys() {
    return makeIndexKeys(this.size);
  }
  equals(other) {
    return other instanceof RangeImpl ? this._start === other._start && this._end === other._end && this._step === other._step : deepEqual(this, other);
  }
  static {
    this.prototype[Symbol.iterator] = this.prototype.values;
  }
}
const Repeat = (value, times) => {
  const size = times === undefined ? Infinity : Math.max(0, times);
  return new RepeatImpl(value, size);
};
class RepeatImpl extends IndexedSeqImpl {
  constructor(value, size) {
    super();
    this._value = value;
    this.size = size;
  }
  toString() {
    if (this.size === 0) {
      return "Repeat []";
    }
    return `Repeat [ ${this._value} ${this.size} times ]`;
  }
  get(index, notSetValue) {
    return this.has(index) ? this._value : notSetValue;
  }
  includes(searchValue) {
    return is(this._value, searchValue);
  }
  slice(begin, end) {
    const size = this.size;
    return wholeSlice(begin, end, size) ? this : new RepeatImpl(this._value, resolveEnd(end, size) - resolveBegin(begin, size));
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
  __iterateUncached(fn, reverse) {
    const size = this.size;
    let i = 0;
    while (i !== size) {
      if (fn(this._value, reverse ? size - ++i : i++, this) === false) {
        break;
      }
    }
    return i;
  }
  __iteratorUncached(reverse) {
    const size = this.size;
    const val = this._value;
    let i = 0;
    return makeEntryIterator(entry => {
      if (i === size) {
        return false;
      }
      entry[0] = reverse ? size - ++i : i++;
      entry[1] = val;
      return true;
    });
  }
  values() {
    const size = this.size;
    const val = this._value;
    let i = 0;
    const result = {
      done: false,
      value: undefined
    };
    return makeIterator(() => {
      if (i === size) return DONE;
      i++;
      result.value = val;
      return result;
    });
  }
  keys() {
    return makeIndexKeys(this.size);
  }
  equals(other) {
    return other instanceof RepeatImpl ? this.size === other.size && is(this._value, other._value) : deepEqual(this, other);
  }
  static {
    this.prototype[Symbol.iterator] = this.prototype.values;
  }
}
const fromJS = (value, converter) => fromJSWith([], converter ?? defaultConverter, value, "", converter?.length > 2 ? [] : undefined, {
  "": value
});
function fromJSWith(stack, converter, value, key, keyPath, parentValue) {
  if (typeof value !== "string" && !isImmutable(value) && (isArrayLike(value) || hasIterator(value) || isPlainObject(value))) {
    if (stack.includes(value)) {
      throw new TypeError("Cannot convert circular structure to Immutable");
    }
    stack.push(value);
    if (keyPath && key !== "") {
      keyPath.push(key);
    }
    const converted = converter.call(parentValue, key, Seq(value).map((v, k) => fromJSWith(stack, converter, v, k, keyPath, value)), keyPath?.slice());
    stack.pop();
    if (keyPath) {
      keyPath.pop();
    }
    return converted;
  }
  return value;
}
const defaultConverter = (k, v) => isIndexed(v) ? v.toList() : isKeyed(v) ? v.toMap() : v.toSet();
const asValues = collection => isKeyed(collection) ? collection.valueSeq() : collection;
function initCollectionConversions() {
  CollectionImpl.prototype.toMap = function toMap() {
    return Map(this.toKeyedSeq());
  };
  CollectionImpl.prototype.toOrderedMap = function toOrderedMap() {
    return OrderedMap(this.toKeyedSeq());
  };
  CollectionImpl.prototype.toOrderedSet = function toOrderedSet() {
    return OrderedSet(asValues(this));
  };
  CollectionImpl.prototype.toSet = function toSet() {
    return Set(asValues(this));
  };
  CollectionImpl.prototype.toStack = function toStack() {
    return Stack(asValues(this));
  };
  CollectionImpl.prototype.toList = function toList() {
    return List(asValues(this));
  };
  CollectionImpl.prototype.countBy = function countBy(grouper, context) {
    const groups = Map().asMutable();
    this.__iterate((v, k) => {
      groups.update(grouper.call(context, v, k, this), 0, a => a + 1);
    });
    return groups.asImmutable();
  };
  CollectionImpl.prototype.groupBy = function groupBy(grouper, context) {
    const isKeyedIter = isKeyed(this);
    const groups = (isOrdered(this) ? OrderedMap() : Map()).asMutable();
    this.__iterate((v, k) => {
      groups.update(grouper.call(context, v, k, this), a => {
        a ??= [];
        a.push(isKeyedIter ? [ k, v ] : v);
        return a;
      });
    });
    return groups.map(arr => reifyValues(this, arr)).asImmutable();
  };
  IndexedCollectionImpl.prototype.keySeq = function keySeq() {
    return Range(0, this.size);
  };
  MapImpl.prototype.sort = function sort(comparator) {
    return OrderedMap(sortFactory(this, comparator));
  };
  MapImpl.prototype.sortBy = function sortBy(mapper, comparator) {
    return OrderedMap(sortFactory(this, comparator, mapper));
  };
  SetImpl.prototype.sort = function sort(comparator) {
    return OrderedSet(sortFactory(this, comparator));
  };
  SetImpl.prototype.sortBy = function sortBy(mapper, comparator) {
    return OrderedSet(sortFactory(this, comparator, mapper));
  };
}
var version$1 = "7.0.0";
var pkg = {
  version: version$1
};
initCollectionConversions();
const {version} = pkg;
export { Collection, List, Map, OrderedMap, OrderedSet, PairSorting, Range, Record, Repeat, Seq, Set, Stack, fromJS, get, getIn$1 as getIn, has, hasIn$1 as hasIn, hash, is, isAssociative, isCollection, isImmutable, isIndexed, isKeyed, isList, isMap, isOrdered, isOrderedMap, isOrderedSet, isPlainObject, isRecord, isSeq, isSet, isStack, isValueObject, merge$1 as merge, mergeDeep$1 as mergeDeep, mergeDeepWith$1 as mergeDeepWith, mergeWith$1 as mergeWith, remove, removeIn, set, setIn$1 as setIn, update$1 as update, updateIn$1 as updateIn, version };
