import { component, html } from "tutuca";
import {
  classifyImmutable,
  fmtAnyKey,
  getComponents as getImmutableComponents,
} from "./immutable-inspector.js";
import {
  chain,
  classifyJson,
  compositeAlter,
  compositeFields,
  compositeMethods,
  compositeView,
  JsonProperty,
  makeValueInspector,
} from "./json.js";

export const JsUndefined = component({
  name: "JsUndefined",
  fields: {},
  view: html`<span
    class="font-mono text-sm leading-tight text-warning italic"
    >undefined</span
  >`,
});

export const JsBigInt = component({
  name: "JsBigInt",
  fields: { value: "" },
  methods: {
    text() {
      return `${this.value}n`;
    },
  },
  view: html`<span
    class="font-mono text-sm leading-tight text-info"
    @text="$text"
  ></span>`,
});

export const JsSymbol = component({
  name: "JsSymbol",
  fields: { description: "" },
  view: html`<span class="font-mono text-sm leading-tight"
    ><span class="text-info">Symbol</span
    ><span class="text-base-content/40">: </span
    ><span @text=".description"></span
  ></span>`,
});

export const JsFunction = component({
  name: "JsFunction",
  fields: { name: "", kind: "function" },
  methods: {
    hasIdentifier() {
      return this.kind !== "arrow" && this.name !== "";
    },
    prefixText() {
      if (this.kind === "arrow") return "() => { … }";
      if (this.kind === "class") return this.name ? "class " : "class { … }";
      return this.name ? "function " : "function () { … }";
    },
    suffixText() {
      if (this.kind === "class") return " { … }";
      return "() { … }";
    },
  },
  view: html`<span class="font-mono text-sm leading-tight"
    ><span class="text-base-content/40" @text="$prefixText"></span
    ><span
      class="text-info"
      @show="$hasIdentifier"
      @text=".name"
    ></span
    ><span
      class="text-base-content/40"
      @show="$hasIdentifier"
      @text="$suffixText"
    ></span
  ></span>`,
});

export const JsDate = component({
  name: "JsDate",
  fields: { value: "" },
  view: html`<span class="font-mono text-sm leading-tight"
    ><span class="text-info">Date</span
    ><span class="text-base-content/40">: </span
    ><span @text=".value"></span
  ></span>`,
});

export const JsRegExp = component({
  name: "JsRegExp",
  fields: { value: "" },
  view: html`<span
    class="font-mono text-sm leading-tight text-error"
    @text=".value"
  ></span>`,
});

export const JsError = component({
  name: "JsError",
  fields: { errorName: "Error", message: "" },
  view: html`<span class="font-mono text-sm leading-tight"
    ><span class="text-info" @text=".errorName"></span
    ><span class="text-base-content/40">: </span
    ><span
      class="inline-block max-w-xs truncate align-bottom"
      :title=".message"
      @text=".message"
    ></span
  ></span>`,
});

export const JsSetItem = component({
  name: "JsSetItem",
  fields: { child: null },
  view: html`<div class="flex items-center gap-2 leading-tight">
    <x render=".child"></x>
  </div>`,
});

export const JsMap = component({
  name: "JsMap",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "Map";
    },
    countText() {
      return `(${this.items.size})`;
    },
  },
  alter: compositeAlter,
  statics: {
    fromData(map, recurse) {
      const items = [];
      map.forEach((v, k) => {
        items.push(JsonProperty.make({ key: fmtAnyKey(k), child: recurse(v) }));
      });
      return this.make({ items });
    },
  },
  view: compositeView,
});

export const JsSet = component({
  name: "JsSet",
  fields: compositeFields,
  methods: {
    ...compositeMethods,
    typeText() {
      return "Set";
    },
    countText() {
      return `(${this.items.size})`;
    },
  },
  alter: compositeAlter,
  statics: {
    fromData(set, recurse) {
      const items = [...set].map((v) => JsSetItem.make({ child: recurse(v) }));
      return this.make({ items });
    },
  },
  view: compositeView,
});

export const JsClassInstance = component({
  name: "JsClassInstance",
  fields: { ...compositeFields, className: "Object" },
  methods: {
    ...compositeMethods,
    typeText() {
      return this.className;
    },
    countText() {
      return `{${this.items.size}}`;
    },
  },
  alter: compositeAlter,
  statics: {
    fromData(obj, recurse) {
      const className = obj.constructor?.name || "Object";
      const items = [];
      try {
        for (const [k, v] of Object.entries(obj)) {
          items.push(JsonProperty.make({ key: k, child: recurse(v) }));
        }
      } catch (_e) {
        // inaccessible — leave items empty
      }
      return this.make({ className, items });
    },
  },
  view: compositeView,
});

export function classifyJsExtra(data, recurse) {
  if (data === undefined) return JsUndefined.make({});
  const t = typeof data;
  if (t === "symbol") return JsSymbol.make({ description: data.description ?? "" });
  if (t === "function") {
    let kind = "function";
    const src = String(data);
    if (/^(?:async\s+)?class\s/.test(src)) kind = "class";
    else if (!/^(?:async\s+)?function\b/.test(src) && /=>/.test(src)) kind = "arrow";
    return JsFunction.make({ name: data.name ?? "", kind });
  }
  if (t === "bigint") return JsBigInt.make({ value: String(data) });
  if (t !== "object" || data === null) return null;
  if (data instanceof Date) return JsDate.make({ value: data.toISOString() });
  if (data instanceof RegExp) return JsRegExp.make({ value: String(data) });
  if (data instanceof Error)
    return JsError.make({
      errorName: data.name ?? "Error",
      message: data.message ?? "",
    });
  if (data instanceof Map) return JsMap.Class.fromData(data, recurse);
  if (data instanceof Set) return JsSet.Class.fromData(data, recurse);
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) {
    return JsClassInstance.Class.fromData(data, recurse);
  }
  return null;
}

const dispatch = chain(classifyImmutable, classifyJsExtra, classifyJson);

export const DataInspector = makeValueInspector({
  name: "DataInspector",
  fromData(data) {
    return this.make({ value: dispatch(data) });
  },
});

export function getComponents() {
  // dispatch = chain(classifyImmutable, classifyJsExtra, classifyJson), so a
  // nested value can resolve to an Immutable component (Im*) or a plain JSON
  // component (Json*) in addition to the JS-extras components below. Register
  // them all or `<x render=".child">` renders nothing for those branches.
  // getImmutableComponents() already includes the json.js leaf components.
  return [
    DataInspector,
    JsUndefined,
    JsBigInt,
    JsSymbol,
    JsFunction,
    JsDate,
    JsRegExp,
    JsError,
    JsMap,
    JsSet,
    JsClassInstance,
    JsSetItem,
    ...getImmutableComponents(),
  ];
}
