import { produce } from "tutuca/immer";
import { DataInspector } from "./data.js";

export { getComponents } from "./data.js";

export function getExamples() {
  const DI = DataInspector.Class;

  class Person {
    constructor(name, age) {
      this.name = name;
      this.age = age;
    }
  }

  const fnNamed = function greet(_who) {
    return null;
  };
  const fnArrow = (x) => x + 1;
  class Greeter {
    hi() {
      return "hi";
    }
  }

  const nativeMap = new Map([
    ["alpha", 1],
    ["beta", 2],
    ["gamma", 3],
  ]);
  const nativeSet = new Set(["red", "green", "blue"]);
  const mapWithObjectKeys = new Map([
    [{ id: 1 }, "first"],
    [[1, 2], "second"],
  ]);
  const date = new Date("2026-01-15T12:00:00.000Z");
  const regex = /hello\s+world/gi;
  const err = new TypeError("expected a number");
  const sym = Symbol("user-id");
  const big = 9007199254740993n;
  const inst = new Person("Alice", 30);

  const deepZoo = {
    owner: new Person("Bob", 40),
    stats: new Map([
      ["calls", 12],
      ["fails", new Set(["timeout", "auth"])],
    ]),
    fn: fnArrow,
    when: date,
    pattern: regex,
    err,
    uid: sym,
    bigCount: big,
    nothing: undefined,
    json: { ok: true, n: 1 },
    nested: [1, 2, new Map([["x", 99]])],
  };

  const expandDraft = (node) => {
    if (node == null || typeof node !== "object") return;
    if ("isExpanded" in node) node.isExpanded = true;
    if (node.value && typeof node.value === "object") expandDraft(node.value);
    if (Array.isArray(node.items)) for (const item of node.items) expandDraft(item?.child ?? item);
  };
  const deepExpand = (value) => produce(value, expandDraft);
  const expanded = (value) =>
    produce(value, (draft) => {
      draft.isExpanded = true;
    });

  return {
    title: "DataInspector",
    description:
      "Inspect any JS value: JS extras (Symbol, BigInt, function, Date, RegExp, Error, native Map/Set, class instances) and plain JSON.",
    items: [
      { title: "undefined", value: DI.fromData(undefined) },
      { title: "null", value: DI.fromData(null) },
      { title: "bigint", value: DI.fromData(big) },
      { title: "symbol", value: DI.fromData(sym) },
      { title: "named function", value: DI.fromData(fnNamed) },
      { title: "arrow function", value: DI.fromData(fnArrow) },
      {
        title: "anonymous function",
        // biome-ignore lint/complexity/useArrowFunction: demonstrating anonymous old-style function
        value: DI.fromData(function () {
          return null;
        }),
      },
      { title: "class declaration", value: DI.fromData(Greeter) },
      { title: "Date", value: DI.fromData(date) },
      { title: "RegExp", value: DI.fromData(regex) },
      { title: "Error", value: DI.fromData(err) },
      {
        title: "native Map (expanded)",
        value: expanded(DI.fromData(nativeMap)),
      },
      {
        title: "native Set (expanded)",
        value: expanded(DI.fromData(nativeSet)),
      },
      {
        title: "native Map with object keys (expanded)",
        value: expanded(DI.fromData(mapWithObjectKeys)),
      },
      {
        title: "class instance (Person, expanded)",
        value: expanded(DI.fromData(inst)),
      },
      {
        title: "deeply mixed: native collections + JS extras + JSON (expanded)",
        description:
          "Plain object containing a class instance, native Map/Set, function, Date, RegExp, Error, Symbol, BigInt, undefined, and JSON.",
        value: deepExpand(DI.fromData(deepZoo)),
      },
    ],
  };
}
