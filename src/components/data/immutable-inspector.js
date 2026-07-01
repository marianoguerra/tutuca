import { component, html, IMap, ISet, List, OMap, OrderedSet, Record, Seq, Stack } from "tutuca";
import {
  chain,
  classifyData,
  compositeAlter,
  compositeFields,
  compositeMethods,
  getComponents as getJsonComponents,
  makeCompositeView,
  makeValueInspector,
} from "./json.js";

const immutableContainerView = makeCompositeView({
  typeClass: "text-accent",
  borderClass: "border-accent",
});

// Short label for any value used as a map/entry key — JS natives, containers,
// Immutable containers, class instances. Used for ImMap/ImOMap keys here and
// JsMap keys in data.js.
export function fmtAnyKey(k) {
  if (k === null) return "null";
  if (k === undefined) return "undefined";
  const t = typeof k;
  if (t === "string" || t === "number" || t === "boolean" || t === "bigint") return String(k);
  if (t === "symbol") return String(k);
  if (t === "function") return `ƒ ${k.name || "(anonymous)"}()`;
  if (Array.isArray(k)) return `Array(${k.length})`;
  if (k instanceof Map) return `Map(${k.size})`;
  if (k instanceof Set) return `Set(${k.size})`;
  if (k instanceof Date) return k.toISOString();
  if (List.isList(k)) return `List[${k.size}]`;
  if (OMap.isOrderedMap(k)) return `OrderedMap[${k.size}]`;
  if (IMap.isMap(k)) return `Map[${k.size}]`;
  if (OrderedSet.isOrderedSet(k)) return `OrderedSet[${k.size}]`;
  if (ISet.isSet(k)) return `Set[${k.size}]`;
  const ctor = k.constructor?.name;
  return ctor && ctor !== "Object" ? `${ctor} {…}` : Object.prototype.toString.call(k);
}

// Shared fromData statics for the Immutable container components: indexed
// (List/Stack), keyed (Map/OrderedMap) and set-like (Set/OrderedSet) all build
// the same ImEntry rows, differing only in how keys are derived.
const fromIndexedData = {
  fromData(coll, recurse) {
    const items = coll.toArray().map((v, i) => ImEntry.make({ key: String(i), child: recurse(v) }));
    return this.make({ items });
  },
};

const fromKeyedData = {
  fromData(map, recurse) {
    const items = [];
    map.forEach((v, k) => {
      items.push(ImEntry.make({ key: fmtAnyKey(k), child: recurse(v) }));
    });
    return this.make({ items });
  },
};

const fromSetData = {
  fromData(set, recurse) {
    const items = set
      .toArray()
      .map((v) => ImEntry.make({ key: "", showKey: false, child: recurse(v) }));
    return this.make({ items });
  },
};

export const ImEntry = component({
  name: "ImEntry",
  fields: { key: "", child: null, showKey: true },
  view: html`<div class="flex items-center gap-2 leading-tight">
    <span
      @show=".showKey"
      class="text-base-content/60 font-mono text-sm"
      @text=".key"
    ></span>
    <span @show=".showKey" class="text-base-content/30">:</span>
    <x render=".child"></x>
  </div>`,
});

export const ImList = component({
  name: "ImList",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "List";
    },
    countText() {
      return `[${this.items.size}]`;
    },
  },
  alter: compositeAlter,
  statics: fromIndexedData,
  view: immutableContainerView,
});

export const ImStack = component({
  name: "ImStack",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "Stack";
    },
    countText() {
      return `[${this.items.size}]`;
    },
  },
  alter: compositeAlter,
  statics: fromIndexedData,
  view: immutableContainerView,
});

export const ImMap = component({
  name: "ImMap",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "Map";
    },
    countText() {
      return `{${this.items.size}}`;
    },
  },
  alter: compositeAlter,
  statics: fromKeyedData,
  view: immutableContainerView,
});

export const ImOMap = component({
  name: "ImOMap",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "OrderedMap";
    },
    countText() {
      return `{${this.items.size}}`;
    },
  },
  alter: compositeAlter,
  statics: fromKeyedData,
  view: immutableContainerView,
});

export const ImSet = component({
  name: "ImSet",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "Set";
    },
    countText() {
      return `{${this.items.size}}`;
    },
  },
  alter: compositeAlter,
  statics: fromSetData,
  view: immutableContainerView,
});

export const ImOSet = component({
  name: "ImOSet",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "OrderedSet";
    },
    countText() {
      return `{${this.items.size}}`;
    },
  },
  alter: compositeAlter,
  statics: fromSetData,
  view: immutableContainerView,
});

export const ImRecord = component({
  name: "ImRecord",
  fields: { ...compositeFields, recordName: "" },
  methods: {
    ...compositeMethods,
    typeText() {
      return this.recordName ? `Record ${this.recordName}` : "Record";
    },
    countText() {
      return `{${this.items.size}}`;
    },
  },
  alter: compositeAlter,
  statics: {
    fromData(rec, recurse) {
      const recordName = rec._name || rec.constructor.name || "Record";
      const items = [];
      rec.toSeq().forEach((v, k) => {
        items.push(ImEntry.make({ key: String(k), child: recurse(v) }));
      });
      return this.make({ recordName, items });
    },
  },
  view: immutableContainerView,
});

export const ImRange = component({
  name: "ImRange",
  fields: { rangeText: "" },
  statics: {
    fromData(seq) {
      const { _start: start, _end: end, _step: step } = seq;
      const rangeText = step === 1 ? `${start}…${end}` : `${start}…${end} by ${step}`;
      return this.make({ rangeText });
    },
  },
  view: html`<span
    class="font-mono text-sm leading-tight inline-flex items-center gap-1"
  >
    <span class="font-mono text-accent">Range</span>
    <span class="text-base-content/70" @text=".rangeText"></span>
  </span>`,
});

export const ImInspector = makeValueInspector({
  name: "ImInspector",
  fromData(data) {
    return this.make({ value: dispatch(data) });
  },
});

export function classifyImmutable(data, recurse) {
  if (
    Seq.isSeq(data) &&
    data._start !== undefined &&
    data._end !== undefined &&
    data._step !== undefined
  ) {
    return ImRange.Class.fromData(data, recurse);
  }
  if (Record.isRecord(data)) return ImRecord.Class.fromData(data, recurse);
  if (List.isList(data)) return ImList.Class.fromData(data, recurse);
  if (Stack.isStack(data)) return ImStack.Class.fromData(data, recurse);
  if (OMap.isOrderedMap(data)) return ImOMap.Class.fromData(data, recurse);
  if (IMap.isMap(data)) return ImMap.Class.fromData(data, recurse);
  if (OrderedSet.isOrderedSet(data)) return ImOSet.Class.fromData(data, recurse);
  if (ISet.isSet(data)) return ImSet.Class.fromData(data, recurse);
  return null;
}

const dispatch = chain(classifyImmutable, classifyData);

export function getComponents() {
  // The dispatch chain falls back to classifyData (json.js) for plain JS
  // values, so those leaf components must be registered too — otherwise
  // nested values rendered via `<x render=".child">` resolve to nothing.
  return [
    ImInspector,
    ImEntry,
    ImList,
    ImStack,
    ImMap,
    ImOMap,
    ImSet,
    ImOSet,
    ImRecord,
    ImRange,
    ...getJsonComponents(),
  ];
}
