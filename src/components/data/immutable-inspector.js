import { component, html, IMap, ISet, List, OMap, OrderedSet, Record, Seq, Stack } from "tutuca";
import {
  chain,
  classifyData,
  compositeAlter,
  compositeFields,
  compositeMethods,
  getComponents as getJsonComponents,
  makeCompositeView,
} from "./json.js";

const immutableContainerView = makeCompositeView({
  typeClass: "text-accent",
  borderClass: "border-accent",
});

export function fmtMapKey(k) {
  if (k === null || k === undefined) return String(k);
  const t = typeof k;
  if (t === "string" || t === "number" || t === "boolean") return String(k);
  if (List.isList(k)) return `List[${k.size}]`;
  if (OMap.isOrderedMap(k)) return `OrderedMap[${k.size}]`;
  if (IMap.isMap(k)) return `Map[${k.size}]`;
  if (OrderedSet.isOrderedSet(k)) return `OrderedSet[${k.size}]`;
  if (ISet.isSet(k)) return `Set[${k.size}]`;
  return String(k);
}

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
  statics: {
    fromData(list, recurse) {
      const items = list
        .toArray()
        .map((v, i) => ImEntry.make({ key: String(i), child: recurse(v) }));
      return this.make({ items });
    },
  },
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
  statics: {
    fromData(stack, recurse) {
      const items = stack
        .toArray()
        .map((v, i) => ImEntry.make({ key: String(i), child: recurse(v) }));
      return this.make({ items });
    },
  },
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
  statics: {
    fromData(map, recurse) {
      const items = [];
      map.forEach((v, k) => {
        items.push(ImEntry.make({ key: fmtMapKey(k), child: recurse(v) }));
      });
      return this.make({ items });
    },
  },
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
  statics: {
    fromData(map, recurse) {
      const items = [];
      map.forEach((v, k) => {
        items.push(ImEntry.make({ key: fmtMapKey(k), child: recurse(v) }));
      });
      return this.make({ items });
    },
  },
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
  statics: {
    fromData(set, recurse) {
      const items = set
        .toArray()
        .map((v) => ImEntry.make({ key: "", showKey: false, child: recurse(v) }));
      return this.make({ items });
    },
  },
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
  statics: {
    fromData(set, recurse) {
      const items = set
        .toArray()
        .map((v) => ImEntry.make({ key: "", showKey: false, child: recurse(v) }));
      return this.make({ items });
    },
  },
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

export const ImInspector = component({
  name: "ImInspector",
  fields: { value: null },
  methods: {
    toggleIsExpanded() {
      return typeof this.value?.toggleIsExpanded === "function"
        ? this.setValue(this.value.toggleIsExpanded())
        : this;
    },
  },
  statics: {
    fromData(data) {
      return this.make({ value: dispatch(data) });
    },
  },
  view: html`<span class="contents"><x render=".value"></x></span>`,
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
