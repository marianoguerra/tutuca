import { Map as IMap, List } from "../deps/immutable.js";
import { extendProtoForKeyed, Field, fieldsByClass } from "../src/oo.js";
import { seqInfoByClass } from "../src/renderer.js";

export class KList {
  constructor(items = IMap(), order = List()) {
    this.items = items;
    this.order = order;
    this.$ = 0;
  }
  _clonish(items, order) {
    return new KList(items, order, this.$);
  }
  toJS() {
    return this.order.toArray().map((k) => this.items.get(k));
  }
  set(k, v) {
    const newOrder = this.items.has(k) ? this.order : this.order.push(k);
    return this._clonish(this.items.set(k, v), newOrder, this.$);
  }
  get(k, dval = null) {
    return this.items.get(k, dval);
  }
  _nextFreeKey() {
    let cur = this.$;
    while (true) {
      const key = `§${cur}§`;
      if (!this.items.has(key)) {
        return [key, cur];
      }
      cur += 1;
    }
  }
  push(v) {
    const [key, next$] = this._nextFreeKey();
    const newKList = this.set(key, v);
    newKList.$ = next$;
    return newKList;
  }
  get size() {
    return this.items.size;
  }
  delete(k) {
    if (this.items.has(k)) {
      const newOrder = this.order.delete(this.order.indexOf(k));
      return this._clonish(this.items.delete(k), newOrder);
    }
    return this;
  }
  moveKeyBeforeKey(k1, k2) {
    const { order } = this;
    return this.moveKeyIndexToIndex(order.indexOf(k1), order.indexOf(k2), 0);
  }
  moveKeyAfterKey(k1, k2) {
    const { order } = this;
    return this.moveKeyIndexToIndex(order.indexOf(k1), order.indexOf(k2), 1);
  }
  moveKeyIndexToIndex(source, target, offset) {
    if (source === -1 || target === -1 || source === target) {
      return this;
    }
    const { order } = this;
    const newPos = target + offset;
    const oldPos = newPos < source ? source + 1 : source;
    const newOrder = order.insert(newPos, order.get(source)).delete(oldPos);
    return this._clonish(this.items, newOrder);
  }
}
// TODO:
const klistCoercer = (_) => null;
class CheckTypeKList {
  isValid(v) {
    return v instanceof KList;
  }
  getMessage(_v) {
    return "KList expected";
  }
}
const CHECK_TYPE_KLIST = new CheckTypeKList();
export class FieldKList extends Field {
  constructor(name, defaultValue = new KList()) {
    super("KList", name, CHECK_TYPE_KLIST, klistCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    extendProtoForKeyed(proto, this.name, uname);
    const { name } = this;
    extendProtoForKeyed(proto, name, uname);
    proto[`pushIn${uname}`] = function (v) {
      return this.set(name, this.get(name).push(v));
    };
  }
}
fieldsByClass.set(KList, FieldKList);
function* klistEntries(seq) {
  for (const k of seq.order) {
    yield [k, seq.items.get(k)];
  }
}
seqInfoByClass.set(KList, ["data-sk", klistEntries]);
